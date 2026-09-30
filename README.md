# Coherence Map Explorer

A 3D map of every Common Core math standard from Kindergarten through high school: 480 standards, 757 prerequisite links, and 142 related-standard links, drawn as one navigable constellation. Search for a standard, click it, and watch everything it builds on light up grade by grade back to Kindergarten, along with everything it leads to next.

**Live site:** https://coherence-map-explorer.markhpaik.workers.dev

## Where this comes from

Student Achievement Partners built the original [Coherence Map](https://tools.achievethecore.org/coherence-map/) at achievethecore.org. It let teachers pick a standard and see its prerequisites, the standards it supports, and related work, one neighborhood at a time. The insight behind it is Jason Zimba's: the standards are not a checklist, they are a structure, and the structure is the point. A student who struggles with 7.RP.A.2 usually has a gap somewhere specific in grades 4 through 6, and the map shows you where to look.

The original tool's public repository is no longer maintained, but the complete dataset still ships with the site as a single file, `data.js`. This project vendors a snapshot of that file (see `data/raw/PROVENANCE.md`), rebuilds it into a knowledge graph, and renders the whole structure at once in 3D instead of one neighborhood at a time. The connection data, standard text, cluster designations, and Widely Applicable Prerequisite flags are Student Achievement Partners' work. The visualization is new.

## What the map shows

- **Position** runs left to right by grade, Kindergarten through grade 8, then high school split into its conceptual categories (Number, Algebra, Functions, Geometry, Statistics).
- **Color** follows the four great strands of school mathematics: number, algebra and functions, geometry, and measurement/data/statistics. Each strand reads as a colored river flowing across the grades.
- **Solid arcs** are prerequisites, directed from the earlier standard to the one that depends on it. **Faint dashed links** mark related standards.
- **Badges** on each standard carry the original map's designations: Major Work of the grade, Widely Applicable Prerequisite, and modeling (★) for high school.

Click any standard to focus it: the camera flies in, its full prerequisite ancestry cascades backward grade by grade, and a panel shows the standard text, its connections, a worked example (most by Illustrative Mathematics), links to tasks and assessment items, and progression notes.

## Running locally

```
npm install
npm run dev
```

`npm run dev` first runs the data pipeline (`scripts/build-graph.ts`), which parses the vendored `data.js`, applies the cited source corrections in `scripts/errata.json` (the snapshot file itself stays unchanged), validates it (480 standards, a cycle-free prerequisite graph, derived codes like `4.NF.B.3`), computes a deterministic 3D layout, and writes `public/data/graph-core.json` plus per-grade detail shards. Then it starts Vite. `npm test` runs the pipeline integrity tests. `npm run build` produces the deployable `dist/`.

## License

Everything here is free to use except the worked examples, which follow their providers' terms.

- **This project's code** is dedicated to the public domain under [CC0 1.0](LICENSE).
- **The coherence map data** comes from achievethecore.org, whose content is published under the Creative Commons CC0 Public Domain Dedication (see their [permissions page](https://achievethecore.org/ccpd)), except items marked ©. We credit Student Achievement Partners as the originators and would encourage anyone reusing the data to do the same.
- **The standards text** is from the Common Core State Standards, © 2010 National Governors Association Center for Best Practices and Council of Chief State School Officers, used under their public license.
- **Worked examples** appear in full in the side panel, copied from the original map's data. Illustrative Mathematics wrote 307 of the 326. Learning Heroes, Student Achievement Partners, Karen Fuson, and the Progressions documents wrote 12 more, and 7 carry no credit in the source data. The panel prints each example's credit line and a link to its source wherever the data has them, and the examples' images load from the providers' own servers. The examples remain their providers' work, so anyone reusing them should credit the provider and follow the provider's terms. The task, lesson, and assessment lists are links to the providers' sites.

## Credits

Student Achievement Partners / Achieve the Core built the original Coherence Map and the dataset this project builds on. Illustrative Mathematics wrote most of the worked examples the panel shows. Marble's [curriculum map](https://withmarble.com/curriculum/) showed how good a knowledge graph of school learning can look. This rebuild was designed and developed with Claude.
