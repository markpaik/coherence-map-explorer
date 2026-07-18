// Thematic environments — the sky each pose earns once it settles. The
// Constellation keeps the galaxy (stars + planets); the three structured poses
// each raise a place instead:
//   · home 1 (the Ascent)    → a Sierra DAWN: an inside-out gradient sky, low
//                              valley mist, and two distant ridge silhouettes.
//   · home 2 (the Blueprint)  → a quiet STUDIO shell — the sheet is the show.
//   · home 3 (the Transit)    → CONCRETE daylight: a flat overcast gradient with
//                              large-scale mottling, enamel-sign clear.
//
// All three are ONE THREE.Group, each a sub-group faded by a pose window. Every
// mark is deterministic canvas + geometry — no Math.random, no Date; a fixed
// seed hash decides only texture detail (the ridge silhouette, the mist grain,
// the concrete mottle), never a node's position. Everything is static, so the
// environments are reduced-motion safe by construction.
//
// ENDPOINT GATING (the round-11 bug fix): a window is forced to 0 unless its
// home pose is one of the morph's endpoints (origin / target). A morph that
// SWEEPS THROUGH a home — 0→3 passes the scalar pose 2 — never raises that
// home's sky. Art styles have no galaxy sky at all (Ringers/Fidenza fields ARE
// their environments), so every amount is 0 there. While a story runs, all
// amounts lerp to 0 over ~0.4s: stories own the dark baseline.
//
// GALAXY FADE: while an environment is up, the planets recede and the stars dim
// (dawn holds stars at 0.35 — stars at dawn in the Sierra are true; the studio
// and daylight take them to 0). Those two are slewed so the studio→daylight
// hand-off (both windows momentarily 0 at pose 2.5) never flashes the planets
// back in.

import * as THREE from "three";

// ---------------------------------------------------------------------------
// Pure window + gate math (exported for tests — no THREE, no DOM).
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Dawn window (home 1): a triangle peaking at pose 1, zero by 0.5 / 1.5. */
export const dawnWindow = (p: number): number => clamp01(1 - Math.abs(p - 1) / 0.5);
/** Studio window (home 2): a triangle peaking at pose 2, zero by 1.5 / 2.5. */
export const studioWindow = (p: number): number => clamp01(1 - Math.abs(p - 2) / 0.5);
/** Daylight window (home 3): a ramp up over 2.5→3, saturating at the Transit. */
export const daylightWindow = (p: number): number => clamp01((p - 2.5) / 0.5);

export interface PoseGate {
  origin: number;
  target: number;
}

/** True iff `home` is one of the morph's endpoints (origin or target). The one
 *  source of truth for the round-11 endpoint gate; main.ts routes the sheet,
 *  drafts, contours, and stations through it too. */
export const endpointOwns = (home: number, gate: PoseGate): boolean =>
  gate.origin === home || gate.target === home;

/** window(home, p) × endpoint-gate — the amount a home's environment shows at
 *  pose p under the given morph. Home 1 → dawn, 2 → studio, 3 → daylight. */
export function environAmount(home: 1 | 2 | 3, p: number, gate: PoseGate): number {
  if (!endpointOwns(home, gate)) return 0;
  return home === 1 ? dawnWindow(p) : home === 2 ? studioWindow(p) : daylightWindow(p);
}

// ---------------------------------------------------------------------------
// Deterministic value noise (fixed-seed integer hash → smoothed lattice). Used
// only for texture detail — mist grain, ridge silhouettes, concrete mottle.
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const w = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - w) + (c * (1 - u) + d * u) * w;
}
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// The shell shader (shared by all three environments; uType picks the gradient).
// vDir is the normalized surface direction, so the gradient is purely a function
// of elevation (vDir.y) with a small +x bias on the dawn horizon.
const SHELL_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SHELL_FRAG = /* glsl */ `
  precision highp float;
  uniform float uOpacity;
  uniform int uType;   // 0 dawn | 1 studio | 2 concrete daylight
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    float e = clamp(vDir.y, -1.0, 1.0); // -1 nadir … +1 zenith
    vec3 col;
    if (uType == 0) {
      // Sierra dawn — desaturated so the sky never fights the strand colours.
      // Mid + low stops darkened ~12% (round-12) so the strand-coloured massif
      // lines pop against the sky instead of paling out; gold horizon band kept.
      vec3 cBelow = vec3(0.137255, 0.156863, 0.200000); // #232833
      vec3 cLow   = vec3(0.478431, 0.521569, 0.596078); // #7a8598 (was #8d97a8)
      vec3 cMid   = vec3(0.243137, 0.309804, 0.431373); // #3e4f6e (was #47597a)
      vec3 cUp    = vec3(0.137255, 0.196078, 0.309804); // #23324f
      vec3 cZen   = vec3(0.078431, 0.109804, 0.188235); // #141c30
      col = cBelow;
      col = mix(col, cLow, smoothstep(-0.02, 0.08, e));
      col = mix(col, cMid, smoothstep(0.08, 0.30, e));
      col = mix(col, cUp,  smoothstep(0.30, 0.58, e));
      col = mix(col, cZen, smoothstep(0.58, 1.00, e));
      // Narrow horizon band, brightening toward +x (the summit side — light
      // comes from where the mathematics is headed).
      vec3 bandA = vec3(0.796078, 0.709804, 0.607843); // #cbb59b
      vec3 bandB = vec3(0.890196, 0.803922, 0.698039); // #e3cdb2
      vec3 band = mix(bandA, bandB, smoothstep(-0.5, 0.9, vDir.x));
      // Widened band→ridge transition (round-12): the mask now feathers over ~0.09
      // of elevation (was 0.05), so the gold horizon dissolves gradually into the
      // sky above the ridgeline instead of leaving a hard banding seam at the ridge.
      float bandMask = 1.0 - smoothstep(0.0, 0.09, abs(e - 0.02));
      col = mix(col, band, bandMask * 0.9);
    } else if (uType == 1) {
      // Studio — a quiet charcoal shell. The sheet is the show.
      vec3 top = vec3(0.062745, 0.082353, 0.113725); // #10151d
      vec3 bot = vec3(0.090196, 0.113725, 0.156863); // #171d28
      col = mix(bot, top, smoothstep(-0.4, 0.8, e));
    } else {
      // Concrete daylight — flat overcast, material not photograph.
      vec3 cZ = vec3(0.811765, 0.800000, 0.768627); // #cfccc4
      vec3 cM = vec3(0.745098, 0.725490, 0.690196); // #beb9b0
      vec3 cL = vec3(0.658824, 0.643137, 0.607843); // #a8a49b
      col = mix(cL, cM, smoothstep(-0.10, 0.42, e));
      col = mix(col, cZ, smoothstep(0.42, 1.00, e));
      // Large-scale mottling ±3% — soft hash-noise blobs, no literal seams.
      float m1 = vnoise(vDir.xy * 3.0 + vDir.z * 1.7);
      float m2 = vnoise(vDir.zx * 5.3 - 4.0);
      float mott = (m1 * 0.6 + m2 * 0.4) - 0.5;
      col *= 1.0 + mott * 0.06;
    }
    gl_FragColor = vec4(col, uOpacity);
    if (gl_FragColor.a < 0.002) discard;
  }
`;

const SHELL_RADIUS = 5200; // inside the 12000 camera far plane, beyond the star shell (3600)

function makeShellMaterial(type: 0 | 1 | 2): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SHELL_VERT,
    fragmentShader: SHELL_FRAG,
    uniforms: { uOpacity: { value: 0 }, uType: { value: type } },
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: false, // pure background fill, ordered by renderOrder
  });
}

// ---------------------------------------------------------------------------
// Dawn mist — 4 soft feathered wisps, widest & densest lowest.
const MIST = [
  { y: -78, z: -140, op: 0.12, halfW: 128, halfH: 34 },
  { y: -60, z: -40, op: 0.09, halfW: 108, halfH: 28 },
  { y: -42, z: 60, op: 0.07, halfW: 94, halfH: 24 },
  { y: -26, z: 160, op: 0.05, halfW: 84, halfH: 20 },
] as const;
const MIST_COLOR = 0xdfe4ea;

function buildMistTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 96;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (!ctx) return tex;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const vFeather = Math.pow(Math.sin(v * Math.PI), 1.4); // 0 top/bottom, 1 middle
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const hFeather = smooth(0, 0.18, u) * (1 - smooth(0.82, 1, u));
      const n = 0.6 + 0.4 * vnoise(x * 0.35, y * 0.7); // soft grain, not a solid bar
      const a = clamp01(vFeather * hFeather * n);
      const k = (y * W + x) * 4;
      d[k] = 255;
      d[k + 1] = 255;
      d[k + 2] = 255;
      d[k + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Dawn ridges — 2 distant silhouettes, a genuinely jagged ridgeline from the
// fixed seed (round-12 rebuild: the old 3/7/15-octave profile read as a broad,
// flat-topped dark stripe). Each layer carries a horizontal `phase` so the two
// ridgelines' peaks fall in different places (stacked ranges, not a doubled
// outline); the far one is darker + more opaque and sits behind via parallax (z).
const RIDGES = [
  { z: -650, fill: 0x1b2436, op: 0.55, seed: 101, phase: 0.0 },
  { z: -950, fill: 0x141b2a, op: 0.75, seed: 257, phase: 0.37 },
] as const;
const RIDGE_W = 4800; // x span ±2400 — wide enough that no plane edge enters the frame
const RIDGE_H = 260;
const RIDGE_Y = -10;
// Ridge floor + jag amplitude as fractions of the texture height. Lower than the
// old 0.46/0.23 hump so the range reads as distant foothills, not a wall.
const RIDGE_BASE = 0.4;
const RIDGE_AMP = 0.22;

function buildRidgeTexture(seed: number, phase: number): THREE.CanvasTexture {
  const W = 1024;
  const H = 256;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (!ctx) return tex;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const s = seed * 0.123;
  for (let x = 0; x < W; x++) {
    const t = x / W + phase; // per-layer horizontal phase → offset peaks
    // Higher-frequency, varied-amplitude value noise: coarse crests (×5) carry the
    // skyline, finer octaves (×11/×23/×47) cut the teeth. Weights sum to 1 so h
    // stays in [0,1]. Deterministic (fixed seed) — texture detail only, never a
    // node position.
    const h =
      0.4 * vnoise(t * 5 + s, s * 1.3) +
      0.26 * vnoise(t * 11 + s * 2.0, 7 + s) +
      0.2 * vnoise(t * 23 + s * 0.7, 3 + s) +
      0.14 * vnoise(t * 47 + s * 1.7, 5 + s);
    const frac = RIDGE_BASE + RIDGE_AMP * clamp01(h); // ridge height as a fraction of H
    const topRow = (1 - frac) * H; // rows below this are mountain
    const mountainH = H - topRow; // this column's opaque height (rows)
    // Soft feathered top: alpha ramps 0 → 1 over ~12% of the ridge height below the
    // ridgeline, so the silhouette has NO hard edge anywhere (the old ±1.5-row
    // smoothstep was a near-hard cut). The per-column feather also softens the
    // horizontal jaggies where neighbouring peaks differ in height.
    const feather = Math.max(3, 0.12 * mountainH);
    // Horizontal end feather: the ridge dissolves over the outer 8% of each
    // side, so a finite plane never shows a hard vertical edge if the camera
    // catches its end mid-frame.
    const endFade = clamp01(Math.min(x, W - 1 - x) / (0.08 * W));
    for (let y = 0; y < H; y++) {
      const a = clamp01((y - topRow) / feather) * endFade; // 0 at the ridgeline → 1 by topRow + feather
      const k = (y * W + x) * 4;
      d[k] = 255;
      d[k + 1] = 255;
      d[k + 2] = 255;
      d[k + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
export interface EnvironsDeps {
  /** Planets recede as an environment takes over (1 galaxy … 0 gone). */
  planets: { setVisibleAmount(a: number): void };
  /** Stars dim with the sky (1 full … 0 gone). */
  stars: { setDim(a: number): void };
}

export interface EnvironsHandle {
  group: THREE.Group;
  /**
   * Drive the three windows for the frame. `gate` supplies the morph endpoints
   * (a window is forced to 0 unless its home is one of them). artStyle !== 0
   * zeroes everything; storyActive lerps everything to 0 over ~0.4s. Returns
   * true while the galaxy-fade slew is still settling (keeps the pump hot under
   * render-on-demand).
   */
  update(p: number, gate: PoseGate, storyActive: boolean, artStyle: number): boolean;
  /** Effective concrete-daylight amount (post gate / story / art) — bloom keys
   *  off this, and the next builder will tint station/edge inks to it. */
  daylight01(): number;
  /** Effective Sierra-dawn amount (post gate / story / art). The two LIGHT
   *  environments are dawn + daylight; main.ts sums them to flip the light-ink
   *  chrome (body.env-light) and to darken the etch markers. Studio is a DARK
   *  shell and is deliberately NOT reported here. */
  dawn01(): number;
  dispose(): void;
}

const approach = (cur: number, target: number, dt: number, tau: number): number =>
  cur + (target - cur) * (1 - Math.exp(-dt / tau));

export function createEnvirons(deps: EnvironsDeps): EnvironsHandle {
  const { planets, stars } = deps;

  const group = new THREE.Group();
  group.name = "environs";
  const dawnGroup = new THREE.Group();
  const studioGroup = new THREE.Group();
  const dayGroup = new THREE.Group();
  dawnGroup.visible = studioGroup.visible = dayGroup.visible = false;
  group.add(dawnGroup, studioGroup, dayGroup);

  // -- shells --------------------------------------------------------------
  const shellGeo = new THREE.SphereGeometry(SHELL_RADIUS, 48, 24);
  const dawnShellMat = makeShellMaterial(0);
  const studioShellMat = makeShellMaterial(1);
  const dayShellMat = makeShellMaterial(2);
  for (const [mat, g] of [
    [dawnShellMat, dawnGroup],
    [studioShellMat, studioGroup],
    [dayShellMat, dayGroup],
  ] as const) {
    const mesh = new THREE.Mesh(shellGeo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10; // behind everything
    g.add(mesh);
  }

  // -- dawn mist -----------------------------------------------------------
  const mistTex = buildMistTexture();
  const mistMats: THREE.MeshBasicMaterial[] = [];
  const mistGeos: THREE.PlaneGeometry[] = [];
  MIST.forEach((m) => {
    const geo = new THREE.PlaneGeometry(m.halfW * 2, m.halfH * 2);
    const mat = new THREE.MeshBasicMaterial({
      map: mistTex,
      color: MIST_COLOR,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, m.y, m.z);
    mesh.frustumCulled = false;
    mesh.renderOrder = -6;
    dawnGroup.add(mesh);
    mistMats.push(mat);
    mistGeos.push(geo);
  });

  // -- dawn ridges ---------------------------------------------------------
  const ridgeTexs: THREE.CanvasTexture[] = [];
  const ridgeMats: THREE.MeshBasicMaterial[] = [];
  const ridgeGeos: THREE.PlaneGeometry[] = [];
  RIDGES.forEach((r) => {
    const tex = buildRidgeTexture(r.seed, r.phase);
    const geo = new THREE.PlaneGeometry(RIDGE_W, RIDGE_H);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      color: r.fill,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, RIDGE_Y, r.z);
    mesh.frustumCulled = false;
    mesh.renderOrder = -8;
    dawnGroup.add(mesh);
    ridgeTexs.push(tex);
    ridgeMats.push(mat);
    ridgeGeos.push(geo);
  });

  // -- fade state ----------------------------------------------------------
  let storyMul = 1; // 1 environments live … 0 fully suppressed by a story
  let planetVis = 1;
  let starDim = 1;
  let lastDaylight = 0;
  let lastDawn = 0;
  let lastT = 0;

  function applyDawn(a: number): void {
    dawnGroup.visible = a > 0.0015;
    if (!dawnGroup.visible) return;
    dawnShellMat.uniforms.uOpacity.value = a;
    for (let i = 0; i < mistMats.length; i++) mistMats[i].opacity = MIST[i].op * a;
    for (let i = 0; i < ridgeMats.length; i++) ridgeMats[i].opacity = RIDGES[i].op * a;
  }
  function applyStudio(a: number): void {
    studioGroup.visible = a > 0.0015;
    if (studioGroup.visible) studioShellMat.uniforms.uOpacity.value = a;
  }
  function applyDay(a: number): void {
    dayGroup.visible = a > 0.0015;
    if (dayGroup.visible) dayShellMat.uniforms.uOpacity.value = a;
  }

  return {
    group,
    update(p, gate, storyActive, artStyle) {
      const now = typeof performance !== "undefined" ? performance.now() : 0;
      const dt = lastT === 0 ? 1 / 60 : Math.min(Math.max(now - lastT, 0) / 1000, 0.1);
      lastT = now;

      // Story suppression: a linear ramp to 0 over ~0.4s (and back on release).
      const step = dt / 0.4;
      storyMul = storyActive ? Math.max(0, storyMul - step) : Math.min(1, storyMul + step);

      const artOff = artStyle !== 0;
      const aDawn = artOff ? 0 : environAmount(1, p, gate) * storyMul;
      const aStudio = artOff ? 0 : environAmount(2, p, gate) * storyMul;
      const aDay = artOff ? 0 : environAmount(3, p, gate) * storyMul;

      applyDawn(aDawn);
      applyStudio(aStudio);
      applyDay(aDay);
      lastDaylight = aDay;
      lastDawn = aDawn;

      // Galaxy fade — slewed so the studio→daylight seam (both windows 0 at
      // pose 2.5) never flashes the planets back on.
      const maxA = Math.max(aDawn, aStudio, aDay);
      const planetTarget = artStyle === 0 ? clamp01(1 - maxA) : 0;
      const dimTarget = clamp01(1 - 0.65 * aDawn - aStudio - aDay);
      planetVis = approach(planetVis, planetTarget, dt, 0.12);
      starDim = approach(starDim, dimTarget, dt, 0.12);
      let slewing = false;
      if (Math.abs(planetVis - planetTarget) < 0.002) planetVis = planetTarget;
      else slewing = true;
      if (Math.abs(starDim - dimTarget) < 0.002) starDim = dimTarget;
      else slewing = true;
      planets.setVisibleAmount(planetVis);
      stars.setDim(starDim);
      return slewing;
    },
    daylight01() {
      return lastDaylight;
    },
    dawn01() {
      return lastDawn;
    },
    dispose() {
      shellGeo.dispose();
      dawnShellMat.dispose();
      studioShellMat.dispose();
      dayShellMat.dispose();
      mistTex.dispose();
      for (const m of mistMats) m.dispose();
      for (const g of mistGeos) g.dispose();
      for (const t of ridgeTexs) t.dispose();
      for (const m of ridgeMats) m.dispose();
      for (const g of ridgeGeos) g.dispose();
    },
  };
}
