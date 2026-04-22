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

### Phase 7 — Sprach-System Phase A (DONE 2026-04-15)
- [x] Mikrofon-Button im Chat (Speech-to-Text via Web Speech API)
  - Klick → Aufnahme → Transkription → Auto-Send als Chat-Nachricht
  - Visuelles Feedback: rote Puls-Animation, "Aufnahme läuft..."
  - Bei Spracheingabe: Antwort automatisch als Audio (TTS) abgespielt
  - Bei Texteingabe: nur Text-Antwort (kein Audio)
- [x] Text-to-Speech mit OpenAI TTS
  - Backend: `POST /api/voice/tts` → streamt MP3 Audio
  - 6 Stimmen: Alloy, Echo, Fable (märchenhaft), Nova, Onyx, Shimmer
  - "Vorlesen" Button bei jeder Aria-Antwort im Chat
- [x] Stimme pro Benutzer konfigurierbar
  - Konto-Seite: Stimmenauswahl mit Vorschau-Button
  - Sprach-PIN Eingabe für Voice-Identifikation
  - Backend: `PUT /api/voice/user-settings`, `POST /api/voice/verify-pin`
- [x] Admin: Globale Standard-Stimme in Einstellungen
  - Default-Stimme für alle Benutzer (kann pro User überschrieben werden)
- [x] Wake-Word "Aria" (VoiceAssistant.jsx, bestehend)
  - Floating Mic Button (unten rechts)
  - Wake-Word Detection → Listening → Processing → Speaking
- [x] Temporäre PIN-basierte Sprechererkennung
  - User setzt Sprach-PIN unter Konto
  - Bei Sprachbefehl fragt Aria nach PIN
  - PIN-Verifizierung identifiziert Benutzer

- [x] Verbesserte Admin-Einstellungen
  - Settings vorbelegt mit gespeicherten Werten
  - Klare Rückmeldungen (Inline-Banner + Toast)
  - Trailing-Slash Fix für URLs
  - HA + CaseDesk Verbindungstests mit Status-Badge

### Phase 8 — Telegram Bot + GPT-Suchinterpretation (DONE 2026-04-17)
- [x] Telegram Bot Integration (`/app/backend/telegram_bot.py`)
  - Long-Polling Bot für Telegram
  - PIN-basierte Benutzeranmeldung (`/pin XXXX`)
  - Voller Zugriff auf alle Aria-Dienste (CaseDesk, HA, Wetter)
  - Aktions-Tags (Termine, Aufgaben, HA-Steuerung) funktionieren via Telegram
  - Bot-Token konfigurierbar unter Admin → Einstellungen → Telegram Bot
  - Auto-Start nach Token-Speicherung
- [x] GPT als Suchinterpreter für CaseDesk
  - GPT-4o-mini interpretiert Benutzeranfrage und generiert Suchbegriffe
  - "Wie hoch war mein Gehalt?" → GPT liefert: Lohnausweis, Gehalt, Lohnabrechnung, Salär...
  - Ersetzt starres Synonym-Mapping durch KI-Interpretation
  - Fallback auf Keyword-Extraktion wenn GPT nicht verfügbar
- [x] Refactoring: Chat-Logik als `process_chat_message()` extrahiert
  - Wiederverwendbar für Web-Chat und Telegram
  - System-Prompt und Action-Processing in eigene Funktionen
- [x] Reverse-Proxy für externe Dienst-Zugriffe (`/api/proxy/{service_id}/`)

### Phase 9 — Plex Mediathek (DONE 2026-04-17)
- [x] Plex Backend-Modul (`/app/backend/plex.py`)
  - Libraries, Suche, Metadata, Recently Added, On Deck
  - Thumbnail-Proxy (Token nicht im Browser exponiert)
  - Serien: Staffeln + Episoden Navigation
- [x] Mediathek Frontend (`/app/frontend/src/pages/Mediathek.jsx`)
  - Cover-Grid Layout (Netflix-ähnlich)
  - Bibliotheks-Filter (Filme, Serien, Musik)
  - Suchfunktion über alle Bibliotheken
  - Detail-Seite: Beschreibung, Bewertung, Cast, Genres, Auflösung
  - "In Plex abspielen" Button
  - Weiterschauen + Zuletzt hinzugefügt Sektionen
  - Staffel/Episoden-Navigation für Serien
- [x] Admin-Einstellungen: Plex URL + Token + Verbindungstest
- [x] Navigation: MEDIA Tab (Sichtbarkeit pro User konfigurierbar)
- [x] Neuer Tab "media" in ALL_TABS für User-Zuweisung

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
- [x] ForgePilot Integration (Code/Projekte) — siehe Phase 11 unten
- [ ] Nextcloud Integration (Dateien/Kalender)
- [ ] Dienst-übergreifende Aktionen

### P5 — Sprach-System Phase B (Voice-ID)
- [ ] Sprechererkennung mit Open-Source ML (resemblyzer/speechbrain)
- [ ] Stimmabdruck-Training pro Benutzer (unter Konto)
- [ ] Automatische Sprecher-Identifikation (wer spricht?)
- [ ] Rechte-basierter Zugriff je nach erkannter Stimme
- [ ] Läuft lokal auf Unraid (keine laufenden Kosten)

### Phase 10 — SmartHome Builder + Email Fix + GPT-5.4 (DONE 2026-04-18)
- [x] SmartHome Seiten-Builder in Admin (SH-BUILDER Tab)
- [x] Pro User: Geräte/Entitäten auswählen die auf SmartHome-Seite sichtbar sind
- [x] Dashboard-API berücksichtigt Builder-Config als primären Filter
- [x] Email-Versand über CaseDesk API (execute-action + send-correspondence)
- [x] GPT-Modell auf gpt-5.4-mini (Standard), gpt-5.4 für Eskalation
- [x] Navigation: HOME→SMARTHOME, AUTO→Automatisierungen als Tab in SmartHome

### P7 — ForgePilot Integration
- [x] Siehe Phase 11

### Phase 14 — Plex Thumbnail-Fix (DONE 2026-04-19)
Nach wiederholtem Problem: _Movie-Grid Thumbnails laden nicht, Actor-Bilder laden nicht, aber Movie-Detail-Cover funktioniert._

**Root Cause (zwei Bugs gleichzeitig):**
1. **Externe URLs kaputt**: Plex liefert für Schauspieler-Thumbs oft externe URLs wie `https://metadata-static.plex.tv/people/...jpg`. Der alte Proxy baute daraus `http://192.168.1.140:32400/https://metadata-static.plex.tv/...` → 404
2. **Connection-Pool-Erschöpfung bei parallelen Requests**: Jeder `<img>` im Grid machte einen neuen `httpx.AsyncClient()` → jeweils eigene TCP-Connection. Bei 30+ Filmen im Grid bricht Plex/Backend unter der Last zusammen → zufällige Ausfälle

**Fix in `plex.py`:**
- Neuer **Shared HTTP Client** (`_get_image_client()`) mit `max_keepalive_connections=20, max_connections=40` — wird für alle Image-Requests wiederverwendet
- **3-stufiger Proxy** im `/api/plex/image` Endpoint:
  1. **Plex `/photo/:/transcode`** (primär) — handled interne Pfade, externe URLs, Query-Strings, Redirects. Resized zusätzlich das Bild
  2. **Direkter Fetch** (Fallback) für interne Pfade
  3. **External URL Fetch** (Fallback) für `https://...` Pfade
- Validiert Content-Type (`image/*`) bevor Response geliefert wird — verhindert dass Error-HTML als Bild gesendet wird
- Tests: 6 Unit-Tests inkl. 30 parallele Requests (`/app/backend/tests/test_plex_images.py`) alle grün
- [x] **Telegram Bot komplett aufgerüstet**
  - Neuer `test_token()` Helper → getMe + getWebhookInfo + deleteWebhook in einem Call
  - `_status` dict mit running/bot_username/last_poll_at/polls_count/updates_received/last_error
  - `restart_bot()` (async, wartet auf alten Task) + explicit `clear_webhook()` beim Token-Wechsel
  - 409 Conflict-Erkennung mit klarer Fehlermeldung
  - Admin-Endpoints: POST `/api/admin/telegram/test`, GET `/api/admin/telegram/status`, POST `/api/admin/telegram/restart`
  - Admin UI: Test-Button mit grünem/rotem Feedback-Panel, Status-Panel (Polls/Updates/Errors), Restart-Button
- [x] **Router-Historie**
  - Neue Collection `chat_route_log` (gefüllt in `process_chat_message` bei jeder Routing-Entscheidung)
  - Endpoints: GET `/api/admin/router-history?limit=N`, DELETE `/api/admin/router-history`
  - Admin UI: Neuer Block "Router-Historie" in KI-ROUTER Tab — zeigt letzte 30 Anfragen mit geroutetem Service als Badge
- [x] **SMART / Disk-Temperaturen**
  - Endpoint `/api/health/disks` versucht `smartctl --scan-open -j` → fallback `/sys/class/hwmon/*` für NVMe
  - Gibt klaren Hinweis zurück wenn `smartmontools` fehlt (Installationsanleitung für Unraid-Docker: `--cap-add=SYS_RAWIO`)
  - Health-Seite: Temperatur-Badge je Disk + neue "SMART / TEMPERATUREN" Sektion (grün <45°C, orange <55°C, rot ≥55°C)
- [x] 15 neue pytest Backend-Tests (`/app/backend/tests/test_telegram_router_disks.py`) alle grün
- [x] Plex Chat-Kontext massiv verbessert (`plex.py::build_chat_context`)
  - Liefert IMMER autoritative Bibliotheks-Counts (Filme/Serien/Musik)
  - Saubere Titel-Suche mit Quote-Support ("The Matrix")
  - "KEINE TREFFER"-Signal wenn Titel nicht in Bibliothek → GPT antwortet ehrlich
  - Zuletzt-hinzugefügt bei "neu/empfehlung"-Fragen
- [x] Plex Image-Proxy gefixt
  - `follow_redirects=True` (Plex redirected thumbs)
  - Timeout 6s (schneller Fail wenn unreachable)
  - Bessere Logs
- [x] Aria System-Prompt klarer bzgl Plex-Nutzung (nutze autoritative Zahlen, keine Halluzination)
- [x] Admin Service-Registry UI (neuer Tab "KI-ROUTER")
  - Backend: GET/PUT/POST/DELETE `/api/admin/service-registry`
  - Zeigt merged List: defaults + DB-Overrides + Custom
  - Live-Availability-Check pro Service
  - Inline-Editor für Beschreibung/Capabilities/Example-Queries
  - "Neuer Dienst" Button für komplett eigene Services
  - Reset-to-Default via DELETE
- [x] Fix: `gather_context_for_services` Signature mismatch (entdeckt+gefixt vom Testing Agent)
- [x] 11 neue pytest Backend-Tests + 15 Unit/E2E Tests alle grün

### Phase 11 — ForgePilot Integration (DONE 2026-04-18)
- [x] Neues Backend-Modul `/app/backend/forgepilot.py`
  - `get_forgepilot_url()` → holt URL aus `services` Collection
  - `is_available()` → GET `/api/health` mit 3s Timeout
  - `_get_or_create_project()` → mappt Aria-Session auf ForgePilot-Projekt (Collection `forgepilot_sessions`)
  - `query_forgepilot()` → POST `/api/projects/{id}/chat` mit SSE-Stream-Parsing (content/tool/ask_user/complete)
  - `friendly_rephrase()` → formuliert ForgePilot-Antwort mit GPT in Aria-Ton um (Fallback ohne LLM-Key vorhanden)
  - Stream-Timeout: 75s (bei längeren Tasks wird partieller Stand zurückgegeben)
- [x] `service_router.py` erweitert
  - ForgePilot-Beschreibung geschärft (inkl. Bug-Fixing, Programmier-Fragen)
  - Keyword-Fallback erweitert (programmier, python, javascript, react, fastapi, bug, debug, script …)
  - Echte Verfügbarkeitsprüfung via `forgepilot.is_available()`
- [x] `server.py` `process_chat_message`
  - Wenn Router `forgepilot` zurückgibt → komplette Delegation an ForgePilot + Aria-Rephrase
  - Speichert `forgepilot_meta` (ask_user/still_running/project_id) im DB-Record
  - Sticky-Session: Wenn letzte Assistant-Nachricht `ask_user` oder `still_running` hatte → Follow-up geht automatisch zurück an ForgePilot (Rückfrage-Dialog bleibt konsistent)
- [x] Integrations-Tests (`/app/backend/tests/test_forgepilot_integration.py` und `test_forgepilot_e2e.py`)
  - Mock-SSE-Server, 6 Unit-Tests (Availability, Project-Create/Reuse, ask_user, Rephrase-Fallback, Timeout)
  - 3 E2E-Tests (Full-Flow, Sticky-Session, DB-Persistence)
  - Alle grün

### Phase 12 — Themes, Sound & Versionierung (DONE 2026-04-21)
- Multi-Theme-System: Star Trek (LCARS), Disney, Fortnite, Minesweeper
- Theme-Submenu via React Portal (löst Sidebar-Overflow-Clipping)
- Pro-Theme procedurale Sound-Effekte (Web Audio API, keine externen Dateien)
- User-Default-Theme im Konto, globaler Default im Admin, Sound-Mute-Toggle (persistiert als `users.sound_effects_enabled`)
- Settings Backup/Import + Diagnose-UI (verhindert Key-Verlust bei Volume-Reset)
- Auto-Logout bei 401 (sauberer Redirect wenn JWT stale)
- Versionssystem: `/app/backend/version.py` als SSOT; `/api/version` Endpoint

### Phase 13 — SH-Seiten / SmartHome Page Templates (DONE 2026-04-22, V 7.1)
- [x] Admin-Tab "SH-SEITEN" im Admin-Panel (`ShPagesBuilder.jsx`)
  - Benannte Seiten-Templates (z.B. "Luzia's Home")
  - Sektionen mit Titel, optional Raum-Filter, Layout-Variante (grid-1/2/3 oder Liste)
  - Geräte-Items pro Sektion mit Größen-Varianten (normal/breit/hoch/voll)
  - Drag & Drop + Hoch/Runter-Buttons zum Reordering von Sektionen & Items
  - User-Assignment-Block: jede Nicht-Admin-Rolle (kind/erwachsener/gast/wandtablet/readonly) bekommt ein Dropdown mit den Templates
- [x] Backend (`/app/backend/smarthome.py`)
  - Collection `sh_pages` mit `{id, name, description, sections:[{id,title,room_id,layout,items:[{entity_id,widget,size}]}], created_at, updated_at}`
  - Endpoints: `GET/POST/PUT/DELETE /api/smarthome/pages` (admin-only)
  - `PUT /api/smarthome/users/{user_id}/assign-page` (setzt/entfernt `users.sh_page_id`)
  - `GET /api/smarthome/my-page` (returns enriched page or `{page: null}`)
  - `get_current_user` reicht `sh_page_id` durch (Fix in Phase 13)
- [x] Frontend SmartHome.jsx rendert zugewiesenes Template (Sektionen, Grid-Layouts, Gerätegrößen) und fällt auf Standard-Room-Tabs zurück wenn nicht zugewiesen
- [x] Testing: `/app/backend/tests/test_sh_pages.py` (11/11 pytest grün); Playwright E2E der Assignment-Flow validiert


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
