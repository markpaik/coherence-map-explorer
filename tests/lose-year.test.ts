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
//       1440x900 and most of grade 3 under it at 1280x720. planClearFrame pads
//       the framed box toward the card so the chosen year lands clear of it.

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
import { solveFrame, type Rect } from "../src/scene/frame";
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

describe("finding 12: the chosen year frames clear of the story card", () => {
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

  // Measured live (desktop story chrome): the title band, the scrubber, the card.
  const SCREENS: { name: string; W: number; H: number; rect: Rect; card: Rect; biasX: number }[] = [
    {
      name: "1440x900",
      W: 1440,
      H: 900,
      rect: { x: 0, y: 99, width: 1440, height: 900 - 99 - 82 },
      card: { x: 32, y: 485, width: 420, height: 370 },
      biasX: 86.4,
    },
    {
      name: "1280x720",
      W: 1280,
      H: 720,
      rect: { x: 0, y: 79.2, width: 1280, height: 720 - 79.2 - 82 },
      card: { x: 32, y: 314, width: 420, height: 370 },
      biasX: 76.8,
    },
  ];
  const VIEW = new Vector3(0, 0, -1); // the Ascent's head-on story view

  const inputFor = (s: (typeof SCREENS)[number], subject: Box3, keep: Vector3[]): ClearFrameInput => ({
    fovDeg: 50,
    viewportWidth: s.W,
    viewportHeight: s.H,
    rect: s.rect,
    bias: { x: s.biasX, y: 0 },
    view: VIEW,
    subject,
    keep,
    occluder: s.card,
    minDistance: 80,
    maxDistance: 2200,
  });

  /**
   * Independent check: solve the returned box the way rig.frameSubject does,
   * project each keep point at every drift turn, count the ones on the card.
   */
  function coveredAfter(input: ClearFrameInput, box: Box3, turns: number[] = [0]): number {
    const target = box.getCenter(new Vector3());
    const sol = solveFrame({
      fovDeg: input.fovDeg,
      viewportWidth: input.viewportWidth,
      viewportHeight: input.viewportHeight,
      rect: input.rect,
      bias: input.bias,
      eye: target.clone().sub(VIEW),
      target,
      subject: box,
      context: null,
      minDistance: input.minDistance,
      maxDistance: input.maxDistance,
    });
    const k = input.viewportHeight / 2 / Math.tan((input.fovDeg * Math.PI) / 360);
    const c = input.occluder!;
    let covered = 0;
    for (const p of input.keep) {
      const hit = turns.some((a) => {
        // Head-on view: right = +x, up = +y, forward = −z.
        const d = p.clone().sub(target).applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a));
        const vf = -d.z + sol.distance;
        const sx = input.viewportWidth / 2 + (k * (d.x - sol.offsetX)) / vf;
        const sy = input.viewportHeight / 2 - (k * (d.y + sol.offsetY)) / vf;
        return sx >= c.x && sx <= c.x + c.width && sy >= c.y && sy <= c.y + c.height;
      });
      if (hit) covered++;
    }
    return covered;
  }

  it("the whole-map framing really does bury the early years under the card (the defect)", () => {
    const s = SCREENS[0];
    const { keep } = yearSubject("K");
    const input = inputFor(s, wholeMap, keep);
    expect(coveredAfter(input, wholeMap)).toBe(keep.length); // all 25 kindergarten standards
  });

  for (const s of SCREENS) {
    for (const grade of ["K", "1", "2", "3", "8"]) {
      it(`${s.name}: every grade-${grade} standard lands clear of the card`, () => {
        const { subject, keep } = yearSubject(grade);
        const input = inputFor(s, subject, keep);
        const plan = planClearFrame(input);
        expect(plan.covered).toBe(0);
        expect(coveredAfter(input, plan.box)).toBe(0);
        // The padded box still holds the whole subject: nothing is dropped.
        expect(plan.box.containsBox(subject)).toBe(true);
      });
    }
  }

  it("keeps the year clear while the idle drift sways the camera ±18°", () => {
    const sway = (18 * Math.PI) / 180;
    for (const s of SCREENS) {
      const { subject, keep } = yearSubject("3");
      const input = { ...inputFor(s, subject, keep), swayRad: sway, gapPx: 0 };
      const plan = planClearFrame(input);
      expect(plan.covered, s.name).toBe(0);
      expect(coveredAfter(input, plan.box, [-sway, -sway / 2, 0, sway / 2, sway]), s.name).toBe(0);
    }
  });

  it("leaves a subject that already clears the card untouched", () => {
    const s = SCREENS[0];
    const { keep } = yearSubject("8");
    const plan = planClearFrame(inputFor(s, wholeMap, keep));
    expect(plan.side).toBe("none");
    expect(plan.box.equals(wholeMap)).toBe(true);
  });

  it("does nothing without an occluder (a phone's full-width card is bottom chrome)", () => {
    const s = SCREENS[1];
    const { subject, keep } = yearSubject("K");
    const plan = planClearFrame({ ...inputFor(s, subject, keep), occluder: null });
    expect(plan.side).toBe("none");
    expect(plan.box.equals(subject)).toBe(true);
  });
});
