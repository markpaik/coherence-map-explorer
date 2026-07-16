// Grade markers: K 1 2 … 8 HS as extruded 3D type (Space Grotesk 600,
// converted to a minimal 11-glyph typeface.json by scripts/make-typeface.mjs).
// Real geometry, fixed in world space below each grade band — orbiting past
// them reads like flying over monuments, not sprites. Two-tone materials fake
// directional light without adding a light rig: faces carry a lifted indigo,
// extrusion sides fall into shadow.

import * as THREE from "three";
import { FontLoader, type Font } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import type { GraphGrade } from "../data";

const FONT_URL = "/fonts/space-grotesk-600.typeface.json";
const FACE_COLOR = 0x34315e; // lifted indigo — reads over #050510 without glowing
const SIDE_COLOR = 0x16142e; // extrusion walls fall toward the background
const FONT_SIZE = 26;
const DEPTH = 5;
const ETCH_Y = -240; // below the whole cloud (data y-min ≈ -218)

export interface EtchesHandle {
  group: THREE.Group;
  /** Resolves when the font has loaded and every marker is built. */
  ready: Promise<void>;
  dispose(): void;
}

export function createEtches(grades: GraphGrade[], cameraAzimuth: number): EtchesHandle {
  const group = new THREE.Group();
  group.name = "etches";

  const geometries: TextGeometry[] = [];
  const faceMat = new THREE.MeshBasicMaterial({ color: FACE_COLOR });
  const sideMat = new THREE.MeshBasicMaterial({ color: SIDE_COLOR });

  const ready = new FontLoader()
    .loadAsync(FONT_URL)
    .then((font: Font) => {
      for (const grade of grades) {
        const geometry = new TextGeometry(grade.id, {
          font,
          size: FONT_SIZE,
          depth: DEPTH,
          curveSegments: 6,
          bevelEnabled: true,
          bevelThickness: 0.8,
          bevelSize: 0.5,
          bevelSegments: 2,
        });
        geometry.computeBoundingBox();
        const bb = geometry.boundingBox!;
        // Center on the band's x-midpoint; extrusion straddles z = 0.
        geometry.translate(
          -(bb.max.x + bb.min.x) / 2,
          0,
          -(bb.max.z + bb.min.z) / 2,
        );
        geometries.push(geometry);

        // ExtrudeGeometry material groups: 0 = front/back faces, 1 = sides.
        const mesh = new THREE.Mesh(geometry, [faceMat, sideMat]);
        mesh.position.set((grade.x0 + grade.x1) / 2, ETCH_Y, 0);
        // Face the initial camera azimuth once, then stay put (monument).
        mesh.rotation.y = cameraAzimuth;
        group.add(mesh);
      }
    })
    .catch((err: unknown) => {
      // Markers are ornament — a font failure must never take down the scene.
      console.warn("[cme] grade markers unavailable:", err);
    });

  return {
    group,
    ready,
    dispose() {
      for (const g of geometries) g.dispose();
      faceMat.dispose();
      sideMat.dispose();
    },
  };
}
