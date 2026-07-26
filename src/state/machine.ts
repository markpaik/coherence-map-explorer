// Explicit interaction state machine — the SINGLE writer of aEmphasis buffers
// (nodes + edges), tooltip visibility, cursor, the detail panel, the camera
// goal, the URL hash, and the aria-live announcement. UI modules (search,
// panel connections, filters, deep-link router) only *request*; the machine
// acts.
//
// States: idle | hover(n) | focus(n) | searching.
//   - hover is a transient overlay; during a focus it rides on top of the
//     focus emphasis and is restored on hover-out.
//   - a focus ALWAYS lights the full both-direction closure with the
//     grade-stepped cascade. The two "stages" are now purely CAMERA framings:
//     "local" frames the clicked standard's one-hop neighbourhood; "journey"
//     frames the full closure (or the foundations / onward subset the direction
//     chip picks). A fresh click holds the current (typically wide) view for a
//     beat so the expanse registers, then dives IN to the one-hop frame at a
//     moderate speed. A re-click of the focused node toggles the camera between
//     the two frames; the panel button / chip zoom out to the closure. The
//     camera framing is session-only and NOT encoded in the hash.
//   - every standard resolves to a meaningful neighbourhood: family parents roll
//     up their sub-standards' edges, and an edgeless sub-standard inherits its
//     family's edges (resolveConnections). Only two genuinely isolated standards
//     keep "No mapped connections."
//
// Emphasis is eased on the CPU (~150ms) so hover ramps smoothly. But easing
// from REST to a distant state (CHAIN/RELATED/FOCUS) would sweep *through* the
// brighter intermediate states (a flash) — the Phase 2 caveat. So the focus
// cascade SNAPS each revealed layer to its target (current = target) and drives
// the choreography with per-layer TIMING instead of per-node easing. Only the
// gentle REST→DIMMED fade of the background is left to ease. A direction change
// or a toggle re-lights with an instant snap (a downward ease would sweep back
// through the brighter FOCUS/HOVER band).

import * as THREE from "three";
import type { GraphCore, GraphNode } from "../data";
import { EMPHASIS, STRAND_VIVID, restRadius, type Emphasis } from "../scene/palette";
import { standardHref, focusHistoryMode } from "./routing";
import type { NodesHandle } from "../scene/nodes";
import type { EdgesHandle } from "../scene/edges";
import type { TooltipHandle } from "../ui/tooltip";
import type { CameraRig } from "../scene/camera";
import type { PanelHandle, Connections } from "../ui/panel";

const EASE_TIME_CONSTANT = 0.05; // s; ~95% settled in 150ms
const SETTLE_EPSILON = 0.002;
const GRADE_STEP_MS = 80; // per grade layer of the full-closure cascade
const DESCENDANT_DELAY_MS = 200; // descendants ignite this much after focus
const GRADE_ORDER = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "HS"];

// Fresh-focus camera choreography (visual tuning): hold the wide view this long
// after the cascade begins (roughly once the ancestor waves have fired), then
// dive in. DIVE_SMOOTH_TIME is camera-controls' damping seconds for the dive; a
// moderate value keeps the wide→close traverse legible (perceived arrival ≈ 2×).
const DIVE_DELAY_MS = 750;
const DIVE_SMOOTH_TIME = 0.85;

// The wide closure box fit: grow the box by this world margin so lit orbs at the
// frame edge are not clipped, and floor each axis to this minimum extent so a
// small closure does not dive absurdly close.
const BOX_NODE_MARGIN = 16;
const MIN_BOX_EXTENT = 140;
/**
 * Floor on a fit box's LONGEST axis: how much world a framing shows around a
 * lone standard. 140 reproduces the zoom the shipped bounding-sphere fit landed
 * on for a single node (a 90-radius sphere padded 1.35×), so a standard with no
 * mapped connections is framed exactly as tightly as it always was.
 */
export const MIN_FIT_EXTENT = 140;
// (The closure fit's breathing room is now the usable rect's own margin — see
// scene/frame.ts — so the per-fit padding fraction is gone.)

/** The camera framing after a focus: the one-hop neighbourhood or the closure. */
export type FocusFraming = "local" | "journey";

/** The camera move a focus() call makes (lighting always runs regardless). */
export type FocusCameraMove =
  | "cut" // reduced motion / deep link: snap straight to the one-hop frame
  | "hop" // already zoomed on another standard: pan directly to the new one-hop
  | "dive"; // fresh focus (from idle or the wide frame): hold the expanse, then dive in

/**
 * Decide a focus() call's camera path. Pure so the choreography rule is
 * unit-testable away from THREE / timers.
 *   - reduced motion or an instant (deep-link) open always cuts.
 *   - a HOP: a focus is already active AND the camera sits in the close one-hop
 *     frame, so a new standard flies straight to its one-hop fit — a lateral
 *     pan, no wide excursion, no dive delay.
 *   - otherwise a fresh focus (from idle, or from the wide/journey frame): show
 *     the expanse for a beat, then dive in.
 */
export function decideFocusCamera(
  reducedMotion: boolean,
  instant: boolean,
  hadFocus: boolean,
  priorFraming: FocusFraming,
): FocusCameraMove {
  if (reducedMotion || instant) return "cut";
  if (hadFocus && priorFraming === "local") return "hop";
  return "dive";
}

/** Stage-2 journey direction: the ancestor side, both, or the descendant side. */
export type JourneyDirection = "foundations" | "both" | "onward";

export type MachineState =
  | "idle"
  | "hover"
  | "focus"
  | "searching"
  | "touring"
  | "storying";

/**
 * How far a focus fit may retreat from its one-hop frame to take the LIT
 * closure in with it. A click lights the standard's whole ancestry+descendant
 * closure, which for a foundational standard is hundreds of nodes spread across
 * the map: fitting only the one-hop frame (what shipped) parked the camera
 * INSIDE that cloud with 93% of it off screen — the cascade played where nobody
 * could see it. The retreat stops when the neighbourhood would fall below 1/2.2
 * of the frame it fills alone OR below 12% of the frame's short axis, whichever
 * leaves more room: a one-hop frame is small in absolute terms, so the ratio
 * alone never let the camera out of the cloud.
 */
const FOCUS_CONTEXT_PULLBACK = 2.2;
const FOCUS_MIN_SUBJECT_FRAC = 0.12;

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
   * Accepted for the story player, which passes "journey". Now a no-op hint: a
   * focus ALWAYS lights the full both-direction closure (the framings are a
   * camera concern), so the story gets the full closure either way. Kept so the
   * player's call site stays valid.
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
  /**
   * Mark the focused standard with a strand-tinted ring (the beacon-ring
   * grammar) so it stays discernible among the full lit closure. null clears.
   * Never called for a silent (story) focus — in stories rings mean damage.
   */
  setFocusRing?: (nodeIndex: number | null, color?: number) => void;
  /**
   * Hand the filters the currently-lit node set so an active focus temporarily
   * un-ghosts its lit closure through the filter (connected off-filter standards
   * reappear). null clears the override; the filter's own view returns. Never
   * called for a silent (story) focus (stories own their own masks).
   */
  setFilterOverride?: (nodeIndices: number[] | null) => void;
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

/** The one thing the framing helpers need from the nodes mesh (so they unit-test). */
export type PositionSource = Pick<NodesHandle, "getPosition">;

/**
 * The same set as a BOX, which is what the framing primitive wants.
 *
 * Why not a sphere: these layouts are flat slabs. Grades K–2 in the Ascent pose
 * measure 216 × 91 × 244 world units, so their bounding sphere has radius 169 —
 * a 338-unit cube. Framing that cube instead of the slab pushed the camera back
 * far enough that the band filled a fifth of the frame (the "27% of width"
 * framings), because the DEPTH axis, which the camera cannot see, was setting
 * the on-screen size. A box carries each axis separately, so the fit is sized by
 * what is actually across the screen.
 *
 * `trim` drops the ceil(trim × n) points farthest from the centroid, exactly as
 * the fits have always used (0 keeps every point); `minExtent` floors each axis
 * so a lone standard still lands in a legible local context.
 */
export function nodeBoundingBox(
  nodes: PositionSource,
  indices: number[],
  trim = 0,
  minExtent = 180,
): THREE.Box3 {
  const box = new THREE.Box3();
  const scratch = new THREE.Vector3();
  const pts = indices.map((i) => nodes.getPosition(i, scratch).clone());
  let keep = pts;
  const drop = pts.length ? Math.min(Math.ceil(trim * pts.length), pts.length - 1) : 0;
  if (drop > 0) {
    const centroid = new THREE.Vector3();
    for (const p of pts) centroid.add(p);
    centroid.divideScalar(pts.length);
    keep = pts
      .map((p) => ({ p, d: p.distanceToSquared(centroid) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, pts.length - drop)
      .map((e) => e.p);
  }
  for (const p of keep) box.expandByPoint(p);
  if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), scratch.set(1, 1, 1));
  return floorBoxSize(box, minExtent);
}

/**
 * Floor a fit box's SIZE without changing its shape: if its longest axis is
 * shorter than `minExtent` the whole box is scaled up about its centre (a lone
 * standard still lands in a legible local context instead of being dived on top
 * of). Per-AXIS flooring would be wrong — it inflates a flat band's thin axis
 * and hands the fit to an extent the reader cannot see, which is exactly how a
 * three-grade band ended up filling a third of the frame.
 */
export function floorBoxSize(box: THREE.Box3, minExtent: number): THREE.Box3 {
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const longest = Math.max(s.x, s.y, s.z);
  const k = longest > 1e-6 ? Math.max(1, minExtent / longest) : 0;
  const h =
    k === 0
      ? new THREE.Vector3(minExtent / 2, minExtent / 2, minExtent / 2)
      : new THREE.Vector3((s.x * k) / 2, (s.y * k) / 2, (s.z * k) / 2);
  box.min.copy(c).sub(h);
  box.max.copy(c).add(h);
  return box;
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
  // computed once per focus() and read by the framings, reframe(), and the panel.
  let focusModel: FocusModel | null = null;
  // The active CAMERA framing: "local" = the one-hop frame, "journey" = the full
  // closure (or the chip's direction subset). Lighting is always the full closure.
  let stage: FocusFraming = "local";
  let journeyDirection: JourneyDirection = "both";
  // A silent focus (the story player) suppresses panel + hash + chip and the
  // camera staging; the player owns the camera.
  let silentFocus = false;

  // Accumulated focus overrides (grow as cascade waves fire); hover reads these
  // so it never re-lights not-yet-revealed layers.
  let curNodeOv = new Map<number, Emphasis>();
  let curEdgeOv = new Map<number, Emphasis>();
  let lastNeighborhood: number[] = []; // one-hop directed set, for pose-morph reframing
  let lastRelated: number[] = []; // related pairs: widen the fit only up to the cap
  // The full lit closure of the current focus, as the composition CONTEXT of
  // every one-hop fit (fresh, hop, dive, reframe). Null when nothing is focused.
  let lastClosureBox: THREE.Box3 | null = null;
  let revealTimers: number[] = [];

  function clearRevealTimers(): void {
    for (const id of revealTimers) window.clearTimeout(id);
    revealTimers = [];
  }

  // --- camera flights ------------------------------------------------------
  // camera-controls' base damping (0.25s, snappy); the moderate dive raises it
  // temporarily so the wide→close traverse reads. cameraToken guards the restore
  // so a superseding flight never has its damping stomped mid-flight.
  const baseSmoothTime = rig.controls.smoothTime;
  let cameraToken = 0;
  let diveTimer: number | null = null;
  function clearDiveTimer(): void {
    if (diveTimer !== null) {
      window.clearTimeout(diveTimer);
      diveTimer = null;
    }
  }
  // Every deliberate focus camera move routes here so the damping is set
  // deterministically per move (never inherited from an in-flight one):
  //   moderate → the legible wide↔close zoom, restores base when it settles
  //   normal   → base damping (the lateral hop between one-hop frames)
  //   instant  → a hard cut
  type FlyMode = "moderate" | "normal" | "instant";
  function fly(mode: FlyMode, run: (transition: boolean) => Promise<void>): void {
    clearDiveTimer();
    const token = ++cameraToken;
    if (mode === "instant") {
      rig.controls.smoothTime = baseSmoothTime;
      void run(false);
      return;
    }
    rig.controls.smoothTime = mode === "moderate" ? DIVE_SMOOTH_TIME : baseSmoothTime;
    void run(true).finally(() => {
      if (token === cameraToken) rig.controls.smoothTime = baseSmoothTime;
    });
  }
  // The compact one-hop fit (a sphere reads fine for a tight neighbourhood),
  // composed against the lit closure so the camera never ends up inside it.
  function flyTo(box: THREE.Box3, context: THREE.Box3 | null, mode: FlyMode): void {
    fly(mode, (t) =>
      rig.frameSubject(box, {
        transition: t,
        context,
        contextPullback: FOCUS_CONTEXT_PULLBACK,
        minSubjectFrac: FOCUS_MIN_SUBJECT_FRAC,
      }),
    );
  }
  // The wide closure fit: a Box3 of the actual extents (a bounding sphere would
  // push the camera far back for the elongated grade-band closures). The closure
  // IS the subject here, so it must land inside the frame outright.
  function flyToBox(box: THREE.Box3, mode: FlyMode): void {
    fly(mode, (t) => rig.frameSubject(box, { transition: t, snapToAxis: true }));
  }
  // Hold the current (wide) view, then dive in to the one-hop frame — the
  // fresh-focus signature move.
  function scheduleDive(box: THREE.Box3, context: THREE.Box3 | null): void {
    clearDiveTimer();
    diveTimer = window.setTimeout(() => {
      diveTimer = null;
      flyTo(box, context, "moderate");
    }, DIVE_DELAY_MS);
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

  // The full-closure lighting. Direction "both" (the default a click lights)
  // reproduces the pre-ladder full-closure lighting exactly, so a silent story
  // focus is byte-identical; "foundations" drops the descendants + related,
  // "onward" drops the ancestors + related (the direction chip's lighting
  // filter). The grade-stepped cascade is the reveal: focus + family + related
  // at 0, ancestors step backward per grade, descendants ignite after
  // DESCENDANT_DELAY_MS.
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

  // Box CENTERED on one node, reaching the farthest of its neighbors on each
  // axis: the focus fit uses this so the CLICKED standard lands dead center
  // instead of drifting to the neighborhood's centroid, which sat off toward the
  // heavier side of its connections and read as a random shift.
  //
  // Per-AXIS (it was a sphere): these layouts are flat slabs, so a sphere sized
  // by a deep neighbour zoomed the camera out for depth the reader cannot see.
  //
  // Zoom consistency: the DIRECTED neighborhood (builds-on / leads-to / parts)
  // always fits — that is the lineage the click promises. RELATED pairs only
  // widen the frame up to 1.6× the directed reach; a related standard across
  // the map stays lit and listed in the panel but no longer yanks the camera
  // out to a wide shot (the old behavior read as arbitrary zoom-in/zoom-out).
  const boxAround = (centerIdx: number, directed: number[], related: number[] = []): THREE.Box3 => {
    const c = new THREE.Vector3();
    nodes.getPosition(centerIdx, c);
    const v = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const rel = new THREE.Vector3();
    for (const i of directed) {
      nodes.getPosition(i, v).sub(c);
      dir.set(Math.max(dir.x, Math.abs(v.x)), Math.max(dir.y, Math.abs(v.y)), Math.max(dir.z, Math.abs(v.z)));
    }
    for (const i of related) {
      nodes.getPosition(i, v).sub(c);
      rel.set(Math.max(rel.x, Math.abs(v.x)), Math.max(rel.y, Math.abs(v.y)), Math.max(rel.z, Math.abs(v.z)));
    }
    const half = new THREE.Vector3(
      Math.max(dir.x, Math.min(rel.x, dir.x * 1.6)),
      Math.max(dir.y, Math.min(rel.y, dir.y * 1.6)),
      Math.max(dir.z, Math.min(rel.z, dir.z * 1.6)),
    );
    // A standard with no mapped connections still gets a legible local frame.
    return floorBoxSize(new THREE.Box3(c.clone().sub(half), c.clone().add(half)), MIN_FIT_EXTENT);
  };

  // Box3 of a set of node indices, from live positions (correct after a pose
  // morph). Grown by the orb margin so lit nodes are not clipped at the frame
  // edge, then floored to a minimum per-axis extent. The wide journey fit uses
  // this (fitToBox) instead of a bounding sphere so an elongated grade-band
  // closure fills the frame rather than being pushed far back by its diagonal.
  const boxOf = (indices: number[]): THREE.Box3 => {
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const i of indices) box.expandByPoint(nodes.getPosition(i, v));
    box.expandByScalar(BOX_NODE_MARGIN);
    const size = box.getSize(v);
    if (size.x < MIN_BOX_EXTENT || size.y < MIN_BOX_EXTENT) {
      const c = box.getCenter(new THREE.Vector3());
      const hx = Math.max(size.x, MIN_BOX_EXTENT) / 2;
      const hy = Math.max(size.y, MIN_BOX_EXTENT) / 2;
      box.min.x = c.x - hx;
      box.max.x = c.x + hx;
      box.min.y = c.y - hy;
      box.max.y = c.y + hy;
    }
    return box;
  };

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

  // Hand the filters the currently-lit node set so an active focus un-ghosts its
  // lit closure through a grade/strand filter (connected off-filter standards
  // reappear). Never during a silent story focus — stories own their own masks.
  function pushFilterOverride(l: Lighting): void {
    if (silentFocus) return;
    deps.setFilterOverride?.([...l.nodeFinal.keys()]);
  }

  // --- focus ---------------------------------------------------------------
  function focus(nodeIndex: number, opts?: FocusOpts): void {
    if (nodeIndex < 0 || nodeIndex >= nodeCount) return;
    clearRevealTimers();
    clearDiveTimer();
    const prevFocus = focusIndex; // for the history push/replace decision below
    const priorFraming = stage; // for the fresh-vs-hop camera decision
    const hadFocus = prevFocus !== null;
    focusIndex = nodeIndex;
    hovered = null;
    tooltip.hide();
    canvas.style.cursor = "";
    // A focus always resettles at the one-hop framing with the full closure lit.
    stage = "local";
    journeyDirection = "both";
    silentFocus = opts?.silent === true;

    const model = computeModel(nodeIndex);
    focusModel = model;

    const node = graph.nodes[nodeIndex];
    // Reduced motion always cuts; deep links request an instant cut too.
    const cut = reducedMotion || opts?.instant === true;

    // Lighting is ALWAYS the full both-direction closure with the grade cascade;
    // the camera choreography below is what changes with the interaction.
    const lit = journeyLighting(model, "both");
    revealLighting(lit, cut);
    pushFilterOverride(lit);

    // Mark the clicked standard with a strand-tinted ring so it stays discernible
    // among the lit closure. Never during a story (rings mean damage there).
    if (!silentFocus && !storying) deps.setFocusRing?.(nodeIndex, STRAND_VIVID[node.strand]);

    // The one-hop frame: focus + its DIRECT neighbours (+ family), related capped.
    const directed = [nodeIndex, ...model.familyLit, ...model.buildsOn, ...model.leadsTo];
    lastNeighborhood = directed; // reframe() replays this fit after a morph
    lastRelated = [...model.related];
    const oneHop = boxAround(nodeIndex, directed, lastRelated);
    // What the click LIGHTS (the full closure) is the composition's context, so
    // the frame centres its weight instead of sitting inside it.
    lastClosureBox = boxOf(journeyFitSet(model, "both"));

    // The panel opens BEFORE the camera flies, so the fit composes against the
    // rect the panel leaves rather than the whole viewport (it slides in over
    // 280ms; the framing must already know it is coming).
    if (!silentFocus) panel.show(nodeIndex, connectionsFor(model));

    if (silentFocus) {
      // The story owns the camera (applyCamera overrides right after). Fit the
      // one-hop frame immediately, no expanse-beat dive.
      flyTo(oneHop, lastClosureBox, cut ? "instant" : "normal");
    } else {
      const move = decideFocusCamera(reducedMotion, opts?.instant === true, hadFocus, priorFraming);
      if (move === "cut") flyTo(oneHop, lastClosureBox, "instant");
      // A lateral pan, no dive — but at the MODERATE damping, not the base one.
      // The base damping's ~0.25s reads smooth over Constellation's small moves
      // yet as an abrupt cut over the Ascent massif's far larger translations;
      // moderate keeps every pose's pans legible.
      else if (move === "hop") flyTo(oneHop, lastClosureBox, "moderate");
      else scheduleDive(oneHop, lastClosureBox); // fresh focus: hold the expanse, then dive in
    }

    // Narration + deep link — all owned by the story card while silent (the
    // panel itself opened above, ahead of the camera).
    if (!silentFocus) {
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

  // --- the wide (journey) framing -----------------------------------------
  function directionAnnounce(dir: JourneyDirection): string {
    if (dir === "foundations") return "Showing the foundations this builds on.";
    if (dir === "onward") return "Showing where this leads onward.";
    return "Showing the full journey.";
  }

  // Zoom OUT to frame the closure. The full closure is already lit; this is a
  // camera move plus, for a direction subset, a lighting FILTER (Both = the
  // whole closure, foundations/onward = that half). Never replays the cascade.
  function applyJourney(dir: JourneyDirection): void {
    if (focusIndex === null || focusModel === null) return;
    const wasLocal = stage === "local";
    stage = "journey";
    journeyDirection = dir;
    // Instant re-light: the closure is already on screen, so a subset just
    // filters it (a downward ease would flash back through the FOCUS band).
    const lit = journeyLighting(focusModel, dir);
    revealLighting(lit, true);
    pushFilterOverride(lit); // the filter override tracks the narrowed lit set
    if (!silentFocus)
      flyToBox(boxOf(journeyFitSet(focusModel, dir)), reducedMotion ? "instant" : "moderate");
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
    applyJourney(direction ?? "both");
  }

  // Toggle the wide framing back to the one-hop frame: restore the full closure
  // (drop any direction filter), zoom IN, retire the chip + journey sections.
  function toggleLocal(): void {
    if (focusIndex === null || focusModel === null) return;
    stage = "local";
    journeyDirection = "both";
    const lit = journeyLighting(focusModel, "both");
    revealLighting(lit, true);
    pushFilterOverride(lit); // full closure lit again → override the full set
    if (!silentFocus)
      flyTo(
        boxAround(focusIndex, lastNeighborhood, lastRelated),
        lastClosureBox,
        reducedMotion ? "instant" : "moderate",
      );
    if (!silentFocus) {
      panel.hideJourney();
      announce(`Zoomed in to ${graph.nodes[focusIndex].code} and its direct connections.`);
    }
    requestRender();
  }

  // Re-click of the already-focused node: toggle the camera between the one-hop
  // frame and the wide closure (no cascade replay, no hash change).
  function escalateFocus(): void {
    if (focusIndex === null) return;
    if (stage === "local") traceJourney("both");
    else toggleLocal();
  }

  function reframe(): void {
    if (focusIndex === null || focusModel === null) return;
    // Refit whichever frame is current — only the positions moved with the pose.
    // Reuse the stored sets, no cascade re-run: the one-hop sphere in local, the
    // active direction's closure BOX in journey (the tight crop).
    //
    // MODERATE, not the base damping. A pose morph is a big camera move (biggest
    // in the tall Ascent massif); at the base ~0.25s it reads as an abrupt jump.
    // This is also the path a click DURING a still-settling morph takes: the
    // fly() below clears the fresh click's pending dive, so a moderate ease here
    // stands in for the lost hold+dive rather than warping to the standard.
    const mode: FlyMode = reducedMotion ? "instant" : "moderate";
    if (stage === "journey") {
      flyToBox(boxOf(journeyFitSet(focusModel, journeyDirection)), mode);
    } else {
      // The closure moved with the pose too, so re-read it as the context.
      lastClosureBox = boxOf(journeyFitSet(focusModel, "both"));
      flyTo(boxAround(focusIndex, lastNeighborhood, lastRelated), lastClosureBox, mode);
    }
    requestRender();
  }

  function clearFocus(opts?: { silent?: boolean }): void {
    if (focusIndex === null) return;
    clearRevealTimers();
    clearDiveTimer();
    rig.controls.smoothTime = baseSmoothTime; // drop any in-flight dive damping
    cameraToken++; // supersede a pending dive-flight restore
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
    lastClosureBox = null;
    tooltip.hide();
    canvas.style.cursor = "";
    deps.setFocusRing?.(null); // retire the focus marker
    deps.setFilterOverride?.(null); // the filter's own view returns exactly
    applyEmphasis({ baseNode: EMPHASIS.REST, baseEdge: EMPHASIS.REST });
    panel.hide();
    // The panel is gone: the usable rect just got 480px wider, so re-solve the
    // composition against it (same distance, same subject) instead of blanket-
    // sliding the content back to the raw viewport centre.
    rig.recompose(!reducedMotion);
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
      // A story owns the ring/filter grammars (rings = damage there). Retire any
      // lingering exploration focus marker + filter override so they never bleed
      // into playback (a story may start over an existing focus).
      if (on) {
        deps.setFocusRing?.(null);
        deps.setFilterOverride?.(null);
      }
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
