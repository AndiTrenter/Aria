"""
Aria Version — Single Source of Truth.

Format: V <Services>.<FixCounter>
  - Services = Anzahl der Haupt-Features/Seiten
  - FixCounter = Fix-Nummer innerhalb der aktuellen Erweiterung (0 bei neuem Service)

Beispiele:
  V 5.0 → Start mit 5 Seiten (Smarthome, Health, Chat, Wetter, Media)
  V 5.4 → 4 Fixes für Media-Erweiterung
  V 6.0 → Nextcloud hinzugefügt (neuer Service)
  V 6.1 → 1 Fix zu Nextcloud

WICHTIG für Agenten: Bei jeder Änderung die Version hier aktualisieren!
  - Neuer Service/Seite → Major +1, Minor = 0
  - Fix/Improvement an bestehender Erweiterung → Minor +1
"""

ARIA_VERSION = "8.7"

# Aktuelle Services die in die Major-Version einfließen
ARIA_SERVICES = [
    "Smarthome",
    "Health",
    "Chat",
    "Wetter",
    "Media",
    "Themes",
    "CookPilot",
]

# Änderungs-Historie (neueste zuerst) — wird nicht fürs UI gebraucht, nur zur Nachvollziehbarkeit
ARIA_CHANGELOG = [
    {"version": "8.7", "date": "2026-04-30", "notes": "Telegram-Bot Auto-Restart-Watchdog: prüft alle 5 Min (konfigurierbar) ob der Bot wirklich pollt + Telegram erreichbar ist. Wenn `running=false` ODER letzter Poll >90s alt ODER getMe scheitert → Webhook proaktiv löschen + Bot neu starten. Behebt 409-Conflicts (paralleler Container), Network-Stalls und stille Polling-Hänger ohne manuelles Eingreifen. Neue Admin-UI: Watchdog-Toggle, Intervall, Stale-Schwelle, Counter (Checks/Auto-Restarts), letzter Check/Aktion. Health-Check-Button im Admin für sofortige On-Demand-Prüfung. Status wird alle 30s im Admin auto-refresht."},
    {"version": "8.6", "date": "2026-04-30", "notes": "FIX Einkaufsliste-Mengen: Wenn der User per Chat 'Brot auf die Einkaufsliste' sagt, wurde bisher amount=0 gespeichert (CookPilot zeigte 'Brot 0'). Jetzt: neuer Parser _parse_qty_unit_name extrahiert Menge + Einheit + Name aus jedem Item — Default-Menge=1 wenn nichts angegeben. Erkennt: '2 Liter Milch', '500g Mehl', '0,5 kg Butter', 'eine Flasche Wein', 'drei Eier', 'Becher Joghurt', '3 Stk Brot' und mehr. Funktioniert auch mit gemischten Listen ('Brot, 2 Liter Milch und Butter')."},
    {"version": "8.5", "date": "2026-04-29", "notes": "Star Wars Imperial Theme + 3 neue CookPilot-Action-Patterns: (1) Vorrat-Verbrauch '0.5 Liter Milch getrunken' → POST /pantry/{id}/adjust delta=-0.5; (2) Low-Stock-Query 'was geht zur Neige' → GET /pantry/low-stock + Aria fragt ob alles auf Einkaufsliste; (3) Rezept-zu-Liste 'setze die Zutaten für Lasagne auf die Einkaufsliste' → sucht Rezept + POST /shopping/from-recipe. Theme: pures Schwarz, Imperial-Rot (#E10600), Sterne-Hintergrund, Eckenakzente an Cards, Aurebesh-Style Typo, sharp Buttons mit Glow-Hover."},
    {"version": "8.4", "date": "2026-04-29", "notes": "KRITISCHER FIX: Aria konnte bisher nur Daten LESEN — bei 'Brot zur Einkaufsliste hinzufügen' hat GPT die Bestätigung halluziniert ohne CookPilot je aufzurufen. Jetzt: deterministische Action-Detection mit deutschen Patterns (set/füg/schreib/trag/leg X auf Einkaufsliste, X einkaufen, brauche X, ich habe X gekauft, hak X ab) parsed Items (kommagetrennt + 'und'), führt POST /api/shopping bzw. POST /shopping/{id}/toggle aus, injiziert verifiziertes Resultat in den GPT-Kontext. GPT bestätigt nur was tatsächlich passiert ist oder nennt den Fehler."},
    {"version": "8.3", "date": "2026-04-28", "notes": "Settings-Diagnose: interne Cache-Keys (Prefix '_' wie _cookpilot_health_cache) werden NICHT mehr in der Diagnose-Liste angezeigt — verhinderte fälschliches rotes X. Auch Settings-Export überspringt diese Cache-Keys, damit Backup-Dateien nur echte Config-Keys enthalten."},
    {"version": "8.2", "date": "2026-04-28", "notes": "CookPilot Field-Mapping Fix: CookPilot verwendet 'amount' (nicht 'quantity') und 'checked' (nicht 'bought'). Aria's _fmt_qty akzeptiert jetzt amount/quantity/qty/menge in dieser Reihenfolge — Vorrat/Einkaufsliste-Items mit Menge werden jetzt korrekt als '0.3 Liter' angezeigt. Shopping-Filter erkennt 'checked' UND 'bought' (forward-compat). Proxy-Endpoints für PATCH /pantry/{id}, POST /pantry/{id}/adjust, POST /shopping/{id}/toggle hinzugefügt. Aria-Version jetzt im LCARS-Header (neben Stardate), Disney-Topbar (neben Datum) und LCARS-Sidebar-Footer sichtbar."},
    {"version": "8.1", "date": "2026-04-28", "notes": "CookPilot Chat-Context Fix: (1) Vorrat-Items mit fehlender Menge werden klar als '(Menge nicht erfasst, Einheit X)' formatiert statt '- Milch: Liter' (was GPT als Wert='Liter' missverstand). (2) Pantry-Intent-Keywords erweitert: 'wieviel/wie viel/haben wir/habe ich/im kühlschrank' triggert jetzt CookPilot-Vorrat-Lookup. (3) Wenn der User nach einem konkreten Item fragt ('wieviel milch') wird der Vorrat danach gefiltert und als 'Treffer für deine Frage' zurückgegeben — GPT bekommt nicht mehr 15 unrelevante Items. (4) Einkaufsliste-Formatter verwendet jetzt denselben sauberen Quantity-Formatter."},
    {"version": "8.0", "date": "2026-04-28", "notes": "CookPilot-Integration (Phase 1): neuer Backend-Modul cookpilot.py mit SSO-Token-Handshake (POST /api/aria/sso, X-Aria-Secret), Proxy-Endpoints für Rezepte/Einkaufsliste/Vorrat/Wochenplan, Per-User-Permissions (12 Rechte). Service-Router erkennt Kochen/Rezept/Einkauf/Vorrat-Anfragen und routet automatisch — funktioniert in Chat, Sprache und Telegram. Aria Frontend: neuer Sidebar-Tab CookPilot mit Submenü gefiltert nach User-Rechten + Iframe-Pages für jeden Bereich. Admin-Tab DIENSTE → COOKPILOT für URL/Shared-Secret/Test."},
    {"version": "7.4", "date": "2026-04-22", "notes": "Mikrofon-UX bei HTTP: Klare Fehlermeldung statt stiller Block. Roter Mikro-Button + Banner über Chat-Eingabe + 12s Toast erklären, dass Browser Mikrofon ohne HTTPS sperrt. Neuer Helper /utils/micReady.js prüft secure context + Permission und liefert deutsche Hint-Texte (NotAllowedError, SecurityError, NotFoundError)."},
    {"version": "7.3", "date": "2026-04-22", "notes": "KRITISCHER FIX: Sticky-ForgePilot hijackte Cross-Domain-Queries → Dokument-/Wetter-/Smart-Home-Fragen landeten fälschlich bei ForgePilot und bekamen Dev-Output. Fix: Sticky-Session wird gebrochen, wenn Router eindeutig auf casedesk/plex/weather/homeassistant routet. ForgePilot-Volldelegation nur wenn es der EINZIGE Dienst ist. Zusätzlich: Aria sagt ehrlich wenn ein Dienst keine Treffer liefert statt zu halluzinieren. Service-Badge im Chat zeigt jetzt korrekt alle Routed-To Dienste als Liste. Neuer Endpoint /api/health/integrations für Connected-Services Status."},
    {"version": "7.2", "date": "2026-04-22", "notes": "Admin-UX: SH-Seiten ist jetzt Sub-Tab innerhalb SH-Builder (Seiten-Templates / Geräte-Checkliste). Assignment-Block hervorgehoben mit How-To-Banner und zeigt pro User live die aktuell zugewiesene Seite."},
    {"version": "7.1", "date": "2026-04-22", "notes": "Fix SH-Seiten: (1) get_current_user gibt sh_page_id zurück, damit /my-page den zugewiesenen Template liefert. (2) Assignment-Filter im ShPagesBuilder akzeptiert alle Nicht-Admin-Rollen (kind, erwachsener, gast, wandtablet, readonly) statt nur 'user'."},
    {"version": "7.0", "date": "2026-04-21", "notes": "SmartHome Seiten-Templates: Admin erstellt benannte Seiten mit Drag&Drop-Sektionen (Titel/Raum/Layout/Geräte), weist User zu. User sieht exakt die zugewiesene Seite."},
    {"version": "6.5", "date": "2026-04-21", "notes": "Fix: LCARS-Sidebar-Klicks hatten keinen onClick-Handler → jetzt spielen alle Nav-Klicks im Star-Trek-Theme den Ton"},
    {"version": "6.4", "date": "2026-04-21", "notes": "LCARS-Click-Sound hörbar gemacht (2-Ton statt 1-Ton, Volume+Duration erhöht)"},
    {"version": "6.3", "date": "2026-04-21", "notes": "Sound-Klicks bei JEDEM Menü-Klick (passend zum Theme) + User-Account-Toggle persistiert in DB (sound_effects_enabled)"},
    {"version": "6.2", "date": "2026-04-21", "notes": "Theme-Polish: Pro-Theme Sound-Effekte (procedural via Web Audio), Hover-Preview-Animation mit Akzentfarbe, Sound-Mute-Toggle im Theme-Submenu"},
    {"version": "6.1", "date": "2026-04-21", "notes": "Fix: Theme-Submenu wurde von Sidebar-Overflow abgeschnitten → React Portal mit fixed position"},
    {"version": "6.0", "date": "2026-04-21", "notes": "Multi-Theme-System: 4 Themes (Star Trek, Disney, Fortnite, Minesweeper). User-Default in Konto, globaler Default im Admin. Submenu statt Toggle."},
    {"version": "5.8", "date": "2026-04-21", "notes": "Auto-Logout bei 401 (stale JWT nach DB-Wipe invalidiert Session → sauberer Redirect zu Login)"},
    {"version": "5.7", "date": "2026-04-21", "notes": "Settings Backup/Import + Diagnose-UI (verhindert dauerhaften Key-Verlust bei Volume-Reset)"},
    {"version": "5.6", "date": "2026-04-21", "notes": "KRITISCHER FIX: Media-Grid Thumbnails — 'undefined' in Image-URL (process.env.REACT_APP_BACKEND_URL fallback)"},
    {"version": "5.5", "date": "2026-04-19", "notes": "Versionssystem + Plex Thumbnail Cache-Bust + Warm-up beim Login"},
    {"version": "5.4", "date": "2026-04-19", "notes": "Plex Thumbnail-Proxy komplett neu (Transcode + Shared Connection Pool)"},
    {"version": "5.3", "date": "2026-04-19", "notes": "Telegram Test-Button, Router-Historie, SMART/Disk-Temperaturen"},
    {"version": "5.2", "date": "2026-04-18", "notes": "Plex Chat-Intelligence + Admin Service-Registry UI"},
    {"version": "5.1", "date": "2026-04-18", "notes": "ForgePilot Integration"},
    {"version": "5.0", "date": "2026-04-17", "notes": "Basis: Smarthome, Health, Chat, Wetter, Media"},
]


def version_display() -> str:
    """Formatierte Version für Anzeige: 'V 5.4'"""
    return f"V {ARIA_VERSION}"
