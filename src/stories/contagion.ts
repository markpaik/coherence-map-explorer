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
  /**
   * Extra appear delay in SECONDS, on top of the hop staging. A story scene
   * passes its lit reveal's own per-node stagger here so a ring can never
   * arrive before the standard it rings has turned on.
   */
  delaySec?: number;
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

// ---------------------------------------------------------------------------
// Display damage + scene-relative rings (round 13, the three-way visual audit)
//
// The audit measured what the engine's honest numbers actually LOOK like. On a
// whole missed grade the exposure values run 0.06–0.67 and the map reads; on a
// three-hole or one-cluster story they run 0.01–0.09, where the node shader's
// dimming is a fraction of a percent of brightness and the absolute ring floor
// (0.1) never fires at all. Three story cards described a dimness the frame did
// not show. Both fixes below are DISPLAY-side and pure: the engine's values
// (damage.ts) are untouched, and every number a card quotes still comes from
// them.

/**
 * Floor the DISPLAY damage of a story scene so "stands on something missing"
 * is unmistakable at every scale of missed set. The mapping is the monotone
 * ramp d ↦ floor + (1 − floor)·d: a touched standard can never render brighter
 * than the floor (where the shader's story lift is already fully extinguished),
 * a fully-missed one still lands exactly on 1, and the ORDER — the real
 * gradient of exposure, 0.06 to 0.67 on the pandemic story — survives intact.
 * A clamp would have flattened that gradient; this only lifts its baseline.
 *
 * The interactive "lose a year" story has floored its display values this way
 * since round 7 (Mark: dim the dependents, keep only the independent ones
 * bright); this brings the authored scenes to the same law. Untouched nodes
 * (raw 0) stay exactly 0 — a scene with `damage: false` is unaffected, so its
 * husks-and-nothing-else semantics hold.
 */
export const DAMAGE_DISPLAY_FLOOR = 0.35;

export function displayDamage(
  raw: Float32Array,
  floor: number = DAMAGE_DISPLAY_FLOOR,
): Float32Array {
  const out = new Float32Array(raw.length);
  const span = 1 - floor;
  for (let i = 0; i < raw.length; i++) {
    const d = raw[i];
    if (d <= 1e-4) continue; // untouched stays untouched
    out[i] = floor + span * (d > 1 ? 1 : d);
  }
  return out;
}

/**
 * The ring floor for one scene, RELATIVE to that scene's own damage
 * distribution: the value at the (1 − share) quantile of `values`, so the top
 * `share` of them ring. An absolute floor cannot work across stories whose
 * partial damage spans two orders of magnitude (0.667 on a lost year, 0.087 on
 * a lost cluster) — it either fires for everything or for nothing. Empty input
 * returns Infinity (nothing rings). Pure.
 */
export function relativeRingFloor(values: readonly number[], share: number): number {
  if (!values.length) return Infinity;
  const s = share <= 0 ? 0 : share >= 1 ? 1 : share;
  const sorted = [...values].sort((a, b) => a - b);
  const k = Math.min(sorted.length - 1, Math.max(0, Math.floor((1 - s) * sorted.length)));
  return sorted[k];
}

export interface SceneRingOptions {
  /** Per-node lit amount (the scene's own mask). Only LIT nodes may ring. */
  lit: Float32Array;
  /** Lit threshold a node must clear to be eligible (default 0.5). */
  litAt?: number;
  /** Share of the scene's lit, partly-damaged nodes that ring (default 0.4). */
  share?: number;
  /** At or above this damage a node counts as a hole, not exposure (0.99). */
  huskAt?: number;
  /** Intensity band the partial rings map into (default 0.18 … 0.5). */
  faint?: readonly [number, number];
  /** Extra per-node appear delay in seconds (the scene's lit reveal stagger). */
  delayOf?: (index: number) => number;
}

/**
 * The rings for one authored story scene.
 *
 * Three rules, all of them fixes the audit demanded:
 *   1. MASKED to the lit set. A node outside the scene's `lit` selectors is a
 *      ghost; ringing it advertises damage in a band the card says has not
 *      happened yet (the pandemic story's grade-4 rings in the March-2020
 *      frame, which pre-empted the next scene).
 *   2. Holes always ring at full intensity; downstream exposure rings only in
 *      the top `share` of the scene's OWN distribution, so the wave reads on a
 *      three-hole story without turning a whole grade band into rings.
 *   3. Intensity separates the two classes by construction: a hole is 1, the
 *      heaviest downstream node is `faint[1]`. The beacon shader maps intensity
 *      to brightness AND width, so d = 1 is plainly heavier than d ≈ 0.2 —
 *      which is what the swiss-cheese card claims in words.
 * Pure: `raw` is the ENGINE damage (never the floored display copy), so ring
 * weight keeps tracking the honest numbers.
 */
export function sceneRingTargets(
  raw: Float32Array,
  hops: Int32Array,
  opts: SceneRingOptions,
): BeaconTarget[] {
  const { lit } = opts;
  const litAt = opts.litAt ?? 0.5;
  const share = opts.share ?? 0.4;
  const huskAt = opts.huskAt ?? 0.99;
  const [faintLo, faintHi] = opts.faint ?? [0.18, 0.5];
  const eligible = (i: number): boolean => (lit[i] ?? 0) >= litAt;

  const partials: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (!eligible(i)) continue;
    const d = raw[i];
    if (d > 1e-4 && d < huskAt) partials.push(d);
  }
  const floor = relativeRingFloor(partials, share);
  const max = partials.length ? Math.max(...partials) : 0;
  const span = max > floor ? max - floor : 0;

  const out: BeaconTarget[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (!eligible(i)) continue;
    const d = raw[i];
    const hop = hops[i] >= 0 ? hops[i] : 0;
    const delaySec = opts.delayOf?.(i) ?? 0;
    if (d >= huskAt) {
      out.push({ index: i, intensity: 1, hop, delaySec });
    } else if (d > 1e-4 && d >= floor) {
      const t = span > 0 ? (d - floor) / span : 1;
      out.push({ index: i, intensity: faintLo + (faintHi - faintLo) * t, hop, delaySec });
    }
  }
  return out;
}
