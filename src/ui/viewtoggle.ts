// View toggle — a small glass segmented control (bottom-right, above the nav
// hints) that switches the scene between the four poses: "Constellation"
// (pose 0), "Ascent" (pose 1), "Blueprint" (pose 2), and "Transit" (pose 3).
// It drives the pose morph ONLY through the driver's public setPose; while a
// transition plays the control disables itself until the promise settles, so a
// rapid double-click can't stack morphs.
//
// In the Ascent it also reveals a subtle vertical scale hint on the left edge —
// "foundations" at the bottom, "30 prerequisites deep" at the top — naming the
// axis the massif is built on: prerequisite-chain depth. The hint fades in for
// the Ascent ONLY and is gone in the flat Blueprint and the Transit map (neither
// has a depth axis); it tracks the continuous pose value via main's per-frame
// reflect() — the triangular fade reads 0 at pose 0, 2, and 3.
//
// Accessibility: four real <button>s in a labeled group, the aria-pressed
// toggle pattern (matching the filter chips), 44px touch targets, and the global
// :focus-visible ring. The scale hint is decorative (aria-hidden).

import type { Pose, PoseDriver } from "../scene/pose";

// One orientation line per formation. Shown for ~4s after a formation change and
// while a segment is hovered or focused. Copy is fixed.
const CAPTIONS: Record<Pose, string> = {
  0: "The galaxy: every standard, a star in its strand.",
  1: "Altitude shows how much mathematics stands beneath a standard.",
  2: "The drafting sheet: thirteen columns, K to Advanced, after the original map.",
  3: "The metro: trunk lines of prerequisite flow; interchanges are the crossroads.",
};

interface ViewToggleDeps {
  driver: PoseDriver;
}

export interface ViewToggleHandle {
  /** Sync the control to the driver: aria-pressed ← target, hint opacity ← pose. */
  reflect(pose: number, target: Pose): void;
  dispose(): void;
}

export function createViewToggle(deps: ViewToggleDeps): ViewToggleHandle {
  const { driver } = deps;

  const group = document.createElement("div");
  group.className = "view-toggle";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Layout");

  // Orientation caption: what this formation IS, in one line. aria-live polite so
  // assistive tech hears the same orientation sighted users get. Reduced motion is
  // handled in CSS (:root.rm drops the slide) — here it only appears/disappears.
  const caption = document.createElement("div");
  caption.className = "view-caption";
  caption.setAttribute("aria-live", "polite");

  // Visibility = a segment is hovered/focused (persistent while so) OR we are still
  // inside the ~4s window after a formation change. Hover wins while active.
  let hovering = false;
  let hoverPose: Pose = 0;
  let timedPose: Pose | null = null;
  let hideTimer = 0;
  function renderCaption(): void {
    const pose = hovering ? hoverPose : timedPose;
    if (pose === null) {
      caption.classList.remove("view-caption-on");
      return;
    }
    caption.textContent = CAPTIONS[pose];
    caption.classList.add("view-caption-on");
  }
  function showHover(pose: Pose): void {
    hovering = true;
    hoverPose = pose;
    renderCaption();
  }
  function clearHover(): void {
    hovering = false;
    renderCaption();
  }
  function flashCaption(pose: Pose): void {
    timedPose = pose;
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      timedPose = null;
      renderCaption();
    }, 4000);
    renderCaption();
  }

  function makeSegment(label: string, target: Pose, pressed: boolean): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "view-seg";
    btn.textContent = label;
    btn.setAttribute("aria-pressed", String(pressed));
    btn.addEventListener("click", () => void choose(target));
    // Hover/focus of each option previews its orientation line.
    btn.addEventListener("mouseenter", () => showHover(target));
    btn.addEventListener("mouseleave", clearHover);
    btn.addEventListener("focus", () => showHover(target));
    btn.addEventListener("blur", clearHover);
    return btn;
  }

  const segments: { btn: HTMLButtonElement; target: Pose }[] = [
    { btn: makeSegment("Constellation", 0, true), target: 0 },
    { btn: makeSegment("Ascent", 1, false), target: 1 },
    { btn: makeSegment("Blueprint", 2, false), target: 2 },
    { btn: makeSegment("Transit", 3, false), target: 3 },
  ];
  group.append(...segments.map((s) => s.btn));

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

  document.body.append(scale, group, caption);

  let busy = false;
  let lastCaptionTarget: Pose = driver.target; // seed so the initial sync never flashes
  async function choose(target: Pose): Promise<void> {
    if (busy) return;
    busy = true;
    for (const s of segments) s.btn.disabled = true;
    const p = driver.setPose(target);
    // setPose has already committed the target — flip aria-pressed immediately.
    reflect(driver.pose, driver.target);
    try {
      await p;
    } finally {
      busy = false;
      for (const s of segments) s.btn.disabled = false;
      reflect(driver.pose, driver.target);
    }
  }

  function reflect(pose: number, target: Pose): void {
    for (const s of segments) s.btn.setAttribute("aria-pressed", String(target === s.target));
    // Flash the orientation caption once when the formation TARGET changes — covers
    // toggle clicks, programmatic setPose, and story pins. The seed above keeps the
    // initial sync silent. Reduced motion is honoured in CSS (appear/disappear only).
    if (target !== lastCaptionTarget) {
      lastCaptionTarget = target;
      flashCaption(target);
    }
    // The depth scale belongs to the Ascent alone: opacity peaks at pose 1 and
    // falls to 0 at both the Constellation (0) and the flat Blueprint (2), which
    // has no depth axis. Triangular fade; clamp tiny float noise to 0/1.
    const d = 1 - Math.abs(pose - 1);
    scale.style.opacity = String(d < 0.001 ? 0 : d > 0.999 ? 1 : d);
  }

  reflect(driver.pose, driver.target);

  return {
    reflect,
    dispose() {
      group.remove();
      scale.remove();
      caption.remove();
      window.clearTimeout(hideTimer);
    },
  };
}
