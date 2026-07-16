// The six stories: final card copy (house voice, citation ledger in
// docs/STORIES.md, every DOI verified resolving). Copy is design — edit only
// with the designer. Numbers in the copy are computed from this repo's graph
// and asserted by the pipeline tests; do not round them differently.
//
// Selector grammar (resolved by the engine in src/stories/player.ts):
//   "all" · "grade:3" · "code:4.NF.B.3" · "domain:3.NF" · "strand:number"
//   "ancestry:CODE" (ancestor closure incl. the node) ·
//   "descendants:CODE" (descendant closure incl. the node)

export interface StoryScene {
  /** Timeline label: a year ("2019"), a grade ("Grade 4"), or a beat name. */
  year: string;
  state?: {
    /** Standards marked missed (damage 1, ember husk). */
    missed?: string[];
    /** Recompute downstream damage from `missed` (ancestry share). */
    damage?: boolean;
    /** Ghost everything NOT matched (aVisible), for isolation beats. */
    spotlight?: string[];
    /** Focus a single standard (camera + panel stay closed; emphasis only). */
    focus?: string;
  };
  camera?: { fit: "all" | string[]; pose?: 0 | 1 };
  card: { title: string; body: string; cite?: string; citeUrl?: string };
  holdMs?: number;
  transition?: "lapse" | "cut";
}

export interface Story {
  id: string;
  kicker: string;
  title: string;
  hook: string;
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
        camera: { fit: ["grade:K", "grade:1", "grade:2", "grade:3"], pose: 1 },
        card: {
          title: "A third grader, on track",
          body: "Fall 2019. Kindergarten through second grade shine behind this student. Ahead, in the spring curriculum, sit nine fraction standards that half of high school mathematics will eventually stand on.",
        },
        transition: "lapse",
      },
      {
        year: "2020",
        state: { missed: ["grade:3"], damage: true },
        camera: { fit: ["grade:2", "grade:3", "grade:4"], pose: 1 },
        card: {
          title: "The interruption",
          body: "Schools closed in March. Across the country, students lost more ground in math than in reading, and what was missed did not announce itself. On this map, a school year simply goes dark.",
          cite: "Betthäuser, Bach-Mortensen & Engzell (2023), Nature Human Behaviour",
          citeUrl: "https://doi.org/10.1038/s41562-022-01506-4",
        },
        transition: "lapse",
      },
      {
        year: "2021",
        state: { missed: ["grade:3"], damage: true },
        camera: { fit: ["grade:3", "grade:4", "grade:5"], pose: 1 },
        card: {
          title: "Grade 4 arrives anyway",
          body: "The cruel asymmetry of coherence: new content lands fine where it stands on its own, and struggles exactly where it stands on last year. Grade 4 fractions flicker. Grade 4 geometry, resting on different foundations, stays bright.",
        },
        transition: "lapse",
      },
      {
        year: "2022–24",
        state: { missed: ["grade:3"], damage: true },
        camera: { fit: ["grade:3", "grade:4", "grade:5", "grade:6", "grade:7"], pose: 1 },
        card: {
          title: "The compounding",
          body: "The damage climbs the number, ratio, and algebra spine year over year. Of the 366 standards ahead of grade 3, 271 now carry broken ancestry. Ninety-five stay untouched, and that difference is a map of where this student can still feel capable.",
        },
        transition: "lapse",
      },
      {
        year: "Today",
        state: { missed: ["grade:3"], damage: true },
        camera: { fit: ["grade:8", "grade:HS"], pose: 1 },
        card: {
          title: "High school ahead",
          body: "Even the concept of a function carries the scar: 135 high school standards descend from grade 3 fractions alone. Recovery is not reteaching one year. It is rebuilding the floor under six.",
          cite: "Kuhfeld, Soland & Lewis (2022), Educational Researcher",
          citeUrl: "https://doi.org/10.3102/0013189X221109178",
        },
        transition: "lapse",
      },
      {
        year: "",
        camera: { fit: "all", pose: 1 },
        card: {
          title: "Why it is hard, not why it is hopeless",
          body: "Teachers rebuild these floors every day, student by student. The map shows what the work stands on, never what any child can or cannot do. It is why the climb is steep, and where the handholds are.",
        },
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
        year: "Miss 8th",
        state: { missed: ["grade:8"], damage: true },
        camera: { fit: ["grade:7", "grade:8", "grade:HS"], pose: 1 },
        card: {
          title: "Losing eighth grade",
          body: "One hundred twelve of the 163 standards ahead are touched, but high school statistics barely notices: 74 percent of it stays clear. The runway left to repair is one school stage.",
        },
        transition: "lapse",
      },
      {
        year: "Miss 3rd",
        state: { missed: ["grade:3"], damage: true },
        camera: { fit: "all", pose: 1 },
        card: {
          title: "Losing third grade",
          body: "Two hundred seventy-one standards across seven remaining years carry the damage, and the fraction gate closes: 240 descendants of grade 3 fractions go dim. An early gap is not the same gap earlier. It is a different, larger thing.",
        },
        transition: "lapse",
      },
      {
        year: "Both true",
        state: { damage: false },
        camera: { fit: "all", pose: 1 },
        card: {
          title: "What the recovery data adds",
          body: "Structure says early gaps reach further. NWEA's own analysis, a technical report rather than peer-reviewed research, found middle schoolers' recovery stalled worst, because runway and intervention matter too. Both things can be true, and both are reasons this work is hard.",
          cite: "Peer-reviewed anchor: Kuhfeld, Soland & Lewis (2022), Educational Researcher",
          citeUrl: "https://doi.org/10.3102/0013189X221109178",
        },
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
        year: "Grades 3–6",
        state: { missed: ["code:3.OA.A.2", "code:4.NF.B.4", "code:6.RP.A.2"], damage: false },
        camera: { fit: "all", pose: 1 },
        card: {
          title: "Three holes out of 480",
          body: "Division as sharing. Multiplying fractions. Unit rates. The report cards said meets expectations, and nobody noticed, including the student. Three dark points in a field of hundreds.",
        },
        transition: "lapse",
      },
      {
        year: "Grade 7",
        state: {
          missed: ["code:3.OA.A.2", "code:4.NF.B.4", "code:6.RP.A.2"],
          damage: true,
          focus: "7.RP.A.2",
        },
        camera: { fit: ["ancestry:7.RP.A.2"], pose: 1 },
        card: {
          title: "Proportional reasoning arrives",
          body: "It stands on 75 earlier standards, and all three holes sit in its foundations. Three missing pieces are enough to make the floor feel like it is tilting, while every adult in the room wonders why.",
        },
        transition: "lapse",
      },
      {
        year: "The fix",
        state: {
          missed: ["code:3.OA.A.2", "code:4.NF.B.4", "code:6.RP.A.2"],
          damage: false,
          spotlight: ["code:3.OA.A.2", "code:4.NF.B.4", "code:6.RP.A.2", "code:7.RP.A.2"],
        },
        camera: { fit: ["code:3.OA.A.2", "code:4.NF.B.4", "code:6.RP.A.2", "code:7.RP.A.2"], pose: 1 },
        card: {
          title: "Find three holes, not three years",
          body: "This is the promise of seeing the structure. One-to-one mastery tutoring showed gains near two standard deviations in Bloom's small studies; scalable mastery programs average about half a standard deviation across 108 studies. The gap between those numbers is the work, and it starts with knowing exactly where the holes are.",
          cite: "Bloom (1984); Kulik, Kulik & Bangert-Drowns (1990)",
          citeUrl: "https://doi.org/10.3102/00346543060002265",
        },
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
        year: "Fall",
        state: { missed: ["grade:4"], damage: true, spotlight: ["grade:4", "grade:5"] },
        camera: { fit: ["grade:4", "grade:5"], pose: 1 },
        card: {
          title: "A fifth grader, one year behind",
          body: "The most common response to being behind is a year of review. In TNTP's study of five districts, students spent more than 500 hours a year on assignments below their grade level. Watch grade 5 drift past, unvisited.",
          cite: "TNTP (2018), The Opportunity Myth (report; mechanism in Schmidt et al. 2015)",
          citeUrl: "https://doi.org/10.3102/0013189X15603982",
        },
        transition: "lapse",
      },
      {
        year: "Next fall",
        state: { missed: ["grade:4", "grade:5"], damage: true },
        camera: { fit: ["grade:4", "grade:5", "grade:6"], pose: 1 },
        card: {
          title: "The gap that remediation built",
          body: "The review year is over, and now the grade 5 standards read as missed too. Remediation that replaces grade-level content manufactures next year's gap. Access to grade-level work is an opportunity-to-learn problem, and unequal access compounds exactly like this.",
          cite: "Schmidt, Burroughs, Zoido & Houang (2015), Educational Researcher",
          citeUrl: "https://doi.org/10.3102/0013189X15603982",
        },
        transition: "lapse",
      },
      {
        year: "The alternative",
        state: { missed: ["code:4.NF.B.4", "code:4.NBT.B.5"], damage: true },
        camera: { fit: ["grade:4", "grade:5"], pose: 1 },
        card: {
          title: "Grade-level work, targeted repair",
          body: "The alternative keeps grade 5 lit and fills the specific holes underneath. In TNTP's observational data, students who got more grade-level work grew more, and those who started behind gained about seven months relative to peers. An association from a descriptive study, and the structural logic of this map.",
          cite: "TNTP (2018), report, association not causation",
        },
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
        state: { focus: "F-IF.A.1" },
        camera: { fit: ["grade:HS"], pose: 1 },
        card: {
          title: "Ask who does the advanced work",
          body: "The concept of a function, nineteen prerequisites deep. Ask anyone which teacher in a district does the most advanced mathematical work, and they will point here, at the summit.",
        },
        transition: "lapse",
      },
      {
        year: "K",
        state: { spotlight: ["descendants:K.CC.A.1"] },
        camera: { fit: "all", pose: 1 },
        card: {
          title: "The root system",
          body: "Two hundred twenty-five standards, 47 percent of everything on this map, descend from one Kindergarten standard: count to 100 by ones and tens. School-entry math skills predict later achievement more strongly than early reading or attention, across six longitudinal datasets.",
          cite: "Duncan et al. (2007), Developmental Psychology; Watts et al. (2014)",
          citeUrl: "https://doi.org/10.1037/0012-1649.43.6.1428",
        },
        transition: "lapse",
      },
      {
        year: "",
        camera: { fit: ["grade:K", "grade:1"], pose: 1 },
        card: {
          title: "No such thing as just counting",
          body: "The person teaching counting is laying the foundation for half of high school mathematics. Even the misconception that trips children on fractions, treating one fifth as bigger than one fourth because five beats four, follows people into adulthood when the foundation is thin.",
          cite: "Braithwaite & Siegler (2018), Developmental Science",
          citeUrl: "https://doi.org/10.1111/desc.12541",
        },
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
        state: { focus: "7.RP.A.2" },
        camera: { fit: ["code:7.RP.A.2"], pose: 1 },
        card: {
          title: "A student is failing proportional reasoning",
          body: "The grade label says seventh grade. The structure says this standard stands on 75 earlier ones, reaching back to Kindergarten. Somewhere on that chain is the last thing this student can do securely.",
        },
        transition: "lapse",
      },
      {
        year: "Walk back",
        state: { focus: "7.RP.A.2", spotlight: ["ancestry:7.RP.A.2"] },
        camera: { fit: ["ancestry:7.RP.A.2"], pose: 1 },
        card: {
          title: "Descend the chain",
          body: "Walk the Builds-on list backward, one hop at a time: unit rates, fraction multiplication, division as sharing. Keep going until you reach solid ground. That is where teaching starts. Not at the grade label. At the gap.",
        },
        transition: "lapse",
      },
      {
        year: "Your turn",
        camera: { fit: "all", pose: 1 },
        card: {
          title: "Now do it for real",
          body: "Close this story, search any standard your students struggle with, and use Builds on to walk back. Fractions knowledge in elementary school uniquely predicts high school algebra, so the ground you find is worth standing on.",
          cite: "Siegler et al. (2012), Psychological Science",
          citeUrl: "https://doi.org/10.1177/0956797612440101",
        },
        transition: "lapse",
      },
    ],
  },
];
