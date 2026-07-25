// Pure math for the first-visit reverse-explosion opener (scene/opener.ts): the
// deterministic RADIAL scatter generator, the implosion easing, the float-wander
// envelope, and the centroid-outward edge bloom. No THREE / DOM — just the
// arithmetic the pose driver runs.

import { describe, it, expect } from "vitest";
import {
  OPENER,
  openerDurationMs,
  easeImplode,
  convergeDurations,
  nodeSettleMs,
  edgeAppearMs,
  shouldPlayOpener,
  radialScatterPositions,
} from "../src/scene/opener";

const CENTROID: [number, number, number] = [10, -5, 3];

// A small flattened home cloud: distinct rays + radii from the centroid.
function makeHome(): Float32Array {
  const pts: number[][] = [
    [110, -5, 3], // +x, r=100
    [10, 195, 3], // +y, r=200
    [10, -5, -47], // -z, r=50
    [-290, -5, 3], // -x, r=300
    [10, -5, 3], // ON the centroid (degenerate ray)
    [130, 115, 63], // oblique
  ];
  const out = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => out.set(p, i * 3));
  return out;
}

describe("opener timing budget", () => {
  it("total = float + last straggler + its ribbon's delay & fade, hard 10–11s cap", () => {
    expect(openerDurationMs()).toBe(
      OPENER.FLOAT_MS + OPENER.CONVERGE_MAX_MS + OPENER.EDGE_DELAY_MS + OPENER.EDGE_FADE_MS,
    );
    expect(openerDurationMs()).toBeGreaterThanOrEqual(10000);
    expect(openerDurationMs()).toBeLessThanOrEqual(11000);
  });

  it("each phase sits in Mark's ranges, with a real spread of per-node rates", () => {
    expect(OPENER.FLOAT_MS).toBeGreaterThanOrEqual(1500);
    expect(OPENER.FLOAT_MS).toBeLessThanOrEqual(2000);
    // Per-node convergence durations span a meaningful range so accretion reads.
    expect(OPENER.CONVERGE_MIN_MS).toBeGreaterThanOrEqual(3000);
    expect(OPENER.CONVERGE_MAX_MS).toBeLessThanOrEqual(7000);
    expect(OPENER.CONVERGE_MAX_MS / OPENER.CONVERGE_MIN_MS).toBeGreaterThan(1.5);
    // Per-edge ghost-in ~1.5–2s, seated after a short delay.
    expect(OPENER.EDGE_FADE_MS).toBeGreaterThanOrEqual(1500);
    expect(OPENER.EDGE_FADE_MS).toBeLessThanOrEqual(2000);
    expect(OPENER.EDGE_DELAY_MS).toBeGreaterThanOrEqual(200);
    expect(OPENER.EDGE_DELAY_MS).toBeLessThanOrEqual(400);
  });
});

describe("first-visit gating (pure)", () => {
  const base = { seen: false, deepLink: false, og: false, reducedMotion: false, browseActive: false };
  it("a plain first visit plays", () => {
    expect(shouldPlayOpener(base)).toBe(true);
  });
  it("a return visit (seen) skips", () => {
    expect(shouldPlayOpener({ ...base, seen: true })).toBe(false);
  });
  it("a deep-link arrival skips (and, being a skip, never consumes the flag)", () => {
    expect(shouldPlayOpener({ ...base, deepLink: true })).toBe(false);
  });
  it("?og, reduced motion, and the phone Browse landing all skip", () => {
    expect(shouldPlayOpener({ ...base, og: true })).toBe(false);
    expect(shouldPlayOpener({ ...base, reducedMotion: true })).toBe(false);
    expect(shouldPlayOpener({ ...base, browseActive: true })).toBe(false);
  });
  it("storage-unavailable (seen reads false) plays — fails open to the experience", () => {
    // The caller passes seen=false when localStorage throws; the gate then plays.
    expect(shouldPlayOpener({ ...base, seen: false })).toBe(true);
  });
});

describe("per-edge crystallization schedule", () => {
  it("an edge appears after its LATER endpoint settles, plus the seat delay", () => {
    const sEarly = nodeSettleMs(OPENER.CONVERGE_MIN_MS); // a fast-arriving node
    const sLate = nodeSettleMs(OPENER.CONVERGE_MAX_MS); // a straggler
    // The edge keys off the LATER endpoint (never the earlier one).
    expect(edgeAppearMs(sEarly, sLate)).toBe(sLate + OPENER.EDGE_DELAY_MS);
    expect(edgeAppearMs(sLate, sEarly)).toBe(sLate + OPENER.EDGE_DELAY_MS); // order-independent
    // ...and strictly after BOTH endpoints have landed.
    expect(edgeAppearMs(sEarly, sLate)).toBeGreaterThan(sEarly);
    expect(edgeAppearMs(sEarly, sLate)).toBeGreaterThan(sLate);
  });

  it("node settle time = float + its accretion duration", () => {
    expect(nodeSettleMs(0)).toBe(OPENER.FLOAT_MS);
    expect(nodeSettleMs(OPENER.CONVERGE_MAX_MS)).toBe(OPENER.FLOAT_MS + OPENER.CONVERGE_MAX_MS);
  });

  it("the last possible ribbon finishes fading within the total budget", () => {
    // Worst case: both endpoints are the slowest straggler.
    const latest = nodeSettleMs(OPENER.CONVERGE_MAX_MS);
    const lastEdgeDone = edgeAppearMs(latest, latest) + OPENER.EDGE_FADE_MS;
    expect(lastEdgeDone).toBeLessThanOrEqual(openerDurationMs());
  });
});

describe("implosion easing (gentle accel, trackable landing)", () => {
  it("is anchored at the endpoints and monotonic", () => {
    expect(easeImplode(0)).toBe(0);
    expect(easeImplode(1)).toBe(1);
    expect(easeImplode(-1)).toBe(0); // clamped
    expect(easeImplode(2)).toBe(1);
    let prev = -1;
    for (let x = 0; x <= 1.0001; x += 0.02) {
      const p = easeImplode(x);
      expect(p).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = p;
    }
  });

  it("is back-loaded (accelerating) but gentler than a cubic ease-in", () => {
    // Less than half the distance is covered by half the time (ease-in).
    expect(easeImplode(0.5)).toBeLessThan(0.4);
    expect(easeImplode(0.66)).toBeLessThan(0.6);
    // ...but a cubic (t³) would be harsher early: the near-quadratic curve has
    // covered MORE ground by the same point (its acceleration/peak speed is lower).
    expect(easeImplode(0.5)).toBeGreaterThan(0.5 * 0.5 * 0.5);
  });

  it("lands still moving: real (trackable) terminal velocity, below the peak", () => {
    const vel = (x: number): number => (easeImplode(x + 1e-4) - easeImplode(x - 1e-4)) / 2e-4;
    let peak = 0;
    for (let x = 0.1; x < 0.95; x += 0.01) peak = Math.max(peak, vel(x));
    const terminal = vel(0.995);
    expect(terminal).toBeLessThan(peak); // damped relative to the peak
    // A meaningful residual velocity at arrival — NOT eased to a dead stop, so the
    // final half-second still reads as coherent inward motion, not a blink.
    expect(terminal).toBeGreaterThan(0.4 * peak);
  });
});

describe("per-node accretion durations", () => {
  it("is deterministic, in-range, and decorrelated from the scatter draw", () => {
    const a = convergeDurations(480, 1337);
    const b = convergeDurations(480, 1337);
    expect(Array.from(a)).toEqual(Array.from(b)); // reproducible
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeGreaterThanOrEqual(OPENER.CONVERGE_MIN_MS);
      expect(a[i]).toBeLessThanOrEqual(OPENER.CONVERGE_MAX_MS);
    }
    const c = convergeDurations(480, 1338);
    let differ = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - c[i]) > 1e-6) differ++;
    expect(differ).toBeGreaterThan(a.length * 0.9); // a different seed → a different field
  });

  it("actually spreads the arrival times (nodes accrete, not arrive together)", () => {
    const d = convergeDurations(480, 1337);
    let min = Infinity;
    let max = -Infinity;
    for (const v of d) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    // The realized spread nearly fills the configured band — early stars land
    // seconds before the stragglers.
    expect(max - min).toBeGreaterThan((OPENER.CONVERGE_MAX_MS - OPENER.CONVERGE_MIN_MS) * 0.9);
  });
});

describe("radial scatter generator", () => {
  it("is a pure function of its seed", () => {
    const home = makeHome();
    const a = radialScatterPositions(home, CENTROID, 1337);
    const b = radialScatterPositions(home, CENTROID, 1337);
    expect(Array.from(a)).toEqual(Array.from(b));
    const c = radialScatterPositions(home, CENTROID, 1338);
    let differ = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - c[i]) > 1e-6) differ++;
    expect(differ).toBeGreaterThan(0);
  });

  it("pushes each node OUT along its own ray (direction preserved, no crossing)", () => {
    const home = makeHome();
    const out = radialScatterPositions(home, CENTROID, 1337);
    const n = home.length / 3;
    for (let i = 0; i < n; i++) {
      const hx = home[i * 3] - CENTROID[0];
      const hy = home[i * 3 + 1] - CENTROID[1];
      const hz = home[i * 3 + 2] - CENTROID[2];
      const r = Math.hypot(hx, hy, hz);
      const sx = out[i * 3] - CENTROID[0];
      const sy = out[i * 3 + 1] - CENTROID[1];
      const sz = out[i * 3 + 2] - CENTROID[2];
      const sr = Math.hypot(sx, sy, sz);
      if (r < 1e-6) {
        // Degenerate node (on the centroid): still placed at a finite radius.
        expect(sr).toBeGreaterThan(0);
        continue;
      }
      // Same direction: the unit ray is preserved (cross product ≈ 0, dot > 0).
      const cross = Math.hypot(hy * sz - hz * sy, hz * sx - hx * sz, hx * sy - hy * sx);
      expect(cross / (r * sr)).toBeLessThan(1e-5);
      expect(hx * sx + hy * sy + hz * sz).toBeGreaterThan(0);
      // Distance multiple sits inside the configured bracket.
      const mult = sr / r;
      expect(mult).toBeGreaterThanOrEqual(OPENER.SCATTER_MULT_MIN - 1e-6);
      expect(mult).toBeLessThanOrEqual(OPENER.SCATTER_MULT_MAX + 1e-6);
    }
  });

  it("scatters far — every non-degenerate node is at least MIN× its home radius out", () => {
    const home = makeHome();
    const out = radialScatterPositions(home, CENTROID, 42);
    const n = home.length / 3;
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(home[i * 3] - CENTROID[0], home[i * 3 + 1] - CENTROID[1], home[i * 3 + 2] - CENTROID[2]);
      if (r < 1e-6) continue;
      const sr = Math.hypot(out[i * 3] - CENTROID[0], out[i * 3 + 1] - CENTROID[1], out[i * 3 + 2] - CENTROID[2]);
      expect(sr).toBeGreaterThanOrEqual(r * OPENER.SCATTER_MULT_MIN - 1e-6);
    }
  });
});
