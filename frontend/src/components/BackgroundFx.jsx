import { useEffect, useRef } from "react";

/**
 * Subtle animated techy background for ARIA mode.
 *
 * Renders into a full-screen <canvas> behind the rest of the UI:
 *   - 60 floating "data nodes" drifting slowly across the screen
 *   - Lines drawn between any two nodes that are close enough,
 *     opacity proportional to closeness → looks like a live network
 *   - Random scan-bursts: a horizontal scan line that sweeps once
 *     in a while, brighter on intersected nodes
 *   - Distant grid pulse — diagonal lines fade in/out subtly
 *
 * Designed to be CPU-cheap (no Three.js, single 2D canvas, ~60fps even
 * on a low-end laptop) and visually quiet (low opacity throughout) so
 * it doesn't compete with the foreground holographic core.
 */

export default function BackgroundFx({ mode = "idle" }) {
  const canvasRef = useRef(null);
  const stateRef = useRef({ mode });
  const rafRef = useRef(null);

  useEffect(() => { stateRef.current = { mode }; }, [mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0;
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // ── Floating data nodes ─────────────────────────────────────
    const NODES = 60;
    const nodes = [];
    const seedNodes = () => {
      nodes.length = 0;
      for (let i = 0; i < NODES; i++) {
        nodes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.18,
          vy: (Math.random() - 0.5) * 0.18,
          r:  0.7 + Math.random() * 1.6,
          phase: Math.random() * Math.PI * 2,
        });
      }
    };
    seedNodes();
    // Re-seed when window resizes meaningfully
    let lastW = w, lastH = h;
    const maybeReseed = () => {
      if (Math.abs(w - lastW) > 80 || Math.abs(h - lastH) > 80) {
        lastW = w; lastH = h;
        seedNodes();
      }
    };

    // ── Mode color picker ──────────────────────────────────────
    // Same red-orange "arc-reactor" palette family as the cortex.
    const modeColor = (m) => {
      switch (m) {
        case "listening": return [255, 170, 60];   // orange-amber
        case "thinking":  return [255, 200, 60];   // hot amber
        case "speaking":  return [255, 90, 60];    // bright red
        case "wakeword":  return [255, 110, 70];   // crimson
        default:          return [255, 100, 70];   // idle red-orange
      }
    };

    // Smooth-interpolated colour so mode transitions are soft.
    const cur = [255, 100, 70];

    // ── Scan burst state ──────────────────────────────────────
    let scanY = -1;
    let scanActive = false;
    let scanT = 0;
    const startScan = () => {
      scanActive = true;
      scanY = -10;
      scanT = 0;
    };

    let lastT = performance.now();
    let totalT = 0;
    let nextScanIn = 6 + Math.random() * 8;

    const tick = (now) => {
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      totalT += dt;
      maybeReseed();

      // Lerp current colour toward mode colour (slow ~0.4s)
      const target = modeColor(stateRef.current.mode);
      cur[0] += (target[0] - cur[0]) * Math.min(1, dt * 2.5);
      cur[1] += (target[1] - cur[1]) * Math.min(1, dt * 2.5);
      cur[2] += (target[2] - cur[2]) * Math.min(1, dt * 2.5);
      const cR = Math.round(cur[0]), cG = Math.round(cur[1]), cB = Math.round(cur[2]);

      // Clear (don't use alpha trick; full clear → no smearing)
      ctx.clearRect(0, 0, w, h);

      // ── Soft diagonal grid pulse (very subtle) ──────────────
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const gridA = 0.04 + 0.025 * Math.sin(totalT * 0.6);
      ctx.strokeStyle = `rgba(${cR},${cG},${cB},${gridA.toFixed(3)})`;
      ctx.lineWidth = 1;
      const step = 70;
      const offset = (totalT * 12) % step;
      for (let x = -h - step; x < w + h + step; x += step) {
        ctx.beginPath();
        ctx.moveTo(x + offset, 0);
        ctx.lineTo(x + offset + h, h);
        ctx.stroke();
      }
      ctx.restore();

      // ── Update + draw nodes ────────────────────────────────
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < -10) n.x = w + 10;
        if (n.x > w + 10) n.x = -10;
        if (n.y < -10) n.y = h + 10;
        if (n.y > h + 10) n.y = -10;
        n.phase += dt * 1.4;
      }

      // ── Network lines between close nodes ─────────────────
      const MAX_DIST = 170;
      const MAX_DIST_SQ = MAX_DIST * MAX_DIST;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 0.7;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dsq = dx * dx + dy * dy;
          if (dsq < MAX_DIST_SQ) {
            const closeness = 1 - Math.sqrt(dsq) / MAX_DIST;
            const opacity = closeness * closeness * 0.18;
            ctx.strokeStyle = `rgba(${cR},${cG},${cB},${opacity.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      ctx.restore();

      // ── Draw nodes (small glow points) ─────────────────────
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const flick = 0.6 + Math.sin(n.phase) * 0.4;
        const a = 0.55 * flick;
        const r = n.r * (1 + 0.15 * Math.sin(n.phase * 1.3));
        // Soft glow halo
        const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 6);
        grad.addColorStop(0, `rgba(${cR},${cG},${cB},${(a * 0.9).toFixed(3)})`);
        grad.addColorStop(0.4, `rgba(${cR},${cG},${cB},${(a * 0.25).toFixed(3)})`);
        grad.addColorStop(1, `rgba(${cR},${cG},${cB},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 6, 0, Math.PI * 2);
        ctx.fill();
        // Hard centre
        ctx.fillStyle = `rgba(${Math.min(255, cR + 40)},${Math.min(255, cG + 40)},${Math.min(255, cB + 30)},${(a * 0.95).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // ── Random scan burst (every 6-14s) ───────────────────
      nextScanIn -= dt;
      if (nextScanIn <= 0 && !scanActive) {
        startScan();
        nextScanIn = 6 + Math.random() * 8;
      }
      if (scanActive) {
        scanT += dt;
        scanY += (h + 40) * dt * 0.55;
        // bright thin line + soft trail
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const trail = ctx.createLinearGradient(0, scanY - 80, 0, scanY + 4);
        trail.addColorStop(0, `rgba(${cR},${cG},${cB},0)`);
        trail.addColorStop(1, `rgba(${cR},${cG},${cB},0.18)`);
        ctx.fillStyle = trail;
        ctx.fillRect(0, Math.max(0, scanY - 80), w, Math.min(80, scanY + 4));
        ctx.fillStyle = `rgba(${cR},${cG},${cB},0.55)`;
        ctx.fillRect(0, scanY, w, 1);
        ctx.restore();
        if (scanY > h + 20) scanActive = false;
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      data-testid="aria-bg-fx"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        opacity: 0.85,
        mixBlendMode: "screen",
      }}
    />
  );
}
