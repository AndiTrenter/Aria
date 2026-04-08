# Aria Dashboard - Product Requirements Document

## Original Problem Statement
Erstelle ein mobiles Dashboard namens "Aria" für Unraid und Docker-Zugriff, das über GitHub gebaut und auf einem Unraid-Server installiert werden kann.

## Architecture
- **Frontend**: React 19 mit Tailwind CSS, Shadcn UI, Framer Motion, Phosphor Icons
- **Backend**: FastAPI (Python 3.11) mit Motor (async MongoDB)
- **Database**: MongoDB
- **Authentication**: JWT-based (httpOnly cookies)
- **Deployment**: Docker Container mit GitHub Actions CI/CD

## User Personas
1. **Unraid Admin**: Technisch versiert, will zentralen Zugriff auf alle Docker-Services
2. **Mobile User**: Zugriff von unterwegs, braucht schnelle Touch-Bedienung

## Core Requirements (Implemented)
- [x] Setup-Wizard beim ersten Start
- [x] Admin-Account Erstellung
- [x] JWT-basierte Authentifizierung
- [x] Dark Mode Theme
- [x] Kachel-Dashboard für Dienste
- [x] Kategorien (Server, Smart Home, Cloud, Medien, Tools, Sonstige)
- [x] Automatische Docker Container-Erkennung (Mock-Daten wenn kein Socket)
- [x] Manuelle Kachel-Erstellung
- [x] Tile Sichtbarkeit (ein-/ausblenden)
- [x] Mobile-optimiertes Design
- [x] Dockerfile für Unraid
- [x] docker-compose.yml
- [x] GitHub Actions Workflow für automatischen Build

## What's Been Implemented (April 2026)
### Backend (/app/backend/server.py)
- Setup endpoint (/api/setup/status, /api/setup/complete)
- Auth endpoints (login, logout, me, refresh)
- Tiles CRUD (/api/tiles)
- Categories (/api/categories)
- Docker integration (/api/docker/containers, /api/docker/containers/add)

### Frontend
- SetupWizard.jsx - 3-step wizard
- Login.jsx - Dark themed login
- Dashboard.jsx - Tile grid with categories
- Admin.jsx - Tile & Container management

### Docker/CI
- Dockerfile (multi-stage build)
- docker-compose.yml
- .github/workflows/docker-build.yml

## Prioritized Backlog

### P0 (Critical) - Done ✅
- Setup Wizard
- Authentication
- Dashboard
- Admin Panel
- Docker Files

### P1 (High Priority) - Future
- [ ] HTTPS/SSL Konfiguration Anleitung
- [ ] Container Status live polling
- [ ] 2-Faktor-Authentifizierung
- [ ] Tile Drag & Drop Sortierung

### P2 (Medium Priority) - Future
- [ ] Container Start/Stop Funktionen
- [ ] Mehrere Benutzer
- [ ] Benachrichtigungen
- [ ] Backup/Export der Einstellungen

### P3 (Low Priority) - Future
- [ ] Mehrere Server/Hosts
- [ ] API-Anbindungen
- [ ] Push-Mitteilungen
- [ ] Custom Themes

## Next Tasks
1. User testet Setup und Dashboard auf Unraid
2. GitHub Repository erstellen und Code pushen
3. Warten auf GitHub Actions Build
4. Docker Image auf Unraid installieren
