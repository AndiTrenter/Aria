# Aria Dashboard

Ein sicheres, mobil optimiertes Web-Dashboard für Unraid und Docker-Container.

## Features

- 🏠 **Zentrales Dashboard** - Alle deine Dienste auf einen Blick
- 🐳 **Docker-Integration** - Automatische Erkennung von Containern
- 📱 **Mobile-First** - Optimiert für Smartphones und Tablets
- 🔒 **Sicher** - JWT-basierte Authentifizierung
- 🎨 **Dark Mode** - Augenschonendes Design
- ⚡ **Schnell** - Moderne React + FastAPI Architektur

## Screenshots

![Dashboard](docs/dashboard.png)
![Admin](docs/admin.png)

## Installation auf Unraid

### Methode 1: GitHub Container Registry (Empfohlen)

1. **Forke dieses Repository** auf deinem GitHub Account

2. **Aktiviere GitHub Actions** in deinem Fork

3. **Warte auf den Build** - Das Docker Image wird automatisch gebaut und zu `ghcr.io/<dein-username>/aria-dashboard` gepusht

4. **Installiere auf Unraid:**
   - Gehe zu Docker → Add Container
   - Repository: `ghcr.io/<dein-username>/aria-dashboard:latest`
   - Konfiguriere die Ports und Volumes (siehe unten)

### Methode 2: Lokaler Build

```bash
# Repository klonen
git clone https://github.com/<dein-username>/aria-dashboard.git
cd aria-dashboard

# Image bauen
docker build -t aria-dashboard .

# Container starten
docker-compose up -d
```

## Unraid Docker Template

Erstelle einen neuen Container mit folgenden Einstellungen:

| Einstellung | Wert |
|------------|------|
| **Name** | aria |
| **Repository** | `ghcr.io/<dein-username>/aria-dashboard:latest` |
| **Network Type** | Bridge |
| **WebUI** | `http://[IP]:[PORT:8080]` |

### Ports

| Container Port | Host Port | Beschreibung |
|---------------|-----------|--------------|
| 80 | 8080 | Web-Interface |

### Pfade (Volumes)

| Container Path | Host Path | Beschreibung |
|---------------|-----------|--------------|
| `/var/run/docker.sock` | `/var/run/docker.sock` | Docker Socket (Read-Only) |
| `/app/data` | `/mnt/user/appdata/aria` | Persistente Daten |

### Umgebungsvariablen

| Variable | Wert | Beschreibung |
|----------|------|--------------|
| `MONGO_URL` | `mongodb://mongo:27017` | MongoDB Verbindung |
| `DB_NAME` | `aria_dashboard` | Datenbankname |
| `JWT_SECRET` | `dein-geheimer-schlüssel` | **Ändere das!** |
| `FRONTEND_URL` | `http://deine-ip:8080` | Deine URL |
| `CORS_ORIGINS` | `*` | CORS Origins |

### MongoDB Container

Aria benötigt MongoDB. Installiere den offiziellen MongoDB Container:

| Einstellung | Wert |
|------------|------|
| **Name** | aria-mongo |
| **Repository** | `mongo:7` |
| **Volume** | `/data/db` → `/mnt/user/appdata/aria-mongo` |

## Docker Socket für Container-Erkennung

Um Docker-Container automatisch zu erkennen, muss der Docker Socket gemountet werden:

```
-v /var/run/docker.sock:/var/run/docker.sock:ro
```

**⚠️ Wichtig:** Das `:ro` am Ende bedeutet "read-only" - Aria kann Container nur lesen, nicht verändern.

## Erster Start (Setup Wizard)

1. Öffne `http://deine-ip:8080`
2. Der Setup-Wizard führt dich durch die Ersteinrichtung:
   - Admin-Account erstellen
   - Docker-Container auswählen
   - Fertig!

## Zugriff über Internet

Für den Zugriff von unterwegs empfehlen wir:

1. **Nginx Proxy Manager** auf Unraid installieren
2. Proxy Host erstellen für `aria.deine-domain.de`
3. SSL-Zertifikat (Let's Encrypt) aktivieren
4. In Aria die `FRONTEND_URL` entsprechend anpassen

## Entwicklung

### Voraussetzungen

- Node.js 20+
- Python 3.11+
- MongoDB
- Docker (optional)

### Lokale Entwicklung

```bash
# Backend starten
cd backend
pip install -r requirements.txt
uvicorn server:app --reload --port 8001

# Frontend starten (neues Terminal)
cd frontend
yarn install
yarn start
```

### Projektstruktur

```
aria-dashboard/
├── backend/           # FastAPI Backend
│   ├── server.py      # Hauptanwendung
│   └── requirements.txt
├── frontend/          # React Frontend
│   ├── src/
│   │   ├── pages/     # Seiten-Komponenten
│   │   └── components/# UI-Komponenten
│   └── package.json
├── Dockerfile         # Production Build
├── docker-compose.yml # Lokale Entwicklung
└── .github/
    └── workflows/     # GitHub Actions
```

## API Dokumentation

Nach dem Start erreichbar unter: `http://localhost:8001/docs`

### Wichtige Endpoints

| Endpoint | Methode | Beschreibung |
|----------|---------|--------------|
| `/api/setup/status` | GET | Setup-Status prüfen |
| `/api/setup/complete` | POST | Setup abschließen |
| `/api/auth/login` | POST | Anmelden |
| `/api/auth/me` | GET | Aktueller Benutzer |
| `/api/tiles` | GET/POST | Kacheln verwalten |
| `/api/docker/containers` | GET | Container auflisten |

## Lizenz

MIT License - Siehe [LICENSE](LICENSE)

## Support

Bei Problemen erstelle ein Issue auf GitHub.
