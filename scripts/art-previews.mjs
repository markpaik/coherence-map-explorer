// Art-style previews v2 (design exploration, NOT a build step) — Mark's
// direction, 2026-07-17:
//
//  RINGERS: paste/cream-white board; pegs in white/red/yellow/blue/green with
//  BOLD black outlines; strings are pure color (no outline), TAUT, leaving a
//  peg at its outer-edge tangent point and wrapping the destination peg —
//  string-art geometry, not center-to-center curves.
//
//  FIDENZA: the provided artwork's colorway (teal field; navy, brown-black,
//  cream, yellow, red, mint ribbons); nodes are CUBES that trail short
//  striped segments — Fidenza's signature striped end-caps — before the
//  ribbon runs clean to the next node.
//
// Deterministic: no randomness; variation is hashed from ids. Reads
// public/data/graph-core.json; writes docs/previews/. Nothing imports this.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = resolve(ROOT, "docs/previews");
mkdirSync(OUT, { recursive: true });

const g = JSON.parse(readFileSync(resolve(ROOT, "public/data/graph-core.json"), "utf8"));
const byId = new Map(g.nodes.map((n) => [n.id, n]));

const hash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
};
const pick = (arr, t) => arr[Math.min(arr.length - 1, Math.floor(t * arr.length))];

function fitter(pts, W, H, pad) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const s = Math.min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (y1 - y0));
  return ([x, y]) => [pad + (x - x0) * s, H - pad - (y - y0) * s];
}

// ===========================================================================
// RINGERS v2 — cream board, bold-outlined pegs, taut tangent strings.
const R_BG = "#f0ece0"; // paste white
const R_INK = "#1a1712"; // bold outline black
const R_PEG = { number: "#e2a72e", algebra: "#2b5ba8", geometry: "#2e7d52", data: "#c33f2e" };
const R_WHITE = "#faf8f2"; // isolated pegs

function ringers(oblique) {
  const W = 1680, H = 945;
  const fit = fitter(g.nodes.map((n) => n.pos3), W, H, 80);
  const squash = oblique ? 0.74 : 1;
  const T = ([x, y]) => [x, H / 2 + (y - H / 2) * squash];
  const el = [];

  const pegR = (n) => 4.2 + Math.sqrt(n.deg) * 2.3;
  const pegPos = new Map(g.nodes.map((n) => [n.id, T(fit(n.pos3))]));

  // Strings: external tangent from source circle to target circle, then a
  // wrap arc continuing around the target — taut string-art geometry.
  for (const e of g.edges) {
    if (e.k !== 0) continue;
    const s = byId.get(e.s), t = byId.get(e.t);
    const A = pegPos.get(e.s), B = pegPos.get(e.t);
    const ra = pegR(s), rb = pegR(t);
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const d = Math.hypot(dx, dy);
    if (d < ra + rb + 2) continue; // overlapping pegs: skip the string
    const th = Math.atan2(dy, dx);
    // External tangent (same-side): both departure and landing points offset
    // by the same angle phi from the center line. Side hashed per edge.
    const side = hash(e.s + "|" + e.t) < 0.5 ? 1 : -1;
    const phi = Math.acos((ra - rb) / d);
    const ax = A[0] + ra * Math.cos(th + side * phi);
    const ay = A[1] + ra * Math.sin(th + side * phi);
    const bx = B[0] + rb * Math.cos(th + side * phi);
    const by = B[1] + rb * Math.sin(th + side * phi);
    const col = R_PEG[s.strand];
    const hgt = oblique ? (hash(e.t + e.s) - 0.5) * 8 : 0;
    el.push(`<line x1="${ax.toFixed(1)}" y1="${(ay + hgt).toFixed(1)}" x2="${bx.toFixed(1)}" y2="${(by + hgt).toFixed(1)}" stroke="${col}" stroke-width="1.7" stroke-opacity="0.85"/>`);
    // Wrap: a partial arc continuing around the target from the landing point.
    const a0 = th + side * phi;
    const a1 = a0 + side * 2.6; // ~150° of wrap
    const large = 0;
    const wx = B[0] + rb * Math.cos(a1), wy = B[1] + rb * Math.sin(a1);
    el.push(`<path d="M${bx.toFixed(1)},${(by + hgt).toFixed(1)} A${rb.toFixed(1)},${(rb * squash).toFixed(1)} 0 ${large} ${side === 1 ? 1 : 0} ${wx.toFixed(1)},${(wy + hgt).toFixed(1)}" fill="none" stroke="${col}" stroke-width="1.7" stroke-opacity="0.85"/>`);
  }

  // Pegs on top: bold black outlines; white for edgeless standards.
  for (const n of g.nodes) {
    const p = pegPos.get(n.id);
    const r = pegR(n);
    const fill = n.deg === 0 ? R_WHITE : R_PEG[n.strand];
    if (oblique) {
      const h = 6 + Math.sqrt(n.deg) * 2.4;
      el.push(`<rect x="${(p[0] - r).toFixed(1)}" y="${p[1].toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" stroke="${R_INK}" stroke-width="2.2"/>`);
      el.push(`<ellipse cx="${p[0].toFixed(1)}" cy="${(p[1] + h).toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * 0.4).toFixed(1)}" fill="${fill}" stroke="${R_INK}" stroke-width="2.2"/>`);
      el.push(`<ellipse cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * 0.4).toFixed(1)}" fill="${fill}" stroke="${R_INK}" stroke-width="2.6"/>`);
    } else {
      el.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" stroke="${R_INK}" stroke-width="2.6"/>`);
      if (n.deg > 6) {
        el.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${(r * 0.4).toFixed(1)}" fill="none" stroke="${R_INK}" stroke-width="1.6"/>`);
      }
    }
  }

  const label = oblique
    ? "RINGERS v2 · OBLIQUE — pegs with height on the cream board; strings ride the pegs"
    : "RINGERS v2 · HEAD-ON — taut strings leave the outer edge and wrap the next peg";
  return svg(W, H, el, label, R_BG, "#8a8272");
}

// ===========================================================================
// FIDENZA v2 — the provided artwork's colorway; cube nodes with striped
// trailing caps; clean thick ribbons between.
const F_BG = "#43a08b"; // teal field
const F_PALETTE = ["#1e3a6e", "#2e241c", "#e8e0cd", "#e5b93c", "#c94f43", "#bfe3d4"];
const F_NODE = { number: "#e5b93c", algebra: "#1e3a6e", geometry: "#bfe3d4", data: "#c94f43" };

const qPoint = (a, c, b, t) => {
  const u = 1 - t;
  return [
    u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
    u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
  ];
};
const qTangent = (a, c, b, t) => {
  const tx = 2 * (1 - t) * (c[0] - a[0]) + 2 * t * (b[0] - c[0]);
  const ty = 2 * (1 - t) * (c[1] - a[1]) + 2 * t * (b[1] - c[1]);
  const L = Math.hypot(tx, ty) || 1;
  return [tx / L, ty / L];
};

function fidenza(oblique) {
  const W = 1680, H = 945;
  const fit = fitter(g.nodes.map((n) => n.pos), W, H, 70);
  const squash = oblique ? 0.8 : 1;
  const shear = oblique ? 0.14 : 0;
  const T = ([x, y]) => [x + (H / 2 - y) * shear, H / 2 + (y - H / 2) * squash];
  const el = [];

  const edges = [...g.edges].filter((e) => e.k === 0);
  // Depth-sort by hashed layer so overlaps vary; thick ribbons paint later.
  edges.sort((a, b) => hash(a.s + a.t) - hash(b.s + b.t));

  for (const e of edges) {
    const s = byId.get(e.s), t = byId.get(e.t);
    const a = T(fit(s.pos));
    const c = T(fit([e.c[0], e.c[1]]));
    const b = T(fit(t.pos));
    const seed = hash(e.s + "→" + e.t);
    const col = pick(F_PALETTE, seed);
    const w = 3 + seed * 7 + (s.deg + t.deg) * 0.5; // ribbon width, wide variance
    // Clean ribbon runs the middle of the path only — the striped caps own
    // the first and last stretch (Fidenza's segmented ends).
    const t0 = 0.14, t1 = 0.86;
    const p0 = qPoint(a, c, b, t0), p1 = qPoint(a, c, b, t1);
    const cm = qPoint(a, c, b, 0.5);
    const d = `M${p0[0].toFixed(1)},${p0[1].toFixed(1)} Q${(2 * cm[0] - (p0[0] + p1[0]) / 2).toFixed(1)},${(2 * cm[1] - (p0[1] + p1[1]) / 2).toFixed(1)} ${p1[0].toFixed(1)},${p1[1].toFixed(1)}`;
    if (oblique) {
      el.push(`<path d="${d}" fill="none" stroke="#1c2e24" stroke-opacity="0.45" stroke-width="${(w + 2).toFixed(1)}" stroke-linecap="butt" transform="translate(2.5,4)"/>`);
    }
    el.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="${w.toFixed(1)}" stroke-linecap="butt"/>`);

    // Striped caps: short perpendicular bars marching along both cap runs,
    // colors cycling the palette — the segmented ends of the reference.
    for (const [lo, hi, anchor] of [[0.02, t0, e.s], [t1, 0.98, e.t]]) {
      const nSeg = 3 + Math.floor(hash(anchor + e.s + e.t) * 3);
      for (let k = 0; k < nSeg; k++) {
        const tt = lo + ((k + 0.5) / nSeg) * (hi - lo);
        const P = qPoint(a, c, b, tt);
        const D = qTangent(a, c, b, tt);
        const nx = -D[1], ny = D[0];
        const half = (w * 0.72) + 1.2;
        const sw = 1.6 + hash(anchor + k) * 2.6; // stripe thickness
        const sc = pick(F_PALETTE, hash(anchor + "s" + k));
        el.push(`<line x1="${(P[0] - nx * half).toFixed(1)}" y1="${(P[1] - ny * half).toFixed(1)}" x2="${(P[0] + nx * half).toFixed(1)}" y2="${(P[1] + ny * half).toFixed(1)}" stroke="${sc}" stroke-width="${sw.toFixed(1)}"/>`);
      }
    }
  }

  // Nodes: cubes in the artwork palette (strand-mapped), slight rotation; the
  // striped caps trail out of them into the ribbons.
  for (const n of g.nodes) {
    const p = T(fit(n.pos));
    const r = 3.4 + Math.sqrt(n.deg) * 1.9;
    const rot = (hash(n.id) - 0.5) * 34;
    const fill = F_NODE[n.strand];
    if (oblique) {
      el.push(`<rect x="${(p[0] - r).toFixed(1)}" y="${(p[1] - r).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}" fill="#1c2e24" opacity="0.45" transform="rotate(${rot.toFixed(0)} ${p[0].toFixed(1)} ${p[1].toFixed(1)}) translate(2.5,4)"/>`);
    }
    el.push(`<rect x="${(p[0] - r).toFixed(1)}" y="${(p[1] - r).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}" fill="${fill}" transform="rotate(${rot.toFixed(0)} ${p[0].toFixed(1)} ${p[1].toFixed(1)})"/>`);
  }

  const label = oblique
    ? "FIDENZA v2 · OBLIQUE — the ribbons and cubes lifted with thickness"
    : "FIDENZA v2 · HEAD-ON — the provided colorway; cubes trail striped caps into clean ribbons";
  return svg(W, H, el, label, F_BG, "#1e3a6e");
}

function svg(W, H, el, label, bg, ink) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${bg}"/>
${el.join("\n")}
<text x="24" y="${H - 20}" font-family="ui-monospace, monospace" font-size="15" fill="${ink}" letter-spacing="0.08em">${label} · 480 standards · 757 prerequisite connections · real data, deterministic · after Hobbs (curated.xyz/editorial/collecting-fidenza) and Cherniak (curated.xyz/editorial/collecting-ringers)</text>
</svg>`;
}

writeFileSync(resolve(OUT, "ringers-head-on.svg"), ringers(false));
writeFileSync(resolve(OUT, "ringers-oblique.svg"), ringers(true));
writeFileSync(resolve(OUT, "fidenza-head-on.svg"), fidenza(false));
writeFileSync(resolve(OUT, "fidenza-oblique.svg"), fidenza(true));
console.log("v2 previews written to docs/previews/");
