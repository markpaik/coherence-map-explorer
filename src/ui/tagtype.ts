// The tag hand — a tiny stroke-based letterer so every title aside prints in
// the SAME hand as the approved "(is art)" tag (Mark, round 9: one styling
// for all of them). Each glyph is a set of marker strokes (path data in a
// local box, baseline y=74, x-height 48→74, ascenders from 30, descenders to
// 96), drawn in the tag's language: chisel contrast (stems heavier than
// curves), sharp entries and exits, a global skew for momentum, an echo pass
// behind, and turbulence roughening via the persistent #aside-marker filter.
// The i/s/a/r/t glyphs are lifted from the hand-authored tag itself so "art"
// prints exactly as it always did.

interface Stroke {
  d: string;
  w: number; // stroke width (chisel: stems ~4.4, curves ~3.4, ticks ~3.8)
}
interface Glyph {
  adv: number; // advance width in glyph units
  strokes: Stroke[];
}

const STEM = 4.4;
const CURVE = 3.5;
const TICK = 3.8;

// Glyph boxes are local: x from 0..adv, baseline y = 74.
const GLYPHS: Record<string, Glyph> = {
  "(": { adv: 18, strokes: [{ d: "M16,28 L2,64 L14,100", w: 3.4 }] },
  ")": { adv: 18, strokes: [{ d: "M2,28 L16,64 L4,100", w: 3.4 }] },
  " ": { adv: 13, strokes: [] },
  "-": { adv: 16, strokes: [{ d: "M2,60 L14,58", w: CURVE }] },
  a: {
    adv: 21,
    strokes: [
      { d: "M17,52 C7,49 1,59 8,66 C13,70 19,66 20,58 L18.5,69 C18.8,71.5 21.5,71.5 23.5,69", w: STEM },
    ],
  },
  b: {
    adv: 19,
    strokes: [
      { d: "M6,30 L2,74", w: STEM },
      { d: "M2,52 C11,48 17,55 13,63 C10,69 4,68 2,63", w: CURVE },
    ],
  },
  c: { adv: 18, strokes: [{ d: "M16,52 C6,48 0,56 2,64 C4,71 12,72 16,68", w: STEM }] },
  d: {
    adv: 20,
    strokes: [
      { d: "M16,54 C7,50 2,58 4,66 C7,72 14,71 16,66", w: CURVE },
      { d: "M18,30 L14,74", w: STEM },
    ],
  },
  e: {
    adv: 19,
    strokes: [
      { d: "M16,52 C6,48 1,56 4,64 C7,71 15,71 18,66", w: STEM },
      { d: "M3,58 L15,56", w: CURVE },
    ],
  },
  f: {
    adv: 16,
    strokes: [
      { d: "M14,32 C8,30 5,34 4,40 L0,74", w: STEM },
      { d: "M-3,50 L11,48", w: CURVE },
    ],
  },
  g: {
    adv: 20,
    strokes: [
      { d: "M16,52 C6,48 1,56 3,64 C6,70 13,68 15,60", w: CURVE },
      { d: "M16,52 L12,88 C11,94 3,94 1,88", w: STEM },
    ],
  },
  h: {
    adv: 19,
    strokes: [
      { d: "M4,30 L0,74", w: STEM },
      { d: "M1,56 C6,49 13,49 14,56 L12,74", w: CURVE },
    ],
  },
  i: {
    adv: 13,
    strokes: [
      { d: "M8,46 L2,74", w: STEM + 0.2 },
      { d: "M12,34 L7,41", w: TICK + 0.2 },
    ],
  },
  j: {
    adv: 14,
    strokes: [
      { d: "M10,48 L6,88 C5,94 -2,94 -4,88", w: STEM },
      { d: "M14,36 L10,42", w: TICK },
    ],
  },
  k: {
    adv: 18,
    strokes: [
      { d: "M4,30 L0,74", w: STEM },
      { d: "M14,50 L2,60 L14,74", w: CURVE },
    ],
  },
  l: { adv: 12, strokes: [{ d: "M8,30 L4,74", w: STEM }] },
  m: {
    adv: 27,
    strokes: [
      { d: "M2,48 L0,74", w: STEM },
      { d: "M0,55 C4,48 10,48 11,55 L10,74", w: CURVE },
      { d: "M10,56 C14,49 20,49 21,56 L20,74", w: CURVE },
    ],
  },
  n: {
    adv: 20,
    strokes: [
      { d: "M2,48 L0,74", w: STEM },
      { d: "M0,55 C5,48 12,48 13,55 L12,74", w: CURVE },
    ],
  },
  o: {
    adv: 20,
    strokes: [{ d: "M11,48 C3,48 0,56 3,64 C6,71 15,71 17,63 C19,55 16,49 11,48", w: STEM }],
  },
  p: {
    adv: 19,
    strokes: [
      { d: "M4,50 L-2,96", w: STEM },
      { d: "M2,52 C10,48 16,55 13,63 C10,69 3,68 1,63", w: CURVE },
    ],
  },
  q: {
    adv: 20,
    strokes: [
      { d: "M15,52 C6,49 1,57 4,65 C7,71 14,70 16,62", w: CURVE },
      { d: "M17,52 L14,92 C13.5,96 17,97 20,93", w: STEM },
    ],
  },
  r: {
    adv: 17,
    strokes: [
      { d: "M6,52 L1,76", w: STEM },
      { d: "M2,58 C6,50 13,49 15,54", w: CURVE },
    ],
  },
  s: {
    adv: 19,
    strokes: [
      {
        d: "M15,48 C6,45 1,49.5 2.5,53 C4,56 10,56.5 11.5,59.5 C13,62.5 8.5,65.5 4,64 C2.5,63.4 1.5,62.4 1.2,61.4",
        w: CURVE + 0.3,
      },
    ],
  },
  t: {
    adv: 23,
    strokes: [
      { d: "M15,30 L8,78 C7,84 15,86 21,79", w: STEM },
      { d: "M0,46 L28,40", w: STEM + 0.2 },
    ],
  },
  u: {
    adv: 20,
    strokes: [{ d: "M2,50 L1,64 C1,71 9,73 12,66 L15,50 L13,74", w: STEM }],
  },
  v: { adv: 18, strokes: [{ d: "M2,50 L8,74 L16,50", w: STEM }] },
  w: { adv: 25, strokes: [{ d: "M0,50 L5,74 L10,54 L15,74 L21,50", w: STEM }] },
  x: {
    adv: 18,
    strokes: [
      { d: "M2,50 L16,74", w: STEM },
      { d: "M16,50 L2,74", w: CURVE },
    ],
  },
  y: {
    adv: 18,
    strokes: [
      { d: "M2,50 L8,66", w: CURVE },
      { d: "M16,48 L8,88 C6,94 0,94 -2,89", w: STEM },
    ],
  },
  z: { adv: 18, strokes: [{ d: "M1,52 L15,50 L2,72 L17,71", w: STEM }] },
};

const NS = "http://www.w3.org/2000/svg";

/**
 * Compose a phrase into an SVG in the tag hand. `press` scales stroke weight
 * (the visit's ink pressure); the caller sizes/rotates the element via the
 * .headline-art custom properties.
 */
export function renderTag(text: string, press = 1): SVGSVGElement {
  const LETTER_GAP = 3.5;
  let cursor = 6;
  const main = document.createElementNS(NS, "g");
  const echo = document.createElementNS(NS, "g");
  for (const ch of text) {
    const glyph = GLYPHS[ch] ?? GLYPHS[" "];
    for (const s of glyph.strokes) {
      const mk = (): SVGPathElement => {
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", s.d);
        p.setAttribute("stroke-width", (s.w * press).toFixed(2));
        p.setAttribute("transform", `translate(${cursor.toFixed(1)},0)`);
        return p;
      };
      main.appendChild(mk());
      echo.appendChild(mk());
    }
    cursor += glyph.adv + LETTER_GAP;
  }
  const width = cursor + 6;

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${Math.ceil(width)} 130`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.dataset.tagWidth = String(Math.ceil(width));

  const common = (g: SVGGElement): void => {
    g.setAttribute("fill", "none");
    // Stroke follows the --tag-ink custom property, defaulting to the element's
    // currentColor so nothing changes by default; body.env-light flips --tag-ink
    // dark so the aside re-inks on the light dawn / daylight fields.
    g.setAttribute("stroke", "var(--tag-ink, currentColor)");
    g.setAttribute("stroke-linecap", "round");
    g.setAttribute("stroke-linejoin", "round");
  };
  common(echo);
  echo.setAttribute("transform", "translate(2.6,3) skewX(-8)");
  echo.setAttribute("opacity", "0.16");
  common(main);
  main.setAttribute("transform", "skewX(-8)");
  main.setAttribute("filter", "url(#aside-marker)");
  main.setAttribute("opacity", "0.95");

  svg.append(echo, main);
  return svg;
}
