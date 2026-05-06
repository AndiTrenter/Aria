import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, API } from "@/App";
import axios from "axios";
import { toast } from "sonner";
import {
  Microphone, X, MapTrifold, EnvelopeSimple,
  Brain, PaperPlaneTilt, CheckCircle, CircleNotch,
  SignOut, SpeakerHigh
} from "@phosphor-icons/react";
import CortexCloud from "@/components/CortexCloud";
import { checkMicReady, requestMicPermission } from "@/utils/micReady";
import { speakStreaming, stripMarkdownForTTS } from "@/utils/ttsPlayer";

/*  ────────────────────────────────────────────────────────────────────
    INTENT PARSERS – deterministic client-side detection for the two
    "special" flows the user asked for (Route → Maps, Email → Thinking).
    Everything else falls through to the normal /api/chat pipeline, which
    already handles CaseDesk, CookPilot, weather, smart-home, etc.
    ──────────────────────────────────────────────────────────────────── */

function parseRouteIntent(text) {
  const t = text.trim();
  const low = t.toLowerCase();
  if (!/\b(route|wegbeschreibung|navigation|navigiere|fahr|weg nach|wie komme ich)\b/.test(low)) {
    return null;
  }
  // "route von X nach Y"
  let m = t.match(/route\s+von\s+(.+?)\s+nach\s+(.+?)[.?!]?$/i);
  if (m) return { origin: m[1].trim(), destination: m[2].trim() };
  // "wie komme ich von X nach Y"
  m = t.match(/wie\s+komme?\s+ich\s+von\s+(.+?)\s+(?:nach|zum?)\s+(.+?)[.?!]?$/i);
  if (m) return { origin: m[1].trim(), destination: m[2].trim() };
  // "navigiere mich nach X" / "route zu X" / "route nach X"
  m = t.match(/(?:navigiere\s+mich\s+nach|route\s+(?:zum?|nach)|wegbeschreibung\s+(?:zum?|nach)|fahr\s+mich\s+(?:zum?|nach))\s+(.+?)[.?!]?$/i);
  if (m) return { origin: null, destination: m[1].trim() };
  // "wie komme ich (am besten) nach X"
  m = t.match(/wie\s+komme?\s+ich\s+(?:am\s+besten\s+)?(?:zum?|nach)\s+(.+?)[.?!]?$/i);
  if (m) return { origin: null, destination: m[1].trim() };
  return null;
}

function parseEmailIntent(text) {
  const t = text.toLowerCase();
  // Must mention email/mail AND a compose verb. This keeps "lies mir die
  // letzten Mails vor" out (that's CaseDesk read, not compose).
  const hasMailWord = /\b(e[- ]?mail|mail|nachricht)\b/.test(t);
  const hasComposeVerb = /\b(schreib|verfass|sende|schick|formuliere|entwirf|aufsetzen)\b/.test(t);
  if (hasMailWord && hasComposeVerb) return true;
  // Also: "schreib an <x> eine email" patterns
  if (/schreib\b.*\b(e[- ]?mail|mail)/.test(t)) return true;
  return false;
}

/*  ────────────────────────────────────────────────────────────────── */

const THINKING_STEPS_EMAIL = [
  { id: "parse",     label: "Analysiere Anfrage",         delay: 0    },
  { id: "recipient", label: "Identifiziere Empfänger",    delay: 900  },
  { id: "subject",   label: "Formuliere Betreff",         delay: 1900 },
  { id: "body",      label: "Schreibe E-Mail-Text",       delay: 2900 },
  { id: "tone",      label: "Prüfe Ton & Grammatik",      delay: 4100 },
  { id: "finalize",  label: "Entwurf fertigstellen",      delay: 5300 },
];

const THINKING_STEPS_CHAT = [
  { id: "parse",    label: "Verstehe Anfrage",          delay: 0    },
  { id: "route",    label: "Wähle passende Dienste",    delay: 700  },
  { id: "fetch",    label: "Hole Live-Daten",           delay: 1600 },
  { id: "reason",   label: "Denke nach",                delay: 2600 },
  { id: "respond",  label: "Formuliere Antwort",        delay: 3600 },
];

/* ──────────────────────────────────────────────────────────────────── */

const AriaMode = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  // voice state machine
  const [mode, setMode] = useState("idle"); // idle | wakeword | listening | thinking | speaking
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [error, setError] = useState("");
  const [booting, setBooting] = useState(true);

  // thinking overlay
  const [thinking, setThinking] = useState(null);
  // thinking = null | { kind: "email"|"chat", steps: [{id,label,status}], result?: {body,meta} }

  // maps overlay
  const [mapsOverlay, setMapsOverlay] = useState(null);
  // { origin, destination, embedUrl, externalUrl }

  // cortex intensity (drives animation)
  const [intensity, setIntensity] = useState(0.25);

  const recognitionRef = useRef(null);
  const stateRef = useRef(mode);
  const ttsCtrlRef = useRef(null);
  const thinkingTimersRef = useRef([]);
  const bootRef = useRef(false);

  useEffect(() => { stateRef.current = mode; }, [mode]);

  /* ─── cortex intensity mapping ───────────────────────────────────── */
  useEffect(() => {
    if (mode === "speaking")      setIntensity(0.95);
    else if (mode === "listening") setIntensity(0.65);
    else if (mode === "thinking")  setIntensity(0.55);
    else if (mode === "wakeword")  setIntensity(0.32);
    else                           setIntensity(0.22);
  }, [mode]);

  /* ─── Boot-in fade ───────────────────────────────────────────────── */
  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 1500);
    return () => clearTimeout(t);
  }, []);

  /* ─── Boot greeting (one-time per session, only when this mode opens) ─ */
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    const firstName = (user?.name || "").split(" ")[0] || "Commander";
    const text = `A.R.I.A. online. Willkommen zurück, ${firstName}. Systeme bereit. Wie kann ich helfen?`;
    setResponse(text);
    setMode("speaking");
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setMode("idle");
      startWakeWord();
    };
    try {
      ttsCtrlRef.current = speakStreaming(text, {
        onEnd: finish,
        onError: finish,
      });
    } catch {
      finish();
    }
    // Safety fallback: if TTS never reports end/error (e.g. 400 no key,
    // nothing to play, browser blocks audio), proceed after 3.5s.
    const safety = setTimeout(finish, 3500);
    return () => clearTimeout(safety);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── Cleanup ────────────────────────────────────────────────────── */
  const stopAll = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch {}
    try { window.speechSynthesis?.cancel(); } catch {}
    try { ttsCtrlRef.current?.stop(); } catch {}
    ttsCtrlRef.current = null;
    thinkingTimersRef.current.forEach((t) => clearTimeout(t));
    thinkingTimersRef.current = [];
  }, []);

  useEffect(() => () => stopAll(), [stopAll]);

  /* ─── Speech: wake-word loop ─────────────────────────────────────── */
  const startWakeWord = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    try { recognitionRef.current?.stop(); } catch {}

    const rec = new SR();
    rec.lang = "de-DE";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.toLowerCase();
        if (t.includes("aria") || t.includes("arya")) {
          try { rec.stop(); } catch {}
          startListening();
          return;
        }
      }
    };
    rec.onerror = (ev) => {
      if (ev.error === "no-speech" || ev.error === "aborted") {
        if (stateRef.current === "wakeword") setTimeout(() => startWakeWord(), 500);
      }
    };
    rec.onend = () => {
      if (stateRef.current === "wakeword") setTimeout(() => startWakeWord(), 300);
    };

    recognitionRef.current = rec;
    setMode("wakeword");
    try { rec.start(); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── Speech: active dictation after wake-word ───────────────────── */
  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    try { recognitionRef.current?.stop(); } catch {}

    const rec = new SR();
    rec.lang = "de-DE";
    rec.continuous = false;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let final = "", interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t; else interim += t;
      }
      setTranscript(final || interim);
      if (final) handleUserUtterance(final);
    };
    rec.onerror = (ev) => {
      if (ev.error !== "no-speech" && ev.error !== "aborted") setError(ev.error);
      setMode("idle");
      setTimeout(() => startWakeWord(), 800);
    };
    rec.onend = () => {
      if (stateRef.current === "listening") {
        setMode("idle");
        setTimeout(() => startWakeWord(), 500);
      }
    };

    recognitionRef.current = rec;
    setMode("listening");
    setTranscript("");
    setResponse("");
    setError("");
    try { rec.start(); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const manualMic = async () => {
    const ready = checkMicReady();
    if (!ready.ok) { toast.error(ready.hint, { duration: 8000 }); return; }
    const perm = await requestMicPermission();
    if (!perm.ok) { toast.error(perm.hint, { duration: 8000 }); return; }
    if (mode === "speaking") { try { ttsCtrlRef.current?.stop(); } catch {} ; setMode("idle"); return; }
    startListening();
  };

  // Typed command fallback — useful on devices without mic access.
  const [typedCmd, setTypedCmd] = useState("");
  const submitTyped = (e) => {
    e?.preventDefault?.();
    const t = typedCmd.trim();
    if (!t) return;
    setTypedCmd("");
    try { ttsCtrlRef.current?.stop(); } catch {}
    try { recognitionRef.current?.stop(); } catch {}
    handleUserUtterance(t);
  };

  /* ─── Intent dispatcher ──────────────────────────────────────────── */
  const handleUserUtterance = async (text) => {
    const routeIntent = parseRouteIntent(text);
    if (routeIntent) {
      await handleRouteIntent(routeIntent);
      return;
    }
    if (parseEmailIntent(text)) {
      await handleEmailIntent(text);
      return;
    }
    await handleChatIntent(text);
  };

  /* ─── Route → Google Maps ────────────────────────────────────────── */
  const buildMapsUrls = (origin, destination) => {
    const o = origin ? encodeURIComponent(origin) : "";
    const d = encodeURIComponent(destination);
    // Embeddable iframe URL (works without API key, officially legacy but widely used)
    const embedUrl = o
      ? `https://www.google.com/maps?saddr=${o}&daddr=${d}&hl=de&output=embed`
      : `https://www.google.com/maps?q=${d}&hl=de&output=embed`;
    // Canonical Directions URL to open in a new tab
    const externalUrl = o
      ? `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}&travelmode=driving`
      : `https://www.google.com/maps/dir/?api=1&destination=${d}&travelmode=driving`;
    return { embedUrl, externalUrl };
  };

  const handleRouteIntent = async (intent) => {
    setMode("thinking");
    setResponse("");

    // If no origin provided, try browser geolocation (non-blocking)
    let { origin, destination } = intent;
    if (!origin && "geolocation" in navigator) {
      try {
        const pos = await new Promise((resolve, reject) => {
          const tid = setTimeout(() => reject(new Error("geo-timeout")), 4000);
          navigator.geolocation.getCurrentPosition(
            (p) => { clearTimeout(tid); resolve(p); },
            (e) => { clearTimeout(tid); reject(e); },
            { enableHighAccuracy: false, maximumAge: 60000, timeout: 4000 }
          );
        });
        origin = `${pos.coords.latitude},${pos.coords.longitude}`;
      } catch {
        // Let Google figure it out (it will ask to allow location on its page)
      }
    }

    const urls = buildMapsUrls(origin, destination);
    setMapsOverlay({
      origin: origin && origin.includes(",") ? "Dein Standort" : origin || "Mein Standort",
      destination,
      ...urls,
    });

    const spoken = origin
      ? `Route ${intent.origin ? `von ${intent.origin} ` : ""}nach ${destination} wird berechnet.`
      : `Route nach ${destination} wird berechnet.`;
    setResponse(spoken);
    setMode("speaking");
    ttsCtrlRef.current = speakStreaming(spoken, {
      onEnd: () => { setMode("idle"); startWakeWord(); },
      onError: () => { setMode("idle"); startWakeWord(); },
    });
  };

  /* ─── Email flow with live-thought overlay ───────────────────────── */
  const animateThinkingSteps = (kind) => {
    const steps = (kind === "email" ? THINKING_STEPS_EMAIL : THINKING_STEPS_CHAT).map((s) => ({ ...s, status: "pending" }));
    setThinking({ kind, steps, result: null });

    // Progress schedule — kick off in series. If backend finishes faster, we
    // short-circuit via resolveThinking(). If it finishes slower, we just
    // hold on the last step.
    thinkingTimersRef.current.forEach((t) => clearTimeout(t));
    thinkingTimersRef.current = steps.map((s, i) => setTimeout(() => {
      setThinking((prev) => {
        if (!prev) return prev;
        const next = prev.steps.map((st, idx) => {
          if (idx < i) return { ...st, status: "done" };
          if (idx === i) return { ...st, status: "active" };
          return st;
        });
        return { ...prev, steps: next };
      });
    }, s.delay));
  };

  const resolveThinking = (resultText) => {
    thinkingTimersRef.current.forEach((t) => clearTimeout(t));
    thinkingTimersRef.current = [];
    setThinking((prev) => {
      if (!prev) return null;
      const done = prev.steps.map((s) => ({ ...s, status: "done" }));
      return { ...prev, steps: done, result: { body: resultText } };
    });
  };

  const closeThinking = () => {
    thinkingTimersRef.current.forEach((t) => clearTimeout(t));
    thinkingTimersRef.current = [];
    setThinking(null);
  };

  const postChat = async (text) => {
    const { data } = await axios.post(`${API}/chat`, {
      message: text,
      session_id: "aria_mode_session",
    });
    return data?.response || "";
  };

  const handleEmailIntent = async (text) => {
    setMode("thinking");
    setTranscript(text);
    setResponse("");
    animateThinkingSteps("email");
    try {
      const reply = await postChat(text);
      resolveThinking(reply);
      setResponse(reply);
      setMode("speaking");
      // For TTS we strip the structural markdown but keep the meaningful text
      const spoken = stripMarkdownForTTS(reply);
      ttsCtrlRef.current = speakStreaming(spoken, {
        onEnd: () => { setMode("idle"); startWakeWord(); },
        onError: () => { setMode("idle"); startWakeWord(); },
      });
    } catch (e) {
      const msg = "Entwurf konnte nicht erstellt werden.";
      resolveThinking(msg);
      setResponse(msg);
      setMode("idle");
      startWakeWord();
    }
  };

  const handleChatIntent = async (text) => {
    setMode("thinking");
    setTranscript(text);
    setResponse("");
    animateThinkingSteps("chat");
    try {
      const reply = await postChat(text);
      resolveThinking(reply);
      // Auto-close the thinking overlay after a short moment so the cortex is visible again.
      setTimeout(() => closeThinking(), 1200);
      setResponse(reply);
      setMode("speaking");
      ttsCtrlRef.current = speakStreaming(stripMarkdownForTTS(reply), {
        onEnd: () => { setMode("idle"); startWakeWord(); },
        onError: () => { setMode("idle"); startWakeWord(); },
      });
    } catch (e) {
      const msg = "Entschuldigung, ich konnte die Anfrage nicht verarbeiten.";
      resolveThinking(msg);
      setTimeout(() => closeThinking(), 1200);
      setResponse(msg);
      setMode("idle");
      startWakeWord();
    }
  };

  /* ─── Exit → back to standard dashboard ──────────────────────────── */
  const exitMode = () => {
    stopAll();
    try { sessionStorage.setItem("aria_dashboard_mode", "standard"); } catch {}
    navigate("/");
  };

  /* ─── Render ─────────────────────────────────────────────────────── */
  const statusLabel = mode === "listening" ? "EMPFANGE ANWEISUNG"
    : mode === "thinking" ? "VERARBEITE"
    : mode === "speaking" ? "ANTWORT WIRD ÜBERTRAGEN"
    : mode === "wakeword" ? 'STANDBY – SAGE "ARIA"'
    : "BEREIT";

  return (
    <div
      className="fixed inset-0 z-[10000] overflow-hidden bg-black text-cyan-100 select-none"
      style={{
        background:
          "radial-gradient(ellipse at center, #001424 0%, #000408 60%, #000 100%)",
      }}
      data-testid="aria-mode-screen"
    >
      {/* Boot fade-in */}
      <div
        className="absolute inset-0 pointer-events-none transition-opacity duration-[1400ms]"
        style={{ opacity: booting ? 1 : 0, background: "#000" }}
      />

      {/* HUD scan-lines + grid */}
      <div className="absolute inset-0 pointer-events-none aria-hud-grid" />
      <div className="absolute inset-0 pointer-events-none aria-scanlines" />

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-4 z-20">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_10px_rgba(100,220,255,0.9)]" />
          <div>
            <div className="text-[22px] font-bold tracking-[0.4em] text-cyan-200" style={{ fontFamily: "Orbitron, sans-serif" }}>
              A.R.I.A.
            </div>
            <div className="text-[10px] tracking-[0.3em] text-cyan-400/70 mt-0.5">
              ARTIFICIAL RESPONSIVE INTELLIGENCE ASSISTANT
            </div>
          </div>
        </div>
        <button
          onClick={exitMode}
          className="px-4 py-2 rounded border border-cyan-400/50 text-cyan-300 hover:bg-cyan-400/10 hover:border-cyan-400 transition text-xs tracking-[0.25em] flex items-center gap-2"
          data-testid="aria-exit-btn"
        >
          <SignOut size={14} weight="bold" /> STANDARD DASHBOARD
        </button>
      </div>

      {/* Side panels (decorative HUD) */}
      <SideHudPanel side="left" user={user} mode={mode} />
      <SideHudPanel side="right" mode={mode} />

      {/* Center: Cortex cloud */}
      <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
        <div className="relative" style={{ width: 560, height: 560 }}>
          <CortexCloud
            intensity={intensity}
            speaking={mode === "speaking"}
            listening={mode === "listening"}
            size={560}
          />
          {/* Status ring label */}
          <div className="absolute bottom-[-10px] left-1/2 -translate-x-1/2 text-[11px] tracking-[0.4em] text-cyan-300/90 font-bold whitespace-nowrap">
            {statusLabel}
          </div>
        </div>
      </div>

      {/* Bottom: transcript + response */}
      <div className="absolute bottom-0 left-0 right-0 z-20 px-8 pb-6 pointer-events-none">
        <div className="max-w-3xl mx-auto space-y-2">
          {transcript && (
            <div className="text-right pointer-events-auto">
              <span className="inline-block px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-400/30 text-cyan-200 text-sm backdrop-blur">
                „{transcript}"
              </span>
            </div>
          )}
          {response && (
            <div className="pointer-events-auto">
              <div className="px-4 py-3 rounded-lg bg-black/50 border border-cyan-400/30 text-cyan-100 text-[15px] leading-relaxed backdrop-blur max-h-[28vh] overflow-y-auto">
                {stripMarkdownForTTS(response)}
              </div>
            </div>
          )}
          {error && (
            <div className="pointer-events-auto text-xs text-red-400/80 text-center">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Bottom-right Mic button + typed fallback */}
      <form
        onSubmit={submitTyped}
        className="absolute bottom-8 right-28 z-30 hidden md:flex items-center"
      >
        <input
          value={typedCmd}
          onChange={(e) => setTypedCmd(e.target.value)}
          placeholder='Befehl tippen (z. B. "Route nach Köln")'
          data-testid="aria-typed-cmd"
          className="w-[340px] px-3 py-2 rounded-l-full bg-black/70 border border-cyan-400/50 text-cyan-100 placeholder-cyan-500/60 text-sm focus:outline-none focus:border-cyan-300 backdrop-blur"
        />
        <button
          type="submit"
          className="px-3 py-2 rounded-r-full bg-cyan-500/20 border border-l-0 border-cyan-400/50 text-cyan-200 text-sm hover:bg-cyan-500/30"
        >
          ↵
        </button>
      </form>

      <button
        onClick={manualMic}
        data-testid="aria-mic-btn"
        className={`absolute bottom-8 right-8 z-30 w-16 h-16 rounded-full flex items-center justify-center transition shadow-[0_0_40px_rgba(100,220,255,0.35)] ${
          mode === "listening" ? "bg-cyan-400 text-black animate-pulse"
          : mode === "speaking" ? "bg-cyan-500/80 text-black"
          : mode === "thinking" ? "bg-yellow-400/80 text-black"
          : "bg-black/70 border border-cyan-400/60 text-cyan-300 hover:bg-cyan-400/20"
        }`}
        title={mode === "speaking" ? "Aria unterbrechen" : "Jetzt sprechen"}
      >
        {mode === "speaking" ? <SpeakerHigh size={26} weight="fill" />
         : mode === "thinking" ? <CircleNotch size={26} weight="bold" className="animate-spin" />
         : <Microphone size={26} weight="fill" />}
      </button>

      {/* Thinking overlay */}
      {thinking && <ThinkingOverlay data={thinking} onClose={closeThinking} />}

      {/* Maps overlay */}
      {mapsOverlay && <MapsOverlay data={mapsOverlay} onClose={() => setMapsOverlay(null)} />}

      {/* Corner brackets */}
      <CornerBracket position="tl" />
      <CornerBracket position="tr" />
      <CornerBracket position="bl" />
      <CornerBracket position="br" />

      <style>{`
        .aria-hud-grid {
          background-image:
            linear-gradient(rgba(100,220,255,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(100,220,255,0.04) 1px, transparent 1px);
          background-size: 42px 42px;
          mask-image: radial-gradient(ellipse at center, black 30%, transparent 85%);
          -webkit-mask-image: radial-gradient(ellipse at center, black 30%, transparent 85%);
        }
        .aria-scanlines {
          background: repeating-linear-gradient(
            to bottom,
            rgba(100,220,255,0.03) 0,
            rgba(100,220,255,0.03) 1px,
            transparent 1px,
            transparent 3px
          );
          opacity: 0.6;
          animation: aria-scan 8s linear infinite;
        }
        @keyframes aria-scan {
          from { background-position: 0 0; }
          to { background-position: 0 24px; }
        }
        @keyframes aria-step-pulse {
          0%,100% { opacity: 0.5; }
          50%     { opacity: 1; }
        }
        .aria-step-active { animation: aria-step-pulse 1s ease-in-out infinite; }
      `}</style>
    </div>
  );
};

/* ─── Decorative sub-components ───────────────────────────────────── */

const CornerBracket = ({ position }) => {
  const pos = {
    tl: "top-3 left-3 border-t border-l",
    tr: "top-3 right-3 border-t border-r",
    bl: "bottom-3 left-3 border-b border-l",
    br: "bottom-3 right-3 border-b border-r",
  }[position];
  return (
    <div
      className={`absolute ${pos} w-10 h-10 border-cyan-400/60 pointer-events-none`}
    />
  );
};

const SideHudPanel = ({ side, user, mode }) => {
  const isLeft = side === "left";
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const time = now.toLocaleTimeString("de-DE", { hour12: false });
  const date = now.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
  return (
    <div
      className={`absolute top-1/2 -translate-y-1/2 ${isLeft ? "left-4" : "right-4"} z-10 text-[10px] tracking-[0.3em] text-cyan-300/80 space-y-1.5 font-mono select-none hidden lg:block`}
      style={{ textShadow: "0 0 8px rgba(100,220,255,0.4)" }}
    >
      {isLeft ? (
        <>
          <div className="text-cyan-400">◆ SYSTEM</div>
          <div>STATUS: {mode.toUpperCase()}</div>
          <div>USER: {(user?.name || "UNKNOWN").toUpperCase()}</div>
          <div>ROLE: {(user?.role || "user").toUpperCase()}</div>
          <div className="pt-3 text-cyan-400">◆ NEURAL NET</div>
          <div>CORES ··· 12 / 12</div>
          <div>LATENCY   42 ms</div>
          <div>ENTROPY   NORMAL</div>
          <div className="pt-3 text-cyan-400">◆ CHANNELS</div>
          <div>VOICE ···· ACTIVE</div>
          <div>VISION ··· STANDBY</div>
          <div>LINK ····· SECURE</div>
        </>
      ) : (
        <>
          <div className="text-cyan-400 text-right">CHRONO ◆</div>
          <div className="text-right text-xl font-bold text-cyan-200" style={{ letterSpacing: "0.15em" }}>{time}</div>
          <div className="text-right">{date.toUpperCase()}</div>
          <div className="pt-3 text-cyan-400 text-right">SUBSYSTEMS ◆</div>
          <div className="text-right">CASEDESK ··· OK</div>
          <div className="text-right">COOKPILOT ·· OK</div>
          <div className="text-right">SMARTHOME ·· OK</div>
          <div className="text-right">WEATHER ···· OK</div>
          <div className="pt-3 text-cyan-400 text-right">NETWORK ◆</div>
          <div className="text-right">LINK ······· UP</div>
          <div className="text-right">ENCRYPT ···· AES-256</div>
        </>
      )}
    </div>
  );
};

/* ─── Thinking overlay ────────────────────────────────────────────── */

const ThinkingOverlay = ({ data, onClose }) => {
  const { kind, steps, result } = data;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center p-6 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-xl bg-black/80 border border-cyan-400/50 rounded-xl backdrop-blur-lg shadow-[0_0_60px_rgba(100,220,255,0.25)]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-cyan-400/30">
          <div className="flex items-center gap-2 text-cyan-200 font-bold tracking-[0.25em] text-sm">
            {kind === "email" ? <EnvelopeSimple size={16} weight="bold" /> : <Brain size={16} weight="bold" />}
            A.R.I.A. {kind === "email" ? "VERFASST E-MAIL" : "DENKT"}
          </div>
          <button onClick={onClose} className="text-cyan-300/70 hover:text-cyan-200">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {steps.map((s) => (
            <div key={s.id} className={`flex items-center gap-3 text-sm ${s.status === "active" ? "aria-step-active text-cyan-200" : s.status === "done" ? "text-cyan-300" : "text-cyan-500/50"}`}>
              {s.status === "done" ? <CheckCircle size={18} weight="fill" className="text-cyan-400" />
                : s.status === "active" ? <CircleNotch size={18} weight="bold" className="animate-spin text-cyan-300" />
                : <div className="w-[18px] h-[18px] rounded-full border border-cyan-500/40" />}
              <span className="tracking-wide">{s.label}</span>
            </div>
          ))}
          {result?.body && (
            <div className="mt-4 p-4 rounded-lg bg-cyan-950/40 border border-cyan-400/40 text-cyan-100 text-sm whitespace-pre-wrap max-h-[40vh] overflow-y-auto">
              {stripMarkdownForTTS(result.body)}
            </div>
          )}
          {kind === "email" && result?.body && (
            <div className="text-[11px] text-cyan-400/70 pt-2">
              Sage „<b>ja versende die Email</b>" zum Absenden oder „<b>verwerfen</b>" zum Verwerfen.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ─── Maps overlay ────────────────────────────────────────────────── */

const MapsOverlay = ({ data, onClose }) => {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-6 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-4xl bg-black/90 border border-cyan-400/50 rounded-xl backdrop-blur shadow-[0_0_60px_rgba(100,220,255,0.25)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-cyan-400/30">
          <div className="flex items-center gap-2 text-cyan-200 font-bold tracking-[0.25em] text-sm">
            <MapTrifold size={16} weight="bold" />
            A.R.I.A. NAVIGATION
          </div>
          <div className="flex items-center gap-2">
            <a
              href={data.externalUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded border border-cyan-400/60 text-cyan-200 hover:bg-cyan-400/10 text-xs tracking-wider flex items-center gap-1"
            >
              <PaperPlaneTilt size={12} weight="bold" /> In Google Maps öffnen
            </a>
            <button onClick={onClose} className="text-cyan-300/70 hover:text-cyan-200">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="px-5 py-2 text-xs text-cyan-300/90 flex items-center gap-3 bg-cyan-950/30">
          <span>Von: <b className="text-cyan-200">{data.origin}</b></span>
          <span className="text-cyan-500/70">→</span>
          <span>Nach: <b className="text-cyan-200">{data.destination}</b></span>
        </div>
        <div className="relative w-full" style={{ height: "60vh" }}>
          <iframe
            title="aria-maps"
            src={data.embedUrl}
            className="absolute inset-0 w-full h-full"
            style={{ border: 0 }}
            allow="geolocation"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </div>
    </div>
  );
};

export default AriaMode;
