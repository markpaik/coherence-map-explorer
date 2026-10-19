// The first murmuration (a dispersed cloud of specks with three sub-flocks and
// a streaming band). The landscape now draws the folded sheet in
// murmuration.ts instead. These helpers stay exported unchanged, because other
// modules import them by name.

import { DEG, TAU, lhash, smooth01 } from "./core";

// Murmuration (Dusk, first version): a dispersed cloud of specks, not one shape. Three
// sub-flocks ride their own slow centers around the main center, so they split
// and merge over 30 to 60 s. Inside each sub-flock a seed ball, flattened to a
// sheet, is folded by bounded sums of sines. Every speck adds its own slow
// jitter (periods 20 to 40 s), so no two specks share a path. Part of the time
// a thin band of specks streams between sub-flocks 0 and 2. All of it runs in
// the vertex shader. The functions below mirror it one for one.

export const MURM = {
  count: 880,
  // In open sky above and right of the map's center (the moon is at -40 deg),
  // at the home view about y 90 to 320 of 1440x900: clear of the title block
  // on the left and of the Style card and pose control at the bottom right
  // (tests/landscape.test.ts and the viewport screenshots).
  az: 31 * DEG,
  azSwing: 2 * DEG,
  R: 3440,
  RSwing: 90,
  h: 990,
  hSwing: 20,
  /** Sub-flock half-axes in world units: along the azimuth, up, radial. The
   *  half-height is half the half-length, and the tilt leans it further, so
   *  each sub-flock reads round and turning. */
  ax: 290,
  ay: 175,
  az3: 80,
  /** The seed ball is flattened to a sheet, so the warp folds it into ribbons. */
  sheet: 0.7,
  /** Warp amplitudes and periods (seconds). */
  warp1: 0.3,
  warp2: 0.15,
  stretch: 0.2,
  tilt: 0.25,
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
  subBase: 3 * DEG,
  subAz: 2.5 * DEG,
  /** Home heights: sub-flock 0 sits subHBase higher, 1 lower, 2 level. */
  subHBase: 55,
  subH: 45,
  subR: 140,
  /** Per-speck jitter amplitudes (world units) and period range (seconds). */
  jitX: 120,
  jitY: 90,
  jitZ: 40,
  jitP0: 20,
  jitP1: 40,
  /** Share of specks that can join the streaming band, its period, and its
   *  half-thickness in height. */
  streamFrac: 0.12,
  pStream: 90,
  streamTh: 20,
  /** The band's least length in azimuth (rad). */
  streamLen: 7 * DEG,
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
    [1, -1, 0][k] * MURM.subHBase + MURM.subH * Math.sin((t * TAU) / s[2] + s[3]),
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
  // Stream specks live in the sub-flock at their end of the band (0 or 2).
  const k = seed.g < MURM.streamFrac ? (seed.u < 0.5 ? 0 : 2) : Math.min(2, Math.floor(seed.j * 3));
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
    const s1 = murmurationSub(2, t);
    const st = murmurationStream(t);
    // The band runs past both sub-flocks and is never shorter than streamLen.
    const v = seed.u * 1.8 - 0.4;
    const sAz = c.az + s0[0] + (s1[0] - s0[0]) * v + (seed.u - 0.5) * MURM.streamLen + (0.6 * jx) / c.R;
    const sH = c.h + s0[1] + (s1[1] - s0[1]) * v + MURM.streamTh * Math.sin(seed.s * 40.0 + (t * TAU) / pj);
    const sR = c.R + s0[2] + (s1[2] - s0[2]) * v + 0.3 * jz;
    az += (sAz - az) * st;
    h += (sH - h) * st;
    R += (sR - R) * st;
  }
  return { az, R, h };
}

