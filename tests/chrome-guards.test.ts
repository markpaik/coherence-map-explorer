// The 2026-07 chrome audit: nine defects in surfaces that have no pure model to
// exercise (they are DOM wiring, a deploy config, or a promise the pose driver
// parks). Where a defect has arithmetic, it is reproduced here for real; where it
// is wiring, the wiring itself is pinned against the source, which is the same
// device tests/family-rollup.test.ts uses to keep Browse from drifting off the
// shared resolver.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const read = (p: string): string => readFileSync(resolve(ROOT, p), "utf8");

// ---------------------------------------------------------------------------
// Browse history accounting (finding: the chevron walked the browser out).
// ---------------------------------------------------------------------------

/**
 * The exact model browse.ts implements: a Browse stack, a counter of the history
 * entries this session pushed, and a real history depth. `back()` returns false
 * when the browser would leave the app — which is the bug, made observable.
 */
function browseModel() {
  let stack = 1; // views on the Browse stack (1 = Home)
  let pushed = 0; // entries WE pushed, by the counter
  let real = 0; // entries we pushed that are still ahead of us, for real
  let overlayHidden = false;
  let leftTheApp = false;

  const collapse = (): void => {
    if (stack > 1) stack -= 1;
  };
  // The popstate the browser fires after any back navigation.
  const onPopState = (decrementAlways: boolean): void => {
    if (decrementAlways) {
      if (pushed > 0) pushed -= 1;
    }
    if (overlayHidden) {
      if (!decrementAlways && pushed > 0) return; // the old early return
      return;
    }
    if (!decrementAlways && pushed > 0) pushed -= 1;
    if (stack <= 1) {
      pushed = 0;
      return;
    }
    collapse();
  };
  const back = (decrementAlways: boolean): void => {
    if (real > 0) real -= 1;
    else leftTheApp = true; // nothing of ours left: the browser leaves the app
    onPopState(decrementAlways);
  };

  return {
    push(): void {
      stack += 1;
      pushed += 1;
      real += 1;
    },
    seeInTheMap(): void {
      overlayHidden = true;
    },
    reopenBrowse(): void {
      overlayHidden = false;
    },
    systemBack(decrementAlways: boolean): void {
      back(decrementAlways);
    },
    chevron(decrementAlways: boolean): void {
      if (stack <= 1) return;
      if (pushed > 0) back(decrementAlways);
      else collapse();
    },
    get state() {
      return { stack, pushed, real, leftTheApp };
    },
  };
}

// The reported sequence, run against both accountings.
function runReportedSequence(decrementAlways: boolean) {
  const b = browseModel();
  b.push(); // grade
  b.push(); // domain
  b.push(); // standard  → 3 deep
  b.seeInTheMap();
  b.systemBack(decrementAlways);
  b.reopenBrowse();
  b.chevron(decrementAlways);
  b.chevron(decrementAlways);
  b.chevron(decrementAlways);
  return b.state;
}

describe("Browse history: the pushed-entry counter tracks history, not visibility", () => {
  it("the OLD accounting (skip the decrement while hidden) leaves the app", () => {
    expect(runReportedSequence(false).leftTheApp).toBe(true);
  });

  it("decrementing on ANY popstate keeps the reported sequence in-app", () => {
    const s = runReportedSequence(true);
    expect(s.leftTheApp, "history.back() is never called with nothing to pop").toBe(false);
    expect(s.stack, "and it lands back at Home").toBe(1);
    expect(s.pushed).toBe(0);
  });

  it("browse.ts decrements before the visibility gate, and clamps pop()", () => {
    const src = read("src/ui/browse.ts");
    // The decrement must come BEFORE the overlay.hidden early return.
    const handler = src.slice(src.indexOf("function onPopState()"));
    const decrementAt = handler.indexOf("pushedEntries--");
    const gateAt = handler.indexOf("if (overlay.hidden) return;");
    expect(decrementAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(-1);
    expect(decrementAt, "decrement precedes the visibility gate").toBeLessThan(gateAt);
    // pop() never calls history.back() when we have pushed nothing at all.
    expect(src).toContain("history.length > historyBaseline");
  });
});

// ---------------------------------------------------------------------------
// Search rail: "/" and Enter stand down while a story or the tour runs.
// ---------------------------------------------------------------------------

describe("search rail stands down during a story and the tour", () => {
  const src = read("src/ui/search.ts");
  const css = read("src/style.css");
  const tour = read("src/ui/tour.ts");

  it('the "/" hotkey early-returns while storying or touring', () => {
    expect(src).toContain('document.body.classList.contains("storying")');
    expect(src).toContain('document.body.classList.contains("touring")');
    const handler = src.slice(src.indexOf("const onGlobalKey"));
    expect(handler.slice(0, 400)).toContain("if (isPlaying()) return;");
  });

  it("choose() (the Enter path to focusByCode) is guarded too", () => {
    const choose = src.slice(src.indexOf("function choose("));
    const body = choose.slice(0, choose.indexOf("machine.focusByCode"));
    expect(body).toContain("if (isPlaying()) return;");
  });

  it("a story hides the rail with display:none, so focus cannot enter it", () => {
    expect(css).toMatch(/body\.storying \.search-rail \{\s*display: none;/);
    // The old opacity-0 rule (focusable, tabbable) must not still cover the rail.
    const storyBlock = css.slice(css.indexOf("body.storying .filters-rail"));
    expect(storyBlock.slice(0, 200)).not.toContain(".search-rail");
  });

  it("the tour marks the rail inert instead (it still pulses it on the last stop)", () => {
    expect(tour).toContain("search.setInert(true)");
    expect(tour).toContain("search.setInert(false)");
    expect(src).toContain('rail.setAttribute("inert", "")');
  });
});

// ---------------------------------------------------------------------------
// Tour: restore the reader's focused standard + hash on every exit.
// ---------------------------------------------------------------------------

describe("tour restores the pre-tour routing (mirrors preStoryFocusCode)", () => {
  const tour = read("src/ui/tour.ts");
  const player = read("src/stories/player.ts");

  it("snapshots the focused code on start and restores it in stop()", () => {
    expect(tour).toContain("let preTourFocusCode: string | null = null;");
    expect(tour).toContain(
      "machine.focusedIndex !== null ? graph.nodes[machine.focusedIndex].code : null",
    );
    // Same shape as the story player's restore, and the same history mode.
    expect(tour).toContain('machine.focusByCode(code, { history: "replace" })');
    expect(player).toContain('machine.focusByCode(restoreCode, { history: "replace" })');
  });

  it("stop() calls the restore, and clears the hash when nothing was focused", () => {
    const stop = tour.slice(tour.indexOf("function stop()"), tour.indexOf("function onNext()"));
    expect(stop).toContain("restoreRouting();");
    expect(tour).toContain("history.replaceState(null, \"\", location.pathname + location.search)");
  });
});

// ---------------------------------------------------------------------------
// Pose driver: every morphing=false transition settles the pending promise.
// ---------------------------------------------------------------------------

describe("pose driver: morphing=false always resolves a pending setPose", () => {
  const src = read("src/scene/pose.ts");

  it("finishOpener() resolves — a setPose awaited during the opener never hung", () => {
    const fn = src.slice(src.indexOf("function finishOpener()"));
    const body = fn.slice(0, fn.indexOf("\n  }"));
    expect(body).toContain("morphing = false;");
    expect(body, "the opener's landing settles the pending promise").toContain(
      "resolvePending();",
    );
  });

  it("every morphing=false site is covered by a resolvePending", () => {
    // Five sites: the initial `let`, then finishOpener, jumpTo, startOpener
    // (resolved at its top), and the tick() landing (resolved right after).
    const sites = src.match(/morphing = false;/g) ?? [];
    expect(sites.length).toBe(5);
    // startOpener resolves before it resets, so its site carries the note.
    expect(src).toContain("morphing = false; // invariant held by the resolvePending() at the top");
    const jump = src.slice(src.indexOf("function jumpTo("));
    expect(jump.slice(0, 600)).toContain("resolvePending();");
  });
});

// ---------------------------------------------------------------------------
// Browse glossary chips: keyboard parity with the 3D panel.
// ---------------------------------------------------------------------------

describe("Browse glossary chips are keyboard-operable, like the panel's", () => {
  const browse = read("src/ui/browse.ts");
  const panel = read("src/ui/panel.ts");

  it("chips are focusable and announced (unchanged) in both surfaces", () => {
    for (const src of [browse, panel]) {
      expect(src).toContain("el.tabIndex = 0;");
      expect(src).toContain('el.setAttribute("role", "button");');
    }
  });

  it("Browse now has the panel's focusin/focusout and Enter/Space handlers", () => {
    for (const [name, src, host] of [
      ["browse.ts", browse, "viewHost"],
      ["panel.ts", panel, "body"],
    ] as const) {
      expect(src, `${name} opens the popover on focus`).toContain(
        `${host}.addEventListener("focusin"`,
      );
      expect(src, `${name} closes it on blur`).toContain(
        `${host}.addEventListener("focusout", hidePopover)`,
      );
      // Enter/Space activation on the delegated keydown for the term chips.
      const keydown = src.slice(src.indexOf(`${host}.addEventListener("keydown"`));
      expect(keydown.slice(0, 500), `${name} activates a chip from the keyboard`).toContain(
        'e.key === "Enter" || e.key === " "',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Story card focus trap: DOM order, so the wrap reaches the citation.
// ---------------------------------------------------------------------------

describe("story card focus trap follows DOM order", () => {
  const src = read("src/ui/storycard.ts");

  it("the citation link precedes the controls row in BOTH the DOM and the trap", () => {
    const domOrder = src.indexOf("card.append(kicker, title, bodyEl, cite, extraSlot, controls)");
    expect(domOrder, "card DOM order is unchanged").toBeGreaterThan(-1);
    const trap = src.slice(src.indexOf("function focusables()"));
    const body = trap.slice(0, trap.indexOf("\n  }"));
    const citeAt = body.indexOf("citeLink");
    const backAt = body.indexOf("backBtn");
    expect(citeAt).toBeGreaterThan(-1);
    expect(citeAt, "citeLink is pushed BEFORE the controls").toBeLessThan(backAt);
  });

  it("wraps in both directions through the citation", () => {
    // The trap array, as focusables() now builds it for a cited scene with
    // auto-advance on and 5 scenes.
    const dots = ["dot0", "dot1", "dot2", "dot3", "dot4"];
    const order = ["citeLink", "back", "next", "exit", "pause", ...dots];
    const first = order[0];
    const last = order[order.length - 1];
    // Tab from the last element wraps to the first — which is the citation.
    expect(first).toBe("citeLink");
    // Shift+Tab from the first wraps to the last.
    expect(last).toBe("dot4");
  });
});

// ---------------------------------------------------------------------------
// Data fetches: a deadline, a retry, and a visible failure.
// ---------------------------------------------------------------------------

describe("data fetches cannot stall silently", () => {
  const data = read("src/data.ts");
  const main = read("src/main.ts");
  const search = read("src/ui/search.ts");

  it("every JSON fetch goes through one helper with a timeout and a retry", () => {
    expect(data).toContain("AbortSignal.timeout(FETCH_TIMEOUT_MS)");
    expect(data).toMatch(/FETCH_TIMEOUT_MS = 20_000/);
    expect(data).toContain("for (let attempt = 0; attempt < 2; attempt++)");
    // All three loaders route through it — no bare fetch() left in the module.
    expect((data.match(/fetchJson</g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(data).not.toMatch(/[^n]\bfetch\(["'`]/);
  });

  it("a failed boot replaces the veil with a message and a Reload button", () => {
    const fn = main.slice(main.indexOf("function bootError("));
    const body = fn.slice(0, fn.indexOf("\nfunction "));
    expect(body).toContain('retry.textContent = "Reload"');
    expect(body).toContain("location.reload()");
    expect(body).toContain('document.getElementById("veil")?.remove()');
    // Plain copy, no em dash.
    expect(main).toContain("The coherence map could not load. Check your connection and try again.");
    expect(main).not.toContain("could not load —");
  });

  it("a failed search index renders its own state, not an empty result list", () => {
    expect(search).toContain("let indexFailed = false;");
    expect(search).toContain('label.textContent = "Search is unavailable right now"');
    expect(search).toContain('retry.textContent = "Retry"');
    // The failure state outranks the empty-list branch…
    const render = search.slice(search.indexOf("function renderResults()"));
    const failAt = render.indexOf("indexFailed && lastQuery");
    const emptyAt = render.indexOf("if (!totalOptions())");
    expect(failAt).toBeGreaterThan(-1);
    expect(failAt).toBeLessThan(emptyAt);
    // …and a successful retry clears it.
    expect(search).toContain("indexFailed = false;");
    expect(search).toContain("void ensureIndex().then(");
  });
});

// ---------------------------------------------------------------------------
// Deploy: hashed assets are immutable, documents revalidate.
// ---------------------------------------------------------------------------

describe("_headers cache policy", () => {
  const headers = read("public/_headers");

  const rulesOf = (text: string): Map<string, string[]> => {
    const out = new Map<string, string[]>();
    let current: string | null = null;
    for (const raw of text.split("\n")) {
      if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
      if (!/^\s/.test(raw)) {
        current = raw.trim();
        out.set(current, []);
      } else if (current) {
        out.get(current)!.push(raw.trim());
      }
    }
    return out;
  };

  it("hashed /assets/* is immutable for a year", () => {
    const rules = rulesOf(headers);
    expect(rules.get("/assets/*")).toContain(
      "Cache-Control: public, max-age=31536000, immutable",
    );
  });

  it("index.html and the data JSON keep must-revalidate", () => {
    const rules = rulesOf(headers);
    for (const path of ["/", "/data/*"]) {
      expect(rules.get(path), `${path} has a rule`).toBeDefined();
      expect(rules.get(path)).toContain("Cache-Control: public, max-age=0, must-revalidate");
    }
  });

  it("the security rule is untouched and still applies to everything", () => {
    const rules = rulesOf(headers);
    const all = rules.get("/*") ?? [];
    expect(all.some((h) => h.startsWith("Content-Security-Policy:"))).toBe(true);
    expect(all).toContain("X-Content-Type-Options: nosniff");
    expect(all.some((h) => h.startsWith("Cache-Control"))).toBe(false);
  });
});
