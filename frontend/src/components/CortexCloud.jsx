import { useEffect, useRef } from "react";

/**
 * J.A.R.V.I.S.-style animated cortex cloud.
 *
 * Props:
 *   intensity (0..1)   overall animation energy (drives speed, pulse, glow, arcs)
 *   speaking  (bool)   if true, adds audio-reactive bursts (assumes caller keeps
 *                      intensity high while speaking)
 *   listening (bool)   if true, adds a subtle "receptive" blue rim pulse
 *   size      (px)     canvas width/height (it's square)
 *
 * Everything is drawn on a 2D canvas — no external 3D lib needed. The point
 * cloud is a set of ~450 particles distributed on a unit sphere and rotated
 * with simple trig projection, so the result feels 3D without Three.js.
 */
export default function CortexCloud({ intensity = 0.25, speaking = false, listening = false, size = 560 }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const stateRef = useRef({ intensity, speaking, listening });

  useEffect(() => {
    stateRef.current = { intensity, speaking, listening };
  }, [intensity, speaking, listening]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = size;
    const H = size;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.scale(dpr, dpr);

    // Build particle field on unit sphere
    const N = 480;
    const particles = [];
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      particles.push({
        x: r * Math.cos(phi),
        y: u,
        z: r * Math.sin(phi),
        radius: 0.5 + Math.random() * 0.7,
        speed: 0.4 + Math.random() * 1.2,
        phase: Math.random() * Math.PI * 2,
        hue: 185 + Math.random() * 35, // cyan → blue
      });
    }

    const arcs = [];
    const rings = [];
    let startTs = performance.now();

    const render = (ts) => {
      const t = (ts - startTs) / 1000;
      const s = stateRef.current;
      const I = Math.max(0, Math.min(1, s.intensity));
      const speedMul = 0.35 + I * 3.2;
      const pulseFreq = 0.9 + I * 3.5;

      const cx = W / 2;
      const cy = H / 2;
      const baseR = W * 0.3;

      // Motion-trail clear
      ctx.fillStyle = `rgba(0, 3, 10, ${0.22 + (1 - I) * 0.05})`;
      ctx.fillRect(0, 0, W, H);

      // ----- Core orb (multi-layer radial glow) -----
      const pulse = Math.sin(t * pulseFreq) * 0.08 * (0.5 + I) + 1;
      const coreR = baseR * 0.38 * pulse;

      const gOuter = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * 1.7);
      gOuter.addColorStop(0, `rgba(120, 220, 255, ${0.28 + I * 0.3})`);
      gOuter.addColorStop(0.35, `rgba(70, 170, 255, ${0.18 + I * 0.18})`);
      gOuter.addColorStop(0.7, `rgba(30, 80, 200, ${0.08 + I * 0.1})`);
      gOuter.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = gOuter;
      ctx.beginPath();
      ctx.arc(cx, cy, baseR * 1.7, 0, Math.PI * 2);
      ctx.fill();

      const gCore = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      gCore.addColorStop(0, `rgba(220, 250, 255, ${0.85 - I * 0.15})`);
      gCore.addColorStop(0.4, `rgba(140, 230, 255, ${0.6 + I * 0.2})`);
      gCore.addColorStop(1, "rgba(40, 120, 220, 0)");
      ctx.fillStyle = gCore;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      // ----- Rotating particle cloud -----
      const rotY = t * 0.35 * speedMul;
      const rotX = t * 0.18 * speedMul;
      const cY = Math.cos(rotY);
      const sY = Math.sin(rotY);
      const cX = Math.cos(rotX);
      const sX = Math.sin(rotX);

      for (const p of particles) {
        // rotate around Y
        let x = p.x * cY + p.z * sY;
        let z = -p.x * sY + p.z * cY;
        let y = p.y;
        // rotate around X
        const y2 = y * cX - z * sX;
        const z2 = y * sX + z * cX;
        y = y2;
        z = z2;

        const breathing = 1 + Math.sin(t * 1.6 * p.speed + p.phase) * 0.14 * (0.5 + I);
        const rr = baseR * breathing;

        const scale = 420 / (420 + z * baseR);
        const px = cx + x * rr * scale;
        const py = cy + y * rr * scale;
        const psize = p.radius * (1.1 + I * 1.6) * scale;
        const depthAlpha = (z + 1) * 0.5; // 0 (back) … 1 (front)
        const alpha = (0.25 + depthAlpha * 0.55) * (0.8 + I * 0.2);

        ctx.shadowBlur = 8 + I * 10;
        ctx.shadowColor = `hsl(${p.hue}, 100%, 65%)`;
        ctx.fillStyle = `hsla(${p.hue}, 100%, 72%, ${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, psize, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // ----- Lightning arcs (only on higher intensity / speaking bursts) -----
      const spawnArc = I > 0.35 && Math.random() < 0.02 + I * 0.1;
      if (spawnArc) {
        const a1 = Math.random() * Math.PI * 2;
        const spread = 0.3 + Math.random() * 0.9;
        const a2 = a1 + (Math.random() > 0.5 ? spread : -spread);
        arcs.push({
          x1: cx + Math.cos(a1) * baseR * (0.85 + Math.random() * 0.15),
          y1: cy + Math.sin(a1) * baseR * (0.85 + Math.random() * 0.15),
          x2: cx + Math.cos(a2) * baseR * (0.85 + Math.random() * 0.15),
          y2: cy + Math.sin(a2) * baseR * (0.85 + Math.random() * 0.15),
          life: 1,
          seed: Math.random(),
        });
      }
      for (let i = arcs.length - 1; i >= 0; i--) {
        const a = arcs[i];
        ctx.strokeStyle = `rgba(180, 240, 255, ${a.life * 0.9})`;
        ctx.lineWidth = 1.3;
        ctx.shadowBlur = 12;
        ctx.shadowColor = "rgba(130, 230, 255, 1)";
        ctx.beginPath();
        ctx.moveTo(a.x1, a.y1);
        const segs = 3;
        for (let k = 1; k <= segs; k++) {
          const f = k / (segs + 1);
          const mx = a.x1 + (a.x2 - a.x1) * f + (Math.random() - 0.5) * 28;
          const my = a.y1 + (a.y2 - a.y1) * f + (Math.random() - 0.5) * 28;
          ctx.lineTo(mx, my);
        }
        ctx.lineTo(a.x2, a.y2);
        ctx.stroke();
        a.life -= 0.08 + I * 0.06;
        if (a.life <= 0) arcs.splice(i, 1);
      }
      ctx.shadowBlur = 0;

      // ----- Shockwave rings when speaking -----
      if (s.speaking && Math.random() < 0.07 + I * 0.12) {
        rings.push({ r: baseR * 0.9, life: 1 });
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i];
        ctx.strokeStyle = `rgba(120, 220, 255, ${ring.life * 0.55})`;
        ctx.lineWidth = 1.6 * ring.life;
        ctx.beginPath();
        ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
        ctx.stroke();
        ring.r += 2.5 + I * 3;
        ring.life -= 0.015;
        if (ring.life <= 0 || ring.r > baseR * 1.8) rings.splice(i, 1);
      }

      // ----- Outer HUD ring + tick marks -----
      ctx.strokeStyle = `rgba(90, 190, 255, ${0.25 + I * 0.35})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, baseR * 1.1, 0, Math.PI * 2);
      ctx.stroke();

      // second faint ring that counter-rotates
      ctx.strokeStyle = `rgba(110, 210, 255, ${0.18 + I * 0.25})`;
      ctx.setLineDash([4, 8]);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-rotY * 0.5);
      ctx.beginPath();
      ctx.arc(0, 0, baseR * 1.32, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.setLineDash([]);

      // tick marks
      ctx.strokeStyle = `rgba(150, 220, 255, ${0.35 + I * 0.45})`;
      ctx.lineWidth = 1.2;
      const ticks = 36;
      for (let i = 0; i < ticks; i++) {
        const a = (i / ticks) * Math.PI * 2 + rotY * 0.25;
        const r1 = baseR * 1.15;
        const r2 = baseR * (i % 3 === 0 ? 1.23 : 1.19);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }

      // Listening accent rim
      if (s.listening) {
        ctx.strokeStyle = `rgba(100, 220, 255, ${0.3 + Math.sin(t * 4) * 0.25})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(cx, cy, baseR * 1.05, 0, Math.PI * 2);
        ctx.stroke();
      }

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [size]);

  return <canvas ref={canvasRef} style={{ display: "block" }} />;
}
