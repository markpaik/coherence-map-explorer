// Tri-pose "unravel" morph driver — the CPU-side animator that carries the
// scene between pose 0 (the Constellation, node.pos), pose 1 ("the Ascent",
// node.pos2, a dependency-depth massif where every prerequisite edge points
// upward), and pose 2 ("the Blueprint", node.pos3, a flat grade-column circuit
// board echoing the original coherence map). It is deliberately CPU-side (no
// shader morph) so raycast picking stays correct continuously: the instance
// matrices themselves move, so the pick proxy moves with them and hover/click
// keep landing on the dots.
//
// Ownership: the driver owns ONLY pose geometry — node instance positions, the
// edge bezier attributes, and the grade/course etch transforms. It never writes
// emphasis (the state machine remains the single writer of that); it only asks
// the machine to reframe an active focus once a morph settles.
//
// Choreography: on setPose the driver captures each node's CURRENT position as
// the morph start and eases it to the target pose's coords over NODE_MS, staggered
// per node. The stagger ORDER depends on where we're going: entering the Ascent
// (→1) foundations land first (depth·STAGGER_MS); returning to the Constellation
// (→0) the summit releases first ((maxDepth−depth)·STAGGER_MS); entering the
// Blueprint (→2) columns assemble left-to-right in reading order (col·COLUMN_MS).
// Capturing the live start makes reversals mid-morph continuous. Everything is a
// pure function of elapsed time + per-node depth/column — deterministic, no
// Math.random.

import * as THREE from "three";
import type { GraphCore, GraphNode } from "../data";
import type { NodesHandle } from "./nodes";
import type { EdgesHandle } from "./edges";
import type { EtchesHandle } from "./etches";
import type { CameraRig } from "./camera";
import type { Machine } from "../state/machine";
import { createEvolveField } from "./evolve";

const STAGGER_MS = 35; // per unit of dependency depth (poses 0/1)
const COLUMN_MS = 35; // per grade-column index, left→right (entering pose 2)
const NODE_MS = 650; // each node's own transition length
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

// Blueprint column index (0..12): K,1..8 → 0..8, then Appendix A courses by
// primary membership (courses[0]) → A1=9, G=10, A2=11, ADV=12. Mirrors the
// pipeline's blueprintColumn; used only for the entering-Blueprint stagger.
const COURSE_ORDER = ["A1", "G", "A2", "ADV"] as const;
const GRADE_COL = ["K", "1", "2", "3", "4", "5", "6", "7", "8"] as const;
function columnIndexOf(node: GraphNode): number {
  if (node.grade !== "HS") {
    const gi = (GRADE_COL as readonly string[]).indexOf(node.grade);
    return gi < 0 ? 0 : gi;
  }
  const ci = (COURSE_ORDER as readonly string[]).indexOf(node.courses?.[0] ?? "ADV");
  return 9 + (ci < 0 ? COURSE_ORDER.length - 1 : ci);
}

export type Pose = 0 | 1 | 2;

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
  /** Per-visit seed for the evolving sky (one of infinite skies). */
  visitSeed?: number;
}

export interface PoseDriver {
  /** Global morph progress along the pose axis, 0 … 2 (continuous while morphing). */
  readonly pose: number;
  /** The settled/target pose (what aria-pressed and the scale hint key off). */
  readonly target: Pose;
  /** Morph to a pose. Resolves when the transition settles (instant ⇒ at once). */
  setPose(target: Pose, opts?: { instant?: boolean }): Promise<void>;
  /** Advance the morph; returns true while morphing (drives render-on-demand). */
  tick(dt: number): boolean;
  /**
   * Advance the evolving sky (scene seconds since boot). The Constellation and
   * the Ascent drift through the day-seeded displacement field (scene/evolve);
   * the Blueprint holds still. main.ts skips this under reduced motion, which
   * freezes the field at its boot shape (still time-of-day dependent).
   */
  setEvolveTime(t: number): void;
}

export function createPoseDriver(deps: PoseDriverDeps): PoseDriver {
  const { graph, nodes, edges, etches, rig, machine, requestRender, reducedMotion } = deps;

  const n = graph.nodes.length;
  const m = graph.edges.length;

  // -- baked pose endpoints (one flat array per pose) ----------------------
  const nodePoses: Float32Array[] = [
    new Float32Array(n * 3),
    new Float32Array(n * 3),
    new Float32Array(n * 3),
  ];
  const depth = new Int32Array(n);
  const colIndex = new Int32Array(n);
  let maxDepth = 0;
  let maxCol = 0;
  graph.nodes.forEach((node, i) => {
    nodePoses[0].set(node.pos, i * 3);
    nodePoses[1].set(node.pos2, i * 3);
    nodePoses[2].set(node.pos3, i * 3);
    depth[i] = node.depth;
    colIndex[i] = columnIndexOf(node);
    if (node.depth > maxDepth) maxDepth = node.depth;
    if (colIndex[i] > maxCol) maxCol = colIndex[i];
  });

  const indexById = new Map<string, number>();
  graph.nodes.forEach((node, i) => indexById.set(node.id, i));

  // Edge endpoint node indices + a control point per pose (flattened).
  const eS = new Int32Array(m);
  const eT = new Int32Array(m);
  const edgeCtrls: Float32Array[] = [
    new Float32Array(m * 3),
    new Float32Array(m * 3),
    new Float32Array(m * 3),
  ];
  graph.edges.forEach((e, j) => {
    eS[j] = indexById.get(e.s) ?? -1;
    eT[j] = indexById.get(e.t) ?? -1;
    edgeCtrls[0].set(e.c, j * 3);
    edgeCtrls[1].set(e.c2, j * 3);
    edgeCtrls[2].set(e.c3, j * 3);
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
  const homes = [boundsOf(nodePoses[0]), boundsOf(nodePoses[1]), boundsOf(nodePoses[2])];

  // -- the evolving sky ------------------------------------------------------
  // The generative layer: poses 0/1's TARGET arrays are base + a day-seeded
  // displacement field, refreshed slowly. Everything downstream (morph lerps,
  // edge endpoints, pick proxy, beacons) follows automatically because they
  // all read through nodePoses/curPos. Edge controls ride the mean of their
  // endpoints' offsets so the bows bend with the field.
  const basePose0 = new Float32Array(nodePoses[0]);
  const basePose1 = new Float32Array(nodePoses[1]);
  const baseCtrl0 = new Float32Array(edgeCtrls[0]);
  const baseCtrl1 = new Float32Array(edgeCtrls[1]);
  const off0 = new Float32Array(n * 3);
  const off1 = new Float32Array(n * 3);
  const field = createEvolveField(graph, deps.visitSeed ?? 0);
  function applyEvolve(t: number): void {
    field.apply(t, basePose0, nodePoses[0], basePose1, nodePoses[1], off0, off1);
    for (let j = 0; j < m; j++) {
      const s = eS[j];
      const t2 = eT[j];
      if (s < 0 || t2 < 0) continue;
      for (let c = 0; c < 3; c++) {
        const mean0 = (off0[s * 3 + c] + off0[t2 * 3 + c]) * 0.5;
        const mean1 = (off1[s * 3 + c] + off1[t2 * 3 + c]) * 0.5;
        edgeCtrls[0][j * 3 + c] = baseCtrl0[j * 3 + c] + mean0;
        edgeCtrls[1][j * 3 + c] = baseCtrl1[j * 3 + c] + mean1;
      }
    }
  }
  applyEvolve(0); // boot: today's shape from the first frame

  // -- morph state ---------------------------------------------------------
  // A morph eases each node from a captured START position to the TARGET pose's
  // position over its own NODE_MS window (offset by a per-node stagger). Because
  // the start is captured live at setPose time, reversing or re-targeting mid-
  // morph stays perfectly continuous. curPos/curCtrl are the authoritative live
  // geometry (curPos also feeds the edge endpoints).
  const startPos = new Float32Array(nodePoses[0]);
  const curPos = new Float32Array(nodePoses[0]);
  const nodeProg = new Float32Array(n); // per-node eased progress this morph (for the edge ctrl lerp)
  const startCtrl = new Float32Array(edgeCtrls[0]);
  const curCtrl = new Float32Array(edgeCtrls[0]);

  let poseValue = 0; // exposed as `pose` (continuous 0..2)
  let fromPose = 0;
  let targetPose: Pose = 0;
  let morphing = false;
  let elapsed = 0;
  let totalMs = NODE_MS;
  let pendingResolve: (() => void) | null = null;

  function delayFor(dest: Pose, i: number): number {
    if (dest === 2) return colIndex[i] * COLUMN_MS;
    if (dest === 1) return depth[i] * STAGGER_MS;
    return (maxDepth - depth[i]) * STAGGER_MS;
  }
  function maxDelayFor(dest: Pose): number {
    return dest === 2 ? maxCol * COLUMN_MS : maxDepth * STAGGER_MS;
  }

  // -- per-frame writers ---------------------------------------------------
  function writeNodes(): void {
    for (let i = 0; i < n; i++) {
      nodes.setInstancePosition(i, curPos[i * 3], curPos[i * 3 + 1], curPos[i * 3 + 2]);
    }
    nodes.commitPositions();
  }

  function writeEdges(): void {
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
      ec[j * 3] = curCtrl[j * 3];
      ec[j * 3 + 1] = curCtrl[j * 3 + 1];
      ec[j * 3 + 2] = curCtrl[j * 3 + 2];
    }
    edges.startAttr.needsUpdate = true;
    edges.ctrlAttr.needsUpdate = true;
    edges.endAttr.needsUpdate = true;
  }

  function writeAll(): void {
    writeNodes();
    writeEdges();
    etches.setPose(poseValue);
  }

  // Refit the camera to the settled pose. Store the pose's home bounds first so
  // the tour's wide shots and frameHome() work in any pose; then either reframe
  // an active focus or return to the pose's default home framing (head-on for
  // the flat Blueprint, the heroic 3/4 shot otherwise).
  function settleCamera(target: Pose, transition: boolean): void {
    const home = homes[target];
    rig.setHomeBounds(home.box, home.sphere);
    // The flat Blueprint reads front-on: quiet the idle sway to a whisper so
    // the plane breathes without leaning into perspective. Other poses keep
    // the full ±18° drift.
    rig.setDriftScale(target === 2 ? 0.18 : 1);
    if (machine.focusedIndex !== null) machine.reframe();
    else if (target === 2) rig.frameHomeFrontOn(transition);
    else rig.frameHome(transition);
  }

  function resolvePending(): void {
    const res = pendingResolve;
    pendingResolve = null;
    res?.();
  }

  function jumpTo(target: Pose): void {
    curPos.set(nodePoses[target]);
    startPos.set(curPos);
    curCtrl.set(edgeCtrls[target]);
    startCtrl.set(curCtrl);
    nodeProg.fill(1);
    poseValue = target;
    fromPose = target;
    targetPose = target;
    morphing = false;
    elapsed = 0;
    writeAll();
    nodes.refreshPickBounds();
    settleCamera(target, false);
    requestRender();
  }

  // First paint carries the evolved boot shape (curPos was seeded from the
  // already-evolved nodePoses[0] above; push it through to the buffers).
  writeAll();
  nodes.refreshPickBounds();

  let lastEvolveT = 0;
  let lastPickRefreshT = 0;

  return {
    get pose() {
      return poseValue;
    },
    get target() {
      return targetPose;
    },

    setEvolveTime(t) {
      if (t - lastEvolveT < 0.5) return; // the field moves at day-scale; 2Hz is plenty
      lastEvolveT = t;
      applyEvolve(t);
      if (morphing) return; // tick() reads the refreshed targets live
      if (targetPose === 2) return; // the Blueprint holds still (targets stay fresh for the next morph)
      curPos.set(nodePoses[targetPose]);
      curCtrl.set(edgeCtrls[targetPose]);
      writeAll();
      if (t - lastPickRefreshT > 4) {
        lastPickRefreshT = t;
        nodes.refreshPickBounds();
      }
      requestRender();
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
      // Begin a morph FROM wherever every node currently sits (clean reversal /
      // re-target): capture the live geometry as the start of the new morph.
      startPos.set(curPos);
      startCtrl.set(curCtrl);
      fromPose = poseValue;
      targetPose = target;
      totalMs = maxDelayFor(target) + NODE_MS;
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
      const target = nodePoses[dest];
      const targetC = edgeCtrls[dest];
      const landed = elapsed >= totalMs;

      // Global (unstaggered) eased progress drives the etch migration + `pose`.
      const g = smoothstep(clamp01(elapsed / totalMs));
      poseValue = fromPose + (dest - fromPose) * g;

      // Per-node staggered eased progress from the captured start to the target.
      for (let i = 0; i < n; i++) {
        const local = smoothstep((elapsed - delayFor(dest, i)) / NODE_MS);
        nodeProg[i] = local;
        curPos[i * 3] = startPos[i * 3] + (target[i * 3] - startPos[i * 3]) * local;
        curPos[i * 3 + 1] = startPos[i * 3 + 1] + (target[i * 3 + 1] - startPos[i * 3 + 1]) * local;
        curPos[i * 3 + 2] = startPos[i * 3 + 2] + (target[i * 3 + 2] - startPos[i * 3 + 2]) * local;
      }

      // Edge control rides the LESS-advanced endpoint so the arc never bulges
      // ahead of the nodes it connects; lerp from the captured start ctrl to the
      // target pose's ctrl by that fraction.
      for (let j = 0; j < m; j++) {
        const s = eS[j];
        const t = eT[j];
        const f = s < 0 || t < 0 ? nodeProg[Math.max(s, t, 0)] : Math.min(nodeProg[s], nodeProg[t]);
        curCtrl[j * 3] = startCtrl[j * 3] + (targetC[j * 3] - startCtrl[j * 3]) * f;
        curCtrl[j * 3 + 1] = startCtrl[j * 3 + 1] + (targetC[j * 3 + 1] - startCtrl[j * 3 + 1]) * f;
        curCtrl[j * 3 + 2] = startCtrl[j * 3 + 2] + (targetC[j * 3 + 2] - startCtrl[j * 3 + 2]) * f;
      }

      if (landed) {
        // Land exactly on the target pose (guards against float drift).
        curPos.set(target);
        curCtrl.set(targetC);
        nodeProg.fill(1);
        poseValue = dest;
      }

      writeAll();

      if (landed) {
        morphing = false;
        nodes.refreshPickBounds();
        settleCamera(dest, true);
        resolvePending();
      }

      requestRender();
      return true;
    },
  };
}
