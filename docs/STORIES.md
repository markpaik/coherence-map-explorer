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
      strong: [sel],    // selectors: codes, grades ("grade:3"), strands,
      missed: [sel],    //   domain ("domain:3.NF"), ancestry("code")/
      damage: true,     //   descendants("code")
      spotlight: [sel]  // aVisible ghosting for everything else
    },
    camera: { fit: sel | "all", offset?: bool },
    card: { title, body, cite? },
    holdMs, transition: "lapse" | "cut"
  }] }
```

Engine (src/stories/player.ts): drives the state machine (new state
`storying`), one scene at a time. Timeline scrubber bottom-center: year ticks,
play/pause, ArrowLeft/Right stepping, progress dots, Esc exits. Cards render
bottom-left (glass, kicker + title + 2-3 sentence body + small citation
line), never covering the focused region; card text is the aria-live source.
Reduced motion: no lapse animation; each scene is a cut, user steps manually.
"lapse" transition = 1.4s eased crossfade of graph state + camera drift; the
year label rolls like an odometer.

## Visual vocabulary (shader additions)

Extends the emphasis system with a per-node damage scalar (new instanced
float `aDamage` on nodes; edges inherit max of endpoints):

| State | Look |
|---|---|
| strong / learned | rest brightness, full saturation |
| missed (damage = 1) | near-dark husk: 0.25 brightness, desaturated 80%, slow ember pulse in deep red-amber `#4a1f14` -> `#7a3520` |
| challenged (0 < damage < 1) | brightness and saturation lerp toward husk by damage; a faint irregular flicker (per-node phase, amplitude ∝ damage) reads as "struggling, not dead" |
| unaffected | untouched rest state; in contrast with damage around it, it reads as hopeful |

Damage never uses the strand hues for the ember (colorblind-safe: ember is a
luminance+shape change, not only a hue change; flicker is the secondary
encoding).

## Impact model (the honest math)

Structural exposure, not a learning model, and one card per story says so
plainly ("The map shows what the work stands on, not what any child can or
cannot do").

- missed set M (selected standards/grades)
- for any standard v with ancestor set A(v):
  damage(v) = |A(v) ∩ M| / |A(v)| if A(v) nonempty, else 0
- missed standards: damage 1. Fully-blocked flag when every direct
  prerequisite is missed.
- computed client-side (BFS over the 757-edge DAG, trivial at 480 nodes),
  shared by stories AND the interactive Gap simulator ("Gaps" mode: click to
  toggle missed standards/grades yourself; same shading live).

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

### 2. Third grade vs eighth grade (Mark's hypothesis)
Side-by-side scenario toggling, same student, two different lost years.
1. Miss grade 8: 112 of the 163 standards ahead are challenged, but HS
   statistics barely notices (7 of 27 challenged; 74% clear) and the runway
   is one school stage. 
2. Miss grade 3: 271 standards challenged across seven years of runway, and
   the fraction gate closes: 240 descendants of 3.NF go dim.
3. Card: the percentages look similar; the years of compounding and the
   spine they sit on do not. An early gap is not "the same gap, earlier."
   It is a different, larger thing.
4. Honesty card (the structure is not the whole story): NWEA's own
   analysis of recovery, a technical report rather than peer-reviewed
   research, finds middle schoolers' recovery stalled worst, with 8th
   graders needing months more instruction while 3rd and 4th graders
   returned to pre-pandemic growth (Lewis & Kuhfeld 2023, NWEA technical
   report). Structure says early gaps reach further; recovery also
   depends on how much runway and intervention a student has left. Both
   things can be true, and both are reasons this work is hard.

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
1. A fifth grader one year behind (grade-4 band flickering). Camera sits
   with them at grade 4 while the grade-5 band literally drifts past,
   spotlit then fading to ghost, unvisited. Card: the most common response
   to being behind is a year of review. Watch what passes by while it
   happens. [cite TNTP hours below grade level]
2. Next fall: now the ghosted grade-5 band ALSO reads as missed; damage
   spreads further than the original gap. Card: remediation that replaces
   grade-level content manufactures the next year's gap. [cite TNTP
   grade-level success stat]
3. The alternative: grade-5 band bright WITH targeted husk-filling
   (story 3's move) shown alongside. Card: in TNTP's observational data,
   students who got more grade-level work grew more, and those who
   started behind gained about seven months relative to peers. Stated as
   an association from a descriptive study, not a proven cause; the
   peer-reviewed opportunity-to-learn literature (Schmidt et al. 2015)
   supports the mechanism internationally.

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
Short, practical, teacher-facing. Focus a struggling student's standard
(7.RP.A.2), then step the Builds-on chain backward one hop at a time,
camera following, card narrating the move: "keep walking back until you
reach the last thing they CAN do. That is where teaching starts. Not at
the grade label — at the gap." Ends by opening the real panel so the viewer
can do it themselves on any standard. (Tour keeps the 60-second version;
the story is the full walk.)

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

**2. Third grade vs eighth grade**
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
  is mixed rather than uniformly supportive. Scene 3's claim should stay
  attributed to TNTP alone and flagged as correlational/descriptive on the
  card.

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
1. Engine + damage shader states + Gaps mode (Opus build, precise spec) —
   the impact model is shared infrastructure.
2. Story scripts + card copy (Fable — copy is design).
3. Citation freeze after the research brief lands; every [cite] resolved or
   the claim is cut.
4. Stories verified in-browser scene by scene before the test fleet probes
   them.
