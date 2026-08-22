"""Self-check for the weekly meet-link gating (_meeting_active)."""
from datetime import datetime, timedelta
from types import SimpleNamespace

from app.modules.teacher.router import IST, _meeting_active


def _batch(**kw):
    # _meeting_active only reads attributes, so a stand-in avoids Beanie init.
    base = dict(day_of_week=None, date=None, class_dates=[], slot_start=None, slot_end=None,
                meeting_url="https://meet.google.com/x", meeting_forced=False)
    base.update(kw)
    return SimpleNamespace(**base)


def test_meeting_active_window():
    today = datetime.now(IST).strftime("%A")
    other = (datetime.now(IST) + timedelta(days=1)).strftime("%A")

    # Whole-day window on today's weekday → live.
    assert _meeting_active(_batch(day_of_week=today, slot_start="00:00", slot_end="23:59"))
    # Wrong weekday → not live.
    assert not _meeting_active(_batch(day_of_week=other, slot_start="00:00", slot_end="23:59"))
    # Right day but a window that already ended → not live.
    assert not _meeting_active(_batch(day_of_week=today, slot_start="00:00", slot_end="00:00"))
    # No link set → never live.
    assert not _meeting_active(_batch(day_of_week=today, slot_start="00:00", slot_end="23:59", meeting_url=None))
    # Missing slot times → never live.
    assert not _meeting_active(_batch(day_of_week=today))


def test_meeting_forced():
    assert _meeting_active(_batch(meeting_forced=True))
    assert not _meeting_active(_batch(meeting_forced=True, meeting_url=None))
    assert _meeting_active(_batch(meeting_forced=True, slot_start=None, slot_end=None))


def test_meeting_active_class_dates():
    today = datetime.now(IST).strftime("%Y-%m-%d")
    assert _meeting_active(_batch(class_dates=[today], slot_start="00:00", slot_end="23:59"))
    assert not _meeting_active(_batch(class_dates=["1999-01-01"], slot_start="00:00", slot_end="23:59"))


if __name__ == "__main__":
    test_meeting_active_window()
    test_meeting_active_class_dates()
    print("ok")
