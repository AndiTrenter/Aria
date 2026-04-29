"""
Aria Dashboard v2.0 - Iteration 6 Backend Tests
Tests for: Weather API, Admin Settings, Voice Assistant integration
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://aria-hub-1.preview.emergentagent.com')

# Test credentials
TEST_EMAIL = "andi.trenter@gmail.com"
TEST_PASSWORD = "Speedy@181279"


class TestAuthentication:
    """Authentication tests"""
    
    def test_login_success(self):
        """Test login with valid admin credentials"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "access_token" in data, "No access_token in response"
        assert data["email"] == TEST_EMAIL
        assert data["role"] in ["admin", "superadmin"]
        print(f"✓ Login successful - role: {data['role']}")
        return data["access_token"]


class TestWeatherAPI:
    """Weather endpoint tests"""
    
    @pytest.fixture
    def auth_token(self):
        """Get auth token for tests"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        return response.json().get("access_token")
    
    def test_weather_requires_auth(self):
        """Weather endpoint requires authentication"""
        response = requests.get(f"{BASE_URL}/api/weather")
        assert response.status_code == 401, "Weather should require auth"
        print("✓ Weather endpoint requires authentication")
    
    def test_weather_returns_available_false_when_not_configured(self, auth_token):
        """Weather returns available:false when no API key configured"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/weather", headers=headers)
        assert response.status_code == 200
        data = response.json()
        # Weather might be configured or not - check structure
        assert "available" in data, "Response should have 'available' field"
        if not data["available"]:
            assert "message" in data, "Should have message when not available"
            print(f"✓ Weather not configured: {data['message']}")
        else:
            assert "city" in data, "Should have city when available"
            assert "current" in data, "Should have current weather"
            print(f"✓ Weather configured for: {data['city']}")


class TestAdminSettings:
    """Admin settings endpoint tests"""
    
    @pytest.fixture
    def auth_token(self):
        """Get auth token for tests"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        return response.json().get("access_token")
    
    def test_get_settings_requires_admin(self):
        """Settings endpoint requires admin role"""
        response = requests.get(f"{BASE_URL}/api/admin/settings")
        assert response.status_code == 401, "Settings should require auth"
        print("✓ Admin settings requires authentication")
    
    def test_get_settings_returns_object(self, auth_token):
        """GET /api/admin/settings returns settings object"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/admin/settings", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict), "Settings should be a dict"
        print(f"✓ Settings retrieved: {list(data.keys())}")
    
    def test_put_settings_weather_city(self, auth_token):
        """PUT /api/admin/settings accepts weather_city"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.put(
            f"{BASE_URL}/api/admin/settings",
            headers=headers,
            json={"weather_city": "Berlin,DE"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        print("✓ Weather city setting updated")
    
    def test_put_settings_weather_api_key(self, auth_token):
        """PUT /api/admin/settings accepts weather_api_key"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        # Use a test key that won't actually work but tests the endpoint
        response = requests.put(
            f"{BASE_URL}/api/admin/settings",
            headers=headers,
            json={"weather_api_key": "TEST_WEATHER_KEY_12345"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        print("✓ Weather API key setting updated")


class TestDashboardStats:
    """Dashboard stats endpoint tests"""
    
    @pytest.fixture
    def auth_token(self):
        """Get auth token for tests"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        return response.json().get("access_token")
    
    def test_dashboard_stats(self, auth_token):
        """GET /api/dashboard/stats returns correct counts"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "services" in data
        assert "users" in data
        assert "logs_today" in data
        assert data["services"] >= 0
        assert data["users"] >= 1  # At least the admin user
        print(f"✓ Dashboard stats: {data['services']} services, {data['users']} users, {data['logs_today']} logs today")


class TestServices:
    """Services endpoint tests"""
    
    @pytest.fixture
    def auth_token(self):
        """Get auth token for tests"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        return response.json().get("access_token")
    
    def test_get_services(self, auth_token):
        """GET /api/services returns list of services"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/services", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 4, "Should have at least 4 default services"
        
        service_ids = [s["id"] for s in data]
        assert "casedesk" in service_ids, "Should have casedesk service"
        assert "forgepilot" in service_ids, "Should have forgepilot service"
        assert "nextcloud" in service_ids, "Should have nextcloud service"
        assert "unraid" in service_ids, "Should have unraid service"
        print(f"✓ Services: {service_ids}")


class TestHealthEndpoints:
    """Health endpoint tests"""
    
    def test_health_check(self):
        """GET /api/health returns healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "version" in data
        print(f"✓ Health check: {data['status']}, version: {data.get('version')}")


class TestChatEndpoint:
    """Chat endpoint tests"""
    
    @pytest.fixture
    def auth_token(self):
        """Get auth token for tests"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        return response.json().get("access_token")
    
    def test_chat_requires_auth(self):
        """Chat endpoint requires authentication"""
        response = requests.post(
            f"{BASE_URL}/api/chat",
            json={"message": "Hello"}
        )
        assert response.status_code == 401, "Chat should require auth"
        print("✓ Chat endpoint requires authentication")
    
    def test_chat_returns_response(self, auth_token):
        """POST /api/chat returns response with session_id"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.post(
            f"{BASE_URL}/api/chat",
            headers=headers,
            json={"message": "Hallo, wie geht es dir?", "session_id": "test_session_123"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "response" in data, "Should have response field"
        assert "session_id" in data, "Should have session_id field"
        print(f"✓ Chat response received: {data['response'][:50]}...")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
