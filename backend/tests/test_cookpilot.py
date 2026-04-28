"""
Tests for Aria v8.0 — CookPilot Integration (Phase 1).

Covers:
  * GET /api/version → 8.0
  * GET /api/cookpilot/status shape for admin + luzia
  * POST /api/cookpilot/test without URL → {ok:false, step:'url'} (no 500)
  * GET /api/cookpilot/sso-token without config → token=null, url=''
  * GET /api/cookpilot/recipes as luzia → 503 (not configured), NOT 500
  * PUT /api/cookpilot/admin/users/{id}/perms as admin → updates & persists
  * PUT /api/cookpilot/admin/users/{id}/perms as luzia → 403
  * GET /api/health/integrations includes cookpilot entry, available=false
  * Service-Router: keyword fallback for German cooking prompts includes cookpilot
  * Sticky-ForgePilot break: cookpilot message breaks sticky forgepilot
"""
import os
import sys
import uuid
import pytest
import requests
from pymongo import MongoClient

sys.path.insert(0, "/app/backend")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "aria_dashboard")

ADMIN = {"email": "andi.trenter@gmail.com", "password": "Speedy@181279"}
LUZIA = {"email": "luzia@test.ch", "password": "Test1234!"}


# ==================== Fixtures ====================

@pytest.fixture(scope="module")
def mongo_db():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    yield db
    client.close()


def _login(creds):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds)
    assert r.status_code == 200, f"Login failed for {creds['email']}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def admin_session():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def luzia_session():
    return _login(LUZIA)


@pytest.fixture(scope="module")
def admin_user_id(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code == 200
    return r.json().get("id") or r.json().get("_id")


@pytest.fixture(scope="module")
def luzia_user_id(luzia_session):
    r = luzia_session.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code == 200
    return r.json().get("id") or r.json().get("_id")


@pytest.fixture(autouse=True)
def ensure_cookpilot_unconfigured(mongo_db):
    """Tests assume CookPilot URL/secret are NOT set in this preview env."""
    mongo_db.settings.delete_many({"key": {"$in": ["cookpilot_url", "cookpilot_shared_secret"]}})
    yield


# ==================== Version ====================

class TestVersion:
    def test_version_is_at_least_8_0(self):
        r = requests.get(f"{BASE_URL}/api/version")
        assert r.status_code == 200
        data = r.json()
        v = tuple(int(x) for x in str(data.get("version", "0.0")).split("."))
        assert v >= (8, 0), f"Expected version >= 8.0, got {data}"


# ==================== /api/cookpilot/status ====================

class TestCookpilotStatus:
    REQUIRED = {"configured", "url_set", "secret_set", "available", "perms", "is_admin"}

    def test_admin_status_shape(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/cookpilot/status")
        assert r.status_code == 200, r.text
        data = r.json()
        assert self.REQUIRED.issubset(data.keys()), f"Missing: {self.REQUIRED - data.keys()}"
        assert data["is_admin"] is True
        assert data["configured"] is False  # not configured in preview
        assert data["url_set"] is False
        assert data["secret_set"] is False
        assert data["available"] is False
        # Admin: all perms True
        assert isinstance(data["perms"], dict)
        assert all(v is True for v in data["perms"].values()), f"Admin should have all perms true: {data['perms']}"

    def test_luzia_status_shape(self, luzia_session):
        r = luzia_session.get(f"{BASE_URL}/api/cookpilot/status")
        assert r.status_code == 200, r.text
        data = r.json()
        assert self.REQUIRED.issubset(data.keys())
        assert data["is_admin"] is False
        # Defaults: visible, recipes_view, shopping_view, shopping_edit, pantry_view, meal_plan_view, chat -> True
        perms = data["perms"]
        assert perms.get("visible") is True
        assert perms.get("recipes_view") is True
        assert perms.get("recipes_edit") is False
        assert perms.get("admin") is False


# ==================== /api/cookpilot/test (unconfigured) ====================

class TestCookpilotTest:
    def test_test_without_url_returns_step_url(self, admin_session):
        r = admin_session.post(f"{BASE_URL}/api/cookpilot/test")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is False
        assert data.get("step") == "url"

    def test_test_as_non_admin_forbidden(self, luzia_session):
        r = luzia_session.post(f"{BASE_URL}/api/cookpilot/test")
        assert r.status_code == 403


# ==================== /api/cookpilot/sso-token (unconfigured) ====================

class TestCookpilotSSOToken:
    def test_sso_token_without_config_returns_null(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/cookpilot/sso-token")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("token") is None
        assert data.get("url") == ""


# ==================== Recipes proxy when unconfigured ====================

class TestCookpilotRecipesUnconfigured:
    def test_recipes_as_luzia_returns_503(self, luzia_session):
        r = luzia_session.get(f"{BASE_URL}/api/cookpilot/recipes")
        assert r.status_code == 503, f"Expected 503, got {r.status_code}: {r.text}"
        # Must not be a 500
        assert r.status_code != 500


# ==================== Admin: per-user perms ====================

class TestCookpilotPerms:
    def test_admin_updates_luzia_perms(self, admin_session, luzia_user_id, mongo_db):
        perms = {
            "visible": True, "recipes_view": True, "recipes_edit": False,
            "shopping_view": False, "shopping_edit": False, "pantry_view": False,
            "pantry_edit": False, "meal_plan_view": False, "meal_plan_edit": False,
            "chat": False, "tablet": False, "admin": False,
        }
        r = admin_session.put(
            f"{BASE_URL}/api/cookpilot/admin/users/{luzia_user_id}/perms", json=perms
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("success") is True
        assert data.get("perms", {}).get("recipes_view") is True
        assert data.get("perms", {}).get("shopping_view") is False

        # Verify persisted in DB
        from bson import ObjectId
        u = mongo_db.users.find_one({"_id": ObjectId(luzia_user_id)})
        assert u is not None
        assert u.get("cookpilot_perms", {}).get("recipes_view") is True
        assert u.get("cookpilot_perms", {}).get("shopping_view") is False

        # Reset to defaults (broad perms) so other tests aren't poisoned
        default_perms = {k: False for k in perms.keys()}
        default_perms.update({
            "visible": True, "recipes_view": True, "shopping_view": True,
            "shopping_edit": True, "pantry_view": True, "meal_plan_view": True,
            "chat": True,
        })
        admin_session.put(
            f"{BASE_URL}/api/cookpilot/admin/users/{luzia_user_id}/perms",
            json=default_perms,
        )

    def test_luzia_cannot_update_perms(self, luzia_session, luzia_user_id):
        r = luzia_session.put(
            f"{BASE_URL}/api/cookpilot/admin/users/{luzia_user_id}/perms",
            json={k: True for k in [
                "visible", "recipes_view", "recipes_edit", "shopping_view",
                "shopping_edit", "pantry_view", "pantry_edit", "meal_plan_view",
                "meal_plan_edit", "chat", "tablet", "admin",
            ]},
        )
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"


# ==================== /api/health/integrations includes cookpilot ====================

class TestIntegrationsHealthCookpilot:
    def test_includes_cookpilot_unavailable(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/health/integrations")
        assert r.status_code == 200, r.text
        data = r.json()
        ids = {e["service_id"] for e in data}
        assert "cookpilot" in ids, f"cookpilot missing from integrations: {ids}"
        cp = next(e for e in data if e["service_id"] == "cookpilot")
        assert cp["available"] is False  # not configured


# ==================== Service-Router: keyword fallback ====================

class TestServiceRouterCookpilot:
    def test_keyword_fallback_cooking(self):
        import service_router
        services = [{"service_id": s} for s in [
            "weather", "system", "homeassistant", "casedesk",
            "plex", "forgepilot", "cookpilot",
        ]]
        out = service_router._keyword_fallback("Was kann ich heute kochen?", services)
        assert "cookpilot" in out["services"], f"Expected cookpilot in {out}"

    def test_keyword_fallback_shopping_milch(self):
        import service_router
        services = [{"service_id": s} for s in [
            "weather", "system", "homeassistant", "casedesk",
            "plex", "forgepilot", "cookpilot",
        ]]
        out = service_router._keyword_fallback(
            "Füge Milch zur Einkaufsliste hinzu", services
        )
        assert "cookpilot" in out["services"], f"Expected cookpilot in {out}"


# ==================== NON_DEV_SERVICES contains cookpilot ====================

class TestNonDevServicesContainsCookpilot:
    """Unit-level check that server.process_chat_message's NON_DEV_SERVICES
    set includes cookpilot — the precondition for sticky-break to fire when
    router routes a cooking question."""

    def test_non_dev_services_includes_cookpilot(self):
        # Read the server source directly to avoid importing the entire module
        with open("/app/backend/server.py", "r", encoding="utf-8") as f:
            src = f.read()
        # The literal set must contain "cookpilot"
        assert 'NON_DEV_SERVICES = {"casedesk"' in src
        # Find the NON_DEV_SERVICES line and ensure cookpilot is in it
        for line in src.splitlines():
            if line.strip().startswith("NON_DEV_SERVICES ="):
                assert '"cookpilot"' in line, (
                    f"cookpilot missing from NON_DEV_SERVICES: {line}"
                )
                return
        pytest.fail("NON_DEV_SERVICES definition not found in server.py")


# ==================== Sticky-ForgePilot break via monkey-patched router ====================

class TestStickyBreakCookpilotMonkeyPatch:
    """Monkey-patch service_router.route_message + cookpilot.is_available so
    the router 'returns' cookpilot for a German cooking prompt, then call
    process_chat_message directly and verify forgepilot delegation is NOT
    triggered (sticky-break works)."""

    @pytest.mark.asyncio
    async def test_cookpilot_route_breaks_forgepilot_sticky(
        self, monkeypatch, mongo_db, admin_user_id
    ):
        import service_router
        import cookpilot as cp
        import server as srv

        session_id = f"TEST_sticky_cp_{uuid.uuid4().hex[:8]}"

        # Seed sticky forgepilot state
        from datetime import datetime, timezone
        mongo_db.chat_messages.insert_one({
            "session_id": session_id,
            "user_id": admin_user_id,
            "role": "assistant",
            "content": "Ich arbeite an deinem Projekt …",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "routed_to": ["forgepilot"],
            "forgepilot_meta": {
                "ask_user": False, "is_complete": False,
                "still_running": True, "project_id": "test-project",
            },
        })

        async def fake_available():
            return True

        async def fake_route(_msg):
            return {"services": ["cookpilot"], "is_simple": False}

        async def fake_query(_msg, _sess, _uid):
            # Sentinel: if delegation triggers, this writes a marker doc
            mongo_db.chat_messages.insert_one({
                "session_id": session_id,
                "user_id": admin_user_id,
                "role": "assistant",
                "content": "FORGEPILOT_DELEGATION_FIRED",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "routed_to": ["forgepilot"],
            })
            return {"answer": "x", "ask_user": False, "is_complete": True,
                    "still_running": False, "project_id": None}

        async def fake_friendly(_res, _msg):
            return "x"

        async def fake_key():
            return "sk-test-fake"

        monkeypatch.setattr(cp, "is_available", fake_available)
        monkeypatch.setattr(service_router, "route_message", fake_route)
        monkeypatch.setattr(srv.forgepilot, "query_forgepilot", fake_query)
        monkeypatch.setattr(srv.forgepilot, "friendly_rephrase", fake_friendly)
        monkeypatch.setattr(srv, "get_llm_api_key", fake_key)

        try:
            await srv.process_chat_message(
                "Was kann ich heute kochen?", admin_user_id, session_id
            )

            # Delegation-sentinel must NOT be present (sticky was broken by cookpilot)
            sentinel = mongo_db.chat_messages.find_one(
                {"session_id": session_id, "content": "FORGEPILOT_DELEGATION_FIRED"}
            )
            assert sentinel is None, (
                "Sticky-ForgePilot hijacked cooking question — delegation fired "
                "despite router returning ['cookpilot']."
            )
        finally:
            mongo_db.chat_messages.delete_many({"session_id": session_id})
            mongo_db.chat_route_log.delete_many({"session_id": session_id})
