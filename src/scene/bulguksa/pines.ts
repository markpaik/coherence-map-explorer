// Korean red pines under snow, as real geometry: a leaning tapered trunk with
// ink-ruled bark plates, a few near-horizontal limbs, and needle pads held out
// in flat fans (dark ink masses), each pad carrying a pillow of snow with a
// soft grey wash where the snow meets the needles. Two large pines frame the
// home view, and smaller ones stand on the slope. All of it merges into one
// fill geometry and one line geometry (the trunk and limb facets).

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { lhash } from "../landscape";
import { INK, PINES, floorY, type PineSpec } from "./params";

const LIGHT = new THREE.Vector3(-0.45, 0.8, 0.4).normalize();
const col = (hex: number): THREE.Color => new THREE.Color().setHex(hex);

/** A tapered tube along a curve, with per-vertex bark plates (ink and lighter bark). */
function limb(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, seg: number, seed: number): THREE.BufferGeometry {
  const radial = 6;
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = g.getAttribute("position");
  const c = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    curve.getPointAt(t, c);
    const r = r0 + (r1 - r0) * Math.pow(t, 0.8);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      p.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, p.x, p.y, p.z);
    }
  }
  const ng = g.toNonIndexed();
  g.dispose();
  ng.deleteAttribute("uv");
  ng.deleteAttribute("normal");
  // Bark plates: long vertical scales, ink or bark tone by a hash per plate.
  const P = ng.getAttribute("position");
  const colors = new Float32Array(P.count * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const d = new THREE.Vector3();
  const bark = col(INK.bark);
  const dark = col(INK.barkDark);
  for (let v = 0; v < P.count; v += 3) {
    a.fromBufferAttribute(P, v);
    b.fromBufferAttribute(P, v + 1);
    d.fromBufferAttribute(P, v + 2);
    const cy = (a.y + b.y + d.y) / 3;
    const ang = Math.atan2(a.z + b.z + d.z, a.x + b.x + d.x);
    const plate = lhash(seed, Math.floor(cy / 14) * 7 + Math.floor((ang + Math.PI) * 1.5));
    const n = b.clone().sub(a).cross(d.clone().sub(a)).normalize();
    const lit = 0.75 + 0.25 * Math.max(0, n.dot(LIGHT));
    const base = plate < 0.42 ? dark : bark;
    for (let j = 0; j < 3; j++) colors.set([base.r * lit, base.g * lit, base.b * lit], (v + j) * 3);
  }
  ng.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return ng;
}

/** One needle pad (a flat fan) with its snow pillow on top. */
function pad(cx: number, cy: number, cz: number, rx: number, rz: number, rot: number, seed: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const n = new THREE.IcosahedronGeometry(1, 2);
  // A ragged needle rim: each rim vertex pushed in or out a little.
  const R0 = n.getAttribute("position");
  for (let v = 0; v < R0.count; v++) {
    const x = R0.getX(v);
    const z = R0.getZ(v);
    const k = 0.82 + 0.3 * lhash(seed + 77, Math.round((Math.atan2(z, x) + 3.2) * 9));
    R0.setXYZ(v, x * k, R0.getY(v), z * k);
  }
  n.scale(rx, rx * 0.22, rz);
  n.rotateY(rot);
  n.translate(cx, cy, cz);
  n.deleteAttribute("uv");
  n.deleteAttribute("normal");
  const P = n.getAttribute("position");
  const colors = new Float32Array(P.count * 3);
  const ink = col(INK.pad);
  for (let v = 0; v < P.count; v++) {
    // The needles are one dark mass, a touch lighter at the fan's ragged rim.
    const dx = (P.getX(v) - cx) / rx;
    const dz = (P.getZ(v) - cz) / rz;
    const rim = Math.min(1, Math.hypot(dx, dz));
    const k = 1 + 0.5 * rim * rim * lhash(seed, v);
    colors.set([ink.r * k, ink.g * k, ink.b * k], v * 3);
  }
  n.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  out.push(n);
  // Snow pillow: the upper half of a smaller, softer ellipsoid, seated on the pad.
  const snow = new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  snow.scale(rx * 0.86, rx * 0.2, rz * 0.82);
  snow.rotateY(rot);
  snow.translate(cx, cy + rx * 0.06, cz);
  const s = snow.toNonIndexed();
  snow.dispose();
  s.deleteAttribute("uv");
  s.deleteAttribute("normal");
  const S = s.getAttribute("position");
  const sc = new Float32Array(S.count * 3);
  const paper = col(INK.paper);
  const wash = col(INK.padShadow);
  for (let v = 0; v < S.count; v++) {
    // A soft grey wash at the pillow's lower rim, where it meets the needles.
    const up = (S.getY(v) - (cy + rx * 0.06)) / (rx * 0.2);
    const k = Math.min(1, Math.max(0, up / 0.35));
    const c = wash.clone().lerp(paper, k);
    sc.set([c.r, c.g, c.b], v * 3);
  }
  s.setAttribute("color", new THREE.BufferAttribute(sc, 3));
  out.push(s);
  return out;
}

function pine(spec: PineSpec, fills: THREE.BufferGeometry[], lines: THREE.BufferGeometry[]): THREE.Vector3 {
  const y0 = floorY(Math.hypot(spec.x, spec.z)) - 6;
  const H = spec.h;
  const sd = spec.seed;
  // Trunk: leaning, with two slow bends (a Korean red pine's S).
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    const bend = Math.sin(t * Math.PI * 1.3 + lhash(sd, 1) * 2) * H * 0.06;
    pts.push(
      new THREE.Vector3(
        spec.x + Math.sin(spec.lean) * H * t * t * 0.9 + bend,
        y0 + H * t,
        spec.z + (lhash(sd, 2) - 0.5) * H * 0.15 * t,
      ),
    );
  }
  const trunk = new THREE.CatmullRomCurve3(pts);
  const rBase = H * 0.045;
  const tg = limb(trunk, rBase, rBase * 0.35, 18, sd);
  fills.push(tg);
  lines.push(new THREE.EdgesGeometry(tg, 20));
  // Limbs from the upper trunk, mostly toward the reach side, ending in pads.
  const nLimbs = 5 + Math.floor(lhash(sd, 3) * 3);
  const dirSide = spec.limbSide ?? (Math.sign(Math.sin(spec.lean)) || 1);
  for (let k = 0; k < nLimbs; k++) {
    const t = 0.5 + (0.5 * (k + 0.5)) / nLimbs;
    const o = trunk.getPointAt(t);
    const side = k % 3 === 2 ? -dirSide : dirSide;
    const ang = (lhash(sd, 10 + k) - 0.5) * 1.6;
    const len = spec.reach * (0.45 + 0.55 * lhash(sd, 20 + k)) * (1.15 - 0.5 * t) * (side === dirSide ? 1 : 0.55);
    const end = new THREE.Vector3(
      o.x + side * Math.cos(ang) * len,
      o.y + len * (0.05 + 0.18 * lhash(sd, 30 + k)),
      o.z + Math.sin(ang) * len * 0.8,
    );
    const mid = o.clone().lerp(end, 0.5);
    mid.y -= len * 0.08;
    const curve = new THREE.CatmullRomCurve3([o, mid, end]);
    const lg = limb(curve, rBase * 0.26, rBase * 0.08, 8, sd + k);
    fills.push(lg);
    lines.push(new THREE.EdgesGeometry(lg, 20));
    // Pads: a main fan at the tip, one or two smaller along the limb.
    const pr = spec.reach * (0.16 + 0.07 * lhash(sd, 40 + k));
    fills.push(...pad(end.x, end.y + pr * 0.1, end.z, pr, pr * 0.72, ang, sd * 7 + k));
    const p2 = curve.getPointAt(0.55);
    fills.push(...pad(p2.x, p2.y + pr * 0.18, p2.z, pr * 0.62, pr * 0.5, ang + 0.6, sd * 9 + k));
  }
  // A crown pad at the top.
  const top = trunk.getPointAt(1);
  const cr = spec.reach * 0.26;
  fills.push(...pad(top.x, top.y + cr * 0.12, top.z, cr, cr * 0.75, lhash(sd, 50), sd * 11));
  return trunk.getPointAt(0.8);
}

/** Tag every vertex with its pine's crown center (the view fade reads it). */
function tag(g: THREE.BufferGeometry, c: THREE.Vector3): THREE.BufferGeometry {
  const n = g.getAttribute("position").count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.x, c.y, c.z], i * 3);
  g.setAttribute("aCrown", new THREE.BufferAttribute(a, 3));
  return g;
}

export interface PinesBuild {
  fill: THREE.BufferGeometry;
  lines: THREE.BufferGeometry;
}

export function buildPines(): PinesBuild {
  const fills: THREE.BufferGeometry[] = [];
  const lines: THREE.BufferGeometry[] = [];
  for (const p of PINES) {
    const f: THREE.BufferGeometry[] = [];
    const l: THREE.BufferGeometry[] = [];
    const c = pine(p, f, l);
    for (const g of f) fills.push(tag(g, c));
    for (const g of l) lines.push(tag(g, c));
  }
  const fill = mergeGeometries(fills, false)!;
  const line = mergeGeometries(lines, false)!;
  for (const g of fills) g.dispose();
  for (const g of lines) g.dispose();
  return { fill, lines: line };
}
