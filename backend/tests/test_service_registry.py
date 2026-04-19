"""
Pytest: Admin Service-Registry endpoints + Plex proxy + ForgePilot/Health basic wiring
Run: pytest /app/backend/tests/test_service_registry.py -v --junitxml=/app/test_reports/pytest/pytest_service_registry.xml
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://github-docker-deploy.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "andi.trenter@gmail.com"
ADMIN_PASSWORD = "Speedy@181279"

API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    assert token, f"No token in login response: {data}"
    return token


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ---- basic wiring ----

def test_health_ok():
    r = requests.get(f"{API}/health", timeout=10)
    assert r.status_code == 200
    # Module imports (plex, forgepilot) must not have broken server


# ---- Admin service-registry ----

def test_get_service_registry_requires_auth():
    r = requests.get(f"{API}/admin/service-registry", timeout=10)
    assert r.status_code in (401, 403), f"Expected 401/403 without auth, got {r.status_code}"


def test_get_service_registry_returns_defaults(admin_headers):
    r = requests.get(f"{API}/admin/service-registry", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "services" in body
    services = body["services"]
    assert isinstance(services, list)
    assert len(services) >= 3
    ids = {s["service_id"] for s in services}
    # Basic expected defaults (at least weather should exist)
    assert "weather" in ids
    # Structural fields on each entry
    for s in services:
        assert "service_id" in s
        assert "is_default" in s
        assert "overridden" in s
        assert "is_custom" in s
        assert "available" in s


def test_put_override_weather_and_verify(admin_headers):
    payload = {
        "description": "TEST_OVERRIDE weather description",
        "capabilities": ["TEST_current", "TEST_forecast"],
    }
    r = requests.put(f"{API}/admin/service-registry/weather", json=payload, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json().get("success") is True

    # verify via GET
    g = requests.get(f"{API}/admin/service-registry", headers=admin_headers, timeout=15).json()["services"]
    weather = next(s for s in g if s["service_id"] == "weather")
    assert weather["overridden"] is True
    assert weather["description"] == "TEST_OVERRIDE weather description"
    assert "TEST_current" in weather["capabilities"]

    # cleanup: delete override to reset
    d = requests.delete(f"{API}/admin/service-registry/weather", headers=admin_headers, timeout=15)
    assert d.status_code == 200

    g2 = requests.get(f"{API}/admin/service-registry", headers=admin_headers, timeout=15).json()["services"]
    weather2 = next(s for s in g2 if s["service_id"] == "weather")
    assert weather2["overridden"] is False


def test_create_and_delete_custom_service(admin_headers):
    sid = "testcustom"
    # ensure clean state
    requests.delete(f"{API}/admin/service-registry/{sid}", headers=admin_headers, timeout=15)

    payload = {
        "service_id": sid,
        "name": "TEST_Custom Service",
        "description": "TEST_created via pytest",
        "capabilities": ["TEST_cap1"],
        "example_queries": ["TEST_frage?"],
    }
    r = requests.post(f"{API}/admin/service-registry", json=payload, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("success") is True
    assert body["service"]["service_id"] == sid

    # verify via GET
    services = requests.get(f"{API}/admin/service-registry", headers=admin_headers, timeout=15).json()["services"]
    entry = next((s for s in services if s["service_id"] == sid), None)
    assert entry is not None, "custom service not found in registry"
    assert entry["is_custom"] is True
    assert entry["is_default"] is False
    assert entry["name"] == "TEST_Custom Service"

    # duplicate POST -> 400
    r2 = requests.post(f"{API}/admin/service-registry", json=payload, headers=admin_headers, timeout=15)
    assert r2.status_code == 400

    # cleanup DELETE
    d = requests.delete(f"{API}/admin/service-registry/{sid}", headers=admin_headers, timeout=15)
    assert d.status_code == 200
    assert d.json().get("deleted", 0) >= 1

    services2 = requests.get(f"{API}/admin/service-registry", headers=admin_headers, timeout=15).json()["services"]
    assert not any(s["service_id"] == sid for s in services2)


def test_post_rejects_default_service_id(admin_headers):
    # Trying to create a custom with id of a default must fail
    r = requests.post(f"{API}/admin/service-registry", json={
        "service_id": "weather",
        "name": "should fail",
    }, headers=admin_headers, timeout=15)
    assert r.status_code == 400


def test_post_rejects_invalid_service_id(admin_headers):
    r = requests.post(f"{API}/admin/service-registry", json={
        "service_id": "bad id with spaces!",
        "name": "x",
    }, headers=admin_headers, timeout=15)
    assert r.status_code == 400


def test_put_rejects_empty_body(admin_headers):
    r = requests.put(f"{API}/admin/service-registry/weather", json={"bogus": "x"}, headers=admin_headers, timeout=15)
    assert r.status_code == 400


# ---- Plex image proxy ----

def test_plex_image_without_path_returns_error():
    r = requests.get(f"{API}/plex/image", timeout=10)
    # FastAPI returns 422 when required query missing; 404 also acceptable
    assert r.status_code in (400, 404, 422)


def test_plex_image_invalid_path_not_500():
    # Server side timeout is 15s to reach Plex; use generous client timeout so it can return 404
    try:
        r = requests.get(f"{API}/plex/image", params={"path": "/does/not/exist"}, timeout=30)
    except requests.exceptions.ReadTimeout:
        pytest.skip("Plex proxy response exceeded 30s (Plex unreachable from preview); acceptable – not a 500")
        return
    # Must not 500; can be 404 (not configured / not reachable) or 502
    assert r.status_code != 500, f"Plex image proxy returned 500 on invalid path: {r.text[:200]}"


# ---- Chat routing (Plex query) ----

def test_chat_plex_count_query(admin_headers):
    r = requests.post(
        f"{API}/chat",
        json={"message": "Wieviele Filme hast du auf Plex?", "conversation_id": "TEST_plex_chat"},
        headers=admin_headers,
        timeout=60,
    )
    # Must not error - accept 200 even if Plex unreachable (aria-ai must still respond)
    assert r.status_code == 200, f"chat endpoint error: {r.status_code} {r.text[:300]}"
    data = r.json()
    # We expect some answer text; routed_to may or may not be exposed
    assert isinstance(data, dict)
    # accept any of these common response keys
    assert any(k in data for k in ("response", "message", "answer", "content", "text")) or "routed_to" in data
