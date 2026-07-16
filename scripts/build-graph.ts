/**
 * build-graph.ts — build-time data pipeline for the Coherence Map Explorer.
 *
 * Reads the vendored raw dump (data/raw/data.js), drops ELA/task/orphan blocks,
 * derives standard codes and strands, normalizes both edge kinds, sanitizes the
 * HTML text fields, computes a deterministic seeded 3D force layout, bakes edge
 * control points, and emits public/data/graph-core.json plus per-grade detail
 * shards.
 *
 * This module is NEVER imported by client code. It is executed via
 * `tsx scripts/build-graph.ts` (npm run data) and imported by the Vitest suite.
 *
 * Every structural fact from the data audit is asserted here — the build fails
 * loudly rather than silently emitting a wrong graph.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sanitizeHtml from "sanitize-html";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  forceZ,
} from "d3-force-3d";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const RAW_PATH = resolve(ROOT, "data/raw/data.js");
const OUT_DIR = resolve(ROOT, "public/data");
const DETAILS_DIR = resolve(OUT_DIR, "details");
const PARAMS_PATH = resolve(HERE, "layout-params.json");
const OVERRIDES_PATH = resolve(HERE, "layout-overrides.json");

const SOURCE_URL = "https://tools.achievethecore.org/coherence-map/data.js";
const ACHIEVE_BASE = "https://achievethecore.org";
const LICENSE = "CC0 (Achieve the Core) — see README";

const GRADE_ORDER = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "HS"] as const;
type Grade = (typeof GRADE_ORDER)[number];
const GRADE_LABELS: Record<Grade, string> = {
  K: "Kindergarten",
  "1": "Grade 1",
  "2": "Grade 2",
  "3": "Grade 3",
  "4": "Grade 4",
  "5": "Grade 5",
  "6": "Grade 6",
  "7": "Grade 7",
  "8": "Grade 8",
  HS: "High School",
};

type Strand = "number" | "algebra" | "geometry" | "data";
const STRAND_LABELS: Record<Strand, string> = {
  number: "Number & Quantity",
  algebra: "Algebra & Functions",
  geometry: "Geometry",
  data: "Data & Statistics",
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`[build-graph] assertion failed: ${msg}`);
}

/** Deterministic mulberry32 PRNG returning [0, 1). */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const numAsc = (a: string, b: string): number => Number(a) - Number(b);

// ---------------------------------------------------------------------------
// Raw types (loosely typed — the dump is untyped JSON)
// ---------------------------------------------------------------------------
interface RawStandard {
  id: string;
  ccmathcluster_id: string;
  ordinal: string;
  desc?: string;
  example_problem?: string;
  example_problem_url?: string;
  example_problem_attribution?: string;
  progressions?: string;
  links?: { name: string; links: { name: string; url: string }[] }[];
  modeling?: string;
  wap?: string;
}
interface RawCluster {
  id: string;
  ccmathdomain_id: string;
  ordinal: string;
  msa: string;
  name: string;
}
interface RawDomain {
  id: string;
  grade: string;
  ordinal: string;
  name: string;
}
interface RawEdge {
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------
interface OutNode {
  id: string;
  code: string;
  grade: Grade;
  strand: Strand;
  domain: string;
  domainName: string;
  clusterCode: string;
  msa: number;
  wap: boolean;
  modeling: boolean;
  deg: number;
  pos: [number, number, number]; // pose A: the constellation
  pos2: [number, number, number]; // pose B: the Ascent (y = dependency depth)
  /** Longest prerequisite chain beneath this standard (0 = foundation). */
  depth: number;
  /** Sub-standard ids (e.g. 4.NF.B.3 -> its .a-.d), code-derived; omitted when none. */
  children?: string[];
  /** Parent standard id for a sub-standard; omitted at top level. */
  parent?: string;
  /** HS only: Appendix A traditional-pathway membership, e.g. ["A1","A2"]. */
  courses?: string[];
}
interface OutEdge {
  s: string;
  t: string;
  k: 0 | 1;
  c: [number, number, number]; // bezier control, constellation pose
  c2: [number, number, number]; // bezier control, ascent pose
}
interface GraphCore {
  meta: {
    standards: number;
    prereqEdges: number;
    relatedEdges: number;
    source: string;
    license: string;
  };
  grades: {
    id: Grade;
    label: string;
    x0: number;
    x1: number;
    marker?: [number, number, number]; // constellation pose etch
    marker2?: [number, number, number]; // ascent pose etch
  }[];
  /** HS course arc labels (Appendix A traditional pathway), markers per pose. */
  courses: {
    id: string;
    label: string;
    marker: [number, number, number];
    marker2: [number, number, number];
  }[];
  strands: Record<Strand, { label: string }>;
  nodes: OutNode[];
  edges: OutEdge[];
}
interface DetailEntry {
  desc?: string;
  example?: string;
  exampleAttr?: string;
  exampleUrl?: string;
  progressions?: string;
  clusterName?: string;
  tasks?: { group: string; name: string; url: string }[];
}
/** One lightweight, HTML-free record per standard, for the client search index. */
interface SearchDoc {
  id: string;
  code: string;
  grade: Grade;
  strand: Strand;
  text: string; // plain-text desc (math stripped, tags removed), ~240 chars
  domainName: string;
  clusterName: string;
  /** 1 when the standard carries a worked example (hover advertises it). */
  ex?: 1;
}

// ---------------------------------------------------------------------------
// Strand mapping (hard-fails on any unmapped domain ordinal)
// ---------------------------------------------------------------------------
function strandOf(ord: string): Strand | null {
  if (ord.startsWith("N-") || ["CC", "NBT", "NF", "RP", "NS"].includes(ord))
    return "number";
  if (
    ord.startsWith("A-") ||
    ord.startsWith("F-") ||
    ["OA", "EE", "F"].includes(ord)
  )
    return "algebra";
  if (ord.startsWith("G-") || ord === "G") return "geometry";
  if (ord.startsWith("S-") || ["MD", "SP"].includes(ord)) return "data";
  return null;
}

// ---------------------------------------------------------------------------
// HTML sanitization
// ---------------------------------------------------------------------------
export function absolutize(url: string): string {
  if (!url) return url;
  // Protocol-relative ("//host/path") — adopt https, do NOT treat as a
  // site-root path (that would yield "https://achievethecore.org//host/path").
  // Must be checked before the single-slash case, since "//" also starts "/".
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return ACHIEVE_BASE + url;
  return url;
}

// Link-rot remediation (scripts/link-fixes.json): dead pages rewrite to
// Wayback snapshots; permanently-expired signed image URLs are stripped.
// Counters feed the pipeline report.
interface LinkFixes {
  rewrites: Record<string, string>;
  deadImagePatterns: string[];
}
const linkFixes: LinkFixes = JSON.parse(
  readFileSync(resolve(HERE, "link-fixes.json"), "utf-8"),
);
let rewrittenLinks = 0;
let strippedImages = 0;

function fixUrl(url: string): string {
  const abs = absolutize(url);
  const fixed = linkFixes.rewrites[abs];
  if (fixed) {
    rewrittenLinks++;
    return fixed;
  }
  return abs;
}

function isDeadImage(url: string): boolean {
  return linkFixes.deadImagePatterns.some((p) => url.includes(p));
}

// HS traditional-pathway course map (scripts/hs-course-map.json, derived from
// CCSS Appendix A's Traditional Pathway tables — see its source/notes fields).
// The dump's own course-framework fields are vestigial (all zeros), so this
// vendored mapping is the authority. Standards in both A1 and A2 are placed at
// their FIRST course and carry the full membership in `courses` (the panel
// says "revisited in Algebra II"). The 16 (+) fourth-course standards form an
// "ADV" shelf at the spiral's rim.
interface HsCourseMap {
  map: Record<string, string[]>;
  unmapped: string[];
  courses: Record<string, string>;
}
const hsCourses: HsCourseMap = JSON.parse(
  readFileSync(resolve(HERE, "hs-course-map.json"), "utf-8"),
);
const COURSE_ORDER = ["A1", "G", "A2", "ADV"] as const;
const COURSE_LABELS: Record<string, string> = {
  A1: "Algebra I",
  G: "Geometry",
  A2: "Algebra II",
  ADV: "Advanced",
};
function hsCoursesOf(code: string): string[] {
  if (hsCourses.unmapped.includes(code)) return ["ADV"];
  const m = hsCourses.map[code];
  if (m?.length) return m;
  throw new Error(`[build-graph] HS code ${code} missing from hs-course-map.json`);
}

/**
 * Scheme guard for the STRUCTURED link fields (task URLs, worked-example source
 * URL). Those fields skip sanitizeHtml — they are assigned straight to `a.href`
 * in panel.ts — so a `javascript:`/`data:`/`vbscript:` URL in the source would
 * be a live click-XSS. Accept only absolute http(s) after link-fix
 * normalization; anything else (other scheme, protocol-relative, or bare/
 * scheme-less) returns undefined and the caller drops the field. Site-root
 * ("/…") URLs are fine — fixUrl absolutizes them to https://achievethecore.org.
 */
export function safeLinkUrl(url: string): string | undefined {
  const fixed = fixUrl(url);
  return /^https?:\/\//i.test(fixed) ? fixed : undefined;
}

const sanitizeOpts: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tr",
    "td",
    "th",
    "sub",
    "sup",
    "b",
    "strong",
    "i",
    "em",
    "span",
    "h3",
    "img",
    "a",
  ],
  allowedAttributes: {
    span: ["class", "data-def"],
    a: ["href", "target", "rel"],
    img: ["src", "alt", "loading", "decoding"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan"],
  },
  allowedSchemes: ["http", "https"],
  // Disallowed tags (e.g. <div>, <h1>, <h2> pre-transform) discard the tag but
  // keep their text content.
  disallowedTagsMode: "discard",
  transformTags: {
    h1: "h3",
    h2: "h3",
    a: (_tag: string, attribs): sanitizeHtml.Tag => {
      const href = fixUrl(attribs.href || "");
      const isExternal = /^https?:\/\//i.test(href);
      // Glossary anchor: has an id (the definition text) and no external link.
      if (!isExternal && attribs.id) {
        const out: Record<string, string> = {
          class: "term",
          "data-def": attribs.id,
        };
        return { tagName: "span", attribs: out };
      }
      if (isExternal) {
        const out: Record<string, string> = {
          href,
          target: "_blank",
          rel: "noopener",
        };
        return { tagName: "a", attribs: out };
      }
      // Anchor with neither a usable href nor an id: drop to a bare span.
      return { tagName: "span", attribs: {} };
    },
    img: (_tag: string, attribs): sanitizeHtml.Tag => {
      const src = fixUrl(attribs.src || "");
      if (isDeadImage(src)) {
        strippedImages++;
        return { tagName: "span", attribs: {} }; // renders nothing
      }
      const out: Record<string, string> = {
        src,
        loading: "lazy",
        decoding: "async",
      };
      if (attribs.alt) out.alt = attribs.alt;
      return { tagName: "img", attribs: out };
    },
  },
};

// MathJax delimiters are plain text and must survive verbatim. htmlparser2 can
// mis-tokenize a raw "<" that sits inside math (e.g. "$x<y$" → phantom <y> tag),
// so we placeholder every math span before sanitizing and restore it after.
const MATH_PATTERNS: RegExp[] = [
  /\$\$[\s\S]*?\$\$/g, // $$...$$
  /\\\[[\s\S]*?\\\]/g, // \[...\]
  /\\\([\s\S]*?\\\)/g, // \(...\)
  /\$[^$\n]*?\$/g, // $...$
];

// Sentinel wrapping each protected math span. U+2063 (INVISIBLE SEPARATOR) has
// no legitimate use in this content; any pre-existing occurrence in the source
// is stripped before protecting so crafted input can't forge a token like
// `⁣MATH0⁣` and smuggle another span's stored index into the restored output.
const MATH_TOKEN_DELIM = "⁣";
const MATH_TOKEN_RE = new RegExp(
  `${MATH_TOKEN_DELIM}MATH(\\d+)${MATH_TOKEN_DELIM}`,
  "g",
);

/**
 * Minimal HTML escape for text that will be assigned via innerHTML. `&` MUST be
 * escaped first, otherwise the `&` in the `&lt;`/`&gt;` we introduce would be
 * double-escaped. The round-trip is faithful: on innerHTML assignment the
 * browser un-escapes `&amp;`/`&lt;`/`&gt;` back to `&`/`<`/`>` in the resulting
 * text node, so KaTeX auto-render (which reads text nodes) receives the exact
 * original LaTeX source — while the raw string is inert as HTML on assignment.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function sanitizeField(html: string | undefined): string {
  if (!html) return "";
  const store: string[] = [];
  // Neutralize any pre-existing sentinel delimiters so injected source text
  // cannot forge a placeholder token (and thus smuggle a stored index).
  let work = html.split(MATH_TOKEN_DELIM).join("");
  for (const re of MATH_PATTERNS) {
    work = work.replace(re, (m) => {
      const token = `${MATH_TOKEN_DELIM}MATH${store.length}${MATH_TOKEN_DELIM}`;
      store.push(m);
      return token;
    });
  }
  let clean = sanitizeHtml(work, sanitizeOpts);
  // Restore each math span, but HTML-ESCAPE its raw source. Without this, any
  // markup inside `$…$` (e.g. `$<img onerror=…>$`, or prose caught between a
  // stray pair of `$`) would bypass sanitizeHtml and reach panel.ts's innerHTML
  // as live HTML. Escaping makes it inert on assignment while preserving the
  // LaTeX for KaTeX (see escapeHtml). A missing index restores to nothing.
  clean = clean.replace(MATH_TOKEN_RE, (_m, i) => {
    const src = store[Number(i)];
    return src === undefined ? "" : escapeHtml(src);
  });
  return clean.trim();
}

const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
  "&times;": "×",
  "&ge;": "≥",
  "&le;": "≤",
};

/**
 * Plain-text projection of a raw HTML desc for the search index. Math spans are
 * dropped first (so a stray `<` inside `$a<b$` can't merge with a later real
 * `>` and swallow prose), then tags are stripped, entities decoded, whitespace
 * collapsed, and the result truncated at a word boundary near ~240 chars.
 */
function toSearchText(html: string | undefined, limit = 240): string {
  if (!html) return "";
  let s = html;
  for (const re of MATH_PATTERNS) s = s.replace(re, " ");
  s = s.replace(/<[^>]*>/g, " ");
  s = s.replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)));
  s = s.replace(/&[a-z]+;/gi, (m) => HTML_ENTITIES[m] ?? " ");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length <= limit) return s;
  const cut = s.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + "…";
}

// ---------------------------------------------------------------------------
// Main build
// ---------------------------------------------------------------------------
export interface BuildResult {
  core: GraphCore;
  details: Record<Grade, Record<string, DetailEntry>>;
  search: SearchDoc[];
  report: {
    standards: number;
    prereqEdges: number;
    relatedEdges: number;
    isolated: number;
    droppedClusters: number;
    topDegree: { code: string; deg: number }[];
    bounds: {
      x: [number, number];
      y: [number, number];
      z: [number, number];
    };
  };
}

interface Params {
  seed: number;
  bandWidth: number;
  bandGapRatio: number;
  hsWidthMultiplier: number;
  bandMargin: number;
  radius: number;
  isolatedRadius: number;
  seedJitter: number;
  strandHomeAngles: Record<Strand, number>;
  force: {
    prereqDistance: number;
    relatedDistance: number;
    prereqStrength: number;
    relatedStrength: number;
    charge: number;
    collideRadius: number;
    radialStrength: number;
    xStrength: number;
  };
  ticks: number;
  alphaMin: number;
  velocityDecay: number;
  ctrl: { push: number; jitter: number; nearAxisEpsilon: number };
  ascent: { yStep: number; yBase: number; zScale: number };
}

interface SimNode {
  id: string;
  strand: Strand;
  grade: Grade;
  band: Band;
  subCol: number; // -1 for non-HS
  x: number;
  y: number;
  z: number;
}
interface Band {
  id: Grade;
  x0: number;
  x1: number;
  center: number;
}

export function buildGraph(): BuildResult {
  const params: Params = JSON.parse(readFileSync(PARAMS_PATH, "utf8"));
  const overrides: Record<string, [number, number, number]> = JSON.parse(
    readFileSync(OVERRIDES_PATH, "utf8"),
  );
  const rng = makeRng(params.seed);

  // --- 1. Read + parse ------------------------------------------------------
  let raw = readFileSync(RAW_PATH, "utf8").trim();
  raw = raw.replace(/^window\.cc\s*=\s*/, "").replace(/;\s*$/, "");
  const cc = JSON.parse(raw) as {
    standards: Record<string, RawStandard>;
    clusters: Record<string, RawCluster>;
    domains: Record<string, RawDomain>;
    edges: RawEdge[];
    nd_edges: RawEdge[];
  };

  const standards = cc.standards;
  const clusters = cc.clusters;
  const domains = cc.domains;

  // --- 2. Drop orphan clusters; validate join integrity --------------------
  const usedClusterIds = new Set<string>();
  for (const s of Object.values(standards)) usedClusterIds.add(s.ccmathcluster_id);

  let droppedClusters = 0;
  const keptClusters: Record<string, RawCluster> = {};
  for (const c of Object.values(clusters)) {
    const domainExists = Boolean(domains[c.ccmathdomain_id]);
    const used = usedClusterIds.has(c.id);
    if (!domainExists) {
      // Orphan cluster referencing a missing domain — must be used by nobody.
      assert(!used, `orphan cluster ${c.id} (missing domain) is used by a standard`);
      droppedClusters++;
      continue;
    }
    keptClusters[c.id] = c;
  }
  assert(droppedClusters === 6, `expected to drop 6 orphan clusters, dropped ${droppedClusters}`);

  const standardList = Object.values(standards);
  assert(standardList.length === 480, `expected 480 standards, got ${standardList.length}`);
  for (const s of standardList) {
    const c = keptClusters[s.ccmathcluster_id];
    assert(c, `standard ${s.id} references missing/dropped cluster ${s.ccmathcluster_id}`);
    assert(domains[c.ccmathdomain_id], `cluster ${c.id} references missing domain`);
  }

  // --- 3. Derive codes ------------------------------------------------------
  function deriveCode(s: RawStandard): string {
    const c = keptClusters[s.ccmathcluster_id];
    const d = domains[c.ccmathdomain_id];
    return d.grade === "HS"
      ? `${d.ordinal}.${c.ordinal}.${s.ordinal}`
      : `${d.grade}.${d.ordinal}.${c.ordinal}.${s.ordinal}`;
  }
  const codeById = new Map<string, string>();
  const seenCodes = new Set<string>();
  for (const s of standardList) {
    const code = deriveCode(s);
    assert(!seenCodes.has(code), `duplicate derived code ${code}`);
    seenCodes.add(code);
    codeById.set(s.id, code);
  }
  assert(codeById.get("9") === "1.MD.A.1", `golden code: id 9 → ${codeById.get("9")}`);
  assert(seenCodes.has("F-IF.A.1"), "golden code F-IF.A.1 missing");
  assert(seenCodes.has("4.NF.B.3.a"), "golden code 4.NF.B.3.a missing");

  // --- 4. Strand assignment (hard-fail on unmapped domain ordinal) ---------
  const distinctOrdinals = new Set<string>();
  for (const c of Object.values(keptClusters))
    distinctOrdinals.add(domains[c.ccmathdomain_id].ordinal);
  const unmapped = [...distinctOrdinals].filter((o) => strandOf(o) === null);
  assert(
    unmapped.length === 0,
    `unmapped domain ordinal(s): ${unmapped.join(", ")}`,
  );

  // --- Grade bands (X axis) -------------------------------------------------
  const W = params.bandWidth;
  const gap = params.bandGapRatio * W;
  const bands = new Map<Grade, Band>();
  let cursor = 0;
  for (const g of GRADE_ORDER) {
    const width = g === "HS" ? W * params.hsWidthMultiplier : W;
    const x0 = cursor;
    const x1 = cursor + width;
    bands.set(g, { id: g, x0, x1, center: (x0 + x1) / 2 });
    cursor = x1 + gap;
  }
  // Center the whole X extent about the origin.
  const totalWidth = cursor - gap;
  const shift = -totalWidth / 2;
  for (const b of bands.values()) {
    b.x0 += shift;
    b.x1 += shift;
    b.center += shift;
  }

  // HS sub-bands are the Traditional Pathway course sequence (A1, G, A2, ADV),
  // with widths proportional to how many standards live primarily in each —
  // the outer arc of the spiral literally becomes Algebra I -> Geometry ->
  // Algebra II -> advanced rim.
  const coursePrimaryCount = new Map<string, number>(COURSE_ORDER.map((c) => [c, 0]));
  for (const courses of Object.values(hsCourses.map)) {
    coursePrimaryCount.set(courses[0], (coursePrimaryCount.get(courses[0]) ?? 0) + 1);
  }
  coursePrimaryCount.set("ADV", hsCourses.unmapped.length);
  const courseTotal = [...coursePrimaryCount.values()].reduce((a, b) => a + b, 0);
  const courseBounds: number[] = [0];
  for (const c of COURSE_ORDER) {
    courseBounds.push(courseBounds[courseBounds.length - 1] + (coursePrimaryCount.get(c) ?? 0) / courseTotal);
  }
  function hsSubColumn(code: string): number {
    return COURSE_ORDER.indexOf(hsCoursesOf(code)[0] as (typeof COURSE_ORDER)[number]);
  }
  function subColInterval(band: Band, subCol: number): [number, number] {
    const w = band.x1 - band.x0;
    return [band.x0 + courseBounds[subCol] * w, band.x0 + courseBounds[subCol + 1] * w];
  }

  // --- Build node metadata --------------------------------------------------
  interface NodeMeta {
    id: string;
    code: string;
    grade: Grade;
    strand: Strand;
    domainOrd: string;
    domainName: string;
    clusterCode: string;
    msa: number;
    wap: boolean;
    modeling: boolean;
    subCol: number;
  }
  const meta = new Map<string, NodeMeta>();
  const gradeCount: Record<string, number> = {};
  for (const s of standardList) {
    const c = keptClusters[s.ccmathcluster_id];
    const d = domains[c.ccmathdomain_id];
    const grade = d.grade as Grade;
    const strand = strandOf(d.ordinal)!;
    const subCol = grade === "HS" ? hsSubColumn(codeById.get(s.id)!) : -1;
    const clusterCode =
      grade === "HS"
        ? `${d.ordinal}.${c.ordinal}`
        : `${grade}.${d.ordinal}.${c.ordinal}`;
    const msa = Number(c.msa);
    assert(msa === 0 || msa === 1 || msa === 2, `bad msa ${c.msa} on cluster ${c.id}`);
    meta.set(s.id, {
      id: s.id,
      code: codeById.get(s.id)!,
      grade,
      strand,
      domainOrd: d.ordinal,
      domainName: d.name,
      clusterCode,
      msa,
      wap: s.wap === "1",
      modeling: s.modeling === "1",
      subCol,
    });
    gradeCount[grade] = (gradeCount[grade] || 0) + 1;
  }

  // --- 5. Edges -------------------------------------------------------------
  const validIds = new Set(Object.keys(standards));
  // Prereq (directed)
  const prereq: { s: string; t: string }[] = [];
  const seenPrereq = new Set<string>();
  for (const e of cc.edges) {
    assert(validIds.has(e.from) && validIds.has(e.to), `dangling prereq edge ${e.from}->${e.to}`);
    assert(e.from !== e.to, `self-loop prereq edge on ${e.from}`);
    const key = `${e.from}>${e.to}`;
    assert(!seenPrereq.has(key), `duplicate prereq edge ${key}`);
    seenPrereq.add(key);
    prereq.push({ s: e.from, t: e.to });
  }
  assert(prereq.length === 757, `expected 757 prereq edges, got ${prereq.length}`);

  // DAG check (Kahn topological sort)
  {
    const indeg = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const id of validIds) {
      indeg.set(id, 0);
      adj.set(id, []);
    }
    for (const e of prereq) {
      adj.get(e.s)!.push(e.t);
      indeg.set(e.t, indeg.get(e.t)! + 1);
    }
    const queue = [...validIds].filter((id) => indeg.get(id) === 0);
    let visited = 0;
    while (queue.length) {
      const n = queue.shift()!;
      visited++;
      for (const m of adj.get(n)!) {
        indeg.set(m, indeg.get(m)! - 1);
        if (indeg.get(m) === 0) queue.push(m);
      }
    }
    assert(visited === validIds.size, `prereq edges are not a DAG (cycle detected)`);
  }

  // Related (undirected, deduped)
  const relatedSet = new Set<string>();
  for (const e of cc.nd_edges) {
    assert(validIds.has(e.from) && validIds.has(e.to), `dangling related edge ${e.from}->${e.to}`);
    if (e.from === e.to) continue;
    const [a, b] = numAsc(e.from, e.to) <= 0 ? [e.from, e.to] : [e.to, e.from];
    relatedSet.add(`${a}|${b}`);
  }
  const related = [...relatedSet].map((p) => {
    const [s, t] = p.split("|");
    return { s, t };
  });
  assert(related.length === 142, `expected 142 related edges, got ${related.length}`);

  // Degrees (both kinds count)
  const deg = new Map<string, number>();
  for (const id of validIds) deg.set(id, 0);
  for (const e of prereq) {
    deg.set(e.s, deg.get(e.s)! + 1);
    deg.set(e.t, deg.get(e.t)! + 1);
  }
  for (const e of related) {
    deg.set(e.s, deg.get(e.s)! + 1);
    deg.set(e.t, deg.get(e.t)! + 1);
  }

  // --- 7. Layout ------------------------------------------------------------
  const HALF_PI_TURN = Math.PI / 180;
  function homePoint(strand: Strand): [number, number] {
    const a = params.strandHomeAngles[strand] * HALF_PI_TURN;
    return [params.radius * Math.cos(a), params.radius * Math.sin(a)];
  }

  const sortedIds = [...validIds].sort(numAsc);
  const simNodes: SimNode[] = [];
  const isolatedIds: string[] = [];
  for (const id of sortedIds) {
    if (deg.get(id) === 0) {
      isolatedIds.push(id);
      continue;
    }
    const m = meta.get(id)!;
    const band = bands.get(m.grade)!;
    const [hy, hz] = homePoint(m.strand);
    const cx = m.grade === "HS" ? (subColInterval(band, m.subCol)[0] + subColInterval(band, m.subCol)[1]) / 2 : band.center;
    simNodes.push({
      id,
      strand: m.strand,
      grade: m.grade,
      band,
      subCol: m.subCol,
      x: cx + (rng() - 0.5) * params.seedJitter,
      y: hy + (rng() - 0.5) * params.seedJitter,
      z: hz + (rng() - 0.5) * params.seedJitter,
    });
  }

  // Clamp helper (X only; sub-column for HS)
  const margin = params.bandMargin;
  function clampX(n: SimNode): void {
    let lo: number, hi: number;
    if (n.grade === "HS") {
      [lo, hi] = subColInterval(n.band, n.subCol);
    } else {
      lo = n.band.x0;
      hi = n.band.x1;
    }
    lo += margin;
    hi -= margin;
    if (n.x < lo) n.x = lo;
    else if (n.x > hi) n.x = hi;
  }

  // Links over both edge kinds.
  const simLinks = [
    ...prereq.map((e) => ({ source: e.s, target: e.t, kind: 0 })),
    ...related.map((e) => ({ source: e.s, target: e.t, kind: 1 })),
  ];

  const F = params.force;
  const sim = forceSimulation(simNodes, 3).stop();
  sim.force(
    "link",
    forceLink(simLinks)
      .id((n: SimNode) => n.id)
      .distance((l: { kind: number }) => (l.kind === 0 ? F.prereqDistance : F.relatedDistance))
      .strength((l: { kind: number }) => (l.kind === 0 ? F.prereqStrength : F.relatedStrength)),
  );
  sim.force("charge", forceManyBody().strength(F.charge));
  sim.force("collide", forceCollide(F.collideRadius));
  sim.force(
    "x",
    forceX((n: SimNode) =>
      n.grade === "HS"
        ? (subColInterval(n.band, n.subCol)[0] + subColInterval(n.band, n.subCol)[1]) / 2
        : n.band.center,
    ).strength(F.xStrength),
  );
  sim.force("y", forceY((n: SimNode) => homePoint(n.strand)[0]).strength(F.radialStrength));
  sim.force("z", forceZ((n: SimNode) => homePoint(n.strand)[1]).strength(F.radialStrength));
  sim.velocityDecay(params.velocityDecay);
  sim.randomSource(rng);
  const alphaDecay = 1 - Math.pow(params.alphaMin, 1 / params.ticks);
  sim.alpha(1).alphaMin(params.alphaMin).alphaDecay(alphaDecay);

  for (let i = 0; i < params.ticks; i++) {
    sim.tick();
    for (const n of simNodes) clampX(n);
  }
  for (const n of simNodes) clampX(n);

  // Position map
  const pos = new Map<string, [number, number, number]>();
  for (const n of simNodes) pos.set(n.id, [n.x, n.y, n.z]);

  // Standard families: a "parent" standard like 4.NF.B.3 whose sub-standards
  // are 4.NF.B.3.a-d. Derived purely from code prefixes; the raw data carries
  // no explicit link. 13 such parents have zero edges of their own while their
  // children hold all the connections — the original tool's UI hid this, but a
  // bare "no connections" dead-end is exactly wrong for the one standard our
  // own search placeholder advertises. We do NOT fabricate edges (the 757
  // stays verbatim ATC data); instead we emit the family relation and seat
  // edgeless parents at their children's centroid rather than on the halo.
  const childrenOf = new Map<string, string[]>(); // parent id -> child ids
  const parentOf = new Map<string, string>(); // child id -> parent id
  const idByCode = new Map<string, string>();
  for (const [id, c] of codeById) idByCode.set(c, id);
  for (const [id, code] of codeById) {
    const dot = code.lastIndexOf(".");
    if (dot <= 0) continue;
    const parentCode = code.slice(0, dot);
    const pid = idByCode.get(parentCode);
    if (!pid) continue;
    parentOf.set(id, pid);
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid)!.push(id);
  }
  for (const kids of childrenOf.values()) kids.sort((a, b) => codeById.get(a)!.localeCompare(codeById.get(b)!));

  // Isolated nodes: parents with placed children sit at the family centroid
  // (slightly offset so they don't overlap a child); the rest form the
  // golden-angle halo ring per band.
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const bandIsoIndex = new Map<Grade, number>();
  const haloIds: string[] = [];
  for (const id of isolatedIds) {
    const kids = (childrenOf.get(id) ?? []).filter((k) => pos.has(k));
    if (kids.length) {
      let cx = 0, cy = 0, cz = 0;
      for (const k of kids) {
        const kp = pos.get(k)!;
        cx += kp[0]; cy += kp[1]; cz += kp[2];
      }
      const n = kids.length;
      // Lift slightly above the family plane; clamp X into the parent's band.
      const band = bands.get(meta.get(id)!.grade)!;
      const x = Math.min(band.x1, Math.max(band.x0, cx / n));
      pos.set(id, [x, cy / n + 9, cz / n]);
      continue;
    }
    haloIds.push(id);
  }
  for (const id of haloIds) {
    const m = meta.get(id)!;
    const band = bands.get(m.grade)!;
    const idx = bandIsoIndex.get(m.grade) ?? 0;
    bandIsoIndex.set(m.grade, idx + 1);
    const a = GOLDEN * idx;
    pos.set(id, [
      band.center,
      params.isolatedRadius * Math.cos(a),
      params.isolatedRadius * Math.sin(a),
    ]);
  }

  // Overrides (applied last). Validated: an unknown code fails the build
  // loudly (a typo'd override silently no-oping cost us an audit finding),
  // and the x coordinate is re-clamped into the standard's grade band so an
  // override can art-direct within a band but never tear a node out of it.
  for (const [code, xyz] of Object.entries(overrides)) {
    const id = [...codeById.entries()].find(([, c]) => c === code)?.[0];
    assert(id, `layout-overrides.json: unknown standard code "${code}"`);
    const band = bands.get(meta.get(id)!.grade)!;
    const x = Math.min(band.x1 - params.bandMargin, Math.max(band.x0 + params.bandMargin, xyz[0]));
    pos.set(id, [x, xyz[1], xyz[2]]);
  }

  // --- 7b. Pose B: the Ascent ------------------------------------------------
  // Two poses ship per node. Pose A (`pos`) is the band-relaxed constellation
  // — the explorable galaxy. Pose B (`pos2`) is the Ascent, the canonical
  // layered drawing of the partial order itself: x keeps the grade/course
  // timeline, z keeps the relaxed cross-section, and y becomes the standard's
  // longest-prerequisite-chain depth — a graph invariant, so every standard
  // rests physically above everything it builds on and every prerequisite
  // edge points upward. Stories and the Gaps simulator unravel the
  // constellation into this pose; a view toggle offers it to everyone.
  const depthById = new Map<string, number>();
  {
    // Longest-path layering over the prereq DAG (Kahn order, then relax).
    const indegD = new Map<string, number>();
    for (const id of validIds) {
      indegD.set(id, 0);
      depthById.set(id, 0);
    }
    for (const e of prereq) indegD.set(e.t, indegD.get(e.t)! + 1);
    const succD = new Map<string, string[]>();
    for (const e of prereq) {
      if (!succD.has(e.s)) succD.set(e.s, []);
      succD.get(e.s)!.push(e.t);
    }
    const queue = [...validIds].filter((id) => indegD.get(id) === 0).sort(numAsc);
    while (queue.length) {
      const u = queue.shift()!;
      for (const v of succD.get(u) ?? []) {
        depthById.set(v, Math.max(depthById.get(v)!, depthById.get(u)! + 1));
        indegD.set(v, indegD.get(v)! - 1);
        if (indegD.get(v) === 0) queue.push(v);
      }
    }
  }
  const A = params.ascent;
  const pos2 = new Map<string, [number, number, number]>();
  for (const [id, p] of pos) {
    pos2.set(id, [p[0], A.yBase + depthById.get(id)! * A.yStep, p[2] * A.zScale]);
  }

  // Markers, both poses: constellation etches stand below the bands (as
  // before); ascent etches stand along the ground line of the massif.
  const gradeMarkers = new Map<Grade, { a: [number, number, number]; b: [number, number, number] }>();
  for (const [g, b] of bands) {
    if (g === "HS") continue; // labeled by courses instead
    gradeMarkers.set(g, {
      a: [round2(b.center), -240, 0],
      b: [round2(b.center), A.yBase - 34, 0],
    });
  }
  const courseMarkers: {
    id: string;
    label: string;
    marker: [number, number, number];
    marker2: [number, number, number];
  }[] = [];
  {
    const hsBand = bands.get("HS")!;
    COURSE_ORDER.forEach((c, i) => {
      const [lo, hi] = subColInterval(hsBand, i);
      const cx = round2((lo + hi) / 2);
      // Two ranks: long course names over narrow sub-bands collide when they
      // share one ground line, so odd-indexed labels step decisively back and
      // down (-56/-14 with the smaller course type clears every pairing from
      // oblique camera angles, not just head-on).
      const rank = i % 2;
      const zOff = rank * -56;
      const yOff = rank * -14;
      courseMarkers.push({
        id: c,
        label: COURSE_LABELS[c],
        marker: [cx, -240 + yOff, zOff],
        marker2: [cx, A.yBase - 34 + yOff, zOff],
      });
    });
  }

  // --- 8. Edge control points, both poses -------------------------------------
  // Pose A (constellation): bow radially outward from the grade axis, exactly
  // the field the original art gate approved. Pose B (ascent): bow gently
  // upward and forward so arcs read as load paths climbing the structure.
  // One seeded jitter value per edge is shared by both poses so the morph
  // between them never changes an arc's character, only its frame.
  function controlPoints(
    s: string,
    t: string,
    srcStrand: Strand,
  ): { c: [number, number, number]; c2: [number, number, number] } {
    const jitterU = rng() * 2 - 1; // one draw per edge — POSES MUST SHARE IT
    // Pose A
    const a = pos.get(s)!;
    const b = pos.get(t)!;
    {
      var mx = (a[0] + b[0]) / 2;
      var my = (a[1] + b[1]) / 2;
      var mz = (a[2] + b[2]) / 2;
    }
    const chordA = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const pushA = params.ctrl.push * chordA;
    const rr = Math.hypot(my, mz);
    let dy: number, dz: number;
    if (rr < params.ctrl.nearAxisEpsilon) {
      const [hy, hz] = homePoint(srcStrand);
      const hl = Math.hypot(hy, hz) || 1;
      dy = hy / hl;
      dz = hz / hl;
    } else {
      dy = my / rr;
      dz = mz / rr;
    }
    const py = -dz;
    const pz = dy;
    const jitA = pushA * params.ctrl.jitter * jitterU;
    const c: [number, number, number] = [
      round2(mx),
      round2(my + dy * pushA + py * jitA),
      round2(mz + dz * pushA + pz * jitA),
    ];
    // Pose B: same midpoint recipe in ascent space, bowing upward (+y) with
    // lateral (z) jitter — arcs vault over the layers they skip.
    const a2 = pos2.get(s)!;
    const b2 = pos2.get(t)!;
    const m2x = (a2[0] + b2[0]) / 2;
    const m2y = (a2[1] + b2[1]) / 2;
    const m2z = (a2[2] + b2[2]) / 2;
    const chordB = Math.hypot(a2[0] - b2[0], a2[1] - b2[1], a2[2] - b2[2]);
    const pushB = params.ctrl.push * chordB;
    const jitB = pushB * params.ctrl.jitter * jitterU;
    const c2: [number, number, number] = [
      round2(m2x),
      round2(m2y + pushB),
      round2(m2z + jitB),
    ];
    return { c, c2 };
  }

  // Display degree: an edgeless parent (deg 0) sizes to the count of distinct
  // external standards its sub-standards connect to, so a cluster-heading node
  // reads as substantial rather than a lone speck. Purely a visual radius input
  // — the emitted edge set is unchanged.
  const neighborIds = new Map<string, Set<string>>();
  for (const id of validIds) neighborIds.set(id, new Set());
  for (const e of prereq) {
    neighborIds.get(e.s)!.add(e.t);
    neighborIds.get(e.t)!.add(e.s);
  }
  for (const e of related) {
    neighborIds.get(e.s)!.add(e.t);
    neighborIds.get(e.t)!.add(e.s);
  }
  const displayDeg = new Map<string, number>(deg);
  for (const [pid, kids] of childrenOf) {
    if (deg.get(pid) !== 0) continue;
    const family = new Set([pid, ...kids]);
    const ext = new Set<string>();
    for (const k of kids) for (const nb of neighborIds.get(k) ?? []) if (!family.has(nb)) ext.add(nb);
    if (ext.size) displayDeg.set(pid, ext.size);
  }

  // --- 9. Emit --------------------------------------------------------------
  const nodes: OutNode[] = sortedIds.map((id) => {
    const m = meta.get(id)!;
    const p = pos.get(id)!;
    for (const v of p) assert(Number.isFinite(v), `non-finite position on ${id}`);
    const out: OutNode = {
      id,
      code: m.code,
      grade: m.grade,
      strand: m.strand,
      domain: m.domainOrd,
      domainName: m.domainName,
      clusterCode: m.clusterCode,
      msa: m.msa,
      wap: m.wap,
      modeling: m.modeling,
      deg: displayDeg.get(id)!,
      pos: [round2(p[0]), round2(p[1]), round2(p[2])],
      pos2: (() => {
        const q = pos2.get(id)!;
        for (const v of q) assert(Number.isFinite(v), `non-finite ascent position on ${id}`);
        return [round2(q[0]), round2(q[1]), round2(q[2])] as [number, number, number];
      })(),
      depth: depthById.get(id)!,
    };
    const kids = childrenOf.get(id);
    if (kids?.length) out.children = kids;
    const par = parentOf.get(id);
    if (par) out.parent = par;
    if (m.grade === "HS") out.courses = hsCoursesOf(m.code);
    return out;
  });

  const outEdges: OutEdge[] = [];
  for (const e of [...prereq].sort((a, b) => numAsc(a.s, b.s) || numAsc(a.t, b.t))) {
    outEdges.push({ s: e.s, t: e.t, k: 0, ...controlPoints(e.s, e.t, meta.get(e.s)!.strand) });
  }
  for (const e of [...related].sort((a, b) => numAsc(a.s, b.s) || numAsc(a.t, b.t))) {
    outEdges.push({ s: e.s, t: e.t, k: 1, ...controlPoints(e.s, e.t, meta.get(e.s)!.strand) });
  }

  const core: GraphCore = {
    meta: {
      standards: nodes.length,
      prereqEdges: prereq.length,
      relatedEdges: related.length,
      source: SOURCE_URL,
      license: LICENSE,
    },
    grades: GRADE_ORDER.map((g) => {
      const b = bands.get(g)!;
      const out: GraphCore["grades"][number] = {
        id: g,
        label: GRADE_LABELS[g],
        x0: round2(b.x0),
        x1: round2(b.x1),
      };
      const m = gradeMarkers.get(g);
      if (m) {
        out.marker = m.a;
        out.marker2 = m.b;
      }
      return out;
    }),
    courses: courseMarkers,
    strands: {
      number: { label: STRAND_LABELS.number },
      algebra: { label: STRAND_LABELS.algebra },
      geometry: { label: STRAND_LABELS.geometry },
      data: { label: STRAND_LABELS.data },
    },
    nodes,
    edges: outEdges,
  };

  // Details, sharded by grade.
  const details = {} as Record<Grade, Record<string, DetailEntry>>;
  for (const g of GRADE_ORDER) details[g] = {};
  for (const s of standardList) {
    const m = meta.get(s.id)!;
    const c = keptClusters[s.ccmathcluster_id];
    const entry: DetailEntry = {};
    const desc = sanitizeField(s.desc);
    const example = sanitizeField(s.example_problem);
    const progressions = sanitizeField(s.progressions);
    if (desc) entry.desc = desc;
    if (example) entry.example = example;
    if (s.example_problem_attribution && s.example_problem_attribution.trim())
      entry.exampleAttr = s.example_problem_attribution.trim();
    if (s.example_problem_url && s.example_problem_url.trim()) {
      const safe = safeLinkUrl(s.example_problem_url.trim());
      if (safe) entry.exampleUrl = safe; // drop non-http(s) example sources
    }
    if (progressions) entry.progressions = progressions;
    if (c.name) entry.clusterName = c.name;
    const tasks: { group: string; name: string; url: string }[] = [];
    for (const grp of s.links || []) {
      for (const l of grp.links || []) {
        if (!l.url) continue;
        const safe = safeLinkUrl(l.url);
        if (!safe) continue; // drop non-http(s) task links (skip the entry)
        tasks.push({ group: grp.name, name: l.name, url: safe });
      }
    }
    if (tasks.length) entry.tasks = tasks;
    details[m.grade][s.id] = entry;
  }

  // Flat search index: one HTML-free record per standard, in node (id) order.
  const search: SearchDoc[] = sortedIds.map((id) => {
    const m = meta.get(id)!;
    const c = keptClusters[standards[id].ccmathcluster_id];
    const doc: SearchDoc = {
      id,
      code: m.code,
      grade: m.grade,
      strand: m.strand,
      text: toSearchText(standards[id].desc),
      domainName: m.domainName,
      clusterName: c.name ?? "",
    };
    // Flag standards carrying a level-appropriate worked example so the hover
    // card can advertise it before the panel opens (326 of 480 have one).
    if (standards[id].example_problem?.trim()) doc.ex = 1;
    return doc;
  });
  assert(search.length === 480, `expected 480 search docs, got ${search.length}`);

  // Bounds report
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (const n of nodes) {
    xmin = Math.min(xmin, n.pos[0]); xmax = Math.max(xmax, n.pos[0]);
    ymin = Math.min(ymin, n.pos[1]); ymax = Math.max(ymax, n.pos[1]);
    zmin = Math.min(zmin, n.pos[2]); zmax = Math.max(zmax, n.pos[2]);
  }
  const topDegree = [...nodes]
    .sort((a, b) => b.deg - a.deg)
    .slice(0, 10)
    .map((n) => ({ code: n.code, deg: n.deg }));

  return {
    core,
    details,
    search,
    report: {
      standards: nodes.length,
      prereqEdges: prereq.length,
      relatedEdges: related.length,
      isolated: isolatedIds.length,
      droppedClusters,
      topDegree,
      bounds: { x: [round2(xmin), round2(xmax)], y: [round2(ymin), round2(ymax)], z: [round2(zmin), round2(zmax)] },
    },
  };
}

// ---------------------------------------------------------------------------
// CLI: write files + print report
// ---------------------------------------------------------------------------
function writeAll(result: BuildResult): void {
  mkdirSync(DETAILS_DIR, { recursive: true });
  const coreJson = JSON.stringify(result.core);
  writeFileSync(resolve(OUT_DIR, "graph-core.json"), coreJson);
  const searchJson = JSON.stringify(result.search);
  writeFileSync(resolve(OUT_DIR, "search.json"), searchJson);
  const shardSizes: { name: string; bytes: number; gzip: number }[] = [];
  for (const g of GRADE_ORDER) {
    const json = JSON.stringify(result.details[g]);
    const file = resolve(DETAILS_DIR, `${g}.json`);
    writeFileSync(file, json);
    shardSizes.push({
      name: `details/${g}.json`,
      bytes: Buffer.byteLength(json),
      gzip: gzipSync(json).length,
    });
  }

  const coreBytes = Buffer.byteLength(coreJson);
  const coreGzip = gzipSync(coreJson).length;
  const kb = (n: number) => (n / 1024).toFixed(1) + "kB";

  const r = result.report;
  console.log("\n=== Coherence Map Explorer — data pipeline report ===");
  console.log(`standards:      ${r.standards}`);
  console.log(`prereq edges:   ${r.prereqEdges}`);
  console.log(`related edges:  ${r.relatedEdges}`);
  console.log(`isolated nodes: ${r.isolated}`);
  console.log(`dropped clusters (orphan): ${r.droppedClusters}`);
  console.log(`link fixes: ${rewrittenLinks} rewritten (Wayback/live), ${strippedImages} dead images stripped`);
  console.log("\n-- file sizes (raw / gzip) --");
  console.log(`graph-core.json   ${kb(coreBytes)} / ${kb(coreGzip)}${coreGzip > 120 * 1024 ? "  ⚠ OVER 120kB gzip budget" : ""}`);
  console.log(`search.json       ${kb(Buffer.byteLength(searchJson))} / ${kb(gzipSync(searchJson).length)}`);
  for (const s of shardSizes) console.log(`${s.name.padEnd(18)}${kb(s.bytes)} / ${kb(s.gzip)}`);
  console.log("\n-- position bounds --");
  console.log(`x: [${r.bounds.x[0]}, ${r.bounds.x[1]}]  y: [${r.bounds.y[0]}, ${r.bounds.y[1]}]  z: [${r.bounds.z[0]}, ${r.bounds.z[1]}]`);
  console.log("\n-- top-degree standards --");
  for (const t of r.topDegree) console.log(`  ${t.code.padEnd(12)} deg ${t.deg}`);
  console.log("\nWrote public/data/graph-core.json + details/{K,1..8,HS}.json\n");
}

// Only run the CLI when executed directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  writeAll(buildGraph());
}
