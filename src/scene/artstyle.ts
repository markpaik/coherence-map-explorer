// Art styles: the scene's five render skins.
//   0 Galaxy  — the shipped dark look (bloom, additive light, HDR emphasis).
//   1 Ringers — after Dmitri Cherniak: cream board, bold-outlined pegs in
//               white/red/yellow/blue/green, taut pure-color strings.
//   2 Fidenza — after Tyler Hobbs: teal field, cube nodes, thick flat ribbons
//               in the navy/brown/cream/yellow/red/mint colorway with striped
//               end caps.
//   3 Washi:  Japanese woodblock (hanga) on a washi daylight field: a
//               Prussian bokashi sky over bare paper, tapered brush strokes,
//               flat pigment discs under a sumi key-block line.
//   4 Dusk:   the same woodblock grammar on an indigo dusk field (aizuri
//               blue grading to slate), with the key block printed pale.
// Styles 3 and 4 share every shader branch; they differ only in the HANGA
// palette entry below (field, pigments, sumi ink, seal treatment).
//
// A style is a LOOK, not a layout: all three poses (Constellation / Ascent /
// Blueprint) work under every style, and the state machine, filters, and
// stories drive the same attributes regardless. Two invariants:
//   - Style 0 must render EXACTLY the shipped Galaxy — every art branch is a
//     no-op there (regression-free default).
//   - In art styles, dimness is OPACITY, not brightness: ghosted / unlit /
//     damaged elements fade toward the field color (there is no bloom and no
//     HDR on a paper background). Mark's direction, 2026-07.
//
// This module owns only the shared constants; each scene handle implements
// setArtStyle(style) for its own geometry/material/uniform swaps, and main.ts
// fans one applyArtStyle() out to all of them.

import type { StrandId } from "../data";
import { STRAND_COLORS } from "./palette";

export type ArtStyle = 0 | 1 | 2 | 3 | 4;

// User-facing option labels. Style 0's label is "Let it Ride" (round 11): with
// per-pose environments, style 0 no longer reads as "galaxy" — it lets each
// formation wear its own designed look, while Ringers/Fidenza are the true
// overrides. The INTERNAL identifier / slug stays `galaxy` (ART_STYLE_SLUGS).
export const ART_STYLE_NAMES: readonly string[] = ["Let it Ride", "Ringers", "Fidenza", "Washi", "Dusk"];

// URL param values (?style=ringers) — index-aligned with the names.
export const ART_STYLE_SLUGS: readonly string[] = ["galaxy", "ringers", "fidenza", "washi", "dusk"];

// ---------------------------------------------------------------------------
// Ringers (Cherniak) — cream board, primary pegs, black ink.
export const RINGERS = {
  bg: 0xf0ece0, // paste-white board
  ink: 0x1a1712, // bold outline + board text
  /** Peg fill by strand; edgeless standards are near-white pegs. */
  peg: {
    number: 0xe2a72e, // yellow
    algebra: 0x2b5ba8, // blue
    geometry: 0x2e7d52, // green
    data: 0xc33f2e, // red
  } as Record<string, number>,
  pegWhite: 0xfaf8f2, // deg === 0
} as const;

// ---------------------------------------------------------------------------
// Fidenza (Hobbs) — the provided artwork's colorway.
export const FIDENZA = {
  bg: 0x43a08b, // teal field
  /** Ribbon palette, cycled by per-edge hash. */
  palette: [0x1e3a6e, 0x2e241c, 0xe8e0cd, 0xe5b93c, 0xc94f43, 0xbfe3d4],
  /** Cube fill by strand. */
  node: {
    number: 0xe5b93c, // yellow
    algebra: 0x1e3a6e, // navy
    geometry: 0xbfe3d4, // mint
    data: 0xc94f43, // red
  } as Record<string, number>,
  ink: 0x14332c, // deep teal-ink for board text
} as const;

// ---------------------------------------------------------------------------
// Hanga (Japanese woodblock): one palette per field, after Wada Sanzo's
// Dictionary of Color Combinations, Oda Kazuma's dusk prints, and Utagawa
// Hiroshige's bokashi skies. Every hex is copied verbatim from the approved
// acceptance previews (scripts/hanga-previews.mjs). Each strand keeps its hue
// family (number gold, algebra violet, geometry blue-green, data
// vermilion-rose), so nothing a reader has learned changes.
export interface HangaPalette {
  /** Mid field color: the WCAG reference and the damage wash target. */
  bg: number;
  /** Top of the sky (the deep bokashi band). */
  top: number;
  /** Bottom of the sheet. */
  bottom: number;
  /** The faint warm band near the horizon. */
  warm: number;
  /** Strand pigments, keyed by strand. */
  pigment: Record<StrandId, number>;
  /** Darker ink of each pigment's own hue (disc bokashi, top of the disc). */
  deep: Record<StrandId, number>;
  /** Brighter wash of each pigment's own hue (disc bokashi, bottom of the disc). */
  light: Record<StrandId, number>;
  /** How far the disc top mixes toward `deep`, and the disc bottom toward `light`. */
  deepMix: number;
  lightMix: number;
  /** Key-block ink: outlines, related dabs, the unlit underdrawing, labels. */
  sumi: number;
  /** Vermilion seal (the focus ring). */
  seal: number;
  /** Pale underlay printed beneath the seal (0 alpha on washi). */
  sealUnder: number;
  sealUnderAlpha: number;
  /** Bare-disc fill for an edgeless standard, and its fill opacity. */
  paper: number;
  paperAlpha: number;
}

export const HANGA: { washi: HangaPalette; dusk: HangaPalette } = {
  washi: {
    bg: 0xefe6d2, // bare washi; the bokashi band has faded to paper by 30% height
    top: 0x1f3a5f, // Prussian blue
    bottom: 0xefe6d2,
    warm: 0xe2895a, // faint persimmon horizon
    pigment: {
      number: 0xad7408, // yamabuki gold, printed deep enough to carry on paper
      algebra: 0x8250a6, // murasaki
      geometry: 0x16808a, // asagi / bero-ai blue-green
      data: 0xc8364a, // beni vermilion-rose
    },
    deep: { number: 0x7a4a00, algebra: 0x4e2a78, geometry: 0x0b4f63, data: 0x8e1830 },
    light: { number: 0xf0b628, algebra: 0xb98ad8, geometry: 0x56b8b4, data: 0xee7a76 },
    deepMix: 0.3,
    lightMix: 0.55,
    sumi: 0x1c1a17,
    seal: 0xc8372d,
    sealUnder: 0xefe6d2,
    sealUnderAlpha: 0,
    paper: 0xf6efdf,
    paperAlpha: 1,
  },
  dusk: {
    bg: 0x2e4262, // the field at half height: mix(top, bottom, 0.5)
    top: 0x12233f, // aizuri
    bottom: 0x4a6185, // pale slate
    warm: 0xe8a46a, // thin warm glow low on the sheet
    pigment: {
      number: 0xeab64a, // yamabuki gold
      algebra: 0xb99ae2, // fuji violet
      geometry: 0x5cc2b6, // asagi blue-green
      data: 0xf07c72, // beni vermilion-rose
    },
    deep: { number: 0xb8790e, algebra: 0x7c5cb8, geometry: 0x2a8f8c, data: 0xc8473f },
    light: { number: 0xfbe3a0, algebra: 0xe2d2f6, geometry: 0xb4ece2, data: 0xfbc0b0 },
    deepMix: 0.22,
    lightMix: 0.4,
    sumi: 0xece3cf, // the key block prints in pale paper tone at dusk
    seal: 0xc8372d,
    sealUnder: 0xece3cf, // pale paper underlay so the vermilion reads on aizuri
    sealUnderAlpha: 0.5,
    paper: 0xe6dcc6,
    paperAlpha: 0.22, // a faint hollow disc
  },
};

/**
 * Hanga discs print larger than the Galaxy orbs (the preview's disc sizes at the
 * home framing). Applied in the node shader on top of the rest radius, and in
 * the edge shader so each stroke still begins at the disc's rim.
 */
export const HANGA_DISC_SCALE = 1.4;

/**
 * Damage on a dark field (Dusk). A wash toward the dark field plus an opacity
 * loss barely moves a light pigment, so on Dusk a damaged mark also drains of
 * colour and loses luminance, and its key-block line dims toward the field.
 * Washi keeps the plain wash (a pale stain on paper already reads). `RAMP` is
 * the display damage at which the darkening is full; the story display floor
 * (0.35) already lands most of the way there.
 */
export const HANGA_DUSK_DAMAGE = {
  RAMP: 0.45,
  /** Desaturation at full ramp (0 keeps the pigment, 1 is grey). */
  DESAT: 0.55,
  /** LINEAR luminance multiplier at full ramp (about 0.6 in sRGB). */
  DARKEN: 0.28,
  /** How far the disc then washes toward the field, times the damage. */
  WASH: 0.35,
  /** Opacity the disc sheds, times the damage (less than Washi: a dark disc, not a hole). */
  ALPHA: 0.2,
  /** How far the key-block line dims toward the field at full ramp. */
  LINE_DIM: 0.7,
} as const;

/** True for the two woodblock styles (3 Washi, 4 Dusk). */
export function isHanga(style: number): boolean {
  return style === 3 || style === 4;
}

/** The Hanga palette for a style (Dusk for 4, Washi otherwise). */
export function hangaPalette(style: number): HangaPalette {
  return style === 4 ? HANGA.dusk : HANGA.washi;
}

// In-app credit lines (shown while an art style is active). Linked to the
// curated.xyz editorials that grounded the artist-true rules.
export const ART_CREDITS: readonly { html: string }[] = [
  { html: "" }, // Galaxy: no credit line
  {
    html:
      'After Dmitri Cherniak’s <a href="https://www.curated.xyz/editorial/collecting-ringers" target="_blank" rel="noopener">Ringers</a>',
  },
  {
    html:
      'After <a href="https://www.tylerxhobbs.com/works" target="_blank" rel="noopener">Tyler Hobbs</a>’s <a href="https://www.curated.xyz/editorial/collecting-fidenza" target="_blank" rel="noopener">Fidenza</a>',
  },
  { html: "After Wada Sanzo, Oda Kazuma, and Utagawa Hiroshige" },
  { html: "After Wada Sanzo, Oda Kazuma, and Utagawa Hiroshige" },
];

/**
 * The strand SWATCH colour for the active art style — the single source of truth
 * the legend reads so its dots track the scene on every skin swap: Galaxy's
 * validated palette, Ringers' peg colorway, Fidenza's node colorway, or the
 * Hanga field's pigments. (The
 * scene's own node materials bake these same colours per style; the legend just
 * mirrors them rather than owning a parallel copy.)
 */
export function strandSwatch(strand: StrandId, style: ArtStyle): number {
  if (style === 1) return RINGERS.peg[strand] ?? RINGERS.pegWhite;
  if (style === 2) return FIDENZA.node[strand] ?? FIDENZA.bg;
  if (isHanga(style)) return hangaPalette(style).pigment[strand];
  return STRAND_COLORS[strand];
}

/** Deterministic per-id hash in [0,1) — matches the preview script's grammar. */
export function artHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}
