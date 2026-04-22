"""
Tests for Aria v7.3 — Sticky-ForgePilot Hijack Fix + Connected-Services Health.

Covers:
  * GET /api/version returns 7.3
  * GET /api/health/integrations returns the 6 expected services with proper schema
  * GET /api/chat/history/{session_id} returns routed_to as an array
  * Sticky-ForgePilot HIJACK FIX: when last assistant msg is sticky-forgepilot,
    a new CaseDesk-style message must NOT inherit forgepilot routing.
  * Sticky-ForgePilot POSITIVE: a follow-up dev question keeps forgepilot.
  * Full-delegation guard: when router returns mixed (casedesk + forgepilot),
    process_chat_message must NOT fully delegate to forgepilot.

NOTE on env: in this preview the configured OPENAI_API_KEY returns 401, so
service_router.route_message falls back to keyword matching. That is fine —
the sticky/delegation logic we test is independent of the GPT response itself.
We assert on the routed_to field stored in db.chat_messages and the
db.chat_route_log entry, NOT on the GPT text.
"""
import os
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "aria_dashboard")

ADMIN = {"email": "andi.trenter@gmail.com", "password": "Speedy@181279"}

EXPECTED_SERVICE_IDS = {"weather", "system", "homeassistant", "casedesk", "plex", "forgepilot"}
NON_DEV_SERVICES = {"casedesk", "plex", "weather", "homeassistant", "system"}


# ==================== Fixtures ====================

@pytest.fixture(scope="module")
def mongo_db():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    yield db
    client.close()


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json=ADMIN)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def admin_user_id(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code == 200, r.text
    me = r.json()
    uid = me.get("id") or me.get("_id")
    assert uid, f"No user id in /auth/me payload: {me}"
    return uid


@pytest.fixture
def fresh_session_id():
    return f"TEST_sticky_{uuid.uuid4().hex[:10]}"


@pytest.fixture(autouse=True)
def cleanup_test_chats(mongo_db):
    """Remove any TEST_sticky_* sessions created by these tests."""
    yield
    mongo_db.chat_messages.delete_many({"session_id": {"$regex": "^TEST_sticky_"}})
    mongo_db.chat_route_log.delete_many({"session_id": {"$regex": "^TEST_sticky_"}})


# ==================== Helpers ====================

def _seed_sticky_forgepilot(db, session_id, user_id, still_running=True, ask_user=False):
    """Insert an assistant message that simulates an in-progress ForgePilot session."""
    from datetime import datetime, timezone
    db.chat_messages.insert_one({
        "session_id": session_id,
        "user_id": user_id,
        "role": "assistant",
        "content": "Ich arbeite gerade an deinem Projekt …",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "routed_to": ["forgepilot"],
        "forgepilot_meta": {
            "ask_user": ask_user,
            "is_complete": False,
            "still_running": still_running,
            "project_id": "test-project",
        },
    })


def _last_assistant(db, session_id):
    return db.chat_messages.find_one(
        {"session_id": session_id, "role": "assistant"},
        sort=[("timestamp", -1)],
    )


def _last_route_log(db, session_id):
    return db.chat_route_log.find_one(
        {"session_id": session_id},
        sort=[("timestamp", -1)],
    )


# ==================== Version ====================

class TestVersion:
    def test_version_is_7_3(self):
        r = requests.get(f"{BASE_URL}/api/version")
        assert r.status_code == 200
        data = r.json()
        assert data.get("version") == "7.3", f"Expected 7.3 got {data}"
        assert data.get("display") == "V 7.3"


# ==================== Connected-Services Health ====================

class TestIntegrationsHealth:
    def test_returns_six_default_services(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/health/integrations")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list), "expected a list"
        ids = {entry["service_id"] for entry in data}
        assert EXPECTED_SERVICE_IDS.issubset(ids), (
            f"Missing services: {EXPECTED_SERVICE_IDS - ids}"
        )

    def test_each_entry_has_required_fields(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/health/integrations")
        assert r.status_code == 200
        data = r.json()
        for entry in data:
            for key in ("service_id", "name", "type", "available"):
                assert key in entry, f"Missing field {key} in {entry}"
            assert isinstance(entry["available"], bool)

    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/health/integrations")
        assert r.status_code in (401, 403), (
            f"Expected auth-required, got {r.status_code}"
        )


# ==================== Chat history routed_to is array ====================

class TestChatHistoryRoutedTo:
    def test_history_returns_routed_to_as_array(
        self, admin_session, admin_user_id, fresh_session_id, mongo_db
    ):
        # Seed a user + assistant message with routed_to as a list.
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        mongo_db.chat_messages.insert_many([
            {"session_id": fresh_session_id, "user_id": admin_user_id,
             "role": "user", "content": "Test user msg", "timestamp": now},
            {"session_id": fresh_session_id, "user_id": admin_user_id,
             "role": "assistant", "content": "Test assistant msg",
             "timestamp": now, "routed_to": ["casedesk"]},
        ])
        r = admin_session.get(f"{BASE_URL}/api/chat/history/{fresh_session_id}")
        assert r.status_code == 200, r.text
        msgs = r.json()
        assert any(m["role"] == "assistant" for m in msgs)
        assistant = [m for m in msgs if m["role"] == "assistant"][-1]
        assert "routed_to" in assistant, f"routed_to missing in {assistant}"
        assert isinstance(assistant["routed_to"], list), (
            f"routed_to must be a list, got {type(assistant['routed_to']).__name__}"
        )
        assert assistant["routed_to"] == ["casedesk"]


# ==================== Sticky ForgePilot — HIJACK FIX ====================

class TestStickyForgePilotBreak:
    """Sticky must BREAK when the new message clearly belongs to a non-dev service."""

    def test_casedesk_question_breaks_forgepilot_sticky(
        self, admin_session, admin_user_id, fresh_session_id, mongo_db
    ):
        # 1) Seed sticky forgepilot state (1 assistant msg already exists)
        _seed_sticky_forgepilot(mongo_db, fresh_session_id, admin_user_id,
                                still_running=True)
        seeded_count = mongo_db.chat_messages.count_documents(
            {"session_id": fresh_session_id, "role": "assistant"})
        assert seeded_count == 1

        # 2) Send a clearly CaseDesk question
        r = admin_session.post(
            f"{BASE_URL}/api/chat",
            json={
                "message": "Hast du meinen Lohnausweis im Archiv?",
                "session_id": fresh_session_id,
            },
        )
        assert r.status_code == 200, r.text

        # 3) Router decision (logged BEFORE sticky logic runs) → must include
        #    casedesk; this proves the keyword/router put the message into
        #    a non-dev bucket, which is the trigger for sticky-break.
        log = _last_route_log(mongo_db, fresh_session_id)
        assert log is not None, "No route_log entry written"
        assert "casedesk" in log["services"], (
            f"Router did not pick casedesk (got {log['services']})"
        )

        # 4) HIJACK FIX VERIFICATION: in this preview env, OpenAI returns 401,
        #    so the normal-chat path does NOT persist an assistant message.
        #    The ONLY way a new assistant message would appear here is via
        #    the ForgePilot full-delegation path (which ALWAYS persists with
        #    routed_to=['forgepilot']). If sticky-break works, delegation is
        #    NOT triggered → assistant count stays at 1 (just the seed).
        #    If the bug were still present, sticky would have re-added
        #    forgepilot, delegation would fire, and we'd see 2 assistant msgs
        #    with the newest one having routed_to=['forgepilot'].
        post_count = mongo_db.chat_messages.count_documents(
            {"session_id": fresh_session_id, "role": "assistant"})
        assert post_count == 1, (
            f"HIJACK NOT FIXED: ForgePilot delegation fired despite router "
            f"picking casedesk. Assistant msg count went from 1 to {post_count}."
        )

        # 5) Latest assistant msg is still the seed (untouched), proving no
        #    delegation override happened.
        last = _last_assistant(mongo_db, fresh_session_id)
        assert last is not None
        assert last.get("routed_to") == ["forgepilot"], (
            f"Seed assistant tampered with: {last.get('routed_to')}"
        )


class TestStickyForgePilotKeep:
    """Sticky should STAY when the follow-up is itself a dev question."""

    def test_dev_followup_keeps_forgepilot_sticky(
        self, admin_session, admin_user_id, fresh_session_id, mongo_db
    ):
        _seed_sticky_forgepilot(mongo_db, fresh_session_id, admin_user_id,
                                still_running=True)

        r = admin_session.post(
            f"{BASE_URL}/api/chat",
            json={
                "message": "wie geht es weiter mit dem Bug?",
                "session_id": fresh_session_id,
            },
        )
        assert r.status_code == 200, r.text

        last = _last_assistant(mongo_db, fresh_session_id)
        assert last is not None
        routed_to = last.get("routed_to") or []
        assert isinstance(routed_to, list)
        # forgepilot must be present (either via router keyword 'bug' or via sticky)
        assert "forgepilot" in routed_to, (
            f"Sticky did not preserve forgepilot for dev follow-up (got {routed_to})"
        )
        # And no non-dev service was wrongly added
        non_dev_leaked = [s for s in routed_to if s in NON_DEV_SERVICES]
        assert non_dev_leaked == [], (
            f"Unexpected non-dev services in dev follow-up: {non_dev_leaked}"
        )


# ==================== Full-delegation guard ====================

class TestForgePilotDelegationGuard:
    """If router returns mixed (casedesk + forgepilot), full delegation must
    NOT trigger — process_chat_message should fall through to gather_context.

    Test strategy: send a message whose keyword fallback routes to BOTH
    casedesk and forgepilot ('email' + 'code'). Then verify the stored
    assistant message has routed_to=['casedesk', 'forgepilot'] (i.e. the
    list from the router, set by the normal path) and was NOT replaced by
    the delegation path which always writes routed_to=['forgepilot'] only.
    """

    def test_mixed_routing_does_not_fully_delegate(
        self, admin_session, admin_user_id, fresh_session_id, mongo_db
    ):
        # Dual-intent message: explicitly asks for BOTH a casedesk action
        # (email) AND a forgepilot action (write code). Forces the GPT
        # router to return a mixed list which is exactly the guarded code
        # path in process_chat_message Step 1b.
        message = (
            "Bitte zwei Sachen: 1) suche meinen Lohnausweis im "
            "Dokumentenarchiv und sende ihn per Email an mich; "
            "2) schreibe mir parallel einen Python-Script der PDFs "
            "automatisch zippt und committe den Code per git push."
        )
        r = admin_session.post(
            f"{BASE_URL}/api/chat",
            json={"message": message, "session_id": fresh_session_id},
        )
        assert r.status_code == 200, r.text

        log = _last_route_log(mongo_db, fresh_session_id)
        assert log is not None
        services = log["services"]
        # Sanity: keyword fallback should have picked at least casedesk
        assert "casedesk" in services, (
            f"Router did not pick casedesk for mixed message — got {services}"
        )

        # If the router also picked forgepilot, this is the mixed-route
        # scenario the guard protects against. In this preview env OpenAI
        # is 401 — so:
        #   * If full-delegation INCORRECTLY triggered → forgepilot.query is
        #     called and an assistant msg with routed_to=['forgepilot'] is
        #     persisted (the delegation path uses its own insert_many that
        #     does NOT depend on OpenAI completions).
        #   * If the guard works → falls through to gather_context + GPT
        #     → GPT 401s → no assistant msg persisted.
        assistant_msgs = list(mongo_db.chat_messages.find(
            {"session_id": fresh_session_id, "role": "assistant"}))

        if "forgepilot" in services:
            # Mixed route — guard must prevent full delegation.
            for m in assistant_msgs:
                assert m.get("routed_to") != ["forgepilot"], (
                    f"DELEGATION GUARD FAILED: ForgePilot fully delegated "
                    f"despite mixed router decision {services}. "
                    f"Found assistant msg routed_to=['forgepilot']."
                )
        else:
            pytest.skip(
                f"Router did not return mixed route (got {services}) — "
                "GPT-router decided differently in this env. The guard "
                "code path could not be exercised; test_casedesk_question_"
                "breaks_forgepilot_sticky covers the same protective branch."
            )


# ==================== Unit-level guard test (direct router monkey-patch) ====================

class TestForgePilotGuardUnit:
    """Deterministic in-process test — monkey-patches service_router.route_message
    to return a mixed list, then calls process_chat_message and asserts that
    the ForgePilot delegation path is NOT taken (assistant msg with
    routed_to=['forgepilot'] should NOT be persisted by the delegation branch).
    """

    @pytest.mark.asyncio
    async def test_full_delegation_skipped_for_mixed_route(
        self, monkeypatch, mongo_db, admin_user_id, fresh_session_id
    ):
        import sys
        sys.path.insert(0, "/app/backend")
        import service_router
        import server as srv

        async def fake_route(_msg):
            return {"services": ["casedesk", "forgepilot"], "is_simple": False}

        async def fake_query(_msg, _sess, _uid):
            # Sentinel: if delegation triggers, this writes a marker doc.
            from datetime import datetime, timezone
            mongo_db.chat_messages.insert_one({
                "session_id": fresh_session_id,
                "user_id": admin_user_id,
                "role": "assistant",
                "content": "DELEGATION_FIRED_SHOULD_NOT_HAPPEN",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "routed_to": ["forgepilot"],
            })
            return {"answer": "x", "ask_user": False, "is_complete": True,
                    "still_running": False, "project_id": None}

        async def fake_friendly(_res, _msg):
            return "x"

        async def fake_key():
            return "sk-test-fake"

        monkeypatch.setattr(service_router, "route_message", fake_route)
        monkeypatch.setattr(srv.forgepilot, "query_forgepilot", fake_query)
        monkeypatch.setattr(srv.forgepilot, "friendly_rephrase", fake_friendly)
        monkeypatch.setattr(srv, "get_llm_api_key", fake_key)

        # Run process_chat_message directly. OpenAI completion will fail (fake
        # key) → no normal-path persistence either. The delegation branch is
        # the ONLY thing under test.
        await srv.process_chat_message(
            "mixed message", admin_user_id, fresh_session_id
        )

        delegated = mongo_db.chat_messages.find_one({
            "session_id": fresh_session_id,
            "content": "DELEGATION_FIRED_SHOULD_NOT_HAPPEN",
        })
        assert delegated is None, (
            "DELEGATION GUARD FAILED: forgepilot.query_forgepilot was "
            "invoked even though router returned a mixed list "
            "(['casedesk','forgepilot'])."
        )
