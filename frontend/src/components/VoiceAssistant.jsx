import { useState, useEffect, useRef } from "react";
import { useTheme, API } from "@/App";
import axios from "axios";
import { Microphone, SpeakerHigh, X, Waveform } from "@phosphor-icons/react";

const VoiceAssistant = () => {
  const { theme } = useTheme();
  const [state, setState] = useState("idle"); // idle | wakeword | listening | processing | speaking
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [error, setError] = useState("");
  const recognitionRef = useRef(null);
  const stateRef = useRef(state);
  const isLcars = theme === "startrek";

  useEffect(() => { stateRef.current = state; }, [state]);

  const stopAll = () => {
    try { recognitionRef.current?.stop(); } catch {}
    window.speechSynthesis?.cancel();
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
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "de-DE";
    utter.rate = 1.0;
    utter.pitch = isLcars ? 0.9 : 1.1;
    utter.onstart = () => setState("speaking");
    utter.onend = () => { setState("idle"); startWakeWord(); };
    utter.onerror = () => { setState("idle"); startWakeWord(); };
    synth.speak(utter);
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
          const { data: haResult } = await axios.post(`${API}/ha/command`, { command: text });
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
      setTimeout(startWakeWord, 1000);
    };

    rec.onend = () => {
      if (stateRef.current === "listening") {
        setState("idle");
        setTimeout(startWakeWord, 500);
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
        setTimeout(startWakeWord, 500);
      }
    };

    rec.onend = () => {
      const s = stateRef.current;
      if (s === "wakeword" || s === "idle") {
        setTimeout(startWakeWord, 300);
      }
    };

    recognitionRef.current = rec;
    setState("wakeword");
    try { rec.start(); } catch {}
  };

  const toggleVoice = () => {
    if (state === "idle") {
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

  const hasSpeechAPI = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!hasSpeechAPI) return null;

  const showPanel = state !== "idle" && state !== "wakeword";

  return (
    <>
      {/* Floating Mic Button */}
      <button
        onClick={toggleVoice}
        data-testid="voice-assistant-button"
        className={`fixed bottom-6 right-6 z-[9998] w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg ${
          state === "idle"
            ? isLcars ? "bg-[var(--lcars-purple)] hover:bg-[var(--lcars-mauve)]" : "bg-purple-600 hover:bg-purple-500"
            : state === "wakeword"
            ? isLcars ? "bg-[var(--lcars-blue)] animate-pulse" : "bg-blue-600 animate-pulse"
            : state === "listening"
            ? isLcars ? "bg-[var(--lcars-orange)]" : "bg-pink-500"
            : state === "processing"
            ? isLcars ? "bg-[var(--lcars-salmon)]" : "bg-yellow-500"
            : isLcars ? "bg-[var(--lcars-mauve)]" : "bg-green-500"
        }`}
        title={state === "idle" ? 'Klick zum Starten - sage dann "Aria"' : state === "wakeword" ? 'Warte auf "Aria"... (Klick = Sofort sprechen)' : ""}
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
              {response}
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
