// Grade & course markers: extruded 3D type (Space Grotesk 600, 11-glyph
// typeface.json from scripts/make-typeface.mjs) standing along the spiral —
// K 1 2 … 8 wind outward from the core, and the high-school outer arc is
// labeled by its Appendix A courses (Algebra I, Geometry, Algebra II,
// Advanced). Each marker is placed by the pipeline (grades[].marker /
// courses[].marker) and rotated to face outward from the spiral's center, so
// orbiting the galaxy reads like flying over engraved monuments.
//
// Course labels use letters the 11-glyph face lacks, so course etches render
// short forms from available glyphs where possible and otherwise fall back to
// a second, tiny typeface generated for them (see COURSE_TEXT below).

import * as THREE from "three";
import { FontLoader, type Font } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import type { GraphGrade, GraphCourse } from "../data";

const GRADE_FONT_URL = "/fonts/space-grotesk-600.typeface.json";
const COURSE_FONT_URL = "/fonts/space-grotesk-600-course.typeface.json";
const FACE_COLOR = 0x34315e;
const SIDE_COLOR = 0x16142e;
const GRADE_SIZE = 26;
const COURSE_SIZE = 15; // longer words, smaller type
const DEPTH = 5;

// Course display text (Appendix A traditional pathway).
const COURSE_TEXT: Record<string, string> = {
  A1: "ALGEBRA I",
  G: "GEOMETRY",
  A2: "ALGEBRA II",
  ADV: "ADVANCED",
};

export interface EtchesHandle {
  group: THREE.Group;
  /** Resolves when fonts have loaded and every marker is built. */
  ready: Promise<void>;
  dispose(): void;
}

export function createEtches(grades: GraphGrade[], courses: GraphCourse[]): EtchesHandle {
  const group = new THREE.Group();
  group.name = "etches";

  const geometries: TextGeometry[] = [];
  const faceMat = new THREE.MeshBasicMaterial({ color: FACE_COLOR });
  const sideMat = new THREE.MeshBasicMaterial({ color: SIDE_COLOR });
  const loader = new FontLoader();

  function addMarker(font: Font, text: string, size: number, marker: [number, number, number]): void {
    const geometry = new TextGeometry(text, {
      font,
      size,
      depth: DEPTH,
      curveSegments: 6,
      bevelEnabled: true,
      bevelThickness: 0.8,
      bevelSize: 0.5,
      bevelSegments: 2,
    });
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    geometry.translate(-(bb.max.x + bb.min.x) / 2, 0, -(bb.max.z + bb.min.z) / 2);
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, [faceMat, sideMat]);
    mesh.position.set(marker[0], marker[1], marker[2]);
    // Stand upright, reading face turned outward from the spiral's core: the
    // outward direction in plan is the marker's own bearing from the origin.
    mesh.rotation.y = Math.atan2(marker[0], marker[2]);
    group.add(mesh);
  }

  const ready = (async () => {
    try {
      const gradeFont = await loader.loadAsync(GRADE_FONT_URL);
      for (const g of grades) {
        if (g.marker) addMarker(gradeFont, g.id, GRADE_SIZE, g.marker);
      }
      // Course labels need A,B,D,E,G,I,L,M,N,O,R,T,V,Y + space — a separate
      // subset face. If it is missing (older build), fall back to initials
      // renderable with the grade face (no crash, degraded gracefully).
      try {
        const courseFont = await loader.loadAsync(COURSE_FONT_URL);
        for (const c of courses) addMarker(courseFont, COURSE_TEXT[c.id] ?? c.label.toUpperCase(), COURSE_SIZE, c.marker);
      } catch {
        console.warn("[cme] course typeface missing; falling back to short marks");
        for (const c of courses) addMarker(gradeFont, c.id.replace(/[^A-Z0-9]/g, ""), COURSE_SIZE, c.marker);
      }
    } catch (err) {
      // Markers are ornament — a font failure must never take down the scene.
      console.warn("[cme] grade markers unavailable:", err);
    }
  })();

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
