"""Membership plan catalogue: the spec values the /plans page renders, and the
one-shot refresh that carries a spec revision onto an already-seeded DB."""
import pytest

pytestmark = pytest.mark.asyncio


async def _admin_headers(client):
    from app.core.security import Role, hash_password
    from app.db.models import User

    await User(
        username="admin@speakedge.in", email="admin@speakedge.in",
        password_hash=hash_password("Admin@12345"), role=Role.super_admin,
        full_name="Super Admin",
    ).insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": "admin@speakedge.in", "password": "Admin@12345"})
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}

EXPECTED = {
    # plan: (admission ₹, monthly ₹, community yrs, conv teams, classes/wk,
    #        cefr, speaking, support yrs)
    "Tribe": (799, 0, 1, 0, 0, 0, 1, 0),   # no community class, no CEFR test
    "Basic": (1499, 0, 1, 2, 0, 1, 1, 0),
    "Silver": (1999, 349, 2, 2, 1, 2, 2, 2),
    "Gold": (2499, 299, 3, 2, 1, 3, 3, 3),
    "Diamond": (2999, 249, 5, 2, 1, 4, 4, 5),
    "Silver Pro": (1999, 699, 2, 2, 2, 2, 2, 2),
    "Gold Pro": (2499, 599, 3, 2, 2, 3, 3, 3),
    "Diamond Pro": (2999, 499, 5, 2, 2, 4, 4, 5),
}


async def test_plan_catalogue_matches_spec(client):
    plans = {p["plan"]: p for p in (await client.get("/api/v1/payments/plans")).json()["data"]}
    for key, exp in EXPECTED.items():
        p = plans[key]
        got = (
            (p["offer_price"] if p["offer_price"] is not None else p["amount"]) // 100,
            p["monthly_fee"] // 100, p["community_days"] // 365, p["conversation_per_week"],
            p["classes_per_week"], p["cefr_tests"], p["speaking_tests"], p["support_days"] // 365,
        )
        assert got == exp, f"{key}: {got} != {exp}"
        assert p["prices"] == {}, f"{key} still carries term prices"


async def test_stale_row_is_refreshed_once_then_admin_edits_stick(client):
    from app.db.models import PlanConfig

    await client.get("/api/v1/payments/plans")
    # Simulate a live DB seeded before the spec revision.
    cfg = await PlanConfig.find_one(PlanConfig.plan == "Diamond")
    cfg.monthly_fee = 49900
    cfg.community_days = 4 * 365
    cfg.prices = {"12": 888800}
    cfg.spec_version = 0
    await cfg.save()

    plans = {p["plan"]: p for p in (await client.get("/api/v1/payments/plans")).json()["data"]}
    assert plans["Diamond"]["monthly_fee"] == 24900
    assert plans["Diamond"]["community_days"] == 5 * 365
    assert plans["Diamond"]["prices"] == {}

    # An admin edit after the refresh is not clobbered on subsequent reads.
    cfg = await PlanConfig.find_one(PlanConfig.plan == "Diamond")
    cfg.monthly_fee = 19900
    await cfg.save()
    plans = {p["plan"]: p for p in (await client.get("/api/v1/payments/plans")).json()["data"]}
    assert plans["Diamond"]["monthly_fee"] == 19900


async def test_short_course_runs_on_its_own_day_counts(client):
    """Validity, community access and support are all set in days, so a short
    course is not forced onto a 3/6/12-month term or a whole year."""
    from app.modules.payments import service

    admin_headers = await _admin_headers(client)
    body = {"plan": "crash45", "label": "Crash Course", "amount": 99900,
            "duration_days": 45, "community_days": 30, "support_days": 15}
    r = await client.post("/api/v1/payments/plans", json=body, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert (r.json()["data"]["community_days"], r.json()["data"]["support_days"]) == (30, 15)

    sub = await service.switch_plan("SE-TEST-1", "crash45", months=12)
    assert (sub.expires_at - sub.started_at).days == 45

    r = await client.put("/api/v1/payments/plans/crash45", json={"duration_days": 0},
                         headers=admin_headers)
    assert r.status_code == 422


async def test_rows_stored_in_years_read_back_as_days(client):
    from app.db.models import PlanConfig

    cfg = PlanConfig.model_validate({"plan": "old", "label": "Old", "amount": 0,
                                     "duration_days": 365, "community_years": 2,
                                     "support_years": 1})
    assert (cfg.community_days, cfg.support_days) == (730, 365)
