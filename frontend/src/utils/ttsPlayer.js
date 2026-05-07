/**
 * Aria TTS Player
 *
 * Goals:
 *  - Reduce perceived latency by splitting long answers into sentences and
 *    streaming them through TTS *in parallel*: the first short sentence is
 *    requested, played immediately, while the rest is generated in the
 *    background and queued.
 *  - Strip Markdown client-side as a safety net (server already strips, but
 *    older Aria responses or 3rd-party text may bypass it).
 *  - Provide a simple stop() control for the caller (chat play/stop button).
 */

import axios from "axios";
import { API } from "@/App";

// ---------- Markdown stripper (mirrors server-side, kept lenient) ----------
export function stripMarkdownForTTS(text) {
  if (!text) return "";
  let s = String(text);
  // code fences
  s = s.replace(/```[\s\S]*?```/g, " ");
  // inline code
  s = s.replace(/`([^`]+)`/g, "$1");
  // images ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // links [text](url)
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // bold **text** / __text__
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  // italic *text* / _text_
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1$2");
  s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1$2");
  // strikethrough ~~text~~
  s = s.replace(/~~([^~]+)~~/g, "$1");
  // headings
  s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]*/gm, "");
  // blockquotes
  s = s.replace(/^[ \t]*>[ \t]?/gm, "");
  // bullets / numbered list markers
  s = s.replace(/^[ \t]*[-*+][ \t]+/gm, "");
  s = s.replace(/^[ \t]*\d+\.[ \t]+/gm, "");
  // horizontal rules
  s = s.replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, "");
  // tables
  s = s.replace(/\|/g, " ");
  // stray asterisks / trailing underscores
  s = s.replace(/\*+/g, "");
  s = s.replace(/_+(?=\s|$)/g, "");
  // html
  s = s.replace(/<[^>]+>/g, "");
  // Normalize ARIA pronunciation — TTS reads "A.R.I.A." letter-by-letter
  // ("A. R. I. A.") which sounds robotic. Replace with the spoken form
  // "Aria" so it's pronounced as a proper name.
  s = s.replace(/\bA\.?\s*R\.?\s*I\.?\s*A\.?/gi, "Aria");
  // collapse whitespace
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

// ---------- Sentence splitter ----------
// Keeps the punctuation. Avoids splitting at common abbreviations.
const ABBREVIATIONS = new Set([
  "z.b", "z. b", "u.a", "u. a", "etc", "bspw", "bzw", "ca",
  "dr", "prof", "mr", "mrs", "st", "nr", "vgl", "vs", "abb"
]);

export function splitSentences(text) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  const out = [];
  let buf = "";
  const chars = Array.from(cleaned);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    buf += ch;
    if (/[.!?]/.test(ch)) {
      // Look at last token to skip abbreviations
      const m = buf.match(/(\S+)$/);
      const last = m ? m[1].toLowerCase().replace(/[.!?]+$/, "") : "";
      const next = chars[i + 1] || "";
      const isAbbrev = ABBREVIATIONS.has(last) || /^[A-Za-zÄÖÜäöü]\.$/.test(buf.slice(-2));
      if (!isAbbrev && (next === "" || /[\s"]/.test(next))) {
        const trimmed = buf.trim();
        if (trimmed) out.push(trimmed);
        buf = "";
      }
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);

  // Merge tiny fragments (< 12 chars) into the previous one for nicer prosody
  const merged = [];
  for (const s of out) {
    if (merged.length && s.length < 12) {
      merged[merged.length - 1] += " " + s;
    } else {
      merged.push(s);
    }
  }
  return merged;
}

// ---------- Chunking heuristic ----------
// We want the FIRST chunk to be short (fast TTS, fast playback), then we
// progressively allow bigger chunks because by then audio is already playing.
function buildChunks(text, maxFirstLen = 140, maxLen = 320) {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];

  const chunks = [];
  let current = "";
  let firstDone = false;
  for (const s of sentences) {
    const limit = firstDone ? maxLen : maxFirstLen;
    if (!current) {
      current = s;
    } else if ((current + " " + s).length <= limit) {
      current += " " + s;
    } else {
      chunks.push(current);
      firstDone = true;
      current = s;
    }
  }
  if (current) chunks.push(current);

  // If even the first sentence is huge (single paragraph without punctuation),
  // hard-split by character window so TTS can start ASAP.
  if (chunks[0] && chunks[0].length > maxFirstLen + 80) {
    const head = chunks[0];
    const cut = head.lastIndexOf(" ", maxFirstLen);
    const splitAt = cut > 60 ? cut : maxFirstLen;
    const a = head.slice(0, splitAt).trim();
    const b = head.slice(splitAt).trim();
    chunks.splice(0, 1, a, b);
  }
  return chunks;
}

// ---------- Player ----------
/**
 * Speak the text using sentence-level TTS streaming.
 *
 * @param {string} text — Aria response text (Markdown allowed, will be stripped).
 * @param {object} opts
 *   - voice  (string)            override voice id
 *   - instructions (string)      tone steering for gpt-4o-mini-tts
 *   - onStart  ()                fired right before first audio plays
 *   - onEnd    ()                fired after last sentence finished
 *   - onError  (err)             fired on first fatal error
 * @returns control object: { stop(): void, isPlaying(): boolean }
 */
export function speakStreaming(text, opts = {}) {
  const cleaned = stripMarkdownForTTS(text);
  const chunks = buildChunks(cleaned);

  let stopped = false;
  let currentAudio = null;
  let started = false;
  let ended = false;

  const fetched = chunks.map(() => null); // resolves to {url} | {error}
  const pending = chunks.map(() => null);

  const fetchChunk = async (idx) => {
    try {
      // Use native fetch — axios's XHR adapter has known issues reading
      // responseText on non-text responseType when the server returns an
      // error payload, which surfaces as an "Uncaught runtime error" in
      // React's dev overlay.
      const token = (typeof localStorage !== "undefined" && localStorage.getItem("aria_token")) || null;
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const resp = await fetch(`${API}/voice/tts`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          text: chunks[idx],
          voice: opts.voice || undefined,
          instructions: opts.instructions || undefined,
          raw: true,
        }),
      });
      if (stopped) return;
      if (!resp.ok) {
        // Drain body so the connection is released; do NOT raise.
        try { await resp.text(); } catch {}
        throw new Error(`TTS status ${resp.status}`);
      }
      const buf = await resp.arrayBuffer();
      if (stopped) return;
      const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
      fetched[idx] = { url };
    } catch (e) {
      fetched[idx] = { error: e };
      if (idx === 0 && opts.onError) {
        try { opts.onError(e); } catch {}
      }
    }
  };

  // Kick off all fetches in parallel — first sentence first, but no waiting.
  // We attach a no-op catch so any downstream await-less usage cannot surface
  // as "Unhandled promise rejection" in the browser console / dev overlay.
  for (let i = 0; i < chunks.length; i++) {
    const p = fetchChunk(i);
    p.catch(() => {});
    pending[i] = p;
  }

  const playFromIndex = async (idx) => {
    if (stopped) return;
    if (idx >= chunks.length) {
      ended = true;
      if (opts.onEnd) opts.onEnd();
      return;
    }
    // wait for chunk idx to be ready
    await pending[idx];
    if (stopped) return;
    const slot = fetched[idx];
    if (!slot || slot.error) {
      // Skip broken chunk, try next
      return playFromIndex(idx + 1);
    }
    const audio = new Audio(slot.url);
    audio.volume = 0.95;
    currentAudio = audio;
    audio.addEventListener("ended", () => {
      try { URL.revokeObjectURL(slot.url); } catch {}
      if (!stopped) playFromIndex(idx + 1);
    });
    audio.addEventListener("error", () => {
      try { URL.revokeObjectURL(slot.url); } catch {}
      if (!stopped) playFromIndex(idx + 1);
    });
    try {
      if (!started) {
        started = true;
        if (opts.onStart) opts.onStart();
      }
      await audio.play();
    } catch (e) {
      // Autoplay or other error
      if (idx === 0 && opts.onError) opts.onError(e);
      if (!stopped) playFromIndex(idx + 1);
    }
  };

  if (chunks.length === 0) {
    // Nothing to say
    setTimeout(() => { if (opts.onEnd) opts.onEnd(); }, 0);
  } else {
    playFromIndex(0);
  }

  return {
    stop() {
      stopped = true;
      try { currentAudio?.pause(); } catch {}
      currentAudio = null;
      // Revoke any queued URLs
      for (const slot of fetched) {
        if (slot && slot.url) {
          try { URL.revokeObjectURL(slot.url); } catch {}
        }
      }
      if (!ended && opts.onEnd) opts.onEnd();
    },
    isPlaying() { return started && !stopped && !ended; },
  };
}
