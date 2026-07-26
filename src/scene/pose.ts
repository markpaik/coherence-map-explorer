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
  OPENER,
  radialScatterPositions,
  convergeDurations,
  easeImplode,
  nodeSettleMs,
  edgeAppearMs,
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
   * Play the first-visit reverse-explosion opener: seed a deterministic far
   * RADIAL scatter (from the clock `seed`, mulberry32), float, implode every node
   * to pose 0 on one accelerating curve (simultaneous arrival), then bloom the
   * ribbons in centroid-outward. Resolves when it settles onto the ordinary
   * settled-pose-0 state (naturally OR via snapOpener). Under reduced motion it is
   * a no-op (the driver is already settled at pose 0). main.ts only calls this on
   * a normal load (skipped for deep links / ?og / reduced motion).
   */
  startOpener(seed: number): Promise<void>;
  /** True while the opener is playing (main.ts holds the camera static then). */
  readonly opening: boolean;
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
  // The first-visit reverse-explosion runs BEFORE any pose morph and shares the
  // morph's live geometry buffers (curPos / the edge attribute arrays). It hangs
  // each node at a far RADIAL `scatter` position, floats, implodes all of them to
  // the live pose-0 home on one shared eased curve (simultaneous arrival), then
  // blooms the ribbons in centroid-outward. On settle it lands exactly on
  // nodePoses[0], leaving a clean settled-pose-0 state identical to jumpTo(0).
  const scatter = new Float32Array(n * 3);
  const wanderAmp = new Float32Array(n); // per-node drift amplitude
  const convergeDur = new Float32Array(n); // per-node accretion duration (ms)
  const centroid: [number, number, number] = [0, 0, 0];
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

  // Land the opener on the exact settled pose-0 state (same end state jumpTo(0)
  // produces) and resolve the startOpener promise. Called on natural completion
  // and by snapOpener. Deactivates the opener clock (setOpenerClock(-1) ⇒ every
  // ribbon fully present, byte-identical) and leaves the camera on the home
  // framing it has held throughout.
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
    // INVARIANT: every transition that sets morphing = false resolves whatever
    // setPose() left pending. A setPose awaited DURING the boot opener parked a
    // promise here that nothing ever settled — the formation toggle stays
    // disabled forever waiting on it.
    resolvePending();
    edges.setOpenerClock(-1);
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
    resolvePending(); // same invariant: morphing=false settles any pending await
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
      // Centroid = mean of the (evolved) pose-0 homes: the point every node
      // retreats from and implodes back toward. nodePoses[0] carries the small
      // evolve offset; the reverse-explosion converges to that live target.
      const home = nodePoses[0];
      let cx = 0,
        cy = 0,
        cz = 0;
      for (let i = 0; i < n; i++) {
        cx += home[i * 3];
        cy += home[i * 3 + 1];
        cz += home[i * 3 + 2];
      }
      centroid[0] = cx / n;
      centroid[1] = cy / n;
      centroid[2] = cz / n;
      // Far radial scatter (each node out along its own ray) + per-node wander
      // amplitude (a fraction of how far out it sits) + per-node accretion
      // duration (5–12s-scaled), so every star drifts home at its own rate.
      scatter.set(radialScatterPositions(home, centroid, seed));
      convergeDur.set(convergeDurations(n, seed));
      for (let i = 0; i < n; i++) {
        const dx = scatter[i * 3] - centroid[0];
        const dy = scatter[i * 3 + 1] - centroid[1];
        const dz = scatter[i * 3 + 2] - centroid[2];
        wanderAmp[i] = Math.hypot(dx, dy, dz) * OPENER.WANDER_FRAC;
      }
      // Per-edge appear-times: each ribbon may begin its ghost-in EDGE_DELAY_MS
      // after its LATER endpoint node settles (never before both have landed).
      // Baked once into the edge attribute; the shader evaluates the reveal from
      // the opener clock, so there are no per-frame CPU writes for the ribbons.
      const appear = new Float32Array(m);
      for (let j = 0; j < m; j++) {
        const s = eS[j];
        const t = eT[j];
        const settleS = s >= 0 ? nodeSettleMs(convergeDur[s]) : OPENER.FLOAT_MS;
        const settleT = t >= 0 ? nodeSettleMs(convergeDur[t]) : OPENER.FLOAT_MS;
        appear[j] = edgeAppearMs(settleS, settleT);
      }
      edges.setOpenerAppearTimes(appear, OPENER.EDGE_FADE_MS);

      curPos.set(scatter);
      startPos.set(scatter);
      curCtrl.set(edgeCtrls[0]);
      startCtrl.set(curCtrl);
      nodeProg.fill(0);
      poseValue = 0;
      fromPose = 0;
      targetPose = 0;
      originPose = 0;
      morphing = false; // invariant held by the resolvePending() at the top
      opening = true;
      openerElapsed = 0;
      openerTotal = openerDurationMs();
      morphPickFrames = 0;
      // Reset to the Constellation (pose 0) home framing instantly — matters for
      // a REPLAY invoked from another pose (the camera holds this throughout the
      // opener; drift is suspended while opening). At boot this is a redundant
      // reframe. No focus is active during the opener, so settleCamera just frames
      // home.
      settleCamera(0, false);
      // Paint the far scattered field with every ribbon still absent (clock 0 <
      // every appear-time) before the first frame, so the opener never flashes the
      // settled map.
      edges.setOpenerClock(0);
      writeAll();
      nodes.refreshPickBounds();
      requestRender();
      return new Promise<void>((res) => {
        openerResolve = res;
      });
    },

    snapOpener() {
      finishOpener();
    },

    get opening() {
      return opening;
    },

    tick(dt) {
      if (opening) {
        openerElapsed += dt * 1000;
        if (openerElapsed >= openerTotal) {
          finishOpener(); // writes the exact settled frame + resolves
          requestRender();
          return true;
        }
        // FLOAT + ACCRETION — every star eases home over its OWN duration (so the
        // field accretes, no simultaneous arrival), with a soft per-node wander
        // that fades as it lands (× 1 − progress) for a dreamy approach. During the
        // float (tau ≤ 0) progress is 0 and the wander is full; after a node's own
        // duration its progress clamps to 1 (it rests at home). The ribbons follow
        // the nodes but crystallize per-edge IN-SHADER off the opener clock — each
        // ghosts in only after BOTH its endpoints have settled.
        const home = nodePoses[0];
        const tau = openerElapsed - OPENER.FLOAT_MS; // < 0 during the float
        const w = 2 * Math.PI * OPENER.WANDER_HZ * (openerElapsed / 1000);
        for (let i = 0; i < n; i++) {
          const p = tau <= 0 ? 0 : easeImplode(tau / convergeDur[i]);
          const bx = scatter[i * 3] + (home[i * 3] - scatter[i * 3]) * p;
          const by = scatter[i * 3 + 1] + (home[i * 3 + 1] - scatter[i * 3 + 1]) * p;
          const bz = scatter[i * 3 + 2] + (home[i * 3 + 2] - scatter[i * 3 + 2]) * p;
          const a = wanderAmp[i] * (1 - p);
          const ph = i * 2.399963;
          curPos[i * 3] = bx + a * Math.sin(w + ph);
          curPos[i * 3 + 1] = by + a * Math.sin(w * 1.1 + ph * 1.3);
          curPos[i * 3 + 2] = bz + a * Math.sin(w * 0.9 + ph * 0.7);
        }
        writeAll();
        edges.setOpenerClock(openerElapsed);
        if (++morphPickFrames >= PICK_REFRESH_EVERY) {
          morphPickFrames = 0;
          nodes.refreshPickBounds();
        }
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
