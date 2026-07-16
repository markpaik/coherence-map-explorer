// Hover tooltip: a glass mini-card near the cursor — code (Space Grotesk 600,
// strand ink), grade/domain context, the first line of the standard itself
// (2-line clamp), and its connection counts. 120ms delay in, none out.
// The text line comes from the prefetched search docs; before they land the
// card simply renders without it.

const SHOW_DELAY_MS = 120;
const OFFSET = 14; // px from cursor

export interface TooltipContent {
  code: string;
  /** Context line: domain · cluster. */
  detail: string;
  /** Plain-text standard description (clamped to 2 lines by CSS). */
  text?: string;
  /** Connections line, e.g. "Builds on 5 · Leads to 4". */
  meta?: string;
}

export interface TooltipHandle {
  show(content: TooltipContent, x: number, y: number): void;
  move(x: number, y: number): void;
  hide(): void;
  dispose(): void;
}

export function createTooltip(container: HTMLElement): TooltipHandle {
  const el = document.createElement("div");
  el.className = "tooltip";
  el.setAttribute("role", "status");
  el.hidden = true;

  const codeEl = document.createElement("span");
  codeEl.className = "tooltip-code";
  const detailEl = document.createElement("span");
  detailEl.className = "tooltip-detail";
  const textEl = document.createElement("span");
  textEl.className = "tooltip-text";
  const metaEl = document.createElement("span");
  metaEl.className = "tooltip-meta";
  el.append(codeEl, detailEl, textEl, metaEl);
  container.appendChild(el);

  let showTimer: number | null = null;

  function place(x: number, y: number): void {
    // Keep the card inside the viewport; flip sides near the right/bottom edge.
    const rect = el.getBoundingClientRect();
    const w = rect.width || 260;
    const h = rect.height || 72;
    let left = x + OFFSET;
    let top = y + OFFSET;
    if (left + w > window.innerWidth - 8) left = x - OFFSET - w;
    if (top + h > window.innerHeight - 8) top = y - OFFSET - h;
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  return {
    show(content, x, y) {
      if (showTimer !== null) window.clearTimeout(showTimer);
      codeEl.textContent = content.code;
      detailEl.textContent = content.detail;
      textEl.textContent = content.text ?? "";
      textEl.hidden = !content.text;
      metaEl.textContent = content.meta ?? "";
      metaEl.hidden = !content.meta;
      showTimer = window.setTimeout(() => {
        el.hidden = false;
        place(x, y);
        showTimer = null;
      }, SHOW_DELAY_MS);
      if (!el.hidden) place(x, y); // already visible: retarget instantly
    },
    move(x, y) {
      if (!el.hidden) place(x, y);
    },
    hide() {
      if (showTimer !== null) {
        window.clearTimeout(showTimer);
        showTimer = null;
      }
      el.hidden = true;
    },
    dispose() {
      if (showTimer !== null) window.clearTimeout(showTimer);
      el.remove();
    },
  };
}
