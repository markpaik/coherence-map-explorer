// The rotating aside — "Coherence (is ____)".
//
// One hundred completions in three registers (single words, phrases, ending
// statements), Mark's direction: the line should be poetic, and the whole
// visit should be GENERATIVE — one of an infinite number of variations. So
// the pick is drawn from the per-visit seed, and the RENDERING itself
// varies: each visit's aside leans at its own angle, sits at its own size,
// carries its own ink pressure and its own turbulence seed. No two visits
// print the same title. Clicking the aside deals a new line (a small
// pleasure for whoever discovers it). "art" keeps its hand-authored street
// tag; every other completion renders as marker text in the tag styling.
//
// Copy is design: edit this list only with the designer.
// GLYPH CONSTRAINT: entries may use only lowercase a-z, spaces, and hyphens
// (the tag hand's glyph set; see ui/tagtype.ts).

import { renderTag } from "./tagtype";

export const ASIDES: readonly string[] = [
  "art",
  // ---- single words -------------------------------------------------------
  "simplicity",
  "clarity",
  "calming",
  "patience",
  "structure",
  "gravity",
  "lineage",
  "memory",
  "momentum",
  "architecture",
  "inheritance",
  "calm",
  "sequence",
  "foundation",
  "connection",
  "continuity",
  "craft",
  "care",
  "direction",
  "depth",
  "devotion",
  "order",
  "rhythm",
  "roots",
  "bedrock",
  "breath",
  "balance",
  "flow",
  "growth",
  "ground",
  "harmony",
  "elegance",
  "wonder",
  "quiet",
  "steadiness",
  "practice",
  "progress",
  "grace",
  "attention",
  "beauty",
  "discovery",
  "wayfinding",
  "proportion",
  "unfolding",
  "belonging",
  // ---- simple phrases -----------------------------------------------------
  "clarity in complexity",
  "quiet order",
  "deep roots",
  "solid ground",
  "slow growth",
  "small steps",
  "one structure",
  "steady light",
  "patient work",
  "connected ideas",
  "common ground",
  "shared foundations",
  "first things first",
  "step by step",
  "roots and branches",
  "built to last",
  "nothing wasted",
  "no step skipped",
  "all one piece",
  "the long view",
  "the whole picture",
  "gentle order",
  "quiet momentum",
  "earned light",
  "careful steps",
  "strong foundations",
  "the slow build",
  "growing upward",
  "holding together",
  "in good order",
  "made to connect",
  "simple at heart",
  "beauty in order",
  "a steady climb",
  "level by level",
  "year by year",
  "grade by grade",
  "piece by piece",
  "a single thread",
  "a clear path",
  "paths that meet",
  "streams that join",
  "a quiet sky",
  "worth the climb",
  "every rung",
  "every light earned",
  "rivers of practice",
  "step after step",
  "everything connected",
  "nothing isolated",
  "the shape of learning",
  "a map of care",
  "deep foundations",
  "roots before branches",
  "the long game",
] as const;

export interface AsideHandle {
  dispose(): void;
}

/**
 * Mount the rotating aside into the headline. `rand` is the visit's seeded
 * generator (one print per visit). EVERY completion, "art" included, renders
 * through the tag hand (ui/tagtype.ts), so all one hundred lines share the
 * approved tag's exact styling — same brackets, chisel weights, echo, and
 * turbulence — with per-visit lean, drop, and ink pressure.
 */
export function createAside(rand: () => number): AsideHandle {
  const host = document.querySelector<HTMLElement>(".headline-art");
  if (!host) return { dispose() {} };

  // Per-visit print variation.
  const lean = -(2 + rand() * 5); // degrees
  const drop = 0.3 + rand() * 0.1; // em below baseline
  const press = 0.86 + rand() * 0.28; // ink pressure (stroke weight)
  host.style.setProperty("--aside-rot", `${lean.toFixed(2)}deg`);
  // This visit's turbulence for the marker filter.
  document
    .querySelectorAll("#aside-marker feTurbulence")
    .forEach((t) => t.setAttribute("seed", String(1 + Math.floor(rand() * 997))));

  let index = Math.floor(rand() * ASIDES.length);
  let current: SVGSVGElement | null = null;

  function show(i: number): void {
    const word = ASIDES[i];
    host!.setAttribute("aria-label", `(is ${word})`);
    const svg = renderTag(`(is ${word})`, press);
    const units = Number(svg.dataset.tagWidth) || 130;
    const em = (units / 130) * 1.18; // glyph box is 130 tall = 1.18em on screen
    svg.style.width = `${em.toFixed(3)}em`;
    svg.style.height = "1.18em";
    svg.style.bottom = `-${drop.toFixed(3)}em`;
    current?.remove();
    current = svg;
    host!.appendChild(svg);
    host!.style.width = `${Math.max(0.8, em * 0.94).toFixed(3)}em`;
  }
  show(index);

  // A hidden pleasure: activating the aside deals the next line. It is a real
  // button (role/tabindex/title set in index.html; re-asserted here so the
  // module owns the contract) — pointer AND keyboard both deal a new line, and
  // the global :focus-visible ring makes it reachable for keyboard/AT. The
  // aria-label stays the poetic completion ("(is art)"), so the H1 landmark
  // still reads "Coherence (is art)"; the title carries the action hint.
  host.setAttribute("role", "button");
  host.tabIndex = 0;
  host.setAttribute("title", "Deal a new line");
  const deal = (): void => {
    index = (index + 1) % ASIDES.length;
    show(index);
  };
  const onClick = (): void => deal();
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      deal();
    }
  };
  host.style.pointerEvents = "auto";
  host.style.cursor = "pointer";
  host.addEventListener("click", onClick);
  host.addEventListener("keydown", onKey);

  return {
    dispose() {
      host.removeEventListener("click", onClick);
      host.removeEventListener("keydown", onKey);
      current?.remove();
    },
  };
}
