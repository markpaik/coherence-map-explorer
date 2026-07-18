// All 480 standards as ONE InstancedMesh (low-poly icosphere), plus an
// invisible raycast-proxy InstancedMesh used only for picking.
//
// Per-instance state:
//   instanceColor — base strand color (never changes)
//   aEmphasis     — 0 dimmed | 1 rest | 2 hover | 3 focus | 4 chain | 5 related
//   aPhase        — shimmer phase, seeded from instance index
//
// The MeshBasicMaterial is patched via onBeforeCompile: emphasis drives an HDR
// color multiplier + per-instance scale (DESIGN.md node-states table), with a
// ~6s ×1.05–1.15 brightness shimmer from a uTime uniform. Fractional emphasis
// values blend piecewise-linearly between adjacent states, which is what lets
// the state machine ease hover in/out over ~150ms on the CPU side.

import * as THREE from "three";
import type { GraphNode } from "../data";
import { EMPHASIS, STRAND_COLORS, STRAND_VIVID, restRadius } from "./palette";
import { RINGERS, FIDENZA, artHash } from "./artstyle";

const DIM_TARGET = 0x0a0a18; // dimmed nodes lerp toward this (factor 0.82)
const PROXY_RADIUS_FACTOR = 2.5; // pick radius vs. visual radius
const TOUCH_EXTRA_FACTOR = 2.0; // additional proxy scale for touch pointers (fleet: taps still felt smaller than the dots look)

// Per-state tables, indexed by EMPHASIS value: [colorMul, scale, dimMix]
// dimMix is the lerp factor toward DIM_TARGET (0.82 when fully dimmed).
const STATE_TABLE = [
  /* dimmed  */ { mul: 1.0, scale: 0.8, dim: 0.82 },
  /* rest    */ { mul: 1.0, scale: 1.0, dim: 0.0 },
  /* hover   */ { mul: 1.6, scale: 1.25, dim: 0.0 },
  /* focus   */ { mul: 2.6, scale: 1.5, dim: 0.0 },
  /* chain   */ { mul: 1.9, scale: 1.15, dim: 0.0 },
  /* related */ { mul: 1.25, scale: 1.0, dim: 0.0 },
];

const glslTable = (key: "mul" | "scale" | "dim"): string =>
  STATE_TABLE.map((s) => s[key].toFixed(4)).join(", ");

// ---------------------------------------------------------------------------
// Art-style node materials (Ringers pegs / outline, Fidenza pipes).
//
// All three share the galaxy's MeshBasicMaterial + onBeforeCompile skeleton but
// swap the shading model for Mark's paper grammar:
//   - FLAT fill (no limb darkening, no key light, no shimmer, no HDR multiply).
//   - Base color from a per-instance art attribute (aArtRing / aArtFid) or a
//     flat uniform (the outline ink), IGNORING instanceColor.
//   - Dimness is OPACITY, never brightness. The emphasis SCALE table still
//     drives size (so hover/focus/chain read exactly as in the galaxy), but
//     ghosted / dimmed / damaged instances lose alpha and (on damage) fade
//     toward the field color. Emphasis brightening is gone — there is no bloom
//     on paper.
// The shared alpha law:
//   alpha = (1 − 0.92·(1−aVisible)) · (1 − 0.7·dimT) · (1 − 0.55·damage)
// where dimT is the emphasis-only dim from the galaxy dim table.
interface ArtNodeMatOpts {
  /** Flat fill color: a per-instance vec3 attribute, or a flat ink uniform. */
  colorSource: { kind: "attr"; name: string } | { kind: "uniform" };
  /** Field color the damage-fade lerps toward (auto sRGB→linear). */
  uField: { value: THREE.Color };
  /** Flat color uniform (outline ink) — required when colorSource is uniform. */
  uColor?: { value: THREE.Color };
  /**
   * Fidenza PIPE mode (round 7): tilt the z-aligned cylinder off-axis by aTwist
   * (rotate the vertex about x by aTwist, about y by aTwist*0.7 — a z-spin of a
   * z-aligned cylinder is invisible) and add a subtle cylindrical rounding cue
   * in the fragment so the pipe reads round. Off for the flat Ringers pegs.
   */
  pipe: boolean;
  /** Distinct program cache key so patched programs never collide. */
  cacheKey: string;
  /**
   * Pose-3 station handoff (0 normal … 1 fully stationed). At Transit the galaxy
   * node sprites cede to the station marks (scene/stations.ts): the peg shrinks
   * to nothing as the station fades in. Shared across skins so the crossfade
   * reads the same in every art style; gated at 0 so poses 0–2 are unchanged.
   */
  uPoseFade: THREE.IUniform<number>;
}

function patchArtNodeMaterial(material: THREE.MeshBasicMaterial, opts: ArtNodeMatOpts): void {
  const colorAttrDecl =
    opts.colorSource.kind === "attr" ? `attribute vec3 ${opts.colorSource.name};` : "";
  const colorUniformDecl = opts.colorSource.kind === "uniform" ? "uniform vec3 uArtColor;" : "";
  const colorAssign =
    opts.colorSource.kind === "attr" ? `vArtColor = ${opts.colorSource.name};` : "vArtColor = uArtColor;";
  const twistDecl = opts.pipe ? "attribute float aTwist;" : "";
  // PIPE tilt (round 7): the Fidenza node is a z-aligned cylinder. A z-rotation
  // would be invisible, so aTwist becomes a small off-axis TILT — rotate the
  // vertex about x by aTwist and about y by aTwist*0.7 — scattering the pipes
  // organically. The normal rides the same rotation so the cylindrical rounding
  // term in the fragment tracks the tilted silhouette.
  const twistApply = opts.pipe
    ? /* glsl */ `{
          float ax = aTwist;
          float ay = aTwist * 0.7;
          float cx = cos(ax); float sx = sin(ax);
          float cy = cos(ay); float sy = sin(ay);
          vec3 pp = transformed;
          pp = vec3(pp.x, cx * pp.y - sx * pp.z, sx * pp.y + cx * pp.z); // Rx
          pp = vec3(cy * pp.x + sy * pp.z, pp.y, -sy * pp.x + cy * pp.z); // Ry
          transformed = pp;
          vec3 nn = normal;
          nn = vec3(nn.x, cx * nn.y - sx * nn.z, sx * nn.y + cx * nn.z);
          nn = vec3(cy * nn.x + sy * nn.z, nn.y, -sy * nn.x + cy * nn.z);
          vPipeNrm = normalize(normalMatrix * nn);
          vec4 pipeMv = modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
          vPipeView = -pipeMv.xyz;
        }`
    : "";
  const pipeVarying = opts.pipe ? "varying vec3 vPipeNrm; varying vec3 vPipeView;" : "";

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uField = opts.uField;
    shader.uniforms.uPoseFade = opts.uPoseFade;
    if (opts.uColor) shader.uniforms.uArtColor = opts.uColor;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        attribute float aEmphasis;
        attribute float aVisible;
        attribute float aDamage;
        uniform float uPoseFade;
        ${colorAttrDecl}
        ${colorUniformDecl}
        ${twistDecl}
        varying vec3 vArtColor;
        varying float vVisible;
        varying float vDimE;
        varying float vDamage;
        ${pipeVarying}
        `,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        {
          // Emphasis SCALE — the exact galaxy size table (hover/focus/chain read
          // identically). Dimness is opacity, so the galaxy's aVisible SHRINK is
          // dropped: ghosted pegs stay full-size and simply go near-transparent.
          float sclTab[6] = float[](${glslTable("scale")});
          float dimTab[6] = float[](${glslTable("dim")});
          float e = clamp(aEmphasis, 0.0, 5.0);
          int i0 = int(floor(e));
          int i1 = int(min(floor(e) + 1.0, 5.0));
          float f = fract(e);
          float scl = mix(sclTab[i0], sclTab[i1], f);
          // Transit station handoff: collapse the peg to nothing as the station
          // mark takes over (uPoseFade 0→1). At 0 this is a no-op (× 1.0).
          scl *= mix(1.0, 0.001, uPoseFade);
          vDimE = mix(dimTab[i0], dimTab[i1], f);
          vVisible = aVisible;
          vDamage = clamp(aDamage, 0.0, 1.0);
          ${colorAssign}
          transformed *= scl;
          ${twistApply}
        }
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform vec3 uField;
        varying vec3 vArtColor;
        varying float vVisible;
        varying float vDimE;
        varying float vDamage;
        ${pipeVarying}
        `,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `
        #include <color_fragment>
        // Flat fill — overwrite whatever instanceColor produced with the art
        // color, fading toward the field as damage rises (dissolve into paper).
        vec3 col = mix(vArtColor, uField, clamp(vDamage, 0.0, 1.0));
        diffuseColor.rgb = col;
        ${
          opts.pipe
            ? /* glsl */ `
        // Cylindrical rounding cue (round 7) — NOT a lighting model: darken
        // toward the silhouette so the pipe reads round, never lit. Facing
        // ratio only (bright where the normal faces the camera), capped at 15%
        // so the flat paper fill and palette hue stay dominant.
        {
          vec3 pn = normalize(vPipeNrm);
          vec3 pv = normalize(vPipeView);
          float facing = abs(dot(pn, pv));
          diffuseColor.rgb *= (1.0 - 0.15 * (1.0 - facing));
        }`
            : ""
        }
        // Opacity-only dimness: ghosted (aVisible→0), emphasis-dimmed, and
        // damaged instances lose alpha; nothing ever brightens.
        float artAlpha = (1.0 - 0.92 * (1.0 - vVisible)) * (1.0 - 0.7 * vDimE) * (1.0 - 0.55 * vDamage);
        diffuseColor.a *= artAlpha;
        `,
      );
  };
  // Distinct cache key so this patched program never collides with the galaxy
  // orb program or the other art materials.
  material.customProgramCacheKey = () => opts.cacheKey;
}

export interface NodesHandle {
  /** The single visible instanced mesh (1 draw call). */
  mesh: THREE.InstancedMesh;
  /** Invisible picking proxy — never rendered; raycast against it directly. */
  proxy: THREE.InstancedMesh;
  count: number;
  /** Target emphasis attribute; write via the state machine only. */
  emphasisAttr: THREE.InstancedBufferAttribute;
  /** Filter-visibility attribute (1 shown / 0 ghosted); write via filters only. */
  visibleAttr: THREE.InstancedBufferAttribute;
  /** Per-node structural damage 0..1 (stories); write via setDamage only. */
  damageAttr: THREE.InstancedBufferAttribute;
  /** True unless this instance is filtered out (picking consults this). */
  isVisible(index: number): boolean;
  /**
   * Set per-node damage (0..1). null clears every node to 0 in one memset.
   * Damage composes AFTER emphasis in the shader (a chain-lit but damaged node
   * keeps its emphasis SIZE and takes the damage COLOR), and stays sub-1.0 HDR
   * so the ember/flicker never blooms — bloom is reserved for healthy emphasis.
   */
  setDamage(values: Float32Array | null): void;
  /**
   * Story-only visibility override: ghost every node NOT in the mask (fractional
   * values allowed, so callers can crossfade). null restores full visibility.
   * Bypasses the filters UI entirely; the filters recompute reclaims the buffer
   * on story exit.
   */
  setVisibleMask(mask: Float32Array | null): void;
  /**
   * Overwrite instance i's world position (keeps its base radius). Updates
   * BOTH the visible mesh and the pick proxy instance matrices in place — the
   * pose driver drives this every morph frame, which is why raycast picking
   * keeps landing on the moving dots. Batched: flip commitPositions() once per
   * frame after a run of setInstancePosition calls.
   */
  setInstancePosition(index: number, x: number, y: number, z: number): void;
  /**
   * Flag both instance-matrix buffers dirty. Cheap enough for every morph
   * frame — the proxy pick bounds are NOT refreshed here (that walk over all
   * instances is the expensive part and mid-morph picking doesn't matter);
   * call refreshPickBounds() once when a morph lands.
   */
  commitPositions(): void;
  /** Recompute the pick proxy's bounding sphere (call when a morph settles). */
  refreshPickBounds(): void;
  /** Read instance i's current world position (for pose-correct camera framing). */
  getPosition(index: number, out: THREE.Vector3): THREE.Vector3;
  /** Advance the shimmer clock (seconds). */
  setTime(t: number): void;
  /** Toggle the idle brightness shimmer (off under reduced motion). */
  setShimmerEnabled(on: boolean): void;
  /** Story-mode luminance lift for undamaged nodes (1 = off; ~1.9 = shine). */
  setStoryLift(mul: number): void;
  /**
   * Per-pose orb handoff (0 normal … 1 fully collapsed). Shrinks the node
   * sprites to nothing while a drafted / stationed grammar owns the pose — the
   * caller passes the UNION of both handoff windows: the drafted rings
   * (scene/drafts.ts) over pose 1.6→2.0→2.4 and the Transit stations
   * (scene/stations.ts) over pose 2.6→3.0. Applies in every art skin. 0 leaves
   * poses 0/1 (and the 2.4→2.6 gap between the two windows) untouched.
   */
  setOrbFade(amount: number): void;
  /**
   * Ascent-dawn boldness (0 normal … 1 full dawn). Orb (Galaxy) material only:
   * grows each bead ×1.15 and pulls its fill toward the deep vivid strand hue so it
   * reads against the bright morning sky instead of washing out. 0 everywhere but
   * the settled Ascent dawn; the paper skins never see it.
   */
  setDawnBold(amount: number): void;
  /** Grow the proxy pick radius for touch pointers (idempotent). */
  setTouchPicking(on: boolean): void;
  /**
   * Swap the render skin: 0 Galaxy (orbs, exactly the shipped look) |
   * 1 Ringers (bold-outlined pegs on cream) | 2 Fidenza (palette pipes on
   * teal). Geometry/material swap only — instanced attributes, positions,
   * picking, and every driver keep working identically across styles.
   */
  setArtStyle(style: number): void;
  /** Bounding sphere of the whole node cloud (for camera framing). */
  boundsSphere: THREE.Sphere;
  /** Axis-aligned bounds of the cloud (tighter framing than the sphere). */
  boundsBox: THREE.Box3;
  dispose(): void;
}

// `radii` is the per-node visual rest radius (scene/reach.ts: restRadius by
// degree, scaled by descendant reach — the load-bearing gradient). Every
// radius consumer (visible matrix, pick proxy) reads from it.
export function createNodes(nodes: GraphNode[], radii: Float32Array): NodesHandle {
  const count = nodes.length;

  // -- visible mesh -----------------------------------------------------
  // Detail 2 (320 tris): the limb-darkening shading below exposes the
  // silhouette, so detail 1's faceting would read as polygons, not orbs.
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });

  const emphasis = new Float32Array(count).fill(EMPHASIS.REST);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // Deterministic per-instance phase seeded from index (golden-angle scatter).
    phase[i] = (i * 2.399963) % (Math.PI * 2);
  }
  // Filter visibility: 1 = shown, 0 = filtered out (ghosted, not hit-tested).
  const visible = new Float32Array(count).fill(1);
  // Structural damage 0..1 (stories); 0 = untouched, 1 = ember husk.
  const damage = new Float32Array(count); // all 0 at rest
  const emphasisAttr = new THREE.InstancedBufferAttribute(emphasis, 1);
  emphasisAttr.setUsage(THREE.DynamicDrawUsage);
  const phaseAttr = new THREE.InstancedBufferAttribute(phase, 1);
  const visibleAttr = new THREE.InstancedBufferAttribute(visible, 1);
  visibleAttr.setUsage(THREE.DynamicDrawUsage);
  const damageAttr = new THREE.InstancedBufferAttribute(damage, 1);
  damageAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aEmphasis", emphasisAttr);
  geometry.setAttribute("aPhase", phaseAttr);
  geometry.setAttribute("aVisible", visibleAttr);
  geometry.setAttribute("aDamage", damageAttr);

  // -- art-style per-instance attributes (baked once) ----------------------
  // aArtRing — Ringers peg fill by strand (near-white for edgeless standards);
  // aArtFid — Fidenza pipe fill by strand; aTwist — Fidenza per-pipe off-axis tilt.
  // Colors are baked via THREE.Color.r/g/b, i.e. LINEAR (the pipeline's own
  // convention for instanceColor + edge colors), so the shaders never need an
  // sRGB→linear step and no hand-written hex ever reaches the GLSL.
  const artRing = new Float32Array(count * 3);
  const artFid = new Float32Array(count * 3);
  const twist = new Float32Array(count);
  // VIVID strand hue per node (LINEAR), the deep street tone the Ascent-dawn
  // boldness pulls each orb toward so it reads against the bright morning sky.
  // Galaxy-only (attached to the orb geometry, not the shared art skins).
  const vivid = new Float32Array(count * 3);
  const bakeC = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const nd = nodes[i];
    bakeC.setHex(nd.deg === 0 ? RINGERS.pegWhite : (RINGERS.peg[nd.strand] ?? RINGERS.pegWhite));
    artRing[i * 3] = bakeC.r;
    artRing[i * 3 + 1] = bakeC.g;
    artRing[i * 3 + 2] = bakeC.b;
    bakeC.setHex(FIDENZA.node[nd.strand] ?? FIDENZA.palette[0]);
    artFid[i * 3] = bakeC.r;
    artFid[i * 3 + 1] = bakeC.g;
    artFid[i * 3 + 2] = bakeC.b;
    bakeC.setHex(STRAND_VIVID[nd.strand]);
    vivid[i * 3] = bakeC.r;
    vivid[i * 3 + 1] = bakeC.g;
    vivid[i * 3 + 2] = bakeC.b;
    twist[i] = (artHash(nd.id) - 0.5) * 0.6;
  }
  const artRingAttr = new THREE.InstancedBufferAttribute(artRing, 3);
  const artFidAttr = new THREE.InstancedBufferAttribute(artFid, 3);
  const twistAttr = new THREE.InstancedBufferAttribute(twist, 1);
  const vividAttr = new THREE.InstancedBufferAttribute(vivid, 3);
  geometry.setAttribute("aArtRing", artRingAttr);
  geometry.setAttribute("aArtFid", artFidAttr);
  geometry.setAttribute("aTwist", twistAttr);
  geometry.setAttribute("aVivid", vividAttr); // orb geometry only (dawn boldness)

  const uniforms = {
    uTime: { value: 0 },
    uDimColor: { value: new THREE.Color(DIM_TARGET) },
    // 1 = idle shimmer on; 0 forces the multiplier to exactly 1.0 (no glow) so
    // reduced-motion is truly still, not just frozen at a random shimmer phase.
    uShimmer: { value: 1 },
    // Story lift: during story playback, UNDAMAGED nodes brighten toward this
    // multiplier (the brighter strand tones cross the bloom threshold and halo
    // softly) so "every light here is something learned" is literal. Damage
    // attenuates the lift to nothing, widening the narrative contrast between
    // shining and struggling. 1.0 = off.
    uStoryLift: { value: 1 },
    // Transit station handoff (0 normal … 1 fully stationed). Shared with the
    // art-node materials so every skin crossfades pegs → station marks the same.
    uPoseFade: { value: 0 },
    // Ascent-dawn boldness (0 normal … 1 full dawn). Orb material only: opaque,
    // ×1.15, pulled toward the deep VIVID strand hue so the bead reads against the
    // bright morning sky. 0 everywhere but the settled Ascent dawn (Galaxy).
    uDawnBold: { value: 0 },
  };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uDimColor = uniforms.uDimColor;
    shader.uniforms.uShimmer = uniforms.uShimmer;
    shader.uniforms.uStoryLift = uniforms.uStoryLift;
    shader.uniforms.uPoseFade = uniforms.uPoseFade;
    shader.uniforms.uDawnBold = uniforms.uDawnBold;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        attribute float aEmphasis;
        attribute float aPhase;
        attribute float aVisible;
        attribute float aDamage;
        attribute vec3 aVivid;
        uniform float uTime;
        uniform float uShimmer;
        uniform float uPoseFade;
        uniform float uDawnBold;
        varying float vColorMul;
        varying float vShim;
        varying float vDim;
        varying float vDamage;
        varying float vPhase;
        varying vec3 vNrm;
        varying vec3 vViewPos;
        varying vec3 vVivid;
        `,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        {
          float mulTab[6] = float[](${glslTable("mul")});
          float sclTab[6] = float[](${glslTable("scale")});
          float dimTab[6] = float[](${glslTable("dim")});
          float e = clamp(aEmphasis, 0.0, 5.0);
          int i0 = int(floor(e));
          int i1 = int(min(floor(e) + 1.0, 5.0));
          float f = fract(e);
          float mul = mix(mulTab[i0], mulTab[i1], f);
          float scl = mix(sclTab[i0], sclTab[i1], f);
          float dim = mix(dimTab[i0], dimTab[i1], f);
          // Idle shimmer: ×1.06–1.22, ~6s period, per-instance phase.
          // Peaks graze the bloom threshold so the constellation breathes.
          // uShimmer=0 (reduced motion) collapses it to exactly 1.0 → no glow.
          float shimmer = mix(1.0, 1.14 + 0.08 * sin(uTime * ${((Math.PI * 2) / 6).toFixed(6)} + aPhase), uShimmer);
          vColorMul = mul * shimmer;
          vShim = shimmer; // story lift re-applies the breath on top of its own floor
          // Filtered-out instances shrink to a faint background speck (ghost) and
          // read as dimmed — opaque, so the depth pass and edge occlusion hold.
          scl *= mix(0.14, 1.0, aVisible);
          // Transit station handoff: collapse the orb to nothing as the station
          // mark fades in (uPoseFade 0→1). At 0 this is a no-op (× 1.0), so poses
          // 0–2 stay byte-identical.
          scl *= mix(1.0, 0.001, uPoseFade);
          // Ascent-dawn boldness: grow the bead ×1.15 so it holds against the bright
          // sky. uDawnBold 0 (every pose but the settled dawn) is a no-op.
          scl *= mix(1.0, 1.15, uDawnBold);
          vVivid = aVivid;
          vDim = max(dim, (1.0 - aVisible) * 0.9);
          // Damage rides on top of emphasis: it recolors (fragment) but never
          // resizes, so a chain-lit-but-damaged node keeps its emphasis size.
          vDamage = clamp(aDamage, 0.0, 1.0);
          vPhase = aPhase;
          transformed *= scl;
          // Sphere shading inputs: view-space normal + view vector. The
          // instance matrices are uniform-scale + translation (no rotation),
          // so normalize(normalMatrix * normal) is exact.
          vNrm = normalize(normalMatrix * normal);
          vec4 mvp = modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
          vViewPos = -mvp.xyz;
        }
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform vec3 uDimColor;
        uniform float uTime;
        uniform float uStoryLift;
        uniform float uDawnBold;
        varying float vColorMul;
        varying float vShim;
        varying float vDim;
        varying float vDamage;
        varying float vPhase;
        varying vec3 vNrm;
        varying vec3 vViewPos;
        varying vec3 vVivid;
        `,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `
        #include <color_fragment>
        // Story lift: while a story plays, HEALTHY nodes rise to at least
        // chain-level brightness (shimmer preserved), so the lit strands cross
        // the bloom threshold and halo. Damage kills the lift FAST (gone by
        // d≈0.33): even a lightly-touched standard must read dimmer than its
        // healthy neighbors, never lifted back to bright — the ripple of
        // superficial learning stays visibly a ripple. max(), not ×, so a
        // focus/chain node never stacks the lift on top of its own emphasis.
        float lift = mix(uStoryLift, 1.0, clamp(vDamage * 3.0, 0.0, 1.0));
        float mulTotal = max(vColorMul, lift * vShim);
        diffuseColor.rgb = mix(diffuseColor.rgb * mulTotal, uDimColor, vDim);
        // Ascent-dawn boldness: pull the fill toward the DEEP vivid strand hue so the
        // orb reads as a solid coloured bead against the bright sky, not an additive
        // pastel wash. Applied BEFORE the sphere shading so the limb/key modelling
        // still rides on top; uDawnBold 0 → untouched (poses 0/2/3, dark baseline).
        diffuseColor.rgb = mix(diffuseColor.rgb, vVivid * 0.72, uDawnBold * 0.85);
        // --- sphere shading: limb darkening + a soft key light ----------------
        // Bright core, darkened silhouette: each orb reads as a self-luminous
        // sphere, and an orb in front separates visibly from one behind it
        // (the dark rim outlines it against the brighter neighbor). The HDR
        // core still crosses the bloom threshold; the rim drops below it, so
        // the halo hugs the center instead of flattening the whole disc.
        {
          vec3 nrm = normalize(vNrm);
          vec3 vdir = normalize(vViewPos);
          float facing = max(dot(nrm, vdir), 0.0);
          float limb = pow(1.0 - facing, 2.2);
          // Assumed key light, upper-left-front (view space). Half-Lambert
          // wrap keeps the shadow side luminous (these are glowing bodies,
          // not matte rock) while giving each orb a frank lit hemisphere and
          // shaded hemisphere — the modeling cue that reads "sphere" at a
          // glance and separates near orbs from far ones.
          vec3 keyDir = normalize(vec3(-0.4, 0.55, 0.73));
          float nl = dot(nrm, keyDir) * 0.5 + 0.5;
          float key = 0.5 + 0.5 * pow(nl, 1.6);
          diffuseColor.rgb *= key * (1.0 - 0.55 * limb);
        }
        // --- structural damage (composited AFTER emphasis) --------------------
        // 0 = untouched; 1 = ember husk. Damage distinguishes OUTAGE from
        // STRUGGLE: a fully-dead node (d >= 0.95) is a steady dark ember with
        // only the slow ~2.5s pulse — no flicker; a half-damaged node visibly
        // wavers; a lightly-touched one barely trembles. The flicker amplitude
        // follows a struggle curve 4·d·(1−d) that peaks at d = 0.5 and vanishes
        // at both ends. Brightness AND saturation lerp toward a deep red-amber
        // ember, with a mid-range-boosted desaturation so struggle reads even at
        // d ≈ 0.3. The husk tops out near #7a3520 (< 1.0 in every channel), so
        // damage NEVER crosses the bloom threshold — glow stays for healthy
        // emphasis only.
        if (vDamage > 0.0001) {
          float d = vDamage;
          // Monotone dimming floor: brightness falls with damage from the very
          // first touch, so a d≈0.2 standard is unmistakably dimmer than a
          // healthy one and the wound stays visible across every later scene.
          diffuseColor.rgb *= 1.0 - 0.5 * smoothstep(0.03, 0.7, d);
          float pulse = 0.5 + 0.5 * sin(uTime * 2.5132741 + vPhase);       // ~2.5s
          // Near-black embers: a fully-missed standard reads as OFF — a dark
          // body holding its place — not as a glowing coal. The faint warm
          // pulse is only there so the eye can find the wound on a dark field.
          // Values are LINEAR (the output transform re-brightens them to the
          // intended sRGB #1c0b07 → #38180e on screen).
          vec3 emberLo = vec3(0.0116, 0.0037, 0.0021);
          vec3 emberHi = vec3(0.0402, 0.0089, 0.0044);
          vec3 husk = mix(emberLo, emberHi, pulse);
          // Mid-range-boosted desaturation: the struggle band (d ~ 0.3–0.6)
          // visibly drains of strand color before it goes ember.
          float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum), clamp(d * 1.35, 0.0, 1.0) * 0.6);
          // Struggle flicker: amplitude peaks at d = 0.5, zero at both ends, and
          // hard-cut to 0 for a fully-dead ember (d >= 0.95) so it sits steady.
          float struggle = 4.0 * d * (1.0 - d) * (1.0 - step(0.95, d));
          float flick = sin(uTime * 6.7 + vPhase * 3.1) * 0.6
                      + sin(uTime * 11.3 + vPhase * 1.7) * 0.4;            // irregular
          float flickMul = 1.0 - 0.16 * struggle * (0.5 + 0.5 * flick);
          diffuseColor.rgb = mix(diffuseColor.rgb, husk, d) * flickMul;
        }
        `,
      );
  };
  // Distinct cache key so the patched program never collides with a stock basic material.
  material.customProgramCacheKey = () => "coherence-nodes-v5-orbs";

  // -- art-style geometries + materials (built once; swapped in setArtStyle) --
  // Every geometry carries the SAME instanced attribute objects (state, filters,
  // stories, and poses all keep working across a swap because the buffers are
  // shared). Only position/normal differ per skin.
  function attachShared(g: THREE.BufferGeometry): void {
    g.setAttribute("aEmphasis", emphasisAttr);
    g.setAttribute("aPhase", phaseAttr);
    g.setAttribute("aVisible", visibleAttr);
    g.setAttribute("aDamage", damageAttr);
    g.setAttribute("aArtRing", artRingAttr);
    g.setAttribute("aArtFid", artFidAttr);
    g.setAttribute("aTwist", twistAttr);
  }

  // Ringers peg: a short cylinder whose AXIS points +z, so the flat circular
  // face fronts the canonical camera (a disc) and orbiting reveals its height.
  const ringGeometry = new THREE.CylinderGeometry(1, 1, 1.7, 24);
  ringGeometry.rotateX(Math.PI / 2);
  attachShared(ringGeometry);
  // Ringers outline: an inverted-hull shell of the same peg, fattened in radius
  // (x/y) and a touch in height (z, the axis after the rotate). BackSide ink.
  const outlineGeometry = ringGeometry.clone();
  outlineGeometry.scale(1.14, 1.14, 1.06);
  attachShared(outlineGeometry);
  // Fidenza node: a PIPE segment (round 7, Mark's direction — was a cube).
  // A cylinder whose AXIS points +z (rotateX(PI/2)) like the Ringers peg, but
  // proportionally longer and slimmer — a length of pipe, not a puck. Tilted
  // off-axis per-instance by aTwist in the vertex shader; the fragment adds a
  // cylindrical rounding cue so it reads round.
  const fidGeometry = new THREE.CylinderGeometry(0.75, 0.75, 2.4, 20);
  fidGeometry.rotateX(Math.PI / 2);
  attachShared(fidGeometry);

  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true });
  ringMaterial.depthWrite = true;
  patchArtNodeMaterial(ringMaterial, {
    colorSource: { kind: "attr", name: "aArtRing" },
    uField: { value: new THREE.Color(RINGERS.bg) },
    pipe: false,
    cacheKey: "coherence-nodes-ringers-peg",
    uPoseFade: uniforms.uPoseFade,
  });

  const outlineMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    side: THREE.BackSide,
  });
  outlineMaterial.depthWrite = true;
  patchArtNodeMaterial(outlineMaterial, {
    colorSource: { kind: "uniform" },
    uColor: { value: new THREE.Color(RINGERS.ink) },
    uField: { value: new THREE.Color(RINGERS.bg) },
    pipe: false,
    cacheKey: "coherence-nodes-ringers-outline",
    uPoseFade: uniforms.uPoseFade,
  });

  const fidMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true });
  fidMaterial.depthWrite = true;
  patchArtNodeMaterial(fidMaterial, {
    colorSource: { kind: "attr", name: "aArtFid" },
    uField: { value: new THREE.Color(FIDENZA.bg) },
    pipe: true,
    cacheKey: "coherence-nodes-fidenza",
    uPoseFade: uniforms.uPoseFade,
  });

  // Widened to InstancedMesh<BufferGeometry> so setArtStyle can swap in the
  // cylinder/box skins (the constructor would otherwise pin it to Icosahedron).
  const mesh: THREE.InstancedMesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.name = "nodes";

  // Ringers outline mesh — a sibling InstancedMesh that shares the peg matrices
  // (written alongside the visible matrix below). Parented to `mesh` (identity
  // transform) so it enters the scene graph without touching main.ts, and
  // renders in lockstep with the pegs (same renderOrder). Hidden off-Ringers.
  const outline = new THREE.InstancedMesh(outlineGeometry, outlineMaterial, count);
  outline.frustumCulled = false;
  outline.visible = false;
  outline.name = "nodes-outline";
  outline.renderOrder = mesh.renderOrder;
  mesh.add(outline);

  // -- transforms + colors ----------------------------------------------
  // Current world position per instance (mutable — the pose driver morphs it
  // between graph.pos and graph.pos2). Seeded to pose A (the constellation).
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) positions.set(nodes[i].pos, i * 3);

  const m = new THREE.Matrix4();
  const color = new THREE.Color();

  // Compose one instance's visible matrix from its stored position + base
  // radius (emphasis scale rides on top in the shader, never in the matrix).
  function writeVisibleMatrix(i: number): void {
    const r = radii[i];
    m.makeScale(r, r, r);
    m.setPosition(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    mesh.setMatrixAt(i, m);
    // The Ringers outline rides the exact same matrix (its fatter geometry is
    // what makes the ink rim); writing it here keeps the outline glued to the
    // pegs through every pose morph and filter/story spotlight.
    outline.setMatrixAt(i, m);
  }

  for (let i = 0; i < count; i++) {
    writeVisibleMatrix(i);
    color.setHex(STRAND_COLORS[nodes[i].strand]);
    mesh.setColorAt(i, color); // every instance colored before first render
  }
  mesh.instanceMatrix.needsUpdate = true;
  outline.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  // -- raycast proxy (never rendered) -------------------------------------
  // visible=false keeps it out of the render list entirely (0 draw calls);
  // THREE.Raycaster.intersectObject() does not test .visible, so picking
  // against it directly still works.
  const proxyGeometry = new THREE.IcosahedronGeometry(1, 0);
  const proxyMaterial = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
  });
  const proxy = new THREE.InstancedMesh(proxyGeometry, proxyMaterial, count);
  proxy.frustumCulled = false;
  proxy.visible = false;
  proxy.name = "nodes-proxy";

  let touchMode = false;
  const pm = new THREE.Matrix4();
  function writeProxyMatrix(i: number): void {
    const factor = PROXY_RADIUS_FACTOR * (touchMode ? TOUCH_EXTRA_FACTOR : 1);
    const r = radii[i] * factor;
    pm.makeScale(r, r, r);
    pm.setPosition(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    proxy.setMatrixAt(i, pm);
  }
  function writeProxyMatrices(): void {
    for (let i = 0; i < count; i++) writeProxyMatrix(i);
    proxy.instanceMatrix.needsUpdate = true;
    proxy.computeBoundingSphere();
  }
  writeProxyMatrices();

  // -- bounds for camera framing ------------------------------------------
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const n of nodes) box.expandByPoint(v.set(n.pos[0], n.pos[1], n.pos[2]));
  const boundsSphere = new THREE.Sphere();
  box.getBoundingSphere(boundsSphere);

  return {
    mesh,
    proxy,
    count,
    emphasisAttr,
    visibleAttr,
    damageAttr,
    isVisible(index) {
      return visible[index] !== 0;
    },
    setDamage(values) {
      if (values === null) {
        damage.fill(0);
      } else {
        damage.set(values);
      }
      damageAttr.needsUpdate = true;
    },
    setVisibleMask(mask) {
      if (mask === null) {
        visible.fill(1);
      } else {
        visible.set(mask);
      }
      visibleAttr.needsUpdate = true;
    },
    setInstancePosition(index, x, y, z) {
      positions[index * 3] = x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = z;
      writeVisibleMatrix(index);
      writeProxyMatrix(index);
    },
    commitPositions() {
      mesh.instanceMatrix.needsUpdate = true;
      outline.instanceMatrix.needsUpdate = true;
      proxy.instanceMatrix.needsUpdate = true;
    },
    refreshPickBounds() {
      proxy.computeBoundingSphere();
    },
    getPosition(index, out) {
      return out.set(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
    },
    boundsSphere,
    boundsBox: box,
    setTime(t) {
      uniforms.uTime.value = t;
    },
    setShimmerEnabled(on) {
      uniforms.uShimmer.value = on ? 1 : 0;
    },
    setStoryLift(mul) {
      uniforms.uStoryLift.value = mul;
    },
    setOrbFade(amount) {
      uniforms.uPoseFade.value = amount;
    },
    setDawnBold(amount) {
      uniforms.uDawnBold.value = amount;
    },
    setTouchPicking(on) {
      if (on === touchMode) return;
      touchMode = on;
      writeProxyMatrices();
    },
    setArtStyle(style) {
      // Swap the render skin in place: geometry + material only. The instanced
      // attributes, positions, picking proxy, and every driver keep working
      // identically because they never move. Style 0 restores the EXACT galaxy
      // geometry + material objects — pixel-identical, by construction.
      if (style === 1) {
        mesh.geometry = ringGeometry;
        mesh.material = ringMaterial;
        outline.visible = true;
      } else if (style === 2) {
        mesh.geometry = fidGeometry;
        mesh.material = fidMaterial;
        outline.visible = false;
      } else {
        mesh.geometry = geometry;
        mesh.material = material;
        outline.visible = false;
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      ringGeometry.dispose();
      outlineGeometry.dispose();
      fidGeometry.dispose();
      ringMaterial.dispose();
      outlineMaterial.dispose();
      fidMaterial.dispose();
      proxyGeometry.dispose();
      proxyMaterial.dispose();
    },
  };
}
