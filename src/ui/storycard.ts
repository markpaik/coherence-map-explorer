// Story card + timeline scrubber — the reading surface for a playing story.
//
// The card (bottom-left glass, never over the focused region) carries the
// kicker, title, 2–3 sentence body and a small citation line; it is the
// aria-live source for the scene (the canvas is aria-hidden). The scrubber
// (bottom-center) is one dot per scene with the active scene's year label beside
// the active dot. It is a focus-TRAPPED dialog like the tour card: Tab cycles
// inside, ArrowLeft/Right step, Esc exits; scenes advance only via Back / Next /
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
}

export interface StoryCardHandle {
  /** Build the scrubber for a story and show the card. */
  begin(story: Story): void;
  /** Paint one scene (title/body/cite/year + active dot + control labels). */
  render(scene: StoryScene, index: number, total: number): void;
  /** Hide the card + scrubber. */
  end(): void;
  readonly shown: boolean;
  dispose(): void;
}

export function createStoryCard(deps: StoryCardDeps): StoryCardHandle {
  const { announce, onNext, onBack, onExit, onJump } = deps;

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

  card.append(kicker, title, bodyEl, cite, controls);

  // --- scrubber -----------------------------------------------------------
  const scrubber = document.createElement("div");
  scrubber.className = "story-scrubber";
  scrubber.setAttribute("role", "group");
  scrubber.setAttribute("aria-label", "Story timeline");
  scrubber.hidden = true;
  const year = document.createElement("span");
  year.className = "story-year";
  year.setAttribute("aria-hidden", "true");

  let dotEls: HTMLButtonElement[] = [];

  document.body.append(card, scrubber);

  let shown = false;

  function buildDots(count: number): void {
    scrubber.replaceChildren();
    dotEls = [];
    for (let i = 0; i < count; i++) {
      const d = document.createElement("button");
      d.type = "button";
      d.className = "story-dot";
      d.setAttribute("aria-label", `Go to scene ${i + 1} of ${count}`);
      d.addEventListener("click", () => onJump(i));
      scrubber.appendChild(d);
      dotEls.push(d);
    }
  }

  // Everything focusable inside the trap, in tab order.
  function focusables(): HTMLElement[] {
    const els: HTMLElement[] = [backBtn, nextBtn, exitBtn];
    if (!cite.hidden && !citeLink.hidden) els.push(citeLink);
    return els.concat(dotEls);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (!shown) return;
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        onNext();
        break;
      case "ArrowLeft":
        e.preventDefault();
        onBack();
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation(); // beat the global Esc (panel/focus) while storying
        onExit();
        break;
      case "Tab": {
        const f = focusables();
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        } else if (!card.contains(active) && !scrubber.contains(active)) {
          e.preventDefault();
          first.focus();
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

      dotEls.forEach((d, i) => {
        d.classList.toggle("active", i === index);
        d.setAttribute("aria-current", i === index ? "true" : "false");
      });
      // Slot the year label right after the active dot.
      year.textContent = scene.year;
      if (year.parentNode) year.parentNode.removeChild(year);
      const activeDot = dotEls[index];
      if (activeDot && scene.year) activeDot.after(year);

      card.setAttribute("aria-label", `Story, scene ${index + 1} of ${total}`);
      announce(`${scene.card.title}. ${scene.card.body}`);
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
