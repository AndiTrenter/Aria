import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * J.A.R.V.I.S.-style 3D cortex orb — refined, soft, less "blocky".
 *
 * Design goals:
 *   - Round, glowing particles (NO default square Points).
 *   - Container fades radially to transparent → no visible canvas square.
 *   - Calmer breathing + rotation, fewer stray particles.
 *   - Layered halo + subtle inner core for depth.
 *
 * Props (drop-in compatible):
 *   intensity (0..1), speaking (bool), listening (bool), size (px)
 */
export default function CortexCloud({
  intensity = 0.25,
  speaking = false,
  listening = false,
  size = 560,
}) {
  const mountRef = useRef(null);
  const stateRef = useRef({ intensity, speaking, listening });
  const rafRef = useRef(null);

  useEffect(() => {
    stateRef.current = { intensity, speaking, listening };
  }, [intensity, speaking, listening]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    /* ─── Renderer ──────────────────────────────────────────────── */
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(size, size, false);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, 5.0);
    camera.lookAt(0, 0, 0);

    /* ─── Round soft-edged particle sprite (built once via canvas) ─ */
    const makeCircleTexture = (color = "rgba(180,235,255,") => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d");
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0.0, color + "1)");
      grad.addColorStop(0.35, color + "0.55)");
      grad.addColorStop(0.7, color + "0.12)");
      grad.addColorStop(1.0, color + "0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };
    const sprite1 = makeCircleTexture("rgba(160,225,255,");
    const sprite2 = makeCircleTexture("rgba(220,245,255,");

    /* ─── Outer cloud (sparser, soft cyan) ──────────────────────── */
    const N1 = 700;
    const cloud1Geom = new THREE.BufferGeometry();
    const positions1 = new Float32Array(N1 * 3);
    const speeds1 = new Float32Array(N1);
    for (let i = 0; i < N1; i++) {
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u) * 0.95;
      positions1[i * 3 + 0] = r * Math.cos(phi);
      positions1[i * 3 + 1] = u * 0.95;
      positions1[i * 3 + 2] = r * Math.sin(phi);
      speeds1[i] = 0.35 + Math.random() * 1.0;
    }
    cloud1Geom.setAttribute(
      "position",
      new THREE.BufferAttribute(positions1.slice(), 3)
    );
    const cloud1Mat = new THREE.PointsMaterial({
      map: sprite1,
      color: new THREE.Color("#9be0ff"),
      size: 0.085,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      alphaTest: 0.001,
    });
    const cloud1 = new THREE.Points(cloud1Geom, cloud1Mat);
    scene.add(cloud1);

    /* ─── Inner cloud (denser core mist, white-blue) ────────────── */
    const N2 = 400;
    const cloud2Geom = new THREE.BufferGeometry();
    const positions2 = new Float32Array(N2 * 3);
    const speeds2 = new Float32Array(N2);
    for (let i = 0; i < N2; i++) {
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u) * 0.62;
      positions2[i * 3 + 0] = r * Math.cos(phi);
      positions2[i * 3 + 1] = u * 0.62;
      positions2[i * 3 + 2] = r * Math.sin(phi);
      speeds2[i] = 0.45 + Math.random() * 1.4;
    }
    cloud2Geom.setAttribute(
      "position",
      new THREE.BufferAttribute(positions2.slice(), 3)
    );
    const cloud2Mat = new THREE.PointsMaterial({
      map: sprite2,
      color: new THREE.Color("#ffffff"),
      size: 0.07,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      alphaTest: 0.001,
    });
    const cloud2 = new THREE.Points(cloud2Geom, cloud2Mat);
    scene.add(cloud2);

    /* ─── Inner emissive core ───────────────────────────────────── */
    const coreGeom = new THREE.SphereGeometry(0.32, 64, 64);
    const coreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#bdf2ff"),
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const core = new THREE.Mesh(coreGeom, coreMat);
    scene.add(core);

    // Layered halos for soft bloom feel
    const halo1Geom = new THREE.SphereGeometry(0.55, 48, 48);
    const halo1Mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#5cc8ff"),
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const halo1 = new THREE.Mesh(halo1Geom, halo1Mat);
    scene.add(halo1);

    const halo2Geom = new THREE.SphereGeometry(0.95, 48, 48);
    const halo2Mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#2a7fd0"),
      transparent: true,
      opacity: 0.07,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const halo2 = new THREE.Mesh(halo2Geom, halo2Mat);
    scene.add(halo2);

    /* ─── HUD rings — very faint, just enough for the JARVIS feel ─ */
    const makeRingLine = (radius, segments = 192) => {
      const pts = [];
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
      }
      return new THREE.BufferGeometry().setFromPoints(pts);
    };

    const ringMat1 = new THREE.LineBasicMaterial({
      color: 0x8ed8ff, transparent: true, opacity: 0.32,
    });
    const ringMat2 = new THREE.LineBasicMaterial({
      color: 0x6bb8ff, transparent: true, opacity: 0.18,
    });
    const ring1 = new THREE.Line(makeRingLine(1.06), ringMat1);
    const ring2 = new THREE.Line(makeRingLine(1.18), ringMat2);
    ring1.rotation.x = 1.05;
    ring2.rotation.x = -0.45;
    ring2.rotation.y = 0.35;
    scene.add(ring1, ring2);

    // Small tick marks ring (subtle)
    const tickGeom = new THREE.BufferGeometry();
    const tickPos = [];
    const TICKS = 24;
    for (let i = 0; i < TICKS; i++) {
      const a = (i / TICKS) * Math.PI * 2;
      const r1 = 1.10, r2 = i % 4 === 0 ? 1.16 : 1.13;
      tickPos.push(Math.cos(a) * r1, Math.sin(a) * r1, 0);
      tickPos.push(Math.cos(a) * r2, Math.sin(a) * r2, 0);
    }
    tickGeom.setAttribute("position", new THREE.Float32BufferAttribute(tickPos, 3));
    const tickMat = new THREE.LineBasicMaterial({
      color: 0x9beaff, transparent: true, opacity: 0.30,
    });
    const ticks = new THREE.LineSegments(tickGeom, tickMat);
    ticks.rotation.x = 1.05;
    scene.add(ticks);

    /* ─── Listening rim ─────────────────────────────────────────── */
    const rimGeom = makeRingLine(1.0, 192);
    const rimMat = new THREE.LineBasicMaterial({
      color: 0x9beaff, transparent: true, opacity: 0,
    });
    const rim = new THREE.Line(rimGeom, rimMat);
    rim.rotation.x = 1.05;
    scene.add(rim);

    /* ─── Lightning arcs (RARE, gentle) ─────────────────────────── */
    const arcsGroup = new THREE.Group();
    scene.add(arcsGroup);
    const arcs = [];

    /* ─── Shockwaves (speaking) ─────────────────────────────────── */
    const shockGroup = new THREE.Group();
    scene.add(shockGroup);
    const shocks = [];

    /* ─── Animation loop ────────────────────────────────────────── */
    const clock = new THREE.Clock();
    let totalTime = 0;
    let yaw = 0, pitch = 0;

    const animate = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      totalTime += dt;
      const s = stateRef.current;
      const I = Math.max(0, Math.min(1, s.intensity));
      const speedMul = 0.3 + I * 1.6;

      // Rotate clouds (gentle)
      yaw += dt * 0.18 * speedMul;
      pitch += dt * 0.07 * speedMul;
      cloud1.rotation.y = yaw;
      cloud1.rotation.x = pitch;
      cloud2.rotation.y = -yaw * 0.55;
      cloud2.rotation.x = pitch * 0.4;

      // Subtle breathing — small radial scale pulse only (no per-particle jitter
      // → less "wild" feeling, particles stay on coherent shells)
      const breath1 = 1 + Math.sin(totalTime * (1.2 + I * 1.0)) * (0.04 + I * 0.06);
      cloud1.scale.setScalar(breath1);
      const breath2 = 1 + Math.sin(totalTime * (1.5 + I * 1.0) + 0.5) * (0.05 + I * 0.07);
      cloud2.scale.setScalar(breath2);

      // Material reactivity (gentle)
      cloud1Mat.size = 0.075 + I * 0.05;
      cloud1Mat.opacity = 0.7 + I * 0.25;
      cloud2Mat.size = 0.062 + I * 0.05;
      cloud2Mat.opacity = 0.5 + I * 0.3;

      // Core pulse (smoother)
      const corePulse = 1 + Math.sin(totalTime * (0.9 + I * 1.4)) * (0.08 + I * 0.10);
      core.scale.setScalar(corePulse);
      coreMat.opacity = 0.35 + I * 0.35 + (s.speaking ? 0.08 : 0);
      halo1Mat.opacity = 0.16 + I * 0.18 + (s.speaking ? 0.06 : 0);
      halo2Mat.opacity = 0.05 + I * 0.10 + (s.speaking ? 0.04 : 0);
      // Halo follows core breathing slightly
      halo1.scale.setScalar(1 + Math.sin(totalTime * 1.1) * 0.04);
      halo2.scale.setScalar(1 + Math.sin(totalTime * 0.7) * 0.03);

      // Rings spin (slow)
      ring1.rotation.z += dt * 0.10 * speedMul;
      ring2.rotation.z -= dt * 0.06 * speedMul;
      ticks.rotation.z += dt * 0.05 * speedMul;
      ringMat1.opacity = 0.22 + I * 0.25;
      ringMat2.opacity = 0.12 + I * 0.18;
      tickMat.opacity = 0.20 + I * 0.20;

      // Listening rim
      if (s.listening) {
        rimMat.opacity = 0.35 + Math.sin(totalTime * 4.2) * 0.22;
        rim.rotation.z += dt * 0.4;
      } else {
        rimMat.opacity = Math.max(0, rimMat.opacity - dt * 1.2);
      }

      /* ── Lightning arcs (rarer, softer) ───────────────────────── */
      if (I > 0.5 && Math.random() < 0.012 + I * 0.05) {
        const a1 = Math.random() * Math.PI * 2;
        const spread = 0.3 + Math.random() * 0.7;
        const a2 = a1 + (Math.random() > 0.5 ? spread : -spread);
        const r = 0.95 + Math.random() * 0.06;
        const start = new THREE.Vector3(Math.cos(a1) * r, Math.sin(a1) * r, (Math.random() - 0.5) * 0.18);
        const end = new THREE.Vector3(Math.cos(a2) * r, Math.sin(a2) * r, (Math.random() - 0.5) * 0.18);
        const segs = 4;
        const pts = [start];
        for (let k = 1; k < segs; k++) {
          const f = k / segs;
          const mid = start.clone().lerp(end, f);
          mid.x += (Math.random() - 0.5) * 0.10;
          mid.y += (Math.random() - 0.5) * 0.10;
          mid.z += (Math.random() - 0.5) * 0.10;
          pts.push(mid);
        }
        pts.push(end);
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        const m = new THREE.LineBasicMaterial({
          color: 0xc9f2ff, transparent: true, opacity: 0.7,
        });
        const line = new THREE.Line(g, m);
        arcsGroup.add(line);
        arcs.push({ line, mat: m, geom: g, life: 1 });
      }
      for (let i = arcs.length - 1; i >= 0; i--) {
        const a = arcs[i];
        a.life -= dt * 2.4;
        a.mat.opacity = Math.max(0, a.life * 0.7);
        if (a.life <= 0) {
          arcsGroup.remove(a.line);
          a.geom.dispose();
          a.mat.dispose();
          arcs.splice(i, 1);
        }
      }

      /* ── Shockwaves (speaking) ────────────────────────────────── */
      if (s.speaking && Math.random() < 0.04 + I * 0.10) {
        const sg = makeRingLine(0.95, 96);
        const sm = new THREE.LineBasicMaterial({
          color: 0x9beaff, transparent: true, opacity: 0.5,
        });
        const sl = new THREE.Line(sg, sm);
        sl.rotation.x = 1.05;
        shockGroup.add(sl);
        shocks.push({ mesh: sl, mat: sm, geom: sg, scale: 1, life: 1 });
      }
      for (let i = shocks.length - 1; i >= 0; i--) {
        const sh = shocks[i];
        sh.scale += dt * 0.9;
        sh.life -= dt * 0.6;
        sh.mesh.scale.setScalar(sh.scale);
        sh.mat.opacity = Math.max(0, sh.life * 0.5);
        if (sh.life <= 0 || sh.scale > 1.7) {
          shockGroup.remove(sh.mesh);
          sh.geom.dispose();
          sh.mat.dispose();
          shocks.splice(i, 1);
        }
      }

      // Subtle camera drift
      camera.position.x = Math.sin(totalTime * 0.18) * 0.04;
      camera.position.y = Math.cos(totalTime * 0.15) * 0.03;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      cloud1Geom.dispose(); cloud1Mat.dispose();
      cloud2Geom.dispose(); cloud2Mat.dispose();
      coreGeom.dispose(); coreMat.dispose();
      halo1Geom.dispose(); halo1Mat.dispose();
      halo2Geom.dispose(); halo2Mat.dispose();
      ring1.geometry.dispose(); ringMat1.dispose();
      ring2.geometry.dispose(); ringMat2.dispose();
      tickGeom.dispose(); tickMat.dispose();
      rimGeom.dispose(); rimMat.dispose();
      sprite1.dispose(); sprite2.dispose();
      arcs.forEach((a) => { a.geom.dispose(); a.mat.dispose(); });
      shocks.forEach((s) => { s.geom.dispose(); s.mat.dispose(); });
      renderer.dispose();
      try { mount.removeChild(renderer.domElement); } catch {}
    };
  }, [size]);

  // Container with a radial mask → particles fade to transparent at the
  // canvas edge → no more visible square boundary.
  return (
    <div
      ref={mountRef}
      data-testid="cortex-cloud-3d"
      style={{
        width: size,
        height: size,
        display: "block",
        position: "relative",
        WebkitMaskImage:
          "radial-gradient(circle at 50% 50%, black 38%, rgba(0,0,0,0.85) 55%, rgba(0,0,0,0) 78%)",
        maskImage:
          "radial-gradient(circle at 50% 50%, black 38%, rgba(0,0,0,0.85) 55%, rgba(0,0,0,0) 78%)",
      }}
    />
  );
}
