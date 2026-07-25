// An active focus temporarily overrides a grade/strand filter for exactly its
// lit closure: the focus's connected standards reappear even when the filter
// ghosts them, while everything unconnected stays ghosted. composeVisibility is
// the pure rule filters.recompute routes through — a node is visible if the
// filter shows it OR the focus override includes it; an edge iff BOTH endpoints
// are, so revealing the override nodes reveals exactly the lit-closure edges.

import { describe, it, expect } from "vitest";
import { composeVisibility } from "../src/ui/filters";

// A tiny chain 0-1-2-3 (three edges). "Solo grade" is modelled as: only node 1
// passes the base filter.
const edgeS = [0, 1, 2];
const edgeT = [1, 2, 3];
const shownOnly1 = (i: number): boolean => i === 1;

function compose(override: Set<number> | null): { visN: number[]; visE: number[] } {
  const visN = [0, 0, 0, 0];
  const visE = [0, 0, 0];
  composeVisibility(4, shownOnly1, override, 3, edgeS, edgeT, visN, visE);
  return { visN, visE };
}

describe("composeVisibility — focus override through a filter", () => {
  it("with no override, only the filtered node shows; its edges stay ghosted", () => {
    const { visN, visE } = compose(null);
    expect(visN).toEqual([0, 1, 0, 0]);
    expect(visE).toEqual([0, 0, 0]); // every edge touches a hidden endpoint
  });

  it("the override un-ghosts its nodes even when the filter hides them", () => {
    // Focus node 1, connected to 0 and 2 (its lit closure); 3 is not connected.
    const { visN } = compose(new Set([1, 0, 2]));
    expect(visN).toEqual([1, 1, 1, 0]);
  });

  it("edges among the override reappear; edges to a hidden neighbour stay hidden", () => {
    const { visE } = compose(new Set([1, 0, 2]));
    // 0-1 and 1-2 are both inside the override → visible; 2-3 touches hidden 3.
    expect(visE).toEqual([1, 1, 0]);
  });

  it("clearing the override returns exactly the filter's own view", () => {
    expect(compose(null)).toEqual(compose(new Set())); // empty set = no override
  });

  it("the override never HIDES a node the filter already shows", () => {
    // Override omits node 1, but the filter shows it: it stays visible.
    const { visN } = compose(new Set([0]));
    expect(visN[1]).toBe(1);
    expect(visN[0]).toBe(1);
  });
});
