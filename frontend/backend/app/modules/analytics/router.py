"""Analytics & Reports (Module 15): sales / lead / membership / payment /
community / teacher / partner / demo-conversion aggregates with date-range
filters and CSV exports."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.core.envelope import ok
from app.core.rbac import CurrentUser, require_admin
from app.db.models import (
    BookOrder,
    CEFRStatus,
    CommunityProfile,
    FriendRequest,
    Lead,
    MembershipStatus,
    Partner,
    PartnerReport,
    Payment,
    PaymentStatus,
    SpeakingTeam,
    Student,
    Subscription,
    Teacher,
    TeacherReview,
)
from app.shared.exports import export_response

router = APIRouter(prefix="/analytics", tags=["analytics"])

PAID_STATUSES = [PaymentStatus.paid.value, PaymentStatus.manually_approved.value]


def _date_query(date_from: str | None, date_to: str | None) -> dict:
    """created_at range filter from YYYY-MM-DD strings."""
    rng: dict = {}
    if date_from:
        rng["$gte"] = datetime.fromisoformat(date_from)
    if date_to:
        rng["$lte"] = datetime.fromisoformat(date_to + "T23:59:59")
    return {"created_at": rng} if rng else {}


@router.get("/summary")
async def summary(admin: CurrentUser = Depends(require_admin)):
    total_students = await Student.find(Student.is_archived == False).count()  # noqa: E712
    active = await Student.find(Student.membership_status == MembershipStatus.active).count()
    pending = await Student.find(Student.membership_status == MembershipStatus.pending).count()

    paid_q = {"status": {"$in": PAID_STATUSES}}
    paid = await Payment.find(paid_q).count()
    failed = await Payment.find(Payment.status == PaymentStatus.failed).count()
    revenue = await Payment.find(paid_q).sum(Payment.amount) or 0

    leads = await Lead.find(Lead.is_archived == False).count()  # noqa: E712
    demo_booked = await Lead.find(Lead.status == "demo_booked").count()
    converted = await Lead.find(Lead.status == "converted").count()

    community_total = await CommunityProfile.find(CommunityProfile.is_archived == False).count()  # noqa: E712
    community_verified = await CommunityProfile.find(
        CommunityProfile.cefr_status == CEFRStatus.verified
    ).count()
    teams = await SpeakingTeam.find(SpeakingTeam.is_archived == False).count()  # noqa: E712
    friend_requests = await FriendRequest.find().count()

    book_orders = await BookOrder.find(BookOrder.is_archived == False).count()  # noqa: E712
    book_revenue = await Payment.find({"kind": "book", **paid_q}).sum(Payment.amount) or 0
    active_subs = await Subscription.find(Subscription.is_active == True).count()  # noqa: E712

    partner_sales = await PartnerReport.find(PartnerReport.status == "approved").count()

    return ok({
        "memberships": {"total": total_students, "active": active, "pending": pending},
        "payments": {"count": paid, "failed": failed, "revenue_paise": int(revenue)},
        "sales": {"book_orders": book_orders, "book_revenue_paise": int(book_revenue),
                  "active_subscriptions": active_subs},
        "leads": {"total": leads, "demo_booked": demo_booked, "converted": converted,
                  "conversion_rate": round(converted / leads * 100, 2) if leads else 0},
        "community": {"total": community_total, "verified": community_verified,
                      "self_declared": community_total - community_verified,
                      "teams": teams, "friend_requests": friend_requests},
        "teachers": await Teacher.find(Teacher.status == "approved").count(),
        "partners": {"approved": await Partner.find(Partner.status == "approved").count(),
                     "approved_sales_reports": partner_sales},
    })


def _month_keys(n: int) -> list[str]:
    """Last n calendar months as 'YYYY-MM', oldest first (ending this month)."""
    now = datetime.now(timezone.utc)
    y, m = now.year, now.month
    keys = []
    for _ in range(n):
        keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return list(reversed(keys))


def _month_keys_between(start: datetime, end: datetime) -> list[str]:
    """Every 'YYYY-MM' from start's month through end's month, oldest first."""
    y, m = start.year, start.month
    keys: list[str] = []
    while (y, m) <= (end.year, end.month) and len(keys) < 60:
        keys.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            m, y = 1, y + 1
    return keys or [f"{start.year:04d}-{start.month:02d}"]


async def _monthly(model, since: datetime, until: datetime | None = None,
                   sum_field: str | None = None,
                   extra_match: dict | None = None) -> dict[str, int]:
    """created_at grouped by year-month → count, or sum of sum_field."""
    created: dict = {"$gte": since}
    if until:
        created["$lte"] = until
    match = {"created_at": created, **(extra_match or {})}
    value = {"$sum": f"${sum_field}"} if sum_field else {"$sum": 1}
    rows = await model.aggregate([
        {"$match": match},
        {"$group": {"_id": {"$dateToString": {"format": "%Y-%m", "date": "$created_at"}}, "v": value}},
    ]).to_list()
    return {r["_id"]: int(r["v"]) for r in rows}


async def _breakdown(model, field: str, match: dict | None = None, limit: int = 0) -> list[dict]:
    """Group by a field → [{label, value}] sorted desc; drops nulls."""
    pipeline: list[dict] = []
    if match:
        pipeline.append({"$match": match})
    pipeline += [
        {"$match": {field: {"$ne": None}}},
        {"$group": {"_id": f"${field}", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
    ]
    if limit:
        pipeline.append({"$limit": limit})
    rows = await model.aggregate(pipeline).to_list()
    return [{"label": str(r["_id"]), "value": r["n"]} for r in rows]


@router.get("/dashboard")
async def dashboard(admin: CurrentUser = Depends(require_admin), months: int = 6,
                    date_from: str | None = None, date_to: str | None = None):
    """Trends, distributions & leaderboards for the admin dashboard charts.

    Defaults to the last `months` calendar months; pass `date_from`/`date_to`
    (YYYY-MM-DD) to generate the dashboard for an explicit range instead.
    """
    if date_from or date_to:
        since = (datetime.fromisoformat(date_from) if date_from
                 else datetime.now(timezone.utc).replace(year=datetime.now(timezone.utc).year - 1))
        until = datetime.fromisoformat(date_to + "T23:59:59") if date_to else datetime.now(timezone.utc)
        keys = _month_keys_between(since, until)
    else:
        months = max(3, min(months, 12))
        keys = _month_keys(months)
        since = datetime.fromisoformat(keys[0] + "-01").replace(tzinfo=timezone.utc)
        until = None
    date_match = _date_query(date_from, date_to)
    not_arch = {"is_archived": False}

    new_students = await _monthly(Student, since, until, extra_match=not_arch)
    new_leads = await _monthly(Lead, since, until, extra_match=not_arch)
    revenue = await _monthly(Payment, since, until, sum_field="amount",
                             extra_match={"status": {"$in": PAID_STATUSES}})

    # Top partners by approved sales amount.
    partner_rows = await PartnerReport.aggregate([
        {"$match": {"status": "approved", **date_match}},
        {"$group": {"_id": "$partner_id", "amount": {"$sum": "$amount"}, "count": {"$sum": 1}}},
        {"$sort": {"amount": -1}},
        {"$limit": 8},
    ]).to_list()
    pids = [r["_id"] for r in partner_rows]
    names = {p.partner_id or str(p.id): p.name
             for p in await Partner.find({"partner_id": {"$in": pids}}).to_list()}
    top_partners = [{"label": names.get(r["_id"], r["_id"]),
                     "value": int(r["amount"] or 0), "hint": f"{r['count']} sales"}
                    for r in partner_rows]

    # Top teachers by average student rating.
    teacher_rows = await TeacherReview.aggregate([
        {"$match": {"status": "submitted", "rating": {"$ne": None}, **date_match}},
        {"$group": {"_id": "$teacher_id", "avg": {"$avg": "$rating"}, "n": {"$sum": 1},
                    "name": {"$first": "$teacher_name"}}},
        {"$sort": {"avg": -1, "n": -1}},
        {"$limit": 8},
    ]).to_list()
    top_teachers = [{"label": r.get("name") or r["_id"],
                     "value": round(r["avg"], 2), "hint": f"{r['n']} reviews"}
                    for r in teacher_rows]

    return ok({
        "months": keys,
        "trends": {
            "new_students": [new_students.get(k, 0) for k in keys],
            "new_leads": [new_leads.get(k, 0) for k in keys],
            "revenue_paise": [revenue.get(k, 0) for k in keys],
        },
        "distributions": {
            "membership": await _breakdown(Student, "membership_status", {**not_arch, **date_match}),
            "cefr_level": await _breakdown(Student, "cefr_level", {**not_arch, **date_match}),
            "lead_source": await _breakdown(Lead, "source", {**not_arch, **date_match}),
            "payment_kind": await _breakdown(Payment, "kind", {"status": {"$in": PAID_STATUSES}, **date_match}),
        },
        "leaderboards": {
            "top_teachers": top_teachers,
            "top_partners": top_partners,
        },
    })


# CSV / XLSX / PDF streaming lives in app.shared.exports so the partner report
# exports and these share one implementation.
_export_response = export_response


@router.get("/payments/export")
async def export_payments(admin: CurrentUser = Depends(require_admin),
                          date_from: str | None = None, date_to: str | None = None,
                          status: str | None = None, format: str = "csv"):
    query: dict = {"is_archived": False, **_date_query(date_from, date_to)}
    if status:
        query["status"] = status
    payments = await Payment.find(query).sort(-Payment.created_at).to_list()
    rows = ([p.invoice_no or "", p.student_id, p.kind, p.plan or "", p.amount,
             p.status.value, p.refund_status.value if p.refund_status else "",
             p.created_at.isoformat()] for p in payments)
    return _export_response("payments",
                            ["invoice_no", "student_id", "kind", "plan", "amount_paise",
                             "status", "refund_status", "created_at"], rows, format)


@router.get("/students/export")
async def export_students(admin: CurrentUser = Depends(require_admin),
                          date_from: str | None = None, date_to: str | None = None,
                          status: str | None = None, format: str = "csv"):
    query: dict = {"is_archived": False, **_date_query(date_from, date_to)}
    if status:
        query["membership_status"] = status
    students = await Student.find(query).sort(-Student.created_at).to_list()
    rows = ([s.student_id, s.full_name, s.phone or "", s.state or "", s.district or "",
             s.membership_status.value, s.cefr_status.value, s.cefr_level or "",
             s.created_at.isoformat()] for s in students)
    return _export_response("students",
                            ["student_id", "full_name", "phone", "state", "district",
                             "membership_status", "cefr_status", "cefr_level", "created_at"],
                            rows, format)


@router.get("/leads/export")
async def export_leads(admin: CurrentUser = Depends(require_admin),
                       date_from: str | None = None, date_to: str | None = None,
                       status: str | None = None, format: str = "csv"):
    query: dict = {"is_archived": False, **_date_query(date_from, date_to)}
    if status:
        query["status"] = status
    leads = await Lead.find(query).sort(-Lead.created_at).to_list()
    rows = ([lead.name, lead.phone, lead.email or "", lead.age or "",
             lead.demo_group or "", lead.education or "", lead.occupation or "",
             lead.source, lead.interest or "", lead.demo_slot or "", lead.demo_date or "",
             lead.heard_from or "", lead.heard_from_detail or "",
             "yes" if lead.consent_privacy else "no",
             lead.status, lead.feedback or "", lead.created_at.isoformat()] for lead in leads)
    return _export_response("leads",
                            ["name", "phone", "email", "age", "demo_group", "education",
                             "occupation", "source", "interest", "demo_slot", "demo_date",
                             "heard_from", "heard_from_detail", "consent_privacy", "status",
                             "feedback", "created_at"], rows, format)


@router.get("/book-orders/export")
async def export_book_orders(admin: CurrentUser = Depends(require_admin),
                             date_from: str | None = None, date_to: str | None = None,
                             format: str = "csv"):
    query: dict = {"is_archived": False, **_date_query(date_from, date_to)}
    orders = await BookOrder.find(query).sort(-BookOrder.created_at).to_list()
    rows = ([o.order_number, o.buyer_name, o.phone, o.delivery_type, o.amount,
             o.delivery_charge, o.status.value, o.state or "", o.created_at.isoformat()]
            for o in orders)
    return _export_response("book_orders",
                            ["order_number", "buyer_name", "phone", "delivery_type",
                             "amount_paise", "delivery_charge_paise", "status", "state",
                             "created_at"], rows, format)
