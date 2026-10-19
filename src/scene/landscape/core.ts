// Hanga landscape, shared core: the integer hash, seamless periodic value
// noise, the ridge rings, the quiet easing, and the GLSL chunks every part of
// the landscape uses. Every pure function here mirrors its GLSL one for one.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** A GLSL float literal. */
export const f = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));

// ---------------------------------------------------------------------------
// Integer hash and seamless periodic value noise (mirrors NOISE_GLSL).

/** 32-bit integer hash of (seed, i) to [0, 1). i and seed must be >= 0. */
export function lhash(seed: number, i: number): number {
  let h = (Math.imul(i >>> 0, 0x9e3779b1) + Math.imul(seed >>> 0, 0x85ebca77)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return (h >>> 8) / 16777216;
}
const crom = (p0: number, p1: number, p2: number, p3: number, t: number): number =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

/** Periodic value noise over u in turns: Catmull-Rom between N hashed lattice
 *  values, so u = 0 and u = 1 meet exactly. */
export function pnoise(u: number, N: number, seed: number): number {
  const x = (((u % 1) + 1) % 1) * N;
  const i = Math.min(Math.floor(x), N - 1);
  const t = x - i;
  const s = seed * 977 + N;
  return crom(lhash(s, (i - 1 + N) % N), lhash(s, i), lhash(s, (i + 1) % N), lhash(s, (i + 2) % N), t);
}

export const NOISE_GLSL = /* glsl */ `
  float lhash(int seed, int i) {
    uint h = uint(i) * 0x9E3779B1u + uint(seed) * 0x85EBCA77u;
    h ^= h >> 15u; h *= 0x2C1B3C6Du; h ^= h >> 12u; h *= 0x297A2D39u; h ^= h >> 15u;
    return float(h >> 8u) / 16777216.0;
  }
  float crom(float p0, float p1, float p2, float p3, float t) {
    return 0.5 * (2.0 * p1 + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t
      + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t * t * t);
  }
  float pnoise(float u, int N, int seed) {
    float x = fract(u) * float(N);
    int i = min(int(floor(x)), N - 1);
    float t = x - float(i);
    int s = seed * 977 + N;
    return crom(lhash(s, (i - 1 + N) % N), lhash(s, i), lhash(s, (i + 1) % N), lhash(s, (i + 2) % N), t);
  }
`;

/** Anti-aliased coverage of a signed distance (negative inside), in pixels. */
export const SDF_GLSL = /* glsl */ `
  float cover(float sd, float px) { return clamp(0.5 - sd / px, 0.0, 1.0); }
  // Signed distance to a capsule from a (radius ra) to b (radius rb).
  float sdCapsule(vec2 p, vec2 a, vec2 b, float ra, float rb) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    return length(pa - ba * h) - mix(ra, rb, h);
  }
  // Approximate signed distance to an axis-aligned ellipse.
  float sdEllipse(vec2 p, vec2 r) {
    float k = length(p / r);
    return (k - 1.0) * min(r.x, r.y);
  }
`;

// ---------------------------------------------------------------------------
// Ridge rings. Ring azimuth theta = 0 points to -z (straight ahead at the home
// view) and grows toward +x. World units, relative to the pose-0 map center.

export interface RingSpec {
  /** Radius of the wall. */
  R: number;
  /** Lowest silhouette height. */
  top: number;
  /** Silhouette rise above `top` (the shaped noise reaches 1.15 x amp at most). */
  amp: number;
  /** Value-noise cells per 360 degrees (first octave). */
  lattice: number;
  octaves: number;
  seed: number;
  /** Mist fade: full color above top + 10, alpha 0 at top - fadeSpan. */
  fadeSpan: number;
}

/** Four rings, near to far. Preview amplitudes x1.6, tops raised. */
export const RINGS: readonly RingSpec[] = [
  { R: 1500, top: -400, amp: 240, lattice: 26, octaves: 3, seed: 11, fadeSpan: 270 },
  { R: 2050, top: -305, amp: 224, lattice: 21, octaves: 3, seed: 23, fadeSpan: 170 },
  { R: 2550, top: -220, amp: 200, lattice: 17, octaves: 2, seed: 37, fadeSpan: 140 },
  { R: 3050, top: -150, amp: 168, lattice: 13, octaves: 2, seed: 41, fadeSpan: 140 },
];
/** Height of the crest bokashi band below the silhouette. */
export const CREST_DEPTH = 110;
export const FLOOR_Y = -760;

/** Silhouette height of a ring at azimuth theta (radians). */
export function ridgeHeight(ring: RingSpec, theta: number): number {
  const u = theta / TAU;
  let s = 0;
  let a = 1;
  let tot = 0;
  let n = ring.lattice;
  for (let o = 0; o < ring.octaves; o++) {
    s += a * pnoise(u, n, ring.seed * 7 + o);
    tot += a;
    a *= 0.38;
    n *= 2;
  }
  const v = Math.min(1, Math.max(0, s / tot));
  const swell = 0.55 + 0.45 * pnoise(u, Math.max(3, Math.floor((ring.lattice + 2) / 4)), ring.seed * 13 + 5);
  const shaped = Math.pow(v, 1.35) * swell;
  return ring.top + ring.amp * Math.min(1.15, Math.max(0, shaped / 0.68));
}
/** Highest possible crest of a ring (the shaping clamp). */
export const ringCeiling = (ring: RingSpec): number => ring.top + ring.amp * 1.15;

/** Dry-brush crest: how much crest ink survives at depth d below the crest
 *  (world units) for the two noise samples nEdge (ragged lower edge) and
 *  nHair (horizontal brush hairs), both in [0, 1]. At the crest itself the ink
 *  is solid, so the deepest crest color (the contrast gate) never changes. */
export function crestInk(d: number, nEdge: number, nHair: number): number {
  const reach = CREST_DEPTH * (0.7 + 0.55 * nEdge);
  const t = Math.min(1, Math.max(0, d / reach));
  const k = 1 - t * t * (3 - 2 * t);
  const hair = Math.min(1, Math.max(0, (nHair - 0.28) / 0.34));
  const dry = 1 - (1 - hair) * 0.75 * (1 - k);
  return k * k * dry;
}

// ---------------------------------------------------------------------------
// Quiet easing: a linear ramp over QUIET_EASE seconds, shaped by a smoothstep
// where it is applied.
export const QUIET_EASE = 2;
export function easeQuiet(cur: number, target: number, dt: number): number {
  const step = Math.max(0, dt) / QUIET_EASE;
  return cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);
}
export const smooth01 = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
export const smoothstep = (a: number, b: number, x: number): number => smooth01((x - a) / (b - a));

// ---------------------------------------------------------------------------
// The home cameras, relative to the landscape center, as measured in the app
// (level, vertical fov 50): viewport, camera height, camera distance. The tests
// and the placement rules of the pines and reeds use them.
export const HOME_VIEWS: readonly { w: number; h: number; camY: number; camZ: number }[] = [
  { w: 1440, h: 900, camY: -5, camZ: 918 },
  { w: 1280, h: 720, camY: -10, camZ: 889 },
  { w: 1024, h: 600, camY: -17, camZ: 909 },
];
/** Pinhole projection of a landscape-local point for a home view, in CSS px,
 *  or null behind the camera. */
export function projectHome(v: { w: number; h: number; camY: number; camZ: number }, x: number, y: number, z: number): [number, number] | null {
  const D = v.camZ - z;
  if (D <= 1) return null;
  const k = v.h / 2 / Math.tan(25 * DEG);
  return [v.w / 2 + (x / D) * k, v.h / 2 - ((y - v.camY) / D) * k];
}
/** The map's radius in the xz plane (nodes' bounds at pose 0, plus a margin). */
export const MAP_RADIUS = 560;
