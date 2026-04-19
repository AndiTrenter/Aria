"""
Aria Telegram Bot Integration
Connects Aria to Telegram for messaging, document sharing, and service access.
"""
import asyncio
import httpx
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

db = None
get_ha_settings = None
get_llm_api_key = None
chat_handler = None  # Will be set to the chat processing function
bot_task = None

# Runtime status (surfaced via /api/admin/telegram/status)
_status = {
    "running": False,
    "bot_username": "",
    "bot_id": None,
    "last_poll_at": "",
    "last_error": "",
    "last_error_at": "",
    "last_update_at": "",
    "polls_count": 0,
    "updates_received": 0,
    "messages_processed": 0,
    "started_at": "",
    "current_offset": 0,
}

TELEGRAM_API = "https://api.telegram.org/bot"


def init(database, ha_func, llm_func):
    global db, get_ha_settings, get_llm_api_key
    db = database
    get_ha_settings = ha_func
    get_llm_api_key = llm_func


async def get_bot_token():
    doc = await db.settings.find_one({"key": "telegram_bot_token"})
    token = doc["value"] if doc and doc.get("value") else ""
    # Ignore disabled/placeholder tokens
    if not token or "..." in token or token == "DISABLED" or len(token) < 20:
        return ""
    return token


async def telegram_request(method, token, timeout=30.0, **kwargs):
    """Make a request to the Telegram Bot API. Returns (data, error_text)."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(f"{TELEGRAM_API}{token}/{method}", **kwargs)
            if resp.status_code == 200:
                return resp.json(), None
            body = resp.text[:300]
            logger.warning(f"Telegram API {method} -> {resp.status_code}: {body}")
            return None, f"HTTP {resp.status_code}: {body}"
    except httpx.TimeoutException:
        return None, "Timeout"
    except Exception as e:
        logger.error(f"Telegram request error: {e}")
        return None, str(e)


async def send_message(token, chat_id, text, parse_mode="Markdown"):
    """Send a text message to a Telegram chat."""
    # Telegram has 4096 char limit, split if needed
    if len(text) > 4000:
        parts = [text[i:i+4000] for i in range(0, len(text), 4000)]
        for part in parts:
            await telegram_request("sendMessage", token, json={
                "chat_id": chat_id, "text": part, "parse_mode": parse_mode
            })
    else:
        result, _ = await telegram_request("sendMessage", token, json={
            "chat_id": chat_id, "text": text, "parse_mode": parse_mode
        })
        # Fallback without parse_mode if markdown fails
        if not result or not result.get("ok"):
            await telegram_request("sendMessage", token, json={
                "chat_id": chat_id, "text": text
            })


async def send_document(token, chat_id, file_url, filename, caption=""):
    """Send a document to a Telegram chat."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Download the file first
            resp = await client.get(file_url)
            if resp.status_code == 200:
                files = {"document": (filename, resp.content)}
                data = {"chat_id": str(chat_id)}
                if caption:
                    data["caption"] = caption[:1024]
                await telegram_request("sendDocument", token, data=data, files=files)
            else:
                await send_message(token, chat_id, f"Fehler beim Laden der Datei: {filename}")
    except Exception as e:
        logger.error(f"Send document error: {e}")
        await send_message(token, chat_id, f"Fehler beim Senden der Datei: {str(e)}")


# ==================== DIAGNOSTIC HELPERS ====================

async def get_bot_info(token: str):
    """Calls Telegram getMe. Returns dict with id/username/first_name, or None."""
    result, err = await telegram_request("getMe", token, timeout=10.0)
    if result and result.get("ok"):
        return result.get("result") or {}
    return None


async def clear_webhook(token: str):
    """Delete any webhook that would prevent getUpdates from working.
    Also drops pending updates so old messages aren't replayed."""
    result, err = await telegram_request(
        "deleteWebhook", token, timeout=10.0,
        json={"drop_pending_updates": True},
    )
    return bool(result and result.get("ok"))


async def get_webhook_info(token: str):
    """Returns current webhook URL (empty string means no webhook)."""
    result, err = await telegram_request("getWebhookInfo", token, timeout=10.0)
    if result and result.get("ok"):
        return result.get("result") or {}
    return {}


async def test_token(token: str) -> dict:
    """Admin test-button handler — returns detailed diagnostic info.

    Steps:
      1. getMe    (token valid?)
      2. getWebhookInfo (webhook blocking getUpdates?)
      3. deleteWebhook (clean up if needed)
      4. Report polling status
    """
    if not token or len(token) < 20:
        return {"ok": False, "stage": "token", "message": "Token ist leer oder zu kurz. Hole einen frischen Token bei @BotFather."}
    me = await get_bot_info(token)
    if not me:
        return {"ok": False, "stage": "getMe", "message": "Token wurde von Telegram abgelehnt (ungültig oder widerrufen). Erzeuge bei @BotFather einen neuen Token via /mybots → Bot wählen → 'API Token'."}
    webhook_info = await get_webhook_info(token)
    webhook_url = webhook_info.get("url", "") or ""
    cleared = False
    if webhook_url:
        cleared = await clear_webhook(token)
    # Local polling status
    polls_ok = _status.get("running") and bool(_status.get("last_poll_at"))
    return {
        "ok": True,
        "stage": "ready",
        "message": (
            f"Bot '{me.get('username', '?')}' ist erreichbar."
            + (f" (Webhook '{webhook_url}' wurde entfernt, damit Polling funktioniert.)" if cleared else "")
        ),
        "bot": {
            "id": me.get("id"),
            "username": me.get("username", ""),
            "first_name": me.get("first_name", ""),
            "can_join_groups": me.get("can_join_groups", False),
            "can_read_all_group_messages": me.get("can_read_all_group_messages", False),
        },
        "webhook_url_was": webhook_url,
        "webhook_cleared": cleared,
        "polling_active": polls_ok,
        "status": _status,
    }


def get_status() -> dict:
    """Returns a snapshot of the runtime status."""
    return dict(_status)


# ==================== USER SESSION MANAGEMENT ====================

# In-memory session store: telegram_chat_id -> {user_id, user_name, verified, ...}
sessions = {}


async def identify_user(chat_id, pin):
    """Identify a user by their voice/telegram PIN."""
    user = await db.users.find_one({"voice_pin": pin})
    if user:
        sessions[chat_id] = {
            "user_id": str(user["_id"]),
            "user_name": user.get("name", user.get("email", "")),
            "user_email": user.get("email", ""),
            "user_role": user.get("role", "user"),
            "verified_at": datetime.now(timezone.utc).isoformat(),
            "telegram_chat_id": chat_id,
        }
        # Save telegram chat_id to user for future reference
        await db.users.update_one({"_id": user["_id"]}, {"$set": {"telegram_chat_id": chat_id}})
        return sessions[chat_id]
    return None


async def get_session(chat_id):
    """Get the current session for a chat_id."""
    if chat_id in sessions:
        return sessions[chat_id]
    # Check if we have a saved mapping
    user = await db.users.find_one({"telegram_chat_id": chat_id})
    if user:
        sessions[chat_id] = {
            "user_id": str(user["_id"]),
            "user_name": user.get("name", user.get("email", "")),
            "user_email": user.get("email", ""),
            "user_role": user.get("role", "user"),
            "verified_at": user.get("telegram_verified_at", ""),
            "telegram_chat_id": chat_id,
        }
        return sessions[chat_id]
    return None


# ==================== MESSAGE PROCESSING ====================

async def process_message(token, chat_id, text):
    """Process an incoming Telegram message."""
    text = text.strip()
    msg_lower = text.lower()

    # Command: /start
    if msg_lower == "/start":
        await send_message(token, chat_id,
            "Hallo! Ich bin *Aria*, dein persönlicher Assistent.\n\n"
            "Bitte identifiziere dich zuerst mit deinem PIN.\n"
            "Sende: `/pin DEINPIN`\n\n"
            "Danach kannst du mich alles fragen:\n"
            "- Dokumente suchen\n"
            "- E-Mails abfragen\n"
            "- Smart Home steuern\n"
            "- Wetter abfragen\n"
            "- Termine erstellen\n"
            "- und vieles mehr!")
        return

    # Command: /pin
    if msg_lower.startswith("/pin ") or msg_lower.startswith("/pin"):
        pin = text.split(" ", 1)[1].strip() if " " in text else ""
        if not pin:
            await send_message(token, chat_id, "Bitte sende: `/pin DEINPIN`")
            return
        user_session = await identify_user(chat_id, pin)
        if user_session:
            await send_message(token, chat_id,
                f"Willkommen, *{user_session['user_name']}*! Du bist jetzt angemeldet.\n"
                f"Frag mich was du wissen möchtest.")
        else:
            await send_message(token, chat_id, "PIN nicht erkannt. Bitte versuche es nochmal.")
        return

    # Command: /logout
    if msg_lower == "/logout":
        if chat_id in sessions:
            del sessions[chat_id]
        await db.users.update_one({"telegram_chat_id": chat_id}, {"$unset": {"telegram_chat_id": ""}})
        await send_message(token, chat_id, "Du bist abgemeldet. Sende `/pin DEINPIN` um dich erneut anzumelden.")
        return

    # Command: /hilfe
    if msg_lower in ("/hilfe", "/help"):
        await send_message(token, chat_id,
            "*Aria Befehle:*\n"
            "`/pin DEINPIN` — Anmelden\n"
            "`/logout` — Abmelden\n"
            "`/hilfe` — Diese Hilfe\n\n"
            "*Oder frag mich einfach:*\n"
            "- \"Was steht in der letzten Email von Voser?\"\n"
            "- \"Hast du meinen Lohnausweis 2025?\"\n"
            "- \"Mach das Licht im Wohnzimmer an\"\n"
            "- \"Wie ist das Wetter?\"\n"
            "- \"Erstelle einen Termin morgen 10 Uhr Arzt\"")
        return

    # Check if user is authenticated
    session = await get_session(chat_id)
    if not session:
        await send_message(token, chat_id,
            "Bitte identifiziere dich zuerst.\nSende: `/pin DEINPIN`\n\n"
            "Den PIN kannst du in Aria unter *Konto → Sprach-PIN* setzen.")
        return

    # Process through Aria's chat system
    try:
        await telegram_request("sendChatAction", token, json={"chat_id": chat_id, "action": "typing"})

        # Use the same chat processing as web
        if chat_handler:
            response_text = await chat_handler(text, session["user_id"], f"telegram_{chat_id}")
        else:
            response_text = "Chat-System nicht verfügbar."

        if response_text:
            await send_message(token, chat_id, response_text)
            _status["messages_processed"] += 1
        else:
            await send_message(token, chat_id, "Entschuldigung, ich konnte keine Antwort generieren.")

    except Exception as e:
        logger.error(f"Telegram message processing error: {e}")
        await send_message(token, chat_id, f"Fehler bei der Verarbeitung: {str(e)[:200]}")


# ==================== POLLING LOOP ====================

async def polling_loop():
    """Long-polling loop for Telegram updates.

    Key improvements:
    - deleteWebhook at startup (so getUpdates can deliver)
    - getMe at startup to cache bot username for diagnostics
    - Detects 409 Conflict (another instance already polling) and surfaces it
    - Tracks offset per-token (resets when token changes)
    - Full status tracking for /api/admin/telegram/status
    """
    _status.update({
        "running": True,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "last_error": "",
        "last_error_at": "",
        "polls_count": 0,
        "updates_received": 0,
    })

    offset = 0
    active_token = ""
    consecutive_errors = 0

    try:
        while True:
            token = await get_bot_token()
            if not token:
                _status["running"] = False
                await asyncio.sleep(15)
                continue

            # Token change → reset offset + re-init
            if token != active_token:
                logger.info("Telegram token change detected; reinitialising (webhook clear + getMe)")
                me = await get_bot_info(token)
                if not me:
                    _status.update({
                        "running": False,
                        "last_error": "getMe fehlgeschlagen — Token ungültig oder widerrufen.",
                        "last_error_at": datetime.now(timezone.utc).isoformat(),
                    })
                    await asyncio.sleep(30)
                    continue
                _status["bot_username"] = me.get("username", "")
                _status["bot_id"] = me.get("id")
                # Remove any webhook so getUpdates works
                await clear_webhook(token)
                active_token = token
                offset = 0
                _status["current_offset"] = 0
                _status["running"] = True

            try:
                result, err = await telegram_request(
                    "getUpdates", token,
                    timeout=35.0,
                    json={"offset": offset, "timeout": 25, "allowed_updates": ["message"]},
                )
                _status["polls_count"] += 1
                _status["last_poll_at"] = datetime.now(timezone.utc).isoformat()

                if result and result.get("ok"):
                    consecutive_errors = 0
                    _status["running"] = True
                    _status["last_error"] = ""
                    updates = result.get("result", []) or []
                    _status["updates_received"] += len(updates)
                    if updates:
                        _status["last_update_at"] = datetime.now(timezone.utc).isoformat()
                    for update in updates:
                        offset = update["update_id"] + 1
                        _status["current_offset"] = offset
                        msg = update.get("message", {})
                        chat_id = msg.get("chat", {}).get("id")
                        text = msg.get("text", "")
                        if chat_id and text:
                            # Process in background to not block polling
                            asyncio.create_task(process_message(token, chat_id, text))
                else:
                    consecutive_errors += 1
                    err_text = err or "Unknown"
                    _status["last_error"] = err_text
                    _status["last_error_at"] = datetime.now(timezone.utc).isoformat()
                    # Handle specific Telegram errors
                    if "409" in err_text:
                        # Conflict: another poller is active → keep reading token but back off longer
                        logger.warning("Telegram 409 Conflict — another instance of this bot is polling. Is another Aria/container running with the same token?")
                        _status["last_error"] = "409 Conflict — ein anderer Prozess pollt bereits mit diesem Token. Stoppe ggf. alten Docker-Container oder erzeuge einen neuen Token."
                        await asyncio.sleep(15)
                    elif "401" in err_text or "404" in err_text:
                        _status["last_error"] = f"Token ungültig ({err_text}). Erzeuge bei @BotFather einen neuen Token."
                        # Invalidate cached token so next round waits for user to update it
                        active_token = ""
                        await asyncio.sleep(30)
                    else:
                        await asyncio.sleep(min(30, 5 * consecutive_errors))
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"Telegram polling error: {e}")
                consecutive_errors += 1
                _status["last_error"] = str(e)[:200]
                _status["last_error_at"] = datetime.now(timezone.utc).isoformat()
                await asyncio.sleep(min(30, 5 * consecutive_errors))
    except asyncio.CancelledError:
        logger.info("Telegram polling cancelled")
    finally:
        _status["running"] = False


def start_bot():
    """Start the Telegram bot polling in background."""
    global bot_task
    if bot_task and not bot_task.done():
        bot_task.cancel()
        # Do NOT await here — caller may be sync. New task will pick up fresh token.
    bot_task = asyncio.create_task(polling_loop())
    logger.info("Telegram bot polling started")


async def restart_bot():
    """Cleanly stop & restart bot (async, waits for old task to finish)."""
    global bot_task
    if bot_task and not bot_task.done():
        bot_task.cancel()
        try:
            await asyncio.wait_for(bot_task, timeout=5.0)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass
    bot_task = asyncio.create_task(polling_loop())
    logger.info("Telegram bot polling restarted")


def stop_bot():
    """Stop the Telegram bot polling."""
    global bot_task
    if bot_task:
        bot_task.cancel()
        bot_task = None
        _status["running"] = False
        logger.info("Telegram bot polling stopped")
