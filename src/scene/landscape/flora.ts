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
import { DEG, FLOOR_Y, RINGS, TAU, f, lhash, ridgeHeight } from "./core";

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
  /** -1 left of the map at the home view (it fades at the Ascent), +1 right,
   *  0 elsewhere. */
  side: number;
}

/** The soft base of a trunk or a reed: the height over which it fades into
 *  the bank it grows from. */
export const FLORA_FADE = 24;

// ---------------------------------------------------------------------------
// Banks: low ink mounds that rise out of the water floor, so every pine and
// the reed bank grow out of the ground. Each is an ellipse in the xz plane
// (rx along `rot`, rz across it) with a flat top that rolls down to the
// waterline, where a dark strip of bank prints (Hiroshige's shore line).

export interface BankSpec {
  x: number;
  z: number;
  /** Half-axes (world units) and the rx axis's angle from +x (radians). */
  rx: number;
  rz: number;
  rot: number;
  /** Height of the flat top. */
  top: number;
}
/** Share of the half-axes that stays flat before the bank rolls down. */
export const BANK_FLAT = 0.45;
/** The dark strip at the waterline: the outer share of the bank's half-axes. */
export const BANK_STRIP = 0.12;

/** The water's height under the landscape (core.ts FLOOR_Y). */
const WATER_Y = FLOOR_Y;

/** The reed bank's mound: on the far shore, left of the map at home. */
const REED_BANK: BankSpec = { x: -960, z: -960, rx: 240, rz: 105, rot: -45 * DEG, top: -680 };

export const BANKS: readonly BankSpec[] = [
  REED_BANK,
  // Under the two framing pines.
  { x: -1090, z: -380, rx: 175, rz: 120, rot: 20 * DEG, top: -700 },
  { x: 1090, z: -330, rx: 175, rz: 120, rot: -20 * DEG, top: -700 },
  // The middle-ground groups (MID_PINES).
  { x: -1170, z: 430, rx: 180, rz: 100, rot: -30 * DEG, top: -725 },
  { x: 1080, z: 560, rx: 170, rz: 95, rot: 35 * DEG, top: -728 },
];

/** The bank's irregular outline: the waterline radius at angle a (radians,
 *  in the bank's own frame) as a share of the ellipse, so no bank prints as a
 *  perfect ellipse. */
export function bankLobe(b: BankSpec, a: number): number {
  const p = (b.x * 0.013 + b.z * 0.007) % TAU;
  return 1 + 0.15 * Math.sin(3 * a + p) + 0.07 * Math.sin(5 * a + 2 * p);
}
/** Radius (0 at the center, 1 at the waterline) of (x, z) on a bank. */
export function bankU(b: BankSpec, x: number, z: number): number {
  const dx = x - b.x;
  const dz = z - b.z;
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const u = (dx * c + dz * s) / b.rx;
  const v = (-dx * s + dz * c) / b.rz;
  return Math.hypot(u, v) / bankLobe(b, Math.atan2(v, u));
}
/** Height of the bank's profile at elliptical radius u (u >= 1: the water). */
export function bankProfile(b: BankSpec, u: number): number {
  if (u >= 1) return WATER_Y;
  const t = u <= BANK_FLAT ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (u - BANK_FLAT)) / (1 - BANK_FLAT));
  return WATER_Y + (b.top - WATER_Y) * t;
}
/** The ground height at (x, z): the highest bank there, or the water. */
export function groundAt(x: number, z: number): number {
  let y = WATER_Y;
  for (const b of BANKS) y = Math.max(y, bankProfile(b, bankU(b, x, z)));
  return y;
}

// ---------------------------------------------------------------------------
// Pines.

const FRAME_LEFT: PineSpec = {
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
};
const FRAME_RIGHT: PineSpec = {
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
};

/** The same tree rooted lower: the crown keeps its place in the world and the
 *  trunk runs down to the new root. */
export function rerootPine(p: PineSpec, base: number): PineSpec {
  const d = p.base - base;
  return {
    ...p,
    base,
    trunk: p.trunk.map(([x, y, z], i) => (i === 0 ? [x, y, z] : [x, y + d, z])),
    pads: p.pads.map(([x, y, z, w, h]) => [x, y + d, z, w, h]),
  };
}
/** A smaller copy of a tree, mirrored in x when `mirror` is true, at a root. */
export function scalePine(p: PineSpec, x: number, z: number, base: number, s: number, mirror: boolean, side = 0): PineSpec {
  const m = mirror ? -1 : 1;
  return {
    x,
    z,
    base,
    r0: p.r0 * Math.max(0.6, s),
    trunk: p.trunk.map(([dx, dy, dz]) => [dx * s * m + 0, dy * s, dz * s + 0]),
    branches: p.branches.map(([i, ex, ey, ez]) => [i, ex * s * m, ey * s, ez * s]),
    pads: p.pads.map(([dx, dy, dz, w, h]) => [dx * s * m, dy * s, dz * s, w * s, h * s]),
    side,
  };
}

/** The two framing pines, rooted on their banks. */
export const FRAME_PINES: readonly PineSpec[] = [
  rerootPine(FRAME_LEFT, groundAt(FRAME_LEFT.x, FRAME_LEFT.z)),
  rerootPine(FRAME_RIGHT, groundAt(FRAME_RIGHT.x, FRAME_RIGHT.z)),
];

/** The middle ground: groups of smaller pines on the reed bank, on two shore
 *  banks, and on the first ridge's crest, at a range of sizes. Placed so none
 *  crosses the title block, the search rail, the Style card, the pose control,
 *  or the map body at the home view (tests/landscape.test.ts). */
export interface MidPineSite {
  x: number;
  z: number;
  /** The root height, or null to read it from the banks. */
  y: number | null;
  s: number;
  mirror: boolean;
  side: number;
}
const ridgeSite = (azDeg: number, s: number, mirror: boolean): MidPineSite => {
  const th = azDeg * DEG;
  const R = RINGS[0].R - 12;
  return { x: R * Math.sin(th), z: -R * Math.cos(th), y: ridgeHeight(RINGS[0], th) - 14, s, mirror, side: azDeg < -30 ? -1 : 0 };
};
export const MID_PINE_SITES: readonly MidPineSite[] = [
  // On the reed bank's flat top, behind the reeds.
  { x: -1018, z: -934, y: null, s: 0.4, mirror: true, side: -1 },
  // A pair on the first ridge's crest, at the left edge, in front of Fuji's foot.
  ridgeSite(-58, 0.34, false),
  ridgeSite(-61.5, 0.24, false),
  // A shore bank behind the left of the home view (seen on orbit).
  { x: -1170, z: 430, y: null, s: 0.62, mirror: false, side: 0 },
  // A shore bank behind the right of the home view (seen on orbit).
  { x: 1080, z: 560, y: null, s: 0.55, mirror: true, side: 0 },
  // One on the first ridge's crest, right side, seen on orbit.
  ridgeSite(98, 0.38, true),
];
export const MID_PINES: readonly PineSpec[] = MID_PINE_SITES.map((st, i) =>
  scalePine(i % 2 === 0 ? FRAME_LEFT : FRAME_RIGHT, st.x, st.z, st.y ?? groundAt(st.x, st.z), st.s, st.mirror, st.side),
);

export const PINES: readonly PineSpec[] = [...FRAME_PINES, ...MID_PINES];

/** The reed bank's blades: their roots spread over the flat top of its mound. */
export const REEDS = {
  count: 150,
  /** The bank the reeds grow from (BANKS[0]), and the share of its half-axes
   *  they cover. */
  bank: 0,
  spread: 0.46,
  /** Blade heights. */
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
  const b = BANKS[REEDS.bank];
  const u = lhash(601, i) * 2 - 1;
  const v = lhash(602, i) * 2 - 1;
  // Denser and taller toward the bank's middle.
  const mid = 1 - Math.abs(u);
  const kind = lhash(605, i) < REEDS.panicle ? 1 : 0;
  const lu = u * b.rx * REEDS.spread;
  const lv = v * b.rz * REEDS.spread * Math.sqrt(Math.max(0, 1 - u * u));
  const x = b.x + lu * Math.cos(b.rot) - lv * Math.sin(b.rot);
  const z = b.z + lu * Math.sin(b.rot) + lv * Math.cos(b.rot);
  return {
    x,
    // Rooted a little into the bank, so no stem floats.
    y: groundAt(x, z) - 4,
    z,
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
  /** The framing pines, the middle-ground pines, or the reeds. */
  group: "frame" | "mid" | "reed";
}
/** Points that bound every visible framing element (trunks above their soft
 *  base, sampled along each segment, branch ends, pads, reed tips and stems),
 *  for the placement tests. */
export function floraSamples(): FloraSample[] {
  const out: FloraSample[] = [];
  PINES.forEach((p, pi) => {
    const group = pi < FRAME_PINES.length ? "frame" : "mid";
    for (let k = 1; k < p.trunk.length; k++) {
      const [ax, ay, az] = p.trunk[k - 1];
      const [bx, by, bz] = p.trunk[k];
      for (let j = 0; j <= 6; j++) {
        const t = j / 6;
        const dy = ay + (by - ay) * t;
        if (dy < FLORA_FADE) continue;
        out.push({ x: p.x + ax + (bx - ax) * t, y: p.base + dy, z: p.z + az + (bz - az) * t, hw: p.r0, hh: 0, kind: "trunk", side: p.side, group });
      }
    }
    for (const [ti, ex, ey, ez] of p.branches) {
      const [dx, dy, dz] = p.trunk[ti];
      out.push({ x: p.x + dx + ex, y: p.base + dy + ey, z: p.z + dz + ez, hw: 6, hh: 0, kind: "trunk", side: p.side, group });
    }
    for (const [dx, dy, dz, w, h] of p.pads) {
      out.push({ x: p.x + dx, y: p.base + dy, z: p.z + dz, hw: w / 2, hh: h / 2, kind: "pad", side: p.side, group });
    }
  });
  for (let i = 0; i < REEDS.count; i++) {
    const b = reedBlade(i);
    out.push({ x: b.x, y: b.y + b.h, z: b.z, hw: b.h * 0.35, hh: 4, kind: "reed", side: -1, group: "reed" });
    out.push({ x: b.x, y: b.y + b.h * 0.3, z: b.z, hw: 4, hh: 4, kind: "reed", side: -1, group: "reed" });
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
    pts.unshift(new THREE.Vector3(p.x, p.base - 20, p.z));
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

/** Every bank in one indexed geometry: rings of an ellipse, with the height
 *  from bankProfile. aBank: (height above the water, elliptical radius). */
export function buildBanks(): THREE.BufferGeometry {
  const pos: number[] = [];
  const att: number[] = [];
  const idx: number[] = [];
  const NR = 14;
  const NS = 64;
  for (const b of BANKS) {
    const start = pos.length / 3;
    const c = Math.cos(b.rot);
    const sn = Math.sin(b.rot);
    for (let i = 0; i <= NR; i++) {
      const u = i / NR;
      for (let j = 0; j <= NS; j++) {
        const a = (j / NS) * TAU;
        const lobe = bankLobe(b, a);
        const lu = u * lobe * b.rx * Math.cos(a);
        const lv = u * lobe * b.rz * Math.sin(a);
        const x = b.x + lu * c - lv * sn;
        const z = b.z + lu * sn + lv * c;
        const y = bankProfile(b, Math.min(u, 0.9999));
        pos.push(x, u >= 1 ? FLOOR_Y : y, z);
        att.push((u >= 1 ? FLOOR_Y : y) - FLOOR_Y, u);
      }
    }
    for (let i = 0; i < NR; i++) {
      for (let j = 0; j < NS; j++) {
        const a = start + i * (NS + 1) + j;
        const d = a + NS + 1;
        idx.push(a, a + 1, d, a + 1, d + 1, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aBank", new THREE.Float32BufferAttribute(att, 2));
  g.setIndex(idx);
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
    float a = smoothstep(-12.0, ${f(FLORA_FADE)}, vMark.z) * uOpacity * vFade;
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
    a *= smoothstep(0.0, 0.06, vUv.y) * uOpacity * vFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;

export const BANK_VERT = /* glsl */ `
  attribute vec2 aBank;
  varying vec2 vBank;
  void main() {
    vBank = aBank;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
export const BANK_FRAG = /* glsl */ `
  uniform vec3 uBank;
  uniform vec3 uBankTop;
  uniform vec3 uStrip;
  uniform float uOpacity;
  varying vec2 vBank;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    float h = vBank.x;
    // Flat bokashi: the top a shade lighter, the body, then the dark strip of
    // bank at the waterline (a hard print edge, anti-aliased).
    vec3 col = mix(uBank, uBankTop, smoothstep(0.2, 0.9, 1.0 - vBank.y));
    // The dark strip of bank at the waterline, printed as a bokashi that
    // deepens toward the water, then the foot melts into the water itself.
    float strip = smoothstep(${f(1 - 2.2 * BANK_STRIP)}, ${f(1 - 0.3 * BANK_STRIP)}, vBank.y);
    col = mix(col, uStrip, strip * 0.85);
    float a = (1.0 - smoothstep(0.965, 1.0, vBank.y)) * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;
