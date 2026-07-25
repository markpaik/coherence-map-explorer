# Edge-provenance audit: how every standard earns its connections

The two-stage focus ladder rests on one structural fact: every one of the 480
standards resolves to a meaningful set of connections, and exactly two of them
are genuinely isolated. This audit records the classification, the rule that
produces it, and the build-time check that keeps it true.

`scripts/build-graph.ts` runs `auditEdgeProvenance(core)` on every build. It
recomputes the four classes from the emitted graph (nodes plus drawn edges) and
hard-fails if the classes do not sum to the node count, if any standard lands in
no class, or if any count drifts from the numbers below. It changes no emitted
data; positions, edges, and shards stay byte-identical.

## The rule

Only DIRECT edges are ever drawn. The pipeline emits the 757 prerequisite edges
and 142 related pairs verbatim from Achieve the Core's data; it fabricates none.
Two connection semantics run at focus time and never add a drawn edge:

1. **Family roll-up.** A parent standard (one with sub-standards) presents as a
   single card. An arrow into any sub-standard reads as an arrow into the parent,
   so the parent's connections are its own plus each child's, with
   family-internal members removed. `rollUpFamily` in `src/state/machine.ts`.
2. **Child inheritance.** A sub-standard that owns no edge of its own, whose
   family carries the map's edges, inherits the family's rolled-up connections
   (family-internal members excluded), so it is never a dead end.
   `resolveConnections` wraps `rollUpFamily` with this case.

Both are focus-time reads of the same drawn edges. Neither duplicates an edge in
the graph. `resolveConnections` is the single resolver the 3D panel
(`machine.computeModel`) and mobile Browse (`renderConnections`) both route
through, so the two surfaces cannot drift.

## The classification (480 standards)

| Class | Count | Definition |
|---|---|---|
| Direct | 406 | Owns at least one drawn edge (builds-on / leads-to / related). |
| Edgeless parent | 13 | Owns no edge; its sub-standards carry the connections (rolls up). |
| Edgeless child | 59 | Owns no edge; its parent/family carries the connections (inherits). |
| Solo | 2 | Owns no edge, and no family carries any: genuinely isolated. |

13 + 59 + 2 = 74, the "isolated nodes" (degree 0) the pipeline reports.

### The 13 edgeless parents

`3.MD.C.7, 4.NF.B.3, 5.MD.C.5, 6.NS.C.6, 6.NS.C.7, 7.NS.A.1, A-REI.B.4,
A-SSE.B.3, F-BF.A.1, F-IF.C.7, F-IF.C.8, K.CC.B.4, S-ID.B.6`

Each owns zero edges while its sub-standards hold the real lineage. Example:
`4.NF.B.3` has no edges of its own; its `.a`-`.d` carry builds-on
(`1.OA.B.3`, `2.OA.A.1`, `3.NF.A.1`, `4.NF.A.1`, and more), leads-to
(`4.MD.A.2`, `4.NF.C.5`, `5.NF.A.1`), and related (`4.MD.A.2`, `4.MD.B.4`).

### The 59 edgeless children (examples)

`4.MD.C.5.a`, `4.MD.C.5.b`, `1.NBT.B.2.a-c`, `3.NF.A.2.a-b`, `3.NF.A.3.a-d`, and
54 more. Example: `4.MD.C.5.b` owns no edge; its family standard `4.MD.C.5`
carries leads-to (`4.MD.C.6`, `4.MD.C.7`, `G-CO.A.1`) and related
(`4.G.A.1`, `4.G.A.2`), which `4.MD.C.5.b` inherits. The panel and Browse show
those connections under a note ("These connections are mapped on 4.MD.C.5. This
sub-standard is part of that family.") with a Family group linking the parent
first, then the siblings.

A sub-standard that owns any edge does NOT inherit. `6.RP.A.3.a` carries its own
connections and keeps exactly them; inheritance triggers only when a
sub-standard's own builds-on, leads-to, and related sets are all empty.

### The 2 solo standards

`3.MD.A.1`, `K.CC.A.3`. No edges, no sub-standards, no connected family. These
are the only standards for which "No mapped connections." is now literally true.
