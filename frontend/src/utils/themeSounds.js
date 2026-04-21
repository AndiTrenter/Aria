/**
 * Procedural sound effects per theme — uses Web Audio API, no external files.
 * One-time user-gesture-init ensures browser autoplay policies don't block us.
 */

let audioCtx = null;
let lastPlayedAt = 0;
// Prevent machine-gun click sounds — only play once per 80ms
const MIN_INTERVAL_MS = 80;

function getCtx() {
  if (audioCtx) return audioCtx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  } catch {
    return null;
  }
  return audioCtx;
}

function playTone(ctx, { freq, type = "sine", duration = 0.15, startAt = 0, volume = 0.15, sweepTo = null, attack = 0.01, release = 0.08 }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + startAt);
  if (sweepTo !== null) {
    osc.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + startAt + duration);
  }
  gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + startAt + attack);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + startAt + duration + release);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime + startAt);
  osc.stop(ctx.currentTime + startAt + duration + release + 0.02);
}

function playNoise(ctx, { duration = 0.05, startAt = 0, volume = 0.1 }) {
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + startAt + 0.002);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + startAt + duration);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start(ctx.currentTime + startAt);
  src.stop(ctx.currentTime + startAt + duration);
}

// ============ PER-THEME SIGNATURES ============

function lcarsBeep(ctx) {
  playTone(ctx, { freq: 1320, type: "sine", duration: 0.08, startAt: 0, volume: 0.18 });
  playTone(ctx, { freq: 880, type: "sine", duration: 0.1, startAt: 0.09, volume: 0.16 });
}

function disneySparkle(ctx) {
  const notes = [659.25, 783.99, 987.77, 1318.51];
  notes.forEach((f, i) => {
    playTone(ctx, {
      freq: f, type: "sine", duration: 0.2,
      startAt: i * 0.05, volume: 0.13,
      attack: 0.005, release: 0.18,
    });
  });
  playTone(ctx, { freq: 2637, type: "triangle", duration: 0.35, startAt: 0.18, volume: 0.05, release: 0.3 });
}

function fortnitePickup(ctx) {
  playTone(ctx, {
    freq: 440, sweepTo: 1760, type: "triangle",
    duration: 0.18, volume: 0.18, attack: 0.005, release: 0.05,
  });
  playTone(ctx, { freq: 2200, type: "triangle", duration: 0.08, startAt: 0.12, volume: 0.1 });
}

function minesweeperClick(ctx) {
  playNoise(ctx, { duration: 0.04, volume: 0.12 });
  playTone(ctx, {
    freq: 180, type: "square",
    duration: 0.03, volume: 0.1,
    attack: 0.001, release: 0.01,
  });
}

const SIGNATURES = {
  startrek: lcarsBeep,
  disney: disneySparkle,
  fortnite: fortnitePickup,
  minesweeper: minesweeperClick,
};

// --- Lighter click variants (for every nav/button click — not overbearing) ---
function lcarsClick(ctx) {
  playTone(ctx, { freq: 1500, type: "sine", duration: 0.04, volume: 0.09, attack: 0.002, release: 0.03 });
}
function disneyClick(ctx) {
  playTone(ctx, { freq: 1046.5, type: "sine", duration: 0.08, volume: 0.08, attack: 0.002, release: 0.06 });
  playTone(ctx, { freq: 1760, type: "triangle", duration: 0.06, startAt: 0.02, volume: 0.05, release: 0.05 });
}
function fortniteClick(ctx) {
  playTone(ctx, { freq: 800, sweepTo: 1400, type: "triangle", duration: 0.06, volume: 0.09, attack: 0.002, release: 0.04 });
}
function minesweeperLightClick(ctx) {
  playNoise(ctx, { duration: 0.02, volume: 0.08 });
  playTone(ctx, { freq: 220, type: "square", duration: 0.02, volume: 0.07, attack: 0.001, release: 0.008 });
}

const CLICK_SIGNATURES = {
  startrek: lcarsClick,
  disney: disneyClick,
  fortnite: fortniteClick,
  minesweeper: minesweeperLightClick,
};

/**
 * Play the full theme signature (e.g. on theme switch).
 */
export function playThemeSound(themeId) {
  try {
    if (localStorage.getItem("aria_sound_muted") === "1") return;
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const fn = SIGNATURES[themeId];
    if (fn) fn(ctx);
  } catch { /* silent */ }
}

/**
 * Lighter click sound — for frequent UI interactions (nav, buttons).
 * Throttled to max 1/80ms so multi-click-mashing doesn't become noisy.
 */
export function playThemeClick(themeId) {
  try {
    if (localStorage.getItem("aria_sound_muted") === "1") return;
    const now = Date.now();
    if (now - lastPlayedAt < MIN_INTERVAL_MS) return;
    lastPlayedAt = now;
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const fn = CLICK_SIGNATURES[themeId] || CLICK_SIGNATURES.startrek;
    fn(ctx);
  } catch { /* silent */ }
}

export function setThemeSoundMuted(muted) {
  try {
    localStorage.setItem("aria_sound_muted", muted ? "1" : "0");
  } catch {}
}

export function isThemeSoundMuted() {
  try {
    return localStorage.getItem("aria_sound_muted") === "1";
  } catch {
    return false;
  }
}
