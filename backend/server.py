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
from enum import Enum

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
    except Exception as e:
        logger.warning(f"Index creation failed: {e}")
    
    default_services = [
        {"id": "casedesk", "name": "CaseDesk AI", "url": "http://192.168.1.140:9090", "icon": "files", "category": "Dokumente", "description": "Dokumenten- und Fallverwaltung mit KI", "health_endpoint": "/api/health", "api_base": "/api", "enabled": True},
        {"id": "forgepilot", "name": "ForgePilot", "url": "http://192.168.1.140:3000", "icon": "code", "category": "Entwicklung", "description": "Projekt- und Code-Verwaltung mit Agenten", "health_endpoint": "/api/health", "api_base": "/api", "enabled": True},
        {"id": "nextcloud", "name": "Nextcloud", "url": "http://192.168.1.140:8666", "icon": "cloud", "category": "Cloud", "description": "Dateien, Kalender und Kontakte", "health_endpoint": "/status.php", "api_base": "", "enabled": True},
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
    
    return {"id": user_id, "email": user["email"], "name": user.get("name", ""), "role": user.get("role", "user"), "theme": user.get("theme", "startrek"), "allowed_services": user.get("allowed_services", []), "permissions": user.get("permissions", {}), "access_token": access_token}

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
            except Exception:
                health["status"] = "offline"
            health_results.append(health)
    
    return health_results

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
        if key in ("openai_api_key", "weather_api_key", "ha_token") and val:
            result[key] = val[:8] + "..." + val[-4:] if len(val) > 12 else val
        else:
            result[key] = val
    return result

@api_router.put("/admin/settings")
async def update_settings(request: Request, settings: dict = Body(...)):
    await require_admin(request)
    for key, value in settings.items():
        if key in ("openai_api_key", "weather_api_key", "ha_token") and value and "..." in value:
            continue
        await db.settings.update_one({"key": key}, {"$set": {"value": value, "updated_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    return {"message": "Settings updated"}

async def get_llm_api_key() -> str:
    setting = await db.settings.find_one({"key": "openai_api_key"})
    if setting and setting.get("value"):
        return setting["value"]
    return ""

# ==================== CHAT CONTEXT ENRICHMENT ====================

async def gather_context(msg_lower: str, request: Request) -> str:
    """Gather real-time data from connected services based on the user's question."""
    context_parts = []
    
    # Weather context
    weather_keywords = ["wetter", "temperatur", "regen", "sonne", "sonnig", "schnee", "wind", "wolken", "vorhersage", "morgen wetter", "heute wetter", "grad draußen", "kalt", "warm", "unwetter", "sturm", "gewitter", "nebel", "feucht"]
    if any(w in msg_lower for w in weather_keywords):
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
                        
                        context_parts.append(f"""AKTUELLE WETTERDATEN für {w.get('name', city)}:
- Temperatur: {w['main']['temp']}°C (gefühlt {w['main']['feels_like']}°C)
- Beschreibung: {w['weather'][0]['description']}
- Luftfeuchtigkeit: {w['main']['humidity']}%
- Wind: {w['wind']['speed']} m/s
- Wolken: {w['clouds']['all']}%
- Luftdruck: {w['main']['pressure']} hPa
- Min/Max heute: {w['main']['temp_min']}°C / {w['main']['temp_max']}°C{forecast_text}""")
        except Exception as e:
            logger.warning(f"Weather context failed: {e}")
    
    # System Health context
    health_keywords = ["server", "system", "cpu", "ram", "speicher", "festplatte", "disk", "arbeitsspeicher", "auslastung", "performance", "docker", "container", "dienst", "service", "netzwerk", "uptime"]
    if any(w in msg_lower for w in health_keywords):
        try:
            import psutil
            cpu = psutil.cpu_percent(interval=0.5)
            mem = psutil.virtual_memory()
            disk = psutil.disk_usage('/')
            context_parts.append(f"""AKTUELLE SYSTEMDATEN:
- CPU Auslastung: {cpu}%
- RAM: {mem.used / (1024**3):.1f} GB / {mem.total / (1024**3):.1f} GB ({mem.percent}%)
- Festplatte: {disk.used / (1024**3):.1f} GB / {disk.total / (1024**3):.1f} GB ({disk.percent}%)
- Uptime: {datetime.now(timezone.utc).isoformat()}""")
        except Exception as e:
            logger.warning(f"System context failed: {e}")
        
        # Docker containers
        try:
            import docker as docker_lib
            dock = docker_lib.DockerClient(base_url='unix:///var/run/docker.sock', timeout=5)
            containers = dock.containers.list(all=True)
            container_list = "\n".join([f"  - {c.name}: {c.status}" for c in containers[:15]])
            context_parts.append(f"DOCKER CONTAINER:\n{container_list}")
        except Exception:
            pass
    
    # Home Assistant context
    ha_keywords = ["smart home", "home assistant", "geräte", "haus", "zuhause", "sensor", "automation"]
    if any(w in msg_lower for w in ha_keywords):
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
                                ha_info.append(f"  - {name}: {state} {unit}".strip())
                        if ha_info:
                            context_parts.append(f"HOME ASSISTANT GERÄTE:\n" + "\n".join(ha_info))
        except Exception:
            pass
    
    if context_parts:
        return "\n\n".join(context_parts)
    return ""

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
                ha_result = await ha_command(request, {"command": message.message})
                if ha_result.get("success"):
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
        if any(w in msg_lower for w in ["dokument", "fall", "case", "akte", "pdf", "scan"]):
            target = "casedesk"
        elif any(w in msg_lower for w in ["projekt", "code", "agent", "entwickl", "build", "git"]):
            target = "forgepilot"
    
    # Route to CaseDesk if targeted
    if target == "casedesk":
        service_account = user.get("service_accounts", {}).get("casedesk", {})
        try:
            service = await db.services.find_one({"id": "casedesk"})
            if service:
                async with httpx.AsyncClient(timeout=10.0) as http_client:
                    resp = await http_client.post(
                        f"{service['url']}{service.get('api_base', '/api')}/chat",
                        json={"message": message.message, "user": service_account.get("username", user["email"])},
                    )
                    if resp.status_code == 200:
                        await db.logs.insert_one({"type": "chat", "user_id": user["id"], "message": message.message[:200], "routed_to": "casedesk", "timestamp": datetime.now(timezone.utc).isoformat()})
                        return {"response": resp.json().get("response", resp.text), "routed_to": "casedesk", "session_id": message.session_id}
        except Exception as e:
            logger.warning(f"CaseDesk routing failed: {e}")
    
    # AI Chat with GPT + enriched context from services
    api_key = await get_llm_api_key()
    if not api_key:
        return {"response": "Kein API-Key konfiguriert. Bitte im Admin-Bereich unter Einstellungen einen OpenAI API-Key hinterlegen.", "routed_to": None, "session_id": message.session_id}
    
    if not OPENAI_AVAILABLE:
        return {"response": "OpenAI-Modul nicht verfügbar.", "routed_to": None, "session_id": message.session_id}
    
    session_id = message.session_id or f"{user['id']}_{uuid.uuid4().hex[:8]}"
    
    # Gather real-time context from connected services
    live_context = await gather_context(msg_lower, request)
    
    # Load chat history for this session
    history = await db.chat_messages.find({"session_id": session_id}).sort("timestamp", 1).limit(50).to_list(50)
    
    try:
        openai_client = AsyncOpenAI(api_key=api_key)
        
        system_prompt = """Du bist Aria, ein intelligenter Assistent für ein Unraid-Server-Dashboard. Du hilfst bei Fragen zu Serververwaltung, Docker-Containern, Dokumentenmanagement (CaseDesk), Entwicklung (ForgePilot), Cloud-Speicher (Nextcloud), Smart Home (Home Assistant) und allgemeinen IT-Themen. Du kannst auch Smart-Home-Geräte wie Lichter, Heizungen und Rollläden steuern. Antworte auf Deutsch, sei hilfreich und präzise.

WICHTIG: Wenn dir Echtzeitdaten zur Verfügung gestellt werden, nutze diese für deine Antwort. Gib die Daten in einer freundlichen, natürlichen Art wieder — nicht als Rohdaten-Dump."""
        
        if live_context:
            system_prompt += f"\n\nAKTUELLE ECHTZEITDATEN:\n{live_context}"
        
        openai_messages = [{"role": "system", "content": system_prompt}]
        
        for msg in history:
            openai_messages.append({"role": msg.get("role", "user"), "content": msg["content"]})
        
        openai_messages.append({"role": "user", "content": message.message})
        
        response = await openai_client.chat.completions.create(
            model="gpt-4o",
            messages=openai_messages,
            max_tokens=1000,
        )
        
        response_text = response.choices[0].message.content
        
        # Store messages
        now = datetime.now(timezone.utc).isoformat()
        await db.chat_messages.insert_many([
            {"session_id": session_id, "user_id": user["id"], "role": "user", "content": message.message, "timestamp": now},
            {"session_id": session_id, "user_id": user["id"], "role": "assistant", "content": response_text, "timestamp": now},
        ])
        
        routed = target or "aria-ai"
        if live_context:
            routed = "aria-ai+live-data"
        await db.logs.insert_one({"type": "chat", "user_id": user["id"], "message": message.message[:200], "routed_to": routed, "timestamp": now})
        
        return {"response": response_text, "routed_to": routed, "session_id": session_id}
    except Exception as e:
        logger.error(f"Chat error: {e}")
        return {"response": f"Fehler bei der KI-Verarbeitung: {str(e)}", "routed_to": None, "session_id": session_id}

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
        {"_id": 0, "role": 1, "content": 1, "timestamp": 1}
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
    url = url_doc["value"] if url_doc and url_doc.get("value") else ""
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
    """Execute a Home Assistant command parsed from natural language via GPT."""
    user = await get_current_user(request)
    url, token = await get_ha_settings()
    command_text = body.get("command", "")
    
    if not url or not token:
        return {"success": False, "message": "Home Assistant nicht konfiguriert. Bitte URL und Token in den Admin-Einstellungen hinterlegen."}
    
    api_key = await get_llm_api_key()
    if not api_key or not OPENAI_AVAILABLE:
        return {"success": False, "message": "OpenAI API-Key fehlt. Wird benötigt um Sprachbefehle zu verstehen."}
    
    # Get available entities for context
    entities = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as http_client:
            resp = await http_client.get(f"{url}/api/states", headers={"Authorization": f"Bearer {token}"})
            if resp.status_code == 200:
                for e in resp.json():
                    eid = e.get("entity_id", "")
                    domain = eid.split(".")[0] if "." in eid else ""
                    if domain in ("light", "switch", "climate", "cover", "media_player", "scene", "script", "fan", "lock", "vacuum", "automation"):
                        entities.append({"id": eid, "name": e.get("attributes", {}).get("friendly_name", eid), "state": e.get("state")})
    except Exception as e:
        logger.warning(f"Could not fetch HA entities: {e}")
    
    entity_list = "\n".join([f"- {e['id']} ({e['name']}, aktuell: {e['state']})" for e in entities[:80]])
    
    # Use GPT to parse the command
    try:
        openai_client = AsyncOpenAI(api_key=api_key)
        parse_response = await openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": f"""Du bist ein Smart Home Controller. Analysiere den Benutzerbefehl und gib eine JSON-Antwort zurück.

Verfügbare Geräte:
{entity_list}

Antworte NUR mit einem JSON-Objekt in diesem Format:
{{"action": "call_service", "domain": "light", "service": "turn_on", "entity_id": "light.wohnzimmer", "data": {{}}, "response_text": "Licht im Wohnzimmer wurde eingeschaltet."}}

Für Klimaanlagen/Heizungen:
{{"action": "call_service", "domain": "climate", "service": "set_temperature", "entity_id": "climate.wohnzimmer", "data": {{"temperature": 22}}, "response_text": "Heizung im Wohnzimmer auf 22 Grad gestellt."}}

Für Statusabfragen:
{{"action": "query", "entity_id": "light.wohnzimmer", "response_text": "Das Licht im Wohnzimmer ist aktuell an."}}

Services: turn_on, turn_off, toggle, set_temperature, open_cover, close_cover, lock, unlock
Wenn der Befehl unklar ist oder kein passendes Gerät gefunden wird:
{{"action": "unknown", "response_text": "Ich konnte kein passendes Gerät finden..."}}"""},
                {"role": "user", "content": command_text}
            ],
            max_tokens=300,
        )
        
        import json
        raw = parse_response.choices[0].message.content.strip()
        # Extract JSON from markdown code blocks if present
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()
        
        parsed = json.loads(raw)
        
        if parsed.get("action") == "unknown" or parsed.get("action") == "query":
            return {"success": True, "message": parsed.get("response_text", ""), "action": parsed.get("action")}
        
        if parsed.get("action") == "call_service":
            domain = parsed.get("domain", "")
            service = parsed.get("service", "")
            entity_id = parsed.get("entity_id", "")
            data = parsed.get("data", {})
            
            service_data = {"entity_id": entity_id}
            service_data.update(data)
            
            async with httpx.AsyncClient(timeout=10.0) as http_client:
                resp = await http_client.post(
                    f"{url}/api/services/{domain}/{service}",
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                    json=service_data
                )
                if resp.status_code in (200, 201):
                    await db.logs.insert_one({"type": "ha_command", "user_id": str(user.get("_id", "")), "command": command_text, "entity": entity_id, "service": f"{domain}.{service}", "timestamp": datetime.now(timezone.utc).isoformat()})
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
