// Distant starfield: ~1000 THREE.Points on an r≈900 sphere, 0.5–1.2px,
// colors #20204a → #3a3870, slow per-point twinkle in-shader.
//
// Parallax choice: the starfield sits static in world space. The camera
// orbits well inside the r=900 shell, so distant-vs-near parallax falls out
// of perspective for free — cheaper than re-rotating the shell against
// camera azimuth every frame, and visually indistinguishable at this radius.
// (DESIGN.md offered either; this is the cheap one.)
//
// Reduced motion: twinkle disabled via uTwinkle uniform (alpha holds steady).

import * as THREE from "three";

const STAR_COUNT = 1750;
const RADIUS = 900;
const COLOR_A = new THREE.Color(0x262552);
const COLOR_B = new THREE.Color(0x4a4788);
// A sparse population of standouts — near-white lavender, larger, still calm.
// SPARKLER_FRACTION of stars twinkle deeply (near-out dips, bright peaks);
// the rest shimmer gently as before.
const BRIGHT_FRACTION = 0.075;
const COLOR_BRIGHT = new THREE.Color(0x9a94d8);
const SPARKLER_FRACTION = 0.07;

const VERT = /* glsl */ `
  attribute float aSize;   // CSS px, 0.5–1.2
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aAmp;    // twinkle depth: ~0.4 gentle, ~0.85 sparkler
  attribute vec3 aColor;

  uniform float uPxRatio;

  varying vec3 vColor;
  varying float vPhase;
  varying float vSpeed;
  varying float vAmp;

  void main() {
    vColor = aColor;
    vPhase = aPhase;
    vSpeed = aSpeed;
    vAmp = aAmp;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(aSize * uPxRatio, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uTwinkle; // 0 under prefers-reduced-motion

  varying vec3 vColor;
  varying float vPhase;
  varying float vSpeed;
  varying float vAmp;

  void main() {
    // Round point sprite with a soft rim.
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float body = smoothstep(0.5, 0.3, d);
    // Slow twinkle: per-point phase + speed.
    float tw = mix(1.0, (1.0 - vAmp) + vAmp * (0.5 + 0.5 * sin(uTime * vSpeed + vPhase)), uTwinkle);
    gl_FragColor = vec4(vColor * tw, body * 0.9);
  }
`;

export interface StarfieldHandle {
  points: THREE.Points;
  setTime(t: number): void;
  setTwinkleEnabled(on: boolean): void;
  setPixelRatio(pr: number): void;
  dispose(): void;
}

export function createStarfield(reducedMotion: boolean): StarfieldHandle {
  const positions = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT);
  const phases = new Float32Array(STAR_COUNT);
  const speeds = new Float32Array(STAR_COUNT);
  const amps = new Float32Array(STAR_COUNT);
  const colors = new Float32Array(STAR_COUNT * 3);

  // Deterministic LCG so the sky is stable across loads.
  let seed = 1234567;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  const c = new THREE.Color();
  for (let i = 0; i < STAR_COUNT; i++) {
    // Uniform on the sphere.
    const u = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    positions[i * 3] = RADIUS * s * Math.cos(theta);
    positions[i * 3 + 1] = RADIUS * u;
    positions[i * 3 + 2] = RADIUS * s * Math.sin(theta);
    const bright = rand() < BRIGHT_FRACTION;
    const sparkler = rand() < SPARKLER_FRACTION;
    sizes[i] = bright ? 1.4 + rand() * 0.8 : 0.5 + rand() * 0.9;
    phases[i] = rand() * Math.PI * 2;
    // Sparklers twinkle deeper and a touch quicker; the rest stay calm.
    speeds[i] = sparkler ? 0.5 + rand() * 0.7 : 0.15 + rand() * 0.35; // rad/s
    amps[i] = sparkler ? 0.75 + rand() * 0.15 : 0.32 + rand() * 0.16;
    if (bright) c.copy(COLOR_BRIGHT).lerp(COLOR_B, rand() * 0.4);
    else c.copy(COLOR_A).lerp(COLOR_B, rand());
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
  geometry.setAttribute("aAmp", new THREE.BufferAttribute(amps, 1));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));

  const uniforms = {
    uTime: { value: 0 },
    uTwinkle: { value: reducedMotion ? 0 : 1 },
    uPxRatio: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.name = "starfield";
  points.renderOrder = -2; // behind everything transparent

  return {
    points,
    setTime(t) {
      uniforms.uTime.value = t;
    },
    setTwinkleEnabled(on) {
      uniforms.uTwinkle.value = on ? 1 : 0;
    },
    setPixelRatio(pr) {
      uniforms.uPxRatio.value = pr;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
