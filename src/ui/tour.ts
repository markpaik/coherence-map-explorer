// Guided tour — the "Show me around" walkthrough. Six stops, each a
// {camera + state} scene plus a glass caption card (bottom-center) with
// Next / Back / Skip. The tour drives the app ONLY through the machine's
// public API (focus/focusByCode/trace/clearFocus) plus the camera rig for the
// wide "hero" framings and the filters/search handles for two showcase stops —
// it never writes emphasis, panel, or hash directly. While it runs, the
// machine is in the "touring" state (drift suspended) and scene input is
// blocked by a transparent backdrop, so only the card is interactive.
//
// Reduced motion: the machine already cuts its own camera + cascade off its
// reduced-motion flag; the tour passes the same flag to the rig's hero moves,
// and the card's fade collapses under prefers-reduced-motion (see style.css).

import type { Machine } from "../state/machine";
import type { CameraRig } from "../scene/camera";
import type { FiltersHandle } from "./filters";
import type { SearchHandle } from "./search";

interface TourDeps {
  machine: Machine;
  rig: CameraRig;
  filters: FiltersHandle;
  search: SearchHandle;
  reducedMotion: () => boolean;
}

interface Stop {
  title: string;
  caption: string;
  enter(): void;
  leave?(): void;
}

export interface TourHandle {
  start(): void;
  readonly running: boolean;
  dispose(): void;
}

export function createTour(deps: TourDeps): TourHandle {
  const { machine, rig, filters, search, reducedMotion } = deps;
  const btn = document.getElementById("tour-btn") as HTMLButtonElement | null;

  const transition = (): boolean => !reducedMotion();

  // --- the six stops (captions are DESIGN copy, verbatim) ----------------
  const stops: Stop[] = [
    {
      title: "One structure",
      caption:
        "Every Common Core math standard from Kindergarten through high school, and every connection between them. 480 standards. 899 links. Drag to spin it.",
      enter() {
        machine.clearFocus();
        rig.frameHome(transition());
      },
    },
    {
      title: "Where fractions begin",
      caption:
        "Grade 3's first fraction standard. Gold lines flow in from what it builds on and out to everything it unlocks.",
      enter() {
        machine.focusByCode("3.NF.A.1");
      },
    },
    {
      title: "The busiest crossroads",
      caption:
        "Proportional relationships. One of the most connected standards in school mathematics, and a Widely Applicable Prerequisite for college and careers.",
      enter() {
        machine.focusByCode("7.RP.A.2");
      },
    },
    {
      title: "A twelve-year build",
      caption:
        "The high-school concept of a function, traced back through every prerequisite to counting in Kindergarten. This is what coherence means.",
      enter() {
        machine.focusByCode("F-IF.A.1");
        machine.trace();
      },
    },
    {
      title: "Four rivers",
      caption:
        "Number, Algebra, Geometry, Data. Toggle any strand or grade to follow one river across thirteen years.",
      enter() {
        machine.clearFocus();
        filters.setStrandsOnly("number");
        rig.frameHome(transition());
      },
      leave() {
        filters.reset(); // restore all filters on leaving this stop
      },
    },
    {
      title: "Find your standard",
      caption:
        "Press / and type a code or a phrase like 'add fractions'. Click anything. Share the URL of any standard straight from the address bar.",
      enter() {
        machine.clearFocus();
        rig.frameHome(transition());
        search.pulse();
      },
    },
  ];

  // --- card DOM (built once) ---------------------------------------------
  const backdrop = document.createElement("div");
  backdrop.className = "tour-backdrop";
  backdrop.hidden = true;

  const card = document.createElement("div");
  card.className = "tour-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "tour-title");
  card.setAttribute("aria-describedby", "tour-caption");
  card.hidden = true;

  const titleEl = document.createElement("h2");
  titleEl.className = "tour-title";
  titleEl.id = "tour-title";

  const captionEl = document.createElement("p");
  captionEl.className = "tour-caption";
  captionEl.id = "tour-caption";

  const dots = document.createElement("div");
  dots.className = "tour-dots";
  dots.setAttribute("aria-hidden", "true");
  const dotEls: HTMLSpanElement[] = stops.map(() => {
    const d = document.createElement("span");
    d.className = "tour-dot";
    dots.appendChild(d);
    return d;
  });

  const controls = document.createElement("div");
  controls.className = "tour-controls";
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "tour-btn-back";
  backBtn.textContent = "Back";
  const skipBtn = document.createElement("button");
  skipBtn.type = "button";
  skipBtn.className = "tour-btn-skip";
  skipBtn.textContent = "Skip tour";
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "tour-btn-next";
  nextBtn.textContent = "Next";

  controls.append(backBtn, skipBtn, nextBtn);
  card.append(titleEl, captionEl, dots, controls);
  document.body.append(backdrop, card);

  // --- state --------------------------------------------------------------
  let running = false;
  let index = 0;
  let returnFocus: HTMLElement | null = null;

  function render(): void {
    const stop = stops[index];
    titleEl.textContent = stop.title;
    captionEl.textContent = stop.caption;
    card.setAttribute("aria-label", `Guided tour, step ${index + 1} of ${stops.length}`);
    dotEls.forEach((d, i) => d.classList.toggle("active", i === index));
    backBtn.disabled = index === 0;
    nextBtn.textContent = index === stops.length - 1 ? "Done" : "Next";
  }

  function goTo(next: number): void {
    if (next < 0 || next >= stops.length) return;
    stops[index].leave?.();
    index = next;
    stops[index].enter();
    render();
  }

  function start(): void {
    if (running) return;
    running = true;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    index = 0;
    machine.setTouring(true);
    document.body.classList.add("touring");
    backdrop.hidden = false;
    card.hidden = false;
    stops[0].enter();
    render();
    // Focus the primary action so keyboard users drive straight away.
    nextBtn.focus();
  }

  function stop(): void {
    if (!running) return;
    running = false;
    // Undo any lingering stop state, then return to a clean idle.
    stops[index].leave?.();
    machine.clearFocus();
    filters.reset();
    rig.frameHome(transition());
    machine.setTouring(false);
    document.body.classList.remove("touring");
    backdrop.hidden = true;
    card.hidden = true;
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
    else btn?.focus();
    returnFocus = null;
  }

  function onNext(): void {
    if (index === stops.length - 1) stop();
    else goTo(index + 1);
  }

  // --- events -------------------------------------------------------------
  nextBtn.addEventListener("click", onNext);
  backBtn.addEventListener("click", () => goTo(index - 1));
  skipBtn.addEventListener("click", stop);
  backdrop.addEventListener("pointerdown", (e) => e.preventDefault()); // click-through-proof

  // Keyboard: arrows navigate, Esc skips, Tab is trapped inside the card.
  const focusables = (): HTMLButtonElement[] =>
    [backBtn, skipBtn, nextBtn].filter((b) => !b.disabled);
  function onKeydown(e: KeyboardEvent): void {
    if (!running) return;
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        onNext();
        break;
      case "ArrowLeft":
        e.preventDefault();
        goTo(index - 1);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation(); // beat the global Esc (panel/focus) while touring
        stop();
        break;
      case "Tab": {
        const f = focusables();
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        const activeEl = document.activeElement;
        if (e.shiftKey && activeEl === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && activeEl === last) {
          e.preventDefault();
          first.focus();
        } else if (!card.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
        break;
      }
    }
  }
  // Capture phase so Esc is handled before the document-level Esc handlers.
  document.addEventListener("keydown", onKeydown, true);

  // --- launch button ------------------------------------------------------
  if (btn) {
    btn.removeAttribute("tabindex");
    btn.setAttribute("aria-label", "Show me around — start the guided tour");
    btn.addEventListener("click", start);
  }

  return {
    start,
    get running() {
      return running;
    },
    dispose() {
      document.removeEventListener("keydown", onKeydown, true);
      backdrop.remove();
      card.remove();
    },
  };
}
