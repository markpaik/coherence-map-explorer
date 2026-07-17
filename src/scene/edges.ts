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

// Edge emphasis is the full 6-state scale (fractional values blend adjacent
// states, which lets the state machine ease hover in/out on the CPU):
//   0 dimmed | 1 rest | 2 hover | 3 focus | 4 chain | 5 related
// Per DESIGN's edge table the two focus looks differ by kind: a CHAIN prereq
// edge is bright with directional flow comets; a RELATED-to-focus edge is a
// dashed shimmer with NO flow. Per-state tables (indexed by the emphasis value)
// carry width / alpha / HDR color multiplier / flow / shimmer, so both looks —
// and every state in between — fall out of one blend.
// GLSL ES 3.00 (glslVersion: GLSL3) — the per-state tables below use float[]()
// array constructors and dynamic indexing, which GLSL 1.00 forbids.
const VERT = /* glsl */ `
  in float t;
  in float side;
  in vec3 aStart;
  in vec3 aCtrl;
  in vec3 aEnd;
  in vec3 aColorA;
  in vec3 aColorB;
  in float aKind;
  in float aEmphasis;
  in float aVisible;
  in float aDamage;

  uniform vec2 uViewport;   // drawing-buffer size in device px
  uniform float uPxRatio;   // device px per CSS px (capped at 2)

  out float vT;
  out vec3 vColor;
  out float vKind;
  out float vEmphasis;
  out float vVisible;
  out float vDamage;

  vec3 bezier(float s) {
    float u = 1.0 - s;
    return u * u * aStart + 2.0 * u * s * aCtrl + s * s * aEnd;
  }

  void main() {
    vec3 p = bezier(t);
    // Analytic tangent of the quadratic bezier (well-defined at both ends).
    vec3 tangent = 2.0 * (1.0 - t) * (aCtrl - aStart) + 2.0 * t * (aEnd - aCtrl);
    // Coincident endpoints (control == start == end) give a zero tangent;
    // normalize() would emit NaN and blow up the whole instanced draw.
    float tlen = length(tangent);
    vec3 tdir = tlen > 1e-6 ? tangent / tlen : vec3(1.0, 0.0, 0.0);

    vec4 clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    vec4 clipT = projectionMatrix * modelViewMatrix * vec4(p + tdir, 1.0);

    // Screen-space direction (device px), then its normal.
    vec2 dir = (clipT.xy / clipT.w - clip.xy / clip.w) * uViewport;
    float len = max(length(dir), 1e-6);
    vec2 normalPx = vec2(-dir.y, dir.x) / len;

    // Width (CSS px) per state — prereq widens more when hot/chain than related.
    float e = clamp(aEmphasis, 0.0, 5.0);
    // wR[5] (related-to-focus) widened 1.3 → 1.9: the 2026-07 audit found 37%
    // of focuses light a related standard whose only visible link is this
    // dash — it must read as an explanation, not a subtlety.
    float wP[6] = float[](1.2, 1.2, 2.5, 2.5, 2.5, 1.4);
    float wR[6] = float[](1.0, 1.0, 2.0, 2.0, 2.0, 1.9);
    int i0 = int(floor(e));
    int i1 = int(min(floor(e) + 1.0, 5.0));
    float f = fract(e);
    float width = mix(mix(wP[i0], wP[i1], f), mix(wR[i0], wR[i1], f), aKind);

    vec2 offsetNdc = normalPx * (width * uPxRatio * 0.5 * side) / (uViewport * 0.5);
    clip.xy += offsetNdc * clip.w;
    gl_Position = clip;

    vT = t;
    vColor = mix(aColorA, aColorB, t);
    vKind = aKind;
    vEmphasis = e;
    // Filtered-out edges (either endpoint hidden) fade toward a 0.06 ghost.
    vVisible = mix(0.06, 1.0, aVisible);
    vDamage = clamp(aDamage, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uFlow; // 1 = animate prereq comets, 0 = frozen (reduced motion)
  uniform float uStory; // 1 while a story plays: healthy edges lift toward the chain look

  in float vT;
  in vec3 vColor;
  in float vKind;
  in float vEmphasis;
  in float vVisible;
  in float vDamage;

  out vec4 fragColor;

  void main() {
    float e = vEmphasis;
    int i0 = int(floor(e));
    int i1 = int(min(floor(e) + 1.0, 5.0));
    float f = fract(e);

    // Per-state tables indexed by emphasis: dimmed/rest/hover/focus/chain/related.
    float aP[6]    = float[](0.06, 0.35, 0.9, 0.9, 0.9, 0.40);  // prereq alpha
    float aR[6]    = float[](0.04, 0.18, 0.7, 0.7, 0.7, 0.90);  // related alpha
    float mulP[6]  = float[](1.0,  1.0,  2.2, 2.2, 2.2, 1.40);  // prereq HDR mul
    float mulR[6]  = float[](1.0,  1.0,  1.3, 1.3, 1.3, 1.6);   // related HDR mul (5: audit)
    float flowP[6] = float[](0.0,  0.0,  1.0, 1.0, 1.0, 0.0);   // comet flow (prereq)
    float shimR[6] = float[](0.0,  0.0,  1.0, 0.0, 0.0, 1.0);   // shimmer (related)

    vec3 col = vColor;
    float alpha;

    // Story lift: while a story plays, edges that are LIT (visible) and healthy
    // rise toward the chain look (bright, flowing). Damage kills the lift
    // (gone by d≈0.7) and so does the ghost mask — an edge outside the story's
    // lit set stays a dark filament, no glow, no comets. max(), not ×, so an
    // already-chain-lit edge never double-brightens.
    float story = uStory
      * (1.0 - clamp(vDamage * 3.0, 0.0, 1.0))
      * clamp((vVisible - 0.06) / 0.94, 0.0, 1.0);

    if (vKind < 0.5) {
      // Prerequisite (directed): HDR-bright with directional comets when chain/hot.
      alpha = max(mix(aP[i0], aP[i1], f), 0.65 * story);
      col *= max(mix(mulP[i0], mulP[i1], f), 1.0 + 0.8 * story);
      float flow = max(mix(flowP[i0], flowP[i1], f), story);
      float fr = fract(vT * 6.0 - uTime * 0.5 * uFlow);
      float comet = pow(fr, 3.0);
      col += vColor * comet * 2.0 * flow;
    } else {
      // Related (undirected): in-shader dash, slow shimmer, NEVER a flow comet.
      float dash = step(0.5, fract(vT * 14.0));
      alpha = max(mix(aR[i0], aR[i1], f), 0.4 * story) * dash;
      float shim = max(mix(shimR[i0], shimR[i1], f), story);
      col *= mix(mulR[i0], mulR[i1], f) * (1.0 + 0.2 * sin(uTime * 2.0) * shim);
    }

    // Structural damage (stories): pull the edge toward a near-black ember
    // (sRGB #2a120c; the literal is LINEAR — the output transform re-brightens
    // it) and drop most of its alpha — a broken lineage goes dark, not merely
    // warm. Additive-blend safe: both moves subtract light.
    col = mix(col, vec3(0.0231, 0.0060, 0.0037), vDamage);
    alpha *= (1.0 - 0.55 * vDamage);

    // Soft edge across the ribbon is unnecessary at ~1px widths; keep it flat.
    fragColor = vec4(col, alpha * vVisible);
  }
`;

export interface EdgesHandle {
  mesh: THREE.Mesh;
  count: number;
  /** Target emphasis attribute; write via the state machine only. */
  emphasisAttr: THREE.InstancedBufferAttribute;
  /** Filter-visibility attribute (1 shown / 0 ghosted); write via filters only. */
  visibleAttr: THREE.InstancedBufferAttribute;
  /** Per-edge damage 0..1 (max of endpoints); write via setDamage only. */
  damageAttr: THREE.InstancedBufferAttribute;
  /** Story-mode lift (0 = off, 1 = healthy edges glow + flow); stories only. */
  setStory(amount: number): void;
  /**
   * Set per-edge damage (0..1, typically the max of the endpoint node damages).
   * The fragment cools the edge toward a dark ember and drops its alpha. null
   * clears every edge to 0 in one memset.
   */
  setDamage(values: Float32Array | null): void;
  /** Story-only visibility override (see nodes.setVisibleMask). null restores. */
  setVisibleMask(mask: Float32Array | null): void;
  /** Bezier endpoint/control attributes — the pose driver rewrites these each
   *  frame of a morph (aStart/aEnd from the endpoint nodes' current positions,
   *  aCtrl = lerp(c, c2, …)); it flips their needsUpdate itself. */
  startAttr: THREE.InstancedBufferAttribute;
  ctrlAttr: THREE.InstancedBufferAttribute;
  endAttr: THREE.InstancedBufferAttribute;
  setTime(t: number): void;
  setFlowEnabled(on: boolean): void;
  setViewport(widthPx: number, heightPx: number, pixelRatio: number): void;
  /**
   * Swap the render skin: 0 Galaxy (additive light ribbons, exactly the
   * shipped look) | 1 Ringers (taut pure-color strings, normal blending) |
   * 2 Fidenza (thick flat world-plane ribbons with striped caps). Emphasis /
   * visibility / damage attributes keep their meaning; art styles express
   * dimness as opacity.
   */
  setArtStyle(style: number): void;
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
  const visible = new Float32Array(count).fill(1); // filter visibility
  const damage = new Float32Array(count); // structural damage 0..1 (all 0 at rest)

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
  const visibleAttr = new THREE.InstancedBufferAttribute(visible, 1);
  visibleAttr.setUsage(THREE.DynamicDrawUsage);
  const damageAttr = new THREE.InstancedBufferAttribute(damage, 1);
  damageAttr.setUsage(THREE.DynamicDrawUsage);
  // Endpoint + control attributes are static at rest but rewritten every frame
  // during a pose morph — mark them dynamic so the driver's updates are cheap.
  const startAttr = new THREE.InstancedBufferAttribute(start, 3);
  const ctrlAttr = new THREE.InstancedBufferAttribute(ctrl, 3);
  const endAttr = new THREE.InstancedBufferAttribute(end, 3);
  startAttr.setUsage(THREE.DynamicDrawUsage);
  ctrlAttr.setUsage(THREE.DynamicDrawUsage);
  endAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aVisible", visibleAttr);
  geometry.setAttribute("aStart", startAttr);
  geometry.setAttribute("aCtrl", ctrlAttr);
  geometry.setAttribute("aEnd", endAttr);
  geometry.setAttribute("aColorA", new THREE.InstancedBufferAttribute(colorA, 3));
  geometry.setAttribute("aColorB", new THREE.InstancedBufferAttribute(colorB, 3));
  geometry.setAttribute("aKind", new THREE.InstancedBufferAttribute(kind, 1));
  geometry.setAttribute("aEmphasis", emphasisAttr);
  geometry.setAttribute("aDamage", damageAttr);

  const uniforms = {
    uViewport: { value: new THREE.Vector2(1, 1) },
    uPxRatio: { value: 1 },
    uTime: { value: 0 },
    uFlow: { value: 1 },
    uStory: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
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
    visibleAttr,
    damageAttr,
    startAttr,
    ctrlAttr,
    endAttr,
    setDamage(values) {
      if (values === null) {
        damage.fill(0);
      } else {
        damage.set(values);
      }
      damageAttr.needsUpdate = true;
    },
    setStory(amount) {
      uniforms.uStory.value = amount;
    },
    setVisibleMask(mask) {
      if (mask === null) {
        visible.fill(1);
      } else {
        visible.set(mask);
      }
      visibleAttr.needsUpdate = true;
    },
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
    setArtStyle(style) {
      void style; // Galaxy-only until the art-style build lands (agent-owned)
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
