// The opener — the first-visit "assembly" of the Constellation.
//
// On a normal boot the 480 standards start SCATTERED across a wide, dispersed
// star field (an anisotropic shell around the constellation's home region — it
// reads as "stars everywhere", not a dense noise ball) and converge into their
// pose-0 positions with a left→right K→HS stagger, while the prerequisite/related
// ribbons DRAW THEMSELVES from prerequisite toward dependent once their endpoints
// have essentially landed. The whole thing settles in under ~3s and hands off to
// the pose driver's ordinary settled-pose-0 state — after it, drift / focus /
// pose switches / stories / the tour all behave exactly as today.
//
// This module is PURE (no THREE, no DOM): the scatter generator, the per-node
// convergence schedule, and the per-edge draw-in schedule are plain math so they
// unit-test in node and so the pose driver (scene/pose.ts) can consume them. The
// determinism rule holds — the scatter is a deterministic function of the SAME
// clock seed the evolving sky and the title aside use (mulberry32), never
// Math.random: "structure from mathematics, variation from time, nothing from
// chance."

import { mulberry32 } from "./evolve";

// -- timing + shape constants (the ONE place to tune the opener) -------------
export const OPENER = {
  /** Each node's own convergence ease length (ms). */
  NODE_MS: 1600,
  /**
   * Total K→HS stagger span across all grade columns (ms). Kept ≤ ~400 so the
   * field POURS into place left→right rather than snapping home as one block.
   */
  NODE_STAGGER_MS: 380,
  /**
   * A ribbon begins to draw itself when its LESS-advanced endpoint reaches this
   * eased convergence progress, and is fully formed at EDGE_APPEAR_HI. The lag
   * behind the node arrival keeps the ribbons invisible through the scatter and
   * forms them over the convergence tail (~0.8–1.2s), so they never flash across
   * a still-flying node.
   */
  EDGE_APPEAR_LO: 0.5,
  EDGE_APPEAR_HI: 1.0,
  /**
   * Scatter shell inner / outer radius, as a multiple of the constellation's own
   * (floored) box half-extents. Inner > ~0.9 keeps the middle from clumping into
   * a ball; outer spreads the field past the frame so stars pour inward.
   */
  SCATTER_INNER: 0.95,
  SCATTER_OUTER: 1.7,
  /**
   * Floor the short (y / z) scatter half-extents to this fraction of the long
   * (x) extent, so the flat, wide constellation still scatters into a cloud with
   * real vertical + depth spread instead of a pancake.
   */
  SPAN_FLOOR_FRAC: 0.4,
} as const;

/** Total opener duration (ms): the last column's stagger plus one node ease. */
export function openerDurationMs(): number {
  return OPENER.NODE_STAGGER_MS + OPENER.NODE_MS;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smoothstep01 = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/**
 * Per-node convergence delay (ms) from its grade-column fraction (0 = K … 1 = the
 * last HS course column). The left→right pour that reads as a K→HS assembly.
 */
export function nodeDelayMs(columnFrac: number): number {
  return clamp01(columnFrac) * OPENER.NODE_STAGGER_MS;
}

/**
 * Per-node eased convergence progress 0..1 (0 = at its scatter position, 1 =
 * landed on its pose-0 home) for a given elapsed time and grade-column fraction.
 */
export function nodeProgress(elapsedMs: number, columnFrac: number): number {
  return smoothstep01((elapsedMs - nodeDelayMs(columnFrac)) / OPENER.NODE_MS);
}

/**
 * Per-edge draw-in amount 0..1 from the LESS-advanced endpoint's convergence
 * progress. 0 ⇒ the ribbon is collapsed to a point at its source (invisible);
 * 1 ⇒ the ribbon is fully formed and byte-identical to the settled edge.
 */
export function edgeGrow(minEndpointProgress: number): number {
  const { EDGE_APPEAR_LO, EDGE_APPEAR_HI } = OPENER;
  return smoothstep01((minEndpointProgress - EDGE_APPEAR_LO) / (EDGE_APPEAR_HI - EDGE_APPEAR_LO));
}

/**
 * Floor the short axes of a box's half-extents so a flat/wide cloud still scatters
 * with vertical + depth spread. Returns [hx, hy, hz] with hy, hz ≥ hx·SPAN_FLOOR_FRAC.
 */
export function scatterHalfExtents(
  half: readonly [number, number, number],
): [number, number, number] {
  const floor = half[0] * OPENER.SPAN_FLOOR_FRAC;
  return [half[0], Math.max(half[1], floor), Math.max(half[2], floor)];
}

/**
 * Deterministic scatter cloud: `n` nodes distributed over an anisotropic shell
 * centered on `center`, with per-axis half-extents `half` (typically the
 * constellation's floored box half-extents) scaled by SCATTER_INNER..OUTER.
 * Seeded purely from `seed` (the clock seed) via mulberry32 — no Math.random.
 * The direction is uniform on the sphere; the radial fraction uses a cube-root so
 * the shell fills evenly (volume-uniform) rather than crowding its inner surface.
 * Returns an xyz-flattened Float32Array of length n·3.
 */
export function scatterPositions(
  n: number,
  center: readonly [number, number, number],
  half: readonly [number, number, number],
  seed: number,
): Float32Array {
  const out = new Float32Array(n * 3);
  const rng = mulberry32(seed >>> 0);
  const [cx, cy, cz] = center;
  const [hx, hy, hz] = half;
  const { SCATTER_INNER, SCATTER_OUTER } = OPENER;
  for (let i = 0; i < n; i++) {
    const u = rng();
    const v = rng();
    const w = rng();
    const theta = u * Math.PI * 2;
    const cosPhi = 2 * v - 1;
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
    const f = SCATTER_INNER + (SCATTER_OUTER - SCATTER_INNER) * Math.cbrt(w);
    const dx = sinPhi * Math.cos(theta);
    const dy = sinPhi * Math.sin(theta);
    const dz = cosPhi;
    out[i * 3] = cx + dx * f * hx;
    out[i * 3 + 1] = cy + dy * f * hy;
    out[i * 3 + 2] = cz + dz * f * hz;
  }
  return out;
}
