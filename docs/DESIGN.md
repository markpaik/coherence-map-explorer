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
story runs in the Blueprint); the toggle (bottom-right) offers the live poses.
Reduced motion cuts instantly.

**Status (2026-07-24): user-facing options pared back.** The switcher now
offers only Constellation and Ascent. The Blueprint (pose 2) and Transit
(pose 3) segments, the "Style overrides" art-style switcher, and those two
choices in the story-HUD Formation pin are all ON HOLD (removed from the UI,
"for now"). The poses/shaders/stories underneath stay intact and dormant:
poses 2/3 still live in the driver, and any story authored into them still
plays. Style is pinned to 0 (the galaxy) — the `?style=` deep-link is disabled
too. And the Ascent reverted to the dark constellation baseline with its
elevation isolines (see the Environments note below); the Sierra dawn is held
off, not deleted. Restoring any of these is re-adding a segment / re-mounting a
control / flipping a single flag.

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
  grade·domain breadcrumb → badges row → standard text → "Trace the full
  journey" primary action (zooms out to the closure) → direction chip (wide
  frame only) → Connections (three groups: "Builds on" / "Leads to" / "Related",
  each entry a real <button> with code + 6-word title clamp) → Foundations +
  Onward closures (wide frame only) → Tasks (external links, attribution) →
  Progression note (collapsed <details>) → v2 slot (hidden div#ai-slot). Close =
  Esc / ×. The button + chip sit ABOVE the connection groups so they stay in
  view on a connection-heavy standard (they used to sit below and dropped under
  the fold). Inherit case (an edgeless sub-standard): the Connections open with a
  note naming the family standard plus a "Family" group (parent first, then
  siblings), and the groups below are the family's inherited connections.
- Hover tooltip: small glass chip near cursor: code + first 8 words of the
  standard, 120ms delay in, no delay out. An edgeless sub-standard reads
  "Mapped on <parent code>" with the family's builds-on / leads-to counts, not
  "No mapped connections".

## Camera composition (one primitive, no blanket nudges)

Every framing — home, focus, journey, a story scene — goes through
`rig.frameSubject(subject, { context, contextPullback, minSubjectFrac,
snapToAxis })` (`src/scene/frame.ts` + `src/scene/camera.ts`):

- **The usable rect** is the viewport minus the LIVE chrome, measured from the
  DOM at every fit: a modest top strip for the title block (its own bottom,
  capped at 11% of the viewport ≈ 100px at 907px tall — the block spans only the
  left half, so reserving all 260px of it would push every framing down for
  nothing), the bottom chrome band (filter rail / formation switcher / story
  scrubber, whichever is visible — an `opacity: 0` rail during a story reserves
  nothing), and an OPEN right-side detail panel at its real width. Composition
  happens in that rect, not in the raw viewport.
- **The subject** (a story's spine, the one-hop focus neighbourhood, the pose
  cloud at home) must land fully inside the rect with a 4.5% margin. Fits are
  BOXES, never bounding spheres: these layouts are flat slabs (grades K–2 in the
  Ascent measure 216 × 91 × 244), and a sphere hands the on-screen size to the
  depth axis the reader cannot see.
- **The context** — the scene's lit set, or a focus's full lit closure — is what
  gets CENTRED, unioned with the subject so a camera that leads half a step ahead
  of its lit frontier splits the difference instead of shoving one of them to an
  edge. The fit retreats to take the context in until either the subject would
  drop below 1/`contextPullback` of the frame it fills alone or below
  `minSubjectFrac` of the frame's short axis; past that the context bleeds, which
  is the drama.
- **Occluders bias, they never evacuate.** The bottom-left story card earns a
  rightward nudge of ¼ its width (≤120px and ≤6% of the viewport); the subject
  then spans the frame with the card over its lower-left corner. Pushing the
  subject entirely clear of the card is what used to empty the top-left half of
  the frame.
- Deleted with this: `setFrameShiftPx` / `setFrameLiftPx` / `setBottomInsetPx` /
  the per-flight `panelOffsetPx`. They were blanket screen-space offsets applied
  after the fit with nothing checking where the content landed; they pushed in
  opposite directions (stories right, focus left) and the lift carried the wrong
  sign, so it pushed content DOWN into the chrome it meant to clear.

## Interaction grammar (light everything, then dive in)

A click shows how expansive a standard's reach is, then zooms into it — the whole
expanse and its local neighbourhood in one interaction. Lighting is ALWAYS the
full both-direction closure; the two "framings" are a CAMERA concern.

- **A fresh click** (from idle, or from the wide frame) lights the full ancestor
  and descendant closures with the grade-stepped cascade immediately. The camera
  does not fly at once: it HOLDS the current (typically wide) view for a beat so
  the expanse registers (~750ms, once the ancestor waves have fired), then dives
  IN to the one-hop frame (the standard + family + builds-on / leads-to, related
  capped at 1.6x) at a moderate, legible speed. Constants `DIVE_DELAY_MS` /
  `DIVE_SMOOTH_TIME` in `machine.ts`.
- **A hop** — focusing a different standard while already zoomed on one (map
  click, panel connection, search pick) — flies straight to the new standard's
  one-hop frame: a lateral pan at comparable zoom, no wide excursion, no dive
  delay. The full-closure cascade still runs for the new standard; only the
  camera path changes. The fresh-vs-hop choice is the pure `decideFocusCamera`
  predicate (prior focus presence + current framing).
- **The wide frame** is a pure camera zoom-out over the already-lit closure,
  reached by re-clicking the focused node or the panel's "Trace the full journey"
  button. It frames the closure's actual Box3 extents as the SUBJECT, so an
  elongated grade-band closure fills the frame tightly instead of being pushed far
  back by its diagonal. The one-hop dive frames the neighbourhood with that same
  closure as its composition CONTEXT, so a click on a foundational standard no
  longer parks the camera inside the cloud it just lit. Re-clicking
  the focused node toggles the camera between the one-hop and wide frames (no
  cascade replay, no hash change). Escape, the panel's ×, or a background click
  clear the focus entirely.
- **Focus ring.** While an exploration focus is active (both frames), the focused
  standard wears a thin breathing camera-facing ring in its strand's high-
  luminance tint (the beacon-ring grammar, own single-instance channel) so the
  clicked orb stays discernible among the lit closure. It sits just outside the
  FOCUS-scaled orb and NEVER appears during story playback or the story player's
  silent focus (there, rings mean damage — the grammars must not collide).
- **Focus overrides the filter.** With a grade/strand filter narrowing the
  resting view, an active focus temporarily un-ghosts exactly its lit set (and the
  edges among it) so chain ribbons never flow to invisible standards. The direction
  chip narrows the override with the lighting (Foundations / Onward). Filters stay
  the single writer of visibility (`filters.setFocusOverride`); clearing the focus
  returns the filter's own view exactly. Off during the story's silent focus.
- **Direction chip (wide frame).** A three-way segmented radiogroup in the panel:
  Foundations (ancestors), Both (default), Onward (descendants). Both frames the
  whole closure; Foundations / Onward frame that half AND filter the lighting to
  it (an instant re-light, no cascade replay). Keyboard-operable with a visible
  focus ring; direction changes announce on the aria-live channel.
- **Reduced motion / deep link.** An instant cut straight to the one-hop frame,
  everything lit, no expanse-beat and no dive.
- **Consistency (the inheritance rule).** Every one of the 480 standards gets a
  meaningful neighbourhood. A family parent rolls its sub-standards' connections
  up; an edgeless sub-standard inherits its family's connections
  (`resolveConnections`, the one resolver the panel and Browse share). Only the
  two genuinely isolated solo standards say "No mapped connections." See
  `docs/audits/edge-provenance.md`.
- **Not hash-encoded.** The URL carries only the focused standard (`#/s/<CODE>`).
  The camera framing and chip direction are session state, never written to the
  hash, so a shared link always opens at the fresh-click behaviour.
- **Bottom safe-area inset.** Every fit (home, focus, journey, pose switch) lifts
  the framed content UP by the fixed bottom chrome height (filter rail +
  formation switcher), measured from the DOM at resize so it tracks the ≤720px
  collapse to a pill. The scene floor and its grade / course etch markers compose
  ABOVE the buttons instead of behind them (`rig.setBottomInsetPx`, applied
  through the focal-offset lift that already handles the story card and panel
  shift).

## Motion

| Move | Spec |
|---|---|
| camera focus flight | `rig.frameSubject` (fit + compose into the usable rect) smooth-damped; base damping ~0.25s, the dive raises it to `DIVE_SMOOTH_TIME` so the wide→close traverse reads |
| fresh-click choreography | full closure cascades immediately; camera holds the wide view ~`DIVE_DELAY_MS` (750ms), then dives to the one-hop frame at moderate speed |
| full-closure cascade | ancestors ignite in grade order stepping backward, 80ms stagger per grade layer; descendants forward after 200ms |
| hop (new standard while zoomed) | lateral pan straight to the new one-hop frame, no wide excursion, no dive delay; the cascade still runs |
| wide-frame zoom / direction change / toggle | pure camera move over the already-lit closure; a direction subset re-lights instantly, no cascade replay |
| panel | 280ms translateX cubic-bezier(.2,.8,.2,1) |
| idle drift | slow orbit, one revolution ≈ 240s; pauses on any interaction, resumes after 20s idle |
| reduced motion | camera cuts (≤150ms), no cascade stagger (all at once), no particles, no twinkle, no drift |

## The opener (first-visit reverse-explosion)

On a plain first visit the Constellation ASSEMBLES itself, then hands off cleanly
to the ordinary settled pose 0 — after it, drift / focus / pose switches / stories
/ tour behave exactly as always, and the end state is pixel-identical to a skipped
load. All math + timing live in `src/scene/opener.ts` (the ONE tunable block);
`src/scene/pose.ts` plays it on the driver's own buffers; `src/main.ts` gates it.

Choreography (total ≈ 10.7s, a hard 10–11s cap):

| Phase | Spec |
|---|---|
| radial scatter | every node hung far out along its OWN ray from the formation centroid, at `SCATTER_MULT` (6.5–10×) its home radius — the constellation blown up ~8× — so all motion is purely inward-radial (no crossing paths). Deterministic from the clock seed (mulberry32); no `Math.random` |
| float (`FLOAT_MS` 1.6s) | everything hangs out there with a slow per-node wander (twinkle as usual); camera dead still at the home framing (drift suspended while `poseDriver.opening`) |
| accretion (per-node) | each star drifts home over its OWN duration drawn from `CONVERGE_MIN/MAX_MS` (3.5–6.5s) on a gentle ease-in (`easeImplode`, a t·(1−D·t) velocity: imperceptible start, peak ~70%, soft trackable landing). Scattered rates → the field ACCRETES: early neighborhoods settle while stragglers drift in. The wander fades ×(1−progress) as each lands |
| edge crystallization | each ribbon ghosts in on its OWN schedule — `EDGE_DELAY_MS` (0.3s) after its LATER endpoint settles (never before both land), fading over `EDGE_FADE_MS` (1.8s) with a soft two-stage ghost ramp. Per-edge `appearTime` packed in `aColorA.w` (no extra vertex attribute — the program is at the WebGL2 16 floor), evaluated in-shader against the opener clock. The web crystallizes outward from wherever it completes first |
| interrupt | any interaction (pointerdown / keydown / search focus) SNAPS to the settled end state; never locks input. A mid-opener click still lands on the node it hit |

First-visit gating (`shouldPlayOpener`, pure + unit-tested): it is a FIRST-TIME-ONLY
experience. Plays on a plain first visit; SKIPPED (without consuming the flag) for a
deep-link arrival (`#/s/…` / `#/story/…`), `?og`, reduced motion, and the phone
Browse landing (so it never runs unseen beneath the overlay — and a later desktop
visit still gets it); and skipped once the `cme-opener-seen` localStorage flag is
set. Storage unavailable ⇒ fails OPEN (plays). The flag is written only when the
opener actually runs (on completion OR interruption), so no skip path consumes it.

**Replay the opening** — a ghost-pill button beside Stories re-runs the full opener
on demand (independent of the seen-flag). It exits any active focus, resets the
Constellation home framing, and replays from scatter. Hidden in `?og` and while a
story plays (the rail's own rules), covered by the tour backdrop while touring;
keyboard/AT-reachable like its neighbors.

## Stories in any formation

Every scene authors its pose (`camera.pose`), and the story HUD's FORMATION
control can pin the whole story to one formation instead: Authored (default,
regression-free) plus Constellation / Ascent / Blueprint / Transit. A pin takes
effect immediately (the current scene re-poses and reframes) and persists for
the life of the page. Copy law: narration is written in graph language ("stands
on", "chain") so it survives any formation; the rare line that names its home
pose's literal geometry carries a `heldTitle`/`heldBody` variant that shows only
when the active pose differs from the authored one (two of each across all
stories — the counting story's summit pair and the walk-back opener's "board").
Growing that census is a designer decision, and a test pins the count.

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

## Pose grammar (round 10: "strikingly reminiscent of the concept")

Each formation carries its concept's own visual vocabulary, not just its
layout. The acceptance specs are the preview SVGs in docs/previews/
(transit-pose-front/-side, blueprint-pose-sheet), rendered from the shipped
pose data by scripts/pose-grammar-previews.mjs.

- **Constellation** — the shipped galaxy look, untouched. It already IS its
  concept.
- **Ascent** — altitude vocabulary: elevation isolines per prerequisite-depth
  level (y = median pos2 y at that depth, x hugging the massif), every 5th an
  index contour, faint (0.08/0.14) so the dark story baseline holds. Ascent
  window only.
- **Blueprint** — a literal drafted sheet at z=−8 behind the circuit: field +
  exposure washes + drafting grid + double frame + corner registers + title
  block (COHERENCE · PREREQUISITE CIRCUIT … SHEET 3 OF 4 · SCALE NONE · SEED
  1337), per style: Prussian cyanotype (Galaxy) / cream vellum + graphite
  (Ringers) / teal + cream ink (Fidenza). Nodes hand off to drafted rings +
  crosshair ticks (families double ring, K-8 Major Work filled center); Galaxy
  edges flatten to thin white-ink lines with strand kept as a 30% tint,
  related pairs as dashed construction lines.
- **Transit** — metro vocabulary: straight runs with tight rounded knuckles
  (d = min(9, 0.42·segment)), opaque near-constant trunk widths by reach,
  z-decks at +90/+30/−30/−90 (number/algebra/geometry/data) with banked
  elbows at the endpoint z-midpoint, stations as pale discs with wraparound
  strand borders, 38 true interchanges (≥3 cross-strand prereqs at node
  grain) as capsules with one dot per line, families as lozenges with child
  ticks, related pairs as dashed walking transfers. Ringers keeps straight
  strings at pose 3 (its own identity).

Grammar handoffs never overlap: orbs→drafts over pose 1.6–2.4 (peak at the
Blueprint), plain orbs through the 2.4–2.6 interstitial, orbs→stations over
2.6–3.0. The sheet is gone by 2.5. All layers fold per-node story dimming, and
every treatment is a pure function of the eased pose value (RM-safe, no drift).

## Environments (round 11: each formation wears its own world)

**ON HOLD (2026-07-24).** The Ascent's Sierra dawn is held off (`DAWN_HELD` in
`environs.update()`) so the Ascent reverts to the dark constellation baseline —
full starfield/nebula/planets plus the elevation isolines — which reads far
easier. With the dawn at 0 the planets stay full, the stars stay full, and
main.ts never flips `body.env-light` or the vivid enamel for the Ascent; the
isolines appear/disappear with the Ascent morph exactly as they did before the
dawn landed. The studio (Blueprint) and daylight (Transit) environments are
dormant too, since those poses no longer have a switcher entry. The full
`environs.ts` machinery below is kept intact and reversible; the bullets
describe it as designed.

Style 0 gives every formation a designed environment (src/scene/environs.ts,
Galaxy-style only — Ringers/Fidenza fields ARE their environments; stories
suppress all environments back to the dark baseline, which also preserves the
neon night Transit):

- **Constellation** — the shipped galaxy. Untouched.
- **Ascent, "Sierra dawn" (ON HOLD)** — pre-dawn indigo grading to a narrow gold
  horizon band biased toward the summit side; four static mist planes pooling at
  the foundations; stars hold at 0.35 (dawn keeps its stars), planets gone. The
  dawn lives entirely on the 360° shell — ridge planes were removed in round
  12 (they ended and broke on orbit). The STRUCTURE stays bold against the
  sky: in light environments edges flip to normal-blend enamel in the VIVID
  palette (below) at width ×1.25, and orbs pull to deep vivid hues ×1.15.
  Held off for now — the Ascent presents as the dark baseline + isolines.
- **Blueprint, "studio"** — quiet slate shell; the sheet is the show (frame,
  grid, corner registers — the title block was cut in round 12), it has a
  BACK (mirrored bleed-through plate), and the domain blocks LIFT on paper
  planes z ∈ {16,42,68,94,120,146} (gutter 8, sheet at −20) — a real pop-up
  card under orbit, byte-stable front-on.
- **Transit, "concrete daylight"** — clean light concrete shell (#d9d6cf →
  #c4c1ba) with an infinite procedural grain composited as a light overlay
  (shader value-noise, no tiling); bloom off; edges render in the VIVID
  street palette. VIVID palette (light environments only, index-aligned with
  the strands): number #f2a20d taxi gold · algebra #6f4dff electric violet ·
  geometry #00b3a4 subway teal · data #ff3d6e hot rose. Stations' borders and
  dots follow it; stations stay a touch brighter than lines (signage-true).

Environment windows are ENDPOINT-GATED (a layer wakes only if its home pose is
the morph's origin or target — no sheet flash on 0/1→3). On light environments
`body.env-light` re-inks the chrome (title, captions, provline, tag aside via
--tag-ink) dark slate, and the grade/course etches lerp to dark warm ink.

FOCUS GRAMMAR: the Blueprint rests at 50% white-ink strand tint; focus
re-saturates the connected web to full strand color ×1.6 width while the rest
fades to faint ink (color is the highlighter). The Transit focus ghosts the
unconnected city toward the live background (near-black at night, concrete by
day) at ~0.12 while the chain holds full saturation ×1.3 — this is also the
fix for the "shimmer": the washout WAS the flicker (z-fighting was disproven;
edge ribbons never write depth).

Labels (ON HOLD with the switcher): the styles tab read "Style overrides";
style 0 is "Let it Ride" (slug `galaxy` unchanged) — override nothing, let each
formation do its thing.

FOCUS EXIT (round 12): every exit path — panel X, Esc, and a genuine click on
empty canvas (6px click-vs-drag threshold, inactive during stories/tour) —
runs one unified exitFocus: clear focus, then fly the camera to the current
pose's home framing (instant under reduced motion). Panel typography rides one
scale: title 22 · standard text 15 · body/cards/links/worked examples 13 ·
metadata 11.5 · section caps 11.

## Art styles

**ON HOLD (2026-07-24).** The "Style overrides" switcher and the `?style=`
deep-link are removed from the UI for now, so style is pinned to 0 (the galaxy).
The two skins below (Ringers / Fidenza) and the whole `applyArtStyle` fan-out
are kept intact and dormant — re-mount `createStyleToggle` and the boot deep-
link to bring them back. Everything below describes the skins as designed.

The scene ships three render skins, switchable live from the bottom-right
toggle and deep-linkable by URL. A style is a LOOK, not a layout: all four
poses (Constellation, Ascent, Blueprint, Transit) work under every style, and
the state machine, filters, and stories drive the same attributes no matter
which skin is active. Switching is instant, since a style is a look and not a place, so
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
