// All 480 standards as ONE InstancedMesh (low-poly icosphere), plus an
// invisible raycast-proxy InstancedMesh used only for picking.
//
// Per-instance state:
//   instanceColor — base strand color (never changes)
//   aEmphasis     — 0 dimmed | 1 rest | 2 hover | 3 focus | 4 chain | 5 related
//   aPhase        — shimmer phase, seeded from instance index
//
// The MeshBasicMaterial is patched via onBeforeCompile: emphasis drives an HDR
// color multiplier + per-instance scale (DESIGN.md node-states table), with a
// ~6s ×1.05–1.15 brightness shimmer from a uTime uniform. Fractional emphasis
// values blend piecewise-linearly between adjacent states, which is what lets
// the state machine ease hover in/out over ~150ms on the CPU side.

import * as THREE from "three";
import type { GraphNode } from "../data";
import { EMPHASIS, STRAND_COLORS, STRAND_VIVID, restRadius } from "./palette";
import { RINGERS, FIDENZA, artHash, isHanga, hangaPalette, HANGA_DISC_SCALE, HANGA_DUSK_DAMAGE } from "./artstyle";
import { STRAND_ORDER } from "./palette";

const DIM_TARGET = 0x0a0a18; // dimmed nodes lerp toward this (factor 0.82)
const PROXY_RADIUS_FACTOR = 2.5; // pick radius vs. visual radius
const TOUCH_EXTRA_FACTOR = 2.0; // additional proxy scale for touch pointers (fleet: taps still felt smaller than the dots look)

// Per-state tables, indexed by EMPHASIS value: [colorMul, scale, dimMix]
// dimMix is the lerp factor toward DIM_TARGET (0.82 when fully dimmed).
const STATE_TABLE = [
  /* dimmed  */ { mul: 1.0, scale: 0.8, dim: 0.82 },
  /* rest    */ { mul: 1.0, scale: 1.0, dim: 0.0 },
  /* hover   */ { mul: 1.6, scale: 1.25, dim: 0.0 },
  /* focus   */ { mul: 2.6, scale: 1.5, dim: 0.0 },
  /* chain   */ { mul: 1.9, scale: 1.15, dim: 0.0 },
  /* related */ { mul: 1.25, scale: 1.0, dim: 0.0 },
];

const glslTable = (key: "mul" | "scale" | "dim"): string =>
  STATE_TABLE.map((s) => s[key].toFixed(4)).join(", ");

// ---------------------------------------------------------------------------
// Struggle breath (galaxy orbs, stories).
//
// A partly-damaged standard breathes: one slow sine per node, a full cycle every
// STRUGGLE_PERIOD_SEC (below 0.3 Hz), with a per-node phase so the lit set never
// pulses in unison. Mark (round 14): a slow breath, not a flicker. The old cue
// summed two fast sines (1.07 Hz + 1.8 Hz) into an "irregular" waver of up to
// 16%, which read as the flicker he objected to.
//
// The breath SWING reads the RAW engine damage, not the display value. Stories
// floor the display copy (contagion.ts displayDamage: 0.35 + 0.65·raw;
// lose-a-year clamps anything under 0.35 up to 0.35) so a lightly-exposed
// standard is unmistakably dimmer. Fed that floored value, 4·d·(1−d) sat at 91%
// of its peak for every touched standard. The swing is STRUGGLE_SWING peak to
// peak (relative to the node's mean) at raw 0.5, scaled by 4·r·(1−r), so a raw
// 0.02 standard barely moves.
//
// The time-mean brightness is the shipped value exactly: the mean dip
// (STRUGGLE_DEPTH/2 · 4·d·(1−d), on the display value) is kept, and the breath
// multiplies it by a zero-mean sine. The dimming, desaturation, and husk mix
// keep the floored value. A steady husk (display ≥ HUSK_STEADY_AT) never
// breathes. The GLSL below is generated from these constants, and
// tests/struggle.test.ts pins the mirrors.
export const HUSK_STEADY_AT = 0.95;
/** The shipped flicker depth. Its half is the mean dip every node keeps. */
export const STRUGGLE_DEPTH = 0.16;
/** Breath swing, peak to peak relative to the node's mean, at raw damage 0.5. */
export const STRUGGLE_SWING = 0.03;
/** One breath, in seconds (4.5 s = 0.22 Hz, under the 0.3 Hz ceiling). */
export const STRUGGLE_PERIOD_SEC = 4.5;
/** Per-node phase scatter (times aPhase), so neighbours never breathe together. */
const STRUGGLE_PHASE_MUL = 3.1;

// Ember pulse (true husks only). The husk ember pulses slowly (2.5 s, 0.4 Hz)
// so the eye can find a fully-missed standard on a dark field. A partly-damaged
// standard mixes toward the ember too (weight d), and it used to inherit that
// pulse: a 4-7% swing at 0.4 Hz, over both bounds of the breath rule (under
// 0.3 Hz, near 3%). The pulse now fades in only across the steady-husk band,
// from HUSK_STEADY_AT to EMBER_PULSE_FULL display damage (smooth, so a lapse
// crossfade never steps). Below it the ember sits at its time-mean color, the
// midpoint of the pulse, so the time-mean brightness is unchanged. A missed
// standard (display 1) pulses exactly as before.
/** Display damage at which the husk ember pulse reaches full strength. */
export const EMBER_PULSE_FULL = 0.99;
const EMBER_PULSE_RAD_PER_SEC = 2.5132741; // 2π / 2.5 s, the shipped husk pulse

/** How much of the ember pulse a node shows, 0..1 (TS mirror of the orb shader). */
export function emberPulseGate(display: number): number {
  const x = (display - HUSK_STEADY_AT) / (EMBER_PULSE_FULL - HUSK_STEADY_AT);
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return c * c * (3 - 2 * c);
}

/** The ember mix position 0..1 (0 = emberLo, 1 = emberHi) at scene time `t`. */
export function emberPulse(t: number, phase: number, display: number): number {
  return 0.5 + 0.5 * emberPulseGate(display) * Math.sin(t * EMBER_PULSE_RAD_PER_SEC + phase);
}

const struggleCurve = (x: number): number => {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return 4 * c * (1 - c);
};

/** Struggle amplitude 0..1 for a node: 4·r·(1−r) of the raw damage, 0 for a steady husk. */
export function struggleAmplitude(raw: number, display: number): number {
  return display >= HUSK_STEADY_AT ? 0 : struggleCurve(raw);
}

/** The breath sine (−1..1) at scene time `t` for a node with shimmer phase `phase`. */
export function struggleBreath(t: number, phase: number): number {
  return Math.sin((t * 2 * Math.PI) / STRUGGLE_PERIOD_SEC + phase * STRUGGLE_PHASE_MUL);
}

/**
 * The struggle brightness multiplier at breath value `breath` ∈ [−1, 1] (TS
 * mirror of the orb shader). Mean over a breath: 1 − DEPTH/2 · 4d(1−d), the
 * shipped mean. Swing, peak to peak over the mean: SWING · struggleAmplitude.
 */
export function struggleFlickMul(raw: number, display: number, breath: number): number {
  const dip = display >= HUSK_STEADY_AT ? 0 : struggleCurve(display);
  const mean = 1 - (STRUGGLE_DEPTH / 2) * dip;
  return mean * (1 - (STRUGGLE_SWING / 2) * struggleAmplitude(raw, display) * breath);
}

const glf = (x: number): string => x.toFixed(4);

/** Mix two sRGB hex colors per channel (the preview's mixHex), rounded. */
export function mixSrgbHex(a: number, b: number, t: number): number {
  const ch = (h: number, sh: number): number => (h >> sh) & 255;
  const m = (sh: number): number => Math.round(ch(a, sh) + (ch(b, sh) - ch(a, sh)) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}

// ---------------------------------------------------------------------------
// Art-style node materials (Ringers pegs / outline, Fidenza pipes).
//
// All three share the galaxy's MeshBasicMaterial + onBeforeCompile skeleton but
// swap the shading model for Mark's paper grammar:
//   - FLAT fill (no limb darkening, no key light, no shimmer, no HDR multiply).
//   - Base color from a per-instance art attribute (aArtRing / aArtFid) or a
//     flat uniform (the outline ink), IGNORING instanceColor.
//   - Dimness is OPACITY, never brightness. The emphasis SCALE table still
//     drives size (so hover/focus/chain read exactly as in the galaxy), but
//     ghosted / dimmed / damaged instances lose alpha and (on damage) fade
//     toward the field color. Emphasis brightening is gone — there is no bloom
//     on paper.
// The shared alpha law:
//   alpha = (1 − 0.92·(1−aVisible)) · (1 − 0.7·dimT) · (1 − 0.55·damage)
// where dimT is the emphasis-only dim from the galaxy dim table.
// ---------------------------------------------------------------------------
// Hanga node skin (styles 3 Washi and 4 Dusk): a printed pigment disc.
//
// The disc is a sphere with a FLAT pigment fill and a soft bokashi fade inside
// it, read in view space so it holds from any orbit: a deeper ink of the same
// hue at the top of the disc, a lighter wash at the bottom (the preview's
// 0.08 / 0.45 / 1.0 stops). The sumi key-block line is the shared inverted-hull
// outline mesh, grown by a constant screen width and cut to a ring in the
// fragment, so it never depends on draw order. An edgeless standard is a bare
// paper disc (on Dusk, a faint hollow disc).
//
// The story grammar is opacity and weight, never brightness:
//   lit        full pigment, full outline weight; the story lift prints the
//              disc a touch larger with a heavier line
//   unlit      faint sumi underdrawing (disc HANGA_NODE.UNDER_ALPHA)
//   damage     the pigment washes toward the field and loses opacity; a husk
//              is a pale stain with a thin line. The struggle breath keeps the
//              Galaxy period and swing (STRUGGLE_PERIOD_SEC, STRUGGLE_SWING) on
//              the RAW damage, as opacity.
export const HANGA_NODE = {
  /** Disc opacity in the underdrawing (unlit or focus-dimmed). */
  UNDER_ALPHA: 0.12,
  /** Outline opacity in the underdrawing. */
  UNDER_OUTLINE_ALPHA: 0.2,
  /** Key-block line width in CSS px at rest, and its gain when lit or lifted. */
  OUTLINE_PX: 1.15,
  OUTLINE_LIT_GAIN: 0.25,
  OUTLINE_LIFT_GAIN: 0.45,
  /** Story lift: healthy lit discs print this much larger. */
  LIFT_SCALE: 0.12,
  /** Damage: how far the pigment washes toward the field, and the opacity it sheds. */
  WASH: 0.72,
  WASH_ALPHA: 0.45,
  /** A husk's line thins to this fraction of the rest width. */
  HUSK_OUTLINE: 0.6,
} as const;

/** Shared uniform objects for the two Hanga node materials (disc + outline). */
interface HangaNodeUniforms {
  /** Fill, deep (disc top), and light (disc bottom) tones, LINEAR, 4 strands + bare paper. */
  uHFill: { value: THREE.Vector3[] };
  uHDeep: { value: THREE.Vector3[] };
  uHLight: { value: THREE.Vector3[] };
  uHSumi: { value: THREE.Color };
  /** Bare-disc fill opacity, and the bare-disc outline opacity. */
  uHBareA: { value: number };
  uHBareOutlineA: { value: number };
  /** 1 on Dusk: damage darkens and desaturates (HANGA_DUSK_DAMAGE); 0 on Washi. */
  uHDmgDark: { value: number };
  /** Drawing-buffer size (device px) and device px per CSS px. */
  uHViewW: { value: number };
  uHViewH: { value: number };
  uHPxRatio: { value: number };
  uStoryLift: { value: number };
  uTime: { value: number };
}

interface ArtNodeMatOpts {
  /** Flat fill color: a per-instance vec3 attribute, or a flat ink uniform. */
  colorSource: { kind: "attr"; name: string } | { kind: "uniform" };
  /** Field color the damage-fade lerps toward (auto sRGB→linear). */
  uField: { value: THREE.Color };
  /** Flat color uniform (outline ink) — required when colorSource is uniform. */
  uColor?: { value: THREE.Color };
  /**
   * Fidenza PIPE mode (round 7): tilt the z-aligned cylinder off-axis by aTwist
   * (rotate the vertex about x by aTwist, about y by aTwist*0.7 — a z-spin of a
   * z-aligned cylinder is invisible) and add a subtle cylindrical rounding cue
   * in the fragment so the pipe reads round. Off for the flat Ringers pegs.
   */
  pipe: boolean;
  /** Distinct program cache key so patched programs never collide. */
  cacheKey: string;
  /**
   * Hanga skin (styles 3 and 4). When set, the shared emphasis-scale and
   * pose-fade skeleton is kept, and the flat fill + alpha law are replaced by
   * the woodblock disc (role "disc") or the sumi key-block ring (role "outline").
   */
  hanga?: { role: "disc" | "outline"; uniforms: HangaNodeUniforms };
  /**
   * Pose-3 station handoff (0 normal … 1 fully stationed). At Transit the galaxy
   * node sprites cede to the station marks (scene/stations.ts): the peg shrinks
   * to nothing as the station fades in. Shared across skins so the crossfade
   * reads the same in every art style; gated at 0 so poses 0–2 are unchanged.
   */
  uPoseFade: THREE.IUniform<number>;
}

function patchArtNodeMaterial(material: THREE.MeshBasicMaterial, opts: ArtNodeMatOpts): void {
  const colorAttrDecl =
    opts.colorSource.kind === "attr" ? `attribute vec3 ${opts.colorSource.name};` : "";
  const colorUniformDecl = opts.colorSource.kind === "uniform" ? "uniform vec3 uArtColor;" : "";
  const colorAssign =
    opts.colorSource.kind === "attr" ? `vArtColor = ${opts.colorSource.name};` : "vArtColor = uArtColor;";
  const twistDecl = opts.pipe ? "attribute float aTwist;" : "";
  // PIPE tilt (round 7): the Fidenza node is a z-aligned cylinder. A z-rotation
  // would be invisible, so aTwist becomes a small off-axis TILT — rotate the
  // vertex about x by aTwist and about y by aTwist*0.7 — scattering the pipes
  // organically. The normal rides the same rotation so the cylindrical rounding
  // term in the fragment tracks the tilted silhouette.
  const twistApply = opts.pipe
    ? /* glsl */ `{
          float ax = aTwist;
          float ay = aTwist * 0.7;
          float cx = cos(ax); float sx = sin(ax);
          float cy = cos(ay); float sy = sin(ay);
          vec3 pp = transformed;
          pp = vec3(pp.x, cx * pp.y - sx * pp.z, sx * pp.y + cx * pp.z); // Rx
          pp = vec3(cy * pp.x + sy * pp.z, pp.y, -sy * pp.x + cy * pp.z); // Ry
          transformed = pp;
          vec3 nn = normal;
          nn = vec3(nn.x, cx * nn.y - sx * nn.z, sx * nn.y + cx * nn.z);
          nn = vec3(cy * nn.x + sy * nn.z, nn.y, -sy * nn.x + cy * nn.z);
          vPipeNrm = normalize(normalMatrix * nn);
          vec4 pipeMv = modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
          vPipeView = -pipeMv.xyz;
        }`
    : "";
  const pipeVarying = opts.pipe ? "varying vec3 vPipeNrm; varying vec3 vPipeView;" : "";

  // Hanga snippets (empty strings for Ringers / Fidenza, so their programs are
  // unchanged). See HANGA_NODE above for the grammar.
  const hg = opts.hanga;
  const isRing = hg?.role === "outline";
  const hangaVertDecl = hg
    ? /* glsl */ `
        attribute float aHangaIdx;
        attribute float aDamageRaw;
        attribute float aPhase;
        uniform float uStoryLift;
        uniform float uHViewW;
        uniform float uHViewH;
        uniform float uHPxRatio;
        varying float vHIdx;
        varying float vHLift;
        varying float vHLit;
        varying float vDamageRaw;
        varying float vPhase;
        varying vec2 vHCenter;
        varying float vHRpx;
        varying float vHOlPx;`
    : "";
  // Story lift: a healthy lit disc prints a touch larger (never brighter).
  const hangaVertScale = hg
    ? /* glsl */ `
          vHLift = clamp((uStoryLift - 1.0) / 0.9, 0.0, 1.0)
            * (1.0 - clamp(aDamage * 3.0, 0.0, 1.0)) * clamp(aVisible, 0.0, 1.0);
          vHLit = clamp(e - 1.0, 0.0, 1.0);
          scl *= ${glf(HANGA_DISC_SCALE)} * (1.0 + ${glf(HANGA_NODE.LIFT_SCALE)} * vHLift);
          vHIdx = aHangaIdx;
          vDamageRaw = clamp(aDamageRaw, 0.0, 1.0);
          vPhase = aPhase;`
    : "";
  // Screen-space sizing: the disc's projected radius (device px) and, for the
  // ring, a hull grown by a constant line width so the key block reads the
  // same at every zoom. The ring collapses with the disc under uPoseFade.
  const hangaVertAfter = hg
    ? /* glsl */ `
          {
            vec4 mvC = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            float wScale = length(instanceMatrix[0].xyz);
            float pxPerUnit = wScale * projectionMatrix[1][1] * uHViewH * 0.5 / max(-mvC.z, 1e-3);
            vHRpx = scl * pxPerUnit;
            float d = clamp(aDamage, 0.0, 1.0);
            float ol = ${glf(HANGA_NODE.OUTLINE_PX)} * uHPxRatio
              * (1.0 + ${glf(HANGA_NODE.OUTLINE_LIT_GAIN)} * vHLit + ${glf(HANGA_NODE.OUTLINE_LIFT_GAIN)} * vHLift)
              * mix(1.0, ${glf(HANGA_NODE.HUSK_OUTLINE)}, smoothstep(0.5, 1.0, d))
              * (1.0 - uPoseFade);
            vHOlPx = ol;
            // The hull reaches one px past the line so its outer edge can feather.
            ${isRing ? "transformed = normalize(position) * (scl + (ol + 1.0) / max(pxPerUnit, 1e-4));" : ""}
            // The disc centre in drawing-buffer px: the fragment measures its
            // screen distance from here, so the disc edge, the ring, and the
            // bokashi are exact circles at any zoom.
            vec4 cC = projectionMatrix * mvC;
            vHCenter = (cC.xy / max(cC.w, 1e-6) * 0.5 + 0.5) * vec2(uHViewW, uHViewH);
          }`
    : "";
  const hangaFragDecl = hg
    ? /* glsl */ `
        uniform vec3 uHFill[5];
        uniform vec3 uHDeep[5];
        uniform vec3 uHLight[5];
        uniform vec3 uHSumi;
        uniform float uHBareA;
        uniform float uHBareOutlineA;
        uniform float uHDmgDark;
        uniform float uTime;
        varying float vHIdx;
        varying float vHLift;
        varying float vHLit;
        varying float vDamageRaw;
        varying float vPhase;
        varying vec2 vHCenter;
        varying float vHRpx;
        varying float vHOlPx;`
    : "";
  // Shared Hanga opacity terms: the underdrawing amount and the struggle breath
  // (struggleFlickMul in TS, applied to opacity). A steady husk never breathes.
  const hangaShared = /* glsl */ `
        int hIdx = int(vHIdx + 0.5);
        float under = clamp(max(1.0 - vVisible, vDimE / 0.82), 0.0, 1.0);
        float d = vDamage;
        float huskCut = 1.0 - step(${HUSK_STEADY_AT.toFixed(4)}, d);
        float r = vDamageRaw;
        float struggle = 4.0 * r * (1.0 - r) * huskCut;
        float struggleDip = 4.0 * d * (1.0 - d) * huskCut;
        float breath = sin(uTime * ${glf((2 * Math.PI) / STRUGGLE_PERIOD_SEC)} + vPhase * ${glf(STRUGGLE_PHASE_MUL)});
        float flickMul = (1.0 - ${glf(STRUGGLE_DEPTH / 2)} * struggleDip)
                       * (1.0 - ${glf(STRUGGLE_SWING / 2)} * struggle * breath);`;
  const hangaFragBody = !hg
    ? ""
    : isRing
      ? /* glsl */ `
        #include <color_fragment>
        ${hangaShared}
        // Sumi key-block ring: keep only the band between the disc's projected
        // radius and the line width past it, so the hull never paints over the
        // disc whatever the draw order. rho is the screen distance (device px)
        // from the disc centre; both edges feather over one px.
        float rho = distance(gl_FragCoord.xy, vHCenter);
        float band = smoothstep(vHRpx - 0.5, vHRpx + 0.5, rho)
                   * (1.0 - smoothstep(vHRpx + vHOlPx - 0.5, vHRpx + vHOlPx + 0.5, rho));
        if (band < 0.002) discard;
        float lineA = hIdx == 4 ? uHBareOutlineA : 1.0;
        float a = mix(lineA, ${glf(HANGA_NODE.UNDER_OUTLINE_ALPHA)}, under);
        a *= 1.0 - 0.3 * d;
        vec3 lineCol = uHSumi;
        if (uHDmgDark > 0.5) {
          // Dusk: the pale key-block line of a damaged disc dims toward the field.
          float kd = smoothstep(0.0, ${glf(HANGA_DUSK_DAMAGE.RAMP)}, d);
          lineCol = mix(lineCol, uField, ${glf(HANGA_DUSK_DAMAGE.LINE_DIM)} * kd);
        }
        diffuseColor.rgb = lineCol;
        diffuseColor.a *= a * band * flickMul;
        `
      : /* glsl */ `
        #include <color_fragment>
        ${hangaShared}
        // Bokashi inside the disc, in screen space (holds through any orbit):
        // o = 0 at the top of the disc, 1 at the bottom. Deep ink to 0.08,
        // the pigment at 0.45, the light wash at 1.0 (the preview's stops).
        float rho = distance(gl_FragCoord.xy, vHCenter);
        float yRel = (gl_FragCoord.y - vHCenter.y) / max(vHRpx, 1e-3);
        float o = 0.5 - 0.5 * clamp(yRel, -1.0, 1.0);
        vec3 base = uHFill[hIdx];
        vec3 col = o < 0.45
          ? mix(uHDeep[hIdx], base, clamp((o - 0.08) / 0.37, 0.0, 1.0))
          : mix(base, uHLight[hIdx], clamp((o - 0.45) / 0.55, 0.0, 1.0));
        float a = hIdx == 4 ? uHBareA : 1.0;
        // Unlit: faint sumi underdrawing.
        col = mix(col, uHSumi, under);
        a = mix(a, ${glf(HANGA_NODE.UNDER_ALPHA)}, under);
        if (uHDmgDark > 0.5) {
          // Dusk: drain the colour and the light first, then a light wash, so a
          // damaged disc reads clearly darker than a lit one (see HANGA_DUSK_DAMAGE).
          float kd = smoothstep(0.0, ${glf(HANGA_DUSK_DAMAGE.RAMP)}, d);
          float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(col, vec3(lum), ${glf(HANGA_DUSK_DAMAGE.DESAT)} * kd);
          col *= mix(1.0, ${glf(HANGA_DUSK_DAMAGE.DARKEN)}, kd);
          col = mix(col, uField, ${glf(HANGA_DUSK_DAMAGE.WASH)} * d);
          a *= 1.0 - ${glf(HANGA_DUSK_DAMAGE.ALPHA)} * d;
        } else {
          // Washi: wash toward the field, shed opacity (a husk is a pale stain).
          col = mix(col, uField, ${glf(HANGA_NODE.WASH)} * d);
          a *= 1.0 - ${glf(HANGA_NODE.WASH_ALPHA)} * d;
        }
        // A clean circular edge, feathered over one px.
        a *= 1.0 - smoothstep(vHRpx - 0.5, vHRpx + 0.5, rho);
        diffuseColor.rgb = col;
        diffuseColor.a *= a * flickMul;
        `;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uField = opts.uField;
    shader.uniforms.uPoseFade = opts.uPoseFade;
    if (opts.uColor) shader.uniforms.uArtColor = opts.uColor;
    if (hg) Object.assign(shader.uniforms, hg.uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        attribute float aEmphasis;
        attribute float aVisible;
        attribute float aDamage;
        uniform float uPoseFade;
        ${colorAttrDecl}
        ${colorUniformDecl}
        ${twistDecl}
        varying vec3 vArtColor;
        varying float vVisible;
        varying float vDimE;
        varying float vDamage;
        ${pipeVarying}
        ${hangaVertDecl}
        `,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        {
          // Emphasis SCALE — the exact galaxy size table (hover/focus/chain read
          // identically). Dimness is opacity, so the galaxy's aVisible SHRINK is
          // dropped: ghosted pegs stay full-size and simply go near-transparent.
          float sclTab[6] = float[](${glslTable("scale")});
          float dimTab[6] = float[](${glslTable("dim")});
          float e = clamp(aEmphasis, 0.0, 5.0);
          int i0 = int(floor(e));
          int i1 = int(min(floor(e) + 1.0, 5.0));
          float f = fract(e);
          float scl = mix(sclTab[i0], sclTab[i1], f);
          // Transit station handoff: collapse the peg to nothing as the station
          // mark takes over (uPoseFade 0→1). At 0 this is a no-op (× 1.0).
          scl *= mix(1.0, 0.001, uPoseFade);
          vDimE = mix(dimTab[i0], dimTab[i1], f);
          vVisible = aVisible;
          vDamage = clamp(aDamage, 0.0, 1.0);
          ${colorAssign}
          ${hangaVertScale}
          transformed *= scl;
          ${twistApply}
          ${hangaVertAfter}
        }
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform vec3 uField;
        varying vec3 vArtColor;
        varying float vVisible;
        varying float vDimE;
        varying float vDamage;
        ${pipeVarying}
        ${hangaFragDecl}
        `,
      )
      .replace(
        "#include <color_fragment>",
        opts.hanga
          ? hangaFragBody
          : /* glsl */ `
        #include <color_fragment>
        // Flat fill — overwrite whatever instanceColor produced with the art
        // color, fading toward the field as damage rises (dissolve into paper).
        vec3 col = mix(vArtColor, uField, clamp(vDamage, 0.0, 1.0));
        diffuseColor.rgb = col;
        ${
          opts.pipe
            ? /* glsl */ `
        // Cylindrical rounding cue (round 7) — NOT a lighting model: darken
        // toward the silhouette so the pipe reads round, never lit. Facing
        // ratio only (bright where the normal faces the camera), capped at 15%
        // so the flat paper fill and palette hue stay dominant.
        {
          vec3 pn = normalize(vPipeNrm);
          vec3 pv = normalize(vPipeView);
          float facing = abs(dot(pn, pv));
          diffuseColor.rgb *= (1.0 - 0.15 * (1.0 - facing));
        }`
            : ""
        }
        // Opacity-only dimness: ghosted (aVisible→0), emphasis-dimmed, and
        // damaged instances lose alpha; nothing ever brightens.
        float artAlpha = (1.0 - 0.92 * (1.0 - vVisible)) * (1.0 - 0.7 * vDimE) * (1.0 - 0.55 * vDamage);
        diffuseColor.a *= artAlpha;
        `,
      );
  };
  // Distinct cache key so this patched program never collides with the galaxy
  // orb program or the other art materials.
  material.customProgramCacheKey = () => opts.cacheKey;
}

export interface NodesHandle {
  /** The single visible instanced mesh (1 draw call). */
  mesh: THREE.InstancedMesh;
  /** Invisible picking proxy — never rendered; raycast against it directly. */
  proxy: THREE.InstancedMesh;
  count: number;
  /** Target emphasis attribute; write via the state machine only. */
  emphasisAttr: THREE.InstancedBufferAttribute;
  /** Filter-visibility attribute (1 shown / 0 ghosted); write via filters only. */
  visibleAttr: THREE.InstancedBufferAttribute;
  /** Per-node structural damage 0..1 (stories); write via setDamage only. */
  damageAttr: THREE.InstancedBufferAttribute;
  /**
   * Per-node RAW engine damage 0..1 (stories), the un-floored twin of
   * damageAttr. It drives only the struggle flicker amplitude. Write via
   * setDamage only.
   */
  damageRawAttr: THREE.InstancedBufferAttribute;
  /** True unless this instance is filtered out (picking consults this). */
  isVisible(index: number): boolean;
  /**
   * Set per-node damage (0..1). null clears every node to 0 in one memset.
   * Damage composes AFTER emphasis in the shader (a chain-lit but damaged node
   * keeps its emphasis SIZE and takes the damage COLOR), and stays sub-1.0 HDR
   * so the ember/flicker never blooms — bloom is reserved for healthy emphasis.
   * `values` is the DISPLAY damage (dimming, desaturation, husk mix). `raw` is
   * the engine damage before any display floor, and it drives the struggle
   * flicker amplitude only. Omit `raw` and the flicker reads `values`.
   */
  setDamage(values: Float32Array | null, raw?: Float32Array | null): void;
  /**
   * Story-only visibility override: ghost every node NOT in the mask (fractional
   * values allowed, so callers can crossfade). null restores full visibility.
   * Bypasses the filters UI entirely; the filters recompute reclaims the buffer
   * on story exit.
   */
  setVisibleMask(mask: Float32Array | null): void;
  /**
   * Overwrite instance i's world position (keeps its base radius). Updates
   * BOTH the visible mesh and the pick proxy instance matrices in place — the
   * pose driver drives this every morph frame, which is why raycast picking
   * keeps landing on the moving dots. Batched: flip commitPositions() once per
   * frame after a run of setInstancePosition calls.
   */
  setInstancePosition(index: number, x: number, y: number, z: number): void;
  /**
   * Flag both instance-matrix buffers dirty. Cheap enough for every morph
   * frame — the proxy pick bounds are NOT refreshed here (that walk over all
   * instances is the expensive part and mid-morph picking doesn't matter);
   * call refreshPickBounds() once when a morph lands.
   */
  commitPositions(): void;
  /** Recompute the pick proxy's bounding sphere (call when a morph settles). */
  refreshPickBounds(): void;
  /** Read instance i's current world position (for pose-correct camera framing). */
  getPosition(index: number, out: THREE.Vector3): THREE.Vector3;
  /** Advance the shimmer clock (seconds). */
  setTime(t: number): void;
  /** Toggle the idle brightness shimmer (off under reduced motion). */
  setShimmerEnabled(on: boolean): void;
  /** Story-mode luminance lift for undamaged nodes (1 = off; ~1.9 = shine). */
  setStoryLift(mul: number): void;
  /**
   * Per-pose orb handoff (0 normal … 1 fully collapsed). Shrinks the node
   * sprites to nothing while a drafted / stationed grammar owns the pose — the
   * caller passes the UNION of both handoff windows: the drafted rings
   * (scene/drafts.ts) over pose 1.6→2.0→2.4 and the Transit stations
   * (scene/stations.ts) over pose 2.6→3.0. Applies in every art skin. 0 leaves
   * poses 0/1 (and the 2.4→2.6 gap between the two windows) untouched.
   */
  setOrbFade(amount: number): void;
  /**
   * Light-environment amount (0 normal … 1 full light) — max(dawn, daylight), the
   * SAME amount the edges get (main.ts passes environs.envLight01()). Orb (Galaxy)
   * material only. Against a light field the sphere-shaded bead washes out, so past
   * the window the orb becomes a SOLID VIVID DISC: full alpha, the full-saturation
   * STRAND_VIVID hue (aVivid), grown ×1.15 — enamel signage, exactly like the edge
   * repaint. 0 everywhere but the settled Ascent dawn and (transitionally) the
   * Transit daylight ramp; the paper skins never see it. NOTE: at the settled
   * Transit (pose 3) the orbs have already collapsed to nothing under the station
   * handoff (uPoseFade → 1), so the disc is only meaningfully visible at the dawn.
   */
  setEnvLight(amount: number): void;
  /** Grow the proxy pick radius for touch pointers (idempotent). */
  setTouchPicking(on: boolean): void;
  /**
   * Drawing-buffer size (device px) and device px per CSS px. The Hanga disc
   * edge, key-block line, and bokashi are measured in screen px, so they need
   * these. Call on resize; unused by the other skins.
   */
  setViewport(widthPx: number, heightPx: number, pixelRatio: number): void;
  /**
   * Swap the render skin: 0 Galaxy (orbs, exactly the shipped look) |
   * 1 Ringers (bold-outlined pegs on cream) | 2 Fidenza (palette pipes on
   * teal) | 3 Washi and 4 Dusk (woodblock pigment discs with a sumi
   * key-block ring). Geometry/material swap only: instanced attributes, positions,
   * picking, and every driver keep working identically across styles.
   */
  setArtStyle(style: number): void;
  /** Bounding sphere of the whole node cloud (for camera framing). */
  boundsSphere: THREE.Sphere;
  /** Axis-aligned bounds of the cloud (tighter framing than the sphere). */
  boundsBox: THREE.Box3;
  dispose(): void;
}

// `radii` is the per-node visual rest radius (scene/reach.ts: restRadius by
// degree, scaled by descendant reach — the load-bearing gradient). Every
// radius consumer (visible matrix, pick proxy) reads from it.
export function createNodes(nodes: GraphNode[], radii: Float32Array): NodesHandle {
  const count = nodes.length;

  // -- visible mesh -----------------------------------------------------
  // Detail 2 (320 tris): the limb-darkening shading below exposes the
  // silhouette, so detail 1's faceting would read as polygons, not orbs.
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });

  const emphasis = new Float32Array(count).fill(EMPHASIS.REST);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // Deterministic per-instance phase seeded from index (golden-angle scatter).
    phase[i] = (i * 2.399963) % (Math.PI * 2);
  }
  // Filter visibility: 1 = shown, 0 = filtered out (ghosted, not hit-tested).
  const visible = new Float32Array(count).fill(1);
  // Structural damage 0..1 (stories); 0 = untouched, 1 = ember husk.
  const damage = new Float32Array(count); // all 0 at rest
  // The raw engine damage behind it (no display floor): struggle amplitude only.
  const damageRaw = new Float32Array(count); // all 0 at rest
  const emphasisAttr = new THREE.InstancedBufferAttribute(emphasis, 1);
  emphasisAttr.setUsage(THREE.DynamicDrawUsage);
  const phaseAttr = new THREE.InstancedBufferAttribute(phase, 1);
  const visibleAttr = new THREE.InstancedBufferAttribute(visible, 1);
  visibleAttr.setUsage(THREE.DynamicDrawUsage);
  const damageAttr = new THREE.InstancedBufferAttribute(damage, 1);
  damageAttr.setUsage(THREE.DynamicDrawUsage);
  const damageRawAttr = new THREE.InstancedBufferAttribute(damageRaw, 1);
  damageRawAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aEmphasis", emphasisAttr);
  geometry.setAttribute("aPhase", phaseAttr);
  geometry.setAttribute("aVisible", visibleAttr);
  geometry.setAttribute("aDamage", damageAttr);
  geometry.setAttribute("aDamageRaw", damageRawAttr);

  // -- art-style per-instance attributes (baked once) ----------------------
  // aArtRing — Ringers peg fill by strand (near-white for edgeless standards);
  // aArtFid — Fidenza pipe fill by strand; aTwist — Fidenza per-pipe off-axis tilt.
  // Colors are baked via THREE.Color.r/g/b, i.e. LINEAR (the pipeline's own
  // convention for instanceColor + edge colors), so the shaders never need an
  // sRGB→linear step and no hand-written hex ever reaches the GLSL.
  const artRing = new Float32Array(count * 3);
  const artFid = new Float32Array(count * 3);
  const twist = new Float32Array(count);
  // VIVID strand hue per node (LINEAR), the deep street tone the Ascent-dawn
  // boldness pulls each orb toward so it reads against the bright morning sky.
  // Galaxy-only (attached to the orb geometry, not the shared art skins).
  const vivid = new Float32Array(count * 3);
  const bakeC = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const nd = nodes[i];
    bakeC.setHex(nd.deg === 0 ? RINGERS.pegWhite : (RINGERS.peg[nd.strand] ?? RINGERS.pegWhite));
    artRing[i * 3] = bakeC.r;
    artRing[i * 3 + 1] = bakeC.g;
    artRing[i * 3 + 2] = bakeC.b;
    bakeC.setHex(FIDENZA.node[nd.strand] ?? FIDENZA.palette[0]);
    artFid[i * 3] = bakeC.r;
    artFid[i * 3 + 1] = bakeC.g;
    artFid[i * 3 + 2] = bakeC.b;
    bakeC.setHex(STRAND_VIVID[nd.strand]);
    vivid[i * 3] = bakeC.r;
    vivid[i * 3 + 1] = bakeC.g;
    vivid[i * 3 + 2] = bakeC.b;
    twist[i] = (artHash(nd.id) - 0.5) * 0.6;
  }
  // Hanga palette slot per standard: its strand index (0..3), or 4 for an
  // edgeless standard (the bare paper disc).
  const hangaIdx = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    hangaIdx[i] = nodes[i].deg === 0 ? 4 : Math.max(0, STRAND_ORDER.indexOf(nodes[i].strand));
  }
  const hangaIdxAttr = new THREE.InstancedBufferAttribute(hangaIdx, 1);
  const artRingAttr = new THREE.InstancedBufferAttribute(artRing, 3);
  const artFidAttr = new THREE.InstancedBufferAttribute(artFid, 3);
  const twistAttr = new THREE.InstancedBufferAttribute(twist, 1);
  const vividAttr = new THREE.InstancedBufferAttribute(vivid, 3);
  geometry.setAttribute("aArtRing", artRingAttr);
  geometry.setAttribute("aArtFid", artFidAttr);
  geometry.setAttribute("aTwist", twistAttr);
  geometry.setAttribute("aVivid", vividAttr); // orb geometry only (dawn boldness)

  const uniforms = {
    uTime: { value: 0 },
    uDimColor: { value: new THREE.Color(DIM_TARGET) },
    // 1 = idle shimmer on; 0 forces the multiplier to exactly 1.0 (no glow) so
    // reduced-motion is truly still, not just frozen at a random shimmer phase.
    uShimmer: { value: 1 },
    // Story lift: during story playback, UNDAMAGED nodes brighten toward this
    // multiplier (the brighter strand tones cross the bloom threshold and halo
    // softly) so "every light here is something learned" is literal. Damage
    // attenuates the lift to nothing, widening the narrative contrast between
    // shining and struggling. 1.0 = off.
    uStoryLift: { value: 1 },
    // Transit station handoff (0 normal … 1 fully stationed). Shared with the
    // art-node materials so every skin crossfades pegs → station marks the same.
    uPoseFade: { value: 0 },
    // Light-environment amount (0 normal … 1 full light) = max(dawn, daylight).
    // Orb material only: opaque, ×1.15, repainted to a SOLID VIVID DISC (the full
    // STRAND_VIVID hue at full saturation) so the bead sits ON the light field
    // instead of washing out. 0 everywhere but the light environments (Galaxy).
    uEnvLight: { value: 0 },
  };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uDimColor = uniforms.uDimColor;
    shader.uniforms.uShimmer = uniforms.uShimmer;
    shader.uniforms.uStoryLift = uniforms.uStoryLift;
    shader.uniforms.uPoseFade = uniforms.uPoseFade;
    shader.uniforms.uEnvLight = uniforms.uEnvLight;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        attribute float aEmphasis;
        attribute float aPhase;
        attribute float aVisible;
        attribute float aDamage;
        attribute float aDamageRaw;
        attribute vec3 aVivid;
        uniform float uTime;
        uniform float uShimmer;
        uniform float uPoseFade;
        uniform float uEnvLight;
        varying float vColorMul;
        varying float vShim;
        varying float vDim;
        varying float vDamage;
        varying float vDamageRaw;
        varying float vPhase;
        varying vec3 vNrm;
        varying vec3 vViewPos;
        varying vec3 vVivid;
        `,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        {
          float mulTab[6] = float[](${glslTable("mul")});
          float sclTab[6] = float[](${glslTable("scale")});
          float dimTab[6] = float[](${glslTable("dim")});
          float e = clamp(aEmphasis, 0.0, 5.0);
          int i0 = int(floor(e));
          int i1 = int(min(floor(e) + 1.0, 5.0));
          float f = fract(e);
          float mul = mix(mulTab[i0], mulTab[i1], f);
          float scl = mix(sclTab[i0], sclTab[i1], f);
          float dim = mix(dimTab[i0], dimTab[i1], f);
          // Idle shimmer: ×1.06–1.22, ~6s period, per-instance phase.
          // Peaks graze the bloom threshold so the constellation breathes.
          // uShimmer=0 (reduced motion) collapses it to exactly 1.0 → no glow.
          float shimmer = mix(1.0, 1.14 + 0.08 * sin(uTime * ${((Math.PI * 2) / 6).toFixed(6)} + aPhase), uShimmer);
          vColorMul = mul * shimmer;
          vShim = shimmer; // story lift re-applies the breath on top of its own floor
          // Filtered-out instances shrink to a faint background speck (ghost) and
          // read as dimmed — opaque, so the depth pass and edge occlusion hold.
          scl *= mix(0.14, 1.0, aVisible);
          // Transit station handoff: collapse the orb to nothing as the station
          // mark fades in (uPoseFade 0→1). At 0 this is a no-op (× 1.0), so poses
          // 0–2 stay byte-identical.
          scl *= mix(1.0, 0.001, uPoseFade);
          // Light-environment boldness: grow the bead ×1.15 so it holds against the
          // bright field. uEnvLight 0 (every pose but the light environments) is a no-op.
          scl *= mix(1.0, 1.15, uEnvLight);
          vVivid = aVivid;
          vDim = max(dim, (1.0 - aVisible) * 0.9);
          // Damage rides on top of emphasis: it recolors (fragment) but never
          // resizes, so a chain-lit-but-damaged node keeps its emphasis size.
          vDamage = clamp(aDamage, 0.0, 1.0);
          vDamageRaw = clamp(aDamageRaw, 0.0, 1.0);
          vPhase = aPhase;
          transformed *= scl;
          // Sphere shading inputs: view-space normal + view vector. The
          // instance matrices are uniform-scale + translation (no rotation),
          // so normalize(normalMatrix * normal) is exact.
          vNrm = normalize(normalMatrix * normal);
          vec4 mvp = modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
          vViewPos = -mvp.xyz;
        }
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform vec3 uDimColor;
        uniform float uTime;
        uniform float uStoryLift;
        uniform float uEnvLight;
        varying float vColorMul;
        varying float vShim;
        varying float vDim;
        varying float vDamage;
        varying float vDamageRaw;
        varying float vPhase;
        varying vec3 vNrm;
        varying vec3 vViewPos;
        varying vec3 vVivid;
        `,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `
        #include <color_fragment>
        // Story lift: while a story plays, HEALTHY nodes rise to at least
        // chain-level brightness (shimmer preserved), so the lit strands cross
        // the bloom threshold and halo. Damage kills the lift FAST (gone by
        // d≈0.33): even a lightly-touched standard must read dimmer than its
        // healthy neighbors, never lifted back to bright — the ripple of
        // superficial learning stays visibly a ripple. max(), not ×, so a
        // focus/chain node never stacks the lift on top of its own emphasis.
        float lift = mix(uStoryLift, 1.0, clamp(vDamage * 3.0, 0.0, 1.0));
        float mulTotal = max(vColorMul, lift * vShim);
        diffuseColor.rgb = mix(diffuseColor.rgb * mulTotal, uDimColor, vDim);
        // --- sphere shading: limb darkening + a soft key light ----------------
        // Bright core, darkened silhouette: each orb reads as a self-luminous
        // sphere, and an orb in front separates visibly from one behind it
        // (the dark rim outlines it against the brighter neighbor). The HDR
        // core still crosses the bloom threshold; the rim drops below it, so
        // the halo hugs the center instead of flattening the whole disc.
        {
          vec3 nrm = normalize(vNrm);
          vec3 vdir = normalize(vViewPos);
          float facing = max(dot(nrm, vdir), 0.0);
          float limb = pow(1.0 - facing, 2.2);
          // Assumed key light, upper-left-front (view space). Half-Lambert
          // wrap keeps the shadow side luminous (these are glowing bodies,
          // not matte rock) while giving each orb a frank lit hemisphere and
          // shaded hemisphere — the modeling cue that reads "sphere" at a
          // glance and separates near orbs from far ones.
          vec3 keyDir = normalize(vec3(-0.4, 0.55, 0.73));
          float nl = dot(nrm, keyDir) * 0.5 + 0.5;
          float key = 0.5 + 0.5 * pow(nl, 1.6);
          diffuseColor.rgb *= key * (1.0 - 0.55 * limb);
        }
        // --- light-environment enamel repaint ---------------------------------
        // Against the bright dawn sky / concrete daylight the sphere-shaded bead
        // washes out (an additive-pastel smudge), so past the window the orb becomes
        // a SOLID VIVID DISC — the full-saturation STRAND_VIVID strand hue (aVivid)
        // at full alpha, replacing the modelling with flat enamel signage exactly
        // like the edge repaint (edges.ts: col = mix(col, vVivid, enamel)). uEnvLight
        // is 0 at poses 0/2/3, in the dark story baseline, and in every paper skin,
        // so the shaded galaxy orb stays byte-identical there.
        diffuseColor.rgb = mix(diffuseColor.rgb, vVivid, uEnvLight);
        // --- structural damage (composited AFTER emphasis) --------------------
        // 0 = untouched; 1 = ember husk. Damage distinguishes OUTAGE from
        // STRUGGLE: a fully-dead node (d >= 0.95) is a steady dark ember with
        // only the slow ~2.5s pulse — no breath; a half-damaged node breathes
        // slowly (a 3% swing over 4.5 s); a lightly-touched one barely moves. The
        // breath swing follows a struggle curve 4·r·(1−r) of the RAW damage that
        // peaks at r = 0.5 and vanishes at both ends (see the struggle constants
        // at the top of this file). Brightness AND saturation lerp toward a deep red-amber
        // ember, with a mid-range-boosted desaturation so struggle reads even at
        // d ≈ 0.3. The husk tops out near #7a3520 (< 1.0 in every channel), so
        // damage NEVER crosses the bloom threshold — glow stays for healthy
        // emphasis only.
        if (vDamage > 0.0001) {
          float d = vDamage;
          // Monotone dimming floor: brightness falls with damage from the very
          // first touch, so a d≈0.2 standard is unmistakably dimmer than a
          // healthy one and the wound stays visible across every later scene.
          diffuseColor.rgb *= 1.0 - 0.5 * smoothstep(0.03, 0.7, d);
          // ~2.5s ember pulse, TRUE husks only (emberPulse above is the TS
          // mirror). A partial standard holds the pulse midpoint, its time mean.
          float pulseGate = smoothstep(${glf(HUSK_STEADY_AT)}, ${glf(EMBER_PULSE_FULL)}, d);
          float pulse = 0.5 + 0.5 * pulseGate * sin(uTime * ${EMBER_PULSE_RAD_PER_SEC.toFixed(7)} + vPhase);
          // Near-black embers: a fully-missed standard reads as OFF — a dark
          // body holding its place — not as a glowing coal. The faint warm
          // pulse is only there so the eye can find the wound on a dark field.
          // Values are LINEAR (the output transform re-brightens them to the
          // intended sRGB #1c0b07 → #38180e on screen).
          vec3 emberLo = vec3(0.0116, 0.0037, 0.0021);
          vec3 emberHi = vec3(0.0402, 0.0089, 0.0044);
          vec3 husk = mix(emberLo, emberHi, pulse);
          // Mid-range-boosted desaturation: the struggle band (d ~ 0.3–0.6)
          // visibly drains of strand color before it goes ember.
          float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum), clamp(d * 1.35, 0.0, 1.0) * 0.6);
          // Struggle breath (struggleFlickMul above is the TS mirror): one slow
          // sine per node, STRUGGLE_PERIOD_SEC per cycle with a per-node phase.
          // Its swing reads the RAW damage (vDamageRaw, before the story display
          // floor), peaks at raw 0.5, and vanishes at both ends. A fully-dead
          // ember (display d >= HUSK_STEADY_AT) sits steady. The mean dip stays
          // on the display value, so each node's time-averaged brightness is
          // exactly the shipped one; the breath only moves around that mean.
          float huskCut = 1.0 - step(${HUSK_STEADY_AT.toFixed(4)}, d);
          float r = vDamageRaw;
          float struggle = 4.0 * r * (1.0 - r) * huskCut;
          float struggleDip = 4.0 * d * (1.0 - d) * huskCut;
          float breath = sin(uTime * ${glf((2 * Math.PI) / STRUGGLE_PERIOD_SEC)} + vPhase * ${glf(STRUGGLE_PHASE_MUL)});
          float flickMul = (1.0 - ${glf(STRUGGLE_DEPTH / 2)} * struggleDip)
                         * (1.0 - ${glf(STRUGGLE_SWING / 2)} * struggle * breath);
          diffuseColor.rgb = mix(diffuseColor.rgb, husk, d) * flickMul;
        }
        `,
      );
  };
  // Distinct cache key so the patched program never collides with a stock basic material.
  material.customProgramCacheKey = () => "coherence-nodes-v5-orbs";

  // -- art-style geometries + materials (built once; swapped in setArtStyle) --
  // Every geometry carries the SAME instanced attribute objects (state, filters,
  // stories, and poses all keep working across a swap because the buffers are
  // shared). Only position/normal differ per skin.
  function attachShared(g: THREE.BufferGeometry): void {
    g.setAttribute("aEmphasis", emphasisAttr);
    g.setAttribute("aPhase", phaseAttr);
    g.setAttribute("aVisible", visibleAttr);
    g.setAttribute("aDamage", damageAttr);
    g.setAttribute("aDamageRaw", damageRawAttr);
    g.setAttribute("aArtRing", artRingAttr);
    g.setAttribute("aArtFid", artFidAttr);
    g.setAttribute("aTwist", twistAttr);
  }

  // Ringers peg: a short cylinder whose AXIS points +z, so the flat circular
  // face fronts the canonical camera (a disc) and orbiting reveals its height.
  const ringGeometry = new THREE.CylinderGeometry(1, 1, 1.7, 24);
  ringGeometry.rotateX(Math.PI / 2);
  attachShared(ringGeometry);
  // Ringers outline: an inverted-hull shell of the same peg, fattened in radius
  // (x/y) and a touch in height (z, the axis after the rotate). BackSide ink.
  const outlineGeometry = ringGeometry.clone();
  outlineGeometry.scale(1.14, 1.14, 1.06);
  attachShared(outlineGeometry);
  // Fidenza node: a PIPE segment (round 7, Mark's direction — was a cube).
  // A cylinder whose AXIS points +z (rotateX(PI/2)) like the Ringers peg, but
  // proportionally longer and slimmer — a length of pipe, not a puck. Tilted
  // off-axis per-instance by aTwist in the vertex shader; the fragment adds a
  // cylindrical rounding cue so it reads round.
  const fidGeometry = new THREE.CylinderGeometry(0.75, 0.75, 2.4, 20);
  fidGeometry.rotateX(Math.PI / 2);
  attachShared(fidGeometry);

  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true });
  ringMaterial.depthWrite = true;
  patchArtNodeMaterial(ringMaterial, {
    colorSource: { kind: "attr", name: "aArtRing" },
    uField: { value: new THREE.Color(RINGERS.bg) },
    pipe: false,
    cacheKey: "coherence-nodes-ringers-peg",
    uPoseFade: uniforms.uPoseFade,
  });

  const outlineMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    side: THREE.BackSide,
  });
  outlineMaterial.depthWrite = true;
  patchArtNodeMaterial(outlineMaterial, {
    colorSource: { kind: "uniform" },
    uColor: { value: new THREE.Color(RINGERS.ink) },
    uField: { value: new THREE.Color(RINGERS.bg) },
    pipe: false,
    cacheKey: "coherence-nodes-ringers-outline",
    uPoseFade: uniforms.uPoseFade,
  });

  // Hanga disc + key-block ring (styles 3 and 4). One geometry serves both the
  // disc mesh and the shared outline mesh. Neither writes depth: the ring cuts
  // itself to the band outside the disc, and an unlit underdrawing disc must
  // never hide a lit disc behind it.
  const hangaGeometry = new THREE.IcosahedronGeometry(1, 2);
  attachShared(hangaGeometry);
  hangaGeometry.setAttribute("aHangaIdx", hangaIdxAttr);
  const hangaU: HangaNodeUniforms = {
    uHFill: { value: Array.from({ length: 5 }, () => new THREE.Vector3()) },
    uHDeep: { value: Array.from({ length: 5 }, () => new THREE.Vector3()) },
    uHLight: { value: Array.from({ length: 5 }, () => new THREE.Vector3()) },
    uHSumi: { value: new THREE.Color() },
    uHBareA: { value: 1 },
    uHBareOutlineA: { value: 0.75 },
    uHDmgDark: { value: 0 },
    uHViewW: { value: 1 },
    uHViewH: { value: 1 },
    uHPxRatio: { value: 1 },
    uStoryLift: uniforms.uStoryLift,
    uTime: uniforms.uTime,
  };
  const hangaField = { value: new THREE.Color() };
  const hangaMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true });
  hangaMaterial.depthWrite = false;
  patchArtNodeMaterial(hangaMaterial, {
    colorSource: { kind: "uniform" },
    uColor: hangaU.uHSumi,
    uField: hangaField,
    pipe: false,
    cacheKey: "coherence-nodes-hanga-disc",
    uPoseFade: uniforms.uPoseFade,
    hanga: { role: "disc", uniforms: hangaU },
  });
  const hangaOutlineMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    side: THREE.BackSide,
  });
  hangaOutlineMaterial.depthWrite = false;
  patchArtNodeMaterial(hangaOutlineMaterial, {
    colorSource: { kind: "uniform" },
    uColor: hangaU.uHSumi,
    uField: hangaField,
    pipe: false,
    cacheKey: "coherence-nodes-hanga-ring",
    uPoseFade: uniforms.uPoseFade,
    hanga: { role: "outline", uniforms: hangaU },
  });
  // Fill the Hanga uniforms for a field, in place (no allocation on a swap).
  // The bokashi ends mix in sRGB, as the preview does, then convert to LINEAR.
  const hangaC = new THREE.Color();
  function applyHangaPalette(style: number): void {
    const pal = hangaPalette(style);
    // Mix the sRGB hexes, then let THREE.Color.setHex store the LINEAR value.
    const put = (v: THREE.Vector3, hex: number, toward: number, k: number): void => {
      hangaC.setHex(mixSrgbHex(hex, toward, k));
      v.set(hangaC.r, hangaC.g, hangaC.b);
    };
    STRAND_ORDER.forEach((sid, i) => {
      put(hangaU.uHFill.value[i], pal.pigment[sid], pal.pigment[sid], 0);
      put(hangaU.uHDeep.value[i], pal.pigment[sid], pal.deep[sid], pal.deepMix);
      put(hangaU.uHLight.value[i], pal.pigment[sid], pal.light[sid], pal.lightMix);
    });
    put(hangaU.uHFill.value[4], pal.paper, pal.paper, 0);
    put(hangaU.uHDeep.value[4], pal.paper, pal.paper, 0);
    put(hangaU.uHLight.value[4], pal.paper, pal.paper, 0);
    hangaU.uHSumi.value.setHex(pal.sumi);
    hangaU.uHBareA.value = pal.paperAlpha;
    hangaU.uHBareOutlineA.value = style === 4 ? 0.6 : 0.75;
    hangaU.uHDmgDark.value = style === 4 ? 1 : 0;
    hangaField.value.setHex(pal.bg);
  }

  const fidMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true });
  fidMaterial.depthWrite = true;
  patchArtNodeMaterial(fidMaterial, {
    colorSource: { kind: "attr", name: "aArtFid" },
    uField: { value: new THREE.Color(FIDENZA.bg) },
    pipe: true,
    cacheKey: "coherence-nodes-fidenza",
    uPoseFade: uniforms.uPoseFade,
  });

  // Widened to InstancedMesh<BufferGeometry> so setArtStyle can swap in the
  // cylinder/box skins (the constructor would otherwise pin it to Icosahedron).
  const mesh: THREE.InstancedMesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.name = "nodes";

  // Ringers outline mesh — a sibling InstancedMesh that shares the peg matrices
  // (written alongside the visible matrix below). Parented to `mesh` (identity
  // transform) so it enters the scene graph without touching main.ts, and
  // renders in lockstep with the pegs (same renderOrder). Hidden off-Ringers.
  const outline: THREE.InstancedMesh = new THREE.InstancedMesh(outlineGeometry, outlineMaterial, count);
  outline.frustumCulled = false;
  outline.visible = false;
  outline.name = "nodes-outline";
  outline.renderOrder = mesh.renderOrder;
  mesh.add(outline);

  // -- transforms + colors ----------------------------------------------
  // Current world position per instance (mutable — the pose driver morphs it
  // between graph.pos and graph.pos2). Seeded to pose A (the constellation).
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) positions.set(nodes[i].pos, i * 3);

  const m = new THREE.Matrix4();
  const color = new THREE.Color();

  // Compose one instance's visible matrix from its stored position + base
  // radius (emphasis scale rides on top in the shader, never in the matrix).
  function writeVisibleMatrix(i: number): void {
    const r = radii[i];
    m.makeScale(r, r, r);
    m.setPosition(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    mesh.setMatrixAt(i, m);
    // The Ringers outline rides the exact same matrix (its fatter geometry is
    // what makes the ink rim); writing it here keeps the outline glued to the
    // pegs through every pose morph and filter/story spotlight.
    outline.setMatrixAt(i, m);
  }

  for (let i = 0; i < count; i++) {
    writeVisibleMatrix(i);
    color.setHex(STRAND_COLORS[nodes[i].strand]);
    mesh.setColorAt(i, color); // every instance colored before first render
  }
  mesh.instanceMatrix.needsUpdate = true;
  outline.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  // -- raycast proxy (never rendered) -------------------------------------
  // visible=false keeps it out of the render list entirely (0 draw calls);
  // THREE.Raycaster.intersectObject() does not test .visible, so picking
  // against it directly still works.
  const proxyGeometry = new THREE.IcosahedronGeometry(1, 0);
  const proxyMaterial = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
  });
  const proxy = new THREE.InstancedMesh(proxyGeometry, proxyMaterial, count);
  proxy.frustumCulled = false;
  proxy.visible = false;
  proxy.name = "nodes-proxy";

  let touchMode = false;
  const pm = new THREE.Matrix4();
  function writeProxyMatrix(i: number): void {
    const factor = PROXY_RADIUS_FACTOR * (touchMode ? TOUCH_EXTRA_FACTOR : 1);
    const r = radii[i] * factor;
    pm.makeScale(r, r, r);
    pm.setPosition(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    proxy.setMatrixAt(i, pm);
  }
  function writeProxyMatrices(): void {
    for (let i = 0; i < count; i++) writeProxyMatrix(i);
    proxy.instanceMatrix.needsUpdate = true;
    proxy.computeBoundingSphere();
  }
  writeProxyMatrices();

  // -- bounds for camera framing ------------------------------------------
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const n of nodes) box.expandByPoint(v.set(n.pos[0], n.pos[1], n.pos[2]));
  const boundsSphere = new THREE.Sphere();
  box.getBoundingSphere(boundsSphere);

  return {
    mesh,
    proxy,
    count,
    emphasisAttr,
    visibleAttr,
    damageAttr,
    damageRawAttr,
    isVisible(index) {
      return visible[index] !== 0;
    },
    setDamage(values, raw) {
      if (values === null) {
        damage.fill(0);
        damageRaw.fill(0);
      } else {
        damage.set(values);
        damageRaw.set(raw ?? values);
      }
      damageAttr.needsUpdate = true;
      damageRawAttr.needsUpdate = true;
    },
    setVisibleMask(mask) {
      if (mask === null) {
        visible.fill(1);
      } else {
        visible.set(mask);
      }
      visibleAttr.needsUpdate = true;
    },
    setInstancePosition(index, x, y, z) {
      positions[index * 3] = x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = z;
      writeVisibleMatrix(index);
      writeProxyMatrix(index);
    },
    commitPositions() {
      mesh.instanceMatrix.needsUpdate = true;
      outline.instanceMatrix.needsUpdate = true;
      proxy.instanceMatrix.needsUpdate = true;
    },
    refreshPickBounds() {
      proxy.computeBoundingSphere();
    },
    getPosition(index, out) {
      return out.set(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
    },
    boundsSphere,
    boundsBox: box,
    setTime(t) {
      uniforms.uTime.value = t;
    },
    setShimmerEnabled(on) {
      uniforms.uShimmer.value = on ? 1 : 0;
    },
    setStoryLift(mul) {
      uniforms.uStoryLift.value = mul;
    },
    setOrbFade(amount) {
      uniforms.uPoseFade.value = amount;
    },
    setEnvLight(amount) {
      uniforms.uEnvLight.value = amount;
    },
    setViewport(widthPx, heightPx, pixelRatio) {
      hangaU.uHViewW.value = widthPx;
      hangaU.uHViewH.value = heightPx;
      hangaU.uHPxRatio.value = pixelRatio;
    },
    setTouchPicking(on) {
      if (on === touchMode) return;
      touchMode = on;
      writeProxyMatrices();
    },
    setArtStyle(style) {
      // Swap the render skin in place: geometry + material only. The instanced
      // attributes, positions, picking proxy, and every driver keep working
      // identically because they never move. Style 0 restores the EXACT galaxy
      // geometry + material objects — pixel-identical, by construction.
      if (style === 1) {
        mesh.geometry = ringGeometry;
        mesh.material = ringMaterial;
        outline.geometry = outlineGeometry;
        outline.material = outlineMaterial;
        outline.visible = true;
      } else if (isHanga(style)) {
        applyHangaPalette(style);
        mesh.geometry = hangaGeometry;
        mesh.material = hangaMaterial;
        outline.geometry = hangaGeometry;
        outline.material = hangaOutlineMaterial;
        outline.visible = true;
      } else if (style === 2) {
        mesh.geometry = fidGeometry;
        mesh.material = fidMaterial;
        outline.visible = false;
      } else {
        mesh.geometry = geometry;
        mesh.material = material;
        outline.visible = false;
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      ringGeometry.dispose();
      outlineGeometry.dispose();
      fidGeometry.dispose();
      ringMaterial.dispose();
      outlineMaterial.dispose();
      fidMaterial.dispose();
      hangaGeometry.dispose();
      hangaMaterial.dispose();
      hangaOutlineMaterial.dispose();
      proxyGeometry.dispose();
      proxyMaterial.dispose();
    },
  };
}
