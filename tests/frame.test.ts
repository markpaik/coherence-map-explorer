// The camera composition primitive (src/scene/frame.ts): the usable rect it
// targets and the solve that lands content in it.
//
// The defect these pin: framing used to be a fit plus a pile of blanket
// screen-space nudges (shift right for the story card, lift for the chrome,
// offset left for the panel) with nothing checking where the content ended up.
// They fought each other, one had the sign inverted, and stories composed into
// the bottom-right corner while focus clicks clipped off the left edge. The
// solve here is checkable, so it is checked: project the solution and assert
// the subject really is inside the rect and the weight really is centred.

import { describe, it, expect } from "vitest";
import { Box3, Vector3 } from "three";
import {
  computeUsableRect,
  sameChrome,
  solveFrame,
  solveRecompose,
  storyGutter,
  storyMastheadBand,
  type ChromeMetrics,
  type FrameSolveInput,
  type Rect,
} from "../src/scene/frame";

const VIEWPORT = { width: 1728, height: 907 };

const chrome = (over: Partial<ChromeMetrics> = {}): ChromeMetrics => ({
  viewportWidth: VIEWPORT.width,
  viewportHeight: VIEWPORT.height,
  titleBottom: 238,
  bottomChromeTop: VIEWPORT.height - 114,
  panelWidth: 0,
  card: null,
  masthead: null,
  ...over,
});

/** A subject/context viewed head-on from +z, the app's usual story orientation. */
const box = (cx: number, cy: number, w: number, h: number, d = 100): Box3 =>
  new Box3(
    new Vector3(cx - w / 2, cy - h / 2, -d / 2),
    new Vector3(cx + w / 2, cy + h / 2, d / 2),
  );

const solve = (over: Partial<FrameSolveInput> = {}): ReturnType<typeof solveFrame> => {
  const subject = over.subject ?? box(0, 0, 400, 200);
  const target = over.target ?? subject.getCenter(new Vector3());
  return solveFrame({
    fovDeg: 50,
    viewportWidth: VIEWPORT.width,
    viewportHeight: VIEWPORT.height,
    rect: computeUsableRect(chrome()),
    eye: new Vector3(target.x, target.y, target.z + 900),
    target,
    subject,
    ...over,
  });
};

const rectOf = (m?: Partial<ChromeMetrics>): ReturnType<typeof computeUsableRect> =>
  computeUsableRect(chrome(m));

describe("the usable rect", () => {
  it("insets the top title band and the bottom chrome band, measured", () => {
    const r = rectOf();
    expect(r.x).toBe(0);
    expect(r.width).toBe(1728);
    expect(r.y).toBeCloseTo(907 * 0.11, 0); // a modest strip, not the whole block
    expect(r.height).toBeCloseTo(907 - r.y - 114, 0);
  });

  it("reserves an OPEN side panel, at its real measured width", () => {
    // The lever this replaces hard-coded 400px; the panel had grown to 480.
    expect(rectOf({ panelWidth: 480 }).width).toBe(1728 - 480);
    expect(rectOf({ panelWidth: 0 }).width).toBe(1728);
  });

  it("never lets chrome eat the frame, however wrong the measurement", () => {
    const r = rectOf({ bottomChromeTop: 40, panelWidth: 1500, titleBottom: 800 });
    expect(r.width).toBeGreaterThanOrEqual(1728 * 0.25);
    expect(r.height).toBeGreaterThanOrEqual(907 * 0.5);
  });

  it("reserves the WHOLE 480px side panel on a narrow window (780px, iPad-portrait band)", () => {
    // The defect: a 45%-of-width cap reserved 351px of a 480px panel at 780px, so
    // the focused standard composed at x≈390, behind a panel that starts at 300.
    for (const W of [721, 768, 780, 820, 900, 1024, 1066]) {
      const r = rectOf({ viewportWidth: W, viewportHeight: 900, bottomChromeTop: 900 - 114, panelWidth: 480 });
      expect(r.width).toBe(W - 480);
    }
  });

  it("a full-width story card arrives as bottom chrome (the phone lift)", () => {
    // measureChrome folds it into bottomChromeTop; the rect just honours it,
    // clamped so it can never take more than a third of the frame.
    const tall = rectOf({ bottomChromeTop: 907 * 0.5 });
    expect(tall.height).toBeCloseTo(907 - tall.y - 907 * 0.35, 0);
  });
});

// Finding 28 and the designer's rules F1 and F3 (2026-09): while a story plays,
// the card, the masthead and the scrubber are KEEP-OUT zones. The card used to
// count only as a 61-120px bias, so at 1024x700 the swiss-cheese card sat over
// two of the four standards it names ("Four lights remain").
describe("the story keep-outs (finding 28)", () => {
  // Measured live at 1024x700 during swiss-cheese scene 5 (l2 census): the card,
  // the title block, and the scrubber's top edge.
  const at1024 = (over: Partial<ChromeMetrics> = {}): ChromeMetrics =>
    chrome({
      viewportWidth: 1024,
      viewportHeight: 700,
      titleBottom: 213,
      bottomChromeTop: 619,
      card: { x: 31, y: 191, width: 420, height: 474 },
      masthead: { x: 31, y: 21, width: 626, height: 192 },
      ...over,
    });

  it("excludes the card's whole COLUMN: the rect starts one gutter past its right edge", () => {
    const m = at1024();
    const r = computeUsableRect(m);
    const g = storyGutter(1024);
    expect(g).toBeCloseTo(30.72, 2); // clamp(16px, 3vw, 32px), as the CSS insets the card
    expect(r.x).toBeCloseTo(31 + 420 + g, 6);
    expect(r.x + r.width).toBe(1024);
    // Whatever the card's height: a short card still owns its column.
    const short = computeUsableRect(at1024({ card: { x: 31, y: 500, width: 420, height: 165 } }));
    expect(short.x).toBeCloseTo(r.x, 6);
    // No point of the card lies inside the rect.
    const c = m.card!;
    expect(c.x + c.width).toBeLessThan(r.x);
  });

  it("puts the rect below the masthead where the masthead reaches into the card's column", () => {
    const r = computeUsableRect(at1024());
    expect(r.y).toBeCloseTo(21 + 192 + storyGutter(1024), 6);
    expect(r.y + r.height).toBe(619); // the scrubber band below
    // A masthead that stops short of the column leaves the title's plain strip.
    const narrow = computeUsableRect(at1024({ masthead: { x: 31, y: 21, width: 300, height: 192 } }));
    expect(narrow.y).toBeCloseTo(Math.max(56, Math.min(213, 700 * 0.11)), 6);
  });

  it("keeps a card on the RIGHT out the same way, from the other side", () => {
    const r = computeUsableRect(at1024({ card: { x: 573, y: 191, width: 420, height: 474 }, masthead: null }));
    expect(r.x).toBe(0);
    expect(r.x + r.width).toBeCloseTo(573 - storyGutter(1024), 6);
  });

  it("changes nothing outside a story: no card, no keep-outs (the explorer's framing)", () => {
    const plain = computeUsableRect(chrome());
    expect(plain.x).toBe(0);
    expect(plain.width).toBe(1728);
    expect(plain.y).toBeCloseTo(907 * 0.11, 6);
    expect(plain.height).toBeCloseTo(907 - 907 * 0.11 - 114, 6);
    expect(computeUsableRect(chrome({ panelWidth: 480 })).width).toBe(1728 - 480);
  });

  it("never lets a mis-measured keep-out collapse the rect", () => {
    const r = computeUsableRect(
      at1024({ card: { x: 0, y: 0, width: 690, height: 700 }, masthead: { x: 0, y: 0, width: 1024, height: 690 } }),
    );
    expect(r.width).toBeGreaterThanOrEqual(1024 * 0.38 - 0.5);
    expect(r.height).toBeGreaterThanOrEqual(700 * (1 - 0.42) - (700 - 619) - 0.5);
  });

  it("a taller card in the same column is the same chrome (no re-solve on a longer scene)", () => {
    expect(sameChrome(at1024(), at1024({ card: { x: 31, y: 400, width: 420, height: 265 } }))).toBe(true);
    expect(sameChrome(at1024(), at1024({ card: null }))).toBe(false);
  });

  // The merged chrome (ui/chromelayout.ts) slides the masthead right of a tall
  // card or hides it, a frame AFTER the camera composes. Read by visibility, a
  // scene after a tall-card scene saw no masthead and framed into the top band:
  // 1024x700 swiss-cheese scene 4 put 11 standards under it, e.g.
  // "7.EE.B.4@567,254:mast" with the masthead at [31, 21, 657, 256].
  it("the masthead band is full width and the same in every masthead state", () => {
    const resting: Rect = { x: 31, y: 21, width: 626, height: 235 };
    const slid: Rect = { ...resting, x: 31 + 444 }; // right of the card
    const band = storyMastheadBand([resting, slid], 1024)!;
    expect(band).toEqual({ x: 0, y: 21, width: 1024, height: 235 });
    // Stays put, slides, or steps aside (hidden, same layout box): one band.
    expect(storyMastheadBand([resting, resting], 1024)).toEqual(band);
    // The rect starts one gutter below it, whatever column the card leaves.
    const r = computeUsableRect(at1024({ masthead: band }));
    expect(r.y).toBeCloseTo(256 + storyGutter(1024), 6);
    const narrow = computeUsableRect(
      at1024({ masthead: storyMastheadBand([{ x: 16, y: 16, width: 300, height: 48 }], 1024) }),
    );
    expect(narrow.y).toBeCloseTo(Math.max(16 + 48 + storyGutter(1024), 700 * 0.11), 6);
    // Nothing laid out, no band.
    expect(storyMastheadBand([{ x: 0, y: 0, width: 0, height: 0 }], 1024)).toBeNull();
  });
});

describe("solveFrame", () => {
  const inside = (
    r: ReturnType<typeof computeUsableRect>,
    s: [number, number, number, number],
    margin = 0.03,
  ): boolean =>
    s[0] >= r.x + r.width * margin - 0.5 &&
    s[2] <= r.x + r.width * (1 - margin) + 0.5 &&
    s[1] >= r.y + r.height * margin - 0.5 &&
    s[3] <= r.y + r.height * (1 - margin) + 0.5;

  it("lands the subject inside the usable rect, centred, filling it", () => {
    const r = rectOf();
    const sol = solve();
    expect(inside(r, sol.subjectRect)).toBe(true);
    const cx = (sol.subjectRect[0] + sol.subjectRect[2]) / 2;
    const cy = (sol.subjectRect[1] + sol.subjectRect[3]) / 2;
    expect(Math.abs(cx - (r.x + r.width / 2)) / r.width).toBeLessThan(0.02);
    expect(Math.abs(cy - (r.y + r.height / 2)) / r.height).toBeLessThan(0.02);
    // The binding axis fills the rect up to the margin.
    const fill = Math.max(
      (sol.subjectRect[2] - sol.subjectRect[0]) / r.width,
      (sol.subjectRect[3] - sol.subjectRect[1]) / r.height,
    );
    expect(fill).toBeGreaterThan(0.85);
    expect(fill).toBeLessThanOrEqual(1);
  });

  it("composes into the rect, NOT the raw viewport (the bottom-half defect)", () => {
    const r = rectOf();
    const sol = solve();
    const cy = (sol.subjectRect[1] + sol.subjectRect[3]) / 2;
    // The rect's centre sits above the viewport's, so composed content must too.
    expect(r.y + r.height / 2).toBeLessThan(VIEWPORT.height / 2);
    expect(cy).toBeLessThan(VIEWPORT.height / 2);
  });

  it("retreats to take the context in — up to the pullback, never past it", () => {
    const subject = box(0, 0, 400, 200);
    const context = box(0, 0, 900, 500);
    const alone = solve({ subject }).distance;
    const withContext = solve({ subject, context, maxPullback: 4 }).distance;
    expect(withContext).toBeGreaterThan(alone * 1.5);
    // Capped: the same context with a tight cap stops at the cap.
    const capped = solve({ subject, context, maxPullback: 1.2 });
    expect(capped.distance).toBeCloseTo(alone * 1.2, 0);
  });

  it("centres the CONTEXT's weight, not the subject's, once it fits", () => {
    const r = rectOf();
    // Subject off to one side of a context that the pullback can take in.
    const subject = box(300, 0, 300, 200);
    const context = box(0, 0, 1200, 500);
    const sol = solve({ subject, context, maxPullback: 4, target: new Vector3(300, 0, 0) });
    const ctxCx = (sol.contextRect![0] + sol.contextRect![2]) / 2;
    const subCx = (sol.subjectRect[0] + sol.subjectRect[2]) / 2;
    expect(Math.abs(ctxCx - (r.x + r.width / 2)) / r.width).toBeLessThan(0.02);
    expect(subCx).toBeGreaterThan(r.x + r.width / 2); // the subject sits off-centre, as it is
    expect(inside(r, sol.subjectRect)).toBe(true);
  });

  it("subject containment WINS when the context is far too big to centre", () => {
    const r = rectOf();
    const subject = box(1200, 0, 200, 200);
    const context = box(0, 0, 4000, 1200);
    const sol = solve({ subject, context, maxPullback: 1.6, target: new Vector3(1200, 0, 0) });
    expect(inside(r, sol.subjectRect)).toBe(true); // G1 holds regardless
    // ...and the frame still leans toward the context rather than ignoring it.
    const plain = solve({ subject, target: new Vector3(1200, 0, 0) });
    const cxOf = (s: [number, number, number, number]): number => (s[0] + s[2]) / 2;
    expect(cxOf(sol.subjectRect)).toBeGreaterThan(cxOf(plain.subjectRect));
  });

  it("keeps the subject on screen when an open panel narrows the rect", () => {
    const r = rectOf({ panelWidth: 480 });
    const sol = solve({ rect: r });
    expect(inside(r, sol.subjectRect)).toBe(true);
    // Everything stays clear of the panel — the old lever pushed content off the
    // LEFT edge instead (a blanket 200px shift with no containment check).
    expect(sol.subjectRect[2]).toBeLessThanOrEqual(r.width);
    expect(sol.subjectRect[0]).toBeGreaterThan(0);
  });

  it("at 780px with the 480px panel open, the one-hop frame lands left of the panel", () => {
    const m = chrome({ viewportWidth: 780, viewportHeight: 900, bottomChromeTop: 900 - 114, panelWidth: 480 });
    const r = computeUsableRect(m);
    // A one-hop neighbourhood: wide and shallow, like 6.RP.A.3's.
    const subject = box(0, 0, 420, 160);
    const sol = solve({ viewportWidth: 780, viewportHeight: 900, rect: r, subject });
    expect(inside(r, sol.subjectRect)).toBe(true);
    expect(sol.subjectRect[2]).toBeLessThanOrEqual(780 - 480); // clear of the panel
    expect(sol.subjectRect[0]).toBeGreaterThan(0);
  });

  it("lands a story subject clear of the card, the masthead and the scrubber", () => {
    // 1440x900 story chrome, measured live: the card, the title block, and the
    // scrubber's top edge.
    const card: Rect = { x: 32, y: 381, width: 420, height: 474 };
    const masthead: Rect = { x: 36, y: 27, width: 626, height: 203 };
    const m = chrome({ viewportWidth: 1440, viewportHeight: 900, titleBottom: 230, bottomChromeTop: 814, card, masthead });
    const r = computeUsableRect(m);
    const clear = (s: [number, number, number, number], k: Rect): boolean =>
      s[2] < k.x || s[0] > k.x + k.width || s[3] < k.y || s[1] > k.y + k.height;
    for (const subject of [box(0, 0, 400, 200), box(0, 0, 4000, 200), box(0, 0, 300, 1200), box(0, 0, 60, 60)]) {
      const sol = solve({ viewportWidth: 1440, viewportHeight: 900, rect: r, subject });
      expect(inside(r, sol.subjectRect)).toBe(true);
      expect(clear(sol.subjectRect, card)).toBe(true);
      expect(clear(sol.subjectRect, masthead)).toBe(true);
      expect(sol.subjectRect[3]).toBeLessThan(814); // above the scrubber
    }
  });

  it("a stage that frames the closure is a PERCEPTIBLE move from one that frames the subject", () => {
    // The two focus stages differ only by what they frame: local takes the
    // one-hop neighbourhood as its subject and lets the closure bleed, journey
    // takes the closure. Composing the closure into the local frame collapses
    // them into the same shot and leaves "Trace the full journey" inert.
    const oneHop = box(0, 0, 260, 180);
    const closure = box(120, 0, 1600, 700);
    const local = solve({ subject: oneHop });
    const journey = solve({ subject: closure, target: closure.getCenter(new Vector3()) });
    expect(journey.distance / local.distance).toBeGreaterThan(2);
  });

  it("honours the dolly clamps", () => {
    const sol = solve({ minDistance: 5000, maxDistance: 6000 });
    expect(sol.distance).toBeGreaterThanOrEqual(5000);
    expect(sol.distance).toBeLessThanOrEqual(6000);
  });

  it("is deterministic — the same input solves to the same frame", () => {
    const a = solve({ context: box(0, 0, 900, 500), maxPullback: 2.6 });
    const b = solve({ context: box(0, 0, 900, 500), maxPullback: 2.6 });
    expect(a).toEqual(b);
  });
});

// The re-solve that runs on a resize, a tab return, a pixel-ratio step and a
// panel close. The defect it pins: every one of those re-solved the fit from
// scratch, so a wheel zoom at 197 came back at 917 on each tab switch and a
// resize mid-dive cut the flight to its end in one frame.
describe("solveRecompose", () => {
  type View = { distance: number; offsetX: number; offsetY: number };
  const at = (W: number, H: number, over: Partial<ChromeMetrics> = {}): ChromeMetrics =>
    chrome({ viewportWidth: W, viewportHeight: H, bottomChromeTop: H - 114, ...over });
  const wide = at(1600, 1000);
  const narrow = at(1400, 900);
  const home = box(0, 0, 1600, 700, 300);
  const origin = new Vector3(0, 0, 0);
  const eyeFor = (t: Vector3): Vector3 => new Vector3(t.x, t.y, t.z + 900);
  const clamps = { minDistance: 60, maxDistance: 6000 };

  const fresh = (m: ChromeMetrics, subject = home, target = origin): ReturnType<typeof solveFrame> =>
    solveFrame({
      fovDeg: 50,
      viewportWidth: m.viewportWidth,
      viewportHeight: m.viewportHeight,
      rect: computeUsableRect(m),
      eye: eyeFor(target),
      target,
      subject,
      ...clamps,
    });
  const re = (
    before: ChromeMetrics,
    after: ChromeMetrics,
    view: View,
    subject = home,
    target = origin,
  ): ReturnType<typeof solveRecompose> =>
    solveRecompose({
      fovDeg: 50,
      before,
      after,
      eye: eyeFor(target),
      target,
      subject,
      ...clamps,
      distance: view.distance,
      offsetX: view.offsetX,
      offsetY: view.offsetY,
    });

  // Head-on (+z) projection with camera-controls' focal-offset convention, the
  // same model the solve uses: x = W/2 + k(dx − ox)/vf, y = H/2 − k(dy + oy)/vf.
  const kOf = (m: ChromeMetrics): number => m.viewportHeight / 2 / Math.tan((50 * Math.PI) / 360);
  const project = (P: Vector3, T: Vector3, v: View, m: ChromeMetrics): [number, number] => {
    const k = kOf(m);
    const vf = -(P.z - T.z) + v.distance;
    return [
      m.viewportWidth / 2 + (k * (P.x - T.x - v.offsetX)) / vf,
      m.viewportHeight / 2 - (k * (P.y - T.y + v.offsetY)) / vf,
    ];
  };
  // The world point on the target plane that shows at screen point s.
  const unproject = (s: [number, number], T: Vector3, v: View, m: ChromeMetrics): Vector3 => {
    const k = kOf(m);
    return new Vector3(
      T.x + v.offsetX + ((s[0] - m.viewportWidth / 2) * v.distance) / k,
      T.y - v.offsetY - ((s[1] - m.viewportHeight / 2) * v.distance) / k,
      T.z,
    );
  };
  const centreOf = (m: ChromeMetrics): [number, number] => {
    const r = computeUsableRect(m);
    return [r.x + r.width / 2, r.y + r.height / 2];
  };

  it("unchanged chrome is a no-op: a tab return or a pixel-ratio step keeps the reader's zoom", () => {
    const fit = fresh(wide);
    const zoomed = { distance: fit.distance * 0.2, offsetX: fit.offsetX + 12, offsetY: fit.offsetY - 7 };
    const r = re(wide, { ...wide }, zoomed);
    expect(r.distance).toBe(zoomed.distance);
    expect(r.offsetX).toBe(zoomed.offsetX);
    expect(r.offsetY).toBe(zoomed.offsetY);
  });

  it("a framing the reader never touched re-solves exactly as a fresh fit would", () => {
    // A resize, and the panel closing on a focus frame.
    const oneHop = box(0, 0, 420, 160);
    const cases: [ChromeMetrics, ChromeMetrics, Box3][] = [
      [wide, narrow, home],
      [narrow, wide, home],
      [at(1600, 1000, { panelWidth: 480 }), wide, oneHop],
      [at(780, 900, { panelWidth: 480 }), at(1024, 768, { panelWidth: 480 }), oneHop],
    ];
    for (const [before, after, subject] of cases) {
      const r = re(before, after, fresh(before, subject), subject);
      const want = fresh(after, subject);
      expect(r.distance).toBeCloseTo(want.distance, 6);
      expect(r.offsetX).toBeCloseTo(want.offsetX, 6);
      expect(r.offsetY).toBeCloseTo(want.offsetY, 6);
    }
  });

  it("a wheel-zoomed reader keeps their zoom across a resize, scaled only as the fit changes", () => {
    // The home fit targets the box centre. The wheel then zooms toward the
    // cursor: the distance drops, the target slides toward the node under it,
    // and the focal offset stays as the fit left it.
    const P = new Vector3(420, 160, 0);
    const T = origin.clone().lerp(P, 0.8);
    const home0 = fresh(wide);
    const view = { distance: home0.distance * 0.2, offsetX: home0.offsetX, offsetY: home0.offsetY };
    const r = re(wide, narrow, view, home, T);
    // The re-solve runs at the reader's pose (the moved target).
    const fit = fresh(wide, home, T);
    const refit = fresh(narrow, home, T);
    // Nowhere near the fresh fit it used to snap back to...
    expect(r.distance).toBeLessThan(refit.distance * 0.3);
    // ...and scaled by exactly the fit's own change.
    expect(r.distance / view.distance).toBeCloseTo(refit.distance / fit.distance, 6);
    // The node the reader zoomed to stays on screen, where they put it relative
    // to the composition (height-normalised, as the vertical FOV scales).
    const rel = (p: [number, number], m: ChromeMetrics): [number, number] => {
      const c = centreOf(m);
      return [(p[0] - c[0]) / m.viewportHeight, (p[1] - c[1]) / m.viewportHeight];
    };
    const a = rel(project(P, T, view, wide), wide);
    const b = rel(project(P, T, r, narrow), narrow);
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThan(0.03);
    const p = project(P, T, r, narrow);
    expect(p[0]).toBeGreaterThan(0);
    expect(p[0]).toBeLessThan(narrow.viewportWidth);
    expect(p[1]).toBeGreaterThan(0);
    expect(p[1]).toBeLessThan(narrow.viewportHeight);
  });

  it("moves a zoomed, panned view only as far as the composition moves (the panel closes)", () => {
    // Flat subject, so the target plane is the whole story and the rule is exact:
    // the world point under the old rect's centre lands under the new rect's.
    const flat = box(0, 0, 900, 400, 0);
    const T = new Vector3(120, -40, 0);
    const withPanel = at(1600, 1000, { panelWidth: 480 });
    const fit = fresh(withPanel, flat, T);
    const view = { distance: fit.distance * 0.35, offsetX: fit.offsetX + 25, offsetY: fit.offsetY + 10 };
    const Q = unproject(centreOf(withPanel), T, view, withPanel);
    const r = re(withPanel, wide, view, flat, T);
    const q = project(Q, T, r, wide);
    expect(Math.abs(q[0] - centreOf(wide)[0])).toBeLessThan(0.5);
    expect(Math.abs(q[1] - centreOf(wide)[1])).toBeLessThan(0.5);
    // The zoom relative to the fit is the reader's, not the fit's.
    expect(r.distance / fresh(wide, flat, T).distance).toBeCloseTo(0.35, 6);
  });

  it("honours the dolly clamps", () => {
    const fit = fresh(wide);
    const r = re(wide, at(600, 1000), { distance: 5900, offsetX: fit.offsetX, offsetY: fit.offsetY });
    expect(r.distance).toBeLessThanOrEqual(6000);
    const s = re(wide, at(2600, 1000), { distance: 61, offsetX: fit.offsetX, offsetY: fit.offsetY });
    expect(s.distance).toBeGreaterThanOrEqual(60);
  });
});
