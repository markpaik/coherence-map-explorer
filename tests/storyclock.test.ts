// Story Pause holds the map still (stories/storyclock.ts).
//
// Mark (round 14): when a story is paused, the struggle breath, the flow
// comets, and the beacon ring breathing all stop, and Resume continues from the
// same phase with no jump. Every one of those layers reads main.ts's scene
// clock, so the rule lives in one place: the clock stops while a PAUSED story's
// scene has SETTLED, and a stopped frame never moves the time. Outside a story
// nothing changes. Reduced motion already stops the clock and composes with it.

import { describe, it, expect } from "vitest";
import { Vector3, type InstancedBufferGeometry } from "three";
import { createSceneClock, storyPauseFreezes, type StoryClockState } from "../src/stories/storyclock";
import { createBeacons } from "../src/scene/beacons";
import { struggleBreath } from "../src/scene/nodes";
import type { GraphCore } from "../src/data";
import type { NodesHandle } from "../src/scene/nodes";
import type { BeaconTarget } from "../src/stories/contagion";

const state = (running: boolean, paused: boolean, settled: boolean): StoryClockState => ({
  running,
  paused,
  settled,
});

describe("the pause rule", () => {
  it("holds the clock only for a running, paused, settled story", () => {
    expect(storyPauseFreezes(state(true, true, true))).toBe(true);
    // A paused scene still plays its own transition, crossfade, or reveal.
    expect(storyPauseFreezes(state(true, true, false))).toBe(false);
    // A playing story runs, and outside a story nothing changes.
    expect(storyPauseFreezes(state(true, false, true))).toBe(false);
    expect(storyPauseFreezes(state(false, true, true))).toBe(false);
    expect(storyPauseFreezes(state(false, false, false))).toBe(false);
  });
});

describe("the scene clock", () => {
  it("holds the exact time while stopped and resumes from it with no jump", () => {
    const clock = createSceneClock();
    const dt = 1 / 60;
    for (let k = 0; k < 90; k++) clock.advance(dt, false);
    const held = clock.time;
    // Five seconds paused: not one tick of drift.
    for (let k = 0; k < 300; k++) expect(clock.advance(dt, true)).toBe(held);
    // Resume: the first running frame moves by exactly one frame, not by the pause.
    expect(clock.advance(dt, false)).toBeCloseTo(held + dt, 12);
  });

  it("gives the struggle breath no jump across a pause (continuous phase)", () => {
    const clock = createSceneClock(12.3);
    const phase = 2.1;
    const before = struggleBreath(clock.time, phase);
    for (let k = 0; k < 600; k++) clock.advance(1 / 60, true); // 10 s paused
    expect(struggleBreath(clock.time, phase)).toBe(before);
    const after = struggleBreath(clock.advance(1 / 60, false), phase);
    // One frame of a 4.5 s sine moves it by at most 2π/4.5/60 ≈ 0.023.
    expect(Math.abs(after - before)).toBeLessThan(0.025);
  });

  it("drives a whole story frame loop: runs in transit, holds when settled, resumes", () => {
    const clock = createSceneClock();
    const frames: Array<{ paused: boolean; settled: boolean }> = [
      ...Array(30).fill({ paused: false, settled: true }), // playing
      ...Array(30).fill({ paused: true, settled: false }), // paused, scene still in transit
      ...Array(60).fill({ paused: true, settled: true }), // paused and settled: hold
      ...Array(30).fill({ paused: false, settled: true }), // resumed
    ];
    const times = frames.map((f) => clock.advance(0.1, storyPauseFreezes(state(true, f.paused, f.settled))));
    expect(times[29]).toBeCloseTo(3.0, 9); // 30 frames played
    expect(times[59]).toBeCloseTo(6.0, 9); // the paused transition still ran
    expect(new Set(times.slice(60, 120)).size).toBe(1); // held for 60 frames
    expect(times[119]).toBeCloseTo(6.0, 9);
    expect(times[120]).toBeCloseTo(6.1, 9); // resume: one frame, no jump
  });
});

describe("beacon rings on a story pause", () => {
  function rig() {
    const nodes = {
      getPosition: (i: number, out: Vector3) => out.set(i, 0, 0),
    } as unknown as NodesHandle;
    const beacons = createBeacons({} as GraphCore, nodes, new Float32Array(480).fill(2));
    const geo = beacons.object.geometry as InstancedBufferGeometry;
    const uniforms = (beacons.object.material as unknown as { uniforms: Record<string, { value: number }> })
      .uniforms;
    const shown = (): number[] => {
      const ap = geo.getAttribute("aAppear").array as Float32Array;
      const t = uniforms.uTime.value;
      const fade = uniforms.uFadeSec.value;
      const out: number[] = [];
      for (let k = 0; k < geo.instanceCount; k++) out.push(Math.min(1, Math.max(0, (t - ap[k]) / fade)));
      return out;
    };
    return { beacons, shown, uniforms };
  }
  const WAVE: BeaconTarget[] = [
    { index: 0, intensity: 1, hop: 0 },
    { index: 1, intensity: 0.4, hop: 2 },
    { index: 2, intensity: 0.2, hop: 5 },
  ];

  it("lands a wave the pause caught mid-flight, so no ring stays dark while paused", () => {
    const { beacons, shown } = rig();
    beacons.setTime(10);
    beacons.setTargets(WAVE, { delta: true });
    beacons.setTime(10.3); // the hole is up, the downstream rings are still coming
    beacons.landStaged(); // the frame the pause hold begins
    expect(shown()).toEqual([1, 1, 1]);
  });

  it("still stages a later wave normally (unlike a reduced-motion freeze)", () => {
    const { beacons, shown } = rig();
    beacons.setTime(10);
    beacons.setTargets(WAVE.slice(0, 1), { delta: true });
    beacons.landStaged();
    // A year switch while paused adds rings: they wave in once the clock runs.
    beacons.setTargets(WAVE, { delta: true });
    expect(shown()[0]).toBe(1); // the held ring holds
    expect(shown()[2]).toBeLessThan(1); // the new far ring waits for its hop
    beacons.setTime(12);
    expect(shown()).toEqual([1, 1, 1]);
  });

  it("the ring breath holds still on a held clock (it reads only uTime)", () => {
    const { beacons, uniforms } = rig();
    const clock = createSceneClock(4);
    beacons.setTime(clock.time);
    const t0 = uniforms.uTime.value;
    for (let k = 0; k < 300; k++) beacons.setTime(clock.advance(1 / 60, true));
    expect(uniforms.uTime.value).toBe(t0);
  });
});
