// Regression guard for HUNT B: mobile Browse's family roll-up must match the 3D
// panel's exactly. Both now call the one shared helper, machine.rollUpFamily —
// this suite proves (a) the helper is correct against an independent flat
// edge-scan over all 480 standards, (b) it fires for EVERY family parent (the
// old browse gate only fired for edgeless parents, dropping data on 5), and (c)
// browse.ts and machine.ts carry no local reimplementation that could drift.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rollUpFamily } from "../src/state/machine";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

interface Node {
  id: string;
  code: string;
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

// Adjacency built exactly as machine.ts / browse.ts build it at runtime.
const idxById = new Map<string, number>();
core.nodes.forEach((n, i) => idxById.set(n.id, i));
const N = core.nodes.length;
const codeOf = (i: number): string => core.nodes[i].code;

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
  (n.children ?? [])
    .map((c) => idxById.get(c))
    .filter((x): x is number => x !== undefined),
);

const familyParents = core.nodes
  .map((_, i) => i)
  .filter((i) => partsOf[i].length > 0);

// Independent ground truth: a fresh flat scan of the RAW edge list (not the
// pre-built adjacency the helper consumes). For a parent, roll up the focus's
// own neighbours plus every child's, dropping family-internal members; for a
// standalone standard, just its own direct neighbours.
function groundTruth(focus: number): {
  buildsOn: number[];
  leadsTo: number[];
  related: number[];
  rolledUp: boolean;
} {
  const parts = partsOf[focus];
  const rolledUp = parts.length > 0;
  const members = rolledUp ? [focus, ...parts] : [focus];
  const memberSet = new Set(members);
  const family = new Set(members); // family-internal members to exclude
  const bo = new Set<number>();
  const lt = new Set<number>();
  const re = new Set<number>();
  for (const e of core.edges) {
    const s = idxById.get(e.s);
    const t = idxById.get(e.t);
    if (s === undefined || t === undefined) continue;
    if (e.k === 0) {
      if (memberSet.has(t) && !family.has(s)) bo.add(s); // s -> member: a prereq
      if (memberSet.has(s) && !family.has(t)) lt.add(t); // member -> t: a successor
    } else {
      if (memberSet.has(s) && !family.has(t)) re.add(t);
      if (memberSet.has(t) && !family.has(s)) re.add(s);
    }
  }
  const asc = (a: number, b: number): number => a - b;
  return {
    buildsOn: [...bo].sort(asc),
    leadsTo: [...lt].sort(asc),
    related: [...re].sort(asc),
    rolledUp,
  };
}

const sortNums = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);

describe("family roll-up: shared helper matches ground truth (all 480 nodes)", () => {
  it("rollUpFamily === independent flat-edge-scan for every standard", () => {
    for (let focus = 0; focus < N; focus++) {
      const got = rollUpFamily(focus, partsOf[focus], preds, succ, relatedAdj);
      const want = groundTruth(focus);
      expect(sortNums(got.buildsOn), `buildsOn ${codeOf(focus)}`).toEqual(
        want.buildsOn,
      );
      expect(sortNums(got.leadsTo), `leadsTo ${codeOf(focus)}`).toEqual(
        want.leadsTo,
      );
      expect(sortNums(got.related), `related ${codeOf(focus)}`).toEqual(
        want.related,
      );
      expect(got.rolledUp, `rolledUp ${codeOf(focus)}`).toBe(want.rolledUp);
    }
  });

  it("rolledUp fires for EVERY family parent, never for a standalone", () => {
    expect(familyParents.length).toBe(40);
    for (const p of familyParents) {
      expect(
        rollUpFamily(p, partsOf[p], preds, succ, relatedAdj).rolledUp,
        `${codeOf(p)} is a parent`,
      ).toBe(true);
    }
    for (let i = 0; i < N; i++) {
      if (partsOf[i].length === 0) {
        expect(
          rollUpFamily(i, partsOf[i], preds, succ, relatedAdj).rolledUp,
        ).toBe(false);
      }
    }
  });
});

describe("family roll-up: the divergence HUNT B fixed", () => {
  const byCode = (c: string): number => {
    const i = core.nodes.findIndex((n) => n.code === c);
    expect(i, `code ${c} exists`).toBeGreaterThanOrEqual(0);
    return i;
  };

  it("6.RP.A.3 surfaces its children's Builds-on (the original catch)", () => {
    const i = byCode("6.RP.A.3");
    const r = rollUpFamily(i, partsOf[i], preds, succ, relatedAdj);
    expect(r.buildsOn.map(codeOf).sort()).toEqual([
      "5.G.A.2",
      "6.RP.A.1",
      "6.RP.A.2",
    ]);
    // ...and both related pairs the old edgeless-only gate dropped.
    expect(r.related.map(codeOf).sort()).toEqual(["6.EE.B.7", "6.EE.C.9"]);
  });

  it("all 5 data-losing parents now gain their children's connections", () => {
    for (const c of ["4.NF.B.4", "6.RP.A.3", "7.EE.B.4", "7.NS.A.2", "8.EE.C.7"]) {
      const i = byCode(c);
      const own =
        preds[i].length + succ[i].length + relatedAdj[i].length; // parent's own edges
      const r = rollUpFamily(i, partsOf[i], preds, succ, relatedAdj);
      const rolled = r.buildsOn.length + r.leadsTo.length + r.related.length;
      // The old browse gate (own edges present ⇒ no roll-up) would have shown
      // only `own`; the fix shows strictly more.
      expect(rolled, `${c} rolled > own`).toBeGreaterThan(own);
    }
  });
});

describe("family roll-up: no local reimplementation survives", () => {
  const browseSrc = readFileSync(resolve(ROOT, "src/ui/browse.ts"), "utf8");
  const machineSrc = readFileSync(resolve(ROOT, "src/state/machine.ts"), "utf8");

  it("browse.ts calls the shared helper and dropped its stale gate", () => {
    expect(browseSrc).toContain("rollUpFamily(");
    // The stale hand-copied edgeless-only gate must be gone.
    expect(browseSrc).not.toContain(
      "!buildsOn.length && !leadsTo.length && !rel.length",
    );
    // No local roll closure left behind.
    expect(browseSrc).not.toMatch(/const roll = \(adj: number\[\]\[\]\)/);
  });

  it("machine.ts exports the helper and computeFocus routes through it", () => {
    expect(machineSrc).toContain("export function rollUpFamily(");
    expect(machineSrc).toContain(
      "rollUpFamily(focus, parts, preds, succ, relatedAdj)",
    );
  });
});
