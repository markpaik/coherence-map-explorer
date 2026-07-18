// The six stories: final card copy (house voice; citation ledger in
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
//   "descendants:CODE" (descendant closure incl. the node)

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
  camera?: { fit: "all" | string[]; pose?: 0 | 1 | 2 };
  card: { title: string; body: string; cite?: string; citeUrl?: string };
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
          body: "Fall 2019. Kindergarten through second grade light up behind this student, year by year: counting, place value, the first multiplication facts. Each light is something a teacher taught and a child learned. The grades ahead are dark because they have not happened yet.",
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
          body: "Nine fraction standards sit in the spring of third grade, and nearly half of high school mathematics eventually rests on them. In a normal year this student meets them in a normal classroom, and they light up like everything else did.",
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
          body: "New content lands fine where it stands on its own and struggles where it stands on last year. Watch grade 4 come on. Geometry arrives bright, because it rests on earlier geometry this student has. Fractions arrive dim, because they rest on the nine standards that went dark.",
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
    id: "third-vs-eighth",
    kicker: "A hypothesis, testable",
    title: "Third grade against eighth grade",
    hook: "Two students each lose one year. The structure treats them differently.",
    scenes: [
      {
        year: "Student A",
        state: { lit: ["grade:K", "grade:1", "grade:2", "grade:3", "grade:4", "grade:5", "grade:6", "grade:7", "grade:8"] },
        reveal: { dir: "ltr", ms: 2600 },
        camera: { fit: ["grade:7", "grade:8"], pose: 1 },
        card: {
          title: "An eighth grader, before",
          body: "Kindergarten through seventh grade shine behind this student, and eighth grade is underway. This is the bridge year, where linear equations and functions turn arithmetic into algebra.",
        },
        holdMs: 10000,
        transition: "lapse",
      },
      {
        year: "Miss 8th",
        state: {
          lit: ["grade:K", "grade:1", "grade:2", "grade:3", "grade:4", "grade:5", "grade:6", "grade:7", "grade:8"],
          missed: ["grade:8"],
          damage: true,
        },
        camera: { fit: ["grade:8"], pose: 1 },
        card: {
          title: "Losing eighth grade",
          body: "All 36 of its standards go dark at once, and they are consequential ones. The bridge from arithmetic to algebra crosses this year.",
        },
        holdMs: 9500,
        transition: "lapse",
      },
      {
        year: "The spread",
        state: { lit: ["all"], missed: ["grade:8"], damage: true },
        reveal: { dir: "ltr", ms: 2600 },
        camera: { fit: ["grade:8", "grade:HS"], pose: 1 },
        card: {
          title: "What it touches",
          body: "High school lights up already dimmed. The missing year touches 112 of the 163 standards ahead. Statistics is the exception, with 74 percent of it arriving bright, because it stands mostly on earlier ground. The damage is real, and the runway to repair it is short.",
        },
        holdMs: 12000,
        transition: "lapse",
      },
      {
        year: "Student B",
        state: { lit: ["grade:K", "grade:1", "grade:2", "grade:3"] },
        heal: { order: "scatter", ms: 2400 },
        reveal: { dir: "rtl", ms: 2600 },
        camera: { fit: ["grade:2", "grade:3"], pose: 1 },
        card: {
          title: "Now rewind to a third grader",
          body: "A different student loses a different year. The map winds back to third grade, where multiplication becomes a structure instead of a trick and fractions are born.",
        },
        holdMs: 10000,
        transition: "lapse",
      },
      {
        year: "Miss 3rd",
        state: { lit: ["all"], missed: ["grade:3"], damage: true },
        reveal: { dir: "ltr", ms: 3600 },
        camera: { fit: ["grade:3", "grade:4", "grade:5", "grade:6"], pose: 1 },
        card: {
          title: "Losing third grade",
          body: "The dark spreads across 271 standards over seven remaining years, and 240 descendants of grade 3 fractions dim with it. An early gap is not the same gap arriving earlier. It has more years to grow.",
        },
        holdMs: 12000,
        transition: "lapse",
      },
      {
        year: "Both true",
        state: { lit: ["all"], missed: ["grade:3"], damage: true },
        camera: { fit: "all", pose: 1 },
        card: {
          title: "What the recovery data adds",
          body: "The structure says early gaps reach further. NWEA's post-pandemic tracking found middle schoolers recovered slowest, because time left and access to help matter too; that analysis is a technical report, not peer-reviewed research. Both things can be true, and both are reasons this work is hard.",
          cite: "Peer-reviewed anchor: Kuhfeld, Soland & Lewis (2022), Educational Researcher",
          citeUrl: "https://doi.org/10.3102/0013189X221109178",
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
          title: "Three dark points in a field of 480",
          body: "Unit rates joins the list in sixth grade. Pull all the way back and the map still looks whole, three holes among 480 standards. Every yearly average sees a B student, because a yearly average is exactly the wrong resolution for finding holes.",
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
        camera: { fit: ["ancestry:7.RP.A.2"], pose: 1 },
        card: {
          title: "Then proportional reasoning arrives",
          body: "One seventh-grade standard stands on 75 earlier ones, and the three ringed holes sit among them. The ladder thins right before grade 7 because two of its three sixth-grade rungs are casualties: one missing outright, one standing on the missing. Three pieces out of 75 are enough to make the floor tilt while every adult in the room wonders why this student suddenly cannot keep up.",
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
        camera: { fit: ["grade:7", "grade:8", "grade:HS"], pose: 1 },
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
    scenes: [
      {
        year: "September",
        state: {
          lit: ["grade:K", "grade:1", "grade:2", "grade:3", "grade:4"],
          missed: ["code:4.NF.B.4", "code:4.NBT.B.5"],
          damage: true,
        },
        reveal: { dir: "ltr", ms: 2600 },
        camera: { fit: ["grade:4"], pose: 1 },
        card: {
          title: "A fifth grader, two holes behind",
          body: "A hard fourth-grade year left two real gaps, multi-digit multiplication and fraction multiplication. Everything else back here lights up intact. Hold that thought.",
        },
        holdMs: 10500,
        transition: "lapse",
      },
      {
        year: "The plan",
        state: { lit: ["grade:4"], missed: ["code:4.NF.B.4", "code:4.NBT.B.5"], damage: true },
        camera: { fit: ["grade:4"], pose: 1 },
        card: {
          title: "The plan is a year of review",
          body: "The most common answer to being behind is to repeat the grade below, all of it. In TNTP's study of five districts, students spent more than 500 hours a year on assignments below their grade level. On the map the plan looks like this: one year stays lit while everything else waits in the dark.",
          cite: "TNTP (2018), The Opportunity Myth (report)",
        },
        holdMs: 11000,
        transition: "lapse",
      },
      {
        year: "Meanwhile",
        state: {
          lit: ["grade:4", "grade:5"],
          missed: ["code:4.NF.B.4", "code:4.NBT.B.5"],
          damage: true,
        },
        reveal: { dir: "ltr", ms: 2600 },
        camera: { fit: ["grade:5"], pose: 1 },
        card: {
          title: "What passes by meanwhile",
          body: "Fifth grade happens anyway. Dividing fractions, decimal operations, volume: 40 standards go past while this student reviews, and most of them stand on foundations that were never broken. The student could have met them.",
        },
        holdMs: 11500,
        transition: "lapse",
      },
      {
        year: "Next fall",
        state: {
          lit: ["grade:K", "grade:1", "grade:2", "grade:3", "grade:4", "grade:5", "grade:6"],
          missed: ["grade:4", "grade:5"],
          damage: true,
        },
        reveal: { dir: "ltr", ms: 2800 },
        camera: { fit: ["grade:4", "grade:5", "grade:6"], pose: 1 },
        card: {
          title: "The gap the review year built",
          body: "Next fall, the grade 5 standards read as missed too, not because this student could not learn them but because nobody offered them. Review that replaces grade-level work manufactures next year's gap. Schmidt and colleagues found unequal access to content compounds exactly this way.",
          cite: "Schmidt, Burroughs, Zoido & Houang (2015), Educational Researcher",
          citeUrl: "https://doi.org/10.3102/0013189X15603982",
        },
        holdMs: 12000,
        transition: "lapse",
      },
      {
        year: "Years on",
        state: { lit: ["grade:6", "grade:7", "grade:8"], missed: ["grade:4", "grade:5"], damage: true },
        reveal: { dir: "ltr", ms: 2600 },
        camera: { fit: ["grade:6", "grade:7", "grade:8"], pose: 1 },
        card: {
          title: "The long shadow",
          body: "Ratios, proportions, and the road to algebra all pass through the years this student spent reviewing. The original problem was two standards wide. The manufactured one spans two grades.",
        },
        holdMs: 11000,
        transition: "lapse",
      },
      {
        year: "The alternative",
        state: {
          lit: ["grade:5", "code:4.NF.B.4", "code:4.NBT.B.5"],
          missed: ["code:4.NF.B.4", "code:4.NBT.B.5"],
          damage: true,
        },
        heal: { order: "scatter", ms: 3200 },
        camera: { fit: ["grade:4", "grade:5"], pose: 1 },
        card: {
          title: "The alternative fits on one screen",
          body: "Keep fifth grade lit and repair the two specific holes underneath it. In TNTP's data, students who got more grade-level work grew more, and those who started behind gained about seven months on their peers. That is an association from a descriptive study, and it is also what the structure predicts.",
          cite: "TNTP (2018), report, association not causation",
        },
        holdMs: 12500,
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
        year: "Grade 12",
        state: { lit: ["code:F-IF.A.1"], focus: "F-IF.A.1" },
        camera: { fit: ["code:F-IF.A.1"], pose: 1 },
        card: {
          title: "Start at the summit",
          body: "A single light in the dark. The concept of a function sits nineteen prerequisites deep, the deepest idea on this map. Ask who in a district does the most advanced mathematical work, and people point here.",
        },
        holdMs: 10500,
        transition: "lapse",
      },
      {
        year: "Descending",
        state: { lit: ["ancestry:F-IF.A.1"] },
        reveal: { dir: "rtl", ms: 3600 },
        camera: { fit: ["ancestry:F-IF.A.1"], pose: 1 },
        card: {
          title: "Follow its foundations down",
          body: "Watch the chain light from the summit downward. Functions stand on eighth-grade relations, which stand on proportionality, then ratio, then fractions, then multiplication, and finally counting. Nineteen floors down, there is one room at the bottom.",
        },
        holdMs: 11500,
        transition: "lapse",
      },
      {
        year: "K",
        state: { lit: ["descendants:K.CC.A.1"] },
        reveal: { dir: "ltr", ms: 3600 },
        camera: { fit: "all", pose: 1 },
        card: {
          title: "Now light everything that grows from counting",
          body: "From one kindergarten standard, count to 100 by ones and tens, 225 standards light up, 47 percent of the whole map. Across six longitudinal datasets, the math children bring to school entry predicts their later achievement better than early reading or attention do.",
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
          body: "A rug, a number line, a five-year-old counting past twenty-nine for the first time. The teacher leading that room is laying the foundation under half of high school mathematics, at the age when the foundation is most fragile.",
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
          body: "Even the classic fraction mistake, reading one fifth as bigger than one fourth because five beats four, follows people into adulthood when the early ground is thin. Early mathematics is not a warm-up for the real thing. It is the real thing.",
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
    scenes: [
      {
        year: "The struggle",
        state: { lit: ["code:7.RP.A.2"], focus: "7.RP.A.2" },
        camera: { fit: ["code:7.RP.A.2"], pose: 2 },
        card: {
          title: "A student is failing proportional reasoning",
          body: "One light on the board, the seventh-grade standard this student keeps failing. The grade label says to reteach seventh grade, slower and louder. The structure is about to disagree.",
        },
        holdMs: 10000,
        transition: "lapse",
      },
      {
        year: "The map",
        state: { lit: ["ancestry:7.RP.A.2"], focus: "7.RP.A.2" },
        reveal: { dir: "rtl", ms: 3600 },
        camera: { fit: ["ancestry:7.RP.A.2"], pose: 2 },
        card: {
          title: "Light what it stands on",
          body: "The chain runs from this standard back through 75 earlier ones, all the way to kindergarten. Somewhere along it is the last thing this student can do securely, and everything after that point leans on the gap.",
        },
        holdMs: 11500,
        transition: "lapse",
      },
      {
        year: "Walk back",
        state: { lit: ["ancestry:7.RP.A.2"], focus: "7.RP.A.2" },
        camera: { fit: ["code:6.RP.A.2", "code:5.NF.B.4", "code:4.NF.B.4"], pose: 2 },
        card: {
          title: "Walk back until the ground is solid",
          body: "Check unit rates: shaky. Check fraction multiplication: shaky. Check division as sharing: solid. Stop there. The ground floor is a third-grade skill, three steps and four school years below the label on the struggle.",
        },
        holdMs: 11500,
        transition: "lapse",
      },
      {
        year: "Build up",
        state: { lit: ["ancestry:7.RP.A.2"], focus: "7.RP.A.2" },
        reveal: { dir: "ltr", ms: 3200 },
        camera: { fit: ["ancestry:7.RP.A.2"], pose: 2 },
        card: {
          title: "Build back up from there",
          body: "Now light the chain the other way. From solid ground, each missing step is weeks of targeted work, not a year of going backward. Fraction knowledge in elementary school predicts high school algebra better than almost anything else researchers measured, so every step rebuilt here keeps paying.",
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
        camera: { fit: "all", pose: 2 },
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
