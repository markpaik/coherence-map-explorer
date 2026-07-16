// Composition root — wires data, scene modules, state machine, and the render
// loop. All real logic lives in src/scene/*, src/state/*, src/ui/*,
// src/interaction/*.

import "./style.css";
import * as THREE from "three";
import { loadGraph, type GraphCore, type GraphNode } from "./data";
import { BG } from "./scene/palette";
import { createNodes } from "./scene/nodes";
import { createEdges } from "./scene/edges";
import { createCameraRig } from "./scene/camera";
import { createBloom } from "./scene/bloom";
import { createStarfield } from "./scene/starfield";
import { createEtches } from "./scene/etches";
import { createMachine } from "./state/machine";
import { createTooltip } from "./ui/tooltip";
import { createPicking } from "./interaction/picking";

const MAX_PIXEL_RATIO = 2;

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

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const debug = new URLSearchParams(location.search).has("debug");

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
      preserveDrawingBuffer: debug, // ?debug=1 only: lets tooling read the canvas
    });
  } catch {
    bootError(
      "Coherence Map Explorer needs a WebGL-capable browser. (A no-WebGL fallback ships in a later phase.)",
    );
    return;
  }
  renderer.setClearColor(BG, 1);

  // -- scene graph ----------------------------------------------------------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);

  const nodesById = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));
  const nodes = createNodes(graph.nodes);
  const edges = createEdges(graph.edges, nodesById);
  const stars = createStarfield(reducedMotion);
  scene.add(nodes.mesh, nodes.proxy, edges.mesh, stars.points);

  const rig = createCameraRig(canvas, nodes.boundsSphere, nodes.boundsBox, {
    reducedMotion,
    aspect: window.innerWidth / window.innerHeight,
  });
  const etches = createEtches(graph.grades, rig.controls.azimuthAngle);
  scene.add(etches.group);

  const bloom = createBloom(renderer, scene, rig.camera);

  const tooltip = createTooltip(document.body);
  const machine = createMachine(graph, nodes, edges, tooltip, canvas);
  const picking = createPicking(canvas, rig.camera, nodes, machine);

  if (reducedMotion) edges.setFlowEnabled(false);

  // -- render-on-demand loop ---------------------------------------------
  let needsRender = true;
  const requestRender = (): void => {
    needsRender = true;
  };

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
    if (rig.update(delta, machine.state === "hover")) render = true;

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
    };
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
