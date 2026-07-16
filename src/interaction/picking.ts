// Pointer picking: pointermove events only record the cursor; the actual
// raycast against the invisible node proxy runs at most once per rAF (the
// render loop calls update()). Touch pointers widen the proxy pick radius.
//
// A non-drag primary click (or tap) on a visible node requests focus. Camera
// drags move the pointer far, so a movement threshold distinguishes the two.
// Filtered-out (ghosted) instances are never hit — picking skips aVisible=0.

import * as THREE from "three";
import type { NodesHandle } from "../scene/nodes";
import type { Machine } from "../state/machine";

const CLICK_MOVE_TOLERANCE = 6; // px of travel still counts as a click, not a drag

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

  // First VISIBLE node under (clientX, clientY), or null. Ghosted nodes skipped.
  function pickAt(clientX: number, clientY: number): number | null {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    // Raycast the proxy directly — it is visible=false (never rendered) but
    // Raycaster.intersectObject does not test visibility. Hits arrive sorted
    // near→far; take the first that isn't filtered out.
    const hits = raycaster.intersectObject(nodes.proxy, false);
    for (const hit of hits) {
      const id = hit.instanceId;
      if (id != null && nodes.isVisible(id)) return id;
    }
    return null;
  }

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

  // Click-vs-drag discrimination, keyed by pointerId so a second touch (pinch,
  // two-finger orbit) can't overwrite the first pointer's down-position and
  // spuriously fire focus() when a finger lifts mid-gesture.
  const downs = new Map<number, { x: number; y: number; primary: boolean }>();
  function onPointerDown(e: PointerEvent): void {
    // A phone tap arrives with no preceding pointermove, so the touch-sized
    // pick proxy must be armed here too — not only in onPointerMove.
    nodes.setTouchPicking(e.pointerType === "touch");
    downs.set(e.pointerId, { x: e.clientX, y: e.clientY, primary: e.button === 0 });
  }
  function onPointerUp(e: PointerEvent): void {
    const down = downs.get(e.pointerId);
    downs.delete(e.pointerId);
    if (!down || !down.primary || e.button !== 0) return;
    // A click only counts when it was the sole active pointer (no pinch/orbit).
    if (downs.size > 0) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved > CLICK_MOVE_TOLERANCE) return; // a camera drag, not a click
    const id = pickAt(e.clientX, e.clientY);
    if (id == null) return;
    machine.focus(id);
  }
  function onPointerCancel(e: PointerEvent): void {
    downs.delete(e.pointerId);
  }

  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);

  return {
    update() {
      if (!pointerDirty) return false;
      pointerDirty = false;

      if (!pointerInside) {
        machine.setHover(null);
        return true;
      }

      const id = pickAt(cursorX, cursorY);
      machine.setHover(id, cursorX, cursorY);
      return true;
    },
    dispose() {
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
    },
  };
}
