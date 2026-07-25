# Formations beyond the first three (design ideation, 2026-07)

The deep structure every candidate must express: ACCUMULATION WITH
INHERITANCE. Prerequisite knowledge is a present that grows on the structure
of the past, and families are wholes that receive through their parts
(Axis 3). Nature's strongest forms for that are the ones where direction and
memory are intrinsic to the shape itself.

## Leading candidates

### The Watershed (delta) — strongest fit
Tributaries (early standards) merge into rivers (strands), braid, and open
into a delta at the sea (high school). Direction is intrinsic: water only
flows one way, and "upstream/downstream" is already how educators talk about
prerequisites. Mappings fall out for free: stream WIDTH = descendant reach
(the load-bearing gradient, literally discharge volume); confluences =
families (a rootlet stream feeding the river IS inherited flow); WAP
standards = the major confluences. Damage grammar becomes drought: dam one
tributary and the dry bed propagates visibly downstream. Lose-a-year on the
watershed would be devastating in the best way.

### The Reef — most artful
Coral heads are colonies of polyps: the perfect part-whole (nobody separates
a coral head from its polyps; arrivals at a polyp feed the colony). Reefs
grow by ACCRETION: the living layer builds on the skeletons of everything
that came before, which is the most honest biological metaphor for
prerequisite knowledge that exists. Grade zones as reef zones, currents as
flow, bleaching as the damage grammar (a bleached patch starving what grows
on it). Palette-native to Fidenza's teal.

### The Transit Map — most legible
Human-made but a world model everyone reads fluently. Metro lines = strands,
stations = standards, station COMPLEXES with multiple platforms = families
(one station, several platforms: Axis 3 solved by every subway map on
earth), interchange size = reach, and "change at Fractions for Algebra" is a
sentence any parent understands. The diagnostic story (find where it begins)
becomes literal route-planning.

## Sorted lower
- Neural/dendritic (thematically perfect — it is about learning — but
  visually near-duplicate of the Constellation; better as a future art
  style than a pose).
- Cosmic web / filaments (a Constellation VARIANT for the evolving sky, not
  a pose).
- Strata/geode cross-section (beautiful, Fidenza-adjacent; reads as time
  rather than dependency depth).
- Vascular system (strong inheritance metaphor, wrong tone).
- Murmuration (coordination, not dependency; no fit).

## The third dimension (Mark, round 9)

Every formation is built 3D under the anamorphic law (flat and legible from
its canonical angle, dimensional when orbited):
- WATERSHED: altitude is real — K highlands descend to HS sea level, channels
  carve the drop, and a large depth jump reads as a waterfall. Canonical view
  is the painterly top-down map.
- REEF: true volume — colonies grow as 3D coral bodies, zones wrap in depth,
  the light shaft is a volumetric cone from the surface.
- TRANSIT: a futuristic layered city — lines run at different z-levels
  (elevated, surface, deep), climb between levels in helixes at the great
  interchanges, and the loop is a three-dimensional knot you can orbit.

## Status (2026-07-18)

Mathematically derived previews approved in principle; Mark's verdicts:
TRANSIT — approved, in-app build LAUNCHED (4th pose: derived layout from the
pipeline, per-line z-levels, ramps at transfer stations, anamorphic front-on
collapse). WATERSHED and REEF — ON HOLD at Mark's direction; previews stand,
no build until he says go.

## Shipping strategy (anti-feature-museum)
The pose toggle stays at three. New formations enter as:
1. STORY-OWNED STAGES first: a story plays on the watershed before any
   toggle exists (lose-a-year as drought). Stories justify formations; the
   toggle only ever earns a fourth entry if one formation proves itself.
2. SEASONAL FORMS via the evolving-sky clock: on some days the Constellation
   leans toward the cosmic-web variant; formations as weather, not menu rows.
3. Previews from real data before any build (standing law).

## Transit unfocused overview (2026-07-20)

The Transit map is legible when a standard is focused (the chain lights, the rest
of the city ghosts toward the background). But with NO focus, every one of the
~757 prerequisite lines rests at full metro opacity (~0.95) and the ~142 related
walking-transfers add to the pile, so at full zoom the schematic collapses into an
edge tangle and the trunk grammar disappears. The unfocused overview therefore
FEATURES THE TRUNK NETWORK: non-trunk (low-reach) resting lines fade toward the
dimmed convention (~0.08 alpha, per DESIGN.md's dimmed edge table) while wide trunk
lines stay opaque and the stations/interchanges carry the reading. "Trunk-ness" is
the reach-normalized signal that already sets a line's metro WIDTH (source
descendant reach), so width and opacity agree — a wide line is never ghosted. This
is a RESTING-state treatment only: the moment a standard is focused the existing
grammar takes over untouched (connected chain saturates, the city ghosts), and it
is gated entirely on the Transit morph so the other poses are unaffected.

## Pared back to two live poses + galaxy (2026-07-24)

Mark's call: pull the extra surfaces back for now and let the galaxy carry the
map. What changed in the UI, all reversible ("for now"):

- **Blueprint (pose 2) and Transit (pose 3)** — removed from the view switcher
  (src/ui/viewtoggle.ts) and from the story-HUD Formation pin
  (src/stories/formationpick.ts). ON HOLD alongside Watershed and Reef. The
  poses stay in the driver and still render — any story authored into Blueprint
  or Transit still plays its authored pose untouched; there is just no toggle or
  pin entry for a reader to reach them cold. Restoring is re-adding the two rows.
- **Art styles (Ringers / Fidenza) + the "Style overrides" tab** — the switcher
  (src/ui/styletoggle.ts) is unmounted and the `?style=` deep-link is disabled,
  so style is pinned to 0 (the galaxy). The `applyArtStyle` fan-out and both
  skins stay intact and dormant (src/scene/artstyle.ts and the per-scene
  `setArtStyle` handles are unchanged).
- **Ascent reverted to the galaxy design.** The Sierra dawn environment
  (src/scene/environs.ts) is held off at its gate (`DAWN_HELD` in `update()`),
  so the Ascent reads as the dark constellation baseline again — full
  starfield/nebula/planets, no mist/ridges/gold horizon, no `body.env-light`
  chrome flip, no vivid enamel — with the topographic elevation isolines
  (src/scene/contours.ts) visible once more. The isolines were already wired to
  the Ascent morph; the bright dawn sky had been washing them out. The dawn's
  shell/mist/gate code is kept intact and dormant; flip the one flag to restore
  it. No bloom/exposure change was tied to the dawn (bloom keys off the Transit
  concrete daylight only), so nothing else reverts with it.

The pose toggle is back to two live entries; the shipping strategy above still
holds — a formation earns a switcher row by proving itself in a story first.
