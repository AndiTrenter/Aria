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
 * Hold-to-speak (or tap-to-speak on Android) controller.
 *
 * ▸ Native Android (Capacitor APK):
 *     Uses the @capacitor-community/speech-recognition plugin in
 *     `popup: true` mode. Google's own speech UI overlay shows up,
 *     the user speaks naturally (no need to hold the button — just
 *     tap), and we receive a clean final transcript back. This is the
 *     SAME engine and UX as Google Assistant: rock-solid recognition,
 *     no need for partialResults listeners that don't fire reliably
 *     across Android variants.
 *
 * ▸ Browser / web preview:
 *     Falls back to Web Speech API with classic hold-to-talk semantics.
 */
export function nativeListen({
  lang = "de-DE",
  partialResults = true,
  onPartial = () => {},
  onFinal = () => {},
  onError = () => {},
} = {}) {
  if (isNative()) return androidListen({ lang, onPartial, onFinal, onError });
  return webListen({ lang, partialResults, onPartial, onFinal, onError });
}

/* ───────────── Native Android (popup mode) ─────────────────────────
 * Uses Google's built-in speech recognition activity. The OS handles
 * audio capture, partial-result feedback (its own overlay), and final
 * transcript delivery. Far more reliable than rolling our own.
 * ──────────────────────────────────────────────────────────────── */

function androidListen({ lang, onFinal, onError }) {
  let cancelled = false;
  let delivered = false;

  const deliver = (text) => {
    if (delivered || cancelled) return;
    delivered = true;
    onFinal((text || "").trim());
  };

  // Attempt start(); if the recogniser is in a stale "busy" state from a
  // prior invocation, stop it and retry once. Without this the SECOND
  // tap of the PTT button always fails with error 0 / RECOGNIZER_BUSY.
  const startOnce = async () => {
    return SpeechRecognition.start({
      language: lang,
      maxResults: 3,
      prompt: "",
      partialResults: false,
      popup: true,
    });
  };

  (async () => {
    try {
      // Make sure we have permission
      const perm = await SpeechRecognition.checkPermissions();
      if (perm.speechRecognition !== "granted") {
        const granted = await SpeechRecognition.requestPermissions();
        if (granted.speechRecognition !== "granted") {
          onError({ error: "not-allowed", message: "permission denied" });
          deliver("");
          return;
        }
      }

      let res;
      try {
        // First attempt: NO pre-cleanup. Calling stop() on a fresh engine
        // can leave it in an unhealthy state on some Android builds and
        // breaks the very next start() — exactly the regression the user
        // hit after the previous "always-stop-first" fix.
        res = await startOnce();
      } catch (e1) {
        // RECOGNIZER_BUSY / leftover session — clean up and retry once.
        try { console.warn("[androidListen] first start failed, retrying", e1); } catch {}
        try { await SpeechRecognition.stop(); } catch {}
        await new Promise((r) => setTimeout(r, 350));
        res = await startOnce();
      }

      const arr = res?.matches || [];
      const text = Array.isArray(arr) && arr.length > 0 ? arr[0] : "";
      deliver(text);
    } catch (e) {
      try { console.error("[androidListen] start() threw:", e); } catch {}
      onError(e);
      deliver("");
    }
  })();

  return {
    stop: () => {
      // popup mode handles its own stop/done — calling stop() here just
      // closes the dialog if the user wants to abort early.
      try { SpeechRecognition.stop(); } catch {}
    },
    cancel: () => {
      cancelled = true;
      try { SpeechRecognition.stop(); } catch {}
    },
    isNative: true,
  };
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
