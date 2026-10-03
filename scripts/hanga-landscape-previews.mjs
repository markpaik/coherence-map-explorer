// HANGA landscape previews (design exploration, NOT a build step).
//
// The two Hanga fields (Washi daylight, Indigo dusk) with a real 3D landscape
// around the Constellation pose: four concentric ridge rings (vertical
// cylinder walls with a mountain silhouette along the top edge), one volcanic
// cone on the far ring, suyari-gasumi mist bands between the rings, a faint
// water floor well below the map, and a sky body (sun or moon) on the sky
// shell. Everything is modelled in world units and projected through one
// perspective camera, so the same numbers survive an orbit in three.js.
//
// The map drawing (pigments, tapered brush strokes, printed discs, related
// dabs, paper grain) is copied from hanga-previews.mjs. That script writes its
// four sheets as a side effect of import, so this one copies the helpers.
//
// Deterministic: no randomness; all variation is hashed. Reads
// public/data/graph-core.json; writes docs/previews/hanga-*-landscape-*.svg.
// Nothing imports this.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = resolve(ROOT, "docs/previews");
mkdirSync(OUT, { recursive: true });

const g = JSON.parse(readFileSync(resolve(ROOT, "public/data/graph-core.json"), "utf8"));
const byId = new Map(g.nodes.map((n) => [n.id, n]));

// --- helpers (copied from hanga-previews.mjs) --------------------------------
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
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
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };

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

// --- fields and pigments (copied) -------------------------------------------
const FIELDS = {
  washi: {
    name: "Washi daylight",
    paper: "#efe6d2",
    mid: "#efe6d2",
    sumi: "#1c1a17",
    pigment: { number: "#ad7408", algebra: "#8250a6", geometry: "#16808a", data: "#c8364a" },
  },
  dusk: {
    name: "Indigo dusk",
    top: "#12233f",
    bottom: "#4a6185",
    sumi: "#ece3cf",
    pigment: { number: "#eab64a", algebra: "#b99ae2", geometry: "#5cc2b6", data: "#f07c72" },
  },
};
FIELDS.dusk.mid = mixHex(FIELDS.dusk.top, FIELDS.dusk.bottom, 0.5);
FIELDS.dusk.paper = FIELDS.dusk.mid;

const STRANDS = ["number", "algebra", "geometry", "data"];
const STRAND_LABEL = { number: "Number", algebra: "Algebra", geometry: "Geometry", data: "Data" };
const BOKASHI_DEEP = {
  washi: { number: "#7a4a00", algebra: "#4e2a78", geometry: "#0b4f63", data: "#8e1830" },
  dusk: { number: "#b8790e", algebra: "#7c5cb8", geometry: "#2a8f8c", data: "#c8473f" },
};
const BOKASHI_LIGHT = {
  washi: { number: "#f0b628", algebra: "#b98ad8", geometry: "#56b8b4", data: "#ee7a76" },
  dusk: { number: "#fbe3a0", algebra: "#e2d2f6", geometry: "#b4ece2", data: "#fbc0b0" },
};

// The field gradients from hanga-previews.mjs, as data, so the mist can be
// filled with the exact field color behind it (opaque composite).
const SKY_STOPS = {
  washi: {
    base: "#efe6d2",
    layers: [
      [[0, "#1f3a5f", 1], [0.045, "#1f3a5f", 0.96], [0.12, "#2b4a70", 0.62], [0.21, "#4a6688", 0.2], [0.3, "#6f86a0", 0]],
      [[0.8, "#e2895a", 0], [0.885, "#e2895a", 0.2], [0.93, "#e79a68", 0.12], [1, "#efe6d2", 0]],
    ],
  },
  dusk: {
    base: null,
    layers: [
      [[0, "#08122a", 1], [0.035, "#0a162f", 1], [0.16, "#12233f", 1], [0.5, FIELDS.dusk.mid, 1], [1, "#4a6185", 1]],
      [[0.845, "#e59a62", 0], [0.885, "#e8a46a", 0.34], [0.905, "#d98a5e", 0.16], [0.95, "#d98a5e", 0]],
    ],
  },
};
const sampleStops = (stops, t) => {
  if (t <= stops[0][0]) return [stops[0][1], stops[0][2]];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0, a0] = stops[i - 1], [t1, c1, a1] = stops[i];
      const u = (t - t0) / (t1 - t0 || 1);
      return [mixHex(c0, c1, u), a0 + (a1 - a0) * u];
    }
  }
  const l = stops[stops.length - 1];
  return [l[1], l[2]];
};
const fieldAt = (fk, t) => {
  const S = SKY_STOPS[fk];
  let col = S.base ?? "#000000";
  for (const layer of S.layers) {
    const [c, a] = sampleStops(layer, t);
    col = mixHex(col, c, a);
  }
  return col;
};

// --- landscape model (world units; the map spans x +/-481) -------------------
// All heights are relative to the camera target (the pose-0 bounding-box
// center). Ring azimuth theta = 0 points to -z (straight ahead in the front
// view) and grows toward +x.
const MAP_R = 500; // map radius in the xz plane (corner of the pose-0 box ~ 520)
const FLOOR_Y = -760;
const RINGS = [
  // near to far. top = lowest silhouette height, amp = silhouette rise,
  // lattice = value-noise cells per 360 deg, fade = [full color above, mist below]
  { key: "r1", R: 1500, top: -430, amp: 150, lattice: 26, oct: 3, fade: [-420, -640], seed: 11 },
  { key: "r2", R: 2050, top: -345, amp: 140, lattice: 21, oct: 3, fade: [-335, -470], seed: 23 },
  { key: "r3", R: 2550, top: -255, amp: 125, lattice: 17, oct: 2, fade: [-245, -360], seed: 37 },
  { key: "r4", R: 3050, top: -165, amp: 105, lattice: 13, oct: 2, fade: [-155, -270], seed: 41 },
];
// The cone sits just beyond the far ring at a fixed azimuth (left of the map
// in the front view). Profile: radius grows with depth below the summit as a
// power above 1, which gives Fuji's concave flanks and a small flat crater.
const PEAK = { az: -33 * DEG, R: 3400, apex: 215, rTop: 62, k: 0, p: 1.38, dMax: 950, snow: 88 };
PEAK.k = (600 - PEAK.rTop) / Math.pow(330, PEAK.p); // half-width 600 at 330 below the summit
const peakR = (d) => PEAK.rTop + PEAK.k * Math.pow(Math.max(0, d), PEAK.p);
// Suyari-gasumi: long bands on cylinders between the rings.
const MIST_BANDS = [
  { R: 2800, az: 14 * DEG, span: 30 * DEG, h: -228, th: 26, seed: "m1" },
  { R: 2300, az: -10 * DEG, span: 24 * DEG, h: -322, th: 28, seed: "m2" },
  { R: 1780, az: 22 * DEG, span: 20 * DEG, h: -452, th: 34, seed: "m3" },
  { R: 2300, az: 44 * DEG, span: 16 * DEG, h: -330, th: 24, seed: "m4" },
];
const SKY_R = 3600; // the app's star shell radius
const SKY_BODY = { az: -40 * DEG, el: 9.5 * DEG, r: 66 };

const PALETTE = {
  washi: {
    // near (grey-green) to far (pale Prussian blue)
    rings: ["#cbd3c6", "#cfd8d0", "#d2dbdb", "#d6dfe4"],
    crest: "#6d889f", // ridge-top bokashi ink (Prussian grey)
    crestOp: [0.2, 0.18, 0.16, 0.14],
    peak: "#c9d5df",
    peakTop: "#9fb4c8",
    cap: "#f5f3ee",
    capOp: 0.96,
    peakLine: "#2b4a70",
    peakLineOp: 0.3,
    floor: "#9fb2bf",
    wave: "#2b4a70",
  },
  dusk: {
    rings: ["#24365a", "#2b3e63", "#33486d", "#3d5379"],
    crest: "#111d36",
    crestOp: [0.42, 0.36, 0.3, 0.26],
    peak: "#3b5179",
    peakTop: "#2a3c60",
    cap: "#b6bfd3",
    capOp: 0.72,
    peakLine: "#cdd6e6",
    peakLineOp: 0.16,
    floor: "#1b2b4a",
    wave: "#b8c7de",
  },
};

// Periodic value noise on a ring: Catmull-Rom between hashed lattice values,
// so the silhouette is smooth and seamless at 360 deg.
const lattice = (seed, i, N) => hash(`${seed}:${N}:${((i % N) + N) % N}`);
const cr = (p0, p1, p2, p3, t) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
const pnoise = (u, N, seed) => {
  const x = (((u % 1) + 1) % 1) * N;
  const i = Math.floor(x), t = x - i;
  return cr(lattice(seed, i - 1, N), lattice(seed, i, N), lattice(seed, i + 1, N), lattice(seed, i + 2, N), t);
};
const ridgeH = (ring, theta) => {
  const u = theta / (2 * Math.PI);
  let s = 0, a = 1, tot = 0;
  for (let o = 0; o < ring.oct; o++) {
    s += a * pnoise(u, ring.lattice * 2 ** o, ring.seed * 7 + o);
    tot += a;
    a *= 0.38;
  }
  const v = clamp(s / tot, 0, 1);
  // massifs: a slow swell so the range rises and falls in long sweeps
  const swell = 0.55 + 0.45 * pnoise(u, Math.max(3, Math.round(ring.lattice / 4)), ring.seed * 13 + 5);
  // peaks narrower than valleys
  const shaped = Math.pow(v, 1.35) * swell;
  return ring.top + ring.amp * clamp(shaped / 0.85, 0, 1.15);
};

// --- camera -----------------------------------------------------------------
const W = 1600, H = 1000;
const FOV = 50; // the app's PerspectiveCamera fov (vertical, degrees)
const FOC = H / 2 / Math.tan((FOV / 2) * DEG);
const FRAME = { x0: 80, x1: W - 80, y0: 150, y1: 835 };
const CX = (FRAME.x0 + FRAME.x1) / 2, CY = (FRAME.y0 + FRAME.y1) / 2; // principal point (focal offset)
const T = (() => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const n of g.nodes) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], n.pos[i]); hi[i] = Math.max(hi[i], n.pos[i]); }
  return lo.map((v, i) => (v + hi[i]) / 2);
})();

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const L = Math.hypot(...a); return [a[0] / L, a[1] / L, a[2] / L]; };

function makeCamera(dist, azDeg, elDeg) {
  const az = azDeg * DEG, el = elDeg * DEG;
  const C = [T[0] + dist * Math.sin(az) * Math.cos(el), T[1] + dist * Math.sin(el), T[2] + dist * Math.cos(az) * Math.cos(el)];
  const fw = norm(sub(T, C));
  const right = norm(cross(fw, [0, 1, 0]));
  const up = cross(right, fw);
  const project = (p) => {
    const v = sub(p, C);
    const z = dot(v, fw);
    return [CX + (FOC * dot(v, right)) / z, CY - (FOC * dot(v, up)) / z, z];
  };
  return { C, fw, right, up, project, dist, azDeg, elDeg };
}

// Front distance: the largest dolly-in at which every node and control point
// still fits the overview frame (the same framing as the overview sheets).
const fitPts = [...g.nodes.map((n) => n.pos), ...g.edges.map((e) => e.c)];
const fits = (d) => {
  const cam = makeCamera(d, 0, 0);
  for (const p of fitPts) {
    const [x, y] = cam.project(p);
    if (x < FRAME.x0 || x > FRAME.x1 || y < FRAME.y0 || y > FRAME.y1) return false;
  }
  return true;
};
let lo = 400, hi = 4000;
for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
const DIST = Math.ceil(hi);

const VIEWS = {
  front: makeCamera(DIST, 0, 0),
  orbit: makeCamera(DIST, 35, 12),
};

const wpt = (R, theta, h) => [T[0] + R * Math.sin(theta), T[1] + h, T[2] - R * Math.cos(theta)];

// Visible arc of a ring: scan out from the view azimuth while columns stay in
// front of the camera and within a margin of the sheet.
function ringArc(cam, R, topFn) {
  const fwAz = Math.atan2(cam.fw[0], -cam.fw[2]);
  const step = 0.3 * DEG;
  const ok = (th) => {
    const a = cam.project(wpt(R, th, topFn(th))), b = cam.project(wpt(R, th, FLOOR_Y));
    return a[2] > 60 && b[2] > 60 && a[0] > -500 && a[0] < W + 500 && b[0] > -500 && b[0] < W + 500;
  };
  let t0 = fwAz, t1 = fwAz;
  while (ok(t0 - step) && fwAz - t0 < Math.PI) t0 -= step;
  while (ok(t1 + step) && t1 - fwAz < Math.PI) t1 += step;
  const out = [];
  for (let th = t0; th <= t1 + 1e-9; th += step) out.push(th);
  return out;
}
const pathOf = (pts) => "M" + pts.map((q) => `${f1(q[0])},${f1(q[1])}`).join("L") + "Z";
const signedArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};

// --- landscape --------------------------------------------------------------
function landscape(fk, cam) {
  const Pal = PALETTE[fk];
  const el = [];
  const report = { ringScreenTop: [] };

  // sky body on the sky shell
  {
    const dir = [Math.sin(SKY_BODY.az) * Math.cos(SKY_BODY.el), Math.sin(SKY_BODY.el), -Math.cos(SKY_BODY.az) * Math.cos(SKY_BODY.el)];
    const p = [T[0] + dir[0] * SKY_R, T[1] + dir[1] * SKY_R, T[2] + dir[2] * SKY_R];
    const [x, y, z] = cam.project(p);
    const r = (FOC * SKY_BODY.r) / z;
    report.skyBody = [x, y, r];
    if (z > 0) {
      if (fk === "washi") {
        el.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r * 4.2)}" fill="url(#sunHalo)"/>`);
        el.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="url(#sunDisc)" filter="url(#soft1)"/>`);
      } else {
        el.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r * 4.6)}" fill="url(#moonHalo)"/>`);
        el.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r * 0.62)}" fill="url(#moonDisc)" filter="url(#soft1)"/>`);
      }
    }
  }

  // mist overlay: nested iso-height bands filled with the field, so a wall
  // fades to the field at its base (bokashi). Blurred to hide the steps.
  const mistBands = (topPts, isoFn, h0, h1, steps) => {
    const out = [];
    const a = 1 - Math.pow(0.04, 1 / steps); // cumulative ~0.96 at the bottom
    for (let k = 0; k < steps; k++) {
      const h = h0 + ((h1 - h0) * k) / (steps - 1);
      const pts = isoFn(h);
      if (pts.length > 2) out.push(`<path d="${pathOf(pts)}" fill-opacity="${f2(a)}"/>`);
    }
    return `<g fill="url(#field)" filter="url(#mistBlur)">${out.join("")}</g>`;
  };

  // far to near: cone, ring 4, band, ring 3, ...
  const uid = `${fk}-${cam.azDeg}`;
  const drawPeak = () => {
    const cx = PEAK.R * Math.sin(PEAK.az), cz = -PEAK.R * Math.cos(PEAK.az);
    const ctr = [T[0] + cx, T[2] + cz];
    const onCone = (d, a) => {
      const r = peakR(d), y = T[1] + PEAK.apex - d;
      return cam.project([ctr[0] + r * Math.cos(a), y, ctr[1] + r * Math.sin(a)]);
    };
    const circ = (d, n = 72) => {
      const pts = [];
      for (let i = 0; i < n; i++) pts.push(onCone(d, (i / n) * 2 * Math.PI));
      return signedArea(pts) < 0 ? pts.reverse() : pts;
    };
    // The cone is far away, so its outline is the left and right extremes of
    // its horizontal circles. One simple polygon per region: no seams.
    const extremes = (d) => {
      const pts = circ(d, 180);
      let L = pts[0], R = pts[0];
      for (const q of pts) { if (q[0] < L[0]) L = q; if (q[0] > R[0]) R = q; }
      return [L, R];
    };
    const outline = (d0, d1, stepD) => {
      const left = [], right = [];
      for (let d = d0; d <= d1 + 1e-9; d += stepD) { const [L, R] = extremes(d); left.push(L); right.push(R); }
      return pathOf([...left.reverse(), ...right]);
    };
    const apexP = cam.project([ctr[0], T[1] + PEAK.apex, ctr[1]]);
    const lowP = cam.project([ctr[0], T[1] + PEAK.apex - 360, ctr[1]]);
    const out = [];
    // body: one flat Prussian-pale impression, deeper just under the snow
    // (Hiroshige's summit bokashi), lifting to the body color by the ridge line
    out.push(`<linearGradient id="peakG-${uid}" gradientUnits="userSpaceOnUse" x1="0" y1="${f1(apexP[1])}" x2="0" y2="${f1(lowP[1])}"><stop offset="0.12" stop-color="${Pal.peakTop}"/><stop offset="0.55" stop-color="${Pal.peak}"/><stop offset="1" stop-color="${Pal.peak}"/></linearGradient>`);
    out.push(`<path d="${outline(0, PEAK.dMax, 4)}" fill="url(#peakG-${uid})"/>`);
    // body bokashi: the flank fades to the field well below the far ridge
    const mist = [];
    const steps = 12, a = 1 - Math.pow(0.05, 1 / steps);
    for (let k = 0; k < steps; k++) {
      const d0 = 300 + (k * 260) / (steps - 1);
      mist.push(`<path d="${outline(d0, PEAK.dMax + 200, 8)}" fill-opacity="${f2(a)}"/>`);
    }
    out.push(`<g fill="url(#field)" filter="url(#mistBlur)">${mist.join("")}</g>`);
    // pale cap: the snowline is one closed curve around the cone whose depth
    // below the summit swells into a few soft, rounded tongues (hashed). The
    // visible cap = snowline across the camera-facing half, closed over the
    // summit along the outline.
    const snowD = (az) => {
      let d = PEAK.snow;
      for (let i = 0; i < 7; i++) {
        const c = hash("tg" + i) * 2 * Math.PI, w = (7 + hash("tw" + i) * 7) * DEG;
        const L = 22 + hash("tl" + i) * 44;
        const da = Math.abs(((((az - c + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI);
        d += L * Math.exp(-((da / w) ** 2));
      }
      return d + 6 * Math.sin(az * 11 + 1.3);
    };
    const camAz = Math.atan2(cam.C[2] - ctr[1], cam.C[0] - ctr[0]);
    // Tongues seen edge-on at the outline print as a bright streak down the
    // flank, so the snowline relaxes to the plain snow depth near the outline.
    const line = [];
    for (let i = 0; i <= 180; i++) {
      const az = camAz - Math.PI / 2 + (i / 180) * Math.PI;
      const edge = smooth((70 * DEG - Math.abs(az - camAz)) / (25 * DEG));
      line.push(onCone(PEAK.snow + Math.min(58, snowD(az) - PEAK.snow) * edge, az));
    }
    // order the snowline left to right on screen
    if (line[0][0] > line[line.length - 1][0]) line.reverse();
    const capTop = [];
    const dEndL = PEAK.snow;
    for (let d = 0; d <= dEndL; d += 3) capTop.push(extremes(d));
    const capPts = [...line, ...capTop.map((e) => e[1]).reverse(), ...capTop.map((e) => e[0])];
    out.push(`<path d="${pathOf(capPts)}" fill="${Pal.cap}" fill-opacity="${Pal.capOp}" filter="url(#soft06)"/>`);
    // a hairline key-block contour on the upper silhouette only
    const sil = [];
    {
      const N = 120;
      for (let i = 0; i <= N; i++) {
        const d = 300 * Math.abs((i / N) * 2 - 1);
        const side = i < N / 2 ? -1 : 1;
        const pts = circ(d, 120);
        let best = pts[0];
        for (const q of pts) if ((side < 0 && q[0] < best[0]) || (side > 0 && q[0] > best[0])) best = q;
        sil.push(d < 1 ? apexP : best);
      }
    }
    out.push(`<path d="M${sil.map((q) => `${f1(q[0])},${f1(q[1])}`).join("L")}" fill="none" stroke="${Pal.peakLine}" stroke-width="0.7" stroke-opacity="${Pal.peakLineOp}" stroke-linejoin="round" stroke-linecap="round"/>`);
    report.peakApex = apexP;
    return out.join("\n");
  };

  const drawRing = (ring, idx) => {
    const top = (th) => ridgeH(ring, th);
    const arc = ringArc(cam, ring.R, top);
    const tops = arc.map((th) => cam.project(wpt(ring.R, th, top(th))));
    const bases = arc.map((th) => cam.project(wpt(ring.R, th, FLOOR_Y)));
    let minY = Infinity, minX = 0;
    for (const q of tops) if (q[0] > 0 && q[0] < W && q[1] < minY) { minY = q[1]; minX = q[0]; }
    report.ringScreenTop.push([ring.key, minX, minY]);
    const out = [];
    const wall = pathOf([...tops, ...[...bases].reverse()]);
    out.push(`<path d="${wall}" fill="${Pal.rings[idx]}"/>`);
    // ridge-top bokashi: the ink pools just under the crest and fades down
    // (nested bands below the silhouette, clipped to the wall so the crest
    // edge stays crisp)
    out.push(`<clipPath id="wall-${uid}-${idx}"><path d="${wall}"/></clipPath>`);
    const crest = [];
    const NC = 9, ca = 1 - Math.pow(1 - Pal.crestOp[idx], 1 / NC);
    for (let k = 0; k < NC; k++) {
      const dh = 8 + (k * 62) / (NC - 1);
      const lower = arc.map((th) => cam.project(wpt(ring.R, th, top(th) - dh)));
      crest.push(`<path d="${pathOf([...tops.map((q) => [q[0], q[1] - 4]), ...lower.reverse()])}" fill-opacity="${f2(ca)}"/>`);
    }
    out.push(`<g clip-path="url(#wall-${uid}-${idx})"><g fill="${Pal.crest}" filter="url(#crestBlur)">${crest.join("")}</g></g>`);
    const deep = arc.map((th) => cam.project(wpt(ring.R, th, FLOOR_Y - 260)));
    const iso = (h) => {
      const up = arc.map((th) => cam.project(wpt(ring.R, th, Math.min(h, top(th)))));
      return [...up, ...deep.reverse()];
    };
    out.push(mistBands(tops, iso, ring.fade[0], ring.fade[1], 16));
    return { svg: out.join("\n"), bases };
  };

  const drawMistBand = (b) => {
    // stadium-shaped band on a cylinder: flat top and bottom, rounded ends
    const N = 120;
    const topPts = [], botPts = [];
    for (let i = 0; i <= N; i++) {
      const s = (i / N) * 2 - 1;
      const th = b.az + s * b.span;
      const prof = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(s), 6)), 0.5);
      const lift = (hash(b.seed + "l") - 0.5) * 6 * s; // a slight tilt
      const t = b.th * prof;
      topPts.push(cam.project(wpt(b.R, th, b.h + lift + t)));
      botPts.push(cam.project(wpt(b.R, th, b.h + lift - t * 0.8)));
    }
    if (topPts.some((q) => q[2] < 60)) return "";
    return `<path d="${pathOf([...topPts, ...botPts.reverse()])}" fill="url(#field)" fill-opacity="0.9" filter="url(#bandBlur)"/>`;
  };

  const layers = [];
  layers.push(drawPeak());
  const order = [3, 2, 1, 0];
  let nearBases = null;
  for (const i of order) {
    const r = drawRing(RINGS[i], i);
    layers.push(r.svg);
    if (i === 0) nearBases = r.bases;
    // mist bands that live just inside this ring
    for (const b of MIST_BANDS) {
      const inner = i > 0 ? RINGS[i - 1].R : 0;
      if (b.R < RINGS[i].R && b.R > inner) layers.push(drawMistBand(b));
    }
  }

  // water floor: everything in front of the near ring's base
  {
    const pts = [...nearBases, [W + 600, H + 600], [-600, H + 600]];
    const shoreY = Math.min(...nearBases.filter((q) => q[0] > 0 && q[0] < W).map((q) => q[1]));
    report.shoreY = shoreY;
    layers.push(`<linearGradient id="floorG-${cam.azDeg}" gradientUnits="userSpaceOnUse" x1="0" y1="${f1(shoreY)}" x2="0" y2="${H}"><stop offset="0" stop-color="${Pal.floor}" stop-opacity="${fk === "washi" ? 0.12 : 0.22}"/><stop offset="0.35" stop-color="${Pal.floor}" stop-opacity="${fk === "washi" ? 0.06 : 0.1}"/><stop offset="1" stop-color="${Pal.floor}" stop-opacity="0.02"/></linearGradient>`);
    layers.push(`<path d="${pathOf(pts)}" fill="url(#floorG-${cam.azDeg})" filter="url(#floorBlur)"/>`);
    // a few long fine wave lines, near the far shore only
    const waves = [];
    const rows = [
      { dr: 22, n: 3 }, { dr: 50, n: 2 }, { dr: 84, n: 2 },
    ];
    rows.forEach((row, ri) => {
      for (let j = 0; j < row.n; j++) {
        const k = `w${ri}:${j}`;
        const c = (hash(k + "c") - 0.5) * 2 * 9 * DEG + (j - (row.n - 1) / 2) * 21 * DEG;
        const span = (3.2 + hash(k + "s") * 3.2) * DEG * (1 - ri * 0.1);
        const R = RINGS[0].R - row.dr;
        const M = 70;
        const pts = [];
        for (let i = 0; i <= M; i++) {
          const s = i / M;
          const th = c + (s - 0.5) * 2 * span;
          const wob = 3 * Math.sin(s * Math.PI * (2 + Math.floor(hash(k + "f") * 2)) + hash(k + "p") * 6);
          pts.push(cam.project(wpt(R + wob, th, FLOOR_Y)));
        }
        if (pts.some((q) => q[2] < 60)) continue;
        // three pieces: thin ends, fuller middle
        const piece = (a, b, op, w) => `<path d="M${pts.slice(a, b + 1).map((q) => `${f1(q[0])},${f1(q[1])}`).join("L")}" stroke-opacity="${f2(op)}" stroke-width="${w}"/>`;
        const op = (fk === "washi" ? 0.4 : 0.3) * (1 - ri * 0.16);
        waves.push(piece(0, 16, op * 0.45, 0.6), piece(16, 54, op, 0.8), piece(54, M, op * 0.45, 0.6));
      }
    });
    layers.push(`<g fill="none" stroke="${Pal.wave}" stroke-linecap="round" stroke-linejoin="round">${waves.join("")}</g>`);
  }

  el.push(...layers);
  return { svg: el.join("\n"), report };
}

// --- map (copied stroke and disc drawing, now projected) ---------------------
const HALF0 = 1.6, HALF1 = 0.2;
const halfAt = (t) => {
  const body = HALF1 + (HALF0 - HALF1) * Math.pow(1 - t, 0.95);
  const pool = 0.32 * Math.exp(-(((t - 0.05) / 0.06) ** 2));
  return body + pool;
};
const nodeR0 = (n) => (3.4 + Math.sqrt(n.deg) * 1.9) * (W / 1680);

function trimT(a, c, b, rA, rB) {
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

function mapLayer(fk, cam) {
  const F = FIELDS[fk];
  const P = new Map(), Z = new Map();
  for (const n of g.nodes) { const q = cam.project(n.pos); P.set(n.id, q); Z.set(n.id, q[2]); }
  const zT = cam.dist; // depth of the target
  const kOf = (z) => clamp(zT / z, 0.7, 1.45);
  const nodeR = (n) => nodeR0(n) * kOf(Z.get(n.id));
  const ctrl = (e) => cam.project(e.c);

  function brushStroke(e, color, opacity, widthScale0) {
    const s = byId.get(e.s), t = byId.get(e.t);
    const a = P.get(e.s), b = P.get(e.t), cq = ctrl(e), c = cq;
    const widthScale = widthScale0 * kOf(cq[2]);
    const range = trimT(a, c, b, nodeR(s) + 0.6, nodeR(t) + 1.6);
    if (!range) return "";
    const [tA, tB] = range;
    const id = e.s + ">" + e.t;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(8, Math.min(48, Math.round(len / 6)));
    const swayA = (hash(id + "sway") - 0.5) * 0.7;
    const sway = (u) => swayA * Math.sin(Math.PI * u);
    const pf = 1.3 + hash(id + "pf") * 1.4, pp = hash(id + "pp") * Math.PI * 2;
    const half = (u) => halfAt(u) * widthScale * (1 + 0.11 * Math.sin(Math.PI * 2 * pf * u + pp));
    const out = [];
    const K = 0.65;
    const head = qPoint(a, c, b, tA);
    out.push(`<circle cx="${f1(head[0])}" cy="${f1(head[1])}" r="${f2(half(0) * 0.92)}"/>`);
    out.push(`<path d="${ribbon(a, c, b, tA, tB, 0, K + 0.03, half, sway, Math.ceil(steps * 0.7))}"/>`);
    const nb = hash(id + "nb") < 0.5 ? 2 : 3;
    const tipLane = Math.floor(hash(id + "tip") * nb);
    for (let j = 0; j < nb; j++) {
      const lane = nb === 2 ? (j === 0 ? -0.5 : 0.5) : j - 1;
      const end = j === tipLane ? 1 : 0.8 + hash(id + "end" + j) * 0.14;
      const v = (u) => Math.min(1, Math.max(0, (u - K) / (1 - K)));
      const bh = (u) => Math.max(0.13, half(u) * (nb === 2 ? 0.42 : 0.3) * (1 - 0.25 * v(u)));
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
      const ink = 0.7 + hash(id + "ink" + j) * 0.3;
      for (const [s0, s1] of segs) {
        const lift = (u) => Math.min(1, Math.max(0.2, (s1 - u) / 0.035));
        const land = (u) => (s0 > K ? Math.min(1, Math.max(0.35, (u - s0) / 0.02)) : 1);
        const hf = (u) => bh(u) * Math.min(lift(u), land(u));
        out.push(`<path fill-opacity="${f2(ink)}" d="${ribbon(a, c, b, tA, tB, s0, s1, hf, off, Math.max(3, Math.ceil(steps * (s1 - s0) * 1.4)))}"/>`);
      }
    }
    return `<g fill="${color}" opacity="${opacity}">${out.join("")}</g>`;
  }

  function dabRow(e, color, opacity) {
    const a = P.get(e.s), b = P.get(e.t), c = ctrl(e);
    const range = trimT(a, c, b, nodeR(byId.get(e.s)) + 2, nodeR(byId.get(e.t)) + 2);
    if (!range) return "";
    const [tA, tB] = range;
    const id = e.s + "~" + e.t;
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

  const el = [];
  const sumi = F.sumi;
  for (const e of g.edges.filter((x) => x.k === 1)) el.push(dabRow(e, sumi, 0.32));
  // strokes and discs far to near by camera depth
  const prereq = g.edges.filter((x) => x.k === 0).map((e) => [e, ctrl(e)[2]]).sort((x, y) => y[1] - x[1]);
  for (const [e] of prereq) el.push(brushStroke(e, F.pigment[byId.get(e.s).strand], 0.8, 1));
  const nodes = [...g.nodes].sort((x, y) => Z.get(y.id) - Z.get(x.id));
  for (const n of nodes) {
    const [x, y] = P.get(n.id);
    const r = nodeR(n);
    if (n.deg === 0) {
      const fill = fk === "washi" ? "#f6efdf" : "#e6dcc6";
      const fo = fk === "washi" ? 1 : 0.22;
      el.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f2(r)}" fill="${fill}" fill-opacity="${fo}" stroke="${sumi}" stroke-width="0.8" stroke-opacity="${fk === "washi" ? 0.75 : 0.6}"/>`);
    } else {
      el.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f2(r)}" fill="url(#bk-${n.strand})" stroke="${sumi}" stroke-width="0.85"/>`);
    }
  }
  let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
  for (const q of P.values()) { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); }
  return { svg: el.join("\n"), bbox: [x0, y0, x1, y1], P };
}

// --- sheet ------------------------------------------------------------------
function defs(fk, F) {
  const d = [];
  for (const s of STRANDS) {
    const base = F.pigment[s];
    const top = mixHex(base, BOKASHI_DEEP[fk][s], fk === "washi" ? 0.3 : 0.22);
    const bot = mixHex(base, BOKASHI_LIGHT[fk][s], fk === "washi" ? 0.55 : 0.4);
    d.push(`<linearGradient id="bk-${s}" x1="0" y1="0" x2="0" y2="1"><stop offset="0.08" stop-color="${top}"/><stop offset="0.45" stop-color="${base}"/><stop offset="1" stop-color="${bot}"/></linearGradient>`);
  }
  if (fk === "washi") {
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
    d.push(`<radialGradient id="sunDisc" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#e2683e"/><stop offset="0.82" stop-color="#e06a40"/><stop offset="1" stop-color="#e57a52" stop-opacity="0.85"/></radialGradient>`);
    d.push(`<radialGradient id="sunHalo" cx="0.5" cy="0.5" r="0.5"><stop offset="0.2" stop-color="#ec9a6c" stop-opacity="0.34"/><stop offset="0.45" stop-color="#eea878" stop-opacity="0.14"/><stop offset="1" stop-color="#efb88a" stop-opacity="0"/></radialGradient>`);
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
    d.push(`<radialGradient id="moonDisc" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#f1ead8"/><stop offset="0.85" stop-color="#ebe3cf"/><stop offset="1" stop-color="#dcd6c8" stop-opacity="0.8"/></radialGradient>`);
    d.push(`<radialGradient id="moonHalo" cx="0.5" cy="0.5" r="0.5"><stop offset="0.1" stop-color="#d8dfeb" stop-opacity="0.2"/><stop offset="0.4" stop-color="#b9c6db" stop-opacity="0.07"/><stop offset="1" stop-color="#9fb0cc" stop-opacity="0"/></radialGradient>`);
  }
  // the opaque field (sky + horizon composited), for mist fills
  const st = [];
  for (let i = 0; i <= 100; i++) st.push(`<stop offset="${(i / 100).toFixed(2)}" stop-color="${fieldAt(fk, i / 100)}"/>`);
  d.push(`<linearGradient id="field" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${H}">${st.join("")}</linearGradient>`);
  d.push(`<filter id="mistBlur" x="-0.1" y="-0.2" width="1.2" height="1.4"><feGaussianBlur stdDeviation="2.6"/></filter>`);
  d.push(`<filter id="bandBlur" x="-0.1" y="-0.5" width="1.2" height="2"><feGaussianBlur stdDeviation="3.2"/></filter>`);
  d.push(`<filter id="soft1" x="-0.3" y="-0.3" width="1.6" height="1.6"><feGaussianBlur stdDeviation="1.1"/></filter>`);
  d.push(`<filter id="floorBlur" x="-0.1" y="-0.1" width="1.2" height="1.2"><feGaussianBlur stdDeviation="5"/></filter>`);
  d.push(`<filter id="soft06" x="-0.1" y="-0.1" width="1.2" height="1.2"><feGaussianBlur stdDeviation="0.6"/></filter>`);
  d.push(`<filter id="crestBlur" x="-0.05" y="-0.3" width="1.1" height="1.6"><feGaussianBlur stdDeviation="1.6"/></filter>`);
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

const RATIOS = {};
for (const [fk, F] of Object.entries(FIELDS)) {
  RATIOS[fk] = {};
  for (const s of STRANDS) RATIOS[fk][s] = contrast(F.pigment[s], F.mid);
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

function sheet(fk, viewKey) {
  const F = FIELDS[fk];
  const cam = VIEWS[viewKey];
  const viewName = viewKey === "front" ? "Front" : "Orbit";
  const sheetName = `Hanga · ${F.name} · Landscape · ${viewName}`;
  const el = [];
  if (fk === "washi") {
    el.push(`<rect width="${W}" height="${H}" fill="${F.paper}"/>`);
    el.push(`<rect width="${W}" height="${H}" fill="url(#sky)"/>`);
    el.push(`<rect width="${W}" height="${H}" fill="url(#horizon)"/>`);
  } else {
    el.push(`<rect width="${W}" height="${H}" fill="url(#sky)"/>`);
    el.push(`<rect width="${W}" height="${H}" fill="url(#horizon)"/>`);
  }
  const land = landscape(fk, cam);
  el.push(land.svg);
  // paper texture prints over the landscape too: one sheet of washi
  el.push(`<rect width="${W}" height="${H}" filter="url(#mottle)"/>`);
  el.push(`<rect width="${W}" height="${H}" filter="url(#grain)"/>`);
  el.push(fibers(fk));
  const map = mapLayer(fk, cam);
  el.push(map.svg);

  const spec = `camera fov ${FOV}° · distance ${DIST} · azimuth ${cam.azDeg}° · elevation ${cam.elDeg}° · rings r ${RINGS.map((r) => r.R).join(" / ")} · floor y ${FLOOR_Y}`;
  el.push(`<g font-family="'Hiragino Mincho ProN', 'Yu Mincho', Georgia, serif" fill="${F.sumi}">
<text x="40" y="${H - 58}" font-size="16" letter-spacing="0.1em">${sheetName}</text>
<text x="40" y="${H - 34}" font-size="13" letter-spacing="0.06em" fill-opacity="0.78">After Wada Sanzo, Oda Kazuma, and Utagawa Hiroshige</text>
<text x="40" y="${H - 14}" font-family="ui-monospace, Menlo, monospace" font-size="10.5" fill-opacity="0.6">${spec}</text>
</g>`);
  el.push(legend(fk, F));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<title>${sheetName}</title>
${defs(fk, F)}
${el.join("\n")}
</svg>
`;
  return { svg, report: land.report, mapBox: map.bbox, P: map.P };
}

// --- legibility gates (printed, not fatal) -----------------------------------
console.log(`camera: fov ${FOV}, focal ${FOC.toFixed(1)} px, principal point (${CX}, ${CY}), distance ${DIST}, target [${T.map((v) => v.toFixed(1)).join(", ")}]`);
for (const fk of ["washi", "dusk"]) {
  const F = FIELDS[fk];
  const rows = PALETTE[fk].rings.map((c, i) => {
    const worst = Math.min(...STRANDS.map((s) => contrast(F.pigment[s], c)));
    const crestC = mixHex(c, PALETTE[fk].crest, PALETTE[fk].crestOp[i]);
    const worstCrest = Math.min(...STRANDS.map((s) => contrast(F.pigment[s], crestC)));
    const vsField = contrast(c, F.mid);
    return `${RINGS[i].key} ${c} (crest ${crestC}) worst pigment ${worst.toFixed(2)}:1 (crest ${worstCrest.toFixed(2)}:1), ring vs field mid ${vsField.toFixed(2)}:1`;
  });
  console.log(`${F.name}: ${rows.join(" | ")}`);
  const pk = Math.min(...STRANDS.map((s) => contrast(F.pigment[s], PALETTE[fk].peak)));
  console.log(`${F.name}: peak ${PALETTE[fk].peak} worst pigment ${pk.toFixed(2)}:1, cap ${PALETTE[fk].cap} worst ${Math.min(...STRANDS.map((s) => contrast(F.pigment[s], PALETTE[fk].cap))).toFixed(2)}:1`);
}

const outputs = [
  ["hanga-washi-landscape-front.svg", "washi", "front"],
  ["hanga-washi-landscape-orbit.svg", "washi", "orbit"],
  ["hanga-dusk-landscape-front.svg", "dusk", "front"],
  ["hanga-dusk-landscape-orbit.svg", "dusk", "orbit"],
];
for (const [file, fk, view] of outputs) {
  const s = sheet(fk, view);
  writeFileSync(resolve(OUT, file), s.svg);
  const r = s.report;
  const mapMidY = (s.mapBox[1] + s.mapBox[3]) / 2;
  console.log(`wrote docs/previews/${file}`);
  console.log(`  map screen box x ${f1(s.mapBox[0])}..${f1(s.mapBox[2])} y ${f1(s.mapBox[1])}..${f1(s.mapBox[3])} (mid y ${f1(mapMidY)})`);
  console.log(`  ring tops (highest on sheet): ${r.ringScreenTop.map(([k, x, y]) => `${k} y ${f1(y)} at x ${f1(x)}`).join(", ")}`);
  console.log(`  peak apex ${f1(r.peakApex[0])},${f1(r.peakApex[1])} · sky body ${f1(r.skyBody[0])},${f1(r.skyBody[1])} r ${f1(r.skyBody[2])} · shore y ${f1(r.shoreY)}`);
  if (view === "front") {
    const tallest = Math.min(...r.ringScreenTop.map((q) => q[2]));
    console.log(`  legibility: tallest ridge top y ${f1(tallest)} ${tallest > mapMidY ? "is below" : "is ABOVE"} the map mid y ${f1(mapMidY)}`);
  }
}
