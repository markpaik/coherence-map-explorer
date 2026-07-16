// Nebula backdrop: a few enormous, very dim additive sprites behind the
// constellation — the "galaxy" feel without competing with the data. Colors
// echo the strand palette (indigo/violet/teal) so the backdrop and the graph
// read as one system. Static geometry; 4 draw calls total.

import * as THREE from "three";

interface Puff {
  color: number;
  opacity: number;
  scale: [number, number];
  position: [number, number, number];
}

const PUFFS: Puff[] = [
  // Broad galactic band along the grade axis, behind everything.
  { color: 0x1c1a4e, opacity: 0.16, scale: [1700, 620], position: [0, -10, -420] },
  // Violet bloom over the middle grades.
  { color: 0x40307e, opacity: 0.1, scale: [820, 680], position: [-120, 60, -380] },
  // Teal drift under the geometry shelf.
  { color: 0x143c4e, opacity: 0.09, scale: [720, 520], position: [240, -140, -360] },
  // Faint gold warmth near the K end (number strand home).
  { color: 0x4e3a12, opacity: 0.07, scale: [560, 460], position: [-380, 40, -340] },
];

function makeGlowTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.45)");
  g.addColorStop(0.7, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface NebulaHandle {
  group: THREE.Group;
  dispose(): void;
}

export function createNebula(): NebulaHandle {
  const group = new THREE.Group();
  group.name = "nebula";

  const texture = makeGlowTexture();
  const materials: THREE.SpriteMaterial[] = [];

  for (const puff of PUFFS) {
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: puff.color,
      transparent: true,
      opacity: puff.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false, // pure backdrop; never occludes or z-fights
    });
    materials.push(material);
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(puff.scale[0], puff.scale[1], 1);
    sprite.position.set(puff.position[0], puff.position[1], puff.position[2]);
    sprite.renderOrder = -3; // behind starfield (-2) and edges (-1)
    group.add(sprite);
  }

  return {
    group,
    dispose() {
      texture.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
