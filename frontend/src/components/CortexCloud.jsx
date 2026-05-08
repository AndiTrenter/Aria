import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * J.A.R.V.I.S./Ultron-style holographic neural core.
 *
 * Visual design (completely different from the previous particle-cloud):
 *   - Three nested rotating wireframe icosahedra (outer/middle/inner)
 *     glowing additively at the edges → looks like "alien tech".
 *   - Bright vertex nodes at each icosahedron vertex.
 *   - "Data packets" — tiny bright dots that travel along random edges
 *     and fade out, suggesting flowing thought/signals through the mesh.
 *   - A pulsing central core sphere (heart of the AI).
 *   - Distant ambient star-field for depth (very subtle).
 *   - Random inter-vertex lightning arcs.
 *   - A bright HUD ring orbiting the core for the "JARVIS hud" feel.
 *
 * Why this fixes the "eclipse" / canvas-rectangle artifacts:
 *   - No BackSide additive spheres (those caused half-shadow rendering
 *     artifacts when the GPU sorted overlapping transparent backsides).
 *   - All elements are line-segments / points / a single front-side
 *     core — no overlap depth issues.
 *
 * Props (drop-in):
 *   intensity (0..1), speaking (bool), listening (bool),
 *   mode ("idle"|"wakeword"|"listening"|"thinking"|"speaking"), size (px)
 */

const MODE_PALETTES = {
  idle:     { primary: 0x5cc8ff, secondary: 0x9be0ff, accent: 0xbdf2ff, hot: 0xffffff },
  wakeword: { primary: 0x3aa6ff, secondary: 0x7accff, accent: 0xa0e8ff, hot: 0xffffff },
  listening:{ primary: 0x0fd6b0, secondary: 0x2effd0, accent: 0x7fffd8, hot: 0xffffff },
  thinking: { primary: 0xff7a14, secondary: 0xff9a2a, accent: 0xffd17a, hot: 0xfff4d0 },
  speaking: { primary: 0x3acfff, secondary: 0xa0f6ff, accent: 0xdcffff, hot: 0xffffff },
};

const lerpColor = (target, source, t) => {
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
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, 5.5);
    camera.lookAt(0, 0, 0);

    /* ─── Round dot sprite (for vertices and data packets) ───────── */
    const makeDotTexture = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d");
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0.0, "rgba(255,255,255,1)");
      grad.addColorStop(0.4, "rgba(255,255,255,0.7)");
      grad.addColorStop(0.75, "rgba(255,255,255,0.15)");
      grad.addColorStop(1.0, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };
    const dotTex = makeDotTexture();

    /* ─── Helpers to build glowing wireframes ───────────────────── */
    const buildWireframe = (radius, detail, color, opacity) => {
      const baseGeom = new THREE.IcosahedronGeometry(radius, detail);
      const edges = new THREE.EdgesGeometry(baseGeom);
      const mat = new THREE.LineBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      });
      const line = new THREE.LineSegments(edges, mat);
      // Extract unique vertex positions for nodes + data packets
      const posAttr = baseGeom.getAttribute("position");
      const seen = new Set();
      const verts = [];
      for (let i = 0; i < posAttr.count; i++) {
        const x = +posAttr.getX(i).toFixed(4);
        const y = +posAttr.getY(i).toFixed(4);
        const z = +posAttr.getZ(i).toFixed(4);
        const k = `${x},${y},${z}`;
        if (!seen.has(k)) {
          seen.add(k);
          verts.push(new THREE.Vector3(x, y, z));
        }
      }
      // Build edge index list (pairs of vertex indices) for arcs/packets
      const edgePosAttr = edges.getAttribute("position");
      const edgePairs = [];
      const findVert = (v) => {
        for (let i = 0; i < verts.length; i++) {
          if (verts[i].distanceToSquared(v) < 1e-4) return i;
        }
        return -1;
      };
      for (let i = 0; i < edgePosAttr.count; i += 2) {
        const a = new THREE.Vector3().fromBufferAttribute(edgePosAttr, i);
        const b = new THREE.Vector3().fromBufferAttribute(edgePosAttr, i + 1);
        const ai = findVert(a);
        const bi = findVert(b);
        if (ai >= 0 && bi >= 0) edgePairs.push([ai, bi]);
      }
      baseGeom.dispose();
      return { line, edges, mat, verts, edgePairs };
    };

    const buildVertexNodes = (verts, color, sizeVal) => {
      const arr = new Float32Array(verts.length * 3);
      verts.forEach((v, i) => { arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z; });
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      const m = new THREE.PointsMaterial({
        map: dotTex,
        color: new THREE.Color(color),
        size: sizeVal,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
        alphaTest: 0.01,
      });
      return new THREE.Points(g, m);
    };

    /* ─── Build three nested wireframes ─────────────────────────── */
    const pal = MODE_PALETTES.idle;
    const outer  = buildWireframe(1.50, 1, pal.primary,   0.55);
    const middle = buildWireframe(1.05, 1, pal.secondary, 0.75);
    const inner  = buildWireframe(0.62, 0, pal.accent,    0.95);
    scene.add(outer.line, middle.line, inner.line);

    const outerNodes  = buildVertexNodes(outer.verts,  pal.secondary, 0.10);
    const middleNodes = buildVertexNodes(middle.verts, pal.accent,    0.13);
    const innerNodes  = buildVertexNodes(inner.verts,  pal.hot,       0.16);
    scene.add(outerNodes, middleNodes, innerNodes);

    // Outer-wrap of nodes is animated with the wireframe via parent group
    const outerGroup  = new THREE.Group();  outerGroup.add(outer.line, outerNodes);
    const middleGroup = new THREE.Group(); middleGroup.add(middle.line, middleNodes);
    const innerGroup  = new THREE.Group();  innerGroup.add(inner.line, innerNodes);
    scene.add(outerGroup, middleGroup, innerGroup);

    /* ─── Pulsing core ──────────────────────────────────────────── */
    const coreGeom = new THREE.SphereGeometry(0.16, 32, 32);
    const coreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(pal.hot),
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const core = new THREE.Mesh(coreGeom, coreMat);
    scene.add(core);

    // Soft inner glow (small additive sprite — much smaller than canvas
    // so it never bleeds into corners).
    const glowMat = new THREE.SpriteMaterial({
      map: dotTex,
      color: new THREE.Color(pal.accent),
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(1.0, 1.0, 1.0);
    scene.add(glow);

    /* ─── Distant star field for depth (very subtle) ────────────── */
    const STAR_N = 220;
    const starGeom = new THREE.BufferGeometry();
    const starPos = new Float32Array(STAR_N * 3);
    for (let i = 0; i < STAR_N; i++) {
      // Position stars on a sphere shell, radius ~ 3.0..3.4 (well behind the core)
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const r = 3.0 + Math.random() * 0.4;
      const sr = Math.sqrt(1 - u * u);
      starPos[i * 3 + 0] = sr * Math.cos(phi) * r;
      starPos[i * 3 + 1] = u * r;
      starPos[i * 3 + 2] = sr * Math.sin(phi) * r;
    }
    starGeom.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      map: dotTex,
      color: new THREE.Color(0x9be0ff),
      size: 0.03,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      alphaTest: 0.01,
    });
    const stars = new THREE.Points(starGeom, starMat);
    scene.add(stars);

    /* ─── HUD ring (single thin line orbit) ─────────────────────── */
    const ringPts = [];
    const RING_SEGS = 192;
    for (let i = 0; i <= RING_SEGS; i++) {
      const a = (i / RING_SEGS) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a) * 1.75, 0, Math.sin(a) * 1.75));
    }
    const ringGeom = new THREE.BufferGeometry().setFromPoints(ringPts);
    const ringMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(pal.primary),
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ring = new THREE.Line(ringGeom, ringMat);
    ring.rotation.x = 1.05;
    scene.add(ring);

    /* ─── Data packets (animated dots flowing along edges) ──────── */
    // Packets pick a random edge in one of the wireframes, travel from
    // one endpoint to the other in ~0.6s, then fade and respawn.
    const PACKET_MAX = 14;
    const packetGeom = new THREE.BufferGeometry();
    const packetPos = new Float32Array(PACKET_MAX * 3);
    packetGeom.setAttribute("position", new THREE.BufferAttribute(packetPos, 3));
    const packetMat = new THREE.PointsMaterial({
      map: dotTex,
      color: new THREE.Color(pal.hot),
      size: 0.12,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      alphaTest: 0.01,
    });
    const packets = new THREE.Points(packetGeom, packetMat);
    scene.add(packets);

    const packetState = []; // {layer, pair[2], t, life, speed, group}
    const layers = [
      { wf: outer,  group: outerGroup  },
      { wf: middle, group: middleGroup },
      { wf: inner,  group: innerGroup  },
    ];
    const respawnPacket = (i) => {
      const layer = layers[Math.floor(Math.random() * layers.length)];
      const pair = layer.wf.edgePairs[Math.floor(Math.random() * layer.wf.edgePairs.length)];
      packetState[i] = {
        wf: layer.wf,
        group: layer.group,
        a: pair[0],
        b: pair[1],
        t: 0,
        speed: 1.4 + Math.random() * 1.6,
        alive: true,
      };
    };
    for (let i = 0; i < PACKET_MAX; i++) respawnPacket(i);

    /* ─── Lightning arcs (occasional, between random vertex pairs) */
    const arcsGroup = new THREE.Group();
    scene.add(arcsGroup);
    const arcs = [];

    /* ─── Color targets for smooth lerp ─────────────────────────── */
    const tgt = {
      primary:   new THREE.Color(),
      secondary: new THREE.Color(),
      accent:    new THREE.Color(),
      hot:       new THREE.Color(),
    };

    /* ─── Animation loop ────────────────────────────────────────── */
    const clock = new THREE.Clock();
    let totalTime = 0;

    const animate = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      totalTime += dt;
      const s = stateRef.current;
      const I = Math.max(0, Math.min(1, s.intensity));

      // ─── Mode color palette, smooth lerp
      const palette = MODE_PALETTES[s.mode] || MODE_PALETTES.idle;
      tgt.primary.setHex(palette.primary);
      tgt.secondary.setHex(palette.secondary);
      tgt.accent.setHex(palette.accent);
      tgt.hot.setHex(palette.hot);
      const k = Math.min(1, dt * 9);
      lerpColor(outer.mat.color,        tgt.primary,   k);
      lerpColor(middle.mat.color,       tgt.secondary, k);
      lerpColor(inner.mat.color,        tgt.accent,    k);
      lerpColor(outerNodes.material.color,  tgt.secondary, k);
      lerpColor(middleNodes.material.color, tgt.accent,    k);
      lerpColor(innerNodes.material.color,  tgt.hot,       k);
      lerpColor(coreMat.color,          tgt.hot,       k);
      lerpColor(glowMat.color,          tgt.accent,    k);
      lerpColor(ringMat.color,          tgt.primary,   k);
      lerpColor(packetMat.color,        tgt.hot,       k);

      // ─── Rotation: each layer at different speed/axis for a complex feel
      const speedMul = 0.4 + I * 1.4;
      outerGroup.rotation.y += dt * 0.10 * speedMul;
      outerGroup.rotation.x += dt * 0.04 * speedMul;
      middleGroup.rotation.y -= dt * 0.18 * speedMul;
      middleGroup.rotation.z += dt * 0.06 * speedMul;
      innerGroup.rotation.y += dt * 0.34 * speedMul;
      innerGroup.rotation.x -= dt * 0.12 * speedMul;
      ring.rotation.z += dt * 0.18 * speedMul;
      stars.rotation.y += dt * 0.012;

      // ─── Pulse the core + glow
      const pulse = 1 + Math.sin(totalTime * (1.6 + I * 1.2)) * (0.10 + I * 0.10);
      core.scale.setScalar(pulse);
      coreMat.opacity = 0.85 + I * 0.10 + (s.speaking ? 0.05 : 0);
      const glowPulse = 1.6 + Math.sin(totalTime * 1.2) * 0.15 + I * 0.4;
      glow.scale.setScalar(glowPulse);
      glowMat.opacity = 0.45 + I * 0.30 + (s.speaking ? 0.10 : 0);

      // ─── Wireframe + node opacities react to intensity / speaking
      outer.mat.opacity   = 0.45 + I * 0.30;
      middle.mat.opacity  = 0.65 + I * 0.25;
      inner.mat.opacity   = 0.85 + I * 0.10;
      outerNodes.material.opacity  = 0.85 + I * 0.10;
      middleNodes.material.opacity = 0.90 + I * 0.10;
      innerNodes.material.opacity  = 0.95;
      ringMat.opacity = 0.30 + I * 0.30;

      // Speaking flicker — subtle ±opacity wobble that suggests speech
      if (s.speaking) {
        const flicker = 0.92 + Math.sin(totalTime * 22 + Math.sin(totalTime * 7)) * 0.08;
        outer.mat.opacity   *= flicker;
        middle.mat.opacity  *= flicker;
      }

      // Listening: pulsing thicker ring opacity to communicate "I'm receiving"
      if (s.listening) {
        ringMat.opacity = 0.45 + Math.sin(totalTime * 5) * 0.30;
      }

      // ─── Update data-packet positions (interpolate along their edges)
      let pi = 0;
      for (let i = 0; i < PACKET_MAX; i++) {
        const p = packetState[i];
        if (!p) { respawnPacket(i); continue; }
        p.t += dt * p.speed * (0.5 + I * 1.5);
        if (p.t >= 1) { respawnPacket(i); continue; }
        const va = p.wf.verts[p.a];
        const vb = p.wf.verts[p.b];
        // Interpolate in local space, then transform by group's matrix
        const localX = va.x + (vb.x - va.x) * p.t;
        const localY = va.y + (vb.y - va.y) * p.t;
        const localZ = va.z + (vb.z - va.z) * p.t;
        const v = new THREE.Vector3(localX, localY, localZ);
        v.applyMatrix4(p.group.matrixWorld);
        packetPos[pi * 3 + 0] = v.x;
        packetPos[pi * 3 + 1] = v.y;
        packetPos[pi * 3 + 2] = v.z;
        pi++;
      }
      // Make sure the group matrices are up-to-date for the packet sampling
      outerGroup.updateMatrixWorld();
      middleGroup.updateMatrixWorld();
      innerGroup.updateMatrixWorld();
      // zero out unused slots (they map to (0,0,0); the alphaTest hides them
      // because they overlap and visually become a single dim dot — set them
      // far away so they're outside the camera frustum)
      for (let j = pi; j < PACKET_MAX; j++) {
        packetPos[j * 3 + 0] = 999;
        packetPos[j * 3 + 1] = 999;
        packetPos[j * 3 + 2] = 999;
      }
      packets.geometry.attributes.position.needsUpdate = true;
      packetMat.size = 0.10 + I * 0.10;

      // ─── Spawn lightning arcs at high intensity (rare)
      if (I > 0.45 && Math.random() < 0.018 + I * 0.04) {
        // Pick two random vertices from the middle layer
        const verts = middle.verts;
        const a = verts[Math.floor(Math.random() * verts.length)].clone();
        const b = verts[Math.floor(Math.random() * verts.length)].clone();
        a.applyMatrix4(middleGroup.matrixWorld);
        b.applyMatrix4(middleGroup.matrixWorld);
        const segs = 5;
        const pts = [a];
        for (let kk = 1; kk < segs; kk++) {
          const f = kk / segs;
          const mid = a.clone().lerp(b, f);
          mid.x += (Math.random() - 0.5) * 0.18;
          mid.y += (Math.random() - 0.5) * 0.18;
          mid.z += (Math.random() - 0.5) * 0.18;
          pts.push(mid);
        }
        pts.push(b);
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        const m = new THREE.LineBasicMaterial({
          color: tgt.hot.clone(),
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const line = new THREE.Line(g, m);
        arcsGroup.add(line);
        arcs.push({ line, mat: m, geom: g, life: 1 });
      }
      for (let i = arcs.length - 1; i >= 0; i--) {
        const a = arcs[i];
        a.life -= dt * 3.0;
        a.mat.opacity = Math.max(0, a.life * 0.85);
        if (a.life <= 0) {
          arcsGroup.remove(a.line);
          a.geom.dispose();
          a.mat.dispose();
          arcs.splice(i, 1);
        }
      }

      // No camera drift — orb stays perfectly centered.
      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);

    /* ─── Cleanup ───────────────────────────────────────────────── */
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      [outer, middle, inner].forEach(({ edges, mat }) => { edges.dispose(); mat.dispose(); });
      [outerNodes, middleNodes, innerNodes].forEach((n) => { n.geometry.dispose(); n.material.dispose(); });
      coreGeom.dispose(); coreMat.dispose();
      glowMat.dispose();
      starGeom.dispose(); starMat.dispose();
      ringGeom.dispose(); ringMat.dispose();
      packetGeom.dispose(); packetMat.dispose();
      dotTex.dispose();
      arcs.forEach((a) => { a.geom.dispose(); a.mat.dispose(); });
      renderer.dispose();
      try { mount.removeChild(renderer.domElement); } catch {}
    };
  }, [size]);

  return (
    <div
      ref={mountRef}
      data-testid="cortex-cloud-3d"
      style={{
        width: size,
        height: size,
        display: "block",
        position: "relative",
        // Generous radial mask — keeps the entire neural core in the
        // fully-visible centre, then smoothly fades to transparent by
        // ~92% radius. With no BackSide spheres, no bloom, no large
        // particle cloud, the structure is contained well within the
        // visible zone — no eclipse, no rectangle.
        WebkitMaskImage:
          "radial-gradient(circle at 50% 50%, black 0%, black 50%, rgba(0,0,0,0.7) 70%, rgba(0,0,0,0.2) 84%, rgba(0,0,0,0) 95%)",
        maskImage:
          "radial-gradient(circle at 50% 50%, black 0%, black 50%, rgba(0,0,0,0.7) 70%, rgba(0,0,0,0.2) 84%, rgba(0,0,0,0) 95%)",
      }}
    />
  );
}
