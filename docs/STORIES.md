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
   the fraction gate closes: 241 descendants of 3.NF go dim.
3. Card: the percentages look similar; the years of compounding and the
   spine they sit on do not. An early gap is not "the same gap, earlier."
   It is a different, larger thing.
4. Honesty card (the structure is not the whole story): in the real
   pandemic data, middle schoolers' recovery stalled worst — 8th graders
   needed roughly nine extra months of math instruction while 3rd and 4th
   graders returned to pre-pandemic growth (Lewis & Kuhfeld 2023, NWEA).
   Structure says early gaps reach further; recovery also depends on how
   much runway and intervention a student has left. Both things are true,
   and both are reasons this work is hard.

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
   (story 3's move) shown alongside. Card: students who got grade-level
   work grew more, especially those who started behind. [cite]

### 5. It starts with counting
Reverse time-lapse, the empathy piece for early educators.
1. Focus HS modeling/functions, map at rest. Card: ask anyone which teacher
   does the most advanced work in the district.
2. Lapse backward, grade by grade, ancestry accumulating, until only
   Kindergarten remains lit: K.CC's ten counting standards. Card: 234
   standards — 49% of everything on this map — descend from a kindergartner
   learning to count. [cite Duncan early math]
3. Card: there is no such thing as "just" teaching counting.

### 6. Find where it begins (the diagnostic move — also a tour stop)
Short, practical, teacher-facing. Focus a struggling student's standard
(7.RP.A.2), then step the Builds-on chain backward one hop at a time,
camera following, card narrating the move: "keep walking back until you
reach the last thing they CAN do. That is where teaching starts. Not at
the grade label — at the gap." Ends by opening the real panel so the viewer
can do it themselves on any standard. (Tour keeps the 60-second version;
the story is the full walk.)

## Verified citation ledger (frozen 2026-07-16)
- Pandemic loss: math fell 0.20-0.27 SD vs 0.09-0.18 reading, grades 3-8
  (Kuhfeld, Soland & Lewis 2022, Educational Researcher 51(7)). Recovery:
  ~0.17 SD still missing in 2025; middle school stalled worst, 8th graders
  ~9.1 extra months needed (Lewis & Kuhfeld 2023, NWEA; Kuhfeld & Lewis
  2025, Brookings). Never mix instruments (NWEA/NAEP) on one card.
- Opportunity myth: 26% of assignments grade-appropriate; students met the
  bar on assigned work 71% of the time but showed grade-level mastery on
  17%; 500+ hours/year on below-grade work; behind-students given
  grade-level work gained ~7 months (TNTP 2018, The Opportunity Myth;
  descriptive study, association not RCT). Do NOT use the 56% stat as the
  topline — it is the students-of-color-on-grade-level-work success rate
  (vs 65% white peers), an equity comparison.
- Fractions gate: grade 5 fraction/division knowledge uniquely predicts HS
  algebra and overall math 5-6 years later in US and UK samples, controls
  incl. IQ, SES, whole-number arithmetic — which did NOT uniquely predict
  (Siegler et al. 2012, Psychological Science 23(7)).
- Early math: school-entry math skills are the strongest predictor of later
  achievement, above reading and attention, across six longitudinal
  datasets (Duncan et al. 2007, Developmental Psychology 43(6), corrected
  2010).
- Mastery/swiss cheese: 1:1 mastery tutoring ~2 SD (Bloom 1984, the 2 Sigma
  paper — small studies, aspirational benchmark); scalable mastery-learning
  programs ~0.52 SD across 108 studies (Kulik, Kulik & Bangert-Drowns 1990).
  Never present 2 sigma as mastery learning's classroom effect.

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
