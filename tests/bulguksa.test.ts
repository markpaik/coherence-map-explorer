// Bulguksa (style 5): the ink style's registry entries, its pigment contrast,
// the composition rules of its world at the home view (massifs, temple,
// murmuration, cranes), the snow, the chrome ink on the title band, the story
// separation, and source guards that keep style 0 off every Bulguksa branch.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GraphCore, StrandId } from "../src/data";
import {
  ART_CREDITS,
  ART_STYLE_NAMES,
  ART_STYLE_SLUGS,
  BULGUKSA_CARD,
  HANGA,
  hangaPalette,
  isBulguksa,
  isHanga,
  isHangaField,
  strandSwatch,
} from "../src/scene/artstyle";
import { STRAND_ORDER } from "../src/scene/palette";
import { CRANE, craneScheduleInto, type CraneState } from "../src/scene/landscape";
import {
  BCRANE,
  BCRANE_SLOTS,
  BMURM,
  DEG,
  FLOOR,
  INK,
  INSCRIPTION,
  MASSIFS,
  SNOW,
  TEMPLE,
  bcraneCount,
  contrastHex,
  discLuminance,
  floorY,
  massifCrest,
  massifFillTones,
  massifSnowAll,
  median,
  murmEdge,
  murmPosition,
  murmSeed,
  snowOffset,
  templeFrameShare,
} from "../src/scene/bulguksa/params";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string): string => readFileSync(resolve(ROOT, p), "utf8");
const PIG = HANGA.bulguksa.pigment;

// Home cameras relative to the map center (measured in the app) and the title
// block's ink box at each viewport: [w, h, camY, camZ, title l, t, r, b].
const VIEWS: [number, number, number, number, number, number, number, number][] = [
  [1440, 900, -5.5, 918, 36, 27, 693, 274],
  [1280, 720, -10.1, 889, 36, 22, 693, 268],
  [1024, 600, -17.3, 909, 31, 18, 657, 253],
];
function project(p: readonly number[], v: (typeof VIEWS)[number]): [number, number] {
  const [w, h, cy, cz] = v;
  const t = Math.tan(25 * DEG);
  const d = cz - p[2];
  return [w / 2 + (p[0] / (d * t * (w / h))) * (w / 2), h / 2 - ((p[1] - cy) / (d * t)) * (h / 2)];
}

describe("registry", () => {
  it("adds Bulguksa as style 5 with its slug, name, and credit", () => {
    expect(ART_STYLE_NAMES.length).toBe(6);
    expect(ART_STYLE_SLUGS[5]).toBe("bulguksa");
    expect(ART_STYLE_NAMES[5]).toBe("Bulguksa");
    expect(ART_CREDITS[5].html).toBe("After Park Dae-sung and the Joseon ink tradition");
    expect(new Set(ART_STYLE_SLUGS).size).toBe(6);
  });
  it("prints the map in the brush grammar, but not on the woodblock field", () => {
    expect(isHanga(5)).toBe(true);
    expect(isHangaField(5)).toBe(false);
    expect([0, 1, 2, 3, 4].map(isBulguksa)).toEqual([false, false, false, false, false]);
    expect(isBulguksa(5)).toBe(true);
    expect(hangaPalette(5)).toBe(HANGA.bulguksa);
    for (const s of STRAND_ORDER) expect(strandSwatch(s, 5)).toBe(PIG[s]);
  });
});

describe("obangsaek pigments", () => {
  it("are the recorded hexes", () => {
    expect(PIG).toEqual({ number: 0xd3382a, algebra: 0x2b4fa8, geometry: 0x2a7d52, data: 0x9c6c08 });
    expect(HANGA.bulguksa.bg).toBe(0xf2efe8);
    expect(HANGA.bulguksa.sumi).toBe(0x1c1a17);
  });
  it("hold 3:1 against the hanji", () => {
    for (const s of STRAND_ORDER as StrandId[]) expect(contrastHex(PIG[s], INK.paper), s).toBeGreaterThanOrEqual(3);
  });
  it("hold 3:1 against every massif fill tone", () => {
    for (const tone of massifFillTones())
      for (const s of STRAND_ORDER as StrandId[])
        expect(contrastHex(PIG[s], tone), `${s} on ${tone.toString(16)}`).toBeGreaterThanOrEqual(3);
  });
  it("card swatches hold 3:1 on dark glass over the hanji and on the Browse field", () => {
    const glass = (f: number): number => {
      const ch = [16, 8, 0].map((sh, i) => Math.round([16, 16, 36][i] * 0.88 + ((f >> sh) & 255) * 0.12));
      return (ch[0] << 16) | (ch[1] << 8) | ch[2];
    };
    for (const s of STRAND_ORDER as StrandId[]) {
      expect(contrastHex(BULGUKSA_CARD[s], glass(INK.paper))).toBeGreaterThanOrEqual(3);
      expect(contrastHex(BULGUKSA_CARD[s], 0x050510)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("chrome ink on the title band", () => {
  it("the band is the palette's top tone", () => {
    expect(INK.band).toBe(HANGA.bulguksa.top);
  });
  it("sumi title ink and the lightest line ink both hold 4.5:1 on the band", () => {
    const css = read("src/style.css");
    const block = css.slice(css.indexOf("body.art-bulguksa {"), css.indexOf("/* -- light environments"));
    const inks = [...block.matchAll(/(?<![-\w])color: (#[0-9a-f]{6});/g)].map((m) => parseInt(m[1].slice(1), 16));
    expect(inks.length).toBeGreaterThan(5);
    // Each ink on the band (the slips are paper, lighter than the band).
    for (const ink of inks) {
      expect(contrastHex(ink, INK.band), ink.toString(16)).toBeGreaterThanOrEqual(4.5);
      expect(contrastHex(ink, 0xf8f6f1), ink.toString(16)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("no box, scrim, or halo behind the title", () => {
    const css = read("src/style.css");
    const block = css.slice(css.indexOf("body.art-bulguksa {"), css.indexOf("/* -- light environments"));
    expect(block).not.toMatch(/\.title-block[^{]*\{[^}]*background/);
    expect(block).toMatch(/\.headline \{\s*color: #1c1a17;\s*text-shadow: none;/);
  });
});

describe("massifs keep the map's center region clear at the home view", () => {
  it("every crest in front of the map prints below 52% of the frame height", () => {
    for (const v of VIEWS) {
      for (let az = -30; az <= 30; az += 0.5) {
        const th = az * DEG;
        for (const m of MASSIFS) {
          const p = [m.R * Math.sin(th), massifCrest(m, th), -m.R * Math.cos(th)];
          const [x, y] = project(p, v);
          if (x < 0.3 * v[0] || x > 0.7 * v[0]) continue;
          expect(y / v[1], `${v[0]} az ${az} R ${m.R}`).toBeGreaterThan(0.52);
        }
      }
    }
  });
  it("show only snow (no rock) behind the map at the home view", () => {
    const core: GraphCore = JSON.parse(read("public/data/graph-core.json"));
    const ys = core.nodes.map((n) => n.pos[1]);
    const zs = core.nodes.map((n) => n.pos[2]);
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    for (const v of VIEWS) {
      const pts = core.nodes.map((n) => project([n.pos[0], n.pos[1] - cy, n.pos[2] - cz], v));
      // The map's body: the 5th to 95th percentile of its standards on screen.
      const xs = pts.map((p) => p[0]).sort((a, b) => a - b);
      const yv = pts.map((p) => p[1]).sort((a, b) => a - b);
      const q = (arr: number[], f: number): number => arr[Math.floor(arr.length * f)];
      const x0 = q(xs, 0.05);
      const x1 = q(xs, 0.95);
      const y1 = q(yv, 0.95);
      for (let az = -90; az <= 90; az += 0.5) {
        const th = az * DEG;
        for (const m of MASSIFS) {
          const [x, y] = project([m.R * Math.sin(th), massifCrest(m, th), -m.R * Math.cos(th)], v);
          // A massif face whose crest prints inside the map's box must be all snow.
          if (x > x0 && x < x1 && y < y1) expect(massifSnowAll(th), `${v[0]} az ${az} R ${m.R}`).toBeGreaterThan(0.995);
        }
      }
    }
  });
  it("rise as monumental masses at the sides", () => {
    const side = Math.max(...MASSIFS.map((m) => massifCrest(m, 70 * DEG)));
    const front = Math.max(...MASSIFS.map((m) => massifCrest(m, 0)));
    expect(side - front).toBeGreaterThan(300);
  });
  it("rise from the snow slope (the bases fade above the floor rim)", () => {
    for (const m of MASSIFS) expect(m.top - m.fadeSpan).toBeGreaterThan(floorY(FLOOR.R) - 120);
  });
});

describe("temple", () => {
  it("spans about 1.5x the first round's 55% of the frame width at the home view", () => {
    expect(templeFrameShare(1440 / 900)).toBeGreaterThan(0.78);
    expect(templeFrameShare(1440 / 900)).toBeLessThan(0.86);
  });
  it("stays below the map: its highest roof prints under the lowest standard, in the gap above the filter rail", () => {
    const core: GraphCore = JSON.parse(read("public/data/graph-core.json"));
    const ys = core.nodes.map((n) => n.pos[1]);
    const zs = core.nodes.map((n) => n.pos[2]);
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    let lowest = 0;
    const v = VIEWS[0];
    for (const n of core.nodes) lowest = Math.max(lowest, project([n.pos[0], n.pos[1] - cy, n.pos[2] - cz], v)[1]);
    // Daeungjeon's ridge: 15.1 plan units up, 25 plan units back from the front face.
    const ridge = project([0, TEMPLE.y + 15.1 * TEMPLE.scale * TEMPLE.yScale, TEMPLE.z - 25 * TEMPLE.scale * TEMPLE.zScale], v);
    expect(ridge[1]).toBeGreaterThan(lowest);
    // The main hall prints below the search row (bottom 648 px at 1440x900)
    // and the terrace foot above the filter rail (top 845 px).
    expect(ridge[1]).toBeGreaterThan(648);
    expect(project([0, TEMPLE.y, TEMPLE.z], v)[1]).toBeLessThan(845);
  });
  it("has its terrace foot at the snow slope", () => {
    expect(Math.abs(floorY(TEMPLE.z) - TEMPLE.y)).toBeLessThan(2);
  });
});

describe("murmuration", () => {
  const SAMPLE = Array.from({ length: 400 }, (_, i) => i * 5);
  const TIMES = Array.from({ length: 40 }, (_, i) => i * 31.7);
  it("is one draw of about 1200 starlings with a thin straggler fringe", () => {
    expect(BMURM.count).toBeGreaterThanOrEqual(1000);
    expect(BMURM.count).toBeLessThanOrEqual(1500);
    let fringe = 0;
    for (let i = 0; i < BMURM.count; i++) fringe += murmSeed(i)[3];
    expect(fringe / BMURM.count).toBeGreaterThan(0.02);
    expect(fringe / BMURM.count).toBeLessThan(0.08);
  });
  it("has uniform interior density (inner and outer halves of the sheet by area)", () => {
    let inner = 0;
    let outer = 0;
    for (let i = 0; i < BMURM.count; i++) {
      const [u, v, , fr] = murmSeed(i);
      if (fr) continue;
      const r = Math.hypot(u, v);
      if (r < Math.SQRT1_2) inner++;
      else outer++;
    }
    expect(inner / outer).toBeGreaterThan(0.85);
    expect(inner / outer).toBeLessThan(1.15);
  });
  it("has no shape period under 20 s", () => {
    for (const p of [BMURM.pFold, BMURM.pTurn, BMURM.pDrift, BMURM.pEdge, BMURM.pTilt]) expect(p).toBeGreaterThanOrEqual(20);
    expect(murmEdge(0.3, 0)).toBeGreaterThan(0.8);
  });
  it("stays clear of the title block and the map at 1440x900, 1280x720, and 1024x600", () => {
    const core: GraphCore = JSON.parse(read("public/data/graph-core.json"));
    const ys = core.nodes.map((n) => n.pos[1]);
    const zs = core.nodes.map((n) => n.pos[2]);
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    for (const v of VIEWS) {
      let mapTop = Infinity;
      for (const n of core.nodes) mapTop = Math.min(mapTop, project([n.pos[0], n.pos[1] - cy, n.pos[2] - cz], v)[1]);
      let hitsTitle = 0;
      let hitsMap = 0;
      let n = 0;
      for (const t of TIMES)
        for (const i of SAMPLE) {
          const [x, y] = project(murmPosition(i, t), v);
          if (x >= v[4] - 8 && x <= v[6] + 8 && y >= v[5] - 8 && y <= v[7] + 8) hitsTitle++;
          if (y > mapTop - 6) hitsMap++;
          n++;
        }
      // A straggler may graze an edge; the flock never does.
      expect(hitsTitle / n, `title ${v[0]}`).toBeLessThan(0.01);
      expect(hitsMap / n, `map ${v[0]}`).toBeLessThan(0.01);
    }
  });
});

describe("cranes", () => {
  it("fly the Hanga schedule: about a 40 s crossing, then 50 to 90 s of empty sky", () => {
    const st: CraneState = { index: 0, start: CRANE.first, progress: 0, visible: false };
    let starts: number[] = [];
    let lastIdx = -1;
    for (let t = 0; t < 2000; t += 0.25) {
      craneScheduleInto(t, st, st);
      if (st.index !== lastIdx) {
        starts.push(st.start);
        lastIdx = st.index;
      }
    }
    starts = starts.slice(0, 12);
    for (let k = 1; k < starts.length; k++) {
      const gap = starts[k] - starts[k - 1] - CRANE.crossing;
      expect(gap).toBeGreaterThanOrEqual(50);
      expect(gap).toBeLessThan(90);
    }
    expect(CRANE.crossing).toBe(40);
  });
  it("number 4 to 6 per flight, each at its own phase of one slow stroke", () => {
    for (let k = 0; k < 50; k++) {
      expect(bcraneCount(k)).toBeGreaterThanOrEqual(4);
      expect(bcraneCount(k)).toBeLessThanOrEqual(6);
    }
    expect(new Set(BCRANE_SLOTS.map((s) => s[2])).size).toBe(BCRANE_SLOTS.length);
    expect(BCRANE.wingPeriod).toBeGreaterThanOrEqual(3);
  });
  it("span about 16 to 20 px at the home view", () => {
    // Wing reach in quad units (arm 0.3 + hand 0.42) at full stroke, both wings.
    const span = 2 * 0.72 * BCRANE.size;
    const d = 918 + BCRANE.R * Math.cos(30 * DEG);
    const px = (span / (d * Math.tan(25 * DEG))) * 450;
    expect(px).toBeGreaterThan(16);
    expect(px).toBeLessThan(22);
  });
  it("cross the right half of the sky, clear of the title block", () => {
    for (const v of VIEWS) {
      for (const az of [BCRANE.az0, BCRANE.az1]) {
        const [x] = project([BCRANE.R * Math.sin(az), BCRANE.R * Math.tan(BCRANE.el), -BCRANE.R * Math.cos(az)], v);
        expect(x).toBeGreaterThan(v[6]);
      }
    }
  });
});

describe("inscription and snow", () => {
  it("the inscription reads 佛國雪中數理圖 and stays in the top-right sky", () => {
    expect(INSCRIPTION.text).toBe("佛國雪中數理圖");
    for (const v of VIEWS) {
      const [x, y] = project([INSCRIPTION.R * Math.sin(INSCRIPTION.az), INSCRIPTION.R * Math.tan(INSCRIPTION.el0), -INSCRIPTION.R * Math.cos(INSCRIPTION.az)], v);
      expect(x).toBeGreaterThan(v[6] + 100);
      expect(x).toBeLessThan(v[0]);
      expect(y).toBeGreaterThan(0);
    }
  });
  it("falling snow stays inside its box and is sparse", () => {
    expect(SNOW.count).toBeLessThanOrEqual(1200);
    for (let i = 0; i < 300; i++)
      for (const t of [0, 13.3, 777.7]) {
        const o = snowOffset(i, t);
        expect(Math.abs(o[0])).toBeLessThanOrEqual(SNOW.hx);
        expect(Math.abs(o[1])).toBeLessThanOrEqual(SNOW.hy);
        expect(Math.abs(o[2])).toBeLessThanOrEqual(SNOW.hz);
      }
  });
});

describe("story separation (as on Washi)", () => {
  // HANGA_NODE WASH and WASH_ALPHA (scene/nodes.ts): the paper-field damage law.
  const WASH = 0.72;
  const WASH_ALPHA = 0.45;
  it("lit and damaged discs differ by 45 or more of 255 in median luminance, from the story floor up", () => {
    for (const d of [0.35, 0.5, 0.75, 1]) {
      const lit = median(STRAND_ORDER.map((s) => discLuminance(PIG[s], INK.paper, 0, WASH, WASH_ALPHA)));
      const dmg = median(STRAND_ORDER.map((s) => discLuminance(PIG[s], INK.paper, d, WASH, WASH_ALPHA)));
      expect(Math.abs(lit - dmg), `d=${d}`).toBeGreaterThanOrEqual(45);
    }
  });
  it("the node shader still uses that law", () => {
    const nodes = read("src/scene/nodes.ts");
    expect(nodes).toContain("WASH: 0.72,");
    expect(nodes).toContain("WASH_ALPHA: 0.45,");
  });
});

describe("style 0 never reaches a Bulguksa branch (source guards)", () => {
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  it("the world shows only at style 5", () => {
    const src = strip(read("src/scene/bulguksa/index.ts"));
    expect(src).toContain("group.visible = false;");
    expect(src).toContain("group.visible = style === 5;");
    expect(src.match(/group\.visible = /g)?.length).toBe(2);
  });
  it("main wires the world, the class, and the hanji sheet to style 5 only", () => {
    const main = read("src/main.ts");
    expect(main).toContain('document.body.classList.toggle("art-bulguksa", style === 5);');
    expect(main).toContain("bloom.setArtInk(isHanga(style), style === 4, style === 5);");
    expect(main).toContain("bulguksa.setArtStyle(style);");
  });
  it("the edge key and the enso sit behind the Hanga branch and a style-5 uniform", () => {
    const edges = read("src/scene/edges.ts");
    const frag = edges.slice(edges.indexOf("const FRAG"));
    const hanga = frag.indexOf("HANGA (3 Washi | 4 Dusk) ====");
    expect(hanga).toBeGreaterThan(0);
    expect(frag.indexOf("if (uHangaKey > 0.5)")).toBeGreaterThan(hanga);
    expect(edges).toContain("uniforms.uHangaKey.value = style === 5 ? 1 : 0;");
    const beacons = read("src/scene/beacons.ts");
    expect(beacons).toContain("fUniforms.uSeal.value = hanga ? (style === 5 ? 2 : 1) : 0;");
    const bloom = read("src/scene/bloom.ts");
    expect(bloom).toContain("paperHanji.value = hanji ? 1 : 0;");
  });
  it("the woodblock field and landscape do not show at style 5", () => {
    expect(read("src/scene/environs.ts")).toContain("const on = isHangaField(style);");
    expect(read("src/scene/landscape.ts")).toContain("const on = next === 3 || next === 4;");
  });
});
