// resolveConnections is the ONE resolver the 3D panel (machine.computeModel) and
// mobile Browse route through, so their connection semantics can never drift. It
// wraps rollUpFamily (parent roll-up) and adds the edgeless-child inherit case.
// This suite pins each branch against the real built graph as the fixture:
//   - inherit: an edgeless sub-standard whose family carries the edges
//   - parent roll-up: an edgeless parent AND an umbrella parent
//   - partial parent: a parent that owns edges AND has connected children
//   - a sub-standard that owns edges (never inherits)
//   - a standalone standard (own sets, no roll-up)
//   - a genuinely isolated solo (truthfully empty)

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConnections, rollUpFamily } from "../src/state/machine";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

interface Node {
  id: string;
  code: string;
  children?: string[];
  parent?: string;
}
interface Edge {
  s: string;
  t: string;
  k: 0 | 1;
}
const core: { nodes: Node[]; edges: Edge[] } = JSON.parse(
  readFileSync(resolve(ROOT, "public/data/graph-core.json"), "utf8"),
);

// Adjacency + family arrays, built exactly as machine.ts / browse.ts build them.
const idxById = new Map<string, number>();
core.nodes.forEach((n, i) => idxById.set(n.id, i));
const preds: number[][] = core.nodes.map(() => []);
const succ: number[][] = core.nodes.map(() => []);
const relatedAdj: number[][] = core.nodes.map(() => []);
for (const e of core.edges) {
  const s = idxById.get(e.s);
  const t = idxById.get(e.t);
  if (s === undefined || t === undefined) continue;
  if (e.k === 0) {
    succ[s].push(t);
    preds[t].push(s);
  } else {
    relatedAdj[s].push(t);
    relatedAdj[t].push(s);
  }
}
const partsOf: number[][] = core.nodes.map((n) =>
  (n.children ?? []).map((c) => idxById.get(c)).filter((x): x is number => x !== undefined),
);
const parentOf: (number | undefined)[] = core.nodes.map((n) =>
  n.parent !== undefined ? idxById.get(n.parent) : undefined,
);

const byCode = (c: string): number => {
  const i = core.nodes.findIndex((n) => n.code === c);
  expect(i, `code ${c} exists`).toBeGreaterThanOrEqual(0);
  return i;
};
const codeOf = (i: number): string => core.nodes[i].code;
const codes = (xs: number[]): string[] => xs.map(codeOf).sort();
const resolve1 = (i: number) =>
  resolveConnections(i, partsOf, parentOf, preds, succ, relatedAdj);

describe("resolveConnections — the edgeless-child inherit case", () => {
  it("4.MD.C.5.b inherits its family's connections from 4.MD.C.5", () => {
    const child = byCode("4.MD.C.5.b");
    const parent = byCode("4.MD.C.5");
    const r = resolve1(child);
    expect(r.inheritedFrom, "inheritedFrom is the parent index").toBe(parent);
    expect(r.rolledUp, "the child itself is not a parent").toBe(false);
    // The inherited sets ARE the parent's rolled-up sets, family-internal excluded.
    expect(codes(r.leadsTo)).toEqual(["4.MD.C.6", "4.MD.C.7", "G-CO.A.1"]);
    expect(codes(r.related)).toEqual(["4.G.A.1", "4.G.A.2"]);
    expect(r.buildsOn).toEqual([]);
    const fam = rollUpFamily(parent, partsOf[parent], preds, succ, relatedAdj);
    expect(codes(r.buildsOn)).toEqual(codes(fam.buildsOn));
    expect(codes(r.leadsTo)).toEqual(codes(fam.leadsTo));
    expect(codes(r.related)).toEqual(codes(fam.related));
  });

  it("inheritance fires ONLY when the child owns no edges of its own", () => {
    // 6.RP.A.3.a owns edges, so it keeps exactly its own sets and never inherits.
    const child = byCode("6.RP.A.3.a");
    const r = resolve1(child);
    expect(r.inheritedFrom, "a child with own edges does not inherit").toBeUndefined();
    expect(r.rolledUp).toBe(false);
    expect(codes(r.buildsOn)).toEqual(codes(preds[child]));
    expect(codes(r.leadsTo)).toEqual(codes(succ[child]));
    expect(codes(r.related)).toEqual(codes(relatedAdj[child]));
    const own = r.buildsOn.length + r.leadsTo.length + r.related.length;
    expect(own, "6.RP.A.3.a has its own connections").toBeGreaterThan(0);
  });
});

describe("resolveConnections — parent roll-up (unchanged rollUpFamily rule)", () => {
  for (const c of ["4.NF.B.3", "F-BF.A.1"]) {
    it(`${c} (edgeless parent) rolls its sub-standards' connections up`, () => {
      const i = byCode(c);
      const r = resolve1(i);
      expect(r.rolledUp, "a family parent rolls up").toBe(true);
      expect(r.inheritedFrom, "a parent does not inherit").toBeUndefined();
      const total = r.buildsOn.length + r.leadsTo.length + r.related.length;
      expect(total, `${c} surfaces its children's connections`).toBeGreaterThan(0);
      const fam = rollUpFamily(i, partsOf[i], preds, succ, relatedAdj);
      expect(codes(r.buildsOn)).toEqual(codes(fam.buildsOn));
      expect(codes(r.leadsTo)).toEqual(codes(fam.leadsTo));
      expect(codes(r.related)).toEqual(codes(fam.related));
    });
  }

  it("6.RP.A.3 (owns edges AND has connected children) still rolls up", () => {
    const i = byCode("6.RP.A.3");
    const r = resolve1(i);
    expect(r.rolledUp).toBe(true);
    expect(r.inheritedFrom).toBeUndefined();
    // The .a-.d hold the inbound lineage the parent lacks on its own.
    expect(codes(r.buildsOn)).toEqual(["5.G.A.2", "6.RP.A.1", "6.RP.A.2"]);
  });
});

describe("resolveConnections — standalone and solo", () => {
  it("1.MD.A.1 (standalone) returns its own direct sets, no roll-up", () => {
    const i = byCode("1.MD.A.1");
    const r = resolve1(i);
    expect(r.rolledUp).toBe(false);
    expect(r.inheritedFrom).toBeUndefined();
    expect(codes(r.buildsOn)).toEqual(codes(preds[i]));
    expect(codes(r.leadsTo)).toEqual(codes(succ[i]));
    expect(codes(r.related)).toEqual(codes(relatedAdj[i]));
  });

  it("3.MD.A.1 (solo isolated) resolves to nothing, truthfully", () => {
    const i = byCode("3.MD.A.1");
    const r = resolve1(i);
    expect(r.buildsOn).toEqual([]);
    expect(r.leadsTo).toEqual([]);
    expect(r.related).toEqual([]);
    expect(r.rolledUp).toBe(false);
    expect(r.inheritedFrom).toBeUndefined();
  });
});
