"""Membership plan catalogue: the spec values the /plans page renders, and the
one-shot refresh that carries a spec revision onto an already-seeded DB."""
import pytest

pytestmark = pytest.mark.asyncio

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
            p["monthly_fee"] // 100, p["community_years"], p["conversation_per_week"],
            p["classes_per_week"], p["cefr_tests"], p["speaking_tests"], p["support_years"],
        )
        assert got == exp, f"{key}: {got} != {exp}"
        assert p["prices"] == {}, f"{key} still carries term prices"


async def test_stale_row_is_refreshed_once_then_admin_edits_stick(client):
    from app.db.models import PlanConfig

    await client.get("/api/v1/payments/plans")
    # Simulate a live DB seeded before the spec revision.
    cfg = await PlanConfig.find_one(PlanConfig.plan == "Diamond")
    cfg.monthly_fee = 49900
    cfg.community_years = 4
    cfg.prices = {"12": 888800}
    cfg.spec_version = 0
    await cfg.save()

    plans = {p["plan"]: p for p in (await client.get("/api/v1/payments/plans")).json()["data"]}
    assert plans["Diamond"]["monthly_fee"] == 24900
    assert plans["Diamond"]["community_years"] == 5
    assert plans["Diamond"]["prices"] == {}

    # An admin edit after the refresh is not clobbered on subsequent reads.
    cfg = await PlanConfig.find_one(PlanConfig.plan == "Diamond")
    cfg.monthly_fee = 19900
    await cfg.save()
    plans = {p["plan"]: p for p in (await client.get("/api/v1/payments/plans")).json()["data"]}
    assert plans["Diamond"]["monthly_fee"] == 19900
