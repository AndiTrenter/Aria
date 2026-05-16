import { useEffect, useState } from "react";

// Module-level guard so React 18 StrictMode's intentional double-mount
// in dev doesn't make us skip the boot intro on the second pass. In
// production this just means "play once per page-load", which is exactly
// what we want.
let _bootPlayed = false;

/**
 * BootReveal
 * ----------
 * Plays once on the very first mount of the React app (after the Capacitor
 * splash screen has faded away). Shows an animated neural cortex zooming &
 * pulsing into view, then fades out, handing control to whatever was rendered
 * underneath (login screen / aria mode).
 *
 * It's intentionally lightweight (pure CSS + SVG, no Three.js) so it boots
 * in <100 ms even on slow Android devices.
 */
export default function BootReveal({ durationMs = 1800 }) {
  // If we've already played in this page-load, skip immediately.
  const [phase, setPhase] = useState(() => (_bootPlayed ? "done" : "enter"));

  useEffect(() => {
    if (_bootPlayed) return;
    _bootPlayed = true;
    const t1 = setTimeout(() => setPhase("hold"),  600);
    const t2 = setTimeout(() => setPhase("leave"), durationMs - 500);
    const t3 = setTimeout(() => setPhase("done"),  durationMs);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [durationMs]);

  if (phase === "done") return null;

  return (
    <div
      className="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center"
      style={{
        background: "radial-gradient(circle at 50% 45%, #1a0a05 0%, #0a0612 55%, #020108 100%)",
        opacity: phase === "leave" ? 0 : 1,
        transition: "opacity 500ms ease-out",
      }}
      data-testid="aria-boot-reveal"
    >
      <svg
        viewBox="0 0 600 600"
        width="min(72vw, 460px)"
        height="min(72vw, 460px)"
        style={{
          transform:
            phase === "enter" ? "scale(0.35) rotate(-25deg)" :
            phase === "leave" ? "scale(1.12)"               :
            "scale(1) rotate(0deg)",
          opacity: phase === "enter" ? 0.15 : 1,
          transition: "transform 900ms cubic-bezier(.2,.9,.3,1.2), opacity 700ms ease-out",
          filter: "drop-shadow(0 0 30px rgba(255,90,30,0.55))",
        }}
      >
        <defs>
          <radialGradient id="boot-halo" cx="50%" cy="50%" r="55%">
            <stop offset="0%"  stopColor="rgba(255,150,80,0.55)"/>
            <stop offset="55%" stopColor="rgba(255,90,30,0.20)"/>
            <stop offset="100%" stopColor="rgba(120,20,0,0)"/>
          </radialGradient>
          <radialGradient id="boot-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%"  stopColor="#fff1cc"/>
            <stop offset="35%" stopColor="#ffb061"/>
            <stop offset="70%" stopColor="#ff5a1f"/>
            <stop offset="100%" stopColor="rgba(255,90,30,0)"/>
          </radialGradient>
          <style>{`
            @keyframes boot-spin-cw  { 0%{transform:rotate(0)}    100%{transform:rotate(360deg)} }
            @keyframes boot-spin-ccw { 0%{transform:rotate(0)}    100%{transform:rotate(-360deg)} }
            @keyframes boot-pulse    { 0%,100%{opacity:.85} 50%{opacity:1} }
            @keyframes boot-draw     {
              0%   { stroke-dashoffset: 1200; opacity:.0 }
              60%  { stroke-dashoffset: 0;    opacity:.9 }
              100% { stroke-dashoffset: 0;    opacity:.9 }
            }
          `}</style>
        </defs>

        <circle cx="300" cy="300" r="280" fill="url(#boot-halo)" />

        {/* Outer dashed orbits — rotate */}
        <g style={{ transformOrigin: "300px 300px", animation: "boot-spin-cw 18s linear infinite" }}
           fill="none" stroke="#ff8c4a" strokeWidth="1.4" opacity="0.45"
           strokeDasharray="3 6" strokeLinecap="round">
          <circle cx="300" cy="300" r="240"/>
          <ellipse cx="300" cy="300" rx="225" ry="135" transform="rotate(20 300 300)"/>
        </g>
        <g style={{ transformOrigin: "300px 300px", animation: "boot-spin-ccw 22s linear infinite" }}
           fill="none" stroke="#ff8c4a" strokeWidth="1.4" opacity="0.45"
           strokeDasharray="3 6" strokeLinecap="round">
          <ellipse cx="300" cy="300" rx="225" ry="135" transform="rotate(-30 300 300)"/>
          <ellipse cx="300" cy="300" rx="225" ry="75"  transform="rotate(60 300 300)"/>
        </g>

        {/* Geodesic dome — draws itself in */}
        <g fill="none" stroke="#ff7038" strokeWidth="1.8" opacity="0.9"
           style={{
             strokeDasharray: 1200,
             animation: "boot-draw 1100ms ease-out 100ms both, boot-pulse 2.4s ease-in-out 1100ms infinite",
           }}>
          <polygon points="300,120 466,212 466,388 300,480 134,388 134,212"/>
          <polygon points="300,120 466,212 466,388 300,480 134,388 134,212" transform="rotate(30 300 300)"/>
          <polygon points="300,170 426,250 386,395 214,395 174,250"/>
          <path d="M134,212 L466,388 M134,388 L466,212 M300,120 L300,480"/>
        </g>

        {/* Neural nodes — appear with a stagger */}
        <g fill="#ffd28a">
          {[
            [300,120],[466,212],[466,388],[300,480],[134,388],[134,212],
            [426,250],[386,395],[214,395],[174,250],
          ].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="5"
              style={{
                opacity: 0,
                animation: `boot-pulse 1.8s ease-in-out ${800 + i * 60}ms infinite, boot-draw 200ms linear ${600 + i * 60}ms both`,
              }}/>
          ))}
        </g>

        {/* Hot core — final flourish */}
        <circle cx="300" cy="300" r="115" fill="url(#boot-core)"
                style={{ animation: "boot-pulse 1.6s ease-in-out infinite" }} />
        <circle cx="300" cy="300" r="38" fill="#ffffff" opacity="0.95"/>
      </svg>

      <div
        className="absolute bottom-[18%] left-0 right-0 text-center"
        style={{
          color: "rgba(255,180,120,0.85)",
          fontFamily: "'Helvetica Neue', system-ui, sans-serif",
          letterSpacing: "0.6em",
          fontSize: "13px",
          fontWeight: 700,
          opacity: phase === "enter" ? 0 : phase === "leave" ? 0 : 1,
          transition: "opacity 600ms ease-out",
        }}
      >
        A . R . I . A .
        <div style={{ marginTop: 6, fontSize: 9, letterSpacing: "0.35em", opacity: 0.7 }}>
          ADAPTIVE REASONING INTELLIGENCE ASSISTANT
        </div>
      </div>
    </div>
  );
}
