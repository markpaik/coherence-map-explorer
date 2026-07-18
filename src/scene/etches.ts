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
// Light-environment ink — PER ENVIRONMENT (round-13). On a light field the
// faint-violet extrusion vanishes, so setEnvLight re-inks the markers; but the two
// light environments need OPPOSITE ink because the marker row sits low in each:
//   · DAWN — the marker row (y ≈ −124) sits BELOW the horizon line where the dawn
//     shell is DARK (#232833). A dark ink there is invisible, so the dawn markers
//     read as PALE STONE (face #ded8ca / side #8a8478): legible against the dark
//     below-horizon band and acceptable against the low mist.
//   · DAYLIGHT — concrete is light everywhere, so a dark warm ink (face #2a2722 /
//     side #6b665c) reads as an engraved marker standing on the light ground.
const ENV_DAWN_FACE = 0xded8ca; // pale stone — dawn (dark below-horizon band)
const ENV_DAWN_SIDE = 0x8a8478;
const ENV_DAY_FACE = 0x2a2722; // dark warm ink — daylight (light concrete)
const ENV_DAY_SIDE = 0x6b665c;

// Marker ink per art style, index-aligned with ArtStyle (0 Galaxy | 1 Ringers |
// 2 Fidenza). The etches are engraved monuments in the Galaxy; under an art
// style they read as printed labels standing on the field, so face = the
// board/board-ink color and side = a quieter tint that keeps a hint of relief
// without competing with the field. face/side for style 0 restore the shipped
// faint-violet extrusion exactly (regression-free default).
const MARKER_INK: readonly { face: number; side: number }[] = [
  { face: FACE_COLOR, side: SIDE_COLOR }, // 0 Galaxy — shipped
  { face: 0x1a1712, side: 0x8a8272 }, // 1 Ringers — ink face, warm grey-brown relief on cream
  { face: 0x14332c, side: 0x2a6355 }, // 2 Fidenza — deep teal-ink face, teal relief on the field
];
const GRADE_SIZE = 26;
// Sized so the longest same-rank neighbors (GEOMETRY / ADVANCED) clear each
// other over their narrow arcs: at 11 units their half-widths sum to ~60 vs
// ~74 units of center separation. 15 was measurably too wide (labels collided
// from oblique angles).
const COURSE_SIZE = 11;
const DEPTH = 1.8; // extrusion: 3D presence without the slab read (was 5 — "too thick", Mark round 8)

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
   * Slide every marker along the pose axis p ∈ [0,3]: 0 = constellation (marker),
   * 1 = the Ascent (marker2), 2 = the Blueprint (marker3), 3 = the Transit Map
   * (marker4). Positions lerp between the two bracketing poses; facing stays at
   * the camera's home azimuth through poses 0↔1 (both stand along the ground
   * line), rotates head-on (yaw → 0) as it crosses into the flat Blueprint, and
   * holds head-on across the Blueprint↔Transit crossing (both are front-on
   * schematics). The pose driver calls this with the global eased progress every
   * morph frame. Markers built later (async font load) adopt the current pose so
   * they never pop in at the wrong place.
   */
  setPose(p: number): void;
  /**
   * Swap the marker ink for the active art style: 0 Galaxy (the shipped faint
   * violet) | 1 Ringers (ink on the cream board) | 2 Fidenza (deep teal-ink).
   */
  setArtStyle(style: number): void;
  /**
   * Re-ink the Galaxy markers for a LIGHT environment, PER ENVIRONMENT. Both
   * amounts 0 = the shipped faint-violet extrusion. The dawn re-inks toward PALE
   * STONE (the marker row sits below the dark horizon band), the daylight toward a
   * DARK WARM ink (light concrete). The two never overlap, so main.ts passes both
   * effective amounts (0 during stories / off-Galaxy). A NO-OP in art styles 1/2 —
   * their MARKER_INK stands.
   */
  setEnvLight(dawnAmt: number, dayAmt: number): void;
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
  // Ink state: the active art style (only style 0 honours setEnvLight) plus the
  // fixed lerp endpoints for the Galaxy light-environment re-ink.
  let artStyleCur = 0;
  const galaxyFace = new THREE.Color(FACE_COLOR);
  const galaxySide = new THREE.Color(SIDE_COLOR);
  const dawnFace = new THREE.Color(ENV_DAWN_FACE);
  const dawnSide = new THREE.Color(ENV_DAWN_SIDE);
  const dayFace = new THREE.Color(ENV_DAY_FACE);
  const daySide = new THREE.Color(ENV_DAY_SIDE);

  // Each marker remembers all three pose positions so setPose can lerp it.
  interface Marker {
    mesh: THREE.Mesh;
    a: [number, number, number]; // constellation
    b: [number, number, number]; // the Ascent
    c: [number, number, number]; // the Blueprint
    d: [number, number, number]; // the Transit Map
  }
  const markers: Marker[] = [];
  let pose = 0; // 0 = constellation, 1 = the Ascent, 2 = the Blueprint, 3 = the Transit Map

  // Place one marker at the current pose value (positions lerp between the two
  // bracketing poses; facing holds at the home azimuth through 0↔1, rotates to
  // head-on — yaw 0 — as it crosses into the flat Blueprint at pose 2, and stays
  // head-on across the Blueprint↔Transit crossing (both are front-on schematics).
  function placeMarker(mk: Marker): void {
    const p = pose;
    let from: [number, number, number];
    let to: [number, number, number];
    let t: number;
    let yaw: number;
    if (p <= 1) {
      from = mk.a;
      to = mk.b;
      t = p;
      yaw = cameraAzimuth;
    } else if (p <= 2) {
      from = mk.b;
      to = mk.c;
      t = p - 1;
      yaw = cameraAzimuth * (2 - p); // cameraAzimuth at pose 1 → 0 at pose 2
    } else {
      from = mk.c;
      to = mk.d;
      t = p - 2;
      yaw = 0; // Blueprint and Transit are both front-on
    }
    mk.mesh.position.set(
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    );
    mk.mesh.rotation.y = yaw;
  }

  function addMarker(
    font: Font,
    text: string,
    size: number,
    marker: [number, number, number],
    marker2: [number, number, number] | undefined,
    marker3: [number, number, number] | undefined,
    marker4: [number, number, number] | undefined,
    yOffset = 0,
  ): void {
    const geometry = new TextGeometry(text, {
      font,
      size,
      depth: DEPTH,
      curveSegments: 6,
      bevelEnabled: true,
      bevelThickness: 0.45,
      bevelSize: 0.32,
      bevelSegments: 2,
    });
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    geometry.translate(-(bb.max.x + bb.min.x) / 2, 0, -(bb.max.z + bb.min.z) / 2);
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, [faceMat, sideMat]);
    const aR = marker;
    const bR = marker2 ?? aR; // no pose-B target ⇒ stays put
    const cR = marker3 ?? bR; // no pose-C target ⇒ holds the Ascent placement
    const dR = marker4 ?? cR; // no pose-D target ⇒ holds the Blueprint placement
    // Optional −y stagger, applied UNIFORMLY to all four pose slots so a
    // second-rank label stays a row below its neighbours in every pose (used to
    // split the four HS course labels into two rows; 0 for grades ⇒ identical
    // to the shipped placement).
    const off = (p: [number, number, number]): [number, number, number] =>
      yOffset ? [p[0], p[1] + yOffset, p[2]] : p;
    const mk: Marker = { mesh, a: off(aR), b: off(bR), c: off(cR), d: off(dR) };
    // Adopt the current pose immediately (markers may load mid-morph or while
    // already in the Ascent / Blueprint) so nothing pops in at the wrong place.
    placeMarker(mk);
    group.add(mesh);
    markers.push(mk);
  }

  const ready = (async () => {
    try {
      const gradeFont = await loader.loadAsync(GRADE_FONT_URL);
      for (const g of grades) {
        if (g.marker) addMarker(gradeFont, g.id, GRADE_SIZE, g.marker, g.marker2, g.marker3, g.marker4);
      }
      // Course labels need A,B,D,E,G,I,L,M,N,O,R,T,V,Y + space — a separate
      // subset face. If it is missing (older build), fall back to initials
      // renderable with the grade face (no crash, degraded gracefully).
      //
      // The four course names (ALGEBRA I / GEOMETRY / ALGEBRA II / ADVANCED)
      // collide at oblique camera angles (ALGEBRA II over ADVANCED). Split them
      // into two rows in EVERY pose: even-index courses keep their marker row,
      // odd-index courses (GEOMETRY, ADVANCED) drop a further COURSE_ROW_DROP
      // below it — a uniform −y offset across all four pose slots so the stagger
      // holds across Constellation, Ascent, Blueprint, and Transit.
      const COURSE_ROW_DROP = 26;
      const courseStagger = (i: number): number => (i % 2) * -COURSE_ROW_DROP;
      try {
        const courseFont = await loader.loadAsync(COURSE_FONT_URL);
        courses.forEach((c, i) =>
          addMarker(courseFont, COURSE_TEXT[c.id] ?? c.label.toUpperCase(), COURSE_SIZE, c.marker, c.marker2, c.marker3, c.marker4, courseStagger(i)),
        );
      } catch {
        console.warn("[cme] course typeface missing; falling back to short marks");
        courses.forEach((c, i) =>
          addMarker(gradeFont, c.id.replace(/[^A-Z0-9]/g, ""), COURSE_SIZE, c.marker, c.marker2, c.marker3, c.marker4, courseStagger(i)),
        );
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
      for (const mk of markers) placeMarker(mk);
    },
    setArtStyle(style) {
      // Both marker materials are shared across every etch, so a single color
      // swap re-inks the whole set. Clamp to a known style; anything else keeps
      // the shipped Galaxy ink.
      artStyleCur = style;
      const ink = MARKER_INK[style] ?? MARKER_INK[0];
      faceMat.color.setHex(ink.face);
      sideMat.color.setHex(ink.side);
    },
    setEnvLight(dawnAmt, dayAmt) {
      // Only the Galaxy etch re-inks for a light environment; art styles 1/2 keep
      // their MARKER_INK (setArtStyle owns them). Both amounts 0 restores the exact
      // shipped faint-violet extrusion, so no-environment Galaxy is unchanged.
      if (artStyleCur !== 0) return;
      const clamp = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
      const dw = clamp(dawnAmt);
      const dy = clamp(dayAmt);
      // Start from the shipped ink and lerp toward each environment's target. The
      // dawn and daylight windows never overlap, so the sequential lerps compose
      // cleanly (only one is ever non-zero): dawn → PALE STONE, daylight → DARK WARM.
      faceMat.color.copy(galaxyFace).lerp(dawnFace, dw).lerp(dayFace, dy);
      sideMat.color.copy(galaxySide).lerp(dawnSide, dw).lerp(daySide, dy);
    },
    dispose() {
      for (const g of geometries) g.dispose();
      faceMat.dispose();
      sideMat.dispose();
    },
  };
}
