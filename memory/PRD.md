# Aria Dashboard v2.0 - PRD

## Originale Problemstellung
Aria ist ein zentrales OS-Interface (Hybrid Auth Dashboard) für einen Unraid-Server. Es dient als Gateway für externe Docker-Services (CaseDesk-AI, ForgePilot, Nextcloud) mit dynamischem Theme-System (Star Trek LCARS & Disney). Admin kann API-Keys konfigurieren und Benutzer verwalten.

## Architektur
- **Backend**: FastAPI + Motor (Async MongoDB) + PyJWT + emergentintegrations (GPT-4o)
- **Frontend**: React + Tailwind CSS + Shadcn UI + Phosphor Icons
- **Deployment**: Docker (Multi-Stage Build) -> GitHub Actions -> Unraid GHCR
- **LLM**: GPT-4o via emergentintegrations, API-Key konfigurierbar über Admin-Panel

## Was wurde implementiert

### Phase 1 - Basis (DONE)
- JWT Auth System (Login, Logout, Setup Wizard)
- Admin Panel (User/Service Management)
- Dockerfile, GitHub Actions CI/CD, Unraid Deployment Config

### Phase 2 - System Monitoring (DONE - 2026-04-11)
- System Diagnostik: CPU, RAM, Disk, Network, Docker-Container
- Auto-Refresh mit LIVE/PAUSE Toggle
- Auth-Fix: Bearer Token prioritiert über Cookies

### Phase 3 - Vollständige Überarbeitung (DONE - 2026-04-11)
- **LCARS Theme Redesign**: Authentisches Star Trek TNG Design
  - Sidebar-Navigation mit farbigen Buttons
  - LCARS Header-Caps, Stardate, Footer-Bars
  - Antonio Font, LCARS-Farbpalette (Orange, Mauve, Purple, Blue)
  - Alle Seiten nutzen das LCARS-Layout
- **Hybrid AI Chat**: GPT-4o + CaseDesk Routing
  - Session-Management (erstellen, laden, löschen)
  - Target-Routing (Aria AI / CaseDesk / ForgePilot)
  - Chat-History in MongoDB
  - Intelligente Weiterleitung basierend auf Keywords
- **Admin API-Key Management**: Settings-Tab im Admin-Bereich
  - OpenAI API-Key konfigurierbar
  - Fallback auf Emergent Universal Key
  - Key wird maskiert angezeigt
- **Nextcloud Integration**: Als 4. Service hinzugefügt
- **Kontoverknüpfung (Account Linking)**: 
  - Benutzer können Credentials für externe Dienste hinterlegen
  - Verknüpfung/Entknüpfung über Account-Seite
  - Linked-Status wird auf Dashboard angezeigt
- **Disney Theme**: Überarbeitet mit Sternen-Animation, Glasmorphismus

## Offene / Anstehende Aufgaben

### P1
- [ ] Globaler Chat & Routing System (Routing basierend auf Intent)
- [ ] Health System erweitern (SMART, Disk-Temps via Unraid API)
- [ ] CaseDesk/ForgePilot API-Proxy (direkte API-Aufrufe über Aria)

### P2
- [ ] Benachrichtigungen/Alerts (CPU > 90%, Container-Absturz)
- [ ] Zentralisierter Log-Viewer (detailliertere Logs)
- [ ] Mobile-Optimierung

## Service-URLs auf Unraid
- Aria: 192.168.1.140:8080
- CaseDesk Frontend: 192.168.1.140:9090
- ForgePilot Frontend: 192.168.1.140:3000
- ForgePilot Backend: 192.168.1.140:8001
- Nextcloud: 192.168.1.140:8666

## DB Schema
- `users`: {email, password_hash, name, role, service_accounts, theme, permissions}
- `services`: {id, name, url, icon, category, description, health_endpoint, enabled}
- `settings`: {key, value, updated_at}
- `chat_messages`: {session_id, user_id, role, content, timestamp}
- `logs`: {type, user_id, timestamp, message, routed_to, email}

## API Endpoints
- POST /api/auth/login, GET /api/auth/me, POST /api/auth/logout
- GET /api/setup/status, POST /api/setup/complete
- GET /api/services, POST /api/services/{id}/link, DELETE /api/services/{id}/link
- GET /api/health, GET /api/health/system, GET /api/health/docker, GET /api/health/services
- GET /api/admin/users, POST /api/admin/users, PUT /api/admin/users/{id}, DELETE /api/admin/users/{id}
- GET /api/admin/settings, PUT /api/admin/settings
- POST /api/chat, GET /api/chat/sessions, GET /api/chat/history/{sid}, DELETE /api/chat/sessions/{sid}
- GET /api/dashboard/stats
- GET /api/logs
