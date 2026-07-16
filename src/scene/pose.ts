// Dual-pose "unravel" morph driver — the CPU-side animator that carries the
// scene between pose A (the constellation, node.pos) and pose B ("the Ascent",
// node.pos2, a dependency-depth massif where every prerequisite edge points
// upward). It is deliberately CPU-side (no shader morph) so raycast picking
// stays correct continuously: the instance matrices themselves move, so the
// pick proxy moves with them and hover/click keep landing on the dots.
//
// Ownership: the driver owns ONLY pose geometry — node instance positions, the
// edge bezier attributes, and the grade/course etch transforms. It never writes
// emphasis (the state machine remains the single writer of that); it only asks
// the machine to reframe an active focus once a morph settles.
//
// Choreography: each node's transition lasts NODE_MS, eased smoothstep, and is
// staggered by dependency depth. Going TO the Ascent (0→1) the foundations land
// first (depth·STAGGER_MS); returning (1→0) the summit releases first
// ((maxDepth−depth)·STAGGER_MS). Total ≈ maxDepth·STAGGER_MS + NODE_MS ≈ 1.7s.
// Everything is a pure function of elapsed time + per-node depth — deterministic,
// no Math.random.

import * as THREE from "three";
import type { GraphCore } from "../data";
import type { NodesHandle } from "./nodes";
import type { EdgesHandle } from "./edges";
import type { EtchesHandle } from "./etches";
import type { CameraRig } from "./camera";
import type { Machine } from "../state/machine";

const STAGGER_MS = 35; // per unit of dependency depth
const NODE_MS = 650; // each node's own transition length
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

export interface PoseDriverDeps {
  graph: GraphCore;
  nodes: NodesHandle;
  edges: EdgesHandle;
  etches: EtchesHandle;
  rig: CameraRig;
  machine: Machine;
  requestRender: () => void;
  /** Live reduced-motion flag; when true, every setPose is forced instant. */
  reducedMotion: () => boolean;
}

export interface PoseDriver {
  /** Global ascent progress, 0 = constellation … 1 = the Ascent. */
  readonly pose: number;
  /** The settled/target pose (what aria-pressed and the scale hint key off). */
  readonly target: 0 | 1;
  /** Morph to a pose. Resolves when the transition settles (instant ⇒ at once). */
  setPose(target: 0 | 1, opts?: { instant?: boolean }): Promise<void>;
  /** Advance the morph; returns true while morphing (drives render-on-demand). */
  tick(dt: number): boolean;
}

export function createPoseDriver(deps: PoseDriverDeps): PoseDriver {
  const { graph, nodes, edges, etches, rig, machine, requestRender, reducedMotion } = deps;

  const n = graph.nodes.length;
  const m = graph.edges.length;

  // -- baked pose endpoints ------------------------------------------------
  const posA = new Float32Array(n * 3);
  const posB = new Float32Array(n * 3);
  const depth = new Int32Array(n);
  let maxDepth = 0;
  graph.nodes.forEach((node, i) => {
    posA.set(node.pos, i * 3);
    posB.set(node.pos2, i * 3);
    depth[i] = node.depth;
    if (node.depth > maxDepth) maxDepth = node.depth;
  });
  const totalMs = maxDepth * STAGGER_MS + NODE_MS;

  const indexById = new Map<string, number>();
  graph.nodes.forEach((node, i) => indexById.set(node.id, i));

  // Edge endpoint node indices + both control points (flattened for the frame loop).
  const eS = new Int32Array(m);
  const eT = new Int32Array(m);
  const ctrlA = new Float32Array(m * 3);
  const ctrlB = new Float32Array(m * 3);
  graph.edges.forEach((e, j) => {
    eS[j] = indexById.get(e.s) ?? -1;
    eT[j] = indexById.get(e.t) ?? -1;
    ctrlA.set(e.c, j * 3);
    ctrlB.set(e.c2, j * 3);
  });

  // Edge attribute backing arrays (rewritten in place each morph frame).
  const es = edges.startAttr.array as Float32Array;
  const ec = edges.ctrlAttr.array as Float32Array;
  const ee = edges.endAttr.array as Float32Array;

  // Per-pose home bounds for the camera refit (exact — a completed morph lands
  // every node on its pose coords, so these are computed from the baked poses).
  function boundsOf(src: Float32Array): { box: THREE.Box3; sphere: THREE.Sphere } {
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) box.expandByPoint(v.set(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]));
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    return { box, sphere };
  }
  const homeA = boundsOf(posA);
  const homeB = boundsOf(posB);

  // -- morph state ---------------------------------------------------------
  // curAscent[i] ∈ [0,1]: node i's current fraction between pos (0) and pos2 (1).
  // Because a position is ALWAYS lerp(pos, pos2, curAscent), a single scalar per
  // node captures the whole state — reversals mid-morph stay continuous, and the
  // edge control lerp reads the same fraction directly.
  const curAscent = new Float32Array(n); // starts all-0 = constellation
  const fromAscent = new Float32Array(n);
  const curPos = new Float32Array(posA); // mirror, feeds the edge endpoints

  let etchAscent = 0;
  let fromEtch = 0;
  let poseValue = 0; // exposed as `pose`
  let targetPose: 0 | 1 = 0;
  let morphing = false;
  let elapsed = 0;
  let pendingResolve: (() => void) | null = null;

  // -- per-frame writers ---------------------------------------------------
  function applyNodes(): void {
    for (let i = 0; i < n; i++) {
      const a = curAscent[i];
      const x = posA[i * 3] + (posB[i * 3] - posA[i * 3]) * a;
      const y = posA[i * 3 + 1] + (posB[i * 3 + 1] - posA[i * 3 + 1]) * a;
      const z = posA[i * 3 + 2] + (posB[i * 3 + 2] - posA[i * 3 + 2]) * a;
      curPos[i * 3] = x;
      curPos[i * 3 + 1] = y;
      curPos[i * 3 + 2] = z;
      nodes.setInstancePosition(i, x, y, z);
    }
    nodes.commitPositions();
  }

  function applyEdges(): void {
    for (let j = 0; j < m; j++) {
      const s = eS[j];
      const t = eT[j];
      if (s < 0 || t < 0) continue;
      es[j * 3] = curPos[s * 3];
      es[j * 3 + 1] = curPos[s * 3 + 1];
      es[j * 3 + 2] = curPos[s * 3 + 2];
      ee[j * 3] = curPos[t * 3];
      ee[j * 3 + 1] = curPos[t * 3 + 1];
      ee[j * 3 + 2] = curPos[t * 3 + 2];
      // Control rides the LESS-advanced endpoint so the arc never bulges ahead
      // of the nodes it connects.
      const f = curAscent[s] < curAscent[t] ? curAscent[s] : curAscent[t];
      ec[j * 3] = ctrlA[j * 3] + (ctrlB[j * 3] - ctrlA[j * 3]) * f;
      ec[j * 3 + 1] = ctrlA[j * 3 + 1] + (ctrlB[j * 3 + 1] - ctrlA[j * 3 + 1]) * f;
      ec[j * 3 + 2] = ctrlA[j * 3 + 2] + (ctrlB[j * 3 + 2] - ctrlA[j * 3 + 2]) * f;
    }
    edges.startAttr.needsUpdate = true;
    edges.ctrlAttr.needsUpdate = true;
    edges.endAttr.needsUpdate = true;
  }

  function applyAll(): void {
    applyNodes();
    applyEdges();
    etches.setPose(etchAscent);
  }

  // Refit the camera to the settled pose. Store the pose's home bounds first so
  // the tour's wide shots and frameHome() work in either pose; then either
  // reframe an active focus or return to the heroic home framing.
  function settleCamera(target: 0 | 1, transition: boolean): void {
    const home = target === 1 ? homeB : homeA;
    rig.setHomeBounds(home.box, home.sphere);
    if (machine.focusedIndex !== null) machine.reframe();
    else rig.frameHome(transition);
  }

  function resolvePending(): void {
    const res = pendingResolve;
    pendingResolve = null;
    res?.();
  }

  function jumpTo(target: 0 | 1): void {
    curAscent.fill(target);
    etchAscent = target;
    poseValue = target;
    targetPose = target;
    morphing = false;
    elapsed = 0;
    applyAll();
    settleCamera(target, false);
    requestRender();
  }

  return {
    get pose() {
      return poseValue;
    },
    get target() {
      return targetPose;
    },

    setPose(target, opts) {
      const instant = opts?.instant === true || reducedMotion();
      // Supersede any in-flight morph so an awaiting caller never hangs.
      resolvePending();

      if (instant) {
        jumpTo(target);
        return Promise.resolve();
      }
      // Already settled at the requested pose — nothing to animate.
      if (!morphing && targetPose === target && poseValue === target) {
        return Promise.resolve();
      }
      // Begin a morph FROM wherever every node currently sits (clean reversal).
      fromAscent.set(curAscent);
      fromEtch = etchAscent;
      targetPose = target;
      elapsed = 0;
      morphing = true;
      requestRender();
      return new Promise<void>((res) => {
        pendingResolve = res;
      });
    },

    tick(dt) {
      if (!morphing) return false;
      elapsed += dt * 1000;
      const dest = targetPose;

      // Global (unstaggered) eased progress drives the etch migration + `pose`.
      etchAscent = fromEtch + (dest - fromEtch) * smoothstep(clamp01(elapsed / totalMs));
      poseValue = etchAscent;

      // Per-node staggered eased progress. Direction sets who moves first.
      for (let i = 0; i < n; i++) {
        const delay = dest === 1 ? depth[i] * STAGGER_MS : (maxDepth - depth[i]) * STAGGER_MS;
        const local = smoothstep((elapsed - delay) / NODE_MS);
        curAscent[i] = fromAscent[i] + (dest - fromAscent[i]) * local;
      }

      applyAll();

      if (elapsed >= totalMs) {
        // Land exactly on the target pose (guards against float drift).
        curAscent.fill(dest);
        etchAscent = dest;
        poseValue = dest;
        applyAll();
        morphing = false;
        settleCamera(dest, true);
        resolvePending();
      }

      requestRender();
      return true;
    },
  };
}
