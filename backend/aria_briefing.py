"""
A.R.I.A. — Daily Briefing engine.

Sends a personalised morning briefing to each opted-in user via:
    - Telegram (if their account has a verified chat_id), and/or
    - In-app dashboard (a "briefing" doc the frontend can pull when
      the user logs in for the first time today).

Briefing content (best-effort, skips sections that have no data):
    1. Greeting with first name + variable J.A.R.V.I.S.-style line
    2. Outside temperature + simple weather summary
    3. Today's calendar entries (CaseDesk)
    4. Unread emails (CaseDesk) — count + first 3 subjects
    5. Pending tasks for today (CaseDesk)
    6. Smart-home anomaly hint (if applicable)

Settings (collection `briefing_settings`, single doc):
    {
      enabled: bool,
      send_via_telegram: bool,
      send_via_app: bool,
      time_local: "07:30",     (HH:MM)
      timezone_offset_minutes: 60   (e.g. 60 for CET, 120 for CEST)
    }

Per-user opt-in is recorded on the user object (`briefing_opt_in: bool`).
The scheduler is a simple async loop that wakes every 60s and checks
if the configured local time has been reached today; once fired for a
user it stamps `briefing_last_sent` so it doesn't double-fire.

Public surface:
    init(database, llm_key_func, casedesk_mod, telegram_mod, weather_func)
    ensure_indexes()
    get_settings(), update_settings(...)
    generate_briefing(user) -> {markdown, plaintext, sections}
    deliver_briefing(user) -> {success, channel}
    start_scheduler()
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

db = None
get_llm_api_key = None
casedesk_module = None
telegram_module = None
weather_fn = None  # async callable returning dict with 'temperature'

DEFAULT_SETTINGS = {
    "enabled": False,
    "send_via_telegram": True,
    "send_via_app": True,
    "time_local": "07:30",
    "timezone_offset_minutes": 60,  # CET default; UI lets the user adjust
}


def init(database, llm_key_func=None, casedesk_mod=None, telegram_mod=None, weather_func=None):
    global db, get_llm_api_key, casedesk_module, telegram_module, weather_fn
    db = database
    get_llm_api_key = llm_key_func
    casedesk_module = casedesk_mod
    telegram_module = telegram_mod
    weather_fn = weather_func


async def ensure_indexes():
    if db is None:
        return
    try:
        await db.briefing_log.create_index([("user_id", 1), ("ts", -1)])
    except Exception as e:
        logger.warning(f"briefing indexes: {e}")


def _now():
    return datetime.now(timezone.utc)


# ── Settings ──────────────────────────────────────────────────────

async def get_settings() -> dict:
    if db is None:
        return dict(DEFAULT_SETTINGS)
    doc = await db.briefing_settings.find_one({"id": "global"}, {"_id": 0})
    if not doc:
        return dict(DEFAULT_SETTINGS)
    out = dict(DEFAULT_SETTINGS)
    out.update({k: v for k, v in doc.items() if k != "id"})
    return out


async def update_settings(patch: dict) -> dict:
    if db is None:
        return dict(DEFAULT_SETTINGS)
    allowed = set(DEFAULT_SETTINGS.keys())
    clean = {k: v for k, v in patch.items() if k in allowed}
    if not clean:
        return await get_settings()
    clean["updated_at"] = _now().isoformat()
    await db.briefing_settings.update_one(
        {"id": "global"},
        {"$set": clean, "$setOnInsert": {"id": "global"}},
        upsert=True,
    )
    return await get_settings()


# ── Briefing generation ───────────────────────────────────────────

async def _gather_sections(user: dict) -> dict:
    """Pull all data needed for one user's briefing (best-effort)."""
    sections = {}
    # Weather
    if weather_fn:
        try:
            w = await weather_fn(user["id"])
            if w and (w.get("temperature") is not None or w.get("temp") is not None):
                sections["weather"] = {
                    "temp":  w.get("temperature") or w.get("temp"),
                    "desc":  w.get("description") or w.get("summary") or "",
                    "loc":   w.get("location") or w.get("city") or "",
                }
        except Exception as e:
            logger.debug(f"briefing weather skipped: {e}")
    # CaseDesk: calendar, emails, tasks
    if casedesk_module:
        try:
            today = _now().date().isoformat()
            cal_data, _ = await casedesk_module.casedesk_request("GET", f"/calendar?date={today}")
            if isinstance(cal_data, list):
                sections["calendar"] = [
                    {"title": (c.get("title") or "")[:100], "time": c.get("start_time", "")[:16]}
                    for c in cal_data[:6]
                ]
        except Exception as e:
            logger.debug(f"briefing calendar skipped: {e}")
        try:
            mails, _ = await casedesk_module.casedesk_request("GET", "/emails?unread=true&limit=5")
            if isinstance(mails, list):
                sections["unread_emails"] = [
                    {"subject": (m.get("subject") or "(ohne Betreff)")[:90],
                     "from": (m.get("from") or "")[:80]}
                    for m in mails[:5]
                ]
        except Exception as e:
            logger.debug(f"briefing emails skipped: {e}")
        try:
            tasks, _ = await casedesk_module.casedesk_request("GET", "/tasks?status=open&limit=5")
            if isinstance(tasks, list):
                sections["tasks"] = [
                    {"title": (t.get("title") or "")[:100],
                     "priority": t.get("priority", "")}
                    for t in tasks[:5]
                ]
        except Exception as e:
            logger.debug(f"briefing tasks skipped: {e}")
    return sections


def _format_briefing(user: dict, sections: dict) -> tuple[str, str]:
    first = (user.get("name") or "").split(" ")[0] or "Sir"
    hour = _now().hour
    salute = "Guten Morgen" if hour < 11 else ("Guten Tag" if hour < 17 else "Guten Abend")
    md = [f"*{salute}, {first}.*", ""]
    plain = [f"{salute}, {first}.", ""]
    if sections.get("weather"):
        w = sections["weather"]
        line = f"🌡 {w['temp']}°C{', ' + w['desc'] if w['desc'] else ''}{' in ' + w['loc'] if w['loc'] else ''}"
        md.append(line); plain.append(line)
        md.append("")
    if sections.get("calendar"):
        md.append("*Heute im Kalender:*"); plain.append("Heute im Kalender:")
        for c in sections["calendar"]:
            md.append(f"  • {c['time'].replace('T', ' ')} — {c['title']}")
            plain.append(f"  - {c['time'].replace('T', ' ')} — {c['title']}")
        md.append("")
    if sections.get("unread_emails"):
        n = len(sections["unread_emails"])
        md.append(f"*{n} ungelesene E-Mail{'s' if n != 1 else ''}:*"); plain.append(f"{n} ungelesene E-Mail(s):")
        for m in sections["unread_emails"]:
            md.append(f"  • {m['subject']}  _(von {m['from']})_")
            plain.append(f"  - {m['subject']}  (von {m['from']})")
        md.append("")
    if sections.get("tasks"):
        md.append("*Offene Aufgaben:*"); plain.append("Offene Aufgaben:")
        for t in sections["tasks"]:
            pri = f" [{t['priority']}]" if t.get("priority") else ""
            md.append(f"  • {t['title']}{pri}")
            plain.append(f"  - {t['title']}{pri}")
        md.append("")
    if not (sections.get("calendar") or sections.get("unread_emails") or sections.get("tasks")):
        md.append("_Heute steht nichts Dringendes an, Sir._")
        plain.append("Heute steht nichts Dringendes an, Sir.")
    md.append("\n_— A.R.I.A._")
    plain.append("\n— A.R.I.A.")
    return "\n".join(md), "\n".join(plain)


async def generate_briefing(user: dict) -> dict:
    sections = await _gather_sections(user)
    md, plain = _format_briefing(user, sections)
    return {"markdown": md, "plaintext": plain, "sections": sections}


# ── Delivery ──────────────────────────────────────────────────────

async def deliver_briefing(user: dict) -> dict:
    settings = await get_settings()
    if not settings.get("enabled"):
        return {"success": False, "error": "briefing disabled"}

    briefing = await generate_briefing(user)
    delivered = []

    # Telegram
    if settings.get("send_via_telegram") and telegram_module:
        try:
            token = await telegram_module.get_bot_token()
            chat_id = user.get("telegram_chat_id")
            if token and chat_id:
                await telegram_module.send_message(token, chat_id, briefing["markdown"], parse_mode="Markdown")
                delivered.append("telegram")
        except Exception as e:
            logger.debug(f"briefing telegram failed: {e}")

    # In-app: store the latest briefing for the dashboard to pick up
    if settings.get("send_via_app"):
        try:
            await db.briefing_log.insert_one({
                "user_id": user["id"],
                "ts": _now().isoformat(),
                "markdown": briefing["markdown"],
                "plaintext": briefing["plaintext"],
                "sections": briefing["sections"],
                "channel": "app",
            })
            delivered.append("app")
        except Exception as e:
            logger.debug(f"briefing app store failed: {e}")

    return {"success": bool(delivered), "channels": delivered}


async def get_latest_briefing(user_id: str) -> dict | None:
    if db is None:
        return None
    doc = await db.briefing_log.find_one(
        {"user_id": user_id},
        sort=[("ts", -1)],
        projection={"_id": 0},
    )
    return doc


# ── Scheduler ─────────────────────────────────────────────────────

scheduler_task = None


async def _scheduler_loop():
    """Wake every 60s. If 'now' (in user's TZ) crosses settings.time_local
    AND the user hasn't received a briefing today, deliver it."""
    while True:
        try:
            await asyncio.sleep(60)
            settings = await get_settings()
            if not settings.get("enabled"):
                continue
            tz_off = int(settings.get("timezone_offset_minutes", 60))
            target = (settings.get("time_local") or "07:30").strip()
            try:
                hh, mm = [int(x) for x in target.split(":")]
            except Exception:
                hh, mm = 7, 30
            now_local = _now() + timedelta(minutes=tz_off)
            if now_local.hour != hh or now_local.minute != mm:
                continue
            # Find opted-in users
            cursor = db.users.find({"briefing_opt_in": True}, {"_id": 0})
            day_str = now_local.date().isoformat()
            async for user in cursor:
                last_sent = user.get("briefing_last_sent_day")
                if last_sent == day_str:
                    continue
                try:
                    await deliver_briefing(user)
                    await db.users.update_one(
                        {"id": user["id"]},
                        {"$set": {"briefing_last_sent_day": day_str, "briefing_last_sent_at": _now().isoformat()}},
                    )
                except Exception as e:
                    logger.warning(f"briefing delivery failed for user {user.get('id')}: {e}")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"briefing scheduler tick error: {e}")


def start_scheduler():
    global scheduler_task
    if scheduler_task and not scheduler_task.done():
        return
    scheduler_task = asyncio.create_task(_scheduler_loop())
    logger.info("Daily briefing scheduler started")


def stop_scheduler():
    global scheduler_task
    if scheduler_task and not scheduler_task.done():
        scheduler_task.cancel()
        scheduler_task = None
