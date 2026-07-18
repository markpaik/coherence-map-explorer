// Drafted node grammar — the mark the Blueprint pose (pose 2) hands the galaxy
// orbs off to, the drafting-symbol counterpart of the Transit stations
// (scene/stations.ts, whose SDF-billboard + per-instance-state approach this
// mirrors). It is the in-app realisation of the acceptance preview
// (scripts/pose-grammar-previews.mjs blueprintSheet): on the cyanotype sheet a
// standard is no longer a glowing orb but a DRAFTED SYMBOL —
//
//   · ordinary standard → a thin drafted ring (no fill) in white-ink tinted 30%
//                          toward its strand colour, with four crosshair ticks at
//                          N/E/S/W just outside the ring;
//   · family parent      → a DOUBLE ring (a thin outer ring around the primary);
//   · K-8 Major Work      → the ring plus a small filled centre dot
//                          (msa === 0 && grade !== "HS").
// The ring, double ring, and ticks are ADDITIVE marks: a family parent that is
// also Major Work draws all three, exactly as the preview does. Children draw
// the ordinary ring at their own (smaller) radius — in pose 2 the children are
// separate rows, so there is no lozenge grammar here.
//
// Two instanced billboard meshes (stations.ts is the pattern): RINGS (an SDF
// billboard drawing the ring / double ring / crosshair ticks, one program
// parameterised per instance) and DOTS (filled centre dots for Major Work).
// Both are camera-facing, depth-tested normally, sized off the node radii, and
// follow the live node positions through the crossfade. Story dimming is
// honoured the same way stations do — a missed / ghosted symbol reads near-black,
// consuming the same per-node emphasis / visibility / damage the nodes read.
//
// Crossfade: the drafts fade IN over pose 1.6→2.0 and OUT over 2.0→2.4, so they
// peak exactly at the Blueprint and are gone before the Transit crossing; the
// stations own the 2.6→3.0 swap, and the two windows never overlap. The orbs
// vanish under the union of both windows (see nodes.setOrbFade).
//
// Per art style the ink re-inks in place: Galaxy white-ink #eaf2ff, Ringers ink
// #1a1712, Fidenza cream — each tinted 30% toward the node's strand colour.

import * as THREE from "three";
import type { GraphCore, StrandId } from "../data";
import { RINGERS, FIDENZA } from "./artstyle";

// Strand brights — DESIGN.md's validated line palette (the same source the
// stations borders + the acceptance preview draw from).
const LINE_HEX: Record<StrandId, number> = {
  number: 0xe8b34b,
  algebra: 0x9a7df0,
  geometry: 0x4dc8c0,
  data: 0xe87a9b,
};
// Per-style ink base (tinted 30% toward the strand). Galaxy white-ink; Ringers
// graphite; Fidenza cream.
const INK_BASE: readonly number[] = [0xeaf2ff, 0x1a1712, 0xe8e0cd];
const MISSED = 0x0a0a16; // near-black a missed / ghosted symbol fades toward
const RING_R_FACTOR = 1.7; // primary ring radius vs. node visual radius
const DOT_R_FACTOR = 0.5; // Major-Work centre dot radius vs. node visual radius

// ---------------------------------------------------------------------------
// The drafts crossfade window: in over 1.6→2.0, out over 2.0→2.4 (smoothstep),
// peaking at the Blueprint. Exported so nodes.setOrbFade can union it with the
// station window and the orbs vanish under both. Zero outside [1.6, 2.4].
export function draftFade(pose: number): number {
  if (pose <= 1.6 || pose >= 2.4) return 0;
  const t = pose <= 2.0 ? (pose - 1.6) / 0.4 : (2.4 - pose) / 0.4;
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Pure classification (load time). Exported for the pipeline test — every
// standard gets a ring; family parents add the outer ring; K-8 Major Work adds
// the centre dot; children are the ordinary ring at their own radius.
export interface DraftClassification {
  /** Non-child, non-parent standards → single drafted ring. */
  ordinary: string[];
  /** Family parents → double ring. */
  families: string[];
  /** Sub-standards → single ring at their own (smaller) radius. */
  children: string[];
  /** msa === 0 && grade !== "HS" (any node) → adds a filled centre dot. */
  majorWork: string[];
}

export function classifyDrafts(graph: GraphCore): DraftClassification {
  const { nodes } = graph;
  const childIds = new Set<string>();
  for (const n of nodes) if (n.children) for (const c of n.children) childIds.add(c);

  const ordinary: string[] = [];
  const families: string[] = [];
  const children: string[] = [];
  const majorWork: string[] = [];
  for (const n of nodes) {
    const isChild = childIds.has(n.id);
    const isParent = !!(n.children && n.children.length);
    if (isChild) children.push(n.id);
    else if (isParent) families.push(n.id);
    else ordinary.push(n.id);
    if (n.msa === 0 && n.grade !== "HS") majorWork.push(n.id);
  }
  return { ordinary, families, children, majorWork };
}

export interface DraftsHandle {
  group: THREE.Group;
  /** Drive the crossfade + follow the live node positions (see draftFade). */
  update(pose: number): void;
  /** Re-ink for the active art style (0 Galaxy | 1 Ringers | 2 Fidenza). */
  setArtStyle(style: number): void;
  dispose(): void;
}

export function createDrafts(
  graph: GraphCore,
  radii: Float32Array,
  nodes: {
    getPosition(index: number, out: THREE.Vector3): THREE.Vector3;
    emphasisAttr: THREE.InstancedBufferAttribute;
    visibleAttr: THREE.InstancedBufferAttribute;
    damageAttr: THREE.InstancedBufferAttribute;
  },
): DraftsHandle {
  const cls = classifyDrafts(graph);
  const indexById = new Map<string, number>();
  graph.nodes.forEach((n, i) => indexById.set(n.id, i));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  // -- ring descriptors (one per node) ------------------------------------
  interface RingDesc {
    node: number;
    radius: number; // primary ring radius (world)
    double: number; // 1 for family parents, else 0
    strand: StrandId;
  }
  const rings: RingDesc[] = [];
  const familySet = new Set(cls.families);
  for (const n of graph.nodes) {
    const i = indexById.get(n.id)!;
    rings.push({
      node: i,
      radius: RING_R_FACTOR * radii[i],
      double: familySet.has(n.id) ? 1 : 0,
      strand: n.strand,
    });
  }

  // -- centre-dot descriptors (Major Work only) ---------------------------
  interface DotDesc {
    node: number;
    scale: number; // dot radius (world)
    strand: StrandId;
  }
  const dots: DotDesc[] = [];
  for (const id of cls.majorWork) {
    const i = indexById.get(id)!;
    dots.push({ node: i, scale: DOT_R_FACTOR * radii[i], strand: byId.get(id)!.strand });
  }

  // -- ring mesh ----------------------------------------------------------
  const R = rings.length;
  const ringPlane = new THREE.PlaneGeometry(1, 1);
  const ringGeo = new THREE.InstancedBufferGeometry();
  ringGeo.index = ringPlane.index;
  ringGeo.setAttribute("position", ringPlane.getAttribute("position"));
  const rCenter = new Float32Array(R * 3);
  const rRadius = new Float32Array(R);
  const rDouble = new Float32Array(R);
  const rInk = new Float32Array(R * 3);
  const rState = new Float32Array(R * 2).fill(1);
  rings.forEach((d, k) => {
    rRadius[k] = d.radius;
    rDouble[k] = d.double;
  });
  const rCenterAttr = new THREE.InstancedBufferAttribute(rCenter, 3);
  rCenterAttr.setUsage(THREE.DynamicDrawUsage);
  const rStateAttr = new THREE.InstancedBufferAttribute(rState, 2);
  rStateAttr.setUsage(THREE.DynamicDrawUsage);
  const rInkAttr = new THREE.InstancedBufferAttribute(rInk, 3);
  ringGeo.setAttribute("aCenter", rCenterAttr);
  ringGeo.setAttribute("aRadius", new THREE.InstancedBufferAttribute(rRadius, 1));
  ringGeo.setAttribute("aDouble", new THREE.InstancedBufferAttribute(rDouble, 1));
  ringGeo.setAttribute("aInk", rInkAttr);
  ringGeo.setAttribute("aState", rStateAttr);
  ringGeo.instanceCount = R;

  const ringUniforms = {
    uFade: { value: 0 },
    uMissed: { value: new THREE.Color(MISSED) },
  };
  const ringMat = new THREE.ShaderMaterial({
    uniforms: ringUniforms,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 aCenter;
      attribute float aRadius;
      attribute float aDouble;
      attribute vec3 aInk;
      attribute vec2 aState;
      varying vec2 vLocal;
      varying float vRadius;
      varying float vDouble;
      varying vec3 vInk;
      varying vec2 vState;
      void main() {
        float halfExtent = aRadius * 2.15; // cover the outermost tick (~1.95R)
        vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
        vec2 local = position.xy * 2.0 * halfExtent;
        mv.xy += local;
        gl_Position = projectionMatrix * mv;
        vLocal = local;
        vRadius = aRadius;
        vDouble = aDouble;
        vInk = aInk;
        vState = aState;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uFade;
      uniform vec3 uMissed;
      varying vec2 vLocal;
      varying float vRadius;
      varying float vDouble;
      varying vec3 vInk;
      varying vec2 vState;
      // Coverage of a stroke of half-width w centred on d == 0 (derivative-free
      // AA, size-relative — the Blueprint is fixed front-on like Transit).
      float band(float d, float w, float aa) {
        return 1.0 - smoothstep(w - aa, w + aa, abs(d));
      }
      void main() {
        float Rr = vRadius;
        float aa = 0.045 * Rr + 1e-4;
        float r = length(vLocal);
        // primary drafted ring
        float ringHalf = max(0.14 * Rr, 0.35);
        float cov = band(r - Rr, ringHalf, aa);
        // family double ring: a thin outer ring
        float dbl = band(r - 1.62 * Rr, 0.09 * Rr + 0.15, aa) * vDouble;
        cov = max(cov, dbl);
        // crosshair ticks at N/E/S/W, just outside the ring
        float t0 = 1.20 * Rr;
        float t1 = 1.95 * Rr;
        float tickHalf = max(0.09 * Rr, 0.3);
        float ax = abs(vLocal.x);
        float ay = abs(vLocal.y);
        float hx = smoothstep(t0 - aa, t0 + aa, ax) * (1.0 - smoothstep(t1 - aa, t1 + aa, ax));
        float tickH = hx * band(ay, tickHalf, aa);
        float vy = smoothstep(t0 - aa, t0 + aa, ay) * (1.0 - smoothstep(t1 - aa, t1 + aa, ay));
        float tickV = vy * band(ax, tickHalf, aa);
        cov = max(cov, max(tickH, tickV));
        if (cov < 0.003) discard;
        vec3 col = mix(uMissed, vInk, vState.x);
        gl_FragColor = vec4(col, cov * uFade * vState.y);
      }
    `,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.frustumCulled = false;
  ringMesh.renderOrder = 1; // over edges (-1)
  ringMesh.name = "drafts-rings";

  // -- dot mesh -----------------------------------------------------------
  const D = dots.length;
  const dotPlane = new THREE.PlaneGeometry(1, 1);
  const dotGeo = new THREE.InstancedBufferGeometry();
  dotGeo.index = dotPlane.index;
  dotGeo.setAttribute("position", dotPlane.getAttribute("position"));
  const dCenter = new Float32Array(D * 3);
  const dScale = new Float32Array(D);
  const dColor = new Float32Array(D * 3);
  const dState = new Float32Array(D * 2).fill(1);
  dots.forEach((d, k) => {
    dScale[k] = d.scale;
  });
  const dCenterAttr = new THREE.InstancedBufferAttribute(dCenter, 3);
  dCenterAttr.setUsage(THREE.DynamicDrawUsage);
  const dStateAttr = new THREE.InstancedBufferAttribute(dState, 2);
  dStateAttr.setUsage(THREE.DynamicDrawUsage);
  const dColorAttr = new THREE.InstancedBufferAttribute(dColor, 3);
  dotGeo.setAttribute("aCenter", dCenterAttr);
  dotGeo.setAttribute("aScale", new THREE.InstancedBufferAttribute(dScale, 1));
  dotGeo.setAttribute("aColor", dColorAttr);
  dotGeo.setAttribute("aState", dStateAttr);
  dotGeo.instanceCount = D;

  const dotUniforms = {
    uFade: { value: 0 },
    uMissed: { value: new THREE.Color(MISSED) },
  };
  const dotMat = new THREE.ShaderMaterial({
    uniforms: dotUniforms,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 aCenter;
      attribute float aScale;
      attribute vec3 aColor;
      attribute vec2 aState;
      varying vec2 vP;
      varying vec3 vColor;
      varying vec2 vState;
      void main() {
        vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
        mv.xy += position.xy * 2.0 * aScale;
        gl_Position = projectionMatrix * mv;
        vP = position.xy * 2.0;
        vColor = aColor;
        vState = aState;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uFade;
      uniform vec3 uMissed;
      varying vec2 vP;
      varying vec3 vColor;
      varying vec2 vState;
      void main() {
        float r = length(vP);
        float a = 1.0 - smoothstep(0.85, 1.0, r);
        if (a < 0.003) discard;
        vec3 col = mix(uMissed, vColor, vState.x);
        gl_FragColor = vec4(col, a * uFade * vState.y);
      }
    `,
  });
  const dotMesh = new THREE.Mesh(dotGeo, dotMat);
  dotMesh.frustumCulled = false;
  dotMesh.renderOrder = 2; // dots over their rings
  dotMesh.name = "drafts-dots";

  const group = new THREE.Group();
  group.name = "drafts";
  group.visible = false;
  group.add(ringMesh, dotMesh);

  // -- art-style ink baking -----------------------------------------------
  const base = new THREE.Color();
  const strandC = new THREE.Color();
  function bakeColors(style: number): void {
    const inkHex = INK_BASE[style] ?? INK_BASE[0];
    const strandHexFor = (s: StrandId): number =>
      style === 1 ? (RINGERS.peg[s] ?? RINGERS.pegWhite) : style === 2 ? (FIDENZA.node[s] ?? FIDENZA.palette[0]) : LINE_HEX[s];
    // Tint the ink 30% toward the strand (linear lerp — matches the baked-color
    // convention the other layers use).
    const tint = (s: StrandId, out: Float32Array, k: number): void => {
      base.setHex(inkHex);
      strandC.setHex(strandHexFor(s));
      base.lerp(strandC, 0.3);
      out[k * 3] = base.r;
      out[k * 3 + 1] = base.g;
      out[k * 3 + 2] = base.b;
    };
    rings.forEach((d, k) => tint(d.strand, rInk, k));
    dots.forEach((d, k) => tint(d.strand, dColor, k));
    rInkAttr.needsUpdate = true;
    dColorAttr.needsUpdate = true;
  }
  bakeColors(0);

  // -- per-frame follow + story dimming -----------------------------------
  const emphA = nodes.emphasisAttr.array as Float32Array;
  const visA = nodes.visibleAttr.array as Float32Array;
  const dmgA = nodes.damageAttr.array as Float32Array;
  const v = new THREE.Vector3();
  const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
  // Same fold as stations: dimmed emphasis / damage → near-black (holds place);
  // ghosted (filtered out) → nearly vanishes.
  function stateOf(i: number): [number, number] {
    const e = emphA[i];
    const emphDim = e < 1 ? clamp01(e) : 1;
    const colorDim = clamp01(emphDim * (1 - 0.85 * dmgA[i]));
    const alphaMul = 0.12 + 0.88 * clamp01(visA[i]);
    return [colorDim, alphaMul];
  }

  return {
    group,
    update(pose) {
      const fade = draftFade(pose);
      if (fade <= 0.001) {
        if (group.visible) group.visible = false;
        return;
      }
      group.visible = true;
      ringUniforms.uFade.value = fade;
      dotUniforms.uFade.value = fade;
      for (let k = 0; k < R; k++) {
        const i = rings[k].node;
        nodes.getPosition(i, v);
        rCenter[k * 3] = v.x;
        rCenter[k * 3 + 1] = v.y;
        rCenter[k * 3 + 2] = v.z;
        const st = stateOf(i);
        rState[k * 2] = st[0];
        rState[k * 2 + 1] = st[1];
      }
      for (let k = 0; k < D; k++) {
        const i = dots[k].node;
        nodes.getPosition(i, v);
        dCenter[k * 3] = v.x;
        dCenter[k * 3 + 1] = v.y;
        dCenter[k * 3 + 2] = v.z;
        const st = stateOf(i);
        dState[k * 2] = st[0];
        dState[k * 2 + 1] = st[1];
      }
      rCenterAttr.needsUpdate = true;
      rStateAttr.needsUpdate = true;
      dCenterAttr.needsUpdate = true;
      dStateAttr.needsUpdate = true;
    },
    setArtStyle(style) {
      bakeColors(style);
    },
    dispose() {
      ringPlane.dispose();
      dotPlane.dispose();
      ringGeo.dispose();
      dotGeo.dispose();
      ringMat.dispose();
      dotMat.dispose();
    },
  };
}
