// Family filaments — the thin structural tether from each parent standard to
// its code-derived sub-standards (children[]). This is the F-IF.C.7 fix: a
// parent like F-IF.C.7 owns no prerequisite edges of its own (its .a–.e carry
// the connections), so on the map it read as a lonely dot. The filament makes
// the family membership visible WITHOUT pretending to be a prerequisite arc.
//
// ONE THREE.LineSegments (single draw call) over the 116 parent→child links.
// Style is deliberately unlike a prereq ribbon: a plain straight hairline, no
// bow, no flow comet, low-opacity cool violet-grey. Filaments are annotation,
// not data — but they BRIGHTEN when both of their endpoints are emphasized
// (focus/chain/related/hover): the 2026-07 legibility audit found that every
// rolled-up parent focus (all 13 edgeless parents, e.g. 4.NF.B.3, 3.MD.C.7)
// lit a neighborhood whose ONLY geometric link to the clicked dot was an
// unlit filament, so the lit region read as unexplained. The lit filament is
// that missing visual hand-off. They still never take structural damage.
// Endpoints are read from the nodes' live instance positions, so they glide
// through a pose morph — and they ghost with visibility: if either endpoint
// is filtered out or outside a story's lit set (aVisible = 0), the segment
// collapses to nothing.

import * as THREE from "three";
import type { GraphCore } from "../data";
import type { NodesHandle } from "./nodes";

const DIM = new THREE.Color(0x34315e).multiplyScalar(0.22); // baked hairline
const LIT = new THREE.Color(0x9a94d8).multiplyScalar(0.85); // both ends lit

// Art-style pairs: a faint ink/teal annotation ON the field (no glow — normal
// blending, half opacity). The dim state is a whisper; the lit state is the
// solid ink/teal for the same "missing hand-off" cue as the galaxy hairline.
const DIM_RING = new THREE.Color(0x1a1712).multiplyScalar(0.25);
const LIT_RING = new THREE.Color(0x1a1712);
const DIM_FID = new THREE.Color(0x14332c).multiplyScalar(0.3);
const LIT_FID = new THREE.Color(0x14332c);

export interface FilamentsHandle {
  /** The single LineSegments draw call — add it to the scene. */
  object: THREE.LineSegments;
  /**
   * Recompute every segment's endpoints (from the nodes' current positions),
   * ghost state (from aVisible), and lit state (from aEmphasis — a filament
   * brightens when BOTH its endpoints are emphasized) in one pass. Cheap at
   * 116 segments; call it each frame the scene renders.
   */
  update(): void;
  /**
   * Swap the render skin: 0 Galaxy (additive violet hairline) | 1 Ringers
   * (faint ink on cream, normal blending) | 2 Fidenza (deep teal-ink).
   */
  setArtStyle(style: number): void;
  dispose(): void;
}

export function createFilaments(graph: GraphCore, nodes: NodesHandle): FilamentsHandle {
  const indexById = new Map<string, number>();
  graph.nodes.forEach((n, i) => indexById.set(n.id, i));

  // Parent→child index pairs (one segment each). 40 parents, 116 child links.
  const pairs: Array<[number, number]> = [];
  graph.nodes.forEach((n, i) => {
    if (!n.children) return;
    for (const cid of n.children) {
      const ci = indexById.get(cid);
      if (ci !== undefined) pairs.push([i, ci]);
    }
  });

  const segCount = pairs.length;
  const positions = new Float32Array(segCount * 6); // 2 verts × xyz per segment
  const colors = new Float32Array(segCount * 6); // 2 verts × rgb per segment
  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", posAttr);
  const colAttr = new THREE.BufferAttribute(colors, 3);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("color", colAttr);

  // Additive + vertex colors: the dim state stays the familiar hairline; the
  // lit state glows like a soft lavender thread without needing opacity swaps.
  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const object = new THREE.LineSegments(geometry, material);
  object.frustumCulled = false; // always drawn; positions move every morph frame
  object.name = "filaments";
  object.renderOrder = -2; // behind the edge ribbons (which sit at -1)

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const emphasis = nodes.emphasisAttr.array as Float32Array;

  // Active render skin; picks the DIM/LIT pair each frame (colors recompute
  // per frame anyway, so no rebuild is needed on a style switch).
  let style = 0;

  function update(): void {
    const dim = style === 1 ? DIM_RING : style === 2 ? DIM_FID : DIM;
    const lit = style === 1 ? LIT_RING : style === 2 ? LIT_FID : LIT;
    for (let s = 0; s < segCount; s++) {
      const pi = pairs[s][0];
      const ci = pairs[s][1];
      const off = s * 6;
      nodes.getPosition(pi, a);
      if (nodes.isVisible(pi) && nodes.isVisible(ci)) {
        nodes.getPosition(ci, b);
      } else {
        // Ghost: collapse to a degenerate (zero-length) segment — renders nothing.
        b.copy(a);
      }
      positions[off] = a.x;
      positions[off + 1] = a.y;
      positions[off + 2] = a.z;
      positions[off + 3] = b.x;
      positions[off + 4] = b.y;
      positions[off + 5] = b.z;
      // Lit when BOTH endpoints are emphasized (≥ 2 = hover/focus/chain/related;
      // fractional eases blend the color with them).
      const e = Math.min(emphasis[pi], emphasis[ci]);
      const k = Math.min(1, Math.max(0, e - 1));
      const r = dim.r + (lit.r - dim.r) * k;
      const g = dim.g + (lit.g - dim.g) * k;
      const bl = dim.b + (lit.b - dim.b) * k;
      colors[off] = r;
      colors[off + 1] = g;
      colors[off + 2] = bl;
      colors[off + 3] = r;
      colors[off + 4] = g;
      colors[off + 5] = bl;
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }

  update();

  return {
    object,
    update,
    setArtStyle(s) {
      // Galaxy: additive violet hairline (opacity 1). Paper styles: faint ink /
      // teal annotation with normal blending at half opacity — no glow. The
      // active DIM/LIT pair is chosen in update(), which reruns next frame.
      style = s;
      if (s === 0) {
        material.blending = THREE.AdditiveBlending;
        material.opacity = 1;
      } else {
        material.blending = THREE.NormalBlending;
        material.opacity = 0.5;
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
