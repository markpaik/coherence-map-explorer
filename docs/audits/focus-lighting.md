# Focus-lighting audit: orphaned lit regions

Verifies Mark's report that clicking `4.NF.B.3` (and, separately, `3.MD.C.7`)
lights "a completely separate part of the map" with no visible connection
back to the focused standard. Read-only audit — no fixes implemented.

## Findings

**Root cause, confirmed exactly (not a guess): the focus node itself is
always edgeless.** `computeFocus()`'s rollup only fires when the focused
standard has zero incident edges of any kind — `preds`, `succ`, and
`relatedAdj` are all empty (`src/state/machine.ts:317-321`). That is also,
independently, the reason `machine.edgesOfNode()` returns `[]` for the
focused node. Every chain/related edge the cascade lights is drawn between
two nodes in `ancestors ∪ descendants ∪ parts ∪ related` — never between the
focus and anything else, because no such edge exists. The parent↔child
family filament is the *only* geometric link between the clicked dot and its
lit neighborhood, and `src/scene/filaments.ts` renders it at a constant,
never-brightening 0.22 opacity regardless of focus state. So for every
edgeless-parent focus, the clicked standard is graph-theoretically its own
isolated one-node component, and the entire rest of the lit neighborhood —
however large — forms a separate, fully-connected component with no lit edge
bridging the two. This was verified against the running app itself (not just
the reimplementation): `window.__cme.machine.edgesOfNode(idx).length === 0`
and the live `aEmphasis` GPU buffer read `3` (FOCUS) for the clicked node and
`4` (CHAIN) for its sub-standards, for both named cases below.

**Scope: exactly the 13 edgeless parents, 100% of them affected, and nothing
else.** Of 480 standards, 13 are "edgeless parents" (own zero edges, so
`computeFocus` rolls up their children's neighborhoods):

`3.MD.C.7, 4.NF.B.3, 5.MD.C.5, 6.NS.C.6, 6.NS.C.7, 7.NS.A.1, K.CC.B.4,
A-REI.B.4, A-SSE.B.3, F-BF.A.1, F-IF.C.7, F-IF.C.8, S-ID.B.6`

All 13 — no more, no fewer — produce at least one orphaned lit component.
The other 467 standards produce **zero** orphans: every ancestor/descendant
node reached by the BFS is connected back to the focus by a real, lit prereq
edge by construction (each BFS step traverses an actual graph edge, and that
edge always satisfies `edgeFinal`'s `inAnc`/`inDesc` test), and every direct
related neighbor of a normal (non-rolled-up) focus is lit by a dashed edge
that runs straight to the focus itself. **Zero genuine bugs** in the
BFS/emphasis logic were found — every orphan across all 480 standards
categorizes as cause (b), "family hand-off": the orphaned region would merge
with the focus's component if the family filament were treated as a lit
edge. Cause (c), genuine disconnection, occurred nowhere (0 of 14 orphan
groups). Cause (a), a dashed-only related light that reads as an unexplained
glow but is technically connected, is common (see Related issue below) but
is never itself an "orphan" under this audit's connectivity test.

| Metric | Count |
|---|---|
| Standards audited | 480 |
| Focuses with ≥1 orphaned lit component | 13 / 480 (2.7%) |
| Total orphan groups (some focuses split into 2) | 14 |
| Cause: family hand-off | 14 / 14 (100%) |
| Cause: genuine disconnect | 0 / 14 |
| Edgeless parents (rolled-up focuses) | 13 |
| ...of which produce ≥1 orphan | 13 / 13 (100%) |
| Non-edgeless-parent focuses with any orphan | 0 / 467 |

**Worst 10 offenders** (by total orphaned lit-node count — i.e., how much of
the map lights up with no visible path back to the dot you clicked):

| Standard | Lit nodes | Orphan groups | Orphaned nodes |
|---|---|---|---|
| 4.NF.B.3 | 249 | 1 | 248 |
| K.CC.B.4 | 216 | 2 | 215 (4 + 211) |
| 3.MD.C.7 | 169 | 1 | 168 |
| A-SSE.B.3 | 142 | 1 | 141 |
| F-IF.C.8 | 134 | 1 | 133 |
| A-REI.B.4 | 129 | 1 | 128 |
| F-BF.A.1 | 105 | 1 | 104 |
| 7.NS.A.1 | 103 | 1 | 102 |
| F-IF.C.7 | 91 | 1 | 90 |
| 6.NS.C.6 | 69 | 1 | 68 |

(Remaining three: 6.NS.C.7 — 57 orphaned of 58 lit; 5.MD.C.5 — 35 of 36;
S-ID.B.6 — 17 of 18.)

### 4.NF.B.3 — the reported case

- **Not rolled-up because it lacks connections** — it has 4 sub-standards
  (`.a`–`.d`) that carry all the real edges. `ownEdgeless = true`.
- Panel counts (verified live in the running app): **Sub-standards 4, Builds
  on 7, Leads to 3, Related 2** — buildsOn = `1.OA.B.3, 1.OA.B.4, 1.OA.D.8,
  2.OA.A.1, 3.NF.A.1, 3.NF.A.2, 4.NF.A.1`; leadsTo = `4.MD.A.2, 4.NF.C.5,
  5.NF.A.1`; related = `4.MD.A.2, 4.MD.B.4`.
- Total lit nodes: 249 (ancestors 47 + descendants 196 + focus + parts +
  related, with overlaps). Lit edges: 428.
- **Orphan: 1 component, 248 of the 249 lit nodes** — literally everything
  except the clicked dot itself. It spans from `K.OA.A.1`/`K.CC.A.1` at one
  end through the entire multiplication/fraction/ratio chain up to
  `F-IF.A.1`, `G-CO.A.2`, `S-ID.A.1`, and dozens of Algebra/Geometry/Function
  standards at the other. All 428 lit edges connect nodes within this one
  blob; none of them touch node index 109 (`4.NF.B.3`) because it has no
  edges to touch.
- Cause: 100% family hand-off. Restoring the (currently invisible) filaments
  from `4.NF.B.3` to its four children would merge this single orphan group
  straight into the focus's component — nothing else is needed.

### 3.MD.C.7 — second reported case

- Also an edgeless parent: 4 sub-standards (`.a`–`.d`) carry the edges.
  `ownEdgeless = true`.
- Panel counts (verified live): **Sub-standards 4, Builds on 2, Leads to 2,
  Related 2** — buildsOn = `3.MD.C.5, 3.MD.C.6`; leadsTo = `4.MD.A.3,
  5.NF.B.4`; related = `3.OA.B.5, 3.OA.D.8`.
- Total lit nodes: 169 (ancestors 13 + descendants 149 + focus + parts +
  related). Lit edges: 265.
- **Orphan: 1 component, 168 of the 169 lit nodes** — again, everything
  except the clicked dot. The screenshot spot-check (below) shows this
  clearly: a rose-colored cluster (`3.OA.B.5`/`3.OA.D.8` and their neighbors)
  on the left, a cyan geometry arm bottom-left, and a large gold hub-and-web
  structure spanning the center-right — three visually separated regions,
  none of which has a lit line running to the actual `3.MD.C.7` dot.
- Cause: 100% family hand-off, same mechanism as 4.NF.B.3.

### K.CC.B.4 — the one case with 2 orphan groups (worth noting)

Its 3 children (`.a`–`.c`) split into two neighborhoods that don't touch each
other via any lit edge either: child `.a`/`.b` reach only a small 4-node
pocket (`K.CC.A.1`, `K.CC.B.5`), while child `.c` alone opens onto the
209-node downstream web (through `1.OA.C.5` etc.). Both groups are still
"family hand-off" — connecting each child to the focus (a star through the
always-visible focus dot) resolves both — but it shows that sibling
sub-standards can themselves read as unrelated map regions even before
factoring in the parent.

### Browser spot-check (confirms the perceptual account)

Ran the dev server at `http://localhost:5173/?debug=1`, pumped frames with
`window.__cme.stepFrame`, removed the veil, and called
`window.__cme.focusCode('4.NF.B.3')` / `('3.MD.C.7')`. Confirmed directly
against the live app (not just the reimplementation):

- `window.__cme.machine.edgesOfNode(idx).length === 0` for both focused
  nodes — zero incident edges, full stop.
- The live `aEmphasis` GPU buffer reads `3` (FOCUS) at the focus index and
  `4` (CHAIN) at each of its children's indices, matching the
  reimplementation exactly.
- Screenshots show a dense, richly interconnected gold/violet/rose/cyan web
  in the framed neighborhood (confirming "a lot lights up") with no lit line
  converging on the clicked standard's own screen position — matching Mark's
  report that the lit region reads as visually separate from the thing he
  clicked.

### Related issue (ii): dashed-only related lights

Counted, for every focus, related nodes whose final emphasis stays `RELATED`
(i.e., their only lit connection is the subtle dashed related edge, never
reinforced by a solid chain edge). This is a distinct, much more common
phenomenon than the family-hand-off orphans — and by the audit's
connectivity test these are *not* orphans (the dashed edge genuinely is lit
and does connect them), but they can still read as "an unexplained light far
across the map" at a glance, per Mark's second concern.

| Metric | Count |
|---|---|
| Focuses with ≥1 dashed-only related light | 176 / 480 (36.7%) |
| Total dashed-only related-lit nodes (sum) | 301 |

Top 5 by count: `F-LE.A.2` (7), `3.OA.D.8` (5), `6.EE.B.7` (5), `G-MG.A.1`
(5), `2.OA.A.1` (4).

## Method

1. Wrote a standalone Node script
   (`/Users/markpaik/.claude/jobs/b484ec48/tmp/audit-focus-lighting.mjs`)
   that loads `public/data/graph-core.json` directly and reimplements
   `computeFocus()` line-for-line from `src/state/machine.ts:311-414`:
   the `ownEdgeless` test, the `roll()` seeding for rolled-up parents, the
   `bfsFrom`/`bfs` ancestor/descendant closures, the `anchors` set
   (`focus` plus `parts` when rolled up), the `nodeFinal` emphasis map
   (related → chain → focus precedence, matching the Map-overwrite order in
   the source), and the exact `edgeFinal` conditions (`inAnc`/`inDesc` for
   prereq edges, `anchors`-touching + `relatedAnchorAdj` for related edges).
   Family relations were read from `children`/`parent` fields on
   `GraphNode` (`src/data.ts:51-53`), confirmed present in
   `public/data/graph-core.json` (40 parents, 116 children, no 3-level
   nesting).
2. For each of the 480 standards as focus, built the lit-node set
   (`nodeFinal` keys) and lit-edge set (`edgeFinal` keys, mapped to node-index
   pairs via the edge arrays), then ran union-find over the lit nodes using
   *only* the lit edges. Any connected component not containing the literal
   focus node index is an orphan — this matches the literal "no visible lit
   path back to the focus" framing in the brief. (Note: the brief's
   parenthetical "(or its anchors)" would, read literally, treat a component
   containing a rolled-up parent's *children* as non-orphaned even though it
   never touches the clicked dot. I used the strict focus-node definition
   instead, since it's what actually matches "a completely separate part of
   the map lights up" — the human-visible bug — and used the anchors set
   only for cause classification, below.)
3. For every orphan group, tested whether adding the (always-present, never
   lit) parent↔child family pairs as edges — restricted to nodes already in
   that focus's lit set — would merge the group into the focus's component.
   If yes → cause (b) family hand-off. If no → cause (c) genuine disconnect.
   (Cause (a), dashed-only related links, can't produce an orphan group by
   construction — if the connecting related edge is lit, both endpoints are
   already in the same union-find component — so it's reported separately as
   metric (ii) rather than as an orphan category.)
4. Verified the reimplementation against 3 hand-checked cases, comparing
   `buildsOn`/`leadsTo`/`related` counts to the actual rendered panel:
   - `3.NF.A.1`: script gives buildsOn 2, leadsTo 7, related 2 — exact match
     to the reference values in the brief.
   - `4.NF.B.3`: script gives buildsOn 7, leadsTo 3, related 2, parts 4 —
     confirmed against the live panel in the browser (`Builds on · 7`,
     `Leads to · 3`, `Related · 2`, `Sub-standards · 4`).
   - `3.MD.C.7`: script gives buildsOn 2, leadsTo 2, related 2, parts 4 —
     confirmed against the live panel (`Builds on · 2`, `Leads to · 2`,
     `Related · 2`, `Sub-standards · 4`).
5. Cross-checked the reimplementation against the actual running app: read
   `window.__cme.nodes.emphasisAttr.array` (the live GPU buffer) and
   `window.__cme.machine.edgesOfNode(idx)` for both named cases — both
   matched the script's independent computation exactly.
6. Repeated the whole analysis for all 13 edgeless parents (found by the same
   `ownEdgeless` test the machine itself uses) and separately tallied
   dashed-only related lights across all 480 focuses.

## Recommendations (ranked)

1. **Light the family filament when both ends are lit.** This is the direct
   fix for the reported bug and accounts for 100% of the orphans found (14 of
   14 groups, all 13 edgeless parents). Concretely: in
   `src/scene/filaments.ts`, drive the segment's opacity/color from the
   current `aEmphasis` state of its two endpoints (parent and child) rather
   than a constant 0.22 — e.g., brighten to something in the CHAIN family
   (not necessarily identical to a prereq ribbon, to preserve the
   "annotation, not data" distinction the file's header comment calls out)
   whenever both endpoints are lit above REST. This closes every orphan in
   this audit without changing `computeFocus()`'s BFS/emphasis logic at all
   — the graph closure is already correct; only the rendering of the
   structural link that stitches focus to its rolled-up neighborhood is
   missing. Note K.CC.B.4's two-group case: lighting focus↔child individually
   for all 3 children resolves it too, since every child then joins the same
   component through the always-lit focus, even though the children don't
   connect to each other.
2. **Strengthen the related dash under focus, for the more common (36.7% of
   focuses) "unexplained light" complaint.** These aren't orphans by this
   audit's connectivity test — the dashed edge is genuinely lit — but a thin
   dash reaching across a large screen distance under bloom is easy to miss,
   so the far node can still read as unexplained. Consider a temporary
   emphasis boost (thicker dash, brief comet/flow pulse, or a `RELATED`-tier
   node-glow bump) specifically while a related edge is newly revealed by a
   focus cascade, distinguishing it from the steady-state dashed style used
   elsewhere.
3. **No changes needed to `computeFocus()` itself.** The BFS closures,
   `edgeFinal` conditions, and rollup logic are internally consistent: zero
   of 480 standards produced a "genuine disconnect" orphan. The bug is
   entirely a rendering gap (filaments never brighten), not a graph-logic
   gap.
4. **Optional, low priority:** if the family-filament fix (rec. 1) ships,
   double check the "trace to foundations" camera fit
   (`src/state/machine.ts:579-586`, `sphereOf([focusIndex, ...lastAncestors])`)
   and the initial focus-camera fit (`sphereAround(nodeIndex, neighborhood)`,
   `machine.ts:545-547`) still read well for the 13 edgeless parents once a
   bright filament pulls the eye toward the parent dot — the neighborhood
   framing already includes `parts`, so this is likely fine, but worth a
   visual pass once the filament fix lands.
