// Post-processing: pmndrs postprocessing composer with HDR (HalfFloat) frame
// buffers so >1.0 colors survive to the bloom pass. luminanceThreshold 1.0
// means only HDR (hover/focus/shimmer-peak) colors glow — per DESIGN.md.

import { HalfFloatType, type Camera, type Scene, type WebGLRenderer } from "three";
import { BloomEffect, EffectComposer, EffectPass, RenderPass } from "postprocessing";

export interface BloomRig {
  composer: EffectComposer;
  render(deltaSeconds: number): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

export interface BloomOptions {
  /** Bloom render-target scale. 0.5 halves the buffers (mobile perf). */
  resolutionScale?: number;
}

export function createBloom(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  opts: BloomOptions = {},
): BloomRig {
  const composer = new EffectComposer(renderer, {
    frameBufferType: HalfFloatType,
  });

  const bloom = new BloomEffect({
    // 0.9 (vs the original 1.0): shimmer peaks and the brightest strand tones
    // breathe a gentle halo at idle — "galaxy", not "black room".
    luminanceThreshold: 0.9,
    luminanceSmoothing: 0.25,
    intensity: 0.95,
    radius: 0.7,
    mipmapBlur: true,
    resolutionScale: opts.resolutionScale ?? 1.0,
  });

  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new EffectPass(camera, bloom));

  return {
    composer,
    render(deltaSeconds) {
      composer.render(deltaSeconds);
    },
    setSize(width, height) {
      composer.setSize(width, height);
    },
    dispose() {
      composer.dispose();
    },
  };
}
