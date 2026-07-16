// Camera + controls: camera-controls with heroic initial framing and a slow
// idle drift (one revolution ≈ 240s) that pauses on interaction and resumes
// after 20s idle. Exposes focusOn(sphere) for Phase 3's focus flights.

import * as THREE from "three";
import CameraControls from "camera-controls";

CameraControls.install({ THREE });

const DRIFT_RAD_PER_SEC = (Math.PI * 2) / 240;
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
  /** Phase 3 API: smooth flight to frame a neighborhood. Not wired to clicks yet. */
  focusOn(sphere: THREE.Sphere): Promise<void>;
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

  // -- idle drift ------------------------------------------------------
  let driftEnabled = !opts.reducedMotion;
  let lastInteraction = -Infinity; // drift immediately on load
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
        lastInteraction = performance.now(); // hover counts as interaction
      } else if (driftEnabled && performance.now() - lastInteraction > IDLE_RESUME_MS) {
        controls.azimuthAngle += DRIFT_RAD_PER_SEC * delta;
        moved = true;
      }
      const updated = controls.update(delta);
      return moved || updated;
    },
    async focusOn(sphere) {
      const target = new THREE.Sphere(sphere.center.clone(), sphere.radius * 1.35);
      await controls.fitToSphere(target, true);
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
