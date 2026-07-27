// The rotating aside — "Coherence (is ____)".
//
// One hundred completions in three registers (single words, phrases, ending
// statements), Mark's direction: the line should be poetic, and the whole
// visit should be GENERATIVE — one of an infinite number of variations. The
// PRINT (lean, drop, ink pressure, turbulence) stays a function of the clock
// seed, but the PICK deals fresh on every page load (Mark, 2026-07-24): a
// visit counter in localStorage scatters the choice, deterministic in
// (hour, visit count), never repeating the line just shown. Where storage is
// unavailable the pick falls back to plain randomness — still a new line per
// refresh. Clicking the aside deals the next line (a small pleasure for
// whoever discovers it). "art" keeps its hand-authored street tag; every
// other completion renders as marker text in the tag styling.
//
// SOURCE (2026-07-27, Mark's direction): the completions are grounded in Jason
// Zimba's "Examples of Structure in the Common Core State Standards' Standards
// for Mathematical Content" (DRAFT 2011-07-06), the document whose closing
// "Graph of the Content Standards" is this map's ancestor. His argument is the
// register the list plays in: school mathematics is not a "master loop" running
// one standard at a time with "every new standard wiping the register clean";
// the Standards are "more than the sum of its parts"; the connections "are not
// always easy to see", which is why he drew them. His own vocabulary carries
// the list where it fits in a breath: the energy of a molecule is in its BONDS,
// domains are rails and you must see the TIES that bind them, FLOWS lead to
// algebra, PINNACLES are the capstone standards that outlive their grade, a
// choice of UNIT makes the uncountable countable, and treating technique as a
// "to-do list of disconnected items" rather than "applications of a few
// fundamental and familiar principles" is what coherence is against.
//
// Copy is design: edit this list only with the designer.
// GLYPH CONSTRAINT: entries may use only lowercase a-z, spaces, and hyphens
// (the tag hand's glyph set; see ui/tagtype.ts).

import { mulberry32 } from "../scene/evolve";
import { renderTag } from "./tagtype";

// Refresh-deal state. The counter makes each page load a distinct visit even
// inside one clock hour; the last-index guard makes the change visible.
const COUNT_KEY = "cme-aside-visit";
const LAST_KEY = "cme-aside-last";

/**
 * Pick this load's aside index: scatter (clock base, visit count) through a
 * fresh mulberry32 so consecutive refreshes jump around the list instead of
 * walking it in order. Exported for tests; pure given its inputs.
 */
export function dealIndex(base: number, count: number, last: number, length: number): number {
  const scatter = mulberry32((base ^ Math.imul(count + 1, 0x9e3779b9)) >>> 0);
  let i = Math.floor(scatter() * length);
  if (i === last) i = (i + 1) % length;
  return i;
}

export const ASIDES: readonly string[] = [
  "art",
  // ---- single words -------------------------------------------------------
  // Zimba's own nouns where he has one: bonds and ties (the molecule/rails
  // metaphor), flows and streams (the section titles), units, pinnacles (his
  // coinage for the capstone standards), convergence (his figure label).
  "structure",
  "bonds",
  "ties",
  "flow",
  "streams",
  "units",
  "pinnacles",
  "convergence",
  "lineage",
  "ancestry",
  "inheritance",
  "continuity",
  "connection",
  "sequence",
  "architecture",
  "foundation",
  "bedrock",
  "roots",
  "ground",
  "depth",
  "direction",
  "order",
  "proportion",
  "momentum",
  "accumulation",
  "memory",
  "elegance",
  "simplicity",
  "clarity",
  "beauty",
  "craft",
  "growth",
  // ---- simple phrases -----------------------------------------------------
  // The argument of the Atlas, in his words where they fit in a breath: the
  // master loop that wipes the register clean, the document being more than
  // the sum of its parts, connections that are not always easy to see.
  "energy in the bonds",
  "ties that bind",
  "between the domains",
  "more than the sum",
  "how the pieces fit",
  "a few principles",
  "not a to-do list",
  "none stands alone",
  "nothing isolated",
  "everything connected",
  "the flow of ideas",
  "flows toward algebra",
  "streams that merge",
  "converging paths",
  "lasting achievements",
  "a choice of unit",
  "made countable",
  "as far back as needed",
  "where the work heads",
  "key precursors",
  "seeing structure",
  "structure in view",
  "connections in view",
  "not easy to see",
  "nothing gathers dust",
  "old meanings extended",
  "the idea extended",
  "a rehearsal for later",
  "meanings that carry",
  "elegant and simple",
  "roots before branches",
  "no step skipped",
  "built to last",
  "nothing wasted",
  "the long view",
  "the whole picture",
  "one structure",
  "one living structure",
  "deep roots",
  "solid ground",
  "strong foundations",
  "deep foundations",
  "common ground",
  "shared foundations",
  "first things first",
  "all one piece",
  "the slow build",
  "growing upward",
  "holding together",
  "made to connect",
  "simple at heart",
  "a steady climb",
  "a single thread",
  "a clear path",
  "paths that meet",
  "streams that join",
  "every rung",
  "the shape of learning",
  "the long game",
  "grade by grade",
  "year by year",
  "step by step",
  "piece by piece",
  "level by level",
  // ---- ending statements --------------------------------------------------
  "a vision not a list",
  "what the pieces make",
  "the whole is the point",
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

  // The pick deals fresh each load: bump the visit counter and scatter the
  // clock base with it. localStorage can throw (privacy modes); fall back to
  // chance so a refresh still shows a new line.
  const base = Math.floor(rand() * 0x7fffffff);
  let index: number;
  try {
    const count = Number(localStorage.getItem(COUNT_KEY)) || 0;
    const last = Number(localStorage.getItem(LAST_KEY) ?? -1);
    index = dealIndex(base, count, last, ASIDES.length);
    localStorage.setItem(COUNT_KEY, String(count + 1));
    localStorage.setItem(LAST_KEY, String(index));
  } catch {
    index = Math.floor(Math.random() * ASIDES.length);
  }
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
