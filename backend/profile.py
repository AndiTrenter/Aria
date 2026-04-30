"""
Aria User-Profile Module
Speichert den umfassenden Benutzer-Steckbrief (Identität, Adresse, Kontakt,
Familie, Gesundheit/Allergien, Präferenzen) in MongoDB und stellt einen
Read-Endpoint für CaseDesk (und andere Dienste) bereit.

Flow:
  1. Beim ersten Login checkt das Frontend `GET /api/profile/me/status`.
     Ist `onboarded_at=null` → Wizard-Weiche auf `/onboarding`.
  2. Wizard schickt nach jedem Step ein `PATCH /api/profile/me`.
  3. Beim Abschluss ruft das Frontend `POST /api/profile/me/complete`.
  4. CaseDesk (oder ForgePilot, CookPilot, ...) können den Profil-Steckbrief
     eines Aria-Users via `GET /api/profile/aria-user/{aria_user_id}` lesen
     (authorisiert via X-Aria-Secret Header).
"""
from fastapi import APIRouter, HTTPException, Request, Body, Header
from bson import ObjectId
from bson.errors import InvalidId
from datetime import datetime, timezone
import os
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/profile")

db = None
get_current_user = None

# Fields we accept — keep in sync with frontend wizard steps
PROFILE_FIELDS = {
    # Identität
    "first_name", "last_name", "nickname", "birth_date", "gender",
    "nationality", "preferred_language",
    # Adresse
    "address_street", "address_zip", "address_city", "address_country",
    # Kontakt
    "phone_mobile", "phone_home", "emergency_contact_name", "emergency_contact_phone",
    # Familie
    "marital_status", "partner_name", "children",  # children: list of {name, birth_date}
    # Gesundheit / Küche
    "allergies", "intolerances", "diet", "medications", "blood_type",
    "gp_name", "gp_phone", "health_insurance",
    # Beruf
    "occupation", "employer",
    # Präferenzen / Smalltalk
    "interests", "favorite_color", "notes",
    # DSGVO
    "consent_share_with_services",
}

REQUIRED_FIELDS = {"first_name", "allergies", "marital_status"}


def init(database, auth_func):
    global db, get_current_user
    db = database
    get_current_user = auth_func


def _sanitize(patch: dict) -> dict:
    """Drop unknown keys, trim strings."""
    out = {}
    for k, v in patch.items():
        if k not in PROFILE_FIELDS:
            continue
        if isinstance(v, str):
            v = v.strip()
        out[k] = v
    return out


async def _fetch_profile(aria_user_id: str) -> dict:
    """Fetch a user's profile merged with user basics (name, email, role)."""
    prof = await db.user_profiles.find_one({"aria_user_id": aria_user_id}, {"_id": 0}) or {}
    try:
        u = await db.users.find_one({"_id": ObjectId(aria_user_id)}, {"password_hash": 0})
    except InvalidId:
        u = None
    if u:
        prof.setdefault("email", u.get("email"))
        prof.setdefault("first_name", prof.get("first_name") or (u.get("name", "").split(" ")[0] if u.get("name") else ""))
        prof.setdefault("last_name", prof.get("last_name") or " ".join(u.get("name", "").split(" ")[1:]) or "")
        prof["aria_user_id"] = aria_user_id
        prof["role"] = u.get("role", "user")
    return prof


# ==================== OWNER ENDPOINTS (self) ====================

@router.get("/me/status")
async def get_my_status(request: Request):
    """Frontend polls this after login. If onboarded_at is null/missing,
    redirect user to /onboarding wizard."""
    user = await get_current_user(request)
    doc = await db.user_profiles.find_one({"aria_user_id": user["id"]}, {"_id": 0})
    return {
        "onboarded_at": (doc or {}).get("onboarded_at"),
        "needs_onboarding": not bool((doc or {}).get("onboarded_at")),
        "profile_exists": bool(doc),
    }


@router.get("/me")
async def get_my_profile(request: Request):
    user = await get_current_user(request)
    return await _fetch_profile(user["id"])


@router.patch("/me")
async def patch_my_profile(request: Request, patch: dict = Body(...)):
    """Wizard calls this after every step to save partial progress."""
    user = await get_current_user(request)
    clean = _sanitize(patch)
    if not clean:
        raise HTTPException(400, "Keine bekannten Profil-Felder im Body.")
    now = datetime.now(timezone.utc).isoformat()
    await db.user_profiles.update_one(
        {"aria_user_id": user["id"]},
        {"$set": {**clean, "aria_user_id": user["id"], "updated_at": now}},
        upsert=True,
    )
    return await _fetch_profile(user["id"])


@router.post("/me/complete")
async def complete_my_onboarding(request: Request, body: dict = Body(default={})):
    """Wizard's final step. Validates required fields + DSGVO, marks onboarded."""
    user = await get_current_user(request)
    # Merge any last-step data
    if body:
        await db.user_profiles.update_one(
            {"aria_user_id": user["id"]},
            {"$set": {**_sanitize(body), "aria_user_id": user["id"]}},
            upsert=True,
        )
    doc = await db.user_profiles.find_one({"aria_user_id": user["id"]}, {"_id": 0}) or {}
    missing = [f for f in REQUIRED_FIELDS if not doc.get(f)]
    if missing:
        raise HTTPException(400, f"Pflichtfelder fehlen: {', '.join(missing)}")
    if not doc.get("consent_share_with_services"):
        raise HTTPException(400, "DSGVO-Zustimmung fehlt.")
    now = datetime.now(timezone.utc).isoformat()
    await db.user_profiles.update_one(
        {"aria_user_id": user["id"]},
        {"$set": {"onboarded_at": now, "updated_at": now}},
    )

    # Best-effort push to CaseDesk (if configured)
    try:
        await _push_to_casedesk(user["id"])
    except Exception as e:
        logger.warning(f"CaseDesk profile push skipped: {e}")

    return {"success": True, "onboarded_at": now}


@router.post("/me/skip")
async def skip_onboarding(request: Request):
    """User chose 'später nachholen' — keep onboarded_at null but remember
    the skip so we don't nag on every single login."""
    user = await get_current_user(request)
    await db.user_profiles.update_one(
        {"aria_user_id": user["id"]},
        {"$set": {"aria_user_id": user["id"], "skipped_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"success": True}


# ==================== SERVICE-TO-SERVICE ENDPOINTS ====================

@router.get("/aria-user/{aria_user_id}")
async def get_profile_for_service(aria_user_id: str, x_aria_secret: str = Header(default="")):
    """CaseDesk / CookPilot / etc. can fetch a user's profile by aria_user_id,
    authorised via a shared service secret. Returns empty dict if not found."""
    expected = os.environ.get("ARIA_SERVICE_SECRET", "")
    if not expected or x_aria_secret != expected:
        raise HTTPException(401, "Ungültiger Service-Secret")
    return await _fetch_profile(aria_user_id)


# ==================== CASEDESK PUSH ====================

async def _push_to_casedesk(aria_user_id: str) -> bool:
    """Best-effort push. If CaseDesk URL is configured, POST the profile to
    /api/aria/profile (CaseDesk must accept it; if endpoint doesn't exist yet
    we just log). Returns True on 2xx."""
    import httpx
    cd = await db.settings.find_one({"key": "casedesk_url"})
    url = ((cd or {}).get("value") or "").rstrip("/")
    if not url:
        return False
    if not url.startswith("http"):
        url = f"http://{url}"
    profile = await _fetch_profile(aria_user_id)
    shared = os.environ.get("ARIA_SERVICE_SECRET", "")
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            r = await client.post(
                f"{url}/api/aria/profile",
                json=profile,
                headers={"X-Aria-Secret": shared} if shared else {},
            )
            if r.status_code < 400:
                logger.info(f"CaseDesk profile push OK for {aria_user_id}")
                return True
            logger.info(f"CaseDesk profile push {r.status_code}: {r.text[:160]}")
    except Exception as e:
        logger.info(f"CaseDesk push failed: {e}")
    return False
