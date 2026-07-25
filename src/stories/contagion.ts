// Damage contagion — the pure staging logic behind the spreading beacon rings.
//
// Mark: "when we dim the orb, it gets a luminescent border. Can you do this with
// subsequent dimmings as leads-to standards are also impacted by a dimmed
// standard? Sort of like a contagion. Make sure to honor the direction of the
// impact so it only impacts leads-to standards/substandards."
//
// So the rings no longer sit only on the directly-missed set: every node the
// damage engine marks (forward-only, over the prereq-successor direction) earns
// a ring whose intensity tracks its damage, and the rings arrive in hop order so
// the spread reads as a wave rather than a mass toggle. This module owns the
// three pure pieces — family expansion, hop-depth staging, and the damage →
// ring-target mapping — so they can be unit-tested away from the GPU. The player
// wires them onto the damage engine + the beacon instances; the beacon shader
// owns the per-ring fade-in. NONE of this touches damage.ts compute() (the story
// cards quantify its numbers); expansion happens on the missed set BEFORE it
// reaches the engine.

/** One ring to draw: a node index, its damage-scaled intensity, and its hop. */
export interface BeaconTarget {
  index: number;
  /** 0..1 — 1 for a directly-missed node (today's full ring), fainter downstream. */
  intensity: number;
  /** Wave hop from the missed set (0 = missed, 1 = its successors, …). */
  hop: number;
}

/**
 * Expand a missed set so a missed PARENT standard drags in its sub-standards.
 * The family is one card in the original coherence map, and the prereq DAG holds
 * NO parent↔child edge, so a missed parent would otherwise leave its own
 * sub-standards fully lit — and their downstream unmarked. `childrenOf` returns
 * the node indices of a node's sub-standards (empty for a leaf). Grade selectors
 * already include their sub-standards, so this is a no-op for them. Pure.
 */
export function expandFamilies(
  missed: Iterable<number>,
  childrenOf: (i: number) => number[],
): Set<number> {
  const out = new Set<number>();
  for (const i of missed) {
    out.add(i);
    for (const c of childrenOf(i)) out.add(c);
  }
  return out;
}

/**
 * Breadth-first hop depth from the seed set over a SUCCESSOR adjacency (the
 * leads-to direction, s → t meaning s is a prerequisite of t). Seeds read 0,
 * their successors 1, and so on; unreached nodes read -1. It never walks
 * predecessors, so ancestors of the missed set stay -1 — the wave honors the
 * direction of impact, exactly as the damage engine does. Pure.
 */
export function bfsHops(
  seeds: Iterable<number>,
  succ: readonly number[][],
  n: number,
): Int32Array {
  const hop = new Int32Array(n).fill(-1);
  const queue: number[] = [];
  for (const s of seeds) {
    if (s >= 0 && s < n && hop[s] === -1) {
      hop[s] = 0;
      queue.push(s);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const next = hop[cur] + 1;
    for (const nx of succ[cur]) {
      if (hop[nx] === -1) {
        hop[nx] = next;
        queue.push(nx);
      }
    }
  }
  return hop;
}

/**
 * Assemble the ring targets from a damage array and its hop staging. Every node
 * whose damage clears `floor` earns a ring; intensity is its damage (a
 * directly-missed node reads 1 → today's full ring exactly, downstream fainter).
 * A ringed node with no hop (an isolated missed node the BFS never queued) still
 * reads hop 0 so it appears first. Pure — the order mirrors the input index
 * order, and the caller (or the beacon pool cap) bounds the length. Pure.
 */
export function contagionTargets(
  damage: Float32Array,
  hops: Int32Array,
  floor: number,
): BeaconTarget[] {
  const out: BeaconTarget[] = [];
  for (let i = 0; i < damage.length; i++) {
    const d = damage[i];
    if (d < floor) continue;
    out.push({ index: i, intensity: d > 1 ? 1 : d, hop: hops[i] >= 0 ? hops[i] : 0 });
  }
  return out;
}
