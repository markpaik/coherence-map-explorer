// Formation picker — the story-HUD sibling of the pose view-toggle
// (src/ui/viewtoggle.ts). While a story plays, every scene normally uses its
// AUTHORED pose (scene.camera.pose); this control lets the reader PIN the whole
// story to one formation instead — Constellation, Ascent, Blueprint, or Transit
// — or return to AUTHORED. The pin persists across stories for the life of the
// page (module state; no localStorage). The player owns what a change DOES
// (setPose + refit + heldBody copy swap); this module owns only the control.
//
// Placement + accessibility: the segmented control mounts as the LAST child of
// the story card, so it lives inside the card's focus trap and native tab order
// (storycard.ts owns that trap and is not edited here). Tab reaches it from the
// Exit button and leaves into the scrubber; Enter/Space select a segment, the
// aria-pressed pattern matches the view-toggle and the filter chips. It hides
// automatically with the card between stories, and flex-wraps on narrow widths.

import type { Formation } from "./scripts";

// Module state: the pinned formation survives restarts within the page session.
// null = AUTHORED (each scene plays its own authored pose).
let pinned: Formation | null = null;

export interface FormationPickDeps {
  /** Fired when the reader changes the pin; the player applies it immediately. */
  onChange: (pinned: Formation | null) => void;
}

export interface FormationPickHandle {
  /** The current pin (null = AUTHORED). Read by the player's pose resolver. */
  getPinned(): Formation | null;
  /** Sync every segment's aria-pressed to the current pin. */
  reflect(): void;
  dispose(): void;
}

// AUTHORED plus the four formations. Labels for the four match the view-toggle
// exactly so the two controls read as siblings.
const OPTIONS: { label: string; value: Formation | null }[] = [
  { label: "Authored", value: null },
  { label: "Constellation", value: 0 },
  { label: "Ascent", value: 1 },
  { label: "Blueprint", value: 2 },
  { label: "Transit", value: 3 },
];

export function createFormationPick(deps: FormationPickDeps): FormationPickHandle {
  const { onChange } = deps;

  const group = document.createElement("div");
  group.className = "formation-pick";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Formation for this story");

  const label = document.createElement("span");
  label.className = "formation-pick-label";
  label.setAttribute("aria-hidden", "true"); // the group's aria-label carries meaning
  label.textContent = "Formation";
  group.appendChild(label);

  const segments: { btn: HTMLButtonElement; value: Formation | null }[] = OPTIONS.map((o) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "formation-seg";
    btn.textContent = o.label;
    btn.setAttribute("aria-pressed", String(pinned === o.value));
    btn.addEventListener("click", () => {
      if (pinned === o.value) return; // already the active pin — no churn
      pinned = o.value;
      reflect();
      onChange(pinned);
    });
    group.appendChild(btn);
    return { btn, value: o.value };
  });

  function reflect(): void {
    for (const s of segments) s.btn.setAttribute("aria-pressed", String(pinned === s.value));
  }

  // Mount inside the story card (created + appended to <body> by the story card
  // module just before this runs). As the card's last child the control inherits
  // the card's focus trap + hide-with-card behavior for free.
  const host = document.querySelector(".story-card");
  if (host) host.appendChild(group);
  reflect();

  return {
    getPinned: () => pinned,
    reflect,
    dispose() {
      group.remove();
    },
  };
}
