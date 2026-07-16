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
// Sized so the longest same-rank neighbors (GEOMETRY / ADVANCED) clear each
// other over their narrow arcs: at 11 units their half-widths sum to ~60 vs
// ~74 units of center separation. 15 was measurably too wide (labels collided
// from oblique angles).
const COURSE_SIZE = 11;
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
  /**
   * Slide every marker between its two poses: 0 = constellation (marker),
   * 1 = the Ascent (marker2). The pose driver calls this with the global eased
   * progress every morph frame (no per-marker stagger). Markers built later
   * (async font load) adopt the current pose so they never pop in at pose A.
   */
  setPose(p: number): void;
  dispose(): void;
}

export function createEtches(
  grades: GraphGrade[],
  courses: GraphCourse[],
  cameraAzimuth: number,
): EtchesHandle {
  const group = new THREE.Group();
  group.name = "etches";

  const geometries: TextGeometry[] = [];
  const faceMat = new THREE.MeshBasicMaterial({ color: FACE_COLOR });
  const sideMat = new THREE.MeshBasicMaterial({ color: SIDE_COLOR });
  const loader = new FontLoader();

  // Each marker remembers both pose positions so setPose can lerp it. The z of
  // both poses is 0, so the outward-facing yaw is pose-invariant (fixed once).
  interface Marker {
    mesh: THREE.Mesh;
    a: [number, number, number];
    b: [number, number, number];
  }
  const markers: Marker[] = [];
  let pose = 0; // 0 = constellation, 1 = the Ascent

  function addMarker(
    font: Font,
    text: string,
    size: number,
    marker: [number, number, number],
    marker2: [number, number, number] | undefined,
  ): void {
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
    const a = marker;
    const b = marker2 ?? marker; // no pose-B target ⇒ stays put
    // Adopt the current pose immediately (markers may load mid-morph or while
    // already in the Ascent) so nothing pops in at the wrong place.
    mesh.position.set(
      a[0] + (b[0] - a[0]) * pose,
      a[1] + (b[1] - a[1]) * pose,
      a[2] + (b[2] - a[2]) * pose,
    );
    // Stand upright, reading face turned to the camera's home azimuth. The
    // markers line the ground plane in both poses, so one fixed facing keeps
    // every label legible; per-marker radial "face outward" logic mirrored
    // the text on the far side (a spiral-era leftover caught at the art gate).
    mesh.rotation.y = cameraAzimuth;
    group.add(mesh);
    markers.push({ mesh, a, b });
  }

  const ready = (async () => {
    try {
      const gradeFont = await loader.loadAsync(GRADE_FONT_URL);
      for (const g of grades) {
        if (g.marker) addMarker(gradeFont, g.id, GRADE_SIZE, g.marker, g.marker2);
      }
      // Course labels need A,B,D,E,G,I,L,M,N,O,R,T,V,Y + space — a separate
      // subset face. If it is missing (older build), fall back to initials
      // renderable with the grade face (no crash, degraded gracefully).
      try {
        const courseFont = await loader.loadAsync(COURSE_FONT_URL);
        for (const c of courses)
          addMarker(courseFont, COURSE_TEXT[c.id] ?? c.label.toUpperCase(), COURSE_SIZE, c.marker, c.marker2);
      } catch {
        console.warn("[cme] course typeface missing; falling back to short marks");
        for (const c of courses)
          addMarker(gradeFont, c.id.replace(/[^A-Z0-9]/g, ""), COURSE_SIZE, c.marker, c.marker2);
      }
    } catch (err) {
      // Markers are ornament — a font failure must never take down the scene.
      console.warn("[cme] grade markers unavailable:", err);
    }
  })();

  return {
    group,
    ready,
    setPose(p) {
      pose = p;
      for (const { mesh, a, b } of markers) {
        mesh.position.set(
          a[0] + (b[0] - a[0]) * p,
          a[1] + (b[1] - a[1]) * p,
          a[2] + (b[2] - a[2]) * p,
        );
      }
    },
    dispose() {
      for (const g of geometries) g.dispose();
      faceMat.dispose();
      sideMat.dispose();
    },
  };
}
