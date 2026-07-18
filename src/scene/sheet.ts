// The Blueprint sheet — the flat plane the pose-2 content is drafted onto. The
// Blueprint pose lays the 480 standards out as a grade-column circuit board;
// what makes it READ as an architecture blueprint (rather than a flat scatter
// of dots) is the SHEET behind it: a Prussian-blue cyanotype field with uneven
// exposure washes, a faint drafting grid, a double border frame with corner
// registers, and a title block. It is the in-app realisation of the acceptance
// preview (scripts/pose-grammar-previews.mjs blueprintSheet).
//
// The plane sits at z = −8, behind the content (z = 0), spanning the pos3
// content bounds plus a generous margin so the frame clears the linework. A
// slight orbit reads the drawing as a sheet floating in space. The texture is
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

const SHEET_Z = -8;
const MARGIN = 120; // world units of sheet around the pos3 content bounds
const CANVAS_W = 1600; // texture resolution; height derived from the plane aspect

// Middot separator used verbatim in the title block (matches the preview).
const DOT = "·";

interface SheetPalette {
  field: string; // sheet field
  wash1: string; // upper-left exposure wash
  wash2: string; // lower-right exposure wash
  ink: string; // drafting ink (lines, frame, text)
  blockField: string; // title-block fill (a shade of the field)
}
// Index-aligned with ArtStyle (0 Galaxy | 1 Ringers | 2 Fidenza). The Galaxy
// values are the acceptance preview's exact cyanotype hexes.
const PALETTES: readonly SheetPalette[] = [
  { field: "#123a63", wash1: "#1a4a7a", wash2: "#0d2c4e", ink: "#eaf2ff", blockField: "#123a63" },
  { field: "#f0ece0", wash1: "#e2dccb", wash2: "#d8d0bc", ink: "#1a1712", blockField: "#e8e2d4" },
  { field: "#43a08b", wash1: "#4fb89f", wash2: "#2f7d6a", ink: "#e8e0cd", blockField: "#357f6d" },
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

  // title block, bottom-right (exact copy text from the acceptance preview).
  // Inset up and left of the sheet corner so the app's fixed bottom-right
  // chrome (pose pills / Art styles tab) never covers it at the Blueprint's
  // deterministic front-on framing.
  const TBw = 392 * k;
  const TBh = 128 * k;
  const tbx = W - F - TBw - 52 * k;
  const tby = H - F - TBh - 96 * k;
  ctx.fillStyle = `rgba(${rgb(p.blockField)},0.9)`;
  ctx.fillRect(tbx, tby, TBw, TBh);
  ctx.strokeStyle = `rgba(${ink},0.85)`;
  ctx.lineWidth = 1.4 * k;
  ctx.strokeRect(tbx, tby, TBw, TBh);
  ctx.strokeStyle = `rgba(${ink},0.6)`;
  ctx.lineWidth = 0.8 * k;
  for (const dy of [40, 92]) {
    ctx.beginPath();
    ctx.moveTo(tbx, tby + dy * k);
    ctx.lineTo(tbx + TBw, tby + dy * k);
    ctx.stroke();
  }
  ctx.textBaseline = "alphabetic";
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${1.1 * k}px`;
  const line = (x: number, y: number, size: number, txt: string, op: number): void => {
    ctx.font = `${size * k}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    ctx.fillStyle = `rgba(${ink},${op})`;
    ctx.fillText(txt, tbx + x * k, tby + y * k);
  };
  line(14, 26, 16, `COHERENCE ${DOT} PREREQUISITE CIRCUIT`, 0.9);
  line(14, 60, 11, `480 STANDARDS ${DOT} 757 PREREQ EDGES ${DOT} 142 RELATED`, 0.75);
  line(14, 78, 11, "SOURCE: ACHIEVE THE CORE COHERENCE MAP (CC0)", 0.75);
  line(14, 112, 11, `SHEET 3 OF 4 ${DOT} SCALE NONE ${DOT} SEED 1337`, 0.75);
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";
}

function buildTexture(W: number, H: number, p: SheetPalette): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (ctx) drawSheet(ctx, W, H, p);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export interface SheetHandle {
  object: THREE.Mesh;
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

  const cache: (THREE.CanvasTexture | null)[] = [null, null, null];
  const textureFor = (style: number): THREE.CanvasTexture => {
    let t = cache[style];
    if (!t) {
      t = buildTexture(CANVAS_W, canvasH, PALETTES[style] ?? PALETTES[0]);
      cache[style] = t;
    }
    return t;
  };

  const geometry = new THREE.PlaneGeometry(planeW, planeH);
  const material = new THREE.MeshBasicMaterial({
    map: textureFor(0),
    transparent: true,
    depthTest: true,
    depthWrite: false,
    opacity: 0,
  });
  const object = new THREE.Mesh(geometry, material);
  object.position.set(cx, cy, SHEET_Z);
  object.frustumCulled = false;
  object.name = "blueprint-sheet";
  object.renderOrder = -3; // behind the contours (-2) and edges (-1)
  object.visible = false;

  const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

  return {
    object,
    update(pose) {
      const op = clamp01(1 - Math.abs(pose - 2) / 0.5);
      if (op <= 0.001) {
        if (object.visible) object.visible = false;
        return;
      }
      object.visible = true;
      material.opacity = op;
    },
    setArtStyle(style) {
      material.map = textureFor(style);
      material.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      for (const t of cache) t?.dispose();
    },
  };
}
