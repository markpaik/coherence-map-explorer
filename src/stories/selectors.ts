// Selector resolution — the shared grammar the story scripts (src/stories/
// scripts.ts) and the Gaps simulator speak. A selector is a string that names a
// set of standards; resolving it returns a Set of NODE INDICES into graph.nodes
// (indices, not ids, so callers can index the emphasis/damage/visibility buffers
// directly).
//
// Grammar (from the scripts.ts header):
//   "all"                 every standard
//   "grade:3"             every standard whose grade is "3" (…"K"…"HS")
//   "code:4.NF.B.3"       the single standard with that exact code
//   "domain:3.NF"         clusterCode prefix match OR the bare domain field
//   "strand:number"       every standard in that strand
//   "ancestry:CODE"       CODE's transitive prerequisites, plus CODE itself
//   "descendants:CODE"    everything CODE is a transitive prerequisite of, + CODE
//
// Ancestry/descendants walk the prerequisite DAG (edge kind 0, s → t meaning s is
// a prerequisite of t), matching the state machine's own reverse/forward BFS.
// An unknown selector warns once and resolves to the empty set — never throws, so
// a typo in a script degrades to "nothing" rather than crashing playback.

import type { GraphCore } from "../data";

export type SelectorResolver = (selector: string) => Set<number>;

export function createSelectorResolver(graph: GraphCore): SelectorResolver {
  const n = graph.nodes.length;
  const indexById = new Map<string, number>();
  const indexByCode = new Map<string, number>();
  graph.nodes.forEach((node, i) => {
    indexById.set(node.id, i);
    indexByCode.set(node.code, i);
  });

  // Prerequisite adjacency (kind 0). preds[t] holds t's direct prerequisites;
  // succ[s] holds what s is a direct prerequisite of.
  const preds: number[][] = Array.from({ length: n }, () => []);
  const succ: number[][] = Array.from({ length: n }, () => []);
  for (const e of graph.edges) {
    if (e.k !== 0) continue;
    const s = indexById.get(e.s);
    const t = indexById.get(e.t);
    if (s === undefined || t === undefined) continue;
    succ[s].push(t);
    preds[t].push(s);
  }

  // Closure caches (each node's answer is stable; 480 nodes, trivial memory).
  const ancestryCache = new Map<number, Set<number>>();
  const descendantCache = new Map<number, Set<number>>();

  function closure(start: number, adj: number[][]): Set<number> {
    const seen = new Set<number>([start]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const m of adj[cur]) {
        if (!seen.has(m)) {
          seen.add(m);
          queue.push(m);
        }
      }
    }
    return seen; // includes `start`
  }

  function ancestryOf(i: number): Set<number> {
    let c = ancestryCache.get(i);
    if (!c) {
      c = closure(i, preds);
      ancestryCache.set(i, c);
    }
    return c;
  }
  function descendantsOf(i: number): Set<number> {
    let c = descendantCache.get(i);
    if (!c) {
      c = closure(i, succ);
      descendantCache.set(i, c);
    }
    return c;
  }

  const byGrade = (g: string): Set<number> => {
    const out = new Set<number>();
    graph.nodes.forEach((node, i) => {
      if (node.grade === g) out.add(i);
    });
    return out;
  };
  const byStrand = (s: string): Set<number> => {
    const out = new Set<number>();
    graph.nodes.forEach((node, i) => {
      if (node.strand === s) out.add(i);
    });
    return out;
  };
  const byDomain = (d: string): Set<number> => {
    const out = new Set<number>();
    graph.nodes.forEach((node, i) => {
      // clusterCode prefix ("3.NF" → "3.NF.A"…) OR the bare domain field ("NF").
      if (node.clusterCode.startsWith(d) || node.domain === d) out.add(i);
    });
    return out;
  };

  return function resolve(selector: string): Set<number> {
    if (selector === "all") return new Set(graph.nodes.map((_node, i) => i));

    const sep = selector.indexOf(":");
    if (sep === -1) {
      console.warn(`[cme] unknown selector: ${selector}`);
      return new Set();
    }
    const kind = selector.slice(0, sep);
    const arg = selector.slice(sep + 1);

    switch (kind) {
      case "grade":
        return byGrade(arg);
      case "strand":
        return byStrand(arg);
      case "domain":
        return byDomain(arg);
      case "code": {
        const i = indexByCode.get(arg);
        return new Set(i === undefined ? [] : [i]);
      }
      case "ancestry": {
        const i = indexByCode.get(arg);
        if (i === undefined) {
          console.warn(`[cme] unknown code in selector: ${selector}`);
          return new Set();
        }
        return new Set(ancestryOf(i));
      }
      case "descendants": {
        const i = indexByCode.get(arg);
        if (i === undefined) {
          console.warn(`[cme] unknown code in selector: ${selector}`);
          return new Set();
        }
        return new Set(descendantsOf(i));
      }
      default:
        console.warn(`[cme] unknown selector: ${selector}`);
        return new Set();
    }
  };
}
