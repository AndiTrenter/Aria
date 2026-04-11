# Aria Dashboard v2.0

Ein sicheres, mobil optimiertes Web-Dashboard für Unraid mit **Star Trek LCARS** und **Disney** Theme.

## Features

- 🚀 **Dual Themes** - Star Trek LCARS & Disney Magical
- 👥 **User Management** - Admin-Panel mit Rollen und Rechten
- 🔗 **Service Integration** - CaseDesk, ForgePilot, Nextcloud
- 📊 **Health Monitoring** - System & Service Status
- 📜 **Activity Logs** - Alle Benutzeraktionen
- 💬 **Smart Chat** - Routing zu Services
- 🔐 **JWT Auth** - Sichere Authentifizierung

## Themes

### Star Trek LCARS
![LCARS Theme](docs/lcars.png)
- Orange/Schwarz Farbschema
- Sci-Fi Panels und Animationen
- High-Tech Interface

### Disney Magical
![Disney Theme](docs/disney.png)
- Märchenhafte UI mit Sternen
- Gradient Panels
- Magische Animationen

## Installation auf Unraid

### 1. MongoDB Container

```bash
docker run -d \
  --name aria-mongo \
  --network aria-network \
  -v /mnt/user/appdata/aria-mongo:/data/db \
  mongo:7
```

### 2. Aria Dashboard

```bash
docker run -d \
  --name aria \
  --network aria-network \
  -p 8080:80 \
  -e MONGO_URL=mongodb://aria-mongo:27017 \
  -e DB_NAME=aria_dashboard \
  -e JWT_SECRET=DeinSicheresGeheimesPasswort123! \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  ghcr.io/anditrenter/aria:latest
```

## Admin-Account

Beim ersten Start:
- **Email**: andi.trenter@gmail.com
- **Password**: Speedy@181279

## Benutzerrollen

| Rolle | Rechte |
|-------|--------|
| SuperAdmin | Alles |
| Admin | User & Services verwalten |
| User | Dashboard nutzen |
| ReadOnly | Nur lesen |

## Service-Freigaben

Admins können pro Benutzer festlegen:
- Welche Services sichtbar sind
- Ob Chat erlaubt ist
- Ob Logs/Health sichtbar sind

## API

Nach dem Start: `http://localhost:8080/api`

## Lizenz

MIT
