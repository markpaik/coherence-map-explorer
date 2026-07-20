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
import { STRAND_ORDER } from "../scene/palette";
import { strandSwatch, type ArtStyle } from "../scene/artstyle";
import type { Pose } from "../scene/pose";

const GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "HS"];

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
  /** Recompute node/edge visibility from the current filter state — used to
   * reclaim the visibility buffers after a story's spotlight override releases. */
  recompute(): void;
  /** Repaint the strand-legend swatches to the active art skin's colorway (the
   * legend mirrors the scene: Galaxy palette / Ringers pegs / Fidenza nodes). */
  setArtStyle(style: ArtStyle): void;
  /** Show the Transit-only metro key (interchange/line legend) at pose 3, hide it
   * in the other poses. Called with the settled pose target. */
  setPose(pose: Pose): void;
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
  // Active art skin — the legend swatches read the SAME colorway the scene does
  // (galaxy / ringers / fidenza), repainted by setArtStyle on every skin swap.
  let artStyle: ArtStyle = 0;

  const visN = nodes.visibleAttr.array as Float32Array;
  const visE = edges.visibleAttr.array as Float32Array;

  function recompute(): void {
    for (let i = 0; i < graph.nodes.length; i++) {
      const n = graph.nodes[i];
      const shown =
        gradeActive.has(n.grade) &&
        strandActive.has(n.strand) &&
        // Major/Supporting/Additional is a K-8 construct: the source stores 0
        // for every HS cluster, so without the grade gate the Major-work lens
        // would sweep in all 163 HS standards (2026-07 audit).
        (lens === "all" || (lens === "major" ? n.msa === 0 && n.grade !== "HS" : n.wap));
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
      label: "Widely applicable prereqs",
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

  // The member domains of a strand (distinct domainName values), for the chip
  // tooltip — so "Number & Quantity" spells out what rolls up into it.
  const strandMembers = (s: StrandId): string => {
    const seen = new Set<string>();
    for (const n of graph.nodes) if (n.strand === s) seen.add(n.domainName);
    return [...seen].join(", ");
  };

  // Strand chips (colored dot + the full family label from graph.strands, with
  // a tooltip listing the member domains it rolls up).
  const strandGroup = document.createElement("div");
  strandGroup.className = "filter-group";
  strandGroup.setAttribute("aria-label", "Strands");
  for (const s of STRAND_ORDER) {
    const chip = makeChip(graph.strands[s].label, true, (on) =>
      on ? strandActive.add(s) : strandActive.delete(s),
    );
    chip.classList.add("strand-chip");
    chip.title = strandMembers(s);
    chip.style.setProperty("--dot", hexColor(strandSwatch(s, artStyle)));
    chip.insertAdjacentHTML("afterbegin", '<span class="chip-dot"></span>');
    strandChips.set(s, chip);
    strandGroup.appendChild(chip);
  }

  // Lens group: single-select. Clicking the active lens returns to "all".
  const lensGroup = document.createElement("div");
  lensGroup.className = "filter-group";
  lensGroup.setAttribute("aria-label", "Lens");

  // Definitions live in a styled hover/focus tooltip, not an inline paragraph
  // — the rail stays tight. AT reads the same text via aria-describedby.
  const tip = document.createElement("div");
  tip.className = "filters-tip";
  tip.id = "filters-tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  function showTip(chip: HTMLElement, text: string): void {
    tip.textContent = text;
    tip.hidden = false;
    const r = chip.getBoundingClientRect();
    const tw = tip.getBoundingClientRect().width || 280;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - 12 - tw));
    tip.style.left = `${left}px`;
    tip.style.bottom = `${window.innerHeight - r.top + 8}px`;
  }
  function hideTip(): void {
    tip.hidden = true;
  }

  function setLens(next: Lens): void {
    lens = lens === next ? "all" : next;
    syncChips();
    recompute();
  }

  for (const l of LENSES) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "filter-chip filter-toggle";
    chip.textContent = l.label;
    chip.setAttribute("aria-pressed", "false");
    chip.setAttribute("aria-describedby", "filters-tip");
    chip.addEventListener("click", () => setLens(l.id));
    chip.addEventListener("mouseenter", () => showTip(chip, l.explain));
    chip.addEventListener("mouseleave", hideTip);
    chip.addEventListener("focus", () => showTip(chip, l.explain));
    chip.addEventListener("blur", hideTip);
    lensChips.set(l.id, chip);
    lensGroup.appendChild(chip);
  }

  groups.append(gradeGroup, strandGroup, lensGroup);
  rail.append(disclosure, groups);
  document.body.append(rail, tip);

  // Transit-only metro key: the strand legend names the LINE COLOURS, but the
  // metro grammar (trunk lines, interchange capsules) needs its own key for a
  // first-time reader. Sits just above the rail; shown only when the Transit pose
  // is the settled target, hidden in every other pose (setPose).
  const transitKey = document.createElement("div");
  transitKey.className = "transit-key";
  transitKey.setAttribute("role", "note");
  transitKey.textContent =
    "Lines follow the busiest prerequisite routes · capsules mark interchange standards";
  transitKey.hidden = true;
  document.body.append(transitKey);

  // Repaint the strand-legend dots to the active skin's colorway.
  function recolorSwatches(): void {
    for (const [s, chip] of strandChips) {
      chip.style.setProperty("--dot", hexColor(strandSwatch(s, artStyle)));
    }
  }

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
      hideTip();
      syncChips();
      recompute();
    },
    reset() {
      gradeActive.clear();
      for (const g of GRADES) gradeActive.add(g);
      strandActive.clear();
      for (const s of STRAND_ORDER) strandActive.add(s);
      lens = "all";
      hideTip();
      syncChips();
      recompute();
    },
    isGradeActive(grade) {
      return gradeActive.has(grade);
    },
    recompute() {
      recompute();
    },
    setArtStyle(style) {
      artStyle = style;
      recolorSwatches();
    },
    setPose(pose) {
      transitKey.hidden = pose !== 3;
    },
    dispose() {
      rail.remove();
      tip.remove();
      transitKey.remove();
    },
  };
}
