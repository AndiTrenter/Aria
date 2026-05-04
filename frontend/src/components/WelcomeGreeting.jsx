import { useEffect, useRef } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { speakStreaming } from "@/utils/ttsPlayer";

/**
 * Plays a personalized voice greeting once after a fresh login.
 * Trigger: sessionStorage flag `aria_pending_greeting` is set in AuthProvider.login().
 * Backend de-dup: /api/voice/greeting returns should_play=false if already greeted today.
 */
const WelcomeGreeting = () => {
  const { user } = useAuth();
  const playedRef = useRef(false);
  const ctrlRef = useRef(null);

  useEffect(() => {
    if (!user || playedRef.current) return;

    let pending = false;
    try { pending = sessionStorage.getItem("aria_pending_greeting") === "1"; } catch {}
    if (!pending) return;

    try { sessionStorage.removeItem("aria_pending_greeting"); } catch {}
    playedRef.current = true;

    const run = async () => {
      try {
        const { data } = await axios.get(`${API}/voice/greeting`);
        if (!data || !data.text || !data.should_play) return;

        ctrlRef.current = speakStreaming(data.text, {
          voice: data.voice || undefined,
          instructions:
            "Speak in clear, natural German. Warm welcoming tone, " +
            "like greeting a friend coming home. Pace yourself naturally.",
          onError: (e) => {
            console.info("[Aria] Greeting playback issue:", e?.message || e);
          },
        });
      } catch (err) {
        console.warn("[Aria] Greeting failed:", err?.response?.data || err?.message || err);
      }
    };

    const t = setTimeout(run, 600);
    return () => {
      clearTimeout(t);
      try { ctrlRef.current?.stop(); } catch {}
    };
  }, [user]);

  return null;
};

export default WelcomeGreeting;
