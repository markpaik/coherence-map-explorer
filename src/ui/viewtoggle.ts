// View toggle — a small glass segmented control (bottom-right, above the nav
// hints) that switches the scene between the two poses: "Constellation" (pose A)
// and "Ascent" (pose B). It drives the pose morph ONLY through the driver's
// public setPose; while a transition plays the control disables itself until the
// promise settles, so a rapid double-click can't stack morphs.
//
// In the Ascent it also reveals a subtle vertical scale hint on the left edge —
// "0 · foundations" at the bottom, "30 · deepest chain" at the top — naming the
// axis the massif is built on: prerequisite-chain depth. The hint fades in and
// out with the pose (driven by main's per-frame reflect()).
//
// Accessibility: two real <button>s in a labeled group, the aria-pressed toggle
// pattern (matching the filter chips), 44px touch targets, and the global
// :focus-visible ring. The scale hint is decorative (aria-hidden).

import type { PoseDriver } from "../scene/pose";

interface ViewToggleDeps {
  driver: PoseDriver;
}

export interface ViewToggleHandle {
  /** Sync the control to the driver: aria-pressed ← target, hint opacity ← pose. */
  reflect(pose: number, target: 0 | 1): void;
  dispose(): void;
}

export function createViewToggle(deps: ViewToggleDeps): ViewToggleHandle {
  const { driver } = deps;

  const group = document.createElement("div");
  group.className = "view-toggle";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Layout");

  function makeSegment(label: string, target: 0 | 1, pressed: boolean): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "view-seg";
    btn.textContent = label;
    btn.setAttribute("aria-pressed", String(pressed));
    btn.addEventListener("click", () => void choose(target));
    return btn;
  }

  const constellationBtn = makeSegment("Constellation", 0, true);
  const ascentBtn = makeSegment("Ascent", 1, false);
  group.append(constellationBtn, ascentBtn);

  // Vertical depth-scale hint (left edge). Decorative — the panel/tooltip carry
  // the accessible reading of depth.
  const scale = document.createElement("div");
  scale.className = "depth-scale";
  scale.setAttribute("aria-hidden", "true");
  scale.innerHTML =
    '<span class="depth-scale-mark depth-scale-top">30 prerequisites deep</span>' +
    '<span class="depth-scale-axis" aria-hidden="true">height = prerequisite depth</span>' +
    '<span class="depth-scale-mark depth-scale-bottom">foundations <span class="depth-scale-sep">·</span> nothing beneath</span>';
  scale.style.opacity = "0";

  document.body.append(scale, group);

  let busy = false;
  async function choose(target: 0 | 1): Promise<void> {
    if (busy) return;
    busy = true;
    constellationBtn.disabled = true;
    ascentBtn.disabled = true;
    const p = driver.setPose(target);
    // setPose has already committed the target — flip aria-pressed immediately.
    reflect(driver.pose, driver.target);
    try {
      await p;
    } finally {
      busy = false;
      constellationBtn.disabled = false;
      ascentBtn.disabled = false;
      reflect(driver.pose, driver.target);
    }
  }

  function reflect(pose: number, target: 0 | 1): void {
    constellationBtn.setAttribute("aria-pressed", String(target === 0));
    ascentBtn.setAttribute("aria-pressed", String(target === 1));
    // Fade the depth scale with the pose; clamp so tiny float noise reads as 0/1.
    scale.style.opacity = String(pose < 0.001 ? 0 : pose > 0.999 ? 1 : pose);
  }

  reflect(driver.pose, driver.target);

  return {
    reflect,
    dispose() {
      group.remove();
      scale.remove();
    },
  };
}
