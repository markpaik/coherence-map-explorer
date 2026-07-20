// Solo-toggle semantics for the grade / strand filter chips (the S3 blocker).

import { describe, it, expect } from "vitest";
import { toggleChip } from "../src/ui/chipgroup";

const GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "HS"];

describe("toggleChip: the obvious click does the obvious thing", () => {
  it("all on + click 4 → SOLO grade 4", () => {
    const r = toggleChip(GRADES, GRADES, "4");
    expect(r.active).toEqual(["4"]);
    expect(r.mode).toBe("solo");
  });

  it("soloed 4 + click 4 → restore ALL", () => {
    const r = toggleChip(GRADES, ["4"], "4");
    expect(r.active).toEqual(GRADES);
    expect(r.mode).toBe("all");
  });

  it("subset + click an off chip → adds it (normal toggle)", () => {
    const r = toggleChip(GRADES, ["4", "5"], "6");
    expect(r.active).toEqual(["4", "5", "6"]);
    expect(r.mode).toBe("subset");
  });

  it("subset + click an on chip → removes it (normal toggle)", () => {
    const r = toggleChip(GRADES, ["4", "5"], "4");
    expect(r.active).toEqual(["5"]);
    expect(r.mode).toBe("solo"); // down to exactly one
  });

  it("clicking the sole remaining chip restores all (never empties)", () => {
    const r = toggleChip(GRADES, ["5"], "5");
    expect(r.active).toEqual(GRADES);
    expect(r.mode).toBe("all");
  });

  it("never yields an empty active set from any single click", () => {
    // From every reachable state, one click keeps at least one chip on.
    const states = [GRADES, ["4"], ["4", "5"], ["K", "HS"], ["8"]];
    for (const s of states) {
      for (const g of GRADES) {
        expect(toggleChip(GRADES, s, g).active.length).toBeGreaterThan(0);
      }
    }
  });

  it("returns active ids in the group's canonical order", () => {
    const r = toggleChip(GRADES, ["HS", "K", "4"], "1");
    expect(r.active).toEqual(["K", "1", "4", "HS"]);
  });

  it("works for a small strand group (solo one of four)", () => {
    const STRANDS = ["number", "algebra", "geometry", "data"];
    const r = toggleChip(STRANDS, STRANDS, "geometry");
    expect(r.active).toEqual(["geometry"]);
    expect(r.mode).toBe("solo");
  });
});
