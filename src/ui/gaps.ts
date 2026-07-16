// Gaps — the interactive impact simulator (STORIES.md). It shares the stories'
// damage engine but runs Mark's DECAY model, not the ancestry-share model: the
// input is you. Turn the mode on, click standards to mark them missed, and
// watch the structural damage recompute live — hitting immediate dependents
// hard and FADING with distance, because students patch over far-off gaps
// superficially.
//
// Gaps is a TOOL, not a filter lens, so it does NOT live in the filters rail.
// Its pill sits in the bottom-right tools corner, stacked directly above the
// Constellation/Ascent view toggle (glass, 44px target, aria-pressed). The live
// status, Clear, and the one-line decay explainer sit above the pill while the
// mode is on.
//
// While the mode is on, a node click MARKS the standard (via the picking click
// guard) instead of opening the panel — hover tooltips still work, so you can
// read what you are marking. Toggling off clears the damage and restores
// click-to-focus.

import type { GraphCore } from "../data";
import type { NodesHandle } from "../scene/nodes";
import type { EdgesHandle } from "../scene/edges";
import type { PickingHandle } from "../interaction/picking";
import type { DamageEngine } from "../stories/damage";

export interface GapsDeps {
  graph: GraphCore;
  damage: DamageEngine;
  nodes: NodesHandle;
  edges: EdgesHandle;
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
  const { graph, damage, nodes, edges, picking, requestRender, announce } = deps;

  const missed = new Set<number>(); // node indices marked missed
  let active = false;

  // --- tools corner (bottom-right, stacked above the view toggle) ---------
  const tool = document.createElement("div");
  tool.className = "gaps-tool";

  // Status + explainer panel (shown only while the mode is on), above the pill.
  const panel = document.createElement("div");
  panel.className = "gaps-panel";
  panel.hidden = true;

  const explainer = document.createElement("p");
  explainer.className = "gaps-explainer";
  explainer.textContent = "Impact fades with distance: students patch over far-off gaps, thinly.";

  const status = document.createElement("div");
  status.className = "gaps-status";
  status.setAttribute("role", "status");
  const statusText = document.createElement("span");
  statusText.className = "gaps-status-text";
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "gaps-clear";
  clearBtn.textContent = "Clear";
  clearBtn.addEventListener("click", () => clear());
  status.append(statusText, clearBtn);

  panel.append(explainer, status);

  // The pill itself — glass, styled like the view-toggle segment.
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "gaps-pill";
  pill.textContent = "Gaps";
  pill.title = "Mark standards missed and watch the structural damage spread.";
  pill.setAttribute("aria-pressed", "false");
  pill.addEventListener("click", () => setActive(!active));

  tool.append(panel, pill);
  document.body.appendChild(tool);

  function renderStatus(): void {
    const n = missed.size;
    statusText.textContent =
      n === 0 ? "Click a standard to mark it missed" : `${n} standard${n === 1 ? "" : "s"} marked missed`;
    clearBtn.disabled = n === 0;
  }

  function recomputeDamage(): void {
    if (missed.size === 0) {
      nodes.setDamage(null);
      edges.setDamage(null);
    } else {
      const ids = new Set<string>();
      for (const i of missed) ids.add(graph.nodes[i].id);
      const nodeDamage = damage.computeDecay(ids);
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
    pill.setAttribute("aria-pressed", String(on));
    if (on) {
      panel.hidden = false;
      renderStatus();
      recomputeDamage(); // no marks yet → clears any stray damage
      announce("Gaps mode on. Click standards to mark them missed.");
    } else {
      missed.clear();
      nodes.setDamage(null);
      edges.setDamage(null);
      panel.hidden = true;
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
      tool.remove();
    },
  };
}
