// The borrowed-surface contract: a story must ENTER from a clean dark baseline
// and LEAVE every surface it borrowed exactly as it found it.
//
// The bug class this guards: a surface cleared on the way OUT but not on the way
// IN (so a story started over an open panel / mid-cascade focus / open search
// dropdown inherits it), or the reverse. The player runs ONE list in both
// directions (resetStorySurfaces), so the test only has to prove the list is
// complete and that every entry actually fires.

import { describe, it, expect, vi } from "vitest";
import {
  resetStorySurfaces,
  STORY_SURFACE_KEYS,
  type StorySurfaces,
} from "../src/stories/player";

function spySurfaces(): { surfaces: StorySurfaces; calls: string[] } {
  const calls: string[] = [];
  const surfaces = {} as Record<string, () => void>;
  for (const key of STORY_SURFACE_KEYS) {
    surfaces[key] = vi.fn(() => {
      calls.push(key);
    });
  }
  return { surfaces: surfaces as unknown as StorySurfaces, calls };
}

describe("story surface reset (entry + exit invariant)", () => {
  it("fires every surface in the contract, exactly once", () => {
    const { surfaces, calls } = spySurfaces();
    resetStorySurfaces(surfaces);
    expect(calls.length).toBe(STORY_SURFACE_KEYS.length);
    expect(new Set(calls).size).toBe(STORY_SURFACE_KEYS.length);
    for (const key of STORY_SURFACE_KEYS) expect(calls).toContain(key);
  });

  it("entry and exit run the IDENTICAL list (a surface can't be one-directional)", () => {
    const entry = spySurfaces();
    const exit = spySurfaces();
    resetStorySurfaces(entry.surfaces); // what start() runs
    resetStorySurfaces(exit.surfaces); // what stopImmediate() runs
    expect(entry.calls).toEqual(exit.calls);
  });

  it("is idempotent: a restart (stop then start) leaves the same state", () => {
    const { surfaces, calls } = spySurfaces();
    resetStorySurfaces(surfaces);
    const once = [...calls];
    resetStorySurfaces(surfaces);
    expect(calls).toEqual([...once, ...once]);
  });

  it("covers every surface a story is known to borrow", () => {
    // The census, spelled out. Adding a borrowed surface to the player without
    // adding it here (and to STORY_SURFACE_KEYS) is the bug this catches.
    expect([...STORY_SURFACE_KEYS].sort()).toEqual(
      [
        "clearBeacons",
        "clearCardExtra",
        "clearEdgeDamage",
        "clearEdgeMask",
        "clearEdgeStory",
        "clearFocalOffset",
        "clearFocus",
        "clearNodeDamage",
        "clearNodeMask",
        "clearNodeStoryLift",
        "dismissSearch",
        "hidePanel",
        "recomputeFilters",
        "resetEmphasis",
      ].sort(),
    );
  });

  it("clears the three surfaces a machine focus does NOT own (the contamination path)", () => {
    // machine.clearFocus() is a no-op when nothing is focused, so an emphasis, a
    // panel, or a search dropdown left by any other path would survive into
    // playback. These three exist precisely to be unconditional.
    for (const key of ["resetEmphasis", "hidePanel", "dismissSearch"] as const) {
      expect(STORY_SURFACE_KEYS).toContain(key);
    }
  });
});
