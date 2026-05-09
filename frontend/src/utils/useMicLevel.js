/**
 * Hook: read live microphone amplitude via Web Audio API.
 *
 * Returns a ref-style { current: number } updated every frame with a
 * 0..1 normalised volume.  When `active` is false we release the mic
 * stream (no permission prompts after the user disables listening).
 *
 * Usage:
 *   const level = useMicLevel(mode === "listening");
 *   <Cortex intensity={Math.max(0.25, level.current)} />
 *
 * Why a ref instead of state: at 60 Hz, calling setState on every
 * sample would re-render the cortex 60×/s which is wasteful — the
 * Three.js scene already polls the value directly inside its own
 * RAF loop.
 */
import { useEffect, useRef } from "react";

export default function useMicLevel(active) {
  const levelRef = useRef(0);

  useEffect(() => {
    if (!active) {
      levelRef.current = 0;
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) return;

    let stream = null;
    let ctx = null;
    let analyser = null;
    let raf = null;
    let stopped = false;

    const run = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC();
        const src = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.65;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (stopped) return;
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          // Normalise: mean 0..255 → boost low end by 1.4× since speech
          // typically lives in mid frequencies.  Clamp to 0..1.
          const mean = sum / data.length / 255;
          const boosted = Math.min(1, mean * 1.6);
          levelRef.current = boosted;
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        levelRef.current = 0;
      }
    };
    run();

    return () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      try { stream?.getTracks().forEach((t) => t.stop()); } catch {}
      try { ctx?.close(); } catch {}
      levelRef.current = 0;
    };
  }, [active]);

  return levelRef;
}
