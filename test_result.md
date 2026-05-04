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
      - working: "NA"
        agent: "main"
        comment: |
          Updated to use the new speakStreaming() helper from utils/ttsPlayer.js so the greeting also benefits from sentence-chunked low-latency playback. User will test in browser.

  - task: "ttsPlayer + Chat playback uses sentence-chunked streaming"
    implemented: true
    working: "NA"
    file: "frontend/src/utils/ttsPlayer.js + frontend/src/pages/Chat.jsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          New util ttsPlayer.js exports:
          - stripMarkdownForTTS(text): client-side Markdown stripper as safety net.
          - splitSentences(text): German-aware sentence splitter with abbreviation guards (z.B., u.a., etc.).
          - speakStreaming(text, opts): builds chunks (small first chunk for fast start, larger subsequent chunks), kicks off all chunk fetches in parallel, plays them in order. Returns control object {stop(), isPlaying()}.
          Chat.jsx playTTS now uses speakStreaming and stops the previous playback before starting a new one.

  - task: "Account voice picker shows new voices with HD/NEW badges"
    implemented: true
    working: "NA"
    file: "frontend/src/pages/Account.jsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Voice picker now renders HD badge for premium voices (marin/cedar) and NEU badge for newly-added gpt-4o-mini-tts voices (ash/coral/sage)."

  - task: "TTS upgrade backend (gpt-4o-mini-tts + streaming + Markdown strip)"
    implemented: true
    working: false
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          /api/voice/tts now defaults to gpt-4o-mini-tts (with tts-1 fallback if unavailable),
          strips Markdown server-side before sending to OpenAI (no more "Sternchen"),
          accepts new `instructions` and `raw` body params, and returns a true StreamingResponse
          using httpx async streaming (build_request + send(stream=True) + aiter_bytes).
          /api/voice/options expanded from 6 to 11 voices including premium marin/cedar.
      - working: false
        agent: "testing"
        comment: |
          ❌ CRITICAL CONFIGURATION ISSUE - OpenAI API key not configured
          
          Test Results (9 tests total):
          ✅ PASSED (3/9):
          - Voice Options endpoint: 11 voices verified, premium flags (marin/cedar) correct, is_new flags (ash/coral/sage) correct, default_voice returned
          - Empty text validation: correctly returns 400 for empty text
          - Markdown-only text validation: correctly returns 400 for text that becomes empty after Markdown stripping
          
          ❌ FAILED (6/9) - All due to missing OpenAI API key:
          - Basic TTS: 400 "OpenAI API Key nicht konfiguriert"
          - Markdown stripping: 400 "OpenAI API Key nicht konfiguriert"
          - Long text truncation: 400 "OpenAI API Key nicht konfiguriert"
          - Premium voice 'marin': 400 "OpenAI API Key nicht konfiguriert"
          - Raw mode: 400 "OpenAI API Key nicht konfiguriert"
          - Instructions parameter: 400 "OpenAI API Key nicht konfiguriert"
          
          ROOT CAUSE:
          - Database query shows: db.settings.findOne({key: "openai_api_key"}) returns null
          - The get_llm_api_key() function in server.py only checks database, no environment variable fallback
          - TTS endpoint correctly validates and returns 400 when API key is missing
          
          CODE REVIEW (Implementation is correct):
          - ✅ Markdown stripping function strip_markdown_for_tts() properly implemented with comprehensive regex patterns
          - ✅ Text truncation to 3500 chars implemented
          - ✅ Primary/fallback model logic (gpt-4o-mini-tts -> tts-1) correctly implemented
          - ✅ Premium voice fallback (marin/cedar -> nova) correctly implemented
          - ✅ StreamingResponse with X-TTS-Model header correctly implemented
          - ✅ Raw mode and instructions parameters correctly handled
          - ✅ Empty text validation correctly implemented
          - ✅ VOICE_OPTIONS array has all 11 voices with correct flags
          
          RESOLUTION REQUIRED:
          The OpenAI API key must be configured via PUT /api/admin/settings with {"openai_api_key": "sk-..."}.
          Without a valid API key, TTS audio generation cannot be tested or used.
          The implementation is correct but cannot function without this configuration.

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 2
  run_ui: false

test_plan:
  current_focus:
    - "TTS upgrade backend (gpt-4o-mini-tts + streaming + Markdown strip)"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: |
      Backend feature added: personalized voice greeting after login.
      (PASSED in round 1 — keep status, not under test now.)
  - agent: "testing"
    message: |
      ✅ Round 1 complete (15/15 assertions). See per-task status_history above.
  - agent: "main"
    message: |
      Round 2: please test the upgraded /api/voice/tts only.
      1. POST /api/voice/tts {"text":"Hallo Welt"} -> 200, audio/mpeg, body length > 1000 bytes. Header X-TTS-Model should be either "gpt-4o-mini-tts" or "tts-1".
      2. POST with text containing Markdown like "**Hallo** *Welt* `code` # H [link](http://x)" -> 200, length > 500. (We can't easily ASR — verify via no error and reasonable size.)
      3. POST with text >3500 chars -> still 200 (server truncates).
      4. POST with voice="marin" -> 200; if account lacks gpt-4o-mini-tts access, fallback rewrites to "nova" without erroring.
      5. POST {"text":"hi","raw":true} -> 200.
      6. POST {"text":"hi","instructions":"speak slowly"} -> 200.
      7. GET /api/voice/options -> voices array contains marin/cedar with premium=true; ash/coral/sage with is_new=true.

      Streaming verification: with curl --no-buffer, first bytes should arrive quickly. Use existing test creds from /app/memory/test_credentials.md.
  - agent: "testing"
    message: |
      ⚠️ Round 2 testing blocked by CRITICAL CONFIGURATION ISSUE
      
      SUMMARY:
      - ✅ Voice options endpoint fully working (3/3 validation tests passed)
      - ✅ Input validation working (empty text, Markdown-only text)
      - ❌ TTS audio generation BLOCKED: OpenAI API key not configured in database
      
      The TTS implementation code is correct (verified via code review):
      - Markdown stripping, text truncation, model fallback, premium voice fallback, streaming, all parameters correctly implemented
      
      However, all 6 TTS audio generation tests return 400 "OpenAI API Key nicht konfiguriert" because:
      - db.settings.findOne({key: "openai_api_key"}) returns null
      - No environment variable fallback exists in get_llm_api_key()
      
      REQUIRED ACTION:
      Configure OpenAI API key via PUT /api/admin/settings with {"openai_api_key": "sk-..."} before TTS can be tested or used.
      
      Test file created: /app/backend_tts_test.py (can be re-run after API key is configured)
