// GLSL for the Bulguksa world. Every texture term reads a surface's own
// coordinates (azimuth and height on a massif, the floor's polar coordinates,
// a mark's quad) or the sky direction, never the screen pixel alone, so nothing
// crawls when the camera moves. The one screen-fixed term is the title band,
// which belongs to the sheet (as on Washi and Dusk).

import { BCRANE, BMURM, FLOOR, MASSIFS, SNOW, SNOW_ALL_ENV, SNOW_ROCK_ENV, TAU } from "./params";

export const f = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));

/** Integer hash and periodic value noise: the Hanga landscape's, one for one. */
export const NOISE_GLSL = /* glsl */ `
  float lhash(int seed, int i) {
    uint h = uint(i) * 0x9E3779B1u + uint(seed) * 0x85EBCA77u;
    h ^= h >> 15u; h *= 0x2C1B3C6Du; h ^= h >> 12u; h *= 0x297A2D39u; h ^= h >> 15u;
    return float(h >> 8u) / 16777216.0;
  }
  float crom(float p0, float p1, float p2, float p3, float t) {
    return 0.5 * (2.0 * p1 + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t
      + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t * t * t);
  }
  float pnoise(float u, int N, int seed) {
    float x = fract(u) * float(N);
    int i = min(int(floor(x)), N - 1);
    float t = x - float(i);
    int s = seed * 977 + N;
    return crom(lhash(s, (i - 1 + N) % N), lhash(s, i), lhash(s, (i + 1) % N), lhash(s, (i + 2) % N), t);
  }
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p) {
    vec2 i = floor(p); vec2 fq = fract(p); vec2 w = fq * fq * (3.0 - 2.0 * fq);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), w.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), w.x), w.y);
  }
`;

/** The massif crest (massifCrest in params.ts), parameterized per ring. */
export const CREST_GLSL = /* glsl */ `
  float envelope(float theta) {
    float s = abs(sin(theta));
    float t = clamp((s - 0.5) / 0.42, 0.0, 1.0);
    return 0.08 + 0.92 * t * t * (3.0 - 2.0 * t);
  }
  float crestOf(float theta, float top, float amp, int lat, int oct, int seed) {
    float u = theta / ${f(TAU)};
    float s = 0.0; float a = 1.0; float tot = 0.0; int n = lat;
    for (int o = 0; o < 3; o++) {
      if (o >= oct) break;
      s += a * pnoise(u, n, seed * 7 + o);
      tot += a; a *= 0.42; n *= 2;
    }
    float v = clamp(s / tot, 0.0, 1.0);
    float peak = pow(v, 1.6);
    return top + amp * envelope(theta) * min(1.2, peak / 0.55);
  }
`;

/** The highest ridge's tangent of elevation, as seen from the world center. */
const RIDGE_GLSL = /* glsl */ `
  float ridgeTan(float theta) {
    float r = -1.0;
    ${MASSIFS.map(
      (m) => `r = max(r, crestOf(theta, ${f(m.top)}, ${f(m.amp)}, ${m.lattice}, ${m.octaves}, ${m.seed}) / ${f(m.R)});`,
    ).join("\n    ")}
    return r;
  }
`;

// ---------------------------------------------------------------------------
// Sky shell.
export const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
export const SKY_FRAG = /* glsl */ `
  uniform vec3 uPaper;
  uniform vec3 uOehun;
  uniform vec3 uOehunDeep;
  uniform vec3 uSkyHigh;
  uniform vec3 uBand;
  uniform vec2 uViewport;
  uniform float uBandBottom;
  varying vec3 vDir;
  ${NOISE_GLSL}
  ${CREST_GLSL}
  ${RIDGE_GLSL}
  void main() {
    vec3 d = normalize(vDir);
    float theta = atan(d.x, -d.z);
    float tanE = d.y / max(length(d.xz), 1e-3);
    float above = tanE - ridgeTan(theta);
    // Oehun: the sky is washed darkest right above the ridge line, so the
    // snow on the peaks shows as bare paper; the wash lifts over about 9 deg.
    // Broad horizontal wash strokes vary it a little, keyed to the direction.
    float stroke = vn(vec2(theta * 9.0, tanE * 70.0)) * 0.6 + vn(vec2(theta * 23.0 + 4.0, tanE * 160.0)) * 0.4;
    // The band of wash above the ridge is about 15% of the frame tall (0.14 in
    // tan of elevation at the home view's 50 deg field), darkest at the ridge.
    float k = 1.0 - smoothstep(0.0, 0.13 + 0.04 * stroke, max(above, 0.0));
    k = k * k;
    // Deep behind the tall massifs at the sides, lighter behind the low snow
    // hills in front of the map, so the map's pigments keep their contrast.
    vec3 deep = mix(uOehun, uOehunDeep, smoothstep(0.25, 0.75, envelope(theta)));
    vec3 col = mix(uSkyHigh, deep, k);
    // Under the ridges the mist is paper (the massif bases fade into it).
    col = mix(uPaper, col, smoothstep(-0.012, 0.004, above));
    // The sheet's title band: screen-fixed, a pale ink wash (as Washi's band).
    float s = 1.0 - gl_FragCoord.y / max(uViewport.y, 1.0);
    float bt = clamp((s - uBandBottom) / 0.18, 0.0, 1.0);
    float ba = 1.0 - smoothstep(0.0, 1.0, bt);
    col = mix(col, uBand, ba);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Massifs.
export const MASSIF_VERT = /* glsl */ `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
export const MASSIF_FRAG = /* glsl */ `
  uniform float uR;
  uniform float uTop;
  uniform float uAmp;
  uniform int uLat;
  uniform int uOct;
  uniform int uSeed;
  uniform float uFadeSpan;
  uniform float uInk;
  uniform vec3 uPaper;
  uniform vec3 uShade;
  uniform vec3 uCrest;
  uniform vec3 uSumi;
  uniform vec3 uRockLight;
  uniform vec3 uRockDark;
  varying vec3 vLocal;
  ${NOISE_GLSL}
  ${CREST_GLSL}
  float hair(float d, float w, float px) { return 1.0 - smoothstep(px * 0.5, px * 0.5 + w, abs(d)); }
  void main() {
    float theta = atan(vLocal.x, -vLocal.z);
    float y = vLocal.y;
    float c = crestOf(theta, uTop, uAmp, uLat, uOct, uSeed);
    float d = c - y; // depth below the crest
    float w = max(fwidth(d), 1e-3);
    float cover = clamp(d / w + 0.5, 0.0, 1.0);
    if (cover <= 0.0) discard;
    float X = theta * uR;
    float e = 0.004;
    float slope = (crestOf(theta + e, uTop, uAmp, uLat, uOct, uSeed) - crestOf(theta - e, uTop, uAmp, uLat, uOct, uSeed)) / (2.0 * e * uR);
    float env = envelope(theta);

    // -- snow, reserved paper ------------------------------------------------
    // The low hills in front of and behind the map are snow from crest to base
    // (massifSnowAll in params.ts). Elsewhere a stepped snow cap follows the
    // silhouette, and snow lies on the shelf under each inner fold line.
    float snowAll = 1.0 - smoothstep(${f(SNOW_ALL_ENV)}, ${f(SNOW_ROCK_ENV)}, env);
    float rag = vn(vec2(X / 7.0, y / 7.0)) * 0.6 + vn(vec2(X / 19.0, y / 13.0)) * 0.4; // ragged edge
    float sx0 = X / 48.0;
    float step1 = mix(h21(vec2(floor(sx0), float(uSeed))), h21(vec2(floor(sx0) + 1.0, float(uSeed))), smoothstep(0.7, 1.0, fract(sx0)));
    float capD = 22.0 + 46.0 * step1 + 30.0 * (1.0 - smoothstep(0.3, 1.2, abs(slope)));
    float snow = 1.0 - smoothstep(capD - 6.0, capD + 6.0, d + (rag - 0.5) * 22.0);
    float leeShade = 0.0; // grey shadow wash on the snow, lee of a fold
    float foldLine = 0.0;
    for (int j = 1; j <= 3; j++) {
      float fj = float(j);
      float cj = crestOf(theta + 0.11 * fj, uTop, uAmp * (1.0 - 0.2 * fj), uLat + j * 3, uOct, uSeed + 50 * j) - 55.0 * fj;
      float inside = smoothstep(12.0, 40.0, c - cj);
      float dj = cj - y;
      float shelf = 16.0 + 26.0 * h21(vec2(floor(X / 40.0), fj + float(uSeed)));
      float sj = step(0.0, dj) * (1.0 - smoothstep(shelf - 5.0, shelf + 5.0, dj + (rag - 0.5) * 16.0));
      snow = max(snow, sj * inside);
      // Lee side (the face turned from the light, to the right): a grey wash.
      float sl = (crestOf(theta + 0.11 * fj + e, uTop, uAmp * (1.0 - 0.2 * fj), uLat + j * 3, uOct, uSeed + 50 * j)
                - crestOf(theta + 0.11 * fj - e, uTop, uAmp * (1.0 - 0.2 * fj), uLat + j * 3, uOct, uSeed + 50 * j)) / (2.0 * e * uR);
      leeShade = max(leeShade, sj * inside * smoothstep(0.0, -0.6, sl));
      foldLine = max(foldLine, hair(dj, 0.8, max(fwidth(dj), 1e-3)) * inside * smoothstep(0.35, 0.6, vn(vec2(X / 26.0 + fj * 13.0, fj))));
    }
    // Rock shows from the crest down, deeper as the massif rises, so the snow
    // and rock meet along a ragged slanting edge, never a vertical cut.
    float body = max(c - (uTop - uFadeSpan), 1.0);
    float rockDepth = clamp((env - ${f(SNOW_ALL_ENV)}) / 0.3, 0.0, 1.0) * body * 1.05;
    float rockZone = 1.0 - smoothstep(rockDepth - 25.0, rockDepth + 25.0, d + (rag - 0.5) * 60.0);
    snow = max(snow, max(snowAll, 1.0 - rockZone));
    float rock = 1.0 - snow;

    // -- rock: a wet sumi wash ---------------------------------------------------
    float wet = vn(vec2(X / 140.0, y / 90.0)) * 0.55 + vn(vec2(X / 47.0, y / 33.0)) * 0.3 + vn(vec2(X / 13.0, y / 9.0)) * 0.15;
    vec3 rockCol = mix(uRockLight, uRockDark, smoothstep(0.25, 0.8, wet));
    // The lee face darker, the wash pooled at the snow's edge (a wet edge).
    rockCol *= slope < 0.0 ? 0.82 : 1.0;
    float edgePool = smoothstep(0.0, 0.35, rock) * (1.0 - smoothstep(0.35, 0.9, rock));
    rockCol = mix(rockCol, uSumi, 0.35 * edgePool);
    // Jun strokes: dark marks along the slope, dense enough to read at 1x.
    // The strokes follow the silhouette near the crest and loosen lower down,
    // each patch turned a little by hand.
    // One direction per patch (90 x 70 units), so every stroke stays straight.
    vec2 pch = floor(vec2(X / 90.0, y / 70.0));
    float thQ = (pch.x + 0.5) * 90.0 / uR;
    float slopeQ = (crestOf(thQ + e, uTop, uAmp, uLat, uOct, uSeed) - crestOf(thQ - e, uTop, uAmp, uLat, uOct, uSeed)) / (2.0 * e * uR);
    float ang = atan(slopeQ) * mix(1.0, 0.45, smoothstep(0.0, 220.0, d)) + (h21(pch + 17.0) - 0.5) * 0.6;
    vec2 dirS = vec2(cos(ang), sin(ang));
    vec2 r2 = vec2(dot(vec2(X, y), dirS), dot(vec2(X, y), vec2(-dirS.y, dirS.x)));
    vec2 cell = vec2(40.0, 12.0);
    float row = floor(r2.y / cell.y);
    r2.x += cell.x * h21(vec2(row, 3.0 + float(uSeed)));
    vec2 ci = floor(r2 / cell);
    vec2 cf = fract(r2 / cell) - 0.5;
    float clump = smoothstep(0.35, 0.65, vn(vec2(X / 120.0, y / 80.0) + float(uSeed)));
    float on = step(0.45, h21(ci + float(uSeed))) * clump;
    float len = 0.3 + 0.18 * h21(ci + 7.0);
    float sx = (cf.x - (h21(ci + 11.0) - 0.5) * 0.3) / len;
    float along = 1.0 - smoothstep(0.8, 1.0, abs(sx));
    float wd = mix(0.24, 0.07, clamp(sx * 0.5 + 0.5, 0.0, 1.0));
    float wpx = fwidth(r2.y / cell.y);
    float jun = (1.0 - smoothstep(wd, wd + wpx * 1.2, abs(cf.y))) * along * on;
    rockCol = mix(rockCol, uSumi, jun * 0.9);

    // -- compose -----------------------------------------------------------------
    vec3 snowCol = mix(uPaper, uShade, 0.8 * leeShade);
    snowCol = mix(snowCol, uCrest, (1.0 - smoothstep(0.0, 18.0, d)) * 0.6 * (1.0 - snowAll));
    vec3 col = mix(rockCol, snowCol, snow);
    // Fold lines and the crest contour, dry hairlines.
    float brkC = mix(0.55, 1.0, smoothstep(0.25, 0.55, vn(vec2(X / 34.0, 2.0))));
    float ink = max(foldLine * 0.5 * snow, hair(d - 0.6 * w, 0.5 + 0.9 * uInk, w) * brkC * 0.8);
    col = mix(col, uSumi, ink);
    // Far massifs recede into the mist: everything lifts toward the paper.
    col = mix(uPaper, col, 0.3 + 0.7 * uInk);
    // The base fades into the mist, with a dark tide line where the wash dried.
    float mist = smoothstep(uTop - uFadeSpan, uTop + 10.0, y);
    float tideY = uTop - uFadeSpan * 0.42 + (vn(vec2(X / 60.0, 5.0)) - 0.5) * 18.0;
    float tide = hair(y - tideY, 0.7, max(fwidth(y), 1e-3)) * rock * smoothstep(0.3, 0.6, vn(vec2(X / 30.0, 9.0)));
    col = mix(col, uSumi, tide * 0.7 * uInk);
    float a = cover * max(mist, tide * 0.8);
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
  }
`;

// ---------------------------------------------------------------------------
// Floor: the snow slope. Paper, with faint drift washes toward the rim.
export const FLOOR_VERT = /* glsl */ `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
export const FLOOR_FRAG = /* glsl */ `
  uniform vec3 uPaper;
  uniform vec3 uShade;
  varying vec3 vLocal;
  ${NOISE_GLSL}
  void main() {
    float r = length(vLocal.xz);
    float phi = atan(vLocal.x, -vLocal.z);
    // Wind drifts: long soft bands across the slope, only toward the rim.
    float band = vn(vec2(phi * 18.0, r / 140.0)) * 0.6 + vn(vec2(phi * 41.0 + 3.0, r / 60.0)) * 0.4;
    float drift = smoothstep(0.55, 0.85, band) * smoothstep(${f(FLOOR.r0)}, ${f(FLOOR.r1)}, r);
    vec3 col = mix(uPaper, uShade, drift * 0.55);
    // A faint grey ink contour of the slope's shape: three wandering hairlines.
    float lines = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float rr = ${f(FLOOR.r0 + 180)} + fi * 330.0 + 60.0 * (vn(vec2(phi * 5.0 + fi * 7.0, fi)) - 0.5);
      float dl = abs(r - rr) / max(fwidth(r), 1e-3);
      float brk = smoothstep(0.3, 0.55, vn(vec2(phi * 14.0 + fi * 3.0, 4.0 + fi)));
      lines = max(lines, (1.0 - smoothstep(0.4, 1.2, dl)) * brk);
    }
    col = mix(col, uShade * 0.62, lines * 0.55);
    float a = 1.0 - smoothstep(${f(FLOOR.R - 70)}, ${f(FLOOR.R)}, r);
    gl_FragColor = vec4(col, a);
  }
`;

// ---------------------------------------------------------------------------
// Ink marks along the far edge of the slope: small pines, reed tufts, rocks.
// Camera-facing about the vertical (they stand up from any orbit).
export const MARK_VERT = /* glsl */ `
  attribute vec4 aMark; // x, z, height, seed
  attribute float aY;
  varying vec2 vUv;
  varying float vSeed;
  void main() {
    vec3 base = vec3(aMark.x, aY, aMark.y);
    vec3 toCam = cameraPosition - (modelMatrix * vec4(base, 1.0)).xyz;
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    float h = aMark.z;
    vec3 p = base + right * position.x * h * 0.6 + vec3(0.0, (position.y + 0.5) * h, 0.0);
    vUv = vec2(position.x * 2.0, position.y + 0.5);
    vSeed = aMark.w;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
export const MARK_FRAG = /* glsl */ `
  uniform vec3 uSumi;
  uniform vec3 uPaper;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vSeed;
  float seg(vec2 p, vec2 a, vec2 b, float r) {
    vec2 pa = p - a; vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    return length(pa - ba * h) - r;
  }
  void main() {
    vec2 p = vUv; // x -1..1, y 0..1
    float px = max(fwidth(p.y), 1e-4);
    float ink = 0.0;
    float snow = 0.0;
    float kind = fract(vSeed * 7.31);
    if (kind < 0.5) {
      // A small pine: a stem and three stacked dark dabs, each capped in snow.
      ink = max(ink, 1.0 - smoothstep(0.0, px * 1.5, seg(p, vec2(0.0, 0.0), vec2(0.03, 0.95), 0.02)));
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        vec2 c = vec2((fract(vSeed * (3.1 + fi)) - 0.5) * 0.25, 0.42 + fi * 0.2);
        vec2 q = (p - c) / vec2(0.62 - fi * 0.14, 0.09);
        float dd = length(q) - 1.0;
        float dab = 1.0 - smoothstep(-0.15, 0.1, dd);
        float cap = (1.0 - smoothstep(-0.2, 0.05, length((p - c - vec2(0.0, 0.05)) / vec2(0.5 - fi * 0.12, 0.05)) - 1.0));
        ink = max(ink, dab);
        snow = max(snow, cap);
      }
    } else if (kind < 0.85) {
      // Reeds: a tuft of thin strokes leaning with the wind.
      for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float lean = (fract(vSeed * (5.7 + fi)) - 0.35) * 0.9;
        float hgt = 0.55 + 0.45 * fract(vSeed * (2.3 + fi * 1.7));
        float x0 = (fi - 2.0) * 0.08;
        ink = max(ink, (1.0 - smoothstep(0.0, px * 1.4, seg(p, vec2(x0, 0.0), vec2(x0 + lean, hgt), 0.012))) * 0.85);
      }
    } else {
      // A rock: a dark dab with a snow top.
      vec2 q = (p - vec2(0.0, 0.18)) / vec2(0.75, 0.2);
      ink = 1.0 - smoothstep(-0.1, 0.08, length(q) - 1.0);
      snow = 1.0 - smoothstep(-0.1, 0.05, length((p - vec2(0.0, 0.3)) / vec2(0.65, 0.1)) - 1.0);
    }
    float a = max(ink, snow) * uOpacity;
    if (a < 0.01) discard;
    vec3 col = mix(uSumi, uPaper, snow);
    gl_FragColor = vec4(col, a);
  }
`;

// ---------------------------------------------------------------------------
// Falling snow.
export const SNOW_VERT = /* glsl */ `
  attribute vec4 aSeed; // sx, sy, sz, sv
  uniform float uTime;
  uniform vec3 uCenter;
  uniform float uPx;
  varying float vA;
  const float TAU = 6.28318530718;
  float wrapH(float x, float h) { return mod(x + h, 2.0 * h) - h; }
  void main() {
    float v = ${f(SNOW.v0)} + ${f(SNOW.v1 - SNOW.v0)} * aSeed.w;
    float pd = ${f(SNOW.pDrift0)} + ${f(SNOW.pDrift1 - SNOW.pDrift0)} * aSeed.x;
    vec3 o = vec3(
      wrapH((aSeed.x - 0.5) * ${f(2 * SNOW.hx)} + ${f(SNOW.drift)} * sin(uTime * TAU / pd + aSeed.z * 9.0) - uCenter.x, ${f(SNOW.hx)}),
      wrapH((aSeed.y - 0.5) * ${f(2 * SNOW.hy)} - v * uTime - uCenter.y, ${f(SNOW.hy)}),
      wrapH((aSeed.z - 0.5) * ${f(2 * SNOW.hz)} + ${f(0.6 * SNOW.drift)} * cos(uTime * TAU / (pd * 1.3) + aSeed.y * 7.0) - uCenter.z, ${f(SNOW.hz)}));
    vec3 p = uCenter + o;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = max(-mv.z, 1.0);
    float size = mix(${f(SNOW.px0)}, ${f(SNOW.px1)}, fract(aSeed.w * 13.7)) * 900.0 / dist;
    // Never below 1.6 CSS px, so a far flake never twinkles in and out.
    gl_PointSize = max(size, 1.6) * uPx;
    // Fade near the box faces, so a wrapping flake never pops.
    vec3 q = abs(o) / vec3(${f(SNOW.hx)}, ${f(SNOW.hy)}, ${f(SNOW.hz)});
    float edge = 1.0 - smoothstep(0.82, 1.0, max(max(q.x, q.y), q.z));
    float near = smoothstep(60.0, 220.0, dist);
    vA = edge * near * min(1.0, size / 1.6);
  }
`;
export const SNOW_FRAG = /* glsl */ `
  uniform vec3 uPaper;
  uniform vec3 uRim;
  uniform float uOpacity;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float body = 1.0 - smoothstep(0.55, 0.95, d);
    // A faint grey rim, so a flake also reads where it crosses the paper.
    float rim = smoothstep(0.45, 0.75, d) * (1.0 - smoothstep(0.8, 1.0, d));
    float a = max(body, rim * 0.6) * vA * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(uPaper, uRim, rim * (1.0 - body * 0.6)), a);
  }
`;

// ---------------------------------------------------------------------------
// Cranes: red-crowned cranes in one slow stroke, as signed-distance strokes on
// a camera-facing quad that flies along its screen path.
export const CRANE_VERT = /* glsl */ `
  attribute vec4 aSlot; // lag, rise, wing phase, index
  uniform float uProg;
  uniform float uAz0;
  uniform float uAz1;
  uniform float uR;
  uniform float uEl;
  uniform float uCount;
  uniform float uTime;
  uniform float uAlpha;
  uniform float uSize;
  varying vec2 vUv;
  varying float vA;
  varying vec4 vNear;
  varying vec4 vFar;
  vec3 pathAt(float p, float rise) {
    float az = mix(uAz0, uAz1, p);
    return vec3(uR * sin(az), uR * tan(uEl) + rise, -uR * cos(az));
  }
  // A wing seen from below and to the side, as ink paintings show a crane in
  // flight: theta is the arm's angle from the backward axis (+ up). The hand
  // bends back toward the horizontal and lags the beat.
  vec4 wing(float th, float lag, float len) {
    vec2 arm = 0.3 * len * vec2(-cos(th), sin(th));
    float H = th * 0.72 + lag;
    vec2 hand = arm + 0.42 * len * vec2(-cos(H), sin(H));
    return vec4(arm, hand);
  }
  void main() {
    float p = uProg - aSlot.x;
    float rise = aSlot.y + 6.0 * sin(uTime * 6.28318 / 11.0 + aSlot.z * 6.28318);
    vec4 v1 = modelViewMatrix * vec4(pathAt(p, rise), 1.0);
    vec4 v2 = modelViewMatrix * vec4(pathAt(p + 0.004, rise), 1.0);
    vec2 dir = v2.xy / max(-v2.z, 1.0) - v1.xy / max(-v1.z, 1.0);
    dir = length(dir) > 1e-7 ? normalize(dir) : vec2(1.0, 0.0);
    vec2 perp = vec2(-dir.y, dir.x);
    if (perp.y < 0.0) perp = -perp;
    vec4 mv = v1;
    mv.xy += (position.x * dir + position.y * perp) * uSize;
    gl_Position = projectionMatrix * mv;
    vUv = position.xy;
    float ends = smoothstep(0.0, 0.08, p) * (1.0 - smoothstep(0.92, 1.0, p));
    vA = uAlpha * ends * step(aSlot.w + 0.5, uCount);
    // One slow, deep stroke: each bird at its own phase of it.
    float ph = 6.28318530718 * uTime / ${f(BCRANE.wingPeriod)} + aSlot.z * 6.28318530718;
    float beat = sin(ph);
    float w = 0.5 + 0.5 * beat;
    float lag = -0.35 * cos(ph);
    float len = 0.8 + 0.2 * abs(beat);
    // Both wings ride one stroke: the near wing sweeps below the body line,
    // the far wing above it, so the spread reads at every phase.
    float e = mix(-0.5, 1.0, w);
    vNear = wing(-1.3 + 0.55 * e, lag, len);
    vFar = wing(1.25 + 0.5 * e, -lag, len * 0.92);
  }
`;
export const CRANE_FRAG = /* glsl */ `
  uniform vec3 uInk;
  uniform vec3 uWhite;
  uniform vec3 uRed;
  uniform vec3 uLine;
  varying vec2 vUv;
  varying float vA;
  varying vec4 vNear;
  varying vec4 vFar;
  // Distance to a tapered capsule from a (radius ra) to b (radius rb); also
  // returns the side of the bone the point lies on (+ = left of a->b) in s.
  float cap(vec2 p, vec2 a, vec2 b, float ra, float rb, out float s) {
    vec2 pa = p - a; vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    vec2 q = pa - ba * h;
    s = ba.x * pa.y - ba.y * pa.x;
    return length(q) - mix(ra, rb, h);
  }
  void main() {
    if (vA <= 0.001) discard;
    vec2 p = vUv;
    float px = max(fwidth(p.x) + fwidth(p.y), 1e-4) * 0.7071;
    float s;
    vec2 sh = vec2(0.05, 0.02);
    // The body prints at 0.8 of the wing scale (a crane's span is about twice its length).
    vec2 pq = p;
    p = p * 1.25;
    // Distances (negative inside) for each part.
    float dBody = cap(p, vec2(0.26, 0.02), vec2(-0.24, -0.01), 0.075, 0.05, s);
    float dTail = cap(p, vec2(-0.2, -0.005), vec2(-0.36, -0.03), 0.05, 0.02, s);
    float dNeck = cap(p, vec2(0.26, 0.03), vec2(0.64, 0.08), 0.028, 0.022, s);
    float dHead = length(p - vec2(0.68, 0.085)) - 0.036;
    float dBeak = cap(p, vec2(0.7, 0.085), vec2(0.86, 0.07), 0.013, 0.004, s);
    float sL;
    float dLegs = min(cap(p, vec2(-0.18, -0.03), vec2(-0.8, -0.07), 0.014, 0.008, sL),
                      cap(p, vec2(-0.18, -0.035), vec2(-0.78, -0.105), 0.012, 0.007, sL));
    // Back to wing space; body distances shrink with the body.
    dBody *= 0.8; dTail *= 0.8; dNeck *= 0.8; dHead *= 0.8; dBeak *= 0.8; dLegs *= 0.8;
    vec2 pHead = p;
    p = pq;
    // Wings: arm (shoulder to wrist) and hand (wrist to tip). The trailing half
    // of the arm is black (secondaries and tertials); the hand is white (primaries).
    float sN; float sNh; float sF; float sFh;
    float dNArm = cap(p, sh, sh + vNear.xy, 0.13, 0.115, sN);
    float dNHand = cap(p, sh + vNear.xy, sh + vNear.zw, 0.115, 0.014, sNh);
    float dFArm = cap(p, sh, sh + vFar.xy, 0.11, 0.095, sF);
    float dFHand = cap(p, sh + vFar.xy, sh + vFar.zw, 0.095, 0.012, sFh);
    // The trailing edge faces backward (-x): pick the side of the bone that does.
    vec2 nb = normalize(vNear.xy + vec2(1e-5));
    float trailN = (nb.y >= 0.0 ? 1.0 : -1.0) * sN; // > 0 on the trailing side
    vec2 fb = normalize(vFar.xy + vec2(1e-5));
    float trailF = (fb.y >= 0.0 ? 1.0 : -1.0) * sF;
    float dWhite = min(min(dBody, dTail), min(dNHand, min(dFHand, dHead + 0.012)));
    float dWhiteArm = min(dNArm, dFArm);
    float dAll = min(min(dWhite, dWhiteArm), min(min(dNeck, dHead), min(dBeak, dLegs)));
    float cover = clamp(-dAll / px + 0.5, 0.0, 1.0);
    // A faint ink outline around the whole bird, so white reads on paper.
    float outline = clamp((1.2 * px - dAll) / px, 0.0, 1.0) * (1.0 - cover);
    vec3 col = uWhite;
    // Black: neck, the trailing half of each arm, a dark beak and legs.
    float black = 0.0;
    black = max(black, clamp(-dNeck / px + 0.5, 0.0, 1.0));
    float armN = clamp(-dNArm / px + 0.5, 0.0, 1.0) * step(0.0, trailN);
    float armF = clamp(-dFArm / px + 0.5, 0.0, 1.0) * step(0.0, trailF);
    black = max(black, max(armN, armF * 0.9));
    float legs = clamp(-dLegs / px + 0.5, 0.0, 1.0) * (1.0 - clamp(-dBody / px + 0.5, 0.0, 1.0));
    black = max(black, legs * 0.85);
    black = max(black, clamp(-dBeak / px + 0.5, 0.0, 1.0) * 0.6);
    // The near wing's white hand covers the far wing; the body covers the far arm.
    float overBlack = clamp(-min(dBody, dNHand) / px + 0.5, 0.0, 1.0) * (1.0 - armN);
    black *= 1.0 - overBlack * (1.0 - clamp(-dNeck / px + 0.5, 0.0, 1.0));
    col = mix(col, uInk, black);
    // The red crown on top of the head.
    float crown = clamp((-(length(pHead - vec2(0.675, 0.11)) - 0.024) * 0.8) / px + 0.5, 0.0, 1.0);
    col = mix(col, uRed, crown);
    float a = max(cover, outline * 0.6) * vA;
    col = mix(uLine, col, cover / max(cover + outline * 0.6 * (1.0 - cover), 1e-4));
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, a);
  }
`;

// ---------------------------------------------------------------------------
// Murmuration: a folded thin sheet (murmPosition in params.ts, one for one).
export const MURM_VERT = /* glsl */ `
  attribute vec4 aSeed; // u0, v0, hash, fringe
  uniform float uTime;
  uniform float uAlpha;
  uniform float uPx;
  varying float vA;
  varying float vRot;
  const float TAU = 6.28318530718;
  void main() {
    float t = uTime;
    float h = aSeed.z;
    float fr = aSeed.w;
    float phi = atan(aSeed.y, aSeed.x);
    float edge = 0.91 + 0.06 * sin(2.0 * phi + t * TAU / ${f(BMURM.pEdge)})
                      + 0.03 * sin(3.0 * phi - t * TAU / ${f(BMURM.pEdge * 1.37)} + 1.1);
    float r = length(aSeed.xy) * edge;
    float u = r * cos(phi);
    float v = r * sin(phi);
    float w = TAU / ${f(BMURM.pFold)};
    float fold = ${f(BMURM.fold)} * (sin(1.7 * u + t * w) * 0.7 + sin(2.3 * v - t * w * 0.8 + 1.3) * 0.3);
    float jit = fr > 0.5 ? 60.0 : 8.0;
    float ju = jit * sin(t * TAU / (22.0 + 18.0 * h) + h * 40.0);
    float jv = jit * sin(t * TAU / (25.0 + 15.0 * h) + h * 23.0);
    float along = u * ${f(BMURM.a)} + ju;
    float across = v * ${f(BMURM.b)} + jv;
    float thick = (h - 0.5) * 2.0 * ${f(BMURM.th)} + fold;
    float tl = ${f(BMURM.tilt)} + ${f(BMURM.tiltSwing)} * sin(t * TAU / ${f(BMURM.pTilt)});
    float up = across * cos(tl) - thick * sin(tl);
    float depth = across * sin(tl) + thick * cos(tl);
    float turn = 0.5 * sin(t * TAU / ${f(BMURM.pTurn)});
    float az = ${f(BMURM.az)} + ${f(BMURM.azSwing)} * sin(t * TAU / ${f(BMURM.pDrift)});
    float el = ${f(BMURM.el)} + ${f(BMURM.elSwing)} * sin(t * TAU / ${f(BMURM.pDrift * 1.3)} + 0.7);
    vec3 c = vec3(${f(BMURM.R)} * sin(az), ${f(BMURM.R)} * tan(el), -${f(BMURM.R)} * cos(az));
    vec2 T0 = vec2(cos(az), sin(az));
    vec2 N0 = vec2(-sin(az), cos(az));
    float ct = cos(turn); float st = sin(turn);
    vec2 T = T0 * ct + N0 * st;
    vec2 N = -T0 * st + N0 * ct;
    vec3 world = c + vec3(T.x * along + N.x * depth, up, T.y * along + N.y * depth);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
    gl_PointSize = mix(${f(BMURM.px0)}, ${f(BMURM.px1)}, h) * uPx;
    // A thin interior (the sheet reads by its edge and its folds, not as a
    // solid block), the stragglers a little darker so the fringe shows.
    vA = uAlpha * (fr > 0.5 ? 0.78 : 0.55);
    vRot = (h - 0.5) * 0.9;
  }
`;
export const MURM_FRAG = /* glsl */ `
  uniform vec3 uInk;
  varying float vA;
  varying float vRot;
  void main() {
    // A small chevron (wings up), turned a little per bird. At 1x it reads as
    // a dark speck; at 2x the two wings separate.
    vec2 q = gl_PointCoord - 0.5;
    q.y = -q.y;
    float c = cos(vRot); float s = sin(vRot);
    q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    float wing = abs(abs(q.x) * 0.7 - (q.y + 0.08)) ;
    float body = length(q / vec2(0.5, 0.32));
    float d = min(wing / 0.16, body / 0.55);
    float a = (1.0 - smoothstep(0.55, 1.0, d)) * step(abs(q.x), 0.48) * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uInk, a);
  }
`;

// ---------------------------------------------------------------------------
// Pines. A pine that comes between the reader and the middle of the view
// (inside about 22 deg of the view axis) ghosts out, so an orbit never walls
// the map off behind a crown. At the home view the two framing pines stand at
// the edges and print in full.
const PINE_FADE = /* glsl */ `
  float pineFade(vec3 crownLocal) {
    vec3 wc = (modelMatrix * vec4(crownLocal, 1.0)).xyz;
    float c = dot(normalize(wc - cameraPosition), uFwd);
    return 1.0 - smoothstep(0.906, 0.94, c);
  }
`;
// Trunk and limbs: smooth tubes, inked in the fragment shader.
export const WOOD_VERT = /* glsl */ `
  attribute vec3 aCrown;
  attribute vec2 aBark;
  uniform vec3 uFwd;
  varying float vA;
  varying vec2 vBark;
  varying vec3 vN;
  varying vec3 vV;
  ${PINE_FADE}
  void main() {
    vA = pineFade(aCrown);
    vBark = aBark;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = cameraPosition - w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
export const WOOD_FRAG = /* glsl */ `
  uniform vec3 uBark;
  uniform vec3 uSumi;
  uniform vec3 uPaper;
  varying float vA;
  varying vec2 vBark;
  varying vec3 vN;
  varying vec3 vV;
  ${NOISE_GLSL}
  void main() {
    if (vA < 0.01) discard;
    float ndv = abs(dot(normalize(vN), normalize(vV)));
    // A wet-ink edge: the wash pools at the silhouette and pales at the core.
    vec3 col = mix(uSumi, uBark, smoothstep(0.08, 0.7, ndv));
    col = mix(col, uPaper, 0.18 * smoothstep(0.75, 1.0, ndv));
    // Plated bark: short dark strokes across the trunk, staggered plates.
    // Each mark is a short thin dash of a plate edge, staggered row to row.
    float L = vBark.x / 6.0;
    float row = floor(L);
    float sh = h21(vec2(row, 1.0));
    float cu = vBark.y * 7.0 + sh;
    float ci = floor(cu);
    float u = fract(cu);
    float hp = h21(vec2(row, ci));
    float u0 = 0.1 + 0.3 * h21(vec2(row, ci + 5.0));
    float u1 = u0 + 0.25 + 0.35 * hp;
    float yOff = (h21(vec2(row, ci + 9.0)) - 0.5) * 0.5;
    float thick = 0.06 + 0.05 * hp;
    float across = 1.0 - smoothstep(thick, thick + fwidth(L) * 1.5, abs(fract(L) - 0.5 - yOff));
    float mark = across * step(0.45, hp) * smoothstep(u0, u0 + 0.05, u) * (1.0 - smoothstep(u1 - 0.05, u1, u));
    col = mix(col, uSumi, 0.8 * mark);
    gl_FragColor = vec4(col, vA);
  }
`;
// Needle pads: camera-facing cards drawn as needle fans under snow.
export const PAD_VERT = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec3 aCrown;
  attribute vec3 aPad; // rx, ry, seed
  uniform vec3 uFwd;
  varying vec2 vP;
  varying float vSeed;
  varying float vA;
  ${PINE_FADE}
  void main() {
    vA = pineFade(aCrown);
    vec3 wc = (modelMatrix * vec4(aCenter, 1.0)).xyz;
    vec3 toCam = normalize(cameraPosition - wc);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam) + vec3(1e-4, 0.0, 0.0));
    vec3 up = normalize(mix(vec3(0.0, 1.0, 0.0), cross(toCam, right), 0.35));
    vec3 p = wc + right * position.x * aPad.x + up * position.y * aPad.y;
    vP = position.xy;
    vSeed = aPad.z;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;
export const PAD_FRAG = /* glsl */ `
  uniform vec3 uSumi;
  uniform vec3 uPad;
  uniform vec3 uPaper;
  uniform vec3 uShadow;
  varying vec2 vP;
  varying float vSeed;
  varying float vA;
  ${NOISE_GLSL}
  void main() {
    if (vA < 0.01) discard;
    vec2 p = vP; // -1..1 across, -1..1 up
    float px = max(fwidth(p.x), fwidth(p.y));
    // The fan grows from a point just under the card; needles radiate from it.
    vec2 o = vec2(0.0, -1.3);
    vec2 q = p - o;
    float phi = atan(q.x, q.y);
    float r = length(q);
    // Body: an ellipse, its rim cut into needle tips (triangular teeth) that
    // come and go in clusters.
    float body = length(p / vec2(0.95, 0.8));
    float teeth = abs(fract(phi * 11.0 + vSeed * 7.0) - 0.5) * 2.0;
    float cluster = vn(vec2(phi * 4.0 + vSeed * 13.0, 1.0));
    // Clusters of needle tips: the rim swells and recedes, cut into teeth.
    float rim = 0.62 + 0.18 * cluster + 0.2 * (1.0 - teeth) * (0.4 + 0.6 * cluster);
    float dEdge = body - rim;
    float needles = 1.0 - smoothstep(-px, px, dEdge);
    // Needle streaks: fine radiating lines, a touch lighter, inside the fan.
    float streak = smoothstep(0.7, 1.0, abs(sin(phi * 70.0 + vSeed * 31.0))) * smoothstep(0.3, 0.9, body);
    vec3 col = mix(uPad, uSumi, 0.5 + 0.5 * vn(p * 3.0 + vSeed * 9.0));
    col = mix(col, uShadow, 0.25 * streak);
    // Snow pillow: reserved paper on top, a soft ragged lower edge.
    float rag = vn(vec2(p.x * 9.0 + vSeed * 17.0, 2.0)) - 0.5;
    float snowLow = 0.3 + 0.35 * p.x * p.x + 0.12 * rag;
    float pillow = length((p - vec2(0.0, 0.42)) / vec2(0.78, 0.4));
    float snow = (1.0 - smoothstep(-px * 1.5, px * 1.5, snowLow - p.y)) * (1.0 - smoothstep(1.0 - px * 1.5, 1.0 + px * 1.5, pillow));
    // A soft grey wash where the snow meets the needles.
    float wash = smoothstep(snowLow - 0.22, snowLow, p.y) * (1.0 - snow) * needles;
    col = mix(col, uShadow, 0.7 * wash);
    col = mix(col, uPaper, snow);
    float a = max(needles, snow) * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;

// ---------------------------------------------------------------------------
// Temple fills: paper tones baked per vertex; aWash mottles a wet ink wash
// over the walls, soffits, and boulders, keyed to the plan position.
export const TEMPLE_VERT = /* glsl */ `
  attribute vec3 color;
  attribute float aWash;
  varying vec3 vCol;
  varying float vWash;
  varying vec3 vP;
  void main() {
    vCol = color;
    vWash = aWash;
    vP = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
export const TEMPLE_FRAG = /* glsl */ `
  varying vec3 vCol;
  varying float vWash;
  varying vec3 vP;
  ${NOISE_GLSL}
  void main() {
    vec3 col = vCol;
    if (vWash > 0.0) {
      vec2 q = vec2(vP.x + vP.z * 0.7, vP.y * 1.6);
      float n = vn(q * 0.35) * 0.55 + vn(q * 1.1 + 7.0) * 0.3 + vn(q * 3.3 + 3.0) * 0.15;
      // Wet wash: darker blooms with a pale core, never brighter than the tone.
      col *= 1.0 - vWash * (0.08 + 0.26 * smoothstep(0.35, 0.85, n));
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;
