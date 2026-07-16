// Filters — the bottom rail. Grade chips (K…HS), strand chips (colored dots),
// a "Major work" toggle and a "Widely applicable prerequisites" spotlight.
//
// Semantics: filters compose with AND. A node filtered OUT gets aVisible=0 on
// the nodes mesh AND on every incident edge (an edge is hidden if EITHER
// endpoint is hidden); the shaders ghost those instances (0.06 alpha, shrunk)
// and picking skips them. Filter state is deliberately NOT in the URL — the
// hash is reserved for the focused standard.
//
// The chips are aria-pressed toggle buttons. The tour drives a couple of
// filter states programmatically (setStrandsOnly / reset), which keep the chip
// UI in sync so the on-screen state always matches the scene.

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
  /** Show only the given strand (used by the tour). Syncs the chips. */
  setStrandsOnly(strand: StrandId): void;
  /** Restore every filter to its default (all shown). Syncs the chips. */
  reset(): void;
  /** Whether a grade currently passes the grade-chip filter (search uses this
   * as ranking context: filtered-in grades surface first). */
  isGradeActive(grade: string): boolean;
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
  // Lens: a single-select emphasis view. Major work and Widely Applicable
  // Prerequisites answer different questions (where this YEAR's time goes vs
  // what matters most BEYOND graduation) — composing them as independent
  // toggles produced intersections nobody could interpret (in K-8 every
  // standard is WAP, so the combination only bit in HS, silently).
  type Lens = "all" | "major" | "wap";
  let lens: Lens = "all";

  const visN = nodes.visibleAttr.array as Float32Array;
  const visE = edges.visibleAttr.array as Float32Array;

  function recompute(): void {
    for (let i = 0; i < graph.nodes.length; i++) {
      const n = graph.nodes[i];
      const shown =
        gradeActive.has(n.grade) &&
        strandActive.has(n.strand) &&
        (lens === "all" || (lens === "major" ? n.msa === 0 : n.wap));
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

  // Small-screen disclosure toggle (a "Filters" pill that opens the sheet).
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

  // Track chips so programmatic state changes (tour) update the UI.
  const strandChips = new Map<StrandId, HTMLButtonElement>();
  const gradeChips = new Map<string, HTMLButtonElement>();
  const lensChips = new Map<Lens, HTMLButtonElement>();

  const LENSES: { id: Lens; label: string; explain: string }[] = [
    {
      id: "major",
      label: "Major work",
      explain:
        "The clusters each grade is asked to spend most of the year on (65–85% of instructional time).",
    },
    {
      id: "wap",
      label: "Widely applicable prerequisites",
      explain:
        "The standards whose mastery carries furthest into college majors and careers: all of K–8, plus the flagged high-school content.",
    },
  ];

  function makeChip(
    label: string,
    pressed: boolean,
    onToggle: (on: boolean) => void,
  ): HTMLButtonElement {
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
    const chip = makeChip(g, true, (on) => (on ? gradeActive.add(g) : gradeActive.delete(g)));
    gradeChips.set(g, chip);
    gradeGroup.appendChild(chip);
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
    strandChips.set(s, chip);
    strandGroup.appendChild(chip);
  }

  // Lens group: single-select. Clicking the active lens returns to "all".
  const lensGroup = document.createElement("div");
  lensGroup.className = "filter-group";
  lensGroup.setAttribute("aria-label", "Lens");

  const explainer = document.createElement("p");
  explainer.className = "lens-explainer";
  explainer.hidden = true;

  function setLens(next: Lens): void {
    lens = lens === next ? "all" : next;
    const active = LENSES.find((l) => l.id === lens);
    explainer.hidden = !active;
    explainer.textContent = active ? active.explain : "";
    syncChips();
    recompute();
  }

  for (const l of LENSES) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "filter-chip filter-toggle";
    chip.textContent = l.label;
    chip.title = l.explain;
    chip.setAttribute("aria-pressed", "false");
    chip.addEventListener("click", () => setLens(l.id));
    lensChips.set(l.id, chip);
    lensGroup.appendChild(chip);
  }

  groups.append(gradeGroup, strandGroup, lensGroup);
  rail.append(explainer, disclosure, groups);
  document.body.appendChild(rail);

  // Reflect a strand's aria-pressed to match the active set.
  function syncChips(): void {
    for (const [s, chip] of strandChips) chip.setAttribute("aria-pressed", String(strandActive.has(s)));
    for (const [g, chip] of gradeChips) chip.setAttribute("aria-pressed", String(gradeActive.has(g)));
    for (const [id, chip] of lensChips) chip.setAttribute("aria-pressed", String(lens === id));
  }

  return {
    setStrandsOnly(strand) {
      strandActive.clear();
      strandActive.add(strand);
      for (const g of GRADES) gradeActive.add(g);
      lens = "all";
      explainer.hidden = true;
      syncChips();
      recompute();
    },
    reset() {
      gradeActive.clear();
      for (const g of GRADES) gradeActive.add(g);
      strandActive.clear();
      for (const s of STRAND_ORDER) strandActive.add(s);
      lens = "all";
      explainer.hidden = true;
      syncChips();
      recompute();
    },
    isGradeActive(grade) {
      return gradeActive.has(grade);
    },
    dispose() {
      rail.remove();
    },
  };
}
