// Beacon rings — the gap spotlight. A handful of holes among 480 standards is
// exactly the thing a dark field hides: a missed standard reads as near-black,
// which is honest but unfindable. Each beacon is a thin breathing ring drawn
// around a flagged node, camera-facing and depth-test-free, so the wounds are
// findable from any angle even when the chain passes THROUGH them (the
// swiss-cheese confusion: the connecting rungs were the dark ones, and the
// ladder read as broken instead of marked). Mark, round 7: "make it a point to
// light these up... a light-these-up/spotlight approach may be easier for the
// user to follow."
//
// One instanced draw call over a small pool (a full missed grade in the
// lose-a-year explorer is the largest set). Rings follow live node positions
// through pose morphs. Under reduced motion the breath freezes (setTime simply
// stops advancing) and the ring holds steady.

import * as THREE from "three";
import type { GraphCore } from "../data";
import type { NodesHandle } from "./nodes";
import { FIDENZA, RINGERS } from "./artstyle";

const MAX = 96; // largest missed set: one whole grade (~60 standards)

const VERT = /* glsl */ `
  attribute vec3 aCenter;
  attribute float aScale;
  attribute float aPhase;
  varying vec2 vP;
  varying float vPhase;
  void main() {
    vP = position.xy * 2.0; // plane spans ±0.5 → vP in [-1,1]
    vPhase = aPhase;
    // Camera-facing: expand the quad in view space around the node's center.
    vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
    mv.xy += position.xy * aScale * 2.0;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uMul;   // >1 in the Galaxy so the ring grazes the bloom
  uniform float uAlpha;
  varying vec2 vP;
  varying float vPhase;
  void main() {
    float r = length(vP);
    // The ring breathes gently (radius, not brightness — a lighthouse, not a
    // strobe). Phase is per-node so a ringed grade shimmers like sequins.
    float breath = 0.74 + 0.06 * sin(uTime * 2.2 + vPhase);
    float ring = smoothstep(breath - 0.12, breath - 0.045, r)
               * (1.0 - smoothstep(breath + 0.045, breath + 0.12, r));
    if (ring < 0.003) discard;
    gl_FragColor = vec4(uColor * uMul, ring * uAlpha);
  }
`;

export interface BeaconsHandle {
  object: THREE.Mesh;
  /** Ring these node indices; null or [] clears all beacons. */
  setTargets(indices: number[] | null): void;
  /** True while any beacon is armed (main gates the per-frame update on it). */
  readonly active: boolean;
  /** Re-read the flagged nodes' live positions (pose morphs); cheap. */
  update(): void;
  setTime(t: number): void;
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
  const centerAttr = new THREE.InstancedBufferAttribute(centers, 3);
  centerAttr.setUsage(THREE.DynamicDrawUsage);
  const scaleAttr = new THREE.InstancedBufferAttribute(scales, 1);
  const phaseAttr = new THREE.InstancedBufferAttribute(phases, 1);
  geometry.setAttribute("aCenter", centerAttr);
  geometry.setAttribute("aScale", scaleAttr);
  geometry.setAttribute("aPhase", phaseAttr);
  geometry.instanceCount = 0;

  const uniforms = {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(0xffd27a) }, // warm signal gold (Galaxy)
    uMul: { value: 1.6 },
    uAlpha: { value: 0.9 },
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

  let targets: number[] = [];
  const v = new THREE.Vector3();

  function update(): void {
    for (let k = 0; k < targets.length; k++) {
      nodes.getPosition(targets[k], v);
      centers[k * 3] = v.x;
      centers[k * 3 + 1] = v.y;
      centers[k * 3 + 2] = v.z;
    }
    centerAttr.needsUpdate = true;
  }

  return {
    object: mesh,
    get active() {
      return targets.length > 0;
    },
    setTargets(indices) {
      targets = indices ? indices.slice(0, MAX) : [];
      for (let k = 0; k < targets.length; k++) {
        const i = targets[k];
        scales[k] = radii[i] * 2.3;
        phases[k] = (i * 2.399963) % (Math.PI * 2); // deterministic per node
      }
      scaleAttr.needsUpdate = true;
      phaseAttr.needsUpdate = true;
      geometry.instanceCount = targets.length;
      mesh.visible = targets.length > 0;
      if (targets.length) update();
    },
    update,
    setTime(t) {
      uniforms.uTime.value = t;
    },
    setArtStyle(style) {
      // Galaxy: HDR-grazing gold, additive. Art styles: solid ink rings, normal
      // blending — a surveyor's mark on the print, not a glow.
      if (style === 0) {
        uniforms.uColor.value.setHex(0xffd27a);
        uniforms.uMul.value = 1.6;
        uniforms.uAlpha.value = 0.9;
        material.blending = THREE.AdditiveBlending;
      } else {
        uniforms.uColor.value.setHex(style === 1 ? RINGERS.ink : FIDENZA.ink);
        uniforms.uMul.value = 1.0;
        uniforms.uAlpha.value = 0.85;
        material.blending = THREE.NormalBlending;
      }
    },
    dispose() {
      geometry.dispose();
      base.dispose();
      material.dispose();
    },
  };
}
