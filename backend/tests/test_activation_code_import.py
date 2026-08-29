"""Excel import of activation codes — insert new, flag existing."""
import io

import pytest
from openpyxl import Workbook

from app.core.security import Role, hash_password
from app.db.models import ActivationCode, CodeStatus, PromptAudience, User

pytestmark = pytest.mark.asyncio


def _xlsx(rows: list[list]) -> bytes:
    wb = Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def _admin_headers(client):
    await User(
        username="admin@speakedge.in", email="admin@speakedge.in",
        password_hash=hash_password("Admin@12345"), role=Role.super_admin,
        full_name="Super Admin",
    ).insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": "admin@speakedge.in", "password": "Admin@12345"})
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def test_import_inserts_new_codes_and_flags_existing(client):
    headers = await _admin_headers(client)
    await ActivationCode(
        code="SPK-26-AAAAAA", status=CodeStatus.unused,
        batch_id="old", audience=PromptAudience.adults,
    ).insert()

    raw = _xlsx([
        ["code", "course", "status", "batch_id", "created_at", "activated_student_id"],
        ["SPK-26-AAAAAA", "adults", "unused", "old", "2026-08-19T00:00:00", ""],
        ["SPK-26-BBBBBB", "kids", "unused", "x", "2026-08-19T00:00:00", ""],
        ["SPK-26-BBBBBB", "kids", "unused", "x", "2026-08-19T00:00:00", ""],
        ["", "adults", "unused", "", "", ""],
        ["SPK-26-CCCCCC", "nope", "unused", "", "", ""],
    ])
    r = await client.post(
        "/api/v1/activation-codes/import",
        headers=headers,
        files={"file": ("codes.xlsx", raw,
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["imported"] == 1
    assert data["codes"] == ["SPK-26-BBBBBB"]
    assert data["existing"] == ["SPK-26-AAAAAA", "SPK-26-BBBBBB"]
    assert {row["reason"] for row in data["invalid"]} == {"missing code", "unknown course 'nope'"}

    new = await ActivationCode.find_one(ActivationCode.code == "SPK-26-BBBBBB")
    assert new is not None and new.audience == PromptAudience.kids
    old = await ActivationCode.find_one(ActivationCode.code == "SPK-26-AAAAAA")
    assert old.batch_id == "old"  # existing row was not overwritten
