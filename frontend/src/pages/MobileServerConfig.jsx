import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "sonner";

/**
 * MobileServerConfig
 * ------------------
 * Shown on the very first launch of the Android APK (Capacitor native).
 * The user enters the URL of THEIR own ARIA backend (e.g. on Unraid).
 * Once saved, it is persisted to localStorage and the app reloads so all
 * API calls (computed once on module load in App.js) use the new base URL.
 */
const normaliseUrl = (raw) => {
  let url = (raw || "").trim();
  if (!url) return "";
  // Strip trailing slashes
  url = url.replace(/\/+$/, "");
  // If user forgot scheme, default to http (local network)
  if (!/^https?:\/\//i.test(url)) url = "http://" + url;
  return url;
};

// Common port the ARIA backend runs on — we try this as a fallback if
// the user enters a bare hostname without a port and the first attempt fails.
const DEFAULT_BACKEND_PORTS = [8001, 80, 443];

const DEFAULT_SUGGESTION = "https://www.trenter.internet-box.ch:8001";

export default function MobileServerConfig() {
  const [url, setUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [showHelp, setShowHelp] = useState(false);

  // Suggest user's previously saved value (in case of re-config),
  // otherwise pre-fill the personal DynDNS URL.
  useEffect(() => {
    const prev = localStorage.getItem("aria_server_url");
    setUrl(prev || DEFAULT_SUGGESTION);
  }, []);

  // Try a single URL — return true if it looks like an ARIA backend.
  const probe = async (target) => {
    try {
      const res = await axios.get(`${target}/api/setup/status`, { timeout: 6000 });
      return typeof res.data?.setup_completed === "boolean";
    } catch {
      return false;
    }
  };

  const save = async () => {
    setError("");
    const clean = normaliseUrl(url);
    if (!clean) {
      setError("Bitte eine gültige URL eingeben");
      return;
    }
    setTesting(true);
    try {
      // 1) Try the user's URL exactly as entered
      let working = (await probe(clean)) ? clean : null;

      // 2) If no port was specified, also try common ARIA ports
      if (!working) {
        const hasExplicitPort = /:\d+(\/|$)/.test(clean.replace(/^https?:\/\//, ""));
        if (!hasExplicitPort) {
          for (const port of DEFAULT_BACKEND_PORTS) {
            const candidate = `${clean}:${port}`;
            if (await probe(candidate)) { working = candidate; break; }
          }
        }
      }

      if (!working) {
        throw new Error("not-reachable");
      }

      localStorage.setItem("aria_server_url", working);
      toast.success("Verbindung erfolgreich!");
      setTimeout(() => { window.location.href = "/"; }, 500);
    } catch (e) {
      setShowHelp(true);
      setError(
        "Server nicht erreichbar. Häufige Ursachen:\n" +
        "• Port-Weiterleitung am Router fehlt\n" +
        "• Falscher Port (ARIA läuft meist auf 8001)\n" +
        "• ARIA-Container auf Unraid ist nicht gestartet\n" +
        "• HTTPS-Zertifikat fehlt (versuche http:// statt https://)"
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      data-testid="mobile-server-config"
      className="min-h-screen bg-gradient-to-br from-[#0a0f1c] via-[#101828] to-[#0a0f1c] flex items-center justify-center p-6"
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 mb-4 shadow-[0_0_40px_rgba(255,90,30,0.4)]">
            <span className="text-3xl font-bold text-white">A</span>
          </div>
          <h1 className="text-3xl font-bold text-orange-400 tracking-wider">A.R.I.A.</h1>
          <p className="text-sm text-orange-200/70 mt-2">Verbindung zum ARIA-Server einrichten</p>
        </div>

        <div className="bg-black/40 backdrop-blur-md border border-orange-500/30 rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-sm text-orange-200/80 mb-2">
              Server-URL
            </label>
            <input
              data-testid="server-url-input"
              type="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://www.trenter.internet-box.ch:8001"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-[#0a0f1c] border border-orange-500/40 text-orange-100 placeholder-orange-200/30 focus:outline-none focus:border-orange-400"
            />
            <div className="mt-2 space-y-1">
              <p className="text-xs text-orange-200/60" style={{ textTransform: "none" }}>
                Beispiele:
              </p>
              <button
                type="button"
                onClick={() => setUrl("https://www.trenter.internet-box.ch:8001")}
                className="block text-xs text-orange-300/80 hover:text-orange-200 underline"
              >
                https://www.trenter.internet-box.ch:8001 <span className="opacity-60">(DynDNS, von überall)</span>
              </button>
              <button
                type="button"
                onClick={() => setUrl("http://192.168.1.140:8001")}
                className="block text-xs text-orange-300/80 hover:text-orange-200 underline"
              >
                http://192.168.1.140:8001 <span className="opacity-60">(lokal, nur im WLAN)</span>
              </button>
            </div>
          </div>

          {error && (
            <div
              data-testid="server-config-error"
              className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-3 whitespace-pre-line"
              style={{ textTransform: "none" }}
            >
              {error}
            </div>
          )}

          <button
            data-testid="server-config-save-btn"
            disabled={testing || !url.trim()}
            onClick={save}
            className="w-full py-3 rounded-lg bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed text-white font-semibold tracking-wide transition-all shadow-lg"
          >
            {testing ? "Verbinde…" : "Verbinden & Speichern"}
          </button>

          {showHelp && (
            <details className="text-xs text-orange-200/70 bg-black/30 border border-orange-500/20 rounded-lg p-3" open>
              <summary className="cursor-pointer text-orange-300 font-semibold mb-2" style={{ textTransform: "none" }}>
                💡 Hilfe zum Port-Forwarding
              </summary>
              <div className="space-y-2 mt-2" style={{ textTransform: "none" }}>
                <p>Damit die DynDNS-Adresse von unterwegs funktioniert, brauchst du Port-Weiterleitung in deiner Internet-Box:</p>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Internet-Box öffnen: <code className="text-orange-300">http://192.168.1.1</code></li>
                  <li>Heimnetzwerk → Port-Weiterleitung</li>
                  <li>Neue Regel: Externer Port <code className="text-orange-300">8001</code> → Ziel-IP (Unraid) <code className="text-orange-300">192.168.1.140</code> → Ziel-Port <code className="text-orange-300">8001</code></li>
                  <li>Speichern, dann hier nochmal „Verbinden" klicken</li>
                </ol>
                <p className="mt-2">Alternativ kannst du auch erstmal die lokale IP im eigenen WLAN nutzen.</p>
              </div>
            </details>
          )}
        </div>

        <p className="text-center text-xs text-orange-200/40 mt-6">
          Die URL wird lokal gespeichert. Du kannst sie später in den
          Einstellungen ändern.
        </p>
      </div>
    </div>
  );
}
