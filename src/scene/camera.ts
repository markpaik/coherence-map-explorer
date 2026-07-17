// Camera + controls: camera-controls with heroic initial framing and a slow
// idle drift that pauses on interaction and resumes after 20s idle. The drift
// is a gentle ±18° azimuth OSCILLATION (sinusoidal, full cycle ≈ 90s) rather
// than a full orbit, so the left→right K→HS narrative never swings edge-on.
// Exposes focusOn(sphere) for Phase 3's focus flights.

import * as THREE from "three";
import CameraControls from "camera-controls";

CameraControls.install({ THREE });

const DRIFT_AMPLITUDE_RAD = (18 * Math.PI) / 180; // ±18° sway
const DRIFT_PERIOD_S = 90; // seconds per full oscillation
const IDLE_RESUME_MS = 20_000;

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
   * Smooth flight to frame a neighborhood. transition=false cuts instantly.
   * panelOffsetPx shifts the framed target LEFT of center by that many CSS px
   * (converted to world units at the fitted distance) so an open right-side
   * panel doesn't sit on top of the focus — 0 clears any prior offset.
   */
  focusOn(sphere: THREE.Sphere, transition?: boolean, panelOffsetPx?: number): Promise<void>;
  /** Return to the heroic landing framing and clear any panel focal offset. */
  frameHome(transition?: boolean): void;
  /**
   * Frame the current home bounds head-on: azimuth 0, polar π/2, so a flat plane
   * (the Blueprint pose, z=0) faces the camera squarely. Orbit stays enabled.
   */
  frameHomeFrontOn(transition?: boolean): void;
  /**
   * Swap the "home" cloud bounds (called after a pose morph) so frameHome and
   * the tour's wide shots refit to whichever pose is now on screen. Also rescales
   * the dolly min/max distance to the new cloud radius.
   */
  setHomeBounds(box: THREE.Box3, sphere: THREE.Sphere): void;
  /** Clear the panel focal offset (used when the panel closes with no reframe). */
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
  dispose(): void;
}

export function createCameraRig(
  domElement: HTMLElement,
  bounds: THREE.Sphere,
  boundsBox: THREE.Box3,
  opts: { reducedMotion: boolean; aspect: number },
): CameraRig {
  const camera = new THREE.PerspectiveCamera(50, opts.aspect, 1, 5000);
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

  // Initial framing: heroic 3/4 view — slightly right of straight-on,
  // slightly above the plane — then fit the cloud's BOX from that direction
  // (fitToSphere over-shoots badly on this wide flat layout: the sphere is
  // dominated by the x-extent, leaving the cloud small in frame).
  function frameHome(transition = false): void {
    void controls.setFocalOffset(0, 0, 0, transition);
    void controls.rotateTo(0.42, Math.PI / 2 - 0.22, transition);
    void controls.fitToBox(homeBox, transition, {
      paddingTop: 30,
      paddingBottom: 80, // breathing room above the search rail + grade etches
      paddingLeft: 40,
      paddingRight: 40,
    });
  }
  // Head-on framing for the flat Blueprint pose: reset azimuth/polar to look
  // straight down the +z axis at the plane, then fit its box from that angle.
  function frameHomeFrontOn(transition = false): void {
    void controls.setFocalOffset(0, 0, 0, transition);
    void controls.rotateTo(0, Math.PI / 2, transition);
    void controls.fitToBox(homeBox, transition, {
      paddingTop: 30,
      paddingBottom: 80,
      paddingLeft: 40,
      paddingRight: 40,
    });
  }

  frameHome(false);
  controls.update(0);

  // Convert a screen-space nudge (CSS px) at the current fitted distance into
  // world units, then push the framed target LEFT of center via focalOffset.
  const _pos = new THREE.Vector3();
  const _tgt = new THREE.Vector3();
  function applyPanelOffset(panelOffsetPx: number, transition: boolean): void {
    if (!panelOffsetPx) {
      void controls.setFocalOffset(0, 0, 0, transition);
      return;
    }
    controls.getPosition(_pos, true);
    controls.getTarget(_tgt, true);
    const distance = _pos.distanceTo(_tgt);
    const worldPerPx =
      (2 * distance * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(window.innerHeight, 1);
    // +x focalOffset pans the camera right → the target rides to the LEFT.
    void controls.setFocalOffset(panelOffsetPx * worldPerPx, 0, 0, transition);
  }

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
    async focusOn(sphere, transition = true, panelOffsetPx = 0) {
      const target = new THREE.Sphere(sphere.center.clone(), sphere.radius * 1.35);
      // fitToSphere sets the goal synchronously; apply the panel offset off the
      // fitted END values so both animate together rather than in two steps.
      const done = controls.fitToSphere(target, transition);
      applyPanelOffset(panelOffsetPx, transition);
      await done;
    },
    frameHome(transition = true) {
      frameHome(transition);
    },
    frameHomeFrontOn(transition = true) {
      frameHomeFrontOn(transition);
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
    dispose() {
      controls.removeEventListener("controlstart", onInteract);
      controls.removeEventListener("control", onInteract);
      controls.dispose();
    },
  };
}
