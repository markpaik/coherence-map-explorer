// All 899 edges as ONE instanced bezier-ribbon mesh (single draw call).
//
// Template geometry: a 24-segment strip (25 vertex pairs) carrying per-vertex
// t ∈ [0,1] and side ±1. Each instance supplies the quadratic bezier
// (aStart/aCtrl/aEnd, control points baked by the pipeline), endpoint strand
// colors (mixed along t in-shader), kind (0 prereq | 1 related) and emphasis.
//
// The vertex shader evaluates the bezier, then expands the ribbon in screen
// space so width is constant in CSS pixels (rest: 1.2px prereq / 1.0px
// related; hot: 2.5px). The fragment shader applies the DESIGN.md edge table:
// prereq flow comets gated to emphasis >= 2, related edges dashed with no flow.
//
// Blending choice: AdditiveBlending. Against the #050510 background it reads
// as light rather than paint, overlapping edges reinforce instead of muddying,
// and it makes draw order irrelevant (no transparent-sort artifacts).
// depthWrite off, depthTest on (edges still occlude behind opaque nodes).
//
// Enamel signage (round-12): the exceptions are the two LIGHT environments — the
// Ascent dawn (pose 1) and the Transit concrete daylight (pose 3) — where the
// ribbons paint onto a bright field. Additive light washes every strand toward
// cream there, so setEnvLight flips the Galaxy material to NormalBlending past the
// window midpoint and the fragment repaints each ribbon with the full-saturation
// VIVID strand hue (STRAND_VIVID: taxi gold / electric violet / subway teal / hot
// rose) — painted enamel signage, not an additive glow. The dawn widens the lines
// ×1.25 and floors their alpha ~0.92 (bold structure carving the morning sky); the
// daylight keeps the metro focus grammar. uEnvLight 0 keeps the shipped additive
// neon byte-identical, so poses 0/2 and the dark baseline are untouched; the paper
// art styles own their own (normal) blending independently.

import * as THREE from "three";
import type { GraphEdge, GraphNode } from "../data";
import { STRAND_COLORS, STRAND_VIVID, STRAND_ORDER, restRadius } from "./palette";
import {
  RINGERS,
  FIDENZA,
  artHash,
  isHanga,
  hangaPalette,
  HANGA_DISC_SCALE,
  HANGA_DUSK_DAMAGE,
  HANGA_TEXTURE,
} from "./artstyle";

const SEGMENTS = 24;

// ---------------------------------------------------------------------------
// Flow comets (Galaxy prereq ribbons): the pulse shape and the orb end-fade.
//
// Ribbons start and end at node CENTRES and draw additively, so each comet used
// to paint over the orb it left or entered. With a hard sawtooth head
// (pow(fract, 3)) that read as a flash: about 28% of lit story orbs jumped
// 3–25% brighter in 0.16 s, every 2.0 s. Three fixes, all comet-only:
//   1. End-fade in 3D: the comet term is 0 inside each endpoint orb and ramps
//      to full between COMET_ORB_IN and COMET_ORB_OUT endpoint radii
//      (aArtScalars.z/w) from the centre, measured as a fraction of the chord.
//      The bezier's endpoint tangent is ≥ 0.76 × chord on every edge (pos and
//      pos2), so 1.6 radii clears the orb at chain scale (×1.15).
//   2. End-fade on screen: a ribbon that leaves its orb toward the camera stays
//      over the orb's disc long after it clears the orb in 3D. So the comet is
//      also 0 while the ribbon's centreline projects within COMET_DISC_IN
//      projected radii of either endpoint centre, and full from COMET_DISC_OUT.
//   3. Smooth head: the old tail, compressed into the first 1 − COMET_HEAD of
//      the period, then a smoothstep fall to 0 at the wrap. Same peak (1), same
//      speed, same spacing, and no value jump anywhere.
// The GLSL is generated from these constants. tests/comet.test.ts pins the
// TS mirrors below.
export const COMET_ORB_IN = 1.6;
export const COMET_ORB_OUT = 4.0;
export const COMET_DISC_IN = 1.3;
export const COMET_DISC_OUT = 3.0;
export const COMET_HEAD = 0.2;

const smooth01 = (x: number): number => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

/** Comet brightness 0..1 at phase fr ∈ [0,1) (TS mirror of the fragment pulse). */
export function cometPulse(fr: number): number {
  const tail = Math.pow(Math.min(fr / (1 - COMET_HEAD), 1), 3);
  const head = smooth01((1 - fr) / COMET_HEAD);
  return tail * head;
}

/**
 * One end's fade zone [inner, outer] in t units from that end (TS mirror of the
 * vertex shader). k = endpoint radius / chord. The comet is 0 up to `inner` and
 * full from `outer`. Both stop at the ribbon's midpoint, and outer stays above
 * inner, so a very short edge (almost all orb) simply carries no comet.
 */
export function cometEndZone(radius: number, chord: number): [number, number] {
  const k = radius / Math.max(chord, 1e-3);
  const inner = Math.min(k * COMET_ORB_IN, 0.49);
  const outer = Math.max(Math.min(k * COMET_ORB_OUT, 0.5), inner + 0.01);
  return [inner, outer];
}

/** Comet end-fade 0..1 at ribbon parameter t (TS mirror of the fragment). */
export function cometEndFade(t: number, zoneA: [number, number], zoneB: [number, number]): number {
  const ss = (e0: number, e1: number, x: number): number => smooth01((x - e0) / (e1 - e0));
  return ss(zoneA[0], zoneA[1], t) * ss(zoneB[0], zoneB[1], 1 - t);
}

/**
 * Comet screen-disc fade 0..1 (TS mirror of the fragment). gapA / gapB are the
 * centreline's screen distance from each endpoint centre, in units of that
 * orb's projected radius (1 = the disc edge).
 */
export function cometDiscFade(gapA: number, gapB: number): number {
  const w = COMET_DISC_OUT - COMET_DISC_IN;
  return smooth01((gapA - COMET_DISC_IN) / w) * smooth01((gapB - COMET_DISC_IN) / w);
}

// ---------------------------------------------------------------------------
// Hanga brush strokes (styles 3 Washi and 4 Dusk). Every tunable lives here; the
// GLSL constants at the top of the Hanga branches are generated from these, so
// a reviewer tunes the look in one place. Widths are CSS px.
//
// A prerequisite edge is one tapered stroke of the source standard's pigment. It
// starts full (with a slight pigment pool) at the prerequisite's rim, holds its
// width to TAPER_START, then thins along a long whisked tail toward the
// dependent standard. From KASURE_START the brush runs dry (kasure): the stroke
// splits into 2 or 3 bristle streaks with hashed breaks, which open toward the
// tail. A related pair is a row of soft round sumi dabs.
export const HANGA_STROKE = {
  /** Full stroke width at the prerequisite end (CSS px). */
  HEAD_PX: 2.4,
  /** Extra width at the pool peak, as a fraction of the head width. */
  POOL: 0.14,
  /** The pool swells and settles back to the head width by this stroke fraction. */
  POOL_END: 0.16,
  /** The taper begins here (fraction of the stroke from the prerequisite rim). */
  TAPER_START: 0.35,
  /** Taper curve exponent: above 1 thins early and leaves a long fine tail. */
  TAPER_POW: 1.5,
  /** Width left at the very tip, as a fraction of the head width. */
  TAIL: 0.06,
  /** The dry-brush split begins here. */
  KASURE_START: 0.45,
  /** Bristle breaks per this many device px of stroke length. */
  BREAK_PX: 14,
  /** How much of each bristle lane the dry brush leaves bare at the tail. */
  KASURE_GAP: 0.3,
  /** Hand pressure: the width breathes by this fraction along the stroke. */
  PRESSURE: 0.09,
  /** Width multiplier for hover, focus, and chain strokes. */
  EMPH_WIDTH: 1.6,
  /** Width multiplier for a healthy lit stroke while a story plays. */
  LIFT_WIDTH: 1.4,
  /** Width multiplier for the unlit underdrawing. */
  UNDER_WIDTH: 0.85,
  /** Opacity at rest, when lit, and as underdrawing. */
  REST_ALPHA: 0.78,
  LIT_ALPHA: 0.94,
  UNDER_ALPHA: 0.1,
  /** Wet-ink sheen on lit chain strokes: one pass per period, small swing. */
  SHEEN_PERIOD_SEC: 4.5,
  SHEEN_SWING: 0.08,
  SHEEN_WAVES: 1.0,
} as const;

export const HANGA_DAB = {
  /** Spacing between dab centres along a related pair (CSS px). */
  SPACING_PX: 9,
  /** Dab half-length and half-thickness (CSS px), before the hashed jitter. */
  RX_PX: 1.3,
  RY_PX: 0.7,
  /** Hashed growth added to RX and RY (CSS px). */
  RX_JITTER_PX: 0.55,
  RY_JITTER_PX: 0.3,
  /** Inner radius (as a fraction of the dab) where the soft edge begins. */
  SOFT: 0.4,
  /** Strip half-width that holds the dabs (CSS px). */
  HALF_PX: 1.6,
  /** Opacity at rest and when lit. */
  REST_ALPHA: 0.34,
  LIT_ALPHA: 0.62,
} as const;

/**
 * Hanga stroke width at stroke fraction u (0 = prerequisite rim, 1 = dependent
 * rim), as a fraction of the head width (TS mirror of hangaWidth in the vertex
 * shader). Exactly 1 at u = 0, a smooth pool just after, flat to TAPER_START,
 * then a monotone taper to TAIL at u = 1.
 */
export function hangaStrokeWidth(u: number): number {
  const S = HANGA_STROKE;
  const x = u < 0 ? 0 : u > 1 ? 1 : u;
  const k = x < S.POOL_END ? Math.sin((Math.PI * x) / S.POOL_END) : 0;
  const pool = S.POOL * k * k;
  let body = 1;
  if (x > S.TAPER_START) {
    const s = (x - S.TAPER_START) / (1 - S.TAPER_START);
    body = S.TAIL + (1 - S.TAIL) * Math.pow(1 - s, S.TAPER_POW);
  }
  return body * (1 + pool);
}

/**
 * Soft dab opacity 0..1 at a fragment `along` / `across` px from the dab centre,
 * for a dab of half-length rx and half-thickness ry (TS mirror of hangaDab in
 * the fragment shader). 1 in the core, a smooth fall to 0 at the ellipse edge.
 */
export function hangaDabAlpha(along: number, across: number, rx: number, ry: number): number {
  const d = Math.hypot(along / Math.max(rx, 1e-4), across / Math.max(ry, 1e-4));
  return 1 - smooth01((d - HANGA_DAB.SOFT) / (1 - HANGA_DAB.SOFT));
}

const glf = (x: number): string => x.toFixed(4);

// GLSL constants for the Hanga branches, generated from the tables above.
const HANGA_GLSL_CONSTS = [
  ...Object.entries(HANGA_STROKE).map(([k, v]) => `const float H_${k} = ${glf(v)};`),
  ...Object.entries(HANGA_DAB).map(([k, v]) => `const float HD_${k} = ${glf(v)};`),
  ...Object.entries(HANGA_TEXTURE).map(([k, v]) => `const float HT_${k} = ${glf(v)};`),
].join("\n      ");

// Edge emphasis is the full 6-state scale (fractional values blend adjacent
// states, which lets the state machine ease hover in/out on the CPU):
//   0 dimmed | 1 rest | 2 hover | 3 focus | 4 chain | 5 related
// Per DESIGN's edge table the two focus looks differ by kind: a CHAIN prereq
// edge is bright with directional flow comets; a RELATED-to-focus edge is a
// dashed shimmer with NO flow. Per-state tables (indexed by the emphasis value)
// carry width / alpha / HDR color multiplier / flow / shimmer, so both looks —
// and every state in between — fall out of one blend.
// GLSL ES 3.00 (glslVersion: GLSL3) — the per-state tables below use float[]()
// array constructors and dynamic indexing, which GLSL 1.00 forbids.
const VERT = /* glsl */ `
  precision highp float;

  // RawShaderMaterial injects nothing, so the two matrices the galaxy + art
  // paths use are declared here (and ONLY these — not the position/normal/uv
  // that ShaderMaterial would auto-add, which pushed the edge program past the
  // GPU's 16 vertex-attribute limit on min-spec hardware).
  uniform mat4 projectionMatrix;
  uniform mat4 modelViewMatrix;

  in float t;
  in float side;
  in vec3 aStart;
  in vec3 aCtrl;
  in vec3 aEnd;
  in vec4 aColorA;  // .rgb source strand color · .w opener appear-time (ms)
  in vec3 aColorB;
  in vec2 aStrand;   // (source strand index, target strand index) 0..3 → VIVID palette
  in float aKind;
  in float aEmphasis;
  in float aVisible;
  in float aDamage;

  // Art-style per-instance data (baked once). Unused by the galaxy path.
  in vec3 aArtRing;    // Ringers string color (source strand peg color)
  in vec3 aArtFid;     // Fidenza ribbon body color (hash pick)
  in vec3 aArtFid2;    // Fidenza striped-cap alternate color
  in vec4 aArtScalars; // x=Fidenza world width, y=Ringers side ±1, z=radA, w=radB

  uniform vec2 uViewport;   // drawing-buffer size in device px
  uniform float uPxRatio;   // device px per CSS px (capped at 2)
  uniform float uArtStyle;  // 0 Galaxy | 1 Ringers | 2 Fidenza | 3 Washi | 4 Dusk
  uniform float uPose;      // eased pose value 0..3 (driver-fed); 3 = Transit
  uniform float uEnvLight;  // 0..1 light-environment amount (Ascent dawn OR Transit daylight)
  uniform vec3 uVivid[4];   // VIVID enamel palette, index-aligned number/algebra/geometry/data
  // Hanga strand pigments (LINEAR), index-aligned number/algebra/geometry/data,
  // for the active field (Washi or Dusk). Read only by the Hanga branch.
  uniform vec3 uHanga[4];
  uniform float uStory;     // story lift amount (the Hanga branch widens lit strokes)

  out float vT;
  out vec3 vColor;
  out float vAppear;        // per-edge opener appear-time (ms), for the ghost-in reveal
  out vec3 vVivid;          // interpolated VIVID strand colour (enamel repaint in light envs)
  out vec3 vArtColor;
  out vec3 vArtColor2;
  out float vKind;
  out float vEmphasis;
  out float vVisible;
  out float vDamage;
  // Fidenza pipes (round 7): the strip's -1..+1 cross-position, interpolated so
  // the fragment can shade it like a round tube. The Galaxy branch also writes it
  // (round 11) to anti-alias the metro/blueprint ribbon silhouette; poses 0–1
  // never read it (the AA is gated on the structural morph), so their output
  // stays byte-identical.
  out float vSide;
  // Galaxy ribbon half-width in device px (round 11): lets the fragment feather
  // the ribbon edge over a fixed pixel span regardless of the instance's width,
  // so thin lines keep a full-alpha core while their silhouette anti-aliases.
  out float vHalfPx;
  // Transit trunk metric (reach-normalized 0..1): the SAME signal that sets the
  // metro trunk WIDTH below, exported so the fragment can ghost non-trunk lines in
  // the unfocused Transit overview. Inert everywhere but Galaxy-Transit.
  out float vTrunk;
  // Flow-comet orb end-fade zones (Galaxy), in t units from each end: xy = the
  // source end [inner, outer], zw = the target end. Constant across the
  // instance. The fragment fades the comet to 0 inside each endpoint orb. The
  // paper skins write a fixed value and never read it.
  out vec4 vEndZone;
  // Flow-comet screen-disc gaps (Galaxy): the centreline's screen distance from
  // the source (x) and target (y) centres, in projected orb radii. Interpolated
  // along the ribbon. The paper skins write a large value and never read it.
  out vec2 vOrbGap;
  // Hanga stroke data (styles 3 and 4 only): x = stroke fraction u (0 at the
  // prerequisite rim, 1 at the dependent rim), y = per-edge seed 0..1, z = the
  // trimmed stroke's screen length in device px, w = the true half-width in
  // device px (the strip itself is a little wider, to hold the feather).
  out vec4 vHanga;

  // Hanga tuning constants (generated from HANGA_STROKE / HANGA_DAB in TS).
  ${HANGA_GLSL_CONSTS}

  // Hanga stroke width profile (hangaStrokeWidth in TS): 1 at u = 0, a soft pool
  // just after, flat to the taper start, then a long monotone taper to the tail.
  float hangaWidth(float u) {
    float x = clamp(u, 0.0, 1.0);
    float k = x < H_POOL_END ? sin(3.14159265 * x / H_POOL_END) : 0.0;
    float pool = H_POOL * k * k;
    float body = 1.0;
    if (x > H_TAPER_START) {
      float s = (x - H_TAPER_START) / (1.0 - H_TAPER_START);
      body = H_TAIL + (1.0 - H_TAIL) * pow(1.0 - s, H_TAPER_POW);
    }
    return body * (1.0 + pool);
  }

  vec3 bezier(float s) {
    float u = 1.0 - s;
    return u * u * aStart + 2.0 * u * s * aCtrl + s * s * aEnd;
  }

  // Transit metro turn (pose 3): a straight run A→P1, a TIGHT rounded knuckle
  // P1→(quadratic through the elbow E=aCtrl)→P2, then a straight run P2→B.
  //   d  = min(9, 0.42|AE|, 0.42|EB|)
  //   P1 = lerp(A,E, 1 − d/|AE|)   P2 = lerp(E,B, d/|EB|)
  // s ∈ [0,1] is distributed by segment length so the fixed 24-sample strip
  // spends its vertices evenly along the L — the knuckle chord approximates its
  // (short) arc, which is invisible at metro-line widths. This is the exact
  // grammar the acceptance preview draws (scripts/pose-grammar-previews.mjs
  // elbowPath), adapted to sample continuously for the ribbon tessellation.
  vec3 metroPos(float s) {
    vec3 A = aStart, E = aCtrl, B = aEnd;
    float la = length(E - A);
    float lb = length(B - E);
    if (la < 1e-3 || lb < 1e-3) return mix(A, B, s); // degenerate → straight
    float d = min(9.0, min(0.42 * la, 0.42 * lb));
    vec3 P1 = mix(A, E, 1.0 - d / la);
    vec3 P2 = mix(E, B, d / lb);
    float L1 = la - d;            // straight A→P1
    float Lk = length(P2 - P1);   // knuckle (chord ≈ arc)
    float L2 = lb - d;            // straight P2→B
    float L = max(L1 + Lk + L2, 1e-4);
    float x = s * L;
    if (x <= L1) return mix(A, P1, x / max(L1, 1e-4));
    if (x <= L1 + Lk) {
      float u = (x - L1) / max(Lk, 1e-4);
      float om = 1.0 - u;
      return om * om * P1 + 2.0 * om * u * E + u * u * P2;
    }
    return mix(P2, B, (x - L1 - Lk) / max(L2, 1e-4));
  }

  // Position + tangent for the bezier-based skins (Galaxy / Fidenza), blended
  // bezier→metro by m3 = the pose-3 morph amount. At m3 == 0 this returns the
  // shipped bezier position and its ANALYTIC tangent verbatim, so poses 0–2 stay
  // byte-identical; only during/at Transit does the soft swoop sharpen into the
  // metro turn (tangent via a symmetric finite difference of the blended path,
  // which stays well-defined through the knuckle).
  void curveAt(float s, float m3, out vec3 p, out vec3 tan) {
    vec3 pB = bezier(s);
    if (m3 <= 0.0) {
      p = pB;
      tan = 2.0 * (1.0 - s) * (aCtrl - aStart) + 2.0 * s * (aEnd - aCtrl);
      return;
    }
    p = mix(pB, metroPos(s), m3);
    float e = 0.03;
    float sa = clamp(s - e, 0.0, 1.0);
    float sb = clamp(s + e, 0.0, 1.0);
    vec3 pa = mix(bezier(sa), metroPos(sa), m3);
    vec3 pb = mix(bezier(sb), metroPos(sb), m3);
    tan = pb - pa;
  }

  void main() {
    vAppear = aColorA.w; // per-edge opener appear-time (ms); read in the fragment
    float m3 = clamp(uPose - 2.0, 0.0, 1.0); // pose-3 morph amount (0 off, 1 Transit)
    // Reach-normalized trunk metric (0..1), the same basis as the metro trunk WIDTH
    // (clamp((radA-1.6)*2,0,4)); wide ⇔ trunk. Written for every style so the varying
    // is always defined; only the Galaxy-Transit fragment path reads it.
    vTrunk = clamp((aArtScalars.z - 1.6) * 2.0, 0.0, 4.0) * 0.25;
    vEndZone = vec4(0.0, 0.01, 0.0, 0.01);
    vOrbGap = vec2(1e3);
    vHanga = vec4(0.0);
    if (uArtStyle < 0.5) {
      // ===================== GALAXY (shipped, byte-identical) ===============
      // At m3 == 0 curveAt returns the exact shipped bezier point + analytic
      // tangent; at Transit it samples the metro turn instead.
      vec3 p; vec3 tangent;
      curveAt(t, m3, p, tangent);
      // Coincident endpoints (control == start == end) give a zero tangent;
      // normalize() would emit NaN and blow up the whole instanced draw.
      float tlen = length(tangent);
      vec3 tdir = tlen > 1e-6 ? tangent / tlen : vec3(1.0, 0.0, 0.0);

      vec4 clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      vec4 clipT = projectionMatrix * modelViewMatrix * vec4(p + tdir, 1.0);

      // Comet screen-disc gaps (cometDiscFade in TS): this centreline point's
      // screen distance from each endpoint centre, over that orb's projected
      // radius (rest radius aArtScalars.z/w). Taken before the width offset, so
      // both sides of the strip share it. An endpoint at or behind the camera
      // plane cannot cover anything, so its gap stays large.
      {
        vec4 cA = projectionMatrix * modelViewMatrix * vec4(aStart, 1.0);
        vec4 cB = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);
        vec2 hv = 0.5 * uViewport;
        vec2 sp = clip.xy / clip.w * hv;
        float pxPerUnit = projectionMatrix[1][1] * hv.y;
        vOrbGap.x = cA.w > 1e-3
          ? length(sp - cA.xy / cA.w * hv) / max(aArtScalars.z * pxPerUnit / cA.w, 0.5)
          : 1e3;
        vOrbGap.y = cB.w > 1e-3
          ? length(sp - cB.xy / cB.w * hv) / max(aArtScalars.w * pxPerUnit / cB.w, 0.5)
          : 1e3;
      }

      // Screen-space direction (device px), then its normal.
      vec2 dir = (clipT.xy / clipT.w - clip.xy / clip.w) * uViewport;
      float len = max(length(dir), 1e-6);
      vec2 normalPx = vec2(-dir.y, dir.x) / len;

      // Width (CSS px) per state — prereq widens more when hot/chain than related.
      float e = clamp(aEmphasis, 0.0, 5.0);
      // wR[5] (related-to-focus) widened 1.3 → 1.9: the 2026-07 audit found 37%
      // of focuses light a related standard whose only visible link is this
      // dash — it must read as an explanation, not a subtlety.
      float wP[6] = float[](1.2, 1.2, 2.5, 2.5, 2.5, 1.4);
      float wR[6] = float[](1.0, 1.0, 2.0, 2.0, 2.0, 1.9);
      int i0 = int(floor(e));
      int i1 = int(min(floor(e) + 1.0, 5.0));
      float f = fract(e);
      float width = mix(mix(wP[i0], wP[i1], f), mix(wR[i0], wR[i1], f), aKind);

      // Blueprint (pose 2, Galaxy only): flatten to a thin near-constant
      // drafting weight so the linework reads as printed ink, not lit ribbons.
      // m2 is a triangular window peaking at the Blueprint (1.6→2→2.4); it is 0
      // at poses 0/1 and at Transit, so nothing else is disturbed, and the metro
      // block below re-widens the trunks as m3 takes over past pose 2.
      float m2 = clamp(1.0 - abs(uPose - 2.0) / 0.4, 0.0, 1.0);
      // Round 11 focus grammar: at the Blueprint the resting weight is a thin 1.1
      // ink line; a CONNECTED edge (emphasis >= HOVER) widens ×1.6 — the
      // highlighter stroke over the resting sheet. bpLit is 0 at rest/dimmed, 1 at
      // hover/chain/related.
      float bpLit = clamp(e - 1.0, 0.0, 1.0);
      width = mix(width, 1.1 * mix(1.0, 1.6, bpLit), m2);

      // Transit (pose 3): near-constant metro weight. Prereq trunks widen with
      // SOURCE reach (aArtScalars.z is the reach-scaled source radius already
      // threaded via radiusOf) — heavier lines carry more of the map; related
      // walking-transfers stay a thin dashed link. Emphasis widening survives via
      // max(). The width is constant along t (no along-edge taper). Gated on m3 so
      // poses 0–2 are untouched.
      if (m3 > 0.0) {
        float radA = aArtScalars.z;
        float trunk = 2.0 + clamp((radA - 1.6) * 2.0, 0.0, 4.0); // ~2..6 px by reach
        float metroW = aKind < 0.5 ? max(width, trunk) : 1.4;
        // Round 11 focus grammar: a CONNECTED line widens ×1.3 so the chain reads
        // over the ghosted city (see the fragment's Transit fade).
        metroW *= mix(1.0, 1.3, clamp(e - 1.0, 0.0, 1.0));
        width = mix(width, metroW, m3);
      }

      // Ascent dawn enamel (round-12): bold lines carving the morning sky. In the
      // pose-1 window (m1, the dawn analog of the Blueprint's m2) widen ×1.25 so the
      // structure reads against the bright field. Gated on uEnvLight so it only fires
      // when the dawn is actually up (a 0→3 sweep passing pose 1 has uEnvLight 0);
      // m1 is 0 at poses 0/2/3, so the metro/blueprint weights are untouched.
      float m1 = clamp(1.0 - abs(uPose - 1.0) / 0.5, 0.0, 1.0);
      width *= mix(1.0, 1.25, m1 * clamp(uEnvLight, 0.0, 1.0));

      vec2 offsetNdc = normalPx * (width * uPxRatio * 0.5 * side) / (uViewport * 0.5);
      clip.xy += offsetNdc * clip.w;
      gl_Position = clip;

      vT = t;
      vColor = mix(aColorA.rgb, aColorB, t);
      // VIVID enamel strand colour, interpolated endpoint→endpoint like vColor. The
      // fragment cross-fades to this in the light-environment windows (dawn/daylight).
      vVivid = mix(uVivid[int(aStrand.x + 0.5)], uVivid[int(aStrand.y + 0.5)], t);
      vKind = aKind;
      vEmphasis = e;
      // Ribbon-silhouette AA inputs (round 11): the strip's cross-position and its
      // half-width in device px. Read only under the structural-morph AA window.
      vSide = side;
      vHalfPx = max(width * uPxRatio * 0.5, 0.5);
      // Filtered-out edges (either endpoint hidden) fade toward a 0.06 ghost.
      vVisible = mix(0.06, 1.0, aVisible);
      vDamage = clamp(aDamage, 0.0, 1.0);
      // Comet end-fade zones (cometEndZone in TS): k = endpoint rest radius over
      // the live chord. Both zones stop at the midpoint, and outer > inner.
      vec2 endK = aArtScalars.zw / max(length(aEnd - aStart), 1e-3);
      vec2 zIn = min(endK * ${glf(COMET_ORB_IN)}, vec2(0.49));
      vec2 zOut = max(min(endK * ${glf(COMET_ORB_OUT)}, vec2(0.5)), zIn + 0.01);
      vEndZone = vec4(zIn.x, zOut.x, zIn.y, zOut.y);
    } else if (uArtStyle < 1.5) {
      // ===================== RINGERS: taut string ===========================
      // A straight string leaving the source peg's outer edge and landing on
      // the destination peg's edge (string-art). Inset each endpoint along the
      // chord by its node radius, then push it off the peg centre, perpendicular
      // to the chord in the world xy-plane, by the tangent-leave amount.
      float radA = aArtScalars.z;
      float radB = aArtScalars.w;
      float leaveSide = aArtScalars.y;
      vec3 chord = aEnd - aStart;
      float clen = length(chord);
      vec3 dir = clen > 1e-6 ? chord / clen : vec3(1.0, 0.0, 0.0);
      vec3 perp = length(dir.xy) < 1e-4
        ? vec3(1.0, 0.0, 0.0)
        : normalize(vec3(-dir.y, dir.x, 0.0));
      vec3 A2 = aStart + dir * radA + perp * leaveSide * radA * 0.85;
      vec3 B2 = aEnd - dir * radB + perp * leaveSide * radB * 0.85;
      vec3 p = mix(A2, B2, t);

      vec3 tangent = B2 - A2;
      float tlen = length(tangent);
      vec3 tdir = tlen > 1e-6 ? tangent / tlen : vec3(1.0, 0.0, 0.0);

      vec4 clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      vec4 clipT = projectionMatrix * modelViewMatrix * vec4(p + tdir, 1.0);
      vec2 sdir = (clipT.xy / clipT.w - clip.xy / clip.w) * uViewport;
      float len = max(length(sdir), 1e-6);
      vec2 normalPx = vec2(-sdir.y, sdir.x) / len;

      // Constant 1.7 CSS-px string (screen-space width, like the galaxy).
      float width = 1.7;
      vec2 offsetNdc = normalPx * (width * uPxRatio * 0.5 * side) / (uViewport * 0.5);
      clip.xy += offsetNdc * clip.w;
      gl_Position = clip;

      vT = t;
      vColor = mix(aColorA.rgb, aColorB, t);
      vArtColor = aArtRing;
      vArtColor2 = aArtFid2;
      vKind = aKind;
      vEmphasis = clamp(aEmphasis, 0.0, 5.0);
      vVisible = mix(0.06, 1.0, aVisible);
      vDamage = clamp(aDamage, 0.0, 1.0);
    } else if (uArtStyle < 2.5) {
      // ===================== FIDENZA: round pipe (screen-facing) ============
      // Round 7 (Mark): the anamorphic WORLD-PLANE ribbons were replaced by
      // PIPES. Expand in SCREEN space (the exact galaxy math) so every
      // connection reads as a tube from any orbit angle — never a strip that
      // foreshortens to a hairline — at REDUCED width so connections read
      // thinner than the node pipes. The fragment adds a round-tube shading
      // profile across the strip (vSide) and keeps the iconic striped caps.
      // Shares the Galaxy metro-turn blend: Fidenza pipes bend at the same
      // knuckles at Transit (m3 == 0 keeps the shipped soft bezier).
      vec3 p; vec3 tangent;
      curveAt(t, m3, p, tangent);
      float tlen = length(tangent);
      vec3 tdir = tlen > 1e-6 ? tangent / tlen : vec3(1.0, 0.0, 0.0);

      vec4 clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      vec4 clipT = projectionMatrix * modelViewMatrix * vec4(p + tdir, 1.0);
      vec2 dir = (clipT.xy / clipT.w - clip.xy / clip.w) * uViewport;
      float len = max(length(dir), 1e-6);
      vec2 normalPx = vec2(-dir.y, dir.x) / len;

      // aArtScalars.x is the old world width (~0.9–4.5). Map to a thin CSS-px
      // pipe: 2.0 + width → ~3–6 px, clamped at 6.5 — always slimmer than the
      // node pipes.
      float width = min(2.0 + aArtScalars.x, 6.5);
      vec2 offsetNdc = normalPx * (width * uPxRatio * 0.5 * side) / (uViewport * 0.5);
      clip.xy += offsetNdc * clip.w;
      gl_Position = clip;

      vT = t;
      vSide = side;
      vColor = mix(aColorA.rgb, aColorB, t);
      vArtColor = aArtFid;
      vArtColor2 = aArtFid2;
      vKind = aKind;
      vEmphasis = clamp(aEmphasis, 0.0, 5.0);
      vVisible = mix(0.06, 1.0, aVisible);
      vDamage = clamp(aDamage, 0.0, 1.0);
    } else {
      // ===================== HANGA (3 Washi | 4 Dusk): brush strokes ========
      // The Galaxy curve (curveAt, so the Transit knuckles still apply), drawn
      // as a screen-space strip whose width follows the stroke profile. The
      // tuning constants are the H_ / HD_ block above.
      vec3 p; vec3 tangent;
      curveAt(t, m3, p, tangent);
      float tlen = length(tangent);
      vec3 tdir = tlen > 1e-6 ? tangent / tlen : vec3(1.0, 0.0, 0.0);
      vec4 clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      vec4 clipT = projectionMatrix * modelViewMatrix * vec4(p + tdir, 1.0);
      vec2 dir = (clipT.xy / clipT.w - clip.xy / clip.w) * uViewport;
      float len = max(length(dir), 1e-6);
      vec2 normalPx = vec2(-dir.y, dir.x) / len;

      // Trim to the two rims: the stroke parameter u runs 0 at the
      // prerequisite's rim to 1 at the dependent's rim (k = rest radius over
      // the chord, the comet end-zone basis). Inside the discs the strip is
      // hidden by the opaque disc anyway.
      vec2 endK = aArtScalars.zw / max(length(aEnd - aStart), 1e-3);
      float tA = min(endK.x * ${glf(HANGA_DISC_SCALE)}, 0.45);
      float tB = 1.0 - min(endK.y * ${glf(HANGA_DISC_SCALE)}, 0.45);
      float u = (t - tA) / max(tB - tA, 1e-3);

      // Screen length of the stroke (device px): the two half-chords through
      // the curve midpoint, trimmed to the rims. Constant per instance.
      vec3 pm; vec3 tm;
      curveAt(0.5, m3, pm, tm);
      vec4 cA = projectionMatrix * modelViewMatrix * vec4(aStart, 1.0);
      vec4 cM = projectionMatrix * modelViewMatrix * vec4(pm, 1.0);
      vec4 cB = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);
      vec2 hv = 0.5 * uViewport;
      float lenPx = 0.0;
      if (cA.w > 1e-3 && cM.w > 1e-3 && cB.w > 1e-3) {
        lenPx = length((cM.xy / cM.w - cA.xy / cA.w) * hv) + length((cB.xy / cB.w - cM.xy / cM.w) * hv);
      }
      lenPx *= max(tB - tA, 0.0);

      // Per-edge seed from baked per-instance data (the Fidenza width hash, the
      // Ringers side, and both rest radii). aColorA.w is the opener clock and is
      // 0 outside the opener, so it cannot seed.
      float seed = fract(sin(dot(aArtScalars, vec4(12.9898, 78.233, 37.719, 4.581))) * 43758.5453);

      // Emphasis and story lift widen the stroke, never brighten it. The unlit
      // underdrawing (a focus's dimmed edges, a story's unlit set) thins a little.
      float e = clamp(aEmphasis, 0.0, 5.0);
      float lit = clamp(e - 1.0, 0.0, 1.0);
      float dimd = clamp(1.0 - e, 0.0, 1.0);
      float vis = clamp(aVisible, 0.0, 1.0);
      float story = uStory * (1.0 - clamp(aDamage * 3.0, 0.0, 1.0)) * vis;
      float wMul = max(mix(1.0, H_EMPH_WIDTH, lit), mix(1.0, H_LIFT_WIDTH, story));
      wMul *= mix(1.0, H_UNDER_WIDTH, max(dimd, 1.0 - vis));

      float widthCss;
      if (aKind < 0.5) {
        // Hand pressure: the width breathes a little along the stroke, at a
        // hashed rate and phase, so no two edges are ruled parallels.
        float pf = 1.3 + fract(seed * 7.13) * 1.4;
        float pp = fract(seed * 3.71) * 6.2831853;
        float press = 1.0 + H_PRESSURE * sin(6.2831853 * pf * clamp(u, 0.0, 1.0) + pp);
        widthCss = H_HEAD_PX * hangaWidth(u) * press * wMul;
      } else {
        widthCss = 2.0 * HD_HALF_PX * wMul;
      }
      float halfTrue = widthCss * uPxRatio * 0.5;
      // The strip is at least one device px wide plus a feather margin; the
      // fragment cuts the true silhouette inside it (sub-pixel tails become
      // partial coverage instead of aliasing).
      // Room for the texture: the roughness wobble and the widest ink bleed.
      float halfGeo = max(halfTrue, 0.5 * uPxRatio) * (1.0 + HT_ROUGH_AMP) + 0.5 + 0.5 * HT_BLEED_MAX_PX;
      // Splatter strokes (about 1 in 6, hashed) widen near the head so the
      // dots beside the stroke have pixels to land on.
      bool splat = aKind < 0.5 && fract(seed * 91.7) < HT_SPLAT_RATE;
      if (splat && u < HT_SPLAT_U_MAX + 0.08) halfGeo += HT_SPLAT_FAR_PX;
      vec2 offsetNdc = normalPx * (halfGeo * side) / (uViewport * 0.5);
      clip.xy += offsetNdc * clip.w;
      gl_Position = clip;

      vT = t;
      // Hanga: vSide carries the SIGNED distance from the centreline in device
      // px (exact under interpolation even where halfGeo steps at the head).
      vSide = side * halfGeo;
      vHalfPx = halfGeo;
      vHanga = vec4(u, seed, lenPx, halfTrue);
      vColor = mix(aColorA.rgb, aColorB, t);
      // The stroke carries the prerequisite's pigment (the preview grammar).
      vArtColor = uHanga[int(aStrand.x + 0.5)];
      vArtColor2 = vArtColor;
      vKind = aKind;
      vEmphasis = e;
      vVisible = mix(0.06, 1.0, aVisible);
      vDamage = clamp(aDamage, 0.0, 1.0);
      // Comet end-fade zones (the Galaxy basis), reused by the wet-ink sheen.
      vec2 zIn = min(endK * ${glf(COMET_ORB_IN)}, vec2(0.49));
      vec2 zOut = max(min(endK * ${glf(COMET_ORB_OUT)}, vec2(0.5)), zIn + 0.01);
      vEndZone = vec4(zIn.x, zOut.x, zIn.y, zOut.y);
    }
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uFlow; // 1 = animate prereq comets, 0 = frozen (reduced motion)
  uniform float uStory; // 1 while a story plays: healthy edges lift toward the chain look
  uniform float uArtStyle; // 0 Galaxy | 1 Ringers | 2 Fidenza | 3 Washi | 4 Dusk
  uniform float uPose; // eased pose value 0..3; 3 = Transit (opaque metro lines)
  uniform vec3 uHangaSumi; // Hanga key-block ink (LINEAR): related dabs + the unlit underdrawing
  uniform float uHangaDmgDark; // 1 on Dusk: damaged strokes darken and desaturate
  uniform float uPxRatio; // device px per CSS px (the Hanga dab sizes)
  uniform vec3 uField; // active art-style field color (damage fades toward it)
  uniform float uEnvLight; // 0..1 light-environment amount (Ascent dawn OR Transit daylight)
  // Opener per-edge crystallization: uOpenerClock is ms since the opener started
  // (< 0 ⇒ opener inactive ⇒ every ribbon fully present, byte-identical). Each edge
  // begins its soft ghost-in at its own vAppear (ms) and firms up over uEdgeFadeMs.
  uniform float uOpenerClock;
  uniform float uEdgeFadeMs;

  in float vT;
  in float vAppear; // per-edge opener appear-time (ms)
  in vec3 vColor;
  in vec3 vVivid; // interpolated VIVID strand colour (enamel repaint in light envs)
  in vec3 vArtColor;
  in vec3 vArtColor2;
  in float vKind;
  in float vEmphasis;
  in float vVisible;
  in float vDamage;
  in float vSide; // Fidenza pipe cross-position (-1..+1); round-tube shading
  in float vHalfPx; // Galaxy ribbon half-width (device px) — silhouette AA at Transit/Blueprint
  in float vTrunk; // Transit trunk metric 0..1 (reach) — unfocused-overview ghost
  in vec4 vEndZone; // comet orb end-fade zones [inner, outer] per end, Galaxy only
  in vec2 vOrbGap; // comet screen-disc gaps in projected orb radii, Galaxy only
  in vec4 vHanga; // Hanga stroke data (u, seed, length px, true half-width px)

  out vec4 fragColor;

  // Hanga tuning constants (generated from HANGA_STROKE / HANGA_DAB in TS).
  ${HANGA_GLSL_CONSTS}

  // Hanga hash + value noise for the dry-brush breaks (texture only).
  float hHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 w = f * f * (3.0 - 2.0 * f);
    return mix(mix(hHash(i), hHash(i + vec2(1.0, 0.0)), w.x),
               mix(hHash(i + vec2(0.0, 1.0)), hHash(i + vec2(1.0, 1.0)), w.x), w.y);
  }

  // Two-octave value noise in 0..1 (texture only, never animated).
  float hNoise2(vec2 p) { return 0.65 * hNoise(p) + 0.35 * hNoise(p * 2.13 + 17.0); }

  // Soft round dab (hangaDabAlpha in TS): 1 in the core, a smooth fall to 0 at
  // the ellipse edge. No hard step anywhere, so a dab never aliases into a dash.
  float hangaDab(float along, float across, float rx, float ry) {
    float d = length(vec2(along / max(rx, 1e-4), across / max(ry, 1e-4)));
    return 1.0 - smoothstep(HD_SOFT, 1.0, d);
  }

  // Flow-comet pulse (cometPulse in TS): the old cubic tail compressed into the
  // first 1 − HEAD of the period, times a smoothstep fall to 0 at the wrap. Peak
  // 1, continuous everywhere, so no orb or ribbon pixel ever jumps in one frame.
  float cometPulse(float fr) {
    float tail = pow(min(fr / ${glf(1 - COMET_HEAD)}, 1.0), 3.0);
    float head = smoothstep(0.0, 1.0, (1.0 - fr) / ${glf(COMET_HEAD)});
    return tail * head;
  }

  // Comet end-fade (cometEndFade in TS): 0 inside each endpoint orb, full from
  // COMET_ORB_OUT radii out. Edges stay in ascending order (GLSL leaves
  // smoothstep undefined when edge0 >= edge1), so the target end runs on 1 − t.
  float cometEndFade(float t) {
    return smoothstep(vEndZone.x, vEndZone.y, t) * smoothstep(vEndZone.z, vEndZone.w, 1.0 - t);
  }

  // Comet screen-disc fade (cometDiscFade in TS): 0 while the ribbon still
  // projects over either endpoint's disc, full from DISC_OUT projected radii.
  float cometDiscFade() {
    return smoothstep(${glf(COMET_DISC_IN)}, ${glf(COMET_DISC_OUT)}, vOrbGap.x)
         * smoothstep(${glf(COMET_DISC_IN)}, ${glf(COMET_DISC_OUT)}, vOrbGap.y);
  }

  // Per-edge opener reveal 0..1. Before this edge's appear-time it is 0 (the
  // ribbon is absent — its nodes are still drifting in); then a SOFT two-stage
  // ghost ramp (quick to a faint level, then a slow saturation) over uEdgeFadeMs.
  // uOpenerClock < 0 (the normal case) short-circuits to 1.0 — byte-identical.
  float openerReveal() {
    if (uOpenerClock < 0.0) return 1.0;
    float x = clamp((uOpenerClock - vAppear) / max(uEdgeFadeMs, 1.0), 0.0, 1.0);
    float G = 0.35, S1 = 0.25;
    return x < S1
      ? G * smoothstep(0.0, 1.0, x / S1)
      : G + (1.0 - G) * smoothstep(0.0, 1.0, (x - S1) / (1.0 - S1));
  }

  void main() {
    float m3 = clamp(uPose - 2.0, 0.0, 1.0); // pose-3 morph amount (0 off, 1 Transit)
    // Blueprint window (pose 2, Galaxy only): a triangular ramp peaking at 2.0,
    // zero outside 1.6..2.4 — off at poses 0/1 and at Transit.
    float m2 = clamp(1.0 - abs(uPose - 2.0) / 0.4, 0.0, 1.0);
    // Ascent dawn window (pose 1, Galaxy only): the dawn analog of m2, peaking at
    // 1.0, zero outside 0.5..1.5. env gates on the actual light-environment amount
    // so a sweep passing pose 1 with no dawn up stays byte-identical; enamel is the
    // VIVID repaint strength, live in EITHER light window (dawn m1 OR daylight m3).
    float m1 = clamp(1.0 - abs(uPose - 1.0) / 0.5, 0.0, 1.0);
    float env = clamp(uEnvLight, 0.0, 1.0);
    float enamel = env * max(m1, m3);
    if (uArtStyle < 0.5) {
      // ===================== GALAXY (shipped, byte-identical) ===============
      float e = vEmphasis;
      // Round 11 focus grammar helpers (shared by the Blueprint m2 and Transit m3
      // windows). lit ramps 0 at REST(1) → 1 at HOVER(2)+ : a "connected to the
      // focus" signal (hover/chain/related all read connected). dimd is 1 only at
      // DIMMED(0) — an UNCONNECTED edge during a focus (the base goes DIMMED under a
      // focus). Both are 0 with no focus (every edge REST), so no-focus looks — and
      // poses 0–2 — stay untouched.
      float lit  = clamp(e - 1.0, 0.0, 1.0);
      float dimd = clamp(1.0 - e, 0.0, 1.0);
      // restness is 1 ONLY for a resting edge (no focus, not the hovered line): both
      // lit and dimd are 0. It gates the Transit unfocused-overview trunk ghost below
      // so a focus's connected/dimmed grammar is never disturbed.
      float restness = (1.0 - lit) * (1.0 - dimd);
      int i0 = int(floor(e));
      int i1 = int(min(floor(e) + 1.0, 5.0));
      float f = fract(e);

      // Per-state tables indexed by emphasis: dimmed/rest/hover/focus/chain/related.
      float aP[6]    = float[](0.06, 0.35, 0.9, 0.9, 0.9, 0.40);  // prereq alpha
      float aR[6]    = float[](0.04, 0.18, 0.7, 0.7, 0.7, 0.90);  // related alpha
      float mulP[6]  = float[](1.0,  1.0,  2.2, 2.2, 2.2, 1.40);  // prereq HDR mul
      float mulR[6]  = float[](1.0,  1.0,  1.3, 1.3, 1.3, 1.6);   // related HDR mul (5: audit)
      float flowP[6] = float[](0.0,  0.0,  1.0, 1.0, 1.0, 0.0);   // comet flow (prereq)
      float shimR[6] = float[](0.0,  0.0,  1.0, 0.0, 0.0, 1.0);   // shimmer (related)

      vec3 col = vColor;
      float alpha;

      // Story lift: while a story plays, edges that are LIT (visible) and healthy
      // rise toward the chain look (bright, flowing). Damage kills the lift
      // (gone by d≈0.7) and so does the ghost mask — an edge outside the story's
      // lit set stays a dark filament, no glow, no comets. max(), not ×, so an
      // already-chain-lit edge never double-brightens.
      float story = uStory
        * (1.0 - clamp(vDamage * 3.0, 0.0, 1.0))
        * clamp((vVisible - 0.06) / 0.94, 0.0, 1.0);

      if (vKind < 0.5) {
        // Prerequisite (directed): HDR-bright with directional comets when chain/hot.
        alpha = max(mix(aP[i0], aP[i1], f), 0.65 * story);
        // Transit metro alpha (round 11 focus grammar): resting + connected lines
        // stay OPAQUE metro (~0.95, today's look); a focus collapses UNCONNECTED
        // lines to ~0.12 so they dissolve into the city and the chain owns the frame.
        // max() keeps a hot/chain edge bright; mix(...,m3) leaves poses 0–2 unchanged.
        alpha = mix(alpha, mix(max(alpha, 0.95), 0.12, dimd), m3);
        // Transit UNFOCUSED-overview trunk ghost (FORMATIONS metro grammar): with no
        // focus, ~757 resting lines all sit at ~0.95 and tangle at full zoom. Feature
        // the trunk network by fading NON-TRUNK (low vTrunk) resting lines toward the
        // dimmed convention (~0.08·alpha) while wide trunks stay opaque — width and
        // opacity then agree (both key off reach). restness*m3 keeps focused Transit
        // and poses 0–2 byte-identical. (Mirrors focusgrammar.transitOverviewKeep.)
        float trunkKeep = 0.05 + 0.95 * smoothstep(0.5, 0.85, vTrunk);
        alpha *= mix(1.0, trunkKeep, restness * m3);
        // Blueprint ink alpha (round 11): dimmed→faint 0.18, resting→0.55 legible
        // ink, connected→0.90 highlighter (= 0.55 + 0.35·lit − 0.37·dimd).
        alpha = mix(alpha, 0.55 + 0.35 * lit - 0.37 * dimd, m2);
        // Ascent dawn (round-12): bold enamel — resting/connected lines carry ~0.92
        // alpha so they carve the morning sky; an unconnected (focus-dimmed) line
        // still recedes to ~0.15. Gated on env·m1 (dawn only), so poses 0/2/3 unchanged.
        alpha = mix(alpha, 0.15 + 0.77 * clamp(e, 0.0, 1.0), env * m1);
        col *= max(mix(mulP[i0], mulP[i1], f), 1.0 + 0.8 * story);
        float flow = max(mix(flowP[i0], flowP[i1], f), story);
        float fr = fract(vT * 6.0 - uTime * 0.5 * uFlow);
        // Smooth pulse, faded to 0 inside the endpoint orbs and over their
        // screen discs, so a comet never flashes the orb it leaves or enters
        // (the ribbon starts at the centre).
        float comet = cometPulse(fr) * cometEndFade(vT) * cometDiscFade();
        col += vColor * comet * 2.0 * flow;
      } else {
        // Related (undirected): in-shader dash, slow shimmer, NEVER a flow comet.
        float dash = step(0.5, fract(vT * 14.0));
        float aRel = max(mix(aR[i0], aR[i1], f), 0.4 * story);
        // Transit: related pairs are dashed WALKING TRANSFERS — resting reads as an
        // opaque dashed link; a focus collapses UNCONNECTED transfers to ~0.12 (they
        // dissolve into the city with the rest of the ghosted map).
        aRel = mix(aRel, mix(max(aRel, 0.34), 0.12, dimd), m3);
        // Walking transfers are never a trunk line: in the unfocused overview they
        // recede too (restness*m3), so the resting Transit map reads as its trunk
        // network + stations, not 899 overlapping ribbons.
        aRel *= mix(1.0, 0.10, restness * m3);
        // Blueprint: connected related re-saturate (dashed highlighter); unconnected
        // fade faint (= 0.50 + 0.35·lit − 0.32·dimd).
        aRel = mix(aRel, 0.50 + 0.35 * lit - 0.32 * dimd, m2);
        // Ascent dawn: bold the dashed transfer to match the prereq enamel (~0.92).
        aRel = mix(aRel, 0.15 + 0.77 * clamp(e, 0.0, 1.0), env * m1);
        alpha = aRel * dash;
        float shim = max(mix(shimR[i0], shimR[i1], f), story);
        col *= mix(mulR[i0], mulR[i1], f) * (1.0 + 0.2 * sin(uTime * 2.0) * shim);
      }

      // VIVID enamel repaint (round-12, Galaxy light environments): in the Ascent
      // dawn AND the Transit daylight the material paints with NORMAL blending
      // (edges.setEnvLight), so the strand must carry a FULL, VIVID colour rather
      // than an additive glow. Repaint the ribbon with its pure VIVID strand hue at
      // full saturation (the round-11 ×0.85 deepening is GONE — it read "muddy"); the
      // HDR multiplier + flow comet dissolve into flat enamel signage. Gated on
      // enamel = env·max(m1, m3): uEnvLight 0 (and poses 0/2) stay byte-identical,
      // and the unconnected city dissolve below still recedes the ghosted Transit map.
      col = mix(col, vVivid, enamel);

      // Blueprint recolor (pose 2, Galaxy only): the resting sheet is white ink;
      // strand colour is the highlighter. Resting ink = white-ink at a 50% strand
      // tint (raised from 30% — the user found 30% too faint). A CONNECTED edge
      // re-saturates to FULL strand colour (no white blend); unconnected edges keep
      // the resting tint and recede via the faint alpha above. The white-ink literal
      // is LINEAR #eaf2ff. m2 == 0 at poses 0/1 and Transit, so nothing else moves.
      if (m2 > 0.0) {
        vec3 restInk = mix(vec3(0.823, 0.887, 1.0), vColor, 0.5);
        vec3 inkCol = mix(restInk, vColor, lit);
        col = mix(col, inkCol, m2);
      }
      // Transit recolor (pose 3, Galaxy only): a focus dissolves UNCONNECTED lines
      // into the CITY BACKGROUND — near-black #0a0a16 in the dark baseline, concrete
      // grey #beb9b0 at daylight (mix by uEnvLight, which equals the daylight amount
      // at pose 3 — dawn is 0 there) — so the ghosted city recedes and the chain
      // reads. Connected + resting lines keep their VIVID enamel. Literals are LINEAR.
      // Gated on dimd·m3, so no-focus Transit and poses 0–2 are untouched.
      if (m3 > 0.0) {
        vec3 cityBg = mix(vec3(0.003035, 0.003035, 0.008023), vec3(0.514918, 0.485150, 0.434154), uEnvLight);
        col = mix(col, cityBg, dimd * m3);
      }

      // Structural damage (stories): pull the edge toward a near-black ember
      // (sRGB #2a120c; the literal is LINEAR — the output transform re-brightens
      // it) and drop most of its alpha — a broken lineage goes dark, not merely
      // warm. Additive-blend safe: both moves subtract light.
      col = mix(col, vec3(0.0231, 0.0060, 0.0037), vDamage);
      alpha *= (1.0 - 0.55 * vDamage);

      // Ribbon-silhouette AA (round 11 flicker fix): with antialias:false the flat
      // screen-space ribbons alias as the camera orbits, and at the structural poses
      // hundreds of near-opaque additive ribbons overlap along shared corridors —
      // additive stacking amplifies the sub-pixel coverage flip into visible shimmer.
      // Feather the alpha across the last ~0.9 device px of each edge (fixed pixel
      // span via vHalfPx, so thin lines keep a full-alpha core). Gated on the
      // structural morph max(m2, m3): poses 0–1 stay byte-identical and the soft edge
      // exists only where the metro/blueprint grammar does. Touches no depth and no
      // route/position — a texture, not a placement (THE LAW holds).
      float aaWin = max(m2, m3);
      float aaEdge = clamp(1.0 - 0.9 / vHalfPx, 0.0, 0.92);
      float edgeAA = 1.0 - smoothstep(aaEdge, 1.0, abs(vSide));
      alpha *= mix(1.0, edgeAA, aaWin);
      // Opener per-edge crystallization: each ribbon ghosts in after both its
      // nodes land. openerReveal() is exactly 1.0 off-opener, so byte-identical.
      fragColor = vec4(col, alpha * vVisible * openerReveal());
    } else if (uArtStyle < 2.5) {
      // ===================== ART STYLES (paper: opacity, never HDR) =========
      // Dimness is OPACITY toward the field: no comets, no shimmer, no bloom.
      vec3 col = vArtColor;
      float litness = clamp((vVisible - 0.06) / 0.94, 0.0, 1.0);
      float baseA = (uArtStyle < 1.5) ? 0.85 : 0.95; // Ringers / Fidenza
      float alpha = baseA * mix(0.08, 1.0, litness);
      // Emphasis dim (e < 1) drops alpha; hover/focus/chain (e >= 1) read via
      // width + full opacity, never a brightness multiply.
      alpha *= mix(0.25, 1.0, clamp(vEmphasis, 0.0, 1.0));

      // Related edges keep the in-shader dash in both art styles.
      if (vKind >= 0.5) {
        float dash = step(0.5, fract(vT * 14.0));
        alpha *= dash;
      }

      // Fidenza striped caps (prereq ends only): alternate the body color with
      // the cap alternate near t = 0 and t = 1. Kept exactly — the iconic stripes.
      if (uArtStyle >= 1.5 && vKind < 0.5 && (vT < 0.12 || vT > 0.88)) {
        float band = step(0.5, fract(vT * 42.0));
        col = mix(col, vArtColor2, band);
      }

      // Fidenza round-tube shading (round 7, Mark): shade the flat screen-facing
      // strip like a cylinder so the connection reads as a pipe — bright along
      // the centreline (vSide≈0), darkening to the silhouette (vSide≈±1). Applied
      // to the striped caps too, so the stripes wrap the tube. Ringers strings
      // are untouched (guarded on Fidenza).
      if (uArtStyle >= 1.5) {
        col *= sqrt(max(0.15, 1.0 - vSide * vSide));
      }

      // Damage: dissolve a broken lineage into the field and shed opacity.
      col = mix(col, uField, clamp(vDamage * 0.85, 0.0, 1.0));
      alpha *= (1.0 - 0.5 * vDamage);

      fragColor = vec4(col, alpha * openerReveal()); // opener crystallization (1 = shipped)
    } else {
      // ===================== HANGA (3 Washi | 4 Dusk) ========================
      // Ink on paper: dimness is opacity, emphasis is width (vertex), and the
      // only motion is a slow wet-ink sheen down lit chain strokes. The tuning
      // constants are the H_ / HD_ block above.
      float u = vHanga.x;
      float seed = vHanga.y;
      float lenPx = vHanga.z;
      float halfTrue = vHanga.w;
      float e = vEmphasis;
      float lit = clamp(e - 1.0, 0.0, 1.0);
      float dimd = clamp(1.0 - e, 0.0, 1.0);
      float litness = clamp((vVisible - 0.06) / 0.94, 0.0, 1.0);
      // Underdrawing amount: a focus's dimmed edges and a story's unlit set.
      float under = max(dimd, 1.0 - litness);
      // Story lift (healthy lit strokes): full pigment, like a chain stroke.
      float story = uStory * (1.0 - clamp(vDamage * 3.0, 0.0, 1.0)) * litness;
      float sidePx = vSide; // signed device px from the centreline (Hanga vertex)
      float distPx = abs(sidePx);
      int i0 = int(floor(e));
      int i1 = int(min(floor(e) + 1.0, 5.0));
      float f = fract(e);

      vec3 col;
      float alpha;
      if (vKind < 0.5) {
        // Silhouette: a one-px feather on the true half-width. A tail thinner
        // than a pixel keeps partial coverage instead of aliasing.
        // Texture (HANGA_TEXTURE): each edge of the stroke wobbles on its own
        // noise lane along t (a brush on fibrous paper), and the feather (the
        // ink bleed) varies with the same noise. All of it rides the stroke's
        // own coordinates, so nothing crawls when the camera moves.
        float laneSeed = sidePx > 0.0 ? seed * 13.0 : seed * 29.0 + 7.0;
        float rough = hNoise2(vec2(vT / HT_ROUGH_PERIOD, laneSeed));
        float halfEff = halfTrue * (1.0 + HT_ROUGH_AMP * (2.0 * rough - 1.0));
        float bleed = mix(HT_BLEED_MIN_PX, HT_BLEED_MAX_PX, rough);
        float cover = clamp((halfEff - distPx) / bleed + 0.5, 0.0, 1.0);
        // Round head inside the prerequisite's disc (seen only when the disc
        // is translucent, for example in the underdrawing).
        if (u < 0.0) {
          float back = -u * lenPx;
          cover = clamp((halfEff - length(vec2(back, distPx))) / bleed + 0.5, 0.0, 1.0);
        }
        // The tail lifts off just short of the dependent's rim.
        cover *= 1.0 - smoothstep(0.97, 1.0, u);

        // Kasure: from H_KASURE_START the brush runs dry. The stroke splits
        // into 2 or 3 bristle lanes whose bare gaps widen toward the tail, and
        // each lane breaks at hashed points along its length.
        float dry = smoothstep(H_KASURE_START, 1.0, u);
        float nb = seed < 0.5 ? 2.0 : 3.0;
        float xs = clamp(sidePx / max(halfTrue, 1e-3) * 0.5 + 0.5, 0.0, 1.0);
        float lc = xs * nb;
        float lane = floor(min(lc, nb - 0.001));
        float lf = lc - lane;
        float gap = 0.06 + H_KASURE_GAP * dry;
        float prof = smoothstep(0.0, gap, lf) * (1.0 - smoothstep(1.0 - gap, 1.0, lf));
        // A lane narrower than ~2 px cannot resolve: blend the split toward its
        // mean so a thin stroke never shimmers.
        float resolve = smoothstep(0.9, 2.2, 2.0 * halfTrue / nb);
        float split = mix(1.0 - gap, prof, resolve);
        float breaks = max(lenPx / H_BREAK_PX, 2.0);
        float n = hNoise(vec2(u * breaks + lane * 7.31 + seed * 3.0, lane * 3.7 + seed * 19.0));
        float keep = smoothstep(dry * 0.6 - 0.06, dry * 0.6 + 0.06, n);
        float ink = mix(1.0, split * keep, dry) * mix(1.0, 0.82, dry);

        col = vArtColor;
        alpha = mix(H_REST_ALPHA, H_LIT_ALPHA, max(lit, story));

        // Wet-ink sheen: a slow band of denser pigment travels down a lit chain
        // stroke from prerequisite to dependent (cometPulse, end-faded at both
        // orbs). Opacity only, a small swing, frozen by uFlow under reduced motion.
        float flowTab[6] = float[](0.0, 0.0, 1.0, 1.0, 1.0, 0.0);
        float flow = max(mix(flowTab[i0], flowTab[i1], f), story) * (1.0 - under);
        float fr = fract(u * H_SHEEN_WAVES - uTime / H_SHEEN_PERIOD_SEC * uFlow);
        float sheen = cometPulse(fr) * cometEndFade(vT);
        alpha *= 1.0 - H_SHEEN_SWING * flow * (1.0 - sheen);

        // Underdrawing: faint sumi, the stroke shape kept.
        col = mix(col, uHangaSumi, under);
        alpha = mix(alpha, H_UNDER_ALPHA, under);
        alpha *= cover * ink;
        // Pigment unevenness: the paper shows through the ink. A two-octave
        // noise over (t, side) and the seed, mean-preserving, denser at the
        // head and more broken toward the tail.
        float pn = hNoise2(vec2(vT * HT_UNEVEN_K + seed * 41.0, xs * 1.6 + seed * 9.0));
        float swing = mix(HT_UNEVEN_HEAD, HT_UNEVEN_TAIL, smoothstep(0.0, 1.0, u));
        alpha = clamp(alpha * (1.0 - 0.5 * swing + swing * pn), 0.0, 1.0);

        // Dry streaks in the body: 2 or 3 thin lanes of lower opacity run along
        // t (bristle marks), each at a hashed place across the stroke and broken
        // by its own noise along the length. A lane narrower than ~1.5 px cannot
        // resolve, so on a thin stroke it fades to its mean (a lighter body).
        float nLanes = 2.0 + step(0.5, fract(seed * 17.3));
        float streak = 0.0;
        for (int k = 0; k < 3; k++) {
          float fk = float(k);
          if (fk >= nLanes) break;
          float c = 0.18 + 0.64 * hHash(vec2(seed * 31.0 + fk * 3.7, fk + 1.0));
          float lane = 1.0 - smoothstep(0.5 * HT_STREAK_WIDTH, HT_STREAK_WIDTH, abs(xs - c));
          float run = smoothstep(0.42, 0.62, hNoise(vec2(vT * 9.0 + fk * 5.3, seed * 23.0 + fk)));
          streak = max(streak, lane * run);
        }
        float laneRes = smoothstep(0.6, 1.4, 4.0 * halfTrue * HT_STREAK_WIDTH); // lane width, device px
        streak = mix(HT_STREAK_WIDTH * 0.8 * 0.5, streak, laneRes);
        alpha *= 1.0 - HT_STREAK_ALPHA * streak;

        // Ink splatter (rare, static): on about 1 in 6 strokes, two to four
        // tiny dots and one small fleck near the head, beside or on the
        // stroke, in its own pigment at reduced opacity.
        if (fract(seed * 91.7) < HT_SPLAT_RATE && u < HT_SPLAT_U_MAX + 0.08) {
          float spl = 0.0;
          float nDots = 2.0 + floor(hHash(vec2(seed * 3.3, 5.1)) * 3.0);
          for (int k = 0; k < 5; k++) {
            float fk = float(k);
            if (fk > nDots) break;
            float h1 = hHash(vec2(seed * 57.0 + fk * 11.3, fk));
            float h2 = hHash(vec2(seed * 23.0 + fk * 5.7, fk + 3.0));
            float h3 = hHash(vec2(seed * 71.0 + fk * 2.9, fk + 9.0));
            float uk = 0.02 + h1 * HT_SPLAT_U_MAX;
            float sgn = h2 < 0.5 ? -1.0 : 1.0;
            // The first one or two dots may fly farther (up to HT_SPLAT_FAR_PX).
            float reach = fk < 1.0 + step(0.5, h3) ? HT_SPLAT_FAR_PX : HT_SPLAT_REACH_PX;
            float off = sgn * (halfTrue + 0.4 + fract(h2 * 7.0) * (reach - 0.6));
            float r = 0.5 * mix(HT_SPLAT_MIN_PX, HT_SPLAT_MAX_PX, h3);
            vec2 dd = vec2((u - uk) * lenPx, sidePx - off);
            // The last one is a fleck: stretched along the stroke.
            if (fk == nDots) dd.x *= 0.45;
            spl = max(spl, (1.0 - smoothstep(r - 0.5, r + 0.5, length(dd))) * (0.65 + 0.35 * h3));
          }
          float splA = HT_SPLAT_ALPHA * spl * (1.0 - under) * mix(H_REST_ALPHA, H_LIT_ALPHA, max(lit, story));
          alpha = max(alpha, splA);
        }
      } else {
        // Related pair: a row of soft round sumi dabs, anchored at the source
        // rim, each with a hashed size, offset, and ink load.
        float wMul = halfTrue / max(HD_HALF_PX * uPxRatio, 1e-3);
        float cell = HD_SPACING_PX * uPxRatio;
        float sPx = u * lenPx;
        float k = floor(sPx / cell);
        float h1 = hHash(vec2(k, seed * 31.0));
        float h2 = hHash(vec2(k + 17.0, seed * 13.0));
        float h3 = hHash(vec2(k + 41.0, seed * 7.0));
        float h4 = hHash(vec2(k + 73.0, seed * 5.0));
        float along = (fract(sPx / cell) - 0.5 - (h1 - 0.5) * 0.45) * cell;
        float rx = (HD_RX_PX + h2 * HD_RX_JITTER_PX) * uPxRatio * wMul;
        float ry = (HD_RY_PX + h3 * HD_RY_JITTER_PX) * uPxRatio * wMul;
        float dab = hangaDab(along, distPx, rx, ry);
        dab *= smoothstep(0.0, 0.02, u) * (1.0 - smoothstep(0.98, 1.0, u));
        col = uHangaSumi;
        alpha = mix(HD_REST_ALPHA, HD_LIT_ALPHA, max(lit, story)) * (0.7 + 0.3 * h4);
        alpha = mix(alpha, H_UNDER_ALPHA * 0.8, under);
        alpha *= dab;
      }

      // Damage: the pigment washes toward the field and sheds opacity. On Dusk
      // (a dark field under light pigments) the stroke first drains of colour
      // and light, matching the damaged disc (HANGA_DUSK_DAMAGE).
      if (uHangaDmgDark > 0.5) {
        float kd = smoothstep(0.0, ${glf(HANGA_DUSK_DAMAGE.RAMP)}, vDamage);
        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(col, vec3(lum), ${glf(HANGA_DUSK_DAMAGE.DESAT)} * kd);
        col *= mix(1.0, ${glf(HANGA_DUSK_DAMAGE.DARKEN)}, kd);
        col = mix(col, uField, ${glf(HANGA_DUSK_DAMAGE.WASH)} * vDamage);
      } else {
        col = mix(col, uField, clamp(vDamage * 0.85, 0.0, 1.0));
      }
      alpha *= 1.0 - 0.6 * vDamage;

      fragColor = vec4(col, alpha * openerReveal());
    }
  }
`;

export interface EdgesHandle {
  mesh: THREE.Mesh;
  count: number;
  /** Target emphasis attribute; write via the state machine only. */
  emphasisAttr: THREE.InstancedBufferAttribute;
  /** Filter-visibility attribute (1 shown / 0 ghosted); write via filters only. */
  visibleAttr: THREE.InstancedBufferAttribute;
  /** Per-edge damage 0..1 (max of endpoints); write via setDamage only. */
  damageAttr: THREE.InstancedBufferAttribute;
  /** Story-mode lift (0 = off, 1 = healthy edges glow + flow); stories only. */
  setStory(amount: number): void;
  /**
   * Set per-edge damage (0..1, typically the max of the endpoint node damages).
   * The fragment cools the edge toward a dark ember and drops its alpha. null
   * clears every edge to 0 in one memset.
   */
  setDamage(values: Float32Array | null): void;
  /** Story-only visibility override (see nodes.setVisibleMask). null restores. */
  setVisibleMask(mask: Float32Array | null): void;
  /** Bezier endpoint/control attributes — the pose driver rewrites these each
   *  frame of a morph (aStart/aEnd from the endpoint nodes' current positions,
   *  aCtrl = lerp(c, c2, …)); it flips their needsUpdate itself. */
  startAttr: THREE.InstancedBufferAttribute;
  ctrlAttr: THREE.InstancedBufferAttribute;
  endAttr: THREE.InstancedBufferAttribute;
  setTime(t: number): void;
  setFlowEnabled(on: boolean): void;
  /**
   * Feed the eased pose value (0..3) so the Transit pose (3) can render its metro
   * grammar — straight runs with tight rounded knuckles, opaque trunk lines,
   * dashed walking transfers. Everything is gated on the pose-3 morph amount, so
   * poses 0–2 stay pixel-identical. The pose driver calls this every morph frame.
   */
  setPose(p: number): void;
  /**
   * Opener per-edge crystallization clock (ms since the opener started; −1 =
   * inactive ⇒ every ribbon fully present, byte-identical). Each ribbon ghosts in
   * after its own appear-time (setOpenerAppearTimes). The pose driver advances this
   * each opener frame and sets it to −1 on settle; nothing else touches it.
   */
  setOpenerClock(ms: number): void;
  /**
   * Set the per-edge opener appear-times (ms since opener start), one per edge —
   * packed into aColorA.w, written once when the opener starts. `fadeMs` is each
   * ribbon's ghost-in length. Pass null to clear (appear-times → 0).
   */
  setOpenerAppearTimes(times: Float32Array | null, fadeMs?: number): void;
  /**
   * Feed the LIGHT-environment amount (0..1) — max(dawn, daylight). Consumers:
   * (1) the VIVID enamel — past the window midpoint the Galaxy material flips to
   * normal blending and the fragment repaints each ribbon with its full VIVID strand
   * hue, so signage sits ON the bright field (dawn sky / concrete) instead of washing
   * to cream; the dawn also widens ×1.25 and floors alpha ~0.92. (2) the Transit
   * focus grammar dissolves unconnected metro lines toward the live city background
   * (near-black dark baseline → concrete grey at daylight). main.ts passes
   * environs.envLight01() each rendered frame (0 off-Galaxy, so paper styles are
   * never touched).
   */
  setEnvLight(amount: number): void;
  setViewport(widthPx: number, heightPx: number, pixelRatio: number): void;
  /**
   * Swap the render skin: 0 Galaxy (additive light ribbons, exactly the
   * shipped look) | 1 Ringers (taut pure-color strings, normal blending) |
   * 2 Fidenza (thin screen-facing round pipes with striped caps) | 3 Washi and
   * 4 Dusk (tapered woodblock brush strokes and sumi dabs). Emphasis /
   * visibility / damage attributes keep their meaning; art styles express
   * dimness as opacity.
   */
  setArtStyle(style: number): void;
  dispose(): void;
}

// `radiusOf` returns a node's VISUAL rest radius by id (reach-scaled, see
// scene/reach.ts) so Ringers string tangents land on the drawn peg edges.
export function createEdges(
  edges: GraphEdge[],
  nodesById: Map<string, GraphNode>,
  radiusOf: (id: string) => number,
): EdgesHandle {
  const count = edges.length;

  // -- template strip -----------------------------------------------------
  const rows = SEGMENTS + 1;
  const tArr = new Float32Array(rows * 2);
  const sideArr = new Float32Array(rows * 2);
  for (let i = 0; i < rows; i++) {
    const t = i / SEGMENTS;
    tArr[i * 2] = t;
    tArr[i * 2 + 1] = t;
    sideArr[i * 2] = -1;
    sideArr[i * 2 + 1] = 1;
  }
  const index: number[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.instanceCount = count;
  // Position attribute is unused (bezier computed in-shader) but three needs
  // one to size the draw range.
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(rows * 2 * 3), 3));
  geometry.setAttribute("t", new THREE.BufferAttribute(tArr, 1));
  geometry.setAttribute("side", new THREE.BufferAttribute(sideArr, 1));
  geometry.setIndex(index);

  // -- per-instance data ----------------------------------------------------
  const start = new Float32Array(count * 3);
  const ctrl = new Float32Array(count * 3);
  const end = new Float32Array(count * 3);
  // aColorA is packed vec4: .rgb = source strand color, .w = the opener APPEAR
  // TIME (ms since opener start) at which this ribbon may begin its ghost-in.
  // Packing into the spare .w costs no extra vertex attribute slot (the program
  // is already at the WebGL2 floor of 16). Default .w = 0; the pose driver writes
  // real appear-times only while the opener plays (setOpenerAppearTimes), and the
  // in-shader reveal is a strict no-op unless uOpenerClock ≥ 0.
  const colorA = new Float32Array(count * 4);
  const colorB = new Float32Array(count * 3);
  const kind = new Float32Array(count);
  const emphasis = new Float32Array(count).fill(1); // rest
  const visible = new Float32Array(count).fill(1); // filter visibility
  const damage = new Float32Array(count); // structural damage 0..1 (all 0 at rest)
  // (source strand index, target strand index) 0..3 → the VIVID enamel palette
  // (uVivid[], index-aligned to STRAND_ORDER). One packed vec2 attribute keeps the
  // galaxy vertex program at 16 attributes — its guaranteed WebGL2 floor.
  const strand = new Float32Array(count * 2);

  // VIVID enamel palette as LINEAR vec3s (THREE.Color sRGB→working), index-aligned
  // to STRAND_ORDER — the uVivid[4] uniform the light-environment repaint samples.
  const vividVecs = STRAND_ORDER.map((s) => {
    const cc = new THREE.Color().setHex(STRAND_VIVID[s]);
    return new THREE.Vector3(cc.r, cc.g, cc.b);
  });

  // Hanga pigment palette (LINEAR), index-aligned to STRAND_ORDER, refilled in
  // place by setArtStyle (no allocation on a swap).
  const hangaVecs = STRAND_ORDER.map(() => new THREE.Vector3());

  // Art-style per-instance data (baked once; static across poses — a node's
  // radius and strand never change). Colors baked via THREE.Color.r/g/b, i.e.
  // LINEAR, matching the galaxy edge/instanceColor convention.
  const artRing = new Float32Array(count * 3); // Ringers string color (source strand)
  const artFid = new Float32Array(count * 3); // Fidenza ribbon body color
  const artFid2 = new Float32Array(count * 3); // Fidenza striped-cap alternate
  // Four scalars packed into one vec4 attribute (x=Fidenza world width, y=Ringers
  // string-leave side ±1, z=source rest radius, w=target rest radius). Packing
  // keeps the geometry under the GPU's 16 vertex-attribute limit — four separate
  // float attributes tipped the edge program over (link error on 16-attrib GPUs).
  const artScalars = new Float32Array(count * 4);

  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const e = edges[i];
    const s = nodesById.get(e.s);
    const t = nodesById.get(e.t);
    if (!s || !t) throw new Error(`Edge references unknown node: ${e.s} -> ${e.t}`);
    start.set(s.pos, i * 3);
    ctrl.set(e.c, i * 3);
    end.set(t.pos, i * 3);
    c.setHex(STRAND_COLORS[s.strand]);
    colorA[i * 4] = c.r;
    colorA[i * 4 + 1] = c.g;
    colorA[i * 4 + 2] = c.b;
    colorA[i * 4 + 3] = 0; // opener appear-time (ms); 0 until the opener sets it
    c.setHex(STRAND_COLORS[t.strand]);
    colorB.set([c.r, c.g, c.b], i * 3);
    kind[i] = e.k;
    strand[i * 2] = STRAND_ORDER.indexOf(s.strand);
    strand[i * 2 + 1] = STRAND_ORDER.indexOf(t.strand);

    // Ringers: the string carries the SOURCE peg's strand color.
    c.setHex(RINGERS.peg[s.strand] ?? RINGERS.pegWhite);
    artRing.set([c.r, c.g, c.b], i * 3);
    // Fidenza: body + cap-alternate palette picks (two different hash salts).
    c.setHex(FIDENZA.palette[Math.floor(artHash(e.s + "→" + e.t) * 6)]);
    artFid.set([c.r, c.g, c.b], i * 3);
    c.setHex(FIDENZA.palette[Math.floor(artHash("alt:" + e.s + "→" + e.t) * 6)]);
    artFid2.set([c.r, c.g, c.b], i * 3);
    // Packed scalars (x,y,z,w):
    //  x — Fidenza ribbon width (world units): base + hash jitter + degree bonus,
    //      capped so hub-to-hub ribbons never swamp the field.
    //  y — Ringers string-leave side (±1); z/w — source/target rest radii.
    artScalars[i * 4] = Math.min(4.5, 0.9 + artHash(e.s + e.t) * 2.4 + (s.deg + t.deg) * 0.1);
    artScalars[i * 4 + 1] = artHash(e.s + "|" + e.t) < 0.5 ? 1 : -1;
    artScalars[i * 4 + 2] = radiusOf(e.s);
    artScalars[i * 4 + 3] = radiusOf(e.t);
  }

  const emphasisAttr = new THREE.InstancedBufferAttribute(emphasis, 1);
  emphasisAttr.setUsage(THREE.DynamicDrawUsage);
  const visibleAttr = new THREE.InstancedBufferAttribute(visible, 1);
  visibleAttr.setUsage(THREE.DynamicDrawUsage);
  const damageAttr = new THREE.InstancedBufferAttribute(damage, 1);
  damageAttr.setUsage(THREE.DynamicDrawUsage);
  // Endpoint + control attributes are static at rest but rewritten every frame
  // during a pose morph — mark them dynamic so the driver's updates are cheap.
  const startAttr = new THREE.InstancedBufferAttribute(start, 3);
  const ctrlAttr = new THREE.InstancedBufferAttribute(ctrl, 3);
  const endAttr = new THREE.InstancedBufferAttribute(end, 3);
  startAttr.setUsage(THREE.DynamicDrawUsage);
  ctrlAttr.setUsage(THREE.DynamicDrawUsage);
  endAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aVisible", visibleAttr);
  geometry.setAttribute("aStart", startAttr);
  geometry.setAttribute("aCtrl", ctrlAttr);
  geometry.setAttribute("aEnd", endAttr);
  const colorAAttr = new THREE.InstancedBufferAttribute(colorA, 4);
  geometry.setAttribute("aColorA", colorAAttr);
  geometry.setAttribute("aColorB", new THREE.InstancedBufferAttribute(colorB, 3));
  geometry.setAttribute("aStrand", new THREE.InstancedBufferAttribute(strand, 2));
  geometry.setAttribute("aKind", new THREE.InstancedBufferAttribute(kind, 1));
  geometry.setAttribute("aEmphasis", emphasisAttr);
  geometry.setAttribute("aDamage", damageAttr);
  geometry.setAttribute("aArtRing", new THREE.InstancedBufferAttribute(artRing, 3));
  geometry.setAttribute("aArtFid", new THREE.InstancedBufferAttribute(artFid, 3));
  geometry.setAttribute("aArtFid2", new THREE.InstancedBufferAttribute(artFid2, 3));
  geometry.setAttribute("aArtScalars", new THREE.InstancedBufferAttribute(artScalars, 4));

  const uniforms = {
    uViewport: { value: new THREE.Vector2(1, 1) },
    uPxRatio: { value: 1 },
    uTime: { value: 0 },
    uFlow: { value: 1 },
    uStory: { value: 0 },
    // Art style: 0 Galaxy | 1 Ringers | 2 Fidenza. uField is the active paper
    // color the damage-fade lerps toward (unused in the galaxy branch).
    uArtStyle: { value: 0 },
    // Eased pose value 0..3 (driver-fed each frame). Only >2 changes anything —
    // the whole metro treatment is gated on m3 = clamp(uPose-2,0,1), so poses
    // 0–2 render byte-identically to the shipped look.
    uPose: { value: 0 },
    uField: { value: new THREE.Color(RINGERS.bg) },
    // Light-environment amount 0..1 (Ascent dawn OR Transit daylight). Drives the
    // VIVID enamel repaint (both windows) and the Transit city-background dissolve
    // toward mix(#0a0a16, #beb9b0, uEnvLight).
    uEnvLight: { value: 0 },
    // VIVID enamel palette (LINEAR), index-aligned number/algebra/geometry/data.
    uVivid: { value: vividVecs },
    // Hanga pigments (LINEAR) and key-block ink for the active field; written
    // by setArtStyle for styles 3 and 4, unread elsewhere.
    uHanga: { value: hangaVecs },
    uHangaSumi: { value: new THREE.Color(0x000000) },
    uHangaDmgDark: { value: 0 },
    // Opener per-edge crystallization. uOpenerClock = ms since the opener started
    // (−1 = inactive ⇒ every ribbon fully present, byte-identical); uEdgeFadeMs =
    // each ribbon's ghost-in length. Appear-times ride in aColorA.w.
    uOpenerClock: { value: -1 },
    uEdgeFadeMs: { value: 1 },
  };

  // RawShaderMaterial (not ShaderMaterial): it injects no built-in attributes,
  // so the vertex program declares only the 16 attributes it actually uses (the
  // round-12 aStrand brings it to exactly WebGL2's guaranteed MAX_VERTEX_ATTRIBS
  // floor of 16). ShaderMaterial's auto position/normal/uv would put the count at
  // 19 and the link fails on 16-attribute GPUs ("Too many attributes"). The galaxy
  // shader math is unchanged off the light environments, so its output stays
  // byte-identical there.
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const scratchColor = new THREE.Color();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = "edges";
  mesh.renderOrder = -1; // draw before other transparents (stars, etches)

  return {
    mesh,
    count,
    emphasisAttr,
    visibleAttr,
    damageAttr,
    startAttr,
    ctrlAttr,
    endAttr,
    setDamage(values) {
      if (values === null) {
        damage.fill(0);
      } else {
        damage.set(values);
      }
      damageAttr.needsUpdate = true;
    },
    setStory(amount) {
      uniforms.uStory.value = amount;
    },
    setVisibleMask(mask) {
      if (mask === null) {
        visible.fill(1);
      } else {
        visible.set(mask);
      }
      visibleAttr.needsUpdate = true;
    },
    setTime(t) {
      uniforms.uTime.value = t;
    },
    setFlowEnabled(on) {
      uniforms.uFlow.value = on ? 1 : 0;
    },
    setPose(p) {
      uniforms.uPose.value = p;
    },
    setOpenerClock(ms) {
      uniforms.uOpenerClock.value = ms;
    },
    setOpenerAppearTimes(times, fadeMs) {
      if (times === null) {
        for (let i = 0; i < count; i++) colorA[i * 4 + 3] = 0;
      } else {
        for (let i = 0; i < count; i++) colorA[i * 4 + 3] = times[i];
        if (fadeMs !== undefined) uniforms.uEdgeFadeMs.value = fadeMs;
      }
      colorAAttr.needsUpdate = true;
    },
    setEnvLight(amount) {
      uniforms.uEnvLight.value = amount;
      // Enamel compositing: in a light environment (dawn or daylight) the ribbons
      // must PAINT (normal alpha blend) rather than GLOW (additive), or the vivid
      // strands wash to cream on the bright field. Flip the Galaxy material at the
      // window midpoint; the fragment lerps the enamel repaint by uEnvLight so
      // uEnvLight 0 stays additive + byte-identical (poses 0/2, dark-baseline
      // Transit). Only the Galaxy path is touched — the paper styles set their own
      // blending in setArtStyle and never raise env-light (environs zeroes it
      // off-Galaxy). Blending applies at draw time, so no material.needsUpdate.
      if (uniforms.uArtStyle.value < 0.5) {
        const target = amount > 0.5 ? THREE.NormalBlending : THREE.AdditiveBlending;
        if (material.blending !== target) material.blending = target;
      }
    },
    setViewport(widthPx, heightPx, pixelRatio) {
      uniforms.uViewport.value.set(widthPx, heightPx);
      uniforms.uPxRatio.value = pixelRatio;
    },
    setArtStyle(style) {
      // One program, branched by uArtStyle. Galaxy reads as additive light on
      // black; the paper styles switch to normal alpha blending (opacity IS the
      // dimness — additive would just brighten the field). Blending + uniform
      // changes need no material.needsUpdate.
      uniforms.uArtStyle.value = style;
      material.blending = style === 0 ? THREE.AdditiveBlending : THREE.NormalBlending;
      if (isHanga(style)) {
        // Washi or Dusk: the field color the damage wash lerps toward, the four
        // strand pigments, and the key-block ink, all LINEAR.
        const pal = hangaPalette(style);
        uniforms.uField.value.setHex(pal.bg);
        uniforms.uHangaSumi.value.setHex(pal.sumi);
        uniforms.uHangaDmgDark.value = style === 4 ? 1 : 0;
        STRAND_ORDER.forEach((sid, i) => {
          const cc = scratchColor.setHex(pal.pigment[sid]);
          hangaVecs[i].set(cc.r, cc.g, cc.b);
        });
      } else {
        uniforms.uField.value.setHex(style === 1 ? RINGERS.bg : FIDENZA.bg);
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
