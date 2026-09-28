// Search post-ranking: the parent-boost + grade-tiebreak rules, and a live check
// against the real MiniSearch index for the brief's canonical query.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import MiniSearch from "minisearch";
import { rankResults, gradeRank, type RankItem } from "../src/ui/searchrank";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const codes = (items: RankItem[]): string[] => items.map((i) => i.code);

describe("rankResults: parent boost", () => {
  it("lifts a parent above its own sub-standards when both match", () => {
    // Parent scores LOWER than its children on raw relevance, yet leads.
    const ranked = rankResults([
      { id: "p", code: "4.NF.B.3", grade: "4", score: 30 },
      { id: "c", code: "4.NF.B.3.c", grade: "4", score: 36, parentId: "p" },
      { id: "d", code: "4.NF.B.3.d", grade: "4", score: 35, parentId: "p" },
    ]);
    expect(codes(ranked)).toEqual(["4.NF.B.3", "4.NF.B.3.c", "4.NF.B.3.d"]);
  });

  it("keeps a standalone standard at its own score (no phantom boost)", () => {
    const ranked = rankResults([
      { id: "a", code: "5.NF.A.1", grade: "5", score: 55 },
      { id: "b", code: "4.NF.C.5", grade: "4", score: 50 },
    ]);
    expect(codes(ranked)).toEqual(["5.NF.A.1", "4.NF.C.5"]);
  });

  it("does not boost a parent that is not itself in the result set", () => {
    // Only a child matched; there is no parent row to lift.
    const ranked = rankResults([
      { id: "hi", code: "8.EE.A.1", grade: "8", score: 40 },
      { id: "c", code: "4.NF.B.3.c", grade: "4", score: 36, parentId: "p" },
    ]);
    expect(codes(ranked)).toEqual(["8.EE.A.1", "4.NF.B.3.c"]);
  });
});

describe("rankResults: an exact code match ranks first (redteam finding 85)", () => {
  it("puts the exact sub-standard ahead of higher-scoring fuzzy hits and its parent", () => {
    const ranked = rankResults(
      [
        { id: "x", code: "5.NF.B.4", grade: "5", score: 90 },
        { id: "p", code: "4.NF.B.3", grade: "4", score: 60 },
        { id: "c", code: "4.NF.B.3.c", grade: "4", score: 50, parentId: "p" },
      ],
      "4.NF.B.3.c",
    );
    expect(codes(ranked)[0]).toBe("4.NF.B.3.c");
  });

  it("ignores case and surrounding whitespace", () => {
    const items = [
      { id: "x", code: "4.NF.B.4", grade: "4", score: 90 },
      { id: "p", code: "4.NF.B.3", grade: "4", score: 10 },
    ];
    expect(codes(rankResults(items, "4.nf.b.3"))[0]).toBe("4.NF.B.3");
    expect(codes(rankResults(items, "  4.NF.B.3 \t"))[0]).toBe("4.NF.B.3");
  });

  it("leaves the order unchanged when nothing matches the query exactly", () => {
    const items = [
      { id: "p", code: "4.NF.B.3", grade: "4", score: 30 },
      { id: "c", code: "4.NF.B.3.c", grade: "4", score: 36, parentId: "p" },
    ];
    expect(codes(rankResults(items, "add fractions"))).toEqual(codes(rankResults(items)));
  });
});

describe("rankResults: grade is only a tiebreak, never a global bias", () => {
  it("a higher-scoring later grade still beats a lower-scoring early grade", () => {
    const ranked = rankResults([
      { id: "lo", code: "1.OA.A.1", grade: "1", score: 10 },
      { id: "hi", code: "HS.F", grade: "HS", score: 90 },
    ]);
    expect(codes(ranked)).toEqual(["HS.F", "1.OA.A.1"]);
  });

  it("equal scores break toward the lower grade", () => {
    const ranked = rankResults([
      { id: "g5", code: "5.NF.A.1", grade: "5", score: 42 },
      { id: "g4", code: "4.NF.C.5", grade: "4", score: 42 },
    ]);
    expect(codes(ranked)).toEqual(["4.NF.C.5", "5.NF.A.1"]);
  });

  it("gradeRank orders K < 1 < … < 8 < HS and unknowns last", () => {
    expect(gradeRank("K")).toBeLessThan(gradeRank("1"));
    expect(gradeRank("8")).toBeLessThan(gradeRank("HS"));
    expect(gradeRank("??")).toBeGreaterThanOrEqual(gradeRank("HS"));
  });
});

describe("rankResults on the real index", () => {
  const docs = JSON.parse(
    readFileSync(resolve(ROOT, "public/data/search.json"), "utf8"),
  ) as { id: string; code: string; grade: string }[];
  const core = JSON.parse(
    readFileSync(resolve(ROOT, "public/data/graph-core.json"), "utf8"),
  ) as { nodes: { id: string; parent?: string }[] };
  const parentById = new Map(core.nodes.map((n) => [n.id, n.parent]));
  const byId = new Map(docs.map((d) => [d.id, d]));

  const ms = new MiniSearch({
    idField: "id",
    fields: ["code", "text", "domainName", "clusterName"],
    storeFields: ["id"],
    searchOptions: { prefix: true, fuzzy: 0.2, boost: { code: 3, text: 1.5 } },
  });
  ms.addAll(docs as unknown as Record<string, unknown>[]);

  // The same mapping search.ts / browse.ts run: MiniSearch hits → rank items
  // → rankResults with the typed query.
  const rankQuery = (q: string): string[] =>
    rankResults(
      ms.search(q).map((h) => {
        const d = byId.get(h.id as string)!;
        return {
          id: h.id as string,
          code: d.code,
          grade: d.grade,
          score: h.score,
          parentId: parentById.get(h.id as string),
        };
      }),
      q,
    ).map((r) => r.code);
  const order = rankQuery("add fractions");

  it("4.NF.B.3 beats its own sub-standards .c and .d", () => {
    const p = order.indexOf("4.NF.B.3");
    const c = order.indexOf("4.NF.B.3.c");
    const d = order.indexOf("4.NF.B.3.d");
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(c);
    expect(p).toBeLessThan(d);
  });

  it("the top result is still the strongest raw relevance match", () => {
    expect(order[0]).toBe("5.NF.A.1");
  });

  // Finding 85: typing a full code and pressing Enter opened the wrong standard.
  // "4.NF.B.3.c" ranked 7th of 8 behind 5.NF.B.4; "A-SSE.B.3.c" ranked 4th behind
  // 3.MD.C.7. Enter picks the first row, so the exact code must lead.
  it.each([
    ["4.NF.B.3.c", "4.NF.B.3.c"],
    ["A-SSE.B.3.c", "A-SSE.B.3.c"],
    ["6.RP.A.3.a", "6.RP.A.3.a"],
    ["4.nf.b.3", "4.NF.B.3"],
    ["4.NF.B.3", "4.NF.B.3"],
    [" 4.NF.B.3.c ", "4.NF.B.3.c"],
  ])("an exact code query %j ranks %s first", (q, want) => {
    expect(rankQuery(q)[0]).toBe(want);
  });

  it("an exact sub-standard query outranks its own parent (exact beats the boost)", () => {
    const order = rankQuery("4.NF.B.3.c");
    expect(order.indexOf("4.NF.B.3.c")).toBeLessThan(order.indexOf("4.NF.B.3"));
  });
});
