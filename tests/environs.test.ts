// Pure window + endpoint-gate math for the round-11 thematic environments and
// the shared layer gate (sheet / drafts / contours / stations route through the
// same endpointOwns). No THREE / DOM here — just the arithmetic that decides
// whether a home pose's layer is allowed to show for a given morph.

import { describe, it, expect } from "vitest";
import {
  dawnWindow,
  studioWindow,
  daylightWindow,
  endpointOwns,
  environAmount,
  type PoseGate,
} from "../src/scene/environs";

const settled = (pose: number): PoseGate => ({ origin: pose, target: pose });

describe("environment windows (pure)", () => {
  it("dawn peaks at pose 1, zero by 0.5 / 1.5", () => {
    expect(dawnWindow(1)).toBe(1);
    expect(dawnWindow(0.5)).toBe(0);
    expect(dawnWindow(1.5)).toBe(0);
    expect(dawnWindow(0.75)).toBeCloseTo(0.5, 6);
    expect(dawnWindow(0)).toBe(0); // clamped, never negative
  });

  it("studio peaks at pose 2, zero by 1.5 / 2.5", () => {
    expect(studioWindow(2)).toBe(1);
    expect(studioWindow(1.5)).toBe(0);
    expect(studioWindow(2.5)).toBe(0);
    expect(studioWindow(2.25)).toBeCloseTo(0.5, 6);
  });

  it("daylight ramps up over 2.5→3 and saturates", () => {
    expect(daylightWindow(2.5)).toBe(0);
    expect(daylightWindow(2.75)).toBeCloseTo(0.5, 6);
    expect(daylightWindow(3)).toBe(1);
    expect(daylightWindow(2)).toBe(0);
    expect(daylightWindow(3.5)).toBe(1); // clamped
  });

  it("studio and daylight windows meet at 0 at pose 2.5 (mutually exclusive)", () => {
    expect(studioWindow(2.5)).toBe(0);
    expect(daylightWindow(2.5)).toBe(0);
  });
});

describe("endpoint gate", () => {
  it("a home is owned only when it is the origin or target", () => {
    const g: PoseGate = { origin: 0, target: 3 };
    expect(endpointOwns(0, g)).toBe(true);
    expect(endpointOwns(3, g)).toBe(true);
    expect(endpointOwns(1, g)).toBe(false);
    expect(endpointOwns(2, g)).toBe(false);
  });

  it("settled poses own their own home", () => {
    expect(endpointOwns(1, settled(1))).toBe(true);
    expect(endpointOwns(2, settled(2))).toBe(true);
    expect(endpointOwns(2, settled(1))).toBe(false);
  });
});

describe("environAmount = window × endpoint gate (the bug fix)", () => {
  it("settled at each structured pose shows exactly its own environment", () => {
    expect(environAmount(1, 1, settled(1))).toBe(1); // Ascent → dawn
    expect(environAmount(2, 2, settled(2))).toBe(1); // Blueprint → studio
    expect(environAmount(3, 3, settled(3))).toBe(1); // Transit → daylight
    // and never a foreign environment
    expect(environAmount(2, 1, settled(1))).toBe(0);
    expect(environAmount(1, 2, settled(2))).toBe(0);
  });

  it("Constellation (settled 0) raises no environment", () => {
    expect(environAmount(1, 0, settled(0))).toBe(0);
    expect(environAmount(2, 0, settled(0))).toBe(0);
    expect(environAmount(3, 0, settled(0))).toBe(0);
  });

  it("0→3 sweeping through pose 2 never flashes the studio (home 2)", () => {
    const g: PoseGate = { origin: 0, target: 3 };
    // The raw window would be 1 at pose 2, but the gate forces it to 0.
    expect(studioWindow(2)).toBe(1);
    expect(environAmount(2, 2, g)).toBe(0);
    // dawn (home 1) is likewise gated off across the whole sweep
    expect(environAmount(1, 1, g)).toBe(0);
    // daylight (home 3) IS an endpoint — it arrives normally near pose 3
    expect(environAmount(3, 3, g)).toBe(1);
    expect(environAmount(3, 2.75, g)).toBeCloseTo(0.5, 6);
  });

  it("1→3 never flashes the studio, but dawn releases at the start", () => {
    const g: PoseGate = { origin: 1, target: 3 };
    expect(environAmount(2, 2, g)).toBe(0); // no studio flash
    expect(environAmount(1, 1, g)).toBe(1); // dawn owns the departure
    expect(environAmount(3, 3, g)).toBe(1); // daylight owns the arrival
  });

  it("0→2 never flashes the dawn (home 1); studio arrives", () => {
    const g: PoseGate = { origin: 0, target: 2 };
    expect(dawnWindow(1)).toBe(1); // raw would flash at pose 1
    expect(environAmount(1, 1, g)).toBe(0); // gated off
    expect(environAmount(2, 2, g)).toBe(1); // studio arrives normally
  });

  it("2→3 keeps the studio↔daylight crossfade (both endpoints owned)", () => {
    const g: PoseGate = { origin: 2, target: 3 };
    expect(environAmount(2, 2, g)).toBe(1);
    expect(environAmount(2, 2.25, g)).toBeCloseTo(0.5, 6);
    expect(environAmount(3, 2.75, g)).toBeCloseTo(0.5, 6);
    expect(environAmount(3, 3, g)).toBe(1);
  });
});
