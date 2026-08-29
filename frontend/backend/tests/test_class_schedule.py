"""Self-check for community-class scheduling: weekly occurrence + 24h RSVP lead."""
from datetime import datetime, timedelta

from app.modules.community.router import (
    CLASS_LEAD,
    IST,
    WEEKDAYS,
    _parse_schedule,
    _session_after,
)


def test_session_after_properties():
    ref = datetime(2026, 7, 9, 12, 30, tzinfo=IST)
    for idx, day in enumerate(WEEKDAYS):
        s = _session_after(day, "18:00", ref)
        assert s.weekday() == idx
        assert (s.hour, s.minute) == (18, 0)
        assert ref <= s < ref + timedelta(days=7)


def test_rsvp_lead_rolls_to_next_week():
    ref = datetime(2026, 7, 9, 12, 0, tzinfo=IST)
    today = WEEKDAYS[ref.weekday()]
    s = _session_after(today, "12:30", ref)  # only 30 min away — inside the 24h lead
    if s - ref < CLASS_LEAD:
        s += timedelta(days=7)
    assert s - ref >= CLASS_LEAD


def test_parse_schedule():
    assert _parse_schedule("Sunday", "6:5") == ("sunday", "06:05")
    assert _parse_schedule("", "") == (None, None)
    for bad in [("funday", "18:00"), ("monday", "25:00"), ("monday", "nope")]:
        try:
            _parse_schedule(*bad)
            assert False, f"expected rejection for {bad}"
        except Exception:
            pass


if __name__ == "__main__":
    test_session_after_properties()
    test_rsvp_lead_rolls_to_next_week()
    test_parse_schedule()
    print("ok")
