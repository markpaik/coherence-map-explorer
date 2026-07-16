// One-time converter: Space Grotesk 600 (vendored WOFF1) -> a minimal
// typeface.json for three's FontLoader, containing only the glyphs the grade
// etchings need (K 1-8 H S). Output is committed; runtime never runs this.
//
//   node scripts/make-typeface.mjs
//
// Format notes (matching three's FontLoader parser):
//   glyph.o token stream — "m x y", "l x y", "q x y cpx cpy", "b x y cx1 cy1
//   cx2 cy2" — target point FIRST, control points after. Font units, y-up,
//   scaled at parse time by size/resolution. Close commands are omitted
//   (shapes close implicitly).

import { readFileSync, writeFileSync } from "node:fs";
import opentype from "opentype.js";

const SRC = new URL("../public/fonts/space-grotesk-latin-600-normal.woff", import.meta.url);

// Two subsets: the grade digits/K, and the letters the HS course arc labels
// need (ALGEBRA I / GEOMETRY / ALGEBRA II / ADVANCED + space).
const TARGETS = [
  { out: "../public/fonts/space-grotesk-600.typeface.json", chars: "K12345678HS" },
  { out: "../public/fonts/space-grotesk-600-course.typeface.json", chars: "ABCDEGILMNORTVY " },
];

const font = opentype.parse(readFileSync(SRC).buffer);

function r(v) {
  return Math.round(v);
}

for (const target of TARGETS) {
  const glyphs = {};
  for (const char of new Set(target.chars)) {
    const glyph = font.charToGlyph(char);
    if (!glyph || (glyph.index === 0 && char !== " "))
      throw new Error(`glyph missing for "${char}"`);
    const parts = [];
    for (const c of glyph.path.commands) {
      if (c.type === "M") parts.push("m", r(c.x), r(c.y));
      else if (c.type === "L") parts.push("l", r(c.x), r(c.y));
      else if (c.type === "Q") parts.push("q", r(c.x), r(c.y), r(c.x1), r(c.y1));
      else if (c.type === "C") parts.push("b", r(c.x), r(c.y), r(c.x1), r(c.y1), r(c.x2), r(c.y2));
      // "Z": implicit — three's Shape closes contours itself.
    }
    glyphs[char] = { ha: Math.round(glyph.advanceWidth), o: parts.join(" ") };
  }

  const typeface = {
    familyName: "Space Grotesk",
    styleName: "SemiBold",
    resolution: font.unitsPerEm,
    boundingBox: {
      xMin: font.tables.head.xMin,
      yMin: font.tables.head.yMin,
      xMax: font.tables.head.xMax,
      yMax: font.tables.head.yMax,
    },
    ascender: font.ascender,
    descender: font.descender,
    underlinePosition: font.tables.post?.underlinePosition ?? -100,
    underlineThickness: font.tables.post?.underlineThickness ?? 50,
    glyphs,
  };

  const out = new URL(target.out, import.meta.url);
  writeFileSync(out, JSON.stringify(typeface));
  console.log(
    `wrote ${out.pathname} — ${Object.keys(glyphs).length} glyphs, ` +
      `${(JSON.stringify(typeface).length / 1024).toFixed(1)}kB`,
  );
}
