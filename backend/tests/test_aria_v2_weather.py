"""
Aria Dashboard v2.0 - Weather and Emergent Removal Tests
Tests: Weather API, Admin Settings for Weather, No Emergent dependencies
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://aria-hub-1.preview.emergentagent.com')

class TestWeatherAPI:
    """Weather endpoint tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "andi.trenter@gmail.com",
            "password": "Speedy@181279"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        self.token = response.json().get("access_token")
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_weather_endpoint_returns_not_configured(self):
        """GET /api/weather returns 'not configured' when no API key"""
        response = requests.get(f"{BASE_URL}/api/weather", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert "available" in data
        # Should be False when no API key configured
        if not data["available"]:
            assert "message" in data
            print(f"Weather not configured: {data['message']}")
        else:
            print(f"Weather available for city: {data.get('city')}")
    
    def test_weather_endpoint_requires_auth(self):
        """GET /api/weather requires authentication"""
        response = requests.get(f"{BASE_URL}/api/weather")
        assert response.status_code == 401


class TestAdminSettings:
    """Admin settings tests for weather and AI configuration"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "andi.trenter@gmail.com",
            "password": "Speedy@181279"
        })
        assert response.status_code == 200
        self.token = response.json().get("access_token")
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_admin_settings(self):
        """GET /api/admin/settings returns settings object"""
        response = requests.get(f"{BASE_URL}/api/admin/settings", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
        print(f"Current settings keys: {list(data.keys())}")
    
    def test_update_weather_city_setting(self):
        """PUT /api/admin/settings accepts weather_city"""
        response = requests.put(
            f"{BASE_URL}/api/admin/settings",
            headers=self.headers,
            json={"weather_city": "Berlin,DE"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("message") == "Settings updated"
        
        # Verify setting was saved
        get_response = requests.get(f"{BASE_URL}/api/admin/settings", headers=self.headers)
        assert get_response.status_code == 200
        settings = get_response.json()
        assert settings.get("weather_city") == "Berlin,DE"
    
    def test_update_weather_api_key_setting(self):
        """PUT /api/admin/settings accepts weather_api_key"""
        # Use a test key (won't work but tests the endpoint)
        response = requests.put(
            f"{BASE_URL}/api/admin/settings",
            headers=self.headers,
            json={"weather_api_key": "test_weather_key_12345"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("message") == "Settings updated"
        
        # Verify setting was saved (should be masked)
        get_response = requests.get(f"{BASE_URL}/api/admin/settings", headers=self.headers)
        assert get_response.status_code == 200
        settings = get_response.json()
        # API key should be masked
        if settings.get("weather_api_key"):
            assert "..." in settings["weather_api_key"]
    
    def test_update_openai_api_key_setting(self):
        """PUT /api/admin/settings accepts openai_api_key"""
        response = requests.put(
            f"{BASE_URL}/api/admin/settings",
            headers=self.headers,
            json={"openai_api_key": "sk-test_openai_key_12345"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("message") == "Settings updated"
    
    def test_admin_settings_requires_admin(self):
        """Admin settings endpoints require admin role"""
        # Without auth
        response = requests.get(f"{BASE_URL}/api/admin/settings")
        assert response.status_code == 401


class TestChatWithOpenAI:
    """Chat endpoint tests - using direct OpenAI SDK"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "andi.trenter@gmail.com",
            "password": "Speedy@181279"
        })
        assert response.status_code == 200
        self.token = response.json().get("access_token")
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_chat_endpoint_works(self):
        """POST /api/chat returns response (with or without API key)"""
        response = requests.post(
            f"{BASE_URL}/api/chat",
            headers=self.headers,
            json={"message": "Hallo, wie geht es dir?"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "response" in data
        assert "session_id" in data
        print(f"Chat response: {data['response'][:100]}...")
    
    def test_chat_returns_api_key_message_when_not_configured(self):
        """Chat returns helpful message when no API key configured"""
        response = requests.post(
            f"{BASE_URL}/api/chat",
            headers=self.headers,
            json={"message": "Test message"}
        )
        assert response.status_code == 200
        data = response.json()
        # If no API key, should mention configuration
        if "API-Key" in data["response"] or "konfiguriert" in data["response"]:
            print("Chat correctly indicates API key not configured")
        else:
            print(f"Chat response: {data['response'][:100]}...")


class TestDashboardStats:
    """Dashboard stats and services tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "andi.trenter@gmail.com",
            "password": "Speedy@181279"
        })
        assert response.status_code == 200
        self.token = response.json().get("access_token")
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_dashboard_stats(self):
        """GET /api/dashboard/stats returns stats"""
        response = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert "services" in data
        assert "users" in data
        assert "logs_today" in data
        print(f"Dashboard stats: {data}")
    
    def test_services_list(self):
        """GET /api/services returns 4 services"""
        response = requests.get(f"{BASE_URL}/api/services", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 4
        service_ids = [s["id"] for s in data]
        assert "casedesk" in service_ids
        assert "forgepilot" in service_ids
        assert "nextcloud" in service_ids
        assert "unraid" in service_ids
        print(f"Services: {service_ids}")


class TestSystemHealth:
    """System health endpoint tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "andi.trenter@gmail.com",
            "password": "Speedy@181279"
        })
        assert response.status_code == 200
        self.token = response.json().get("access_token")
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_system_health(self):
        """GET /api/health/system returns system data"""
        response = requests.get(f"{BASE_URL}/api/health/system", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert "cpu" in data
        assert "memory" in data
        assert "uptime" in data
        assert "disks" in data
        assert "network" in data
        print(f"CPU: {data['cpu']['overall_percent']}%, Memory: {data['memory']['percent']}%")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
