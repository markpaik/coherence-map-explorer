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
  /** True unless this instance is filtered out (picking consults this). */
  isVisible(index: number): boolean;
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
  const emphasisAttr = new THREE.InstancedBufferAttribute(emphasis, 1);
  emphasisAttr.setUsage(THREE.DynamicDrawUsage);
  const phaseAttr = new THREE.InstancedBufferAttribute(phase, 1);
  const visibleAttr = new THREE.InstancedBufferAttribute(visible, 1);
  visibleAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aEmphasis", emphasisAttr);
  geometry.setAttribute("aPhase", phaseAttr);
  geometry.setAttribute("aVisible", visibleAttr);

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
        uniform float uTime;
        uniform float uShimmer;
        varying float vColorMul;
        varying float vDim;
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
        varying float vColorMul;
        varying float vDim;
        `,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `
        #include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb * vColorMul, uDimColor, vDim);
        `,
      );
  };
  // Distinct cache key so the patched program never collides with a stock basic material.
  material.customProgramCacheKey = () => "coherence-nodes-v1";

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.name = "nodes";

  // -- transforms + colors ----------------------------------------------
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const n = nodes[i];
    const r = restRadius(n.deg);
    m.makeScale(r, r, r);
    m.setPosition(n.pos[0], n.pos[1], n.pos[2]);
    mesh.setMatrixAt(i, m);
    color.setHex(STRAND_COLORS[n.strand]);
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
  function writeProxyMatrices(): void {
    const factor = PROXY_RADIUS_FACTOR * (touchMode ? TOUCH_EXTRA_FACTOR : 1);
    const pm = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const n = nodes[i];
      const r = restRadius(n.deg) * factor;
      pm.makeScale(r, r, r);
      pm.setPosition(n.pos[0], n.pos[1], n.pos[2]);
      proxy.setMatrixAt(i, pm);
    }
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
    isVisible(index) {
      return visible[index] !== 0;
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
