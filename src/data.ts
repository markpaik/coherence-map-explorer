// Typed loader for the Phase 1 data pipeline output (public/data/graph-core.json).
// The pipeline is frozen; these types mirror its exact shape.

export type StrandId = "number" | "algebra" | "geometry" | "data";

export interface GraphMeta {
  standards: number;
  prereqEdges: number;
  relatedEdges: number;
  source: string;
  license: string;
}

export interface GraphGrade {
  id: string; // "K" | "1" … "8" | "HS"
  label: string;
  x0: number;
  x1: number;
  /** Etch position in pose A / constellation (K-8 only; HS is labeled by courses). */
  marker?: [number, number, number];
  /** Etch position in pose B / the Ascent (K-8 only; along the massif ground line). */
  marker2?: [number, number, number];
  /** Etch position in pose C / the Blueprint (K-8 only; under the grade column). */
  marker3?: [number, number, number];
  /** Etch position in pose D / the Transit Map (K-8 only; under the transit column, front-on). */
  marker4?: [number, number, number];
}

export interface GraphNode {
  id: string;
  code: string;
  grade: string;
  strand: StrandId;
  domain: string;
  domainName: string;
  clusterCode: string;
  msa: number;
  wap: boolean;
  modeling: boolean;
  deg: number;
  pos: [number, number, number];
  /** Pose B / "the Ascent" position: x = same K→HS timeline, y = dependency
   *  depth * 13 - 90, z = compressed cross-section. */
  pos2: [number, number, number];
  /** Pose C / "the Blueprint" position: flat grade-column circuit board. x = one
   *  of 13 column centers (K,1..8,A1,G,A2,ADV), y = row within the column, z = 0. */
  pos3: [number, number, number];
  /** Pose D / "the Transit Map" position: octolinear metro. x = the same 13
   *  columns (depth-banded), y = barycenter row, z = per-line level
   *  (number +16, algebra +6, geometry -6, data -16). */
  pos4: [number, number, number];
  /** Ascent altitude: longest prerequisite chain (0 = foundation), then
   *  family-rolled so a family shares its umbrella's altitude (see
   *  docs/audits/family-altitude-rollup.md). */
  depth: number;
  /** High-school course memberships (e.g. ["A1","A2"]); K-8 nodes omit it. */
  courses?: string[];
  /** Sub-standard ids (4.NF.B.3 -> its .a-.d); code-derived at build time. */
  children?: string[];
  /** Parent standard id for a sub-standard. */
  parent?: string;
}

export interface GraphCourse {
  id: string; // "A1" | "G" | "A2" | "ADV"
  label: string; // "Algebra I" …
  marker: [number, number, number]; // etch position in pose A / constellation
  marker2: [number, number, number]; // etch position in pose B / the Ascent
  marker3: [number, number, number]; // etch position in pose C / the Blueprint
  marker4: [number, number, number]; // etch position in pose D / the Transit Map
}

export interface GraphEdge {
  s: string; // source node id
  t: string; // target node id
  k: 0 | 1; // 0 = prerequisite (directed), 1 = related (undirected)
  c: [number, number, number]; // baked quadratic-bezier control point (pose A)
  c2: [number, number, number]; // baked quadratic-bezier control point (pose B)
  c3: [number, number, number]; // baked quadratic-bezier control point (pose C)
  c4: [number, number, number]; // baked quadratic-bezier control point (pose D / transit)
}

export interface GraphCore {
  meta: GraphMeta;
  grades: GraphGrade[];
  courses: GraphCourse[];
  strands: Record<StrandId, { label: string }>;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// --- fetch policy ---------------------------------------------------------
// Every data fetch gets a deadline and one retry. Without the deadline a
// stalled connection never rejects, so the caller's catch never runs: the boot
// veil stays black forever, a detail shard never fills in, and the search index
// hangs "building" with no way for the reader to know. 20s is long enough for
// the 184kB HS shard on a slow phone and short enough to still be a page load.
const FETCH_TIMEOUT_MS = 20_000;

async function fetchJson<T>(url: string, what: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`${what}: HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${what}: request failed`);
}

export function loadGraph(url = "/data/graph-core.json"): Promise<GraphCore> {
  return fetchJson<GraphCore>(url, "Failed to load graph data");
}

// --- Detail shards (lazy, per grade) --------------------------------------
// Mirrors the pipeline's DetailEntry shape (public/data/details/{grade}.json).
// Shards are keyed by node id.

export interface StandardTask {
  group: string;
  name: string;
  url: string;
}

export interface StandardDetail {
  desc?: string;
  example?: string;
  exampleAttr?: string;
  exampleUrl?: string;
  progressions?: string;
  clusterName?: string;
  tasks?: StandardTask[];
}

export type DetailShard = Record<string, StandardDetail>;

const shardCache = new Map<string, Promise<DetailShard>>();

/** Fetch (and cache) the detail shard for a grade ("K" | "1"…"8" | "HS"). */
export function loadDetails(grade: string): Promise<DetailShard> {
  let p = shardCache.get(grade);
  if (!p) {
    p = fetchJson<DetailShard>(
      `/data/details/${encodeURIComponent(grade)}.json`,
      `Failed to load details for ${grade}`,
    );
    // Cache successes only — a transient network failure must not poison the
    // shard for the rest of the session (retry re-fetches).
    p.catch(() => shardCache.delete(grade));
    shardCache.set(grade, p);
  }
  return p;
}

// --- Flat search index (lazy, one file) -----------------------------------

export interface SearchDoc {
  id: string;
  code: string;
  grade: string;
  strand: StrandId;
  text: string;
  domainName: string;
  clusterName: string;
  /** 1 when the standard carries a level-appropriate worked example. */
  ex?: 1;
}

let searchDocsPromise: Promise<SearchDoc[]> | null = null;

/** Fetch (and cache) the flat search index (public/data/search.json). */
export function loadSearchDocs(): Promise<SearchDoc[]> {
  if (!searchDocsPromise) {
    searchDocsPromise = fetchJson<SearchDoc[]>("/data/search.json", "Failed to load search index");
    searchDocsPromise.catch(() => {
      searchDocsPromise = null; // same: don't cache failures
    });
  }
  return searchDocsPromise;
}
