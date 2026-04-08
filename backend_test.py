#!/usr/bin/env python3
"""
Aria Dashboard Backend API Testing
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
        
        # Test data
        self.admin_email = "andi.trenter@gmail.com"
        self.admin_password = "Speedy@181279"
        self.test_tile_id = None

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
                f"Status: {response.status_code}" if not success else "",
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
                f"Status: {response.status_code}" if not success else f"Logged in as: {data.get('email', 'unknown')}",
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
                f"Status: {response.status_code}" if not success else f"User: {data.get('email', 'unknown')}",
                data
            )
            return success
        except Exception as e:
            self.log_test("Get Current User", False, f"Exception: {str(e)}")
            return False

    def test_get_categories(self) -> bool:
        """Test getting categories"""
        try:
            response = self.session.get(f"{self.api_url}/categories", timeout=10)
            success = response.status_code == 200
            data = response.json() if success else []
            
            self.log_test(
                "Get Categories", 
                success, 
                f"Status: {response.status_code}" if not success else f"Found {len(data)} categories",
                data
            )
            return success
        except Exception as e:
            self.log_test("Get Categories", False, f"Exception: {str(e)}")
            return False

    def test_get_tiles(self) -> bool:
        """Test getting tiles"""
        try:
            response = self.session.get(f"{self.api_url}/tiles", timeout=10)
            success = response.status_code == 200
            data = response.json() if success else []
            
            self.log_test(
                "Get All Tiles", 
                success, 
                f"Status: {response.status_code}" if not success else f"Found {len(data)} tiles",
                data
            )
            return success
        except Exception as e:
            self.log_test("Get All Tiles", False, f"Exception: {str(e)}")
            return False

    def test_get_visible_tiles(self) -> bool:
        """Test getting visible tiles only"""
        try:
            response = self.session.get(f"{self.api_url}/tiles?visible_only=true", timeout=10)
            success = response.status_code == 200
            data = response.json() if success else []
            
            self.log_test(
                "Get Visible Tiles", 
                success, 
                f"Status: {response.status_code}" if not success else f"Found {len(data)} visible tiles",
                data
            )
            return success
        except Exception as e:
            self.log_test("Get Visible Tiles", False, f"Exception: {str(e)}")
            return False

    def test_create_tile(self) -> bool:
        """Test creating a new tile"""
        try:
            tile_data = {
                "name": "Test Service",
                "url": "http://192.168.1.100:8080",
                "icon": "cube",
                "category": "Tools",
                "description": "Test tile for API testing",
                "visible": True,
                "is_manual": True
            }
            
            response = self.session.post(f"{self.api_url}/tiles", json=tile_data, timeout=10)
            success = response.status_code == 200
            data = response.json() if success else {}
            
            if success and 'id' in data:
                self.test_tile_id = data['id']
            
            self.log_test(
                "Create Tile", 
                success, 
                f"Status: {response.status_code}" if not success else f"Created tile: {data.get('name', 'unknown')}",
                data
            )
            return success
        except Exception as e:
            self.log_test("Create Tile", False, f"Exception: {str(e)}")
            return False

    def test_update_tile(self) -> bool:
        """Test updating a tile"""
        if not self.test_tile_id:
            self.log_test("Update Tile", False, "No test tile ID available")
            return False
            
        try:
            update_data = {
                "name": "Updated Test Service",
                "description": "Updated description for testing"
            }
            
            response = self.session.put(f"{self.api_url}/tiles/{self.test_tile_id}", json=update_data, timeout=10)
            success = response.status_code == 200
            data = response.json() if success else {}
            
            self.log_test(
                "Update Tile", 
                success, 
                f"Status: {response.status_code}" if not success else f"Updated tile: {data.get('name', 'unknown')}",
                data
            )
            return success
        except Exception as e:
            self.log_test("Update Tile", False, f"Exception: {str(e)}")
            return False

    def test_delete_tile(self) -> bool:
        """Test deleting a tile"""
        if not self.test_tile_id:
            self.log_test("Delete Tile", False, "No test tile ID available")
            return False
            
        try:
            response = self.session.delete(f"{self.api_url}/tiles/{self.test_tile_id}", timeout=10)
            success = response.status_code == 200
            data = response.json() if success else {}
            
            self.log_test(
                "Delete Tile", 
                success, 
                f"Status: {response.status_code}" if not success else "Tile deleted successfully",
                data
            )
            return success
        except Exception as e:
            self.log_test("Delete Tile", False, f"Exception: {str(e)}")
            return False

    def test_docker_containers(self) -> bool:
        """Test getting Docker containers (should return mock data)"""
        try:
            response = self.session.get(f"{self.api_url}/docker/containers", timeout=10)
            success = response.status_code == 200
            data = response.json() if success else []
            
            self.log_test(
                "Get Docker Containers", 
                success, 
                f"Status: {response.status_code}" if not success else f"Found {len(data)} containers (mock data)",
                data
            )
            return success
        except Exception as e:
            self.log_test("Get Docker Containers", False, f"Exception: {str(e)}")
            return False

    def test_add_docker_containers(self) -> bool:
        """Test adding Docker containers as tiles"""
        try:
            # First get containers
            containers_response = self.session.get(f"{self.api_url}/docker/containers", timeout=10)
            if containers_response.status_code != 200:
                self.log_test("Add Docker Containers", False, "Could not fetch containers first")
                return False
                
            containers = containers_response.json()
            if not containers:
                self.log_test("Add Docker Containers", False, "No containers available to add")
                return False
            
            # Try to add first container
            container_to_add = [containers[0]]
            response = self.session.post(f"{self.api_url}/docker/containers/add", json=container_to_add, timeout=10)
            success = response.status_code == 200
            data = response.json() if success else {}
            
            self.log_test(
                "Add Docker Containers", 
                success, 
                f"Status: {response.status_code}" if not success else f"Added {data.get('added', 0)} containers",
                data
            )
            return success
        except Exception as e:
            self.log_test("Add Docker Containers", False, f"Exception: {str(e)}")
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
        print("🚀 Starting Aria Dashboard Backend API Tests")
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
        
        # Data retrieval
        self.test_get_categories()
        self.test_get_tiles()
        self.test_get_visible_tiles()
        
        # Tile CRUD operations
        self.test_create_tile()
        self.test_update_tile()
        self.test_delete_tile()
        
        # Docker integration
        self.test_docker_containers()
        self.test_add_docker_containers()
        
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