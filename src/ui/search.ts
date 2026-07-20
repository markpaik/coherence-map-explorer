// Search — wires the (previously inert) search rail. The MiniSearch index and
// the search.json payload are BOTH lazy: nothing is fetched or bundled until
// the input first receives focus, which also docks the rail to top-center.
//
// Query fields code/text/domainName/clusterName, prefix + fuzzy 0.2, field
// boosts code×3 / text×1.5. Results (max 8) list a grade/strand chip + code +
// title; ↑/↓ move, Enter focuses the standard (camera + panel), Esc closes the
// dropdown. "/" from anywhere (not while typing) jumps to the input.

import type { GraphCore, SearchDoc } from "../data";
import { loadSearchDocs } from "../data";
import { STRAND_COLORS } from "../scene/palette";
import type { Machine } from "../state/machine";
import { rankResults, type RankItem } from "./searchrank";

const MAX_RESULTS = 8;

interface SearchDeps {
  graph: GraphCore;
  machine: Machine;
}

// Minimal shape of the MiniSearch results we consume (avoids importing types
// statically, which would pull the module into the core chunk). We read the
// relevance score too, for the parent-boost post-ranking.
interface Indexed {
  search(query: string, options?: unknown): { id: string; score: number }[];
}

function hexColor(v: number): string {
  return `#${v.toString(16).padStart(6, "0")}`;
}
function shortTitle(text: string, words = 8): string {
  const parts = text.split(/\s+/);
  const t = parts.slice(0, words).join(" ");
  return parts.length > words ? `${t}…` : t;
}
// The screen-reader name for a result's grade chip ("4" alone is ambiguous).
function gradeAccessibleName(grade: string): string {
  return grade === "HS" ? "High school" : `Grade ${grade}`;
}

/** Live filter state, so suppressed matches are surfaced (not silently dropped). */
export interface FilterContext {
  /** Does this standard pass the current filter chips (grade + strand + lens)? */
  passes: (id: string) => boolean;
  /** Is any filter group currently narrowing? */
  isFiltering: () => boolean;
  /** Clear every filter group — the "Show all" escape hatch. */
  clearAll: () => void;
}

export interface SearchHandle {
  /** Briefly ring the search rail (the tour's "Find your standard" stop). */
  pulse(): void;
  /** Provide the live filter state. When filters suppress matches, results show
   * a "N more hidden by filters · Show all" row instead of dropping them.
   * Wired after createFilters (search is constructed before the filter rail). */
  setFilterContext(ctx: FilterContext | null): void;
  dispose(): void;
}

export function createSearch(deps: SearchDeps): SearchHandle {
  const { graph, machine } = deps;
  let filterCtx: FilterContext | null = null;
  // Parent standard id per node id — for the parent-boost ranking.
  const parentById = new Map<string, string | undefined>();
  for (const n of graph.nodes) parentById.set(n.id, n.parent);
  const rail = document.getElementById("search-rail");
  const inputEl = document.getElementById("search-input") as HTMLInputElement | null;
  if (!rail || !inputEl) throw new Error("Search rail missing (#search-rail / #search-input)");
  const input: HTMLInputElement = inputEl; // non-null binding for closures below

  const docsById = new Map<string, SearchDoc>();
  let index: Indexed | null = null;
  let indexing = false;
  let active = -1;
  let results: SearchDoc[] = [];
  // Matches suppressed by the active filters (surfaced as a "Show all" row).
  let hiddenCount = 0;
  // The query string that produced the current results — so focus doesn't
  // reopen a stale dropdown over a box that has since been cleared.
  let lastQuery = "";
  const totalOptions = (): number => results.length + (hiddenCount > 0 ? 1 : 0);

  // Activate the rail (Phase 2 shipped it inert via aria-hidden + a CSS
  // pointer-events:none; override the latter explicitly rather than clearing it).
  rail.removeAttribute("aria-hidden");
  rail.style.pointerEvents = "auto";
  input.removeAttribute("readonly");
  input.removeAttribute("tabindex");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", "search-results");

  // Results dropdown (the listbox the combobox controls).
  const dropdown = document.createElement("ul");
  dropdown.className = "search-results";
  dropdown.id = "search-results";
  dropdown.setAttribute("role", "listbox");
  dropdown.setAttribute("aria-label", "Search results");
  dropdown.hidden = true;
  rail.appendChild(dropdown);

  // aria-activedescendant tracks the highlighted option without moving DOM focus.
  function syncActiveDescendant(): void {
    if (active >= 0 && !dropdown.hidden) {
      input.setAttribute("aria-activedescendant", `search-result-${active}`);
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  async function ensureIndex(): Promise<void> {
    if (index || indexing) return;
    indexing = true;
    try {
      const [{ default: MiniSearch }, docs] = await Promise.all([
        import("minisearch"),
        loadSearchDocs(),
      ]);
      for (const d of docs) docsById.set(d.id, d);
      const ms = new MiniSearch({
        idField: "id",
        fields: ["code", "text", "domainName", "clusterName"],
        storeFields: ["id"],
        searchOptions: { prefix: true, fuzzy: 0.2, boost: { code: 3, text: 1.5 } },
      });
      ms.addAll(docs);
      index = ms as unknown as Indexed;
      // Only auto-run if the input is STILL focused with a live query — the
      // index can resolve after the user has already blurred away, and
      // re-running would silently reopen the dropdown over the idle scene.
      if (input && input.value.trim() && document.activeElement === input) {
        runSearch(input.value);
      }
    } catch (err) {
      console.warn("[cme] search index failed to build", err);
    } finally {
      indexing = false;
    }
  }

  function closeDropdown(): void {
    dropdown.hidden = true;
    active = -1;
    input?.setAttribute("aria-expanded", "false");
    syncActiveDescendant();
    machine.setSearching(false);
  }

  // Build one result <li> (a standard) as a listbox option.
  function resultOption(d: SearchDoc, i: number): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "search-result";
    li.id = `search-result-${i}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(i === active));
    if (i === active) li.classList.add("active");

    const chip = document.createElement("span");
    chip.className = "res-chip";
    chip.style.setProperty("--dot", hexColor(STRAND_COLORS[d.strand]));
    chip.textContent = d.grade;
    chip.setAttribute("aria-label", gradeAccessibleName(d.grade));

    const code = document.createElement("span");
    code.className = "res-code";
    code.textContent = d.code;

    const title = document.createElement("span");
    title.className = "res-title";
    title.textContent = shortTitle(d.text);

    li.append(chip, code, title);
    // pointerdown (not click) so selection wins the race with input blur.
    li.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      choose(i);
    });
    return li;
  }

  // The trailing "N more hidden by filters · Show all" row — an actionable
  // option that clears the filters and re-runs the search.
  function hiddenOption(i: number): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "search-hidden";
    li.id = `search-result-${i}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(i === active));
    li.setAttribute("aria-label", `${hiddenCount} more hidden by filters. Show all.`);
    if (i === active) li.classList.add("active");
    const label = document.createElement("span");
    label.className = "search-hidden-label";
    label.textContent = `${hiddenCount} more hidden by filters`;
    const cta = document.createElement("span");
    cta.className = "search-hidden-cta";
    cta.textContent = "Show all";
    li.append(label, cta);
    li.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      choose(i);
    });
    return li;
  }

  function renderResults(): void {
    dropdown.replaceChildren();
    if (!totalOptions()) {
      dropdown.hidden = true;
      active = -1;
      input?.setAttribute("aria-expanded", "false");
      syncActiveDescendant(); // clear the now-dangling active option
      // The rail is still docked and the input still focused, but with no
      // results there is nothing to "search" over — release the drift lock so
      // the idle camera keeps breathing while the user edits their query.
      machine.setSearching(false);
      return;
    }
    results.forEach((d, i) => dropdown.appendChild(resultOption(d, i)));
    if (hiddenCount > 0) dropdown.appendChild(hiddenOption(results.length));
    dropdown.hidden = false;
    input?.setAttribute("aria-expanded", "true");
    syncActiveDescendant();
    machine.setSearching(true);
  }

  function runSearch(query: string): void {
    const q = query.trim();
    lastQuery = q;
    if (!index || !q) {
      results = [];
      hiddenCount = 0;
      renderResults();
      return;
    }
    // Rank ALL matches: parent-boosted score, grade only as a tiebreak (never a
    // global bias). Then partition against the active filters so suppressed
    // matches are counted and surfaced, not silently sliced off the end.
    const items: RankItem[] = [];
    for (const h of index.search(q)) {
      const d = docsById.get(h.id);
      if (d) items.push({ id: d.id, code: d.code, grade: d.grade, score: h.score, parentId: parentById.get(d.id) });
    }
    const rankedDocs = rankResults(items)
      .map((it) => docsById.get(it.id))
      .filter((d): d is SearchDoc => d !== undefined);

    if (filterCtx && filterCtx.isFiltering()) {
      const passing: SearchDoc[] = [];
      let hidden = 0;
      for (const d of rankedDocs) {
        if (filterCtx.passes(d.id)) passing.push(d);
        else hidden++;
      }
      results = passing.slice(0, MAX_RESULTS);
      hiddenCount = hidden;
    } else {
      results = rankedDocs.slice(0, MAX_RESULTS);
      hiddenCount = 0;
    }
    active = totalOptions() ? 0 : -1;
    renderResults();
  }

  // Reset the launcher to a clean, neutral box: empties the input, the results,
  // and the hidden count. Called after a pick so the docked search box never
  // shows a code that drifts out of sync with the panel (and so a programmatic
  // focus-return on panel-close can't reopen a stale dropdown).
  function resetQuery(): void {
    input.value = "";
    results = [];
    hiddenCount = 0;
    lastQuery = "";
    active = -1;
    dropdown.replaceChildren();
    dropdown.hidden = true;
    input.setAttribute("aria-expanded", "false");
    syncActiveDescendant();
  }

  function choose(i: number): void {
    // The trailing option (index === results.length) is "Show all": clear the
    // responsible filters and re-run, keeping focus in the box.
    if (hiddenCount > 0 && i === results.length) {
      filterCtx?.clearAll();
      runSearch(input.value);
      return;
    }
    const d = results[i];
    if (!d) return;
    const code = d.code;
    resetQuery();
    machine.setSearching(false);
    input!.blur();
    machine.focusByCode(code);
  }

  function move(delta: number): void {
    const total = totalOptions();
    if (!total) return;
    active = (active + delta + total) % total;
    renderResults();
    const el = document.getElementById(`search-result-${active}`);
    el?.scrollIntoView({ block: "nearest" });
  }

  // Input events.
  const onFocus = (): void => {
    rail.classList.add("search-docked");
    void ensureIndex();
    // Reopen the last results only if the box still holds the query that made
    // them. After a pick the box is cleared, so a programmatic focus-return
    // (the panel's X returns focus here) can't reopen a stale dropdown.
    const q = input.value.trim();
    if (q && q === lastQuery && totalOptions()) renderResults();
  };
  const onInput = (): void => {
    if (index) runSearch(input.value);
  };
  const onBlur = (): void => {
    // Delay so a pointerdown on a result still registers.
    window.setTimeout(() => {
      if (document.activeElement !== input) closeDropdown();
    }, 120);
  };
  const onKeydown = (e: KeyboardEvent): void => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        break;
      case "Enter":
        if (active >= 0) {
          e.preventDefault();
          choose(active);
        }
        break;
      case "Escape":
        if (!dropdown.hidden) {
          e.preventDefault();
          e.stopPropagation();
          closeDropdown();
        }
        break;
    }
  };
  input.addEventListener("focus", onFocus);
  input.addEventListener("input", onInput);
  input.addEventListener("blur", onBlur);
  input.addEventListener("keydown", onKeydown);

  // "/" focuses search from anywhere (unless already typing in a field).
  const isTypingTarget = (t: EventTarget | null): boolean =>
    t instanceof HTMLElement &&
    (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  const onGlobalKey = (e: KeyboardEvent): void => {
    if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  };
  document.addEventListener("keydown", onGlobalKey);

  return {
    setFilterContext(ctx) {
      filterCtx = ctx;
    },
    pulse() {
      rail.classList.remove("search-pulse");
      // reflow so re-adding the class restarts the animation
      void rail.offsetWidth;
      rail.classList.add("search-pulse");
      window.setTimeout(() => rail.classList.remove("search-pulse"), 2400);
    },
    dispose() {
      input.removeEventListener("focus", onFocus);
      input.removeEventListener("input", onInput);
      input.removeEventListener("blur", onBlur);
      input.removeEventListener("keydown", onKeydown);
      document.removeEventListener("keydown", onGlobalKey);
      dropdown.remove();
    },
  };
}
