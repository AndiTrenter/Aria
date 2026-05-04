import { useState, useEffect, useRef } from "react";
import { useTheme, API } from "@/App";
import axios from "axios";
import { toast } from "sonner";
import { Microphone, SpeakerHigh, X, Waveform } from "@phosphor-icons/react";
import { checkMicReady, requestMicPermission } from "@/utils/micReady";
import { speakStreaming, stripMarkdownForTTS } from "@/utils/ttsPlayer";

const VoiceAssistant = () => {
  const { theme } = useTheme();
  const [state, setState] = useState("idle"); // idle | wakeword | listening | processing | speaking
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [error, setError] = useState("");
  const [alwaysListening, setAlwaysListening] = useState(false); // loaded from profile
  const [profileLoaded, setProfileLoaded] = useState(false);
  const recognitionRef = useRef(null);
  const stateRef = useRef(state);
  const alwaysListeningRef = useRef(false);
  const ttsCtrlRef = useRef(null);
  const isLcars = theme === "startrek";
  const isStarwars = theme === "starwars";

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { alwaysListeningRef.current = alwaysListening; }, [alwaysListening]);

  // Load user preference once
  useEffect(() => {
    axios.get(`${API}/profile/me`).then(r => {
      setAlwaysListening(!!r.data?.always_listening);
      setProfileLoaded(true);
    }).catch(() => { setProfileLoaded(true); });
  }, []);

  const toggleAlwaysListening = async () => {
    const newVal = !alwaysListening;
    setAlwaysListening(newVal);
    try {
      await axios.patch(`${API}/profile/me`, { always_listening: newVal });
      toast.success(newVal ? 'Aria hört jetzt immer auf "Aria"' : "Dauer-Mithören deaktiviert", { duration: 4000 });
    } catch {}
    if (!newVal) {
      stopAll();
      setState("idle");
    } else {
      // Try to start immediately — may fail if browser needs gesture
      const ready = checkMicReady();
      if (!ready.ok) { toast.error(ready.hint, { duration: 10000 }); return; }
      const perm = await requestMicPermission();
      if (!perm.ok) { toast.error(perm.hint, { duration: 10000 }); return; }
      startWakeWord();
    }
  };

  const stopAll = () => {
    try { recognitionRef.current?.stop(); } catch {}
    try { window.speechSynthesis?.cancel(); } catch {}
    try { ttsCtrlRef.current?.stop(); } catch {}
    ttsCtrlRef.current = null;
  };

  const playTone = (freq1, freq2) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(freq1, ctx.currentTime);
      osc.frequency.setValueAtTime(freq2, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime + 0.2);
      osc.start(); osc.stop(ctx.currentTime + 0.2);
    } catch {}
  };

  const speak = (text) => {
    // Cancel any previous playback (browser TTS or our streaming player)
    try { window.speechSynthesis?.cancel(); } catch {}
    try { ttsCtrlRef.current?.stop(); } catch {}
    ttsCtrlRef.current = null;

    if (!text || !text.trim()) {
      setState("idle");
      if (alwaysListeningRef.current) startWakeWord();
      return;
    }

    setState("speaking");

    const finishCycle = () => {
      setState("idle");
      if (alwaysListeningRef.current) startWakeWord();
    };

    // Browser-TTS fallback (only if OpenAI TTS fails) — we strip Markdown first
    const browserFallback = () => {
      try {
        const synth = window.speechSynthesis;
        if (!synth) { finishCycle(); return; }
        synth.cancel();
        const cleanedFallback = stripMarkdownForTTS(text);
        const utter = new SpeechSynthesisUtterance(cleanedFallback);
        utter.lang = "de-DE";
        utter.rate = 1.0;
        utter.pitch = isLcars ? 0.9 : 1.1;
        utter.onend = finishCycle;
        utter.onerror = finishCycle;
        synth.speak(utter);
      } catch {
        finishCycle();
      }
    };

    // Primary: OpenAI gpt-4o-mini-tts via our streaming sentence-chunked player
    ttsCtrlRef.current = speakStreaming(text, {
      onEnd: finishCycle,
      onError: (e) => {
        console.warn("[Aria voice] OpenAI TTS failed, falling back to browser TTS:", e?.message || e);
        browserFallback();
      },
    });
  };

  const sendToChat = async (text) => {
    setState("processing");
    setTranscript(text);
    try {
      // Try HA command first for smart home keywords
      const haKeywords = ["licht", "lampe", "heizung", "thermostat", "temperatur", "rollladen", "jalousie", "steckdose", "schalte", "einschalten", "ausschalten", "aufmachen", "zumachen", "dimmen", "heller", "dunkler"];
      const isHaCommand = haKeywords.some(w => text.toLowerCase().includes(w));
      
      if (isHaCommand) {
        try {
          const { data: haResult } = await axios.post(`${API}/ha/command`, { command: text, source: "voice" });
          if (haResult.action === "denied") {
            setError(haResult.message);
            speak(haResult.message);
            return;
          }
          if (haResult.action === "pin_required") {
            const msg = "Dieses Gerät ist als kritisch markiert. Bitte verwende die App um deinen PIN einzugeben.";
            setError(msg);
            speak(msg);
            return;
          }
          if (haResult.success) {
            setResponse(haResult.message);
            speak(haResult.message);
            return;
          }
        } catch {}
      }
      
      // Fallback to regular chat
      const { data } = await axios.post(`${API}/chat`, { message: text, session_id: "voice_session" });
      setResponse(data.response);
      speak(data.response);
    } catch {
      const msg = "Entschuldigung, ich konnte die Anfrage nicht verarbeiten.";
      setError(msg);
      speak(msg);
    }
  };

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    stopAll();
    playTone(isLcars ? 800 : 600, isLcars ? 1200 : 900);

    const rec = new SR();
    rec.lang = "de-DE";
    rec.continuous = false;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let final = "", interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      setTranscript(final || interim);
      if (final) sendToChat(final);
    };

    rec.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") {
        setError(`Fehler: ${e.error}`);
      }
      setState("idle");
      if (alwaysListeningRef.current) setTimeout(startWakeWord, 1000);
    };

    rec.onend = () => {
      if (stateRef.current === "listening") {
        setState("idle");
        if (alwaysListeningRef.current) setTimeout(startWakeWord, 500);
      }
    };

    recognitionRef.current = rec;
    setState("listening");
    setTranscript(""); setResponse(""); setError("");
    rec.start();
  };

  const startWakeWord = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    stopAll();

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

    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") {
        if (alwaysListeningRef.current) setTimeout(startWakeWord, 500);
      }
    };

    rec.onend = () => {
      const s = stateRef.current;
      if ((s === "wakeword" || s === "idle") && alwaysListeningRef.current) {
        setTimeout(startWakeWord, 300);
      }
    };

    recognitionRef.current = rec;
    setState("wakeword");
    try { rec.start(); } catch {}
  };

  const toggleVoice = async () => {
    if (state === "idle") {
      // Pre-flight check: secure context + mic permission
      const ready = checkMicReady();
      if (!ready.ok) {
        toast.error(ready.hint, { duration: 12000 });
        setError(ready.hint);
        return;
      }
      const perm = await requestMicPermission();
      if (!perm.ok) {
        toast.error(perm.hint, { duration: 12000 });
        setError(perm.hint);
        return;
      }
      setError("");
      startWakeWord();
    } else if (state === "wakeword") {
      startListening();
    } else if (state === "speaking") {
      window.speechSynthesis?.cancel();
      setState("idle");
    } else {
      stopAll();
      setState("idle");
    }
  };

  const dismiss = () => {
    stopAll();
    setState("idle");
    setTranscript(""); setResponse(""); setError("");
  };

  useEffect(() => {
    return () => stopAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-start wake-word after first user gesture, if user opted-in.
  // Browsers block getUserMedia/SpeechRecognition until a user-gesture has
  // occurred, so we attach a one-shot listener for click/touch/keydown.
  useEffect(() => {
    if (!profileLoaded || !alwaysListening) return;
    const ready = checkMicReady();
    if (!ready.ok) return; // silently skip (banner shown elsewhere)

    // If already running, nothing to do
    if (stateRef.current !== "idle") return;

    // Try immediate start — may fail without gesture
    (async () => {
      const perm = await requestMicPermission();
      if (perm.ok && stateRef.current === "idle") startWakeWord();
    })();

    const onGesture = async () => {
      if (!alwaysListeningRef.current) return;
      if (stateRef.current !== "idle") return;
      const perm = await requestMicPermission();
      if (perm.ok) startWakeWord();
    };
    window.addEventListener("click", onGesture, { once: true, capture: true });
    window.addEventListener("touchstart", onGesture, { once: true, capture: true });
    window.addEventListener("keydown", onGesture, { once: true, capture: true });
    return () => {
      window.removeEventListener("click", onGesture, { capture: true });
      window.removeEventListener("touchstart", onGesture, { capture: true });
      window.removeEventListener("keydown", onGesture, { capture: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLoaded, alwaysListening]);

  const hasSpeechAPI = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!hasSpeechAPI) return null;
  const micCtx = checkMicReady(); // {ok, reason, hint}

  const showPanel = state !== "idle" && state !== "wakeword";

  return (
    <>
      {/* Persistent "Aria hört zu" pulse (only when always_listening + wakeword active) */}
      {alwaysListening && state === "wakeword" && (
        <div
          className={`fixed bottom-6 right-24 z-[9998] px-3 py-2 rounded-full text-[11px] font-bold flex items-center gap-2 shadow-lg ${
            isStarwars ? "bg-black/80 border border-[#E10600] text-[#E10600]"
              : isLcars ? "bg-[#0a0a14] border border-[var(--lcars-blue)] text-[var(--lcars-blue)]"
              : "bg-purple-950/90 border border-blue-400 text-blue-300"
          }`}
          style={{ textTransform: "none" }}
          data-testid="wakeword-indicator"
        >
          <span className={`w-2 h-2 rounded-full animate-pulse ${isStarwars ? "bg-[#E10600]" : "bg-blue-400"}`} />
          Sag „Aria"
        </div>
      )}

      {/* Always-listening toggle (small button above main mic) */}
      {micCtx.ok && (
        <button
          onClick={toggleAlwaysListening}
          title={alwaysListening ? 'Aria-Dauer-Mithören AUS' : 'Aria-Dauer-Mithören EIN (hört immer auf "Aria")'}
          className={`fixed bottom-24 right-6 z-[9998] w-10 h-10 rounded-full flex items-center justify-center transition-all shadow-md text-[9px] font-bold ${
            alwaysListening
              ? isStarwars ? "bg-[#E10600] text-white" : isLcars ? "bg-[var(--lcars-blue)] text-black" : "bg-blue-500 text-white"
              : isStarwars ? "bg-black/70 text-gray-400 border border-white/20" : isLcars ? "bg-[var(--lcars-purple)]/30 text-[var(--lcars-purple)]" : "bg-purple-900/50 text-purple-300"
          }`}
          data-testid="always-listening-toggle"
        >
          {alwaysListening ? "ON" : "OFF"}
        </button>
      )}

      {/* Floating Mic Button */}
      <button
        onClick={toggleVoice}
        data-testid="voice-assistant-button"
        className={`fixed bottom-6 right-6 z-[9998] w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg ${
          !micCtx.ok
            ? "bg-red-900/60 hover:bg-red-800/70"
            : state === "idle"
            ? isLcars ? "bg-[var(--lcars-purple)] hover:bg-[var(--lcars-mauve)]" : "bg-purple-600 hover:bg-purple-500"
            : state === "wakeword"
            ? isLcars ? "bg-[var(--lcars-blue)] animate-pulse" : "bg-blue-600 animate-pulse"
            : state === "listening"
            ? isLcars ? "bg-[var(--lcars-orange)]" : "bg-pink-500"
            : state === "processing"
            ? isLcars ? "bg-[var(--lcars-salmon)]" : "bg-yellow-500"
            : isLcars ? "bg-[var(--lcars-mauve)]" : "bg-green-500"
        }`}
        title={!micCtx.ok ? (micCtx.hint || "Mikrofon nicht verfügbar") : state === "idle" ? 'Klick zum Starten - sage dann "Aria"' : state === "wakeword" ? 'Warte auf "Aria"... (Klick = Sofort sprechen)' : ""}
      >
        {state === "speaking" ? (
          <SpeakerHigh size={24} weight="fill" className="text-black animate-pulse" />
        ) : state === "listening" ? (
          <div className="relative">
            <Microphone size={24} weight="fill" className="text-black" />
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping" />
          </div>
        ) : state === "processing" ? (
          <Waveform size={24} weight="fill" className="text-black animate-spin" />
        ) : (
          <Microphone size={24} weight="fill" className="text-black" />
        )}
      </button>

      {/* Voice Panel */}
      {showPanel && (
        <div className={`fixed bottom-24 right-6 z-[9998] w-80 rounded-xl p-4 shadow-2xl ${
          isLcars ? "bg-[#0a0a14] border-2 border-[var(--lcars-orange)]/50" : "bg-purple-950/95 backdrop-blur-lg border border-purple-500/30"
        }`} data-testid="voice-panel">
          <div className="flex items-center justify-between mb-3">
            <span className={`text-xs font-bold tracking-wider ${isLcars ? "text-[var(--lcars-orange)]" : "text-purple-300"}`}>
              {state === "listening" ? (isLcars ? "EMPFANGE SIGNAL..." : "Ich höre zu...") :
               state === "processing" ? (isLcars ? "VERARBEITE..." : "Verarbeite...") :
               state === "speaking" ? (isLcars ? "SENDE ANTWORT..." : "Spreche...") : "ARIA"}
            </span>
            <button onClick={dismiss} className="text-gray-500 hover:text-gray-300" data-testid="voice-dismiss">
              <X size={16} />
            </button>
          </div>

          {/* Waveform */}
          {state === "listening" && (
            <div className="flex items-center justify-center gap-1 h-12 mb-3">
              {[...Array(12)].map((_, i) => (
                <div key={i}
                  className={`w-1 rounded-full ${isLcars ? "bg-[var(--lcars-orange)]" : "bg-purple-400"}`}
                  style={{ animation: `wave-bar 0.4s ease-in-out ${i * 0.04}s infinite alternate` }}
                />
              ))}
            </div>
          )}

          {transcript && (
            <div className={`text-sm mb-2 p-2 rounded ${isLcars ? "bg-black/50 text-[var(--lcars-gold)]" : "bg-purple-900/50 text-purple-200"}`} style={{ textTransform: "none", letterSpacing: "normal" }}>
              {transcript}
            </div>
          )}

          {response && (
            <div className={`text-sm p-2 rounded ${isLcars ? "bg-black/50 text-gray-300 border-l-2 border-[var(--lcars-blue)]" : "bg-purple-900/30 text-purple-100 border-l-2 border-purple-400"}`}
              style={{ textTransform: "none", letterSpacing: "normal", maxHeight: "150px", overflowY: "auto" }}>
              {stripMarkdownForTTS(response)}
            </div>
          )}

          {error && <div className="text-xs text-red-400 mt-2" style={{ textTransform: "none" }}>{error}</div>}
        </div>
      )}

      <style>{`
        @keyframes wave-bar {
          0% { height: 6px; }
          100% { height: 30px; }
        }
      `}</style>
    </>
  );
};

export default VoiceAssistant;
