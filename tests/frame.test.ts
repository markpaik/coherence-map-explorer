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
  compositionBias,
  computeUsableRect,
  solveFrame,
  type ChromeMetrics,
  type FrameSolveInput,
} from "../src/scene/frame";

const VIEWPORT = { width: 1728, height: 907 };

const chrome = (over: Partial<ChromeMetrics> = {}): ChromeMetrics => ({
  viewportWidth: VIEWPORT.width,
  viewportHeight: VIEWPORT.height,
  titleBottom: 238,
  bottomChromeTop: VIEWPORT.height - 114,
  panelWidth: 0,
  cardWidth: 0,
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
    expect(r.width).toBeGreaterThanOrEqual(1728 * 0.54);
    expect(r.height).toBeGreaterThanOrEqual(907 * 0.5);
  });

  it("a full-width story card arrives as bottom chrome (the phone lift)", () => {
    // measureChrome folds it into bottomChromeTop; the rect just honours it,
    // clamped so it can never take more than a third of the frame.
    const tall = rectOf({ bottomChromeTop: 907 * 0.5 });
    expect(tall.height).toBeCloseTo(907 - tall.y - 907 * 0.35, 0);
  });
});

describe("the story-card bias", () => {
  it("is a nudge, not an evacuation", () => {
    // Half the viewport (what the old frame shift did with a 420px card) is what
    // emptied the left half of the frame.
    expect(compositionBias(chrome({ cardWidth: 420 })).x).toBeCloseTo(103.7, 1); // 6% of 1728
    expect(compositionBias(chrome({ cardWidth: 900 })).x).toBeCloseTo(103.7, 1); // capped
    // ...and the same card is a smaller nudge on a narrower window.
    expect(compositionBias(chrome({ cardWidth: 420, viewportWidth: 1280 })).x).toBeCloseTo(76.8, 1);
    expect(compositionBias(chrome()).x).toBe(0);
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

  it("biases toward the clear side without pushing the subject out", () => {
    const r = rectOf();
    const plain = solve();
    const biased = solve({ bias: { x: 105, y: 0 } });
    const cxOf = (s: [number, number, number, number]): number => (s[0] + s[2]) / 2;
    // A small subject takes the whole bias; the containment clamp only bites
    // when the subject is large enough to run into the rect edge.
    expect(cxOf(biased.subjectRect) - cxOf(plain.subjectRect)).toBeGreaterThan(0);
    expect(inside(r, biased.subjectRect)).toBe(true);
    const wide = solve({ subject: box(0, 0, 4000, 200), bias: { x: 105, y: 0 } });
    expect(inside(r, wide.subjectRect)).toBe(true);
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
