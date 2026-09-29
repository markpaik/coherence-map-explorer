// Flow comets must never flash the orbs they leave or enter.
//
// The bug class this guards: ribbons start at node centres and draw
// additively, and the comet head was a hard sawtooth (pow(fract, 3)). Each
// comet painted over its endpoint orb, so about 28% of lit story orbs jumped
// 3–25% brighter in 0.16 s every 2.0 s (red-team finding 22). The fix fades the
// comet to 0 inside each endpoint orb (in 3D and over its screen disc) and
// replaces the sawtooth with a smooth pulse. These tests pin the TS mirrors of
// the shader math and check that the GLSL is generated from the same constants.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import type { GraphCore } from "../src/data";
import {
  COMET_DISC_IN,
  COMET_DISC_OUT,
  COMET_HEAD,
  COMET_ORB_IN,
  COMET_ORB_OUT,
  cometDiscFade,
  cometEndFade,
  cometEndZone,
  cometPulse,
  createEdges,
} from "../src/scene/edges";
import { computeNodeRadii } from "../src/scene/reach";

const HERE = dirname(fileURLToPath(import.meta.url));
const core: GraphCore = JSON.parse(
  readFileSync(resolvePath(HERE, "..", "public/data/graph-core.json"), "utf8"),
);

describe("comet pulse", () => {
  it("has no discontinuity anywhere, including the wrap", () => {
    // Sample densely and bound the step between neighbours: a jump would show
    // as one step near the full pulse height.
    const n = 4000;
    let maxStep = 0;
    for (let i = 1; i <= n; i++) {
      const a = cometPulse((i - 1) / n);
      const b = cometPulse(i / n === 1 ? 0 : i / n); // i = n closes the wrap
      maxStep = Math.max(maxStep, Math.abs(b - a));
    }
    expect(maxStep).toBeLessThan(0.01);
    expect(cometPulse(0)).toBe(0);
    expect(cometPulse(1 - 1e-9)).toBeLessThan(1e-6);
  });

  it("keeps the comet's look: peak 1 at the head, a cubic tail behind it", () => {
    expect(cometPulse(1 - COMET_HEAD)).toBeCloseTo(1, 6);
    for (let i = 0; i < 100; i++) expect(cometPulse(i / 100)).toBeLessThanOrEqual(1);
    // Tail: the old cubic, compressed into the first 1 − HEAD of the period.
    const x = 0.5 * (1 - COMET_HEAD);
    expect(cometPulse(x)).toBeCloseTo(0.125, 6);
  });
});

describe("comet end-fade at the orbs", () => {
  it("is 0 inside each endpoint orb and full on the open ribbon", () => {
    const zA = cometEndZone(2.4, 64); // median radius over median chord
    const zB = cometEndZone(3.2, 64);
    // Orb surface at t ≈ r / (0.76 · chord) in the worst tangent case.
    expect(cometEndFade(2.4 / (0.76 * 64), zA, zB)).toBe(0);
    expect(cometEndFade(1 - 3.2 / (0.76 * 64), zA, zB)).toBe(0);
    expect(cometEndFade(0, zA, zB)).toBe(0);
    expect(cometEndFade(1, zA, zB)).toBe(0);
    expect(cometEndFade(0.5, zA, zB)).toBe(1);
    expect(cometEndFade(zA[1], zA, zB)).toBe(1);
  });

  it("covers the orb on every real edge in both story poses, at chain scale", () => {
    const radii = computeNodeRadii(core);
    const idx = new Map<string, number>();
    core.nodes.forEach((n, i) => idx.set(n.id, i));
    let checked = 0;
    for (const pose of ["pos", "pos2"] as const) {
      const ck = pose === "pos" ? "c" : "c2";
      for (const e of core.edges) {
        if (e.k !== 0) continue;
        const si = idx.get(e.s)!;
        const ti = idx.get(e.t)!;
        const s = core.nodes[si][pose];
        const t = core.nodes[ti][pose];
        const c = e[ck];
        const chord = Math.hypot(t[0] - s[0], t[1] - s[1], t[2] - s[2]);
        const zA = cometEndZone(radii[si], chord);
        const zB = cometEndZone(radii[ti], chord);
        // Walk the real bezier and require a zero comet everywhere inside
        // either orb at chain scale (1.15 × rest radius, rounded up to 1.2).
        for (let k = 0; k <= 200; k++) {
          const u = k / 200;
          const w = 1 - u;
          const p = [0, 1, 2].map((a) => w * w * s[a] + 2 * w * u * c[a] + u * u * t[a]);
          const dS = Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]);
          const dT = Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2]);
          if (dS < 1.2 * radii[si] || dT < 1.2 * radii[ti]) {
            expect(cometEndFade(u, zA, zB)).toBe(0);
          }
        }
        checked++;
      }
    }
    expect(checked).toBe(2 * 757);
  });

  it("stays off while the ribbon still projects over either orb's disc", () => {
    // A ribbon aimed at the camera clears its orb in 3D but not on screen.
    expect(cometDiscFade(0, 50)).toBe(0);
    expect(cometDiscFade(1, 50)).toBe(0); // the disc edge
    expect(cometDiscFade(COMET_DISC_IN, 50)).toBe(0);
    expect(cometDiscFade(50, COMET_DISC_IN)).toBe(0);
    expect(cometDiscFade(COMET_DISC_OUT, COMET_DISC_OUT)).toBe(1);
    const mid = cometDiscFade((COMET_DISC_IN + COMET_DISC_OUT) / 2, 50);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });

  it("zones stay ordered and inside the midpoint, even on very short edges", () => {
    for (const chord of [0, 1, 5, 10, 20, 64, 300]) {
      const [inner, outer] = cometEndZone(3, chord);
      expect(inner).toBeLessThan(outer);
      expect(outer).toBeLessThanOrEqual(0.5);
    }
  });
});

describe("edge shader is generated from the same constants", () => {
  it("uses the smooth pulse and the orb end-fade, not the hard sawtooth", () => {
    const edges = createEdges(
      core.edges,
      new Map(core.nodes.map((n) => [n.id, n])),
      () => 2,
    );
    const mat = edges.mesh.material as unknown as { vertexShader: string; fragmentShader: string };
    expect(mat.fragmentShader).toContain(
      "float comet = cometPulse(fr) * cometEndFade(vT) * cometDiscFade();",
    );
    expect(mat.fragmentShader).not.toContain("pow(fr, 3.0)");
    expect(mat.fragmentShader).toContain(`(1.0 - fr) / ${COMET_HEAD.toFixed(4)}`);
    expect(mat.fragmentShader).toContain(
      `smoothstep(${COMET_DISC_IN.toFixed(4)}, ${COMET_DISC_OUT.toFixed(4)}, vOrbGap.x)`,
    );
    expect(mat.vertexShader).toContain(`endK * ${COMET_ORB_IN.toFixed(4)}`);
    expect(mat.vertexShader).toContain(`endK * ${COMET_ORB_OUT.toFixed(4)}`);
    expect(mat.vertexShader).toContain("aArtScalars.zw / max(length(aEnd - aStart), 1e-3)");
    // The screen gap is measured in projected orb radii from the rest radii.
    expect(mat.vertexShader).toContain("aArtScalars.z * pxPerUnit / cA.w");
    expect(mat.vertexShader).toContain("aArtScalars.w * pxPerUnit / cB.w");
    edges.dispose();
  });
});
