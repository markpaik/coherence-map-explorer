// Adaptive pixel-ratio governor — a dormant safety net for weak GPUs.
//
// The full experience renders a full-resolution HalfFloat postprocessing chain
// (RenderPass → bloom mipmap chain → vignette) with 4x composer MSAA. On a
// Retina panel that is a lot of pixels every frame; on capable hardware it costs
// ~3ms and this governor never engages. On a weak integrated GPU the same
// pipeline can miss 60fps, and the honest fix is to render fewer device pixels —
// step the pixel-ratio CAP down from 2.0 toward 1.5 (the composer reallocates
// its buffers smaller), restoring it when the headroom returns.
//
// The one hard rule: an OSCILLATING pixel ratio is itself flicker — worse than a
// steady slightly-soft frame. So the governor is deliberately hysteretic and
// asymmetric: it DEGRADES fast (≈1s of sustained misses, to protect the frame)
// and RESTORES slow (≈4s of sustained headroom, and only one notch at a time),
// with a wide dead-band between the degrade and restore thresholds so a frame
// time hovering near the vsync cap never toggles it. Every decision is a pure
// function of the fed frame deltas — no clock, no renderer — so the trajectory
// is fully deterministic and unit-testable.
//
// It is fed the rAF frame delta, which is vsync-capped: at a healthy locked
// 60fps every delta reads ~16.7ms regardless of GPU load, and only rises above
// the cap when frames are ACTUALLY dropped. That is exactly the signal we want —
// "are we really missing 60fps?" — so the degrade threshold sits above the cap
// (a genuine drop) and the restore threshold just below it (holding the lock).

export interface DprGovernorTuning {
  /** Cap step per change (2.0 → 1.75 → 1.5 at 0.25). */
  step: number;
  /** Rolling average above this (ms) marks a window BAD. Default 22 (~45fps). */
  degradeMs: number;
  /** Rolling average below this (ms) marks a window GOOD. Default 17.5. */
  restoreMs: number;
  /** Frame-time accumulated per evaluation window (ms). Default 500. */
  windowMs: number;
  /** Consecutive BAD windows before a downgrade. Default 2 (~1s). */
  degradeWindows: number;
  /** Consecutive GOOD windows before an upgrade. Default 8 (~4s). */
  restoreWindows: number;
}

export interface DprGovernorParams extends Partial<DprGovernorTuning> {
  /** Starting / ceiling cap (the app clamps devicePixelRatio to this). */
  maxDpr: number;
  /** Floor the cap may drop to under sustained load. */
  minDpr: number;
}

export const DEFAULT_DPR_GOVERNOR: DprGovernorTuning = {
  step: 0.25,
  degradeMs: 22,
  restoreMs: 17.5,
  windowMs: 500,
  degradeWindows: 2,
  restoreWindows: 8,
};

export interface DprGovernor {
  /**
   * Feed one frame delta (ms). Returns the NEW cap when it changes this frame,
   * else null. Callers apply the new cap (re-clamp devicePixelRatio + resize)
   * only on a non-null return, so a resize fires at most once per decision.
   */
  sample(frameMs: number): number | null;
  /** Current cap. */
  current(): number;
}

// A degenerate range (min ≥ max) yields a governor pinned at maxDpr that never
// changes — the natural "adaptation disabled" case, no special-casing needed.
export function createDprGovernor(params: DprGovernorParams): DprGovernor {
  const p = { ...DEFAULT_DPR_GOVERNOR, ...params };
  let dpr = p.maxDpr;
  // Current evaluation window accumulators.
  let winMs = 0;
  let winSum = 0;
  let winCount = 0;
  // Consecutive good / bad window tallies (hysteresis).
  let badRun = 0;
  let goodRun = 0;

  function endWindow(): number | null {
    const avg = winCount > 0 ? winSum / winCount : 0;
    winMs = 0;
    winSum = 0;
    winCount = 0;

    if (avg > p.degradeMs) {
      badRun += 1;
      goodRun = 0;
    } else if (avg < p.restoreMs) {
      goodRun += 1;
      badRun = 0;
    } else {
      // Dead-band (restoreMs..degradeMs): neither. Reset both runs so a stint of
      // borderline frames can never accumulate toward a change.
      badRun = 0;
      goodRun = 0;
    }

    if (badRun >= p.degradeWindows && dpr > p.minDpr) {
      dpr = Math.max(p.minDpr, +(dpr - p.step).toFixed(4));
      badRun = 0;
      goodRun = 0;
      return dpr;
    }
    if (goodRun >= p.restoreWindows && dpr < p.maxDpr) {
      dpr = Math.min(p.maxDpr, +(dpr + p.step).toFixed(4));
      badRun = 0;
      goodRun = 0;
      return dpr;
    }
    return null;
  }

  return {
    sample(frameMs) {
      // Guard against pauses (tab thaw, breakpoint): a giant delta is not a
      // GPU miss. Clamp so one 5s stall can't fabricate a bad window.
      const f = frameMs > 100 ? 100 : frameMs < 0 ? 0 : frameMs;
      winMs += f;
      winSum += f;
      winCount += 1;
      if (winMs >= p.windowMs) return endWindow();
      return null;
    },
    current() {
      return dpr;
    },
  };
}
