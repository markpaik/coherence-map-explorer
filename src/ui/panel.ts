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
  // The element focus should return to when the panel closes (or the search
  // input, as a fallback). Captured only when opening from a closed panel.
  let lastTrigger: HTMLElement | null = null;

  // --- DOM skeleton (built once) -----------------------------------------
  const panel = document.createElement("aside");
  panel.className = "panel";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Standard detail");
  panel.tabIndex = -1;
  panel.hidden = true;

  // Drag handle — visible only as a bottom sheet (≤720px); pointer target for
  // the snap-point gesture. Decorative to AT (the sheet is a labeled region).
  const handle = document.createElement("div");
  handle.className = "panel-handle";
  handle.setAttribute("aria-hidden", "true");
  handle.innerHTML = '<span class="panel-handle-bar"></span>';

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
  codeEl.id = "panel-code-heading";
  codeEl.tabIndex = -1; // focus lands here when the panel opens
  panel.setAttribute("aria-labelledby", "panel-code-heading");
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
  panel.append(handle, closeBtn, body);
  container.appendChild(panel);

  // --- bottom-sheet snap gesture (≤720px) --------------------------------
  // Dependency-free: pointer events set a CSS var the mobile transform reads.
  // Snaps: 90% (full) at y=0, 40% (peek), and a swipe-down-past-peek to close.
  const isSheet = (): boolean => window.matchMedia("(max-width: 720px)").matches;
  const vh = (): number => window.innerHeight;
  const sheetHeight = (): number => 0.9 * vh(); // matches CSS height: 90dvh
  const peekY = (): number => sheetHeight() - 0.4 * vh(); // top of the 40% peek

  let sheetY = 0; // current snap offset (px from the 90% position)
  function setSheetY(y: number, animate: boolean): void {
    sheetY = y;
    panel.classList.toggle("panel-dragging", !animate);
    panel.style.setProperty("--sheet-y", `${y}px`);
  }

  let dragging = false;
  let dragStartPointerY = 0;
  let dragStartSheetY = 0;
  function onHandleDown(e: PointerEvent): void {
    if (!isSheet()) return;
    dragging = true;
    dragStartPointerY = e.clientY;
    dragStartSheetY = sheetY;
    // Guarded: capture can throw for already-inactive pointers (cancel races).
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* keep dragging via bubbling events */
    }
  }
  function onHandleMove(e: PointerEvent): void {
    if (!dragging) return;
    const y = Math.max(0, dragStartSheetY + (e.clientY - dragStartPointerY));
    setSheetY(y, false);
  }
  function onHandleUp(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    // Swipe down past the peek → close. Otherwise snap to the nearer of the two.
    if (sheetY > peekY() + 0.12 * vh()) {
      requests.close();
      return;
    }
    const target = sheetY > peekY() / 2 ? peekY() : 0;
    setSheetY(target, true);
  }
  handle.addEventListener("pointerdown", onHandleDown);
  handle.addEventListener("pointermove", onHandleMove);
  handle.addEventListener("pointerup", onHandleUp);
  handle.addEventListener("pointercancel", onHandleUp);

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
    // Generous word budget — CSS clamps to 3 lines; this is just a safety cap.
    title.textContent = shortTitle(docsById?.get(n.id)?.text, 26);
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
    let loadFailed = false;
    try {
      const shard = await loadDetails(n.grade);
      detail = shard[n.id];
    } catch {
      detail = undefined;
      loadFailed = true;
    }
    if (token !== openToken) return;

    if (detail?.desc) {
      desc.innerHTML = detail.desc; // pipeline-sanitized
    } else if (loadFailed) {
      // Fetch failed (offline, server gone): fall back to the cached search
      // excerpt so the panel is never empty, and offer a real retry — the
      // loader evicts failed fetches, so retrying actually refetches.
      desc.textContent = "";
      const excerpt = docsById?.get(n.id)?.text;
      if (excerpt) {
        const p = document.createElement("p");
        p.textContent = excerpt;
        desc.appendChild(p);
      }
      const note = document.createElement("p");
      note.className = "panel-desc-missing";
      note.textContent = excerpt
        ? "Showing a short excerpt — the full text didn't load. "
        : "The standard's text didn't load. ";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "panel-retry";
      retry.textContent = "Retry";
      retry.addEventListener("click", () => void fillAsync(focusIndex, conn, openToken));
      note.appendChild(retry);
      desc.appendChild(note);
    } else {
      desc.innerHTML = '<p class="panel-desc-missing">No description available.</p>';
    }
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
      const wasOpen = open;
      // Capture the return-focus target only on a fresh open (not when a
      // connection button re-focuses within an already-open panel).
      if (!wasOpen) {
        const active = document.activeElement;
        lastTrigger = active instanceof HTMLElement && active !== document.body ? active : null;
      }
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
      setSheetY(0, true); // slide up to fully expanded (mobile sheet)
      body.scrollTop = 0;

      // Move focus to the heading so keyboard/AT land inside the panel. Defer a
      // frame so it isn't hidden. preventScroll keeps the sheet from jumping.
      // The guided tour owns focus (its card is a focus-trapped dialog), so the
      // panel must not steal it while touring.
      if (!wasOpen && !document.body.classList.contains("touring")) {
        requestAnimationFrame(() => {
          if (open) codeEl.focus({ preventScroll: true });
        });
      }

      void fillAsync(focusIndex, conn, token);
    },

    hide() {
      openToken++;
      const wasOpen = open;
      open = false;
      panel.classList.remove("panel-open", "panel-dragging");
      hidePopover();

      // Return focus to the opening trigger (still in the DOM) or the search box.
      // Skip while touring — the tour manages focus inside its own dialog.
      if (wasOpen && !document.body.classList.contains("touring")) {
        const search = document.getElementById("search-input");
        const target =
          lastTrigger && document.contains(lastTrigger) ? lastTrigger : search;
        if (target instanceof HTMLElement) target.focus({ preventScroll: true });
      }
      lastTrigger = null;

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
