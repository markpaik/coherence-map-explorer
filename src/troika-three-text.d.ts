// Minimal ambient types for troika-three-text (ships no .d.ts of its own).
// Only the surface we use in src/scene/etches.ts is declared.
declare module "troika-three-text" {
  import type { Mesh, Material, Color } from "three";

  export class Text extends Mesh {
    text: string;
    font: string | null;
    fontSize: number;
    color: number | string | Color;
    anchorX: number | "left" | "center" | "right" | string;
    anchorY:
      | number
      | "top"
      | "top-baseline"
      | "middle"
      | "bottom-baseline"
      | "bottom"
      | string;
    letterSpacing: number;
    fillOpacity: number;
    outlineWidth: number | string;
    material: Material;
    maxWidth: number;
    depthOffset: number;
    sync(callback?: () => void): void;
    dispose(): void;
  }
}
