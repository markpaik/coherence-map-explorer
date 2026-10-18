// Hanga landscape: the 3D world around the map in the two woodblock styles
// (3 Washi, 4 Dusk), after Utagawa Hiroshige. Built from the approved previews
// (scripts/hanga-landscape-previews.mjs) with the "more landscape" pass, then
// rebuilt from a study of open-access prints and photographs (docs/DESIGN.md,
// "Hanga landscape").
//
// Parts, far to near (each is one draw call, drawn in that order):
//   sky body   the Washi sun or the Dusk moon, a camera-facing disc and halo
//   Fuji       Hiroshige's profile (landscape/fuji.ts) at a fixed azimuth
//              beyond the far ring: snow cap with tongues down the gullies, a
//              flat bokashi body, a slow waterfall line, alpenglow on Dusk
//   birds      a flight of red-crowned cranes (landscape/crane.ts) on both
//              styles, and on Dusk one murmuration as a folded sheet
//              (landscape/murmuration.ts)
//   ring 4..1  concentric cylinder walls. The silhouette is computed per
//              fragment from seamless periodic value noise over azimuth, with a
//              dry-brush crest bokashi and a fade to mist at the base. Far rings
//              print paler, as distance layers
//   far pines  small ink marks on ring 3's crest (landscape/flora.ts)
//   mist       suyari-gasumi bands at three depths between the rings: flat
//              tops, lobed rounded ends, a thin darker underline, filled with
//              the exact field color behind them (HANGA_FIELD_GLSL)
//   floor      a flat bokashi water field with rows of short tapered crest
//              strokes that recede toward the far shore; on Dusk a moon path
//   pines      two framing pines at the near left and right (trunks, then pads)
//   reeds      a reed bank at the near shore, left of the map
//
// Legibility: the map stays the subject. Every color the strokes can cross
// (ring body, crest band) keeps a contrast ratio of 2.5 or more against the
// Washi gold and teal pigments (tests/landscape.test.ts).
//
// Motion: every period is several seconds or longer and nothing pulses in
// brightness. `quiet` (a story or a focus) fades the birds out over about 2 s.
// Reduced motion freezes the water, mist, waterfall, and reeds at a fixed phase
// and hides the birds. The group is invisible outside styles 3 and 4, so the
// Galaxy and the other styles draw nothing from here.

import * as THREE from "three";
import { HANGA } from "./artstyle";
import { HANGA_FIELD_GLSL, HANGA_SCREEN_UNIFORMS, SHELL_RADIUS } from "./environs";
import { CREST_DEPTH, DEG, FLOOR_Y, NOISE_GLSL, RINGS, TAU, easeQuiet, f, lhash, ringCeiling, smooth01 } from "./landscape/core";
import {
  CRANE,
  CRANE_SKY,
  CRANE_FRAG,
  CRANE_SLOTS,
  CRANE_VERT,
  craneScheduleInto,
  cranePathInto,
  type CranePath,
  type CraneState,
} from "./landscape/crane";
import { MURM_SHEET_FRAG, MURM_SHEET_VERT, SHEET, murmSheetSeed } from "./landscape/murmuration";
import { FUJI, FUJI_FRAG, FUJI_TONGUES, FUJI_VERT, buildFujiGeometry } from "./landscape/fuji";
import {
  CARD_FRAG,
  CARD_VERT,
  REED_FRAG,
  REED_VERT,
  TRUNK_FRAG,
  TRUNK_VERT,
  buildCards,
  buildPineTrunks,
  buildReeds,
} from "./landscape/flora";

// The public surface stays where it was: other modules import these from here.
export * from "./landscape/core";
export * from "./landscape/crane";
export * from "./landscape/murmuration";
export * from "./landscape/murmuration-cloud";
export * from "./landscape/fuji";
export * from "./landscape/flora";

/** The old peak's placement, kept for importers: Fuji stands exactly there. */
export const PEAK = { az: FUJI.az, R: FUJI.R, apex: FUJI.apex } as const;

/** Sun (Washi) or moon (Dusk): the preview's azimuth and distance (the old star
 *  shell), set lower than the preview's 9.5 deg so the disc clears the Ascent's
 *  depth label and the title block at the left edge. */
export const SKY_BODY = { az: -40 * DEG, el: 5 * DEG, dist: 3600, r: 66 } as const;

// ---------------------------------------------------------------------------
// Suyari-gasumi: four bands per gap. az and halfSpan in radians; h is the
// band's middle and th its full height (world units). Each band has a flat
// bottom and a flat top; each end is two lobes stepping out and down.

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
/** Lobes at each end: [inset from the end, center height, radius], in units of
 *  the band height. The first lobe rounds the full height; the second steps
 *  out and down. */
export const MIST_LOBES: readonly [number, number, number][] = [
  [0.5, 0.5, 0.5],
  [0.06, 0.29, 0.29],
];
/** Signed distance (world units, negative inside) of a mist band at arc
 *  length X from its middle and height y above its flat bottom. */
export function mistBandSd(b: MistBand, R: number, X: number, y: number): number {
  const L = b.halfSpan * R;
  const ax = Math.abs(X);
  const body = Math.max(ax - (L - 0.5 * b.th), Math.max(-y, y - b.th));
  let sd = body;
  for (const [inset, cy, r] of MIST_LOBES) {
    sd = Math.min(sd, Math.hypot(ax - (L - inset * b.th), y - cy * b.th) - r * b.th);
  }
  return Math.max(sd, -y);
}

// ---------------------------------------------------------------------------
// Water: rows of short tapered crest strokes, receding toward the far shore.

export const WATER = {
  /** The shore radius (just inside ring 1) and the rows inward from it. */
  shore: RINGS[0].R - 16,
  rows: 8,
  rowGap: 30,
  /** Each row's gap grows by this share per row toward the viewer. */
  rowGrow: 0.14,
  /** Cell length along the row (world units), the stroke's share of a cell,
   *  the crest's rise (sagitta) and the stroke's half-thickness. */
  cell: 90,
  sag: 7,
  thick: 4,
  /** Drift along the shore (radians per second): about a cell a minute. */
  drift: 0.0006,
} as const;
/** Radius of crest row k. */
export function waterRow(k: number): number {
  let r = WATER.shore;
  for (let i = 0; i < k; i++) r -= WATER.rowGap * (1 + WATER.rowGrow * i);
  return r;
}

// ---------------------------------------------------------------------------
// Palettes (sRGB hex). Washi uses the preview sheet's ridge, crest, and peak
// colors: Washi gold and teal keep 2.5:1 or more on every ring body and crest
// band (tests/landscape.test.ts).

export interface LandPalette {
  rings: [number, number, number, number];
  crest: number;
  crestOp: [number, number, number, number];
  peak: number;
  peakTop: number;
  peakBase: number;
  cap: number;
  capOp: number;
  glow: number;
  glowOp: number;
  gully: number;
  gullyOp: number;
  peakLine: number;
  peakLineOp: number;
  falls: number;
  fallsOp: number;
  floor: number;
  floorOp: number;
  wave: number;
  waveOp: number;
  /** Moon path on the water (Dusk): the glint color and its strength. */
  glint: number;
  glintOp: number;
  mistLine: number;
  mistLineOp: number;
  /** Sun or moon: disc center, disc edge, halo inner, halo outer. */
  disc0: number;
  disc1: number;
  halo0: number;
  halo1: number;
  haloOp: number;
  discScale: number;
  haloScale: number;
  /** Cranes: plumage, the black block and neck, legs, cap, bill, key line. */
  craneWhite: number;
  craneBlack: number;
  craneLeg: number;
  craneCap: number;
  craneBill: number;
  craneLine: number;
  craneLineOp: number;
  craneOp: number;
  /** The murmuration's ink. */
  bird: number;
  birdOp: number;
  /** Pines: bark and cracks, pads and their underside, key line, moon rim. */
  bark: number;
  crack: number;
  pad: number;
  padDark: number;
  pineLine: number;
  pineLineOp: number;
  rim: number;
  rimOp: number;
  farPine: number;
  farPineOp: number;
  /** Reeds: stems and leaves, panicles. */
  reed: number;
  plume: number;
  reedOp: number;
}

export const LAND: { washi: LandPalette; dusk: LandPalette } = {
  washi: {
    // near (grey-green) to far (pale Prussian blue); the far two print paler,
    // as distance layers
    rings: [0xcbd3c6, 0xcfd8d0, 0xd7dfdf, 0xdfe6e9],
    crest: 0x6d889f, // ridge-top bokashi ink (Prussian grey)
    // Preview opacities 0.20 / 0.18 / 0.16 / 0.14, capped on the two near rings
    // so the deepest crest ink keeps 2.5:1 against Washi gold.
    crestOp: [0.055, 0.13, 0.15, 0.12],
    peak: 0xc9d5df,
    peakTop: 0x9fb4c8,
    peakBase: 0xe3e5dd,
    cap: 0xf7f5ef,
    capOp: 0.97,
    glow: 0xf7f5ef,
    glowOp: 0,
    gully: 0x7d93aa,
    gullyOp: 0.32,
    peakLine: 0x2b4a70,
    peakLineOp: 0.3,
    falls: 0xf8f6f1,
    fallsOp: 0.38,
    floor: 0x9fb2bf,
    floorOp: 0.18,
    wave: 0x2b4a70,
    waveOp: 0.75,
    glint: 0xf8f6f1,
    glintOp: 0,
    mistLine: 0x6d889f,
    mistLineOp: 0.3,
    disc0: 0xe2683e,
    disc1: 0xe57a52,
    halo0: 0xec9a6c,
    halo1: 0xefb88a,
    haloOp: 0.34,
    discScale: 1,
    haloScale: 4.2,
    craneWhite: 0xf7f3ea,
    craneBlack: 0x1c1a17,
    craneLeg: 0x34302b,
    craneCap: 0xc8372d,
    craneBill: 0x9a9468,
    craneLine: 0x1c1a17,
    craneLineOp: 0.5,
    craneOp: 0.96,
    bird: 0x1c1a17,
    birdOp: 0.8,
    bark: 0x3b342c,
    crack: 0x7a6d5c,
    pad: 0x4f6b4f, // pine green
    padDark: 0x2f4637,
    pineLine: 0x1c1a17,
    pineLineOp: 0.55,
    rim: 0xf7f3ea,
    rimOp: 0,
    farPine: 0x51667a,
    farPineOp: 0.8,
    reed: 0x5f7556,
    plume: 0x8d7352,
    reedOp: 0.92,
  },
  dusk: {
    rings: [0x24365a, 0x2b3e63, 0x33486d, 0x3d5379],
    crest: 0x111d36,
    crestOp: [0.42, 0.36, 0.3, 0.26],
    peak: 0x3b5179,
    peakTop: 0x2a3c60,
    peakBase: 0x3b5179,
    cap: 0x9aa6bf,
    capOp: 0.66,
    glow: 0xd9a493, // alpenglow on the summit
    glowOp: 0.55,
    gully: 0x1d2c4a,
    gullyOp: 0.5,
    peakLine: 0xcdd6e6,
    peakLineOp: 0.16,
    falls: 0xb6bfd3,
    fallsOp: 0.2,
    floor: 0x1b2b4a,
    floorOp: 0.22,
    wave: 0xb8c7de,
    waveOp: 0.45,
    glint: 0xf1ead8,
    glintOp: 0.7,
    mistLine: 0x0e182e,
    mistLineOp: 0.35,
    disc0: 0xf1ead8,
    disc1: 0xdcd6c8,
    halo0: 0xd8dfeb,
    halo1: 0x9fb0cc,
    haloOp: 0.2,
    discScale: 0.62,
    haloScale: 4.6,
    // Pale moonlit plumage, the block in night ink.
    craneWhite: 0xcfd6e3,
    craneBlack: 0x0f1729,
    craneLeg: 0x1a2133,
    craneCap: 0xa8524a,
    craneBill: 0x7c8090,
    craneLine: 0x0f1729,
    craneLineOp: 0.35,
    craneOp: 0.85,
    // Mid slate ink: it shows against the deep aizuri band and the lighter sky.
    bird: 0x7d8ea8,
    birdOp: 0.62,
    bark: 0x0d1526,
    crack: 0x1a2640,
    pad: 0x101b30,
    padDark: 0x0b1424,
    pineLine: 0x2a3856, // needles print a shade lighter than the silhouette
    pineLineOp: 0.55,
    rim: 0xc8d2e4,
    rimOp: 0.3,
    farPine: 0x15213b,
    farPineOp: 0.85,
    reed: 0x111b2f,
    plume: 0x1f2b45,
    reedOp: 0.95,
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
// GLSL: rings, mist, floor, sky body.

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
  // Brush hairs: value noise, periodic in the turn u (N cells), smooth in v.
  float hairs(float u, float v, int N, int seed) {
    float x = fract(u) * float(N);
    int i0 = int(floor(x));
    int i1 = (i0 + 1) % N;
    float fx = smoothstep(0.0, 1.0, fract(x));
    float j = floor(v);
    float fy = smoothstep(0.0, 1.0, v - j);
    int j0 = int(j) + 4096;
    float a = mix(lhash(seed + j0 * 31, i0), lhash(seed + j0 * 31, i1), fx);
    float b = mix(lhash(seed + (j0 + 1) * 31, i0), lhash(seed + (j0 + 1) * 31, i1), fx);
    return mix(a, b, fy);
  }
  void main() {
    float theta = atan(vLocal.x, -vLocal.z);
    float d = ridgeH(theta) - vLocal.y; // > 0 below the crest
    // Anti-aliased crest: coverage from the screen-space derivative.
    float w = max(fwidth(d), 1e-3);
    float cover = clamp(d / w + 0.5, 0.0, 1.0);
    if (cover <= 0.0) discard;
    // Dry-brush crest bokashi: solid ink at the crest, a ragged lower edge,
    // and horizontal hairs where the brush ran dry (crestInk in core.ts).
    float u = theta / 6.28318530718;
    float nEdge = pnoise(u, 90, uSeed + 3);
    float nHair = hairs(u, max(d, 0.0) / 5.0, 160, uSeed * 5 + 17);
    float reach = ${f(CREST_DEPTH)} * (0.7 + 0.55 * nEdge);
    float k = 1.0 - smoothstep(0.0, reach, d);
    float hair = clamp((nHair - 0.28) / 0.34, 0.0, 1.0);
    float dry = 1.0 - (1.0 - hair) * 0.75 * (1.0 - k);
    vec3 col = mix(uColor, uCrest, uCrestOp * k * k * dry);
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
  uniform float uR;
  uniform float uOpacity;
  uniform vec3 uLine;
  uniform float uLineOp;
  varying vec3 vLocal;
  varying vec3 vWorld;
  ${FIELD_SAMPLE_GLSL}
  // The band shape (mistBandSd in landscape.ts): a flat body, two lobes at
  // each end, cut flat at the bottom.
  float bandSd(float X, float y, float L, float th) {
    float ax = abs(X);
    float sd = max(ax - (L - 0.5 * th), max(-y, y - th));
    sd = min(sd, length(vec2(ax - (L - ${f(MIST_LOBES[0][0])} * th), y - ${f(MIST_LOBES[0][1])} * th)) - ${f(MIST_LOBES[0][2])} * th);
    sd = min(sd, length(vec2(ax - (L - ${f(MIST_LOBES[1][0])} * th), y - ${f(MIST_LOBES[1][1])} * th)) - ${f(MIST_LOBES[1][2])} * th);
    return max(sd, -y);
  }
  void main() {
    float theta = atan(vLocal.x, -vLocal.z);
    float a = 0.0;
    float line = 0.0;
    for (int k = 0; k < 4; k++) {
      vec4 b = uBands[k];
      float da = mod(theta - b.x + 3.14159265, 6.28318530718) - 3.14159265;
      if (abs(da) > b.y * 1.2) continue;
      float X = da * uR;
      float y = vLocal.y - (b.z - 0.5 * b.w);
      float sd = bandSd(X, y, b.y * uR, b.w);
      float fw = max(fwidth(sd), 1e-3);
      float c = clamp(0.5 - sd / fw, 0.0, 1.0);
      a = max(a, c);
      // A thin darker underline along the flat bottom.
      float fy = max(fwidth(y), 1e-3);
      float ul = (1.0 - smoothstep(0.4 * fy, 1.4 * fy, y)) * step(-0.5 * fy, y);
      ul *= clamp(0.5 - (abs(X) - (b.y * uR - 0.6 * b.w)) / max(fwidth(X), 1e-3), 0.0, 1.0);
      line = max(line, ul);
    }
    a *= uOpacity;
    line *= uLineOp;
    float alpha = max(a, line);
    if (alpha < 0.003) discard;
    vec3 col = mix(fieldBehind(vWorld), uLine, line / max(alpha, 1e-4));
    gl_FragColor = vec4(col, alpha);
  }
`;

const FLOOR_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uFloor;
  uniform vec3 uWave;
  uniform float uWaveOp;
  uniform vec3 uGlint;
  uniform float uGlintOp;
  uniform vec2 uMoonXZ; // unit direction toward the moon in the xz plane
  varying vec3 vLocal;
  varying vec3 vWorld;
  ${FIELD_SAMPLE_GLSL}
  float lh(int s, int i) {
    uint h = uint(i) * 0x9E3779B1u + uint(s) * 0x85EBCA77u;
    h ^= h >> 15u; h *= 0x2C1B3C6Du; h ^= h >> 12u; h *= 0x297A2D39u; h ^= h >> 15u;
    return float(h >> 8u) / 16777216.0;
  }
  // One row of short tapered crest strokes at radius rRow: a small arc that
  // bows toward the far shore, thick in the middle and pointed at both ends.
  // keep: the share of cells that hold a stroke. Returns coverage.
  float crestRow(float r, float phi, float rRow, int seed, float drift, float keep) {
    float cells = floor(6.28318530718 * rRow / ${f(WATER.cell)});
    float ph = fract((phi - drift) / 6.28318530718) * cells;
    float ci = floor(ph);
    float s = ph - ci;
    int id = int(ci);
    if (lh(seed, id) > keep) return 0.0;
    float c0 = 0.08 + lh(seed + 1, id) * 0.3;
    float c1 = c0 + 0.3 + lh(seed + 2, id) * 0.25;
    if (s < c0 || s > c1) return 0.0;
    float u = (s - c0) / (c1 - c0);
    float off = ${f(WATER.sag)} * 4.0 * u * (1.0 - u) + (lh(seed + 3, id) - 0.5) * 5.0;
    float tw = ${f(WATER.thick)} * pow(sin(3.14159265 * u), 0.8);
    float fr = max(fwidth(r), 1e-3);
    float te = max(tw, 0.5 * fr);
    float dr = abs(r - (rRow + off));
    return clamp((te - dr) / fr + 0.5, 0.0, 1.0) * (tw / te);
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
    // The moon path (Dusk): from the camera toward the moon's azimuth, the
    // strokes thicken in number and print pale.
    vec3 camL = cameraPosition - (vWorld - vLocal); // the group only translates
    vec2 toF = vLocal.xz - camL.xz;
    float onPath = smoothstep(0.988, 0.9985, dot(normalize(toF), uMoonXZ)) * step(0.001, uGlintOp);
    float lines = 0.0;
    for (int k = 0; k < ${WATER.rows}; k++) {
      float rr = ${f(WATER.shore)};
      for (int i = 0; i < ${WATER.rows}; i++) {
        if (i >= k) break;
        rr -= ${f(WATER.rowGap)} * (1.0 + ${f(WATER.rowGrow)} * float(i));
      }
      if (abs(r - rr) > 20.0) continue;
      float dir = mod(float(k), 2.0) < 0.5 ? 1.0 : 0.8;
      float drift = uTime * ${f(WATER.drift)} * dir + float(k) * 0.37;
      float keep = mix(0.55, 0.9, onPath);
      float fade = 1.0 - float(k) / ${f(WATER.rows + 1)};
      lines = max(lines, crestRow(r, phi, rr, 31 + k * 7, drift, keep) * fade);
    }
    lines *= far * smoothstep(${f(RINGS[0].R - 360)}, ${f(RINGS[0].R - 200)}, r);
    vec3 ink = mix(uWave, uGlint, onPath);
    float inkOp = mix(uWaveOp, uGlintOp, onPath);
    col = mix(col, ink, lines * inkOp);
    float a = max(tint, lines * inkOp) * edge;
    if (a < 0.002) discard;
    // Opaque-composite of the field with the tint, then alpha so the edge melts.
    gl_FragColor = vec4(col, a / max(a, 1e-4) * edge);
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

/** The phase reduced motion holds the water, mist, waterfall, and reeds at. */
export const FROZEN_T = 240;
/** How far the landscape drops at the Ascent (the map is taller there). */
export const ASCENT_DROP = 70;
/** How far the left framing pine and the reeds fade at the Ascent, where the
 *  depth scale owns the left edge of the screen. */
export const ASCENT_SIDE_FADE = 0.85;

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
    depthWrite = false,
  ): THREE.ShaderMaterial => {
    const m = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      side,
      transparent: true,
      depthWrite,
      depthTest: true,
    });
    mats.push(m);
    return m;
  };
  const col = (): { value: THREE.Color } => ({ value: new THREE.Color() });

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
      uDisc0: col(),
      uDisc1: col(),
      uHalo0: col(),
      uHalo1: col(),
      uHaloOp: { value: 0.3 },
      uDiscR: { value: 0.24 },
    },
    THREE.DoubleSide,
  );
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -9.6;
  group.add(sky);
  // The moon, for the Dusk rims (world position fed each update).
  const moonWorld = new THREE.Vector3();
  const moonLocal = skyDir.clone().multiplyScalar(SKY_BODY.dist);

  // -- Fuji ----------------------------------------------------------------
  const fujiGeo = buildFujiGeometry();
  geos.push(fujiGeo);
  const fujiPos = new THREE.Vector3(FUJI.R * Math.sin(FUJI.az), 0, -FUJI.R * Math.cos(FUJI.az));
  // The waterfall faces the map center, a little to the right of it.
  const fallsPhi = Math.atan2(-fujiPos.z, -fujiPos.x) + 0.2;
  const tongues = FUJI_TONGUES.map(([az, w, len]) => new THREE.Vector3(az, w, len));
  const fujiMat = baseMat(
    FUJI_VERT,
    FUJI_FRAG,
    {
      uTime: { value: 0 },
      uPeak: col(),
      uPeakTop: col(),
      uPeakBase: col(),
      uCap: col(),
      uCapOp: { value: 1 },
      uGlow: col(),
      uGlowOp: { value: 0 },
      uGully: col(),
      uGullyOp: { value: 0.4 },
      uLine: col(),
      uLineOp: { value: 0.3 },
      uFalls: col(),
      uFallsOp: { value: 0.5 },
      uFallsPhi: { value: fallsPhi },
      uTongue: { value: tongues },
      uCamAz: { value: 0 },
    },
    THREE.FrontSide,
  );
  const fuji = new THREE.Mesh(fujiGeo, fujiMat);
  fuji.position.copy(fujiPos);
  fuji.renderOrder = -9.4;
  const fujiWorld = new THREE.Vector3();
  const camWorld = new THREE.Vector3();
  fuji.onBeforeRender = (_r, _s, camera) => {
    fuji.getWorldPosition(fujiWorld);
    camera.getWorldPosition(camWorld);
    fujiMat.uniforms.uCamAz.value = Math.atan2(camWorld.z - fujiWorld.z, camWorld.x - fujiWorld.x);
  };
  group.add(fuji);

  // -- rings ---------------------------------------------------------------
  const ringMats: THREE.ShaderMaterial[] = [];
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
        uColor: col(),
        uCrest: col(),
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
    group.add(mesh);
  });

  // -- distant pines on ring 3's crest (after ring 3, before what is nearer) --
  const farGeo = buildCards(1);
  geos.push(farGeo);
  const cardUniforms = (): Record<string, THREE.IUniform> => ({
    uPad: col(),
    uPadDark: col(),
    uLine: col(),
    uLineOp: { value: 0.5 },
    uRim: col(),
    uRimOp: { value: 0 },
    uOpacity: { value: 1 },
    uKind: { value: 0 },
    uMoonWorld: { value: moonWorld },
    uSideFade: { value: 0 },
  });
  const farMat = baseMat(CARD_VERT, CARD_FRAG, { ...cardUniforms(), uKind: { value: 1 } }, THREE.DoubleSide);
  const farPines = new THREE.Mesh(farGeo, farMat);
  farPines.frustumCulled = false;
  farPines.renderOrder = -8.3;
  group.add(farPines);

  // -- mist bands ----------------------------------------------------------
  const mistMeshes: THREE.Mesh[] = [];
  const mistMats: THREE.ShaderMaterial[] = [];
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
    const mat = baseMat(
      MIST_VERT,
      MIST_FRAG,
      { ...fieldU, uBands: { value: bandsU }, uR: { value: mr.R }, uOpacity: { value: 0.92 }, uLine: col(), uLineOp: { value: 0.3 } },
      THREE.BackSide,
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    // Mist ring i lies between rings 3 - i and 4 - i (1-based): drawn after the
    // ring behind it and before the ring in front of it.
    mesh.renderOrder = -8.6 + i * 0.4;
    mesh.onBeforeRender = feedFwd;
    mistMeshes.push(mesh);
    mistMats.push(mat);
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
      uFloor: col(),
      uWave: col(),
      uWaveOp: { value: 0.4 },
      uGlint: col(),
      uGlintOp: { value: 0 },
      uMoonXZ: { value: new THREE.Vector2(Math.sin(SKY_BODY.az), -Math.cos(SKY_BODY.az)) },
    },
    THREE.FrontSide,
  );
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.frustumCulled = false;
  floor.renderOrder = -7.4;
  floor.onBeforeRender = feedFwd;
  group.add(floor);

  // -- framing pines: trunks, then pads ------------------------------------
  const trunkGeo = buildPineTrunks();
  geos.push(trunkGeo);
  const trunkMat = baseMat(
    TRUNK_VERT,
    TRUNK_FRAG,
    {
      uBark: col(),
      uCrack: col(),
      uRim: col(),
      uRimOp: { value: 0 },
      uMoonDir: { value: skyDir.clone() },
      uOpacity: { value: 1 },
      uSideFade: { value: 0 },
    },
    THREE.FrontSide,
    true,
  );
  const trunks = new THREE.Mesh(trunkGeo, trunkMat);
  trunks.frustumCulled = false;
  trunks.renderOrder = -7.2;
  group.add(trunks);
  const padGeo = buildCards(0);
  geos.push(padGeo);
  const padMat = baseMat(CARD_VERT, CARD_FRAG, cardUniforms(), THREE.DoubleSide, true);
  const pads = new THREE.Mesh(padGeo, padMat);
  pads.frustumCulled = false;
  pads.renderOrder = -7.1;
  group.add(pads);

  // -- reeds ---------------------------------------------------------------
  const reedGeo = buildReeds();
  geos.push(reedGeo);
  const reedMat = baseMat(
    REED_VERT,
    REED_FRAG,
    { uTime: { value: 0 }, uStem: col(), uPlume: col(), uOpacity: { value: 1 }, uSideFade: { value: 0 } },
    THREE.DoubleSide,
    true,
  );
  const reeds = new THREE.Mesh(reedGeo, reedMat);
  reeds.frustumCulled = false;
  reeds.renderOrder = -7.0;
  group.add(reeds);

  // -- cranes --------------------------------------------------------------
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
      uAzMul: { value: 1 },
      uAzAdd: { value: 0 },
      uHAdd: { value: 0 },
      uRiseMul: { value: 1 },
      uHMul: { value: 1 },
      uR: { value: CRANE.R },
      uH0: { value: CRANE.h },
      uH1: { value: CRANE.h },
      uCount: { value: 3 },
      uTime: { value: 0 },
      uAlpha: { value: 0 },
      uSize: { value: CRANE.size },
      uWhite: col(),
      uBlack: col(),
      uLeg: col(),
      uCap: col(),
      uBill: col(),
      uLine: col(),
      uLineOp: { value: 0.5 },
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
  const sheetPos = new Float32Array(SHEET.count * 3);
  const sheetSeed = new Float32Array(SHEET.count * 3);
  for (let i = 0; i < SHEET.count; i++) {
    const sd = murmSheetSeed(i);
    sheetPos.set([sd.a, sd.b, sd.w], i * 3);
    sheetSeed.set([sd.s, sd.j, sd.fringe], i * 3);
  }
  murmGeo.setAttribute("position", new THREE.BufferAttribute(sheetPos, 3));
  murmGeo.setAttribute("aSeed", new THREE.BufferAttribute(sheetSeed, 3));
  geos.push(murmGeo);
  const murmMat = baseMat(
    MURM_SHEET_VERT,
    MURM_SHEET_FRAG,
    { uTime: { value: 0 }, uAlpha: { value: 0 }, uPx: { value: 1 }, uInk: col() },
    THREE.FrontSide,
  );
  const murm = new THREE.Points(murmGeo, murmMat);
  murm.frustumCulled = false;
  murm.renderOrder = -9.1;
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
  let craneRMul = 1;

  const hex = (u: THREE.IUniform, h: number): void => {
    (u.value as THREE.Color).setHex(h);
  };

  function paint(pal: LandPalette, dusk: boolean): void {
    const fieldPal = dusk ? HANGA.dusk : HANGA.washi;
    fieldU.uHMid.value.copy(srgb01(fieldPal.bg));
    fieldU.uHTop.value.copy(srgb01(fieldPal.top));
    fieldU.uHBottom.value.copy(srgb01(fieldPal.bottom));
    fieldU.uHWarm.value.copy(srgb01(fieldPal.warm));
    fieldU.uDusk.value = dusk ? 1 : 0;
    ringMats.forEach((m, i) => {
      hex(m.uniforms.uColor, pal.rings[i]);
      hex(m.uniforms.uCrest, pal.crest);
      m.uniforms.uCrestOp.value = pal.crestOp[i];
    });
    for (const m of mistMats) {
      hex(m.uniforms.uLine, pal.mistLine);
      m.uniforms.uLineOp.value = pal.mistLineOp;
    }
    const pu = fujiMat.uniforms;
    hex(pu.uPeak, pal.peak);
    hex(pu.uPeakTop, pal.peakTop);
    hex(pu.uPeakBase, pal.peakBase);
    hex(pu.uCap, pal.cap);
    pu.uCapOp.value = pal.capOp;
    hex(pu.uGlow, pal.glow);
    pu.uGlowOp.value = pal.glowOp;
    hex(pu.uGully, pal.gully);
    pu.uGullyOp.value = pal.gullyOp;
    hex(pu.uLine, pal.peakLine);
    pu.uLineOp.value = pal.peakLineOp;
    hex(pu.uFalls, pal.falls);
    pu.uFallsOp.value = pal.fallsOp;
    const fu = floorMat.uniforms;
    hex(fu.uFloor, pal.floor);
    fu.uOpacity.value = pal.floorOp;
    hex(fu.uWave, pal.wave);
    fu.uWaveOp.value = pal.waveOp;
    hex(fu.uGlint, pal.glint);
    fu.uGlintOp.value = pal.glintOp;
    const su = skyMat.uniforms;
    hex(su.uDisc0, pal.disc0);
    hex(su.uDisc1, pal.disc1);
    hex(su.uHalo0, pal.halo0);
    hex(su.uHalo1, pal.halo1);
    su.uHaloOp.value = pal.haloOp;
    su.uSize.value = SKY_BODY.r * pal.haloScale;
    su.uDiscR.value = pal.discScale / pal.haloScale;
    const cu = craneMat.uniforms;
    hex(cu.uWhite, pal.craneWhite);
    hex(cu.uBlack, pal.craneBlack);
    hex(cu.uLeg, pal.craneLeg);
    hex(cu.uCap, pal.craneCap);
    hex(cu.uBill, pal.craneBill);
    hex(cu.uLine, pal.craneLine);
    cu.uLineOp.value = pal.craneLineOp;
    const sky = dusk ? CRANE_SKY.dusk : CRANE_SKY.washi;
    cu.uAzMul.value = sky.mul;
    cu.uAzAdd.value = sky.add;
    cu.uHAdd.value = sky.hAdd;
    cu.uRiseMul.value = sky.riseMul;
    cu.uHMul.value = sky.hMul;
    craneRMul = sky.rMul;
    hex(murmMat.uniforms.uInk, pal.bird);
    const tu = trunkMat.uniforms;
    hex(tu.uBark, pal.bark);
    hex(tu.uCrack, pal.crack);
    hex(tu.uRim, pal.rim);
    tu.uRimOp.value = pal.rimOp;
    const au = padMat.uniforms;
    hex(au.uPad, pal.pad);
    hex(au.uPadDark, pal.padDark);
    hex(au.uLine, pal.pineLine);
    au.uLineOp.value = pal.pineLineOp;
    hex(au.uRim, pal.rim);
    au.uRimOp.value = pal.rimOp;
    const fpu = farMat.uniforms;
    hex(fpu.uPad, pal.farPine);
    fpu.uOpacity.value = pal.farPineOp;
    const ru = reedMat.uniforms;
    hex(ru.uStem, pal.reed);
    hex(ru.uPlume, pal.plume);
    ru.uOpacity.value = pal.reedOp;
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
      pathIndex = -1;
      if (next === 3) murm.visible = false;
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
      // Ambient water, mist, waterfall, and reeds: a fixed phase under reduced motion.
      const tAmb = fixed ?? (rm ? FROZEN_T : timeSec);
      for (let i = 0; i < mistMeshes.length; i++) {
        mistMeshes[i].rotation.y = MIST_RINGS[i].rate * TAU * tAmb;
      }
      floorMat.uniforms.uTime.value = tAmb;
      fujiMat.uniforms.uTime.value = tAmb;
      reedMat.uniforms.uTime.value = tAmb;
      // The Ascent is taller: drop the landscape a little so its low isolines
      // clear, and fade the left framing pine and the reeds off the depth scale.
      const pose = Math.min(1, Math.max(0, opts.pose ?? 0));
      group.position.y = center.y - ASCENT_DROP * pose;
      const sideFade = ASCENT_SIDE_FADE * smooth01(pose);
      trunkMat.uniforms.uSideFade.value = sideFade;
      padMat.uniforms.uSideFade.value = sideFade;
      reedMat.uniforms.uSideFade.value = sideFade;
      moonWorld.copy(moonLocal).add(group.position);
      // Birds: hidden under reduced motion, faded out by quiet.
      // (A debug clock shows the birds even under reduced motion, for stills.)
      const birdA = rm && fixed === null ? 0 : 1 - smooth01(quiet);
      const pal = style === 4 ? LAND.dusk : LAND.washi;
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
          u.uR.value = path.R * craneRMul;
          u.uH0.value = path.h0;
          u.uH1.value = path.h1;
          u.uCount.value = path.count;
        }
        craneMat.uniforms.uProg.value = sched.progress;
        craneMat.uniforms.uTime.value = t;
        craneMat.uniforms.uAlpha.value = birdA * pal.craneOp;
      }
      if (style === 4) {
        murm.visible = birdA > 0.002;
        murmMat.uniforms.uTime.value = t;
        murmMat.uniforms.uAlpha.value = birdA * pal.birdOp;
      }
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
  return handle;
}
