import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGraph,
  sanitizeField,
  absolutize,
  safeLinkUrl,
} from "../scripts/build-graph";
import { classifyStations } from "../src/scene/stations";
import { classifyDrafts } from "../src/scene/drafts";
import { deriveContourLevels } from "../src/scene/contours";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DATA = resolve(ROOT, "public/data");

interface OutNode {
  id: string;
  code: string;
  grade: string;
  strand: string;
  pos: [number, number, number];
}
interface OutEdge {
  s: string;
  t: string;
  k: 0 | 1;
  c: [number, number, number];
}
interface GraphCore {
  meta: { standards: number; prereqEdges: number; relatedEdges: number };
  grades: { id: string; x0: number; x1: number }[];
  nodes: OutNode[];
  edges: OutEdge[];
}

const core: GraphCore = JSON.parse(
  readFileSync(resolve(DATA, "graph-core.json"), "utf8"),
);
const GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "HS"];
const detailShards = Object.fromEntries(
  GRADES.map((g) => [
    g,
    JSON.parse(readFileSync(resolve(DATA, `details/${g}.json`), "utf8")) as Record<
      string,
      Record<string, unknown>
    >,
  ]),
);
const allHtmlFields: string[] = [];
for (const shard of Object.values(detailShards)) {
  for (const entry of Object.values(shard)) {
    for (const key of ["desc", "example", "progressions"]) {
      const v = entry[key];
      if (typeof v === "string") allHtmlFields.push(v);
    }
  }
}

describe("counts", () => {
  it("has 480 standards, 757 prereq, 142 related", () => {
    expect(core.meta.standards).toBe(480);
    expect(core.meta.prereqEdges).toBe(757);
    expect(core.meta.relatedEdges).toBe(142);
    expect(core.nodes.length).toBe(480);
    expect(core.edges.length).toBe(757 + 142);
  });
});

describe("prerequisite graph is a DAG", () => {
  it("topological sort visits every node", () => {
    const ids = new Set(core.nodes.map((n) => n.id));
    const indeg = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const id of ids) {
      indeg.set(id, 0);
      adj.set(id, []);
    }
    for (const e of core.edges) {
      if (e.k !== 0) continue;
      adj.get(e.s)!.push(e.t);
      indeg.set(e.t, indeg.get(e.t)! + 1);
    }
    const queue = [...ids].filter((id) => indeg.get(id) === 0);
    let visited = 0;
    while (queue.length) {
      const n = queue.shift()!;
      visited++;
      for (const m of adj.get(n)!) {
        indeg.set(m, indeg.get(m)! - 1);
        if (indeg.get(m) === 0) queue.push(m);
      }
    }
    expect(visited).toBe(ids.size);
  });
});

describe("golden codes", () => {
  const byId = new Map(core.nodes.map((n) => [n.id, n]));
  const codes = new Set(core.nodes.map((n) => n.code));
  it("id 9 derives 1.MD.A.1", () => {
    expect(byId.get("9")?.code).toBe("1.MD.A.1");
  });
  it("F-IF.A.1 exists", () => {
    expect(codes.has("F-IF.A.1")).toBe(true);
  });
  it("4.NF.B.3.a exists (dotted standard ordinal)", () => {
    expect(codes.has("4.NF.B.3.a")).toBe(true);
  });
});

describe("node geometry", () => {
  const bandById = Object.fromEntries(core.grades.map((g) => [g.id, g]));
  const strands = new Set(["number", "algebra", "geometry", "data"]);
  it("every node has a valid strand", () => {
    for (const n of core.nodes) expect(strands.has(n.strand)).toBe(true);
  });
  it("pose A (constellation): finite positions inside each grade band's x-interval", () => {
    for (const n of core.nodes) {
      for (const v of n.pos) expect(Number.isFinite(v)).toBe(true);
      const b = bandById[n.grade];
      expect(n.pos[0]).toBeGreaterThanOrEqual(b.x0 - 0.01);
      expect(n.pos[0]).toBeLessThanOrEqual(b.x1 + 0.01);
    }
  });
  it("pose B (ascent): every prerequisite edge points upward (depth invariant)", () => {
    const nodeById = new Map(
      core.nodes.map((n) => [n.id, n as OutNode & { pos2: number[]; depth: number }]),
    );
    for (const n of core.nodes as (OutNode & { pos2?: number[]; depth?: number })[]) {
      expect(n.pos2 && n.pos2.length === 3).toBe(true);
      for (const v of n.pos2!) expect(Number.isFinite(v)).toBe(true);
      expect(Number.isInteger(n.depth)).toBe(true);
      // The timeline survives the unravel at BAND granularity: the ascent
      // alignment may shift x within the node's grade band (standards align
      // above their prerequisites) but never across band boundaries.
      const b = bandById[n.grade];
      expect(n.pos2![0]).toBeGreaterThanOrEqual(b.x0 - 0.01);
      expect(n.pos2![0]).toBeLessThanOrEqual(b.x1 + 0.01);
    }
    let maxDepth = 0;
    for (const e of core.edges) {
      if (e.k !== 0) continue;
      const s = nodeById.get(e.s)!;
      const t = nodeById.get(e.t)!;
      expect(t.depth).toBeGreaterThan(s.depth);
      expect(t.pos2[1]).toBeGreaterThan(s.pos2[1]);
      maxDepth = Math.max(maxDepth, t.depth);
    }
    expect(maxDepth).toBe(30); // the deepest prerequisite chain in the CCSS
  });
  it("assigns every HS standard to Appendix A courses (69/52/26/16 primary, 23 dual)", () => {
    const hs = core.nodes.filter((n) => n.grade === "HS") as (OutNode & {
      courses?: string[];
    })[];
    expect(hs.length).toBe(163);
    const primary: Record<string, number> = {};
    let dual = 0;
    for (const n of hs) {
      expect(n.courses && n.courses.length > 0).toBe(true);
      primary[n.courses![0]] = (primary[n.courses![0]] ?? 0) + 1;
      if (n.courses!.length > 1) dual++;
    }
    expect(primary).toEqual({ A1: 69, G: 52, A2: 26, ADV: 16 });
    expect(dual).toBe(23);
    // K-8 nodes never carry courses.
    expect(core.nodes.some((n) => n.grade !== "HS" && (n as { courses?: string[] }).courses)).toBe(false);
  });
  it("emits spiral markers: K-8 grade etches + 4 course arcs", () => {
    const withMarkers = core.grades.filter((g) => (g as { marker?: number[] }).marker);
    expect(withMarkers.map((g) => g.id)).toEqual(["K", "1", "2", "3", "4", "5", "6", "7", "8"]);
    const courses = (core as unknown as { courses: { id: string; marker: number[] }[] }).courses;
    expect(courses.map((c) => c.id)).toEqual(["A1", "G", "A2", "ADV"]);
    for (const c of courses) for (const v of c.marker) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("pose C (blueprint)", () => {
  // Column model: K,1..8 → 0..8; HS by primary course (courses[0]) → 9..12.
  const COURSE_ORDER = ["A1", "G", "A2", "ADV"];
  const columnOf = (n: OutNode & { grade: string; courses?: string[] }): number =>
    n.grade === "HS" ? 9 + COURSE_ORDER.indexOf(n.courses![0]) : GRADES.indexOf(n.grade);
  const bp = core.nodes as (OutNode & { pos3?: number[]; courses?: string[] })[];

  it("every node carries a lifted pos3 (z on a block plane 16..146, gutter 8)", () => {
    expect(bp.length).toBe(480);
    // Round-12 lift (rescaled ~3.7× from round-11's imperceptible 8..40): each
    // domain block rides its own z-plane (16 + 26k capped 146) like layered paper
    // in a pop-up card; the edgeless side gutter is one quiet z=8 plane. The legal
    // planes for k = 0,1,2,… (capped at 146) are finite.
    const planes = new Set([8, 16, 42, 68, 94, 120, 146]);
    for (const n of bp) {
      expect(n.pos3 && n.pos3.length === 3).toBe(true);
      for (const v of n.pos3!) expect(Number.isFinite(v)).toBe(true);
      expect(planes.has(n.pos3![2])).toBe(true);
    }
  });

  it("pos3 z steps each domain block deeper, monotone down every column, gutter on z=8", () => {
    // Down a column the connected stack runs block-by-block onto deeper planes
    // (non-decreasing z); the +18 side gutter is edgeless nodes on one z=8 plane.
    const cols = new Map<number, (typeof bp)[number][]>();
    for (const n of bp) {
      const c = columnOf(n);
      if (!cols.has(c)) cols.set(c, []);
      cols.get(c)!.push(n);
    }
    let maxZ = 0;
    let multiBlockCols = 0;
    for (const ns of cols.values()) {
      const mainX = Math.min(...ns.map((n) => n.pos3![0])); // main lane is left of the +18 gutter
      const connected = ns
        .filter((n) => n.pos3![0] === mainX)
        .sort((a, b) => b.pos3![1] - a.pos3![1]); // top → bottom
      const gutter = ns.filter((n) => n.pos3![0] !== mainX);
      for (const g of gutter) expect(g.pos3![2]).toBe(8);
      let prevZ = -Infinity;
      const seenPlanes = new Set<number>();
      for (const n of connected) {
        expect(n.pos3![2]).toBeGreaterThanOrEqual(16);
        expect(n.pos3![2]).toBeLessThanOrEqual(146);
        expect(n.pos3![2]).toBeGreaterThanOrEqual(prevZ); // monotone down the column
        prevZ = n.pos3![2];
        seenPlanes.add(n.pos3![2]);
        maxZ = Math.max(maxZ, n.pos3![2]);
      }
      if (seenPlanes.size > 1) multiBlockCols++;
    }
    expect(maxZ).toBeGreaterThan(16); // at least one column stacks multiple blocks
    expect(maxZ).toBeLessThanOrEqual(146); // capped
    expect(multiBlockCols).toBeGreaterThan(0);
  });

  it("front-on blueprint is byte-stable: pos3 x/y unchanged by the z lift", () => {
    // Baseline captured with the round-11 airing (columnWidth 94, targetHeight
    // 560, blockGap 1.5) but BEFORE the z lift. Lifting blocks onto z-planes
    // moves only z; the front-on schematic (x,y) must be identical byte-for-byte.
    const baseline = JSON.parse(
      readFileSync(resolve(HERE, "fixtures/blueprint-xy-baseline.json"), "utf8"),
    ) as { nodes: Record<string, [number, number]> };
    for (const n of bp) {
      const b = baseline.nodes[n.id];
      expect(n.pos3![0]).toBe(b[0]);
      expect(n.pos3![1]).toBe(b[1]);
    }
  });

  it("grade-column x is strictly increasing K→1→…→8→A1→G→A2→ADV", () => {
    // Each column has a main lane plus an optional minority side gutter at
    // exactly +18 (edgeless standards); the 13 main-lane x strictly increase.
    const lanes = new Map<number, Map<number, number>>(); // col -> x -> count
    for (const n of bp) {
      const c = columnOf(n);
      if (!lanes.has(c)) lanes.set(c, new Map());
      const m = lanes.get(c)!;
      m.set(n.pos3![0], (m.get(n.pos3![0]) ?? 0) + 1);
    }
    const mainX: number[] = [];
    for (const [c, m] of [...lanes.entries()].sort((a, b) => a[0] - b[0])) {
      const xs = [...m.keys()].sort((a, b) => a - b);
      expect(xs.length === 1 || xs.length === 2).toBe(true);
      if (xs.length === 2) {
        expect(xs[1] - xs[0]).toBeCloseTo(18, 2); // gutter offset
        expect(m.get(xs[1])!).toBeLessThan(m.get(xs[0])!); // gutter is minority
      }
      mainX[c] = xs[0];
    }
    expect(mainX.length).toBe(13);
    for (let i = 1; i < mainX.length; i++) expect(mainX[i]).toBeGreaterThan(mainX[i - 1]);
  });

  it("no two nodes in a column share a lane+y slot", () => {
    const seen = new Map<number, Set<string>>();
    for (const n of bp) {
      const c = columnOf(n);
      if (!seen.has(c)) seen.set(c, new Set());
      const slots = seen.get(c)!;
      const slot = `${n.pos3![0]}:${n.pos3![1]}`;
      expect(slots.has(slot)).toBe(false);
      slots.add(slot);
    }
  });

  it("every edge carries a blueprint control point c3 (z = endpoint block-plane midpoint)", () => {
    const round2 = (v: number): number => Math.round(v * 100) / 100;
    const byId = new Map(bp.map((n) => [n.id, n]));
    const edges = core.edges as (OutEdge & { c3?: number[] })[];
    expect(edges.length).toBe(757 + 142);
    for (const e of edges) {
      expect(e.c3 && e.c3.length === 3).toBe(true);
      for (const v of e.c3!) expect(Number.isFinite(v)).toBe(true);
      const a = byId.get(e.s)!.pos3!;
      const b = byId.get(e.t)!.pos3!;
      expect(e.c3![2]).toBe(round2((a[2] + b[2]) / 2)); // ramp between the two card planes
    }
  });

  it("K-8 grade + 4 course etches carry a blueprint marker3", () => {
    const gm = core.grades.filter((g) => (g as { marker3?: number[] }).marker3);
    expect(gm.map((g) => g.id)).toEqual(["K", "1", "2", "3", "4", "5", "6", "7", "8"]);
    const courses = (core as unknown as { courses: { id: string; marker3?: number[] }[] }).courses;
    for (const c of courses) {
      expect(c.marker3 && c.marker3.length === 3).toBe(true);
      expect(c.marker3![2]).toBe(0);
    }
  });
});

describe("pose D (transit)", () => {
  // Transit column = the blueprint column, EXCEPT a family child re-expands next
  // to its PARENT station (its transit column is the parent's), so 5 HS children
  // whose own course differs from the parent (F-BF.B.4.b/c/d, F-IF.C.7.c/d) still
  // live in the parent's column. Column centers are (c-6)*94, half-width 47
  // (round-11 airing widened the columns 80→94).
  const COURSE_ORDER = ["A1", "G", "A2", "ADV"];
  const byId = new Map(core.nodes.map((n) => [n.id, n]));
  const columnOf = (n: OutNode & { grade: string; courses?: string[] }): number =>
    n.grade === "HS" ? 9 + COURSE_ORDER.indexOf(n.courses![0]) : GRADES.indexOf(n.grade);
  const transitColumnOf = (n: OutNode & { parent?: string; courses?: string[] }): number =>
    n.parent ? columnOf(byId.get(n.parent)! as OutNode & { courses?: string[] }) : columnOf(n);
  const colCenterX = (c: number): number => (c - 6) * 94;
  const HALF_COL = 47;
  const LINE_Z = new Set([90, 30, -30, -90]);
  const tp = core.nodes as (OutNode & { pos4?: number[]; parent?: string; courses?: string[] })[];

  it("every node carries a pos4, all 480, finite", () => {
    expect(tp.length).toBe(480);
    for (const n of tp) {
      expect(n.pos4 && n.pos4.length === 3).toBe(true);
      for (const v of n.pos4!) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("every node's z sits on a line level: +90 / +30 / -30 / -90 (decks pushed apart)", () => {
    for (const n of tp) expect(LINE_Z.has(n.pos4![2])).toBe(true);
  });

  it("z is one level per strand (number +90, algebra +30, geometry -30, data -90)", () => {
    const want: Record<string, number> = { number: 90, algebra: 30, geometry: -30, data: -90 };
    for (const n of tp) expect(n.pos4![2]).toBe(want[n.strand]);
  });

  it("banked elbow c4.z is the midpoint of its endpoints' z (cross-deck ramps)", () => {
    const round2 = (v: number): number => Math.round(v * 100) / 100;
    const pById = new Map(tp.map((n) => [n.id, n]));
    for (const e of core.edges as (OutEdge & { c4?: number[] })[]) {
      const a = pById.get(e.s)!.pos4!;
      const b = pById.get(e.t)!.pos4!;
      expect(e.c4![2]).toBe(round2((a[2] + b[2]) / 2));
    }
  });

  it("front-on collapse is byte-stable: pos4 x/y and c4 x/y unchanged by the z push", () => {
    // Baseline REGENERATED for round 11: the blueprint airing (columnWidth
    // 80→94 shifts pos4 x, targetColumnHeight 440→560 widens pos3's y span so
    // the transit rows rescale in y) deliberately moved the front-on collapse,
    // so the fixture was rebuilt from the aired build. The assertion stays EXACT
    // (deepening the decks in z still moves only z — x/y must match byte-for-byte).
    const baseline = JSON.parse(
      readFileSync(resolve(HERE, "fixtures/transit-xy-baseline.json"), "utf8"),
    ) as { nodes: Record<string, [number, number]>; edges: [number, number][] };
    for (const n of tp) {
      const b = baseline.nodes[n.id];
      expect(n.pos4![0]).toBe(b[0]);
      expect(n.pos4![1]).toBe(b[1]);
    }
    (core.edges as (OutEdge & { c4?: number[] })[]).forEach((e, i) => {
      const b = baseline.edges[i];
      expect(e.c4![0]).toBe(b[0]);
      expect(e.c4![1]).toBe(b[1]);
    });
  });

  it("every node's x is within its transit column's ±40 extent", () => {
    for (const n of tp) {
      const c = transitColumnOf(n);
      expect(Math.abs(n.pos4![0] - colCenterX(c))).toBeLessThanOrEqual(HALF_COL + 0.01);
    }
  });

  it("family children share the parent's z and sit within ~30 units of it", () => {
    let checked = 0;
    for (const p of tp) {
      const kids = (p as { children?: string[] }).children;
      if (!kids?.length) continue;
      const pp = p.pos4!;
      for (const cid of kids) {
        const c = byId.get(cid)! as OutNode & { pos4?: number[] };
        expect(c.pos4![2]).toBe(pp[2]); // same line level as the parent station
        const d = Math.hypot(c.pos4![0] - pp[0], c.pos4![1] - pp[1], c.pos4![2] - pp[2]);
        expect(d).toBeLessThanOrEqual(30.01);
        checked++;
      }
    }
    expect(checked).toBe(116); // all sub-standards re-expanded next to their parent
  });

  it("every edge carries a transit control point c4 (finite)", () => {
    const edges = core.edges as (OutEdge & { c4?: number[] })[];
    expect(edges.length).toBe(757 + 142);
    for (const e of edges) {
      expect(e.c4 && e.c4.length === 3).toBe(true);
      for (const v of e.c4!) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("K-8 grade + 4 course etches carry a front-on transit marker4 (z === 0)", () => {
    const gm = core.grades.filter((g) => (g as { marker4?: number[] }).marker4);
    expect(gm.map((g) => g.id)).toEqual(["K", "1", "2", "3", "4", "5", "6", "7", "8"]);
    for (const g of gm) expect((g as { marker4?: number[] }).marker4![2]).toBe(0);
    const courses = (core as unknown as { courses: { id: string; marker4?: number[] }[] }).courses;
    for (const c of courses) {
      expect(c.marker4 && c.marker4.length === 3).toBe(true);
      expect(c.marker4![2]).toBe(0);
    }
  });
});

describe("transit station classification (pure logic)", () => {
  // The station grammar (src/scene/stations.ts) partitions the 480 standards
  // into four mutually exclusive marks. classifyStations is the load-time pure
  // function the renderer uses; assert its partition matches the derivation the
  // acceptance preview (scripts/pose-grammar-previews.mjs) draws.
  const cls = classifyStations(core as unknown as Parameters<typeof classifyStations>[0]);

  it("partitions all 480 standards into disc / capsule / lozenge / child", () => {
    expect(cls.discs.length + cls.capsules.length + cls.lozenges.length + cls.children.length).toBe(
      480,
    );
    // Disjoint: no id appears in two buckets.
    const all = [...cls.discs, ...cls.capsules, ...cls.lozenges, ...cls.children];
    expect(new Set(all).size).toBe(480);
  });

  it("true interchange set = ≥3 cross-strand prereqs, never a family child", () => {
    // The preview rule (xCount ≥ 3 cross-strand prereq edges incident, excluding
    // sub-standards) yields 38 on the shipped graph — NOT the 42 quoted in the
    // brief; 38 is what the rule produces on the real data.
    expect(cls.interchangeIds.length).toBe(38);
    const childSet = new Set(cls.children);
    for (const id of cls.interchangeIds) expect(childSet.has(id)).toBe(false);
  });

  it("family parents draw as lozenges (a parent that is also an interchange stays a lozenge)", () => {
    // 40 family parents; 4 of them clear the interchange floor but a parent
    // always wins precedence → drawn as a lozenge, so exactly 34 capsules.
    expect(cls.lozenges.length).toBe(40);
    expect(cls.capsules.length).toBe(34);
    expect(cls.discs.length).toBe(290);
    expect(cls.children.length).toBe(116);
    const interSet = new Set(cls.interchangeIds);
    const parentsAlsoInterchange = cls.lozenges.filter((id) => interSet.has(id));
    expect(parentsAlsoInterchange.length).toBe(4);
  });

  it("each capsule carries its own strand line plus every cross-strand neighbour strand", () => {
    const byIdN = new Map(core.nodes.map((n) => [n.id, n]));
    for (const cap of cls.capsuleLines) {
      const self = byIdN.get(cap.id)!.strand;
      expect(cap.lines).toContain(self);
      // lines are the sorted union number→algebra→geometry→data, ≥2 entries
      expect(cap.lines.length).toBeGreaterThanOrEqual(2);
      const order = ["number", "algebra", "geometry", "data"];
      const ranks = cap.lines.map((l) => order.indexOf(l));
      for (let i = 1; i < ranks.length; i++) expect(ranks[i]).toBeGreaterThan(ranks[i - 1]);
    }
  });
});

describe("blueprint drafted classification (pure logic)", () => {
  // The drafted node grammar (src/scene/drafts.ts) gives every standard a ring;
  // family parents add an outer ring, K-8 Major Work adds a centre dot. Assert
  // the partition + the badge count match the derivation the acceptance preview
  // (scripts/pose-grammar-previews.mjs blueprintSheet) draws.
  const cls = classifyDrafts(core as unknown as Parameters<typeof classifyDrafts>[0]);

  it("partitions all 480 standards into ordinary / family / child rings", () => {
    expect(cls.ordinary.length).toBe(324);
    expect(cls.families.length).toBe(40);
    expect(cls.children.length).toBe(116);
    expect(cls.ordinary.length + cls.families.length + cls.children.length).toBe(480);
    const all = [...cls.ordinary, ...cls.families, ...cls.children];
    expect(new Set(all).size).toBe(480); // disjoint
  });

  it("family parents are never also children (no nested draft marks)", () => {
    const childSet = new Set(cls.children);
    for (const id of cls.families) expect(childSet.has(id)).toBe(false);
  });

  it("Major-Work centre dots = every msa===0 non-HS standard (221)", () => {
    expect(cls.majorWork.length).toBe(221);
    const byId = new Map(core.nodes.map((n) => [n.id, n as unknown as { msa: number; grade: string }]));
    for (const id of cls.majorWork) {
      const n = byId.get(id)!;
      expect(n.msa).toBe(0);
      expect(n.grade).not.toBe("HS");
    }
  });
});

describe("ascent contour levels (pure logic)", () => {
  // The Ascent elevation isolines (src/scene/contours.ts) draw one line per
  // dependency depth, every fifth an index contour. Assert the derivation
  // against the shipped pos2 geometry (y = depth·13 − 90 per node).
  const levels = deriveContourLevels(
    core.nodes as unknown as Parameters<typeof deriveContourLevels>[0],
  );

  it("one level per dependency depth, contiguous 0..30", () => {
    expect(levels.length).toBe(31);
    levels.forEach((lv, i) => expect(lv.depth).toBe(i));
  });

  it("each level's y is the depth's shared pos2 elevation (depth·13 − 90)", () => {
    for (const lv of levels) expect(lv.y).toBeCloseTo(lv.depth * 13 - 90, 5);
  });

  it("every fifth level is an index contour (depth % 5 === 0), 7 total", () => {
    for (const lv of levels) expect(lv.index).toBe(lv.depth % 5 === 0);
    expect(levels.filter((lv) => lv.index).length).toBe(7);
  });

  it("levels account for all 480 nodes with a non-empty x-extent", () => {
    let total = 0;
    for (const lv of levels) {
      total += lv.count;
      expect(lv.count).toBeGreaterThan(0);
      expect(lv.x1).toBeGreaterThanOrEqual(lv.x0);
    }
    expect(total).toBe(480);
  });
});

describe("HTML sanitization", () => {
  it("emits no <script anywhere", () => {
    for (const f of allHtmlFields) expect(/<script/i.test(f)).toBe(false);
    for (const shard of Object.values(detailShards)) {
      expect(/<script/i.test(JSON.stringify(shard))).toBe(false);
    }
  });
  it("remediates link rot: no expired Dropbox previews, dead pages rewritten", () => {
    const everything = Object.values(detailShards)
      .map((s) => JSON.stringify(s))
      .join("");
    // Expired signed preview images are stripped entirely.
    expect(everything).not.toContain("previews.dropbox.com/p/thumb");
    expect(everything).not.toContain("previews.dropboxusercontent.com/p/thumb");
    // A known-dead page rewrites to its Wayback snapshot (audited 2026-07-16).
    expect(everything).not.toContain('"http://mste.illinois.edu/malcz');
    expect(everything).toContain("web.archive.org");
  });
  it("converts a known glossary anchor to span.term with data-def", () => {
    // id 11 desc contains <a id="The numbers 0, 1, 2, 3, …."> → span.term
    const entry = detailShards["1"]["11"] as { desc: string };
    expect(entry.desc).toContain('class="term"');
    expect(entry.desc).toContain("data-def=");
    expect(entry.desc).not.toMatch(/<a[^>]*\sid=/);
    // at least one glossary span somewhere in the corpus
    expect(allHtmlFields.some((f) => /class="term"/.test(f))).toBe(true);
  });
  it("preserves MathJax delimiters through sanitization", () => {
    const withDollar = allHtmlFields.filter((f) => /\$[^$\n]+\$/.test(f));
    expect(withDollar.length).toBeGreaterThan(0);
    // \(...\) delimiters also survive
    expect(allHtmlFields.some((f) => /\\\(/.test(f))).toBe(true);
  });
  it("absolutizes relative achievethecore image and task URLs", () => {
    for (const f of allHtmlFields) {
      for (const m of f.matchAll(/<img[^>]*src="([^"]*)"/g)) {
        expect(m[1].startsWith("/")).toBe(false);
      }
    }
    for (const shard of Object.values(detailShards)) {
      for (const entry of Object.values(shard)) {
        const tasks = (entry as { tasks?: { url: string }[] }).tasks || [];
        for (const t of tasks) expect(t.url.startsWith("/")).toBe(false);
      }
    }
  });
});

describe("math-span sanitization (no placeholder bypass)", () => {
  it("escapes HTML injected inside $…$ so it can't reach innerHTML live", () => {
    const out = sanitizeField(
      "<p>See $x<img src=x onerror=alert(1)>$ here</p>",
    );
    // The injected tag is inert: escaped, never a raw element.
    expect(out).not.toContain("<img");
    expect(out).not.toContain("onerror=alert(1)>");
    expect(out).toContain("$x&lt;img src=x onerror=alert(1)&gt;$");
  });

  it("escapes markup smuggled between a stray/unbalanced pair of $", () => {
    const out = sanitizeField(
      "<p>Stray $foo <script>evil()</script> bar$ baz</p>",
    );
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain("&lt;script&gt;evil()&lt;/script&gt;");
  });

  it("preserves real math delimiters verbatim (round-trips for KaTeX)", () => {
    // & and < inside genuine math are HTML-escaped in the string, but the
    // delimiters themselves survive and the browser un-escapes the text node
    // back to the true LaTeX source before KaTeX reads it.
    const out = sanitizeField("<p>$a < b$ and $$c & d$$</p>");
    expect(out).toContain("$a &lt; b$");
    expect(out).toContain("$$c &amp; d$$");
    // delimiters intact
    expect(out).toMatch(/\$a /);
    expect(out).toMatch(/\$\$c /);
  });

  it("neutralizes a forged placeholder token in the source", () => {
    // U+2063-wrapped MATH0 in the source must not smuggle a stored index.
    const out = sanitizeField("<p>⁣MATH0⁣ then $y<z$</p>");
    expect(out).not.toContain("⁣");
    expect(out).toContain("MATH0"); // inert plain text, delimiters stripped
    expect(out).toContain("$y&lt;z$"); // the real math still gets index 0
  });

  it("emits no raw event-handler markup or <img inside math in any shard", () => {
    const corpus = Object.values(detailShards)
      .map((s) => JSON.stringify(s))
      .join("");
    expect(/onerror\s*=/i.test(corpus)).toBe(false);
    expect(/on\w+\s*=\s*["']?\w/i.test(corpus)).toBe(false);
  });
});

describe("structured link-field scheme validation", () => {
  it("safeLinkUrl accepts only absolute http(s), dropping other schemes", () => {
    expect(safeLinkUrl("https://example.org/x")).toBe("https://example.org/x");
    expect(safeLinkUrl("http://example.org/x")).toBe("http://example.org/x");
    // site-root paths are absolutized to achievethecore.org (still http(s))
    expect(safeLinkUrl("/page/1/foo")).toBe(
      "https://achievethecore.org/page/1/foo",
    );
    // dangerous / non-http schemes are dropped
    expect(safeLinkUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeLinkUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeLinkUrl("vbscript:msgbox(1)")).toBeUndefined();
    // a scheme-less DOTTED-HOST URL is a real external link that lost its
    // scheme (the IM task PDFs) — absolutized to https, not dropped
    expect(safeLinkUrl("s3.amazonaws.com/bucket/file.pdf")).toBe(
      "https://s3.amazonaws.com/bucket/file.pdf",
    );
    // but a relative path with no dotted host is still dropped
    expect(safeLinkUrl("upload/K.OA.A.2 Solution Image.jpg")).toBeUndefined();
  });

  it("every emitted task/example URL is absolute http(s)", () => {
    for (const shard of Object.values(detailShards)) {
      for (const entry of Object.values(shard)) {
        const ex = (entry as { exampleUrl?: string }).exampleUrl;
        if (ex !== undefined) expect(ex).toMatch(/^https?:\/\//);
        const tasks = (entry as { tasks?: { url: string }[] }).tasks || [];
        for (const t of tasks) expect(t.url).toMatch(/^https?:\/\//);
      }
    }
  });
});

describe("URL absolutization", () => {
  it("treats a protocol-relative //host URL as https, not a site-root path", () => {
    expect(absolutize("//cdn.example.org/img.png")).toBe(
      "https://cdn.example.org/img.png",
    );
    // regression guard: never the doubled-slash bug
    expect(absolutize("//cdn.example.org/img.png")).not.toContain(
      "achievethecore.org//",
    );
  });
  it("still absolutizes a single-leading-slash path against achievethecore", () => {
    expect(absolutize("/page/9/x")).toBe("https://achievethecore.org/page/9/x");
  });
  it("leaves an already-absolute URL untouched", () => {
    expect(absolutize("https://achievethecore.org/y")).toBe(
      "https://achievethecore.org/y",
    );
  });
  it("prepends https to a scheme-less dotted-host URL, not to a relative path", () => {
    // bare host.tld/path (the IM S3 task PDFs) → https
    expect(
      absolutize("s3.amazonaws.com/illustrativemathematics/x/task.pdf?1462"),
    ).toBe("https://s3.amazonaws.com/illustrativemathematics/x/task.pdf?1462");
    // relative path whose first segment has no dot → left verbatim
    expect(absolutize("upload/K.OA.A.2 Solution Image.jpg")).toBe(
      "upload/K.OA.A.2 Solution Image.jpg",
    );
    // an already-schemed URL is untouched ("https" is followed by ":", not ".")
    expect(absolutize("http://s3.amazonaws.com/x")).toBe(
      "http://s3.amazonaws.com/x",
    );
  });
  it("no emitted URL has the doubled-slash-after-host defect", () => {
    const corpus = Object.values(detailShards)
      .map((s) => JSON.stringify(s))
      .join("");
    expect(corpus).not.toContain("achievethecore.org//");
  });
});

describe("search index", () => {
  interface SearchDoc {
    id: string;
    code: string;
    grade: string;
    strand: string;
    text: string;
    domainName: string;
    clusterName: string;
  }
  const docs: SearchDoc[] = JSON.parse(
    readFileSync(resolve(DATA, "search.json"), "utf8"),
  );

  it("has one HTML-free record per standard (480)", () => {
    expect(docs.length).toBe(480);
    const ids = new Set(docs.map((d) => d.id));
    expect(ids.size).toBe(480);
    for (const d of docs) {
      // No residual HTML tags in the plain-text field.
      expect(/<\/?[a-z][^>]*>/i.test(d.text)).toBe(false);
      expect(d.text.length).toBeLessThanOrEqual(241); // ~240 + ellipsis
      expect(["number", "algebra", "geometry", "data"]).toContain(d.strand);
      expect(GRADES).toContain(d.grade);
    }
  });

  it("makes a known standard findable by code and text", () => {
    const nf = docs.find((d) => d.code === "4.NF.B.3");
    expect(nf).toBeDefined();
    expect(nf!.grade).toBe("4");
    expect(nf!.strand).toBe("number");
    expect(nf!.text.length).toBeGreaterThan(0);
    // domain + cluster names are carried for the search fields
    expect(nf!.domainName.length).toBeGreaterThan(0);
    expect(nf!.clusterName.length).toBeGreaterThan(0);
    // every graph-core node has a matching search doc
    const searchIds = new Set(docs.map((d) => d.id));
    for (const n of core.nodes) expect(searchIds.has(n.id)).toBe(true);
  });
});

describe("related edges", () => {
  it("have no duplicate in either orientation", () => {
    const seen = new Set<string>();
    for (const e of core.edges) {
      if (e.k !== 1) continue;
      const key = [e.s, e.t].sort().join("|");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    // also assert prereq direction never mirrors a related pair-key collision
    expect(seen.size).toBe(142);
  });
});

describe("determinism", () => {
  it("two builds produce byte-identical graph-core JSON", () => {
    const a = JSON.stringify(buildGraph().core);
    const b = JSON.stringify(buildGraph().core);
    expect(a).toBe(b);
  });
});

describe("wrangler config", () => {
  it("parses (comments stripped) and targets ./dist as an SPA", () => {
    const jsonc = readFileSync(resolve(ROOT, "wrangler.jsonc"), "utf8");
    const stripped = jsonc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const cfg = JSON.parse(stripped) as {
      assets: { directory: string; not_found_handling: string };
    };
    expect(cfg.assets.directory).toBe("./dist");
    expect(cfg.assets.not_found_handling).toBe("single-page-application");
  });
});
