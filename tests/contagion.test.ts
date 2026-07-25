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
import { expandFamilies, bfsHops, contagionTargets } from "../src/stories/contagion";

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
