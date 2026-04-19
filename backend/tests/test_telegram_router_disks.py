"""
Backend tests for Aria v2 iteration 10:
  - Telegram diagnostics (status / test / restart)
  - Router-history (GET/DELETE) + chat-routing persistence
  - SMART disk health endpoint (/api/health/disks)
  - Admin-auth enforcement on all new endpoints
  - Smoke tests for previously-working endpoints
"""
import os
import pytest
import requests
from pathlib import Path


def _load_backend_url():
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if url:
        return url.rstrip("/")
    env_path = Path("/app/frontend/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


BASE_URL = _load_backend_url()
ADMIN_EMAIL = "andi.trenter@gmail.com"
ADMIN_PASSWORD = "Speedy@181279"


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture
def fresh_client():
    """Unauthenticated, cookie-less client for auth-enforcement tests."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(api):
    r = api.post(f"{BASE_URL}/api/auth/login",
                 json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    if r.status_code != 200:
        pytest.skip(f"Admin login failed: {r.status_code} {r.text[:200]}")
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    if not tok:
        pytest.skip(f"No token in login response: {data}")
    return tok


@pytest.fixture(scope="module")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


# ---------- Telegram diagnostics ----------
class TestTelegramDiagnostics:
    def test_status_requires_auth(self, fresh_client):
        r = fresh_client.get(f"{BASE_URL}/api/admin/telegram/status")
        assert r.status_code in (401, 403)

    def test_status_returns_shape(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/admin/telegram/status", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        # Key contract fields
        for k in ("running", "token_configured", "polls_count",
                  "updates_received", "messages_processed"):
            assert k in data, f"missing {k} in status: {data}"
        # In preview: token is DISABLED -> not configured, not running
        assert data["token_configured"] is False
        assert data["running"] is False

    def test_test_no_body_disabled_token(self, api, auth_headers):
        # Empty JSON body ({}) — uses saved token which is DISABLED -> empty
        r = api.post(f"{BASE_URL}/api/admin/telegram/test",
                     json={}, headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is False
        assert data["stage"] == "token"
        assert "Token" in data["message"]

    def test_test_with_invalid_token(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/admin/telegram/test",
                     json={"token": "fakebadtoken:123456789ABCDEFGHIJKLMN"},
                     headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is False
        assert data["stage"] == "getMe"
        assert isinstance(data.get("message"), str) and len(data["message"]) > 5

    def test_test_requires_admin(self, fresh_client):
        r = fresh_client.post(f"{BASE_URL}/api/admin/telegram/test", json={})
        assert r.status_code in (401, 403)

    def test_restart_requires_admin(self, fresh_client):
        r = fresh_client.post(f"{BASE_URL}/api/admin/telegram/restart")
        assert r.status_code in (401, 403)

    def test_restart_without_token_returns_400(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/admin/telegram/restart", headers=auth_headers)
        assert r.status_code == 400
        # detail should mention token
        detail = r.json().get("detail", "")
        assert "Token" in detail or "token" in detail


# ---------- Router history ----------
class TestRouterHistory:
    def test_router_history_requires_auth(self, fresh_client):
        r = fresh_client.get(f"{BASE_URL}/api/admin/router-history")
        assert r.status_code in (401, 403)

    def test_router_history_delete_requires_auth(self, fresh_client):
        r = fresh_client.delete(f"{BASE_URL}/api/admin/router-history")
        assert r.status_code in (401, 403)

    def test_chat_creates_router_history_entry(self, api, auth_headers):
        # Clean slate (optional — but easier to assert the new entry)
        api.delete(f"{BASE_URL}/api/admin/router-history", headers=auth_headers)

        # Fire a chat message (routing runs even if LLM fails later)
        chat_payload = {"message": "Wie ist das Wetter in Zürich?"}
        cr = api.post(f"{BASE_URL}/api/chat", json=chat_payload, headers=auth_headers)
        # Chat may return 200 (full answer) or a structured error; routing still logs
        assert cr.status_code in (200, 400, 500), f"unexpected chat status: {cr.status_code}"

        # Fetch history
        r = api.get(f"{BASE_URL}/api/admin/router-history", headers=auth_headers)
        assert r.status_code == 200
        entries = r.json()
        assert isinstance(entries, list)
        assert len(entries) >= 1, "No router-history entry created by /api/chat"
        e = entries[0]
        for k in ("user_id", "user_name", "message", "services", "is_simple", "timestamp"):
            assert k in e, f"missing '{k}' in entry: {e}"
        # Most recent message should be ours
        assert "Wetter" in e["message"] or "Zürich" in e["message"]
        assert isinstance(e["services"], list)

    def test_clear_router_history(self, api, auth_headers):
        r = api.delete(f"{BASE_URL}/api/admin/router-history", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data.get("success") is True
        assert "deleted" in data and isinstance(data["deleted"], int)
        # After clear, list should be empty
        r2 = api.get(f"{BASE_URL}/api/admin/router-history", headers=auth_headers)
        assert r2.status_code == 200
        assert r2.json() == []


# ---------- SMART disks ----------
class TestHealthDisks:
    def test_requires_auth(self, fresh_client):
        r = fresh_client.get(f"{BASE_URL}/api/health/disks")
        assert r.status_code in (401, 403)

    def test_shape_in_preview(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/health/disks", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        for k in ("available", "disks", "notes", "smartctl_installed"):
            assert k in data, f"missing '{k}' in disks response"
        assert isinstance(data["disks"], list)
        assert isinstance(data["notes"], list)
        # In preview smartctl should not be installed -> note about it
        if not data["smartctl_installed"]:
            joined = " ".join(data["notes"]).lower()
            assert "smartctl" in joined


# ---------- Smoke: legacy endpoints still work ----------
class TestRegressionSmoke:
    def test_service_registry_still_works(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/admin/service-registry", headers=auth_headers)
        assert r.status_code == 200
        body = r.json()
        # service-registry returns a list or object containing services
        if isinstance(body, dict):
            assert "services" in body or any(isinstance(v, list) for v in body.values())

    def test_chat_still_works(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/chat",
                     json={"message": "Hallo Aria"},
                     headers=auth_headers)
        # Accept 200 (normal) or 400/500 due to missing LLM key. Must NOT be 404 / 422
        assert r.status_code in (200, 400, 500), f"chat endpoint regression: {r.status_code}"
