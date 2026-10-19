// Pines and reeds. Two framing pines stand at the near left and right, outside
// the map's radius, so they frame the home view and stay real geometry under
// orbit: plated ink trunks (one tube mesh) and needle clusters as flat fan
// pads (camera-facing cards that keep their flat underside level, and turn
// into round clumps seen from above). Small distant pines print as ink marks
// on the far ridge crests. A reed bank grows at the near shore, left of the map:
// strap leaves and stems with drooping panicles, as instanced blades.
//
// Washi prints the pines soft and snowless in pine green with ink trunks. Dusk
// prints them in silhouette with a pale rim on the side facing the moon (the
// one light source). Their bases dissolve into the field, like the ridges.
// The reeds sway very slowly and hold still under reduced motion.

import * as THREE from "three";
import { DEG, RINGS, TAU, f, lhash, ridgeHeight } from "./core";

// ---------------------------------------------------------------------------
// Placement (world units, relative to the landscape center).

export interface PineSpec {
  /** Root of the trunk. */
  x: number;
  z: number;
  base: number;
  /** Trunk control points as offsets from the root: [dx, dy, dz]. */
  trunk: readonly [number, number, number][];
  /** Trunk radius at the root. */
  r0: number;
  /** Branches: trunk point index, then the end offset from that point. */
  branches: readonly [number, number, number, number][];
  /** Pads: center offset from the root, width, height. */
  pads: readonly [number, number, number, number, number][];
  /** -1 left of the map at the home view, +1 right. */
  side: number;
}

/** Height over which a trunk or reed base dissolves into the field. */
export const FLORA_FADE = 150;

export const PINES: readonly PineSpec[] = [
  {
    // Near left: a low pine leaning in from beyond the left edge, its pads
    // under the search rail and clear of Fuji and the sun.
    x: -1090,
    z: -380,
    base: -640,
    r0: 15,
    trunk: [
      [0, 0, 0],
      [8, 110, 6],
      [40, 220, 10],
      [104, 300, 4],
      [174, 356, 0],
      [232, 390, -4],
    ],
    branches: [
      [3, 90, 26, -10],
      [4, 70, 14, 18],
      [2, 80, 74, 6],
    ],
    pads: [
      [262, 406, -2, 150, 44],
      [214, 430, 10, 120, 38],
      [278, 372, 26, 120, 36],
      [176, 386, -12, 110, 38],
      [86, 332, 10, 100, 36],
      [140, 302, -6, 90, 32],
    ],
    side: -1,
  },
  {
    // Near right: taller, leaning in from beyond the right edge.
    x: 1090,
    z: -330,
    base: -500,
    r0: 18,
    trunk: [
      [0, 0, 0],
      [-10, 150, 4],
      [8, 320, -6],
      [-40, 470, 0],
      [-110, 590, 6],
      [-150, 690, 0],
    ],
    branches: [
      [3, -150, 50, 10],
      [4, -140, 30, -14],
      [2, -110, 80, 8],
      [5, -60, 40, 0],
    ],
    pads: [
      [-200, 530, 10, 170, 50],
      [-260, 500, -6, 140, 44],
      [-250, 470, 14, 140, 44],
      [-160, 660, -10, 150, 48],
      [-220, 620, 6, 130, 42],
      [-150, 730, 0, 120, 40],
      [-90, 590, -8, 110, 40],
    ],
    side: 1,
  },
];

/** The reed bank: center, half-length along the shore (x), half-depth (z). */
export const REEDS = {
  count: 150,
  x: -745,
  z: -210,
  halfX: 110,
  halfZ: 45,
  /** Root height (the bank) and blade heights. */
  y: -372,
  h0: 60,
  h1: 112,
  /** Share of stems that carry a drooping panicle. */
  panicle: 0.4,
  /** Sway amplitude (radians) and periods (seconds). */
  sway: 0.045,
  pSway0: 11,
  pSway1: 17,
} as const;

export interface ReedBlade {
  x: number;
  y: number;
  z: number;
  h: number;
  w: number;
  lean: number;
  kind: number;
  seed: number;
}
export function reedBlade(i: number): ReedBlade {
  const u = lhash(601, i) * 2 - 1;
  const v = lhash(602, i) * 2 - 1;
  // Denser and taller toward the bank's middle.
  const mid = 1 - Math.abs(u);
  const kind = lhash(605, i) < REEDS.panicle ? 1 : 0;
  return {
    x: REEDS.x + u * REEDS.halfX,
    y: REEDS.y + lhash(603, i) * 12,
    z: REEDS.z + v * REEDS.halfZ,
    h: (REEDS.h0 + (REEDS.h1 - REEDS.h0) * lhash(604, i)) * (0.75 + 0.25 * mid),
    w: kind === 1 ? 3.2 : 4 + 3 * lhash(606, i),
    // Most blades lean the same way (the wind), a few cross.
    lean: (lhash(607, i) < 0.8 ? 0.12 : -0.18) + (lhash(608, i) - 0.5) * 0.3,
    kind,
    seed: lhash(609, i),
  };
}

/** Distant pines: ink marks on ring 3's crest, in small groups. */
export const FAR_PINE_RING = 2;
export const FAR_PINE_GROUPS: readonly number[] = [-128, -78, -52, 22, 58, 104, 150, 205, 262, 318].map((d) => d * DEG);

export interface FarPine {
  theta: number;
  y: number;
  h: number;
}
/** The distant pines: each group sits near the highest crest within 7 deg of
 *  its azimuth, two or three trees a little apart. */
export function farPines(): FarPine[] {
  const ring = RINGS[FAR_PINE_RING];
  const out: FarPine[] = [];
  FAR_PINE_GROUPS.forEach((g, gi) => {
    let best = g;
    let bestH = -Infinity;
    for (let k = -14; k <= 14; k++) {
      const th = g + k * 0.5 * DEG;
      const hh = ridgeHeight(ring, th);
      if (hh > bestH) {
        bestH = hh;
        best = th;
      }
    }
    const n = 2 + Math.floor(lhash(621, gi) * 2);
    for (let j = 0; j < n; j++) {
      const th = best + (j - (n - 1) / 2) * (1.1 + 0.6 * lhash(622, gi * 4 + j)) * DEG;
      out.push({ theta: th, y: ridgeHeight(ring, th) - 5, h: 44 + 22 * lhash(623, gi * 4 + j) });
    }
  });
  return out;
}

export interface FloraSample {
  x: number;
  y: number;
  z: number;
  /** Half-extents of the mark around the point (world units). */
  hw: number;
  hh: number;
  kind: "trunk" | "pad" | "reed";
  side: number;
}
/** Points that bound every visible framing element (trunks above their fade,
 *  pads, reed tips and roots above the fade), for the placement tests. */
export function floraSamples(): FloraSample[] {
  const out: FloraSample[] = [];
  for (const p of PINES) {
    for (const [dx, dy, dz] of p.trunk) {
      if (dy < FLORA_FADE * 0.5) continue;
      out.push({ x: p.x + dx, y: p.base + dy, z: p.z + dz, hw: p.r0, hh: 0, kind: "trunk", side: p.side });
    }
    for (const [ti, ex, ey, ez] of p.branches) {
      const [dx, dy, dz] = p.trunk[ti];
      out.push({ x: p.x + dx + ex, y: p.base + dy + ey, z: p.z + dz + ez, hw: 6, hh: 0, kind: "trunk", side: p.side });
    }
    for (const [dx, dy, dz, w, h] of p.pads) {
      out.push({ x: p.x + dx, y: p.base + dy, z: p.z + dz, hw: w / 2, hh: h / 2, kind: "pad", side: p.side });
    }
  }
  for (let i = 0; i < REEDS.count; i++) {
    const b = reedBlade(i);
    out.push({ x: b.x, y: b.y + b.h, z: b.z, hw: b.h * 0.35, hh: 4, kind: "reed", side: -1 });
    out.push({ x: b.x, y: b.y + b.h * 0.3, z: b.z, hw: 4, hh: 4, kind: "reed", side: -1 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Geometry

/** A tapered tube along a Catmull-Rom curve through `pts`, appended to the
 *  arrays. aMark: (distance along the tube, turn around it, height above the
 *  pine's base, side). */
function tube(
  pts: THREE.Vector3[],
  r0: number,
  r1: number,
  segs: number,
  radial: number,
  base: number,
  side: number,
  pos: number[],
  nor: number[],
  mark: number[],
  idx: number[],
): void {
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  const frames = curve.computeFrenetFrames(segs, false);
  const start = pos.length / 3;
  const len = curve.getLength();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, p);
    // A slightly irregular taper (knots).
    const r = (r0 + (r1 - r0) * t) * (1 + 0.08 * Math.sin(t * 23 + r0));
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      n.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a)).normalize();
      pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      nor.push(n.x, n.y, n.z);
      mark.push(t * len, j / radial, p.y - base, side);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = start + i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
}

/** All pine trunks and branches in one indexed geometry. */
export function buildPineTrunks(): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const mark: number[] = [];
  const idx: number[] = [];
  for (const p of PINES) {
    const pts = p.trunk.map(([dx, dy, dz]) => new THREE.Vector3(p.x + dx, p.base + dy, p.z + dz));
    // The trunk starts below the root so its base dissolves.
    pts.unshift(new THREE.Vector3(p.x, p.base - 60, p.z));
    tube(pts, p.r0 * 1.15, p.r0 * 0.4, 40, 9, p.base, p.side, pos, nor, mark, idx);
    for (const [ti, ex, ey, ez] of p.branches) {
      const a = pts[ti + 1];
      const end = new THREE.Vector3(a.x + ex, a.y + ey, a.z + ez);
      const mid = a.clone().lerp(end, 0.5).add(new THREE.Vector3(0, -Math.abs(ex) * 0.12, 0));
      tube([a.clone(), mid, end], p.r0 * 0.42, p.r0 * 0.16, 10, 6, p.base, p.side, pos, nor, mark, idx);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("aMark", new THREE.Float32BufferAttribute(mark, 4));
  g.setIndex(idx);
  return g;
}

/** Pads (kind 0) or distant pines (kind 1) as instanced camera-facing cards.
 *  aCard: center xyz and width. aCard2: height, seed, kind, side. */
export function buildCards(kind: 0 | 1): THREE.InstancedBufferGeometry {
  const quad = new THREE.PlaneGeometry(2, 2);
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute("position", quad.getAttribute("position"));
  const a: number[] = [];
  const b: number[] = [];
  if (kind === 0) {
    PINES.forEach((p, pi) => {
      p.pads.forEach(([dx, dy, dz, w, h], k) => {
        a.push(p.x + dx, p.base + dy, p.z + dz, w);
        b.push(h, lhash(631, pi * 16 + k), 0, p.side);
      });
    });
  } else {
    const ring = RINGS[FAR_PINE_RING];
    farPines().forEach((fp, k) => {
      a.push(ring.R * Math.sin(fp.theta), fp.y + fp.h * 0.5, -ring.R * Math.cos(fp.theta), fp.h * 0.5);
      b.push(fp.h, lhash(632, k), 1, 0);
    });
  }
  g.setAttribute("aCard", new THREE.InstancedBufferAttribute(new Float32Array(a), 4));
  g.setAttribute("aCard2", new THREE.InstancedBufferAttribute(new Float32Array(b), 4));
  g.instanceCount = a.length / 4;
  quad.dispose();
  return g;
}

export const REED_SEGS = 10;
/** The reed bank: one strip per blade, instanced. */
export function buildReeds(): THREE.InstancedBufferGeometry {
  const strip = new THREE.PlaneGeometry(2, 1, 1, REED_SEGS);
  strip.translate(0, 0.5, 0);
  const g = new THREE.InstancedBufferGeometry();
  g.index = strip.index;
  g.setAttribute("position", strip.getAttribute("position"));
  const root = new Float32Array(REEDS.count * 4);
  const blade = new Float32Array(REEDS.count * 4);
  for (let i = 0; i < REEDS.count; i++) {
    const b = reedBlade(i);
    root.set([b.x, b.y, b.z, b.seed], i * 4);
    blade.set([b.h, b.w, b.lean, b.kind], i * 4);
  }
  g.setAttribute("aRoot", new THREE.InstancedBufferAttribute(root, 4));
  g.setAttribute("aBlade", new THREE.InstancedBufferAttribute(blade, 4));
  g.instanceCount = REEDS.count;
  strip.dispose();
  return g;
}

// ---------------------------------------------------------------------------
// GLSL

export const TRUNK_VERT = /* glsl */ `
  attribute vec4 aMark;
  uniform float uSideFade; // the Ascent fades the left side (its depth scale)
  varying vec4 vMark;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying float vFade;
  void main() {
    vMark = aMark;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vFade = aMark.w < 0.0 ? 1.0 - uSideFade : 1.0;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
export const TRUNK_FRAG = /* glsl */ `
  uniform vec3 uBark;
  uniform vec3 uCrack;
  uniform vec3 uRim;
  uniform float uRimOp;
  uniform vec3 uMoonDir; // world direction toward the moon (Dusk rim)
  uniform float uOpacity;
  varying vec4 vMark;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying float vFade;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    // Plated bark: irregular plates, eight around, each column with its own
    // plate height and offset; the cracks are fine and broken.
    float u = vMark.y * 8.0;
    float colI = floor(u);
    float ph = 10.0 + 8.0 * h21(vec2(colI, 1.0));
    float v = vMark.x / ph + h21(vec2(colI, 7.0));
    float row = floor(v);
    vec2 cell = vec2(fract(u), fract(v));
    vec2 e = min(cell, 1.0 - cell);
    vec2 fw = max(fwidth(vec2(u, v)), vec2(1e-4));
    float cx = (1.0 - smoothstep(0.4, 1.1, e.x / fw.x)) * step(0.3, h21(vec2(colI, row)));
    float cy = (1.0 - smoothstep(0.4, 1.1, e.y / fw.y)) * step(0.25, h21(vec2(colI + 3.0, row)));
    float crack = max(cx, cy);
    float tone = 0.88 + 0.24 * h21(vec2(colI, row + 0.5));
    vec3 col = mix(uBark * tone, uCrack, crack * 0.7);
    // Dusk: a pale rim on the side of the trunk that faces the moon.
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorld);
    float rim = pow(1.0 - abs(dot(N, V)), 2.0) * max(0.0, dot(N, uMoonDir));
    col = mix(col, uRim, clamp(rim * 1.6, 0.0, 1.0) * uRimOp);
    // A key-block line along the trunk's outline.
    float outline = 1.0 - smoothstep(0.12, 0.32, abs(dot(N, V)));
    col = mix(col, uBark * 0.55, outline * 0.6);
    // The base dissolves into the field.
    float a = smoothstep(-40.0, ${f(FLORA_FADE)}, vMark.z) * uOpacity * vFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;

export const CARD_VERT = /* glsl */ `
  attribute vec4 aCard;  // center, width
  attribute vec4 aCard2; // height, seed, kind, side
  uniform vec3 uMoonWorld;
  uniform float uSideFade;
  varying vec2 vP;
  varying vec2 vMoon;
  varying float vTop;
  varying float vSeed;
  varying float vFade;
  void main() {
    vec4 c = modelViewMatrix * vec4(aCard.xyz, 1.0);
    vec4 cu = modelViewMatrix * vec4(aCard.xyz + vec3(0.0, aCard2.x, 0.0), 1.0);
    // The card keeps its flat underside level: its up is the projected world up.
    vec2 up = cu.xy / max(-cu.z, 1.0) - c.xy / max(-c.z, 1.0);
    up = length(up) > 1e-6 ? normalize(up) : vec2(0.0, 1.0);
    vec2 right = vec2(up.y, -up.x);
    vec3 wc = (modelMatrix * vec4(aCard.xyz, 1.0)).xyz;
    float top = smoothstep(0.55, 0.92, abs(normalize(cameraPosition - wc).y));
    vTop = aCard2.z > 0.5 ? 0.0 : top;
    float hw = aCard.w * 0.5;
    float hh = mix(aCard2.x * 0.5, hw * 0.85, vTop);
    vec4 mv = c;
    mv.xy += right * position.x * hw + up * position.y * hh;
    gl_Position = projectionMatrix * mv;
    vP = position.xy;
    vSeed = aCard2.y;
    vFade = aCard2.w < 0.0 ? 1.0 - uSideFade : 1.0;
    // The moon's direction on screen, in the card's frame.
    vec4 m = viewMatrix * vec4(uMoonWorld, 1.0);
    vec2 md = m.xy / max(-m.z, 1.0) - c.xy / max(-c.z, 1.0);
    md = length(md) > 1e-6 ? normalize(md) : vec2(-1.0, 0.0);
    vMoon = vec2(dot(md, right), dot(md, up));
  }
`;

export const CARD_FRAG = /* glsl */ `
  uniform vec3 uPad;
  uniform vec3 uPadDark;
  uniform vec3 uLine;
  uniform float uLineOp;
  uniform vec3 uRim;
  uniform float uRimOp;
  uniform float uOpacity;
  uniform float uKind;
  varying vec2 vP;
  varying vec2 vMoon;
  varying float vTop;
  varying float vSeed;
  varying float vFade;
  float sdEll(vec2 p, vec2 r) { return (length(p / r) - 1.0) * min(r.x, r.y); }
  void main() {
    vec2 p = vP;
    float px = max(fwidth(p.x) + fwidth(p.y), 1e-4) * 0.7071;
    float sd;
    vec3 col;
    float rimEdge = 0.0;
    if (uKind < 0.5) {
      // Fan pad: a flat underside and an irregular crown of needle clusters
      // (scalloped lobes, each a fan of needles in ink).
      float yb = -0.42 + 0.12 * p.x * p.x;
      float crown = -0.42 + 1.2 * pow(max(0.0, 1.0 - p.x * p.x), 0.6);
      for (int i = 0; i < 3; i++) {
        float c = (fract(vSeed * (3.7 + float(i) * 2.3)) - 0.5) * 1.3;
        crown += 0.16 * exp(-pow((p.x - c) / 0.24, 2.0)) - 0.05;
      }
      float q = p.x * 4.2 + vSeed * 7.0;
      float li = floor(q);
      float lf = fract(q) - 0.5;
      float lr = 0.75 + 0.5 * fract(sin(li * 12.9898 + vSeed * 78.233) * 43758.5453);
      float yt = crown - 0.15 * lr * (1.0 - sqrt(max(0.0, 1.0 - 4.0 * lf * lf)));
      float sdFan = max(max(yb - p.y, p.y - yt), abs(p.x) - 1.0);
      // From above: a round scalloped clump.
      float ang = atan(p.y, p.x);
      float sdRound = length(p) - 0.82 + 0.08 * (1.0 - abs(cos(ang * 3.5 + vSeed * 5.0)));
      sd = mix(sdFan, sdRound, vTop);
      float under = smoothstep(0.1, -0.42, p.y) * (1.0 - vTop);
      col = mix(uPad, uPadDark, under);
      // Needles: each lobe is a fan of fine ink strokes from a point under it.
      vec2 o = vec2((li + 0.5 - vSeed * 7.0) / 4.2, crown - 0.5);
      vec2 v = p - o;
      float fa = atan(v.x, max(v.y, 1e-3)) * 5.0;
      float fd = abs(fract(fa) - 0.5) * 2.0; // 1 on a needle, 0 between
      float fwa = max(fwidth(fa), 1e-3) * 2.0;
      float needle = smoothstep(1.0 - 1.4 * fwa, 1.0 - 0.4 * fwa, fd) * step(0.0, v.y);
      needle *= smoothstep(0.12, 0.3, length(v)) * (1.0 - vTop);
      col = mix(col, uLine, needle * uLineOp * 0.55);
      // Key line on the crown and a darker line along the flat underside.
      float key = 1.0 - smoothstep(0.6 * px, 1.6 * px, -sd);
      col = mix(col, uLine, key * uLineOp);
      rimEdge = 1.0 - smoothstep(0.6 * px, 2.0 * px, -sd);
      rimEdge *= smoothstep(0.25, 0.85, dot(normalize(vec2(p.x, (p.y + 0.2) * 1.4)), vMoon)) * step(-0.15, p.y);
    } else {
      // A distant pine: a trunk stroke and three stacked pads.
      float tr = max(abs(p.x) - 0.06, abs(p.y + 0.1) - 0.9);
      float t1 = sdEll(p - vec2(0.02, 0.62), vec2(0.42, 0.13));
      float t2 = sdEll(p - vec2(0.08, 0.26), vec2(0.66, 0.15));
      float t3 = sdEll(p - vec2(-0.06, -0.12), vec2(0.8, 0.15));
      sd = min(min(tr, t1), min(t2, t3));
      col = uPad;
    }
    col = mix(col, uRim, clamp(rimEdge, 0.0, 1.0) * uRimOp);
    float a = clamp(0.5 - sd / px, 0.0, 1.0) * uOpacity * vFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;

export const REED_VERT = /* glsl */ `
  attribute vec4 aRoot;  // x, y, z, seed
  attribute vec4 aBlade; // height, width, lean, kind
  uniform float uTime;
  uniform float uSideFade;
  varying vec2 vUv;
  varying float vKind;
  varying float vFade;
  const float TAU = 6.28318530718;
  float bladeAngle(float s, float lean, float kind, float sway) {
    // Leaves arch over; panicle stems stand, then their heads droop.
    float bend = kind < 0.5 ? 0.9 * sign(lean) * s * s : 0.2 * sign(lean) * s;
    float droop = kind > 0.5 ? 1.9 * sign(lean) * smoothstep(0.7, 1.0, s) : 0.0;
    return lean + bend + droop + sway * s * s;
  }
  void main() {
    float s = position.y;
    float x = position.x * 0.5; // -0.5..0.5 across
    float h = aBlade.x;
    float lean = aBlade.z;
    float kind = aBlade.w;
    float sway = ${f(REEDS.sway)} * (sin(uTime * TAU / ${f(REEDS.pSway0)} + aRoot.w * 6.0)
      + 0.6 * sin(uTime * TAU / ${f(REEDS.pSway1)} + aRoot.w * 11.0));
    // Integrate the centerline (side offset, height).
    vec2 c = vec2(0.0);
    const int N = ${REED_SEGS};
    float ds = s / float(N);
    for (int i = 0; i < N; i++) {
      float th = bladeAngle((float(i) + 0.5) * ds, lean, kind, sway);
      c += vec2(sin(th), cos(th)) * h * ds;
    }
    // Width: leaves taper from the root; stems stay thin, panicles swell.
    float w = aBlade.y;
    float width = kind < 0.5 ? w * pow(1.0 - s, 0.7) * (0.55 + 0.45 * smoothstep(0.0, 0.2, s))
      : mix(w * 0.45, w * 1.5 * sin(3.14159 * clamp((s - 0.7) / 0.3, 0.0, 1.0)), step(0.7, s));
    vec3 root = aRoot.xyz;
    vec3 camL = cameraPosition - (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 toCam = camL - root;
    vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), vec3(toCam.x, 0.0, toCam.z) + vec3(1e-4, 0.0, 0.0)));
    vec3 p = root + side * (c.x + x * width) + vec3(0.0, c.y, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    vUv = vec2(position.x, s);
    vKind = kind;
    vFade = 1.0 - uSideFade;
  }
`;
export const REED_FRAG = /* glsl */ `
  uniform vec3 uStem;
  uniform vec3 uPlume;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vKind;
  varying float vFade;
  void main() {
    float fw = max(fwidth(vUv.x), 1e-4);
    float a = clamp((1.0 - abs(vUv.x)) / fw, 0.0, 1.0);
    // Blades thinner than a pixel keep their line and thin their ink.
    a *= clamp(1.0 / fw, 0.35, 1.0);
    vec3 col = mix(uStem, uPlume, vKind * smoothstep(0.68, 0.76, vUv.y));
    a *= smoothstep(0.0, 0.3, vUv.y) * uOpacity * vFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;
