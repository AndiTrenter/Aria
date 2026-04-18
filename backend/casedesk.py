"""
Aria CaseDesk Integration Module
Connects to CaseDesk AI API for emails, documents, cases, tasks, calendar
"""
from fastapi import APIRouter, HTTPException, Request, Body
import httpx
import json
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
    if url and not url.startswith("http"):
        url = f"http://{url}"
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

# Reference to get_llm_api_key - set by init or externally
_get_llm_api_key = None

def set_llm_key_func(func):
    global _get_llm_api_key
    _get_llm_api_key = func


async def _gpt_interpret_search(user_message: str) -> list:
    """Use GPT to interpret what the user is looking for and generate search terms."""
    if not _get_llm_api_key:
        return []
    api_key = await _get_llm_api_key()
    if not api_key:
        return []

    try:
        import httpx as _httpx
        async with _httpx.AsyncClient(timeout=10.0) as client:
            # Try gpt-5.4-mini, fallback to gpt-4o-mini
            for model in ["gpt-5.4-mini", "gpt-4o-mini"]:
                resp = await client.post("https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json={
                        "model": model,
                        "messages": [
                            {"role": "system", "content": """Du bist ein Suchassistent. Der Benutzer stellt eine Frage und du musst die relevanten SUCHBEGRIFFE extrahieren, mit denen in einem Dokumentenmanagementsystem (E-Mails, PDFs, Rechnungen, Verträge, Lohnausweise etc.) gesucht werden soll.

REGELN:
- Gib NUR eine kommaseparierte Liste von Suchbegriffen zurück
- Denke an Synonyme und verwandte Begriffe (z.B. "Gehalt" → auch "Lohnausweis, Lohnabrechnung, Salär")
- Denke an Dokumenttypen die relevant sein könnten
- Maximal 15 Begriffe
- Keine Erklärungen, nur die Begriffe

Beispiele:
User: "Wie hoch war mein letztes Jahresgehalt?"
Antwort: Lohnausweis, Gehalt, Lohnabrechnung, Jahresgehalt, Salär, Einkommen, 2025, 2024

User: "Wieviel Unterhalt muss ich für meine Kinder zahlen?"
Antwort: Unterhalt, Alimente, Kindesunterhalt, Scheidungsurteil, Scheidung, Sorgerecht, Unterhaltszahlung, Familiengericht

User: "Hast du die Rechnung von der Garage?"
Antwort: Rechnung, Garage, Auto, Fahrzeug, Reparatur, Werkstatt, Invoice, Faktura"""},
                            {"role": "user", "content": user_message}
                        ],
                        "temperature": 0.3,
                        "max_tokens": 100,
                    })
                if resp.status_code == 200:
                    text = resp.json()["choices"][0]["message"]["content"].strip()
                    terms = [t.strip().lower() for t in text.split(",") if t.strip()]
                    logger.info(f"GPT search terms ({model}) for '{user_message[:50]}': {terms}")
                    return terms
                elif resp.status_code == 401:
                    continue  # Try next model
                else:
                    break
    except Exception as e:
        logger.warning(f"GPT search interpretation failed: {e}")
    return []


async def get_casedesk_context(message: str) -> str:
    """Build CaseDesk context for GPT chat. Uses GPT to interpret search intent."""
    url, email, pw = await get_casedesk_settings()
    if not url or not email or not pw:
        return ""

    msg_lower = message.lower() if isinstance(message, str) else message
    context_parts = []

    # Use GPT to interpret what the user is looking for
    search_terms = await _gpt_interpret_search(message)
    
    # Fallback: basic word extraction if GPT fails
    if not search_terms:
        stop_words = {"was", "ist", "die", "der", "das", "von", "vom", "letzte", "letzten",
                     "kannst", "du", "mir", "sagen", "zeig", "zeige", "hol", "hole", "such",
                     "suche", "finde", "bitte", "mich", "ein", "eine", "und", "oder", "den",
                     "dem", "des", "für", "mit", "bei", "wie", "wer", "wann", "wo", "warum",
                     "hat", "habe", "haben", "sind", "sein", "wird", "werden", "nicht", "auch",
                     "noch", "schon", "doch", "mal", "nur", "sehr", "ganz", "alle", "alles",
                     "mein", "meine", "meinen", "dein", "deine", "welche", "welcher",
                     "hoch", "viel", "wieviel", "letztes", "letzter"}
        search_terms = [w.strip("?!.,;:\"'()").lower() for w in message.split()
                       if w.strip("?!.,;:\"'()").lower() not in stop_words and len(w.strip("?!.,;:\"'()")) > 2]

    search_query = " ".join(search_terms[:8]) if search_terms else message[:60]

    try:
        # 1. ALWAYS search documents (most important for CaseDesk)
        doc_data, doc_err = await casedesk_request("GET", "/documents")
        if doc_data and not doc_err:
            docs = doc_data if isinstance(doc_data, list) else []
            # Filter documents matching the query
            matching_docs = []
            for doc in docs:
                doc_text = " ".join([
                    str(doc.get("display_name", "")),
                    str(doc.get("original_filename", "")),
                    str(doc.get("ai_summary", "")),
                    str(doc.get("ocr_text", ""))[:1000],
                    " ".join(doc.get("tags", [])),
                    str(doc.get("document_type", "")),
                    str(doc.get("sender", "")),
                ]).lower()
                if any(w in doc_text for w in search_terms if len(w) > 2):
                    matching_docs.append(doc)

            if matching_docs:
                context_parts.append(f"\n--- CaseDesk Dokumente (Treffer: {len(matching_docs)}) ---")
                for doc in matching_docs[:5]:
                    ctx = f"Dokument: {doc.get('display_name', doc.get('original_filename', '?'))}"
                    if doc.get('document_type'):
                        ctx += f" | Typ: {doc['document_type']}"
                    if doc.get('sender'):
                        ctx += f" | Absender: {doc['sender']}"
                    if doc.get('document_date'):
                        ctx += f" | Datum: {str(doc['document_date'])[:10]}"
                    if doc.get('ai_summary'):
                        ctx += f"\nZusammenfassung: {doc['ai_summary'][:800]}"
                    if doc.get('ocr_text'):
                        ctx += f"\nInhalt: {doc['ocr_text'][:1500]}"
                    context_parts.append(ctx)

        # 2. Search emails
        email_data, email_err = await casedesk_request("POST", "/emails/search", json={"query": search_query})
        if email_data and not email_err:
            results = email_data.get("results", [])
            if results:
                context_parts.append(f"\n--- CaseDesk E-Mails (Treffer: {len(results)}) ---")
                for em in results[:5]:
                    ctx = f"Von: {em.get('from_name', em.get('from_address', '?'))}"
                    ctx += f" | Betreff: {em.get('subject', '?')}"
                    ctx += f" | Datum: {str(em.get('date', em.get('received_at', '?')))[:10]}"
                    body = em.get('body_text', em.get('ai_summary', ''))
                    if body:
                        ctx += f"\nInhalt: {body[:600]}"
                    context_parts.append(ctx)

        # 3. Fetch tasks
        task_keywords = ["aufgabe", "task", "todo", "frist", "erledigen", "offen", "pending"]
        if any(kw in msg_lower for kw in task_keywords):
            data, err = await casedesk_request("GET", "/tasks")
            if data and not err:
                tasks = data if isinstance(data, list) else []
                open_tasks = [t for t in tasks if t.get("status") != "done"][:10]
                if open_tasks:
                    context_parts.append("\n--- CaseDesk Offene Aufgaben ---")
                    for t in open_tasks:
                        due = str(t['due_date'])[:10] if t.get('due_date') else 'keine'
                        context_parts.append(f"- {t.get('title', '?')} (Frist: {due}, Priorität: {t.get('priority', '?')})")

        # 4. Fetch cases
        case_keywords = ["fall", "fälle", "akte", "akten", "vorgang", "case"]
        if any(kw in msg_lower for kw in case_keywords):
            data, err = await casedesk_request("GET", "/cases")
            if data and not err:
                cases = data if isinstance(data, list) else []
                if cases:
                    context_parts.append("\n--- CaseDesk Fälle ---")
                    for c in cases[:10]:
                        context_parts.append(f"- {c.get('title', '?')} (Status: {c.get('status', '?')}, Ref: {c.get('reference_number', '-')})")

        # 5. Fetch calendar
        cal_keywords = ["termin", "kalender", "event", "datum", "wann", "nächster"]
        if any(kw in msg_lower for kw in cal_keywords):
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
        payload = {
            "title": data.get("title", "Neue Aufgabe"),
            "description": data.get("description", ""),
            "priority": data.get("priority", "medium"),
            "status": "todo",
        }
        # due_date must be ISO datetime
        if data.get("due_date"):
            dd = data["due_date"]
            if "T" not in dd:
                dd += "T09:00:00"
            payload["due_date"] = dd
        result, err = await casedesk_request("POST", "/tasks", json=payload)
        if result and not err:
            return {"success": True, "message": f"Aufgabe '{data.get('title')}' in CaseDesk erstellt."}
        return {"success": False, "message": f"Aufgabe konnte nicht erstellt werden: {err}"}

    elif action_type == "create_event":
        # EventCreate needs start_time and end_time as ISO datetime strings
        start = data.get("start_date") or data.get("start_time", "")
        end = data.get("end_date") or data.get("end_time", "")
        if start and "T" not in start:
            start += "T09:00:00"
        if not end and start:
            # Default: 1 hour after start
            end = start.replace("T09:00:00", "T10:00:00") if "T09:00:00" in start else start
        payload = {
            "title": data.get("title", "Neuer Termin"),
            "description": data.get("description", ""),
            "start_time": start,
            "end_time": end,
            "all_day": data.get("all_day", False),
        }
        result, err = await casedesk_request("POST", "/events", json=payload)
        if result and not err:
            return {"success": True, "message": f"Kalendereintrag '{data.get('title')}' in CaseDesk erstellt."}
        return {"success": False, "message": f"Kalendereintrag konnte nicht erstellt werden: {err}"}

    elif action_type == "create_case":
        payload = {
            "title": data.get("title", "Neuer Fall"),
            "description": data.get("description", ""),
            "reference_number": data.get("reference_number"),
            "tags": data.get("tags", []),
        }
        result, err = await casedesk_request("POST", "/cases", json=payload)
        if result and not err:
            return {"success": True, "message": f"Fall '{data.get('title')}' in CaseDesk erstellt."}
        return {"success": False, "message": f"Fall konnte nicht erstellt werden: {err}"}

    elif action_type == "send_email":
        # Step 1: Create draft via CaseDesk execute-action
        action_payload = json.dumps({
            "recipient": data.get("recipient", ""),
            "recipient_email": data.get("recipient_email", ""),
            "subject": data.get("subject", ""),
            "purpose": data.get("purpose", ""),
            "draft_content": data.get("draft_content", data.get("body", "")),
            "suggested_documents": data.get("suggested_documents", []),
            "context": data.get("context", ""),
        })
        # Create correspondence entry
        result, err = await casedesk_request("POST", "/ai/execute-action",
            data={"action_type": "send_email", "action_data": action_payload, "confirmed": "true"})
        if result and result.get("success"):
            corr_id = result.get("created", {}).get("id", "")
            recipient_email = data.get("recipient_email", "")
            
            # Step 2: Try to send if we have a recipient email
            if corr_id and recipient_email:
                # Get mail accounts
                accounts, acc_err = await casedesk_request("GET", "/mail-accounts")
                if accounts and isinstance(accounts, list) and len(accounts) > 0:
                    mail_account_id = accounts[0].get("id", "")
                    if mail_account_id:
                        send_result, send_err = await casedesk_request("POST", 
                            f"/ai/send-correspondence/{corr_id}",
                            data={"mail_account_id": mail_account_id, "recipient_email": recipient_email})
                        if send_result and send_result.get("success"):
                            return {"success": True, "message": f"E-Mail an '{data.get('recipient')}' ({recipient_email}) gesendet."}
                        else:
                            return {"success": True, "message": f"E-Mail-Entwurf an '{data.get('recipient')}' erstellt. Versand fehlgeschlagen: {send_err or 'SMTP nicht konfiguriert'}. Bitte in CaseDesk manuell senden."}
                    
            return {"success": True, "message": f"E-Mail-Entwurf an '{data.get('recipient')}' in CaseDesk erstellt. Bitte in CaseDesk den Versand bestätigen."}
        return {"success": False, "message": f"E-Mail konnte nicht erstellt werden: {err}"}

    return {"success": False, "message": f"Unbekannte Aktion: {action_type}"}
