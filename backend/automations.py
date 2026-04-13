"""
Aria Automations Module
Handles: Automation creation (voice/manual), validation, approval workflow, HA sync
"""
from fastapi import APIRouter, HTTPException, Request, Body
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from bson import ObjectId
import httpx
import json
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/automations")

# Will be set from server.py
db = None
get_current_user = None
require_admin = None
get_ha_settings = None
get_llm_api_key = None

def init(database, auth_func, admin_func, ha_settings_func, llm_key_func):
    global db, get_current_user, require_admin, get_ha_settings, get_llm_api_key
    db = database
    get_current_user = auth_func
    require_admin = admin_func
    get_ha_settings = ha_settings_func
    get_llm_api_key = llm_key_func

# ==================== MODELS ====================

APPROVAL_STATES = ["draft", "pending", "approved", "rejected"]

class AutomationCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    trigger: Dict[str, Any] = {}
    conditions: List[Dict[str, Any]] = []
    actions: List[Dict[str, Any]] = []

class AutomationFromVoice(BaseModel):
    command: str

# ==================== VALIDATION ENGINE ====================

async def validate_automation(user: dict, automation: dict) -> dict:
    """Validate an automation against user permissions and security rules."""
    issues = []
    severity = "ok"  # ok, warning, blocked
    
    is_admin = user.get("role") in ["superadmin", "admin"]
    user_id = user.get("id", "")
    
    # Collect all entity_ids referenced in actions
    referenced_entities = set()
    for action in automation.get("actions", []):
        eid = action.get("entity_id", "")
        if eid:
            referenced_entities.add(eid)
        # Also check nested data
        target = action.get("target", {})
        if isinstance(target, dict):
            for eid in target.get("entity_id", []) if isinstance(target.get("entity_id"), list) else [target.get("entity_id", "")]:
                if eid:
                    referenced_entities.add(eid)
    
    # Also check triggers for entity references
    trigger = automation.get("trigger", {})
    if trigger.get("entity_id"):
        referenced_entities.add(trigger["entity_id"])
    
    if not is_admin and referenced_entities:
        # Check permissions for each entity
        perms = await db.device_permissions.find({"user_id": user_id}).to_list(500)
        perm_map = {p["entity_id"]: p for p in perms}
        
        for eid in referenced_entities:
            perm = perm_map.get(eid, {})
            device = await db.devices.find_one({"entity_id": eid}, {"_id": 0})
            
            if not perm.get("automation_allowed", False):
                issues.append({"type": "no_permission", "entity_id": eid, "message": f"Keine Automations-Berechtigung für {device.get('display_name', eid) if device else eid}"})
                severity = "blocked"
            
            if device and device.get("critical"):
                issues.append({"type": "critical_device", "entity_id": eid, "message": f"{device.get('display_name', eid)} ist ein kritisches Gerät — Admin-Freigabe erforderlich"})
                if severity != "blocked":
                    severity = "warning"
        
        # Check cross-room automation
        rooms_involved = set()
        for eid in referenced_entities:
            device = await db.devices.find_one({"entity_id": eid}, {"_id": 0})
            if device and device.get("room_id"):
                rooms_involved.add(device["room_id"])
        
        if len(rooms_involved) > 1:
            # Check if user has access to all rooms
            user_rooms = set()
            for eid, p in perm_map.items():
                if p.get("automation_allowed"):
                    dev = await db.devices.find_one({"entity_id": eid}, {"_id": 0})
                    if dev and dev.get("room_id"):
                        user_rooms.add(dev["room_id"])
            
            missing_rooms = rooms_involved - user_rooms
            if missing_rooms:
                issues.append({"type": "cross_room", "message": "Bereichsübergreifende Automation — Admin-Freigabe erforderlich"})
                if severity != "blocked":
                    severity = "warning"
    
    # Check completeness
    if not automation.get("actions"):
        issues.append({"type": "incomplete", "message": "Keine Aktionen definiert"})
        severity = "blocked"
    
    if not automation.get("trigger") or not automation["trigger"].get("platform"):
        issues.append({"type": "incomplete", "message": "Kein Trigger definiert"})
        severity = "blocked"
    
    # Determine approval requirement
    needs_approval = False
    if severity == "warning":
        needs_approval = True
    if any(i["type"] == "critical_device" for i in issues):
        needs_approval = True
    if any(i["type"] == "cross_room" for i in issues):
        needs_approval = True
    
    return {
        "valid": severity != "blocked",
        "severity": severity,
        "issues": issues,
        "needs_approval": needs_approval,
        "auto_approvable": severity == "ok" and not needs_approval,
    }

# ==================== VOICE → AUTOMATION ====================

async def parse_voice_to_automation(command: str, entities: list, api_key: str) -> dict:
    """Use GPT to parse a voice command into a structured HA automation."""
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=api_key)
        
        entity_list = "\n".join([f"- {e['entity_id']} ({e.get('display_name', e['entity_id'])}, Typ: {e.get('domain', '?')})" for e in entities[:60]])
        
        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": f"""Du bist ein Home Assistant Automations-Experte. Erstelle aus natürlicher Sprache eine strukturierte Automation.

Verfügbare Geräte:
{entity_list}

Antworte NUR mit einem JSON-Objekt:
{{
  "name": "Beschreibender Name",
  "description": "Kurze Beschreibung",
  "trigger": {{
    "platform": "time|state|sun|numeric_state|template",
    "at": "20:00:00",
    "entity_id": "sensor.xyz",
    "state": "on",
    "below": 20,
    "value_template": "..."
  }},
  "conditions": [
    {{"condition": "state|time|numeric_state", "entity_id": "...", "state": "...", "after": "...", "before": "..."}}
  ],
  "actions": [
    {{"service": "light.turn_on", "entity_id": "light.xyz", "data": {{}}}},
    {{"service": "climate.set_temperature", "entity_id": "climate.xyz", "data": {{"temperature": 22}}}}
  ],
  "ha_yaml": "YAML-Darstellung der Automation für Home Assistant"
}}

Trigger-Typen:
- time: "at": "20:00:00"
- state: "entity_id" + "state" (z.B. Sensor geht auf "on")
- sun: "event": "sunset" / "sunrise", optional "offset": "-01:00:00"
- numeric_state: "entity_id" + "below"/"above"

Services: light.turn_on/off, switch.turn_on/off, cover.open_cover/close_cover, climate.set_temperature, scene.turn_on, script.turn_on, lock.lock/unlock, media_player.media_play/pause

Wenn der Befehl unklar ist:
{{"error": "Ich konnte den Befehl nicht verstehen. Bitte versuche es genauer."}}"""},
                {"role": "user", "content": command}
            ],
            max_tokens=800,
        )
        
        raw = response.choices[0].message.content.strip()
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()
        
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"error": "Konnte die KI-Antwort nicht verarbeiten."}
    except Exception as e:
        logger.error(f"Voice automation parse error: {e}")
        return {"error": f"Fehler: {str(e)}"}

def automation_to_ha_yaml(auto: dict) -> str:
    """Convert automation dict to HA YAML format."""
    import yaml
    ha_auto = {
        "alias": auto.get("name", "Aria Automation"),
        "description": auto.get("description", ""),
        "trigger": [],
        "condition": [],
        "action": [],
    }
    
    trigger = auto.get("trigger", {})
    if trigger.get("platform"):
        ha_auto["trigger"].append(trigger)
    
    for cond in auto.get("conditions", []):
        ha_auto["condition"].append(cond)
    
    for action in auto.get("actions", []):
        ha_action = {"service": action.get("service", "")}
        if action.get("entity_id"):
            ha_action["target"] = {"entity_id": action["entity_id"]}
        if action.get("data"):
            ha_action["data"] = action["data"]
        ha_auto["action"].append(ha_action)
    
    return yaml.dump(ha_auto, default_flow_style=False, allow_unicode=True)

# ==================== ROUTES ====================

@router.get("/")
async def list_automations(request: Request):
    """List automations visible to the current user."""
    user = await get_current_user(request)
    is_admin = user["role"] in ["superadmin", "admin"]
    
    if is_admin:
        autos = await db.automations.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    else:
        # User sees own automations + approved ones for their devices
        autos = await db.automations.find(
            {"$or": [{"creator_id": user["id"]}, {"approval_status": "approved"}]},
            {"_id": 0}
        ).sort("created_at", -1).to_list(200)
    
    return autos

@router.get("/{auto_id}")
async def get_automation(auto_id: str, request: Request):
    user = await get_current_user(request)
    auto = await db.automations.find_one({"id": auto_id}, {"_id": 0})
    if not auto:
        raise HTTPException(404, "Automation nicht gefunden")
    return auto

@router.post("/create")
async def create_automation(request: Request, body: AutomationCreate):
    """Create an automation manually."""
    user = await get_current_user(request)
    is_admin = user["role"] in ["superadmin", "admin"]
    
    auto = {
        "id": f"auto_{ObjectId()}",
        "name": body.name,
        "description": body.description,
        "trigger": body.trigger,
        "conditions": body.conditions,
        "actions": body.actions,
        "creator_id": user["id"],
        "creator_email": user.get("email", ""),
        "source": "manual",
        "approval_status": "approved" if is_admin else "pending",
        "security_level": "normal",
        "ha_synced": False,
        "active": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    
    # Validate
    validation = await validate_automation(user, auto)
    auto["validation"] = validation
    
    if not validation["valid"]:
        auto["approval_status"] = "rejected"
        auto["rejection_reason"] = "; ".join([i["message"] for i in validation["issues"]])
    elif validation["needs_approval"] and not is_admin:
        auto["approval_status"] = "pending"
        auto["security_level"] = "elevated"
    elif is_admin or validation["auto_approvable"]:
        auto["approval_status"] = "approved"
    
    await db.automations.insert_one(auto)
    await db.logs.insert_one({"type": "automation_created", "auto_id": auto["id"], "name": body.name, "user_id": user["id"], "user_email": user.get("email", ""), "approval_status": auto["approval_status"], "timestamp": datetime.now(timezone.utc).isoformat()})
    
    return {"id": auto["id"], "approval_status": auto["approval_status"], "validation": validation}

@router.post("/from-voice")
async def create_from_voice(request: Request, body: AutomationFromVoice):
    """Create an automation from a voice command using GPT."""
    user = await get_current_user(request)
    is_admin = user["role"] in ["superadmin", "admin"]
    
    api_key = await get_llm_api_key()
    if not api_key:
        raise HTTPException(400, "OpenAI API-Key nicht konfiguriert")
    
    # Get entities available to this user
    if is_admin:
        entities = await db.devices.find({}, {"_id": 0}).to_list(500)
    else:
        from smarthome import get_user_permissions
        perms = await get_user_permissions(user["id"])
        all_devices = await db.devices.find({}, {"_id": 0}).to_list(500)
        entities = [d for d in all_devices if perms.get(d["entity_id"], {}).get("automation_allowed", False)]
    
    if not entities:
        return {"success": False, "message": "Du hast keine Geräte mit Automations-Berechtigung."}
    
    # Parse voice command
    parsed = await parse_voice_to_automation(body.command, entities, api_key)
    
    if parsed.get("error"):
        return {"success": False, "message": parsed["error"]}
    
    # Generate HA YAML
    try:
        ha_yaml = automation_to_ha_yaml(parsed)
    except Exception:
        ha_yaml = ""
    
    auto = {
        "id": f"auto_{ObjectId()}",
        "name": parsed.get("name", body.command[:50]),
        "description": parsed.get("description", body.command),
        "trigger": parsed.get("trigger", {}),
        "conditions": parsed.get("conditions", []),
        "actions": parsed.get("actions", []),
        "ha_yaml": ha_yaml,
        "original_command": body.command,
        "creator_id": user["id"],
        "creator_email": user.get("email", ""),
        "source": "voice",
        "approval_status": "draft",
        "security_level": "normal",
        "ha_synced": False,
        "active": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    
    # Validate
    validation = await validate_automation(user, auto)
    auto["validation"] = validation
    
    if not validation["valid"]:
        auto["approval_status"] = "rejected"
        auto["rejection_reason"] = "; ".join([i["message"] for i in validation["issues"]])
    elif validation["needs_approval"] and not is_admin:
        auto["approval_status"] = "pending"
        auto["security_level"] = "elevated"
    elif is_admin:
        auto["approval_status"] = "approved"
    else:
        auto["approval_status"] = "draft"  # User reviews before activating
    
    await db.automations.insert_one(auto)
    await db.logs.insert_one({"type": "automation_voice", "auto_id": auto["id"], "command": body.command, "user_id": user["id"], "user_email": user.get("email", ""), "approval_status": auto["approval_status"], "timestamp": datetime.now(timezone.utc).isoformat()})
    
    return {
        "success": True,
        "automation": {k: v for k, v in auto.items() if k != "_id"},
        "validation": validation,
        "ha_yaml": ha_yaml,
    }

@router.put("/{auto_id}/approve")
async def approve_automation(auto_id: str, request: Request, body: dict = Body(...)):
    """Admin approves or rejects an automation."""
    admin = await require_admin(request)
    action = body.get("action", "approve")  # approve or reject
    reason = body.get("reason", "")
    
    auto = await db.automations.find_one({"id": auto_id})
    if not auto:
        raise HTTPException(404, "Automation nicht gefunden")
    
    if action == "approve":
        await db.automations.update_one({"id": auto_id}, {"$set": {"approval_status": "approved", "approved_by": admin.get("email", ""), "approved_at": datetime.now(timezone.utc).isoformat()}})
    else:
        await db.automations.update_one({"id": auto_id}, {"$set": {"approval_status": "rejected", "rejection_reason": reason, "rejected_by": admin.get("email", ""), "rejected_at": datetime.now(timezone.utc).isoformat()}})
    
    await db.logs.insert_one({"type": f"automation_{action}", "auto_id": auto_id, "admin_email": admin.get("email", ""), "reason": reason, "timestamp": datetime.now(timezone.utc).isoformat()})
    return {"success": True}

@router.put("/{auto_id}/activate")
async def activate_automation(auto_id: str, request: Request):
    """Push an approved automation to Home Assistant."""
    user = await get_current_user(request)
    auto = await db.automations.find_one({"id": auto_id}, {"_id": 0})
    if not auto:
        raise HTTPException(404, "Automation nicht gefunden")
    if auto["approval_status"] != "approved":
        raise HTTPException(400, "Automation muss erst genehmigt werden")
    
    ha_url, ha_token = await get_ha_settings()
    if not ha_url or not ha_token:
        raise HTTPException(400, "Home Assistant nicht verbunden")
    
    # Build HA automation config
    ha_config = {
        "alias": auto["name"],
        "description": auto.get("description", ""),
        "trigger": [auto.get("trigger", {})] if auto.get("trigger") else [],
        "condition": auto.get("conditions", []),
        "action": [],
    }
    for action in auto.get("actions", []):
        ha_action = {"service": action.get("service", "")}
        if action.get("entity_id"):
            ha_action["target"] = {"entity_id": action["entity_id"]}
        if action.get("data"):
            ha_action["data"] = action["data"]
        ha_config["action"].append(ha_action)
    
    try:
        async with httpx.AsyncClient(timeout=15.0) as http_client:
            resp = await http_client.post(
                f"{ha_url}/api/config/automation/config/{auto_id}",
                headers={"Authorization": f"Bearer {ha_token}", "Content-Type": "application/json"},
                json=ha_config
            )
            if resp.status_code in (200, 201):
                await db.automations.update_one({"id": auto_id}, {"$set": {"ha_synced": True, "active": True, "synced_at": datetime.now(timezone.utc).isoformat()}})
                # Reload automations in HA
                await http_client.post(f"{ha_url}/api/services/automation/reload", headers={"Authorization": f"Bearer {ha_token}"})
                await db.logs.insert_one({"type": "automation_activated", "auto_id": auto_id, "user_id": user["id"], "timestamp": datetime.now(timezone.utc).isoformat()})
                return {"success": True, "message": f"Automation '{auto['name']}' in Home Assistant aktiviert"}
            else:
                return {"success": False, "message": f"HA Fehler: {resp.status_code} - {resp.text[:200]}"}
    except Exception as e:
        raise HTTPException(502, f"Verbindung zu HA fehlgeschlagen: {str(e)}")

@router.delete("/{auto_id}")
async def delete_automation(auto_id: str, request: Request):
    user = await get_current_user(request)
    auto = await db.automations.find_one({"id": auto_id})
    if not auto:
        raise HTTPException(404, "Nicht gefunden")
    
    is_admin = user["role"] in ["superadmin", "admin"]
    if not is_admin and auto.get("creator_id") != user["id"]:
        raise HTTPException(403, "Keine Berechtigung")
    
    # Remove from HA if synced
    if auto.get("ha_synced"):
        ha_url, ha_token = await get_ha_settings()
        if ha_url and ha_token:
            try:
                async with httpx.AsyncClient(timeout=10.0) as http_client:
                    await http_client.delete(f"{ha_url}/api/config/automation/config/{auto_id}", headers={"Authorization": f"Bearer {ha_token}"})
            except Exception:
                pass
    
    await db.automations.delete_one({"id": auto_id})
    await db.logs.insert_one({"type": "automation_deleted", "auto_id": auto_id, "user_id": user["id"], "timestamp": datetime.now(timezone.utc).isoformat()})
    return {"success": True}

# ==================== INDEX ====================

async def create_indexes():
    try:
        await db.automations.create_index("id", unique=True)
        await db.automations.create_index("creator_id")
        await db.automations.create_index("approval_status")
        logger.info("Automations indexes created")
    except Exception as e:
        logger.warning(f"Automations index creation failed: {e}")
