// Explicit interaction state machine — the SINGLE writer of aEmphasis buffers
// (nodes + edges), tooltip visibility, and cursor style.
//
// Phase 2 states: 'idle' | 'hover'. focus() is a stub Phase 3 fills in.
//
// All emphasis writes flow through applyEmphasis(patch): a base value for
// every node/edge plus sparse overrides. Phase 3 extends by issuing richer
// patches (base DIMMED + chain/related overrides) — no rewrite needed.
//
// Transitions ease on the CPU: targets are set instantly, the GPU attributes
// chase them with an exponential ease (~150ms to settle, DESIGN's hover ramp),
// and the shaders blend piecewise-linearly between adjacent emphasis states
// for fractional values. tick() returns true while anything is still moving,
// which feeds render-on-demand.

import type { GraphCore, GraphNode } from "../data";
import { EMPHASIS, type Emphasis } from "../scene/palette";
import type { NodesHandle } from "../scene/nodes";
import type { EdgesHandle } from "../scene/edges";
import type { TooltipHandle } from "../ui/tooltip";

const EASE_TIME_CONSTANT = 0.05; // s; ~95% settled in 150ms
const SETTLE_EPSILON = 0.002;

export type MachineState = "idle" | "hover";

export interface EmphasisPatch {
  /** Emphasis for every node not listed in nodeOverrides. */
  baseNode: Emphasis;
  /** Emphasis for every edge not listed in edgeOverrides. */
  baseEdge: Emphasis;
  nodeOverrides?: ReadonlyMap<number, Emphasis>;
  edgeOverrides?: ReadonlyMap<number, Emphasis>;
}

export interface Machine {
  readonly state: MachineState;
  /** Hover a node by index (into graph.nodes), or null to clear. */
  setHover(nodeIndex: number | null, cursorX?: number, cursorY?: number): void;
  /** Keep the tooltip tracking the pointer while hover holds. */
  moveCursor(x: number, y: number): void;
  /** Phase 3 stub: focus flight + cascade land here. */
  focus(nodeIndex: number): void;
  /** Single choke point for all emphasis writes (Phase 3 extends via this). */
  applyEmphasis(patch: EmphasisPatch): void;
  /** Ease attributes toward targets. Returns true while animating. */
  tick(deltaSeconds: number): boolean;
  /** Node adjacency (edge indices per node index) — shared with Phase 3. */
  edgesOfNode(nodeIndex: number): readonly number[];
}

export function createMachine(
  graph: GraphCore,
  nodes: NodesHandle,
  edges: EdgesHandle,
  tooltip: TooltipHandle,
  canvas: HTMLCanvasElement,
): Machine {
  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;

  // node index -> indices of incident edges
  const indexById = new Map<string, number>();
  graph.nodes.forEach((n, i) => indexById.set(n.id, i));
  const adjacency: number[][] = Array.from({ length: nodeCount }, () => []);
  graph.edges.forEach((e, i) => {
    const s = indexById.get(e.s);
    const t = indexById.get(e.t);
    if (s !== undefined) adjacency[s].push(i);
    if (t !== undefined) adjacency[t].push(i);
  });

  // Targets (written by applyEmphasis) vs currents (eased into GPU attrs).
  const nodeTarget = new Float32Array(nodeCount).fill(EMPHASIS.REST);
  const edgeTarget = new Float32Array(edgeCount).fill(EMPHASIS.REST);
  const nodeCurrent = nodes.emphasisAttr.array as Float32Array;
  const edgeCurrent = edges.emphasisAttr.array as Float32Array;

  let animating = false;
  let state: MachineState = "idle";
  let hovered: number | null = null;

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

  function nodeLabel(n: GraphNode): { code: string; detail: string } {
    return { code: n.code, detail: `${n.domainName} · ${n.clusterCode}` };
  }

  return {
    get state() {
      return state;
    },

    setHover(nodeIndex, cursorX = 0, cursorY = 0) {
      if (nodeIndex === hovered) {
        if (nodeIndex !== null) tooltip.move(cursorX, cursorY);
        return;
      }
      hovered = nodeIndex;

      if (nodeIndex === null) {
        state = "idle";
        applyEmphasis({ baseNode: EMPHASIS.REST, baseEdge: EMPHASIS.REST });
        tooltip.hide(); // no delay out
        canvas.style.cursor = "";
        return;
      }

      state = "hover";
      const nodeOverrides = new Map<number, Emphasis>([[nodeIndex, EMPHASIS.HOVER]]);
      const edgeOverrides = new Map<number, Emphasis>();
      for (const ei of adjacency[nodeIndex]) edgeOverrides.set(ei, EMPHASIS.HOVER);
      applyEmphasis({
        baseNode: EMPHASIS.REST,
        baseEdge: EMPHASIS.REST,
        nodeOverrides,
        edgeOverrides,
      });
      const { code, detail } = nodeLabel(graph.nodes[nodeIndex]);
      tooltip.show(code, detail, cursorX, cursorY); // 120ms delay handled inside
      canvas.style.cursor = "pointer";
    },

    moveCursor(x, y) {
      if (hovered !== null) tooltip.move(x, y);
    },

    focus(nodeIndex) {
      // Phase 3: camera flight + cascade + detail panel. Deliberately inert now.
      void nodeIndex;
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
