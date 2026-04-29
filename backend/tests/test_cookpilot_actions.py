"""Tests for cookpilot.try_execute_cookpilot_action — verifies that German
write-action phrases are correctly parsed and dispatched to the right CookPilot
endpoint with the right items.

Critical for V 8.4: prevents the 'GPT lied that it added bread' bug.
"""
import os
import sys
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import cookpilot  # noqa: E402


class _Resp:
    def __init__(self, payload, status=200):
        self._p = payload
        self.status_code = status
        self.text = str(payload)
    def json(self):
        return self._p


def _mock_db():
    db = MagicMock()
    db.settings = MagicMock()
    async def find_one(query):
        if query.get("key") == "cookpilot_url":
            return {"value": "http://stub:8010"}
        if query.get("key") == "cookpilot_shared_secret":
            return {"value": "secret123"}
        return None
    db.settings.find_one = AsyncMock(side_effect=find_one)
    db.settings.update_one = AsyncMock()
    db.cookpilot_tokens = MagicMock()
    db.cookpilot_tokens.find_one = AsyncMock(return_value={"token": "JWT_FAKE", "expires_at": "2099-01-01T00:00:00+00:00"})
    db.cookpilot_tokens.update_one = AsyncMock()
    return db


# ============== UNIT: Intent parsers ==============

@pytest.mark.parametrize("msg,expected", [
    # Imperative add patterns
    ("Setze Brot auf die Einkaufsliste", ["Brot"]),
    ("Setz Brot auf die Einkaufsliste", ["Brot"]),
    ("Schreib Brot auf die Einkaufsliste", ["Brot"]),
    ("Schreibe Brot auf die Einkaufsliste", ["Brot"]),
    ("Trag Brot in die Einkaufsliste ein", ["Brot"]),
    ("Trage Brot zur Einkaufsliste", ["Brot"]),
    ("Füge Brot zur Einkaufsliste hinzu", ["Brot"]),
    ("Füge Brot der Einkaufsliste hinzu", ["Brot"]),
    ("Pack Brot auf die Einkaufsliste", ["Brot"]),
    ("Leg Brot auf die Einkaufsliste", ["Brot"]),
    # "X auf die Liste" prefix variant
    ("Brot auf die Einkaufsliste", ["Brot"]),
    ("Milch auf die Einkaufsliste setzen", ["Milch"]),
    # Multiple items
    ("Setze Brot, Milch und Butter auf die Einkaufsliste", ["Brot", "Milch", "Butter"]),
    ("Füge Eier, Käse und Wurst zur Einkaufsliste hinzu", ["Eier", "Käse", "Wurst"]),
    # Need / brauchen
    ("Ich brauche Brot", ["Brot"]),
    ("Ich brauche noch Brot", ["Brot"]),
    ("Brauchen wir Milch und Eier?", ["Milch", "Eier"]),
    # Kauf/besorg
    ("Kauf Brot ein", ["Brot"]),
    ("Besorg Milch und Brot ein", ["Milch", "Brot"]),
    # "X einkaufen" trailing
    ("Brot einkaufen", ["Brot"]),
])
def test_detect_shopping_add_positive(msg, expected):
    items = cookpilot._detect_shopping_add(msg)
    assert items is not None, f"Expected detection for: {msg!r}"
    # Compare case-insensitively
    assert [x.lower() for x in items] == [x.lower() for x in expected], f"For {msg!r}: got {items}, expected {expected}"


@pytest.mark.parametrize("msg", [
    "Was kann ich heute kochen?",      # read intent, not write
    "Wieviel Milch haben wir?",        # read intent
    "Hast du den Film Matrix?",        # totally unrelated
    "Wie ist das Wetter morgen?",      # weather
    "",                                # empty
])
def test_detect_shopping_add_negative(msg):
    items = cookpilot._detect_shopping_add(msg)
    assert items is None, f"Expected NO detection for: {msg!r}, got {items}"


@pytest.mark.parametrize("msg,expected", [
    ("Setze Brot auf gekauft", ["Brot"]),
    ("Markier Milch als gekauft", ["Milch"]),
    ("Hak Eier ab", ["Eier"]),
    ("Habe ich Brot gekauft", ["Brot"]),
    ("Brot ist gekauft", ["Brot"]),
])
def test_detect_shopping_check_positive(msg, expected):
    items = cookpilot._detect_shopping_check(msg)
    assert items is not None, f"Expected detection for: {msg!r}"
    assert [x.lower() for x in items] == [x.lower() for x in expected]


# ============== INTEGRATION: Action execution ==============

@pytest.mark.asyncio
async def test_brot_zur_einkaufsliste_actually_calls_post():
    """The original bug: user said 'füge Brot zur Einkaufsliste hinzu',
    Aria said 'erledigt' but never called CookPilot. Verify we now POST."""
    cookpilot.db = _mock_db()
    posted = []
    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, headers=None, json=None):
            posted.append({"url": url, "json": json})
            return _Resp({"id": "abc", **(json or {})}, 201)
        async def get(self, *a, **k): return _Resp([])

    with patch("cookpilot.httpx.AsyncClient", lambda *a, **k: _Client()):
        result = await cookpilot.try_execute_cookpilot_action(
            "Füge Brot zur Einkaufsliste hinzu",
            {"id": "u1", "email": "x@x", "name": "X", "role": "admin"},
        )

    assert result is not None, "Action must be detected"
    assert result["executed"], f"Action must execute. Result: {result}"
    assert result.get("action") == "shopping_add"
    assert "Brot" in result["items"]
    assert len(posted) == 1, f"Expected 1 POST, got {len(posted)}: {posted}"
    assert posted[0]["url"].endswith("/api/shopping")
    assert posted[0]["json"]["name"].lower() == "brot"


@pytest.mark.asyncio
async def test_multiple_items_split_correctly():
    cookpilot.db = _mock_db()
    posted = []
    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, headers=None, json=None):
            posted.append(json)
            return _Resp({"id": "x", **(json or {})}, 201)
        async def get(self, *a, **k): return _Resp([])

    with patch("cookpilot.httpx.AsyncClient", lambda *a, **k: _Client()):
        result = await cookpilot.try_execute_cookpilot_action(
            "Setze Brot, Milch und Butter auf die Einkaufsliste",
            {"id": "u1", "email": "x@x", "name": "X", "role": "admin"},
        )
    assert result["executed"]
    names = [p["name"].lower() for p in posted]
    assert "brot" in names and "milch" in names and "butter" in names, f"Got: {names}"


@pytest.mark.asyncio
async def test_read_question_returns_none():
    """'Wieviel Milch haben wir?' must NOT trigger a write action."""
    cookpilot.db = _mock_db()
    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k):
            raise AssertionError("Read intent must not POST")
        async def get(self, *a, **k): return _Resp([])

    with patch("cookpilot.httpx.AsyncClient", lambda *a, **k: _Client()):
        result = await cookpilot.try_execute_cookpilot_action(
            "Wieviel Milch haben wir?",
            {"id": "u1", "email": "x@x", "name": "X", "role": "admin"},
        )
    assert result is None, f"Read intent should not produce action result, got: {result}"


@pytest.mark.asyncio
async def test_permission_denied_for_non_admin_without_shopping_edit():
    """User without shopping_edit permission must be blocked."""
    cookpilot.db = _mock_db()
    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k):
            raise AssertionError("No write should happen without permission")
        async def get(self, *a, **k): return _Resp([])

    user = {"id": "u1", "email": "kid@x", "name": "Kid", "role": "kind",
            "cookpilot_perms": {"visible": True, "shopping_view": True, "shopping_edit": False}}
    with patch("cookpilot.httpx.AsyncClient", lambda *a, **k: _Client()):
        result = await cookpilot.try_execute_cookpilot_action(
            "Füge Brot zur Einkaufsliste hinzu", user,
        )
    assert result is not None
    assert result["executed"] is False
    assert "shopping_edit" in (result.get("error") or "").lower() or "berechtigung" in (result.get("error") or "").lower()


@pytest.mark.asyncio
async def test_check_shopping_actually_toggles():
    cookpilot.db = _mock_db()
    toggled = []
    existing = [
        {"id": "item-1", "name": "Brot", "checked": False, "amount": 1, "unit": "Stk"},
        {"id": "item-2", "name": "Milch", "checked": False, "amount": 1, "unit": "L"},
    ]

    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, headers=None, params=None):
            return _Resp(existing)
        async def post(self, url, headers=None, json=None):
            if "/toggle" in url:
                toggled.append(url)
                return _Resp({"checked": True}, 200)
            return _Resp({}, 200)

    with patch("cookpilot.httpx.AsyncClient", lambda *a, **k: _Client()):
        result = await cookpilot.try_execute_cookpilot_action(
            "Hak Brot ab",
            {"id": "u1", "email": "x@x", "name": "X", "role": "admin"},
        )
    assert result is not None
    assert result["executed"] is True
    assert any("/api/shopping/item-1/toggle" in t for t in toggled), f"Expected toggle of item-1, got: {toggled}"
