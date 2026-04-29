"""V 8.6 fix: when adding to shopping list, default amount must be 1 (not 0),
and explicit quantities/units in the user message must be preserved.

Reproduces the bug: 'Setze Brot auf die Einkaufsliste' → POST sent
{name:'Brot', amount:0} so CookPilot showed 'Brot 0'. Now must be amount:1.
"""
import os
import sys
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import cookpilot  # noqa: E402


# ---------- Unit tests for the parser ----------

@pytest.mark.parametrize("phrase,expected", [
    # Plain item → default qty 1
    ("Brot",                ("Brot", 1.0, "")),
    ("Milch",               ("Milch", 1.0, "")),
    ("Käse",                ("Käse", 1.0, "")),
    # Numeric prefix without unit → just count
    ("2 Brot",              ("Brot", 2.0, "")),
    ("3 Eier",              ("Eier", 3.0, "")),
    # Numeric + unit (with space)
    ("2 Liter Milch",       ("Milch", 2.0, "Liter")),
    ("0,5 kg Butter",       ("Butter", 0.5, "kg")),
    ("1,5 l Saft",          ("Saft", 1.5, "l")),
    # Numeric + unit (no space)
    ("500g Mehl",           ("Mehl", 500.0, "g")),
    ("250ml Sahne",         ("Sahne", 250.0, "ml")),
    ("2l Milch",            ("Milch", 2.0, "l")),
    # German number word
    ("eine Flasche Wein",   ("Wein", 1.0, "Flasche")),
    ("drei Eier",           ("Eier", 3.0, "")),
    ("zwei Packung Nudeln", ("Nudeln", 2.0, "Packung")),
    # Unit-only prefix → assume qty 1
    ("Becher Joghurt",      ("Joghurt", 1.0, "Becher")),
    ("Flasche Wasser",      ("Wasser", 1.0, "Flasche")),
    # Stück abbreviations
    ("3 Stück Brot",        ("Brot", 3.0, "Stück")),
    ("3 Stk Brot",          ("Brot", 3.0, "Stk")),
])
def test_parse_qty_unit_name(phrase, expected):
    name, amt, unit = cookpilot._parse_qty_unit_name(phrase)
    # Compare case-insensitively for name (German) and exact for amt/unit token
    assert name.lower() == expected[0].lower(), f"{phrase!r}: name {name!r} != {expected[0]!r}"
    assert amt == expected[1], f"{phrase!r}: amount {amt} != {expected[1]}"
    assert unit.lower() == expected[2].lower(), f"{phrase!r}: unit {unit!r} != {expected[2]!r}"


def test_parse_empty():
    assert cookpilot._parse_qty_unit_name("") == ("", 1.0, "")
    assert cookpilot._parse_qty_unit_name("   ") == ("", 1.0, "")


# ---------- Mock helpers ----------

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
    db.cookpilot_tokens.find_one = AsyncMock(return_value={"token": "JWT", "expires_at": "2099-01-01T00:00:00+00:00"})
    db.cookpilot_tokens.update_one = AsyncMock()
    return db


# ---------- Integration: verify amount sent to CookPilot ----------

@pytest.mark.asyncio
async def test_add_brot_defaults_to_amount_1():
    """The bug: 'Setze Brot auf die Einkaufsliste' was sending amount=0."""
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
            "Setze Brot auf die Einkaufsliste",
            {"id": "u1", "email": "x@x", "name": "X", "role": "admin"},
        )
    assert result and result["executed"]
    assert len(posted) == 1
    assert posted[0]["name"].lower() == "brot"
    assert posted[0]["amount"] == 1.0, f"Expected amount=1, got {posted[0]['amount']}"
    assert posted[0]["unit"] == ""


@pytest.mark.asyncio
async def test_add_with_explicit_quantity_and_unit():
    """'Füge 2 Liter Milch zur Einkaufsliste hinzu' → amount=2, unit='Liter'."""
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
            "Füge 2 Liter Milch zur Einkaufsliste hinzu",
            {"id": "u1", "email": "x@x", "name": "X", "role": "admin"},
        )
    assert result and result["executed"], f"Result: {result}"
    assert len(posted) == 1, f"Posted: {posted}"
    assert posted[0]["name"].lower() == "milch"
    assert posted[0]["amount"] == 2.0
    assert posted[0]["unit"].lower() == "liter"


@pytest.mark.asyncio
async def test_add_with_compact_quantity():
    """'500g Mehl auf die Einkaufsliste' → amount=500, unit='g'."""
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
            "500g Mehl auf die Einkaufsliste",
            {"id": "u1", "email": "x@x", "name": "X", "role": "admin"},
        )
    assert result and result["executed"], f"Result: {result}"
    assert len(posted) == 1
    assert posted[0]["name"].lower() == "mehl"
    assert posted[0]["amount"] == 500.0
    assert posted[0]["unit"].lower() == "g"


@pytest.mark.asyncio
async def test_add_multiple_items_each_default_qty_1():
    """Mixed items: 'Brot, 2 Liter Milch und Butter' → 3 POSTs with correct qtys."""
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
            "Setze Brot, 2 Liter Milch und Butter auf die Einkaufsliste",
            {"id": "u1", "email": "x@x", "name": "X", "role": "admin"},
        )
    assert result and result["executed"]
    by_name = {p["name"].lower(): p for p in posted}
    assert by_name["brot"]["amount"] == 1.0
    assert by_name["brot"]["unit"] == ""
    assert by_name["milch"]["amount"] == 2.0
    assert by_name["milch"]["unit"].lower() == "liter"
    assert by_name["butter"]["amount"] == 1.0
    assert by_name["butter"]["unit"] == ""
