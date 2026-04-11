# Aria Dashboard v2.0 - PRD

## Originale Problemstellung
Aria ist ein zentrales OS-Interface (Hybrid Auth Dashboard) für einen Unraid-Server. Es dient als Gateway für externe Docker-Services (CaseDesk-AI, ForgePilot, Nextcloud) mit dynamischem Theme-System (Star Trek LCARS & Disney).

## Architektur
- **Backend**: FastAPI + Motor (Async MongoDB) + PyJWT
- **Frontend**: React + Tailwind CSS + Shadcn UI + Phosphor Icons
- **Deployment**: Docker (Multi-Stage Build) -> GitHub Actions -> Unraid GHCR

## Was wurde implementiert

### Phase 1 - Basis (DONE)
- JWT Auth System (Login, Logout, Setup Wizard)
- Admin Panel (User/Service Management)
- Star Trek LCARS + Disney Theme Engine
- Dockerfile, GitHub Actions CI/CD, Unraid Deployment Config

### Phase 2 - System Monitoring (DONE - 2026-04-11)
- **System Diagnostik Seite** mit Live-Daten:
  - CPU: Modell, Gesamtlast, Pro-Kern-Auslastung, Load Average
  - Arbeitsspeicher: Gesamt/Belegt/Verfügbar mit Donut-Chart
  - Festplatten: Mountpoints, Nutzung mit Balken
  - Netzwerk: Interfaces, Gesendet/Empfangen Bytes
  - Docker Container: Status (laufend/gestoppt), Image, Uptime, Ports
  - Auto-Refresh (15s) mit LIVE/PAUSE Toggle
- **Auth-Fix**: Bearer Token wird vor Cookies geprüft (Preview-Umgebung Stabilität)
- **Dashboard-Fix**: Timeout für health/services API (verhindert langes Laden)
- Backend: psutil + Docker SDK für System-Monitoring
- Beide Themes (LCARS + Disney) funktionieren korrekt

## Offene / Anstehende Aufgaben

### P0 (Nächste)
- [ ] Nextcloud-Integration als externen Service einbinden
- [ ] Kontoverknüpfung (Account Linking) - UI/Backend für Service-Credentials
- [ ] CaseDesk-AI & ForgePilot funktionale Integration (Proxy, Health-Checks)

### P1
- [ ] Globaler Chat & Routing (Queries an CaseDesk vs ForgePilot)
- [ ] Health System auf Unraid-spezifische Daten erweitern (SMART, Disk-Temps via Unraid API)

### P2
- [ ] Zentralisierter Log-Viewer (System, User, Routing)
- [ ] Session-Management Refactoring (localStorage Interceptor)

## Service-URLs auf Unraid
- Aria: 192.168.1.140:8080
- CaseDesk Frontend: 192.168.1.140:9090
- ForgePilot Frontend: 192.168.1.140:3000
- ForgePilot Backend: 192.168.1.140:8001
- Nextcloud: 192.168.1.140:8666

## DB Schema
- `users`: {email, password_hash, name, role, linked_accounts, theme, permissions}
- `services`: {id, name, url, icon, category, description, health_endpoint, enabled}
- `logs`: {type, user_id, timestamp, ...}

## API Endpoints
- POST /api/auth/login, GET /api/auth/me, POST /api/auth/logout
- GET /api/setup/status, POST /api/setup/complete
- GET /api/services, POST /api/services/{id}/link
- GET /api/health, GET /api/health/system, GET /api/health/docker, GET /api/health/services
- GET /api/admin/users, POST /api/admin/users, PUT /api/admin/users/{id}
- GET /api/dashboard/stats
- POST /api/chat
- GET /api/logs
