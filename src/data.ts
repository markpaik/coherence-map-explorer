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
  strands: Record<StrandId, { label: string }>;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export async function loadGraph(url = "/data/graph-core.json"): Promise<GraphCore> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load graph data: HTTP ${res.status}`);
  return (await res.json()) as GraphCore;
}
