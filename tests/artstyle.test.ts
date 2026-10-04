// The art-style registry and the Hanga woodblock skins (styles 3 Washi, 4 Dusk).
//
// Guards: the index-aligned registries (names, slugs, credits) never drift
// apart; every Hanga pigment reads against its own field (WCAG 3:1 for marks);
// the legend swatches track the Hanga pigments; and the brush-stroke and dab
// math, which the edge shader mirrors, keeps its shape (a head at full width, a
// monotone taper after the pool, a tip near zero, soft round dabs with no step).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import type { GraphCore, StrandId } from "../src/data";
import {
  ART_CREDITS,
  ART_STYLE_NAMES,
  ART_STYLE_SLUGS,
  HANGA,
  HANGA_DUSK_DAMAGE,
  HANGA_TEXTURE,
  hangaPalette,
  isHanga,
  strandSwatch,
  type ArtStyle,
} from "../src/scene/artstyle";
import { STRAND_COLORS, STRAND_ORDER } from "../src/scene/palette";
import {
  HANGA_DAB,
  HANGA_STROKE,
  createEdges,
  hangaDabAlpha,
  hangaStrokeWidth,
} from "../src/scene/edges";
import { computeNodeRadii } from "../src/scene/reach";

const HERE = dirname(fileURLToPath(import.meta.url));

// WCAG 2.x relative luminance and contrast ratio.
function lum(hex: number): number {
  const ch = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a: number, b: number): number {
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe("art-style registry", () => {
  it("keeps names, slugs, and credits index-aligned for all five styles", () => {
    expect(ART_STYLE_NAMES.length).toBe(5);
    expect(ART_STYLE_SLUGS.length).toBe(ART_STYLE_NAMES.length);
    expect(ART_CREDITS.length).toBe(ART_STYLE_NAMES.length);
    expect(ART_STYLE_SLUGS[3]).toBe("washi");
    expect(ART_STYLE_SLUGS[4]).toBe("dusk");
    expect(ART_STYLE_NAMES[3]).toBe("Washi");
    expect(ART_STYLE_NAMES[4]).toBe("Dusk");
  });

  it("has unique slugs", () => {
    expect(new Set(ART_STYLE_SLUGS).size).toBe(ART_STYLE_SLUGS.length);
  });

  it("credits both Hanga styles in plain text", () => {
    for (const s of [3, 4]) {
      expect(ART_CREDITS[s].html).toBe("After Wada Sanzo, Oda Kazuma, and Utagawa Hiroshige");
    }
  });

  it("flags only styles 3 and 4 as Hanga", () => {
    expect([0, 1, 2, 3, 4].map(isHanga)).toEqual([false, false, false, true, true]);
    expect(hangaPalette(3)).toBe(HANGA.washi);
    expect(hangaPalette(4)).toBe(HANGA.dusk);
  });
});

describe("strand swatches", () => {
  it("return the Hanga pigments under styles 3 and 4", () => {
    for (const s of STRAND_ORDER) {
      expect(strandSwatch(s, 3)).toBe(HANGA.washi.pigment[s]);
      expect(strandSwatch(s, 4)).toBe(HANGA.dusk.pigment[s]);
    }
  });

  it("keep the Galaxy palette at style 0", () => {
    for (const s of STRAND_ORDER) expect(strandSwatch(s, 0 as ArtStyle)).toBe(STRAND_COLORS[s]);
  });
});

describe("Hanga palette", () => {
  it("matches the approved preview hexes", () => {
    expect(HANGA.washi.bg).toBe(0xefe6d2);
    expect(HANGA.washi.pigment).toEqual({
      number: 0xad7408,
      algebra: 0x8250a6,
      geometry: 0x16808a,
      data: 0xc8364a,
    });
    expect(HANGA.dusk.top).toBe(0x12233f);
    expect(HANGA.dusk.bottom).toBe(0x4a6185);
    expect(HANGA.dusk.bg).toBe(0x2e4262); // mix(top, bottom, 0.5), as the preview derives it
    expect(HANGA.dusk.pigment).toEqual({
      number: 0xeab64a,
      algebra: 0xb99ae2,
      geometry: 0x5cc2b6,
      data: 0xf07c72,
    });
  });

  for (const key of ["washi", "dusk"] as const) {
    it(`gives every ${key} pigment WCAG contrast of 3.0 or more against its field`, () => {
      const pal = HANGA[key];
      for (const s of STRAND_ORDER as StrandId[]) {
        expect(contrast(pal.pigment[s], pal.bg), `${key} ${s}`).toBeGreaterThanOrEqual(3.0);
      }
    });
  }
});

describe("Hanga brush stroke width", () => {
  it("is exactly the head width at the prerequisite end", () => {
    expect(hangaStrokeWidth(0)).toBe(1);
  });

  it("pools a little just after the head, then settles back by POOL_END", () => {
    let peak = 0;
    for (let i = 0; i <= 100; i++) peak = Math.max(peak, hangaStrokeWidth((i / 100) * HANGA_STROKE.POOL_END));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(1 + HANGA_STROKE.POOL + 1e-9);
    expect(hangaStrokeWidth(HANGA_STROKE.POOL_END)).toBeCloseTo(1, 9);
  });

  it("never widens again after the pool peak (monotone taper)", () => {
    const n = 2000;
    let peakU = 0;
    let peak = -1;
    for (let i = 0; i <= n; i++) {
      const w = hangaStrokeWidth(i / n);
      if (w > peak) {
        peak = w;
        peakU = i / n;
      }
    }
    let prev = hangaStrokeWidth(peakU);
    for (let i = Math.ceil(peakU * n) + 1; i <= n; i++) {
      const w = hangaStrokeWidth(i / n);
      expect(w).toBeLessThanOrEqual(prev + 1e-12);
      prev = w;
    }
  });

  it("holds full width to the taper start, then whisks to near zero at the tip", () => {
    expect(hangaStrokeWidth(HANGA_STROKE.TAPER_START)).toBeCloseTo(1, 9);
    expect(hangaStrokeWidth(1)).toBeCloseTo(HANGA_STROKE.TAIL, 9);
    expect(hangaStrokeWidth(1) * HANGA_STROKE.HEAD_PX).toBeLessThan(0.2); // CSS px
    // A long wisp: by the start of the dry brush the stroke is still mostly
    // full, and by 80% it is under a third of the head.
    expect(hangaStrokeWidth(HANGA_STROKE.KASURE_START)).toBeGreaterThan(0.75);
    expect(hangaStrokeWidth(0.8)).toBeLessThan(0.33);
  });

  it("clamps outside [0, 1] (inside the discs)", () => {
    expect(hangaStrokeWidth(-0.3)).toBe(1);
    expect(hangaStrokeWidth(1.4)).toBeCloseTo(HANGA_STROKE.TAIL, 9);
  });
});

describe("Hanga related dabs", () => {
  const rx = HANGA_DAB.RX_PX;
  const ry = HANGA_DAB.RY_PX;

  it("is solid in the core and gone past the ellipse edge", () => {
    expect(hangaDabAlpha(0, 0, rx, ry)).toBe(1);
    expect(hangaDabAlpha(rx * 1.01, 0, rx, ry)).toBe(0);
    expect(hangaDabAlpha(0, ry * 1.01, rx, ry)).toBe(0);
  });

  it("is symmetric and soft (no hard step anywhere)", () => {
    expect(hangaDabAlpha(0.5, 0.2, rx, ry)).toBeCloseTo(hangaDabAlpha(-0.5, -0.2, rx, ry), 12);
    const n = 1000;
    let maxStep = 0;
    let prev = hangaDabAlpha(0, 0, rx, ry);
    for (let i = 1; i <= n; i++) {
      const a = hangaDabAlpha((i / n) * rx * 1.2, 0, rx, ry);
      maxStep = Math.max(maxStep, Math.abs(a - prev));
      prev = a;
    }
    expect(maxStep).toBeLessThan(0.02);
    // Partial values exist, so the edge is a feather, not a cut.
    expect(hangaDabAlpha(rx * 0.7, 0, rx, ry)).toBeGreaterThan(0.05);
    expect(hangaDabAlpha(rx * 0.7, 0, rx, ry)).toBeLessThan(0.95);
  });

  it("spaces dabs so neighbours never merge into a dash", () => {
    const maxLen = 2 * (HANGA_DAB.RX_PX + HANGA_DAB.RX_JITTER_PX);
    expect(HANGA_DAB.SPACING_PX).toBeGreaterThan(maxLen * 1.5);
  });
});

describe("Hanga edge shader", () => {
  it("generates its constants from the TS tables and keeps 16 attributes", () => {
    const core: GraphCore = JSON.parse(
      readFileSync(resolvePath(HERE, "..", "public/data/graph-core.json"), "utf8"),
    );
    const radii = computeNodeRadii(core);
    const idx = new Map(core.nodes.map((n, i) => [n.id, i]));
    const edges = createEdges(
      core.edges,
      new Map(core.nodes.map((n) => [n.id, n])),
      (id) => radii[idx.get(id) ?? 0],
    );
    const mat = edges.mesh.material as unknown as { vertexShader: string; fragmentShader: string };
    for (const [k, v] of Object.entries(HANGA_STROKE)) {
      expect(mat.vertexShader).toContain(`const float H_${k} = ${v.toFixed(4)};`);
    }
    expect(mat.fragmentShader).toContain(`const float HD_SOFT = ${HANGA_DAB.SOFT.toFixed(4)};`);
    // The edge program is at WebGL2's 16-attribute floor: no new attribute.
    const attrs = mat.vertexShader.match(/^\s*in\s+\w+\s+\w+;/gm) ?? [];
    expect(attrs.length).toBe(16);
    // Every Hanga branch sits behind the style test, unreachable at style 0.
    expect(mat.vertexShader).toContain("} else if (uArtStyle < 2.5) {");
    expect(mat.fragmentShader).toContain("} else if (uArtStyle < 2.5) {");
    edges.dispose();
  });
});

describe("Dusk damage reads darker than lit (QA F3)", () => {
  // TS mirror of the Dusk damage branch in the Hanga disc shader, on the flat
  // pigment (LINEAR), returned as sRGB luminance 0..255 over the field.
  const toLin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const toSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
  const rgb = (hex: number): number[] => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => toLin(v / 255));
  const ss = (e0: number, e1: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  function shown(hex: number, d: number): number {
    const D = HANGA_DUSK_DAMAGE;
    const field = rgb(HANGA.dusk.bg);
    let c = rgb(hex);
    const kd = ss(0, D.RAMP, d);
    const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    c = c.map((v) => v + (lum - v) * D.DESAT * kd);
    c = c.map((v) => v * (1 + (D.DARKEN - 1) * kd));
    c = c.map((v, i) => v + (field[i] - v) * D.WASH * d);
    const a = 1 - D.ALPHA * d;
    c = c.map((v, i) => v * a + field[i] * (1 - a)); // composite over the field
    const s = c.map(toSrgb);
    return 255 * (0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]);
  }

  it("drops every pigment by 45 or more of 255 from the story floor (0.35) up", () => {
    for (const sid of STRAND_ORDER) {
      const lit = shown(HANGA.dusk.pigment[sid], 0);
      for (const d of [0.35, 0.5, 0.75, 1]) {
        expect(lit - shown(HANGA.dusk.pigment[sid], d), `${sid} d=${d}`).toBeGreaterThanOrEqual(45);
      }
    }
  });

  it("keeps a husk lighter than the bare field (a stain, not a hole)", () => {
    const fieldLum = shown(HANGA.dusk.bg, 0);
    for (const sid of STRAND_ORDER) expect(shown(HANGA.dusk.pigment[sid], 1)).toBeGreaterThan(fieldLum);
  });
});

describe("Hanga hand-made texture", () => {
  it("keeps every amplitude inside the designer brief (round 2)", () => {
    const T = HANGA_TEXTURE;
    expect(T.ROUGH_PERIOD).toBeGreaterThanOrEqual(0.04);
    expect(T.ROUGH_PERIOD).toBeLessThanOrEqual(0.1);
    expect(T.ROUGH_AMP).toBeLessThanOrEqual(0.3);
    expect(T.BLEED_MIN_PX).toBeGreaterThanOrEqual(0.8);
    expect(T.BLEED_MAX_PX).toBeLessThanOrEqual(1.2); // more and thin strokes turn to haze
    expect(T.UNEVEN_HEAD).toBeGreaterThanOrEqual(0.15);
    expect(T.UNEVEN_TAIL).toBeLessThanOrEqual(0.5);
    expect(T.UNEVEN_HEAD).toBeLessThanOrEqual(T.UNEVEN_TAIL); // denser at the head
    expect(T.STREAK_ALPHA).toBeLessThan(0.6); // a bristle mark, never a gap
    expect(T.DISC_UNEVEN).toBeLessThanOrEqual(0.18);
    expect(T.DISC_BAREN).toBeLessThanOrEqual(0.2);
    expect(T.SPLAT_RATE).toBeLessThanOrEqual(1 / 3 + 1e-9);
    expect(T.SPLAT_MIN_PX).toBeGreaterThanOrEqual(0.5);
    expect(T.SPLAT_MAX_PX).toBeLessThanOrEqual(2);
    expect(T.SPLAT_FAR_PX).toBeLessThanOrEqual(5);
    expect(T.FLECK_RATE).toBeLessThan(0.005);
  });

  it("keeps the paper overlay inside its luminance budget, fibres above the mottle", () => {
    const T = HANGA_TEXTURE;
    const washi = T.PAPER_MOTTLE_WASHI + T.PAPER_FIBRE_WASHI + T.PAPER_LAID_WASHI;
    const dusk = T.PAPER_MOTTLE_DUSK + T.PAPER_FIBRE_DUSK + T.PAPER_LAID_DUSK;
    expect(T.PAPER_MOTTLE_WASHI).toBeGreaterThanOrEqual(0.1);
    expect(T.PAPER_FIBRE_WASHI).toBeLessThanOrEqual(0.14);
    expect(T.PAPER_MOTTLE_DUSK).toBeGreaterThanOrEqual(0.07);
    expect(T.PAPER_FIBRE_DUSK).toBeLessThanOrEqual(0.1);
    expect(T.PAPER_FIBRE_WASHI).toBeGreaterThan(T.PAPER_MOTTLE_WASHI);
    expect(T.PAPER_FIBRE_DUSK).toBeGreaterThan(T.PAPER_MOTTLE_DUSK);
    expect(T.PAPER_LAID_DUSK).toBe(0); // laid lines are a Washi feature
    // Worst-case total swing stays a texture, not a veil.
    expect(washi).toBeLessThan(0.3);
    expect(dusk).toBeLessThan(0.2);
  });

  it("generates the texture constants into both edge shaders", () => {
    const core: GraphCore = JSON.parse(
      readFileSync(resolvePath(HERE, "..", "public/data/graph-core.json"), "utf8"),
    );
    const radii = computeNodeRadii(core);
    const idx = new Map(core.nodes.map((n, i) => [n.id, i]));
    const edges = createEdges(
      core.edges,
      new Map(core.nodes.map((n) => [n.id, n])),
      (id) => radii[idx.get(id) ?? 0],
    );
    const mat = edges.mesh.material as unknown as { vertexShader: string; fragmentShader: string };
    for (const [k, v] of Object.entries(HANGA_TEXTURE)) {
      expect(mat.fragmentShader).toContain(`const float HT_${k} = ${v.toFixed(4)};`);
    }
    // No texture term reads the screen pixel: nothing crawls on a camera move.
    const hanga = mat.fragmentShader.slice(mat.fragmentShader.indexOf("HANGA (3 Washi | 4 Dusk) ===="));
    expect(hanga).not.toContain("gl_FragCoord");
    edges.dispose();
  });
});
