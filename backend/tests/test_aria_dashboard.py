"""
Aria Dashboard v2.0 - Backend API Tests
Tests: Auth, Health, Services, Dashboard endpoints
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://github-docker-deploy.preview.emergentagent.com')

# Test credentials
TEST_EMAIL = "andi.trenter@gmail.com"
TEST_PASSWORD = "Speedy@181279"


class TestHealthEndpoints:
    """Basic health check endpoints"""
    
    def test_api_health(self):
        """Test basic API health endpoint"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["app"] == "Aria Dashboard"
        assert data["version"] == "2.0"
        print("✓ API health check passed")
    
    def test_setup_status(self):
        """Test setup status endpoint"""
        response = requests.get(f"{BASE_URL}/api/setup/status")
        assert response.status_code == 200
        data = response.json()
        assert "setup_completed" in data
        assert "has_admin" in data
        assert data["setup_completed"] == True
        assert data["has_admin"] == True
        print("✓ Setup status check passed")


class TestAuthentication:
    """Authentication flow tests"""
    
    def test_login_success(self):
        """Test successful login with valid credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200
        data = response.json()
        
        # Validate response structure
        assert "id" in data
        assert "email" in data
        assert "name" in data
        assert "role" in data
        assert "theme" in data
        assert "access_token" in data
        
        # Validate values
        assert data["email"] == TEST_EMAIL
        assert data["role"] == "superadmin"
        assert len(data["access_token"]) > 0
        print("✓ Login success test passed")
        return data["access_token"]
    
    def test_login_invalid_credentials(self):
        """Test login with invalid credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "wrong@example.com",
            "password": "wrongpassword"
        })
        assert response.status_code == 401
        data = response.json()
        assert "detail" in data
        print("✓ Invalid credentials test passed")
    
    def test_auth_me_with_token(self):
        """Test /auth/me endpoint with valid token"""
        # First login to get token
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        token = login_resp.json()["access_token"]
        
        # Test /auth/me
        response = requests.get(f"{BASE_URL}/api/auth/me", headers={
            "Authorization": f"Bearer {token}"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == TEST_EMAIL
        assert data["role"] == "superadmin"
        print("✓ Auth me endpoint test passed")
    
    def test_auth_me_without_token(self):
        """Test /auth/me endpoint without token"""
        response = requests.get(f"{BASE_URL}/api/auth/me")
        assert response.status_code == 401
        print("✓ Auth me without token test passed")


class TestSystemHealth:
    """System health monitoring endpoints"""
    
    @pytest.fixture
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        return response.json()["access_token"]
    
    def test_system_health(self, auth_token):
        """Test /health/system endpoint returns CPU, memory, uptime, disks, network"""
        response = requests.get(f"{BASE_URL}/api/health/system", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        data = response.json()
        
        # Validate CPU section
        assert "cpu" in data
        cpu = data["cpu"]
        assert "model" in cpu
        assert "physical_cores" in cpu
        assert "logical_cores" in cpu
        assert "overall_percent" in cpu
        assert "per_core_percent" in cpu
        assert isinstance(cpu["per_core_percent"], list)
        assert "load_avg_1m" in cpu
        assert "load_avg_5m" in cpu
        assert "load_avg_15m" in cpu
        print(f"  CPU: {cpu['overall_percent']}% overall, {len(cpu['per_core_percent'])} cores")
        
        # Validate Memory section
        assert "memory" in data
        mem = data["memory"]
        assert "total_gb" in mem
        assert "used_gb" in mem
        assert "available_gb" in mem
        assert "percent" in mem
        assert mem["total_gb"] > 0
        print(f"  Memory: {mem['used_gb']}/{mem['total_gb']} GB ({mem['percent']}%)")
        
        # Validate Uptime section
        assert "uptime" in data
        uptime = data["uptime"]
        assert "days" in uptime
        assert "hours" in uptime
        assert "minutes" in uptime
        print(f"  Uptime: {uptime['days']}d {uptime['hours']}h {uptime['minutes']}m")
        
        # Validate Disks section
        assert "disks" in data
        assert isinstance(data["disks"], list)
        if len(data["disks"]) > 0:
            disk = data["disks"][0]
            assert "device" in disk
            assert "mountpoint" in disk
            assert "total_gb" in disk
            assert "used_gb" in disk
            assert "percent" in disk
            print(f"  Disks: {len(data['disks'])} partitions found")
        
        # Validate Network section
        assert "network" in data
        net = data["network"]
        assert "bytes_sent" in net
        assert "bytes_recv" in net
        assert "interfaces" in net
        print(f"  Network: {len(net['interfaces'])} interfaces")
        
        print("✓ System health endpoint test passed")
    
    def test_docker_health(self, auth_token):
        """Test /health/docker endpoint - expected to show Docker unavailable in preview"""
        response = requests.get(f"{BASE_URL}/api/health/docker", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        data = response.json()
        
        assert "available" in data
        assert "containers" in data
        # In preview environment, Docker socket is not available
        if not data["available"]:
            assert "message" in data
            assert "Docker Socket nicht verfügbar" in data["message"]
            print("  Docker: Not available (expected in preview env)")
        else:
            assert "running" in data
            assert "stopped" in data
            print(f"  Docker: {data['running']} running, {data['stopped']} stopped")
        
        print("✓ Docker health endpoint test passed")
    
    def test_services_health(self, auth_token):
        """Test /health/services endpoint returns service health status"""
        response = requests.get(f"{BASE_URL}/api/health/services", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        # Should have at least some services configured
        if len(data) > 0:
            service = data[0]
            assert "id" in service
            assert "name" in service
            assert "status" in service
            # Status should be one of: healthy, offline, unknown
            assert service["status"] in ["healthy", "offline", "unknown"]
            print(f"  Services: {len(data)} services monitored")
            for s in data:
                print(f"    - {s['name']}: {s['status']}")
        
        print("✓ Services health endpoint test passed")


class TestDashboard:
    """Dashboard and services endpoints"""
    
    @pytest.fixture
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        return response.json()["access_token"]
    
    def test_dashboard_stats(self, auth_token):
        """Test /dashboard/stats endpoint"""
        response = requests.get(f"{BASE_URL}/api/dashboard/stats", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        data = response.json()
        
        assert "services" in data
        assert "users" in data
        assert "logs_today" in data
        assert isinstance(data["services"], int)
        assert isinstance(data["users"], int)
        print(f"  Stats: {data['services']} services, {data['users']} users, {data['logs_today']} logs today")
        print("✓ Dashboard stats endpoint test passed")
    
    def test_services_list(self, auth_token):
        """Test /services endpoint returns configured services"""
        response = requests.get(f"{BASE_URL}/api/services", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        if len(data) > 0:
            service = data[0]
            assert "id" in service
            assert "name" in service
            assert "url" in service
            assert "category" in service
            print(f"  Services: {len(data)} services configured")
            for s in data:
                print(f"    - {s['name']} ({s['category']})")
        
        print("✓ Services list endpoint test passed")


class TestTheme:
    """Theme switching tests"""
    
    @pytest.fixture
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        return response.json()["access_token"]
    
    def test_theme_update(self, auth_token):
        """Test theme update endpoint"""
        # Update to disney theme
        response = requests.put(f"{BASE_URL}/api/auth/theme", 
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"theme": "disney"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["theme"] == "disney"
        
        # Update back to startrek theme
        response = requests.put(f"{BASE_URL}/api/auth/theme", 
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"theme": "startrek"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["theme"] == "startrek"
        
        print("✓ Theme update endpoint test passed")


class TestChat:
    """Chat functionality tests"""
    
    @pytest.fixture
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        return response.json()["access_token"]
    
    def test_chat_message(self, auth_token):
        """Test chat endpoint"""
        response = requests.post(f"{BASE_URL}/api/chat", 
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"message": "Hallo Aria"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "response" in data
        print("✓ Chat endpoint test passed")


class TestLogs:
    """Logs endpoint tests"""
    
    @pytest.fixture
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        return response.json()["access_token"]
    
    def test_logs_retrieval(self, auth_token):
        """Test logs endpoint"""
        response = requests.get(f"{BASE_URL}/api/logs", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"  Logs: {len(data)} entries retrieved")
        print("✓ Logs endpoint test passed")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
