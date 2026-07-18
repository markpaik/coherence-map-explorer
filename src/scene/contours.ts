// Elevation isolines for the Ascent (pose 1). The Ascent stacks every standard
// by dependency depth — foundations at the base, the deepest chains at the
// summit — so the model reads as a massif rising out of the field. What it
// lacks is an ALTITUDE VOCABULARY: nothing tells the eye "this height is depth
// 10, that one depth 20." These contours supply it, the way a topographic map
// draws a thin line at every elevation and a brighter one at every fifth
// (index contours).
//
// One faint horizontal line per depth level, at that level's real y (the
// median of the nodes' pos2 y — every node at a depth shares y = depth·13−90,
// so the median hugs the actual massif rather than a layout constant), running
// across the level's x-extent (padded a little) at the level's median z so the
// line sits in the massif's depth-centre. Every fifth level is an index
// contour, drawn a touch brighter. Everything is very faint (base ≈0.05, index
// ≈0.09) so the dark story baseline is never compromised, and the geometry is
// STATIC — the evolving field nudges the nodes, but a reference grid that
// drifted with them would stop being a reference. The lines are the fixed ruler
// the massif is measured against; they hold still on purpose.
//
// Visibility follows the pose: full at the Ascent (pose 1), gone by 0.5 and 1.5,
// so no other pose ever shows them. Reduced-motion safe (nothing animates).

import * as THREE from "three";
import type { GraphNode } from "../data";
import { RINGERS, FIDENZA } from "./artstyle";

const PAD = 20; // world units the isoline overshoots the level's x-extent each side

// Per-style line ink. Galaxy: a cool drafting white on the dark field. Ringers:
// graphite on cream. Fidenza: cream on teal. All read as a faint ruled line at
// the module's low opacities — never a glow (normal blending, colors < 1).
const INK: readonly number[] = [0xaec4e6, RINGERS.ink, 0xe8e0cd];

export interface ContourLevel {
  /** Dependency-chain depth this isoline marks. */
  depth: number;
  /** Elevation: the median pos2 y of the nodes at this depth. */
  y: number;
  /** The median pos2 z of the nodes at this depth (the line hugs the massif). */
  z: number;
  /** Min / max pos2 x at this depth (the raw x-extent, before PAD). */
  x0: number;
  x1: number;
  /** Nodes at this depth. */
  count: number;
  /** True every fifth level (depth % 5 === 0) — an index contour, drawn brighter. */
  index: boolean;
}

// Pure: partition the nodes by dependency depth and derive each level's isoline
// from the ACTUAL pos2 coordinates (median y/z, raw x-span). Exported for the
// pipeline test — the level count, elevations, and index cadence are asserted
// against the shipped graph, not a re-derivation.
export function deriveContourLevels(nodes: GraphNode[]): ContourLevel[] {
  const byDepth = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const arr = byDepth.get(n.depth);
    if (arr) arr.push(n);
    else byDepth.set(n.depth, [n]);
  }
  const median = (a: number[]): number => {
    const s = [...a].sort((p, q) => p - q);
    return s[Math.floor(s.length / 2)];
  };
  const levels: ContourLevel[] = [];
  for (const [depth, arr] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    let x0 = Infinity;
    let x1 = -Infinity;
    const ys: number[] = [];
    const zs: number[] = [];
    for (const n of arr) {
      const x = n.pos2[0];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      ys.push(n.pos2[1]);
      zs.push(n.pos2[2]);
    }
    levels.push({
      depth,
      y: median(ys),
      z: median(zs),
      x0,
      x1,
      count: arr.length,
      index: depth % 5 === 0,
    });
  }
  return levels;
}

export interface ContoursHandle {
  object: THREE.LineSegments;
  /** Drive the pose fade: full at the Ascent (1), gone by 0.5 / 1.5. */
  update(pose: number): void;
  /** Swap the line ink for the active art style (0 Galaxy | 1 Ringers | 2 Fidenza). */
  setArtStyle(style: number): void;
  dispose(): void;
}

export function createContours(nodes: GraphNode[]): ContoursHandle {
  const levels = deriveContourLevels(nodes);
  const L = levels.length;

  // Two vertices per level (the segment endpoints). A per-vertex weight (0 base
  // line / 1 index line) picks the opacity in the fragment.
  const positions = new Float32Array(L * 2 * 3);
  const weights = new Float32Array(L * 2);
  levels.forEach((lv, k) => {
    const a = k * 2;
    const b = a + 1;
    positions[a * 3] = lv.x0 - PAD;
    positions[a * 3 + 1] = lv.y;
    positions[a * 3 + 2] = lv.z;
    positions[b * 3] = lv.x1 + PAD;
    positions[b * 3 + 1] = lv.y;
    positions[b * 3 + 2] = lv.z;
    const w = lv.index ? 1 : 0;
    weights[a] = w;
    weights[b] = w;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aWeight", new THREE.BufferAttribute(weights, 1));

  const uniforms = {
    uColor: { value: new THREE.Color(INK[0]) },
    uVisible: { value: 0 }, // pose fade (0 hidden … 1 full at the Ascent)
    uBase: { value: 0.08 },
    uIndex: { value: 0.14 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    vertexShader: /* glsl */ `
      attribute float aWeight;
      varying float vWeight;
      void main() {
        vWeight = aWeight;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uColor;
      uniform float uVisible;
      uniform float uBase;
      uniform float uIndex;
      varying float vWeight;
      void main() {
        float op = mix(uBase, uIndex, vWeight) * uVisible;
        if (op < 0.001) discard;
        gl_FragColor = vec4(uColor, op);
      }
    `,
  });

  const object = new THREE.LineSegments(geometry, material);
  object.frustumCulled = false;
  object.name = "contours";
  object.renderOrder = -2; // beneath nodes/edges (edges are -1)
  object.visible = false;

  const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

  return {
    object,
    update(pose) {
      const vis = clamp01(1 - Math.abs(pose - 1) / 0.5);
      if (vis <= 0.001) {
        if (object.visible) object.visible = false;
        return;
      }
      object.visible = true;
      uniforms.uVisible.value = vis;
    },
    setArtStyle(style) {
      uniforms.uColor.value.setHex(INK[style] ?? INK[0]);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
