// Hover tooltip: a small DOM glass chip near the cursor — code (Space
// Grotesk 600, strand ink) + grade/domain context. 120ms delay in, none out.
// Phase 2 choice: tooltip only, no in-scene troika code label (DESIGN allows
// either; the chip stays crisp at any zoom and costs zero draw calls).

const SHOW_DELAY_MS = 120;
const OFFSET = 14; // px from cursor

export interface TooltipHandle {
  show(code: string, detail: string, x: number, y: number): void;
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
  el.append(codeEl, detailEl);
  container.appendChild(el);

  let showTimer: number | null = null;

  function place(x: number, y: number): void {
    // Keep the chip inside the viewport; flip sides near the right/bottom edge.
    const rect = el.getBoundingClientRect();
    const w = rect.width || 180;
    const h = rect.height || 44;
    let left = x + OFFSET;
    let top = y + OFFSET;
    if (left + w > window.innerWidth - 8) left = x - OFFSET - w;
    if (top + h > window.innerHeight - 8) top = y - OFFSET - h;
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  return {
    show(code, detail, x, y) {
      if (showTimer !== null) window.clearTimeout(showTimer);
      codeEl.textContent = code;
      detailEl.textContent = detail;
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
