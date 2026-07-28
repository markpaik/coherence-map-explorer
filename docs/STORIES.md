# Stories: design spec

North star (Mark): "build empathy and appreciation for the complexities of
teaching and learning." Stories are time-lapsed narratives played over the
constellation, each explained by story cards. They are not features; they are
arguments made visible. Every claim a card makes must be true in the graph
(numbers below are computed from the actual data) or carry a verified
citation. One design principle guards the tone: the map shows the mountain,
never fatalism. Teachers bridge these gaps every day; the stories exist so
viewers appreciate how steep the climb is, not to declare students doomed.

## Entry

A "Stories" ghost button beside "Show me around". Opens a picker card listing
each story: kicker, title, one-line hook, duration (~60-90s each). Escape
exits any story cleanly to idle.

## Playback engine

A story is a JSON script (src/stories/*.json) of scenes:

```
{ id, kicker, title, hook,
  scenes: [{
    year,               // timeline label: "2019", "Grade 3", etc.
    state: {            // graph state, all optional
      lit: [sel],       // the ON set; everything else ghosts dark
      missed: [sel],    // selectors: codes, grades ("grade:3"), strands,
      damage: true,     //   domain ("domain:3.NF"), ancestry("code")/
      focus: code       //   descendants("code")
    },
    reveal: { dir: "ltr" | "rtl", ms? },  // directional turn-on sweep
    camera: { fit: sel | "all",       // the lit CONTEXT
              spine?: [sel],          // what the camera actually frames
              pose?: 0 | 1 | 2 },
    card: { title, body, cite? },
    holdMs, transition: "lapse" | "cut"
  }] }
```

## The design law (from the pandemic story)

"The year that vanished" is the story that works, and the reason is
structural, so every other story is held to it:

1. **The lit set is monotone.** It only grows, one grade band per scene, left
   to right. The reader never has to re-orient, because nothing they were
   just looking at goes away.
2. **The camera leads half a step ahead of the lit frontier.** It frames the
   band the card is about to talk about, not the band that just finished.
3. **One idea per scene.** If the card needs two sentences to say what
   changed, the scene is doing two things.
4. **The glow may bleed past the frame.** Light spilling off the edge is the
   argument (the damage keeps travelling); it is not a framing error.

`camera.spine` is rule 2 in one field: the camera frames the SPINE (the
handful of standards the card names) while `camera.fit` keeps naming the lit
context. Fits resolving to more than eight standards are sized by a
**trimmed** bounding sphere (`trimmedBoundingSphere`, state/machine.ts) which
drops the farthest 10% before measuring, so one isolated halo-ring standard
on the far edge cannot double the radius and shrink the subject to dust.

Exceptions are declared by name, with a reason, in
`tests/story-framing.test.ts` (the monotone-lit law is enforced there, and
the pandemic story needs no exception at all).

The story card is a known occluder, so playback biases the framed subject
into the region it leaves clear: on desktop the card sits bottom-left, so the
subject rides RIGHT by half the card's right edge (`rig.setFrameShiftPx`, the
exact mirror of the panel-aware offset the machine already applies for the
right-side panel) and up by a quarter of the card's vertical footprint. On
phones the card is bottom-full-width, so the bias is upward only.

## Entering and leaving a story

A story must BEGIN from a clean dark baseline no matter what preceded it: an
open detail panel, a half-run focus cascade, a mid-trace journey, a hovered
node, an open search dropdown. Entry and exit therefore run the SAME
borrowed-surface list (`resetStorySurfaces`, stories/player.ts), so a surface
can never be restored in one direction only. `machine.clearFocus()` is a
no-op when nothing is focused, which is exactly why the emphasis reset, the
panel hide, and the search dismiss are unconditional and separate from it.
The list is asserted complete in `tests/story-reset.test.ts`.

Exit is synchronous for all state (hash, chrome, machine); only the closing
pose unravel is awaited, and only the backdrop waits on it.

Engine (src/stories/player.ts): drives the state machine (new state
`storying`), one scene at a time. Timeline scrubber bottom-center: year ticks,
pause/resume, ArrowLeft/Right stepping, progress dots, Esc exits. Cards render
bottom-left (glass, kicker + title + 2-3 sentence body + small citation
line), never covering the focused region; card text is the aria-live source.

Pacing: scenes AUTO-ADVANCE after their holdMs (scripts.ts) once the
transition settles, with the active dot filling to show the countdown; Next
skips ahead instantly, Back returns, pause stops the clock. The tour uses the
same mechanism (8s per stop). Reduced motion: each scene is a cut and the
countdown still runs; the motion is cut, never the timing.

Atmosphere: during a scene hold the idle ethereal drift breathes (the same
±18° oscillation as the untouched landing); it pauses during transitions and
resumes on settle, so the map never feels frozen mid-story.

Every story follows the cinematic arc: zoom into the world before, the
event, pan across the immediate spread, the compounding, the long-term wide
shot, and a coda that hands agency back to the viewer (5-7 scenes each).

## Visual vocabulary (shader additions)

Extends the emphasis system with a per-node damage scalar (new instanced
float `aDamage` on nodes; edges inherit max of endpoints):

**Dark baseline (grammar v3).** While a story runs, every node and edge
defaults to the ghost state the filters use (dark shrunken speck, 0.06-alpha
filament). Each scene declares an explicit `lit` set — those turn ON — and an
optional `reveal` sweeps the turn-on across grade columns (`ltr` lights early
grades first, `rtl` lights late grades first) instead of landing all at once.
Off, dim, and on are the whole vocabulary; contrast carries the story.

| State | Look |
|---|---|
| lit / learned | story lift: chain-level brightness (×1.9 floor under the shimmer, `max()` so emphasis never stacks); bright strand tones cross the bloom threshold and halo; prereq edges between lit nodes glow with directional flow comets |
| unlit (outside the scene's `lit` set) | ghost: dark speck, 0.06-alpha edge filament, no glow, no comets |
| missed (damage = 1) | OFF: a near-black body holding its place (`#1c0b07` -> `#38180e` slow pulse, only bright enough to find the wound), full size, never blooms |
| challenged (0 < damage < 1) | dims toward the husk by damage, with a faint irregular flicker (per-node phase, peaks at damage 0.5) that reads as "struggling, not dead"; the story lift dies by damage ≈ 0.7 |

Damage composes WITHIN the lit set: a scene lights the years that happened,
and the missed standards inside them go dark against that light. Both the
node lift and the edge glow are gated by the lit mask, so nothing outside
the story's frame competes for the eye.

Damage never uses the strand hues for the ember (colorblind-safe: ember is a
luminance+shape change, not only a hue change; flicker is the secondary
encoding).

### Three display laws (round 13, after the visual audit)

The audit measured what the engine's honest numbers look like on screen and
found three places where the frame did not say what the card said. All three
fixes are DISPLAY-side; `damage.ts` is untouched and every number a card
quotes still comes from it.

1. **The display floor.** A scene's damage is shown through the monotone ramp
   `d ↦ 0.35 + 0.65·d` (`displayDamage`, stories/contagion.ts), so a standard
   that stands on ANYTHING missing always lands past the point where the story
   lift dies — unmistakably dimmer than a healthy neighbour — while the real
   gradient (0.06 → 0.67 on a lost year) keeps its order and a missed standard
   still lands exactly on 1. Before it, a three-hole story's exposure ran
   0.01–0.09, a brightness change of a fraction of a percent: three cards
   described a dimness that was not on screen. The interactive "lose a year"
   story has floored its display values this way since round 7; this is the
   same law, applied to the authored scenes.
2. **The lit mask owns damage too.** Damage is pushed through the scene's lit
   amount, so a ghost carries no ember, no dimming, and no ring. (The pandemic
   story used to ring 257 unlit standards in its March-2020 frame, brightest of
   them a grade-4 cluster whose own card says those years "have not happened
   yet".) During a directional reveal the damage arrives exactly as the light
   does, never ahead of it.
3. **Rings are relative, masked, and weighted.** Every hole rings at full
   strength; downstream exposure rings only in the top 40% of the scene's OWN
   damage distribution (`sceneRingTargets`), because no absolute floor can
   serve both a lost year and a lost cluster. Ring intensity drives brightness,
   alpha AND width, so a hole is plainly heavier than a d ≈ 0.2 descendant —
   which is what the swiss-cheese card claims in words. The Galaxy ring sits
   BELOW the bloom threshold (damage never glows — DESIGN.md), and it holds a
   minimum on-screen radius so the dark core stays visible inside it at a wide
   framing: a missing standard is never the brightest thing in the frame.

## Impact model (the honest math)

Structural exposure, not a learning model, and one card per story says so
plainly ("The map shows what the work stands on, not what any child can or
cannot do").

One model: **structural exposure**. For standard v with ancestor set A(v),
damage(v) = |A(v) ∩ M| / |A(v)|; missed = 1. Cards quantify this model
(271 damaged, and so on): how much of a standard's foundation is gone.
Computed client-side over the 757-edge DAG.

(An interactive "Gaps" simulator with a hop-decay variant shipped briefly
and was removed in July 2026: the stories carry the same argument with
narration and evidence, and the standalone tool diluted them.)

Damage look distinguishes outage from struggle: a dead node (damage ≈ 1) is
a steady dark ember with a slow pulse; a half-damaged node visibly wavers
(flicker amplitude peaks at damage 0.5 and vanishes at both ends); a
lightly-touched node barely trembles.

## The stories

Numbers below are computed from the graph (this repo, seed 1337 build).
Citations marked [cite] are being verified against primary sources before
copy freezes.

### 1. The year that vanished (pandemic)
Timeline 2019 -> 2025. A third grader in fall 2019.
1. "2019 · Grade 3" — K-2 lit strong, rest of map at rest. Card: a student
   who loves math class, on track, nine fraction standards ahead of them in
   the spring curriculum.
2. "2020 · The interruption" — grade 3 band goes to husks (37 standards,
   including all 9 fraction foundations). Card: schools closed in March.
   What was missed did not announce itself. [cite NWEA math loss]
3. "2021 · Grade 4" — damage propagates: 4.NF flickers hard (its ancestry
   runs through 3.NF), while grade-4 geometry and measurement stay bright.
   Card: the cruel asymmetry — new content lands fine where it stands on
   its own, and struggles exactly where it stands on last year.
4. "2022-2024 · The compounding" — lapse through grades 5-7: the challenge
   flows down the number -> ratio -> algebra spine. 271 of the 366 standards
   ahead of grade 3 carry broken ancestry (74%); 95 stay untouched.
5. "Today · High school ahead" — camera pulls to HS: even F-IF.A.1 (the
   concept of a function) carries the scar; 135 HS standards descend from
   grade-3 fractions alone. Card: recovery is not reteaching one year; it is
   rebuilding the floor under six. [cite recovery status]
6. Coda — full map at rest. Card: teachers do this rebuilding every day,
   student by student. The map is why it is hard, not why it is hopeless.

### 2. Third grade vs eighth grade — CUT (2026-07)
Retired. Its argument was the pandemic story's argument told twice (lose a
year, watch the structure spread it), its "miss grade 3" scene lit the same
271 standards the pandemic story already lights, and its honesty coda
repeated the same NWEA technical-report caveat. Removing it makes the suite
five distinct arguments instead of six overlapping ones.

The NWEA differential-recovery caveat it carried is preserved in the
citation ledger below, under the same heading, because the gap it documents
(no peer-reviewed source supports that specific claim) still governs any
future story that wants to make it.

Story ids are public URLs, so `#/story/third-vs-eighth` keeps arriving.
main.ts resolves a deep-linked id through `findStory` and, on a miss, drops
the orphaned hash and lands the reader on the plain map.

### 3. Swiss cheese (after Sal Khan)
One student, three silent holes: 3.OA.A.2 (division as sharing), 4.NF.B.4
(multiplying fractions), 6.RP.A.2 (unit rate).
1. Map at rest, three husks barely visible among 480 lit standards. Card:
   report cards said "meets expectations." Three standards out of hundreds;
   nobody noticed, including the student.
2. "Grade 7 arrives" — focus 7.RP.A.2, its 75-standard ancestry lights;
   the three holes glow ember at the heart of it; damage shading shows the
   convergence. Card: proportional reasoning stands on 75 earlier standards.
   Three holes is all it takes for the floor to feel like it is tilting.
3. The remediation move: trace-back lights ONLY the three husks. Card:
   this is the promise of seeing the structure — not re-teaching three
   years, but finding and filling three holes. [cite Bloom / mastery]

### 4. The opportunity myth (after TNTP)
Rebuilt 2026-07 to the design law above. The prior cut ping-ponged K-4 → 4 →
4+5 → K-8 → 6-8 → mix and read as complex; this one follows ONE student
through ONE missing cluster, monotone, left to right. Six scenes:

1. "Grade 4, September" — grade 4 alone, lit ltr. The fractions year, 37
   standards, and everything ahead assumes them.
2. "October through January" — grade 3 joins, revealed RTL. The one
   deliberate backward look in the suite: the year regressing into review.
   [cite TNTP hours below grade level]
3. "The same year" — the nine standards of 4.NF.B go to husks inside the lit
   band (damage off: no downstream yet). The cluster dims quietly. Camera
   spines onto the cluster.
4. "Grade 5" — grade 5 joins; damage on. 5.NF stands directly on the cluster
   that never arrived.
5. "Grades 6 through 8" — the band grows to grade 8, the dimness travels.
6. "The other version" — heal ltr with the cluster spotlit. Card: TNTP's
   finding cuts both ways; students given grade-level work rose to it more
   often than not. Association from a descriptive study, labeled as such.

The 4.NF.B cluster is hardcoded as nine `code:` selectors (the selector
grammar has no `cluster:` form and `domain:4.NF` would sweep 4.NF.A and
4.NF.C in with it). `tests/story-framing.test.ts` asserts the list still
matches the live graph, so a data rebuild cannot leave it silently stale.

Note for the ledger: the rebuild moved the Schmidt et al. (2015) card from
the old scene 4 to "Compound interest" (scene 5), where the
opportunity-to-learn evidence is the mechanism the card describes. Schmidt
remains the story's peer-reviewed anchor, on screen and in the ledger below.

### 5. It starts with counting
Reverse time-lapse, the empathy piece for early educators.
1. Focus HS modeling/functions, map at rest. Card: ask anyone which teacher
   does the most advanced work in the district.
2. Lapse backward, grade by grade, ancestry accumulating, until only
   Kindergarten remains lit: K.CC's ten counting standards. Card: 225
   standards, 47% of everything on this map, descend from one Kindergarten
   standard: counting to 100. [cite Duncan early math]
3. Card: there is no such thing as "just" teaching counting.

### 6. Find where it begins (the diagnostic move — also a tour stop)
Short, practical, teacher-facing. Focus a struggling student's standard,
then step the Builds-on chain backward one hop at a time, camera following,
card narrating the move: "keep walking back until you reach the last thing
they CAN do. That is where teaching starts. Not at the grade label — at the
gap." Ends by handing the move to the viewer for any standard. (Tour keeps
the 60-second version; the story is the full walk.)

**Re-anchored 2026-07 from 7.RP.A.2 to 8.EE.C.7** (solve linear equations in
one variable). Proportional reasoning was already the climax of Swiss
cheese, and two stories converging on one standard read as repetition.
Linear equations is the better diagnostic subject anyway: its chain bottoms
out in FIRST grade, seven school years below the label on the struggle,
which is the story's whole argument stated harder.

The walk back, every rung real and mostly one direct prerequisite edge:

```
8.EE.C.7  (grade 8, solve linear equations in one variable)
  ← 7.EE.B.4.a  solve word problems leading to px + q = r
  ← 6.EE.B.7    solve x + p = q and px = q
  ← 5.NF.A.1    add and subtract fractions with unlike denominators
  ⋯ 1.OA.D.7    understand the meaning of the equal sign   ← solid ground
```

That the fraction gate turns up load-bearing under linear equations is not a
convenience; it is what the graph says, and it keeps Siegler et al. (2012)
carrying the card it always carried.

**Engine note.** 8.EE.C.7 is a PARTIAL parent: it has zero direct
prerequisites of its own and carries all 119 on its sub-standard 8.EE.C.7.b,
so a bare `ancestry:8.EE.C.7` resolves to one lonely node. The story uses a
new selector, `family-ancestry:CODE`, which seeds the closure from the whole
family — exactly what the machine lights when a reader CLICKS that standard
(`rollUpFamily`, state/machine.ts), so the story and the app finally agree.
It is a separate selector, NOT a change to `ancestry:`, because several
stories quote ancestry counts as frozen copy (7.RP.A.2's "75 earlier ones"
would have silently become a different number). 19 of the 40 parent
standards in this graph are partial in the same way.

## Citation ledger (peer-reviewed, linked)

Rule for this ledger: every number on a story card must be carried by a
peer-reviewed journal source. Where a well-known named source is not
peer-reviewed (TNTP, Adelman, Khan), it stays only as the story's cultural
hook, labeled as such below, and a journal source carries the empirical
weight. All DOIs below were fetched and confirmed resolving to the correct
publisher record on 2026-07-16 (via doi.org redirect and Crossref metadata).

**1. The year that vanished (pandemic)**
- Kuhfeld, M., Soland, J., & Lewis, K. (2022). Test Score Patterns Across
  Three COVID-19-Impacted School Years. *Educational Researcher*, 51(7),
  500-506. https://doi.org/10.3102/0013189X221109178
  Supports: the scene 2 numbers. Math fell 0.20-0.27 SD and reading fell
  0.09-0.18 SD, grades 3-8, fall 2021 vs. fall 2019 (5.4 million US
  students).
- Betthäuser, B. A., Bach-Mortensen, A. M., & Engzell, P. (2023). A
  systematic review and meta-analysis of the evidence on learning during
  the COVID-19 pandemic. *Nature Human Behaviour*, 7(3), 375-385.
  https://doi.org/10.1038/s41562-022-01506-4
  Supports: the strongest single pandemic anchor. Pooled effect (Cohen's
  d = -0.14, 95% CI -0.17 to -0.10) across 42 studies in 15 countries
  implies students lost about 35% of a normal school year's worth of
  learning; deficits were larger in math than reading, larger for
  low-SES children, and persisted rather than closing on their own.
  Backs scene 2's "what was missed did not announce itself."
  Guardrail carried over: never mix instruments (NWEA MAP, NAEP, national
  assessments) on one card; the two sources above use different ones.

**2. Third grade vs eighth grade** (story CUT 2026-07; this entry stays as
the standing verdict on the claim, for any future story tempted by it)
- No peer-reviewed article was found to support the honesty card's specific
  differential-recovery numbers (8th graders needing about nine more months
  of instruction while 3rd and 4th graders returned to pre-pandemic growth).
  That claim lives only in NWEA technical reports and research briefs
  (Lewis & Kuhfeld 2023; Kuhfeld & Lewis 2025, Brookings), neither
  peer-reviewed. The citation on that card should be relabeled "NWEA
  technical report, not peer-reviewed" and the wording softened from
  stated fact to "NWEA's own analysis finds..."
- Partial peer-reviewed context (does not cover the specific claim above):
  Kuhfeld, M., Soland, J., Lewis, K., Ruzek, E., & Johnson, A. (2022). The
  COVID-19 School Year: Learning and Recovery Across 2020-2021. *AERA
  Open*, 8. https://doi.org/10.1177/23328584221099306
  Supports only the general finding that pandemic-era math growth was more
  variable and gains concentrated among already-ahead students (4.9 million
  students, grades 3-8, one school year). It does not measure a multi-year
  grade-3-vs-grade-8 differential, so it should not be cited as backing
  that specific number.

**3. Swiss cheese (mastery)**
- Bloom, B. S. (1984). The 2 Sigma Problem: The Search for Methods of Group
  Instruction as Effective as One-to-One Tutoring. *Educational
  Researcher*, 13(6), 4-16. https://doi.org/10.3102/0013189X013006004
  Supports: the ~2 SD one-to-one mastery tutoring benchmark, an aspirational
  ceiling from small studies, not a classroom-scale claim.
- Kulik, C.-L. C., Kulik, J. A., & Bangert-Drowns, R. L. (1990).
  Effectiveness of Mastery Learning Programs: A Meta-Analysis. *Review of
  Educational Research*, 60(2), 265-299.
  https://doi.org/10.3102/00346543060002265
  Supports: the realistic, classroom-scale number for the remediation-move
  card. Mastery-learning programs raise scores about 0.52 SD on average
  across 108 controlled studies. This figure, not Bloom's 2 sigma, should
  carry the "find and fill three holes" claim.
- Cultural hook (book, not peer-reviewed, hook only; empirical weight
  carried by Bloom 1984 and Kulik et al. 1990 above): Khan, S. (2012). *The
  One World Schoolhouse: Education Reimagined*. "Swiss Cheese Learning" is
  Khan's own coinage; it names the story and carries no independent
  empirical weight.

**4. The opportunity myth**
- Cultural hook (report, not peer-reviewed, hook only; empirical weight
  carried by Schmidt et al. 2015 below): TNTP. (2018). *The Opportunity
  Myth: What Students Can Show Us About How School Is Letting Them
  Down and How to Fix It*. Descriptive study of five school systems, about
  1,000 lessons and 5,000 assignments observed; an association, not a
  controlled experiment. Numbers verified against the report's executive
  summary and technical appendix: 26% of assignments were grade-appropriate
  on average; students met the demands of assigned work 71% of the time
  but showed grade-level mastery only 17% of the time; students spent 500+
  hours per year on below-grade work; behind-grade-level students given
  more grade-appropriate assignments closed gaps by more than 7 months
  (stronger instruction alone closed gaps by 6 months). The 56% vs. 65%
  figure is a within-grade-level-work success-rate comparison by student
  race (students of color vs. white students), not a topline statistic,
  and should stay labeled as such on the card.
- Schmidt, W. H., Burroughs, N. A., Zoido, P., & Houang, R. T. (2015). The
  Role of Schooling in Perpetuating Educational Inequality: An
  International Perspective. *Educational Researcher*, 44(7), 371-386.
  https://doi.org/10.3102/0013189X15603982
  Supports: the story's core mechanism. Opportunity to learn (OTL) is
  significantly related to math achievement across national systems (PISA
  2012), and roughly a third of the SES-to-achievement relationship runs
  through OTL. This is cross-national and correlational, so it backs the
  general "access to grade-level content matters" claim, not the specific
  US within-classroom numbers above.
  Gap: no peer-reviewed causal (RCT or quasi-experimental) study was found
  that directly confirms "students who got grade-level work grew more,
  especially those who started behind" for a US remediation setting; the
  causal tracking/acceleration literature (e.g., Algebra-for-all mandates)
  is mixed rather than uniformly supportive. The closing card's claim stays
  attributed to TNTP alone and flagged as correlational/descriptive.
  After the 2026-07 rebuild Schmidt no longer appears on a card (the cut
  that carried it was the one the rebuild replaced); it remains the
  peer-reviewed anchor for the story's mechanism and the source to reach for
  if the evidence returns to screen.

**5. It starts with counting**
- Duncan, G. J., Dowsett, C. J., Claessens, A., Magnuson, K., Huston, A.
  C., Klebanov, P., Pagani, L. S., Feinstein, L., Engel, M., Brooks-Gunn,
  J., Sexton, H., Duckworth, K., & Japel, C. (2007). School readiness and
  later achievement. *Developmental Psychology*, 43(6), 1428-1446.
  https://doi.org/10.1037/0012-1649.43.6.1428
  Correction: School readiness and later achievement: Correction to Duncan
  et al. (2007). *Developmental Psychology*, 44(1), 232.
  https://doi.org/10.1037/0012-1649.44.1.217
  Supports: school-entry math skills are the strongest predictor of later
  achievement, ahead of reading and attention skills, across six
  longitudinal datasets.
  Fact to fix: the correction notice ran in 2008, not 2010 as the prior
  ledger stated. The 2010 Developmental Psychology pieces are separate
  Canadian and French-Canadian replication studies, not the errata.
- Watts, T. W., Duncan, G. J., Siegler, R. S., & Davis-Kean, P. E. (2014).
  What's Past Is Prologue: Relations Between Early Mathematics Knowledge
  and High School Achievement. *Educational Researcher*, 43(7), 352-360.
  https://doi.org/10.3102/0013189X14553660
  Supports: preschool math ability (54 months) predicts math achievement
  through age 15; growth in math ability between 54 months and first grade
  is an even stronger predictor than the starting level. Good fit for "it
  starts with counting" framing the trajectory, not just the starting
  point.

**6. Find where it begins (gap diagnosis)**
No new citation is needed. This story dramatizes the same prerequisite-chain
logic already anchored by Siegler et al. (2012, fractions gate, below) and
the mastery-learning findings under story 3 (Bloom 1984; Kulik et al.
1990). It makes no additional empirical claim of its own.

**Gatekeeper candidate (course-taking; not yet assigned a story slot)**
- Cultural hook (federal report, not peer-reviewed, hook only; empirical
  weight carried by Long, Conger & Iatarola 2012 below): Adelman, C.
  (1999). *Answers in the Tool Box: Academic Intensity, Attendance
  Patterns, and Bachelor's Degree Attainment*. U.S. Department of
  Education. Revisited: Adelman, C. (2006). *The Toolbox Revisited: Paths
  to Degree Completion From High School Through College*. U.S. Department
  of Education. Both are correlational analyses of federal transcript and
  survey data.
- Long, M. C., Conger, D., & Iatarola, P. (2012). Effects of High School
  Course-Taking on Secondary and Postsecondary Success. *American
  Educational Research Journal*, 49(2), 285-322.
  https://doi.org/10.3102/0002831211431952
  Supports: rigorous course-taking, including advanced math, is associated
  with significantly better secondary and postsecondary outcomes, using
  propensity-score-matched, statewide administrative panel data (Florida),
  with effects often larger for disadvantaged students. A methodologically
  stronger complement to Adelman's correlational federal-transcript study
  for the same claim.

**Fractions gate (supports stories 1, 2, 3, and 5 wherever a 3.NF/fraction
prerequisite is the mechanism)**
- Siegler, R. S., Duncan, G. J., Davis-Kean, P. E., Duckworth, K.,
  Claessens, A., Engel, M., Susperreguy, M. I., & Chen, M. (2012). Early
  Predictors of High School Mathematics Achievement. *Psychological
  Science*, 23(7), 691-697. https://doi.org/10.1177/0956797612440101
  Supports: elementary fraction and division knowledge uniquely predicts
  high school algebra and overall math achievement 5-6 years later (US and
  UK samples), controlling for IQ, working memory, and SES; whole-number
  arithmetic knowledge did not uniquely predict. The load-bearing citation
  for every "fraction gate" claim across the stories.
- Bailey, D. H., Hoard, M. K., Nugent, L., & Geary, D. C. (2012).
  Competence with fractions predicts gains in mathematics achievement.
  *Journal of Experimental Child Psychology*, 113(3), 447-455.
  https://doi.org/10.1016/j.jecp.2012.06.004
  Supports: fraction competence predicts subsequent growth in achievement,
  not just concurrent level, reinforcing that fractions are a gate rather
  than just a correlate.

**Whole-number bias coda (for story 3 or 5's coda card)**
- Braithwaite, D. W., & Siegler, R. S. (2018). Developmental changes in the
  whole number bias. *Developmental Science*, 21(2), e12541.
  https://doi.org/10.1111/desc.12541
  Supports: whole-number bias (treating 1/5 as "bigger than" 1/4 by
  comparing numerators and denominators as whole numbers) decreases on
  average from grade 4 to grade 8, but a substantial minority of 8th
  graders still show it, and under speeded conditions it persists into
  adulthood, even among mathematicians. Precise wording for the card: not
  "everyone keeps this bias forever," but "even experts fall back on it
  under pressure, and plenty of 8th graders never fully lose it." That is
  more defensible than a blanket "persists into adulthood."

## Candidate additions (verified, Mark to green-light)
- ADOPT-RECOMMENDED — "The gatekeeper": highest math course completed
  (beyond Algebra II) is among the strongest predictors of bachelor's
  completion, stronger than class rank or test scores (Adelman 1999,
  Answers in the Tool Box; refined 2006). Maps perfectly onto the HS
  prereq chains; correlational, say so.
- Coda card for story 3 or 5 — whole-number bias (1/5 "bigger than" 1/4)
  persists into adulthood (Braithwaite & Siegler 2018, Developmental
  Science): "this is not a node you outgrow."
- SKIP for now — summer slide (Cooper 1996, ~2.6 months math loss) is
  classic but actively contested (von Hippel); a card would need a
  "debated" label, which dilutes trust in the other cards.
- The multiplicative wall (grades 3-5) — pedagogically rich; folds into
  story 3's hole selection rather than standing alone.

## Build plan
1. Engine + damage shader states (Opus build, precise spec) — the impact
   model is shared infrastructure.
2. Story scripts + card copy (Fable — copy is design).
3. Citation freeze after the research brief lands; every [cite] resolved or
   the claim is cut.
4. Stories verified in-browser scene by scene before the test fleet probes
   them.
