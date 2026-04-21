/**
 * Procedural sound effects per theme — uses Web Audio API, no external files.
 * One-time user-gesture-init ensures browser autoplay policies don't block us.
 */

let audioCtx = null;

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
  // Classic Trek 2-tone: high → low
  playTone(ctx, { freq: 1320, type: "sine", duration: 0.08, startAt: 0, volume: 0.18 });
  playTone(ctx, { freq: 880, type: "sine", duration: 0.1, startAt: 0.09, volume: 0.16 });
}

function disneySparkle(ctx) {
  // Ascending magical sparkle — 4 rising sine tones with vibraphone-ish attack
  const notes = [659.25, 783.99, 987.77, 1318.51]; // E5 G5 B5 E6
  notes.forEach((f, i) => {
    playTone(ctx, {
      freq: f, type: "sine", duration: 0.2,
      startAt: i * 0.05, volume: 0.13,
      attack: 0.005, release: 0.18,
    });
  });
  // Add a gentle shimmer overlay
  playTone(ctx, { freq: 2637, type: "triangle", duration: 0.35, startAt: 0.18, volume: 0.05, release: 0.3 });
}

function fortnitePickup(ctx) {
  // Bright item-pickup: fast upward sweep + click
  playTone(ctx, {
    freq: 440, sweepTo: 1760, type: "triangle",
    duration: 0.18, volume: 0.18, attack: 0.005, release: 0.05,
  });
  playTone(ctx, { freq: 2200, type: "triangle", duration: 0.08, startAt: 0.12, volume: 0.1 });
}

function minesweeperClick(ctx) {
  // Short, low classic Windows click — noise burst + low thud
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

/**
 * Play the sound signature for a theme. Safe to call during/after user gesture.
 * Respects localStorage key 'aria_sound_muted' for opt-out.
 */
export function playThemeSound(themeId) {
  try {
    if (localStorage.getItem("aria_sound_muted") === "1") return;
    const ctx = getCtx();
    if (!ctx) return;
    // Resume suspended context (browsers require user gesture)
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    const fn = SIGNATURES[themeId];
    if (fn) fn(ctx);
  } catch {
    /* fail silent — sound is a nice-to-have, never blocking */
  }
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
