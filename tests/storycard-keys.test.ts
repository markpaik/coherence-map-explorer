// Story card key routing: who owns ArrowLeft / ArrowRight.
//
// The defect: the card stepped scenes on every ArrowLeft / ArrowRight, wherever
// focus was. A segmented control invites the arrow keys, so a keyboard reader
// on a FORMATION segment stepped the story by accident, and on the one-scene
// lose-a-year story (Next reads "Done") an arrow ENDED it. Now a control group
// on the card (role="group") owns its arrows and moves focus among its own
// members; everywhere else the arrows step scenes as before.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { arrowsStepScenes } from "../src/ui/storycard";
import { rovingIndex } from "../src/ui/chipgroup";

/** A minimal element tree: enough for closest('[role="group"]') and contains(). */
class El {
  constructor(
    readonly name: string,
    readonly parent: El | null = null,
    readonly role: string | null = null,
  ) {}
  closest(selector: string): El | null {
    expect(selector).toBe('[role="group"]');
    for (let n: El | null = this; n; n = n.parent) if (n.role === "group") return n;
    return null;
  }
  contains(node: El): boolean {
    for (let n: El | null = node; n; n = n.parent) if (n === this) return true;
    return false;
  }
}

// The live layout: the card is a dialog holding the body copy, the extra slot
// (the lose-a-year chip group), the controls row and the FORMATION group; the
// scrubber is a separate group OUTSIDE the card.
const body = new El("body");
const card = new El("card", body, "dialog");
const bodyCopy = new El("story-body", card);
const extra = new El("story-extra", card);
const chips = new El("lose-year", extra, "group");
const chip5 = new El("chip-5", chips);
const controls = new El("story-controls", card);
const backBtn = new El("back", controls);
const nextBtn = new El("next", controls);
const formation = new El("formation-pick", card, "group");
const segAscent = new El("seg-ascent", formation);
const scrubber = new El("story-scrubber", body, "group");
const dot = new El("dot", scrubber);

describe("arrowsStepScenes: control groups on the card own their arrows", () => {
  it("never steps from a FORMATION segment (the story must not step or end)", () => {
    expect(arrowsStepScenes(segAscent, card)).toBe(false);
  });

  it("never steps from a lose-a-year chip", () => {
    expect(arrowsStepScenes(chip5, card)).toBe(false);
  });

  it("steps from Back, Next and the card body, as before", () => {
    expect(arrowsStepScenes(backBtn, card)).toBe(true);
    expect(arrowsStepScenes(nextBtn, card)).toBe(true);
    expect(arrowsStepScenes(bodyCopy, card)).toBe(true);
  });

  it("steps from the scrubber: a group, but not one on the card", () => {
    expect(arrowsStepScenes(dot, card)).toBe(true);
  });

  it("steps when nothing (or the page body) has focus", () => {
    expect(arrowsStepScenes(null, card)).toBe(true);
    expect(arrowsStepScenes(body, card)).toBe(true);
  });
});

describe("FORMATION segments rove on arrow keys", () => {
  // Authored, Constellation, Ascent.
  it("Right moves to the next segment and wraps; Left moves back and wraps", () => {
    expect(rovingIndex("ArrowRight", 0, 3)).toBe(1);
    expect(rovingIndex("ArrowRight", 2, 3)).toBe(0);
    expect(rovingIndex("ArrowLeft", 0, 3)).toBe(2);
  });

  it("Enter and Space are left to the button's own click (activation, as today)", () => {
    expect(rovingIndex("Enter", 1, 3)).toBeNull();
    expect(rovingIndex(" ", 1, 3)).toBeNull();
  });
});

describe("the wiring (source guards)", () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const read = (p: string): string => readFileSync(resolvePath(HERE, "..", p), "utf8");
  const card = read("src/ui/storycard.ts");
  const formationSrc = read("src/stories/formationpick.ts");
  const player = read("src/stories/player.ts");

  it("both scene-stepping arrows ask arrowsStepScenes first", () => {
    const fn = card.slice(card.indexOf("function onKeydown("));
    const right = fn.slice(fn.indexOf('case "ArrowRight":'), fn.indexOf('case "ArrowLeft":'));
    const left = fn.slice(fn.indexOf('case "ArrowLeft":'), fn.indexOf('case "Escape":'));
    for (const branch of [right, left]) {
      expect(branch).toContain("if (!arrowsStepScenes(document.activeElement, card)) return;");
      // The gate comes BEFORE the key is consumed, so the group still receives it.
      expect(branch.indexOf("arrowsStepScenes")).toBeLessThan(branch.indexOf("preventDefault"));
    }
  });

  it("both control groups on the card are role=group (what the gate keys on)", () => {
    expect(formationSrc).toContain('group.setAttribute("role", "group")');
    expect(player).toContain('wrap.setAttribute("role", "group")');
  });

  it("the FORMATION group moves focus with rovingIndex on keydown", () => {
    const at = formationSrc.indexOf('group.addEventListener("keydown"');
    expect(at).toBeGreaterThan(-1);
    const handler = formationSrc.slice(at, formationSrc.indexOf("});", at));
    expect(handler).toContain("rovingIndex(e.key, at, segments.length)");
    expect(handler).toContain(".focus()");
    // Focus only: an arrow never changes the pin.
    expect(handler).not.toContain("onChange");
  });
});
