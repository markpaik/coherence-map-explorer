// Fuji: Hiroshige's profile of the mountain, as a lathe mesh at the old peak's
// world position and fixed azimuth. A near-flat summit with three low bumps of
// the crater rim, wide shoulders, and a concave flank that flattens toward the
// base (the radius grows faster than the depth). The snow cap has a ragged
// line, and snow tongues run down the gullies, with faint gully lines below
// them. The body is a flat bokashi that pales toward the base and dissolves
// into the field. On Dusk the summit carries an alpenglow.

import * as THREE from "three";
import { DEG, TAU, f, lhash } from "./core";

export const FUJI = {
  az: -33 * DEG,
  R: 3400,
  apex: 420,
  /** Summit plateau radius. */
  rTop: 105,
  /** Flank: radius = rTop + s0 d + s1 d^2 at depth d below the summit. */
  s0: 1.25,
  s1: 0.0009,
  dMax: 1000,
  /** Crater rim: three low bumps (world units). */
  rimH: 10,
  /** Snow line depth, and the tongues that run down the gullies. */
  snow: 150,
  tongues: 20,
  /** The flank fades to the field over this depth range. */
  fade0: 450,
  fade1: 840,
} as const;

/** Flank radius at depth d below the summit (d >= 0). */
export const fujiRadius = (d: number): number => FUJI.rTop + FUJI.s0 * Math.max(0, d) + FUJI.s1 * Math.max(0, d) * Math.max(0, d);
/** Height of the crater rim above the apex at azimuth phi (around the axis). */
export const fujiRim = (phi: number): number =>
  FUJI.rimH * Math.max(0, 0.5 + 0.35 * Math.sin(3 * phi + 0.7) + 0.15 * Math.sin(5 * phi + 2.1));

/** Snow tongues: azimuth (rad), half-width (rad), length (world units). */
export const FUJI_TONGUES: readonly [number, number, number][] = Array.from({ length: FUJI.tongues }, (_, i) => [
  ((i + 0.3 + 0.4 * lhash(511, i)) / FUJI.tongues) * TAU,
  (1.1 + 1.5 * lhash(512, i)) * DEG,
  40 + 200 * lhash(513, i) * lhash(514, i) + 60 * lhash(513, i),
]);

/** Snow line depth at azimuth phi, before the outline relaxation. */
export function fujiSnowDepth(phi: number): number {
  let d = FUJI.snow + 8 * Math.sin(phi * 11 + 1.3) + 5 * Math.sin(phi * 23 + 0.4);
  for (const [az, w, len] of FUJI_TONGUES) {
    const da = Math.atan2(Math.sin(phi - az), Math.cos(phi - az)) / w;
    d += len * Math.exp(-da * da);
  }
  return d;
}

/** The lathe geometry: crater, rim, and flank, with the rim bumps applied. */
export function buildFujiGeometry(): THREE.BufferGeometry {
  const prof: THREE.Vector2[] = [
    new THREE.Vector2(0.01, FUJI.apex - 8),
    new THREE.Vector2(FUJI.rTop * 0.72, FUJI.apex - 3),
    new THREE.Vector2(FUJI.rTop, FUJI.apex),
  ];
  for (let i = 1; i <= 56; i++) {
    const d = FUJI.dMax * Math.pow(i / 56, 1.35);
    prof.push(new THREE.Vector2(fujiRadius(d), FUJI.apex - d));
  }
  // Lathe profiles run bottom to top for outward faces and normals.
  prof.reverse();
  const geo = new THREE.LatheGeometry(prof, 240);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > FUJI.apex - 9) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      // The rim bumps peak on the rim and fade into the crater.
      const k = Math.min(1, r / FUJI.rTop);
      pos.setY(i, y + fujiRim(Math.atan2(z, x)) * k * k);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

export const FUJI_VERT = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  void main() {
    vLocal = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

export const FUJI_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uPeak;
  uniform vec3 uPeakTop;
  uniform vec3 uPeakBase;
  uniform vec3 uCap;
  uniform float uCapOp;
  uniform vec3 uGlow;
  uniform float uGlowOp;
  uniform vec3 uGully;
  uniform float uGullyOp;
  uniform vec3 uLine;
  uniform float uLineOp;
  uniform vec3 uFalls;
  uniform float uFallsOp;
  uniform float uFallsPhi;
  uniform vec3 uTongue[${FUJI.tongues}];
  uniform float uCamAz; // camera azimuth around the axis (fed per draw)
  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  float wrapA(float a) { return mod(a + 3.14159265, 6.28318530718) - 3.14159265; }
  void main() {
    float d = ${f(FUJI.apex)} - vLocal.y; // depth below the summit
    float phi = atan(vLocal.z, vLocal.x);
    vec3 V = normalize(cameraPosition - vWorld);
    float ndv = dot(normalize(vNormalW), V);
    // Tongues seen edge-on near the outline print as streaks of the outline:
    // relax them there, by the azimuth from the camera's side of the axis.
    float dphi = abs(wrapA(phi - uCamAz));
    float relax = 1.0 - smoothstep(0.6, 0.96, dphi);
    float snowD = ${f(FUJI.snow)} + 8.0 * sin(phi * 11.0 + 1.3) + 5.0 * sin(phi * 23.0 + 0.4);
    float gully = 0.0;
    for (int i = 0; i < ${FUJI.tongues}; i++) {
      vec3 tg = uTongue[i];
      float da = wrapA(phi - tg.x) / tg.y;
      float g = exp(-da * da);
      snowD += tg.z * g * relax;
      // A gully line continues below the tongue: narrow, faint, fading out.
      float end = ${f(FUJI.snow)} + tg.z * relax;
      float dl = wrapA(phi - tg.x) / (tg.y * 0.22);
      gully = max(gully, exp(-dl * dl) * smoothstep(end - 10.0, end + 40.0, d) * (1.0 - smoothstep(end + 110.0, end + 300.0, d)));
    }
    // Body: deeper just under the snow, lifting to the body color, then paling
    // toward the base (a flat bokashi, no shading).
    vec3 col = mix(uPeakTop, uPeak, smoothstep(${f(FUJI.snow - 20)}, 380.0, d));
    col = mix(col, uPeakBase, smoothstep(320.0, 760.0, d));
    col = mix(col, uGully, gully * uGullyOp * relax);
    // Snow cap with an anti-aliased ragged line.
    float sd = snowD - d;
    float capA = clamp(sd / max(fwidth(d), 1e-3) * 0.6 + 0.5, 0.0, 1.0);
    // Alpenglow (Dusk): the top of the cap warms.
    vec3 cap = mix(uCap, uGlow, uGlowOp * (1.0 - smoothstep(10.0, 120.0, d)));
    col = mix(col, cap, capA * uCapOp);
    // Waterfall: one thin pale line down the face toward the map, with a soft
    // slow swell of ink drifting down it (about 18 s per period).
    float dd = max(d, 0.0);
    float rr = ${f(FUJI.rTop)} + ${f(FUJI.s0)} * dd + ${f(FUJI.s1)} * dd * dd;
    float arc = wrapA(phi - uFallsPhi) * rr;
    float fpx = abs(arc) / max(fwidth(arc), 1e-3);
    float fallLine = 1.0 - smoothstep(0.6, 1.5, fpx);
    float dashA = 0.85 + 0.15 * sin((d - uTime * 6.0) * 6.28318530718 / 110.0);
    float fallSpan = smoothstep(snowD - 10.0, snowD + 30.0, d) * (1.0 - smoothstep(420.0, 600.0, d));
    col = mix(col, uFalls, fallLine * dashA * fallSpan * uFallsOp * step(0.0, ndv));
    // Hairline key-block contour on the upper outline only.
    float line = 1.0 - smoothstep(0.0, 1.6 * max(fwidth(ndv), 1e-4), ndv);
    line *= 1.0 - smoothstep(330.0, 470.0, d);
    col = mix(col, uLine, line * uLineOp);
    // The flank fades to the field well below the far ridge.
    float a = 1.0 - smoothstep(${f(FUJI.fade0)}, ${f(FUJI.fade1)}, d);
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
  }
`;
