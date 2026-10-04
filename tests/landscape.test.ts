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
  murmurationSeed,
  murmurationSpeck,
  MURM_SUBS,
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
  const SEEDS = Array.from({ length: MURM.count }, (_, i) => murmurationSeed(i));
  const TIMES: number[] = [];
  for (let t = 0; t < 600; t += 3.1) TIMES.push(t);

  // The lowest height a speck at (az, R) may take and still clear every ring
  // crest along the ray from a camera at (0, camY, camZ), relative to the
  // landscape center.
  function ridgeFloor(az: number, R: number, camY: number, camZ: number): number {
    const bx = R * Math.sin(az);
    const bz = -R * Math.cos(az);
    const L = Math.hypot(bx, bz - camZ);
    const ux = bx / L;
    const uz = (bz - camZ) / L;
    let need = -Infinity;
    for (const ring of RINGS) {
      const b = uz * camZ;
      const s = -b + Math.sqrt(b * b - (camZ * camZ - ring.R * ring.R));
      const th = Math.atan2(s * ux, -(camZ + s * uz));
      const e = (ridgeHeight(ring, th) - camY) / s;
      need = Math.max(need, camY + e * L);
    }
    return need;
  }
  // Home cameras relative to the landscape center, measured in the app:
  // 1440x900, 1280x720, 1024x600.
  const HOME_CAMS: [number, number][] = [
    [-5, 918],
    [-15, 905],
    [-48, 994],
  ];

  it("the center stays above every ridge crest and beyond the far ring radius", () => {
    for (let t = 0; t < 1200; t += 0.5) {
      const c = murmurationCenter(t);
      expect(c.R).toBeGreaterThan(far.R);
      for (const [cy, cz] of HOME_CAMS) expect(c.h - ridgeFloor(c.az, c.R, cy, cz)).toBeGreaterThan(60);
    }
  });

  it("every speck stays beyond the far ring, above every ridge crest, and under the title block", () => {
    let minR = Infinity;
    let maxH = -Infinity;
    let minAz = Infinity;
    let maxAz = -Infinity;
    let minClear = Infinity;
    for (const t of TIMES) {
      for (const sd of SEEDS) {
        const p = murmurationSpeck(sd, t);
        minR = Math.min(minR, p.R);
        maxH = Math.max(maxH, p.h);
        minAz = Math.min(minAz, p.az);
        maxAz = Math.max(maxAz, p.az);
        for (const [cy, cz] of HOME_CAMS) minClear = Math.min(minClear, p.h - ridgeFloor(p.az, p.R, cy, cz));
      }
    }
    expect(minR).toBeGreaterThan(far.R);
    // Clear of every crest by 20 world units (about 6 px at 1440x900).
    expect(minClear).toBeGreaterThan(20);
    // QA F8: the whole drift envelope stays clear of the title block at the
    // home view (verified at 1440x900, 1280x720, 1024x600).
    expect(maxH).toBeLessThanOrEqual(MURM.envelopeTop);
    expect(minAz).toBeGreaterThan(-62 * (Math.PI / 180));
    expect(maxAz).toBeLessThan(-10 * (Math.PI / 180));
    // A dispersed cloud: at least 25 deg of sky wide.
    expect(maxAz - minAz).toBeGreaterThan(25 * (Math.PI / 180));
  });

  it("never gathers more than 30% of specks in one 60 px disc at 1440x900", () => {
    // Pinhole projection of the 1440x900 home camera (level, fov 50).
    const camY = -5;
    const camZ = 918;
    const k = 450 / Math.tan(25 * (Math.PI / 180));
    const xs = new Float64Array(SEEDS.length);
    const ys = new Float64Array(SEEDS.length);
    let worst = 0;
    for (let t = 0; t < 600; t += 2.3) {
      SEEDS.forEach((sd, i) => {
        const p = murmurationSpeck(sd, t);
        const X = p.R * Math.sin(p.az);
        const Z = -p.R * Math.cos(p.az);
        const D = camZ - Z;
        xs[i] = 720 + (X / D) * k;
        ys[i] = 450 - ((p.h - camY) / D) * k;
      });
      for (let i = 0; i < SEEDS.length; i++) {
        let n = 0;
        for (let j = 0; j < SEEDS.length; j++) {
          const dx = xs[j] - xs[i];
          const dy = ys[j] - ys[i];
          if (dx * dx + dy * dy <= 900) n++;
        }
        worst = Math.max(worst, n / SEEDS.length);
      }
    }
    expect(worst).toBeLessThanOrEqual(0.3);
  });

  it("holds 600 to 900 specks, varies their size, and moves slowly", () => {
    expect(MURM.count).toBeGreaterThanOrEqual(600);
    expect(MURM.count).toBeLessThanOrEqual(900);
    expect(MURM.px0).toBeGreaterThanOrEqual(1.5);
    expect(MURM.px1).toBeLessThanOrEqual(3);
    // Fastest speck speed in world units per second (no darting).
    let vmax = 0;
    for (const sd of SEEDS.slice(0, 200)) {
      for (let t = 0; t < 200; t += 1.3) {
        const a = murmurationSpeck(sd, t);
        const b = murmurationSpeck(sd, t + 0.1);
        const ds = Math.hypot((b.az - a.az) * a.R, b.h - a.h, b.R - a.R);
        vmax = Math.max(vmax, ds / 0.1);
      }
    }
    expect(vmax).toBeLessThan(120);
    // No shape-change period under 20 s.
    const periods = [MURM.pW1, MURM.pW2, MURM.pW3, MURM.pS, MURM.pTilt, MURM.pStream, MURM.jitP0, ...MURM_SUBS.flatMap((s) => [s[0], s[2], s[4]])];
    for (const per of periods) expect(per).toBeGreaterThanOrEqual(20);
    // The sub-flocks split and merge over 30 to 60 s (their azimuth swings).
    for (const s of MURM_SUBS) {
      expect(s[0]).toBeGreaterThanOrEqual(30);
      expect(s[0]).toBeLessThanOrEqual(60);
    }
  });

  it("no two specks share a path", () => {
    const a = murmurationSpeck(SEEDS[0], 50);
    for (const sd of SEEDS.slice(1, 300)) {
      const b = murmurationSpeck(sd, 50);
      expect(Math.abs(b.az - a.az) + Math.abs(b.h - a.h) + Math.abs(b.R - a.R)).toBeGreaterThan(1e-6);
    }
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
