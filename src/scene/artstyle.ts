// Art styles — the scene's three render skins:
//   0 Galaxy  — the shipped dark look (bloom, additive light, HDR emphasis).
//   1 Ringers — after Dmitri Cherniak: cream board, bold-outlined pegs in
//               white/red/yellow/blue/green, taut pure-color strings.
//   2 Fidenza — after Tyler Hobbs: teal field, cube nodes, thick flat ribbons
//               in the navy/brown/cream/yellow/red/mint colorway with striped
//               end caps.
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

export type ArtStyle = 0 | 1 | 2;

// User-facing option labels. Style 0's label is "Let it Ride" (round 11): with
// per-pose environments, style 0 no longer reads as "galaxy" — it lets each
// formation wear its own designed look, while Ringers/Fidenza are the true
// overrides. The INTERNAL identifier / slug stays `galaxy` (ART_STYLE_SLUGS).
export const ART_STYLE_NAMES: readonly string[] = ["Let it Ride", "Ringers", "Fidenza"];

// URL param values (?style=ringers) — index-aligned with the names.
export const ART_STYLE_SLUGS: readonly string[] = ["galaxy", "ringers", "fidenza"];

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
];

/** Deterministic per-id hash in [0,1) — matches the preview script's grammar. */
export function artHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}
