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

export type MachineState = "idle" | "hover" | "focus" | "searching";

export interface FocusOpts {
  /** Skip the cascade + camera flight (deep links: instant reveal, camera cut). */
  instant?: boolean;
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
  /** Leave focus: back to idle, close panel, clear the hash. */
  clearFocus(): void;
  /** Mark the search UI open/closed (suspends drift, reflects in `state`). */
  setSearching(on: boolean): void;
  /** Single choke point for all emphasis writes. */
  applyEmphasis(patch: EmphasisPatch): void;
  /** Ease attributes toward targets. Returns true while animating. */
  tick(deltaSeconds: number): boolean;
  /** Node adjacency (edge indices per node index). */
  edgesOfNode(nodeIndex: number): readonly number[];
}

export function createMachine(graph: GraphCore, deps: MachineDeps): Machine {
  const { nodes, edges, tooltip, canvas, rig, panel, announce, reducedMotion, requestRender } =
    deps;
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

  // --- emphasis buffers ----------------------------------------------------
  const nodeTarget = new Float32Array(nodeCount).fill(EMPHASIS.REST);
  const edgeTarget = new Float32Array(edgeCount).fill(EMPHASIS.REST);
  const nodeCurrent = nodes.emphasisAttr.array as Float32Array;
  const edgeCurrent = edges.emphasisAttr.array as Float32Array;

  let animating = false;
  let searching = false;
  let hovered: number | null = null;
  let focusIndex: number | null = null;

  // Accumulated focus overrides (grow as cascade waves fire); hover reads these
  // so it never re-lights not-yet-revealed layers.
  let curNodeOv = new Map<number, Emphasis>();
  let curEdgeOv = new Map<number, Emphasis>();
  let lastAncestors: number[] = []; // for trace-to-foundations framing
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
    nodeFinal: Map<number, Emphasis>;
    edgeFinal: Map<number, Emphasis>;
    nodeReveal: Map<number, number>; // ms
    edgeReveal: Map<number, number>; // ms
  }

  function bfs(start: number, adj: number[][]): number[] {
    const seen = new Set<number>([start]);
    const out: number[] = [];
    const queue = [start];
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
    const ancestors = bfs(focus, preds);
    const descendants = bfs(focus, succ);
    const related = [...relatedAdj[focus]];
    const ancSet = new Set(ancestors);
    const descSet = new Set(descendants);
    const closure = new Set<number>([focus, ...ancestors, ...descendants]);

    // Node emphasis: related (weakest) < chain < focus (strongest) wins.
    const nodeFinal = new Map<number, Emphasis>();
    for (const r of related) nodeFinal.set(r, EMPHASIS.RELATED);
    for (const a of ancestors) nodeFinal.set(a, EMPHASIS.CHAIN);
    for (const d of descendants) nodeFinal.set(d, EMPHASIS.CHAIN);
    nodeFinal.set(focus, EMPHASIS.FOCUS);

    // Edge emphasis: prereq edge inside the ancestor OR descendant lineage is a
    // hot flowing CHAIN edge; a related edge touching the focus is a dashed
    // RELATED shimmer. Everything else stays dimmed (the base).
    const edgeFinal = new Map<number, Emphasis>();
    for (let i = 0; i < edgeCount; i++) {
      const s = edgeS[i];
      const t = edgeT[i];
      if (s < 0 || t < 0) continue;
      if (edgeK[i] === 0) {
        const inAnc = (s === focus || ancSet.has(s)) && (t === focus || ancSet.has(t));
        const inDesc = (s === focus || descSet.has(s)) && (t === focus || descSet.has(t));
        if (inAnc || inDesc) edgeFinal.set(i, EMPHASIS.CHAIN);
      } else if (s === focus || t === focus) {
        const other = s === focus ? t : s;
        if (relatedAdj[focus].includes(other)) edgeFinal.set(i, EMPHASIS.RELATED);
      }
    }

    // Reveal schedule (ms). Focus + related at 0; ancestors step backward per
    // grade layer; descendants step forward, delayed 200ms and behind ancestors.
    const nodeReveal = new Map<number, number>();
    nodeReveal.set(focus, 0);
    for (const r of related) nodeReveal.set(r, 0);
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
      buildsOn: [...preds[focus]].sort(byGradeThenCode),
      leadsTo: [...succ[focus]].sort(byGradeThenCode),
      nodeFinal,
      edgeFinal,
      nodeReveal,
      edgeReveal,
    };
  }

  // Bounding sphere of a set of node indices. The min radius keeps a lone or
  // tightly-clustered focus from filling the frame — a standard with no mapped
  // connections (e.g. a parent whose sub-standards carry the edges) still lands
  // in a legible local context rather than a single giant sphere.
  function sphereOf(indices: number[]): THREE.Sphere {
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const i of indices) {
      const p = graph.nodes[i].pos;
      box.expandByPoint(v.set(p[0], p[1], p[2]));
    }
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    sphere.radius = Math.max(sphere.radius, 90);
    return sphere;
  }

  // --- emphasis rendering (idle vs focus, with hover overlay) --------------
  function renderEmphasis(): void {
    if (focusIndex !== null) {
      const nodeOv = new Map(curNodeOv);
      const edgeOv = new Map(curEdgeOv);
      if (hovered !== null && hovered !== focusIndex) {
        nodeOv.set(hovered, EMPHASIS.HOVER);
        for (const ei of adjacency[hovered]) edgeOv.set(ei, EMPHASIS.HOVER);
      }
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

  function updateHash(code: string | null): void {
    const base = location.pathname + location.search;
    const next = code ? `${base}#/s/${code}` : base;
    history.replaceState(null, "", next);
  }

  // --- focus ---------------------------------------------------------------
  function focus(nodeIndex: number, opts?: FocusOpts): void {
    if (nodeIndex < 0 || nodeIndex >= nodeCount) return;
    clearRevealTimers();
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
        applyEmphasis({
          baseNode: EMPHASIS.DIMMED,
          baseEdge: EMPHASIS.DIMMED,
          nodeOverrides: curNodeOv,
          edgeOverrides: curEdgeOv,
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

    // Camera: frame focus + its DIRECT neighbors.
    const neighborhood = [nodeIndex, ...data.buildsOn, ...data.leadsTo, ...data.related];
    void rig.focusOn(sphereOf(neighborhood), !cut);

    // Panel + narration + deep link.
    const connections: Connections = {
      buildsOn: data.buildsOn,
      leadsTo: data.leadsTo,
      related: [...data.related].sort(byGradeThenCode),
    };
    panel.show(nodeIndex, connections);
    announce(
      `Focused ${node.code}, builds on ${data.buildsOn.length} ` +
        `${data.buildsOn.length === 1 ? "standard" : "standards"}, leads to ${data.leadsTo.length}`,
    );
    updateHash(node.code);
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
    void rig.focusOn(sphere, !reducedMotion);
    requestRender();
  }

  function clearFocus(): void {
    if (focusIndex === null) return;
    clearRevealTimers();
    focusIndex = null;
    hovered = null;
    curNodeOv = new Map();
    curEdgeOv = new Map();
    lastAncestors = [];
    tooltip.hide();
    canvas.style.cursor = "";
    applyEmphasis({ baseNode: EMPHASIS.REST, baseEdge: EMPHASIS.REST });
    panel.hide();
    updateHash(null);
    requestRender();
  }

  return {
    get state() {
      if (hovered !== null) return "hover";
      if (searching) return "searching";
      if (focusIndex !== null) return "focus";
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
      tooltip.show(n.code, nodeContext(n), cursorX, cursorY);
      canvas.style.cursor = "pointer";
    },

    moveCursor(x, y) {
      if (hovered !== null) tooltip.move(x, y);
    },

    focus,
    focusByCode,
    trace,
    clearFocus,

    setSearching(on) {
      searching = on;
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
