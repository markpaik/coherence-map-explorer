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
  /** Smooth flight to frame a neighborhood. transition=false cuts instantly. */
  focusOn(sphere: THREE.Sphere, transition?: boolean): Promise<void>;
  setDriftEnabled(on: boolean): void;
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

  controls.smoothTime = 0.25;
  controls.draggingSmoothTime = 0.12;
  controls.dollyToCursor = true;
  controls.minDistance = bounds.radius * 0.15;
  controls.maxDistance = bounds.radius * 4;

  // Initial framing: heroic 3/4 view — slightly right of straight-on,
  // slightly above the plane — then fit the cloud's BOX from that direction
  // (fitToSphere over-shoots badly on this wide flat layout: the sphere is
  // dominated by the x-extent, leaving the cloud small in frame).
  void controls.rotateTo(0.42, Math.PI / 2 - 0.22, false);
  void controls.fitToBox(boundsBox, false, {
    paddingTop: 30,
    paddingBottom: 80, // breathing room above the search rail + grade etches
    paddingLeft: 40,
    paddingRight: 40,
  });
  controls.update(0);

  // -- idle drift (oscillation) ----------------------------------------
  // driftClock advances only while drifting, so pausing then resuming picks up
  // the sway exactly where it left off (no snap). We apply the FRAME DELTA of
  // the sine, so the oscillation rides on top of wherever the user left the
  // camera rather than yanking it back to a fixed azimuth.
  let driftEnabled = !opts.reducedMotion;
  let lastInteraction = -Infinity; // drift immediately on load
  let driftClock = 0;
  const swayAt = (t: number): number =>
    DRIFT_AMPLITUDE_RAD * Math.sin((t / DRIFT_PERIOD_S) * Math.PI * 2);
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
    async focusOn(sphere, transition = true) {
      const target = new THREE.Sphere(sphere.center.clone(), sphere.radius * 1.35);
      await controls.fitToSphere(target, transition);
    },
    setDriftEnabled(on) {
      driftEnabled = on;
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
