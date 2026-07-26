// Story player — drives a story over the constellation, one scene at a time.
//
// A story is a time-lapsed argument (docs/STORIES.md). The visual grammar is
// DARK-BASELINE: while a story runs, every node and edge defaults to the same
// ghost state the filters use (dark speck, 0.06-alpha filament). Each scene
// declares an explicit `lit` set — those nodes turn on (story-lift bright,
// edges glowing and flowing) — and an optional directional `reveal` sweeps the
// turn-on across grade columns left-to-right or right-to-left instead of all
// at once. Damage then darkens WITHIN the lit set: a fully-missed standard is
// a near-black body holding its place, a partly-hit one visibly dims. Off,
// dim, and on are the whole vocabulary.
//
// The player is the only thing that:
//   - puts the machine into the "storying" state (drift suspended, scene input
//     blocked by a backdrop, exactly the tour's pattern);
//   - resolves selectors → lit masks + the damage engine → nodes/edges;
//   - drives the pose morphs and the camera;
//   - eases the damage crossfade of a "lapse" transition.
// It NEVER writes emphasis directly (the machine stays the single writer — the
// player asks for a *silent* focus that lights the closure without opening the
// panel or touching the hash) and it restores every borrowed surface on exit.

import type { Box3 } from "three";
import type { GraphCore } from "../data";
import type { Machine } from "../state/machine";
import { MIN_FIT_EXTENT, nodeBoundingBox } from "../state/machine";
import { EMPHASIS } from "../scene/palette";
import type { Pose, PoseDriver } from "../scene/pose";
import type { NodesHandle } from "../scene/nodes";
import type { EdgesHandle } from "../scene/edges";
import type { BeaconsHandle } from "../scene/beacons";
import type { CameraRig } from "../scene/camera";
import type { FiltersHandle } from "../ui/filters";
import type { PanelHandle } from "../ui/panel";
import type { SearchHandle } from "../ui/search";
import type { DamageEngine } from "./damage";
import type { SelectorResolver } from "./selectors";
import { expandFamilies, bfsHops, contagionTargets, type BeaconTarget } from "./contagion";
import { storyHref } from "../state/routing";
import {
  STORIES,
  findStory,
  scenePose,
  sceneBody,
  sceneTitle,
  type Story,
  type StoryScene,
  type Formation,
} from "./scripts";
import { createStoryCard, type StoryCardHandle } from "../ui/storycard";
import { createFormationPick, type FormationPickHandle } from "./formationpick";

const LAPSE_MS = 2000; // "lapse" transition length (damage crossfade)
const RING_FLOOR = 0.1; // a node rings only once its damage clears this floor
const DEFAULT_HOLD_MS = 10500; // auto-advance dwell when a scene omits holdMs
const LIT_FADE_MS = 1200; // lit-set crossfade when a scene has no directional reveal
const DEFAULT_REVEAL_MS = 3200; // directional reveal duration when unspecified
const REVEAL_WINDOW = 0.35; // fraction of the reveal each node's own fade takes
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/**
 * Every surface a story BORROWS, as the one clearing call each needs. The list
 * is the contract: entry and exit run exactly this, so a surface can never be
 * cleared on the way out and forgotten on the way in (or the reverse). Pure
 * indirection, unit-tested in tests/story-reset.test.ts without a GPU or a DOM.
 */
export interface StorySurfaces {
  clearNodeDamage(): void;
  clearNodeStoryLift(): void;
  clearNodeMask(): void;
  clearEdgeDamage(): void;
  clearEdgeStory(): void;
  clearEdgeMask(): void;
  clearBeacons(): void;
  clearCardExtra(): void;
  clearFocalOffset(): void;
  recomputeFilters(): void;
  clearFocus(): void;
  resetEmphasis(): void;
  hidePanel(): void;
  dismissSearch(): void;
}

/** The clearing calls, in the order the reset runs them. */
export const STORY_SURFACE_KEYS = [
  "clearNodeDamage",
  "clearNodeStoryLift",
  "clearNodeMask",
  "clearEdgeDamage",
  "clearEdgeStory",
  "clearEdgeMask",
  "clearBeacons",
  "clearCardExtra",
  "clearFocalOffset",
  "recomputeFilters",
  "clearFocus",
  "resetEmphasis",
  "hidePanel",
  "dismissSearch",
] as const satisfies readonly (keyof StorySurfaces)[];

/**
 * Return every borrowed surface to its resting state. Called on story ENTRY (so
 * playback always begins from a clean dark baseline no matter what preceded it:
 * an open panel, a mid-cascade focus, a hovered node, an open search dropdown)
 * and again on story EXIT. Pure over the handle.
 */
export function resetStorySurfaces(surfaces: StorySurfaces): void {
  for (const key of STORY_SURFACE_KEYS) surfaces[key]();
}

export interface StoryPlayerDeps {
  graph: GraphCore;
  machine: Machine;
  poseDriver: PoseDriver;
  damage: DamageEngine;
  resolve: SelectorResolver;
  nodes: NodesHandle;
  edges: EdgesHandle;
  beacons: BeaconsHandle;
  filters: FiltersHandle;
  rig: CameraRig;
  /** The detail panel — hidden defensively on entry and exit (never opened). */
  panel: PanelHandle;
  /** The search launcher — its dropdown is closed defensively on entry/exit. */
  search: SearchHandle;
  requestRender: () => void;
  announce: (msg: string) => void;
  reducedMotion: () => boolean;
}

export interface StoryPlayerHandle {
  /** Start a story by id (deepLink=true came in via #/story/<id>). */
  start(storyId: string, opts?: { deepLink?: boolean }): void;
  /** Exit cleanly to idle, restoring every borrowed surface. */
  stop(): void;
  next(): void;
  back(): void;
  jump(index: number): void;
  /** Toggle auto-advance pause/resume (scrubber control + keyboard). */
  togglePause(): void;
  /** Ease the lapse crossfade + drive settle/auto-advance; true while active. */
  tick(dt: number): boolean;
  /**
   * True while a scene is HOLDING — its transition has settled and it is waiting
   * on the auto-advance countdown or a manual Next. main.ts lets the idle drift
   * breathe during a hold (but not mid-transition). Paused holds still count as
   * holding.
   */
  isHolding(): boolean;
  readonly running: boolean;
  readonly sceneIndex: number;
  dispose(): void;
}

export function createStoryPlayer(deps: StoryPlayerDeps): StoryPlayerHandle {
  const { graph, machine, poseDriver, damage, resolve, nodes, edges, beacons, filters, rig } = deps;
  const { panel, search, requestRender, announce, reducedMotion } = deps;

  const N = graph.nodes.length;
  const M = graph.edges.length;

  // Edge endpoint indices (for propagating the node lit mask onto edges).
  const indexById = new Map<string, number>();
  graph.nodes.forEach((n, i) => indexById.set(n.id, i));
  const edgeS = new Int32Array(M);
  const edgeT = new Int32Array(M);
  graph.edges.forEach((e, j) => {
    edgeS[j] = indexById.get(e.s) ?? -1;
    edgeT[j] = indexById.get(e.t) ?? -1;
  });

  // Prereq-successor adjacency (kind 0, s → t meaning s is a prerequisite of t):
  // the leads-to direction the contagion wave spreads along. The BFS over this
  // never touches predecessors, so ancestors of the missed set stay unranked —
  // the same forward-only guarantee the damage engine gives.
  const succ: number[][] = Array.from({ length: N }, () => []);
  for (const e of graph.edges) {
    if (e.k !== 0) continue;
    const s = indexById.get(e.s);
    const t = indexById.get(e.t);
    if (s !== undefined && t !== undefined) succ[s].push(t);
  }
  // Sub-standard indices per node (for the family expansion of a missed parent):
  // the coherence map draws a family as one card, and the prereq DAG holds no
  // parent↔child edge, so a missed parent must pull its sub-standards in itself.
  const childIdx: number[][] = graph.nodes.map((node) =>
    (node.children ?? [])
      .map((id) => indexById.get(id))
      .filter((i): i is number => i !== undefined),
  );
  const childrenOf = (i: number): number[] => childIdx[i];

  // --- backdrop (blocks scene + chrome input, like the tour) --------------
  const backdrop = document.createElement("div");
  backdrop.className = "story-backdrop";
  backdrop.hidden = true;
  backdrop.addEventListener("pointerdown", (e) => e.preventDefault());
  document.body.appendChild(backdrop);

  const card: StoryCardHandle = createStoryCard({
    announce,
    onNext: () => next(),
    onBack: () => back(),
    onExit: () => stop(),
    onJump: (i) => jump(i),
    onTogglePause: () => togglePause(),
  });

  // Formation pin (story-HUD control). Changing it re-plays the CURRENT scene in
  // the new formation — goto() resolves the pose through scenePose() every time,
  // so one re-goto sets the pose, refits the camera, and swaps in heldBody copy.
  // The pin holds for subsequent scenes (module state inside formationpick).
  const formation: FormationPickHandle = createFormationPick({
    onChange: () => {
      if (running && currentStory) void goto(currentIndex, !reducedMotion());
    },
  });

  // Render a scene's card with the title and body that match the pose it is
  // ACTUALLY playing in: a pinned formation differing from the authored pose
  // swaps in heldTitle/heldBody when the scene provides them (sceneTitle /
  // sceneBody), else the authored copy stands. Clones only when the copy
  // actually changes (keeps lose-a-year's live-rewritten copy intact).
  function renderScene(scene: StoryScene, index: number, activePose: Formation): void {
    const title = sceneTitle(scene, activePose);
    const body = sceneBody(scene, activePose);
    const view =
      title === scene.card.title && body === scene.card.body
        ? scene
        : { ...scene, card: { ...scene.card, title, body } };
    card.render(view, index, currentStory!.scenes.length);
  }

  // Auto-advance is TIMING, not motion: it stays on under reduced motion (the
  // scene transitions become cuts, which is the accessible part). Pause is the
  // control for stopping the clock.
  const autoAdvanceOn = (): boolean => true;

  // --- state --------------------------------------------------------------
  let running = false;
  let currentStory: Story | null = null;
  let currentIndex = 0;
  let priorPose: Pose = 0; // widened to the driver's Pose when Transit (3) landed
  let deepLink = false;
  // Pre-story routing snapshot (finding: a story must not orphan the standard
  // deep link the reader left in the URL). If a standard was focused when the
  // story began, its code is captured here and re-focused on exit — panel, hash,
  // and emphasis restored together, symmetric with entry. Null = entered idle.
  let preStoryFocusCode: string | null = null;
  let navToken = 0;

  // Grade rank per node (K=0 … HS=9) for directional reveals: a left-to-right
  // reveal lights the lit set one grade column at a time.
  const gradeRank = new Map<string, number>();
  graph.grades.forEach((g, i) => gradeRank.set(g.id, i));
  const rankOf = (i: number): number => gradeRank.get(graph.nodes[i].grade) ?? 0;

  // --- auto-advance / hold state -----------------------------------------
  // A scene runs through a TRANSITION (pose morph + lapse crossfade + camera
  // flight) and then a HOLD (settled, counting down holdMs to auto-advance).
  let transitioning = false; // true from goto() start until the scene settles
  let settleArmed = false; // becomes true once goto() has applied the scene
  let settleRemaining = 0; // ms left of the settle window (the lapse length)
  let holdTotal = 0; // ms of this scene's dwell
  let holdRemaining = 0; // ms left before auto-advance
  let paused = false; // user paused auto-advance (persists across scenes)

  // Damage crossfade buffers. Typed as the general Float32Array so the damage
  // engine's return (Float32Array<ArrayBufferLike>) assigns cleanly.
  const damageCur = new Float32Array(N);
  let damageFrom: Float32Array = new Float32Array(N);
  let damageTo: Float32Array = new Float32Array(N);
  let easing = false;
  let easeElapsed = 0;
  // Staggered damage crossfade (the healing codas): per-node start offsets so
  // holes relight one by one instead of all at once. All zeros = simultaneous.
  const damageDelay = new Float32Array(N);
  let damageDuration = LAPSE_MS;

  // Deterministic per-node scatter order, hashed from the node id — "teachers
  // everywhere at once", not a sweep.
  const scatterOrder = new Float32Array(N);
  {
    for (let i = 0; i < N; i++) {
      const id = graph.nodes[i].id;
      let h = 0;
      for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) >>> 0;
      scatterOrder[i] = (h % 997) / 997;
    }
  }

  // Lit-set buffers (the dark-baseline grammar). litCur is each node's current
  // on-amount (0 = ghost, 1 = lit); a scene change animates litCur toward
  // litTo, optionally staggered by grade column (the directional reveal).
  // Edge visibility is derived per frame: min of the two endpoint amounts.
  const litCur = new Float32Array(N).fill(1); // pre-story the map is fully lit
  const litFrom = new Float32Array(N);
  const litTo = new Float32Array(N);
  const litDelay = new Float32Array(N); // normalized reveal start per node, 0..1
  const edgeLit = new Float32Array(M);
  let litAnimating = false;
  let litElapsed = 0;
  let litDuration = LIT_FADE_MS;

  function pushLit(): void {
    nodes.setVisibleMask(litCur);
    for (let j = 0; j < M; j++) {
      const s = edgeS[j];
      const t = edgeT[j];
      edgeLit[j] = s >= 0 && t >= 0 ? Math.min(litCur[s], litCur[t]) : 0;
    }
    edges.setVisibleMask(edgeLit);
  }

  function pushDamage(): void {
    nodes.setDamage(damageCur);
    edges.setDamage(damage.edgeDamage(damageCur));
  }

  function resolveUnion(selectors: string[]): Set<number> {
    const out = new Set<number>();
    for (const sel of selectors) for (const i of resolve(sel)) out.add(i);
    return out;
  }
  function idsFromIndices(indices: Iterable<number>): Set<string> {
    const out = new Set<string>();
    for (const i of indices) out.add(graph.nodes[i].id);
    return out;
  }

  // --- per-scene appliers -------------------------------------------------
  function applyFocus(scene: StoryScene, cut: boolean): void {
    const code = scene.state?.focus;
    // Stories expect the FULL closure lit (the two-stage ladder's stage 1 would
    // only light one hop). A silent journey lights the whole closure without
    // opening the panel, the chip, or touching the hash — visually identical to
    // the pre-ladder silent focus.
    if (code) machine.focusByCode(code, { silent: true, instant: cut, stage: "journey" });
    else machine.clearFocus({ silent: true });
  }

  // The settled damage for a scene, given its FAMILY-EXPANDED missed index set
  // (a missed parent pulls its sub-standards in; see goto). damage:true runs the
  // engine (downstream exposure); damage:false shows the missed set as husks with
  // no downstream. The engine's compute() semantics are untouched — expansion
  // happens on the missed set before it arrives here.
  function damageTargetFor(scene: StoryScene, missedIdx: Set<number>): Float32Array {
    if (missedIdx.size === 0) return new Float32Array(N);
    if (scene.state?.damage) {
      return damage.compute(idsFromIndices(missedIdx));
    }
    // damage:false → the missed standards show as husks, no downstream exposure.
    const husks = new Float32Array(N);
    for (const i of missedIdx) husks[i] = 1;
    return husks;
  }

  // Returns the crossfade duration so goto() can size the settle window.
  function applyDamage(scene: StoryScene, target: Float32Array, ease: boolean): number {
    damageTo = target;
    if (!ease) {
      damageCur.set(target);
      easing = false;
      pushDamage();
      return 0;
    }
    damageFrom = new Float32Array(damageCur);
    const heal = scene.heal;
    if (heal) {
      setDamageDelays(heal.order);
      damageDuration = heal.ms ?? 4200;
    } else {
      damageDelay.fill(0);
      damageDuration = LAPSE_MS;
    }
    easeElapsed = 0;
    easing = true;
    return damageDuration;
  }

  // Normalize per-node stagger delays over the CHANGING nodes (0..1); unchanged
  // nodes get no window and simply hold their value.
  function setDamageDelays(order: "scatter" | "ltr"): void {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < N; i++) {
      if (damageFrom[i] === damageTo[i]) {
        damageDelay[i] = 0;
        continue;
      }
      const r = order === "ltr" ? rankOf(i) : scatterOrder[i];
      damageDelay[i] = r;
      if (r < lo) lo = r;
      if (r > hi) hi = r;
    }
    const span = hi > lo ? hi - lo : 1;
    for (let i = 0; i < N; i++) {
      if (damageFrom[i] !== damageTo[i]) damageDelay[i] = (damageDelay[i] - lo) / span;
    }
  }

  // The contagion: ring every damaged node (intensity = its damage, so the
  // directly-missed set keeps today's full ring and downstream nodes fade), and
  // stage the rings in hop order from the missed set over the leads-to direction
  // so the spread reads as a wave. A scene's `spotlight` codes ring at full
  // strength on the first hop (the healed holes the reader still needs to find).
  // `cut` (reduced motion, or a scene cut) shows the whole set instantly — the
  // motion is cut, never the information.
  function armBeacons(scene: StoryScene, missedIdx: Set<number>, damageArr: Float32Array, cut: boolean): void {
    const hops = bfsHops(missedIdx, succ, N);
    const byIndex = new Map<number, BeaconTarget>();
    for (const t of contagionTargets(damageArr, hops, RING_FLOOR)) byIndex.set(t.index, t);
    if (scene.spotlight) {
      for (const i of resolveUnion(scene.spotlight)) byIndex.set(i, { index: i, intensity: 1, hop: 0 });
    }
    const targets = [...byIndex.values()];
    beacons.setTargets(targets.length ? targets : null, { instant: cut });
  }

  // --- "Lose a year" (the interactive story) ------------------------------
  // The player owns the behavior: a grade-chip row mounts into the card, and
  // choosing a grade recomputes structural damage live, crossfading node by
  // node (scatter) like a time-lapse. Copy on the card restates the numbers
  // for the chosen year, computed from the same engine the stories use.
  let loseYearSel: string | null = null;
  const LOSE_YEAR_MS = 2200;

  function armYearDamage(g: string, ease: boolean): number {
    const missedIdx = expandFamilies(resolve(`grade:${g}`), childrenOf);
    const target = damage.compute(idsFromIndices(missedIdx));
    // Ring intensities read the TRUE engine damage, captured before the
    // near-binary display floor below rewrites the node-dimming values.
    const ringDamage = new Float32Array(target);
    const gRank = gradeRank.get(g) ?? 0;
    let missedCount = 0;
    let ahead = 0;
    let touched = 0;
    for (let i = 0; i < N; i++) {
      if (graph.nodes[i].grade === g) {
        missedCount++;
        continue;
      }
      if (rankOf(i) > gRank) {
        ahead++;
        if (target[i] > 0.0001) touched++;
      }
    }
    const clear = ahead - touched;
    // Display floor (visual only — the counts above use the raw engine values):
    // the explorer's read is meant to be near-binary. Any standard that stands
    // on ANYTHING missing must be unmistakably dimmer than one that does not
    // (Mark, round 7: dim the dependents, keep only the independent ones
    // bright). The graded engine still deepens the dimming with exposure.
    for (let i = 0; i < N; i++) {
      if (target[i] > 0.0001 && target[i] < 0.35) target[i] = 0.35;
    }
    // Contagion rings: the hollowed year and everything downstream of it, faint
    // with exposure, staged as a wave from the missed grade along the leads-to
    // direction. `delta` keeps rings that survive a year switch from re-popping,
    // so a newly chosen year sends a fresh wave only through the standards it
    // newly touches (the "subsequent dimmings" Mark asked for). Reduced motion
    // shows the full set instantly.
    const yearHops = bfsHops(missedIdx, succ, N);
    const yearRings = contagionTargets(ringDamage, yearHops, RING_FLOOR);
    beacons.setTargets(yearRings.length ? yearRings : null, { instant: !ease, delta: true });
    const yearName = g === "K" ? "kindergarten" : `grade ${g}`;
    const sc = currentStory!.scenes[0];
    sc.card.title = `Losing ${yearName}`;
    sc.card.body =
      `${missedCount} standards go dark. Of the ${ahead} standards ahead, ` +
      `${touched} now stand on something missing; ${clear} stay bright. ` +
      `Switch years to compare how far each loss reaches. The map shows what ` +
      `the work stands on, never what a child can or cannot do.`;
    card.render(sc, 0, 1);

    damageTo = target;
    if (!ease) {
      damageCur.set(target);
      easing = false;
      pushDamage();
      return 0;
    }
    damageFrom = new Float32Array(damageCur);
    setDamageDelays("scatter");
    damageDuration = LOSE_YEAR_MS;
    easeElapsed = 0;
    easing = true;
    requestRender();
    return LOSE_YEAR_MS;
  }

  function mountLoseAYear(): void {
    const wrap = document.createElement("div");
    wrap.className = "lose-year";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Choose the missing grade");
    const chips = new Map<string, HTMLButtonElement>();
    const select = (g: string): void => {
      loseYearSel = g;
      for (const [k, b] of chips) b.setAttribute("aria-pressed", String(k === g));
      armYearDamage(g, true);
    };
    for (const g of ["K", "1", "2", "3", "4", "5", "6", "7", "8"]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lose-year-chip";
      b.textContent = g;
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => select(g));
      chips.set(g, b);
      wrap.appendChild(b);
    }
    loseYearSel = "3"; // the pandemic story's anchor year, preselected
    chips.get("3")!.setAttribute("aria-pressed", "true");
    card.setExtra(wrap);
  }

  // Arm the lit-set transition for a scene. Everything outside scene.state.lit
  // heads to ghost; everything inside heads to 1. A `reveal` staggers the
  // CHANGING nodes by grade column ("ltr" lights early grades first, "rtl"
  // lights late grades first) so the turn-on sweeps across the map instead of
  // landing all at once. Returns the transition's duration in ms.
  function armLit(scene: StoryScene, cut: boolean): number {
    const litSel = scene.state?.lit;
    litTo.fill(0);
    if (litSel && litSel.length) {
      for (const i of resolveUnion(litSel)) litTo[i] = 1;
    }
    if (cut) {
      litCur.set(litTo);
      litAnimating = false;
      pushLit();
      return 0;
    }
    litFrom.set(litCur);
    const reveal = scene.reveal;
    if (reveal) {
      // Normalize grade ranks of the CHANGING nodes to 0..1 reveal delays.
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < N; i++) {
        if (litFrom[i] !== litTo[i]) {
          const r = rankOf(i);
          if (r < lo) lo = r;
          if (r > hi) hi = r;
        }
      }
      const span = hi > lo ? hi - lo : 1;
      for (let i = 0; i < N; i++) {
        const r = (rankOf(i) - lo) / span;
        litDelay[i] = reveal.dir === "rtl" ? 1 - r : r;
      }
      litDuration = reveal.ms ?? DEFAULT_REVEAL_MS;
    } else {
      litDelay.fill(0);
      litDuration = LIT_FADE_MS;
    }
    litElapsed = 0;
    litAnimating = true;
    return litDuration;
  }

  // Above this many nodes a fit is sized by its strays rather than its mass, so
  // the box trims its outliers (see nodeBoundingBox). At or below it — a spine of
  // four named standards, a handful of codes — every node is the subject and
  // dropping one would cut an end off the line the card narrates.
  const TRIM_ABOVE = 8;
  const FIT_TRIM = 0.1;
  /** Outlier trim on the CONTEXT box (lighter than the fit's: a context is
   *  allowed to be big, it just must not be defined by two strays). */
  const CONTEXT_TRIM = 0.05;
  function storyFitBox(indices: number[], trim: number): Box3 {
    return nodeBoundingBox(nodes, indices, trim, MIN_FIT_EXTENT);
  }
  /**
   * A `fit` selector is a MASS (a grade band, a closure): size it by the mass and
   * let its strays bleed. A SPINE is named content — the standards the card
   * talks about — so it is never trimmed: dropping one would leave a standard
   * the reader is being told about hanging off the edge of the frame.
   */
  const fitTrim = (indices: number[]): number => (indices.length > TRIM_ABOVE ? FIT_TRIM : 0);
  /**
   * How far a scene's fit may retreat from its SPINE to take the lit context in
   * with it. The spine is what the card narrates and must read; the lit wash
   * around it is the drama and is allowed to bleed. Within this factor the whole
   * lit set lands in frame; past it the spine stays hero.
   */
  const STORY_CONTEXT_PULLBACK = 2.6;
  /** The scene's LIT set as a composition context box (outliers trimmed). */
  function litContextBox(scene: StoryScene): Box3 | null {
    const lit = scene.state?.lit;
    if (!lit || !lit.length) return null;
    const idx = [...resolveUnion(lit)];
    if (!idx.length) return null;
    return nodeBoundingBox(nodes, idx, idx.length > TRIM_ABOVE ? CONTEXT_TRIM : 0, MIN_FIT_EXTENT);
  }

  // The camera frames the SPINE when a scene names one (what the card actually
  // narrates), otherwise its `fit`. The scene's LIT set rides along as the
  // composition context, so the frame centres the mass the reader can see
  // instead of a spine with its own lit context hanging off the bottom of the
  // screen. Everything outside the frame still lights — the bleed is the drama.
  function applyCamera(scene: StoryScene, animate: boolean): void {
    const cam = scene.camera;
    if (!cam) {
      rig.frameHome(animate);
      return;
    }
    const context = litContextBox(scene);
    const frame = (indices: number[], trim: number): void => {
      void rig.frameSubject(storyFitBox(indices, trim), {
        transition: animate,
        context,
        contextPullback: STORY_CONTEXT_PULLBACK,
      });
    };
    if (cam.spine && cam.spine.length) {
      const spine = resolveUnion(cam.spine);
      if (spine.size) {
        frame([...spine], 0); // the spine is named content: every node of it frames
        return;
      }
    }
    if (cam.fit === "all") {
      rig.frameHome(animate);
      return;
    }
    const idx = resolveUnion(cam.fit);
    if (idx.size === 0) {
      rig.frameHome(animate);
      return;
    }
    frame([...idx], fitTrim([...idx]));
  }

  async function goto(index: number, animate: boolean): Promise<void> {
    if (!currentStory) return;
    const token = ++navToken;
    currentIndex = index;
    const scene = currentStory.scenes[index];
    const cut = !animate || reducedMotion();

    // A fresh scene is transitioning until it settles; disarm the settle timer
    // and the hold countdown so a mid-flight tick can't advance early. Any
    // manual action (Next/Back/dot) routes through here, which resets the dwell.
    transitioning = true;
    settleArmed = false;
    settleRemaining = 0;
    holdRemaining = 0;
    card.setProgress(0);

    // Pose first: the scene's AUTHORED pose, unless the reader pinned a formation
    // (scenePose resolves the pin). The first scene of a story triggers the
    // unravel; a same-pose scene resolves instantly. Node positions below (camera
    // fits, beacons) are read AFTER this await, so they frame the live pose.
    const activePose = scenePose(scene, formation.getPinned());
    await poseDriver.setPose(activePose, { instant: reducedMotion() });
    if (token !== navToken || !running) return; // superseded or stopped mid-morph

    applyFocus(scene, cut); // emphasis (silent) — camera below overrides framing
    // Family-expanded missed set: a missed parent standard drags its
    // sub-standards in (one card in the original map), and this expanded set
    // drives BOTH the damage engine and the contagion rings. Grade selectors
    // already include their sub-standards, so it is a no-op for them.
    const missedIdx = expandFamilies(resolveUnion(scene.state?.missed ?? []), childrenOf);
    // Interactive story: the chosen year drives damage, not the scene state.
    const damageMs =
      currentStory.interactive === "lose-a-year"
        ? armYearDamage(loseYearSel ?? "3", !cut)
        : applyDamage(scene, damageTargetFor(scene, missedIdx), !cut);
    // Contagion: rings spread from the missed set out along the leads-to
    // direction, faint with distance, staged as a wave. The interactive story
    // arms its own beacons inside armYearDamage.
    if (currentStory.interactive !== "lose-a-year") {
      armBeacons(scene, missedIdx, damageTo, cut);
    }
    const revealMs = armLit(scene, cut);
    applyCamera(scene, !cut);
    renderScene(scene, index, activePose);

    // Arm the settle window: the scene holds only after the damage crossfade
    // (which a healing coda stretches) AND the lit reveal have finished.
    holdTotal = scene.holdMs ?? DEFAULT_HOLD_MS;
    settleRemaining = cut ? 0 : Math.max(damageMs, revealMs);
    settleArmed = true;
    requestRender();
  }

  // (The story card no longer needs a framing lever of its own: the camera rig
  // measures it as live chrome — a modest rightward bias on desktop, part of the
  // bottom band when it goes full-width on a phone. See scene/frame.ts.)

  // --- lifecycle ----------------------------------------------------------
  // The borrowed-surface contract (see resetStorySurfaces): ONE list, run on
  // entry and on exit, so nothing can be restored in one direction only.
  const surfaces: StorySurfaces = {
    clearNodeDamage: () => {
      damageCur.fill(0);
      nodes.setDamage(null);
    },
    clearNodeStoryLift: () => nodes.setStoryLift(1),
    clearNodeMask: () => nodes.setVisibleMask(null),
    clearEdgeDamage: () => edges.setDamage(null),
    clearEdgeStory: () => edges.setStory(0),
    clearEdgeMask: () => edges.setVisibleMask(null),
    clearBeacons: () => beacons.setTargets(null),
    clearCardExtra: () => {
      card.setExtra(null);
      loseYearSel = null;
    },
    clearFocalOffset: () => rig.clearFocalOffset(false),
    recomputeFilters: () => filters.recompute(), // reclaim the visibility buffers
    // A no-op internally when nothing is focused, which is exactly why the two
    // lines below exist: an emphasis or a panel left open by anything OTHER than
    // a live machine focus would otherwise survive into the story.
    clearFocus: () => machine.clearFocus({ silent: true }),
    resetEmphasis: () =>
      machine.applyEmphasis({ baseNode: EMPHASIS.REST, baseEdge: EMPHASIS.REST }),
    hidePanel: () => panel.hide(),
    dismissSearch: () => search.dismiss(),
  };

  function start(storyId: string, opts?: { deepLink?: boolean }): void {
    const story = findStory(storyId);
    if (!story) {
      console.warn(`[cme] unknown story: ${storyId}`);
      return;
    }
    // Snapshot the pre-story focus BEFORE anything clears it — but only on a
    // fresh entry (a story→story restart preserves the ORIGINAL pre-story focus,
    // never the outgoing story's silent focus).
    if (!running) {
      preStoryFocusCode =
        machine.focusedIndex !== null ? graph.nodes[machine.focusedIndex].code : null;
    }
    if (running) stopImmediate(); // restart cleanly (no pose return churn)

    running = true;
    currentStory = story;
    currentIndex = 0;
    deepLink = opts?.deepLink === true;
    priorPose = poseDriver.target; // the pose to return to on exit
    paused = false;

    machine.setHover(null); // a stale hover must not linger under the backdrop
    // The storying class goes on FIRST, before the reset below: closing the
    // detail panel returns focus to whatever opened it, and that must not fire
    // while a story is taking over the frame (panel.hide() reads this class to
    // stand down, exactly as it already does for the tour).
    document.body.classList.add("storying");
    // HARD INVARIANT: a story begins from a clean dark baseline no matter what
    // preceded it — an open panel, a half-run cascade, a mid-trace journey, a
    // hovered node, an open search dropdown. Nothing about the entry path is
    // trusted; every borrowed surface is cleared unconditionally, and the exit
    // runs the same list (resetStorySurfaces).
    resetStorySurfaces(surfaces);
    if (panel.isOpen) {
      console.warn("[cme] story entry: panel still open after reset");
      panel.hide();
    }
    machine.setStorying(true);
    // Keep the hash coherent while the story owns the scene: switch to the
    // story's own scheme (deep links already arrive with it) so a mid-story
    // reload/share resurrects the STORY — not the pre-story #/s/<CODE>, which
    // would otherwise be orphaned in the URL and resurrect on reload. The player
    // owns the #/story/ hash (as it already did on deep-link exit); replaceState,
    // so the router never re-routes off it.
    history.replaceState(null, "", storyHref(story.id, location.pathname + location.search));
    // Narrative luminance: LIT nodes rise to chain-level brightness and lit
    // prereq edges glow and FLOW; everything outside the lit set is a dark
    // ghost, and damage darkens within the light. Contrast carries the story.
    nodes.setStoryLift(1.9);
    edges.setStory(1);
    litCur.fill(1); // the map is fully on at entry; scene 0 fades it down
    backdrop.hidden = false;
    card.begin(story);
    formation.reflect(); // the pin persists across stories — show the live state

    card.setAutoAdvanceEnabled(autoAdvanceOn());
    card.setPaused(false);
    if (story.interactive === "lose-a-year") mountLoseAYear();
    // goto() frames the first scene, and the rig measures the card's rectangle
    // as it composes — which is why the card is mounted (and laid out) first.
    void goto(0, !reducedMotion());
  }

  // Reset all graph surfaces without the (awaited) pose return — used when
  // restarting into another story, and shared by stop().
  function stopImmediate(): void {
    running = false;
    navToken++;
    easing = false;
    litAnimating = false;
    transitioning = false;
    settleArmed = false;
    settleRemaining = 0;
    holdRemaining = 0;
    resetStorySurfaces(surfaces); // the same list story ENTRY runs
    card.end();
  }

  async function stop(): Promise<void> {
    if (!running) return;
    const returnPose = priorPose;
    const restoreCode = preStoryFocusCode; // pre-story focus to re-open on exit
    stopImmediate();
    requestRender();

    // Leave the storying state and restore routing SYNCHRONOUSLY — the exit
    // must never be hostage to an animation promise (a hidden tab or an
    // interrupted morph would otherwise strand the app in story mode with the
    // chrome gone). Only the backdrop, a pure visual, waits for the pose
    // return below so the closing unravel still plays against it.
    document.body.classList.remove("storying");
    machine.setStorying(false);
    // Restore the pre-story routing, symmetric with entry. A standard the reader
    // had focused before the story returns — panel, hash, AND emphasis — through
    // the machine (still the single writer of #/s/); REPLACE so it overwrites the
    // story's own hash entry rather than stacking one. With no prior focus (incl.
    // a #/story/ deep link, where preStoryFocusCode is null), the hash clears to
    // the bare base — the old deep-link behavior, now the general case.
    if (restoreCode) {
      machine.focusByCode(restoreCode, { history: "replace" });
    } else {
      history.replaceState(null, "", location.pathname + location.search);
    }
    preStoryFocusCode = null;
    deepLink = false;
    currentStory = null;
    const btn = document.getElementById("story-btn");
    if (btn instanceof HTMLElement) btn.focus();
    requestRender();

    // Return to the pre-story pose; the backdrop drops when the unravel lands.
    await poseDriver.setPose(returnPose, { instant: reducedMotion() });
    if (running) return; // a new story started during the return — leave its backdrop
    backdrop.hidden = true;
    requestRender();
  }

  function next(): void {
    if (!running || !currentStory) return;
    if (currentIndex >= currentStory.scenes.length - 1) {
      void stop();
      return;
    }
    void goto(currentIndex + 1, !reducedMotion());
  }
  function back(): void {
    if (!running || !currentStory || currentIndex <= 0) return;
    void goto(currentIndex - 1, !reducedMotion());
  }
  function jump(index: number): void {
    if (!running || !currentStory) return;
    if (index < 0 || index >= currentStory.scenes.length || index === currentIndex) return;
    void goto(index, !reducedMotion());
  }

  function togglePause(): void {
    if (!running) return;
    paused = !paused;
    card.setPaused(paused);
    requestRender();
  }

  return {
    start,
    stop() {
      void stop();
    },
    next,
    back,
    jump,
    togglePause,
    isHolding() {
      return running && !transitioning;
    },
    tick(dt) {
      if (!running) return false;
      const dtMs = dt * 1000;
      let active = false;

      // 1) Damage crossfade — simultaneous (the lapse) or per-node staggered
      //    (a healing coda: each node fades within its own window, so the
      //    lights come back one by one).
      if (easing) {
        active = true;
        easeElapsed += dtMs;
        const T = easeElapsed / damageDuration;
        for (let i = 0; i < N; i++) {
          const startAt = damageDelay[i] * (1 - REVEAL_WINDOW);
          const k = smoothstep((T - startAt) / REVEAL_WINDOW);
          damageCur[i] = damageFrom[i] + (damageTo[i] - damageFrom[i]) * k;
        }
        pushDamage();
        if (easeElapsed >= damageDuration) {
          damageCur.set(damageTo);
          easing = false;
          pushDamage();
        }
      }

      // 1b) Lit-set transition: each node fades within its own reveal window,
      //     so a directional reveal sweeps the turn-on across grade columns.
      if (litAnimating) {
        active = true;
        litElapsed += dtMs;
        const T = litElapsed / litDuration;
        for (let i = 0; i < N; i++) {
          const from = litFrom[i];
          const to = litTo[i];
          if (from === to) {
            litCur[i] = to;
            continue;
          }
          const startAt = litDelay[i] * (1 - REVEAL_WINDOW);
          const k = smoothstep((T - startAt) / REVEAL_WINDOW);
          litCur[i] = from + (to - from) * k;
        }
        pushLit();
        if (litElapsed >= litDuration) {
          litCur.set(litTo);
          litAnimating = false;
          pushLit();
        }
      }

      // 2) Settle window: once it elapses the scene is holding and the
      //    auto-advance countdown begins.
      if (transitioning && settleArmed) {
        active = true;
        settleRemaining -= dtMs;
        if (settleRemaining <= 0) {
          transitioning = false;
          settleArmed = false;
          holdRemaining = holdTotal;
          card.setProgress(0);
        }
      }

      // 3) Hold countdown → auto-advance (disabled under reduced motion; the
      //    last scene never auto-exits; a paused hold just freezes the fill).
      if (!transitioning && autoAdvanceOn() && currentStory && !paused && holdTotal > 0) {
        const isLast = currentIndex >= currentStory.scenes.length - 1;
        if (!isLast) {
          active = true;
          holdRemaining -= dtMs;
          card.setProgress(clamp01(1 - holdRemaining / holdTotal));
          if (holdRemaining <= 0) void goto(currentIndex + 1, true);
        }
      }

      if (active) requestRender();
      return active;
    },
    get running() {
      return running;
    },
    get sceneIndex() {
      return currentIndex;
    },
    dispose() {
      formation.dispose();
      card.dispose();
      backdrop.remove();
    },
  };
}

// --- story picker ---------------------------------------------------------
// The "Stories" ghost button (#story-btn) opens a glass picker listing the six
// stories (kicker + title + hook). Choosing one closes the picker and starts it.
// Esc / outside-click close; focus is trapped while open and returned to the
// button on close.

export interface StoryPickerHandle {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  dispose(): void;
}

export function createStoryPicker(deps: { player: StoryPlayerHandle }): StoryPickerHandle {
  const { player } = deps;
  const btn = document.getElementById("story-btn");

  const backdrop = document.createElement("div");
  backdrop.className = "story-picker-backdrop";
  backdrop.hidden = true;

  const panel = document.createElement("div");
  panel.className = "story-picker";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Choose a story");
  panel.hidden = true;

  const heading = document.createElement("h2");
  heading.className = "story-picker-h";
  heading.textContent = "Stories";
  panel.appendChild(heading);

  const list = document.createElement("div");
  list.className = "story-picker-list";
  const itemButtons: HTMLButtonElement[] = STORIES.map((story) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "story-picker-item";
    const k = document.createElement("span");
    k.className = "story-picker-kicker";
    k.textContent = story.kicker;
    const t = document.createElement("span");
    t.className = "story-picker-title";
    t.textContent = story.title;
    const h = document.createElement("span");
    h.className = "story-picker-hook";
    h.textContent = story.hook;
    item.append(k, t, h);
    item.addEventListener("click", () => {
      close();
      player.start(story.id);
    });
    list.appendChild(item);
    return item;
  });
  panel.appendChild(list);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "story-picker-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => close());
  panel.appendChild(closeBtn);

  document.body.append(backdrop, panel);

  let open_ = false;

  function focusables(): HTMLElement[] {
    return [...itemButtons, closeBtn];
  }
  function onKeydown(e: KeyboardEvent): void {
    if (!open_) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      const f = focusables();
      const first = f[0];
      const last = f[f.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!panel.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  document.addEventListener("keydown", onKeydown, true);
  backdrop.addEventListener("pointerdown", () => close());

  function open(): void {
    if (open_) return;
    open_ = true;
    backdrop.hidden = false;
    panel.hidden = false;
    itemButtons[0]?.focus();
  }
  function close(): void {
    if (!open_) return;
    open_ = false;
    backdrop.hidden = true;
    panel.hidden = true;
    if (btn instanceof HTMLElement) btn.focus();
  }

  if (btn) {
    // The rail shipped inert (tabindex -1); search re-enables pointer-events for
    // the whole rail — join the tab order like the tour button does.
    btn.removeAttribute("tabindex");
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-label", "Stories — play a guided narrative over the map");
    btn.addEventListener("click", () => open());
  }

  return {
    open,
    close,
    get isOpen() {
      return open_;
    },
    dispose() {
      document.removeEventListener("keydown", onKeydown, true);
      backdrop.remove();
      panel.remove();
    },
  };
}
