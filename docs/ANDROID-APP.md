# A.R.I.A. — Android-App (Capacitor)

Diese Anleitung erklärt, wie du die A.R.I.A.-Webanwendung als installierbare
Android-App über GitHub Actions automatisch baust und im Selbst-Update-Modus
verteilst.

---

## 1. Vorbereitung im GitHub-Repository

1. **Repo anlegen** und den `/app`-Inhalt dorthin pushen
   (z.B. `git@github.com:dein-user/aria-dashboard.git`).

2. **Secrets** in `Settings → Secrets and variables → Actions → New repository secret`
   anlegen:

   | Name | Inhalt |
   | --- | --- |
   | `PROD_BACKEND_URL` | Öffentliche URL deines Backends, z.B. `https://aria.example.com` |
   | `ANDROID_KEYSTORE_BASE64` | (optional, nur für signierte Release-APKs) Base64-encoded `.jks`-Datei |
   | `ANDROID_KEYSTORE_PASSWORD` | (optional) Keystore-Passwort |
   | `ANDROID_KEY_ALIAS` | (optional) Schlüssel-Alias |
   | `ANDROID_KEY_PASSWORD` | (optional) Schlüssel-Passwort |

   ### Keystore erzeugen (einmalig auf deinem Rechner)
   ```bash
   keytool -genkey -v -keystore aria-release.jks \
           -alias aria-key -keyalg RSA -keysize 2048 -validity 36500
   # → fragt nach Keystore-Passwort, Alias-Passwort, Name etc.

   # In Base64 für GitHub Secrets:
   base64 -w 0 aria-release.jks   # Linux
   base64 aria-release.jks        # macOS
   ```
   Das Ergebnis als `ANDROID_KEYSTORE_BASE64` einsetzen.

---

## 2. Build-Trigger

Der Workflow `.github/workflows/build-android.yml` läuft automatisch:

* **Push auf `main`** → Debug-APK als GitHub-Action-Artefakt (zum Testen).
* **Push eines Tags `vX.Y.Z`** → Release-APK wird signiert und als
  GitHub-Release veröffentlicht. Der `UpdateNotifier` in der App findet
  dieses Release über die GitHub-API und bietet das Update an.

```bash
# Erstes Release veröffentlichen:
git tag v1.0.0
git push origin v1.0.0
```

---

## 3. In-App-Auto-Update

* Die App pollt beim Start und alle 6 h
  `https://api.github.com/repos/<owner>/<repo>/releases/latest`.
* Wenn die `tag_name` größer ist als die in der App eingebackene
  `REACT_APP_APP_VERSION`, erscheint unten ein orange-rotes Banner mit
  „Aktualisieren" und „Später".
* Bei „Aktualisieren" öffnet sich die APK-URL im System-Downloader →
  Android-Paketinstaller fragt nach Bestätigung → fertig.
* "Später" merkt sich die abgelehnte Version (LocalStorage), das Banner
  erscheint erst beim nächsten Release wieder.

Der Download-Link ist außerdem im **Konto-Menü → "A.R.I.A. — Android-App"**
permanent verfügbar.

---

## 4. Mikrofon + Wake-Word „Aria"

Der Workflow patcht das `AndroidManifest.xml` automatisch um folgende
Permissions:

* `RECORD_AUDIO` — Mikrofonzugriff
* `MODIFY_AUDIO_SETTINGS` — Wake-Word-Listener
* `WAKE_LOCK` — Screen bleibt im Vollbild-Modus an
* `ACCESS_NETWORK_STATE` — Online/Offline-Erkennung

Beim ersten Start fragt Android per System-Dialog nach
Mikrofon-Berechtigung. Die WebView von Capacitor leitet
`navigator.mediaDevices.getUserMedia` + `webkitSpeechRecognition`
nativ weiter — die existierende Wake-Word-Logik aus `AriaMode.jsx`
funktioniert unverändert.

> Falls auf deinem Gerät die Web-API unzuverlässig ist (alte Android-Version,
> kein Google-Speech-Service installiert), kann später das Plugin
> `@capacitor-community/speech-recognition` ergänzt werden — die Schnittstelle
> bleibt gleich.

---

## 5. Lokal testen (optional)

```bash
cd frontend
yarn build
npx cap add android   # einmalig, scaffoldet den android/ Ordner
npx cap sync android
npx cap open android  # öffnet Android Studio
# oder direkt vom Terminal:
cd android && ./gradlew assembleDebug
```

Die gebaute APK liegt unter
`frontend/android/app/build/outputs/apk/debug/app-debug.apk`.

---

## 6. .gitignore-Empfehlungen

Folgende Pfade gehören NICHT ins Repo, der GitHub-Action-Build erstellt sie
selbst:

```
frontend/android/
frontend/build/
frontend/node_modules/
```
