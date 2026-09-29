// Camera COMPOSITION: the single primitive that decides where framed content
// lands on screen, and the live-chrome model it composes against.
//
// What it replaces: four independent screen-space nudges (a persistent frame
// shift right for the story card, a persistent lift for phones, a bottom-inset
// lift for the filter rail, a per-flight panel offset left) that were added
// AFTER each fit with no check that the result stayed on screen. They pushed in
// opposite directions and nothing measured the outcome, so stories drifted right
// and off the bottom while focus clicks clipped off the left edge. One of them
// (the lift) even carried the wrong sign, pushing content DOWN into the chrome
// it was meant to clear — which is what "the model shows up in the bottom half"
// was.
//
// The model here instead:
//   • the USABLE RECT — the viewport minus the live chrome (title band, bottom
//     chrome band, an open side panel) — is where composition happens;
//   • the SUBJECT box must land fully inside it with a margin;
//   • the CONTEXT box (the wider lit set) is what gets CENTRED when it does not
//     fit, so the visual weight sits in the middle even as it bleeds past the
//     edges;
//   • an occluder that leaves a clear region beside it (the bottom-left story
//     card) earns a modest BIAS away from it, never an evacuation — pushing the
//     subject entirely clear of the card is what emptied the other half of the
//     frame.
//
// The solve is exact: it projects the boxes' eight corners through the real
// perspective model at the fit's END pose, so it composes with an in-flight
// transition rather than fighting it. Pure and unit-tested (tests/frame.test.ts).

import * as THREE from "three";

/** A rectangle in CSS px; y grows DOWN from the top-left of the viewport. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What the live chrome occupies, in CSS px. Measured from the DOM (see
 * measureChrome) rather than hard-coded, so a CSS change can never leave the
 * camera composing against a stale number — the 400px the focus offset assumed
 * had already drifted to a 480px panel.
 */
export interface ChromeMetrics {
  viewportWidth: number;
  viewportHeight: number;
  /** Bottom edge of the title block (0 when it is absent). */
  titleBottom: number;
  /** Top edge of the fixed BOTTOM chrome; = viewportHeight when there is none. */
  bottomChromeTop: number;
  /** Width of an open RIGHT-SIDE detail panel (0 when closed or a bottom sheet). */
  panelWidth: number;
  /** Width of the bottom-LEFT story card (0 when absent or full-width). */
  cardWidth: number;
}

// The title block is ~260px tall but spans only the left half, so reserving all
// of it would push every framing down for nothing. Reserve a modest strip: the
// block's own bottom, capped at this fraction of the viewport (100px at 907px
// tall — the number the home framing already used).
const TITLE_BAND_FRAC = 0.11;
const TITLE_BAND_MIN = 56;
const TITLE_BAND_MAX = 140;
/**
 * The chrome may never eat more than this much of the frame. These two caps are
 * what keep the rect from collapsing into a sliver no matter what the DOM says
 * (a mis-measured bottom band, a panel that went full-bleed): the rect is always
 * at least 25% of the width and 54% of the height.
 *
 * The panel cap is a sanity bound ONLY — a real side panel never reaches it. The
 * panel is a fixed 480px from 721px up, so it takes at most 67% of the width, and
 * it must be reserved in full: at 45% (the old cap) every window from 721 to
 * 1066px wide composed the focused standard behind the panel.
 */
const MAX_BOTTOM_FRAC = 0.35;
const MAX_PANEL_FRAC = 0.75;

/** The on-screen rectangle a framing targets. Pure over measured chrome. */
export function computeUsableRect(m: ChromeMetrics): Rect {
  const W = Math.max(1, m.viewportWidth);
  const H = Math.max(1, m.viewportHeight);
  const top =
    m.titleBottom > 0
      ? Math.min(Math.max(Math.min(m.titleBottom, H * TITLE_BAND_FRAC), TITLE_BAND_MIN), TITLE_BAND_MAX)
      : 0;
  const bottom = Math.min(Math.max(0, H - m.bottomChromeTop), H * MAX_BOTTOM_FRAC);
  const right = Math.min(Math.max(0, m.panelWidth), W * MAX_PANEL_FRAC);
  return { x: 0, y: top, width: W - right, height: H - top - bottom };
}

/**
 * The composition bias, in CSS px (+x rides the subject RIGHT). The story card
 * is translucent glass over a dark scene sitting bottom-LEFT: bias the subject
 * a little clear of it so the card overlaps only its lower-left corner. A
 * quarter of the card's width, capped — an evacuation (half the viewport) is
 * what emptied the top-left.
 */
const CARD_BIAS_FRAC = 0.25;
const CARD_BIAS_MAX = 120;
/** ...and never more than this share of the viewport, so the same nudge does not
 *  read as a shove on a narrower window. */
const CARD_BIAS_MAX_FRAC = 0.06;
export function compositionBias(m: ChromeMetrics): { x: number; y: number } {
  if (m.cardWidth <= 0) return { x: 0, y: 0 };
  return {
    x: Math.min(m.cardWidth * CARD_BIAS_FRAC, CARD_BIAS_MAX, m.viewportWidth * CARD_BIAS_MAX_FRAC),
    y: 0,
  };
}

/** Read the live chrome. The only DOM-touching function in this module. */
export function measureChrome(): ChromeMetrics {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const rectOf = (selector: string): DOMRect | null => {
    const el = document.querySelector(selector);
    if (!(el instanceof HTMLElement) || el.hidden) return null;
    const style = window.getComputedStyle(el);
    // opacity:0 chrome (the filter rail during a story) occupies no frame.
    if (style.display === "none" || style.visibility === "hidden") return null;
    if (Number.parseFloat(style.opacity || "1") < 0.05) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  };

  const title = rectOf(".title-block");
  let bottomChromeTop = H;
  for (const sel of [".filters-rail", ".view-toggle", ".story-scrubber"]) {
    const r = rectOf(sel);
    if (!r || r.bottom < H * 0.5) continue; // not bottom chrome
    bottomChromeTop = Math.min(bottomChromeTop, r.top);
  }
  // The story card: bottom-LEFT on desktop (a bias), full-width at the bottom on
  // a phone (bottom chrome, which is what lifts the model above it there).
  let cardWidth = 0;
  const card = rectOf(".story-card");
  if (card) {
    if (card.width > W * 0.7) bottomChromeTop = Math.min(bottomChromeTop, card.top);
    else cardWidth = card.width;
  }
  // The detail panel is a right-side panel on desktop and a bottom sheet below
  // 720px; a sheet covers the map outright, so it reserves nothing. Keyed on the
  // OPEN CLASS, not the rect: the panel slides in over 280ms and is measured the
  // instant it is asked to open, so its transform would otherwise read as closed.
  // For the same reason it is read from its LAYOUT box (offsetLeft/offsetWidth
  // ignore transforms). The two shapes differ by where they start: a side panel
  // leaves the map to its left, the sheet spans the width from x = 0. A side
  // panel is reserved whatever share of the width it takes (the old 60%-of-width
  // gate dropped the 480px panel on every window under 800px).
  let panelWidth = 0;
  const panelEl = document.querySelector(".panel");
  if (panelEl instanceof HTMLElement && !panelEl.hidden && panelEl.classList.contains("panel-open")) {
    const left = panelEl.offsetLeft;
    if (panelEl.offsetWidth > 0 && left > 0 && left < W) panelWidth = W - left;
  }

  return {
    viewportWidth: W,
    viewportHeight: H,
    titleBottom: title ? title.bottom : 0,
    bottomChromeTop,
    panelWidth,
    cardWidth,
  };
}

// --- the solve --------------------------------------------------------------

export interface FrameSolveInput {
  /** Vertical field of view, DEGREES. */
  fovDeg: number;
  viewportWidth: number;
  viewportHeight: number;
  rect: Rect;
  /** Screen-space bias of the composition centre, CSS px (+x right, +y down). */
  bias?: { x: number; y: number };
  /** The fit's END pose: the orbit position and the target it looks at. */
  eye: THREE.Vector3;
  target: THREE.Vector3;
  /** MUST land fully inside the rect (with margin). */
  subject: THREE.Box3;
  /** The wider lit set: centred when it fits inside the frame, else its weight. */
  context?: THREE.Box3 | null;
  /** Fraction of the rect kept clear on every side. */
  margin?: number;
  /** How far the fit may retreat from the subject fit to admit the context. */
  maxPullback?: number;
  minDistance?: number;
  maxDistance?: number;
}

export interface FrameSolution {
  /** Distance from the target (controls.dollyTo). */
  distance: number;
  /** controls.setFocalOffset x / y. */
  offsetX: number;
  offsetY: number;
  /** The subject's projected rect at the solution, CSS px [x0, y0, x1, y1]. */
  subjectRect: [number, number, number, number];
  /** The context's projected rect, when one was supplied. */
  contextRect: [number, number, number, number] | null;
}

const DEFAULT_MARGIN = 0.045;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _min = new THREE.Vector3();
const _ctxBox = new THREE.Box3();
const _max = new THREE.Vector3();

/** Camera-space (right, up, forward) coordinates of a box's 8 corners. */
function cornersInView(box: THREE.Box3, pivot: THREE.Vector3): Float64Array {
  const out = new Float64Array(24);
  _min.copy(box.min);
  _max.copy(box.max);
  let n = 0;
  for (const x of [_min.x, _max.x])
    for (const y of [_min.y, _max.y])
      for (const z of [_min.z, _max.z]) {
        const dx = x - pivot.x;
        const dy = y - pivot.y;
        const dz = z - pivot.z;
        out[n++] = dx * _right.x + dy * _right.y + dz * _right.z;
        out[n++] = dx * _up.x + dy * _up.y + dz * _up.z;
        out[n++] = dx * _fwd.x + dy * _fwd.y + dz * _fwd.z;
      }
  return out;
}

interface Projected {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  ok: boolean;
}

/**
 * Project the corners with the camera at (offsetX, −offsetY) laterally and
 * `distance` back along the view axis — exactly the pose camera-controls builds
 * (position = target − forward·d + right·x − up·y, rotation unchanged).
 */
function projectCorners(
  c: Float64Array,
  distance: number,
  ox: number,
  oy: number,
  k: number,
  W: number,
  H: number,
): Projected {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity,
    ok = true;
  for (let i = 0; i < 24; i += 3) {
    const vf = c[i + 2] + distance;
    if (vf <= 1e-4) {
      ok = false; // at or behind the camera: this distance cannot frame the box
      continue;
    }
    const sx = W / 2 + (k * (c[i] - ox)) / vf;
    const sy = H / 2 - (k * (c[i + 1] + oy)) / vf;
    if (sx < x0) x0 = sx;
    if (sx > x1) x1 = sx;
    if (sy < y0) y0 = sy;
    if (sy > y1) y1 = sy;
  }
  return { x0, y0, x1, y1, ok };
}

/** The smallest distance at which the box projects inside availW × availH px. */
function distanceToFit(c: Float64Array, availW: number, availH: number, k: number): number {
  let depth = 0;
  let halfR = 0;
  let halfU = 0;
  for (let i = 0; i < 24; i += 3) {
    halfR = Math.max(halfR, Math.abs(c[i]));
    halfU = Math.max(halfU, Math.abs(c[i + 1]));
    depth = Math.max(depth, Math.abs(c[i + 2]));
  }
  const fits = (d: number): boolean => {
    const p = projectCorners(c, d, 0, 0, k, 0, 0);
    return p.ok && p.x1 - p.x0 <= availW && p.y1 - p.y0 <= availH;
  };
  // Analytic first guess (flat-plane approximation), then grow until it fits.
  let hi = Math.max((2 * k * halfR) / Math.max(availW, 1), (2 * k * halfU) / Math.max(availH, 1)) + depth + 1;
  for (let i = 0; i < 40 && !fits(hi); i++) hi *= 1.6;
  // The projected size shrinks monotonically with distance, so bisect.
  let lo = 0;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Pixels per (world unit / depth unit) for a vertical FOV: both screen axes share it. */
function pxPerUnit(fovDeg: number, viewportHeight: number): number {
  return Math.max(1, viewportHeight) / 2 / Math.tan((fovDeg * Math.PI) / 360);
}

interface View {
  W: number;
  H: number;
  k: number;
  subject: Float64Array;
  context: Float64Array | null;
}

/** Aim the scratch basis down the eye → target view and put the boxes in it. */
function viewOf(input: FrameSolveInput): View {
  _fwd.copy(input.target).sub(input.eye);
  if (_fwd.lengthSq() < 1e-12) _fwd.set(0, 0, -1);
  _fwd.normalize();
  _right.copy(_fwd).cross(WORLD_UP);
  if (_right.lengthSq() < 1e-12) _right.set(1, 0, 0); // looking straight up/down
  _right.normalize();
  _up.copy(_right).cross(_fwd).normalize();

  const pivot = input.target;
  // The context is composed as the WHOLE VISIBLE MASS: the lit set UNION the
  // subject. A scene whose camera leads half a step ahead of its lit frontier
  // (the story grammar) has a subject sticking out of its lit set; centring the
  // lit set alone would then shove the subject to an edge and the containment
  // clamp would drag everything back off-centre anyway. Centring the union puts
  // the compromise where it belongs — in the middle.
  return {
    W: Math.max(1, input.viewportWidth),
    H: Math.max(1, input.viewportHeight),
    k: pxPerUnit(input.fovDeg, input.viewportHeight),
    subject: cornersInView(input.subject, pivot),
    context:
      input.context && !input.context.isEmpty()
        ? cornersInView(_ctxBox.copy(input.context).union(input.subject), pivot)
        : null,
  };
}

/**
 * Solve the framing: a distance that fits the subject inside the usable rect
 * (retreating up to `maxPullback` to take the context in with it), and the focal
 * offset that lands the composition where it belongs — the context's weight on
 * the rect's centre (plus any bias), clamped so the subject never leaves the
 * rect. Pure: no THREE side effects beyond the scratch vectors.
 */
export function solveFrame(input: FrameSolveInput): FrameSolution {
  const rect = input.rect;
  const margin = input.margin ?? DEFAULT_MARGIN;
  const bias = input.bias ?? { x: 0, y: 0 };
  const { W, H, k, subject, context } = viewOf(input);

  const availW = rect.width * (1 - 2 * margin);
  const availH = rect.height * (1 - 2 * margin);
  let distance = distanceToFit(subject, availW, availH, k);
  if (context) {
    // The furthest the fit may go for the context's sake.
    const limit = distance * Math.max(1, input.maxPullback ?? 1);
    const dContext = distanceToFit(context, availW, availH, k);
    distance = Math.max(distance, Math.min(dContext, limit));
  }
  if (input.minDistance !== undefined) distance = Math.max(distance, input.minDistance);
  if (input.maxDistance !== undefined) distance = Math.min(distance, input.maxDistance);

  // Where the composition's weight belongs on screen.
  const wantX = rect.x + rect.width / 2 + bias.x;
  const wantY = rect.y + rect.height / 2 + bias.y;
  const guide = context ?? subject;
  const perPx = distance / k; // world units per CSS px at the target plane

  let ox = 0;
  let oy = 0;
  // 1) Centre the guide (the lit context, or the subject when there is none).
  for (let i = 0; i < 4; i++) {
    const p = projectCorners(guide, distance, ox, oy, k, W, H);
    if (!p.ok) break;
    ox -= (wantX - (p.x0 + p.x1) / 2) * perPx;
    oy -= (wantY - (p.y0 + p.y1) / 2) * perPx;
  }
  // 2) Clamp back inside the rect. The SUBJECT must always fit (the distance
  //    above guarantees it can), and when the whole CONTEXT fits too, it is the
  //    thing clamped — the subject is inside it, and it means a bias can never
  //    push framed content off the edge to get clear of an occluder.
  const L = rect.x + rect.width * margin;
  const R = rect.x + rect.width * (1 - margin);
  const T = rect.y + rect.height * margin;
  const B = rect.y + rect.height * (1 - margin);
  let held = subject;
  if (context) {
    const cp0 = projectCorners(context, distance, ox, oy, k, W, H);
    if (cp0.ok && cp0.x1 - cp0.x0 <= availW && cp0.y1 - cp0.y0 <= availH) held = context;
  }
  let sp = projectCorners(held, distance, ox, oy, k, W, H);
  for (let i = 0; i < 3; i++) {
    if (!sp.ok) break;
    const dx = Math.max(0, L - sp.x0) + Math.min(0, R - sp.x1);
    const dy = Math.max(0, T - sp.y0) + Math.min(0, B - sp.y1);
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;
    ox -= dx * perPx;
    oy -= dy * perPx;
    sp = projectCorners(held, distance, ox, oy, k, W, H);
  }
  sp = projectCorners(subject, distance, ox, oy, k, W, H);
  const cp = context ? projectCorners(context, distance, ox, oy, k, W, H) : null;
  return {
    distance,
    offsetX: ox,
    offsetY: oy,
    subjectRect: [sp.x0, sp.y0, sp.x1, sp.y1],
    contextRect: cp ? [cp.x0, cp.y0, cp.x1, cp.y1] : null,
  };
}

// --- the re-solve -------------------------------------------------------------
//
// A framing on screen stays the reader's after a fit. Between a fit and a
// resize the reader may have wheel-zoomed (which also slides the target toward
// the cursor), panned, or let the idle drift turn the view. Re-solving the fit
// from scratch at every resize, tab return and pixel-ratio step threw all of
// that away (a wheel zoom at 197 came back at 917 on every tab switch) and cut
// any flight in progress to its end.
//
// So a re-solve answers only to what the chrome change asks for:
//   • DISTANCE scales by exactly as much as the fit changes between the old
//     chrome and the new. A reader at the framed distance lands on the new fit
//     (the subject still fits the new rect); a reader zoomed to a quarter of it
//     stays at a quarter of the new one. An unchanged rect scales by 1.
//   • OFFSET moves by exactly as much as the composition moves, evaluated at
//     the reader's own distance: the world point under the old rect's centre
//     lands under the new rect's centre. The reader's own pan rides on top.
// A framing the reader never touched therefore re-solves to exactly what a fresh
// fit against the new chrome would give, and unchanged chrome is a no-op.

export interface RecomposeInput
  extends Omit<FrameSolveInput, "viewportWidth" | "viewportHeight" | "rect" | "bias"> {
  /** The chrome the framing was last composed against. */
  before: ChromeMetrics;
  /** The chrome now. */
  after: ChromeMetrics;
  /** The reader's view now: the END values, so a flight re-targets rather than cuts. */
  distance: number;
  offsetX: number;
  offsetY: number;
}

/** Same chrome to half a pixel: nothing the composition answers to has changed. */
export function sameChrome(a: ChromeMetrics, b: ChromeMetrics): boolean {
  const near = (x: number, y: number): boolean => Math.abs(x - y) < 0.5;
  return (
    near(a.viewportWidth, b.viewportWidth) &&
    near(a.viewportHeight, b.viewportHeight) &&
    near(a.titleBottom, b.titleBottom) &&
    near(a.bottomChromeTop, b.bottomChromeTop) &&
    near(a.panelWidth, b.panelWidth) &&
    near(a.cardWidth, b.cardWidth)
  );
}

/**
 * The composition offset per unit of distance for this chrome: how far the
 * focal offset shifts, per world unit of distance, to carry the screen centre
 * onto the rect's centre (plus bias). The solve's offset at distance D is a
 * pose-dependent constant minus slope × D, so this is what carries the offset
 * to the reader's own distance without re-projecting there (a reader zoomed
 * deep into the cloud has box corners behind the camera, where no projection
 * is defined).
 */
function compositionSlope(m: ChromeMetrics, fovDeg: number): { x: number; y: number } {
  const rect = computeUsableRect(m);
  const bias = compositionBias(m);
  const k = pxPerUnit(fovDeg, m.viewportHeight);
  return {
    x: (rect.x + rect.width / 2 + bias.x - Math.max(1, m.viewportWidth) / 2) / k,
    y: (rect.y + rect.height / 2 + bias.y - Math.max(1, m.viewportHeight) / 2) / k,
  };
}

/**
 * Re-solve the framing on screen against changed chrome, keeping what the
 * reader did to it (see the block comment above). Pure.
 */
export function solveRecompose(input: RecomposeInput): FrameSolution {
  const { before, after, distance, offsetX, offsetY, ...frame } = input;
  const against = (m: ChromeMetrics): FrameSolveInput => ({
    ...frame,
    viewportWidth: m.viewportWidth,
    viewportHeight: m.viewportHeight,
    rect: computeUsableRect(m),
    bias: compositionBias(m),
  });
  const now = against(after);
  const at = (d: number, ox: number, oy: number): FrameSolution => {
    const v = viewOf(now);
    const sp = projectCorners(v.subject, d, ox, oy, v.k, v.W, v.H);
    const cp = v.context ? projectCorners(v.context, d, ox, oy, v.k, v.W, v.H) : null;
    return {
      distance: d,
      offsetX: ox,
      offsetY: oy,
      subjectRect: [sp.x0, sp.y0, sp.x1, sp.y1],
      contextRect: cp ? [cp.x0, cp.y0, cp.x1, cp.y1] : null,
    };
  };
  if (sameChrome(before, after)) return at(distance, offsetX, offsetY);

  // The fresh fits against the old chrome and the new, at the reader's pose.
  const fitWas = solveFrame(against(before));
  const fitNow = solveFrame(now);
  let d = distance * (fitNow.distance / Math.max(fitWas.distance, 1e-6));
  if (frame.minDistance !== undefined) d = Math.max(d, frame.minDistance);
  if (frame.maxDistance !== undefined) d = Math.min(d, frame.maxDistance);

  // The composition each fit asks for, carried from the fit's distance to the
  // reader's (old chrome) and to the re-solved one (new chrome). The reader's
  // own deviation from it is kept as it is.
  const was = compositionSlope(before, frame.fovDeg);
  const is = compositionSlope(after, frame.fovDeg);
  const wasX = fitWas.offsetX + was.x * (fitWas.distance - distance);
  const wasY = fitWas.offsetY + was.y * (fitWas.distance - distance);
  const isX = fitNow.offsetX + is.x * (fitNow.distance - d);
  const isY = fitNow.offsetY + is.y * (fitNow.distance - d);
  return at(d, isX + (offsetX - wasX), isY + (offsetY - wasY));
}
