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
   *
   * This is the STORIES model (structural exposure): the story cards quantify
   * these numbers, so it must never change.
   */
  compute(missed: Set<string>): Float32Array;
  /**
   * Per-node damage in [0,1] for the GAPS model (Mark's decay model, STORIES.md
   * "Impact model"): marking a standard missed hits its immediate dependents
   * hard and the impact FADES with distance, because students patch over
   * far-off gaps superficially.
   *
   *   damage(v) = 1                                   if v is missed
   *             = max over missed ancestors m of      otherwise
   *                 decay^hopdist(m, v)
   *             = 0                                    if v is not downstream of
   *                                                    any missed node
   *
   * hopdist(m, v) is the shortest DIRECTED path length m → v over the prereq
   * DAG (a forward BFS from each missed node). Missed sets are small in Gaps, so
   * this walks per-missed on demand. Fresh Float32Array each call.
   */
  computeDecay(missed: Set<string>, decay?: number): Float32Array;
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
  // Direct dependents per node (forward prereq adjacency) — the decay model
  // walks this from each missed node.
  const succ: number[][] = Array.from({ length: n }, () => []);
  // Edge endpoints (node indices) for the edge-damage projection.
  const edgeS = new Int32Array(m);
  const edgeT = new Int32Array(m);
  graph.edges.forEach((e, j) => {
    const s = indexById.get(e.s) ?? -1;
    const t = indexById.get(e.t) ?? -1;
    edgeS[j] = s;
    edgeT[j] = t;
    if (e.k === 0 && s >= 0 && t >= 0) {
      preds[t].push(s);
      succ[s].push(t);
    }
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

    computeDecay(missed, decay = 0.62) {
      const missedIdx: number[] = [];
      for (const id of missed) {
        const i = indexById.get(id);
        if (i !== undefined) missedIdx.push(i);
      }
      const out = new Float32Array(n);
      // Missed standards read a full husk.
      for (const i of missedIdx) out[i] = 1;
      // Forward BFS from each missed node; damage at v is the strongest (max)
      // decay^hopdist any missed ancestor delivers. A missed node reached from
      // another keeps its own 1 (decay^k < 1 never wins).
      const dist = new Int32Array(n);
      for (const src of missedIdx) {
        dist.fill(-1);
        dist[src] = 0;
        const queue: number[] = [src];
        let head = 0;
        while (head < queue.length) {
          const cur = queue[head++];
          const nd = dist[cur] + 1;
          for (const nx of succ[cur]) {
            if (dist[nx] === -1) {
              dist[nx] = nd;
              queue.push(nx);
              const val = Math.pow(decay, nd);
              if (val > out[nx]) out[nx] = val;
            }
          }
        }
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
