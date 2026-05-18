import { useState, useEffect } from "react";
import { useAuth, useTheme, API, formatApiError } from "@/App";
import { toast } from "sonner";
import axios from "axios";
import { Eye, EyeSlash } from "@phosphor-icons/react";

const APP_VERSION = process.env.REACT_APP_APP_VERSION || "dev";
const IS_NATIVE = !!(typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.());

const Login = () => {
  const { login } = useAuth();
  const { theme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [ariaVersion, setAriaVersion] = useState("");
  const [updateChecking, setUpdateChecking] = useState(false);

  // Manual update check — useful when the in-app banner hasn't kicked in
  // yet (e.g. user just installed the APK and the 30-min poll didn't run).
  // When `silent=true` we don't toast "you already have the newest version",
  // only act when an actual update exists. Used by the auto-check on mount.
  const checkForUpdate = async (silent = false) => {
    const repo = process.env.REACT_APP_GITHUB_REPO || "AndiTrenter/Aria";
    setUpdateChecking(true);
    // Clear any previous dismiss so a newer version will always show up
    try { localStorage.removeItem("aria_update_skip_tag"); } catch {}
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=10`, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      const list = await res.json();
      let chosen = null, apk = null;
      for (const rel of (Array.isArray(list) ? list : [])) {
        const a = (rel?.assets || []).find((x) => /\.apk$/i.test(x.name));
        if (a) { chosen = rel; apk = a; break; }
      }
      if (!chosen || !apk) {
        if (!silent) toast.info("Noch kein Release mit APK gefunden.");
        return;
      }
      const latestTag = String(chosen.tag_name || "").replace(/^v/i, "");
      const current = String(APP_VERSION || "0.0.0").replace(/^v/i, "");
      // Naive semver-ish compare
      const cmp = (a, b) => {
        const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
        const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          if ((pa[i] || 0) > (pb[i] || 0)) return 1;
          if ((pa[i] || 0) < (pb[i] || 0)) return -1;
        }
        return 0;
      };
      if (cmp(latestTag, current) <= 0) {
        if (!silent) toast.success(`Du hast bereits die neueste Version (v${current}).`);
        return;
      }
      const go = window.confirm(
        `Neue Version v${latestTag} verfügbar (aktuell v${current}).\n\nJetzt herunterladen & installieren?`
      );
      if (go) {
        window.open(apk.browser_download_url, "_system");
      }
    } catch (e) {
      if (!silent) toast.error(`Update-Check fehlgeschlagen: ${e.message}`);
    } finally {
      setUpdateChecking(false);
    }
  };

  useEffect(() => {
    axios.get(`${API}/version`).then(r => setAriaVersion(r.data?.display || "")).catch(() => {});
    // Auto-check for a new APK every time the login screen is shown on
    // native (Android APK). Far more reliable than the 30-min background
    // poll and pops up a confirm-dialog right away if a newer release
    // exists with an APK asset. Harmless on web.
    if (IS_NATIVE) {
      const t = setTimeout(() => { checkForUpdate(true); }, 1200);
    }
    // One-time notice if user landed here because their session expired
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("reason") === "session-expired") {
        toast.warning("Deine Sitzung ist abgelaufen — bitte melde dich neu an.", { duration: 5000 });
        // Clean URL so refresh doesn't re-toast
        window.history.replaceState({}, "", "/login");
      }
    } catch {}
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.email || !formData.password) {
      toast.error("Bitte fülle alle Felder aus");
      return;
    }
    setLoading(true);
    try {
      await login(formData.email, formData.password);
      toast.success("Willkommen!");
    } catch (e) {
      // Build a meaningful error message. We MUST only call formatApiError
      // when there's an actual server-supplied detail — otherwise it returns
      // its generic fallback and masks the real network/CORS/HTTP problem.
      const detail = e?.response?.data?.detail;
      let msg;
      if (detail) {
        msg = formatApiError(detail);
      } else if (e?.code === "ERR_NETWORK" || /Network Error/i.test(e?.message || "")) {
        msg = `Server nicht erreichbar (Netzwerkfehler).\nURL: ${API}\nPrüfe Internet, DynDNS, Port-Forwarding & CORS.`;
      } else if (e?.response?.status === 401) {
        msg = "E-Mail oder Passwort ist falsch.";
      } else if (e?.response?.status === 0 || e?.message?.includes("CORS")) {
        msg = `CORS / Cross-Origin geblockt.\nURL: ${API}`;
      } else if (e?.response?.status >= 500) {
        msg = `Server-Fehler (${e.response.status}). Bitte ARIA-Container prüfen.`;
      } else if (e?.message) {
        msg = `Fehler: ${e.message}`;
      } else {
        msg = "Login fehlgeschlagen (unbekannter Fehler).";
      }
      toast.error(msg, { duration: 8000 });
      // Also log the full error to the console so it can be inspected via
      // chrome://inspect when needed.
      console.error("[ARIA] Login failed:", e);
    } finally {
      setLoading(false);
    }
  };

  if (theme === "startrek") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          {/* LCARS Frame around login */}
          <div className="mb-6">
            <div className="flex gap-2 mb-2">
              <div className="h-3 flex-1 bg-[var(--lcars-orange)] rounded-l-full rounded-r" />
              <div className="h-3 w-16 bg-[var(--lcars-mauve)] rounded" />
              <div className="h-3 w-10 bg-[var(--lcars-purple)] rounded-r-full" />
            </div>
            <h1 className="text-4xl font-bold tracking-[0.3em] text-center text-[var(--lcars-orange)] my-6">ARIA</h1>
            <p className="text-center text-xs tracking-[0.2em] text-gray-500">ZUGANGSPORTAL</p>
          </div>

          <div className="lcars-card">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="lcars-label block mb-2">BENUTZER-ID</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="name@domain.com"
                  className="lcars-input w-full"
                  data-testid="login-email-input"
                />
              </div>
              <div>
                <label className="lcars-label block mb-2">ZUGANGSCODE</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="..."
                    className="lcars-input w-full pr-10"
                    data-testid="login-password-input"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--lcars-purple)]">
                    {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={loading} className="lcars-button w-full h-12 text-lg" data-testid="login-submit-button">
                {loading ? "AUTHENTIFIZIERUNG..." : "ZUGANG GEWÄHREN"}
              </button>
            </form>
          </div>

          <div className="flex gap-2 mt-4">
            <div className="h-2 flex-1 bg-[var(--lcars-blue)] rounded-l-full rounded-r" />
            <div className="h-2 w-20 bg-[var(--lcars-salmon)] rounded" />
            <div className="h-2 flex-1 bg-[var(--lcars-purple)] rounded-r-full" />
          </div>
          <p className="text-center text-gray-700 text-[10px] mt-4 tracking-[0.2em]" data-testid="login-version">
            ARIA {ariaVersion || "..."} · LCARS INTERFACE
          </p>
          {IS_NATIVE && (
            <div className="mt-4 p-3 rounded border border-orange-500/30 bg-orange-500/5 text-center space-y-2">
              <p
                className="text-orange-300 font-bold tracking-widest"
                style={{ fontSize: "15px", textTransform: "none" }}
                data-testid="login-app-version"
              >
                APP-VERSION v{APP_VERSION}
              </p>
              <p className="text-[10px] text-orange-200/70 break-all px-2" style={{ textTransform: "none" }}>
                Server: {API}
              </p>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={checkForUpdate}
                  disabled={updateChecking}
                  className="text-[11px] px-3 py-1.5 rounded bg-orange-500/20 text-orange-200 border border-orange-400/40 hover:bg-orange-500/30 disabled:opacity-50"
                  style={{ textTransform: "none" }}
                  data-testid="login-check-update-btn"
                >
                  {updateChecking ? "Prüfe …" : "🔄  Auf Update prüfen"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("Server-URL zurücksetzen und neu eingeben?")) {
                      localStorage.removeItem("aria_server_url");
                      localStorage.removeItem("aria_token");
                      localStorage.removeItem("aria_user");
                      window.location.href = "/mobile-config";
                    }
                  }}
                  className="text-[10px] text-orange-400/70 underline tracking-wider"
                  style={{ textTransform: "none" }}
                  data-testid="login-reset-url-btn"
                >
                  Server-URL ändern
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative z-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="disney-title text-4xl font-bold disney-glow">Aria</h1>
          <p className="text-purple-300 mt-2">Willkommen zurück in deinem Königreich</p>
        </div>
        <div className="disney-panel p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm text-purple-300 mb-2">E-Mail</label>
              <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="deine@email.com" className="disney-input w-full" data-testid="login-email-input" />
            </div>
            <div>
              <label className="block text-sm text-purple-300 mb-2">Passwort</label>
              <div className="relative">
                <input type={showPassword ? "text" : "password"} value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="..." className="disney-input w-full pr-10" data-testid="login-password-input" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-400">
                  {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading} className="disney-button w-full h-12 text-lg" data-testid="login-submit-button">
              {loading ? "Einen Moment..." : "Eintreten"}
            </button>
          </form>
        </div>
        <p className="text-center text-purple-400 text-sm mt-6" data-testid="login-version">Aria Dashboard · {ariaVersion || "..."}</p>
      </div>
    </div>
  );
};

export default Login;
