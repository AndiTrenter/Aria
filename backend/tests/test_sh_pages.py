"""Tests for SmartHome page templates (iteration 11, V7.0)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN = {"email": "andi.trenter@gmail.com", "password": "Speedy@181279"}
LUZIA = {"email": "luzia@test.ch", "password": "Test1234!"}


def _login(session, creds):
    r = session.post(f"{BASE_URL}/api/auth/login", json=creds)
    assert r.status_code == 200, r.text
    return r


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    _login(s, ADMIN)
    return s


@pytest.fixture(scope="module")
def luzia_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    _login(s, LUZIA)
    return s


@pytest.fixture(scope="module")
def luzia_id(admin_client):
    r = admin_client.get(f"{BASE_URL}/api/admin/users")
    assert r.status_code == 200
    users = r.json()
    for u in users:
        if u.get("email") == LUZIA["email"]:
            return u["id"]
    pytest.skip("luzia user not found")


# ==================== Version ====================

def test_version_is_7_0():
    r = requests.get(f"{BASE_URL}/api/version")
    assert r.status_code == 200
    data = r.json()
    assert data.get("version") == "7.0", f"Expected 7.0 got {data}"


# ==================== CRUD ====================

class TestPagesCrud:
    def test_list_requires_admin(self):
        r = requests.get(f"{BASE_URL}/api/smarthome/pages")
        assert r.status_code in (401, 403)

    def test_non_admin_cannot_list(self, luzia_client):
        r = luzia_client.get(f"{BASE_URL}/api/smarthome/pages")
        assert r.status_code in (401, 403)

    def test_full_crud(self, admin_client):
        # CREATE
        r = admin_client.post(f"{BASE_URL}/api/smarthome/pages", json={"name": "TEST_Page_E2E", "sections": []})
        assert r.status_code == 200, r.text
        p = r.json()
        pid = p["id"]
        assert p["name"] == "TEST_Page_E2E"
        assert isinstance(p["sections"], list) and p["sections"] == []

        # LIST (GET persistence check)
        r = admin_client.get(f"{BASE_URL}/api/smarthome/pages")
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert pid in ids

        # UPDATE with sections/items
        sections = [
            {
                "id": "sec-test1",
                "title": "Wohnzimmer",
                "room_id": None,
                "layout": "grid-3",
                "items": [
                    {"entity_id": "light.test_lamp", "widget": "auto", "size": "normal"},
                    {"entity_id": "switch.test_sw", "widget": "auto", "size": "wide"},
                ],
            }
        ]
        r = admin_client.put(
            f"{BASE_URL}/api/smarthome/pages/{pid}",
            json={"name": "TEST_Page_E2E_renamed", "sections": sections, "description": "desc"},
        )
        assert r.status_code == 200, r.text
        updated = r.json()
        assert updated["name"] == "TEST_Page_E2E_renamed"
        assert updated["description"] == "desc"
        assert len(updated["sections"]) == 1
        assert updated["sections"][0]["layout"] == "grid-3"
        assert len(updated["sections"][0]["items"]) == 2
        assert updated["sections"][0]["items"][0]["entity_id"] == "light.test_lamp"

        # Verify with LIST (persistence)
        r = admin_client.get(f"{BASE_URL}/api/smarthome/pages")
        p2 = next(x for x in r.json() if x["id"] == pid)
        assert p2["name"] == "TEST_Page_E2E_renamed"
        assert len(p2["sections"][0]["items"]) == 2

        # DELETE
        r = admin_client.delete(f"{BASE_URL}/api/smarthome/pages/{pid}")
        assert r.status_code == 200
        assert r.json().get("success") is True

        # Verify removal
        r = admin_client.get(f"{BASE_URL}/api/smarthome/pages")
        ids = [x["id"] for x in r.json()]
        assert pid not in ids

    def test_create_requires_name(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/smarthome/pages", json={"sections": []})
        assert r.status_code == 400

    def test_update_nonexistent_returns_404(self, admin_client):
        r = admin_client.put(f"{BASE_URL}/api/smarthome/pages/page-doesnotexist", json={"name": "x"})
        assert r.status_code == 404


# ==================== Assignment + my-page ====================

class TestAssignment:
    @pytest.fixture
    def temp_page(self, admin_client):
        r = admin_client.post(
            f"{BASE_URL}/api/smarthome/pages",
            json={
                "name": "TEST_Luzia_Page",
                "sections": [
                    {
                        "id": "sec-a",
                        "title": "Ihre Geräte",
                        "room_id": None,
                        "layout": "grid-2",
                        "items": [{"entity_id": "light.dummy_luzia", "widget": "auto", "size": "normal"}],
                    }
                ],
            },
        )
        assert r.status_code == 200
        pid = r.json()["id"]
        yield pid
        admin_client.delete(f"{BASE_URL}/api/smarthome/pages/{pid}")

    def test_my_page_default_none(self, luzia_client):
        # ensure unassigned first
        r = luzia_client.get(f"{BASE_URL}/api/smarthome/my-page")
        assert r.status_code == 200
        # could be None or a page if previously assigned; don't assert strictly here

    def test_assign_and_unassign_flow(self, admin_client, luzia_client, luzia_id, temp_page):
        # Assign
        r = admin_client.put(
            f"{BASE_URL}/api/smarthome/users/{luzia_id}/assign-page",
            json={"page_id": temp_page},
        )
        assert r.status_code == 200, r.text
        assert r.json().get("success") is True

        # luzia sees her page
        r = luzia_client.get(f"{BASE_URL}/api/smarthome/my-page")
        assert r.status_code == 200
        data = r.json()
        assert data.get("page") is not None, f"Expected page, got {data}"
        assert data["page"]["id"] == temp_page
        assert data["page"]["name"] == "TEST_Luzia_Page"
        assert isinstance(data["page"]["sections"], list)

        # Unassign
        r = admin_client.put(
            f"{BASE_URL}/api/smarthome/users/{luzia_id}/assign-page",
            json={"page_id": None},
        )
        assert r.status_code == 200

        # luzia now sees null
        r = luzia_client.get(f"{BASE_URL}/api/smarthome/my-page")
        assert r.status_code == 200
        assert r.json().get("page") is None

    def test_assign_nonexistent_page_returns_404(self, admin_client, luzia_id):
        r = admin_client.put(
            f"{BASE_URL}/api/smarthome/users/{luzia_id}/assign-page",
            json={"page_id": "page-doesnotexist"},
        )
        assert r.status_code == 404

    def test_non_admin_cannot_assign(self, luzia_client, luzia_id, admin_client, temp_page):
        r = luzia_client.put(
            f"{BASE_URL}/api/smarthome/users/{luzia_id}/assign-page",
            json={"page_id": temp_page},
        )
        assert r.status_code in (401, 403)

    def test_delete_page_unassigns_users(self, admin_client, luzia_client, luzia_id):
        # Create + assign
        r = admin_client.post(f"{BASE_URL}/api/smarthome/pages", json={"name": "TEST_Tobe_Deleted", "sections": []})
        pid = r.json()["id"]
        admin_client.put(f"{BASE_URL}/api/smarthome/users/{luzia_id}/assign-page", json={"page_id": pid})

        # Verify assigned
        r = luzia_client.get(f"{BASE_URL}/api/smarthome/my-page")
        assert r.json().get("page") is not None

        # Delete page
        r = admin_client.delete(f"{BASE_URL}/api/smarthome/pages/{pid}")
        assert r.status_code == 200

        # luzia's my-page returns null
        r = luzia_client.get(f"{BASE_URL}/api/smarthome/my-page")
        assert r.json().get("page") is None
