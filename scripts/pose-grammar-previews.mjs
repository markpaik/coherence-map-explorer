// Pose-grammar previews (design exploration, NOT a build step).
//
// Round 10 (Mark): the in-app Transit and Blueprint poses carry the right
// STRUCTURE but not the GRAMMAR — "these should be strikingly reminiscent of
// the concept they try to model." These previews render the ACTUAL in-app pose
// geometry (pos4 / pos3 from public/data/graph-core.json — not a re-derivation)
// under the proposed visual grammar, so what Mark approves is exactly what the
// build will produce.
//
//   TRANSIT FRONT — pos4 front-on with true metro grammar: constant-width
//     opaque lines, straight runs with TIGHT rounded corners (not the current
//     soft bezier swoop), stations as pale discs with a wraparound line-colour
//     border (the approved formation-transit mark), true multi-line interchange
//     capsules, family lozenges, dashed walking-transfer links for related
//     pairs (authentic metro grammar for out-of-system connections).
//   TRANSIT SIDE — the same city from a side orbit with the z-decks pushed
//     from ±16/±6 to ±90/±30 ("much further apart — a side view shows you the
//     interwebs"): four labelled decks, banked ramps weaving between them.
//   BLUEPRINT SHEET — pos3 as a literal cyanotype: Prussian-blue sheet with
//     uneven exposure, drafting grid, double border frame, corner registers,
//     title block, white-ink linework, nodes as drafted circles + crosshairs,
//     related pairs as dashed construction lines, grade dimension line.
//
// Deterministic: no Math.random / Date. Reads public/data/graph-core.json;
// writes docs/previews/{transit-pose-front,transit-pose-side,blueprint-pose-sheet}.svg.
// Nothing imports this file.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = resolve(ROOT, "docs/previews");
mkdirSync(OUT, { recursive: true });

const g = JSON.parse(readFileSync(resolve(ROOT, "public/data/graph-core.json"), "utf8"));
const byId = new Map(g.nodes.map((n) => [n.id, n]));

// ---- dark-app palette (docs/DESIGN.md) ------------------------------------
const BG = "#0a0a16";
const INK = "#b8b4d8";
const STRAND = { number: "#e8b34b", algebra: "#9a7df0", geometry: "#4dc8c0", data: "#e87a9b" };
const STRAND_ORDER = ["number", "algebra", "geometry", "data"];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mixHex = (h1, h2, t) => {
  const a = parseInt(h1.slice(1), 16);
  const b = parseInt(h2.slice(1), 16);
  const ch = (sh) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
};
const f = (v) => v.toFixed(1);

// ---- families & reach (as formation-previews.mjs) --------------------------
const families = g.nodes.filter((n) => n.children && n.children.length);
const childOf = new Map();
for (const p of families) for (const c of p.children) childOf.set(c, p.id);
const isChild = (id) => childOf.has(id);

const N = g.nodes.length;
const index = new Map(g.nodes.map((n, i) => [n.id, i]));
const kids = Array.from({ length: N }, () => []);
for (const e of g.edges) if (e.k === 0) kids[index.get(e.s)].push(index.get(e.t));
const reachArr = new Int32Array(N);
for (let v = 0; v < N; v++) {
  const seen = new Uint8Array(N);
  seen[v] = 1;
  const stack = [v];
  let c = 0;
  while (stack.length) {
    const x = stack.pop();
    for (const k of kids[x]) if (!seen[k]) { seen[k] = 1; c++; stack.push(k); }
  }
  reachArr[v] = c;
}
const reach = (id) => reachArr[index.get(id)];
let MAXREACH = 1;
for (let v = 0; v < N; v++) if (reachArr[v] > MAXREACH) MAXREACH = reachArr[v];

const prereq = g.edges.filter((e) => e.k === 0);
const related = g.edges.filter((e) => e.k === 1);
const crossStrand = (e) => byId.get(e.s).strand !== byId.get(e.t).strand;

// interchange floor: same rule the pipeline uses (≥3 cross-strand prereqs)
const xCount = new Map(g.nodes.map((n) => [n.id, 0]));
const linesAt = new Map(g.nodes.map((n) => [n.id, new Set([n.strand])]));
for (const e of prereq) {
  if (!crossStrand(e)) continue;
  xCount.set(e.s, xCount.get(e.s) + 1);
  xCount.set(e.t, xCount.get(e.t) + 1);
  linesAt.get(e.s).add(byId.get(e.t).strand);
  linesAt.get(e.t).add(byId.get(e.s).strand);
}
const isInterchange = (id) => xCount.get(id) >= 3 && !isChild(id);
const strandRank = new Map(STRAND_ORDER.map((s, i) => [s, i]));

const svg = (w, h, el, note, bg = BG) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<rect width="${w}" height="${h}" fill="${bg}"/>
${el.join("\n")}
<text x="28" y="${h - 18}" font-family="ui-monospace, monospace" font-size="10.5" fill="#6a678a">${note}</text>
</svg>`;

// ===========================================================================
// SHARED: fit pos-space points into the canvas
function fitter(pts, W, H, margin) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const s = Math.min((W - 2 * margin) / (x1 - x0), (H - 2 * margin) / (y1 - y0));
  const ox = (W - s * (x1 - x0)) / 2 - s * x0;
  const oy = (H - s * (y1 - y0)) / 2 - s * y0;
  return { s, map: ([x, y]) => [x * s + ox, y * s + oy] };
}

// Tight rounded corner through elbow E: straight run, small quadratic knuckle,
// straight run — the metro turn (vs the current single wide bezier swoop).
function elbowPath(A, E, B, project, dMax = 9) {
  const seg = (P, Q) => Math.hypot(Q[0] - P[0], Q[1] - P[1], (Q[2] ?? 0) - (P[2] ?? 0));
  const lerp3 = (P, Q, t) => [P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t, (P[2] ?? 0) + ((Q[2] ?? 0) - (P[2] ?? 0)) * t];
  const la = seg(A, E), lb = seg(E, B);
  if (la < 1e-3 || lb < 1e-3) {
    const [ax, ay] = project(A), [bx, by] = project(B);
    return `M${f(ax)} ${f(ay)}L${f(bx)} ${f(by)}`;
  }
  const d = Math.min(dMax, 0.42 * la, 0.42 * lb);
  const P1 = lerp3(A, E, 1 - d / la);
  const P2 = lerp3(E, B, d / lb);
  const [ax, ay] = project(A), [p1x, p1y] = project(P1), [ex, ey] = project(E), [p2x, p2y] = project(P2), [bx, by] = project(B);
  return `M${f(ax)} ${f(ay)}L${f(p1x)} ${f(p1y)}Q${f(ex)} ${f(ey)} ${f(p2x)} ${f(p2y)}L${f(bx)} ${f(by)}`;
}

// ===========================================================================
// 1. TRANSIT FRONT — pos4 front-on under true metro grammar
function transitFront() {
  const W = 1600, H = 1000;
  const el = [];
  const { map } = fitter(g.nodes.map((n) => [n.pos4[0], -n.pos4[1]]), W, H, 70);
  const P = (id) => map([byId.get(id).pos4[0], -byId.get(id).pos4[1]]);
  const proj2 = (p3) => map([p3[0], -p3[1]]);

  // walking-transfer links (related pairs): dashed, beneath everything
  for (const e of related) {
    const A = byId.get(e.s).pos4, B = byId.get(e.t).pos4;
    el.push(`<path d="${elbowPath(A, [e.c4[0], e.c4[1], 0], B, proj2)}" fill="none" stroke="#8884a8" stroke-width="0.9" stroke-opacity="0.32" stroke-dasharray="3 4"/>`);
  }
  // prereq runs: cross-strand transfers first (thinner), then same-line by width
  const runs = prereq.map((e) => {
    const s = byId.get(e.s), t = byId.get(e.t);
    const cross = s.strand !== t.strand;
    const w = cross ? 1.6 : 1.7 + 4.2 * Math.sqrt(reach(e.s) / MAXREACH);
    return { e, s, w, cross };
  }).sort((a, b) => (a.cross === b.cross ? a.w - b.w : a.cross ? -1 : 1));
  for (const { e, s, w, cross } of runs) {
    const A = s.pos4, B = byId.get(e.t).pos4;
    el.push(`<path d="${elbowPath(A, [e.c4[0], e.c4[1], 0], B, proj2)}" fill="none" stroke="${STRAND[s.strand]}" stroke-width="${f(w)}" stroke-opacity="${cross ? "0.72" : "0.95"}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }

  // stations — the approved wraparound-border mark
  const familyIds = new Set(families.map((p) => p.id));
  for (const n of g.nodes) {
    if (isChild(n.id) || familyIds.has(n.id) || isInterchange(n.id)) continue;
    const [x, y] = P(n.id);
    el.push(`<circle cx="${f(x)}" cy="${f(y)}" r="3.1" fill="#f4f2fb" stroke="${STRAND[n.strand]}" stroke-width="1.7"/>`);
  }
  // families: one elongated lozenge enclosing the child row; child tick marks inside
  for (const p of families) {
    const members = [p.id, ...p.children];
    const pts = members.map((id) => P(id));
    let x0 = Infinity, x1 = -Infinity, yc = 0;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); yc += y / pts.length; }
    const h = 9;
    el.push(`<rect x="${f(x0 - 7)}" y="${f(yc - h / 2)}" width="${f(x1 - x0 + 14)}" height="${f(h)}" rx="${f(h / 2)}" fill="${BG}" fill-opacity="0.85" stroke="${STRAND[p.strand]}" stroke-width="1.7" stroke-opacity="0.95"/>`);
    el.push(`<circle cx="${f(pts[0][0])}" cy="${f(yc)}" r="2.4" fill="${STRAND[p.strand]}"/>`);
    for (let i = 1; i < pts.length; i++)
      el.push(`<circle cx="${f(pts[i][0])}" cy="${f(yc)}" r="1.1" fill="${STRAND[p.strand]}" fill-opacity="0.8"/>`);
  }
  // true multi-line interchanges: capsule, one dot per line
  for (const n of g.nodes) {
    if (!isInterchange(n.id) || familyIds.has(n.id)) continue;
    const [x, y] = P(n.id);
    const lines = [...linesAt.get(n.id)].sort((a, b) => strandRank.get(a) - strandRank.get(b));
    const R = 3.4 + Math.sqrt(reach(n.id) / MAXREACH) * 3.6;
    const gap = R * 1.15;
    const total = (lines.length - 1) * gap;
    const capW = R + total / 2 + 4, capH = R + 4;
    el.push(`<rect x="${f(x - capW)}" y="${f(y - capH)}" width="${f(capW * 2)}" height="${f(capH * 2)}" rx="${f(capH)}" fill="#0a0a16" fill-opacity="0.92" stroke="#d8d4f0" stroke-width="1.6" stroke-opacity="0.92"/>`);
    lines.forEach((ls, i) =>
      el.push(`<circle cx="${f(x - total / 2 + i * gap)}" cy="${f(y)}" r="${f(R * 0.6)}" fill="${STRAND[ls]}"/>`));
  }

  // grade baseline
  const COLS = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "A1", "G", "A2", "ADV"];
  const colX = new Map();
  for (const gr of g.grades) if (gr.marker4) colX.set(gr.id, gr.marker4[0]);
  for (const c of g.courses) if (c.marker4) colX.set(c.id, c.marker4[0]);
  let yBase = 0;
  for (const n of g.nodes) yBase = Math.max(yBase, map([n.pos4[0], -n.pos4[1]])[1]);
  for (const cid of COLS) {
    if (!colX.has(cid)) continue;
    const [x] = map([colX.get(cid), 0]);
    el.push(`<text x="${f(x)}" y="${f(yBase + 34)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="13" fill="#7a76a0" letter-spacing="0.1em">${cid}</text>`);
  }

  // legend + title
  let lx = 1090;
  for (const s of STRAND_ORDER) {
    el.push(`<line x1="${f(lx)}" y1="58" x2="${f(lx + 24)}" y2="58" stroke="${STRAND[s]}" stroke-width="5" stroke-linecap="round"/>`);
    el.push(`<text x="${f(lx + 31)}" y="62" font-family="ui-monospace, monospace" font-size="12" fill="${INK}" letter-spacing="0.05em">${s.toUpperCase()}</text>`);
    lx += 92 + s.length * 7.5;
  }
  el.push(`<text x="28" y="48" font-family="ui-monospace, monospace" font-size="20" fill="#e8e6f6" letter-spacing="0.06em">TRANSIT · FRONT · the in-app pose under true metro grammar</text>`);
  el.push(`<text x="28" y="70" font-family="ui-monospace, monospace" font-size="11.5" fill="#8a86ac">straight runs, tight rounded turns · wraparound-border stations · interchange capsules · dashed walking transfers (related pairs)</text>`);

  return svg(W, H, el,
    "GEOMETRY = the shipped pos4 exactly (no re-derivation). GRAMMAR replaces the current render: constant-width opaque lines with tight rounded corners instead of soft bezier swoops · station = pale disc with wraparound line-colour border · ≥3 cross-strand prereqs = multi-line interchange capsule · family = one lozenge, children as interior ticks (still pickable in-app) · related pairs = dashed walking transfers · 480 standards, deterministic");
}

// ===========================================================================
// 2. TRANSIT SIDE — decks pushed to ±90/±30, side orbit, ramps weaving
function transitSide() {
  const W = 1600, H = 1000;
  const el = [];
  const ZMAP = { 16: 90, 6: 30, "-6": -30, "-16": -90 };
  const DECK = [
    { strand: "number", z: 90, label: "NUMBER · ELEVATED +90" },
    { strand: "algebra", z: 30, label: "ALGEBRA · UPPER +30" },
    { strand: "geometry", z: -30, label: "GEOMETRY · LOWER −30" },
    { strand: "data", z: -90, label: "DATA · DEEP −90" },
  ];
  const zOf = (id) => ZMAP[byId.get(id).pos4[2]];

  // orbit: azimuth 44° about y, pitch 17° — three-quarter enough that the
  // decks separate AND the banked ramps between them stay readable
  const th = (44 * Math.PI) / 180, ph = (17 * Math.PI) / 180;
  const rot = ([x, y, z]) => {
    const x1 = x * Math.cos(th) + z * Math.sin(th);
    const z1 = -x * Math.sin(th) + z * Math.cos(th);
    const y2 = y * Math.cos(ph) - z1 * Math.sin(ph);
    const dep = y * Math.sin(ph) + z1 * Math.cos(ph);
    return [x1, -y2, dep];
  };
  // deck plane extents (also included in the fit so plane corners never crop)
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (const n of g.nodes) {
    bx0 = Math.min(bx0, n.pos4[0]); bx1 = Math.max(bx1, n.pos4[0]);
    by0 = Math.min(by0, n.pos4[1]); by1 = Math.max(by1, n.pos4[1]);
  }
  const deckCorners = DECK.flatMap((d) =>
    [[bx0 - 30, by0 - 20, d.z], [bx1 + 30, by0 - 20, d.z], [bx1 + 30, by1 + 20, d.z], [bx0 - 30, by1 + 20, d.z]]);
  const fitPts = [...g.nodes.map((n) => rot([n.pos4[0], n.pos4[1], zOf(n.id)])), ...deckCorners.map(rot)];
  const { map } = fitter(fitPts.map(([x, y]) => [x, y]), W, H, 80);
  const proj = (p3) => { const r = rot(p3); return map([r[0], r[1]]); };
  const depOf = (p3) => rot(p3)[2];

  // deck planes (far first), quiet; labels live in a fixed legend column so
  // they never collide with the geometry
  const decks = DECK.map((d) => {
    const corners = [[bx0 - 30, by0 - 20, d.z], [bx1 + 30, by0 - 20, d.z], [bx1 + 30, by1 + 20, d.z], [bx0 - 30, by1 + 20, d.z]];
    return { ...d, corners, dep: depOf([0, 0, d.z]) };
  }).sort((a, b) => a.dep - b.dep);
  for (const d of decks) {
    const pts = d.corners.map((c) => proj(c).map(f).join(",")).join(" ");
    el.push(`<polygon points="${pts}" fill="${STRAND[d.strand]}" fill-opacity="0.03" stroke="${STRAND[d.strand]}" stroke-opacity="0.14" stroke-width="1"/>`);
  }
  DECK.forEach((d, i) => {
    const ly = 104 + i * 22;
    el.push(`<line x1="30" y1="${f(ly - 4)}" x2="52" y2="${f(ly - 4)}" stroke="${STRAND[d.strand]}" stroke-width="5" stroke-linecap="round"/>`);
    el.push(`<text x="60" y="${f(ly)}" font-family="ui-monospace, monospace" font-size="12" fill="${mixHex(STRAND[d.strand], "#ffffff", 0.25)}" letter-spacing="0.08em">${d.label}</text>`);
  });

  // edges in 3D, painter-sorted; banked ramps (cross-strand) weave between decks
  const drawables = [];
  for (const e of related) {
    const s = byId.get(e.s), t = byId.get(e.t);
    const A = [s.pos4[0], s.pos4[1], zOf(e.s)], B = [t.pos4[0], t.pos4[1], zOf(e.t)];
    const E = [e.c4[0], e.c4[1], (A[2] + B[2]) / 2];
    drawables.push({ dep: (depOf(A) + depOf(B)) / 2, tag: `<path d="${elbowPath(A, E, B, proj, 9)}" fill="none" stroke="#8884a8" stroke-width="0.8" stroke-opacity="0.22" stroke-dasharray="3 4"/>` });
  }
  for (const e of prereq) {
    const s = byId.get(e.s), t = byId.get(e.t);
    const cross = s.strand !== t.strand;
    const A = [s.pos4[0], s.pos4[1], zOf(e.s)], B = [t.pos4[0], t.pos4[1], zOf(e.t)];
    const E = [e.c4[0], e.c4[1], (A[2] + B[2]) / 2];
    const w = cross ? 1.5 : 1.5 + 3.6 * Math.sqrt(reach(e.s) / MAXREACH);
    drawables.push({ dep: (depOf(A) + depOf(B)) / 2, tag: `<path d="${elbowPath(A, E, B, proj, 9)}" fill="none" stroke="${STRAND[s.strand]}" stroke-width="${f(w)}" stroke-opacity="${cross ? "0.62" : "0.9"}" stroke-linecap="round" stroke-linejoin="round"/>` });
  }
  // stations as billboard rings (children as small dots)
  for (const n of g.nodes) {
    const p3 = [n.pos4[0], n.pos4[1], zOf(n.id)];
    const [x, y] = proj(p3);
    const tag = isChild(n.id)
      ? `<circle cx="${f(x)}" cy="${f(y)}" r="1.2" fill="${STRAND[n.strand]}" fill-opacity="0.75"/>`
      : isInterchange(n.id)
        ? `<circle cx="${f(x)}" cy="${f(y)}" r="4.4" fill="#0a0a16" stroke="#d8d4f0" stroke-width="1.6"/><circle cx="${f(x)}" cy="${f(y)}" r="1.9" fill="${STRAND[n.strand]}"/>`
        : `<circle cx="${f(x)}" cy="${f(y)}" r="2.5" fill="#f4f2fb" fill-opacity="0.95" stroke="${STRAND[n.strand]}" stroke-width="1.4"/>`;
    drawables.push({ dep: depOf(p3) + 0.5, tag });
  }
  drawables.sort((a, b) => a.dep - b.dep);
  el.push(...drawables.map((d) => d.tag));

  el.push(`<text x="28" y="48" font-family="ui-monospace, monospace" font-size="20" fill="#e8e6f6" letter-spacing="0.06em">TRANSIT · SIDE ORBIT · decks pushed apart (±90 / ±30, was ±16 / ±6)</text>`);
  el.push(`<text x="28" y="70" font-family="ui-monospace, monospace" font-size="11.5" fill="#8a86ac">each line runs its own deck · cross-strand transfers bank between decks · the interwebs read from the side · front-on still collapses flat</text>`);

  return svg(W, H, el,
    "GEOMETRY = shipped pos4 with only the z-levels widened (number +90 / algebra +30 / geometry −30 / data −90; banked elbow z = endpoint midpoint, as the pipeline already computes) · azimuth 58°, pitch 13°, orthographic, painter-sorted · deck planes are a preview aid · in-app the decks read from the lines themselves · 480 standards, deterministic");
}

// ===========================================================================
// 3. BLUEPRINT SHEET — pos3 as a literal cyanotype
function blueprintSheet() {
  const W = 1600, H = 1000;
  const el = [];
  const SHEET = { x: 40, y: 40, w: W - 80, h: H - 80 };
  const PRUSSIAN = "#123a63";
  const WASH = "#1a4a7a";
  const INKW = "#eaf2ff"; // white drafting ink

  // sheet with uneven exposure (two soft radial washes — cyanotype character)
  el.push(`<defs>
  <radialGradient id="wash1" cx="0.3" cy="0.28" r="0.7"><stop offset="0" stop-color="${WASH}" stop-opacity="0.55"/><stop offset="1" stop-color="${WASH}" stop-opacity="0"/></radialGradient>
  <radialGradient id="wash2" cx="0.78" cy="0.75" r="0.6"><stop offset="0" stop-color="#0d2c4e" stop-opacity="0.6"/><stop offset="1" stop-color="#0d2c4e" stop-opacity="0"/></radialGradient>
</defs>`);
  el.push(`<rect x="${SHEET.x}" y="${SHEET.y}" width="${SHEET.w}" height="${SHEET.h}" fill="${PRUSSIAN}"/>`);
  el.push(`<rect x="${SHEET.x}" y="${SHEET.y}" width="${SHEET.w}" height="${SHEET.h}" fill="url(#wash1)"/>`);
  el.push(`<rect x="${SHEET.x}" y="${SHEET.y}" width="${SHEET.w}" height="${SHEET.h}" fill="url(#wash2)"/>`);

  // drafting grid: minor 16px / major 80px
  const grid = [];
  for (let x = SHEET.x; x <= SHEET.x + SHEET.w; x += 16) {
    const major = Math.round((x - SHEET.x) / 16) % 5 === 0;
    grid.push(`<line x1="${x}" y1="${SHEET.y}" x2="${x}" y2="${SHEET.y + SHEET.h}" stroke="${INKW}" stroke-opacity="${major ? "0.09" : "0.045"}" stroke-width="${major ? "0.8" : "0.5"}"/>`);
  }
  for (let y = SHEET.y; y <= SHEET.y + SHEET.h; y += 16) {
    const major = Math.round((y - SHEET.y) / 16) % 5 === 0;
    grid.push(`<line x1="${SHEET.x}" y1="${y}" x2="${SHEET.x + SHEET.w}" y2="${y}" stroke="${INKW}" stroke-opacity="${major ? "0.09" : "0.045"}" stroke-width="${major ? "0.8" : "0.5"}"/>`);
  }
  el.push(...grid);

  // double border frame + corner registers
  const F = 14;
  el.push(`<rect x="${SHEET.x + F}" y="${SHEET.y + F}" width="${SHEET.w - 2 * F}" height="${SHEET.h - 2 * F}" fill="none" stroke="${INKW}" stroke-opacity="0.85" stroke-width="1.6"/>`);
  el.push(`<rect x="${SHEET.x + F + 7}" y="${SHEET.y + F + 7}" width="${SHEET.w - 2 * F - 14}" height="${SHEET.h - 2 * F - 14}" fill="none" stroke="${INKW}" stroke-opacity="0.4" stroke-width="0.7"/>`);
  for (const [cx, cy] of [[SHEET.x + F, SHEET.y + F], [SHEET.x + SHEET.w - F, SHEET.y + F], [SHEET.x + F, SHEET.y + SHEET.h - F], [SHEET.x + SHEET.w - F, SHEET.y + SHEET.h - F]]) {
    el.push(`<line x1="${cx - 10}" y1="${cy}" x2="${cx + 10}" y2="${cy}" stroke="${INKW}" stroke-opacity="0.8" stroke-width="1"/>`);
    el.push(`<line x1="${cx}" y1="${cy - 10}" x2="${cx}" y2="${cy + 10}" stroke="${INKW}" stroke-opacity="0.8" stroke-width="1"/>`);
  }

  // content fit inside the frame, then anchored so the deepest row sits at
  // y = 690: the grade dimension row lands at ~720, clear of the title block
  // (top edge 818) — content, dimensions, and block never collide
  const fit0 = fitter(g.nodes.map((n) => [n.pos3[0], -n.pos3[1]]), W, H - 90, 110);
  let rawBot = 0;
  for (const n of g.nodes) rawBot = Math.max(rawBot, fit0.map([n.pos3[0], -n.pos3[1]])[1]);
  const yShift = 690 - rawBot;
  const map = (p) => { const [x, y] = fit0.map(p); return [x, y + yShift]; };
  const proj2 = (p3) => map([p3[0], -p3[1]]);
  const P = (id) => proj2(byId.get(id).pos3);

  // related pairs: dashed construction lines
  for (const e of related) {
    const A = byId.get(e.s).pos3, B = byId.get(e.t).pos3;
    const [ax, ay] = proj2(A), [ex, ey] = map([e.c3[0], -e.c3[1]]), [bx, by] = proj2(B);
    el.push(`<path d="M${f(ax)} ${f(ay)}Q${f(ex)} ${f(ey)} ${f(bx)} ${f(by)}" fill="none" stroke="${INKW}" stroke-width="0.7" stroke-opacity="0.3" stroke-dasharray="4 4"/>`);
  }
  // prereq edges: thin white ink, keeping the same-column bow (the circuit read)
  for (const e of prereq) {
    const A = byId.get(e.s).pos3, B = byId.get(e.t).pos3;
    const [ax, ay] = proj2(A), [ex, ey] = map([e.c3[0], -e.c3[1]]), [bx, by] = proj2(B);
    el.push(`<path d="M${f(ax)} ${f(ay)}Q${f(ex)} ${f(ey)} ${f(bx)} ${f(by)}" fill="none" stroke="${INKW}" stroke-width="0.9" stroke-opacity="0.5"/>`);
  }

  // nodes: drafted circle + crosshair ticks; families = double ring; Major Work = filled centre
  const familyIds = new Set(families.map((p) => p.id));
  for (const n of g.nodes) {
    const [x, y] = P(n.id);
    const ink = mixHex(INKW, STRAND[n.strand], 0.3);
    const r = isChild(n.id) ? 1.9 : 2.7;
    el.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="none" stroke="${ink}" stroke-width="1.1" stroke-opacity="0.95"/>`);
    if (familyIds.has(n.id))
      el.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r + 1.8)}" fill="none" stroke="${ink}" stroke-width="0.6" stroke-opacity="0.7"/>`);
    if (n.msa === 0 && n.grade !== "HS")
      el.push(`<circle cx="${f(x)}" cy="${f(y)}" r="1.0" fill="${ink}" fill-opacity="0.95"/>`);
    for (const [dx, dy] of [[r + 0.6, 0], [-(r + 0.6), 0], [0, r + 0.6], [0, -(r + 0.6)]])
      el.push(`<line x1="${f(x + dx * 0.999)}" y1="${f(y + dy * 0.999)}" x2="${f(x + dx + Math.sign(dx) * 2)}" y2="${f(y + dy + Math.sign(dy) * 2)}" stroke="${INKW}" stroke-width="0.6" stroke-opacity="0.6"/>`);
  }

  // grade dimension line along the bottom: extension ticks + labels
  const COLS = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "A1", "G", "A2", "ADV"];
  const colX = new Map();
  for (const gr of g.grades) if (gr.marker3) colX.set(gr.id, gr.marker3[0]);
  for (const c of g.courses) if (c.marker3) colX.set(c.id, c.marker3[0]);
  let yBot = 0;
  for (const n of g.nodes) yBot = Math.max(yBot, P(n.id)[1]);
  const dimY = yBot + 30;
  const xs = COLS.filter((c) => colX.has(c)).map((c) => map([colX.get(c), 0])[0]);
  el.push(`<line x1="${f(Math.min(...xs) - 32)}" y1="${f(dimY)}" x2="${f(Math.max(...xs) + 32)}" y2="${f(dimY)}" stroke="${INKW}" stroke-opacity="0.55" stroke-width="0.8"/>`);
  for (const cid of COLS) {
    if (!colX.has(cid)) continue;
    const x = map([colX.get(cid), 0])[0];
    el.push(`<line x1="${f(x - 32)}" y1="${f(dimY - 4)}" x2="${f(x - 24)}" y2="${f(dimY + 4)}" stroke="${INKW}" stroke-opacity="0.55" stroke-width="0.8"/>`);
    el.push(`<text x="${f(x)}" y="${f(dimY - 8)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="12" fill="${INKW}" fill-opacity="0.85" letter-spacing="0.1em">${cid}</text>`);
  }

  // title block, bottom-right
  const TB = { w: 392, h: 128 };
  const tbx = SHEET.x + SHEET.w - F - TB.w, tby = SHEET.y + SHEET.h - F - TB.h;
  el.push(`<rect x="${tbx}" y="${tby}" width="${TB.w}" height="${TB.h}" fill="${PRUSSIAN}" fill-opacity="0.88" stroke="${INKW}" stroke-opacity="0.85" stroke-width="1.4"/>`);
  el.push(`<line x1="${tbx}" y1="${tby + 40}" x2="${tbx + TB.w}" y2="${tby + 40}" stroke="${INKW}" stroke-opacity="0.6" stroke-width="0.8"/>`);
  el.push(`<line x1="${tbx}" y1="${tby + 92}" x2="${tbx + TB.w}" y2="${tby + 92}" stroke="${INKW}" stroke-opacity="0.6" stroke-width="0.8"/>`);
  const T = (x, y, size, txt, op = 0.9) =>
    el.push(`<text x="${f(x)}" y="${f(y)}" font-family="ui-monospace, monospace" font-size="${size}" fill="${INKW}" fill-opacity="${op}" letter-spacing="0.08em">${txt}</text>`);
  T(tbx + 14, tby + 26, 16, "COHERENCE · PREREQUISITE CIRCUIT");
  T(tbx + 14, tby + 60, 11, "480 STANDARDS · 757 PREREQ EDGES · 142 RELATED", 0.75);
  T(tbx + 14, tby + 78, 11, "SOURCE: ACHIEVE THE CORE COHERENCE MAP (CC0)", 0.75);
  T(tbx + 14, tby + 112, 11, "SHEET 3 OF 4 · SCALE NONE · SEED 1337", 0.75);

  return svg(W, H, el,
    "GEOMETRY = the shipped pos3 exactly. GRAMMAR: Prussian-blue sheet with uneven exposure · drafting grid · double border frame + corner registers · title block · white-ink linework (strand kept as a 30% tint) · nodes = drafted circles + crosshairs, families = double ring, K-8 Major Work = filled centre · related pairs = dashed construction lines · grade dimension line · in-app the sheet is a real plane behind the nodes, so a slight orbit reads as a drawing floating in space", "#0a0a16");
}

// ===========================================================================
writeFileSync(resolve(OUT, "transit-pose-front.svg"), transitFront());
writeFileSync(resolve(OUT, "transit-pose-side.svg"), transitSide());
writeFileSync(resolve(OUT, "blueprint-pose-sheet.svg"), blueprintSheet());
console.log("wrote docs/previews/{transit-pose-front,transit-pose-side,blueprint-pose-sheet}.svg");
