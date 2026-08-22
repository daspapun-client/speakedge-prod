from types import SimpleNamespace

from app.modules.video.router import _visible_to_student as vis


def _video(**kwargs):
    defaults = {"access": "member", "plans": [], "student_ids": []}
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_video_visibility():
    # General — all students
    assert vis(_video(), "stu1", None, False)
    assert vis(_video(), "stu1", "Gold", True)

    # Plan-tagged — exact match
    assert vis(_video(plans=["Gold"]), "stu1", "Gold", True)
    assert not vis(_video(plans=["Gold"]), "stu1", "Silver", True)
    assert not vis(_video(plans=["Gold"]), "stu1", None, False)

    # Tier inheritance — Gold sees Tribe-tagged videos
    assert vis(_video(plans=["Tribe"]), "stu1", "Gold", True)
    assert not vis(_video(plans=["Gold"]), "stu1", "Tribe", True)
    assert not vis(_video(plans=["Diamond"]), "stu1", "Gold", True)

    # Multi-plan — any matching tier tag grants access
    assert vis(_video(plans=["Tribe", "Tribe Pro", "Silver", "Gold"]), "stu1", "Gold", True)

    # Specific people override
    assert vis(_video(student_ids=["stu1"]), "stu1", None, False)
    assert not vis(_video(student_ids=["stu1"]), "stu2", None, False)

    # Legacy access gates when plans empty
    assert not vis(_video(access="admin"), "stu1", "Gold", True)
    assert not vis(_video(access="subscriber"), "stu1", None, False)
    assert vis(_video(access="subscriber"), "stu1", "Gold", True)
