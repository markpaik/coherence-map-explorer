import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import type { GraphCore } from "../src/data";
import { createSelectorResolver } from "../src/stories/selectors";
import { createDamageEngine } from "../src/stories/damage";
import { STORIES } from "../src/stories/scripts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(HERE, "..");
const core: GraphCore = JSON.parse(
  readFileSync(resolvePath(ROOT, "public/data/graph-core.json"), "utf8"),
);

const resolve = createSelectorResolver(core);
const damage = createDamageEngine(core);

const indexByCode = new Map<string, number>();
core.nodes.forEach((n, i) => indexByCode.set(n.code, i));
const idsOf = (indices: Iterable<number>): Set<string> => {
  const out = new Set<string>();
  for (const i of indices) out.add(core.nodes[i].id);
  return out;
};

describe("selector resolution (real graph)", () => {
  it("grade:3 → 37 standards", () => {
    expect(resolve("grade:3").size).toBe(37);
  });

  it("code:7.RP.A.2 → exactly 1", () => {
    expect(resolve("code:7.RP.A.2").size).toBe(1);
  });

  it("ancestry:7.RP.A.2 → 76 (75 ancestors + the node)", () => {
    const anc = resolve("ancestry:7.RP.A.2");
    expect(anc.size).toBe(76);
    expect(anc.has(indexByCode.get("7.RP.A.2")!)).toBe(true);
  });

  it("descendants:K.CC.A.1 → 226 (225 descendants + the node)", () => {
    // NOTE: docs/STORIES.md and the frozen card copy say "234 standards ... 49%"
    // descend from K.CC.A.1. The seed-1337 build (757 prereq edges) actually
    // yields 225 descendants (226 incl. the node, ~47%). This test asserts the
    // TRUTH of the graph; the 234/235 figure in the copy is a flagged
    // discrepancy for the designer (it cannot be fixed here — scripts.ts and
    // docs/ are frozen).
    const desc = resolve("descendants:K.CC.A.1");
    expect(desc.size).toBe(226);
    expect(desc.has(indexByCode.get("K.CC.A.1")!)).toBe(true);
  });

  it("all → every node; unknown selectors resolve empty without throwing", () => {
    expect(resolve("all").size).toBe(core.nodes.length);
    expect(resolve("nonsense").size).toBe(0);
    expect(resolve("grade:Q").size).toBe(0);
    expect(resolve("code:9.ZZ.Z.9").size).toBe(0);
    expect(resolve("ancestry:9.ZZ.Z.9").size).toBe(0);
  });

  it("domain: and strand: resolve non-empty", () => {
    expect(resolve("domain:3.NF").size).toBeGreaterThan(0);
    expect(resolve("strand:number").size).toBeGreaterThan(0);
  });
});

describe("damage engine (real graph)", () => {
  it("missing grade 3 damages 271 downstream standards (excluding the 37 missed)", () => {
    const missedIdx = resolve("grade:3");
    const dmg = damage.compute(idsOf(missedIdx));
    let downstream = 0;
    for (let v = 0; v < core.nodes.length; v++) {
      if (missedIdx.has(v)) continue;
      if (dmg[v] > 0) downstream++;
    }
    expect(downstream).toBe(271);
  });

  it("missed standards read damage 1; nodes with no ancestors read 0", () => {
    const missedIdx = resolve("grade:3");
    const dmg = damage.compute(idsOf(missedIdx));
    for (const i of missedIdx) expect(dmg[i]).toBe(1);
    // K.CC.A.1 has no prerequisites, and isn't in grade 3 → damage 0.
    expect(dmg[indexByCode.get("K.CC.A.1")!]).toBe(0);
  });

  it("F-IF.A.1 (the concept of a function) carries damage from a lost grade 3", () => {
    const dmg = damage.compute(idsOf(resolve("grade:3")));
    expect(dmg[indexByCode.get("F-IF.A.1")!]).toBeGreaterThan(0);
  });

  it("edgeDamage is the max of the two endpoint node damages", () => {
    const dmg = damage.compute(idsOf(resolve("grade:3")));
    const ed = damage.edgeDamage(dmg);
    expect(ed.length).toBe(core.edges.length);
    const idIndex = new Map<string, number>();
    core.nodes.forEach((n, i) => idIndex.set(n.id, i));
    core.edges.forEach((e, j) => {
      const s = idIndex.get(e.s)!;
      const t = idIndex.get(e.t)!;
      expect(ed[j]).toBeCloseTo(Math.max(dmg[s], dmg[t]), 6);
    });
  });
});

describe("story scripts validate against the graph", () => {
  const sceneSelectors = (scene: (typeof STORIES)[number]["scenes"][number]): string[] => {
    const sels: string[] = [];
    if (scene.state?.missed) sels.push(...scene.state.missed);
    if (scene.state?.spotlight) sels.push(...scene.state.spotlight);
    if (scene.camera && Array.isArray(scene.camera.fit)) sels.push(...scene.camera.fit);
    return sels;
  };

  it("every selector in every scene resolves non-empty", () => {
    for (const story of STORIES) {
      story.scenes.forEach((scene, si) => {
        for (const sel of sceneSelectors(scene)) {
          const size = resolve(sel).size;
          expect(size, `${story.id} scene ${si + 1}: "${sel}"`).toBeGreaterThan(0);
        }
        // focus is a bare code (not a selector) — it must resolve to a node.
        if (scene.state?.focus) {
          expect(
            indexByCode.has(scene.state.focus),
            `${story.id} scene ${si + 1}: focus "${scene.state.focus}"`,
          ).toBe(true);
        }
      });
    }
  });

  it("every citeUrl is a resolvable DOI (https://doi.org/…)", () => {
    for (const story of STORIES) {
      for (const scene of story.scenes) {
        if (scene.card.citeUrl) {
          expect(scene.card.citeUrl, `${story.id}: ${scene.card.title}`).toMatch(
            /^https:\/\/doi\.org\//,
          );
        }
      }
    }
  });

  it("exactly one cited scene carries a cultural-hook cite without a DOI (TNTP)", () => {
    let citeNoUrl = 0;
    for (const story of STORIES) {
      for (const scene of story.scenes) {
        if (scene.card.cite && !scene.card.citeUrl) citeNoUrl++;
      }
    }
    expect(citeNoUrl).toBe(1);
  });

  it("there are six stories, each with at least one scene", () => {
    expect(STORIES.length).toBe(6);
    for (const story of STORIES) {
      expect(story.scenes.length).toBeGreaterThan(0);
      expect(story.id).toBeTruthy();
      expect(story.title).toBeTruthy();
    }
  });
});
