// Detail panel — the right-side glass surface (full-height bottom sheet ≤720px)
// that is the accessible mirror of a focused standard. Content order follows
// DESIGN's "Detail panel" layout: code + strand dot + breadcrumb → badges →
// standard text → Connections (Builds on / Leads to / Related, each a real
// <button>) → Trace to foundations → Tasks (+ worked example, attributed) →
// Progression note (collapsed) → hidden v2 slot.
//
// Sync scaffolding (header, badges, connection buttons) paints instantly from
// graph-core; the desc / example / progressions HTML and the connection titles
// are lazy — fetched from the grade detail shard + the flat search index — and
// filled in when they resolve. KaTeX is dynamic-imported the first time the
// panel opens (kept out of the core chunk) and renders $…$ / \(…\) / $$…$$.

import type { GraphCore, GraphNode, StrandId, SearchDoc } from "../data";
import { loadDetails, loadSearchDocs } from "../data";
import { STRAND_COLORS } from "../scene/palette";

export interface Connections {
  buildsOn: number[]; // node indices — direct incoming prerequisites
  leadsTo: number[]; // node indices — direct outgoing prerequisites
  related: number[]; // node indices — related neighbours
}

export interface PanelRequests {
  focusCode(code: string): void;
  trace(): void;
  close(): void;
}

export interface PanelHandle {
  show(focusIndex: number, connections: Connections): void;
  hide(): void;
  readonly isOpen: boolean;
  dispose(): void;
}

const MSA_BADGE: Record<number, string> = {
  0: "Major Work",
  1: "Supporting Work",
  2: "Additional Work",
};

function hexColor(v: number): string {
  return `#${v.toString(16).padStart(6, "0")}`;
}

function shortTitle(text: string | undefined, words = 7): string {
  if (!text) return "";
  const parts = text.split(/\s+/);
  const t = parts.slice(0, words).join(" ");
  return parts.length > words ? `${t}…` : t;
}

// --- KaTeX (dynamic, once) -------------------------------------------------
let katexPromise: Promise<(el: HTMLElement) => void> | null = null;
function loadKatex(): Promise<(el: HTMLElement) => void> {
  if (!katexPromise) {
    katexPromise = (async () => {
      const [{ default: renderMathInElement }] = await Promise.all([
        import("katex/contrib/auto-render"),
        import("katex/dist/katex.min.css"),
      ]);
      return (el: HTMLElement): void =>
        renderMathInElement(el, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "\\[", right: "\\]", display: true },
            { left: "\\(", right: "\\)", display: false },
            { left: "$", right: "$", display: false },
          ],
          throwOnError: false,
          ignoredClasses: ["term"], // glossary chips are prose, not math
        });
    })();
  }
  return katexPromise;
}

export function createPanel(
  container: HTMLElement,
  graph: GraphCore,
  requests: PanelRequests,
): PanelHandle {
  const gradeLabel = new Map(graph.grades.map((g) => [g.id, g.label]));
  let docsById: Map<string, SearchDoc> | null = null;
  let openToken = 0;
  let open = false;

  // --- DOM skeleton (built once) -----------------------------------------
  const panel = document.createElement("aside");
  panel.className = "panel";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Standard detail");
  panel.tabIndex = -1;
  panel.hidden = true;

  const closeBtn = document.createElement("button");
  closeBtn.className = "panel-close";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close detail panel");
  closeBtn.innerHTML =
    '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  closeBtn.addEventListener("click", () => requests.close());

  const body = document.createElement("div");
  body.className = "panel-body";

  const header = document.createElement("header");
  header.className = "panel-head";
  const codeRow = document.createElement("div");
  codeRow.className = "panel-code-row";
  const dot = document.createElement("span");
  dot.className = "strand-dot";
  const codeEl = document.createElement("h2");
  codeEl.className = "panel-code";
  codeRow.append(dot, codeEl);
  const crumb = document.createElement("p");
  crumb.className = "panel-crumb";
  header.append(codeRow, crumb);

  const badges = document.createElement("div");
  badges.className = "panel-badges";

  const desc = document.createElement("div");
  desc.className = "panel-desc";

  const connections = document.createElement("div");
  connections.className = "panel-connections";

  const traceBtn = document.createElement("button");
  traceBtn.className = "panel-trace";
  traceBtn.type = "button";
  traceBtn.textContent = "Trace to foundations";
  traceBtn.addEventListener("click", () => requests.trace());

  const tasks = document.createElement("div");
  tasks.className = "panel-tasks";

  const progressions = document.createElement("div");
  progressions.className = "panel-progressions";

  const aiSlot = document.createElement("div");
  aiSlot.id = "ai-slot";
  aiSlot.hidden = true;

  body.append(header, badges, desc, connections, traceBtn, tasks, progressions, aiSlot);
  panel.append(closeBtn, body);
  container.appendChild(panel);

  // --- glossary popover (shared chip) ------------------------------------
  const popover = document.createElement("div");
  popover.className = "glossary-pop";
  popover.setAttribute("role", "tooltip");
  popover.hidden = true;
  container.appendChild(popover);

  function showPopover(term: HTMLElement): void {
    const def = term.getAttribute("data-def");
    if (!def) return;
    popover.textContent = def; // textContent only — never HTML
    popover.hidden = false;
    const r = term.getBoundingClientRect();
    const pw = popover.getBoundingClientRect().width || 260;
    let left = r.left;
    if (left + pw > window.innerWidth - 12) left = window.innerWidth - 12 - pw;
    popover.style.left = `${Math.max(12, left)}px`;
    popover.style.top = `${r.bottom + 6}px`;
  }
  function hidePopover(): void {
    popover.hidden = true;
  }
  const isTerm = (t: EventTarget | null): t is HTMLElement =>
    t instanceof HTMLElement && t.classList.contains("term");
  body.addEventListener("pointerover", (e) => {
    if (isTerm(e.target)) showPopover(e.target);
  });
  body.addEventListener("pointerout", (e) => {
    if (isTerm(e.target)) hidePopover();
  });
  body.addEventListener("focusin", (e) => {
    if (isTerm(e.target)) showPopover(e.target);
  });
  body.addEventListener("focusout", hidePopover);
  // Tap support: a term toggles the popover (chips get tabindex for keyboards).
  body.addEventListener("click", (e) => {
    if (isTerm(e.target)) {
      e.preventDefault();
      if (popover.hidden) showPopover(e.target);
      else hidePopover();
    }
  });
  body.addEventListener("scroll", hidePopover, { passive: true });

  // --- rendering helpers --------------------------------------------------
  function connectionButton(nodeIndex: number): HTMLButtonElement {
    const n = graph.nodes[nodeIndex];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "conn-btn";
    const chip = document.createElement("span");
    chip.className = "conn-chip";
    chip.style.setProperty("--dot", hexColor(STRAND_COLORS[n.strand]));
    chip.textContent = n.grade;
    const code = document.createElement("span");
    code.className = "conn-code";
    code.textContent = n.code;
    const title = document.createElement("span");
    title.className = "conn-title";
    title.textContent = shortTitle(docsById?.get(n.id)?.text);
    btn.append(chip, code, title);
    btn.addEventListener("click", () => requests.focusCode(n.code));
    return btn;
  }

  function renderConnections(conn: Connections): void {
    connections.replaceChildren();
    const groups: [string, number[]][] = [
      ["Builds on", conn.buildsOn],
      ["Leads to", conn.leadsTo],
      ["Related", conn.related],
    ];
    for (const [label, list] of groups) {
      if (!list.length) continue;
      const group = document.createElement("div");
      group.className = "conn-group";
      const h = document.createElement("h3");
      h.className = "conn-h";
      h.textContent = `${label} · ${list.length}`;
      group.appendChild(h);
      for (const idx of list) group.appendChild(connectionButton(idx));
      connections.appendChild(group);
    }
    if (!conn.buildsOn.length && !conn.leadsTo.length && !conn.related.length) {
      const none = document.createElement("p");
      none.className = "conn-empty";
      none.textContent = "No mapped connections.";
      connections.appendChild(none);
    }
  }

  function renderBadges(n: GraphNode): void {
    badges.replaceChildren();
    const add = (text: string, cls: string): void => {
      const b = document.createElement("span");
      b.className = `badge ${cls}`;
      b.textContent = text;
      badges.appendChild(b);
    };
    const msa = MSA_BADGE[n.msa];
    if (msa) add(msa, `badge-msa-${n.msa}`);
    if (n.wap && n.grade === "HS") add("Widely Applicable Prerequisite", "badge-wap");
    if (n.modeling) add("★ Modeling", "badge-modeling");
  }

  function renderTasks(
    detailTasks: { group: string; name: string; url: string }[] | undefined,
    example: string | undefined,
    exampleAttr: string | undefined,
    exampleUrl: string | undefined,
  ): void {
    tasks.replaceChildren();
    const hasTasks = detailTasks && detailTasks.length > 0;
    if (!hasTasks && !example) return;

    const h = document.createElement("h3");
    h.className = "panel-section-h";
    h.textContent = "Tasks & resources";
    tasks.appendChild(h);

    if (hasTasks) {
      const byGroup = new Map<string, { name: string; url: string }[]>();
      for (const t of detailTasks!) {
        if (!byGroup.has(t.group)) byGroup.set(t.group, []);
        byGroup.get(t.group)!.push(t);
      }
      for (const [group, list] of byGroup) {
        const gl = document.createElement("p");
        gl.className = "task-group";
        gl.textContent = group;
        tasks.appendChild(gl);
        const ul = document.createElement("ul");
        ul.className = "task-list";
        for (const t of list) {
          const li = document.createElement("li");
          const a = document.createElement("a");
          a.href = t.url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = t.name;
          li.appendChild(a);
          ul.appendChild(li);
        }
        tasks.appendChild(ul);
      }
    }

    if (example) {
      const det = document.createElement("details");
      det.className = "worked-example";
      const sum = document.createElement("summary");
      sum.textContent = "Worked example";
      det.appendChild(sum);
      const ex = document.createElement("div");
      ex.className = "example-body math-host";
      ex.innerHTML = example; // pipeline-sanitized
      det.appendChild(ex);
      if (exampleAttr) {
        const attr = document.createElement("p");
        attr.className = "example-attr";
        attr.textContent = exampleAttr; // textContent attribution
        if (exampleUrl) {
          const a = document.createElement("a");
          a.href = exampleUrl;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = " (source)";
          attr.appendChild(a);
        }
        det.appendChild(attr);
      }
      tasks.appendChild(det);
    }
  }

  function renderProgressions(html: string | undefined): void {
    progressions.replaceChildren();
    if (!html) return;
    const det = document.createElement("details");
    det.className = "progression-note";
    const sum = document.createElement("summary");
    sum.textContent = "Progression note";
    det.appendChild(sum);
    const div = document.createElement("div");
    div.className = "math-host";
    div.innerHTML = html; // pipeline-sanitized
    det.appendChild(div);
    progressions.appendChild(det);
  }

  async function fillAsync(focusIndex: number, conn: Connections, token: number): Promise<void> {
    const n = graph.nodes[focusIndex];
    // Titles for connection buttons (once): the flat search index.
    if (!docsById) {
      try {
        const docs = await loadSearchDocs();
        docsById = new Map(docs.map((d) => [d.id, d]));
      } catch {
        docsById = new Map();
      }
      if (token !== openToken) return;
      renderConnections(conn); // re-render now that titles are available
    }

    let detail;
    try {
      const shard = await loadDetails(n.grade);
      detail = shard[n.id];
    } catch {
      detail = undefined;
    }
    if (token !== openToken) return;

    desc.innerHTML = detail?.desc ?? "<p class=\"panel-desc-missing\">No description available.</p>";
    renderTasks(detail?.tasks, detail?.example, detail?.exampleAttr, detail?.exampleUrl);
    renderProgressions(detail?.progressions);

    // Math: render across the freshly-populated content.
    try {
      const render = await loadKatex();
      if (token !== openToken) return;
      render(body);
    } catch (err) {
      console.warn("[cme] KaTeX render failed", err);
    }
  }

  return {
    get isOpen() {
      return open;
    },

    show(focusIndex, conn) {
      const token = ++openToken;
      open = true;
      const n = graph.nodes[focusIndex];

      // Sync scaffolding — paints instantly.
      dot.style.background = hexColor(STRAND_COLORS[n.strand]);
      codeEl.textContent = n.code;
      crumb.textContent = `${gradeLabel.get(n.grade) ?? n.grade} · ${n.domainName} · ${n.clusterCode}`;
      renderBadges(n);
      renderConnections(conn);
      desc.innerHTML = "<p class=\"panel-loading\">Loading…</p>";
      tasks.replaceChildren();
      progressions.replaceChildren();
      hidePopover();

      panel.hidden = false;
      panel.classList.add("panel-open");
      body.scrollTop = 0;

      void fillAsync(focusIndex, conn, token);
    },

    hide() {
      openToken++;
      open = false;
      panel.classList.remove("panel-open");
      hidePopover();
      // Wait out the slide-off before removing from the layout.
      const onEnd = (): void => {
        if (!open) panel.hidden = true;
      };
      panel.addEventListener("transitionend", onEnd, { once: true });
      // Fallback if no transition fires (reduced motion / hidden tab).
      window.setTimeout(onEnd, 320);
    },

    dispose() {
      panel.remove();
      popover.remove();
    },
  };
}
