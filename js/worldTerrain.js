// =============================================================================
// worldTerrain.js — Grand Theft Aura · TERRAIN, WATER & GROUND INTEGRITY
//
// Owns everything that is a FUNCTION OF POSITION rather than a thing placed at
// a coordinate:
//   • heightfields + the seamless grass/dirt/rock/sand/concrete splat shader
//   • the Studio sculpt registry (base-height snapshot + partial refresh)
//   • the ribbon primitive (shared with worldRoads.js — do not duplicate it)
//   • river systems, water surfaces, seabed, flow animation
//   • river bridges and water-coupled floating props
//   • ground integrity: range panels, shore patches, lips, backstops
//
// DOES NOT OWN: road grids / I-88 / loops (worldRoads.js), buildings and props
// (worldObjects/), the compiler (worldKit.js), streaming (worldStream.js).
//
// GEOMETRY CONVENTION
//   Heightfields use CENTRED geometry + mesh.position, so `at:[x,y,z]` in the
//   layout is the patch CENTRE. World coords for sampling = local + centre.
//
// HEIGHT MODES
//   sample:true  → y = terrainBaseH(x,z) - sink   (mountains, alpine, hills)
//   sample:false → flat; the mesh's at[1] carries the level (jungle, woods…)
//
// KEEP-OUTS
//   Rivers publish scatter exclusion volumes through hooks.addScatterKeepout,
//   which worldObjects/index.js installs at load. This avoids a static import
//   cycle (index → towers → shell → worldTerrain) and works if it is absent.
// =============================================================================
import * as THREE from 'three';
import { terrainHeightOffset } from './levelData.js';
import {
  AHC, I88, ahRz, fbm, hooks, mapShapes, riverX, roadC, sstep,
  terrainBaseH, terrainH, waterZones
} from './state.js';
import { makeMat, worldRoot } from './engine.js';
import {
  buildOceanSeabed, createWaterSurface, getOceanBedY, registerFloatingProp, waterBodies
} from './water.js';
import {
  addSolidBox, addRamp, groundMat, groundTexture, makeBox, registerBuilder,
  resolveMat, rngFor
} from './worldKit.js';

import { barkMaterial } from './worldObjects/foliage.js';

// =============================================================================
// SECTION 1 — PATHS & COORDINATE EXPRESSIONS
// =============================================================================
/** Frostpine creek centreline. Terrain, splat, bridges and scatter all use it. */
export const frostCreekX = (z) =>
  -420 + Math.sin(z * 0.05) * 30 + Math.sin(z * 0.017 + 1.3) * 18;

const PATHS = {
  riverX:      (x, z) => riverX(z),
  frostCreekX: (x, z) => frostCreekX(z),
  roadC:       (x, z) => roadC(z),
  ahRz:        (x, z) => ahRz(x),
  'I88.x':     () => I88.x
};

const coordWarned = new Set();

/**
 * Resolve a layout coordinate that may be a path expression.
 *   240                -> 240
 *   'riverX'           -> riverX(z)
 *   'frostCreekX+0.6'  -> frostCreekX(z) + 0.6
 *   'ahRz-43'          -> ahRz(x) - 43
 *   'I88.x-30'         -> I88.x - 30
 * No eval. Unknown names fall back to Number(spec) || 0 and warn once.
 */
export function coord(spec, x = 0, z = 0) {
  if (typeof spec === 'number') return Number.isFinite(spec) ? spec : 0;
  const s = String(spec ?? '').trim();
  const m = /^([A-Za-z][\w.]*)([+-]\d+(?:\.\d+)?)?$/.exec(s);
  if (m && PATHS[m[1]]) return PATHS[m[1]](x, z) + (m[2] ? Number(m[2]) : 0);
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  if (!coordWarned.has(s)) {
    coordWarned.add(s);
    console.warn('[worldTerrain] unresolved coordinate:', s);
  }
  return 0;
}

/** Resolve a row's `at:[x,z]` where either axis may be an expression. */
export function resolveRowXZ(row) {
  const a = row.at || [0, 0];
  const xNum = typeof a[0] === 'number' ? a[0] : null;
  const zNum = typeof a[1] === 'number' ? a[1] : null;
  const x = xNum !== null ? xNum : coord(a[0], 0, zNum ?? 0);
  const z = zNum !== null ? zNum : coord(a[1], xNum ?? x, 0);
  return { x, z };
}

/** Highest natural ground over a rectangular footprint (founding buildings). */
export function maxTerrainOver(x0, x1, z0, z1) {
  let m = -Infinity;
  for (const x of [x0, (x0 + x1) / 2, x1]) {
    for (const z of [z0, (z0 + z1) / 2, z1]) m = Math.max(m, terrainH(x, z));
  }
  return m;
}

/** Publish a scatter keep-out if worldObjects has installed the publisher. */
function keepout(x, z, r, tag) {
  if (typeof hooks.addScatterKeepout === 'function') hooks.addScatterKeepout(x, z, r, tag);
}

// =============================================================================
// SECTION 2 — STUDIO SCULPT REGISTRY
// =============================================================================
export const sculptableTerrainMeshes = [];

export function registerSculptableTerrain(mesh) {
  const positions = mesh.geometry.attributes.position;
  mesh.userData.terrainBaseY = Float32Array.from(
    positions.array.filter((_, index) => index % 3 === 1)
  );
  const bounds = new THREE.Box3().setFromBufferAttribute(positions);
  mesh.userData.terrainBounds = {
    minX: bounds.min.x + mesh.position.x, maxX: bounds.max.x + mesh.position.x,
    minZ: bounds.min.z + mesh.position.z, maxZ: bounds.max.z + mesh.position.z
  };
  mesh.userData.sculptableTerrain = true;
  sculptableTerrainMeshes.push(mesh);
  refreshTerrainSculpt(mesh.position.x, mesh.position.z, Infinity, mesh);
  return mesh;
}

/** Update visible terrain after a sculpt stroke or undo/redo. */
export function refreshTerrainSculpt(centerX = null, centerZ = null, radius = Infinity, onlyMesh = null) {
  const meshes = onlyMesh ? [onlyMesh] : sculptableTerrainMeshes;
  const partial = Number.isFinite(radius);
  const r2 = (radius + 3) * (radius + 3);

  for (const mesh of meshes) {
    const positions = mesh.geometry.attributes.position;
    const baseY = mesh.userData.terrainBaseY;
    if (!baseY) continue;
    const bounds = mesh.userData.terrainBounds;
    if (partial && bounds &&
        (centerX + radius < bounds.minX - 3 || centerX - radius > bounds.maxX + 3 ||
         centerZ + radius < bounds.minZ - 3 || centerZ - radius > bounds.maxZ + 3)) continue;

    let changed = false;
    for (let i = 0; i < positions.count; i++) {
      const x = mesh.position.x + positions.getX(i);
      const z = mesh.position.z + positions.getZ(i);
      if (partial && ((x - centerX) ** 2 + (z - centerZ) ** 2) > r2) continue;
      positions.setY(i, baseY[i] + terrainHeightOffset(x, z));
      changed = true;
    }
    if (!changed) continue;

    positions.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    if (mesh.userData.terrainSplatMode) {
      paintTerrainSplat(mesh.geometry, mesh.userData.terrainSplatMode, mesh.position.x, mesh.position.z);
    }
  }
}

// =============================================================================
// SECTION 3 — SEAMLESS TERRAIN BLEND (splat shader)
// =============================================================================
const blendCache = new Map();

export function makeTerrainBlendMaterial({ roughness = 1, metalness = 0 } = {}) {
  const key = `${roughness}|${metalness}`;
  if (blendCache.has(key)) return blendCache.get(key);

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness, metalness
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGrass = { value: groundTexture('grass') };
    shader.uniforms.uDirt = { value: groundTexture('dirt') };
    shader.uniforms.uRock = { value: groundTexture('rock') };
    shader.uniforms.uSand = { value: groundTexture('sand') };
    shader.uniforms.uConcrete = { value: groundTexture('concrete') };
    shader.uniforms.uGrassScale = { value: new THREE.Vector2(0.12, 0.12) };
    shader.uniforms.uDirtScale = { value: new THREE.Vector2(0.10, 0.10) };
    shader.uniforms.uRockScale = { value: new THREE.Vector2(0.06, 0.06) };
    shader.uniforms.uSandScale = { value: new THREE.Vector2(0.14, 0.14) };
    shader.uniforms.uConcreteScale = { value: new THREE.Vector2(0.08, 0.08) };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 terrainSplat; attribute float terrainConcrete;
        varying vec4 vSplat; varying float vConcrete; varying vec2 vGroundXZ;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSplat = terrainSplat; vConcrete = terrainConcrete;
        vGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uGrass; uniform sampler2D uDirt; uniform sampler2D uRock;
        uniform sampler2D uSand; uniform sampler2D uConcrete;
        uniform vec2 uGrassScale; uniform vec2 uDirtScale; uniform vec2 uRockScale;
        uniform vec2 uSandScale; uniform vec2 uConcreteScale;
        varying vec4 vSplat; varying float vConcrete; varying vec2 vGroundXZ;`)
      .replace('#include <map_fragment>', `
        vec2 groundUV = vGroundXZ;
        vec3 grassCol = texture2D(uGrass, groundUV * uGrassScale).rgb;
        vec3 dirtCol  = texture2D(uDirt,  groundUV * uDirtScale).rgb;
        vec3 rockCol  = texture2D(uRock,  groundUV * uRockScale).rgb;
        vec3 sandCol  = texture2D(uSand,  groundUV * uSandScale).rgb;
        vec3 concCol  = texture2D(uConcrete, groundUV * uConcreteScale).rgb;
        float total = vSplat.x + vSplat.y + vSplat.z + vSplat.w + vConcrete + 0.0001;
        vec3 blendedGround = grassCol * vSplat.x + dirtCol * vSplat.y
                           + rockCol * vSplat.z + sandCol * vSplat.w + concCol * vConcrete;
        blendedGround /= total;
        diffuseColor.rgb *= blendedGround;`);
  };
  mat.customProgramCacheKey = () => 'aura-terrain-blend-v1';
  mat.userData.shared = true;
  blendCache.set(key, mat);
  return mat;
}

/** Paint per-vertex grass/dirt/rock/sand/concrete weights onto a geometry. */
export function paintTerrainSplat(geometry, mode, offsetX = 0, offsetZ = 0) {
  const pos = geometry.attributes.position;
  const count = pos.count;
  const splat = new Float32Array(count * 4);
  const concrete = new Float32Array(count);

  if (!geometry.attributes.color) {
    const white = new Float32Array(count * 3);
    white.fill(1);
    geometry.setAttribute('color', new THREE.BufferAttribute(white, 3));
  }

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i) + offsetX, z = pos.getZ(i) + offsetZ;
    const h = terrainBaseH(x, z);
    const slope =
      Math.abs(terrainBaseH(x + 3, z) - terrainBaseH(x - 3, z)) / 6 +
      Math.abs(terrainBaseH(x, z + 3) - terrainBaseH(x, z - 3)) / 6;

    let grass = 0, dirt = 0, rock = 0, sand = 0, conc = 0;

    if (mode === 'mountains') {
      const riverBed = 1 - sstep(4, 14, Math.abs(x - riverX(z)));
      grass = 1 - sstep(55, 105, h);
      dirt = sstep(35, 85, h) * (1 - sstep(105, 150, h));
      rock = sstep(95, 150, h) + sstep(0.35, 0.75, slope);
      sand = riverBed * 0.8;
    } else if (mode === 'hills') {
      grass = 1 - sstep(45, 85, h);
      dirt = sstep(30, 70, h) * 0.5;
      rock = sstep(60, 100, h) + sstep(0.4, 0.8, slope);
    } else if (mode === 'alpine') {
      const creekBed = 1 - sstep(3, 9, Math.abs(x - frostCreekX(z)));
      grass = 1 - sstep(5, 9, h);
      dirt = sstep(4, 8, h) * 0.4;
      rock = sstep(7, 11, h) + sstep(0.35, 0.7, slope);
      sand = creekBed * 0.7;
    } else if (mode === 'jungle') {
      grass = 1;
      dirt = sstep(0.2, 0.5, slope) * 0.4;
    } else if (mode === 'woods') {
      grass = 1;
      dirt = (1 - sstep(3, 8, Math.abs(z - 150))) * 0.6;
    } else if (mode === 'desert') {
      sand = 1;
      rock = sstep(0.35, 0.7, slope) * 0.7;
      dirt = sstep(20, 70, h) * 0.25;
    } else if (mode === 'cove') {
      sand = 1;
    } else if (mode === 'north') {
      grass = 1;
      dirt = sstep(0.25, 0.6, slope) * 0.3;
    } else {
      grass = 1;
    }

    const sum = grass + dirt + rock + sand + conc || 1;
    splat[i * 4 + 0] = grass / sum;
    splat[i * 4 + 1] = dirt / sum;
    splat[i * 4 + 2] = rock / sum;
    splat[i * 4 + 3] = sand / sum;
    concrete[i] = conc / sum;
  }

  geometry.setAttribute('terrainSplat', new THREE.BufferAttribute(splat, 4));
  geometry.setAttribute('terrainConcrete', new THREE.BufferAttribute(concrete, 1));
  geometry.userData.terrainSplatMode = mode;
}

export function paintMeshTerrainSplat(mesh, mode) {
  paintTerrainSplat(mesh.geometry, mode, mesh.position.x, mesh.position.z);
  mesh.userData.terrainSplatMode = mode;
}

// =============================================================================
// SECTION 4 — HEIGHTFIELD MODES (vertex colouring)
// =============================================================================
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const SCREE = new THREE.Color(0x8a8175);

/**
 * Each mode: { sample, sink, splat, blend, sculpt, color(c, ctx) }
 * ctx = { x, z, h, sl } — sl is the grid-neighbour slope (0 when unused).
 */
const MODES = {
  mountains: {
    sample: true, sink: 0.1, splat: 'mountains', blend: true, sculpt: true,
    color(c, { x, z, h, sl }) {
      const n = fbm(x * 0.08, z * 0.08, 3);
      const n2 = fbm(x * 0.02 + 7, z * 0.02, 3);
      const snowLine = 150 + n * 30;
      c.set(0x547a3a).lerp(_c2.set(0x6e8a45), n);
      c.lerp(_c2.set(0x34502f), sstep(35, 70, h));
      c.lerp(_c2.set(0x8a8070), sstep(95, 140, h));
      c.lerp(_c2.set(0x6d655b).lerp(SCREE, n), sstep(0.4, 0.85, sl));
      if (sl > 0.4) c.multiplyScalar(0.92 + 0.08 * Math.sin(h * 0.45 + n * 6));
      c.lerp(_c2.set(0xf2f6fa), sstep(snowLine - 12, snowLine + 8, h) * (1 - sstep(0.7, 1.0, sl)));
      c.multiplyScalar(0.9 + 0.2 * n2);
      const rd = Math.abs(x - riverX(z));
      if (rd < 7.5) c.lerp(_c2.set(0x3a4a52), (1 - rd / 7.5) * 0.85);
    }
  },
  alpine: {
    sample: true, sink: 0, splat: 'alpine', blend: true, sculpt: true,
    color(c, { x, z, h }) {
      const snowLine = 6.5 + fbm(x * 0.05, z * 0.05, 2) * 2;
      c.set(0x6b7a5c);
      c.lerp(_c2.set(0x8a9a6b), sstep(3, 6, h));
      c.lerp(_c2.set(0xb3b380), sstep(snowLine - 3, snowLine + 2, h));
      c.lerp(_c2.set(0xffffff), sstep(snowLine, snowLine + 3, h));
      if (z > 132 && z < 316) {
        const cd = Math.abs(x - frostCreekX(z));
        if (cd < 7) c.lerp(_c2.set(0x4b5563), (1 - cd / 7) * 0.8);
      }
    }
  },
  hills: {
    sample: true, sink: 0.1, splat: 'hills', blend: true, sculpt: true,
    color(c, { x, z, h, sl }) {
      const n = fbm(x * 0.06, z * 0.06, 3);
      c.set(0x5b7d3c).lerp(_c2.set(0x8a8f52), n);
      c.lerp(_c2.set(0xa59a76), sstep(40, 85, h));
      c.lerp(_c2.set(0x4f8a3f), 1 - sstep(66, 100, Math.hypot(x - AHC.px, z - AHC.pz)));
      c.lerp(_c2.set(0x76705f), sstep(0.35, 0.75, sl));
      c.multiplyScalar(0.9 + 0.2 * n);
    }
  },
  jungle: { sample: false, sink: 0, splat: 'jungle', blend: true, sculpt: true },
  woods:  { sample: false, sink: 0, splat: 'woods',  blend: true, sculpt: true },
  cove:   { sample: false, sink: 0, splat: 'cove',   blend: true, sculpt: true },
  desert: { sample: false, sink: 0, splat: 'desert', blend: true, sculpt: true },
  north:  { sample: false, sink: 0, splat: 'north',  blend: true, sculpt: true },

  /** Ground-integrity range panels: plain vertex colour, no splat, not sculptable. */
  range: {
    sample: true, sink: 0.1, splat: null, blend: false, sculpt: false,
    color(c, { x, z, h }) {
      const n = fbm(x * 0.05, z * 0.05, 3);
      c.set(0x547a3a).lerp(_c2.set(0x6e8a45), n);
      c.lerp(_c2.set(0x8a8070), sstep(95, 150, h));
      c.lerp(_c2.set(0xf2f6fa), sstep(150, 178, h));
    }
  },
  plain: { sample: false, sink: 0, splat: null, blend: true, sculpt: true }
};

let plainVertexMat = null;
function vertexOnlyMat() {
  if (!plainVertexMat) {
    plainVertexMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1, flatShading: true
    });
    plainVertexMat.userData.shared = true;
  }
  return plainVertexMat;
}

/** Guarantee a colour attribute exists whenever the material reads one. */
function ensureVertexColors(geo) {
  if (geo.attributes.color) return;
  const white = new Float32Array(geo.attributes.position.count * 3);
  white.fill(1);
  geo.setAttribute('color', new THREE.BufferAttribute(white, 3));
}

// =============================================================================
// SECTION 5 — TERRAIN BUILDERS
// =============================================================================
/** Flat tiled ground patch, sculptable. (city ground, desert, north land…) */
export function buildTerrainPlane(row) {
  const [x, y, z] = row.at;
  const w = row.w, d = row.d;
  const sx = row.seg?.[0] ?? Math.max(1, Math.ceil(w / 2));
  const sz = row.seg?.[1] ?? Math.max(1, Math.ceil(d / 2));

  const geo = new THREE.PlaneGeometry(w, d, sx, sz);
  geo.rotateX(-Math.PI / 2);

  const mat = groundMat(row.surface || 'grass', {
    color: row.color ?? 0xffffff,
    repeatX: (row.repeat || [1, 1])[0],
    repeatY: (row.repeat || [1, 1])[1],
    roughness: row.roughness ?? 0.95,
    metalness: row.metalness ?? 0
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  mesh.userData.studioName = row.name || row.id || 'Ground';
  (row.parent || worldRoot).add(mesh);

  registerSculptableTerrain(mesh);
  if (row.splat) paintMeshTerrainSplat(mesh, row.splat);
  return mesh;
}

/** Sampled heightfield with mode-specific vertex colouring. */
export function buildHeightfield(row) {
  const [cx, cy, cz] = row.at;
  const w = row.w, d = row.d;
  const sx = row.seg?.[0] ?? Math.max(1, Math.ceil(w / 2));
  const sz = row.seg?.[1] ?? Math.max(1, Math.ceil(d / 2));
  const mode = MODES[row.mode] || MODES.plain;

  const geo = new THREE.PlaneGeometry(w, d, sx, sz);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const count = pos.count;

  // Pass 1 — heights.
  const H = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i) + cx, z = pos.getZ(i) + cz;
    const h = mode.sample ? terrainBaseH(x, z) : 0;
    H[i] = h;
    pos.setY(i, h - (mode.sink || 0));
  }
  pos.needsUpdate = true;

  // Pass 2 — colours, with grid-neighbour slope (matches the original exactly).
  if (mode.color) {
    const col = new Float32Array(count * 3);
    const stride = sx + 1;
    const dx = w / sx, dz = d / sz;
    for (let i = 0; i < count; i++) {
      const gx = i % stride, gz = (i / stride) | 0;
      const il = gx > 0 ? i - 1 : i, ir = gx < sx ? i + 1 : i;
      const iu = gz > 0 ? i - stride : i, id = gz < sz ? i + stride : i;
      const sl = Math.abs(H[ir] - H[il]) / (2 * dx) + Math.abs(H[id] - H[iu]) / (2 * dz);
      const x = pos.getX(i) + cx, z = pos.getZ(i) + cz;
      mode.color(_c, { x, z, h: H[i], sl });
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }

  geo.computeVertexNormals();

  const mat = mode.blend === false
    ? vertexOnlyMat()
    : makeTerrainBlendMaterial({ roughness: row.roughness ?? 1 });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, cy, cz);
  mesh.receiveShadow = true;
  mesh.castShadow = !!row.cast;
  mesh.userData.studioName = row.name || row.id || `Terrain ${row.mode}`;
  (row.parent || worldRoot).add(mesh);

  if (mode.splat) paintMeshTerrainSplat(mesh, mode.splat);
  else ensureVertexColors(geo);

  if (mode.sculpt) registerSculptableTerrain(mesh);
  return mesh;
}

/** Carved channel bed (parabolic across the narrow axis). */
export function buildTerrainBed(row) {
  const { x: cx, z: cz } = resolveRowXZ(row);
  const w = row.w, d = row.d;
  const sx = row.seg?.[0] ?? Math.max(2, Math.round(w / 2));
  const sz = row.seg?.[1] ?? Math.max(2, Math.round(d / 2));
  const top = row.top ?? 0.17, depth = row.depth ?? 0.58;
  const acrossX = w < d;

  const geo = new THREE.PlaneGeometry(w, d, sx, sz);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const half = (acrossX ? w : d) / 2;
  for (let i = 0; i < pos.count; i++) {
    const t = (acrossX ? pos.getX(i) : pos.getZ(i)) / half;
    pos.setY(i, top - depth * Math.max(0, 1 - t * t));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const rep = row.repeat || [Math.max(1, Math.round(w / 8)), Math.max(1, Math.round(d / 8))];
  const mesh = new THREE.Mesh(geo, groundMat(row.surface || 'dirt', {
    color: row.color ?? 0xffffff, repeatX: rep[0], repeatY: rep[1], roughness: 0.95
  }));
  mesh.position.set(cx, 0, cz);
  mesh.receiveShadow = true;
  mesh.userData.studioName = row.name || row.id || 'Stream bed';
  (row.parent || worldRoot).add(mesh);
  return mesh;
}

/** Retaining face so you can never see under a raised terrain shelf. */
export function buildTerrainSkirt(row) {
  const { x, z } = resolveRowXZ(row);
  const top = row.top ?? 0, bottom = row.bottom ?? -0.6;
  const h = top - bottom;
  return makeBox(row.parent || worldRoot, row.w, h, row.d, x, (top + bottom) / 2, z,
    resolveMat(row.mat || 'redrock'),
    { cast: true, recv: true, name: row.name || 'Terrain skirt' });
}

/** Solid shore / gap patch. bounds are [x0, x1, z0, z1]. */
export function buildGroundPatch(row) {
  const [x0, x1, z0, z1] = row.bounds;
  const y = row.y ?? 0.17, thick = row.thick ?? 0.4;
  const w = x1 - x0, d = z1 - z0;
  const mat = row.surface
    ? groundMat(row.surface, {
        color: row.color ?? 0xffffff,
        repeatX: row.repeat?.[0] ?? 6, repeatY: row.repeat?.[1] ?? 6, roughness: 0.96
      })
    : resolveMat(row.mat || 'sand');
  const m = makeBox(row.parent || worldRoot, w, thick, d,
    (x0 + x1) / 2, y - thick / 2, (z0 + z1) / 2, mat,
    { recv: true, name: row.name || 'Ground patch' });
  const box = addSolidBox(x0, x1, y - thick, y, z0, z1, row.tag || 'ground_patch', true);
  return { object: m, boxes: [box] };
}

/** Visual-only backstop under land — the last guarantee against the void. */
export function buildBackstop(row) {
  const [x0, x1, z0, z1] = row.bounds;
  const mat = new THREE.MeshStandardMaterial({ color: row.color ?? 0x2b3129, roughness: 1 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set((x0 + x1) / 2, row.y ?? -0.55, (z0 + z1) / 2);
  m.renderOrder = -1;
  m.userData.studioName = row.name || 'Backstop';
  m.userData.studioSelectable = false;
  (row.parent || worldRoot).add(m);
  return m;
}

// =============================================================================
// SECTION 6 — RIBBON PRIMITIVE  (shared with worldRoads.js)
// =============================================================================
/**
 * Build a ribbon along a polyline.
 *   pts      [{x,y,z}]
 *   yAt(p,s) world Y at station p, lateral sign s
 *   opts     { cols=[-1,1], offset=0, uvScale=8, colorAt(c,s,p) }
 */
export function ribbonGeometry(pts, halfWidth, yAt,
  { cols = [-1, 1], offset = 0, uvScale = 8, colorAt = null } = {}) {
  const pos = [], uv = [], col = [], idx = [];
  const c = new THREE.Color();
  let dist = 0;

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
    const tx = next.x - prev.x, tz = next.z - prev.z;
    const l = Math.hypot(tx, tz) || 1;
    const nx = tz / l, nz = -tx / l;
    if (i > 0) dist += Math.hypot(p.x - prev.x, p.z - prev.z);

    for (const s of cols) {
      pos.push(p.x + nx * (offset + halfWidth * s), yAt(p, s), p.z + nz * (offset + halfWidth * s));
      uv.push((s + 1) * 0.5, dist / uvScale);
      if (colorAt) { colorAt(c, s, p); col.push(c.r, c.g, c.b); }
    }
    if (i > 0) {
      const a = (i - 1) * cols.length;
      for (let j = 0; j < cols.length - 1; j++) {
        idx.push(a + j, a + j + cols.length, a + j + 1,
                 a + j + 1, a + j + cols.length, a + j + cols.length + 1);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colorAt) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Station normals for a closed loop — used by roads for rails and pullouts. */
export function loopNormals(pts) {
  return (i) => {
    const n = pts.length;
    const prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
    const tx = next.x - prev.x, tz = next.z - prev.z, l = Math.hypot(tx, tz) || 1;
    return { nx: tz / l, nz: -tx / l, yaw: Math.atan2(tx, tz) };
  };
}

// =============================================================================
// SECTION 7 — RIVER SYSTEMS
// =============================================================================
const riverFlowMats = [];
const riverById = new Map();
let lastRiver = null;

export function riverSurfaceAt(id, z) {
  const r = id ? riverById.get(id) : lastRiver;
  return r ? r.surfAt(z) : 0.26;
}

/** Animate every river's flow texture. Call once per frame. */
export function updateRiverFlow(dt) {
  for (const r of riverFlowMats) {
    if (r.mat.map) r.mat.map.offset.y = (r.mat.map.offset.y - dt * r.speed) % 1;
  }
}

/**
 * Ribbon river with a smoothed profile, shallow→deep vertex tint, a scrolling
 * flow map, and per-segment water bodies + zones for the swim system.
 */
export function buildRiverSystem({
  id, parent = worldRoot, centerX, z0, z1, halfWidth = 5, step = 3, lift = 0.24,
  waveScale = 0.14, currentX = 0, currentZ = 0.8,
  shallowColor = 0x67e8f9, deepColor = 0x0c4a6e, foamColor = 0xe0f2fe,
  flowSpeed = 0.4, segment = 8, mapStep = 0, keepoutStep = 12
}) {
  const pts = [];
  for (let z = z0; z <= z1 + 0.001; z += step) {
    const cx = centerX(z);
    pts.push(new THREE.Vector3(cx, Math.max(terrainH(cx, z), 0.26) + lift, z));
  }
  // 1-2-1 smoothing so the surface never stair-steps over the heightfield.
  const sm = pts.map((p, i) =>
    (pts[Math.max(0, i - 1)].y + p.y * 2 + pts[Math.min(pts.length - 1, i + 1)].y) / 4);
  pts.forEach((p, i) => { p.y = sm[i]; });

  const surfAt = (z) => {
    const t = THREE.MathUtils.clamp((z - z0) / step, 0, pts.length - 1);
    const i = Math.floor(t), f = t - i;
    const a = pts[i], b = pts[Math.min(pts.length - 1, i + 1)];
    return a.y + (b.y - a.y) * f;
  };

  const cShallow = new THREE.Color(shallowColor), cDeep = new THREE.Color(deepColor);
  const geo = ribbonGeometry(pts, halfWidth, (p, s) => p.y - 0.03 * Math.abs(s), {
    cols: [-1, -0.42, 0.42, 1], uvScale: 7,
    colorAt: (c, s) => { c.copy(cShallow).lerp(cDeep, Math.max(0, 1 - s * s)); }
  });

  const mat = makeMat(0xffffff, {
    texType: 'water', repeatX: 2, repeatY: 1, roughness: 0.12, metalness: 0.3,
    transparent: true, opacity: 0.78, flatShading: false
  });
  mat.vertexColors = true;
  mat.side = THREE.DoubleSide;
  mat.depthWrite = false;
  if (mat.map) {
    mat.map = mat.map.clone();
    mat.map.needsUpdate = true;
    mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;
  }
  riverFlowMats.push({ mat, speed: flowSpeed });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  mesh.userData.studioName = `River: ${id}`;
  parent.add(mesh);

  // Swim volumes, segmented so the water system can cull and query cheaply.
  for (let za = z0, n = 0; za < z1 - 0.5; za += segment, n++) {
    const zb = Math.min(z1, za + segment);
    let minX = Infinity, maxX = -Infinity;
    for (let z = za; z <= zb + 0.001; z += step) {
      const cx = centerX(z);
      minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
    }
    const sy = surfAt((za + zb) / 2) + 0.06;
    const bx0 = minX - halfWidth - 0.4, bx1 = maxX + halfWidth + 0.4;
    waterBodies.push({
      id: `${id}_${n}`, minX: bx0, maxX: bx1, minZ: za, maxZ: zb,
      surfaceY: sy, bedY: sy - 0.6, bedFn: (x, z) => terrainH(x, z),
      waveScale, currentX, currentZ, isOcean: false, mesh: null
    });
    waterZones.push({ minX: bx0, maxX: bx1, minZ: za, maxZ: zb });
  }

  // Scatter keep-outs: forests must not grow in the channel.
  if (keepoutStep > 0) {
    for (let z = z0; z <= z1; z += keepoutStep) keepout(centerX(z), z, halfWidth + 3.8, 'river');
  }

  if (mapStep > 0) {
    for (let z = z0; z < z1; z += mapStep) {
      const zc = Math.min(z1, z + mapStep / 2);
      mapShapes.push({
        x: centerX(zc), z: zc, w: halfWidth * 2 + 4, d: Math.min(mapStep, z1 - z),
        color: '#38bdf8', border: '#0ea5e9', enterable: false
      });
    }
  }

  const rec = { id, pts, surfAt, mesh, halfWidth, z0, z1 };
  riverById.set(id, rec);
  lastRiver = rec;
  return rec;
}

// =============================================================================
// SECTION 8 — WATER BUILDERS (row adapters)
// =============================================================================
const BED_PRESETS = {
  ocean: () => getOceanBedY,
  woods: () => (x, z) => 0.17 - 0.58 * Math.max(0, 1 - ((z - 150) / 3.1) ** 2),
  jungle: () => (x) => { const d = (x - 418) / 6; return 1.5 - 1.48 * Math.max(0, 1 - d * d); }
};

function resolveBed(spec) {
  if (typeof spec === 'function') return spec;
  if (typeof spec === 'number') return () => spec;
  if (spec && typeof spec === 'object') {
    const { top = 0.17, depth = 0.6, axis = 'z', center = 0, halfW = 3 } = spec;
    return (x, z) => {
      const t = ((axis === 'x' ? x : z) - center) / halfW;
      return top - depth * Math.max(0, 1 - t * t);
    };
  }
  const preset = BED_PRESETS[spec];
  return preset ? preset() : getOceanBedY;
}

export function buildWaterSurfaceRow(row) {
  const [minX, maxX, minZ, maxZ] = row.bounds;
  return createWaterSurface({
    id: row.id, parent: row.parent || worldRoot,
    minX, maxX, minZ, maxZ,
    surfaceY: row.y ?? 0.20,
    bedFn: resolveBed(row.bed),
    waveScale: row.wave ?? 0.4,
    currentX: (row.current || [0, 0])[0],
    currentZ: (row.current || [0, 0])[1],
    isOcean: !!row.ocean,
    shallowColor: row.shallow, deepColor: row.deep, foamColor: row.foam,
    segmentSize: row.seg ?? 4
  });
}

export function buildRiverRow(row) {
  const centerFn = row.center === 'frostCreekX' ? frostCreekX
    : row.center === 'roadC' ? roadC
    : typeof row.center === 'function' ? row.center : riverX;
  return buildRiverSystem({
    id: row.id, parent: row.parent || worldRoot, centerX: centerFn,
    z0: row.z[0], z1: row.z[1],
    halfWidth: row.halfW ?? 5, step: row.step ?? 3, lift: row.lift ?? 0.24,
    waveScale: row.wave ?? 0.14,
    currentX: (row.current || [0, 0])[0], currentZ: (row.current || [0, 0])[1],
    flowSpeed: row.flow ?? 0.5, segment: row.segment ?? 8,
    shallowColor: row.shallow, deepColor: row.deep, foamColor: row.foam,
    mapStep: row.mapStep ?? (row.center === 'riverX' ? 60 : 0),
    keepoutStep: row.keepoutStep ?? 12
  });
}

// =============================================================================
// SECTION 9 — RIVER BRIDGES & FLOATING PROPS
// =============================================================================
export function buildRiverBridge(parent, cx, z, deckY, span, { stone = false, deckW = 4.4 } = {}) {
  const mat = stone
    ? makeMat(0x9aa0a6, { texType: 'cobblestone', repeatX: 5, repeatY: 2, roughness: 0.9 })
    : makeMat(0x78350f, { texType: 'wood', repeatX: 5, repeatY: 2 });

  makeBox(parent, span, 0.26, deckW, cx, deckY - 0.13, z, mat, {
    cast: true, recv: true, name: stone ? 'Stone arch bridge' : 'River footbridge',
    box: [cx - span / 2, cx + span / 2, deckY - 0.26, deckY,
          z - deckW / 2, z + deckW / 2, stone ? 'stone_bridge' : 'river_bridge', true]
  });

  for (const s of [-1, 1]) {
    const rz = z + s * (deckW / 2 - 0.1);
    makeBox(parent, span, 0.8, 0.2, cx, deckY + 0.4, rz, mat, {
      cast: true,
      box: [cx - span / 2, cx + span / 2, deckY, deckY + 0.8,
            rz - 0.1, rz + 0.1, 'bridge_rail', true]
    });
  }

  if (stone) {
    for (const s of [-1, 1]) {
      const arch = new THREE.Mesh(new THREE.TorusGeometry(span * 0.28, 0.35, 8, 18, Math.PI), mat);
      arch.position.set(cx, deckY - 0.28, z + s * deckW * 0.32);
      arch.castShadow = true;
      parent.add(arch);
    }
  } else {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 1.6, 7), mat);
      post.position.set(cx + sx * span * 0.33, deckY - 0.8, z + sz * (deckW / 2 - 0.3));
      parent.add(post);
    }
  }

  mapShapes.push({
    x: cx, z, w: span, d: deckW,
    color: stone ? '#9aa0a6' : '#78350f', border: '#fcd34d', enterable: false
  });
  keepout(cx, z, Math.max(span, deckW) / 2 + 2, 'bridge');
  return { cx, z, deckY, span, deckW };
}

/** Approach ramps for a stone bridge — real driveable surfaces. */
export function buildBridgeApproaches(parent, cx, z, deckY, span, deckW, roadDY = 0.12) {
  const run = 3.2;
  const mat = makeMat(0x8a8f94, { texType: 'cobblestone', repeatX: 1, repeatY: 2, roughness: 0.9 });
  for (const s of [-1, 1]) {
    const rx = cx + s * (span / 2 + 1.6);
    const gy = terrainH(rx, z) + roadDY;
    const rise = deckY - gy;
    makeBox(parent, run, 0.24, deckW, cx + s * (span / 2 + run / 2), (deckY + gy) / 2 - 0.12, z, mat,
      { recv: true, rz: s * Math.atan2(rise, run) });
    addRamp({
      minX: s < 0 ? cx - span / 2 - run : cx + span / 2,
      maxX: s < 0 ? cx - span / 2 : cx + span / 2 + run,
      minZ: z - deckW / 2, maxZ: z + deckW / 2,
      startY: s < 0 ? gy : deckY, endY: s < 0 ? deckY : gy, axis: 'x', dir: 1
    });
    keepout(cx + s * (span / 2 + run / 2), z, run, 'bridge_ramp');
  }
}

function barkMat() { return barkMaterial(); }

export function spawnRiverLog(parent, x, z, seed = null) {
  const rng = seed ? rngFor(seed) : Math.random;
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 3.6, 7), barkMat());
  log.rotation.z = Math.PI / 2;
  log.rotation.y = rng() * Math.PI;
  log.position.set(x, 0.4, z);
  log.castShadow = true;
  log.userData.studioName = 'Drifting log';
  parent.add(log);
  registerFloatingProp(log, x, z, 0.02, 0.5);
  return log;
}

export function buildChannelBuoy(parent, x, z, hex = 0xdc2626) {
  const g = new THREE.Group();
  g.position.set(x, 0.3, z);
  g.userData.studioName = 'Channel buoy';
  const bodyMat = makeMat(hex, { roughness: 0.5, metalness: 0.4 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 0.5, 10), bodyMat);
  base.position.y = 0.25; base.castShadow = true;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 10), bodyMat);
  cone.position.y = 0.95;
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
  light.position.y = 1.5;
  g.add(base, cone, light);
  parent.add(g);
  registerFloatingProp(g, x, z, 0.02, 1.1);
  return g;
}

export function buildRowboat(parent, x, z, hullHex = 0x926c44, seed = null) {
  const rng = seed ? rngFor(seed) : Math.random;
  const g = new THREE.Group();
  g.position.set(x, 0.3, z);
  g.rotation.y = rng() * Math.PI * 2;
  g.userData.studioName = 'Rowboat';
  makeBox(g, 1.3, 0.5, 3.2, 0, 0, 0,
    makeMat(hullHex, { texType: 'wood', repeatX: 1, repeatY: 3 }), { cast: true });
  makeBox(g, 1.5, 0.12, 3.4, 0, 0.28, 0, makeMat(0x57534e));
  const seatMat = makeMat(0xb45309, { texType: 'wood' });
  makeBox(g, 1.1, 0.08, 0.4, 0, 0.22, 0.7, seatMat);
  makeBox(g, 1.1, 0.08, 0.4, 0, 0.22, -0.7, seatMat);
  parent.add(g);
  registerFloatingProp(g, x, z, 0.12, 0.95);
  return g;
}

export function buildSailboat(parent, x, z, ry = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0.3, z);
  g.rotation.y = ry;
  g.userData.studioName = 'Cove sailboat';
  makeBox(g, 1.6, 0.7, 4.8, 0, 0, 0, makeMat(0xf8fafc));
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5, 5), makeMat(0x57534e));
  mast.position.y = 2.8;
  const sail = new THREE.Mesh(new THREE.ConeGeometry(1.3, 4.2, 3), makeMat(0xfef3c7));
  sail.position.set(0, 2.9, 0.3);
  sail.scale.z = 0.12;
  g.add(mast, sail);
  parent.add(g);
  registerFloatingProp(g, x, z, 0.15, 0.9);
  return g;
}

// =============================================================================
// SECTION 10 — GROUND INTEGRITY
// =============================================================================
/**
 * The collision heightfield runs the mountain formula for ANY x north of
 * z = -170. These panels give that invisible ground a visible surface, close
 * shore gaps, and back every edge so no ray ever reaches the void.
 * All bounds here are [x0, x1, z0, z1].
 */
export function buildGroundIntegrity(spec = {}, parent = worldRoot) {
  const grp = new THREE.Group();
  grp.userData.studioName = 'Ground integrity';
  grp.userData.studioSelectable = false;
  parent.add(grp);

  for (const p of spec.panels || []) {
    const [x0, x1, z0, z1] = p.bounds;
    buildHeightfield({
      id: p.id || `panel_${x0}_${z0}`, parent: grp, mode: 'range',
      at: [(x0 + x1) / 2, 0, (z0 + z1) / 2],
      w: x1 - x0, d: Math.abs(z1 - z0), seg: p.seg, name: p.name
    });
  }
  for (const p of spec.patches || []) {
    buildGroundPatch({ ...p, parent: grp, thick: 0.4, tag: 'ground_patch' });
  }
  for (const l of spec.lips || []) {
    makeBox(grp, l.w, l.h, l.d, l.at[0], l.h / 2 + 0.1, l.at[1],
      resolveMat(l.mat || 'redrock'), { recv: true, name: 'Shore lip' });
  }
  for (const b of spec.backstops || []) {
    buildBackstop({ ...b, parent: grp });
  }
  return grp;
}

// =============================================================================
// SECTION 11 — PREFAB REGISTRATION
// =============================================================================
/**
 * Expose every terrain/water builder as a prefab id the layout already uses.
 * worldRuntime calls this once at boot, before placing TERRAIN / WATER rows.
 */
export function registerTerrainPrefabs() {
  const P = (row) => row.parent || worldRoot;

  registerBuilder('terrain_plane', (row) => buildTerrainPlane(row), {
    params: ['at', 'w', 'd', 'seg', 'surface', 'repeat', 'color', 'roughness', 'splat'],
    doc: 'Flat tiled ground, sculptable.'
  });
  registerBuilder('terrain_heightfield', (row) => buildHeightfield(row), {
    params: ['at', 'w', 'd', 'seg', 'mode', 'cast', 'roughness'],
    doc: 'mode: mountains|alpine|hills|jungle|woods|cove|desert|north|range'
  });
  registerBuilder('terrain_bed', (row) => buildTerrainBed(row), {
    params: ['at', 'w', 'd', 'seg', 'depth', 'top', 'surface', 'color'],
    doc: 'Parabolic channel bed across the narrow axis.'
  });
  registerBuilder('terrain_skirt', (row) => buildTerrainSkirt(row), {
    params: ['at', 'w', 'd', 'top', 'bottom', 'mat']
  });
  registerBuilder('ground_patch', (row) => buildGroundPatch(row), {
    params: ['bounds', 'y', 'surface', 'thick', 'tag'], doc: 'Solid shore / gap patch.'
  });
  registerBuilder('backstop', (row) => buildBackstop(row), {
    params: ['bounds', 'y', 'color'], doc: 'Visual-only void guarantee.'
  });
  registerBuilder('water_surface', (row) => buildWaterSurfaceRow(row), {
    params: ['bounds', 'y', 'bed', 'wave', 'current', 'ocean', 'seg', 'shallow', 'deep', 'foam'],
    doc: 'bed: ocean|woods|jungle | {top,depth,axis,center,halfW} | fn'
  });
  registerBuilder('river_system', (row) => buildRiverRow(row), {
    params: ['center', 'z', 'halfW', 'lift', 'wave', 'current', 'flow', 'step', 'segment', 'mapStep', 'keepoutStep'],
    doc: 'center: riverX|frostCreekX|roadC|fn'
  });
  registerBuilder('ocean_seabed', (row) => buildOceanSeabed(P(row)), { params: [] });

  registerBuilder('bridge_river', (row) => {
    const { x, z } = resolveRowXZ(row);
    let deckY = row.deckY;
    if (typeof deckY === 'string') {
      const m = /^river([+-]\d+(?:\.\d+)?)?$/.exec(deckY.trim());
      deckY = riverSurfaceAt(row.river, z) + (m && m[1] ? Number(m[1]) : 0.3);
    }
    if (!Number.isFinite(deckY)) deckY = Math.max(terrainH(x, z), 0.26) + 0.5;
    const span = row.span ?? 16, deckW = row.deckW ?? 4.4;
    const rec = buildRiverBridge(P(row), x, z, deckY, span, { stone: !!row.stone, deckW });
    if (row.approachRamps) buildBridgeApproaches(P(row), x, z, deckY, span, row.deckW ?? 5.2);
    return { object: null, boxes: [], anchors: { deck: [x, deckY, z] }, ...rec };
  }, { params: ['at', 'deckY', 'span', 'deckW', 'stone', 'approachRamps'] });

  registerBuilder('prop_log', (row) => {
    const { x, z } = resolveRowXZ(row);
    return spawnRiverLog(P(row), x, z, row.id);
  }, { params: ['at', 'floating'] });

  registerBuilder('prop_buoy', (row) => {
    const { x, z } = resolveRowXZ(row);
    return buildChannelBuoy(P(row), x, z, row.color ?? 0xdc2626);
  }, { params: ['at', 'color'] });

  registerBuilder('prop_rowboat', (row) => {
    const { x, z } = resolveRowXZ(row);
    return buildRowboat(P(row), x, z, row.hull ?? 0x926c44, row.id);
  }, { params: ['at', 'hull'] });

  registerBuilder('prop_sailboat', (row) => {
    const { x, z } = resolveRowXZ(row);
    return buildSailboat(P(row), x, z, row.ry ?? 0);
  }, { params: ['at', 'ry'] });

  return 14;
}

// =============================================================================
// SECTION 12 — RESET / DISPOSAL
// =============================================================================
/** Per-rebuild reset. GPU resources go with disposeTree() in worldRuntime. */
export function resetTerrain() {
  sculptableTerrainMeshes.length = 0;
  riverFlowMats.length = 0;
  riverById.clear();
  lastRiver = null;
  coordWarned.clear();
}

/**
 * Full teardown of module-owned caches. Call alongside kit.disposeKit(),
 * because the blend materials reference the kit's ground textures.
 */
export function disposeTerrain() {
  resetTerrain();
  for (const m of blendCache.values()) m.dispose();
  blendCache.clear();
  if (plainVertexMat) { plainVertexMat.dispose(); plainVertexMat = null; }
}

export default {
  frostCreekX, coord, resolveRowXZ, maxTerrainOver,
  sculptableTerrainMeshes, registerSculptableTerrain, refreshTerrainSculpt,
  makeTerrainBlendMaterial, paintTerrainSplat, paintMeshTerrainSplat,
  buildTerrainPlane, buildHeightfield, buildTerrainBed, buildTerrainSkirt,
  buildGroundPatch, buildBackstop,
  ribbonGeometry, loopNormals,
  buildRiverSystem, riverSurfaceAt, updateRiverFlow,
  buildWaterSurfaceRow, buildRiverRow,
  buildRiverBridge, buildBridgeApproaches,
  spawnRiverLog, buildChannelBuoy, buildRowboat, buildSailboat,
  buildGroundIntegrity, registerTerrainPrefabs, resetTerrain, disposeTerrain
};