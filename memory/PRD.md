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

### Phase 3 — Automations-Builder (DONE 2026-04-13)
- [x] Sprachgesteuerte Automations-Erstellung via GPT → HA YAML
  - Voice-Command-Input mit Beispiel-Vorschlägen
  - GPT-4o parsed Befehl in strukturiertes Trigger/Actions Format
  - Automatische HA YAML Generierung
- [x] Validierung: nur erlaubte Geräte, Sicherheitsklassifizierung
  - Prüft: Automation-Berechtigung pro Gerät, kritische Geräte, bereichsübergreifend
  - Severity: ok / warning / blocked
- [x] Freigabeworkflow (3 Modi)
  - Modus A (Entwurf): User erstellt, sieht Preview + Validierung
  - Modus B (Auto-Freigabe): Wenn alle Geräte erlaubt + nicht kritisch → auto-approved
  - Modus C (Admin-Freigabe): Kritische/bereichsübergreifende Automationen → pending
- [x] Admin kann Automationen genehmigen/ablehnen
- [x] "In HA aktivieren" Button pushed Automation per HA API
- [x] Automations-Seite mit Expand-Details (Trigger, Actions, YAML, Validation)
- [x] Backend-Modul: `/app/backend/automations.py`
- [x] Frontend: `/app/frontend/src/pages/Automations.jsx`

### Phase 4 — Kiosk-/Zimmer-Tablet-Modus (DONE 2026-04-13)
- [x] Kiosk-Modus / Vollbild für Zimmer-Tablets (`/kiosk`)
  - Vollbild-Layout ohne LCARS-Sidebar
  - Live-Uhr mit Datum (deutsch)
  - Geräte-Grid mit Touch-optimierten Buttons
  - Szenen-Buttons für Raum-Aktionen
  - Auto-Refresh der Gerätezustände (8s)
  - Admin-Vorschau via `/kiosk?profile=xxx`
  - Profil-Selektor für Admins ohne eigenes Profil
- [x] Vorlagen (Gute Nacht, Aufstehen, Lernen, Spielen, Filmabend)
  - 5 Default-Szenen-Templates mit Icons
  - Domain-basiertes Geräte-Matching (Filter)
  - Szenen-Ausführung mit HA API + Rechteprüfung
- [x] Kindermodus mit vereinfachter UI
  - Größere Buttons/Texte (min-h-140px, text-base)
  - Freundliche Überschrift "Was möchtest du tun?"
  - Kein Exit-Button (Kind kann Kiosk nicht verlassen)
  - Mikrofon-Button ausgeblendet
- [x] Smart Home Admin: Profile-Tab (CRUD)
  - Profil erstellen (Name, Raum, Benutzer, Kiosk/Kindermodus)
  - Profilliste mit KIOSK/KIND Badges
  - Vorschau-Link mit Profil-ID
  - Profil löschen
  - Kiosk-Modus Anleitung (4 Schritte)
- [x] Backend: `/api/smarthome/profiles` (CRUD), `/api/smarthome/my-profile`, `/api/smarthome/scene-templates`, `/api/smarthome/execute-scene`

### Phase 5 — Admin-Konsolidierung & Benutzer-Raumzuweisung (DONE 2026-04-13)
- [x] Alle Admin-Funktionen unter `/admin` konsolidiert (8 Tabs)
  - BENUTZER: Erstellen/Bearbeiten mit Raum-Zuweisung + Tab-Sichtbarkeit
  - RÄUME: Erstellen/Löschen, zeigt zugewiesene Benutzer
  - GERÄTE: Liste, Raum-Zuweisung, Kritisch-Markierung, Raumfilter
  - FREIGABEN: Erweiterte Geräte-Freigaben pro Benutzer (überschreibt Raumzuweisung)
  - PROFILE: Kiosk-Profile CRUD
  - AUDIT-LOG: Aktivitätsprotokoll
  - DIENSTE: Service-Verwaltung
  - EINSTELLUNGEN: KI-Config, Wetter, Home Assistant
- [x] Benutzer-Raumzuweisung (assigned_rooms)
  - Mehrere Räume pro Benutzer zuweisbar
  - Raum-Zuweisung bestimmt Geräte-Sichtbarkeit im Smart Home Tab
  - User-Liste zeigt zugewiesene Räume als Badges
  - Räume-Tab zeigt zugewiesene Benutzer pro Raum
- [x] Tab-Sichtbarkeit pro Benutzer (visible_tabs)
  - Admin konfiguriert welche Menüpunkte jeder User sieht
  - 9 konfigurierbare Tabs (Dashboard, Smart Home, Automationen, Health, Chat, Wetter, Konto, Logs, Kiosk)
  - Navigation filtert automatisch nach Benutzer-Einstellung
  - Admin-Tab immer nur für Admin/Superadmin sichtbar
- [x] SH-ADMIN aus Sidebar entfernt (alles unter /admin)
- [x] Backend: UserCreate/UserUpdate mit assigned_rooms + visible_tabs
- [x] Backend: Dashboard-API filtert Räume nach assigned_rooms


### Phase 6 — Aria als zentraler KI-Hub (DONE 2026-04-14)
- [x] CaseDesk AI Integration
  - Dokumente, E-Mails, Fälle, Aufgaben, Kalender lesen
  - Dokumente durchsuchen und zusammenfassen
  - Aufgaben, Termine, Fälle in CaseDesk erstellen via Chat
  - Admin-Einstellungen: URL, Login, Passwort + Verbindungstest
  - Backend: `/app/backend/casedesk.py` (eigenes Modul)
- [x] Intelligentes Service-Routing
  - GPT entscheidet selbst welchen Dienst es nutzt
  - CaseDesk wird bei JEDER Frage abgefragt wenn verbunden
  - HA-Geräte werden bei Smart-Home-bezogenen Fragen geladen
  - Erweiterter System-Prompt: Aria = zentraler Assistent mit vollem Zugriff
- [x] HA Automations-Erstellung via Chat
  - User beschreibt Automation in natürlicher Sprache
  - GPT erstellt HA-kompatible Automation-Config
  - Automation wird direkt via HA REST API (`/api/config/automation/config/`) erstellt
  - Action-Tags: [AKTION:HA_AUTOMATION], [AKTION:HA_STEUERUNG]
- [x] CaseDesk Action-Tags: [AKTION:KALENDER], [AKTION:AUFGABE], [AKTION:FALL]
- [x] Verbesserte Admin-Einstellungen
  - Settings vorbelegt mit gespeicherten Werten
  - Klare Rückmeldungen (Inline-Banner + Toast)
  - Trailing-Slash Fix für URLs
  - HA + CaseDesk Verbindungstests mit Status-Badge

## Offene Aufgaben

### P1 — Graceful Handling Offline Home Assistant
- [ ] UI zeigt sauberen Offline-Status statt Fehler wenn HA nicht erreichbar
- [ ] Sync-Button disabled mit Hinweis
- [ ] Smart Home Tab: "HA nicht verbunden" Overlay statt Crash

### P2 — Mobile-Optimierungen
- [ ] Smart Home + Admin UIs für Touch/Mobile optimieren
- [ ] Responsive Layouts für kleinere Bildschirme

### P3 — SMART/Disk-Temperaturen
- [ ] Disk-Temperaturen im System Health diagnostik

### P4 — Weitere Dienst-Integrationen
- [ ] ForgePilot Integration (Code/Projekte)
- [ ] Nextcloud Integration (Dateien/Kalender)
- [ ] Dienst-übergreifende Aktionen

## API Endpoints
- Auth: POST /login, GET /me
- Smart Home: GET/POST /smarthome/rooms, GET/POST /smarthome/devices, GET/PUT /smarthome/permissions, POST /smarthome/sync, POST /smarthome/control, GET /smarthome/dashboard
- Profiles: GET/POST/PUT/DELETE /smarthome/profiles, GET /smarthome/my-profile, GET /smarthome/scene-templates, POST /smarthome/execute-scene
- Automations: GET/POST /automations, PUT /automations/{id}/approve
- CaseDesk: GET /casedesk/status, POST /casedesk/search/emails, GET /casedesk/emails, /cases, /tasks, /events, /documents
- Health: GET /system, /docker, /services
- Chat: POST / (mit auto-routing zu HA/CaseDesk/System/Wetter)
- Weather: GET /
- Admin: users CRUD, settings (inkl. HA, CaseDesk, Wetter, OpenAI Konfiguration)
