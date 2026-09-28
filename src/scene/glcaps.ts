// GPU capability gate for the 3D scene. Kept free of DOM so the decision
// unit-tests in node (tests/glcaps.test.ts) against a fake context.
//
// A WebGL2 context alone is not enough. The bloom chain (scene/bloom.ts) renders
// into HalfFloat framebuffers, and WebGL2 can only render to a 16-bit float
// color buffer when EXT_color_buffer_float or EXT_color_buffer_half_float is
// available (three enables whichever exists at renderer init). A GPU with
// neither (older Android parts, some VMs and remote desktops) got a context,
// then every frame drew into an incomplete framebuffer: a solid black scene
// with no message. Those devices take the DOM list fallback instead.

export const FLOAT_COLOR_BUFFER_EXTENSIONS = [
  "EXT_color_buffer_float",
  "EXT_color_buffer_half_float",
] as const;

/** The two context methods the check reads (a WebGL2RenderingContext fits). */
export interface GlExtensionSource {
  getSupportedExtensions(): string[] | null;
  getExtension(name: string): unknown;
}

/**
 * Can this context render into a HalfFloat color buffer? True when either
 * float color-buffer extension is both listed as supported and obtainable.
 */
export function hasFloatColorBuffer(gl: GlExtensionSource): boolean {
  const supported = gl.getSupportedExtensions() ?? [];
  return FLOAT_COLOR_BUFFER_EXTENSIONS.some(
    (name) => supported.includes(name) && gl.getExtension(name) != null,
  );
}
