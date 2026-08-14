"""Multilingual Instructions (Student Profile → Instructions).

Content is admin-managed, never hard-coded: each Instruction carries a
``translations`` map of language code → {title, body}. A student sees their
``preferred_language``; when that translation does not exist the article falls
back to the instruction's own ``fallback_language`` and finally to
``settings.DEFAULT_LANGUAGE``, so a student always sees *something* readable.
"""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.envelope import ok
from app.core.exceptions import ConflictError, NotFoundError, ValidationAppError
from app.core.rbac import CurrentUser, require_admin, require_student
from app.db.models import Instruction
from app.modules.membership import service as membership_service
from app.shared.audit import log_activity

router = APIRouter(prefix="/instructions", tags=["instructions"])

# Languages the UI offers. Kept here (not in the DB) because it is a UI
# affordance; an admin can still write a translation for any code they like.
LANGUAGES: list[dict] = [
    {"code": "en", "label": "English", "native": "English"},
    {"code": "hi", "label": "Hindi", "native": "हिन्दी"},
    {"code": "bn", "label": "Bengali", "native": "বাংলা"},
    {"code": "ta", "label": "Tamil", "native": "தமிழ்"},
    {"code": "te", "label": "Telugu", "native": "తెలుగు"},
    {"code": "mr", "label": "Marathi", "native": "मराठी"},
    {"code": "gu", "label": "Gujarati", "native": "ગુજરાતી"},
    {"code": "kn", "label": "Kannada", "native": "ಕನ್ನಡ"},
    {"code": "ml", "label": "Malayalam", "native": "മലയാളം"},
    {"code": "pa", "label": "Punjabi", "native": "ਪੰਜਾਬੀ"},
    {"code": "or", "label": "Odia", "native": "ଓଡ଼ିଆ"},
    {"code": "as", "label": "Assamese", "native": "অসমীয়া"},
    {"code": "ur", "label": "Urdu", "native": "اردو"},
]
LANGUAGE_CODES = {lang["code"] for lang in LANGUAGES}


def resolve(instr: Instruction, language: str) -> dict:
    """Pick the best available translation and report which one was used, so
    the UI can show a 'shown in English' notice when a translation is missing."""
    translations = instr.translations or {}
    for code in (language, instr.fallback_language, settings.DEFAULT_LANGUAGE):
        entry = translations.get(code)
        if entry and (entry.get("title") or entry.get("body")):
            return {
                "key": instr.key,
                "language": code,
                "requested_language": language,
                "is_fallback": code != language,
                "title": entry.get("title") or instr.key,
                "body": entry.get("body") or "",
                "display_order": instr.display_order,
            }
    # No usable translation at all — surface the gap rather than an empty card.
    return {
        "key": instr.key,
        "language": None,
        "requested_language": language,
        "is_fallback": True,
        "title": instr.key,
        "body": "",
        "display_order": instr.display_order,
        "untranslated": True,
    }


@router.get("/languages")
async def languages():
    """Supported instruction languages (also drives the profile language picker)."""
    return ok({"languages": LANGUAGES, "default": settings.DEFAULT_LANGUAGE})


# ---------------------------------------------------------------------------
# Student
# ---------------------------------------------------------------------------
@router.get("/me")
async def my_instructions(language: str | None = None,
                          user: CurrentUser = Depends(require_student)):
    """Instructions in the student's language, newest structure first.
    ``language`` overrides the profile setting for a one-off preview."""
    student = await membership_service.get_student(user.subject)
    lang = language or student.preferred_language or settings.DEFAULT_LANGUAGE
    rows = await Instruction.find(
        {"is_archived": False, "published": True,
         "audience": {"$in": ["students", "*"]}},
    ).sort([("display_order", 1), ("created_at", 1)]).to_list()
    return ok({
        "language": lang,
        "available_languages": LANGUAGES,
        "items": [resolve(i, lang) for i in rows],
    })


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------
@router.get("/admin/list")
async def admin_list(_admin: CurrentUser = Depends(require_admin)):
    rows = await Instruction.find(
        Instruction.is_archived == False,  # noqa: E712
    ).sort([("display_order", 1), ("created_at", 1)]).to_list()
    out = []
    for i in rows:
        data = i.model_dump(mode="json")
        data["translated_languages"] = sorted(
            code for code, v in (i.translations or {}).items()
            if v and (v.get("title") or v.get("body"))
        )
        out.append(data)
    return ok(out)


class InstructionBody(BaseModel):
    key: str = Field(min_length=1, max_length=80)
    audience: str = "students"
    display_order: int = 0
    fallback_language: str = "en"
    translations: dict[str, dict] = Field(default_factory=dict)
    published: bool = True


def _validate_translations(translations: dict[str, dict]) -> None:
    for code, entry in translations.items():
        if not isinstance(entry, dict):
            raise ValidationAppError(f"Translation '{code}' must be an object")
        extra = set(entry) - {"title", "body"}
        if extra:
            raise ValidationAppError(
                f"Translation '{code}' has unexpected field(s): {sorted(extra)}")


@router.post("/admin")
async def create_instruction(body: InstructionBody,
                             admin: CurrentUser = Depends(require_admin)):
    key = body.key.strip().lower().replace(" ", "-")
    if await Instruction.find_one(Instruction.key == key):
        raise ConflictError(f"An instruction with the key '{key}' already exists")
    _validate_translations(body.translations)
    data = body.model_dump()
    data["key"] = key
    instr = Instruction(**data)
    await instr.insert()
    await log_activity(admin.subject, "instruction.create", role=admin.role.value,
                       target_type="instruction", target_id=str(instr.id),
                       meta={"key": key})
    return ok(instr.model_dump(mode="json"), "Instruction created")


class InstructionUpdate(BaseModel):
    audience: str | None = None
    display_order: int | None = None
    fallback_language: str | None = None
    translations: dict[str, dict] | None = None
    published: bool | None = None


@router.patch("/admin/{instruction_id}")
async def update_instruction(instruction_id: str, body: InstructionUpdate,
                             admin: CurrentUser = Depends(require_admin)):
    instr = await Instruction.get(instruction_id)
    if not instr or instr.is_archived:
        raise NotFoundError("Instruction not found")
    changes = body.model_dump(exclude_none=True)
    if "translations" in changes:
        _validate_translations(changes["translations"])
    for k, v in changes.items():
        setattr(instr, k, v)
    instr.touch()
    await instr.save()
    await log_activity(admin.subject, "instruction.update", role=admin.role.value,
                       target_type="instruction", target_id=instruction_id,
                       meta={"key": instr.key, "fields": sorted(changes)})
    return ok(instr.model_dump(mode="json"), "Instruction saved")


class TranslationBody(BaseModel):
    title: str = Field(min_length=1)
    body: str = Field(min_length=1)


@router.put("/admin/{instruction_id}/translations/{language}")
async def upsert_translation(instruction_id: str, language: str, body: TranslationBody,
                             admin: CurrentUser = Depends(require_admin)):
    """Add or replace one language without touching the others."""
    instr = await Instruction.get(instruction_id)
    if not instr or instr.is_archived:
        raise NotFoundError("Instruction not found")
    code = language.strip().lower()
    if not code:
        raise ValidationAppError("A language code is required")
    translations = dict(instr.translations or {})
    translations[code] = {"title": body.title, "body": body.body}
    instr.translations = translations
    instr.touch()
    await instr.save()
    await log_activity(admin.subject, "instruction.translate", role=admin.role.value,
                       target_type="instruction", target_id=instruction_id,
                       meta={"key": instr.key, "language": code})
    return ok(instr.model_dump(mode="json"), f"'{code}' translation saved")


@router.delete("/admin/{instruction_id}/translations/{language}")
async def delete_translation(instruction_id: str, language: str,
                             admin: CurrentUser = Depends(require_admin)):
    instr = await Instruction.get(instruction_id)
    if not instr or instr.is_archived:
        raise NotFoundError("Instruction not found")
    code = language.strip().lower()
    translations = dict(instr.translations or {})
    if code not in translations:
        raise NotFoundError(f"No '{code}' translation to remove")
    if code == instr.fallback_language:
        raise ConflictError(
            "This is the fallback language — change the fallback before removing it.")
    translations.pop(code)
    instr.translations = translations
    instr.touch()
    await instr.save()
    await log_activity(admin.subject, "instruction.translation_delete", role=admin.role.value,
                       target_type="instruction", target_id=instruction_id,
                       meta={"key": instr.key, "language": code})
    return ok(instr.model_dump(mode="json"), f"'{code}' translation removed")


@router.delete("/admin/{instruction_id}")
async def archive_instruction(instruction_id: str,
                              admin: CurrentUser = Depends(require_admin)):
    instr = await Instruction.get(instruction_id)
    if not instr:
        raise NotFoundError("Instruction not found")
    if instr.is_archived:
        return ok(message="Instruction already archived")
    instr.archive(admin.subject, "instruction deleted")
    await instr.save()
    await log_activity(admin.subject, "instruction.archive", role=admin.role.value,
                       target_type="instruction", target_id=instruction_id,
                       meta={"key": instr.key})
    return ok(message="Instruction archived")
