# Design spec: Coherence Map Explorer

The scene is a deep-space constellation where school mathematics assembles
itself left to right: Kindergarten counting at one end, high-school modeling at
the other. Everything below is normative for implementation; deviations get
discussed first.

## The two poses and the unravel

The map has two truths and refuses to average them. **Pose A, the
Constellation**, is the explorable artwork: the band-relaxed galaxy of strand
rivers, orbitable from any angle (generative-art lineage: one seeded
algorithm, restrained palette, flow over grid — Hobbs/Cherniak/Watkinson).
**Pose B, the Ascent**, is the canonical layered drawing of the partial order
itself: x keeps the K–HS timeline, and height is the standard's longest
prerequisite chain (a graph invariant, 0 at the foundations to 30 at the
summit), so every standard rests physically above everything it builds on and
every prerequisite edge points upward.

The transition between them — **the unravel** — is a signature moment, not a
camera cut: entering the Ascent, nodes settle foundations-first (35ms stagger
per depth layer, 650ms per-node smoothstep, ~1.7s total) so the viewer watches
mathematics assemble into a load-bearing structure; returning, the summit
releases first and the structure gathers back into the galaxy. Stories
auto-unravel; a Constellation/Ascent toggle (bottom-right) offers both poses
to everyone. Reduced motion cuts instantly.

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

## Grade bands

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
