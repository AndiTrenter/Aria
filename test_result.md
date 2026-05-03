#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Aria soll den eingeloggten User nach Login per Voice begrüßen:
  "Willkommen zurück <Name>, heute wird das Wetter <aktuell> bei <Temp> Grad. Kurzes Feedback wie viele neue Dokumente verarbeitet wurden, Termine/Kalender und Tasks die heute anstehen. Kurz und knapp."
  - Neue Dokumente = seit dem letzten Login
  - Begrüßung nur einmal pro Tag pro User
  - Stimme = User-eigene konfigurierte Voice (Fallback global default)

backend:
  - task: "Auth login tracks previous_login_at + last_login_at"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: "POST /api/auth/login now reads existing last_login_at, stores it as previous_login_at, and writes new last_login_at=now."
      - working: true
        agent: "testing"
        comment: |
          ✅ TESTED & WORKING - All tests passed:
          - First login: last_login_at is set, previous_login_at is null (expected)
          - Second login: previous_login_at correctly set to previous last_login_at value
          - Second login: last_login_at updated to new timestamp
          - MongoDB fields verified directly after each login
          Test user: test.greeting@aria.local (credentials in /app/memory/test_credentials.md)

  - task: "GET /api/voice/greeting endpoint"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          New endpoint builds a short personalized German greeting:
          - Uses first name from user.name (or email prefix)
          - Hour-aware salutation (Morgen/Hallo/Abend/Willkommen zurück)
          - Weather summary from OpenWeatherMap (description + rounded temp)
          - Counts new CaseDesk documents created since previous_login_at
          - Counts today's events (start date == today) and open tasks (due_date <= today, not done)
          Returns {text, should_play, voice, context}.
          should_play=false if last_greeting_at is today (per-user once-per-day).
          On should_play=true the user.last_greeting_at is updated to now.
          Optional ?force=true bypasses the daily check (testing).
          Voice falls back to global default if user has none configured.
          All sub-fetches are parallelized via asyncio.gather; failures are tolerated (silently degraded greeting).
      - working: true
        agent: "testing"
        comment: |
          ✅ TESTED & WORKING - All tests passed:
          - Returns 200 with all required keys: text, should_play, voice, context
          - text is non-empty German string (verified: "Hallo, Test. Keine Termine oder offenen Aufgaben für heute.")
          - should_play=true on first call of the day
          - should_play=false on second call same day (daily de-dup working)
          - should_play=true with ?force=true parameter (bypass working)
          - context object contains all required keys: weather, new_documents, events_today, tasks_today, previous_login_at
          - last_greeting_at updated in MongoDB after first call with should_play=true
          - Graceful degradation working: returns 200 even when weather/CaseDesk not configured (weather=null, counts=0)
          - Voice fallback working: returns 'nova' as default when user has no configured voice
          Test results: 15/15 assertions passed

frontend:
  - task: "WelcomeGreeting plays voice once after login"
    implemented: true
    working: "NA"
    file: "frontend/src/components/WelcomeGreeting.jsx + App.js"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          AuthProvider.login() sets sessionStorage flag `aria_pending_greeting`.
          New <WelcomeGreeting /> mounted alongside <VoiceAssistant /> inside AppRouter when user is set.
          On mount, if flag present: GET /api/voice/greeting -> if should_play, POST /api/voice/tts (blob) -> Audio.play().
          Flag is consumed immediately on detection (StrictMode safe). Autoplay rejection is logged but not surfaced to UI.
          Frontend testing pending user permission.

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 1
  run_ui: false

test_plan:
  current_focus:
    - "GET /api/voice/greeting endpoint"
    - "Auth login tracks previous_login_at + last_login_at"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: |
      Backend feature added: personalized voice greeting after login.
      Please test:
      1. POST /api/auth/login -> verify users collection now has last_login_at + previous_login_at fields after second login.
      2. GET /api/voice/greeting (auth required):
         - Returns 200 with {text, should_play, voice, context}
         - text contains German greeting with name
         - should_play=true on first call, then false on second call same day (de-dup)
         - GET /api/voice/greeting?force=true -> should_play=true again
         - Graceful when CaseDesk/Weather not configured (text still returned, fewer parts)
      3. Verify text grammar is natural German for typical counts (0/1/multiple).
      Use existing test credentials from /app/memory/test_credentials.md if present; otherwise create a test user via /api/admin/users.
  - agent: "testing"
    message: |
      ✅ BACKEND TESTING COMPLETE - ALL TESTS PASSED
      
      Tested both backend tasks with comprehensive test suite (/app/test_voice_greeting.py):
      
      1. Auth login tracking: ✅ WORKING
         - previous_login_at and last_login_at correctly tracked
         - Verified in MongoDB after each login
      
      2. Voice greeting endpoint: ✅ WORKING
         - All response fields present and correct
         - German text generation working
         - Daily de-dup working (should_play logic)
         - Force parameter working
         - Graceful degradation working (no weather/CaseDesk)
         - MongoDB last_greeting_at update working
      
      Test credentials created and saved to /app/memory/test_credentials.md
      All 15 test assertions passed successfully.
      
      No issues found. Backend implementation is complete and working as specified.
