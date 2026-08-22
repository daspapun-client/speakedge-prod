"""Admin-editable public links (Google Business Profile + social media).

The real URLs only exist once SpeakEdge is live, so they are stored in the DB
and edited from Admin -> Site Links. What matters here: the public payload is
readable without a login, carries only the links that are actually configured,
and a bad URL is refused rather than shipped to the footer.
"""
import pytest

from app.core.security import Role, hash_password
from app.db.models import User

pytestmark = pytest.mark.asyncio


async def _admin_headers(client):
    await User(
        username="admin@speakedge.in", email="admin@speakedge.in",
        password_hash=hash_password("Admin@12345"), role=Role.super_admin,
        full_name="Super Admin",
    ).insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": "admin@speakedge.in", "password": "Admin@12345"})
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def test_public_links_are_empty_until_admin_fills_them_in(client):
    r = await client.get("/api/v1/site/links")
    assert r.status_code == 200, r.text
    assert r.json()["data"]["links"] == []

    # The editor still sees the blank placeholder rows to type into.
    headers = await _admin_headers(client)
    r = await client.get("/api/v1/site/admin/links", headers=headers)
    keys = [l["key"] for l in r.json()["data"]["links"]]
    assert "gmb" in keys and "facebook" in keys


async def test_admin_can_set_links_and_only_configured_ones_go_public(client):
    headers = await _admin_headers(client)
    rows = (await client.get("/api/v1/site/admin/links", headers=headers)).json()["data"]["links"]
    for row in rows:
        if row["key"] == "gmb":
            row["url"] = "https://maps.google.com/speakedge"
    rows.append({"key": "telegram", "label": "Telegram", "url": "https://t.me/speakedge"})

    r = await client.put("/api/v1/site/admin/links", json={"links": rows}, headers=headers)
    assert r.status_code == 200, r.text

    public = (await client.get("/api/v1/site/links")).json()["data"]["links"]
    assert {l["key"] for l in public} == {"gmb", "telegram"}
    assert public[0]["url"] == "https://maps.google.com/speakedge"


async def test_a_malformed_url_is_refused(client):
    headers = await _admin_headers(client)
    r = await client.put(
        "/api/v1/site/admin/links",
        json={"links": [{"key": "gmb", "label": "Google Business Profile", "url": "maps.google.com"}]},
        headers=headers,
    )
    assert r.status_code == 422, r.text
    assert (await client.get("/api/v1/site/links")).json()["data"]["links"] == []


async def test_editing_links_requires_an_admin(client):
    r = await client.put("/api/v1/site/admin/links", json={"links": []})
    assert r.status_code in (401, 403)
