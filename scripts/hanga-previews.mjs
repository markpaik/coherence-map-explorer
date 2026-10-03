// HANGA art-style previews (design exploration, NOT a build step).
//
// A Japanese woodblock skin for the Constellation pose (pose 0). Three
// inspirations: Wada Sanzo's Dictionary of Color Combinations (one
// harmonious four-pigment set per field), Oda Kazuma (calm dusk landscapes),
// and Utagawa Hiroshige (bokashi gradients, flat color under fine key-block
// lines, deep Prussian blue).
//
//  Fields:   WASHI daylight (warm unbleached paper, Prussian bokashi sky band,
//            faint persimmon horizon) and INDIGO dusk (aizuri blue grading to
//            pale slate, thin warm glow low on the sheet). Both carry the same
//            paper grain (feTurbulence + sparse long fibers).
//  Edges:    prerequisite edges are filled tapered brush strokes along the
//            baked quadratic bezier (pos, c, pos). The stroke pools at the
//            PREREQUISITE end (edge.s) and whisks to a thin dry-brush tail
//            (kasure: 2-3 bristle streaks with gaps) at the DEPENDENT end
//            (edge.t). Related pairs are rows of light sumi dabs.
//  Nodes:    flat pigment discs with a thin sumi key-block outline and a
//            top-dark bokashi fade. Edgeless standards are bare-paper discs.
//  Focus:    4.NF.B.3 with its family's full ancestry and dependent closure
//            lit; everything else drops to a faint sumi underdrawing; a
//            vermilion seal ring marks the focus.
//
// Deterministic: no randomness; all variation is hashed from ids. Reads
// public/data/graph-core.json; writes docs/previews/hanga-*.svg. Nothing
// imports this.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = resolve(ROOT, "docs/previews");
mkdirSync(OUT, { recursive: true });

const g = JSON.parse(readFileSync(resolve(ROOT, "public/data/graph-core.json"), "utf8"));
const byId = new Map(g.nodes.map((n) => [n.id, n]));

// --- helpers ---------------------------------------------------------------
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // final avalanche so neighbouring ids do not land on neighbouring values
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
const hexToRgb = (h) => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const rgbToHex = ([r, g2, b]) =>
  `#${((Math.round(r) << 16) | (Math.round(g2) << 8) | Math.round(b)).toString(16).padStart(6, "0")}`;
const mixHex = (h1, h2, t) => {
  const a = hexToRgb(h1), b = hexToRgb(h2);
  return rgbToHex(a.map((v, i) => v + (b[i] - v) * t));
};
const lum = (hex) => {
  const [r, g2, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g2 + 0.0722 * b;
};
const contrast = (a, b) => {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const f1 = (v) => v.toFixed(1);
const f2 = (v) => v.toFixed(2);

const qPoint = (a, c, b, t) => {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
};
const qTangent = (a, c, b, t) => {
  const tx = 2 * (1 - t) * (c[0] - a[0]) + 2 * t * (b[0] - c[0]);
  const ty = 2 * (1 - t) * (c[1] - a[1]) + 2 * t * (b[1] - c[1]);
  const L = Math.hypot(tx, ty) || 1;
  return [tx / L, ty / L];
};

// --- fields and pigments ---------------------------------------------------
// One four-pigment set per field, in the spirit of Wada Sanzo's combinations:
// each strand keeps its hue family (number gold, algebra violet, geometry
// blue-green, data vermilion-rose). `mid` is the field color at half height,
// the reference for the WCAG contrast gate.
const FIELDS = {
  washi: {
    name: "Washi daylight",
    paper: "#efe6d2",
    mid: "#efe6d2", // the bokashi band has faded to bare paper by 30% height
    sumi: "#1c1a17",
    pigment: {
      number: "#ad7408", // yamabuki gold, printed deep enough to carry on paper
      algebra: "#8250a6", // murasaki
      geometry: "#16808a", // asagi / bero-ai blue-green
      data: "#c8364a", // beni vermilion-rose
    },
  },
  dusk: {
    name: "Indigo dusk",
    top: "#12233f", // aizuri
    bottom: "#4a6185", // pale slate
    sumi: "#ece3cf", // the key block prints in pale paper tone at dusk
    pigment: {
      number: "#eab64a", // yamabuki gold
      algebra: "#b99ae2", // fuji violet
      geometry: "#5cc2b6", // asagi blue-green
      data: "#f07c72", // beni vermilion-rose
    },
  },
};
FIELDS.dusk.mid = mixHex(FIELDS.dusk.top, FIELDS.dusk.bottom, 0.5);
FIELDS.dusk.paper = FIELDS.dusk.mid;

const STRANDS = ["number", "algebra", "geometry", "data"];
const STRAND_LABEL = { number: "Number", algebra: "Algebra", geometry: "Geometry", data: "Data" };
const SEAL = "#c8372d";
// Disc bokashi ends: each pigment deepens toward a darker ink of its own hue
// at the top of the disc and lifts toward a brighter wash of its own hue at
// the bottom (never toward grey or sumi, which reads as mud).
const BOKASHI_DEEP = {
  washi: { number: "#7a4a00", algebra: "#4e2a78", geometry: "#0b4f63", data: "#8e1830" },
  dusk: { number: "#b8790e", algebra: "#7c5cb8", geometry: "#2a8f8c", data: "#c8473f" },
};
const BOKASHI_LIGHT = {
  washi: { number: "#f0b628", algebra: "#b98ad8", geometry: "#56b8b4", data: "#ee7a76" },
  dusk: { number: "#fbe3a0", algebra: "#e2d2f6", geometry: "#b4ece2", data: "#fbc0b0" },
};

// WCAG gate: every pigment must reach 3.0 against its field's mid color.
const RATIOS = {};
let gateFailed = false;
for (const [key, F] of Object.entries(FIELDS)) {
  RATIOS[key] = {};
  for (const s of STRANDS) {
    const r = contrast(F.pigment[s], F.mid);
    RATIOS[key][s] = r;
    const ok = r >= 3.0;
    if (!ok) gateFailed = true;
    console.log(`${F.name.padEnd(15)} ${s.padEnd(9)} ${F.pigment[s]} vs ${F.mid}  ${r.toFixed(2)}:1 ${ok ? "pass" : "FAIL"}`);
  }
}
if (gateFailed) {
  console.error("contrast gate failed: adjust the pigments above until every ratio is 3.0 or more");
  process.exit(1);
}

// --- geometry --------------------------------------------------------------
const W = 1600, H = 1000;
// Uniform fit of pose-0 x/y (nodes and edge control points) into the map
// frame. The frame leaves the top of the bokashi band and the bottom strip
// (caption + legend) clear.
const FRAME = { x0: 80, x1: W - 80, y0: 150, y1: 835 };
const fitPts = g.nodes.map((n) => n.pos);
for (const e of g.edges) fitPts.push(e.c);
const fit = (() => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of fitPts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const fw = FRAME.x1 - FRAME.x0, fh = FRAME.y1 - FRAME.y0;
  const s = Math.min(fw / (x1 - x0), fh / (y1 - y0));
  const ox = FRAME.x0 + (fw - (x1 - x0) * s) / 2;
  const oy = FRAME.y0 + (fh - (y1 - y0) * s) / 2;
  return ([x, y]) => [ox + (x - x0) * s, oy + (y1 - y) * s];
})();
const P = new Map(g.nodes.map((n) => [n.id, fit(n.pos)]));
// Same degree rule as art-previews.mjs (constellation / Fidenza cubes),
// scaled to the 1600-wide sheet.
const nodeR = (n) => (3.4 + Math.sqrt(n.deg) * 1.9) * (W / 1680);

const prereq = g.edges.filter((e) => e.k === 0);
const related = g.edges.filter((e) => e.k === 1);

// --- focus closure ---------------------------------------------------------
// 4.NF.B.3 is an edgeless parent: its prerequisite links live on its
// sub-standards (.a-.d). The app's `family-ancestry:` selector treats the
// family as one unit, so the closure here does the same.
const FOCUS_CODE = "4.NF.B.3";
const focus = g.nodes.find((n) => n.code === FOCUS_CODE);
if (!focus) throw new Error(`${FOCUS_CODE} not found`);
const family = new Set([focus.id, ...(focus.children ?? [])]);
const parentsOf = new Map(), childrenOfE = new Map();
for (const e of prereq) {
  if (!parentsOf.has(e.t)) parentsOf.set(e.t, []);
  parentsOf.get(e.t).push(e.s);
  if (!childrenOfE.has(e.s)) childrenOfE.set(e.s, []);
  childrenOfE.get(e.s).push(e.t);
}
const closure = (adj) => {
  const seen = new Set(family);
  const stack = [...family];
  while (stack.length) {
    const id = stack.pop();
    for (const nb of adj.get(id) ?? []) if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
  }
  return seen;
};
const ancestry = closure(parentsOf);
const dependents = closure(childrenOfE);
const lit = new Set([...ancestry, ...dependents]);
const edgeLit = (e) =>
  e.k === 0
    ? (ancestry.has(e.s) && ancestry.has(e.t)) || (dependents.has(e.s) && dependents.has(e.t))
    : lit.has(e.s) && lit.has(e.t);
console.log(`focus ${FOCUS_CODE} (id ${focus.id}): ${ancestry.size - family.size} ancestors, ${dependents.size - family.size} dependents, ${prereq.filter(edgeLit).length} lit prerequisite edges`);

// --- densest region (for the 2x review crop) --------------------------------
const dense = (() => {
  let best = { x: 0, y: 0, n: -1 };
  for (let x = 0; x <= W - 800; x += 20) {
    for (let y = 0; y <= H - 500; y += 20) {
      let n = 0;
      for (const p of P.values()) if (p[0] >= x && p[0] < x + 800 && p[1] >= y && p[1] < y + 500) n++;
      if (n > best.n) best = { x, y, n };
    }
  }
  return best;
})();

// --- brush strokes ---------------------------------------------------------
// A filled polygon around the bezier, its half-width a profile over t: full
// and slightly pooled at the prerequisite end, thinning to a whisked tail at
// the dependent end. The last ~35% splits into 2-3 bristle streaks with
// hashed gaps (kasure). The stroke runs from the source disc's rim to just
// short of the target disc's rim, so the pool and the tail stay visible.
const HALF0 = 1.6, HALF1 = 0.2; // 3.2 px full, 0.4 px tail at 1600 wide
const halfAt = (t) => {
  const body = HALF1 + (HALF0 - HALF1) * Math.pow(1 - t, 0.95);
  const pool = 0.32 * Math.exp(-(((t - 0.05) / 0.06) ** 2)); // pigment pooling
  return body + pool;
};

function trimT(a, c, b, rA, rB) {
  // parameter range [tA, tB] outside the two discs (sampled; good enough here)
  let tA = 0, tB = 1;
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    const p = qPoint(a, c, b, t);
    if (Math.hypot(p[0] - a[0], p[1] - a[1]) >= rA) { tA = t; break; }
  }
  for (let i = 200; i >= 0; i--) {
    const t = i / 200;
    const p = qPoint(a, c, b, t);
    if (Math.hypot(p[0] - b[0], p[1] - b[1]) >= rB) { tB = t; break; }
  }
  return tB - tA > 0.05 ? [tA, tB] : null;
}

function ribbon(a, c, b, tA, tB, uFrom, uTo, halfFn, offsetFn, steps) {
  // polygon along the curve for local parameter u in [uFrom, uTo]; u maps
  // onto [tA, tB]. halfFn(u) is the half-width, offsetFn(u) a lateral shift.
  const L = [], R = [];
  for (let i = 0; i <= steps; i++) {
    const u = uFrom + ((uTo - uFrom) * i) / steps;
    const t = tA + (tB - tA) * u;
    const p = qPoint(a, c, b, t);
    const d = qTangent(a, c, b, t);
    const nx = -d[1], ny = d[0];
    const h = halfFn(u), o = offsetFn(u);
    L.push([p[0] + nx * (o + h), p[1] + ny * (o + h)]);
    R.push([p[0] + nx * (o - h), p[1] + ny * (o - h)]);
  }
  const pts = [...L, ...R.reverse()];
  return "M" + pts.map((q) => `${f1(q[0])},${f1(q[1])}`).join("L") + "Z";
}

function brushStroke(e, color, opacity, widthScale) {
  const s = byId.get(e.s), t = byId.get(e.t);
  const a = P.get(e.s), b = P.get(e.t), c = fit(e.c);
  const range = trimT(a, c, b, nodeR(s) + 0.6, nodeR(t) + 1.6);
  if (!range) return "";
  const [tA, tB] = range;
  const id = e.s + ">" + e.t;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.max(8, Math.min(48, Math.round(len / 6)));
  // a faint hand tremor: one slow lateral sway, amplitude hashed per edge
  const swayA = (hash(id + "sway") - 0.5) * 0.7;
  const sway = (u) => swayA * Math.sin(Math.PI * u);
  // brush pressure breathes along the stroke (hashed, about +/-11%), so the
  // two edges are never ruled parallels
  const pf = 1.3 + hash(id + "pf") * 1.4, pp = hash(id + "pp") * Math.PI * 2;
  const half = (u) => halfAt(u) * widthScale * (1 + 0.11 * Math.sin(Math.PI * 2 * pf * u + pp));
  const out = [];
  const K = 0.65; // kasure begins here
  // body: pool to the start of the dry-brush run, with a round head
  const head = qPoint(a, c, b, tA);
  out.push(`<circle cx="${f1(head[0])}" cy="${f1(head[1])}" r="${f2(half(0) * 0.92)}"/>`);
  out.push(`<path d="${ribbon(a, c, b, tA, tB, 0, K + 0.03, half, sway, Math.ceil(steps * 0.7))}"/>`);
  // kasure: 2 or 3 bristle streaks across the stroke's width. The brush
  // runs dry, so the bristles part (paper shows between them), each breaks
  // at hashed gaps, and only one carries ink all the way to the tip.
  const nb = hash(id + "nb") < 0.5 ? 2 : 3;
  const tipLane = Math.floor(hash(id + "tip") * nb);
  for (let j = 0; j < nb; j++) {
    const lane = nb === 2 ? (j === 0 ? -0.5 : 0.5) : j - 1; // lateral lane
    const end = j === tipLane ? 1 : 0.8 + hash(id + "end" + j) * 0.14;
    const v = (u) => Math.min(1, Math.max(0, (u - K) / (1 - K))); // 0..1 through the dry run
    const bh = (u) => Math.max(0.13, half(u) * (nb === 2 ? 0.42 : 0.3) * (1 - 0.25 * v(u)));
    // lanes part a little as the bristles dry (splay grows toward the tail)
    const off = (u) => sway(u) + lane * (half(u) * (nb === 2 ? 1.05 : 0.78) + 0.55 * widthScale * v(u));
    const gaps = [];
    const ng = 1 + (hash(id + "ng" + j) < 0.5 ? 1 : 0);
    for (let k = 0; k < ng; k++) {
      const g0 = K + 0.04 + hash(id + "g" + j + k) * Math.max(0.02, end - K - 0.14);
      gaps.push([g0, g0 + 0.03 + hash(id + "gl" + j + k) * 0.05]);
    }
    gaps.sort((x, y) => x[0] - y[0]);
    let u0 = K;
    const segs = [];
    for (const [g0, g1] of gaps) {
      if (g0 > u0 + 0.01) segs.push([u0, Math.min(g0, end)]);
      u0 = Math.max(u0, g1);
    }
    if (end > u0 + 0.01) segs.push([u0, end]);
    const ink = 0.7 + hash(id + "ink" + j) * 0.3; // dry bristles carry less pigment
    for (const [s0, s1] of segs) {
      // taper both ends of each fragment so the bristle lifts off the paper
      const lift = (u) => Math.min(1, Math.max(0.2, (s1 - u) / 0.035));
      const land = (u) => (s0 > K ? Math.min(1, Math.max(0.35, (u - s0) / 0.02)) : 1);
      const hf = (u) => bh(u) * Math.min(lift(u), land(u));
      out.push(`<path fill-opacity="${f2(ink)}" d="${ribbon(a, c, b, tA, tB, s0, s1, hf, off, Math.max(3, Math.ceil(steps * (s1 - s0) * 1.4)))}"/>`);
    }
  }
  // Group opacity composites the stroke ONCE: body, head and bristles are
  // one impression of pigment, so their overlaps never print darker.
  return `<g fill="${color}" opacity="${opacity}">${out.join("")}</g>`;
}

// Related pairs: a row of small, light sumi dabs along the curve (no dashes).
function dabRow(e, color, opacity) {
  const a = P.get(e.s), b = P.get(e.t), c = fit(e.c);
  const range = trimT(a, c, b, nodeR(byId.get(e.s)) + 2, nodeR(byId.get(e.t)) + 2);
  if (!range) return "";
  const [tA, tB] = range;
  const id = e.s + "~" + e.t;
  // approximate arc length
  let len = 0, prev = qPoint(a, c, b, tA);
  for (let i = 1; i <= 24; i++) {
    const p = qPoint(a, c, b, tA + ((tB - tA) * i) / 24);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  const n = Math.max(2, Math.round(len / 9));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = tA + ((tB - tA) * (i + 0.5 + (hash(id + "j" + i) - 0.5) * 0.45)) / (n + 1);
    const p = qPoint(a, c, b, t);
    const d = qTangent(a, c, b, t);
    const ang = (Math.atan2(d[1], d[0]) * 180) / Math.PI + (hash(id + i) - 0.5) * 30;
    const rx = 1.15 + hash(id + "r" + i) * 0.55;
    const ry = 0.55 + hash(id + "q" + i) * 0.3;
    const op = opacity * (0.7 + hash(id + "o" + i) * 0.3);
    out.push(`<ellipse cx="${f1(p[0])}" cy="${f1(p[1])}" rx="${f2(rx)}" ry="${f2(ry)}" transform="rotate(${ang.toFixed(0)} ${f1(p[0])} ${f1(p[1])})" fill-opacity="${f2(op)}"/>`);
  }
  return `<g fill="${color}">${out.join("")}</g>`;
}

// --- sheet -----------------------------------------------------------------
function defs(fk, F) {
  const d = [];
  // node bokashi: darker pigment at the top of the disc fading lighter below
  for (const s of STRANDS) {
    const base = F.pigment[s];
    const top = mixHex(base, BOKASHI_DEEP[fk][s], fk === "washi" ? 0.3 : 0.22);
    const bot = mixHex(base, BOKASHI_LIGHT[fk][s], fk === "washi" ? 0.55 : 0.4);
    d.push(`<linearGradient id="bk-${s}" x1="0" y1="0" x2="0" y2="1"><stop offset="0.08" stop-color="${top}"/><stop offset="0.45" stop-color="${base}"/><stop offset="1" stop-color="${bot}"/></linearGradient>`);
  }
  if (fk === "washi") {
    // Hiroshige sky: deep Prussian at the top edge, gone by ~30% height
    d.push(`<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#1f3a5f" stop-opacity="1"/>
  <stop offset="0.045" stop-color="#1f3a5f" stop-opacity="0.96"/>
  <stop offset="0.12" stop-color="#2b4a70" stop-opacity="0.62"/>
  <stop offset="0.21" stop-color="#4a6688" stop-opacity="0.2"/>
  <stop offset="0.30" stop-color="#6f86a0" stop-opacity="0"/>
</linearGradient>`);
    d.push(`<linearGradient id="horizon" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0.80" stop-color="#e2895a" stop-opacity="0"/>
  <stop offset="0.885" stop-color="#e2895a" stop-opacity="0.2"/>
  <stop offset="0.93" stop-color="#e79a68" stop-opacity="0.12"/>
  <stop offset="1" stop-color="#efe6d2" stop-opacity="0"/>
</linearGradient>`);
  } else {
    d.push(`<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#08122a"/>
  <stop offset="0.035" stop-color="#0a162f"/>
  <stop offset="0.16" stop-color="${F.top}"/>
  <stop offset="0.5" stop-color="${F.mid}"/>
  <stop offset="1" stop-color="${F.bottom}"/>
</linearGradient>`);
    d.push(`<linearGradient id="horizon" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0.845" stop-color="#e59a62" stop-opacity="0"/>
  <stop offset="0.885" stop-color="#e8a46a" stop-opacity="0.34"/>
  <stop offset="0.905" stop-color="#d98a5e" stop-opacity="0.16"/>
  <stop offset="0.95" stop-color="#d98a5e" stop-opacity="0"/>
</linearGradient>`);
  }
  // paper grain: fine fiber noise, stretched horizontally like laid washi
  const grainTint = fk === "washi" ? "0.42 0.34 0.22" : "0.93 0.89 0.81";
  const grainAlpha = fk === "washi" ? 0.085 : 0.045;
  d.push(`<filter id="grain" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse">
  <feTurbulence type="fractalNoise" baseFrequency="0.7 1.15" numOctaves="2" seed="7" stitchTiles="stitch" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 ${grainTint.split(" ")[0]}  0 0 0 0 ${grainTint.split(" ")[1]}  0 0 0 0 ${grainTint.split(" ")[2]}  0 0 0 ${(grainAlpha * 9).toFixed(2)} -${(grainAlpha * 3.6).toFixed(3)}"/>
</filter>`);
  d.push(`<filter id="mottle" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse">
  <feTurbulence type="fractalNoise" baseFrequency="0.004 0.009" numOctaves="2" seed="3" result="m"/>
  <feColorMatrix in="m" type="matrix" values="0 0 0 0 ${grainTint.split(" ")[0]}  0 0 0 0 ${grainTint.split(" ")[1]}  0 0 0 0 ${grainTint.split(" ")[2]}  0 0 0 ${fk === "washi" ? "0.22" : "0.14"} -0.06"/>
</filter>`);
  return `<defs>${d.join("\n")}</defs>`;
}

function fibers(fk) {
  // sparse long fibers: kozo strands caught in the sheet
  const col = fk === "washi" ? "#8f7a55" : "#e9dfc7";
  const op = fk === "washi" ? 0.16 : 0.09;
  const out = [];
  for (let i = 0; i < 46; i++) {
    const k = "fiber" + i;
    const x = hash(k + "x") * W, y = hash(k + "y") * H;
    const len = 60 + hash(k + "l") * 190;
    const ang = (hash(k + "a") - 0.5) * 1.4;
    const bend = (hash(k + "b") - 0.5) * 40;
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    const mx = (x + x2) / 2 - Math.sin(ang) * bend, my = (y + y2) / 2 + Math.cos(ang) * bend;
    const w = 0.35 + hash(k + "w") * 0.5;
    out.push(`<path d="M${f1(x)},${f1(y)} Q${f1(mx)},${f1(my)} ${f1(x2)},${f1(y2)}" stroke-width="${f2(w)}" stroke-opacity="${f2(op * (0.5 + hash(k + "o")))}"/>`);
  }
  return `<g fill="none" stroke="${col}" stroke-linecap="round">${out.join("")}</g>`;
}

function sealRing(cx, cy, r, underlay) {
  // a stamped seal: slightly irregular radius, uneven ink, one dry break
  const pts = [];
  const N = 72;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const rr = r * (1 + 0.018 * Math.sin(3 * a + 0.7) + 0.01 * Math.sin(7 * a + 2.1) + 0.006 * Math.sin(13 * a));
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  const d = "M" + pts.map((p) => `${f1(p[0])},${f1(p[1])}`).join("L") + "Z";
  const circ = 2 * Math.PI * r;
  // On the dark field the seal prints over a pale paper underlay, so the
  // vermilion keeps its read against aizuri blue.
  const under = underlay ? `<path d="${d}" stroke="${underlay}" stroke-width="4" stroke-opacity="0.5"/>` : "";
  return `<g fill="none" stroke="${SEAL}" stroke-linejoin="round">${under}
<path d="${d}" stroke-width="2" stroke-opacity="0.92" stroke-dasharray="${f1(circ * 0.62)} ${f1(circ * 0.025)} ${f1(circ * 0.33)} ${f1(circ * 0.025)}" stroke-dashoffset="${f1(circ * 0.2)}"/>
<path d="${d}" stroke-width="1" stroke-opacity="0.45" transform="translate(0.5 -0.4)"/>
</g>`;
}

function legend(fk, F) {
  const ink = F.sumi;
  const x = W - 470, y = H - 104;
  const out = [`<g font-family="'Hiragino Mincho ProN', 'Yu Mincho', Georgia, serif" fill="${ink}">`];
  out.push(`<text x="${x}" y="${y}" font-size="12" letter-spacing="0.14em" fill-opacity="0.8">PIGMENTS · CONTRAST ON ${F.mid.toUpperCase()}</text>`);
  STRANDS.forEach((s, i) => {
    const cx = x + (i % 2) * 230, cy = y + 26 + Math.floor(i / 2) * 30;
    out.push(`<circle cx="${cx + 8}" cy="${cy}" r="8" fill="url(#bk-${s})" stroke="${ink}" stroke-width="0.9"/>`);
    out.push(`<text x="${cx + 24}" y="${cy + 4.5}" font-size="13.5">${STRAND_LABEL[s]}  <tspan font-family="ui-monospace, Menlo, monospace" font-size="11.5" fill-opacity="0.78">${F.pigment[s]}  ${RATIOS[fk][s].toFixed(2)}:1</tspan></text>`);
  });
  out.push(`</g>`);
  return out.join("\n");
}

function sheet(fk, focused) {
  const F = FIELDS[fk];
  const sheetName = `Hanga · ${F.name} · ${focused ? `Focus ${FOCUS_CODE}` : "Overview"}`;
  const el = [];

  // field
  if (fk === "washi") {
    el.push(`<rect width="${W}" height="${H}" fill="${F.paper}"/>`);
    el.push(`<rect width="${W}" height="${H}" filter="url(#mottle)"/>`);
    el.push(`<rect width="${W}" height="${H}" fill="url(#sky)"/>`);
    el.push(`<rect width="${W}" height="${H}" fill="url(#horizon)"/>`);
  } else {
    el.push(`<rect width="${W}" height="${H}" fill="url(#sky)"/>`);
    el.push(`<rect width="${W}" height="${H}" filter="url(#mottle)"/>`);
    el.push(`<rect width="${W}" height="${H}" fill="url(#horizon)"/>`);
  }
  el.push(`<rect width="${W}" height="${H}" filter="url(#grain)"/>`);
  el.push(fibers(fk));

  const faint = 0.12;
  const sumi = F.sumi;

  // related pairs, under everything
  for (const e of related) {
    if (focused && !edgeLit(e)) el.push(dabRow(e, sumi, faint * 0.8));
    else el.push(dabRow(e, sumi, focused ? 0.5 : 0.32));
  }

  // prerequisite strokes, far to near by control-point depth
  const edges = [...prereq].sort((x, y) => x.c[2] - y.c[2]);
  const litEdges = [];
  for (const e of edges) {
    if (focused) {
      if (edgeLit(e)) litEdges.push(e);
      else el.push(brushStroke(e, sumi, faint, 1));
    } else {
      el.push(brushStroke(e, F.pigment[byId.get(e.s).strand], 0.8, 1));
    }
  }

  // nodes, far to near
  const nodes = [...g.nodes].sort((x, y) => x.pos[2] - y.pos[2]);
  const drawNode = (n, dim) => {
    const [x, y] = P.get(n.id);
    const r = nodeR(n);
    if (dim) {
      return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f2(r)}" fill="${sumi}" fill-opacity="${faint * 0.5}" stroke="${sumi}" stroke-opacity="${faint * 1.5}" stroke-width="0.8"/>`;
    }
    if (n.deg === 0) {
      const fill = fk === "washi" ? "#f6efdf" : "#e6dcc6";
      const fo = fk === "washi" ? 1 : 0.22;
      return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f2(r)}" fill="${fill}" fill-opacity="${fo}" stroke="${sumi}" stroke-width="0.8" stroke-opacity="${fk === "washi" ? 0.75 : 0.6}"/>`;
    }
    return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f2(r)}" fill="url(#bk-${n.strand})" stroke="${sumi}" stroke-width="${focused ? 1.05 : 0.85}"/>`;
  };
  if (focused) {
    for (const n of nodes) if (!lit.has(n.id)) el.push(drawNode(n, true));
    for (const e of litEdges) el.push(brushStroke(e, F.pigment[byId.get(e.s).strand], 0.92, 1.6));
    for (const n of nodes) if (lit.has(n.id)) el.push(drawNode(n, false));
    const [fx, fy] = P.get(focus.id);
    const fr = nodeR(focus);
    // the seal encloses the focused disc and the sub-standard discs stacked
    // on it (4.NF.B.3.a-.c sit within a few px; .d sits apart and stays out)
    let ringR = fr + 7;
    for (const id of family) {
      const q = P.get(id);
      const dd = Math.hypot(q[0] - fx, q[1] - fy);
      if (dd < 2 * fr) ringR = Math.max(ringR, dd + nodeR(byId.get(id)) + 5);
    }
    el.push(sealRing(fx, fy, ringR, fk === "dusk" ? "#ece3cf" : null));
    const halo = fk === "washi" ? F.paper : "#1a2c4c";
    el.push(`<text x="${f1(fx + ringR * 0.72 + 6)}" y="${f1(fy - ringR * 0.72 - 4)}" font-family="'Hiragino Mincho ProN', 'Yu Mincho', Georgia, serif" font-size="16" letter-spacing="0.06em" fill="${sumi}" stroke="${halo}" stroke-width="4" stroke-opacity="0.85" stroke-linejoin="round" paint-order="stroke">${FOCUS_CODE}</text>`);
  } else {
    for (const n of nodes) el.push(drawNode(n, false));
  }

  // caption, bottom left
  el.push(`<g font-family="'Hiragino Mincho ProN', 'Yu Mincho', Georgia, serif" fill="${sumi}">
<text x="40" y="${H - 58}" font-size="16" letter-spacing="0.1em">${sheetName}</text>
<text x="40" y="${H - 34}" font-size="13" letter-spacing="0.06em" fill-opacity="0.78">After Wada Sanzo, Oda Kazuma, and Utagawa Hiroshige</text>
</g>`);
  el.push(legend(fk, F));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-dense-crop="${dense.x},${dense.y}">
<title>${sheetName}</title>
${defs(fk, F)}
${el.join("\n")}
</svg>
`;
}

const outputs = [
  ["hanga-washi-overview.svg", "washi", false],
  ["hanga-washi-focus.svg", "washi", true],
  ["hanga-dusk-overview.svg", "dusk", false],
  ["hanga-dusk-focus.svg", "dusk", true],
];
for (const [file, fk, focused] of outputs) {
  writeFileSync(resolve(OUT, file), sheet(fk, focused));
  console.log(`wrote docs/previews/${file}`);
}
console.log(`densest 800x500 region: x=${dense.x} y=${dense.y} (${dense.n} standards)`);
