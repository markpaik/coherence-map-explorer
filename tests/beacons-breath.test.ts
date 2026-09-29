import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DAMAGE_RING_BREATH_PERIOD_SEC,
  DAMAGE_RING_BREATH_RATE,
  FOCUS_RING_BREATH_RATE,
} from "../src/scene/beacons";
import { STRUGGLE_PERIOD_SEC } from "../src/scene/nodes";

// Mark (2026-09-29): anything that marks a damaged standard moves as a slow
// breath under 0.3 Hz. The damage rings sweep their band across nearby orbs,
// so their breath counts.
describe("damage ring breath", () => {
  it("stays under the 0.3 Hz ceiling and matches the struggle breath", () => {
    const hz = DAMAGE_RING_BREATH_RATE / (2 * Math.PI);
    expect(hz).toBeLessThan(0.3);
    expect(DAMAGE_RING_BREATH_PERIOD_SEC).toBe(STRUGGLE_PERIOD_SEC);
  });

  it("drives the shader from a uniform, and the focus marker keeps its shipped rate", () => {
    const src = readFileSync(new URL("../src/scene/beacons.ts", import.meta.url), "utf8");
    expect(src).toContain("sin(uTime * uBreathRate + vPhase)");
    expect(src).not.toMatch(/sin\(uTime \* 2\.2/);
    expect(src).toContain("uBreathRate: { value: DAMAGE_RING_BREATH_RATE }");
    expect(src).toContain("uBreathRate: { value: FOCUS_RING_BREATH_RATE }");
    expect(FOCUS_RING_BREATH_RATE).toBe(2.2);
  });
});
