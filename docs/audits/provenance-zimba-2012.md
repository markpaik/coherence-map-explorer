# Provenance: Zimba 2012 → Achieve the Core → this map

2026-07 deconstruction of Jason Zimba's "A Graph of the Content Standards"
(June 2012 PDF; the primary-source ancestor of the Achieve the Core coherence
map). Method: the poster page carries vector text and vector arrows, so the
graph was reconstructed geometrically (not by eye), then every disputed edge
was adversarially re-verified against high-DPI crops of the actual pixels.
Combined with the source-fidelity audit and the renderer-semantics QA, this
completes a four-layer chain of custody.

## The chain, verified end to end

1. Zimba 2012 poster (K-8, vector-reconstructed) →
2. Achieve the Core data.js (live file sha256-identical to our snapshot) →
3. our build (757 directed + 142 related pairs + 480 nodes: exact,
   re-derived independently twice) →
4. our display semantics (matches the original renderer's own algorithm;
   three documented conscious improvements, see DESIGN.md "Fidelity to the
   original renderer").

Zero construction errors at any layer.

## The 6.RP.A.3 finding, settled at the deepest layer

Zimba's own 2012 poster attaches the prerequisites to the SUB-ITEMS
(5.G.2 → 6.RP.3.a, 6.RP.1 → 6.RP.3.a, 6.RP.2 → 6.RP.3.b/c/d) and gives the
parent 6.RP.3 only outgoing edges. The "parent looks disconnected from
below" pattern is inherited from Zimba himself, not introduced by AtC or by
this app. Our family roll-up (every parent shows the union of its own and
its children's connections at focus time) presents that wiring the way both
Zimba's poster and the AtC site visually do, without altering an edge.

## How Achieve the Core evolved Zimba's 2012 wiring

- Added the entire HIGH SCHOOL layer: the 2012 poster is K-8 only; all 163
  HS standards and their edges are AtC constructions.
- Densified select K-8 bridges, most clearly multiplication/division into
  fraction operations (3.OA/4.OA → 5.NF.3/5/6).
- Re-grained a few attachments (e.g. 3.MD.7.b and 4.NF.4 now land on parent
  5.NF.4 rather than sub-item 5.NF.4.a).
- Pruned much of Zimba's denser related-standards web, and re-encoded a few
  directed links as related pairs (5.NF.5 with 5.NF.6).
- About seven K-8 directed edges Zimba drew do not appear in AtC (e.g.
  K.CC.1 → K.CC.2, 4.OA.1 → 4.OA.2, 4.NF.5 → 4.NF.6). These are provenance
  history, not defects: data.js is this app's declared source of truth, and
  AtC's edits are its editors' curation of a living document.
- Zimba's poster merges a few boxes (K.G.1,2 · K.G.3,4 · 4.NF.3.a-c), his
  own stated grain-size unevenness; apparent edge differences at those boxes
  are artifacts of the merge, not disagreements.

## Standing caution

Both Zimba and AtC frame the wiring as contestable expert judgment, not
measurement (the in-app provenance line under the title says so). Edge-level
differences between the 2012 poster and today's AtC data are exactly the
kind of evolution Zimba invited ("something that can evolve under anyone's
intelligent direction").
