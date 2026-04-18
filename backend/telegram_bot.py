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


async def telegram_request(method, token, **kwargs):
    """Make a request to the Telegram Bot API."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{TELEGRAM_API}{token}/{method}", **kwargs)
            if resp.status_code == 200:
                return resp.json()
            else:
                logger.error(f"Telegram API error: {resp.status_code} {resp.text[:200]}")
                return None
    except Exception as e:
        logger.error(f"Telegram request error: {e}")
        return None


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
        result = await telegram_request("sendMessage", token, json={
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
        else:
            await send_message(token, chat_id, "Entschuldigung, ich konnte keine Antwort generieren.")

    except Exception as e:
        logger.error(f"Telegram message processing error: {e}")
        await send_message(token, chat_id, f"Fehler bei der Verarbeitung: {str(e)[:200]}")


# ==================== POLLING LOOP ====================

async def polling_loop():
    """Long-polling loop for Telegram updates."""
    offset = 0
    consecutive_errors = 0

    while True:
        token = await get_bot_token()
        if not token:
            await asyncio.sleep(30)
            continue

        try:
            result = await telegram_request("getUpdates", token, json={
                "offset": offset, "timeout": 25, "allowed_updates": ["message"]
            })

            if result and result.get("ok"):
                consecutive_errors = 0
                for update in result.get("result", []):
                    offset = update["update_id"] + 1
                    msg = update.get("message", {})
                    chat_id = msg.get("chat", {}).get("id")
                    text = msg.get("text", "")

                    if chat_id and text:
                        # Process in background to not block polling
                        asyncio.create_task(process_message(token, chat_id, text))
            else:
                consecutive_errors += 1
                if consecutive_errors > 5:
                    await asyncio.sleep(30)
                else:
                    await asyncio.sleep(5)

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Telegram polling error: {e}")
            consecutive_errors += 1
            await asyncio.sleep(min(30, 5 * consecutive_errors))


def start_bot():
    """Start the Telegram bot polling in background."""
    global bot_task
    if bot_task and not bot_task.done():
        bot_task.cancel()
    bot_task = asyncio.create_task(polling_loop())
    logger.info("Telegram bot polling started")


def stop_bot():
    """Stop the Telegram bot polling."""
    global bot_task
    if bot_task:
        bot_task.cancel()
        bot_task = None
        logger.info("Telegram bot polling stopped")
