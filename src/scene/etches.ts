// Grade etchings: K 1 2 … 8 HS as large, very dim troika Text — etched
// constellation names floating below each grade band. Fixed in world space
// (billboarding OFF): each label is rotated once to face the initial camera
// azimuth, so orbiting past them reads like flying over engravings.
//
// Plain troika Text (10 instances = 10 draw calls) — BatchedText exists in
// newer troika builds but 10 labels don't justify chasing it.

import * as THREE from "three";
import { Text } from "troika-three-text";
import type { GraphGrade } from "../data";

const FONT_URL = "/fonts/space-grotesk-latin-600-normal.woff"; // troika parses WOFF1, not WOFF2
const COLOR = 0x2a2848;
const OPACITY = 0.4;
const FONT_SIZE = 28;
const ETCH_Y = -240; // below the whole cloud (data y-min is -218; DESIGN's -95 predates the layout)

export interface EtchesHandle {
  group: THREE.Group;
  /** Resolves when every label has synced (first correct render possible). */
  ready: Promise<void>;
  dispose(): void;
}

export function createEtches(grades: GraphGrade[], cameraAzimuth: number): EtchesHandle {
  const group = new THREE.Group();
  group.name = "etches";

  const labels: Text[] = [];
  const syncs: Promise<void>[] = [];

  for (const grade of grades) {
    const label = new Text();
    label.text = grade.id;
    label.font = FONT_URL;
    label.fontSize = FONT_SIZE;
    label.color = COLOR;
    label.fillOpacity = OPACITY;
    label.anchorX = "center";
    label.anchorY = "middle";
    label.letterSpacing = 0.02;
    label.position.set((grade.x0 + grade.x1) / 2, ETCH_Y, 0);
    // Face the initial camera azimuth, then stay put (etching, not sprite).
    label.rotation.y = cameraAzimuth;
    label.material.depthWrite = false;
    label.renderOrder = -1; // with edges, before nodes' transparents ordering
    group.add(label);
    labels.push(label);
    syncs.push(new Promise<void>((resolve) => label.sync(resolve)));
  }

  return {
    group,
    ready: Promise.all(syncs).then(() => undefined),
    dispose() {
      for (const label of labels) label.dispose();
    },
  };
}
