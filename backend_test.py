#!/usr/bin/env python3
"""
Aria Dashboard v2.0 Backend API Testing
Tests all backend endpoints for the Aria Dashboard application.
"""

import requests
import sys
import json
from datetime import datetime
from typing import Dict, Any, Optional

class AriaAPITester:
    def __init__(self, base_url: str = "https://github-docker-deploy.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.session = requests.Session()
        self.session.headers.update({'Content-Type': 'application/json'})
        
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []
        
        # Test credentials from review request
        self.admin_email = "andi.trenter@gmail.com"
        self.admin_password = "Speedy@181279"
        self.test_user_id = None

    def log_test(self, name: str, success: bool, details: str = "", response_data: Any = None):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            print(f"❌ {name} - {details}")
        
        self.test_results.append({
            "name": name,
            "success": success,
            "details": details,
            "response_data": response_data
        })

    def test_health_check(self) -> bool:
        """Test basic health endpoint"""
        try:
            response = self.session.get(f"{self.api_url}/health", timeout=10)
            success = response.status_code == 200
            data = response.json() if success else {}
            
            self.log_test(
                "Health Check", 
                success, 
                f"Status: {response.status_code}" if not success else f"App: {data.get('app', 'unknown')}",
                data
            )
            return success
        except Exception as e:
            self.log_test("Health Check", False, f"Exception: {str(e)}")
            return False

    def test_setup_status(self) -> bool:
        """Test setup status endpoint"""
        try:
            response = self.session.get(f"{self.api_url}/setup/status", timeout=10)
            success = response.status_code == 200
            data = response.json() if success else {}
            
            self.log_test(
                "Setup Status Check", 
                success, 
                f"Status: {response.status_code}" if not success else f"Setup completed: {data.get('setup_completed', 'unknown')}",
                data
            )
            return success
        except Exception as e:
            self.log_test("Setup Status Check", False, f"Exception: {str(e)}")
            return False

    def test_login(self) -> bool:
        """Test login with admin credentials"""
        try:
            login_data = {
                "email": self.admin_email,
                "password": self.admin_password
            }
            
            response = self.session.post(f"{self.api_url}/auth/login", json=login_data, timeout=10)
            success = response.status_code == 200
            data = response.json() if success else {}
            
            self.log_test(
                "Admin Login", 
                success, 
                f"Status: {response.status_code}" if not success else f"Logged in as: {data.get('email', 'unknown')} ({data.get('role', 'unknown')})",
                data
            )
            return success
        except Exception as e:
            self.log_test("Admin Login", False, f"Exception: {str(e)}")
            return False

    def test_auth_me(self) -> bool:
        """Test getting current user info"""
        try:
            response = self.session.get(f"{self.api_url}/auth/me", timeout=10)
            success = response.status_code == 200
            data = response.json() if success else {}
            
            self.log_test(
                "Get Current User", 
                success, 
                f"Status: {response.status_code}" if not success else f"User: {data.get('email', 'unknown')} (Theme: {data.get('theme', 'unknown')})",
                data
            )
            return success
        except Exception as e:
            self.log_test("Get Current User", False, f"Exception: {str(e)}")
            return False

    def test_get_services(self) -> bool:
        """Test getting services"""
        try:
            response = self.session.get(f"{self.api_url}/services", timeout=10)
            success = response.status_code == 200
            data = response.json() if success else []
            
            self.log_test(
                "Get Services", 
                success, 
                f"Status: {response.status_code}" if not success else f"Found {len(data)} services",
                data
            )
            return success
        except Exception as e:
            self.log_test("Get Services", False, f"Exception: {str(e)}")
            return False

    def test_dashboard_stats(self) -> bool:
        """Test getting dashboard stats"""
        try:
            response = self.session.get(f"{self.api_url}/dashboard/stats", timeout=10)
            success = response.status_code == 200
            data = response.json() if success else {}
            
            self.log_test(
                "Get Dashboard Stats", 
                success, 
                f"Status: {response.status_code}" if not success else f"Services: {data.get('services', 0)}, Users: {data.get('users', 0)}",
                data
            )
            return success
        except Exception as e:
            self.log_test("Get Dashboard Stats", False, f"Exception: {str(e)}")
            return False

    def test_health_services(self) -> bool:
        """Test getting services health"""
        try:
            response = self.session.get(f"{self.api_url}/health/services", timeout=10)
            success = response.status_code == 200
            data = response.json() if success else []
            
            self.log_test(
                "Get Services Health", 
                success, 
                f"Status: {response.status_code}" if not success else f"Health checked for {len(data)} services",
                data
            )
            return success
        except Exception as e:
            self.log_test("Get Services Health", False, f"Exception: {str(e)}")
            return False

    def test_system_health(self) -> bool:
        """Test getting system health"""
        try:
            response = self.session.get(f"{self.api_url}/health/system", timeout=10)
            success = response.status_code == 200
            data = response.json() if success else {}
            
            self.log_test(
                "Get System Health", 
                success, 
                f"Status: {response.status_code}" if not success else f"CPU: {data.get('cpu_percent', 0)}%, Memory: {data.get('memory_percent', 0)}%",
                data
            )
            return success
        except Exception as e:
            self.log_test("Get System Health", False, f"Exception: {str(e)}")
            return False

    def test_get_logs(self) -> bool:
        """Test getting logs"""
        try:
            response = self.session.get(f"{self.api_url}/logs?limit=10", timeout=10)
            success = response.status_code == 200
            data = response.json() if success else []
            
            self.log_test(
                "Get Logs", 
                success, 
                f"Status: {response.status_code}" if not success else f"Retrieved {len(data)} log entries",
                data
            )
            return success
        except Exception as e:
            self.log_test("Get Logs", False, f"Exception: {str(e)}")
            return False

    def test_chat(self) -> bool:
        """Test chat functionality"""
        try:
            chat_data = {
                "message": "Test message for API testing"
            }
            
            response = self.session.post(f"{self.api_url}/chat", json=chat_data, timeout=10)
            success = response.status_code == 200
            data = response.json() if success else {}
            
            self.log_test(
                "Chat Message", 
                success, 
                f"Status: {response.status_code}" if not success else f"Routed to: {data.get('routed_to', 'Aria')}",
                data
            )
            return success
        except Exception as e:
            self.log_test("Chat Message", False, f"Exception: {str(e)}")
            return False

    def test_admin_users(self) -> bool:
        """Test getting admin users list"""
        try:
            response = self.session.get(f"{self.api_url}/admin/users", timeout=10)
            success = response.status_code == 200
            data = response.json() if success else []
            
            self.log_test(
                "Get Admin Users", 
                success, 
                f"Status: {response.status_code}" if not success else f"Found {len(data)} users",
                data
            )
            return success
        except Exception as e:
            self.log_test("Get Admin Users", False, f"Exception: {str(e)}")
            return False

    def test_create_user(self) -> bool:
        """Test creating a new user"""
        try:
            user_data = {
                "email": f"test.user.{datetime.now().strftime('%H%M%S')}@test.com",
                "password": "TestPassword123!",
                "name": "Test User",
                "role": "user",
                "theme": "startrek"
            }
            
            response = self.session.post(f"{self.api_url}/admin/users", json=user_data, timeout=10)
            success = response.status_code == 200
            data = response.json() if success else {}
            
            if success and 'id' in data:
                self.test_user_id = data['id']
            
            self.log_test(
                "Create User", 
                success, 
                f"Status: {response.status_code}" if not success else f"Created user: {data.get('email', 'unknown')}",
                data
            )
            return success
        except Exception as e:
            self.log_test("Create User", False, f"Exception: {str(e)}")
            return False

    def test_update_user_services(self) -> bool:
        """Test updating user services"""
        if not self.test_user_id:
            self.log_test("Update User Services", False, "No test user ID available")
            return False
            
        try:
            services_data = {
                "services": ["casedesk", "forgepilot"]
            }
            
            response = self.session.put(f"{self.api_url}/admin/users/{self.test_user_id}/services", json=services_data, timeout=10)
            success = response.status_code == 200
            data = response.json() if success else {}
            
            self.log_test(
                "Update User Services", 
                success, 
                f"Status: {response.status_code}" if not success else "Services updated successfully",
                data
            )
            return success
        except Exception as e:
            self.log_test("Update User Services", False, f"Exception: {str(e)}")
            return False

    def test_delete_user(self) -> bool:
        """Test deleting a user"""
        if not self.test_user_id:
            self.log_test("Delete User", False, "No test user ID available")
            return False
            
        try:
            response = self.session.delete(f"{self.api_url}/admin/users/{self.test_user_id}", timeout=10)
            success = response.status_code == 200
            data = response.json() if success else {}
            
            self.log_test(
                "Delete User", 
                success, 
                f"Status: {response.status_code}" if not success else "User deleted successfully",
                data
            )
            return success
        except Exception as e:
            self.log_test("Delete User", False, f"Exception: {str(e)}")
            return False

    def test_theme_update(self) -> bool:
        """Test updating user theme"""
        try:
            theme_data = {"theme": "disney"}
            
            response = self.session.put(f"{self.api_url}/auth/theme", json=theme_data, timeout=10)
            success = response.status_code == 200
            data = response.json() if success else {}
            
            self.log_test(
                "Update Theme", 
                success, 
                f"Status: {response.status_code}" if not success else f"Theme updated to: {data.get('theme', 'unknown')}",
                data
            )
            return success
        except Exception as e:
            self.log_test("Update Theme", False, f"Exception: {str(e)}")
            return False

    def test_logout(self) -> bool:
        """Test logout"""
        try:
            response = self.session.post(f"{self.api_url}/auth/logout", timeout=10)
            success = response.status_code == 200
            data = response.json() if success else {}
            
            self.log_test(
                "Logout", 
                success, 
                f"Status: {response.status_code}" if not success else "Logged out successfully",
                data
            )
            return success
        except Exception as e:
            self.log_test("Logout", False, f"Exception: {str(e)}")
            return False

    def run_all_tests(self) -> Dict[str, Any]:
        """Run all backend tests"""
        print("🚀 Starting Aria Dashboard v2.0 Backend API Tests")
        print(f"📡 Testing against: {self.base_url}")
        print("=" * 60)
        
        # Basic connectivity
        if not self.test_health_check():
            print("❌ Health check failed - stopping tests")
            return self.get_summary()
        
        # Setup status
        self.test_setup_status()
        
        # Authentication flow
        if not self.test_login():
            print("❌ Login failed - stopping authenticated tests")
            return self.get_summary()
        
        self.test_auth_me()
        
        # Core functionality
        self.test_get_services()
        self.test_dashboard_stats()
        self.test_health_services()
        self.test_system_health()
        self.test_get_logs()
        self.test_chat()
        
        # Admin functionality
        self.test_admin_users()
        self.test_create_user()
        self.test_update_user_services()
        self.test_delete_user()
        
        # Theme functionality
        self.test_theme_update()
        
        # Cleanup
        self.test_logout()
        
        return self.get_summary()

    def get_summary(self) -> Dict[str, Any]:
        """Get test summary"""
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        
        print("\n" + "=" * 60)
        print(f"📊 Test Summary: {self.tests_passed}/{self.tests_run} passed ({success_rate:.1f}%)")
        
        failed_tests = [test for test in self.test_results if not test['success']]
        if failed_tests:
            print("\n❌ Failed Tests:")
            for test in failed_tests:
                print(f"  - {test['name']}: {test['details']}")
        
        return {
            "total_tests": self.tests_run,
            "passed_tests": self.tests_passed,
            "failed_tests": self.tests_run - self.tests_passed,
            "success_rate": success_rate,
            "test_results": self.test_results,
            "timestamp": datetime.now().isoformat()
        }

def main():
    """Main test runner"""
    tester = AriaAPITester()
    summary = tester.run_all_tests()
    
    # Save results
    with open("/app/backend_test_results.json", "w") as f:
        json.dump(summary, f, indent=2)
    
    # Exit with appropriate code
    return 0 if summary["failed_tests"] == 0 else 1

if __name__ == "__main__":
    sys.exit(main())