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
  /** Etch position along the spiral (K-8 only; HS is labeled by courses). */
  marker?: [number, number, number];
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
  /** Sub-standard ids (4.NF.B.3 -> its .a-.d); code-derived at build time. */
  children?: string[];
  /** Parent standard id for a sub-standard. */
  parent?: string;
}

export interface GraphCourse {
  id: string; // "A1" | "G" | "A2" | "ADV"
  label: string; // "Algebra I" …
  marker: [number, number, number]; // etch position along the spiral
}

export interface GraphEdge {
  s: string; // source node id
  t: string; // target node id
  k: 0 | 1; // 0 = prerequisite (directed), 1 = related (undirected)
  c: [number, number, number]; // baked quadratic-bezier control point
}

export interface GraphCore {
  meta: GraphMeta;
  grades: GraphGrade[];
  courses: GraphCourse[];
  strands: Record<StrandId, { label: string }>;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export async function loadGraph(url = "/data/graph-core.json"): Promise<GraphCore> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load graph data: HTTP ${res.status}`);
  return (await res.json()) as GraphCore;
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
    p = fetch(`/data/details/${encodeURIComponent(grade)}.json`).then((res) => {
      if (!res.ok) throw new Error(`Failed to load details for ${grade}: HTTP ${res.status}`);
      return res.json() as Promise<DetailShard>;
    });
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
}

let searchDocsPromise: Promise<SearchDoc[]> | null = null;

/** Fetch (and cache) the flat search index (public/data/search.json). */
export function loadSearchDocs(): Promise<SearchDoc[]> {
  if (!searchDocsPromise) {
    searchDocsPromise = fetch("/data/search.json").then((res) => {
      if (!res.ok) throw new Error(`Failed to load search index: HTTP ${res.status}`);
      return res.json() as Promise<SearchDoc[]>;
    });
    searchDocsPromise.catch(() => {
      searchDocsPromise = null; // same: don't cache failures
    });
  }
  return searchDocsPromise;
}
