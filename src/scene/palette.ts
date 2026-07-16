// Single source of truth for scene colors and emphasis states.
// Strand hexes are the DESIGN.md validated CVD palette (rest node + UI chip color).
import type { StrandId } from "../data";

export const BG = 0x050510; // page + WebGL clear

export const STRAND_COLORS: Record<StrandId, number> = {
  number: 0xc08a1e, // gold — Number & Quantity
  algebra: 0x8b5cf6, // violet — Algebra & Functions
  geometry: 0x1c9fbb, // cyan — Geometry
  data: 0xde5a85, // rose — Measurement, Data & Statistics
};

export const STRAND_LABELS: Record<StrandId, string> = {
  number: "Number & Quantity",
  algebra: "Algebra & Functions",
  geometry: "Geometry",
  data: "Measurement, Data & Statistics",
};

// Order the legend/rivers read left→right by spatial home angle (roughly).
export const STRAND_ORDER: StrandId[] = ["number", "algebra", "geometry", "data"];

// aEmphasis attribute values. All six reserved now so Phase 3 (focus/cascade)
// extends the shaders without a refactor. The nodes + edges shaders both
// switch on these exact numbers.
export const EMPHASIS = {
  DIMMED: 0,
  REST: 1,
  HOVER: 2,
  FOCUS: 3,
  CHAIN: 4,
  RELATED: 5,
} as const;

export type Emphasis = (typeof EMPHASIS)[keyof typeof EMPHASIS];

// Rest node radius from total degree (DESIGN node-states table).
export function restRadius(deg: number): number {
  return 1.6 + 0.35 * Math.sqrt(deg);
}
