// Filters — the bottom rail. Grade chips (K…HS), strand chips (colored dots),
// a "Major work" toggle and a "Widely applicable prerequisites" spotlight.
//
// Semantics: filters compose with AND. A node filtered OUT gets aVisible=0 on
// the nodes mesh AND on every incident edge (an edge is hidden if EITHER
// endpoint is hidden); the shaders ghost those instances (0.06 alpha, shrunk)
// and picking skips them. Filter state is deliberately NOT in the URL — the
// hash is reserved for the focused standard.

import type { GraphCore, StrandId } from "../data";
import type { NodesHandle } from "../scene/nodes";
import type { EdgesHandle } from "../scene/edges";
import { STRAND_COLORS, STRAND_ORDER } from "../scene/palette";

const GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "HS"];
const STRAND_SHORT: Record<StrandId, string> = {
  number: "Number",
  algebra: "Algebra",
  geometry: "Geometry",
  data: "Data",
};

interface FiltersDeps {
  graph: GraphCore;
  nodes: NodesHandle;
  edges: EdgesHandle;
  requestRender: () => void;
}

function hexColor(v: number): string {
  return `#${v.toString(16).padStart(6, "0")}`;
}

export interface FiltersHandle {
  dispose(): void;
}

export function createFilters(deps: FiltersDeps): FiltersHandle {
  const { graph, nodes, edges, requestRender } = deps;

  // Per-edge endpoint node indices (for propagating hidden endpoints to edges).
  const indexById = new Map<string, number>();
  graph.nodes.forEach((n, i) => indexById.set(n.id, i));
  const edgeS = new Int32Array(edges.count);
  const edgeT = new Int32Array(edges.count);
  graph.edges.forEach((e, i) => {
    edgeS[i] = indexById.get(e.s) ?? -1;
    edgeT[i] = indexById.get(e.t) ?? -1;
  });

  // Active state (default: everything shown).
  const gradeActive = new Set(GRADES);
  const strandActive = new Set<StrandId>(STRAND_ORDER);
  let majorOnly = false;
  let wapSpotlight = false;

  const visN = nodes.visibleAttr.array as Float32Array;
  const visE = edges.visibleAttr.array as Float32Array;

  function recompute(): void {
    for (let i = 0; i < graph.nodes.length; i++) {
      const n = graph.nodes[i];
      const shown =
        gradeActive.has(n.grade) &&
        strandActive.has(n.strand) &&
        (!majorOnly || n.msa === 0) &&
        (!wapSpotlight || n.wap);
      visN[i] = shown ? 1 : 0;
    }
    for (let i = 0; i < edges.count; i++) {
      const s = edgeS[i];
      const t = edgeT[i];
      visE[i] = s >= 0 && t >= 0 && visN[s] === 1 && visN[t] === 1 ? 1 : 0;
    }
    nodes.visibleAttr.needsUpdate = true;
    edges.visibleAttr.needsUpdate = true;
    requestRender();
  }

  // --- DOM ----------------------------------------------------------------
  const rail = document.createElement("div");
  rail.className = "filters-rail";
  rail.setAttribute("role", "group");
  rail.setAttribute("aria-label", "Filters");

  // Small-screen disclosure toggle.
  const disclosure = document.createElement("button");
  disclosure.type = "button";
  disclosure.className = "filters-toggle";
  disclosure.textContent = "Filters";
  disclosure.setAttribute("aria-expanded", "false");
  disclosure.addEventListener("click", () => {
    const open = rail.classList.toggle("filters-open");
    disclosure.setAttribute("aria-expanded", String(open));
  });

  const groups = document.createElement("div");
  groups.className = "filters-groups";

  function makeChip(label: string, pressed: boolean, onToggle: (on: boolean) => void): HTMLButtonElement {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "filter-chip";
    chip.textContent = label;
    chip.setAttribute("aria-pressed", String(pressed));
    chip.addEventListener("click", () => {
      const next = chip.getAttribute("aria-pressed") !== "true";
      chip.setAttribute("aria-pressed", String(next));
      onToggle(next);
      recompute();
    });
    return chip;
  }

  // Grade chips.
  const gradeGroup = document.createElement("div");
  gradeGroup.className = "filter-group";
  gradeGroup.setAttribute("aria-label", "Grades");
  for (const g of GRADES) {
    gradeGroup.appendChild(
      makeChip(g, true, (on) => (on ? gradeActive.add(g) : gradeActive.delete(g))),
    );
  }

  // Strand chips (colored dot + name).
  const strandGroup = document.createElement("div");
  strandGroup.className = "filter-group";
  strandGroup.setAttribute("aria-label", "Strands");
  for (const s of STRAND_ORDER) {
    const chip = makeChip(STRAND_SHORT[s], true, (on) =>
      on ? strandActive.add(s) : strandActive.delete(s),
    );
    chip.classList.add("strand-chip");
    chip.style.setProperty("--dot", hexColor(STRAND_COLORS[s]));
    chip.insertAdjacentHTML("afterbegin", '<span class="chip-dot"></span>');
    strandGroup.appendChild(chip);
  }

  // Toggles.
  const toggleGroup = document.createElement("div");
  toggleGroup.className = "filter-group";
  const majorChip = makeChip("Major work", false, (on) => (majorOnly = on));
  majorChip.classList.add("filter-toggle");
  const wapChip = makeChip("Widely applicable prerequisites", false, (on) => (wapSpotlight = on));
  wapChip.classList.add("filter-toggle");
  toggleGroup.append(majorChip, wapChip);

  groups.append(gradeGroup, strandGroup, toggleGroup);
  rail.append(disclosure, groups);
  document.body.appendChild(rail);

  return {
    dispose() {
      rail.remove();
    },
  };
}
