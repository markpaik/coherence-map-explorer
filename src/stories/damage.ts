// The impact model — structural exposure, shared by the stories and the Gaps
// simulator (STORIES.md "Impact model"). It is NOT a learning model: it asks a
// single structural question — of everything a standard rests on, how much has
// gone missing — and never claims anything about a child.
//
//   missed set M (node ids)
//   for a standard v with transitive-prerequisite (ancestor) set A(v):
//     damage(v) = |A(v) ∩ M| / |A(v)|        if A(v) is non-empty
//               = 0                            if v has no prerequisites
//   every missed standard itself: damage 1.
//
// Ancestor sets are the reverse closure over the prerequisite DAG (edge kind 0,
// s → t meaning s is a prerequisite of t), computed once per node and cached —
// 480 nodes over 757 prereq edges, trivial. The result is a Float32Array indexed
// by node index, ready to hand straight to nodes.setDamage(); edgeDamage() maps
// it onto the edge instances (max of the two endpoints, matching the shader).

import type { GraphCore } from "../data";

export interface DamageEngine {
  /**
   * Per-node damage in [0,1] for a set of missed standards (by node id).
   * Missed nodes read 1; every other node reads the share of its ancestry that
   * is missing. Fresh Float32Array each call (length = node count).
   */
  compute(missed: Set<string>): Float32Array;
  /** Map a node-damage array onto the edges (max of the two endpoints). */
  edgeDamage(nodeDamage: Float32Array): Float32Array;
}

export function createDamageEngine(graph: GraphCore): DamageEngine {
  const n = graph.nodes.length;
  const m = graph.edges.length;

  const indexById = new Map<string, number>();
  graph.nodes.forEach((node, i) => indexById.set(node.id, i));

  // Direct prerequisites per node (reverse prereq adjacency).
  const preds: number[][] = Array.from({ length: n }, () => []);
  // Edge endpoints (node indices) for the edge-damage projection.
  const edgeS = new Int32Array(m);
  const edgeT = new Int32Array(m);
  graph.edges.forEach((e, j) => {
    const s = indexById.get(e.s) ?? -1;
    const t = indexById.get(e.t) ?? -1;
    edgeS[j] = s;
    edgeT[j] = t;
    if (e.k === 0 && s >= 0 && t >= 0) preds[t].push(s);
  });

  // Ancestor closure (transitive prerequisites, excluding the node), cached.
  const ancestors: number[][] = new Array(n);
  function ancestorsOf(v: number): number[] {
    let a = ancestors[v];
    if (a) return a;
    const seen = new Set<number>([v]);
    const out: number[] = [];
    const queue = [v];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const p of preds[cur]) {
        if (!seen.has(p)) {
          seen.add(p);
          out.push(p);
          queue.push(p);
        }
      }
    }
    a = out;
    ancestors[v] = a;
    return a;
  }
  // Warm the cache once so compute() is a flat pass.
  for (let v = 0; v < n; v++) ancestorsOf(v);

  return {
    compute(missed) {
      const missedIdx = new Set<number>();
      for (const id of missed) {
        const i = indexById.get(id);
        if (i !== undefined) missedIdx.add(i);
      }
      const out = new Float32Array(n);
      for (let v = 0; v < n; v++) {
        if (missedIdx.has(v)) {
          out[v] = 1;
          continue;
        }
        const a = ancestors[v];
        if (a.length === 0) continue; // no prerequisites → 0
        let hit = 0;
        for (const anc of a) if (missedIdx.has(anc)) hit++;
        out[v] = hit / a.length;
      }
      return out;
    },

    edgeDamage(nodeDamage) {
      const out = new Float32Array(m);
      for (let j = 0; j < m; j++) {
        const s = edgeS[j];
        const t = edgeT[j];
        if (s < 0 || t < 0) continue;
        const ds = nodeDamage[s];
        const dt = nodeDamage[t];
        out[j] = ds > dt ? ds : dt;
      }
      return out;
    },
  };
}
