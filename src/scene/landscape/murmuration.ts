// Murmuration (Dusk): one flock of starlings as a thin folded sheet, after the
// STARFLAG measurements (Ballerini, Cavagna and others): a sheet far thinner
// than it is wide, uniform inside, denser and sharp at its border, with a
// sparse fringe of stragglers. The head curls back into a dense fold and the
// tail thins. The sheet twists along its length, so wherever it turns edge-on
// it prints as a dark band, as in the photographs.
//
// Every bird is one point of one draw call, moved in the vertex shader (no CPU
// simulation) and drawn as a small chevron aligned to the sheet's local flow,
// so individuals resolve at 2x. The shape turns over across 29 to 53 s: no
// period is under 20 s. The functions below mirror the GLSL one for one.

import { DEG, TAU, f, lhash } from "./core";

export const SHEET = {
  count: 2000,
  /** Center: open sky above and right of the map (the moon is at -40 deg), at
   *  the home view about y 120 to 300 of 1440x900, clear of the title block
   *  and of the bottom-right chrome. */
  az: 31 * DEG,
  azSwing: 2 * DEG,
  R: 3560,
  RSwing: 60,
  h: 800,
  hSwing: 20,
  pAz1: 97,
  pAz2: 41,
  pR: 73,
  pH: 59,
  /** Half-length (along the azimuth), half-width, half-thickness. */
  L: 500,
  W: 165,
  T: 12,
  /** The tail is this share of the full width; the head is full width. */
  tailW: 0.42,
  /** Centerline bend (up, radial) and the head's curl (back, up). */
  bendY: 35,
  bendZ: 60,
  curlX: 0.34,
  curlY: 60,
  /** Twist along the length: a base angle and a rate per unit length. */
  twist0: 0.5,
  twistRate: 1.3,
  twistSwing: 0.7,
  /** Whole-sheet yaw and pitch (radians). */
  yaw: 0.32,
  pitch: 0.12,
  /** Periods (seconds), all 20 s or longer. */
  pTwist0: 29,
  pTwist1: 41,
  pBendY: 37,
  pBendZ: 47,
  pYaw: 53,
  pPitch: 31,
  /** Birds: share in the border strip, the strip's inner edge (|b|), and the
   *  share of stragglers outside the edge. */
  edgeFrac: 0.35,
  edgeIn: 0.86,
  fringeFrac: 0.05,
  /** Per-bird jitter (world units) and its period range (seconds). */
  jit: 9,
  jitP0: 20,
  jitP1: 40,
  /** Chevron size range in CSS px (by seed). */
  px0: 2.4,
  px1: 3.6,
} as const;

/** One bird's seeds: the place on the sheet (a along, b across, w through) and
 *  its size and jitter phase; fringe marks a straggler. */
export interface SheetSeed {
  a: number;
  b: number;
  w: number;
  s: number;
  j: number;
  fringe: number;
}
export function murmSheetSeed(i: number): SheetSeed {
  const g = lhash(801, i);
  const ub = lhash(803, i);
  const sign = lhash(808, i) < 0.5 ? -1 : 1;
  let b: number;
  let fringe = 0;
  if (g < SHEET.fringeFrac) {
    fringe = 1;
    b = sign * (1.04 + 0.5 * ub);
  } else if (lhash(807, i) < SHEET.edgeFrac) {
    b = sign * (SHEET.edgeIn + (1 - SHEET.edgeIn) * ub);
  } else {
    b = sign * SHEET.edgeIn * ub;
  }
  return {
    // Denser toward the head (a = +1).
    a: 2 * Math.pow(lhash(802, i), 0.7) - 1,
    b,
    w: 2 * lhash(804, i) - 1,
    s: lhash(805, i),
    j: lhash(806, i),
    fringe,
  };
}

/** The flock center at time t: azimuth (rad), radius, height. Writes into out. */
export function murmSheetCenterInto(t: number, out: { az: number; R: number; h: number }): { az: number; R: number; h: number } {
  out.az = SHEET.az + SHEET.azSwing * (0.65 * Math.sin((t * TAU) / SHEET.pAz1) + 0.35 * Math.sin((t * TAU) / SHEET.pAz2 + 1.3));
  out.R = SHEET.R + SHEET.RSwing * Math.sin((t * TAU) / SHEET.pR + 0.4);
  out.h = SHEET.h + SHEET.hSwing * Math.sin((t * TAU) / SHEET.pH + 1.0);
  return out;
}

const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A point of the sheet at time t, in world units along (tangent, up, radial
 *  out), before the per-bird jitter. Writes into out. */
export function murmSheetLocalInto(a: number, b: number, w: number, fringe: number, t: number, out: [number, number, number]): [number, number, number] {
  const S = SHEET;
  const th =
    S.twist0 * Math.sin((t * TAU) / S.pTwist0) + (S.twistRate + S.twistSwing * Math.sin((t * TAU) / S.pTwist1 + 1.1)) * a;
  const width = S.W * (S.tailW + (1 - S.tailW) * sstep(-1, 0.5, a));
  const k = sstep(0.55, 1, a);
  const cx = S.L * a - S.L * S.curlX * k * k;
  const cy = S.bendY * Math.sin(1.7 * a + (t * TAU) / S.pBendY) + S.curlY * k * k;
  const cz = S.bendZ * Math.sin(1.3 * a + (t * TAU) / S.pBendZ + 0.5);
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const thick = S.T * w * (1 + 3 * fringe);
  const x = cx;
  const y = cy + width * b * c - thick * sn;
  const z = cz + width * b * sn + thick * c;
  // Whole-sheet yaw (about up) then pitch (about the radial axis).
  const yw = S.yaw * Math.sin((t * TAU) / S.pYaw);
  const pt = S.pitch * Math.sin((t * TAU) / S.pPitch + 0.7);
  const x1 = x * Math.cos(yw) - z * Math.sin(yw);
  const z1 = x * Math.sin(yw) + z * Math.cos(yw);
  out[0] = x1 * Math.cos(pt) - y * Math.sin(pt);
  out[1] = x1 * Math.sin(pt) + y * Math.cos(pt);
  out[2] = z1;
  return out;
}

const centerScratch = { az: 0, R: 0, h: 0 };
const localScratch: [number, number, number] = [0, 0, 0];
/** Where one bird is at time t: azimuth (rad), radius, height. */
export function murmSheetBird(sd: SheetSeed, t: number, out = { az: 0, R: 0, h: 0 }): { az: number; R: number; h: number } {
  const c = murmSheetCenterInto(t, centerScratch);
  const p = murmSheetLocalInto(sd.a, sd.b, sd.w, sd.fringe, t, localScratch);
  const pj = SHEET.jitP0 + (SHEET.jitP1 - SHEET.jitP0) * sd.s;
  const ph = sd.j * TAU;
  const J = SHEET.jit * (1 + sd.fringe);
  const jx = J * Math.sin((t * TAU) / pj + ph);
  const jy = J * Math.sin((t * TAU) / (pj * 1.27) + ph * 3.1);
  const jz = J * Math.sin((t * TAU) / (pj * 0.83) + ph * 1.7);
  out.az = c.az + (p[0] + jx) / c.R;
  out.h = c.h + p[1] + jy;
  out.R = c.R + p[2] + jz;
  return out;
}

// ---------------------------------------------------------------------------
// GLSL

export const MURM_SHEET_VERT = /* glsl */ `
  attribute vec3 aSeed; // s (size, jitter period), j (jitter phase), fringe
  uniform float uTime;
  uniform float uAlpha;
  uniform float uPx;
  varying float vA;
  varying vec2 vDir;
  const float TAU = 6.28318530718;
  vec3 sheetLocal(float a, float b, float w, float fr, float t) {
    float th = ${f(SHEET.twist0)} * sin(t * TAU / ${f(SHEET.pTwist0)})
      + (${f(SHEET.twistRate)} + ${f(SHEET.twistSwing)} * sin(t * TAU / ${f(SHEET.pTwist1)} + 1.1)) * a;
    float width = ${f(SHEET.W)} * (${f(SHEET.tailW)} + ${f(1 - SHEET.tailW)} * smoothstep(-1.0, 0.5, a));
    float k = smoothstep(0.55, 1.0, a);
    float cx = ${f(SHEET.L)} * a - ${f(SHEET.L * SHEET.curlX)} * k * k;
    float cy = ${f(SHEET.bendY)} * sin(1.7 * a + t * TAU / ${f(SHEET.pBendY)}) + ${f(SHEET.curlY)} * k * k;
    float cz = ${f(SHEET.bendZ)} * sin(1.3 * a + t * TAU / ${f(SHEET.pBendZ)} + 0.5);
    float c = cos(th);
    float sn = sin(th);
    float thick = ${f(SHEET.T)} * w * (1.0 + 3.0 * fr);
    float x = cx;
    float y = cy + width * b * c - thick * sn;
    float z = cz + width * b * sn + thick * c;
    float yw = ${f(SHEET.yaw)} * sin(t * TAU / ${f(SHEET.pYaw)});
    float pt = ${f(SHEET.pitch)} * sin(t * TAU / ${f(SHEET.pPitch)} + 0.7);
    float x1 = x * cos(yw) - z * sin(yw);
    float z1 = x * sin(yw) + z * cos(yw);
    return vec3(x1 * cos(pt) - y * sin(pt), x1 * sin(pt) + y * cos(pt), z1);
  }
  vec3 worldAt(vec3 lo, vec3 jit, float caz, float cR, float ch) {
    float az = caz + (lo.x + jit.x) / cR;
    float h = ch + lo.y + jit.y;
    float R = cR + lo.z + jit.z;
    return vec3(R * sin(az), h, -R * cos(az));
  }
  void main() {
    float t = uTime;
    float a = position.x;
    float b = position.y;
    float w = position.z;
    float sz = aSeed.x;
    float fr = aSeed.z;
    float caz = ${f(SHEET.az)} + ${f(SHEET.azSwing)} * (0.65 * sin(t * TAU / ${f(SHEET.pAz1)}) + 0.35 * sin(t * TAU / ${f(SHEET.pAz2)} + 1.3));
    float cR = ${f(SHEET.R)} + ${f(SHEET.RSwing)} * sin(t * TAU / ${f(SHEET.pR)} + 0.4);
    float ch = ${f(SHEET.h)} + ${f(SHEET.hSwing)} * sin(t * TAU / ${f(SHEET.pH)} + 1.0);
    float pj = ${f(SHEET.jitP0)} + ${f(SHEET.jitP1 - SHEET.jitP0)} * sz;
    float ph = aSeed.y * TAU;
    float J = ${f(SHEET.jit)} * (1.0 + fr);
    vec3 jit = J * vec3(sin(t * TAU / pj + ph), sin(t * TAU / (pj * 1.27) + ph * 3.1), sin(t * TAU / (pj * 0.83) + ph * 1.7));
    vec3 p0 = worldAt(sheetLocal(a, b, w, fr, t), jit, caz, cR, ch);
    // The local flow: the sheet's direction along its length, on screen.
    vec3 p1 = worldAt(sheetLocal(a + 0.03, b, w, fr, t), jit, caz, cR, ch);
    vec4 c0 = projectionMatrix * modelViewMatrix * vec4(p0, 1.0);
    vec4 c1 = projectionMatrix * modelViewMatrix * vec4(p1, 1.0);
    vec2 d = c1.xy / max(c1.w, 1e-3) - c0.xy / max(c0.w, 1e-3);
    vDir = length(d) > 1e-7 ? normalize(d) : vec2(1.0, 0.0);
    gl_Position = c0;
    gl_PointSize = mix(${f(SHEET.px0)}, ${f(SHEET.px1)}, sz) * uPx;
    vA = uAlpha * (fr > 0.5 ? 0.8 : 1.0);
  }
`;

export const MURM_SHEET_FRAG = /* glsl */ `
  uniform vec3 uInk;
  varying float vA;
  varying vec2 vDir;
  float seg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }
  void main() {
    // Point units, y up, rotated into the flow (x forward).
    vec2 q = gl_PointCoord - 0.5;
    q.y = -q.y;
    vec2 p = vec2(dot(q, vDir), dot(q, vec2(-vDir.y, vDir.x)));
    // A chevron: two wings swept back from the head.
    float d = min(seg(p, vec2(0.2, 0.0), vec2(-0.2, 0.36)), seg(p, vec2(0.2, 0.0), vec2(-0.2, -0.36))) - 0.12;
    float px = 1.0 / max(fwidth(gl_PointCoord.x), 1e-3);
    float a = clamp(0.5 - d * px, 0.0, 1.0) * vA;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uInk, a);
  }
`;
