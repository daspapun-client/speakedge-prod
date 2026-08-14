"""Free Demo Class registration form.

The form asks for a learner profile (age, education, occupation), a slot and a
preferred date on that slot's weekday, attribution, and a mandatory privacy
consent. The Kids/Adult demo group is derived from age rather than asked.
"""
from datetime import date, timedelta

import pytest

from app.db.models import Lead
from app.modules.leads import router as leads

pytestmark = pytest.mark.asyncio

SLOT = "Wednesday 6:00 PM – 7:30 PM"


def _next_weekday(name: str) -> str:
    """The next upcoming date falling on `name` (never today). Uses the same
    Indian "today" the server does — the two must agree at the date boundary."""
    target = leads._WEEKDAYS.index(name)
    today = leads.today_ist()
    return (today + timedelta(days=(target - today.weekday()) % 7 or 7)).isoformat()


def _form(**overrides) -> dict:
    body = {
        "name": "Asha Rao",
        "phone": "9990001111",
        "email": "asha@example.com",
        "age": 27,
        "education": "Graduate",
        "occupation": "Salaried Professional",
        "demo_slot": SLOT,
        "demo_date": _next_weekday("Wednesday"),
        "interest": "speaking confidence",
        "heard_from": "Instagram",
        "consent_privacy": True,
    }
    body.update(overrides)
    return body


async def test_options_expose_every_choice_with_slot_dates(client):
    data = (await client.get("/api/v1/leads/demo/options")).json()["data"]

    assert [s["label"] for s in data["slots"]] == leads.DEMO_SLOTS
    assert "Instagram" in data["heard_from"]
    assert "Class XI–XII" in data["education"]
    assert "Homemaker" in data["occupation"]

    # Every offered date really falls on its slot's weekday, and none is today.
    for slot in data["slots"]:
        assert slot["dates"], "a slot with no bookable dates cannot be booked"
        for iso in slot["dates"]:
            d = date.fromisoformat(iso)
            assert leads._WEEKDAYS[d.weekday()] == slot["weekday"]
            assert d > leads.today_ist()


async def test_registration_stores_the_full_profile(client):
    r = await client.post("/api/v1/leads/demo", json=_form())
    assert r.status_code == 200, r.text
    assert r.json()["data"]["demo_group"] == "adults"

    lead = await Lead.find_one(Lead.phone == "9990001111")
    assert lead.age == 27
    assert lead.education == "Graduate"
    assert lead.occupation == "Salaried Professional"
    assert lead.demo_slot == SLOT
    assert lead.demo_date == _next_weekday("Wednesday")
    assert lead.heard_from == "Instagram"
    assert lead.interest == "speaking confidence"
    assert lead.consent_privacy is True
    assert lead.status == "demo_booked"


async def test_age_decides_the_kids_or_adult_demo_group(client):
    r = await client.post("/api/v1/leads/demo", json=_form(phone="9111", age=11))
    assert r.json()["data"]["demo_group"] == "kids"

    r = await client.post("/api/v1/leads/demo", json=_form(phone="9222", age=15))
    assert r.json()["data"]["demo_group"] == "adults"

    # The boundary itself is Kids.
    assert leads.demo_group_for_age(leads.KIDS_MAX_AGE) == "kids"
    assert leads.demo_group_for_age(leads.KIDS_MAX_AGE + 1) == "adults"


async def test_privacy_consent_is_mandatory(client):
    r = await client.post("/api/v1/leads/demo", json=_form(consent_privacy=False))
    assert r.status_code == 422
    assert "privacy" in r.json()["error"]["message"].lower()


async def test_date_must_fall_on_the_chosen_slots_weekday(client):
    # A Friday date against the Wednesday slot.
    r = await client.post("/api/v1/leads/demo",
                          json=_form(demo_date=_next_weekday("Friday")))
    assert r.status_code == 422
    assert "Wednesday" in r.json()["error"]["message"]

    # A date already gone.
    past = leads.today_ist() - timedelta(days=7)
    while past.weekday() != leads._WEEKDAYS.index("Wednesday"):
        past -= timedelta(days=1)
    r = await client.post("/api/v1/leads/demo", json=_form(demo_date=past.isoformat()))
    assert r.status_code == 422
    assert "upcoming" in r.json()["error"]["message"].lower()


@pytest.mark.parametrize("bad", [
    {"education": "Kindergarten"},
    {"occupation": "Astronaut"},
    {"heard_from": "Carrier pigeon"},
    {"demo_slot": "Monday 9:00 AM – 10:00 AM"},
    {"age": 2},
])
async def test_unknown_choices_are_rejected(client, bad):
    r = await client.post("/api/v1/leads/demo", json=_form(**bad))
    assert r.status_code == 422
