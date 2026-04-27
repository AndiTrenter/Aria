"""
Aria Service Router — Dynamische Service-Registry + GPT-basiertes Routing
Jeder Dienst registriert seine Fähigkeiten. Der Router entscheidet welcher Dienst gebraucht wird.
"""
import httpx
import logging
import json
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

db = None
_get_llm_api_key = None

def init(database, llm_func):
    global db, _get_llm_api_key
    db = database
    _get_llm_api_key = llm_func


# ==================== SERVICE REGISTRY ====================

DEFAULT_REGISTRY = [
    {
        "service_id": "weather",
        "name": "Wetter",
        "type": "builtin",
        "description": "Aktuelles Wetter und Vorhersage für den konfigurierten Standort",
        "capabilities": ["Aktuelle Temperatur", "Wettervorhersage", "Wind/Regen/Schnee Infos"],
        "example_queries": ["Wie ist das Wetter?", "Regnet es morgen?", "Wie kalt ist es?"],
    },
    {
        "service_id": "system",
        "name": "System Health",
        "type": "builtin",
        "description": "Server-Diagnostik: CPU, RAM, Festplatten, Docker-Container, Netzwerk",
        "capabilities": ["CPU/RAM Auslastung", "Festplattenspeicher", "Docker Container Status", "Uptime"],
        "example_queries": ["Wie ist die CPU Auslastung?", "Welche Container laufen?", "Wieviel Speicher ist frei?"],
    },
    {
        "service_id": "homeassistant",
        "name": "Home Assistant",
        "type": "smarthome",
        "description": "Smart Home Steuerung: Lichter, Heizung, Rollläden, Sensoren, Automationen erstellen",
        "capabilities": ["Geräte steuern (ein/aus/dimmen)", "Automationen erstellen", "Sensordaten auslesen", "Szenen aktivieren"],
        "example_queries": ["Mach das Licht an", "Erstelle eine Automation Fernsehschauen", "Wie warm ist das Wohnzimmer?"],
    },
    {
        "service_id": "casedesk",
        "name": "CaseDesk AI",
        "type": "documents",
        "description": "Dokumentenmanagement: E-Mails, Dokumente/PDFs, Fälle, Aufgaben, Kalender. Suchen, lesen, zusammenfassen, erstellen und versenden.",
        "capabilities": ["E-Mails suchen/lesen/senden", "Dokumente suchen/zusammenfassen", "Aufgaben erstellen", "Kalendereinträge erstellen", "Fälle verwalten"],
        "example_queries": ["Hast du meinen Lohnausweis?", "Schreibe eine Email an Max", "Erstelle einen Termin morgen 10 Uhr"],
    },
    {
        "service_id": "plex",
        "name": "Plex Media Server",
        "type": "media",
        "description": "Medien-Bibliothek: Filme, Serien und Musik suchen, Empfehlungen geben, Wiedergabe starten",
        "capabilities": ["Filme/Serien/Musik suchen", "Empfehlungen geben", "Bibliothek durchsuchen", "Zuletzt hinzugefügt anzeigen"],
        "example_queries": ["Hast du Matrix?", "Was gibt es Neues auf Plex?", "Empfiehl mir einen Actionfilm"],
    },
    {
        "service_id": "forgepilot",
        "name": "ForgePilot",
        "type": "development",
        "description": "Software-Entwicklung mit KI-Agenten: Code schreiben, Programmier-Fragen beantworten, Projekte erstellen, Bugs fixen, Builds laufen lassen, Git-Ops",
        "capabilities": ["Code generieren", "Programmier-Fragen beantworten", "Projekte anlegen", "Bugs debuggen", "Builds starten", "Git Push/Pull"],
        "example_queries": [
            "Schreibe mir einen Python-Crawler",
            "Warum funktioniert mein React-Effekt nicht?",
            "Starte einen Build für mein Projekt",
            "Erstelle ein FastAPI Backend mit JWT Auth",
        ],
    },
    {
        "service_id": "cookpilot",
        "name": "CookPilot",
        "type": "kitchen",
        "description": "Küchen-Assistent: Rezepte suchen/anlegen, Einkaufsliste verwalten, Vorrat/Lebensmittelbestand prüfen, Wochenplan/Mahlzeiten planen, Rezeptvorschläge anhand vorhandener Zutaten",
        "capabilities": [
            "Rezepte suchen/anzeigen/anlegen/bearbeiten",
            "Einkaufsliste lesen, ergänzen, abhaken",
            "Vorrat/Pantry abfragen + ergänzen",
            "Wochenplan / Menüplan",
            "Rezeptvorschläge aus vorhandenen Lebensmitteln",
            "MHD/Mindestbestand-Warnungen",
        ],
        "example_queries": [
            "Was kann ich heute kochen?",
            "Füge Milch und Eier zur Einkaufsliste hinzu",
            "Welche Lebensmittel sind noch da?",
            "Suche ein schnelles Rezept mit Reis und Poulet",
            "Was läuft bald ab?",
            "Plane Abendessen für morgen",
            "Setze Eier auf gekauft",
        ],
    },
]


async def get_service_registry():
    """Load service registry from DB, merged with defaults."""
    registry = []
    # Load custom entries from DB
    custom = await db.service_registry.find({}, {"_id": 0}).to_list(50)
    custom_ids = {s["service_id"] for s in custom}
    
    # Merge: custom overrides defaults
    for default in DEFAULT_REGISTRY:
        if default["service_id"] in custom_ids:
            entry = next(s for s in custom if s["service_id"] == default["service_id"])
            registry.append(entry)
        else:
            registry.append(default)
    
    # Add any extra custom services not in defaults
    for c in custom:
        if c["service_id"] not in {d["service_id"] for d in DEFAULT_REGISTRY}:
            registry.append(c)
    
    return registry


async def check_service_available(service_id):
    """Check if a service is actually configured and reachable."""
    if service_id == "weather":
        from server import get_weather_settings
        city, key = await get_weather_settings()
        return bool(city and key)
    elif service_id == "system":
        return True
    elif service_id == "homeassistant":
        from server import get_ha_settings
        url, token = await get_ha_settings()
        return bool(url and token)
    elif service_id == "casedesk":
        import casedesk
        url, email, pw = await casedesk.get_casedesk_settings()
        return bool(url and email and pw)
    elif service_id == "plex":
        import plex as plex_mod
        url, token = await plex_mod.get_plex_settings()
        return bool(url and token)
    elif service_id == "forgepilot":
        import forgepilot as fp_mod
        return await fp_mod.is_available()
    elif service_id == "cookpilot":
        import cookpilot as cp_mod
        return await cp_mod.is_available()
    return False


# ==================== ROUTER ====================

async def route_message(message: str) -> dict:
    """Use GPT-mini to determine which services are needed for a message."""
    api_key = await _get_llm_api_key() if _get_llm_api_key else None
    
    registry = await get_service_registry()
    
    # Build service descriptions for the router
    available_services = []
    for svc in registry:
        is_available = await check_service_available(svc["service_id"])
        if is_available:
            available_services.append(svc)
    
    if not available_services:
        return {"services": [], "is_simple": True, "reasoning": "Keine Dienste verfügbar"}
    
    service_list = "\n".join([
        f"- **{s['service_id']}**: {s['name']} — {s['description']}"
        for s in available_services
    ])
    
    # If no API key, fall back to keyword matching
    if not api_key:
        return _keyword_fallback(message, available_services)
    
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            for model in ["gpt-5.4-mini", "gpt-4o-mini"]:
                resp = await client.post("https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json={
                        "model": model,
                        "messages": [
                            {"role": "system", "content": f"""Du bist ein Service-Router. Analysiere die Benutzeranfrage und entscheide welche Dienste gebraucht werden.

VERFÜGBARE DIENSTE:
{service_list}

ANTWORTE NUR mit einem JSON-Objekt (keine Erklärung):
{{"services": ["service_id1", "service_id2"], "is_simple": false}}

- "services": Liste der benötigten Dienst-IDs (kann leer sein für Smalltalk)
- "is_simple": true wenn es eine einfache Frage ist die KEIN Dienst braucht (Smalltalk, Wissensfragen, Mathe)

Beispiele:
"Wie ist das Wetter?" → {{"services": ["weather"], "is_simple": false}}
"Mach das Licht an" → {{"services": ["homeassistant"], "is_simple": false}}
"Hast du meinen Lohnausweis?" → {{"services": ["casedesk"], "is_simple": false}}
"Schreibe Email an Max über die Rechnung" → {{"services": ["casedesk"], "is_simple": false}}
"Hast du den Film Matrix?" → {{"services": ["plex"], "is_simple": false}}
"Was kann ich heute kochen?" → {{"services": ["cookpilot"], "is_simple": false}}
"Füge Milch zur Einkaufsliste" → {{"services": ["cookpilot"], "is_simple": false}}
"Was ist 2+2?" → {{"services": [], "is_simple": true}}
"Wie warm ist es und hast du neue Filme?" → {{"services": ["weather", "plex"], "is_simple": false}}"""},
                            {"role": "user", "content": message}
                        ],
                        "temperature": 0,
                        "max_tokens": 80,
                    })
                if resp.status_code == 200:
                    text = resp.json()["choices"][0]["message"]["content"].strip()
                    # Parse JSON from response
                    text = text.replace("```json", "").replace("```", "").strip()
                    result = json.loads(text)
                    result["services"] = [s for s in result.get("services", []) if s in {sv["service_id"] for sv in available_services}]
                    logger.info(f"Router ({model}): '{message[:50]}' → {result}")
                    return result
                elif resp.status_code == 401:
                    continue
                else:
                    break
    except json.JSONDecodeError:
        logger.warning(f"Router JSON parse failed, using fallback")
    except Exception as e:
        logger.warning(f"Router failed: {e}")
    
    return _keyword_fallback(message, available_services)


def _keyword_fallback(message: str, services: list) -> dict:
    """Simple keyword-based routing as fallback."""
    msg = message.lower()
    needed = []
    
    keyword_map = {
        "weather": ["wetter", "temperatur", "regen", "schnee", "wind", "grad", "kalt", "warm"],
        "system": ["server", "cpu", "ram", "speicher", "docker", "container", "festplatte"],
        "homeassistant": ["licht", "lampe", "heizung", "rollladen", "schalter", "automation", "smart home", "tv", "fernseh"],
        "casedesk": ["email", "mail", "dokument", "rechnung", "lohn", "fall", "aufgabe", "termin", "kalender", "brief", "schreibe"],
        "plex": ["film", "serie", "musik", "plex", "schauen", "mediathek", "stream"],
        "forgepilot": ["projekt", "code", "build", "git", "entwickl", "programmier", "python", "javascript", "react", "fastapi", "bug", "debug", "funktion", "api", "frontend", "backend", "schreibe mir", "erstelle mir", "script", "skript"],
        "cookpilot": [
            "kochen", "koche", "rezept", "rezepte", "einkauf", "einkaufsliste", "shopping",
            "vorrat", "vorräte", "lebensmittel", "bestand", "küche", "kueche", "backen",
            "menü", "menu", "menüplan", "menuplan", "wochenplan", "essensplan", "mahlzeit",
            "mhd", "mindestbestand", "abgelaufen", "läuft ab", "kassenzettel", "abendessen",
            "frühstück", "fruehstueck", "mittagessen", "zutat", "zutaten", "milch", "eier",
            "butter", "brot", "käse", "kaese", "wurst", "gemüse", "gemuese", "obst",
            "fleisch", "poulet", "reis", "pasta", "nudeln", "abhaken", "gekauft",
        ],
    }
    
    available_ids = {s["service_id"] for s in services}
    for sid, keywords in keyword_map.items():
        if sid in available_ids and any(k in msg for k in keywords):
            needed.append(sid)
    
    return {"services": needed, "is_simple": len(needed) == 0}
