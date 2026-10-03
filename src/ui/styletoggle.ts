// Style switcher: Galaxy (style 0), Washi (style 3), Dusk (style 4).
//
// Two copies of one control. The free copy is a glass card in the bottom-right
// stack, directly above the pose control (chromelayout.ts places it). The story
// copy is a STYLE row inside the story card, under the FORMATION row, so a
// reader can change the style mid-story from inside the card's focus trap and
// the free card never has to find room beside the story card. Both copies
// reflect the same active style.
//
// Ringers (1) and Fidenza (2) are dormant and have no choice here. They stay
// reachable through the ?debug=1 hook only.
//
// Accessibility: a real radio group (role radiogroup, aria-checked, roving
// tabindex). The arrow keys and Home / End move focus AND choose, which is the
// radio pattern; a style is a look, so the change is instant and cheap. The
// visible "Style" label names the group. Touch targets are 44px on coarse
// pointers (style.css).
//
// While Washi or Dusk is active, the free card carries a one-line credit to the
// artists the woodblock styles are after. No link.
//
// Boot: ?style=washi or ?style=dusk deep-links a style for the session. The
// reader's own last choice persists in localStorage (cme.style). An explicit
// ?style= wins over the stored choice and is never written back.

import { strandSwatch, type ArtStyle } from "../scene/artstyle";
import { rovingIndex } from "./chipgroup";
import type { StrandId } from "../data";

/** The three user-facing choices, in switcher order. */
export const STYLE_CHOICES: readonly { style: ArtStyle; label: string; slug: string }[] = [
  { style: 0, label: "Galaxy", slug: "galaxy" },
  { style: 3, label: "Washi", slug: "washi" },
  { style: 4, label: "Dusk", slug: "dusk" },
];

/** localStorage key for the reader's last choice (the slug). */
export const STYLE_STORAGE_KEY = "cme.style";

/** The credit line shown while a woodblock style is active (plain text). */
export const HANGA_CREDIT = "After Wada Sanzo, Oda Kazuma, and Utagawa Hiroshige";

/**
 * A slug to a user-reachable style, or null when the slug names nothing a user
 * may choose (an unknown value, or the dormant ringers / fidenza).
 */
export function styleFromSlug(slug: string | null | undefined): ArtStyle | null {
  if (typeof slug !== "string") return null;
  const key = slug.trim().toLowerCase();
  const hit = STYLE_CHOICES.find((c) => c.slug === key);
  return hit ? hit.style : null;
}

/**
 * The boot style. An explicit ?style= parameter wins: a known slug loads that
 * style, and anything else (galaxy, ringers, fidenza, an unknown or empty value)
 * loads style 0. With no parameter the stored choice applies, and an unreadable
 * or unknown stored value also loads style 0.
 */
export function resolveBootStyle(param: string | null, stored: string | null): ArtStyle {
  if (param !== null) return styleFromSlug(param) ?? 0;
  return styleFromSlug(stored) ?? 0;
}

/** Minimal storage surface (localStorage, or a stand-in in tests). */
export interface StyleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The stored slug, or null when storage is absent or throws (private mode). */
export function readStoredStyle(storage: () => StyleStorage | null | undefined): string | null {
  try {
    return storage()?.getItem(STYLE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Store a user-chosen style. Silent when storage is absent or throws. */
export function writeStoredStyle(storage: () => StyleStorage | null | undefined, style: ArtStyle): void {
  const choice = STYLE_CHOICES.find((c) => c.style === style);
  if (!choice) return;
  try {
    storage()?.setItem(STYLE_STORAGE_KEY, choice.slug);
  } catch {
    // Storage full or blocked: the choice still holds for this session.
  }
}

// ---------------------------------------------------------------------------
// Swatches on dark cards.
//
// The strand dots in the panel, search, Browse, the fallback list, and the
// filter legend all print on dark glass (or the opaque dark Browse field). The
// Washi pigments are deep tones made for bare paper and fall under 3:1 on that
// glass (tests/styletoggle.test.ts measures it), so on a dark card Washi uses
// the Dusk pigment set: the same four hue families, printed light. Every other
// style shows its own swatch.

export function cardSwatch(strand: StrandId, style: ArtStyle): number {
  return strandSwatch(strand, style === 3 ? 4 : style);
}

const STRANDS: readonly StrandId[] = ["number", "algebra", "geometry", "data"];

const hex = (v: number): string => `#${v.toString(16).padStart(6, "0")}`;

/**
 * A CSS color that tracks the active style: the strand's custom property, with
 * the Galaxy color as its fallback. Every chrome dot paints with this, so a
 * style change repaints them all at once through applyChromeSwatches.
 */
export function swatchVar(strand: StrandId): string {
  return `var(--sw-${strand}, ${hex(strandSwatch(strand, 0))})`;
}

/** Write the four --sw-* properties for a style on the root element. */
export function applyChromeSwatches(style: ArtStyle, root: HTMLElement = document.documentElement): void {
  for (const s of STRANDS) root.style.setProperty(`--sw-${s}`, hex(cardSwatch(s, style)));
}

// ---------------------------------------------------------------------------
// The control.

export interface StyleToggleDeps {
  /** The reader chose a style (click, Enter / Space, or an arrow key). */
  choose(style: ArtStyle): void;
  initial: ArtStyle;
  /** "free": the glass card on <body>. "story": the row inside the story card. */
  variant: "free" | "story";
  /** Where to mount it. Defaults to <body>. */
  host?: Element | null;
}

export interface StyleToggleHandle {
  readonly el: HTMLElement;
  /** Sync aria-checked, the roving tabindex, and the credit to a style. */
  reflect(style: ArtStyle): void;
  dispose(): void;
}

let uid = 0;

export function createStyleToggle(deps: StyleToggleDeps): StyleToggleHandle {
  const id = `style-label-${++uid}`;
  const root = document.createElement("div");
  root.className = deps.variant === "free" ? "style-toggle" : "style-pick";

  const label = document.createElement("span");
  label.className = "style-label";
  label.id = id;
  label.textContent = "Style";

  const group = document.createElement("div");
  group.className = "style-radios";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-labelledby", id);

  const radios: HTMLButtonElement[] = STYLE_CHOICES.map((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "style-seg";
    btn.setAttribute("role", "radio");
    btn.textContent = c.label;
    btn.addEventListener("click", () => pick(c.style));
    return btn;
  });
  group.append(...radios);

  const credit = document.createElement("p");
  credit.className = "style-credit";
  credit.hidden = true;

  root.append(label, group, credit);
  (deps.host ?? document.body).appendChild(root);

  let current: ArtStyle = deps.initial;

  function pick(style: ArtStyle): void {
    if (style !== current) deps.choose(style);
    reflect(style);
  }

  group.addEventListener("keydown", (e: KeyboardEvent) => {
    const at = radios.indexOf(e.target as HTMLButtonElement);
    if (at < 0) return;
    const to = rovingIndex(e.key, at, radios.length);
    if (to === null) return;
    e.preventDefault();
    radios[to].focus();
    pick(STYLE_CHOICES[to].style);
  });

  function reflect(style: ArtStyle): void {
    current = style;
    const on = STYLE_CHOICES.findIndex((c) => c.style === style);
    radios.forEach((btn, i) => {
      btn.setAttribute("aria-checked", String(i === on));
      // Roving tabindex: the checked radio takes Tab; with no user choice
      // checked (a dormant debug style), the first one does.
      btn.tabIndex = i === (on < 0 ? 0 : on) ? 0 : -1;
    });
    const text = style === 3 || style === 4 ? HANGA_CREDIT : "";
    credit.textContent = text;
    credit.hidden = !text;
    root.classList.toggle("style-credited", !!text);
  }
  reflect(deps.initial);

  return {
    el: root,
    reflect,
    dispose() {
      root.remove();
    },
  };
}
