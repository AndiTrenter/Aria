import { useEffect, useRef } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";

/**
 * Plays a personalized voice greeting once after a fresh login.
 * Trigger: sessionStorage flag `aria_pending_greeting` is set in the AuthProvider's login() function.
 * Backend de-dup: /api/voice/greeting returns should_play=false if already greeted today.
 */
const WelcomeGreeting = () => {
  const { user } = useAuth();
  const playedRef = useRef(false);

  useEffect(() => {
    if (!user || playedRef.current) return;

    let pending = false;
    try { pending = sessionStorage.getItem("aria_pending_greeting") === "1"; } catch {}
    if (!pending) return;

    // Consume flag immediately to prevent duplicate runs (e.g. React StrictMode)
    try { sessionStorage.removeItem("aria_pending_greeting"); } catch {}
    playedRef.current = true;

    const run = async () => {
      try {
        // 1. Fetch greeting text + decision
        const { data } = await axios.get(`${API}/voice/greeting`);
        if (!data || !data.text || !data.should_play) {
          return;
        }

        // 2. Fetch TTS audio for the greeting (uses user's configured voice on backend)
        const ttsResp = await axios.post(
          `${API}/voice/tts`,
          { text: data.text, voice: data.voice || undefined },
          { responseType: "blob" }
        );
        const blob = new Blob([ttsResp.data], { type: "audio/mpeg" });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.volume = 0.95;

        // Some browsers block autoplay until first user gesture. Login click counts as gesture,
        // but if the browser still rejects, we silently fail (the next login will try again).
        try {
          await audio.play();
        } catch (err) {
          // Autoplay blocked — log only, don't surface a toast (would feel intrusive)
          console.info("[Aria] Greeting autoplay blocked:", err?.message || err);
        }

        audio.addEventListener("ended", () => URL.revokeObjectURL(url));
      } catch (err) {
        console.warn("[Aria] Greeting failed:", err?.response?.data || err?.message || err);
      }
    };

    // Small delay so login screen transition + Dashboard mount are stable first
    const t = setTimeout(run, 800);
    return () => clearTimeout(t);
  }, [user]);

  return null;
};

export default WelcomeGreeting;
