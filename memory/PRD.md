# Aria Dashboard v2.0 - PRD

## Problemstellung
Aria ist ein zentrales OS-Interface für einen Unraid-Server mit Star Trek LCARS & Disney Themes, Sprachsteuerung, KI-Chat und Smart Home Verwaltung via Home Assistant.

## Architektur
- **Backend**: FastAPI + Motor (Async MongoDB) + PyJWT + OpenAI SDK (direkt)
- **Smart Home Module**: `/app/backend/smarthome.py` (separates Modul)
- **Frontend**: React + Tailwind CSS + Phosphor Icons + Web Speech API
- **Deployment**: Docker Multi-Stage Build -> GitHub Actions -> Unraid GHCR
- **MongoDB**: 4.4 (für CPUs ohne AVX)

## Implementiert

### Phase 1 — Smart Home (DONE 2026-04-13)
- **Smart-Home-Tab** (`/smarthome`): Raumansicht mit Geräte-Widgets
  - Geräte-Widgets: Licht (Toggle+Brightness), Schalter, Thermostat (+/-), Rollladen (Auf/Stop/Zu), Sensor (nur Anzeige), Kamera, Schloss
  - Raum-Tabs mit Geräteanzahl
  - HA-Verbindungsstatus (Verbunden/Offline/Nicht konfiguriert)
  - Auto-Refresh alle 10s
  - Kritische Geräte mit rotem Badge
- **Smart Home Admin** (`/smarthome/admin`): 3 Tabs
  - RÄUME: Erstellen, Löschen, Geräte zuweisen
  - GERÄTE: Liste aller Geräte, Raum-Zuweisung, Kritisch markieren
  - FREIGABEN: Pro Benutzer + Gerät (sichtbar/steuerbar/automation/voice), Bulk-Freigabe pro Raum
- **Backend** (`smarthome.py`):
  - Räume CRUD, Geräte CRUD, Permissions CRUD
  - HA Sync (importiert alle Entitäten aus HA)
  - HA State Sync (nur Status-Updates)
  - Device Control mit serverseitiger Rechteprüfung
  - Kritische Geräte: nur Admin darf steuern
  - Dashboard-API: gefiltert nach Benutzer-Rechten
- **Erweiterte Rollen**: superadmin, admin, erwachsener, user, kind, gast, wandtablet, readonly
- **Datenmodell (MongoDB)**:
  - `rooms`: {id, name, icon, order}
  - `devices`: {entity_id, display_name, room_id, device_type, domain, critical, ha_state, ha_attributes}
  - `device_permissions`: {user_id, entity_id, visible, controllable, automation_allowed, voice_allowed}
  - `room_profiles`: {id, name, room_id, user_id, kiosk_mode, allowed_widgets}

### Kern-Features (Vorher implementiert)
- JWT Auth, Admin Panel, Setup Wizard
- 4 Dienste: CaseDesk AI, ForgePilot, Nextcloud, Unraid
- System Diagnostik: CPU, RAM, Disk, Netzwerk, Docker-Container
- Hybrid AI Chat (GPT-4o + CaseDesk + Live-Daten von Wetter/System/HA)
- Wetter-Tab (OpenWeatherMap, PLZ-Support, Wetter-Bilder)
- Home Assistant Integration (Admin-Config, Sprach+Chat-Steuerung)
- LCARS + Disney Themes mit Animationen
- Voice Assistant "Aria" (Wake Word)
- MongoDB Retry-Logik, Docker-Compose 4.4

## Offene Phasen (Lastenheft)

### Phase 2 — Sprachsteuerung + Rechteprüfung (DONE 2026-04-13)
- [x] Sprachbefehle werden gegen Benutzer-Rechte geprüft (voice_allowed + controllable)
- [x] GPT bekommt NUR freigegebene Geräte als Kontext (Nicht-Admins)
- [x] Server-seitige Doppel-Prüfung: GPT-Parse + Hard-Check in ha_command
- [x] Kritische Geräte: PIN-System (4-8 Ziffern, im Konto-Bereich setzbar)
- [x] PIN-Dialog im Smart Home Tab für kritische Geräte
- [x] Voice Assistant: "Zugriff verweigert" + "PIN erforderlich" Antworten
- [x] Audit-Log Tab in SH-Admin (ha_command, ha_denied, device_control, permission_changed, ha_sync)
- [x] Alle Zugriffe (erlaubt + verweigert) werden geloggt

### Phase 3 — Automations-Builder
- [ ] Sprachgesteuerte Automations-Erstellung via GPT → HA YAML
- [ ] Validierung: nur erlaubte Geräte, Sicherheitsklassifizierung
- [ ] Freigabeworkflow (Modus A/B/C)

### Phase 4 — Kiosk-/Zimmer-Tablet-Modus
- [ ] Kiosk-Modus / Vollbild für Zimmer-Tablets
- [ ] Vorlagen (Gute Nacht, Aufstehen, Lernen)
- [ ] Kindermodus mit vereinfachter UI

## API Endpoints
- Auth: POST /login, GET /me
- Smart Home: GET/POST /smarthome/rooms, GET/POST /smarthome/devices, GET/PUT /smarthome/permissions, POST /smarthome/sync, POST /smarthome/control, GET /smarthome/dashboard
- Health: GET /system, /docker, /services
- Chat: POST /, GET /sessions
- Weather: GET /
- Admin: users CRUD, settings
