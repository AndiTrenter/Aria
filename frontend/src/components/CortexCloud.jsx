import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * J.A.R.V.I.S.-style animated 3D cortex cloud — Three.js / WebGL.
 *
 * Props (drop-in compatible with the previous 2D canvas version):
 *   intensity (0..1)   overall animation energy
 *   speaking  (bool)   adds shockwave rings + brighter core pulse
 *   listening (bool)   adds receptive blue rim pulse
 *   size      (px)     square WebGL canvas dimensions
 *
 * Architecture:
 *   - PointCloud1: ~1800 particles on a unit sphere (cyan)
 *   - PointCloud2: ~1200 particles on a 0.7-radius inner sphere (white-blue)
 *   - Inner core: emissive sphere with custom shader-like gradient
 *   - 3 nested rings (outer / mid / counter-rotating) + tick mesh
 *   - Lightning arcs spawned dynamically on high intensity / speaking
 *   - Shockwave rings during speaking
 *
 * The whole scene is wrapped in a <canvas> matching the requested size.
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

    /* ─── Scene + camera + renderer ─────────────────────────────── */
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
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 4.6);
    camera.lookAt(0, 0, 0);

    /* ─── Outer particle cloud (cyan, breathing) ─────────────────── */
    const N1 = 1800;
    const cloud1Geom = new THREE.BufferGeometry();
    const positions1 = new Float32Array(N1 * 3);
    const sizes1 = new Float32Array(N1);
    const speeds1 = new Float32Array(N1);
    for (let i = 0; i < N1; i++) {
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      positions1[i * 3 + 0] = r * Math.cos(phi);
      positions1[i * 3 + 1] = u;
      positions1[i * 3 + 2] = r * Math.sin(phi);
      sizes1[i] = 0.018 + Math.random() * 0.04;
      speeds1[i] = 0.4 + Math.random() * 1.5;
    }
    cloud1Geom.setAttribute("position", new THREE.BufferAttribute(positions1, 3));

    const cloud1Mat = new THREE.PointsMaterial({
      color: new THREE.Color("#7be9ff"),
      size: 0.045,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const cloud1 = new THREE.Points(cloud1Geom, cloud1Mat);
    scene.add(cloud1);

    /* ─── Inner particle cloud (denser, brighter) ────────────────── */
    const N2 = 1200;
    const cloud2Geom = new THREE.BufferGeometry();
    const positions2 = new Float32Array(N2 * 3);
    const speeds2 = new Float32Array(N2);
    for (let i = 0; i < N2; i++) {
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u) * 0.72;
      positions2[i * 3 + 0] = r * Math.cos(phi);
      positions2[i * 3 + 1] = u * 0.72;
      positions2[i * 3 + 2] = r * Math.sin(phi);
      speeds2[i] = 0.5 + Math.random() * 1.6;
    }
    cloud2Geom.setAttribute("position", new THREE.BufferAttribute(positions2, 3));
    const cloud2Mat = new THREE.PointsMaterial({
      color: new THREE.Color("#dff7ff"),
      size: 0.038,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const cloud2 = new THREE.Points(cloud2Geom, cloud2Mat);
    scene.add(cloud2);

    // Keep originals to drive breathing
    const baseRad1 = new Float32Array(N1);
    for (let i = 0; i < N1; i++) {
      const x = positions1[i * 3], y = positions1[i * 3 + 1], z = positions1[i * 3 + 2];
      baseRad1[i] = Math.sqrt(x * x + y * y + z * z);
    }
    const baseRad2 = new Float32Array(N2);
    for (let i = 0; i < N2; i++) {
      const x = positions2[i * 3], y = positions2[i * 3 + 1], z = positions2[i * 3 + 2];
      baseRad2[i] = Math.sqrt(x * x + y * y + z * z);
    }

    /* ─── Core sphere (emissive glow) ────────────────────────────── */
    const coreGeom = new THREE.SphereGeometry(0.4, 64, 64);
    const coreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#9bf0ff"),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const core = new THREE.Mesh(coreGeom, coreMat);
    scene.add(core);

    // Soft outer halo
    const haloGeom = new THREE.SphereGeometry(1.05, 48, 48);
    const haloMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#3aa8ff"),
      transparent: true,
      opacity: 0.10,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(haloGeom, haloMat);
    scene.add(halo);

    /* ─── HUD rings ──────────────────────────────────────────────── */
    const ringMat1 = new THREE.LineBasicMaterial({ color: 0x7bd8ff, transparent: true, opacity: 0.55 });
    const ringMat2 = new THREE.LineBasicMaterial({ color: 0x6bc8ff, transparent: true, opacity: 0.35 });
    const ringMat3 = new THREE.LineBasicMaterial({ color: 0x9beaff, transparent: true, opacity: 0.65 });

    const makeRingLine = (radius, segments = 256) => {
      const pts = [];
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
      }
      return new THREE.BufferGeometry().setFromPoints(pts);
    };

    const ring1 = new THREE.Line(makeRingLine(1.18), ringMat1);
    const ring2 = new THREE.Line(makeRingLine(1.32), ringMat2);
    const ring3 = new THREE.Line(makeRingLine(1.05), ringMat3);
    ring1.rotation.x = 1.0;
    ring2.rotation.x = -0.6;
    ring2.rotation.y = 0.4;
    ring3.rotation.x = 0.3;
    scene.add(ring1, ring2, ring3);

    // Tick marks
    const tickGeom = new THREE.BufferGeometry();
    const tickPos = [];
    const TICKS = 36;
    for (let i = 0; i < TICKS; i++) {
      const a = (i / TICKS) * Math.PI * 2;
      const r1 = 1.22, r2 = i % 3 === 0 ? 1.32 : 1.27;
      tickPos.push(Math.cos(a) * r1, Math.sin(a) * r1, 0);
      tickPos.push(Math.cos(a) * r2, Math.sin(a) * r2, 0);
    }
    tickGeom.setAttribute("position", new THREE.Float32BufferAttribute(tickPos, 3));
    const tickMat = new THREE.LineBasicMaterial({ color: 0x9beaff, transparent: true, opacity: 0.55 });
    const ticks = new THREE.LineSegments(tickGeom, tickMat);
    ticks.rotation.x = 1.05;
    scene.add(ticks);

    /* ─── Listening rim (pulsing band) ───────────────────────────── */
    const rimGeom = makeRingLine(1.08, 256);
    const rimMat = new THREE.LineBasicMaterial({ color: 0x9beaff, transparent: true, opacity: 0 });
    const rim = new THREE.Line(rimGeom, rimMat);
    rim.rotation.x = 1.05;
    scene.add(rim);

    /* ─── Lightning arcs container ───────────────────────────────── */
    const arcsGroup = new THREE.Group();
    scene.add(arcsGroup);
    const arcs = []; // {line, life}

    /* ─── Shockwave rings (only while speaking) ──────────────────── */
    const shockGroup = new THREE.Group();
    scene.add(shockGroup);
    const shocks = []; // {mesh, life, scale}

    /* ─── Animation loop ─────────────────────────────────────────── */
    const clock = new THREE.Clock();
    let totalTime = 0;
    let yaw = 0, pitch = 0;

    const animate = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      totalTime += dt;
      const s = stateRef.current;
      const I = Math.max(0, Math.min(1, s.intensity));
      const speedMul = 0.35 + I * 3.0;

      // Rotate clouds
      yaw += dt * 0.35 * speedMul;
      pitch += dt * 0.18 * speedMul;
      cloud1.rotation.y = yaw;
      cloud1.rotation.x = pitch;
      cloud2.rotation.y = -yaw * 0.7;
      cloud2.rotation.x = pitch * 0.6;

      // Breathing — push particles in/out along their original radius
      const pulse1 = 1 + Math.sin(totalTime * (1.6 + I * 1.5)) * (0.06 + I * 0.12);
      const arr1 = cloud1.geometry.attributes.position.array;
      for (let i = 0; i < N1; i++) {
        const idx = i * 3;
        const x0 = positions1[idx], y0 = positions1[idx + 1], z0 = positions1[idx + 2];
        const k = pulse1 * (1 + Math.sin(totalTime * speeds1[i] + i) * 0.03);
        arr1[idx] = x0 * k;
        arr1[idx + 1] = y0 * k;
        arr1[idx + 2] = z0 * k;
      }
      cloud1.geometry.attributes.position.needsUpdate = true;

      const pulse2 = 1 + Math.sin(totalTime * (2.1 + I * 1.7) + 0.6) * (0.08 + I * 0.13);
      const arr2 = cloud2.geometry.attributes.position.array;
      for (let i = 0; i < N2; i++) {
        const idx = i * 3;
        const x0 = positions2[idx], y0 = positions2[idx + 1], z0 = positions2[idx + 2];
        const k = pulse2 * (1 + Math.sin(totalTime * speeds2[i] * 1.1 + i * 0.3) * 0.04);
        arr2[idx] = x0 * k;
        arr2[idx + 1] = y0 * k;
        arr2[idx + 2] = z0 * k;
      }
      cloud2.geometry.attributes.position.needsUpdate = true;

      // Material reactivity
      cloud1Mat.size = 0.04 + I * 0.07;
      cloud1Mat.opacity = 0.7 + I * 0.3;
      cloud2Mat.size = 0.034 + I * 0.06;
      cloud2Mat.opacity = 0.55 + I * 0.35;

      // Core pulse
      const corePulse = 1 + Math.sin(totalTime * (1.2 + I * 2.5)) * (0.12 + I * 0.18);
      core.scale.setScalar(corePulse);
      coreMat.opacity = 0.4 + I * 0.45 + (s.speaking ? 0.1 : 0);
      haloMat.opacity = 0.08 + I * 0.18 + (s.speaking ? 0.06 : 0);

      // Rings spin
      ring1.rotation.z += dt * 0.25 * speedMul;
      ring2.rotation.z -= dt * 0.18 * speedMul;
      ring3.rotation.y += dt * 0.4 * speedMul;
      ticks.rotation.z += dt * 0.12 * speedMul;
      ringMat1.opacity = 0.35 + I * 0.4;
      ringMat2.opacity = 0.25 + I * 0.3;

      // Listening rim
      if (s.listening) {
        rimMat.opacity = 0.45 + Math.sin(totalTime * 5) * 0.3;
        rim.rotation.z += dt * 0.6;
      } else {
        rimMat.opacity = Math.max(0, rimMat.opacity - dt * 1.2);
      }

      /* ── Spawn lightning arcs ────────────────────────────────── */
      if (I > 0.35 && Math.random() < 0.04 + I * 0.12) {
        const a1 = Math.random() * Math.PI * 2;
        const spread = 0.4 + Math.random() * 1.0;
        const a2 = a1 + (Math.random() > 0.5 ? spread : -spread);
        const r = 1.0 + Math.random() * 0.08;
        const start = new THREE.Vector3(Math.cos(a1) * r, Math.sin(a1) * r, (Math.random() - 0.5) * 0.3);
        const end = new THREE.Vector3(Math.cos(a2) * r, Math.sin(a2) * r, (Math.random() - 0.5) * 0.3);
        const segs = 5;
        const pts = [start];
        for (let k = 1; k < segs; k++) {
          const f = k / segs;
          const mid = start.clone().lerp(end, f);
          mid.x += (Math.random() - 0.5) * 0.18;
          mid.y += (Math.random() - 0.5) * 0.18;
          mid.z += (Math.random() - 0.5) * 0.18;
          pts.push(mid);
        }
        pts.push(end);
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        const m = new THREE.LineBasicMaterial({
          color: 0xb6f3ff,
          transparent: true,
          opacity: 1.0,
          linewidth: 2,
        });
        const line = new THREE.Line(g, m);
        arcsGroup.add(line);
        arcs.push({ line, mat: m, life: 1 });
      }
      for (let i = arcs.length - 1; i >= 0; i--) {
        const a = arcs[i];
        a.life -= dt * (3 + I * 2);
        a.mat.opacity = Math.max(0, a.life);
        if (a.life <= 0) {
          arcsGroup.remove(a.line);
          a.line.geometry.dispose();
          a.mat.dispose();
          arcs.splice(i, 1);
        }
      }

      /* ── Shockwave rings (speaking) ──────────────────────────── */
      if (s.speaking && Math.random() < 0.08 + I * 0.15) {
        const sg = makeRingLine(1.0, 128);
        const sm = new THREE.LineBasicMaterial({
          color: 0x9beaff,
          transparent: true,
          opacity: 0.7,
        });
        const sl = new THREE.Line(sg, sm);
        sl.rotation.x = 1.05;
        shockGroup.add(sl);
        shocks.push({ mesh: sl, mat: sm, geom: sg, scale: 1, life: 1 });
      }
      for (let i = shocks.length - 1; i >= 0; i--) {
        const sh = shocks[i];
        sh.scale += dt * (1.2 + I * 1.0);
        sh.life -= dt * 0.7;
        sh.mesh.scale.setScalar(sh.scale);
        sh.mat.opacity = Math.max(0, sh.life * 0.7);
        if (sh.life <= 0 || sh.scale > 2.0) {
          shockGroup.remove(sh.mesh);
          sh.geom.dispose();
          sh.mat.dispose();
          shocks.splice(i, 1);
        }
      }

      // Subtle camera bob
      camera.position.x = Math.sin(totalTime * 0.25) * 0.05;
      camera.position.y = Math.cos(totalTime * 0.22) * 0.04;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      // dispose
      cloud1Geom.dispose(); cloud1Mat.dispose();
      cloud2Geom.dispose(); cloud2Mat.dispose();
      coreGeom.dispose(); coreMat.dispose();
      haloGeom.dispose(); haloMat.dispose();
      ring1.geometry.dispose(); ringMat1.dispose();
      ring2.geometry.dispose(); ringMat2.dispose();
      ring3.geometry.dispose(); ringMat3.dispose();
      tickGeom.dispose(); tickMat.dispose();
      rimGeom.dispose(); rimMat.dispose();
      arcs.forEach((a) => { a.line.geometry.dispose(); a.mat.dispose(); });
      shocks.forEach((s) => { s.geom.dispose(); s.mat.dispose(); });
      renderer.dispose();
      try { mount.removeChild(renderer.domElement); } catch {}
    };
  }, [size]);

  return (
    <div
      ref={mountRef}
      style={{
        width: size,
        height: size,
        display: "block",
        position: "relative",
      }}
      data-testid="cortex-cloud-3d"
    />
  );
}
