"""
A.R.I.A. — Persistent Personal Memory Layer.

Stores user-specific facts (preferences, routines, identity data) so ARIA
behaves like a real personal butler instead of a stateless chatbot.

Data model (MongoDB collection `aria_memories`):
    {
      "id":        uuid4 hex,
      "user_id":   "..." (string id of /users),
      "category":  "preference"|"routine"|"identity"|"work"|"family"|"other",
      "key":       short slug, used for de-dup (e.g. "favorite_coffee"),
      "value":     human-readable string (e.g. "schwarz, ohne Zucker"),
      "source":    "manual"|"casedesk"|"chat"|"system",
      "confidence": 0..1 (used to prune low-quality auto-extracted entries),
      "created_at": ISO datetime,
      "updated_at": ISO datetime,
    }

Public surface:
    init(database, llm_key_func)          — wire up
    add_memory(user_id, ..., upsert=True) — write/update one entry
    get_memories(user_id, ...)            — read all current memories
    delete_memory(user_id, mem_id)
    delete_memory_by_key(user_id, key)
    process_memory_tags(text, user_id)    — strip [AKTION:MEMORY] tags
    build_memory_context(user_id, max_chars=1800) — block injected into prompt
    extract_memories_from_chat(...)       — fire-and-forget GPT-based extractor
    sync_casedesk_profile(user_id)        — pulls CaseDesk personal docs and
                                            stores derived facts as memories
"""
import asyncio
import json
import logging
import re
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Wired up by server.py at startup
db = None
get_llm_api_key = None
casedesk_module = None  # set by server.py to the casedesk module (avoids circ. import)

OPENAI_AVAILABLE = False
try:
    from openai import AsyncOpenAI  # type: ignore
    OPENAI_AVAILABLE = True
except Exception:
    AsyncOpenAI = None  # type: ignore

CATEGORIES = {"preference", "routine", "identity", "work", "family", "other"}


def init(database, llm_key_func, casedesk_mod=None):
    global db, get_llm_api_key, casedesk_module
    db = database
    get_llm_api_key = llm_key_func
    casedesk_module = casedesk_mod


async def ensure_indexes():
    if db is None:
        return
    try:
        await db.aria_memories.create_index([("user_id", 1), ("key", 1)], unique=True)
        await db.aria_memories.create_index([("user_id", 1), ("updated_at", -1)])
    except Exception as e:
        logger.warning(f"aria_memories indexes: {e}")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (text or "").strip().lower())
    return s.strip("_")[:60] or f"mem_{uuid.uuid4().hex[:6]}"


# ─── CRUD ────────────────────────────────────────────────────────────

async def add_memory(user_id: str, value: str, category: str = "other",
                     key: str = None, source: str = "manual",
                     confidence: float = 1.0, upsert: bool = True) -> dict:
    if not user_id or not value:
        return {"success": False, "error": "user_id and value required"}
    cat = category if category in CATEGORIES else "other"
    use_key = key or _slugify(value[:40])
    now = _now()
    doc = {
        "id": uuid.uuid4().hex,
        "user_id": user_id,
        "category": cat,
        "key": use_key,
        "value": value.strip()[:600],
        "source": source if source in ("manual", "casedesk", "chat", "system") else "manual",
        "confidence": float(max(0.0, min(1.0, confidence))),
        "created_at": now,
        "updated_at": now,
    }
    if upsert:
        await db.aria_memories.update_one(
            {"user_id": user_id, "key": use_key},
            {
                "$set": {
                    "value": doc["value"],
                    "category": doc["category"],
                    "source": doc["source"],
                    "confidence": doc["confidence"],
                    "updated_at": now,
                },
                "$setOnInsert": {
                    "id": doc["id"],
                    "user_id": user_id,
                    "key": use_key,
                    "created_at": now,
                },
            },
            upsert=True,
        )
    else:
        await db.aria_memories.insert_one(doc)
    return {"success": True, "memory": doc}


async def get_memories(user_id: str, categories=None, limit: int = 50) -> list:
    if not user_id:
        return []
    q = {"user_id": user_id}
    if categories:
        q["category"] = {"$in": list(categories)}
    cursor = db.aria_memories.find(q, {"_id": 0}).sort("updated_at", -1).limit(int(limit))
    return await cursor.to_list(int(limit))


async def delete_memory(user_id: str, memory_id: str) -> dict:
    res = await db.aria_memories.delete_one({"user_id": user_id, "id": memory_id})
    return {"success": res.deleted_count > 0}


async def delete_memory_by_key(user_id: str, key: str) -> dict:
    res = await db.aria_memories.delete_one({"user_id": user_id, "key": key})
    return {"success": res.deleted_count > 0}


async def clear_all(user_id: str) -> dict:
    res = await db.aria_memories.delete_many({"user_id": user_id})
    return {"success": True, "deleted": res.deleted_count}


# ─── Prompt injection ───────────────────────────────────────────────

async def build_memory_context(user_id: str, max_chars: int = 1800) -> str:
    """Returns a compact text block to inject into the system prompt.

    Format is plain enough for any LLM to parse, grouped by category, sorted
    by recency within each group, and truncated to `max_chars` chars total.
    """
    mems = await get_memories(user_id, limit=80)
    if not mems:
        return ""
    by_cat: dict[str, list] = {}
    for m in mems:
        by_cat.setdefault(m["category"], []).append(m)
    order = ["identity", "preference", "routine", "family", "work", "other"]
    lines = ["[ARIA-GEDÄCHTNIS — Was du über den User weißt, nutze es proaktiv]"]
    used = len(lines[0])
    for cat in order:
        items = by_cat.get(cat, [])
        if not items:
            continue
        head = f"• {cat.upper()}:"
        if used + len(head) + 4 > max_chars:
            break
        lines.append(head)
        used += len(head) + 1
        for m in items:
            line = f"  – {m['value']}"
            if used + len(line) + 1 > max_chars:
                lines.append("  – […weitere Einträge gekürzt]")
                return "\n".join(lines)
            lines.append(line)
            used += len(line) + 1
    return "\n".join(lines)


# ─── [AKTION:MEMORY] tag handler ────────────────────────────────────
#
# ARIA may emit one or more inline tags in her response. We strip them
# from the visible output and persist them as memories.
#
# Tag formats (both supported):
#   [AKTION:MEMORY] {"key":"favorite_coffee","value":"schwarz, ohne Zucker","category":"preference"}
#   [AKTION:MEMORY] User wohnt in Köln                       (free-text fallback, category=other)

_MEMORY_TAG = re.compile(r'\[AKTION:MEMORY\]\s*(\{[^}]+\}|[^\[\n]+)', re.IGNORECASE)


async def process_memory_tags(response_text: str, user_id: str) -> str:
    if not response_text or "[AKTION:MEMORY]" not in response_text.upper():
        return response_text
    saved = 0
    for match in _MEMORY_TAG.findall(response_text):
        payload = match.strip()
        try:
            if payload.startswith("{"):
                obj = json.loads(payload)
                value = (obj.get("value") or "").strip()
                if not value:
                    continue
                await add_memory(
                    user_id,
                    value=value,
                    category=obj.get("category", "other"),
                    key=obj.get("key"),
                    source="chat",
                    confidence=float(obj.get("confidence", 0.85)),
                )
            else:
                await add_memory(user_id, value=payload, category="other", source="chat", confidence=0.7)
            saved += 1
        except Exception as e:
            logger.warning(f"memory tag parse failed: {e}")
    cleaned = _MEMORY_TAG.sub("", response_text).strip()
    if saved > 0:
        logger.info(f"aria_memory: stored {saved} new memory entries for user {user_id}")
    return cleaned


# ─── GPT-driven background extractor ────────────────────────────────

_EXTRACT_SYSTEM = (
    "Analysiere die folgende User-Nachricht (NICHT die Assistant-Antwort). "
    "Extrahiere NUR konkrete, langfristig relevante persönliche Fakten über den User: "
    "Vorlieben (preference), Routinen (routine), Identität/Stammdaten (identity), "
    "Arbeit (work), Familie (family). KEINE flüchtigen Aussagen, KEINE Fragen, "
    "KEINE Aufgaben, KEINE Smalltalk-Phrasen, KEINE expliziten Befehle. "
    "Wenn die Nachricht keine solchen Fakten enthält, gib `[]` zurück. "
    "Antworte AUSSCHLIESSLICH mit JSON: ein Array, jedes Element "
    "{\"key\": kurzer_slug, \"value\": kurzer_satz, \"category\": one-of(preference|routine|identity|work|family), \"confidence\": 0..1}. "
    "Maximal 5 Einträge."
)


async def extract_memories_from_chat(user_id: str, user_message: str) -> int:
    """Fire-and-forget: extract long-term facts from a single user utterance."""
    if not user_id or not user_message or len(user_message) < 25:
        return 0
    if not OPENAI_AVAILABLE or not get_llm_api_key:
        return 0
    api_key = await get_llm_api_key()
    if not api_key:
        return 0
    try:
        client = AsyncOpenAI(api_key=api_key)
        resp = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _EXTRACT_SYSTEM},
                {"role": "user", "content": user_message[:1200]},
            ],
            temperature=0.1,
            max_tokens=300,
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
        items = data if isinstance(data, list) else data.get("items") or data.get("memories") or []
        count = 0
        for it in items[:5]:
            if not isinstance(it, dict):
                continue
            v = (it.get("value") or "").strip()
            if not v:
                continue
            await add_memory(
                user_id,
                value=v,
                category=it.get("category", "other"),
                key=it.get("key"),
                source="chat",
                confidence=float(it.get("confidence", 0.7)),
            )
            count += 1
        return count
    except Exception as e:
        logger.debug(f"extract_memories_from_chat skipped: {e}")
        return 0


# ─── CaseDesk profile sync ──────────────────────────────────────────

_CASEDESK_EXTRACT_SYSTEM = (
    "Du erhältst eine Liste persönlicher Dokumente eines Users (Name, Typ, Zusammenfassung). "
    "Extrahiere langfristig nützliche persönliche Fakten als JSON-Array: "
    "{key, value, category} mit category one-of(identity|preference|family|work). "
    "BEISPIELE: Versicherungsnummer, Wohnadresse, Geburtsdatum, Familienmitglieder, "
    "Arbeitgeber, Bankverbindung, KFZ-Kennzeichen, Allergien. "
    "Erfinde NICHTS. Wenn nichts Sinnvolles ableitbar ist, gib `[]` zurück. "
    "Maximal 20 Einträge. Antwort: NUR ein JSON-Objekt {\"items\": [...]}."
)


async def sync_casedesk_profile(user_id: str) -> dict:
    """Pulls the user's CaseDesk personal documents and stores derived facts.

    This is intentionally read-only — never modifies CaseDesk, only ARIA-Memory.
    Idempotent: re-runs upsert into the same keys, so it's safe to call daily.
    """
    if casedesk_module is None:
        return {"success": False, "error": "casedesk module not wired"}
    try:
        url, email, pw = await casedesk_module.get_casedesk_settings()
    except Exception:
        return {"success": False, "error": "casedesk settings missing"}
    if not url or not email or not pw:
        return {"success": False, "error": "casedesk not configured"}

    # Pull a slice of personal documents
    try:
        doc_data, doc_err = await casedesk_module.casedesk_request("GET", "/documents")
    except Exception as e:
        return {"success": False, "error": f"casedesk fetch: {e}"}
    if doc_err or not doc_data:
        return {"success": False, "error": doc_err or "no docs"}

    docs = doc_data if isinstance(doc_data, list) else []
    if not docs:
        return {"success": True, "synced": 0, "message": "keine Dokumente"}

    # Compose a compact list to send to GPT (top 30 most relevant)
    short_docs = []
    PERSONAL_TYPES = {
        "ausweis", "personalausweis", "reisepass", "geburtsurkunde",
        "versicherung", "vertrag", "miete", "mietvertrag", "lohnabrechnung",
        "steuer", "steuerbescheid", "bank", "kontoauszug", "kfz", "fahrzeug",
        "rezept", "arzt", "diagnose", "schule", "zeugnis",
    }
    for doc in docs[:120]:
        dtype = (doc.get("document_type") or "").lower()
        name = doc.get("display_name") or doc.get("original_filename") or ""
        summary = (doc.get("ai_summary") or "")[:500]
        # Heuristic: prefer docs that look personal
        if dtype in PERSONAL_TYPES or any(k in name.lower() for k in PERSONAL_TYPES) or summary:
            short_docs.append({
                "name": name[:120],
                "type": dtype[:60],
                "summary": summary,
            })
        if len(short_docs) >= 30:
            break

    if not short_docs:
        return {"success": True, "synced": 0, "message": "keine persönlichen Dokumente erkannt"}

    if not OPENAI_AVAILABLE:
        return {"success": False, "error": "openai sdk missing"}
    api_key = await get_llm_api_key() if get_llm_api_key else None
    if not api_key:
        return {"success": False, "error": "kein OpenAI-Key"}

    try:
        client = AsyncOpenAI(api_key=api_key)
        resp = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _CASEDESK_EXTRACT_SYSTEM},
                {"role": "user", "content": json.dumps(short_docs, ensure_ascii=False)},
            ],
            temperature=0.1,
            max_tokens=900,
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
        items = data.get("items") if isinstance(data, dict) else data
        if not isinstance(items, list):
            items = []
    except Exception as e:
        return {"success": False, "error": f"gpt extract: {e}"}

    synced = 0
    for it in items[:25]:
        if not isinstance(it, dict):
            continue
        v = (it.get("value") or "").strip()
        if not v:
            continue
        await add_memory(
            user_id,
            value=v,
            category=it.get("category", "identity"),
            key=it.get("key"),
            source="casedesk",
            confidence=float(it.get("confidence", 0.85)),
        )
        synced += 1
    # Stamp last-sync time so we can avoid re-running too often
    await db.aria_memory_meta.update_one(
        {"user_id": user_id, "kind": "casedesk_sync"},
        {"$set": {"last_sync_at": _now(), "synced": synced}},
        upsert=True,
    )
    logger.info(f"aria_memory: CaseDesk sync stored {synced} entries for user {user_id}")
    return {"success": True, "synced": synced}


async def should_resync_casedesk(user_id: str, hours: int = 24) -> bool:
    meta = await db.aria_memory_meta.find_one({"user_id": user_id, "kind": "casedesk_sync"})
    if not meta:
        return True
    last = meta.get("last_sync_at")
    if not last:
        return True
    try:
        last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
        delta = (datetime.now(timezone.utc) - last_dt).total_seconds()
        return delta > hours * 3600
    except Exception:
        return True


async def maybe_async_resync_casedesk(user_id: str):
    """Fire-and-forget: trigger casedesk sync if older than 24h."""
    try:
        if await should_resync_casedesk(user_id):
            asyncio.create_task(sync_casedesk_profile(user_id))
    except Exception as e:
        logger.debug(f"maybe_async_resync_casedesk: {e}")
