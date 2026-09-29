// Beacon rings on a FROZEN clock (reduced motion).
//
// A ring shows once uTime passes its appear time (the shader's
// `clamp((uTime - aAppear) / uFadeSec, 0, 1)`). Under reduced motion main.ts
// stops calling setTime, so uTime never moves: any ring staged in the future
// stays invisible for good. That is how a lose-a-year chip switch under reduced
// motion left 69 of 297 rings dark, all 25 kindergarten holes among them. The
// rule: reduced motion cuts the motion, never the information.

import { describe, it, expect } from "vitest";
import { Vector3, type InstancedBufferGeometry } from "three";
import { createBeacons } from "../src/scene/beacons";
import type { GraphCore } from "../src/data";
import type { NodesHandle } from "../src/scene/nodes";
import type { BeaconTarget } from "../src/stories/contagion";

function rig() {
  const nodes = {
    getPosition: (i: number, out: Vector3) => out.set(i, 0, 0),
  } as unknown as NodesHandle;
  const beacons = createBeacons({} as GraphCore, nodes, new Float32Array(480).fill(2));
  const geo = beacons.object.geometry as InstancedBufferGeometry;
  const uniforms = (beacons.object.material as unknown as { uniforms: Record<string, { value: number }> })
    .uniforms;
  /** Per-instance appear amount, exactly as the fragment shader computes it. */
  const shown = (): number[] => {
    const ap = geo.getAttribute("aAppear").array as Float32Array;
    const t = uniforms.uTime.value;
    const fade = uniforms.uFadeSec.value;
    const out: number[] = [];
    for (let k = 0; k < geo.instanceCount; k++) out.push(Math.min(1, Math.max(0, (t - ap[k]) / fade)));
    return out;
  };
  return { beacons, shown };
}

// A hole (hop 0) and two downstream rings further out on the wave.
const WAVE: BeaconTarget[] = [
  { index: 0, intensity: 1, hop: 0 },
  { index: 1, intensity: 0.4, hop: 2 },
  { index: 2, intensity: 0.2, hop: 5 },
];

describe("beacon rings on a frozen clock", () => {
  it("a running clock still stages the wave (the motion is kept when it can play)", () => {
    const { beacons, shown } = rig();
    beacons.setTime(10);
    beacons.setTargets(WAVE, { delta: true });
    expect(shown().every((a) => a < 1)).toBe(true); // nothing has arrived yet
    beacons.setTime(20);
    expect(shown().every((a) => a === 1)).toBe(true); // the wave landed
  });

  it("the defect: an eased set on a clock that never runs leaves every ring dark", () => {
    const { beacons, shown } = rig();
    beacons.setTime(0);
    beacons.setTargets(WAVE, { delta: true }); // clock NOT marked frozen: the old path
    expect(shown().filter((a) => a > 0.5)).toHaveLength(0);
  });

  it("a frozen clock shows the full set at once, even when a wave is asked for", () => {
    const { beacons, shown } = rig();
    beacons.setClockFrozen(true);
    beacons.setTargets(WAVE, { delta: true }); // what an eased chip switch asks for
    expect(shown()).toEqual([1, 1, 1]);
  });

  it("a delta update on a frozen clock shows the newly added rings too", () => {
    const { beacons, shown } = rig();
    beacons.setClockFrozen(true);
    beacons.setTargets(WAVE.slice(0, 1), { delta: true });
    beacons.setTargets(WAVE, { delta: true }); // a year switch adds rings
    expect(shown()).toEqual([1, 1, 1]);
  });

  it("freezing mid-wave lands every ring the wave had not reached", () => {
    const { beacons, shown } = rig();
    beacons.setTime(10);
    beacons.setTargets(WAVE, { delta: true });
    beacons.setTime(10.3); // the hole is up, the downstream rings are still coming
    expect(shown().filter((a) => a === 1)).toHaveLength(1);
    beacons.setClockFrozen(true); // reduced motion switched on here
    expect(shown()).toEqual([1, 1, 1]);
  });

  it("unfreezing keeps what is shown and stages new waves again", () => {
    const { beacons, shown } = rig();
    beacons.setClockFrozen(true);
    beacons.setTargets(WAVE.slice(0, 2), { delta: true });
    beacons.setClockFrozen(false);
    beacons.setTargets(WAVE, { delta: true }); // index 2 is new, the others hold
    const s = shown();
    expect(s[0]).toBe(1);
    expect(s[1]).toBe(1);
    expect(s[2]).toBeLessThan(1);
  });
});
