"""
Aria Smart Home Module
Handles: Rooms, Device Permissions, Room Profiles, HA Sync, Rights Engine
"""
from fastapi import APIRouter, HTTPException, Request, Body
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from bson import ObjectId
import httpx
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/smarthome")

# Will be set from server.py
db = None
get_current_user = None
require_admin = None
get_ha_settings = None

def init(database, auth_func, admin_func, ha_settings_func):
    global db, get_current_user, require_admin, get_ha_settings
    db = database
    get_current_user = auth_func
    require_admin = admin_func
    get_ha_settings = ha_settings_func

# ==================== PYDANTIC MODELS ====================

class RoomCreate(BaseModel):
    name: str
    icon: str = "house"
    order: int = 0

class RoomUpdate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    order: Optional[int] = None

class DevicePermission(BaseModel):
    visible: bool = True
    controllable: bool = True
    automation_allowed: bool = False
    voice_allowed: bool = False

class DeviceConfig(BaseModel):
    entity_id: str
    display_name: Optional[str] = None
    room_id: Optional[str] = None
    device_type: Optional[str] = None  # light, switch, climate, cover, sensor, camera, lock, media_player, fan, vacuum
    critical: bool = False
    icon: Optional[str] = None

class DevicePermissionUpdate(BaseModel):
    user_id: str
    entity_id: str
    visible: bool = True
    controllable: bool = True
    automation_allowed: bool = False
    voice_allowed: bool = False

class RoomProfileCreate(BaseModel):
    name: str
    room_id: str
    user_id: Optional[str] = None
    kiosk_mode: bool = False
    allowed_widgets: List[str] = []
    start_page: str = "smarthome"

class BulkPermissionUpdate(BaseModel):
    user_id: str
    room_id: str
    visible: bool = True
    controllable: bool = True
    automation_allowed: bool = False
    voice_allowed: bool = False

# ==================== HELPER ====================

DEVICE_DOMAINS = {
    "light": {"name": "Licht", "icon": "lightbulb", "controls": ["toggle", "brightness", "color"]},
    "switch": {"name": "Schalter", "icon": "toggle-left", "controls": ["toggle"]},
    "climate": {"name": "Thermostat", "icon": "thermometer", "controls": ["temperature", "mode"]},
    "cover": {"name": "Rollladen", "icon": "arrows-vertical", "controls": ["open", "close", "stop", "position"]},
    "sensor": {"name": "Sensor", "icon": "chart-line", "controls": []},
    "binary_sensor": {"name": "Sensor", "icon": "bell", "controls": []},
    "camera": {"name": "Kamera", "icon": "video-camera", "controls": ["stream"]},
    "lock": {"name": "Schloss", "icon": "lock", "controls": ["lock", "unlock"]},
    "media_player": {"name": "Medien", "icon": "speaker-high", "controls": ["play", "pause", "volume"]},
    "fan": {"name": "Ventilator", "icon": "fan", "controls": ["toggle", "speed"]},
    "vacuum": {"name": "Saugroboter", "icon": "robot", "controls": ["start", "stop", "dock"]},
    "scene": {"name": "Szene", "icon": "magic-wand", "controls": ["activate"]},
    "script": {"name": "Script", "icon": "file-code", "controls": ["run"]},
    "automation": {"name": "Automation", "icon": "gear", "controls": ["toggle", "trigger"]},
}

VALID_ROLES = ["superadmin", "admin", "erwachsener", "kind", "gast", "wandtablet"]

async def get_user_permissions(user_id: str) -> dict:
    """Get all device permissions for a user as {entity_id: {visible, controllable, ...}}."""
    perms = await db.device_permissions.find({"user_id": user_id}, {"_id": 0}).to_list(500)
    return {p["entity_id"]: p for p in perms}

async def check_device_access(user: dict, entity_id: str, access_type: str = "controllable") -> bool:
    """Check if user has specific access to a device. Admins always have full access."""
    if user["role"] in ["superadmin", "admin"]:
        return True
    perm = await db.device_permissions.find_one({"user_id": user["id"], "entity_id": entity_id})
    if not perm:
        return False
    return perm.get(access_type, False)

async def get_filtered_devices(user: dict) -> list:
    """Get devices filtered by user permissions."""
    all_devices = await db.devices.find({}, {"_id": 0}).to_list(500)
    if user["role"] in ["superadmin", "admin"]:
        return all_devices
    
    perms = await get_user_permissions(user["id"])
    result = []
    for dev in all_devices:
        eid = dev["entity_id"]
        perm = perms.get(eid, {})
        if perm.get("visible", False):
            dev["_perm"] = {
                "controllable": perm.get("controllable", False),
                "automation_allowed": perm.get("automation_allowed", False),
                "voice_allowed": perm.get("voice_allowed", False),
            }
            result.append(dev)
    return result

# ==================== ROOMS ====================

@router.get("/rooms")
async def list_rooms(request: Request):
    user = await get_current_user(request)
    rooms = await db.rooms.find({}, {"_id": 0}).sort("order", 1).to_list(100)
    
    if user["role"] not in ["superadmin", "admin"]:
        # Filter rooms: only show rooms where user has at least one visible device
        perms = await get_user_permissions(user["id"])
        visible_entities = {eid for eid, p in perms.items() if p.get("visible")}
        filtered = []
        for room in rooms:
            devices_in_room = await db.devices.find({"room_id": room["id"], "entity_id": {"$in": list(visible_entities)}}, {"_id": 0}).to_list(100)
            if devices_in_room:
                room["device_count"] = len(devices_in_room)
                filtered.append(room)
        return filtered
    
    # Admin: return all rooms with device counts
    for room in rooms:
        count = await db.devices.count_documents({"room_id": room["id"]})
        room["device_count"] = count
    return rooms

@router.post("/rooms")
async def create_room(request: Request, body: RoomCreate):
    await require_admin(request)
    room_id = f"room_{ObjectId()}"
    room = {"id": room_id, "name": body.name, "icon": body.icon, "order": body.order, "created_at": datetime.now(timezone.utc).isoformat()}
    await db.rooms.insert_one(room)
    await db.logs.insert_one({"type": "room_created", "room_id": room_id, "name": body.name, "timestamp": datetime.now(timezone.utc).isoformat()})
    return {"id": room_id, "name": body.name, "icon": body.icon, "order": body.order}

@router.put("/rooms/{room_id}")
async def update_room(room_id: str, request: Request, body: RoomUpdate):
    await require_admin(request)
    update = {k: v for k, v in body.dict().items() if v is not None}
    if not update:
        raise HTTPException(400, "Keine Änderungen")
    result = await db.rooms.update_one({"id": room_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(404, "Raum nicht gefunden")
    return {"success": True}

@router.delete("/rooms/{room_id}")
async def delete_room(room_id: str, request: Request):
    await require_admin(request)
    await db.rooms.delete_one({"id": room_id})
    await db.devices.update_many({"room_id": room_id}, {"$set": {"room_id": None}})
    return {"success": True}

# ==================== DEVICES ====================

@router.get("/devices")
async def list_devices(request: Request, room_id: Optional[str] = None):
    user = await get_current_user(request)
    query = {}
    if room_id:
        query["room_id"] = room_id
    
    all_devices = await db.devices.find(query, {"_id": 0}).to_list(500)
    
    if user["role"] in ["superadmin", "admin"]:
        return all_devices
    
    perms = await get_user_permissions(user["id"])
    result = []
    for dev in all_devices:
        eid = dev["entity_id"]
        perm = perms.get(eid, {})
        if perm.get("visible", False):
            dev["_perm"] = {
                "controllable": perm.get("controllable", False),
                "automation_allowed": perm.get("automation_allowed", False),
                "voice_allowed": perm.get("voice_allowed", False),
            }
            result.append(dev)
    return result

@router.post("/devices")
async def add_device(request: Request, body: DeviceConfig):
    await require_admin(request)
    domain = body.entity_id.split(".")[0] if "." in body.entity_id else "unknown"
    device = {
        "entity_id": body.entity_id,
        "display_name": body.display_name or body.entity_id,
        "room_id": body.room_id,
        "device_type": body.device_type or domain,
        "domain": domain,
        "critical": body.critical,
        "icon": body.icon,
        "ha_state": None,
        "last_synced": None,
    }
    await db.devices.update_one({"entity_id": body.entity_id}, {"$set": device}, upsert=True)
    return {"success": True, "entity_id": body.entity_id}

@router.put("/devices/{entity_id}")
async def update_device(entity_id: str, request: Request, body: dict = Body(...)):
    await require_admin(request)
    allowed_fields = {"display_name", "room_id", "device_type", "critical", "icon"}
    update = {k: v for k, v in body.items() if k in allowed_fields}
    if not update:
        raise HTTPException(400, "Keine Änderungen")
    await db.devices.update_one({"entity_id": entity_id}, {"$set": update})
    return {"success": True}

@router.delete("/devices/{entity_id}")
async def delete_device(entity_id: str, request: Request):
    await require_admin(request)
    await db.devices.delete_one({"entity_id": entity_id})
    await db.device_permissions.delete_many({"entity_id": entity_id})
    return {"success": True}

# ==================== DEVICE PERMISSIONS ====================

@router.get("/permissions/{user_id}")
async def get_permissions(user_id: str, request: Request):
    admin = await require_admin(request)
    perms = await db.device_permissions.find({"user_id": user_id}, {"_id": 0}).to_list(500)
    return perms

@router.put("/permissions")
async def set_permission(request: Request, body: DevicePermissionUpdate):
    await require_admin(request)
    perm = {
        "user_id": body.user_id,
        "entity_id": body.entity_id,
        "visible": body.visible,
        "controllable": body.controllable,
        "automation_allowed": body.automation_allowed,
        "voice_allowed": body.voice_allowed,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.device_permissions.update_one(
        {"user_id": body.user_id, "entity_id": body.entity_id},
        {"$set": perm},
        upsert=True
    )
    await db.logs.insert_one({"type": "permission_changed", "user_id": body.user_id, "entity_id": body.entity_id, "timestamp": datetime.now(timezone.utc).isoformat()})
    return {"success": True}

@router.put("/permissions/bulk")
async def set_bulk_permissions(request: Request, body: BulkPermissionUpdate):
    """Set permissions for all devices in a room for a user."""
    await require_admin(request)
    devices = await db.devices.find({"room_id": body.room_id}, {"_id": 0}).to_list(200)
    for dev in devices:
        perm = {
            "user_id": body.user_id,
            "entity_id": dev["entity_id"],
            "visible": body.visible,
            "controllable": body.controllable,
            "automation_allowed": body.automation_allowed,
            "voice_allowed": body.voice_allowed,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.device_permissions.update_one(
            {"user_id": body.user_id, "entity_id": dev["entity_id"]},
            {"$set": perm},
            upsert=True
        )
    return {"success": True, "updated": len(devices)}

# ==================== ROOM PROFILES ====================

@router.get("/profiles")
async def list_profiles(request: Request):
    await require_admin(request)
    profiles = await db.room_profiles.find({}, {"_id": 0}).to_list(100)
    return profiles

@router.post("/profiles")
async def create_profile(request: Request, body: RoomProfileCreate):
    await require_admin(request)
    profile_id = f"profile_{ObjectId()}"
    profile = {
        "id": profile_id,
        "name": body.name,
        "room_id": body.room_id,
        "user_id": body.user_id,
        "kiosk_mode": body.kiosk_mode,
        "allowed_widgets": body.allowed_widgets,
        "start_page": body.start_page,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.room_profiles.insert_one(profile)
    return {"id": profile_id, **{k: v for k, v in profile.items() if k != "_id"}}

@router.delete("/profiles/{profile_id}")
async def delete_profile(profile_id: str, request: Request):
    await require_admin(request)
    await db.room_profiles.delete_one({"id": profile_id})
    return {"success": True}

# ==================== HA SYNC ====================

@router.post("/sync")
async def sync_ha_entities(request: Request):
    """Sync entities from Home Assistant into Aria's device database."""
    await require_admin(request)
    ha_url, ha_token = await get_ha_settings()
    if not ha_url or not ha_token:
        raise HTTPException(400, "Home Assistant nicht konfiguriert")
    
    try:
        async with httpx.AsyncClient(timeout=15.0) as http_client:
            resp = await http_client.get(f"{ha_url}/api/states", headers={"Authorization": f"Bearer {ha_token}"})
            if resp.status_code != 200:
                raise HTTPException(502, f"HA Fehler: {resp.status_code}")
            
            entities = resp.json()
            imported = 0
            skipped = 0
            
            for e in entities:
                eid = e.get("entity_id", "")
                domain = eid.split(".")[0] if "." in eid else ""
                if domain not in DEVICE_DOMAINS:
                    skipped += 1
                    continue
                
                friendly_name = e.get("attributes", {}).get("friendly_name", eid)
                ha_state = e.get("state", "unknown")
                
                # Determine if critical
                critical = domain in ("lock", "camera", "alarm_control_panel")
                
                device = {
                    "entity_id": eid,
                    "display_name": friendly_name,
                    "device_type": domain,
                    "domain": domain,
                    "critical": critical,
                    "ha_state": ha_state,
                    "ha_attributes": {k: v for k, v in e.get("attributes", {}).items() if k in ("friendly_name", "brightness", "temperature", "current_temperature", "min_temp", "max_temp", "unit_of_measurement", "device_class", "supported_features", "current_position")},
                    "last_synced": datetime.now(timezone.utc).isoformat(),
                }
                
                # Don't overwrite room_id if already set
                existing = await db.devices.find_one({"entity_id": eid})
                if existing:
                    device.pop("room_id", None)
                    if not existing.get("room_id"):
                        device["room_id"] = None
                else:
                    device["room_id"] = None
                
                await db.devices.update_one({"entity_id": eid}, {"$set": device}, upsert=True)
                imported += 1
            
            # Also try to import HA areas/rooms
            try:
                # HA Websocket API for areas - use REST fallback
                pass  # Areas require websocket, skip for now
            except Exception:
                pass
            
            await db.logs.insert_one({"type": "ha_sync", "imported": imported, "skipped": skipped, "timestamp": datetime.now(timezone.utc).isoformat()})
            return {"success": True, "imported": imported, "skipped": skipped}
    except httpx.RequestError as e:
        raise HTTPException(502, f"Verbindung zu HA fehlgeschlagen: {str(e)}")

@router.post("/sync/states")
async def sync_ha_states(request: Request):
    """Quick sync: only update device states from HA."""
    user = await get_current_user(request)
    ha_url, ha_token = await get_ha_settings()
    if not ha_url or not ha_token:
        return {"success": False, "message": "HA nicht konfiguriert"}
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as http_client:
            resp = await http_client.get(f"{ha_url}/api/states", headers={"Authorization": f"Bearer {ha_token}"})
            if resp.status_code != 200:
                return {"success": False}
            
            states = {e["entity_id"]: e for e in resp.json()}
            devices = await db.devices.find({}, {"_id": 0, "entity_id": 1}).to_list(500)
            
            for dev in devices:
                eid = dev["entity_id"]
                if eid in states:
                    ha_ent = states[eid]
                    await db.devices.update_one({"entity_id": eid}, {"$set": {
                        "ha_state": ha_ent.get("state", "unknown"),
                        "ha_attributes": {k: v for k, v in ha_ent.get("attributes", {}).items() if k in ("friendly_name", "brightness", "temperature", "current_temperature", "min_temp", "max_temp", "unit_of_measurement", "device_class", "current_position", "rgb_color", "color_temp")},
                        "last_synced": datetime.now(timezone.utc).isoformat(),
                    }})
            
            return {"success": True}
    except Exception as e:
        logger.warning(f"State sync failed: {e}")
        return {"success": False, "message": str(e)}

# ==================== DEVICE CONTROL (with rights check) ====================

@router.post("/control")
async def control_device(request: Request, body: dict = Body(...)):
    """Control a device with permission check."""
    user = await get_current_user(request)
    entity_id = body.get("entity_id", "")
    service = body.get("service", "")  # e.g. "turn_on", "turn_off", "set_temperature"
    data = body.get("data", {})
    
    if not entity_id or not service:
        raise HTTPException(400, "entity_id und service sind erforderlich")
    
    # Check device exists
    device = await db.devices.find_one({"entity_id": entity_id}, {"_id": 0})
    if not device:
        raise HTTPException(404, "Gerät nicht gefunden")
    
    # Permission check
    if not await check_device_access(user, entity_id, "controllable"):
        raise HTTPException(403, "Keine Berechtigung für dieses Gerät")
    
    # Critical device extra check
    if device.get("critical"):
        pin = body.get("pin")
        if user["role"] not in ["superadmin", "admin"]:
            raise HTTPException(403, "Kritisches Gerät — nur Admin darf steuern")
    
    ha_url, ha_token = await get_ha_settings()
    if not ha_url or not ha_token:
        raise HTTPException(400, "Home Assistant nicht verbunden")
    
    domain = entity_id.split(".")[0]
    service_data = {"entity_id": entity_id}
    service_data.update(data)
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as http_client:
            resp = await http_client.post(
                f"{ha_url}/api/services/{domain}/{service}",
                headers={"Authorization": f"Bearer {ha_token}", "Content-Type": "application/json"},
                json=service_data
            )
            if resp.status_code in (200, 201):
                await db.logs.insert_one({
                    "type": "device_control",
                    "user_id": user["id"],
                    "user_email": user["email"],
                    "entity_id": entity_id,
                    "service": f"{domain}.{service}",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
                return {"success": True, "message": f"{service} für {device.get('display_name', entity_id)} ausgeführt"}
            else:
                return {"success": False, "message": f"HA Fehler: {resp.status_code}"}
    except Exception as e:
        raise HTTPException(502, f"HA Verbindung fehlgeschlagen: {str(e)}")

# ==================== DASHBOARD DATA ====================

@router.get("/dashboard")
async def smarthome_dashboard(request: Request):
    """Get full smart home dashboard data for the current user."""
    user = await get_current_user(request)
    
    rooms = await db.rooms.find({}, {"_id": 0}).sort("order", 1).to_list(100)
    all_devices = await db.devices.find({}, {"_id": 0}).to_list(500)
    
    is_admin = user["role"] in ["superadmin", "admin"]
    perms = {} if is_admin else await get_user_permissions(user["id"])
    
    # Build room-device structure
    room_map = {}
    unassigned = []
    
    for dev in all_devices:
        eid = dev["entity_id"]
        
        if not is_admin:
            perm = perms.get(eid, {})
            if not perm.get("visible", False):
                continue
            dev["_perm"] = {
                "controllable": perm.get("controllable", False),
                "automation_allowed": perm.get("automation_allowed", False),
                "voice_allowed": perm.get("voice_allowed", False),
            }
        else:
            dev["_perm"] = {"controllable": True, "automation_allowed": True, "voice_allowed": True}
        
        rid = dev.get("room_id")
        if rid:
            if rid not in room_map:
                room_map[rid] = []
            room_map[rid].append(dev)
        else:
            unassigned.append(dev)
    
    result_rooms = []
    for room in rooms:
        devices = room_map.get(room["id"], [])
        if is_admin or devices:
            room["devices"] = devices
            result_rooms.append(room)
    
    # HA connection status
    ha_url, ha_token = await get_ha_settings()
    ha_connected = False
    if ha_url and ha_token:
        try:
            async with httpx.AsyncClient(timeout=3.0) as http_client:
                resp = await http_client.get(f"{ha_url}/api/", headers={"Authorization": f"Bearer {ha_token}"})
                ha_connected = resp.status_code == 200
        except Exception:
            pass
    
    return {
        "rooms": result_rooms,
        "unassigned_devices": unassigned if is_admin else [],
        "ha_connected": ha_connected,
        "ha_configured": bool(ha_url and ha_token),
        "total_devices": len(all_devices),
        "is_admin": is_admin,
        "device_domains": DEVICE_DOMAINS,
    }

# ==================== INDEX SETUP ====================

async def create_indexes():
    """Create MongoDB indexes for smart home collections."""
    try:
        await db.rooms.create_index("id", unique=True)
        await db.devices.create_index("entity_id", unique=True)
        await db.devices.create_index("room_id")
        await db.device_permissions.create_index([("user_id", 1), ("entity_id", 1)], unique=True)
        await db.room_profiles.create_index("id", unique=True)
        logger.info("Smart Home indexes created")
    except Exception as e:
        logger.warning(f"Smart Home index creation failed: {e}")
