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

ARIA_VERSION = "8.1"

# Aktuelle Services die in die Major-Version einfließen
ARIA_SERVICES = [
    "Smarthome",
    "Health",
    "Chat",
    "Wetter",
    "Media",
    "Themes",
    "CookPilot",
]

# Änderungs-Historie (neueste zuerst) — wird nicht fürs UI gebraucht, nur zur Nachvollziehbarkeit
ARIA_CHANGELOG = [
    {"version": "8.1", "date": "2026-04-28", "notes": "CookPilot Chat-Context Fix: (1) Vorrat-Items mit fehlender Menge werden klar als '(Menge nicht erfasst, Einheit X)' formatiert statt '- Milch: Liter' (was GPT als Wert='Liter' missverstand). (2) Pantry-Intent-Keywords erweitert: 'wieviel/wie viel/haben wir/habe ich/im kühlschrank' triggert jetzt CookPilot-Vorrat-Lookup. (3) Wenn der User nach einem konkreten Item fragt ('wieviel milch') wird der Vorrat danach gefiltert und als 'Treffer für deine Frage' zurückgegeben — GPT bekommt nicht mehr 15 unrelevante Items. (4) Einkaufsliste-Formatter verwendet jetzt denselben sauberen Quantity-Formatter."},
    {"version": "8.0", "date": "2026-04-28", "notes": "CookPilot-Integration (Phase 1): neuer Backend-Modul cookpilot.py mit SSO-Token-Handshake (POST /api/aria/sso, X-Aria-Secret), Proxy-Endpoints für Rezepte/Einkaufsliste/Vorrat/Wochenplan, Per-User-Permissions (12 Rechte). Service-Router erkennt Kochen/Rezept/Einkauf/Vorrat-Anfragen und routet automatisch — funktioniert in Chat, Sprache und Telegram. Aria Frontend: neuer Sidebar-Tab CookPilot mit Submenü gefiltert nach User-Rechten + Iframe-Pages für jeden Bereich. Admin-Tab DIENSTE → COOKPILOT für URL/Shared-Secret/Test."},
    {"version": "7.4", "date": "2026-04-22", "notes": "Mikrofon-UX bei HTTP: Klare Fehlermeldung statt stiller Block. Roter Mikro-Button + Banner über Chat-Eingabe + 12s Toast erklären, dass Browser Mikrofon ohne HTTPS sperrt. Neuer Helper /utils/micReady.js prüft secure context + Permission und liefert deutsche Hint-Texte (NotAllowedError, SecurityError, NotFoundError)."},
    {"version": "7.3", "date": "2026-04-22", "notes": "KRITISCHER FIX: Sticky-ForgePilot hijackte Cross-Domain-Queries → Dokument-/Wetter-/Smart-Home-Fragen landeten fälschlich bei ForgePilot und bekamen Dev-Output. Fix: Sticky-Session wird gebrochen, wenn Router eindeutig auf casedesk/plex/weather/homeassistant routet. ForgePilot-Volldelegation nur wenn es der EINZIGE Dienst ist. Zusätzlich: Aria sagt ehrlich wenn ein Dienst keine Treffer liefert statt zu halluzinieren. Service-Badge im Chat zeigt jetzt korrekt alle Routed-To Dienste als Liste. Neuer Endpoint /api/health/integrations für Connected-Services Status."},
    {"version": "7.2", "date": "2026-04-22", "notes": "Admin-UX: SH-Seiten ist jetzt Sub-Tab innerhalb SH-Builder (Seiten-Templates / Geräte-Checkliste). Assignment-Block hervorgehoben mit How-To-Banner und zeigt pro User live die aktuell zugewiesene Seite."},
    {"version": "7.1", "date": "2026-04-22", "notes": "Fix SH-Seiten: (1) get_current_user gibt sh_page_id zurück, damit /my-page den zugewiesenen Template liefert. (2) Assignment-Filter im ShPagesBuilder akzeptiert alle Nicht-Admin-Rollen (kind, erwachsener, gast, wandtablet, readonly) statt nur 'user'."},
    {"version": "7.0", "date": "2026-04-21", "notes": "SmartHome Seiten-Templates: Admin erstellt benannte Seiten mit Drag&Drop-Sektionen (Titel/Raum/Layout/Geräte), weist User zu. User sieht exakt die zugewiesene Seite."},
    {"version": "6.5", "date": "2026-04-21", "notes": "Fix: LCARS-Sidebar-Klicks hatten keinen onClick-Handler → jetzt spielen alle Nav-Klicks im Star-Trek-Theme den Ton"},
    {"version": "6.4", "date": "2026-04-21", "notes": "LCARS-Click-Sound hörbar gemacht (2-Ton statt 1-Ton, Volume+Duration erhöht)"},
    {"version": "6.3", "date": "2026-04-21", "notes": "Sound-Klicks bei JEDEM Menü-Klick (passend zum Theme) + User-Account-Toggle persistiert in DB (sound_effects_enabled)"},
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
