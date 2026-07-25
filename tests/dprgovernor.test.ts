// Pure trajectory tests for the adaptive pixel-ratio governor. No renderer, no
// clock — the governor accumulates its own time from the fed frame deltas, so a
// sequence of deltas determines the cap trajectory exactly.

import { describe, it, expect } from "vitest";
import { createDprGovernor, DEFAULT_DPR_GOVERNOR } from "../src/scene/dprgovernor";

const base = { maxDpr: 2, minDpr: 1.5, ...DEFAULT_DPR_GOVERNOR };

// Feed `count` frames of `frameMs` each; return every non-null cap change.
function feed(gov: ReturnType<typeof createDprGovernor>, frameMs: number, count: number): number[] {
  const changes: number[] = [];
  for (let i = 0; i < count; i++) {
    const r = gov.sample(frameMs);
    if (r !== null) changes.push(r);
  }
  return changes;
}

describe("dpr governor — steady state", () => {
  it("holds maxDpr at a healthy locked 60fps (16.7ms) forever", () => {
    const gov = createDprGovernor(base);
    const changes = feed(gov, 1000 / 60, 60 * 30); // 30s of perfect frames
    expect(changes).toEqual([]);
    expect(gov.current()).toBe(2);
  });

  it("never changes in the dead-band (between restoreMs and degradeMs)", () => {
    const gov = createDprGovernor(base);
    // 19ms ≈ 52fps: a real but mild miss, inside 17.5..22 — must NOT degrade.
    const changes = feed(gov, 19, 60 * 30);
    expect(changes).toEqual([]);
    expect(gov.current()).toBe(2);
  });
});

describe("dpr governor — degrade", () => {
  it("steps the cap down after ~1s of sustained misses", () => {
    const gov = createDprGovernor(base);
    // 25ms ≈ 40fps. windowMs=500 → ~20 frames/window; degradeWindows=2 → ~1s.
    const changes = feed(gov, 25, 200);
    expect(changes[0]).toBe(1.75);
    expect(gov.current()).toBeLessThan(2);
  });

  it("degrades one notch per decision and never below the floor", () => {
    const gov = createDprGovernor(base);
    feed(gov, 30, 60 * 20); // 20s of hard misses — should walk to the floor and stop
    expect(gov.current()).toBe(1.5);
    // Continued load cannot push below the floor.
    const more = feed(gov, 30, 60 * 10);
    expect(more).toEqual([]);
    expect(gov.current()).toBe(1.5);
  });

  it("does not degrade on a single bad window followed by recovery", () => {
    const gov = createDprGovernor(base);
    feed(gov, 25, 20); // one bad window (~500ms) — below degradeWindows=2
    feed(gov, 1000 / 60, 20); // recover
    expect(gov.current()).toBe(2);
  });
});

describe("dpr governor — restore", () => {
  it("restores slowly (one notch) after sustained headroom once degraded", () => {
    const gov = createDprGovernor(base);
    feed(gov, 30, 40); // ~2 bad windows → exactly one notch down, to 1.75
    expect(gov.current()).toBe(1.75);
    // Now hold the vsync lock (16.7ms). restoreWindows=8 → ~4s before a step up.
    const changes = feed(gov, 1000 / 60, 60 * 10);
    expect(changes[0]).toBe(2);
    expect(gov.current()).toBe(2);
  });

  it("never exceeds maxDpr", () => {
    const gov = createDprGovernor(base);
    const changes = feed(gov, 1000 / 60, 60 * 60); // a full minute of perfect frames
    expect(changes).toEqual([]);
    expect(gov.current()).toBe(2);
  });

  it("is asymmetric: degrade is faster than restore", () => {
    const degGov = createDprGovernor(base);
    let framesToDegrade = 0;
    for (let i = 0; i < 100000; i++) {
      framesToDegrade++;
      if (degGov.sample(25) !== null) break;
    }
    const resGov = createDprGovernor(base);
    feed(resGov, 30, 200); // degrade first
    let framesToRestore = 0;
    for (let i = 0; i < 100000; i++) {
      framesToRestore++;
      if (resGov.sample(1000 / 60) !== null) break;
    }
    expect(framesToRestore).toBeGreaterThan(framesToDegrade);
  });
});

describe("dpr governor — robustness", () => {
  it("clamps huge deltas so a tab-thaw stall can't fabricate a downgrade", () => {
    const gov = createDprGovernor(base);
    // A 5s freeze then perfect frames: the clamp caps the stall at 100ms, one
    // frame, which cannot fill even a single window on its own.
    gov.sample(5000);
    const changes = feed(gov, 1000 / 60, 60 * 10);
    expect(changes).toEqual([]);
    expect(gov.current()).toBe(2);
  });

  it("a degenerate range (min >= max) pins at maxDpr and never moves", () => {
    const gov = createDprGovernor({ ...base, minDpr: 2 });
    const changes = feed(gov, 40, 60 * 20); // brutal load
    expect(changes).toEqual([]);
    expect(gov.current()).toBe(2);
  });

  it("does not oscillate across a degrade/restore boundary", () => {
    const gov = createDprGovernor(base);
    // Alternate 4s of misses with 4s of headroom, several times. Because degrade
    // needs 2 bad windows and restore needs 8 good ones, and both reset on any
    // change, the cap must not thrash more than once per phase.
    let flips = 0;
    for (let cycle = 0; cycle < 4; cycle++) {
      for (let i = 0; i < 60 * 4; i++) if (gov.sample(26) !== null) flips++;
      for (let i = 0; i < 60 * 4; i++) if (gov.sample(1000 / 60) !== null) flips++;
    }
    // Over ~1920 fed frames the cap changes only a handful of times (two steps
    // down the first miss phase, then one step each subsequent phase) — a hard
    // ceiling orders of magnitude below the frame count proves no per-frame sizzle.
    expect(flips).toBeLessThanOrEqual(12);
    expect(gov.current()).toBeGreaterThanOrEqual(1.5);
    expect(gov.current()).toBeLessThanOrEqual(2);
  });
});
