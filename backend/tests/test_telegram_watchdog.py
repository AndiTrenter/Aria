"""Tests for telegram_bot watchdog (V 8.7).

Verifies:
- _is_polling_healthy correctly identifies healthy/unhealthy states
- watchdog auto-restart triggers when polling is stale
- configure_watchdog persists settings to DB
"""
import os
import sys
from datetime import datetime, timezone, timedelta
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import telegram_bot  # noqa: E402


def _mock_db():
    db = MagicMock()
    db.settings = MagicMock()
    async def find_one(query):
        return None
    db.settings.find_one = AsyncMock(side_effect=find_one)
    db.settings.update_one = AsyncMock()
    return db


def _reset_status():
    telegram_bot._status.update({
        "running": False, "last_poll_at": "", "bot_username": "",
        "polls_count": 0, "updates_received": 0,
    })
    telegram_bot._watchdog_status.update({
        "enabled": True, "interval_sec": 300, "stale_after_sec": 90,
        "last_check_at": "", "last_action": "", "last_action_at": "",
        "last_reason": "", "checks_count": 0, "restart_count": 0,
    })


@pytest.mark.asyncio
async def test_healthy_when_running_and_recent_poll():
    _reset_status()
    telegram_bot._status["running"] = True
    telegram_bot._status["last_poll_at"] = datetime.now(timezone.utc).isoformat()
    with patch.object(telegram_bot, "get_bot_info", AsyncMock(return_value={"id": 1, "username": "x"})):
        healthy, reasons = await telegram_bot._is_polling_healthy("TOKEN")
    assert healthy is True, f"Should be healthy, got reasons: {reasons}"
    assert reasons == []


@pytest.mark.asyncio
async def test_unhealthy_when_not_running():
    _reset_status()
    telegram_bot._status["running"] = False
    telegram_bot._status["last_poll_at"] = datetime.now(timezone.utc).isoformat()
    with patch.object(telegram_bot, "get_bot_info", AsyncMock(return_value={"id": 1})):
        healthy, reasons = await telegram_bot._is_polling_healthy("TOKEN")
    assert healthy is False
    assert any("running" in r for r in reasons)


@pytest.mark.asyncio
async def test_unhealthy_when_poll_stale():
    _reset_status()
    telegram_bot._status["running"] = True
    # Last poll was 5 minutes ago — way over default stale threshold of 90s
    old = datetime.now(timezone.utc) - timedelta(minutes=5)
    telegram_bot._status["last_poll_at"] = old.isoformat()
    with patch.object(telegram_bot, "get_bot_info", AsyncMock(return_value={"id": 1})):
        healthy, reasons = await telegram_bot._is_polling_healthy("TOKEN")
    assert healthy is False
    assert any("last poll" in r for r in reasons)


@pytest.mark.asyncio
async def test_unhealthy_when_getme_fails():
    _reset_status()
    telegram_bot._status["running"] = True
    telegram_bot._status["last_poll_at"] = datetime.now(timezone.utc).isoformat()
    with patch.object(telegram_bot, "get_bot_info", AsyncMock(return_value=None)):
        healthy, reasons = await telegram_bot._is_polling_healthy("TOKEN")
    assert healthy is False
    assert any("getMe" in r for r in reasons)


@pytest.mark.asyncio
async def test_unhealthy_when_never_polled():
    _reset_status()
    telegram_bot._status["running"] = True
    telegram_bot._status["last_poll_at"] = ""
    with patch.object(telegram_bot, "get_bot_info", AsyncMock(return_value={"id": 1})):
        healthy, reasons = await telegram_bot._is_polling_healthy("TOKEN")
    assert healthy is False
    assert any("never polled" in r for r in reasons)


@pytest.mark.asyncio
async def test_force_health_check_restarts_when_unhealthy():
    """Manual health check from admin UI should restart the bot when unhealthy."""
    _reset_status()
    telegram_bot.db = _mock_db()
    telegram_bot._status["running"] = False  # unhealthy

    restart_called = []
    clear_webhook_called = []

    async def fake_restart():
        restart_called.append(True)

    async def fake_clear_webhook(token):
        clear_webhook_called.append(token)
        return True

    async def fake_get_token():
        return "FAKE_TOKEN"

    with patch.object(telegram_bot, "restart_bot", fake_restart), \
         patch.object(telegram_bot, "clear_webhook", fake_clear_webhook), \
         patch.object(telegram_bot, "get_bot_token", fake_get_token), \
         patch.object(telegram_bot, "get_bot_info", AsyncMock(return_value={"id": 1})):
        result = await telegram_bot.force_health_check()

    assert result["healthy"] is False
    assert result["restarted"] is True
    assert len(restart_called) == 1, "restart_bot should have been called once"
    assert len(clear_webhook_called) == 1, "clear_webhook should have been called"
    assert telegram_bot._watchdog_status["restart_count"] == 1


@pytest.mark.asyncio
async def test_force_health_check_no_restart_when_healthy():
    _reset_status()
    telegram_bot.db = _mock_db()
    telegram_bot._status["running"] = True
    telegram_bot._status["last_poll_at"] = datetime.now(timezone.utc).isoformat()

    restart_called = []

    async def fake_restart():
        restart_called.append(True)

    async def fake_get_token():
        return "FAKE_TOKEN"

    with patch.object(telegram_bot, "restart_bot", fake_restart), \
         patch.object(telegram_bot, "get_bot_token", fake_get_token), \
         patch.object(telegram_bot, "get_bot_info", AsyncMock(return_value={"id": 1, "username": "x"})):
        result = await telegram_bot.force_health_check()

    assert result["healthy"] is True
    assert result["restarted"] is False
    assert len(restart_called) == 0


@pytest.mark.asyncio
async def test_configure_watchdog_persists():
    """Toggle/interval/stale must be saved to DB AND applied immediately."""
    _reset_status()
    telegram_bot.db = _mock_db()

    wd = await telegram_bot.configure_watchdog(enabled=False, interval_sec=600, stale_after_sec=120)
    assert wd["enabled"] is False
    assert wd["interval_sec"] == 600
    assert wd["stale_after_sec"] == 120

    # Verify DB writes happened
    assert telegram_bot.db.settings.update_one.await_count == 3


@pytest.mark.asyncio
async def test_configure_watchdog_minimum_intervals():
    """interval must be >=60s, stale_after >=30s (defensive guards)."""
    _reset_status()
    telegram_bot.db = _mock_db()

    wd = await telegram_bot.configure_watchdog(interval_sec=10, stale_after_sec=5)
    assert wd["interval_sec"] >= 60
    assert wd["stale_after_sec"] >= 30


def test_get_status_includes_watchdog():
    _reset_status()
    s = telegram_bot.get_status()
    assert "watchdog" in s
    assert "enabled" in s["watchdog"]
    assert "restart_count" in s["watchdog"]
