"""
Aria Dashboard Phase 4 - Kiosk/Tablet Mode Tests
Tests: Profile CRUD, Kiosk Mode endpoints, Scene Templates
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from test_credentials.md
ADMIN_EMAIL = "andi.trenter@gmail.com"
ADMIN_PASSWORD = "Speedy@181279"


class TestAuth:
    """Authentication tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get admin auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "access_token" in data, "No access_token in response"
        return data["access_token"]
    
    @pytest.fixture(scope="class")
    def auth_headers(self, auth_token):
        """Get auth headers"""
        return {"Authorization": f"Bearer {auth_token}"}
    
    def test_login_success(self):
        """Test admin login works"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data.get("role") in ["superadmin", "admin"]
        print(f"✓ Login successful, role: {data.get('role')}")


class TestProfileCRUD:
    """Profile CRUD operations tests"""
    
    @pytest.fixture(scope="class")
    def auth_headers(self):
        """Get admin auth headers"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return {"Authorization": f"Bearer {response.json()['access_token']}"}
    
    @pytest.fixture(scope="class")
    def existing_room_id(self, auth_headers):
        """Get an existing room ID for profile creation"""
        response = requests.get(f"{BASE_URL}/api/smarthome/rooms", headers=auth_headers)
        assert response.status_code == 200
        rooms = response.json()
        if rooms:
            return rooms[0]["id"]
        return None
    
    def test_get_profiles_list(self, auth_headers):
        """GET /api/smarthome/profiles - List all profiles"""
        response = requests.get(f"{BASE_URL}/api/smarthome/profiles", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ GET /api/smarthome/profiles - Found {len(data)} profiles")
        return data
    
    def test_get_profiles_requires_admin(self):
        """GET /api/smarthome/profiles - Requires authentication"""
        response = requests.get(f"{BASE_URL}/api/smarthome/profiles")
        assert response.status_code == 401
        print("✓ GET /api/smarthome/profiles requires authentication")
    
    def test_create_profile(self, auth_headers, existing_room_id):
        """POST /api/smarthome/profiles - Create new profile"""
        if not existing_room_id:
            pytest.skip("No rooms available for profile creation")
        
        profile_data = {
            "name": "TEST_Kiosk_Profile",
            "room_id": existing_room_id,
            "user_id": "",  # No user assigned
            "kiosk_mode": True,
            "child_mode": False
        }
        response = requests.post(f"{BASE_URL}/api/smarthome/profiles", 
                                 json=profile_data, headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["name"] == "TEST_Kiosk_Profile"
        assert data["kiosk_mode"] == True
        assert data["child_mode"] == False
        print(f"✓ POST /api/smarthome/profiles - Created profile: {data['id']}")
        return data["id"]
    
    def test_create_child_mode_profile(self, auth_headers, existing_room_id):
        """POST /api/smarthome/profiles - Create child mode profile"""
        if not existing_room_id:
            pytest.skip("No rooms available for profile creation")
        
        profile_data = {
            "name": "TEST_Child_Profile",
            "room_id": existing_room_id,
            "user_id": "",
            "kiosk_mode": True,
            "child_mode": True
        }
        response = requests.post(f"{BASE_URL}/api/smarthome/profiles", 
                                 json=profile_data, headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["child_mode"] == True
        print(f"✓ Created child mode profile: {data['id']}")
        return data["id"]
    
    def test_get_single_profile(self, auth_headers):
        """GET /api/smarthome/profiles/{profile_id} - Get single profile with enriched data"""
        # First get list of profiles
        list_response = requests.get(f"{BASE_URL}/api/smarthome/profiles", headers=auth_headers)
        profiles = list_response.json()
        
        if not profiles:
            pytest.skip("No profiles to test")
        
        profile_id = profiles[0]["id"]
        response = requests.get(f"{BASE_URL}/api/smarthome/profiles/{profile_id}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == profile_id
        # Admin preview should have enriched data
        assert "has_profile" in data or "room" in data
        print(f"✓ GET /api/smarthome/profiles/{profile_id} - Profile retrieved with enriched data")
    
    def test_delete_profile(self, auth_headers):
        """DELETE /api/smarthome/profiles/{profile_id} - Delete profile"""
        # First create a profile to delete
        rooms_response = requests.get(f"{BASE_URL}/api/smarthome/rooms", headers=auth_headers)
        rooms = rooms_response.json()
        if not rooms:
            pytest.skip("No rooms available")
        
        # Create test profile
        create_response = requests.post(f"{BASE_URL}/api/smarthome/profiles", 
                                        json={"name": "TEST_Delete_Me", "room_id": rooms[0]["id"], "kiosk_mode": False, "child_mode": False},
                                        headers=auth_headers)
        assert create_response.status_code == 200
        profile_id = create_response.json()["id"]
        
        # Delete it
        delete_response = requests.delete(f"{BASE_URL}/api/smarthome/profiles/{profile_id}", headers=auth_headers)
        assert delete_response.status_code == 200
        
        # Verify deletion
        get_response = requests.get(f"{BASE_URL}/api/smarthome/profiles/{profile_id}", headers=auth_headers)
        assert get_response.status_code == 404
        print(f"✓ DELETE /api/smarthome/profiles/{profile_id} - Profile deleted successfully")


class TestMyProfile:
    """Tests for /api/smarthome/my-profile endpoint"""
    
    @pytest.fixture(scope="class")
    def auth_headers(self):
        """Get admin auth headers"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return {"Authorization": f"Bearer {response.json()['access_token']}"}
    
    def test_get_my_profile(self, auth_headers):
        """GET /api/smarthome/my-profile - Get current user's profile"""
        response = requests.get(f"{BASE_URL}/api/smarthome/my-profile", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        # Should return has_profile: false if no profile assigned, or enriched profile data
        assert "has_profile" in data
        print(f"✓ GET /api/smarthome/my-profile - has_profile: {data.get('has_profile')}")
    
    def test_my_profile_requires_auth(self):
        """GET /api/smarthome/my-profile - Requires authentication"""
        response = requests.get(f"{BASE_URL}/api/smarthome/my-profile")
        assert response.status_code == 401
        print("✓ GET /api/smarthome/my-profile requires authentication")


class TestSceneTemplates:
    """Tests for scene templates endpoint"""
    
    @pytest.fixture(scope="class")
    def auth_headers(self):
        """Get admin auth headers"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return {"Authorization": f"Bearer {response.json()['access_token']}"}
    
    def test_get_scene_templates(self, auth_headers):
        """GET /api/smarthome/scene-templates - Get default scene templates"""
        response = requests.get(f"{BASE_URL}/api/smarthome/scene-templates", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 5  # Should have at least 5 default templates
        
        # Verify expected scenes exist
        scene_names = [s["name"] for s in data]
        expected_scenes = ["Gute Nacht", "Aufstehen", "Lernen", "Spielen", "Filmabend"]
        for expected in expected_scenes:
            assert expected in scene_names, f"Missing scene: {expected}"
        
        # Verify scene structure
        for scene in data:
            assert "id" in scene
            assert "name" in scene
            assert "icon" in scene
            assert "description" in scene
            assert "actions_template" in scene
        
        print(f"✓ GET /api/smarthome/scene-templates - Found {len(data)} templates: {scene_names}")
    
    def test_scene_templates_requires_auth(self):
        """GET /api/smarthome/scene-templates - Requires authentication"""
        response = requests.get(f"{BASE_URL}/api/smarthome/scene-templates")
        assert response.status_code == 401
        print("✓ GET /api/smarthome/scene-templates requires authentication")


class TestRoomsAndDevices:
    """Tests for rooms and devices (needed for profile context)"""
    
    @pytest.fixture(scope="class")
    def auth_headers(self):
        """Get admin auth headers"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return {"Authorization": f"Bearer {response.json()['access_token']}"}
    
    def test_get_rooms(self, auth_headers):
        """GET /api/smarthome/rooms - List rooms"""
        response = requests.get(f"{BASE_URL}/api/smarthome/rooms", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ GET /api/smarthome/rooms - Found {len(data)} rooms")
        if data:
            for room in data:
                print(f"  - {room.get('name')} (id: {room.get('id')})")
    
    def test_get_devices(self, auth_headers):
        """GET /api/smarthome/devices - List devices"""
        response = requests.get(f"{BASE_URL}/api/smarthome/devices", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ GET /api/smarthome/devices - Found {len(data)} devices")


class TestAdminTabs:
    """Tests for SmartHomeAdmin tabs data"""
    
    @pytest.fixture(scope="class")
    def auth_headers(self):
        """Get admin auth headers"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return {"Authorization": f"Bearer {response.json()['access_token']}"}
    
    def test_admin_users_list(self, auth_headers):
        """GET /api/admin/users - List users for profile assignment"""
        response = requests.get(f"{BASE_URL}/api/admin/users", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ GET /api/admin/users - Found {len(data)} users")
    
    def test_audit_log(self, auth_headers):
        """GET /api/audit-log - Get audit log for AUDIT-LOG tab"""
        response = requests.get(f"{BASE_URL}/api/audit-log?limit=10", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ GET /api/audit-log - Found {len(data)} log entries")


class TestCleanup:
    """Cleanup test profiles"""
    
    @pytest.fixture(scope="class")
    def auth_headers(self):
        """Get admin auth headers"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return {"Authorization": f"Bearer {response.json()['access_token']}"}
    
    def test_cleanup_test_profiles(self, auth_headers):
        """Delete TEST_ prefixed profiles"""
        response = requests.get(f"{BASE_URL}/api/smarthome/profiles", headers=auth_headers)
        profiles = response.json()
        
        deleted = 0
        for profile in profiles:
            if profile.get("name", "").startswith("TEST_"):
                del_response = requests.delete(f"{BASE_URL}/api/smarthome/profiles/{profile['id']}", headers=auth_headers)
                if del_response.status_code == 200:
                    deleted += 1
        
        print(f"✓ Cleanup: Deleted {deleted} test profiles")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
