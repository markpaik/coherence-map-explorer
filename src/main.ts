import "./style.css";

// Phase 1 placeholder entry point.
// It verifies the build-time data pipeline end-to-end in the browser:
// fetch the generated graph-core.json and render a plain stats line.
// The Three.js scene arrives in Phase 2 — nothing 3D here yet.

interface GraphMeta {
  standards: number;
  prereqEdges: number;
  relatedEdges: number;
  source: string;
  license: string;
}

interface GraphCore {
  meta: GraphMeta;
  nodes: unknown[];
  edges: unknown[];
}

async function main(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) return;

  try {
    const res = await fetch("/data/graph-core.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const graph = (await res.json()) as GraphCore;
    const { standards, prereqEdges, relatedEdges } = graph.meta;
    const connections = prereqEdges + relatedEdges;

    const el = document.createElement("div");
    el.className = "stats";
    el.textContent = `${standards} standards · ${connections} connections loaded`;

    const sub = document.createElement("span");
    sub.className = "muted";
    sub.textContent = `${prereqEdges} prerequisite · ${relatedEdges} related — 3D view coming in Phase 2`;
    el.appendChild(sub);

    app.replaceChildren(el);
  } catch (err) {
    const el = document.createElement("div");
    el.className = "stats error";
    el.textContent = `Failed to load graph data: ${(err as Error).message}`;
    app.replaceChildren(el);
  }
}

void main();
