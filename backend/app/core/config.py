"""Application configuration (12-factor, via environment / .env)."""
from functools import lru_cache
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- App ---
    APP_NAME: str = "SpeakEdge"
    ENV: str = "local"  # local | staging | production
    DEBUG: bool = True
    API_V1_PREFIX: str = "/api/v1"
    SECRET_KEY: str = "change-me-in-production-please-32chars-min"

    # --- Server / scaling ---
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    # Gunicorn worker count is set at launch; see run scripts. Kept here for reference.
    WORKERS: int = 4

    # --- CORS ---
    CORS_ORIGINS: List[str] = Field(default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"])

    # --- Legal ---
    # Stamped on every payment as evidence of which Terms the buyer accepted at
    # checkout. Bump this whenever the policy pages are revised.
    TERMS_VERSION: str = "2026-08"

    # --- MongoDB ---
    MONGO_URI: str = "mongodb://localhost:27017"
    MONGO_DB: str = "speakedge"

    # --- Redis (optional; in-memory fallback if unset/unreachable) ---
    REDIS_URL: str = ""  # e.g. redis://localhost:6379/0

    # --- JWT ---
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # --- Passwords / seed ---
    SUPER_ADMIN_EMAIL: str = "admin@speakedge.in"
    SUPER_ADMIN_PASSWORD: str = "Admin@12345"

    # --- Files / storage ---
    STORAGE_BACKEND: str = "local"  # local | s3
    UPLOAD_DIR: str = "storage/uploads"
    MAX_PHOTO_KB: int = 120
    MAX_ID_PROOF_KB: int = 500
    MAX_VIDEO_MB: int = 200  # website-uploaded videos (admin-configurable)
    # S3 / R2 (used only if STORAGE_BACKEND=s3)
    S3_ENDPOINT: str = ""
    S3_BUCKET: str = ""
    S3_ACCESS_KEY: str = ""
    S3_SECRET_KEY: str = ""
    S3_REGION: str = "auto"

    # --- Razorpay ---
    RAZORPAY_KEY_ID: str = "rzp_test_xxxxxxxx"
    RAZORPAY_KEY_SECRET: str = "test_secret"
    RAZORPAY_WEBHOOK_SECRET: str = "webhook_secret"

    # --- Email (SMTP; Mailhog defaults for local) ---
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 1025
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "no-reply@speakedge.in"
    SMTP_TLS: bool = False

    # --- Rate limiting ---
    RATE_LIMIT_AUTH_PER_MIN: int = 20
    RATE_LIMIT_PAYMENT_PER_MIN: int = 30

    # --- Data lifecycle ---
    ARCHIVE_RETENTION_DAYS: int = 60

    # --- Support / brand ---
    WHATSAPP_SUPPORT: str = "8240861168"

    # --- Book purchase (Module 3): ₹999 office collection / ₹1,099 home delivery ---
    BOOK_PRICE_PAISE: int = 99900
    BOOK_DELIVERY_CHARGE_PAISE: int = 10000
    PICKUP_EXPIRY_DAYS: int = 14  # office-collection pickup token validity

    # --- SMS / WhatsApp providers (empty = stub/log only) ---
    SMS_PROVIDER: str = ""       # e.g. msg91 | twilio
    WHATSAPP_PROVIDER: str = ""  # e.g. gupshup | interakt

    # --- Web Push (VAPID) — generate with: python -m py_vapid --applicationServerKey ---
    VAPID_PUBLIC_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    VAPID_CONTACT: str = "mailto:admin@speakedge.in"

    # --- Prompt Library (Module: SpeakEdge Prompt Library) ---
    # Curriculum shape. Spec is 48 weeks × 6 days × 5 prompt slots; kept
    # configurable so the library can be extended without a code change.
    PROMPT_WEEKS: int = 48
    PROMPT_DAYS_PER_WEEK: int = 6

    # --- AI conversation engine ---
    # "stub" runs the full three-stage state machine against a deterministic
    # local responder — no network calls, no API key. Point AI_PROVIDER at a
    # real backend once one is wired into shared/ai_client.py.
    AI_PROVIDER: str = "stub"
    AI_API_KEY: str = ""
    AI_MODEL: str = ""
    AI_MAX_TURNS: int = 60  # hard cap on messages per session (runaway guard)

    # --- Attendance confirmation workflow ---
    # Notify this many hours before the class, then auto-cancel the student's
    # seat this many hours after the notification if they never responded.
    ATTENDANCE_NOTICE_HOURS: int = 24
    ATTENDANCE_DEADLINE_HOURS: int = 18

    # --- Instructions ---
    DEFAULT_LANGUAGE: str = "en"  # ultimate fallback for instruction content

    # --- Learning content (PDF uploads) ---
    MAX_PDF_MB: int = 25


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
