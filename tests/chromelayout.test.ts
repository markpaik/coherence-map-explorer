// Chrome layout arithmetic (ui/chromelayout.ts): the pure placement math behind
// "no two chrome surfaces overlap" (DESIGN rules R1-R4, R8). The DOM pass is
// covered by the overlap census; what is pinned here is the geometry it runs on.

import { describe, it, expect } from "vitest";
import {
  depthSpan,
  dockTopRight,
  hOverlap,
  liftClear,
  overlaps,
  placeTooltip,
  shiftBox,
  union,
  DOCK_CLEARANCE,
  type Box,
} from "../src/ui/chromelayout";

const box = (l: number, t: number, r: number, b: number): Box => ({ l, t, r, b });

describe("overlap tests use the census threshold (more than 2px in both axes)", () => {
  it("a 2px graze is not an overlap; 3px is", () => {
    expect(overlaps(box(0, 0, 100, 100), box(98, 0, 200, 100))).toBe(false);
    expect(overlaps(box(0, 0, 100, 100), box(97, 97, 200, 200))).toBe(true);
  });
  it("side by side columns do not overlap horizontally", () => {
    expect(hOverlap(box(0, 0, 100, 10), box(100, 0, 200, 10))).toBe(false);
    expect(hOverlap(box(0, 0, 100, 10), box(90, 50, 200, 60))).toBe(true);
  });
  it("union and shift are plain box arithmetic", () => {
    expect(union(null, box(1, 2, 3, 4))).toEqual(box(1, 2, 3, 4));
    expect(union(box(0, 0, 10, 10), box(5, -5, 20, 5))).toEqual(box(0, -5, 20, 10));
    expect(shiftBox(box(0, 0, 10, 10), 3, -4)).toEqual(box(3, -4, 13, 6));
  });
});

describe("liftClear: a bottom-band surface rises just clear of what sits under it", () => {
  // 1024x768: the wrapped filter rail (2 rows) and the view toggle at its CSS
  // default (bottom 53.76px), which used to sit on the rail's right end.
  const vh = 768;
  const filters = box(78, vh - 16 - 71, 947, vh - 16);
  const toggle = box(812, vh - 54 - 52, 998, vh - 54);

  it("lifts the toggle above the rail with the shipped 6px of air", () => {
    const lift = liftClear(toggle, [filters], 6);
    const placed = shiftBox(toggle, 0, -lift);
    expect(placed.b).toBeLessThanOrEqual(filters.t - 6);
    expect(placed.b).toBeGreaterThan(filters.t - 6 - 1); // no more than needed
  });

  it("does not move a surface that already clears (1600x1000: toggle 6px over a one-row rail)", () => {
    const H = 1000;
    const rail = box(174, H - 56, 1426, H - 16);
    const tog = box(1385, H - 62 - 52, 1572, H - 62);
    expect(liftClear(tog, [rail], 6)).toBe(0);
  });

  it("ignores obstacles in other columns", () => {
    const pill = box(12, vh - 58, 110, vh - 14);
    const tog = box(612, vh - 120, 832, vh - 70);
    expect(liftClear(tog, [pill], 6)).toBe(0);
  });

  it("stacks through several obstacles, each clearing the one before", () => {
    const hints = box(751, vh - 124 - 15, 998, vh - 124);
    const tLift = liftClear(toggle, [filters], 6);
    const tPlaced = shiftBox(toggle, 0, -tLift);
    const hLift = liftClear(hints, [filters, tPlaced], 6);
    const hPlaced = shiftBox(hints, 0, -hLift);
    expect(hPlaced.b).toBeLessThanOrEqual(tPlaced.t - 6);
    expect(overlaps(hPlaced, filters)).toBe(false);
  });

  it("an obstacle ABOVE the surface still forces it higher (it never sinks)", () => {
    const low = box(0, 700, 100, 740);
    const above = box(0, 690, 100, 720);
    const lift = liftClear(low, [above], 10);
    expect(shiftBox(low, 0, -lift).b).toBeLessThanOrEqual(680);
  });
});

describe("dockTopRight (R3): top-right only when the rail clears the headline by 24px", () => {
  const headline = (r: number): Box => box(36, 22, r, 127);
  const title = (r: number): Box => box(36, 22, r, 290);

  it("1024 (finding 43): the rail's left edge lands on the wordmark, so it docks under the title", () => {
    expect(
      dockTopRight({ vw: 1024, regionR: 1024, inset: 18, railW: 876, dropdownW: 420, headline: headline(657), title: title(657) }),
    ).toBe(false);
  });

  it("1920: a short aside leaves the room, so the rail stays top-right", () => {
    expect(
      dockTopRight({ vw: 1920, regionR: 1920, inset: 18, railW: 876, dropdownW: 420, headline: headline(700), title: title(700) }),
    ).toBe(true);
  });

  it("the clearance is exactly DOCK_CLEARANCE px, measured from the rail's left edge", () => {
    const railW = 876;
    const right = 1600 - 18;
    const edge = right - railW; // 706
    const at = (r: number): boolean =>
      dockTopRight({ vw: 1600, regionR: 1600, inset: 18, railW, dropdownW: 420, headline: headline(r), title: title(r) });
    expect(at(edge - DOCK_CLEARANCE)).toBe(true);
    expect(at(edge - DOCK_CLEARANCE + 1)).toBe(false);
  });

  it("with the panel open the rail must fit left of it, which it never does at 1920", () => {
    expect(
      dockTopRight({ vw: 1920, regionR: 1920 - 480, inset: 18, railW: 876, dropdownW: 420, headline: headline(700), title: title(700) }),
    ).toBe(false);
  });

  it("the dropdown must clear the rest of the title block too, not only the headline", () => {
    expect(
      dockTopRight({ vw: 1440, regionR: 1440, inset: 18, railW: 700, dropdownW: 420, headline: headline(600), title: title(1010) }),
    ).toBe(false);
  });

  it("no title on screen (phones): nothing to clear", () => {
    expect(dockTopRight({ vw: 800, regionR: 800, inset: 18, railW: 900, dropdownW: 420, headline: null, title: null })).toBe(true);
  });
});

describe("depthSpan: the Ascent depth scale takes the free stretch of its column", () => {
  const col = box(26, 0, 211, 1000);

  it("1600x1000 with nothing open keeps the shipped span, max(36vh, 300px) to 78vh", () => {
    const title = box(36, 22, 700, 316);
    const filters = box(174, 944, 1426, 984);
    expect(depthSpan(col, [title, filters], 1000)).toEqual({ top: 360, bottom: 780 });
  });

  it("a story card on the left edge: the scale ends 12px above the card", () => {
    const title = box(31, 13, 657, 250);
    const card = box(31, 430, 451, 730);
    const span = depthSpan(box(20, 0, 205, 768), [title, card], 768)!;
    expect(span.bottom).toBe(430 - 12);
    expect(span.top).toBe(250 + 12);
  });

  it("no free stretch tall enough: null, and the scale hides (landscape phone story)", () => {
    const card = box(25, 22, 445, 370);
    expect(depthSpan(box(17, 0, 202, 390), [card], 390)).toBeNull();
  });

  it("surfaces in other columns do not count", () => {
    const rail = box(362, 674, 1238, 720);
    expect(depthSpan(col, [rail], 1000)).toEqual({ top: 360, bottom: 780 });
  });
});

describe("placeTooltip (R8): inside the canvas region, off the chrome, clamped after the flip", () => {
  const W = 280;
  const H = 96;

  it("finding 100: at 390px wide no pointer position puts the card off the left edge", () => {
    const region = box(8, 8, 390 - 8, 780 - 8);
    for (let x = 0; x <= 390; x += 5) {
      const p = placeTooltip(x, 400, W, H, region, []);
      expect(p.left, `x=${x}`).toBeGreaterThanOrEqual(8);
      expect(p.left + W, `x=${x}`).toBeLessThanOrEqual(390 - 8);
    }
  });

  it("finding 102: with the panel open the card stays left of the panel's edge", () => {
    const region = box(8, 8, 1600 - 480 - 8, 1000 - 8);
    for (let x = 700; x <= 1120; x += 7) {
      const p = placeTooltip(x, 500, W, H, region, []);
      expect(p.left + W, `x=${x}`).toBeLessThanOrEqual(1120 - 8);
    }
  });

  it("keeps the old below-right placement when it fits", () => {
    const p = placeTooltip(200, 200, W, H, box(8, 8, 1592, 992), [], 14);
    expect(p).toEqual({ left: 214, top: 214 });
  });

  it("flips to a corner that covers no chrome surface when one exists", () => {
    // A node just above the filter rail: below-right would sit on the rail.
    const rail = box(100, 900, 1500, 984);
    const p = placeTooltip(600, 880, W, H, box(8, 8, 1592, 992), [rail], 14);
    expect(overlaps(box(p.left, p.top, p.left + W, p.top + H), rail, 0)).toBe(false);
    expect(p.top + H).toBeLessThanOrEqual(880);
  });

  it("when every corner meets chrome, it takes the nearest chrome-free spot beside it", () => {
    // A pointer between two bars (a rail above, a rail below): all four corners
    // land on one of them; the spot tucked just above the lower bar is free.
    const upper = box(0, 150, 600, 190);
    const lower = box(0, 300, 600, 340);
    const p = placeTooltip(300, 240, 200, 60, box(8, 8, 592, 592), [upper, lower], 14);
    const card = box(p.left, p.top, p.left + 200, p.top + 60);
    expect(overlaps(card, upper, 0)).toBe(false);
    expect(overlaps(card, lower, 0)).toBe(false);
    expect(Math.max(card.l - 300, 0, 300 - card.r)).toBeLessThanOrEqual(20);
  });

  it("never negative, even when the card is wider than the region", () => {
    const p = placeTooltip(50, 50, 400, H, box(8, 8, 300, 600), []);
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.top).toBeGreaterThanOrEqual(8);
  });
});
