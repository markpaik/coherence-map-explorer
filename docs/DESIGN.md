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
plays. **Update (2026-10-03):** a Style control is back with three choices,
Galaxy / Washi / Dusk (the two Hanga skins below). Ringers and Fidenza stay
dormant with no entry point. And the Ascent reverted to the dark constellation baseline with its
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
| On-canvas controls | system-ui | ONE scale, tokens in `:root`: `--fs-btn` 14px (text buttons: Show me around, Back/Next/Exit, Trace the full journey, the Filters pill), `--fs-chip` 12px (every chip and segmented control: grade/strand/major-work chips, Constellation↔Ascent, art tabs, Foundations/Both/Onward, the story HUD's formation segments, the lose-a-year year chips), `--fs-chip-touch` 13px (the ≤720px bump, chips and segments alike), `--fs-label` 10px (uppercase group label in `--display` 600 / .06em: GRADES, STRANDS, FORMATION), `--fs-caption` 12px (view caption, transit key). Panel copy, story-card copy, and Browse keep their own reading scales. |

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
`rig.frameSubject(subject, { context, contextPullback, snapToAxis })`
(`src/scene/frame.ts` + `src/scene/camera.ts`):

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
- **The context** (stories: the scene's lit set) is what gets CENTRED, unioned
  with the subject so a camera that leads half a step ahead of its lit frontier
  splits the difference instead of shoving one of them to an edge. The fit
  retreats to take the context in until the subject would drop below
  1/`contextPullback` of the frame it fills alone; past that the context bleeds,
  which is the drama. The two FOCUS stages pass no context at all — each frames
  its own subject, because the camera is the only thing that separates them (see
  the interaction grammar below).
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
  `DIVE_SMOOTH_TIME` in `machine.ts`. The one-hop set is the local frame's whole
  SUBJECT: the closure lit around it may run off every edge, and that bleed is
  the "you are here, inside something larger" read the click promises.
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
  back by its diagonal, and so the move OUT from the one-hop frame is plainly
  perceptible (2–4x the framed distance on a closure-heavy standard). The
  direction chips re-aim it at that direction's closure. Re-clicking
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

**Status (2026-10-18).** The Style control (src/ui/styletoggle.ts) offers four
choices: Galaxy (0), Washi (3), Dusk (4), and Bulguksa (5, see "Bulguksa"
below). The 2026-10-03 notes that follow still hold for the first three.

**Status (2026-10-03).** The Style control (src/ui/styletoggle.ts) is mounted
again with three choices: Galaxy (0), Washi (3), and Dusk (4). It is a radio
group beside the pose control, and a Style row in the story card during a
story. `?style=washi` and `?style=dusk` deep-link a skin; the last choice is
kept in `localStorage` (`cme.style`), and an explicit `?style=` wins over it.
`galaxy`, `ringers`, `fidenza`, and unknown values load style 0. Ringers (1)
and Fidenza (2) stay dormant: no control names them, and only the `?debug=1`
hook (`__cme.art.set`) reaches them. Their design notes below are unchanged.

### Hanga skins (styles 3 Washi and 4 Dusk)

Two woodblock-print skins after Wada Sanzo (pigment combinations), Oda Kazuma
(calm dusk tones), and Utagawa Hiroshige (bokashi gradients, flat colour under
key-block lines). Both share one shader branch and differ in palette, field,
and ink (`HANGA` in src/scene/artstyle.ts). Previews: scripts/hanga-previews.mjs
and docs/previews/hanga-*.svg, which are the acceptance sheets.

- **Fields.** Washi is warm unbleached paper (#efe6d2) with a fine grain.
  Dusk is deep aizuri blue grading to slate (#12233f to #4a6185). Both carry a
  top bokashi band that belongs to the SHEET, not the sky: it is screen-fixed
  (`uBandBottom` from the layout pass), runs deep from the top of the window
  to just below the last title line, then fades over 18% of the height. The
  title prints in paper ink directly on the band, with no box, no mist, and no
  halo (Mark rejected both a cartouche and a blurred wash, 2026-10-03).
- **Pigments.** Strand hue families stay so nothing a reader learned moves:
  number = yamabuki gold, algebra = fuji/murasaki violet, geometry = asagi
  blue-green, data = beni vermilion-rose. Each pigment holds 3:1 or more
  against its field (a test). On Washi the gold is a deep ochre (#ad7408) for
  that reason. Strand dots on dark glass cards use the Dusk set under both
  skins, because the Washi set falls under 3:1 on dark glass.
- **Edges are brush strokes.** One tapered stroke per prerequisite: a pooled
  head at the prerequisite (about 2.4 CSS px), a long whisked tail toward the
  dependent standard (the taper shows direction, as the comets do in Galaxy),
  and a dry-brush split (kasure) that opens toward the tail. Hover, focus, and
  chain strokes widen 1.6x. Related pairs are a row of soft sumi dabs. A slow
  wet-ink sheen moves down lit chain strokes (4.5 s period, 8% swing, opacity
  only, off under reduced motion). Constants are at the top of the branch in
  src/scene/edges.ts. The edge program keeps exactly 16 attributes, so the
  pigment comes from `aStrand` through `uHanga[4]`.
- **Nodes are printed discs.** Flat pigment with a bokashi fade inside the
  disc and a sumi key-block ring (the inverted-hull outline). Discs print 1.4x
  the Galaxy orb radius. An edgeless standard is a bare-paper disc. The focus
  ring is a vermilion seal (#c8372d) that holds still; damage rings are sumi
  with the usual 4.5 s breath.
- **Stories play in the skin.** Lit = full pigment and full ring; story lift
  shows as a larger disc and heavier stroke, never brightness. Unlit = a faint
  sumi underdrawing (about 0.12 alpha). Damage washes toward the field and
  sheds opacity; on Dusk it also desaturates and darkens
  (`HANGA_DUSK_DAMAGE`), so damaged and lit discs differ by 45 or more of 255
  in luminance (a test; QA measured 63 to 70 in the three worst scenes).
- **Chrome.** Light paper ink on both fields. Nav hints and depth captions
  print on small slips; glass cards stay dark. Credit line while active:
  "After Wada Sanzo, Oda Kazuma, and Utagawa Hiroshige".
- **Anti-aliasing.** The composer stays on with bloom at 0 and vignette off,
  so 4x MSAA survives (the Ringers/Fidenza bypass drops it).
- **Galaxy is byte-identical.** Every Hanga branch sits behind
  `uArtStyle >= 2.5`; QA compared the Galaxy canvas against b8b44ad at rest,
  focus, Ascent, and a story scene: 0 differing pixels.

The landscape that surrounds the map under both skins is described under
"Hanga landscape" below.

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

The Ringers and Fidenza deep links are disabled: `?style=ringers` and
`?style=fidenza` load style 0 (see the status note above). Galaxy carries no
credit line.

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

### Hanga landscape (styles 3 Washi and 4 Dusk)

`src/scene/landscape.ts` raises a Hiroshige landscape around the map in the two
woodblock styles only. It is invisible, with no draw calls, in every other
style. It started from the approved previews
(`scripts/hanga-landscape-previews.mjs`) with the "more landscape" pass, and was
rebuilt (2026-10) from a study of open-access prints and photographs: Hiroshige
and Hokusai from the Met, the Cleveland Museum of Art, and the Rijksmuseum,
crane and starling photographs from Wikimedia Commons, and the STARFLAG
measurements of starling flocks. The parts live in `src/scene/landscape/`:
`core.ts` (noise, rings, easing, the home views), `crane.ts`,
`murmuration.ts`, `fuji.ts`, and `flora.ts`. `landscape.ts` re-exports all of
them, so importers keep one path.

- Four concentric ridge rings (r 1500 / 2050 / 2550 / 3050). The silhouette is
  computed per fragment from seamless periodic value noise over azimuth, with
  an anti-aliased crest and a fade to the field at the base. The crest bokashi
  is dry-brushed: solid ink at the crest, a ragged lower edge, and horizontal
  hairs where the brush ran dry (`crestInk`). On Washi the far two rings print
  paler, so the layers read as print distance layers. The walls draw their
  inside faces only, so a camera dollied out past a ring sees its far half and
  never a wall in front of the map.
- Fuji at the old peak's azimuth and distance: a lathe mesh with a near-flat
  summit and three low crater bumps, wide shoulders, and a concave flank (40 deg
  at the summit, under 25 deg at the fade). A ragged snow line with narrow snow
  tongues down the gullies and faint gully lines below them, a flat bokashi
  body that pales toward the base, a hairline contour on the upper outline, one
  thin waterfall line, and an alpenglow on the summit at Dusk.
- Suyari-gasumi bands at three depths between the rings: a flat bottom, a flat
  top, two lobes at each end stepping out and down, and a thin darker
  underline. They print in the exact field color behind them and turn once
  every 25 to 35 minutes.
- Water: a flat bokashi field at y -760 with eight rows of short tapered crest
  strokes in Hiroshige's convention (small arcs that bow toward the far shore,
  pointed at both ends, offset from row to row), receding toward the far
  shore and drifting about one cell a minute. At Dusk the strokes on the line
  from the camera toward the moon print pale and closer together: the moon
  path.
- Two framing pines outside the map's radius, at the near left (low, its pads
  under the search rail and clear of Fuji and the sun) and the near right
  (tall): plated ink trunks with a key line, and needle clusters as flat fan
  pads (camera-facing cards with a level flat underside, an irregular scalloped
  crown, and fans of needles in ink; seen from above they turn into round
  clumps). Washi prints them soft and snowless in pine green. Dusk prints them
  in silhouette with a faint pale rim on the side facing the moon. Small
  distant pines print as ink marks on ring 3's crest.
- A reed bank at the near shore, left foreground at the home view: instanced
  strap leaves and stems with drooping panicles that face the camera. They
  sway very slowly (periods 11 and 17 s) and hold still under reduced motion.
  At the Ascent the left pine and the reeds fade, because the depth scale owns
  that edge of the screen.
- The sky body: a low red-orange sun on Washi, a pale moon on Dusk.
- Cranes on both styles: one flight of red-crowned cranes (3 to 5 in a loose
  V, a 40 s crossing, then 50 to 90 s of empty sky). The anatomy follows the
  study: long broad wings, a separate black block on the inner trailing edge
  (secondaries and tertials) with white primaries beyond the wrist, a white
  tail under the black tertial plume, a black neck held straight, a red cap
  above the eye, a fine bill, and the legs trailing together past the tail
  with a heel joint. Each bird is at its own phase of one slow stroke (2.5 s).
  Each wing is a trapezoid whose chord stays parallel to the body at every
  flap angle: only the span foreshortens, by the sine of the flap angle seen
  from below. The hand lags the arm and swings further, so the downstroke
  bows. The strokes are signed-distance shapes anti-aliased with `fwidth`,
  about 20 to 23 px from wingtip to wingtip at the home view. Both fly the open
  sky right of the title block. Washi prints white
  plumage, which reads on the Prussian band. Dusk prints pale moonlit plumage
  and flies higher, at one height, above the flock.
- Dusk: one murmuration as a thin folded sheet of 2000 birds in one draw,
  moved in the vertex shader. Each bird is a small chevron aligned to the
  sheet's local flow. The sheet is uniform inside and twice as dense or more
  in its border strip, with a sparse straggler fringe, a head that curls back
  into a dense fold, and a thinning tail. It twists along its length, so where
  it turns edge-on it prints as a dark band. Its shape turns over across 29 to
  53 s.

Legibility is a test (`tests/landscape.test.ts`): Washi gold and teal keep
2.5:1 or more on every ring body and crest band, and every Dusk pigment keeps
2.8:1 on every ring, crest band, and Fuji's body. The tests also hold the
crane planform (chords parallel, the black block inside the arm), the
murmuration's placement, interior density cap, and edge ratio, Fuji's concave
profile, the mist band bounds, and the pines and reeds outside the map's radius
and clear of the title block and chrome at 1440x900, 1280x720, and 1024x600.
Motion keeps the project rules: every period is several seconds or longer,
nothing pulses in brightness, a story or a focus fades the birds out over 2 s,
and reduced motion freezes the water, mist, waterfall, and reeds and hides the
birds.

### Bulguksa (style 5)

A monumental Korean ink landscape of Bulguksa under snow, after Park Dae-sung
and the Joseon ink tradition, with the map floating above the temple.
`?style=bulguksa` deep-links it, and `cme.style` stores it like the others.
Credit line: "After Park Dae-sung and the Joseon ink tradition". The world
lives in `src/scene/bulguksa/` (params, shaders, temple, pines, index). It is
invisible, with no draw calls, in every other style, and the Hanga field and
landscape stay off at style 5 (`isHangaField`).

- **Grammar of the map.** The Hanga brush strokes and printed discs
  (`isHanga(5)` is true), on hanji. Obangsaek pigments, each 3:1 or more on the
  paper and on every massif fill tone (tests/bulguksa.test.ts): number =
  vermilion #d3382a, algebra = azurite #2b4fa8, geometry = malachite #2a7d52
  (the brief's #2f8a5a, darkened to pass), data = orpiment #9c6c08 (the brief's
  #d9a21b is 2.0:1 on the paper, so it prints deep). Measured: vermilion 4.19,
  azurite 6.56, malachite 4.40, orpiment 4.01 on #f2efe8. Card swatches on dark
  glass use light washes of the same hues (BULGUKSA_CARD, 5.6 to 8.0:1). Lit
  strokes are keyed in sumi (`uHangaKey`, style 5 only): sumi edges hold the
  pigment. The focus mark is a sumi enso (beacons `uSeal` 2): a heavy start, a
  thinning dry tail, a lift before it closes. Unlit is the faint sumi
  underdrawing. Damage washes toward the paper and sheds opacity, with the
  struggle breath unchanged (4.5 s); lit and damaged discs differ by 45 or more
  of 255 in median luminance (a test).
- **Field and sky.** Hanji #f2efe8. The paper pass prints a hanji sheet
  (HANJI_PAPER: long fibres, little mottle, no laid lines). The sky is the
  oehun method: a grey ink wash darkest along the ridge line and lifting over
  about 15% of the frame height above it, so the snow crests read as reserved
  paper. It is deep (#7d786f) behind the tall massifs at the sides and lighter
  (#b3ada3) behind the low snow hills in front of the map, so the pigments keep
  their contrast; above the band it is #e4e0d8. The title band is screen-fixed
  (`uBandBottom`, shared with Washi and Dusk) in a pale ink wash #c4beb3, and
  the title prints in SUMI: #1c1a17 on the band is 9.4:1 and the lightest line
  ink (#4a4339) is 5.3:1. Paper ink on a dark band was rejected because the
  dark band would have to fall below L 0.09 to carry it, and the sumi birds and
  inscription in the band would then vanish. No box, scrim, mist, or halo.
- **Massifs (round 3).** Four concentric walls (R 1750 to 3300, ring tops
  -10, 65, 150, 260) painted as monumental ink masses: a wet sumi wash over
  the rock (#5a5650 to #2a2824, mottled by three octaves of noise, darker on
  the lee face, pooled darker at the snow's edge), jun strokes, and a dark
  tide line where the wash dried at the base. Snow is reserved paper: a
  stepped, ragged cap that follows the silhouette, with shelves under each
  inner fold and a grey lee wash. The far crests reach the map's upper third
  at the home view (the median crest of the far ring prints between y 300 and
  440 at 1440x900, a test), and each far crest prints above the nearer one.
  Jun strokes are brush marks: each patch of 110 by 80 units holds one slope
  direction, and in it groups of 3 to 7 strokes (cells of 90 by 52, some
  left empty) lie 6.5 units apart, each tapered at both ends on a sine,
  slightly bowed along the slope, with a dry-brush break in the middle of the
  strokes longer than 30 units.
  Rock may lie behind the map, but there a mist pales it toward the paper:
  0.8 of the way inside the map's body at the home view (the frame's centre
  76% of width, fading out by 88%, and below the map's top edge, fading over
  160 units above it). The title block's corner is misted the same way in
  screen space (left of 50 to 62% of the width, above the band bottom), so
  the chrome text keeps its band. Above the map and at the sides the ink is
  full strength. The gate (a test): over the map body's 5th to 95th
  percentile box at 1440x900, 1280x720, and 1024x600, the darkest mark a face
  can carry (sumi) paled by the mist gives every pigment at least 3:1. The
  worst case is data at 3.27:1 (number 3.41, geometry 3.59, algebra 5.35).
- **Snow slope.** A gentle dome of paper under the map with faint wind drifts
  toward the rim, three wandering grey hairlines that draw the slope's shape,
  and ink marks (small pines, reed tufts, rocks) along its far edge.
- **Temple (round 3).** Low-poly geometry in plan units (front terrace 100
  wide), drawn as an ink drawing in three weights: HEAVY roof lines (eaves,
  hips, ridges; 1.35 world units), MEDIUM wall, terrace, and stair lines (0.7
  world units; widths in world units, so near edges print heavier), and
  HAIRLINE ruled lines (a few broken courses of ashlar, posts, railings,
  nosings; 1 px at 0.32 opacity). Fills are paper tones shaded by one light;
  walls (#d9d4ca), soffits, and stone carry a mottled wet-ink wash. The
  boulder base is a strip of rounded ink-wash stones drawn as an SDF of
  overlapping ovals, each with a wet dark edge and a paper highlight, with no
  facets. Cheongungyo (16 steps) and Baegungyo (18) climb to Jahamun, with the
  arch under the lower flight; Yeonhwagyo (10) and Chilbogyo (8) climb to
  Anyangmun; Beomyeongnu is raised on its stacked stone pillar; corridors
  enclose the court; Daeungjeon is raised on its platform with Seokgatap
  (plain, three stories) to the west and Dabotap (stair base, pillars,
  octagonal balcony, lotus tier) to the east; Museoljeon closes the back;
  Geungnakjeon sits in the west court. Every roof is snow: lifted corners,
  deep ridge and hip-end heaps, a deep eave lip with a dark row of tile ends,
  a soffit in shadow, and a faint muted dancheong band. Scale 5.53 world units
  per plan unit, heights at 0.5 and depths at 0.45 of it (the raised
  viewpoint), centre x -130, front face at z 300, ground y -255: the front
  spans about 60% of the frame width at the home view. At 1440x900 the main
  hall's ridge prints at y 745 (33 px under the lowest etch label, 712), the
  hall spans x 617 to 799 (left of the Style card, 886), and the terrace foot
  prints at y 840 (above the filter rail, 844). At 1280x720 the hall ends at
  x 706 (left of the Style card, 726). Tests hold each of these. Five draw
  calls.
- **Pines (round 2).** Painted, not modeled. Trunks and limbs are smooth
  tapered tubes inked in the fragment shader: a wet-ink edge from the facing
  ratio (no facets), a paler core, and plated bark as short thin dark dashes
  across the trunk in staggered rows. The needle pads are camera-facing cards
  drawn as needle fans: an ellipse whose rim swells in clusters and is cut
  into radiating teeth, fine needle streaks, a snow pillow of reserved paper
  on top with a ragged lower edge, and a soft grey wash where snow meets
  needles. Two framing pines stand at the left and right edges of the home
  view; smaller pines stand outside the map's footprint and behind the camera.
  A pine inside about 22 degrees of the view axis ghosts out, so an orbit never
  walls the map off behind a crown. Two draw calls.
- **Cranes.** One flight of 4 to 6 red-crowned cranes on the Hanga schedule
  (`craneScheduleInto`: a 40 s crossing, then 50 to 90 s of empty sky) across
  the right half of the sky, clear of the title block. Wings spread below and
  above the body line in one slow stroke (3.4 s), each bird at its own phase;
  white primaries, black secondaries and tertials on the arm's trailing half,
  black neck, red crown, legs past the tail. About 18 to 21 px across at the
  home view. The V is loose: slots up to 0.072 of the path behind the leader
  and up to 205 units above or below.
- **Murmuration.** 1200 starlings in one draw call, moved in the vertex
  shader: a thin sheet leaning about 75 degrees from face-on, folded through its
  thickness, with a sharp edge, a uniform and sparse interior (0.55 alpha), and
  a 5% straggler fringe (0.78 alpha). Periods 29 to 61 s. Chevrons at 2x. It stays clear of the title block
  and the map at 1440x900, 1280x720, and 1024x600 (a test).
- **Falling snow.** 900 flakes in a box around the camera target, one draw
  call, never under 1.6 CSS px and faded at the box faces, so nothing pops or
  twinkles.
- **Inscription.** "佛國雪中數理圖" in a vertical column with a vermilion seal,
  written to a canvas at boot (no image file), on the sky at a fixed world
  azimuth, so it moves with orbit like ink on the sheet.
- **Motion.** Quiet (a story or a focus) fades the birds over 2 s. Reduced
  motion freezes the snow and hides the birds. Nothing pulses in brightness.
- **Cost.** At the 1440x900 home view Bulguksa draws 107 calls and 311,623
  triangles (Washi: 101 and 269,177); the world alone is 18 draws.
- **Study.** Open-access study only (Commons CC0, PD, and Creative Commons
  photographs and the site plan; Cleveland CC0 paintings; exhibition text for
  Park Dae-sung). Nothing from the study is embedded; everything is procedural.
