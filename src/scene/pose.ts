// Four-pose "unravel" morph driver — the CPU-side animator that carries the
// scene between pose 0 (the Constellation, node.pos), pose 1 ("the Ascent",
// node.pos2, a dependency-depth massif where every prerequisite edge points
// upward), pose 2 ("the Blueprint", node.pos3, a flat grade-column circuit
// board echoing the original coherence map), and pose 3 ("the Transit Map",
// node.pos4, an octolinear metro with per-line z-levels — front-on it collapses
// to the flat schematic, orbiting reveals the layered city). It is CPU-side (no
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
// Blueprint (→2) or the Transit Map (→3) columns assemble left-to-right in
// reading order (col·COLUMN_MS).
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
import {
  scatterPositions,
  scatterHalfExtents,
  nodeProgress,
  edgeGrow,
  openerDurationMs,
} from "./opener";

const STAGGER_MS = 35; // per unit of dependency depth (poses 0/1)
const COLUMN_MS = 35; // per grade-column index, left→right (entering pose 2)
const NODE_MS = 650; // each node's own transition length
// Refresh the pick proxy's bounding sphere every Nth MORPH frame (not just at the
// endpoints). During a morph the per-instance proxy matrices already move every
// frame, but the mesh-level bounding sphere — the raycaster's broad-phase reject —
// is only recomputed when a morph settles, so a node that travels outside the
// last-settled bounds becomes momentarily un-hoverable/-clickable (a pick dead-
// zone). computeBoundingSphere over the 480-instance proxy measured ~13µs (≈0.08%
// of a 60fps frame), so a small interval keeps the bounds fresh for negligible cost.
const PICK_REFRESH_EVERY = 3;
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

export type Pose = 0 | 1 | 2 | 3;

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
  /** Global morph progress along the pose axis, 0 … 3 (continuous while morphing). */
  readonly pose: number;
  /** The settled/target pose (what aria-pressed and the scale hint key off). */
  readonly target: Pose;
  /**
   * The morph's ORIGIN — the pose we departed (the previous settled target).
   * Settled ⇒ origin === target; while morphing it is the endpoint we left. It
   * lets main.ts gate the round-10 layers (sheet / drafts / contours / stations
   * / environs) to their endpoints, so a morph that SWEEPS THROUGH a home pose
   * (e.g. 0→3 passes the scalar pose value 2) never flashes that home's layer.
   */
  readonly origin: Pose;
  /** Morph to a pose. Resolves when the transition settles (instant ⇒ at once). */
  setPose(target: Pose, opts?: { instant?: boolean }): Promise<void>;
  /**
   * Play the first-visit opener: seed a deterministic SCATTER field (from the
   * clock `seed`, mulberry32), then converge the nodes into pose 0 with a K→HS
   * stagger while the ribbons draw themselves in. Resolves when it settles onto
   * the ordinary settled-pose-0 state (naturally OR via snapOpener). Under
   * reduced motion it is a no-op (the driver is already settled at pose 0).
   * main.ts only calls this on a normal load (skipped for deep links / ?og /
   * reduced motion), so nothing else needs to guard the poses.
   */
  startOpener(seed: number): Promise<void>;
  /**
   * Snap a playing opener straight to its settled end state (exact pose-0
   * geometry + fully-formed edges + fresh pick bounds), resolving the startOpener
   * promise. Idempotent — a no-op if the opener isn't running. Wired to the first
   * user interaction so the opener never locks input.
   */
  snapOpener(): void;
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
    nodePoses[3].set(node.pos4, i * 3);
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
    new Float32Array(m * 3),
  ];
  graph.edges.forEach((e, j) => {
    eS[j] = indexById.get(e.s) ?? -1;
    eT[j] = indexById.get(e.t) ?? -1;
    edgeCtrls[0].set(e.c, j * 3);
    edgeCtrls[1].set(e.c2, j * 3);
    edgeCtrls[2].set(e.c3, j * 3);
    edgeCtrls[3].set(e.c4, j * 3);
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
  const homes = [
    boundsOf(nodePoses[0]),
    boundsOf(nodePoses[1]),
    boundsOf(nodePoses[2]),
    boundsOf(nodePoses[3]),
  ];

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

  let poseValue = 0; // exposed as `pose` (continuous 0..3)
  let fromPose = 0;
  let targetPose: Pose = 0;
  let originPose: Pose = 0; // the pose we're leaving (previous target); === target when settled
  let morphing = false;
  let elapsed = 0;
  let totalMs = NODE_MS;
  let pendingResolve: (() => void) | null = null;
  let morphPickFrames = 0; // throttles the mid-morph pick-bounds refresh

  // -- opener state --------------------------------------------------------
  // The first-visit assembly runs BEFORE any pose morph and shares the morph's
  // live geometry buffers (curPos / nodeProg / the edge attribute arrays). It
  // eases each node from its captured `scatter` position to the live pose-0
  // target, and draws each ribbon in from its source. On settle it lands exactly
  // on nodePoses[0], leaving a clean settled-pose-0 state identical to jumpTo(0).
  const scatter = new Float32Array(n * 3);
  let opening = false;
  let openerElapsed = 0;
  let openerTotal = openerDurationMs();
  let openerResolve: (() => void) | null = null;

  function delayFor(dest: Pose, i: number): number {
    if (dest >= 2) return colIndex[i] * COLUMN_MS; // Blueprint + Transit stagger by grade column
    if (dest === 1) return depth[i] * STAGGER_MS;
    return (maxDepth - depth[i]) * STAGGER_MS;
  }
  function maxDelayFor(dest: Pose): number {
    return dest >= 2 ? maxCol * COLUMN_MS : maxDepth * STAGGER_MS;
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

  // Opener edge writer: each ribbon DRAWS ITSELF from its source node toward its
  // target as the target lands. grow (from the less-advanced endpoint's progress)
  // extends the endpoint + control from a collapsed point at the source (grow 0 ⇒
  // zero-length ⇒ invisible) out to the real bezier (grow 1 ⇒ end = target home,
  // ctrl = pose-0 control — byte-identical to the settled ribbon). Reads curPos so
  // the growing tip tracks the still-arriving node.
  function writeOpenerEdges(): void {
    const ctrl0 = edgeCtrls[0];
    for (let j = 0; j < m; j++) {
      const s = eS[j];
      const t = eT[j];
      if (s < 0 || t < 0) continue;
      const g = edgeGrow(Math.min(nodeProg[s], nodeProg[t]));
      const sx = curPos[s * 3];
      const sy = curPos[s * 3 + 1];
      const sz = curPos[s * 3 + 2];
      const tx = curPos[t * 3];
      const ty = curPos[t * 3 + 1];
      const tz = curPos[t * 3 + 2];
      es[j * 3] = sx;
      es[j * 3 + 1] = sy;
      es[j * 3 + 2] = sz;
      ee[j * 3] = sx + (tx - sx) * g;
      ee[j * 3 + 1] = sy + (ty - sy) * g;
      ee[j * 3 + 2] = sz + (tz - sz) * g;
      ec[j * 3] = sx + (ctrl0[j * 3] - sx) * g;
      ec[j * 3 + 1] = sy + (ctrl0[j * 3 + 1] - sy) * g;
      ec[j * 3 + 2] = sz + (ctrl0[j * 3 + 2] - sz) * g;
    }
    edges.startAttr.needsUpdate = true;
    edges.ctrlAttr.needsUpdate = true;
    edges.endAttr.needsUpdate = true;
  }

  // Land the opener on the exact settled pose-0 state (same end state jumpTo(0)
  // produces) and resolve the startOpener promise. Called on natural completion
  // and by snapOpener. The camera already holds the home framing, so it is left
  // untouched (no reframe flight).
  function finishOpener(): void {
    if (!opening) return;
    opening = false;
    curPos.set(nodePoses[0]);
    startPos.set(curPos);
    curCtrl.set(edgeCtrls[0]);
    startCtrl.set(curCtrl);
    nodeProg.fill(1);
    poseValue = 0;
    fromPose = 0;
    targetPose = 0;
    originPose = 0;
    morphing = false;
    writeAll();
    nodes.refreshPickBounds();
    requestRender();
    const res = openerResolve;
    openerResolve = null;
    res?.();
  }

  // Refit the camera to the settled pose. Store the pose's home bounds first so
  // the tour's wide shots and frameHome() work in any pose; then either reframe
  // an active focus or return to the pose's default home framing (head-on for
  // the flat Blueprint, the heroic 3/4 shot otherwise).
  function settleCamera(target: Pose, transition: boolean): void {
    const home = homes[target];
    rig.setHomeBounds(home.box, home.sphere);
    // The flat Blueprint and the Transit schematic both read front-on: quiet the
    // idle sway to a whisper so the plane breathes without leaning into
    // perspective (Transit's z-layers reveal on deliberate orbit, not drift).
    // Other poses keep the full ±18° drift.
    rig.setDriftScale(target >= 2 ? 0.18 : 1);
    if (machine.focusedIndex !== null) machine.reframe();
    else if (target >= 2) rig.frameHomeFrontOn(transition);
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
    originPose = target; // settled ⇒ origin === target
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
    get origin() {
      return originPose;
    },

    setEvolveTime(t) {
      if (t - lastEvolveT < 0.5) return; // the field moves at day-scale; 2Hz is plenty
      lastEvolveT = t;
      applyEvolve(t);
      // The opener owns curPos while it plays; let it keep converging to the
      // freshly-evolved pose-0 target (applyEvolve above updated it) but never
      // let the evolve writer overwrite the mid-assembly geometry.
      if (opening) return;
      if (morphing) return; // tick() reads the refreshed targets live
      if (targetPose >= 2) return; // the Blueprint + Transit hold still (only 0/1 evolve; targets stay fresh)
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
      originPose = targetPose; // the pose we're leaving (the previous target)
      targetPose = target;
      totalMs = maxDelayFor(target) + NODE_MS;
      elapsed = 0;
      morphing = true;
      requestRender();
      return new Promise<void>((res) => {
        pendingResolve = res;
      });
    },

    startOpener(seed) {
      // Reduced motion: no assembly animation — leave the settled pose-0 the
      // driver already wrote at construction. (main.ts also gates on this.)
      if (reducedMotion()) return Promise.resolve();
      // Supersede anything in flight (defensive — the opener runs first at boot).
      resolvePending();
      // Scatter about the constellation's own (floored) box, so the cloud reads
      // as an expanded, dispersed map rather than a sphere. homes[0].box is the
      // baked pose-0 bounds (the evolve offset is negligible against them).
      const box = homes[0].box;
      const center: [number, number, number] = [
        (box.min.x + box.max.x) / 2,
        (box.min.y + box.max.y) / 2,
        (box.min.z + box.max.z) / 2,
      ];
      const half = scatterHalfExtents([
        (box.max.x - box.min.x) / 2,
        (box.max.y - box.min.y) / 2,
        (box.max.z - box.min.z) / 2,
      ]);
      scatter.set(scatterPositions(n, center, half, seed));
      curPos.set(scatter);
      startPos.set(scatter);
      curCtrl.set(edgeCtrls[0]);
      startCtrl.set(curCtrl);
      nodeProg.fill(0);
      poseValue = 0;
      fromPose = 0;
      targetPose = 0;
      originPose = 0;
      morphing = false;
      opening = true;
      openerElapsed = 0;
      openerTotal = openerDurationMs();
      morphPickFrames = 0;
      // Paint the scattered field + fully-hidden edges before the first frame so
      // the opener never flashes the settled map. writeOpenerEdges reads nodeProg
      // (all 0 ⇒ every ribbon collapsed to a point).
      writeNodes();
      writeOpenerEdges();
      etches.setPose(0);
      nodes.refreshPickBounds();
      requestRender();
      return new Promise<void>((res) => {
        openerResolve = res;
      });
    },

    snapOpener() {
      finishOpener();
    },

    tick(dt) {
      if (opening) {
        openerElapsed += dt * 1000;
        const landed = openerElapsed >= openerTotal;
        for (let i = 0; i < n; i++) {
          const frac = maxCol > 0 ? colIndex[i] / maxCol : 0;
          const p = nodeProgress(openerElapsed, frac);
          nodeProg[i] = p;
          curPos[i * 3] = scatter[i * 3] + (nodePoses[0][i * 3] - scatter[i * 3]) * p;
          curPos[i * 3 + 1] =
            scatter[i * 3 + 1] + (nodePoses[0][i * 3 + 1] - scatter[i * 3 + 1]) * p;
          curPos[i * 3 + 2] =
            scatter[i * 3 + 2] + (nodePoses[0][i * 3 + 2] - scatter[i * 3 + 2]) * p;
        }
        writeNodes();
        writeOpenerEdges();
        etches.setPose(0);
        if (++morphPickFrames >= PICK_REFRESH_EVERY) {
          morphPickFrames = 0;
          nodes.refreshPickBounds();
        }
        if (landed) finishOpener(); // writes the exact settled frame + resolves
        requestRender();
        return true;
      }
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
        originPose = dest; // settled ⇒ origin === target
        morphPickFrames = 0;
        nodes.refreshPickBounds();
        settleCamera(dest, true);
        resolvePending();
      } else if (++morphPickFrames >= PICK_REFRESH_EVERY) {
        // Keep the pick proxy's bounding sphere tracking the traveling nodes so a
        // node that has moved far from its start never falls into a pick dead-zone
        // mid-morph. Throttled (see PICK_REFRESH_EVERY) — the refresh is cheap but
        // pointless to run every single frame of a ~1.7s morph.
        morphPickFrames = 0;
        nodes.refreshPickBounds();
      }

      requestRender();
      return true;
    },
  };
}
