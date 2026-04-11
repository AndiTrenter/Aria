# Aria Dashboard v2.0 - PRD

## Problemstellung
Aria ist ein zentrales OS-Interface für einen Unraid-Server mit Star Trek LCARS & Disney Themes, Sprachsteuerung und KI-Chat.

## Architektur
- **Backend**: FastAPI + Motor (Async MongoDB) + PyJWT + OpenAI SDK (direkt)
- **Frontend**: React + Tailwind CSS + Phosphor Icons + Web Speech API
- **Deployment**: Docker Multi-Stage Build -> GitHub Actions -> Unraid GHCR
- **Keine externen Abhängigkeiten** zu Emergent oder Drittanbieter-Plattformen

## Implementiert (Alles DONE)

### Kern-Features
- JWT Auth System, Admin Panel, Setup Wizard
- 4 Dienste: CaseDesk AI, ForgePilot, Nextcloud, Unraid
- System Diagnostik: CPU, RAM, Disk, Netzwerk, Docker-Container
- Hybrid AI Chat (GPT-4o + CaseDesk Routing, Sessions)
- Kontoverknüpfung (Account Linking)
- Wetter-Tab (OpenWeatherMap, 3-Tage-Vorhersage)
- Admin Settings (OpenAI Key, Wetter Key+Stadt)
- Live-Uhrzeit mit Stardate
- Sticky Menüs (Header + Sidebar)

### LCARS Theme (Star Trek TNG)
- Authentisches Design: Sidebar, Header-Caps, Footer-Bars
- Antonio Font, LCARS-Farbpalette
- Energie-Fluss-Animationen: Header-Bar, Sidebar, Footer, Card-Borders
- Ambient Scan-Line, Cap-Pulse

### Disney Theme
- Sternen-Hintergrund mit Floating Stars
- Feenstaub-Klick-Effekt (8 Partikel pro Klick)
- Button-Shine, Header-Shimmer, Card-Hover-Glow
- Cinzel + Quicksand Fonts, Glasmorphismus

### Sprachsteuerung
- Wake Word "Aria" via Web Speech API
- Spracheingabe -> GPT-4o -> Sprachausgabe (TTS)
- Visuelles Feedback: Waveform, Status-Anzeige

### Globales Layout (LcarsLayout) - DONE 2026-04-11
- Einheitliche Navigation (Sidebar + Header) über alle Seiten
- Alle Seiten (Dashboard, Admin, Health, Chat, Weather, Account, Logs) nutzen LcarsLayout
- Keine doppelten Header/Sidebars mehr
- Disney Theme: Top-Navigation Bar
- LCARS Theme: Sidebar + Header-Bar

### Deployment-Robustheit - DONE 2026-04-11
- MongoDB Retry-Logik: Backend wartet bis zu 60s auf MongoDB (30 Versuche × 2s)
- Graceful Degradation: Server crasht nicht mehr wenn MongoDB kurz nicht erreichbar
- Docker-Compose: MongoDB Healthcheck + depends_on mit condition: service_healthy
- Healthcheck: start_period auf 60s erhöht für langsame Container-Starts

## Offene Aufgaben (Backlog P2)
- [ ] Chat: Server-Status-Awareness (Docker-Daten)
- [ ] Health: SMART, Disk-Temps via Unraid API
- [ ] Benachrichtigungen/Alerts
- [ ] Mobile-Optimierung
- [ ] Zentraler Logs Viewer Verbesserungen

## API Endpoints
- Auth: POST /login, GET /me, POST /logout
- Services: GET /, POST /{id}/link, DELETE /{id}/link
- Health: GET /, /system, /docker, /services
- Admin: users CRUD, GET/PUT settings
- Chat: POST /, GET /sessions, GET /history/{sid}, DELETE /sessions/{sid}
- Weather: GET /
- Dashboard: GET /stats, Logs: GET /
