"""Partner performance aggregation.

Every number a partner or admin sees is derived here from two collections —
``PartnerLead`` and ``PartnerReport`` — so the partner dashboard, the admin
performance view and the CSV/Excel/PDF exports can never disagree.

The approval workflow is the rule that shapes all of it: a partner-submitted
report stays *pending* until an admin approves it, and **only approved rows
count** towards sales, admissions and revenue. Pending rows are surfaced
separately as "pending approval" so the partner can see what is in flight.
"""
from __future__ import annotations

from collections import defaultdict

from app.db.models import PartnerLead, PartnerReport

REPORT_TYPES = ("book_sale", "course_admission", "membership_sale", "student_registration")
REPORT_TYPE_LABELS = {
    "book_sale": "Book Sales",
    "course_admission": "Course Admissions",
    "membership_sale": "Membership Sales",
    "student_registration": "Student Registrations",
}
LEAD_STATUSES = ("new", "contacted", "demo_registered", "admission_pending", "converted", "lost")
LEAD_STATUS_LABELS = {
    "new": "New Lead",
    "contacted": "Contacted",
    "demo_registered": "Demo Registered",
    "admission_pending": "Admission Pending",
    "converted": "Converted",
    "lost": "Lost",
}
UNSPECIFIED = "Unspecified"


def period_of(report: PartnerReport) -> str:
    """The "YYYY-MM" a report belongs to — the date the sale actually happened
    where the partner supplied one, else the day it was filed."""
    if report.occurred_on and len(report.occurred_on) >= 7:
        return report.occurred_on[:7]
    return report.created_at.strftime("%Y-%m")


def _approved(reports: list[PartnerReport]) -> list[PartnerReport]:
    return [r for r in reports if r.status == "approved"]


def totals(reports: list[PartnerReport], leads: list[PartnerLead]) -> dict:
    """The Performance Summary block: leads, admissions, sales, revenue."""
    approved = _approved(reports)

    def qty(kind: str) -> int:
        return sum(r.quantity for r in approved if r.report_type == kind)

    lead_counts = {s: sum(1 for lead in leads if lead.status == s) for s in LEAD_STATUSES}
    return {
        "total_leads": len(leads),
        "leads_by_status": lead_counts,
        "converted_leads": lead_counts["converted"],
        "total_book_sales": qty("book_sale"),
        "total_admissions": qty("course_admission"),
        "total_membership_sales": qty("membership_sale"),
        "total_student_registrations": qty("student_registration"),
        "total_book_orders": qty("book_sale"),
        "revenue_paise": sum(r.amount or 0 for r in approved),
        "approved_reports": len(approved),
        "pending_approval_reports": sum(1 for r in reports if r.status == "pending"),
        "rejected_reports": sum(1 for r in reports if r.status == "rejected"),
    }


def by_product(reports: list[PartnerReport]) -> list[dict]:
    """Product-wise sales — approved rows only, biggest first."""
    buckets: dict[str, dict] = defaultdict(
        lambda: {"quantity": 0, "revenue_paise": 0, "reports": 0})
    for r in _approved(reports):
        b = buckets[r.product or UNSPECIFIED]
        b["quantity"] += r.quantity
        b["revenue_paise"] += r.amount or 0
        b["reports"] += 1
    rows = [{"product": p, **v} for p, v in buckets.items()]
    rows.sort(key=lambda r: (-r["quantity"], r["product"]))
    return rows


def by_type(reports: list[PartnerReport]) -> list[dict]:
    """Book sales vs admissions vs memberships vs registrations."""
    buckets: dict[str, dict] = defaultdict(
        lambda: {"quantity": 0, "revenue_paise": 0, "reports": 0})
    for r in _approved(reports):
        b = buckets[r.report_type]
        b["quantity"] += r.quantity
        b["revenue_paise"] += r.amount or 0
        b["reports"] += 1
    return [{"report_type": t, "label": REPORT_TYPE_LABELS.get(t, t), **buckets[t]}
            for t in REPORT_TYPES if t in buckets]


def _bucketed(reports: list[PartnerReport], key) -> list[dict]:
    buckets: dict[str, dict] = defaultdict(lambda: {
        "quantity": 0, "revenue_paise": 0, "reports": 0,
        **{t: 0 for t in REPORT_TYPES},
    })
    for r in _approved(reports):
        b = buckets[key(r)]
        b["quantity"] += r.quantity
        b["revenue_paise"] += r.amount or 0
        b["reports"] += 1
        if r.report_type in b:
            b[r.report_type] += r.quantity
    return [{"period": p, **buckets[p]} for p in sorted(buckets)]


def monthly(reports: list[PartnerReport], year: str | None = None) -> list[dict]:
    """Monthly Performance / Monthly Report, oldest month first."""
    rows = _bucketed(reports, period_of)
    return [r for r in rows if not year or r["period"].startswith(year)]


def yearly(reports: list[PartnerReport]) -> list[dict]:
    """Yearly Performance / Yearly Report."""
    return _bucketed(reports, lambda r: period_of(r)[:4])


async def performance_for(partner_id: str, year: str | None = None) -> dict:
    """The whole Partner Activities view for one partner in a single payload."""
    reports = await PartnerReport.find(PartnerReport.partner_id == partner_id,
                                       PartnerReport.is_archived == False).to_list()  # noqa: E712
    leads = await PartnerLead.find(PartnerLead.partner_id == partner_id,
                                   PartnerLead.is_archived == False).to_list()  # noqa: E712
    return {
        "totals": totals(reports, leads),
        "by_product": by_product(reports),
        "by_type": by_type(reports),
        "monthly": monthly(reports, year),
        "yearly": yearly(reports),
    }
