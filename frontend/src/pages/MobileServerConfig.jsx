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

export default function MobileServerConfig() {
  const [url, setUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  // Suggest user's previously saved value (in case of re-config)
  useEffect(() => {
    const prev = localStorage.getItem("aria_server_url");
    if (prev) setUrl(prev);
  }, []);

  const save = async () => {
    setError("");
    const clean = normaliseUrl(url);
    if (!clean) {
      setError("Bitte eine gültige URL eingeben");
      return;
    }
    setTesting(true);
    try {
      // Hit /api/setup/status as a lightweight probe — it works whether
      // setup is completed or not, and is unauthenticated.
      const res = await axios.get(`${clean}/api/setup/status`, { timeout: 8000 });
      if (typeof res.data?.setup_completed !== "boolean") {
        throw new Error("Antwort ist kein ARIA-Backend");
      }
      localStorage.setItem("aria_server_url", clean);
      toast.success("Verbindung erfolgreich!");
      // Tiny delay so the toast is visible, then hard reload
      setTimeout(() => { window.location.href = "/"; }, 500);
    } catch (e) {
      const msg = e?.message?.includes("Network Error")
        ? "Server nicht erreichbar. Prüfe IP, Port und ob ARIA läuft."
        : e?.message?.includes("timeout")
        ? "Timeout — Server antwortet nicht."
        : e?.message || "Verbindung fehlgeschlagen";
      setError(msg);
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
              placeholder="http://192.168.1.50:8001"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-[#0a0f1c] border border-orange-500/40 text-orange-100 placeholder-orange-200/30 focus:outline-none focus:border-orange-400"
            />
            <p className="text-xs text-orange-200/50 mt-2">
              Beispiel: <code className="text-orange-300">http://192.168.1.50:8001</code><br />
              (deine Unraid-IP &amp; ARIA-Port)
            </p>
          </div>

          {error && (
            <div
              data-testid="server-config-error"
              className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3"
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
        </div>

        <p className="text-center text-xs text-orange-200/40 mt-6">
          Die URL wird lokal gespeichert. Du kannst sie später in den
          Einstellungen ändern.
        </p>
      </div>
    </div>
  );
}
