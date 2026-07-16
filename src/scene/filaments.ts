// Family filaments — the thin structural tether from each parent standard to
// its code-derived sub-standards (children[]). This is the F-IF.C.7 fix: a
// parent like F-IF.C.7 owns no prerequisite edges of its own (its .a–.e carry
// the connections), so on the map it read as a lonely dot. The filament makes
// the family membership visible WITHOUT pretending to be a prerequisite arc.
//
// ONE THREE.LineSegments (single draw call) over the 116 parent→child links.
// Style is deliberately unlike a prereq ribbon: a plain straight hairline, no
// bow, no flow comet, low-opacity cool violet-grey. Filaments are annotation,
// not data: they render in BOTH poses always and never take structural damage
// dimming (they are constant). They DO follow the geometry — endpoints are read
// from the nodes' live instance positions, so they glide through a pose morph —
// and they ghost with visibility: if either endpoint is filtered out or outside
// a story spotlight (aVisible = 0), the segment collapses to nothing.

import * as THREE from "three";
import type { GraphCore } from "../data";
import type { NodesHandle } from "./nodes";

const FILAMENT_COLOR = 0x34315e; // cool violet-grey; unmistakably not a strand hue

export interface FilamentsHandle {
  /** The single LineSegments draw call — add it to the scene. */
  object: THREE.LineSegments;
  /**
   * Recompute every segment's endpoints (from the nodes' current positions) and
   * ghost state (from aVisible) in one pass. Cheap at 116 segments; call it each
   * frame the scene renders so filaments track pose morphs, filters, and story
   * spotlights without threading a callback through every mutation site.
   */
  update(): void;
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
  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", posAttr);

  const material = new THREE.LineBasicMaterial({
    color: FILAMENT_COLOR,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });

  const object = new THREE.LineSegments(geometry, material);
  object.frustumCulled = false; // always drawn; positions move every morph frame
  object.name = "filaments";
  object.renderOrder = -2; // behind the edge ribbons (which sit at -1)

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  function update(): void {
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
    }
    posAttr.needsUpdate = true;
  }

  update();

  return {
    object,
    update,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
