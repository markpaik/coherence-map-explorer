// Lose-a-year framing: keep the chosen year clear of the story card.
//
// The interactive story's card sits bottom-LEFT on desktop, and the Ascent lays
// the grades out left to right with kindergarten lowest — so the whole-map
// framing put K, 1 and 2 entirely under the card, and at 1280x720 most of
// grade 3 too. The camera's composition primitive (scene/frame.ts) gives that
// card only a modest sideways bias by design: for an authored scene the card
// may overlap the lower-left corner of the frame. Here the lower-left corner IS
// the argument, so this module plans a framing that keeps it clear.
//
// It adds no camera API. It plans with the same pure solve the rig composes
// with (solveFrame, over the chrome-aware usable rect), and hands the rig one
// ordinary box for rig.frameSubject: the subject (the chosen grade plus its
// downstream band) PADDED toward the card, so the padding is what lands under
// the card and the standards land beside or above it. Both pads are tried —
// left (the year sits right of the card) and down (the year sits above it) —
// and the one that frames larger wins. Pure: unit-tested in
// tests/lose-year-frame.test.ts.

import * as THREE from "three";
import { solveFrame, type Rect } from "../scene/frame";

export interface ClearFrameInput {
  /** Vertical field of view, DEGREES (rig.camera.fov). */
  fovDeg: number;
  viewportWidth: number;
  viewportHeight: number;
  /** computeUsableRect(measureChrome()) — the rect the rig composes into. */
  rect: Rect;
  /** compositionBias(measureChrome()) — the rig's own card bias. */
  bias?: { x: number; y: number };
  /** The camera's view direction at the fit's END (target − eye); length ignored. */
  view: THREE.Vector3;
  /** What must be framed: the chosen grade plus its downstream band. */
  subject: THREE.Box3;
  /** Points that must land clear of the occluder (the chosen grade's standards). */
  keep: readonly THREE.Vector3[];
  /** The occluder's on-screen rect in CSS px (the story card); null = none. */
  occluder: Rect | null;
  /** Clearance kept around the occluder, CSS px. */
  gapPx?: number;
  /**
   * The idle drift's azimuth sway, radians (0 = the camera holds still, as under
   * reduced motion). The camera keeps breathing after the frame lands, orbiting
   * the target about the vertical, so a year framed a pixel clear would slide
   * back under the card. Each keep point must clear at every azimuth within
   * ±sway of the current view.
   */
  swayRad?: number;
  minDistance?: number;
  maxDistance?: number;
}

export interface ClearFrame {
  /** The box to hand rig.frameSubject. */
  box: THREE.Box3;
  /** Which way the subject was padded ("none" = it already cleared). */
  side: "none" | "left" | "down";
  /** Keep points still inside the occluder at the planned solve (0 = clear). */
  covered: number;
  /** The planned camera distance (smaller = the subject frames larger). */
  distance: number;
}

const DEFAULT_GAP_PX = 14;
/** Mirrors camera.ts: frameSubject grows a box thinner than this on any axis. */
const MIN_SUBJECT_EXTENT = 24;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function inflate(box: THREE.Box3): THREE.Box3 {
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const h = new THREE.Vector3(
    Math.max(s.x, MIN_SUBJECT_EXTENT) / 2,
    Math.max(s.y, MIN_SUBJECT_EXTENT) / 2,
    Math.max(s.z, MIN_SUBJECT_EXTENT) / 2,
  );
  return new THREE.Box3(c.clone().sub(h), c.clone().add(h));
}

function corners(box: THREE.Box3): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

/**
 * Plan a framing whose `keep` points all land clear of `occluder`. Returns the
 * subject untouched when it already clears; otherwise the smallest pad (left or
 * down, whichever frames larger) that clears every keep point. When no pad can
 * clear them all (a very narrow window), the pad that covers the fewest wins.
 */
export function planClearFrame(input: ClearFrameInput): ClearFrame {
  const W = Math.max(1, input.viewportWidth);
  const H = Math.max(1, input.viewportHeight);
  const gap = input.gapPx ?? DEFAULT_GAP_PX;
  const k = H / 2 / Math.tan((input.fovDeg * Math.PI) / 360);

  // The camera basis frame.ts builds from (eye, target); the view never rolls.
  const fwd = input.view.clone();
  if (fwd.lengthSq() < 1e-12) fwd.set(0, 0, -1);
  fwd.normalize();
  const right = fwd.clone().cross(WORLD_UP);
  if (right.lengthSq() < 1e-12) right.set(1, 0, 0);
  right.normalize();
  const up = right.clone().cross(fwd).normalize();

  const occ = input.occluder;
  const inOccluder = (sx: number, sy: number): boolean =>
    !!occ &&
    sx >= occ.x - gap &&
    sx <= occ.x + occ.width + gap &&
    sy >= occ.y - gap &&
    sy <= occ.y + occ.height + gap;

  // The drift orbits the camera about the vertical through the target, and the
  // composition offset rides with it (it is camera-local), which is the same as
  // turning the points the other way about that axis under a fixed solution.
  const sway = Math.max(0, input.swayRad ?? 0);
  const turns = sway > 0 ? [0, -sway, sway, -sway / 2, sway / 2] : [0];
  const turnQ = turns.map((a) => new THREE.Quaternion().setFromAxisAngle(WORLD_UP, a));

  // Solve exactly as rig.frameSubject will: inflate, look at the box centre
  // along the current view, compose into the usable rect. Then project each
  // keep point through that solution (frame.ts projectCorners, point by point).
  const d = new THREE.Vector3();
  function evaluate(box: THREE.Box3): { covered: number; distance: number } {
    const fitted = inflate(box);
    const target = fitted.getCenter(new THREE.Vector3());
    const eye = target.clone().sub(fwd);
    const sol = solveFrame({
      fovDeg: input.fovDeg,
      viewportWidth: W,
      viewportHeight: H,
      rect: input.rect,
      bias: input.bias,
      eye,
      target,
      subject: fitted,
      context: null,
      minDistance: input.minDistance,
      maxDistance: input.maxDistance,
    });
    let covered = 0;
    for (const p of input.keep) {
      for (const q of turnQ) {
        d.copy(p).sub(target).applyQuaternion(q);
        const vf = d.dot(fwd) + sol.distance;
        if (vf <= 1e-4) continue; // behind the camera: not on screen at all
        const sx = W / 2 + (k * (d.dot(right) - sol.offsetX)) / vf;
        const sy = H / 2 - (k * (d.dot(up) + sol.offsetY)) / vf;
        if (inOccluder(sx, sy)) {
          covered++;
          break; // one point counts once, however many turns it is covered at
        }
      }
    }
    return { covered, distance: sol.distance };
  }

  const base = input.subject.clone();
  const plain = evaluate(base);
  if (!occ || plain.covered === 0) {
    return { box: base, side: "none", covered: plain.covered, distance: plain.distance };
  }

  const baseCorners = corners(base);
  const padded = (dir: THREE.Vector3, amount: number): THREE.Box3 => {
    const box = base.clone();
    const shift = dir.clone().multiplyScalar(amount);
    for (const c of baseCorners) box.expandByPoint(c.clone().add(shift));
    return box;
  };
  const size = base.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z, 1);

  // The smallest pad along `dir` that clears every keep point: grow until it
  // clears (or the pad is absurd), then bisect back down to the edge.
  function search(side: "left" | "down", dir: THREE.Vector3): ClearFrame {
    let lo = 0;
    let hi = extent * 0.1;
    let best = { amount: 0, ...plain };
    let r = evaluate(padded(dir, hi));
    while (r.covered > 0 && hi < extent * 8) {
      if (r.covered < best.covered) best = { amount: hi, ...r };
      lo = hi;
      hi *= 1.6;
      r = evaluate(padded(dir, hi));
    }
    if (r.covered > 0) {
      if (r.covered < best.covered) best = { amount: hi, ...r };
      return { box: padded(dir, best.amount), side, covered: best.covered, distance: best.distance };
    }
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      const m = evaluate(padded(dir, mid));
      if (m.covered === 0) {
        hi = mid;
        r = m;
      } else {
        lo = mid;
      }
    }
    return { box: padded(dir, hi), side, covered: 0, distance: r.distance };
  }

  const left = search("left", right.clone().negate());
  const down = search("down", up.clone().negate());
  if (left.covered !== down.covered) return left.covered < down.covered ? left : down;
  return left.distance <= down.distance ? left : down;
}
