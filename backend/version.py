"""
Aria Version — Single Source of Truth.

Format: V <Services>.<FixCounter>
  - Services = Anzahl der Haupt-Features/Seiten
  - FixCounter = Fix-Nummer innerhalb der aktuellen Erweiterung (0 bei neuem Service)

Beispiele:
  V 5.0 → Start mit 5 Seiten (Smarthome, Health, Chat, Wetter, Media)
  V 5.4 → 4 Fixes für Media-Erweiterung
  V 6.0 → Nextcloud hinzugefügt (neuer Service)
  V 6.1 → 1 Fix zu Nextcloud

WICHTIG für Agenten: Bei jeder Änderung die Version hier aktualisieren!
  - Neuer Service/Seite → Major +1, Minor = 0
  - Fix/Improvement an bestehender Erweiterung → Minor +1
"""

ARIA_VERSION = "6.2"

# Aktuelle Services die in die Major-Version einfließen
ARIA_SERVICES = [
    "Smarthome",
    "Health",
    "Chat",
    "Wetter",
    "Media",
    "Themes",
]

# Änderungs-Historie (neueste zuerst) — wird nicht fürs UI gebraucht, nur zur Nachvollziehbarkeit
ARIA_CHANGELOG = [
    {"version": "6.2", "date": "2026-04-21", "notes": "Theme-Polish: Pro-Theme Sound-Effekte (procedural via Web Audio), Hover-Preview-Animation mit Akzentfarbe, Sound-Mute-Toggle im Theme-Submenu"},
    {"version": "6.1", "date": "2026-04-21", "notes": "Fix: Theme-Submenu wurde von Sidebar-Overflow abgeschnitten → React Portal mit fixed position"},
    {"version": "6.0", "date": "2026-04-21", "notes": "Multi-Theme-System: 4 Themes (Star Trek, Disney, Fortnite, Minesweeper). User-Default in Konto, globaler Default im Admin. Submenu statt Toggle."},
    {"version": "5.8", "date": "2026-04-21", "notes": "Auto-Logout bei 401 (stale JWT nach DB-Wipe invalidiert Session → sauberer Redirect zu Login)"},
    {"version": "5.7", "date": "2026-04-21", "notes": "Settings Backup/Import + Diagnose-UI (verhindert dauerhaften Key-Verlust bei Volume-Reset)"},
    {"version": "5.6", "date": "2026-04-21", "notes": "KRITISCHER FIX: Media-Grid Thumbnails — 'undefined' in Image-URL (process.env.REACT_APP_BACKEND_URL fallback)"},
    {"version": "5.5", "date": "2026-04-19", "notes": "Versionssystem + Plex Thumbnail Cache-Bust + Warm-up beim Login"},
    {"version": "5.4", "date": "2026-04-19", "notes": "Plex Thumbnail-Proxy komplett neu (Transcode + Shared Connection Pool)"},
    {"version": "5.3", "date": "2026-04-19", "notes": "Telegram Test-Button, Router-Historie, SMART/Disk-Temperaturen"},
    {"version": "5.2", "date": "2026-04-18", "notes": "Plex Chat-Intelligence + Admin Service-Registry UI"},
    {"version": "5.1", "date": "2026-04-18", "notes": "ForgePilot Integration"},
    {"version": "5.0", "date": "2026-04-17", "notes": "Basis: Smarthome, Health, Chat, Wetter, Media"},
]


def version_display() -> str:
    """Formatierte Version für Anzeige: 'V 5.4'"""
    return f"V {ARIA_VERSION}"
