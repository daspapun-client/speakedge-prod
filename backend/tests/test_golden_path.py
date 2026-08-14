"""End-to-end golden path against an in-memory Mongo:
seed admin -> generate code -> activate membership -> pending -> approve
-> student login -> dashboard -> pay (test order) -> verify -> invoice.
"""
import io

import pytest
from PIL import Image

from app.core.security import Role, hash_password
from app.db.models import User

pytestmark = pytest.mark.asyncio


def _png() -> bytes:
    """A real image — uploads are re-encoded through Pillow."""
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(buf, format="PNG")
    return buf.getvalue()


PNG = _png()

# Everything the registration form requires, minus the code and the files.
ACTIVATION_FORM = {
    "full_name": "Asha Rao",
    "password": "Student@123",
    "email": "asha@example.com",
    "age": "27",
    "gender": "Female",
    "phone": "9990001111",
    "address": "1 Park St",
    "state": "WB",
    "district": "Kolkata",
    "pin_code": "700001",
    "id_proof_type": "Aadhaar Card",
    "consent_community_rules": "true",
    "consent_terms": "true",
    "consent_safety_policy": "true",
    "consent_non_refund": "true",
    "consent_process": "true",
}
ACTIVATION_FILES = {
    "photo": ("p.png", PNG, "image/png"),
    "id_proof": ("id.png", PNG, "image/png"),
}


async def _make_admin():
    await User(
        username="admin@speakedge.in",
        email="admin@speakedge.in",
        password_hash=hash_password("Admin@12345"),
        role=Role.super_admin,
        full_name="Super Admin",
    ).insert()


async def test_golden_path(client):
    # Health
    r = await client.get("/health/ready")
    assert r.status_code == 200 and r.json()["data"]["db"] is True

    # Seed admin + login
    await _make_admin()
    r = await client.post("/api/v1/auth/login", json={"username": "admin@speakedge.in", "password": "Admin@12345"})
    assert r.status_code == 200, r.text
    admin_tok = r.json()["data"]["access_token"]
    ah = {"Authorization": f"Bearer {admin_tok}"}

    # Generate activation codes
    r = await client.post("/api/v1/activation-codes/generate", json={"count": 3}, headers=ah)
    assert r.status_code == 200, r.text
    code = r.json()["data"]["codes"][0]
    assert code.startswith("SPK-26-")

    # Activate membership (multipart form + photo and ID proof uploads)
    r = await client.post(
        "/api/v1/membership/activate",
        data={"code": code, **ACTIVATION_FORM},
        files=ACTIVATION_FILES,
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["student_id"] == code
    assert r.json()["data"]["membership_status"] == "Pending Verification"

    # Single-use enforcement: same code again fails
    r = await client.post(
        "/api/v1/membership/activate",
        data={"code": code, **ACTIVATION_FORM, "full_name": "Dupe"},
        files=ACTIVATION_FILES,
    )
    assert r.status_code == 409

    # Status pending
    r = await client.get(f"/api/v1/membership/status/{code}")
    assert r.json()["data"]["membership_status"] == "Pending Verification"

    # Admin approves
    r = await client.post(f"/api/v1/membership/{code}/approve", headers=ah)
    assert r.status_code == 200 and r.json()["data"]["membership_status"] == "Active"

    # Student logs in
    r = await client.post("/api/v1/auth/login", json={"username": code, "password": "Student@123"})
    assert r.status_code == 200, r.text
    sh = {"Authorization": f"Bearer {r.json()['data']['access_token']}"}

    # Dashboard
    r = await client.get("/api/v1/dashboard/", headers=sh)
    assert r.status_code == 200
    assert r.json()["data"]["full_name"] == "Asha Rao"
    assert r.json()["data"]["membership_status"] == "Active"

    # Payment: create test order + verify -> invoice + subscription
    r = await client.post(
        "/api/v1/payments/order",
        json={"plan": "Gold", "kind": "subscription", "accept_terms": True},
        headers=sh,
    )
    assert r.status_code == 200, r.text
    order_id = r.json()["data"]["order_id"]
    assert order_id.startswith("order_test_")

    r = await client.post(
        "/api/v1/payments/verify",
        json={"razorpay_order_id": order_id, "razorpay_payment_id": "pay_test_1", "razorpay_signature": "test"},
        headers=sh,
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "paid"
    assert r.json()["data"]["invoice_no"].startswith("SPK-INV-")

    # Subscription now active + exam eligible (eligibility is its own endpoint;
    # the plan tier is what grants the test allowances).
    r = await client.get("/api/v1/subscription/current", headers=sh)
    assert r.json()["data"]["plan"] == "Gold"
    assert r.json()["data"]["is_active"] is True

    r = await client.get("/api/v1/exams/eligibility", headers=sh)
    assert r.status_code == 200, r.text

    # Payment history shows the invoice
    r = await client.get("/api/v1/dashboard/payments", headers=sh)
    assert len(r.json()["data"]) == 1
    assert r.json()["data"][0]["invoice_url"]


async def test_admin_overview_counts(client):
    await _make_admin()
    r = await client.post("/api/v1/auth/login", json={"username": "admin@speakedge.in", "password": "Admin@12345"})
    ah = {"Authorization": f"Bearer {r.json()['data']['access_token']}"}
    r = await client.get("/api/v1/admin/overview", headers=ah)
    assert r.status_code == 200
    assert "students" in r.json()["data"]


async def test_rbac_student_cannot_generate_codes(client):
    # No token -> 401
    r = await client.post("/api/v1/activation-codes/generate", json={"count": 1})
    assert r.status_code == 401
