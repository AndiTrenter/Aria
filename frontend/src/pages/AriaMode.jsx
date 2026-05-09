import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/App";
import { toast } from "sonner";
import {
  Microphone, X, MapTrifold, EnvelopeSimple,
  Brain, PaperPlaneTilt, CheckCircle, CircleNotch,
  SignOut, SpeakerHigh, MagnifyingGlass, Warning
} from "@phosphor-icons/react";
import CortexCloud from "@/components/CortexCloud";
import BackgroundFx from "@/components/BackgroundFx";
import TemperatureWatermark from "@/components/TemperatureWatermark";
import { checkMicReady, requestMicPermission } from "@/utils/micReady";
import { speakStreaming, stripMarkdownForTTS } from "@/utils/ttsPlayer";
import { streamAriaChat } from "@/utils/ariaStream";
import {
  playBootSound, playWakeSound, playListenSound,
  playDoneSound, playErrorSound, playThinkTick, unlockAudio,
} from "@/utils/ariaSounds";
import useMicLevel from "@/utils/useMicLevel";

/*  ────────────────────────────────────────────────────────────────────
    INTENT PARSERS – deterministic client-side detection for the two
    "special" flows the user asked for (Route → Maps, Email → Thinking).
    Everything else falls through to the normal /api/chat pipeline, which
    already handles CaseDesk, CookPilot, weather, smart-home, etc.
    ──────────────────────────────────────────────────────────────────── */

function parseRouteIntent(text) {
  const t = text.trim();
  const low = t.toLowerCase();
  // Broader trigger set – covers landmarks ("zum Kölner Dom"), pronouns etc.
  if (!/\b(route|wegbeschreibung|navigation|navigiere|fahr|weg nach|wie komme ich|bring mich|zeig(?: mir)? (?:die )?route|ich will (?:nach|zum))\b/.test(low)) {
    return null;
  }
  const trim = (s) => s.replace(/^(bitte\s+)?/i, "").replace(/\s+(bitte)$/i, "").trim().replace(/\s*[.?!]+$/, "");

  // "route von X nach Y"
  let m = t.match(/route\s+von\s+(.+?)\s+nach\s+(.+?)[.?!]?$/i);
  if (m) return { origin: trim(m[1]), destination: trim(m[2]) };
  // "wie komme ich von X nach/zum Y"
  m = t.match(/wie\s+komme?\s+ich\s+von\s+(.+?)\s+(?:nach|zum?|zur)\s+(.+?)[.?!]?$/i);
  if (m) return { origin: trim(m[1]), destination: trim(m[2]) };
  // "navigiere (mich) (nach|zum|zur) X" / "fahr mich (zu(m|r)|nach) X"
  m = t.match(/(?:navigiere(?:\s+mich)?|fahr\s+mich)\s+(?:nach|zum|zur|zu)\s+(.+?)[.?!]?$/i);
  if (m) return { origin: null, destination: trim(m[1]) };
  // "route (zum|zur|nach|zu) X" / "wegbeschreibung zum X"
  m = t.match(/(?:route|wegbeschreibung)\s+(?:zum|zur|nach|zu)\s+(.+?)[.?!]?$/i);
  if (m) return { origin: null, destination: trim(m[1]) };
  // "bring mich (zum|zur|nach) X"
  m = t.match(/bring\s+mich\s+(?:zum|zur|nach|zu)\s+(.+?)[.?!]?$/i);
  if (m) return { origin: null, destination: trim(m[1]) };
  // "zeig (mir) (die) route (zum|zur|nach) X"
  m = t.match(/zeig(?:\s+mir)?\s+(?:die\s+)?route\s+(?:zum|zur|nach|zu)\s+(.+?)[.?!]?$/i);
  if (m) return { origin: null, destination: trim(m[1]) };
  // "ich will (nach|zum|zur) X"
  m = t.match(/ich\s+will\s+(?:nach|zum|zur)\s+(.+?)[.?!]?$/i);
  if (m) return { origin: null, destination: trim(m[1]) };
  // "wie komme ich (am besten|am schnellsten) (zum|zur|nach) X"
  m = t.match(/wie\s+komme?\s+ich\s+(?:am\s+(?:besten|schnellsten|einfachsten)\s+)?(?:zum|zur|nach)\s+(.+?)[.?!]?$/i);
  if (m) return { origin: null, destination: trim(m[1]) };
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

/*  ────────────────────────────────────────────────────────────────── */

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
  // thinking = null | { kind: "email"|"chat", steps: [{id,label,status,detail?}], result?: {body,meta} }

  // maps overlay
  const [mapsOverlay, setMapsOverlay] = useState(null);
  // { origin, destination, embedUrl, externalUrl }

  // floating "holo" search panels around the cortex (JARVIS style)
  const [panels, setPanels] = useState([]);
  // panels: [{id, service, title, query, status: "active"|"done"|"empty"|"error", snippet, count, ts}]

  // pending email confirmation flow ("Sage 'ja versende' …")
  const [pendingEmail, setPendingEmail] = useState(false);

  // cortex intensity (drives animation)
  const [intensity, setIntensity] = useState(0.25);

  // Live microphone amplitude — only sampled while ARIA is "listening".
  // Drives the cortex animation intensity in real time so the orb
  // visibly reacts to the user's voice (J.A.R.V.I.S.-style).
  const micLevelRef = useMicLevel(mode === "listening");

  // Drive intensity from mic-level when listening, otherwise a fixed
  // mode-derived baseline.  Updates ~30/s (lighter than 60Hz to reduce
  // setState pressure).
  useEffect(() => {
    let alive = true;
    let raf = null;
    let last = 0;
    const baseline = () => {
      if (mode === "listening") return 0.55;
      if (mode === "thinking")  return 0.7;
      if (mode === "speaking")  return 0.85;
      return 0.25;
    };
    const tick = (ts) => {
      if (!alive) return;
      if (ts - last > 33) {
        last = ts;
        const base = baseline();
        if (mode === "listening") {
          const lvl = micLevelRef.current || 0;
          // Scale: baseline 0.45 + 0.5 × mic level → range 0.45..0.95
          setIntensity(Math.max(base, 0.45 + lvl * 0.5));
        } else {
          setIntensity(base);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { alive = false; if (raf) cancelAnimationFrame(raf); };
  }, [mode, micLevelRef]);

  // Viewport-responsive cortex size — keeps the orb fully visible even
  // inside a narrow split-pane preview (Emergent App-Builder, half-screen).
  // We pick the smaller of viewport-width × 0.55 and viewport-height × 0.65,
  // capped at 600px and floored at 320px.
  const computeOrbSize = () => {
    if (typeof window === "undefined") return 380;
    const w = window.innerWidth || 1280;
    const h = window.innerHeight || 720;
    return Math.max(260, Math.min(440, Math.floor(Math.min(w * 0.36, h * 0.46))));
  };
  const [orbSize, setOrbSize] = useState(computeOrbSize);
  useEffect(() => {
    const onResize = () => setOrbSize(computeOrbSize());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const recognitionRef = useRef(null);
  const stateRef = useRef(mode);
  const ttsCtrlRef = useRef(null);
  const thinkingTimersRef = useRef([]);
  const streamCtrlRef = useRef(null);
  const panelTimeoutsRef = useRef({});
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

  /* ─── Kiosk fullscreen — request when ARIA mode opens, exit on leave.
       Using the Fullscreen API.  Requires a user-gesture trigger; the
       click that activated ARIA mode IS such a gesture, so this
       implicit call usually succeeds.  If the browser refuses
       (Safari sometimes), we silently fall back to windowed mode. ── */
  useEffect(() => {
    const enter = async () => {
      try {
        const el = document.documentElement;
        if (!document.fullscreenElement && el.requestFullscreen) {
          await el.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
        }
      } catch { /* user-gesture missing → silently ignore */ }
    };
    enter();
    return () => {
      // Leave fullscreen when ARIA mode unmounts (toggle back to standard)
      try {
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
      } catch { /* noop */ }
    };
  }, []);

  /* ─── Boot greeting (one-time per session, only when this mode opens) ─ */
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    const firstName = (user?.name || "").split(" ")[0] || "Commander";
    const text = `Aria online. Willkommen zurück, ${firstName}. Systeme bereit. Wie kann ich helfen?`;
    setResponse(text);
    setMode("speaking");
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setMode("idle");
      startWakeWord();
    };
    // Sci-fi boot sweep — fires before the spoken greeting so it feels
    // like the system "powers on" (J.A.R.V.I.S.-style).
    try { unlockAudio(); playBootSound(); } catch {}
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
    try { streamCtrlRef.current?.abort(); } catch {}
    ttsCtrlRef.current = null;
    streamCtrlRef.current = null;
    thinkingTimersRef.current.forEach((t) => clearTimeout(t));
    thinkingTimersRef.current = [];
    Object.values(panelTimeoutsRef.current).forEach((t) => clearTimeout(t));
    panelTimeoutsRef.current = {};
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
          try { playWakeSound(); } catch {}
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
    try { playListenSound(); } catch {}
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

  /* ─── Floating holo-panels around the cortex (JARVIS visual) ───────── */
  const upsertPanel = (id, patch) => {
    setPanels((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const idx = list.findIndex((p) => p.id === id);
      if (idx === -1) return [...list, { id, ts: Date.now(), ...patch }];
      const copy = [...list];
      copy[idx] = { ...copy[idx], ...patch, ts: Date.now() };
      return copy;
    });
    // Auto-fade panels that finished after a short hold time
    if (patch.status && patch.status !== "active") {
      if (panelTimeoutsRef.current[id]) clearTimeout(panelTimeoutsRef.current[id]);
      panelTimeoutsRef.current[id] = setTimeout(() => {
        setPanels((prev) => prev.filter((p) => p.id !== id));
        delete panelTimeoutsRef.current[id];
      }, 6000);
    }
  };

  const clearPanels = () => {
    Object.values(panelTimeoutsRef.current).forEach((t) => clearTimeout(t));
    panelTimeoutsRef.current = {};
    setPanels([]);
  };

  /* ─── Unified streaming command dispatcher ────────────────────────── */
  const runStreamingCommand = (text, kind /* "email" | "chat" */) => {
    setTranscript(text);
    setResponse("");
    setMode("thinking");
    clearPanels();

    // Initial step skeleton — gets filled in by real backend events
    const initialSteps = (kind === "email" ? [
      { id: "parse",        label: "Verstehe Anfrage",        status: "active" },
      { id: "route",        label: "Wähle passende Dienste",  status: "pending" },
      { id: "email_intent", label: "Erkenne E-Mail-Absicht",  status: "pending" },
      { id: "recipient",    label: "Identifiziere Empfänger", status: "pending" },
      { id: "subject",      label: "Formuliere Betreff",      status: "pending" },
      { id: "body",         label: "Schreibe E-Mail-Text",    status: "pending" },
      { id: "reason",       label: "Generiere Antwort",       status: "pending" },
    ] : [
      { id: "parse",  label: "Verstehe Anfrage",        status: "active" },
      { id: "route",  label: "Wähle passende Dienste",  status: "pending" },
      { id: "fetch",  label: "Hole Live-Daten",         status: "pending" },
      { id: "reason", label: "Denke nach",              status: "pending" },
    ]).map((s) => ({ ...s }));

    setThinking({ kind, steps: initialSteps, result: null });

    let finalText = "";
    let isPendingEmailConfirm = false;

    streamCtrlRef.current = streamAriaChat(text, {
      sessionId: "aria_mode_session",
      onThought: (data) => {
        const { id, label, status, detail } = data || {};
        if (!id) return;
        // Subtle audio click whenever a step appears or transitions to done
        if (status === "active" || status === "done") {
          try { playThinkTick(); } catch {}
        }
        // Update or append step (always preserve the wrapping {kind,steps,result} shape)
        setThinking((prev) => {
          if (!prev || !Array.isArray(prev.steps)) return prev;
          const idx = prev.steps.findIndex((s) => s.id === id);
          if (idx === -1) {
            return { ...prev, steps: [...prev.steps, { id, label: label || id, status, detail }] };
          }
          const next = [...prev.steps];
          next[idx] = { ...next[idx], label: label || next[idx].label, status, detail: detail ?? next[idx].detail };
          return { ...prev, steps: next };
        });
        // Email draft creation success → user can confirm verbally
        if (id === "body" && status === "done" && kind === "email") {
          isPendingEmailConfirm = true;
        }
      },
      onPanel: ({ kind: pKind, payload }) => {
        if (pKind === "open") {
          upsertPanel(payload.id, {
            service: payload.service,
            title: payload.title,
            query: payload.query,
            status: "active",
          });
        } else if (pKind === "update") {
          upsertPanel(payload.id, {
            status: payload.status,
            snippet: payload.snippet,
            count: payload.count,
          });
        }
      },
      onResultChunk: ({ text }) => {
        // Live token stream from GPT — fill the response box AND the
        // thinking overlay's result body in real time.
        if (typeof text !== "string") return;
        finalText = text;
        setResponse(text);
        setThinking((prev) => {
          if (!prev) return prev;
          return { ...prev, result: { body: text } };
        });
      },
      onResult: (data) => {
        finalText = data?.text || finalText || "";
      },
      onError: (err) => {
        finalText = `Fehler: ${err?.message || "Stream konnte nicht verarbeitet werden."}`;
        try { playErrorSound(); } catch {}
      },
      onDone: () => {
        // mark all pending steps as done
        setThinking((prev) => {
          if (!prev || !Array.isArray(prev.steps)) return null;
          const done = prev.steps.map((s) => ({
            ...s,
            status: s.status === "pending" || s.status === "active" ? "done" : s.status,
          }));
          return { ...prev, steps: done, result: { body: finalText } };
        });
        setResponse(finalText);

        if (isPendingEmailConfirm) {
          setPendingEmail(true);
        } else if (kind === "chat") {
          // Auto-close chat thinking pane after a short beat
          setTimeout(() => closeThinking(), 1500);
        }

        if (finalText) {
          try { playDoneSound(); } catch {}
          setMode("speaking");
          ttsCtrlRef.current = speakStreaming(stripMarkdownForTTS(finalText), {
            onEnd: () => {
              setMode("idle");
              if (isPendingEmailConfirm) {
                // Listen for "ja versende" / "verwerfen"
                startListening();
              } else {
                startWakeWord();
              }
            },
            onError: () => {
              setMode("idle");
              if (isPendingEmailConfirm) startListening(); else startWakeWord();
            },
          });
        } else {
          setMode("idle");
          startWakeWord();
        }
      },
    });
  };

  /* ─── Intent dispatcher ──────────────────────────────────────────── */
  const handleUserUtterance = async (text) => {
    // Built-in visual demo (lets you preview the JARVIS holo-panels without
    // any backend services configured). Triggered with: "/demo"
    if (text.trim().toLowerCase() === "/demo" || text.trim().toLowerCase() === "demo") {
      runDemoSequence();
      return;
    }

    // Voice-confirmation for pending email draft
    if (pendingEmail) {
      const t = text.toLowerCase();
      const isConfirm = /\b(ja|jawohl|jo|send(?:e|en)?|abschick|absend|versend|verschick|los|bestätig)\b/.test(t);
      const isCancel  = /\b(nein|verwerf|abbrech|cancel|abbruch|löschen|nicht|stop)\b/.test(t);
      if (isConfirm || isCancel) {
        setPendingEmail(false);
        // Forward decision through normal chat (CaseDesk handles ja/nein)
        runStreamingCommand(text, "chat");
        return;
      }
      // Otherwise treat as a brand new request and drop the pending state
      setPendingEmail(false);
    }

    const routeIntent = parseRouteIntent(text);
    if (routeIntent) {
      await handleRouteIntent(routeIntent);
      return;
    }
    if (parseEmailIntent(text)) {
      runStreamingCommand(text, "email");
      return;
    }
    runStreamingCommand(text, "chat");
  };

  /* ─── Visual demo (no backend) ───────────────────────────────────── */
  const runDemoSequence = () => {
    setTranscript("/demo");
    setMode("thinking");
    clearPanels();
    const demoSteps = [
      { id: "parse", label: "Verstehe Anfrage",       status: "active"  },
      { id: "route", label: "Wähle passende Dienste", status: "pending" },
      { id: "fetch", label: "Hole Live-Daten",        status: "pending" },
      { id: "reason", label: "Denke nach",            status: "pending" },
    ];
    setThinking({ kind: "chat", steps: demoSteps, result: null });

    const demoPanels = [
      { id: "panel_weather",       service: "weather",       title: "Wetter",       query: "Wetter Köln · 24h",      result: "Köln · 18°C · leichter Regen" },
      { id: "panel_casedesk",      service: "casedesk",      title: "CaseDesk",     query: "Letzte E-Mails · Aufträge", result: "12 ungelesen · 3 offene Cases" },
      { id: "panel_plex",          service: "plex",          title: "Plex Media",   query: "Neue Filme · Watch-Later", result: "8 Filme · 4 Serien neu" },
      { id: "panel_homeassistant", service: "homeassistant", title: "Home Assistant", query: "Lichter · Heizung · Sensoren", result: "12 Lichter aus · 21°C Wohnzimmer" },
      { id: "panel_cookpilot",     service: "cookpilot",     title: "CookPilot",    query: "Vorräte · Rezeptideen",  result: "Pasta · Tomaten · Knoblauch ausreichend" },
      { id: "panel_system",        service: "system",        title: "System-Diagnose", query: "CPU · RAM · Container", result: "CPU 14% · RAM 38% · 9 Container" },
    ];

    // Open all panels
    demoPanels.forEach((d, i) => {
      setTimeout(() => {
        upsertPanel(d.id, { service: d.service, title: d.title, query: d.query, status: "active" });
      }, 250 + i * 220);
    });

    // Step transitions
    setTimeout(() => setThinking((p) => p && ({ ...p, steps: p.steps.map((s) => s.id === "parse" ? { ...s, status: "done" } : s.id === "route" ? { ...s, status: "active", detail: "weather, casedesk, plex, homeassistant, cookpilot, system" } : s) })), 400);
    setTimeout(() => setThinking((p) => p && ({ ...p, steps: p.steps.map((s) => s.id === "route" ? { ...s, status: "done" } : s.id === "fetch" ? { ...s, status: "active" } : s) })), 1200);

    // Resolve panels one by one
    demoPanels.forEach((d, i) => {
      setTimeout(() => {
        upsertPanel(d.id, { status: "done", snippet: d.result });
      }, 1600 + i * 320);
    });

    setTimeout(() => setThinking((p) => p && ({ ...p, steps: p.steps.map((s) => s.id === "fetch" ? { ...s, status: "done" } : s.id === "reason" ? { ...s, status: "active" } : s) })), 1800 + demoPanels.length * 320);

    // Final
    const finalText = "Demo-Modus: Sechs Service-Holopanels gleichzeitig geöffnet, jeder Service liefert seine Live-Daten an A.R.I.A. Im echten Betrieb füllt sich jedes Panel mit den tatsächlichen Antworten deiner verbundenen Dienste.";
    setTimeout(() => {
      setThinking((p) => p && ({ ...p, steps: p.steps.map((s) => ({ ...s, status: "done" })), result: { body: finalText } }));
      setResponse(finalText);
      setMode("speaking");
      ttsCtrlRef.current = speakStreaming(finalText, {
        onEnd: () => { setMode("idle"); startWakeWord(); },
        onError: () => { setMode("idle"); startWakeWord(); },
      });
      setTimeout(() => closeThinking(), 1800);
    }, 2600 + demoPanels.length * 320);
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

  const closeThinking = () => {
    thinkingTimersRef.current.forEach((t) => clearTimeout(t));
    thinkingTimersRef.current = [];
    setThinking(null);
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

      {/* Animated tech background — floating nodes + network lines + scan
          bursts.  Sits above the static HUD grid but well below all
          foreground UI.  Mode-reactive colour. */}
      <BackgroundFx mode={mode} />

      {/* Holographic temperature watermark — large faint digits behind
          the action, refreshes every 5min from /api/weather. */}
      <TemperatureWatermark />
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
              ADAPTIVE REASONING INTELLIGENCE ASSISTANT
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

      {/* Side panels (decorative HUD) — hidden while search holo-panels are open */}
      {panels.length === 0 && <SideHudPanel side="left" user={user} mode={mode} />}
      {panels.length === 0 && <SideHudPanel side="right" mode={mode} />}

      {/* Center: Cortex cloud — z-50 so it's ALWAYS on top of every HUD
          element, side panels, and background fx (the user explicitly
          requested the orb sit on the topmost layer).
          padding-bottom: shifts the visual centre up — the bottom command
          bar takes ~100px of screen, so without compensation the orb
          looks "low".
          padding-right: small bias to compensate for the wider right-side
          HUD column (CHRONO + SUBSYSTEMS + NETWORK is denser than the
          left SYSTEM/NEURAL/CHANNELS column).
      */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center z-50 pointer-events-none"
        style={{ paddingBottom: "22vh", paddingRight: "16vw" }}
      >
        <div className="relative" style={{ width: orbSize, height: orbSize }}>
          <CortexCloud
            intensity={intensity}
            speaking={mode === "speaking"}
            listening={mode === "listening"}
            mode={mode}
            size={orbSize}
          />
          {/* Status ring label */}
          <div className="absolute bottom-[-10px] left-1/2 -translate-x-1/2 text-[11px] tracking-[0.4em] text-cyan-300/90 font-bold whitespace-nowrap">
            {statusLabel}
          </div>
        </div>
      </div>

      {/* Floating holo-panels (JARVIS-style search windows around the cortex) */}
      <HoloPanelLayer panels={panels} />

      {/* Pending email confirmation banner */}
      {pendingEmail && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-30 px-5 py-2.5 rounded-full bg-cyan-500/20 border border-cyan-300/60 text-cyan-100 text-sm tracking-wide backdrop-blur shadow-[0_0_30px_rgba(100,220,255,0.35)] animate-pulse">
          Sage <b className="text-cyan-200">„ja versende"</b> oder <b className="text-cyan-200">„verwerfen"</b>
        </div>
      )}

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
    <div className="absolute inset-0 z-[60] flex items-center justify-center p-6 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-xl bg-black/85 border border-orange-400/55 rounded-xl backdrop-blur-lg shadow-[0_0_60px_rgba(255,120,60,0.35)]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-orange-400/30">
          <div className="flex items-center gap-2 text-orange-200 font-bold tracking-[0.25em] text-sm">
            {kind === "email" ? <EnvelopeSimple size={16} weight="bold" /> : <Brain size={16} weight="bold" />}
            A.R.I.A. {kind === "email" ? "VERFASST E-MAIL" : "DENKT"}
          </div>
          <button onClick={onClose} className="text-orange-300/70 hover:text-orange-200">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {steps.map((s) => (
            <div key={s.id} className={`flex items-center gap-3 text-sm ${s.status === "active" ? "aria-step-active text-orange-100" : s.status === "done" ? "text-orange-300" : "text-orange-500/50"}`}>
              {s.status === "done" ? <CheckCircle size={18} weight="fill" className="text-orange-400" />
                : s.status === "active" ? <CircleNotch size={18} weight="bold" className="animate-spin text-orange-300" />
                : <div className="w-[18px] h-[18px] rounded-full border border-orange-500/40" />}
              <span className="tracking-wide">{s.label}</span>
            </div>
          ))}
          {result?.body && (
            <div className="mt-4 p-4 rounded-lg bg-orange-950/40 border border-orange-400/40 text-orange-50 text-sm whitespace-pre-wrap max-h-[40vh] overflow-y-auto">
              {stripMarkdownForTTS(result.body)}
            </div>
          )}
          {kind === "email" && result?.body && (
            <div className="text-[11px] text-orange-400/70 pt-2">
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

/* ─── Holo Panel Layer (JARVIS search windows around the cortex) ─── */

const SERVICE_META = {
  weather:        { color: "32",  emoji: "☀" },  // amber
  system:         { color: "10",  emoji: "⚙" },  // crimson
  homeassistant:  { color: "20",  emoji: "🏠" },  // red-orange
  casedesk:       { color: "38",  emoji: "✉" },  // gold
  plex:           { color: "5",   emoji: "▶" },  // deep red
  cookpilot:      { color: "28",  emoji: "🍳" },  // orange
  websearch:      { color: "45",  emoji: "🌐" },  // bright gold — internet research
};

// 3D positioning around a 560-px cortex.  Each slot has a CSS position
// AND a 3D transform offset (translateZ + rotateY) so panels feel like
// holograms floating at slightly different distances/angles around the
// orb.  Indexed in panel-arrival order.
const PANEL_SLOTS = [
  { top: "14%",    left:  "3%",   tz: 60,  ry:  18, rx: -6 }, // top-left
  { top: "14%",    right: "3%",   tz: 60,  ry: -18, rx: -6 }, // top-right
  { top: "44%",    left:  "1.5%", tz: 90,  ry:  26, rx:  0 }, // mid-left  (closer to viewer)
  { top: "44%",    right: "1.5%", tz: 90,  ry: -26, rx:  0 }, // mid-right (closer to viewer)
  { bottom: "20%", left:  "4%",   tz: 50,  ry:  14, rx:  6 }, // bot-left
  { bottom: "20%", right: "4%",   tz: 50,  ry: -14, rx:  6 }, // bot-right
  { top: "29%",    left:  "20%",  tz: 30,  ry:  10, rx: -2 }, // overflow inner-left
  { top: "29%",    right: "20%",  tz: 30,  ry: -10, rx: -2 }, // overflow inner-right
];

const HoloPanelLayer = ({ panels }) => {
  if (!panels || panels.length === 0) return null;
  // Sort by ts so layout is stable based on arrival order
  const ordered = [...panels].sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return (
    <div
      className="absolute inset-0 z-[55] pointer-events-none"
      style={{ perspective: "1400px", perspectiveOrigin: "50% 45%" }}
    >
      {ordered.map((p, i) => {
        const slot = PANEL_SLOTS[i % PANEL_SLOTS.length];
        return <HoloPanel key={p.id} panel={p} slot={slot} index={i} />;
      })}
    </div>
  );
};

const HoloPanel = ({ panel, slot, index }) => {
  const meta = SERVICE_META[panel.service] || { color: "20", emoji: "◆" };
  const hue = meta.color;
  const status = panel.status || "active";

  const statusBadge =
    status === "active" ? { color: "text-cyan-300", text: "SUCHE …", icon: <CircleNotch size={12} weight="bold" className="animate-spin" /> }
    : status === "done" ? { color: "text-emerald-300", text: "FERTIG",  icon: <CheckCircle size={12} weight="fill" /> }
    : status === "empty" ? { color: "text-amber-300/80", text: "LEER",   icon: <CircleNotch size={12} weight="bold" /> }
    : { color: "text-red-300", text: "FEHLER", icon: <Warning size={12} weight="fill" /> };

  // 3D transform: slot-based base rotation/translation + entrance fade-in.
  // Inner div carries continuous floating idle animation so the box
  // genuinely drifts in space like a Stark-Industries hologram.
  const tz = slot.tz ?? 60;
  const ry = slot.ry ?? 0;
  const rx = slot.rx ?? 0;

  const positionStyle = {
    top: slot.top,
    bottom: slot.bottom,
    left: slot.left,
    right: slot.right,
  };

  return (
    <div
      className="absolute pointer-events-none holo-panel"
      style={{
        ...positionStyle,
        width: 260,
        transformStyle: "preserve-3d",
        animation: "aria-holo-in 520ms cubic-bezier(.2,.9,.3,1.2) both",
        animationDelay: `${index * 70}ms`,
      }}
    >
      <div
        className="holo-panel-inner"
        style={{
          transformStyle: "preserve-3d",
          transform: `translateZ(${tz}px) rotateY(${ry}deg) rotateX(${rx}deg)`,
          animation: `aria-holo-float ${5 + (index % 3)}s ease-in-out ${index * 0.35}s infinite alternate`,
        }}
      >
        <div
          className="relative rounded-md border backdrop-blur-md overflow-hidden"
          style={{
            background: `linear-gradient(180deg, hsla(${hue},90%,40%,0.18), hsla(${hue},90%,15%,0.45))`,
            borderColor: `hsla(${hue},90%,65%,0.55)`,
            boxShadow: `0 0 22px hsla(${hue},90%,55%,0.35), 0 0 60px hsla(${hue},90%,55%,0.15), inset 0 0 28px hsla(${hue},90%,40%,0.18)`,
          }}
        >
          {/* HUD top stripe */}
          <div
            className="flex items-center justify-between px-3 py-1.5 text-[10px] tracking-[0.25em] font-bold border-b"
            style={{
              color: `hsl(${hue},90%,80%)`,
              borderColor: `hsla(${hue},90%,65%,0.4)`,
              background: `hsla(${hue},90%,30%,0.25)`,
            }}
          >
            <span className="flex items-center gap-1.5">
              <MagnifyingGlass size={11} weight="bold" />
              {panel.title || (panel.service || "").toUpperCase()}
            </span>
            <span className={`flex items-center gap-1 ${statusBadge.color}`}>
              {statusBadge.icon}
              {statusBadge.text}
            </span>
          </div>
          {/* Body */}
          <div className="px-3 py-2.5 space-y-1.5">
            {panel.query && (
              <div className="text-[11px] text-cyan-100/85 leading-snug line-clamp-2">
                <span className="text-cyan-400/80">QUERY ›</span> {panel.query}
              </div>
            )}
            {panel.snippet && (
              <div className="text-[11px] text-emerald-100/85 leading-snug line-clamp-3">
                <span className="text-emerald-400/80">↳</span> {panel.snippet}
              </div>
            )}
            {!panel.query && !panel.snippet && (
              <div className="text-[11px] text-cyan-300/60 italic">verarbeite…</div>
            )}
            {/* mini scan bar */}
            {status === "active" && (
              <div className="h-[2px] mt-1 rounded overflow-hidden" style={{ background: `hsla(${hue},90%,40%,0.3)` }}>
                <div
                  className="h-full rounded"
                  style={{
                    width: "40%",
                    background: `hsl(${hue},90%,70%)`,
                    animation: "aria-holo-bar 1.4s linear infinite",
                    boxShadow: `0 0 10px hsl(${hue},90%,70%)`,
                  }}
                />
              </div>
            )}
          </div>
          {/* Corner ticks */}
          <div className="absolute -top-px -left-px w-3 h-3 border-t border-l" style={{ borderColor: `hsla(${hue},90%,80%,0.9)` }} />
          <div className="absolute -top-px -right-px w-3 h-3 border-t border-r" style={{ borderColor: `hsla(${hue},90%,80%,0.9)` }} />
          <div className="absolute -bottom-px -left-px w-3 h-3 border-b border-l" style={{ borderColor: `hsla(${hue},90%,80%,0.9)` }} />
          <div className="absolute -bottom-px -right-px w-3 h-3 border-b border-r" style={{ borderColor: `hsla(${hue},90%,80%,0.9)` }} />

          {/* Faux scan-line shimmer to underline the holo feel */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `repeating-linear-gradient(0deg, hsla(${hue},90%,80%,0.05) 0, hsla(${hue},90%,80%,0.05) 1px, transparent 1px, transparent 4px)`,
              mixBlendMode: "overlay",
            }}
          />
        </div>
      </div>
      <style>{`
        @keyframes aria-holo-in {
          0%   { opacity: 0; transform: translateY(8px) scale(0.85); filter: blur(4px); }
          60%  { opacity: 1; transform: translateY(0) scale(1.03); filter: blur(0); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes aria-holo-float {
          0%   { transform: translateZ(${tz}px) rotateY(${ry}deg) rotateX(${rx}deg) translateY(0); }
          100% { transform: translateZ(${tz + 14}px) rotateY(${ry + (ry >= 0 ? 3 : -3)}deg) rotateX(${rx - 2}deg) translateY(-6px); }
        }
        @keyframes aria-holo-bar {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(260%); }
        }
        .holo-panel:hover .holo-panel-inner { filter: brightness(1.15); }
      `}</style>
    </div>
  );
};

export default AriaMode;