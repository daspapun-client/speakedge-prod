"""New-Student Orientation module.

The orientation is a one-time onboarding session a logged-in student completes
before diving into the learning journey. Admins schedule orientation batches
(live or recorded) and assign a teacher; the teacher/admin marks students
complete (or students self-complete a recorded walkthrough). Completion flips
``Student.orientation_status`` to ``completed`` and unlocks the dashboard prompt.

The walkthrough content below is static (spec-defined) and served to the student
UI — it does not need to live in the database."""
from app.db.base import utcnow
from app.db.models import OrientationBatch, Student, Teacher
from app.modules.notification import service as notif

# The self-navigated walkthrough shown to the student, one card per step. Mirrors
# the product spec (Welcome → Walkthrough → Benefits → Expectations → Community &
# Rules → Q&A). The final "Rules & Guidelines" step must be accepted to complete.
ORIENTATION_STEPS: list[dict] = [
    {
        "key": "welcome",
        "title": "Welcome to SpeakEdge",
        "body": (
            "Welcome aboard! This short orientation (about 30–60 minutes) introduces "
            "you to SpeakEdge and how you'll improve your English speaking here. "
            "Take your time — you can revisit any step."
        ),
        "points": [
            "What SpeakEdge is and how it works",
            "A tour of your dashboard and key features",
            "Your membership benefits, learning routine and community rules",
        ],
    },
    {
        "key": "introduction",
        "title": "Platform Introduction",
        "body": (
            "SpeakEdge is a complete English communication ecosystem. You learn by "
            "speaking — through teacher-led classes, conversation teams and regular "
            "practice — with progress measured by CEFR and speaking assessments."
        ),
        "points": [
            "Learn by speaking, not just studying grammar",
            "Guided by certified teachers and a supportive community",
            "Track your level with CEFR & speaking tests",
        ],
    },
    {
        "key": "walkthrough",
        "title": "Platform Walkthrough",
        "body": "Here's where to find everything you'll use day to day.",
        "points": [
            "Dashboard — your home base and quick actions",
            "Profile — keep your details up to date",
            "Batches & Calendar — your class schedule and meet links",
            "Community Class — join a conversation team",
            "Notifications — reminders and updates",
            "Support Center — help whenever you need it",
        ],
    },
    {
        "key": "benefits",
        "title": "Your Membership Benefits",
        "body": "Your SpeakEdge membership includes:",
        "points": [
            "Lifetime Student ID & membership",
            "Teacher-led and conversation team classes",
            "Complimentary CEFR & speaking assessments",
            "Community access and learning videos",
            "Certificate eligibility and student support",
        ],
    },
    {
        "key": "expectations",
        "title": "Learning Expectations",
        "body": (
            "Consistency is what drives progress. Here's the routine we recommend "
            "to get the most out of your membership."
        ),
        "points": [
            "Practise speaking a little every day",
            "Attend your weekly live classes",
            "Participate actively — speaking is a skill you build",
            "Watch your milestones as your CEFR level grows",
        ],
    },
    {
        "key": "community",
        "title": "Community & Communication",
        "body": (
            "Our community is a safe, respectful space to practise with other "
            "learners. Support is always a message away."
        ),
        "points": [
            "Be kind, encouraging and respectful to every member",
            "Use the community only to practise and learn",
            "Reach support on WhatsApp with your Student ID",
        ],
    },
    {
        "key": "rules",
        "title": "Rules & Guidelines",
        "body": (
            "Please read and accept these guidelines to finish your orientation."
        ),
        "points": [
            "Attend classes on time and inform us if you can't",
            "Keep your microphone/camera etiquette classroom-appropriate",
            "Communicate respectfully; harassment is not tolerated",
            "Share honest feedback so we can help you improve",
        ],
        "requires_accept": True,
    },
]


async def get_student_view(student: Student) -> dict:
    """Everything the student orientation page needs: status, progress, the
    walkthrough content and their assigned session (if any)."""
    batch_info = None
    if student.orientation_batch_id:
        batch = await OrientationBatch.get(student.orientation_batch_id)
        if batch and not batch.is_archived and batch.status != "cancelled":
            teacher_name = None
            if batch.teacher_id:
                t = await Teacher.get(batch.teacher_id)
                teacher_name = t.name if t else None
            batch_info = {
                "id": str(batch.id),
                "title": batch.title,
                "mode": batch.mode,
                "scheduled_at": batch.scheduled_at.isoformat() if batch.scheduled_at else None,
                "duration_min": batch.duration_min,
                "meeting_url": batch.meeting_url,
                "recording_url": batch.recording_url,
                "agenda": batch.agenda,
                "teacher_name": teacher_name,
                "status": batch.status,
            }
    # Self-serve completion is allowed when there's no live session gating it:
    # either no batch assigned, or the assigned session is recorded/self-paced.
    self_complete = batch_info is None or batch_info["mode"] == "recorded"
    return {
        "status": student.orientation_status,
        "step": student.orientation_step,
        "completed_at": (
            student.orientation_completed_at.isoformat()
            if student.orientation_completed_at else None
        ),
        "total_steps": len(ORIENTATION_STEPS),
        "steps": ORIENTATION_STEPS,
        "batch": batch_info,
        "can_self_complete": self_complete,
        # Classes the student may self-join (only when they haven't joined one yet).
        "open_batches": await open_batches_for(student),
    }


async def open_batches_for(student: Student) -> list[dict]:
    """Scheduled orientation classes a student may self-join. Empty once they've
    already joined a class or completed orientation — they may only join one."""
    if student.orientation_batch_id or student.orientation_status == "completed":
        return []
    batches = await OrientationBatch.find(
        OrientationBatch.status == "scheduled",
        OrientationBatch.is_archived == False,  # noqa: E712
    ).sort(OrientationBatch.scheduled_at).to_list()
    out = []
    for b in batches:
        teacher_name = None
        if b.teacher_id:
            t = await Teacher.get(b.teacher_id)
            teacher_name = t.name if t else None
        out.append({
            "id": str(b.id),
            "title": b.title,
            "mode": b.mode,
            "scheduled_at": b.scheduled_at.isoformat() if b.scheduled_at else None,
            "duration_min": b.duration_min,
            "teacher_name": teacher_name,
            "agenda": b.agenda,
        })
    return out


async def maybe_close_batch(batch_id: str | None) -> None:
    """Mark a scheduled session completed once every enrolled student is done."""
    if not batch_id:
        return
    batch = await OrientationBatch.get(batch_id)
    if not batch or batch.is_archived or batch.status != "scheduled" or not batch.student_ids:
        return
    roster = await roster_for(batch)
    if all(r["orientation_status"] == "completed" for r in roster):
        batch.status = "completed"
        batch.touch()
        await batch.save()


async def mark_completed(student: Student, by: str) -> bool:
    """Flip a student to completed (idempotent). Returns True if this call
    changed the state, so callers can avoid duplicate notifications."""
    if student.orientation_status == "completed":
        return False
    student.orientation_status = "completed"
    student.orientation_step = len(ORIENTATION_STEPS)
    student.orientation_completed_at = utcnow()
    student.orientation_completed_by = by
    student.touch()
    await student.save()
    await notif.notify(
        student.student_id,
        "Orientation complete 🎉",
        "You've completed your SpeakEdge orientation — your learning journey starts now!",
        "success",
        push_url="/dashboard",
    )
    await maybe_close_batch(student.orientation_batch_id)
    return True


async def roster_for(batch: OrientationBatch) -> list[dict]:
    """Enrolled students with their orientation status for admin/teacher views."""
    from app.shared.students import load_students_map

    students = await load_students_map(batch.student_ids)
    rows = []
    for sid in batch.student_ids:
        s = students.get(sid)
        rows.append({
            "student_id": sid,
            "full_name": s.full_name if s else None,
            "photo_url": s.photo_url if s else None,
            "gender": s.gender if s else None,
            "orientation_status": s.orientation_status if s else "pending",
            "in_this_batch": bool(s and s.orientation_batch_id == str(batch.id)),
        })
    return rows
