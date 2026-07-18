// Formation previews (design exploration, NOT a build step) — real-data layout
// studies for three candidate formations beyond the shipped three, to the
// designer's specs (docs/FORMATIONS.md). Each expresses ACCUMULATION WITH
// INHERITANCE and obeys the family-membrane law: every family (parent +
// children[]) is co-located as one body.
//
//   WATERSHED — top-down river map, K (headwaters) left → HS (delta/sea) right.
//     Edges ARE the rivers; stroke width = target's descendant reach (discharge).
//   REEF      — cross-section growing upward, K seabed → HS sunlit surface.
//     Accretion coloring (calcified base); families are coral heads.
//   TRANSIT   — octolinear metro map; strands are lines, standards stations,
//     families station complexes, interchanges = cross-strand touch points.
//
// Deterministic: no Math.random / Date; all variation hashed from ids. Reads
// public/data/graph-core.json; writes docs/previews/formation-*.svg. Geometry
// is derived from grade / strand / depth / reach (NOT the pos/pos2/pos3 poses).
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
const STRAND_ORDER = ["number", "algebra", "geometry", "data"]; // number topmost / leftmost

// ---- deterministic helpers ------------------------------------------------
// FNV-1a plus an avalanche mix. A plain polynomial hash with a shared prefix
// (e.g. "rx"+id) barely perturbs the low bits between adjacent ids, collapsing
// the [0,1) spread into a narrow band; the mix restores uniform distribution so
// the id-hash scatter actually scatters.
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
function svg(W, H, el, caption) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${BG}"/>
${el.join("\n")}
<text x="28" y="${H - 22}" font-family="ui-monospace, monospace" font-size="14.5" fill="#7a76a8" letter-spacing="0.06em">${caption}</text>
</svg>`;
}

// ===========================================================================
// 1 · THE WATERSHED — a top-down river map. Grade flows left→right; strand is
// the river system (lane); prerequisite edges are the rivers themselves, their
// width the discharge volume (target's descendant reach). Families are
// tributary mouths clustered just upstream of the parent.
// ===========================================================================
function watershed() {
  const W = 1960, H = 1020;
  const padL = 118, padR = 150, padT = 96, padB = 70;
  const usableW = W - padL - padR;
  const laneH = (H - padT - padB) / 4;
  const laneCenter = (strand) => padT + (STRAND_ORDER.indexOf(strand) + 0.5) * laneH;

  // 13 grade bands with gentle irregular widths (deterministic); HS delta bands
  // (9–12) run a touch wider — the river mouth opens.
  const rawW = [];
  for (let c = 0; c < 13; c++) {
    const jitter = 1 + 0.14 * Math.sin(c * 1.7 + 0.6);
    rawW.push(jitter * (c >= 9 ? 1.16 : 1));
  }
  const sumW = rawW.reduce((a, b) => a + b, 0);
  const bandX = [padL];
  for (let c = 0; c < 13; c++) bandX.push(bandX[c] + (rawW[c] / sumW) * usableW);
  const seaX = bandX[13]; // right edge of the delta = shoreline

  // low-frequency meander per lane (seeded), evaluated on normalized x
  const meander = (strand, xNorm) => {
    const s = STRAND_ORDER.indexOf(strand);
    const A = laneH * 0.19;
    const f1 = 1.3 + hash("mf" + s) * 0.9, p1 = hash("mp" + s) * 6.283;
    const f2 = 2.4 + hash("mg" + s) * 1.2, p2 = hash("mq" + s) * 6.283;
    return A * (0.72 * Math.sin(6.283 * f1 * xNorm + p1) + 0.28 * Math.sin(6.283 * f2 * xNorm + p2));
  };

  // node positions ----------------------------------------------------------
  const pos = new Map();
  for (const n of g.nodes) {
    if (isChild(n.id)) continue; // placed with its parent below
    const c = colOf(n);
    const bx0 = bandX[c] + 6, bx1 = bandX[c + 1] - 6;
    const x = bx0 + depthT(n) * (bx1 - bx0);
    const xNorm = (x - padL) / usableW;
    const hs = n.grade === "HS";
    const spread = laneH * (hs ? 0.62 : 0.42); // the delta fans wider
    const y = laneCenter(n.strand) + meander(n.strand, xNorm) * (hs ? 0.5 : 1)
      + (hash("wy" + n.id) - 0.5) * spread;
    pos.set(n.id, [x, clamp(y, padT - 8, H - padB + 8)]);
  }
  // families: children a few px upstream (left) of the parent, snug in y
  for (const p of families) {
    const [px, py] = pos.get(p.id);
    p.children.forEach((cid, i) => {
      const m = p.children.length;
      const up = 9 + hash("wu" + cid) * 5;
      const yy = py + (i - (m - 1) / 2) * 6.5 + (hash("wc" + cid) - 0.5) * 4;
      pos.set(cid, [px - up, yy]);
    });
  }

  const el = [];
  // the sea: a soft vertical gradient band beyond the delta shoreline, and a
  // painterly rough-edge filter for the whole river layer (ink on wet paper).
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

  // rivers: prereq edges as FRACTAL channels (Mark's Sacramento reference:
  // kinks, curves, randomness — real hydrology, not smooth silk). Each river
  // samples the downstream-leaning cubic as its spine, then displaces every
  // interior vertex perpendicular with two scales of id-hashed noise. Creeks
  // kink sharply; trunk rivers meander broad and slow (kink damped by width).
  // Width = target discharge (sqrt of descendant reach, ~0.8→7px), colored by
  // the river system fed. Thick first so fine tributaries lie on top.
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
    const kink = clamp(11 / (1 + w * 0.85), 1.8, 9.5); // creeks kink harder than trunks
    for (let i = 1; i < segs; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx2, by2] = pts[i + 1];
      let dx = bx2 - ax, dy = by2 - ay;
      const L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L;
      const env = Math.sin(Math.PI * (i / segs)); // endpoints stay pinned
      const coarse = (hash(seedKey + "k" + Math.floor(i / 3)) - 0.5) * 2;
      const fine = (hash(seedKey + "j" + i) - 0.5) * 2;
      const off = (coarse * 0.62 + fine * 0.38) * kink * env * (0.7 + Math.min(1.6, len / 420));
      pts[i] = [pts[i][0] + nx * off, pts[i][1] + ny * off];
    }
    return "M" + pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" L");
  }
  // Painterly hierarchy (Mark: rough, textured, with character — not messy).
  // The Sacramento map is legible because almost everything is a HAIRLINE and
  // only the main stem carries weight. Gamma-crushed widths give that
  // hierarchy; each river then paints in passes: a soft bleeding wash under,
  // the ink stroke over, and a wet highlight down the trunk rivers' centers.
  // Cross-lane distributaries paint fainter and slimmer so the lane trunks
  // own the composition. The whole layer runs through the rough-brush filter.
  const rivers = prereq.map((e) => {
    const t = Math.pow(reach(e.t) / MAXREACH, 0.78);
    const cross = crossStrand(e);
    const w = (0.55 + t * 6.6) * (cross ? 0.7 : 1);
    return { e, w, t, cross };
  }).sort((a, b) => b.w - a.w);
  const washes = [];
  const strokes = [];
  const highlights = [];
  for (const { e, w, t, cross } of rivers) {
    const A = pos.get(e.s), B = pos.get(e.t);
    if (!A || !B) continue;
    const col = STRAND[byId.get(e.t).strand];
    const d = channel(A, B, e.s + "→" + e.t, w);
    const op = clamp(0.2 + t * 0.62, 0.2, 0.85) * (cross ? 0.55 : 1);
    if (w > 1.6) {
      washes.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="${f(w * 1.9)}" stroke-opacity="${f(op * 0.16)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    strokes.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="${f(w)}" stroke-opacity="${f(op)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    if (w > 3.4) {
      highlights.push(`<path d="${d}" fill="none" stroke="${mixHex(col, "#ffffff", 0.45)}" stroke-width="${f(w * 0.32)}" stroke-opacity="${f(op * 0.5)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
  }
  el.push(`<g filter="url(#brush)">`, ...washes, ...strokes, ...highlights, `</g>`);

  // related pairs: faint dotted cross-channels
  for (const e of related) {
    const A = pos.get(e.s), B = pos.get(e.t);
    if (!A || !B) continue;
    el.push(`<line x1="${f(A[0])}" y1="${f(A[1])}" x2="${f(B[0])}" y2="${f(B[1])}" stroke="${INK}" stroke-width="0.8" stroke-opacity="0.22" stroke-dasharray="1.5 4"/>`);
  }

  // nodes: small (rivers carry the composition). WAP standards render as
  // RESERVOIRS — irregular lake blobs, the Sacramento map's dark pools:
  // stored water released to everything downstream, which is exactly what a
  // widely applicable prerequisite is. Blob size grows with reach.
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
  // Reservoirs are RARE, like on a real map: a handful of NAMED lakes. The
  // early grades are a plateau of enormous reach (54 standards clear 185), so
  // no threshold stays rare — take the top 16 by reach, full stop. (K-8
  // wap=1 is a source artifact and must never gate a visual.)
  const reservoirIds = new Set(
    [...g.nodes].sort((a, b) => reach(b.id) - reach(a.id)).slice(0, 16).map((n) => n.id),
  );
  for (const n of g.nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    const r = 1.8 + Math.sqrt(n.deg) * 0.9;
    const isReservoir = reservoirIds.has(n.id);
    if (isReservoir) {
      const rr = r + 3 + Math.sqrt(reach(n.id) / MAXREACH) * 6;
      el.push(`<path d="${reservoir(p[0], p[1], rr, "rv" + n.id)}" fill="#1d4256" fill-opacity="0.62" stroke="#ffd27a" stroke-width="0.8" stroke-opacity="0.45" stroke-linejoin="round"/>`);
    }
    el.push(`<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(r)}" fill="${STRAND[n.strand]}" fill-opacity="0.95"/>`);
  }

  // lane labels at the headwaters (left)
  for (const s of STRAND_ORDER) {
    el.push(`<text x="26" y="${f(laneCenter(s) + 4)}" font-family="ui-monospace, monospace" font-size="13" fill="${mixHex(STRAND[s], BG, 0.15)}" letter-spacing="0.08em">${s.toUpperCase()}</text>`);
  }
  el.push(`<text x="${f(seaX + 14)}" y="${padT - 40}" font-family="ui-monospace, monospace" font-size="12.5" fill="#4a7a90" letter-spacing="0.1em">SEA</text>`);
  el.push(`<text x="28" y="52" font-family="ui-monospace, monospace" font-size="20" fill="#e8e6f6" letter-spacing="0.06em">THE WATERSHED · prerequisite knowledge as a river system</text>`);

  return svg(W, H, el,
    "Grade flows K (headwaters, left) → high school (delta and sea, right); 4 strand lanes braid and meander · rivers kink and meander like real hydrology (fractal channels) · river WIDTH = the target standard's descendant reach (discharge volume, √-scaled 0.8–7px) · cross-lane rivers are distributaries · steel-blue reservoir = widely applicable prerequisite (stored water, released downstream) · dotted = related pair · families cluster as tributary mouths just upstream of the parent · 480 standards, 757 prerequisite rivers, real data, deterministic");
}

// ===========================================================================
// 2 · THE REEF — a cross-section growing upward by accretion. K at the seabed,
// HS at the sunlit surface. Grade is the shelf (y), strand the zone (x). The
// calcified base (K–2) is desaturated toward bone; families are coral heads,
// children budding directly on the parent as one colony.
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

  // accretion tint: K–2 calcified toward bone; 3–8 full color; HS brightened.
  const reefColor = (n) => {
    const c = colOf(n);
    const base = STRAND[n.strand];
    if (c <= 2) return mixHex(base, BONE, 0.64); // calcified skeleton
    if (c >= 9) return mixHex(base, "#ffffff", 0.24); // sunlit surface
    return base;
  };

  const pos = new Map();
  for (const n of g.nodes) {
    if (isChild(n.id)) continue;
    const c = colOf(n);
    const x = zoneCenterX(n.strand) + (hash("rx" + n.id) - 0.5) * zoneW * 1.06; // soft overlap
    const y = shelfCenterY(c) + (hash("ry" + n.id) - 0.5) * shelfH * 0.68;
    pos.set(n.id, [clamp(x, padL - 40, W - padR + 20), y]);
  }
  const headR = (n) => 2.6 + Math.sqrt(n.deg) * 1.05 + Math.sqrt(reach(n.id) / MAXREACH) * 3.0;
  // coral heads: children bud directly ON the parent, touching, hashed angle
  for (const p of families) {
    const [px, py] = pos.get(p.id);
    const pr = headR(p);
    p.children.forEach((cid, i) => {
      const cr = 2.4 + Math.sqrt(byId.get(cid).deg) * 0.8;
      const ang = hash("ra" + cid) * 6.283 + i * 1.1;
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
  // light shafts raking down from the surface — thin, slanted, barely there
  for (let i = 0; i < 4; i++) {
    const sx = padL + (0.16 + 0.66 * (i / 3) + (hash("sh" + i) - 0.5) * 0.05) * usableW;
    const sw = 26 + hash("sw" + i) * 34;
    const slant = 130 + hash("sl" + i) * 90; // rake so shafts read as light, not columns
    el.push(`<polygon points="${f(sx)},${padT - 20} ${f(sx + sw)},${padT - 20} ${f(sx + slant + sw * 0.5)},${f(H - padB)} ${f(sx + slant - sw * 0.5)},${f(H - padB)}" fill="url(#shaft)"/>`);
  }

  // shelf guides + grade labels (left)
  for (let c = 0; c < 13; c++) {
    const y = shelfCenterY(c);
    el.push(`<line x1="${padL - 46}" y1="${f(y)}" x2="${f(W - padR)}" y2="${f(y)}" stroke="#151c22" stroke-width="1"/>`);
    el.push(`<text x="${padL - 56}" y="${f(y + 4)}" text-anchor="end" font-family="ui-monospace, monospace" font-size="12.5" fill="#3f5560" letter-spacing="0.08em">${COL_LABELS[c]}</text>`);
  }
  // strand zone labels (top)
  for (const s of STRAND_ORDER) {
    el.push(`<text x="${f(zoneCenterX(s))}" y="${padT - 34}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="13" fill="${mixHex(STRAND[s], BG, 0.15)}" letter-spacing="0.08em">${s.toUpperCase()}</text>`);
  }

  // deterministic rising bubbles (life)
  for (let i = 0; i < 150; i++) {
    const bx = padL + hash("bx" + i) * usableW;
    const by = padT + hash("by" + i) * usableH;
    const br = 0.6 + hash("br" + i) * 1.8;
    el.push(`<circle cx="${f(bx)}" cy="${f(by)}" r="${f(br)}" fill="#bfe8e0" fill-opacity="0.15"/>`);
  }

  // prereq as slender upward current wisps (curved, faint, only lightly
  // reach-scaled — the reef is about accretion, not flow)
  for (const e of prereq) {
    const A = pos.get(e.s), B = pos.get(e.t);
    if (!A || !B) continue;
    const w = 0.5 + Math.sqrt(reach(e.t) / MAXREACH) * 1.3;
    const midY = (A[1] + B[1]) / 2;
    const bow = (hash("rb" + e.s + e.t) - 0.5) * 40;
    const d = `M${f(A[0])},${f(A[1])} Q${f((A[0] + B[0]) / 2 + bow)},${f(midY)} ${f(B[0])},${f(B[1])}`;
    el.push(`<path d="${d}" fill="none" stroke="${mixHex(STRAND[byId.get(e.t).strand], "#8fd0c8", 0.4)}" stroke-width="${f(w)}" stroke-opacity="0.2" stroke-linecap="round"/>`);
  }
  // related: short dotted lateral ties
  for (const e of related) {
    const A = pos.get(e.s), B = pos.get(e.t);
    if (!A || !B) continue;
    el.push(`<line x1="${f(A[0])}" y1="${f(A[1])}" x2="${f(B[0])}" y2="${f(B[1])}" stroke="${INK}" stroke-width="0.8" stroke-opacity="0.2" stroke-dasharray="1.5 4"/>`);
  }

  // seabed line (slightly wavy), calcified stone
  {
    const y0 = H - padB - shelfH * 0.02;
    let d = `M${padL - 46},${f(y0)}`;
    for (let x = padL - 46; x <= W - padR; x += 40) {
      d += ` L${f(x)},${f(y0 + Math.sin(x * 0.03) * 3)}`;
    }
    el.push(`<path d="${d}" fill="none" stroke="${mixHex(BONE, BG, 0.35)}" stroke-width="2.2" stroke-opacity="0.55"/>`);
  }

  // nodes: coral heads. Parents drawn first (larger), children bud on top —
  // one colony. Non-family nodes are polyps of the reef.
  const drawNode = (n, r, colOverride) => {
    const p = pos.get(n.id);
    const col = colOverride ?? reefColor(n);
    el.push(`<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(r)}" fill="${col}" fill-opacity="0.95"/>`);
    if (n.wap) el.push(`<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(r + 2)}" fill="none" stroke="#ffd27a" stroke-width="1" stroke-opacity="0.7"/>`);
  };
  // colonies first (parent head then buds)
  for (const p of families) {
    drawNode(p, headR(p));
    for (const cid of p.children) drawNode(byId.get(cid), 2.4 + Math.sqrt(byId.get(cid).deg) * 0.8);
  }
  // remaining polyps
  for (const n of g.nodes) {
    if (isChild(n.id) || (n.children && n.children.length)) continue;
    drawNode(n, 2.4 + Math.sqrt(n.deg) * 1.0);
  }

  el.push(`<text x="28" y="52" font-family="ui-monospace, monospace" font-size="20" fill="#e8e6f6" letter-spacing="0.06em">THE REEF · prerequisite knowledge as accretion</text>`);
  return svg(W, H, el,
    "Grows upward by accretion: K on the seabed → high school at the sunlit surface (13 shelves) · 4 strand zones across (soft overlap) · K–2 renders calcified toward bone, grades 3–8 full color, HS brightened by the light shafts · families are CORAL HEADS — children bud directly on the parent as one colony · wisps = prerequisite currents (lightly reach-scaled) · dotted = related pair · gold ring = widely applicable prerequisite · 480 standards, real data, deterministic");
}

// ===========================================================================
// 3 · THE TRANSIT MAP — a real city metro, not a lane diagram. A downtown LOOP
// (CTA-style elevated ring) holds the dense cross-strand core (grades ~3–7, the
// fraction·ratio·expression spine, where 86 of the map's 159 cross-strand
// transfers live). The four strand lines RADIATE in from four compass origins as
// K, converge and weave through the Loop, then peel off EAST and BRANCH into
// their high-school course termini (A1/G/A2/ADV) along the water — the same sea
// the Watershed empties into (one world, two maps). Rules distilled from the
// CTA (a true downtown Loop with radial branches), the Tube & Vignelli NYC
// (octolinear 0/45/90°, long straights, trunk-sharing that splits near the
// periphery), and BART (radial spokes meeting through a single core). Number is
// the hub strand (heaviest transfers to everyone); Algebra shadows it on the
// ring as a shared trunk so their 86 transfers become co-located interchanges
// rather than drawn connectors — which is exactly what real maps do. Within-
// strand sequence is carried by the line itself (grade→depth→code sort), not the
// literal prerequisite chain — the honest stylization noted in the caption.
// ===========================================================================
function transit() {
  const W = 1960, H = 1120;
  const seaX = 1756;

  // ---- downtown Loop rectangle + the eastern sea (geographic anchor) --------
  const LOOP = { x0: 560, y0: 384, x1: 1000, y1: 804 };
  const cxM = (LOOP.x0 + LOOP.x1) / 2, cyM = (LOOP.y0 + LOOP.y1) / 2;
  const corner = [[LOOP.x0, LOOP.y0], [LOOP.x1, LOOP.y0], [LOOP.x1, LOOP.y1], [LOOP.x0, LOOP.y1]];
  // perimeter param t∈[0,4): 0–1 top L→R · 1–2 right T→B · 2–3 bottom R→L · 3–4 left B→T
  const perim = (t) => {
    t = ((t % 4) + 4) % 4;
    const s = Math.floor(t), fr = t - s;
    const a = corner[s], b = corner[(s + 1) % 4];
    return [a[0] + (b[0] - a[0]) * fr, a[1] + (b[1] - a[1]) * fr];
  };
  const perimNormal = (t) => [[0, -1], [1, 0], [0, 1], [-1, 0]][Math.floor((((t % 4) + 4) % 4))];
  const perimPt = (t, off) => { const p = perim(t), n = perimNormal(t); return [p[0] + n[0] * off, p[1] + n[1] * off]; };
  // ordered edge-following points from t0 to t1 in direction dir (+1/−1),
  // bundled outward by off px so co-running lines nest visibly (NYC trunk).
  const perimWalk = (t0, t1, dir, off) => {
    const total = dir > 0 ? (((t1 - t0) % 4) + 4) % 4 : (((t0 - t1) % 4) + 4) % 4;
    const raw = [t0];
    let t = t0, acc = 0, guard = 0;
    while (guard++ < 12) {
      const c = dir > 0 ? Math.floor(t + 1e-6) + 1 : Math.ceil(t - 1e-6) - 1;
      const dt = dir > 0 ? c - t : t - c;
      if (dt >= total - acc - 1e-6) break;
      raw.push(c); acc += dt; t = c;
    }
    raw.push(t1);
    return raw.map((tt) => perimPt(tt, off));
  };

  // octolinear elbow a→b: straight run then a 45° final segment into b.
  const elbow = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx < 1 || ady < 1) return [a, b];
    const sx = Math.sign(dx), sy = Math.sign(dy);
    return adx > ady ? [a, [b[0] - sx * ady, a[1]], b] : [a, [a[0], b[1] - sy * adx], b];
  };
  const toPath = (pts) => "M" + pts.map((p) => `${f(p[0])},${f(p[1])}`).join(" L");
  const plen = (pts) => { const seg = [0]; let L = 0; for (let i = 1; i < pts.length; i++) { L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(L); } return { L, seg }; };
  const at = (pts, seg, L, fr) => {
    const d = clamp(fr, 0, 1) * L;
    let i = 1; while (i < seg.length - 1 && seg[i] < d) i++;
    const p0 = pts[i - 1], p1 = pts[i], sl = (seg[i] - seg[i - 1]) || 1, u = (d - seg[i - 1]) / sl;
    const tx = (p1[0] - p0[0]) / sl, ty = (p1[1] - p0[1]) / sl;
    return [p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u, tx, ty];
  };

  const BUNDLE = 11;
  // per-strand routing, CTA-style: the four Loop sides are each OWNED by a
  // line's downtown stretch (like Wells/Lake/Wabash/Van Buren), handing off at
  // corner interchanges. Number (the hub, most downtown stations) runs the WEST
  // then NORTH sides; Algebra shadows it on NORTH then turns down the EAST;
  // Geometry runs the SOUTH; Data is the cross-town diagonal (a subway cutting
  // through the core). entryT/exitT are Loop perimeter params; dir the way
  // around; lane the bundle offset; junc the branch split east of the Loop;
  // tx/ty0/ty1 the eastern terminus fan (toward the water).
  const CFG = {
    number:  { origin: [70, 706], entryT: 3.0, exitT: 1.0, dir: +1, lane: 0, junc: [1150, 300], tx: 1470, ty0: 200, ty1: 380 },
    algebra: { origin: [150, 150], entryT: 0.06, exitT: 1.5, dir: +1, lane: 1, junc: [1150, 470], tx: 1500, ty0: 400, ty1: 560 },
    geometry:{ origin: [150, H - 150], entryT: 3.0, exitT: 2.0, dir: -1, lane: 0, junc: [1150, 840], tx: 1500, ty0: 804, ty1: 904 },
    data:    { diagonal: true, origin: [700, 86], enter: [700, LOOP.y0], exit: [LOOP.x1, LOOP.y0 + (LOOP.x1 - 700)], junc: [1185, 700], tx: 1545, ty0: 628, ty1: 788 },
  };
  const HORDER = ["A1", "G", "A2", "ADV"];
  const HNAME = { A1: "ALGEBRA I", G: "GEOMETRY", A2: "ALGEBRA II", ADV: "ADVANCED" };

  const el = [];
  const stationPos = new Map(); // node id → [x, y]
  const mainStrokes = [];       // { strand, d }
  const branchStrokes = [];     // { strand, d, term, course }
  const complexes = [];         // { strand, pts, cx, cy }

  const bySort = (a, b) => a.col - b.col || a.key.depth - b.key.depth || (a.key.code < b.key.code ? -1 : 1);
  // lay a phase's units along a polyline; families fan perpendicular into a pill
  const distribute = (path, units, m0, m1) => {
    if (!units.length) return;
    const { L, seg } = plen(path);
    const n = units.length;
    units.forEach((u, i) => {
      const fr = n === 1 ? m0 + (1 - m0 - m1) * 0.5 : m0 + ((i + 0.5) / n) * (1 - m0 - m1);
      const [x, y, tx, ty] = at(path, seg, L, fr);
      const px = -ty, py = tx; // perpendicular
      const m = u.members, gap = m.length > 1 ? 8.5 : 0;
      const mp = m.map((mn, j) => {
        const o = (j - (m.length - 1) / 2) * gap;
        const pt = [x + px * o, y + py * o];
        stationPos.set(mn.id, pt);
        return pt;
      });
      if (m.length > 1) complexes.push({ strand: u.strand, pts: mp, cx: x, cy: y });
    });
  };

  for (const strand of STRAND_ORDER) {
    const c = CFG[strand];
    const mine = g.nodes.filter((n) => n.strand === strand && !isChild(n.id));
    const units = mine.map((n) => ({
      strand, key: n, col: colOf(n),
      members: n.children && n.children.length ? [n, ...n.children.map((k) => byId.get(k))] : [n],
    }));
    const approach = [], loop = [], branch = {};
    for (const u of units) {
      if (u.col <= 3) approach.push(u);
      else if (u.col <= 8) loop.push(u);
      else (branch[u.key.courses[0]] = branch[u.key.courses[0]] || []).push(u);
    }
    approach.sort(bySort); loop.sort(bySort);

    // build the three-phase spine
    let approachPath, loopPath, egressPath;
    if (c.diagonal) {
      approachPath = [c.origin, c.enter];
      loopPath = [c.enter, c.exit];
      egressPath = elbow(c.exit, c.junc);
    } else {
      approachPath = elbow(c.origin, perimPt(c.entryT, c.lane * BUNDLE));
      loopPath = perimWalk(c.entryT, c.exitT, c.dir, c.lane * BUNDLE);
      egressPath = elbow(perimPt(c.exitT, c.lane * BUNDLE), c.junc);
    }
    distribute(approachPath, approach, 0.05, 0.05);
    distribute(loopPath, loop, 0.015, 0.015);

    const main = approachPath.concat(loopPath.slice(1), egressPath.slice(1));
    mainStrokes.push({ strand, d: toPath(main) });

    const present = HORDER.filter((cr) => branch[cr] && branch[cr].length);
    present.forEach((cr, i) => {
      const ty = present.length === 1 ? (c.ty0 + c.ty1) / 2 : c.ty0 + (c.ty1 - c.ty0) * (i / (present.length - 1));
      const long = branch[cr].length > 15; // dense yards reach further east
      const term = [c.tx + (long ? 150 : 0), ty];
      const bpath = elbow(c.junc, term);
      distribute(bpath, branch[cr].sort(bySort), 0.07, 0.10);
      branchStrokes.push({ strand, d: toPath(bpath), term, course: cr });
    });
  }

  // ---- draw order: back → front --------------------------------------------
  // the sea beyond the eastern shoreline (the delta the Watershed empties into)
  el.push(`<defs>
<linearGradient id="tsea" x1="0" y1="0" x2="1" y2="0">
<stop offset="0%" stop-color="#16324a" stop-opacity="0"/>
<stop offset="55%" stop-color="#16324a" stop-opacity="0.5"/>
<stop offset="100%" stop-color="#1d4a63" stop-opacity="0.85"/>
</linearGradient>
<radialGradient id="tdown" cx="50%" cy="50%" r="62%">
<stop offset="0%" stop-color="#1a1838" stop-opacity="0.9"/>
<stop offset="100%" stop-color="#12102a" stop-opacity="0"/>
</radialGradient></defs>`);
  el.push(`<rect x="${f(seaX)}" y="0" width="${f(W - seaX)}" height="${H}" fill="url(#tsea)"/>`);
  el.push(`<line x1="${f(seaX)}" y1="0" x2="${f(seaX)}" y2="${H}" stroke="#2a5a72" stroke-width="1" stroke-opacity="0.5"/>`);
  el.push(`<text x="${f(seaX + 16)}" y="60" font-family="ui-monospace, monospace" font-size="12.5" fill="#4a7a90" letter-spacing="0.14em">SEA</text>`);

  // downtown district: a soft glow + the LOOP track guide (a faint dotted
  // rectangle, like the CTA's elevated Loop) + labels, so the core reads as a
  // real downtown ring even where a colored line doesn't cover a full side.
  el.push(`<rect x="${f(LOOP.x0 - 70)}" y="${f(LOOP.y0 - 70)}" width="${f(LOOP.x1 - LOOP.x0 + 140)}" height="${f(LOOP.y1 - LOOP.y0 + 140)}" fill="url(#tdown)"/>`);
  el.push(`<rect x="${f(LOOP.x0)}" y="${f(LOOP.y0)}" width="${f(LOOP.x1 - LOOP.x0)}" height="${f(LOOP.y1 - LOOP.y0)}" rx="3" fill="none" stroke="#3c3960" stroke-width="2" stroke-opacity="0.7" stroke-dasharray="2 7"/>`);
  el.push(`<text x="${f(cxM)}" y="${f(cyM - 4)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="15" fill="#3a3760" letter-spacing="0.46em">THE LOOP</text>`);
  el.push(`<text x="${f(cxM)}" y="${f(cyM + 18)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="10.5" fill="#302d4c" letter-spacing="0.2em">DOWNTOWN · GRADES 3 – 7 · THE FRACTION–RATIO CORE</text>`);

  // transfers: cross-strand prereq edges as faint connector arcs — drawn ONLY
  // where the two stations are not already co-located (a shared interchange).
  for (const e of prereq) {
    if (!crossStrand(e)) continue;
    const A = stationPos.get(e.s), B = stationPos.get(e.t);
    if (!A || !B) continue;
    const dist = Math.hypot(A[0] - B[0], A[1] - B[1]);
    if (dist < 26) continue;   // already a shared interchange — no connector needed
    if (dist > 430) continue;  // cross-map hauls read as haze; the shared trunk carries them
    const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2 + (hash("tf" + e.s + e.t) - 0.5) * 20;
    el.push(`<path d="M${f(A[0])},${f(A[1])} Q${f(mx)},${f(my)} ${f(B[0])},${f(B[1])}" fill="none" stroke="#6f6aa2" stroke-width="0.9" stroke-opacity="0.16"/>`);
  }

  // the lines: branches first (thinner tail), then the trunks over them.
  for (const { strand, d } of branchStrokes) {
    el.push(`<path d="${d}" fill="none" stroke="${STRAND[strand]}" stroke-width="4.4" stroke-opacity="0.9" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  for (const { strand, d } of mainStrokes) {
    el.push(`<path d="${d}" fill="none" stroke="${STRAND[strand]}" stroke-width="5" stroke-opacity="0.96" stroke-linecap="round" stroke-linejoin="round"/>`);
  }

  // station complexes: a pill around a family's parent + child platform dots
  for (const cx of complexes) {
    const xs = cx.pts.map((p) => p[0]), ys = cx.pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const r = 8;
    el.push(`<rect x="${f(x0 - r)}" y="${f(y0 - r)}" width="${f(x1 - x0 + 2 * r)}" height="${f(y1 - y0 + 2 * r)}" rx="${r}" fill="${BG}" fill-opacity="0.6" stroke="${STRAND[cx.strand]}" stroke-width="1.6" stroke-opacity="0.9"/>`);
  }

  // stations. Interchange = white disc + dark ring, sized by descendant reach
  // (the big hubs swell downtown); ordinary station = small white core + ring.
  for (const strand of STRAND_ORDER) {
    for (const n of g.nodes) {
      if (n.strand !== strand) continue;
      const p = stationPos.get(n.id);
      if (!p) continue;
      if (interchange.has(n.id)) {
        const r = 4.2 + Math.sqrt(reach(n.id) / MAXREACH) * 4.6;
        el.push(`<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(r)}" fill="#f4f2fb" stroke="#0a0a16" stroke-width="1.8"/>`);
      } else {
        el.push(`<circle cx="${f(p[0])}" cy="${f(p[1])}" r="3" fill="#f4f2fb" stroke="${STRAND[strand]}" stroke-width="1.6"/>`);
      }
    }
  }

  // K origin tags (radial entrances) + HS branch termini labels (toward water)
  for (const strand of STRAND_ORDER) {
    const c = CFG[strand];
    const o = c.origin;
    el.push(`<circle cx="${f(o[0])}" cy="${f(o[1])}" r="5.5" fill="${BG}" stroke="${STRAND[strand]}" stroke-width="2.4"/>`);
    const anchor = o[0] < 200 ? "start" : "middle";
    const ox = o[0] < 200 ? o[0] + 12 : o[0];
    const oy = o[1] < 200 ? o[1] - 12 : (o[1] > H - 200 ? o[1] + 22 : o[1] - 12);
    el.push(`<text x="${f(ox)}" y="${f(oy)}" text-anchor="${anchor}" font-family="ui-monospace, monospace" font-size="12" fill="${mixHex(STRAND[strand], "#ffffff", 0.15)}" letter-spacing="0.1em">${strand.toUpperCase()} · K</text>`);
  }
  for (const { strand, term, course } of branchStrokes) {
    el.push(`<circle cx="${f(term[0])}" cy="${f(term[1])}" r="4.4" fill="${STRAND[strand]}" stroke="${BG}" stroke-width="1.4"/>`);
    el.push(`<text x="${f(term[0] + 10)}" y="${f(term[1] + 4)}" font-family="ui-monospace, monospace" font-size="11" fill="${mixHex(STRAND[strand], "#ffffff", 0.25)}" letter-spacing="0.06em">${HNAME[course]}</text>`);
  }

  // interchange labels: the biggest downtown hubs only (reach ≥ 70), decluttered
  // greedily so no two land within MINGAP — the metro-map sparseness the eye needs.
  const MINGAP = 132;
  const placed = [];
  const labelable = g.nodes
    .filter((n) => interchange.has(n.id) && reach(n.id) >= 78 && !isChild(n.id))
    .map((n) => ({ n, p: stationPos.get(n.id) }))
    .filter((o) => o.p)
    .sort((a, b) => reach(b.n.id) - reach(a.n.id));
  let flip = 0;
  for (const { n, p } of labelable) {
    if (placed.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < MINGAP)) continue;
    placed.push(p);
    const ly = flip++ % 2 === 0 ? p[1] - 13 : p[1] + 20;
    el.push(`<text x="${f(p[0])}" y="${f(ly)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="10.5" fill="#c4c0e6" letter-spacing="0.02em">${n.code}</text>`);
  }

  // legend (top-right, clear of the radial origins and the SEA tag) + title
  let lx = 1120;
  for (const s of STRAND_ORDER) {
    el.push(`<line x1="${f(lx)}" y1="62" x2="${f(lx + 24)}" y2="62" stroke="${STRAND[s]}" stroke-width="5" stroke-linecap="round"/>`);
    el.push(`<text x="${f(lx + 31)}" y="66" font-family="ui-monospace, monospace" font-size="12" fill="${INK}" letter-spacing="0.05em">${s.toUpperCase()}</text>`);
    lx += 96 + s.length * 8;
  }
  el.push(`<text x="28" y="52" font-family="ui-monospace, monospace" font-size="20" fill="#e8e6f6" letter-spacing="0.06em">THE TRANSIT MAP · prerequisite knowledge as a metro network</text>`);

  return svg(W, H, el,
    "A real city, not four lanes: the four strand lines RADIATE from their own K origin (Number from the west, Algebra the northwest, Geometry the southwest, Data the north), CONVERGE and weave through a downtown LOOP (the dense grade 3–7 fraction·ratio·expression core, where most cross-strand transfers live), then peel EAST and BRANCH into their high-school course termini by the water · Number is the hub trunk, Algebra shadows it on the ring so their 86 shared transfers become co-located interchanges, not drawn lines · Data cuts through the core as the cross-town diagonal · octolinear 0/45/90° · white discs = cross-strand interchanges, sized by descendant reach · pills = family station complexes · the LINE carries within-strand order (grade→depth→code, a stylization, not the literal chain) · 480 standards, real data, deterministic");
}

// ===========================================================================
writeFileSync(resolve(OUT, "formation-watershed.svg"), watershed());
writeFileSync(resolve(OUT, "formation-reef.svg"), reef());
writeFileSync(resolve(OUT, "formation-transit.svg"), transit());
console.log("formation previews written to docs/previews/formation-{watershed,reef,transit}.svg");
