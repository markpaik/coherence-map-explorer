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

const MAX_RESULTS = 8;

interface SearchDeps {
  graph: GraphCore;
  machine: Machine;
}

// Minimal shape of the MiniSearch results we consume (avoids importing types
// statically, which would pull the module into the core chunk).
interface Indexed {
  search(query: string, options?: unknown): { id: string }[];
}

function hexColor(v: number): string {
  return `#${v.toString(16).padStart(6, "0")}`;
}
function shortTitle(text: string, words = 8): string {
  const parts = text.split(/\s+/);
  const t = parts.slice(0, words).join(" ");
  return parts.length > words ? `${t}…` : t;
}

export interface SearchHandle {
  /** Briefly ring the search rail (the tour's "Find your standard" stop). */
  pulse(): void;
  dispose(): void;
}

export function createSearch(deps: SearchDeps): SearchHandle {
  const { graph, machine } = deps;
  const rail = document.getElementById("search-rail");
  const inputEl = document.getElementById("search-input") as HTMLInputElement | null;
  if (!rail || !inputEl) throw new Error("Search rail missing (#search-rail / #search-input)");
  const input: HTMLInputElement = inputEl; // non-null binding for closures below

  const docsById = new Map<string, SearchDoc>();
  let index: Indexed | null = null;
  let indexing = false;
  let active = -1;
  let results: SearchDoc[] = [];

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
      if (input && input.value.trim()) runSearch(input.value);
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

  function renderResults(): void {
    dropdown.replaceChildren();
    if (!results.length) {
      dropdown.hidden = true;
      input?.setAttribute("aria-expanded", "false");
      return;
    }
    results.forEach((d, i) => {
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
      dropdown.appendChild(li);
    });
    dropdown.hidden = false;
    input?.setAttribute("aria-expanded", "true");
    syncActiveDescendant();
    machine.setSearching(true);
  }

  function runSearch(query: string): void {
    const q = query.trim();
    if (!index || !q) {
      results = [];
      renderResults();
      return;
    }
    const hits = index.search(q).slice(0, MAX_RESULTS);
    results = hits
      .map((h) => docsById.get(h.id))
      .filter((d): d is SearchDoc => d !== undefined);
    active = results.length ? 0 : -1;
    renderResults();
  }

  function choose(i: number): void {
    const d = results[i];
    if (!d) return;
    input!.value = d.code;
    closeDropdown();
    input!.blur();
    machine.focusByCode(d.code);
  }

  function move(delta: number): void {
    if (!results.length) return;
    active = (active + delta + results.length) % results.length;
    renderResults();
    const el = document.getElementById(`search-result-${active}`);
    el?.scrollIntoView({ block: "nearest" });
  }

  // Input events.
  const onFocus = (): void => {
    rail.classList.add("search-docked");
    void ensureIndex();
    if (results.length) renderResults();
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
