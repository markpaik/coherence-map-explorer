// Post-processing: pmndrs postprocessing composer with HDR (HalfFloat) frame
// buffers so >1.0 colors survive to the bloom pass. luminanceThreshold 1.0
// means only HDR (hover/focus/shimmer-peak) colors glow — per DESIGN.md.

import { HalfFloatType, type Camera, type Scene, type WebGLRenderer } from "three";
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  VignetteEffect,
} from "postprocessing";

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
  composer.addPass(new EffectPass(camera, bloom, vignette));

  let artPaper = false;
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
      bloom.intensity = BASE_INTENSITY * (1 - daylight);
      composer.render(deltaSeconds);
    },
    setSize(width, height) {
      composer.setSize(width, height);
    },
    setArtPaper(on) {
      artPaper = on;
    },
    setDaylight(daylight01) {
      daylight = daylight01 < 0 ? 0 : daylight01 > 1 ? 1 : daylight01;
    },
    dispose() {
      composer.dispose();
    },
  };
}
