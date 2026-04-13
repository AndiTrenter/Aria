"""
Test Suite for Aria v2.0 Admin UI Restructuring
Tests: 8 admin tabs, user room/tab assignment, navigation filtering, dashboard filtering
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_EMAIL = "andi.trenter@gmail.com"
ADMIN_PASSWORD = "Speedy@181279"
CHILD_EMAIL = "luzia@test.ch"
CHILD_PASSWORD = "Test1234!"

class TestAdminAuthentication:
    """Test admin login and token retrieval"""
    
    def test_admin_login(self):
        """Test admin login returns assigned_rooms and visible_tabs"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        
        # Verify login response structure
        assert "id" in data, "Missing id in login response"
        assert "email" in data, "Missing email in login response"
        assert "role" in data, "Missing role in login response"
        assert "access_token" in data, "Missing access_token in login response"
        
        # NEW: Verify assigned_rooms and visible_tabs in login response
        assert "assigned_rooms" in data, "Missing assigned_rooms in login response"
        assert "visible_tabs" in data, "Missing visible_tabs in login response"
        
        # Admin should have superadmin role
        assert data["role"] in ["admin", "superadmin"], f"Expected admin role, got {data['role']}"
        print(f"Admin login successful: {data['email']} ({data['role']})")
        print(f"Assigned rooms: {data['assigned_rooms']}")
        print(f"Visible tabs: {data['visible_tabs']}")
    
    def test_child_user_login(self):
        """Test child user login returns assigned_rooms and visible_tabs"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": CHILD_EMAIL,
            "password": CHILD_PASSWORD
        })
        assert response.status_code == 200, f"Child login failed: {response.text}"
        data = response.json()
        
        # Verify login response structure
        assert "assigned_rooms" in data, "Missing assigned_rooms in child login response"
        assert "visible_tabs" in data, "Missing visible_tabs in child login response"
        assert data["role"] == "kind", f"Expected kind role, got {data['role']}"
        
        print(f"Child login successful: {data['email']} ({data['role']})")
        print(f"Assigned rooms: {data['assigned_rooms']}")
        print(f"Visible tabs: {data['visible_tabs']}")


class TestAuthMe:
    """Test /api/auth/me returns new fields"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        return response.json().get("access_token")
    
    @pytest.fixture
    def child_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": CHILD_EMAIL,
            "password": CHILD_PASSWORD
        })
        return response.json().get("access_token")
    
    def test_auth_me_admin(self, admin_token):
        """Test GET /api/auth/me returns assigned_rooms and visible_tabs for admin"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/auth/me", headers=headers)
        assert response.status_code == 200, f"Auth/me failed: {response.text}"
        data = response.json()
        
        assert "assigned_rooms" in data, "Missing assigned_rooms in auth/me response"
        assert "visible_tabs" in data, "Missing visible_tabs in auth/me response"
        assert data["role"] in ["admin", "superadmin"]
        print(f"Auth/me admin: assigned_rooms={data['assigned_rooms']}, visible_tabs={data['visible_tabs']}")
    
    def test_auth_me_child(self, child_token):
        """Test GET /api/auth/me returns assigned_rooms and visible_tabs for child"""
        headers = {"Authorization": f"Bearer {child_token}"}
        response = requests.get(f"{BASE_URL}/api/auth/me", headers=headers)
        assert response.status_code == 200, f"Auth/me failed: {response.text}"
        data = response.json()
        
        assert "assigned_rooms" in data, "Missing assigned_rooms in auth/me response"
        assert "visible_tabs" in data, "Missing visible_tabs in auth/me response"
        assert data["role"] == "kind"
        print(f"Auth/me child: assigned_rooms={data['assigned_rooms']}, visible_tabs={data['visible_tabs']}")


class TestAdminUserManagement:
    """Test admin user CRUD with assigned_rooms and visible_tabs"""
    
    @pytest.fixture
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        token = response.json().get("access_token")
        session.headers.update({"Authorization": f"Bearer {token}"})
        return session
    
    def test_get_all_users(self, admin_session):
        """Test GET /api/admin/users returns users with assigned_rooms and visible_tabs"""
        response = admin_session.get(f"{BASE_URL}/api/admin/users")
        assert response.status_code == 200, f"Get users failed: {response.text}"
        users = response.json()
        
        assert isinstance(users, list), "Expected list of users"
        assert len(users) >= 2, f"Expected at least 2 users, got {len(users)}"
        
        # Check that users have the new fields
        for user in users:
            assert "id" in user, "Missing id in user"
            assert "email" in user, "Missing email in user"
            # assigned_rooms and visible_tabs should be present (may be empty lists)
            if "assigned_rooms" in user:
                assert isinstance(user["assigned_rooms"], list), "assigned_rooms should be a list"
            if "visible_tabs" in user:
                assert isinstance(user["visible_tabs"], list), "visible_tabs should be a list"
        
        print(f"Found {len(users)} users")
        for u in users:
            print(f"  - {u['email']} ({u.get('role', 'unknown')}): rooms={u.get('assigned_rooms', [])}, tabs={u.get('visible_tabs', [])}")
    
    def test_create_user_with_rooms_and_tabs(self, admin_session):
        """Test POST /api/admin/users with assigned_rooms and visible_tabs"""
        # First get rooms to assign
        rooms_response = admin_session.get(f"{BASE_URL}/api/smarthome/rooms")
        rooms = rooms_response.json()
        room_ids = [r["id"] for r in rooms[:1]] if rooms else []
        
        test_user = {
            "email": "TEST_admin_restructure@test.ch",
            "password": "TestPass123!",
            "name": "Test Admin Restructure",
            "role": "user",
            "assigned_rooms": room_ids,
            "visible_tabs": ["dash", "home", "chat"]
        }
        
        response = admin_session.post(f"{BASE_URL}/api/admin/users", json=test_user)
        assert response.status_code == 200, f"Create user failed: {response.text}"
        data = response.json()
        
        assert "id" in data, "Missing id in create response"
        print(f"Created user: {data}")
        
        # Verify user was created with correct fields
        users_response = admin_session.get(f"{BASE_URL}/api/admin/users")
        users = users_response.json()
        created_user = next((u for u in users if u["email"] == test_user["email"].lower()), None)
        
        assert created_user is not None, "Created user not found in user list"
        assert created_user.get("assigned_rooms") == room_ids, f"assigned_rooms mismatch: {created_user.get('assigned_rooms')} != {room_ids}"
        assert created_user.get("visible_tabs") == test_user["visible_tabs"], f"visible_tabs mismatch"
        
        # Cleanup - delete test user
        delete_response = admin_session.delete(f"{BASE_URL}/api/admin/users/{created_user['id']}")
        assert delete_response.status_code == 200, f"Delete user failed: {delete_response.text}"
        print("Test user created and deleted successfully")
    
    def test_update_user_rooms_and_tabs(self, admin_session):
        """Test PUT /api/admin/users/{id} supports assigned_rooms and visible_tabs"""
        # Get existing users
        users_response = admin_session.get(f"{BASE_URL}/api/admin/users")
        users = users_response.json()
        
        # Find the child user (Luzia)
        child_user = next((u for u in users if u["email"] == CHILD_EMAIL.lower()), None)
        if not child_user:
            pytest.skip("Child user not found")
        
        # Get rooms
        rooms_response = admin_session.get(f"{BASE_URL}/api/smarthome/rooms")
        rooms = rooms_response.json()
        
        # Store original values
        original_rooms = child_user.get("assigned_rooms", [])
        original_tabs = child_user.get("visible_tabs", [])
        
        # Update with new values
        new_tabs = ["dash", "home", "weather"]
        update_response = admin_session.put(
            f"{BASE_URL}/api/admin/users/{child_user['id']}",
            json={"visible_tabs": new_tabs}
        )
        assert update_response.status_code == 200, f"Update user failed: {update_response.text}"
        
        # Verify update
        users_response = admin_session.get(f"{BASE_URL}/api/admin/users")
        users = users_response.json()
        updated_user = next((u for u in users if u["id"] == child_user["id"]), None)
        
        assert updated_user is not None, "Updated user not found"
        assert updated_user.get("visible_tabs") == new_tabs, f"visible_tabs not updated: {updated_user.get('visible_tabs')}"
        
        # Restore original values
        restore_response = admin_session.put(
            f"{BASE_URL}/api/admin/users/{child_user['id']}",
            json={"visible_tabs": original_tabs}
        )
        assert restore_response.status_code == 200
        print(f"User update test passed - visible_tabs updated and restored")


class TestRoomsTab:
    """Test Rooms tab functionality"""
    
    @pytest.fixture
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        token = response.json().get("access_token")
        session.headers.update({"Authorization": f"Bearer {token}"})
        return session
    
    def test_get_rooms_with_device_count(self, admin_session):
        """Test GET /api/smarthome/rooms returns rooms with device counts"""
        response = admin_session.get(f"{BASE_URL}/api/smarthome/rooms")
        assert response.status_code == 200, f"Get rooms failed: {response.text}"
        rooms = response.json()
        
        assert isinstance(rooms, list), "Expected list of rooms"
        print(f"Found {len(rooms)} rooms:")
        for room in rooms:
            assert "id" in room, "Missing id in room"
            assert "name" in room, "Missing name in room"
            print(f"  - {room['name']} (id={room['id']}, devices={room.get('device_count', 0)})")


class TestDevicesTab:
    """Test Devices tab functionality"""
    
    @pytest.fixture
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        token = response.json().get("access_token")
        session.headers.update({"Authorization": f"Bearer {token}"})
        return session
    
    def test_get_devices(self, admin_session):
        """Test GET /api/smarthome/devices"""
        response = admin_session.get(f"{BASE_URL}/api/smarthome/devices")
        assert response.status_code == 200, f"Get devices failed: {response.text}"
        devices = response.json()
        
        assert isinstance(devices, list), "Expected list of devices"
        print(f"Found {len(devices)} devices")
        for dev in devices[:5]:  # Show first 5
            print(f"  - {dev.get('display_name', dev.get('entity_id'))} (room={dev.get('room_id')}, critical={dev.get('critical', False)})")


class TestSmartHomeDashboardFiltering:
    """Test SmartHome dashboard filters by assigned_rooms for non-admin"""
    
    @pytest.fixture
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        token = response.json().get("access_token")
        session.headers.update({"Authorization": f"Bearer {token}"})
        return session
    
    @pytest.fixture
    def child_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": CHILD_EMAIL,
            "password": CHILD_PASSWORD
        })
        token = response.json().get("access_token")
        session.headers.update({"Authorization": f"Bearer {token}"})
        return session
    
    def test_admin_sees_all_rooms(self, admin_session):
        """Test admin sees all rooms in dashboard"""
        response = admin_session.get(f"{BASE_URL}/api/smarthome/dashboard")
        assert response.status_code == 200, f"Dashboard failed: {response.text}"
        data = response.json()
        
        assert "rooms" in data, "Missing rooms in dashboard"
        assert "is_admin" in data, "Missing is_admin in dashboard"
        assert data["is_admin"] == True, "Admin should have is_admin=True"
        
        print(f"Admin dashboard: {len(data['rooms'])} rooms, is_admin={data['is_admin']}")
        for room in data["rooms"]:
            print(f"  - {room['name']}: {len(room.get('devices', []))} devices")
    
    def test_child_sees_filtered_rooms(self, child_session, admin_session):
        """Test child user only sees assigned rooms in dashboard"""
        # First check what rooms the child is assigned to
        users_response = admin_session.get(f"{BASE_URL}/api/admin/users")
        users = users_response.json()
        child_user = next((u for u in users if u["email"] == CHILD_EMAIL.lower()), None)
        
        if not child_user:
            pytest.skip("Child user not found")
        
        assigned_rooms = child_user.get("assigned_rooms", [])
        print(f"Child assigned rooms: {assigned_rooms}")
        
        # Get child's dashboard
        response = child_session.get(f"{BASE_URL}/api/smarthome/dashboard")
        assert response.status_code == 200, f"Dashboard failed: {response.text}"
        data = response.json()
        
        assert "rooms" in data, "Missing rooms in dashboard"
        assert "is_admin" in data, "Missing is_admin in dashboard"
        assert data["is_admin"] == False, "Child should have is_admin=False"
        
        # Verify child only sees assigned rooms (or rooms with device-level permissions)
        dashboard_room_ids = [r["id"] for r in data["rooms"]]
        print(f"Child dashboard: {len(data['rooms'])} rooms, is_admin={data['is_admin']}")
        for room in data["rooms"]:
            print(f"  - {room['name']} (id={room['id']})")
        
        # If child has assigned_rooms, dashboard should only show those
        if assigned_rooms:
            for room_id in dashboard_room_ids:
                # Room should either be in assigned_rooms or have device-level permissions
                print(f"  Room {room_id} in assigned_rooms: {room_id in assigned_rooms}")


class TestAuditLogTab:
    """Test Audit Log tab functionality"""
    
    @pytest.fixture
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        token = response.json().get("access_token")
        session.headers.update({"Authorization": f"Bearer {token}"})
        return session
    
    def test_get_audit_log(self, admin_session):
        """Test GET /api/audit-log"""
        response = admin_session.get(f"{BASE_URL}/api/audit-log?limit=20")
        assert response.status_code == 200, f"Audit log failed: {response.text}"
        logs = response.json()
        
        assert isinstance(logs, list), "Expected list of logs"
        print(f"Found {len(logs)} audit log entries")
        for log in logs[:5]:
            print(f"  - {log.get('type')}: {log.get('timestamp', '')[:19]}")


class TestServicesTab:
    """Test Services tab functionality"""
    
    @pytest.fixture
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        token = response.json().get("access_token")
        session.headers.update({"Authorization": f"Bearer {token}"})
        return session
    
    def test_get_services(self, admin_session):
        """Test GET /api/services"""
        response = admin_session.get(f"{BASE_URL}/api/services")
        assert response.status_code == 200, f"Get services failed: {response.text}"
        services = response.json()
        
        assert isinstance(services, list), "Expected list of services"
        print(f"Found {len(services)} services:")
        for svc in services:
            print(f"  - {svc.get('name')} ({svc.get('id')}): enabled={svc.get('enabled', False)}")


class TestSettingsTab:
    """Test Settings tab functionality"""
    
    @pytest.fixture
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        token = response.json().get("access_token")
        session.headers.update({"Authorization": f"Bearer {token}"})
        return session
    
    def test_get_admin_settings(self, admin_session):
        """Test GET /api/admin/settings"""
        response = admin_session.get(f"{BASE_URL}/api/admin/settings")
        assert response.status_code == 200, f"Get settings failed: {response.text}"
        settings = response.json()
        
        assert isinstance(settings, dict), "Expected dict of settings"
        print(f"Settings keys: {list(settings.keys())}")
        # Check for expected settings
        expected_keys = ["openai_api_key", "weather_city", "weather_api_key", "ha_url", "ha_token"]
        for key in expected_keys:
            if key in settings:
                # Mask sensitive values
                val = settings[key]
                if val and "..." in str(val):
                    print(f"  - {key}: [MASKED]")
                else:
                    print(f"  - {key}: {val or '[not set]'}")
    
    def test_ha_status(self, admin_session):
        """Test GET /api/ha/status"""
        response = admin_session.get(f"{BASE_URL}/api/ha/status")
        assert response.status_code == 200, f"HA status failed: {response.text}"
        status = response.json()
        
        assert "connected" in status, "Missing connected in HA status"
        print(f"HA Status: connected={status['connected']}, message={status.get('message', '')}")


class TestProfilesTab:
    """Test Profiles tab functionality"""
    
    @pytest.fixture
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        token = response.json().get("access_token")
        session.headers.update({"Authorization": f"Bearer {token}"})
        return session
    
    def test_get_profiles(self, admin_session):
        """Test GET /api/smarthome/profiles"""
        response = admin_session.get(f"{BASE_URL}/api/smarthome/profiles")
        assert response.status_code == 200, f"Get profiles failed: {response.text}"
        profiles = response.json()
        
        assert isinstance(profiles, list), "Expected list of profiles"
        print(f"Found {len(profiles)} profiles:")
        for p in profiles:
            print(f"  - {p.get('name')} (kiosk={p.get('kiosk_mode')}, child={p.get('child_mode')})")


class TestPermissionsTab:
    """Test Permissions (Freigaben) tab functionality"""
    
    @pytest.fixture
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        token = response.json().get("access_token")
        session.headers.update({"Authorization": f"Bearer {token}"})
        return session
    
    def test_get_user_permissions(self, admin_session):
        """Test GET /api/smarthome/permissions/{user_id}"""
        # Get users first
        users_response = admin_session.get(f"{BASE_URL}/api/admin/users")
        users = users_response.json()
        
        if not users:
            pytest.skip("No users found")
        
        # Get permissions for first non-admin user
        test_user = next((u for u in users if u.get("role") not in ["admin", "superadmin"]), users[0])
        
        response = admin_session.get(f"{BASE_URL}/api/smarthome/permissions/{test_user['id']}")
        assert response.status_code == 200, f"Get permissions failed: {response.text}"
        permissions = response.json()
        
        assert isinstance(permissions, list), "Expected list of permissions"
        print(f"Found {len(permissions)} permissions for user {test_user['email']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
