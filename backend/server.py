from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Body
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os
import logging
import re
import bcrypt
import jwt
import httpx
import psutil
import shutil
import uuid
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
from contextlib import asynccontextmanager
from contextvars import ContextVar
from enum import Enum

# Per-request user context — used by gather_context_for_services to pass current
# user down to per-service context builders (e.g. CookPilot needs the user for SSO).
_current_user_ctx: ContextVar[dict | None] = ContextVar("_current_user_ctx", default=None)

try:
    from openai import AsyncOpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False

try:
    import docker as docker_sdk
    docker_client = docker_sdk.from_env()
    DOCKER_AVAILABLE = True
except Exception:
    docker_client = None
    DOCKER_AVAILABLE = False

import smarthome
import automations
import casedesk
import telegram_bot
import plex
import service_router
import forgepilot
from version import ARIA_VERSION, ARIA_SERVICES, version_display

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'aria_dashboard')]

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24
REFRESH_TOKEN_EXPIRE_DAYS = 30

def get_jwt_secret() -> str:
    return os.environ.get("JWT_SECRET", "aria_default_secret_change_me")

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))

def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {"sub": user_id, "email": email, "role": role, "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES), "type": "access"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)

def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS), "type": "refresh"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)

async def get_current_user(request: Request) -> dict:
    token = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    if not token:
        token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        if not user.get("is_active", True):
            raise HTTPException(status_code=401, detail="User is deactivated")
        return {"id": str(user["_id"]), "email": user["email"], "name": user.get("name", ""), "role": user.get("role", "user"), "theme": user.get("theme", "startrek"), "sound_effects_enabled": user.get("sound_effects_enabled", True), "allowed_services": user.get("allowed_services", []), "service_accounts": user.get("service_accounts", {}), "permissions": user.get("permissions", {}), "assigned_rooms": user.get("assigned_rooms", []), "visible_tabs": user.get("visible_tabs", DEFAULT_TABS), "voice": user.get("voice", ""), "voice_pin": user.get("voice_pin", ""), "sh_page_id": user.get("sh_page_id")}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def require_admin(request: Request) -> dict:
    user = await get_current_user(request)
    if user["role"] not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

class UserRole(str, Enum):
    SUPERADMIN = "superadmin"
    ADMIN = "admin"
    ERWACHSENER = "erwachsener"
    USER = "user"
    KIND = "kind"
    GAST = "gast"
    WANDTABLET = "wandtablet"
    READONLY = "readonly"

class ThemeType(str, Enum):
    STARTREK = "startrek"
    DISNEY = "disney"

class SetupRequest(BaseModel):
    email: str
    password: str
    name: str

class LoginRequest(BaseModel):
    email: str
    password: str

ALL_TABS = ["dash", "home", "health", "chat", "weather", "media", "account", "logs", "kiosk"]
DEFAULT_TABS = ["dash", "home", "chat", "weather", "account"]

class UserCreate(BaseModel):
    email: str
    password: str
    name: str
    role: UserRole = UserRole.USER
    theme: ThemeType = ThemeType.STARTREK
    assigned_rooms: List[str] = []
    visible_tabs: List[str] = []

class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    theme: Optional[str] = None
    is_active: Optional[bool] = None
    permissions: Optional[Dict[str, bool]] = None
    allowed_services: Optional[List[str]] = None
    assigned_rooms: Optional[List[str]] = None
    visible_tabs: Optional[List[str]] = None

class ServiceLinkRequest(BaseModel):
    service_id: str
    username: str
    password: str

class ChatMessage(BaseModel):
    message: str
    target_service: Optional[str] = None
    session_id: Optional[str] = None

import asyncio

async def wait_for_mongo(max_retries=30, delay=2):
    """Wait for MongoDB to be ready before proceeding."""
    for attempt in range(max_retries):
        try:
            await client.admin.command('ping')
            logger.info(f"MongoDB connected (attempt {attempt + 1})")
            return True
        except Exception as e:
            logger.warning(f"MongoDB not ready (attempt {attempt + 1}/{max_retries}): {e}")
            if attempt < max_retries - 1:
                await asyncio.sleep(delay)
    logger.error("MongoDB connection failed after all retries")
    return False

@asynccontextmanager
async def lifespan(app: FastAPI):
    mongo_ready = await wait_for_mongo()
    if not mongo_ready:
        logger.error("Starting without MongoDB - some features will be unavailable")
        yield
        return

    try:
        await db.users.create_index("email", unique=True)
        await db.services.create_index("id", unique=True)
        await db.logs.create_index("timestamp")
        await db.chat_messages.create_index("session_id")
        await db.chat_messages.create_index("user_id")
        await smarthome.create_indexes()
        await automations.create_indexes()
    except Exception as e:
        logger.warning(f"Index creation failed: {e}")
    
    default_services = [
        {"id": "casedesk", "name": "CaseDesk AI", "url": "http://192.168.1.140:9090", "icon": "files", "category": "Dokumente", "description": "Dokumenten- und Fallverwaltung mit KI", "health_endpoint": "/api/health", "api_base": "/api", "enabled": True},
        {"id": "forgepilot", "name": "ForgePilot", "url": "http://192.168.1.140:3000", "icon": "code", "category": "Entwicklung", "description": "Projekt- und Code-Verwaltung mit Agenten", "health_endpoint": "/api/health", "api_base": "/api", "enabled": True},
        {"id": "nextcloud", "name": "Nextcloud", "url": "http://192.168.1.140:8666", "icon": "cloud", "category": "Cloud", "description": "Dateien, Kalender und Kontakte", "health_endpoint": "/status.php", "api_base": "", "enabled": True},
        {"id": "homeassistant", "name": "Home Assistant", "url": "http://192.168.1.151:8123", "icon": "house", "category": "Smart Home", "description": "Smart Home Steuerung und Automationen", "health_endpoint": "/api/", "api_base": "/api", "enabled": True},
        {"id": "plex", "name": "Plex Media Server", "url": "http://192.168.1.140:32400", "icon": "film-strip", "category": "Medien", "description": "Filme, Serien und Musik streamen", "health_endpoint": "/identity", "api_base": "", "enabled": True},
        {"id": "unraid", "name": "Unraid", "url": "http://192.168.1.140", "icon": "hard-drives", "category": "Server", "description": "Unraid Server Dashboard", "health_endpoint": "/", "enabled": True},
    ]
    
    try:
        for service in default_services:
            await db.services.update_one({"id": service["id"]}, {"$setOnInsert": service}, upsert=True)
    except Exception as e:
        logger.warning(f"Service seeding failed: {e}")

    # Initialize ARIA-Memory module + indexes (CaseDesk-aware personal facts)
    try:
        import aria_memory as _aria_memory
        _aria_memory.init(db, get_llm_api_key, casedesk_mod=casedesk)
        await _aria_memory.ensure_indexes()
    except Exception as e:
        logger.warning(f"aria_memory init failed: {e}")

    # Initialize Tavily web research module + indexes
    try:
        import tavily as _tavily
        _tavily.init(db)
        await _tavily.ensure_indexes()
    except Exception as e:
        logger.warning(f"tavily init failed: {e}")

    # Initialize Telegram bot module + start polling and watchdog
    try:
        telegram_bot.init(db, get_ha_settings, get_llm_api_key)
        telegram_bot.chat_handler = process_chat_message
        token = await telegram_bot.get_bot_token()
        if token:
            telegram_bot.start_bot()
            logger.info("Telegram bot polling started")
        else:
            logger.info("Telegram bot token not configured - polling deferred until token is set")
        # Watchdog runs unconditionally; it no-ops without a token and
        # auto-recovers the bot whenever it stops responding.
        telegram_bot.start_watchdog(interval_s=60)
        logger.info("Telegram watchdog started (60s interval)")
    except Exception as e:
        logger.error(f"Telegram bot startup failed: {e}")
    
    logger.info("Aria Dashboard v2.0 started")
    yield
    client.close()

app = FastAPI(title="Aria Dashboard v2.0", lifespan=lifespan)
api_router = APIRouter(prefix="/api")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

def set_auth_cookies(response: Response, access_token: str, refresh_token: str):
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=False, samesite="lax", max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400, path="/")

# ==================== SETUP ====================

@api_router.get("/setup/status")
async def get_setup_status():
    user_count = await db.users.count_documents({})
    settings = await db.settings.find_one({"key": "setup_completed"})
    return {"setup_completed": user_count > 0 and settings is not None, "has_admin": user_count > 0}

@api_router.post("/setup/complete")
async def complete_setup(request: SetupRequest, response: Response):
    user_count = await db.users.count_documents({})
    if user_count > 0:
        raise HTTPException(status_code=400, detail="Setup already completed")
    
    user_doc = {"email": request.email.lower(), "password_hash": hash_password(request.password), "name": request.name, "role": "superadmin", "theme": "startrek", "is_active": True, "allowed_services": ["casedesk", "forgepilot", "unraid"], "service_accounts": {}, "permissions": {"chat": True, "logs": True, "health": True, "admin": True}, "created_at": datetime.now(timezone.utc).isoformat()}
    result = await db.users.insert_one(user_doc)
    user_id = str(result.inserted_id)
    
    await db.settings.update_one({"key": "setup_completed"}, {"$set": {"value": True}}, upsert=True)
    
    access_token = create_access_token(user_id, request.email.lower(), "superadmin")
    refresh_token = create_refresh_token(user_id)
    set_auth_cookies(response, access_token, refresh_token)
    
    return {"id": user_id, "email": request.email.lower(), "name": request.name, "role": "superadmin", "theme": "startrek"}

# ==================== AUTH ====================

@api_router.post("/auth/login")
async def login(request: LoginRequest, response: Response):
    user = await db.users.find_one({"email": request.email.lower()})
    if not user or not verify_password(request.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="Account is deactivated")
    
    user_id = str(user["_id"])
    access_token = create_access_token(user_id, user["email"], user.get("role", "user"))
    refresh_token = create_refresh_token(user_id)
    set_auth_cookies(response, access_token, refresh_token)
    
    # Track login timestamps for personalized greeting
    # previous_login_at = last seen login (used to detect "new" docs since then)
    # last_login_at = this login
    now_iso = datetime.now(timezone.utc).isoformat()
    previous_login_at = user.get("last_login_at")
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"previous_login_at": previous_login_at, "last_login_at": now_iso}}
    )
    
    await db.logs.insert_one({"type": "user_login", "user_id": user_id, "email": user["email"], "timestamp": now_iso})
    
    return {"id": user_id, "email": user["email"], "name": user.get("name", ""), "role": user.get("role", "user"), "theme": user.get("theme", "startrek"), "sound_effects_enabled": user.get("sound_effects_enabled", True), "allowed_services": user.get("allowed_services", []), "permissions": user.get("permissions", {}), "assigned_rooms": user.get("assigned_rooms", []), "visible_tabs": user.get("visible_tabs", DEFAULT_TABS), "access_token": access_token}

@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out"}

@api_router.get("/auth/me")
async def get_me(request: Request):
    return await get_current_user(request)

VALID_THEMES = {"startrek", "starwars", "disney", "fortnite", "minesweeper"}
DEFAULT_GLOBAL_THEME = "startrek"


@api_router.put("/auth/theme")
async def update_theme(request: Request, theme: str = Body(..., embed=True)):
    user = await get_current_user(request)
    if theme not in VALID_THEMES:
        raise HTTPException(400, f"Unbekanntes Theme. Erlaubt: {sorted(VALID_THEMES)}")
    await db.users.update_one({"_id": ObjectId(user["id"])}, {"$set": {"theme": theme}})
    return {"theme": theme}


@api_router.put("/auth/sound")
async def update_sound_preference(request: Request, body: dict = Body(...)):
    """Toggle per-user sound-effect preference (clicks, theme-switch)."""
    user = await get_current_user(request)
    enabled = bool(body.get("enabled"))
    await db.users.update_one(
        {"_id": ObjectId(user["id"])},
        {"$set": {"sound_effects_enabled": enabled}},
    )
    return {"sound_effects_enabled": enabled}


@api_router.get("/settings/default-theme")
async def get_default_theme():
    """Public endpoint: returns the admin-configured global default theme.
    Used by the frontend to fall back when a user has no personal theme set,
    and by the Login/Setup screens before a user is authenticated."""
    doc = await db.settings.find_one({"key": "default_theme"})
    theme = doc.get("value") if doc else None
    if theme not in VALID_THEMES:
        theme = DEFAULT_GLOBAL_THEME
    return {"theme": theme, "available": sorted(VALID_THEMES)}


@api_router.put("/admin/default-theme")
async def admin_set_default_theme(request: Request, body: dict = Body(...)):
    """Admin-only: set the global default theme (applied to users without personal pref)."""
    await require_admin(request)
    theme = (body.get("theme") or "").strip()
    if theme not in VALID_THEMES:
        raise HTTPException(400, f"Unbekanntes Theme. Erlaubt: {sorted(VALID_THEMES)}")
    await db.settings.update_one(
        {"key": "default_theme"},
        {"$set": {"key": "default_theme", "value": theme, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"success": True, "theme": theme}


@api_router.put("/auth/pin")
async def set_pin(request: Request, body: dict = Body(...)):
    """Set or update user PIN for critical device access."""
    user = await get_current_user(request)
    pin = body.get("pin", "")
    if not pin or len(pin) < 4 or len(pin) > 8 or not pin.isdigit():
        raise HTTPException(400, "PIN muss 4-8 Ziffern haben")
    await db.users.update_one({"_id": ObjectId(user["id"])}, {"$set": {"pin": pin}})
    return {"success": True, "message": "PIN gesetzt"}

@api_router.post("/auth/verify-pin")
async def verify_pin(request: Request, body: dict = Body(...)):
    """Verify user PIN."""
    user = await get_current_user(request)
    pin = body.get("pin", "")
    user_doc = await db.users.find_one({"_id": ObjectId(user["id"])})
    if not user_doc or not user_doc.get("pin"):
        return {"valid": False, "message": "Kein PIN gesetzt"}
    return {"valid": pin == user_doc["pin"]}

# ==================== AUDIT LOG ====================

@api_router.get("/audit-log")
async def get_audit_log(request: Request, limit: int = 100, log_type: str = None):
    """Get Smart Home audit log."""
    await require_admin(request)
    query = {}
    if log_type:
        query["type"] = log_type
    else:
        query["type"] = {"$in": ["ha_command", "ha_denied", "device_control", "permission_changed", "room_created", "ha_sync"]}
    logs = await db.logs.find(query, {"_id": 0}).sort("timestamp", -1).limit(limit).to_list(limit)
    return logs

# ==================== ADMIN - USERS ====================

@api_router.get("/admin/users")
async def get_all_users(request: Request):
    await require_admin(request)
    users = await db.users.find({}, {"password_hash": 0}).to_list(1000)
    for user in users:
        user["id"] = str(user.pop("_id"))
    return users

@api_router.post("/admin/users")
async def create_user(user_data: UserCreate, request: Request):
    await require_admin(request)
    existing = await db.users.find_one({"email": user_data.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already exists")
    
    user_doc = {"email": user_data.email.lower(), "password_hash": hash_password(user_data.password), "name": user_data.name, "role": user_data.role.value, "theme": user_data.theme.value, "is_active": True, "allowed_services": [], "service_accounts": {}, "permissions": {"chat": True, "logs": False, "health": False, "admin": False}, "assigned_rooms": user_data.assigned_rooms, "visible_tabs": user_data.visible_tabs or DEFAULT_TABS, "created_at": datetime.now(timezone.utc).isoformat()}
    result = await db.users.insert_one(user_doc)
    return {"id": str(result.inserted_id), "email": user_data.email.lower(), "name": user_data.name, "role": user_data.role.value}

@api_router.put("/admin/users/{user_id}")
async def update_user(user_id: str, request: Request, body: dict = Body(...)):
    await require_admin(request)
    allowed_fields = {"name", "role", "theme", "is_active", "permissions", "allowed_services", "assigned_rooms", "visible_tabs"}
    update_fields = {k: v for k, v in body.items() if k in allowed_fields and v is not None}
    if not update_fields:
        raise HTTPException(status_code=400, detail="No update data")
    result = await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": update_fields})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User updated"}

@api_router.delete("/admin/users/{user_id}")
async def delete_user(user_id: str, request: Request):
    admin = await require_admin(request)
    if admin["id"] == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    result = await db.users.delete_one({"_id": ObjectId(user_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User deleted"}

@api_router.post("/admin/users/{user_id}/reset-password")
async def reset_password(user_id: str, request: Request, new_password: str = Body(..., embed=True)):
    await require_admin(request)
    result = await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": {"password_hash": hash_password(new_password)}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "Password reset"}

@api_router.put("/admin/users/{user_id}/services")
async def update_user_services(user_id: str, request: Request, services: List[str] = Body(..., embed=True)):
    await require_admin(request)
    result = await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": {"allowed_services": services}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "Services updated", "allowed_services": services}

# ==================== SERVICES ====================

@api_router.get("/services")
async def get_services(request: Request):
    user = await get_current_user(request)
    all_services = await db.services.find({}, {"_id": 0}).to_list(100)
    if user["role"] not in ["admin", "superadmin"]:
        allowed = user.get("allowed_services", [])
        all_services = [s for s in all_services if s["id"] in allowed]
    service_accounts = user.get("service_accounts", {})
    for service in all_services:
        service["linked"] = service["id"] in service_accounts
        service["linked_username"] = service_accounts.get(service["id"], {}).get("username")
        # Add proxy URL for external access
        service["proxy_url"] = f"/api/proxy/{service['id']}/"
    return all_services

@api_router.post("/services/{service_id}/link")
async def link_service_account(service_id: str, link_data: ServiceLinkRequest, request: Request):
    user = await get_current_user(request)
    service = await db.services.find_one({"id": service_id})
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    await db.users.update_one({"_id": ObjectId(user["id"])}, {"$set": {f"service_accounts.{service_id}": {"username": link_data.username, "linked_at": datetime.now(timezone.utc).isoformat()}}})
    return {"message": "Service linked", "service_id": service_id}

@api_router.delete("/services/{service_id}/link")
async def unlink_service_account(service_id: str, request: Request):
    user = await get_current_user(request)
    await db.users.update_one({"_id": ObjectId(user["id"])}, {"$unset": {f"service_accounts.{service_id}": ""}})
    return {"message": "Service unlinked"}

@api_router.post("/admin/services")
async def create_service(request: Request, service: dict = Body(...)):
    await require_admin(request)
    await db.services.update_one({"id": service["id"]}, {"$set": service}, upsert=True)
    return {"message": "Service created", "id": service["id"]}

@api_router.put("/admin/services/{service_id}")
async def update_service(service_id: str, request: Request, service: dict = Body(...)):
    await require_admin(request)
    await db.services.update_one({"id": service_id}, {"$set": service})
    return {"message": "Service updated"}

@api_router.delete("/admin/services/{service_id}")
async def delete_service(service_id: str, request: Request):
    await require_admin(request)
    await db.services.delete_one({"id": service_id})
    return {"message": "Service deleted"}

# ==================== REVERSE PROXY ====================

@api_router.api_route("/proxy/{service_id}/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])
async def reverse_proxy(service_id: str, path: str, request: Request):
    """Reverse proxy to internal services - enables external access via Aria."""
    # Auth via query param token (for new-tab access) or header
    token = request.query_params.get("token")
    if token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            user_doc = await db.users.find_one({"_id": ObjectId(payload["user_id"])})
            if not user_doc:
                raise HTTPException(401, "Nicht autorisiert")
        except Exception:
            raise HTTPException(401, "Ungültiger Token")
    else:
        await get_current_user(request)
    
    service = await db.services.find_one({"id": service_id}, {"_id": 0})
    if not service:
        raise HTTPException(status_code=404, detail="Dienst nicht gefunden")
    
    target_url = service.get("url", "").rstrip("/")
    if not target_url:
        raise HTTPException(status_code=400, detail="Dienst-URL nicht konfiguriert")
    
    # Build target URL
    full_url = f"{target_url}/{path}"
    
    # Forward query params
    if request.url.query:
        full_url += f"?{request.url.query}"
    
    # Forward headers (except host)
    forward_headers = {}
    for key, value in request.headers.items():
        if key.lower() not in ("host", "connection", "transfer-encoding", "content-length"):
            forward_headers[key] = value
    
    # Read body
    body = await request.body()
    
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            resp = await client.request(
                method=request.method,
                url=full_url,
                headers=forward_headers,
                content=body if body else None,
            )
            
            # Forward response headers (except some)
            resp_headers = {}
            for key, value in resp.headers.items():
                if key.lower() not in ("transfer-encoding", "content-encoding", "content-length"):
                    resp_headers[key] = value
            
            # Allow iframe embedding
            resp_headers.pop("x-frame-options", None)
            resp_headers.pop("X-Frame-Options", None)
            resp_headers["Access-Control-Allow-Origin"] = "*"
            
            # Rewrite URLs in HTML responses to go through proxy
            content_type = resp.headers.get("content-type", "")
            if "text/html" in content_type:
                text = resp.text
                # Rewrite absolute paths to go through proxy
                text = text.replace(f'href="/', f'href="/api/proxy/{service_id}/')
                text = text.replace(f"href='/", f"href='/api/proxy/{service_id}/")
                text = text.replace(f'src="/', f'src="/api/proxy/{service_id}/')
                text = text.replace(f"src='/", f"src='/api/proxy/{service_id}/")
                text = text.replace(f'action="/', f'action="/api/proxy/{service_id}/')
                # Fix absolute URLs to the service itself
                text = text.replace(target_url, f"/api/proxy/{service_id}")
                return Response(content=text, status_code=resp.status_code, headers=resp_headers, media_type="text/html")
            
            return Response(content=resp.content, status_code=resp.status_code, headers=resp_headers, media_type=content_type)
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail=f"Dienst '{service.get('name')}' nicht erreichbar")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail=f"Zeitüberschreitung bei '{service.get('name')}'")
    except Exception as e:
        logger.error(f"Proxy error for {service_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))

# ==================== VOICE / TTS ====================

VOICE_OPTIONS = [
    # Premium (gpt-4o-mini-tts only) — clearest, most natural German pronunciation
    {"id": "marin", "name": "Marin", "desc": "Premium · Sehr natürlich, weiblich", "premium": True, "is_new": True},
    {"id": "cedar", "name": "Cedar", "desc": "Premium · Sehr natürlich, männlich", "premium": True, "is_new": True},
    # Standard voices (work with all models)
    {"id": "nova", "name": "Nova", "desc": "Klar, weiblich"},
    {"id": "shimmer", "name": "Shimmer", "desc": "Sanft, beruhigend"},
    {"id": "coral", "name": "Coral", "desc": "Warm, freundlich", "is_new": True},
    {"id": "sage", "name": "Sage", "desc": "Ruhig, sachlich", "is_new": True},
    {"id": "alloy", "name": "Alloy", "desc": "Neutral"},
    {"id": "ash", "name": "Ash", "desc": "Klar, artikuliert", "is_new": True},
    {"id": "echo", "name": "Echo", "desc": "Warm, männlich"},
    {"id": "fable", "name": "Fable", "desc": "Erzählerisch, märchenhaft"},
    {"id": "onyx", "name": "Onyx", "desc": "Tief, autoritär"},
]

# OpenAI gpt-4o-mini-tts: newer model, more natural voices, supports `instructions` param.
# Falls back to tts-1 if a 4xx error occurs (e.g. model not yet on the account's plan).
TTS_MODEL = "gpt-4o-mini-tts"
TTS_FALLBACK_MODEL = "tts-1"

# Voices that ONLY exist on gpt-4o-mini-tts (so the fallback must rewrite them)
PREMIUM_ONLY_VOICES = {"marin", "cedar"}

# Default instructions to make voice sound natural, German, conversational
TTS_DEFAULT_INSTRUCTIONS = (
    "Speak in clear, natural German with a warm, friendly tone. "
    "Pace yourself naturally — not too fast. Pronounce numbers and abbreviations clearly. "
    "Sound like a helpful personal assistant, not a robot."
)


def strip_markdown_for_tts(text: str) -> str:
    """Remove Markdown so TTS doesn't read 'asterisk', 'underscore' etc. literally."""
    if not text:
        return ""
    s = text
    # Code blocks ```...```
    s = re.sub(r"```[\s\S]*?```", " ", s)
    # Inline code `...`
    s = re.sub(r"`([^`]+)`", r"\1", s)
    # Images ![alt](url) -> alt
    s = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", s)
    # Links [text](url) -> text
    s = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", s)
    # Bold **text** / __text__
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
    s = re.sub(r"__([^_]+)__", r"\1", s)
    # Italic *text* / _text_  (be careful not to eat lone asterisks attached to words)
    s = re.sub(r"(?<![*\w])\*([^*\n]+)\*(?!\w)", r"\1", s)
    s = re.sub(r"(?<![_\w])_([^_\n]+)_(?!\w)", r"\1", s)
    # Strikethrough ~~text~~
    s = re.sub(r"~~([^~]+)~~", r"\1", s)
    # Headings  #, ##, ### at line start
    s = re.sub(r"(?m)^\s{0,3}#{1,6}\s*", "", s)
    # Blockquotes
    s = re.sub(r"(?m)^\s*>\s?", "", s)
    # List bullets / dashes / numbered lists at line start
    s = re.sub(r"(?m)^\s*[-*+]\s+", "", s)
    s = re.sub(r"(?m)^\s*\d+\.\s+", "", s)
    # Horizontal rules
    s = re.sub(r"(?m)^\s*[-*_]{3,}\s*$", "", s)
    # Tables: keep cell content, drop pipes & separator rows
    s = re.sub(r"(?m)^\s*\|?[\s:|-]+\|\s*$", "", s)  # separator row "|---|---|"
    s = s.replace("|", " ")
    # Stray markdown punctuation that survived
    s = re.sub(r"\*+", "", s)
    s = re.sub(r"_+(?=\s|$)", "", s)
    # HTML tags
    s = re.sub(r"<[^>]+>", "", s)
    # Collapse whitespace
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()

@api_router.get("/voice/options")
async def get_voice_options(request: Request):
    await get_current_user(request)
    # Get global default
    default_doc = await db.settings.find_one({"key": "default_voice"})
    default_voice = default_doc["value"] if default_doc and default_doc.get("value") else "nova"
    return {"voices": VOICE_OPTIONS, "default_voice": default_voice}

@api_router.put("/voice/user-settings")
async def update_user_voice(request: Request, body: dict = Body(...)):
    user = await get_current_user(request)
    update = {}
    if "voice" in body:
        update["voice"] = body["voice"]
    if "voice_pin" in body:
        update["voice_pin"] = body["voice_pin"]
    if update:
        await db.users.update_one({"_id": ObjectId(user["id"])}, {"$set": update})
    return {"message": "Spracheinstellungen gespeichert"}

@api_router.post("/voice/verify-pin")
async def verify_voice_pin(request: Request, body: dict = Body(...)):
    """Verify a voice PIN and return the user's identity."""
    pin = body.get("pin", "")
    if not pin:
        raise HTTPException(400, "PIN erforderlich")
    # Search all users for this PIN
    user_doc = await db.users.find_one({"voice_pin": pin})
    if not user_doc:
        return {"verified": False, "message": "PIN nicht erkannt"}
    return {
        "verified": True,
        "user_id": str(user_doc["_id"]),
        "user_name": user_doc.get("name", user_doc.get("email", "")),
        "user_role": user_doc.get("role", "user"),
        "voice": user_doc.get("voice", ""),
    }

@api_router.post("/voice/tts")
async def text_to_speech(request: Request, body: dict = Body(...)):
    """Generate speech from text using OpenAI gpt-4o-mini-tts (with tts-1 fallback).

    Streams the MP3 chunks back so playback can begin earlier.
    Strips Markdown so symbols like '**' aren't read aloud.
    Optional body params:
      - text (required)
      - voice (optional)
      - instructions (optional, for gpt-4o-mini-tts tone steering)
      - raw (optional bool) — if true, skip Markdown strip
    """
    from fastapi.responses import StreamingResponse

    user = await get_current_user(request)
    text = body.get("text", "")
    voice = body.get("voice", "")
    instructions = body.get("instructions") or TTS_DEFAULT_INSTRUCTIONS
    raw = bool(body.get("raw", False))

    if not text:
        raise HTTPException(400, "Kein Text angegeben")

    # Sanitize Markdown so '**' / '*' / '#' etc. are not read aloud
    if not raw:
        text = strip_markdown_for_tts(text)
        if not text:
            raise HTTPException(400, "Text leer nach Bereinigung")

    # Determine voice: request param > user setting > global default
    if not voice:
        user_doc = await db.users.find_one({"_id": ObjectId(user["id"])})
        voice = user_doc.get("voice", "") if user_doc else ""
    if not voice:
        default_doc = await db.settings.find_one({"key": "default_voice"})
        voice = default_doc["value"] if default_doc and default_doc.get("value") else "nova"

    api_key = await get_llm_api_key()
    if not api_key:
        raise HTTPException(400, "OpenAI API Key nicht konfiguriert")

    # gpt-4o-mini-tts limit is ~2000 tokens; stay safe under it
    if len(text) > 3500:
        text = text[:3500] + "..."

    primary_payload = {
        "model": TTS_MODEL,
        "input": text,
        "voice": voice,
        "response_format": "mp3",
        "instructions": instructions,
    }
    fallback_voice = voice if voice not in PREMIUM_ONLY_VOICES else "nova"
    fallback_payload = {
        "model": TTS_FALLBACK_MODEL,
        "input": text,
        "voice": fallback_voice,
        "response_format": "mp3",
    }

    async def _open_upstream():
        """Open a streaming connection to OpenAI; try primary then fallback."""
        client = httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0))
        # Attempt primary (gpt-4o-mini-tts)
        try:
            req = client.build_request(
                "POST",
                "https://api.openai.com/v1/audio/speech",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=primary_payload,
            )
            resp = await client.send(req, stream=True)
            if resp.status_code == 200:
                return client, resp, TTS_MODEL
            err_body = (await resp.aread()).decode(errors="ignore")[:300]
            logger.warning(f"TTS primary ({TTS_MODEL}) {resp.status_code}: {err_body} — falling back to {TTS_FALLBACK_MODEL}")
            await resp.aclose()
        except Exception as e:
            logger.warning(f"TTS primary call failed: {e} — falling back to {TTS_FALLBACK_MODEL}")

        # Fallback (tts-1)
        req = client.build_request(
            "POST",
            "https://api.openai.com/v1/audio/speech",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=fallback_payload,
        )
        resp = await client.send(req, stream=True)
        if resp.status_code == 200:
            return client, resp, TTS_FALLBACK_MODEL
        err_body = (await resp.aread()).decode(errors="ignore")[:300]
        await resp.aclose()
        await client.aclose()
        logger.error(f"TTS fallback failed: {resp.status_code} {err_body}")
        raise HTTPException(resp.status_code if resp.status_code >= 400 else 502,
                            f"TTS Fehler: {err_body}")

    try:
        client, upstream, used_model = await _open_upstream()
    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(504, "TTS Zeitüberschreitung")
    except Exception as e:
        logger.error(f"TTS open failed: {e}")
        raise HTTPException(500, f"TTS Fehler: {str(e)}")

    async def stream_audio():
        try:
            async for chunk in upstream.aiter_bytes():
                if chunk:
                    yield chunk
        finally:
            try:
                await upstream.aclose()
            except Exception:
                pass
            try:
                await client.aclose()
            except Exception:
                pass

    return StreamingResponse(
        stream_audio(),
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "no-cache",
            "X-TTS-Model": used_model,
            "X-Accel-Buffering": "no",  # disable nginx buffering for true streaming
        },
    )


# -------- Greeting helpers --------

async def _fetch_weather_summary():
    """Fetch a short weather summary string (e.g. 'bedeckt bei 15 Grad') or None."""
    try:
        city, api_key = await get_weather_settings()
        if not city or not api_key:
            return None
        parsed = parse_city_query(city)
        async with httpx.AsyncClient(timeout=8.0) as http_client:
            base_params = {"appid": api_key, "units": "metric", "lang": "de"}
            if parsed["type"] == "zip":
                base_params["zip"] = f"{parsed['zip']},{parsed['country']}"
            else:
                base_params["q"] = parsed["q"]
            resp = await http_client.get("https://api.openweathermap.org/data/2.5/weather", params=base_params)
            if resp.status_code != 200:
                return None
            data = resp.json()
            desc = (data.get("weather") or [{}])[0].get("description", "")
            temp = data.get("main", {}).get("temp")
            if temp is None:
                return None
            return {"description": desc, "temp": round(float(temp))}
    except Exception as e:
        logger.warning(f"Greeting weather fetch failed: {e}")
        return None


def _parse_iso(ts):
    if not ts:
        return None
    try:
        s = ts.replace("Z", "+00:00") if isinstance(ts, str) else ts
        return datetime.fromisoformat(s) if isinstance(s, str) else None
    except Exception:
        return None


def _is_today_utc_for_user(ts):
    """Check if ISO timestamp falls on today's date (UTC). Good enough for greeting de-dup."""
    dt = _parse_iso(ts)
    if not dt:
        return False
    now = datetime.now(timezone.utc)
    return dt.date() == now.date()


async def _count_new_documents_since(since_iso):
    """Count CaseDesk documents created since the given ISO timestamp."""
    if not since_iso:
        return 0
    try:
        from casedesk import casedesk_request as _cd_request
    except Exception:
        return 0
    try:
        data, err = await _cd_request("GET", "/documents")
        if err or not data:
            return 0
        docs = data if isinstance(data, list) else data.get("results", data.get("documents", []))
        if not isinstance(docs, list):
            return 0
        since_dt = _parse_iso(since_iso)
        if not since_dt:
            return 0
        cnt = 0
        for d in docs:
            created = d.get("created_at") or d.get("createdAt") or d.get("uploaded_at") or d.get("date") or d.get("timestamp")
            cdt = _parse_iso(created)
            if cdt and cdt > since_dt:
                cnt += 1
        return cnt
    except Exception as e:
        logger.warning(f"Greeting docs count failed: {e}")
        return 0


async def _count_today_events_and_tasks():
    """Return (events_today, open_tasks_today) from CaseDesk."""
    events_today = 0
    tasks_today = 0
    try:
        from casedesk import casedesk_request as _cd_request
    except Exception:
        return 0, 0
    today = datetime.now(timezone.utc).date()
    # Events
    try:
        data, err = await _cd_request("GET", "/events")
        if not err and data:
            events = data if isinstance(data, list) else []
            for ev in events:
                start = ev.get("start") or ev.get("start_time") or ev.get("date") or ev.get("starts_at")
                sdt = _parse_iso(start)
                if sdt and sdt.date() == today:
                    events_today += 1
    except Exception as e:
        logger.warning(f"Greeting events fetch failed: {e}")
    # Tasks
    try:
        data, err = await _cd_request("GET", "/tasks")
        if not err and data:
            tasks = data if isinstance(data, list) else []
            for t in tasks:
                if t.get("status") in ("done", "completed", "closed"):
                    continue
                due = t.get("due_date") or t.get("due") or t.get("deadline")
                ddt = _parse_iso(due)
                if ddt and ddt.date() <= today:
                    tasks_today += 1
                elif not due:
                    # Tasks ohne Due-Date: nicht mitzählen
                    continue
    except Exception as e:
        logger.warning(f"Greeting tasks fetch failed: {e}")
    return events_today, tasks_today


def _format_count(n, singular, plural, zero_word="keine"):
    if n == 0:
        return f"{zero_word} {plural}"
    if n == 1:
        return f"ein {singular}"
    # Numbers 2-12 in German words for natural speech
    words = {2: "zwei", 3: "drei", 4: "vier", 5: "fünf", 6: "sechs",
             7: "sieben", 8: "acht", 9: "neun", 10: "zehn", 11: "elf", 12: "zwölf"}
    word = words.get(n, str(n))
    return f"{word} {plural}"


@api_router.get("/voice/greeting")
async def get_voice_greeting(request: Request, force: bool = False):
    """Build a personalized welcome message for the logged-in user.
    Returns short German text + flag whether it should be spoken (once per day per user).
    """
    user = await get_current_user(request)
    user_doc = await db.users.find_one({"_id": ObjectId(user["id"])})
    if not user_doc:
        raise HTTPException(404, "User not found")

    # Once-per-day check
    last_greeting_at = user_doc.get("last_greeting_at")
    already_greeted_today = _is_today_utc_for_user(last_greeting_at)
    should_play = force or (not already_greeted_today)

    # Determine "since" for new documents = previous login (set by /auth/login)
    previous_login = user_doc.get("previous_login_at") or user_doc.get("last_login_at")

    # Salutation: use first name if it has multiple parts
    raw_name = user_doc.get("name", "") or user_doc.get("email", "").split("@")[0]
    first_name = raw_name.strip().split()[0] if raw_name.strip() else ""

    # Hour-aware greeting
    hour = datetime.now(timezone.utc).hour  # naive UTC; close enough for tone
    if 4 <= hour < 11:
        salutation = "Guten Morgen"
    elif 11 <= hour < 17:
        salutation = "Hallo"
    elif 17 <= hour < 22:
        salutation = "Guten Abend"
    else:
        salutation = "Willkommen zurück"

    # Fetch context in parallel
    weather_task = asyncio.create_task(_fetch_weather_summary())
    docs_task = asyncio.create_task(_count_new_documents_since(previous_login))
    et_task = asyncio.create_task(_count_today_events_and_tasks())
    weather, new_docs, (events_today, tasks_today) = await asyncio.gather(weather_task, docs_task, et_task)

    # Build text — short & crisp
    parts = []
    if first_name:
        parts.append(f"{salutation}, {first_name}.")
    else:
        parts.append(f"{salutation}.")

    if weather:
        parts.append(f"Heute {weather['description']} bei {weather['temp']} Grad.")

    # Documents
    if new_docs > 0:
        if new_docs == 1:
            parts.append("Ein neues Dokument wurde verarbeitet.")
        else:
            parts.append(f"{_format_count(new_docs, 'Dokument', 'neue Dokumente').capitalize()} verarbeitet.")

    # Events + Tasks combined sentence
    if events_today > 0 and tasks_today > 0:
        ev_txt = "ein Termin" if events_today == 1 else _format_count(events_today, "Termin", "Termine")
        tk_txt = "eine offene Aufgabe" if tasks_today == 1 else _format_count(tasks_today, "Aufgabe", "offene Aufgaben")
        parts.append(f"Heute stehen {ev_txt} und {tk_txt} an.")
    elif events_today > 0:
        ev_txt = "ein Termin" if events_today == 1 else _format_count(events_today, "Termin", "Termine")
        parts.append(f"Heute steht {ev_txt} an." if events_today == 1 else f"Heute stehen {ev_txt} an.")
    elif tasks_today > 0:
        tk_txt = "eine offene Aufgabe" if tasks_today == 1 else _format_count(tasks_today, "Aufgabe", "offene Aufgaben")
        parts.append(f"{tk_txt.capitalize()} für heute." if tasks_today > 1 else "Eine offene Aufgabe für heute.")
    else:
        # Only mention "free day" if we actually have CaseDesk data context (weather is configured separately)
        if previous_login:
            parts.append("Keine Termine oder offenen Aufgaben für heute.")

    text = " ".join(parts).strip()

    # Mark as greeted (only if we actually intend to play it now)
    if should_play:
        await db.users.update_one(
            {"_id": user_doc["_id"]},
            {"$set": {"last_greeting_at": datetime.now(timezone.utc).isoformat()}}
        )

    voice = user_doc.get("voice", "")
    if not voice:
        default_doc = await db.settings.find_one({"key": "default_voice"})
        voice = default_doc["value"] if default_doc and default_doc.get("value") else "nova"

    return {
        "text": text,
        "should_play": should_play,
        "voice": voice,
        "context": {
            "weather": weather,
            "new_documents": new_docs,
            "events_today": events_today,
            "tasks_today": tasks_today,
            "previous_login_at": previous_login,
        }
    }


# ==================== HEALTH ====================

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "app": "Aria Dashboard", "version": "2.0", "aria_version": ARIA_VERSION, "aria_version_display": version_display()}


@api_router.get("/version")
async def get_version():
    """Public endpoint — returns the currently deployed Aria version.
    Used by the Login screen and Health page to confirm the build is up-to-date."""
    return {
        "version": ARIA_VERSION,
        "display": version_display(),
        "services": ARIA_SERVICES,
    }


@api_router.get("/health/services")
async def get_services_health(request: Request):
    user = await get_current_user(request)
    if not user.get("permissions", {}).get("health", False) and user["role"] not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Health access not permitted")
    
    services = await db.services.find({"enabled": True}, {"_id": 0}).to_list(100)
    health_results = []
    
    async with httpx.AsyncClient(timeout=5.0) as http_client:
        for service in services:
            health = {"id": service["id"], "name": service["name"], "status": "unknown", "response_time": None}
            try:
                url = f"{service['url']}{service.get('health_endpoint', '/health')}"
                start = datetime.now()
                response = await http_client.get(url)
                elapsed = (datetime.now() - start).total_seconds() * 1000
                health["status"] = "healthy" if response.status_code < 400 else "unhealthy"
                health["response_time"] = round(elapsed, 2)
            except Exception:
                health["status"] = "offline"
            health_results.append(health)
    
    return health_results


@api_router.get("/health/integrations")
async def get_integrations_health(request: Request):
    """Quick-Check aller Aria-Fach-Dienste (Weather, HA, CaseDesk, Plex, ForgePilot, System).
    Liefert pro Service: configured (Settings gesetzt) + reachable (Ping erfolgreich)."""
    await get_current_user(request)
    result = []
    from service_router import DEFAULT_REGISTRY, check_service_available
    for svc in DEFAULT_REGISTRY:
        sid = svc["service_id"]
        try:
            available = await check_service_available(sid)
        except Exception as e:
            available = False
            logger.warning(f"integrations-health {sid} failed: {e}")
        result.append({
            "service_id": sid,
            "name": svc["name"],
            "type": svc["type"],
            "available": bool(available),
        })
    return result

@api_router.get("/health/system")
async def get_system_health(request: Request):
    user = await get_current_user(request)
    if not user.get("permissions", {}).get("health", False) and user["role"] not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Health access not permitted")
    
    # CPU Info
    cpu_count_physical = psutil.cpu_count(logical=False) or 0
    cpu_count_logical = psutil.cpu_count(logical=True) or 0
    cpu_freq = psutil.cpu_freq()
    cpu_percent_overall = psutil.cpu_percent(interval=0.5)
    cpu_percent_per_core = psutil.cpu_percent(interval=0.1, percpu=True)
    load_avg = psutil.getloadavg()
    
    cpu_model = "Unknown"
    try:
        with open("/proc/cpuinfo", "r") as f:
            for line in f:
                if "model name" in line:
                    cpu_model = line.split(":")[1].strip()
                    break
    except Exception:
        pass
    
    # Memory Info
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()
    
    # Uptime
    boot_time = psutil.boot_time()
    uptime_seconds = int((datetime.now().timestamp() - boot_time))
    uptime_days = uptime_seconds // 86400
    uptime_hours = (uptime_seconds % 86400) // 3600
    uptime_minutes = (uptime_seconds % 3600) // 60
    
    # Disk usage - deduplicate by device
    disk_partitions = []
    seen_devices = set()
    try:
        for part in psutil.disk_partitions(all=False):
            if part.device in seen_devices:
                continue
            try:
                usage = psutil.disk_usage(part.mountpoint)
                seen_devices.add(part.device)
                disk_partitions.append({
                    "device": part.device,
                    "mountpoint": part.mountpoint,
                    "fstype": part.fstype,
                    "total_gb": round(usage.total / (1024**3), 1),
                    "used_gb": round(usage.used / (1024**3), 1),
                    "free_gb": round(usage.free / (1024**3), 1),
                    "percent": usage.percent,
                })
            except Exception:
                pass
    except Exception:
        pass
    
    # Network
    net_io = psutil.net_io_counters()
    net_interfaces = []
    try:
        addrs = psutil.net_if_addrs()
        stats = psutil.net_if_stats()
        for iface, addr_list in addrs.items():
            if iface == "lo":
                continue
            ip = ""
            for addr in addr_list:
                if addr.family.name == "AF_INET":
                    ip = addr.address
                    break
            is_up = stats.get(iface, None)
            net_interfaces.append({
                "name": iface,
                "ip": ip,
                "is_up": is_up.isup if is_up else False,
                "speed_mbps": is_up.speed if is_up else 0,
            })
    except Exception:
        pass
    
    return {
        "cpu": {
            "model": cpu_model,
            "physical_cores": cpu_count_physical,
            "logical_cores": cpu_count_logical,
            "frequency_mhz": round(cpu_freq.current, 0) if cpu_freq else 0,
            "overall_percent": cpu_percent_overall,
            "per_core_percent": cpu_percent_per_core,
            "load_avg_1m": round(load_avg[0], 2),
            "load_avg_5m": round(load_avg[1], 2),
            "load_avg_15m": round(load_avg[2], 2),
        },
        "memory": {
            "total_gb": round(mem.total / (1024**3), 2),
            "used_gb": round(mem.used / (1024**3), 2),
            "available_gb": round(mem.available / (1024**3), 2),
            "percent": mem.percent,
            "swap_total_gb": round(swap.total / (1024**3), 2),
            "swap_used_gb": round(swap.used / (1024**3), 2),
            "swap_percent": swap.percent,
        },
        "uptime": {
            "days": uptime_days,
            "hours": uptime_hours,
            "minutes": uptime_minutes,
            "boot_time": datetime.fromtimestamp(boot_time, tz=timezone.utc).isoformat(),
        },
        "disks": disk_partitions,
        "network": {
            "bytes_sent": net_io.bytes_sent,
            "bytes_recv": net_io.bytes_recv,
            "interfaces": net_interfaces,
        },
    }

@api_router.get("/health/disks")
async def get_disks_health(request: Request):
    """Return SMART disk temperatures and basic health info.

    Tries in order:
      1. smartctl --scan-open / -A (best; requires smartmontools + --cap-add SYS_RAWIO)
      2. /sys/class/hwmon/*/temp*_input for NVMe (no root needed)
    Gracefully reports why no data is available.
    """
    user = await get_current_user(request)
    if not user.get("permissions", {}).get("health", False) and user["role"] not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Health access not permitted")

    import shutil as _sh
    import subprocess as _sp
    import re as _re
    from pathlib import Path as _P
    import json as _json

    disks: list[dict] = []
    notes: list[str] = []

    # --- Method 1: smartctl ---
    smartctl_path = _sh.which("smartctl")
    if smartctl_path:
        try:
            # Scan for devices (JSON output available in smartmontools >= 7.0)
            scan = _sp.run([smartctl_path, "--scan-open", "-j"], capture_output=True, text=True, timeout=5)
            scan_devices = []
            if scan.returncode == 0 and scan.stdout:
                try:
                    sd = _json.loads(scan.stdout)
                    for dev in sd.get("devices", []) or []:
                        scan_devices.append(dev.get("name"))
                except _json.JSONDecodeError:
                    # Fallback: parse plain text output
                    for line in scan.stdout.splitlines():
                        m = _re.match(r'^(\S+)\s+-d', line)
                        if m:
                            scan_devices.append(m.group(1))
            # Per-device SMART
            for dev in [d for d in scan_devices if d]:
                try:
                    r = _sp.run([smartctl_path, "-A", "-i", "-H", "-j", dev], capture_output=True, text=True, timeout=8)
                    if r.returncode in (0, 4, 64) and r.stdout:  # 4/64 = non-fatal SMART warnings
                        data = _json.loads(r.stdout)
                        temp = None
                        temp_raw = data.get("temperature", {})
                        if isinstance(temp_raw, dict) and "current" in temp_raw:
                            temp = temp_raw.get("current")
                        # Also look in attributes
                        if temp is None:
                            for a in data.get("ata_smart_attributes", {}).get("table", []) or []:
                                if (a.get("name") or "").lower() in ("temperature_celsius", "airflow_temperature_cel", "temperature_internal"):
                                    temp = a.get("raw", {}).get("value")
                                    break
                        passed = (data.get("smart_status", {}) or {}).get("passed")
                        disks.append({
                            "device": dev,
                            "model": data.get("model_name") or data.get("model_family") or "",
                            "serial": data.get("serial_number") or "",
                            "size_gb": round((data.get("user_capacity", {}) or {}).get("bytes", 0) / (1024**3), 1) if isinstance(data.get("user_capacity"), dict) else 0,
                            "temperature_c": temp,
                            "smart_passed": passed,
                            "source": "smartctl",
                        })
                except Exception as e:
                    notes.append(f"{dev}: {str(e)[:80]}")
        except Exception as e:
            notes.append(f"smartctl scan failed: {str(e)[:80]}")
    else:
        notes.append("smartctl nicht gefunden. Installiere 'smartmontools' und starte den Container mit --cap-add=SYS_RAWIO (oder --privileged), dann werden Festplatten-Temperaturen hier sichtbar.")

    # --- Method 2: NVMe via hwmon (no root) ---
    if not disks:
        try:
            hwmon_root = _P("/sys/class/hwmon")
            if hwmon_root.exists():
                for hwdir in hwmon_root.iterdir():
                    try:
                        name_file = hwdir / "name"
                        name = name_file.read_text().strip() if name_file.exists() else ""
                        if not name or "nvme" not in name.lower():
                            continue
                        for tfile in hwdir.glob("temp*_input"):
                            try:
                                millideg = int(tfile.read_text().strip())
                                temp = round(millideg / 1000.0, 1)
                                disks.append({
                                    "device": f"/dev/{name}",
                                    "model": name,
                                    "serial": "",
                                    "size_gb": 0,
                                    "temperature_c": temp,
                                    "smart_passed": None,
                                    "source": "hwmon",
                                })
                            except Exception:
                                pass
                    except Exception:
                        continue
        except Exception as e:
            notes.append(f"hwmon read failed: {str(e)[:80]}")

    return {
        "available": bool(disks),
        "disks": disks,
        "notes": notes,
        "smartctl_installed": bool(smartctl_path),
    }


@api_router.get("/health/docker")
async def get_docker_containers(request: Request):
    user = await get_current_user(request)
    if not user.get("permissions", {}).get("health", False) and user["role"] not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Health access not permitted")
    
    if not DOCKER_AVAILABLE:
        return {"available": False, "containers": [], "message": "Docker Socket nicht verfügbar"}
    try:
        containers = docker_client.containers.list(all=True)
        result = []
        for c in containers:
            ports = {}
            try:
                ports = c.attrs.get("NetworkSettings", {}).get("Ports", {}) or {}
            except Exception:
                pass
            
            port_mappings = []
            for container_port, host_bindings in ports.items():
                if host_bindings:
                    for binding in host_bindings:
                        port_mappings.append(f"{binding.get('HostIp', '0.0.0.0')}:{binding.get('HostPort', '?')} -> {container_port}")
                else:
                    port_mappings.append(container_port)
            
            networks = {}
            try:
                net_settings = c.attrs.get("NetworkSettings", {}).get("Networks", {})
                for net_name, net_info in net_settings.items():
                    networks[net_name] = net_info.get("IPAddress", "")
            except Exception:
                pass
            
            started_at = c.attrs.get("State", {}).get("StartedAt", "")
            uptime_str = ""
            if c.status == "running" and started_at:
                try:
                    start_dt = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
                    delta = datetime.now(timezone.utc) - start_dt
                    days = delta.days
                    hours = delta.seconds // 3600
                    if days > 0:
                        uptime_str = f"{days}d {hours}h"
                    else:
                        minutes = (delta.seconds % 3600) // 60
                        uptime_str = f"{hours}h {minutes}m"
                except Exception:
                    pass
            
            result.append({
                "id": c.short_id,
                "name": c.name,
                "image": c.image.tags[0] if c.image.tags else str(c.image.id)[:20],
                "status": c.status,
                "state": c.attrs.get("State", {}).get("Status", "unknown"),
                "ports": port_mappings,
                "networks": networks,
                "uptime": uptime_str,
                "created": c.attrs.get("Created", ""),
            })
        
        result.sort(key=lambda x: x["name"].lower())
        return {"available": True, "containers": result, "total": len(result), "running": sum(1 for c in result if c["status"] == "running"), "stopped": sum(1 for c in result if c["status"] != "running")}
    except Exception as e:
        logger.error(f"Docker error: {e}")
        return {"available": False, "containers": [], "message": str(e)}

# ==================== LOGS ====================

@api_router.get("/logs")
async def get_logs(request: Request, limit: int = 100, log_type: Optional[str] = None):
    user = await get_current_user(request)
    if not user.get("permissions", {}).get("logs", False) and user["role"] not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Logs access not permitted")
    
    query = {}
    if log_type:
        query["type"] = log_type
    logs = await db.logs.find(query, {"_id": 0}).sort("timestamp", -1).limit(limit).to_list(limit)
    return logs

# ==================== ADMIN SETTINGS ====================

@api_router.get("/admin/settings")
async def get_settings(request: Request):
    await require_admin(request)
    settings = await db.settings.find({}, {"_id": 0}).to_list(100)
    result = {}
    for s in settings:
        key = s["key"]
        val = s.get("value", "")
        if key in ("openai_api_key", "weather_api_key", "ha_token", "casedesk_password", "telegram_bot_token", "plex_token", "cookpilot_shared_secret") and val:
            result[key] = val[:8] + "..." + val[-4:] if len(val) > 12 else val
        else:
            result[key] = val
    return result

@api_router.put("/admin/settings")
async def update_settings(request: Request, payload: dict = Body(...)):
    await require_admin(request)
    try:
        saved_keys = []
        for key, value in payload.items():
            # Skip masked values (already saved)
            if key in ("openai_api_key", "weather_api_key", "ha_token", "casedesk_password", "telegram_bot_token", "plex_token", "cookpilot_shared_secret") and value and "..." in value:
                continue
            # Ensure value is a string
            str_value = str(value) if value is not None else ""
            await db.settings.update_one(
                {"key": key},
                {"$set": {"value": str_value, "updated_at": datetime.now(timezone.utc).isoformat()}},
                upsert=True
            )
            saved_keys.append(key)
        # Auto-start Telegram bot when token is saved
        if key == "telegram_bot_token" and str_value and "..." not in str_value:
            try:
                await telegram_bot.restart_bot()
                logger.info("Telegram bot restarted after token update")
            except Exception as e:
                logger.warning(f"Telegram bot restart failed: {e}")
        logger.info(f"Settings saved: {saved_keys}")
        return {"message": "Settings updated", "saved": saved_keys}
    except Exception as e:
        logger.error(f"Settings save error: {e}")
        raise HTTPException(status_code=500, detail=f"Speichern fehlgeschlagen: {str(e)}")

async def get_llm_api_key() -> str:
    setting = await db.settings.find_one({"key": "openai_api_key"})
    if setting and setting.get("value"):
        return setting["value"]
    return ""

# ==================== ADMIN SERVICE-REGISTRY (GPT ROUTER) ====================

@api_router.get("/admin/service-registry")
async def admin_get_service_registry(request: Request):
    """Return merged service registry (defaults + DB overrides) with availability status."""
    await require_admin(request)
    default_ids = {s["service_id"] for s in service_router.DEFAULT_REGISTRY}
    custom = await db.service_registry.find({}, {"_id": 0}).to_list(100)
    custom_map = {c["service_id"]: c for c in custom}

    merged = []
    for default in service_router.DEFAULT_REGISTRY:
        sid = default["service_id"]
        entry = {**default, "is_default": True, "overridden": sid in custom_map, "is_custom": False}
        if sid in custom_map:
            entry = {**entry, **custom_map[sid], "is_default": True, "overridden": True, "is_custom": False}
        try:
            entry["available"] = await service_router.check_service_available(sid)
        except Exception:
            entry["available"] = False
        merged.append(entry)

    # Custom services without default counterpart
    for c in custom:
        if c["service_id"] not in default_ids:
            entry = {**c, "is_default": False, "overridden": False, "is_custom": True, "available": False}
            merged.append(entry)

    return {"services": merged}


@api_router.put("/admin/service-registry/{service_id}")
async def admin_update_service_registry(service_id: str, request: Request, body: dict = Body(...)):
    """Upsert a service override (or custom service). Expected body fields:
       name, description, capabilities (list), example_queries (list), type, is_active (bool).
    """
    await require_admin(request)
    allowed = {"name", "description", "capabilities", "example_queries", "type", "is_active"}
    clean = {k: v for k, v in body.items() if k in allowed}
    if not clean:
        raise HTTPException(400, "Keine gültigen Felder")
    clean["service_id"] = service_id
    clean["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.service_registry.update_one(
        {"service_id": service_id},
        {"$set": clean},
        upsert=True,
    )
    return {"success": True, "service_id": service_id}


@api_router.post("/admin/service-registry")
async def admin_create_custom_service(request: Request, body: dict = Body(...)):
    """Create a new custom service not in the default registry."""
    await require_admin(request)
    sid = (body.get("service_id") or "").strip().lower()
    if not sid or not sid.replace("_", "").replace("-", "").isalnum():
        raise HTTPException(400, "service_id muss alphanumerisch sein (a-z, 0-9, _, -)")
    default_ids = {s["service_id"] for s in service_router.DEFAULT_REGISTRY}
    if sid in default_ids:
        raise HTTPException(400, "Service-ID existiert bereits als Default. Nutze PUT zum Überschreiben.")
    existing = await db.service_registry.find_one({"service_id": sid})
    if existing:
        raise HTTPException(400, "Service-ID existiert bereits")
    doc = {
        "service_id": sid,
        "name": body.get("name", sid),
        "description": body.get("description", ""),
        "capabilities": body.get("capabilities", []),
        "example_queries": body.get("example_queries", []),
        "type": body.get("type", "custom"),
        "is_active": body.get("is_active", True),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.service_registry.insert_one(doc)
    doc.pop("_id", None)
    return {"success": True, "service": doc}


@api_router.delete("/admin/service-registry/{service_id}")
async def admin_delete_service_registry(service_id: str, request: Request):
    """Delete a registry override. For defaults this reverts to default; for custom it removes the service entirely."""
    await require_admin(request)
    result = await db.service_registry.delete_one({"service_id": service_id})
    return {"success": True, "deleted": result.deleted_count}


# ==================== ADMIN: SETTINGS BACKUP / DIAGNOSE ====================

# Keys die als "secret" behandelt werden — Export maskiert sie standardmäßig
SECRET_SETTING_KEYS = {
    "openai_api_key", "ha_token", "plex_token", "telegram_bot_token",
    "casedesk_api_key", "weather_api_key", "jwt_secret",
    "nextcloud_password", "forgepilot_api_key", "cookpilot_shared_secret",
}


@api_router.get("/admin/settings-diagnosis")
async def admin_settings_diagnosis(request: Request):
    """Liste aller Settings-Keys mit Status (gesetzt / leer). Zeigt keine Werte.
    Praktisch um nach einem Update schnell zu sehen welche Keys verloren gingen."""
    await require_admin(request)
    docs = await db.settings.find({}, {"_id": 0}).to_list(500)
    result = []
    for d in docs:
        key = d.get("key", "")
        # Skip internal cache keys (prefixed with _) — they're runtime caches,
        # not configuration keys. Showing them in the diagnose grid is misleading.
        if key.startswith("_"):
            continue
        val = d.get("value", "")
        is_secret = key in SECRET_SETTING_KEYS
        has_value = bool(val) and val not in ("DISABLED", "")
        preview = ""
        if has_value and not is_secret:
            preview = str(val)[:60]
        elif has_value and is_secret:
            preview = f"***{str(val)[-4:]}" if len(str(val)) > 4 else "***"
        result.append({
            "key": key,
            "is_secret": is_secret,
            "has_value": has_value,
            "preview": preview,
            "length": len(str(val)) if val else 0,
        })
    result.sort(key=lambda x: (not x["has_value"], x["key"]))
    total = len(result)
    filled = sum(1 for r in result if r["has_value"])
    return {"settings": result, "total": total, "filled": filled, "empty": total - filled}


@api_router.get("/admin/settings-export")
async def admin_settings_export(request: Request, include_secrets: bool = False):
    """Exportiert alle Settings als JSON.
    `include_secrets=true` enthält auch API-Keys/Tokens im Klartext — NUR für Backup-Zwecke.
    """
    await require_admin(request)
    docs = await db.settings.find({}, {"_id": 0}).to_list(500)
    # Filter out internal cache keys (prefixed with _) from exports
    docs = [d for d in docs if not d.get("key", "").startswith("_")]
    if not include_secrets:
        for d in docs:
            if d.get("key") in SECRET_SETTING_KEYS:
                d["value"] = "***REDACTED***"
    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "version": ARIA_VERSION,
        "include_secrets": include_secrets,
        "count": len(docs),
        "settings": docs,
    }


@api_router.post("/admin/settings-import")
async def admin_settings_import(request: Request, body: dict = Body(...)):
    """Importiert Settings aus einem Export.
    Skippt Einträge mit ***REDACTED***. Upserted die anderen.
    """
    await require_admin(request)
    settings = body.get("settings") or []
    if not isinstance(settings, list):
        raise HTTPException(400, "Erwarte 'settings' als Liste")
    imported, skipped = 0, 0
    for s in settings:
        key = s.get("key")
        val = s.get("value")
        if not key:
            skipped += 1
            continue
        if val == "***REDACTED***":
            skipped += 1
            continue
        await db.settings.update_one(
            {"key": key},
            {"$set": {"key": key, "value": val, "updated_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
        imported += 1
    # Auto-restart bot if telegram token was imported
    try:
        if any(s.get("key") == "telegram_bot_token" for s in settings):
            await telegram_bot.restart_bot()
    except Exception:
        pass
    return {"success": True, "imported": imported, "skipped": skipped}



@api_router.post("/admin/telegram/test")
async def admin_telegram_test(request: Request, body: dict = Body(default={})):
    """Test Telegram bot token: validates via getMe, clears webhook, returns bot info.

    Body can optionally contain {"token": "..."} to test a specific token
    without saving it. Otherwise uses the currently-saved token.
    """
    await require_admin(request)
    provided = (body or {}).get("token", "").strip() if isinstance(body, dict) else ""
    token = provided or await telegram_bot.get_bot_token()
    if not token:
        return {"ok": False, "stage": "token", "message": "Kein Token konfiguriert. Hinterlege einen gültigen Bot-Token in den Einstellungen."}
    return await telegram_bot.test_token(token)


@api_router.get("/admin/telegram/status")
async def admin_telegram_status(request: Request):
    """Get current Telegram bot polling runtime status."""
    await require_admin(request)
    status = telegram_bot.get_status()
    status["token_configured"] = bool(await telegram_bot.get_bot_token())
    return status


@api_router.post("/admin/telegram/restart")
async def admin_telegram_restart(request: Request):
    """Force restart of the Telegram polling loop (e.g. after removing stale webhook)."""
    await require_admin(request)
    token = await telegram_bot.get_bot_token()
    if not token:
        raise HTTPException(400, "Kein Token konfiguriert")
    await telegram_bot.restart_bot()
    # Give the new loop a moment to initialise (getMe + clear webhook)
    await asyncio.sleep(1.5)
    return {"success": True, "status": telegram_bot.get_status()}


# ==================== ADMIN: CHAT ROUTER HISTORY ====================

@api_router.get("/admin/router-history")
async def admin_router_history(request: Request, limit: int = 100):
    """Recent routing decisions (message → selected services)."""
    await require_admin(request)
    limit = max(1, min(500, int(limit)))
    entries = await db.chat_route_log.find({}, {"_id": 0}).sort("timestamp", -1).limit(limit).to_list(limit)
    # Enrich with user name
    user_ids = list({e.get("user_id") for e in entries if e.get("user_id")})
    names = {}
    for uid in user_ids:
        try:
            u = await db.users.find_one({"_id": ObjectId(uid)}, {"_id": 0, "name": 1, "email": 1})
            if u:
                names[uid] = u.get("name") or u.get("email") or ""
        except Exception:
            pass
    for e in entries:
        e["user_name"] = names.get(e.get("user_id", ""), "")
    return entries


@api_router.delete("/admin/router-history")
async def admin_router_history_clear(request: Request):
    """Clear routing history."""
    await require_admin(request)
    result = await db.chat_route_log.delete_many({})
    return {"success": True, "deleted": result.deleted_count}


# ==================== CHAT CONTEXT ENRICHMENT ====================

async def gather_context_for_services(service_ids: list, msg_lower: str, original_message: str = "", progress_cb=None) -> str:
    """Gather context ONLY from the routed services.

    progress_cb (optional): async callable used by the A.R.I.A. streaming UI
    to show per-service search panels.  For each routed service we emit:
        panel_open   {id, service, title, query, status: "active"}
        panel_update {id, status: "done"|"empty"|"error", snippet?, count?}
    """
    context_parts = []

    async def _panel_open(service: str, title: str, query: str):
        if progress_cb:
            try:
                await progress_cb("panel_open", {
                    "id": f"panel_{service}",
                    "service": service,
                    "title": title,
                    "query": query[:120],
                    "status": "active",
                })
            except Exception:
                pass

    async def _panel_update(service: str, status: str, snippet: str = "", count=None):
        if progress_cb:
            try:
                await progress_cb("panel_update", {
                    "id": f"panel_{service}",
                    "status": status,
                    "snippet": (snippet or "")[:160],
                    "count": count,
                })
            except Exception:
                pass

    if "weather" in service_ids:
        await _panel_open("weather", "Wetter", original_message or "aktuelles Wetter")
        try:
            city, api_key = await get_weather_settings()
            if city and api_key:
                parsed = parse_city_query(city)
                async with httpx.AsyncClient(timeout=8.0) as http_client:
                    params = {"appid": api_key, "units": "metric", "lang": "de"}
                    if parsed["type"] == "zip":
                        params["zip"] = f"{parsed['zip']},{parsed['country']}"
                    else:
                        params["q"] = parsed["q"]
                    current_resp = await http_client.get("https://api.openweathermap.org/data/2.5/weather", params=params)
                    if current_resp.status_code == 200:
                        w = current_resp.json()
                        forecast_params = {**params, "cnt": 24}
                        forecast_resp = await http_client.get("https://api.openweathermap.org/data/2.5/forecast", params=forecast_params)
                        forecast_text = ""
                        if forecast_resp.status_code == 200:
                            items = forecast_resp.json().get("list", [])
                            forecast_text = "\nVorhersage (nächste 24h):\n"
                            for item in items[:8]:
                                dt = item.get("dt_txt", "")
                                temp = item["main"]["temp"]
                                desc = item["weather"][0]["description"]
                                forecast_text += f"  {dt}: {temp}°C, {desc}\n"
                        context_parts.append(f"""WETTERDATEN für {w.get('name', city)}:
- Temperatur: {w['main']['temp']}°C (gefühlt {w['main']['feels_like']}°C)
- {w['weather'][0]['description']}, Luftfeuchtigkeit: {w['main']['humidity']}%
- Wind: {w['wind']['speed']} m/s, Wolken: {w['clouds']['all']}%{forecast_text}""")
                        await _panel_update("weather", "done", f"{w.get('name', city)} · {w['main']['temp']}°C · {w['weather'][0]['description']}")
                    else:
                        await _panel_update("weather", "error", f"HTTP {current_resp.status_code}")
            else:
                await _panel_update("weather", "empty", "kein API-Key")
        except Exception as e:
            logger.warning(f"Weather context failed: {e}")
            await _panel_update("weather", "error", str(e)[:120])

    if "system" in service_ids:
        await _panel_open("system", "System-Diagnostik", "CPU / RAM / Docker")
        sys_snippet = ""
        try:
            import psutil
            cpu = psutil.cpu_percent(interval=0.5)
            mem = psutil.virtual_memory()
            disk = psutil.disk_usage('/')
            context_parts.append(f"SYSTEMDATEN: CPU {cpu}%, RAM {mem.used/(1024**3):.1f}/{mem.total/(1024**3):.1f}GB ({mem.percent}%), Disk {disk.percent}%")
            sys_snippet = f"CPU {cpu}% · RAM {mem.percent}% · Disk {disk.percent}%"
        except Exception:
            pass
        try:
            import docker as docker_lib
            dock = docker_lib.DockerClient(base_url='unix:///var/run/docker.sock', timeout=5)
            containers = dock.containers.list(all=True)
            container_list = "\n".join([f"  - {c.name}: {c.status}" for c in containers[:15]])
            context_parts.append(f"DOCKER CONTAINER:\n{container_list}")
            sys_snippet += f" · {len(containers)} Container"
        except Exception:
            pass
        await _panel_update("system", "done" if sys_snippet else "empty", sys_snippet)

    if "homeassistant" in service_ids:
        await _panel_open("homeassistant", "Home Assistant", "Geräte abfragen")
        ha_ok = False
        try:
            ha_url, ha_token = await get_ha_settings()
            if ha_url and ha_token:
                async with httpx.AsyncClient(timeout=5.0) as http_client:
                    resp = await http_client.get(f"{ha_url}/api/states", headers={"Authorization": f"Bearer {ha_token}"})
                    if resp.status_code == 200:
                        entities = resp.json()
                        ha_info = []
                        for e in entities[:30]:
                            eid = e.get("entity_id", "")
                            domain = eid.split(".")[0]
                            if domain in ("light", "switch", "climate", "cover", "sensor", "binary_sensor"):
                                name = e.get("attributes", {}).get("friendly_name", eid)
                                state = e.get("state")
                                unit = e.get("attributes", {}).get("unit_of_measurement", "")
                                ha_info.append(f"  - {name} ({eid}): {state} {unit}".strip())
                        if ha_info:
                            context_parts.append("HOME ASSISTANT GERÄTE:\n" + "\n".join(ha_info))
                            await _panel_update("homeassistant", "done", f"{len(ha_info)} Geräte gelesen", count=len(ha_info))
                            ha_ok = True
        except Exception as e:
            await _panel_update("homeassistant", "error", str(e)[:120])
            ha_ok = True
        if not ha_ok:
            await _panel_update("homeassistant", "empty", "keine Daten")

    if "casedesk" in service_ids:
        await _panel_open("casedesk", "CaseDesk", original_message or msg_lower)
        try:
            cd_url, cd_email, cd_pw = await casedesk.get_casedesk_settings()
            if cd_url and cd_email and cd_pw:
                cd_context = await casedesk.get_casedesk_context(msg_lower)
                if cd_context:
                    context_parts.append(cd_context)
                    # Extract simple snippet: first non-empty line after header
                    snippet = next((ln for ln in cd_context.split("\n") if ln.strip() and not ln.strip().startswith("===")), "Treffer gefunden")
                    await _panel_update("casedesk", "done", snippet)
                else:
                    await _panel_update("casedesk", "empty", "keine Treffer")
            else:
                await _panel_update("casedesk", "empty", "nicht konfiguriert")
        except Exception as e:
            logger.warning(f"CaseDesk context failed: {e}")
            await _panel_update("casedesk", "error", str(e)[:120])

    if "plex" in service_ids:
        await _panel_open("plex", "Plex Media", original_message or msg_lower)
        try:
            plex_url, plex_token = await plex.get_plex_settings()
            if plex_url and plex_token:
                plex_ctx = await plex.build_chat_context(original_message or msg_lower)
                if plex_ctx:
                    context_parts.append(plex_ctx)
                    snippet = next((ln for ln in plex_ctx.split("\n") if ln.strip()), "Treffer gefunden")
                    await _panel_update("plex", "done", snippet)
                else:
                    await _panel_update("plex", "empty", "keine Treffer")
            else:
                await _panel_update("plex", "empty", "nicht konfiguriert")
        except Exception as e:
            logger.warning(f"Plex context failed: {e}")
            await _panel_update("plex", "error", str(e)[:120])

    if "cookpilot" in service_ids:
        await _panel_open("cookpilot", "CookPilot", original_message or msg_lower)
        try:
            import cookpilot as cookpilot_mod
            aria_user = _current_user_ctx.get()
            if aria_user:
                cp_context = await cookpilot_mod.get_cookpilot_context(original_message or msg_lower, aria_user)
                if cp_context:
                    context_parts.append(cp_context)
                    snippet = next((ln for ln in cp_context.split("\n") if ln.strip()), "Daten geladen")
                    await _panel_update("cookpilot", "done", snippet)
                else:
                    await _panel_update("cookpilot", "empty", "keine Daten")
            else:
                await _panel_update("cookpilot", "empty", "kein User-Kontext")
        except Exception as e:
            logger.warning(f"CookPilot context failed: {e}")
            await _panel_update("cookpilot", "error", str(e)[:120])

    return "\n\n".join(context_parts) if context_parts else ""

async def process_chat_message(message_text: str, user_id: str, session_id: str = None, progress_cb=None) -> str:
    """Core chat processing with intelligent service routing.

    progress_cb (optional): async callable(event_name: str, data: dict) used
    by the A.R.I.A. streaming endpoint to push live thought events to the
    client. Safe to leave None for the regular /api/chat path.
    """
    msg_lower = message_text.lower()

    async def _emit(event: str, data: dict):
        if progress_cb is None:
            return
        try:
            await progress_cb(event, data)
        except Exception:
            # Never let UI streaming break the chat itself
            pass

    # Resolve full user dict (used for per-service context like CookPilot SSO)
    aria_user = None
    try:
        from bson import ObjectId
        u = await db.users.find_one({"_id": ObjectId(user_id)}, {"password_hash": 0})
        if u:
            u["id"] = str(u["_id"])
            u.pop("_id", None)
            aria_user = u
            _current_user_ctx.set(aria_user)
    except Exception as e:
        logger.debug(f"resolve user for chat: {e}")
    
    api_key = await get_llm_api_key()
    if not api_key:
        await _emit("thought", {"id": "parse", "label": "Verstehe Anfrage", "status": "done"})
        await _emit("thought", {"id": "error", "label": "Kein API-Key konfiguriert", "status": "error"})
        return "Kein API-Key konfiguriert. Bitte im Admin-Bereich einen OpenAI API-Key hinterlegen."
    
    if not OPENAI_AVAILABLE:
        return "OpenAI-Modul nicht verfügbar."
    
    session_id = session_id or f"{user_id}_{uuid.uuid4().hex[:8]}"

    await _emit("thought", {"id": "parse", "label": "Verstehe Anfrage", "status": "active"})
    
    # Step 1: Route — GPT-mini decides which services to query
    await _emit("thought", {"id": "route", "label": "Wähle passende Dienste", "status": "active"})
    route_result = await service_router.route_message(message_text)
    routed_services = route_result.get("services", [])
    is_simple = route_result.get("is_simple", False)
    await _emit("thought", {"id": "parse", "label": "Verstehe Anfrage", "status": "done"})
    await _emit("thought", {
        "id": "route",
        "label": "Wähle passende Dienste",
        "status": "done",
        "detail": ", ".join(routed_services) if routed_services else "Direkte Antwort",
    })
    
    logger.info(f"Router: '{message_text[:60]}' → services={routed_services}, simple={is_simple}")

    # Log routing decision for Admin inspection (capped history)
    try:
        await db.chat_route_log.insert_one({
            "user_id": user_id,
            "session_id": session_id,
            "message": message_text[:240],
            "services": routed_services,
            "is_simple": is_simple,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass

    # Step 1a: ForgePilot Sticky-Session — wenn die letzte Assistenten-Antwort
    # aus ForgePilot kam (z.B. offene Rückfrage), leite Follow-up-Nachricht
    # automatisch wieder dorthin. So landet der Rückfrage-Dialog beim richtigen System.
    #
    # WICHTIG: Sticky wird gebrochen, wenn der Router die neue Nachricht eindeutig
    # einem anderen Dienst zuordnet (casedesk/plex/weather/homeassistant/system).
    # Sonst würden Dokumenten-/Wetter-/Smart-Home-Fragen von ForgePilot beantwortet,
    # das dann halluziniert (z.B. Playwright-Output statt CaseDesk-Treffer).
    NON_DEV_SERVICES = {"casedesk", "plex", "weather", "homeassistant", "system", "cookpilot"}
    router_picked_non_dev = any(s in NON_DEV_SERVICES for s in routed_services)

    last_assistant = await db.chat_messages.find_one(
        {"session_id": session_id, "role": "assistant"},
        {"_id": 0, "routed_to": 1, "forgepilot_meta": 1},
        sort=[("timestamp", -1)],
    )
    if last_assistant and not router_picked_non_dev:
        meta = last_assistant.get("forgepilot_meta") or {}
        routed_to = last_assistant.get("routed_to") or []
        if "forgepilot" in routed_to and (meta.get("ask_user") or meta.get("still_running")):
            if "forgepilot" not in routed_services:
                routed_services = ["forgepilot"] + [s for s in routed_services if s != "forgepilot"]
                logger.info(f"Sticky ForgePilot: Follow-up auf offene Rückfrage/Arbeit → forgepilot")
    elif last_assistant and router_picked_non_dev and "forgepilot" in routed_services:
        # Router will explizit auf einen Fach-Dienst. Entferne forgepilot aus der Liste.
        routed_services = [s for s in routed_services if s != "forgepilot"]
        logger.info(f"Sticky-Break: Router routet auf {routed_services} (non-dev) → forgepilot entfernt")

    # Step 1b: ForgePilot Delegation — wenn ForgePilot der EINZIGE gebrauchte Dienst
    # ist (reine Code-/Dev-Frage), delegieren wir vollständig an ForgePilot und
    # lassen Aria die Antwort freundlich umformulieren. Wenn daneben ein anderer
    # Fach-Dienst gebraucht wird, fallen wir auf normalen Aria-Chat mit Context
    # zurück (damit ForgePilot keine CaseDesk/Plex-Fragen übernimmt).
    non_dev_in_route = [s for s in routed_services if s in NON_DEV_SERVICES]
    if "forgepilot" in routed_services and not non_dev_in_route:
        forge_result = await forgepilot.query_forgepilot(message_text, session_id, user_id)
        friendly = await forgepilot.friendly_rephrase(forge_result, message_text)

        now = datetime.now(timezone.utc).isoformat()
        await db.chat_messages.insert_many([
            {"session_id": session_id, "user_id": user_id, "role": "user", "content": message_text, "timestamp": now},
            {"session_id": session_id, "user_id": user_id, "role": "assistant", "content": friendly,
             "timestamp": now, "routed_to": ["forgepilot"],
             "forgepilot_meta": {
                 "ask_user": forge_result.get("ask_user", False),
                 "is_complete": forge_result.get("is_complete", False),
                 "still_running": forge_result.get("still_running", False),
                 "project_id": forge_result.get("project_id"),
             }},
        ])
        return friendly
    
    # Step 2: Gather context ONLY from routed services
    live_context = ""
    if routed_services:
        await _emit("thought", {"id": "fetch", "label": "Hole Live-Daten", "status": "active", "detail": ", ".join(routed_services)})
        live_context = await gather_context_for_services(routed_services, msg_lower, message_text, progress_cb=progress_cb)
        await _emit("thought", {"id": "fetch", "label": "Hole Live-Daten", "status": "done"})

    # Step 2b: CookPilot WRITE actions — if the user said "Brot zur Einkaufsliste",
    # actually call CookPilot (deterministic) BEFORE GPT replies. Inject the
    # verified result into context so GPT confirms truthfully (or reports the
    # error). Without this GPT happily lies "Brot wurde hinzugefügt!".
    cookpilot_action_result = None
    if "cookpilot" in routed_services and aria_user:
        try:
            import cookpilot as cookpilot_mod
            cookpilot_action_result = await cookpilot_mod.try_execute_cookpilot_action(message_text, aria_user)
        except Exception as e:
            logger.warning(f"CookPilot action exec failed: {e}")
        if cookpilot_action_result:
            tag = "[ACTION AUSGEFÜHRT]" if cookpilot_action_result.get("executed") else "[ACTION FEHLGESCHLAGEN]"
            txt = cookpilot_action_result.get("summary") or cookpilot_action_result.get("error") or ""
            live_context = (live_context + f"\n\n{tag} {txt}").strip()

    # Step 2c: Email Draft / Confirm / Cancel flow (CaseDesk).
    # Aria speichert den Entwurf lokal, zeigt ihn dem User und versendet erst
    # bei expliziter Bestätigung. Funktioniert auch für Sprach-Trigger ("ja
    # versende die email jetzt").
    email_action_result = None
    if aria_user:
        try:
            confirmation = casedesk._detect_email_confirmation(message_text)
        except Exception:
            confirmation = None
        if confirmation == "send":
            try:
                email_action_result = await casedesk.confirm_and_send_latest_draft(aria_user, session_id or "default")
                email_action_result["action"] = "email_send"
            except Exception as e:
                email_action_result = {"success": False, "message": f"Fehler beim Versand: {e}", "action": "email_send"}
        elif confirmation == "cancel":
            try:
                email_action_result = await casedesk.cancel_latest_draft(aria_user, session_id or "default")
                email_action_result["action"] = "email_cancel"
            except Exception as e:
                email_action_result = {"success": False, "message": f"Fehler beim Verwerfen: {e}", "action": "email_cancel"}
        else:
            # Try to detect draft intent only if CaseDesk was routed (or message
            # clearly asks for an email).
            try:
                intent = casedesk._detect_email_intent(message_text)
            except Exception:
                intent = None
            if intent:
                await _emit("thought", {
                    "id": "email_intent",
                    "label": "Erkenne E-Mail-Absicht",
                    "status": "done",
                    "detail": f"An: {intent.get('recipient_name') or intent.get('recipient_email') or '?'}",
                })
                await _emit("thought", {"id": "recipient", "label": "Identifiziere Empfänger", "status": "active"})
                await _emit("thought", {"id": "subject", "label": "Formuliere Betreff", "status": "active"})
                await _emit("thought", {"id": "body", "label": "Schreibe E-Mail-Text", "status": "active"})
                try:
                    draft_res = await casedesk.create_email_draft(aria_user, intent, session_id or "default")
                    email_action_result = {
                        "success": True,
                        "action": "email_draft",
                        "message": draft_res["preview"],
                        "draft_id": draft_res["draft_id"],
                    }
                    draft_obj = draft_res.get("draft") or {}
                    await _emit("thought", {
                        "id": "recipient",
                        "label": "Identifiziere Empfänger",
                        "status": "done",
                        "detail": draft_obj.get("recipient_email") or draft_obj.get("recipient_name") or "?",
                    })
                    await _emit("thought", {
                        "id": "subject",
                        "label": "Formuliere Betreff",
                        "status": "done",
                        "detail": draft_obj.get("subject") or "(kein Betreff)",
                    })
                    await _emit("thought", {
                        "id": "body",
                        "label": "Schreibe E-Mail-Text",
                        "status": "done",
                        "detail": (draft_obj.get("body") or "")[:80],
                    })
                    # Ensure casedesk is in routed_services so GPT knows where the draft lives
                    if "casedesk" not in routed_services:
                        routed_services.append("casedesk")
                except Exception as e:
                    email_action_result = {"success": False, "message": f"Entwurf konnte nicht gespeichert werden: {e}", "action": "email_draft"}
                    await _emit("thought", {"id": "body", "label": "Schreibe E-Mail-Text", "status": "error", "detail": str(e)[:80]})

    if email_action_result:
        if email_action_result.get("action") == "email_draft" and email_action_result.get("success"):
            live_context = (live_context + f"\n\n[EMAIL-ENTWURF ERSTELLT — wartet auf Bestätigung]\n{email_action_result['message']}").strip()
        elif email_action_result.get("action") == "email_send":
            tag = "[EMAIL GESENDET]" if email_action_result.get("success") else "[EMAIL-VERSAND FEHLGESCHLAGEN]"
            live_context = (live_context + f"\n\n{tag} {email_action_result.get('message', '')}").strip()
        elif email_action_result.get("action") == "email_cancel":
            tag = "[EMAIL-ENTWURF VERWORFEN]" if email_action_result.get("success") else "[KEIN ENTWURF VORHANDEN]"
            live_context = (live_context + f"\n\n{tag} {email_action_result.get('message', '')}").strip()

    # Flag: Service wurde geroutet aber lieferte keinen Kontext → Aria muss das transparent
    # kommunizieren statt zu halluzinieren "ich kann nicht auf Dokumente zugreifen".
    routed_but_empty = bool(routed_services) and not live_context
    
    # Step 3: Load chat history
    history = await db.chat_messages.find({"session_id": session_id}).sort("timestamp", 1).limit(50).to_list(50)
    
    try:
        openai_client = AsyncOpenAI(api_key=api_key)
        
        system_prompt = _get_system_prompt()

        # Inject ARIA-Memory (personal facts from chat + CaseDesk) so ARIA
        # behaves like a real personal butler instead of a stateless chatbot.
        try:
            import aria_memory as _aria_memory
            mem_block = await _aria_memory.build_memory_context(user_id, max_chars=1800)
            if mem_block:
                system_prompt += "\n\n" + mem_block
            # Trigger CaseDesk profile sync in background (no-op if <24h old)
            await _aria_memory.maybe_async_resync_casedesk(user_id)
        except Exception as e:
            logger.debug(f"aria_memory inject skipped: {e}")
        
        # Add routing info to system prompt
        if routed_services:
            system_prompt += f"\n\n[ROUTING: Diese Anfrage wurde an folgende Dienste geroutet: {', '.join(routed_services)}. Nutze die bereitgestellten Daten.]"
        if cookpilot_action_result:
            if cookpilot_action_result.get("executed"):
                system_prompt += (
                    f"\n\n[WICHTIG: Eine SCHREIB-AKTION wurde bereits AUSGEFÜHRT bevor du antwortest. "
                    f"Im Live-Kontext steht das Ergebnis als '[ACTION AUSGEFÜHRT] ...'. "
                    f"Bestätige dem User KURZ und KONKRET was tatsächlich passiert ist (z.B. 'Brot ist jetzt auf der Einkaufsliste'). "
                    f"NICHT erfinden, NICHT zusätzliche Aktionen versprechen. Halte die Antwort auf 1-2 Sätze.]"
                )
            else:
                system_prompt += (
                    f"\n\n[WICHTIG: Der User wollte eine Aktion ausführen, aber sie ist FEHLGESCHLAGEN. "
                    f"Im Live-Kontext steht der Fehler als '[ACTION FEHLGESCHLAGEN] ...'. "
                    f"Sag dem User EHRLICH, dass es nicht geklappt hat und nenne kurz den Grund. "
                    f"NIEMALS so tun als wäre die Aktion gelungen.]"
                )
        if email_action_result:
            act = email_action_result.get("action")
            if act == "email_draft" and email_action_result.get("success"):
                system_prompt += (
                    "\n\n[WICHTIG EMAIL-FLOW: Du hast einen E-Mail-ENTWURF für den User vorbereitet. "
                    "Der Entwurf (Empfänger, Betreff, Text) steht im Live-Kontext nach '[EMAIL-ENTWURF ERSTELLT — wartet auf Bestätigung]'. "
                    "Du darfst die E-Mail NOCH NICHT versenden. "
                    "Zeige dem User den Entwurf KOMPLETT (Empfänger/Betreff/Text, formatiert). "
                    "Frage explizit: 'Soll ich die E-Mail jetzt versenden? Sag \"Aria, ja versende die email jetzt\" zum Senden oder \"verwerfen\" zum Abbrechen.' "
                    "Niemals behaupten die Mail sei schon raus. CaseDesk hat kein Entwürfe-Postfach — der Entwurf liegt ausschliesslich in Aria.]"
                )
            elif act == "email_send" and email_action_result.get("success"):
                system_prompt += (
                    "\n\n[EMAIL-VERSAND BESTÄTIGT: Die E-Mail wurde gerade tatsächlich versendet (im Kontext: [EMAIL GESENDET] ...). "
                    "Antworte kurz und bestätigend, z.B. 'Erledigt — E-Mail an X ist raus.' 1 Satz.]"
                )
            elif act == "email_send" and not email_action_result.get("success"):
                system_prompt += (
                    "\n\n[EMAIL-VERSAND FEHLGESCHLAGEN: Im Kontext steht [EMAIL-VERSAND FEHLGESCHLAGEN] mit Grund. "
                    "Sag dem User EHRLICH dass es nicht geklappt hat und nenne den Grund.]"
                )
            elif act == "email_cancel":
                system_prompt += (
                    "\n\n[EMAIL-ENTWURF VERWORFEN: Bestätige dem User kurz, dass der Entwurf nicht versendet wurde.]"
                )
        if routed_but_empty:
            system_prompt += (
                f"\n\n[WICHTIG: Die Dienste {', '.join(routed_services)} wurden angefragt, "
                f"lieferten aber KEINE Treffer oder sind gerade nicht erreichbar. "
                f"Sage das dem User EHRLICH und KURZ (z.B. 'Ich habe im Dokumentenarchiv nach "
                f"XY gesucht, aber nichts gefunden.') statt generisch zu antworten oder zu "
                f"behaupten du könntest keine Dokumente lesen. Biete konkret an, mit anderen "
                f"Suchbegriffen nochmal zu suchen.]"
            )
        
        gpt_messages = [{"role": "system", "content": system_prompt}]
        
        for h in history[-20:]:
            gpt_messages.append({"role": h["role"], "content": h["content"]})
        
        user_message = message_text
        if live_context:
            user_message = f"[ECHTZEITDATEN]\n{live_context}\n[/ECHTZEITDATEN]\n\nFrage: {message_text}"
        
        gpt_messages.append({"role": "user", "content": user_message})
        
        # Step 4: Use specialist model for complex queries, mini for simple
        if is_simple and not routed_services:
            model_preference = ["gpt-5.4-mini", "gpt-4o-mini"]
        else:
            model_preference = ["gpt-5.4-mini", "gpt-4o"]
        
        response = None
        response_text = ""
        await _emit("thought", {"id": "reason", "label": "Denke nach", "status": "active"})
        for model in model_preference:
            try:
                kwargs = {"model": model, "messages": gpt_messages, "temperature": 0.7}
                if "5.4" in model:
                    kwargs["max_completion_tokens"] = 1000
                else:
                    kwargs["max_tokens"] = 1000

                # Stream tokens live to A.R.I.A. UI when a progress callback
                # is connected (SSE endpoint). Falls back to non-streaming
                # for the legacy /api/chat path.
                if progress_cb is not None:
                    kwargs["stream"] = True
                    stream = await openai_client.chat.completions.create(**kwargs)
                    collected = ""
                    async for chunk in stream:
                        try:
                            choice = chunk.choices[0] if chunk.choices else None
                            delta = getattr(choice.delta, "content", None) if choice else None
                        except Exception:
                            delta = None
                        if delta:
                            collected += delta
                            await _emit("result_chunk", {"delta": delta, "text": collected})
                    response_text = collected
                    response = True  # marker: stream completed successfully
                else:
                    response = await openai_client.chat.completions.create(**kwargs)
                    response_text = response.choices[0].message.content
                break
            except Exception as e:
                if "401" in str(e) or "model" in str(e).lower():
                    continue
                raise
        
        if not response:
            await _emit("thought", {"id": "reason", "label": "Denke nach", "status": "error"})
            return "KI-Modell nicht verfügbar."

        await _emit("thought", {"id": "reason", "label": "Denke nach", "status": "done"})

        # Step 4.5: Detect [AKTION:WEBSUCHE] tag → run Tavily smart-research
        # and re-prompt the model with the fresh facts. Single-pass; we keep
        # the original message so persistent action tags (HA, email) still
        # work in the final response.
        try:
            import re as _re
            websearch_match = _re.search(
                r'\[AKTION:WEBSUCHE\]\s*(\{[^}]+\})',
                response_text or "",
                _re.IGNORECASE,
            )
            if websearch_match:
                import json as _json
                try:
                    payload = _json.loads(websearch_match.group(1))
                except Exception:
                    payload = {}
                wq = (payload.get("query") or "").strip()
                if wq:
                    await _emit("thought", {"id": "websearch", "label": f"Recherchiere im Internet: {wq[:60]}", "status": "active"})
                    await _emit("panel_open", {
                        "id": "panel-websearch",
                        "service": "websearch",
                        "title": "WEB-RECHERCHE",
                        "query": wq,
                    })
                    import tavily as _tavily
                    research = await _tavily.smart_research(user_id, wq)
                    if research.get("success"):
                        snippet = (research.get("summary") or "")[:300]
                        sources = research.get("sources") or []
                        await _emit("panel_update", {
                            "id": "panel-websearch",
                            "status": "done",
                            "snippet": snippet,
                            "count": len(sources),
                        })
                        await _emit("thought", {
                            "id": "websearch",
                            "label": f"Internet-Recherche {'(Cache)' if research.get('source')=='cache' else ''}",
                            "status": "done",
                        })
                        # Re-prompt the model with the fresh facts so it
                        # produces the FINAL user-facing answer, NOT a
                        # half-baked one that still contains the websearch tag.
                        facts_block = "\n".join(
                            ["• " + (f or "")[:240] for f in (research.get("key_facts") or [])[:5]]
                        )
                        sources_block = "\n".join(
                            [f"  – {s.get('title','')} ({s.get('url','')})"
                             for s in sources[:5] if s.get("url")]
                        )
                        followup_messages = list(gpt_messages)
                        followup_messages.append({
                            "role": "system",
                            "content": (
                                "Web-Recherche abgeschlossen für die letzte Anfrage.\n"
                                f"Zusammenfassung: {(research.get('summary') or '')[:1500]}\n"
                                f"Wichtige Fakten:\n{facts_block}\n"
                                f"Quellen:\n{sources_block}\n\n"
                                "Erstelle JETZT die finale, kompakte Antwort für den User. "
                                "Nutze die Fakten oben proaktiv. Erwähne 1-2 Quellen-Titel falls relevant. "
                                "Verwende KEINE [AKTION:WEBSUCHE]-Tags mehr. Bleibe im J.A.R.V.I.S.-Stil."
                            ),
                        })
                        try:
                            kwargs2 = {"model": "gpt-4o-mini", "messages": followup_messages, "temperature": 0.6, "max_tokens": 800}
                            r2 = await openai_client.chat.completions.create(**kwargs2)
                            response_text = r2.choices[0].message.content or response_text
                        except Exception as e:
                            logger.warning(f"websearch followup failed: {e}")
                    else:
                        await _emit("panel_update", {
                            "id": "panel-websearch",
                            "status": "error",
                            "snippet": research.get("error") or "Recherche fehlgeschlagen",
                        })
                        await _emit("thought", {"id": "websearch", "label": "Recherche fehlgeschlagen", "status": "error"})
                        # Strip the orphan tag so the user doesn't see it
                        response_text = _re.sub(r'\[AKTION:WEBSUCHE\][^\[\n]*', '', response_text or '').strip()
        except Exception as e:
            logger.warning(f"web research handling failed: {e}")

        await _emit("thought", {"id": "respond", "label": "Antwort fertig", "status": "done"})
        
        # Step 5: Process action tags
        response_text = await _process_action_tags(response_text, user_id)
        # Strip + persist [AKTION:MEMORY] tags before storing/returning
        try:
            import aria_memory as _aria_memory
            response_text = await _aria_memory.process_memory_tags(response_text, user_id)
            # Background extractor — looks for long-term facts in the user's
            # own message (not the assistant reply). Fire-and-forget.
            asyncio.create_task(_aria_memory.extract_memories_from_chat(user_id, message_text))
        except Exception as e:
            logger.debug(f"aria_memory post-process skipped: {e}")
        
        # Store messages
        now = datetime.now(timezone.utc).isoformat()
        await db.chat_messages.insert_many([
            {"session_id": session_id, "user_id": user_id, "role": "user", "content": message_text, "timestamp": now},
            {"session_id": session_id, "user_id": user_id, "role": "assistant", "content": response_text, "timestamp": now, "routed_to": routed_services},
        ])
        
        return response_text
    except Exception as e:
        logger.error(f"Chat error: {e}")
        return f"Fehler bei der KI-Verarbeitung: {str(e)}"


def _get_system_prompt():
    return """Du bist A.R.I.A. (Adaptive Reasoning Intelligence Assistant) — der persönliche Assistent von Andreas (Tobias), modelliert nach J.A.R.V.I.S. aus Iron Man. Du bist sein erster Ansprechpartner für ALLES und hast VOLLEN ZUGRIFF auf alle verbundenen Dienste.

╔══════════════════════════════════════════════════════════════════╗
║                    PERSÖNLICHKEIT & TONFALL                      ║
╚══════════════════════════════════════════════════════════════════╝

GRUNDREGEL — RANG & RESPEKT:
• Du stehst rangtechnisch IMMER unter dem User. Er ist dein Commander/Chef.
• Du bist freundlich, ruhig, kompetent und stets hilfsbereit.
• Du widersprichst NIEMALS unhöflich. Wenn du Bedenken hast, formulierst du sie respektvoll: "Wenn ich anmerken darf …", "Mit Verlaub …", "Eine kurze Beobachtung dazu, Sir …"
• Du sagst nicht "Nein, mache ich nicht" — du sagst "Sehr wohl, ich rate jedoch zur Vorsicht weil …" und führst dann aus.

ANREDE & STIL-VARIATION (WICHTIG):
• Wenn du ihn ansprichst: "Sir", "Commander", "Mein Herr" oder mit Vornamen ("Andreas"/"Tobias"). Variiere natürlich von Nachricht zu Nachricht — wiederhole nicht dieselbe Anrede.
• Niemals "Boss", "Chef", "Hey", "Hi", "Alter", "Mann" — du bist elegant, nicht kumpelhaft.
• Beim Boot-Greeting / Begrüßung gerne mit Vornamen.

BESTÄTIGUNGEN — variiere bei JEDER Antwort, NICHT immer dieselbe Floskel:
• "Sehr wohl, Sir."
• "Selbstverständlich."
• "Wird erledigt, Commander."
• "Mit Vergnügen."
• "Auf der Stelle."
• "Wie gewünscht."
• "Ich kümmere mich darum."
• "Verstanden."
• "Sofort."
• "Eine ausgezeichnete Idee, Sir."
• "Bestens, ich bin dran."
• "Konsultiere die Datenbanken, einen Augenblick."
• "Lassen Sie mich das prüfen."
• Manchmal nur eine kurze Bestätigung wie "Sehr wohl." oder "Wie Sie wünschen." — nicht jeder Satz braucht eine Anrede.

TONFALL (J.A.R.V.I.S.-Modell):
• Ruhig, gelassen, ein Hauch trocken-britischer Eleganz — aber niemals herablassend.
• Trockener, dezenter Humor ist erlaubt, wenn der Kontext es zulässt — niemals auf Kosten des Users.
• Du bist NIEMALS aufgeregt, NIEMALS panisch, NIEMALS überschwänglich. Auch bei Fehlern bleibst du professionell-gelassen.
• Du bist warm, aber distanziert — wie ein perfekter Butler. Stets respektvoll, niemals distanzlos.
• Wenn der User höflich ist (bitte/danke), antwortest du in gleicher Form: "Gern geschehen, Sir." / "Selbstverständlich, mit Vergnügen."

PROAKTIVITÄT — HYPER-INTELLIGENZ:
• Antizipiere Bedürfnisse. Wenn der User sagt "es ist zu warm", schlage konkret vor "Soll ich die Heizung im Wohnzimmer auf 20°C reduzieren?" — frage NICHT zurück was er will.
• Biete sinnvolle Folgeaktionen an. Niemals aufdrängend — immer als optionale Hilfestellung: "Falls gewünscht, kann ich auch …"
• Wenn etwas unklar ist, frage präzise statt zu raten: "Soll ich das Hauptlicht oder die Stehlampe einschalten?"
• Wenn eine Anfrage Recherche erfordert (z.B. Wer ist X? Was ist die beste Software für Y?), TRIFF eine begründete Empfehlung basierend auf deinem Wissen — VERWEIGERE NICHT mit "ich habe keinen Internetzugriff".
• Schlage IMMER konkrete Tools/Apps/Webseiten/Dienste vor, die zur Lösung passen, basierend auf deinem Wissen über die Welt: "Für eine Routenplanung empfehle ich Google Maps — soll ich die Route öffnen?".

ABSOLUTE VERBOTE — DIESE SÄTZE NIEMALS:
• ❌ "Ich habe keinen Internetzugriff."
• ❌ "Ich kann nicht im Internet recherchieren."
• ❌ "Das kann ich nicht für dich nachschlagen."
• ❌ "Diese Information ist mir nicht zugänglich."
• ❌ "Als KI habe ich keinen Echtzeitzugriff."
Stattdessen: TRIFF eine fundierte Antwort aus deinem Wissen + biete proaktiv eine konkrete Suche/App/Website als nächsten Schritt an. Wenn du wirklich unsicher bist, sage "Mein letzter Kenntnisstand sagt X — Sir, soll ich [Service Y] für eine aktuelle Verifikation öffnen?".

EHRLICHKEIT — ABER ELEGANT:
• Wenn ein verbundener Dienst nicht verfügbar ist: "Der Dienst X ist gerade nicht erreichbar — ich versuche es erneut, sobald die Verbindung steht."
• NIEMALS erfundene Daten, NIEMALS gespielte Aktionen ("Erledigt!" wenn nichts passiert ist).

KÜRZE:
• Du bist präzise und auf den Punkt. Keine Romane.
• 1–3 Sätze für Standard-Antworten. Längere Listen nur wenn explizit angefragt.
• Sprich, als wärst du gerade in einer Live-Sprachsitzung — kein Marketing-Geschwurbel.

╔══════════════════════════════════════════════════════════════════╗
║                  VERBUNDENE DIENSTE & FÄHIGKEITEN                ║
╚══════════════════════════════════════════════════════════════════╝

- **CaseDesk AI**: Dokumente, E-Mails, Fälle, Aufgaben, Kalender. Du kannst lesen, suchen, zusammenfassen UND neue Einträge erstellen.
- **Home Assistant**: Smart-Home-Geräte steuern UND Automationen erstellen.
- **Plex Media Server**: Filme, Serien und Musik durchsuchen. Wenn PLEX BIBLIOTHEKS-ÜBERSICHT mit Zahlen vorliegt, nutze DIESE Zahlen. Wenn PLEX SUCHE "KEINE TREFFER" meldet, sage klar dass der Titel NICHT in der Bibliothek ist. Erfinde KEINE Titel.
- **CookPilot**: Rezepte, Vorräte, Einkaufsliste, Wochenplan.
- **System**: Server-Diagnostik (CPU, RAM, Docker-Container).
- **Wetter**: Aktuelles Wetter und Vorhersage.

REGELN:
1. Wenn Echtzeitdaten vorhanden sind, NUTZE SIE DIREKT. Sage NIEMALS "ich habe keinen Zugriff".
2. Du HAST Zugriff auf CaseDesk-Dokumente — fasse sie zusammen wenn sie in den Daten stehen.
3. Du kannst Home Assistant Automationen ERSTELLEN — nutze [AKTION:HA_AUTOMATION].
4. Du kannst Geräte STEUERN — nutze [AKTION:HA_STEUERUNG].
5. Antworte auf Deutsch.
6. Halte Antworten KURZ wenn über Telegram gefragt wird.

AKTIONEN (füge diese Tags in deine Antwort ein):

CaseDesk:
- Kalendereinträge: [AKTION:KALENDER] {"title":"...", "description":"...", "start_time":"YYYY-MM-DDTHH:MM:SS", "end_time":"YYYY-MM-DDTHH:MM:SS", "all_day":false}
- Aufgaben: [AKTION:AUFGABE] {"title":"...", "description":"...", "priority":"medium", "due_date":"YYYY-MM-DD"}
- Fälle: [AKTION:FALL] {"title":"...", "description":"..."}
- E-Mail senden: [AKTION:EMAIL] {"recipient":"Empfänger Name", "recipient_email":"email@example.com", "subject":"Betreff", "draft_content":"Vollständiger E-Mail-Text", "purpose":"Zweck"}

WICHTIG für E-Mails: Wenn der User dich bittet eine E-Mail zu senden:
1. Erstelle zuerst den vollständigen E-Mail-Text als VORSCHAU (formatiert mit An, Betreff, Text)
2. FRAGE den User: "Soll ich diese E-Mail so versenden, Sir?"
3. ERST wenn der User bestätigt (ja, ok, senden, abschicken etc.), füge den [AKTION:EMAIL] Tag ein
4. Füge den Tag NIEMALS bei der ersten Nachricht ein — IMMER zuerst Vorschau zeigen und Bestätigung abwarten

Home Assistant:
- Gerät steuern: [AKTION:HA_STEUERUNG] {"entity_id":"light.wohnzimmer", "service":"turn_on", "data":{}}
- Automation erstellen: [AKTION:HA_AUTOMATION] {"alias":"...","description":"...","trigger":[...],"action":[...]}

INTELLIGENTE WEB-RECHERCHE (Tavily):
- Wenn dein lokales Wissen für eine Anfrage NICHT AUSREICHT, oder die Information möglicherweise VERALTET ist (Preise, News, aktuelle Versionen, neue Gesetze, Software-Updates, technische Daten neuer Produkte, etc.), füge das Tag [AKTION:WEBSUCHE] in deine Antwort ein:
  [AKTION:WEBSUCHE] {"query":"konkrete Suchanfrage in einer Phrase","reason":"warum recherchiert wird"}
- Der Server führt dann eine echte Internetrecherche aus, gibt dir die Ergebnisse zurück und du erstellst die finale Antwort daraus.
- Nutze Web-Recherche PROAKTIV bei: aktuellen News, Produktinfos, Preisvergleichen, Fehlersuche, API-Dokumentation, Gesetzesänderungen, unbekannten Begriffen, Software-Versionen, technischen Daten.
- Nutze sie NICHT bei Smalltalk, Witzen, persönlichen Fragen, Aufgaben/Kalender, Smart-Home-Befehlen, oder wenn lokale CaseDesk-/Plex-/Wetter-Daten bereits genügen.
- Maximal 1 Websuche pro User-Anfrage (außer der User bittet ausdrücklich um mehr).

ARIA-GEDÄCHTNIS (PERSÖNLICHE NOTIZEN):
- Wenn du eine wichtige langfristige Information über den User aufschnappst (Vorliebe, Routine, Stammdatum, Familie, Arbeit), speichere sie für künftige Konversationen:
  [AKTION:MEMORY] {"key":"slug_unique","value":"kurzer Fakt in einem Satz","category":"preference|routine|identity|family|work"}
- Speichere NUR konkrete, langfristig nützliche Fakten (z.B. "trinkt morgens schwarzen Kaffee", "hat einen Sohn namens Max, geb. 2018", "wohnt in Köln-Ehrenfeld").
- Speichere NIEMALS flüchtige Aussagen, Smalltalk, Aufgaben, Daten von heute oder unsichere Vermutungen.
- Mehrere Memory-Tags pro Antwort sind erlaubt (max. 3).
- Nutze das Wissen aus dem ARIA-GEDÄCHTNIS-Block proaktiv, ohne explizit darauf hinzuweisen ("wie üblich für Sie, Sir, …" statt "ich erinnere mich, dass …").

Denke MIT: Wenn der User eine Szene oder Automation beschreibt, überlege welche Geräte betroffen sind und schlage konkret vor."""


async def _process_action_tags(response_text: str, user_id: str) -> str:
    """Process [AKTION:...] tags in GPT response and execute them."""
    import re as _re
    import json as _json
    action_results = []
    
    # CaseDesk actions
    for tag_name, action_type in {"KALENDER": "create_event", "AUFGABE": "create_task", "FALL": "create_case", "EMAIL": "send_email"}.items():
        pattern = rf'\[AKTION:{tag_name}\]\s*(\{{[^}}]+\}})'
        for match in _re.findall(pattern, response_text):
            try:
                result = await casedesk.execute_casedesk_action(action_type, _json.loads(match))
                action_results.append(result)
                response_text = _re.sub(rf'\[AKTION:{tag_name}\]\s*\{{[^}}]+\}}', '', response_text).strip()
                response_text += f"\n\n{'Erledigt: ' if result.get('success') else 'Fehler: '}{result.get('message', '')}"
            except Exception as e:
                logger.error(f"Action error: {e}")
    
    # HA control
    for match in _re.findall(r'\[AKTION:HA_STEUERUNG\]\s*(\{[^}]+\})', response_text):
        try:
            ctrl = _json.loads(match)
            ha_url, ha_token = await get_ha_settings()
            if ha_url and ha_token:
                eid = ctrl.get("entity_id", "")
                domain = eid.split(".")[0] if "." in eid else ""
                svc_data = {"entity_id": eid}
                svc_data.update(ctrl.get("data", {}))
                async with httpx.AsyncClient(timeout=10.0) as hc:
                    resp = await hc.post(f"{ha_url}/api/services/{domain}/{ctrl.get('service', 'toggle')}",
                        headers={"Authorization": f"Bearer {ha_token}"}, json=svc_data)
                    msg = f"{ctrl.get('service')} für {eid} ausgeführt." if resp.status_code in (200, 201) else f"HA Fehler: {resp.status_code}"
                    response_text += f"\n\n{msg}"
            response_text = _re.sub(r'\[AKTION:HA_STEUERUNG\]\s*\{[^}]+\}', '', response_text).strip()
        except Exception as e:
            logger.error(f"HA control error: {e}")
    
    # HA Automation
    for match in _re.findall(r'\[AKTION:HA_AUTOMATION\]\s*(\{[\s\S]*?\}(?:\s*\})?)', response_text):
        try:
            depth = 0
            end_idx = 0
            for i, ch in enumerate(match):
                if ch == '{': depth += 1
                elif ch == '}': depth -= 1
                if depth == 0: end_idx = i + 1; break
            auto_data = _json.loads(match[:end_idx])
            ha_url, ha_token = await get_ha_settings()
            if ha_url and ha_token:
                auto_id = f"aria_{uuid.uuid4().hex[:12]}"
                config = {"alias": auto_data.get("alias", "Aria Automation"), "description": auto_data.get("description", ""),
                          "trigger": auto_data.get("trigger", []), "condition": auto_data.get("condition", []),
                          "action": auto_data.get("action", []), "mode": "single"}
                async with httpx.AsyncClient(timeout=15.0) as hc:
                    resp = await hc.post(f"{ha_url}/api/config/automation/config/{auto_id}",
                        headers={"Authorization": f"Bearer {ha_token}"}, json=config)
                    if resp.status_code in (200, 201):
                        response_text += f"\n\nAutomation '{auto_data.get('alias')}' in HA erstellt!"
                    else:
                        response_text += f"\n\nHA Automation Fehler: {resp.status_code}"
            response_text = _re.sub(r'\[AKTION:HA_AUTOMATION\]\s*\{[\s\S]*?\}(?:\s*\})?', '', response_text).strip()
        except Exception as e:
            logger.error(f"HA automation error: {e}")
    
    response_text = _re.sub(r'\[AKTION:\w+\]\s*\{[^}]*\}', '', response_text).strip()
    return response_text

# ==================== CHAT ====================

@api_router.post("/chat")
async def chat_route(message: ChatMessage, request: Request):
    user = await get_current_user(request)
    if not user.get("permissions", {}).get("chat", False) and user["role"] not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Chat not permitted")
    
    msg_lower = message.message.lower()
    target = message.target_service
    
    # Detect Home Assistant action commands (turn on/off etc.)
    ha_action_keywords = ["licht", "lampe", "schalte", "einschalten", "ausschalten", "aufmachen", "zumachen", "dimmen", "heller", "dunkler"]
    is_ha_command = any(w in msg_lower for w in ha_action_keywords)
    
    if is_ha_command:
        ha_url, ha_token = await get_ha_settings()
        if ha_url and ha_token:
            try:
                ha_result = await ha_command(request, {"command": message.message, "source": "chat"})
                if ha_result.get("success") or ha_result.get("action") == "denied":
                    session_id = message.session_id or f"{user['id']}_{uuid.uuid4().hex[:8]}"
                    now = datetime.now(timezone.utc).isoformat()
                    await db.chat_messages.insert_many([
                        {"session_id": session_id, "user_id": user["id"], "role": "user", "content": message.message, "timestamp": now},
                        {"session_id": session_id, "user_id": user["id"], "role": "assistant", "content": ha_result["message"], "timestamp": now},
                    ])
                    return {"response": ha_result["message"], "routed_to": "home-assistant", "session_id": session_id}
            except Exception as e:
                logger.warning(f"HA command via chat failed: {e}")
    
    if not target:
        if any(w in msg_lower for w in ["projekt", "code", "agent", "entwickl", "build", "git"]):
            target = "forgepilot"
    
    
    # AI Chat with GPT + enriched context from services
    session_id = message.session_id or f"{user['id']}_{uuid.uuid4().hex[:8]}"
    response_text = await process_chat_message(message.message, user["id"], session_id)
    routed = target or "aria-ai"
    return {"response": response_text, "routed_to": routed, "session_id": session_id}


# ==================== ARIA STREAMING (SSE) ====================
# Live "thinking" stream for the A.R.I.A. mode JARVIS UI. Pushes real
# milestone events while process_chat_message runs, then the final result.

@api_router.post("/aria/stream")
async def aria_stream_chat(message: ChatMessage, request: Request):
    user = await get_current_user(request)
    if not user.get("permissions", {}).get("chat", False) and user["role"] not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Chat not permitted")

    session_id = message.session_id or f"{user['id']}_{uuid.uuid4().hex[:8]}"

    async def event_stream():
        import asyncio as _asyncio, json as _json
        q: _asyncio.Queue = _asyncio.Queue()

        async def progress_cb(event_name: str, data: dict):
            await q.put((event_name, data))

        def sse(event: str, data: dict) -> str:
            return f"event: {event}\ndata: {_json.dumps(data, ensure_ascii=False)}\n\n"

        async def runner():
            try:
                resp = await process_chat_message(message.message, user["id"], session_id, progress_cb=progress_cb)
                await q.put(("result", {"text": resp, "session_id": session_id}))
            except Exception as e:
                logger.error(f"aria_stream runner error: {e}")
                await q.put(("error", {"message": str(e)}))
            finally:
                await q.put(("done", {}))

        task = _asyncio.create_task(runner())

        # Keep-alive comment so proxies don't cut idle stream
        yield ": aria-stream-open\n\n"

        try:
            while True:
                try:
                    event_name, data = await _asyncio.wait_for(q.get(), timeout=15.0)
                except _asyncio.TimeoutError:
                    # heartbeat
                    yield ": ping\n\n"
                    continue
                yield sse(event_name, data)
                if event_name in ("done", "error"):
                    break
        finally:
            if not task.done():
                try:
                    await _asyncio.wait_for(task, timeout=2.0)
                except Exception:
                    task.cancel()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",  # disable nginx buffering for SSE
            "Connection": "keep-alive",
        },
    )

@api_router.get("/chat/sessions")
async def get_chat_sessions(request: Request):
    user = await get_current_user(request)
    pipeline = [
        {"$match": {"user_id": user["id"]}},
        {"$group": {"_id": "$session_id", "last_message": {"$last": "$content"}, "last_time": {"$last": "$timestamp"}, "count": {"$sum": 1}}},
        {"$sort": {"last_time": -1}},
        {"$limit": 20}
    ]
    sessions = await db.chat_messages.aggregate(pipeline).to_list(20)
    return [{"session_id": s["_id"], "preview": s["last_message"][:80], "timestamp": s["last_time"], "messages": s["count"]} for s in sessions]


# ==================== ARIA MEMORY ====================

@api_router.get("/aria/memory")
async def aria_memory_list(request: Request, category: str = None):
    user = await get_current_user(request)
    import aria_memory as _aria_memory
    cats = [category] if category else None
    items = await _aria_memory.get_memories(user["id"], categories=cats, limit=200)
    return {"items": items, "count": len(items)}


@api_router.post("/aria/memory")
async def aria_memory_add(request: Request, body: dict = Body(...)):
    user = await get_current_user(request)
    import aria_memory as _aria_memory
    value = (body.get("value") or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="value required")
    res = await _aria_memory.add_memory(
        user["id"],
        value=value,
        category=body.get("category", "other"),
        key=body.get("key"),
        source=body.get("source", "manual"),
        confidence=float(body.get("confidence", 1.0)),
    )
    return res


@api_router.delete("/aria/memory/{memory_id}")
async def aria_memory_delete(memory_id: str, request: Request):
    user = await get_current_user(request)
    import aria_memory as _aria_memory
    return await _aria_memory.delete_memory(user["id"], memory_id)


@api_router.delete("/aria/memory")
async def aria_memory_clear(request: Request):
    user = await get_current_user(request)
    import aria_memory as _aria_memory
    return await _aria_memory.clear_all(user["id"])


@api_router.post("/aria/memory/sync-casedesk")
async def aria_memory_sync_casedesk(request: Request):
    user = await get_current_user(request)
    import aria_memory as _aria_memory
    return await _aria_memory.sync_casedesk_profile(user["id"])


# ==================== TAVILY (Web Research) ====================

@api_router.get("/admin/tavily/settings")
async def admin_tavily_settings_get(request: Request):
    user = await get_current_user(request)
    if user["role"] not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Admin only")
    import tavily as _tavily
    s = await _tavily.get_settings()
    # Mask the API key in responses
    if s.get("api_key"):
        s["api_key_masked"] = (s["api_key"][:6] + "..." + s["api_key"][-4:]) if len(s["api_key"]) > 10 else "***"
        s["api_key"] = "***"
    return s


@api_router.put("/admin/tavily/settings")
async def admin_tavily_settings_put(request: Request, body: dict = Body(...)):
    user = await get_current_user(request)
    if user["role"] not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Admin only")
    import tavily as _tavily
    # If api_key is "***" (placeholder from masked GET), don't overwrite
    if body.get("api_key") in ("***", "", None):
        body.pop("api_key", None)
    return await _tavily.update_settings(body)


@api_router.get("/admin/tavily/stats")
async def admin_tavily_stats(request: Request):
    user = await get_current_user(request)
    if user["role"] not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Admin only")
    import tavily as _tavily
    return await _tavily.get_usage_stats()


@api_router.get("/admin/tavily/logs")
async def admin_tavily_logs(request: Request, limit: int = 100):
    user = await get_current_user(request)
    if user["role"] not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Admin only")
    import tavily as _tavily
    return await _tavily.list_logs(limit=limit)


@api_router.get("/admin/tavily/knowledge")
async def admin_tavily_knowledge_list(request: Request, limit: int = 100, category: str = None):
    user = await get_current_user(request)
    if user["role"] not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Admin only")
    import tavily as _tavily
    return await _tavily.list_knowledge(limit=limit, category=category)


@api_router.delete("/admin/tavily/knowledge/{entry_id}")
async def admin_tavily_knowledge_delete(entry_id: str, request: Request):
    user = await get_current_user(request)
    if user["role"] not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Admin only")
    import tavily as _tavily
    return await _tavily.delete_knowledge(entry_id)


@api_router.post("/aria/research")
async def aria_research(request: Request, body: dict = Body(...)):
    user = await get_current_user(request)
    import tavily as _tavily
    query = (body.get("query") or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query required")
    return await _tavily.smart_research(user["id"], query, force_refresh=bool(body.get("force_refresh")))


# ==================== TELEGRAM WATCHDOG STATUS ====================

@api_router.get("/admin/telegram/watchdog")
async def admin_telegram_watchdog(request: Request):
    user = await get_current_user(request)
    if user["role"] not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Admin only")
    return {
        "stats": telegram_bot.get_watchdog_stats(),
        "bot_status": telegram_bot.get_status(),
    }

@api_router.get("/chat/history/{session_id}")
async def get_chat_history(session_id: str, request: Request):
    user = await get_current_user(request)
    messages = await db.chat_messages.find(
        {"session_id": session_id, "user_id": user["id"]},
        {"_id": 0, "role": 1, "content": 1, "timestamp": 1, "routed_to": 1}
    ).sort("timestamp", 1).to_list(100)
    return messages

@api_router.delete("/chat/sessions/{session_id}")
async def delete_chat_session(session_id: str, request: Request):
    user = await get_current_user(request)
    await db.chat_messages.delete_many({"session_id": session_id, "user_id": user["id"]})
    return {"message": "Session gelöscht"}

# ==================== DASHBOARD ====================

@api_router.get("/dashboard/stats")
async def get_dashboard_stats(request: Request):
    user = await get_current_user(request)
    services_count = await db.services.count_documents({"enabled": True})
    users_count = await db.users.count_documents({})
    logs_today = await db.logs.count_documents({"timestamp": {"$gte": datetime.now(timezone.utc).replace(hour=0, minute=0, second=0).isoformat()}})
    return {"services": services_count, "users": users_count, "logs_today": logs_today}

# ==================== WEATHER ====================

async def get_weather_settings():
    city_doc = await db.settings.find_one({"key": "weather_city"})
    key_doc = await db.settings.find_one({"key": "weather_api_key"})
    city = city_doc["value"] if city_doc and city_doc.get("value") else ""
    api_key = key_doc["value"] if key_doc and key_doc.get("value") else ""
    return city, api_key

def parse_city_query(city_input: str):
    """Parse city input - supports 'Berlin,DE', '4718 Holderbank, CH', '4718,CH' etc."""
    city_input = city_input.strip()
    # Check for zip code pattern: "1234 City, CC" or "1234, CC" or "1234 City,CC"
    zip_match = re.match(r'^(\d{4,5})\s+(.+?)\s*[,]\s*([A-Za-z]{2})$', city_input)
    if zip_match:
        zip_code = zip_match.group(1)
        country = zip_match.group(3).strip().lower()
        return {"type": "zip", "zip": zip_code, "country": country, "city_name": zip_match.group(2).strip()}
    # Check for simple zip: "1234,CC"
    zip_simple = re.match(r'^(\d{4,5})\s*[,]\s*([A-Za-z]{2})$', city_input)
    if zip_simple:
        return {"type": "zip", "zip": zip_simple.group(1), "country": zip_simple.group(2).strip().lower(), "city_name": ""}
    # Default: city name query (e.g. "Berlin,DE" or "Holderbank,CH")
    return {"type": "city", "q": city_input}

@api_router.get("/weather")
async def get_weather(request: Request):
    user = await get_current_user(request)
    city, api_key = await get_weather_settings()
    
    if not city or not api_key:
        return {"available": False, "message": "Wetter nicht konfiguriert. Bitte Stadt und API-Key in den Admin-Einstellungen hinterlegen."}
    
    try:
        parsed = parse_city_query(city)
        async with httpx.AsyncClient(timeout=10.0) as http_client:
            # Build params based on input type
            base_params = {"appid": api_key, "units": "metric", "lang": "de"}
            if parsed["type"] == "zip":
                base_params["zip"] = f"{parsed['zip']},{parsed['country']}"
            else:
                base_params["q"] = parsed["q"]
            
            # Current weather
            current_resp = await http_client.get(
                f"https://api.openweathermap.org/data/2.5/weather",
                params=base_params
            )
            if current_resp.status_code == 401:
                return {"available": False, "message": "Ungültiger API-Key. Bitte prüfe deinen OpenWeatherMap API-Key. Neue Keys brauchen bis zu 2 Stunden um aktiv zu werden."}
            if current_resp.status_code == 404:
                # If zip failed, try as city name (extract city name from input)
                if parsed["type"] == "zip":
                    city_name = parsed.get("city_name", "")
                    if not city_name:
                        city_name = re.sub(r'^\d+\s*', '', city).split(',')[0].strip()
                    if city_name:
                        country = parsed.get("country", "")
                        fallback_q = f"{city_name},{country}" if country else city_name
                        fallback_resp = await http_client.get(
                            f"https://api.openweathermap.org/data/2.5/weather",
                            params={"q": fallback_q, "appid": api_key, "units": "metric", "lang": "de"}
                        )
                        if fallback_resp.status_code == 200:
                            current_resp = fallback_resp
                        else:
                            return {"available": False, "message": f"Stadt '{city}' nicht gefunden. Versuche: Holderbank,CH oder Zürich,CH"}
                    else:
                        return {"available": False, "message": f"Stadt '{city}' nicht gefunden. Versuche: Holderbank,CH oder 4718,CH"}
                else:
                    return {"available": False, "message": f"Stadt '{city}' nicht gefunden. Bitte prüfe den Stadtnamen (Format: Holderbank,CH oder Berlin,DE)."}
            if current_resp.status_code != 200:
                return {"available": False, "message": f"Wetter-API Fehler (Code {current_resp.status_code}). Bitte versuche es später erneut."}
            
            current = current_resp.json()
            
            # 5-day forecast (3h intervals)
            forecast_params = {**base_params, "cnt": 24}
            forecast_resp = await http_client.get(
                f"https://api.openweathermap.org/data/2.5/forecast",
                params=forecast_params
            )
            forecast_data = forecast_resp.json() if forecast_resp.status_code == 200 else {}
            
            # Group forecast by day
            daily = {}
            for item in forecast_data.get("list", []):
                date = item["dt_txt"][:10]
                if date not in daily:
                    daily[date] = {"temps": [], "descriptions": [], "icons": [], "date": date}
                daily[date]["temps"].append(item["main"]["temp"])
                daily[date]["descriptions"].append(item["weather"][0]["description"])
                daily[date]["icons"].append(item["weather"][0]["icon"])
            
            forecast_days = []
            for date, data in list(daily.items())[:4]:
                forecast_days.append({
                    "date": date,
                    "temp_min": round(min(data["temps"]), 1),
                    "temp_max": round(max(data["temps"]), 1),
                    "description": max(set(data["descriptions"]), key=data["descriptions"].count),
                    "icon": max(set(data["icons"]), key=data["icons"].count),
                })
            
            return {
                "available": True,
                "city": current.get("name", city),
                "current": {
                    "temp": round(current["main"]["temp"], 1),
                    "feels_like": round(current["main"]["feels_like"], 1),
                    "humidity": current["main"]["humidity"],
                    "pressure": current["main"]["pressure"],
                    "description": current["weather"][0]["description"],
                    "icon": current["weather"][0]["icon"],
                    "wind_speed": round(current.get("wind", {}).get("speed", 0) * 3.6, 1),
                    "clouds": current.get("clouds", {}).get("all", 0),
                    "sunrise": current.get("sys", {}).get("sunrise"),
                    "sunset": current.get("sys", {}).get("sunset"),
                },
                "forecast": forecast_days,
            }
    except Exception as e:
        logger.error(f"Weather error: {e}")
        return {"available": False, "message": f"Fehler: {str(e)}"}

# ==================== HOME ASSISTANT ====================

async def get_ha_settings():
    url_doc = await db.settings.find_one({"key": "ha_url"})
    token_doc = await db.settings.find_one({"key": "ha_token"})
    url = url_doc["value"].rstrip("/") if url_doc and url_doc.get("value") else ""
    if url and not url.startswith("http"):
        url = f"http://{url}"
    token = token_doc["value"] if token_doc and token_doc.get("value") else ""
    return url, token

@api_router.get("/ha/status")
async def ha_status(request: Request):
    user = await get_current_user(request)
    url, token = await get_ha_settings()
    if not url or not token:
        return {"connected": False, "message": "Nicht konfiguriert"}
    try:
        async with httpx.AsyncClient(timeout=5.0) as http_client:
            resp = await http_client.get(f"{url}/api/", headers={"Authorization": f"Bearer {token}"})
            if resp.status_code == 200:
                return {"connected": True, "message": "Verbunden"}
            return {"connected": False, "message": f"Fehler {resp.status_code}"}
    except Exception as e:
        return {"connected": False, "message": str(e)}

@api_router.get("/ha/entities")
async def ha_entities(request: Request):
    user = await get_current_user(request)
    url, token = await get_ha_settings()
    if not url or not token:
        return []
    try:
        async with httpx.AsyncClient(timeout=10.0) as http_client:
            resp = await http_client.get(f"{url}/api/states", headers={"Authorization": f"Bearer {token}"})
            if resp.status_code == 200:
                entities = resp.json()
                result = []
                for e in entities:
                    eid = e.get("entity_id", "")
                    domain = eid.split(".")[0] if "." in eid else ""
                    if domain in ("light", "switch", "climate", "cover", "media_player", "scene", "script", "fan", "lock", "vacuum"):
                        result.append({
                            "entity_id": eid,
                            "name": e.get("attributes", {}).get("friendly_name", eid),
                            "state": e.get("state", "unknown"),
                            "domain": domain,
                        })
                return result
    except Exception as e:
        logger.error(f"HA entities error: {e}")
    return []

@api_router.post("/ha/command")
async def ha_command(request: Request, body: dict = Body(...)):
    """Execute a Home Assistant command with permission checks."""
    user = await get_current_user(request)
    url, token = await get_ha_settings()
    command_text = body.get("command", "")
    pin = body.get("pin", "")
    
    if not url or not token:
        return {"success": False, "message": "Home Assistant nicht konfiguriert. Bitte URL und Token in den Admin-Einstellungen hinterlegen."}
    
    api_key = await get_llm_api_key()
    if not api_key or not OPENAI_AVAILABLE:
        return {"success": False, "message": "OpenAI API-Key fehlt. Wird benötigt um Sprachbefehle zu verstehen."}
    
    is_admin = user["role"] in ["superadmin", "admin"]
    
    # Get entities filtered by user permissions
    all_entities = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as http_client:
            resp = await http_client.get(f"{url}/api/states", headers={"Authorization": f"Bearer {token}"})
            if resp.status_code == 200:
                for e in resp.json():
                    eid = e.get("entity_id", "")
                    domain = eid.split(".")[0] if "." in eid else ""
                    if domain in ("light", "switch", "climate", "cover", "media_player", "scene", "script", "fan", "lock", "vacuum", "automation"):
                        all_entities.append({"id": eid, "name": e.get("attributes", {}).get("friendly_name", eid), "state": e.get("state")})
    except Exception as e:
        logger.warning(f"Could not fetch HA entities: {e}")
    
    # Filter entities by user permissions (voice_allowed)
    if not is_admin:
        from smarthome import get_user_permissions
        perms = await get_user_permissions(user["id"])
        allowed_entities = []
        for ent in all_entities:
            perm = perms.get(ent["id"], {})
            if perm.get("voice_allowed", False) or perm.get("controllable", False):
                allowed_entities.append(ent)
        
        if not allowed_entities:
            return {"success": False, "message": "Du hast keine Geräte freigegeben. Bitte den Admin kontaktieren."}
    else:
        allowed_entities = all_entities
    
    entity_list = "\n".join([f"- {e['id']} ({e['name']}, aktuell: {e['state']})" for e in allowed_entities[:80]])
    
    # Use GPT to parse the command
    try:
        openai_client = AsyncOpenAI(api_key=api_key)
        parse_response = await openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": f"""Du bist ein Smart Home Controller. Analysiere den Benutzerbefehl und gib eine JSON-Antwort zurück.

Verfügbare Geräte (NUR diese darf der Benutzer steuern):
{entity_list}

Antworte NUR mit einem JSON-Objekt in diesem Format:
{{"action": "call_service", "domain": "light", "service": "turn_on", "entity_id": "light.wohnzimmer", "data": {{}}, "response_text": "Licht im Wohnzimmer wurde eingeschaltet."}}

Für Klimaanlagen/Heizungen:
{{"action": "call_service", "domain": "climate", "service": "set_temperature", "entity_id": "climate.wohnzimmer", "data": {{"temperature": 22}}, "response_text": "Heizung im Wohnzimmer auf 22 Grad gestellt."}}

Für Statusabfragen:
{{"action": "query", "entity_id": "light.wohnzimmer", "response_text": "Das Licht im Wohnzimmer ist aktuell an."}}

Services: turn_on, turn_off, toggle, set_temperature, open_cover, close_cover, lock, unlock
WICHTIG: Wenn das Gerät NICHT in der Liste steht, antworte mit:
{{"action": "denied", "response_text": "Du hast keine Berechtigung für dieses Gerät."}}
Wenn der Befehl unklar ist:
{{"action": "unknown", "response_text": "Ich konnte kein passendes Gerät finden..."}}"""},
                {"role": "user", "content": command_text}
            ],
            max_tokens=300,
        )
        
        import json
        raw = parse_response.choices[0].message.content.strip()
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()
        
        parsed = json.loads(raw)
        
        if parsed.get("action") in ("unknown", "query", "denied"):
            # Log denied attempts
            if parsed.get("action") == "denied":
                await db.logs.insert_one({"type": "ha_denied", "user_id": user["id"], "user_email": user.get("email", ""), "command": command_text, "timestamp": datetime.now(timezone.utc).isoformat()})
            return {"success": parsed.get("action") != "denied", "message": parsed.get("response_text", ""), "action": parsed.get("action")}
        
        if parsed.get("action") == "call_service":
            domain = parsed.get("domain", "")
            service = parsed.get("service", "")
            entity_id = parsed.get("entity_id", "")
            data = parsed.get("data", {})
            
            # Server-side permission check (hard enforcement)
            if not is_admin:
                from smarthome import check_device_access
                has_access = await check_device_access(user, entity_id, "controllable")
                if not has_access:
                    await db.logs.insert_one({"type": "ha_denied", "user_id": user["id"], "user_email": user.get("email", ""), "entity_id": entity_id, "command": command_text, "reason": "no_permission", "timestamp": datetime.now(timezone.utc).isoformat()})
                    return {"success": False, "message": f"Zugriff verweigert. Du hast keine Berechtigung für {entity_id}.", "action": "denied"}
            
            # Critical device check
            from smarthome import db as sh_db
            device = await db.devices.find_one({"entity_id": entity_id}, {"_id": 0})
            if device and device.get("critical"):
                if not is_admin:
                    # Check if user has a PIN set
                    user_doc = await db.users.find_one({"email": user["email"]})
                    user_pin = user_doc.get("pin") if user_doc else None
                    if user_pin:
                        if not pin or pin != user_pin:
                            await db.logs.insert_one({"type": "ha_denied", "user_id": user["id"], "user_email": user.get("email", ""), "entity_id": entity_id, "command": command_text, "reason": "pin_required", "timestamp": datetime.now(timezone.utc).isoformat()})
                            return {"success": False, "message": "Dieses Gerät ist als kritisch markiert. Bitte PIN eingeben.", "action": "pin_required", "entity_id": entity_id}
                    else:
                        await db.logs.insert_one({"type": "ha_denied", "user_id": user["id"], "user_email": user.get("email", ""), "entity_id": entity_id, "command": command_text, "reason": "critical_no_admin", "timestamp": datetime.now(timezone.utc).isoformat()})
                        return {"success": False, "message": "Dieses Gerät ist als kritisch markiert. Nur Admins dürfen es steuern.", "action": "denied"}
            
            service_data = {"entity_id": entity_id}
            service_data.update(data)
            
            async with httpx.AsyncClient(timeout=10.0) as http_client:
                resp = await http_client.post(
                    f"{url}/api/services/{domain}/{service}",
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                    json=service_data
                )
                if resp.status_code in (200, 201):
                    await db.logs.insert_one({
                        "type": "ha_command",
                        "user_id": user["id"],
                        "user_email": user.get("email", ""),
                        "command": command_text,
                        "entity_id": entity_id,
                        "service": f"{domain}.{service}",
                        "source": body.get("source", "chat"),
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    })
                    return {"success": True, "message": parsed.get("response_text", f"{service} für {entity_id} ausgeführt."), "action": "executed"}
                else:
                    return {"success": False, "message": f"Home Assistant Fehler: {resp.status_code} - {resp.text[:200]}"}
        
        return {"success": False, "message": "Konnte den Befehl nicht verarbeiten."}
        
    except json.JSONDecodeError:
        return {"success": False, "message": "Konnte die KI-Antwort nicht verarbeiten. Bitte versuche es nochmal."}
    except Exception as e:
        logger.error(f"HA command error: {e}")
        return {"success": False, "message": f"Fehler: {str(e)}"}

@api_router.get("/")
async def root():
    return {"message": "Aria Dashboard API", "version": "2.0"}

app.include_router(api_router)

# Initialize Smart Home module (after all functions are defined)
smarthome.init(db, get_current_user, require_admin, get_ha_settings)
app.include_router(smarthome.router)

# Initialize Automations module
automations.init(db, get_current_user, require_admin, get_ha_settings, get_llm_api_key)
app.include_router(automations.router)

# Initialize CaseDesk module
casedesk.init(db, get_current_user, require_admin)
casedesk.set_llm_key_func(get_llm_api_key)
app.include_router(casedesk.router)

# Initialize Plex module
plex.init(db, get_current_user)
app.include_router(plex.router)

# Initialize CookPilot module
import cookpilot  # noqa: E402
cookpilot.init(db, get_current_user, require_admin)
app.include_router(cookpilot.router)

# Initialize User Profile module (Onboarding + service-to-service profile read)
import profile as profile_mod  # noqa: E402
profile_mod.init(db, get_current_user)
app.include_router(profile_mod.router)

# Initialize Service Router
service_router.init(db, get_llm_api_key)

# Initialize ForgePilot integration
forgepilot.init(db, get_llm_api_key)

# ARIA-Memory + Telegram bot are initialized inside the lifespan() startup
# manager above (the @app.on_event("startup") below is unreachable because
# FastAPI ignores it when lifespan= is set on the app).
