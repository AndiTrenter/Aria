/**
 * nativeSpeech.js
 * ----------------
 * Thin wrapper around `@capacitor-community/speech-recognition` that
 * exposes a single `nativeListen()` API matching the shape we need for
 * push-to-talk in ARIA.
 *
 * Why a native plugin?
 *   On Android, the Web Speech API inside Capacitor's WebView routes
 *   through Chrome's online speech-recognition endpoint — which is OK
 *   in a tab but degrades badly inside a webview (poorer mic capture,
 *   late finals, frequent silent failures). The native plugin talks
 *   directly to Android's `SpeechRecognizer`, the same engine the
 *   "Hey Google" assistant uses. Result: dramatically better accuracy
 *   and reliability, especially at distance and in noisy rooms.
 *
 * Behaviour:
 *   • Returns a controller exposing { stop, cancel }.
 *   • Calls `onPartial(text)` for every interim transcription.
 *   • Calls `onFinal(text)` once with the final transcription
 *     after stop() / a natural pause / engine end.
 *   • Falls back to Web Speech API on platforms where the native
 *     plugin isn't available (browser preview, iOS without plugin).
 */
import { SpeechRecognition } from "@capacitor-community/speech-recognition";

const isNative = () =>
  !!(typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.());

/**
 * Pre-flight: request permission and confirm the engine is available.
 * Call ONCE on app startup if you want to surface a permission prompt
 * eagerly — otherwise nativeListen() will handle it lazily.
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
 * Start listening. The returned controller's stop() ends the recognition
 * and triggers an onFinal callback with the best-so-far transcript.
 * cancel() aborts without firing onFinal.
 */
export function nativeListen({
  lang = "de-DE",
  maxResults = 3,
  partialResults = true,
  onPartial = () => {},
  onFinal = () => {},
  onError = () => {},
} = {}) {
  if (!isNative()) {
    return webListen({ lang, partialResults, onPartial, onFinal, onError });
  }

  let bestSoFar = "";
  let stopped = false;
  let cancelled = false;
  let partialHandle = null;
  let resultHandle = null;
  let listenStateHandle = null;

  const finalize = (text) => {
    if (stopped || cancelled) return;
    stopped = true;
    try { partialHandle && partialHandle.remove?.(); } catch {}
    try { resultHandle && resultHandle.remove?.(); } catch {}
    try { listenStateHandle && listenStateHandle.remove?.(); } catch {}
    if (!cancelled) onFinal((text ?? bestSoFar).trim());
  };

  (async () => {
    try {
      // Attach the partial-results listener BEFORE start() so we don't
      // miss the first interim chunk on fast engines.
      partialHandle = await SpeechRecognition.addListener(
        "partialResults",
        (data) => {
          const arr = data?.matches || data?.value || [];
          const txt = Array.isArray(arr) ? (arr[0] || "") : String(arr || "");
          if (txt) {
            bestSoFar = txt;
            try { onPartial(txt); } catch {}
          }
        }
      );

      // Some plugin versions ALSO emit a "result" event for the final.
      // Subscribe defensively — if it fires, finalize immediately.
      try {
        resultHandle = await SpeechRecognition.addListener?.(
          "result",
          (data) => {
            const arr = data?.matches || data?.value || [];
            const txt = Array.isArray(arr) ? (arr[0] || "") : String(arr || "");
            if (txt) {
              bestSoFar = txt;
              finalize(txt);
            }
          }
        );
      } catch {}

      // listeningState transitions to "false" when the engine actually
      // stops — second-best signal for "we're done, deliver result".
      try {
        listenStateHandle = await SpeechRecognition.addListener?.(
          "listeningState",
          (data) => {
            if (data?.status === false || data?.listening === false) {
              // Engine closed; if start() hasn't resolved within 800ms,
              // submit our best-so-far so the UI never freezes.
              setTimeout(() => finalize(bestSoFar), 800);
            }
          }
        );
      } catch {}

      // popup must be FALSE for partialResults to work on Android per the
      // plugin docs. We also pass an empty prompt to suppress the
      // built-in system dialog.
      //
      // IMPORTANT (Android quirk): with popup=false, `start()` resolves
      // IMMEDIATELY — not when speech recognition is done. The real
      // results arrive via the `partialResults` + `result` + `listeningState`
      // listeners we attached above. We therefore IGNORE the start()
      // return value here and let the listeners (or our 1.2 s safety
      // timeout on stop()) drive `finalize()`.
      await SpeechRecognition.start({
        language: lang,
        maxResults,
        prompt: "",
        partialResults,
        popup: false,
      });
    } catch (e) {
      try { console.error("[nativeSpeech] start() threw:", e); } catch {}
      if (!cancelled) {
        try { onError(e); } catch {}
        finalize(bestSoFar);
      }
    }
  })();

  return {
    stop: async () => {
      try { await SpeechRecognition.stop(); } catch {}
      // start()'s promise will resolve with the final result; finalize
      // happens there. As a safety net in case the engine doesn't reply,
      // we force-finalize after 1200 ms.
      setTimeout(() => finalize(bestSoFar), 1200);
    },
    cancel: async () => {
      cancelled = true;
      try { partialHandle && partialHandle.remove?.(); } catch {}
      try { resultHandle && resultHandle.remove?.(); } catch {}
      try { listenStateHandle && listenStateHandle.remove?.(); } catch {}
      try { await SpeechRecognition.stop(); } catch {}
    },
    isNative: true,
  };
}

/* ───────────── Web Speech API fallback (for browser preview) ──────── */

function webListen({ lang, partialResults, onPartial, onFinal, onError }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    setTimeout(() => onError(new Error("Speech recognition not supported")), 0);
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
  };
  rec.onend = () => {
    if (stopped || cancelled) return;
    stopped = true;
    if (!cancelled) onFinal(bestSoFar.trim());
  };
  rec.onerror = (ev) => {
    try { onError(ev); } catch {}
  };
  try { rec.start(); } catch (e) { onError(e); }

  return {
    stop: () => { try { rec.stop(); } catch {} },
    cancel: () => { cancelled = true; try { rec.abort(); } catch {} },
    isNative: false,
  };
}
