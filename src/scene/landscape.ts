// Hanga landscape: the 3D world around the map in the two woodblock styles
// (3 Washi, 4 Dusk), after Utagawa Hiroshige. Built from the approved previews
// (scripts/hanga-landscape-previews.mjs, docs/previews/hanga-*-landscape-*.svg),
// with the designer's "more landscape" pass: taller ridges (amplitude x1.6,
// raised tops, so the far crests reach about the map's vertical center at the
// home view) and a peak 1.5x larger.
//
// Parts, far to near (each is one draw call, drawn in that order):
//   sky body   the Washi sun or the Dusk moon, a camera-facing disc and halo
//   peak       one calm volcanic cone (lathe geometry) at a fixed azimuth just
//              beyond the far ring: pale cap with soft snow tongues, a hairline
//              contour on the upper outline, a slow waterfall dash
//   birds      Washi: one flight of cranes. Dusk: one murmuration of starlings.
//   ring 4..1  concentric cylinder walls. The silhouette is computed per
//              fragment from seamless periodic value noise over azimuth, with a
//              darker crest bokashi band and a fade to mist at the base
//   mist       suyari-gasumi bands between the rings, filled with the exact
//              field color behind them (HANGA_FIELD_GLSL), drifting slowly
//   floor      a faint water plane well below the map, with fine wave lines
//              near the far shore
//
// Legibility: the map stays the subject. Every color the strokes can cross
// (ring body, crest band) keeps a contrast ratio of 2.5 or more against the
// Washi gold and teal pigments (tests/landscape.test.ts). The Washi peak uses the
// preview sheet's colors as chosen, without a gate.
//
// Motion: every period is several seconds or longer and nothing pulses in
// brightness. `quiet` (a story or a focus) fades the birds out over about 2 s.
// Reduced motion freezes the water, mist, and waterfall at a fixed phase and
// hides the birds. The group is invisible outside styles 3 and 4, so the
// Galaxy and the other styles draw nothing from here.
//
// The pure math below (noise, schedule, easing, flock bounds, contrast) mirrors
// the GLSL one for one and is exported for the tests.

import * as THREE from "three";
import { HANGA } from "./artstyle";
import { HANGA_FIELD_GLSL, HANGA_SCREEN_UNIFORMS, SHELL_RADIUS } from "./environs";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Model constants (world units, relative to the pose-0 map center).
// Ring azimuth theta = 0 points to -z (straight ahead at the home view) and
// grows toward +x.

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

/** The cone: the preview's profile at 1.5x scale. Radius grows with depth below
 *  the summit as a power above 1 (concave flanks, small flat crater). */
export const PEAK = {
  az: -33 * DEG,
  R: 3400,
  apex: 420,
  rTop: 93,
  p: 1.38,
  /** Half-width 900 at 495 below the summit. */
  halfW: 900,
  halfD: 495,
  dMax: 1425,
  snow: 132,
  /** The flank fades to the field over this depth range. */
  fade0: 450,
  fade1: 840,
} as const;
export const peakRadius = (d: number): number =>
  PEAK.rTop + ((PEAK.halfW - PEAK.rTop) / Math.pow(PEAK.halfD, PEAK.p)) * Math.pow(Math.max(0, d), PEAK.p);

/** Sun (Washi) or moon (Dusk): the preview's azimuth and distance (the old star
 *  shell), set lower than the preview's 9.5 deg so the disc clears the Ascent's
 *  depth label and the title block at the left edge. */
export const SKY_BODY = { az: -40 * DEG, el: 5 * DEG, dist: 3600, r: 66 } as const;

/** Suyari-gasumi bands, four per gap. az/halfSpan in radians, h/th in world units. */
export interface MistBand {
  az: number;
  halfSpan: number;
  h: number;
  th: number;
}
export interface MistRing {
  R: number;
  /** Full turns per second (signed). */
  rate: number;
  bands: MistBand[];
}
const band = (azDeg: number, spanDeg: number, h: number, th: number): MistBand => ({
  az: azDeg * DEG,
  halfSpan: spanDeg * DEG,
  h,
  th,
});
export const MIST_RINGS: readonly MistRing[] = [
  // between ring 3 and ring 4 (covers the far ring's lower slopes)
  { R: 2800, rate: 1 / 1500, bands: [band(14, 30, -196, 36), band(118, 22, -186, 30), band(205, 34, -200, 38), band(290, 20, -190, 30)] },
  // between ring 2 and ring 3
  { R: 2300, rate: -1 / 1800, bands: [band(-10, 24, -268, 39), band(44, 16, -276, 34), band(150, 28, -262, 38), band(240, 20, -272, 34)] },
  // between ring 1 and ring 2
  { R: 1780, rate: 1 / 2100, bands: [band(22, 20, -378, 46), band(100, 26, -370, 42), band(196, 18, -384, 40), band(312, 24, -374, 44)] },
];

// ---------------------------------------------------------------------------
// Integer hash and seamless periodic value noise (mirrors the GLSL below).

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

// ---------------------------------------------------------------------------
// Cranes (Washi): one flight crosses the far sky in CRANE.crossing seconds,
// then the sky stays empty for a gap hashed from the crossing index.

export const CRANE = {
  first: 18, // the first flight starts 18 s after the clock starts
  crossing: 40,
  gapMin: 50,
  gapSpan: 40, // gap in [50, 90)
  wingPeriod: 2.5,
  R: 3380,
  RSpan: 160,
  h: 1240,
  hSpan: 70,
  halfArc: 54 * DEG,
  centerSpan: 26 * DEG,
  /** Silhouette scale: about 16 px nose to toe and 14 to 18 px across the wings
   *  at the home view (the crossing is about 4300 units from the camera). */
  size: 46,
  /** Wing lengths in silhouette units: the arm to the wrist, then the hand. */
  arm: 0.5,
  hand: 0.78,
  maxCount: 5,
} as const;
export const craneGap = (k: number): number => CRANE.gapMin + CRANE.gapSpan * lhash(911, k);

export interface CraneState {
  index: number;
  start: number;
  progress: number;
  visible: boolean;
}
/** Which crossing owns time t, and how far along it is. Writes into `out`. */
export function craneScheduleInto(t: number, out: CraneState, from?: { index: number; start: number }): CraneState {
  let k = 0;
  let start: number = CRANE.first;
  if (from && from.start <= t) {
    k = from.index;
    start = from.start;
  }
  while (t >= start + CRANE.crossing + craneGap(k)) {
    start += CRANE.crossing + craneGap(k);
    k++;
  }
  out.index = k;
  out.start = start;
  out.progress = (t - start) / CRANE.crossing;
  out.visible = out.progress >= 0 && out.progress <= 1;
  return out;
}
export const craneSchedule = (t: number): CraneState =>
  craneScheduleInto(t, { index: 0, start: 0, progress: 0, visible: false });

export interface CranePath {
  az0: number;
  az1: number;
  R: number;
  h0: number;
  h1: number;
  count: number;
}
/** The path of crossing k: an arc of the far sky, alternating direction. */
export function cranePathInto(k: number, out: CranePath): CranePath {
  const c = (lhash(921, k) - 0.5) * 2 * CRANE.centerSpan;
  const dir = k % 2 === 0 ? 1 : -1;
  out.az0 = c - dir * CRANE.halfArc;
  out.az1 = c + dir * CRANE.halfArc;
  out.R = CRANE.R + lhash(922, k) * CRANE.RSpan;
  out.h0 = CRANE.h + (lhash(923, k) - 0.5) * 2 * CRANE.hSpan;
  out.h1 = CRANE.h + (lhash(924, k) - 0.5) * 2 * CRANE.hSpan;
  out.count = 3 + Math.min(2, Math.floor(lhash(925, k) * 3));
  return out;
}
/** Formation slots: lag along the path (fraction), rise (world units), wing phase. */
export const CRANE_SLOTS: readonly [number, number, number][] = [
  [0, 0, 0.0],
  [0.012, 40, 0.31],
  [0.015, -36, 0.67],
  [0.025, 78, 0.12],
  [0.03, -70, 0.83],
];

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

// ---------------------------------------------------------------------------
// Murmuration (Dusk): a dispersed cloud of specks, not one shape. Three
// sub-flocks ride their own slow centers around the main center, so they split
// and merge over 30 to 60 s. Inside each sub-flock a seed ball, flattened to a
// sheet, is folded by bounded sums of sines. Every speck adds its own slow
// jitter (periods 20 to 40 s), so no two specks share a path. Part of the time
// a thin band of specks streams between sub-flocks 0 and 1. All of it runs in
// the vertex shader. The functions below mirror it one for one.

export const MURM = {
  count: 880,
  // Left of the map at the home view, low over the far ridges, under the moon
  // and against the peak's flank, spreading right behind the lower left of the
  // map. The whole drift envelope stays clear of the title block at 1440x900,
  // 1280x720, and 1024x600 (QA F8) and above every ridge crest seen from the
  // home cameras (tests/landscape.test.ts).
  az: -36 * DEG,
  azSwing: 2 * DEG,
  R: 3440,
  RSwing: 90,
  h: 50,
  hSwing: 8,
  /** The highest any speck may rise (title block clearance at 1024x600). */
  envelopeTop: 165,
  /** Sub-flock half-axes in world units: along the azimuth, up, radial. */
  ax: 220,
  ay: 34,
  az3: 70,
  /** The seed ball is flattened to a sheet, so the warp folds it into ribbons. */
  sheet: 0.7,
  /** Warp amplitudes and periods (seconds). */
  warp1: 0.3,
  warp2: 0.15,
  stretch: 0.2,
  tilt: 0.06,
  pW1: 31,
  pW2: 23,
  pW3: 26,
  pS: 37,
  pTilt: 53,
  pAz1: 97,
  pAz2: 41,
  pR: 73,
  pH: 59,
  /** Sub-flock home azimuths sit subBase apart; each swings by subAz, so two
   *  can merge while the three rarely meet. Then height and radius swings. */
  subBase: 12 * DEG,
  subAz: 3.5 * DEG,
  subH: 34,
  subR: 140,
  /** Per-speck jitter amplitudes (world units) and period range (seconds). */
  jitX: 140,
  jitY: 12,
  jitZ: 40,
  jitP0: 20,
  jitP1: 40,
  /** Share of specks that can join the streaming band, its period, and its
   *  half-thickness in height. */
  streamFrac: 0.18,
  pStream: 90,
  streamTh: 8,
  /** Speck size range in CSS px (by seed). */
  px0: 1.5,
  px1: 3,
} as const;

/** Sub-flock periods (s) and phases for the azimuth, height, and radius swings. */
export const MURM_SUBS: readonly (readonly [number, number, number, number, number, number])[] = [
  [41, 0.0, 59, 1.1, 71, 0.3],
  [53, 2.1, 47, 2.9, 61, 1.9],
  [47, 4.2, 67, 4.4, 83, 3.7],
];

/** The flock center at time t: azimuth (rad), radius, height. Writes into out. */
export function murmurationCenterInto(t: number, out: { az: number; R: number; h: number }): { az: number; R: number; h: number } {
  out.az = MURM.az + MURM.azSwing * (0.65 * Math.sin((t * TAU) / MURM.pAz1) + 0.35 * Math.sin((t * TAU) / MURM.pAz2 + 1.3));
  out.R = MURM.R + MURM.RSwing * Math.sin((t * TAU) / MURM.pR + 0.4);
  out.h = MURM.h + MURM.hSwing * Math.sin((t * TAU) / MURM.pH + 1.0);
  return out;
}
export const murmurationCenter = (t: number): { az: number; R: number; h: number } =>
  murmurationCenterInto(t, { az: 0, R: 0, h: 0 });

/** A sub-flock's offset from the main center: [azimuth (rad), height, radius]. */
export function murmurationSub(k: number, t: number): [number, number, number] {
  const s = MURM_SUBS[k];
  return [
    (k - 1) * MURM.subBase + MURM.subAz * Math.sin((t * TAU) / s[0] + s[1]),
    MURM.subH * Math.sin((t * TAU) / s[2] + s[3]),
    MURM.subR * Math.sin((t * TAU) / s[4] + s[5]),
  ];
}

/** A speck's offset inside its sub-flock, in world units along (tangent, up, radial). */
export function murmurationLocal(p0: readonly [number, number, number], t: number): [number, number, number] {
  let x = p0[0];
  let y = p0[1] * MURM.sheet;
  let z = p0[2];
  const w1 = TAU / MURM.pW1;
  const w2 = TAU / MURM.pW2;
  const w3 = TAU / MURM.pW3;
  const a1 = MURM.warp1;
  const a2 = MURM.warp2;
  let nx = x + a1 * Math.sin(y * 2.1 + t * w1 + 0.3);
  let ny = y + a1 * Math.sin(z * 1.9 + t * w2 + 1.7);
  let nz = z + a1 * Math.sin(x * 2.3 - t * w1 + 2.9);
  x = nx;
  y = ny;
  z = nz;
  nx = x + a2 * Math.sin(z * 3.1 - t * w2 + 4.1);
  ny = y + a2 * Math.sin(x * 2.7 + t * w3 + 0.6);
  nz = z + a2 * Math.sin(y * 3.3 + t * w1 + 5.2);
  const s = 1 + MURM.stretch * Math.sin((t * TAU) / MURM.pS);
  x = nx * s;
  y = ny / Math.sqrt(s);
  z = nz;
  const tl = MURM.tilt * Math.sin((t * TAU) / MURM.pTilt);
  const c = Math.cos(tl);
  const sn = Math.sin(tl);
  const wx = (x * c - y * sn * (MURM.ay / MURM.ax)) * MURM.ax;
  const wy = (x * sn * (MURM.ax / MURM.ay) + y * c) * MURM.ay;
  return [wx, wy, z * MURM.az3];
}

/** One speck's seeds: the seed point and four hashes in [0, 1). */
export interface SpeckSeed {
  p: [number, number, number];
  /** Stream membership (below streamFrac) and alpha variation. */
  g: number;
  /** Place along the stream, and the jitter phase. */
  u: number;
  /** Home sub-flock (0, 1, 2). */
  j: number;
  /** Size, and the jitter period. */
  s: number;
}
export function murmurationSeed(i: number): SpeckSeed {
  const th = lhash(701, i) * TAU;
  const ph = Math.acos(2 * lhash(702, i) - 1);
  const r = Math.cbrt(lhash(703, i));
  return {
    // Uniform along the flock's length (no dense core), a ball across it.
    p: [2 * lhash(708, i) - 1, r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th)],
    g: lhash(704, i),
    u: lhash(705, i),
    j: lhash(706, i),
    s: lhash(707, i),
  };
}

/** How far the streaming band is formed at time t (0 none, 1 full). */
export const murmurationStream = (t: number): number =>
  smooth01((0.5 + 0.5 * Math.sin((t * TAU) / MURM.pStream) - 0.1) / 0.8);

/** Where one speck is at time t: azimuth (rad), radius, height. */
export function murmurationSpeck(seed: SpeckSeed, t: number): { az: number; R: number; h: number } {
  const c = murmurationCenter(t);
  // Stream specks live in the sub-flock at their end of the band (0 or 1).
  const k = seed.g < MURM.streamFrac ? (seed.u < 0.5 ? 0 : 1) : Math.min(2, Math.floor(seed.j * 3));
  const sub = murmurationSub(k, t);
  const loc = murmurationLocal(seed.p, t + k * 17.3);
  const pj = MURM.jitP0 + (MURM.jitP1 - MURM.jitP0) * seed.s;
  const ph = seed.u * TAU;
  const jx = MURM.jitX * Math.sin((t * TAU) / pj + ph);
  const jy = MURM.jitY * Math.sin((t * TAU) / (pj * 1.27) + ph * 3.1);
  const jz = MURM.jitZ * Math.sin((t * TAU) / (pj * 0.83) + ph * 1.7);
  let R = c.R + sub[2] + loc[2] + jz;
  let az = c.az + sub[0] + (loc[0] + jx) / c.R;
  let h = c.h + sub[1] + loc[1] + jy;
  if (seed.g < MURM.streamFrac) {
    const s0 = murmurationSub(0, t);
    const s1 = murmurationSub(1, t);
    const st = murmurationStream(t);
    const sAz = c.az + s0[0] + (s1[0] - s0[0]) * seed.u + (0.25 * jx) / c.R;
    const sH = c.h + s0[1] + (s1[1] - s0[1]) * seed.u + MURM.streamTh * Math.sin(seed.s * 40.0 + (t * TAU) / pj);
    const sR = c.R + s0[2] + (s1[2] - s0[2]) * seed.u + 0.3 * jz;
    az += (sAz - az) * st;
    h += (sH - h) * st;
    R += (sR - R) * st;
  }
  return { az, R, h };
}

// ---------------------------------------------------------------------------
// Palettes (sRGB hex). Washi uses the preview sheet's ridge, crest, and peak
// colors (the designer chose the stronger ridges): Washi gold and teal keep
// 2.5:1 or more on every ring body and crest band (tests/landscape.test.ts).

export interface LandPalette {
  rings: [number, number, number, number];
  crest: number;
  crestOp: [number, number, number, number];
  peak: number;
  peakTop: number;
  cap: number;
  capOp: number;
  peakLine: number;
  peakLineOp: number;
  falls: number;
  fallsOp: number;
  floor: number;
  floorOp: number;
  wave: number;
  waveOp: number;
  /** Sun or moon: disc center, disc edge, halo inner, halo outer. */
  disc0: number;
  disc1: number;
  halo0: number;
  halo1: number;
  haloOp: number;
  discScale: number;
  haloScale: number;
  bird: number;
  birdOp: number;
}

export const LAND: { washi: LandPalette; dusk: LandPalette } = {
  washi: {
    // near (grey-green) to far (pale Prussian blue)
    rings: [0xcbd3c6, 0xcfd8d0, 0xd2dbdb, 0xd6dfe4],
    crest: 0x6d889f, // ridge-top bokashi ink (Prussian grey)
    // Preview opacities 0.20 / 0.18 / 0.16 / 0.14, capped on the two near rings
    // so the deepest crest ink keeps 2.5:1 against Washi gold.
    crestOp: [0.055, 0.13, 0.16, 0.14],
    peak: 0xc9d5df,
    peakTop: 0x9fb4c8,
    cap: 0xf5f3ee,
    capOp: 0.96,
    peakLine: 0x2b4a70,
    peakLineOp: 0.3,
    falls: 0xf8f6f1,
    fallsOp: 0.38,
    floor: 0x9fb2bf,
    floorOp: 0.12,
    wave: 0x2b4a70,
    waveOp: 0.4,
    disc0: 0xe2683e,
    disc1: 0xe57a52,
    halo0: 0xec9a6c,
    halo1: 0xefb88a,
    haloOp: 0.34,
    discScale: 1,
    haloScale: 4.2,
    bird: 0x1c1a17,
    birdOp: 0.8,
  },
  dusk: {
    rings: [0x24365a, 0x2b3e63, 0x33486d, 0x3d5379],
    crest: 0x111d36,
    crestOp: [0.42, 0.36, 0.3, 0.26],
    peak: 0x3b5179,
    peakTop: 0x2a3c60,
    cap: 0x9aa6bf,
    capOp: 0.62,
    peakLine: 0xcdd6e6,
    peakLineOp: 0.16,
    falls: 0xb6bfd3,
    fallsOp: 0.2,
    floor: 0x1b2b4a,
    floorOp: 0.22,
    wave: 0xb8c7de,
    waveOp: 0.3,
    disc0: 0xf1ead8,
    disc1: 0xdcd6c8,
    halo0: 0xd8dfeb,
    halo1: 0x9fb0cc,
    haloOp: 0.2,
    discScale: 0.62,
    haloScale: 4.6,
    bird: 0x0b1324,
    birdOp: 0.46,
  },
};

// Contrast math in the shader's own space: colors blend in LINEAR light.
export const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const hexToLinear = (hex: number): [number, number, number] => [
  srgbToLinear(((hex >> 16) & 255) / 255),
  srgbToLinear(((hex >> 8) & 255) / 255),
  srgbToLinear((hex & 255) / 255),
];
export const luminance = (lin: readonly number[]): number => 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
export function contrast(a: readonly number[], b: readonly number[]): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** The deepest crest-band color of a ring (at the silhouette), linear. */
export function crestLinear(ringHex: number, crestHex: number, op: number): [number, number, number] {
  const a = hexToLinear(ringHex);
  const b = hexToLinear(crestHex);
  return [a[0] + (b[0] - a[0]) * op, a[1] + (b[1] - a[1]) * op, a[2] + (b[2] - a[2]) * op];
}

// ---------------------------------------------------------------------------
// GLSL

const f = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));

const NOISE_GLSL = /* glsl */ `
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

const RING_VERT = /* glsl */ `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const RING_FRAG = /* glsl */ `
  uniform float uTop;
  uniform float uAmp;
  uniform int uLattice;
  uniform int uOct;
  uniform int uSeed;
  uniform float uFade0;
  uniform float uFade1;
  uniform vec3 uColor;
  uniform vec3 uCrest;
  uniform float uCrestOp;
  varying vec3 vLocal;
  ${NOISE_GLSL}
  float ridgeH(float theta) {
    float u = theta / 6.28318530718;
    float s = 0.0;
    float a = 1.0;
    float tot = 0.0;
    int n = uLattice;
    for (int o = 0; o < 4; o++) {
      if (o >= uOct) break;
      s += a * pnoise(u, n, uSeed * 7 + o);
      tot += a;
      a *= 0.38;
      n *= 2;
    }
    float v = clamp(s / tot, 0.0, 1.0);
    float swell = 0.55 + 0.45 * pnoise(u, max(3, (uLattice + 2) / 4), uSeed * 13 + 5);
    float shaped = pow(v, 1.35) * swell;
    return uTop + uAmp * clamp(shaped / 0.68, 0.0, 1.15);
  }
  void main() {
    float theta = atan(vLocal.x, -vLocal.z);
    float d = ridgeH(theta) - vLocal.y; // > 0 below the crest
    // Anti-aliased crest: coverage from the screen-space derivative.
    float w = max(fwidth(d), 1e-3);
    float cover = clamp(d / w + 0.5, 0.0, 1.0);
    if (cover <= 0.0) discard;
    // Crest bokashi: the ink pools at the crest and fades down the slope.
    float k = 1.0 - smoothstep(0.0, ${f(CREST_DEPTH)}, d);
    vec3 col = mix(uColor, uCrest, uCrestOp * k * k);
    // Fade to mist at the base: the field shows through.
    float mist = smoothstep(uFade1, uFade0, vLocal.y);
    float a = cover * mist;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
  }
`;

// Field sampling for the mist and floor: where the view ray meets the field
// shell (centered at the world origin), so the color matches the shell exactly.
const FIELD_SAMPLE_GLSL = /* glsl */ `
  uniform int uDusk;
  ${HANGA_FIELD_GLSL}
  vec3 fieldBehind(vec3 world) {
    vec3 rd = normalize(world - cameraPosition);
    float b = dot(cameraPosition, rd);
    float c = dot(cameraPosition, cameraPosition) - ${f(SHELL_RADIUS * SHELL_RADIUS)};
    float t = -b + sqrt(max(b * b - c, 0.0));
    return hangaFieldAt(normalize(cameraPosition + rd * t), uDusk == 1);
  }
`;

const MIST_VERT = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vWorld;
  void main() {
    vLocal = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const MIST_FRAG = /* glsl */ `
  uniform vec4 uBands[4];
  uniform float uOpacity;
  varying vec3 vLocal;
  varying vec3 vWorld;
  ${FIELD_SAMPLE_GLSL}
  void main() {
    float theta = atan(vLocal.x, -vLocal.z);
    float a = 0.0;
    for (int k = 0; k < 4; k++) {
      vec4 b = uBands[k];
      float da = mod(theta - b.x + 3.14159265, 6.28318530718) - 3.14159265;
      float s = abs(da) / b.y;
      if (s >= 1.0) continue;
      // Stadium profile: flat top and bottom, rounded ends.
      float prof = sqrt(max(0.0, 1.0 - pow(s, 6.0)));
      float t = b.w * prof;
      float y = vLocal.y - b.z;
      float up = 1.0 - smoothstep(t * 0.4, t, y);
      float dn = smoothstep(-t * 0.8, -t * 0.3, y);
      a = max(a, up * dn * prof);
    }
    a *= uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(fieldBehind(vWorld), a);
  }
`;

const FLOOR_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uFloor;
  uniform vec3 uWave;
  uniform float uWaveOp;
  varying vec3 vLocal;
  varying vec3 vWorld;
  ${FIELD_SAMPLE_GLSL}
  float lh(int s, int i) {
    uint h = uint(i) * 0x9E3779B1u + uint(s) * 0x85EBCA77u;
    h ^= h >> 15u; h *= 0x2C1B3C6Du; h ^= h >> 12u; h *= 0x297A2D39u; h ^= h >> 15u;
    return float(h >> 8u) / 16777216.0;
  }
  // One row of fine wave lines at radius rRow: hashed segments around the shore,
  // drifting slowly along the shore. Returns line coverage (about 1 px wide).
  float waveRow(float r, float phi, float rRow, int seed, float drift, float cells) {
    float ph = fract((phi - drift) / 6.28318530718) * cells;
    float ci = floor(ph);
    float s = ph - ci;
    int id = int(ci);
    if (lh(seed, id) > 0.62) return 0.0; // most cells hold one stroke
    float c0 = 0.2 + lh(seed + 1, id) * 0.2;
    float c1 = c0 + 0.35 + lh(seed + 2, id) * 0.25;
    if (s < c0 || s > c1) return 0.0;
    float u = (s - c0) / (c1 - c0);
    float wob = 3.0 * sin(u * 3.14159 * (2.0 + floor(lh(seed + 3, id) * 2.0)) + lh(seed + 4, id) * 6.0);
    float dr = abs(r - (rRow + wob));
    float px = dr / max(fwidth(r), 1e-3);
    float line = 1.0 - smoothstep(0.35, 1.1, px);
    // thin ends, fuller middle
    return line * mix(0.45, 1.0, smoothstep(0.0, 0.3, u) * (1.0 - smoothstep(0.7, 1.0, u)));
  }
  void main() {
    float r = length(vLocal.xz);
    float phi = atan(vLocal.x, -vLocal.z);
    vec2 dirXZ = vLocal.xz / max(r, 1.0);
    // The far shore (where the camera looks) carries the water; the near side fades.
    float far = smoothstep(-0.3, 0.85, dot(dirXZ, uHFwd));
    float shore = smoothstep(${f(RINGS[0].R * 0.35)}, ${f(RINGS[0].R)}, r);
    // Strongest a little inside the shore, melting to the field at the shore itself
    // (a hard rim would print as a dome edge in perspective).
    float rim = 1.0 - smoothstep(${f(RINGS[0].R * 0.8)}, ${f(RINGS[0].R - 10)}, r);
    float tint = uOpacity * mix(0.17, 1.0, far * shore) * rim;
    float edge = 1.0 - smoothstep(${f(RINGS[0].R - 40)}, ${f(RINGS[0].R - 4)}, r);
    vec3 field = fieldBehind(vWorld);
    vec3 col = mix(field, uFloor, tint);
    float lines = 0.0;
    lines = max(lines, waveRow(r, phi, ${f(RINGS[0].R - 22)}, 31, uTime * 0.0042, 34.0));
    lines = max(lines, waveRow(r, phi, ${f(RINGS[0].R - 50)}, 41, -uTime * 0.0031, 30.0) * 0.84);
    lines = max(lines, waveRow(r, phi, ${f(RINGS[0].R - 84)}, 53, uTime * 0.0024, 26.0) * 0.68);
    lines *= uWaveOp * far * smoothstep(${f(RINGS[0].R - 160)}, ${f(RINGS[0].R - 70)}, r);
    col = mix(col, uWave, lines);
    float a = max(tint, lines) * edge;
    if (a < 0.002) discard;
    // Opaque-composite of the field with the tint, then alpha so the edge melts.
    gl_FragColor = vec4(col, a / max(a, 1e-4) * edge);
  }
`;

const PEAK_VERT = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  void main() {
    vLocal = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const PEAK_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uPeak;
  uniform vec3 uPeakTop;
  uniform vec3 uCap;
  uniform float uCapOp;
  uniform vec3 uLine;
  uniform float uLineOp;
  uniform vec3 uFalls;
  uniform float uFallsOp;
  uniform float uFallsPhi;
  uniform vec3 uTongue[7];
  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  uniform float uCamAz; // camera azimuth around the cone axis (fed per draw)
  float wrapA(float a) { return mod(a + 3.14159265, 6.28318530718) - 3.14159265; }
  void main() {
    float d = ${f(PEAK.apex)} - vLocal.y; // depth below the summit
    float phi = atan(vLocal.z, vLocal.x);
    vec3 V = normalize(cameraPosition - vWorld);
    float ndv = dot(normalize(vNormalW), V);
    // Body: deeper just under the snow (summit bokashi), lifting to the body color.
    vec3 col = mix(uPeakTop, uPeak, smoothstep(65.0, 300.0, d));
    // Snowline: a closed curve whose depth swells into soft rounded tongues.
    float snowD = ${f(PEAK.snow)};
    for (int i = 0; i < 7; i++) {
      vec3 tg = uTongue[i];
      float da = wrapA(phi - tg.x) / tg.y;
      snowD += tg.z * exp(-da * da);
    }
    snowD += 9.0 * sin(phi * 11.0 + 1.3);
    // Tongues seen edge-on near the outline print as streaks: relax them there,
    // by the azimuth from the camera's side of the cone (the preview's rule).
    float dphi = abs(wrapA(phi - uCamAz));
    float relax = 1.0 - smoothstep(0.7854, 1.2217, dphi); // full inside 45 deg, none past 70 deg
    snowD = ${f(PEAK.snow)} + min(87.0, snowD - ${f(PEAK.snow)}) * relax;
    float sd = snowD - d;
    float capA = clamp(sd / max(fwidth(d), 1e-3) * 0.6 + 0.5, 0.0, 1.0);
    col = mix(col, uCap, capA * uCapOp);
    // Waterfall: one thin pale line down the face toward the map. A soft, slow
    // swell of ink drifts down it (about 18 s per period); no hard dashes.
    float rr = ${f(PEAK.rTop)} + ${f((PEAK.halfW - PEAK.rTop) / Math.pow(PEAK.halfD, PEAK.p))} * pow(max(d, 0.0), ${f(PEAK.p)});
    // A straight fall (a meander aliases into dashes at one pixel wide).
    float arc = wrapA(phi - uFallsPhi) * rr;
    float fpx = abs(arc) / max(fwidth(arc), 1e-3);
    float fallLine = 1.0 - smoothstep(0.6, 1.5, fpx);
    float dashA = 0.85 + 0.15 * sin((d - uTime * 6.0) * 6.28318530718 / 110.0);
    float fallSpan = smoothstep(snowD - 10.0, snowD + 30.0, d) * (1.0 - smoothstep(420.0, 600.0, d));
    col = mix(col, uFalls, fallLine * dashA * fallSpan * uFallsOp * step(0.0, ndv));
    // Hairline key-block contour on the upper outline only.
    float line = 1.0 - smoothstep(0.0, 1.6 * max(fwidth(ndv), 1e-4), ndv);
    line *= 1.0 - smoothstep(330.0, 470.0, d);
    col = mix(col, uLine, line * uLineOp);
    // The flank fades to the field well below the far ridge.
    float a = 1.0 - smoothstep(${f(PEAK.fade0)}, ${f(PEAK.fade1)}, d);
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
  }
`;

const SKY_VERT = /* glsl */ `
  uniform vec3 uCenter;
  uniform float uSize;
  varying vec2 vUv;
  void main() {
    vUv = position.xy;
    vec4 mv = modelViewMatrix * vec4(uCenter, 1.0);
    mv.xy += position.xy * uSize;
    gl_Position = projectionMatrix * mv;
  }
`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 uDisc0;
  uniform vec3 uDisc1;
  uniform vec3 uHalo0;
  uniform vec3 uHalo1;
  uniform float uHaloOp;
  uniform float uDiscR;   // disc radius in quad units (quad = halo radius)
  varying vec2 vUv;
  void main() {
    float r = length(vUv);
    if (r > 1.0) discard;
    // Bokashi halo: the preview's radial stops (0.2 -> full, 0.45 -> 0.4, 1 -> 0).
    float h = r < 0.2 ? 1.0 : (r < 0.45 ? mix(1.0, 0.41, (r - 0.2) / 0.25) : mix(0.41, 0.0, (r - 0.45) / 0.55));
    vec3 hc = mix(uHalo0, uHalo1, smoothstep(0.2, 1.0, r));
    float ha = uHaloOp * h * h * (3.0 - 2.0 * h) ;
    // Soft-edged disc.
    float w = max(fwidth(r), 1e-4) * 1.8;
    float dA = 1.0 - smoothstep(uDiscR - w, uDiscR + w, r);
    vec3 dc = mix(uDisc0, uDisc1, smoothstep(0.82 * uDiscR, uDiscR, r));
    float a = dA + ha * (1.0 - dA);
    if (a < 0.002) discard;
    vec3 col = (dc * dA + hc * ha * (1.0 - dA)) / a;
    gl_FragColor = vec4(col, a);
  }
`;

const CRANE_VERT = /* glsl */ `
  attribute vec4 aSlot; // lag, rise, wing phase, index
  uniform float uProg;
  uniform float uAz0;
  uniform float uAz1;
  uniform float uR;
  uniform float uH0;
  uniform float uH1;
  uniform float uCount;
  uniform float uTime;
  uniform float uAlpha;
  uniform float uSize;
  varying vec2 vUv;
  varying float vA;
  // Wing joints in silhouette space (x forward, y up): wrist.xy, tip.xy.
  varying vec4 vNear;
  varying vec4 vFar;
  vec3 pathAt(float p, float rise) {
    float az = mix(uAz0, uAz1, p);
    float h = mix(uH0, uH1, p) + rise;
    return vec3(uR * sin(az), h, -uR * cos(az));
  }
  // A wing in silhouette space, drawn the way a print draws it rather than as
  // a projection. A is the arm's angle above the backward horizontal (+ up).
  // The primaries bend back toward the horizontal and lag the beat. The wing
  // shortens a little as it swings through level (it points at the viewer).
  vec4 wing(float A, float lag, float len) {
    vec2 arm = ${f(CRANE.arm)} * len * vec2(-cos(A), sin(A));
    float H = 0.55 * A + lag;
    vec2 hand = arm + ${f(CRANE.hand)} * len * vec2(-cos(H), sin(H));
    return vec4(arm, hand);
  }
  void main() {
    float p = uProg - aSlot.x;
    float rise = aSlot.y + 5.0 * sin(uTime * 6.28318 / 9.0 + aSlot.z * 6.28318);
    vec4 v1 = modelViewMatrix * vec4(pathAt(p, rise), 1.0);
    vec4 v2 = modelViewMatrix * vec4(pathAt(p + 0.004, rise), 1.0);
    // Screen direction of flight, so the silhouette flies along its path.
    vec2 dir = v2.xy / max(-v2.z, 1.0) - v1.xy / max(-v1.z, 1.0);
    dir = length(dir) > 1e-7 ? normalize(dir) : vec2(1.0, 0.0);
    vec2 perp = vec2(-dir.y, dir.x);
    if (perp.y < 0.0) perp = -perp;
    vec4 mv = v1;
    mv.xy += (position.x * dir + position.y * perp) * uSize;
    gl_Position = projectionMatrix * mv;
    vUv = position.xy;
    float ends = smoothstep(0.0, 0.08, p) * (1.0 - smoothstep(0.92, 1.0, p));
    vA = uAlpha * ends * step(aSlot.w + 0.5, uCount);
    // A slow beat (period ${CRANE.wingPeriod} s) between a raised and a lowered pose.
    float ph = 6.28318530718 * uTime / ${f(CRANE.wingPeriod)} + aSlot.z * 6.28318530718;
    float beat = sin(ph);
    float w = 0.5 + 0.5 * beat;
    float lag = -0.3 * cos(ph);
    float len = 0.72 + 0.28 * abs(beat);
    // Near wing from about 49 deg below to 66 deg above the back line. The far
    // wing rides 29 deg higher, so the pair opens into a V when raised.
    float A = mix(-0.85, 1.15, w);
    vNear = wing(A, lag, len);
    vFar = wing(min(A + 0.5, 1.6), lag, len * 0.92);
  }
`;
const CRANE_FRAG = /* glsl */ `
  uniform vec3 uInk;
  varying vec2 vUv;
  varying float vA;
  varying vec4 vNear;
  varying vec4 vFar;
  // Signed-distance tapered stroke from a (radius ra) to b (radius rb), as
  // anti-aliased coverage. A stroke thinner than a pixel draws one pixel wide
  // with its ink thinned, so the line stays continuous and never swells.
  float stroke(vec2 p, vec2 a, vec2 b, float ra, float rb, float px) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    float d = length(pa - ba * h);
    float r = mix(ra, rb, h);
    float re = max(r, 0.5 * px);
    return clamp((re - d) / px + 0.5, 0.0, 1.0) * sqrt(r / re);
  }
  void main() {
    if (vA <= 0.001) discard;
    vec2 p = vUv;
    float px = max(fwidth(p.x) + fwidth(p.y), 1e-4) * 0.7071;
    // Silhouette units: x forward, y up, the quad spans -1..1.
    vec2 shoulder = vec2(0.12, 0.02);
    float ink = 0.0;
    // Long neck forward, small head, a fine beak.
    ink = max(ink, stroke(p, vec2(0.26, 0.03), vec2(0.72, 0.1), 0.032, 0.02, px));
    ink = max(ink, stroke(p, vec2(0.72, 0.1), vec2(0.77, 0.105), 0.045, 0.04, px));
    ink = max(ink, stroke(p, vec2(0.76, 0.105), vec2(0.9, 0.085), 0.015, 0.006, px));
    // Body: a slim tapered spindle.
    ink = max(ink, stroke(p, vec2(0.28, 0.03), vec2(-0.22, -0.01), 0.08, 0.045, px));
    // Legs trailing straight behind, a little apart.
    ink = max(ink, stroke(p, vec2(-0.2, -0.03), vec2(-0.78, -0.07), 0.016, 0.009, px));
    ink = max(ink, stroke(p, vec2(-0.2, -0.03), vec2(-0.76, -0.11), 0.014, 0.008, px));
    // Two long tapered wings: arm to the wrist, then the swept primaries.
    float nearW = max(stroke(p, shoulder, shoulder + vNear.xy, 0.085, 0.05, px),
                      stroke(p, shoulder + vNear.xy, shoulder + vNear.zw, 0.05, 0.008, px));
    float farW = max(stroke(p, shoulder, shoulder + vFar.xy, 0.06, 0.04, px),
                     stroke(p, shoulder + vFar.xy, shoulder + vFar.zw, 0.04, 0.006, px));
    ink = max(ink, max(nearW, 0.8 * farW));
    float a = ink * vA;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uInk, a);
  }
`;

const MURM_VERT = /* glsl */ `
  attribute vec4 aSeed; // g (stream, alpha), u (stream place, jitter phase), j (sub-flock), s (size, jitter period)
  uniform float uTime;
  uniform float uAlpha;
  uniform float uPx;
  varying float vA;
  const float TAU = 6.28318530718;
  vec3 local(vec3 p0, float t) {
    vec3 p = p0 * vec3(1.0, ${f(MURM.sheet)}, 1.0);
    float w1 = TAU / ${f(MURM.pW1)};
    float w2 = TAU / ${f(MURM.pW2)};
    float w3 = TAU / ${f(MURM.pW3)};
    p = p + ${f(MURM.warp1)} * vec3(sin(p.y * 2.1 + t * w1 + 0.3), sin(p.z * 1.9 + t * w2 + 1.7), sin(p.x * 2.3 - t * w1 + 2.9));
    p = p + ${f(MURM.warp2)} * vec3(sin(p.z * 3.1 - t * w2 + 4.1), sin(p.x * 2.7 + t * w3 + 0.6), sin(p.y * 3.3 + t * w1 + 5.2));
    float s = 1.0 + ${f(MURM.stretch)} * sin(t * TAU / ${f(MURM.pS)});
    p.x *= s;
    p.y /= sqrt(s);
    float tl = ${f(MURM.tilt)} * sin(t * TAU / ${f(MURM.pTilt)});
    float c = cos(tl);
    float sn = sin(tl);
    return vec3(
      (p.x * c - p.y * sn * ${f(MURM.ay / MURM.ax)}) * ${f(MURM.ax)},
      (p.x * sn * ${f(MURM.ax / MURM.ay)} + p.y * c) * ${f(MURM.ay)},
      p.z * ${f(MURM.az3)});
  }
  // Sub-flock offset from the main center: (azimuth, height, radius).
  vec3 sub(float k, float t) {
    vec3 a = k < 0.5 ? vec3(${[MURM_SUBS[0][0], MURM_SUBS[0][2], MURM_SUBS[0][4]].map(f).join(", ")})
           : (k < 1.5 ? vec3(${[MURM_SUBS[1][0], MURM_SUBS[1][2], MURM_SUBS[1][4]].map(f).join(", ")})
                      : vec3(${[MURM_SUBS[2][0], MURM_SUBS[2][2], MURM_SUBS[2][4]].map(f).join(", ")}));
    vec3 b = k < 0.5 ? vec3(${[MURM_SUBS[0][1], MURM_SUBS[0][3], MURM_SUBS[0][5]].map(f).join(", ")})
           : (k < 1.5 ? vec3(${[MURM_SUBS[1][1], MURM_SUBS[1][3], MURM_SUBS[1][5]].map(f).join(", ")})
                      : vec3(${[MURM_SUBS[2][1], MURM_SUBS[2][3], MURM_SUBS[2][5]].map(f).join(", ")}));
    return vec3((k - 1.0) * ${f(MURM.subBase)}, 0.0, 0.0)
      + vec3(${f(MURM.subAz)}, ${f(MURM.subH)}, ${f(MURM.subR)}) * sin(t * TAU / a + b);
  }
  void main() {
    float t = uTime;
    float g = aSeed.x;
    float u = aSeed.y;
    float k = g < ${f(MURM.streamFrac)} ? (u < 0.5 ? 0.0 : 1.0) : min(2.0, floor(aSeed.z * 3.0));
    float sz = aSeed.w;
    float caz = ${f(MURM.az)} + ${f(MURM.azSwing)} * (0.65 * sin(t * TAU / ${f(MURM.pAz1)}) + 0.35 * sin(t * TAU / ${f(MURM.pAz2)} + 1.3));
    float cR = ${f(MURM.R)} + ${f(MURM.RSwing)} * sin(t * TAU / ${f(MURM.pR)} + 0.4);
    float ch = ${f(MURM.h)} + ${f(MURM.hSwing)} * sin(t * TAU / ${f(MURM.pH)} + 1.0);
    vec3 so = sub(k, t);
    vec3 lo = local(position, t + k * 17.3);
    float pj = ${f(MURM.jitP0)} + ${f(MURM.jitP1 - MURM.jitP0)} * sz;
    float ph = u * TAU;
    float jx = ${f(MURM.jitX)} * sin(t * TAU / pj + ph);
    float jy = ${f(MURM.jitY)} * sin(t * TAU / (pj * 1.27) + ph * 3.1);
    float jz = ${f(MURM.jitZ)} * sin(t * TAU / (pj * 0.83) + ph * 1.7);
    float R = cR + so.z + lo.z + jz;
    float az = caz + so.x + (lo.x + jx) / cR;
    float h = ch + so.y + lo.y + jy;
    if (g < ${f(MURM.streamFrac)}) {
      vec3 s0 = sub(0.0, t);
      vec3 s1 = sub(1.0, t);
      float st = smoothstep(0.1, 0.9, 0.5 + 0.5 * sin(t * TAU / ${f(MURM.pStream)}));
      float sAz = caz + s0.x + (s1.x - s0.x) * u + 0.25 * jx / cR;
      float sH = ch + s0.y + (s1.y - s0.y) * u + ${f(MURM.streamTh)} * sin(sz * 40.0 + t * TAU / pj);
      float sR = cR + s0.z + (s1.z - s0.z) * u + 0.3 * jz;
      az = mix(az, sAz, st);
      h = mix(h, sH, st);
      R = mix(R, sR, st);
    }
    vec3 world = vec3(R * sin(az), h, -R * cos(az));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
    gl_PointSize = mix(${f(MURM.px0)}, ${f(MURM.px1)}, sz) * uPx;
    vA = uAlpha * (0.7 + 0.3 * g);
  }
`;
const MURM_FRAG = /* glsl */ `
  uniform vec3 uInk;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.45, 1.0, d)) * vA;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uInk, a);
  }
`;

// ---------------------------------------------------------------------------

export interface LandscapeUpdateOpts {
  /** 0 normal, 1 while a story plays or a standard is focused. */
  quiet: number;
  reducedMotion: boolean;
  /** Eased pose scalar (1 = Ascent). The landscape lowers a little there. */
  pose?: number;
}

export interface LandscapeHandle {
  group: THREE.Group;
  setArtStyle(style: number): void;
  update(timeSec: number, opts: LandscapeUpdateOpts): void;
  /** Debug/automation only: a fixed landscape clock (seconds), or null. */
  debugTime: number | null;
  dispose(): void;
}

/** The phase reduced motion holds the water, mist, and waterfall at. */
export const FROZEN_T = 240;
/** How far the landscape drops at the Ascent (the map is taller there). */
export const ASCENT_DROP = 70;

const linColor = (hex: number): THREE.Color => new THREE.Color().setHex(hex);
const srgb01 = (hex: number): THREE.Vector3 =>
  new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

export function createLandscape(center: THREE.Vector3): LandscapeHandle {
  const group = new THREE.Group();
  group.name = "landscape";
  group.position.copy(center);
  group.visible = false;

  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.ShaderMaterial[] = [];
  const baseMat = (
    vertexShader: string,
    fragmentShader: string,
    uniforms: Record<string, THREE.IUniform>,
    side: THREE.Side,
  ): THREE.ShaderMaterial => {
    const m = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      side,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    mats.push(m);
    return m;
  };

  // Shared field uniforms (the same objects in every field-sampling material).
  const fieldU = {
    uHMid: { value: new THREE.Vector3() },
    uHTop: { value: new THREE.Vector3() },
    uHBottom: { value: new THREE.Vector3() },
    uHWarm: { value: new THREE.Vector3() },
    uHFwd: { value: new THREE.Vector2(0, -1) },
    uDusk: { value: 0 },
    // The sheet's screen-fixed top band (shared objects, fed by environs).
    ...HANGA_SCREEN_UNIFORMS,
  };
  const fwdScratch = new THREE.Vector3();
  const feedFwd = (_r: THREE.WebGLRenderer, _s: THREE.Scene, camera: THREE.Camera): void => {
    camera.getWorldDirection(fwdScratch);
    const l = Math.hypot(fwdScratch.x, fwdScratch.z);
    if (l > 1e-3) fieldU.uHFwd.value.set(fwdScratch.x / l, fwdScratch.z / l);
  };

  // -- sky body ------------------------------------------------------------
  const skyGeo = new THREE.PlaneGeometry(2, 2);
  geos.push(skyGeo);
  const skyDir = new THREE.Vector3(
    Math.sin(SKY_BODY.az) * Math.cos(SKY_BODY.el),
    Math.sin(SKY_BODY.el),
    -Math.cos(SKY_BODY.az) * Math.cos(SKY_BODY.el),
  );
  const skyMat = baseMat(
    SKY_VERT,
    SKY_FRAG,
    {
      uCenter: { value: skyDir.clone().multiplyScalar(SKY_BODY.dist) },
      uSize: { value: SKY_BODY.r * 4.2 },
      uDisc0: { value: new THREE.Color() },
      uDisc1: { value: new THREE.Color() },
      uHalo0: { value: new THREE.Color() },
      uHalo1: { value: new THREE.Color() },
      uHaloOp: { value: 0.3 },
      uDiscR: { value: 0.24 },
    },
    THREE.DoubleSide,
  );
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -9.6;
  group.add(sky);

  // -- peak ----------------------------------------------------------------
  const prof: THREE.Vector2[] = [new THREE.Vector2(0.01, PEAK.apex), new THREE.Vector2(PEAK.rTop, PEAK.apex)];
  for (let i = 1; i <= 48; i++) {
    const d = PEAK.dMax * Math.pow(i / 48, 1.35);
    prof.push(new THREE.Vector2(peakRadius(d), PEAK.apex - d));
  }
  // Lathe profiles run bottom to top for outward faces and normals.
  prof.reverse();
  const peakGeo = new THREE.LatheGeometry(prof, 192);
  geos.push(peakGeo);
  const peakPos = new THREE.Vector3(PEAK.R * Math.sin(PEAK.az), 0, -PEAK.R * Math.cos(PEAK.az));
  // The waterfall faces the map center, a little to the right of it.
  const fallsPhi = Math.atan2(-peakPos.z, -peakPos.x) + 0.2;
  const tongues: THREE.Vector3[] = [];
  for (let i = 0; i < 7; i++) {
    tongues.push(new THREE.Vector3(lhash(501, i) * TAU, (7 + lhash(502, i) * 7) * DEG, (22 + lhash(503, i) * 44) * 1.5));
  }
  const peakMat = baseMat(
    PEAK_VERT,
    PEAK_FRAG,
    {
      uTime: { value: 0 },
      uPeak: { value: new THREE.Color() },
      uPeakTop: { value: new THREE.Color() },
      uCap: { value: new THREE.Color() },
      uCapOp: { value: 1 },
      uLine: { value: new THREE.Color() },
      uLineOp: { value: 0.3 },
      uFalls: { value: new THREE.Color() },
      uFallsOp: { value: 0.5 },
      uFallsPhi: { value: fallsPhi },
      uTongue: { value: tongues },
      uCamAz: { value: 0 },
    },
    THREE.FrontSide,
  );
  const peak = new THREE.Mesh(peakGeo, peakMat);
  peak.position.copy(peakPos);
  peak.renderOrder = -9.4;
  const peakWorld = new THREE.Vector3();
  const camWorld = new THREE.Vector3();
  peak.onBeforeRender = (_r, _s, camera) => {
    peak.getWorldPosition(peakWorld);
    camera.getWorldPosition(camWorld);
    peakMat.uniforms.uCamAz.value = Math.atan2(camWorld.z - peakWorld.z, camWorld.x - peakWorld.x);
  };
  group.add(peak);

  // -- rings ---------------------------------------------------------------
  const ringMats: THREE.ShaderMaterial[] = [];
  const ringMeshes: THREE.Mesh[] = [];
  RINGS.forEach((ring, i) => {
    const y0 = FLOOR_Y - 60;
    const y1 = ringCeiling(ring) + 12;
    const geo = new THREE.CylinderGeometry(ring.R, ring.R, y1 - y0, 256, 1, true);
    geo.translate(0, (y0 + y1) / 2, 0);
    geos.push(geo);
    const mat = baseMat(
      RING_VERT,
      RING_FRAG,
      {
        uTop: { value: ring.top },
        uAmp: { value: ring.amp },
        uLattice: { value: ring.lattice },
        uOct: { value: ring.octaves },
        uSeed: { value: ring.seed },
        uFade0: { value: ring.top + 10 },
        uFade1: { value: ring.top - ring.fadeSpan },
        uColor: { value: new THREE.Color() },
        uCrest: { value: new THREE.Color() },
        uCrestOp: { value: 0.1 },
      },
      // The inside of the wall: a camera dollied out past a ring culls its
      // near half instead of walling off the map.
      THREE.BackSide,
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -8.8 + (3 - i) * 0.4; // far ring first
    ringMats.push(mat);
    ringMeshes.push(mesh);
    group.add(mesh);
  });

  // -- mist bands ----------------------------------------------------------
  const mistMeshes: THREE.Mesh[] = [];
  MIST_RINGS.forEach((mr, i) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of mr.bands) {
      lo = Math.min(lo, b.h - b.th);
      hi = Math.max(hi, b.h + b.th);
    }
    const geo = new THREE.CylinderGeometry(mr.R, mr.R, hi - lo + 8, 256, 1, true);
    geo.translate(0, (lo + hi) / 2, 0);
    geos.push(geo);
    const bandsU = mr.bands.map((b) => new THREE.Vector4(b.az, b.halfSpan, b.h, b.th));
    const mat = baseMat(MIST_VERT, MIST_FRAG, { ...fieldU, uBands: { value: bandsU }, uOpacity: { value: 0.9 } }, THREE.BackSide);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    // Mist ring i lies between rings 3 - i and 4 - i (1-based): drawn after the
    // ring behind it and before the ring in front of it.
    mesh.renderOrder = -8.6 + i * 0.4;
    mesh.onBeforeRender = feedFwd;
    mistMeshes.push(mesh);
    group.add(mesh);
  });

  // -- water floor ---------------------------------------------------------
  const floorGeo = new THREE.CircleGeometry(RINGS[0].R - 2, 192);
  floorGeo.rotateX(-Math.PI / 2);
  floorGeo.translate(0, FLOOR_Y, 0);
  geos.push(floorGeo);
  const floorMat = baseMat(
    MIST_VERT,
    FLOOR_FRAG,
    {
      ...fieldU,
      uTime: { value: 0 },
      uOpacity: { value: 0.12 },
      uFloor: { value: new THREE.Color() },
      uWave: { value: new THREE.Color() },
      uWaveOp: { value: 0.4 },
    },
    THREE.FrontSide,
  );
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.frustumCulled = false;
  floor.renderOrder = -7.4;
  floor.onBeforeRender = feedFwd;
  group.add(floor);

  // -- cranes (Washi) ------------------------------------------------------
  const craneBase = new THREE.PlaneGeometry(2, 2);
  const craneGeo = new THREE.InstancedBufferGeometry();
  craneGeo.index = craneBase.index;
  craneGeo.setAttribute("position", craneBase.getAttribute("position"));
  const slots = new Float32Array(CRANE.maxCount * 4);
  CRANE_SLOTS.forEach(([lag, rise, phase], i) => {
    slots.set([lag, rise + (lhash(931, i) - 0.5) * 10, phase, i], i * 4);
  });
  craneGeo.setAttribute("aSlot", new THREE.InstancedBufferAttribute(slots, 4));
  craneGeo.instanceCount = CRANE.maxCount;
  geos.push(craneBase, craneGeo);
  const craneMat = baseMat(
    CRANE_VERT,
    CRANE_FRAG,
    {
      uProg: { value: -1 },
      uAz0: { value: 0 },
      uAz1: { value: 0 },
      uR: { value: CRANE.R },
      uH0: { value: CRANE.h },
      uH1: { value: CRANE.h },
      uCount: { value: 3 },
      uTime: { value: 0 },
      uAlpha: { value: 0 },
      uSize: { value: CRANE.size },
      uInk: { value: new THREE.Color() },
    },
    THREE.DoubleSide,
  );
  const cranes = new THREE.Mesh(craneGeo, craneMat);
  cranes.frustumCulled = false;
  cranes.renderOrder = -9.2;
  cranes.visible = false;
  group.add(cranes);

  // -- murmuration (Dusk) --------------------------------------------------
  const murmGeo = new THREE.BufferGeometry();
  const seeds = new Float32Array(MURM.count * 3);
  const seed4 = new Float32Array(MURM.count * 4);
  for (let i = 0; i < MURM.count; i++) {
    const sd = murmurationSeed(i);
    seeds.set(sd.p, i * 3);
    seed4.set([sd.g, sd.u, sd.j, sd.s], i * 4);
  }
  murmGeo.setAttribute("position", new THREE.BufferAttribute(seeds, 3));
  murmGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed4, 4));
  geos.push(murmGeo);
  const murmMat = baseMat(
    MURM_VERT,
    MURM_FRAG,
    { uTime: { value: 0 }, uAlpha: { value: 0 }, uPx: { value: 1 }, uInk: { value: new THREE.Color() } },
    THREE.FrontSide,
  );
  const murm = new THREE.Points(murmGeo, murmMat);
  murm.frustumCulled = false;
  murm.renderOrder = -9.2;
  murm.visible = false;
  murm.onBeforeRender = (renderer) => {
    murmMat.uniforms.uPx.value = renderer.getPixelRatio();
  };
  group.add(murm);

  // -- state ---------------------------------------------------------------
  let style = 0;
  let quiet = 0;
  let lastNow = 0;
  const sched: CraneState = { index: 0, start: CRANE.first, progress: -1, visible: false };
  const path: CranePath = { az0: 0, az1: 0, R: CRANE.R, h0: CRANE.h, h1: CRANE.h, count: 3 };
  let pathIndex = -1;

  function paint(pal: LandPalette, dusk: boolean): void {
    const fieldPal = dusk ? HANGA.dusk : HANGA.washi;
    fieldU.uHMid.value.copy(srgb01(fieldPal.bg));
    fieldU.uHTop.value.copy(srgb01(fieldPal.top));
    fieldU.uHBottom.value.copy(srgb01(fieldPal.bottom));
    fieldU.uHWarm.value.copy(srgb01(fieldPal.warm));
    fieldU.uDusk.value = dusk ? 1 : 0;
    ringMats.forEach((m, i) => {
      (m.uniforms.uColor.value as THREE.Color).copy(linColor(pal.rings[i]));
      (m.uniforms.uCrest.value as THREE.Color).copy(linColor(pal.crest));
      m.uniforms.uCrestOp.value = pal.crestOp[i];
    });
    const pu = peakMat.uniforms;
    (pu.uPeak.value as THREE.Color).setHex(pal.peak);
    (pu.uPeakTop.value as THREE.Color).setHex(pal.peakTop);
    (pu.uCap.value as THREE.Color).setHex(pal.cap);
    pu.uCapOp.value = pal.capOp;
    (pu.uLine.value as THREE.Color).setHex(pal.peakLine);
    pu.uLineOp.value = pal.peakLineOp;
    (pu.uFalls.value as THREE.Color).setHex(pal.falls);
    pu.uFallsOp.value = pal.fallsOp;
    const fu = floorMat.uniforms;
    (fu.uFloor.value as THREE.Color).setHex(pal.floor);
    fu.uOpacity.value = pal.floorOp;
    (fu.uWave.value as THREE.Color).setHex(pal.wave);
    fu.uWaveOp.value = pal.waveOp;
    const su = skyMat.uniforms;
    (su.uDisc0.value as THREE.Color).setHex(pal.disc0);
    (su.uDisc1.value as THREE.Color).setHex(pal.disc1);
    (su.uHalo0.value as THREE.Color).setHex(pal.halo0);
    (su.uHalo1.value as THREE.Color).setHex(pal.halo1);
    su.uHaloOp.value = pal.haloOp;
    su.uSize.value = SKY_BODY.r * pal.haloScale;
    su.uDiscR.value = pal.discScale / pal.haloScale;
    (craneMat.uniforms.uInk.value as THREE.Color).setHex(pal.bird);
    (murmMat.uniforms.uInk.value as THREE.Color).setHex(pal.bird);
  }

  const handle: LandscapeHandle = {
    group,
    debugTime: null,
    setArtStyle(next) {
      const on = next === 3 || next === 4;
      group.visible = on;
      if (!on) {
        style = next;
        return;
      }
      if (next !== style) paint(next === 4 ? LAND.dusk : LAND.washi, next === 4);
      style = next;
      if (next === 3) murm.visible = false;
      else cranes.visible = false;
    },
    update(timeSec, opts) {
      if (!group.visible) return;
      const now = typeof performance !== "undefined" ? performance.now() : 0;
      // Real time, clamped so a long stall (a hidden tab) only completes the fade.
      const dt = lastNow === 0 ? 1 / 60 : Math.min(Math.max(now - lastNow, 0) / 1000, 0.5);
      lastNow = now;
      quiet = easeQuiet(quiet, opts.quiet > 0.5 ? 1 : 0, dt);
      const rm = opts.reducedMotion;
      const fixed = handle.debugTime;
      const t = fixed ?? timeSec;
      // Ambient water, mist, and waterfall: a fixed phase under reduced motion.
      const tAmb = fixed ?? (rm ? FROZEN_T : timeSec);
      for (let i = 0; i < mistMeshes.length; i++) {
        mistMeshes[i].rotation.y = MIST_RINGS[i].rate * TAU * tAmb;
      }
      floorMat.uniforms.uTime.value = tAmb;
      peakMat.uniforms.uTime.value = tAmb;
      // The Ascent is taller: drop the landscape a little so its low isolines clear.
      const pose = Math.min(1, Math.max(0, opts.pose ?? 0));
      group.position.y = center.y - ASCENT_DROP * pose;
      // Birds: hidden under reduced motion, faded out by quiet.
      // (A debug clock shows the birds even under reduced motion, for stills.)
      const birdA = rm && fixed === null ? 0 : 1 - smooth01(quiet);
      if (style === 3) {
        craneScheduleInto(t, sched, sched);
        const show = birdA > 0.002 && sched.visible;
        cranes.visible = show;
        if (show) {
          if (sched.index !== pathIndex) {
            cranePathInto(sched.index, path);
            pathIndex = sched.index;
            const u = craneMat.uniforms;
            u.uAz0.value = path.az0;
            u.uAz1.value = path.az1;
            u.uR.value = path.R;
            u.uH0.value = path.h0;
            u.uH1.value = path.h1;
            u.uCount.value = path.count;
          }
          craneMat.uniforms.uProg.value = sched.progress;
          craneMat.uniforms.uTime.value = t;
          craneMat.uniforms.uAlpha.value = birdA * LAND.washi.birdOp;
        }
      } else if (style === 4) {
        murm.visible = birdA > 0.002;
        murmMat.uniforms.uTime.value = t;
        murmMat.uniforms.uAlpha.value = birdA * LAND.dusk.birdOp;
      }
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
  return handle;
}
