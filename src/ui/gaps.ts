// Gaps — the interactive impact simulator (STORIES.md). It shares the stories'
// damage engine, but the input is you: turn the mode on, click standards to mark
// them missed, and watch the structural damage recompute live across everything
// that stands on them. It is a MODE, not a filter lens, so its chip sits on its
// own after the single-select lens group; grade chips keep filtering normally
// underneath it.
//
// While the mode is on, a node click MARKS the standard (via the picking click
// guard) instead of opening the panel — hover tooltips still work, so you can
// read what you are marking. Toggling off clears the damage and restores
// click-to-focus.

import type { GraphCore } from "../data";
import type { NodesHandle } from "../scene/nodes";
import type { EdgesHandle } from "../scene/edges";
import type { FiltersHandle } from "./filters";
import type { PickingHandle } from "../interaction/picking";
import type { DamageEngine } from "../stories/damage";

export interface GapsDeps {
  graph: GraphCore;
  damage: DamageEngine;
  nodes: NodesHandle;
  edges: EdgesHandle;
  filters: FiltersHandle;
  picking: PickingHandle;
  requestRender: () => void;
  announce: (msg: string) => void;
}

export interface GapsHandle {
  readonly active: boolean;
  /** Toggle a standard's missed state (also the click-guard entry point). */
  toggleMissed(nodeIndex: number): void;
  setActive(on: boolean): void;
  dispose(): void;
}

export function createGaps(deps: GapsDeps): GapsHandle {
  const { graph, damage, nodes, edges, filters, picking, requestRender, announce } = deps;

  const missed = new Set<number>(); // node indices marked missed
  let active = false;

  // --- chip (own group after the lens group) ------------------------------
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "filter-chip filter-toggle gaps-chip";
  chip.textContent = "Gaps";
  chip.title = "Mark standards missed and watch the structural damage spread.";
  chip.setAttribute("aria-pressed", "false");
  chip.addEventListener("click", () => setActive(!active));
  filters.appendModeChip(chip);

  // --- status chip (above the rail) ---------------------------------------
  const status = document.createElement("div");
  status.className = "gaps-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  const statusText = document.createElement("span");
  statusText.className = "gaps-status-text";
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "gaps-clear";
  clearBtn.textContent = "Clear";
  clearBtn.addEventListener("click", () => clear());
  status.append(statusText, clearBtn);
  document.body.appendChild(status);

  function renderStatus(): void {
    const n = missed.size;
    statusText.textContent =
      n === 0 ? "Click a standard to mark it missed" : `${n} standard${n === 1 ? "" : "s"} marked missed`;
    clearBtn.disabled = n === 0;
  }

  // Sit clear of the filters rail — it wraps to two rows on narrow viewports, so
  // measure it rather than guess a fixed offset. (Rail is anchored bottom: 16px.)
  function positionStatus(): void {
    const rail = document.querySelector<HTMLElement>(".filters-rail");
    if (rail) status.style.bottom = `${Math.round(16 + rail.getBoundingClientRect().height + 10)}px`;
  }
  window.addEventListener("resize", () => {
    if (active) positionStatus();
  });

  function recomputeDamage(): void {
    if (missed.size === 0) {
      nodes.setDamage(null);
      edges.setDamage(null);
    } else {
      const ids = new Set<string>();
      for (const i of missed) ids.add(graph.nodes[i].id);
      const nodeDamage = damage.compute(ids);
      nodes.setDamage(nodeDamage);
      edges.setDamage(damage.edgeDamage(nodeDamage));
    }
    requestRender();
  }

  function toggleMissed(nodeIndex: number): void {
    if (!active) return;
    if (missed.has(nodeIndex)) missed.delete(nodeIndex);
    else missed.add(nodeIndex);
    recomputeDamage();
    renderStatus();
    const n = missed.size;
    announce(`${n} standard${n === 1 ? "" : "s"} marked missed`);
  }

  function clear(): void {
    if (missed.size === 0) return;
    missed.clear();
    recomputeDamage();
    renderStatus();
    announce("Cleared all marked standards");
  }

  function setActive(on: boolean): void {
    if (on === active) return;
    active = on;
    chip.setAttribute("aria-pressed", String(on));
    if (on) {
      status.hidden = false;
      positionStatus();
      renderStatus();
      recomputeDamage(); // no marks yet → clears any stray damage
      announce("Gaps mode on. Click standards to mark them missed.");
    } else {
      missed.clear();
      nodes.setDamage(null);
      edges.setDamage(null);
      status.hidden = true;
      requestRender();
      announce("Gaps mode off");
    }
  }

  // A node click marks/unmarks instead of focusing while the mode is on.
  picking.setClickGuard((nodeIndex) => {
    if (!active) return false;
    toggleMissed(nodeIndex);
    return true;
  });

  return {
    get active() {
      return active;
    },
    toggleMissed,
    setActive,
    dispose() {
      picking.setClickGuard(null);
      chip.remove();
      status.remove();
    },
  };
}
