// Explicit interaction state machine — the SINGLE writer of aEmphasis buffers
// (nodes + edges), tooltip visibility, cursor, the detail panel, the camera
// goal, the URL hash, and the aria-live announcement. UI modules (search,
// panel connections, filters, deep-link router) only *request*; the machine
// acts.
//
// States: idle | hover(n) | focus(n) | searching.
//   - hover is a transient overlay; during a focus it rides on top of the
//     focus emphasis and is restored on hover-out.
//   - focus runs a TWO-STAGE ladder. Stage 1 (local, the default first click)
//     lights only the one-hop neighbourhood: the standard, its family, its
//     direct builds-on / leads-to / related, and the edges between them. Stage 2
//     (journey) lights the full ancestor + descendant closure with the
//     grade-stepped cascade and a direction chip (foundations / both / onward).
//     A re-click of the focused node (or the panel button) escalates local →
//     journey; a further re-click toggles back to local. Journey stage is NOT
//     encoded in the hash.
//   - every standard resolves to a meaningful stage 1: family parents roll up
//     their sub-standards' edges, and an edgeless sub-standard inherits its
//     family's edges (resolveConnections). Only two genuinely isolated
//     standards keep "No mapped connections."
//
// Emphasis is eased on the CPU (~150ms) so hover ramps smoothly. But easing
// from REST to a distant state (CHAIN/RELATED/FOCUS) would sweep *through* the
// brighter intermediate states (a flash) — the Phase 2 caveat. So the focus
// cascade SNAPS each revealed layer to its target (current = target) and drives
// the choreography with per-layer TIMING instead of per-node easing. Only the
// gentle REST→DIMMED fade of the background is left to ease. A direction change
// or a toggle back to local re-lights with an instant snap (a downward ease
// would sweep back through the brighter FOCUS/HOVER band).

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
const GRADE_STEP_MS = 80; // per grade layer of the stage-2 journey cascade
const DESCENDANT_DELAY_MS = 200; // descendants ignite this much after focus
const STAGE1_NEIGHBOR_MS = 100; // stage-1 one-hop neighbours land one short wave after focus
const GRADE_ORDER = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "HS"];

/** Stage-2 journey direction: the ancestor side, both, or the descendant side. */
export type JourneyDirection = "foundations" | "both" | "onward";

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
  /**
   * Which stage the focus lands on. "local" (default) lights only the one-hop
   * neighbourhood. "journey" immediately lights the full ancestor + descendant
   * closure (direction Both) — the story player opts in so a silent focus keeps
   * the pre-ladder full-closure lighting without opening the panel or the chip.
   */
  stage?: "local" | "journey";
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
  /**
   * Enter (or, while already in the journey, re-aim) stage 2: light the full
   * ancestor + descendant closure with the grade-stepped cascade. `direction`
   * defaults to "both" on a fresh journey; a change re-lights instantly with no
   * cascade replay. No-op when nothing is focused.
   */
  traceJourney(direction?: JourneyDirection): void;
  /**
   * Re-click of the ALREADY-FOCUSED node: escalate local → journey (Both), or
   * toggle journey → local. No-op when nothing is focused.
   */
  escalateFocus(): void;
  /** Current focus stage (local one-hop vs full journey). */
  readonly stage: "local" | "journey";
  /** Active journey direction (only meaningful while `stage === "journey"`). */
  readonly journeyDirection: JourneyDirection;
  /**
   * Re-run the focus camera fit for the CURRENT focus (no cascade re-run). The
   * pose driver calls this after a morph so an active focus reframes to the
   * standard's new position; no-op when nothing is focused. Respects the stage:
   * the one-hop sphere in local, the journey sphere of the active direction in
   * journey.
   */
  reframe(): void;
  /** Leave focus: back to idle, close panel, clear the hash. `silent` (stories)
   *  resets emphasis without touching the hash. */
  clearFocus(opts?: { silent?: boolean }): void;
  /** Read-only snapshot of the current focus's full ancestor closure (node
   * indices), or [] when nothing is focused. The panel's "Foundations" journey
   * section reads this instead of recomputing the closure. */
  getFocusAncestors(): number[];
  /** Read-only snapshot of the current focus's full descendant closure (node
   * indices), or [] when nothing is focused. The panel's "Onward" journey
   * section reads this. */
  getFocusDescendants(): number[];
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
 * Pure function of the adjacency arrays — wrapped by resolveConnections, which
 * both the 3D panel (machine.computeModel) and mobile Browse (renderConnections)
 * resolve through, so the two can never drift. Edgeless parents (e.g. 4.NF.B.3)
 * are the degenerate
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

/** rollUpFamily's output, plus the inherit case for an edgeless sub-standard. */
export interface ResolvedConnections {
  buildsOn: number[];
  leadsTo: number[];
  related: number[];
  /** True when the focus is a family parent whose sub-standards' edges rolled up. */
  rolledUp: boolean;
  /** Parent node index when an edgeless sub-standard INHERITS its family's
   *  rolled-up connections; undefined otherwise (parent, standalone, or solo). */
  inheritedFrom?: number;
}

/**
 * The one function both the machine and mobile Browse resolve a standard's
 * connections through, so their stage-1 semantics can never drift. It wraps
 * rollUpFamily and adds the ONE case rollUpFamily cannot see on its own: an
 * edgeless sub-standard (zero own builds-on + leads-to + related) whose family
 * carries the map's edges INHERITS the family's rolled-up sets, family-internal
 * members excluded. So every one of the 480 standards resolves to a meaningful
 * neighbourhood except the two genuinely isolated solos.
 *
 * Inheritance triggers ONLY when the focus's own three sets are all empty; a
 * sub-standard that owns any edge (e.g. 6.RP.A.3.a) keeps exactly its own sets.
 * A family parent still rolls up unconditionally (rollUpFamily's rule); a
 * standalone standard returns its own direct sets. Pure function of the
 * adjacency arrays.
 */
export function resolveConnections(
  focus: number,
  partsOf: number[][],
  parentOf: (number | undefined)[],
  preds: number[][],
  succ: number[][],
  relatedAdj: number[][],
): ResolvedConnections {
  const own = rollUpFamily(focus, partsOf[focus], preds, succ, relatedAdj);
  if (own.buildsOn.length || own.leadsTo.length || own.related.length) return { ...own };
  // Own three sets are all empty: an edgeless sub-standard inherits its family's
  // rolled-up connections. rollUpFamily(parent, …) already drops the parent and
  // every sub-standard (this focus and its siblings), so the inherited sets are
  // exactly the family's external neighbours.
  const parent = parentOf[focus];
  if (parent !== undefined) {
    const inh = rollUpFamily(parent, partsOf[parent], preds, succ, relatedAdj);
    if (inh.buildsOn.length || inh.leadsTo.length || inh.related.length) {
      return {
        buildsOn: inh.buildsOn,
        leadsTo: inh.leadsTo,
        related: inh.related,
        rolledUp: false,
        inheritedFrom: parent,
      };
    }
  }
  return { ...own }; // genuinely isolated (a solo standard, now truthfully empty)
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
  // Child node index -> its parent node index (edgeless children inherit the
  // family's connections at focus time via resolveConnections).
  const parentOf: (number | undefined)[] = graph.nodes.map((n) =>
    n.parent !== undefined ? indexById.get(n.parent) : undefined,
  );

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
  // The current focus's resolved model (family, one-hop sets, full closures),
  // computed once per focus() and read by both stages, reframe(), and the panel.
  let focusModel: FocusModel | null = null;
  let stage: "local" | "journey" = "local";
  let journeyDirection: JourneyDirection = "both";
  // A silent focus (the story player) suppresses panel + hash + chip in both
  // stages, exactly as it does for a stage-1 open.
  let silentFocus = false;

  // Accumulated focus overrides (grow as cascade waves fire); hover reads these
  // so it never re-lights not-yet-revealed layers.
  let curNodeOv = new Map<number, Emphasis>();
  let curEdgeOv = new Map<number, Emphasis>();
  let lastNeighborhood: number[] = []; // one-hop directed set, for pose-morph reframing
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

  // --- focus model + per-stage lighting ------------------------------------
  // The resolved model, computed once per focus() and shared by both stages,
  // reframe(), and the panel. `anchors` are the family members that physically
  // bear the one-hop edges (a parent + its parts; an inherit child's parent +
  // all its parts, which includes the focus; else just the focus). `familyLit`
  // is anchors without the focus — the CHAIN-lit family context.
  interface FocusModel {
    focus: number;
    anchors: number[];
    familyLit: number[];
    buildsOn: number[]; // resolved direct prereqs, grade-sorted (panel order)
    leadsTo: number[]; // resolved direct successors, grade-sorted
    related: number[]; // resolved direct related, grade-sorted
    rolledUp: boolean; // focus is a family parent
    inheritedFrom?: number; // parent index when an edgeless child inherits
    ancestors: number[]; // full reverse-prereq closure (stage 2)
    descendants: number[]; // full forward closure (stage 2)
  }

  interface Lighting {
    nodeFinal: Map<number, Emphasis>;
    edgeFinal: Map<number, Emphasis>;
    nodeReveal: Map<number, number>; // ms
    edgeReveal: Map<number, number>; // ms
  }

  // BFS over `adj` seeded from `frontier`, never revisiting anything already in
  // `seen` (the family so the closure excludes the anchors and their siblings).
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

  function computeModel(focus: number): FocusModel {
    const res = resolveConnections(focus, partsOf, parentOf, preds, succ, relatedAdj);
    // Family members that bear the one-hop edges to the neighbours:
    //   parent case  → the parent (focus) plus its sub-standards
    //   inherit case → the parent plus ALL its sub-standards (incl. the focus)
    //   standalone   → just the focus
    let anchors: number[];
    if (res.rolledUp) anchors = [focus, ...partsOf[focus]];
    else if (res.inheritedFrom !== undefined)
      anchors = [res.inheritedFrom, ...partsOf[res.inheritedFrom]];
    else anchors = [focus];
    const familyLit = anchors.filter((i) => i !== focus);
    // Full closures seed from the resolved direct sets, the family excluded
    // (identical to the pre-ladder computeFocus for parents and standalones).
    const ancestors = bfsFrom(res.buildsOn, preds, new Set(anchors));
    const descendants = bfsFrom(res.leadsTo, succ, new Set(anchors));
    return {
      focus,
      anchors,
      familyLit,
      buildsOn: [...res.buildsOn].sort(byGradeThenCode),
      leadsTo: [...res.leadsTo].sort(byGradeThenCode),
      related: [...res.related].sort(byGradeThenCode),
      rolledUp: res.rolledUp,
      inheritedFrom: res.inheritedFrom,
      ancestors,
      descendants,
    };
  }

  // Stage 1: the one-hop neighbourhood only. Focus (FOCUS), family (CHAIN),
  // direct builds-on / leads-to (CHAIN), direct related (RELATED), and ONLY the
  // edges between the family anchors and those neighbours. No grade cascade —
  // focus + related at 0, the neighbours one short wave later.
  function localLighting(m: FocusModel): Lighting {
    const anchors = new Set(m.anchors);
    const buildsOnSet = new Set(m.buildsOn);
    const leadsToSet = new Set(m.leadsTo);
    const relatedSet = new Set(m.related);

    const nodeFinal = new Map<number, Emphasis>();
    for (const r of m.related) nodeFinal.set(r, EMPHASIS.RELATED);
    for (const b of m.buildsOn) nodeFinal.set(b, EMPHASIS.CHAIN);
    for (const l of m.leadsTo) nodeFinal.set(l, EMPHASIS.CHAIN);
    for (const f of m.familyLit) nodeFinal.set(f, EMPHASIS.CHAIN);
    nodeFinal.set(m.focus, EMPHASIS.FOCUS);

    const edgeFinal = new Map<number, Emphasis>();
    for (let i = 0; i < edgeCount; i++) {
      const s = edgeS[i];
      const t = edgeT[i];
      if (s < 0 || t < 0) continue;
      if (edgeK[i] === 0) {
        // A one-hop prereq edge: an anchor to a direct builds-on or leads-to.
        if ((anchors.has(t) && buildsOnSet.has(s)) || (anchors.has(s) && leadsToSet.has(t)))
          edgeFinal.set(i, EMPHASIS.CHAIN);
      } else if ((anchors.has(s) && relatedSet.has(t)) || (anchors.has(t) && relatedSet.has(s))) {
        edgeFinal.set(i, EMPHASIS.RELATED);
      }
    }

    const nodeReveal = new Map<number, number>();
    nodeReveal.set(m.focus, 0);
    for (const r of m.related) nodeReveal.set(r, 0);
    for (const f of m.familyLit) nodeReveal.set(f, STAGE1_NEIGHBOR_MS);
    for (const b of m.buildsOn) nodeReveal.set(b, STAGE1_NEIGHBOR_MS);
    for (const l of m.leadsTo) nodeReveal.set(l, STAGE1_NEIGHBOR_MS);
    const edgeReveal = new Map<number, number>();
    edgeFinal.forEach((_v, i) => {
      const rs = nodeReveal.get(edgeS[i]) ?? 0;
      const rt = nodeReveal.get(edgeT[i]) ?? 0;
      edgeReveal.set(i, Math.max(rs, rt));
    });
    return { nodeFinal, edgeFinal, nodeReveal, edgeReveal };
  }

  // Stage 2: the full journey. Direction "both" reproduces the pre-ladder
  // full-closure lighting exactly (so a silent story focus is byte-identical);
  // "foundations" drops the descendants + related, "onward" drops the ancestors
  // + related. The grade-stepped cascade is the stage-2 payoff (ancestors step
  // backward per grade, descendants ignite after DESCENDANT_DELAY_MS).
  function journeyLighting(m: FocusModel, dir: JourneyDirection): Lighting {
    const includeAnc = dir !== "onward";
    const includeDesc = dir !== "foundations";
    const includeRelated = dir === "both";

    const anchors = new Set(m.anchors);
    const ancSet = includeAnc ? new Set(m.ancestors) : new Set<number>();
    const descSet = includeDesc ? new Set(m.descendants) : new Set<number>();
    const related = includeRelated ? m.related : [];
    const relatedSet = new Set(related);

    const nodeFinal = new Map<number, Emphasis>();
    for (const r of related) nodeFinal.set(r, EMPHASIS.RELATED);
    if (includeAnc) for (const a of m.ancestors) nodeFinal.set(a, EMPHASIS.CHAIN);
    if (includeDesc) for (const d of m.descendants) nodeFinal.set(d, EMPHASIS.CHAIN);
    for (const f of m.familyLit) nodeFinal.set(f, EMPHASIS.CHAIN);
    nodeFinal.set(m.focus, EMPHASIS.FOCUS);

    const edgeFinal = new Map<number, Emphasis>();
    for (let i = 0; i < edgeCount; i++) {
      const s = edgeS[i];
      const t = edgeT[i];
      if (s < 0 || t < 0) continue;
      if (edgeK[i] === 0) {
        const inAnc = (anchors.has(s) || ancSet.has(s)) && (anchors.has(t) || ancSet.has(t));
        const inDesc = (anchors.has(s) || descSet.has(s)) && (anchors.has(t) || descSet.has(t));
        if (inAnc || inDesc) edgeFinal.set(i, EMPHASIS.CHAIN);
      } else if (includeRelated && (anchors.has(s) || anchors.has(t))) {
        const other = anchors.has(s) ? t : s;
        if (relatedSet.has(other)) edgeFinal.set(i, EMPHASIS.RELATED);
      }
    }

    const nodeReveal = new Map<number, number>();
    nodeReveal.set(m.focus, 0);
    for (const r of related) nodeReveal.set(r, 0);
    for (const f of m.familyLit) nodeReveal.set(f, 0);
    const fg = gradeIndex[m.focus];
    if (includeAnc)
      for (const a of m.ancestors) {
        const layer = Math.max(fg - gradeIndex[a], 1);
        nodeReveal.set(a, layer * GRADE_STEP_MS);
      }
    if (includeDesc)
      for (const d of m.descendants) {
        const layer = Math.max(gradeIndex[d] - fg, 1);
        nodeReveal.set(d, DESCENDANT_DELAY_MS + layer * GRADE_STEP_MS);
      }
    const edgeReveal = new Map<number, number>();
    edgeFinal.forEach((_v, i) => {
      const rs = nodeReveal.get(edgeS[i]) ?? 0;
      const rt = nodeReveal.get(edgeT[i]) ?? 0;
      edgeReveal.set(i, Math.max(rs, rt));
    });
    return { nodeFinal, edgeFinal, nodeReveal, edgeReveal };
  }

  // The node set each journey direction frames.
  function journeyFitSet(m: FocusModel, dir: JourneyDirection): number[] {
    const base = [m.focus, ...m.familyLit];
    if (dir === "foundations") return [...base, ...m.ancestors];
    if (dir === "onward") return [...base, ...m.descendants];
    return [...base, ...m.ancestors, ...m.descendants];
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

  // Paint a lighting layer. `cut` snaps everything to target instantly (a
  // downward ease would sweep back through the brighter FOCUS/HOVER band);
  // otherwise each reveal wave snaps its freshly-lit layer on a timer and the
  // background's REST→DIMMED fade is left to ease. Composes the live hover
  // overlay so a resting pointer keeps its highlight across waves.
  function revealLighting(l: Lighting, cut: boolean): void {
    clearRevealTimers();
    curNodeOv = new Map();
    curEdgeOv = new Map();
    if (cut) {
      curNodeOv = new Map(l.nodeFinal);
      curEdgeOv = new Map(l.edgeFinal);
      const { nodeOv, edgeOv } = focusOverrides();
      applyEmphasis({
        baseNode: EMPHASIS.DIMMED,
        baseEdge: EMPHASIS.DIMMED,
        nodeOverrides: nodeOv,
        edgeOverrides: edgeOv,
      });
      snapAll();
      return;
    }
    // Bucket every node/edge reveal by its scheduled time, then fire one timer
    // per distinct time. Time 0 runs synchronously.
    const times = new Set<number>([0]);
    l.nodeReveal.forEach((t) => times.add(t));
    l.edgeReveal.forEach((t) => times.add(t));
    const sorted = [...times].sort((a, b) => a - b);
    const runWave = (t: number): void => {
      l.nodeReveal.forEach((rt, i) => {
        if (rt === t) curNodeOv.set(i, l.nodeFinal.get(i)!);
      });
      l.edgeReveal.forEach((rt, i) => {
        if (rt === t) curEdgeOv.set(i, l.edgeFinal.get(i)!);
      });
      const { nodeOv, edgeOv } = focusOverrides();
      applyEmphasis({
        baseNode: EMPHASIS.DIMMED,
        baseEdge: EMPHASIS.DIMMED,
        nodeOverrides: nodeOv,
        edgeOverrides: edgeOv,
      });
      const litNodes = [...l.nodeReveal].filter(([, rt]) => rt === t).map(([i]) => i);
      const litEdges = [...l.edgeReveal].filter(([, rt]) => rt === t).map(([i]) => i);
      snapNodes(litNodes);
      snapEdges(litEdges);
      requestRender();
    };
    for (const t of sorted) {
      if (t === 0) runWave(0);
      else revealTimers.push(window.setTimeout(() => runWave(t), t));
    }
  }

  // --- focus (stage 1: local) ---------------------------------------------
  function focus(nodeIndex: number, opts?: FocusOpts): void {
    if (nodeIndex < 0 || nodeIndex >= nodeCount) return;
    clearRevealTimers();
    const prevFocus = focusIndex; // for the history push/replace decision below
    focusIndex = nodeIndex;
    hovered = null;
    tooltip.hide();
    canvas.style.cursor = "";
    stage = "local";
    journeyDirection = "both";
    silentFocus = opts?.silent === true;

    const model = computeModel(nodeIndex);
    focusModel = model;

    const node = graph.nodes[nodeIndex];
    // Reduced motion always cuts; deep links request an instant cut too.
    const cut = reducedMotion || opts?.instant === true;

    revealLighting(localLighting(model), cut);

    // Camera: frame focus + its DIRECT one-hop neighbours (+ family). During a
    // story the panel is closed, so the framing is unshifted (silent ⇒ 0 offset).
    const directed = [nodeIndex, ...model.familyLit, ...model.buildsOn, ...model.leadsTo];
    lastNeighborhood = directed; // reframe() replays this fit after a morph
    lastRelated = [...model.related];
    void rig.focusOn(
      sphereAround(nodeIndex, directed, lastRelated),
      !cut,
      silentFocus ? 0 : focusPanelOffsetPx(),
    );

    // Panel + narration + deep link — all owned by the story card while silent.
    if (!silentFocus) {
      panel.show(nodeIndex, connectionsFor(model));
      const partsNote =
        model.rolledUp && partsOf[nodeIndex].length
          ? `, ${partsOf[nodeIndex].length} sub-standards`
          : "";
      announce(
        `Focused ${node.code}, builds on ${model.buildsOn.length} ` +
          `${model.buildsOn.length === 1 ? "standard" : "standards"}, leads to ${model.leadsTo.length}${partsNote}`,
      );
      // A caller may force the mode (routers/tour/restore pass "replace"); absent
      // that, a fresh open pushes a history entry (Back unwinds the hop) but a
      // re-focus of the same node replaces (no duplicate entry).
      updateHash(node.code, focusHistoryMode(opts?.history, prevFocus === nodeIndex));
    }
    requestRender();

    // Story player opts into the full closure immediately (silent journey):
    // light stage 2 (Both) without opening the panel, the chip, or the hash.
    if (opts?.stage === "journey") applyJourney("both", !cut);
  }

  // The panel's Connections payload for a resolved model.
  function connectionsFor(m: FocusModel): Connections {
    return {
      buildsOn: m.buildsOn,
      leadsTo: m.leadsTo,
      related: m.related,
      parts: m.rolledUp ? [...partsOf[m.focus]].sort(byGradeThenCode) : undefined,
      rolledUp: m.rolledUp,
      inheritedFrom: m.inheritedFrom,
      // Inherit case: the Family group lists the parent first, then the siblings.
      family:
        m.inheritedFrom !== undefined
          ? [m.inheritedFrom, ...partsOf[m.inheritedFrom].filter((i) => i !== m.focus)]
          : undefined,
      // The journey button is meaningful only when the closure runs past the
      // one-hop set (this replaces the old buildsOn-only gate).
      journeyable: m.ancestors.length + m.descendants.length > 0,
    };
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

  // --- focus (stage 2: journey) -------------------------------------------
  function directionAnnounce(dir: JourneyDirection): string {
    if (dir === "foundations") return "Showing the foundations this builds on.";
    if (dir === "onward") return "Showing where this leads onward.";
    return "Showing the full journey.";
  }

  // Enter (from local) or re-aim (within journey) stage 2. `allowCascade` is
  // honoured only when entering from local — a direction change re-lights
  // instantly, no cascade replay.
  function applyJourney(dir: JourneyDirection, allowCascade: boolean): void {
    if (focusIndex === null || focusModel === null) return;
    const wasLocal = stage === "local";
    stage = "journey";
    journeyDirection = dir;
    const cut = reducedMotion || !allowCascade || !wasLocal;
    revealLighting(journeyLighting(focusModel, dir), cut);
    void rig.focusOn(
      sphereOf(journeyFitSet(focusModel, dir)),
      !reducedMotion,
      silentFocus ? 0 : focusPanelOffsetPx(),
    );
    if (!silentFocus) {
      if (wasLocal) {
        panel.showJourney(dir, focusModel.ancestors, focusModel.descendants);
        const a = focusModel.ancestors.length;
        const d = focusModel.descendants.length;
        announce(
          `Traced ${a} foundation ${a === 1 ? "standard" : "standards"} and ` +
            `${d} onward ${d === 1 ? "standard" : "standards"}`,
        );
      } else {
        panel.setJourneyDirection(dir);
        announce(directionAnnounce(dir));
      }
    }
    requestRender();
  }

  function traceJourney(direction?: JourneyDirection): void {
    if (focusIndex === null || focusModel === null) return;
    applyJourney(direction ?? "both", true);
  }

  // Toggle stage 2 back down to stage 1: re-light the one-hop set instantly (no
  // cascade replay), camera back to the one-hop fit, chip + journey sections gone.
  function toggleLocal(): void {
    if (focusIndex === null || focusModel === null) return;
    stage = "local";
    journeyDirection = "both";
    revealLighting(localLighting(focusModel), true);
    void rig.focusOn(
      sphereAround(focusIndex, lastNeighborhood, lastRelated),
      !reducedMotion,
      silentFocus ? 0 : focusPanelOffsetPx(),
    );
    if (!silentFocus) {
      panel.hideJourney();
      announce(`Collapsed to ${graph.nodes[focusIndex].code} and its direct connections.`);
    }
    requestRender();
  }

  // Re-click of the already-focused node: escalate local → journey, else toggle
  // journey → local.
  function escalateFocus(): void {
    if (focusIndex === null) return;
    if (stage === "local") traceJourney("both");
    else toggleLocal();
  }

  function reframe(): void {
    if (focusIndex === null || focusModel === null) return;
    // Same indices as the active stage — only their positions moved with the
    // pose. Reuse the stored sets, no cascade re-run: the one-hop sphere in
    // local, the active direction's journey sphere in journey.
    const sphere =
      stage === "journey"
        ? sphereOf(journeyFitSet(focusModel, journeyDirection))
        : sphereAround(focusIndex, lastNeighborhood, lastRelated);
    void rig.focusOn(sphere, !reducedMotion, focusPanelOffsetPx());
    requestRender();
  }

  function clearFocus(opts?: { silent?: boolean }): void {
    if (focusIndex === null) return;
    clearRevealTimers();
    focusIndex = null;
    hovered = null;
    curNodeOv = new Map();
    curEdgeOv = new Map();
    focusModel = null;
    stage = "local";
    journeyDirection = "both";
    silentFocus = false;
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
      if (nIn + nOut === 0 && !partsOf[nodeIndex].length) {
        // No own prereqs and no sub-standards: an edgeless child inherits its
        // family's connections; a genuine solo says so.
        const r = resolveConnections(nodeIndex, partsOf, parentOf, preds, succ, relatedAdj);
        if (r.inheritedFrom !== undefined) {
          parts.push(
            `Mapped on ${graph.nodes[r.inheritedFrom].code}`,
            `Builds on ${r.buildsOn.length} · Leads to ${r.leadsTo.length}`,
          );
        } else {
          parts.push("No mapped connections");
        }
      } else if (partsOf[nodeIndex].length && nIn + nOut === 0)
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

    get stage() {
      return stage;
    },
    get journeyDirection() {
      return journeyDirection;
    },

    focus,
    focusByCode,
    traceJourney,
    escalateFocus,
    reframe,
    clearFocus,
    getFocusAncestors() {
      return focusModel ? [...focusModel.ancestors] : [];
    },
    getFocusDescendants() {
      return focusModel ? [...focusModel.descendants] : [];
    },

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
