// The evolving sky — generative reconfiguration of the poses by time of day.
//
// Mark's direction (round 8): the formations should slowly evolve through the
// day, and the same clock time on different days should give a different
// shape. So the Constellation (and, gently, the Ascent) breathes through a
// smooth displacement field: a sum of large spatial harmonics whose PHASES
// are seeded from the calendar date (a new shape vocabulary every day) and
// drift with the time of day (one slow lap per 24 hours), plus a
// barely-perceptible in-session term so a long visit sees the sky move.
//
// Honesty guards:
//   - Ascent HEIGHTS are untouched (y amplitude 0): height is prerequisite
//     depth, a claim, not decoration. Ascent sways only in x (small, inside
//     its bands) and z.
//   - The Blueprint never evolves: it is the structural pose and its
//     stillness is part of its honesty.
//   - Amplitudes stay small against band widths (~70 units), so the K→HS
//     reading order never scrambles; the field is coherent (neighbourhoods
//     move together) rather than per-node jitter.
//
// Determinism: the PIPELINE stays Date-free; this is runtime-only, like the
// planet clock. Under reduced motion sceneTime freezes, so the field is a
// still shape chosen by date + time of day — different visits still differ,
// nothing animates.

import type { GraphCore } from "../data";

export interface EvolveField {
  /**
   * Displace `dst0`/`dst1` (pose 0 / pose 1 target arrays, xyz-flattened) from
   * the immutable bases, for scene time `t` seconds after boot. Also fills
   * `off` (per-node current offset, xyz) so edge controls can ride along.
   */
  apply(t: number, base0: Float32Array, dst0: Float32Array, base1: Float32Array, dst1: Float32Array, off0: Float32Array, off1: Float32Array): void;
}

// Three large swells + one medium ripple. dirY/dirZ couple the axes so the
// field bends organically instead of sliding as a sheet. `rate` is full
// phase laps per day.
const HARMONICS = [
  { fx: 0.0071, fy: 0.0113, fz: 0.0089, rate: 1, ax: 3.4, ay: 5.8, az: 7.6 },
  { fx: 0.0127, fy: 0.0079, fz: 0.0143, rate: 2, ax: 2.2, ay: 4.1, az: 5.2 },
  { fx: 0.0046, fy: 0.0161, fz: 0.0061, rate: 3, ax: 1.6, ay: 3.0, az: 4.4 },
  { fx: 0.031, fy: 0.027, fz: 0.036, rate: 5, ax: 0.9, ay: 1.7, az: 2.3 },
];

// Ascent multipliers: no y (depth is sacred), gentle x, most of the life in z.
const ASCENT_X = 0.4;
const ASCENT_Z = 0.65;

// In-session drift on top of the day lap: one extra phase lap per ~70 minutes
// of open tab — slow enough to never catch the eye, fast enough that a long
// session's sky is not a still.
const SESSION_RATE = (Math.PI * 2) / 4200;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// `visitSeed` folds the per-visit randomness into the day's phase vocabulary:
// the field still laps once per day, but every visit occupies its own point
// in phase space — one of an infinite number of skies (Mark, round 9).
export function createEvolveField(graph: GraphCore, visitSeed = 0): EvolveField {
  const n = graph.nodes.length;

  // Day seed: the calendar date picks today's phase vocabulary, and the boot
  // clock time positions us inside the day's lap — so 9am today and 9am
  // tomorrow are different shapes (different phases), while within one day
  // the shape drifts continuously as the hours pass.
  const now = new Date();
  const dayKey =
    now.getFullYear() * 416 + (now.getMonth() + 1) * 32 + now.getDate();
  const rng = mulberry32(((dayKey * 2654435761) ^ visitSeed) >>> 0);
  const phases = HARMONICS.map(() => ({
    px: rng() * Math.PI * 2,
    py: rng() * Math.PI * 2,
    pz: rng() * Math.PI * 2,
  }));
  const bootDayFrac =
    (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86400;

  // Per-node detune: a whisper of individuality inside the coherent field.
  const detune = new Float32Array(n);
  for (let i = 0; i < n; i++) detune[i] = ((i * 2.399963) % (Math.PI * 2)) * 0.12;

  return {
    apply(t, base0, dst0, base1, dst1, off0, off1) {
      const dayT = (bootDayFrac + t / 86400) * Math.PI * 2;
      const sess = t * SESSION_RATE;
      for (let i = 0; i < n; i++) {
        const x = base0[i * 3];
        const y = base0[i * 3 + 1];
        const z = base0[i * 3 + 2];
        let ox = 0;
        let oy = 0;
        let oz = 0;
        for (let k = 0; k < HARMONICS.length; k++) {
          const h = HARMONICS[k];
          const ph = phases[k];
          const drift = dayT * h.rate + sess + detune[i];
          ox += h.ax * Math.sin(y * h.fy + z * h.fz + ph.px + drift);
          oy += h.ay * Math.sin(x * h.fx + z * h.fz + ph.py + drift * 1.13);
          oz += h.az * Math.sin(x * h.fx + y * h.fy + ph.pz + drift * 0.87);
        }
        off0[i * 3] = ox;
        off0[i * 3 + 1] = oy;
        off0[i * 3 + 2] = oz;
        dst0[i * 3] = x + ox;
        dst0[i * 3 + 1] = y + oy;
        dst0[i * 3 + 2] = z + oz;

        off1[i * 3] = ox * ASCENT_X;
        off1[i * 3 + 1] = 0;
        off1[i * 3 + 2] = oz * ASCENT_Z;
        dst1[i * 3] = base1[i * 3] + off1[i * 3];
        dst1[i * 3 + 1] = base1[i * 3 + 1];
        dst1[i * 3 + 2] = base1[i * 3 + 2] + off1[i * 3 + 2];
      }
    },
  };
}
