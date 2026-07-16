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

export function createBloom(renderer: WebGLRenderer, scene: Scene, camera: Camera): BloomRig {
  const composer = new EffectComposer(renderer, {
    frameBufferType: HalfFloatType,
  });

  const bloom = new BloomEffect({
    luminanceThreshold: 1.0,
    luminanceSmoothing: 0.2,
    intensity: 0.9,
    radius: 0.7,
    mipmapBlur: true,
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
