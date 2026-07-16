// Pointer picking: pointermove events only record the cursor; the actual
// raycast against the invisible node proxy runs at most once per rAF (the
// render loop calls update()). Touch pointers widen the proxy pick radius.

import * as THREE from "three";
import type { NodesHandle } from "../scene/nodes";
import type { Machine } from "../state/machine";

export interface PickingHandle {
  /** Run the throttled raycast. Returns true if hover state changed. */
  update(): boolean;
  dispose(): void;
}

export function createPicking(
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  nodes: NodesHandle,
  machine: Machine,
): PickingHandle {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  let cursorX = 0;
  let cursorY = 0;
  let pointerDirty = false;
  let pointerInside = false;

  function onPointerMove(e: PointerEvent): void {
    cursorX = e.clientX;
    cursorY = e.clientY;
    pointerInside = true;
    pointerDirty = true;
    nodes.setTouchPicking(e.pointerType === "touch");
  }
  function onPointerLeave(): void {
    pointerInside = false;
    pointerDirty = true;
  }

  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);

  return {
    update() {
      if (!pointerDirty) return false;
      pointerDirty = false;

      if (!pointerInside) {
        machine.setHover(null);
        return true;
      }

      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((cursorX - rect.left) / rect.width) * 2 - 1,
        -((cursorY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      // Raycast the proxy directly — it is visible=false (never rendered) but
      // Raycaster.intersectObject does not test visibility.
      const hits = raycaster.intersectObject(nodes.proxy, false);
      const instanceId = hits.length > 0 ? (hits[0].instanceId ?? null) : null;
      machine.setHover(instanceId, cursorX, cursorY);
      return true;
    },
    dispose() {
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
    },
  };
}
