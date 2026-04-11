"""
Aria Dashboard v2.0 - New Features Tests
Tests: Chat with sessions, Admin settings, Account linking, Services (including Nextcloud)
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://github-docker-deploy.preview.emergentagent.com')

# Test credentials
TEST_EMAIL = "andi.trenter@gmail.com"
TEST_PASSWORD = "Speedy@181279"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for all tests"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    return response.json()["access_token"]


class TestServicesIncludingNextcloud:
    """Test services endpoint returns all 4 services including Nextcloud"""
    
    def test_services_returns_four_services(self, auth_token):
        """Verify 4 services are returned: CaseDesk AI, ForgePilot, Nextcloud, Unraid"""
        response = requests.get(f"{BASE_URL}/api/services", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        services = response.json()
        
        assert isinstance(services, list)
        assert len(services) >= 4, f"Expected at least 4 services, got {len(services)}"
        
        service_ids = [s["id"] for s in services]
        expected_services = ["casedesk", "forgepilot", "nextcloud", "unraid"]
        
        for expected_id in expected_services:
            assert expected_id in service_ids, f"Service '{expected_id}' not found in services"
        
        # Verify Nextcloud specifically
        nextcloud = next((s for s in services if s["id"] == "nextcloud"), None)
        assert nextcloud is not None, "Nextcloud service not found"
        assert nextcloud["name"] == "Nextcloud"
        assert nextcloud["category"] == "Cloud"
        assert "linked" in nextcloud  # Should have linked status
        
        print(f"✓ All 4 services found: {service_ids}")


class TestChatWithSessions:
    """Test chat functionality with session management"""
    
    def test_chat_returns_response_and_session_id(self, auth_token):
        """Test POST /api/chat returns AI response and session_id"""
        response = requests.post(f"{BASE_URL}/api/chat", 
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "message": "Hallo, was kannst du mir über Aria erzählen?",
                "target_service": None,
                "session_id": None
            },
            timeout=30  # AI responses can take time
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "response" in data, "Response should contain 'response' field"
        assert "session_id" in data, "Response should contain 'session_id' field"
        assert data["session_id"] is not None, "session_id should not be None"
        assert len(data["response"]) > 0, "Response should not be empty"
        
        print(f"✓ Chat response received with session_id: {data['session_id'][:20]}...")
        return data["session_id"]
    
    def test_chat_sessions_list(self, auth_token):
        """Test GET /api/chat/sessions returns session list"""
        response = requests.get(f"{BASE_URL}/api/chat/sessions", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        sessions = response.json()
        
        assert isinstance(sessions, list)
        if len(sessions) > 0:
            session = sessions[0]
            assert "session_id" in session
            assert "preview" in session
            assert "timestamp" in session
            print(f"✓ Found {len(sessions)} chat sessions")
        else:
            print("✓ No chat sessions yet (expected if first run)")
    
    def test_chat_with_target_routing(self, auth_token):
        """Test chat with target_service routing"""
        # Test with casedesk target (will fallback to AI if CaseDesk unreachable)
        response = requests.post(f"{BASE_URL}/api/chat", 
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "message": "Test message for routing",
                "target_service": "casedesk",
                "session_id": None
            },
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "response" in data
        assert "routed_to" in data
        # routed_to can be "casedesk" if reachable, or "aria-ai" as fallback
        print(f"✓ Chat routed to: {data.get('routed_to', 'unknown')}")


class TestAdminSettings:
    """Test admin settings for API key management"""
    
    def test_get_admin_settings(self, auth_token):
        """Test GET /api/admin/settings returns settings"""
        response = requests.get(f"{BASE_URL}/api/admin/settings", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        settings = response.json()
        
        assert isinstance(settings, dict)
        # openai_api_key may or may not be set
        print(f"✓ Admin settings retrieved: {list(settings.keys())}")
    
    def test_update_admin_settings(self, auth_token):
        """Test PUT /api/admin/settings for API key management"""
        # Note: We don't actually change the key, just test the endpoint works
        response = requests.put(f"{BASE_URL}/api/admin/settings", 
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"test_setting": "test_value"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert data["message"] == "Settings updated"
        print("✓ Admin settings update endpoint works")


class TestAccountLinking:
    """Test account linking (Kontoverknüpfung) for external services"""
    
    def test_link_service_account(self, auth_token):
        """Test POST /api/services/{id}/link for account linking"""
        # Test linking to nextcloud service
        response = requests.post(f"{BASE_URL}/api/services/nextcloud/link", 
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "service_id": "nextcloud",
                "username": "test_user",
                "password": "test_password"
            }
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "message" in data
        assert data["message"] == "Service linked"
        assert data["service_id"] == "nextcloud"
        print("✓ Service account linking works")
    
    def test_verify_linked_service(self, auth_token):
        """Verify the linked service appears in services list"""
        response = requests.get(f"{BASE_URL}/api/services", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        services = response.json()
        
        nextcloud = next((s for s in services if s["id"] == "nextcloud"), None)
        assert nextcloud is not None
        assert nextcloud.get("linked") == True, "Nextcloud should be marked as linked"
        assert nextcloud.get("linked_username") == "test_user"
        print("✓ Linked service verified in services list")
    
    def test_unlink_service_account(self, auth_token):
        """Test DELETE /api/services/{id}/link for unlinking"""
        response = requests.delete(f"{BASE_URL}/api/services/nextcloud/link", 
            headers={"Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        data = response.json()
        
        assert "message" in data
        assert data["message"] == "Service unlinked"
        print("✓ Service account unlinking works")


class TestChatHistory:
    """Test chat history retrieval"""
    
    def test_chat_history_for_session(self, auth_token):
        """Test GET /api/chat/history/{session_id}"""
        # First create a chat to get a session
        chat_response = requests.post(f"{BASE_URL}/api/chat", 
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"message": "Test message for history", "session_id": None},
            timeout=30
        )
        assert chat_response.status_code == 200
        session_id = chat_response.json()["session_id"]
        
        # Now get history for that session
        response = requests.get(f"{BASE_URL}/api/chat/history/{session_id}", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        history = response.json()
        
        assert isinstance(history, list)
        assert len(history) >= 2, "Should have at least user message and assistant response"
        
        # Verify message structure
        for msg in history:
            assert "role" in msg
            assert "content" in msg
            assert "timestamp" in msg
            assert msg["role"] in ["user", "assistant"]
        
        print(f"✓ Chat history retrieved: {len(history)} messages")


class TestAdminUsers:
    """Test admin user management"""
    
    def test_get_all_users(self, auth_token):
        """Test GET /api/admin/users returns user list"""
        response = requests.get(f"{BASE_URL}/api/admin/users", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        users = response.json()
        
        assert isinstance(users, list)
        assert len(users) >= 1, "Should have at least one user (admin)"
        
        # Verify user structure
        user = users[0]
        assert "id" in user
        assert "email" in user
        assert "role" in user
        # password_hash should NOT be returned
        assert "password_hash" not in user
        
        print(f"✓ Admin users list: {len(users)} users")


class TestLogsFiltering:
    """Test logs endpoint with filtering"""
    
    def test_logs_all(self, auth_token):
        """Test GET /api/logs returns all logs"""
        response = requests.get(f"{BASE_URL}/api/logs?limit=50", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        logs = response.json()
        
        assert isinstance(logs, list)
        print(f"✓ All logs: {len(logs)} entries")
    
    def test_logs_filter_by_type(self, auth_token):
        """Test GET /api/logs with log_type filter"""
        response = requests.get(f"{BASE_URL}/api/logs?log_type=user_login&limit=50", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        logs = response.json()
        
        assert isinstance(logs, list)
        # All returned logs should be of type user_login
        for log in logs:
            assert log.get("type") == "user_login"
        
        print(f"✓ Filtered logs (user_login): {len(logs)} entries")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
