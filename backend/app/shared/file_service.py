"""File storage + server-side image compression (Pillow).

- Compresses profile photos / ID proofs and enforces size limits.
- Two backends, one contract: every save_* returns a `/media/<subdir>/<name>`
  path regardless of where the bytes actually live. Local mode serves that path
  from disk; S3 mode stores the object under `<subdir>/<name>` and the /media
  route in main.py redirects to a presigned URL. Keeping the stored string
  identical in both modes is what lets the DB rows and every frontend
  `<img src>` stay untouched when the backend is switched.
"""
import io
import os
import uuid
from functools import lru_cache
from pathlib import Path

from PIL import Image

from app.core.config import settings
from app.core.exceptions import ValidationAppError

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_ID_PROOF_TYPES = ALLOWED_IMAGE_TYPES | {"application/pdf"}
ALLOWED_VIDEO_TYPES = {"video/mp4", "video/webm"}


def _ensure_dir() -> Path:
    p = Path(settings.UPLOAD_DIR)
    p.mkdir(parents=True, exist_ok=True)
    return p


def compress_image(raw: bytes, max_kb: int, max_dim: int = 1600) -> bytes:
    """Downscale + re-encode to JPEG, stepping quality down until under max_kb.
    Raises ValidationAppError if it cannot be brought under the limit."""
    try:
        img = Image.open(io.BytesIO(raw))
        img = img.convert("RGB")
    except Exception:
        raise ValidationAppError("Uploaded file is not a valid image")

    img.thumbnail((max_dim, max_dim))
    for quality in (80, 72, 65, 58, 50, 42, 35):
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        if buf.tell() <= max_kb * 1024:
            return buf.getvalue()
    # Last attempt already computed
    if buf.tell() > max_kb * 1024:
        raise ValidationAppError(
            f"Image too large even after compression (limit {max_kb} KB). Please upload a smaller image."
        )
    return buf.getvalue()


# The bucket is private, so a stored object is only ever read back through a
# presigned URL. Serving the right type matters there: S3 echoes ContentType on
# the GET, and a PDF or MP4 labelled image/jpeg downloads instead of rendering.
CONTENT_TYPES = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "pdf": "application/pdf",
    "mp4": "video/mp4",
    "webm": "video/webm",
}


def s3_enabled() -> bool:
    return settings.STORAGE_BACKEND == "s3" and bool(settings.S3_BUCKET)


@lru_cache(maxsize=1)
def _client():
    """One boto3 client for the process. Building it per upload re-reads config
    and re-negotiates TLS on every profile photo."""
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT or None,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
    )


def save_bytes(data: bytes, subdir: str, ext: str = "jpg") -> str:
    """Persist bytes and return the `/media/<subdir>/<name>` path they are read
    back through. The path shape is identical on both backends."""
    name = f"{uuid.uuid4().hex}.{ext}"
    if s3_enabled():
        _client().put_object(
            Bucket=settings.S3_BUCKET,
            Key=f"{subdir}/{name}",
            Body=data,
            ContentType=CONTENT_TYPES.get(ext, "application/octet-stream"),
        )
    else:
        base = _ensure_dir() / subdir
        base.mkdir(parents=True, exist_ok=True)
        (base / name).write_bytes(data)
    # Served by the /media route in main.py (static file, or redirect to S3).
    return f"/media/{subdir}/{name}"


def presigned_url(key: str) -> str:  # pragma: no cover - needs creds
    """Short-lived read URL for an object key (the `/media/` prefix stripped)."""
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.S3_BUCKET, "Key": key},
        ExpiresIn=settings.S3_PRESIGN_EXPIRY,
    )


def save_photo(raw: bytes) -> str:
    # Profile photos render as small avatars — 512px is ample.
    return save_bytes(compress_image(raw, settings.MAX_PHOTO_KB, max_dim=512), "photos")


def save_book_cover(raw: bytes) -> str:
    """Product cover / gallery images for the book shop."""
    return save_bytes(compress_image(raw, settings.MAX_PHOTO_KB, max_dim=1000), "book_covers")


def save_partner_photo(raw: bytes) -> str:
    """Franchisee microsite logo / gallery photos."""
    return save_bytes(compress_image(raw, settings.MAX_PHOTO_KB, max_dim=1400), "partner_photos")


def save_offer_banner(raw: bytes) -> str:
    """Wide promotional banner images for exclusive member offers."""
    return save_bytes(compress_image(raw, settings.MAX_PHOTO_KB, max_dim=1400), "offer_banners")


def _save_verification_doc(raw: bytes, content_type: str, subdir: str) -> str:
    """A document uploaded for verification only. Images are compressed; PDFs
    (Aadhaar/Voter ID/marksheets/etc.) are size-checked as-is."""
    if content_type == "application/pdf":
        if len(raw) > settings.MAX_ID_PROOF_KB * 1024:
            raise ValidationAppError(
                f"The uploaded file exceeds the allowed size ({settings.MAX_ID_PROOF_KB} KB). "
                "Please upload a smaller file."
            )
        return save_bytes(raw, subdir, ext="pdf")
    # Keep the document legible for verification while still shrinking it.
    return save_bytes(compress_image(raw, settings.MAX_ID_PROOF_KB, max_dim=1600), subdir)


def save_id_proof(raw: bytes, content_type: str = "image/jpeg") -> str:
    return _save_verification_doc(raw, content_type, "id_proofs")


def save_education_proof(raw: bytes, content_type: str = "image/jpeg") -> str:
    """School/college/academic document proving the learner's stated background."""
    return _save_verification_doc(raw, content_type, "education_proofs")


def save_video(raw: bytes, content_type: str) -> str:
    """Website-uploaded videos (Module 13). Size limit is admin-configurable."""
    if content_type not in ALLOWED_VIDEO_TYPES:
        raise ValidationAppError("Video must be MP4 or WebM")
    if len(raw) > settings.MAX_VIDEO_MB * 1024 * 1024:
        raise ValidationAppError(f"Video exceeds the {settings.MAX_VIDEO_MB} MB upload limit")
    ext = "mp4" if content_type == "video/mp4" else "webm"
    return save_bytes(raw, "videos", ext=ext)


def save_pdf(raw: bytes, content_type: str) -> str:
    """Learning-material PDFs (admin content library). Validated by content type
    and by the %PDF- magic header so a mislabelled upload is rejected early."""
    if content_type != "application/pdf":
        raise ValidationAppError("File must be a PDF")
    if not raw.startswith(b"%PDF-"):
        raise ValidationAppError("Uploaded file is not a valid PDF")
    if len(raw) > settings.MAX_PDF_MB * 1024 * 1024:
        raise ValidationAppError(f"PDF exceeds the {settings.MAX_PDF_MB} MB upload limit")
    return save_bytes(raw, "documents", ext="pdf")


def media_root() -> str:
    return os.path.abspath(settings.UPLOAD_DIR)
