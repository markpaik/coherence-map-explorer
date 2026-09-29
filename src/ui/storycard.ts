// Story card + timeline scrubber — the reading surface for a playing story.
//
// The card (bottom-left glass, never over the focused region) carries the
// kicker, title, 2–3 sentence body and a small citation line; it is the
// aria-live source for the scene (the canvas is aria-hidden). The scrubber
// (bottom-center) is one dot per scene with the active scene's year label beside
// the active dot. It is a focus-TRAPPED dialog like the tour card: Tab cycles
// inside, ArrowLeft/Right step (except inside a control group on the card, which
// moves focus among its own members), Esc exits; scenes advance only via Back / Next /
// dot-click (no autoplay — holdMs is ignored in v1). The player owns the
// backdrop, the storying machine state, and all scene logic; this module is
// pure presentation + input.

import type { Story, StoryScene } from "../stories/scripts";

export interface StoryCardDeps {
  /** Narrate the active scene (reuses the app's polite live region). */
  announce: (msg: string) => void;
  onNext: () => void;
  onBack: () => void;
  onExit: () => void;
  onJump: (index: number) => void;
  /** Pause / play the story: auto-advance and map motion (owned by the player). */
  onTogglePause: () => void;
}

export interface StoryCardHandle {
  /** Build the scrubber for a story and show the card. */
  begin(story: Story): void;
  /** Paint one scene (title/body/cite/year + active dot + control labels). */
  render(scene: StoryScene, index: number, total: number): void;
  /** Drive the active dot's countdown fill (0..1). No-op when auto-advance off. */
  setProgress(fraction: number): void;
  /** Reflect the paused state on the pause / play control (icon + accessible name). */
  setPaused(paused: boolean): void;
  /** Show/hide the auto-advance affordances (pause control + progress fill). */
  setAutoAdvanceEnabled(on: boolean): void;
  /**
   * Mount an interactive element between the body and the controls (the
   * lose-a-year grade chips). null unmounts. The card owns nothing about it —
   * the caller wires all behavior.
   */
  setExtra(el: HTMLElement | null): void;
  /**
   * The card's on-screen rectangle in CSS px, or null while it is hidden. The
   * interactive story frames its chosen year clear of it.
   */
  bounds(): { x: number; y: number; width: number; height: number } | null;
  /** Hide the card + scrubber. */
  end(): void;
  readonly shown: boolean;
  dispose(): void;
}

/**
 * Where a Tab press should land inside the trap, or null to let the browser
 * move focus itself. `cycle` is the trap's tab order (live DOM order, so the
 * browser's native step between two members already matches it): only the two
 * ends wrap, and focus that has escaped the trap is pulled back to the start.
 * Pure over the list, so it is unit-tested without a DOM.
 */
export function trapTarget<T>(
  cycle: readonly T[],
  active: T | null,
  shift: boolean,
  inside: boolean,
): T | null {
  if (cycle.length === 0) return null;
  const first = cycle[0];
  const last = cycle[cycle.length - 1];
  if (!inside) return first;
  if (shift && active === first) return last;
  if (!shift && active === last) return first;
  return null;
}

/** What arrowsStepScenes needs from the focused element and the card. */
export interface ArrowFocus {
  closest(selector: string): unknown;
}
export interface ArrowCard {
  contains(node: never): boolean;
}

/**
 * Whether ArrowLeft / ArrowRight should step scenes, given where focus is.
 * False while focus sits inside a CONTROL GROUP on the card (role="group": the
 * FORMATION segments, the lose-a-year chips). A segmented control invites the
 * arrow keys, and each group moves focus among its own members with them, so
 * stepping scenes from there would yank the story out from under the reader.
 * On a one-scene story it was worse: Next reads "Done", so an arrow meant for
 * a segment ENDED the story. Everywhere else on the card (Back, Next, the body)
 * and on the scrubber (a group of its own, but not on the card) the arrows
 * step scenes as before. Pure over two tiny interfaces, so it is unit-tested
 * with stand-ins.
 */
export function arrowsStepScenes(active: ArrowFocus | null, card: ArrowCard): boolean {
  if (!active) return true;
  const group = active.closest('[role="group"]');
  return !group || !card.contains(group as never);
}

/**
 * The pause control's accessible name for a paused / playing story. Pause now
 * freezes the whole map as well as the auto-advance (stories/storyclock.ts), so
 * the name states the action on the story, not on the countdown. The name
 * carries the state, so the button is a plain action button with no
 * aria-pressed: "Play the story, toggle button, pressed" would say two opposite
 * things at once. Pure, so it is unit-tested without a DOM.
 */
export function pauseControlLabel(paused: boolean): string {
  return paused ? "Play the story" : "Pause the story";
}

// Everything that can take Tab focus. Filtered below to what is actually live.
const TABBABLE = "button, a[href], input, select, textarea, [tabindex]";

function isTabbable(el: HTMLElement): boolean {
  if (el.tabIndex < 0) return false; // roving groups park their other members at -1
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.closest("[hidden]")) return false; // a hidden cite, a hidden pause control
  return el.getClientRects().length > 0; // display:none by CSS
}

export function createStoryCard(deps: StoryCardDeps): StoryCardHandle {
  const { announce, onNext, onBack, onExit, onJump, onTogglePause } = deps;

  // --- card ---------------------------------------------------------------
  const card = document.createElement("section");
  card.className = "story-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "story-title");
  card.setAttribute("aria-describedby", "story-body");
  card.hidden = true;

  const kicker = document.createElement("p");
  kicker.className = "story-kicker";

  const title = document.createElement("h2");
  title.className = "story-title";
  title.id = "story-title";

  const bodyEl = document.createElement("p");
  bodyEl.className = "story-body";
  bodyEl.id = "story-body";

  const cite = document.createElement("p");
  cite.className = "story-cite";
  const citeText = document.createElement("span");
  citeText.className = "story-cite-text";
  const citeLink = document.createElement("a");
  citeLink.className = "story-cite-link";
  citeLink.target = "_blank";
  citeLink.rel = "noopener";
  citeLink.textContent = "source";
  cite.append(citeText, citeLink);

  const controls = document.createElement("div");
  controls.className = "story-controls";
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "story-btn-back";
  backBtn.textContent = "Back";
  backBtn.addEventListener("click", onBack);
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "story-btn-next";
  nextBtn.textContent = "Next";
  nextBtn.addEventListener("click", onNext);
  const exitBtn = document.createElement("button");
  exitBtn.type = "button";
  exitBtn.className = "story-btn-exit";
  exitBtn.textContent = "Exit";
  exitBtn.addEventListener("click", onExit);
  controls.append(backBtn, nextBtn, exitBtn);

  // Slot for an interactive element (see setExtra) — sits between the body
  // copy and the controls row; empty (and thus collapsed) for normal stories.
  const extraSlot = document.createElement("div");
  extraSlot.className = "story-extra";

  card.append(kicker, title, bodyEl, cite, extraSlot, controls);

  // --- scrubber -----------------------------------------------------------
  const scrubber = document.createElement("div");
  scrubber.className = "story-scrubber";
  scrubber.setAttribute("role", "group");
  scrubber.setAttribute("aria-label", "Story timeline");
  scrubber.hidden = true;
  const year = document.createElement("span");
  year.className = "story-year";
  year.setAttribute("aria-hidden", "true");

  // Pause / play the story: stops the auto-advance AND holds the map still
  // (glass button; keyboard reachable in the trap).
  const pauseBtn = document.createElement("button");
  pauseBtn.type = "button";
  pauseBtn.className = "story-pause";
  pauseBtn.setAttribute("aria-label", pauseControlLabel(false));
  pauseBtn.textContent = "⏸";
  pauseBtn.addEventListener("click", onTogglePause);

  let dotEls: HTMLButtonElement[] = [];
  let dotFills: HTMLSpanElement[] = [];
  let activeIndex = 0;
  let autoAdvance = true;

  document.body.append(card, scrubber);

  let shown = false;

  function buildDots(count: number): void {
    dotEls = [];
    dotFills = [];
    const kids: HTMLElement[] = [pauseBtn];
    for (let i = 0; i < count; i++) {
      const d = document.createElement("button");
      d.type = "button";
      d.className = "story-dot";
      d.setAttribute("aria-label", `Go to scene ${i + 1} of ${count}`);
      d.addEventListener("click", () => onJump(i));
      const fill = document.createElement("span");
      fill.className = "story-dot-fill";
      fill.setAttribute("aria-hidden", "true");
      d.appendChild(fill);
      kids.push(d);
      dotEls.push(d);
      dotFills.push(fill);
    }
    scrubber.replaceChildren(...kids);
  }

  // Everything focusable inside the trap, read from the LIVE DOM in document
  // order — the tab order the browser actually uses. A hand-kept list drifts
  // from the DOM: it once skipped the citation link (which sits above the
  // controls row), and it never knew about the extra slot (the lose-a-year
  // chips, mounted before Back) or the formation segments (appended to the
  // card by formationpick), so Shift+Tab from Back wrapped past the chips and
  // no keyboard user could choose a year. Card first, then the scrubber.
  function focusables(): HTMLElement[] {
    const inCard = [...card.querySelectorAll<HTMLElement>(TABBABLE)];
    const inScrubber = [...scrubber.querySelectorAll<HTMLElement>(TABBABLE)];
    return [...inCard, ...inScrubber].filter(isTabbable);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (!shown) return;
    switch (e.key) {
      case "ArrowRight":
        // A control group on the card owns its arrows (see arrowsStepScenes).
        // Returning WITHOUT preventDefault lets the key reach the group's own
        // roving handler, which runs after this capture-phase listener.
        if (!arrowsStepScenes(document.activeElement, card)) return;
        e.preventDefault();
        onNext();
        break;
      case "ArrowLeft":
        if (!arrowsStepScenes(document.activeElement, card)) return;
        e.preventDefault();
        onBack();
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation(); // beat the global Esc (panel/focus) while storying
        onExit();
        break;
      case "Tab": {
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const inside = !!active && (card.contains(active) || scrubber.contains(active));
        const to = trapTarget(focusables(), active, e.shiftKey, inside);
        if (to) {
          e.preventDefault();
          to.focus();
        }
        break;
      }
    }
  }
  document.addEventListener("keydown", onKeydown, true);

  return {
    get shown() {
      return shown;
    },
    setExtra(el) {
      extraSlot.replaceChildren(...(el ? [el] : []));
    },
    bounds() {
      if (!shown || card.hidden) return null;
      const r = card.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
    },
    begin(story) {
      kicker.textContent = story.kicker;
      buildDots(story.scenes.length);
      card.hidden = false;
      scrubber.hidden = false;
      shown = true;
      // Drive from the keyboard straight away.
      nextBtn.focus();
    },
    render(scene, index, total) {
      title.textContent = scene.card.title;
      bodyEl.textContent = scene.card.body;

      if (scene.card.cite) {
        citeText.textContent = scene.card.cite;
        if (scene.card.citeUrl) {
          citeLink.href = scene.card.citeUrl;
          citeLink.hidden = false;
        } else {
          citeLink.hidden = true;
        }
        cite.hidden = false;
      } else {
        cite.hidden = true;
      }

      // Back inert on the first scene (aria-disabled: stays in the trap).
      backBtn.setAttribute("aria-disabled", String(index === 0));
      backBtn.classList.toggle("story-btn-inert", index === 0);
      nextBtn.textContent = index === total - 1 ? "Done" : "Next";

      activeIndex = index;
      dotEls.forEach((d, i) => {
        d.classList.toggle("active", i === index);
        d.setAttribute("aria-current", i === index ? "true" : "false");
      });
      // Reset every countdown fill; the player drives the active one via setProgress.
      for (const f of dotFills) f.style.transform = "scaleX(0)";
      // Slot the year label right after the active dot.
      year.textContent = scene.year;
      if (year.parentNode) year.parentNode.removeChild(year);
      const activeDot = dotEls[index];
      if (activeDot && scene.year) activeDot.after(year);

      card.setAttribute("aria-label", `Story, scene ${index + 1} of ${total}`);
      announce(`${scene.card.title}. ${scene.card.body}`);
    },
    setProgress(fraction) {
      if (!autoAdvance) return;
      const f = dotFills[activeIndex];
      if (f) f.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction))})`;
    },
    setPaused(paused) {
      pauseBtn.textContent = paused ? "▶" : "⏸";
      pauseBtn.setAttribute("aria-label", pauseControlLabel(paused));
    },
    setAutoAdvanceEnabled(on) {
      autoAdvance = on;
      pauseBtn.hidden = !on;
    },
    end() {
      shown = false;
      card.hidden = true;
      scrubber.hidden = true;
    },
    dispose() {
      document.removeEventListener("keydown", onKeydown, true);
      card.remove();
      scrubber.remove();
    },
  };
}
