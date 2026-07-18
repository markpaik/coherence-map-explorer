// Art-style toggle — a second glass segmented control that sits under the
// pose toggle (bottom-right): Galaxy / Ringers / Fidenza. Instant swap (a
// style is a look, not a place — no transition to interrupt), so unlike the
// pose toggle it never disables itself.
//
// While an art style is active a one-line credit appears beneath the control,
// naming the artist and linking the curated.xyz editorial the style is after —
// the styles are homages and say so in the room where they hang.
//
// Accessibility mirrors the pose toggle: real <button>s in a labeled group,
// aria-pressed, 44px touch targets, global :focus-visible ring.

import { ART_CREDITS, ART_STYLE_NAMES, type ArtStyle } from "../scene/artstyle";

interface StyleToggleDeps {
  /** Applies the style to every subsystem (main.ts owns the fan-out). */
  apply(style: ArtStyle): void;
  initial: ArtStyle;
}

export interface StyleToggleHandle {
  /** Sync aria-pressed + the credit line to the active style. */
  reflect(style: ArtStyle): void;
  dispose(): void;
}

export function createStyleToggle(deps: StyleToggleDeps): StyleToggleHandle {
  const group = document.createElement("div");
  group.className = "art-toggle";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Style overrides");
  group.id = "art-toggle-group";

  // Discovery tab: a labeled pill that says the feature exists. Clicking it
  // unfolds the three-way control above; the unlabeled segmented row alone was
  // invisible to anyone not already looking for it (Mark, round 7).
  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = "art-tab";
  tab.textContent = "Style overrides";
  tab.setAttribute("aria-expanded", "false");
  tab.setAttribute("aria-controls", group.id);
  let open = false;
  const setOpen = (v: boolean): void => {
    open = v;
    tab.setAttribute("aria-expanded", String(v));
    group.classList.toggle("art-toggle-open", v);
    document.body.classList.toggle("art-open", v);
  };
  tab.addEventListener("click", () => setOpen(!open));

  const buttons: HTMLButtonElement[] = ART_STYLE_NAMES.map((name, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "view-seg art-seg";
    btn.textContent = name;
    btn.setAttribute("aria-pressed", String(i === deps.initial));
    btn.addEventListener("click", () => {
      deps.apply(i as ArtStyle);
      reflect(i as ArtStyle);
    });
    return btn;
  });
  group.append(...buttons);

  const credit = document.createElement("div");
  credit.className = "art-credit";
  document.body.append(tab, group, credit);
  // A deep-linked art style arrives with the control unfolded — the visitor
  // should see where the look came from and how to leave it.
  if (deps.initial !== 0) setOpen(true);

  function reflect(style: ArtStyle): void {
    buttons.forEach((btn, i) => btn.setAttribute("aria-pressed", String(i === style)));
    credit.innerHTML = ART_CREDITS[style].html;
    credit.classList.toggle("art-credit-on", style !== 0);
  }
  reflect(deps.initial);

  return {
    reflect,
    dispose() {
      tab.remove();
      group.remove();
      credit.remove();
    },
  };
}
