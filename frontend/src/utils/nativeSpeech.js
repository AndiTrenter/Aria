/**
 * nativeSpeech.js
 * ----------------
 * Push-to-talk speech recognition with a HYBRID strategy:
 *
 *   1) Web Speech API (window.SpeechRecognition) — works reliably inside
 *      Capacitor's WebView and consistently fires interim + final results.
 *      THIS IS THE PRIMARY PATH because the native plugin's events have
 *      proven flaky on some Android builds (partial events never fire,
 *      `start()` returns immediately with empty matches, etc).
 *
 *   2) Native plugin (@capacitor-community/speech-recognition) — used
 *      only as a permission/availability checker. We don't actually
 *      route audio through it because of the reliability issues above.
 *
 * The exported API is `nativeListen()` returning { stop, cancel } — the
 * AriaMode component doesn't need to know which engine ran underneath.
 */
import { SpeechRecognition } from "@capacitor-community/speech-recognition";

const isNative = () =>
  !!(typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.());

/**
 * Pre-flight: request mic permission via the native plugin if we're on
 * Android (it has a nicer system dialog than the bare WebView prompt)
 * and verify the recogniser is available at all.
 */
export async function ensureSpeechReady() {
  if (!isNative()) return { ok: true, native: false };
  try {
    const avail = await SpeechRecognition.available();
    if (!avail?.available) return { ok: false, reason: "engine-not-available" };
    let perm = await SpeechRecognition.checkPermissions();
    if (perm.speechRecognition !== "granted") {
      perm = await SpeechRecognition.requestPermissions();
      if (perm.speechRecognition !== "granted") return { ok: false, reason: "denied" };
    }
    return { ok: true, native: true };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

/**
 * Hold-to-speak controller. Always uses Web Speech API regardless of
 * platform — it works in WebView and never silently drops events the
 * way the native plugin's listeners do.
 */
export function nativeListen({
  lang = "de-DE",
  partialResults = true,
  onPartial = () => {},
  onFinal = () => {},
  onError = () => {},
} = {}) {
  return webListen({ lang, partialResults, onPartial, onFinal, onError });
}

/* ───────────── Web Speech API ──────────────────────────────────────
 * Primary engine — runs inside the Capacitor WebView with Chrome's
 * speech recogniser. Requires online connectivity (Google's STT).
 * ──────────────────────────────────────────────────────────────── */

function webListen({ lang, partialResults, onPartial, onFinal, onError }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    setTimeout(() => onError(new Error("speech-recognition-not-supported")), 0);
    return { stop: () => {}, cancel: () => {}, isNative: false };
  }
  let bestSoFar = "";
  let stopped = false;
  let cancelled = false;
  const rec = new SR();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = partialResults;
  try { rec.maxAlternatives = 3; } catch {}

  const finalize = (text) => {
    if (stopped || cancelled) return;
    stopped = true;
    try { rec.stop(); } catch {}
    if (!cancelled) onFinal((text ?? bestSoFar).trim());
  };

  rec.onresult = (e) => {
    let final = "", interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t; else interim += t;
    }
    const cur = (final + " " + interim).trim();
    if (cur) {
      bestSoFar = cur;
      try { onPartial(cur); } catch {}
    }
    // If we got an actual final segment, deliver it immediately —
    // don't wait for onend (some Android Chrome builds delay onend by
    // 1-3 s after the final result).
    if (final.trim()) finalize(bestSoFar);
  };
  rec.onend = () => {
    if (stopped || cancelled) return;
    finalize(bestSoFar);
  };
  rec.onerror = (ev) => {
    try { onError(ev); } catch {}
    // For no-speech we still want a clean idle, not a silent hang
    if (ev?.error === "no-speech" || ev?.error === "aborted") {
      finalize(bestSoFar);
    }
  };
  try { rec.start(); } catch (e) { onError(e); }

  return {
    stop: () => {
      try { rec.stop(); } catch {}
      // Safety net: if onend doesn't fire within 1.5 s, commit best-so-far
      setTimeout(() => finalize(bestSoFar), 1500);
    },
    cancel: () => { cancelled = true; try { rec.abort(); } catch {} },
    isNative: false,
  };
}
