// Finding 28: the story card, the masthead and the scrubber are KEEP-OUT zones
// for story framing (designer rules F1 to F4, 2026-09).
//
// The defect: the desktop card counted only as a 61-120px sideways bias, so the
// standards a card narrates landed behind it. At 1024x700 the swiss-cheese
// coda reads "Four lights remain: the three ringed holes and the seventh-grade
// standard they hold up." and two of the four sat behind the card
// (3.OA.A.2@119,578 and 4.NF.B.4@376,375). starts-with-counting put K.CC.A.1
// behind the card at 1600x1000.
//
// These tests frame real scenes the way the player does (applyCamera: the
// spine is the subject, the scene's lit set the context, pullback 2.6) into the
// usable rect computed from chrome measured live, then project every narrated
// standard and check where it lands. The browser census (l2 census) measures
// the same thing on the running app at every F4 viewport.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { Vector3 } from "three";
import type { GraphCore } from "../src/data";
import {
  computeUsableRect,
  solveFrame,
  storyMastheadBand,
  type ChromeMetrics,
  type Rect,
} from "../src/scene/frame";
import { MIN_FIT_EXTENT, nodeBoundingBox } from "../src/state/machine";
import { createSelectorResolver } from "../src/stories/selectors";
import { STORIES, findStory } from "../src/stories/scripts";

const HERE = dirname(fileURLToPath(import.meta.url));
const core: GraphCore = JSON.parse(readFileSync(resolvePath(HERE, "..", "public/data/graph-core.json"), "utf8"));
const resolve = createSelectorResolver(core);
// Every story plays in the Ascent (pose 1): read pos2.
const ascent = {
  getPosition(i: number, out: Vector3): Vector3 {
    const p = core.nodes[i].pos2;
    return out.set(p[0], p[1], p[2]);
  },
};
const union = (sels: readonly string[]): number[] => {
  const out = new Set<number>();
  for (const s of sels) for (const i of resolve(s)) out.add(i);
  return [...out];
};

// Story chrome measured live on the merged chrome (main 6b61cba: the title
// block carries the license line, so it is taller), from the l2 census with
// drift off: the card, the title block, and the scrubber's top edge. The card's height changes scene to scene; its
// column does not, and the column is what the rect leaves out.
interface Screen {
  name: string;
  W: number;
  H: number;
  card: Rect;
  masthead: Rect;
  scrubberTop: number;
}
const SCREENS: Screen[] = [
  {
    name: "1024x700",
    W: 1024,
    H: 700,
    card: { x: 31, y: 191, width: 420, height: 474 },
    masthead: { x: 31, y: 21, width: 626, height: 235 },
    scrubberTop: 619,
  },
  {
    name: "1440x900",
    W: 1440,
    H: 900,
    card: { x: 32, y: 381, width: 420, height: 474 },
    masthead: { x: 36, y: 27, width: 626, height: 246 },
    scrubberTop: 814,
  },
  {
    name: "900x700",
    W: 900,
    H: 700,
    card: { x: 27, y: 191, width: 420, height: 474 },
    masthead: { x: 27, y: 21, width: 626, height: 224 },
    scrubberTop: 619,
  },
];
const chromeOf = (s: Screen): ChromeMetrics => ({
  viewportWidth: s.W,
  viewportHeight: s.H,
  titleBottom: s.masthead.y + s.masthead.height,
  bottomChromeTop: s.scrubberTop,
  panelWidth: 0,
  card: s.card,
  masthead: storyMastheadBand([s.masthead], s.W), // as measureChrome reports it
});

// player.ts applyCamera, restated: the narrated set (spine, else fit set)
// frames untrimmed, the lit set is the context (5% trim above 8 nodes), and the
// fit may retreat 2.6x for it.
const STORY_CONTEXT_PULLBACK = 2.6;
const TRIM_ABOVE = 8;
const CONTEXT_TRIM = 0.05;
const VIEW = new Vector3(0, 0, -1); // the Ascent's head-on story view (azimuth 0, polar π/2)
const K_FOV = 50;

function frameScene(
  s: Screen,
  spine: number[],
  lit: number[],
  rect: Rect = computeUsableRect(chromeOf(s)),
  trim = 0,
): [number, number][] {
  const subject = nodeBoundingBox(ascent, spine, trim, MIN_FIT_EXTENT);
  const context = lit.length
    ? nodeBoundingBox(ascent, lit, lit.length > TRIM_ABOVE ? CONTEXT_TRIM : 0, MIN_FIT_EXTENT)
    : null;
  const target = subject.getCenter(new Vector3());
  const sol = solveFrame({
    fovDeg: K_FOV,
    viewportWidth: s.W,
    viewportHeight: s.H,
    rect,
    eye: target.clone().sub(VIEW),
    target,
    subject,
    context,
    maxPullback: STORY_CONTEXT_PULLBACK,
    minDistance: 80,
    maxDistance: 2200,
  });
  const k = s.H / 2 / Math.tan((K_FOV * Math.PI) / 360);
  return spine.map((i) => {
    const d = ascent.getPosition(i, new Vector3()).sub(target);
    const vf = -d.z + sol.distance;
    return [s.W / 2 + (k * (d.x - sol.offsetX)) / vf, s.H / 2 - (k * (d.y + sol.offsetY)) / vf];
  });
}

const inRect = (r: Rect, [x, y]: [number, number]): boolean =>
  x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

/** The census categories: behind the card, under the masthead, under the scrubber, off screen. */
function census(s: Screen, pts: [number, number][]): { card: number; masthead: number; scrubber: number; off: number } {
  let card = 0;
  let masthead = 0;
  let scrubber = 0;
  let off = 0;
  for (const p of pts) {
    if (p[0] < 0 || p[0] > s.W || p[1] < 0 || p[1] > s.H) off++;
    else {
      if (inRect(s.card, p)) card++;
      if (inRect(s.masthead, p)) masthead++;
      if (p[1] >= s.scrubberTop) scrubber++;
    }
  }
  return { card, masthead, scrubber, off };
}

const sceneOf = (id: string, index: number) => {
  const story = findStory(id);
  if (!story) throw new Error(`no story ${id}`);
  return story.scenes[index];
};
/** What a scene narrates: its spine, else its fit set. */
const narrated = (id: string, index: number): number[] => {
  const cam = sceneOf(id, index).camera!;
  if (cam.spine?.length) return union(cam.spine);
  if (cam.fit === "all") return core.nodes.map((_n, i) => i);
  return union(cam.fit);
};
const litOf = (id: string, index: number): number[] => union(sceneOf(id, index).state?.lit ?? []);

describe("finding 28: a scene's narrated standards frame clear of the story chrome", () => {
  it("swiss-cheese scene 5: all four lights land in the usable rect, none behind the card", () => {
    const codes = narrated("swiss-cheese", 5).map((i) => core.nodes[i].code).sort();
    expect(codes).toEqual(["3.OA.A.2", "4.NF.B.4", "6.RP.A.2", "7.RP.A.2"]);
    for (const s of SCREENS) {
      const pts = frameScene(s, narrated("swiss-cheese", 5), litOf("swiss-cheese", 5));
      const rect = computeUsableRect(chromeOf(s));
      expect(pts.every((p) => inRect(rect, p)), s.name).toBe(true);
      expect(census(s, pts), s.name).toEqual({ card: 0, masthead: 0, scrubber: 0, off: 0 });
    }
  });

  it("starts-with-counting scene 2: K.CC.A.1 lands clear of the card", () => {
    const spine = narrated("starts-with-counting", 2);
    const kcc = spine.findIndex((i) => core.nodes[i].code === "K.CC.A.1");
    expect(kcc).toBeGreaterThanOrEqual(0);
    for (const s of SCREENS) {
      const pts = frameScene(s, spine, litOf("starts-with-counting", 2));
      expect(inRect(s.card, pts[kcc]), s.name).toBe(false);
      expect(census(s, pts), s.name).toEqual({ card: 0, masthead: 0, scrubber: 0, off: 0 });
    }
  });

  it("every spine scene of every story frames clear at 1024x700, 1440x900 and 900x700", () => {
    for (const story of STORIES) {
      story.scenes.forEach((scene, index) => {
        if (!scene.camera?.spine?.length) return;
        const spine = narrated(story.id, index);
        for (const s of SCREENS) {
          const pts = frameScene(s, spine, litOf(story.id, index));
          expect(census(s, pts), `${story.id} scene ${index} at ${s.name}`).toEqual({
            card: 0,
            masthead: 0,
            scrubber: 0,
            off: 0,
          });
        }
      });
    }
  });

  it("every fit scene (no spine) frames its whole fit set clear, untrimmed", () => {
    for (const story of STORIES) {
      story.scenes.forEach((scene, index) => {
        const cam = scene.camera;
        if (!cam || cam.spine?.length || cam.fit === "all") return;
        const fit = narrated(story.id, index);
        for (const s of SCREENS) {
          const pts = frameScene(s, fit, litOf(story.id, index));
          expect(census(s, pts), `${story.id} scene ${index} at ${s.name}`).toEqual({
            card: 0,
            masthead: 0,
            scrubber: 0,
            off: 0,
          });
        }
      });
    }
  });

  it("the trim defect: a 10% fit trim drops a narrated standard off the frame at 900x700", () => {
    // Merged census, 900x700, opportunity-myth scene 3 (grades 4 and 5), fit
    // trimmed: "5.OA.A.1@903,616:off". The trim drops the band's depth
    // extremes, and perspective throws the one nearest the camera furthest out.
    const s = SCREENS[2];
    const fit = narrated("opportunity-myth", 3);
    const lit = litOf("opportunity-myth", 3);
    const rect = computeUsableRect(chromeOf(s));
    const inside = (pts: [number, number][]): number => pts.filter((p) => inRect(rect, p)).length;
    expect(inside(frameScene(s, fit, lit, rect, 0.1))).toBeLessThan(fit.length);
    expect(inside(frameScene(s, fit, lit, rect, 0))).toBe(fit.length);
  });

  it("the defect: without the keep-outs, the swiss-cheese coda buries its own lights under the card", () => {
    // The pre-keep-out rect: full width, the title's modest strip only.
    const s = SCREENS[0];
    const open = computeUsableRect({ ...chromeOf(s), card: null, masthead: null });
    const pts = frameScene(s, narrated("swiss-cheese", 5), litOf("swiss-cheese", 5), open);
    expect(census(s, pts).card).toBeGreaterThan(0);
  });
});
