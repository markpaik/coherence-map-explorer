# Ascent altitude: the family roll-up

The Ascent (pose B) sets each standard's altitude from `depthById`, the longest
prerequisite chain beneath it. That base rule reads the graph literally, and the
graph attaches many families' prerequisites to the SUB-standards, not the
parent. So whole families landed at the wrong height. This is the altitude
counterpart of the connections roll-up already documented in
`provenance-zimba-2012.md` (a parent shows the union of its own and its
children's connections) — the same convention, now applied to elevation.

Fixed in `scripts/build-graph.ts`, in the `depthById` block, immediately after
the base longest-chain DP so every downstream consumer reads final altitudes.

## The defect, both directions

The base DP mis-placed families two ways, both because an edge sits on a
family member other than the one being ranked.

- **Umbrella parents on the floor.** A parent whose prerequisites live on its
  sub-standards (F-BF.A.1, whose children reach depth 23) has no incoming edge
  of its own, so the DP left it at depth 0 — the massif floor, reading as a
  foundation. 18 of the 40 code-parents sat below their deepest child.
- **Sub-standards below their umbrella.** The mirror: an elaboration
  sub-standard with no prerequisites of its own (F-LE.A.1.a/.b/.c) fell to the
  floor while its umbrella parent (F-LE.A.1, depth 23) sat high. 57
  sub-standards floated below their parent's own structural depth, every one of
  them at depth 0.

## The rule

A family rides together. After the base DP, run one monotone fixpoint:

1. **Parent floor** — a parent sits at least as high as its highest child.
2. **Child floor** — a sub-standard sits at least as high as its parent's
   OWN-edge base depth. Use the parent's base altitude BEFORE roll-up, never the
   rolled value: a genuinely shallow sub-standard under an *edgeless* parent
   (8.EE.C.7.a, 7.NS.A.2.b, K.CC.B.4.a/.c, S-ID.B.6.a — parent base 0) keeps its
   real depth instead of being flattened up to the family peak.
3. **Edge monotonicity** — re-propagate every lift down the prereq DAG so each
   standard still rests strictly above everything it builds on.

All three are lower-bound (max) constraints, so the system is monotone and its
least fixpoint is unique — independent of iteration order, hence deterministic
and byte-identical across builds. Depths only increase and are bounded by the
DAG's longest path, so it converges in a few rounds. Two invariants are asserted
in-script and hard-fail the build: every prereq edge points strictly upward, and
every parent sits at or above its highest child.

## What moved

92 standards changed altitude: 20 parents lifted by the parent floor, 61 in the
child bucket (55 edgeless sub-standards lifted to their family altitude, 6 that
also rode up on re-propagation), and 11 downstream dependents carried up by the
edge re-propagation (the deepest, A-APR.B.3 and N-CN.C.9, from 23 to 25). The
massif keeps its height: the deepest CCSS chain is untouched, so the maximum
depth stays 30 and the layers stay contiguous 0..30 (the isoline contours are
unchanged in count and cadence).

## Per-consumer decisions

`depthById` and the emitted `depth` field drive several derivations. All take
the rolled depth — none needs the raw structural depth, and consistency is the
point.

- **Ascent y (`pos2`)** — the fix itself. Rolled.
- **Ascent depth-layer x-relaxation** — partitions nodes by depth to relax
  horizontal spread. Must match the altitude it relaxes, so rolled. The massif
  floor decongested from 119 nodes to 44 as the mis-placed umbrellas lifted off;
  the tightest nearest-neighbour in the whole Ascent is unchanged (0.74 at depth
  16, 6.EE.A.3~6.EE.A.4 — a pre-existing pair, not roll-up-caused).
- **Isoline contours** (`src/scene/contours.ts`) — draw one line per depth at
  that depth's shared pos2 y. Must match `pos2`, so rolled.
- **Client pose stagger** (`src/scene/pose.ts`) — foundations animate first
  into the Ascent, the summit first out. Rolled puts a lifted umbrella with its
  new altitude, which is correct.
- **Transit within-column depth band** (`pos4`) — spreads stations horizontally
  by build depth so a dense course reads as a band. Rolled, so the two
  structured poses rhyme. Front-on x shifted for 123 stations; y and z
  unchanged (the barycenter rows and line levels are independent of depth). The
  `transit-xy-baseline.json` golden was regenerated for this.

Blueprint (`pos3`) does not read `depthById` and did not change.
