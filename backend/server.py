from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Body
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os
import logging
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
    
    await db.logs.insert_one({"type": "user_login", "user_id": user_id, "email": user["email"], "timestamp": datetime.now(timezone.utc).isoformat()})
    
    return {"id": user_id, "email": user["email"], "name": user.get("name", ""), "role": user.get("role", "user"), "theme": user.get("theme", "startrek"), "sound_effects_enabled": user.get("sound_effects_enabled", True), "allowed_services": user.get("allowed_services", []), "permissions": user.get("permissions", {}), "assigned_rooms": user.get("assigned_rooms", []), "visible_tabs": user.get("visible_tabs", DEFAULT_TABS), "access_token": access_token}

@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out"}

@api_router.get("/auth/me")
async def get_me(request: Request):
    return await get_current_user(request)

VALID_THEMES = {"startrek", "disney", "fortnite", "minesweeper"}
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
    {"id": "alloy", "name": "Alloy", "desc": "Neutral, freundlich"},
    {"id": "echo", "name": "Echo", "desc": "Warm, männlich"},
    {"id": "fable", "name": "Fable", "desc": "Erzählerisch, märchenhaft"},
    {"id": "nova", "name": "Nova", "desc": "Klar, weiblich"},
    {"id": "onyx", "name": "Onyx", "desc": "Tief, autoritär"},
    {"id": "shimmer", "name": "Shimmer", "desc": "Sanft, beruhigend"},
]

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
    """Generate speech from text using OpenAI TTS."""
    user = await get_current_user(request)
    text = body.get("text", "")
    voice = body.get("voice", "")
    
    if not text:
        raise HTTPException(400, "Kein Text angegeben")
    
    # Determine voice: request param > user setting > global default
    if not voice:
        user_doc = await db.users.find_one({"_id": ObjectId(user["id"])})
        voice = user_doc.get("voice", "") if user_doc else ""
    if not voice:
        default_doc = await db.settings.find_one({"key": "default_voice"})
        voice = default_doc["value"] if default_doc and default_doc.get("value") else "nova"
    
    # Get OpenAI API key
    api_key = await get_llm_api_key()
    if not api_key:
        raise HTTPException(400, "OpenAI API Key nicht konfiguriert")
    
    # Truncate very long texts
    if len(text) > 4000:
        text = text[:4000] + "..."
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/audio/speech",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": "tts-1", "input": text, "voice": voice, "response_format": "mp3"}
            )
            if resp.status_code == 200:
                return Response(content=resp.content, media_type="audio/mpeg",
                    headers={"Content-Disposition": "inline", "Cache-Control": "no-cache"})
            else:
                logger.error(f"TTS error: {resp.status_code} {resp.text[:200]}")
                raise HTTPException(resp.status_code, f"TTS Fehler: {resp.text[:200]}")
    except httpx.TimeoutException:
        raise HTTPException(504, "TTS Zeitüberschreitung")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"TTS error: {e}")
        raise HTTPException(500, f"TTS Fehler: {str(e)}")

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

async def gather_context_for_services(service_ids: list, msg_lower: str, original_message: str = "") -> str:
    """Gather context ONLY from the routed services."""
    context_parts = []
    
    if "weather" in service_ids:
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
        except Exception as e:
            logger.warning(f"Weather context failed: {e}")

    if "system" in service_ids:
        try:
            import psutil
            cpu = psutil.cpu_percent(interval=0.5)
            mem = psutil.virtual_memory()
            disk = psutil.disk_usage('/')
            context_parts.append(f"SYSTEMDATEN: CPU {cpu}%, RAM {mem.used/(1024**3):.1f}/{mem.total/(1024**3):.1f}GB ({mem.percent}%), Disk {disk.percent}%")
        except Exception:
            pass
        try:
            import docker as docker_lib
            dock = docker_lib.DockerClient(base_url='unix:///var/run/docker.sock', timeout=5)
            containers = dock.containers.list(all=True)
            container_list = "\n".join([f"  - {c.name}: {c.status}" for c in containers[:15]])
            context_parts.append(f"DOCKER CONTAINER:\n{container_list}")
        except Exception:
            pass

    if "homeassistant" in service_ids:
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
                            context_parts.append(f"HOME ASSISTANT GERÄTE:\n" + "\n".join(ha_info))
        except Exception:
            pass

    if "casedesk" in service_ids:
        try:
            cd_url, cd_email, cd_pw = await casedesk.get_casedesk_settings()
            if cd_url and cd_email and cd_pw:
                cd_context = await casedesk.get_casedesk_context(msg_lower)
                if cd_context:
                    context_parts.append(cd_context)
        except Exception as e:
            logger.warning(f"CaseDesk context failed: {e}")

    if "plex" in service_ids:
        try:
            plex_url, plex_token = await plex.get_plex_settings()
            if plex_url and plex_token:
                plex_ctx = await plex.build_chat_context(original_message or msg_lower)
                if plex_ctx:
                    context_parts.append(plex_ctx)
        except Exception as e:
            logger.warning(f"Plex context failed: {e}")

    if "cookpilot" in service_ids:
        try:
            import cookpilot as cookpilot_mod
            # gather_context_for_services is called from chat handler which has user; we pass user via task-local
            aria_user = _current_user_ctx.get()
            if aria_user:
                cp_context = await cookpilot_mod.get_cookpilot_context(original_message or msg_lower, aria_user)
                if cp_context:
                    context_parts.append(cp_context)
        except Exception as e:
            logger.warning(f"CookPilot context failed: {e}")

    return "\n\n".join(context_parts) if context_parts else ""

async def process_chat_message(message_text: str, user_id: str, session_id: str = None) -> str:
    """Core chat processing with intelligent service routing."""
    msg_lower = message_text.lower()

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
        return "Kein API-Key konfiguriert. Bitte im Admin-Bereich einen OpenAI API-Key hinterlegen."
    
    if not OPENAI_AVAILABLE:
        return "OpenAI-Modul nicht verfügbar."
    
    session_id = session_id or f"{user_id}_{uuid.uuid4().hex[:8]}"
    
    # Step 1: Route — GPT-mini decides which services to query
    route_result = await service_router.route_message(message_text)
    routed_services = route_result.get("services", [])
    is_simple = route_result.get("is_simple", False)
    
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
        live_context = await gather_context_for_services(routed_services, msg_lower, message_text)

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

    # Flag: Service wurde geroutet aber lieferte keinen Kontext → Aria muss das transparent
    # kommunizieren statt zu halluzinieren "ich kann nicht auf Dokumente zugreifen".
    routed_but_empty = bool(routed_services) and not live_context
    
    # Step 3: Load chat history
    history = await db.chat_messages.find({"session_id": session_id}).sort("timestamp", 1).limit(50).to_list(50)
    
    try:
        openai_client = AsyncOpenAI(api_key=api_key)
        
        system_prompt = _get_system_prompt()
        
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
        for model in model_preference:
            try:
                kwargs = {"model": model, "messages": gpt_messages, "temperature": 0.7}
                if "5.4" in model:
                    kwargs["max_completion_tokens"] = 1000
                else:
                    kwargs["max_tokens"] = 1000
                response = await openai_client.chat.completions.create(**kwargs)
                break
            except Exception as e:
                if "401" in str(e) or "model" in str(e).lower():
                    continue
                raise
        
        if not response:
            return "KI-Modell nicht verfügbar."
        
        response_text = response.choices[0].message.content
        
        # Step 5: Process action tags
        response_text = await _process_action_tags(response_text, user_id)
        
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
    return """Du bist Aria, der zentrale persönliche Assistent von Andreas. Du bist sein erster Ansprechpartner für ALLES. Du hast VOLLEN ZUGRIFF auf alle verbundenen Dienste und entscheidest SELBST welchen Dienst du nutzt.

VERBUNDENE DIENSTE:
- **CaseDesk AI**: Dokumente, E-Mails, Fälle, Aufgaben, Kalender. Du kannst lesen, suchen, zusammenfassen UND neue Einträge erstellen.
- **Home Assistant**: Smart-Home-Geräte steuern UND Automationen erstellen.
- **Plex Media Server**: Filme, Serien und Musik durchsuchen. Du kennst die Bibliothek und kannst Empfehlungen geben. Wenn PLEX BIBLIOTHEKS-ÜBERSICHT mit Zahlen vorliegt, nutze DIESE Zahlen direkt (z.B. bei "wieviele Filme hast du?"). Wenn PLEX SUCHE "KEINE TREFFER" meldet, sage klar dass der Titel NICHT in der Bibliothek ist. Erfinde KEINE Titel.
- **System**: Server-Diagnostik (CPU, RAM, Docker-Container).
- **Wetter**: Aktuelles Wetter und Vorhersage.

REGELN:
1. Wenn Echtzeitdaten vorhanden sind, NUTZE SIE DIREKT. Sage NIEMALS "ich habe keinen Zugriff".
2. Du HAST Zugriff auf CaseDesk-Dokumente — fasse sie zusammen wenn sie in den Daten stehen.
3. Du kannst Home Assistant Automationen ERSTELLEN — nutze dafür [AKTION:HA_AUTOMATION].
4. Du kannst Geräte STEUERN — nutze [AKTION:HA_STEUERUNG].
5. Antworte auf Deutsch, hilfreich, direkt und präzise.
6. Halte Antworten KURZ wenn über Telegram gefragt wird.

AKTIONEN (füge diese Tags in deine Antwort ein):

CaseDesk:
- Kalendereinträge: [AKTION:KALENDER] {"title":"...", "description":"...", "start_time":"YYYY-MM-DDTHH:MM:SS", "end_time":"YYYY-MM-DDTHH:MM:SS", "all_day":false}
- Aufgaben: [AKTION:AUFGABE] {"title":"...", "description":"...", "priority":"medium", "due_date":"YYYY-MM-DD"}
- Fälle: [AKTION:FALL] {"title":"...", "description":"..."}
- E-Mail senden: [AKTION:EMAIL] {"recipient":"Empfänger Name", "recipient_email":"email@example.com", "subject":"Betreff", "draft_content":"Vollständiger E-Mail-Text", "purpose":"Zweck"}

WICHTIG für E-Mails: Wenn der User dich bittet eine E-Mail zu senden:
1. Erstelle zuerst den vollständigen E-Mail-Text als VORSCHAU (formatiert mit An, Betreff, Text)
2. FRAGE den User: "Soll ich diese E-Mail so versenden?"
3. ERST wenn der User bestätigt (ja, ok, senden, abschicken etc.), füge den [AKTION:EMAIL] Tag ein
4. Füge den Tag NIEMALS bei der ersten Nachricht ein — IMMER zuerst Vorschau zeigen und Bestätigung abwarten

Home Assistant:
- Gerät steuern: [AKTION:HA_STEUERUNG] {"entity_id":"light.wohnzimmer", "service":"turn_on", "data":{}}
- Automation erstellen: [AKTION:HA_AUTOMATION] {"alias":"...","description":"...","trigger":[...],"action":[...]}

Denke MIT: Wenn der User eine Szene oder Automation beschreibt, überlege welche Geräte betroffen sind."""


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

import re

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

# Initialize Service Router
service_router.init(db, get_llm_api_key)

# Initialize ForgePilot integration
forgepilot.init(db, get_llm_api_key)

# Initialize Telegram Bot module
telegram_bot.init(db, get_ha_settings, get_llm_api_key)
telegram_bot.chat_handler = process_chat_message

@app.on_event("startup")
async def start_telegram_bot():
    token = await telegram_bot.get_bot_token()
    if token:
        telegram_bot.start_bot()
        logger.info("Telegram bot started")
    else:
        logger.info("Telegram bot token not configured - bot not started")
