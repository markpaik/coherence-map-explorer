// Thematic environments — the sky each pose earns once it settles. The
// Constellation keeps the galaxy (stars + planets); the three structured poses
// each raise a place instead.
//
// NOTE (Ascent revert): the Sierra dawn (home 1) is currently HELD OFF — the
// Ascent reads as the dark constellation baseline with its elevation isolines,
// the design we shipped before the dawn (see docs/FORMATIONS.md). The switch is
// a single DAWN_HELD flag in update() below; the dawn's shell/mist/gate code is
// kept intact and dormant so restoring it is a one-line change. The studio
// (Blueprint) and daylight (Transit) environments are likewise dormant now that
// those poses have no switcher entry. Everything below is described as designed.
//   · home 1 (the Ascent)    → a Sierra DAWN: an inside-out gradient sky with a
//                              gold horizon band and low valley mist. The dawn
//                              lives entirely ON/AROUND the 360° shell (gradient +
//                              horizon glow + four mist planes) so an orbit never
//                              breaks it — the old distant ridge planes, which
//                              ended and broke on orbit, were removed in round-12.
//   · home 2 (the Blueprint)  → a quiet STUDIO shell — the sheet is the show.
//   · home 3 (the Transit)    → CONCRETE daylight: a clean, light overcast gradient
//                              with an infinite procedural concrete grain, enamel-
//                              sign clear (modern / street / vibrant city daylight).
//
// All three are ONE THREE.Group, each a sub-group faded by a pose window. Every
// mark is deterministic canvas + geometry — no Math.random, no Date; a fixed
// seed hash decides only texture detail (the mist grain, the concrete grain),
// never a node's position. Everything is static, so the environments are
// reduced-motion safe by construction.
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
import { HANGA, isHanga } from "./artstyle";

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
// The Hanga field as a GLSL chunk: the shell paints it, and the landscape
// (scene/landscape.ts) samples it so its mist prints the exact field color
// behind it. `dir` is the unit direction from the shell center.
export const HANGA_FIELD_GLSL = /* glsl */ `
  // Hanga field colors in sRGB (0..1 per channel), from the HANGA palette: the
  // mid field (bg), the top of the sky, the bottom of the sheet, the warm band.
  uniform vec3 uHMid;
  uniform vec3 uHTop;
  uniform vec3 uHBottom;
  uniform vec3 uHWarm;
  // Camera heading in the xz plane (unit), fed each draw for the Hanga shell.
  uniform vec2 uHFwd;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  // Hanga: the woodblock fields are authored in sRGB (as the acceptance
  // previews are), then converted once to LINEAR, because these styles keep the
  // composer (linear frame buffers, encoded to sRGB on output).
  vec3 hSrgbToLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
  }
  // Piecewise ramp: 0 below a, 1 above b.
  float hRamp(float x, float a, float b) { return clamp((x - a) / (b - a), 0.0, 1.0); }

  // Elevation stops for the Hanga fields, in units of tan(elevation) measured
  // against the camera's heading (see main). For a level camera that is linear
  // in screen height: with the 50 deg vertical fov the top of the screen sits at
  // +0.466 and the bottom at -0.466, so each stop is the preview sheet's own
  // height fraction y mapped as 0.466 * (1 - 2y).
  const float HE_TOP = 0.466;    // preview sheet top (0% height)
  const float HE_BAND = 0.424;   // Washi: full Prussian ends (4.5%)
  const float HE_MID1 = 0.354;   // 12%
  const float HE_MID2 = 0.270;   // 21%
  const float HE_CLEAR = 0.186;  // 30%: bare paper from here down
  const float HE_WARM0 = -0.280; // warm band begins (80%)
  const float HE_WARM1 = -0.359; // warm band peak (88.5%)
  const float HE_WARM2 = -0.401; // (93%)
  const float HE_FLOOR = -0.466; // preview sheet bottom (100%)

  vec3 hangaField(float e, bool dusk, vec3 dir) {
    vec3 col;
    if (!dusk) {
      // Washi daylight: Hiroshige's Prussian band at the top of the sky,
      // composited over bare paper and gone by 30% height.
      vec3 c1 = vec3(0.435294, 0.525490, 0.627451); // #6f86a0
      vec3 c2 = vec3(0.290196, 0.400000, 0.533333); // #4a6688
      vec3 c3 = vec3(0.168627, 0.290196, 0.439216); // #2b4a70
      vec3 sky = c1;
      float a = 0.0;
      sky = mix(sky, c2, hRamp(e, HE_CLEAR, HE_MID2));
      a = mix(a, 0.2, hRamp(e, HE_CLEAR, HE_MID2));
      sky = mix(sky, c3, hRamp(e, HE_MID2, HE_MID1));
      a = mix(a, 0.62, hRamp(e, HE_MID2, HE_MID1));
      sky = mix(sky, uHTop, hRamp(e, HE_MID1, HE_BAND));
      a = mix(a, 0.96, hRamp(e, HE_MID1, HE_BAND));
      a = mix(a, 1.0, hRamp(e, HE_BAND, HE_TOP));
      // Toward the zenith the Prussian deepens a little (looking up).
      sky = mix(sky, uHTop * 0.78, hRamp(e, HE_TOP, 1.4));
      col = mix(uHMid, sky, a);
      // Faint persimmon horizon band.
      vec3 w2 = vec3(0.905882, 0.603922, 0.407843); // #e79a68
      float wa = mix(0.0, 0.2, hRamp(-e, -HE_WARM0, -HE_WARM1));
      vec3 wc = mix(uHWarm, w2, hRamp(-e, -HE_WARM1, -HE_WARM2));
      wa = mix(wa, 0.12, hRamp(-e, -HE_WARM1, -HE_WARM2));
      wa = mix(wa, 0.0, hRamp(-e, -HE_WARM2, -HE_FLOOR));
      col = mix(col, wc, wa);
    } else {
      // Indigo dusk: aizuri at the top grading through the mid field to slate.
      vec3 z0 = vec3(0.031373, 0.070588, 0.164706); // #08122a
      vec3 z1 = vec3(0.039216, 0.086275, 0.184314); // #0a162f
      // Stops at the preview's 0 / 3.5 / 16 / 50 / 100% heights.
      col = uHBottom;
      col = mix(col, uHMid, hRamp(e, HE_FLOOR, 0.0));
      col = mix(col, uHTop, hRamp(e, 0.0, 0.317));
      col = mix(col, z1, hRamp(e, 0.317, 0.433));
      col = mix(col, z0, hRamp(e, 0.433, HE_TOP));
      // A thin warm glow low on the sheet (84.5 / 88.5 / 90.5 / 95% heights).
      vec3 w2 = vec3(0.850980, 0.541176, 0.368627); // #d98a5e
      float wa = mix(0.0, 0.34, hRamp(-e, 0.322, 0.359));
      vec3 wc = mix(uHWarm, w2, hRamp(-e, 0.359, 0.378));
      wa = mix(wa, 0.16, hRamp(-e, 0.359, 0.378));
      wa = mix(wa, 0.0, hRamp(-e, 0.378, 0.419));
      col = mix(col, wc, wa);
    }
    // Paper: a broad, soft mottle and a fine fiber grain stretched sideways
    // like laid washi. Direction-based, so it never seams on orbit. Quiet.
    vec2 gd = vec2(dir.x + dir.z * 0.7, dir.y);
    float m = vnoise(gd * vec2(2.6, 4.4) + 3.0) * 0.6 + vnoise(gd * vec2(6.1, 9.7) - 7.0) * 0.4;
    col *= 1.0 + (m - 0.5) * (dusk ? 0.05 : 0.04);
    float g = vnoise(gd * vec2(380.0, 640.0) + 21.0) * 0.65 + vnoise(gd * vec2(900.0, 1500.0) - 5.0) * 0.35;
    vec3 grainTint = dusk ? vec3(0.93, 0.89, 0.81) : vec3(0.42, 0.34, 0.22);
    col = mix(col, grainTint, clamp((g - 0.45) * 2.0, 0.0, 1.0) * (dusk ? 0.035 : 0.06));
    return col;
  }

  // The field at a shell direction, LINEAR out (the shell main does the same).
  vec3 hangaFieldAt(vec3 dir, bool dusk) {
    float fwd = max(dot(dir.xz, uHFwd), 0.2);
    return hSrgbToLinear(hangaField(dir.y / fwd, dusk, dir));
  }
`;

const SHELL_FRAG = /* glsl */ `
  precision highp float;
  uniform float uOpacity;
  uniform int uType;   // 0 dawn | 1 studio | 2 concrete daylight | 3 Hanga washi | 4 Hanga dusk
  ${HANGA_FIELD_GLSL}
  varying vec3 vDir;

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
      // Widened horizon glow (round-12): with the ridge planes gone the band is the
      // dawn's only depth cue, so its feather is widened ~15% (0.09 → 0.104 of
      // elevation) and its strength nudged up, carrying the horizon on its own.
      float bandMask = 1.0 - smoothstep(0.0, 0.104, abs(e - 0.02));
      col = mix(col, band, bandMask * 0.95);
    } else if (uType == 1) {
      // Studio — a quiet charcoal shell. The sheet is the show.
      vec3 top = vec3(0.062745, 0.082353, 0.113725); // #10151d
      vec3 bot = vec3(0.090196, 0.113725, 0.156863); // #171d28
      col = mix(bot, top, smoothstep(-0.4, 0.8, e));
    } else if (uType >= 3) {
      // Hanga woodblock field (3 washi, 4 dusk): full strength, LINEAR out.
      // Elevation as tan against the camera heading, so each band prints as a
      // straight horizontal band (a level camera sees it flat, like the
      // preview sheet) and still rises and falls with the camera's pitch.
      float fwd = max(dot(vDir.xz, uHFwd), 0.2);
      col = hSrgbToLinear(hangaField(vDir.y / fwd, uType == 4, vDir));
    } else {
      // Concrete daylight — clean, light overcast; a material, not a photograph.
      // Round-13 (user: "background more concrete gray"): the round-12 warm-beige
      // stops read too tan, so the stops are shifted neutral-cool — a fine grey
      // stone, not sand. The infinite procedural grain overlay below is unchanged
      // (it operates on luminance), and the cooler grey flatters the vivid palette.
      vec3 cZ = vec3(0.839216, 0.839216, 0.831373); // #d6d6d4 zenith
      vec3 cM = vec3(0.788235, 0.788235, 0.780392); // #c9c9c7 mid
      vec3 cL = vec3(0.741176, 0.741176, 0.733333); // #bdbdbb low
      col = mix(cL, cM, smoothstep(-0.10, 0.42, e));
      col = mix(col, cZ, smoothstep(0.42, 1.00, e));
      // Very-low-frequency mottle (±2.5%) — broad, soft unevenness. Direction-based
      // so it is infinite and never seams as the camera orbits.
      float lo1 = vnoise(vDir.xy * 3.0 + vDir.z * 1.7);
      float lo2 = vnoise(vDir.zx * 5.3 - 4.0);
      col *= 1.0 + ((lo1 * 0.6 + lo2 * 0.4) - 0.5) * 0.05;
      // Fine concrete grain — a multi-octave hash speckle plus sparse, slightly
      // darker pore flecks, composited like a Photoshop "light overlay" at ±5%.
      // vDir-driven → INFINITE, no tiling (the round-12 replacement for a canvas
      // texture, which would have wrapped and repeated on the shell). Non-repeating
      // per-octave phase offsets keep the speckle from beating with itself.
      vec2 gd = vDir.xy + vDir.z * 0.7;
      float gFine = vnoise(gd * 640.0 + 11.3);
      float gMed  = vnoise(gd * 230.0 - 4.0);
      float grain = (gFine - 0.5) * 0.085 + (gMed - 0.5) * 0.05;
      float pore = vnoise(gd * 400.0 + 40.0);
      grain -= smoothstep(0.80, 0.97, pore) * 0.06; // sparse darker pores
      col *= 1.0 + grain;
    }
    gl_FragColor = vec4(col, uOpacity);
    if (gl_FragColor.a < 0.002) discard;
  }
`;

export const SHELL_RADIUS = 5200; // inside the 12000 camera far plane, beyond the star shell (3600)

const srgb01 = (hex: number): THREE.Vector3 =>
  new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

function makeShellMaterial(type: 0 | 1 | 2 | 3): THREE.ShaderMaterial {
  // depthTest (round-13 occlusion fix): the shell is transparent, so it draws in
  // the transparent phase AFTER the opaque orbs (Galaxy nodes) and the opaque etch
  // markers. With depthTest OFF the two LIGHT shells (dawn / concrete daylight) at
  // full opacity PAINTED OVER that opaque geometry — the exact cause of the invisible
  // dawn orbs AND the invisible dawn/Transit grade labels. depthTest ON lets the near
  // opaque geometry occlude the far shell (radius 5200), so orbs + markers read on the
  // bright field while the shell still fills every empty pixel behind them. The DARK
  // studio shell (type 1, Blueprint) keeps the shipped depthTest:false — its dark
  // charcoal never washed the markers out and pose 2 must stay byte-identical.
  return new THREE.ShaderMaterial({
    vertexShader: SHELL_VERT,
    fragmentShader: SHELL_FRAG,
    uniforms: {
      uOpacity: { value: 0 },
      uType: { value: type },
      uHMid: { value: new THREE.Vector3() },
      uHTop: { value: new THREE.Vector3() },
      uHBottom: { value: new THREE.Vector3() },
      uHWarm: { value: new THREE.Vector3() },
      uHFwd: { value: new THREE.Vector2(0, -1) },
    },
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: type !== 1, // light shells (dawn/daylight) occlude behind opaque geometry; studio stays a pure fill
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
   * zeroes everything; storyActive lerps everything to 0 over ~0.4s. The one
   * exception is the Hanga field (styles 3 and 4): its shell shows at full
   * strength in every pose, with no endpoint gate and no story suppression,
   * because the woodblock field IS that style's paper. Returns
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
  /** Effective LIGHT-environment amount = max(dawn01, daylight01) (the two never
   *  overlap). The single amount the enamel mechanism keys off: edges flip to
   *  normal-blend vivid signage, and nodes/stations repaint to the vivid palette,
   *  whenever this owns the frame — at the Ascent dawn AND the Transit daylight. */
  envLight01(): number;
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
  const hangaGroup = new THREE.Group();
  dawnGroup.visible = studioGroup.visible = dayGroup.visible = hangaGroup.visible = false;
  group.add(dawnGroup, studioGroup, dayGroup, hangaGroup);

  // -- shells --------------------------------------------------------------
  const shellGeo = new THREE.SphereGeometry(SHELL_RADIUS, 48, 24);
  const dawnShellMat = makeShellMaterial(0);
  const studioShellMat = makeShellMaterial(1);
  const dayShellMat = makeShellMaterial(2);
  // Hanga field shell (uType 3 washi / 4 dusk, set per style in update).
  const hangaShellMat = makeShellMaterial(3);
  const fwdScratch = new THREE.Vector3();
  for (const [mat, g] of [
    [dawnShellMat, dawnGroup],
    [studioShellMat, studioGroup],
    [dayShellMat, dayGroup],
    [hangaShellMat, hangaGroup],
  ] as const) {
    const mesh = new THREE.Mesh(shellGeo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10; // behind everything
    g.add(mesh);
    // The Hanga shell reads the camera heading at draw time (no allocation).
    if (mat === hangaShellMat) {
      mesh.onBeforeRender = (_r, _s, camera) => {
        camera.getWorldDirection(fwdScratch);
        const lenXZ = Math.hypot(fwdScratch.x, fwdScratch.z);
        if (lenXZ > 1e-3) {
          (hangaShellMat.uniforms.uHFwd.value as THREE.Vector2).set(fwdScratch.x / lenXZ, fwdScratch.z / lenXZ);
        }
      };
    }
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

  // -- fade state ----------------------------------------------------------
  let storyMul = 1; // 1 environments live … 0 fully suppressed by a story
  let planetVis = 1;
  let starDim = 1;
  let lastDaylight = 0;
  let lastDawn = 0;
  let lastT = 0;
  let hangaStyle = 0; // the field the Hanga shell last painted (0 = none)

  function applyHanga(style: number): void {
    const on = isHanga(style);
    hangaGroup.visible = on;
    if (!on || style === hangaStyle) return;
    hangaStyle = style;
    const pal = style === 4 ? HANGA.dusk : HANGA.washi;
    const u = hangaShellMat.uniforms;
    u.uType.value = style;
    u.uOpacity.value = 1;
    (u.uHMid.value as THREE.Vector3).copy(srgb01(pal.bg));
    (u.uHTop.value as THREE.Vector3).copy(srgb01(pal.top));
    (u.uHBottom.value as THREE.Vector3).copy(srgb01(pal.bottom));
    (u.uHWarm.value as THREE.Vector3).copy(srgb01(pal.warm));
  }

  function applyDawn(a: number): void {
    dawnGroup.visible = a > 0.0015;
    if (!dawnGroup.visible) return;
    dawnShellMat.uniforms.uOpacity.value = a;
    for (let i = 0; i < mistMats.length; i++) mistMats[i].opacity = MIST[i].op * a;
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
      // Sierra dawn ON HOLD (Ascent reverted to the dark constellation baseline —
      // see docs/FORMATIONS.md). Holding the dawn amount at 0 here, rather than
      // deleting the shell/mist machinery below, keeps the revert a one-line change
      // and keeps the pure environAmount()/dawnWindow() math (and its tests) intact.
      // With aDawn pinned to 0 the planets stay full, the stars stay full, dawn01()
      // returns 0, and main.ts never flips body.env-light or the vivid enamel for
      // the Ascent — exactly the pre-dawn presentation.
      const DAWN_HELD = true;
      const aDawn = artOff || DAWN_HELD ? 0 : environAmount(1, p, gate) * storyMul;
      const aStudio = artOff ? 0 : environAmount(2, p, gate) * storyMul;
      const aDay = artOff ? 0 : environAmount(3, p, gate) * storyMul;

      applyDawn(aDawn);
      applyStudio(aStudio);
      applyDay(aDay);
      // Hanga field: full strength, ungated, story-proof (see the interface).
      applyHanga(artStyle);
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
    envLight01() {
      // The two light environments never overlap (dawn zero by pose 1.5, daylight
      // zero until 2.5), so a max is a clean union of the two effective amounts.
      return lastDawn > lastDaylight ? lastDawn : lastDaylight;
    },
    dispose() {
      shellGeo.dispose();
      dawnShellMat.dispose();
      studioShellMat.dispose();
      dayShellMat.dispose();
      hangaShellMat.dispose();
      mistTex.dispose();
      for (const m of mistMats) m.dispose();
      for (const g of mistGeos) g.dispose();
    },
  };
}
