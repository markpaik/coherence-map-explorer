// Browse mode — a phone-first, drill-down navigator for standards WITHOUT the
// 3D scene. It is the default experience on phones (the constellation is
// unusable on a small touch screen) and mirrors Achieve the Core's original
// flow: pick a grade (or HS course), pick a domain, drill to a standard, and
// only then see its connections. Every connection row drills sideways forever.
//
// This overlay lives ABOVE the scene (opaque --bg, covers the canvas). The 3D
// still boots behind it; "See in the map" / "View the constellation" hide the
// overlay and hand the frame to the scene, and a fixed "Browse" pill brings it
// back. Browse duplicates the panel's modest rendering (badges, KaTeX, glossary)
// rather than importing it — panel.ts stays a scene-only concern.
//
// Nav is a simple in-memory stack; the header back chevron (and Escape) pop one
// level. While a STANDARD view shows, the hash stays synced to #/s/<CODE> via
// replaceState (the app's convention), so a deep link round-trips.

import type { GraphCore, GraphNode, SearchDoc } from "../data";
import { loadDetails, loadSearchDocs } from "../data";
import { STRAND_COLORS } from "../scene/palette";
import { rollUpFamily, type Machine } from "../state/machine";
import type { StoryPickerHandle } from "../stories/player";
import { rankResults, type RankItem } from "./searchrank";
import { httpsUpgrade } from "./urls";

export interface BrowseDeps {
  graph: GraphCore;
  machine: Machine;
  storyPicker: StoryPickerHandle;
  /** Side effects for main after the overlay hands the frame to the scene. */
  onEnterMap: () => void;
}

export interface BrowseHandle {
  open(): void;
  /** Open Browse directly at a standard's view (the sheet's swipe-up handoff). */
  openStandard(code: string): void;
  /** Hide the overlay and hand the frame to the 3D scene. */
  enterMap(): void;
  readonly isOpen: boolean;
  dispose(): void;
}

// --- constants ------------------------------------------------------------

const GRADE_ORDER = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "HS"];

// CCSS canonical domain order (K-8 domains, then the HS conceptual categories:
// Number & Quantity, Algebra, Functions, Geometry, Statistics). Domains sort by
// their index here so a grade reads OA · NBT · NF · MD · G, not alphabetically.
const DOMAIN_ORDER = [
  "CC", "OA", "NBT", "NF", "MD", "G", "RP", "NS", "EE", "SP", "F",
  "N-RN", "N-Q", "N-CN",
  "A-SSE", "A-APR", "A-CED", "A-REI",
  "F-IF", "F-BF", "F-LE", "F-TF",
  "G-CO", "G-SRT", "G-C", "G-GPE", "G-GMD", "G-MG",
  "S-ID", "S-IC", "S-CP", "S-MD",
];
const domainRank = (d: string): number => {
  const i = DOMAIN_ORDER.indexOf(d);
  return i < 0 ? DOMAIN_ORDER.length : i;
};

const SEARCH_MAX = 25;

// --- helpers --------------------------------------------------------------

function hexColor(v: number): string {
  return `#${v.toString(16).padStart(6, "0")}`;
}

// First ~n chars of the standard text on a word boundary (domain / connection
// rows get a one-glance snippet; the full text lives in the standard view).
function snippet(text: string | undefined, n = 90): string {
  if (!text) return "";
  if (text.length <= n) return text;
  const cut = text.slice(0, n);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 40 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

// Minimal shape of the MiniSearch results we consume (dynamic import keeps the
// library out of the core chunk — same trick as search.ts). Score feeds the
// shared parent-boost ranking.
interface Indexed {
  search(query: string, options?: unknown): { id: string; score: number }[];
}

// --- KaTeX (dynamic, once) — mirrors panel.ts exactly ---------------------
let katexPromise: Promise<(el: HTMLElement) => void> | null = null;
const DISPLAY_ENV =
  /\\begin\{(align\*?|alignat\*?|gather\*?|equation\*?|multline\*?|split|cases)\}[\s\S]*?\\end\{\1\}/g;
function wrapBareEnvironments(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if (t.data.includes("\\begin{")) texts.push(t);
  }
  for (const t of texts) {
    const wrapped = t.data.replace(DISPLAY_ENV, (m, _env, offset: number, s: string) => {
      if (s[offset - 1] === "$") return m;
      return `$$${m}$$`;
    });
    if (wrapped !== t.data) t.data = wrapped;
  }
}
function loadKatex(): Promise<(el: HTMLElement) => void> {
  if (!katexPromise) {
    katexPromise = (async () => {
      const [{ default: renderMathInElement }] = await Promise.all([
        import("katex/contrib/auto-render"),
        import("katex/dist/katex.min.css"),
      ]);
      return (el: HTMLElement): void => {
        wrapBareEnvironments(el);
        renderMathInElement(el, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "\\[", right: "\\]", display: true },
            { left: "\\(", right: "\\)", display: false },
            { left: "$", right: "$", display: false },
          ],
          throwOnError: false,
          ignoredClasses: ["term"],
        });
      };
    })();
  }
  return katexPromise;
}

// --- view stack -----------------------------------------------------------

interface GroupCtx {
  kind: "grade" | "course";
  id: string;
  label: string;
}
type View =
  | { t: "home" }
  | { t: "group"; ctx: GroupCtx }
  | { t: "domain"; ctx: GroupCtx; domain: string; domainName: string }
  | { t: "standard"; code: string };

export function createBrowse(deps: BrowseDeps): BrowseHandle {
  const { graph, machine, storyPicker } = deps;

  // --- indexes + adjacency (built once) ----------------------------------
  const nodeByCode = new Map<string, number>();
  const nodeById = new Map<string, number>();
  graph.nodes.forEach((n, i) => {
    nodeByCode.set(n.code, i);
    nodeById.set(n.id, i);
  });
  const gradeLabel = new Map(graph.grades.map((g) => [g.id, g.label]));
  const gradeRank = new Map(GRADE_ORDER.map((g, i) => [g, i]));
  const rankOf = (i: number): number => gradeRank.get(graph.nodes[i].grade) ?? 99;

  const preds: number[][] = graph.nodes.map(() => []); // s where s->i (builds on)
  const succ: number[][] = graph.nodes.map(() => []); // t where i->t (leads to)
  const related: number[][] = graph.nodes.map(() => []);
  for (const e of graph.edges) {
    const s = nodeById.get(e.s);
    const t = nodeById.get(e.t);
    if (s === undefined || t === undefined) continue;
    if (e.k === 0) {
      succ[s].push(t);
      preds[t].push(s);
    } else {
      related[s].push(t);
      related[t].push(s);
    }
  }
  const byGradeThenCode = (a: number, b: number): number =>
    rankOf(a) - rankOf(b) || (graph.nodes[a].code < graph.nodes[b].code ? -1 : 1);

  // Nodes belonging to a group (a real grade, or an HS course membership).
  function groupNodes(ctx: GroupCtx): GraphNode[] {
    if (ctx.kind === "grade") return graph.nodes.filter((n) => n.grade === ctx.id);
    return graph.nodes.filter((n) => n.grade === "HS" && n.courses?.includes(ctx.id));
  }
  // Top-level standards only (sub-standards are reached from a parent's view).
  const topLevel = (ns: GraphNode[]): GraphNode[] => ns.filter((n) => !n.parent);

  // --- lazy data: search docs (snippets) + MiniSearch index --------------
  let docsById: Map<string, SearchDoc> | null = null;
  let docsPromise: Promise<Map<string, SearchDoc>> | null = null;
  function ensureDocs(): Promise<Map<string, SearchDoc>> {
    if (docsById) return Promise.resolve(docsById);
    if (!docsPromise) {
      docsPromise = loadSearchDocs()
        .then((docs) => {
          docsById = new Map(docs.map((d) => [d.id, d]));
          return docsById;
        })
        .catch(() => {
          docsPromise = null;
          return new Map<string, SearchDoc>();
        });
    }
    return docsPromise;
  }
  const textOf = (nodeIdx: number): string =>
    docsById?.get(graph.nodes[nodeIdx].id)?.text ?? "";

  let searchIndex: Indexed | null = null;
  let indexing = false;
  async function ensureIndex(): Promise<void> {
    if (searchIndex || indexing) return;
    indexing = true;
    try {
      const [{ default: MiniSearch }, docs] = await Promise.all([
        import("minisearch"),
        loadSearchDocs(),
      ]);
      docsById = docsById ?? new Map(docs.map((d) => [d.id, d]));
      const ms = new MiniSearch({
        idField: "id",
        fields: ["code", "text", "domainName", "clusterName"],
        storeFields: ["id"],
        searchOptions: { prefix: true, fuzzy: 0.2, boost: { code: 3, text: 1.5 } },
      });
      ms.addAll(docs);
      searchIndex = ms as unknown as Indexed;
      if (searchInput.value.trim()) runSearch(searchInput.value); // index landed late
    } catch (err) {
      console.warn("[cme] browse search index failed", err);
    } finally {
      indexing = false;
    }
  }

  // --- shared glossary popover (for .term chips inside desc HTML) ---------
  const popover = document.createElement("div");
  popover.className = "glossary-pop";
  popover.hidden = true;
  popover.setAttribute("role", "tooltip");
  const isTerm = (t: EventTarget | null): t is HTMLElement =>
    t instanceof HTMLElement && t.classList.contains("term");
  function showPopover(term: HTMLElement): void {
    const def = term.getAttribute("data-def");
    if (!def) return;
    popover.textContent = def;
    popover.hidden = false;
    const r = term.getBoundingClientRect();
    const pw = popover.getBoundingClientRect().width || 260;
    let left = r.left;
    if (left + pw > window.innerWidth - 12) left = window.innerWidth - 12 - pw;
    popover.style.left = `${Math.max(12, left)}px`;
    popover.style.top = `${r.bottom + 6}px`;
  }
  const hidePopover = (): void => {
    popover.hidden = true;
  };
  function upgradeGlossaryTerms(host: HTMLElement): void {
    for (const el of host.querySelectorAll<HTMLElement>(".term:not([tabindex])")) {
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      const def = el.getAttribute("data-def");
      if (def) el.setAttribute("aria-label", `${el.textContent}: ${def}`);
    }
  }

  // --- overlay shell -----------------------------------------------------
  const overlay = document.createElement("section");
  overlay.className = "browse";
  overlay.setAttribute("role", "region");
  overlay.setAttribute("aria-label", "Browse standards");
  overlay.hidden = true;

  const header = document.createElement("div");
  header.className = "browse-header";
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "browse-back";
  backBtn.setAttribute("aria-label", "Back");
  backBtn.innerHTML =
    '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M12.5 4.5L7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  backBtn.addEventListener("click", () => pop());
  const headerLabel = document.createElement("span");
  headerLabel.className = "browse-header-label";
  header.append(backBtn, headerLabel);

  const viewHost = document.createElement("div");
  viewHost.className = "browse-view";

  overlay.append(header, viewHost);
  document.body.append(overlay, popover);

  // Glossary term interactions, delegated on the view host.
  viewHost.addEventListener("pointerover", (e) => {
    if (isTerm(e.target)) showPopover(e.target);
  });
  viewHost.addEventListener("pointerout", (e) => {
    if (isTerm(e.target)) hidePopover();
  });
  viewHost.addEventListener("click", (e) => {
    if (isTerm(e.target)) {
      e.preventDefault();
      popover.hidden ? showPopover(e.target) : hidePopover();
    }
  });
  overlay.addEventListener("scroll", hidePopover, { passive: true });

  // --- "Browse" pill (shown while in the 3D scene) -----------------------
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "browse-pill";
  pill.setAttribute("aria-label", "Open Browse");
  pill.innerHTML =
    '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span>Browse</span>';
  pill.hidden = true;
  pill.addEventListener("click", () => open());
  document.body.append(pill);

  // --- render token (guards async fills against fast drilling) -----------
  let renderToken = 0;

  // --- HOME (built once; search state + results persist across nav) ------
  const homeEl = document.createElement("div");
  homeEl.className = "browse-home";

  const wordmark = document.createElement("div");
  wordmark.className = "browse-wordmark";
  const kicker = document.createElement("p");
  kicker.className = "browse-kicker";
  kicker.textContent = "Coherence Map Explorer";
  const homeHeading = document.createElement("h1");
  homeHeading.className = "browse-home-title";
  homeHeading.tabIndex = -1;
  homeHeading.textContent = "Every standard. Every connection.";
  wordmark.append(kicker, homeHeading);

  const searchWrap = document.createElement("div");
  searchWrap.className = "browse-search";
  searchWrap.innerHTML =
    '<svg class="browse-search-icon" viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.6"/><path d="M13 13l4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = "browse-search-input";
  searchInput.id = "browse-search-input";
  searchInput.placeholder = "Search standards, e.g. add fractions";
  searchInput.setAttribute("aria-label", "Search standards");
  searchInput.setAttribute("role", "searchbox");
  searchWrap.appendChild(searchInput);

  const resultsEl = document.createElement("ul");
  resultsEl.className = "browse-results";
  resultsEl.setAttribute("role", "list");
  resultsEl.hidden = true;

  const tilesWrap = document.createElement("div");
  tilesWrap.className = "browse-browse-by";

  homeEl.append(wordmark, searchWrap, resultsEl, tilesWrap);

  searchInput.addEventListener("focus", () => void ensureIndex());
  searchInput.addEventListener("input", () => runSearch(searchInput.value));

  function runSearch(query: string): void {
    const q = query.trim();
    if (!q) {
      resultsEl.replaceChildren();
      resultsEl.hidden = true;
      tilesWrap.hidden = false;
      return;
    }
    tilesWrap.hidden = true;
    resultsEl.hidden = false;
    if (!searchIndex) {
      // Index still loading: leave the last results (or a hint) in place.
      if (!resultsEl.childElementCount) {
        resultsEl.replaceChildren(hintRow("Loading search…"));
      }
      return;
    }
    // Same parent-boost + grade-tiebreak ranking as the desktop search rail, so
    // a family parent (4.NF.B.3) never sorts below its own sub-standards.
    const items: RankItem[] = [];
    for (const h of searchIndex.search(q)) {
      const i = nodeById.get(h.id);
      if (i === undefined) continue;
      const n = graph.nodes[i];
      items.push({ id: n.id, code: n.code, grade: n.grade, score: h.score, parentId: n.parent });
    }
    const idxs = rankResults(items)
      .slice(0, SEARCH_MAX)
      .map((it) => nodeById.get(it.id)!)
      .filter((i): i is number => i !== undefined);
    resultsEl.replaceChildren();
    if (!idxs.length) {
      resultsEl.appendChild(hintRow(`No standards match "${q}".`));
      return;
    }
    for (const i of idxs) resultsEl.appendChild(resultRow(i));
  }

  function hintRow(text: string): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "browse-result-hint";
    li.textContent = text;
    return li;
  }
  function resultRow(i: number): HTMLLIElement {
    const n = graph.nodes[i];
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "browse-row";
    btn.append(gradeChip(n), rowText(n.code, textOf(i)));
    btn.addEventListener("click", () => push({ t: "standard", code: n.code }));
    li.appendChild(btn);
    return li;
  }

  // Grade/course tiles + the ghost row (constellation / stories).
  function buildTiles(): void {
    tilesWrap.replaceChildren();
    const h = document.createElement("h2");
    h.className = "browse-section-h";
    h.textContent = "Browse by grade";
    tilesWrap.appendChild(h);

    const gradeGrid = document.createElement("div");
    gradeGrid.className = "browse-tiles";
    for (const g of graph.grades) {
      if (g.id === "HS") continue; // HS is covered by the four course tiles
      const count = topLevel(graph.nodes.filter((n) => n.grade === g.id)).length;
      gradeGrid.appendChild(
        tile(g.id === "K" ? "K" : g.id, g.label, count, () =>
          push({ t: "group", ctx: { kind: "grade", id: g.id, label: g.label } }),
        ),
      );
    }
    tilesWrap.appendChild(gradeGrid);

    const ch = document.createElement("h2");
    ch.className = "browse-section-h";
    ch.textContent = "High school courses";
    tilesWrap.appendChild(ch);
    const courseCol = document.createElement("div");
    courseCol.className = "browse-course-tiles";
    for (const c of graph.courses) {
      const count = topLevel(
        graph.nodes.filter((n) => n.grade === "HS" && n.courses?.includes(c.id)),
      ).length;
      courseCol.appendChild(
        courseTile(c.label, count, () =>
          push({ t: "group", ctx: { kind: "course", id: c.id, label: c.label } }),
        ),
      );
    }
    tilesWrap.appendChild(courseCol);

    const ghost = document.createElement("div");
    ghost.className = "browse-ghost-row";
    const constellation = document.createElement("button");
    constellation.type = "button";
    constellation.className = "browse-ghost";
    constellation.textContent = "View the constellation";
    constellation.addEventListener("click", () => enterMap());
    const stories = document.createElement("button");
    stories.type = "button";
    stories.className = "browse-ghost";
    stories.textContent = "Stories";
    stories.addEventListener("click", () => {
      // Stories play over the scene; hand off the frame, then open the picker.
      enterMap();
      storyPicker.open();
    });
    ghost.append(constellation, stories);
    tilesWrap.appendChild(ghost);
  }

  function tile(token: string, sub: string, count: number, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "browse-tile";
    const t = document.createElement("span");
    t.className = "browse-tile-token";
    t.textContent = token;
    const s = document.createElement("span");
    s.className = "browse-tile-sub";
    s.textContent = `${count} standard${count === 1 ? "" : "s"}`;
    b.append(t, s);
    b.setAttribute("aria-label", `${sub}, ${count} standards`);
    b.addEventListener("click", onClick);
    return b;
  }
  function courseTile(label: string, count: number, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "browse-course-tile";
    const t = document.createElement("span");
    t.className = "browse-course-label";
    t.textContent = label;
    const s = document.createElement("span");
    s.className = "browse-course-count";
    s.textContent = `${count} standard${count === 1 ? "" : "s"}`;
    b.append(t, s);
    b.addEventListener("click", onClick);
    return b;
  }

  buildTiles();

  // --- shared row pieces -------------------------------------------------
  function gradeChip(n: GraphNode): HTMLSpanElement {
    const chip = document.createElement("span");
    chip.className = "browse-chip";
    chip.style.setProperty("--dot", hexColor(STRAND_COLORS[n.strand]));
    chip.textContent = n.grade;
    // "4" alone is ambiguous to a screen reader — name the grade.
    chip.setAttribute("aria-label", n.grade === "HS" ? "High school" : `Grade ${n.grade}`);
    return chip;
  }
  function rowText(code: string, text: string): HTMLSpanElement {
    const wrap = document.createElement("span");
    wrap.className = "browse-row-main";
    const c = document.createElement("span");
    c.className = "browse-row-code";
    c.textContent = code;
    const t = document.createElement("span");
    t.className = "browse-row-text";
    t.textContent = snippet(text);
    wrap.append(c, t);
    return wrap;
  }

  // --- GROUP view (domains within a grade / course) ----------------------
  function renderGroup(ctx: GroupCtx): HTMLElement {
    const el = document.createElement("div");
    el.className = "browse-group";
    const h = document.createElement("h1");
    h.className = "browse-view-h";
    h.tabIndex = -1;
    h.textContent = ctx.label;
    el.appendChild(h);

    const nodes = topLevel(groupNodes(ctx));
    const domains = new Map<string, { name: string; strand: GraphNode["strand"]; count: number }>();
    for (const n of nodes) {
      const d = domains.get(n.domain);
      if (d) d.count += 1;
      else domains.set(n.domain, { name: n.domainName, strand: n.strand, count: 1 });
    }
    const list = document.createElement("div");
    list.className = "browse-list";
    for (const [domain, info] of [...domains].sort((a, b) => domainRank(a[0]) - domainRank(b[0]))) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "browse-domain-row";
      const dot = document.createElement("span");
      dot.className = "browse-dot";
      dot.style.background = hexColor(STRAND_COLORS[info.strand]);
      const name = document.createElement("span");
      name.className = "browse-domain-name";
      name.textContent = info.name;
      const count = document.createElement("span");
      count.className = "browse-domain-count";
      count.textContent = `${info.count} standard${info.count === 1 ? "" : "s"}`;
      row.append(dot, name, count);
      row.addEventListener("click", () =>
        push({ t: "domain", ctx, domain, domainName: info.name }),
      );
      list.appendChild(row);
    }
    el.appendChild(list);
    return el;
  }

  // --- DOMAIN view (standards grouped by cluster) ------------------------
  function renderDomain(view: Extract<View, { t: "domain" }>, token: number): HTMLElement {
    const el = document.createElement("div");
    el.className = "browse-domain";
    const kick = document.createElement("p");
    kick.className = "browse-kicker";
    kick.textContent = view.ctx.label;
    const h = document.createElement("h1");
    h.className = "browse-view-h";
    h.tabIndex = -1;
    h.textContent = view.domainName;
    el.append(kick, h);

    const nodes = topLevel(groupNodes(view.ctx))
      .filter((n) => n.domain === view.domain)
      .sort((a, b) => (a.code < b.code ? -1 : 1));

    // Group by clusterCode, preserving first-seen order (codes are pre-sorted).
    const clusters = new Map<string, GraphNode[]>();
    for (const n of nodes) {
      const arr = clusters.get(n.clusterCode);
      if (arr) arr.push(n);
      else clusters.set(n.clusterCode, [n]);
    }

    const clusterHeads = new Map<string, HTMLHeadingElement>();
    void ensureDocs().then((map) => {
      if (token !== renderToken) return;
      // Fill snippets now that search docs are available.
      for (const btn of el.querySelectorAll<HTMLElement>(".browse-row[data-nid]")) {
        const t = btn.querySelector<HTMLElement>(".browse-row-text");
        if (t) t.textContent = snippet(map.get(btn.dataset.nid!)?.text);
      }
    });

    for (const [clusterCode, members] of clusters) {
      const section = document.createElement("div");
      section.className = "browse-cluster";
      const ch = document.createElement("h2");
      ch.className = "browse-cluster-h";
      ch.textContent = clusterCode; // upgraded to clusterName when the shard loads
      clusterHeads.set(clusterCode, ch);
      section.appendChild(ch);
      for (const n of members) section.appendChild(standardRow(n));
      el.appendChild(section);
    }

    // Cluster names come from the grade's detail shard (async; HS is heavy).
    void loadDetails(view.ctx.kind === "course" ? "HS" : view.ctx.id)
      .then((shard) => {
        if (token !== renderToken) return;
        for (const n of nodes) {
          const name = shard[n.id]?.clusterName;
          const head = clusterHeads.get(n.clusterCode);
          if (name && head && head.textContent === n.clusterCode) head.textContent = name;
        }
      })
      .catch(() => {
        /* leave clusterCode headings — a legible fallback */
      });

    return el;
  }

  // A domain-view row: strand dot + code + snippet + a Major-work chip.
  function standardRow(n: GraphNode): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "browse-row";
    btn.dataset.nid = n.id;
    const dot = document.createElement("span");
    dot.className = "browse-dot";
    dot.style.background = hexColor(STRAND_COLORS[n.strand]);
    const main = rowText(n.code, textOf(nodeByCode.get(n.code)!));
    btn.append(dot, main);
    // Major work is a K-8 designation; HS clusters carry msa 0 as a source
    // artifact, so the chip is gated to K-8 (2026-07 audit).
    if (n.msa === 0 && n.grade !== "HS") {
      const chip = document.createElement("span");
      chip.className = "browse-major-chip";
      chip.textContent = "Major work";
      main.appendChild(chip);
    }
    btn.addEventListener("click", () => push({ t: "standard", code: n.code }));
    return btn;
  }

  // --- STANDARD view -----------------------------------------------------
  function renderStandard(code: string, token: number): HTMLElement {
    const idx = nodeByCode.get(code);
    const el = document.createElement("div");
    el.className = "browse-standard";
    if (idx === undefined) {
      const h = document.createElement("h1");
      h.className = "browse-view-h";
      h.tabIndex = -1;
      h.textContent = code;
      const p = document.createElement("p");
      p.className = "browse-desc-missing";
      p.textContent = "That standard isn't in the map.";
      el.append(h, p);
      return el;
    }
    const n = graph.nodes[idx];

    // Header (code + strand dot, grade · domain crumb) — paints instantly.
    const head = document.createElement("header");
    head.className = "browse-std-head";
    const codeRow = document.createElement("div");
    codeRow.className = "browse-std-code-row";
    const dot = document.createElement("span");
    dot.className = "browse-std-dot";
    dot.style.background = hexColor(STRAND_COLORS[n.strand]);
    const h = document.createElement("h1");
    h.className = "browse-std-code";
    h.tabIndex = -1;
    h.textContent = n.code;
    codeRow.append(dot, h);
    const crumb = document.createElement("p");
    crumb.className = "browse-std-crumb";
    crumb.textContent = `${gradeLabel.get(n.grade) ?? n.grade} · ${n.domainName}`;
    head.append(codeRow, crumb);

    // Badges.
    const badges = document.createElement("div");
    badges.className = "browse-badges";
    const addBadge = (text: string, cls: string): void => {
      const b = document.createElement("span");
      b.className = `badge ${cls}`;
      b.textContent = text;
      badges.appendChild(b);
    };
    if (n.msa === 0 && n.grade !== "HS") addBadge("Major Work", "badge-msa-0");
    if (n.wap && n.grade === "HS") addBadge("Widely Applicable Prerequisite", "badge-wap");
    if (n.modeling) addBadge("★ Modeling", "badge-modeling");

    // Description (async).
    const desc = document.createElement("div");
    desc.className = "browse-desc math-host";
    desc.innerHTML = '<p class="browse-loading">Loading…</p>';

    // Connections.
    const conns = document.createElement("div");
    conns.className = "browse-conns";

    // Primary action → hand off to the 3D scene, focused on this standard.
    const seeBtn = document.createElement("button");
    seeBtn.type = "button";
    seeBtn.className = "browse-primary";
    seeBtn.textContent = "See in the map";
    seeBtn.addEventListener("click", () => {
      enterMap();
      machine.focusByCode(n.code);
    });

    // Tasks (async).
    const tasks = document.createElement("div");
    tasks.className = "browse-tasks";

    el.append(head, badges, desc, conns, seeBtn, tasks);

    // Fill connections (needs search docs for titles), then desc + tasks.
    void ensureDocs().then(() => {
      if (token !== renderToken) return;
      renderConnections(conns, idx);
    });
    void fillStandardDetail(n, desc, tasks, token);

    return el;
  }

  function renderConnections(host: HTMLElement, idx: number): void {
    host.replaceChildren();
    const n = graph.nodes[idx];
    const kids = (n.children ?? [])
      .map((id) => nodeById.get(id))
      .filter((i): i is number => i !== undefined);

    // Family roll-up is the panel's EXACT rule (machine.rollUpFamily): every
    // parent folds its sub-standards' connections into itself — own neighbours
    // plus each child's, family-internal members removed — so a heading standard
    // is never a dead end and never diverges from the 3D panel. 6.RP.A.3 is the
    // catch: it owns outbound edges while its .a-.d carry the inbound lineage
    // (5.G.A.2 / 6.RP.A.1 / 6.RP.A.2), so the roll-up must fire whenever there
    // are children, not only when the parent is edgeless. The shared helper is
    // the single source of truth; Browse only renders its output.
    const { buildsOn, leadsTo, related: rel, rolledUp } = rollUpFamily(
      idx,
      kids,
      preds,
      succ,
      related,
    );

    // De-duplicate: a neighbour already shown as a prerequisite (Builds on /
    // Leads to) never repeats under Related (precedence prereq > related). Same
    // rule as the desktop panel; counts stay truthful from the deduped list.
    const prereqSet = new Set<number>([...buildsOn, ...leadsTo]);
    const relDedup = rel.filter((i) => !prereqSet.has(i));

    const groups: [string, number[]][] = [
      ["Builds on", [...buildsOn].sort(byGradeThenCode)],
      ["Leads to", [...leadsTo].sort(byGradeThenCode)],
      ["Related", [...relDedup].sort(byGradeThenCode)],
    ];
    if (kids.length) groups.push(["Sub-standards", [...kids].sort(byGradeThenCode)]);
    if (n.parent) {
      const p = nodeById.get(n.parent);
      if (p !== undefined) groups.push(["Part of", [p]]);
    }

    let any = false;
    for (const [label, list] of groups) {
      if (!list.length) continue;
      any = true;
      const group = document.createElement("div");
      group.className = "browse-conn-group";
      const gh = document.createElement("h2");
      gh.className = "browse-conn-h";
      gh.textContent = `${label} · ${list.length}`;
      group.appendChild(gh);
      for (const ci of list) group.appendChild(connRow(ci));
      host.appendChild(group);
    }
    if (rolledUp) {
      const note = document.createElement("p");
      note.className = "browse-conn-note";
      note.textContent =
        "This standard is a heading; its Builds on / Leads to come from its sub-standards.";
      host.insertBefore(note, host.firstChild);
    }
    if (!any) {
      const empty = document.createElement("p");
      empty.className = "browse-conn-empty";
      empty.textContent = "No mapped connections.";
      host.appendChild(empty);
    }
  }

  function connRow(i: number): HTMLButtonElement {
    const n = graph.nodes[i];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "browse-row browse-conn-row";
    btn.append(gradeChip(n), rowText(n.code, textOf(i)));
    btn.addEventListener("click", () => push({ t: "standard", code: n.code }));
    return btn;
  }

  async function fillStandardDetail(
    n: GraphNode,
    desc: HTMLElement,
    tasks: HTMLElement,
    token: number,
  ): Promise<void> {
    let detail;
    let failed = false;
    try {
      const shard = await loadDetails(n.grade);
      detail = shard[n.id];
    } catch {
      failed = true;
    }
    if (token !== renderToken) return;

    if (detail?.desc) {
      desc.innerHTML = detail.desc; // pipeline-sanitized
    } else {
      const excerpt = docsById?.get(n.id)?.text;
      desc.textContent = "";
      if (excerpt) {
        const p = document.createElement("p");
        p.textContent = excerpt;
        desc.appendChild(p);
      }
      const note = document.createElement("p");
      note.className = "browse-desc-missing";
      note.textContent = failed
        ? "The full text didn't load."
        : "No description available.";
      desc.appendChild(note);
    }
    upgradeGlossaryTerms(desc);

    // Tasks — external links, panel's rel/target hygiene.
    tasks.replaceChildren();
    if (detail?.tasks && detail.tasks.length) {
      const th = document.createElement("h2");
      th.className = "browse-conn-h";
      th.textContent = "Tasks & resources";
      tasks.appendChild(th);
      const byGroup = new Map<string, { name: string; url: string }[]>();
      for (const t of detail.tasks) {
        if (!byGroup.has(t.group)) byGroup.set(t.group, []);
        byGroup.get(t.group)!.push(t);
      }
      for (const [group, list] of byGroup) {
        const gl = document.createElement("p");
        gl.className = "browse-task-group";
        gl.textContent = group;
        tasks.appendChild(gl);
        const ul = document.createElement("ul");
        ul.className = "browse-task-list";
        for (const t of list) {
          const li = document.createElement("li");
          const a = document.createElement("a");
          a.href = httpsUpgrade(t.url); // promote bare http:// task URLs
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = t.name;
          li.appendChild(a);
          ul.appendChild(li);
        }
        tasks.appendChild(ul);
      }
    }

    // Math across the freshly-populated description.
    try {
      const render = await loadKatex();
      if (token !== renderToken) return;
      render(desc);
    } catch (err) {
      console.warn("[cme] browse KaTeX render failed", err);
    }
  }

  // --- stack + rendering -------------------------------------------------
  let stack: View[] = [{ t: "home" }];

  function updateHash(view: View): void {
    // replaceState only — the app never pushState's a standard (matches the
    // machine's convention, so hashchange fires only for genuine back/forward).
    const base = location.pathname + location.search;
    history.replaceState(null, "", view.t === "standard" ? `${base}#/s/${view.code}` : base);
  }

  function renderTop(syncHash: boolean): void {
    const view = stack[stack.length - 1];
    const token = ++renderToken;
    hidePopover();

    let el: HTMLElement;
    let heading: HTMLElement;
    if (view.t === "home") {
      el = homeEl;
      heading = homeHeading;
    } else if (view.t === "group") {
      el = renderGroup(view.ctx);
      heading = el.querySelector<HTMLElement>(".browse-view-h")!;
    } else if (view.t === "domain") {
      el = renderDomain(view, token);
      heading = el.querySelector<HTMLElement>(".browse-view-h")!;
    } else {
      el = renderStandard(view.code, token);
      heading = el.querySelector<HTMLElement>(".browse-std-code, .browse-view-h")!;
    }

    viewHost.replaceChildren(el);
    overlay.scrollTop = 0;

    const showBack = stack.length > 1;
    backBtn.style.visibility = showBack ? "visible" : "hidden";
    headerLabel.textContent = view.t === "home" ? "" : backLabelFor(stack[stack.length - 2]);

    if (syncHash) updateHash(view);

    // Move focus to the new view's heading (deferred so it isn't mid-swap).
    requestAnimationFrame(() => {
      if (!overlay.hidden) heading.focus({ preventScroll: true });
    });
  }

  function backLabelFor(prev: View | undefined): string {
    if (!prev) return "";
    if (prev.t === "home") return "Home";
    if (prev.t === "group") return prev.ctx.label;
    if (prev.t === "domain") return prev.domainName;
    return "Back";
  }

  function push(view: View): void {
    stack.push(view);
    renderTop(true);
  }
  function pop(): void {
    if (stack.length <= 1) return;
    stack.pop();
    renderTop(true);
  }

  // Escape pops one level (never below HOME) while the overlay is up.
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!popover.hidden) {
        e.stopPropagation();
        hidePopover();
        return;
      }
      if (stack.length > 1) {
        e.preventDefault();
        e.stopPropagation();
        pop();
      }
    }
  });

  // --- open / close ------------------------------------------------------
  function open(): void {
    if (!overlay.hidden) return;
    overlay.hidden = false;
    pill.hidden = true;
    document.body.classList.add("browsing");
    renderTop(false); // re-paint the last view without clobbering the hash
  }
  function enterMap(): void {
    if (overlay.hidden) return;
    overlay.hidden = true;
    hidePopover();
    document.body.classList.remove("browsing");
    pill.hidden = false;
    deps.onEnterMap();
  }

  // The sheet's swipe-up handoff: land straight on the standard's Browse view
  // (pushed onto the stack so Back walks to wherever the user was before).
  function openStandard(code: string): void {
    if (nodeByCode.has(code)) {
      const top = stack[stack.length - 1];
      if (!(top && top.t === "standard" && top.code === code)) {
        stack.push({ t: "standard", code });
      }
    }
    overlay.hidden = false;
    pill.hidden = true;
    document.body.classList.add("browsing");
    renderTop(true);
  }

  // --- boot --------------------------------------------------------------
  // A story deep link at boot owns the scene — leave Browse closed (the pill,
  // hidden by CSS while a story runs, brings it back when the story exits).
  const storyHashAtBoot = /^#\/story\//.test(location.hash);
  const codeMatch = /^#\/s\/(.+)$/.exec(location.hash);
  const bootCode = codeMatch ? decodeURIComponent(codeMatch[1]) : null;
  if (bootCode && nodeByCode.has(bootCode)) {
    // Open Browse directly at the deep-linked standard's view (Back → Home).
    stack = [{ t: "home" }, { t: "standard", code: bootCode }];
  }
  renderTop(false); // paint (into the hidden overlay) without touching the hash
  if (storyHashAtBoot) {
    pill.hidden = false; // stay closed; CSS hides the pill until the story ends
  } else {
    overlay.hidden = false;
    document.body.classList.add("browsing");
    pill.hidden = true;
  }

  return {
    open,
    openStandard,
    enterMap,
    get isOpen() {
      return !overlay.hidden;
    },
    dispose() {
      overlay.remove();
      popover.remove();
      pill.remove();
      document.body.classList.remove("browsing");
    },
  };
}
