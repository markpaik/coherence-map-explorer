// Filter snapshot/restore round trip (the tour borrows the filters for its
// Four-rivers stop and must hand back EXACTLY what the reader had).
//
// The case that broke before: a reader with a multi-chip subset selected, e.g.
// grades {3,4}. Chip clicks carry SOLO semantics, so a restore that replayed
// clicks could only ever reconstruct "all" or "exactly one" — never a subset.
// readSelection/writeSelection are the direct set/get pair the handle delegates
// to, so this asserts the real restore path, not a parallel implementation.

import { describe, it, expect } from "vitest";
import {
  readSelection,
  writeSelection,
  type FilterSelection,
} from "../src/ui/filters";

const GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "HS"];
const STRANDS = ["number", "algebra", "geometry", "data"];

/** One round trip through the real snapshot + restore pair. */
function roundTrip(sel: FilterSelection): FilterSelection {
  const grades = new Set<string>();
  const strands = new Set<string>();
  const lens = writeSelection(sel, GRADES, STRANDS, grades, strands);
  return readSelection(grades, strands, lens);
}

describe("filter selection round trip", () => {
  it("restores a multi-chip GRADE subset exactly (the case that broke)", () => {
    const sel: FilterSelection = { grades: ["3", "4"], strands: STRANDS, lens: "all" };
    const back = roundTrip(sel);
    expect(back.grades).toEqual(["3", "4"]);
    expect(back.strands).toEqual(STRANDS);
    expect(back.lens).toBe("all");
  });

  it("restores a multi-chip STRAND subset exactly", () => {
    const sel: FilterSelection = {
      grades: GRADES,
      strands: ["number", "geometry"],
      lens: "all",
    };
    expect(roundTrip(sel).strands).toEqual(["number", "geometry"]);
  });

  it("restores a subset in BOTH groups at once, plus a lens", () => {
    const sel: FilterSelection = {
      grades: ["6", "7", "8"],
      strands: ["algebra", "data"],
      lens: "wap",
    };
    const back = roundTrip(sel);
    expect(back.grades).toEqual(["6", "7", "8"]);
    expect(back.strands).toEqual(["algebra", "data"]);
    expect(back.lens).toBe("wap");
  });

  it("restores a SOLO selection (the shape a click can make) unchanged", () => {
    const sel: FilterSelection = { grades: ["4"], strands: ["number"], lens: "major" };
    const back = roundTrip(sel);
    expect(back.grades).toEqual(["4"]);
    expect(back.strands).toEqual(["number"]);
    expect(back.lens).toBe("major");
  });

  it("restores the default all-on state unchanged", () => {
    const sel: FilterSelection = { grades: GRADES, strands: STRANDS, lens: "all" };
    const back = roundTrip(sel);
    expect(back.grades).toEqual(GRADES);
    expect(back.strands).toEqual(STRANDS);
    expect(back.lens).toBe("all");
  });

  it("is idempotent: restoring a restored selection changes nothing", () => {
    const sel: FilterSelection = { grades: ["3", "4"], strands: ["number"], lens: "wap" };
    expect(roundTrip(roundTrip(sel))).toEqual(roundTrip(sel));
  });

  it("every lens value survives the trip", () => {
    for (const lens of ["all", "major", "wap"] as const) {
      expect(roundTrip({ grades: GRADES, strands: STRANDS, lens }).lens).toBe(lens);
    }
  });

  it("drops ids the build does not know (a stale snapshot cannot poison the filter)", () => {
    const sel: FilterSelection = {
      grades: ["3", "ZZ", "4"],
      strands: ["number", "nonsense"],
      lens: "all",
    };
    const back = roundTrip(sel);
    expect(back.grades).toEqual(["3", "4"]);
    expect(back.strands).toEqual(["number"]);
  });

  it("an empty selection restores as empty rather than silently reverting to all", () => {
    const back = roundTrip({ grades: [], strands: [], lens: "all" });
    expect(back.grades).toEqual([]);
    expect(back.strands).toEqual([]);
  });

  it("writeSelection replaces rather than merges (no residue from a prior state)", () => {
    const grades = new Set(["K", "1", "2"]);
    const strands = new Set(["data"]);
    writeSelection(
      { grades: ["7"], strands: ["algebra"], lens: "all" },
      GRADES,
      STRANDS,
      grades,
      strands,
    );
    expect([...grades]).toEqual(["7"]);
    expect([...strands]).toEqual(["algebra"]);
  });
});
