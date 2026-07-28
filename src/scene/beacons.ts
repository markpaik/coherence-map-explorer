// Beacon rings — the gap spotlight, now a contagion. A handful of holes among
// 480 standards is exactly the thing a dark field hides: a missed standard reads
// as near-black, which is honest but unfindable. Each beacon is a thin breathing
// ring drawn around a flagged node, camera-facing and depth-test-free, so the
// wounds are findable from any angle even when the chain passes THROUGH them (the
// swiss-cheese confusion: the connecting rungs were the dark ones, and the
// ladder read as broken instead of marked). Mark, round 7: "make it a point to
// light these up... a light-these-up/spotlight approach may be easier for the
// user to follow."
//
// Round 2 (the contagion): the rings no longer sit only on the directly-missed
// set. Every damaged node earns a ring whose INTENSITY tracks its damage — a
// directly-missed node keeps today's full ring exactly (intensity 1), a
// downstream node gets a proportionally fainter, thinner ring — and the rings
// arrive in HOP ORDER (each target carries a per-instance appear time), so a
// scene's damage spreads outward as a wave instead of toggling on all at once.
// Direction is leads-to only; the player's BFS never queues an ancestor. Under
// reduced motion the wave collapses to instant (setTargets `instant`), full set:
// the motion is cut, never the information.
//
// One instanced draw call over a pool sized to the whole graph (a full missed
// grade plus its forward closure is the largest set). Rings follow live node
// positions through pose morphs. Under reduced motion the breath freezes (setTime
// stops advancing) and every ring holds steady at full appear.

import * as THREE from "three";
import type { GraphCore } from "../data";
import type { NodesHandle } from "./nodes";
import type { BeaconTarget } from "../stories/contagion";
import { FIDENZA, RINGERS } from "./artstyle";

const MAX = 480; // one ring per standard: the whole graph, in one instanced draw
const HOP_SEC = 0.2; // wave spacing: ~200 ms per hop so the spread reads as spread
const FADE_SEC = 0.22; // how long each ring eases in once its hop arrives
const APPEARED = -1e6; // an appear time far in the past → fully shown immediately
// Galaxy ring level. Below the bloom threshold on purpose: damage never glows.
const GALAXY_MUL = 0.42;
// Smallest on-screen ring radius (CSS px). Past this the ring pulls out from
// the node so the dark core stays readable inside it at a wide framing.
const MIN_RING_PX = 7;
// The focus ring (exploration marker) sits this many radii out, clear OUTSIDE
// the FOCUS-emphasized orb (which scales to 1.5×): inner band edge ≈ 2×radius.
const FOCUS_RING_SCALE = 3.2;

const VERT = /* glsl */ `
  attribute vec3 aCenter;
  attribute float aScale;
  attribute float aPhase;
  attribute float aIntensity;
  attribute float aAppear;
  uniform float uViewH;  // viewport height in CSS px (0 = unknown → no growth)
  uniform float uMinPx;  // minimum on-screen ring RADIUS in CSS px (0 = off)
  varying vec2 vP;
  varying float vPhase;
  varying float vIntensity;
  varying float vAppear;
  varying float vBandPx; // on-screen ring radius, CSS px (0 when unknown)
  void main() {
    vP = position.xy * 2.0; // plane spans ±0.5 → vP in [-1,1]
    vPhase = aPhase;
    vIntensity = aIntensity;
    vAppear = aAppear;
    // Camera-facing: expand the quad in view space around the node's center.
    vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
    // On-screen radius of the ring BAND (it sits at r ≈ 0.74 of the quad half-
    // width), in CSS px. Pull the ring OUT to uMinPx when the camera is far
    // enough that it would collapse onto the node: the hollow — a dark core
    // inside a thin ring — is the whole read of a missing standard, and at a
    // wide framing the sub-pixel core used to vanish, leaving only the bright
    // ring, so the missing year became the brightest thing on screen. Growing
    // the ring keeps the core visible INSIDE it at any zoom.
    float depth = max(-mv.z, 0.0001);
    float bandPx = 0.74 * aScale * projectionMatrix[1][1] * uViewH * 0.5 / depth;
    float grow = (uMinPx > 0.0 && bandPx > 0.0) ? max(1.0, uMinPx / bandPx) : 1.0;
    vBandPx = uMinPx > 0.0 ? max(bandPx, uMinPx) : 0.0; // 0 = taper off (focus ring)
    mv.xy += position.xy * aScale * 2.0 * grow;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uMul;   // >1 in the Galaxy so the ring grazes the bloom
  uniform float uAlpha;
  uniform float uFadeSec;
  varying vec2 vP;
  varying float vPhase;
  varying float vIntensity;
  varying float vAppear;
  varying float vBandPx;
  void main() {
    float r = length(vP);
    // Wave fade-in: each ring rises over uFadeSec once its own appear time lands
    // (the missed set first, then depth-1, depth-2 … staged by the player's BFS).
    float appear = clamp((uTime - vAppear) / uFadeSec, 0.0, 1.0);
    // The ring breathes gently (radius, not brightness — a lighthouse, not a
    // strobe). Phase is per-node so a ringed grade shimmers like sequins. Fainter
    // (downstream) rings breathe less and sit thinner: intensity 1 reproduces
    // the original full ring exactly.
    float amp = 0.06 * mix(0.35, 1.0, vIntensity);
    float breath = 0.74 + amp * sin(uTime * 2.2 + vPhase);
    float w = mix(0.42, 1.0, vIntensity); // band half-width scale (thinner when faint)
    float ring = smoothstep(breath - 0.12 * w, breath - 0.045 * w, r)
               * (1.0 - smoothstep(breath + 0.045 * w, breath + 0.12 * w, r));
    if (ring < 0.003) discard;
    // Intensity drives BRIGHTNESS as well as alpha and width. With alpha alone
    // an additive HDR ring saturated at every intensity — a d = 0.2 downstream
    // node ringed as bright as the hole it descends from, which is the opposite
    // of what the cards say. The squared level ramp separates them plainly.
    float lvl = mix(0.22, 1.0, vIntensity * vIntensity);
    // Apparent-size taper: a ring pulled out to its minimum radius (a wide
    // framing, where the node itself is sub-pixel) also drops in weight, so the
    // wound reads as a small dark hollow rather than a bright dot in a field of
    // shrinking stars. Full weight once the ring is comfortably resolved.
    float sizeFade = vBandPx > 0.0 ? mix(0.55, 1.0, smoothstep(6.0, 18.0, vBandPx)) : 1.0;
    float a = ring * uAlpha * mix(0.20, 1.0, vIntensity) * appear * sizeFade;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor * uMul * lvl, a);
  }
`;

export interface BeaconsHandle {
  object: THREE.Mesh;
  /** The single focus-marker ring (a separate channel, own strand tint); add to
   *  the scene alongside `object`. */
  focusObject: THREE.Mesh;
  /**
   * Ring these targets. Each carries a node index, a 0..1 intensity (1 = today's
   * full ring, fainter downstream) and a hop (0 = missed, 1 = its successors …)
   * that stages the wave. null or [] clears all beacons. `instant` shows the full
   * set immediately (reduced motion — cut the motion, keep the information);
   * `delta` preserves the appear timing of rings already showing so only the
   * newly-added rings wave in (the interactive "subsequent dimmings" path).
   */
  setTargets(targets: BeaconTarget[] | null, opts?: { instant?: boolean; delta?: boolean }): void;
  /**
   * Mark the EXPLORATION-focused standard with a single strand-tinted ring so it
   * stays discernible among the full lit closure. `color` is a strand hex.
   * null clears it. Distinct channel from the damage beacons above — the machine
   * drives it, and never during a story (there, rings mean damage).
   */
  setFocusRing(nodeIndex: number | null, color?: number): void;
  /** True while any beacon OR the focus ring is armed (main gates update on it). */
  readonly active: boolean;
  /** Re-read the flagged nodes' live positions (pose morphs); cheap. */
  update(): void;
  setTime(t: number): void;
  /**
   * Viewport height in CSS px — the ring shader needs it to know its own
   * on-screen size, which is what keeps a hollow readable at a wide framing
   * (MIN_RING_PX). Call on resize; 0 (the default) disables the growth.
   */
  setViewportHeight(cssHeight: number): void;
  /** 0 Galaxy (gold, additive, HDR graze) | 1 Ringers (ink) | 2 Fidenza (ink). */
  setArtStyle(style: number): void;
  dispose(): void;
}

export function createBeacons(
  graph: GraphCore,
  nodes: NodesHandle,
  radii: Float32Array,
): BeaconsHandle {
  void graph; // node identity comes through `radii` + live positions now
  const base = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute("position", base.getAttribute("position"));

  const centers = new Float32Array(MAX * 3);
  const scales = new Float32Array(MAX);
  const phases = new Float32Array(MAX);
  const intensities = new Float32Array(MAX);
  const appears = new Float32Array(MAX);
  const centerAttr = new THREE.InstancedBufferAttribute(centers, 3);
  centerAttr.setUsage(THREE.DynamicDrawUsage);
  const scaleAttr = new THREE.InstancedBufferAttribute(scales, 1);
  const phaseAttr = new THREE.InstancedBufferAttribute(phases, 1);
  const intensityAttr = new THREE.InstancedBufferAttribute(intensities, 1);
  const appearAttr = new THREE.InstancedBufferAttribute(appears, 1);
  appearAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aCenter", centerAttr);
  geometry.setAttribute("aScale", scaleAttr);
  geometry.setAttribute("aPhase", phaseAttr);
  geometry.setAttribute("aIntensity", intensityAttr);
  geometry.setAttribute("aAppear", appearAttr);
  geometry.instanceCount = 0;

  const uniforms = {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(0xffd27a) }, // warm signal gold (Galaxy)
    // Sub-bloom (round 13): the damage ember never crosses the bloom threshold
    // (DESIGN.md — glow is reserved for healthy emphasis), and the ring is
    // damage too. At 1.6 the gold saturated and haloed, so a missing standard
    // out-luminated every healthy one; GALAXY_MUL keeps the full ring plainly
    // visible on the dark field and plainly dimmer than a lit standard.
    uMul: { value: GALAXY_MUL },
    uAlpha: { value: 0.9 },
    uFadeSec: { value: FADE_SEC },
    uViewH: { value: 0 },
    uMinPx: { value: MIN_RING_PX },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false, // a spotlight must be findable, never occluded
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3; // over nodes and edges
  mesh.name = "beacons";
  mesh.visible = false;

  // --- focus marker ring (a separate single-instance channel) --------------
  // Own material so it carries the focused standard's STRAND tint (a marker),
  // never the damage gold (a wound). Same breathing ring shader + reduced-motion
  // freeze; own uColor uniform; renders above the damage beacons.
  const fGeom = new THREE.InstancedBufferGeometry();
  fGeom.index = base.index;
  fGeom.setAttribute("position", base.getAttribute("position"));
  const fCenter = new Float32Array(3);
  const fCenterAttr = new THREE.InstancedBufferAttribute(fCenter, 3);
  fCenterAttr.setUsage(THREE.DynamicDrawUsage);
  const fScaleAttr = new THREE.InstancedBufferAttribute(new Float32Array([1]), 1);
  const fPhaseAttr = new THREE.InstancedBufferAttribute(new Float32Array([0]), 1);
  fGeom.setAttribute("aCenter", fCenterAttr);
  fGeom.setAttribute("aScale", fScaleAttr);
  fGeom.setAttribute("aPhase", fPhaseAttr);
  fGeom.setAttribute("aIntensity", new THREE.InstancedBufferAttribute(new Float32Array([1]), 1));
  fGeom.setAttribute("aAppear", new THREE.InstancedBufferAttribute(new Float32Array([APPEARED]), 1));
  fGeom.instanceCount = 0;
  const fUniforms = {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(0xffffff) },
    uMul: { value: 1.6 },
    uAlpha: { value: 0.95 },
    uFadeSec: { value: FADE_SEC },
    uViewH: { value: 0 },
    // The exploration marker keeps its exact shipped geometry (uMinPx 0 = no
    // screen-space growth). The minimum-radius rule is a DAMAGE-ring fix.
    uMinPx: { value: 0 },
  };
  const fMaterial = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: fUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const fMesh = new THREE.Mesh(fGeom, fMaterial);
  fMesh.frustumCulled = false;
  fMesh.renderOrder = 4; // above the damage beacons
  fMesh.name = "focus-ring";
  fMesh.visible = false;
  let focusIndex: number | null = null;

  let targetIdx: number[] = [];
  let time = 0;
  // Per-node appear time from the LAST setTargets, so a `delta` update can keep a
  // still-showing ring from re-popping while newly-added rings stage from scratch.
  let appearByIndex = new Map<number, number>();
  const v = new THREE.Vector3();

  function updateFocus(): void {
    if (focusIndex === null) return;
    nodes.getPosition(focusIndex, v);
    fCenter[0] = v.x;
    fCenter[1] = v.y;
    fCenter[2] = v.z;
    fCenterAttr.needsUpdate = true;
  }

  function update(): void {
    for (let k = 0; k < targetIdx.length; k++) {
      nodes.getPosition(targetIdx[k], v);
      centers[k * 3] = v.x;
      centers[k * 3 + 1] = v.y;
      centers[k * 3 + 2] = v.z;
    }
    centerAttr.needsUpdate = true;
    updateFocus();
  }

  return {
    object: mesh,
    focusObject: fMesh,
    get active() {
      return targetIdx.length > 0 || focusIndex !== null;
    },
    setFocusRing(nodeIndex, color) {
      if (nodeIndex === null) {
        focusIndex = null;
        fGeom.instanceCount = 0;
        fMesh.visible = false;
        return;
      }
      focusIndex = nodeIndex;
      fScaleAttr.array[0] = radii[nodeIndex] * FOCUS_RING_SCALE;
      fScaleAttr.needsUpdate = true;
      fPhaseAttr.array[0] = (nodeIndex * 2.399963) % (Math.PI * 2);
      fPhaseAttr.needsUpdate = true;
      if (color !== undefined) fUniforms.uColor.value.setHex(color);
      fGeom.instanceCount = 1;
      fMesh.visible = true;
      updateFocus();
    },
    setTargets(targets, opts) {
      const instant = opts?.instant === true;
      const delta = opts?.delta === true;
      const list = targets ? targets.slice(0, MAX) : [];
      const nextAppear = new Map<number, number>();
      targetIdx = new Array(list.length);
      for (let k = 0; k < list.length; k++) {
        const t = list[k];
        const i = t.index;
        targetIdx[k] = i;
        scales[k] = radii[i] * 2.3;
        phases[k] = (i * 2.399963) % (Math.PI * 2); // deterministic per node
        intensities[k] = t.intensity;
        let appearAt: number;
        if (instant) {
          appearAt = APPEARED;
        } else if (delta && appearByIndex.has(i)) {
          appearAt = appearByIndex.get(i)!; // already staged/shown — hold it steady
        } else {
          // Stage by wave hop, plus whatever extra delay the caller asks for
          // (a story scene passes its lit reveal's own per-node stagger, so a
          // ring never arrives before the standard it rings has turned on).
          appearAt = time + t.hop * HOP_SEC + (t.delaySec ?? 0);
        }
        appears[k] = appearAt;
        nextAppear.set(i, appearAt);
      }
      appearByIndex = nextAppear;
      scaleAttr.needsUpdate = true;
      phaseAttr.needsUpdate = true;
      intensityAttr.needsUpdate = true;
      appearAttr.needsUpdate = true;
      geometry.instanceCount = list.length;
      mesh.visible = list.length > 0;
      if (list.length) update();
    },
    update,
    setTime(t) {
      time = t;
      uniforms.uTime.value = t;
      fUniforms.uTime.value = t; // the focus ring breathes on the same clock
    },
    setViewportHeight(cssHeight) {
      uniforms.uViewH.value = cssHeight;
      fUniforms.uViewH.value = cssHeight;
    },
    setArtStyle(style) {
      // Galaxy: HDR-grazing gold, additive. Art styles: solid ink rings, normal
      // blending — a surveyor's mark on the print, not a glow.
      if (style === 0) {
        uniforms.uColor.value.setHex(0xffd27a);
        uniforms.uMul.value = GALAXY_MUL;
        uniforms.uAlpha.value = 0.9;
        material.blending = THREE.AdditiveBlending;
      } else {
        uniforms.uColor.value.setHex(style === 1 ? RINGERS.ink : FIDENZA.ink);
        uniforms.uMul.value = 1.0;
        uniforms.uAlpha.value = 0.85;
        material.blending = THREE.NormalBlending;
      }
      // The focus ring KEEPS its strand tint (set per focus); only its blend/mul
      // follow the skin — additive HDR graze in the Galaxy, flat ink on paper.
      fUniforms.uMul.value = style === 0 ? 1.6 : 1.0;
      fUniforms.uAlpha.value = style === 0 ? 0.95 : 0.9;
      fMaterial.blending = style === 0 ? THREE.AdditiveBlending : THREE.NormalBlending;
    },
    dispose() {
      geometry.dispose();
      base.dispose();
      material.dispose();
      fGeom.dispose();
      fMaterial.dispose();
    },
  };
}
