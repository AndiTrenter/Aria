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
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
from contextlib import asynccontextmanager
from enum import Enum

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
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
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
        return {"id": str(user["_id"]), "email": user["email"], "name": user.get("name", ""), "role": user.get("role", "user"), "theme": user.get("theme", "startrek"), "allowed_services": user.get("allowed_services", []), "service_accounts": user.get("service_accounts", {}), "permissions": user.get("permissions", {})}
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
    USER = "user"
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

class UserCreate(BaseModel):
    email: str
    password: str
    name: str
    role: UserRole = UserRole.USER
    theme: ThemeType = ThemeType.STARTREK

class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    theme: Optional[str] = None
    is_active: Optional[bool] = None
    permissions: Optional[Dict[str, bool]] = None
    allowed_services: Optional[List[str]] = None

class ServiceLinkRequest(BaseModel):
    service_id: str
    username: str
    password: str

class ChatMessage(BaseModel):
    message: str
    target_service: Optional[str] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.users.create_index("email", unique=True)
    await db.services.create_index("id", unique=True)
    await db.logs.create_index("timestamp")
    
    default_services = [
        {"id": "casedesk", "name": "CaseDesk AI", "url": "http://192.168.1.140:9090", "icon": "files", "category": "Dokumente", "description": "Dokumenten- und Fallverwaltung mit KI", "health_endpoint": "/api/health", "enabled": True},
        {"id": "forgepilot", "name": "ForgePilot", "url": "http://192.168.1.140:3000", "icon": "code", "category": "Entwicklung", "description": "Projekt- und Code-Verwaltung mit Agenten", "health_endpoint": "/api/health", "enabled": True},
        {"id": "unraid", "name": "Unraid", "url": "http://192.168.1.140", "icon": "hard-drives", "category": "Server", "description": "Unraid Server Dashboard", "health_endpoint": "/", "enabled": True},
    ]
    
    for service in default_services:
        await db.services.update_one({"id": service["id"]}, {"$setOnInsert": service}, upsert=True)
    
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
    
    return {"id": user_id, "email": user["email"], "name": user.get("name", ""), "role": user.get("role", "user"), "theme": user.get("theme", "startrek"), "allowed_services": user.get("allowed_services", []), "permissions": user.get("permissions", {})}

@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out"}

@api_router.get("/auth/me")
async def get_me(request: Request):
    return await get_current_user(request)

@api_router.put("/auth/theme")
async def update_theme(request: Request, theme: str = Body(..., embed=True)):
    user = await get_current_user(request)
    await db.users.update_one({"_id": ObjectId(user["id"])}, {"$set": {"theme": theme}})
    return {"theme": theme}

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
    
    user_doc = {"email": user_data.email.lower(), "password_hash": hash_password(user_data.password), "name": user_data.name, "role": user_data.role.value, "theme": user_data.theme.value, "is_active": True, "allowed_services": [], "service_accounts": {}, "permissions": {"chat": True, "logs": False, "health": False, "admin": False}, "created_at": datetime.now(timezone.utc).isoformat()}
    result = await db.users.insert_one(user_doc)
    return {"id": str(result.inserted_id), "email": user_data.email.lower(), "name": user_data.name, "role": user_data.role.value}

@api_router.put("/admin/users/{user_id}")
async def update_user(user_id: str, user_data: UserUpdate, request: Request):
    await require_admin(request)
    update_fields = {k: v for k, v in user_data.model_dump().items() if v is not None}
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

# ==================== HEALTH ====================

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "app": "Aria Dashboard", "version": "2.0"}

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
            except Exception as e:
                health["status"] = "offline"
            health_results.append(health)
    
    return health_results

@api_router.get("/health/system")
async def get_system_health(request: Request):
    user = await get_current_user(request)
    if not user.get("permissions", {}).get("health", False) and user["role"] not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Health access not permitted")
    
    import subprocess
    try:
        result = subprocess.run(["cat", "/proc/meminfo"], capture_output=True, text=True, timeout=5)
        mem_lines = result.stdout.split("\n")
        mem_total = int([l for l in mem_lines if "MemTotal" in l][0].split()[1]) // 1024
        mem_free = int([l for l in mem_lines if "MemAvailable" in l][0].split()[1]) // 1024
        mem_used_pct = round((1 - mem_free / mem_total) * 100, 1)
    except:
        mem_total, mem_free, mem_used_pct = 0, 0, 0
    
    try:
        result = subprocess.run(["cat", "/proc/loadavg"], capture_output=True, text=True, timeout=5)
        load = float(result.stdout.split()[0])
        cpu_pct = min(round(load * 25, 1), 100)
    except:
        cpu_pct = 0
    
    return {"cpu_percent": cpu_pct, "memory_percent": mem_used_pct, "memory_total_mb": mem_total, "memory_used_mb": mem_total - mem_free}

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

# ==================== CHAT ====================

@api_router.post("/chat")
async def chat_route(message: ChatMessage, request: Request):
    user = await get_current_user(request)
    if not user.get("permissions", {}).get("chat", False) and user["role"] not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Chat not permitted")
    
    msg_lower = message.message.lower()
    target = message.target_service
    
    if not target:
        if any(w in msg_lower for w in ["dokument", "fall", "case", "akte", "pdf"]):
            target = "casedesk"
        elif any(w in msg_lower for w in ["projekt", "code", "agent", "entwickl", "build"]):
            target = "forgepilot"
    
    if target and target not in user.get("allowed_services", []) and user["role"] not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail=f"No access to service: {target}")
    
    await db.logs.insert_one({"type": "chat", "user_id": user["id"], "message": message.message[:200], "routed_to": target, "timestamp": datetime.now(timezone.utc).isoformat()})
    
    return {"message": message.message, "routed_to": target, "response": f"Nachricht wird an {target or 'Aria'} weitergeleitet..." if target else "Wie kann ich dir helfen?"}

# ==================== DASHBOARD ====================

@api_router.get("/dashboard/stats")
async def get_dashboard_stats(request: Request):
    user = await get_current_user(request)
    services_count = await db.services.count_documents({"enabled": True})
    users_count = await db.users.count_documents({})
    logs_today = await db.logs.count_documents({"timestamp": {"$gte": datetime.now(timezone.utc).replace(hour=0, minute=0, second=0).isoformat()}})
    return {"services": services_count, "users": users_count, "logs_today": logs_today}

app.include_router(api_router)

@api_router.get("/")
async def root():
    return {"message": "Aria Dashboard API", "version": "2.0"}
