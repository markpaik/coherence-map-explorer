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
