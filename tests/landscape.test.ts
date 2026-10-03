// Pure math of the Hanga landscape (src/scene/landscape.ts), which mirrors the
// GLSL one for one: the ridge silhouette, the crane schedule, the quiet easing,
// the murmuration bounds, and the ridge legibility pairs.

import { describe, it, expect } from "vitest";
import {
  RINGS,
  PEAK,
  CRANE,
  CRANE_SLOTS,
  MURM,
  LAND,
  QUIET_EASE,
  ridgeHeight,
  ringCeiling,
  pnoise,
  lhash,
  craneGap,
  craneSchedule,
  craneScheduleInto,
  cranePathInto,
  easeQuiet,
  murmurationCenter,
  murmurationLocal,
  hexToLinear,
  crestLinear,
  contrast,
  type CranePath,
} from "../src/scene/landscape";

const TAU = Math.PI * 2;

describe("ridge silhouette", () => {
  it("is seamless at 0 and 360 degrees", () => {
    for (const ring of RINGS) {
      const a = ridgeHeight(ring, 0);
      expect(ridgeHeight(ring, TAU)).toBeCloseTo(a, 9);
      expect(ridgeHeight(ring, -Math.PI)).toBeCloseTo(ridgeHeight(ring, Math.PI), 9);
      // Continuous across the seam: no step between just below and just above.
      const eps = 1e-6;
      expect(Math.abs(ridgeHeight(ring, TAU - eps) - ridgeHeight(ring, eps))).toBeLessThan(0.01);
      expect(Math.abs(ridgeHeight(ring, Math.PI - eps) - ridgeHeight(ring, -Math.PI + eps))).toBeLessThan(0.01);
    }
  });

  it("periodic noise meets itself at u = 0 and u = 1", () => {
    for (const N of [3, 13, 26, 52]) {
      expect(pnoise(0, N, 7)).toBeCloseTo(pnoise(1, N, 7), 12);
      expect(pnoise(1 - 1e-9, N, 7)).toBeCloseTo(pnoise(0, N, 7), 5);
    }
  });

  it("stays between the ring top and its ceiling, and is not flat", () => {
    for (const ring of RINGS) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < 3600; i++) {
        const h = ridgeHeight(ring, (i / 3600) * TAU);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
      expect(lo).toBeGreaterThanOrEqual(ring.top);
      expect(hi).toBeLessThanOrEqual(ringCeiling(ring) + 1e-9);
      expect(hi - lo).toBeGreaterThan(ring.amp * 0.6);
    }
  });

  it("rings run near to far, each crest band above the one in front of it", () => {
    for (let i = 1; i < RINGS.length; i++) {
      expect(RINGS[i].R).toBeGreaterThan(RINGS[i - 1].R);
      expect(RINGS[i].top).toBeGreaterThan(RINGS[i - 1].top);
    }
  });

  it("the hash is deterministic and in [0, 1)", () => {
    for (let i = 0; i < 500; i++) {
      const v = lhash(11, i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(lhash(11, i)).toBe(v);
    }
  });
});

describe("crane schedule", () => {
  it("the gap after each crossing is 50 to 90 seconds", () => {
    for (let k = 0; k < 400; k++) {
      const g = craneGap(k);
      expect(g).toBeGreaterThanOrEqual(50);
      expect(g).toBeLessThan(90);
    }
  });

  it("a crossing lasts 40 s, then the sky stays empty for the gap", () => {
    expect(CRANE.crossing).toBe(40);
    let prev = craneSchedule(0);
    expect(prev.visible).toBe(false); // before the first flight
    let crossings = 0;
    let visibleFor = 0;
    let emptyFor = 0;
    const dt = 0.25;
    for (let t = dt; t < 3000; t += dt) {
      const s = craneSchedule(t);
      if (s.visible) visibleFor += dt;
      else if (t > CRANE.first) emptyFor += dt;
      if (s.index !== prev.index) {
        // the new crossing starts exactly after crossing + gap of the old one
        expect(s.start).toBeCloseTo(prev.start + CRANE.crossing + craneGap(prev.index), 9);
        crossings++;
      }
      prev = s;
    }
    expect(crossings).toBeGreaterThan(20);
    // Every crossing shows 40 s, so the visible share is 40 / (40 + mean gap).
    const share = visibleFor / (visibleFor + emptyFor);
    expect(share).toBeGreaterThan(40 / 130);
    expect(share).toBeLessThan(40 / 90);
  });

  it("the incremental schedule matches the from-zero schedule", () => {
    const state = craneSchedule(0);
    for (let t = 0; t < 2500; t += 3.7) {
      craneScheduleInto(t, state, state);
      expect(state).toEqual(craneSchedule(t));
    }
    // A clock that runs backward restarts the count from zero.
    craneScheduleInto(10, state, state);
    expect(state).toEqual(craneSchedule(10));
  });

  it("every path keeps the flight beyond the far ring and above every ridge", () => {
    const far = RINGS[RINGS.length - 1];
    const highest = Math.max(...RINGS.map(ringCeiling));
    const p: CranePath = { az0: 0, az1: 0, R: 0, h0: 0, h1: 0, count: 0 };
    const minRise = Math.min(...CRANE_SLOTS.map((s) => s[1])) - 5 - 5; // slot jitter and bob
    for (let k = 0; k < 300; k++) {
      cranePathInto(k, p);
      expect(p.R - CRANE.size).toBeGreaterThan(far.R);
      expect(Math.min(p.h0, p.h1) + minRise - CRANE.size).toBeGreaterThan(highest);
      expect(Math.min(p.h0, p.h1) + minRise - CRANE.size).toBeGreaterThan(PEAK.apex);
      expect(p.count).toBeGreaterThanOrEqual(3);
      expect(p.count).toBeLessThanOrEqual(5);
    }
  });
});

describe("quiet easing", () => {
  it("ramps linearly over about 2 seconds and clamps", () => {
    expect(QUIET_EASE).toBe(2);
    let q = 0;
    for (let i = 0; i < 60; i++) q = easeQuiet(q, 1, 1 / 60);
    expect(q).toBeCloseTo(0.5, 6);
    for (let i = 0; i < 60; i++) q = easeQuiet(q, 1, 1 / 60);
    expect(q).toBeCloseTo(1, 6);
    q = easeQuiet(q, 1, 1);
    expect(q).toBe(1);
    q = easeQuiet(q, 0, 0.5);
    expect(q).toBeCloseTo(0.75, 9);
    expect(easeQuiet(0.2, 0, 10)).toBe(0);
    expect(easeQuiet(0.5, 1, -1)).toBe(0.5);
  });
});

describe("murmuration bounds", () => {
  const far = RINGS[RINGS.length - 1];
  const highestFar = ringCeiling(far);

  it("the center stays above the far ridge top and beyond the far ring radius", () => {
    for (let t = 0; t < 1200; t += 0.5) {
      const c = murmurationCenter(t);
      expect(c.R).toBeGreaterThan(far.R);
      expect(c.h).toBeGreaterThan(highestFar);
    }
  });

  it("every speck stays above the far ridge and beyond the far ring", () => {
    let minR = Infinity;
    let minH = Infinity;
    let maxExtent = 0;
    for (let s = 0; s < 400; s++) {
      // corners and hashed points of the unit ball
      const u = lhash(701, s) * TAU;
      const v = Math.acos(2 * lhash(702, s) - 1);
      const r = s < 50 ? 1 : Math.cbrt(lhash(703, s));
      const p0: [number, number, number] = [r * Math.sin(v) * Math.cos(u), r * Math.cos(v), r * Math.sin(v) * Math.sin(u)];
      for (let t = 0; t < 600; t += 1.7) {
        const c = murmurationCenter(t);
        const [x, y, z] = murmurationLocal(p0, t);
        const horiz = Math.hypot(c.R + z, x);
        minR = Math.min(minR, horiz);
        minH = Math.min(minH, c.h + y);
        maxExtent = Math.max(maxExtent, Math.hypot(x, y));
      }
    }
    expect(minR).toBeGreaterThan(far.R);
    expect(minH).toBeGreaterThan(highestFar);
    // The flock is a loose cloud, not a line across the sky.
    expect(maxExtent).toBeLessThan(450);
  });

  it("holds 600 to 900 specks and moves slowly", () => {
    expect(MURM.count).toBeGreaterThanOrEqual(600);
    expect(MURM.count).toBeLessThanOrEqual(900);
    // Fastest speck speed in world units per second (no darting).
    let vmax = 0;
    for (let s = 0; s < 120; s++) {
      const p0: [number, number, number] = [lhash(1, s) * 2 - 1, lhash(2, s) * 2 - 1, lhash(3, s) * 2 - 1];
      for (let t = 0; t < 200; t += 0.9) {
        const a = murmurationLocal(p0, t);
        const b = murmurationLocal(p0, t + 0.1);
        vmax = Math.max(vmax, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.1);
      }
    }
    expect(vmax).toBeLessThan(90);
    for (const per of [MURM.pW1, MURM.pW2, MURM.pW3, MURM.pS, MURM.pTilt]) expect(per).toBeGreaterThanOrEqual(13);
  });
});

describe("ridge legibility (Washi)", () => {
  const gold = hexToLinear(0xad7408);
  const teal = hexToLinear(0x16808a);
  const W = LAND.washi;
  const pairs: [string, number[]][] = [];
  W.rings.forEach((c, i) => {
    pairs.push([`ring ${i + 1} body`, hexToLinear(c)]);
    pairs.push([`ring ${i + 1} crest band`, crestLinear(c, W.crest, W.crestOp[i])]);
  });

  for (const [name, col] of pairs) {
    // The designer chose the preview's stronger Washi ridges: the gate is 2.5:1.
    it(`gold and teal keep 2.5:1 or more on the ${name}`, () => {
      expect(contrast(gold, col)).toBeGreaterThanOrEqual(2.5);
      expect(contrast(teal, col)).toBeGreaterThanOrEqual(2.5);
    });
  }

  it("far rings are paler and bluer than near rings", () => {
    const first = hexToLinear(W.rings[0]);
    const last = hexToLinear(W.rings[3]);
    const blueness = (c: number[]): number => c[2] - c[1];
    expect(blueness(last)).toBeGreaterThan(blueness(first));
  });
});

describe("ridge legibility (Dusk)", () => {
  const D = LAND.dusk;
  const pigments = [0xeab64a, 0xb99ae2, 0x5cc2b6, 0xf07c72].map(hexToLinear);
  it("every Dusk pigment keeps 2.8:1 or more on every ring, crest band, and the peak body", () => {
    const cols: number[][] = [];
    D.rings.forEach((c, i) => {
      cols.push(hexToLinear(c), crestLinear(c, D.crest, D.crestOp[i]));
    });
    cols.push(hexToLinear(D.peak), hexToLinear(D.peakTop));
    for (const c of cols) for (const p of pigments) expect(contrast(p, c)).toBeGreaterThanOrEqual(2.8);
  });
});
