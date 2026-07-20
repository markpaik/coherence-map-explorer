// Transit station marks — the metro-map GRAMMAR the Transit pose (pose 3) hands
// to at pose 2.6→3.0, when the galaxy node sprites cede to true stations. This
// is the in-app realisation of the acceptance preview
// (scripts/pose-grammar-previews.mjs transitFront): a standard is no longer a
// glowing orb but a STATION —
//
//   · ordinary standard  → a pale disc with a wraparound border in its strand
//                          colour (a line stop);
//   · true interchange   → a capsule enclosing one dot per line it serves (own
//                          strand + every cross-strand PREREQ neighbour strand),
//                          where "interchange" = a node touched by ≥3 cross-strand
//                          prereq edges and never a family child;
//   · family parent      → an elongated lozenge spanning the family's pos4 row,
//                          a parent dot plus a small interior tick per child. The
//                          children keep their own pickable positions (the node
//                          proxy never moves) but grow no disc of their own — their
//                          ticks live inside the parent's lozenge.
//
// Two instanced billboard meshes (beacons.ts is the pattern): FRAMES (rounded-box
// SDF — disc / capsule / lozenge share one program, parameterised per instance)
// and PIPS (filled dots — capsule line dots, lozenge parent dot + child ticks).
// Both are camera-facing, depth-tested normally, sized in world units relative to
// the node radii. They follow the live node positions through the crossfade and
// hold still at rest (pose 3 has no drift — the evolve guard). Story dimming is
// honoured: a missed / ghosted station reads near-black like a missed node,
// consuming the very same per-node emphasis / visibility / damage the nodes use.
//
// Per art style (fill / border swap in place, dots re-inked):
//   Galaxy  — pale disc fill, strand-colour border; interchange capsule dark
//             (#0a0a16) with a pale border and strand line dots; family lozenge
//             dark with a strand border.
//   Ringers — cream board grammar: every mark cream (#f0ece0), borders ink
//             (#1a1712), dots in the Ringers peg colours.
//   Fidenza — teal-field grammar: fills a field-adjacent teal, borders cream,
//             dots in the Fidenza node colours.

import * as THREE from "three";
import type { GraphCore, StrandId } from "../data";
import { STRAND_VIVID } from "./palette";
import { RINGERS, FIDENZA } from "./artstyle";
import { stationFocusFade, cityFadeTarget } from "./focusgrammar";

const STRAND_ORDER: StrandId[] = ["number", "algebra", "geometry", "data"];

// ---------------------------------------------------------------------------
// Pure classification (load time). Exported for the pipeline test — it partitions
// the 480 standards into the four mutually exclusive marks and derives each
// interchange's line set, mirroring the acceptance preview's derivation exactly.
export interface StationClassification {
  /** Ordinary standards → pale disc. */
  discs: string[];
  /** True interchanges that are NOT family parents → capsule. */
  capsules: string[];
  /** Family parents → lozenge (a parent that is also an interchange stays a lozenge). */
  lozenges: string[];
  /** Sub-standards → no own mark (a tick inside the parent lozenge). */
  children: string[];
  /** Every ≥3-cross-strand-prereq node except children (the interchange floor). */
  interchangeIds: string[];
  /** Per capsule: its sorted line strands (own strand + cross-strand neighbours). */
  capsuleLines: { id: string; lines: StrandId[] }[];
}

export function classifyStations(graph: GraphCore): StationClassification {
  const { nodes, edges } = graph;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const familyParents = new Set(nodes.filter((n) => n.children && n.children.length).map((n) => n.id));
  const childIds = new Set<string>();
  for (const n of nodes) if (n.children) for (const c of n.children) childIds.add(c);

  // Cross-strand prerequisite incidence + the set of lines each station serves.
  const xCount = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const lines = new Map<string, Set<StrandId>>(nodes.map((n) => [n.id, new Set<StrandId>([n.strand])]));
  for (const e of edges) {
    if (e.k !== 0) continue;
    const s = byId.get(e.s);
    const t = byId.get(e.t);
    if (!s || !t || s.strand === t.strand) continue;
    xCount.set(e.s, (xCount.get(e.s) ?? 0) + 1);
    xCount.set(e.t, (xCount.get(e.t) ?? 0) + 1);
    lines.get(e.s)!.add(t.strand);
    lines.get(e.t)!.add(s.strand);
  }
  const isInterchange = (id: string): boolean => (xCount.get(id) ?? 0) >= 3 && !childIds.has(id);
  const interchangeIds = nodes.filter((n) => isInterchange(n.id)).map((n) => n.id);

  const discs: string[] = [];
  const capsules: string[] = [];
  const lozenges: string[] = [];
  const children: string[] = [];
  const capsuleLines: { id: string; lines: StrandId[] }[] = [];
  const rankOf = (s: StrandId): number => STRAND_ORDER.indexOf(s);
  for (const n of nodes) {
    if (childIds.has(n.id)) {
      children.push(n.id);
    } else if (familyParents.has(n.id)) {
      lozenges.push(n.id); // a family parent always draws as a lozenge (precedence)
    } else if (isInterchange(n.id)) {
      capsules.push(n.id);
      capsuleLines.push({ id: n.id, lines: [...lines.get(n.id)!].sort((a, b) => rankOf(a) - rankOf(b)) });
    } else {
      discs.push(n.id);
    }
  }
  return { discs, capsules, lozenges, children, interchangeIds, capsuleLines };
}

// ---------------------------------------------------------------------------
// Palettes. The strand LINE palette is DESIGN.md's validated brights (dots +
// disc/lozenge borders in the Galaxy); art styles re-ink from their own peg /
// node colourways.
const LINE_HEX: Record<StrandId, number> = {
  number: 0xe8b34b,
  algebra: 0x9a7df0,
  geometry: 0x4dc8c0,
  data: 0xe87a9b,
};
const GALAXY_DISC_FILL = 0xf4f2fb; // pale disc field
const GALAXY_CAP_FILL = 0x0a0a16; // dark capsule / lozenge interior
const GALAXY_CAP_STROKE = 0xd8d4f0; // pale interchange border
const RINGERS_FILL = 0xf0ece0; // cream board
const RINGERS_STROKE = 0x1a1712; // ink
const FIDENZA_FILL = 0x4fb89f; // field-adjacent teal (a touch lighter than 0x43a08b)
const FIDENZA_STROKE = 0xe8e0cd; // cream border
const MISSED = 0x0a0a16; // near-black a missed / ghosted station fades toward (dark-baseline end of the fade target)

// 0 disc | 1 capsule | 2 lozenge
type FrameKind = 0 | 1 | 2;

export interface StationsHandle {
  group: THREE.Group;
  /**
   * Drive the crossfade + follow the live node positions. `pose` is the eased
   * pose value (0..3); the stations fade in over 2.6→3.0 and are hidden below
   * that (so poses 0–2 draw nothing). While visible, refresh every mark's centre
   * from the live node position and fold in per-node story dimming. `daylight01`
   * (0..1) is the concrete-daylight amount: the missed / focus-collapsed fade
   * target lerps from near-black #0a0a16 (dark baseline) to concrete grey #beb9b0,
   * so an unconnected station dissolves into the live city background. `envLight01`
   * (0..1) is the light-environment amount: the strand-coloured borders + line dots
   * cross-fade to the VIVID enamel palette so the metro reads as vibrant street
   * signage on the light concrete (at the Transit, envLight01 == daylight01).
   */
  update(pose: number, daylight01?: number, envLight01?: number): void;
  /** Swap fills / borders / dot inks for the active art style (0/1/2). */
  setArtStyle(style: number): void;
  dispose(): void;
}

export function createStations(
  graph: GraphCore,
  radii: Float32Array,
  nodes: {
    getPosition(index: number, out: THREE.Vector3): THREE.Vector3;
    emphasisAttr: THREE.InstancedBufferAttribute;
    visibleAttr: THREE.InstancedBufferAttribute;
    damageAttr: THREE.InstancedBufferAttribute;
  },
): StationsHandle {
  const cls = classifyStations(graph);
  const indexById = new Map<string, number>();
  graph.nodes.forEach((n, i) => indexById.set(n.id, i));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  // -- collect instance descriptors ---------------------------------------
  interface FrameDesc {
    node: number; // node index the mark rides
    kind: FrameKind;
    strand: StrandId;
    offset: [number, number]; // billboard-local shift (world) — lozenge spans right of parent
    half: [number, number]; // outer half-extents (world)
    corner: number; // corner radius (world)
    border: number; // border thickness (world)
  }
  interface PipDesc {
    node: number; // node the dot rides (interchange or parent)
    offset: [number, number]; // billboard-local offset (world)
    scale: number; // dot radius (world)
    strand: StrandId; // colour source (a line strand)
    stateNode: number; // node whose dim/ghost this dot inherits (same as node)
  }
  const frames: FrameDesc[] = [];
  const pips: PipDesc[] = [];

  const capLineOf = new Map(cls.capsuleLines.map((c) => [c.id, c.lines]));

  // Ordinary discs — pale disc, strand border, ~2.2× the node radius.
  for (const id of cls.discs) {
    const i = indexById.get(id)!;
    const baseR = radii[i];
    const discR = 2.2 * baseR;
    frames.push({
      node: i,
      kind: 0,
      strand: byId.get(id)!.strand,
      offset: [0, 0],
      half: [discR, discR],
      corner: discR,
      border: 0.45 * baseR,
    });
  }

  // Interchanges — capsule with one dot per line (sorted number→algebra→geometry→data).
  for (const id of cls.capsules) {
    const i = indexById.get(id)!;
    const baseR = radii[i];
    const lineStrands = capLineOf.get(id) ?? [byId.get(id)!.strand];
    const nLines = lineStrands.length;
    const dotR = 0.7 * baseR;
    const gap = 2.0 * baseR;
    const innerW = (nLines - 1) * gap;
    const halfW = innerW / 2 + dotR + 0.8 * baseR;
    const halfH = dotR + 0.7 * baseR;
    frames.push({
      node: i,
      kind: 1,
      strand: byId.get(id)!.strand,
      offset: [0, 0],
      half: [halfW, halfH],
      corner: halfH,
      border: 0.35 * baseR,
    });
    lineStrands.forEach((ls, k) => {
      pips.push({
        node: i,
        offset: [-innerW / 2 + k * gap, 0],
        scale: dotR,
        strand: ls,
        stateNode: i,
      });
    });
  }

  // Family parents — elongated lozenge spanning the child row; parent dot + ticks.
  for (const id of cls.lozenges) {
    const i = indexById.get(id)!;
    const parent = byId.get(id)!;
    const baseR = radii[i];
    const px = parent.pos4[0];
    const kids = (parent.children ?? []).filter((c) => byId.has(c));
    // Local x offsets (world) of the parent (0) and each child, from pos4.
    const childOffsets = kids.map((c) => byId.get(c)!.pos4[0] - px);
    const xs = [0, ...childOffsets];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const center = (minX + maxX) / 2;
    const span = maxX - minX;
    const halfH = 0.75 * baseR;
    const halfW = span / 2 + 1.1 * baseR;
    frames.push({
      node: i,
      kind: 2,
      strand: parent.strand,
      offset: [center, 0],
      half: [halfW, halfH],
      corner: halfH,
      border: 0.3 * baseR,
    });
    // Parent dot (left end) + one interior tick per child at its real local x.
    pips.push({ node: i, offset: [0, 0], scale: 0.7 * baseR, strand: parent.strand, stateNode: i });
    childOffsets.forEach((dx) => {
      pips.push({ node: i, offset: [dx, 0], scale: 0.34 * baseR, strand: parent.strand, stateNode: i });
    });
  }

  // -- frame mesh ----------------------------------------------------------
  const F = frames.length;
  const framePlane = new THREE.PlaneGeometry(1, 1);
  const frameGeo = new THREE.InstancedBufferGeometry();
  frameGeo.index = framePlane.index;
  frameGeo.setAttribute("position", framePlane.getAttribute("position"));
  const fCenter = new Float32Array(F * 3);
  const fOffset = new Float32Array(F * 2);
  const fHalf = new Float32Array(F * 2);
  const fCorner = new Float32Array(F);
  const fBorder = new Float32Array(F);
  const fFill = new Float32Array(F * 3);
  const fStroke = new Float32Array(F * 3);
  const fStrokeVivid = new Float32Array(F * 3); // VIVID stroke — light-env enamel border
  const fState = new Float32Array(F * 2).fill(1); // [colorDim, alphaMul]
  frames.forEach((d, k) => {
    fOffset[k * 2] = d.offset[0];
    fOffset[k * 2 + 1] = d.offset[1];
    fHalf[k * 2] = d.half[0] + 0.6; // + AA/border margin (see frag)
    fHalf[k * 2 + 1] = d.half[1] + 0.6;
    fCorner[k] = d.corner;
    fBorder[k] = d.border;
  });
  const fCenterAttr = new THREE.InstancedBufferAttribute(fCenter, 3);
  fCenterAttr.setUsage(THREE.DynamicDrawUsage);
  const fStateAttr = new THREE.InstancedBufferAttribute(fState, 2);
  fStateAttr.setUsage(THREE.DynamicDrawUsage);
  const fFillAttr = new THREE.InstancedBufferAttribute(fFill, 3);
  const fStrokeAttr = new THREE.InstancedBufferAttribute(fStroke, 3);
  const fStrokeVividAttr = new THREE.InstancedBufferAttribute(fStrokeVivid, 3);
  frameGeo.setAttribute("aCenter", fCenterAttr);
  frameGeo.setAttribute("aOffset", new THREE.InstancedBufferAttribute(fOffset, 2));
  frameGeo.setAttribute("aHalf", new THREE.InstancedBufferAttribute(fHalf, 2));
  frameGeo.setAttribute("aCorner", new THREE.InstancedBufferAttribute(fCorner, 1));
  frameGeo.setAttribute("aBorder", new THREE.InstancedBufferAttribute(fBorder, 1));
  frameGeo.setAttribute("aFill", fFillAttr);
  frameGeo.setAttribute("aStroke", fStrokeAttr);
  frameGeo.setAttribute("aStrokeVivid", fStrokeVividAttr);
  frameGeo.setAttribute("aState", fStateAttr);
  frameGeo.instanceCount = F;

  const frameUniforms = {
    uFade: { value: 0 },
    uMissed: { value: new THREE.Color(MISSED) },
    uEnvLight: { value: 0 }, // 0..1 → cross-fade strand border to the VIVID enamel palette
  };
  const frameMat = new THREE.ShaderMaterial({
    uniforms: frameUniforms,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 aCenter;
      attribute vec2 aOffset;
      attribute vec2 aHalf;
      attribute float aCorner;
      attribute float aBorder;
      attribute vec3 aFill;
      attribute vec3 aStroke;
      attribute vec3 aStrokeVivid;
      attribute vec2 aState;
      uniform float uEnvLight;
      varying vec2 vLocal;
      varying vec2 vHalf;
      varying float vCorner;
      varying float vBorder;
      varying vec3 vFill;
      varying vec3 vStroke;
      varying vec2 vState;
      void main() {
        // Camera-facing: build the quad in view space around the node's centre,
        // shifted by the billboard-local offset (lozenges span right of parent).
        vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
        vec2 local = position.xy * 2.0 * aHalf; // plane ±0.5 → local ∈ [-aHalf, aHalf]
        mv.xy += aOffset + local;
        gl_Position = projectionMatrix * mv;
        vLocal = local;
        vHalf = aHalf;
        vCorner = aCorner;
        vBorder = aBorder;
        vFill = aFill;
        // Light-environment enamel: cross-fade the strand border to its VIVID tone.
        vStroke = mix(aStroke, aStrokeVivid, clamp(uEnvLight, 0.0, 1.0));
        vState = aState;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uFade;
      uniform vec3 uMissed;
      varying vec2 vLocal;
      varying vec2 vHalf;
      varying float vCorner;
      varying float vBorder;
      varying vec3 vFill;
      varying vec3 vStroke;
      varying vec2 vState;
      // Signed distance to a rounded box (he = outer half-extents, r = corner):
      // <0 inside, 0 at the outer edge; a disc is the r == he special case.
      float sdRoundBox(vec2 p, vec2 he, float r) {
        vec2 q = abs(p) - (he - r);
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }
      void main() {
        float margin = 0.6;                       // matches the +0.6 half pad
        vec2 Ho = vHalf - margin;
        float r = min(vCorner, min(Ho.x, Ho.y));
        float d = sdRoundBox(vLocal, Ho, r);
        // Derivative-free AA: a soft band proportional to the mark size (ESSL 100
        // under WebGL2 would need an extension for fwidth; a size-relative band
        // reads clean at Transit's near-fixed front-on distance).
        float aa = 0.03 * min(Ho.x, Ho.y) + 1e-4;
        float outer = 1.0 - smoothstep(-aa, aa, d);
        if (outer < 0.003) discard;
        float inner = 1.0 - smoothstep(-vBorder - aa, -vBorder + aa, d);
        vec3 col = mix(vStroke, vFill, inner);     // border ring → fill interior
        col = mix(uMissed, col, vState.x);         // missed / dimmed → near-black, holds place
        float alpha = outer * uFade * vState.y;    // ghosted / crossfade drops alpha
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
  const frameMesh = new THREE.Mesh(frameGeo, frameMat);
  frameMesh.frustumCulled = false;
  frameMesh.renderOrder = 2; // over the metro lines (edges renderOrder -1)
  frameMesh.name = "stations-frames";

  // -- pip mesh ------------------------------------------------------------
  const P = pips.length;
  const pipPlane = new THREE.PlaneGeometry(1, 1);
  const pipGeo = new THREE.InstancedBufferGeometry();
  pipGeo.index = pipPlane.index;
  pipGeo.setAttribute("position", pipPlane.getAttribute("position"));
  const pCenter = new Float32Array(P * 3);
  const pOffset = new Float32Array(P * 2);
  const pScale = new Float32Array(P);
  const pColor = new Float32Array(P * 3);
  const pColorVivid = new Float32Array(P * 3); // VIVID dot — light-env enamel line colour
  const pState = new Float32Array(P * 2).fill(1);
  pips.forEach((d, k) => {
    pOffset[k * 2] = d.offset[0];
    pOffset[k * 2 + 1] = d.offset[1];
    pScale[k] = d.scale;
  });
  const pCenterAttr = new THREE.InstancedBufferAttribute(pCenter, 3);
  pCenterAttr.setUsage(THREE.DynamicDrawUsage);
  const pStateAttr = new THREE.InstancedBufferAttribute(pState, 2);
  pStateAttr.setUsage(THREE.DynamicDrawUsage);
  const pColorAttr = new THREE.InstancedBufferAttribute(pColor, 3);
  const pColorVividAttr = new THREE.InstancedBufferAttribute(pColorVivid, 3);
  pipGeo.setAttribute("aCenter", pCenterAttr);
  pipGeo.setAttribute("aOffset", new THREE.InstancedBufferAttribute(pOffset, 2));
  pipGeo.setAttribute("aScale", new THREE.InstancedBufferAttribute(pScale, 1));
  pipGeo.setAttribute("aColor", pColorAttr);
  pipGeo.setAttribute("aColorVivid", pColorVividAttr);
  pipGeo.setAttribute("aState", pStateAttr);
  pipGeo.instanceCount = P;

  const pipUniforms = {
    uFade: { value: 0 },
    uMissed: { value: new THREE.Color(MISSED) },
    uEnvLight: { value: 0 }, // 0..1 → cross-fade line dots to the VIVID enamel palette
  };
  const pipMat = new THREE.ShaderMaterial({
    uniforms: pipUniforms,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 aCenter;
      attribute vec2 aOffset;
      attribute float aScale;
      attribute vec3 aColor;
      attribute vec3 aColorVivid;
      attribute vec2 aState;
      uniform float uEnvLight;
      varying vec2 vP;
      varying vec3 vColor;
      varying vec2 vState;
      void main() {
        vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
        mv.xy += aOffset + position.xy * 2.0 * aScale;
        gl_Position = projectionMatrix * mv;
        vP = position.xy * 2.0;
        // Light-environment enamel: cross-fade the line dot to its VIVID tone.
        vColor = mix(aColor, aColorVivid, clamp(uEnvLight, 0.0, 1.0));
        vState = aState;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uFade;
      uniform vec3 uMissed;
      varying vec2 vP;
      varying vec3 vColor;
      varying vec2 vState;
      void main() {
        float r = length(vP);               // vP ∈ [-1,1]; disc edge at r == 1
        float a = 1.0 - smoothstep(0.9, 1.0, r); // derivative-free soft edge
        if (a < 0.003) discard;
        vec3 col = mix(uMissed, vColor, vState.x);
        gl_FragColor = vec4(col, a * uFade * vState.y);
      }
    `,
  });
  const pipMesh = new THREE.Mesh(pipGeo, pipMat);
  pipMesh.frustumCulled = false;
  pipMesh.renderOrder = 3; // dots over their frame
  pipMesh.name = "stations-pips";

  const group = new THREE.Group();
  group.name = "stations";
  group.visible = false;
  group.add(frameMesh, pipMesh);

  // -- art-style palette baking -------------------------------------------
  const c = new THREE.Color();
  function bakeColors(style: number): void {
    const lineHexFor = (s: StrandId): number =>
      style === 1 ? (RINGERS.peg[s] ?? RINGERS.pegWhite) : style === 2 ? (FIDENZA.node[s] ?? FIDENZA.palette[0]) : LINE_HEX[s];
    frames.forEach((d, k) => {
      let fill: number;
      let stroke: number;
      if (style === 1) {
        fill = RINGERS_FILL;
        stroke = RINGERS_STROKE;
      } else if (style === 2) {
        fill = FIDENZA_FILL;
        stroke = FIDENZA_STROKE;
      } else {
        // Galaxy: disc is a pale field with a strand border; interchange/family
        // are dark, the interchange bordered pale, the family bordered strand.
        fill = d.kind === 0 ? GALAXY_DISC_FILL : GALAXY_CAP_FILL;
        stroke = d.kind === 1 ? GALAXY_CAP_STROKE : LINE_HEX[d.strand];
      }
      c.setHex(fill);
      fFill[k * 3] = c.r;
      fFill[k * 3 + 1] = c.g;
      fFill[k * 3 + 2] = c.b;
      c.setHex(stroke);
      fStroke[k * 3] = c.r;
      fStroke[k * 3 + 1] = c.g;
      fStroke[k * 3 + 2] = c.b;
      // VIVID border for the light environments: Galaxy strand-coloured strokes
      // (disc + lozenge) switch to the vivid enamel palette; the pale interchange
      // capsule border is not a strand colour, so it (and the art skins) hold.
      const vividStroke = style === 0 && d.kind !== 1 ? STRAND_VIVID[d.strand] : stroke;
      c.setHex(vividStroke);
      fStrokeVivid[k * 3] = c.r;
      fStrokeVivid[k * 3 + 1] = c.g;
      fStrokeVivid[k * 3 + 2] = c.b;
    });
    fFillAttr.needsUpdate = true;
    fStrokeAttr.needsUpdate = true;
    fStrokeVividAttr.needsUpdate = true;
    pips.forEach((d, k) => {
      c.setHex(lineHexFor(d.strand));
      pColor[k * 3] = c.r;
      pColor[k * 3 + 1] = c.g;
      pColor[k * 3 + 2] = c.b;
      // VIVID line dots in the light environments (Galaxy only; art skins hold).
      c.setHex(style === 0 ? STRAND_VIVID[d.strand] : lineHexFor(d.strand));
      pColorVivid[k * 3] = c.r;
      pColorVivid[k * 3 + 1] = c.g;
      pColorVivid[k * 3 + 2] = c.b;
    });
    pColorAttr.needsUpdate = true;
    pColorVividAttr.needsUpdate = true;
  }
  bakeColors(0);

  // -- per-frame follow + story dimming -----------------------------------
  const emphA = nodes.emphasisAttr.array as Float32Array;
  const visA = nodes.visibleAttr.array as Float32Array;
  const dmgA = nodes.damageAttr.array as Float32Array;
  const v = new THREE.Vector3();
  const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
  const smoothstep01 = (x: number): number => {
    const t = clamp01(x);
    return t * t * (3 - 2 * t);
  };
  // Fold a node's live emphasis / visibility / damage into [colorDim, alphaMul]:
  // a dimmed-emphasis or damaged station goes near-black (holds its place), a
  // ghosted (filtered-out) one nearly vanishes — the exact story grammar nodes use.
  // Writes into a single reused scratch tuple (called F+P times per rendered frame
  // while the Transit pose is visible) — the result is consumed into the attribute
  // arrays immediately at the call site, before the next call overwrites it, so no
  // per-mark array is allocated each frame.
  const st2: [number, number] = [0, 0];
  function stateOf(i: number): [number, number] {
    const e = emphA[i];
    const emphDim = e < 1 ? clamp01(e) : 1; // EMPHASIS.DIMMED(0) → fade target, REST(1)+ → full
    const dmg = dmgA[i];
    const vis = visA[i];
    const colorDim = clamp01(emphDim * (1 - 0.85 * dmg));
    // Transit focus grammar (round 11): an UNCONNECTED station (emphasis DIMMED
    // under a focus) collapses to a faint ghost (~0.15) — its colour goes to the
    // fade target via colorDim above, its alpha drops here — so the city recedes
    // and the chain owns the frame. Connected + resting stations stay full; story
    // dimming still rides on `vis`.
    const alphaMul = (0.12 + 0.88 * clamp01(vis)) * stationFocusFade(e);
    st2[0] = colorDim;
    st2[1] = alphaMul;
    return st2;
  }

  return {
    group,
    update(pose, daylight01 = 0, envLight01 = 0) {
      const fade = smoothstep01((pose - 2.6) / 0.4);
      if (fade <= 0.001) {
        if (group.visible) group.visible = false;
        return;
      }
      group.visible = true;
      frameUniforms.uFade.value = fade;
      pipUniforms.uFade.value = fade;
      // Strand borders + line dots cross-fade to the vivid enamel palette in the
      // light environment (at the Transit, envLight01 == daylight01).
      frameUniforms.uEnvLight.value = envLight01;
      pipUniforms.uEnvLight.value = envLight01;
      // Fade target for missed / ghosted / focus-collapsed marks: the live city
      // background — near-black #0a0a16 in the dark baseline, concrete grey #beb9b0
      // at daylight (mix by daylight01). Stories force daylight01→0, so the missed
      // husk grammar is unchanged there.
      const [fr, fg, fb] = cityFadeTarget(daylight01);
      frameUniforms.uMissed.value.setRGB(fr, fg, fb); // linear (working-space) values
      pipUniforms.uMissed.value.setRGB(fr, fg, fb);
      for (let k = 0; k < F; k++) {
        const i = frames[k].node;
        nodes.getPosition(i, v);
        fCenter[k * 3] = v.x;
        fCenter[k * 3 + 1] = v.y;
        fCenter[k * 3 + 2] = v.z;
        const st = stateOf(i);
        fState[k * 2] = st[0];
        fState[k * 2 + 1] = st[1];
      }
      for (let k = 0; k < P; k++) {
        const i = pips[k].node;
        nodes.getPosition(i, v);
        pCenter[k * 3] = v.x;
        pCenter[k * 3 + 1] = v.y;
        pCenter[k * 3 + 2] = v.z;
        const st = stateOf(pips[k].stateNode);
        pState[k * 2] = st[0];
        pState[k * 2 + 1] = st[1];
      }
      fCenterAttr.needsUpdate = true;
      fStateAttr.needsUpdate = true;
      pCenterAttr.needsUpdate = true;
      pStateAttr.needsUpdate = true;
    },
    setArtStyle(style) {
      bakeColors(style);
    },
    dispose() {
      framePlane.dispose();
      pipPlane.dispose();
      frameGeo.dispose();
      pipGeo.dispose();
      frameMat.dispose();
      pipMat.dispose();
    },
  };
}
