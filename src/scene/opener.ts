// The opener — the first-visit "reverse-explosion" assembly of the Constellation.
//
// Mark's choreography (round 3 — "more ethereal"):
//   1. RADIAL SCATTER. Every node starts far out in deep space, along the ray
//      from the formation's centroid THROUGH its final home — a large radial
//      multiple of its home radius, with a mild per-node variation in DISTANCE
//      only (never direction). The whole constellation, blown up ~8× and hung in
//      space. Motion is then purely inward-radial: no crossing paths.
//   2. FLOAT (~2.5s). Everything hangs out there with a gentle slow per-node
//      wander (twinkle rides on as usual). No convergence yet; camera static.
//   3. ACCRETION. Each node drifts home over its OWN deterministically-drawn
//      duration (5–12s) on the gentle per-node ease-in — so the constellation
//      slowly ACCRETES: early arrivals settle while stragglers are still drifting
//      weightlessly in. A soft per-node wander (fading as each lands) keeps the
//      long approach dreamy. No simultaneous arrival.
//   4. EDGE GHOST-IN (~4.5s). Only AFTER the last node lands do the ribbons
//      appear — the WHOLE web at once, rising together from invisible through a
//      faint ghost to full presence (a global alpha fade, no spatial wipe), like
//      an apparition materializing.
//   Total ≈ 10.7s (a hard 10–11s cap — unhurried + weightless but never a slog).
//   Skipped for deep links / ?og / reduced motion; any interaction snaps to the
//   settled end state, which is pixel-identical to a skipped load.
//
// This module is PURE (no THREE, no DOM): the radial scatter generator, the
// float/implosion/edge-bloom schedules, and the timing constants are plain math
// so they unit-test in node and the pose driver (scene/pose.ts) consumes them.
// Determinism holds — the scatter is a deterministic function of the SAME clock
// seed the evolving sky + title aside use (mulberry32), never Math.random.

import { mulberry32 } from "./evolve";

// -- timing + shape constants (the ONE place to tune the opener) -------------
export const OPENER = {
  /** FLOAT: how long everything hangs far out in space before accretion begins (ms). */
  FLOAT_MS: 1600,
  /**
   * ACCRETION: per-node convergence durations are drawn from
   * [CONVERGE_MIN_MS, CONVERGE_MAX_MS]; the phase lasts CONVERGE_MAX_MS (the last
   * straggler). The ~1.9× spread makes the accretion legible — early stars settle
   * while others are still drifting in — without dragging the total past ~11s.
   */
  CONVERGE_MIN_MS: 3500,
  CONVERGE_MAX_MS: 6500,
  /**
   * EDGE CRYSTALLIZATION. Each ribbon ghosts in on its OWN schedule: it starts
   * EDGE_DELAY_MS after its LATER endpoint node settles (so the node visibly seats
   * before its connections grow, and a ribbon never attaches to a still-moving
   * node), then fades over EDGE_FADE_MS. With arrival rates scattered, the web
   * crystallizes outward from wherever it completes first. The last ribbon (fed by
   * the last straggler at FLOAT + CONVERGE_MAX) finishes within the budget.
   */
  EDGE_DELAY_MS: 300,
  EDGE_FADE_MS: 1800,
  /**
   * Radial scatter distance as a multiple of each node's home radius (its
   * distance from the centroid). Min/max bracket the mild per-node DISTANCE
   * variation; direction is always the node's own outward ray, so the scattered
   * field is the constellation itself, blown up and fuzzed only in radius.
   */
  SCATTER_MULT_MIN: 6.5,
  SCATTER_MULT_MAX: 10,
  /**
   * Per-node wander amplitude as a fraction of its scatter distance. Rides the
   * float AND fades out over each node's accretion (× 1 − progress), so the long
   * approach reads dreamy/weightless; bumped a touch (ethereal art direction).
   */
  WANDER_FRAC: 0.02,
  /** Wander frequency (Hz) — slow enough to read as a weightless drift. */
  WANDER_HZ: 0.1,
  /**
   * Per-node convergence terminal damping, 0..1. The velocity profile is
   * v(t) ∝ t·(1 − D·t): zero at the start (imperceptible), accelerating to a peak
   * at t = 1/(2D), then GENTLY decelerating to a soft landing. Over 3.5–6.5s the
   * whole drift is slow + trackable; the higher damp (softer halt) suits the
   * ethereal read. 0 = pure quadratic; higher softens the landing more.
   */
  IMPLODE_DAMP: 0.75,
  // The per-edge ghost RAMP itself (a soft two-stage: quick to a faint level, then
  // slow saturation) lives in the edge fragment shader (openerReveal) — it cannot
  // read TS. Its shape constants (ghost level 0.35, first-stage share 0.25) mirror
  // the earlier global ghost-in and are documented at that GLSL call site.
} as const;

/**
 * Total opener duration (ms): float + the last straggler's accretion + the delay
 * and fade of the ribbon it feeds. openerTotal ≥ every edge's finish time.
 */
export function openerDurationMs(): number {
  return OPENER.FLOAT_MS + OPENER.CONVERGE_MAX_MS + OPENER.EDGE_DELAY_MS + OPENER.EDGE_FADE_MS;
}

/**
 * First-visit gating (pure). The opener is a FIRST-TIME-ONLY experience: it plays
 * only on a plain first visit. It is skipped — WITHOUT consuming the first-visit
 * flag — for a deep-link arrival (a shared #/s/… or #/story/… link is not a
 * visitor's chosen first contact), the ?og screenshot mode, and reduced motion;
 * and it is skipped once the flag is set (a return visit). When localStorage is
 * unavailable (private mode) the caller passes seen=false, so it FAILS OPEN — a
 * first-time-only feature should err toward showing the experience. The seen flag
 * is written only when the opener actually runs (on completion OR interruption),
 * so none of the skip paths here consume it.
 */
export interface OpenerGateContext {
  /** The cme-opener-seen flag is present (false if unset OR storage unavailable). */
  seen: boolean;
  /** Arrived already pointed at a standard/story (#/s/… or #/story/…). */
  deepLink: boolean;
  /** ?og screenshot mode. */
  og: boolean;
  reducedMotion: boolean;
  /**
   * The phone Browse overlay owns the landing surface (the map is hidden beneath
   * it). Skip so the opener never runs unseen — and, being a skip, leaves the flag
   * unset so a later desktop visit still gets the experience.
   */
  browseActive: boolean;
}
export function shouldPlayOpener(ctx: OpenerGateContext): boolean {
  return !ctx.seen && !ctx.deepLink && !ctx.og && !ctx.reducedMotion && !ctx.browseActive;
}

/** When node with accretion duration `convergeDurMs` settles, in ms since opener start. */
export function nodeSettleMs(convergeDurMs: number): number {
  return OPENER.FLOAT_MS + convergeDurMs;
}

/**
 * When an edge may begin its ghost-in (ms since opener start): EDGE_DELAY_MS after
 * its LATER endpoint settles — never before BOTH endpoints have landed.
 */
export function edgeAppearMs(settleMsS: number, settleMsT: number): number {
  return Math.max(settleMsS, settleMsT) + OPENER.EDGE_DELAY_MS;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smoothstep01 = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/**
 * Implosion easing 0..1 — the position integral of the velocity profile
 * v(t) ∝ t·(1 − D·t) (D = OPENER.IMPLODE_DAMP):
 *   p(t) = (t²/2 − D·t³/3) / (1/2 − D/3).
 * Velocity is 0 at the start (the collapse begins imperceptibly), accelerates to
 * a peak near t ≈ 1/(2D), then GENTLY decelerates to a soft-but-nonzero landing —
 * so the final half-second still reads as coherent inward motion, not a blink.
 * p(0)=0, p(1)=1, monotonic; p(0.5) < 0.5 (back-loaded / accelerating).
 */
export function easeImplode(x: number): number {
  const t = clamp01(x);
  const D = OPENER.IMPLODE_DAMP;
  const norm = 0.5 - D / 3; // p(1) numerator, so p(1) === 1
  return ((t * t) / 2 - (D * t * t * t) / 3) / norm;
}

/**
 * Deterministic per-node convergence durations (ms), one per node, drawn
 * uniformly from [CONVERGE_MIN_MS, CONVERGE_MAX_MS]. This is what makes the
 * constellation ACCRETE — every star drifts home at its own rate, so early ones
 * settle while stragglers are still coming in (no simultaneous arrival). Seeded
 * from `seed` (the clock seed) via mulberry32 on a stream DECORRELATED from the
 * scatter draw, so the two are independent yet both reproducible — no Math.random.
 */
export function convergeDurations(n: number, seed: number): Float32Array {
  const out = new Float32Array(n);
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const { CONVERGE_MIN_MS, CONVERGE_MAX_MS } = OPENER;
  for (let i = 0; i < n; i++) out[i] = CONVERGE_MIN_MS + rng() * (CONVERGE_MAX_MS - CONVERGE_MIN_MS);
  return out;
}

/**
 * Deterministic RADIAL scatter: each node is pushed OUT along its own ray from
 * `centroid` through its home, by home-radius × a per-node multiple in
 * [SCATTER_MULT_MIN, SCATTER_MULT_MAX]. Direction is never randomized (that is
 * what keeps the implosion purely inward-radial). Seeded from `seed` (the clock
 * seed) via mulberry32 — one draw per node, no Math.random. `home` is the
 * xyz-flattened home-position array (length n·3); returns the same-length scatter.
 */
export function radialScatterPositions(
  home: Float32Array,
  centroid: readonly [number, number, number],
  seed: number,
): Float32Array {
  const n = home.length / 3;
  const out = new Float32Array(home.length);
  const rng = mulberry32(seed >>> 0);
  const { SCATTER_MULT_MIN, SCATTER_MULT_MAX } = OPENER;
  const [cx, cy, cz] = centroid;
  for (let i = 0; i < n; i++) {
    const hx = home[i * 3] - cx;
    const hy = home[i * 3 + 1] - cy;
    const hz = home[i * 3 + 2] - cz;
    let r = Math.hypot(hx, hy, hz);
    const mult = SCATTER_MULT_MIN + rng() * (SCATTER_MULT_MAX - SCATTER_MULT_MIN);
    let dx: number, dy: number, dz: number;
    if (r < 1e-6) {
      // Degenerate: a node sitting exactly on the centroid has no ray. Pick a
      // deterministic direction from its index (never happens for the real mean
      // centroid, but keep it defined + reproducible).
      const a = i * 2.399963;
      const z = ((i % 97) / 96) * 2 - 1;
      const s = Math.sqrt(Math.max(0, 1 - z * z));
      dx = s * Math.cos(a);
      dy = s * Math.sin(a);
      dz = z;
      r = 1;
    } else {
      dx = hx / r;
      dy = hy / r;
      dz = hz / r;
    }
    const dist = r * mult;
    out[i * 3] = cx + dx * dist;
    out[i * 3 + 1] = cy + dy * dist;
    out[i * 3 + 2] = cz + dz * dist;
  }
  return out;
}
