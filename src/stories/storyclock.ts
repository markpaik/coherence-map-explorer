// Story Pause holds the map still.
//
// Pause used to stop only the auto-advance countdown. The map kept moving: the
// struggle breath, the flow comets, the beacon ring breathing, the node
// shimmer, and the evolving sky all run on main.ts's scene clock. Mark: when a
// story is paused, the map must hold still, and Resume continues from the same
// phase with no jump.
//
// The rule: the scene clock stops while a story is PAUSED and its scene has
// SETTLED (no transition, damage crossfade, or lit reveal in flight). A scene
// the reader moves to while paused still plays its transition in full (the
// reveal, the ring wave, the crossfade) and then holds still. Stopping the
// clock never rewinds it, so Resume continues from the exact phase.
//
// Beacon rings: a ring staged on the wave appears only once the clock passes
// its appear time. On the frame the pause hold begins, main.ts lands every ring
// still waiting (BeaconsHandle.landStaged). A ring set staged later always
// comes with a transition or a crossfade, which unsettles the scene and
// restarts the clock, so its wave plays as authored.
//
// Scope: stories only. Outside a story the clock runs exactly as before.
// Camera drift is a separate control (CameraRig) and is untouched here.
// Reduced motion stops the clock already (main.ts never advances it). The two
// compose: the clock stops if either one asks.

export interface StoryClockState {
  /** A story is playing. */
  running: boolean;
  /** The reader paused it (StoryPlayerHandle.paused). */
  paused: boolean;
  /** The current scene has settled (StoryPlayerHandle.isSettled()). */
  settled: boolean;
}

/** True while a paused story's settled scene must hold still. Pure. */
export function storyPauseFreezes(s: StoryClockState): boolean {
  return s.running && s.paused && s.settled;
}

export interface SceneClock {
  /** Seconds of scene time so far. It only ever moves forward. */
  readonly time: number;
  /**
   * Advance by `delta` seconds unless `stopped`, and return the time. A stopped
   * frame leaves the time exactly where it was, so the next running frame
   * continues from the same phase.
   */
  advance(delta: number, stopped: boolean): number;
}

export function createSceneClock(start = 0): SceneClock {
  let t = start;
  return {
    get time() {
      return t;
    },
    advance(delta, stopped) {
      if (!stopped && delta > 0) t += delta;
      return t;
    },
  };
}
