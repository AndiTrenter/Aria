import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

/**
 * J.A.R.V.I.S.-style 3D cortex orb — refined with cinematic bloom and
 * mode-reactive color tinting.
 *
 * Props:
 *   intensity (0..1)   overall energy — drives motion + glow strength
 *   speaking  (bool)   adds shockwaves + brighter core
 *   listening (bool)   adds a receptive rim
 *   mode      (string) "idle"|"wakeword"|"listening"|"thinking"|"speaking"
 *                      controls the color palette (cyan / amber / etc.)
 *   size      (px)     square WebGL surface
 *
 * Implementation notes:
 *   - Round soft-edged particles via a generated CanvasTexture
 *   - Container has a radial mask so the canvas square is never visible
 *   - Postprocessing: subtle UnrealBloomPass for cinematic glow
 *   - All material colors lerp toward the active mode palette every frame
 *     so transitions feel smooth instead of snapping
 */

// ── Mode palettes ──────────────────────────────────────────────
//   particle = outer cloud cyan/tint
//   inner    = central white-blue mist
//   core     = emissive sphere
//   halo     = outer glow color
//   ring     = HUD ring lines
const MODE_PALETTES = {
  idle:     { particle: "#9be0ff", inner: "#ffffff", core: "#bdf2ff", halo: "#5cc8ff", ring: "#8ed8ff" },
  wakeword: { particle: "#86d8ff", inner: "#e6f6ff", core: "#bdf2ff", halo: "#5cc8ff", ring: "#8ed8ff" },
  listening:{ particle: "#5af0e5", inner: "#dafff7", core: "#9bffe8", halo: "#3ce4cf", ring: "#6cf2dc" },
  thinking: { particle: "#ffc66e", inner: "#fff2cf", core: "#ffd984", halo: "#ff9a3c", ring: "#ffb56a" },
  speaking: { particle: "#b8f2ff", inner: "#ffffff", core: "#dffaff", halo: "#5cc8ff", ring: "#a6e8ff" },
};

const lerpColor = (target, source, t) => {
  // target/source are THREE.Color, t in 0..1 — mutates target
  target.r += (source.r - target.r) * t;
  target.g += (source.g - target.g) * t;
  target.b += (source.b - target.b) * t;
};

export default function CortexCloud({
  intensity = 0.25,
  speaking = false,
  listening = false,
  mode = "idle",
  size = 560,
}) {
  const mountRef = useRef(null);
  const stateRef = useRef({ intensity, speaking, listening, mode });
  const rafRef = useRef(null);

  useEffect(() => {
    stateRef.current = { intensity, speaking, listening, mode };
  }, [intensity, speaking, listening, mode]);

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
    // Proper colour pipeline → eliminates the heavy gradient banding that
    // 8-bit RGB additive blending produces in dark areas.
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, 5.0);
    camera.lookAt(0, 0, 0);

    /* ─── Postprocessing: subtle bloom for cinematic glow ─────── */
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    composer.setSize(size, size);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    // strength, radius, threshold — kept gentle to avoid 8-bit banding
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size, size),
      0.55, // strength (was 0.85 — caused over-bright halos)
      0.5,  // radius
      0.25  // threshold (only mid+ bright pixels bloom → cleaner gradients)
    );
    composer.addPass(bloomPass);

    /* ─── Round particle sprite (built once) ────────────────────── */
    const makeCircleTexture = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d");
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0.0, "rgba(255,255,255,1)");
      grad.addColorStop(0.35, "rgba(255,255,255,0.55)");
      grad.addColorStop(0.7, "rgba(255,255,255,0.12)");
      grad.addColorStop(1.0, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };
    const sprite = makeCircleTexture();

    /* ─── Outer cloud ───────────────────────────────────────────── */
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
    cloud1Geom.setAttribute("position", new THREE.BufferAttribute(positions1.slice(), 3));
    const cloud1Mat = new THREE.PointsMaterial({
      map: sprite,
      color: new THREE.Color(MODE_PALETTES.idle.particle),
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

    /* ─── Inner cloud ───────────────────────────────────────────── */
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
    cloud2Geom.setAttribute("position", new THREE.BufferAttribute(positions2.slice(), 3));
    const cloud2Mat = new THREE.PointsMaterial({
      map: sprite,
      color: new THREE.Color(MODE_PALETTES.idle.inner),
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

    /* ─── Core + halos ──────────────────────────────────────────── */
    const coreGeom = new THREE.SphereGeometry(0.32, 64, 64);
    const coreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(MODE_PALETTES.idle.core),
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const core = new THREE.Mesh(coreGeom, coreMat);
    scene.add(core);

    const halo1Geom = new THREE.SphereGeometry(0.55, 48, 48);
    const halo1Mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(MODE_PALETTES.idle.halo),
      transparent: true, opacity: 0.14,
      blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
    });
    const halo1 = new THREE.Mesh(halo1Geom, halo1Mat);
    scene.add(halo1);

    const halo2Geom = new THREE.SphereGeometry(0.95, 48, 48);
    const halo2Mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#2a7fd0"),
      transparent: true, opacity: 0.04,
      blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
    });
    const halo2 = new THREE.Mesh(halo2Geom, halo2Mat);
    scene.add(halo2);

    /* ─── HUD rings ─────────────────────────────────────────────── */
    const makeRingLine = (radius, segments = 192) => {
      const pts = [];
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
      }
      return new THREE.BufferGeometry().setFromPoints(pts);
    };
    const ringMat1 = new THREE.LineBasicMaterial({
      color: new THREE.Color(MODE_PALETTES.idle.ring), transparent: true, opacity: 0.32,
    });
    const ringMat2 = new THREE.LineBasicMaterial({
      color: new THREE.Color(MODE_PALETTES.idle.ring), transparent: true, opacity: 0.18,
    });
    const ring1 = new THREE.Line(makeRingLine(1.06), ringMat1);
    const ring2 = new THREE.Line(makeRingLine(1.18), ringMat2);
    ring1.rotation.x = 1.05;
    ring2.rotation.x = -0.45;
    ring2.rotation.y = 0.35;
    scene.add(ring1, ring2);

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
      color: new THREE.Color(MODE_PALETTES.idle.ring), transparent: true, opacity: 0.30,
    });
    const ticks = new THREE.LineSegments(tickGeom, tickMat);
    ticks.rotation.x = 1.05;
    scene.add(ticks);

    const rimGeom = makeRingLine(1.0, 192);
    const rimMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(MODE_PALETTES.listening.ring), transparent: true, opacity: 0,
    });
    const rim = new THREE.Line(rimGeom, rimMat);
    rim.rotation.x = 1.05;
    scene.add(rim);

    /* ─── Lightning + shockwaves ───────────────────────────────── */
    const arcsGroup = new THREE.Group();
    scene.add(arcsGroup);
    const arcs = [];
    const shockGroup = new THREE.Group();
    scene.add(shockGroup);
    const shocks = [];

    /* ─── Color targets (lerped smoothly each frame) ───────────── */
    const tgt = {
      particle: new THREE.Color(),
      inner:    new THREE.Color(),
      core:     new THREE.Color(),
      halo:     new THREE.Color(),
      ring:     new THREE.Color(),
    };

    /* ─── Animation ─────────────────────────────────────────────── */
    const clock = new THREE.Clock();
    let totalTime = 0;
    let yaw = 0, pitch = 0;

    const animate = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      totalTime += dt;
      const s = stateRef.current;
      const I = Math.max(0, Math.min(1, s.intensity));
      const speedMul = 0.3 + I * 1.6;

      // Resolve mode palette and lerp colors smoothly
      const pal = MODE_PALETTES[s.mode] || MODE_PALETTES.idle;
      tgt.particle.set(pal.particle);
      tgt.inner.set(pal.inner);
      tgt.core.set(pal.core);
      tgt.halo.set(pal.halo);
      tgt.ring.set(pal.ring);
      const k = Math.min(1, dt * 4.5); // ~quarter second crossfade
      lerpColor(cloud1Mat.color, tgt.particle, k);
      lerpColor(cloud2Mat.color, tgt.inner, k);
      lerpColor(coreMat.color,   tgt.core, k);
      lerpColor(halo1Mat.color,  tgt.halo, k);
      lerpColor(ringMat1.color,  tgt.ring, k);
      lerpColor(ringMat2.color,  tgt.ring, k);
      lerpColor(tickMat.color,   tgt.ring, k);
      // Bloom strength rises during speaking/thinking for cinematic punch
      const targetBloom = s.speaking ? 0.85 : (s.mode === "thinking" ? 0.7 : 0.55);
      bloomPass.strength += (targetBloom - bloomPass.strength) * Math.min(1, dt * 3);

      // Cloud rotation
      yaw += dt * 0.18 * speedMul;
      pitch += dt * 0.07 * speedMul;
      cloud1.rotation.y = yaw;
      cloud1.rotation.x = pitch;
      cloud2.rotation.y = -yaw * 0.55;
      cloud2.rotation.x = pitch * 0.4;

      // Breathing
      cloud1.scale.setScalar(1 + Math.sin(totalTime * (1.2 + I * 1.0)) * (0.04 + I * 0.06));
      cloud2.scale.setScalar(1 + Math.sin(totalTime * (1.5 + I * 1.0) + 0.5) * (0.05 + I * 0.07));

      cloud1Mat.size = 0.075 + I * 0.05;
      cloud1Mat.opacity = 0.7 + I * 0.25;
      cloud2Mat.size = 0.062 + I * 0.05;
      cloud2Mat.opacity = 0.5 + I * 0.3;

      // Core pulse
      core.scale.setScalar(1 + Math.sin(totalTime * (0.9 + I * 1.4)) * (0.08 + I * 0.10));
      coreMat.opacity = 0.25 + I * 0.25 + (s.speaking ? 0.05 : 0);
      halo1Mat.opacity = 0.10 + I * 0.12 + (s.speaking ? 0.04 : 0);
      halo2Mat.opacity = 0.03 + I * 0.06 + (s.speaking ? 0.02 : 0);
      halo1.scale.setScalar(1 + Math.sin(totalTime * 1.1) * 0.04);
      halo2.scale.setScalar(1 + Math.sin(totalTime * 0.7) * 0.03);

      // Rings
      ring1.rotation.z += dt * 0.10 * speedMul;
      ring2.rotation.z -= dt * 0.06 * speedMul;
      ticks.rotation.z += dt * 0.05 * speedMul;
      ringMat1.opacity = 0.22 + I * 0.25;
      ringMat2.opacity = 0.12 + I * 0.18;
      tickMat.opacity = 0.20 + I * 0.20;

      // Listening rim — color follows listening palette
      rimMat.color.copy(new THREE.Color(MODE_PALETTES.listening.ring));
      if (s.listening) {
        rimMat.opacity = 0.40 + Math.sin(totalTime * 4.2) * 0.25;
        rim.rotation.z += dt * 0.4;
      } else {
        rimMat.opacity = Math.max(0, rimMat.opacity - dt * 1.2);
      }

      // Lightning arcs — color is now ring color so it follows the mode
      if (I > 0.5 && Math.random() < 0.012 + I * 0.05) {
        const a1 = Math.random() * Math.PI * 2;
        const spread = 0.3 + Math.random() * 0.7;
        const a2 = a1 + (Math.random() > 0.5 ? spread : -spread);
        const r = 0.95 + Math.random() * 0.06;
        const start = new THREE.Vector3(Math.cos(a1) * r, Math.sin(a1) * r, (Math.random() - 0.5) * 0.18);
        const end = new THREE.Vector3(Math.cos(a2) * r, Math.sin(a2) * r, (Math.random() - 0.5) * 0.18);
        const segs = 4;
        const pts = [start];
        for (let kk = 1; kk < segs; kk++) {
          const f = kk / segs;
          const mid = start.clone().lerp(end, f);
          mid.x += (Math.random() - 0.5) * 0.10;
          mid.y += (Math.random() - 0.5) * 0.10;
          mid.z += (Math.random() - 0.5) * 0.10;
          pts.push(mid);
        }
        pts.push(end);
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        const m = new THREE.LineBasicMaterial({
          color: tgt.ring.clone(), transparent: true, opacity: 0.7,
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

      // Shockwaves (speaking)
      if (s.speaking && Math.random() < 0.04 + I * 0.10) {
        const sg = makeRingLine(0.95, 96);
        const sm = new THREE.LineBasicMaterial({
          color: tgt.ring.clone(), transparent: true, opacity: 0.5,
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

      // Camera drift
      camera.position.x = Math.sin(totalTime * 0.18) * 0.04;
      camera.position.y = Math.cos(totalTime * 0.15) * 0.03;
      camera.lookAt(0, 0, 0);

      composer.render();
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
      sprite.dispose();
      arcs.forEach((a) => { a.geom.dispose(); a.mat.dispose(); });
      shocks.forEach((s) => { s.geom.dispose(); s.mat.dispose(); });
      composer.dispose?.();
      renderer.dispose();
      try { mount.removeChild(renderer.domElement); } catch {}
    };
  }, [size]);

  return (
    <div
      style={{
        width: size,
        height: size,
        display: "block",
        position: "relative",
      }}
    >
      <div
        ref={mountRef}
        data-testid="cortex-cloud-3d"
        style={{
          width: size,
          height: size,
          display: "block",
          position: "relative",
          // Softer radial fade — the previous version had a hard 38% inner
          // edge that combined with bloom produced visible color bands.
          WebkitMaskImage:
            "radial-gradient(circle at 50% 50%, black 30%, rgba(0,0,0,0.92) 50%, rgba(0,0,0,0.55) 68%, rgba(0,0,0,0) 86%)",
          maskImage:
            "radial-gradient(circle at 50% 50%, black 30%, rgba(0,0,0,0.92) 50%, rgba(0,0,0,0.55) 68%, rgba(0,0,0,0) 86%)",
        }}
      />
      {/* Dithering noise overlay — breaks up 8-bit gradient banding. SVG
          fractalNoise is subpixel-stable and costs nothing per frame. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          mixBlendMode: "overlay",
          opacity: 0.07,
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 1   0 0 0 0 1   0 0 0 0 1   0 0 0 0.5 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
          backgroundSize: "160px 160px",
        }}
      />
    </div>
  );
}
