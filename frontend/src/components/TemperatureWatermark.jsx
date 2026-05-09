import { useEffect, useState } from "react";

/**
 * Holographic temperature watermark.
 *
 * Sits in the background of ARIA mode, very subtle, large faint digits
 * showing the current outside temperature.  Updates every 5 minutes by
 * pulling /api/weather (uses whatever weather provider the user has
 * configured in settings).  Falls back silently if no weather data.
 *
 * Visual style:
 *   - 9rem semi-transparent number in the centre-right area
 *   - Mode-tinted (red/orange family to match the cortex palette)
 *   - Subtle pulsing glow animation
 *   - "AUSSEN-TEMPERATUR" tiny label above + ortname below
 *   - Sits at z-1 so the cortex (z-50) and HUD elements are unaffected
 */

const API = process.env.REACT_APP_BACKEND_URL || "";

export default function TemperatureWatermark() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const token = localStorage.getItem("aria_token") || sessionStorage.getItem("aria_token");
        const res = await fetch(`${API}/api/weather`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const j = await res.json();
        if (!alive) return;
        // Flexible parsing — backend may return {temp, location} or
        // {current: {temp_c, ...}, location: {name}} (different providers)
        let temp = null, loc = "";
        if (typeof j.temperature === "number") temp = Math.round(j.temperature);
        else if (typeof j.temp === "number") temp = Math.round(j.temp);
        else if (j.current?.temp_c != null) temp = Math.round(j.current.temp_c);
        else if (j.main?.temp != null) temp = Math.round(j.main.temp);
        loc = j.location?.name || j.location || j.name || j.city || "";
        if (temp != null) setData({ temp, loc });
      } catch { /* silent — watermark is optional */ }
    };
    load();
    const id = setInterval(load, 5 * 60 * 1000); // every 5 min
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!data) return null;

  return (
    <div
      aria-hidden
      data-testid="aria-temp-watermark"
      style={{
        position: "absolute",
        top: "32%",
        right: "8%",
        zIndex: 1,
        pointerEvents: "none",
        textAlign: "right",
        userSelect: "none",
        fontFamily: "ui-monospace, 'JetBrains Mono', 'Fira Code', monospace",
      }}
    >
      <div
        style={{
          fontSize: "0.75rem",
          letterSpacing: "0.5em",
          color: "rgba(255,170,90,0.45)",
          textShadow: "0 0 18px rgba(255,120,60,0.25)",
          marginBottom: "0.4em",
        }}
      >
        AUSSEN-TEMPERATUR
      </div>
      <div
        style={{
          fontSize: "8.5rem",
          fontWeight: 200,
          lineHeight: 1,
          color: "rgba(255,160,90,0.18)",
          textShadow:
            "0 0 32px rgba(255,120,60,0.35), 0 0 78px rgba(255,80,30,0.18)",
          letterSpacing: "-0.04em",
          animation: "aria-temp-pulse 4.2s ease-in-out infinite",
        }}
      >
        {data.temp}°
      </div>
      {data.loc && (
        <div
          style={{
            marginTop: "0.4em",
            fontSize: "0.7rem",
            letterSpacing: "0.4em",
            color: "rgba(255,170,90,0.35)",
            textTransform: "uppercase",
          }}
        >
          {data.loc}
        </div>
      )}
      <style>{`
        @keyframes aria-temp-pulse {
          0%, 100% { opacity: 0.85; filter: blur(0.4px); }
          50%      { opacity: 1.0;  filter: blur(0px); }
        }
      `}</style>
    </div>
  );
}
