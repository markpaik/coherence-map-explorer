// The interactive "Lose a year" story: the three defects the B5 audit found.
//
//   14. Under reduced motion a chip switch asked for the EASED wave, whose rings
//       wait on a clock that never runs: grade K showed none of its 25 hole
//       rings. The switch must follow reduced motion (yearSwitchEases), and the
//       rings must never stage on a frozen clock (tests/beacons-clock.test.ts).
//   11. The card's focus trap was a hand-kept list that left out the chips, and
//       ArrowRight on the one-scene story's "Done" ended it. The trap now reads
//       the live DOM (trapTarget decides the wrap), and the chips rove on
//       arrows (rovingIndex).
//   12. The whole-map framing put K, 1 and 2 entirely under the card at
//       1440x900 and most of grade 3 under it at 1280x720. The story's usable
//       rect now leaves out the card's column, the masthead and the scrubber
//       (finding 28, rules F1 to F3), and planClearFrame pads the framed box
//       only as far as it takes to keep the year inside that rect while the
//       camera sways. At 900x700 the old card-only pad squeezed the year above
//       the card and under the title (the F3 note).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { Box3, Quaternion, Vector3 } from "three";
import type { GraphCore } from "../src/data";
import { yearSwitchEases } from "../src/stories/player";
import { trapTarget } from "../src/ui/storycard";
import { rovingIndex } from "../src/ui/chipgroup";
import { planClearFrame, type ClearFrameInput } from "../src/stories/yearframe";
import {
  computeUsableRect,
  solveFrame,
  storyMastheadBand,
  type ChromeMetrics,
  type Rect,
} from "../src/scene/frame";
import { nodeBoundingBox } from "../src/state/machine";
import { createDamageEngine } from "../src/stories/damage";
import { createSelectorResolver } from "../src/stories/selectors";
import { expandFamilies } from "../src/stories/contagion";

describe("finding 14: a chip switch follows reduced motion", () => {
  it("eases with motion on, cuts under reduced motion", () => {
    expect(yearSwitchEases(false)).toBe(true);
    expect(yearSwitchEases(true)).toBe(false);
  });
});

describe("finding 11: the story card's focus trap", () => {
  // The lose-a-year card in DOM order: the chosen chip (the group's one tab
  // stop), the controls, the formation segments, then the scrubber.
  const cycle = ["chip3", "back", "done", "exit", "authored", "constellation", "ascent", "pause", "dot"];

  it("lets the browser step between members (no forced jump mid-cycle)", () => {
    expect(trapTarget(cycle, "back", false, true)).toBeNull();
    expect(trapTarget(cycle, "done", true, true)).toBeNull();
  });

  it("wraps at both ends, so the chips are reachable from either direction", () => {
    expect(trapTarget(cycle, "dot", false, true)).toBe("chip3"); // Tab off the end lands on the chips
    expect(trapTarget(cycle, "chip3", true, true)).toBe("dot"); // Shift+Tab off the chips wraps
  });

  it("pulls escaped focus back to the start of the cycle", () => {
    expect(trapTarget(cycle, null, false, false)).toBe("chip3");
    expect(trapTarget(cycle, "somewhere", true, false)).toBe("chip3");
  });

  it("does nothing with an empty trap", () => {
    expect(trapTarget([], null, false, false)).toBeNull();
  });
});

describe("finding 11: the grade chips rove on arrow keys", () => {
  const n = 9; // K, 1 … 8

  it("Right / Down step forward and wrap at the end", () => {
    expect(rovingIndex("ArrowRight", 3, n)).toBe(4);
    expect(rovingIndex("ArrowDown", 3, n)).toBe(4);
    expect(rovingIndex("ArrowRight", 8, n)).toBe(0);
  });

  it("Left / Up step back and wrap at the start", () => {
    expect(rovingIndex("ArrowLeft", 3, n)).toBe(2);
    expect(rovingIndex("ArrowUp", 0, n)).toBe(8);
  });

  it("Home / End jump to the ends", () => {
    expect(rovingIndex("Home", 5, n)).toBe(0);
    expect(rovingIndex("End", 5, n)).toBe(8);
  });

  it("ignores every other key (Enter / Space choose through the button's own click)", () => {
    for (const key of ["Enter", " ", "Tab", "Escape", "a"]) expect(rovingIndex(key, 3, n)).toBeNull();
  });
});

describe("finding 12: the chosen year frames inside the story's keep-out rect", () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const core: GraphCore = JSON.parse(
    readFileSync(resolvePath(HERE, "..", "public/data/graph-core.json"), "utf8"),
  );
  const resolve = createSelectorResolver(core);
  const damage = createDamageEngine(core);
  const indexById = new Map<string, number>();
  core.nodes.forEach((node, i) => indexById.set(node.id, i));
  const children = core.nodes.map((node) =>
    (node.children ?? []).map((id) => indexById.get(id)).filter((i): i is number => i !== undefined),
  );
  // The story plays in the Ascent (pose 1): read pos2.
  const ascent = {
    getPosition(i: number, out: Vector3): Vector3 {
      const p = core.nodes[i].pos2;
      return out.set(p[0], p[1], p[2]);
    },
  };

  /** The year and its downstream band, exactly as the player builds them. */
  function yearSubject(grade: string): { subject: Box3; keep: Vector3[] } {
    const missed = expandFamilies(resolve(`grade:${grade}`), (i) => children[i]);
    const target = damage.compute(new Set([...missed].map((i) => core.nodes[i].id)));
    const reach: number[] = [];
    for (let i = 0; i < core.nodes.length; i++) if (!missed.has(i) && target[i] > 0.0001) reach.push(i);
    const subject = nodeBoundingBox(ascent, [...missed], 0, 140);
    subject.union(nodeBoundingBox(ascent, reach, 0.05, 140));
    return { subject, keep: [...missed].map((i) => ascent.getPosition(i, new Vector3())) };
  }

  const wholeMap = nodeBoundingBox(ascent, core.nodes.map((_n, i) => i), 0, 140);

  // Measured live during lose-a-year on the merged chrome (main 6b61cba, the
  // title block now carries the license line): the story card, the title
  // block (the masthead), and the scrubber's top edge.
  const SCREENS: { name: string; W: number; H: number; card: Rect; masthead: Rect; scrubberTop: number }[] = [
    {
      name: "1440x900",
      W: 1440,
      H: 900,
      card: { x: 32, y: 485, width: 420, height: 370 },
      masthead: { x: 36, y: 27, width: 626, height: 246 },
      scrubberTop: 814,
    },
    {
      name: "1280x720",
      W: 1280,
      H: 720,
      card: { x: 32, y: 314, width: 420, height: 370 },
      masthead: { x: 36, y: 22, width: 626, height: 246 },
      scrubberTop: 638,
    },
    {
      name: "900x700",
      W: 900,
      H: 700,
      card: { x: 27, y: 295, width: 420, height: 370 },
      masthead: { x: 27, y: 21, width: 626, height: 224 },
      scrubberTop: 619,
    },
  ];
  type Screen = (typeof SCREENS)[number];
  const chromeOf = (s: Screen, story = true): ChromeMetrics => ({
    viewportWidth: s.W,
    viewportHeight: s.H,
    titleBottom: s.masthead.y + s.masthead.height,
    bottomChromeTop: s.scrubberTop,
    panelWidth: 0,
    card: story ? s.card : null,
    masthead: story ? storyMastheadBand([s.masthead], s.W) : null, // as measureChrome reports it
  });
  const VIEW = new Vector3(0, 0, -1); // the Ascent's head-on story view
  const SWAY = (18 * Math.PI) / 180;

  const inputFor = (
    s: Screen,
    subject: Box3,
    keep: Vector3[],
    rect = computeUsableRect(chromeOf(s)),
  ): ClearFrameInput => ({
    fovDeg: 50,
    viewportWidth: s.W,
    viewportHeight: s.H,
    rect,
    view: VIEW,
    subject,
    keep,
    minDistance: 80,
    maxDistance: 2200,
  });

  /**
   * Independent check: solve the returned box the way rig.frameSubject does and
   * project each keep point at every drift turn. Returns the screen points.
   */
  function landed(input: ClearFrameInput, box: Box3, turns: number[] = [0]): [number, number][] {
    const target = box.getCenter(new Vector3());
    const sol = solveFrame({
      fovDeg: input.fovDeg,
      viewportWidth: input.viewportWidth,
      viewportHeight: input.viewportHeight,
      rect: input.rect,
      eye: target.clone().sub(VIEW),
      target,
      subject: box,
      context: null,
      minDistance: input.minDistance,
      maxDistance: input.maxDistance,
    });
    const k = input.viewportHeight / 2 / Math.tan((input.fovDeg * Math.PI) / 360);
    const out: [number, number][] = [];
    for (const p of input.keep) {
      for (const a of turns) {
        // Head-on view: right = +x, up = +y, forward = −z.
        const d = p.clone().sub(target).applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a));
        const vf = -d.z + sol.distance;
        out.push([
          input.viewportWidth / 2 + (k * (d.x - sol.offsetX)) / vf,
          input.viewportHeight / 2 - (k * (d.y + sol.offsetY)) / vf,
        ]);
      }
    }
    return out;
  }
  const inRect = (r: Rect, [x, y]: [number, number]): boolean =>
    x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
  const outsideAll = (s: Screen, pts: [number, number][]): number =>
    pts.filter(
      (p) => inRect(s.card, p) || inRect(s.masthead, p) || p[1] >= s.scrubberTop || p[0] < 0 || p[0] > s.W || p[1] < 0,
    ).length;

  it("the whole-map framing really did bury the early years under the card (the defect)", () => {
    // Composed into the pre-keep-out rect (the card only a bias), every
    // kindergarten standard lands on the card.
    const s = SCREENS[0];
    const { keep } = yearSubject("K");
    const input = inputFor(s, wholeMap, keep, computeUsableRect(chromeOf(s, false)));
    const pts = landed(input, wholeMap);
    expect(pts.filter((p) => inRect(s.card, p)).length).toBe(keep.length); // all 25
  });

  for (const s of SCREENS) {
    for (const grade of ["K", "1", "2", "3", "8"]) {
      it(`${s.name}: every grade-${grade} standard lands inside the keep-out rect`, () => {
        const { subject, keep } = yearSubject(grade);
        const input = inputFor(s, subject, keep);
        const plan = planClearFrame(input);
        expect(plan.covered).toBe(0);
        const pts = landed(input, plan.box);
        expect(pts.every((p) => inRect(input.rect, p))).toBe(true);
        expect(outsideAll(s, pts)).toBe(0); // clear of the card, the masthead, the scrubber
        // The padded box still holds the whole subject: nothing is dropped.
        expect(plan.box.containsBox(subject)).toBe(true);
      });
    }
  }

  it("keeps the year inside the rect while the idle drift sways the camera ±18°", () => {
    for (const s of SCREENS) {
      for (const grade of ["K", "3", "8"]) {
        const { subject, keep } = yearSubject(grade);
        const input = { ...inputFor(s, subject, keep), swayRad: SWAY };
        const plan = planClearFrame(input);
        expect(plan.covered, `${s.name} ${grade}`).toBe(0);
        const pts = landed(input, plan.box, [-SWAY, -SWAY / 2, 0, SWAY / 2, SWAY]);
        expect(outsideAll(s, pts), `${s.name} ${grade}`).toBe(0);
      }
    }
  });

  it("F3: at 900x700 the year frames beside the card and below the masthead, at full size", () => {
    const s = SCREENS[2];
    const rect = computeUsableRect(chromeOf(s));
    // The rect itself: right of the card's column, below the title block.
    expect(rect.x).toBeGreaterThan(s.card.x + s.card.width);
    expect(rect.y).toBeGreaterThan(s.masthead.y + s.masthead.height);
    for (const grade of ["K", "1", "2", "3", "4", "5", "6", "7", "8"]) {
      const { subject, keep } = yearSubject(grade);
      const input = { ...inputFor(s, subject, keep), swayRad: SWAY };
      const plan = planClearFrame(input);
      // Every standard of the year sits below the masthead and right of the card.
      const pts = landed(input, plan.box);
      expect(Math.min(...pts.map((p) => p[1])), grade).toBeGreaterThan(s.masthead.y + s.masthead.height);
      expect(Math.min(...pts.map((p) => p[0])), grade).toBeGreaterThan(s.card.x + s.card.width);
      // The old card-only pad shrank the frame to fit the strip above the card.
      // Against the keep-out rect any pad is a sliver: the year frames within
      // 5% of the plain fit of its subject.
      const c = subject.getCenter(new Vector3());
      const plain = solveFrame({
        fovDeg: 50,
        viewportWidth: s.W,
        viewportHeight: s.H,
        rect,
        eye: c.clone().sub(VIEW),
        target: c,
        subject,
        minDistance: 80,
        maxDistance: 2200,
      });
      expect(plan.distance / plain.distance, grade).toBeLessThan(1.05);
    }
  });

  it("leaves a subject that already stays inside untouched", () => {
    const s = SCREENS[0];
    const { keep } = yearSubject("8");
    const plan = planClearFrame(inputFor(s, wholeMap, keep));
    expect(plan.side).toBe("none");
    expect(plan.box.equals(wholeMap)).toBe(true);
  });
});
