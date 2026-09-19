"""The one way a meeting link is validated before it is stored.

Every surface that conducts a class or a sitting on a video room — teacher-led
batches, exam slots, orientation sessions, community classes and a member's own
speaking-partner room — stores the same thing: a URL somebody pastes out of
Google Meet (or Zoom, or anything else). Keeping one validator here means a
blank field always clears the link rather than storing ``""``, and a typo that
is not a URL is refused at the edge instead of rendering as a dead button.
"""
from app.core.exceptions import ValidationAppError


def clean_meeting_url(value: str | None) -> str | None:
    """Trim a pasted meeting link; blank clears it, non-URLs are refused."""
    url = (value or "").strip()
    if not url:
        return None
    if not url.startswith(("http://", "https://")):
        raise ValidationAppError("Meeting link must start with http:// or https://")
    return url
