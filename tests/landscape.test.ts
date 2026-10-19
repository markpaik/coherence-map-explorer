// Pure math of the Hanga landscape (src/scene/landscape.ts and
// src/scene/landscape/*.ts), which mirrors the GLSL one for one: the ridge
// silhouette and its dry-brush crest, the crane schedule and planform, the quiet
// easing, the murmuration sheet, Fuji's profile, the mist bands, the water
// rows, the placement of the pines and reeds, and the legibility pairs.

import { describe, it, expect } from "vitest";
import {
  RINGS,
  PEAK,
  CRANE,
  CRANE_FORM,
  CRANE_SLOTS,
  CRANE_SKY,
  SHEET,
  LAND,
  QUIET_EASE,
  FUJI,
  FUJI_TONGUES,
  MIST_RINGS,
  WATER,
  REEDS,
  PINES,
  FLORA_FADE,
  FAR_PINE_RING,
  HOME_VIEWS,
  MAP_RADIUS,
  ridgeHeight,
  ringCeiling,
  crestInk,
  pnoise,
  lhash,
  craneGap,
  craneSchedule,
  craneScheduleInto,
  cranePathInto,
  cranePlanform,
  craneFlap,
  easeQuiet,
  murmSheetSeed,
  murmSheetBird,
  murmSheetCenterInto,
  murmSheetLocalInto,
  fujiRadius,
  fujiRim,
  fujiSnowDepth,
  mistBandSd,
  waterRow,
  floraSamples,
  farPines,
  reedBlade,
  groundAt,
  bankProfile,
  bankLobe,
  BANKS,
  MID_PINES,
  MID_PINE_SITES,
  FLOOR_Y,
  projectHome,
  hexToLinear,
  crestLinear,
  contrast,
  type CranePath,
} from "../src/scene/landscape";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

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

  it("the dry-brush crest is solid at the crest and only ever removes ink below it", () => {
    for (let i = 0; i < 400; i++) {
      const ne = lhash(41, i);
      const nh = lhash(42, i);
      expect(crestInk(0, ne, nh)).toBeCloseTo(1, 9);
      let prev = 1;
      for (let d = 0; d <= 200; d += 2) {
        const k = crestInk(d, ne, nh);
        expect(k).toBeGreaterThanOrEqual(0);
        expect(k).toBeLessThanOrEqual(1);
        // The undried bokashi bounds it from above.
        expect(k).toBeLessThanOrEqual(crestInk(d, ne, 1) + 1e-12);
        if (nh >= 0.62) expect(k).toBeLessThanOrEqual(prev + 1e-12);
        prev = k;
      }
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

  it("every path keeps the flight beyond the far ring and above every ridge and Fuji", () => {
    const far = RINGS[RINGS.length - 1];
    const highest = Math.max(...RINGS.map(ringCeiling));
    const p: CranePath = { az0: 0, az1: 0, R: 0, h0: 0, h1: 0, count: 0 };
    const minRise = Math.min(...CRANE_SLOTS.map((s) => s[1])) - 5 - 5; // slot jitter and bob
    for (let k = 0; k < 300; k++) {
      cranePathInto(k, p);
      expect(p.R - CRANE.size).toBeGreaterThan(far.R);
      expect(Math.min(p.h0, p.h1) + minRise - CRANE.size).toBeGreaterThan(highest);
      expect(Math.min(p.h0, p.h1) + minRise - CRANE.size).toBeGreaterThan(PEAK.apex + FUJI.rimH);
      expect(p.count).toBeGreaterThanOrEqual(3);
      expect(p.count).toBeLessThanOrEqual(5);
    }
  });

  it("flies the open sky right of the title block, and above the flock on Dusk", () => {
    const p: CranePath = { az0: 0, az1: 0, R: 0, h0: 0, h1: 0, count: 0 };
    const K = 450 / Math.tan(25 * DEG);
    const minRise = Math.min(...CRANE_SLOTS.map((s) => s[1])) - 10;
    for (const sky of [CRANE_SKY.washi, CRANE_SKY.dusk]) {
      for (let k = 0; k < 300; k++) {
        cranePathInto(k, p);
        p.R *= sky.rMul;
        // Past the fade-in at each end, every bird is right of the title block
        // (its right edge is 696 px at 1440x900).
        for (let i = 0; i <= 50; i++) {
          const q = 0.08 + (0.84 * i) / 50;
          const az = (p.az0 + (p.az1 - p.az0) * q) * sky.mul + sky.add;
          expect(az).toBeGreaterThan(-1 * DEG);
          expect(az).toBeLessThan(85 * DEG);
          const D = 918 + p.R * Math.cos(az);
          if (D > 0) expect(720 + ((p.R * Math.sin(az)) / D) * K).toBeGreaterThan(696 + 20);
        }
      }
    }
    // Dusk, at the home view: the lowest crane flies above the flock's core
    // (all but the top 2% of its sheet birds; the stragglers scatter through
    // the whole sky by design), and the highest crane stays on screen.
    const seeds = Array.from({ length: SHEET.count }, (_, i) => murmSheetSeed(i)).filter((sd) => !sd.fringe);
    const ys: number[] = [];
    const b = { az: 0, R: 0, h: 0 };
    for (let t = 0; t < 600; t += 6.7) {
      for (const sd of seeds) {
        murmSheetBird(sd, t, b);
        ys.push(450 - ((b.h + 5) / (918 + b.R * Math.cos(b.az))) * K);
      }
    }
    ys.sort((x, y) => x - y);
    const flockTop = ys[Math.floor(ys.length * 0.02)];
    const D = CRANE_SKY.dusk;
    const lowRise = Math.min(...CRANE_SLOTS.map((s) => s[1])) * D.riseMul - 10;
    const highRise = Math.max(...CRANE_SLOTS.map((s) => s[1])) * D.riseMul + 10;
    let lowest = -Infinity;
    let highest = Infinity;
    for (let k = 0; k < 300; k++) {
      cranePathInto(k, p);
      for (let i = 0; i <= 40; i++) {
        const q = 0.08 + (0.84 * i) / 40;
        const az = (p.az0 + (p.az1 - p.az0) * q) * D.mul + D.add;
        const R = p.R * D.rMul;
        const Dd = 918 + R * Math.cos(az);
        const h = CRANE.h + (p.h0 + (p.h1 - p.h0) * q - CRANE.h) * D.hMul + D.hAdd;
        lowest = Math.max(lowest, 450 - ((h + lowRise - CRANE.size + 5) / Dd) * K);
        highest = Math.min(highest, 450 - ((h + highRise + CRANE.size + 5) / Dd) * K);
      }
    }
    expect(minRise).toBeLessThan(0);
    expect(lowest).toBeLessThan(flockTop);
    expect(highest).toBeGreaterThan(0);
  });

  it("the wingspan is 18 to 24 px at the home view", () => {
    // The crossing's nearest and farthest distance from the 1440x900 home camera.
    const k = 450 / Math.tan(25 * DEG);
    // Across the part of the arc that is on screen (about +-40 deg).
    for (const az of [-40 * DEG, 0, 40 * DEG]) {
      for (const R of [CRANE.R, CRANE.R + CRANE.RSpan]) {
        const D = Math.hypot(R * Math.sin(az), 918 + R * Math.cos(az), CRANE.h);
        const span = ((2 * CRANE.size) / D) * k;
        expect(span).toBeGreaterThanOrEqual(18 * 0.9);
        expect(span).toBeLessThanOrEqual(30);
      }
    }
    const Dmid = Math.hypot(918 + CRANE.R + CRANE.RSpan / 2, CRANE.h);
    const mid = ((2 * CRANE.size) / Dmid) * k;
    expect(mid).toBeGreaterThanOrEqual(18);
    expect(mid).toBeLessThanOrEqual(24);
  });
});

describe("crane planform", () => {
  const F = CRANE_FORM;
  const phases: number[] = [];
  for (let i = 0; i < 48; i++) phases.push((i / 48) * TAU);
  const elevations = [-0.6, -0.2, 0, 0.16, 0.3, 0.9];

  it("keeps every chord parallel to the body and only the span foreshortens", () => {
    for (const ph of phases) {
      for (const e of elevations) {
        for (const near of [true, false]) {
          const w = cranePlanform(ph, e, near);
          // Each chord line is one height: the chord is parallel to the body (u).
          expect(w.root.v).toBe(0);
          // The chords keep their length at every flap angle.
          expect(w.root.le - w.root.te).toBeCloseTo(F.rootLE - F.rootTE, 12);
          expect(w.wrist.le - w.wrist.te).toBeCloseTo(F.wristLE - F.wristTE, 12);
          expect(w.tip.le - w.tip.te).toBeCloseTo(F.tipLE - F.tipTE, 12);
          // The span is never longer than the wing.
          expect(Math.abs(w.wrist.v)).toBeLessThanOrEqual(F.arm + 1e-12);
          expect(Math.abs(w.tip.v - w.wrist.v)).toBeLessThanOrEqual(F.hand + 1e-12);
        }
      }
    }
  });

  it("is long and broad, with a swept hand", () => {
    expect(F.arm + F.hand).toBeCloseTo(1, 9);
    const rootChord = F.rootLE - F.rootTE;
    expect(rootChord).toBeGreaterThan(0.24);
    expect(rootChord).toBeLessThan(0.34);
    expect(F.tipLE - F.tipTE).toBeLessThan(rootChord);
    expect(F.tipLE).toBeLessThan(F.wristLE);
  });

  it("confines the black block to the inner trailing edge: the primaries stay white", () => {
    for (const ph of phases) {
      for (const e of elevations) {
        const w = cranePlanform(ph, e, true);
        // The block runs out to the wrist and never past it.
        expect(w.block.v1).toBe(w.wrist.v);
        expect(Math.abs(w.block.v0)).toBeLessThanOrEqual(Math.abs(w.block.v1));
        expect(Math.sign(w.block.v0) * Math.sign(w.block.v1)).toBeGreaterThanOrEqual(0);
        // It fills the rear half of the chord, never the leading edge.
        expect(w.block.frac).toBeGreaterThan(0.35);
        expect(w.block.frac).toBeLessThan(0.65);
      }
    }
  });

  it("beats once per 2.5 s, deep, with the hand lagging and swinging further", () => {
    expect(CRANE.wingPeriod).toBe(2.5);
    let aMin = Infinity;
    let aMax = -Infinity;
    let hMin = Infinity;
    let hMax = -Infinity;
    for (const ph of phases) {
      const [a, h] = craneFlap(ph);
      aMin = Math.min(aMin, a);
      aMax = Math.max(aMax, a);
      hMin = Math.min(hMin, h);
      hMax = Math.max(hMax, h);
    }
    expect(aMax - aMin).toBeGreaterThan(70 * DEG);
    expect(hMax - hMin).toBeGreaterThan(aMax - aMin);
    // Every bird is at its own phase of the stroke.
    const ph = CRANE_SLOTS.map((s) => s[2]);
    expect(new Set(ph).size).toBe(ph.length);
  });

  it("from below, the near and far wings separate", () => {
    for (const ph of phases) {
      const n = cranePlanform(ph, 0.25, true);
      const f = cranePlanform(ph, 0.25, false);
      expect(n.wrist.v).toBeGreaterThan(f.wrist.v);
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

describe("murmuration sheet", () => {
  const far = RINGS[RINGS.length - 1];
  const SEEDS = Array.from({ length: SHEET.count }, (_, i) => murmSheetSeed(i));
  const TIMES: number[] = [];
  for (let t = 0; t < 600; t += 7.3) TIMES.push(t);
  const K = 450 / Math.tan(25 * DEG);
  const bird = { az: 0, R: 0, h: 0 };
  // Pinhole projection of the 1440x900 home camera (level, fov 50).
  function screen(sd: (typeof SEEDS)[number], t: number): [number, number] {
    murmSheetBird(sd, t, bird);
    const D = 918 + bird.R * Math.cos(bird.az);
    return [720 + ((bird.R * Math.sin(bird.az)) / D) * K, 450 - ((bird.h + 5) / D) * K];
  }

  // The lowest height a speck at (az, R) may take and still clear every ring
  // crest along the ray from a camera at (0, camY, camZ).
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

  it("holds 1100 to 1400 birds as chevrons, a quarter of them stragglers", () => {
    expect(SHEET.count).toBeGreaterThanOrEqual(1100);
    expect(SHEET.count).toBeLessThanOrEqual(1400);
    expect(SHEET.px0).toBeGreaterThanOrEqual(2);
    expect(SHEET.px1).toBeLessThanOrEqual(4);
    const fringe = SEEDS.filter((s) => s.fringe === 1).length / SEEDS.length;
    expect(fringe).toBeGreaterThan(0.2);
    expect(fringe).toBeLessThan(0.3);
    for (const s of SEEDS) {
      if (s.fringe) {
        // Well outside the sheet's edge.
        expect(Math.abs(s.b)).toBeGreaterThan(1.04);
        expect(Math.abs(s.a)).toBeLessThanOrEqual(SHEET.strayA);
      } else {
        expect(Math.abs(s.b)).toBeLessThanOrEqual(1);
        expect(Math.abs(s.a)).toBeLessThanOrEqual(1);
      }
    }
    // Still a sheet: thinner than it is wide, and wider than before.
    expect(SHEET.T * 2).toBeLessThan(SHEET.W);
    expect(SHEET.L).toBeGreaterThanOrEqual(1000);
    expect(SHEET.W).toBeGreaterThanOrEqual(250);
  });

  it("is uneven inside: a dense core, clumps, and thin gaps", () => {
    const sheet = SEEDS.filter((s) => !s.fringe);
    // A 10 x 6 grid over the sheet's (a, b) square.
    const NA = 10;
    const NB = 6;
    const cells = new Array(NA * NB).fill(0);
    for (const s of sheet) {
      const i = Math.min(NA - 1, Math.floor(((s.a + 1) / 2) * NA));
      const j = Math.min(NB - 1, Math.floor(((s.b + 1) / 2) * NB));
      cells[i * NB + j]++;
    }
    const mean = sheet.length / cells.length;
    const sd = Math.sqrt(cells.reduce((t, c) => t + (c - mean) ** 2, 0) / cells.length);
    // Far from uniform (a uniform scatter gives sd / mean of about 0.2 here).
    expect(sd / mean).toBeGreaterThan(0.5);
    // Thin gaps: some cells hold under a third of the mean.
    expect(cells.filter((c) => c < mean / 3).length).toBeGreaterThanOrEqual(4);
    // A dense core: the core region holds at least twice the sheet's mean density.
    const inCore = (s: (typeof SEEDS)[number]): boolean =>
      ((s.a - SHEET.coreA) / SHEET.coreRA) ** 2 + (s.b / SHEET.coreRB) ** 2 < 1;
    const coreArea = Math.PI * SHEET.coreRA * SHEET.coreRB;
    const coreDensity = sheet.filter(inCore).length / coreArea;
    expect(coreDensity).toBeGreaterThan((2 * sheet.length) / 4);
  });

  it("the center stays beyond the far ring radius", () => {
    const c = { az: 0, R: 0, h: 0 };
    for (let t = 0; t < 1200; t += 0.5) expect(murmSheetCenterInto(t, c).R).toBeGreaterThan(far.R);
  });

  it("stays in open sky right of the title block and above the bottom chrome", () => {
    let minR = Infinity;
    let minAz = Infinity;
    let maxAz = -Infinity;
    let minX = Infinity;
    let maxY = -Infinity;
    let inBand = 0;
    let below = 0;
    let n = 0;
    const HOME_CAMS: [number, number][] = HOME_VIEWS.map((v) => [v.camY, v.camZ]);
    // The 1280x720 home camera too: the title block ends at x 696 there.
    const K2 = 360 / Math.tan(25 * DEG);
    let minX2 = Infinity;
    let maxY2 = -Infinity;
    for (const t of TIMES) {
      for (const sd of SEEDS) {
        const [x, y] = screen(sd, t);
        const D2 = 889 + bird.R * Math.cos(bird.az);
        minX2 = Math.min(minX2, 640 + ((bird.R * Math.sin(bird.az)) / D2) * K2);
        maxY2 = Math.max(maxY2, 360 - ((bird.h + 10) / D2) * K2);
        minR = Math.min(minR, bird.R);
        minAz = Math.min(minAz, bird.az);
        maxAz = Math.max(maxAz, bird.az);
        minX = Math.min(minX, x);
        maxY = Math.max(maxY, y);
        if (y >= -60 && y <= 400) inBand++;
        if (HOME_CAMS.some(([cy, cz]) => bird.h < ridgeFloor(bird.az, bird.R, cy, cz))) below++;
        n++;
      }
    }
    expect(minR).toBeGreaterThan(far.R);
    // Right of the map's center, clear of the title block (right edge 696 px).
    expect(minAz).toBeGreaterThan(5 * DEG);
    expect(maxAz).toBeLessThan(60 * DEG);
    expect(minX).toBeGreaterThan(700);
    expect(minX2).toBeGreaterThan(700);
    // Spread over the upper sky, and nowhere near the Style card or pose control.
    expect(inBand / n).toBeGreaterThan(0.98);
    expect(maxY).toBeLessThan(560);
    expect(maxY2).toBeLessThan(470);
    // It spans much of the sky: at least 30 deg of azimuth.
    expect(maxAz - minAz).toBeGreaterThan(30 * DEG);
    expect(below / n).toBeLessThan(0.02);
  });

  it("never gathers more than 15% of the flock in one 60 px disc", () => {
    const xs = new Float64Array(SEEDS.length);
    const ys = new Float64Array(SEEDS.length);
    let worst = 0;
    for (let t = 0; t < 400; t += 23.1) {
      SEEDS.forEach((sd, i) => {
        const [x, y] = screen(sd, t);
        xs[i] = x;
        ys[i] = y;
      });
      for (let i = 0; i < SEEDS.length; i += 3) {
        let disc = 0;
        for (let j = 0; j < SEEDS.length; j++) {
          const dx = xs[j] - xs[i];
          const dy = ys[j] - ys[i];
          if (dx * dx + dy * dy <= 900) disc++;
        }
        worst = Math.max(worst, disc / SEEDS.length);
      }
    }
    expect(worst).toBeLessThanOrEqual(0.15);
    // Yet it reads as one flock: some disc holds 4% or more.
    expect(worst).toBeGreaterThan(0.04);
  });

  it("moves slowly and turns over no faster than once per 20 s", () => {
    let vmax = 0;
    const a = { az: 0, R: 0, h: 0 };
    const b = { az: 0, R: 0, h: 0 };
    for (const sd of SEEDS.slice(0, 300)) {
      for (let t = 0; t < 200; t += 1.3) {
        murmSheetBird(sd, t, a);
        murmSheetBird(sd, t + 0.1, b);
        const ds = Math.hypot((b.az - a.az) * a.R, b.h - a.h, b.R - a.R);
        vmax = Math.max(vmax, ds / 0.1);
      }
    }
    expect(vmax).toBeLessThan(120);
    const S = SHEET;
    const periods = [S.pTwist0, S.pTwist1, S.pBendY, S.pBendZ, S.pYaw, S.pPitch, S.pAz1, S.pAz2, S.pR, S.pH, S.jitP0];
    for (const p of periods) expect(p).toBeGreaterThanOrEqual(20);
    // The shape itself turns over across 20 to 60 s.
    for (const p of [S.pTwist0, S.pTwist1, S.pBendY, S.pBendZ, S.pYaw, S.pPitch]) expect(p).toBeLessThanOrEqual(60);
  });

  it("no two birds share a path", () => {
    const a = murmSheetBird(SEEDS[0], 50, { az: 0, R: 0, h: 0 });
    const b = { az: 0, R: 0, h: 0 };
    for (const sd of SEEDS.slice(1, 400)) {
      murmSheetBird(sd, 50, b);
      expect(Math.abs(b.az - a.az) + Math.abs(b.h - a.h) + Math.abs(b.R - a.R)).toBeGreaterThan(1e-6);
    }
  });
});

describe("Fuji", () => {
  it("has a concave flank: the radius grows with depth, faster and faster", () => {
    let prevR = fujiRadius(0);
    let prevSlope = 0;
    for (let d = 5; d <= FUJI.dMax; d += 5) {
      const r = fujiRadius(d);
      const slope = (r - prevR) / 5;
      expect(r).toBeGreaterThan(prevR);
      expect(slope).toBeGreaterThan(prevSlope - 1e-9);
      prevR = r;
      prevSlope = slope;
    }
    // Steep near the summit (about 35 to 45 deg), gentle at the fade (under 25 deg).
    const top = Math.atan(1 / ((fujiRadius(10) - fujiRadius(0)) / 10)) / DEG;
    const low = Math.atan(1 / ((fujiRadius(FUJI.fade1) - fujiRadius(FUJI.fade1 - 10)) / 10)) / DEG;
    expect(top).toBeGreaterThan(35);
    expect(top).toBeLessThan(45);
    expect(low).toBeLessThan(25);
  });

  it("has a near-flat summit with low crater bumps, and wide shoulders", () => {
    expect(FUJI.rTop / fujiRadius(FUJI.fade1)).toBeLessThan(0.08);
    for (let i = 0; i < 720; i++) {
      const h = fujiRim((i / 720) * TAU);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(FUJI.rimH);
    }
  });

  it("stands where the old peak stood", () => {
    expect(FUJI.az).toBeCloseTo(-33 * DEG, 12);
    expect(FUJI.R).toBe(3400);
    expect(PEAK.az).toBe(FUJI.az);
  });

  it("snow tongues are narrow gully streaks below a ragged snow line", () => {
    for (const [, w, len] of FUJI_TONGUES) {
      expect(w).toBeLessThan(3 * DEG);
      expect(len).toBeGreaterThan(30);
      expect(len).toBeLessThan(310);
    }
    for (let i = 0; i < 720; i++) {
      const d = fujiSnowDepth((i / 720) * TAU);
      expect(d).toBeGreaterThanOrEqual(FUJI.snow - 13);
      expect(d).toBeLessThan(FUJI.fade0);
    }
  });
});

describe("mist bands", () => {
  it("have flat bottoms, flat tops, and lobed ends inside their span", () => {
    for (const mr of MIST_RINGS) {
      for (const b of mr.bands) {
        const L = b.halfSpan * mr.R;
        // Inside at the middle.
        expect(mistBandSd(b, mr.R, 0, b.th / 2)).toBeLessThan(0);
        for (let i = -60; i <= 60; i++) {
          const X = (i / 60) * (L + b.th);
          // Nothing below the flat bottom or above the flat top.
          expect(mistBandSd(b, mr.R, X, -0.5)).toBeGreaterThan(0);
          expect(mistBandSd(b, mr.R, X, b.th + 0.5)).toBeGreaterThan(0);
        }
        // The top is flat across the middle: the full height everywhere there.
        for (let i = -10; i <= 10; i++) {
          const X = (i / 10) * (L - b.th);
          expect(mistBandSd(b, mr.R, X, b.th - 0.5)).toBeLessThan(0);
        }
        // The ends stay inside the span plus a quarter height.
        for (let i = 0; i <= 20; i++) {
          const y = (i / 20) * b.th;
          expect(mistBandSd(b, mr.R, L + 0.25 * b.th, y)).toBeGreaterThan(0);
          expect(mistBandSd(b, mr.R, -(L + 0.25 * b.th), y)).toBeGreaterThan(0);
        }
        // Lobed: the end steps down, so near the end the band is lower.
        expect(mistBandSd(b, mr.R, L - 0.1 * b.th, b.th * 0.9)).toBeGreaterThan(0);
        expect(mistBandSd(b, mr.R, L - 0.1 * b.th, b.th * 0.2)).toBeLessThan(0);
      }
    }
  });

  it("sit at three depths between the rings, and bands in one ring never overlap", () => {
    expect(MIST_RINGS.length).toBe(3);
    for (const mr of MIST_RINGS) {
      const inside = RINGS.filter((r) => r.R < mr.R).length;
      expect(inside).toBeGreaterThanOrEqual(1);
      expect(inside).toBeLessThanOrEqual(3);
      const spans = mr.bands.map((b) => [b.az - b.halfSpan - (0.25 * b.th) / mr.R, b.az + b.halfSpan + (0.25 * b.th) / mr.R]);
      for (let i = 0; i < spans.length; i++) {
        for (let j = i + 1; j < spans.length; j++) {
          const [a0, a1] = spans[i];
          const [b0, b1] = spans[j];
          const overlap = a0 < b1 && b0 < a1;
          expect(overlap).toBe(false);
        }
      }
      // Slow drift: one turn takes 25 minutes or longer.
      expect(1 / Math.abs(mr.rate)).toBeGreaterThanOrEqual(1500);
    }
  });
});

describe("water", () => {
  it("rows recede toward the far shore with gaps growing toward the viewer", () => {
    let prevGap = 0;
    for (let k = 1; k < WATER.rows; k++) {
      const gap = waterRow(k - 1) - waterRow(k);
      expect(gap).toBeGreaterThan(prevGap);
      prevGap = gap;
    }
    expect(waterRow(0)).toBeLessThan(RINGS[0].R);
    expect(waterRow(WATER.rows - 1)).toBeGreaterThan(RINGS[0].R * 0.75);
  });

  it("strokes are short and drift very slowly (a cell takes a minute or more)", () => {
    const cellRad = WATER.cell / waterRow(0);
    expect(cellRad / WATER.drift).toBeGreaterThanOrEqual(60);
    expect(WATER.sag).toBeLessThan(WATER.cell / 4);
  });
});

describe("pines and reeds", () => {
  // Chrome rectangles measured in the app at the three home views (CSS px):
  // the title block, the search rail, the nav hints, the Style card, the pose
  // control, and the filter rail.
  const CHROME: Record<number, number[][]> = {
    1440: [
      [36, 27, 696, 343],
      [297, 602, 1143, 648],
      [1144, 720, 1412, 743],
      [970, 749, 1219, 838],
      [1225, 786, 1412, 838],
      [94, 844, 1346, 884],
    ],
    1280: [
      [36, 22, 696, 337],
      [217, 472, 1063, 518],
      [984, 540, 1252, 563],
      [810, 569, 1059, 658],
      [1065, 606, 1252, 658],
      [14, 664, 1266, 704],
    ],
    1024: [
      [31, 18, 657, 253],
      [89, 331, 935, 377],
      [731, 389, 998, 412],
      [556, 418, 805, 507],
      [812, 455, 998, 507],
      [78, 513, 947, 584],
    ],
  };
  const S = floraSamples();

  it("stand outside the map's radius and inside the second ring", () => {
    for (const s of S) {
      const r = Math.hypot(s.x, s.z);
      expect(r).toBeGreaterThan(MAP_RADIUS + 80);
      expect(r).toBeLessThan(RINGS[1].R - 100);
    }
  });

  it("grow out of the ground: every pine and every reed is rooted on a bank or the first ridge", () => {
    for (const p of PINES) {
      const g = groundAt(p.x, p.z);
      const onBank = Math.abs(p.base - g) < 1 && g > FLOOR_Y + 10;
      const r = Math.hypot(p.x, p.z);
      const th = Math.atan2(p.x, -p.z);
      const onRidge = Math.abs(r - RINGS[0].R) < 20 && Math.abs(p.base - (ridgeHeight(RINGS[0], th) - 14)) < 1;
      expect(onBank || onRidge, `pine at ${p.x}, ${p.z}`).toBe(true);
    }
    for (let i = 0; i < REEDS.count; i++) {
      const b = reedBlade(i);
      const g = groundAt(b.x, b.z);
      // On the reed bank's top, above the water, and rooted into it.
      expect(g).toBeGreaterThan(FLOOR_Y + 50);
      expect(b.y).toBeLessThan(g);
      expect(g - b.y).toBeLessThan(8);
    }
    // Banks rise from the water: the profile meets the floor at the waterline.
    for (const bk of BANKS) {
      expect(bankProfile(bk, 1)).toBe(FLOOR_Y);
      expect(bankProfile(bk, 0)).toBe(bk.top);
      expect(bk.top).toBeGreaterThan(FLOOR_Y);
      expect(bk.top - FLOOR_Y).toBeLessThan(200);
      // The whole bank lies on the water, inside the near ring.
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * TAU;
        const lu = bk.rx * bankLobe(bk, a) * Math.cos(a);
        const lv = bk.rz * bankLobe(bk, a) * Math.sin(a);
        const x = bk.x + lu * Math.cos(bk.rot) - lv * Math.sin(bk.rot);
        const z = bk.z + lu * Math.sin(bk.rot) + lv * Math.cos(bk.rot);
        expect(Math.hypot(x, z)).toBeLessThan(RINGS[0].R - 2);
      }
      let prev = Infinity;
      for (let u = 0; u <= 1; u += 0.02) {
        const y = bankProfile(bk, u);
        expect(y).toBeLessThanOrEqual(prev + 1e-9);
        prev = y;
      }
    }
  });

  it("adds four to six middle-ground pines at a range of sizes, clear of the map body at home", () => {
    expect(MID_PINES.length).toBeGreaterThanOrEqual(4);
    expect(MID_PINES.length).toBeLessThanOrEqual(6);
    const sizes = MID_PINE_SITES.map((st) => st.s);
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThan(2);
    for (const v of HOME_VIEWS) {
      // The map body's screen rect: its bounds at mid depth.
      const m = [Infinity, Infinity, -Infinity, -Infinity];
      for (const x of [-481, 482]) {
        for (const y of [-216, 216]) {
          const c = projectHome(v, x, y, 0)!;
          m[0] = Math.min(m[0], c[0]);
          m[1] = Math.min(m[1], c[1]);
          m[2] = Math.max(m[2], c[0]);
          m[3] = Math.max(m[3], c[1]);
        }
      }
      const k = v.h / 2 / Math.tan(25 * DEG);
      for (const s of S) {
        if (s.group !== "mid") continue;
        const c = projectHome(v, s.x, s.y, s.z);
        if (!c) continue;
        const D = v.camZ - s.z;
        const hw = (s.hw / D) * k;
        const hh = (s.hh / D) * k;
        const hit = c[0] + hw > m[0] && c[0] - hw < m[2] && c[1] + hh > m[1] && c[1] - hh < m[3];
        expect(hit, `mid ${s.kind} at ${v.w}x${v.h}`).toBe(false);
      }
    }
  });

  it("frame the home view: on screen at the left and right edges", () => {
    for (const v of HOME_VIEWS) {
      let left = 0;
      let right = 0;
      for (const s of S) {
        const c = projectHome(v, s.x, s.y, s.z);
        if (!c || c[0] < 0 || c[0] > v.w || c[1] < 0 || c[1] > v.h) continue;
        if (c[0] < v.w * 0.2) left++;
        if (c[0] > v.w * 0.8) right++;
      }
      expect(left).toBeGreaterThan(10);
      expect(right).toBeGreaterThan(3);
    }
  });

  it("keep clear of the title block and the chrome at 1440x900, 1280x720, and 1024x600", () => {
    for (const v of HOME_VIEWS) {
      const k = v.h / 2 / Math.tan(25 * DEG);
      for (const s of S) {
        const c = projectHome(v, s.x, s.y, s.z);
        if (!c) continue;
        const D = v.camZ - s.z;
        const hw = (s.hw / D) * k;
        const hh = (s.hh / D) * k;
        const box = [c[0] - hw, c[1] - hh, c[0] + hw, c[1] + hh];
        if (box[2] < 0 || box[0] > v.w || box[3] < 0 || box[1] > v.h) continue;
        // The reeds and the pine on their bank grow at the bottom edge, so at
        // 1024x600 their roots may pass behind the filter rail (the last CHROME
        // rect). The framing pines keep clear of it too.
        const rects = s.group === "frame" ? CHROME[v.w] : CHROME[v.w].slice(0, -1);
        for (const R of rects) {
          const m = 6;
          const hit = box[2] > R[0] - m && box[0] < R[2] + m && box[3] > R[1] - m && box[1] < R[3] + m;
          expect(hit, `${s.kind} at ${v.w}x${v.h} hits [${R}]`).toBe(false);
        }
      }
    }
  });

  it("pine bases fade softly and pads sit above the trunk's soft base", () => {
    expect(FLORA_FADE).toBeLessThanOrEqual(30);
    for (const p of PINES) {
      for (const [, dy] of p.pads) expect(dy).toBeGreaterThan(FLORA_FADE);
      expect(p.trunk[0]).toEqual([0, 0, 0]);
    }
  });

  it("distant pines sit on ring 3's crest", () => {
    const ring = RINGS[FAR_PINE_RING];
    const fp = farPines();
    expect(fp.length).toBeGreaterThanOrEqual(15);
    for (const p of fp) {
      expect(Math.abs(p.y - ridgeHeight(ring, p.theta))).toBeLessThan(8);
      expect(p.h).toBeLessThan(80);
    }
  });

  it("reeds: strap leaves and panicles, a very slow sway", () => {
    let panicles = 0;
    for (let i = 0; i < REEDS.count; i++) {
      const b = reedBlade(i);
      if (b.kind === 1) panicles++;
      expect(b.h).toBeGreaterThan(30);
      expect(Math.abs(b.lean)).toBeLessThan(0.45);
    }
    expect(panicles / REEDS.count).toBeGreaterThan(0.25);
    expect(panicles / REEDS.count).toBeLessThan(0.55);
    expect(REEDS.pSway0).toBeGreaterThanOrEqual(8);
    expect(REEDS.pSway1).toBeGreaterThanOrEqual(8);
    expect(REEDS.sway).toBeLessThan(0.08);
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
    for (let i = 1; i < 4; i++) {
      const a = hexToLinear(W.rings[i - 1]);
      const b = hexToLinear(W.rings[i]);
      expect(0.2126 * b[0] + 0.7152 * b[1] + 0.0722 * b[2]).toBeGreaterThan(0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]);
    }
  });
});

describe("ridge legibility (Dusk)", () => {
  const D = LAND.dusk;
  const pigments = [0xeab64a, 0xb99ae2, 0x5cc2b6, 0xf07c72].map(hexToLinear);
  it("every Dusk pigment keeps 2.8:1 or more on every ring, crest band, and Fuji's body", () => {
    const cols: number[][] = [];
    D.rings.forEach((c, i) => {
      cols.push(hexToLinear(c), crestLinear(c, D.crest, D.crestOp[i]));
    });
    cols.push(hexToLinear(D.peak), hexToLinear(D.peakTop), hexToLinear(D.peakBase));
    for (const c of cols) for (const p of pigments) expect(contrast(p, c)).toBeGreaterThanOrEqual(2.8);
  });
});
