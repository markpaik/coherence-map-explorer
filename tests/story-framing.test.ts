// Story camera grammar + the design law the pandemic story set.
//
// The law (docs/STORIES.md): a story's lit set is MONOTONE (it only grows, one
// band at a time), the camera leads half a step ahead of the lit frontier by
// framing a SPINE rather than the whole lit context, and the viewer never
// re-orients. These tests assert the parts that are checkable off-screen: the
// trimmed fit maths, that every spine resolves and lies inside what the scene
// actually lights, and the monotonicity of the rebuilt stories.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { Vector3 } from "three";
import type { GraphCore } from "../src/data";
import { createSelectorResolver } from "../src/stories/selectors";
import { nodeBoundingBox } from "../src/state/machine";
import { STORIES, findStory, type StoryScene } from "../src/stories/scripts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(HERE, "..");
const core: GraphCore = JSON.parse(
  readFileSync(resolvePath(ROOT, "public/data/graph-core.json"), "utf8"),
);
const resolve = createSelectorResolver(core);
const indexByCode = new Map<string, number>();
core.nodes.forEach((n, i) => indexByCode.set(n.code, i));

/** A NodesHandle-shaped stand-in over a plain position table. */
const positions = (pts: [number, number, number][]) => ({
  getPosition(i: number, out: Vector3): Vector3 {
    const p = pts[i];
    return out.set(p[0], p[1], p[2]);
  },
});

const union = (sels: readonly string[]): Set<number> => {
  const out = new Set<number>();
  for (const s of sels) for (const i of resolve(s)) out.add(i);
  return out;
};

describe("nodeBoundingBox (the fit's outlier trim)", () => {
  const size = (b: { min: Vector3; max: Vector3 }): [number, number, number] => [
    b.max.x - b.min.x,
    b.max.y - b.min.y,
    b.max.z - b.min.z,
  ];

  it("drops the far outliers so the fit follows the mass, not the tail", () => {
    // Ten points tight around the origin, one stray a long way out.
    const pts: [number, number, number][] = [];
    for (let i = 0; i < 10; i++) pts.push([i, 0, 0]);
    pts.push([1000, 0, 0]);
    const idx = pts.map((_p, i) => i);
    expect(size(nodeBoundingBox(positions(pts), idx, 0, 0))[0]).toBeGreaterThan(900);
    expect(size(nodeBoundingBox(positions(pts), idx, 0.1, 0))[0]).toBeLessThan(20);
  });

  it("drops exactly ceil(trim × n) points", () => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i < 20; i++) pts.push([0, 0, 0]);
    // Two strays; a 10% trim on 20 points drops 2, so both should go.
    pts[18] = [500, 0, 0];
    pts[19] = [-500, 0, 0];
    const idx = pts.map((_p, i) => i);
    expect(size(nodeBoundingBox(positions(pts), idx, 0.1, 0))[0]).toBe(0);
    // A 5% trim drops only 1 of the 2, so the survivor still sets the size.
    expect(size(nodeBoundingBox(positions(pts), idx, 0.05, 0))[0]).toBeGreaterThan(200);
  });

  it("never drops everything, and honours the minimum extent", () => {
    const pts: [number, number, number][] = [[0, 0, 0]];
    expect(size(nodeBoundingBox(positions(pts), [0], 1, 90))).toEqual([90, 90, 90]);
    expect(size(nodeBoundingBox(positions(pts), [], 0.1, 90))).toEqual([90, 90, 90]);
  });

  it("keeps each axis SEPARATE — a deep slab is not framed as a cube", () => {
    // The defect a bounding sphere had: grades K-2 in the Ascent pose measure
    // 216 x 91 x 244, and their sphere (radius 169) framed a 338 cube, so the
    // depth the camera cannot see decided the on-screen size.
    const pts: [number, number, number][] = [
      [-108, -45, -122],
      [108, 45, 122],
    ];
    expect(size(nodeBoundingBox(positions(pts), [0, 1], 0, 0))).toEqual([216, 90, 244]);
  });
});

describe("scene spines (the camera leads the lit frontier)", () => {
  const scenesWithSpine: { story: string; index: number; scene: StoryScene }[] = [];
  for (const story of STORIES)
    story.scenes.forEach((scene, index) => {
      if (scene.camera?.spine) scenesWithSpine.push({ story: story.id, index, scene });
    });

  it("the refit stories all carry spines", () => {
    expect(scenesWithSpine.length).toBeGreaterThanOrEqual(8);
  });

  it("every spine selector resolves to at least one standard", () => {
    for (const { story, index, scene } of scenesWithSpine) {
      for (const sel of scene.camera!.spine!) {
        expect(resolve(sel).size, `${story} scene ${index + 1}: "${sel}"`).toBeGreaterThan(0);
      }
    }
  });

  it("every spine node is INSIDE what its scene actually lights", () => {
    // The spine is what the card narrates; framing something the scene leaves
    // dark would point the camera at nothing.
    for (const { story, index, scene } of scenesWithSpine) {
      const lit = union(scene.state?.lit ?? []);
      if (lit.size === 0) continue;
      for (const i of union(scene.camera!.spine!)) {
        expect(lit.has(i), `${story} scene ${index + 1}: spine node outside lit set`).toBe(true);
      }
    }
  });

  it("a spine is always smaller than the context it sits in (otherwise it is not a spine)", () => {
    for (const { story, index, scene } of scenesWithSpine) {
      const fit = scene.camera!.fit;
      if (fit === "all") continue;
      const spineSize = union(scene.camera!.spine!).size;
      const fitSize = union(fit).size;
      expect(spineSize, `${story} scene ${index + 1}`).toBeLessThanOrEqual(fitSize);
    }
  });
});

describe("the monotone-lit law", () => {
  // A story's lit set may only GROW scene to scene, so the reader never has to
  // re-orient. Exceptions are declared here by name, with the reason.
  // Indices are 0-based. Every entry is a DESIGNER decision with a reason, not a
  // convenience: adding one silently is the drift this list exists to catch.
  const ALLOWED_SHRINK: Record<string, number[]> = {
    // Swiss cheese: s4 (idx 3) dives from the whole map into one 76-node
    // ancestry, s5 (idx 4) travels forward with the student into 7-8-HS, and s6
    // (idx 5) ends on the four standards that are the fix.
    "swiss-cheese": [3, 4, 5],
    // The counting story is a deliberate pivot: s3 (idx 2) turns around from
    // one high-school standard's ancestry to one kindergarten standard's
    // descendants, and s4 (idx 3) steps into the K-1 classroom for the empathy
    // beat before the coda re-lights everything.
    "starts-with-counting": [2, 3],
    // Find where it begins opens on ONE standard and only grows; its coda
    // ("do this yourself") re-lights the whole map, which is growth.
    "find-where-it-begins": [],
    // The opportunity myth's coda (idx 5) drops back to the two years compared.
    "opportunity-myth": [5],
  };

  it("the pandemic story, the design law's source, needs NO exception at all", () => {
    expect(ALLOWED_SHRINK["vanished-year"]).toBeUndefined();
  });

  for (const story of STORIES) {
    if (story.interactive) continue;
    it(`${story.id}: the lit set only grows, except where declared`, () => {
      const allowed = new Set(ALLOWED_SHRINK[story.id] ?? []);
      let prev: Set<number> | null = null;
      story.scenes.forEach((scene, i) => {
        const lit = union(scene.state?.lit ?? []);
        if (prev && lit.size && prev.size && !allowed.has(i)) {
          for (const p of prev) {
            expect(lit.has(p), `${story.id} scene ${i + 1} went dark on a lit standard`).toBe(
              true,
            );
          }
        }
        prev = lit;
      });
    });
  }

  it("the rebuilt opportunity myth is strictly monotone across all six scenes", () => {
    const om = findStory("opportunity-myth")!;
    expect(om.scenes.length).toBe(6);
    const sizes = om.scenes.map((s) => union(s.state?.lit ?? []).size);
    // Scenes 1-5 grow; scene 6 is the declared coda that returns to grades 4-5.
    for (let i = 1; i < 5; i++) expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
    for (let i = 1; i < 5; i++) {
      const prev = union(om.scenes[i - 1].state!.lit!);
      const cur = union(om.scenes[i].state!.lit!);
      for (const p of prev) expect(cur.has(p)).toBe(true);
    }
  });

  it("the rebuilt opportunity myth follows ONE student on ONE missing cluster", () => {
    const om = findStory("opportunity-myth")!;
    const missedSets = om.scenes
      .map((s) => s.state?.missed ?? [])
      .filter((m) => m.length > 0);
    // Every scene that names a missing set names the SAME one (scenes 3, 4, 5).
    expect(missedSets.length).toBe(3);
    for (const m of missedSets) expect(m).toEqual(missedSets[0]);
  });
});

describe("the 4.NF.B cluster the opportunity myth hardcodes", () => {
  it("matches the live graph's 4.NF.B cluster exactly", () => {
    const fromGraph = core.nodes
      .filter((n) => n.clusterCode === "4.NF.B")
      .map((n) => n.code)
      .sort();
    const om = findStory("opportunity-myth")!;
    const fromScript = [...(om.scenes[2].state!.missed ?? [])]
      .map((s) => s.replace(/^code:/, ""))
      .sort();
    expect(fromScript).toEqual(fromGraph);
    expect(fromGraph.length).toBe(9);
  });

  it("the same list drives every scene that names it (missed, spotlight, spine)", () => {
    const om = findStory("opportunity-myth")!;
    const cluster = [...om.scenes[2].state!.missed!].sort();
    expect([...om.scenes[3].state!.missed!].sort()).toEqual(cluster);
    expect([...om.scenes[4].state!.missed!].sort()).toEqual(cluster);
    expect([...om.scenes[5].spotlight!].sort()).toEqual(cluster);
  });
});

describe("find where it begins: the re-anchored 8.EE.C.7 chain", () => {
  const preds = new Map<string, string[]>();
  for (const n of core.nodes) preds.set(n.id, []);
  for (const e of core.edges) if (e.k === 0) preds.get(e.t)!.push(e.s);
  const idOf = (code: string): string => core.nodes[indexByCode.get(code)!].id;
  const directPrereq = (child: string, parent: string): boolean =>
    preds.get(idOf(child))!.includes(idOf(parent));

  it("8.EE.C.7 is a PARTIAL parent: no ancestry of its own, all of it on 8.EE.C.7.b", () => {
    expect(resolve("ancestry:8.EE.C.7").size).toBe(1); // just itself
    expect(resolve("ancestry:8.EE.C.7.b").size).toBe(120); // 119 + the node
  });

  it("family-ancestry rolls the family up: 122 standards, reaching kindergarten", () => {
    const fam = resolve("family-ancestry:8.EE.C.7");
    expect(fam.size).toBe(122); // 119 ancestors + the parent + its 2 sub-standards
    expect(fam.has(indexByCode.get("K.CC.A.1")!)).toBe(true);
    for (const c of ["8.EE.C.7", "8.EE.C.7.a", "8.EE.C.7.b"])
      expect(fam.has(indexByCode.get(c)!)).toBe(true);
  });

  it("family-ancestry equals plain ancestry for a standard with no sub-standards", () => {
    expect(resolve("family-ancestry:F-IF.A.1")).toEqual(resolve("ancestry:F-IF.A.1"));
    expect(resolve("family-ancestry:K.CC.A.1")).toEqual(resolve("ancestry:K.CC.A.1"));
  });

  it("plain ancestry: is UNCHANGED (the frozen story numbers still hold)", () => {
    expect(resolve("ancestry:7.RP.A.2").size).toBe(76); // "75 earlier ones"
    expect(resolve("ancestry:F-IF.A.1").size).toBe(78);
    expect(resolve("descendants:K.CC.A.1").size).toBe(226);
  });

  it("the walk-back chain the cards name is real, and mostly single-hop", () => {
    expect(directPrereq("8.EE.C.7.b", "7.EE.B.4.a")).toBe(true);
    expect(directPrereq("7.EE.B.4.a", "6.EE.B.7")).toBe(true);
    expect(directPrereq("6.EE.B.7", "5.NF.A.1")).toBe(true);
    // The floor: the meaning of the equal sign, a transitive ancestor below it.
    expect(resolve("ancestry:5.NF.A.1").has(indexByCode.get("1.OA.D.7")!)).toBe(true);
  });

  it("every rung sits on the family ancestry, and descends in grade order", () => {
    const fam = resolve("family-ancestry:8.EE.C.7");
    const rungs = ["8.EE.C.7", "7.EE.B.4.a", "6.EE.B.7", "5.NF.A.1", "1.OA.D.7"];
    const order = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "HS"];
    let last = Infinity;
    for (const code of rungs) {
      const i = indexByCode.get(code)!;
      expect(fam.has(i), `${code} is not on the chain`).toBe(true);
      const rank = order.indexOf(core.nodes[i].grade);
      expect(rank).toBeLessThan(last);
      last = rank;
    }
  });

  it("the story no longer shares its anchor with Swiss cheese", () => {
    const fwib = findStory("find-where-it-begins")!;
    const swiss = findStory("swiss-cheese")!;
    const anchorsOf = (s: typeof fwib): Set<string> => {
      const out = new Set<string>();
      for (const scene of s.scenes) if (scene.state?.focus) out.add(scene.state.focus);
      return out;
    };
    const shared = [...anchorsOf(fwib)].filter((a) => anchorsOf(swiss).has(a));
    expect(shared).toEqual([]);
    expect([...anchorsOf(fwib)]).toEqual(["8.EE.C.7"]);
  });
});

describe("the retired story", () => {
  it("third-vs-eighth is gone and findStory reports it missing", () => {
    expect(findStory("third-vs-eighth")).toBeUndefined();
    expect(STORIES.some((s) => s.id === "third-vs-eighth")).toBe(false);
  });

  it("findStory resolves every shipped story by id", () => {
    for (const s of STORIES) expect(findStory(s.id)).toBe(s);
  });
});
