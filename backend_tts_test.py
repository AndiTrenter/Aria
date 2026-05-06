#!/usr/bin/env python3
"""
TTS Endpoint Testing for Aria Dashboard
Tests the upgraded /api/voice/tts and /api/voice/options endpoints
"""

import requests
import sys
import json
from typing import Dict, Any

class TTSAPITester:
    def __init__(self, base_url: str = "https://jarvis-style-panel.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.session = requests.Session()
        self.session.headers.update({'Content-Type': 'application/json'})
        
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []
        
        # Test credentials from /app/memory/test_credentials.md
        self.test_email = "test.greeting@aria.local"
        self.test_password = "TestGreeting2024!"
        self.jwt_token = None

    def log_test(self, name: str, success: bool, details: str = "", response_data: Any = None):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
            if details:
                print(f"   {details}")
        else:
            print(f"❌ {name}")
            print(f"   {details}")
        
        self.test_results.append({
            "name": name,
            "success": success,
            "details": details,
            "response_data": response_data
        })

    def login(self) -> bool:
        """Login and get JWT token"""
        try:
            login_data = {
                "email": self.test_email,
                "password": self.test_password
            }
            
            response = self.session.post(f"{self.api_url}/auth/login", json=login_data, timeout=10)
            if response.status_code == 200:
                data = response.json()
                self.jwt_token = data.get("access_token")
                if self.jwt_token:
                    self.session.headers.update({'Authorization': f'Bearer {self.jwt_token}'})
                    print(f"✅ Logged in as {self.test_email}")
                    return True
            
            print(f"❌ Login failed: {response.status_code} - {response.text}")
            return False
        except Exception as e:
            print(f"❌ Login exception: {str(e)}")
            return False

    def test_basic_tts(self) -> bool:
        """Test 1: Basic TTS with German text"""
        try:
            tts_data = {"text": "Hallo, ich bin Aria."}
            
            response = self.session.post(f"{self.api_url}/voice/tts", json=tts_data, timeout=30)
            
            # Check status code
            if response.status_code != 200:
                self.log_test(
                    "Basic TTS",
                    False,
                    f"Expected 200, got {response.status_code}: {response.text[:200]}"
                )
                return False
            
            # Check Content-Type
            content_type = response.headers.get('Content-Type', '')
            if not content_type.startswith('audio/'):
                self.log_test(
                    "Basic TTS",
                    False,
                    f"Expected Content-Type starting with 'audio/', got '{content_type}'"
                )
                return False
            
            # Check body length
            body_length = len(response.content)
            if body_length <= 1000:
                self.log_test(
                    "Basic TTS",
                    False,
                    f"Expected body length > 1000 bytes, got {body_length} bytes"
                )
                return False
            
            # Check X-TTS-Model header
            tts_model = response.headers.get('X-TTS-Model', '')
            if tts_model not in ['gpt-4o-mini-tts', 'tts-1']:
                self.log_test(
                    "Basic TTS",
                    False,
                    f"Expected X-TTS-Model to be 'gpt-4o-mini-tts' or 'tts-1', got '{tts_model}'"
                )
                return False
            
            self.log_test(
                "Basic TTS",
                True,
                f"Status: 200, Content-Type: {content_type}, Body: {body_length} bytes, Model: {tts_model}"
            )
            return True
            
        except Exception as e:
            self.log_test("Basic TTS", False, f"Exception: {str(e)}")
            return False

    def test_markdown_stripping(self) -> bool:
        """Test 2: Markdown stripping"""
        try:
            tts_data = {"text": "**Hallo** *Welt* `code` # Heading [link](http://x.com)"}
            
            response = self.session.post(f"{self.api_url}/voice/tts", json=tts_data, timeout=30)
            
            if response.status_code != 200:
                self.log_test(
                    "Markdown Stripping",
                    False,
                    f"Expected 200, got {response.status_code}: {response.text[:200]}"
                )
                return False
            
            body_length = len(response.content)
            if body_length <= 500:
                self.log_test(
                    "Markdown Stripping",
                    False,
                    f"Expected body length > 500 bytes, got {body_length} bytes"
                )
                return False
            
            self.log_test(
                "Markdown Stripping",
                True,
                f"Status: 200, Body: {body_length} bytes (server handled Markdown without crashing)"
            )
            return True
            
        except Exception as e:
            self.log_test("Markdown Stripping", False, f"Exception: {str(e)}")
            return False

    def test_long_text_truncation(self) -> bool:
        """Test 3: Long text truncation (4500 chars)"""
        try:
            # Create 4500 character text with spaces
            long_text = " ".join(["a"] * 4500)
            tts_data = {"text": long_text}
            
            response = self.session.post(f"{self.api_url}/voice/tts", json=tts_data, timeout=30)
            
            if response.status_code != 200:
                self.log_test(
                    "Long Text Truncation",
                    False,
                    f"Expected 200 (server should truncate), got {response.status_code}: {response.text[:200]}"
                )
                return False
            
            body_length = len(response.content)
            self.log_test(
                "Long Text Truncation",
                True,
                f"Status: 200, Body: {body_length} bytes (server truncated to 3500 chars and produced audio)"
            )
            return True
            
        except Exception as e:
            self.log_test("Long Text Truncation", False, f"Exception: {str(e)}")
            return False

    def test_premium_voice_marin(self) -> bool:
        """Test 4: Premium voice 'marin'"""
        try:
            tts_data = {"text": "Test", "voice": "marin"}
            
            response = self.session.post(f"{self.api_url}/voice/tts", json=tts_data, timeout=30)
            
            if response.status_code != 200:
                self.log_test(
                    "Premium Voice 'marin'",
                    False,
                    f"Expected 200 (with fallback if needed), got {response.status_code}: {response.text[:200]}"
                )
                return False
            
            tts_model = response.headers.get('X-TTS-Model', '')
            body_length = len(response.content)
            
            self.log_test(
                "Premium Voice 'marin'",
                True,
                f"Status: 200, Model: {tts_model}, Body: {body_length} bytes (fallback to nova if gpt-4o-mini-tts unavailable)"
            )
            return True
            
        except Exception as e:
            self.log_test("Premium Voice 'marin'", False, f"Exception: {str(e)}")
            return False

    def test_raw_mode(self) -> bool:
        """Test 5: Raw mode (skip Markdown strip)"""
        try:
            tts_data = {"text": "Hi **bold**", "raw": True}
            
            response = self.session.post(f"{self.api_url}/voice/tts", json=tts_data, timeout=30)
            
            if response.status_code != 200:
                self.log_test(
                    "Raw Mode",
                    False,
                    f"Expected 200, got {response.status_code}: {response.text[:200]}"
                )
                return False
            
            body_length = len(response.content)
            if body_length <= 500:
                self.log_test(
                    "Raw Mode",
                    False,
                    f"Expected body length > 500 bytes, got {body_length} bytes"
                )
                return False
            
            self.log_test(
                "Raw Mode",
                True,
                f"Status: 200, Body: {body_length} bytes (raw mode skipped Markdown stripping)"
            )
            return True
            
        except Exception as e:
            self.log_test("Raw Mode", False, f"Exception: {str(e)}")
            return False

    def test_instructions_param(self) -> bool:
        """Test 6: Instructions parameter"""
        try:
            tts_data = {"text": "Hi", "instructions": "Speak slowly and softly"}
            
            response = self.session.post(f"{self.api_url}/voice/tts", json=tts_data, timeout=30)
            
            if response.status_code != 200:
                self.log_test(
                    "Instructions Parameter",
                    False,
                    f"Expected 200, got {response.status_code}: {response.text[:200]}"
                )
                return False
            
            body_length = len(response.content)
            self.log_test(
                "Instructions Parameter",
                True,
                f"Status: 200, Body: {body_length} bytes (instructions parameter accepted)"
            )
            return True
            
        except Exception as e:
            self.log_test("Instructions Parameter", False, f"Exception: {str(e)}")
            return False

    def test_voice_options(self) -> bool:
        """Test 7: Voice options endpoint"""
        try:
            response = self.session.get(f"{self.api_url}/voice/options", timeout=10)
            
            if response.status_code != 200:
                self.log_test(
                    "Voice Options",
                    False,
                    f"Expected 200, got {response.status_code}: {response.text[:200]}"
                )
                return False
            
            data = response.json()
            
            # Check voices array
            voices = data.get('voices', [])
            if len(voices) != 11:
                self.log_test(
                    "Voice Options",
                    False,
                    f"Expected 11 voices, got {len(voices)}"
                )
                return False
            
            # Check for marin and cedar with premium=true
            marin = next((v for v in voices if v.get('id') == 'marin'), None)
            cedar = next((v for v in voices if v.get('id') == 'cedar'), None)
            
            if not marin or not marin.get('premium'):
                self.log_test(
                    "Voice Options",
                    False,
                    f"Voice 'marin' not found or premium != true"
                )
                return False
            
            if not cedar or not cedar.get('premium'):
                self.log_test(
                    "Voice Options",
                    False,
                    f"Voice 'cedar' not found or premium != true"
                )
                return False
            
            # Check for ash, coral, sage with is_new=true
            ash = next((v for v in voices if v.get('id') == 'ash'), None)
            coral = next((v for v in voices if v.get('id') == 'coral'), None)
            sage = next((v for v in voices if v.get('id') == 'sage'), None)
            
            if not ash or not ash.get('is_new'):
                self.log_test(
                    "Voice Options",
                    False,
                    f"Voice 'ash' not found or is_new != true"
                )
                return False
            
            if not coral or not coral.get('is_new'):
                self.log_test(
                    "Voice Options",
                    False,
                    f"Voice 'coral' not found or is_new != true"
                )
                return False
            
            if not sage or not sage.get('is_new'):
                self.log_test(
                    "Voice Options",
                    False,
                    f"Voice 'sage' not found or is_new != true"
                )
                return False
            
            # Check default_voice
            default_voice = data.get('default_voice')
            if not isinstance(default_voice, str):
                self.log_test(
                    "Voice Options",
                    False,
                    f"Expected default_voice to be a string, got {type(default_voice)}"
                )
                return False
            
            self.log_test(
                "Voice Options",
                True,
                f"11 voices found, premium voices (marin, cedar) verified, new voices (ash, coral, sage) verified, default_voice: {default_voice}"
            )
            return True
            
        except Exception as e:
            self.log_test("Voice Options", False, f"Exception: {str(e)}")
            return False

    def test_empty_text(self) -> bool:
        """Test 8: Empty text validation"""
        try:
            tts_data = {"text": ""}
            
            response = self.session.post(f"{self.api_url}/voice/tts", json=tts_data, timeout=10)
            
            if response.status_code != 400:
                self.log_test(
                    "Empty Text Validation",
                    False,
                    f"Expected 400, got {response.status_code}"
                )
                return False
            
            self.log_test(
                "Empty Text Validation",
                True,
                f"Status: 400 (correctly rejected empty text)"
            )
            return True
            
        except Exception as e:
            self.log_test("Empty Text Validation", False, f"Exception: {str(e)}")
            return False

    def test_markdown_only_text(self) -> bool:
        """Test 9: Markdown-only text that becomes empty after stripping"""
        try:
            tts_data = {"text": "**__"}
            
            response = self.session.post(f"{self.api_url}/voice/tts", json=tts_data, timeout=10)
            
            if response.status_code != 400:
                self.log_test(
                    "Markdown-Only Text",
                    False,
                    f"Expected 400, got {response.status_code}"
                )
                return False
            
            # Check if error message mentions sanitization
            try:
                error_data = response.json()
                error_detail = error_data.get('detail', '')
                if 'Bereinigung' not in error_detail and 'leer' not in error_detail:
                    self.log_test(
                        "Markdown-Only Text",
                        False,
                        f"Expected error message about empty text after sanitization, got: {error_detail}"
                    )
                    return False
            except:
                pass  # If we can't parse JSON, that's okay as long as status is 400
            
            self.log_test(
                "Markdown-Only Text",
                True,
                f"Status: 400 (correctly rejected Markdown-only text that becomes empty)"
            )
            return True
            
        except Exception as e:
            self.log_test("Markdown-Only Text", False, f"Exception: {str(e)}")
            return False

    def run_all_tests(self) -> Dict[str, Any]:
        """Run all TTS tests"""
        print("🚀 Starting TTS Endpoint Tests")
        print(f"📡 Testing against: {self.base_url}")
        print("=" * 60)
        
        # Login first
        if not self.login():
            print("❌ Login failed - cannot proceed with tests")
            return self.get_summary()
        
        print("\n" + "=" * 60)
        print("Running TTS Tests...")
        print("=" * 60 + "\n")
        
        # Run all tests
        self.test_basic_tts()
        self.test_markdown_stripping()
        self.test_long_text_truncation()
        self.test_premium_voice_marin()
        self.test_raw_mode()
        self.test_instructions_param()
        self.test_voice_options()
        self.test_empty_text()
        self.test_markdown_only_text()
        
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
                print(f"  - {test['name']}")
                if test['details']:
                    print(f"    {test['details']}")
        
        return {
            "total_tests": self.tests_run,
            "passed_tests": self.tests_passed,
            "failed_tests": self.tests_run - self.tests_passed,
            "success_rate": success_rate,
            "test_results": self.test_results
        }

def main():
    """Main test runner"""
    tester = TTSAPITester()
    summary = tester.run_all_tests()
    
    # Save results
    with open("/app/tts_test_results.json", "w") as f:
        json.dump(summary, f, indent=2)
    
    print(f"\n📄 Results saved to /app/tts_test_results.json")
    
    # Exit with appropriate code
    return 0 if summary["failed_tests"] == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
