// Pure math for the first-visit opener (scene/opener.ts): the deterministic
// scatter generator, the per-node convergence schedule, and the per-edge
// draw-in schedule. No THREE / DOM — just the arithmetic the pose driver runs.

import { describe, it, expect } from "vitest";
import {
  OPENER,
  openerDurationMs,
  smoothstep01,
  nodeDelayMs,
  nodeProgress,
  edgeGrow,
  scatterHalfExtents,
  scatterPositions,
} from "../src/scene/opener";

const CENTER: [number, number, number] = [10, -5, 3];
const HALF: [number, number, number] = [100, 40, 40];

// Per-axis-descaled radius: for a point built as center + unit·f scaled per axis
// by half, this recovers f (the ellipsoidal shell fraction).
function shellFraction(
  out: Float32Array,
  i: number,
  center: readonly [number, number, number],
  half: readonly [number, number, number],
): number {
  const dx = (out[i * 3] - center[0]) / half[0];
  const dy = (out[i * 3 + 1] - center[1]) / half[1];
  const dz = (out[i * 3 + 2] - center[2]) / half[2];
  return Math.hypot(dx, dy, dz);
}

describe("opener timing budget", () => {
  it("total duration is one stagger span + one node ease, within the ~3s budget", () => {
    expect(openerDurationMs()).toBe(OPENER.NODE_STAGGER_MS + OPENER.NODE_MS);
    expect(openerDurationMs()).toBeLessThanOrEqual(3000);
  });

  it("nodes converge in ~1.6–2.0s and the stagger stays ≤ ~400ms", () => {
    expect(openerDurationMs()).toBeGreaterThanOrEqual(1600);
    expect(openerDurationMs()).toBeLessThanOrEqual(2000);
    expect(OPENER.NODE_STAGGER_MS).toBeLessThanOrEqual(400);
  });
});

describe("node convergence schedule", () => {
  it("delay pours left→right (K → HS) and clamps the column fraction", () => {
    expect(nodeDelayMs(0)).toBe(0);
    expect(nodeDelayMs(1)).toBe(OPENER.NODE_STAGGER_MS);
    expect(nodeDelayMs(0.5)).toBeCloseTo(OPENER.NODE_STAGGER_MS / 2, 6);
    expect(nodeDelayMs(-1)).toBe(0);
    expect(nodeDelayMs(2)).toBe(OPENER.NODE_STAGGER_MS);
  });

  it("progress is 0 before a node's delay, eased through, and exactly 1 when landed", () => {
    // First column (K, frac 0): starts immediately.
    expect(nodeProgress(0, 0)).toBe(0);
    expect(nodeProgress(OPENER.NODE_MS / 2, 0)).toBeCloseTo(0.5, 6); // smoothstep midpoint
    expect(nodeProgress(OPENER.NODE_MS, 0)).toBe(1);
    expect(nodeProgress(OPENER.NODE_MS + 500, 0)).toBe(1); // clamped, never overshoots
    // Last column (HS, frac 1): held until its stagger delay, then eases.
    expect(nodeProgress(OPENER.NODE_STAGGER_MS - 1, 1)).toBe(0);
    expect(nodeProgress(openerDurationMs(), 1)).toBe(1);
  });

  it("every node has landed by the total duration", () => {
    for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
      expect(nodeProgress(openerDurationMs(), frac)).toBe(1);
    }
  });
});

describe("edge draw-in schedule", () => {
  it("is invisible below the appear floor, grows monotonically, full at HI", () => {
    expect(edgeGrow(0)).toBe(0);
    expect(edgeGrow(OPENER.EDGE_APPEAR_LO)).toBe(0);
    expect(edgeGrow(OPENER.EDGE_APPEAR_HI)).toBe(1);
    const mid = (OPENER.EDGE_APPEAR_LO + OPENER.EDGE_APPEAR_HI) / 2;
    expect(edgeGrow(mid)).toBeCloseTo(0.5, 6);
    let prev = -1;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const g = edgeGrow(p);
      expect(g).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = g;
    }
  });

  it("edges keyed to the less-advanced endpoint only form once it has essentially landed", () => {
    // An edge whose trailing endpoint is still early (progress ≤ LO) is hidden.
    expect(edgeGrow(OPENER.EDGE_APPEAR_LO - 0.1)).toBe(0);
    // The formation overlaps the convergence tail: it starts partway through a
    // node's ease and completes when the node lands.
    expect(OPENER.EDGE_APPEAR_LO).toBeGreaterThan(0);
    expect(OPENER.EDGE_APPEAR_LO).toBeLessThan(1);
  });

  it("edge formation overlaps the convergence tail for ~0.8–1.2s", () => {
    // Elapsed (for a given column frac) at which the trailing endpoint reaches
    // the EDGE_APPEAR_LO eased progress — the earliest this column's edges show.
    const inv = (p: number): number => {
      // invert smoothstep numerically for p ∈ (0,1)
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < 60; k++) {
        const midX = (lo + hi) / 2;
        if (smoothstep01(midX) < p) lo = midX;
        else hi = midX;
      }
      return (lo + hi) / 2;
    };
    const rawLo = inv(OPENER.EDGE_APPEAR_LO);
    // First column edges begin at rawLo·NODE_MS; last column edges complete at
    // the total duration. That union window is the on-screen "edges forming" band.
    const firstStart = rawLo * OPENER.NODE_MS; // frac 0
    const lastEnd = openerDurationMs();
    const windowMs = lastEnd - firstStart;
    expect(windowMs).toBeGreaterThanOrEqual(800);
    expect(windowMs).toBeLessThanOrEqual(1200);
  });
});

describe("scatter half-extents floor", () => {
  it("floors the short axes so a flat/wide cloud still spreads in y/z", () => {
    const h = scatterHalfExtents([100, 10, 5]);
    const floor = 100 * OPENER.SPAN_FLOOR_FRAC;
    expect(h[0]).toBe(100);
    expect(h[1]).toBe(floor);
    expect(h[2]).toBe(floor);
  });
  it("leaves already-large short axes alone", () => {
    const h = scatterHalfExtents([100, 90, 80]);
    expect(h).toEqual([100, 90, 80]);
  });
});

describe("scatter generator (deterministic)", () => {
  it("is a pure function of its seed — identical output for identical inputs", () => {
    const a = scatterPositions(480, CENTER, HALF, 1337);
    const b = scatterPositions(480, CENTER, HALF, 1337);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("a different seed gives a different field (variation from time)", () => {
    const a = scatterPositions(480, CENTER, HALF, 1337);
    const b = scatterPositions(480, CENTER, HALF, 1338);
    let differ = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6) differ++;
    expect(differ).toBeGreaterThan(a.length * 0.9);
  });

  it("every node lands inside the anisotropic shell [INNER, OUTER]", () => {
    const out = scatterPositions(480, CENTER, HALF, 1337);
    for (let i = 0; i < 480; i++) {
      const f = shellFraction(out, i, CENTER, HALF);
      expect(f).toBeGreaterThanOrEqual(OPENER.SCATTER_INNER - 1e-6);
      expect(f).toBeLessThanOrEqual(OPENER.SCATTER_OUTER + 1e-6);
    }
  });

  it("reads as a dispersed field, not a dense ball — wide spread on every axis", () => {
    const out = scatterPositions(480, CENTER, HALF, 1337);
    for (let axis = 0; axis < 3; axis++) {
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < 480; i++) {
        const v = out[i * 3 + axis];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      // The spread on each axis is a large fraction of that axis's own extent —
      // the field fills a wide volume rather than clumping at the center.
      expect(max - min).toBeGreaterThan(HALF[axis] * OPENER.SCATTER_INNER);
    }
  });

  it("has no coincident nodes (the golden-angle-free RNG separates every node)", () => {
    const out = scatterPositions(480, CENTER, HALF, 1337);
    const seen = new Set<string>();
    for (let i = 0; i < 480; i++) {
      seen.add(`${out[i * 3].toFixed(3)},${out[i * 3 + 1].toFixed(3)},${out[i * 3 + 2].toFixed(3)}`);
    }
    expect(seen.size).toBe(480);
  });
});
