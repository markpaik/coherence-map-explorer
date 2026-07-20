// Pure search post-ranking — kept out of search.ts / browse.ts so it can be unit
// tested directly (tests/searchrank.test.ts). MiniSearch gives a relevance score;
// this shapes it into the order a teacher expects:
//
//   1. A PARENT standard never ranks below its own sub-standards. A family is one
//      idea on the original coherence map, so a parent inherits the best score
//      among itself and any of its matched children (a "parent boost"). Query
//      'add fractions' otherwise buried 4.NF.B.3 beneath 4.NF.B.3.c / .d.
//   2. NO global grade bias. Grade is only a TIEBREAK (lower grade first) when two
//      results score the same, so an on-grade phrasing never jumps the true match.
//   3. Code ascending is the final tiebreak, which also places a parent
//      ("4.NF.B.3") immediately before its children ("4.NF.B.3.c") — the parent
//      code is a prefix, so it sorts first when scores tie after the boost.

const GRADE_ORDER = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "HS"];
export function gradeRank(grade: string): number {
  const i = GRADE_ORDER.indexOf(grade);
  return i < 0 ? GRADE_ORDER.length : i;
}

export interface RankItem {
  id: string;
  code: string;
  grade: string;
  /** MiniSearch relevance score (higher = better). */
  score: number;
  /** Parent standard id, when this is a sub-standard; undefined otherwise. */
  parentId?: string;
}

/**
 * Order matched standards: parent-boosted score descending, then grade ascending,
 * then code ascending. Pure and stable-enough (total order via the code tiebreak).
 * Returns a new array; the input is not mutated.
 */
export function rankResults<T extends RankItem>(items: readonly T[]): T[] {
  const present = new Set(items.map((i) => i.id));
  // Effective score: a parent gets the max score across itself and its matched
  // children, so a strong sub-standard lifts its whole family (parent first).
  const eff = new Map<string, number>();
  for (const it of items) eff.set(it.id, it.score);
  for (const it of items) {
    if (it.parentId && present.has(it.parentId)) {
      const p = eff.get(it.parentId) ?? -Infinity;
      if (it.score > p) eff.set(it.parentId, it.score);
    }
  }
  return [...items].sort((a, b) => {
    const sa = eff.get(a.id) ?? a.score;
    const sb = eff.get(b.id) ?? b.score;
    if (sb !== sa) return sb - sa;
    const ga = gradeRank(a.grade);
    const gb = gradeRank(b.grade);
    if (ga !== gb) return ga - gb;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });
}
