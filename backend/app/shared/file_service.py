"""File storage + server-side image compression (Pillow).

- Compresses profile photos / ID proofs and enforces size limits.
- Local disk backend by default; S3/R2 path stubbed via boto3 when configured.
"""
import io
import os
import uuid
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


def save_bytes(data: bytes, subdir: str, ext: str = "jpg") -> str:
    """Persist bytes and return a URL/path the API can serve or sign."""
    if settings.STORAGE_BACKEND == "s3" and settings.S3_BUCKET:
        return _save_s3(data, subdir, ext)
    base = _ensure_dir() / subdir
    base.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}.{ext}"
    path = base / name
    path.write_bytes(data)
    # Served by the static /media mount (see main.py)
    return f"/media/{subdir}/{name}"


def _save_s3(data: bytes, subdir: str, ext: str) -> str:  # pragma: no cover - needs creds
    import boto3

    client = boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT or None,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
    )
    key = f"{subdir}/{uuid.uuid4().hex}.{ext}"
    client.put_object(Bucket=settings.S3_BUCKET, Key=key, Body=data, ContentType="image/jpeg")
    return f"{settings.S3_ENDPOINT}/{settings.S3_BUCKET}/{key}"


def save_photo(raw: bytes) -> str:
    # Profile photos render as small avatars — 512px is ample.
    return save_bytes(compress_image(raw, settings.MAX_PHOTO_KB, max_dim=512), "photos")


def save_book_cover(raw: bytes) -> str:
    """Product cover / gallery images for the book shop."""
    return save_bytes(compress_image(raw, settings.MAX_PHOTO_KB, max_dim=1000), "book_covers")


def save_id_proof(raw: bytes, content_type: str = "image/jpeg") -> str:
    """Images are compressed; PDFs (Aadhaar/Voter ID/etc.) are size-checked as-is."""
    if content_type == "application/pdf":
        if len(raw) > settings.MAX_ID_PROOF_KB * 1024:
            raise ValidationAppError(
                f"The uploaded file exceeds the allowed size ({settings.MAX_ID_PROOF_KB} KB). "
                "Please upload a smaller file."
            )
        return save_bytes(raw, "id_proofs", ext="pdf")
    # Keep ID docs legible for verification while still shrinking them.
    return save_bytes(compress_image(raw, settings.MAX_ID_PROOF_KB, max_dim=1600), "id_proofs")


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
