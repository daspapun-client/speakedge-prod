"""Standard API response envelope shared by all modules (contract for Flutter/FE)."""
from typing import Any, Generic, Optional, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class Envelope(BaseModel, Generic[T]):
    success: bool = True
    data: Optional[T] = None
    message: Optional[str] = None
    error: Optional[dict] = None


def ok(data: Any = None, message: str | None = None) -> dict:
    return {"success": True, "data": data, "message": message, "error": None}


def fail(code: str, message: str, details: Any = None, status: int = 400) -> dict:
    return {
        "success": False,
        "data": None,
        "message": message,
        "error": {"code": code, "message": message, "details": details, "status": status},
    }


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
