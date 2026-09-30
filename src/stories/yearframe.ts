// Lose-a-year framing: keep the chosen year inside the story's keep-out rect.
//
// The interactive story frames the chosen grade plus its downstream band, and
// the chosen grade is the argument: every one of its standards must read. The
// camera's composition primitive (scene/frame.ts) already composes into the
// story's usable rect, which leaves out the story card's column, the masthead
// and the scrubber band (designer rules F1 to F3), so the year lands clear of
// all three on the frame it arrives at. One thing the solve does not see is
// the idle drift: the camera keeps breathing after the frame lands, turning up
// to ±18° about the vertical, and the Ascent's grade columns are deep (200-300
// world units front to back), so a year framed near an edge of the rect slides
// out of it, back under the card or off the far side.
//
// This module plans against exactly that. It adds no camera API: it plans with
// the same pure solve the rig composes with (solveFrame, over the same usable
// rect) and hands the rig one ordinary box for rig.frameSubject. When a keep
// point would leave the rect at some turn of the sway, it PADS the subject so
// the padding takes the edge and the year moves inward: toward one side (the
// year moves away from the edge it crossed) or all round (the frame pulls back
// a step). Every pad is searched, and the one that frames largest wins. Pure:
// unit-tested in tests/lose-year.test.ts.
//
// History: the first version padded toward the story card only, because the
// solve then gave the card a small bias rather than a keep-out. At 900x700 that
// "down" pad squeezed the year into the strip above the card and under the
// title (the F3 note). The card and the masthead are now keep-outs of the rect
// itself, so one rule serves every story.

import * as THREE from "three";
import { solveFrame, type Rect } from "../scene/frame";

export interface ClearFrameInput {
  /** Vertical field of view, DEGREES (rig.camera.fov). */
  fovDeg: number;
  viewportWidth: number;
  viewportHeight: number;
  /** computeUsableRect(measureChrome()): the keep-out-aware rect the rig composes into. */
  rect: Rect;
  /** The camera's view direction at the fit's END (target − eye); length ignored. */
  view: THREE.Vector3;
  /** What must be framed: the chosen grade plus its downstream band. */
  subject: THREE.Box3;
  /** Points that must land inside the rect (the chosen grade's standards). */
  keep: readonly THREE.Vector3[];
  /** Clearance kept inside the rect's edges, CSS px (default 0: the rect already
   *  stands one gutter clear of the card and the masthead). */
  gapPx?: number;
  /**
   * The idle drift's azimuth sway, radians (0 = the camera holds still, as under
   * reduced motion). The camera orbits the target about the vertical after the
   * frame lands, so each keep point must stay inside the rect at every azimuth
   * within ±sway of the current view.
   */
  swayRad?: number;
  minDistance?: number;
  maxDistance?: number;
}

export type ClearSide = "none" | "left" | "right" | "up" | "down" | "round";

export interface ClearFrame {
  /** The box to hand rig.frameSubject. */
  box: THREE.Box3;
  /** Which way the subject was padded ("none" = it already stayed inside). */
  side: ClearSide;
  /** Keep points that leave the rect at the planned solve, at any turn (0 = clear). */
  covered: number;
  /** The planned camera distance (smaller = the subject frames larger). */
  distance: number;
}

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
 * Plan a framing whose `keep` points all stay inside `rect` at every turn of
 * the sway. Returns the subject untouched when they already do; otherwise the
 * smallest pad (one side, or all round, whichever frames larger) that keeps
 * them all in. When no pad can (a very narrow window), the pad that loses the
 * fewest wins.
 */
export function planClearFrame(input: ClearFrameInput): ClearFrame {
  const W = Math.max(1, input.viewportWidth);
  const H = Math.max(1, input.viewportHeight);
  const gap = Math.max(0, input.gapPx ?? 0);
  const k = H / 2 / Math.tan((input.fovDeg * Math.PI) / 360);
  const r = input.rect;
  const x0 = r.x + gap;
  const x1 = r.x + r.width - gap;
  const y0 = r.y + gap;
  const y1 = r.y + r.height - gap;
  const outside = (sx: number, sy: number): boolean => sx < x0 || sx > x1 || sy < y0 || sy > y1;

  // The camera basis frame.ts builds from (eye, target); the view never rolls.
  const fwd = input.view.clone();
  if (fwd.lengthSq() < 1e-12) fwd.set(0, 0, -1);
  fwd.normalize();
  const right = fwd.clone().cross(WORLD_UP);
  if (right.lengthSq() < 1e-12) right.set(1, 0, 0);
  right.normalize();
  const up = right.clone().cross(fwd).normalize();

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
      rect: r,
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
        const sx = W / 2 + (k * (d.dot(right) - sol.offsetX)) / vf;
        const sy = H / 2 - (k * (d.dot(up) + sol.offsetY)) / vf;
        if (vf <= 1e-4 || outside(sx, sy)) {
          covered++;
          break; // one point counts once, however many turns it is out at
        }
      }
    }
    return { covered, distance: sol.distance };
  }

  const base = input.subject.clone();
  const plain = evaluate(base);
  if (plain.covered === 0) {
    return { box: base, side: "none", covered: 0, distance: plain.distance };
  }

  const baseCorners = corners(base);
  const padded = (dirs: THREE.Vector3[], amount: number): THREE.Box3 => {
    const box = base.clone();
    for (const dir of dirs) {
      const shift = dir.clone().multiplyScalar(amount);
      for (const c of baseCorners) box.expandByPoint(c.clone().add(shift));
    }
    return box;
  };
  const size = base.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z, 1);

  // The smallest pad along `dirs` that keeps every keep point in: grow until it
  // does (or the pad is absurd), then bisect back down to the edge.
  function search(side: ClearSide, dirs: THREE.Vector3[]): ClearFrame {
    let lo = 0;
    let hi = extent * 0.1;
    let best = { amount: 0, ...plain };
    let res = evaluate(padded(dirs, hi));
    while (res.covered > 0 && hi < extent * 8) {
      if (res.covered < best.covered) best = { amount: hi, ...res };
      lo = hi;
      hi *= 1.6;
      res = evaluate(padded(dirs, hi));
    }
    if (res.covered > 0) {
      if (res.covered < best.covered) best = { amount: hi, ...res };
      return { box: padded(dirs, best.amount), side, covered: best.covered, distance: best.distance };
    }
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      const m = evaluate(padded(dirs, mid));
      if (m.covered === 0) {
        hi = mid;
        res = m;
      } else {
        lo = mid;
      }
    }
    return { box: padded(dirs, hi), side, covered: 0, distance: res.distance };
  }

  const toLeft = right.clone().negate();
  const toDown = up.clone().negate();
  const plans = [
    search("left", [toLeft]),
    search("right", [right]),
    search("down", [toDown]),
    search("up", [up]),
    search("round", [toLeft, right, toDown, up]),
  ];
  let win = plans[0];
  for (const p of plans.slice(1)) {
    if (p.covered < win.covered || (p.covered === win.covered && p.distance < win.distance)) win = p;
  }
  return win;
}
