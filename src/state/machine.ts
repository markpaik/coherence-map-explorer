// Explicit interaction state machine — the SINGLE writer of aEmphasis buffers
// (nodes + edges), tooltip visibility, cursor, the detail panel, the camera
// goal, the URL hash, and the aria-live announcement. UI modules (search,
// panel connections, filters, deep-link router) only *request*; the machine
// acts.
//
// States: idle | hover(n) | focus(n) | searching.
//   - hover is a transient overlay; during a focus it rides on top of the
//     focus emphasis and is restored on hover-out.
//   - focus computes ancestors (reverse-prereq BFS), descendants (forward BFS)
//     and direct related, then lights the closure and flies the camera.
//
// Emphasis is eased on the CPU (~150ms) so hover ramps smoothly. But easing
// from REST to a distant state (CHAIN/RELATED/FOCUS) would sweep *through* the
// brighter intermediate states (a flash) — the Phase 2 caveat. So the focus
// cascade SNAPS each revealed layer to its target (current = target) and drives
// the choreography with per-layer TIMING instead of per-node easing. Only the
// gentle REST→DIMMED fade of the background is left to ease.

import * as THREE from "three";
import type { GraphCore, GraphNode } from "../data";
import { EMPHASIS, restRadius, type Emphasis } from "../scene/palette";
import { standardHref, focusHistoryMode } from "./routing";
import type { NodesHandle } from "../scene/nodes";
import type { EdgesHandle } from "../scene/edges";
import type { TooltipHandle } from "../ui/tooltip";
import type { CameraRig } from "../scene/camera";
import type { PanelHandle, Connections } from "../ui/panel";

const EASE_TIME_CONSTANT = 0.05; // s; ~95% settled in 150ms
const SETTLE_EPSILON = 0.002;
const GRADE_STEP_MS = 80; // per grade layer of the cascade
const DESCENDANT_DELAY_MS = 200; // descendants ignite this much after focus
const GRADE_ORDER = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "HS"];

export type MachineState =
  | "idle"
  | "hover"
  | "focus"
  | "searching"
  | "touring"
  | "storying";

// The right-side panel is 400px wide (see style.css); shift a focus target left
// of center by half that (in CSS px, converted to world units by the rig) so it
// lands in the visible region beside the panel. Below 720px the panel is a
// bottom sheet — no horizontal offset needed.
const PANEL_WIDTH_PX = 400;
const PANEL_BREAKPOINT_PX = 720;
function focusPanelOffsetPx(): number {
  return window.innerWidth > PANEL_BREAKPOINT_PX ? PANEL_WIDTH_PX / 2 : 0;
}

export interface FocusOpts {
  /** Skip the cascade + camera flight (deep links: instant reveal, camera cut). */
  instant?: boolean;
  /**
   * Story mode: light the emphasis closure and fly the camera, but DON'T open
   * the panel, write the hash, or narrate — the story card owns those. The
   * camera framing is unshifted (no panel to sit beside).
   */
  silent?: boolean;
  /**
   * How the hash write records in browser history. A USER-initiated open (map
   * click, search pick, connection hop) PUSHES a new entry so the system Back
   * gesture unwinds the hop; programmatic refocus (the deep-link router reacting
   * to a hash that already changed, the guided tour, a story-exit restore) must
   * REPLACE so it neither stacks a duplicate nor loops popstate. Default: push,
   * except re-focusing the already-focused node (which replaces — no dup entry).
   */
  history?: "push" | "replace";
}

export interface EmphasisPatch {
  /** Emphasis for every node not listed in nodeOverrides. */
  baseNode: Emphasis;
  /** Emphasis for every edge not listed in edgeOverrides. */
  baseEdge: Emphasis;
  nodeOverrides?: ReadonlyMap<number, Emphasis>;
  edgeOverrides?: ReadonlyMap<number, Emphasis>;
}

export interface MachineDeps {
  nodes: NodesHandle;
  edges: EdgesHandle;
  tooltip: TooltipHandle;
  canvas: HTMLCanvasElement;
  rig: CameraRig;
  panel: PanelHandle;
  /** Push an aria-live message (focus changes narrate to the panel mirror). */
  announce: (msg: string) => void;
  reducedMotion: boolean;
  /** Flag the render loop (timer-driven cascade steps run outside rAF). */
  requestRender: () => void;
  /**
   * Plain-text standard description for hover (search-doc text, prefetched
   * post-boot). Absent or returning undefined = tooltip omits the text line.
   */
  getDocText?: (nodeId: string) => string | undefined;
  /** Whether the standard carries a worked example (hover advertises it). */
  hasExample?: (nodeId: string) => boolean;
}

export interface Machine {
  readonly state: MachineState;
  /** The focused node index, or null. */
  readonly focusedIndex: number | null;
  /** Hover a node by index (into graph.nodes), or null to clear. */
  setHover(nodeIndex: number | null, cursorX?: number, cursorY?: number): void;
  /** Keep the tooltip tracking the pointer while hover holds. */
  moveCursor(x: number, y: number): void;
  /** Focus a node: cascade + camera + panel + hash + announce. */
  focus(nodeIndex: number, opts?: FocusOpts): void;
  /** Focus by standard code; returns false (and warns) on an unknown code. */
  focusByCode(code: string, opts?: FocusOpts): boolean;
  /** Trace-to-foundations: pull the camera back to frame the ancestor closure. */
  trace(): void;
  /**
   * Re-run the focus camera fit for the CURRENT focus (no cascade re-run). The
   * pose driver calls this after a morph so an active focus reframes to the
   * standard's new position; no-op when nothing is focused.
   */
  reframe(): void;
  /** Leave focus: back to idle, close panel, clear the hash. `silent` (stories)
   *  resets emphasis without touching the hash. */
  clearFocus(opts?: { silent?: boolean }): void;
  /** Mark the search UI open/closed (suspends drift, reflects in `state`). */
  setSearching(on: boolean): void;
  /** Enter/leave the guided tour (suspends drift, reports state "touring"). */
  setTouring(on: boolean): void;
  /** Enter/leave story playback (suspends drift, reports state "storying"). */
  setStorying(on: boolean): void;
  /** Flip reduced-motion at runtime (debug hook; affects cascade + camera cuts). */
  setReducedMotion(on: boolean): void;
  /** Single choke point for all emphasis writes. */
  applyEmphasis(patch: EmphasisPatch): void;
  /** Ease attributes toward targets. Returns true while animating. */
  tick(deltaSeconds: number): boolean;
  /** Node adjacency (edge indices per node index). */
  edgesOfNode(nodeIndex: number): readonly number[];
}

// Bounding sphere of a set of node indices, read from CURRENT instance positions
// (so framing stays correct after a dual-pose morph). The min radius keeps a lone
// or tightly-clustered target from filling the frame. Exported so the story
// player can frame a resolved selector union with exactly the machine's logic
// (rather than copying it). `minRadius` mirrors the focus framing default.
export function nodeBoundingSphere(
  nodes: NodesHandle,
  indices: number[],
  minRadius = 90,
): THREE.Sphere {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const i of indices) box.expandByPoint(nodes.getPosition(i, v));
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  sphere.radius = Math.max(sphere.radius, minRadius);
  return sphere;
}

/** The direct connections of a focused standard after family roll-up. */
export interface RolledConnections {
  buildsOn: number[]; // direct incoming prereqs (rolled up when a parent)
  leadsTo: number[]; // direct outgoing prereqs (rolled up when a parent)
  related: number[]; // related pairs (rolled up when a parent)
  /** True whenever the focus is a family parent (parts.length > 0). */
  rolledUp: boolean;
}

/**
 * Roll a parent standard's family connections up into the parent. EVERY parent
 * (any standard with sub-standards, parts.length > 0) rolls up UNCONDITIONALLY:
 * the original coherence map presents a family as ONE card, so an arrow into
 * any sub-standard reads as an arrow into the parent. The rolled set is the
 * focus's OWN direct neighbours PLUS each child's neighbours, with every
 * family-internal member (the parent and its parts) removed. A standalone
 * standard (no parts) returns its own direct sets unchanged with rolledUp=false.
 *
 * Pure function of the adjacency arrays — the SINGLE source of truth for both
 * the 3D panel (machine.computeFocus) and mobile Browse (renderConnections), so
 * the two can never drift. Edgeless parents (e.g. 4.NF.B.3) are the degenerate
 * case of the same rule; partial parents (e.g. 6.RP.A.3, which owns outbound
 * edges while its .a-.d hold the inbound lineage from 5.G.A.2 / 6.RP.A.1 /
 * 6.RP.A.2) are exactly why the gate is parts.length, not "parent has no edges".
 */
export function rollUpFamily(
  focus: number,
  parts: number[],
  preds: number[][],
  succ: number[][],
  relatedAdj: number[][],
): RolledConnections {
  if (parts.length === 0) {
    return {
      buildsOn: preds[focus],
      leadsTo: succ[focus],
      related: relatedAdj[focus],
      rolledUp: false,
    };
  }
  const family = new Set<number>([focus, ...parts]);
  const roll = (own: number[], adj: number[][]): number[] => {
    const set = new Set<number>(own.filter((nb) => !family.has(nb)));
    for (const c of parts) for (const nb of adj[c]) if (!family.has(nb)) set.add(nb);
    return [...set];
  };
  return {
    buildsOn: roll(preds[focus], preds),
    leadsTo: roll(succ[focus], succ),
    related: roll(relatedAdj[focus], relatedAdj),
    rolledUp: true,
  };
}

export function createMachine(graph: GraphCore, deps: MachineDeps): Machine {
  const { nodes, edges, tooltip, canvas, rig, panel, announce, requestRender } = deps;
  let reducedMotion = deps.reducedMotion; // mutable: __cme.setReducedMotion flips it
  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;

  // --- adjacency (built once) ---------------------------------------------
  const indexById = new Map<string, number>();
  const indexByCode = new Map<string, number>();
  graph.nodes.forEach((n, i) => {
    indexById.set(n.id, i);
    indexByCode.set(n.code, i);
  });
  const gradeIndex = graph.nodes.map((n) => GRADE_ORDER.indexOf(n.grade));

  // undirected incident-edge lists (for hover)
  const adjacency: number[][] = Array.from({ length: nodeCount }, () => []);
  // directed prereq + undirected related, as NODE-index lists (for closures)
  const preds: number[][] = Array.from({ length: nodeCount }, () => []); // s where s->i
  const succ: number[][] = Array.from({ length: nodeCount }, () => []); // t where i->t
  const relatedAdj: number[][] = Array.from({ length: nodeCount }, () => []);
  // per-edge endpoint indices + kind (for chain/related edge classification)
  const edgeS = new Int32Array(edgeCount);
  const edgeT = new Int32Array(edgeCount);
  const edgeK = new Uint8Array(edgeCount);

  graph.edges.forEach((e, i) => {
    const s = indexById.get(e.s);
    const t = indexById.get(e.t);
    edgeS[i] = s ?? -1;
    edgeT[i] = t ?? -1;
    edgeK[i] = e.k;
    if (s !== undefined) adjacency[s].push(i);
    if (t !== undefined) adjacency[t].push(i);
    if (s === undefined || t === undefined) return;
    if (e.k === 0) {
      succ[s].push(t);
      preds[t].push(s);
    } else {
      relatedAdj[s].push(t);
      relatedAdj[t].push(s);
    }
  });

  // Standard families (parent -> child node indices) from the pipeline's
  // code-derived children[]. An edgeless parent (e.g. 4.NF.B.3) rolls up its
  // children's connections at focus time so it is never a dead end.
  const partsOf: number[][] = Array.from({ length: nodeCount }, () => []);
  graph.nodes.forEach((n, i) => {
    if (!n.children) return;
    for (const cid of n.children) {
      const ci = indexById.get(cid);
      if (ci !== undefined) partsOf[i].push(ci);
    }
  });

  // --- emphasis buffers ----------------------------------------------------
  const nodeTarget = new Float32Array(nodeCount).fill(EMPHASIS.REST);
  const edgeTarget = new Float32Array(edgeCount).fill(EMPHASIS.REST);
  const nodeCurrent = nodes.emphasisAttr.array as Float32Array;
  const edgeCurrent = edges.emphasisAttr.array as Float32Array;

  let animating = false;
  let searching = false;
  let touring = false;
  let storying = false;
  let hovered: number | null = null;
  let focusIndex: number | null = null;

  // Accumulated focus overrides (grow as cascade waves fire); hover reads these
  // so it never re-lights not-yet-revealed layers.
  let curNodeOv = new Map<number, Emphasis>();
  let curEdgeOv = new Map<number, Emphasis>();
  let lastAncestors: number[] = []; // for trace-to-foundations framing
  let lastNeighborhood: number[] = []; // for pose-morph reframing (no cascade re-run)
  let lastRelated: number[] = []; // related pairs: widen the fit only up to the cap
  let revealTimers: number[] = [];

  function clearRevealTimers(): void {
    for (const id of revealTimers) window.clearTimeout(id);
    revealTimers = [];
  }

  function applyEmphasis(patch: EmphasisPatch): void {
    nodeTarget.fill(patch.baseNode);
    edgeTarget.fill(patch.baseEdge);
    patch.nodeOverrides?.forEach((v, i) => {
      nodeTarget[i] = v;
    });
    patch.edgeOverrides?.forEach((v, i) => {
      edgeTarget[i] = v;
    });
    animating = true;
  }

  // Snap listed instances (or all) to target instantly — no easing sweep.
  function snapNodes(indices: Iterable<number>): void {
    for (const i of indices) nodeCurrent[i] = nodeTarget[i];
    nodes.emphasisAttr.needsUpdate = true;
  }
  function snapEdges(indices: Iterable<number>): void {
    for (const i of indices) edgeCurrent[i] = edgeTarget[i];
    edges.emphasisAttr.needsUpdate = true;
  }
  function snapAll(): void {
    nodeCurrent.set(nodeTarget);
    edgeCurrent.set(edgeTarget);
    nodes.emphasisAttr.needsUpdate = true;
    edges.emphasisAttr.needsUpdate = true;
    requestRender();
  }

  // --- focus closure computation ------------------------------------------
  interface FocusData {
    ancestors: number[];
    descendants: number[];
    related: number[];
    buildsOn: number[]; // direct incoming prereqs
    leadsTo: number[]; // direct outgoing prereqs
    parts: number[]; // sub-standards of a parent standard (may be empty)
    rolledUp: boolean; // true when buildsOn/leadsTo came from the children
    nodeFinal: Map<number, Emphasis>;
    edgeFinal: Map<number, Emphasis>;
    nodeReveal: Map<number, number>; // ms
    edgeReveal: Map<number, number>; // ms
  }

  function bfs(start: number, adj: number[][]): number[] {
    return bfsFrom(adj[start], adj, new Set([start]));
  }

  // BFS over `adj` seeded from `frontier`, never revisiting anything already in
  // `seen` (used for rolled-up parents: seed = children's neighbours, seen =
  // the family so the closure excludes the parent and its own sub-standards).
  function bfsFrom(frontier: number[], adj: number[][], seen: Set<number>): number[] {
    const out: number[] = [];
    const queue: number[] = [];
    for (const n of frontier) {
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
        queue.push(n);
      }
    }
    while (queue.length) {
      const n = queue.shift()!;
      for (const m of adj[n]) {
        if (!seen.has(m)) {
          seen.add(m);
          out.push(m);
          queue.push(m);
        }
      }
    }
    return out;
  }

  const byGradeThenCode = (a: number, b: number): number =>
    gradeIndex[a] - gradeIndex[b] || (graph.nodes[a].code < graph.nodes[b].code ? -1 : 1);

  function computeFocus(focus: number): FocusData {
    const parts = partsOf[focus];
    // EVERY parent standard rolls its children's connections into its own at
    // focus time, family-internal edges excluded. The original coherence map
    // presents a family as ONE card, so an arrow into any sub-standard reads
    // as an arrow into the parent; a parent that kept only its own edges could
    // show "builds on nothing" while its children carry the real inbound
    // lineage (Mark's 6.RP.A.3 catch: its .a-.d hold the prereqs from
    // 5.G.A.2 / 6.RP.A.1 / 6.RP.A.2 while the parent owns only outbound).
    // Edgeless parents (e.g. 4.NF.B.3) are the degenerate case of the same
    // rule.
    const {
      buildsOn: seedPreds,
      leadsTo: seedSucc,
      related: seedRelated,
      rolledUp,
    } = rollUpFamily(focus, parts, preds, succ, relatedAdj);
    // BFS ancestry/descendants seed from the (possibly rolled-up) direct sets.
    const ancestors = rolledUp
      ? bfsFrom(seedPreds, preds, new Set([focus, ...parts]))
      : bfs(focus, preds);
    const descendants = rolledUp
      ? bfsFrom(seedSucc, succ, new Set([focus, ...parts]))
      : bfs(focus, succ);
    const related = [...seedRelated];
    const ancSet = new Set(ancestors);
    const descSet = new Set(descendants);
    // When rolled up, the children stand in for the focus in the lineage: they
    // anchor both ends of the chain and light like it.
    const anchors = new Set<number>([focus, ...(rolledUp ? parts : [])]);

    // Node emphasis: related (weakest) < chain < focus (strongest) wins.
    const nodeFinal = new Map<number, Emphasis>();
    for (const r of related) nodeFinal.set(r, EMPHASIS.RELATED);
    for (const a of ancestors) nodeFinal.set(a, EMPHASIS.CHAIN);
    for (const d of descendants) nodeFinal.set(d, EMPHASIS.CHAIN);
    if (rolledUp) for (const p of parts) nodeFinal.set(p, EMPHASIS.CHAIN);
    nodeFinal.set(focus, EMPHASIS.FOCUS);

    // Edge emphasis: prereq edge inside the ancestor OR descendant lineage is a
    // hot flowing CHAIN edge; a related edge touching the focus (or its parts)
    // is a dashed RELATED shimmer. Everything else stays dimmed (the base).
    const relatedAnchorAdj = new Set(related);
    const edgeFinal = new Map<number, Emphasis>();
    for (let i = 0; i < edgeCount; i++) {
      const s = edgeS[i];
      const t = edgeT[i];
      if (s < 0 || t < 0) continue;
      if (edgeK[i] === 0) {
        const inAnc = (anchors.has(s) || ancSet.has(s)) && (anchors.has(t) || ancSet.has(t));
        const inDesc = (anchors.has(s) || descSet.has(s)) && (anchors.has(t) || descSet.has(t));
        if (inAnc || inDesc) edgeFinal.set(i, EMPHASIS.CHAIN);
      } else if (anchors.has(s) || anchors.has(t)) {
        const other = anchors.has(s) ? t : s;
        if (relatedAnchorAdj.has(other)) edgeFinal.set(i, EMPHASIS.RELATED);
      }
    }

    // Reveal schedule (ms). Focus + related at 0; ancestors step backward per
    // grade layer; descendants step forward, delayed 200ms and behind ancestors.
    const nodeReveal = new Map<number, number>();
    nodeReveal.set(focus, 0);
    for (const r of related) nodeReveal.set(r, 0);
    if (rolledUp) for (const p of parts) nodeReveal.set(p, 0);
    const fg = gradeIndex[focus];
    for (const a of ancestors) {
      const layer = Math.max(fg - gradeIndex[a], 1);
      nodeReveal.set(a, layer * GRADE_STEP_MS);
    }
    for (const d of descendants) {
      const layer = Math.max(gradeIndex[d] - fg, 1);
      nodeReveal.set(d, DESCENDANT_DELAY_MS + layer * GRADE_STEP_MS);
    }
    const edgeReveal = new Map<number, number>();
    edgeFinal.forEach((_v, i) => {
      const rs = nodeReveal.get(edgeS[i]) ?? 0;
      const rt = nodeReveal.get(edgeT[i]) ?? 0;
      edgeReveal.set(i, Math.max(rs, rt));
    });

    return {
      ancestors,
      descendants,
      related,
      buildsOn: [...seedPreds].sort(byGradeThenCode),
      leadsTo: [...seedSucc].sort(byGradeThenCode),
      parts: [...parts].sort(byGradeThenCode),
      rolledUp,
      nodeFinal,
      edgeFinal,
      nodeReveal,
      edgeReveal,
    };
  }

  // Sphere CENTERED on one node, radius reaching the farthest of its neighbors:
  // the focus fit uses this so the CLICKED standard lands dead center (then the
  // panel offset shifts it to the center of the visible region) instead of
  // drifting to the neighborhood's centroid, which sat off toward the heavier
  // side of its connections and read as a random shift.
  //
  // Zoom consistency: the DIRECTED neighborhood (builds-on / leads-to / parts)
  // always fits — that is the lineage the click promises. RELATED pairs only
  // widen the frame up to 1.6× the directed radius; a related standard across
  // the map stays lit and listed in the panel but no longer yanks the camera
  // out to a wide shot (the old behavior read as arbitrary zoom-in/zoom-out).
  const sphereAround = (
    centerIdx: number,
    directed: number[],
    related: number[] = [],
  ): THREE.Sphere => {
    const c = new THREE.Vector3();
    nodes.getPosition(centerIdx, c);
    const v = new THREE.Vector3();
    let rDir = 0;
    for (const i of directed) rDir = Math.max(rDir, c.distanceTo(nodes.getPosition(i, v)));
    let rRel = 0;
    for (const i of related) rRel = Math.max(rRel, c.distanceTo(nodes.getPosition(i, v)));
    const r = Math.max(rDir, Math.min(rRel, rDir * 1.6));
    return new THREE.Sphere(c.clone(), Math.max(r, 40));
  };

  // Bounding sphere of a set of node indices (see nodeBoundingSphere). Keeps a
  // lone or tightly-clustered focus from filling the frame — a standard with no
  // mapped connections still lands in a legible local context.
  const sphereOf = (indices: number[]): THREE.Sphere => nodeBoundingSphere(nodes, indices);

  // Compose the accumulated focus overrides (`curNodeOv`/`curEdgeOv`, which grow
  // as cascade waves fire) with the LIVE hover overlay. EVERY emphasis write made
  // while a focus is active — the resting render here AND each cascade wave — must
  // route through this, or a wave rebuilt from the focus overrides alone would
  // drop a resting pointer's highlight and the machine would ease it back to
  // dimmed on the next step. With `hovered` null (hover-out, or during the focus()
  // call itself) it degrades to the plain focus overrides, so hover-out composes
  // correctly too.
  function focusOverrides(): {
    nodeOv: Map<number, Emphasis>;
    edgeOv: Map<number, Emphasis>;
  } {
    const nodeOv = new Map(curNodeOv);
    const edgeOv = new Map(curEdgeOv);
    if (hovered !== null && hovered !== focusIndex) {
      nodeOv.set(hovered, EMPHASIS.HOVER);
      for (const ei of adjacency[hovered]) edgeOv.set(ei, EMPHASIS.HOVER);
    }
    return { nodeOv, edgeOv };
  }

  // --- emphasis rendering (idle vs focus, with hover overlay) --------------
  function renderEmphasis(): void {
    if (focusIndex !== null) {
      const { nodeOv, edgeOv } = focusOverrides();
      applyEmphasis({
        baseNode: EMPHASIS.DIMMED,
        baseEdge: EMPHASIS.DIMMED,
        nodeOverrides: nodeOv,
        edgeOverrides: edgeOv,
      });
      // Focus closure is already settled; snap so the hover overlay pops crisply
      // rather than sweeping through the bright intermediate states.
      snapAll();
    } else if (hovered !== null) {
      const nodeOverrides = new Map<number, Emphasis>([[hovered, EMPHASIS.HOVER]]);
      const edgeOverrides = new Map<number, Emphasis>();
      for (const ei of adjacency[hovered]) edgeOverrides.set(ei, EMPHASIS.HOVER);
      applyEmphasis({
        baseNode: EMPHASIS.REST,
        baseEdge: EMPHASIS.REST,
        nodeOverrides,
        edgeOverrides,
      });
    } else {
      applyEmphasis({ baseNode: EMPHASIS.REST, baseEdge: EMPHASIS.REST });
    }
  }

  function nodeContext(n: GraphNode): string {
    return `${n.domainName} · ${n.clusterCode}`;
  }

  function updateHash(code: string | null, mode: "push" | "replace" = "replace"): void {
    const base = location.pathname + location.search;
    const next = code ? standardHref(code, base) : base;
    // Push only a genuinely NEW location; if the URL already reads `next` (a
    // re-focus, or a route reacting to a hash that already changed), replace so
    // history never grows a duplicate entry and a Back gesture can't stall on one.
    const current = base + location.hash;
    if (mode === "push" && next !== current) history.pushState(null, "", next);
    else history.replaceState(null, "", next);
  }

  // --- focus ---------------------------------------------------------------
  function focus(nodeIndex: number, opts?: FocusOpts): void {
    if (nodeIndex < 0 || nodeIndex >= nodeCount) return;
    clearRevealTimers();
    const prevFocus = focusIndex; // for the history push/replace decision below
    focusIndex = nodeIndex;
    hovered = null;
    tooltip.hide();
    canvas.style.cursor = "";

    const data = computeFocus(nodeIndex);
    lastAncestors = data.ancestors;
    curNodeOv = new Map();
    curEdgeOv = new Map();

    const node = graph.nodes[nodeIndex];
    // Reduced motion always cuts; deep links request an instant cut too.
    const cut = reducedMotion || opts?.instant === true;

    if (cut) {
      curNodeOv = data.nodeFinal;
      curEdgeOv = data.edgeFinal;
      applyEmphasis({
        baseNode: EMPHASIS.DIMMED,
        baseEdge: EMPHASIS.DIMMED,
        nodeOverrides: curNodeOv,
        edgeOverrides: curEdgeOv,
      });
      snapAll();
    } else {
      // Bucket every node/edge reveal by its scheduled time, then fire one
      // timer per distinct time. Time 0 runs synchronously.
      const times = new Set<number>([0]);
      data.nodeReveal.forEach((t) => times.add(t));
      data.edgeReveal.forEach((t) => times.add(t));
      const sorted = [...times].sort((a, b) => a - b);

      const runWave = (t: number): void => {
        data.nodeReveal.forEach((rt, i) => {
          if (rt === t) curNodeOv.set(i, data.nodeFinal.get(i)!);
        });
        data.edgeReveal.forEach((rt, i) => {
          if (rt === t) curEdgeOv.set(i, data.edgeFinal.get(i)!);
        });
        // Compose in the live hover overlay so a pointer resting on a node keeps
        // its highlight across waves instead of dying on the next step.
        const { nodeOv, edgeOv } = focusOverrides();
        applyEmphasis({
          baseNode: EMPHASIS.DIMMED,
          baseEdge: EMPHASIS.DIMMED,
          nodeOverrides: nodeOv,
          edgeOverrides: edgeOv,
        });
        // Snap only the freshly-lit layer (bright targets) — the background's
        // REST→DIMMED fade is left to ease for a gentle settle.
        const litNodes = [...data.nodeReveal].filter(([, rt]) => rt === t).map(([i]) => i);
        const litEdges = [...data.edgeReveal].filter(([, rt]) => rt === t).map(([i]) => i);
        snapNodes(litNodes);
        snapEdges(litEdges);
        requestRender();
      };

      for (const t of sorted) {
        if (t === 0) runWave(0);
        else revealTimers.push(window.setTimeout(() => runWave(t), t));
      }
    }

    // Camera: frame focus + its DIRECT neighbors (+ parts). During a story the
    // panel is closed, so the framing is unshifted (silent ⇒ 0 offset).
    const silent = opts?.silent === true;
    const directed = [nodeIndex, ...data.parts, ...data.buildsOn, ...data.leadsTo];
    lastNeighborhood = directed; // reframe() replays this fit after a morph
    lastRelated = [...data.related];
    void rig.focusOn(
      sphereAround(nodeIndex, directed, lastRelated),
      !cut,
      silent ? 0 : focusPanelOffsetPx(),
    );

    // Panel + narration + deep link — all owned by the story card while silent.
    if (!silent) {
      const connections: Connections = {
        buildsOn: data.buildsOn,
        leadsTo: data.leadsTo,
        related: [...data.related].sort(byGradeThenCode),
        parts: data.parts,
        rolledUp: data.rolledUp,
      };
      panel.show(nodeIndex, connections);
      const partsNote = data.parts.length ? `, ${data.parts.length} sub-standards` : "";
      announce(
        `Focused ${node.code}, builds on ${data.buildsOn.length} ` +
          `${data.buildsOn.length === 1 ? "standard" : "standards"}, leads to ${data.leadsTo.length}${partsNote}`,
      );
      // A caller may force the mode (routers/tour/restore pass "replace"); absent
      // that, a fresh open pushes a history entry (Back unwinds the hop) but a
      // re-focus of the same node replaces (no duplicate entry).
      updateHash(node.code, focusHistoryMode(opts?.history, prevFocus === nodeIndex));
    }
    requestRender();
  }

  function focusByCode(code: string, opts?: FocusOpts): boolean {
    const i = indexByCode.get(code);
    if (i === undefined) {
      console.warn(`[cme] unknown standard code: ${code}`);
      return false;
    }
    focus(i, opts);
    return true;
  }

  function trace(): void {
    if (focusIndex === null) return;
    // Ancestors are already lit (CHAIN) from focus; pull the camera back to
    // frame the whole ancestor closure so the lineage to K is on screen.
    const sphere = sphereOf([focusIndex, ...lastAncestors]);
    void rig.focusOn(sphere, !reducedMotion, focusPanelOffsetPx());
    requestRender();
  }

  function reframe(): void {
    if (focusIndex === null) return;
    // Same fit as focus() — the neighborhood indices are unchanged; only their
    // positions moved with the pose. Reuse the stored sets, no cascade re-run.
    void rig.focusOn(
      sphereAround(focusIndex, lastNeighborhood, lastRelated),
      !reducedMotion,
      focusPanelOffsetPx(),
    );
    requestRender();
  }

  function clearFocus(opts?: { silent?: boolean }): void {
    if (focusIndex === null) return;
    clearRevealTimers();
    focusIndex = null;
    hovered = null;
    curNodeOv = new Map();
    curEdgeOv = new Map();
    lastAncestors = [];
    lastNeighborhood = [];
    lastRelated = [];
    tooltip.hide();
    canvas.style.cursor = "";
    applyEmphasis({ baseNode: EMPHASIS.REST, baseEdge: EMPHASIS.REST });
    panel.hide();
    // The panel is gone — slide the framed content back to center.
    rig.clearFocalOffset(!reducedMotion);
    // Stories own the hash; a silent clear (between scenes / on exit) leaves it.
    if (!opts?.silent) updateHash(null);
    requestRender();
  }

  return {
    get state() {
      if (storying) return "storying";
      if (touring) return "touring";
      if (hovered !== null) return "hover";
      // Focus outranks searching: an open dropdown over a focused standard is
      // still fundamentally a focus state (fleet: the old order masked focus).
      if (focusIndex !== null) return "focus";
      if (searching) return "searching";
      return "idle";
    },
    get focusedIndex() {
      return focusIndex;
    },

    setHover(nodeIndex, cursorX = 0, cursorY = 0) {
      if (nodeIndex === hovered) {
        if (nodeIndex !== null) tooltip.move(cursorX, cursorY);
        return;
      }
      hovered = nodeIndex;

      if (nodeIndex === null) {
        tooltip.hide();
        canvas.style.cursor = "";
        renderEmphasis(); // restore focus overlay or idle rest
        return;
      }

      renderEmphasis();
      const n = graph.nodes[nodeIndex];
      const nIn = preds[nodeIndex].length;
      const nOut = succ[nodeIndex].length;
      const parts: string[] = [];
      if (nIn + nOut === 0 && !partsOf[nodeIndex].length) parts.push("No mapped connections");
      else if (partsOf[nodeIndex].length && nIn + nOut === 0)
        parts.push(`${partsOf[nodeIndex].length} sub-standards`);
      else parts.push(`Builds on ${nIn} · Leads to ${nOut}`);
      if (deps.hasExample?.(n.id)) parts.push("worked example");
      tooltip.show(
        {
          code: n.code,
          detail: nodeContext(n),
          text: deps.getDocText?.(n.id),
          meta: parts.join(" · "),
        },
        cursorX,
        cursorY,
      );
      canvas.style.cursor = "pointer";
    },

    moveCursor(x, y) {
      if (hovered !== null) tooltip.move(x, y);
    },

    focus,
    focusByCode,
    trace,
    reframe,
    clearFocus,

    setSearching(on) {
      searching = on;
    },

    setTouring(on) {
      touring = on;
    },

    setStorying(on) {
      storying = on;
    },

    setReducedMotion(on) {
      reducedMotion = on;
    },

    applyEmphasis,

    tick(delta) {
      if (!animating) return false;
      const k = 1 - Math.exp(-delta / EASE_TIME_CONSTANT);
      let maxErr = 0;
      for (let i = 0; i < nodeCount; i++) {
        const err = nodeTarget[i] - nodeCurrent[i];
        if (err !== 0) {
          nodeCurrent[i] += err * k;
          const abs = Math.abs(err);
          if (abs < SETTLE_EPSILON) nodeCurrent[i] = nodeTarget[i];
          else if (abs > maxErr) maxErr = abs;
        }
      }
      for (let i = 0; i < edgeCount; i++) {
        const err = edgeTarget[i] - edgeCurrent[i];
        if (err !== 0) {
          edgeCurrent[i] += err * k;
          const abs = Math.abs(err);
          if (abs < SETTLE_EPSILON) edgeCurrent[i] = edgeTarget[i];
          else if (abs > maxErr) maxErr = abs;
        }
      }
      nodes.emphasisAttr.needsUpdate = true;
      edges.emphasisAttr.needsUpdate = true;
      if (maxErr < SETTLE_EPSILON) animating = false;
      return true;
    },

    edgesOfNode(nodeIndex) {
      return adjacency[nodeIndex];
    },
  };
}
