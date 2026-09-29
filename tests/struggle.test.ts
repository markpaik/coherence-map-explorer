// The story struggle flicker reads the RAW engine damage, never the floored
// display copy.
//
// The bug class this guards: stories floor the display damage (0.35 + 0.65·raw
// on authored scenes, a clamp to 0.35 on lose-a-year) so a lightly-exposed
// standard reads dimmer. The orb shader drove its 4·d·(1−d) flicker from that
// floored value, so every touched standard wavered at 91% or more of peak
// amplitude, and the whole lit set flickered (red-team finding 10). The fix
// gives the shader a second channel (aDamageRaw) that the player writes through
// the same lit mask. The dimming keeps the floored value.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import type { GraphCore } from "../src/data";
import {
  createNodes,
  struggleAmplitude,
  struggleFlickMul,
  HUSK_STEADY_AT,
  STRUGGLE_DEPTH,
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

  it("keeps every node's time-averaged brightness and shrinks only the swing", () => {
    // The shipped multiplier, fed the display value alone.
    const shipped = (d: number, flick: number): number =>
      1 - STRUGGLE_DEPTH * struggleAmplitude(d, d) * (0.5 + 0.5 * flick);
    for (const raw of [0.005, 0.02, 0.1, 0.3, 0.5, 0.8, 0.93, 1]) {
      const d = displayDamage(new Float32Array([raw]))[0];
      for (const flick of [0.2, 0.7, 1]) {
        // flick is zero-mean over time, so a ±flick pair is its mean.
        const meanNew = (struggleFlickMul(raw, d, flick) + struggleFlickMul(raw, d, -flick)) / 2;
        const meanOld = (shipped(d, flick) + shipped(d, -flick)) / 2;
        expect(meanNew).toBeCloseTo(meanOld, 6);
      }
      const swing = struggleFlickMul(raw, d, -1) - struggleFlickMul(raw, d, 1);
      expect(swing).toBeCloseTo(STRUGGLE_DEPTH * struggleAmplitude(raw, d), 6);
    }
    // With no floor (raw === display) the new law IS the shipped one.
    for (const d of [0.1, 0.5, 0.8]) {
      for (const flick of [-1, -0.3, 0.4, 1]) {
        expect(struggleFlickMul(d, d, flick)).toBeCloseTo(shipped(d, flick), 6);
      }
    }
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
    expect(shader.fragmentShader).toContain(
      `float flickMul = 1.0 - ${half} * struggleDip - ${half} * struggle * flick;`,
    );
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
