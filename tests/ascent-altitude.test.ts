// Regression guard for the Ascent ALTITUDE family roll-up (scripts/build-graph.ts,
// depthById). The base longest-prerequisite-chain DP left umbrella parents whose
// connections live on their SUB-standards sitting on the massif FLOOR (depth 0)
// and edgeless elaboration sub-standards floating below their umbrella. The
// roll-up rides the whole family together: a parent >= its highest child, a
// sub-standard >= its parent's OWN-edge base depth, with prereq edges
// re-propagated so every edge still points upward. This suite proves those
// three properties against an INDEPENDENT re-derivation of the base depths from
// the raw edge list — not the values the pipeline emitted.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

interface Node {
  id: string;
  code: string;
  depth: number;
  pos2: [number, number, number];
  children?: string[];
}
interface Edge {
  s: string;
  t: string;
  k: 0 | 1;
}
const core: { nodes: Node[]; edges: Edge[] } = JSON.parse(
  readFileSync(resolve(ROOT, "public/data/graph-core.json"), "utf8"),
);

const byId = new Map(core.nodes.map((n) => [n.id, n]));
const codeOf = (id: string): string => byId.get(id)?.code ?? id;
const emittedDepth = new Map(core.nodes.map((n) => [n.id, n.depth]));

// Independent ground truth: the BASE longest-prerequisite-chain depth (the DP
// BEFORE any family roll-up), recomputed from the raw prereq edge list.
const succ = new Map<string, string[]>();
const indeg = new Map<string, number>();
for (const n of core.nodes) {
  succ.set(n.id, []);
  indeg.set(n.id, 0);
}
for (const e of core.edges) {
  if (e.k !== 0) continue;
  succ.get(e.s)!.push(e.t);
  indeg.set(e.t, indeg.get(e.t)! + 1);
}
const baseDepth = new Map(core.nodes.map((n) => [n.id, 0]));
{
  const q = core.nodes.map((n) => n.id).filter((id) => indeg.get(id) === 0);
  const ind = new Map(indeg);
  while (q.length) {
    const u = q.shift()!;
    for (const v of succ.get(u)!) {
      baseDepth.set(v, Math.max(baseDepth.get(v)!, baseDepth.get(u)! + 1));
      ind.set(v, ind.get(v)! - 1);
      if (ind.get(v) === 0) q.push(v);
    }
  }
}

const familyParents = core.nodes.filter((n) => (n.children?.length ?? 0) > 0);

describe("ascent altitude roll-up: F-BF.A.1 (the reported bug)", () => {
  it("F-BF.A.1 rides at its highest child's altitude, not the massif floor", () => {
    const p = core.nodes.find((n) => n.code === "F-BF.A.1")!;
    expect(p).toBeTruthy();
    const kids = p.children!.map((c) => emittedDepth.get(c)!);
    const maxKid = Math.max(...kids);
    // The relation, not a hard-coded constant: parent == its deepest child.
    expect(emittedDepth.get(p.id)).toBe(maxKid);
    // ...and it is unmistakably a high-altitude umbrella, not a foundation.
    expect(emittedDepth.get(p.id)!).toBeGreaterThanOrEqual(20);
  });
});

describe("ascent altitude roll-up: universal family invariants", () => {
  it("every family parent sits at or above its highest sub-standard", () => {
    expect(familyParents.length).toBe(40);
    for (const p of familyParents) {
      const maxKid = Math.max(...p.children!.map((c) => emittedDepth.get(c)!));
      expect(
        emittedDepth.get(p.id)!,
        `${p.code} >= max child (${maxKid})`,
      ).toBeGreaterThanOrEqual(maxKid);
    }
  });

  it("no umbrella parent whose family carries edges is stranded on the floor", () => {
    // The bug's signature: a family parent at depth 0 while a child sits deep.
    for (const p of familyParents) {
      const maxKid = Math.max(...p.children!.map((c) => emittedDepth.get(c)!));
      if (maxKid > 0) {
        expect(emittedDepth.get(p.id)!, `${p.code} not stranded`).toBeGreaterThan(0);
      }
    }
  });

  it("every sub-standard rides at least as high as its parent's own-edge base", () => {
    // The symmetric mirror: an edgeless elaboration (e.g. F-LE.A.1.a) is lifted
    // to its parent's structural base depth so it clusters with its family.
    for (const p of familyParents) {
      const base = baseDepth.get(p.id)!; // parent's OWN-edge base (pre-roll-up)
      for (const c of p.children!) {
        expect(
          emittedDepth.get(c)!,
          `${codeOf(c)} >= own-edge base of ${p.code} (${base})`,
        ).toBeGreaterThanOrEqual(base);
      }
    }
  });

  it("F-LE.A.1's edgeless sub-standards are lifted to the family altitude", () => {
    // All three carry no prerequisites of their own; without the child floor
    // they would strand at depth 0 beneath F-LE.A.1 (depth 23).
    const p = core.nodes.find((n) => n.code === "F-LE.A.1")!;
    const pd = emittedDepth.get(p.id)!;
    expect(pd).toBeGreaterThanOrEqual(20);
    for (const c of p.children!) {
      expect(emittedDepth.get(c)!, `${codeOf(c)} at family altitude`).toBe(pd);
    }
  });
});

describe("ascent altitude roll-up: the depth invariant survives", () => {
  it("every prerequisite edge points strictly upward (depth and pos2 y)", () => {
    let maxDepth = 0;
    for (const e of core.edges) {
      if (e.k !== 0) continue;
      const s = byId.get(e.s)!;
      const t = byId.get(e.t)!;
      expect(
        emittedDepth.get(t.id)! >= emittedDepth.get(s.id)! + 1,
        `${s.code} (${emittedDepth.get(s.id)}) -> ${t.code} (${emittedDepth.get(t.id)})`,
      ).toBe(true);
      expect(t.pos2[1]).toBeGreaterThan(s.pos2[1]);
      maxDepth = Math.max(maxDepth, emittedDepth.get(t.id)!);
    }
    // The roll-up lifts nodes onto already-occupied interior layers; the deepest
    // CCSS chain is untouched, so the massif keeps its 0..30 height.
    expect(maxDepth).toBe(30);
  });

  it("every emitted depth is a non-negative integer", () => {
    for (const n of core.nodes) {
      expect(Number.isInteger(n.depth)).toBe(true);
      expect(n.depth).toBeGreaterThanOrEqual(0);
    }
  });
});
