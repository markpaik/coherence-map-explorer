// Korean red pines under snow, painted rather than modeled. The trunk and
// limbs are smooth tapered tubes whose ink is drawn in the fragment shader: a
// soft wet-ink edge at the silhouette (from the facing ratio, so no facet ever
// shows) and plated bark as dark strokes across the trunk, keyed to the
// trunk's own length and angle. The needle pads are camera-facing cards drawn
// as signed-distance needle fans with ragged radiating tips, a snow pillow of
// reserved paper on top, and a soft grey wash where the snow meets the
// needles. Two framing pines stand at the edges of the home view, and smaller
// ones stand on the slope. Two draw calls in all.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { lhash } from "../landscape";
import { PINES, floorY, type PineSpec } from "./params";

/** One pad card: center, half-width, half-height, seed, and its pine's crown. */
export interface PadSpec {
  c: THREE.Vector3;
  rx: number;
  ry: number;
  seed: number;
  crown: THREE.Vector3;
}

/** A smooth tapered tube along a curve, with bark coordinates (length, angle). */
function limb(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, seg: number, crown: THREE.Vector3): THREE.BufferGeometry {
  const radial = 12;
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = g.getAttribute("position");
  const c = new THREE.Vector3();
  const p = new THREE.Vector3();
  const bark = new Float32Array(pos.count * 2);
  const len = curve.getLength();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    curve.getPointAt(t, c);
    const r = r0 + (r1 - r0) * Math.pow(t, 0.8);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      p.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, p.x, p.y, p.z);
      bark[k * 2] = t * len;
      bark[k * 2 + 1] = j / radial;
    }
  }
  g.deleteAttribute("uv");
  g.computeVertexNormals();
  g.setAttribute("aBark", new THREE.BufferAttribute(bark, 2));
  const cr = new Float32Array(pos.count * 3);
  for (let k = 0; k < pos.count; k++) cr.set([crown.x, crown.y, crown.z], k * 3);
  g.setAttribute("aCrown", new THREE.BufferAttribute(cr, 3));
  return g;
}

function pine(spec: PineSpec, wood: THREE.BufferGeometry[], pads: PadSpec[]): void {
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
  const crown = trunk.getPointAt(0.8);
  const rBase = H * 0.045;
  wood.push(limb(trunk, rBase, rBase * 0.35, 24, crown));
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
    wood.push(limb(curve, rBase * 0.26, rBase * 0.08, 10, crown));
    // Fans: one at the tip, one along the limb.
    const pr = spec.reach * (0.19 + 0.07 * lhash(sd, 40 + k));
    pads.push({ c: end.clone().add(new THREE.Vector3(0, pr * 0.12, 0)), rx: pr, ry: pr * 0.5, seed: lhash(sd, 60 + k), crown });
    const p2 = curve.getPointAt(0.55);
    pads.push({ c: p2.add(new THREE.Vector3(0, pr * 0.2, 0)), rx: pr * 0.7, ry: pr * 0.4, seed: lhash(sd, 70 + k), crown });
  }
  const top = trunk.getPointAt(1);
  const cr = spec.reach * 0.26;
  pads.push({ c: top.clone().add(new THREE.Vector3(0, cr * 0.12, 0)), rx: cr, ry: cr * 0.45, seed: lhash(sd, 50), crown });
}

export interface PinesBuild {
  wood: THREE.BufferGeometry;
  pads: PadSpec[];
}

export function buildPines(): PinesBuild {
  const wood: THREE.BufferGeometry[] = [];
  const pads: PadSpec[] = [];
  for (const p of PINES) pine(p, wood, pads);
  const merged = mergeGeometries(wood, false)!;
  for (const g of wood) g.dispose();
  return { wood: merged, pads };
}
