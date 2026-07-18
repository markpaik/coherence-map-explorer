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

export const ASIDES: readonly string[] = [
  "art",
  // ---- single words -------------------------------------------------------
  "clarity",
  "patience",
  "structure",
  "gravity",
  "lineage",
  "memory",
  "momentum",
  "architecture",
  "inheritance",
  "accumulation",
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
  "scaffolding",
  "cartography",
  "astronomy",
  "bedrock",
  "breath",
  "gardening",
  // ---- phrases ------------------------------------------------------------
  "clarity in complexity",
  "order without cages",
  "beauty in structure",
  "the long game",
  "quiet engineering",
  "slow architecture",
  "patient accumulation",
  "deep foundations",
  "careful sequence",
  "everything connected",
  "nothing isolated",
  "structure made visible",
  "the shape of learning",
  "a map of care",
  "gravity for ideas",
  "light through structure",
  "the geometry of growth",
  "rivers of practice",
  "roots before branches",
  "step after step",
  "one thing before another",
  "mathematics remembering itself",
  "the architecture of thought",
  "thirteen years, one structure",
  "a constellation of small wins",
  "every light earned",
  "the opposite of luck",
  "no wasted year",
  "a ladder with every rung",
  "the slow reveal of structure",
  "an inheritance of ideas",
  "a childhood of connected steps",
  "the river beneath the grades",
  "the ground beneath algebra",
  "the thread through the years",
  "learning with a memory",
  "the map before the journey",
  // ---- ending statements: Coherence is ... --------------------------------
  "how far you can see",
  "what practice builds",
  "every step remembered",
  "nothing learned alone",
  "why the next step holds",
  "what the years add up to",
  "where struggle gets its map",
  "how foundations carry weight",
  "what teachers build together",
  "the distance a child travels",
  "counting all the way up",
  "how one idea holds another",
  "what remains when tests fade",
  "the promise that steps connect",
  "seeing the whole staircase",
  "why fractions matter forever",
  "the debt each idea owes",
  "how knowledge takes root",
  "what endures beneath mastery",
  "where every summit starts",
  "what kindergarten already knew",
  "what building on really means",
  "the case against shortcuts",
  "how understanding compounds",
  "what gaps cannot hide from",
  "the sum of small arrivals",
  "why order matters",
  "what holds when pushed",
  "how counting becomes calculus",
  "all of it load-bearing",
  "what a map owes a child",
  "the long way that works",
  "how the light stays on",
  "what the first step promised",
  "where the story begins",
] as const;

export interface AsideHandle {
  dispose(): void;
}

/**
 * Mount the rotating aside into the headline. `rand` is the visit's seeded
 * generator (one print per visit). The hand-drawn "(is art)" SVG already in
 * the DOM shows verbatim when the draw is "art"; every other completion
 * renders as tag-styled marker text with per-visit lean, size, and pressure.
 */
export function createAside(rand: () => number): AsideHandle {
  const host = document.querySelector<HTMLElement>(".headline-art");
  if (!host) return { dispose() {} };
  const drawnTag = host.querySelector("svg");

  const textEl = document.createElement("span");
  textEl.className = "headline-aside-text";
  textEl.hidden = true;
  host.appendChild(textEl);

  // Per-visit print variation: the aside's own lean, drop, size, ink weight,
  // and turbulence seed. Applied to the text mode via custom properties and
  // to the drawn tag by re-seeding its filters and tilting the whole print.
  const lean = -(2 + rand() * 5); // degrees
  const drop = -(0.06 + rand() * 0.14); // em
  const size = 0.39 + rand() * 0.07; // em
  const press = 0.72 + rand() * 0.2; // opacity
  host.style.setProperty("--aside-rot", `${lean.toFixed(2)}deg`);
  host.style.setProperty("--aside-drop", `${drop.toFixed(3)}em`);
  host.style.setProperty("--aside-size", `${size.toFixed(3)}em`);
  host.style.setProperty("--aside-press", press.toFixed(2));
  if (drawnTag) {
    (drawnTag as SVGElement).style.transform = `rotate(${lean.toFixed(2)}deg)`;
    drawnTag.querySelectorAll("feTurbulence").forEach((t) => {
      t.setAttribute("seed", String(1 + Math.floor(rand() * 997)));
    });
  }
  // The text-mode marker filter lives in a persistent defs block — give this
  // visit's ink its own turbulence too.
  document
    .querySelectorAll("#aside-marker feTurbulence")
    .forEach((t) => t.setAttribute("seed", String(1 + Math.floor(rand() * 997))));

  let index = Math.floor(rand() * ASIDES.length);

  function show(i: number): void {
    const word = ASIDES[i];
    host!.setAttribute("aria-label", `(is ${word})`);
    if (word === "art" && drawnTag) {
      textEl.hidden = true;
      (drawnTag as SVGElement).style.display = "";
      host!.classList.remove("headline-art-text");
    } else {
      if (drawnTag) (drawnTag as SVGElement).style.display = "none";
      textEl.textContent = `(is ${word})`;
      textEl.hidden = false;
      host!.classList.add("headline-art-text");
    }
  }
  show(index);

  // A hidden pleasure: clicking the aside deals the next line.
  const onClick = (): void => {
    index = (index + 1) % ASIDES.length;
    show(index);
  };
  host.style.pointerEvents = "auto";
  host.style.cursor = "pointer";
  host.addEventListener("click", onClick);

  return {
    dispose() {
      host.removeEventListener("click", onClick);
      textEl.remove();
    },
  };
}
