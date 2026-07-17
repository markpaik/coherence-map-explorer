// Distant planets — three faint procedural bodies far behind the
// constellation: a banded gas giant low on the horizon, its small cratered
// moon, and a pale ice dwarf on the far side. Atmosphere, not attraction:
// they sit well below the bloom threshold, at ~half opacity, inside the
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
  varying vec3 vNrm;
  varying vec3 vViewPos;
  void main() {
    vNrm = normalize(normalMatrix * normal);
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
    vec3 L = normalize(vec3(-0.42, 0.5, 0.72));
    float nl = dot(n, L);
    // Soft terminator: day side lit, night side falls to a deep shadow that
    // still reads (these are faint background bodies, not black discs).
    float day = smoothstep(-0.25, 0.45, nl);

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

    col *= (0.42 + 0.58 * day);       // terminator
    col *= 1.0 - 0.5 * limb;          // limb darkening
    col += uColC * pow(1.0 - facing, 3.2) * 0.35 * day; // thin atmosphere rim

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
}

// Palette stays in the scene's family: deep indigo/teal giant with a muted
// warm accent band, a gray-lavender moon, a pale teal dwarf.
const BODIES: BodySpec[] = [
  { type: 0, pos: [640, 195, -585], radius: 60, alpha: 0.5, colA: 0x232a56, colB: 0x2e5763, colC: 0x8a7550 },
  { type: 1, pos: [498, 132, -534], radius: 13, alpha: 0.46, colA: 0x8f8ba6, colB: 0x565370, colC: 0x9a94d8 },
  { type: 2, pos: [-702, -34, -438], radius: 21, alpha: 0.4, colA: 0x35566b, colB: 0x9fc4cf, colC: 0x5a6ab0 },
];

export function createPlanets(): PlanetsHandle {
  const group = new THREE.Group();
  group.name = "planets";

  const mats: THREE.ShaderMaterial[] = [];
  const geos: THREE.SphereGeometry[] = [];
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
  }

  let lastAmount = 1;
  return {
    group,
    setTime(t) {
      for (const m of mats) m.uniforms.uTime.value = t;
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
