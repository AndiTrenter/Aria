"""
A.R.I.A. — Tavily-powered web research with smart caching + knowledge base.

Architecture:
    1. Settings (DB collection `tavily_settings` — single doc):
       enabled, api_key, search_mode (basic|advanced), daily_limit,
       monthly_limit, per_user_limit, cache_enabled, cache_ttl_days,
       freshness_check_enabled, log_searches.

    2. Knowledge base (`tavily_knowledge` — one doc per researched
       topic, deduplicated by `query_normalized`):
       {topic, summary, key_facts[], sources[{url,title,trust}],
        category, query_terms[], created_at, last_checked_at,
        confidence}

    3. Logs (`tavily_logs`):
       {user_id, query, ts, results_count, source ("api"|"cache"),
        elapsed_ms, success, error}

    4. Smart usage flow (`smart_research`):
       a. Check knowledge base for fresh hit (within ttl_days).
       b. If fresh → return cached.
       c. If stale → ask Tavily, refresh entry.
       d. If miss → ask Tavily, store new entry.

    5. Action tag in chat:
       [AKTION:WEBSUCHE] {"query":"...","reason":"..."}
       — emitted by the LLM when it decides external research is needed.
       The chat handler intercepts the tag, runs `smart_research`, and
       can re-prompt the LLM with the fresh facts (or expose them as a
       holo-panel).

Public surface:
    init(database)
    ensure_indexes()
    get_settings(), update_settings(...)
    smart_research(user_id, query) -> {answer, sources, source: "cache"|"api"}
    list_knowledge(...), delete_knowledge(...)
    get_usage_stats()
"""
import asyncio
import logging
import re
import uuid
from datetime import datetime, timezone, timedelta

import httpx

logger = logging.getLogger(__name__)

db = None
TAVILY_ENDPOINT = "https://api.tavily.com/search"

# Wired up by server.py
get_llm_api_key = None

# Lazy import marker
_OPENAI_AVAILABLE = False
try:
    from openai import AsyncOpenAI  # noqa: F401  (used inside helpers)
    _OPENAI_AVAILABLE = True
except Exception:
    pass

# Allowed auto-recategorisation labels — kept short so the LLM has a
# consistent vocabulary across runs.
RECATEGORIZE_LABELS = [
    "news", "product", "tech", "software", "api_docs", "legal",
    "health", "finance", "travel", "history", "person", "general",
]

DEFAULT_SETTINGS = {
    "enabled": False,
    "api_key": "",
    "search_mode": "basic",          # basic | advanced
    "daily_limit": 100,              # 0 = unlimited
    "monthly_limit": 1000,           # 0 = unlimited
    "per_user_limit_per_day": 50,    # 0 = unlimited
    "cache_enabled": True,
    "cache_ttl_days": 14,            # how long a knowledge entry is fresh
    "freshness_check_enabled": True,
    "log_searches": True,
    "max_results": 5,
}


def init(database, llm_key_func=None):
    global db, get_llm_api_key
    db = database
    get_llm_api_key = llm_key_func


async def ensure_indexes():
    if db is None:
        return
    try:
        await db.tavily_knowledge.create_index([("query_normalized", 1)], unique=True)
        await db.tavily_knowledge.create_index([("last_checked_at", -1)])
        await db.tavily_knowledge.create_index([("category", 1)])
        await db.tavily_logs.create_index([("ts", -1)])
        await db.tavily_logs.create_index([("user_id", 1), ("ts", -1)])
    except Exception as e:
        logger.warning(f"tavily indexes: {e}")


def _now():
    return datetime.now(timezone.utc)


def _normalize_query(q: str) -> str:
    s = (q or "").lower().strip()
    s = re.sub(r"[^\w\s äöüß]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:200]


# ── Settings CRUD ──────────────────────────────────────────────────

async def get_settings() -> dict:
    if db is None:
        return dict(DEFAULT_SETTINGS)
    doc = await db.tavily_settings.find_one({"id": "global"}, {"_id": 0})
    if not doc:
        return dict(DEFAULT_SETTINGS)
    merged = dict(DEFAULT_SETTINGS)
    merged.update({k: v for k, v in doc.items() if k != "id"})
    return merged


async def update_settings(patch: dict) -> dict:
    if db is None:
        return dict(DEFAULT_SETTINGS)
    allowed = set(DEFAULT_SETTINGS.keys())
    clean = {k: v for k, v in patch.items() if k in allowed}
    if not clean:
        return await get_settings()
    clean["updated_at"] = _now().isoformat()
    await db.tavily_settings.update_one(
        {"id": "global"},
        {"$set": clean, "$setOnInsert": {"id": "global"}},
        upsert=True,
    )
    return await get_settings()


# ── Quota tracking ─────────────────────────────────────────────────

async def _count_logs_since(since: datetime, user_id: str = None) -> int:
    q = {"ts": {"$gte": since.isoformat()}, "source": "api"}
    if user_id:
        q["user_id"] = user_id
    return await db.tavily_logs.count_documents(q)


async def _check_quota(settings: dict, user_id: str) -> tuple[bool, str]:
    if not settings.get("log_searches", True):
        # Without logs we can't enforce quotas — allow but warn
        return True, ""
    now = _now()
    if (settings.get("daily_limit") or 0) > 0:
        used = await _count_logs_since(now - timedelta(days=1))
        if used >= settings["daily_limit"]:
            return False, f"daily limit reached ({settings['daily_limit']})"
    if (settings.get("monthly_limit") or 0) > 0:
        used = await _count_logs_since(now - timedelta(days=30))
        if used >= settings["monthly_limit"]:
            return False, f"monthly limit reached ({settings['monthly_limit']})"
    if (settings.get("per_user_limit_per_day") or 0) > 0 and user_id:
        used = await _count_logs_since(now - timedelta(days=1), user_id=user_id)
        if used >= settings["per_user_limit_per_day"]:
            return False, f"per-user daily limit reached ({settings['per_user_limit_per_day']})"
    return True, ""


# ── Knowledge base ─────────────────────────────────────────────────

async def find_knowledge(query: str) -> dict | None:
    if db is None:
        return None
    norm = _normalize_query(query)
    if not norm:
        return None
    doc = await db.tavily_knowledge.find_one({"query_normalized": norm}, {"_id": 0})
    return doc


async def is_fresh(entry: dict, ttl_days: int) -> bool:
    if not entry:
        return False
    ts = entry.get("last_checked_at") or entry.get("created_at")
    if not ts:
        return False
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return (_now() - dt) < timedelta(days=ttl_days)
    except Exception:
        return False


async def upsert_knowledge(query: str, summary: str, key_facts: list,
                           sources: list, category: str = "general",
                           query_terms: list = None,
                           embedding: list = None) -> dict:
    norm = _normalize_query(query)
    now = _now().isoformat()
    payload = {
        "summary": summary[:2000],
        "key_facts": list(key_facts or [])[:20],
        "sources": list(sources or [])[:8],
        "category": category[:60],
        "query_terms": list(query_terms or [query])[:10],
        "last_checked_at": now,
        "topic": query[:200],
    }
    if embedding is not None:
        payload["embedding"] = embedding
    await db.tavily_knowledge.update_one(
        {"query_normalized": norm},
        {
            "$set": payload,
            "$setOnInsert": {
                "id": uuid.uuid4().hex,
                "query_normalized": norm,
                "created_at": now,
                "confidence": 0.85,
            },
        },
        upsert=True,
    )
    return await db.tavily_knowledge.find_one({"query_normalized": norm}, {"_id": 0})


async def list_knowledge(limit: int = 100, category: str = None) -> list:
    if db is None:
        return []
    q = {}
    if category:
        q["category"] = category
    cursor = db.tavily_knowledge.find(q, {"_id": 0, "embedding": 0}).sort("last_checked_at", -1).limit(limit)
    return await cursor.to_list(limit)


async def delete_knowledge(entry_id: str) -> dict:
    res = await db.tavily_knowledge.delete_one({"id": entry_id})
    return {"success": res.deleted_count > 0}


# ── Tavily API call ────────────────────────────────────────────────

async def _call_tavily(query: str, settings: dict) -> dict:
    api_key = (settings.get("api_key") or "").strip()
    if not api_key:
        return {"success": False, "error": "no api key"}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                TAVILY_ENDPOINT,
                json={
                    "api_key": api_key,
                    "query": query,
                    "search_depth": settings.get("search_mode", "basic"),
                    "max_results": int(settings.get("max_results", 5)),
                    "include_answer": True,
                    "include_raw_content": False,
                },
            )
            if resp.status_code != 200:
                return {"success": False, "error": f"tavily http {resp.status_code}: {resp.text[:200]}"}
            data = resp.json()
            return {"success": True, "data": data}
    except Exception as e:
        return {"success": False, "error": f"tavily call failed: {e}"}


# ── Smart research entrypoint ──────────────────────────────────────

async def smart_research(user_id: str, query: str,
                         force_refresh: bool = False) -> dict:
    """The brains of the operation.

    Flow:
        1. Check settings — if disabled, return immediately.
        2. Check knowledge base for a fresh hit → return cached.
        3. Check quota → bail out if exceeded.
        4. Call Tavily → upsert knowledge.
        5. Always log the call.
    """
    settings = await get_settings()
    if not settings.get("enabled"):
        return {"success": False, "error": "tavily disabled in settings"}
    if not (settings.get("api_key") or "").strip():
        return {"success": False, "error": "tavily api key not configured"}

    started = _now()

    # 1) Cache lookup — exact match first, then semantic match
    if settings.get("cache_enabled", True) and not force_refresh:
        ttl_days = int(settings.get("cache_ttl_days", 14))
        existing = await find_knowledge(query)
        # If exact-key miss, try embedding-based semantic match
        if not (existing and await is_fresh(existing, ttl_days)):
            semantic_hit = await find_semantic_match(query, ttl_days)
            if semantic_hit:
                existing = semantic_hit
        if existing and await is_fresh(existing, ttl_days):
            await db.tavily_logs.insert_one({
                "id": uuid.uuid4().hex,
                "user_id": user_id,
                "query": query[:300],
                "ts": started.isoformat(),
                "results_count": len(existing.get("sources", [])),
                "source": "cache",
                "elapsed_ms": 0,
                "success": True,
                "match_score": existing.get("_match_score"),
            })
            return {
                "success": True,
                "source": "cache",
                "topic": existing.get("topic"),
                "summary": existing.get("summary"),
                "key_facts": existing.get("key_facts", []),
                "sources": existing.get("sources", []),
                "category": existing.get("category"),
                "fetched_at": existing.get("last_checked_at"),
                "match_score": existing.get("_match_score"),
            }

    # 2) Quota
    ok, reason = await _check_quota(settings, user_id)
    if not ok:
        await db.tavily_logs.insert_one({
            "id": uuid.uuid4().hex,
            "user_id": user_id,
            "query": query[:300],
            "ts": started.isoformat(),
            "results_count": 0,
            "source": "api",
            "elapsed_ms": 0,
            "success": False,
            "error": reason,
        })
        return {"success": False, "error": reason}

    # 3) API call
    result = await _call_tavily(query, settings)
    elapsed_ms = int((_now() - started).total_seconds() * 1000)

    if not result.get("success"):
        if settings.get("log_searches", True):
            await db.tavily_logs.insert_one({
                "id": uuid.uuid4().hex,
                "user_id": user_id,
                "query": query[:300],
                "ts": started.isoformat(),
                "results_count": 0,
                "source": "api",
                "elapsed_ms": elapsed_ms,
                "success": False,
                "error": result.get("error"),
            })
        return result

    data = result["data"] or {}
    answer = (data.get("answer") or "").strip()
    raw_results = data.get("results") or []
    sources = []
    key_facts = []
    for r in raw_results:
        sources.append({
            "url":   r.get("url"),
            "title": (r.get("title") or "")[:200],
            "snippet": (r.get("content") or "")[:600],
            "trust": float(r.get("score", 0.6)),
        })
        # Extract a short fact from each result snippet
        snip = (r.get("content") or "").strip()
        if snip:
            key_facts.append(snip.split(". ")[0][:240])

    summary = answer or " ".join(key_facts[:3])[:1500]
    if settings.get("cache_enabled", True):
        # Compute embedding (best-effort) so future semantic lookups hit
        embedding = await _embed(f"{query}\n{summary}")
        entry = await upsert_knowledge(
            query=query,
            summary=summary,
            key_facts=key_facts,
            sources=sources,
            category="general",
            query_terms=[query],
            embedding=embedding,
        )
        # Fire-and-forget LLM auto-recategorisation
        try:
            if entry and entry.get("id"):
                asyncio.create_task(_categorize_and_persist(entry["id"], query, summary))
        except Exception:
            pass

    if settings.get("log_searches", True):
        await db.tavily_logs.insert_one({
            "id": uuid.uuid4().hex,
            "user_id": user_id,
            "query": query[:300],
            "ts": started.isoformat(),
            "results_count": len(sources),
            "source": "api",
            "elapsed_ms": elapsed_ms,
            "success": True,
        })

    return {
        "success": True,
        "source": "api",
        "topic": query[:200],
        "summary": summary,
        "key_facts": key_facts,
        "sources": sources,
        "elapsed_ms": elapsed_ms,
    }


# ── Stats ──────────────────────────────────────────────────────────

async def get_usage_stats() -> dict:
    if db is None:
        return {}
    now = _now()
    day_start = now - timedelta(days=1)
    month_start = now - timedelta(days=30)
    today_api = await db.tavily_logs.count_documents({
        "ts": {"$gte": day_start.isoformat()}, "source": "api", "success": True,
    })
    month_api = await db.tavily_logs.count_documents({
        "ts": {"$gte": month_start.isoformat()}, "source": "api", "success": True,
    })
    today_cache = await db.tavily_logs.count_documents({
        "ts": {"$gte": day_start.isoformat()}, "source": "cache",
    })
    knowledge_count = await db.tavily_knowledge.count_documents({})
    return {
        "today_api": today_api,
        "month_api": month_api,
        "today_cache_hits": today_cache,
        "knowledge_count": knowledge_count,
    }


async def list_logs(limit: int = 100) -> list:
    if db is None:
        return []
    cursor = db.tavily_logs.find({}, {"_id": 0}).sort("ts", -1).limit(limit)
    return await cursor.to_list(limit)


async def test_connection(api_key_override: str = None) -> dict:
    """Quick health-check: send a minimal query to Tavily and return
    whether the call succeeded. Doesn't store anything in cache/logs."""
    settings = await get_settings()
    api_key = (api_key_override or settings.get("api_key") or "").strip()
    if not api_key:
        return {"success": False, "error": "kein API-Key gesetzt"}
    started = _now()
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            resp = await client.post(
                TAVILY_ENDPOINT,
                json={
                    "api_key": api_key,
                    "query": "test",
                    "search_depth": "basic",
                    "max_results": 1,
                    "include_answer": False,
                },
            )
            elapsed = int((_now() - started).total_seconds() * 1000)
            if resp.status_code == 200:
                data = resp.json() or {}
                return {
                    "success": True,
                    "elapsed_ms": elapsed,
                    "results_count": len(data.get("results") or []),
                    "message": "Tavily-Verbindung OK",
                }
            return {
                "success": False,
                "elapsed_ms": elapsed,
                "error": f"HTTP {resp.status_code}: {resp.text[:200]}",
            }
    except Exception as e:
        return {"success": False, "error": f"Anfrage fehlgeschlagen: {e}"}


# ── Embeddings + semantic cache search ─────────────────────────────
#
# We store an OpenAI text-embedding-3-small (1536 dim) vector alongside
# each knowledge entry. On a new query, we embed the query and pick the
# top entry by cosine similarity if it's >= SEMANTIC_THRESHOLD AND fresh.
#
# 10k entries × 1536 floats × 4 B = 60 MB in memory — fine for typical
# personal-assistant scale. For larger scales swap to Mongo Atlas vector
# search later.

SEMANTIC_THRESHOLD = 0.86
EMBED_MODEL = "text-embedding-3-small"


async def _embed(text: str) -> list | None:
    if not _OPENAI_AVAILABLE or not get_llm_api_key:
        return None
    api_key = await get_llm_api_key() if callable(get_llm_api_key) else None
    if not api_key:
        return None
    try:
        from openai import AsyncOpenAI as _AC
        client = _AC(api_key=api_key)
        resp = await client.embeddings.create(model=EMBED_MODEL, input=text[:1500])
        return list(resp.data[0].embedding)
    except Exception as e:
        logger.debug(f"embed failed: {e}")
        return None


def _cosine(a: list, b: list) -> float:
    n = min(len(a), len(b))
    if n == 0:
        return 0.0
    dot = 0.0
    aa = 0.0
    bb = 0.0
    for i in range(n):
        x = a[i]; y = b[i]
        dot += x * y
        aa += x * x
        bb += y * y
    if aa == 0 or bb == 0:
        return 0.0
    return dot / ((aa ** 0.5) * (bb ** 0.5))


async def find_semantic_match(query: str, ttl_days: int) -> dict | None:
    """Return a fresh knowledge entry whose embedding is similar enough."""
    qvec = await _embed(query)
    if not qvec:
        return None
    cursor = db.tavily_knowledge.find(
        {"embedding": {"$exists": True, "$ne": None}},
        {"_id": 0},
    ).limit(800)
    best = None
    best_score = 0.0
    async for doc in cursor:
        emb = doc.get("embedding")
        if not emb:
            continue
        sc = _cosine(qvec, emb)
        if sc > best_score:
            best_score = sc
            best = doc
    if best and best_score >= SEMANTIC_THRESHOLD and await is_fresh(best, ttl_days):
        best["_match_score"] = round(best_score, 4)
        return best
    return None


# ── Auto-recategorisation (LLM-backed) ─────────────────────────────

async def auto_categorize(query: str, summary: str) -> str | None:
    if not _OPENAI_AVAILABLE or not get_llm_api_key:
        return None
    api_key = await get_llm_api_key() if callable(get_llm_api_key) else None
    if not api_key:
        return None
    try:
        from openai import AsyncOpenAI as _AC
        client = _AC(api_key=api_key)
        prompt = (
            "Klassifiziere diese Wissens-Anfrage in EINE der Kategorien: "
            + ", ".join(RECATEGORIZE_LABELS)
            + ". Antworte AUSSCHLIESSLICH mit dem Label, kein anderer Text.\n\n"
            f"FRAGE: {query[:200]}\nZUSAMMENFASSUNG: {summary[:600]}"
        )
        resp = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            max_tokens=10,
        )
        label = (resp.choices[0].message.content or "").strip().lower()
        # accept only known labels
        return label if label in RECATEGORIZE_LABELS else "general"
    except Exception as e:
        logger.debug(f"auto_categorize failed: {e}")
        return None


async def _categorize_and_persist(entry_id: str, query: str, summary: str):
    """Background task: assign category + persist."""
    try:
        cat = await auto_categorize(query, summary)
        if cat:
            await db.tavily_knowledge.update_one(
                {"id": entry_id},
                {"$set": {"category": cat, "auto_categorized_at": _now().isoformat()}},
            )
    except Exception:
        pass
