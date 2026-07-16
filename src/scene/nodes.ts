// All 480 standards as ONE InstancedMesh (low-poly icosphere), plus an
// invisible raycast-proxy InstancedMesh used only for picking.
//
// Per-instance state:
//   instanceColor — base strand color (never changes)
//   aEmphasis     — 0 dimmed | 1 rest | 2 hover | 3 focus | 4 chain | 5 related
//   aPhase        — shimmer phase, seeded from instance index
//
// The MeshBasicMaterial is patched via onBeforeCompile: emphasis drives an HDR
// color multiplier + per-instance scale (DESIGN.md node-states table), with a
// ~6s ×1.05–1.15 brightness shimmer from a uTime uniform. Fractional emphasis
// values blend piecewise-linearly between adjacent states, which is what lets
// the state machine ease hover in/out over ~150ms on the CPU side.

import * as THREE from "three";
import type { GraphNode } from "../data";
import { EMPHASIS, STRAND_COLORS, restRadius } from "./palette";

const DIM_TARGET = 0x0a0a18; // dimmed nodes lerp toward this (factor 0.82)
const PROXY_RADIUS_FACTOR = 2.5; // pick radius vs. visual radius
const TOUCH_EXTRA_FACTOR = 2.0; // additional proxy scale for touch pointers (fleet: taps still felt smaller than the dots look)

// Per-state tables, indexed by EMPHASIS value: [colorMul, scale, dimMix]
// dimMix is the lerp factor toward DIM_TARGET (0.82 when fully dimmed).
const STATE_TABLE = [
  /* dimmed  */ { mul: 1.0, scale: 0.8, dim: 0.82 },
  /* rest    */ { mul: 1.0, scale: 1.0, dim: 0.0 },
  /* hover   */ { mul: 1.6, scale: 1.25, dim: 0.0 },
  /* focus   */ { mul: 2.6, scale: 1.5, dim: 0.0 },
  /* chain   */ { mul: 1.9, scale: 1.15, dim: 0.0 },
  /* related */ { mul: 1.25, scale: 1.0, dim: 0.0 },
];

const glslTable = (key: "mul" | "scale" | "dim"): string =>
  STATE_TABLE.map((s) => s[key].toFixed(4)).join(", ");

export interface NodesHandle {
  /** The single visible instanced mesh (1 draw call). */
  mesh: THREE.InstancedMesh;
  /** Invisible picking proxy — never rendered; raycast against it directly. */
  proxy: THREE.InstancedMesh;
  count: number;
  /** Target emphasis attribute; write via the state machine only. */
  emphasisAttr: THREE.InstancedBufferAttribute;
  /** Filter-visibility attribute (1 shown / 0 ghosted); write via filters only. */
  visibleAttr: THREE.InstancedBufferAttribute;
  /** Per-node structural damage 0..1 (stories + Gaps); write via setDamage only. */
  damageAttr: THREE.InstancedBufferAttribute;
  /** True unless this instance is filtered out (picking consults this). */
  isVisible(index: number): boolean;
  /**
   * Set per-node damage (0..1). null clears every node to 0 in one memset.
   * Damage composes AFTER emphasis in the shader (a chain-lit but damaged node
   * keeps its emphasis SIZE and takes the damage COLOR), and stays sub-1.0 HDR
   * so the ember/flicker never blooms — bloom is reserved for healthy emphasis.
   */
  setDamage(values: Float32Array | null): void;
  /**
   * Story-only visibility override: ghost every node NOT in the mask (fractional
   * values allowed, so callers can crossfade). null restores full visibility.
   * Bypasses the filters UI entirely; the filters recompute reclaims the buffer
   * on story exit.
   */
  setVisibleMask(mask: Float32Array | null): void;
  /**
   * Overwrite instance i's world position (keeps its base radius). Updates
   * BOTH the visible mesh and the pick proxy instance matrices in place — the
   * pose driver drives this every morph frame, which is why raycast picking
   * keeps landing on the moving dots. Batched: flip commitPositions() once per
   * frame after a run of setInstancePosition calls.
   */
  setInstancePosition(index: number, x: number, y: number, z: number): void;
  /** Flag both instance-matrix buffers dirty and refresh the proxy bounds. */
  commitPositions(): void;
  /** Read instance i's current world position (for pose-correct camera framing). */
  getPosition(index: number, out: THREE.Vector3): THREE.Vector3;
  /** Advance the shimmer clock (seconds). */
  setTime(t: number): void;
  /** Toggle the idle brightness shimmer (off under reduced motion). */
  setShimmerEnabled(on: boolean): void;
  /** Grow the proxy pick radius for touch pointers (idempotent). */
  setTouchPicking(on: boolean): void;
  /** Bounding sphere of the whole node cloud (for camera framing). */
  boundsSphere: THREE.Sphere;
  /** Axis-aligned bounds of the cloud (tighter framing than the sphere). */
  boundsBox: THREE.Box3;
  dispose(): void;
}

export function createNodes(nodes: GraphNode[]): NodesHandle {
  const count = nodes.length;

  // -- visible mesh -----------------------------------------------------
  const geometry = new THREE.IcosahedronGeometry(1, 1); // 80 tris, plenty round under bloom
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });

  const emphasis = new Float32Array(count).fill(EMPHASIS.REST);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // Deterministic per-instance phase seeded from index (golden-angle scatter).
    phase[i] = (i * 2.399963) % (Math.PI * 2);
  }
  // Filter visibility: 1 = shown, 0 = filtered out (ghosted, not hit-tested).
  const visible = new Float32Array(count).fill(1);
  // Structural damage 0..1 (stories + Gaps); 0 = untouched, 1 = ember husk.
  const damage = new Float32Array(count); // all 0 at rest
  const emphasisAttr = new THREE.InstancedBufferAttribute(emphasis, 1);
  emphasisAttr.setUsage(THREE.DynamicDrawUsage);
  const phaseAttr = new THREE.InstancedBufferAttribute(phase, 1);
  const visibleAttr = new THREE.InstancedBufferAttribute(visible, 1);
  visibleAttr.setUsage(THREE.DynamicDrawUsage);
  const damageAttr = new THREE.InstancedBufferAttribute(damage, 1);
  damageAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aEmphasis", emphasisAttr);
  geometry.setAttribute("aPhase", phaseAttr);
  geometry.setAttribute("aVisible", visibleAttr);
  geometry.setAttribute("aDamage", damageAttr);

  const uniforms = {
    uTime: { value: 0 },
    uDimColor: { value: new THREE.Color(DIM_TARGET) },
    // 1 = idle shimmer on; 0 forces the multiplier to exactly 1.0 (no glow) so
    // reduced-motion is truly still, not just frozen at a random shimmer phase.
    uShimmer: { value: 1 },
  };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uDimColor = uniforms.uDimColor;
    shader.uniforms.uShimmer = uniforms.uShimmer;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        attribute float aEmphasis;
        attribute float aPhase;
        attribute float aVisible;
        attribute float aDamage;
        uniform float uTime;
        uniform float uShimmer;
        varying float vColorMul;
        varying float vDim;
        varying float vDamage;
        varying float vPhase;
        `,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        {
          float mulTab[6] = float[](${glslTable("mul")});
          float sclTab[6] = float[](${glslTable("scale")});
          float dimTab[6] = float[](${glslTable("dim")});
          float e = clamp(aEmphasis, 0.0, 5.0);
          int i0 = int(floor(e));
          int i1 = int(min(floor(e) + 1.0, 5.0));
          float f = fract(e);
          float mul = mix(mulTab[i0], mulTab[i1], f);
          float scl = mix(sclTab[i0], sclTab[i1], f);
          float dim = mix(dimTab[i0], dimTab[i1], f);
          // Idle shimmer: ×1.06–1.22, ~6s period, per-instance phase.
          // Peaks graze the bloom threshold so the constellation breathes.
          // uShimmer=0 (reduced motion) collapses it to exactly 1.0 → no glow.
          float shimmer = mix(1.0, 1.14 + 0.08 * sin(uTime * ${((Math.PI * 2) / 6).toFixed(6)} + aPhase), uShimmer);
          vColorMul = mul * shimmer;
          // Filtered-out instances shrink to a faint background speck (ghost) and
          // read as dimmed — opaque, so the depth pass and edge occlusion hold.
          scl *= mix(0.14, 1.0, aVisible);
          vDim = max(dim, (1.0 - aVisible) * 0.9);
          // Damage rides on top of emphasis: it recolors (fragment) but never
          // resizes, so a chain-lit-but-damaged node keeps its emphasis size.
          vDamage = clamp(aDamage, 0.0, 1.0);
          vPhase = aPhase;
          transformed *= scl;
        }
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform vec3 uDimColor;
        uniform float uTime;
        varying float vColorMul;
        varying float vDim;
        varying float vDamage;
        varying float vPhase;
        `,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `
        #include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb * vColorMul, uDimColor, vDim);
        // --- structural damage (composited AFTER emphasis) --------------------
        // 0 = untouched; 1 = ember husk. Damage distinguishes OUTAGE from
        // STRUGGLE: a fully-dead node (d >= 0.95) is a steady dark ember with
        // only the slow ~2.5s pulse — no flicker; a half-damaged node visibly
        // wavers; a lightly-touched one barely trembles. The flicker amplitude
        // follows a struggle curve 4·d·(1−d) that peaks at d = 0.5 and vanishes
        // at both ends. Brightness AND saturation lerp toward a deep red-amber
        // ember, with a mid-range-boosted desaturation so struggle reads even at
        // d ≈ 0.3. The husk tops out near #7a3520 (< 1.0 in every channel), so
        // damage NEVER crosses the bloom threshold — glow stays for healthy
        // emphasis only.
        if (vDamage > 0.0001) {
          float d = vDamage;
          float pulse = 0.5 + 0.5 * sin(uTime * 2.5132741 + vPhase);       // ~2.5s
          vec3 emberLo = vec3(0.2902, 0.1216, 0.0784);                     // #4a1f14
          vec3 emberHi = vec3(0.4784, 0.2078, 0.1255);                     // #7a3520
          vec3 husk = mix(emberLo, emberHi, pulse);
          // Mid-range-boosted desaturation: the struggle band (d ~ 0.3–0.6)
          // visibly drains of strand color before it goes ember.
          float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum), clamp(d * 1.35, 0.0, 1.0) * 0.6);
          // Struggle flicker: amplitude peaks at d = 0.5, zero at both ends, and
          // hard-cut to 0 for a fully-dead ember (d >= 0.95) so it sits steady.
          float struggle = 4.0 * d * (1.0 - d) * (1.0 - step(0.95, d));
          float flick = sin(uTime * 6.7 + vPhase * 3.1) * 0.6
                      + sin(uTime * 11.3 + vPhase * 1.7) * 0.4;            // irregular
          float flickMul = 1.0 - 0.16 * struggle * (0.5 + 0.5 * flick);
          diffuseColor.rgb = mix(diffuseColor.rgb, husk, d) * flickMul;
        }
        `,
      );
  };
  // Distinct cache key so the patched program never collides with a stock basic material.
  material.customProgramCacheKey = () => "coherence-nodes-v3-struggle";

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.name = "nodes";

  // -- transforms + colors ----------------------------------------------
  // Current world position per instance (mutable — the pose driver morphs it
  // between graph.pos and graph.pos2). Seeded to pose A (the constellation).
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) positions.set(nodes[i].pos, i * 3);

  const m = new THREE.Matrix4();
  const color = new THREE.Color();

  // Compose one instance's visible matrix from its stored position + base
  // radius (emphasis scale rides on top in the shader, never in the matrix).
  function writeVisibleMatrix(i: number): void {
    const r = restRadius(nodes[i].deg);
    m.makeScale(r, r, r);
    m.setPosition(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    mesh.setMatrixAt(i, m);
  }

  for (let i = 0; i < count; i++) {
    writeVisibleMatrix(i);
    color.setHex(STRAND_COLORS[nodes[i].strand]);
    mesh.setColorAt(i, color); // every instance colored before first render
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  // -- raycast proxy (never rendered) -------------------------------------
  // visible=false keeps it out of the render list entirely (0 draw calls);
  // THREE.Raycaster.intersectObject() does not test .visible, so picking
  // against it directly still works.
  const proxyGeometry = new THREE.IcosahedronGeometry(1, 0);
  const proxyMaterial = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
  });
  const proxy = new THREE.InstancedMesh(proxyGeometry, proxyMaterial, count);
  proxy.frustumCulled = false;
  proxy.visible = false;
  proxy.name = "nodes-proxy";

  let touchMode = false;
  const pm = new THREE.Matrix4();
  function writeProxyMatrix(i: number): void {
    const factor = PROXY_RADIUS_FACTOR * (touchMode ? TOUCH_EXTRA_FACTOR : 1);
    const r = restRadius(nodes[i].deg) * factor;
    pm.makeScale(r, r, r);
    pm.setPosition(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    proxy.setMatrixAt(i, pm);
  }
  function writeProxyMatrices(): void {
    for (let i = 0; i < count; i++) writeProxyMatrix(i);
    proxy.instanceMatrix.needsUpdate = true;
    proxy.computeBoundingSphere();
  }
  writeProxyMatrices();

  // -- bounds for camera framing ------------------------------------------
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const n of nodes) box.expandByPoint(v.set(n.pos[0], n.pos[1], n.pos[2]));
  const boundsSphere = new THREE.Sphere();
  box.getBoundingSphere(boundsSphere);

  return {
    mesh,
    proxy,
    count,
    emphasisAttr,
    visibleAttr,
    damageAttr,
    isVisible(index) {
      return visible[index] !== 0;
    },
    setDamage(values) {
      if (values === null) {
        damage.fill(0);
      } else {
        damage.set(values);
      }
      damageAttr.needsUpdate = true;
    },
    setVisibleMask(mask) {
      if (mask === null) {
        visible.fill(1);
      } else {
        visible.set(mask);
      }
      visibleAttr.needsUpdate = true;
    },
    setInstancePosition(index, x, y, z) {
      positions[index * 3] = x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = z;
      writeVisibleMatrix(index);
      writeProxyMatrix(index);
    },
    commitPositions() {
      mesh.instanceMatrix.needsUpdate = true;
      proxy.instanceMatrix.needsUpdate = true;
      proxy.computeBoundingSphere();
    },
    getPosition(index, out) {
      return out.set(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
    },
    boundsSphere,
    boundsBox: box,
    setTime(t) {
      uniforms.uTime.value = t;
    },
    setShimmerEnabled(on) {
      uniforms.uShimmer.value = on ? 1 : 0;
    },
    setTouchPicking(on) {
      if (on === touchMode) return;
      touchMode = on;
      writeProxyMatrices();
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      proxyGeometry.dispose();
      proxyMaterial.dispose();
    },
  };
}
