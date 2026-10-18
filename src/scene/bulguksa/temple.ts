// Bulguksa temple, low-poly, drawn in ink line on paper fills, every roof
// under snow. Built once in PLAN UNITS (the front terrace is 100 wide; +x east,
// +z south toward the home camera, y up from the terrace foot) and scaled into
// the world by TEMPLE.scale (params.ts).
//
// After the site plan (Cultural Heritage Administration, via Commons): the
// Daeungjeon court in the east, enclosed by corridors, entered through Jahamun
// at the head of Cheongungyo and Baegungyo (16 and 18 steps, with the arch
// under the lower flight); Beomyeongnu on its stacked stone pillar at the
// court's front west corner and Jwagyeongnu at the east corner; Seokgatap
// (plain, three stories) west of the hall and Dabotap (ornate) east of it;
// Museoljeon behind. The west court is entered through Anyangmun at the head
// of Yeonhwagyo and Chilbogyo (10 and 8 steps), with Geungnakjeon inside.
//
// Two draw calls: one merged fill mesh (flat paper tones baked per vertex,
// shaded by a single light) and one merged line mesh (EdgesGeometry of every
// part plus the ruled lines: the ashlar grid, posts, railings).

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { lhash } from "../landscape";
import { INK } from "./params";

/** The one light: from the upper left, a little in front. */
const LIGHT = new THREE.Vector3(-0.45, 0.8, 0.4).normalize();

interface Builder {
  fills: THREE.BufferGeometry[];
  edges: THREE.BufferGeometry[];
  lines: number[];
}

const linColor = (hex: number): THREE.Color => new THREE.Color().setHex(hex);

/** Bake a flat color and the single-light shade into a non-indexed geometry. */
function paint(geo: THREE.BufferGeometry, hex: number, shade = 0.12): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute("uv");
  g.computeVertexNormals();
  const pos = g.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  const c = linColor(hex);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    d.fromBufferAttribute(pos, i + 2);
    const n = b.sub(a).cross(d.sub(a)).normalize();
    const k = 1 - shade + shade * Math.max(0, n.dot(LIGHT));
    for (let j = 0; j < 3; j++) col.set([c.r * k, c.g * k, c.b * k], (i + j) * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.deleteAttribute("normal");
  return g;
}

function add(B: Builder, geo: THREE.BufferGeometry, hex: number, opts: { edges?: boolean; shade?: number; angle?: number } = {}): void {
  const g = paint(geo, hex, opts.shade ?? 0.12);
  B.fills.push(g);
  if (opts.edges !== false) {
    const e = new THREE.EdgesGeometry(g, opts.angle ?? 24);
    B.edges.push(e);
  }
}

function box(B: Builder, cx: number, y0: number, cz: number, w: number, h: number, d: number, hex: number, edges = true): void {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(cx, y0 + h / 2, cz);
  add(B, g, hex, { edges });
}

const line = (B: Builder, a: readonly number[], b: readonly number[]): void => {
  B.lines.push(a[0], a[1], a[2], b[0], b[1], b[2]);
};

/** A quad strip surface from two rows of points (same length), as triangles. */
function loft(rowA: THREE.Vector3[], rowB: THREE.Vector3[], closed: boolean): THREE.BufferGeometry {
  const p: number[] = [];
  const n = rowA.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n;
    const a = rowA[i];
    const b = rowA[j];
    const c = rowB[j];
    const d = rowB[i];
    p.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    p.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  return g;
}

function tris(pts: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

/** Rectangle ring of points (counterclockwise from the front-left corner), with
 *  `seg` segments per side and the corners lifted by `lift` (the eave curve). */
function ring(cx: number, cz: number, hx: number, hz: number, y: number, seg: number, lift: number, flare: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const corners: [number, number][] = [
    [-hx, hz],
    [hx, hz],
    [hx, -hz],
    [-hx, -hz],
  ];
  for (let s = 0; s < 4; s++) {
    const [x0, z0] = corners[s];
    const [x1, z1] = corners[(s + 1) % 4];
    for (let i = 0; i < seg; i++) {
      const t = i / seg;
      const u = Math.abs(2 * t - 1); // 1 at the corners, 0 mid side
      const up = lift * Math.pow(u, 3);
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      // Corners flare out a little as they lift.
      const fx = Math.sign(x) * flare * Math.pow(Math.abs(x) / hx, 6);
      const fz = Math.sign(z) * flare * Math.pow(Math.abs(z) / hz, 6);
      out.push(new THREE.Vector3(cx + x + fx, y + up, cz + z + fz));
    }
  }
  return out;
}

interface RoofOpts {
  over: number;
  /** Rise of the hipped part and of the gable above it. */
  h1: number;
  h2: number;
  lift: number;
  /** Paljak (hipped and gabled) or a plain gable (corridors). */
  kind: "paljak" | "gable" | "hip";
}

/**
 * A roof over a w x d footprint whose eave sits at y. Snow covers the slopes
 * (paper), a dark row of tile ends runs under the eave lip, the soffit is in
 * shadow, a faint dancheong band lies on the wall top, and snow heaps on the
 * ridge and at the hip ends.
 */
function roof(B: Builder, cx: number, y: number, cz: number, w: number, d: number, o: RoofOpts): void {
  const ex = w / 2 + o.over;
  const ez = d / 2 + o.over;
  const seg = 6;
  if (o.kind === "gable") {
    // Two slopes along x, gable triangles at the ends, a gentle lift at the ends.
    const N = 8;
    const front: THREE.Vector3[] = [];
    const back: THREE.Vector3[] = [];
    const ridge: THREE.Vector3[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const u = Math.abs(2 * t - 1);
      const up = o.lift * Math.pow(u, 3);
      const x = cx - ex + 2 * ex * t;
      front.push(new THREE.Vector3(x, y + up, cz + ez));
      back.push(new THREE.Vector3(x, y + up, cz - ez));
      ridge.push(new THREE.Vector3(x, y + o.h1 + up * 0.5, cz));
    }
    add(B, loft(front, ridge, false), INK.paper, { angle: 20 });
    add(B, loft(ridge, back, false), INK.paper, { angle: 20 });
    for (const [s, i] of [
      [-1, 0],
      [1, N],
    ] as const) {
      const f = front[i];
      const b2 = back[i];
      const r = ridge[i];
      const gx = cx + s * (w / 2 + o.over * 0.4);
      add(B, tris([gx, f.y - 0.05, f.z - 0.2 * Math.sign(f.z - cz), gx, r.y - 0.05, r.z, gx, b2.y - 0.05, b2.z + 0.2 * Math.sign(cz - b2.z)]), INK.wall);
    }
    // Ridge heap.
    const rh = new THREE.BoxGeometry(2 * ex * 0.97, 0.32, 0.42);
    rh.translate(cx, y + o.h1 + 0.1, cz);
    add(B, rh, INK.paper, { angle: 40 });
    // Tile ends under the lips (the shadow line), front and back.
    for (const s of [1, -1]) {
      const lip = new THREE.BoxGeometry(2 * ex, 0.22, 0.12);
      lip.translate(cx, y - 0.12, cz + s * ez);
      add(B, lip, INK.fascia, { edges: false, shade: 0 });
    }
    // Shadow on the wall top under the eave, and a faint dancheong band.
    box(B, cx, y - 0.75, cz, w + 0.02, 0.45, d + 0.02, INK.danGreen, false);
    box(B, cx, y - 1.0, cz, w + 0.03, 0.25, d + 0.03, INK.soffit, false);
    return;
  }

  // Hipped (and gabled): eave ring -> break ring (hips) -> ridge.
  const eave = ring(cx, cz, ex, ez, y, seg, o.lift, o.over * 0.25);
  const inset = ez * 0.55;
  const bx = Math.max(ex - inset, 0.4);
  const bz = ez - inset;
  const brk = ring(cx, cz, bx, bz, y + o.h1, seg, 0, 0);
  add(B, loft(eave, brk, true), INK.paper, { angle: 18 });
  const top = y + o.h1;
  if (o.kind === "paljak") {
    const ry = top + o.h2;
    // Upper slopes front and back, up to the ridge.
    add(B, tris([cx - bx, top, cz + bz, cx + bx, top, cz + bz, cx + bx, ry, cz, cx - bx, top, cz + bz, cx + bx, ry, cz, cx - bx, ry, cz]), INK.paper, { angle: 18 });
    add(B, tris([cx + bx, top, cz - bz, cx - bx, top, cz - bz, cx - bx, ry, cz, cx + bx, top, cz - bz, cx - bx, ry, cz, cx + bx, ry, cz]), INK.paper, { angle: 18 });
    // The small gable triangles, in wall tone.
    for (const s of [-1, 1]) {
      add(B, tris([cx + s * bx, top, cz - bz, cx + s * bx, top, cz + bz, cx + s * bx, ry, cz]), INK.wall);
    }
    const rh = new THREE.BoxGeometry(2 * bx + 0.6, 0.42, 0.5);
    rh.translate(cx, ry + 0.12, cz);
    add(B, rh, INK.paper, { angle: 40 });
  } else {
    // Hip: a pyramid cap over the break ring.
    const ry = top + o.h2;
    add(B, tris([
      cx - bx, top, cz + bz, cx + bx, top, cz + bz, cx, ry, cz,
      cx + bx, top, cz + bz, cx + bx, top, cz - bz, cx, ry, cz,
      cx + bx, top, cz - bz, cx - bx, top, cz - bz, cx, ry, cz,
      cx - bx, top, cz - bz, cx - bx, top, cz + bz, cx, ry, cz,
    ]), INK.paper, { angle: 18 });
  }
  // Tile ends under the lip: a dark band hung under the eave ring.
  const lip = eave.map((p) => new THREE.Vector3(p.x, p.y - 0.28, p.z));
  add(B, loft(eave, lip, true), INK.fascia, { edges: false, shade: 0 });
  // Soffit in shadow, from the lip in to the wall top.
  const wallTop = ring(cx, cz, w / 2, d / 2, y - 0.9, seg, 0, 0);
  add(B, loft(lip, wallTop, true), INK.soffit, { edges: false, shade: 0 });
  // Faint dancheong band on the wall top, under the shadow.
  box(B, cx, y - 1.5, cz, w + 0.04, 0.6, d + 0.04, INK.danGreen, false);
  box(B, cx, y - 1.75, cz, w + 0.05, 0.25, d + 0.05, INK.danRed, false);
  // Snow heaps at the four hip ends.
  for (const i of [0, seg, 2 * seg, 3 * seg]) {
    const p = eave[i];
    const g = new THREE.SphereGeometry(0.42, 6, 4);
    g.scale(1.4, 0.55, 1.4);
    g.translate(p.x, p.y + 0.12, p.z);
    add(B, g, INK.paper, { edges: false, shade: 0.06 });
  }
}

/** A hall: walls with posts, then its roof. */
function hall(B: Builder, cx: number, y0: number, cz: number, w: number, d: number, wallH: number, roofO: RoofOpts, bays: number): void {
  box(B, cx, y0, cz, w, wallH, d, INK.wall);
  // Posts and a lintel, ruled in ink on the front and back faces.
  for (const s of [1, -1]) {
    const z = cz + s * (d / 2 + 0.01);
    for (let i = 0; i <= bays; i++) {
      const x = cx - w / 2 + (w * i) / bays;
      line(B, [x, y0, z], [x, y0 + wallH, z]);
    }
    line(B, [cx - w / 2, y0 + wallH * 0.82, z], [cx + w / 2, y0 + wallH * 0.82, z]);
  }
  roof(B, cx, y0 + wallH + 0.9, cz, w, d, roofO);
}

/** A flight of n steps along -z from (zFrom, yFrom) up to (zTo, yTo), w wide. */
function flight(B: Builder, cx: number, w: number, zFrom: number, zTo: number, yFrom: number, yTo: number, n: number): void {
  const run = (zFrom - zTo) / n;
  const rise = (yTo - yFrom) / n;
  for (let i = 0; i < n; i++) {
    const z1 = zFrom - i * run;
    const top = yFrom + (i + 1) * rise;
    const g = new THREE.BoxGeometry(w, top - yFrom + 0.001, run);
    g.translate(cx, yFrom + (top - yFrom) / 2, z1 - run / 2);
    add(B, g, INK.paper, { edges: false, shade: 0.18 });
    // The nosing of each step, ruled.
    line(B, [cx - w / 2, top, z1], [cx + w / 2, top, z1]);
  }
  // Stone parapets on both sides, following the slope.
  const len = Math.hypot(zFrom - zTo, yTo - yFrom);
  const ang = Math.atan2(yTo - yFrom, zFrom - zTo);
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(0.5, 0.7, len);
    g.rotateX(ang);
    g.translate(cx + s * (w / 2 + 0.25), (yFrom + yTo) / 2 + 0.35, (zFrom + zTo) / 2);
    add(B, g, INK.stone);
    // Under the parapet the side wall of the flight, in stone.
    const side = tris([
      cx + s * (w / 2 + 0.01), yFrom, zFrom,
      cx + s * (w / 2 + 0.01), yFrom, zTo,
      cx + s * (w / 2 + 0.01), yTo, zTo,
    ]);
    add(B, side, INK.stone, { edges: false });
  }
}

/** Seokgatap: two-tier podium, three stories, roof slabs with stepped undersides. */
function seokgatap(B: Builder, cx: number, y0: number, cz: number): void {
  box(B, cx, y0, cz, 3.4, 0.6, 3.4, INK.stone);
  box(B, cx, y0 + 0.6, cz, 2.6, 1.0, 2.6, INK.stone);
  box(B, cx, y0 + 1.6, cz, 2.9, 0.22, 2.9, INK.paper);
  let y = y0 + 1.82;
  const bodies = [
    [1.5, 1.15],
    [1.2, 0.62],
    [1.0, 0.55],
  ];
  for (const [bw, bh] of bodies) {
    box(B, cx, y, cz, bw, bh, bw, INK.stone);
    y += bh;
    box(B, cx, y, cz, bw * 1.25, 0.12, bw * 1.25, INK.stone, true);
    box(B, cx, y + 0.12, cz, bw * 1.75, 0.2, bw * 1.75, INK.paper);
    y += 0.32;
  }
  const fin = new THREE.CylinderGeometry(0.06, 0.12, 1.4, 6);
  fin.translate(cx, y + 0.7, cz);
  add(B, fin, INK.fascia, { edges: false, shade: 0 });
}

/** Dabotap: stair base, pillars, slab, octagonal balcony, lotus tier, cap, finial. */
function dabotap(B: Builder, cx: number, y0: number, cz: number): void {
  box(B, cx, y0, cz, 3.6, 0.8, 3.6, INK.stone);
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    box(B, cx + dx * 2.05, y0, cz + dz * 2.05, dz ? 0.9 : 0.5, 0.45, dz ? 0.5 : 0.9, INK.stone);
  }
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) box(B, cx + dx * 1.1, y0 + 0.8, cz + dz * 1.1, 0.3, 1.5, 0.3, INK.stone);
  box(B, cx, y0 + 0.8, cz, 0.6, 1.5, 0.6, INK.stone);
  box(B, cx, y0 + 2.3, cz, 3.4, 0.28, 3.4, INK.paper);
  box(B, cx, y0 + 2.58, cz, 1.9, 0.55, 1.9, INK.stone);
  const bal = new THREE.CylinderGeometry(1.35, 1.35, 0.32, 8);
  bal.translate(cx, y0 + 3.3, cz);
  add(B, bal, INK.paper);
  const body = new THREE.CylinderGeometry(0.7, 0.85, 0.7, 8);
  body.translate(cx, y0 + 3.8, cz);
  add(B, body, INK.stone);
  const lotus = new THREE.CylinderGeometry(1.0, 0.6, 0.45, 8);
  lotus.translate(cx, y0 + 4.35, cz);
  add(B, lotus, INK.stone);
  const cap = new THREE.ConeGeometry(1.35, 0.55, 8);
  cap.translate(cx, y0 + 4.85, cz);
  add(B, cap, INK.paper);
  const fin = new THREE.CylinderGeometry(0.06, 0.12, 1.5, 6);
  fin.translate(cx, y0 + 5.85, cz);
  add(B, fin, INK.fascia, { edges: false, shade: 0 });
}

/** A corridor (hoerang) along x or z, with a gable roof. */
function corridor(B: Builder, x0: number, x1: number, z0: number, z1: number, y0: number): void {
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const B2: Builder = { fills: [], edges: [], lines: [] };
  // Built along x, then turned for a corridor along z.
  box(B2, 0, 0, 0, len, 2.2, 2.2, INK.wall);
  for (let i = 0; i <= Math.round(len / 2.2); i++) {
    const x = -len / 2 + (len * i) / Math.round(len / 2.2);
    line(B2, [x, 0, 1.11], [x, 2.2, 1.11]);
  }
  roof(B2, 0, 3.0, 0, len, 2.2, { over: 0.7, h1: 1.5, h2: 0, lift: 0.15, kind: "gable" });
  const m = new THREE.Matrix4().makeRotationY(alongX ? 0 : Math.PI / 2);
  m.premultiply(new THREE.Matrix4().makeTranslation(cx, y0, cz));
  for (const f of B2.fills) B.fills.push(f.applyMatrix4(m));
  for (const e of B2.edges) B.edges.push(e.applyMatrix4(m));
  const v = new THREE.Vector3();
  for (let i = 0; i < B2.lines.length; i += 3) {
    v.set(B2.lines[i], B2.lines[i + 1], B2.lines[i + 2]).applyMatrix4(m);
    B.lines.push(v.x, v.y, v.z);
  }
}

/** Beomyeongnu's stone pillar: stacked blocks that step in and out. */
function stackedPillar(B: Builder, cx: number, cz: number, y0: number, y1: number): void {
  const blocks = [2.6, 1.7, 2.2, 1.3, 1.9, 1.5, 2.4, 3.0];
  const h = (y1 - y0) / blocks.length;
  blocks.forEach((s, i) => box(B, cx, y0 + i * h, cz, s, h, s, INK.stone));
}

export interface TempleBuild {
  fill: THREE.BufferGeometry;
  lines: THREE.BufferGeometry;
}

/** Build the whole complex in plan units. */
export function buildTemple(): TempleBuild {
  const B: Builder = { fills: [], edges: [], lines: [] };
  const T1 = 3.6; // lower terrace height
  const T2 = 6.0; // upper terrace top
  // -- the stone terrace: lower tier (boulders, ashlar), upper tier set back ----
  box(B, 0, 0, -21, 100, T1, 42, INK.stone);
  box(B, 2, T1, -24.5, 96, T2 - T1, 35, INK.stone);
  // Ground snow on top of the terraces (the court floors are untouched paper).
  box(B, 2, T2, -24.5, 95.8, 0.06, 34.8, INK.paper, false);
  box(B, 0, T1, -3.5, 99.8, 0.06, 6.9, INK.paper, false);
  // Boulder base: a course of rounded natural stones along the front.
  for (let i = 0; i < 46; i++) {
    const x = -49 + (98 * (i + 0.5)) / 46 + (lhash(301, i) - 0.5) * 0.8;
    const r = 0.9 + lhash(302, i) * 0.55;
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.rotateY(lhash(303, i) * 6.28);
    g.rotateX(lhash(304, i) * 0.6);
    g.scale(1.25, 0.75, 0.6);
    g.translate(x, r * 0.62, 0.15);
    add(B, g, INK.stone, { shade: 0.2, angle: 30 });
  }
  // Ashlar grid on the lower face (above the boulders) and the upper face.
  for (const y of [1.6, 2.4, 3.1]) line(B, [-50, y, 0.02], [50, y, 0.02]);
  for (let i = 0; i <= 44; i++) {
    const x = -50 + (100 * i) / 44;
    line(B, [x, 1.25, 0.02], [x, T1, 0.02]);
  }
  for (const y of [T1 + 0.8, T1 + 1.6]) line(B, [-46, y, -6.98], [50, y, -6.98]);
  for (let i = 0; i <= 40; i++) {
    const x = -46 + (96 * i) / 40;
    line(B, [x, T1, -6.98], [x, T2, -6.98]);
  }
  // Stone railing along the lower terrace top.
  for (let i = 0; i <= 48; i++) {
    const x = -49 + (98 * i) / 48;
    line(B, [x, T1, -0.6], [x, T1 + 0.7, -0.6]);
  }
  line(B, [-49, T1 + 0.6, -0.6], [49, T1 + 0.6, -0.6]);

  // -- the Daeungjeon court (east) ----------------------------------------------
  const JX = 22; // the court axis: Jahamun, Daeungjeon, Museoljeon
  // Cheongungyo (16 steps) then Baegungyo (18 steps), with a landing between.
  flight(B, JX, 3.6, 7.5, 0.6, 0, T1, 16);
  flight(B, JX, 3.0, 0.4, -6.8, T1, T2, 18);
  // The arch under the lower flight, on both side faces.
  for (const s of [-1, 1]) {
    const a = new THREE.CircleGeometry(1.15, 10, 0, Math.PI);
    a.rotateY(s * Math.PI / 2);
    a.translate(JX + s * 1.82, 0, 4.4);
    add(B, a, INK.soffit, { shade: 0 });
  }
  // Corridors around the court.
  const cx0 = -4;
  const cx1 = 48;
  const cz0 = -8;
  const cz1 = -39;
  corridor(B, cx0 + 2, JX - 4, cz0, cz0, T2);
  corridor(B, JX + 4, cx1 - 2, cz0, cz0, T2);
  corridor(B, cx0, cx0, cz0 - 1.5, cz1 + 1.5, T2);
  corridor(B, cx1, cx1, cz0 - 1.5, cz1 + 1.5, T2);
  // Jahamun.
  hall(B, JX, T2, cz0, 7, 3.2, 3.0, { over: 1.1, h1: 1.5, h2: 0.9, lift: 0.45, kind: "paljak" }, 3);
  // Beomyeongnu (front west corner) on its stacked stone pillar, Jwagyeongnu (east).
  stackedPillar(B, cx0, -4.2, 0, T2 + 1.2);
  hall(B, cx0, T2 + 1.2, -4.2, 3.6, 3.6, 2.4, { over: 1.0, h1: 1.4, h2: 0.8, lift: 0.5, kind: "paljak" }, 2);
  box(B, cx1, 0, -4.2, 3.0, T2 + 1.2, 3.0, INK.stone);
  hall(B, cx1, T2 + 1.2, -4.2, 3.4, 3.4, 2.3, { over: 1.0, h1: 1.3, h2: 0.8, lift: 0.5, kind: "paljak" }, 2);
  // Daeungjeon on its platform.
  box(B, JX, T2, -25, 19, 1.0, 11, INK.stone);
  hall(B, JX, T2 + 1.0, -25, 15, 7.6, 3.6, { over: 1.9, h1: 2.2, h2: 1.4, lift: 0.7, kind: "paljak" }, 5);
  // Seokgatap (west) and Dabotap (east), in front of the hall; a lantern on the axis.
  seokgatap(B, JX - 9, T2, -15);
  dabotap(B, JX + 9, T2, -15);
  box(B, JX, T2, -17.5, 0.5, 1.1, 0.5, INK.stone);
  box(B, JX, T2 + 1.1, -17.5, 0.9, 0.5, 0.9, INK.paper);
  // Museoljeon behind (the court's back), long and low.
  hall(B, JX, T2, -36.5, 28, 4.4, 2.6, { over: 1.2, h1: 1.8, h2: 0, lift: 0.3, kind: "gable" }, 9);

  // -- the west court: Anyangmun, Yeonhwagyo and Chilbogyo, Geungnakjeon --------
  const AX = -26;
  flight(B, AX, 2.6, 4.4, 0.6, 0, T1, 10);
  flight(B, AX, 2.2, 0.4, -6.8, T1, T2, 8);
  corridor(B, -46, AX - 3.5, cz0, cz0, T2);
  corridor(B, AX + 3.5, cx0 - 2.2, cz0, cz0, T2);
  corridor(B, -47, -47, cz0 - 1.5, -33.5, T2);
  hall(B, AX, T2, cz0, 5.2, 2.8, 2.7, { over: 0.9, h1: 1.3, h2: 0.7, lift: 0.4, kind: "paljak" }, 3);
  box(B, AX, T2, -24, 13, 0.8, 8, INK.stone);
  hall(B, AX, T2 + 0.8, -24, 10.5, 5.6, 3.0, { over: 1.5, h1: 1.8, h2: 1.1, lift: 0.55, kind: "paljak" }, 3);

  const fill = mergeGeometries(B.fills, false)!;
  const lineGeo = mergeGeometries(B.edges, false)!;
  const extra = new THREE.BufferGeometry();
  extra.setAttribute("position", new THREE.Float32BufferAttribute(B.lines, 3));
  const lines = mergeGeometries([lineGeo, extra], false)!;
  for (const g of B.fills) g.dispose();
  for (const g of B.edges) g.dispose();
  extra.dispose();
  lineGeo.dispose();
  return { fill, lines };
}
