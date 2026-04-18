"""
ForgePilot Integration - Aria leitet Programmier-/Software-Anfragen an ForgePilot weiter
und spielt dessen Antworten (inkl. Rückfragen) freundlich um formuliert an den User zurück.

ForgePilot API (aus https://github.com/AndiTrenter/ForgePilot):
- POST /api/projects                          -> Projekt erstellen
- GET  /api/projects/{id}                     -> Projekt abfragen
- POST /api/projects/{id}/chat (SSE Stream)   -> Autonomer Agent-Chat
- GET  /api/health                            -> Health Check

Keine Authentifizierung (lokales Netzwerk).
"""
import httpx
import logging
import json
import asyncio
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

db = None
_get_llm_api_key = None

# Maximale Wartezeit pro Chat-Request (ForgePilot kann lange laufen)
STREAM_TIMEOUT_SECONDS = 75


def init(database, llm_key_func):
    """Initialisiert das Modul mit DB und LLM-Key-Getter."""
    global db, _get_llm_api_key
    db = database
    _get_llm_api_key = llm_key_func


async def get_forgepilot_url() -> str:
    """Liefert die konfigurierte ForgePilot URL aus der Services-Collection."""
    service = await db.services.find_one({"id": "forgepilot"}, {"_id": 0})
    if service and service.get("url"):
        return service["url"].rstrip("/")
    return ""


async def is_available() -> bool:
    """Prüft ob ForgePilot erreichbar ist."""
    url = await get_forgepilot_url()
    if not url:
        return False
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{url}/api/health")
            return r.status_code == 200
    except Exception:
        return False


async def _get_or_create_project(session_id: str, user_id: str) -> str | None:
    """Bindet eine Aria-Session an ein ForgePilot-Projekt (oder erstellt es)."""
    url = await get_forgepilot_url()
    if not url:
        return None

    mapping = await db.forgepilot_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if mapping and mapping.get("project_id"):
        # Prüfe ob Projekt noch existiert
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{url}/api/projects/{mapping['project_id']}")
                if r.status_code == 200:
                    return mapping["project_id"]
        except Exception:
            pass
        # Projekt existiert nicht mehr -> Mapping entfernen
        await db.forgepilot_sessions.delete_one({"session_id": session_id})

    # Neues Projekt erstellen
    project_name = f"Aria-{session_id[:8]}-{datetime.now().strftime('%Y%m%d')}"
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                f"{url}/api/projects",
                json={
                    "name": project_name,
                    "description": f"Aria-Session fuer User {user_id}",
                    "project_type": "fullstack",
                },
            )
            if r.status_code in (200, 201):
                data = r.json()
                pid = data.get("id")
                if pid:
                    await db.forgepilot_sessions.update_one(
                        {"session_id": session_id},
                        {"$set": {
                            "session_id": session_id,
                            "user_id": user_id,
                            "project_id": pid,
                            "project_name": project_name,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        }},
                        upsert=True,
                    )
                    logger.info(f"ForgePilot: new project '{project_name}' (id={pid}) for session {session_id}")
                    return pid
            logger.warning(f"ForgePilot project creation failed: {r.status_code} {r.text[:200]}")
    except Exception as e:
        logger.error(f"ForgePilot project creation error: {e}")
    return None


async def query_forgepilot(message: str, session_id: str, user_id: str) -> dict:
    """Sendet eine Nachricht an ForgePilot und sammelt die SSE-Antwort.

    Returns dict:
      - success: bool
      - response: str (raw ForgePilot Output)
      - ask_user: bool (ForgePilot hat eine Rückfrage)
      - question: str (die Rückfrage)
      - tools_used: list (sichtbare Tool-Aufrufe)
      - is_complete: bool
      - still_running: bool (Stream wurde wegen Timeout abgebrochen)
    """
    url = await get_forgepilot_url()
    if not url:
        return {
            "success": False,
            "response": "ForgePilot ist nicht konfiguriert. Bitte im Admin-Bereich die Dienst-URL hinterlegen.",
            "ask_user": False,
            "question": "",
            "tools_used": [],
            "is_complete": False,
            "still_running": False,
        }

    project_id = await _get_or_create_project(session_id, user_id)
    if not project_id:
        return {
            "success": False,
            "response": "ForgePilot konnte nicht erreicht werden oder es wurde kein Projekt erstellt.",
            "ask_user": False,
            "question": "",
            "tools_used": [],
            "is_complete": False,
            "still_running": False,
        }

    full_content_parts = []
    ask_user_question = ""
    tools_used = []
    is_complete = False
    ask_user_flag = False
    error_msg = ""
    still_running = False

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(STREAM_TIMEOUT_SECONDS + 5, connect=10.0)) as client:
            async def consume():
                nonlocal ask_user_question, is_complete, ask_user_flag, error_msg
                async with client.stream(
                    "POST",
                    f"{url}/api/projects/{project_id}/chat",
                    json={"content": message, "role": "user"},
                ) as resp:
                    if resp.status_code != 200:
                        err = await resp.aread()
                        error_msg = f"ForgePilot Fehler ({resp.status_code}): {err.decode('utf-8', errors='replace')[:200]}"
                        return
                    async for line in resp.aiter_lines():
                        if not line or not line.startswith("data: "):
                            continue
                        try:
                            data = json.loads(line[6:])
                        except json.JSONDecodeError:
                            continue
                        if data.get("content"):
                            full_content_parts.append(data["content"])
                        if data.get("tool"):
                            tools_used.append(data["tool"])
                        if data.get("error"):
                            full_content_parts.append(f"\n[Fehler: {data['error']}]")
                        if data.get("ask_user"):
                            ask_user_flag = True
                            ask_user_question = data.get("question", "") or "".join(full_content_parts).strip()
                            return
                        if data.get("complete") or data.get("done"):
                            is_complete = True
                            return
            try:
                await asyncio.wait_for(consume(), timeout=STREAM_TIMEOUT_SECONDS)
            except asyncio.TimeoutError:
                still_running = True
                logger.info(f"ForgePilot stream timeout reached for project {project_id}")
    except httpx.ConnectError:
        return {
            "success": False,
            "response": "ForgePilot nicht erreichbar (Connect Error). Läuft der Dienst?",
            "ask_user": False, "question": "", "tools_used": [], "is_complete": False, "still_running": False,
        }
    except Exception as e:
        logger.error(f"ForgePilot stream error: {e}")
        return {
            "success": False,
            "response": f"ForgePilot Verbindungsfehler: {str(e)[:200]}",
            "ask_user": False, "question": "", "tools_used": [], "is_complete": False, "still_running": False,
        }

    if error_msg:
        return {
            "success": False, "response": error_msg, "ask_user": False, "question": "",
            "tools_used": tools_used, "is_complete": False, "still_running": False,
        }

    raw_response = "".join(full_content_parts).strip()
    if not raw_response and ask_user_flag:
        raw_response = ask_user_question
    if not raw_response:
        raw_response = "(ForgePilot hat noch keine konkrete Antwort geliefert.)"

    return {
        "success": True,
        "response": raw_response,
        "ask_user": ask_user_flag,
        "question": ask_user_question,
        "tools_used": list(dict.fromkeys(tools_used))[:10],
        "is_complete": is_complete,
        "still_running": still_running,
        "project_id": project_id,
    }


async def friendly_rephrase(forge_result: dict, original_message: str) -> str:
    """Lässt GPT das ForgePilot-Ergebnis in Aria's freundlichem Ton umformulieren."""
    api_key = await _get_llm_api_key() if _get_llm_api_key else None
    raw = forge_result.get("response", "")
    ask_user = forge_result.get("ask_user", False)
    question = forge_result.get("question", "")
    still_running = forge_result.get("still_running", False)
    tools = forge_result.get("tools_used", [])

    # Fallback ohne GPT: raw Response mit kleinem Label
    if not api_key:
        prefix = "[ForgePilot] "
        if ask_user and question:
            return f"{prefix}ForgePilot hat eine Rückfrage an dich:\n\n{question}"
        if still_running:
            return f"{prefix}ForgePilot arbeitet noch an deiner Anfrage. Aktueller Stand:\n\n{raw}\n\n(Sende 'weiter' oder stelle eine Frage, wenn du den neuesten Stand sehen willst.)"
        return f"{prefix}{raw}"

    situation = "ForgePilot hat fertig geantwortet."
    if ask_user:
        situation = "ForgePilot hat eine RÜCKFRAGE an den User gestellt - formuliere sie freundlich um und gib sie an den User weiter."
    elif still_running:
        situation = "ForgePilot arbeitet noch im Hintergrund. Fasse den bisherigen Stand knapp zusammen und sage dem User, dass er auf Wunsch nachfragen kann."

    tool_hint = f"\nGenutzte Tools: {', '.join(tools)}" if tools else ""

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            for model in ["gpt-5.4-mini", "gpt-4o-mini"]:
                try:
                    resp = await client.post(
                        "https://api.openai.com/v1/chat/completions",
                        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                        json={
                            "model": model,
                            "messages": [
                                {"role": "system", "content": (
                                    "Du bist Aria, ein zentraler persönlicher Assistent. "
                                    "Du hast gerade einen Entwickler-Auftrag an ForgePilot (ein spezialisiertes KI-Dev-System) weitergegeben. "
                                    "Deine Aufgabe: formuliere ForgePilot's Antwort in deinem eigenen freundlichen, direkten Ton um. "
                                    "Behalte alle technischen Inhalte (Code, Befehle, Pfade, Dateinamen) UNVERÄNDERT bei - nur die Sprache drumherum freundlich umformulieren. "
                                    "Wenn es eine Rückfrage ist, stelle sie freundlich und klar. Antworte auf Deutsch. "
                                    "Beginne NICHT mit 'ForgePilot sagt:' oder ähnlichen Meta-Phrasen - sprich wie Aria selbst."
                                )},
                                {"role": "user", "content": (
                                    f"User-Anfrage war: {original_message}\n\n"
                                    f"Situation: {situation}{tool_hint}\n\n"
                                    f"ForgePilot Antwort (Rohtext):\n---\n{raw[:4000]}\n---\n\n"
                                    f"Formuliere das als Aria-Antwort um."
                                )},
                            ],
                            "temperature": 0.4,
                            "max_tokens": 800,
                        },
                    )
                    if resp.status_code == 200:
                        return resp.json()["choices"][0]["message"]["content"].strip()
                    if resp.status_code == 401:
                        continue
                    break
                except Exception as e:
                    logger.warning(f"friendly_rephrase model {model} failed: {e}")
                    continue
    except Exception as e:
        logger.warning(f"friendly_rephrase failed: {e}")

    # Fallback ohne Umformulierung
    if ask_user and question:
        return f"ForgePilot hat eine Rückfrage an dich:\n\n{question}"
    if still_running:
        return f"ForgePilot arbeitet noch an deiner Anfrage. Aktueller Stand:\n\n{raw}"
    return raw
