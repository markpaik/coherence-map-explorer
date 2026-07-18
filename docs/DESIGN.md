# Design spec: Coherence Map Explorer

The scene is a deep-space constellation where school mathematics assembles
itself left to right: Kindergarten counting at one end, high-school modeling at
the other. Everything below is normative for implementation; deviations get
discussed first.

## The three poses and the unravel

The map has three truths and refuses to average them. **Pose A, the
Constellation**, is the explorable artwork: the band-relaxed galaxy of strand
rivers, orbitable from any angle (generative-art lineage: one seeded
algorithm, restrained palette, flow over grid — Hobbs/Cherniak/Watkinson).
**Pose B, the Ascent**, is the balance point — structured first, artful in
its breath: x keeps the K–HS timeline at grade-band granularity, and height
is the standard's longest prerequisite chain (a graph invariant, 0 at the
foundations to 30 at the summit). Within its band each standard aligns
ABOVE its prerequisites (weighted alignment sweeps, a small hashed fan so
sibling stacks stay organic), so every prerequisite edge points upward and
runs near-vertical: the climb reads at a glance. **Pose C, the Blueprint**, honors the
source document: a flat circuit-board plane echoing Achieve the Core's
original map — 13 grade/course columns left to right (K–8, then Algebra I,
Geometry, Algebra II, Advanced), standards stacked in crossing-minimized rows
(4 barycenter sweeps), edgeless standards in a dim side gutter inside their
column, and one aligned grade-label rail beneath all columns. The camera
frames it front-on and the idle sway quiets to ~a fifth of its amplitude so
the plane breathes without leaning.

The transition between poses — **the unravel** — is a signature moment, not a
camera cut: entering the Ascent, nodes settle foundations-first (35ms stagger
per depth layer, 650ms per-node smoothstep, ~1.7s total) so the viewer watches
mathematics assemble into a load-bearing structure; entering the Blueprint,
columns assemble in reading order (35ms per column); returning to the galaxy,
the summit releases first. Morphs start from live positions, so re-targeting
mid-flight stays continuous. Stories auto-pose per scene (the trace-back
story runs in the Blueprint); a three-way toggle (bottom-right) offers every
pose to everyone. Reduced motion cuts instantly.

The high-school arc in both poses is organized by CCSS Appendix A's
traditional pathway: Algebra I, Geometry, Algebra II sub-bands (23 standards
formally revisited in Algebra II carry both memberships) with the 16 (+)
fourth-course standards as an Advanced shelf. Etches: K–8 numerals plus
ALGEBRA I · GEOMETRY · ALGEBRA II · ADVANCED, standing at pose-appropriate
markers.

## Surfaces and ink

| Token | Value | Use |
|---|---|---|
| `--bg` | `#050510` | page + WebGL clear color (near-black, blue cast) |
| `--surface` | `#101024` at 88% opacity, `backdrop-filter: blur(14px)` | panel, search, chips |
| `--ink` | `#eceaf6` | primary text |
| `--ink-2` | `#9c98b8` | secondary text |
| `--ink-3` | `#5d5a78` | muted / hint text |
| `--line` | `#2a2848` | hairlines, panel borders |

## Strand palette (validated: CVD all-pairs ΔE 9.9 deutan, dark band, ≥3:1)

| Strand | Hex | Covers (domain ordinals) |
|---|---|---|
| Number | `#c08a1e` gold | CC, NBT, NF, RP, NS, N-RN, N-Q, N-CN |
| Algebra & Functions | `#8b5cf6` violet | OA, EE, F, A-SSE, A-APR, A-CED, A-REI, F-IF, F-BF, F-LE, F-TF |
| Geometry | `#1c9fbb` cyan | G, G-CO, G-SRT, G-C, G-GPE, G-GMD, G-MG |
| Measurement, Data & Statistics | `#de5a85` rose | MD, SP, S-ID, S-IC, S-CP, S-MD |

These exact values are the base (rest) node colors and the flat UI chip/badge
colors. Identity is never color-alone: strands also occupy distinct spatial
home angles, and labels/legend name them.

## Node states (drives `aEmphasis` + HDR color multiplier)

| State | Color math | Size |
|---|---|---|
| rest | base strand color | r = 1.6 + 0.35·√deg (deg = total degree) |
| dimmed (something else focused) | lerp(base, `#0a0a18`, 0.82) | ×0.8 |
| hover | base ×1.6 (HDR) | ×1.25, 150ms ease-out |
| focused | base ×2.6 (HDR) | ×1.5 |
| chain (ancestor/descendant of focus) | base ×1.9 (HDR) | ×1.15 |
| related-to-focus | base ×1.25 | ×1.0 |

Sphere shading: every node is an icosphere (detail 2) shaded in the patched
basic material with limb darkening (`pow(1 − N·V, 2.2)`, ×0.62 at the
silhouette) plus a soft key light from upper-left (0.88–1.0). Each orb reads
as a self-luminous sphere — bright core, dark rim — so a node in front
separates visibly from nodes behind it instead of flattening into one plane.
The HDR core still crosses the bloom threshold; the rim falls below it, so
halos hug centers.

Bloom: pmndrs `postprocessing` BloomEffect, `luminanceThreshold: 1.0`,
intensity ≈ 0.9, radius ≈ 0.7, mipmapBlur on. Only HDR (>1) colors glow.
Idle scene therefore has gentle glow only from a subtle ×1.05–1.15 shimmer
oscillation (per-node phase offset, ~6s period) so the constellation feels
alive without searing.

## Edges

| Kind | Rest | In focus chain | Dimmed |
|---|---|---|---|
| prerequisite (directed) | mix of endpoint strand colors at 0.35 alpha, 1.2px screen width | ×2.2 HDR, 2.5px, particle pulses flowing prereq→dependent, ~0.5 chord/s | 0.06 alpha |
| related (undirected) | 0.18 alpha, dash pattern (in-shader `fract(t·14)` gaps), 1px | 0.9 alpha dashed, slow shimmer, no directional flow | 0.04 alpha |

Quadratic bezier arcs (control points baked in `graph-core.json`), rendered as
one instanced ribbon mesh, camera-facing, screen-space width.

### Fidelity to the original renderer (2026-07 third-line QA)

The original site's own drawing code was deconstructed and its algorithm
ported and diffed against ours for all 480 standards: our reading of the data
(from is the prerequisite of to; builds-on is incoming, leads-to outgoing;
related pairs undirected and dashed; ELA excluded; families roll up their
children's connections with family-internal edges excluded) reproduces the
original's rendered connections exactly for 386 of 480 standards, and every
live-DOM spot check matched. The 94 differences are three CONSCIOUS choices,
never a missing or fabricated edge:

1. HS families (6 standards, e.g. F-IF.C.7, A-REI.B.4): the original skips
   its own roll-up for high school and renders these as isolated dead-end
   cards. We roll them up, so we show real connections the original hides.
2. Neighbour grain (52): where a connection lands on a lettered sub-standard,
   the original collapses the neighbour card to its parent family; we show
   the exact sub-standard the edge touches. Identical at the family level.
3. Sub-standard focus (36): the original has no detail view for a non-HS
   sub-standard at all; ours makes every node focusable. Purely additive.

Faint vertical structure, not boxes: each band gets (a) a 1px hairline ring or
soft fog plane at its x-center is too heavy; use instead (b) a floor: grade
label rendered as large, very dim SDF text (`#2a2848`, ~40% alpha) floating
below the band cluster (y ≈ −95), reading K · 1 · 2 … 8 · HS like etched
constellation names. HS sub-columns get no labels (the strand colors carry it).

## Starfield

800–1200 tiny points (0.5–1.2px), colors `#20204a`→`#3a3870`, on a large
sphere (r ≈ 900) with 0.15 parallax factor; twinkle = slow per-point alpha
noise, disabled with reduced-motion.

## Typography

| Role | Font | Notes |
|---|---|---|
| Display (title, grade etches, standard codes) | Space Grotesk (OFL, self-hosted woff2 subset: latin, wghts 400/600) | tracking +0.02em for codes |
| Body / UI | system-ui stack | panel text, buttons |
| Standard text in panel | system-ui, 15px/1.55 | KaTeX for math |

## Layout of the frame

- Landing: title block top-left ("Coherence Map Explorer" small caps ink-2;
  headline "Every idea in school mathematics, and how they hold together."
  Space Grotesk 600, clamp(22px, 3.2vw, 34px); stat line ink-2: "480 standards
  · 899 connections · K–High School"). Search bar (⌘K / "/" hint) centered
  bottom third on first load; docks top-center after first focus. "Show me
  around" ghost button beside search.
- Legend: bottom-left, four strand chips (dot + name), click = toggle strand;
  grade chips K…HS bottom-center; "Major work" + "Widely applicable
  prerequisites" toggles bottom-right. All in one 40px-tall glass rail;
  collapses to a single "Filters" button < 720px.
- Detail panel: right side, 400px (100% bottom sheet ≤ 720px, snap points 40%/
  90%), glass surface. Order: code (Space Grotesk 600, strand-colored dot) +
  grade·domain breadcrumb → badges row → standard text → Connections
  (three groups: "Builds on" / "Leads to" / "Related", each entry a real
  <button> with code + 6-word title clamp) → "Trace to foundations" primary
  action → Tasks (external links, attribution) → Progression note (collapsed
  <details>) → v2 slot (hidden div#ai-slot). Close = Esc / ×.
- Hover tooltip: small glass chip near cursor: code + first 8 words of the
  standard, 120ms delay in, no delay out.

## Motion

| Move | Spec |
|---|---|
| camera focus flight | camera-controls `setLookAt` smooth-damped, ~1.1s perceived; `fitToSphere` on focus neighborhood with 1.35 padding |
| cascade reveal | ancestors ignite in grade order stepping backward, 80ms stagger per grade layer; descendants forward at half brightness after 200ms |
| trace-to-foundations | same cascade but full ancestor closure; camera pulls back to frame it (fitToSphere on closure bounding sphere) |
| panel | 280ms translateX cubic-bezier(.2,.8,.2,1) |
| idle drift | slow orbit, one revolution ≈ 240s; pauses on any interaction, resumes after 20s idle |
| reduced motion | camera cuts (≤150ms), no cascade stagger (all at once), no particles, no twinkle, no drift |

## Sound

None. (Considered; a fun v2 toggle, never default-on.)

## Accessibility commitments

Canvas `aria-hidden`; the detail panel + search are the accessible mirror
(every connection a real button, panel is a labeled region, focus trapped
sanely, `aria-live="polite"` announces "Focused 4.NF.B.3, builds on 3 standards,
leads to 5"). `/` focuses search; arrows navigate results; Enter focuses
standard; Esc closes panel then clears focus. No-WebGL fallback: DOM list of
all standards grouped by grade with the same panel. Every interactive target
≥ 44px on touch.

## Wow checklist (the bar for "extravagant, elegant")

1. First paint: constellation fades in from black over 900ms while stars
   twinkle in; feels like an observatory powering up.
2. The four strands read as rivers of color the moment the scene appears.
3. Click F-IF.A.1 → the lineage cascades back to Kindergarten in under 2s and
   it is *legible*, not fireworks: you can follow every hop.
4. The whole thing holds 60fps on a 2020 laptop and doesn't melt a phone.
5. A teacher can go from load → their standard → its prerequisites in under
   15 seconds without instructions.

## Art styles

The scene ships three render skins, switchable live from the bottom-right
toggle and deep-linkable by URL. A style is a LOOK, not a layout: all three
poses (Constellation, Ascent, Blueprint) work under every style, and the state
machine, filters, and stories drive the same attributes no matter which skin is
active. Switching is instant, since a style is a look and not a place, so
nothing needs a transition to interrupt. Reference stills live in
docs/previews/.

- **Galaxy** (style 0, the default), the shipped dark look: bloom, additive
  light, HDR emphasis, starfield, nebula. It is the baseline and stays
  untouched. Every art branch is a no-op at style 0, so Galaxy renders exactly
  as it did before the art-style work.
- **Ringers** (style 1), after Dmitri Cherniak: a cream printed board
  (#f0ece0) with board ink (#1a1712). Standards are bold-outlined 3D pegs in
  Mark's colorway (white, red, yellow, blue, green; white marks an edgeless
  standard); the outline is an inverted-hull ink shell that tracks every
  emphasis state. Edges are taut, pure-color strings that leave a peg's outer
  edge and land on the destination's edge, string-art style.
- **Fidenza** (style 2), after Tyler Hobbs: a teal field (#43a08b) with the
  provided colorway (navy, brown, cream, yellow, red, mint). Standards are
  cubes (each with a small hashed twist) and edges are thick FLAT ribbons that
  lie on one world plane. Because the ribbons live on a plane rather than
  facing the camera, they read at full width head-on and foreshorten as you
  orbit, so the field is anamorphic: the flat composition resolves from the
  front and skews to thin bands from the side. Ribbons carry striped end caps.

Refinements queued for a later round, each grounded in the editorials:
Ringers TRACE as one continuous string wrapping each peg back to the
foundations (after Cherniak's single looped string), bullseye pegs for
high-degree standards, and collision-aware Fidenza ribbon routing (Hobbs's
non-overlap signature; today's ribbons still cross).

### Dimness is opacity, not brightness

The art styles have no bloom and no HDR, because paper and painted fields do
not glow. So dimness is OPACITY. Ghosted, unlit, or damaged elements fade
toward the field color (a layered-wash translucency) instead of darkening,
which is what separates the flat-field skins from Galaxy, where dimness is
brightness. Rest states, the focus chain, filters, and story reveals all
express through alpha under an art style. Mark's direction, 2026-07.

### Marker ink and on-canvas chrome

The grade and course etches re-ink per style so they read as printed labels on
the field, not engraved monuments: Galaxy keeps its faint violet extrusion,
Ringers uses board ink (#1a1712 face, warm grey-brown relief 0x8a8272), Fidenza
uses deep teal-ink (#14332c face, teal relief 0x2a6355). The DOM chrome that
sits directly on the canvas (the title block, the nav hints, the depth-scale
hint, the credit line) re-inks the same way: board ink on Ringers, cream
(#e8e0cd) with a dark shadow on Fidenza. The glass plaques (view and art
toggles, the filter rail) stay dark framed cards on the light fields, which is
the accepted look this round.

### Credits and deep links

While an art style is active a one-line credit appears under the toggle,
naming the artist and linking the curated.xyz editorial the style is after,
because the styles are homages and should say so in the room where they hang:

- Ringers (Dmitri Cherniak): https://www.curated.xyz/editorial/collecting-ringers
- Fidenza (Tyler Hobbs): https://www.curated.xyz/editorial/collecting-fidenza

`?style=ringers` or `?style=fidenza` deep-links a skin on load (session only,
not persisted); `?style=galaxy` or no param loads the default. Galaxy carries
no credit line.

### Distilled artist principles (stay true to each)

**Fidenza** (from the editorial): flow-field foundation; the signature is
NON-OVERLAPPING curved rectangles with natural spacing (the queued
collision-aware routing target; today's ribbons still cross);
mixed scale tiers with tuned probabilities (Jumbo common, Small rare),
so map edge weight to width tiers the same way; an optional outline trait; a
composition margin (the "Have Margin" trait) for a clean edge; segmented
striped end caps (Mark's ask: rebuilt in the node structure, cubes trailing
striped segments into clean ribbons). Palette: Mark's teal, navy, brown, cream,
yellow, red, mint colorway.

**Ringers** (from the editorial): the signature is ONE continuous looped string
wrapping pegs, so per-edge strings are the departure and TRACE is the
true-to-artist return (a standard's full prerequisite chain as a single
continuous string wrapping each peg en route to the foundations). Bullseye
(concentric) pegs on high-degree standards; the paste/cream board (the
community-favored beige); bold black peg outlines; taut tangent strings leaving
the outer edge. Mark's colorway: pegs white, red, yellow, blue, green, with
white for an edgeless standard.
