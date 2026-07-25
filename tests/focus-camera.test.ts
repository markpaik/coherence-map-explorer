// The focus() camera choreography is a two-stage-framing decision: lighting
// always runs the full closure, but the CAMERA path branches on the interaction.
// decideFocusCamera is the pure predicate that branch keys off, extracted so the
// fresh-vs-hop rule is testable away from THREE / timers.
//
//   cut  — reduced motion or a deep-link instant open: snap to the one-hop frame
//   hop  — a focus is already active AND the camera is in the close one-hop
//          frame: a new standard pans straight there, no wide excursion, no dive
//   dive — a fresh focus (from idle, or from the wide/journey frame): hold the
//          expanse for a beat, then dive in

import { describe, it, expect } from "vitest";
import { decideFocusCamera } from "../src/state/machine";

describe("decideFocusCamera", () => {
  it("reduced motion always cuts, whatever the framing", () => {
    expect(decideFocusCamera(true, false, false, "local")).toBe("cut");
    expect(decideFocusCamera(true, false, true, "local")).toBe("cut");
    expect(decideFocusCamera(true, false, true, "journey")).toBe("cut");
  });

  it("an instant (deep-link) open always cuts", () => {
    expect(decideFocusCamera(false, true, false, "local")).toBe("cut");
    expect(decideFocusCamera(false, true, true, "local")).toBe("cut");
  });

  it("a fresh focus from idle dives (hold the expanse, then zoom in)", () => {
    expect(decideFocusCamera(false, false, false, "local")).toBe("dive");
    expect(decideFocusCamera(false, false, false, "journey")).toBe("dive");
  });

  it("focusing a new standard while zoomed on another is a lateral hop", () => {
    expect(decideFocusCamera(false, false, true, "local")).toBe("hop");
  });

  it("focusing from the wide/journey frame dives, not hops", () => {
    // The camera is already wide, so this is a fresh dive back in, not a lateral
    // pan between two close frames.
    expect(decideFocusCamera(false, false, true, "journey")).toBe("dive");
  });

  it("reduced motion beats both hop and dive", () => {
    expect(decideFocusCamera(true, false, true, "local")).toBe("cut"); // would be hop
    expect(decideFocusCamera(true, false, false, "journey")).toBe("cut"); // would be dive
  });
});
