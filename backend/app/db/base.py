"""Audited base document — soft-delete/archive-first lifecycle for every collection."""
from datetime import datetime, timedelta, timezone
from typing import Optional

from beanie import Document
from pydantic import Field

from app.core.config import settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AuditedDocument(Document):
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    # Archive-first soft delete
    is_archived: bool = False
    archived_at: Optional[datetime] = None
    archived_by: Optional[str] = None
    delete_reason: Optional[str] = None
    auto_delete_at: Optional[datetime] = None  # archived_at + retention

    def touch(self) -> None:
        self.updated_at = utcnow()

    def archive(self, by: str, reason: str | None = None) -> None:
        self.is_archived = True
        self.archived_at = utcnow()
        self.archived_by = by
        self.delete_reason = reason
        self.auto_delete_at = self.archived_at + timedelta(days=settings.ARCHIVE_RETENTION_DAYS)
        self.touch()

    def restore(self) -> None:
        self.is_archived = False
        self.archived_at = None
        self.archived_by = None
        self.delete_reason = None
        self.auto_delete_at = None
        self.touch()

    class Settings:
        # Beanie: use bson datetime; keep validate on save
        validate_on_save = True
