// Pure solo-toggle logic for a filter chip group where every chip defaults ON.
// Extracted from filters.ts so it can be unit tested (tests/chipgroup.test.ts).
//
// The trap this fixes: chips that default all-on and toggle as EXCLUSIONS. A
// teacher clicks "4" meaning "show me grade 4" and instead turns grade 4 OFF.
// SOLO semantics make the obvious click do the obvious thing:
//
//   - all chips on   + click X            → SOLO X (only X stays on)
//   - only X on      + click X            → restore ALL (X was soloed)
//   - a subset on    + click X            → normal toggle (add / remove X)
//
// Toggling can never empty the group: the only way to reach size 1 is a solo (or
// a subset toggle down to one), and clicking that last chip restores all.

export type ChipMode = "all" | "solo" | "subset";

export interface ChipToggle {
  /** Next active ids, in `all` order (stable, deduped). */
  active: string[];
  /** all = every chip on · solo = exactly one on · subset = some but not all. */
  mode: ChipMode;
}

export function toggleChip(
  all: readonly string[],
  active: Iterable<string>,
  clicked: string,
): ChipToggle {
  const set = new Set(active);
  const total = all.length;

  let next: Set<string>;
  if (set.size === total) {
    next = new Set([clicked]); // all on → solo the clicked chip
  } else if (set.size === 1 && set.has(clicked)) {
    next = new Set(all); // the clicked chip was soloed → restore all
  } else {
    next = new Set(set); // a subset is active → plain toggle
    if (next.has(clicked)) next.delete(clicked);
    else next.add(clicked);
  }

  const mode: ChipMode =
    next.size === total ? "all" : next.size === 1 ? "solo" : "subset";
  return { active: all.filter((id) => next.has(id)), mode };
}
