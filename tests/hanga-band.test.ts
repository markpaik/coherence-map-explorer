// The sheet's top band on Washi and Dusk (scene/environs.ts): screen-fixed,
// running to the title block's bottom plus a margin, then fading out. The band
// path must be inert at style 0: only the Hanga materials read its uniforms,
// and they are hidden at style 0.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BAND_DEFAULT,
  BAND_MARGIN,
  HANGA_FIELD_GLSL,
  HANGA_SCREEN_UNIFORMS,
  bandBottomFrac,
} from "../src/scene/environs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string): string => readFileSync(resolve(ROOT, p), "utf8");

describe("bandBottomFrac: the band runs 24px past the title block's last line", () => {
  it("normalizes the title bottom plus the margin by the screen height", () => {
    expect(BAND_MARGIN).toBe(24);
    expect(bandBottomFrac(270, 900)).toBeCloseTo((270 + 24) / 900, 10);
    expect(bandBottomFrac(64, 844)).toBeCloseTo(88 / 844, 10);
  });
  it("falls back to 0.11 with no title (hidden, stepped aside, Browse)", () => {
    expect(BAND_DEFAULT).toBe(0.11);
    expect(bandBottomFrac(null, 900)).toBe(0.11);
    expect(bandBottomFrac(200, 0)).toBe(0.11);
  });
  it("stays on the screen", () => {
    expect(bandBottomFrac(-500, 900)).toBe(0.02);
    expect(bandBottomFrac(5000, 900)).toBe(0.75);
  });
});

describe("the shared screen uniforms", () => {
  it("start at the default band and a unit viewport", () => {
    expect(HANGA_SCREEN_UNIFORMS.uBandBottom.value).toBe(BAND_DEFAULT);
    expect(HANGA_SCREEN_UNIFORMS.uViewport.value.x).toBeGreaterThan(0);
  });
  it("are declared by the field chunk and read from gl_FragCoord, not elevation", () => {
    expect(HANGA_FIELD_GLSL).toContain("uniform vec2 uViewport;");
    expect(HANGA_FIELD_GLSL).toContain("uniform float uBandBottom;");
    expect(HANGA_FIELD_GLSL).toMatch(/gl_FragCoord\.y \/ max\(uViewport\.y, 1\.0\)/);
  });
});

describe("inert at style 0 (source guards)", () => {
  const env = read("src/scene/environs.ts");
  const land = read("src/scene/landscape.ts");

  it("the Galaxy shells never call the Hanga field", () => {
    const frag = env.slice(env.indexOf("const SHELL_FRAG"), env.indexOf("function makeShellMaterial"));
    const main = frag.slice(frag.indexOf("void main()"));
    const beforeHanga = main.slice(0, main.indexOf("uType >= 3"));
    expect(beforeHanga).not.toMatch(/hangaField|hBandT|uBandBottom/);
  });

  it("the Hanga shell shows only for styles 3 and 4", () => {
    expect(env).toContain("const on = isHanga(style);\n    hangaGroup.visible = on;");
  });

  it("the landscape, the chunk's other user, starts hidden and shares the same uniform objects", () => {
    expect(land).toContain("group.visible = false;");
    expect(land).toContain("...HANGA_SCREEN_UNIFORMS");
  });

  it("the band setter only writes the shared uniform", () => {
    const setter = env.slice(env.indexOf("setBandBottom(frac) {"), env.indexOf("dispose() {", env.indexOf("setBandBottom(frac) {")));
    expect(setter).toContain("HANGA_SCREEN_UNIFORMS.uBandBottom.value = frac;");
    expect(setter).not.toMatch(/visible|uType|uOpacity/);
  });
});
