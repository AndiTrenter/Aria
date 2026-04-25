/**
 * Mic / SpeechRecognition readiness check.
 *
 * Browsers (Chrome/Edge/Firefox/Safari) ONLY allow getUserMedia and
 * SpeechRecognition on a "secure context": HTTPS, localhost, or 127.0.0.1.
 * Every other origin (incl. LAN IPs like 192.168.x.x and HTTP-only domains
 * like trenter.internet-box.ch) is blocked at the platform level — there is
 * no JS workaround.
 *
 * Returns: { ok, reason, hint }
 *  - ok=true → mic ready
 *  - ok=false with reason "no-api" → use Chrome/Edge
 *  - ok=false with reason "insecure" → set up HTTPS (Cloudflare Tunnel / Caddy / NPM)
 *  - ok=false with reason "denied" → user denied permission earlier; reset in browser settings
 */
export function checkMicReady() {
  if (typeof window === "undefined") return { ok: false, reason: "no-window" };
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    return {
      ok: false,
      reason: "no-api",
      hint: "Spracherkennung wird in diesem Browser nicht unterstützt. Bitte Chrome oder Edge verwenden.",
    };
  }
  const secure = !!window.isSecureContext;
  if (!secure) {
    return {
      ok: false,
      reason: "insecure",
      hint: "Mikrofon-Zugriff ist nur über HTTPS möglich (Browser-Sicherheitsregel). Aria läuft aktuell auf HTTP — der Browser erlaubt deshalb gar keine Mikrofon-Freigabe. Lösung: HTTPS einrichten (z.B. Cloudflare Tunnel, Nginx-Proxy-Manager mit Let's Encrypt, oder Tailscale Funnel).",
    };
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return {
      ok: false,
      reason: "no-mediadevices",
      hint: "Browser unterstützt navigator.mediaDevices nicht. Bitte Chrome oder Edge in aktueller Version verwenden.",
    };
  }
  return { ok: true };
}

/**
 * Try to actually request mic permission. Translates browser errors
 * (NotAllowedError / SecurityError / NotFoundError) into German user messages.
 */
export async function requestMicPermission() {
  const ready = checkMicReady();
  if (!ready.ok) return ready;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return { ok: true };
  } catch (e) {
    const name = e?.name || "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return {
        ok: false,
        reason: "denied",
        hint:
          "Mikrofon-Zugriff wurde abgelehnt. Klicke in der Browser-Adressleiste auf das Schloss/Info-Symbol → 'Mikrofon' → 'Zulassen' und lade die Seite neu.",
      };
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return { ok: false, reason: "no-device", hint: "Kein Mikrofon gefunden. Bitte Mikrofon anschließen / einschalten." };
    }
    if (name === "SecurityError") {
      return {
        ok: false,
        reason: "insecure",
        hint:
          "Browser blockiert Mikrofon (kein sicherer Kontext / kein HTTPS). HTTPS einrichten (Cloudflare Tunnel, Nginx-Proxy-Manager mit Let's Encrypt, Tailscale Funnel) — siehe Hilfe.",
      };
    }
    return { ok: false, reason: "unknown", hint: `Mikrofon-Fehler: ${e?.message || name || "unbekannt"}` };
  }
}
