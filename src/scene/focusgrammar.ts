// Pure focus-grammar primitives for the structural-pose focus recolor (round 11).
//
// When a standard is focused, the two structural poses re-read the SAME per-node
// / per-edge emphasis the galaxy uses, but express it differently: the Blueprint
// turns white ink into a strand-colour highlighter, and the Transit ghosts the
// city so the chain owns the frame. This module holds the shared arithmetic —
// the "connected to the focus" ramps, the per-layer focus alpha fades, and the
// Transit city-background fade target — with NO THREE and NO DOM, so it is
// unit-tested directly (tests/focusgrammar.test.ts) and the scene layers
// (scene/edges.ts GLSL, scene/stations.ts, scene/drafts.ts) stay in agreement
// with one source of truth.

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Connectedness ramp: 0 at REST(1) and below → 1 at HOVER(2) and above (chain /
 * related / hover all read as "connected to the focus"). Drives strand
 * re-saturation and the focus width bump. 0 with no focus (every element REST),
 * so no-focus looks are untouched.
 */
export const connectedness = (e: number): number => clamp01(e - 1);

/**
 * Unconnectedness ramp: 1 only at DIMMED(0) — an element a focus dimmed — and 0
 * at REST(1) and above. Drives the fade toward faint ink (Blueprint) / the city
 * background (Transit). 0 with no focus.
 */
export const unconnectedness = (e: number): number => clamp01(1 - e);

/**
 * Transit station focus alpha: an UNCONNECTED (DIMMED) station drops to ~0.15 so
 * it recedes into the city; resting + connected stations stay full (1).
 */
export const stationFocusFade = (e: number): number => (e < 1 ? 0.15 + 0.85 * clamp01(e) : 1);

/**
 * Blueprint drafted-symbol focus alpha: an UNCONNECTED symbol fades to ~0.18 (a
 * faint ink), resting + connected stay full (1).
 */
export const draftFocusFade = (e: number): number => (e < 1 ? 0.18 + 0.82 * clamp01(e) : 1);

/** GLSL-parity smoothstep (Hermite), clamped — matches the edge shader exactly. */
const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

// Transit UNFOCUSED-overview trunk ghost. Kept in lockstep with the edges.ts GLSL
// (same floor + thresholds + smoothstep) — the test pins the agreement.
const TRUNK_GHOST_FLOOR = 0.08; // a non-trunk resting line keeps this fraction of its alpha
const TRUNK_LO = 0.2; // trunk metric where the ghost begins to lift
const TRUNK_HI = 0.7; // trunk metric at/above which a line reads as a full-opacity trunk

/**
 * Transit unfocused-overview alpha multiplier (the m3 == 1 / full-Transit value).
 * With no focus, every prerequisite line rests at ~0.95 and the ~757 opaque ribbons
 * collapse into a tangle at full zoom, burying the metro grammar. Feature the trunk
 * network by fading NON-TRUNK (low-reach) RESTING lines toward the DESIGN dimmed
 * convention (~0.08·alpha) while wide trunks stay opaque.
 *
 * `trunkMetric` is the reach-normalized 0..1 signal that also sets a line's trunk
 * WIDTH (clamp((sourceRadius−1.6)·2, 0, 4)·0.25), so width and opacity agree: wide ⇒
 * opaque, thin ⇒ ghosted. restness = (1−connectedness)(1−unconnectedness) is 1 only
 * for a RESTING edge (no focus, and not the hovered line), so a focus's connected/
 * dimmed grammar is left completely untouched. The GLSL gates the whole thing on the
 * pose-3 morph amount m3, so poses 0–2 are byte-identical.
 */
export function transitOverviewKeep(trunkMetric: number, emphasis: number): number {
  const restness = (1 - connectedness(emphasis)) * (1 - unconnectedness(emphasis));
  const trunkKeep =
    TRUNK_GHOST_FLOOR + (1 - TRUNK_GHOST_FLOOR) * smoothstep(TRUNK_LO, TRUNK_HI, clamp01(trunkMetric));
  return 1 - restness * (1 - trunkKeep); // mix(1, trunkKeep, restness)
}

/** sRGB channel (0..1) → linear. Matches THREE.Color's sRGB→working conversion. */
export const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

// Transit fade-target endpoints: the near-black dark baseline and concrete
// daylight the city dissolves between. These are the SAME hexes the edge shader
// mixes as LINEAR literals — keep them in lockstep (the test pins both ends).
const CITY_DARK = 0x0a0a16;
const CITY_DAY = 0xbeb9b0;
const linTriple = (hex: number): [number, number, number] => [
  srgbToLinear(((hex >> 16) & 0xff) / 255),
  srgbToLinear(((hex >> 8) & 0xff) / 255),
  srgbToLinear((hex & 0xff) / 255),
];
const CITY_DARK_LIN = linTriple(CITY_DARK);
const CITY_DAY_LIN = linTriple(CITY_DAY);

/**
 * The city background an unconnected Transit line / station dissolves toward:
 * mix(#0a0a16, #beb9b0, daylight01) in LINEAR space. daylight01 0 = dark baseline
 * (near-black), 1 = concrete daylight. Returns linear [r, g, b].
 */
export function cityFadeTarget(daylight01: number): [number, number, number] {
  const t = clamp01(daylight01);
  return [
    CITY_DARK_LIN[0] + (CITY_DAY_LIN[0] - CITY_DARK_LIN[0]) * t,
    CITY_DARK_LIN[1] + (CITY_DAY_LIN[1] - CITY_DARK_LIN[1]) * t,
    CITY_DARK_LIN[2] + (CITY_DAY_LIN[2] - CITY_DARK_LIN[2]) * t,
  ];
}
