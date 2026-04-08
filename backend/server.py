from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os
import logging
import secrets
import bcrypt
import jwt
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
from datetime import datetime, timezone, timedelta
from contextlib import asynccontextmanager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# MongoDB connection
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'aria_dashboard')]

# JWT Configuration
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours for better UX
REFRESH_TOKEN_EXPIRE_DAYS = 30

def get_jwt_secret() -> str:
    return os.environ.get("JWT_SECRET", "aria_default_secret_change_me")

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))

def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        "type": "access"
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)

def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        "type": "refresh"
    }
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
        return {
            "id": str(user["_id"]),
            "email": user["email"],
            "name": user.get("name", ""),
            "role": user.get("role", "user")
        }
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# Pydantic Models
class SetupRequest(BaseModel):
    email: str
    password: str
    name: str

class LoginRequest(BaseModel):
    email: str
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    role: str

class TileCreate(BaseModel):
    name: str
    url: str
    icon: str = "cube"
    category: str = "Sonstige"
    description: str = ""
    visible: bool = True
    is_manual: bool = True
    container_id: Optional[str] = None

class TileUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    icon: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    visible: Optional[bool] = None
    order: Optional[int] = None

class TileResponse(BaseModel):
    id: str
    name: str
    url: str
    icon: str
    category: str
    description: str
    visible: bool
    is_manual: bool
    container_id: Optional[str]
    status: str = "unknown"
    order: int = 0

class CategoryCreate(BaseModel):
    name: str
    icon: str = "folder"
    order: int = 0

class DockerSettingsUpdate(BaseModel):
    docker_host: Optional[str] = None
    docker_socket_path: Optional[str] = None

class ContainerToggleRequest(BaseModel):
    container_ids: List[str]
    visible: bool

# Lifespan for startup/shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await db.users.create_index("email", unique=True)
    await db.tiles.create_index("container_id")
    await db.tiles.create_index("category")
    logger.info("Aria Dashboard started")
    yield
    # Shutdown
    client.close()

app = FastAPI(title="Aria Dashboard", lifespan=lifespan)
api_router = APIRouter(prefix="/api")

# CORS
frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
cors_origins = os.environ.get('CORS_ORIGINS', '*')
if cors_origins == '*':
    origins = ["*"]
else:
    origins = cors_origins.split(',')

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Helper to set auth cookies
def set_auth_cookies(response: Response, access_token: str, refresh_token: str):
    response.set_cookie(
        key="access_token", value=access_token, httponly=True,
        secure=False, samesite="lax", max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60, path="/"
    )
    response.set_cookie(
        key="refresh_token", value=refresh_token, httponly=True,
        secure=False, samesite="lax", max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400, path="/"
    )

# ==================== SETUP ENDPOINTS ====================

@api_router.get("/setup/status")
async def get_setup_status():
    """Check if initial setup is completed"""
    user_count = await db.users.count_documents({})
    settings = await db.settings.find_one({"key": "setup_completed"})
    return {
        "setup_completed": user_count > 0 and settings is not None,
        "has_admin": user_count > 0
    }

@api_router.post("/setup/complete")
async def complete_setup(request: SetupRequest, response: Response):
    """Complete initial setup with admin account"""
    # Check if setup already done
    user_count = await db.users.count_documents({})
    if user_count > 0:
        raise HTTPException(status_code=400, detail="Setup already completed")
    
    # Create admin user
    hashed_password = hash_password(request.password)
    user_doc = {
        "email": request.email.lower(),
        "password_hash": hashed_password,
        "name": request.name,
        "role": "admin",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    result = await db.users.insert_one(user_doc)
    user_id = str(result.inserted_id)
    
    # Mark setup as completed
    await db.settings.update_one(
        {"key": "setup_completed"},
        {"$set": {"value": True, "completed_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    
    # Create default categories
    default_categories = [
        {"name": "Server", "icon": "hard-drives", "order": 0},
        {"name": "Smart Home", "icon": "house-line", "order": 1},
        {"name": "Cloud", "icon": "cloud", "order": 2},
        {"name": "Medien", "icon": "play-circle", "order": 3},
        {"name": "Tools", "icon": "wrench", "order": 4},
        {"name": "Sonstige", "icon": "folder", "order": 5},
    ]
    for cat in default_categories:
        await db.categories.update_one(
            {"name": cat["name"]},
            {"$set": cat},
            upsert=True
        )
    
    # Create tokens and set cookies
    access_token = create_access_token(user_id, request.email.lower())
    refresh_token = create_refresh_token(user_id)
    set_auth_cookies(response, access_token, refresh_token)
    
    # Write test credentials
    try:
        os.makedirs("/app/memory", exist_ok=True)
        with open("/app/memory/test_credentials.md", "w") as f:
            f.write(f"# Test Credentials\n\n")
            f.write(f"## Admin Account\n")
            f.write(f"- Email: {request.email}\n")
            f.write(f"- Password: {request.password}\n")
            f.write(f"- Role: admin\n\n")
            f.write(f"## Auth Endpoints\n")
            f.write(f"- POST /api/auth/login\n")
            f.write(f"- POST /api/auth/logout\n")
            f.write(f"- GET /api/auth/me\n")
    except Exception as e:
        logger.warning(f"Could not write test credentials: {e}")
    
    return {
        "id": user_id,
        "email": request.email.lower(),
        "name": request.name,
        "role": "admin"
    }

# ==================== AUTH ENDPOINTS ====================

@api_router.post("/auth/login")
async def login(request: LoginRequest, response: Response):
    email = request.email.lower()
    user = await db.users.find_one({"email": email})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not verify_password(request.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    user_id = str(user["_id"])
    access_token = create_access_token(user_id, email)
    refresh_token = create_refresh_token(user_id)
    set_auth_cookies(response, access_token, refresh_token)
    
    return {
        "id": user_id,
        "email": user["email"],
        "name": user.get("name", ""),
        "role": user.get("role", "user")
    }

@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out"}

@api_router.get("/auth/me")
async def get_me(request: Request):
    user = await get_current_user(request)
    return user

@api_router.post("/auth/refresh")
async def refresh_token(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        
        user_id = str(user["_id"])
        new_access_token = create_access_token(user_id, user["email"])
        response.set_cookie(
            key="access_token", value=new_access_token, httponly=True,
            secure=False, samesite="lax", max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60, path="/"
        )
        
        return {"message": "Token refreshed"}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ==================== CATEGORIES ENDPOINTS ====================

@api_router.get("/categories")
async def get_categories():
    categories = await db.categories.find({}, {"_id": 0}).sort("order", 1).to_list(100)
    return categories

@api_router.post("/categories")
async def create_category(category: CategoryCreate, request: Request):
    await get_current_user(request)
    await db.categories.update_one(
        {"name": category.name},
        {"$set": category.model_dump()},
        upsert=True
    )
    return {"message": "Category created", "name": category.name}

@api_router.delete("/categories/{name}")
async def delete_category(name: str, request: Request):
    await get_current_user(request)
    await db.categories.delete_one({"name": name})
    # Move tiles to "Sonstige"
    await db.tiles.update_many({"category": name}, {"$set": {"category": "Sonstige"}})
    return {"message": "Category deleted"}

# ==================== TILES ENDPOINTS ====================

@api_router.get("/tiles", response_model=List[TileResponse])
async def get_tiles(visible_only: bool = False):
    query = {"visible": True} if visible_only else {}
    tiles = await db.tiles.find(query, {"_id": 0}).sort("order", 1).to_list(1000)
    return tiles

@api_router.post("/tiles", response_model=TileResponse)
async def create_tile(tile: TileCreate, request: Request):
    await get_current_user(request)
    
    tile_doc = tile.model_dump()
    tile_doc["id"] = str(ObjectId())
    tile_doc["status"] = "unknown"
    tile_doc["order"] = await db.tiles.count_documents({})
    tile_doc["created_at"] = datetime.now(timezone.utc).isoformat()
    
    await db.tiles.insert_one(tile_doc)
    return TileResponse(**tile_doc)

@api_router.put("/tiles/{tile_id}")
async def update_tile(tile_id: str, tile: TileUpdate, request: Request):
    await get_current_user(request)
    
    update_data = {k: v for k, v in tile.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No update data provided")
    
    result = await db.tiles.update_one(
        {"id": tile_id},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Tile not found")
    
    updated_tile = await db.tiles.find_one({"id": tile_id}, {"_id": 0})
    return updated_tile

@api_router.delete("/tiles/{tile_id}")
async def delete_tile(tile_id: str, request: Request):
    await get_current_user(request)
    
    result = await db.tiles.delete_one({"id": tile_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Tile not found")
    
    return {"message": "Tile deleted"}

@api_router.post("/tiles/reorder")
async def reorder_tiles(tile_orders: List[dict], request: Request):
    """Reorder tiles by providing list of {id, order}"""
    await get_current_user(request)
    
    for item in tile_orders:
        await db.tiles.update_one(
            {"id": item["id"]},
            {"$set": {"order": item["order"]}}
        )
    
    return {"message": "Tiles reordered"}

# ==================== DOCKER ENDPOINTS ====================

@api_router.get("/docker/containers")
async def get_docker_containers(request: Request):
    """Get list of Docker containers from Unraid server"""
    await get_current_user(request)
    
    # Get Docker settings
    settings = await db.settings.find_one({"key": "docker_settings"})
    docker_host = settings.get("docker_host", "unix:///var/run/docker.sock") if settings else "unix:///var/run/docker.sock"
    
    try:
        import docker
        
        # Try to connect to Docker
        if docker_host.startswith("unix://"):
            client = docker.DockerClient(base_url=docker_host)
        else:
            client = docker.DockerClient(base_url=docker_host)
        
        containers = client.containers.list(all=True)
        result = []
        
        for container in containers:
            # Try to get web port
            ports = container.ports
            web_port = None
            for port_key, port_bindings in ports.items():
                if port_bindings:
                    web_port = port_bindings[0].get('HostPort')
                    break
            
            # Check if already added to tiles
            existing_tile = await db.tiles.find_one({"container_id": container.id})
            
            result.append({
                "id": container.id,
                "name": container.name,
                "status": container.status,
                "image": container.image.tags[0] if container.image.tags else "unknown",
                "ports": ports,
                "web_port": web_port,
                "added_to_dashboard": existing_tile is not None
            })
        
        client.close()
        return result
        
    except Exception as e:
        logger.error(f"Docker connection error: {e}")
        # Return mock data for development/demo
        return [
            {
                "id": "demo_unraid",
                "name": "unraid",
                "status": "running",
                "image": "unraid:latest",
                "ports": {"80/tcp": [{"HostPort": "80"}]},
                "web_port": "80",
                "added_to_dashboard": False
            },
            {
                "id": "demo_nextcloud",
                "name": "nextcloud",
                "status": "running",
                "image": "nextcloud:latest",
                "ports": {"443/tcp": [{"HostPort": "443"}]},
                "web_port": "443",
                "added_to_dashboard": False
            },
            {
                "id": "demo_homeassistant",
                "name": "homeassistant",
                "status": "running",
                "image": "homeassistant/home-assistant:latest",
                "ports": {"8123/tcp": [{"HostPort": "8123"}]},
                "web_port": "8123",
                "added_to_dashboard": False
            },
            {
                "id": "demo_plex",
                "name": "plex",
                "status": "running",
                "image": "plexinc/pms-docker:latest",
                "ports": {"32400/tcp": [{"HostPort": "32400"}]},
                "web_port": "32400",
                "added_to_dashboard": False
            },
            {
                "id": "demo_paperless",
                "name": "paperless-ngx",
                "status": "stopped",
                "image": "paperlessngx/paperless-ngx:latest",
                "ports": {"8000/tcp": [{"HostPort": "8000"}]},
                "web_port": "8000",
                "added_to_dashboard": False
            }
        ]

@api_router.post("/docker/containers/add")
async def add_containers_to_dashboard(containers: List[dict], request: Request):
    """Add selected Docker containers to the dashboard as tiles"""
    await get_current_user(request)
    
    added = []
    for container in containers:
        # Check if already exists
        existing = await db.tiles.find_one({"container_id": container["id"]})
        if existing:
            continue
        
        # Determine category based on name/image
        name_lower = container["name"].lower()
        if "plex" in name_lower or "jellyfin" in name_lower or "emby" in name_lower:
            category = "Medien"
        elif "home" in name_lower or "assistant" in name_lower or "hass" in name_lower:
            category = "Smart Home"
        elif "cloud" in name_lower or "nextcloud" in name_lower or "syncthing" in name_lower:
            category = "Cloud"
        elif "unraid" in name_lower or "portainer" in name_lower:
            category = "Server"
        else:
            category = "Tools"
        
        # Determine icon
        icon = "cube"
        if "plex" in name_lower:
            icon = "play-circle"
        elif "nextcloud" in name_lower:
            icon = "cloud"
        elif "home" in name_lower:
            icon = "house-line"
        elif "paperless" in name_lower:
            icon = "files"
        elif "unraid" in name_lower:
            icon = "hard-drives"
        
        # Build URL
        web_port = container.get("web_port", "80")
        url = f"http://192.168.1.140:{web_port}"
        
        tile_doc = {
            "id": str(ObjectId()),
            "name": container["name"].replace("-", " ").replace("_", " ").title(),
            "url": url,
            "icon": icon,
            "category": category,
            "description": f"Container: {container['image']}",
            "visible": True,
            "is_manual": False,
            "container_id": container["id"],
            "status": container.get("status", "unknown"),
            "order": await db.tiles.count_documents({}),
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        
        await db.tiles.insert_one(tile_doc)
        # Remove MongoDB _id for JSON serialization
        tile_doc.pop('_id', None)
        added.append(tile_doc)
    
    return {"added": len(added), "tiles": added}

@api_router.post("/docker/containers/toggle")
async def toggle_container_visibility(request_data: ContainerToggleRequest, request: Request):
    """Toggle visibility of containers in dashboard"""
    await get_current_user(request)
    
    result = await db.tiles.update_many(
        {"container_id": {"$in": request_data.container_ids}},
        {"$set": {"visible": request_data.visible}}
    )
    
    return {"updated": result.modified_count}

@api_router.put("/docker/settings")
async def update_docker_settings(settings: DockerSettingsUpdate, request: Request):
    """Update Docker connection settings"""
    await get_current_user(request)
    
    update_data = {k: v for k, v in settings.model_dump().items() if v is not None}
    await db.settings.update_one(
        {"key": "docker_settings"},
        {"$set": update_data},
        upsert=True
    )
    
    return {"message": "Docker settings updated"}

@api_router.get("/docker/settings")
async def get_docker_settings(request: Request):
    """Get Docker connection settings"""
    await get_current_user(request)
    
    settings = await db.settings.find_one({"key": "docker_settings"}, {"_id": 0})
    return settings or {"docker_host": "unix:///var/run/docker.sock"}

# ==================== HEALTH CHECK ====================

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "app": "Aria Dashboard"}

@api_router.get("/")
async def root():
    return {"message": "Aria Dashboard API", "version": "1.0.0"}

# Include router
app.include_router(api_router)
