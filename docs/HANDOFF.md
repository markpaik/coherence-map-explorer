# Working handoff — Coherence Map Explorer

Session handoff for continuing work (written 2026-07-17, at commit
`5f092e2`). The product is LIVE at
https://coherence-map-explorer.markhpaik.workers.dev. Repo:
https://github.com/markpaik/coherence-map-explorer. Model roles: Fable
designs/orchestrates and owns all polish and copy; Opus builds from Fable's
specs (subagents); Sonnet verifies/audits. Deploy: `npm run build && npx
wrangler deploy`, then `git push`. Data rebuilds: `npm run data`
(deterministic, seed 1337; byte-identical builds are test-asserted).

## Shipped state (all live)

- **Three poses**: Constellation (galaxy, node.pos), Ascent (depth massif,
  pos2 — standards align above their prerequisites within grade bands),
  Blueprint (flat 13-column circuit board, pos3 — domain-banded columns,
  side gutter for edgeless standards, left-rail same-column arcs, aligned
  label baseline, front-on camera, drift quieted ×0.18). Morphs start from
  live positions; tri-pose driver in src/scene/pose.ts.
- **Stories (7)**: six narratives + interactive "Lose a year, any year"
  (grade chips, live recomputed numbers). Dark-baseline grammar: everything
  ghosts; scenes declare `lit` sets; directional reveals (`reveal: ltr|rtl`)
  sweep grade columns; damage reads near-black (linear-space ember); healing
  codas stagger node-by-node (`heal: scatter|ltr`). Copy is in Mark's
  writing-voice; numbers are engine-verified. Story lift ×1.9 on lit nodes,
  edge glow/comets gated to lit set; both die fast with damage (×3.0).
- **Browse mode**: phones default to an Achieve-the-Core-style drill-down
  (grade → domain → standard → tappable connections); `?browse=1` forces on
  desktop, `?nobrowse=1` off. "See in the map" → focused constellation;
  phone sheet opens at PEEK (swipe up = short flick ≥56px hands back to
  Browse); Browse pill bottom-left thumb zone; tour hidden on phones; title
  block hidden on phones in map view.
- **Focus behavior**: camera centers the CLICKED node, fits its directed
  neighborhood; related pairs widen the frame only to 1.6× (zoom now feels
  consistent). Full transitive chain lights (that is by design — Trace pulls
  back to frame the whole ancestry). Family filaments BRIGHTEN when both
  endpoints are lit (the 2026-07 audit fix: all 13 edgeless heading
  standards, e.g. 4.NF.B.3 / 3.MD.C.7, previously lit orphan-looking
  regions; docs/audits/focus-lighting.md has the full report). Related-to-
  focus dash widened (37% of focuses have dash-only related lights).
- **Sky**: 1750 stars + 7% deep-twinkle sparklers; seven procedural bodies
  surrounding the map incl. a megaplanet (r700 @ ~2700 units, alpha 0.11);
  world-space eclipse phases driven by the visitor's local clock (one sun
  lap per 24h, per-body offsets); all fade out leaving the Constellation.
- **Orbs**: limb-darkened spheres + half-Lambert key light (frank lit/shadow
  hemispheres, luminous shadow side).
- **Reduced motion**: suppresses MOTION (morph cuts, drift off, shimmer off)
  but never TIMING (story/tour auto-advance keep running with cut
  transitions). Mark's own iPhone likely has RM enabled — check before
  diagnosing "animation broken".
- **A11y/mobile**: page + Browse clip horizontal overflow; KaTeX lines
  scroll in place; filter rail tightened with lens definitions as styled
  hover/focus tooltips; story mode on phones lifts the model ~17% viewport
  above the card.

## Open threads, ranked

1. **Fidenza / Ringers real build** — v2 previews (docs/previews/, script
   scripts/art-previews.mjs) rendered in Mark's colorways: Ringers on
   paste-cream (#f0ece0) with bold-black-outlined pegs
   (white/red/yellow/blue/green, white = edgeless) and taut tangent strings
   that wrap the destination peg; Fidenza on teal (#43a08b) with
   navy/brown/cream/yellow/red/mint ribbons and cube nodes trailing striped
   caps. AWAITING Mark's verdict on the previews before building. Build
   spec essentials (also in DESIGN.md "Art styles"): Fidenza ribbons must be
   collision-aware (non-overlap is the artist's signature); Ringers' Trace
   should render one CONTINUOUS string wrapping the whole ancestry chain;
   prototype dimness as OPACITY vs brightness on stills; credit Hobbs
   (curated.xyz/editorial/collecting-fidenza) and Cherniak
   (curated.xyz/editorial/collecting-ringers) in-app when shipped. Mark
   wants these as 3-D styles with real thickness — flat from a canonical
   angle, sculptural when orbited.
2. **Constellation art pass** — promised previews (not yet made): edge-
   bundled strand rivers with visible fan-out, de-clumping for negative
   space, flow-field variant. Rule: beauty through ORGANIZATION, never
   reduction — all 899 edges stay visible. Previews from real data before
   any build (the spiral lesson; twice burned).
3. **Phone-device confirmation** — Mark to verify on his iPhone: flick-up
   threshold (56px), story-mode lift (17%), horizontal overflow gone,
   frame-clean map view. Tune by one-sentence feedback.
4. **Phase 7 wrap-up** — README screenshots (hero + story + blueprint +
   browse), og.png refresh, docs em-dash sweep (writing-voice bans them; a
   few remain in older docs), delete stale "234/49%" comment in
   tests/stories.test.ts (~line 43), final CLAUDE.md sync.
5. **Parked observations** — browse pill overlaps the desktop panel only in
   the ?browse=1 test path (non-issue on phones); lazy-boot the 3D scene
   under Browse (phone battery); a touch-language tour variant someday;
   first-run hierarchy (the product nears feature-museum density — freeze
   new modes, spend rounds on depth; Mark agreed in spirit).

## Working practices that matter here

- **Browser verification**: tabs are often OCCLUDED → rAF never runs. After
  navigate: `for (let i=0;i<60;i++) window.__cme.stepFrame(1/30);
  document.getElementById('veil')?.remove();` (needs `?debug=1`). The
  player's goto() awaits a pose promise — pump frames, YIELD (end the
  eval), pump again in a new eval, or state reads run one scene behind.
  HMR reloads kill long evals after your own edits; re-navigate. Vite dev
  server usually already running on :5173. `resize_window` is inert (window
  stays huge); mobile layouts can't be truly reproduced in-harness — verify
  by computed styles or ship + ask Mark.
- **__cme debug hooks**: machine, focusCode, stepFrame, pose.driver
  (setPose 0|1|2), stories.start/player, tour, nodes/edges (attr arrays),
  graph, setReducedMotion, screenPos (constellation pos only).
- **Concurrent agents**: give explicit file ownership lists (this session
  ran Fable + Opus builders + Sonnet audits in one tree with zero
  conflicts). Opus builds from precise specs; Sonnet audits re-derive rules
  from source, never guess. Agents must be told the frame-pump/HMR/resize
  facts above or they burn time rediscovering them.
- **Shader color literals are LINEAR** — the output transform re-brightens
  them (an "sRGB-looking" hex in GLSL renders ~2× brighter). THREE.Color
  uniforms convert automatically; raw vec3 literals must be pre-converted
  (the ember bug).
- **Copy is design**: story cards, tour captions, and all UI copy follow
  the writing-voice skill (no em dashes, no colon tee-ups, verbs not
  nominalizations, numbers paired, no jargon — "load-bearing" was called
  out). Fable writes it; never delegate copy.
- **Date/randomness**: forbidden in the PIPELINE (determinism tests);
  runtime may use Date (the sky clock does) and hashes-from-ids for
  variation.
- Memory files exist for: project identity, story visual grammar, pose
  spectrum + mobile + RM interpretation. CLAUDE.md carries pipeline facts,
  pose list, live URL.

## Key file map

- scripts/build-graph.ts — pipeline (poses, blueprint layout §7c, ascent
  alignment §7b, markers, control points); layout-params.json.
- src/scene/: nodes (orb shader, story lift, damage ember), edges (ribbon
  shader, story gate, related dash), pose (tri-pose morph), camera (rig,
  drift, frame lift, panel offset), filaments (family threads, lit-when-
  both-lit), planets (sky), starfield, etches, bloom, nebula.
- src/state/machine.ts — single emphasis writer; computeFocus (rollup for
  13 edgeless parents), sphereAround (focus fit), trace, reframe.
- src/stories/: scripts (7 stories — copy frozen to designer), player
  (dark-baseline lit engine, reveals, heals, lose-a-year), damage,
  selectors; src/ui/storycard (setExtra slot).
- src/ui/: browse (phone drill-down), panel (peek sheet + expand-to-browse),
  filters (tooltip lens), search, tour, viewtoggle; interaction/picking.
- docs/: DESIGN.md (authoritative, incl. art-styles brief), STORIES.md
  (grammar + citation ledger), audits/focus-lighting.md, previews/,
  HANDOFF.md (this file).
