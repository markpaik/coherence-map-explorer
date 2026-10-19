// Bulguksa (style 5): a monumental Korean ink landscape of Bulguksa under
// snow, after Park Dae-sung and the Joseon ink tradition, with the map
// floating above the temple. Every part is real geometry or a sky-shell
// effect, so the picture holds from any orbit.
//
// Parts, far to near (draw order):
//   sky          a shell washed in grey ink, darkest just above the ridge line
//                (oehun), with the screen-fixed title band (shared uBandBottom)
//   inscription  a vertical line of seven characters and a vermilion seal, on
//                the sky at a fixed world azimuth
//   birds        one flight of red-crowned cranes (the Hanga schedule) and one
//                murmuration (a folded sheet of 2000 starlings)
//   massifs      four concentric walls: snow on the upper faces as reserved
//                paper, fold lines with shade washes and tide lines, jun strokes
//                where the rock shows, moss dots on the near crests
//   floor        the snow slope, a gentle dome of paper under the map
//   marks        small pines, reed tufts, and rocks along the slope's far edge
//   temple       the complex, in ink line on paper fills, every roof in snow
//   pines        two framing pines and smaller ones, needle pads under snow
//   snow         sparse large flakes drifting down through the whole world
//
// Motion: every period is several seconds or longer and nothing pulses in
// brightness. Quiet (a story or a focus) fades the birds over 2 s. Reduced
// motion freezes the snow and hides the birds. The group is invisible, with
// no draw calls, in every style but 5.

import * as THREE from "three";
import { HANGA_SCREEN_UNIFORMS } from "../environs";
import { craneScheduleInto, easeQuiet, lhash, smooth01, type CraneState, CRANE } from "../landscape";
import {
  BCRANE,
  BCRANE_SLOTS,
  BMURM,
  FLOOR,
  INK,
  INSCRIPTION,
  MASSIFS,
  PINES,
  SNOW,
  TEMPLE,
  TEMPLE_LINE,
  bcraneCount,
  bcraneDir,
  floorY,
  massifCeiling,
  murmSeed,
} from "./params";
import {
  CRANE_FRAG,
  CRANE_VERT,
  FLOOR_FRAG,
  FLOOR_VERT,
  MARK_FRAG,
  MARK_VERT,
  MASSIF_FRAG,
  MASSIF_VERT,
  MURM_FRAG,
  MURM_VERT,
  PINE_FRAG,
  PINE_VERT,
  SKY_FRAG,
  SKY_VERT,
  SNOW_FRAG,
  SNOW_VERT,
  TEMPLE_FRAG,
  TEMPLE_VERT,
} from "./shaders";
import { buildTemple } from "./temple";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { buildPines } from "./pines";

export interface BulguksaUpdateOpts {
  /** 0 normal, 1 while a story plays or a standard is focused. */
  quiet: number;
  reducedMotion: boolean;
  /** Eased Ascent amount (1 = Ascent): the world lowers a little there. */
  pose?: number;
}

export interface BulguksaHandle {
  group: THREE.Group;
  setArtStyle(style: number): void;
  update(timeSec: number, opts: BulguksaUpdateOpts): void;
  /** Debug/automation only: a fixed world clock (seconds), or null. */
  debugTime: number | null;
  /** Debug/automation only: draw-call and triangle counts of the world alone. */
  stats(): { meshes: number; triangles: number };
  dispose(): void;
}

/** The phase reduced motion holds the snow at. */
export const BULGUKSA_FROZEN_T = 300;
/** How far the world lowers at the Ascent (the map is taller there). */
export const BULGUKSA_ASCENT_DROP = 70;

const lin = (hex: number): THREE.Color => new THREE.Color().setHex(hex);

/** The inscription and seal, written once to a canvas (procedural, never an image file). */
function inscriptionTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const W = 128;
  const H = 1024;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (!ctx) return tex;
  ctx.clearRect(0, 0, W, H);
  const chars = [...INSCRIPTION.text];
  const step = 116;
  ctx.fillStyle = "#1c1a17";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '600 100px "Songti SC", "STSong", "Noto Serif CJK KR", "Noto Serif CJK SC", "Batang", "SimSun", serif';
  chars.forEach((ch, i) => ctx.fillText(ch, W / 2, 62 + i * step));
  // Dry brush: lift a little ink in fine streaks (deterministic).
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 420; i++) {
    const x = lhash(1601, i) * W;
    const y = lhash(1602, i) * (chars.length * step);
    ctx.fillStyle = `rgba(0,0,0,${0.25 + 0.5 * lhash(1603, i)})`;
    ctx.fillRect(x, y, 1 + 2 * lhash(1604, i), 6 + 22 * lhash(1605, i));
  }
  ctx.globalCompositeOperation = "source-over";
  // The seal: a small vermilion square with two characters cut in white.
  const sy = 62 + chars.length * step + 10;
  ctx.fillStyle = "#c23a2c";
  ctx.fillRect(W / 2 - 34, sy - 20, 68, 68);
  ctx.fillStyle = "#f2efe8";
  ctx.font = '700 28px "Songti SC", "STSong", "Noto Serif CJK KR", "Batang", serif';
  ctx.fillText("數", W / 2 - 14, sy - 2);
  ctx.fillText("理", W / 2 - 14, sy + 28);
  ctx.fillText("雪", W / 2 + 14, sy - 2);
  ctx.fillText("中", W / 2 + 14, sy + 28);
  tex.needsUpdate = true;
  return tex;
}

export function createBulguksa(center: THREE.Vector3): BulguksaHandle {
  const group = new THREE.Group();
  group.name = "bulguksa";
  group.position.copy(center);
  group.visible = false;

  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const objs: THREE.Object3D[] = [];
  const shader = (
    vertexShader: string,
    fragmentShader: string,
    uniforms: Record<string, THREE.IUniform>,
    side: THREE.Side,
    extra: Partial<THREE.ShaderMaterialParameters> = {},
  ): THREE.ShaderMaterial => {
    const m = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      side,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      ...extra,
    });
    mats.push(m);
    return m;
  };
  const place = <T extends THREE.Object3D>(o: T, order: number): T => {
    o.frustumCulled = false;
    o.renderOrder = order;
    group.add(o);
    objs.push(o);
    return o;
  };

  // -- sky -------------------------------------------------------------------
  const skyGeo = new THREE.SphereGeometry(5000, 64, 32);
  geos.push(skyGeo);
  const skyMat = shader(
    SKY_VERT,
    SKY_FRAG,
    {
      uPaper: { value: lin(INK.paper) },
      uOehun: { value: lin(INK.oehun) },
      uOehunDeep: { value: lin(INK.oehunDeep) },
      uSkyHigh: { value: lin(INK.skyHigh) },
      uBand: { value: lin(INK.band) },
      ...HANGA_SCREEN_UNIFORMS,
    },
    THREE.BackSide,
    { transparent: false, depthTest: false },
  );
  const sky = place(new THREE.Mesh(skyGeo, skyMat), -10);
  sky.onBeforeRender = (renderer) => {
    const target = renderer.getRenderTarget();
    if (target) HANGA_SCREEN_UNIFORMS.uViewport.value.set(target.width, target.height);
    else renderer.getDrawingBufferSize(HANGA_SCREEN_UNIFORMS.uViewport.value);
  };

  // -- inscription -------------------------------------------------------------
  const insTex = inscriptionTexture();
  if (insTex) {
    const R = INSCRIPTION.R;
    const yTop = R * Math.tan(INSCRIPTION.el0);
    const yBot = R * Math.tan(INSCRIPTION.el1);
    const h = yTop - yBot;
    const g = new THREE.PlaneGeometry(h / 8, h);
    geos.push(g);
    const m = new THREE.MeshBasicMaterial({ map: insTex, transparent: true, depthWrite: false, opacity: 0.92 });
    mats.push(m);
    const ins = place(new THREE.Mesh(g, m), -9.7);
    ins.position.set(R * Math.sin(INSCRIPTION.az), (yTop + yBot) / 2, -R * Math.cos(INSCRIPTION.az));
    ins.lookAt(0, ins.position.y, 0);
  }

  // -- massifs ---------------------------------------------------------------
  MASSIFS.forEach((m, i) => {
    const y0 = m.top - m.fadeSpan - 40;
    const y1 = massifCeiling(m) + 12;
    const geo = new THREE.CylinderGeometry(m.R, m.R, y1 - y0, 512, 1, true);
    geo.translate(0, (y0 + y1) / 2, 0);
    geos.push(geo);
    const mat = shader(
      MASSIF_VERT,
      MASSIF_FRAG,
      {
        uR: { value: m.R },
        uTop: { value: m.top },
        uAmp: { value: m.amp },
        uLat: { value: m.lattice },
        uOct: { value: m.octaves },
        uSeed: { value: m.seed },
        uFadeSpan: { value: m.fadeSpan },
        uInk: { value: m.ink },
        uPaper: { value: lin(INK.paper) },
        uShade: { value: lin(INK.shade) },
        uCrest: { value: lin(INK.crest) },
        uSumi: { value: lin(INK.sumi) },
        uRockLight: { value: lin(INK.rockLight) },
        uRockDark: { value: lin(INK.rockDark) },
      },
      THREE.BackSide,
    );
    place(new THREE.Mesh(geo, mat), -8.8 + (3 - i) * 0.4);
  });

  // -- floor -------------------------------------------------------------------
  const rings = 48;
  const segs = 256;
  const fp: number[] = [];
  const fi: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const rad = FLOOR.R * Math.pow(r / rings, 1.4);
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      fp.push(rad * Math.sin(a), floorY(rad), -rad * Math.cos(a));
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * segs + s;
      const b = r * segs + ((s + 1) % segs);
      const c = (r + 1) * segs + ((s + 1) % segs);
      const d = (r + 1) * segs + s;
      fi.push(a, c, b, a, d, c);
    }
  }
  const floorGeo = new THREE.BufferGeometry();
  floorGeo.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3));
  floorGeo.setIndex(fi);
  geos.push(floorGeo);
  const floorMat = shader(FLOOR_VERT, FLOOR_FRAG, { uPaper: { value: lin(INK.paper) }, uShade: { value: lin(INK.shade) } }, THREE.DoubleSide);
  place(new THREE.Mesh(floorGeo, floorMat), -7.4);

  // -- ink marks along the far edge of the slope -----------------------------------
  const markBase = new THREE.PlaneGeometry(1, 1);
  const markGeo = new THREE.InstancedBufferGeometry();
  markGeo.index = markBase.index;
  markGeo.setAttribute("position", markBase.getAttribute("position"));
  const NM = 150;
  const mk = new Float32Array(NM * 4);
  const my = new Float32Array(NM);
  for (let i = 0; i < NM; i++) {
    const a = lhash(1401, i) * Math.PI * 2;
    const r = 1250 + 420 * Math.sqrt(lhash(1402, i));
    const x = r * Math.sin(a);
    const z = -r * Math.cos(a);
    mk.set([x, z, 22 + 46 * lhash(1403, i), lhash(1404, i)], i * 4);
    my[i] = floorY(r) - 2;
  }
  markGeo.setAttribute("aMark", new THREE.InstancedBufferAttribute(mk, 4));
  markGeo.setAttribute("aY", new THREE.InstancedBufferAttribute(my, 1));
  markGeo.instanceCount = NM;
  geos.push(markBase, markGeo);
  const markMat = shader(
    MARK_VERT,
    MARK_FRAG,
    { uSumi: { value: lin(INK.sumi) }, uPaper: { value: lin(INK.paper) }, uOpacity: { value: 0.72 } },
    THREE.DoubleSide,
  );
  place(new THREE.Mesh(markGeo, markMat), -7.2);

  // -- temple -------------------------------------------------------------------
  const temple = buildTemple();
  geos.push(temple.fill, temple.hair);
  const templeGroup = new THREE.Group();
  templeGroup.position.set(0, TEMPLE.y, TEMPLE.z);
  templeGroup.scale.set(TEMPLE.scale, TEMPLE.scale * TEMPLE.yScale, TEMPLE.scale * TEMPLE.zScale);
  group.add(templeGroup);
  // Paper fills with a mottled wet-ink wash on the walls, soffits, and boulders.
  const fillMat = shader(TEMPLE_VERT, TEMPLE_FRAG, {}, THREE.FrontSide, {
    transparent: false,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  // Ink line in three weights. The heavy and medium lines are measured in
  // world units, so the near edges print heavier than the far ones.
  const lineMats: LineMaterial[] = [];
  const weighted = (pos: Float32Array, width: number, opacity: number): LineSegments2 => {
    const g = new LineSegmentsGeometry();
    g.setPositions(pos);
    geos.push(g as unknown as THREE.BufferGeometry);
    const m = new LineMaterial({ color: INK.sumi, linewidth: width, worldUnits: true, transparent: true, opacity, depthWrite: false });
    lineMats.push(m);
    mats.push(m);
    return new LineSegments2(g, m);
  };
  const heavyLines = weighted(temple.heavy, TEMPLE_LINE.heavy, 0.92);
  const mediumLines = weighted(temple.medium, TEMPLE_LINE.medium, 0.8);
  const hairMat = new THREE.LineBasicMaterial({ color: lin(INK.sumi), transparent: true, opacity: TEMPLE_LINE.hairOpacity, depthWrite: false });
  mats.push(hairMat);
  const hairLines = new THREE.LineSegments(temple.hair, hairMat);
  const templeFill = new THREE.Mesh(temple.fill, fillMat);
  for (const o of [templeFill, hairLines, mediumLines, heavyLines]) {
    o.frustumCulled = false;
    templeGroup.add(o);
    objs.push(o);
  }
  templeFill.renderOrder = -6;
  hairLines.renderOrder = -5.95;
  mediumLines.renderOrder = -5.92;
  heavyLines.renderOrder = -5.9;
  const resScratch = new THREE.Vector2();
  heavyLines.onBeforeRender = (renderer) => {
    const t = renderer.getRenderTarget();
    if (t) resScratch.set(t.width, t.height);
    else renderer.getDrawingBufferSize(resScratch);
    for (const m of lineMats) m.resolution.copy(resScratch);
  };

  // -- pines ---------------------------------------------------------------------
  const pines = buildPines();
  geos.push(pines.fill, pines.lines);
  const pineFwd = { value: new THREE.Vector3(0, 0, -1) };
  // Pine fill: written as "color" (pines.ts) and read under PINE_FILL.
  const pineFillMat = shader(PINE_VERT, PINE_FRAG, { uFwd: pineFwd, uColor: { value: lin(INK.sumi) }, uOpacity: { value: 1 } }, THREE.FrontSide, {
    defines: { PINE_FILL: 1 },
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const pineLineMat = shader(PINE_VERT, PINE_FRAG, { uFwd: pineFwd, uColor: { value: lin(INK.sumi) }, uOpacity: { value: 0.55 } }, THREE.FrontSide);
  const pineFill = place(new THREE.Mesh(pines.fill, pineFillMat), -5.8);
  place(new THREE.LineSegments(pines.lines, pineLineMat), -5.7);
  pineFill.onBeforeRender = (_r, _s, camera) => {
    camera.getWorldDirection(pineFwd.value);
  };
  void PINES;

  // -- cranes ----------------------------------------------------------------------
  const craneBase = new THREE.PlaneGeometry(2, 2);
  const craneGeo = new THREE.InstancedBufferGeometry();
  craneGeo.index = craneBase.index;
  craneGeo.setAttribute("position", craneBase.getAttribute("position"));
  const slots = new Float32Array(BCRANE.maxCount * 4);
  BCRANE_SLOTS.forEach(([lag, rise, phase], i) => slots.set([lag, rise, phase, i], i * 4));
  craneGeo.setAttribute("aSlot", new THREE.InstancedBufferAttribute(slots, 4));
  craneGeo.instanceCount = BCRANE.maxCount;
  geos.push(craneBase, craneGeo);
  const craneMat = shader(
    CRANE_VERT,
    CRANE_FRAG,
    {
      uProg: { value: -1 },
      uAz0: { value: BCRANE.az0 },
      uAz1: { value: BCRANE.az1 },
      uR: { value: BCRANE.R },
      uEl: { value: BCRANE.el },
      uCount: { value: 5 },
      uTime: { value: 0 },
      uAlpha: { value: 0 },
      uSize: { value: BCRANE.size },
      uInk: { value: lin(INK.sumi) },
      uWhite: { value: lin(0xfbfaf6) },
      uRed: { value: lin(INK.craneRed) },
      uLine: { value: lin(0x6b665e) },
    },
    THREE.DoubleSide,
  );
  const cranes = place(new THREE.Mesh(craneGeo, craneMat), -9.5);
  cranes.visible = false;

  // -- murmuration -------------------------------------------------------------------
  const murmGeo = new THREE.BufferGeometry();
  const mpos = new Float32Array(BMURM.count * 3);
  const mseed = new Float32Array(BMURM.count * 4);
  for (let i = 0; i < BMURM.count; i++) mseed.set(murmSeed(i), i * 4);
  murmGeo.setAttribute("position", new THREE.BufferAttribute(mpos, 3));
  murmGeo.setAttribute("aSeed", new THREE.BufferAttribute(mseed, 4));
  geos.push(murmGeo);
  const murmMat = shader(MURM_VERT, MURM_FRAG, { uTime: { value: 0 }, uAlpha: { value: 0 }, uPx: { value: 1 }, uInk: { value: lin(INK.bird) } }, THREE.FrontSide);
  const murm = place(new THREE.Points(murmGeo, murmMat), -9.5);
  murm.visible = false;
  murm.onBeforeRender = (renderer) => {
    murmMat.uniforms.uPx.value = renderer.getPixelRatio();
  };

  // -- falling snow --------------------------------------------------------------------
  const snowGeo = new THREE.BufferGeometry();
  const spos = new Float32Array(SNOW.count * 3);
  const sseed = new Float32Array(SNOW.count * 4);
  for (let i = 0; i < SNOW.count; i++) {
    sseed.set([lhash(1201, i), lhash(1202, i), lhash(1203, i), lhash(1204, i)], i * 4);
  }
  snowGeo.setAttribute("position", new THREE.BufferAttribute(spos, 3));
  snowGeo.setAttribute("aSeed", new THREE.BufferAttribute(sseed, 4));
  geos.push(snowGeo);
  const snowMat = shader(
    SNOW_VERT,
    SNOW_FRAG,
    {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uPx: { value: 1 },
      uPaper: { value: lin(0xfcfbf8) },
      uRim: { value: lin(0x8f897f) },
      uOpacity: { value: 0.9 },
    },
    THREE.FrontSide,
  );
  const snow = place(new THREE.Points(snowGeo, snowMat), 6);
  const camScratch = new THREE.Vector3();
  const fwdScratch = new THREE.Vector3();
  snow.onBeforeRender = (renderer, _s, camera) => {
    snowMat.uniforms.uPx.value = renderer.getPixelRatio();
    // The box rides the point 900 units ahead of the camera (about the orbit target).
    camera.getWorldPosition(camScratch);
    camera.getWorldDirection(fwdScratch);
    camScratch.addScaledVector(fwdScratch, 900);
    group.worldToLocal(camScratch);
    (snowMat.uniforms.uCenter.value as THREE.Vector3).copy(camScratch);
  };

  // -- state -----------------------------------------------------------------------
  let quiet = 0;
  let lastNow = 0;
  const sched: CraneState = { index: 0, start: CRANE.first, progress: -1, visible: false };
  let pathIndex = -1;

  const handle: BulguksaHandle = {
    group,
    debugTime: null,
    setArtStyle(style) {
      group.visible = style === 5;
    },
    update(timeSec, opts) {
      if (!group.visible) return;
      const now = typeof performance !== "undefined" ? performance.now() : 0;
      const dt = lastNow === 0 ? 1 / 60 : Math.min(Math.max(now - lastNow, 0) / 1000, 0.5);
      lastNow = now;
      quiet = easeQuiet(quiet, opts.quiet > 0.5 ? 1 : 0, dt);
      const rm = opts.reducedMotion;
      const fixed = handle.debugTime;
      const t = fixed ?? timeSec;
      // Snow: a fixed phase under reduced motion (a still snowfall).
      snowMat.uniforms.uTime.value = fixed ?? (rm ? BULGUKSA_FROZEN_T : timeSec);
      const pose = Math.min(1, Math.max(0, opts.pose ?? 0));
      group.position.y = center.y - BULGUKSA_ASCENT_DROP * pose;
      // Birds: hidden under reduced motion (a debug clock shows them for stills),
      // faded out by quiet.
      const birdA = rm && fixed === null ? 0 : 1 - smooth01(quiet);
      craneScheduleInto(t, sched, sched);
      const showC = birdA > 0.002 && sched.visible;
      cranes.visible = showC;
      if (showC) {
        if (sched.index !== pathIndex) {
          pathIndex = sched.index;
          const k = sched.index;
          const dir = bcraneDir(k);
          const u = craneMat.uniforms;
          u.uAz0.value = dir > 0 ? BCRANE.az0 : BCRANE.az1;
          u.uAz1.value = dir > 0 ? BCRANE.az1 : BCRANE.az0;
          u.uR.value = BCRANE.R + lhash(1922, k) * BCRANE.RSpan;
          u.uEl.value = BCRANE.el + (lhash(1923, k) - 0.5) * 2 * BCRANE.elSpan;
          u.uCount.value = bcraneCount(k);
        }
        craneMat.uniforms.uProg.value = sched.progress;
        craneMat.uniforms.uTime.value = t;
        craneMat.uniforms.uAlpha.value = birdA;
      }
      murm.visible = birdA > 0.002;
      murmMat.uniforms.uTime.value = t;
      murmMat.uniforms.uAlpha.value = birdA * 0.85;
    },
    stats() {
      let meshes = 0;
      let triangles = 0;
      group.traverse((o) => {
        if (!o.visible) return;
        const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (!g) return;
        meshes++;
        const n = g.index ? g.index.count : g.getAttribute("position").count;
        const inst = (g as THREE.InstancedBufferGeometry).instanceCount ?? 1;
        if ((o as THREE.Mesh).isMesh) triangles += (n / 3) * (Number.isFinite(inst) ? inst : 1);
      });
      return { meshes, triangles: Math.round(triangles) };
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      insTex?.dispose();
    },
  };
  return handle;
}
