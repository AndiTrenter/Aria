"""Unit tests for cookpilot.get_cookpilot_context formatter — ensures the
'Milch: Liter' bug from V8.0 stays fixed in V8.1+.

We monkey-patch httpx so the function returns a deterministic pantry payload
and assert the formatted GPT-context string is unambiguous.
"""
import os
import sys
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import cookpilot  # noqa: E402


class _Resp:
    def __init__(self, payload, status=200):
        self._p = payload
        self.status_code = status
    def json(self):
        return self._p


def _mock_db():
    """Minimal mongo stub for cookpilot."""
    db = MagicMock()
    # get_cookpilot_settings reads url + secret
    db.settings = MagicMock()
    async def find_one(query):
        if query.get("key") == "cookpilot_url":
            return {"value": "http://stub:8010"}
        if query.get("key") == "cookpilot_shared_secret":
            return {"value": "secret123"}
        if query.get("key") == "_cookpilot_health_cache":
            return None
        return None
    db.settings.find_one = AsyncMock(side_effect=find_one)
    db.settings.update_one = AsyncMock()
    db.cookpilot_tokens = MagicMock()
    db.cookpilot_tokens.find_one = AsyncMock(return_value={"token": "JWT_FAKE", "expires_at": "2099-01-01T00:00:00+00:00"})
    db.cookpilot_tokens.update_one = AsyncMock()
    return db


@pytest.mark.asyncio
async def test_milch_liter_no_quantity_is_explicit():
    """Vorrat-Item Milch mit unit='Liter' und ohne quantity darf NICHT als
    'Milch: Liter' erscheinen — das misinterpretiert GPT als Wert."""
    cookpilot.db = _mock_db()
    # Build a fake httpx response sequence: 1st call=pantry
    pantry_payload = [
        {"name": "Milch", "unit": "Liter", "quantity": None},
        {"name": "Eier", "unit": "Stk", "quantity": 6},
    ]
    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, headers=None, params=None):
            if "/api/pantry" in url:
                return _Resp(pantry_payload)
            return _Resp([])
        async def post(self, *a, **k): return _Resp({})

    with patch("cookpilot.httpx.AsyncClient", lambda *a, **k: _Client()):
        ctx = await cookpilot.get_cookpilot_context(
            "wieviel milch haben wir?",
            {"id": "u1", "email": "x@x", "name": "X", "role": "admin"},
        )
    assert "Milch:" in ctx, f"Expected Milch line in ctx, got: {ctx}"
    # The bug: 'Milch: Liter' (without quantity)
    assert "Milch: Liter" not in ctx, f"BUG: ambiguous 'Milch: Liter' in ctx: {ctx}"
    # The fix: explicit text
    assert "Menge nicht erfasst" in ctx, f"Expected explicit '(Menge nicht erfasst...)' marker, got: {ctx}"


@pytest.mark.asyncio
async def test_milch_with_quantity_unit_renders_normally():
    cookpilot.db = _mock_db()
    pantry_payload = [{"name": "Milch", "unit": "L", "quantity": 1.5}]
    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, headers=None, params=None):
            return _Resp(pantry_payload if "/pantry" in url else [])
    with patch("cookpilot.httpx.AsyncClient", lambda *a, **k: _Client()):
        ctx = await cookpilot.get_cookpilot_context(
            "wieviel milch haben wir?",
            {"id": "u1", "email": "x@x", "name": "X", "role": "admin"},
        )
    assert "Milch: 1.5 L" in ctx, f"Expected 'Milch: 1.5 L', got: {ctx}"


@pytest.mark.asyncio
async def test_milch_with_amount_field_renders_correctly():
    """REGRESSION: CookPilot returns 'amount' (not 'quantity'). Aria must
    accept amount as primary field. Without this fix Aria would render
    'Milch: Liter' even when CookPilot has 0.3 stored."""
    cookpilot.db = _mock_db()
    pantry_payload = [{"name": "Milch", "unit": "Liter", "amount": 0.3}]
    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, headers=None, params=None):
            return _Resp(pantry_payload if "/pantry" in url else [])
    with patch("cookpilot.httpx.AsyncClient", lambda *a, **k: _Client()):
        ctx = await cookpilot.get_cookpilot_context(
            "wieviel milch haben wir?",
            {"id": "u1", "email": "x@x", "name": "X", "role": "admin"},
        )
    assert "Milch: 0.3 Liter" in ctx, f"BUG: 'amount' field not honored — ctx: {ctx}"
    assert "Menge nicht erfasst" not in ctx, f"BUG: amount=0.3 incorrectly treated as missing — ctx: {ctx}"


@pytest.mark.asyncio
async def test_focus_filter_isolates_specific_item():
    cookpilot.db = _mock_db()
    pantry_payload = [
        {"name": "Milch", "unit": "L", "quantity": 1},
        {"name": "Brot", "unit": "Stk", "quantity": 2},
        {"name": "Eier", "unit": "Stk", "quantity": 6},
    ]
    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, headers=None, params=None):
            return _Resp(pantry_payload if "/pantry" in url else [])
    with patch("cookpilot.httpx.AsyncClient", lambda *a, **k: _Client()):
        ctx = await cookpilot.get_cookpilot_context(
            "wieviel milch haben wir noch?",
            {"id": "u1", "email": "x@x", "name": "X", "role": "admin"},
        )
    assert "Treffer für deine Frage" in ctx, f"Expected focused header, got: {ctx}"
    assert "Milch" in ctx
    # When focused, we should NOT also show the full 3-item list
    assert ctx.count("Brot") == 0, f"Expected Brot to be filtered out, got: {ctx}"


@pytest.mark.asyncio
async def test_pantry_keyword_wieviel_triggers_lookup():
    """Without 'vorrat'/'lebensmittel' but with 'wieviel' the pantry should
    still be fetched (intent extension in V8.1)."""
    cookpilot.db = _mock_db()
    pantry_payload = [{"name": "Milch", "unit": "L", "quantity": 1}]
    seen = {"recipes": False, "pantry": False}
    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, headers=None, params=None):
            if "/pantry" in url:
                seen["pantry"] = True
                return _Resp(pantry_payload)
            if "/recipes" in url:
                seen["recipes"] = True
                return _Resp([])
            return _Resp([])
    with patch("cookpilot.httpx.AsyncClient", lambda *a, **k: _Client()):
        await cookpilot.get_cookpilot_context(
            "wieviel milch haben wir?",
            {"id": "u1", "email": "x@x", "name": "X", "role": "admin"},
        )
    assert seen["pantry"], "Pantry endpoint should have been called for 'wieviel milch'"
