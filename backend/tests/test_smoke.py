"""Import-and-wiring smoke test. Runs without a live Mongo — verifies the app
object builds and all module routers are registered under /api/v1."""
from app.main import app


def test_app_builds():
    assert app.title == "SpeakEdge API"


def test_all_modules_registered():
    paths = {route.path for route in app.routes}
    expected_prefixes = [
        "/api/v1/auth/login",
        "/api/v1/activation-codes/generate",
        "/api/v1/activation-codes/stats",
        "/api/v1/activation-codes/manual-activate",
        "/api/v1/membership/activate",
        "/api/v1/membership/resubmit",
        "/api/v1/dashboard/",
        "/api/v1/dashboard/pending-reviews",
        "/api/v1/dashboard/offers",
        "/api/v1/dashboard/downloads",
        "/api/v1/admin/overview",
        "/api/v1/admin/archive/{module}",
        "/api/v1/admin/offers",
        "/api/v1/payments/order",
        "/api/v1/payments/plans",
        "/api/v1/books",
        "/api/v1/books/checkout",
        "/api/v1/books/track/{order_number}",
        "/api/v1/books/admin/products",
        "/api/v1/books/admin/orders",
        "/api/v1/books/admin/pickup/verify",
        "/api/v1/books/admin/reports",
        "/api/v1/subscription/current",
        "/api/v1/notifications/banners",
        "/api/v1/notifications/my",
        "/api/v1/community/directory",
        "/api/v1/community/public/stats",
        "/api/v1/community/public/members",
        "/api/v1/teacher/apply",
        "/api/v1/teacher/dashboard",
        "/api/v1/teacher/attendance",
        "/api/v1/partner/apply",
        "/api/v1/partner/dashboard",
        "/api/v1/exams/",
        "/api/v1/exams/eligibility",
        "/api/v1/videos/",
        "/api/v1/videos/upload",
        "/api/v1/leads/demo",
        "/api/v1/analytics/summary",
        "/api/v1/analytics/students/export",
    ]
    for p in expected_prefixes:
        assert p in paths, f"Missing route: {p}"


def test_health_route_present():
    paths = {route.path for route in app.routes}
    assert "/health" in paths
    assert "/health/ready" in paths
