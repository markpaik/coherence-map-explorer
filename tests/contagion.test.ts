// Unit tests for the pure contagion staging (src/stories/contagion.ts): family
// expansion of a missed parent, hop-depth wave ordering over the leads-to
// direction, and the damage → ring-target intensity mapping. The DAG helpers run
// against the real seed-1337 graph so the direction guarantee is proven on real
// data; the mapping runs on synthetic arrays for exactness.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import type { GraphCore } from "../src/data";
import {
  expandFamilies,
  bfsHops,
  contagionTargets,
  displayDamage,
  relativeRingFloor,
  sceneRingTargets,
  DAMAGE_DISPLAY_FLOOR,
} from "../src/stories/contagion";
import { createSelectorResolver } from "../src/stories/selectors";
import { createDamageEngine } from "../src/stories/damage";
import { STORIES } from "../src/stories/scripts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(HERE, "..");
const core: GraphCore = JSON.parse(
  readFileSync(resolvePath(ROOT, "public/data/graph-core.json"), "utf8"),
);

const N = core.nodes.length;
const idxById = new Map<string, number>();
const idxByCode = new Map<string, number>();
core.nodes.forEach((n, i) => {
  idxById.set(n.id, i);
  idxByCode.set(n.code, i);
});
const iOf = (code: string): number => idxByCode.get(code)!;

// Adjacency exactly as the player builds it: succ over prereq edges (kind 0).
const succ: number[][] = core.nodes.map(() => []);
const pred: number[][] = core.nodes.map(() => []);
for (const e of core.edges) {
  if (e.k !== 0) continue;
  const s = idxById.get(e.s);
  const t = idxById.get(e.t);
  if (s === undefined || t === undefined) continue;
  succ[s].push(t);
  pred[t].push(s);
}
const childIdx: number[][] = core.nodes.map((n) =>
  (n.children ?? []).map((c) => idxById.get(c)).filter((x): x is number => x !== undefined),
);
const childrenOf = (i: number): number[] => childIdx[i];

const gradeSet = (g: string): Set<number> => {
  const s = new Set<number>();
  core.nodes.forEach((n, i) => {
    if (n.grade === g) s.add(i);
  });
  return s;
};

describe("expandFamilies (real graph)", () => {
  it("a missed PARENT drags in its sub-standards", () => {
    // 4.NF.B.4 has three sub-standards; missing it must add all three.
    const parent = iOf("4.NF.B.4");
    const out = expandFamilies([parent], childrenOf);
    expect(out.has(parent)).toBe(true);
    for (const c of ["4.NF.B.4.a", "4.NF.B.4.b", "4.NF.B.4.c"]) {
      expect(out.has(iOf(c)), `expands ${c}`).toBe(true);
    }
    expect(out.size).toBe(4);
  });

  it("a missed LEAF standard expands to itself only", () => {
    const leaf = iOf("3.OA.A.2"); // no sub-standards
    const out = expandFamilies([leaf], childrenOf);
    expect([...out]).toEqual([leaf]);
  });

  it("a grade selector is unchanged (its sub-standards are already in the grade)", () => {
    const g3 = gradeSet("3");
    const out = expandFamilies(g3, childrenOf);
    expect(out.size).toBe(g3.size);
  });

  it("expansion is idempotent (children carry no further children here)", () => {
    const seed = expandFamilies([iOf("4.NF.B.4")], childrenOf);
    const again = expandFamilies(seed, childrenOf);
    expect(again.size).toBe(seed.size);
  });
});

describe("bfsHops honours the leads-to direction (real graph)", () => {
  it("seeds read hop 0", () => {
    const seeds = gradeSet("3");
    const hops = bfsHops(seeds, succ, N);
    for (const s of seeds) expect(hops[s]).toBe(0);
  });

  it("a direct successor of a seed reads hop 1", () => {
    // 4.NF.B.4 → 5.NF.B.4 is a prereq edge, so from a seed of {4.NF.B.4} the
    // successor lands one hop out.
    const hops = bfsHops([iOf("4.NF.B.4")], succ, N);
    expect(hops[iOf("4.NF.B.4")]).toBe(0);
    expect(hops[iOf("5.NF.B.4")]).toBe(1);
  });

  it("ancestors of the missed set are NEVER reached (stay -1)", () => {
    // Missing grade 3, nothing in grades K/1/2 (all prerequisites of grade 3)
    // may be ranked — the wave only flows forward.
    const hops = bfsHops(gradeSet("3"), succ, N);
    for (const g of ["K", "1", "2"]) {
      for (const i of gradeSet(g)) {
        expect(hops[i], `${core.nodes[i].code} must stay unranked`).toBe(-1);
      }
    }
  });

  it("hop is the SHORTEST forward distance, and every ranked node is a true successor", () => {
    const seeds = gradeSet("3");
    const hops = bfsHops(seeds, succ, N);
    for (let i = 0; i < N; i++) {
      if (hops[i] <= 0) continue;
      // every hop-h node has at least one predecessor at hop h-1
      const ok = pred[i].some((p) => hops[p] === hops[i] - 1);
      expect(ok, `${core.nodes[i].code} hop ${hops[i]} has a predecessor one hop nearer`).toBe(true);
    }
  });

  it("the ranked set equals the forward-reachable set (matches where damage lands)", () => {
    const seeds = gradeSet("3");
    const hops = bfsHops(seeds, succ, N);
    // independent forward reachability
    const seen = new Set<number>(seeds);
    const q = [...seeds];
    while (q.length) {
      const c = q.shift()!;
      for (const nx of succ[c]) if (!seen.has(nx)) { seen.add(nx); q.push(nx); }
    }
    let ranked = 0;
    for (let i = 0; i < N; i++) if (hops[i] >= 0) ranked++;
    expect(ranked).toBe(seen.size);
  });
});

describe("contagionTargets intensity + floor mapping", () => {
  it("intensity equals damage; a directly-missed node (1) stays the full ring", () => {
    const dmg = new Float32Array([1, 0.5, 0.2, 0]);
    const hops = Int32Array.from([0, 1, 2, -1]);
    const t = contagionTargets(dmg, hops, 0.1);
    expect(t.map((x) => ({ index: x.index, hop: x.hop }))).toEqual([
      { index: 0, hop: 0 },
      { index: 1, hop: 1 },
      { index: 2, hop: 2 },
    ]);
    expect(t[0].intensity).toBe(1); // directly-missed → today's full ring exactly
    expect(t[1].intensity).toBeCloseTo(0.5, 6);
    expect(t[2].intensity).toBeCloseTo(0.2, 6);
  });

  it("nodes below the floor get no ring", () => {
    const dmg = new Float32Array([0.09, 0.1, 0.11, 0]);
    const hops = Int32Array.from([1, 1, 1, 1]);
    const t = contagionTargets(dmg, hops, 0.1);
    expect(t.map((x) => x.index)).toEqual([1, 2]); // 0.09 and 0 excluded, 0.1 kept
  });

  it("intensity clamps at 1 and an unranked ringed node falls back to hop 0", () => {
    const dmg = new Float32Array([1.4, 0.3]);
    const hops = Int32Array.from([-1, 5]);
    const t = contagionTargets(dmg, hops, 0.1);
    expect(t.map((x) => ({ index: x.index, hop: x.hop }))).toEqual([
      { index: 0, hop: 0 }, // clamped intensity, hop -1 → 0
      { index: 1, hop: 5 },
    ]);
    expect(t[0].intensity).toBe(1); // 1.4 clamps to 1
    expect(t[1].intensity).toBeCloseTo(0.3, 6);
  });
});

describe("displayDamage (the authored-scene display floor)", () => {
  it("untouched stays exactly untouched", () => {
    const out = displayDamage(new Float32Array([0, 0, 0]));
    expect([...out]).toEqual([0, 0, 0]);
  });

  it("the lightest touch clears the floor, so it can never read as healthy", () => {
    const out = displayDamage(new Float32Array([0.001, 0.013, 0.029, 0.059]));
    for (const v of out) expect(v).toBeGreaterThanOrEqual(DAMAGE_DISPLAY_FLOOR);
  });

  it("a fully-missed standard still lands exactly on 1", () => {
    expect(displayDamage(new Float32Array([1]))[0]).toBe(1);
    expect(displayDamage(new Float32Array([1.6]))[0]).toBe(1); // clamped
  });

  it("keeps the real gradient: strictly order-preserving", () => {
    const raw = [0.059, 0.161, 0.25, 0.5, 0.667, 1];
    const out = displayDamage(Float32Array.from(raw));
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThan(out[i - 1]);
  });

  it("husks-only input (a damage:false scene) gains no partial values", () => {
    const out = displayDamage(new Float32Array([1, 0, 1, 0]));
    expect([...out]).toEqual([1, 0, 1, 0]);
  });
});

describe("relativeRingFloor (the scene's own distribution sets the bar)", () => {
  it("an empty distribution rings nothing", () => {
    expect(relativeRingFloor([], 0.4)).toBe(Infinity);
  });

  it("share 0.4 of ten values admits the top four", () => {
    const vals = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1];
    const floor = relativeRingFloor(vals, 0.4);
    expect(vals.filter((v) => v >= floor)).toHaveLength(4);
  });

  it("share 1 admits everything, share 0 only the maximum", () => {
    const vals = [0.2, 0.4, 0.1, 0.9];
    expect(vals.filter((v) => v >= relativeRingFloor(vals, 1))).toHaveLength(4);
    expect(vals.filter((v) => v >= relativeRingFloor(vals, 0))).toHaveLength(1);
  });

  it("scales across two orders of magnitude (a lost year vs a lost cluster)", () => {
    const year = [0.059, 0.161, 0.25, 0.667];
    const cluster = [0.029, 0.051, 0.072, 0.087];
    expect(year.filter((v) => v >= relativeRingFloor(year, 0.5))).toHaveLength(2);
    expect(cluster.filter((v) => v >= relativeRingFloor(cluster, 0.5))).toHaveLength(2);
  });
});

describe("sceneRingTargets (masked, relative, and separated)", () => {
  const hops = Int32Array.from([0, 1, 1, 2, 2]);

  it("never rings a standard outside the scene's lit set", () => {
    const raw = new Float32Array([1, 0.5, 0.4, 0.3, 0.2]);
    const lit = new Float32Array([1, 0, 1, 0, 1]);
    const t = sceneRingTargets(raw, hops, { lit, share: 1 });
    expect(t.map((x) => x.index)).toEqual([0, 2, 4]);
  });

  it("a hole always out-weighs the heaviest downstream ring", () => {
    const raw = new Float32Array([1, 0.9, 0.5, 0.2, 0.05]);
    const lit = new Float32Array(5).fill(1);
    const t = sceneRingTargets(raw, hops, { lit, share: 1, faint: [0.18, 0.5] });
    const husk = t.find((x) => x.index === 0)!;
    expect(husk.intensity).toBe(1);
    for (const x of t) if (x.index !== 0) expect(x.intensity).toBeLessThanOrEqual(0.5);
  });

  it("partial intensity rises with damage inside the scene's own band", () => {
    const raw = new Float32Array([0.05, 0.2, 0.5, 0.9]);
    const lit = new Float32Array(4).fill(1);
    const t = sceneRingTargets(raw, Int32Array.from([1, 1, 1, 1]), { lit, share: 1 });
    const byIndex = new Map(t.map((x) => [x.index, x.intensity]));
    expect(byIndex.get(0)!).toBeLessThan(byIndex.get(1)!);
    expect(byIndex.get(1)!).toBeLessThan(byIndex.get(2)!);
    expect(byIndex.get(2)!).toBeLessThan(byIndex.get(3)!);
  });

  it("only the top share of the lit exposure rings", () => {
    const raw = new Float32Array([0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1]);
    const lit = new Float32Array(10).fill(1);
    const t = sceneRingTargets(raw, new Int32Array(10), { lit, share: 0.4 });
    expect(t).toHaveLength(4);
  });

  it("a husks-only scene (damage:false) rings the husks and nothing else", () => {
    const raw = new Float32Array([1, 0, 1, 0, 0]);
    const lit = new Float32Array(5).fill(1);
    const t = sceneRingTargets(raw, hops, { lit, share: 0.4 });
    expect(t.map((x) => x.index)).toEqual([0, 2]);
    for (const x of t) expect(x.intensity).toBe(1);
  });

  it("carries the caller's per-node appear delay", () => {
    const raw = new Float32Array([1, 1]);
    const lit = new Float32Array(2).fill(1);
    const t = sceneRingTargets(raw, Int32Array.from([0, 0]), {
      lit,
      delayOf: (i) => i * 0.5,
    });
    expect(t.map((x) => x.delaySec)).toEqual([0, 0.5]);
  });
});

describe("the shipped scenes ring only what they light (real graph)", () => {
  const resolve = createSelectorResolver(core);
  const engine = createDamageEngine(core);
  const union = (sels: readonly string[]): Set<number> => {
    const out = new Set<number>();
    for (const s of sels) for (const i of resolve(s)) out.add(i);
    return out;
  };
  // The player's own pipeline for one authored scene, minus the GPU.
  const sceneState = (scene: (typeof STORIES)[number]["scenes"][number]) => {
    const lit = new Float32Array(N);
    for (const i of union(scene.state?.lit ?? [])) lit[i] = 1;
    const missed = expandFamilies(union(scene.state?.missed ?? []), childrenOf);
    let raw: Float32Array = new Float32Array(N);
    if (missed.size) {
      if (scene.state?.damage) {
        raw = engine.compute(new Set([...missed].map((i) => core.nodes[i].id)));
      } else {
        for (const i of missed) raw[i] = 1;
      }
    }
    const rings = sceneRingTargets(raw, bfsHops(missed, succ, N), { lit, share: 0.4 });
    const spot = new Set(scene.spotlight ? [...union(scene.spotlight)].filter((i) => lit[i] >= 0.5) : []);
    return { lit, raw, rings, spot };
  };

  it("no scene rings, spotlights, or tints a standard it leaves dark", () => {
    for (const story of STORIES) {
      if (story.interactive) continue; // drives its own damage from the reader's pick
      story.scenes.forEach((scene, si) => {
        const { lit, raw, rings, spot } = sceneState(scene);
        for (const r of rings) {
          expect(lit[r.index], `${story.id} s${si + 1} rings ${core.nodes[r.index].code}`).toBe(1);
        }
        for (const i of spot) expect(lit[i]).toBe(1);
        // and the damage the shader sees is the raw values through the same mask
        for (let i = 0; i < N; i++) {
          if (lit[i] < 0.5) expect(displayDamage(raw)[i] * lit[i]).toBe(0);
        }
      });
    }
  });

  it("March 2020 rings the lost year only — the grades ahead stay clean", () => {
    const scene = STORIES.find((s) => s.id === "vanished-year")!.scenes[2];
    const { rings } = sceneState(scene);
    expect(rings).toHaveLength(37); // grade 3, every one of it
    for (const r of rings) {
      expect(core.nodes[r.index].grade).toBe("3");
      expect(r.intensity).toBe(1);
    }
  });

  it("the opportunity myth's cluster scene keeps its nine husks and no exposure", () => {
    const scene = STORIES.find((s) => s.id === "opportunity-myth")!.scenes[2];
    const { rings, raw } = sceneState(scene);
    expect(rings).toHaveLength(9);
    for (const r of rings) expect(r.intensity).toBe(1);
    expect([...raw].filter((d) => d > 0 && d < 0.99)).toHaveLength(0);
  });

  it("swiss cheese scene 4 rings the four holes inside the ancestry, and only those at full weight", () => {
    const scene = STORIES.find((s) => s.id === "swiss-cheese")!.scenes[3];
    const { rings } = sceneState(scene);
    const full = rings.filter((r) => r.intensity === 1).map((r) => core.nodes[r.index].code).sort();
    expect(full).toEqual(["3.OA.A.2", "4.NF.B.4", "4.NF.B.4.c", "6.RP.A.2"]);
    // the family parts outside the ancestry are dark, so they never ring
    expect(rings.some((r) => core.nodes[r.index].code === "4.NF.B.4.a")).toBe(false);
    // and the downstream exposure rings faintly, well under a hole
    const faint = rings.filter((r) => r.intensity < 1);
    expect(faint.length).toBeGreaterThan(0);
    for (const f of faint) expect(f.intensity).toBeLessThanOrEqual(0.5);
  });

  it("every damage-on scene now floors its exposure into the visible band", () => {
    for (const story of STORIES) {
      if (story.interactive) continue;
      for (const scene of story.scenes) {
        if (!scene.state?.damage) continue;
        const { raw, lit } = sceneState(scene);
        const shown = displayDamage(raw);
        for (let i = 0; i < N; i++) {
          if (lit[i] < 0.5 || raw[i] <= 0) continue;
          expect(shown[i]).toBeGreaterThanOrEqual(DAMAGE_DISPLAY_FLOOR);
        }
      }
    }
  });
});
