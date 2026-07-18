// HS macro-form preview (design exploration, NOT a build step) — Mark's
// round-8 question: keep the A1/G/A2/ADV course columns, or fold high school
// back into ONE band stratified by progression (within-HS prerequisite build
// depth)? Renders both from real data, side by side, dark-app styling.
// Deterministic: no randomness. Reads public/data/graph-core.json; writes
// docs/previews/hs-courses-vs-progression.svg.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = resolve(ROOT, "docs/previews");
mkdirSync(OUT, { recursive: true });

const g = JSON.parse(readFileSync(resolve(ROOT, "public/data/graph-core.json"), "utf8"));
const STRAND = { number: "#e8b34b", algebra: "#9a7df0", geometry: "#4dc8c0", data: "#e87a9b" };
const BG = "#0a0a16";
const INK = "#b8b4d8";

const hs = g.nodes.filter((n) => n.grade === "HS");
const hsIds = new Set(hs.map((n) => n.id));
const byId = new Map(g.nodes.map((n) => [n.id, n]));

// Within-HS build depth: longest chain over HS→HS prereq edges only.
const preds = new Map(hs.map((n) => [n.id, []]));
const hsEdges = [];
for (const e of g.edges) {
  if (e.k !== 0 || !hsIds.has(e.t)) continue;
  if (hsIds.has(e.s)) {
    preds.get(e.t).push(e.s);
    hsEdges.push(e);
  }
}
const depth = new Map();
const compute = (id) => {
  if (depth.has(id)) return depth.get(id);
  depth.set(id, 0); // cycle guard (DAG, but safe)
  const d = preds.get(id).length ? Math.max(...preds.get(id).map((p) => compute(p) + 1)) : 0;
  depth.set(id, d);
  return d;
};
for (const n of hs) compute(n.id);

const W = 2100;
const H = 1150;
const PANEL_W = 990;
const el = [];

function panelLabel(x, text, sub) {
  el.push(`<text x="${x}" y="64" font-family="ui-monospace, monospace" font-size="21" fill="#e8e6f6" letter-spacing="0.06em">${text}</text>`);
  el.push(`<text x="${x}" y="90" font-family="ui-monospace, monospace" font-size="13.5" fill="${INK}" letter-spacing="0.04em">${sub}</text>`);
}

// ---- Panel A: current Blueprint course columns (pos3 of HS nodes) ---------
{
  const X0 = 60;
  const pts = hs.map((n) => n.pos3);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const s = Math.min((PANEL_W - 90) / (x1 - x0), (H - 240) / (y1 - y0));
  const T = ([x, y]) => [X0 + 30 + (x - x0) * s, 150 + (y1 - y) * s];
  const pos = new Map(hs.map((n) => [n.id, T(n.pos3)]));
  for (const e of hsEdges) {
    const a = pos.get(e.s), b = pos.get(e.t);
    el.push(`<path d="M${a[0].toFixed(1)},${a[1].toFixed(1)} C${a[0].toFixed(1)},${((a[1] + b[1]) / 2).toFixed(1)} ${b[0].toFixed(1)},${((a[1] + b[1]) / 2).toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}" fill="none" stroke="#5a5490" stroke-opacity="0.35" stroke-width="1"/>`);
  }
  for (const n of hs) {
    const p = pos.get(n.id);
    const r = 4 + Math.sqrt(n.deg) * 1.4;
    el.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${r.toFixed(1)}" fill="${STRAND[n.strand]}" fill-opacity="0.92"/>`);
    if (n.wap) el.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${(r + 3).toFixed(1)}" fill="none" stroke="#ffd27a" stroke-width="1.2" stroke-opacity="0.8"/>`);
  }
  // Course labels under their columns (approx: mean x of members).
  const courseX = new Map();
  for (const n of hs) {
    const c = n.courses[0];
    if (!courseX.has(c)) courseX.set(c, []);
    courseX.get(c).push(pos.get(n.id)[0]);
  }
  const NAMES = { A1: "ALGEBRA I", G: "GEOMETRY", A2: "ALGEBRA II", ADV: "ADVANCED" };
  for (const [c, xs] of courseX) {
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    el.push(`<text x="${mx.toFixed(0)}" y="${H - 92}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="15" fill="${INK}" letter-spacing="0.14em">${NAMES[c]}</text>`);
  }
  panelLabel(X0, "A · TODAY: COURSE COLUMNS", "Appendix A traditional pathway · A1 69 · G 52 · A2 26 · ADV 16 · gold ring = widely applicable prerequisite");
}

// ---- Panel B: combined HS, stratified by within-HS build depth ------------
{
  const X0 = 60 + PANEL_W + 60;
  const LAYER_W = (PANEL_W - 60) / 12;
  // Stack each layer sorted by strand then code; y spacing even per column.
  const layers = Array.from({ length: 12 }, () => []);
  for (const n of hs) layers[Math.min(11, depth.get(n.id))].push(n);
  const strandOrder = { number: 0, algebra: 1, geometry: 2, data: 3 };
  for (const layer of layers)
    layer.sort((a, b) => strandOrder[a.strand] - strandOrder[b.strand] || (a.code < b.code ? -1 : 1));
  const pos = new Map();
  layers.forEach((layer, li) => {
    const x = X0 + 30 + li * LAYER_W + LAYER_W / 2;
    const gap = Math.min(15.5, (H - 300) / Math.max(1, layer.length));
    const top = 170 + (H - 300 - gap * (layer.length - 1)) / 2;
    layer.forEach((n, k) => pos.set(n.id, [x, top + k * gap]));
  });
  for (const e of hsEdges) {
    const a = pos.get(e.s), b = pos.get(e.t);
    const mx = (a[0] + b[0]) / 2;
    el.push(`<path d="M${a[0].toFixed(1)},${a[1].toFixed(1)} C${mx.toFixed(1)},${a[1].toFixed(1)} ${mx.toFixed(1)},${b[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}" fill="none" stroke="#6f68b0" stroke-opacity="0.42" stroke-width="1.1"/>`);
  }
  for (const n of hs) {
    const p = pos.get(n.id);
    const r = 4 + Math.sqrt(n.deg) * 1.4;
    el.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${r.toFixed(1)}" fill="${STRAND[n.strand]}" fill-opacity="0.92"/>`);
    if (n.wap) el.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${(r + 3).toFixed(1)}" fill="none" stroke="#ffd27a" stroke-width="1.2" stroke-opacity="0.8"/>`);
  }
  for (let li = 0; li < 12; li++) {
    const x = X0 + 30 + li * LAYER_W + LAYER_W / 2;
    el.push(`<text x="${x.toFixed(0)}" y="${H - 92}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="13" fill="${INK}" letter-spacing="0.08em">${li}</text>`);
  }
  el.push(`<text x="${X0 + 30 + PANEL_W / 2 - 30}" y="${H - 66}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="13.5" fill="${INK}" letter-spacing="0.1em">STEPS OF BUILD WITHIN HIGH SCHOOL (longest prerequisite chain)</text>`);
  panelLabel(X0, "B · ALTERNATIVE: ONE HS BAND, STRATIFIED BY PROGRESSION", "x = within-HS prerequisite depth (12 layers) · 176 internal edges flow left to right · entry layer 55 standards");
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${BG}"/>
<line x1="${60 + PANEL_W + 30}" y1="40" x2="${60 + PANEL_W + 30}" y2="${H - 40}" stroke="#2a2848" stroke-width="1"/>
${el.join("\n")}
<text x="60" y="${H - 26}" font-family="ui-monospace, monospace" font-size="13" fill="#7a76a8" letter-spacing="0.05em">163 high-school standards · real data, deterministic · CCSS itself assigns no courses: conceptual categories are the standards' own structure; Appendix A is one published pathway model</text>
</svg>`;

writeFileSync(resolve(OUT, "hs-courses-vs-progression.svg"), svg);
console.log("wrote docs/previews/hs-courses-vs-progression.svg");
