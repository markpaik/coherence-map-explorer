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
// Glossary chips on touch: one tap opens, the next tap closes.
// ---------------------------------------------------------------------------

type GlossEv = { type: string; pointerType?: "touch" | "mouse" };

/**
 * The popover handlers as panel.ts and browse.ts wire them. `fixed: false` is the
 * old wiring (every pointerover/pointerout/focusin acted), `fixed: true` the
 * current one (touch skips hover, and a touch press leaves focus to the click).
 */
function glossaryModel(fixed: boolean) {
  let hidden = true;
  let touchPress = false;
  const on = (e: GlossEv): void => {
    const touch = e.pointerType === "touch";
    if (e.type === "pointerdown" && fixed) touchPress = touch;
    else if (e.type === "pointercancel" && fixed) touchPress = false;
    else if (e.type === "pointerover" && !(fixed && touch)) hidden = false;
    else if (e.type === "pointerout" && !(fixed && touch)) hidden = true;
    else if (e.type === "focusin") {
      if (fixed && touchPress) touchPress = false;
      else hidden = false;
    } else if (e.type === "click") {
      if (fixed) touchPress = false;
      hidden = !hidden;
    }
  };
  return {
    run(evs: GlossEv[]): boolean {
      for (const e of evs) on(e);
      return hidden;
    },
  };
}

const t = (type: string): GlossEv => ({ type, pointerType: "touch" });
const plain = (type: string): GlossEv => ({ type });
// The event order Chromium dispatched for one tap on a term (audit trace,
// 1024x768 touch and 390x844 phone): the first tap also focuses the chip.
const TAP_UNFOCUSED = [
  t("pointerover"), t("pointerdown"), t("pointerup"), t("pointerout"),
  plain("mousedown"), plain("focusin"), plain("mouseup"), t("click"),
];
// The second tap on the same, already-focused chip: no focusin.
const TAP_FOCUSED = [
  t("pointerover"), t("pointerdown"), t("pointerup"), t("pointerout"),
  plain("mousedown"), plain("mouseup"), t("click"),
];

describe("glossary chips: a touch tap goes through the click toggle only", () => {
  it("the OLD wiring shows nothing on the first tap", () => {
    expect(glossaryModel(false).run(TAP_UNFOCUSED), "hidden after tap 1").toBe(true);
  });

  it("now the first tap opens the popover and the second closes it", () => {
    const m = glossaryModel(true);
    expect(m.run(TAP_UNFOCUSED), "shown after tap 1").toBe(false);
    expect(m.run(TAP_FOCUSED), "hidden after tap 2").toBe(true);
    expect(m.run(TAP_FOCUSED), "shown after tap 3").toBe(false);
  });

  it("mouse hover and keyboard focus still open it on their own", () => {
    const mouse = { type: "pointerover", pointerType: "mouse" } as const;
    expect(glossaryModel(true).run([mouse]), "hover shows").toBe(false);
    expect(
      glossaryModel(true).run([mouse, { type: "pointerout", pointerType: "mouse" }]),
      "leaving hides",
    ).toBe(true);
    expect(glossaryModel(true).run([plain("focusin")]), "focus shows").toBe(false);
    // A touch scroll that never clicks does not swallow the next keyboard focus.
    expect(glossaryModel(true).run([t("pointerdown"), t("pointercancel"), plain("focusin")])).toBe(
      false,
    );
  });

  it("panel.ts and browse.ts both carry that wiring", () => {
    for (const [name, host] of [
      ["src/ui/panel.ts", "body"],
      ["src/ui/browse.ts", "viewHost"],
    ] as const) {
      const src = read(name);
      const handler = (type: string): string => {
        const at = src.indexOf(`${host}.addEventListener("${type}"`);
        expect(at, `${name} has a ${type} handler`).toBeGreaterThan(-1);
        return src.slice(at, src.indexOf("\n  });", at));
      };
      expect(handler("pointerdown")).toContain('touchPress = e.pointerType === "touch";');
      expect(handler("pointercancel")).toContain("touchPress = false;");
      for (const type of ["pointerover", "pointerout"]) {
        expect(handler(type), `${name} ${type} ignores touch`).toContain(
          'e.pointerType !== "touch" && isTerm(e.target)',
        );
      }
      const focusin = handler("focusin");
      expect(focusin.indexOf("if (touchPress)"), `${name} focusin defers to the click`).toBeLessThan(
        focusin.indexOf("showPopover"),
      );
      expect(focusin.indexOf("if (touchPress)")).toBeGreaterThan(-1);
      expect(handler("click"), `${name} click ends the gesture`).toContain("touchPress = false;");
    }
  });
});

// ---------------------------------------------------------------------------
// Chrome stacking: the Browse popover and the docked search dropdown.
// ---------------------------------------------------------------------------

describe("glossary popover and search dropdown paint where they can be seen", () => {
  const css = read("src/style.css");
  /** The declarations of the first rule whose selector line matches exactly. */
  const rule = (selectorLine: string): string => {
    const at = css.indexOf(selectorLine + " {\n");
    expect(at, `rule "${selectorLine}" exists`).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  };
  const px = (block: string, prop: string): number => {
    const m = block.match(new RegExp(`\\n\\s*${prop}: (-?\\d+)(px)?;`));
    expect(m, `${prop} is a plain number`).not.toBeNull();
    return Number(m![1]);
  };

  it("the Browse popover sits above the opaque Browse overlay", () => {
    const browse = read("src/ui/browse.ts");
    expect(browse).toContain('popover.className = "glossary-pop glossary-pop-browse";');
    const overlayZ = px(rule("\n.browse"), "z-index");
    const popZ = px(rule("\n.glossary-pop.glossary-pop-browse"), "z-index");
    expect(popZ, "above the overlay").toBeGreaterThan(overlayZ);
    // …and still under the story blocker and dialogs (55+).
    expect(popZ).toBeLessThan(55);
  });

  it("with the panel open, the docked rail and its dropdown live left of the panel (R2)", () => {
    const panelW = px(rule("\n.panel"), "width");
    // --panel-inset is the panel's own width while it is open on desktop…
    const inset = css.match(
      /@media \(min-width: 721px\) \{\n {2}body:has\(\.panel\.panel-open\) \{\n {4}--panel-inset: (\d+)px;/,
    );
    expect(inset, "--panel-inset is set on body while the side panel is open").not.toBeNull();
    expect(Number(inset![1])).toBe(panelW);
    // …and the docked rail anchors inside that region, so the dropdown it
    // drops (from either edge of the bar) can only land left of the panel.
    const docked = rule("\n.search-rail.search-docked");
    expect(docked).toContain("right: calc(var(--panel-inset) + 18px);");
    expect(rule("\n.search-rail.search-docked.search-dock-under")).toContain(
      "right: calc(var(--panel-inset) + var(--gutter));",
    );
    expect(rule("\n.search-results")).toContain("max-width: calc(100vw - var(--panel-inset) - 2 * var(--gutter));");
    // The old right-hung-then-rehung dropdown rule is gone with the problem.
    expect(css).not.toContain("width: min(420px, calc(100% - (480px - 18px + 12px)));");
  });
});

// ---------------------------------------------------------------------------
// Chrome layout: no two chrome surfaces overlap (DESIGN rules R1-R9).
// ---------------------------------------------------------------------------

describe("every chrome surface anchors to the region left of the open panel (R2)", () => {
  const css = read("src/style.css");
  const rule = (selectorLine: string): string => {
    const at = css.indexOf(selectorLine + " {\n");
    expect(at, `rule "${selectorLine}" exists`).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  };

  it("right-anchored surfaces add --panel-inset to their inset", () => {
    for (const sel of ["\n.view-toggle", "\n.nav-hints"]) {
      expect(rule(sel), sel).toContain("right: calc(var(--panel-inset) + var(--gutter));");
    }
  });

  it("centred surfaces centre in the region, not the viewport", () => {
    // The rails: both insets + fit-content + auto margins (left:50% capped the
    // box at 50vw, so the rail could neither wrap nor stay on screen).
    for (const sel of ["\n.search-rail", "\n.filters-rail"]) {
      const r = rule(sel);
      expect(r, sel).toMatch(/right: calc\(var\(--panel-inset\) \+ (12px|var\(--gutter\))\);/);
      expect(r, sel).toContain("margin-inline: auto;");
      expect(r, sel).toContain("width: fit-content;");
      expect(r, sel).not.toContain("left: 50%;");
    }
    expect(rule("\n.tour-card")).toContain("left: calc((100vw - var(--panel-inset)) / 2);");
  });

  it("the old sibling rule that moved only the bottom-right cluster is gone", () => {
    expect(css).not.toContain(".panel.panel-open ~ .view-toggle");
  });

  it("the filter rail wraps grades / strands + lenses instead of hiding (R2)", () => {
    expect(rule("\n.filters-rail.filters-wrapped .filters-groups > .filter-group:first-child")).toContain(
      "flex: 0 0 100%;",
    );
    const layout = read("src/ui/chromelayout.ts");
    expect(layout).toContain('rail.classList.toggle("filters-wrapped", wrapped);');
  });

  it("the bottom band stacks through measured lifts, and the rail installs the pass", () => {
    expect(rule("\n.view-toggle")).toContain("bottom: calc(clamp(46px, 7vh, 62px) + var(--lift-toggle));");
    expect(rule("\n.nav-hints")).toContain("bottom: calc(clamp(46px, 7vh, 62px) + 62px + var(--lift-hints));");
    expect(rule("\n.search-rail")).toContain("bottom: calc(28vh + var(--lift-rail));");
    expect(read("src/ui/search.ts")).toContain("const disposeLayout = installChromeLayout();");
  });
});

describe("phones: the short side decides, portrait and landscape alike (R5)", () => {
  const css = read("src/style.css");
  const layout = read("src/ui/chromelayout.ts");
  const main = read("src/main.ts");

  it("PHONE_QUERY is a coarse pointer whose width OR height is 500px or less", () => {
    const m = layout.match(/export const PHONE_QUERY =\n\s+"([^"]+)";/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("(pointer: coarse) and (max-width: 500px), (pointer: coarse) and (max-height: 500px)");
  });

  it("main.ts takes the Browse default from PHONE_QUERY, not from width alone", () => {
    expect(main).toContain("const isPhoneDefault = window.matchMedia(PHONE_QUERY).matches;");
    expect(main).not.toMatch(/matchMedia\("\(max-width: 720px\)"\)\.matches &&/);
  });

  it("style.css repeats the same list for the phone chrome (title, tour button)", () => {
    const at = css.indexOf("@media (pointer: coarse) and (max-width: 500px), (pointer: coarse) and (max-height: 500px) {");
    expect(at, "phone media block").toBeGreaterThan(-1);
    const block = css.slice(at, at + 600);
    expect(block).toContain("#tour-btn {\n    display: none;");
    expect(block).toContain(".title-block {\n    display: none;");
  });

  it("touch never shows the mouse-only nav hints, at any width", () => {
    expect(css).toMatch(/@media \(pointer: coarse\) \{\n {2}\.nav-hints \{\n {4}display: none;/);
  });

  it("a phone keeps a compact masthead during a story (R7): the wordmark and aside only", () => {
    expect(css).toContain("body.storying .title-block {\n    display: block;");
    expect(css).toContain("body.storying .title-block > :not(.headline) {\n    display: none;");
  });

  it("the Browse search pill focuses its field on a tap anywhere inside it (R6)", () => {
    const browse = read("src/ui/browse.ts");
    expect(browse).toMatch(/searchWrap\.addEventListener\("click", \(e\) => \{\n\s+if \(e\.target !== searchInput\) searchInput\.focus\(\);/);
    expect(css).toContain("align-self: stretch; /* the whole pill height is the field (R6) */");
  });
});

describe("tooltip placement clamps after its flip (R8)", () => {
  it("tooltip.ts places through placeTooltip inside the canvas region, off the chrome", () => {
    const src = read("src/ui/tooltip.ts");
    expect(src).toContain("const c = canvasRegion();");
    expect(src).toContain("placeTooltip(x, y, w, h, region, chromeBoxes(), OFFSET)");
    // The old single flip with no re-clamp must not come back.
    expect(src).not.toContain("left = x - OFFSET - w;");
  });
});

describe("CCSS license notice on every surface that shows standards text (R9)", () => {
  const NOTICE =
    "© Copyright 2010. National Governors Association Center for Best Practices and Council of Chief State School Officers. All rights reserved.";

  it("the shared constant carries the license's notice verbatim, with no em dash", async () => {
    const { CCSS_NOTICE } = await import("../src/ui/license");
    expect(CCSS_NOTICE).toContain(NOTICE);
    expect(CCSS_NOTICE).not.toContain("—");
  });

  it("the map's title block carries the same line, under the credit line", () => {
    const html = read("index.html");
    const at = html.indexOf('<p class="provline">');
    const lic = html.indexOf('<p class="licline license-notice">');
    expect(lic, "licline follows the provline").toBeGreaterThan(at);
    const text = html.slice(lic, html.indexOf("</p>", lic)).replace(/<[^>]+>/g, "").replace("&copy;", "©");
    expect(text).toContain(NOTICE);
  });

  it("Browse (every view), the detail panel and phone sheet, and the no-WebGL list carry it as a footer", () => {
    for (const f of ["src/ui/browse.ts", "src/ui/panel.ts", "src/ui/fallback.ts"]) {
      const src = read(f);
      expect(src, f).toContain('import { CCSS_NOTICE } from "./license";');
      expect(src, f).toMatch(/className = "(browse|panel|fallback)-license license-notice";/);
      expect(src, f).toContain("license.textContent = CCSS_NOTICE;");
    }
    // The panel appends the footer last, so it follows every section it covers.
    expect(read("src/ui/panel.ts")).toMatch(/aiSlot,\s*license,\s*\);/);
  });
});

// ---------------------------------------------------------------------------
// Story card focus trap: DOM order, so the wrap reaches the citation.
// ---------------------------------------------------------------------------

describe("story card focus trap follows DOM order", () => {
  const src = read("src/ui/storycard.ts");

  it("the citation link precedes the controls row in the DOM, and the trap reads the DOM", () => {
    const domOrder = src.indexOf("card.append(kicker, title, bodyEl, cite, extraSlot, controls)");
    expect(domOrder, "card DOM order is unchanged").toBeGreaterThan(-1);
    // The trap is no longer a hand-kept list (that list skipped the citation
    // once, and never knew about the lose-a-year chips in the extra slot or the
    // formation segments): it queries the card, then the scrubber, live.
    const trap = src.slice(src.indexOf("function focusables()"));
    const body = trap.slice(0, trap.indexOf("\n  }"));
    const cardAt = body.indexOf("card.querySelectorAll");
    const scrubberAt = body.indexOf("scrubber.querySelectorAll");
    expect(cardAt, "the trap reads the card's live DOM").toBeGreaterThan(-1);
    expect(scrubberAt, "then the scrubber's").toBeGreaterThan(cardAt);
    expect(body).toContain("filter(isTabbable)");
    expect(body, "no hand-listed controls").not.toContain("backBtn");
  });

  it("wraps in both directions through the citation", async () => {
    const { trapTarget } = await import("../src/ui/storycard");
    // The trap array, as focusables() reads it for a cited scene with
    // auto-advance on and 5 scenes.
    const dots = ["dot0", "dot1", "dot2", "dot3", "dot4"];
    const order = ["citeLink", "back", "next", "exit", "pause", ...dots];
    // Tab from the last element wraps to the first — which is the citation.
    expect(trapTarget(order, "dot4", false, true)).toBe("citeLink");
    // Shift+Tab from the first wraps to the last.
    expect(trapTarget(order, "citeLink", true, true)).toBe("dot4");
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

  it("a query that matches nothing says so, once, quietly", () => {
    // The copy is the designer's, verbatim — drift fails here.
    expect(search).toContain('label.textContent = "No matches. Try a code like 4.NF.B.3.";');
    // Presentational, so it is not a listbox option…
    const row = search.slice(search.indexOf("function emptyRow()"));
    const body = row.slice(0, row.indexOf("\n  }"));
    expect(body).toContain('li.setAttribute("role", "presentation")');
    expect(body).toContain('label.setAttribute("role", "status")');
    expect(body, "the row is not selectable").not.toContain("pointerdown");
    // …and the keyboard never lands on it: totalOptions() counts results plus the
    // hidden-by-filters row only, so ↑/↓, Enter and aria-activedescendant skip it.
    expect(search).toContain(
      "const totalOptions = (): number => results.length + (hiddenCount > 0 ? 1 : 0);",
    );
    // It shows only for a real query the index actually ran (never mid-fetch),
    // and only after the index-failure branch has had its say.
    const render = search.slice(search.indexOf("function renderResults()"));
    const emptyAt = render.indexOf("if (!totalOptions() && index && lastQuery)");
    expect(emptyAt).toBeGreaterThan(-1);
    expect(render.indexOf("indexFailed && lastQuery")).toBeLessThan(emptyAt);
    // A blur/refocus on the same dead query brings the row back.
    expect(search).toContain("(totalOptions() || indexFailed || index)");
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
