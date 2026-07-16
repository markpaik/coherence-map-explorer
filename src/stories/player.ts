// Story player — drives a story over the constellation, one scene at a time.
//
// A story is a time-lapsed argument (docs/STORIES.md): each scene names a graph
// state (missed standards → structural damage, an optional spotlight, an optional
// focus), a camera framing, and a card. The player is the only thing that:
//   - puts the machine into the "storying" state (drift suspended, scene input
//     blocked by a backdrop, exactly the tour's pattern);
//   - resolves selectors → the damage engine → nodes/edges.setDamage;
//   - drives the dual-pose unravel (stories live in the Ascent) and the camera;
//   - eases the damage crossfade of a "lapse" transition over 1.4s.
// It NEVER writes emphasis directly (the machine stays the single writer — the
// player asks for a *silent* focus that lights the closure without opening the
// panel or touching the hash) and it restores every borrowed surface on exit.

import type { GraphCore } from "../data";
import type { Machine } from "../state/machine";
import { nodeBoundingSphere } from "../state/machine";
import type { PoseDriver } from "../scene/pose";
import type { NodesHandle } from "../scene/nodes";
import type { EdgesHandle } from "../scene/edges";
import type { CameraRig } from "../scene/camera";
import type { FiltersHandle } from "../ui/filters";
import type { DamageEngine } from "./damage";
import type { SelectorResolver } from "./selectors";
import { STORIES, type Story, type StoryScene } from "./scripts";
import { createStoryCard, type StoryCardHandle } from "../ui/storycard";

const LAPSE_MS = 1400; // "lapse" transition length (damage crossfade)
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

export interface StoryPlayerDeps {
  graph: GraphCore;
  machine: Machine;
  poseDriver: PoseDriver;
  damage: DamageEngine;
  resolve: SelectorResolver;
  nodes: NodesHandle;
  edges: EdgesHandle;
  filters: FiltersHandle;
  rig: CameraRig;
  requestRender: () => void;
  announce: (msg: string) => void;
  reducedMotion: () => boolean;
  /** Fired when a story starts — used to switch Gaps mode off so the two never
   *  fight over the shared damage buffer. */
  onStart?: () => void;
}

export interface StoryPlayerHandle {
  /** Start a story by id (deepLink=true came in via #/story/<id>). */
  start(storyId: string, opts?: { deepLink?: boolean }): void;
  /** Exit cleanly to idle, restoring every borrowed surface. */
  stop(): void;
  next(): void;
  back(): void;
  jump(index: number): void;
  /** Ease the lapse damage crossfade; returns true while animating. */
  tick(dt: number): boolean;
  readonly running: boolean;
  readonly sceneIndex: number;
  dispose(): void;
}

export function createStoryPlayer(deps: StoryPlayerDeps): StoryPlayerHandle {
  const { graph, machine, poseDriver, damage, resolve, nodes, edges, filters, rig } = deps;
  const { requestRender, announce, reducedMotion } = deps;

  const N = graph.nodes.length;
  const M = graph.edges.length;

  // Edge endpoint indices (for propagating a node spotlight mask onto edges).
  const indexById = new Map<string, number>();
  graph.nodes.forEach((n, i) => indexById.set(n.id, i));
  const edgeS = new Int32Array(M);
  const edgeT = new Int32Array(M);
  graph.edges.forEach((e, j) => {
    edgeS[j] = indexById.get(e.s) ?? -1;
    edgeT[j] = indexById.get(e.t) ?? -1;
  });

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
  });

  // --- state --------------------------------------------------------------
  let running = false;
  let currentStory: Story | null = null;
  let currentIndex = 0;
  let priorPose: 0 | 1 = 0;
  let deepLink = false;
  let navToken = 0;

  // Damage crossfade buffers. Typed as the general Float32Array so the damage
  // engine's return (Float32Array<ArrayBufferLike>) assigns cleanly.
  const damageCur = new Float32Array(N);
  let damageFrom: Float32Array = new Float32Array(N);
  let damageTo: Float32Array = new Float32Array(N);
  let easing = false;
  let easeElapsed = 0;

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
    if (code) machine.focusByCode(code, { silent: true, instant: cut });
    else machine.clearFocus({ silent: true });
  }

  function damageTargetFor(scene: StoryScene): Float32Array {
    const missed = scene.state?.missed;
    if (!missed || missed.length === 0) return new Float32Array(N);
    const missedIdx = resolveUnion(missed);
    if (scene.state?.damage) {
      return damage.compute(idsFromIndices(missedIdx));
    }
    // damage:false → the missed standards show as husks, no downstream exposure.
    const husks = new Float32Array(N);
    for (const i of missedIdx) husks[i] = 1;
    return husks;
  }

  function applyDamage(scene: StoryScene, ease: boolean): void {
    const target = damageTargetFor(scene);
    damageTo = target;
    if (ease) {
      damageFrom = new Float32Array(damageCur);
      easeElapsed = 0;
      easing = true;
    } else {
      damageCur.set(target);
      easing = false;
      pushDamage();
    }
  }

  function applySpotlight(scene: StoryScene): void {
    const spot = scene.state?.spotlight;
    if (spot && spot.length) {
      const set = resolveUnion(spot);
      const nodeMask = new Float32Array(N); // 0 = ghost, 1 = lit
      for (const i of set) nodeMask[i] = 1;
      const edgeMask = new Float32Array(M);
      for (let j = 0; j < M; j++) {
        const s = edgeS[j];
        const t = edgeT[j];
        edgeMask[j] = s >= 0 && t >= 0 && nodeMask[s] === 1 && nodeMask[t] === 1 ? 1 : 0;
      }
      nodes.setVisibleMask(nodeMask);
      edges.setVisibleMask(edgeMask);
    } else {
      nodes.setVisibleMask(null);
      edges.setVisibleMask(null);
    }
  }

  function applyCamera(scene: StoryScene, animate: boolean): void {
    const cam = scene.camera;
    if (!cam || cam.fit === "all") {
      rig.frameHome(animate);
      return;
    }
    const idx = new Set<number>();
    for (const sel of cam.fit) for (const i of resolve(sel)) idx.add(i);
    if (idx.size === 0) {
      rig.frameHome(animate);
      return;
    }
    void rig.focusOn(nodeBoundingSphere(nodes, [...idx]), animate, 0);
  }

  async function goto(index: number, animate: boolean): Promise<void> {
    if (!currentStory) return;
    const token = ++navToken;
    currentIndex = index;
    const scene = currentStory.scenes[index];
    const cut = !animate || reducedMotion();

    // Pose first (all stories live in the Ascent): the FIRST scene triggers the
    // unravel; later same-pose scenes resolve instantly.
    await poseDriver.setPose(scene.camera?.pose ?? 1, { instant: reducedMotion() });
    if (token !== navToken || !running) return; // superseded or stopped mid-morph

    applyFocus(scene, cut); // emphasis (silent) — camera below overrides framing
    applyDamage(scene, !cut);
    applySpotlight(scene);
    applyCamera(scene, !cut);
    card.render(scene, index, currentStory.scenes.length);
    requestRender();
  }

  // --- lifecycle ----------------------------------------------------------
  function start(storyId: string, opts?: { deepLink?: boolean }): void {
    const story = STORIES.find((s) => s.id === storyId);
    if (!story) {
      console.warn(`[cme] unknown story: ${storyId}`);
      return;
    }
    if (running) stopImmediate(); // restart cleanly (no pose return churn)
    deps.onStart?.(); // e.g. switch Gaps off — both own the damage buffer

    running = true;
    currentStory = story;
    currentIndex = 0;
    deepLink = opts?.deepLink === true;
    priorPose = poseDriver.target; // the pose to return to on exit

    machine.setHover(null); // a stale hover must not linger under the backdrop
    machine.setStorying(true);
    document.body.classList.add("storying");
    backdrop.hidden = false;
    card.begin(story);
    void goto(0, !reducedMotion());
  }

  // Reset all graph surfaces without the (awaited) pose return — used when
  // restarting into another story, and shared by stop().
  function stopImmediate(): void {
    running = false;
    navToken++;
    easing = false;
    damageCur.fill(0);
    nodes.setDamage(null);
    edges.setDamage(null);
    nodes.setVisibleMask(null);
    edges.setVisibleMask(null);
    filters.recompute(); // reclaim the visibility buffers for the live filters
    machine.clearFocus({ silent: true });
    card.end();
  }

  async function stop(): Promise<void> {
    if (!running) return;
    const returnPose = priorPose;
    stopImmediate();
    requestRender();

    // Return to the pre-story pose (awaited), backdrop still up so the closing
    // unravel plays uninterrupted, then leave the storying state.
    await poseDriver.setPose(returnPose, { instant: reducedMotion() });
    if (running) return; // a new story started during the return — don't tear down

    backdrop.hidden = true;
    document.body.classList.remove("storying");
    machine.setStorying(false);
    if (deepLink) {
      history.replaceState(null, "", location.pathname + location.search);
      deepLink = false;
    }
    currentStory = null;
    const btn = document.getElementById("story-btn");
    if (btn instanceof HTMLElement) btn.focus();
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

  return {
    start,
    stop() {
      void stop();
    },
    next,
    back,
    jump,
    tick(dt) {
      if (!easing) return false;
      easeElapsed += dt * 1000;
      const k = smoothstep(easeElapsed / LAPSE_MS);
      for (let i = 0; i < N; i++) {
        damageCur[i] = damageFrom[i] + (damageTo[i] - damageFrom[i]) * k;
      }
      pushDamage();
      if (easeElapsed >= LAPSE_MS) {
        damageCur.set(damageTo);
        easing = false;
        pushDamage();
      }
      requestRender();
      return true;
    },
    get running() {
      return running;
    },
    get sceneIndex() {
      return currentIndex;
    },
    dispose() {
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
