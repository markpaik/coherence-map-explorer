// Distant planets — three faint procedural bodies far behind the
// constellation: a banded gas giant low on the horizon, its small cratered
// moon, and a pale ice dwarf on the far side. Atmosphere, not attraction:
// they sit well below the bloom threshold, at ~one-tenth opacity, inside the
// starfield shell, and they FADE OUT as the scene leaves the Constellation
// pose (the Ascent and the Blueprint are arguments, not skies).
//
// Entirely procedural (no textures): banded fbm for the giant, value-noise
// mottling for the moon, a smooth crescent for the dwarf — all lit by the
// same assumed upper-left key the orbs use, with limb darkening and a thin
// atmospheric rim. Static world positions (same parallax rationale as the
// starfield); the giant's bands drift slowly with scene time.

import * as THREE from "three";

const VERT = /* glsl */ `
  varying vec3 vNrm;      // WORLD-space normal: phases live in the world,
  varying vec3 vViewPos;  // not on the camera — orbiting changes what you see
  void main() {
    vNrm = normalize(mat3(modelMatrix) * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uFade;   // 0..1 — pose fade (Constellation only)
  uniform float uAlpha;  // body's own faintness
  uniform int uType;     // 0 gas giant | 1 rocky moon | 2 ice dwarf
  uniform vec3 uColA;    // base
  uniform vec3 uColB;    // band / mottle
  uniform vec3 uColC;    // accent band / rim
  uniform vec3 uLightDir; // WORLD-space sun direction (rotates with the clock)

  varying vec3 vNrm;
  varying vec3 vViewPos;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int k = 0; k < 3; k++) {
      v += a * noise(p);
      p *= 2.13;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 n = normalize(vNrm);
    vec3 V = normalize(vViewPos);
    float facing = max(dot(n, V), 0.0);
    float limb = pow(1.0 - facing, 1.8);
    vec3 L = normalize(uLightDir);
    float nl = dot(n, L);
    // Eclipse light: the sun sits mostly BEHIND each body, so only a waxing/
    // waning sliver catches it; the rest of the disc is a shadowed silhouette
    // that barely separates from the sky. Sharp terminator, deep night.
    float day = smoothstep(-0.03, 0.22, nl);

    vec3 col;
    if (uType == 0) {
      // Gas giant: fbm-warped horizontal bands, slowly drifting.
      float lat = n.y * 5.2;
      float warp = fbm(vec2(n.x * 2.6 + uTime * 0.008, n.y * 3.1)) * 1.35;
      float t = lat + warp;
      float band = 0.5 + 0.5 * sin(t * 3.4);
      float accent = smoothstep(0.72, 0.98, 0.5 + 0.5 * sin(t * 1.25 + 1.7));
      col = mix(uColA, uColB, band);
      col = mix(col, uColC, accent * 0.55);
    } else if (uType == 1) {
      // Rocky moon: value-noise mottling + a few darker maria patches.
      float m = fbm(vec2(n.x * 7.0 + 3.0, n.y * 7.0));
      float maria = smoothstep(0.62, 0.78, fbm(vec2(n.x * 2.3, n.y * 2.4 + 9.0)));
      col = mix(uColA, uColB, m * 0.8);
      col = mix(col, uColB * 0.55, maria * 0.6);
    } else {
      // Ice dwarf: near-smooth, a faint frost gradient toward the poles.
      float frost = smoothstep(0.1, 0.9, abs(n.y)) * 0.5;
      float wisp = fbm(vec2(n.x * 3.2, n.y * 4.4)) * 0.25;
      col = mix(uColA, uColB, frost + wisp);
    }

    col *= (0.055 + 0.945 * day);     // shadowed body, lit sliver
    col *= 1.0 - 0.45 * limb;         // limb darkening on the lit sliver
    // Rim: a brighter arc where the sliver meets the limb, plus the faintest
    // full-circumference corona hint so the eclipsed disc still whispers.
    col += uColC * pow(1.0 - facing, 3.2) * 0.5 * day;
    col += uColC * pow(1.0 - facing, 4.5) * 0.1;

    gl_FragColor = vec4(col, uAlpha * uFade);
    if (gl_FragColor.a < 0.003) discard;
  }
`;

export interface PlanetsHandle {
  group: THREE.Group;
  setTime(t: number): void;
  /** 1 in the Constellation, fading to 0 as the pose leaves it. */
  setVisibleAmount(a: number): void;
  dispose(): void;
}

interface BodySpec {
  type: 0 | 1 | 2;
  pos: [number, number, number];
  radius: number;
  alpha: number;
  colA: number;
  colB: number;
  colC: number;
  /** Phase offset (radians) added to the shared, clock-driven sun azimuth. */
  phase: number;
  /** Sun elevation for this body (y component before normalization). */
  sunY: number;
}

// Palette stays in the scene's family. Bodies surround the map on ALL sides
// (orbit 180° and the sky is still inhabited), larger + farther + fainter:
// presence, not decoration. Phases are WORLD-anchored and clock-driven — the
// shared sun azimuth comes from the local time of day (one lap per 24h), so
// a morning visit and an evening visit see different crescents, and orbiting
// the map swings you around each eclipse like a real body in space.
//
// Parallax: every body sits at r≈2600–3000 (the megaplanet ~3350), all deep
// inside the r=3600 star shell but far beyond the camera's ~1k max dolly, so
// orbiting sweeps them only a few degrees against the stars — distant bodies,
// not props on a stage. Radii scale with distance (radius/|pos| held from the
// earlier close layout) so apparent size is unchanged; alphas dropped ~half
// so the near giants whisper instead of glow.
const BODIES: BodySpec[] = [
  { type: 0, pos: [2070, 632, -1909], radius: 218, alpha: 0.16, colA: 0x232a56, colB: 0x2e5763, colC: 0x8a7550, phase: 0.4, sunY: 0.3 },
  { type: 1, pos: [1762, 462, -1905], radius: 42, alpha: 0.15, colA: 0x8f8ba6, colB: 0x565370, colC: 0x9a94d8, phase: 3.3, sunY: 0.25 },
  { type: 2, pos: [-2364, -125, -1500], radius: 72, alpha: 0.13, colA: 0x35566b, colB: 0x9fc4cf, colC: 0x5a6ab0, phase: 1.9, sunY: 0.42 },
  // Behind the default camera, so a 180° orbit finds sky, not void.
  { type: 0, pos: [2112, -96, 1824], radius: 158, alpha: 0.13, colA: 0x2e2a4e, colB: 0x4a3d55, colC: 0x8a7550, phase: 5.1, sunY: 0.2 },
  { type: 2, pos: [-1872, 336, 1968], radius: 58, alpha: 0.12, colA: 0x35566b, colB: 0x9fc4cf, colC: 0x5a6ab0, phase: 2.6, sunY: 0.5 },
  { type: 1, pos: [182, 936, 2444], radius: 34, alpha: 0.13, colA: 0x8f8ba6, colB: 0x565370, colC: 0x9a94d8, phase: 4.2, sunY: 0.35 },
  // The megaplanet: farthest of all (~3350 out, just inside the star shell),
  // radius 875 — a quarter of the sky at under one-tenth opacity.
  { type: 0, pos: [575, -875, -3188], radius: 875, alpha: 0.09, colA: 0x1e2748, colB: 0x28454f, colC: 0x6f6a9a, phase: 0.9, sunY: 0.55 },
];

// One lap of the sun per real day, seeded from the visitor's local clock.
const DAY_SECONDS = 86400;

export function createPlanets(): PlanetsHandle {
  const group = new THREE.Group();
  group.name = "planets";

  const mats: THREE.ShaderMaterial[] = [];
  const geos: THREE.SphereGeometry[] = [];
  const phases: number[] = [];
  const sunYs: number[] = [];
  for (const b of BODIES) {
    const geo = new THREE.SphereGeometry(b.radius, 48, 32);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uFade: { value: 1 },
        uAlpha: { value: b.alpha },
        uType: { value: b.type },
        uColA: { value: new THREE.Color(b.colA) },
        uColB: { value: new THREE.Color(b.colB) },
        uColC: { value: new THREE.Color(b.colC) },
        uLightDir: { value: new THREE.Vector3(0, 0.3, -1) },
      },
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(b.pos[0], b.pos[1], b.pos[2]);
    mesh.renderOrder = -1.6; // after the starfield (-2), before the edges (-1)
    mesh.frustumCulled = false;
    group.add(mesh);
    mats.push(mat);
    geos.push(geo);
    phases.push(b.phase);
    sunYs.push(b.sunY);
  }

  // Seed the sun's azimuth from the visitor's local clock (runtime only — the
  // build pipeline stays Date-free) and let scene time carry it onward at
  // real-day rate. Reduced motion freezes scene time → a still, correct phase.
  const now = new Date();
  const dayFrac =
    (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / DAY_SECONDS;
  const bootAngle = dayFrac * Math.PI * 2;
  const applySun = (t: number): void => {
    const az = bootAngle + (t / DAY_SECONDS) * Math.PI * 2;
    for (let i = 0; i < mats.length; i++) {
      const a = az + phases[i];
      (mats[i].uniforms.uLightDir.value as THREE.Vector3)
        .set(Math.cos(a), sunYs[i], Math.sin(a))
        .normalize();
    }
  };
  applySun(0);

  let lastAmount = 1;
  return {
    group,
    setTime(t) {
      for (const m of mats) m.uniforms.uTime.value = t;
      applySun(t);
    },
    setVisibleAmount(a) {
      if (a === lastAmount) return;
      lastAmount = a;
      const eased = a * a; // fade out early in the morph — skies leave first
      for (const m of mats) m.uniforms.uFade.value = eased;
      group.visible = eased > 0.01;
    },
    dispose() {
      for (const m of mats) m.dispose();
      for (const geo of geos) geo.dispose();
    },
  };
}
