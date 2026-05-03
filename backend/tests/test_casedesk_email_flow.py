"""Tests for V 8.8 E-Mail Draft / Confirm / Cancel flow."""
import os, sys, pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import casedesk  # noqa: E402


# ================= Intent detection =================

@pytest.mark.parametrize("msg", [
    "Schreibe eine Email an Luzia mit Betreff Geburtstag und Text: Happy Birthday!",
    "Sende bitte eine Mail an hans@example.com mit Betreff Rechnung und Inhalt: Siehe Anhang.",
    "Erstelle eine Email an Peter mit Betreff Hallo und Text Wie geht's?",
    "Verfasse eine E-Mail an anna.meier@test.ch betreff Terminbestätigung text: Ich komme gerne.",
])
def test_email_draft_intent_detected(msg):
    intent = casedesk._detect_email_intent(msg)
    assert intent is not None, f"Expected detection: {msg}"
    assert intent.get("subject"), f"Expected subject, got: {intent}"


@pytest.mark.parametrize("msg", [
    "Wie ist das Wetter?",
    "Zeig mir meine Einkaufsliste",
    "Was kann ich kochen?",
])
def test_email_draft_intent_not_detected(msg):
    assert casedesk._detect_email_intent(msg) is None


@pytest.mark.parametrize("msg,expected", [
    ("Aria, ja versende die email jetzt", "send"),
    ("ja sende die mail", "send"),
    ("jetzt senden", "send"),
    ("ja bestätigen", "send"),
    ("bestätigt senden", "send"),
    ("Nein, verwerfen", "cancel"),
    ("entwurf löschen", "cancel"),
    ("abbrechen", "cancel"),
    ("doch nicht", "cancel"),
    ("Wie ist das Wetter?", None),
    ("Zeig meinen Vorrat", None),
])
def test_email_confirmation_detection(msg, expected):
    assert casedesk._detect_email_confirmation(msg) == expected


# ================= Draft flow =================

def _mock_db_with_drafts():
    db = MagicMock()
    db.aria_email_drafts = MagicMock()
    store = {}
    async def insert_one(doc):
        store[doc["id"]] = doc
        return MagicMock(inserted_id=doc["id"])
    async def find_one(q, proj=None, sort=None):
        candidates = [d for d in store.values() if
                      (q.get("aria_user_id") in (None, d.get("aria_user_id"))) and
                      (q.get("session_id") in (None, d.get("session_id"))) and
                      (q.get("status") in (None, d.get("status")))]
        if not candidates: return None
        if sort:
            candidates.sort(key=lambda d: d.get("created_at", ""), reverse=True)
        r = candidates[0].copy()
        if proj and "_id" in proj and proj["_id"] == 0:
            r.pop("_id", None)
        return r
    async def update_one(q, upd):
        updated = 0
        for d in store.values():
            if all(d.get(k) == v for k, v in q.items() if k != "sort"):
                d.update((upd.get("$set") or {}))
                updated += 1
                break  # latest-one semantics
        return MagicMock(modified_count=updated)
    db.aria_email_drafts.insert_one = insert_one
    db.aria_email_drafts.find_one = find_one
    db.aria_email_drafts.update_one = update_one
    db.settings = MagicMock()
    async def find_setting(q):
        return None
    db.settings.find_one = find_setting
    return db, store


@pytest.mark.asyncio
async def test_create_email_draft_stores_pending():
    db, store = _mock_db_with_drafts()
    casedesk.db = db
    with patch("casedesk.casedesk_request", AsyncMock(return_value=(None, None))):
        r = await casedesk.create_email_draft(
            {"id": "u1"},
            {"recipient_name": "Luzia", "recipient_email": "luzia@example.com",
             "subject": "Hallo", "body": "Wie geht's?"},
            session_id="sess-1",
        )
    assert r["draft_id"].startswith("draft-")
    stored = list(store.values())[0]
    assert stored["status"] == "pending_confirmation"
    assert stored["recipient_email"] == "luzia@example.com"
    assert "Luzia" in r["preview"] and "Hallo" in r["preview"]


@pytest.mark.asyncio
async def test_confirm_sends_draft_via_casedesk():
    db, store = _mock_db_with_drafts()
    casedesk.db = db
    # Seed a draft
    await db.aria_email_drafts.insert_one({
        "id": "draft-x", "aria_user_id": "u1", "session_id": "s1",
        "recipient_name": "Luzia", "recipient_email": "luzia@example.com",
        "subject": "Hi", "body": "Test", "status": "pending_confirmation",
        "created_at": "2026-04-30T10:00:00+00:00",
    })

    call_log = []
    async def fake_request(method, path, data=None, json=None):
        call_log.append((method, path, data, json))
        if path == "/ai/execute-action":
            return ({"success": True, "created": {"id": "corr-99"}}, None)
        if path == "/mail-accounts":
            return ([{"id": "acc-1"}], None)
        if path == "/ai/send-correspondence/corr-99":
            return ({"success": True, "status": "sent"}, None)
        return (None, "unknown")

    with patch("casedesk.casedesk_request", fake_request):
        r = await casedesk.confirm_and_send_latest_draft({"id": "u1"}, "s1")
    assert r["success"], f"Expected success, got: {r}"
    assert "Luzia" in r["message"]
    # Draft status updated
    assert store["draft-x"]["status"] == "sent"
    assert any("/ai/send-correspondence/corr-99" in p for _, p, _, _ in call_log)


@pytest.mark.asyncio
async def test_confirm_without_pending_draft_fails():
    db, _ = _mock_db_with_drafts()
    casedesk.db = db
    with patch("casedesk.casedesk_request", AsyncMock(return_value=(None, None))):
        r = await casedesk.confirm_and_send_latest_draft({"id": "u1"}, "s1")
    assert r["success"] is False
    assert "kein" in r["message"].lower() or "offen" in r["message"].lower()


@pytest.mark.asyncio
async def test_confirm_without_recipient_email_fails_clearly():
    db, _ = _mock_db_with_drafts()
    casedesk.db = db
    await db.aria_email_drafts.insert_one({
        "id": "draft-y", "aria_user_id": "u1", "session_id": "s1",
        "recipient_name": "Peter", "recipient_email": "",
        "subject": "x", "body": "y", "status": "pending_confirmation",
        "created_at": "2026-04-30T10:00:00+00:00",
    })
    with patch("casedesk.casedesk_request", AsyncMock(return_value=(None, None))):
        r = await casedesk.confirm_and_send_latest_draft({"id": "u1"}, "s1")
    assert r["success"] is False
    assert "E-Mail-Adresse" in r["message"] or "Adresse" in r["message"]


@pytest.mark.asyncio
async def test_cancel_sets_cancelled_status():
    db, store = _mock_db_with_drafts()
    casedesk.db = db
    await db.aria_email_drafts.insert_one({
        "id": "draft-z", "aria_user_id": "u1", "session_id": "s1",
        "recipient_name": "X", "recipient_email": "x@x",
        "subject": "s", "body": "b", "status": "pending_confirmation",
        "created_at": "2026-04-30T10:00:00+00:00",
    })
    r = await casedesk.cancel_latest_draft({"id": "u1"}, "s1")
    assert r["success"]
    assert store["draft-z"]["status"] == "cancelled"
