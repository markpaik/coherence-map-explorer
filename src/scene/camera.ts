// Camera + controls: camera-controls with heroic initial framing and a slow
// idle drift that pauses on interaction and resumes after 20s idle. The drift
// is a gentle ±18° azimuth OSCILLATION (sinusoidal, full cycle ≈ 90s) rather
// than a full orbit, so the left→right K→HS narrative never swings edge-on.
//
// Every framing — home, focus, journey, a story scene — goes through ONE
// primitive, frameSubject (scene/frame.ts): fit the subject, then compose it
// into the USABLE RECT (the viewport minus the live chrome) with the lit context
// centred. The old blanket screen-space nudges (frame shift / frame lift /
// bottom inset / panel offset) are gone: they pushed in opposite directions,
// nothing checked the result landed on screen, and the lift carried the wrong
// sign — which is why stories drifted right and down and focus clicks clipped
// off the left edge.

import * as THREE from "three";
import CameraControls from "camera-controls";
import {
  compositionBias,
  computeUsableRect,
  measureChrome,
  solveFrame,
  type FrameSolution,
} from "./frame";

CameraControls.install({ THREE });

const DRIFT_AMPLITUDE_RAD = (18 * Math.PI) / 180; // ±18° sway
const DRIFT_PERIOD_S = 90; // seconds per full oscillation
const IDLE_RESUME_MS = 20_000;

/** A subject box thinner than this on any axis is grown to it before fitting. */
const MIN_SUBJECT_EXTENT = 24;

export interface FrameOpts {
  /** false cuts instantly (reduced motion, deep links). Default true. */
  transition?: boolean;
  /**
   * The wider LIT set the subject sits in. Its weight is centred in the usable
   * rect; it may bleed past the frame edges by design. The fit retreats up to
   * `contextPullback` × the subject fit to take it in.
   */
  context?: THREE.Box3 | null;
  /** How far the fit may retreat to admit the context (1 = never). */
  contextPullback?: number;
  /**
   * Snap the view to the nearest axis before fitting (what camera-controls'
   * fitToBox does). The wide framings — home and the journey closure — always
   * have; a focus hop or a story scene keeps the reader's current orientation.
   */
  snapToAxis?: boolean;
}

export interface CameraRig {
  camera: THREE.PerspectiveCamera;
  controls: CameraControls;
  /**
   * Advance controls + idle drift. Returns true when the camera moved
   * (drives render-on-demand). Pass driftSuspended=true while the user is
   * mid-interaction elsewhere (e.g. hovering a node) so the constellation
   * doesn't slide out from under the cursor.
   */
  update(deltaSeconds: number, driftSuspended?: boolean): boolean;
  /**
   * THE framing primitive. `subject` must land fully inside the usable rect;
   * `opts.context` is the wider lit set whose weight gets centred. Everything
   * else here is a caller of this.
   */
  frameSubject(subject: THREE.Box3, opts?: FrameOpts): Promise<void>;
  /** Return to the heroic landing framing. */
  frameHome(transition?: boolean): void;
  /**
   * Frame the current home bounds head-on: azimuth 0, polar π/2, so a flat plane
   * (the Blueprint pose, z=0) faces the camera squarely. Orbit stays enabled.
   */
  frameHomeFrontOn(transition?: boolean): void;
  /**
   * Re-solve the CURRENT framing against the chrome as it is now — the panel
   * closed, the window resized, a story card appeared. Distance and subject are
   * unchanged; only the composition moves.
   */
  recompose(transition?: boolean): void;
  /**
   * Swap the "home" cloud bounds (called after a pose morph) so frameHome and
   * the tour's wide shots refit to whichever pose is now on screen. Also rescales
   * the dolly min/max distance to the new cloud radius.
   */
  setHomeBounds(box: THREE.Box3, sphere: THREE.Sphere): void;
  /** Zero the composition offset (the story surface contract's reset). */
  clearFocalOffset(transition?: boolean): void;
  setDriftEnabled(on: boolean): void;
  /**
   * Scale the idle-drift amplitude (1 = the full ±18° sway). The flat
   * Blueprint pose sets ~0.2 so the plane breathes without leaning away from
   * its front-on reading; the other poses restore 1.
   */
  setDriftScale(scale: number): void;
  /**
   * Clear the idle-resume timer so drift may run on the very next unsuspended
   * frame (skipping the 20s post-interaction grace). Used when a story scene
   * settles into a hold: the constellation should breathe immediately, not 20s
   * later. The programmatic scene flights themselves don't count as interaction,
   * but the suspended transition frames keep the timer warm — this pokes it.
   */
  resumeDriftNow(): void;
  setAspect(aspect: number): void;
  /** The last composition solve (debug/automation only). */
  lastComposition(): FrameSolution | null;
  dispose(): void;
}

/** A box that is safe to fit: never zero-extent on any axis. */
function inflate(box: THREE.Box3, out: THREE.Box3): THREE.Box3 {
  out.copy(box);
  const c = out.getCenter(new THREE.Vector3());
  const s = out.getSize(new THREE.Vector3());
  const hx = Math.max(s.x, MIN_SUBJECT_EXTENT) / 2;
  const hy = Math.max(s.y, MIN_SUBJECT_EXTENT) / 2;
  const hz = Math.max(s.z, MIN_SUBJECT_EXTENT) / 2;
  out.min.set(c.x - hx, c.y - hy, c.z - hz);
  out.max.set(c.x + hx, c.y + hy, c.z + hz);
  return out;
}

export function createCameraRig(
  domElement: HTMLElement,
  bounds: THREE.Sphere,
  boundsBox: THREE.Box3,
  opts: { reducedMotion: boolean; aspect: number },
): CameraRig {
  // Far plane covers the deep sky: star shell at r=3600 and the megaplanet
  // near r=3350 must stay inside the frustum even with the camera dollied to
  // the far side of the cloud (max dolly ~1k units → ~4.5k worst case).
  const camera = new THREE.PerspectiveCamera(50, opts.aspect, 1, 12000);
  const controls = new CameraControls(camera, domElement);

  // Home bounds are mutable: the dual-pose morph swaps them so frameHome refits
  // to whichever pose is on screen (the Ascent's massif is much taller than the
  // constellation, so its dolly range differs too).
  let homeBox = boundsBox.clone();
  let homeSphere = bounds.clone();
  function applyDistanceRange(): void {
    controls.minDistance = homeSphere.radius * 0.15;
    controls.maxDistance = homeSphere.radius * 4;
  }
  applyDistanceRange();
  controls.dollyToCursor = true;
  controls.smoothTime = 0.25;
  controls.draggingSmoothTime = 0.12;

  const _pos = new THREE.Vector3();
  const _tgt = new THREE.Vector3();
  const _center = new THREE.Vector3();

  // The framing currently on screen, so the composition can be re-solved when
  // the chrome changes (panel closes, window resizes) without refitting.
  let current: { subject: THREE.Box3; context: THREE.Box3 | null; pullback: number } | null = null;
  let lastSolution: FrameSolution | null = null;

  // Compose the CURRENT framing into the usable rect. Runs off the fit's END
  // values, so it composes with an in-flight transition rather than cutting it.
  function compose(transition: boolean): void {
    if (!current) return;
    controls.getPosition(_pos, true);
    controls.getTarget(_tgt, true);
    const chrome = measureChrome();
    lastSolution = solveFrame({
      fovDeg: camera.fov,
      viewportWidth: chrome.viewportWidth,
      viewportHeight: chrome.viewportHeight,
      rect: computeUsableRect(chrome),
      bias: compositionBias(chrome),
      eye: _pos,
      target: _tgt,
      subject: current.subject,
      context: current.context,
      maxPullback: current.pullback,
      minDistance: controls.minDistance,
      maxDistance: controls.maxDistance,
    });
    void controls.dollyTo(lastSolution.distance, transition);
    void controls.setFocalOffset(lastSolution.offsetX, lastSolution.offsetY, 0, transition);
  }

  async function frameSubject(subject: THREE.Box3, o: FrameOpts = {}): Promise<void> {
    const transition = o.transition ?? true;
    const box = inflate(subject, new THREE.Box3());
    current = {
      subject: box,
      context: o.context && !o.context.isEmpty() ? o.context.clone() : null,
      pullback: Math.max(1, o.contextPullback ?? 1),
    };
    // The FIT decides orientation + what the camera looks at; the composition
    // below decides the distance and where it lands in frame.
    let done: Promise<unknown>;
    if (o.snapToAxis) {
      done = controls.fitToBox(box, transition);
    } else {
      box.getCenter(_center);
      done = controls.moveTo(_center.x, _center.y, _center.z, transition);
    }
    compose(transition);
    await done;
  }

  function frameHome(transition = false): void {
    // Heroic 3/4 intent; fitToBox rounds the view to the nearest axis, which is
    // the straight-on read this wide flat layout has always shipped with.
    void controls.rotateTo(0.42, Math.PI / 2 - 0.22, transition);
    void frameSubject(homeBox, { transition, snapToAxis: true });
  }
  // Head-on framing for the flat Blueprint pose: reset azimuth/polar to look
  // straight down the +z axis at the plane, then fit its box from that angle.
  function frameHomeFrontOn(transition = false): void {
    void controls.rotateTo(0, Math.PI / 2, transition);
    void frameSubject(homeBox, { transition, snapToAxis: true });
  }

  frameHome(false);
  controls.update(0);

  // -- idle drift (oscillation) ----------------------------------------
  // driftClock advances only while drifting, so pausing then resuming picks up
  // the sway exactly where it left off (no snap). We apply the FRAME DELTA of
  // the sine, so the oscillation rides on top of wherever the user left the
  // camera rather than yanking it back to a fixed azimuth.
  let driftEnabled = !opts.reducedMotion;
  let driftScale = 1; // Blueprint quiets the sway to ~0.2 (see setDriftScale)
  let lastInteraction = -Infinity; // drift immediately on load
  let driftClock = 0;
  const swayAt = (t: number): number =>
    DRIFT_AMPLITUDE_RAD * driftScale * Math.sin((t / DRIFT_PERIOD_S) * Math.PI * 2);
  const onInteract = (): void => {
    lastInteraction = performance.now();
  };
  controls.addEventListener("controlstart", onInteract);
  controls.addEventListener("control", onInteract);

  return {
    camera,
    controls,
    update(delta, driftSuspended = false) {
      let moved = false;
      if (driftSuspended) {
        lastInteraction = performance.now(); // hover / focus counts as interaction
      } else if (driftEnabled && performance.now() - lastInteraction > IDLE_RESUME_MS) {
        const prev = swayAt(driftClock);
        driftClock += delta;
        controls.azimuthAngle += swayAt(driftClock) - prev;
        moved = true;
      }
      const updated = controls.update(delta);
      return moved || updated;
    },
    frameSubject,
    frameHome(transition = true) {
      frameHome(transition);
    },
    frameHomeFrontOn(transition = true) {
      frameHomeFrontOn(transition);
    },
    recompose(transition = true) {
      compose(transition);
    },
    setHomeBounds(box, sphere) {
      homeBox = box.clone();
      homeSphere = sphere.clone();
      applyDistanceRange();
    },
    clearFocalOffset(transition = true) {
      void controls.setFocalOffset(0, 0, 0, transition);
    },
    setDriftEnabled(on) {
      driftEnabled = on;
    },
    setDriftScale(scale) {
      driftScale = scale;
    },
    resumeDriftNow() {
      lastInteraction = -Infinity;
    },
    setAspect(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    lastComposition() {
      return lastSolution;
    },
    dispose() {
      controls.removeEventListener("controlstart", onInteract);
      controls.removeEventListener("control", onInteract);
      controls.dispose();
    },
  };
}
