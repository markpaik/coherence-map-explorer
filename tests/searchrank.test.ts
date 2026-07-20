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

describe("rankResults on the real index: 'add fractions'", () => {
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

  const ranked = rankResults(
    ms.search("add fractions").map((h) => {
      const d = byId.get(h.id as string)!;
      return {
        id: h.id as string,
        code: d.code,
        grade: d.grade,
        score: h.score,
        parentId: parentById.get(h.id as string),
      };
    }),
  );
  const order = ranked.map((r) => r.code);

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
});
