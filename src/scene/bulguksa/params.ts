// Bulguksa world (style 5): the pure numbers and math the shaders mirror, and
// that tests/bulguksa.test.ts checks. No THREE, no DOM.
//
// Coordinates: the world group sits at the pose-0 map center. Azimuth theta = 0
// points to -z (straight ahead at the home view) and grows toward +x, as in the
// Hanga landscape. The home camera stands at about (0, -5.5, 918) in these
// coordinates, level, with a 50 degree vertical field of view.

import { lhash, pnoise } from "../landscape";

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Palette (sRGB hex). Snow is untouched paper. Every massif FILL tone (paper,
// shade wash, crest wash) keeps 3:1 or more against each obangsaek pigment
// (tests/bulguksa.test.ts). The sumi line marks on the massifs (the crest
// contour, fold lines, jun strokes, dots, the tide line) are hairlines, not
// fills, and are drawn at partial opacity.
export const INK = {
  /** Hanji: the paper, the snow, the mist. */
  paper: 0xf2efe8,
  /** Sumi: every line. */
  sumi: 0x1c1a17,
  /** Grey shadow wash on the snow (lee side of a fold, under a shelf). */
  shade: 0xd6d2ca,
  /** Crest wash just under a snow crest. */
  crest: 0xdcd8d0,
  /** Rock: the wet sumi wash over a massif face, light to dark. */
  rockLight: 0x5a5650,
  rockDark: 0x2a2824,
  /** Oehun: the sky wash at its darkest, just above the ridge line, behind
   *  the low snow hills in front of the map (light) and behind the tall
   *  massifs at the sides (dark). */
  oehun: 0xb3ada3,
  oehunDeep: 0x7d786f,
  /** The sky well above the ridges. */
  skyHigh: 0xe4e0d8,
  /** The screen-fixed band behind the title (equal to HANGA.bulguksa.top). */
  band: 0xc4beb3,
  /** Temple stone, walls (a light wet ink wash), boulders (a wet ink wash),
   *  shadow under the eaves, tile ends. */
  stone: 0xe4dfd4,
  wall: 0xd9d4ca,
  boulder: 0x8e897f,
  soffit: 0x9a958c,
  fascia: 0x56514a,
  /** Faint muted dancheong under the eaves (green, red). */
  danGreen: 0xb5c4b6,
  danRed: 0xcfaea4,
  /** Pine bark and needle pads. */
  bark: 0x6a6157,
  barkDark: 0x3a352f,
  pad: 0x2e2b26,
  padShadow: 0x9c978e,
  /** Cranes. */
  craneRed: 0xc8322a,
  /** Murmuration and the inscription. */
  bird: 0x24221e,
  seal: 0xc23a2c,
} as const;

// ---------------------------------------------------------------------------
// Massifs: four concentric walls, near to far. The crest is periodic value
// noise over azimuth (the Hanga ridge math) times an ENVELOPE that keeps the
// massifs low in front of and behind the map (theta near 0 and 180) and lets
// them rise as monumental masses at the sides, so at the home view no massif
// crosses the map's center region.

export interface MassifSpec {
  R: number;
  /** Silhouette floor (world y) and the rise above it at full envelope. */
  top: number;
  amp: number;
  lattice: number;
  octaves: number;
  seed: number;
  /** How far the base fades to mist below `top` (world units). */
  fadeSpan: number;
  /** Ink strength of the line marks (1 near, smaller far = mist). */
  ink: number;
}

export const MASSIFS: readonly MassifSpec[] = [
  // Round 3: the tops rise so the far crests reach about the map's upper
  // third at the home view, and each base fades into mist down to the slope.
  { R: 1750, top: -10, amp: 560, lattice: 22, octaves: 3, seed: 5, fadeSpan: 385, ink: 1 },
  { R: 2250, top: 65, amp: 700, lattice: 18, octaves: 3, seed: 17, fadeSpan: 460, ink: 0.78 },
  { R: 2750, top: 150, amp: 700, lattice: 15, octaves: 3, seed: 29, fadeSpan: 545, ink: 0.58 },
  { R: 3300, top: 260, amp: 800, lattice: 12, octaves: 2, seed: 43, fadeSpan: 655, ink: 0.42 },
];

/** Envelope over azimuth: 0.08 in front and behind, 1 at the sides. */
/**
 * Where the snow covers a whole face: the low snow hills in front of and
 * behind the map (envelope under SNOW_ALL_ENV) are untouched paper top to
 * bottom, so at the home view the map prints over snow, never over rock.
 * The rock shows from SNOW_ALL_ENV and fully from SNOW_ROCK_ENV.
 */
export const SNOW_ALL_ENV = 0.0;
export const SNOW_ROCK_ENV = 0.12;

/**
 * Mist over the map (round 3). Rock may lie behind the map's body at the home
 * view, but there it pales toward the paper by MIST_PALE, enough that every
 * obangsaek pigment keeps 3:1 against the paled tone even where the darkest
 * sumi mark lies (tests/bulguksa.test.ts samples the map body's 5th to 95th
 * percentile box). The mist covers the part of each ring that the home
 * camera sees inside the map's width (|ndc x| under MIST_SIN0, gone by
 * MIST_SIN1; the back hemisphere mirrors it for the reverse view) and lifts
 * above the map's top edge, so the ink prints at full strength above the map
 * and at the sides.
 */
export const MIST_PALE = 0.8;
export const MIST_SIN0 = 0.76;
export const MIST_SIN1 = 0.88;
/** The world height of the map's top edge at the home view, on a ring at (theta, R). */
export function mistTopY(theta: number, R: number): number {
  return -5.5 + 0.2207 * (918 + R * Math.abs(Math.cos(theta)));
}
export function massifPale(theta: number, y: number, R: number): number {
  const D = 918 + R * Math.abs(Math.cos(theta));
  const s = Math.abs(R * Math.sin(theta)) / (D * 0.746);
  const t0 = Math.min(1, Math.max(0, (s - MIST_SIN0) / (MIST_SIN1 - MIST_SIN0)));
  const m = 1 - t0 * t0 * (3 - 2 * t0);
  const yt = mistTopY(theta, R);
  const v = Math.min(1, Math.max(0, (y - (yt - 40)) / 160));
  const sm = (x: number): number => x * x * (3 - 2 * x);
  // The shader also mists the title block's corner in screen space (MASSIF_FRAG).
  return MIST_PALE * m * (1 - sm(v));
}
export function massifSnowAll(theta: number): number {
  const e = massifEnvelope(theta);
  const t = Math.min(1, Math.max(0, (e - SNOW_ALL_ENV) / (SNOW_ROCK_ENV - SNOW_ALL_ENV)));
  return 1 - t * t * (3 - 2 * t);
}

export function massifEnvelope(theta: number): number {
  const s = Math.abs(Math.sin(theta));
  const t = Math.min(1, Math.max(0, (s - 0.5) / 0.42));
  return 0.08 + 0.92 * t * t * (3 - 2 * t);
}

/** Crest height (world y) of a massif at azimuth theta (mirrors massifCrest in GLSL). */
export function massifCrest(m: MassifSpec, theta: number): number {
  const u = theta / TAU;
  let s = 0;
  let a = 1;
  let tot = 0;
  let n = m.lattice;
  for (let o = 0; o < m.octaves; o++) {
    s += a * pnoise(u, n, m.seed * 7 + o);
    tot += a;
    a *= 0.42;
    n *= 2;
  }
  const v = Math.min(1, Math.max(0, s / tot));
  // Peaks: a sharpened noise, so crests read as granite tops, not hills.
  const peak = Math.pow(v, 1.6);
  return m.top + m.amp * massifEnvelope(theta) * Math.min(1.2, peak / 0.55);
}
export const massifCeiling = (m: MassifSpec): number => m.top + m.amp * 1.2;

// ---------------------------------------------------------------------------
// Floor: the snow slope, a gentle dome of untouched paper under the map.
export const FLOOR = {
  /** Height at the center and the drop to the rim (world y, local to the map center). */
  y0: -255,
  drop: 140,
  r0: 560,
  r1: 1700,
  R: 1760,
} as const;
export const floorY = (r: number): number => {
  const t = Math.min(1, Math.max(0, (r - FLOOR.r0) / (FLOOR.r1 - FLOOR.r0)));
  return FLOOR.y0 - FLOOR.drop * t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// Home camera model (for the composition tests): level, 50 degree vertical fov.
export const HOME = { cam: [0, -5.5, 918] as const, fovY: 50 * DEG } as const;

/** Project a local point at the home view: [ndcX, ndcY, depth]. */
export function homeProject(p: readonly [number, number, number], aspect: number): [number, number, number] {
  const depth = HOME.cam[2] - p[2];
  const t = Math.tan(HOME.fovY / 2);
  return [(p[0] - HOME.cam[0]) / (depth * t * aspect), (p[1] - HOME.cam[1]) / (depth * t), depth];
}
export const ndcToPx = (ndc: readonly [number, number], w: number, h: number): [number, number] => [
  ((ndc[0] + 1) / 2) * w,
  ((1 - ndc[1]) / 2) * h,
];
/** A direction (azimuth, elevation) from the map center, as screen px at the home view. */
export function homeSkyPx(az: number, el: number, R: number, w: number, h: number): [number, number] {
  const p: [number, number, number] = [R * Math.sin(az), R * Math.tan(el), -R * Math.cos(az)];
  const n = homeProject(p, w / h);
  return ndcToPx([n[0], n[1]], w, h);
}

// ---------------------------------------------------------------------------
// Temple: the complex in plan units (front terrace width 100), scaled into the
// world by TEMPLE.scale and placed in front of the map, below it.
export const TEMPLE = {
  /** Width of the front terrace in plan units. */
  width: 100,
  /** World units per plan unit (across): the front spans about 1.15 frames. */
  scale: 9.23,
  /**
   * The raised viewpoint of the ink tradition: heights and depths print
   * compressed against the width (0.4 and 0.32 of it), so the whole complex
   * reads from slightly above and its roofs print below the grade labels.
   */
  yScale: 0.4,
  zScale: 0.32,
  /** The plan's x = 0 (the terrace's centre) in world x: Daeungjeon's axis
   *  (plan x 22) on the frame's centre line. */
  x: -203,
  /** Front face of the terrace (world z) and its ground (world y). */
  z: 380,
  y: -255,
} as const;

/** The snowfield in front of the terrace (world x and z): ink marks and a path. */
export const SLOPE_FRONT = { x0: -560, x1: 470, z0: 404, z1: 640, count: 34 } as const;
/** The path's centre line: from the stair foot (Daeungjeon's axis) toward the viewer. */
export const pathX = (z: number): number => TEMPLE.x + 22 * TEMPLE.scale + 26 * Math.sin((z - SLOPE_FRONT.z0) / 90);

/** Temple ink line: heavy (roofs) and medium (walls, terraces, stairs) widths
 *  in world units, so near edges print heavier; the ruled hairlines' opacity. */
export const TEMPLE_LINE = { heavy: 1.8, medium: 0.85, hairOpacity: 0.36 } as const;

/** The share of the frame width the temple front spans at the home view. */
export function templeFrameShare(aspect: number): number {
  const half = (TEMPLE.width * TEMPLE.scale) / 2;
  const a = homeProject([TEMPLE.x - half, TEMPLE.y, TEMPLE.z], aspect);
  const b = homeProject([TEMPLE.x + half, TEMPLE.y, TEMPLE.z], aspect);
  return (b[0] - a[0]) / 2;
}

// ---------------------------------------------------------------------------
// Pines: two framing pines (left and right of the home view) and small ones
// along the slope. Positions are world (local) coordinates of the trunk foot.
export interface PineSpec {
  x: number;
  z: number;
  /** Height of the trunk to the crown top. */
  h: number;
  /** Lean of the trunk toward +x (radians, signed) and the crown's reach. */
  lean: number;
  reach: number;
  seed: number;
  /** Which side most limbs reach toward (+1 = +x). Defaults to the lean side. */
  limbSide?: number;
}
// The framing pines stand low enough that the home camera looks DOWN onto
// their crowns (the snow on the pads shows); the small ones stand outside the
// map's footprint at the home view, or behind the camera for the orbit.
export const PINES: readonly PineSpec[] = [
  { x: -335, z: 468, h: 225, lean: 0.22, reach: 120, seed: 3, limbSide: -1 },
  { x: 345, z: 438, h: 290, lean: -0.2, reach: 115, seed: 11, limbSide: 1 },
  { x: -850, z: -420, h: 150, lean: 0.12, reach: 80, seed: 23 },
  { x: 900, z: -440, h: 170, lean: -0.1, reach: 85, seed: 31 },
  { x: -1260, z: -1000, h: 160, lean: 0.08, reach: 80, seed: 41 },
  { x: 1300, z: -950, h: 150, lean: -0.15, reach: 75, seed: 53 },
  { x: 260, z: -1350, h: 170, lean: 0.2, reach: 85, seed: 61 },
  { x: -1150, z: 650, h: 180, lean: 0.2, reach: 90, seed: 71 },
  { x: 1200, z: 620, h: 160, lean: -0.2, reach: 85, seed: 83 },
];

// ---------------------------------------------------------------------------
// Cranes: one flight of 4 to 6 red-crowned cranes crosses the right half of
// the sky on the Hanga schedule (craneScheduleInto: about 40 s, then 50 to 90 s
// of empty sky), high over the murmuration and clear of the title block.
export const BCRANE = {
  R: 3300,
  RSpan: 120,
  /** Elevation band (radians) and the arc in azimuth. */
  el: 25 * DEG,
  elSpan: 1 * DEG,
  az0: 46 * DEG,
  az1: 18 * DEG,
  /** Quad half-size in world units: about 18 px wingspan at the home view. */
  size: 48,
  /** One slow, deep stroke (seconds). */
  wingPeriod: 3.4,
  maxCount: 6,
} as const;
export const BCRANE_SLOTS: readonly [number, number, number][] = [
  // lag along the path, rise (world units), wing phase (0..1)
  [0, 0, 0.0],
  [0.022, 70, 0.17],
  [0.026, -64, 0.34],
  [0.046, 142, 0.51],
  [0.052, -130, 0.68],
  [0.072, 205, 0.85],
];
export function bcraneCount(k: number): number {
  return 4 + Math.min(2, Math.floor(lhash(1925, k) * 3));
}
/** Direction of crossing k: odd crossings fly right to left. */
export const bcraneDir = (k: number): number => (k % 2 === 0 ? 1 : -1);

// ---------------------------------------------------------------------------
// Murmuration: one folded thin sheet of starlings in the sky above the
// massifs, between the title block and the inscription. Uniform density in
// the sheet, a sharp edge, a thin straggler fringe. Moved in the vertex
// shader; every period is 20 s or longer.
export const BMURM = {
  count: 1200,
  /** Share of birds in the straggler fringe. */
  fringe: 0.05,
  az: 28 * DEG,
  el: 21 * DEG,
  R: 3400,
  /** Sheet half-extents (world units): along, across, and thickness. */
  a: 420,
  b: 440,
  th: 12,
  /** The sheet leans this far from face-on (radians), and swings by tiltSwing. */
  tilt: 1.3,
  tiltSwing: 0.16,
  pTilt: 53,
  /** Fold amplitude (world units) and the slow periods (seconds). */
  fold: 170,
  pFold: 29,
  pTurn: 61,
  pDrift: 47,
  pEdge: 37,
  /** How far the center drifts (radians, world units). */
  azSwing: 2.5 * DEG,
  elSwing: 0.7 * DEG,
  /** Speck size in CSS px. */
  px0: 1.8,
  px1: 2.8,
} as const;

/** The sheet edge radius in the (u, v) unit disc at angle phi and time t (0.82 to 1). */
export function murmEdge(phi: number, t: number): number {
  const e1 = Math.sin(2 * phi + (t * TAU) / BMURM.pEdge);
  const e2 = Math.sin(3 * phi - (t * TAU) / (BMURM.pEdge * 1.37) + 1.1);
  return 0.91 + 0.06 * e1 + 0.03 * e2;
}

/** Seed of bird i: (u, v) in the unit disc (fringe birds just outside), and two hashes. */
export function murmSeed(i: number): [number, number, number, number] {
  const fr = lhash(811, i) < BMURM.fringe;
  const phi = lhash(812, i) * TAU;
  // Uniform area density: r = sqrt(rand). Fringe birds sit 1.0 to 1.3 edges out.
  const r = fr ? 1.0 + 0.3 * lhash(813, i) : Math.sqrt(lhash(813, i));
  return [r * Math.cos(phi), r * Math.sin(phi), lhash(814, i), fr ? 1 : 0];
}

/** Where bird i is at time t, local coordinates (mirrors the vertex shader). */
export function murmPosition(i: number, t: number): [number, number, number] {
  const [u0, v0, h, fr] = murmSeed(i);
  const phi = Math.atan2(v0, u0);
  const r = Math.hypot(u0, v0) * murmEdge(phi, t);
  const u = r * Math.cos(phi);
  const v = r * Math.sin(phi);
  const w = TAU / BMURM.pFold;
  // Fold: the sheet bends through its thickness axis.
  const f = BMURM.fold * (Math.sin(1.7 * u + t * w) * 0.7 + Math.sin(2.3 * v - t * w * 0.8 + 1.3) * 0.3);
  const jit = fr ? 60 : 8;
  const ju = jit * Math.sin((t * TAU) / (22 + 18 * h) + h * 40);
  const jv = jit * Math.sin((t * TAU) / (25 + 15 * h) + h * 23);
  const along = u * BMURM.a + ju;
  const across = v * BMURM.b + jv;
  const thick = (h - 0.5) * 2 * BMURM.th + f;
  // The sheet leans away from face-on, so it reads as a band whose folds
  // thicken where they turn toward the viewer.
  const tl = BMURM.tilt + BMURM.tiltSwing * Math.sin((t * TAU) / BMURM.pTilt);
  const up = across * Math.cos(tl) - thick * Math.sin(tl);
  const depth = across * Math.sin(tl) + thick * Math.cos(tl);
  // The sheet turns slowly about the vertical: its visible thickness changes.
  const turn = 0.5 * Math.sin((t * TAU) / BMURM.pTurn);
  const az = BMURM.az + BMURM.azSwing * Math.sin((t * TAU) / BMURM.pDrift);
  const el = BMURM.el + BMURM.elSwing * Math.sin((t * TAU) / (BMURM.pDrift * 1.3) + 0.7);
  const cx = BMURM.R * Math.sin(az);
  const cz = -BMURM.R * Math.cos(az);
  const cy = BMURM.R * Math.tan(el);
  // Basis: T tangent to the sky circle, N toward the center, both turned by `turn`.
  const tx = Math.cos(az);
  const tz = Math.sin(az);
  const nx = -Math.sin(az);
  const nz = Math.cos(az);
  const ct = Math.cos(turn);
  const st = Math.sin(turn);
  const Tx = tx * ct + nx * st;
  const Tz = tz * ct + nz * st;
  const Nx = -tx * st + nx * ct;
  const Nz = -tz * st + nz * ct;
  return [cx + Tx * along + Nx * depth, cy + up, cz + Tz * along + Nz * depth];
}

// ---------------------------------------------------------------------------
// Falling snow: sparse large flakes in a box around the camera target.
export const SNOW = {
  count: 900,
  /** Box half-extents (world units). */
  hx: 1300,
  hy: 700,
  hz: 1300,
  /** Fall speed range (units per second) and sideways drift. */
  v0: 14,
  v1: 26,
  drift: 30,
  pDrift0: 9,
  pDrift1: 16,
  /** Flake diameter range, CSS px at 900 units. */
  px0: 2.6,
  px1: 5,
} as const;

/** Where flake i sits at time t, relative to the box center (mirrors the vertex shader). */
export function snowOffset(i: number, t: number): [number, number, number] {
  const sx = lhash(1201, i);
  const sy = lhash(1202, i);
  const sz = lhash(1203, i);
  const sv = lhash(1204, i);
  const v = SNOW.v0 + (SNOW.v1 - SNOW.v0) * sv;
  const pd = SNOW.pDrift0 + (SNOW.pDrift1 - SNOW.pDrift0) * sx;
  const wrap = (x: number, h: number): number => ((((x + h) % (2 * h)) + 2 * h) % (2 * h)) - h;
  return [
    wrap((sx - 0.5) * 2 * SNOW.hx + SNOW.drift * Math.sin((t * TAU) / pd + sz * 9), SNOW.hx),
    wrap((sy - 0.5) * 2 * SNOW.hy - v * t, SNOW.hy),
    wrap((sz - 0.5) * 2 * SNOW.hz + 0.6 * SNOW.drift * Math.cos((t * TAU) / (pd * 1.3) + sy * 7), SNOW.hz),
  ];
}

// ---------------------------------------------------------------------------
// The inscription: a vertical line of seven characters with a seal beneath,
// on the sky at a fixed world azimuth (it moves with orbit like ink on the sheet).
export const INSCRIPTION = {
  text: "佛國雪中數理圖",
  az: 40 * DEG,
  /** Elevation of the top and bottom of the column (seal included). */
  el0: 23 * DEG,
  el1: 12.5 * DEG,
  R: 3000,
} as const;

// ---------------------------------------------------------------------------
// Contrast (WCAG 2.x), on sRGB hex.
const lin = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
export function relLum(hex: number): number {
  return 0.2126 * lin((hex >> 16) & 255) + 0.7152 * lin((hex >> 8) & 255) + 0.0722 * lin(hex & 255);
}
export function contrastHex(a: number, b: number): number {
  const la = relLum(a);
  const lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Mix two sRGB hexes in LINEAR light (k = share of b), back to sRGB hex. */
export function mixLinearHex(a: number, b: number, k: number): number {
  const toS = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
  let out = 0;
  for (const sh of [16, 8, 0]) {
    const x = lin((a >> sh) & 255);
    const y = lin((b >> sh) & 255);
    const v = Math.round(Math.min(1, Math.max(0, toS(x + (y - x) * k))) * 255);
    out |= v << sh;
  }
  return out;
}

/** Every massif FILL tone a map mark can print over (the contrast gate). */
/** Every massif SNOW tone a map mark can print over (the contrast gate). The
 *  rock wash is dark by design and never lies behind the map at the home view
 *  (massifSnowAll, tested). */
export function massifFillTones(): number[] {
  return [INK.paper, INK.shade, INK.crest];
}

// ---------------------------------------------------------------------------
// Story separation (the Washi measurement, for style 5): median luminance
// (0..255) of a lit disc and a damaged disc, composited over the paper, with
// the same law as the Hanga disc shader on Washi-type fields: the pigment
// washes toward the field by WASH * d and sheds WASH_ALPHA * d of opacity.
export function discLuminance(pigment: number, field: number, damage: number, wash: number, washAlpha: number): number {
  const f = [16, 8, 0].map((s) => lin((field >> s) & 255));
  const p = [16, 8, 0].map((s) => lin((pigment >> s) & 255));
  const c = p.map((v, i) => v + (f[i] - v) * wash * damage);
  const a = 1 - washAlpha * damage;
  const o = c.map((v, i) => v * a + f[i] * (1 - a));
  const toS = (x: number): number => (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055);
  const s = o.map(toS);
  return 255 * (0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]);
}
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
