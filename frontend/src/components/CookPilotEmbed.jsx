import { useState, useEffect } from "react";
import axios from "axios";
import { API, useTheme } from "@/App";
import { ArrowSquareOut, Warning } from "@phosphor-icons/react";

/**
 * CookPilot embedded view. Fetches SSO token + URL from Aria backend, builds
 * an iframe URL with the token in a query param, and displays it inside Aria.
 *
 * The token is also posted via window.postMessage(name=aria-sso-token) once
 * the iframe loads so that future CookPilot frontend versions can pick it up
 * without exposing the JWT in the URL bar.
 */
const CookPilotEmbed = ({ section = "", title = "CookPilot" }) => {
  const { theme } = useTheme();
  const isLcars = theme === "startrek";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API}/cookpilot/sso-token`);
        if (!cancelled) setData(r.data);
      } catch (e) {
        if (!cancelled) setErr(e.response?.data?.detail || "CookPilot ist nicht konfiguriert oder nicht erreichbar.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [section]);

  const onIframeLoad = (e) => {
    if (!data?.token) return;
    try {
      e.target.contentWindow?.postMessage({ type: "aria-sso-token", token: data.token }, data.url || "*");
    } catch {}
  };

  if (loading) {
    return (
      <div className="p-6" data-testid="cookpilot-embed">
        <div className={`animate-pulse text-xl ${isLcars ? "text-[var(--lcars-orange)] tracking-wider" : "text-purple-300"}`}>
          {isLcars ? "VERBINDE MIT COOKPILOT..." : "Verbinde mit CookPilot..."}
        </div>
      </div>
    );
  }

  if (err || !data?.url) {
    return (
      <div className="p-6" data-testid="cookpilot-embed-error">
        <div className={`p-4 rounded-lg ${isLcars ? "bg-red-950/40 border border-red-500/40 text-red-300" : "bg-red-950/30 border border-red-500/30 text-red-200"}`}>
          <div className="flex items-center gap-2 font-bold mb-2"><Warning size={18} /> CookPilot nicht verfügbar</div>
          <p className="text-xs leading-relaxed" style={{ textTransform: "none" }}>
            {err || "URL oder Shared Secret fehlt. Bitte im Admin → Dienste → CookPilot konfigurieren."}
          </p>
        </div>
      </div>
    );
  }

  // Build iframe URL with section and token query (CookPilot frontend reads ?aria_sso=)
  const ssoParam = data.token ? `?aria_sso=${encodeURIComponent(data.token)}` : "";
  const sectionPath = section ? `/${section.replace(/^\//, "")}` : "/";
  const src = `${data.url}${sectionPath}${ssoParam}`;

  return (
    <div className="flex flex-col h-[calc(100vh-50px)]" data-testid={`cookpilot-page-${section || "root"}`}>
      <div className={`flex items-center gap-3 px-4 py-2 ${isLcars ? "bg-[#0a0a14] border-b border-[var(--lcars-orange)]/30" : "bg-purple-950/40 border-b border-purple-700/40"}`}>
        <h2 className={`${isLcars ? "text-sm tracking-widest text-[var(--lcars-orange)]" : "text-base font-bold text-purple-200"}`}>
          {isLcars ? `COOKPILOT ▸ ${title.toUpperCase()}` : `CookPilot › ${title}`}
        </h2>
        <div className="flex-1" />
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className={`text-[11px] flex items-center gap-1 ${isLcars ? "text-[var(--lcars-blue)] hover:text-[var(--lcars-orange)]" : "text-purple-400 hover:text-purple-200"}`}
          data-testid="cookpilot-open-external"
          style={{ textTransform: "none" }}
        >
          <ArrowSquareOut size={12} /> Im neuen Tab öffnen
        </a>
      </div>
      <iframe
        src={src}
        title={`CookPilot ${title}`}
        className="flex-1 w-full bg-white"
        onLoad={onIframeLoad}
        data-testid="cookpilot-iframe"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
      />
    </div>
  );
};

export default CookPilotEmbed;
