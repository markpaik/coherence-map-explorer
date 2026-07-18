// Composition root — wires data, scene modules, state machine, and the render
// loop. All real logic lives in src/scene/*, src/state/*, src/ui/*,
// src/interaction/*.
//
// TAB ORDER (document flow; the canvas is aria-hidden and never a tab stop):
//   1. Search input (#search-input) — combobox; ArrowUp/Down move the listbox
//      via aria-activedescendant, Enter focuses the standard.
//   2. "Show me around" (#tour-btn) — starts the guided tour.
//   3. Filters rail — the "Filters" pill (≤720px) then the grade / strand /
//      toggle chips (aria-pressed buttons), left→right.
//   4. Detail panel (when open) — focus is MOVED to the code heading on open;
//      from there Tab runs Close → connection buttons → Trace → task links →
//      the collapsible details. Esc closes it and returns focus to the trigger
//      (or the search input). The panel is a labeled region, not a modal.
//   5. Tour card (when running) — a focus-TRAPPED dialog: Back / Skip / Next
//      cycle; ArrowLeft/Right navigate, Esc skips. The backdrop blocks the
//      scene and the rest of the chrome while it runs.
// :focus-visible rings (2px --ink @60%, 2px offset) mark every stop; nothing
// interactive is keyboard-unreachable.

import "./style.css";
import * as THREE from "three";
import { loadGraph, loadSearchDocs, type GraphCore, type GraphNode } from "./data";
import { BG } from "./scene/palette";
import { createNodes } from "./scene/nodes";
import { createEdges } from "./scene/edges";
import { createFilaments } from "./scene/filaments";
import { createBeacons } from "./scene/beacons";
import { createStations } from "./scene/stations";
import { createDrafts, draftFade } from "./scene/drafts";
import { createSheet } from "./scene/sheet";
import { createContours } from "./scene/contours";
import { createEnvirons, endpointOwns } from "./scene/environs";
import { computeNodeRadii } from "./scene/reach";
import { mulberry32 } from "./scene/evolve";
import { createAside } from "./ui/aside";
import { createCameraRig } from "./scene/camera";
import { createBloom } from "./scene/bloom";
import { createStarfield } from "./scene/starfield";
import { createNebula } from "./scene/nebula";
import { createPlanets } from "./scene/planets";
import { createEtches } from "./scene/etches";
import { createPoseDriver } from "./scene/pose";
import { createMachine, type Machine } from "./state/machine";
import { createTooltip } from "./ui/tooltip";
import { createPanel } from "./ui/panel";
import { createSearch } from "./ui/search";
import { createFilters } from "./ui/filters";
import { createTour } from "./ui/tour";
import { createViewToggle } from "./ui/viewtoggle";
import { createStyleToggle } from "./ui/styletoggle";
import { ART_STYLE_SLUGS, FIDENZA, RINGERS, type ArtStyle } from "./scene/artstyle";
import { createFallback } from "./ui/fallback";
import { createBrowse } from "./ui/browse";
import { createPicking } from "./interaction/picking";
import { createDamageEngine } from "./stories/damage";
import { createSelectorResolver } from "./stories/selectors";
import { createStoryPlayer, createStoryPicker } from "./stories/player";

const MAX_PIXEL_RATIO = 2;

// Probe: is a WebGL2 context obtainable at all? (Cheap throwaway canvas.)
function supportsWebGL2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

function bootError(message: string): void {
  const el = document.createElement("div");
  el.className = "boot-error";
  el.textContent = message;
  document.body.appendChild(el);
}

function start(graph: GraphCore): void {
  const sceneHost = document.getElementById("scene");
  const veilEl = document.getElementById("veil");
  if (!sceneHost || !veilEl) throw new Error("UI shell missing (#scene / #veil)");
  const veil: HTMLElement = veilEl; // non-null binding for closures below

  let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const params = new URLSearchParams(location.search);
  // Structure from mathematics, variation from time, nothing from chance
  // (Mark, round 9 revision): per-visit randomness is gone. Every generative
  // layer — the evolving sky, the title aside's pick and print — is a
  // deterministic function of the date and hour, so the site is a living
  // artwork whose state is the clock, and every visitor in the same hour
  // sees the same masterful shape.
  const bootClock = new Date();
  const clockSeed =
    ((bootClock.getFullYear() * 416 + (bootClock.getMonth() + 1) * 32 + bootClock.getDate()) * 24 +
      bootClock.getHours()) >>>
    0;
  const clockRand = mulberry32(clockSeed);
  const debug = params.has("debug");
  const og = params.has("og"); // ?og=1: hide UI chrome for a clean OG screenshot
  if (og) document.body.classList.add("og");

  // -- no-WebGL fallback --------------------------------------------------
  // ?nowebgl=1 forces it; otherwise fall back only if WebGL2 is truly absent.
  if (params.has("nowebgl") || !supportsWebGL2()) {
    createFallback(graph, params.has("nowebgl") ? "forced via ?nowebgl=1" : "WebGL2 unavailable");
    return;
  }

  // -- renderer -----------------------------------------------------------
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  sceneHost.appendChild(canvas);

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // bloom's mipmap chain softens edges; MSAA not worth it
      powerPreference: "high-performance",
      alpha: false,
      preserveDrawingBuffer: debug || og, // ?debug/?og: let tooling read the canvas
    });
  } catch {
    // Context creation failed at the last moment — degrade to the DOM list.
    createFallback(graph, "WebGL context creation failed");
    return;
  }
  renderer.setClearColor(BG, 1);

  // Half-resolution bloom on touch devices / small viewports (fill-rate win).
  const lowPowerBloom = navigator.maxTouchPoints > 0 || window.innerWidth < 800;

  // -- scene graph ----------------------------------------------------------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);

  const nodesById = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));
  // Load-bearing sizing: rest radii scale with descendant reach (scene/reach.ts)
  // so structurally consequential standards read quietly larger everywhere.
  const radii = computeNodeRadii(graph);
  const radiusIndexById = new Map<string, number>();
  graph.nodes.forEach((n, i) => radiusIndexById.set(n.id, i));
  const nodes = createNodes(graph.nodes, radii);
  const edges = createEdges(graph.edges, nodesById, (id) => radii[radiusIndexById.get(id) ?? 0]);
  // Family filaments: the thin parent→child tether (structural annotation; the
  // F-IF.C.7 fix). Follows both poses + ghosts with visibility, refreshed once
  // per rendered frame below (cheap at 116 segments).
  const filaments = createFilaments(graph, nodes);
  // Beacon rings: the gap spotlight (stories flag missed standards; the rings
  // make a handful of holes findable among 480 lights).
  const beacons = createBeacons(graph, nodes, radii);
  // Transit stations: the metro-map grammar the Transit pose (pose 3) crossfades
  // to as the node sprites fade out (pale discs / interchange capsules / family
  // lozenges). Idle below pose 2.6; follows live node positions; honours story
  // dimming via the same per-node emphasis/visibility/damage the nodes read.
  const stations = createStations(graph, radii, nodes);
  // Blueprint grammar: the cyanotype sheet behind the pose-2 content, and the
  // drafted node symbols (rings / double rings / crosshair ticks / Major-Work
  // dots) that the orbs hand off to over pose 1.6→2.4. Both idle outside the
  // Blueprint window; drafts follow live node positions + story dimming exactly
  // as the stations do.
  const sheet = createSheet(graph.nodes);
  const drafts = createDrafts(graph, radii, nodes);
  // Ascent altitude vocabulary: faint elevation isolines, one per dependency
  // depth, every fifth an index contour. Static reference grid; Ascent-only.
  const contours = createContours(graph.nodes);
  const stars = createStarfield(reducedMotion);
  const nebula = createNebula();
  // Distant sky: faint procedural planets — the galaxy the Constellation keeps.
  const planets = createPlanets();
  // Thematic environments: a Sierra dawn behind the Ascent, a quiet studio
  // behind the Blueprint, concrete daylight behind the Transit. Each is endpoint-
  // gated (raised only when its home is a morph endpoint), Galaxy-only, and owns
  // the galaxy fade — planets recede and stars dim as an environment takes over.
  const environs = createEnvirons({ planets, stars });
  scene.add(
    environs.group,
    sheet.object,
    contours.object,
    nodes.mesh,
    nodes.proxy,
    edges.mesh,
    filaments.object,
    beacons.object,
    stations.group,
    drafts.group,
    stars.points,
    nebula.group,
    planets.group,
  );

  const rig = createCameraRig(canvas, nodes.boundsSphere, nodes.boundsBox, {
    reducedMotion,
    aspect: window.innerWidth / window.innerHeight,
  });
  const etches = createEtches(graph.grades, graph.courses, rig.controls.azimuthAngle);
  scene.add(etches.group);

  const bloom = createBloom(renderer, scene, rig.camera, {
    resolutionScale: lowPowerBloom ? 0.5 : 1.0,
  });

  // -- render-on-demand loop (declared before UI so callbacks can request) --
  let needsRender = true;
  const requestRender = (): void => {
    needsRender = true;
  };

  // -- aria-live announcer (polite; canvas stays aria-hidden) --------------
  const liveEl = document.getElementById("aria-live");
  const announce = (msg: string): void => {
    if (liveEl) liveEl.textContent = msg;
  };

  const tooltip = createTooltip(document.body);

  // Panel ↔ machine are mutually referential: the machine drives the panel,
  // and the panel's buttons request focus/trace/close back on the machine.
  // Declare the machine first (definite-assignment), wire the panel to it, then
  // build the machine with the panel handle.
  let machine!: Machine;
  const panel = createPanel(document.body, graph, {
    focusCode: (code) => machine.focusByCode(code),
    trace: () => machine.trace(),
    close: () => machine.clearFocus(),
  });
  // Hover text: search docs prefetched off the critical path (idle callback,
  // shared cache with search/panel). Until they land, tooltips omit the line.
  let hoverDocs: Map<string, { text: string; ex: boolean }> | null = null;
  const prefetchHoverDocs = (): void => {
    void loadSearchDocs()
      .then((docs) => {
        hoverDocs = new Map(docs.map((d) => [d.id, { text: d.text, ex: d.ex === 1 }]));
      })
      .catch(() => {
        hoverDocs = null; // hover simply stays terse; search will retry itself
      });
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(prefetchHoverDocs, { timeout: 4000 });
  } else {
    window.setTimeout(prefetchHoverDocs, 1500); // Safari has no idle callback
  }

  machine = createMachine(graph, {
    nodes,
    edges,
    tooltip,
    canvas,
    rig,
    panel,
    announce,
    reducedMotion,
    requestRender,
    getDocText: (nodeId) => hoverDocs?.get(nodeId)?.text,
    hasExample: (nodeId) => hoverDocs?.get(nodeId)?.ex ?? false,
  });

  const picking = createPicking(canvas, rig.camera, nodes, machine);
  const search = createSearch({ graph, machine });
  const filters = createFilters({ graph, nodes, edges, requestRender });

  // Dual-pose "unravel" morph. The driver owns pose geometry only (positions /
  // edge attributes / etch transforms); it asks the machine to reframe an active
  // focus after a morph. It reads the live `reducedMotion` flag, so toggle and
  // story-driven setPose calls cut instantly under reduced motion.
  const poseDriver = createPoseDriver({
    graph,
    nodes,
    edges,
    etches,
    rig,
    machine,
    requestRender,
    reducedMotion: () => reducedMotion,
  });
  // The rotating poetic aside beside the wordmark: pick and print are
  // hour-seeded, so the title turns with the day (clicking still deals).
  createAside(clockRand);
  const viewToggle = createViewToggle({ driver: poseDriver });
  let lastReflectedPose = poseDriver.pose;

  // -- art styles (Galaxy / Ringers / Fidenza) ------------------------------
  // A style is a LOOK: geometry skins + field color + UI ink swap in place;
  // poses, focus, filters, and stories keep operating identically. The sky
  // (stars/nebula/planets) belongs to the Galaxy alone — paper has no stars.
  // Style 0 must stay pixel-identical to the shipped Galaxy.
  let artStyle: ArtStyle = 0;
  const ART_BG: readonly number[] = [BG, RINGERS.bg, FIDENZA.bg];
  function applyArtStyle(style: ArtStyle): void {
    artStyle = style;
    nodes.setArtStyle(style);
    edges.setArtStyle(style);
    filaments.setArtStyle(style);
    beacons.setArtStyle(style);
    stations.setArtStyle(style);
    drafts.setArtStyle(style);
    sheet.setArtStyle(style);
    contours.setArtStyle(style);
    etches.setArtStyle(style);
    bloom.setArtPaper(style !== 0);
    const sky = style === 0;
    stars.points.visible = sky;
    nebula.group.visible = sky;
    renderer.setClearColor(ART_BG[style], 1);
    (scene.background as THREE.Color).setHex(ART_BG[style]);
    document.body.classList.toggle("art-ringers", style === 1);
    document.body.classList.toggle("art-fidenza", style === 2);
    styleToggle.reflect(style);
    requestRender();
  }
  const styleToggle = createStyleToggle({
    apply: applyArtStyle,
    initial: 0,
  });
  // ?style=ringers|fidenza deep-links a skin (session-only, not persisted).
  const bootStyle = ART_STYLE_SLUGS.indexOf(params.get("style") ?? "galaxy");
  if (bootStyle > 0) applyArtStyle(bootStyle as ArtStyle);
  search.setGradeContext((g) => filters.isGradeActive(g));
  const tour = createTour({
    machine,
    rig,
    filters,
    search,
    reducedMotion: () => reducedMotion,
  });

  // -- stories ---------------------------------------------------------------
  const damageEngine = createDamageEngine(graph);
  const resolveSelector = createSelectorResolver(graph);
  const storyPlayer = createStoryPlayer({
    graph,
    machine,
    poseDriver,
    damage: damageEngine,
    resolve: resolveSelector,
    nodes,
    edges,
    beacons,
    filters,
    rig,
    requestRender,
    announce,
    reducedMotion: () => reducedMotion,
  });
  const storyPicker = createStoryPicker({ player: storyPlayer });
  void storyPicker;

  // -- Browse mode (phone-first drill-down; default on phones) -------------
  // A full-screen DOM overlay above the still-booting scene. Active when the
  // device is a small coarse-pointer screen, or forced via ?browse=1 (any
  // device — desktop testing); ?nobrowse=1 forces it off. Browse reads the
  // boot hash itself (opens at a #/s/<CODE> deep link, stays closed for a
  // #/story/<id> one). onEnterMap just pokes the render loop after hand-off.
  const isPhoneDefault =
    window.matchMedia("(max-width: 720px)").matches &&
    window.matchMedia("(pointer: coarse)").matches;
  const browseActive = params.has("nobrowse")
    ? false
    : params.has("browse") || isPhoneDefault;
  if (browseActive) {
    const browse = createBrowse({ graph, machine, storyPicker, onEnterMap: requestRender });
    // Swiping the detail sheet UP from its peek hands the standard to Browse
    // (full detail lives there on phones); the map focus clears underneath.
    panel.setExpandToBrowse((code) => {
      machine.clearFocus();
      browse.openStandard(code);
    });
  }

  // -- reduced motion (single control point; also the __cme debug hook) -----
  // Fans a single boolean out to every animated subsystem: idle drift, node
  // shimmer, star twinkle, edge flow comets, and the machine's cascade/camera
  // cuts. advance() reads `reducedMotion` too and stops pumping scene time, so
  // render-on-demand truly idles (rendererInfo frame counter goes flat).
  function setReducedMotion(on: boolean): void {
    reducedMotion = on;
    machine.setReducedMotion(on);
    edges.setFlowEnabled(!on);
    nodes.setShimmerEnabled(!on);
    stars.setTwinkleEnabled(!on);
    rig.setDriftEnabled(!on);
    // Mirror to a root class so DOM transitions (panel/dropdown/tour) also honor
    // the runtime toggle, not just the OS-level prefers-reduced-motion media.
    document.documentElement.classList.toggle("rm", on);
    requestRender();
  }
  setReducedMotion(reducedMotion); // sync all subsystems to the initial value

  // -- deep-link routing (#/s/<CODE>) -------------------------------------
  // The machine writes the hash (replaceState — no hashchange), so hashchange
  // only fires for genuine back/forward or manual edits.
  const codeFromHash = (): string | null => {
    const m = /^#\/s\/(.+)$/.exec(location.hash);
    return m ? decodeURIComponent(m[1]) : null;
  };
  const storyIdFromHash = (): string | null => {
    const m = /^#\/story\/(.+)$/.exec(location.hash);
    return m ? decodeURIComponent(m[1]) : null;
  };
  const routeFromHash = (instant: boolean): void => {
    // A story is playing (or is being deep-linked): the player owns the scene,
    // not the standard router.
    if (storyPlayer.running || storyIdFromHash()) return;
    const code = codeFromHash();
    if (code) {
      machine.focusByCode(code, { instant });
    } else if (machine.focusedIndex !== null) {
      machine.clearFocus();
    }
  };
  window.addEventListener("hashchange", () => routeFromHash(true));

  // -- global Escape: close panel / clear focus (search owns its own Esc) --
  // The story card handles its own Esc (capture-phase, stops propagation), so
  // this never fires mid-story; the guard is belt-and-suspenders.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && machine.focusedIndex !== null && !storyPlayer.running) {
      machine.clearFocus();
    }
  });

  // Station crossfade envelope: node sprites hand off to station marks over the
  // pose 2.6→3.0 window (0 = orbs, 1 = fully stationed). Both the node fade and
  // the stations read this exact smoothstep so the crossfade stays in lockstep.
  const stationFadeFor = (p: number): number => {
    const t = Math.min(1, Math.max(0, (p - 2.6) / 0.4));
    return t * t * (3 - 2 * t);
  };

  let sceneTime = 0;
  let last = performance.now();
  let revealed = false;
  let wasStoryHolding = false; // rising-edge detector for story-hold drift resume

  // Debug instrumentation (?debug=1): draw calls + rough FPS.
  const deltas: number[] = [];
  if (debug) renderer.info.autoReset = false;

  function advance(delta: number): void {
    let render = needsRender;

    if (!reducedMotion) {
      // Shimmer / twinkle / flow are continuous while the tab is visible.
      sceneTime += delta;
      nodes.setTime(sceneTime);
      edges.setTime(sceneTime);
      stars.setTime(sceneTime);
      planets.setTime(sceneTime);
      beacons.setTime(sceneTime);
      // The evolving sky: poses drift through the day-seeded field. Skipped
      // under reduced motion, freezing the field at its boot shape.
      poseDriver.setEvolveTime(sceneTime);
      render = true;
    }
    // Planet visibility + star dimming are owned by environs.update (in the
    // render block): the galaxy is full in the Constellation and recedes as a
    // thematic environment takes over, and vanishes entirely in the art styles.

    if (picking.update()) render = true;
    if (machine.tick(delta)) render = true;
    // Story damage crossfade + settle/auto-advance countdown.
    if (storyPlayer.tick(delta)) render = true;
    // Guided-tour auto-advance countdown.
    if (tour.tick(delta)) render = true;
    // Pose morph: CPU-side, so it must keep the frame pump hot while it plays.
    if (poseDriver.tick(delta)) render = true;
    // Keep the toggle's aria-pressed + depth-scale hint in sync with the pose
    // (cheap; fires only when the pose actually changed, incl. instant cuts).
    if (poseDriver.pose !== lastReflectedPose) {
      lastReflectedPose = poseDriver.pose;
      viewToggle.reflect(poseDriver.pose, poseDriver.target);
    }
    // Idle drift: normally suspended whenever the user is engaged. Stories are
    // the exception — while a scene HOLDS (settled, awaiting auto-advance/Next)
    // the constellation is allowed to breathe; it pauses again during a scene
    // transition. On the transition→hold edge, poke the drift so it resumes
    // immediately instead of waiting out the 20s post-interaction grace.
    const storyHolding = machine.state === "storying" && storyPlayer.isHolding();
    if (storyHolding && !wasStoryHolding) rig.resumeDriftNow();
    wasStoryHolding = storyHolding;
    // Drift breathes while idle, during story holds, and through the tour —
    // a stagnant model between tour stops read as broken, not calm.
    const driftAllowed =
      machine.state === "idle" || machine.state === "touring" || storyHolding;
    if (rig.update(delta, !driftAllowed)) render = true;

    if (render) {
      // Transit metro grammar: feed the eased pose to the edge program (so pose 3
      // sharpens the soft bezier into metro turns). Edges morph continuously, so
      // they are NOT endpoint-gated.
      const pose = poseDriver.pose;
      edges.setPose(pose);

      // Endpoint-gated round-10 layer windows (round-11 fix). Each layer's window
      // keys on the scalar pose, so a morph that SWEEPS THROUGH a home (0→3 passes
      // pose 2) would briefly flash that home's layer. Gate each layer to the
      // morph endpoints: it shows only when its home pose is the origin or target.
      // Settled poses (origin === target) behave exactly as before. We cannot touch
      // the drafts/contours/stations internals, so the gate is applied at the CALL
      // SITE — feed the real pose when the endpoint owns the home, else a sentinel
      // far pose (OFF_POSE) that zeroes every layer's own window.
      const gate = { origin: poseDriver.origin, target: poseDriver.target };
      const OFF_POSE = -1;
      const gatedPose = (home: number): number => (endpointOwns(home, gate) ? pose : OFF_POSE);
      // Orbs collapse under the UNION of both handoff windows — but only the ones
      // whose home is a morph endpoint, so 0→3 never blanks the orbs at pose 2
      // (where the drafts would otherwise fully fade them out).
      const draftAmt = endpointOwns(2, gate) ? draftFade(pose) : 0;
      const stationAmt = endpointOwns(3, gate) ? stationFadeFor(pose) : 0;
      nodes.setOrbFade(Math.max(stationAmt, draftAmt));
      // Concrete-daylight amount (Galaxy only; 0 in the paper styles): the Transit
      // focus grammar dissolves unconnected metro lines + stations toward the live
      // city background — near-black in the dark baseline, concrete grey at daylight.
      // environs.update runs just below, so this is last frame's value (a one-frame
      // lag on a slow ramp — imperceptible).
      const daylight = artStyle === 0 ? environs.daylight01() : 0;
      edges.setDaylight(daylight);
      stations.update(gatedPose(3), daylight); // Transit stations, home 3
      // Blueprint sheet + drafted node symbols (home 2) and Ascent contours (home 1).
      sheet.update(gatedPose(2));
      drafts.update(gatedPose(2));
      contours.update(gatedPose(1));
      // Thematic environments (Sierra dawn / studio / concrete daylight): same
      // endpoint gate, plus story suppression and the Galaxy-only art gate. Owns
      // the planet recede + star dim; returns true while its fade is still slewing.
      const envSlewing = environs.update(pose, gate, storyPlayer.running, artStyle);
      // Light-environment chrome (round-12): the Sierra dawn and concrete daylight
      // are LIGHT fields (the studio behind the Blueprint is a DARK shell, so it is
      // excluded). When their combined amount owns the frame — Galaxy only, no story
      // — flip the fixed light-ink chrome to dark slate (body.env-light in style.css)
      // and re-ink the etch markers with a dark warm ink. These read the SAME slewed
      // amounts environs just consumed; the 0.5 threshold on a continuous amount
      // flips once and never flickers mid-morph.
      const dawnAmt = artStyle === 0 && !storyPlayer.running ? environs.dawn01() : 0;
      const dayAmt = artStyle === 0 && !storyPlayer.running ? environs.daylight01() : 0;
      document.body.classList.toggle("env-light", dawnAmt + dayAmt > 0.5);
      etches.setEnvLight(Math.max(dawnAmt, dayAmt));
      // Bloom bleeds out as the concrete daylight surfaces (Galaxy only).
      bloom.setDaylight(artStyle === 0 ? environs.daylight01() : 0);
      // Filaments track node positions + visibility every rendered frame (pose
      // morphs, filters, story spotlights) — one cheap pass over 116 segments.
      filaments.update();
      if (beacons.active) beacons.update(); // rings follow morphing nodes
      if (debug) renderer.info.reset();
      bloom.render(delta);
      needsRender = false;
      // Keep the pump hot while the galaxy-fade slew (planet recede / star dim)
      // is still settling, so it converges under render-on-demand.
      if (envSlewing) needsRender = true;

      if (!revealed) {
        revealed = true;
        // First real frame is on screen: observatory powers up (900ms fade).
        veil.classList.add("veil-hidden");
        veil.addEventListener("transitionend", () => veil.remove(), { once: true });
      }

      if (debug) {
        deltas.push(delta);
        if (deltas.length === 60) {
          const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
          console.log(
            `[debug] draw calls: ${renderer.info.render.calls}, ` +
              `triangles: ${renderer.info.render.triangles}, ` +
              `~${(1 / avg).toFixed(0)} fps (avg of 60 frames)`,
          );
          deltas.length = 0;
        }
      }
    }
  }

  function frame(now: number): void {
    requestAnimationFrame(frame);
    const delta = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (document.hidden) return;
    advance(delta);
  }

  // -- sizing ------------------------------------------------------------
  // The actual resize is expensive (reallocates every postprocessing buffer),
  // so coalesce a burst of resize events into one apply on the next frame.
  function applyResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    renderer.setPixelRatio(dpr);
    bloom.setSize(w, h); // composer sizes the renderer + all buffers
    rig.setAspect(w / h);
    edges.setViewport(w * dpr, h * dpr, dpr);
    stars.setPixelRatio(dpr);
    requestRender();
  }
  let resizePending = false;
  function resize(): void {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
      resizePending = false;
      applyResize();
    });
  }
  window.addEventListener("resize", resize);
  // Chrome freezes occluded tabs: resize events fired while hidden are lost,
  // leaving the canvas at a stale size when the tab thaws. Re-measure on
  // every return to visibility.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) applyResize();
  });
  // Moving the window to a monitor with a different devicePixelRatio changes
  // devicePixelRatio WITHOUT firing a window 'resize' — watch it explicitly so
  // the renderer never renders at a stale pixel ratio. matchMedia re-arms each
  // time because the query string bakes in the current dpr.
  function watchPixelRatio(): void {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener(
      "change",
      () => {
        applyResize();
        watchPixelRatio();
      },
      { once: true },
    );
  }
  watchPixelRatio();
  applyResize();

  // Etches sync asynchronously (font parse in a worker); repaint when ready.
  void etches.ready.then(requestRender);

  // Navigation hints (bottom-right) dim once the user starts driving the camera.
  const navHints = document.getElementById("nav-hints");
  if (navHints) {
    const dimHints = (): void => {
      navHints.classList.add("nav-hints-dim");
      rig.controls.removeEventListener("controlstart", dimHints);
    };
    rig.controls.addEventListener("controlstart", dimHints);
  }

  // -- context loss ---------------------------------------------------------
  // Chosen recovery: full reload once the browser restores the context.
  // Rebuilding the composer + instanced buffers by hand is possible but reload
  // is dependable and this app boots in <1s. Some losses (GPU reset, driver
  // crash) never fire 'restored', which would strand the user on a frozen
  // canvas — so on loss we surface a non-blocking DOM notice with a manual
  // Reload, and remove it if the context does come back on its own.
  let contextNotice: HTMLElement | null = null;
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    if (contextNotice) return;
    const notice = document.createElement("div");
    notice.className = "context-lost";
    notice.setAttribute("role", "alert");
    notice.innerHTML =
      "The 3D view lost its graphics context. " +
      '<button type="button" class="context-lost-reload">Reload</button>';
    notice.querySelector("button")?.addEventListener("click", () => location.reload());
    document.body.appendChild(notice);
    contextNotice = notice;
  });
  canvas.addEventListener("webglcontextrestored", () => location.reload());

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      last = performance.now();
      requestRender();
    }
  });

  if (debug) {
    // Test/debug hook (?debug=1 only): lets automation find a node on screen
    // and exercise the real pointer pipeline.
    (window as unknown as Record<string, unknown>).__cme = {
      screenPos(code: string): [number, number] | null {
        const n = graph.nodes.find((node) => node.code === code);
        if (!n) return null;
        const p = new THREE.Vector3(n.pos[0], n.pos[1], n.pos[2]).project(rig.camera);
        if (p.z > 1) return null; // behind camera
        return [((p.x + 1) / 2) * window.innerWidth, ((1 - p.y) / 2) * window.innerHeight];
      },
      canvas,
      rendererInfo: renderer.info,
      // Drive one frame manually (works on hidden tabs, where rAF is
      // suspended and frame() early-returns). Debug/testing only.
      stepFrame(deltaSeconds = 1 / 60): void {
        advance(deltaSeconds);
      },
      // Direct focus driver (bypasses the pointer pipeline) for automation.
      focusCode(code: string): boolean {
        return machine.focusByCode(code, { instant: true });
      },
      // Flip reduced motion at runtime (drift/shimmer/twinkle/flow + cascade cuts).
      setReducedMotion(on: boolean): void {
        setReducedMotion(on);
      },
      machine,
      tour,
      // Dual-pose morph driver, for automation (drive setPose, read pose/target).
      pose: { driver: poseDriver },
      // Art styles, for automation (0 Galaxy | 1 Ringers | 2 Fidenza).
      art: {
        set(style: number): void {
          applyArtStyle(style as ArtStyle);
        },
        get(): number {
          return artStyle;
        },
      },
      // Stories, for automation (start/stop/step a story).
      stories: {
        player: storyPlayer,
        start(id: string): void {
          storyPlayer.start(id);
        },
      },
      // Scene handles for automated filter/visibility assertions.
      nodes,
      edges,
      filaments,
      stations,
      drafts,
      sheet,
      contours,
      environs,
      planets,
      stars,
      graph,
    };
  }

  // Resolve any deep link now that the scene is ready. A story link
  // (#/story/<id>) starts that story; a standard link (#/s/<CODE>) opens the
  // panel with an instant reveal + camera cut.
  const deepStory = storyIdFromHash();
  if (deepStory) {
    storyPlayer.start(deepStory, { deepLink: true });
  } else {
    routeFromHash(true);
  }

  requestAnimationFrame(frame);
}

async function main(): Promise<void> {
  try {
    const graph = await loadGraph();
    start(graph);
  } catch (err) {
    bootError(`Failed to load the coherence map: ${(err as Error).message}`);
  }
}

void main();
