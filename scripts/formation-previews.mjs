// Formation previews (design exploration, NOT a build step) — real-data layout
// studies for three candidate formations beyond the shipped three, to the
// designer's specs (docs/FORMATIONS.md). Each expresses ACCUMULATION WITH
// INHERITANCE and obeys the family-membrane law: every family (parent +
// children[]) is co-located as one body.
//
//   WATERSHED — top-down river map, K (headwaters) left → HS (delta/sea) right.
//     STRUCTURE from the drainage tree: each standard flows to its highest-reach
//     dependent; channel width = accumulated upstream discharge; confluences,
//     branching and y-stacking all EMERGE from that tree (no lanes, no jitter).
//   REEF      — cross-section growing upward, K seabed → HS sunlit surface.
//     STRUCTURE from accretion: x = flow-weighted centroid of a standard's
//     prerequisites (roots anchor at their strand zone), so colonies cluster.
//   TRANSIT   — octolinear metro map; strands are lines, standards stations.
//     STRUCTURE from the transfer graph: each line's MAIN LINE is the max-reach
//     path through its prereq subgraph, everything else attaches as a derived
//     branch; heavy cross-strand transfers become TRUE multi-line interchanges
//     the guest line routes through; y solved by barycenter crossing-min.
//
// THE LAW (Mark): hash() may only TEXTURE (fractal micro-kink amplitude,
// bubble placement). It may NEVER decide a node's POSITION or a line's ROUTE.
// All structure is derived from the DAG — prereq edges (k=0), descendant reach,
// grade order, families. Deterministic: no Math.random / Date. Reads
// public/data/graph-core.json; writes docs/previews/formation-*.svg. Geometry is
// derived from the dependency data, NOT the pos/pos2/pos3 poses. Nothing imports
// this file.

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
const STRAND_ORDER = ["number", "algebra", "geometry", "data"]; // number topmost / leftmost

// ---- deterministic helpers ------------------------------------------------
// FNV-1a plus an avalanche mix. A plain polynomial hash with a shared prefix
// (e.g. "rx"+id) barely perturbs the low bits between adjacent ids, collapsing
// the [0,1) spread into a narrow band; the mix restores uniform distribution so
// the id-hash scatter actually scatters. USED FOR TEXTURE ONLY (see THE LAW).
const hash = (s) => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mixHex = (h1, h2, t) => {
  const a = parseInt(h1.slice(1), 16);
  const b = parseInt(h2.slice(1), 16);
  const ch = (sh) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
};
const f = (v) => v.toFixed(1);

// ---- grade → column (13 columns: K,1..8 then HS split A1,G,A2,ADV) ---------
const GCOL = { K: 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8 };
const HCOL = { A1: 9, G: 10, A2: 11, ADV: 12 };
const colOf = (n) => (n.grade !== "HS" ? GCOL[n.grade] : HCOL[n.courses[0]] ?? 9);
const COL_LABELS = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "A1", "G", "A2", "ADV"];

// ---- families -------------------------------------------------------------
// parent id → [child ids]; child id → parent id. Children share grade+strand
// with their parent (verified). No parent↔child prereq edge exists — the tie is
// pure part-whole, so families must be *placed* together, not wired together.
const families = g.nodes.filter((n) => n.children && n.children.length);
const childOf = new Map();
for (const p of families) for (const c of p.children) childOf.set(c, p.id);
const isChild = (id) => childOf.has(id);

// ---- descendant reach (BFS over k=0 prereq edges; src/scene/reach.ts) ------
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
for (let v = 0; v < N; v++) if (reachArr[v] > MAXREACH) MAXREACH = reachArr[v]; // 245

// ---- per-column depth range (for "within-grade depth" advance) ------------
const colDepth = Array.from({ length: 13 }, () => ({ lo: Infinity, hi: -Infinity }));
for (const n of g.nodes) {
  const c = colOf(n);
  colDepth[c].lo = Math.min(colDepth[c].lo, n.depth);
  colDepth[c].hi = Math.max(colDepth[c].hi, n.depth);
}
// normalized position of a node inside its grade band by its build depth (0..1)
const depthT = (n) => {
  const c = colDepth[colOf(n)];
  return c.hi > c.lo ? (n.depth - c.lo) / (c.hi - c.lo) : 0.5;
};

const prereq = g.edges.filter((e) => e.k === 0);
const related = g.edges.filter((e) => e.k === 1);
const crossStrand = (e) => byId.get(e.s).strand !== byId.get(e.t).strand;

// interchange set: any standard touched by a cross-strand prereq OR related edge
const interchange = new Set();
for (const e of g.edges) if (crossStrand(e)) { interchange.add(e.s); interchange.add(e.t); }

// ===========================================================================
// UNIT MODEL — families contract to a single body. Every structural algorithm
// runs on UNITS (a family's parent stands in for the whole family; edges into
// or out of any child redirect to the parent, self-loops dropped). This is what
// makes "co-locate the family, always" a property of the geometry rather than a
// post-hoc nudge: the family occupies one point in the derived layout, and only
// its rendering fans the members apart. 364 units (480 standards − 116 children).
// ===========================================================================
const unitOf = (id) => childOf.get(id) ?? id;
const unitNodes = g.nodes.filter((n) => !isChild(n.id)); // parents + standalones
const unitIds = unitNodes.map((n) => n.id);
// unit-level prereq adjacency (dedup; self-loops from intra-family edges dropped)
const uSucc = new Map(unitIds.map((id) => [id, new Set()]));
const uPred = new Map(unitIds.map((id) => [id, new Set()]));
for (const e of prereq) {
  const u = unitOf(e.s), v = unitOf(e.t);
  if (u === v) continue;
  uSucc.get(u).add(v); uPred.get(v).add(u);
}
// unit reach = representative (parent) node reach — "already computed", and it
// strictly decreases downstream (a prerequisite owns all its dependents' reach),
// so it is a valid flow potential for every DP below.
const ureach = (u) => reach(u);
const codeLt = (a, b) => (byId.get(a).code < byId.get(b).code ? -1 : 1);
const ucol = (u) => colOf(byId.get(u));
// unit topological order (Kahn; ties by code so the whole pipeline is stable)
function topoUnits() {
  const indeg = new Map(unitIds.map((id) => [id, uPred.get(id).size]));
  const q = unitIds.filter((id) => indeg.get(id) === 0);
  const order = [];
  while (q.length) {
    q.sort(codeLt);
    const u = q.shift();
    order.push(u);
    for (const v of uSucc.get(u)) {
      indeg.set(v, indeg.get(v) - 1);
      if (indeg.get(v) === 0) q.push(v);
    }
  }
  return order;
}
const UTOPO = topoUnits(); // length === unitIds.length (unit DAG is acyclic)

// ===========================================================================
function svg(W, H, el, caption) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${BG}"/>
${el.join("\n")}
<text x="28" y="${H - 22}" font-family="ui-monospace, monospace" font-size="14.5" fill="#7a76a8" letter-spacing="0.06em">${caption}</text>
</svg>`;
}

// ===========================================================================
// 1 · THE WATERSHED — a top-down river map whose CHANNELS ARE A REAL DRAINAGE
// TREE. Every standard flows to a single primary downstream (its highest-reach
// dependent); those pointers form a spanning forest whose roots are the terminal
// standards at the delta. Discharge accumulates downstream (a channel's width is
// the total flow of everything upstream of it), so trunks fatten toward the sea
// and the Sacramento-style branching EMERGES from the data. y comes from
// recursive tributary stacking (a confluence sits at the flow-weighted centroid
// of its tributaries' mouths); x from grade / longest-path progression. Strand
// is only the initial ordering of subtrees — a soft tendency, not a hard lane.
// ===========================================================================
function watershed() {
  const W = 1960, H = 1020;
  const padL = 118, padR = 150, padT = 96, padB = 70;
  const usableW = W - padL - padR;

  // 13 grade bands with gentle irregular widths (geometry of the COLUMNS, from
  // grade — a structural axis, not a node position); HS delta bands run wider.
  const rawW = [];
  for (let c = 0; c < 13; c++) {
    const jitter = 1 + 0.14 * Math.sin(c * 1.7 + 0.6);
    rawW.push(jitter * (c >= 9 ? 1.16 : 1));
  }
  const sumW = rawW.reduce((a, b) => a + b, 0);
  const bandX = [padL];
  for (let c = 0; c < 13; c++) bandX.push(bandX[c] + (rawW[c] / sumW) * usableW);
  const seaX = bandX[13]; // right edge of the delta = shoreline
  const xOf = (n) => {
    const c = colOf(n);
    const bx0 = bandX[c] + 6, bx1 = bandX[c + 1] - 6;
    return bx0 + depthT(n) * (bx1 - bx0);
  };

  // ---- DRAINAGE FOREST ------------------------------------------------------
  // primaryDown(u) = the dependent of u with the greatest descendant reach
  // (ties by code). Flow runs u → primaryDown(u) → … → a sink (the delta).
  const primaryDown = new Map();
  const dChildren = new Map(unitIds.map((id) => [id, []]));
  for (const u of unitIds) {
    let best = null, bestR = -1;
    for (const v of uSucc.get(u)) {
      const r = ureach(v);
      if (r > bestR || (r === bestR && byId.get(v).code < byId.get(best).code)) { bestR = r; best = v; }
    }
    primaryDown.set(u, best);
    if (best) dChildren.get(best).push(u);
  }
  // discharge: subtree flow accumulates downstream (topo order = children first)
  const flow = new Map(unitIds.map((id) => [id, 1]));
  for (const u of UTOPO) { const p = primaryDown.get(u); if (p) flow.set(p, flow.get(p) + flow.get(u)); }
  let maxEdgeFlow = 1;
  for (const u of unitIds) if (primaryDown.get(u)) maxEdgeFlow = Math.max(maxEdgeFlow, flow.get(u));

  // order tributaries by strand tendency, then code — strands stay in soft bands
  const strandRank = (id) => STRAND_ORDER.indexOf(byId.get(id).strand);
  const byTrib = (a, b) => strandRank(a) - strandRank(b) || codeLt(a, b);
  for (const arr of dChildren.values()) arr.sort(byTrib);

  // recursive tributary stacking → a vertical slot per unit. Leaves (headwaters)
  // take sequential slots; a confluence sits at the flow-weighted mean of its
  // tributaries' slots. This is the classic river-map post-order extent layout.
  const slotY = new Map();
  let slot = 0;
  const assignY = (u) => {
    const ch = dChildren.get(u);
    if (!ch.length) { slotY.set(u, slot); slot += 1; return slotY.get(u); }
    let num = 0, den = 0;
    for (const c of ch) { const cy = assignY(c); num += cy * flow.get(c); den += flow.get(c); }
    const y = num / den; slotY.set(u, y); return y;
  };
  const roots = unitIds.filter((id) => !primaryDown.get(id)).sort(byTrib);
  for (const r of roots) assignY(r);
  const maxSlot = Math.max(1, slot - 1);
  const yOf = (u) => padT + (slotY.get(u) / maxSlot) * (H - padT - padB);

  const pos = new Map();
  for (const n of unitNodes) pos.set(n.id, [xOf(n), clamp(yOf(n.id), padT - 8, H - padB + 8)]);
  // families: children ride as tributary mouths just upstream (left) of parent
  for (const p of families) {
    const [px, py] = pos.get(p.id);
    const m = p.children.length;
    p.children.forEach((cid, i) => {
      const up = 9 + (i % 3) * 2.4;
      const yy = py + (i - (m - 1) / 2) * 6.5;
      pos.set(cid, [px - up, yy]);
    });
  }

  const el = [];
  el.push(`<defs>
<linearGradient id="sea" x1="0" y1="0" x2="1" y2="0">
<stop offset="0%" stop-color="#16324a" stop-opacity="0"/>
<stop offset="60%" stop-color="#16324a" stop-opacity="0.5"/>
<stop offset="100%" stop-color="#1d4a63" stop-opacity="0.85"/>
</linearGradient>
<filter id="brush" x="-5%" y="-5%" width="110%" height="110%">
<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="41" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="2.6"/>
</filter></defs>`);
  el.push(`<rect x="${f(seaX)}" y="0" width="${f(W - seaX)}" height="${H}" fill="url(#sea)"/>`);
  el.push(`<line x1="${f(seaX)}" y1="0" x2="${f(seaX)}" y2="${H}" stroke="#2a5a72" stroke-width="1" stroke-opacity="0.5"/>`);

  // grade band ticks + labels along the top
  for (let c = 0; c < 13; c++) {
    const mx = (bandX[c] + bandX[c + 1]) / 2;
    el.push(`<line x1="${f(bandX[c])}" y1="${padT - 30}" x2="${f(bandX[c])}" y2="${H - padB}" stroke="#1a1830" stroke-width="1"/>`);
    el.push(`<text x="${f(mx)}" y="${padT - 40}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="12.5" fill="#4a4770" letter-spacing="0.1em">${COL_LABELS[c]}</text>`);
  }

  // channel(): the derived course between two points, textured with two scales
  // of fractal micro-kink (hash TEXTURES the amplitude only — the endpoints and
  // the spine are the data's). Creeks kink sharply; trunk rivers meander slow.
  function channel(A, B, seedKey, w) {
    const cx = (B[0] - A[0]) * 0.42;
    const c1x = A[0] + Math.max(cx, 30);
    const c2x = B[0] - Math.max(cx, 8);
    const spine = (t) => {
      const u = 1 - t;
      return [
        u * u * u * A[0] + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * B[0],
        u * u * u * A[1] + 3 * u * u * t * A[1] + 3 * u * t * t * B[1] + t * t * t * B[1],
      ];
    };
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const segs = clamp(Math.round(len / 20), 7, 30);
    const pts = [];
    for (let i = 0; i <= segs; i++) pts.push(spine(i / segs));
    const kink = clamp(13 / (1 + w * 0.6), 2.4, 11);
    // one slow, wide meander over the whole course (amplitude grows with length,
    // barely damped by width so even trunks wander) plus the two-scale micro-kink
    const mAmp = Math.min(len * 0.09, 46) / (1 + w * 0.14);
    const mFreq = 1.15 + hash(seedKey + "mf") * 1.5;
    const mPh = hash(seedKey + "mp") * 6.283;
    for (let i = 1; i < segs; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx2, by2] = pts[i + 1];
      let dx = bx2 - ax, dy = by2 - ay;
      const L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L;
      const t = i / segs;
      const env = Math.sin(Math.PI * t);
      const meander = (Math.sin(6.283 * mFreq * t + mPh) * 0.7 + Math.sin(6.283 * mFreq * 2.3 * t + mPh * 1.7) * 0.3) * mAmp * env;
      const coarse = (hash(seedKey + "k" + Math.floor(i / 3)) - 0.5) * 2;
      const fine = (hash(seedKey + "j" + i) - 0.5) * 2;
      const off = meander + (coarse * 0.62 + fine * 0.38) * kink * env * (0.7 + Math.min(1.6, len / 420));
      pts[i] = [pts[i][0] + nx * off, pts[i][1] + ny * off];
    }
    return "M" + pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" L");
  }

  // distributary canals — every prereq edge that is NOT the primary (tree) edge.
  // Painted first, faint and thin, beneath the true rivers.
  const treeEdge = new Set();
  for (const u of unitIds) { const p = primaryDown.get(u); if (p) treeEdge.add(u + ">" + p); }
  const distrib = [];
  for (const u of unitIds) for (const v of uSucc.get(u)) {
    if (treeEdge.has(u + ">" + v)) continue;
    const A = pos.get(u), B = pos.get(v);
    if (!A || !B) continue;
    const d = channel(A, B, u + "~" + v, 1.0);
    distrib.push(`<path d="${d}" fill="none" stroke="${mixHex(STRAND[byId.get(u).strand], BG, 0.35)}" stroke-width="0.85" stroke-opacity="0.28" stroke-linecap="round"/>`);
  }

  // the rivers themselves — tree edges, width = accumulated discharge (√flow),
  // colored by the tributary's own strand so ribbons stay legible until they
  // merge. Thick first so fine creeks lie on top. Three painterly passes: a
  // soft bleeding wash, the ink stroke, a wet highlight down the trunk centers.
  const rivers = [];
  for (const u of unitIds) {
    const p = primaryDown.get(u);
    if (!p) continue;
    const A = pos.get(u), B = pos.get(p);
    if (!A || !B) continue;
    const t = Math.pow(flow.get(u) / maxEdgeFlow, 0.6);
    const w = 0.6 + t * 7.2;
    rivers.push({ u, p, A, B, w, t });
  }
  rivers.sort((a, b) => b.w - a.w);
  const washes = [], strokes = [], highlights = [];
  for (const { u, p, A, B, w, t } of rivers) {
    const col = STRAND[byId.get(u).strand];
    const d = channel(A, B, u + ">" + p, w);
    const op = clamp(0.24 + t * 0.6, 0.24, 0.86);
    if (w > 1.8) washes.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="${f(w * 1.9)}" stroke-opacity="${f(op * 0.16)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    strokes.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="${f(w)}" stroke-opacity="${f(op)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    if (w > 3.6) highlights.push(`<path d="${d}" fill="none" stroke="${mixHex(col, "#ffffff", 0.45)}" stroke-width="${f(w * 0.32)}" stroke-opacity="${f(op * 0.5)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  el.push(`<g filter="url(#brush)">`, ...distrib, ...washes, ...strokes, ...highlights, `</g>`);

  // related pairs: faint dotted cross-channels
  for (const e of related) {
    const A = pos.get(unitOf(e.s)), B = pos.get(unitOf(e.t));
    if (!A || !B) continue;
    el.push(`<line x1="${f(A[0])}" y1="${f(A[1])}" x2="${f(B[0])}" y2="${f(B[1])}" stroke="${INK}" stroke-width="0.8" stroke-opacity="0.2" stroke-dasharray="1.5 4"/>`);
  }

  // reservoirs — the top-16 reach standards as irregular dark lakes (hash
  // TEXTURES the blob outline only, never its placement, which is the node's).
  function reservoir(x, y, r, key) {
    const nSides = 9;
    const pts = [];
    for (let i = 0; i < nSides; i++) {
      const a = (i / nSides) * Math.PI * 2;
      const rr = r * (0.6 + hash(key + "b" + i) * 0.85);
      pts.push([x + Math.cos(a) * rr * 1.6, y + Math.sin(a) * rr]);
    }
    return "M" + pts.map(([px, py]) => `${f(px)},${f(py)}`).join(" L") + " Z";
  }
  const reservoirIds = new Set([...g.nodes].sort((a, b) => reach(b.id) - reach(a.id)).slice(0, 16).map((n) => n.id));
  for (const n of g.nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    const r = 1.8 + Math.sqrt(n.deg) * 0.9;
    if (reservoirIds.has(n.id)) {
      const rr = r + 3 + Math.sqrt(reach(n.id) / MAXREACH) * 6;
      el.push(`<path d="${reservoir(p[0], p[1], rr, "rv" + n.id)}" fill="#1d4256" fill-opacity="0.62" stroke="#ffd27a" stroke-width="0.8" stroke-opacity="0.45" stroke-linejoin="round"/>`);
    }
    el.push(`<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(r)}" fill="${STRAND[n.strand]}" fill-opacity="0.95"/>`);
  }

  // strand labels ride at the vertical centroid of their own headwaters (left)
  for (const s of STRAND_ORDER) {
    const ys = unitIds.filter((id) => byId.get(id).strand === s && ucol(id) <= 1).map((id) => pos.get(id)[1]);
    const cy = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : padT + 40;
    el.push(`<text x="26" y="${f(cy + 4)}" font-family="ui-monospace, monospace" font-size="13" fill="${mixHex(STRAND[s], BG, 0.15)}" letter-spacing="0.08em">${s.toUpperCase()}</text>`);
  }
  el.push(`<text x="${f(seaX + 14)}" y="${padT - 40}" font-family="ui-monospace, monospace" font-size="12.5" fill="#4a7a90" letter-spacing="0.1em">SEA</text>`);
  el.push(`<text x="28" y="52" font-family="ui-monospace, monospace" font-size="20" fill="#e8e6f6" letter-spacing="0.06em">THE WATERSHED · prerequisite knowledge as a river system</text>`);

  return svg(W, H, el,
    "STRUCTURE from a real drainage tree: every standard flows to its highest-reach dependent, those pointers form a spanning forest to the delta · channel WIDTH = accumulated upstream discharge (√ subtree flow) so trunks fatten downstream as tributaries confluence · y from recursive tributary stacking (a confluence sits at the flow-weighted centroid of its tributaries' mouths); x from grade / longest-path · faint canals = non-tree prerequisites (distributaries) · steel-blue lakes = top-16 descendant reach · dotted = related pair · strand is only the initial subtree order, a soft tendency · families ride as tributary mouths just upstream · 480 standards, 757 prerequisites, deterministic");
}

// ===========================================================================
// 2 · THE REEF — a cross-section growing upward by accretion. K at the seabed,
// HS at the sunlit surface (grade is the shelf, y). STRUCTURE from accretion:
// processing standards in topological order, each one's x is the flow-weighted
// centroid of its prerequisites' x (roots anchor at their strand zone), so a
// dependency cluster physically converges into a visible colony. A deterministic
// collision relax spreads overlapping heads within each shelf while preserving
// order. Families accrete ON the parent (children bud as one colony).
// ===========================================================================
function reef() {
  const W = 1960, H = 1280;
  const padL = 150, padR = 90, padT = 96, padB = 96;
  const usableW = W - padL - padR;
  const usableH = H - padT - padB;
  const shelfH = usableH / 13;
  const zoneW = usableW / 4;
  const BONE = "#cfc8bc";

  const shelfCenterY = (col) => H - padB - (col + 0.5) * shelfH; // col 0 (K) at seabed
  const zoneCenterX = (strand) => padL + (STRAND_ORDER.indexOf(strand) + 0.5) * zoneW;

  const reefColor = (n) => {
    const c = colOf(n);
    const base = STRAND[n.strand];
    if (c <= 2) return mixHex(base, BONE, 0.64); // calcified skeleton
    if (c >= 9) return mixHex(base, "#ffffff", 0.24); // sunlit surface
    return base;
  };
  const headR = (n) => 2.6 + Math.sqrt(n.deg) * 1.05 + Math.sqrt(reach(n.id) / MAXREACH) * 3.0;

  // ---- ACCRETION x: flow-weighted centroid of prerequisites' x --------------
  // Roots have no prerequisite to inherit from, so they anchor in their strand
  // zone — spread across it by code order (derived) rather than piled on one x.
  const strandRoots = new Map(STRAND_ORDER.map((s) => [s, []]));
  for (const u of UTOPO) if (![...uPred.get(u)].length) strandRoots.get(byId.get(u).strand).push(u);
  const rootX = new Map();
  for (const [s, arr] of strandRoots) {
    arr.sort((a, b) => ucol(a) - ucol(b) || codeLt(a, b));
    const zc = zoneCenterX(s);
    arr.forEach((u, i) => { const t = arr.length > 1 ? i / (arr.length - 1) : 0.5; rootX.set(u, zc + (t - 0.5) * zoneW * 0.82); });
  }
  // Every other standard drifts to the flow-weighted centroid of its
  // prerequisites, kept partly home in its own strand zone so the four reef
  // zones stay legible while dependency clusters still converge into colonies.
  const ux = new Map();
  for (const u of UTOPO) {
    const preds = [...uPred.get(u)];
    if (!preds.length) { ux.set(u, rootX.get(u)); continue; }
    let num = 0, den = 0;
    for (const p of preds) { const w = ureach(p) + 1; num += ux.get(p) * w; den += w; }
    ux.set(u, (num / den) * 0.66 + zoneCenterX(byId.get(u).strand) * 0.34);
  }
  // y = grade shelf + a within-shelf offset derived from build depth (structure,
  // not hash) so heads at the same accretion x still separate vertically.
  const pos = new Map();
  for (const n of unitNodes) {
    const y = shelfCenterY(colOf(n)) + (depthT(n) - 0.5) * shelfH * 0.5;
    pos.set(n.id, [ux.get(n.id), y]);
  }
  // collision relax within each shelf on x — spread with a radius-aware gap,
  // preserve topological/accretion order, fit-scale a too-wide shelf to bounds.
  const shelves = Array.from({ length: 13 }, () => []);
  for (const n of unitNodes) shelves[colOf(n)].push(n);
  const minX = padL - 40, maxX = W - padR + 20, midX = (minX + maxX) / 2, avail = maxX - minX;
  for (const arr of shelves) {
    arr.sort((a, b) => pos.get(a.id)[0] - pos.get(b.id)[0] || codeLt(a.id, b.id));
    for (let i = 1; i < arr.length; i++) {
      const a = arr[i - 1], b = arr[i];
      const gap = headR(a) + headR(b) + 3;
      if (pos.get(b.id)[0] < pos.get(a.id)[0] + gap) pos.get(b.id)[0] = pos.get(a.id)[0] + gap;
    }
    if (arr.length > 1) {
      const L = pos.get(arr[0].id)[0], R = pos.get(arr[arr.length - 1].id)[0], span = R - L;
      if (span > avail) { const s = avail / span; for (const n of arr) pos.get(n.id)[0] = midX + (pos.get(n.id)[0] - (L + R) / 2) * s; }
      else { const shift = clamp((L + R) / 2, midX - (avail - span) / 2, midX + (avail - span) / 2) - (L + R) / 2; for (const n of arr) pos.get(n.id)[0] += shift; }
    }
    for (const n of arr) pos.get(n.id)[0] = clamp(pos.get(n.id)[0], minX, maxX);
  }
  // families bud directly ON the parent — golden-angle spacing (derived, no hash)
  for (const p of families) {
    const [px, py] = pos.get(p.id);
    const pr = headR(p);
    p.children.forEach((cid, i) => {
      const cr = 2.4 + Math.sqrt(byId.get(cid).deg) * 0.8;
      const ang = i * 2.399963 + strandRankOf(p.strand);
      const dist = pr + cr * 0.7;
      pos.set(cid, [px + Math.cos(ang) * dist, py + Math.sin(ang) * dist]);
    });
  }

  const el = [];
  el.push(`<defs>
<linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#1b4a52" stop-opacity="0.34"/>
<stop offset="55%" stop-color="#123038" stop-opacity="0.14"/>
<stop offset="100%" stop-color="#0a1a1e" stop-opacity="0.5"/>
</linearGradient>
<linearGradient id="shaft" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#cdeee6" stop-opacity="0.07"/>
<stop offset="45%" stop-color="#bfe8e0" stop-opacity="0.028"/>
<stop offset="100%" stop-color="#bfe8e0" stop-opacity="0"/>
</linearGradient></defs>`);
  el.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="url(#water)"/>`);
  for (let i = 0; i < 4; i++) {
    const sx = padL + (0.16 + 0.66 * (i / 3) + (hash("sh" + i) - 0.5) * 0.05) * usableW;
    const sw = 26 + hash("sw" + i) * 34;
    const slant = 130 + hash("sl" + i) * 90;
    el.push(`<polygon points="${f(sx)},${padT - 20} ${f(sx + sw)},${padT - 20} ${f(sx + slant + sw * 0.5)},${f(H - padB)} ${f(sx + slant - sw * 0.5)},${f(H - padB)}" fill="url(#shaft)"/>`);
  }

  for (let c = 0; c < 13; c++) {
    const y = shelfCenterY(c);
    el.push(`<line x1="${padL - 46}" y1="${f(y)}" x2="${f(W - padR)}" y2="${f(y)}" stroke="#151c22" stroke-width="1"/>`);
    el.push(`<text x="${padL - 56}" y="${f(y + 4)}" text-anchor="end" font-family="ui-monospace, monospace" font-size="12.5" fill="#3f5560" letter-spacing="0.08em">${COL_LABELS[c]}</text>`);
  }
  for (const s of STRAND_ORDER) {
    el.push(`<text x="${f(zoneCenterX(s))}" y="${padT - 34}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="13" fill="${mixHex(STRAND[s], BG, 0.15)}" letter-spacing="0.08em">${s.toUpperCase()}</text>`);
  }

  // deterministic rising bubbles — pure texture, hash-placed (allowed)
  for (let i = 0; i < 150; i++) {
    const bx = padL + hash("bx" + i) * usableW;
    const by = padT + hash("by" + i) * usableH;
    const br = 0.6 + hash("br" + i) * 1.8;
    el.push(`<circle cx="${f(bx)}" cy="${f(by)}" r="${f(br)}" fill="#bfe8e0" fill-opacity="0.15"/>`);
  }

  // prereq as slender upward current wisps — derived endpoints, derived bow
  for (const e of prereq) {
    const A = pos.get(e.s) || pos.get(unitOf(e.s)), B = pos.get(e.t) || pos.get(unitOf(e.t));
    if (!A || !B) continue;
    const w = 0.5 + Math.sqrt(reach(e.t) / MAXREACH) * 1.3;
    const midY = (A[1] + B[1]) / 2;
    const bow = (A[1] < B[1] ? 1 : -1) * Math.min(26, Math.abs(B[0] - A[0]) * 0.18 + 6);
    const d = `M${f(A[0])},${f(A[1])} Q${f((A[0] + B[0]) / 2 + bow)},${f(midY)} ${f(B[0])},${f(B[1])}`;
    el.push(`<path d="${d}" fill="none" stroke="${mixHex(STRAND[byId.get(e.t).strand], "#8fd0c8", 0.4)}" stroke-width="${f(w)}" stroke-opacity="0.18" stroke-linecap="round"/>`);
  }
  for (const e of related) {
    const A = pos.get(e.s) || pos.get(unitOf(e.s)), B = pos.get(e.t) || pos.get(unitOf(e.t));
    if (!A || !B) continue;
    el.push(`<line x1="${f(A[0])}" y1="${f(A[1])}" x2="${f(B[0])}" y2="${f(B[1])}" stroke="${INK}" stroke-width="0.8" stroke-opacity="0.2" stroke-dasharray="1.5 4"/>`);
  }

  {
    const y0 = H - padB - shelfH * 0.02;
    let d = `M${padL - 46},${f(y0)}`;
    for (let x = padL - 46; x <= W - padR; x += 40) d += ` L${f(x)},${f(y0 + Math.sin(x * 0.03) * 3)}`;
    el.push(`<path d="${d}" fill="none" stroke="${mixHex(BONE, BG, 0.35)}" stroke-width="2.2" stroke-opacity="0.55"/>`);
  }

  const drawNode = (n, r) => {
    const p = pos.get(n.id);
    el.push(`<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(r)}" fill="${reefColor(n)}" fill-opacity="0.95"/>`);
    if (n.wap) el.push(`<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(r + 2)}" fill="none" stroke="#ffd27a" stroke-width="1" stroke-opacity="0.7"/>`);
  };
  for (const p of families) {
    drawNode(p, headR(p));
    for (const cid of p.children) drawNode(byId.get(cid), 2.4 + Math.sqrt(byId.get(cid).deg) * 0.8);
  }
  for (const n of g.nodes) {
    if (isChild(n.id) || (n.children && n.children.length)) continue;
    drawNode(n, 2.4 + Math.sqrt(n.deg) * 1.0);
  }

  el.push(`<text x="28" y="52" font-family="ui-monospace, monospace" font-size="20" fill="#e8e6f6" letter-spacing="0.06em">THE REEF · prerequisite knowledge as accretion</text>`);
  return svg(W, H, el,
    "STRUCTURE from accretion: in topological order, each standard's x is the flow-weighted centroid of its prerequisites' x (roots anchor at their strand zone), so a dependency cluster physically converges into a colony · y = grade shelf (K seabed → HS sunlit surface), within-shelf offset from build depth · a deterministic collision relax spreads overlapping heads while preserving order · K–2 calcified toward bone, HS brightened · families are CORAL HEADS, children budding on the parent as one colony · wisps = prerequisite currents · gold ring = widely applicable prerequisite · 480 standards, deterministic");
}
const strandRankOf = (s) => STRAND_ORDER.indexOf(s);

// ===========================================================================
// 3 · THE TRANSIT MAP — a real metro network whose ROUTES ARE DERIVED. Per
// strand, the MAIN LINE is the maximum-reach path through the strand's prereq
// subgraph (DP longest weighted path, weight = descendant reach); every other
// standard attaches as a BRANCH at its nearest main-line ancestor (a downstream
// BFS from the trunk), and standards with no trunk path hang as short spurs at
// their grade column. Heavy cross-strand transfers (a station touched by ≥ FLOOR
// cross-strand prerequisites) become TRUE multi-line interchanges: the guest
// line is routed THROUGH the station, so it earns a real multi-colour capsule
// (one dot per line). Families are a single elongated lozenge — one marker, one
// label — never a stack of same-line dots (they are not interchanges). Grade is
// the column (topological left→right); y is solved by barycenter crossing-min;
// segments snap octolinear; trunk width tracks the reach flowing through it.
// ===========================================================================
function transit() {
  const W = 1960, H = 1120;
  const padL = 150, padR = 300, padT = 122, padB = 66;
  const usableW = W - padL - padR;
  const usableH = H - padT - padB;
  const midH = padT + usableH / 2;
  const colX = (c) => padL + (usableW) * (c / 12);
  const seaX = colX(12) + 96;
  const FLOOR = 3; // ≥3 cross-strand prereqs ⇒ a true multi-line interchange (42)

  const elbow = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx < 1 || ady < 1) return [a, b];
    const sx = Math.sign(dx), sy = Math.sign(dy);
    return adx > ady ? [a, [b[0] - sx * ady, a[1]], b] : [a, [a[0], b[1] - sy * adx], b];
  };
  const toPath = (pts) => "M" + pts.map((p) => `${f(p[0])},${f(p[1])}`).join(" L");
  const octoChain = (stations) => { // octolinear polyline through station points
    const out = [];
    for (let i = 0; i < stations.length - 1; i++) {
      const e = elbow(stations[i], stations[i + 1]);
      for (let k = i === 0 ? 0 : 1; k < e.length; k++) out.push(e[k]);
    }
    return out.length ? out : stations;
  };

  // ---- MAIN LINE per strand: DP longest weighted path (weight = reach) -------
  const mainSeqOf = new Map();
  const isMain = new Set();
  for (const s of STRAND_ORDER) {
    const sset = new Set(unitIds.filter((id) => byId.get(id).strand === s));
    const best = new Map(), pred = new Map();
    for (const u of UTOPO) {
      if (!sset.has(u)) continue;
      let b = ureach(u), p = null;
      for (const pr of uPred.get(u)) {
        if (!sset.has(pr)) continue;
        const cand = best.get(pr) || 0;
        if (cand + ureach(u) > b) { b = cand + ureach(u); p = pr; }
      }
      best.set(u, b); pred.set(u, p);
    }
    let end = null, bv = -1;
    for (const u of sset) { const b = best.get(u) || 0; if (b > bv || (b === bv && byId.get(u).code < byId.get(end).code)) { bv = b; end = u; } }
    const seq = []; let c = end; while (c) { seq.push(c); c = pred.get(c); } seq.reverse();
    mainSeqOf.set(s, seq);
    for (const m of seq) isMain.add(m);
  }

  // ---- BRANCHES: chain each standard onto its primary within-strand
  // prerequisite (its highest-reach ancestor edge), so genuine branch lines grow
  // upstream and root on the trunk — walking any standard's chain up eventually
  // reaches the main line. A standard with NO within-strand prerequisite is a
  // SPUR, joined to the grade-nearest station already on the line.
  const parentOf = new Map(); // non-trunk unit → its parent station (one hop upstream)
  for (const s of STRAND_ORDER) {
    const sset = new Set(unitIds.filter((id) => byId.get(id).strand === s));
    const seq = mainSeqOf.get(s);
    const onTrunk = new Set(seq);
    const spurs = [];
    for (const u of sset) {
      if (onTrunk.has(u)) continue;
      let best = null, bestR = -1;
      for (const p of uPred.get(u)) {
        if (!sset.has(p)) continue;
        const r = ureach(p);
        if (r > bestR || (r === bestR && byId.get(p).code < byId.get(best).code)) { bestR = r; best = p; }
      }
      if (best) parentOf.set(u, best);
      else spurs.push(u);
    }
    const connected = [...sset].filter((id) => onTrunk.has(id) || parentOf.has(id));
    for (const u of spurs) {
      const uc = ucol(u);
      let bestM = seq[0], bd = 1e9;
      for (const m of connected) { const d = Math.abs(ucol(m) - uc) * 10 + (ucol(m) <= uc ? 0 : 5); if (d < bd) { bd = d; bestM = m; } }
      parentOf.set(u, bestM);
    }
  }

  // ---- TRANSFERS → interchanges --------------------------------------------
  const tw = new Map(); // unit → cross-strand prereq degree (in + out)
  const guestOf = new Map(unitIds.map((id) => [id, new Set()])); // station → guest strands
  for (const e of prereq) {
    if (!crossStrand(e)) continue;
    const u = unitOf(e.s), v = unitOf(e.t);
    tw.set(u, (tw.get(u) || 0) + 1); tw.set(v, (tw.get(v) || 0) + 1);
    guestOf.get(v).add(byId.get(u).strand);
    guestOf.get(u).add(byId.get(v).strand);
  }
  // true multi-line stations route each guest line THROUGH them
  const linesAt = new Map(unitIds.map((id) => [id, new Set([byId.get(id).strand])]));
  const guestStops = new Map(STRAND_ORDER.map((s) => [s, []])); // strand → foreign stations routed onto it
  const multiStations = new Set();
  for (const u of unitIds) {
    if ((tw.get(u) || 0) < FLOOR) continue;
    multiStations.add(u);
    const own = byId.get(u).strand;
    for (const gs of guestOf.get(u)) {
      if (gs === own) continue;
      linesAt.get(u).add(gs);
      guestStops.get(gs).push(u);
    }
  }

  // ---- route graph (for barycenter): trunk pairs, branch edges, through-stops
  const radj = new Map(unitIds.map((id) => [id, new Set()]));
  const addEdge = (a, b) => { if (a === b) return; radj.get(a).add(b); radj.get(b).add(a); };
  for (const s of STRAND_ORDER) { const seq = mainSeqOf.get(s); for (let i = 1; i < seq.length; i++) addEdge(seq[i - 1], seq[i]); }
  for (const [u, p] of parentOf) addEdge(u, p);
  for (const s of STRAND_ORDER) {
    const seq = mainSeqOf.get(s);
    for (const v of guestStops.get(s)) {
      const vc = ucol(v);
      let lo = null, hi = null;
      for (const m of seq) { const mc = ucol(m); if (mc <= vc) lo = m; if (mc > vc && hi === null) hi = m; }
      if (lo) addEdge(v, lo);
      if (hi) addEdge(v, hi);
    }
  }

  // ---- BARYCENTER y (crossing minimisation over the derived route graph) ----
  const cols = Array.from({ length: 13 }, () => []);
  for (const n of unitNodes) cols[colOf(n)].push(n.id);
  for (const arr of cols) arr.sort((a, b) => strandRankOf(byId.get(a).strand) - strandRankOf(byId.get(b).strand) || codeLt(a, b));
  const centered = new Map();
  const recenter = () => { for (const arr of cols) arr.forEach((id, i) => centered.set(id, i - (arr.length - 1) / 2)); };
  recenter();
  for (let pass = 0; pass < 12; pass++) {
    const seqCols = pass % 2 ? [...cols.keys()].reverse() : [...cols.keys()];
    for (const ci of seqCols) {
      const arr = cols[ci];
      const key = new Map();
      for (const id of arr) {
        const nb = [...radj.get(id)];
        if (!nb.length) { key.set(id, centered.get(id)); continue; }
        let sum = 0; for (const m of nb) sum += centered.get(m);
        key.set(id, sum / nb.length);
      }
      arr.sort((a, b) => key.get(a) - key.get(b) || codeLt(a, b));
      arr.forEach((id, i) => centered.set(id, i - (arr.length - 1) / 2));
    }
  }
  let maxCount = 1; for (const arr of cols) maxCount = Math.max(maxCount, arr.length);
  const ROWH = Math.min(usableH / Math.max(1, maxCount - 1), 15);
  // within a grade column, spread stations horizontally by build depth (still
  // topological left→right) so a dense terminal course reads as a district band
  // instead of a razor-thin wall, and same-column branch ladders gain a natural
  // diagonal. Band width grows with the column's load.
  const colGap = colX(1) - colX(0);
  const stationPos = new Map();
  for (const n of unitNodes) {
    const c = colOf(n);
    const bandHalf = clamp((cols[c].length / maxCount) * 0.4 * colGap, 5, 0.4 * colGap);
    stationPos.set(n.id, [colX(c) + (depthT(n) - 0.5) * 2 * bandHalf, midH + centered.get(n.id) * ROWH]);
  }

  // ---- LOAD widths: reach flowing through each trunk / branch segment --------
  const carried = new Map();          // non-main unit → subtree reach it carries
  const trunkLoadAt = new Map();      // main unit → reach entering the trunk here
  for (const id of unitIds) if (!isMain.has(id)) carried.set(id, ureach(id));
  for (let i = UTOPO.length - 1; i >= 0; i--) {
    const u = UTOPO[i];
    if (isMain.has(u)) continue;
    const p = parentOf.get(u);
    if (p == null) continue;
    if (isMain.has(p)) trunkLoadAt.set(p, (trunkLoadAt.get(p) || 0) + carried.get(u));
    else carried.set(p, (carried.get(p) || 0) + carried.get(u));
  }
  const loadRightOf = new Map(); // strand → array aligned with mainSeq
  let maxLoad = 1;
  for (const s of STRAND_ORDER) {
    const seq = mainSeqOf.get(s);
    const lr = new Array(seq.length).fill(0);
    for (let i = seq.length - 1; i >= 0; i--) {
      const own = ureach(seq[i]) + (trunkLoadAt.get(seq[i]) || 0);
      lr[i] = own + (i + 1 < seq.length ? lr[i + 1] : 0);
    }
    loadRightOf.set(s, lr);
    if (lr.length) maxLoad = Math.max(maxLoad, lr[0]);
  }
  const trunkW = (load) => 2.2 + Math.sqrt(load / maxLoad) * 6.6;
  const branchW = (load) => 1.3 + Math.sqrt(load / maxLoad) * 3.0;

  // ===========================================================================
  const el = [];
  el.push(`<defs>
<linearGradient id="tsea" x1="0" y1="0" x2="1" y2="0">
<stop offset="0%" stop-color="#16324a" stop-opacity="0"/>
<stop offset="55%" stop-color="#16324a" stop-opacity="0.5"/>
<stop offset="100%" stop-color="#1d4a63" stop-opacity="0.85"/>
</linearGradient>
<linearGradient id="tdown" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#1a1838" stop-opacity="0"/>
<stop offset="50%" stop-color="#201d44" stop-opacity="0.72"/>
<stop offset="100%" stop-color="#1a1838" stop-opacity="0"/>
</linearGradient></defs>`);
  // the sea, east of the high-school columns (the delta the Watershed empties to)
  el.push(`<rect x="${f(seaX)}" y="0" width="${f(W - seaX)}" height="${H}" fill="url(#tsea)"/>`);
  el.push(`<line x1="${f(seaX)}" y1="0" x2="${f(seaX)}" y2="${H}" stroke="#2a5a72" stroke-width="1" stroke-opacity="0.5"/>`);
  el.push(`<text x="${f(seaX + 16)}" y="${f(padT - 44)}" font-family="ui-monospace, monospace" font-size="12.5" fill="#4a7a90" letter-spacing="0.14em">SEA</text>`);

  // DOWNTOWN — the dense grade 3–7 core where the cross-strand transfers cluster
  const dx0 = colX(3) - (colX(1) - colX(0)) * 0.45, dx1 = colX(7) + (colX(1) - colX(0)) * 0.45;
  el.push(`<rect x="${f(dx0)}" y="${f(padT - 8)}" width="${f(dx1 - dx0)}" height="${f(usableH + 16)}" fill="url(#tdown)"/>`);
  el.push(`<text x="${f((dx0 + dx1) / 2)}" y="${f(padT - 44)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="12.5" fill="#4a4674" letter-spacing="0.4em">DOWNTOWN</text>`);
  el.push(`<text x="${f((dx0 + dx1) / 2)}" y="${f(H - padB + 34)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="10.5" fill="#37345a" letter-spacing="0.22em">THE FRACTION · RATIO CORE — WHERE THE LINES INTERCHANGE</text>`);

  // grade column labels (top)
  for (let c = 0; c < 13; c++) {
    el.push(`<line x1="${f(colX(c))}" y1="${f(padT - 30)}" x2="${f(colX(c))}" y2="${f(H - padB + 12)}" stroke="#151330" stroke-width="1"/>`);
    el.push(`<text x="${f(colX(c))}" y="${f(padT - 40)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="12" fill="#4a4770" letter-spacing="0.08em">${COL_LABELS[c]}</text>`);
  }

  // light connectors: cross-strand transfers below the interchange floor —
  // a thin arc between the two stations, so lighter transfers still read.
  for (const e of prereq) {
    if (!crossStrand(e)) continue;
    const u = unitOf(e.s), v = unitOf(e.t);
    if (multiStations.has(u) || multiStations.has(v)) continue; // carried by a real interchange
    const A = stationPos.get(u), B = stationPos.get(v);
    if (!A || !B) continue;
    const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2 + (hash("tf" + e.s + e.t) - 0.5) * 16;
    el.push(`<path d="M${f(A[0])},${f(A[1])} Q${f(mx)},${f(my)} ${f(B[0])},${f(B[1])}" fill="none" stroke="#6f6aa2" stroke-width="0.8" stroke-opacity="0.15"/>`);
  }

  // ---- draw the lines: branches first (thin), then trunks with load taper ----
  for (const s of STRAND_ORDER) {
    for (const [u, p] of parentOf) {
      if (byId.get(u).strand !== s) continue;
      const A = stationPos.get(p), B = stationPos.get(u);
      if (!A || !B) continue;
      el.push(`<path d="${toPath(octoChain([A, B]))}" fill="none" stroke="${STRAND[s]}" stroke-width="${f(branchW(carried.get(u) || 0))}" stroke-opacity="0.82" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
  }
  for (const s of STRAND_ORDER) {
    const seq = mainSeqOf.get(s);
    const lr = loadRightOf.get(s);
    // assign each foreign through-stop to the trunk segment its column falls in
    const insert = Array.from({ length: Math.max(0, seq.length - 1) }, () => []);
    for (const v of guestStops.get(s)) {
      const vc = ucol(v);
      let idx = seq.length - 2;
      for (let i = 0; i < seq.length - 1; i++) { if (ucol(seq[i]) <= vc && vc <= ucol(seq[i + 1])) { idx = i; break; } if (vc < ucol(seq[i])) { idx = Math.max(0, i - 1); break; } }
      if (idx >= 0 && idx < insert.length) insert[idx].push(v);
    }
    for (let i = 0; i < seq.length - 1; i++) {
      const via = insert[i].sort((a, b) => ucol(a) - ucol(b) || codeLt(a, b)).map((v) => stationPos.get(v));
      const stations = [stationPos.get(seq[i]), ...via, stationPos.get(seq[i + 1])];
      el.push(`<path d="${toPath(octoChain(stations))}" fill="none" stroke="${STRAND[s]}" stroke-width="${f(trunkW(lr[i + 1] || lr[i]))}" stroke-opacity="0.95" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
  }

  // ---- stations -------------------------------------------------------------
  // families: a single elongated lozenge (one marker, one label) — NOT a stack
  // of same-line dots. It never mimics an interchange.
  const familyUnits = new Set(families.map((p) => p.id));
  const drawn = new Set();
  // ordinary + family stations
  for (const n of unitNodes) {
    const p = stationPos.get(n.id);
    if (!p) continue;
    if (multiStations.has(n.id)) continue; // drawn as a capsule below
    if (familyUnits.has(n.id)) {
      const members = 1 + byId.get(n.id).children.length;
      const w = 9 + Math.min(4, members) * 3.6, h = 8.4;
      el.push(`<rect x="${f(p[0] - w)}" y="${f(p[1] - h / 2)}" width="${f(w * 2)}" height="${f(h)}" rx="${f(h / 2)}" fill="${BG}" fill-opacity="0.82" stroke="${STRAND[n.strand]}" stroke-width="1.7" stroke-opacity="0.95"/>`);
      el.push(`<circle cx="${f(p[0])}" cy="${f(p[1])}" r="2.6" fill="${STRAND[n.strand]}"/>`);
    } else {
      el.push(`<circle cx="${f(p[0])}" cy="${f(p[1])}" r="3" fill="#f4f2fb" stroke="${STRAND[n.strand]}" stroke-width="1.6"/>`);
    }
    drawn.add(n.id);
  }
  // true multi-line interchanges: a capsule enclosing one dot per line colour
  for (const u of multiStations) {
    const p = stationPos.get(u);
    if (!p) continue;
    const lines = [...linesAt.get(u)].sort((a, b) => strandRankOf(a) - strandRankOf(b));
    const R = 4.0 + Math.sqrt(reach(u) / MAXREACH) * 4.4;
    const dotGap = R * 1.15;
    const total = (lines.length - 1) * dotGap;
    const capW = R + total / 2 + 5, capH = R + 5;
    el.push(`<rect x="${f(p[0] - capW)}" y="${f(p[1] - capH)}" width="${f(capW * 2)}" height="${f(capH * 2)}" rx="${f(capH)}" fill="#0a0a16" fill-opacity="0.9" stroke="#d8d4f0" stroke-width="1.5" stroke-opacity="0.9"/>`);
    lines.forEach((ls, i) => {
      const ox = -total / 2 + i * dotGap;
      el.push(`<circle cx="${f(p[0] + ox)}" cy="${f(p[1])}" r="${f(R * 0.62)}" fill="${STRAND[ls]}"/>`);
    });
    drawn.add(u);
  }

  // ---- K origins (left) + HS course termini (right, toward the water) -------
  for (const s of STRAND_ORDER) {
    const seq = mainSeqOf.get(s);
    const start = seq[0];
    const p = stationPos.get(start);
    el.push(`<circle cx="${f(p[0])}" cy="${f(p[1])}" r="5.5" fill="${BG}" stroke="${STRAND[s]}" stroke-width="2.6"/>`);
    el.push(`<text x="${f(p[0] - 12)}" y="${f(p[1] + 4)}" text-anchor="end" font-family="ui-monospace, monospace" font-size="12" fill="${mixHex(STRAND[s], "#ffffff", 0.15)}" letter-spacing="0.08em">${s.toUpperCase()}</text>`);
  }
  // terminus = each strand's rightmost (deepest column) station; label by course
  const HNAME = { A1: "ALGEBRA I", G: "GEOMETRY", A2: "ALGEBRA II", ADV: "ADVANCED" };
  for (const s of STRAND_ORDER) {
    let term = null, tc = -1;
    for (const id of unitIds) if (byId.get(id).strand === s && ucol(id) > tc) { tc = ucol(id); term = id; }
    if (!term) continue;
    const p = stationPos.get(term);
    const course = byId.get(term).grade === "HS" ? byId.get(term).courses[0] : COL_LABELS[tc];
    const label = HNAME[course] || ("GRADE " + course);
    el.push(`<text x="${f(p[0] + 14)}" y="${f(p[1] + 4)}" font-family="ui-monospace, monospace" font-size="11" fill="${mixHex(STRAND[s], "#ffffff", 0.25)}" letter-spacing="0.05em">${s.toUpperCase()} → ${label}</text>`);
  }

  // ---- interchange labels: biggest hubs only, greedy declutter --------------
  const MINGAP = 150;
  const placed = [];
  const labelable = [...multiStations]
    .map((id) => ({ id, p: stationPos.get(id), r: reach(id) }))
    .filter((o) => o.p)
    .sort((a, b) => b.r - a.r || codeLt(a.id, b.id));
  let flip = 0, labels = 0;
  for (const { id, p } of labelable) {
    if (labels >= 20) break;
    if (placed.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < MINGAP)) continue;
    placed.push(p); labels++;
    const ly = flip++ % 2 === 0 ? p[1] - 16 : p[1] + 24;
    el.push(`<rect x="${f(p[0] - byId.get(id).code.length * 3.4 - 3)}" y="${f(ly - 9)}" width="${f(byId.get(id).code.length * 6.8 + 6)}" height="13" rx="3" fill="#0a0a16" fill-opacity="0.72"/>`);
    el.push(`<text x="${f(p[0])}" y="${f(ly)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="10.5" fill="#d4d0f0" letter-spacing="0.02em">${byId.get(id).code}</text>`);
  }

  // legend (top-right) + title
  let lx = 1140;
  for (const s of STRAND_ORDER) {
    el.push(`<line x1="${f(lx)}" y1="60" x2="${f(lx + 24)}" y2="60" stroke="${STRAND[s]}" stroke-width="5" stroke-linecap="round"/>`);
    el.push(`<text x="${f(lx + 31)}" y="64" font-family="ui-monospace, monospace" font-size="12" fill="${INK}" letter-spacing="0.05em">${s.toUpperCase()}</text>`);
    lx += 96 + s.length * 8;
  }
  el.push(`<text x="28" y="52" font-family="ui-monospace, monospace" font-size="20" fill="#e8e6f6" letter-spacing="0.06em">THE TRANSIT MAP · prerequisite knowledge as a metro network</text>`);

  return svg(W, H, el,
    "STRUCTURE from the transfer graph: each line's MAIN LINE is the maximum-reach path through its prereq subgraph (DP longest weighted path); every other standard attaches as a derived BRANCH at its nearest main-line ancestor, trunkless standards hang as spurs at their grade column · heavy cross-strand transfers (≥3 cross-strand prerequisites) are TRUE multi-line interchanges the guest line routes THROUGH — one dot per line in the capsule · families are a single elongated lozenge (one marker, one label — never a false interchange) · grade = column (topological L→R), y solved by barycenter crossing-minimisation, segments octolinear, trunk width = reach flowing through · downtown = the dense grade 3–7 core · 480 standards, deterministic");
}

// ===========================================================================
writeFileSync(resolve(OUT, "formation-watershed.svg"), watershed());
writeFileSync(resolve(OUT, "formation-reef.svg"), reef());
writeFileSync(resolve(OUT, "formation-transit.svg"), transit());
console.log("formation previews written to docs/previews/formation-{watershed,reef,transit}.svg");
