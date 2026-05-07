/**
 * A.R.I.A. — synthesized sci-fi sound effects (Web Audio API, no assets).
 *
 * Why synthesis: we need < 1 KB of code instead of bundling .wav/.mp3,
 * the user can never "block" missing audio assets, and every browser
 * has Web Audio. All sounds are tuned cyan-cool, short and crisp so
 * they feel like J.A.R.V.I.S. UI tones.
 */

let _ctx = null;
let _muted = false;
let _masterGain = null;

const ctx = () => {
  if (_ctx) return _ctx;
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    _ctx = new C();
    _masterGain = _ctx.createGain();
    _masterGain.gain.value = 0.18; // global head-room — keep gentle
    _masterGain.connect(_ctx.destination);
  } catch {
    _ctx = null;
  }
  return _ctx;
};

// User-gesture unlock — call once after first user interaction.
export const unlockAudio = async () => {
  const c = ctx();
  if (c && c.state === "suspended") {
    try { await c.resume(); } catch {}
  }
};

export const setMuted = (m) => { _muted = !!m; };

const env = (gain, t0, attack, hold, release, peak = 1) => {
  // ADSR-ish envelope on a GainNode
  gain.cancelScheduledValues(t0);
  gain.setValueAtTime(0, t0);
  gain.linearRampToValueAtTime(peak, t0 + attack);
  gain.setValueAtTime(peak, t0 + attack + hold);
  gain.linearRampToValueAtTime(0, t0 + attack + hold + release);
};

const tone = (freqStart, freqEnd, dur = 0.18, type = "sine", vol = 0.6, delay = 0) => {
  if (_muted) return;
  const c = ctx();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, t0);
  if (freqEnd && freqEnd !== freqStart) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + dur);
  }
  env(g.gain, t0, 0.01, dur * 0.55, dur * 0.45, vol);
  osc.connect(g).connect(_masterGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
};

const noiseBurst = (dur = 0.12, vol = 0.25, delay = 0) => {
  if (_muted) return;
  const c = ctx();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.6;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = 2400;
  filt.Q.value = 12;
  const g = c.createGain();
  env(g.gain, t0, 0.005, dur * 0.4, dur * 0.55, vol);
  src.connect(filt).connect(g).connect(_masterGain);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
};

/* ─── Public effects ──────────────────────────────────────────── */

// Long, ascending boot — plays when ARIA mode mounts.
export const playBootSound = () => {
  unlockAudio();
  tone(180, 440, 0.55, "sine",     0.55, 0.0);
  tone(360, 720, 0.45, "triangle", 0.35, 0.15);
  tone(720, 1000, 0.30, "sine",    0.30, 0.30);
  noiseBurst(0.20, 0.18, 0.05);
};

// Quick chirp when wake word is recognized.
export const playWakeSound = () => {
  unlockAudio();
  tone(880, 1320, 0.10, "sine", 0.55);
  tone(1320, 1760, 0.08, "sine", 0.35, 0.06);
};

// Soft ping — start of active dictation.
export const playListenSound = () => {
  unlockAudio();
  tone(1200, 1200, 0.08, "sine", 0.5);
};

// Two-tone confirmation — request handled / done.
export const playDoneSound = () => {
  unlockAudio();
  tone(660, 660, 0.08, "sine", 0.45);
  tone(990, 990, 0.10, "sine", 0.4, 0.07);
};

// Soft low blip — error / cancel.
export const playErrorSound = () => {
  unlockAudio();
  tone(220, 140, 0.20, "sawtooth", 0.4);
};

// Subtle high tick — used per "thought" step appearing in the overlay.
export const playThinkTick = () => {
  unlockAudio();
  tone(1500, 1700, 0.04, "sine", 0.18);
};
