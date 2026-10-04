// Post-processing: pmndrs postprocessing composer with HDR (HalfFloat) frame
// buffers so >1.0 colors survive to the bloom pass. luminanceThreshold 1.0
// means only HDR (hover/focus/shimmer-peak) colors glow — per DESIGN.md.

import { HalfFloatType, Uniform, type Camera, type Scene, type WebGLRenderer } from "three";
import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectComposer,
  EffectPass,
  RenderPass,
  VignetteEffect,
} from "postprocessing";
import { HANGA_TEXTURE } from "./artstyle";

const glf = (x: number): string => x.toFixed(4);

// Paper overlay (Hanga styles 3 and 4 only). The final frame is multiplied by
// a procedural sheet fixed to the SCREEN, like real paper under a print, so it
// never moves with the scene and cannot shimmer. Static: no time term. Feature
// sizes are in CSS px (gl px divided by the device pixel ratio), so 1x and 2x
// screens show the same paper. The modulation is authored as a peak-to-peak
// sRGB luminance swing and applied as its LINEAR equivalent (pow 2.2).
const PAPER_FRAG = /* glsl */ `
  uniform float uDpr;
  uniform vec3 uStrength; // x mottle, y fibre, z laid lines (peak-to-peak, sRGB)
  uniform float uFibreSign; // -1 dark fibres (Washi), +1 pale fibres (Dusk)

  float pHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float pNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 w = f * f * (3.0 - 2.0 * f);
    return mix(mix(pHash(i), pHash(i + vec2(1.0, 0.0)), w.x),
               mix(pHash(i + vec2(0.0, 1.0)), pHash(i + vec2(1.0, 1.0)), w.x), w.y);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 px = uv * resolution / max(uDpr, 0.5); // CSS px, screen-fixed
    // Mottle: four octaves of value noise.
    vec2 q = px / ${glf(HANGA_TEXTURE.PAPER_MOTTLE_PX)};
    float m = 0.5 * pNoise(q) + 0.25 * pNoise(q * 2.03 + 11.0)
            + 0.125 * pNoise(q * 4.11 + 23.0) + 0.0625 * pNoise(q * 8.27 + 37.0);
    m = m / 0.9375 - 0.5; // -0.5 .. 0.5
    // Fibres: thin streaks, mostly horizontal, each patch of paper turned a
    // little (a slow rotation field) so they wander instead of ruling lines.
    // Two layers at different lengths keep only their highest ridges, so the
    // fibres stay sparse, the way kozo strands sit in a sheet.
    float ang = (pNoise(px / 320.0 + 5.0) - 0.5) * 0.7;
    float ca = cos(ang); float sa = sin(ang);
    vec2 r = vec2(ca * px.x + sa * px.y, -sa * px.x + ca * px.y);
    float bend = (pNoise(px / 90.0 + 41.0) - 0.5) * 4.0;
    float f1 = pNoise(vec2(r.x / ${glf(HANGA_TEXTURE.PAPER_FIBRE_LEN_PX)}, (r.y + bend) / 1.5));
    float f2 = pNoise(vec2(r.x / ${glf(HANGA_TEXTURE.PAPER_FIBRE_LEN_PX * 0.45)} + 71.0, (r.y - bend) / 1.1 + 13.0));
    float fib = max(smoothstep(0.8, 0.96, f1), 0.8 * smoothstep(0.82, 0.97, f2));
    // Laid lines: faint close horizontal lines that come and go in patches,
    // and a wide vertical chain line.
    float laid = (0.5 + 0.5 * sin(px.y * 6.2831853 / ${glf(HANGA_TEXTURE.PAPER_LAID_PX)})) * pNoise(px / 60.0 + 3.0);
    float chain = 1.0 - smoothstep(0.0, 1.6, abs(mod(px.x, 140.0) - 70.0));
    float lum = 1.0 + uStrength.x * m + uFibreSign * uStrength.y * fib
              - uStrength.z * (0.6 * laid + 0.4 * chain - 0.3);
    outputColor = vec4(inputColor.rgb * pow(max(lum, 0.0), 2.2), inputColor.a);
  }
`;

class PaperEffect extends Effect {
  constructor() {
    super("HangaPaperEffect", PAPER_FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ["uDpr", new Uniform(1)],
        ["uStrength", new Uniform([0, 0, 0])],
        ["uFibreSign", new Uniform(-1)],
      ]),
    });
  }
}

export interface BloomRig {
  composer: EffectComposer;
  render(deltaSeconds: number): void;
  setSize(width: number, height: number): void;
  /**
   * Paper mode (art styles): bypass the composer entirely — a flat direct
   * render, no bloom, no vignette. Paint on paper doesn't glow, and the
   * vignette would grime a cream board. Galaxy (off) restores the full chain.
   */
  setArtPaper(on: boolean): void;
  /**
   * Ink mode (the Hanga styles 3 and 4): KEEP the composer, so its 4x MSAA
   * still antialiases the brush strokes and disc silhouettes, but print with
   * bloom intensity 0 and vignette darkness 0 (ink on paper never glows, and a
   * vignette would grime the field). The paper bypass of styles 1 and 2 is
   * unchanged. Off restores the Galaxy chain.
   */
  setArtInk(on: boolean, dusk?: boolean): void;
  /**
   * Concrete-daylight dimmer (Galaxy, Transit pose): scale bloom intensity by
   * (1 − daylight) so the glow bleeds out as the city surfaces into daylight.
   * Full daylight reuses the paper bypass pathway — direct render, no bloom, no
   * vignette — for enamel-sign clarity; the moment the city morphs back toward
   * the Blueprint the bloom returns with the dark.
   */
  setDaylight(daylight01: number): void;
  dispose(): void;
}

export interface BloomOptions {
  /** Bloom render-target scale. 0.5 halves the buffers (mobile perf). */
  resolutionScale?: number;
  /**
   * MSAA sample count for the composer's HDR geometry pass (WebGL2 only; the
   * composer clamps to gl.MAX_SAMPLES and ignores it on WebGL1). Hardware AA is
   * off on the renderer (main.ts) because MSAA on the default backbuffer can't
   * coexist with a postprocessing chain — but the composer CAN multisample its
   * own intermediate render target. Without it the orb InstancedMesh silhouettes
   * and HDR cores get NO antialiasing and the flat screen-space edge ribbons
   * alias as the camera drifts / the shimmer pulses their size — a constant
   * sub-pixel-coverage sizzle. 4 samples resolves the silhouettes cleanly at a
   * negligible fill cost on this budget; 0 disables (mobile / low-power path).
   */
  multisampling?: number;
}

export function createBloom(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  opts: BloomOptions = {},
): BloomRig {
  const composer = new EffectComposer(renderer, {
    frameBufferType: HalfFloatType,
    multisampling: opts.multisampling ?? 0,
  });

  const BASE_INTENSITY = 0.95;
  const bloom = new BloomEffect({
    // 0.9 (vs the original 1.0): shimmer peaks and the brightest strand tones
    // breathe a gentle halo at idle — "galaxy", not "black room".
    luminanceThreshold: 0.9,
    // 0.5 (vs 0.25): widen the soft knee around the threshold so a pixel whose
    // luminance rides UP THROUGH 0.9 (a shimmer peak, a node easing into focus,
    // an edge comet cresting) fades into bloom instead of popping on/off between
    // frames. The threshold itself is unchanged — bloom stays reserved for
    // genuinely HDR emphasis per DESIGN.md; this only softens the transition so
    // the threshold crossing stops flickering during click/trace cascades.
    luminanceSmoothing: 0.5,
    intensity: BASE_INTENSITY,
    radius: 0.7,
    mipmapBlur: true,
    resolutionScale: opts.resolutionScale ?? 1.0,
  });

  // Gentle vignette: pulls the eye toward the constellation and gives the
  // frame an observatory-glass feel without visibly darkening the data.
  const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.55 });

  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new EffectPass(camera, bloom, vignette);
  composer.addPass(bloomPass);
  // Hanga paper overlay: a separate pass, disabled outside styles 3 and 4.
  // addPass hands renderToScreen to the newest pass, so give it back to the
  // bloom pass at once: off-Hanga the chain is exactly the shipped one.
  const paper = new PaperEffect();
  const paperPass = new EffectPass(camera, paper);
  composer.addPass(paperPass);
  paperPass.enabled = false;
  paperPass.renderToScreen = false;
  bloomPass.renderToScreen = true;
  const paperStrength = paper.uniforms.get("uStrength")!.value as number[];
  const paperDpr = paper.uniforms.get("uDpr")!;
  const paperSign = paper.uniforms.get("uFibreSign")!;

  let artPaper = false;
  let artInk = false;
  const VIGNETTE_DARKNESS = vignette.darkness;
  let daylight = 0; // 0 full bloom … 1 concrete daylight (no bloom)

  return {
    composer,
    render(deltaSeconds) {
      // Full daylight reuses the paper bypass — a flat direct render, no bloom,
      // no vignette (enamel-sign clarity).
      if (artPaper || daylight >= 0.999) {
        renderer.render(scene, camera);
        return;
      }
      if (artInk) {
        // Ink mode: the composer runs for its MSAA. The bloom pass is off (no
        // glow, no vignette) and the paper pass prints the frame on the sheet.
        paperDpr.value = renderer.getPixelRatio();
        composer.render(deltaSeconds);
        return;
      }
      bloom.intensity = BASE_INTENSITY * (1 - daylight);
      vignette.darkness = VIGNETTE_DARKNESS;
      composer.render(deltaSeconds);
    },
    setSize(width, height) {
      composer.setSize(width, height);
    },
    setArtPaper(on) {
      artPaper = on;
    },
    setArtInk(on, dusk = false) {
      artInk = on;
      const T = HANGA_TEXTURE;
      paperStrength[0] = dusk ? T.PAPER_MOTTLE_DUSK : T.PAPER_MOTTLE_WASHI;
      paperStrength[1] = dusk ? T.PAPER_FIBRE_DUSK : T.PAPER_FIBRE_WASHI;
      paperStrength[2] = dusk ? T.PAPER_LAID_DUSK : T.PAPER_LAID_WASHI;
      paperSign.value = dusk ? 1 : -1;
      // Swap which pass prints to the screen. Off-Hanga this restores the
      // shipped chain (bloom pass to screen, paper pass skipped).
      if (paperPass.enabled !== on) {
        paperPass.enabled = on;
        bloomPass.enabled = !on;
        paperPass.renderToScreen = on;
        bloomPass.renderToScreen = !on;
      }
    },
    setDaylight(daylight01) {
      daylight = daylight01 < 0 ? 0 : daylight01 > 1 ? 1 : daylight01;
    },
    dispose() {
      composer.dispose();
    },
  };
}
