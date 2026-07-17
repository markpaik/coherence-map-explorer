// Art-style previews v3 (design exploration, NOT a build step) — Mark's
// direction, 2026-07-17:
//
//  RINGERS: paste/cream-white board; pegs in white/red/yellow/blue/green with
//  BOLD black outlines; strings are pure color (no outline), TAUT, leaving a
//  peg at its outer-edge tangent point and wrapping the destination peg —
//  string-art geometry, not center-to-center curves. v3: the board is TALLER
//  and the axes fit independently, so the pegs breathe vertically.
//
//  FIDENZA: the provided artwork's colorway (teal field; navy, brown-black,
//  cream, yellow, red, mint ribbons); nodes are CUBES that trail short
//  striped segments — Fidenza's signature striped end-caps — before the
//  ribbon runs clean to the next node. v3: the oblique view is a TRUE 3D
//  rotation of the constellation cloud (each node and control point keeps its
//  real z), anamorphic-installation style: the composition resolves flat only
//  from the canonical head-on angle; orbit and the ribbons fan apart in
//  every direction along their constellation depths.
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
const mixHex = (h1, h2, t) => {
  const a = parseInt(h1.slice(1), 16);
  const b = parseInt(h2.slice(1), 16);
  const ch = (sh) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
};

function fitter(pts, W, H, pad) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const s = Math.min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (y1 - y0));
  return ([x, y]) => [pad + (x - x0) * s, H - pad - (y - y0) * s];
}

// Independent per-axis fit: fills BOTH dimensions of the canvas, stretching
// the sparser axis. The Ringers board uses it to air out the pegs vertically
// (the blueprint pose is ~2:1 wide; a uniform fit leaves the rows cramped).
function fitterXY(pts, W, H, pad) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const sx = (W - 2 * pad) / (x1 - x0);
  const sy = (H - 2 * pad) / (y1 - y0);
  return ([x, y]) => [pad + (x - x0) * sx, H - pad - (y - y0) * sy];
}

// ===========================================================================
// RINGERS v2 — cream board, bold-outlined pegs, taut tangent strings.
const R_BG = "#f0ece0"; // paste white
const R_INK = "#1a1712"; // bold outline black
const R_PEG = { number: "#e2a72e", algebra: "#2b5ba8", geometry: "#2e7d52", data: "#c33f2e" };
const R_WHITE = "#faf8f2"; // isolated pegs

function ringers(oblique) {
  // Taller board + independent axis fit: the columns keep their width while
  // the rows stretch to fill the extra height — pegs breathe vertically.
  const W = 1680, H = 1240;
  const fit = fitterXY(g.nodes.map((n) => n.pos3), W, H, 80);
  const squash = oblique ? 0.74 : 1;
  const T = ([x, y]) => [x, H / 2 + (y - H / 2) * squash];
  const el = [];
  const elFront = []; // string segments on the viewer's side of a peg — painted LAST

  const pegR = (n) => 4.2 + Math.sqrt(n.deg) * 2.3;
  const pegH = (n) => 6 + Math.sqrt(n.deg) * 2.4;
  const pegPos = new Map(g.nodes.map((n) => [n.id, T(fit(n.pos3))]));

  // Oblique pegs are cylinders whose faces are ellipses foreshortened by E.
  // The tangent/wrap math runs in an UNFORESHORTENED space (screen y
  // re-inflated by 1/E about the board midline) where those faces are true
  // circles; scaling the results back by E preserves tangency exactly, so
  // strings ATTACH to the drawn faces instead of floating where a full
  // circle's edge would have been. Head-on E = 1 and this is a no-op.
  const E = oblique ? 0.45 : 1;
  const up = (y) => H / 2 + (y - H / 2) / E;
  const dn = (y) => H / 2 + (y - H / 2) * E;

  // Strings: external tangent from source circle to target circle, then a
  // wrap arc continuing around the target — taut string-art geometry.
  for (const e of g.edges) {
    if (e.k !== 0) continue;
    const s = byId.get(e.s), t = byId.get(e.t);
    const A = pegPos.get(e.s), B = pegPos.get(e.t);
    const ra = pegR(s), rb = pegR(t);
    const ax0 = A[0], ay0 = up(A[1]);
    const bx0 = B[0], by0 = up(B[1]);
    const dx = bx0 - ax0, dy = by0 - ay0;
    const d = Math.hypot(dx, dy);
    if (d < ra + rb + 2) continue; // overlapping pegs: skip the string
    const th = Math.atan2(dy, dx);
    // External tangent (same-side): both departure and landing points offset
    // by the same angle phi from the center line. Side hashed per edge.
    const side = hash(e.s + "|" + e.t) < 0.5 ? 1 : -1;
    const phi = Math.acos((ra - rb) / d);
    // Strings ride DOWN the peg cylinders by a hashed amount bounded by the
    // shorter peg's height — wrapped string art, never lifted off the face.
    const hgt = oblique ? hash(e.t + e.s) * Math.min(pegH(s), pegH(t)) * 0.75 : 0;
    const ax = ax0 + ra * Math.cos(th + side * phi);
    const ay = dn(ay0 + ra * Math.sin(th + side * phi)) + hgt;
    const bx = bx0 + rb * Math.cos(th + side * phi);
    const by = dn(by0 + rb * Math.sin(th + side * phi)) + hgt;
    const col = R_PEG[s.strand];
    el.push(`<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${col}" stroke-width="1.7" stroke-opacity="0.85"/>`);
    // Wrap: a partial arc continuing around the target from the landing point
    // — a circular arc in the inflated space, so on screen it traces exactly
    // the rb × rb·E ellipse of the drawn peg face. Sampled as a polyline and
    // split at the silhouette: the back half stays under the peg (occluded
    // when the peg paints over it), the front half repaints on top of the peg
    // so the string visibly wraps the cylinder instead of vanishing behind it.
    const a0 = th + side * phi;
    const N = 22;
    let run = [];
    let runFront = false;
    const flush = () => {
      if (run.length >= 2) {
        const dPath = "M" + run.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L");
        (oblique && runFront ? elFront : el).push(`<path d="${dPath}" fill="none" stroke="${col}" stroke-width="1.7" stroke-opacity="0.85"/>`);
      }
      run = [];
    };
    for (let k = 0; k <= N; k++) {
      const a = a0 + (side * 2.6 * k) / N; // ~150° of wrap
      const front = Math.sin(a) > 0; // screen-y grows downward: below center = viewer side
      const pt = [bx0 + rb * Math.cos(a), dn(by0 + rb * Math.sin(a)) + hgt];
      if (run.length && front !== runFront) {
        run.push(pt);
        flush();
      }
      run.push(pt);
      runFront = front;
    }
    flush();
  }

  // Pegs on top: bold black outlines; white for edgeless standards.
  for (const n of g.nodes) {
    const p = pegPos.get(n.id);
    const r = pegR(n);
    const fill = n.deg === 0 ? R_WHITE : R_PEG[n.strand];
    if (oblique) {
      const h = pegH(n);
      el.push(`<rect x="${(p[0] - r).toFixed(1)}" y="${p[1].toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" stroke="${R_INK}" stroke-width="2.2"/>`);
      el.push(`<ellipse cx="${p[0].toFixed(1)}" cy="${(p[1] + h).toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * E).toFixed(1)}" fill="${fill}" stroke="${R_INK}" stroke-width="2.2"/>`);
      el.push(`<ellipse cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * E).toFixed(1)}" fill="${fill}" stroke="${R_INK}" stroke-width="2.6"/>`);
    } else {
      el.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" stroke="${R_INK}" stroke-width="2.6"/>`);
      if (n.deg > 6) {
        el.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${(r * 0.4).toFixed(1)}" fill="none" stroke="${R_INK}" stroke-width="1.6"/>`);
      }
    }
  }

  el.push(...elFront); // front wrap halves paint over the pegs

  const label = oblique
    ? "RINGERS v3 · OBLIQUE — pegs with height on the taller board; strings wrap the faces and ride down the pegs"
    : "RINGERS v3 · HEAD-ON — taut strings leave the outer edge and wrap the next peg; columns aired out vertically";
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
  // Anamorphic geometry: the flat composition is the CANONICAL PROJECTION of
  // the real 3D constellation (head-on drops z orthographically). Oblique
  // rotates the actual cloud — every node and ribbon control point keeps its
  // constellation z, EXAGGERATED ×1.9 so the slab opens into deep space —
  // with real perspective. No drop shadows anywhere (a shadow is a
  // ground-plane cue that reads as a raised print); depth is carried by
  // perspective scale and by far elements hazing toward the teal field,
  // constellation-in-atmosphere, not bas-relief.
  const AZ = oblique ? 0.66 : 0;  // ~38° orbit
  const TILT = oblique ? 0.2 : 0;
  const ZX = oblique ? 1.9 : 1;   // depth exaggeration
  const D = 1150; // camera distance: near ribbons swell, far ones recede hard
  const ca = Math.cos(AZ), sa = Math.sin(AZ);
  const ct = Math.cos(TILT), st = Math.sin(TILT);
  const proj = ([x, y, z]) => {
    const zx = z * ZX;
    const rx = x * ca + zx * sa;
    const rz0 = zx * ca - x * sa;
    const ry = y * ct - rz0 * st;
    const rz = rz0 * ct + y * st;
    const s = oblique ? D / (D - rz) : 1; // head-on stays flat orthographic
    return [rx * s, ry * s, s, rz];
  };
  // Atmospheric haze: how far toward the field color an element fades at its
  // depth. 0 for everything head-on (the flat print shows true color).
  const fogOf = (rz) => (oblique ? Math.min(0.62, Math.max(0, -rz / 550) * 0.62) : 0);
  // Flat ribbons foreshorten when seen at an angle — the print's chunky
  // strokes become slim strands in space. This is what keeps the turned view
  // airy and constellation-like instead of a solid raised tangle.
  const WF = oblique ? 0.5 : 1;
  // Fit over EVERYTHING that gets drawn (nodes + ribbon control points), so
  // rotated bows never leave the canvas.
  const fitPts = g.nodes.map((n) => proj(n.pos));
  for (const e of g.edges) if (e.k === 0) fitPts.push(proj(e.c));
  const fit = fitter(fitPts, W, H, 70);
  const P = (p3) => {
    const q = proj(p3);
    const [X, Y] = fit(q);
    return [X, Y, q[2], q[3]]; // screen x, screen y, perspective scale, depth
  };
  const el = [];

  const edges = [...g.edges].filter((e) => e.k === 0);
  // Painter's order: head-on keeps the hashed layering (overlaps vary);
  // oblique paints far-to-near by real depth so near ribbons cross OVER far
  // ones — the depth cue that sells the rotation.
  const edgeDepth = new Map(edges.map((e) => [e, proj(e.c)[3]]));
  edges.sort(oblique
    ? (a, b) => edgeDepth.get(a) - edgeDepth.get(b)
    : (a, b) => hash(a.s + a.t) - hash(b.s + b.t));

  for (const e of edges) {
    const s = byId.get(e.s), t = byId.get(e.t);
    const a = P(s.pos);
    const c = P(e.c);
    const b = P(t.pos);
    const ps = c[2]; // perspective scale at the ribbon's middle
    const fog = fogOf(c[3]);
    const seed = hash(e.s + "→" + e.t);
    const col = mixHex(pick(F_PALETTE, seed), F_BG, fog);
    // Ribbon width, wide variance; scaled by perspective so near ribbons
    // thicken and far ones thin — same physical ribbon, different distance.
    const w = (3 + seed * 7 + (s.deg + t.deg) * 0.5) * ps * WF;
    // Clean ribbon runs the middle of the path only — the striped caps own
    // the first and last stretch (Fidenza's segmented ends).
    const t0 = 0.14, t1 = 0.86;
    const p0 = qPoint(a, c, b, t0), p1 = qPoint(a, c, b, t1);
    const cm = qPoint(a, c, b, 0.5);
    const d = `M${p0[0].toFixed(1)},${p0[1].toFixed(1)} Q${(2 * cm[0] - (p0[0] + p1[0]) / 2).toFixed(1)},${(2 * cm[1] - (p0[1] + p1[1]) / 2).toFixed(1)} ${p1[0].toFixed(1)},${p1[1].toFixed(1)}`;
    el.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="${w.toFixed(1)}" stroke-linecap="butt"/>`);

    // Striped caps: short perpendicular bars marching along both cap runs,
    // colors cycling the palette — the segmented ends of the reference.
    for (const [lo, hi, anchor] of [[0.02, t0, e.s], [t1, 0.98, e.t]]) {
      const nSeg = 3 + Math.floor(hash(anchor + e.s + e.t) * 3);
      for (let k = 0; k < nSeg; k++) {
        const tt = lo + ((k + 0.5) / nSeg) * (hi - lo);
        const Q = qPoint(a, c, b, tt);
        const Dg = qTangent(a, c, b, tt);
        const nx = -Dg[1], ny = Dg[0];
        const half = (w * 0.72) + 1.2 * ps;
        const sw = (1.6 + hash(anchor + k) * 2.6) * ps * WF; // stripe thickness
        const sc = mixHex(pick(F_PALETTE, hash(anchor + "s" + k)), F_BG, fog);
        el.push(`<line x1="${(Q[0] - nx * half).toFixed(1)}" y1="${(Q[1] - ny * half).toFixed(1)}" x2="${(Q[0] + nx * half).toFixed(1)}" y2="${(Q[1] + ny * half).toFixed(1)}" stroke="${sc}" stroke-width="${sw.toFixed(1)}"/>`);
      }
    }
  }

  // Nodes: cubes in the artwork palette (strand-mapped), slight rotation; the
  // striped caps trail out of them into the ribbons. Oblique paints far
  // cubes first, scales them by the same perspective as the ribbons, and
  // hazes them by the same depth fog — no shadows.
  const nodesDrawn = [...g.nodes];
  if (oblique) nodesDrawn.sort((a, b) => proj(a.pos)[3] - proj(b.pos)[3]);
  for (const n of nodesDrawn) {
    const p = P(n.pos);
    const r = (3.4 + Math.sqrt(n.deg) * 1.9) * p[2];
    const rot = (hash(n.id) - 0.5) * 34;
    const fill = mixHex(F_NODE[n.strand], F_BG, fogOf(p[3]));
    el.push(`<rect x="${(p[0] - r).toFixed(1)}" y="${(p[1] - r).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}" fill="${fill}" transform="rotate(${rot.toFixed(0)} ${p[0].toFixed(1)} ${p[1].toFixed(1)})"/>`);
  }

  const label = oblique
    ? "FIDENZA v4 · OBLIQUE — orbited ~38°, depth ×1.9, no shadows: near ribbons swell, far ones haze into the field"
    : "FIDENZA v4 · HEAD-ON — the canonical angle where the composition resolves flat";
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
console.log("v3 previews written to docs/previews/");
