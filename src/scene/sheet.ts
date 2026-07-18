// The Blueprint sheet — the flat plane the pose-2 content is drafted onto. The
// Blueprint pose lays the 480 standards out as a grade-column circuit board;
// what makes it READ as an architecture blueprint (rather than a flat scatter
// of dots) is the SHEET behind it: a Prussian-blue cyanotype field with uneven
// exposure washes, a faint drafting grid, and a double border frame with corner
// registers. (The title block was removed in round-12 — the frame + grid + field
// carry the sheet on their own.) It echoes the acceptance preview
// (scripts/pose-grammar-previews.mjs blueprintSheet).
//
// The plane sits at z = −20 (round-12: pushed back from −8 to clear the real LIFT
// of the pos3 block z-planes, which now rise to 146), behind the content, spanning
// the pos3 content bounds plus a generous margin so the frame clears the linework.
// A slight orbit reads the drawing as a sheet floating in space. The texture is
// canvas-generated and fully DETERMINISTIC — no Math.random, no Date — so every
// visitor sees the same sheet; three cached canvases (one per art style) swap on
// an art-style change:
//   Galaxy  — Prussian-blue #123a63 field, white drafting ink (a cyanotype).
//   Ringers — cream vellum #f0ece0, graphite/ink #1a1712 lines.
//   Fidenza — deep teal field, cream ink.
// Colors stay < 1.0 and blending is normal, so the sheet never contributes to
// the Galaxy bloom; it renders beneath the nodes/edges. Visibility follows the
// pose: full at the Blueprint (2), gone by 1.5 and 2.5, so the Transit crossing
// (stations arrive at 2.6) never shows it. Static — reduced-motion safe.

import * as THREE from "three";
import type { GraphNode } from "../data";
import { RINGERS, FIDENZA } from "./artstyle";

const SHEET_Z = -20; // round-12: back from −8 so it clears the lifted pos3 block planes
const MARGIN = 120; // world units of sheet around the pos3 content bounds
const CANVAS_W = 1600; // texture resolution; height derived from the plane aspect

interface SheetPalette {
  field: string; // sheet field
  wash1: string; // upper-left exposure wash
  wash2: string; // lower-right exposure wash
  ink: string; // drafting ink (lines, frame)
}
// Index-aligned with ArtStyle (0 Galaxy | 1 Ringers | 2 Fidenza). The Galaxy
// values are the acceptance preview's exact cyanotype hexes.
const PALETTES: readonly SheetPalette[] = [
  { field: "#123a63", wash1: "#1a4a7a", wash2: "#0d2c4e", ink: "#eaf2ff" },
  { field: "#f0ece0", wash1: "#e2dccb", wash2: "#d8d0bc", ink: "#1a1712" },
  { field: "#43a08b", wash1: "#4fb89f", wash2: "#2f7d6a", ink: "#e8e0cd" },
];

// #rrggbb → "r,g,b" for building rgba() strokes at arbitrary opacity.
function rgb(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  return `${(v >> 16) & 255},${(v >> 8) & 255},${v & 255}`;
}

// Deterministic cyanotype draw — the exact grammar of the acceptance preview,
// scaled to fill the whole canvas (here the canvas IS the sheet, so there is no
// page border around it). k scales every measure off the preview's 1600px sheet.
function drawSheet(ctx: CanvasRenderingContext2D, W: number, H: number, p: SheetPalette): void {
  const k = W / 1600;
  const ink = rgb(p.ink);

  // field
  ctx.fillStyle = p.field;
  ctx.fillRect(0, 0, W, H);

  // two soft radial exposure washes (uneven cyanotype development)
  const wash = (cx: number, cy: number, r: number, color: string, a: number): void => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(${rgb(color)},${a})`);
    g.addColorStop(1, `rgba(${rgb(color)},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  wash(0.3 * W, 0.28 * H, 0.7 * W, p.wash1, 0.55);
  wash(0.78 * W, 0.75 * H, 0.6 * W, p.wash2, 0.6);

  // drafting grid: minor cell / major every 5th (the preview's 16px / 80px ratio)
  const cell = 17 * k;
  ctx.lineWidth = 0.5 * k;
  for (let i = 0, x = 0; x <= W; i++, x = i * cell) {
    const major = i % 5 === 0;
    ctx.strokeStyle = `rgba(${ink},${major ? 0.09 : 0.045})`;
    ctx.lineWidth = (major ? 0.8 : 0.5) * k;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let i = 0, y = 0; y <= H; i++, y = i * cell) {
    const major = i % 5 === 0;
    ctx.strokeStyle = `rgba(${ink},${major ? 0.09 : 0.045})`;
    ctx.lineWidth = (major ? 0.8 : 0.5) * k;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // double border frame + corner registers, inset from the canvas edge
  const F = 22 * k;
  ctx.strokeStyle = `rgba(${ink},0.85)`;
  ctx.lineWidth = 1.6 * k;
  ctx.strokeRect(F, F, W - 2 * F, H - 2 * F);
  const F2 = F + 7 * k;
  ctx.strokeStyle = `rgba(${ink},0.4)`;
  ctx.lineWidth = 0.7 * k;
  ctx.strokeRect(F2, F2, W - 2 * F2, H - 2 * F2);
  const reg = 10 * k;
  ctx.strokeStyle = `rgba(${ink},0.8)`;
  ctx.lineWidth = 1 * k;
  for (const [cx, cy] of [
    [F, F],
    [W - F, F],
    [F, H - F],
    [W - F, H - F],
  ]) {
    ctx.beginPath();
    ctx.moveTo(cx - reg, cy);
    ctx.lineTo(cx + reg, cy);
    ctx.moveTo(cx, cy - reg);
    ctx.lineTo(cx, cy + reg);
    ctx.stroke();
  }

  // (Round-12: the bottom-right title block — the box + rules + copy text — was
  // removed for all three art styles. The double frame, corner registers, drafting
  // grid, field, and exposure washes above carry the sheet on their own.)
}

function texFromCanvas(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function buildFrontCanvas(W: number, H: number, p: SheetPalette): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (ctx) drawSheet(ctx, W, H, p);
  return canvas;
}

// The BACK of the sheet: an opaque field-colour plate with the same linework
// bled faintly through at 0.22, flipped horizontally. The back plane is rotated
// 180° about Y (a rotation, not a reflection — it alone reads UN-mirrored), so
// the canvas supplies the reflection: the two combined give the true back-of-a-
// real-drawing look — the ink reversed, faint through the stock.
function buildBackCanvas(front: HTMLCanvasElement, p: SheetPalette): HTMLCanvasElement {
  const W = front.width;
  const H = front.height;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = p.field; // opaque plate — the paper stock
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.22; // faint bleed-through of the front's ink
    ctx.translate(W, 0);
    ctx.scale(-1, 1); // horizontal mirror
    ctx.drawImage(front, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }
  return canvas;
}

export interface SheetHandle {
  object: THREE.Object3D;
  /** Drive the pose fade: full at the Blueprint (2), gone by 1.5 / 2.5. */
  update(pose: number): void;
  /** Swap the sheet texture for the active art style (regenerated + cached). */
  setArtStyle(style: number): void;
  dispose(): void;
}

export function createSheet(nodes: GraphNode[]): SheetHandle {
  // Plane bounds = pos3 content bounds + generous margin.
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    const [x, y] = n.pos3;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const planeW = x1 - x0 + 2 * MARGIN;
  const planeH = y1 - y0 + 2 * MARGIN;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;

  // Texture height tracks the plane aspect so the drafting grid stays square.
  const canvasH = Math.round(CANVAS_W * (planeH / planeW));

  // Front + back textures per art style, generated on first use and cached. The
  // back is the front re-plated on an opaque field with the ink at 0.22.
  const frontCache: (THREE.CanvasTexture | null)[] = [null, null, null];
  const backCache: (THREE.CanvasTexture | null)[] = [null, null, null];
  const frontTextureFor = (style: number): THREE.CanvasTexture => {
    let t = frontCache[style];
    if (!t) {
      t = texFromCanvas(buildFrontCanvas(CANVAS_W, canvasH, PALETTES[style] ?? PALETTES[0]));
      frontCache[style] = t;
    }
    return t;
  };
  const backTextureFor = (style: number): THREE.CanvasTexture => {
    let t = backCache[style];
    if (!t) {
      const p = PALETTES[style] ?? PALETTES[0];
      t = texFromCanvas(buildBackCanvas(buildFrontCanvas(CANVAS_W, canvasH, p), p));
      backCache[style] = t;
    }
    return t;
  };

  const geometry = new THREE.PlaneGeometry(planeW, planeH);

  // Front sheet — the cyanotype, facing +z (the front-on Blueprint camera).
  const frontMat = new THREE.MeshBasicMaterial({
    map: frontTextureFor(0),
    transparent: true,
    depthTest: true,
    depthWrite: false,
    opacity: 0,
  });
  const front = new THREE.Mesh(geometry, frontMat);
  front.position.set(cx, cy, SHEET_Z);
  front.frustumCulled = false;
  front.name = "blueprint-sheet";
  front.renderOrder = -3; // behind the contours (-2) and edges (-1)

  // Back sheet — just behind, rotated 180° about Y so it faces −z (seen only
  // when orbiting BEHIND the Blueprint). The rotation mirrors the drawing; the
  // texture already carries the opaque field plate + faint 0.22 bleed-through,
  // so the reverse reads as the back of a real sheet, not empty space.
  const backMat = new THREE.MeshBasicMaterial({
    map: backTextureFor(0),
    transparent: true,
    depthTest: true,
    depthWrite: false,
    opacity: 0,
  });
  const back = new THREE.Mesh(geometry, backMat);
  back.position.set(cx, cy, SHEET_Z - 1.5); // −21.5: just behind the front plate
  back.rotation.y = Math.PI;
  back.frustumCulled = false;
  back.name = "blueprint-sheet-back";
  back.renderOrder = -4; // behind the front

  const object = new THREE.Group();
  object.name = "blueprint-sheet-group";
  object.add(front, back);
  object.visible = false;

  const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

  return {
    object,
    update(pose) {
      // Front + back share the pose window (and, via main.ts, the same endpoint
      // gating — a sentinel pose zeroes this window when the Blueprint is not a
      // morph endpoint). Back-face culling means only one side ever draws.
      const op = clamp01(1 - Math.abs(pose - 2) / 0.5);
      if (op <= 0.001) {
        if (object.visible) object.visible = false;
        return;
      }
      object.visible = true;
      frontMat.opacity = op;
      backMat.opacity = op;
    },
    setArtStyle(style) {
      frontMat.map = frontTextureFor(style);
      frontMat.needsUpdate = true;
      backMat.map = backTextureFor(style);
      backMat.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      frontMat.dispose();
      backMat.dispose();
      for (const t of frontCache) t?.dispose();
      for (const t of backCache) t?.dispose();
    },
  };
}
