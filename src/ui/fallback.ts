// No-WebGL fallback — when WebGL2 can't initialize (or ?nowebgl=1), the 3D
// scene is replaced with a plain DOM list of all 480 standards grouped by
// grade. Each row opens the SAME detail panel the 3D view uses (it is already
// pure DOM), and a text box filters the list. A quiet banner explains why.
//
// This path builds NO scene, machine, renderer, or picking — just the panel and
// this list. Connections come from resolveConnections, the SAME resolver the 3D
// panel (machine.computeModel) and Browse route through, so a family parent or
// an edgeless sub-standard reads here exactly as it does in the map. Reading the
// raw preds/succ/related instead dead-ended 72 of the 480 standards on "No
// mapped connections."

import type { GraphCore } from "../data";
import { createPanel, type Connections } from "./panel";
import { resolveConnections } from "../state/machine";
import { STRAND_COLORS } from "../scene/palette";

const GRADE_ORDER = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "HS"];
const GRADE_LABELS: Record<string, string> = {
  K: "Kindergarten",
  HS: "High School",
};

function hexColor(v: number): string {
  return `#${v.toString(16).padStart(6, "0")}`;
}

export function createFallback(graph: GraphCore, reason: string): void {
  // Hide the 3D-only chrome (canvas host, boot veil, the inert search rail).
  // style.display beats the hidden attribute when a CSS rule sets display.
  for (const id of ["scene", "veil", "search-rail"]) {
    const el = document.getElementById(id);
    if (el) {
      el.hidden = true;
      el.style.display = "none";
    }
  }
  document.body.classList.add("nowebgl");

  // --- adjacency for the panel's Connections -----------------------------
  const indexById = new Map<string, number>();
  graph.nodes.forEach((n, i) => indexById.set(n.id, i));
  const indexByCode = new Map<string, number>();
  graph.nodes.forEach((n, i) => indexByCode.set(n.code, i));
  const preds: number[][] = graph.nodes.map(() => []);
  const succ: number[][] = graph.nodes.map(() => []);
  const related: number[][] = graph.nodes.map(() => []);
  for (const e of graph.edges) {
    const s = indexById.get(e.s);
    const t = indexById.get(e.t);
    if (s === undefined || t === undefined) continue;
    if (e.k === 0) {
      succ[s].push(t);
      preds[t].push(s);
    } else {
      related[s].push(t);
      related[t].push(s);
    }
  }
  // Family arrays the shared resolver needs (parent → sub-standards, and back).
  const partsOf: number[][] = graph.nodes.map((n) =>
    (n.children ?? []).map((c) => indexById.get(c)).filter((x): x is number => x !== undefined),
  );
  const parentOf: (number | undefined)[] = graph.nodes.map((n) =>
    n.parent !== undefined ? indexById.get(n.parent) : undefined,
  );

  const byCode = (a: number, b: number): number =>
    graph.nodes[a].code < graph.nodes[b].code ? -1 : 1;
  function connectionsOf(i: number): Connections {
    const r = resolveConnections(i, partsOf, parentOf, preds, succ, related);
    return {
      buildsOn: [...r.buildsOn].sort(byCode),
      leadsTo: [...r.leadsTo].sort(byCode),
      related: [...r.related].sort(byCode),
      parts: r.rolledUp ? [...partsOf[i]].sort(byCode) : undefined,
      rolledUp: r.rolledUp,
      inheritedFrom: r.inheritedFrom,
      // Inherit case: the Family group lists the parent first, then the siblings.
      family:
        r.inheritedFrom !== undefined
          ? [r.inheritedFrom, ...partsOf[r.inheritedFrom].filter((x) => x !== i).sort(byCode)]
          : undefined,
      // The journey needs the 3D lineage flight, which this path does not have.
      journeyable: false,
    };
  }

  // --- panel (same component as the 3D path) -----------------------------
  const liveEl = document.getElementById("aria-live");
  function openStandard(i: number): void {
    panel.show(i, connectionsOf(i));
    const code = graph.nodes[i].code;
    history.replaceState(null, "", `${location.pathname}${location.search}#/s/${code}`);
    if (liveEl) liveEl.textContent = `Showing ${code}`;
  }
  const panel = createPanel(document.body, graph, {
    focusCode: (code) => {
      const i = indexByCode.get(code);
      if (i !== undefined) openStandard(i);
    },
    traceJourney: () => {}, // no scene to fly — the journey is inert in the list view
    getAncestors: () => [], // journey is disabled here, so no closure sections
    getDescendants: () => [],
    close: () => {
      panel.hide();
      history.replaceState(null, "", location.pathname + location.search);
    },
  });
  // Trace-to-foundations has no meaning without the 3D lineage flight.
  document.querySelector<HTMLButtonElement>(".panel-trace")?.style.setProperty("display", "none");

  // --- list view ---------------------------------------------------------
  const view = document.createElement("main");
  view.className = "fallback";

  const banner = document.createElement("p");
  banner.className = "fallback-banner";
  banner.setAttribute("role", "status");
  banner.textContent = "3D view needs WebGL; showing the list.";
  view.appendChild(banner);
  if (reason) console.info(`[cme] no-WebGL fallback: ${reason}`);

  const searchWrap = document.createElement("div");
  searchWrap.className = "fallback-search";
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.id = "fallback-search-input";
  searchInput.placeholder = "Filter standards, e.g. 4.NF.B.3 or fractions";
  searchInput.setAttribute("aria-label", "Filter standards");
  searchWrap.appendChild(searchInput);
  view.appendChild(searchWrap);

  const listWrap = document.createElement("div");
  listWrap.className = "fallback-list";
  view.appendChild(listWrap);
  document.body.appendChild(view);

  // Group node indices by grade (in K→HS order), sorted by code within a grade.
  interface Row {
    el: HTMLButtonElement;
    title: HTMLSpanElement;
    code: string;
    index: number;
    haystack: string; // code + title, lower-cased, updated when titles load
  }
  const rows: Row[] = [];
  const groupEls: { grade: string; section: HTMLElement; rowEls: HTMLButtonElement[] }[] = [];

  for (const grade of GRADE_ORDER) {
    const members = graph.nodes
      .map((n, i) => ({ n, i }))
      .filter((x) => x.n.grade === grade)
      .sort((a, b) => (a.n.code < b.n.code ? -1 : 1));
    if (!members.length) continue;

    const section = document.createElement("section");
    section.className = "fallback-group";
    const h = document.createElement("h2");
    h.className = "fallback-grade";
    h.textContent = GRADE_LABELS[grade] ?? `Grade ${grade}`;
    section.appendChild(h);

    const rowEls: HTMLButtonElement[] = [];
    for (const { n, i } of members) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "fallback-row";
      const chip = document.createElement("span");
      chip.className = "fallback-chip";
      chip.style.setProperty("--dot", hexColor(STRAND_COLORS[n.strand]));
      chip.textContent = n.grade;
      const code = document.createElement("span");
      code.className = "fallback-code";
      code.textContent = n.code;
      const title = document.createElement("span");
      title.className = "fallback-title";
      el.append(chip, code, title);
      el.addEventListener("click", () => openStandard(i));
      section.appendChild(el);
      rowEls.push(el);
      rows.push({ el, title, code: n.code, index: i, haystack: n.code.toLowerCase() });
    }
    groupEls.push({ grade, section, rowEls });
    listWrap.appendChild(section);
  }

  // Fill titles from the flat search index (async), then let filtering use them.
  void import("../data").then(({ loadSearchDocs }) =>
    loadSearchDocs()
      .then((docs) => {
        const byId = new Map(docs.map((d) => [d.id, d]));
        for (const r of rows) {
          const doc = byId.get(graph.nodes[r.index].id);
          if (doc) {
            r.title.textContent = doc.text;
            r.haystack = `${r.code} ${doc.text}`.toLowerCase();
          }
        }
      })
      .catch(() => {
        /* titles stay blank; codes are still listed and clickable */
      }),
  );

  // Filter: token-AND match on code + title ("add fractions" matches a row
  // containing both words anywhere); hide grade groups that empty out.
  searchInput.addEventListener("input", () => {
    const tokens = searchInput.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    for (const r of rows) {
      r.el.hidden = tokens.length > 0 && !tokens.every((t) => r.haystack.includes(t));
    }
    for (const g of groupEls) {
      g.section.hidden = g.rowEls.every((el) => el.hidden);
    }
  });

  // Honor a deep link (#/s/<CODE>) into the list view.
  const m = /^#\/s\/(.+)$/.exec(location.hash);
  if (m) {
    const i = indexByCode.get(decodeURIComponent(m[1]));
    if (i !== undefined) openStandard(i);
  }
}
