// GLSL for the Bulguksa world. Every texture term reads a surface's own
// coordinates (azimuth and height on a massif, the floor's polar coordinates,
// a mark's quad) or the sky direction, never the screen pixel alone, so nothing
// crawls when the camera moves. The one screen-fixed term is the title band,
// which belongs to the sheet (as on Washi and Dusk).

import { BCRANE, BMURM, FLOOR, MASSIFS, SNOW, TAU } from "./params";

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
    float k = exp(-max(above, 0.0) / (0.085 + 0.02 * stroke));
    vec3 col = mix(uSkyHigh, uOehun, k);
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
  varying vec3 vLocal;
  ${NOISE_GLSL}
  ${CREST_GLSL}
  // Line coverage for a signed distance d with screen width w (a hairline).
  float hair(float d, float w, float px) { return 1.0 - smoothstep(px * 0.5, px * 0.5 + w, abs(d)); }
  void main() {
    float theta = atan(vLocal.x, -vLocal.z);
    float y = vLocal.y;
    float c = crestOf(theta, uTop, uAmp, uLat, uOct, uSeed);
    float d = c - y;
    float w = max(fwidth(d), 1e-3);
    float cover = clamp(d / w + 0.5, 0.0, 1.0);
    if (cover <= 0.0) discard;
    float X = theta * uR; // arc length along the wall
    // Slope of the silhouette (world units per unit of arc).
    float e = 0.004;
    float slope = (crestOf(theta + e, uTop, uAmp, uLat, uOct, uSeed) - crestOf(theta - e, uTop, uAmp, uLat, uOct, uSeed)) / (2.0 * e * uR);
    vec3 col = uPaper;
    float ink = 0.0; // sumi line marks, composited last
    // Crest wash: a light grey just under the silhouette, so a near peak's
    // edge reads against the oehun sky without a hard outline everywhere.
    col = mix(col, uCrest, (1.0 - smoothstep(0.0, 55.0, d)) * 0.9 * uInk);
    // Folds: three inner ridgelines (overlapping peaks), each with a shade
    // wash under it and a dark tide line where the wash dried.
    for (int j = 1; j <= 3; j++) {
      float fj = float(j);
      float cj = crestOf(theta + 0.11 * fj, uTop, uAmp * (1.0 - 0.2 * fj), uLat + j * 3, uOct, uSeed + 50 * j) - 55.0 * fj;
      float inside = smoothstep(12.0, 40.0, c - cj);
      float dj = cj - y;
      float wj = max(fwidth(dj), 1e-3);
      float washSpan = 70.0 + 30.0 * vn(vec2(X / 90.0, fj * 3.0));
      float wash = step(0.0, dj) * (1.0 - smoothstep(0.0, washSpan, dj));
      col = mix(col, uShade, wash * inside * uInk);
      // Fold line: dry brush, broken along its length.
      float brk = smoothstep(0.35, 0.6, vn(vec2(X / 26.0 + fj * 13.0, fj)));
      ink = max(ink, hair(dj, 0.7, wj) * brk * inside * 0.55);
      // Tide line at the bottom edge of the wash.
      float tl = hair(dj - washSpan * 0.92, 0.5, wj) * smoothstep(0.3, 0.7, vn(vec2(X / 40.0, fj * 7.0)));
      ink = max(ink, tl * inside * 0.32);
    }
    // Jun strokes: short dry strokes that follow the slope, where the face is
    // steep enough that snow does not hold (rock shows through).
    float rock = smoothstep(0.35, 1.1, abs(slope)) * (1.0 - smoothstep(30.0, 300.0, d));
    if (rock > 0.01) {
      float ang = atan(slope);
      vec2 q = vec2(X, y);
      vec2 dirS = vec2(cos(ang), sin(ang));
      vec2 r2 = vec2(dot(q, dirS), dot(q, vec2(-dirS.y, dirS.x)));
      vec2 cell = vec2(46.0, 13.0);
      vec2 ci = floor(r2 / cell);
      vec2 cf = fract(r2 / cell) - 0.5;
      float on = step(0.45, h21(ci + float(uSeed)));
      float len = 0.3 + 0.18 * h21(ci + 7.0);
      float along = 1.0 - smoothstep(len - 0.06, len, abs(cf.x));
      float wpx = fwidth(r2.y / cell.y);
      float jun = (1.0 - smoothstep(0.08, 0.08 + wpx * 1.2, abs(cf.y))) * along * on;
      ink = max(ink, jun * rock * 0.5);
    }
    // Moss dots (near massifs): a row of small dark dots just under the crest.
    if (uInk > 0.9) {
      float cellX = 24.0;
      float ix = floor(X / cellX);
      float hx = h21(vec2(ix, 3.0));
      if (hx < 0.38) {
        vec2 cc = vec2((ix + 0.25 + 0.5 * h21(vec2(ix, 9.0))) * cellX, c - 8.0 - 18.0 * h21(vec2(ix, 5.0)));
        float rr = 2.0 + 1.6 * h21(vec2(ix, 1.0));
        float dd = length(vec2(X, y) - cc);
        float pw = max(fwidth(dd), 1e-3);
        ink = max(ink, (1.0 - smoothstep(rr - pw, rr + pw, dd)) * 0.8);
      }
    }
    // The crest contour itself: a dry hairline, heavier on near massifs.
    float brkC = mix(0.55, 1.0, smoothstep(0.25, 0.55, vn(vec2(X / 34.0, 2.0))));
    ink = max(ink, hair(d - 0.6 * w, 0.9, w) * brkC * 0.9);
    col = mix(col, uSumi, ink * uInk);
    // The base fades into the mist (the field is paper below).
    float mist = smoothstep(uTop - uFadeSpan, uTop + 10.0, y);
    float a = cover * mist;
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
  vec4 wing(float A, float lag, float len) {
    vec2 arm = 0.44 * len * vec2(-cos(A) * 0.35, sin(A));
    float H = 0.6 * A + lag;
    vec2 hand = arm + 0.62 * len * vec2(-cos(H) * 0.45, sin(H));
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
    float A = mix(-0.95, 1.25, w);
    vNear = wing(A, lag, len);
    vFar = wing(min(A + 0.45, 1.6), lag, len * 0.9);
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
    vec2 sh = vec2(0.06, 0.03);
    // Distances (negative inside) for each part.
    float dBody = cap(p, vec2(0.26, 0.02), vec2(-0.24, -0.01), 0.075, 0.05, s);
    float dTail = cap(p, vec2(-0.2, -0.005), vec2(-0.36, -0.03), 0.05, 0.02, s);
    float dNeck = cap(p, vec2(0.26, 0.03), vec2(0.64, 0.08), 0.028, 0.022, s);
    float dHead = length(p - vec2(0.68, 0.085)) - 0.036;
    float dBeak = cap(p, vec2(0.7, 0.085), vec2(0.86, 0.07), 0.013, 0.004, s);
    float sL;
    float dLegs = min(cap(p, vec2(-0.18, -0.03), vec2(-0.8, -0.07), 0.014, 0.008, sL),
                      cap(p, vec2(-0.18, -0.035), vec2(-0.78, -0.105), 0.012, 0.007, sL));
    // Wings: arm (shoulder to wrist) and hand (wrist to tip). The trailing half
    // of the arm is black (secondaries and tertials); the hand is white (primaries).
    float sN; float sNh; float sF; float sFh;
    float dNArm = cap(p, sh, sh + vNear.xy, 0.1, 0.085, sN);
    float dNHand = cap(p, sh + vNear.xy, sh + vNear.zw, 0.085, 0.012, sNh);
    float dFArm = cap(p, sh, sh + vFar.xy, 0.085, 0.07, sF);
    float dFHand = cap(p, sh + vFar.xy, sh + vFar.zw, 0.07, 0.01, sFh);
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
    float armN = clamp(-dNArm / px + 0.5, 0.0, 1.0) * step(0.0, trailN) * step(dNHand, 0.0 + 1e9);
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
    float crown = clamp((-(length(p - vec2(0.675, 0.11)) - 0.022)) / px + 0.5, 0.0, 1.0);
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
    vA = uAlpha * (fr > 0.5 ? 0.7 : 0.92);
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
// Pines (fills and lines). A pine that comes between the reader and the middle
// of the view (inside about 22 deg of the view axis) ghosts out, so an orbit
// never walls the map off behind a crown. At the home view the two framing
// pines stand at the edges and print in full.
export const PINE_VERT = /* glsl */ `
  attribute vec3 aCrown;
  #ifdef PINE_FILL
  attribute vec3 color;
  varying vec3 vCol;
  #endif
  uniform vec3 uFwd;
  varying float vA;
  void main() {
    #ifdef PINE_FILL
    vCol = color;
    #endif
    vec3 wc = (modelMatrix * vec4(aCrown, 1.0)).xyz;
    float c = dot(normalize(wc - cameraPosition), uFwd);
    vA = 1.0 - smoothstep(0.906, 0.94, c);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
export const PINE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  #ifdef PINE_FILL
  varying vec3 vCol;
  #endif
  varying float vA;
  void main() {
    float a = vA * uOpacity;
    if (a < 0.01) discard;
    #ifdef PINE_FILL
    gl_FragColor = vec4(vCol, a);
    #else
    gl_FragColor = vec4(uColor, a);
    #endif
  }
`;
