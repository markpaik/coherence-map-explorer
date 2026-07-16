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
import { loadGraph, type GraphCore, type GraphNode } from "./data";
import { BG } from "./scene/palette";
import { createNodes } from "./scene/nodes";
import { createEdges } from "./scene/edges";
import { createCameraRig } from "./scene/camera";
import { createBloom } from "./scene/bloom";
import { createStarfield } from "./scene/starfield";
import { createNebula } from "./scene/nebula";
import { createEtches } from "./scene/etches";
import { createMachine, type Machine } from "./state/machine";
import { createTooltip } from "./ui/tooltip";
import { createPanel } from "./ui/panel";
import { createSearch } from "./ui/search";
import { createFilters } from "./ui/filters";
import { createTour } from "./ui/tour";
import { createFallback } from "./ui/fallback";
import { createPicking } from "./interaction/picking";

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
  const nodes = createNodes(graph.nodes);
  const edges = createEdges(graph.edges, nodesById);
  const stars = createStarfield(reducedMotion);
  const nebula = createNebula();
  scene.add(nodes.mesh, nodes.proxy, edges.mesh, stars.points, nebula.group);

  const rig = createCameraRig(canvas, nodes.boundsSphere, nodes.boundsBox, {
    reducedMotion,
    aspect: window.innerWidth / window.innerHeight,
  });
  const etches = createEtches(graph.grades, rig.controls.azimuthAngle);
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
  });

  const picking = createPicking(canvas, rig.camera, nodes, machine);
  const search = createSearch({ graph, machine });
  const filters = createFilters({ graph, nodes, edges, requestRender });
  const tour = createTour({
    machine,
    rig,
    filters,
    search,
    reducedMotion: () => reducedMotion,
  });
  void tour;

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
  const routeFromHash = (instant: boolean): void => {
    const code = codeFromHash();
    if (code) {
      machine.focusByCode(code, { instant });
    } else if (machine.focusedIndex !== null) {
      machine.clearFocus();
    }
  };
  window.addEventListener("hashchange", () => routeFromHash(true));

  // -- global Escape: close panel / clear focus (search owns its own Esc) --
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && machine.focusedIndex !== null) {
      machine.clearFocus();
    }
  });

  let sceneTime = 0;
  let last = performance.now();
  let revealed = false;

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
      render = true;
    }

    if (picking.update()) render = true;
    if (machine.tick(delta)) render = true;
    // Suspend idle drift whenever the user is engaged (hover, focus, search).
    if (rig.update(delta, machine.state !== "idle")) render = true;

    if (render) {
      if (debug) renderer.info.reset();
      bloom.render(delta);
      needsRender = false;

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
  function resize(): void {
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
  window.addEventListener("resize", resize);
  resize();

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
  // Chosen recovery: full reload. Rebuilding the composer + instanced buffers
  // by hand is possible but reload is dependable and this app boots in <1s.
  canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
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
      // Scene handles for automated filter/visibility assertions.
      nodes,
      edges,
      graph,
    };
  }

  // Resolve any deep link (#/s/<CODE>) now that the scene is ready — instant
  // reveal + camera cut, panel open.
  routeFromHash(true);

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
