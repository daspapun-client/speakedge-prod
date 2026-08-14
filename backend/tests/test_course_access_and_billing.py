"""Course separation, access locks, billing anchor and the payment terms gate.

Covers the client requirements added on top of the original spec:
  * Kids and Adults are separate courses, fixed by the activation code.
  * Admin can lock a student out of teacher-led classes and/or the community.
  * The monthly fee counts from the first teacher-led class date, set by admin.
  * No payment can be started without accepting the Terms & Conditions.
"""
import io
from datetime import datetime, timedelta, timezone

import pytest
from PIL import Image

from app.core.security import Role, hash_password
from app.db.models import (
    ActivationCode,
    Batch,
    PlanConfig,
    Student,
    Subscription,
    User,
)
from app.modules.payments import monthly

pytestmark = pytest.mark.asyncio


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(buf, format="PNG")
    return buf.getvalue()


PNG = _png()
FILES = {"photo": ("p.png", PNG, "image/png"), "id_proof": ("id.png", PNG, "image/png")}
FORM = {
    "full_name": "Asha Rao", "password": "Student@123", "age": "27", "gender": "Female",
    "phone": "9990001111", "address": "1 Park St", "state": "WB", "district": "Kolkata",
    "pin_code": "700001", "id_proof_type": "Aadhaar Card",
    "consent_community_rules": "true", "consent_terms": "true",
    "consent_safety_policy": "true", "consent_non_refund": "true", "consent_process": "true",
}


async def _admin_headers(client):
    await User(
        username="admin@speakedge.in", email="admin@speakedge.in",
        password_hash=hash_password("Admin@12345"), role=Role.super_admin,
        full_name="Super Admin",
    ).insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": "admin@speakedge.in", "password": "Admin@12345"})
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def _activate(client, code: str, **overrides) -> dict:
    r = await client.post("/api/v1/membership/activate",
                          data={"code": code, **FORM, **overrides}, files=FILES)
    assert r.status_code == 200, r.text
    return r.json()["data"]


async def _student_headers(client, code: str):
    r = await client.post("/api/v1/auth/login",
                          json={"username": code, "password": "Student@123"})
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


# ---------------------------------------------------------------------------
# Kids / Adults course separation
# ---------------------------------------------------------------------------
async def test_code_audience_decides_the_students_course(client):
    headers = await _admin_headers(client)

    r = await client.post("/api/v1/activation-codes/generate",
                          json={"count": 1, "audience": "kids"}, headers=headers)
    assert r.status_code == 200, r.text
    kid_code = r.json()["data"]["codes"][0]

    # The public form reports which course the code enrols into.
    r = await client.get(f"/api/v1/membership/form-options?code={kid_code}")
    assert r.json()["data"]["audience"] == "kids"
    assert "Aadhaar Card" in r.json()["data"]["id_proof_types"]

    await _activate(client, kid_code)
    student = await Student.find_one(Student.student_id == kid_code)
    assert student.audience.value == "kids"


async def test_student_cannot_switch_course_but_admin_can(client):
    headers = await _admin_headers(client)
    r = await client.post("/api/v1/activation-codes/generate",
                          json={"count": 1, "audience": "adults"}, headers=headers)
    code = r.json()["data"]["codes"][0]
    await _activate(client, code)
    sh = await _student_headers(client, code)

    # A student sending `audience` is ignored — an adult must not be able to
    # read the kids' library, or the other way round.
    r = await client.put("/api/v1/dashboard/profile", headers=sh, json={"audience": "kids"})
    assert r.status_code == 200
    assert r.json()["data"]["audience"] == "adults"

    # An admin can move them.
    r = await client.patch(f"/api/v1/admin/students/{code}", headers=headers,
                           json={"audience": "kids"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["audience"] == "kids"


async def test_activated_code_cannot_be_moved_between_courses(client):
    headers = await _admin_headers(client)
    r = await client.post("/api/v1/activation-codes/generate",
                          json={"count": 1, "audience": "adults"}, headers=headers)
    code = r.json()["data"]["codes"][0]

    # Unused: fine.
    r = await client.post("/api/v1/activation-codes/audience", headers=headers,
                          json={"code": code, "audience": "kids"})
    assert r.status_code == 200, r.text
    assert (await ActivationCode.find_one(ActivationCode.code == code)).audience.value == "kids"

    # Activated: refused — the student's course is fixed by then.
    await _activate(client, code)
    r = await client.post("/api/v1/activation-codes/audience", headers=headers,
                          json={"code": code, "audience": "adults"})
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# ID proof
# ---------------------------------------------------------------------------
async def test_id_proof_type_is_recorded_and_validated(client):
    headers = await _admin_headers(client)
    r = await client.post("/api/v1/activation-codes/generate", json={"count": 2}, headers=headers)
    good, bad = r.json()["data"]["codes"]

    await _activate(client, good, id_proof_type="Passport", id_proof_number="Z1234567")
    student = await Student.find_one(Student.student_id == good)
    assert student.id_proof_type == "Passport"
    assert student.id_proof_number == "Z1234567"

    r = await client.post("/api/v1/membership/activate",
                          data={"code": bad, **FORM, "id_proof_type": "Library Card"},
                          files=FILES)
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# Access locks
# ---------------------------------------------------------------------------
async def test_admin_can_lock_teacher_classes_and_community_independently(client):
    headers = await _admin_headers(client)
    r = await client.post("/api/v1/activation-codes/generate", json={"count": 1}, headers=headers)
    code = r.json()["data"]["codes"][0]
    await _activate(client, code)
    await client.post(f"/api/v1/membership/{code}/approve", headers=headers)
    sh = await _student_headers(client, code)

    # Unlocked: both surfaces respond.
    assert (await client.get("/api/v1/teacher/browse-batches", headers=sh)).status_code == 200
    assert (await client.get("/api/v1/community/directory", headers=sh)).status_code == 200

    # Lock teacher-led classes only.
    r = await client.post(f"/api/v1/admin/students/{code}/access", headers=headers,
                          json={"teacher_class_locked": True, "reason": "Fees pending"})
    assert r.status_code == 200, r.text
    r = await client.get("/api/v1/teacher/browse-batches", headers=sh)
    assert r.status_code == 403
    assert "Fees pending" in r.json()["error"]["message"]
    # Community is untouched.
    assert (await client.get("/api/v1/community/directory", headers=sh)).status_code == 200

    # Lock the community too, then restore both.
    await client.post(f"/api/v1/admin/students/{code}/access", headers=headers,
                      json={"community_locked": True})
    assert (await client.get("/api/v1/community/directory", headers=sh)).status_code == 403

    r = await client.post(f"/api/v1/admin/students/{code}/access", headers=headers,
                          json={"teacher_class_locked": False, "community_locked": False})
    assert r.json()["message"] == "All access restored"
    assert (await client.get("/api/v1/teacher/browse-batches", headers=sh)).status_code == 200
    assert (await client.get("/api/v1/community/directory", headers=sh)).status_code == 200


# ---------------------------------------------------------------------------
# Monthly billing anchored to the first teacher-led class
# ---------------------------------------------------------------------------
def _sub(started: datetime, expires: datetime, billing_start: datetime | None = None):
    return Subscription(student_id="SPK-26-TEST", plan="Gold", started_at=started,
                        expires_at=expires, billing_start_at=billing_start)


async def test_due_dates_count_from_the_class_start_date_not_the_purchase_date():
    started = datetime(2026, 1, 5, tzinfo=timezone.utc)
    expires = datetime(2026, 12, 31, tzinfo=timezone.utc)

    # No class date set yet -> falls back to the purchase date.
    assert monthly.due_dates(_sub(started, expires))[0].date() == datetime(2026, 2, 5).date()

    # Classes actually start on the 20th of February: month 1 is due 20 March.
    class_start = datetime(2026, 2, 20, tzinfo=timezone.utc)
    dues = monthly.due_dates(_sub(started, expires, class_start))
    assert dues[0].date() == datetime(2026, 3, 20).date()
    assert dues[1].date() == datetime(2026, 4, 20).date()


async def test_admin_sets_class_start_date_and_it_moves_the_schedule(client):
    headers = await _admin_headers(client)
    r = await client.post("/api/v1/activation-codes/generate", json={"count": 1}, headers=headers)
    code = r.json()["data"]["codes"][0]
    await _activate(client, code)
    await client.post(f"/api/v1/membership/{code}/approve", headers=headers)

    now = datetime.now(timezone.utc)
    await PlanConfig(plan="Gold", label="Gold", amount=500000, monthly_fee=150000,
                 duration_days=365).insert()
    await Subscription(student_id=code, plan="Gold", started_at=now,
                       expires_at=now + timedelta(days=365), is_active=True).insert()
    # The student is enrolled in a batch — that is what admin gets suggested.
    await Batch(teacher_id="T1", title="Evening Speaking", student_ids=[code],
                class_dates=["2026-11-04", "2026-09-16"]).insert()

    r = await client.get(f"/api/v1/payments/admin/class-start/{code}", headers=headers)
    assert r.status_code == 200, r.text
    # Earliest scheduled class, not the first one listed.
    assert r.json()["data"]["suggested_class_start_date"].startswith("2026-09-16")
    assert r.json()["data"]["class_start_date"] is None

    r = await client.post(f"/api/v1/payments/admin/class-start/{code}", headers=headers,
                          json={"class_start_date": "2026-09-16"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["due_dates"][0].startswith("2026-10-16")

    sub = await Subscription.find_one(Subscription.student_id == code)
    assert sub.billing_start_at is not None

    # Clearing it falls back to the subscription start date.
    r = await client.post(f"/api/v1/payments/admin/class-start/{code}", headers=headers,
                          json={"class_start_date": None})
    assert r.status_code == 200
    assert (await Subscription.find_one(Subscription.student_id == code)).billing_start_at is None


# ---------------------------------------------------------------------------
# Terms & Conditions gate
# ---------------------------------------------------------------------------
async def test_payment_requires_accepting_the_terms(client):
    headers = await _admin_headers(client)
    r = await client.post("/api/v1/activation-codes/generate", json={"count": 1}, headers=headers)
    code = r.json()["data"]["codes"][0]
    await _activate(client, code)
    await client.post(f"/api/v1/membership/{code}/approve", headers=headers)
    sh = await _student_headers(client, code)
    await PlanConfig(plan="Gold", label="Gold", amount=500000, enabled=True,
                 duration_days=365).insert()

    r = await client.post("/api/v1/payments/order", headers=sh,
                          json={"plan": "Gold", "kind": "subscription"})
    assert r.status_code == 422
    assert "terms" in r.json()["error"]["message"].lower()

    r = await client.post("/api/v1/payments/order", headers=sh,
                          json={"plan": "Gold", "kind": "subscription", "accept_terms": True})
    assert r.status_code == 200, r.text

    from app.db.models import Payment
    payment = await Payment.find_one(Payment.razorpay_order_id == r.json()["data"]["order_id"])
    assert payment.terms_accepted_at is not None
    assert payment.terms_version
