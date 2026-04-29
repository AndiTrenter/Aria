"""
Aria CookPilot Integration Module
Connects to CookPilot Docker service for recipes, shopping list, pantry, meal plan.

Auth model: Aria authenticates server-to-server with CookPilot using a shared
secret (X-Aria-Secret header) and per-user JWTs obtained via POST /api/aria/sso.
JWTs are cached for 12h per Aria-user.
"""
from fastapi import APIRouter, HTTPException, Request, Body, Query
import httpx
import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cookpilot")

db = None
get_current_user = None
require_admin = None

# Per-user CookPilot permission keys
PERM_KEYS = [
    "visible",          # show CookPilot in sidebar
    "recipes_view",
    "recipes_edit",
    "shopping_view",
    "shopping_edit",
    "pantry_view",
    "pantry_edit",
    "meal_plan_view",
    "meal_plan_edit",
    "chat",             # Koch-Chat in CookPilot
    "tablet",           # Küchen-Tablet view
    "admin",            # CookPilot admin functions allowed
]
DEFAULT_PERMS = {
    "visible": True, "recipes_view": True, "recipes_edit": False,
    "shopping_view": True, "shopping_edit": True, "pantry_view": True,
    "pantry_edit": False, "meal_plan_view": True, "meal_plan_edit": False,
    "chat": True, "tablet": False, "admin": False,
}


def init(database, auth_func, admin_func):
    global db, get_current_user, require_admin
    db = database
    get_current_user = auth_func
    require_admin = admin_func


# ==================== SETTINGS ====================
async def get_cookpilot_settings() -> tuple[str, str]:
    """Return (url, shared_secret). Empty strings if unset."""
    url_doc = await db.settings.find_one({"key": "cookpilot_url"})
    secret_doc = await db.settings.find_one({"key": "cookpilot_shared_secret"})
    url = (url_doc.get("value") or "").rstrip("/") if url_doc else ""
    if url and not url.startswith("http"):
        url = f"http://{url}"
    secret = (secret_doc.get("value") or "") if secret_doc else ""
    return url, secret


async def is_available() -> bool:
    """Cached health probe — avoids 3s blocking call on every chat request."""
    url, secret = await get_cookpilot_settings()
    if not url:
        return False
    # Cache health result for 60s
    try:
        cache = await db.settings.find_one({"key": "_cookpilot_health_cache"})
        if cache:
            ts = cache.get("ts")
            ok = cache.get("ok")
            if ts and (datetime.now(timezone.utc) - datetime.fromisoformat(ts)).total_seconds() < 60:
                return bool(ok)
    except Exception:
        pass
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{url}/api/aria/health")
            ok = r.status_code == 200
    except Exception:
        ok = False
    try:
        await db.settings.update_one(
            {"key": "_cookpilot_health_cache"},
            {"$set": {"ts": datetime.now(timezone.utc).isoformat(), "ok": ok}},
            upsert=True,
        )
    except Exception:
        pass
    return ok


# ==================== SSO TOKEN CACHE ====================
async def _get_user_token(aria_user: dict) -> str | None:
    """Exchange Aria user-context for a CookPilot JWT. Caches 12h per Aria-user."""
    url, secret = await get_cookpilot_settings()
    if not url or not secret:
        return None

    user_id = aria_user["id"]
    cache = await db.cookpilot_tokens.find_one({"aria_user_id": user_id})
    now = datetime.now(timezone.utc)
    if cache and cache.get("expires_at"):
        try:
            exp = datetime.fromisoformat(cache["expires_at"])
            if exp > now and cache.get("token"):
                return cache["token"]
        except Exception:
            pass

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.post(
                f"{url}/api/aria/sso",
                json={
                    "shared_secret": secret,
                    "external_id": user_id,
                    "email": aria_user.get("email", ""),
                    "name": aria_user.get("name", ""),
                    "role": "admin" if aria_user.get("role") in ("admin", "superadmin") else "user",
                },
            )
            if r.status_code != 200:
                logger.warning(f"CookPilot SSO failed: {r.status_code} {r.text[:200]}")
                return None
            data = r.json()
            token = data.get("token")
            if not token:
                return None
            await db.cookpilot_tokens.update_one(
                {"aria_user_id": user_id},
                {"$set": {
                    "aria_user_id": user_id,
                    "token": token,
                    "expires_at": (now + timedelta(hours=12)).isoformat(),
                }},
                upsert=True,
            )
            return token
    except Exception as e:
        logger.warning(f"CookPilot SSO exception: {e}")
        return None


# ==================== PERMISSIONS ====================
def get_user_perms(user: dict) -> dict:
    cp = user.get("cookpilot_perms") or {}
    return {k: cp.get(k, DEFAULT_PERMS[k]) for k in PERM_KEYS}


def _require_perm(user: dict, key: str):
    if user.get("role") in ("admin", "superadmin"):
        return  # admins always allowed
    perms = get_user_perms(user)
    if not perms.get("visible"):
        raise HTTPException(403, "CookPilot ist für diesen Benutzer nicht freigegeben")
    if not perms.get(key):
        raise HTTPException(403, f"CookPilot-Berechtigung fehlt: {key}")


# ==================== HTTP PROXY HELPER ====================
async def _proxy(method: str, path: str, user: dict, json_body=None, params=None) -> dict | list:
    url, _ = await get_cookpilot_settings()
    if not url:
        raise HTTPException(503, "CookPilot ist nicht konfiguriert")
    token = await _get_user_token(user)
    if not token:
        raise HTTPException(503, "CookPilot SSO fehlgeschlagen — bitte Shared Secret im Admin prüfen")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.request(
                method,
                f"{url}{path}",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=json_body,
                params=params,
            )
            if r.status_code >= 400:
                logger.warning(f"CookPilot {method} {path} → {r.status_code}: {r.text[:200]}")
                raise HTTPException(r.status_code, f"CookPilot Fehler: {r.text[:200]}")
            try:
                return r.json()
            except Exception:
                return {"raw": r.text}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"CookPilot proxy error: {e}")
        raise HTTPException(502, f"CookPilot nicht erreichbar: {e}")


# ==================== ADMIN: STATUS / SETTINGS ====================
@router.get("/status")
async def cookpilot_status(request: Request):
    """Return configuration + reachability status."""
    user = await get_current_user(request)
    url, secret = await get_cookpilot_settings()
    available = await is_available() if url else False
    version = None
    if available:
        try:
            async with httpx.AsyncClient(timeout=3.0) as c:
                r = await c.get(f"{url}/api/health")
                if r.status_code == 200:
                    version = r.json().get("version")
        except Exception:
            pass
    return {
        "configured": bool(url and secret),
        "url_set": bool(url),
        "secret_set": bool(secret),
        "available": available,
        "version": version,
        "perms": get_user_perms(user) if user.get("role") not in ("admin", "superadmin") else {k: True for k in PERM_KEYS},
        "is_admin": user.get("role") in ("admin", "superadmin"),
    }


@router.post("/test")
async def cookpilot_test(request: Request):
    """Admin: ping CookPilot + try SSO with the current admin to verify shared secret."""
    user = await require_admin(request)
    url, secret = await get_cookpilot_settings()
    if not url:
        return {"ok": False, "step": "url", "detail": "CookPilot URL nicht gesetzt"}
    if not secret:
        return {"ok": False, "step": "secret", "detail": "Shared Secret nicht gesetzt"}
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            health = await client.get(f"{url}/api/aria/health")
            if health.status_code != 200:
                return {"ok": False, "step": "health", "detail": f"HTTP {health.status_code}"}
            # SSO probe
            sso = await client.post(
                f"{url}/api/aria/sso",
                json={
                    "shared_secret": secret,
                    "external_id": user["id"],
                    "email": user.get("email", ""),
                    "name": user.get("name", "Aria Admin"),
                    "role": "admin",
                },
            )
            if sso.status_code != 200:
                return {"ok": False, "step": "sso", "detail": f"HTTP {sso.status_code}: {sso.text[:160]}"}
            data = sso.json()
            return {"ok": True, "step": "done", "user_id": data.get("user_id"), "role": data.get("role")}
    except Exception as e:
        return {"ok": False, "step": "exception", "detail": str(e)[:200]}


@router.get("/sso-token")
async def cookpilot_sso_token(request: Request):
    """Frontend: get CookPilot JWT for the current user (used to bootstrap iframe auth via postMessage)."""
    user = await get_current_user(request)
    perms = get_user_perms(user)
    if user.get("role") not in ("admin", "superadmin") and not perms.get("visible"):
        raise HTTPException(403, "CookPilot nicht freigegeben")
    token = await _get_user_token(user)
    url, _ = await get_cookpilot_settings()
    return {"token": token, "url": url, "perms": perms if user.get("role") not in ("admin", "superadmin") else {k: True for k in PERM_KEYS}}


# ==================== ADMIN: PER-USER PERMISSIONS ====================
@router.put("/admin/users/{user_id}/perms")
async def update_user_perms(user_id: str, request: Request, body: dict = Body(...)):
    """Admin: set CookPilot permissions for a specific user."""
    await require_admin(request)
    from bson import ObjectId
    from bson.errors import InvalidId
    try:
        oid = ObjectId(user_id)
    except (InvalidId, TypeError):
        raise HTTPException(400, "Ungültige user_id")
    perms = {k: bool(body.get(k)) for k in PERM_KEYS}
    await db.users.update_one({"_id": oid}, {"$set": {"cookpilot_perms": perms}})
    return {"success": True, "perms": perms}


# ==================== PROXY ENDPOINTS ====================
@router.get("/recipes")
async def list_recipes(request: Request, q: str = Query("", description="Search query")):
    user = await get_current_user(request)
    _require_perm(user, "recipes_view")
    return await _proxy("GET", "/api/recipes", user, params={"q": q} if q else None)


@router.get("/recipes/{recipe_id}")
async def get_recipe(recipe_id: str, request: Request):
    user = await get_current_user(request)
    _require_perm(user, "recipes_view")
    return await _proxy("GET", f"/api/recipes/{recipe_id}", user)


@router.post("/recipes")
async def create_recipe(request: Request, body: dict = Body(...)):
    user = await get_current_user(request)
    _require_perm(user, "recipes_edit")
    return await _proxy("POST", "/api/recipes", user, json_body=body)


@router.put("/recipes/{recipe_id}")
async def update_recipe(recipe_id: str, request: Request, body: dict = Body(...)):
    user = await get_current_user(request)
    _require_perm(user, "recipes_edit")
    return await _proxy("PUT", f"/api/recipes/{recipe_id}", user, json_body=body)


@router.delete("/recipes/{recipe_id}")
async def delete_recipe(recipe_id: str, request: Request):
    user = await get_current_user(request)
    _require_perm(user, "recipes_edit")
    return await _proxy("DELETE", f"/api/recipes/{recipe_id}", user)


@router.get("/shopping-list")
async def get_shopping(request: Request):
    user = await get_current_user(request)
    _require_perm(user, "shopping_view")
    return await _proxy("GET", "/api/shopping", user)


@router.post("/shopping-list")
async def add_shopping(request: Request, body: dict = Body(...)):
    user = await get_current_user(request)
    _require_perm(user, "shopping_edit")
    return await _proxy("POST", "/api/shopping", user, json_body=body)


@router.put("/shopping-list/{item_id}")
async def update_shopping(item_id: str, request: Request, body: dict = Body(...)):
    user = await get_current_user(request)
    _require_perm(user, "shopping_edit")
    return await _proxy("PATCH", f"/api/shopping/{item_id}", user, json_body=body)


@router.post("/shopping-list/{item_id}/toggle")
async def toggle_shopping(item_id: str, request: Request):
    user = await get_current_user(request)
    _require_perm(user, "shopping_edit")
    return await _proxy("POST", f"/api/shopping/{item_id}/toggle", user)


@router.delete("/shopping-list/{item_id}")
async def delete_shopping(item_id: str, request: Request):
    user = await get_current_user(request)
    _require_perm(user, "shopping_edit")
    return await _proxy("DELETE", f"/api/shopping/{item_id}", user)


@router.get("/pantry")
async def get_pantry(request: Request):
    user = await get_current_user(request)
    _require_perm(user, "pantry_view")
    return await _proxy("GET", "/api/pantry", user)


@router.post("/pantry")
async def add_pantry(request: Request, body: dict = Body(...)):
    user = await get_current_user(request)
    _require_perm(user, "pantry_edit")
    return await _proxy("POST", "/api/pantry", user, json_body=body)


@router.put("/pantry/{item_id}")
async def update_pantry(item_id: str, request: Request, body: dict = Body(...)):
    user = await get_current_user(request)
    _require_perm(user, "pantry_edit")
    return await _proxy("PATCH", f"/api/pantry/{item_id}", user, json_body=body)


@router.post("/pantry/{item_id}/adjust")
async def adjust_pantry(item_id: str, request: Request, body: dict = Body(...)):
    """Bump pantry amount by delta (e.g. {delta: -1} when something is consumed)."""
    user = await get_current_user(request)
    _require_perm(user, "pantry_edit")
    return await _proxy("POST", f"/api/pantry/{item_id}/adjust", user, json_body=body)


@router.delete("/pantry/{item_id}")
async def delete_pantry(item_id: str, request: Request):
    user = await get_current_user(request)
    _require_perm(user, "pantry_edit")
    return await _proxy("DELETE", f"/api/pantry/{item_id}", user)


@router.get("/meal-plan")
async def get_meal_plan(request: Request):
    user = await get_current_user(request)
    _require_perm(user, "meal_plan_view")
    return await _proxy("GET", "/api/meal-plan", user)


@router.post("/meal-plan")
async def post_meal_plan(request: Request, body: dict = Body(...)):
    user = await get_current_user(request)
    _require_perm(user, "meal_plan_edit")
    return await _proxy("POST", "/api/meal-plan", user, json_body=body)


@router.post("/ai/suggest-recipes")
async def suggest_recipes(request: Request, body: dict = Body(...)):
    user = await get_current_user(request)
    _require_perm(user, "recipes_view")
    return await _proxy("POST", "/api/chat/suggest-recipes", user, json_body=body)


# ==================== ACTION EXECUTION (write paths) ====================
# Aria's chat must be able to actually MUTATE CookPilot data — not just read it.
# Without this, GPT happily replies "Brot wurde hinzugefügt!" without ever
# calling the API. We pre-detect write-intents in the user message, execute
# them deterministically, and feed the verified result back to GPT.

import re

# Common German "noise" words to strip from item parsing
_STOP_WORDS = {
    "bitte", "mir", "doch", "noch", "auch", "mal", "kannst", "du", "bitte",
    "ich", "wir", "mein", "meine", "meinen", "ein", "eine", "einen", "einer",
    "ein paar", "etwas", "ne", "nen", "der", "die", "das", "den", "dem",
    "auf", "in", "an", "zu", "und", "oder", "mit", "ohne", "vom", "von",
    "schreib", "schreibe", "trag", "trage", "trag ein", "tragen", "setze",
    "setz", "set", "füg", "füge", "fügen", "hinzu", "hinzufügen", "ergänze",
    "ergänz", "ergänzen", "addiere", "addier", "add", "leg", "lege", "legen",
    "ist", "sind", "schon", "bereits", "bitte",
}


def _split_items(item_str: str) -> list[str]:
    """Split 'Brot, Milch und Butter' into ['Brot', 'Milch', 'Butter']."""
    s = item_str.strip().rstrip(".!?")
    # Split on comma OR " und " OR " sowie " OR " plus "
    parts = re.split(r"\s*,\s*|\s+und\s+|\s+sowie\s+|\s+plus\s+|\s*&\s*|\s*\+\s*", s, flags=re.IGNORECASE)
    out = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        # Drop leading articles
        words = p.split()
        while words and words[0].lower() in {"ein", "eine", "einen", "einer", "ne", "nen", "der", "die", "das", "den", "dem", "etwas", "ein paar", "ne", "noch", "auch"}:
            words = words[1:]
        if words:
            out.append(" ".join(words).strip())
    return [x for x in out if x and len(x) <= 60]


def _detect_shopping_add(msg: str) -> list[str] | None:
    """Detect 'add X (and Y) to shopping list' intent. Return list of items or None."""
    m_lower = msg.lower().strip()
    # Patterns from highest specificity to lowest. Match on lowercased input but
    # extract from the ORIGINAL message to preserve casing of item names.
    patterns = [
        # "Setze/Schreibe/Trage/Füge X (zur|auf die|in die|zu der|der) Einkaufsliste (hinzu)"
        r"(?:set(?:z(?:e)?)?|schreib(?:e)?|trag(?:e)?(?:\s+ein)?|füg(?:e)?|leg(?:e)?|pack(?:e)?)\s+(.+?)\s+(?:auf\s+(?:die|der)|zur|in\s+die|zu\s+der|der)\s+einkaufs(?:liste)?",
        # "X auf die/zur Einkaufsliste (setzen/schreiben)"
        r"^(.+?)\s+(?:auf\s+die|zur|in\s+die)\s+einkaufs(?:liste)?",
        # "Ich brauche/Brauchen wir X (einkaufen)"
        r"(?:ich\s+brauch(?:e)?|brauchen\s+wir|brauchen)\s+(.+?)(?:\s+(?:noch|einkaufen|zum\s+einkaufen|auf\s+der\s+einkaufsliste))?$",
        # "Kauf/Besorg X ein"
        r"(?:kauf(?:e)?|besorg(?:e)?)\s+(.+?)\s+ein\s*$",
        # "X einkaufen"
        r"^(.+?)\s+einkaufen\s*$",
        # "Wir müssen/sollten X (kaufen|einkaufen|besorgen)"
        r"(?:wir\s+müssen|wir\s+sollten|müssen\s+wir|sollten\s+wir)\s+(.+?)\s+(?:kaufen|einkaufen|besorgen)",
    ]
    for pat in patterns:
        match = re.search(pat, m_lower, re.IGNORECASE)
        if match:
            # Use the same span on the ORIGINAL message to preserve case
            start, end = match.span(1)
            raw = msg.strip()[start:end].strip() if len(msg.strip()) >= end else match.group(1).strip()
            # Strip leading filler words
            while True:
                stripped = raw
                for w in ("bitte", "doch", "mal", "noch", "auch", "ja", "kannst du", "kann ich"):
                    if stripped.lower().startswith(w + " "):
                        stripped = stripped[len(w) + 1:]
                if stripped == raw:
                    break
                raw = stripped
            # strip trailing filler
            for w in (" bitte", " danke"):
                if raw.lower().endswith(w):
                    raw = raw[: -len(w)].strip()
            items = _split_items(raw)
            if items:
                return items
    return None


def _detect_shopping_check(msg: str) -> list[str] | None:
    """Detect 'mark X as bought / abhaken' intent."""
    m_lower = msg.lower().strip()
    patterns = [
        r"(?:setz(?:e)?|markier(?:e)?)\s+(.+?)\s+(?:auf\s+gekauft|als\s+gekauft|als\s+erledigt)",
        r"(?:hak(?:e)?\s+(.+?)\s+ab)",
        r"(?:hab(?:e)?\s+ich|haben\s+wir)\s+(.+?)\s+(?:gekauft|besorgt)\s*$",
        r"^(.+?)\s+ist\s+(?:gekauft|besorgt|erledigt)\s*$",
    ]
    for pat in patterns:
        match = re.search(pat, m_lower, re.IGNORECASE)
        if match:
            start, end = match.span(1)
            raw = msg.strip()[start:end].strip() if len(msg.strip()) >= end else match.group(1).strip()
            items = _split_items(raw)
            if items:
                return items
    return None


async def try_execute_cookpilot_action(message: str, aria_user: dict) -> dict | None:
    """Detect a write-action intent in `message`. If matched, execute it
    against CookPilot and return {executed: bool, summary: str, error: str|None}.
    Returns None if no action intent detected (so chat falls through to read-only context).
    """
    perms = get_user_perms(aria_user)
    is_admin = aria_user.get("role") in ("admin", "superadmin")

    # ---- Shopping: Add ----
    items = _detect_shopping_add(message)
    if items:
        if not (is_admin or perms.get("shopping_edit")):
            return {"executed": False, "summary": "", "error": "Berechtigung 'shopping_edit' fehlt."}
        url, _ = await get_cookpilot_settings()
        if not url:
            return {"executed": False, "summary": "", "error": "CookPilot nicht konfiguriert."}
        token = await _get_user_token(aria_user)
        if not token:
            return {"executed": False, "summary": "", "error": "CookPilot SSO fehlgeschlagen."}
        added, failed = [], []
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
                for it in items:
                    try:
                        r = await client.post(
                            f"{url}/api/shopping",
                            headers=headers,
                            json={"name": it, "amount": 0, "unit": "", "category": ""},
                        )
                        if r.status_code in (200, 201):
                            added.append(it)
                        else:
                            failed.append(f"{it} ({r.status_code})")
                            logger.warning(f"shopping add failed for '{it}': {r.status_code} {r.text[:120]}")
                    except Exception as e:
                        failed.append(f"{it} ({e})")
        except Exception as e:
            return {"executed": False, "summary": "", "error": f"CookPilot nicht erreichbar: {e}"}
        if not added and failed:
            return {"executed": False, "summary": "", "error": f"Fehler: {', '.join(failed)}"}
        summary_parts = []
        if added:
            summary_parts.append(f"✓ Auf Einkaufsliste hinzugefügt: {', '.join(added)}")
        if failed:
            summary_parts.append(f"Fehler bei: {', '.join(failed)}")
        return {"executed": True, "action": "shopping_add", "items": added, "summary": " | ".join(summary_parts), "error": None}

    # ---- Shopping: Mark as bought ----
    items = _detect_shopping_check(message)
    if items:
        if not (is_admin or perms.get("shopping_edit")):
            return {"executed": False, "summary": "", "error": "Berechtigung 'shopping_edit' fehlt."}
        url, _ = await get_cookpilot_settings()
        if not url:
            return {"executed": False, "summary": "", "error": "CookPilot nicht konfiguriert."}
        token = await _get_user_token(aria_user)
        if not token:
            return {"executed": False, "summary": "", "error": "CookPilot SSO fehlgeschlagen."}
        toggled, missing = [], []
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                headers = {"Authorization": f"Bearer {token}"}
                # Fetch full list, find each item by name (case-insensitive)
                r = await client.get(f"{url}/api/shopping", headers=headers)
                if r.status_code != 200:
                    return {"executed": False, "summary": "", "error": f"Liste nicht ladbar ({r.status_code})"}
                shopping = r.json() if isinstance(r.json(), list) else []
                for needle in items:
                    found = next((s for s in shopping if needle.lower() in (s.get("name") or "").lower() and not s.get("checked")), None)
                    if found:
                        item_id = found.get("id")
                        toggle_r = await client.post(f"{url}/api/shopping/{item_id}/toggle", headers=headers)
                        if toggle_r.status_code in (200, 201):
                            toggled.append(found.get("name", needle))
                        else:
                            missing.append(needle)
                    else:
                        missing.append(needle)
        except Exception as e:
            return {"executed": False, "summary": "", "error": f"CookPilot Fehler: {e}"}
        parts = []
        if toggled:
            parts.append(f"✓ Als gekauft markiert: {', '.join(toggled)}")
        if missing:
            parts.append(f"Nicht gefunden auf Liste: {', '.join(missing)}")
        if not toggled:
            return {"executed": False, "summary": "", "error": parts[0] if parts else "Nichts geändert"}
        return {"executed": True, "action": "shopping_check", "items": toggled, "summary": " | ".join(parts), "error": None}

    return None


# ==================== CHAT CONTEXT BUILDER ====================
async def get_cookpilot_context(message: str, aria_user: dict) -> str:
    """Build CookPilot context for Aria's GPT chat. Returns short text block or ''."""
    url, secret = await get_cookpilot_settings()
    if not url or not secret:
        return ""

    perms = get_user_perms(aria_user)
    is_admin = aria_user.get("role") in ("admin", "superadmin")
    if not is_admin and not perms.get("visible"):
        return ""

    msg = message.lower()
    parts = []
    token = await _get_user_token(aria_user)
    if not token:
        return ""

    def _fmt_qty(it: dict) -> str:
        """Format a pantry/shopping item's quantity — be explicit so GPT doesn't
        mistake the unit for the value. CookPilot uses 'amount' as the canonical
        field; we also accept 'quantity' / 'qty' / 'menge' for forward-compat."""
        qty = it.get("amount")
        if qty in (None, ""):
            qty = it.get("quantity")
        if qty in (None, ""):
            qty = it.get("qty")
        if qty in (None, ""):
            qty = it.get("menge")
        unit = (it.get("unit") or "").strip()
        if qty in (None, "", 0, "0", "0.0") or (isinstance(qty, (int, float)) and qty == 0):
            if unit:
                return f"(Menge nicht erfasst, Einheit {unit})"
            return "(Menge nicht erfasst)"
        return f"{qty} {unit}".strip()

    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            # Decide which collections to fetch based on intent
            wants_recipes = any(k in msg for k in ["rezept", "kochen", "backen", "essen", "menü", "menu", "gericht", "vorschlag"])
            wants_shopping = any(k in msg for k in ["einkauf", "einkaufsliste", "shopping", "kaufen", "besorg"])
            wants_pantry = any(k in msg for k in [
                "vorrat", "vorräte", "lebensmittel", "bestand", "noch da", "abgelaufen", "mhd",
                "wieviel", "wie viel", "wieviele", "wie viele", "habe ich", "haben wir",
                "hab ich", "ist noch", "sind noch", "im kühlschrank", "im kuehlschrank",
            ])
            wants_meal_plan = any(k in msg for k in ["wochenplan", "menüplan", "menuplan", "essensplan", "wochen", "morgen", "übermorgen"])

            # If unspecific cooking question, fetch recipes + pantry as defaults
            if not any([wants_recipes, wants_shopping, wants_pantry, wants_meal_plan]):
                wants_recipes = True
                wants_pantry = True

            if wants_recipes and (is_admin or perms.get("recipes_view")):
                try:
                    r = await client.get(f"{url}/api/recipes", headers=headers, params={"q": ""})
                    if r.status_code == 200:
                        recipes = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
                        if recipes:
                            parts.append(f"\n--- CookPilot Rezepte ({len(recipes)}) ---")
                            for rec in recipes[:8]:
                                title = rec.get("title") or rec.get("name", "?")
                                cat = rec.get("category", "")
                                parts.append(f"- {title}" + (f" [{cat}]" if cat else ""))
                except Exception as e:
                    logger.debug(f"cp recipes fetch: {e}")

            if wants_pantry and (is_admin or perms.get("pantry_view")):
                try:
                    r = await client.get(f"{url}/api/pantry", headers=headers)
                    if r.status_code == 200:
                        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
                        # If the user asks about a specific item ("wieviel milch"), filter to it
                        focus_keywords = [w for w in msg.replace("?", "").replace(",", " ").split() if len(w) >= 4 and w not in {"wieviel", "wie viel", "wieviele", "haben", "habe", "hast", "noch", "vorrat", "lebensmittel", "ist", "sind", "vom", "von", "mit", "ohne", "auf", "den", "die", "das", "dem", "der", "ein", "eine", "einen", "einer", "kühlschrank", "kuehlschrank"}]
                        focused = []
                        for fk in focus_keywords:
                            for it in items:
                                if fk in (it.get("name") or "").lower():
                                    focused.append(it)
                        if focused:
                            parts.append(f"\n--- CookPilot Vorrat (Treffer für deine Frage: {len(focused)}) ---")
                            for it in focused[:10]:
                                name = it.get("name", "?")
                                exp = it.get("expires_at") or it.get("best_before") or ""
                                parts.append(f"- {name}: {_fmt_qty(it)}" + (f" (MHD: {str(exp)[:10]})" if exp else ""))
                        elif items:
                            parts.append(f"\n--- CookPilot Vorrat ({len(items)} Positionen) ---")
                            for it in items[:15]:
                                name = it.get("name", "?")
                                exp = it.get("expires_at") or it.get("best_before") or ""
                                parts.append(f"- {name}: {_fmt_qty(it)}" + (f" (MHD: {str(exp)[:10]})" if exp else ""))
                        else:
                            parts.append("\n--- CookPilot Vorrat: leer ---")
                except Exception as e:
                    logger.debug(f"cp pantry fetch: {e}")

            if wants_shopping and (is_admin or perms.get("shopping_view")):
                try:
                    r = await client.get(f"{url}/api/shopping", headers=headers)
                    if r.status_code == 200:
                        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
                        # CookPilot uses 'checked'; older/forward-compat: 'bought'
                        open_items = [it for it in items if not (it.get("checked") or it.get("bought"))]
                        if open_items:
                            parts.append(f"\n--- CookPilot Einkaufsliste (offen: {len(open_items)}) ---")
                            for it in open_items[:20]:
                                parts.append(f"- {it.get('name', '?')}: {_fmt_qty(it)}")
                except Exception as e:
                    logger.debug(f"cp shopping fetch: {e}")

            if wants_meal_plan and (is_admin or perms.get("meal_plan_view")):
                try:
                    r = await client.get(f"{url}/api/meal-plan", headers=headers)
                    if r.status_code == 200:
                        plan = r.json() if isinstance(r.json(), list) else r.json().get("days", [])
                        if plan:
                            parts.append("\n--- CookPilot Wochenplan ---")
                            for day in plan[:7]:
                                d = day.get("date", "?")
                                meals = day.get("meals") or {}
                                parts.append(f"- {str(d)[:10]}: " + ", ".join([f"{k}={v}" for k, v in meals.items() if v])[:120])
                except Exception as e:
                    logger.debug(f"cp meal_plan fetch: {e}")

    except Exception as e:
        logger.warning(f"CookPilot context error: {e}")

    return "\n".join(parts) if parts else ""
