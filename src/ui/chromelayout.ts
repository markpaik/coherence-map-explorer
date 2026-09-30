// Chrome layout: no two chrome surfaces overlap (design rules R1-R4, R7, R8).
//
// CSS owns where every surface sits by default. What CSS cannot see is how big
// some of them turn out: the filter rail wraps to two or three rows in a narrow
// region, the aside after "Coherence" changes width on every deal, the story
// card grows and shrinks scene by scene, the tour card runs to its caption. So
// one measuring pass reads what CSS produced and resolves the collisions by
// writing a few custom properties on :root (lifts, shifts, a depth-scale span, a
// dropdown height) and a few classes. The pass only ever MOVES things; it never
// sizes a surface that it also measures, so it cannot feed back on itself.
//
// Stacking works bottom-up, the way the chrome is drawn: the filter rail (and
// the phone Browse pill) hold the floor; the view toggle, the nav hints, the
// tour card, and the undocked search rail each rise just far enough to clear
// whatever below them shares their columns. The depth scale takes the column
// that is left between the title block and that stack. Tooltips use the same
// surface list to stay off every one of them.

export interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

/**
 * A phone: a coarse pointer whose SHORT side is 500px or less (R5), portrait or
 * landscape. Browse is the default there, the title block steps aside, and the
 * mouse-only tour and nav hints are gone. main.ts reads this for the Browse
 * default; style.css repeats it verbatim in its @media lists.
 */
export const PHONE_QUERY =
  "(pointer: coarse) and (max-width: 500px), (pointer: coarse) and (max-height: 500px)";

/**
 * The compact chrome layout (Filters pill, full-width search rail): any window
 * 720px wide or less, plus a phone held landscape.
 */
export const COMPACT_QUERY = "(max-width: 720px), (pointer: coarse) and (max-height: 500px)";

/** The detail panel is a bottom sheet at this width (panel.ts owns that switch). */
export const SHEET_QUERY = "(max-width: 720px)";

/** Minimum clearance the docked search rail keeps from the headline (R3). */
export const DOCK_CLEARANCE = 24;

// --- pure geometry (unit-tested) -------------------------------------------

/** Horizontal overlap wider than `slack` px. */
export function hOverlap(a: Box, b: Box, slack = 2): boolean {
  return Math.min(a.r, b.r) - Math.max(a.l, b.l) > slack;
}

/** Overlap wider than `slack` px in BOTH axes (the census test for R1). */
export function overlaps(a: Box, b: Box, slack = 2): boolean {
  return hOverlap(a, b, slack) && Math.min(a.b, b.b) - Math.max(a.t, b.t) > slack;
}

export function union(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  return { l: Math.min(a.l, b.l), t: Math.min(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) };
}

export function shiftBox(b: Box, dx: number, dy: number): Box {
  return { l: b.l + dx, t: b.t + dy, r: b.r + dx, b: b.b + dy };
}

/**
 * The smallest upward lift (px, >= 0) that takes `box`, sitting at its CSS
 * default, clear of every obstacle it shares columns with, keeping `gap` px of
 * air. Obstacles are the surfaces already placed below it in the stack.
 */
export function liftClear(box: Box, obstacles: readonly Box[], gap: number): number {
  let lift = 0;
  for (let round = 0; round <= obstacles.length; round++) {
    let moved = false;
    for (const o of obstacles) {
      if (!hOverlap(box, o)) continue;
      const top = box.t - lift;
      const bottom = box.b - lift;
      if (bottom > o.t - gap && top < o.b + gap) {
        const need = box.b - (o.t - gap);
        if (need > lift) {
          lift = need;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return Math.max(0, Math.ceil(lift));
}

export interface DockInput {
  /** Viewport width. */
  vw: number;
  /** Width of the region left of an open side panel (vw when it is closed). */
  regionR: number;
  /** Right inset of the docked rail inside the region. */
  inset: number;
  /** The rail's one-row width (search bar + ghost buttons). */
  railW: number;
  /** Width of the results dropdown that hangs from the rail's right edge. */
  dropdownW: number;
  /** Ink of the headline plus its aside, or null when the title is hidden. */
  headline: Box | null;
  /** Ink of the whole title block, or null when it is hidden. */
  title: Box | null;
}

/**
 * R3: the docked rail may sit top-right only when its left edge clears the
 * headline and aside by DOCK_CLEARANCE px, and the dropdown it drops clears the
 * rest of the title block the same way. Otherwise it docks under the title.
 */
export function dockTopRight(d: DockInput): boolean {
  if (!d.headline || !d.title) return true;
  const right = d.regionR - d.inset;
  const railL = right - d.railW;
  const ddL = right - d.dropdownW;
  return railL >= d.headline.r + DOCK_CLEARANCE && ddL >= d.title.r + DOCK_CLEARANCE;
}

/** Comfortable and minimum heights for the Ascent depth scale's column. */
export const DEPTH_ROOM = 160;
export const DEPTH_MIN = 120;

/**
 * The span the Ascent depth scale may take in its left-edge column: the tallest
 * stretch of that column no chrome surface occupies (12px of air each side).
 * Where it can, it keeps the shipped max(36vh, 300px) .. 78vh; with less room it
 * starts right under whatever sits above it; under DEPTH_MIN it returns null
 * and the scale hides rather than lie over chrome.
 */
export function depthSpan(col: Box, blocks: readonly Box[], vh: number): { top: number; bottom: number } | null {
  const GAP = 12;
  const taken = blocks
    .filter((o) => hOverlap(col, o))
    .map((o) => [o.t - GAP, o.b + GAP] as const)
    .sort((a, b) => a[0] - b[0]);
  // Free stretches between the taken intervals, within 16px of the edges.
  const free: [number, number][] = [];
  let cursor = 16;
  for (const [t, b] of taken) {
    if (t > cursor) free.push([cursor, t]);
    cursor = Math.max(cursor, b);
  }
  if (vh - 16 > cursor) free.push([cursor, vh - 16]);
  if (!free.length) return null;
  const [segT, segB] = free.reduce((a, s) => (s[1] - s[0] > a[1] - a[0] ? s : a));
  const defTop = Math.max(0.36 * vh, 300);
  const defBottom = vh - 0.22 * vh;
  let bottom = Math.min(segB, defBottom);
  if (bottom - segT < DEPTH_ROOM) bottom = segB;
  let top = Math.max(segT, defTop);
  if (bottom - top < DEPTH_ROOM) top = segT;
  if (bottom - top < DEPTH_MIN) return null;
  return { top, bottom };
}

/**
 * R8 tooltip placement. The four corners around the pointer come first
 * (below-right is the old default): the first that fits the region and covers
 * no chrome surface wins. Failing that, it also tries the spots just beside,
 * above, and below each surface in the way, and takes the chrome-free spot
 * nearest the pointer; only when nothing is free does it settle for the one
 * covering least. Every candidate is clamped into `region` AFTER any flip, so
 * the card can never land off-screen or under the open panel, whatever the
 * width.
 */
export function placeTooltip(
  x: number,
  y: number,
  w: number,
  h: number,
  region: Box,
  obstacles: readonly Box[],
  offset = 14,
): { left: number; top: number } {
  const GAP = 8;
  const clampX = (v: number): number => Math.max(region.l, Math.min(v, region.r - w));
  const clampY = (v: number): number => Math.max(region.t, Math.min(v, region.b - h));
  const corners: [number, number][] = [
    [x + offset, y + offset],
    [x - offset - w, y + offset],
    [x + offset, y - offset - h],
    [x - offset - w, y - offset - h],
  ];
  const beside: [number, number][] = [];
  for (const o of obstacles) {
    for (const l of [x + offset, x - offset - w]) beside.push([l, o.t - GAP - h], [l, o.b + GAP]);
    for (const t of [y + offset, y - offset - h]) beside.push([o.l - GAP - w, t], [o.r + GAP, t]);
  }
  const score = ([l, t]: [number, number]) => {
    const fits = l >= region.l && l + w <= region.r && t >= region.t && t + h <= region.b;
    const left = clampX(l);
    const top = clampY(t);
    const box = { l: left, t: top, r: left + w, b: top + h };
    let cover = 0;
    for (const o of obstacles) {
      const ow = Math.min(box.r, o.r) - Math.max(box.l, o.l);
      const oh = Math.min(box.b, o.b) - Math.max(box.t, o.t);
      if (ow > 0 && oh > 0) cover += ow * oh;
    }
    // Distance from the pointer to the card; a card over the pointer hides
    // the node being read, so it ranks last among the free spots.
    const dx = Math.max(box.l - x, 0, x - box.r);
    const dy = Math.max(box.t - y, 0, y - box.b);
    const onPointer = dx === 0 && dy === 0;
    return { left, top, fits, cover, dist: onPointer ? Infinity : Math.hypot(dx, dy) };
  };
  const first = corners.map(score).find((c) => c.fits && c.cover === 0);
  const all = [...corners, ...beside].map(score);
  const free = all.filter((c) => c.cover === 0);
  const pick =
    first ??
    (free.length
      ? free.reduce((best, c) => (c.dist < best.dist ? c : best))
      : all.reduce((best, c) => (c.cover < best.cover || (c.cover === best.cover && c.dist < best.dist) ? c : best)));
  return { left: Math.max(region.l, pick.left), top: Math.max(region.t, pick.top) };
}

// --- DOM measurement --------------------------------------------------------

const rectBox = (r: DOMRect): Box => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });

/**
 * Where an element will REST once its running position glides end (the rails,
 * the toggle, and the hints glide 280ms beside the opening panel; the docked
 * rail glides 500ms under the title). Reading the mid-glide rect would lay the
 * stack out for a place the surface is only passing through.
 */
function restingBox(el: Element): Box {
  const box = rectBox(el.getBoundingClientRect());
  if (typeof CSSTransition === "undefined" || typeof el.getAnimations !== "function") return box;
  let dx = 0;
  let dy = 0;
  const cs = getComputedStyle(el);
  for (const a of el.getAnimations()) {
    // The story and tour cards rise 14px into place as they appear (story-in,
    // tour-in); both come to rest with no vertical offset.
    if (
      typeof CSSAnimation !== "undefined" &&
      a instanceof CSSAnimation &&
      a.playState === "running" &&
      (a.animationName === "story-in" || a.animationName === "tour-in")
    ) {
      const m = cs.transform && cs.transform !== "none" ? new DOMMatrixReadOnly(cs.transform) : null;
      if (m) dy -= m.m42;
      continue;
    }
    if (!(a instanceof CSSTransition) || a.playState !== "running") continue;
    const prop = a.transitionProperty as "left" | "right" | "top" | "bottom";
    if (prop !== "left" && prop !== "right" && prop !== "top" && prop !== "bottom") continue;
    const frames = (a.effect as KeyframeEffect | null)?.getKeyframes() ?? [];
    const to = parseFloat(String(frames[frames.length - 1]?.[prop] ?? ""));
    const now = parseFloat(cs[prop]);
    if (!Number.isFinite(to) || !Number.isFinite(now)) continue;
    if (prop === "left") dx += to - now;
    else if (prop === "right") dx += now - to;
    else if (prop === "top") dy += to - now;
    else dy += now - to;
  }
  return shiftBox(box, dx, dy);
}

/** Laid out at all (display is not none anywhere up the tree). */
function laidOut(el: Element | null): el is HTMLElement {
  return !!el && el.isConnected && el.getClientRects().length > 0;
}

/** Visible to the reader: laid out, not visibility:hidden, not faded out. */
export function shown(el: Element | null): el is HTMLElement {
  if (!laidOut(el)) return false;
  for (let e: Element | null = el; e && e !== document.documentElement; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.visibility === "hidden" || Number(cs.opacity) < 0.05) return false;
  }
  return true;
}

/** Tight box around what an element actually paints (text lines + drawings). */
export function inkBox(el: Element): Box | null {
  const range = document.createRange();
  range.selectNodeContents(el);
  let box: Box | null = null;
  for (const r of range.getClientRects()) if (r.width > 0.5 && r.height > 0.5) box = union(box, rectBox(r));
  for (const svg of el.querySelectorAll("svg")) {
    const r = svg.getBoundingClientRect();
    if (r.width > 0.5 && r.height > 0.5) box = union(box, rectBox(r));
  }
  return box;
}

/** Ink of the title block's visible lines. */
function titleInk(title: HTMLElement): Box | null {
  let box: Box | null = null;
  for (const child of title.children) {
    if (getComputedStyle(child).display === "none") continue;
    box = union(box, inkBox(child));
  }
  return box;
}

/**
 * Every visible chrome surface (R1), for callers that must keep off all of
 * them: the tooltip and the search dropdown.
 */
export function chromeBoxes(): Box[] {
  const out: Box[] = [];
  const title = document.querySelector<HTMLElement>(".title-block");
  if (shown(title)) {
    for (const child of title.children) {
      if (getComputedStyle(child).display === "none") continue;
      const b = inkBox(child);
      if (b) out.push(b);
    }
  }
  for (const sel of [
    "#search-bar",
    "#search-rail .ghost-btn",
    ".filters-rail",
    ".view-toggle",
    "#nav-hints",
    ".depth-scale-mark",
    ".depth-scale-axis",
    ".panel.panel-open",
    ".story-card",
    ".story-scrubber",
    ".tour-card",
    ".browse-pill",
  ]) {
    for (const el of document.querySelectorAll(sel)) {
      if (!shown(el)) continue;
      const b = el.matches(".depth-scale-mark, .depth-scale-axis, #nav-hints") ? inkBox(el) : rectBox(el.getBoundingClientRect());
      if (b && b.r - b.l > 0.5 && b.b - b.t > 0.5) out.push(b);
    }
  }
  return out;
}

/** The part of the viewport the canvas owns: left of an open side panel. */
export function canvasRegion(): Box {
  // The panel's resting width, not its animated rect: while it slides in, the
  // region it is about to take is already spoken for.
  let r = window.innerWidth;
  const panel = document.querySelector<HTMLElement>(".panel");
  if (panel && !panel.hidden && panel.classList.contains("panel-open") && !window.matchMedia(SHEET_QUERY).matches) {
    r = Math.max(0, window.innerWidth - panel.offsetWidth);
  }
  return { l: 0, t: 0, r, b: window.innerHeight };
}

// --- the pass ---------------------------------------------------------------

const GAP_STACK = 6; // toggle over rail, hints over toggle (the shipped spacing)
const GAP_WIDE = 12; // tour card, search rail

/**
 * Install the layout pass. It runs on resize, on any size change of a chrome
 * surface (ResizeObserver also reports display:none <-> shown), on the class
 * flips that move chrome (panel open, dock, story, tour), and after the CSS
 * glides settle. Returns a disposer.
 */
export function installChromeLayout(): () => void {
  const root = document.documentElement;
  const vars = new Map<string, number>();
  const setVar = (name: string, px: number): void => {
    const v = Math.round(px);
    if (vars.get(name) === v) return;
    vars.set(name, v);
    root.style.setProperty(name, `${v}px`);
  };
  const cur = (name: string): number => vars.get(name) ?? 0;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

  function layoutFilters(regionR: number, compact: boolean): void {
    const rail = q(".filters-rail");
    if (!rail) return;
    if (compact || !laidOut(rail)) {
      rail.classList.remove("filters-wrapped", "filters-rows-3");
      return;
    }
    // One-row width, measured with wrapping switched off (and the wrapped
    // form's row break and dropped separators undone for the measurement).
    rail.classList.remove("filters-wrapped", "filters-rows-3");
    rail.classList.add("filters-probe");
    const oneRow = rail.offsetWidth;
    const groups = [...rail.querySelectorAll<HTMLElement>(".filters-groups > .filter-group")].map((g) => g.offsetWidth);
    rail.classList.remove("filters-probe");
    const avail = regionR - 24;
    const wrapped = oneRow > avail + 0.5;
    rail.classList.toggle("filters-wrapped", wrapped);
    if (!wrapped || groups.length < 2) {
      rail.classList.remove("filters-rows-3");
      root.style.removeProperty("--filters-w");
      vars.delete("--filters-w");
      return;
    }
    // R2: grades on one row, strands and lenses on the next (a third row only
    // when those two cannot share one). The rail hugs its widest row.
    const cs = getComputedStyle(rail);
    const chrome = rail.offsetWidth - rail.clientWidth + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const inner = avail - chrome;
    // Groups after the first carry a 10px separator (9px pad + 1px rule) that
    // the wrapped form drops wherever a group opens a row.
    const SEP = 10;
    const COL_GAP = 9; // .filters-groups column gap
    const [grades, ...rest] = groups;
    const restRow = rest.reduce((s, w) => s + w, 0) - SEP + COL_GAP * (rest.length - 1);
    const threeRows = restRow > inner;
    rail.classList.toggle("filters-rows-3", threeRows);
    const widest = Math.min(inner, Math.max(grades, threeRows ? Math.max(...rest) - SEP : restRow));
    setVar("--filters-w", Math.ceil(widest + chrome));
  }

  function pass(): void {
    const body = document.body;
    if (!body || body.classList.contains("nowebgl") || body.classList.contains("og")) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const compact = window.matchMedia(COMPACT_QUERY).matches;
    const storying = body.classList.contains("storying");
    const touring = body.classList.contains("touring");

    const region = canvasRegion();
    const regionR = region.r;
    layoutFilters(regionR, compact);

    // -- title block ------------------------------------------------------
    const title = q(".title-block");
    const titleLaid = laidOut(title) && getComputedStyle(title!).display !== "none";
    const shiftNow = cur("--title-shift");
    let tInk = titleLaid ? titleInk(title!) : null;
    if (tInk) tInk = shiftBox(tInk, -shiftNow, 0); // ink at the default place
    const headline = title?.querySelector(".headline");
    let hInk = titleLaid && headline ? inkBox(headline) : null;
    if (hInk) hInk = shiftBox(hInk, -shiftNow, 0);
    setVar("--title-b", tInk ? Math.ceil(tInk.b) : 0);

    // -- docked search rail: top-right or under the title (R3) ---------------
    const rail = q("#search-rail");
    const railLaid = laidOut(rail);
    const docked = !!rail && rail.classList.contains("search-docked");
    if (rail) {
      let under = false;
      if (docked && tInk) {
        if (compact) under = true;
        else {
          const barW = Math.min(420, 0.72 * vw);
          let railW = barW;
          for (const b of rail.querySelectorAll<HTMLElement>(".ghost-btn")) if (laidOut(b)) railW += 12 + b.offsetWidth;
          under = !dockTopRight({
            vw,
            regionR,
            inset: 18,
            railW,
            dropdownW: barW,
            headline: hInk,
            title: tInk,
          });
        }
      }
      rail.classList.toggle("search-dock-under", under);
    }

    // -- bottom band ----------------------------------------------------------
    const floor: Box[] = [];
    // `present` is laid out and not deliberately hidden; the story and tour
    // cards count from their first frame, while their fade-in still reads as
    // transparent to shown().
    const present = (el: HTMLElement | null, fadesIn: boolean): el is HTMLElement =>
      fadesIn ? laidOut(el) && getComputedStyle(el!).visibility !== "hidden" : shown(el);
    const placeFixed = (el: HTMLElement | null, fadesIn = false): Box | null => {
      if (!present(el, fadesIn)) return null;
      const b = restingBox(el);
      floor.push(b);
      return b;
    };
    placeFixed(q(".filters-rail"));
    placeFixed(q(".browse-pill"));

    // Story: the card holds its corner; the scrubber slides right of it when
    // centring would collide; the masthead moves right of the card or steps
    // aside when there is no room for it (R7).
    const card = storying ? placeFixed(q(".story-card"), true) : null;
    const scrub = q(".story-scrubber");
    if (storying && card && present(scrub, true)) {
      const r = restingBox(scrub);
      const def = shiftBox(r, -cur("--scrub-shift"), 0);
      let dx = 0;
      if (overlaps(def, card, 0)) {
        const nl = card.r + 16;
        if (nl + (def.r - def.l) <= vw - 12) dx = nl - def.l;
      }
      setVar("--scrub-shift", dx);
      floor.push(shiftBox(def, dx, 0));
    } else {
      setVar("--scrub-shift", 0);
    }
    if (title) {
      let dx = 0;
      let cramped = false;
      if (storying && tInk) {
        if (floor.some((o) => overlaps(tInk!, o, 0))) {
          dx = card ? card.r + 24 - tInk.l : 0;
          const moved = shiftBox(tInk, dx, 0);
          if (!card || moved.r > vw - 12 || floor.some((o) => overlaps(moved, o, 0))) {
            dx = 0;
            cramped = true;
          }
        }
      }
      setVar("--title-shift", dx);
      title.classList.toggle("title-cramped", cramped);
    }

    // Rising stack: each item clears everything placed below it.
    const lifted = (el: HTMLElement, name: string, gap: number, under: readonly Box[]): { lift: number; box: Box } => {
      const def = shiftBox(restingBox(el), 0, cur(name));
      const lift = liftClear(def, under, gap);
      return { lift, box: shiftBox(def, 0, -lift) };
    };
    const stack = (el: HTMLElement | null, name: string, gap: number): Box | null => {
      if (!shown(el)) return null;
      const { lift, box } = lifted(el, name, gap, floor);
      setVar(name, lift);
      floor.push(box);
      return box;
    };
    stack(q(".view-toggle"), "--lift-toggle", GAP_STACK);

    // The nav hints, then the tour card. A short window with the panel open can
    // leave the tour card no room under the title; the hints (mouse gestures the
    // tour's backdrop blocks anyway) then step aside for the tour's duration.
    const hints = q("#nav-hints");
    const tourCramped = body.classList.contains("tour-cramped");
    let hintsBox: Box | null = null;
    if (shown(hints) || (tourCramped && touring && laidOut(hints))) {
      const h = lifted(hints!, "--lift-hints", GAP_STACK, floor);
      setVar("--lift-hints", h.lift);
      hintsBox = h.box;
    }
    const tourCard = q(".tour-card");
    if (touring && present(tourCard, true)) {
      const withHints = hintsBox ? [...floor, hintsBox] : floor;
      let t = lifted(tourCard, "--lift-tour", GAP_WIDE, withHints);
      const clash = !!tInk && hOverlap(t.box, tInk) && t.box.t < tInk.b + GAP_WIDE;
      const cramped = clash && !!hintsBox;
      body.classList.toggle("tour-cramped", cramped);
      if (cramped) t = lifted(tourCard, "--lift-tour", GAP_WIDE, floor);
      else if (hintsBox) floor.push(hintsBox);
      setVar("--lift-tour", t.lift);
      floor.push(t.box);
    } else {
      body.classList.remove("tour-cramped");
      if (hintsBox) floor.push(hintsBox);
      setVar("--lift-tour", 0);
    }

    // The undocked search rail rises above the whole band. During the tour it
    // may find no room under the title (a short window with the panel open);
    // the tour holds the frame, so the rail steps aside rather than overlap.
    let railBox: Box | null = null;
    if (rail && railLaid && !docked && !storying) {
      rail.classList.remove("rail-cramped");
      const r = restingBox(rail);
      const def = shiftBox(r, 0, cur("--lift-rail"));
      const lift = liftClear(def, floor, GAP_WIDE);
      setVar("--lift-rail", lift);
      railBox = shiftBox(def, 0, -lift);
      const underTitle = tInk && hOverlap(railBox, tInk) && railBox.t < tInk.b + GAP_WIDE;
      if (underTitle && touring) {
        rail.classList.add("rail-cramped");
        railBox = null;
      } else floor.push(railBox);
    } else if (rail) {
      rail.classList.remove("rail-cramped");
      if (docked && railLaid && shown(q("#search-bar"))) railBox = restingBox(rail);
    }

    // -- depth scale: the column left between the title and the band ----------
    const depth = q(".depth-scale");
    if (depth && laidOut(depth)) {
      const dr = depth.getBoundingClientRect();
      const col: Box = { l: dr.left, t: 0, r: dr.left + depth.offsetWidth, b: vh };
      const blocks: Box[] = [...floor];
      if (tInk) blocks.push(shiftBox(tInk, cur("--title-shift"), 0));
      if (docked && railBox) blocks.push(railBox);
      const span = depthSpan(col, blocks, vh);
      depth.classList.toggle("depth-scale-cramped", !span);
      if (span) {
        setVar("--depth-top", span.top);
        setVar("--depth-bottom", vh - span.bottom);
      }
    }

    // -- search dropdown: never over the chrome below it ----------------------
    const dd = q("#search-results");
    if (dd && shown(dd) && rail) {
      // The dropdown hangs from the rail, so it lands wherever the rail rests.
      const now = rectBox(rail.getBoundingClientRect());
      const rest = restingBox(rail);
      const d = shiftBox(rectBox(dd.getBoundingClientRect()), rest.l - now.l, rest.t - now.t);
      const top = d.t;
      let limit = vh - 12;
      for (const o of floor) if (hOverlap(d, o) && o.t > top) limit = Math.min(limit, o.t - 8);
      setVar("--dd-max", Math.max(88, limit - top));
    }

    // Everything this pass toggled is its own doing: drop those records so the
    // observers do not schedule another pass for them.
    mo.takeRecords();
    bodyMo.takeRecords();
  }

  // -- scheduling -----------------------------------------------------------
  let raf = 0;
  let settleTimer = 0;
  const schedule = (): void => {
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0;
      pass();
    });
    // The rail docks over 0.5s and the panel glides for 280ms: measure again
    // once they have landed.
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(pass, 650);
  };

  const WATCH = [
    ".title-block",
    ".headline",
    "#search-rail",
    "#search-results",
    ".filters-rail",
    ".view-toggle",
    "#nav-hints",
    ".depth-scale",
    ".panel",
    ".story-card",
    ".story-scrubber",
    ".tour-card",
    ".browse-pill",
  ];
  const watched = new WeakSet<Element>();
  const ro = new ResizeObserver(schedule);
  const mo = new MutationObserver(schedule);
  const attach = (): void => {
    for (const sel of WATCH) {
      const el = document.querySelector(sel);
      if (!el || watched.has(el)) continue;
      watched.add(el);
      ro.observe(el);
      mo.observe(el, { attributes: true, attributeFilter: ["class", "hidden"] });
    }
  };
  const bodyMo = new MutationObserver(() => {
    attach();
    schedule();
  });
  bodyMo.observe(document.body, { childList: true, attributes: true, attributeFilter: ["class"] });
  const onTransitionEnd = (e: Event): void => {
    const t = e.target as Element | null;
    if (t && WATCH.some((s) => t.matches(s))) schedule();
  };
  document.addEventListener("transitionend", onTransitionEnd);
  document.addEventListener("animationend", onTransitionEnd);
  window.addEventListener("resize", schedule);
  void document.fonts?.ready.then(schedule);
  attach();
  schedule();

  return () => {
    ro.disconnect();
    mo.disconnect();
    bodyMo.disconnect();
    document.removeEventListener("transitionend", onTransitionEnd);
    document.removeEventListener("animationend", onTransitionEnd);
    window.removeEventListener("resize", schedule);
    if (raf) cancelAnimationFrame(raf);
    window.clearTimeout(settleTimer);
  };
}
