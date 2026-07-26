"""Admin panel: access control, stats shape, allowlist management."""

import pytest

from app.core.config import get_settings
from app.services import ratelimit_ip
from tests.test_auth import add_to_allowlist, do_login_callback, fake_claims
from tests.test_generation import PARAMS, generate, logged_in, mock_ai  # noqa: F401


@pytest.fixture(autouse=True)
def _reset_ip_limits():
    ratelimit_ip.reset()
    yield
    ratelimit_ip.reset()


@pytest.fixture()
def admin(client, db_session, monkeypatch):
    monkeypatch.setattr(get_settings(), "zk_admin_emails", "Admin@Example.com")
    add_to_allowlist(db_session, "admin@example.com")
    do_login_callback(client, monkeypatch, claims=fake_claims(email="admin@example.com", sub="sub-admin"))
    me = client.get("/api/v1/me").json()
    assert me["is_admin"] is True
    return {"X-CSRF-Token": me["csrf_token"]}


def test_admin_endpoints_are_404_for_normal_users(client, logged_in, mock_ai):
    assert client.get("/api/v1/me").json()["is_admin"] is False
    assert client.get("/api/v1/admin/stats").status_code == 404
    assert client.get("/api/v1/admin/allowlist").status_code == 404
    assert client.post("/api/v1/admin/allowlist", json={"email": "x@y.de"}, headers=logged_in).status_code == 404


def test_admin_endpoints_are_401ish_for_anonymous(client):
    assert client.get("/api/v1/admin/stats").status_code == 401


def test_admin_stats_shape(client, db_session, admin, monkeypatch, mock_ai):
    # admin generates twice (1 live + 1 cache hit) and leaves feedback
    from tests.test_generation import generate as gen

    recipe_id = gen(client, admin)[-1][1]["recipe_id"]
    gen(client, admin)
    client.post(f"/api/v1/recipes/{recipe_id}/feedback", json={"wert": 1}, headers=admin)

    stats = client.get("/api/v1/admin/stats?days=7").json()
    # identical params by the same user regenerate now -> both calls are live
    assert stats["generations"]["total"] == 2
    assert stats["generations"]["live"] == 2
    assert stats["generations"]["cached"] == 0
    assert stats["tokens"]["in"] == 6000
    assert stats["cost_usd"] >= 0
    assert stats["per_user"][0]["email"] == "admin@example.com"
    version = list(stats["feedback"].keys())[0]
    assert stats["feedback"][version]["up"] == 1
    assert stats["limits"]["per_user"] == get_settings().daily_limit_per_user

    # daily trend series (7-day axis) — sparkline data
    assert len(stats["daily"]) == 7
    assert sum(d["gens"] for d in stats["daily"]) == 2  # both generations today
    assert stats["daily"][-1]["gens"] == 2  # newest bucket = today
    u = stats["per_user"][0]
    assert len(u["series"]) == 7 and sum(u["series"]) == 2


def test_admin_allowlist_crud(client, admin):
    r = client.post("/api/v1/admin/allowlist", json={"email": "Neu@Example.COM"}, headers=admin)
    assert r.json() == {"email": "neu@example.com"}

    items = client.get("/api/v1/admin/allowlist").json()["items"]
    emails = [i["email"] for i in items]
    assert "neu@example.com" in emails
    assert "admin@example.com" in emails
    admin_entry = next(i for i in items if i["email"] == "admin@example.com")
    assert admin_entry["registered"] is True

    assert client.delete("/api/v1/admin/allowlist/neu@example.com", headers=admin).status_code == 200
    assert "neu@example.com" not in [i["email"] for i in client.get("/api/v1/admin/allowlist").json()["items"]]
    assert client.delete("/api/v1/admin/allowlist/neu@example.com", headers=admin).status_code == 404


def test_admin_allowlist_rejects_invalid_email(client, admin):
    assert client.post("/api/v1/admin/allowlist", json={"email": "kein-email"}, headers=admin).status_code == 422


def test_admin_users_list_and_per_user_limit(client, admin, db_session, monkeypatch, mock_ai):
    from app.core.config import get_settings

    # admin generates once so today's usage shows up
    from tests.test_generation import generate as gen

    gen(client, admin)

    listing = client.get("/api/v1/admin/users").json()
    assert listing["default_limit"] == get_settings().daily_limit_per_user
    me = next(u for u in listing["items"] if u["email"] == "admin@example.com")
    assert me["is_admin"] is True
    assert me["used_today"] == 1
    assert me["daily_limit"] is None  # unset -> uses default
    assert me["effective_limit"] == get_settings().daily_limit_per_user

    # set an explicit per-user cap
    r = client.patch(f"/api/v1/admin/users/{me['id']}", json={"daily_limit": 3}, headers=admin)
    assert r.status_code == 200 and r.json()["daily_limit"] == 3
    again = next(u for u in client.get("/api/v1/admin/users").json()["items"] if u["id"] == me["id"])
    assert again["daily_limit"] == 3 and again["effective_limit"] == 3

    # reset to default (null) + validation
    assert client.patch(f"/api/v1/admin/users/{me['id']}", json={"daily_limit": None}, headers=admin).json()["daily_limit"] is None
    assert client.patch(f"/api/v1/admin/users/{me['id']}", json={"daily_limit": 99999}, headers=admin).status_code == 422
    assert client.patch("/api/v1/admin/users/999999", json={"daily_limit": 5}, headers=admin).status_code == 404


def test_admin_system_limits_get_and_patch(client, admin, db_session):
    from app.core.config import get_settings

    s = get_settings()
    # GET: effective values = config defaults (no override row yet)
    data = client.get("/api/v1/admin/limits", headers=admin).json()
    assert data["default_user_limit"] == s.daily_limit_per_user
    assert data["global_daily_limit"] == s.daily_limit_global
    assert data["registration_daily_limit"] == s.daily_registration_limit
    assert data["anon_ip_limit"] == s.anon_ip_limit
    assert data["anon_global_limit"] == s.daily_limit_anon
    assert data["open_signup"] == s.open_signup
    assert isinstance(data["registrations_today"], int)  # the admin fixture already registered

    # PATCH: partial override persists; untouched fields stay
    d = client.patch(
        "/api/v1/admin/limits",
        json={"default_user_limit": 5, "registration_daily_limit": 20, "anon_ip_limit": 3},
        headers=admin,
    ).json()
    assert d["default_user_limit"] == 5 and d["registration_daily_limit"] == 20 and d["anon_ip_limit"] == 3
    assert d["global_daily_limit"] == s.daily_limit_global  # untouched
    # persisted across requests
    assert client.get("/api/v1/admin/limits", headers=admin).json()["default_user_limit"] == 5

    # validation
    assert client.patch("/api/v1/admin/limits", json={"default_user_limit": -1}, headers=admin).status_code == 422
    assert client.patch("/api/v1/admin/limits", json={"global_daily_limit": 99999999}, headers=admin).status_code == 422


def test_admin_share_intro_setting(client, admin, db_session):
    """The shared-link intro animation is admin-configurable and public-readable."""
    from app.core.config import get_settings

    # default comes from config until an admin overrides it
    assert client.get("/api/v1/admin/limits", headers=admin).json()["share_intro"] == get_settings().share_intro

    for value in ("crt", "off", "motif"):
        d = client.patch("/api/v1/admin/limits", json={"share_intro": value}, headers=admin).json()
        assert d["share_intro"] == value
        assert client.get("/api/v1/admin/limits", headers=admin).json()["share_intro"] == value

    # only the three known modes are accepted
    assert client.patch("/api/v1/admin/limits", json={"share_intro": "sparkles"}, headers=admin).status_code == 422


def test_admin_open_signup_toggle_gates_registration(client, admin, db_session, monkeypatch):
    """The DB toggle overrides config and actually gates Google signup — both ways."""
    from app.models import User

    # config default in the test env is closed; the panel reflects it
    assert client.get("/api/v1/admin/limits", headers=admin).json()["open_signup"] is False

    # closed -> a non-allowlisted newcomer is rejected, no account created
    r = do_login_callback(client, monkeypatch, claims=fake_claims(email="newbie@example.com", sub="sub-n1"))
    assert "login_error=not_allowed" in r.headers["location"]
    assert db_session.query(User).filter_by(email="newbie@example.com").one_or_none() is None

    # toggle persists in both directions
    assert client.patch("/api/v1/admin/limits", json={"open_signup": True}, headers=admin).json()["open_signup"] is True
    assert client.get("/api/v1/admin/limits", headers=admin).json()["open_signup"] is True
    assert client.patch("/api/v1/admin/limits", json={"open_signup": False}, headers=admin).json()["open_signup"] is False
    assert client.patch("/api/v1/admin/limits", json={"open_signup": True}, headers=admin).json()["open_signup"] is True

    # now open -> the same newcomer signs up without the allowlist (this sets the
    # client session cookie to the newcomer, so keep it last)
    r2 = do_login_callback(client, monkeypatch, claims=fake_claims(email="newbie@example.com", sub="sub-n1"))
    assert "login_error" not in r2.headers["location"]
    assert db_session.query(User).filter_by(email="newbie@example.com").one() is not None


def test_admin_user_limit_enforced_in_generation(client, admin, mock_ai):
    from tests.test_generation import PARAMS, generate as gen

    admin_id = client.get("/api/v1/me").json()["id"]
    client.patch(f"/api/v1/admin/users/{admin_id}", json={"daily_limit": 1}, headers=admin)  # cap at 1/day

    gen(client, admin)  # 1st ok (0 -> 1)
    r = client.post("/api/v1/recipes/generate", json={**PARAMS, "kueche": "Thai"}, headers=admin)
    assert r.status_code == 429 and "daily_limit_user" in r.text  # 2nd blocked by the per-user cap


def test_invite_endpoints_removed(client, admin):
    assert client.get("/api/v1/admin/invites").status_code == 404
    assert client.post("/api/v1/admin/invites", json={"count": 1}, headers=admin).status_code == 404
