"""Partner ecosystem end to end (CR Parts A–F).

    enquiry -> admin review -> approval -> partner dashboard
      -> lead & sales reporting -> admin verification -> reports & visibility

Covers the three rules the module is built on: approval gates every number,
partners only ever touch their own record, and a partner may only sell the
products admin allowed them. Part E (the franchisee microsite and its enquiry
form) and the CSV/Excel/PDF exports are exercised too.
"""
import pytest

from app.core.security import Role, hash_password
from app.db.models import Partner, User

pytestmark = pytest.mark.asyncio

APPLICATION = {
    "partner_type": "Complete Sujyoti Franchisee Partner",
    "name": "Abc Institute",
    "org": "ABC Institute",
    "phone": "9990001111",
    "whatsapp": "9990001111",
    "email": "abc@example.com",
    "state": "WB",
    "district": "North 24 Parganas",
    "area": "Madhyamgram",
    "interested_in": ["SpeakEdge"],
    "consent_contact": True,
}


async def _admin(client) -> dict:
    await User(username="admin@speakedge.in", email="admin@speakedge.in",
               password_hash=hash_password("Admin@12345"), role=Role.super_admin,
               full_name="Super Admin").insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": "admin@speakedge.in", "password": "Admin@12345"})
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def _approve(client, ah: dict, products=("SpeakEdge",)) -> tuple[str, dict]:
    """Apply, approve, and log the partner in. Returns (partner doc id, headers)."""
    applied = await client.post("/api/v1/partner/apply", json=APPLICATION)
    assert applied.status_code == 200, applied.text
    pid = applied.json()["data"]["id"]

    r = await client.post(f"/api/v1/partner/{pid}/status", headers=ah,
                          json={"status": "approved", "products_allowed": list(products)})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["partner_id"].startswith("PTR-26-")
    # Franchisee partners get a microsite slug reserved at approval.
    assert data["microsite_slug"] == "abc-institute"
    creds = data["credentials"]

    login = await client.post("/api/v1/auth/login",
                              json={"username": creds["username"], "password": creds["password"]})
    assert login.status_code == 200, login.text
    return pid, {"Authorization": f"Bearer {login.json()['data']['access_token']}"}


async def test_application_to_dashboard(client):
    ah = await _admin(client)
    pid, ph = await _approve(client, ah)

    d = (await client.get("/api/v1/partner/dashboard", headers=ph)).json()["data"]
    assert d["id"] == pid
    assert d["name"] == "Abc Institute"
    assert d["partner_type"] == "Complete Sujyoti Franchisee Partner"
    assert d["status"] == "approved"
    assert d["products_allowed"] == ["SpeakEdge"]
    assert d["profile"]["whatsapp"] == "9990001111"
    assert d["profile"]["district"] == "North 24 Parganas"
    assert d["microsite_url"] == "/franchisee/abc-institute"
    assert d["performance"]["total_leads"] == 0


async def test_leads_carry_history_and_respect_allowed_products(client):
    ah = await _admin(client)
    pid, ph = await _approve(client, ah, products=("SpeakEdge", "Sujyoti Publications"))

    # Product-wise access control: only what admin allowed.
    denied = await client.post(f"/api/v1/partner/{pid}/leads", headers=ph, json={
        "name": "Riya", "phone": "9000000001", "interest": "Franchisee",
    })
    assert denied.status_code == 422
    assert "allowed products" in denied.json()["error"]["message"]

    created = await client.post(f"/api/v1/partner/{pid}/leads", headers=ph, json={
        "name": "Riya Das", "phone": "9000000001", "interest": "SpeakEdge",
        "location": "Madhyamgram",
    })
    assert created.status_code == 200, created.text
    lead_id = created.json()["data"]["id"]
    assert created.json()["data"]["status"] == "new"
    assert created.json()["data"]["source"] == "partner"

    # Status moves through the spec's ladder, each step recorded.
    for status in ("contacted", "demo_registered", "admission_pending", "converted"):
        r = await client.patch(f"/api/v1/partner/leads/{lead_id}", headers=ph,
                               json={"status": status, "note": f"moved to {status}"})
        assert r.status_code == 200, r.text
    bad = await client.patch(f"/api/v1/partner/leads/{lead_id}", headers=ph,
                             json={"status": "nonsense"})
    assert bad.status_code == 422

    detail = (await client.get(f"/api/v1/partner/leads/{lead_id}", headers=ph)).json()["data"]
    assert detail["status"] == "converted"
    assert detail["status_label"] == "Converted"
    # One row for the creation plus one per status move.
    assert [h["to"] for h in detail["history"]] == [
        "new", "contacted", "demo_registered", "admission_pending", "converted",
    ]


async def test_only_approved_reports_count(client):
    ah = await _admin(client)
    pid, ph = await _approve(client, ah, products=("SpeakEdge",))

    submitted = await client.post(f"/api/v1/partner/{pid}/reports", headers=ph, json={
        "report_type": "book_sale", "product": "SpeakEdge", "quantity": 4,
        "amount": 60000, "occurred_on": "2026-03-11",
    })
    assert submitted.status_code == 200, submitted.text
    report_id = submitted.json()["data"]["id"]
    assert submitted.json()["data"]["status"] == "pending"

    # Pending work is visible as pending, but counts for nothing.
    perf = (await client.get("/api/v1/partner/me/performance", headers=ph)).json()["data"]
    assert perf["totals"]["total_book_sales"] == 0
    assert perf["totals"]["pending_approval_reports"] == 1
    assert perf["by_product"] == []

    review = await client.post(f"/api/v1/partner/reports/{report_id}/review", headers=ah,
                               json={"action": "approve", "remarks": "Verified"})
    assert review.status_code == 200, review.text

    perf = (await client.get("/api/v1/partner/me/performance", headers=ph)).json()["data"]
    assert perf["totals"]["total_book_sales"] == 4
    assert perf["totals"]["revenue_paise"] == 60000
    assert perf["totals"]["pending_approval_reports"] == 0
    assert perf["by_product"] == [
        {"product": "SpeakEdge", "quantity": 4, "revenue_paise": 60000, "reports": 1},
    ]
    # occurred_on drives the monthly / yearly buckets, not the filing date.
    assert [m["period"] for m in perf["monthly"]] == ["2026-03"]
    assert perf["monthly"][0]["book_sale"] == 4
    assert [y["period"] for y in perf["yearly"]] == ["2026"]


async def test_report_rejects_disallowed_product(client):
    ah = await _admin(client)
    pid, ph = await _approve(client, ah, products=("SpeakEdge",))
    r = await client.post(f"/api/v1/partner/{pid}/reports", headers=ph, json={
        "report_type": "book_sale", "product": "Sujyoti Publications", "quantity": 1,
    })
    assert r.status_code == 422
    bad_type = await client.post(f"/api/v1/partner/{pid}/reports", headers=ph, json={
        "report_type": "invented", "quantity": 1,
    })
    assert bad_type.status_code == 422


async def test_franchisee_microsite_and_enquiry(client):
    ah = await _admin(client)
    pid, ph = await _approve(client, ah)

    # A slug is reserved at approval, but the page stays dark until published.
    assert (await client.get("/api/v1/partner/microsite/abc-institute")).status_code == 404

    edit = await client.patch(f"/api/v1/partner/{pid}/microsite", headers=ah, json={
        "slug": "madhyamgram", "about": "English training centre since 2019.",
        "address": "12 Station Road, Madhyamgram", "map_embed_url": "https://maps.example/abc",
        "public_products": ["SpeakEdge"], "published": True,
    })
    assert edit.status_code == 200, edit.text

    page = (await client.get("/api/v1/partner/microsite/madhyamgram")).json()["data"]
    assert page["name"] == "Abc Institute"
    assert page["about"].startswith("English training")
    assert page["address"] == "12 Station Road, Madhyamgram"
    assert page["products"] == ["SpeakEdge"]
    assert page["phone"] == "9990001111"
    # Internal fields never reach a public payload.
    assert "username" not in page and "remarks" not in page

    # The enquiry form files into that franchisee's own lead list.
    enquiry = await client.post("/api/v1/partner/microsite/madhyamgram/enquiry", json={
        "name": "Sourav Roy", "phone": "9000000002", "message": "Spoken English batch?",
    })
    assert enquiry.status_code == 200, enquiry.text

    leads = (await client.get(f"/api/v1/partner/{pid}/leads", headers=ph)).json()["data"]
    assert len(leads) == 1
    assert leads[0]["name"] == "Sourav Roy" and leads[0]["source"] == "microsite"
    assert leads[0]["history"][0]["by"] == "website"

    # Unpublishing takes the page (and its form) down again.
    await client.patch(f"/api/v1/partner/{pid}/microsite", headers=ah, json={"published": False})
    assert (await client.get("/api/v1/partner/microsite/madhyamgram")).status_code == 404
    blocked = await client.post("/api/v1/partner/microsite/madhyamgram/enquiry",
                                json={"name": "X", "phone": "9000000003"})
    assert blocked.status_code == 404


async def test_microsite_is_franchisee_only(client):
    ah = await _admin(client)
    applied = await client.post("/api/v1/partner/apply",
                                json={**APPLICATION, "partner_type": "Individual Partner"})
    pid = applied.json()["data"]["id"]
    await client.post(f"/api/v1/partner/{pid}/status", headers=ah, json={"status": "approved"})
    r = await client.patch(f"/api/v1/partner/{pid}/microsite", headers=ah,
                           json={"published": True})
    assert r.status_code == 422
    assert "Franchisee" in r.json()["error"]["message"]


async def test_directory_hides_unapproved_and_hidden_partners(client):
    ah = await _admin(client)
    pid, _ = await _approve(client, ah)
    assert len(((await client.get("/api/v1/partner/directory")).json()["data"])) == 1

    await client.patch(f"/api/v1/partner/{pid}", headers=ah, json={"public_visible": False})
    assert (await client.get("/api/v1/partner/directory")).json()["data"] == []

    await client.patch(f"/api/v1/partner/{pid}", headers=ah, json={"public_visible": True})
    filters = (await client.get("/api/v1/partner/directory/filters")).json()["data"]
    assert filters["states"] == ["WB"] and filters["districts"] == ["North 24 Parganas"]

    # Archiving pulls it from the directory and takes the page down.
    assert (await client.delete(f"/api/v1/partner/{pid}", headers=ah)).status_code == 200
    assert (await client.get("/api/v1/partner/directory")).json()["data"] == []


async def test_suspended_partner_cannot_report(client):
    ah = await _admin(client)
    pid, ph = await _approve(client, ah)
    await client.post(f"/api/v1/partner/{pid}/status", headers=ah, json={"status": "suspended"})

    blocked = await client.post(f"/api/v1/partner/{pid}/leads", headers=ph,
                                json={"name": "Riya", "phone": "9000000001"})
    assert blocked.status_code == 403
    # ...but they can still read their dashboard to see why.
    d = (await client.get("/api/v1/partner/dashboard", headers=ph)).json()["data"]
    assert d["status"] == "suspended"


async def test_partner_cannot_touch_another_partners_records(client):
    ah = await _admin(client)
    pid_a, ph_a = await _approve(client, ah)

    other = await client.post("/api/v1/partner/apply",
                              json={**APPLICATION, "name": "Other Centre",
                                    "org": "Other Centre", "phone": "9111000000"})
    pid_b = other.json()["data"]["id"]
    await client.post(f"/api/v1/partner/{pid_b}/status", headers=ah, json={"status": "approved"})

    assert (await client.get(f"/api/v1/partner/{pid_b}/leads", headers=ph_a)).status_code == 403
    denied = await client.post(f"/api/v1/partner/{pid_b}/reports", headers=ph_a,
                               json={"report_type": "book_sale", "quantity": 1})
    assert denied.status_code == 403


@pytest.mark.parametrize("fmt,content_type", [
    ("csv", "text/csv"),
    ("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ("pdf", "application/pdf"),
])
async def test_partner_exports_in_every_format(client, fmt, content_type):
    ah = await _admin(client)
    pid, ph = await _approve(client, ah)
    await client.post(f"/api/v1/partner/{pid}/reports", headers=ph, json={
        "report_type": "course_admission", "product": "SpeakEdge", "quantity": 2,
        "amount": 500000, "occurred_on": "2026-04-02",
    })

    r = await client.get("/api/v1/partner/me/export", headers=ph,
                         params={"dataset": "monthly", "format": fmt})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith(content_type)
    assert r.content

    # And the admin-side network exports.
    for dataset in ("partners", "leads", "sales", "admissions", "product", "monthly", "yearly"):
        a = await client.get(f"/api/v1/partner/admin/export/{dataset}", headers=ah,
                             params={"format": fmt})
        assert a.status_code == 200, f"{dataset}: {a.text}"


async def test_admin_overview_and_partner_performance(client):
    ah = await _admin(client)
    pid, ph = await _approve(client, ah)
    submitted = await client.post(f"/api/v1/partner/{pid}/reports", headers=ph, json={
        "report_type": "membership_sale", "product": "SpeakEdge", "quantity": 3,
        "amount": 900000, "occurred_on": "2026-05-20",
    })
    await client.post(f"/api/v1/partner/reports/{submitted.json()['data']['id']}/review",
                      headers=ah, json={"action": "approve"})

    overview = (await client.get("/api/v1/partner/admin/overview", headers=ah)).json()["data"]
    assert overview["partners"]["total"] == 1
    assert overview["partners"]["by_status"]["approved"] == 1
    assert overview["totals"]["total_membership_sales"] == 3
    assert overview["totals"]["revenue_paise"] == 900000

    one = (await client.get(f"/api/v1/partner/{pid}/performance", headers=ah)).json()["data"]
    assert one["name"] == "Abc Institute"
    assert one["totals"]["total_membership_sales"] == 3

    # The application list doubles as the performance overview.
    apps = (await client.get("/api/v1/partner/applications", headers=ah)).json()["data"]
    assert apps["items"][0]["approved_reports"] == 1


async def test_admin_can_add_partner_directly(client):
    ah = await _admin(client)
    r = await client.post("/api/v1/partner/admin/create", headers=ah, json={
        "partner_type": "Book Store / Shop Partner", "name": "City Books",
        "phone": "9333000000", "state": "WB", "district": "Kolkata",
        "products_allowed": ["Sujyoti Publications"],
    })
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["status"] == "approved" and data["partner_id"].startswith("PTR-26-")
    assert data["microsite_slug"] is None  # not a franchisee
    assert (await Partner.find(Partner.status == "approved").count()) == 1
    assert len((await client.get("/api/v1/partner/directory")).json()["data"]) == 1
