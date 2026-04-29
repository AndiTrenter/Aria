"""Tests for V 8.5 CookPilot action extensions:
  - pantry consume (negative adjust)
  - low-stock query
  - recipe-to-shopping
"""
import os, sys
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
            return {"value": "secret"}
        return None
    db.settings.find_one = AsyncMock(side_effect=find_one)
    db.settings.update_one = AsyncMock()
    db.cookpilot_tokens = MagicMock()
    db.cookpilot_tokens.find_one = AsyncMock(return_value={"token": "JWT", "expires_at": "2099-01-01T00:00:00+00:00"})
    db.cookpilot_tokens.update_one = AsyncMock()
    return db


# ============== Intent unit tests ==============

@pytest.mark.parametrize("msg,expected_name,expected_delta", [
    ("Ich habe 0.5 Liter Milch getrunken", "milch", -0.5),
    ("Ich hab 200 g Käse aufgebraucht", "käse", -200),
    ("Hab gerade 1 Stk Brot gegessen", "brot", -1),
    ("0.3 Liter Milch verbraucht", "milch", -0.3),
])
def test_pantry_consume_detection(msg, expected_name, expected_delta):
    result = cookpilot._detect_pantry_consume(msg)
    assert result is not None, f"Expected detection: {msg}"
    name, delta, _ = result
    assert expected_name in name.lower(), f"Got name={name}"
    assert abs(delta - expected_delta) < 0.001, f"Got delta={delta}"


@pytest.mark.parametrize("msg", [
    "Was geht zur Neige?",
    "Was ist unter Mindestbestand?",
    "Was wird knapp?",
    "Was muss ich noch kaufen?",
    "Was fehlt im Vorrat?",
])
def test_low_stock_detection_positive(msg):
    assert cookpilot._detect_low_stock_query(msg) is True


@pytest.mark.parametrize("msg", [
    "Wieviel Milch haben wir?",
    "Was kann ich kochen?",
    "Hallo Aria",
])
def test_low_stock_detection_negative(msg):
    assert cookpilot._detect_low_stock_query(msg) is False


@pytest.mark.parametrize("msg,expected", [
    ("Setze die Zutaten für Lasagne auf die Einkaufsliste", "lasagne"),
    ("Füge die Zutaten von Pizza Margherita zur Einkaufsliste hinzu", "pizza margherita"),
    ("Einkaufsliste für Spaghetti Bolognese", "spaghetti bolognese"),
])
def test_recipe_to_shopping_detection(msg, expected):
    name = cookpilot._detect_recipe_to_shopping(msg)
    assert name is not None, f"Expected detection: {msg}"
    assert expected in name.lower()


# ============== Integration tests ==============

@pytest.mark.asyncio
async def test_pantry_consume_actually_adjusts():
    cookpilot.db = _mock_db()
    pantry = [{"id": "milch-1", "name": "Milch", "amount": 1.0, "unit": "Liter"}]
    posts = []

    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def request(self, method, url, headers=None, json=None, params=None):
            if method == "GET" and "/pantry" in url and "/adjust" not in url:
                return _Resp(pantry)
            if method == "POST" and "/adjust" in url:
                posts.append({"url": url, "json": json})
                return _Resp({"id": "milch-1", "name": "Milch", "amount": 0.5, "unit": "Liter"}, 200)
            return _Resp({}, 404)

    with patch("cookpilot.httpx.AsyncClient", lambda *a, **k: _Client()):
        result = await cookpilot.try_execute_cookpilot_action(
            "Ich habe 0.5 Liter Milch getrunken",
            {"id": "u1", "email": "x@x", "name": "X", "role": "admin"},
        )
    assert result is not None and result["executed"], f"Expected executed=true, got {result}"
    assert result["action"] == "pantry_consume"
    assert any("/api/pantry/milch-1/adjust" in p["url"] for p in posts), f"Posts: {posts}"
    assert posts[0]["json"]["delta"] == -0.5


@pytest.mark.asyncio
async def test_low_stock_returns_summary_when_items_below():
    cookpilot.db = _mock_db()
    low_items = [{"id": "x", "name": "Milch", "amount": 0.3, "min_amount": 1, "unit": "Liter"}]

    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def request(self, method, url, headers=None, json=None, params=None):
            if "/low-stock" in url:
                return _Resp(low_items)
            return _Resp([], 404)

    with patch("cookpilot.httpx.AsyncClient", lambda *a, **k: _Client()):
        result = await cookpilot.try_execute_cookpilot_action(
            "Was geht zur Neige?",
            {"id": "u1", "email": "x@x", "name": "X", "role": "admin"},
        )
    assert result["executed"]
    assert "Milch" in result["summary"]
    assert "0.3" in result["summary"] and "1" in result["summary"]


@pytest.mark.asyncio
async def test_low_stock_all_good():
    cookpilot.db = _mock_db()

    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def request(self, method, url, headers=None, json=None, params=None):
            if "/low-stock" in url:
                return _Resp([])
            return _Resp([], 404)

    with patch("cookpilot.httpx.AsyncClient", lambda *a, **k: _Client()):
        result = await cookpilot.try_execute_cookpilot_action(
            "Was wird knapp?",
            {"id": "u1", "email": "x@x", "name": "X", "role": "admin"},
        )
    assert result["executed"]
    assert "Alles gut" in result["summary"] or "kein" in result["summary"].lower()


@pytest.mark.asyncio
async def test_recipe_to_shopping_finds_and_posts():
    cookpilot.db = _mock_db()
    recipes_list = [{"id": "r1", "title": "Lasagne", "servings": 4}]
    posts = []

    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def request(self, method, url, headers=None, json=None, params=None):
            if "/recipes" in url and method == "GET":
                return _Resp(recipes_list)
            if "/from-recipe" in url and method == "POST":
                posts.append(json)
                return _Resp({"added": 5, "merged": 1}, 200)
            return _Resp({}, 404)

    with patch("cookpilot.httpx.AsyncClient", lambda *a, **k: _Client()):
        result = await cookpilot.try_execute_cookpilot_action(
            "Setze die Zutaten für Lasagne auf die Einkaufsliste",
            {"id": "u1", "email": "x@x", "name": "X", "role": "admin"},
        )
    assert result is not None and result["executed"], f"Got: {result}"
    assert result["action"] == "recipe_to_shopping"
    assert posts[0]["recipe_id"] == "r1"
    assert "5 neu" in result["summary"]


@pytest.mark.asyncio
async def test_pantry_consume_item_not_found():
    cookpilot.db = _mock_db()

    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def request(self, method, url, headers=None, json=None, params=None):
            if "/pantry" in url and method == "GET":
                return _Resp([])
            return _Resp({}, 404)

    with patch("cookpilot.httpx.AsyncClient", lambda *a, **k: _Client()):
        result = await cookpilot.try_execute_cookpilot_action(
            "Ich habe 0.5 Liter Milch getrunken",
            {"id": "u1", "email": "x@x", "name": "X", "role": "admin"},
        )
    assert result is not None
    assert result["executed"] is False
    assert "nicht im Vorrat" in (result.get("error") or "")
