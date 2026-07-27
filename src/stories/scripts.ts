// The stories: final card copy (house voice; citation ledger in
// docs/STORIES.md, every DOI verified resolving). Copy is design — edit only
// with the designer. Numbers in the copy are computed from this repo's graph
// and asserted by the engine tests; do not round them differently.
//
// Visual grammar (dark baseline): while a story runs, everything defaults to
// ghost-dark. Each scene's `lit` selectors name what turns ON; an optional
// `reveal` sweeps the turn-on across grade columns ("ltr" early-grades-first,
// "rtl" late-grades-first) instead of landing all at once. Damage darkens
// WITHIN the lit set: missed standards read near-black, partly-hit ones dim.
//
// Selector grammar (resolved by src/stories/selectors.ts):
//   "all" · "grade:3" · "code:4.NF.B.3" · "domain:3.NF" · "strand:number"
//   "ancestry:CODE" (ancestor closure incl. the node) ·
//   "descendants:CODE" (descendant closure incl. the node) ·
//   "family-ancestry:CODE" (ancestor closure of the node AND its sub-standards —
//     the rolled-up form a PARTIAL parent needs, see selectors.ts)

export interface StoryScene {
  /** Timeline label: a year ("2019"), a grade ("Grade 4"), or a beat name. */
  year: string;
  state?: {
    missed?: string[];
    damage?: boolean;
    /** The ON set — everything else ghosts dark. Omit for a fully dark stage. */
    lit?: string[];
    focus?: string;
  };
  /** Directional turn-on sweep for this scene's lit change. */
  reveal?: { dir: "ltr" | "rtl"; ms?: number };
  /**
   * Stagger this scene's damage crossfade node by node instead of all at once —
   * the healing codas use it so the holes visibly relight one by one
   * ("scatter", hashed order, teachers everywhere at once) or year by year
   * ("ltr"). Applies to whichever nodes CHANGE damage this scene.
   */
  heal?: { order: "scatter" | "ltr"; ms?: number };
  /**
   * Ring these standards with breathing beacon rings IN ADDITION to whatever
   * `missed` already rings (every missed standard is beaconed automatically —
   * the gap spotlight). Use it when a scene heals the holes but the viewer
   * still needs to find where they were.
   */
  spotlight?: string[];
  camera?: {
    /** The lit CONTEXT this scene sets up (and the framing when no spine). */
    fit: "all" | string[];
    /**
     * The SPINE: what the card actually narrates. When present the camera frames
     * this instead of `fit`, and `fit` is left to do its other job — naming the
     * lit context. The pandemic story's grammar in one field: the camera leads
     * half a step ahead of the lit frontier and the glow bleeding past the frame
     * is the drama, not a framing error.
     */
    spine?: string[];
    pose?: 0 | 1 | 2 | 3;
  };
  card: { title: string; body: string; cite?: string; citeUrl?: string };
  /**
   * Alternate body shown when the story-HUD "Formation" pin makes this scene
   * play in a pose OTHER than its authored camera.pose. When the active pose
   * matches the authored pose, `card.body` stands. Only scenes whose authored
   * copy names their own pose's geometry (a summit, floors down) need one.
   */
  heldBody?: string;
  /** Alternate title under the same rule as heldBody (see sceneTitle). */
  heldTitle?: string;
  /** Auto-advance dwell (ms) once the scene has settled; Next skips ahead. */
  holdMs?: number;
  transition?: "lapse" | "cut";
}

export interface Story {
  id: string;
  kicker: string;
  title: string;
  hook: string;
  /** Interactive stories mount extra controls (player.ts owns the behavior). */
  interactive?: "lose-a-year";
  scenes: StoryScene[];
}

/** The four formations, by pose index (mirrors camera.pose + the pose driver). */
export type Formation = 0 | 1 | 2 | 3;

/**
 * The pose a scene plays in. Each scene AUTHORS its pose via camera.pose; the
 * story-HUD "Formation" control can instead PIN every scene to one formation.
 * `pinned` null = AUTHORED (each scene's own pose, defaulting to the Ascent (1)
 * when a scene omits camera.pose). Pure — unit-tested in tests/stories.test.ts.
 */
export function scenePose(scene: StoryScene, pinned: Formation | null): Formation {
  return pinned ?? (scene.camera?.pose ?? 1);
}

/**
 * The body copy for a scene given the pose it is ACTUALLY playing in. When a
 * pinned formation makes the active pose differ from the scene's authored pose
 * AND the scene supplies `heldBody`, the held copy shows; otherwise the authored
 * `card.body` is unchanged. Pure — unit-tested in tests/stories.test.ts.
 */
export function sceneBody(scene: StoryScene, activePose: Formation): string {
  const authored = scene.camera?.pose ?? 1;
  if (activePose !== authored && scene.heldBody) return scene.heldBody;
  return scene.card.body;
}

/** The title for a scene given its active pose — same rule as sceneBody. */
export function sceneTitle(scene: StoryScene, activePose: Formation): string {
  const authored = scene.camera?.pose ?? 1;
  if (activePose !== authored && scene.heldTitle) return scene.heldTitle;
  return scene.card.title;
}

/**
 * The 4.NF.B cluster ("build fractions from unit fractions"), every standard in
 * it, resolved from this repo's graph and hardcoded here because the selector
 * grammar has no `cluster:` form — `domain:4.NF` would sweep 4.NF.A and 4.NF.C
 * in with it. The parents 4.NF.B.3 and 4.NF.B.4 plus their seven sub-standards;
 * asserted against the live graph in tests/stories.test.ts so a data rebuild
 * that moved the cluster could never leave this list silently stale.
 */
const NF_B_CLUSTER = [
  "code:4.NF.B.3",
  "code:4.NF.B.3.a",
  "code:4.NF.B.3.b",
  "code:4.NF.B.3.c",
  "code:4.NF.B.3.d",
  "code:4.NF.B.4",
  "code:4.NF.B.4.a",
  "code:4.NF.B.4.b",
  "code:4.NF.B.4.c",
];

export const STORIES: Story[] = [
  {
    id: "vanished-year",
    kicker: "The pandemic, structurally",
    title: "The year that vanished",
    hook: "Follow one third grader through the spring the classrooms closed.",
    scenes: [
      {
        year: "2019",
        state: { lit: ["grade:K", "grade:1", "grade:2"] },
        reveal: { dir: "ltr" },
        camera: { fit: ["grade:K", "grade:1", "grade:2"], pose: 1 },
        card: {
          title: "A third grader, on track",
          body: "Fall 2019. Kindergarten through second grade light up behind this student, year by year: counting, place value, the first steps toward multiplication. Each light is something a teacher taught and a child learned. The grades ahead are dark because they have not happened yet.",
        },
        holdMs: 11000,
        transition: "lapse",
      },
      {
        year: "2019",
        state: { lit: ["grade:K", "grade:1", "grade:2", "domain:3.NF"] },
        reveal: { dir: "ltr", ms: 2200 },
        camera: { fit: ["grade:2", "grade:3", "grade:4"], pose: 1 },
        card: {
          title: "The fraction spring ahead",
          body: "Nine fraction standards sit in the spring of third grade, and more than four fifths of high school mathematics eventually rests on them. In a normal year this student meets them in a normal classroom, and they light up like everything else did.",
        },
        holdMs: 10000,
        transition: "lapse",
      },
      {
        year: "2020",
        state: { lit: ["grade:K", "grade:1", "grade:2", "grade:3"], missed: ["grade:3"], damage: true },
        camera: { fit: ["grade:3"], pose: 1 },
        card: {
          title: "March 2020",
          body: "Schools closed in March, and the rest of the school year never really happened. Across the country, students lost more ground in math than in reading, and the loss announced itself nowhere. On this map, a school year goes dark.",
          cite: "Betthäuser, Bach-Mortensen & Engzell (2023), Nature Human Behaviour",
          citeUrl: "https://doi.org/10.1038/s41562-022-01506-4",
        },
        holdMs: 11000,
        transition: "lapse",
      },
      {
        year: "2021",
        state: {
          lit: ["grade:K", "grade:1", "grade:2", "grade:3", "grade:4"],
          missed: ["grade:3"],
          damage: true,
        },
        reveal: { dir: "ltr", ms: 2600 },
        camera: { fit: ["grade:3", "grade:4"], pose: 1 },
        card: {
          title: "Fourth grade arrives anyway",
          body: "New content lands fine where it stands on its own and struggles where it stands on last year. Watch grade 4 come on. Geometry arrives bright, because most of what it stands on was built before third grade. Fractions arrive dimmer, because they stand on the nine standards that went dark.",
        },
        holdMs: 11500,
        transition: "lapse",
      },
      {
        year: "2022–24",
        state: {
          lit: ["grade:K", "grade:1", "grade:2", "grade:3", "grade:4", "grade:5", "grade:6", "grade:7"],
          missed: ["grade:3"],
          damage: true,
        },
        reveal: { dir: "ltr", ms: 3600 },
        camera: { fit: ["grade:4", "grade:5", "grade:6", "grade:7"], pose: 1 },
        card: {
          title: "Year over year",
          body: "Each new year lights up a little dimmer along the number, ratio, and algebra line. Of the 366 standards ahead of grade 3, 271 now stand on something that went dark. The other 95 stay bright, and that difference maps exactly where this student still gets to feel capable.",
        },
        holdMs: 12000,
        transition: "lapse",
      },
      {
        year: "Today",
        state: { lit: ["all"], missed: ["grade:3"], damage: true },
        reveal: { dir: "ltr", ms: 3200 },
        camera: { fit: ["grade:8", "grade:HS"], pose: 1 },
        card: {
          title: "High school, from here",
          body: "In ninth grade, even the concept of a function carries the mark. 135 high school standards trace back to grade 3 fractions alone. Recovery is not reteaching one year slower. It is rebuilding the floor under six years while those years keep coming.",
          cite: "Kuhfeld, Soland & Lewis (2022), Educational Researcher",
          citeUrl: "https://doi.org/10.3102/0013189X221109178",
        },
        holdMs: 11500,
        transition: "lapse",
      },
      {
        year: "",
        state: { lit: ["all"] },
        heal: { order: "scatter", ms: 4800 },
        camera: { fit: "all", pose: 1 },
        card: {
          title: "Why this is hard, and not hopeless",
          body: "Teachers rebuild these floors every day, one student at a time. Watch the lights come back the way the work actually happens: one standard, one child, one small win at a time. The map shows what the mathematics stands on. It never says what a child can or cannot do.",
        },
        holdMs: 12000,
        transition: "lapse",
      },
    ],
  },
  {
    id: "swiss-cheese",
    kicker: "After Sal Khan's metaphor",
    title: "Swiss cheese",
    hook: "Three silent holes, invisible on a report card, until they converge.",
    scenes: [
      {
        year: "Grade 3",
        state: { lit: ["grade:3"], missed: ["code:3.OA.A.2"], damage: false },
        camera: { fit: ["code:3.OA.A.2"], pose: 1 },
        card: {
          title: "The first hole",
          body: "Division as sharing, a two-week unit in October of third grade. This student was home sick for one of those weeks, the class moved on, and the report card said meets expectations. One standard went dark, and nobody saw it happen.",
        },
        holdMs: 11000,
        transition: "lapse",
      },
      {
        year: "Grade 4",
        state: { lit: ["grade:3", "grade:4"], missed: ["code:3.OA.A.2", "code:4.NF.B.4"], damage: false },
        reveal: { dir: "ltr", ms: 2200 },
        camera: { fit: ["code:4.NF.B.4"], pose: 1 },
        card: {
          title: "The second",
          body: "A year later, multiplying a fraction by a whole number never quite clicks. Partial credit and a good memory carry the test. The student does not know anything is missing either.",
        },
        holdMs: 10500,
        transition: "lapse",
      },
      {
        year: "Grade 6",
        state: {
          lit: ["all"],
          missed: ["code:3.OA.A.2", "code:4.NF.B.4", "code:6.RP.A.2"],
          damage: false,
        },
        reveal: { dir: "ltr", ms: 3000 },
        camera: { fit: "all", pose: 1 },
        card: {
          title: "Three holes in a field of 480",
          body: "Unit rates joins the list in sixth grade. Pull all the way back and the map still looks whole: three holes among 480 standards, one dragging its three sub-standards down with it. Every yearly average sees a B student, because a yearly average is exactly the wrong resolution for finding holes.",
        },
        holdMs: 11000,
        transition: "lapse",
      },
      {
        year: "Grade 7",
        state: {
          lit: ["ancestry:7.RP.A.2"],
          missed: ["code:3.OA.A.2", "code:4.NF.B.4", "code:6.RP.A.2"],
          damage: true,
          focus: "7.RP.A.2",
        },
        reveal: { dir: "rtl", ms: 3200 },
        // The card narrates four standards; the 75-node ancestry glow bleeding
        // past the frame is the point, so the SPINE is the four, not the closure.
        camera: {
          fit: ["ancestry:7.RP.A.2"],
          spine: ["code:3.OA.A.2", "code:4.NF.B.4", "code:6.RP.A.2", "code:7.RP.A.2"],
          pose: 1,
        },
        card: {
          title: "Then proportional reasoning arrives",
          body: "One seventh-grade standard stands on 75 earlier ones. The brightest rings are the holes themselves; the fainter rings show the damage spreading through everything built on them. The ladder thins right before grade 7 because two of its three sixth-grade rungs are casualties: one missing outright, one standing on the missing. Four pieces out of 75 are enough to make the floor tilt while every adult in the room wonders why this student suddenly cannot keep up.",
        },
        holdMs: 12000,
        transition: "lapse",
      },
      {
        year: "The year after",
        state: {
          lit: ["grade:7", "grade:8", "grade:HS"],
          missed: ["code:3.OA.A.2", "code:4.NF.B.4", "code:6.RP.A.2"],
          damage: true,
        },
        reveal: { dir: "ltr", ms: 2600 },
        // Spine on 7-8: the card's argument lands there and the HS glow bleeds
        // off the right edge, which is the sentence the scene is making.
        camera: {
          fit: ["grade:7", "grade:8", "grade:HS"],
          spine: ["grade:7", "grade:8"],
          pose: 1,
        },
        card: {
          title: "Struggle starts to look like identity",
          body: "Slope is a rate. A linear function is a proportional one with a starting value. The dimness follows this student into eighth grade and high school, and somewhere along the way it turns into a sentence: I am not a math person. The structure wrote that sentence, not the child.",
        },
        holdMs: 11500,
        transition: "lapse",
      },
      {
        year: "The fix",
        state: {
          lit: ["code:3.OA.A.2", "code:4.NF.B.4", "code:6.RP.A.2", "code:7.RP.A.2"],
          damage: false,
        },
        heal: { order: "ltr", ms: 3600 },
        spotlight: ["code:3.OA.A.2", "code:4.NF.B.4", "code:6.RP.A.2"],
        camera: { fit: ["code:3.OA.A.2", "code:4.NF.B.4", "code:6.RP.A.2", "code:7.RP.A.2"], pose: 1 },
        card: {
          title: "Find three holes, not three years",
          body: "Four lights remain: the three ringed holes and the seventh-grade standard they hold up. Seeing the structure changes the assignment. In Bloom's small studies, one-to-one mastery tutoring moved students about two standard deviations; across 108 studies of scalable mastery programs, the average is about half of one. The distance between those numbers is the work, and it starts with knowing exactly which three standards to rebuild.",
          cite: "Bloom (1984); Kulik, Kulik & Bangert-Drowns (1990)",
          citeUrl: "https://doi.org/10.3102/00346543060002265",
        },
        holdMs: 13000,
        transition: "lapse",
      },
    ],
  },
  {
    id: "opportunity-myth",
    kicker: "After TNTP's report",
    title: "The opportunity myth",
    hook: "A year of review, and what passes by while it happens.",
    // Rebuilt to the pandemic story's grammar (2026-07): ONE student, ONE
    // monotone lit set that only grows left to right, one idea per scene, and a
    // camera that leads half a step ahead of the lit frontier. The prior cut
    // ping-ponged K-4 → 4 → 4+5 → K-8 → 6-8 → mix and read as complex.
    scenes: [
      {
        year: "Grade 4, September",
        state: { lit: ["grade:4"] },
        reveal: { dir: "ltr" },
        camera: { fit: ["grade:4"], pose: 1 },
        card: {
          title: "Fourth grade, on paper",
          body: "Fourth grade is the fractions year: equivalence, comparison, adding and subtracting parts of the same whole. Thirty-seven standards sit in this band, and the ones ahead assume every one of them.",
        },
        holdMs: 11000,
        transition: "lapse",
      },
      {
        year: "October through January",
        state: { lit: ["grade:3", "grade:4"] },
        // The one deliberate backward look in the story: the year regressing.
        reveal: { dir: "rtl", ms: 2000 },
        camera: { fit: ["grade:3", "grade:4"], pose: 1 },
        card: {
          title: "What the year actually held",
          body: "The Opportunity Myth found students spending most of their math time on work below their grade. For this student, October through January is third grade again: re-taught rounding, re-taught multiplication facts, a familiar worksheet with a new date.",
        },
        holdMs: 11000,
        transition: "lapse",
      },
      {
        year: "The same year",
        state: {
          lit: ["grade:3", "grade:4"],
          missed: NF_B_CLUSTER,
          damage: false,
        },
        camera: { fit: ["grade:3", "grade:4"], spine: NF_B_CLUSTER, pose: 1 },
        card: {
          title: "What never arrived",
          body: "Every week spent reviewing is a week 4.NF.B does not get. The cluster dims quietly: not failed, just never reached. Report cards have no mark for material that was never assigned.",
        },
        holdMs: 11000,
        transition: "lapse",
      },
      {
        year: "Grade 5",
        state: {
          lit: ["grade:3", "grade:4", "grade:5"],
          missed: NF_B_CLUSTER,
          damage: true,
        },
        reveal: { dir: "ltr" },
        camera: { fit: ["grade:4", "grade:5"], pose: 1 },
        card: {
          title: "The bill, one year later",
          body: "Fifth grade opens assuming fractions are settled. They are not. 5.NF stands directly on the cluster that never arrived, and the struggle that follows looks like a fifth-grade problem while its cause sits a year earlier.",
        },
        holdMs: 11500,
        transition: "lapse",
      },
      {
        year: "Grades 6 through 8",
        state: {
          lit: ["grade:3", "grade:4", "grade:5", "grade:6", "grade:7", "grade:8"],
          missed: NF_B_CLUSTER,
          damage: true,
        },
        reveal: { dir: "ltr", ms: 2600 },
        camera: { fit: ["grade:5", "grade:6", "grade:7", "grade:8"], pose: 1 },
        card: {
          title: "Compound interest",
          body: "Left alone, the dimness keeps traveling: ratios in sixth grade, proportional reasoning in seventh, linear functions in eighth. Each year the distance from the missing cluster grows, and the harder its origin is to see.",
          cite: "Schmidt, Burroughs, Zoido & Houang (2015), Educational Researcher",
          citeUrl: "https://doi.org/10.3102/0013189X15603982",
        },
        holdMs: 12000,
        transition: "lapse",
      },
      {
        year: "The other version",
        state: { lit: ["grade:4", "grade:5"], missed: [], damage: false },
        heal: { order: "ltr", ms: 3000 },
        spotlight: NF_B_CLUSTER,
        camera: { fit: ["grade:4", "grade:5"], spine: [...NF_B_CLUSTER, "code:5.NF.A.1"], pose: 1 },
        card: {
          title: "The other version of the year",
          body: "TNTP's finding cuts both ways: students given grade-level work rose to it more often than not. Hold the review to what the data says a student needs, teach the year the grade promises, and the map ahead stays lit.",
          cite: "TNTP (2018), The Opportunity Myth",
        },
        holdMs: 12000,
        transition: "lapse",
      },
    ],
  },
  {
    id: "starts-with-counting",
    kicker: "For the early educators",
    title: "It starts with counting",
    hook: "Nearly half of this map descends from one Kindergarten standard: counting to one hundred.",
    scenes: [
      {
        // F-IF.A.1 is HS Functions (Algebra I in the traditional pathway), and
        // the scrubber's other rails carry real grade labels, so a "Grade 12"
        // here read as a placement claim about the standard. The app's own
        // vocabulary for the band is "High School".
        year: "High school",
        state: { lit: ["code:F-IF.A.1"], focus: "F-IF.A.1" },
        camera: { fit: ["code:F-IF.A.1"], pose: 1 },
        heldTitle: "Start at the far end",
        card: {
          title: "Start at the summit",
          body: "A single light in the dark. The concept of a function sits nineteen prerequisites deep, and fourteen later ideas branch straight off it, the busiest junction on this map. Ask who in a district does the most consequential mathematical work, and people point here.",
        },
        holdMs: 10500,
        transition: "lapse",
      },
      {
        year: "Descending",
        state: { lit: ["ancestry:F-IF.A.1"] },
        reveal: { dir: "rtl", ms: 3600 },
        // The descent line the card walks — each rung verified to lie on
        // ancestry:F-IF.A.1 (tests/stories.test.ts). The other 74 ancestors light
        // around it and past the frame; the line is what the camera holds.
        camera: {
          fit: ["ancestry:F-IF.A.1"],
          spine: ["code:F-IF.A.1", "code:8.F.A.1", "code:6.RP.A.2", "code:K.CC.A.1"],
          pose: 1,
        },
        heldTitle: "Follow its foundations back",
        heldBody:
          "Watch the chain light from functions backward. Functions stand on eighth-grade relations, which stand on proportionality and ratio, which stand on fractions and the whole-number work beneath them. Nineteen steps back the light reaches kindergarten, and counting is one of the foundations under everything.",
        card: {
          title: "Follow its foundations down",
          body: "Watch the chain light from the summit downward. Functions stand on eighth-grade relations, which stand on proportionality and ratio, which stand on fractions and the whole-number work beneath them. Nineteen floors down the light reaches kindergarten, and counting is one of the foundations under everything.",
        },
        holdMs: 11500,
        transition: "lapse",
      },
      {
        year: "K",
        state: { lit: ["descendants:K.CC.A.1"] },
        reveal: { dir: "ltr", ms: 3600 },
        // The ascent line out of counting, each rung verified to lie ON
        // descendants:K.CC.A.1 (3.OA.A.2 does NOT — it is not downstream of
        // counting — so the highest-degree grade-3 descendant, 3.OA.D.8, takes
        // that rung). The other 222 descendants wash PAST the frame: the wave is
        // the drama, the line is the subject.
        camera: {
          fit: ["descendants:K.CC.A.1"],
          spine: ["code:K.CC.A.1", "code:3.OA.D.8", "code:6.EE.B.7", "code:F-IF.A.1"],
          pose: 1,
        },
        card: {
          title: "Now light everything that grows from counting",
          body: "From one kindergarten standard, count to 100 by ones and tens, 225 standards light up, 47 percent of the whole map. Across six longitudinal datasets, the math children bring to school entry predicts their later achievement better than early reading or attention do. The map shows what the work stands on, never what a child can or cannot do.",
          cite: "Duncan et al. (2007), Developmental Psychology; Watts et al. (2014)",
          citeUrl: "https://doi.org/10.1037/0012-1649.43.6.1428",
        },
        holdMs: 12500,
        transition: "lapse",
      },
      {
        year: "The room",
        state: { lit: ["grade:K", "grade:1"] },
        camera: { fit: ["grade:K", "grade:1"], pose: 1 },
        card: {
          title: "The room where it starts",
          body: "A rug, a number line, a five-year-old counting past twenty-nine for the first time. The teacher leading that room is laying the foundation under three quarters of high school mathematics, at the age when the foundation is most fragile.",
        },
        holdMs: 11000,
        transition: "lapse",
      },
      {
        year: "",
        state: { lit: ["all"] },
        reveal: { dir: "ltr", ms: 2800 },
        camera: { fit: "all", pose: 1 },
        card: {
          title: "There is no such thing as just counting",
          body: "Even the classic fraction mistake, reading one fifth as bigger than one fourth because five beats four, still trips adults under time pressure, mathematicians included. Early mathematics is not a warm-up for the real thing. It is the real thing.",
          cite: "Braithwaite & Siegler (2018), Developmental Science",
          citeUrl: "https://doi.org/10.1111/desc.12541",
        },
        holdMs: 11500,
        transition: "lapse",
      },
    ],
  },
  {
    id: "find-where-it-begins",
    kicker: "The diagnostic move",
    title: "Find where it begins",
    hook: "The move every teacher can make: walk back until you find solid ground.",
    // Re-anchored 2026-07 from 7.RP.A.2 to 8.EE.C.7: proportional reasoning was
    // already the climax of Swiss cheese, and two stories converging on one
    // standard read as repetition. Solving linear equations is the better
    // diagnostic subject anyway — its chain bottoms out in FIRST grade, seven
    // years below the label, which is the story's whole argument.
    //
    // 8.EE.C.7 is a PARTIAL parent: it has zero direct prerequisites of its own
    // and carries all 119 on its sub-standard 8.EE.C.7.b, so every selector here
    // is the rolled-up `family-ancestry:` form (see selectors.ts). The walk-back
    // chain the cards name is real and mostly single-hop — 8.EE.C.7's family →
    // 7.EE.B.4.a → 6.EE.B.7 → 5.NF.A.1 are each ONE direct prereq edge, and
    // 1.OA.D.7 (the meaning of the equal sign) is a transitive ancestor of
    // 5.NF.A.1. All asserted in tests/story-framing.test.ts.
    scenes: [
      {
        year: "The struggle",
        state: { lit: ["code:8.EE.C.7"], focus: "8.EE.C.7" },
        camera: { fit: ["code:8.EE.C.7"], pose: 1 },
        card: {
          title: "A student is failing linear equations",
          body: "One light on the map, the eighth-grade standard this student keeps failing. Solve for x, one variable, terms on both sides. The grade label says to reteach eighth grade, slower and louder. The structure is about to disagree.",
        },
        holdMs: 10000,
        transition: "lapse",
      },
      {
        year: "The map",
        state: { lit: ["family-ancestry:8.EE.C.7"], focus: "8.EE.C.7" },
        reveal: { dir: "rtl", ms: 3600 },
        // The walk-back line the next scene names, framed while the other 116
        // ancestors light around it.
        camera: {
          fit: ["family-ancestry:8.EE.C.7"],
          spine: ["code:8.EE.C.7", "code:7.EE.B.4.a", "code:6.EE.B.7", "code:1.OA.D.7"],
          pose: 1,
        },
        card: {
          title: "Light what it stands on",
          body: "The chain runs from this standard back through 119 earlier ones, all the way to kindergarten. Somewhere along it is the last thing this student can do securely, and everything after that point leans on the gap.",
        },
        holdMs: 11500,
        transition: "lapse",
      },
      {
        year: "Walk back",
        state: { lit: ["family-ancestry:8.EE.C.7"], focus: "8.EE.C.7" },
        camera: {
          fit: ["family-ancestry:8.EE.C.7"],
          // 8.EE.C.7 rides the spine even though the walk-back names only the
          // rungs below it: the card ends on "seven school years below the
          // label on the struggle", and that label has to be in frame for the
          // sentence to land. Without it the anchor exits right and returns in
          // s4, which read as an unmotivated push-in.
          spine: [
            "code:8.EE.C.7",
            "code:7.EE.B.4.a",
            "code:6.EE.B.7",
            "code:5.NF.A.1",
            "code:1.OA.D.7",
          ],
          pose: 1,
        },
        card: {
          title: "Walk back until the ground is solid",
          body: "Check two-step equations: shaky. Check one-step equations: shaky. Check adding fractions with unlike denominators: shaky. Check what the equal sign means: solid. Stop there. The ground floor is a first-grade idea, seven school years below the label on the struggle.",
        },
        holdMs: 11500,
        transition: "lapse",
      },
      {
        year: "Build up",
        state: { lit: ["family-ancestry:8.EE.C.7"], focus: "8.EE.C.7" },
        reveal: { dir: "ltr", ms: 3200 },
        // Same spine as scene 2, now rebuilt upward — the reader holds one frame
        // across the walk-back and the build-up, and never re-orients.
        camera: {
          fit: ["family-ancestry:8.EE.C.7"],
          spine: ["code:8.EE.C.7", "code:7.EE.B.4.a", "code:6.EE.B.7", "code:1.OA.D.7"],
          pose: 1,
        },
        card: {
          title: "Build back up from there",
          body: "Now light the chain the other way. From solid ground, each missing step is targeted work on one named standard, not a year of going backward. Fraction knowledge in elementary school predicts high school algebra better than almost anything else researchers measured, and on this chain the fractions are load-bearing: adding unlike denominators sits directly under the first equations this student ever solved.",
          cite: "Siegler et al. (2012), Psychological Science",
          citeUrl: "https://doi.org/10.1177/0956797612440101",
        },
        holdMs: 11500,
        transition: "lapse",
      },
      {
        year: "Your turn",
        state: { lit: ["all"] },
        reveal: { dir: "ltr", ms: 2800 },
        camera: { fit: "all", pose: 1 },
        card: {
          title: "Do this with a real student",
          body: "Close this story, search for any standard your students struggle with, and follow Builds on backward until you find solid ground. The map is the diagnostic. You are the treatment.",
        },
        holdMs: 10500,
        transition: "lapse",
      },
    ],
  },
  {
    id: "lose-a-year",
    kicker: "Interactive",
    title: "Lose a year, any year",
    hook: "Pick the grade a student misses and watch what the structure does with it.",
    interactive: "lose-a-year",
    scenes: [
      {
        year: "You choose",
        state: { lit: ["all"] },
        reveal: { dir: "ltr", ms: 2600 },
        camera: { fit: "all", pose: 1 },
        card: {
          // Placeholder copy only: the player rewrites title + body live with
          // the chosen year's computed numbers (see armYearDamage).
          title: "Choose the missing year",
          body: "Every light is a standard taught and learned. Pick a grade below to take it away; the map recomputes what stands on it.",
        },
        holdMs: 0, // interactive: never auto-advances
        transition: "lapse",
      },
    ],
  },
];

/**
 * Look a story up by id. Callers that can be handed an id from OUTSIDE the app
 * (the `#/story/<id>` deep-link router, the debug hook) must resolve through
 * this and handle `undefined`: story ids are public URLs, so a retired story
 * (third-vs-eighth, cut 2026-07) keeps arriving in links long after it is gone.
 */
export function findStory(id: string): Story | undefined {
  return STORIES.find((s) => s.id === id);
}
