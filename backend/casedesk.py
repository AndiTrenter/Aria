"""
Aria CaseDesk Integration Module
Connects to CaseDesk AI API for emails, documents, cases, tasks, calendar
"""
from fastapi import APIRouter, HTTPException, Request, Body
import httpx
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/casedesk")

db = None
get_current_user = None
require_admin = None

def init(database, auth_func, admin_func):
    global db, get_current_user, require_admin
    db = database
    get_current_user = auth_func
    require_admin = admin_func


async def get_casedesk_settings():
    """Get CaseDesk connection settings from DB."""
    url_doc = await db.settings.find_one({"key": "casedesk_url"})
    email_doc = await db.settings.find_one({"key": "casedesk_email"})
    pw_doc = await db.settings.find_one({"key": "casedesk_password"})
    url = url_doc["value"].rstrip("/") if url_doc and url_doc.get("value") else ""
    email = email_doc["value"] if email_doc and email_doc.get("value") else ""
    pw = pw_doc["value"] if pw_doc and pw_doc.get("value") else ""
    return url, email, pw


async def get_casedesk_token():
    """Login to CaseDesk and return a Bearer token. Caches in DB for 12h."""
    url, email, pw = await get_casedesk_settings()
    if not url or not email or not pw:
        return None, "CaseDesk nicht konfiguriert"

    # Check cache
    cache = await db.settings.find_one({"key": "casedesk_token_cache"})
    if cache and cache.get("value") and cache.get("expires_at"):
        if cache["expires_at"] > datetime.now(timezone.utc).isoformat():
            return cache["value"], None

    # Login
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # CaseDesk uses Form-based login
            resp = await client.post(
                f"{url}/api/auth/login",
                data={"email": email, "password": pw},
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )
            if resp.status_code == 200:
                data = resp.json()
                token = data.get("access_token")
                if token:
                    await db.settings.update_one(
                        {"key": "casedesk_token_cache"},
                        {"$set": {"value": token, "expires_at": "2099-01-01T00:00:00"}},
                        upsert=True
                    )
                    return token, None
            elif resp.status_code == 422:
                # Try JSON format as fallback
                resp2 = await client.post(
                    f"{url}/api/auth/login",
                    json={"email": email, "password": pw}
                )
                if resp2.status_code == 200:
                    data = resp2.json()
                    token = data.get("access_token")
                    if token:
                        await db.settings.update_one(
                            {"key": "casedesk_token_cache"},
                            {"$set": {"value": token, "expires_at": "2099-01-01T00:00:00"}},
                            upsert=True
                        )
                        return token, None
                # Log the actual error
                try:
                    err_detail = resp.json().get("detail", resp.text[:200])
                except Exception:
                    err_detail = resp.text[:200]
                logger.error(f"CaseDesk 422 error: {err_detail}")
                return None, f"CaseDesk Login-Validierung fehlgeschlagen: {err_detail}"
            else:
                return None, f"CaseDesk Login fehlgeschlagen (HTTP {resp.status_code})"
    except Exception as e:
        logger.error(f"CaseDesk login error: {e}")
        return None, f"CaseDesk nicht erreichbar: {str(e)}"


async def casedesk_request(method, path, **kwargs):
    """Make an authenticated request to CaseDesk."""
    url, _, _ = await get_casedesk_settings()
    if not url:
        return None, "CaseDesk nicht konfiguriert"

    token, err = await get_casedesk_token()
    if not token:
        return None, err

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            headers = {"Authorization": f"Bearer {token}"}
            if method == "GET":
                resp = await client.get(f"{url}/api{path}", headers=headers, **kwargs)
            elif method == "POST":
                resp = await client.post(f"{url}/api{path}", headers=headers, **kwargs)
            else:
                return None, f"Unsupported method: {method}"

            if resp.status_code == 401:
                # Token expired, clear cache and retry once
                await db.settings.delete_one({"key": "casedesk_token_cache"})
                token, err = await get_casedesk_token()
                if not token:
                    return None, err
                headers = {"Authorization": f"Bearer {token}"}
                if method == "GET":
                    resp = await client.get(f"{url}/api{path}", headers=headers, **kwargs)
                else:
                    resp = await client.post(f"{url}/api{path}", headers=headers, **kwargs)

            if resp.status_code == 200:
                return resp.json(), None
            return None, f"CaseDesk Fehler: HTTP {resp.status_code}"
    except Exception as e:
        logger.error(f"CaseDesk request error: {e}")
        return None, str(e)


# ==================== API ENDPOINTS ====================

@router.get("/status")
async def casedesk_status(request: Request):
    """Check CaseDesk connection status."""
    user = await get_current_user(request)
    url, email, pw = await get_casedesk_settings()
    if not url or not email or not pw:
        return {"connected": False, "message": "Nicht konfiguriert"}

    token, err = await get_casedesk_token()
    if token:
        return {"connected": True, "message": "Verbunden", "url": url}
    return {"connected": False, "message": err or "Verbindung fehlgeschlagen"}


@router.post("/search/emails")
async def search_casedesk_emails(request: Request, body: dict = Body(...)):
    """Search CaseDesk emails."""
    user = await get_current_user(request)
    query = body.get("query", "")
    if not query:
        return {"results": [], "count": 0}

    data, err = await casedesk_request("POST", "/emails/search", json={"query": query})
    if err:
        return {"results": [], "count": 0, "error": err}
    return data


@router.get("/emails")
async def list_casedesk_emails(request: Request, limit: int = 20):
    """List recent CaseDesk emails."""
    user = await get_current_user(request)
    data, err = await casedesk_request("GET", "/emails")
    if err:
        return {"results": [], "error": err}
    emails = data if isinstance(data, list) else data.get("results", data.get("emails", []))
    return emails[:limit]


@router.get("/cases")
async def list_casedesk_cases(request: Request):
    """List CaseDesk cases."""
    user = await get_current_user(request)
    data, err = await casedesk_request("GET", "/cases")
    if err:
        return []
    return data if isinstance(data, list) else []


@router.get("/tasks")
async def list_casedesk_tasks(request: Request):
    """List CaseDesk tasks."""
    user = await get_current_user(request)
    data, err = await casedesk_request("GET", "/tasks")
    if err:
        return []
    return data if isinstance(data, list) else []


@router.get("/events")
async def list_casedesk_events(request: Request):
    """List CaseDesk calendar events."""
    user = await get_current_user(request)
    data, err = await casedesk_request("GET", "/events")
    if err:
        return []
    return data if isinstance(data, list) else []


@router.get("/documents")
async def list_casedesk_documents(request: Request):
    """List CaseDesk documents."""
    user = await get_current_user(request)
    data, err = await casedesk_request("GET", "/documents")
    if err:
        return []
    return data if isinstance(data, list) else []


# ==================== CHAT CONTEXT HELPER ====================

async def get_casedesk_context(message: str) -> str:
    """Build CaseDesk context for GPT chat based on user message."""
    url, email, pw = await get_casedesk_settings()
    if not url or not email or not pw:
        return ""

    msg_lower = message.lower()
    context_parts = []

    # Keywords that trigger CaseDesk queries
    cd_keywords = ["casedesk", "email", "mail", "e-mail", "voser", "dokument",
                   "fall", "fälle", "akte", "aufgabe", "task", "termin",
                   "kalender", "nachricht", "schreiben", "brief"]

    if not any(kw in msg_lower for kw in cd_keywords):
        return ""

    try:
        # Search emails if message mentions email/mail/person names
        email_keywords = ["email", "mail", "e-mail", "nachricht", "schreiben", "brief"]
        if any(kw in msg_lower for kw in email_keywords) or any(
            word for word in msg_lower.split() if len(word) > 3 and word[0].isupper()
        ):
            # Extract search terms (remove common words)
            stop_words = {"was", "ist", "die", "der", "das", "von", "vom", "letzte",
                         "letzten", "email", "mail", "e-mail", "nachricht", "inhalt",
                         "besagt", "steht", "drin", "in", "an", "den", "dem", "des",
                         "eine", "ein", "einen", "kannst", "du", "mir", "sagen", "zeig",
                         "zeige", "hol", "hole", "such", "suche", "finde"}
            words = [w.strip("?!.,;:") for w in message.split() if w.strip("?!.,;:").lower() not in stop_words and len(w) > 2]
            search_query = " ".join(words[:5]) if words else message[:50]

            data, err = await casedesk_request("POST", "/emails/search", json={"query": search_query})
            if data and not err:
                results = data.get("results", [])
                if results:
                    context_parts.append(f"\n--- CaseDesk E-Mails (Suche: '{search_query}') ---")
                    for em in results[:5]:
                        ctx = f"Von: {em.get('from_name', em.get('from_address', '?'))}"
                        ctx += f" | Betreff: {em.get('subject', '?')}"
                        ctx += f" | Datum: {em.get('date', em.get('received_at', '?'))[:10]}"
                        body = em.get('body_text', em.get('ai_summary', ''))
                        if body:
                            ctx += f"\nInhalt: {body[:500]}"
                        context_parts.append(ctx)

        # Fetch tasks if mentioned
        if any(kw in msg_lower for kw in ["aufgabe", "task", "todo", "frist"]):
            data, err = await casedesk_request("GET", "/tasks")
            if data and not err:
                tasks = data if isinstance(data, list) else []
                open_tasks = [t for t in tasks if t.get("status") != "done"][:10]
                if open_tasks:
                    context_parts.append("\n--- CaseDesk Offene Aufgaben ---")
                    for t in open_tasks:
                        context_parts.append(f"- {t.get('title', '?')} (Frist: {t.get('due_date', 'keine')[:10] if t.get('due_date') else 'keine'}, Priorität: {t.get('priority', '?')})")

        # Fetch cases if mentioned
        if any(kw in msg_lower for kw in ["fall", "fälle", "akte", "akten", "vorgang"]):
            data, err = await casedesk_request("GET", "/cases")
            if data and not err:
                cases = data if isinstance(data, list) else []
                if cases:
                    context_parts.append("\n--- CaseDesk Fälle ---")
                    for c in cases[:10]:
                        context_parts.append(f"- {c.get('title', '?')} (Status: {c.get('status', '?')}, Ref: {c.get('reference_number', '-')})")

        # Fetch calendar if mentioned
        if any(kw in msg_lower for kw in ["termin", "kalender", "event", "datum"]):
            data, err = await casedesk_request("GET", "/events")
            if data and not err:
                events = data if isinstance(data, list) else []
                if events:
                    context_parts.append("\n--- CaseDesk Kalender ---")
                    for ev in events[:10]:
                        context_parts.append(f"- {ev.get('title', '?')} am {str(ev.get('start_time', '?'))[:16]}")

    except Exception as e:
        logger.error(f"CaseDesk context error: {e}")

    if context_parts:
        return "\n".join(context_parts)
    return ""


async def execute_casedesk_action(action_type: str, data: dict) -> dict:
    """Execute a CaseDesk action (create task, event, send email)."""
    url, email, pw = await get_casedesk_settings()
    if not url:
        return {"success": False, "message": "CaseDesk nicht konfiguriert"}

    if action_type == "create_task":
        result, err = await casedesk_request("POST", "/tasks",
            data={"title": data.get("title", ""), "description": data.get("description", ""),
                  "priority": data.get("priority", "medium"), "due_date": data.get("due_date", "")})
        if err:
            # Try JSON format
            result, err = await casedesk_request("POST", "/tasks",
                json={"title": data.get("title", ""), "description": data.get("description", ""),
                      "priority": data.get("priority", "medium"), "due_date": data.get("due_date")})
        if result and not err:
            return {"success": True, "message": f"Aufgabe '{data.get('title')}' in CaseDesk erstellt."}
        return {"success": False, "message": f"Aufgabe konnte nicht erstellt werden: {err}"}

    elif action_type == "create_event":
        result, err = await casedesk_request("POST", "/events",
            data={"title": data.get("title", ""), "description": data.get("description", ""),
                  "start_date": data.get("start_date", ""), "end_date": data.get("end_date", ""),
                  "all_day": str(data.get("all_day", False)).lower()})
        if err:
            result, err = await casedesk_request("POST", "/events",
                json={"title": data.get("title", ""), "description": data.get("description", ""),
                      "start_date": data.get("start_date"), "end_date": data.get("end_date"),
                      "all_day": data.get("all_day", False)})
        if result and not err:
            return {"success": True, "message": f"Kalendereintrag '{data.get('title')}' in CaseDesk erstellt."}
        return {"success": False, "message": f"Kalendereintrag konnte nicht erstellt werden: {err}"}

    elif action_type == "create_case":
        result, err = await casedesk_request("POST", "/cases",
            data={"title": data.get("title", ""), "description": data.get("description", "")})
        if err:
            result, err = await casedesk_request("POST", "/cases",
                json={"title": data.get("title", ""), "description": data.get("description", "")})
        if result and not err:
            return {"success": True, "message": f"Fall '{data.get('title')}' in CaseDesk erstellt."}
        return {"success": False, "message": f"Fall konnte nicht erstellt werden: {err}"}

    return {"success": False, "message": f"Unbekannte Aktion: {action_type}"}
