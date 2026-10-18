// Cranes: one flight of red-crowned cranes crosses the far sky in
// CRANE.crossing seconds, then the sky stays empty for a gap hashed from the
// crossing index. Washi prints them in white plumage, Dusk in pale moonlit
// plumage.
//
// Anatomy (scratchpad study, Commons photographs and Hiroshige's cranes):
// long broad wings, black confined to a separate block on the inner trailing
// edge (secondaries and tertials), white primaries beyond the wrist, a white
// tail with the black tertial plume over it, a red cap above the eye, a straight
// neck with a fine bill, and the legs trailing together past the tail with a
// heel joint.
//
// The flap is a print's convention for a 3D stroke: each wing is a trapezoid
// whose chord stays parallel to the body at every flap angle. Only the span is
// foreshortened, by the sine of the flap angle seen from the camera's elevation
// (the near wing reads higher than the far wing from below). The hand follows
// the arm with a lag and a larger amplitude, so the downstroke bows.

import { DEG, SDF_GLSL, TAU, f, lhash } from "./core";

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
  /** The half-span in world units: about 22 px from wingtip to wingtip at the
   *  home view (the crossing is about 4000 to 4450 units from the camera, and
   *  the wings fold toward the viewer as they beat). */
  size: 54,
  maxCount: 5,
} as const;

/** The planform in units of the half-span (u forward along the body, v up).
 *  Root and wrist share one chord line each, parallel to the body. */
export const CRANE_FORM = {
  /** Arm: root to wrist (span share), leading and trailing edges. */
  arm: 0.46,
  rootLE: 0.11,
  rootTE: -0.17,
  wristLE: 0.1,
  wristTE: -0.15,
  /** Hand: wrist to tip (span share), the tip chord is narrower and swept. */
  hand: 0.54,
  tipLE: -0.15,
  tipTE: -0.25,
  /** Black block: the rear share of the arm's chord (secondaries and
   *  tertials), from blockS0 of the arm out to the wrist. */
  block: 0.5,
  blockS0: 0.04,
  /** Stroke: arm angle flap0 + flapAmp sin(ph) (radians above level); the hand
   *  swings handAmp times as far, lagging by handLag, biased by handBias. */
  flap0: 0.12,
  flapAmp: 0.8,
  handAmp: 1.2,
  handLag: 0.55,
  handBias: -0.08,
  /** The print's viewpoint: the bird is drawn as if seen from at least eye0
   *  below its plane (radians), so the near and far wings separate. */
  eye0: 0.42,
  eyeGain: 0.6,
} as const;

/** The elevation a bird is drawn from, given the camera's true elevation e. */
export const craneEye = (e: number): number => CRANE_FORM.eye0 + CRANE_FORM.eyeGain * e;

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
/** Formation slots, a loose V: lag along the path (fraction), rise (world
 *  units), wing phase (turns). Each bird is at its own phase of the stroke. */
export const CRANE_SLOTS: readonly [number, number, number][] = [
  [0, 0, 0.0],
  [0.012, 40, 0.31],
  [0.015, -36, 0.67],
  [0.025, 78, 0.12],
  [0.03, -70, 0.83],
];
/** Dusk flies the same schedule over the moon's side of the sky: the path
 *  azimuth is mapped az * mul + add, so the flight stays left of the flock. */
export const CRANE_DUSK_AZ = { mul: 0.4, add: -26 * DEG } as const;

// ---------------------------------------------------------------------------
// Planform mirror (the GLSL below computes the same numbers).

export interface WingEdge {
  /** Height of this chord line in half-span units (screen up). */
  v: number;
  le: number;
  te: number;
}
export interface WingForm {
  root: WingEdge;
  wrist: WingEdge;
  tip: WingEdge;
  /** The black block: the arm from v0 to v1, rear `frac` of the chord. */
  block: { v0: number; v1: number; frac: number };
}
/** Arm and hand angles (radians above level) at stroke phase ph (radians). */
export function craneFlap(ph: number): [number, number] {
  const F = CRANE_FORM;
  return [F.flap0 + F.flapAmp * Math.sin(ph), F.flap0 + F.handBias + F.flapAmp * F.handAmp * Math.sin(ph - F.handLag)];
}
/** One wing at stroke phase ph, seen from a camera at elevation e (radians,
 *  + when the camera is below the bird). near: the wing on the camera's side. */
export function cranePlanform(ph: number, e: number, near: boolean): WingForm {
  const F = CRANE_FORM;
  const [a, h] = craneFlap(ph);
  const s = near ? craneEye(e) : -craneEye(e);
  const va = F.arm * Math.sin(a + s);
  const vt = va + F.hand * Math.sin(h + s);
  return {
    root: { v: 0, le: F.rootLE, te: F.rootTE },
    wrist: { v: va, le: F.wristLE, te: F.wristTE },
    tip: { v: vt, le: F.tipLE, te: F.tipTE },
    block: { v0: F.blockS0 * va, v1: va, frac: F.block },
  };
}

// ---------------------------------------------------------------------------
// GLSL

export const CRANE_VERT = /* glsl */ `
  attribute vec4 aSlot; // lag, rise, wing phase, index
  uniform float uProg;
  uniform float uAz0;
  uniform float uAz1;
  uniform float uAzMul;
  uniform float uAzAdd;
  uniform float uR;
  uniform float uH0;
  uniform float uH1;
  uniform float uCount;
  uniform float uTime;
  uniform float uAlpha;
  uniform float uSize;
  varying vec2 vUv;
  varying float vA;
  // Projected wing heights: near arm, near tip, far arm, far tip.
  varying vec4 vWing;
  vec3 pathAt(float p, float rise) {
    float az = mix(uAz0, uAz1, p) * uAzMul + uAzAdd;
    float h = mix(uH0, uH1, p) + rise;
    return vec3(uR * sin(az), h, -uR * cos(az));
  }
  void main() {
    float p = uProg - aSlot.x;
    float rise = aSlot.y + 5.0 * sin(uTime * 6.28318 / 9.0 + aSlot.z * 6.28318);
    vec3 local = pathAt(p, rise);
    vec4 v1 = modelViewMatrix * vec4(local, 1.0);
    vec4 v2 = modelViewMatrix * vec4(pathAt(p + 0.004, rise), 1.0);
    // Screen direction of flight, so the bird flies along its path.
    vec2 dir = v2.xy / max(-v2.z, 1.0) - v1.xy / max(-v1.z, 1.0);
    dir = length(dir) > 1e-7 ? normalize(dir) : vec2(1.0, 0.0);
    vec2 perp = vec2(-dir.y, dir.x);
    if (perp.y < 0.0) perp = -perp;
    // Silhouette units (half-spans): u forward, v up. The quad spans
    // u -0.72..0.60 and v -1.06..1.06.
    vec2 uv = vec2(-0.06 + 0.66 * position.x, 1.06 * position.y);
    vec4 mv = v1;
    mv.xy += (uv.x * dir + uv.y * perp) * uSize;
    gl_Position = projectionMatrix * mv;
    vUv = uv;
    float ends = smoothstep(0.0, 0.08, p) * (1.0 - smoothstep(0.92, 1.0, p));
    vA = uAlpha * ends * step(aSlot.w + 0.5, uCount);
    // The camera's elevation seen from the bird (+ when the camera is below).
    vec3 world = (modelMatrix * vec4(local, 1.0)).xyz;
    vec3 toCam = cameraPosition - world;
    float e = clamp(asin(clamp(-toCam.y / max(length(toCam), 1.0), -1.0, 1.0)), -1.2, 1.2);
    e = ${f(CRANE_FORM.eye0)} + ${f(CRANE_FORM.eyeGain)} * e;
    // One slow stroke (period ${CRANE.wingPeriod} s), each bird at its own phase.
    float ph = ${f(TAU)} * (uTime / ${f(CRANE.wingPeriod)} + aSlot.z);
    float a = ${f(CRANE_FORM.flap0)} + ${f(CRANE_FORM.flapAmp)} * sin(ph);
    float h = ${f(CRANE_FORM.flap0 + CRANE_FORM.handBias)} + ${f(CRANE_FORM.flapAmp * CRANE_FORM.handAmp)} * sin(ph - ${f(CRANE_FORM.handLag)});
    float vaN = ${f(CRANE_FORM.arm)} * sin(a + e);
    float vaF = ${f(CRANE_FORM.arm)} * sin(a - e);
    vWing = vec4(vaN, vaN + ${f(CRANE_FORM.hand)} * sin(h + e), vaF, vaF + ${f(CRANE_FORM.hand)} * sin(h - e));
  }
`;

export const CRANE_FRAG = /* glsl */ `
  uniform vec3 uWhite;
  uniform vec3 uBlack;
  uniform vec3 uLeg;
  uniform vec3 uCap;
  uniform vec3 uBill;
  uniform vec3 uLine;
  uniform float uLineOp;
  varying vec2 vUv;
  varying float vA;
  varying vec4 vWing;
  ${SDF_GLSL}
  // Over-composite one layer (premultiplied).
  void lay(inout vec4 acc, float c, vec3 col) {
    acc.rgb = col * c + acc.rgb * (1.0 - c);
    acc.a = c + acc.a * (1.0 - c);
  }
  // A trapezoid between the chord lines at heights v0 and v1. The chords are
  // horizontal (parallel to the body); the edges run linearly between them.
  // Returns the signed distance; s is the place along the span (0..1).
  float sdTrap(vec2 p, float v0, float v1, float le0, float te0, float le1, float te1, float px, out float s, out float thin) {
    float span = v1 - v0;
    // A wing seen edge-on keeps one pixel of height and thins its ink.
    float hgt = abs(span);
    thin = clamp(hgt / px, 0.25, 1.0);
    float grow = 0.5 * max(0.0, px - hgt);
    float lo = min(v0, v1) - grow;
    float hi = max(v0, v1) + grow;
    s = abs(span) > 1e-5 ? clamp((p.y - v0) / span, 0.0, 1.0) : 0.5;
    float le = mix(le0, le1, s);
    float te = mix(te0, te1, s);
    float dx = max(te - p.x, p.x - le);
    float dy = max(lo - p.y, p.y - hi);
    return max(dx, dy);
  }
  // One wing: arm then hand. Writes the layer's coverage and color.
  void wing(vec2 p, float va, float vt, float px, inout vec4 acc) {
    float sA; float tA; float sH; float tH;
    float dArm = sdTrap(p, 0.0, va, ${f(CRANE_FORM.rootLE)}, ${f(CRANE_FORM.rootTE)}, ${f(CRANE_FORM.wristLE)}, ${f(CRANE_FORM.wristTE)}, px, sA, tA);
    // Fingered primaries: the hand's trailing edge notches near the tip.
    float dHand = sdTrap(p, va, vt, ${f(CRANE_FORM.wristLE)}, ${f(CRANE_FORM.wristTE)}, ${f(CRANE_FORM.tipLE)}, ${f(CRANE_FORM.tipTE)}, px, sH, tH);
    float notch = 0.028 * smoothstep(0.45, 0.8, sH) * max(0.0, sin(sH * 3.14159 * 7.0));
    dHand = max(dHand, mix(${f(CRANE_FORM.wristTE)}, ${f(CRANE_FORM.tipTE)}, sH) + notch - p.x);
    float d = min(dArm, dHand);
    float thin = dArm < dHand ? tA : tH;
    float c = cover(d, px) * thin;
    if (c <= 0.0) return;
    // The black block: the rear half of the arm's chord, from the body to the
    // wrist. Its edges anti-alias along the chord and at the wrist line.
    float te = mix(${f(CRANE_FORM.rootTE)}, ${f(CRANE_FORM.wristTE)}, sA);
    float le = mix(${f(CRANE_FORM.rootLE)}, ${f(CRANE_FORM.wristLE)}, sA);
    float bx = (te + ${f(CRANE_FORM.block)} * (le - te)) - p.x;   // > 0 inside
    float bv = abs(va) - abs(p.y); // > 0 inside the arm's span
    float inArm = step(0.0, p.y * sign(va + 1e-6));
    float blk = clamp(bx / px + 0.5, 0.0, 1.0) * clamp(bv / px + 0.5, 0.0, 1.0) * inArm
      * clamp((abs(p.y) - ${f(CRANE_FORM.blockS0)} * abs(va)) / px + 0.5, 0.0, 1.0);
    vec3 col = mix(uWhite, uBlack, blk);
    // Key-block line on the white edge.
    float edge = (1.0 - smoothstep(0.6 * px, 1.5 * px, -d)) * uLineOp * (1.0 - blk);
    col = mix(col, uLine, edge);
    lay(acc, c, col);
  }
  void main() {
    if (vA <= 0.001) discard;
    vec2 p = vUv;
    float px = max(fwidth(p.x) + fwidth(p.y), 1e-4) * 0.7071;
    vec4 acc = vec4(0.0);
    // Far wing first (behind the body).
    wing(p, vWing.z, vWing.w, px, acc);
    // Legs: hip to heel, heel to toes, together, trailing past the tail.
    float dLeg = min(
      min(sdCapsule(p, vec2(-0.1, -0.035), vec2(-0.31, -0.062), 0.013, 0.01),
          sdCapsule(p, vec2(-0.31, -0.062), vec2(-0.64, -0.072), 0.01, 0.007)),
      min(sdCapsule(p, vec2(-0.12, -0.04), vec2(-0.32, -0.078), 0.012, 0.009),
          sdCapsule(p, vec2(-0.32, -0.078), vec2(-0.62, -0.09), 0.009, 0.006)));
    lay(acc, cover(dLeg, px), uLeg);
    // Body and tail (white), the tertial plume (black) over the tail.
    float dBody = min(sdEllipse(p - vec2(-0.04, -0.01), vec2(0.19, 0.056)),
                      sdCapsule(p, vec2(-0.18, -0.005), vec2(-0.33, -0.012), 0.04, 0.022));
    float bodyEdge = (1.0 - smoothstep(0.6 * px, 1.5 * px, -dBody)) * uLineOp;
    lay(acc, cover(dBody, px), mix(uWhite, uLine, bodyEdge));
    float dPlume = sdCapsule(p, vec2(-0.1, 0.025), vec2(-0.33, 0.0), 0.026, 0.012);
    lay(acc, cover(dPlume, px), uBlack);
    // Neck (black), head, white nape, red cap above the eye, fine bill.
    float dNeck = sdCapsule(p, vec2(0.12, 0.012), vec2(0.37, 0.022), 0.024, 0.017);
    lay(acc, cover(dNeck, px), uBlack);
    float dNape = sdCapsule(p, vec2(0.33, 0.03), vec2(0.37, 0.034), 0.008, 0.007);
    lay(acc, cover(dNape, px) * 0.85, uWhite);
    float dHead = sdEllipse(p - vec2(0.392, 0.024), vec2(0.034, 0.026));
    lay(acc, cover(dHead, px), uBlack);
    float dCap = sdEllipse(p - vec2(0.39, 0.04), vec2(0.016, 0.011));
    lay(acc, cover(dCap, px), uCap);
    float dBill = sdCapsule(p, vec2(0.42, 0.022), vec2(0.545, 0.012), 0.009, 0.0025);
    lay(acc, cover(dBill, px), uBill);
    // Near wing last (in front of the body).
    wing(p, vWing.x, vWing.y, px, acc);
    float a = acc.a * vA;
    if (a < 0.003) discard;
    gl_FragColor = vec4(acc.rgb / max(acc.a, 1e-4), a);
  }
`;
