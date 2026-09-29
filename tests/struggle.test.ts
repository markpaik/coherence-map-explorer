// The story struggle cue reads the RAW engine damage, never the floored
// display copy, and it is a slow breath, not a flicker.
//
// The bug class this guards: stories floor the display damage (0.35 + 0.65·raw
// on authored scenes, a clamp to 0.35 on lose-a-year) so a lightly-exposed
// standard reads dimmer. The orb shader drove its 4·d·(1−d) flicker from that
// floored value, so every touched standard wavered at 91% or more of peak
// amplitude, and the whole lit set flickered (red-team finding 10). The fix
// gives the shader a second channel (aDamageRaw) that the player writes through
// the same lit mask. The dimming keeps the floored value.
//
// Round 14 (Mark): the cue is one slow sine per node (under 0.3 Hz), capped at
// a 3% swing at raw 0.5, with the shipped time-mean brightness.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import type { GraphCore } from "../src/data";
import {
  createNodes,
  struggleAmplitude,
  struggleBreath,
  struggleFlickMul,
  HUSK_STEADY_AT,
  STRUGGLE_DEPTH,
  STRUGGLE_PERIOD_SEC,
  STRUGGLE_SWING,
} from "../src/scene/nodes";
import { DAMAGE_DISPLAY_FLOOR, displayDamage, expandFamilies, maskByLit } from "../src/stories/contagion";
import { createSelectorResolver } from "../src/stories/selectors";
import { createDamageEngine } from "../src/stories/damage";
import { STORIES } from "../src/stories/scripts";

const HERE = dirname(fileURLToPath(import.meta.url));
const core: GraphCore = JSON.parse(
  readFileSync(resolvePath(HERE, "..", "public/data/graph-core.json"), "utf8"),
);
const N = core.nodes.length;

describe("struggle amplitude (TS mirror of the orb shader)", () => {
  it("a raw 0.02 standard barely trembles, even though it displays at the floor", () => {
    const raw = new Float32Array([0.02]);
    const shown = displayDamage(raw)[0];
    expect(shown).toBeGreaterThan(DAMAGE_DISPLAY_FLOOR);
    expect(struggleAmplitude(raw[0], shown)).toBeLessThan(0.1);
    // The shipped bug: the same standard fed its floored value flickered at 91% of peak.
    expect(struggleAmplitude(shown, shown)).toBeGreaterThan(0.9);
  });

  it("peaks at raw 0.5, vanishes at both ends, and a steady husk never flickers", () => {
    expect(struggleAmplitude(0.5, 0.675)).toBeCloseTo(1, 6);
    expect(struggleAmplitude(0, 0)).toBe(0);
    expect(struggleAmplitude(1, 1)).toBe(0);
    expect(struggleAmplitude(0.93, HUSK_STEADY_AT)).toBe(0);
    expect(struggleAmplitude(0.5, HUSK_STEADY_AT - 1e-3)).toBeCloseTo(1, 6);
  });

  it("lose-a-year's clamp (under 0.35 becomes 0.35) no longer drives the flicker", () => {
    // armYearDamage floors a raw 0.1 to 0.35 for dimming and keeps 0.1 as raw.
    expect(struggleAmplitude(0.1, 0.35)).toBeCloseTo(0.36, 6);
    expect(struggleAmplitude(0.35, 0.35)).toBeCloseTo(0.91, 6);
  });

  // The shipped multiplier (before the raw channel and the breath), fed the
  // display value alone: two fast sines, 0.16 deep. Its time mean is
  // 1 − 0.08 · 4d(1−d), because the two sines are zero-mean.
  const shippedMean = (d: number): number => 1 - (STRUGGLE_DEPTH / 2) * struggleAmplitude(d, d);

  // Time series of the new multiplier over whole breaths, for one node.
  const series = (raw: number, d: number, phase: number, seconds: number, dt = 1 / 120): number[] => {
    const out: number[] = [];
    for (let t = 0; t < seconds; t += dt) out.push(struggleFlickMul(raw, d, struggleBreath(t, phase)));
    return out;
  };
  const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;

  it("caps the swing at 3% peak to peak at raw 0.5, scaled by 4r(1−r)", () => {
    expect(STRUGGLE_SWING).toBeCloseTo(0.03, 6);
    for (const raw of [0.02, 0.1, 0.3, 0.5, 0.7, 0.93]) {
      const d = displayDamage(new Float32Array([raw]))[0];
      const ys = series(raw, d, 1.234, STRUGGLE_PERIOD_SEC * 2);
      const p2p = (Math.max(...ys) - Math.min(...ys)) / mean(ys);
      expect(p2p).toBeCloseTo(STRUGGLE_SWING * struggleAmplitude(raw, d), 3);
      expect(p2p).toBeLessThanOrEqual(STRUGGLE_SWING + 1e-6);
    }
    // A raw 0.02 standard: a swing of 0.24% (it barely moves).
    const light = displayDamage(new Float32Array([0.02]))[0];
    expect(STRUGGLE_SWING * struggleAmplitude(0.02, light)).toBeLessThan(0.003);
  });

  it("is one slow sine below 0.3 Hz, with a per-node phase", () => {
    expect(1 / STRUGGLE_PERIOD_SEC).toBeLessThan(0.3);
    // Exactly periodic at STRUGGLE_PERIOD_SEC, and never faster: a zero
    // crossing count over 10 breaths is 20 (one sine, no second component).
    for (const t of [0, 0.7, 3.3]) {
      expect(struggleBreath(t + STRUGGLE_PERIOD_SEC, 0.4)).toBeCloseTo(struggleBreath(t, 0.4), 9);
    }
    let crossings = 0;
    let prev = struggleBreath(0.001, 0.4);
    for (let t = 0.001; t < STRUGGLE_PERIOD_SEC * 10; t += 0.01) {
      const v = struggleBreath(t, 0.4);
      if ((v < 0) !== (prev < 0)) crossings++;
      prev = v;
    }
    expect(crossings).toBe(20);
    // Different nodes sit at different points of the breath.
    const phases = [0, 1, 2, 3].map((i) => (i * 2.399963) % (Math.PI * 2));
    const now = phases.map((ph) => struggleBreath(1, ph).toFixed(3));
    expect(new Set(now).size).toBe(4);
  });

  it("keeps every node's time-averaged brightness at the shipped value", () => {
    for (const raw of [0.005, 0.02, 0.1, 0.3, 0.5, 0.8, 0.93, 1]) {
      const d = displayDamage(new Float32Array([raw]))[0];
      for (const phase of [0, 2.4, 4.8]) {
        const ys = series(raw, d, phase, STRUGGLE_PERIOD_SEC * 4);
        expect(mean(ys)).toBeCloseTo(shippedMean(d), 4);
      }
    }
    // A steady husk holds exactly still at its mean.
    for (const b of [-1, 0, 1]) expect(struggleFlickMul(1, 1, b)).toBe(1);
  });
});

describe("raw damage channel through the lit mask", () => {
  it("masks both channels by the lit amount, so no ghost shows damage or flicker", () => {
    const display = new Float32Array([0.35, 0.6, 1, 0.5]);
    const raw = new Float32Array([0.0, 0.4, 1, 0.2]);
    const lit = new Float32Array([1, 0, 1, 0.5]);
    const outD = maskByLit(display, lit, new Float32Array(4));
    const outR = maskByLit(raw, lit, new Float32Array(4));
    expect(outD).toEqual(new Float32Array([0.35, 0, 1, 0.25]));
    expect(outR).toEqual(new Float32Array([0, 0, 1, 0.1]));
    for (let i = 0; i < 4; i++) if (lit[i] === 0) expect(outD[i] + outR[i]).toBe(0);
  });
});

describe("nodes handle: the aDamageRaw attribute", () => {
  const radii = new Float32Array(N).fill(2);

  it("setDamage writes display and raw separately, mirrors when raw is omitted, and clears both", () => {
    const nodes = createNodes(core.nodes, radii);
    const display = new Float32Array(N);
    const raw = new Float32Array(N);
    display[3] = 0.363;
    raw[3] = 0.02;
    const v0 = nodes.damageRawAttr.version;
    nodes.setDamage(display, raw);
    expect(nodes.damageAttr.array[3]).toBeCloseTo(0.363, 6);
    expect(nodes.damageRawAttr.array[3]).toBeCloseTo(0.02, 6);
    expect(nodes.damageRawAttr.version).toBeGreaterThan(v0); // flagged for upload

    nodes.setDamage(display); // a caller with one channel: the flicker reads it
    expect(nodes.damageRawAttr.array[3]).toBeCloseTo(0.363, 6);

    nodes.setDamage(null);
    expect(Math.max(...(nodes.damageAttr.array as Float32Array))).toBe(0);
    expect(Math.max(...(nodes.damageRawAttr.array as Float32Array))).toBe(0);
    nodes.dispose();
  });

  it("the orb shader reads aDamageRaw for the struggle term only", () => {
    const nodes = createNodes(core.nodes, radii);
    expect(nodes.mesh.geometry.getAttribute("aDamageRaw")).toBe(nodes.damageRawAttr);
    const material = nodes.mesh.material as unknown as {
      onBeforeCompile: (s: { vertexShader: string; fragmentShader: string; uniforms: object }) => void;
    };
    const shader = {
      vertexShader: "#include <common>\n#include <begin_vertex>",
      fragmentShader: "#include <common>\n#include <color_fragment>",
      uniforms: {},
    };
    material.onBeforeCompile(shader);
    expect(shader.vertexShader).toContain("attribute float aDamageRaw;");
    expect(shader.vertexShader).toContain("vDamageRaw = clamp(aDamageRaw, 0.0, 1.0);");
    expect(shader.fragmentShader).toContain("float r = vDamageRaw;");
    expect(shader.fragmentShader).toContain(
      `float huskCut = 1.0 - step(${HUSK_STEADY_AT.toFixed(4)}, d);`,
    );
    expect(shader.fragmentShader).toContain("float struggle = 4.0 * r * (1.0 - r) * huskCut;");
    const half = (STRUGGLE_DEPTH / 2).toFixed(4);
    const halfSwing = (STRUGGLE_SWING / 2).toFixed(4);
    const omega = ((2 * Math.PI) / STRUGGLE_PERIOD_SEC).toFixed(4);
    expect(shader.fragmentShader).toContain(`float breath = sin(uTime * ${omega} + vPhase * 3.1000);`);
    expect(shader.fragmentShader).toContain(
      `float flickMul = (1.0 - ${half} * struggleDip)\n                         * (1.0 - ${halfSwing} * struggle * breath);`,
    );
    // One slow sine only: the old fast pair (6.7 and 11.3 rad/s) is gone.
    expect(shader.fragmentShader).not.toContain("uTime * 6.7");
    expect(shader.fragmentShader).not.toContain("uTime * 11.3");
    // The dimming, desaturation, and husk mix still read the display value d.
    expect(shader.fragmentShader).toContain("diffuseColor.rgb *= 1.0 - 0.5 * smoothstep(0.03, 0.7, d);");
    expect(shader.fragmentShader).toContain("diffuseColor.rgb = mix(diffuseColor.rgb, husk, d) * flickMul;");
    // The display value keeps only the static mean dip. The old swing-from-d line is gone.
    expect(shader.fragmentShader).toContain("float struggleDip = 4.0 * d * (1.0 - d) * huskCut;");
    expect(shader.fragmentShader).not.toContain("float struggle = 4.0 * d * (1.0 - d)");
    nodes.dispose();
  });
});

describe("real story census (swiss-cheese scene 4)", () => {
  it("the lit, partly-damaged standards flicker gently, not at near-peak", () => {
    const resolve = createSelectorResolver(core);
    const damage = createDamageEngine(core);
    const indexById = new Map<string, number>();
    core.nodes.forEach((n, i) => indexById.set(n.id, i));
    const childIdx = core.nodes.map((n) =>
      (n.children ?? []).map((id) => indexById.get(id)).filter((i): i is number => i !== undefined),
    );
    const scene = STORIES.find((s) => s.id === "swiss-cheese")!.scenes[4];
    expect(scene.state?.damage).toBe(true);
    const missed = new Set<number>();
    for (const sel of scene.state?.missed ?? []) for (const i of resolve(sel)) missed.add(i);
    const missedIdx = expandFamilies(missed, (i) => childIdx[i]);
    const ids = new Set<string>([...missedIdx].map((i) => core.nodes[i].id));
    const raw = damage.compute(ids);
    const lit = new Float32Array(N);
    for (const sel of scene.state?.lit ?? []) for (const i of resolve(sel)) lit[i] = 1;
    const shownD = maskByLit(displayDamage(raw), lit, new Float32Array(N));
    const shownR = maskByLit(raw, lit, new Float32Array(N));

    let n = 0;
    let ampRaw = 0;
    let ampFloored = 0;
    for (let i = 0; i < N; i++) {
      if (shownD[i] <= 1e-4 || shownD[i] >= HUSK_STEADY_AT) continue;
      n++;
      ampRaw += struggleAmplitude(shownR[i], shownD[i]);
      ampFloored += struggleAmplitude(shownD[i], shownD[i]);
    }
    expect(n).toBeGreaterThan(100); // the scene the complaint came from
    expect(ampFloored / n).toBeGreaterThan(0.9); // what shipped
    expect(ampRaw / n).toBeLessThan(0.3); // what the reader now sees
  });
});
