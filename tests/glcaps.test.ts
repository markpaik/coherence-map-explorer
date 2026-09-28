// GPU capability gate (src/scene/glcaps.ts), redteam finding 56: a WebGL2
// context without a float color buffer rendered the bloom chain into an
// incomplete framebuffer (a solid black scene, no message). main.ts sends such a
// device to the DOM list fallback; this pins the decision it makes.

import { describe, it, expect } from "vitest";
import { hasFloatColorBuffer, type GlExtensionSource } from "../src/scene/glcaps";

/** A fake context that exposes exactly `exts` (through both methods). */
function fakeGl(exts: string[], opts: { listOnly?: boolean } = {}): GlExtensionSource {
  return {
    getSupportedExtensions: () => exts,
    getExtension: (name: string) => (!opts.listOnly && exts.includes(name) ? {} : null),
  };
}

const BASE = ["EXT_texture_filter_anisotropic", "OES_texture_float_linear", "WEBGL_lose_context"];

describe("hasFloatColorBuffer", () => {
  it("is true with EXT_color_buffer_float", () => {
    expect(hasFloatColorBuffer(fakeGl([...BASE, "EXT_color_buffer_float"]))).toBe(true);
  });

  it("is true with only EXT_color_buffer_half_float", () => {
    expect(hasFloatColorBuffer(fakeGl([...BASE, "EXT_color_buffer_half_float"]))).toBe(true);
  });

  it("is false with neither (the black-scene devices take the list fallback)", () => {
    expect(hasFloatColorBuffer(fakeGl(BASE))).toBe(false);
    expect(hasFloatColorBuffer(fakeGl([]))).toBe(false);
  });

  it("is false when the extension is listed but cannot be obtained", () => {
    expect(hasFloatColorBuffer(fakeGl([...BASE, "EXT_color_buffer_float"], { listOnly: true }))).toBe(
      false,
    );
  });

  it("is false when the supported list is null (a lost context)", () => {
    expect(
      hasFloatColorBuffer({ getSupportedExtensions: () => null, getExtension: () => ({}) }),
    ).toBe(false);
  });
});
