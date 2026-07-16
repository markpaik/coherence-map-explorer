// All 899 edges as ONE instanced bezier-ribbon mesh (single draw call).
//
// Template geometry: a 24-segment strip (25 vertex pairs) carrying per-vertex
// t ∈ [0,1] and side ±1. Each instance supplies the quadratic bezier
// (aStart/aCtrl/aEnd, control points baked by the pipeline), endpoint strand
// colors (mixed along t in-shader), kind (0 prereq | 1 related) and emphasis.
//
// The vertex shader evaluates the bezier, then expands the ribbon in screen
// space so width is constant in CSS pixels (rest: 1.2px prereq / 1.0px
// related; hot: 2.5px). The fragment shader applies the DESIGN.md edge table:
// prereq flow comets gated to emphasis >= 2, related edges dashed with no flow.
//
// Blending choice: AdditiveBlending. Against the #050510 background it reads
// as light rather than paint, overlapping edges reinforce instead of muddying,
// and it makes draw order irrelevant (no transparent-sort artifacts).
// depthWrite off, depthTest on (edges still occlude behind opaque nodes).

import * as THREE from "three";
import type { GraphEdge, GraphNode } from "../data";
import { STRAND_COLORS } from "./palette";

const SEGMENTS = 24;

// Edge emphasis interpretation (fractional values blend adjacent states):
//   0 = dimmed, 1 = rest, >=2 = hot (hover/chain — bright, wide, flowing).
const VERT = /* glsl */ `
  attribute float t;
  attribute float side;
  attribute vec3 aStart;
  attribute vec3 aCtrl;
  attribute vec3 aEnd;
  attribute vec3 aColorA;
  attribute vec3 aColorB;
  attribute float aKind;
  attribute float aEmphasis;

  uniform vec2 uViewport;   // drawing-buffer size in device px
  uniform float uPxRatio;   // device px per CSS px (capped at 2)

  varying float vT;
  varying vec3 vColor;
  varying float vKind;
  varying float vEmphasis;

  vec3 bezier(float s) {
    float u = 1.0 - s;
    return u * u * aStart + 2.0 * u * s * aCtrl + s * s * aEnd;
  }

  void main() {
    vec3 p = bezier(t);
    // Analytic tangent of the quadratic bezier (well-defined at both ends).
    vec3 tangent = 2.0 * (1.0 - t) * (aCtrl - aStart) + 2.0 * t * (aEnd - aCtrl);

    vec4 clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    vec4 clipT = projectionMatrix * modelViewMatrix * vec4(p + normalize(tangent), 1.0);

    // Screen-space direction (device px), then its normal.
    vec2 dir = (clipT.xy / clipT.w - clip.xy / clip.w) * uViewport;
    float len = max(length(dir), 1e-6);
    vec2 normalPx = vec2(-dir.y, dir.x) / len;

    // Width in CSS px from kind + emphasis: rest 1.2 prereq / 1.0 related, hot 2.5.
    float e = clamp(aEmphasis, 0.0, 2.0);
    float restWidth = mix(1.2, 1.0, aKind);
    float width = mix(restWidth, 2.5, clamp(e - 1.0, 0.0, 1.0));

    vec2 offsetNdc = normalPx * (width * uPxRatio * 0.5 * side) / (uViewport * 0.5);
    clip.xy += offsetNdc * clip.w;
    gl_Position = clip;

    vT = t;
    vColor = mix(aColorA, aColorB, t);
    vKind = aKind;
    vEmphasis = e;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uFlow; // 1 = animate prereq comets, 0 = frozen (reduced motion)

  varying float vT;
  varying vec3 vColor;
  varying float vKind;
  varying float vEmphasis;

  void main() {
    float e = vEmphasis;
    float toRest = clamp(e, 0.0, 1.0);        // 0 dimmed -> 1 rest
    float toHot  = clamp(e - 1.0, 0.0, 1.0);  // 0 rest   -> 1 hot

    vec3 col = vColor;
    float alpha;

    if (vKind < 0.5) {
      // Prerequisite: 0.06 dimmed / 0.35 rest / 0.9 hot, color x2.2 HDR when hot.
      alpha = mix(mix(0.06, 0.35, toRest), 0.9, toHot);
      col *= mix(1.0, 2.2, toHot);
      // Flow pulses shaped to soft comets (ramp to a bright head, sharp falloff),
      // flowing prereq -> dependent; gated to emphasis >= 2 only.
      float f = fract(vT * 6.0 - uTime * 0.5 * uFlow);
      float comet = pow(f, 3.0);
      col += vColor * comet * 2.0 * toHot;
    } else {
      // Related: in-shader dash, no directional flow.
      float dash = step(0.5, fract(vT * 14.0));
      alpha = mix(mix(0.04, 0.18, toRest), 0.9, toHot) * dash;
      // Slow non-directional shimmer when hot.
      col *= mix(1.0, 1.3 + 0.2 * sin(uTime * 2.0), toHot);
    }

    // Soft edge across the ribbon is unnecessary at ~1px widths; keep it flat.
    gl_FragColor = vec4(col, alpha);
  }
`;

export interface EdgesHandle {
  mesh: THREE.Mesh;
  count: number;
  /** Target emphasis attribute; write via the state machine only. */
  emphasisAttr: THREE.InstancedBufferAttribute;
  setTime(t: number): void;
  setFlowEnabled(on: boolean): void;
  setViewport(widthPx: number, heightPx: number, pixelRatio: number): void;
  dispose(): void;
}

export function createEdges(edges: GraphEdge[], nodesById: Map<string, GraphNode>): EdgesHandle {
  const count = edges.length;

  // -- template strip -----------------------------------------------------
  const rows = SEGMENTS + 1;
  const tArr = new Float32Array(rows * 2);
  const sideArr = new Float32Array(rows * 2);
  for (let i = 0; i < rows; i++) {
    const t = i / SEGMENTS;
    tArr[i * 2] = t;
    tArr[i * 2 + 1] = t;
    sideArr[i * 2] = -1;
    sideArr[i * 2 + 1] = 1;
  }
  const index: number[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.instanceCount = count;
  // Position attribute is unused (bezier computed in-shader) but three needs
  // one to size the draw range.
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(rows * 2 * 3), 3));
  geometry.setAttribute("t", new THREE.BufferAttribute(tArr, 1));
  geometry.setAttribute("side", new THREE.BufferAttribute(sideArr, 1));
  geometry.setIndex(index);

  // -- per-instance data ----------------------------------------------------
  const start = new Float32Array(count * 3);
  const ctrl = new Float32Array(count * 3);
  const end = new Float32Array(count * 3);
  const colorA = new Float32Array(count * 3);
  const colorB = new Float32Array(count * 3);
  const kind = new Float32Array(count);
  const emphasis = new Float32Array(count).fill(1); // rest

  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const e = edges[i];
    const s = nodesById.get(e.s);
    const t = nodesById.get(e.t);
    if (!s || !t) throw new Error(`Edge references unknown node: ${e.s} -> ${e.t}`);
    start.set(s.pos, i * 3);
    ctrl.set(e.c, i * 3);
    end.set(t.pos, i * 3);
    c.setHex(STRAND_COLORS[s.strand]);
    colorA.set([c.r, c.g, c.b], i * 3);
    c.setHex(STRAND_COLORS[t.strand]);
    colorB.set([c.r, c.g, c.b], i * 3);
    kind[i] = e.k;
  }

  const emphasisAttr = new THREE.InstancedBufferAttribute(emphasis, 1);
  emphasisAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aStart", new THREE.InstancedBufferAttribute(start, 3));
  geometry.setAttribute("aCtrl", new THREE.InstancedBufferAttribute(ctrl, 3));
  geometry.setAttribute("aEnd", new THREE.InstancedBufferAttribute(end, 3));
  geometry.setAttribute("aColorA", new THREE.InstancedBufferAttribute(colorA, 3));
  geometry.setAttribute("aColorB", new THREE.InstancedBufferAttribute(colorB, 3));
  geometry.setAttribute("aKind", new THREE.InstancedBufferAttribute(kind, 1));
  geometry.setAttribute("aEmphasis", emphasisAttr);

  const uniforms = {
    uViewport: { value: new THREE.Vector2(1, 1) },
    uPxRatio: { value: 1 },
    uTime: { value: 0 },
    uFlow: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = "edges";
  mesh.renderOrder = -1; // draw before other transparents (stars, etches)

  return {
    mesh,
    count,
    emphasisAttr,
    setTime(t) {
      uniforms.uTime.value = t;
    },
    setFlowEnabled(on) {
      uniforms.uFlow.value = on ? 1 : 0;
    },
    setViewport(widthPx, heightPx, pixelRatio) {
      uniforms.uViewport.value.set(widthPx, heightPx);
      uniforms.uPxRatio.value = pixelRatio;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
