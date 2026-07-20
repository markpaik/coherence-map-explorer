// Pure focus-grammar arithmetic for the round-11 structural-pose focus recolor:
// the connected/unconnected ramps, the per-layer focus alpha fades, and the
// Transit city-background fade target. No THREE / DOM — just the numbers the edge
// GLSL, the stations, and the drafts all key off, kept in one place so they can't
// drift apart.

import { describe, it, expect } from "vitest";
import {
  connectedness,
  unconnectedness,
  stationFocusFade,
  draftFocusFade,
  srgbToLinear,
  cityFadeTarget,
  transitOverviewKeep,
} from "../src/scene/focusgrammar";

// Emphasis scale: 0 DIMMED | 1 REST | 2 HOVER | 3 FOCUS | 4 CHAIN | 5 RELATED.

describe("connectedness (strand re-saturation / width ramp)", () => {
  it("is 0 at REST and below, 1 at HOVER and above", () => {
    expect(connectedness(0)).toBe(0); // DIMMED
    expect(connectedness(1)).toBe(0); // REST
    expect(connectedness(2)).toBe(1); // HOVER
    expect(connectedness(3)).toBe(1); // FOCUS
    expect(connectedness(4)).toBe(1); // CHAIN
    expect(connectedness(5)).toBe(1); // RELATED
  });
  it("ramps linearly across the REST→HOVER easing band", () => {
    expect(connectedness(1.5)).toBeCloseTo(0.5, 6);
  });
});

describe("unconnectedness (fade-to-background ramp)", () => {
  it("is 1 only at DIMMED, 0 at REST and above", () => {
    expect(unconnectedness(0)).toBe(1); // DIMMED — the unconnected base under a focus
    expect(unconnectedness(1)).toBe(0); // REST
    expect(unconnectedness(2)).toBe(0); // HOVER
    expect(unconnectedness(4)).toBe(0); // CHAIN
  });
  it("connectedness and unconnectedness are both 0 with no focus (all REST)", () => {
    // The no-focus invariant: nothing is dimmed and nothing is lit, so the
    // structural poses render their untouched resting look.
    expect(connectedness(1)).toBe(0);
    expect(unconnectedness(1)).toBe(0);
  });
});

describe("per-layer focus alpha fades", () => {
  it("Transit stations: unconnected → ~0.15, resting + connected → full", () => {
    expect(stationFocusFade(0)).toBeCloseTo(0.15, 6); // DIMMED
    expect(stationFocusFade(1)).toBe(1); // REST
    expect(stationFocusFade(3)).toBe(1); // FOCUS
    expect(stationFocusFade(4)).toBe(1); // CHAIN
    expect(stationFocusFade(0.5)).toBeCloseTo(0.575, 6); // mid-ease
  });
  it("Blueprint drafts: unconnected → ~0.18, resting + connected → full", () => {
    expect(draftFocusFade(0)).toBeCloseTo(0.18, 6); // DIMMED
    expect(draftFocusFade(1)).toBe(1); // REST
    expect(draftFocusFade(4)).toBe(1); // CHAIN
  });
});

describe("transitOverviewKeep (unfocused-overview trunk ghost)", () => {
  it("ghosts a NON-TRUNK resting line toward ~0.08, keeps a wide trunk opaque", () => {
    expect(transitOverviewKeep(0, 1)).toBeCloseTo(0.05, 6); // thin, resting → floor
    expect(transitOverviewKeep(1, 1)).toBeCloseTo(1, 6); // wide trunk, resting → opaque
  });
  it("does NOTHING under a focus — connected or dimmed lines keep their focus grammar", () => {
    // restness is 0 for every non-resting emphasis, so the multiplier is 1: the
    // focus's own connected (0.95) / unconnected (0.12) alphas above are untouched.
    expect(transitOverviewKeep(0, 4)).toBe(1); // CHAIN (connected), even a thin line
    expect(transitOverviewKeep(0, 0)).toBe(1); // DIMMED (unconnected)
    expect(transitOverviewKeep(0, 2)).toBe(1); // HOVER (the hovered line stays lit)
    expect(transitOverviewKeep(0, 5)).toBe(1); // RELATED-to-focus
  });
  it("ramps a mid-reach resting line across the trunk thresholds (GLSL smoothstep parity)", () => {
    // smoothstep(0.5, 0.85, 0.675) = 0.5 → 0.05 + 0.95·0.5 = 0.525. Pins the shader
    // literals (floor 0.05, thresholds 0.5/0.85) against drift.
    expect(transitOverviewKeep(0.675, 1)).toBeCloseTo(0.525, 6);
  });
});

describe("sRGB → linear", () => {
  it("matches the piecewise curve at the boundary and endpoints", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 6);
    expect(srgbToLinear(0.04045)).toBeCloseTo(0.04045 / 12.92, 6); // linear segment
    expect(srgbToLinear(0.5)).toBeCloseTo(0.21404, 4);
  });
});

describe("cityFadeTarget = mix(#0a0a16, #beb9b0, daylight01) in linear space", () => {
  const linHex = (hex: number): [number, number, number] => [
    srgbToLinear(((hex >> 16) & 0xff) / 255),
    srgbToLinear(((hex >> 8) & 0xff) / 255),
    srgbToLinear((hex & 0xff) / 255),
  ];
  const dark = linHex(0x0a0a16);
  const day = linHex(0xbeb9b0);

  it("daylight01 = 0 → the near-black dark baseline (#0a0a16, linear)", () => {
    const c = cityFadeTarget(0);
    expect(c[0]).toBeCloseTo(dark[0], 6);
    expect(c[1]).toBeCloseTo(dark[1], 6);
    expect(c[2]).toBeCloseTo(dark[2], 6);
  });
  it("daylight01 = 1 → concrete daylight (#beb9b0, linear)", () => {
    const c = cityFadeTarget(1);
    expect(c[0]).toBeCloseTo(day[0], 6);
    expect(c[1]).toBeCloseTo(day[1], 6);
    expect(c[2]).toBeCloseTo(day[2], 6);
  });
  it("daylight01 = 0.5 → the linear midpoint", () => {
    const c = cityFadeTarget(0.5);
    expect(c[0]).toBeCloseTo((dark[0] + day[0]) / 2, 6);
    expect(c[1]).toBeCloseTo((dark[1] + day[1]) / 2, 6);
    expect(c[2]).toBeCloseTo((dark[2] + day[2]) / 2, 6);
  });
  it("clamps out-of-range daylight01 to the endpoints", () => {
    expect(cityFadeTarget(-1)).toEqual(cityFadeTarget(0));
    expect(cityFadeTarget(2)).toEqual(cityFadeTarget(1));
  });

  // The edge shader (scene/edges.ts) mixes these SAME endpoints as hardcoded
  // LINEAR literals. Pin them so the GLSL and the JS never drift apart.
  it("endpoints match the edge shader's LINEAR literals (drift guard)", () => {
    const c0 = cityFadeTarget(0);
    expect(c0[0]).toBeCloseTo(0.003035, 5);
    expect(c0[1]).toBeCloseTo(0.003035, 5);
    expect(c0[2]).toBeCloseTo(0.008023, 5);
    const c1 = cityFadeTarget(1);
    expect(c1[0]).toBeCloseTo(0.514918, 5);
    expect(c1[1]).toBeCloseTo(0.485150, 5);
    expect(c1[2]).toBeCloseTo(0.434154, 5);
  });
});
