# Aria Dashboard v2.0 - PRD

## Problemstellung
Aria ist ein zentrales OS-Interface für einen Unraid-Server. Gateway für Docker-Services (CaseDesk-AI, ForgePilot, Nextcloud) mit Star Trek LCARS & Disney Themes.

## Architektur
- **Backend**: FastAPI + Motor (Async MongoDB) + PyJWT + OpenAI SDK (direkt, keine Emergent-Abhängigkeiten)
- **Frontend**: React + Tailwind CSS + Phosphor Icons
- **Deployment**: Docker Multi-Stage Build -> GitHub Actions -> Unraid GHCR

## Implementiert

### Phase 1 - Basis (DONE)
- JWT Auth, Admin Panel, Setup Wizard, Dockerfile, CI/CD

### Phase 2 - System Monitoring (DONE - 2026-04-11)
- CPU, RAM, Disk, Network, Docker-Container Live-Monitoring
- Auto-Refresh, Auth-Fix (Bearer > Cookies)

### Phase 3 - Features (DONE - 2026-04-11)
- LCARS Theme Redesign (Sidebar, Header-Caps, Footer-Bars, Antonio Font)
- Disney Theme (Sterne, Glasmorphismus, Feenstaub-Klick-Effekt)
- Hybrid AI Chat (GPT-4o + CaseDesk Routing, Session-Management)
- Nextcloud Integration, Kontoverknüpfung
- Admin API-Key Management (OpenAI + OpenWeatherMap)

### Phase 4 - Finalisierung (DONE - 2026-04-11)
- Alle Emergent-Abhängigkeiten entfernt (openai SDK direkt)
- Feenstaub-Klick-Effekt für Disney Theme
- Festes Menü (sticky Header + Sidebar in beiden Themes)
- Live-Uhrzeit im Header (Datum + Uhrzeit + Stardate)
- Wetter-Tab mit OpenWeatherMap (Aktuell + 3-Tage-Vorhersage)
- Admin-Einstellungen: Stadt + OpenWeatherMap API-Key + direkte Links

## Offene Aufgaben

### P1 (Später)
- [ ] Chat: Server-Status-Awareness (Docker-Daten in Kontext)
- [ ] Health: SMART-Daten, Disk-Temps via Unraid API
- [ ] CaseDesk/ForgePilot API-Proxy

### P2
- [ ] Benachrichtigungen/Alerts
- [ ] Mobile-Optimierung
- [ ] Detaillierte Logs

## Service-URLs Unraid
- Aria: 192.168.1.140:8080
- CaseDesk: 192.168.1.140:9090
- ForgePilot: 192.168.1.140:3000
- Nextcloud: 192.168.1.140:8666

## API Endpoints
- Auth: POST /login, GET /me, POST /logout
- Setup: GET /status, POST /complete
- Services: GET /, POST /{id}/link, DELETE /{id}/link
- Health: GET /, /system, /docker, /services
- Admin: GET/POST/PUT/DELETE users, GET/PUT settings
- Chat: POST /, GET /sessions, GET /history/{sid}, DELETE /sessions/{sid}
- Weather: GET /
- Dashboard: GET /stats
- Logs: GET /
