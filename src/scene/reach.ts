// Load-bearing sizing — the quiet channel for structural consequence.
//
// Zimba's own framing (and the 2026-07 research pass over it) says what makes
// a standard consequential is how much stands on it: descendant reach, not
// depth. The consensus recommendation was a monotone GRADIENT on one quiet
// visual channel, never a badge and never a crowned "deepest" node — so a
// node's rest radius scales with the square root of its transitive descendant
// share, capped at 1.3x. K.CC.A.1 (245 descendants, the widest reach on the
// map) reads ~30% larger than a leaf; a median standard (~3 descendants)
// barely moves. Every consumer of a node's visual radius (instance matrices,
// pick proxy, Ringers string tangents, beacon rings) reads from this one
// array so the size story stays consistent.

import type { GraphCore } from "../data";
import { restRadius } from "./palette";

const REACH_GAIN = 0.3; // max multiplier at the widest reach: 1 + REACH_GAIN

export function computeNodeRadii(graph: GraphCore): Float32Array {
  const n = graph.nodes.length;
  const indexById = new Map<string, number>();
  graph.nodes.forEach((node, i) => indexById.set(node.id, i));

  const children: number[][] = Array.from({ length: n }, () => []);
  for (const e of graph.edges) {
    if (e.k !== 0) continue;
    const s = indexById.get(e.s);
    const t = indexById.get(e.t);
    if (s !== undefined && t !== undefined) children[s].push(t);
  }

  // Transitive descendant counts (480 nodes over 757 edges — trivial).
  const reach = new Float32Array(n);
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  for (let v = 0; v < n; v++) {
    seen.fill(0);
    seen[v] = 1;
    stack.length = 0;
    stack.push(v);
    let count = 0;
    while (stack.length) {
      const c = stack.pop()!;
      for (const k of children[c]) {
        if (!seen[k]) {
          seen[k] = 1;
          count++;
          stack.push(k);
        }
      }
    }
    reach[v] = count;
  }

  let maxReach = 1;
  for (let v = 0; v < n; v++) if (reach[v] > maxReach) maxReach = reach[v];

  const radii = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const factor = 1 + REACH_GAIN * Math.sqrt(reach[v] / maxReach);
    radii[v] = restRadius(graph.nodes[v].deg) * factor;
  }
  return radii;
}
