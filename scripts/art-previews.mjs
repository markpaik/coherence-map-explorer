// Art-style previews (design exploration, NOT a build step): renders the real
// graph as four SVG stills — Fidenza-inspired layered flow ribbons and
// Ringers-inspired peg-and-string, each head-on (reads flat) and oblique
// (the 3-D thickness revealed). Deterministic: no randomness, variation is
// hashed from ids. Reads public/data/graph-core.json; writes docs/previews/.
//
// These exist so the designer and Mark can judge the direction on pictures
// before any runtime work. Nothing imports this file.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = resolve(ROOT, "docs/previews");
mkdirSync(OUT, { recursive: true });

const g = JSON.parse(readFileSync(resolve(ROOT, "public/data/graph-core.json"), "utf8"));
const byId = new Map(g.nodes.map((n) => [n.id, n]));

const STRAND = { number: "#c08a1e", algebra: "#8b5cf6", geometry: "#1c9fbb", data: "#de5a85" };
const STRAND_HI = { number: "#e8b04a", algebra: "#b08dfc", geometry: "#4ecbe0", data: "#f288ad" };
const BG = "#050510";

const hash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
};

// Strand z-layers (strata order, front to back in the oblique views).
const LAYER = { number: 0, algebra: 1, geometry: 2, data: 3 };

// ---------------------------------------------------------------------------
// Shared: fit a set of [x, y] points into a canvas with padding.
function fitter(pts, W, H, pad) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const s = Math.min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (y1 - y0));
  return ([x, y]) => [pad + (x - x0) * s, H - pad - (y - y0) * s];
}

// ---------------------------------------------------------------------------
// FIDENZA — layered flow ribbons. Edges are thick tapered ribbons along the
// constellation's own curves; nodes are small color blocks set into the flow.
// Oblique: each strand is a stratum — lifted, sheared, with a dark under-
// shadow, like layered paper cut on a black table.
function fidenza(oblique) {
  const W = 1680, H = 945;
  const fit = fitter(g.nodes.map((n) => n.pos), W, H, 70);
  const el = [];

  // Per-strand shear/lift for the oblique read; zero head-on.
  const lift = (strand) => (oblique ? LAYER[strand] * 26 - 39 : 0);
  const shear = oblique ? 0.16 : 0;
  const squash = oblique ? 0.82 : 1;
  const T = ([x, y], strand) => {
    const yy = H / 2 + (y - H / 2) * squash - lift(strand);
    return [x + (H / 2 - y) * shear, yy];
  };

  const edges = [...g.edges].filter((e) => e.k === 0);
  // Paint back strata first so front strata overlap them.
  edges.sort((a, b) => LAYER[byId.get(b.s).strand] - LAYER[byId.get(a.s).strand]);

  for (const e of edges) {
    const s = byId.get(e.s), t = byId.get(e.t);
    const strand = s.strand;
    const a = T(fit(s.pos), strand);
    const c = T(fit([e.c[0], e.c[1]]), strand);
    const b = T(fit(t.pos), strand);
    const w = 2.2 + (s.deg + t.deg) * 0.55 + hash(e.s + e.t) * 2.4; // ribbon width
    const d = `M${a[0].toFixed(1)},${a[1].toFixed(1)} Q${c[0].toFixed(1)},${c[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}`;
    if (oblique) {
      // Under-shadow: the stratum's thickness, read as a dark offset slab.
      el.push(`<path d="${d}" fill="none" stroke="#000" stroke-opacity="0.55" stroke-width="${(w + 2.5).toFixed(1)}" stroke-linecap="round" transform="translate(2.5,${(4 + LAYER[strand] * 1.5).toFixed(1)})"/>`);
    }
    el.push(`<path d="${d}" fill="none" stroke="${STRAND[strand]}" stroke-opacity="0.92" stroke-width="${w.toFixed(1)}" stroke-linecap="round"/>`);
    // Highlight seam: the ribbon's lit edge (the Fidenza two-tone read).
    el.push(`<path d="${d}" fill="none" stroke="${STRAND_HI[strand]}" stroke-opacity="0.5" stroke-width="${(w * 0.34).toFixed(1)}" stroke-linecap="round" transform="translate(0,-${(w * 0.22).toFixed(1)})"/>`);
  }

  // Nodes as inset color blocks (rotated rects along local flow).
  for (const n of g.nodes) {
    const p = T(fit(n.pos), n.strand);
    const r = 2.6 + Math.sqrt(n.deg) * 1.7;
    const rot = (hash(n.id) - 0.5) * 40;
    if (oblique) {
      el.push(`<rect x="${(p[0] - r).toFixed(1)}" y="${(p[1] - r * 0.8).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 1.6).toFixed(1)}" rx="1.5" fill="#000" opacity="0.5" transform="rotate(${rot.toFixed(0)} ${p[0].toFixed(1)} ${p[1].toFixed(1)}) translate(2,4)"/>`);
    }
    el.push(`<rect x="${(p[0] - r).toFixed(1)}" y="${(p[1] - r * 0.8).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 1.6).toFixed(1)}" rx="1.5" fill="${STRAND_HI[n.strand]}" transform="rotate(${rot.toFixed(0)} ${p[0].toFixed(1)} ${p[1].toFixed(1)})"/>`);
  }

  const label = oblique
    ? "FIDENZA-INSPIRED · OBLIQUE — the strata revealed (each strand a lifted layer with thickness)"
    : "FIDENZA-INSPIRED · HEAD-ON — reads as a flat flow-field composition";
  return svg(W, H, el, label);
}

// ---------------------------------------------------------------------------
// RINGERS — peg and string on the blueprint board. Pegs are the standards
// (rings with a hub); prerequisite edges are strings that leave one peg,
// bow, and wrap the next. Oblique: pegs become short cylinders and each
// string rides at its own height on the peg.
function ringers(oblique) {
  const W = 1680, H = 945;
  const fit = fitter(g.nodes.map((n) => n.pos3), W, H, 80);
  const squash = oblique ? 0.72 : 1;
  const shear = oblique ? 0.22 : 0;
  const T = ([x, y]) => [x + (H / 2 - y) * shear * 0.35, H / 2 + (y - H / 2) * squash];
  const el = [];

  const pegR = (n) => 3.2 + Math.sqrt(n.deg) * 1.9;

  // Strings first (pegs sit on top, the wrap reads).
  for (const e of g.edges) {
    if (e.k !== 0) continue;
    const s = byId.get(e.s), t = byId.get(e.t);
    const a = T(fit(s.pos3));
    const b = T(fit(t.pos3));
    const c = T(fit([e.c3[0], e.c3[1]]));
    // String height on the peg: hashed per edge (the Ringers wrap stack).
    const hgt = oblique ? (hash(e.s + e.t) - 0.5) * 10 : 0;
    const d = `M${a[0].toFixed(1)},${(a[1] + hgt).toFixed(1)} Q${c[0].toFixed(1)},${(c[1] + hgt).toFixed(1)} ${b[0].toFixed(1)},${(b[1] + hgt).toFixed(1)}`;
    el.push(`<path d="${d}" fill="none" stroke="${STRAND[s.strand]}" stroke-opacity="0.62" stroke-width="1.6"/>`);
    // Wrap arc: a partial ring where the string rounds the destination peg.
    const r = pegR(t) + 2.2;
    el.push(`<circle cx="${b[0].toFixed(1)}" cy="${(b[1] + hgt).toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${STRAND[s.strand]}" stroke-opacity="0.5" stroke-width="1.6" stroke-dasharray="${(Math.PI * r * 0.62).toFixed(1)} ${(Math.PI * r * 1.38).toFixed(1)}"/>`);
  }

  // Pegs.
  for (const n of g.nodes) {
    const p = T(fit(n.pos3));
    const r = pegR(n);
    if (oblique) {
      const h = 7 + Math.sqrt(n.deg) * 2.2; // cylinder height
      el.push(`<rect x="${(p[0] - r).toFixed(1)}" y="${p[1].toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${h.toFixed(1)}" fill="#0c0c1e" stroke="${STRAND[n.strand]}" stroke-opacity="0.35" stroke-width="0.8"/>`);
      el.push(`<ellipse cx="${p[0].toFixed(1)}" cy="${(p[1] + h).toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * 0.42).toFixed(1)}" fill="#000" opacity="0.6"/>`);
      el.push(`<ellipse cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * 0.42).toFixed(1)}" fill="${STRAND[n.strand]}"/>`);
      el.push(`<ellipse cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" rx="${(r * 0.45).toFixed(1)}" ry="${(r * 0.19).toFixed(1)}" fill="${BG}"/>`);
    } else {
      el.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${r.toFixed(1)}" fill="${STRAND[n.strand]}"/>`);
      el.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${(r * 0.45).toFixed(1)}" fill="${BG}"/>`);
    }
  }

  const label = oblique
    ? "RINGERS-INSPIRED · OBLIQUE — pegs become cylinders; every string rides its own height"
    : "RINGERS-INSPIRED · HEAD-ON — the coherence map as a string-art board";
  return svg(W, H, el, label);
}

function svg(W, H, el, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${BG}"/>
${el.join("\n")}
<text x="24" y="${H - 20}" font-family="ui-monospace, monospace" font-size="15" fill="#7e7a9c" letter-spacing="0.08em">${label} · 480 standards · 757 prerequisite connections · real data, deterministic</text>
</svg>`;
}

writeFileSync(resolve(OUT, "fidenza-head-on.svg"), fidenza(false));
writeFileSync(resolve(OUT, "fidenza-oblique.svg"), fidenza(true));
writeFileSync(resolve(OUT, "ringers-head-on.svg"), ringers(false));
writeFileSync(resolve(OUT, "ringers-oblique.svg"), ringers(true));
console.log("previews written to docs/previews/");
