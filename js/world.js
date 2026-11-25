// =============================================================================
// world.js — Grand Theft Aura (refactored)
// Roads, continuous I-88, biomes, walk-in interiors, data-driven skyscrapers,
// Aura Hills, sewers, Los Aura expansion, LAX, AURA ARMORY, entity spawner.
//
// ARCHITECTURE
//   • ONE shared UNIT_BOX geometry; every static box is a scaled mesh of it.
//   • makeBox() carries EXPLICIT shadow flags and EXPLICIT collider specs —
//     nothing is auto-derived, so gameplay is bit-identical to the original.
//   • Districts, blocks and props are config/data driven: future map growth
//     (2× footprint, more detail) is new data rows, not new builder code.
//   • RNG consumption order and builder order are frozen — the seeded world
//     lays out identically on every build.
//   • Studio paths are stable, name-based keys at the landmark root level.
// =============================================================================
import * as THREE from 'three';
import { colorToHex, levelData, terrainHeightOffset } from './levelData.js';
import {
  AHC, I88, MAX_HOTDOG_AMMO, SFY, WORLD_BOUNDS, addDriveableRamp, addWorldBox, ahRy, ahRz, ahRzD,
  aura, aviationBeacons, biomeAt, buildingLods, collidesHorizontally, crime, driveableRamps,
  enterableZones, fbm, gameState, hazardBarrels, hillsH, hooks, iceZones, isInWater, keys, lampPosts,
  manholeCovers, manholeHoles, manholeOpen, manholes, mapShapes, pick, player, pushFeed,
  recomputeWorldBounds, registerBuildingLod, resetWorldState, riverX, rnd, roadC, roadH,
  sRects, sausageRefillZones, skyscrapers, smashableCrates, sstep, terrainBaseH, terrainH,
  under, waterZones, worldBoxes, worldPickups
} from './state.js';
import {
  camera, highDetailObjects, makeMat, realWindowGlassMat, regHigh, scene, worldRoot
} from './engine.js';
import { applyEntityColor, applyEntityTexture, applyModelPreset, loadTexture } from './assets.js';
import { sfx } from './audio.js';
import {
  RIGHT_WEAPONS, buildBarrelMesh, buildCrateMesh, buildPickupMesh, spawnHazardBarrel,
  spawnParticles, spawnSmashCrate, spawnWorldPickup
} from './items.js';
import { buildSportsCar, buildSportsCarMesh, vehicles } from './vehicles.js';
import {
  buildOceanSeabed, createWaterSurface, getOceanBedY, getWaterDepthAt, getWaterHeightAt,
  isSwimming, registerFloatingProp, resetWaterSystem, swimState, updateWater, waterBodies
} from './water.js';

export const rockMat = new THREE.MeshStandardMaterial({ color: 0x5a554d, roughness: 1, flatShading: true });
export const pipeMat = new THREE.MeshStandardMaterial({ color: 0x6f7f77, roughness: .8, metalness: .35, side: THREE.BackSide });
const treeBarkTexture = loadTexture('assets/textures/bark.png', { repeatX: 1, repeatY: 4 });
const treeLeafTexture = loadTexture('assets/textures/lushfoliage.png', { repeatX: 2, repeatY: 2 });
const treeBarkMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, map: treeBarkTexture, roughness: 0.92, flatShading: true });
const treeLeafMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, map: treeLeafTexture, roughness: 0.88, flatShading: true, side: THREE.DoubleSide, alphaTest: 0.35 });
treeBarkMaterial.userData.shared = true;
treeLeafMaterial.userData.shared = true;
rockMat.userData.shared = true;

// =============================================================================
// SHARED BUILD TOOLKIT
// =============================================================================
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
UNIT_BOX.userData.shared = true;

/**
 * makeBox(parent, w, h, d, x, y, z, material, opts)
 * opts: {
 *   cast, recv          — explicit shadow flags (defaults false/false)
 *   rx, ry, rz          — rotation
 *   order               — renderOrder
 *   name                — userData.studioName
 *   box: ['tag', climbable]                      — centered AABB from dims
 *      | [x0,x1,y0,y1,z0,z1,'tag',climbable]     — explicit world AABB
 * }
 * Colliders are ALWAYS explicit data; never inferred from geometry.
 */
function makeBox(parent, w, h, d, x, y, z, material, o = {}) {
  const m = new THREE.Mesh(UNIT_BOX, material);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  if (o.rx) m.rotation.x = o.rx;
  if (o.ry) m.rotation.y = o.ry;
  if (o.rz) m.rotation.z = o.rz;
  m.castShadow = !!o.cast;
  m.receiveShadow = !!o.recv;
  if (o.order !== undefined) m.renderOrder = o.order;
  if (o.name) m.userData.studioName = o.name;
  parent.add(m);
  if (o.box) {
    const b = o.box;
    if (b.length === 2) addWorldBox(x - w / 2, x + w / 2, y - h / 2, y + h / 2, z - d / 2, z + d / 2, b[0], b[1]);
    else addWorldBox(b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]);
  }
  return m;
}

/** Compound landmark builder. parts: [w,h,d, dx,dy,dz, material, opts?]; dx/dz relative to (bx,bz), dy to by. */
function buildCompound(parent, bx, bz, parts, by = 0) {
  const out = [];
  for (const p of parts) out.push(makeBox(parent, p[0], p[1], p[2], bx + p[3], by + p[4], bz + p[5], p[6], p[7] || {}));
  return out;
}

/** Instance-matrix accumulator (shared dummy — sequential use only). */
const _dm = new THREE.Object3D();
function xform(list, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  _dm.position.set(x, y, z);
  _dm.rotation.set(rx, ry, rz);
  _dm.scale.set(sx, sy, sz);
  _dm.updateMatrix();
  list.push(_dm.matrix.clone());
}
function flushInstances(parent, geo, material, transforms, { cast = false, recv = false } = {}) {
  if (!transforms.length) return null;
  const im = new THREE.InstancedMesh(geo, material, transforms.length);
  transforms.forEach((m, i) => im.setMatrixAt(i, m));
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = cast;
  im.receiveShadow = recv;
  parent.add(im);
  return im;
}

/** Squared planar distance — hot-loop threshold checks (no sqrt). */
function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

/** Prop registry — add a row here, place it anywhere with placeProps(type, coords). */
const PROP_BUILDERS = {
  lamppost: ([x, z]) => buildKnockableLamppost(x, z),
  tree: ([x, z, s = 1, y = 0.18]) => createTree(x, z, s, y),
  hydrant: ([x, z]) => createHydrant(x, z),
  shelter: ([x, z, r = 0]) => createBusShelter(x, z, r)
};
function placeProps(type, coords) { for (const c of coords) PROP_BUILDERS[type](c); }

// -----------------------------------------------------------------------------
// Real ground textures
// -----------------------------------------------------------------------------
const GROUND_TEXTURES = {
  grass: loadTexture('assets/textures/grass.png', { repeatX: 1, repeatY: 1 }),
  dirt: loadTexture('assets/textures/dirt.png', { repeatX: 1, repeatY: 1 }),
  rock: loadTexture('assets/textures/rock.png', { repeatX: 1, repeatY: 1 }),
  sand: loadTexture('assets/textures/sand.png', { repeatX: 1, repeatY: 1 }),
  concrete: loadTexture('assets/textures/concrete.png', { repeatX: 1, repeatY: 1 })
};
for (const tex of Object.values(GROUND_TEXTURES)) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
}
const groundMatCache = new Map();
/** Simple tiled ground material for flat / mostly-single-surface ground. */
function makeGroundMat(kind, { color = 0xffffff, repeatX = 1, repeatY = 1, roughness = 0.95, metalness = 0 } = {}) {
  const key = `${kind}|${color}|${repeatX}|${repeatY}|${roughness}|${metalness}`;
  if (groundMatCache.has(key)) return groundMatCache.get(key);
  const tex = GROUND_TEXTURES[kind].clone();
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  const mat = new THREE.MeshStandardMaterial({ color, map: tex, roughness, metalness });
  groundMatCache.set(key, mat);
  return mat;
}

// -----------------------------------------------------------------------------
// Seamless natural-terrain blending: grass / dirt / rock / sand / concrete
// -----------------------------------------------------------------------------
function makeTerrainBlendMaterial({ roughness = 1, metalness = 0 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness, metalness });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGrass = { value: GROUND_TEXTURES.grass };
    shader.uniforms.uDirt = { value: GROUND_TEXTURES.dirt };
    shader.uniforms.uRock = { value: GROUND_TEXTURES.rock };
    shader.uniforms.uSand = { value: GROUND_TEXTURES.sand };
    shader.uniforms.uConcrete = { value: GROUND_TEXTURES.concrete };
    shader.uniforms.uGrassScale = { value: new THREE.Vector2(0.12, 0.12) };
    shader.uniforms.uDirtScale = { value: new THREE.Vector2(0.10, 0.10) };
    shader.uniforms.uRockScale = { value: new THREE.Vector2(0.06, 0.06) };
    shader.uniforms.uSandScale = { value: new THREE.Vector2(0.14, 0.14) };
    shader.uniforms.uConcreteScale = { value: new THREE.Vector2(0.08, 0.08) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 terrainSplat;
        attribute float terrainConcrete;
        varying vec4 vSplat;
        varying float vConcrete;
        varying vec2 vGroundXZ;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSplat = terrainSplat;
        vConcrete = terrainConcrete;
        vGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uGrass;
        uniform sampler2D uDirt;
        uniform sampler2D uRock;
        uniform sampler2D uSand;
        uniform sampler2D uConcrete;
        uniform vec2 uGrassScale;
        uniform vec2 uDirtScale;
        uniform vec2 uRockScale;
        uniform vec2 uSandScale;
        uniform vec2 uConcreteScale;
        varying vec4 vSplat;
        varying float vConcrete;
        varying vec2 vGroundXZ;`)
      .replace('#include <map_fragment>', `
        vec2 groundUV = vGroundXZ;
        vec3 grassCol = texture2D(uGrass, groundUV * uGrassScale).rgb;
        vec3 dirtCol  = texture2D(uDirt,  groundUV * uDirtScale).rgb;
        vec3 rockCol  = texture2D(uRock,  groundUV * uRockScale).rgb;
        vec3 sandCol  = texture2D(uSand,  groundUV * uSandScale).rgb;
        vec3 concCol  = texture2D(uConcrete, groundUV * uConcreteScale).rgb;
        float total = vSplat.x + vSplat.y + vSplat.z + vSplat.w + vConcrete + 0.0001;
        vec3 blendedGround =
          grassCol * vSplat.x +
          dirtCol  * vSplat.y +
          rockCol  * vSplat.z +
          sandCol  * vSplat.w +
          concCol  * vConcrete;
        blendedGround /= total;
        diffuseColor.rgb *= blendedGround;
      `);
  };
  mat.customProgramCacheKey = () => 'aura-terrain-blend-v1';
  return mat;
}

/** Paints per-vertex grass/dirt/rock/sand/concrete weights onto a terrain geometry. */
function paintTerrainSplat(geometry, mode, offsetX = 0, offsetZ = 0) {
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
function paintMeshTerrainSplat(mesh, mode) {
  paintTerrainSplat(mesh.geometry, mode, mesh.position.x, mesh.position.z);
  mesh.userData.terrainSplatMode = mode;
}

/** Studio road entities superseded by the built-in continuous I-88 viaduct. */
const RETIRED_ENTITY_IDS = new Set(['road_mwr8epy21', 'road_mwr8fxyy2', 'road_mwsebg0p1']);

/** Roots that existed before the first world build survive every rebuild. */
let foreignRoots = null;

// Water-system frame guard
let lastWaterFrame = -Infinity;
function updateWaterOnce(dt, elapsed) {
  if (elapsed === lastWaterFrame) return;
  lastWaterFrame = elapsed;
  updateWater(dt, elapsed);
}

// -----------------------------------------------------------------------------
// Terrain sculpting
// -----------------------------------------------------------------------------
export const sculptableTerrainMeshes = [];
function registerSculptableTerrain(mesh) {
  const positions = mesh.geometry.attributes.position;
  mesh.userData.terrainBaseY = Float32Array.from(positions.array.filter((_, index) => index % 3 === 1));
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
/** Update visible terrain meshes after a sculpt stroke or undo/redo. */
export function refreshTerrainSculpt(centerX = null, centerZ = null, radius = Infinity, onlyMesh = null) {
  const meshes = onlyMesh ? [onlyMesh] : sculptableTerrainMeshes;
  for (const mesh of meshes) {
    const positions = mesh.geometry.attributes.position;
    const baseY = mesh.userData.terrainBaseY;
    const partial = Number.isFinite(radius);
    const bounds = mesh.userData.terrainBounds;
    if (partial && (centerX + radius < bounds.minX - 3 || centerX - radius > bounds.maxX + 3
      || centerZ + radius < bounds.minZ - 3 || centerZ - radius > bounds.maxZ + 3)) continue;
    const r2 = (radius + 3) * (radius + 3);
    let changed = false;
    for (let i = 0; i < positions.count; i++) {
      const x = mesh.position.x + positions.getX(i), z = mesh.position.z + positions.getZ(i);
      if (partial && dist2(x, z, centerX, centerZ) > r2) continue;
      positions.setY(i, baseY[i] + terrainHeightOffset(x, z));
      changed = true;
    }
    if (changed) {
      positions.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingSphere();
      if (mesh.userData.terrainSplatMode) {
        paintTerrainSplat(mesh.geometry, mesh.userData.terrainSplatMode, mesh.position.x, mesh.position.z);
      }
    }
  }
}
function terrainPlane(width, depth, x, y, z, material) {
  const geometry = new THREE.PlaneGeometry(width, depth, Math.ceil(width / 2), Math.ceil(depth / 2));
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  registerSculptableTerrain(mesh);
  return mesh;
}
/** Highest natural ground over a rectangular footprint (for founding buildings). */
function maxTerrainOver(x0, x1, z0, z1) {
  let m = -Infinity;
  for (const x of [x0, (x0 + x1) / 2, x1]) {
    for (const z of [z0, (z0 + z1) / 2, z1]) m = Math.max(m, terrainH(x, z));
  }
  return m;
}

// -----------------------------------------------------------------------------
// Walls & windows
// -----------------------------------------------------------------------------
/** Wall segment with a real rectangular window cutout, glass on both faces. */
export function buildWallWithRealWindow(parent, width, height, thick, winW, winH, winCenterY, wallMat, addMullions = true) {
  const group = new THREE.Group();
  const sideW = Math.max(0.1, (width - winW) / 2);
  const botH = Math.max(0.1, winCenterY - winH / 2);
  const topH = Math.max(0.1, height - (winCenterY + winH / 2));
  makeBox(group, sideW, height, thick, -(winW / 2 + sideW / 2), height / 2, 0, wallMat, { cast: true, recv: true });
  makeBox(group, sideW, height, thick, winW / 2 + sideW / 2, height / 2, 0, wallMat, { cast: true, recv: true });
  makeBox(group, winW, botH, thick, 0, botH / 2, 0, wallMat, { cast: true, recv: true });
  makeBox(group, winW, topH, thick, 0, winCenterY + winH / 2 + topH / 2, 0, wallMat, { cast: true });
  const paneGeo = new THREE.PlaneGeometry(winW, winH);
  const glassOut = new THREE.Mesh(paneGeo, realWindowGlassMat);
  glassOut.position.set(0, winCenterY, 0.012);
  const glassIn = new THREE.Mesh(paneGeo, realWindowGlassMat);
  glassIn.position.set(0, winCenterY, -0.012);
  glassIn.rotation.y = Math.PI;
  makeBox(group, winW + 0.16, 0.08, thick + 0.12, 0, winCenterY - winH / 2, 0, makeMat(0xf8fafc));
  group.add(glassOut, glassIn);
  if (addMullions) {
    makeBox(group, winW, 0.05, 0.06, 0, winCenterY, 0, makeMat(0xf8fafc));
    makeBox(group, 0.05, winH, 0.06, 0, winCenterY, 0, makeMat(0xf8fafc));
  }
  parent.add(group);
  return group;
}

// -----------------------------------------------------------------------------
// Neon signs — auto-fitting text, cached by text + colours
// -----------------------------------------------------------------------------
const signCache = new Map();
export function createNeonSign(parent, text, x, y, z, bgHex, textHex, w = 4.4, h = 1.1) {
  const key = `${text}|${bgHex}|${textHex}`;
  let cached = signCache.get(key);
  if (!cached) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bgHex;
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = textHex;
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, 500, 116);
    ctx.fillStyle = textHex;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let fontSize = 42;
    for (;;) {
      ctx.font = `bold ${fontSize}px Oswald, sans-serif`;
      if (ctx.measureText(text).width <= 476 || fontSize <= 14) break;
      fontSize -= 2;
    }
    ctx.fillText(text, 256, 66);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const faceMat = new THREE.MeshStandardMaterial({
      map: tex, emissive: new THREE.Color(textHex), emissiveMap: tex,
      emissiveIntensity: 0.75, roughness: 0.25, metalness: 0.4
    });
    const sideMat = makeMat(colorToHex(bgHex, 0x0f172a), { roughness: 0.4, metalness: 0.5 });
    faceMat.userData.shared = true;
    sideMat.userData.shared = true;
    cached = { faceMat, sideMat };
    signCache.set(key, cached);
  }
  const { faceMat, sideMat } = cached;
  return makeBox(parent, w, h, 0.22, x, y, z,
    [sideMat, sideMat, sideMat, sideMat, faceMat, faceMat], { name: `Sign: ${text}` });
}
/** GPU-leak fix: sign face textures/materials are cache-owned, so the world
 *  disposal pass skips them — dispose them explicitly on rebuild. */
function disposeSignCache() {
  for (const { faceMat } of signCache.values()) {
    if (faceMat.map) faceMat.map.dispose();
    faceMat.dispose();
  }
  signCache.clear();
}

// =============================================================================
// SHARED RIBBON / RIVER / SCENIC-ROAD TOOLKIT
// =============================================================================
const riverFlowMats = [];
const frostCreekX = (z) => -420 + Math.sin(z * 0.05) * 30 + Math.sin(z * 0.017 + 1.3) * 18;

function ribbonGeometry(pts, halfWidth, yAt, { cols = [-1, 1], offset = 0, uvScale = 8, colorAt = null } = {}) {
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
        idx.push(a + j, a + j + cols.length, a + j + 1, a + j + 1, a + j + cols.length, a + j + cols.length + 1);
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

function buildRiverSystem({
  id, parent = worldRoot, centerX, z0, z1, halfWidth = 5, step = 3, lift = 0.24,
  waveScale = 0.14, currentX = 0, currentZ = 0.8,
  shallowColor = 0x67e8f9, deepColor = 0x0c4a6e, foamColor = 0xe0f2fe,
  flowSpeed = 0.4, segment = 8
}) {
  const pts = [];
  for (let z = z0; z <= z1 + 0.001; z += step) {
    const cx = centerX(z);
    pts.push(new THREE.Vector3(cx, Math.max(terrainH(cx, z), 0.26) + lift, z));
  }
  const smoothed = pts.map((p, i) =>
    (pts[Math.max(0, i - 1)].y + p.y * 2 + pts[Math.min(pts.length - 1, i + 1)].y) / 4);
  pts.forEach((p, i) => { p.y = smoothed[i]; });
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
  return { pts, surfAt };
}

function buildRiverBridge(parent, cx, z, deckY, span, { stone = false, deckW = 4.4 } = {}) {
  const mat = stone
    ? makeMat(0x9aa0a6, { texType: 'cobblestone', repeatX: 5, repeatY: 2, roughness: 0.9 })
    : makeMat(0x78350f, { texType: 'wood', repeatX: 5, repeatY: 2 });
  makeBox(parent, span, 0.26, deckW, cx, deckY - 0.13, z, mat, {
    cast: true, recv: true, name: stone ? 'Stone arch bridge' : 'River footbridge',
    box: [cx - span / 2, cx + span / 2, deckY - 0.26, deckY, z - deckW / 2, z + deckW / 2, stone ? 'stone_bridge' : 'river_bridge', true]
  });
  for (const s of [-1, 1]) {
    makeBox(parent, span, 0.8, 0.2, cx, deckY + 0.4, z + s * (deckW / 2 - 0.1), mat, {
      cast: true,
      box: [cx - span / 2, cx + span / 2, deckY, deckY + 0.8,
        z + s * (deckW / 2 - 0.1) - 0.1, z + s * (deckW / 2 - 0.1) + 0.1, 'bridge_rail', true]
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
}

function spawnRiverLog(parent, x, z) {
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 3.6, 7), treeBarkMaterial);
  log.rotation.z = Math.PI / 2;
  log.rotation.y = rnd() * Math.PI;
  log.position.set(x, 0.4, z);
  log.castShadow = true;
  log.userData.studioName = 'Drifting log';
  parent.add(log);
  registerFloatingProp(log, x, z, 0.02, 0.5);
}

function buildChannelBuoy(parent, x, z, hex = 0xdc2626) {
  const g = new THREE.Group();
  g.position.set(x, 0.3, z);
  g.userData.studioName = 'Channel buoy';
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 0.5, 10), makeMat(hex, { roughness: 0.5, metalness: 0.4 }));
  base.position.y = 0.25;
  base.castShadow = true;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 10), makeMat(hex, { roughness: 0.5, metalness: 0.4 }));
  cone.position.y = 0.95;
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
  light.position.y = 1.5;
  g.add(base, cone, light);
  parent.add(g);
  registerFloatingProp(g, x, z, 0.02, 1.1);
}

function buildRowboat(parent, x, z, hullHex = 0x926c44) {
  const g = new THREE.Group();
  g.position.set(x, 0.3, z);
  g.rotation.y = rnd() * Math.PI * 2;
  g.userData.studioName = 'Rowboat';
  makeBox(g, 1.3, 0.5, 3.2, 0, 0, 0, makeMat(hullHex, { texType: 'wood', repeatX: 1, repeatY: 3 }), { cast: true });
  makeBox(g, 1.5, 0.12, 3.4, 0, 0.28, 0, makeMat(0x57534e));
  const seatMat = makeMat(0xb45309, { texType: 'wood' });
  makeBox(g, 1.1, 0.08, 0.4, 0, 0.22, 0.7, seatMat);
  makeBox(g, 1.1, 0.08, 0.4, 0, 0.22, -0.7, seatMat);
  parent.add(g);
  registerFloatingProp(g, x, z, 0.12, 0.95);
}

// -----------------------------------------------------------------------------
// FROSTPINE NATIONAL PARK — scenic loop road
// -----------------------------------------------------------------------------
function buildFrostpineLoopRoad(grp, keep) {
  const loopPts = [
    [-92, 130], [-170, 120], [-268, 116], [-372, 122], [-470, 130],
    [-566, 132], [-664, 138], [-678, 190], [-672, 248], [-612, 286],
    [-508, 302], [-388, 308], [-262, 300], [-158, 278], [-96, 236], [-76, 184]
  ];
  const curve = new THREE.CatmullRomCurve3(loopPts.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'catmullrom', 0.5);
  const N = 420;
  const pts = curve.getSpacedPoints(N);
  for (const p of pts) p.y = terrainH(p.x, p.z);
  const sm = pts.map((p, i) => {
    const a = pts[(i - 2 + pts.length) % pts.length].y, b = pts[(i - 1 + pts.length) % pts.length].y;
    const c = pts[(i + 1) % pts.length].y, d = pts[(i + 2) % pts.length].y;
    return (a + b * 2 + p.y * 4 + c * 2 + d) / 10;
  });
  pts.forEach((p, i) => { p.y = sm[i]; });
  const ROAD_DY = 0.12, HW = 4.5;
  const normalAt = (i) => {
    const prev = pts[(i - 1 + pts.length) % pts.length], next = pts[(i + 1) % pts.length];
    const tx = next.x - prev.x, tz = next.z - prev.z, l = Math.hypot(tx, tz) || 1;
    return { nx: tz / l, nz: -tx / l, yaw: Math.atan2(tx, tz) };
  };
  const asphalt = makeMat(0x2b3138, { texType: 'asphalt', repeatX: 2, repeatY: 1, roughness: 0.86, bumpScale: 0.015 });
  if (asphalt.map) { asphalt.map.wrapS = asphalt.map.wrapT = THREE.RepeatWrapping; }
  const road = new THREE.Mesh(ribbonGeometry(pts, HW, (p) => p.y + ROAD_DY, { uvScale: 9 }), asphalt);
  road.receiveShadow = true;
  road.userData.studioName = 'Frostpine Loop Road';
  grp.add(road);
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0xf1f5f9, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    grp.add(new THREE.Mesh(
      ribbonGeometry(pts, 0.11, (p) => p.y + ROAD_DY + 0.02, { offset: s * (HW - 0.35) }), edgeMat));
  }
  const dashT = [];
  for (let i = 0; i < pts.length - 1; i += 2) {
    const p = pts[i], { nx, nz, yaw } = normalAt(i);
    for (const off of [-0.28, 0.28]) {
      xform(dashT, p.x + nx * off, p.y + ROAD_DY + 0.03, p.z + nz * off, 1, 1, 1, 0, yaw, 0);
    }
  }
  flushInstances(grp, new THREE.BoxGeometry(0.2, 0.04, 3.4), new THREE.MeshBasicMaterial({ color: 0xfacc15 }), dashT);
  const railMat = makeMat(0xcbd5e1, { texType: 'brushedsteel', metalness: 0.85, roughness: 0.3, flatShading: false });
  const postGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.95, 6);
  let railBeams = 0;
  for (const side of [-1, 1]) {
    let prevStation = null;
    for (let i = 0; i < pts.length - 1; i += 2) {
      const p = pts[i], { nx, nz } = normalAt(i);
      const ex = p.x + nx * side * (HW + 0.35), ez = p.z + nz * side * (HW + 0.35);
      const drop = p.y - terrainH(p.x + nx * side * (HW + 3.2), p.z + nz * side * (HW + 3.2));
      if (drop > 2.3 && railBeams < 190) {
        const post = new THREE.Mesh(postGeo, railMat);
        post.position.set(ex, p.y + ROAD_DY + 0.45, ez);
        post.castShadow = true;
        grp.add(post);
        if (prevStation && i - prevStation.i <= 4) {
          const a = prevStation;
          const len = Math.hypot(ex - a.x, ez - a.z) + 0.3;
          makeBox(grp, 0.26, 0.55, len, (ex + a.x) / 2, (p.y + a.y) / 2 + ROAD_DY + 0.72, (ez + a.z) / 2, railMat, {
            cast: true, ry: Math.atan2(ex - a.x, ez - a.z),
            box: [Math.min(ex, a.x) - 0.3, Math.max(ex, a.x) + 0.3,
              Math.min(p.y, a.y) + ROAD_DY + 0.1, Math.max(p.y, a.y) + ROAD_DY + 1.0,
              Math.min(ez, a.z) - 0.3, Math.max(ez, a.z) + 0.3, 'guardrail', true]
          });
          railBeams++;
        }
        prevStation = { i, x: ex, z: ez, y: p.y };
      } else {
        prevStation = null;
      }
    }
  }
  const pullouts = [
    { f: 0.16, name: 'GLACIER POINT VISTA' },
    { f: 0.46, name: 'FROSTPINE VALLEY VIEW' },
    { f: 0.78, name: 'CASCADE OVERLOOK' }
  ];
  const benchWood = makeMat(0xb45309, { texType: 'wood' });
  for (const po of pullouts) {
    const i = Math.floor(po.f * N) % pts.length;
    const p = pts[i], { nx, nz, yaw } = normalAt(i);
    const dropL = p.y - terrainH(p.x + nx * 9, p.z + nz * 9);
    const dropR = p.y - terrainH(p.x - nx * 9, p.z - nz * 9);
    const side = dropL >= dropR ? 1 : -1;
    const cx = p.x + nx * side * (HW + 3.2), cz = p.z + nz * side * (HW + 3.2);
    makeBox(grp, 6.4, 0.12, 9, cx, p.y + ROAD_DY - 0.02, cz,
      makeMat(0x3a4048, { texType: 'asphalt', repeatX: 2, repeatY: 3, roughness: 0.88 }), {
        recv: true, ry: yaw, name: `Pullout: ${po.name}`,
        box: [cx - 4.6, cx + 4.6, p.y + ROAD_DY - 0.14, p.y + ROAD_DY + 0.04, cz - 4.6, cz + 4.6, 'vista_pullout', true]
      });
    const ox = p.x + nx * side * (HW + 5.4), oz = p.z + nz * side * (HW + 5.4);
    makeBox(grp, 2.2, 0.12, 0.7, ox, p.y + 0.62, oz, benchWood, { cast: true, ry: yaw });
    for (const s of [-1, 1]) {
      makeBox(grp, 0.12, 0.45, 0.6, ox + Math.cos(yaw) * s * 0.9, p.y + 0.38, oz - Math.sin(yaw) * s * 0.9, railMat, { ry: yaw });
    }
    const scopePole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 1.15, 8), railMat);
    scopePole.position.set(ox + Math.cos(yaw) * 2.2, p.y + 0.7, oz - Math.sin(yaw) * 2.2);
    const scopeHead = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.55, 8), makeMat(0x1e293b, { metalness: 0.8, roughness: 0.3 }));
    scopeHead.rotation.x = Math.PI / 2 - 0.35;
    scopeHead.rotation.y = yaw;
    scopeHead.position.set(scopePole.position.x, p.y + 1.35, scopePole.position.z);
    grp.add(scopePole, scopeHead);
    const signG = new THREE.Group();
    signG.position.set(p.x + nx * side * (HW + 1.4), p.y, p.z + nz * side * (HW + 1.4));
    signG.rotation.y = Math.atan2(-nx * side, -nz * side);
    const signPostMat = makeMat(0x57534e, { texType: 'wood' });
    for (const s of [-1, 1]) makeBox(signG, 0.18, 2.3, 0.18, s * 1.9, 1.15, 0, signPostMat, { cast: true });
    createNeonSign(signG, po.name, 0, 2.15, 0, '#1c1917', '#fcd34d', 4.4, 0.85);
    grp.add(signG);
    keep.push({ x: cx, z: cz, r: 8 });
    mapShapes.push({ x: cx, z: cz, w: 8, d: 8, color: '#475569', border: '#fcd34d', enterable: false });
  }
  for (const f of [0.3, 0.62]) {
    const i = Math.floor(f * N) % pts.length;
    const p = pts[i], { nx, nz } = normalAt(i);
    const sx = p.x - nx * (HW + 1.1), sz = p.z - nz * (HW + 1.1);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.1, 6), railMat);
    post.position.set(sx, p.y + 1.05, sz);
    grp.add(post);
    makeBox(grp, 0.95, 0.95, 0.08, sx, p.y + 2.2, sz,
      makeMat(0xfacc15, { emissive: 0xca8a04, emissiveIntensity: 0.25 }), { rz: Math.PI / 4 });
    createNeonSign(grp, '25', sx, p.y + 2.2, sz + 0.06, '#facc15', '#1c1917', 0.62, 0.5);
  }
  return { pts, normalAt, ROAD_DY, HW };
}

// =============================================================================
// I-88 INTERSTATE
// =============================================================================
function buildInterstate88() {
  const F = I88;
  const X = F.x, HW = F.halfW, W = HW * 2;
  const RAIL_X = HW - 0.35;
  const grp = new THREE.Group();
  grp.userData.studioName = 'I-88 Interstate';
  worldRoot.add(grp);
  const fwyMat = makeMat(0x1f2937, { texType: 'asphalt', repeatX: 4, repeatY: 90, roughness: 0.84, bumpScale: 0.015 });
  const deckMat = makeMat(0x27303d, { texType: 'concrete', repeatX: 4, repeatY: 40, roughness: 0.86 });
  const barrierMat = makeMat(0xd1d5db, { texType: 'concrete', repeatX: 24, repeatY: 1, roughness: 0.88 });
  const steelMat = makeMat(0xe2e8f0, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.18, flatShading: false });
  const towerMat = makeMat(0xdc2626, { metalness: 0.65, roughness: 0.32 });
  const yellowMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
  const studMat = new THREE.MeshBasicMaterial({ color: 0xffb020 });
  const box = (w, h, d, m, x, y, z, cast = false) => makeBox(grp, w, h, d, x, y, z, m, { cast, recv: true });

  const yellowT = [], whiteT = [], studT = [];
  const markings = (z0, z1, yAt, angle = 0) => {
    const mid = (z0 + z1) / 2, len = z1 - z0, ym = yAt(mid), lift = 0.035;
    for (const off of [-0.3, 0.3]) xform(yellowT, X + off, ym + lift, mid, 0.22, 0.05, len - 0.4, angle);
    for (const off of [-(HW - 0.9), HW - 0.9]) xform(whiteT, X + off, ym + lift, mid, 0.22, 0.05, len - 0.4, angle);
    for (let z = z0 + 4; z < z1 - 3; z += 8) {
      for (const off of [-5.5, 5.5]) xform(whiteT, X + off, yAt(z) + lift, z, 0.24, 0.05, 3.4, angle);
      xform(studT, X, yAt(z) + lift + 0.02, z, 0.2, 0.05, 0.2, angle);
    }
  };
  const flat = (z0, z1, y, thick = 0.14, m = fwyMat) => {
    box(W, thick, z1 - z0, m, X, y - thick / 2, (z0 + z1) / 2);
    addWorldBox(X - HW, X + HW, y - thick, y, z0, z1, 'i88_surface', true);
    markings(z0, z1, () => y, 0);
  };
  const ramp = (z0, z1, y0, y1) => {
    const run = z1 - z0, rise = y1 - y0;
    const hyp = Math.hypot(run, rise), ang = Math.atan2(rise, run);
    makeBox(grp, W, 0.4, hyp, X, (y0 + y1) / 2 - 0.2, (z0 + z1) / 2, fwyMat, { cast: true, recv: true, rx: -ang });
    addDriveableRamp({ minX: X - HW, maxX: X + HW, minZ: z0, maxZ: z1, startY: y0, endY: y1, axis: 'z', dir: 1 });
    const yAt = (z) => y0 + rise * ((z - z0) / run);
    markings(z0, z1, yAt, -ang);
    return yAt;
  };
  const slopedRail = (z0, z1, y0, y1) => {
    const run = z1 - z0, rise = y1 - y0;
    const hyp = Math.hypot(run, rise), ang = Math.atan2(rise, run);
    for (const s of [-1, 1]) {
      makeBox(grp, 0.7, 1.05, hyp, X + s * RAIL_X, (y0 + y1) / 2 + 0.52, (z0 + z1) / 2, barrierMat, { cast: true, recv: true, rx: -ang });
      addWorldBox(X + s * RAIL_X - 0.35, X + s * RAIL_X + 0.35,
        Math.min(y0, y1), Math.max(y0, y1) + 1.05, z0, z1, 'i88_rail', true);
    }
  };
  const flatRail = (z0, z1, y) => {
    for (const s of [-1, 1]) {
      box(0.7, 1.05, z1 - z0, barrierMat, X + s * RAIL_X, y + 0.52, (z0 + z1) / 2, true);
      addWorldBox(X + s * RAIL_X - 0.35, X + s * RAIL_X + 0.35, y, y + 1.05, z0, z1, 'i88_rail', true);
    }
  };
  const barrierRun = (z0, z1, y, openings) => {
    const cuts = openings
      .map((c) => [c - F.openingHalf, c + F.openingHalf])
      .filter(([a, b]) => a > z0 && b < z1)
      .sort((p, q) => p[0] - q[0]);
    const seg = (a, b) => {
      if (b - a < 0.5) return;
      for (const s of [-1, 1]) {
        box(0.6, 1.05, b - a, barrierMat, X + s * RAIL_X, y + 0.52, (a + b) / 2, true);
        addWorldBox(X + s * RAIL_X - 0.32, X + s * RAIL_X + 0.32, y - 0.05, y + 1.05, a, b, 'i88_barrier', true);
      }
    };
    let cursor = z0;
    for (const [a, b] of cuts) { seg(cursor, a); cursor = b; }
    seg(cursor, z1);
  };

  flat(F.southEnd, F.rampUpStart, F.groundY);
  barrierRun(F.southEnd, F.rampUpStart, F.groundY, F.westOpenings.concat(F.eastOpenings));
  ramp(F.rampUpStart, F.rampUpEnd, F.groundY, F.deckY);
  slopedRail(F.rampUpStart, F.rampUpEnd, F.groundY, F.deckY);
  flat(F.deckStart, F.deckEnd, F.deckY, 0.5, deckMat);
  flatRail(F.deckStart, F.deckEnd, F.deckY);
  for (let z = F.deckStart + 6; z <= F.deckEnd - 4; z += 18) {
    for (const s of [-1, 1]) {
      const px = X + s * 8.4;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.95, F.deckY - 0.5, 10), barrierMat);
      col.position.set(px, (F.deckY - 0.5) / 2, z);
      col.castShadow = true;
      grp.add(col);
      addWorldBox(px - 0.95, px + 0.95, 0.05, F.deckY - 0.5, z - 0.95, z + 0.95, 'i88_pillar', false);
    }
    box(W - 1.4, 0.55, 1.6, barrierMat, X, F.deckY - 0.72, z, true);
  }
  ramp(F.bridgeRampStart, F.bridgeRampEnd, F.deckY, F.bridgeY);
  slopedRail(F.bridgeRampStart, F.bridgeRampEnd, F.deckY, F.bridgeY);
  flat(F.bridgeStart, F.bridgeEnd, F.bridgeY, 0.65, deckMat);
  flatRail(F.bridgeStart, F.bridgeEnd, F.bridgeY);
  const towerTopY = 48.0;
  const towerZs = [248, 332];
  for (const tz of towerZs) {
    for (const s of [-1, 1]) {
      const tx = X + s * 11.6;
      box(3.4, F.bridgeY + 1.0, 4.4, barrierMat, tx, (F.bridgeY + 1.0) / 2, tz, true);
      const p0 = s < 0 ? tx - 1.7 : Math.max(tx - 1.7, X + HW);
      const p1 = s < 0 ? Math.min(tx + 1.7, X - HW) : tx + 1.7;
      addWorldBox(p0, p1, 0, F.bridgeY + 1.0, tz - 2.2, tz + 2.2, 'bridge_pier', false);
      box(1.6, towerTopY, 2.0, towerMat, tx, towerTopY / 2, tz, true);
      addWorldBox(p0, p1, F.bridgeY, towerTopY, tz - 1.05, tz + 1.05, 'bridge_tower', false);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
      beacon.position.set(tx, towerTopY + 0.4, tz);
      aviationBeacons.push(beacon);
      grp.add(beacon);
    }
    box(24.8, 1.8, 1.6, towerMat, X, 26.0, tz, true);
    box(24.8, 2.2, 1.8, towerMat, X, 44.5, tz, true);
  }
  const cableY = (z) => {
    if (z <= towerZs[0]) {
      const t = Math.max(0, (z - F.bridgeStart) / (towerZs[0] - F.bridgeStart));
      return F.bridgeY + 1.2 + (towerTopY - F.bridgeY - 2.0) * t * t;
    }
    if (z >= towerZs[1]) {
      const u = Math.max(0, (F.bridgeEnd - z) / (F.bridgeEnd - towerZs[1]));
      return F.bridgeY + 1.2 + (towerTopY - F.bridgeY - 2.0) * u * u;
    }
    const mid = (towerZs[0] + towerZs[1]) / 2;
    const u = (z - mid) / ((towerZs[1] - towerZs[0]) / 2);
    return F.bridgeY + 4.5 + (towerTopY - F.bridgeY - 5.3) * u * u;
  };
  for (const s of [-1, 1]) {
    const cx = X + s * 11.6;
    const pts = [];
    for (let z = F.bridgeStart; z <= F.bridgeEnd; z += 4) pts.push(new THREE.Vector3(cx, cableY(z), z));
    grp.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 44, 0.24, 8, false), towerMat));
    for (let z = F.bridgeStart + 6; z <= F.bridgeEnd - 6; z += 6) {
      const h = cableY(z) - F.bridgeY;
      if (h > 0.6) box(0.08, h, 0.08, steelMat, cx, F.bridgeY + h / 2, z);
    }
  }
  ramp(F.rampDownStart, F.rampDownEnd, F.bridgeY, F.northY);
  slopedRail(F.rampDownStart, F.rampDownEnd, F.bridgeY, F.northY);
  flat(F.rampDownEnd, F.northEnd, F.northY);
  barrierRun(F.rampDownEnd, F.northEnd, F.northY, F.westOpenings.concat(F.eastOpenings));
  flushInstances(grp, UNIT_BOX, yellowMat, yellowT);
  flushInstances(grp, UNIT_BOX, whiteMat, whiteT);
  flushInstances(grp, UNIT_BOX, studMat, studT);

  const poleT = [], headT = [];
  const lampAt = (x, y, z, s) => {
    xform(poleT, x, y + 4.5, z);
    xform(headT, x - s * 1.1, y + 9.0, z);
  };
  for (let z = F.southEnd + 10; z < F.rampUpStart - 4; z += 27) for (const s of [-1, 1]) lampAt(X + s * (HW + 1.6), F.groundY, z, s);
  for (let z = F.rampDownEnd + 12; z < F.northEnd - 6; z += 27) for (const s of [-1, 1]) lampAt(X + s * (HW + 1.6), F.northY, z, s);
  for (let z = F.deckStart + 10; z < F.deckEnd; z += 24) for (const s of [-1, 1]) lampAt(X + s * (HW - 0.1), F.deckY, z, s);
  for (let z = F.bridgeStart + 12; z < F.bridgeEnd; z += 24) for (const s of [-1, 1]) lampAt(X + s * (HW - 0.1), F.bridgeY, z, s);
  flushInstances(grp, new THREE.CylinderGeometry(0.12, 0.16, 9, 8), makeMat(0x6b7280, { metalness: 0.6 }), poleT);
  flushInstances(grp, new THREE.BoxGeometry(2.2, 0.2, 0.5), new THREE.MeshBasicMaterial({ color: 0xfff7d6 }), headT);

  const gantry = (z, y, text, bg = '#065f46', fg = '#f8fafc', w = 15) => {
    for (const s of [-1, 1]) box(0.45, 7.4, 0.45, steelMat, X + s * (HW + 0.7), y + 3.7, z, true);
    box(W + 2.4, 0.4, 0.4, steelMat, X, y + 7.2, z, true);
    createNeonSign(grp, text, X, y + 6.4, z - 0.3, bg, fg, w, 1.5);
  };
  gantry(-110, F.groundY, 'AURA HILLS   EXIT 12');
  gantry(44, F.groundY, 'I-88 NORTH  •  REDROCK DESERT EXIT 40');
  gantry(206, F.deckY + (F.bridgeY - F.deckY) * ((206 - 186) / 30), 'OCEAN BRIDGE  •  KEEP RIGHT', '#0f172a', '#facc15');
  gantry(362, F.bridgeY, 'WELCOME TO LOS AURA  •  DOWNTOWN / LAX / SPEEDWAY', '#065f46', '#f8fafc', 17.5);
  gantry(462, F.northY, 'DOWNTOWN LOS AURA   EXIT 14');
  gantry(556, F.northY, 'LOS AURA INTL AIRPORT   EXIT 16');
  gantry(730, F.northY, 'MOTOR SPEEDWAY   EXIT 18');
  mapShapes.push({
    x: X, z: (F.southEnd + F.northEnd) / 2, w: W, d: F.northEnd - F.southEnd,
    color: '#334155', border: '#f59e0b', enterable: false
  });
  mapShapes.push({ x: X, z: 290, w: W, d: 208, color: '#dc2626', border: '#facc15', enterable: false });
}
// =============================================================================
// RESERVED FOOTPRINTS — roads & civic surfaces that are not colliders.
// Every building placement is tested against these, so nothing can ever be
// dropped on a carriageway, a sidewalk corridor or a plaza again.
// =============================================================================
const reservedFootprints = [];
export function reserveFootprint(minX, maxX, minZ, maxZ, tag = 'reserved') {
  reservedFootprints.push({ minX, maxX, minZ, maxZ, tag });
}
/** True when a w×d footprint at (cx,cz) is clear of roads, props and the spawn. */
export function footprintClear(cx, cz, w, d, pad = 2.5) {
  const x0 = cx - w / 2 - pad, x1 = cx + w / 2 + pad;
  const z0 = cz - d / 2 - pad, z1 = cz + d / 2 + pad;
  for (let i = 0; i < reservedFootprints.length; i++) {
    const r = reservedFootprints[i];
    if (x0 < r.maxX && x1 > r.minX && z0 < r.maxZ && z1 > r.minZ) return false;
  }
  for (let a = -w / 2; a <= w / 2 + 0.01; a += 4) {
    for (let b = -d / 2; b <= d / 2 + 0.01; b += 4) {
      if (collidesHorizontally(cx + a, cz + b, 0.2, 1.8, 1.2)) return false;
    }
  }
  const mr = Math.max(w, d);
  for (const m of manholes) if (dist2(cx, cz, m[0], m[1]) < mr * mr) return false;
  if (dist2(cx, cz, -11.5, 18.5) < 676) return false;
  return true;
}

// =============================================================================
// DISTRICT GENERATORS — a new district is a config object, not a new builder.
// =============================================================================
/**
 * roadGrid(parent, ns, ew, cross)
 * axis config: { at:[coords], w, d, c, top, thick, mat,
 *                tag?               — collider tag (omit for non-solid roads)
 *                map?[color,border] — minimap rectangle
 *                dash?{span,step,y,geo,mat} }
 * Reserved footprint is always the slab bounds + 1 unit on every side.
 */
function roadGrid(parent, ns, ew, cross) {
  const dashT = { ns: [], ew: [] };
  const run = (a, other, isNS) => {
    const w = isNS ? a.w : a.d, d = isNS ? a.d : a.w;
    for (const c of a.at) {
      const x = isNS ? c : a.c, z = isNS ? a.c : c;
      makeBox(parent, w, a.thick, d, x, a.top - a.thick / 2, z, a.mat, { recv: true });
      if (a.tag) addWorldBox(x - w / 2, x + w / 2, a.top - a.thick, a.top, z - d / 2, z + d / 2, a.tag, true);
      reserveFootprint(x - w / 2 - 1, x + w / 2 + 1, z - d / 2 - 1, z + d / 2 + 1, 'road');
      if (a.map) mapShapes.push({ x, z, w, d, color: a.map[0], border: a.map[1], enterable: false });
      if (a.dash) {
        for (let t = -a.dash.span; t <= a.dash.span; t += a.dash.step) {
          const p = a.c + t;
          if (other.at.some((o) => Math.abs(p - o) < 7.5)) continue;
          xform(dashT[isNS ? 'ns' : 'ew'], isNS ? c : p, a.dash.y, isNS ? p : c);
        }
      }
    }
  };
  run(ns, ew, true);
  run(ew, ns, false);
  if (ns.dash) flushInstances(parent, ns.dash.geo, ns.dash.mat, dashT.ns);
  if (ew.dash) flushInstances(parent, ew.dash.geo, ew.dash.mat, dashT.ew);
  if (cross) {
    const nsT = [], ewT = [];
    for (const ix of ns.at) for (const iz of ew.at) {
      for (let s = -4; s <= 4; s += 2) {
        xform(nsT, ix + s, cross.y, iz - cross.off);
        xform(nsT, ix + s, cross.y, iz + cross.off);
        xform(ewT, ix - cross.off, cross.y, iz + s);
        xform(ewT, ix + cross.off, cross.y, iz + s);
      }
    }
    flushInstances(parent, cross.nsGeo, cross.mat, nsT);
    flushInstances(parent, cross.ewGeo, cross.mat, ewT);
  }
}
/** Layered block surfaces (curb / sidewalk / inner) plus optional corner props. */
function cityBlocks(parent, xs, zs, layers, posts = null) {
  for (const bx of xs) for (const bz of zs) {
    for (const [w, h, d, y, m] of layers(bx, bz)) makeBox(parent, w, h, d, bx, y, bz, m, { recv: true });
    if (posts) posts(bx, bz);
  }
}

// -----------------------------------------------------------------------------
// City roads & desert highway
// -----------------------------------------------------------------------------
export function buildRoadsFreewayAndDesert() {
  const cityGround = terrainPlane(360, 440, -16, 0, -30, makeGroundMat('grass', { repeatX: 52, repeatY: 64, roughness: 0.94 }));
  cityGround.userData.studioName = 'City ground';
  worldRoot.add(cityGround);
  const desertGround = terrainPlane(260, 460, 294, 0.02, -10, makeGroundMat('sand', { repeatX: 38, repeatY: 64, roughness: 0.95 }));
  desertGround.userData.studioName = 'Redrock desert ground';
  worldRoot.add(desertGround);
  const nsRoads = [-120, -72, -24, 24, 72, 120];
  const ewRoads = [-168, -120, -72, -24, 24, 72];
  const asphaltNS = makeMat(0x313946, { texType: 'asphalt', repeatX: 2, repeatY: 36, roughness: 0.86, bumpScale: 0.015 });
  const asphaltEW = makeMat(0x313946, { texType: 'asphalt', repeatX: 36, repeatY: 2, roughness: 0.86, bumpScale: 0.015 });
  const yellowMat = makeMat(0xfacc15, { roughness: 0.55 });
  const whiteMat = makeMat(0xf1f5f9, { roughness: 0.55 });
  roadGrid(worldRoot,
    { at: nsRoads, w: 12, d: 252, c: -48, top: 0.08, thick: 0.08, mat: asphaltNS,
      dash: { span: 122, step: 6, y: 0.05, geo: new THREE.BoxGeometry(0.26, 0.09, 2.5), mat: yellowMat } },
    { at: ewRoads, w: 12, d: 252, c: 0, top: 0.08, thick: 0.08, mat: asphaltEW,
      dash: { span: 122, step: 6, y: 0.05, geo: new THREE.BoxGeometry(2.5, 0.09, 0.26), mat: yellowMat } },
    { y: 0.052, off: 7.3, mat: whiteMat,
      nsGeo: new THREE.BoxGeometry(0.85, 0.095, 2.1), ewGeo: new THREE.BoxGeometry(2.1, 0.095, 0.85) });
  const curbMat = makeGroundMat('concrete', { color: 0x94a3b8, repeatX: 16, repeatY: 1, roughness: 0.9 });
  const sidewalkMat = makeGroundMat('concrete', { color: 0xcbd5e1, repeatX: 12, repeatY: 12, roughness: 0.85 });
  const downtownPlazaMat = makeGroundMat('concrete', { color: 0x94a3b8, repeatX: 14, repeatY: 14, roughness: 0.82 });
  const lawnMat = makeGroundMat('grass', { color: 0x5ca450, repeatX: 10, repeatY: 10, roughness: 0.94 });
  cityBlocks(worldRoot, [-96, -48, 0, 48, 96], [-144, -96, -48, 0, 48], (bx, bz) => [
    [36.3, 0.16, 36.3, 0.08, curbMat],
    [36, 0.18, 36, 0.09, sidewalkMat],
    [30.4, 0.20, 30.4, 0.10, bz <= -72 ? downtownPlazaMat : lawnMat]
  ]);
  buildInterstate88();
  for (const cz of [-24, 72]) {
    makeBox(worldRoot, 46, 0.09, 12, 141, 0.045, cz, asphaltEW, { recv: true });
    reserveFootprint(118, 164, cz - 7, cz + 7, 'road');
  }
  makeBox(worldRoot, 198, 0.09, 12, 261, 0.055, 40, asphaltEW, { recv: true });
  reserveFootprint(162, 360, 33, 47, 'road');
  const hwyT = [];
  for (let x = 168; x <= 354; x += 7) xform(hwyT, x, 0.065, 40);
  flushInstances(worldRoot, new THREE.BoxGeometry(3.2, 0.10, 0.26), yellowMat, hwyT);
  mapShapes.push({ x: 280, z: 10, w: 220, d: 396, color: '#d97706', border: '#92400e', enterable: false });
  mapShapes.push({ x: 261, z: 40, w: 196, d: 12, color: '#334155', border: '#facc15', enterable: false });
}

// -----------------------------------------------------------------------------
// Redrock desert
// -----------------------------------------------------------------------------
export function buildRedrockDesertBiome() {
  const mesaMat = makeMat(0xb45309, { texType: 'redrock', repeatX: 6, repeatY: 3, roughness: 0.9, bumpScale: 0.03 });
  const mesaCapMat = makeMat(0xd97706, { texType: 'sand', repeatX: 4, repeatY: 4, roughness: 0.92 });
  const cactusMat = makeMat(0x15803d, { roughness: 0.85 });
  const boulderMat = makeMat(0x9a3412, { texType: 'redrock', repeatX: 2, repeatY: 2, roughness: 0.92 });
  // [x, z, w, d, h]
  for (const [x, z, w, d, h] of [
    [215, -45, 26, 22, 7.5], [295, -85, 34, 28, 11.0],
    [225, 125, 28, 24, 8.5], [285, 178, 32, 26, 10.0]
  ]) {
    makeBox(worldRoot, w, h, d, x, h / 2, z, mesaMat, { cast: true, recv: true });
    makeBox(worldRoot, w * 0.72, h * 0.55, d * 0.72, x, h + (h * 0.55) / 2, z, mesaCapMat, { cast: true });
    addWorldBox(x - w / 2, x + w / 2, 0.02, h, z - d / 2, z + d / 2, 'mesa_low', true);
    addWorldBox(x - (w * 0.72) / 2, x + (w * 0.72) / 2, h, h * 1.55, z - (d * 0.72) / 2, z + (d * 0.72) / 2, 'mesa_top', true);
    mapShapes.push({ x, z, w, d, color: '#9a3412', border: '#7c2d12', enterable: false });
  }
  [
    [184, -18], [196, 18], [210, 62], [238, 16], [268, -28],
    [282, 64], [308, 12], [332, 68], [192, 92], [255, 148]
  ].forEach(([cx, cz], idx) => {
    const cGroup = new THREE.Group();
    cGroup.userData.studioName = `Saguaro cactus ${idx + 1}`;
    const h = 2.6 + (idx % 3) * 0.55;
    cGroup.position.set(cx, 0.02, cz);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, h, 8), cactusMat);
    trunk.position.y = h / 2;
    trunk.castShadow = true;
    cGroup.add(trunk);
    makeBox(cGroup, 0.65, 0.22, 0.22, -0.35, h * 0.55, 0, cactusMat);
    makeBox(cGroup, 0.22, 0.75, 0.22, -0.56, h * 0.55 + 0.35, 0, cactusMat);
    makeBox(cGroup, 0.65, 0.22, 0.22, 0.35, h * 0.68, 0, cactusMat);
    makeBox(cGroup, 0.22, 0.65, 0.22, 0.56, h * 0.68 + 0.30, 0, cactusMat);
    worldRoot.add(cGroup);
    addWorldBox(cx - 0.35, cx + 0.35, 0.02, h, cz - 0.35, cz + 0.35, 'cactus', false);
  });
  for (const [bx, bz] of [[188, 56], [244, -14], [274, 24], [322, -24], [265, 95]]) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.45, 0), boulderMat);
    rock.position.set(bx, 0.9, bz);
    rock.castShadow = true;
    worldRoot.add(rock);
    addWorldBox(bx - 1.2, bx + 1.2, 0.02, 2.0, bz - 1.2, bz + 1.2, 'boulder', true);
  }
  buildWalkInHouse({ x: 254, z: 84, w: 10.4, d: 8.6, wallColor: 0xfde68a, roofColor: 0x9a3412, label: 'REDROCK DESERT OUTPOST' });
}

// -----------------------------------------------------------------------------
// Suburban house shell
// -----------------------------------------------------------------------------
export function buildSuburbanHouseBase({ x, z, w = 8.4, d = 7.4, h = 3.6, wallColor, roofColor, rotY = 0 }) {
  const group = new THREE.Group();
  group.position.set(x, 0.18, z);
  group.rotation.y = rotY;
  const t = 0.28;
  const wallMat = makeMat(wallColor, { texType: 'siding', repeatX: 3, repeatY: 2, bumpScale: 0.015 });
  const floor = makeBox(group, w - 0.2, 0.08, d - 0.2, 0, 0.04, 0, makeMat(0x92400e, { texType: 'wood' }));
  const backWall = makeBox(group, w, h, t, 0, h / 2, -d / 2 + t / 2, wallMat, { cast: true });
  const frontWall = new THREE.Group();
  frontWall.position.set(0, 0, d / 2 - t / 2);
  const fLeft = new THREE.Group();
  fLeft.position.x = -w * 0.28;
  buildWallWithRealWindow(fLeft, w * 0.38, h, t, 1.45, 1.25, 1.9, wallMat);
  const fRight = new THREE.Group();
  fRight.position.x = w * 0.28;
  buildWallWithRealWindow(fRight, w * 0.38, h, t, 1.45, 1.25, 1.9, wallMat);
  const centerCol = makeBox(frontWall, w * 0.24, h, t, 0, h / 2, 0, wallMat);
  const door = makeBox(frontWall, 1.2, 2.2, 0.14, 0, 1.1, 0.1, makeMat(0x78350f, { texType: 'wood' }));
  frontWall.add(fLeft, fRight);
  const leftWall = new THREE.Group();
  leftWall.position.set(-w / 2 + t / 2, 0, 0);
  leftWall.rotation.y = Math.PI / 2;
  buildWallWithRealWindow(leftWall, d - t * 2, h, t, 1.5, 1.25, 1.9, wallMat);
  const rightWall = new THREE.Group();
  rightWall.position.set(w / 2 - t / 2, 0, 0);
  rightWall.rotation.y = -Math.PI / 2;
  buildWallWithRealWindow(rightWall, d - t * 2, h, t, 1.5, 1.25, 1.9, wallMat);
  const inTable = makeBox(group, 1.4, 0.65, 1.0, -1.6, 0.4, 1.2, makeMat(0x78350f, { texType: 'wood' }));
  const inSofa = makeBox(group, 2.2, 0.72, 0.9, 1.6, 0.42, 0.8, makeMat(0x334155, { texType: 'fabric' }));
  group.remove(floor, backWall, inTable, inSofa);
  group.add(floor, backWall, frontWall, leftWall, rightWall, inTable, inSofa);
  const roofH = 2.2, overhang = 0.55;
  const shape = new THREE.Shape();
  shape.moveTo(-(w / 2 + overhang), 0);
  shape.lineTo(w / 2 + overhang, 0);
  shape.lineTo(0, roofH);
  shape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: d + overhang * 2, bevelEnabled: false });
  roofGeo.translate(0, 0, -(d / 2 + overhang));
  const roof = new THREE.Mesh(roofGeo, makeMat(roofColor, { texType: 'shingles', repeatX: 4, repeatY: 4, bumpScale: 0.02 }));
  roof.position.y = h;
  roof.castShadow = true;
  group.add(roof);
  makeBox(group, 3.4, 0.24, 1.8, 0, 2.25, d / 2 + 0.85,
    makeMat(roofColor, { texType: 'shingles', repeatX: 2, repeatY: 1 }), { cast: true });
  const lodGroup = new THREE.Group();
  makeBox(lodGroup, 0.85, 2.2, 0.85, w * 0.28, h + 1.4, -d * 0.15,
    makeMat(0x9a3412, { texType: 'brick', repeatX: 1, repeatY: 2, bumpScale: 0.02 }), { cast: true });
  group.add(lodGroup);
  registerBuildingLod(x, z, lodGroup);
  worldRoot.add(group);
  const cos = Math.abs(Math.cos(rotY)), sin = Math.abs(Math.sin(rotY));
  const worldW = w * cos + d * sin, worldD = w * sin + d * cos;
  addWorldBox(x - worldW / 2, x + worldW / 2, 0.18, 0.18 + h, z - worldD / 2, z + worldD / 2, 'house_wall', false);
  const awX = x + Math.sin(rotY) * (d / 2 + 0.85), awZ = z + Math.cos(rotY) * (d / 2 + 0.85);
  const awW = 3.4 * cos + 1.8 * sin, awD = 3.4 * sin + 1.8 * cos;
  addWorldBox(awX - awW / 2, awX + awW / 2, 2.25, 2.48, awZ - awD / 2, awZ + awD / 2, 'porch_awning', true);
  mapShapes.push({ x, z, w: worldW, d: worldD, color: '#' + new THREE.Color(wallColor).getHexString(), border: '#1e293b', enterable: false });
}

// -----------------------------------------------------------------------------
// Walk-in house
// -----------------------------------------------------------------------------
export function buildWalkInHouse({ x, z, w = 9.8, d = 8.6, h = 4.0, wallColor, roofColor, label, baseY = 0.18 }) {
  const group = new THREE.Group();
  group.position.set(x, baseY, z);
  group.userData.studioName = label || 'Walk-in house';
  const t = 0.36, doorW = 2.6, doorH = 2.85;
  const wallMat = makeMat(wallColor, { texType: 'siding', repeatX: 4, repeatY: 2, bumpScale: 0.015 });
  makeBox(group, w - 0.2, 0.08, d - 0.2, 0, 0.04, 0,
    makeMat(0xb45309, { texType: 'wood', repeatX: 4, repeatY: 4, roughness: 0.55 }), { recv: true });
  const backWallGroup = new THREE.Group();
  backWallGroup.position.set(0, 0, -d / 2 + t / 2);
  buildWallWithRealWindow(backWallGroup, w, h, t, 2.2, 1.35, 2.0, wallMat);
  group.add(backWallGroup);
  const leftWallGroup = new THREE.Group();
  leftWallGroup.position.set(-w / 2 + t / 2, 0, 0);
  leftWallGroup.rotation.y = Math.PI / 2;
  buildWallWithRealWindow(leftWallGroup, d - t * 2, h, t, 1.8, 1.35, 2.0, wallMat);
  const rightWallGroup = new THREE.Group();
  rightWallGroup.position.set(w / 2 - t / 2, 0, 0);
  rightWallGroup.rotation.y = -Math.PI / 2;
  buildWallWithRealWindow(rightWallGroup, d - t * 2, h, t, 1.8, 1.35, 2.0, wallMat);
  group.add(leftWallGroup, rightWallGroup);
  const segW = (w - doorW) / 2;
  const frontL = new THREE.Group();
  frontL.position.set(-(doorW / 2 + segW / 2), 0, d / 2 - t / 2);
  buildWallWithRealWindow(frontL, segW, h, t, 1.45, 1.3, 2.0, wallMat);
  const frontR = new THREE.Group();
  frontR.position.set(doorW / 2 + segW / 2, 0, d / 2 - t / 2);
  buildWallWithRealWindow(frontR, segW, h, t, 1.45, 1.3, 2.0, wallMat);
  const headerH = h - doorH;
  const header = makeBox(group, doorW, headerH, t, 0, doorH + headerH / 2, d / 2 - t / 2, wallMat);
  const trimMat = makeMat(0x78350f, { texType: 'wood' });
  const trimL = makeBox(group, 0.14, doorH, t + 0.08, -doorW / 2, doorH / 2, d / 2 - t / 2, trimMat);
  const trimR = makeBox(group, 0.14, doorH, t + 0.08, doorW / 2, doorH / 2, d / 2 - t / 2, trimMat);
  group.remove(header, trimL, trimR);
  group.add(frontL, frontR, header, trimL, trimR);
  const roofH = 2.3, overhang = 0.55;
  const shape = new THREE.Shape();
  shape.moveTo(-(w / 2 + overhang), 0);
  shape.lineTo(w / 2 + overhang, 0);
  shape.lineTo(0, roofH);
  shape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: d + overhang * 2, bevelEnabled: false });
  roofGeo.translate(0, 0, -(d / 2 + overhang));
  const roof = new THREE.Mesh(roofGeo, makeMat(roofColor, { texType: 'shingles', repeatX: 4, repeatY: 4, bumpScale: 0.02 }));
  roof.position.y = h;
  roof.castShadow = true;
  group.add(roof);
  const sofa = makeBox(group, 1.1, 0.72, 2.5, -w / 2 + 1.0, 0.42, -0.2,
    makeMat(0x334155, { texType: 'fabric', repeatX: 2, repeatY: 4, roughness: 0.95 }));
  addWorldBox(x - w / 2 + 0.45, x - w / 2 + 1.55, baseY, baseY + 0.72, z - 1.45, z + 1.05, 'sofa', true);
  const table = makeBox(group, 1.1, 0.62, 1.6, -1.5, 0.38, -0.2, makeMat(0x78350f, { texType: 'wood' }));
  addWorldBox(x - 2.05, x - 0.95, baseY, baseY + 0.62, z - 1.0, z + 0.6, 'table', true);
  const counter = makeBox(group, 2.8, 0.94, 1.1, w / 2 - 1.9, 0.54, -d / 2 + 1.0, makeMat(0xe2e8f0, { texType: 'siding' }));
  const graniteTop = makeBox(group, 2.9, 0.09, 1.18, w / 2 - 1.9, 1.05, -d / 2 + 1.0,
    makeMat(0x334155, { texType: 'granite', repeatX: 3, repeatY: 1, roughness: 0.16, clearcoat: 0.9, flatShading: false }));
  const steelFridge = makeBox(group, 0.95, 2.05, 0.95, w / 2 - 0.9, 1.1, -d / 2 + 2.3,
    makeMat(0xdbeafe, { texType: 'brushedsteel', repeatX: 1, repeatY: 2, metalness: 0.9, roughness: 0.22, flatShading: false }));
  addWorldBox(x + w / 2 - 3.3, x + w / 2 - 0.5, baseY, baseY + 1.02, z - d / 2 + 0.45, z - d / 2 + 1.55, 'counter', true);
  addWorldBox(x + w / 2 - 1.4, x + w / 2 - 0.4, baseY, baseY + 2.07, z - d / 2 + 1.8, z - d / 2 + 2.8, 'fridge', true);
  const bedFrame = makeBox(group, 2.0, 0.55, 1.4, -w / 2 + 1.45, 0.35, -d / 2 + 1.15, makeMat(0x92400e, { texType: 'wood' }));
  const mattress = makeBox(group, 1.88, 0.22, 1.28, -w / 2 + 1.45, 0.68, -d / 2 + 1.15,
    makeMat(0xf8fafc, { texType: 'fabric', repeatX: 2, repeatY: 2, roughness: 0.95 }));
  addWorldBox(x - w / 2 + 0.45, x - w / 2 + 2.45, baseY, baseY + 0.77, z - d / 2 + 0.45, z - d / 2 + 1.85, 'bed', true);
  const rug = makeBox(group, 3.4, 0.03, 2.5, -1.5, 0.09, -0.2,
    makeMat(0x0284c7, { texType: 'fabric', repeatX: 4, repeatY: 3, roughness: 0.96 }));
  const indoorLod = new THREE.Group();
  const lampStand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.14, 1.5, 8), makeMat(0xfbbf24, { metalness: 0.85 }));
  lampStand.position.set(-w / 2 + 0.9, 0.85, d / 2 - 1.2);
  const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.32, 10), makeMat(0xfef08a, { emissive: 0xfacc15, emissiveIntensity: 0.6 }));
  lampShade.position.set(-w / 2 + 0.9, 1.65, d / 2 - 1.2);
  indoorLod.add(lampStand, lampShade);
  group.add(indoorLod);
  registerBuildingLod(x, z, indoorLod);
  group.remove(sofa, table, counter, graniteTop, steelFridge, bedFrame, mattress, rug);
  group.add(sofa, table, counter, graniteTop, steelFridge, bedFrame, mattress, rug);
  worldRoot.add(group);
  const minX = x - w / 2, maxX = x + w / 2, minZ = z - d / 2, maxZ = z + d / 2;
  addWorldBox(minX, maxX, baseY, baseY + h, minZ, minZ + t, 'wall', false);
  addWorldBox(minX, minX + t, baseY, baseY + h, minZ, maxZ, 'wall', false);
  addWorldBox(maxX - t, maxX, baseY, baseY + h, minZ, maxZ, 'wall', false);
  addWorldBox(minX, x - doorW / 2, baseY, baseY + h, maxZ - t, maxZ, 'wall', false);
  addWorldBox(x + doorW / 2, maxX, baseY, baseY + h, maxZ - t, maxZ, 'wall', false);
  addWorldBox(minX, maxX, baseY + h - 0.2, baseY + h, minZ, maxZ, 'roof', true);
  enterableZones.push({ minX: minX + 0.3, maxX: maxX - 0.3, minZ: minZ + 0.3, maxZ: maxZ - 0.2, name: label });
  mapShapes.push({ x, z, w, d, color: '#' + new THREE.Color(wallColor).getHexString(), border: '#f59e0b', enterable: true });
}

// -----------------------------------------------------------------------------
// Shops, dealership, bank
// -----------------------------------------------------------------------------
export function buildHotdogStore(x, z) {
  const w = 11.4, d = 9.6, h = 4.2, t = 0.36, doorW = 2.8, doorH = 2.9;
  const group = new THREE.Group();
  group.position.set(x, 0.18, z);
  group.userData.studioName = 'AURA HOTDOGS';
  const wallMat = makeMat(0xfef08a, { texType: 'siding', repeatX: 4, repeatY: 2 });
  const redTrimMat = makeMat(0xdc2626, { roughness: 0.45 });
  const floor = makeBox(group, w - 0.2, 0.08, d - 0.2, 0, 0.04, 0,
    makeMat(0xf8fafc, { texType: 'cobblestone', repeatX: 6, repeatY: 6, roughness: 0.5 }), { recv: true });
  const backW = makeBox(group, w, h, t, 0, h / 2, -d / 2 + t / 2, wallMat, { cast: true });
  const leftW = new THREE.Group();
  leftW.position.set(-w / 2 + t / 2, 0, 0);
  leftW.rotation.y = Math.PI / 2;
  buildWallWithRealWindow(leftW, d - t * 2, h, t, 2.2, 1.4, 2.0, wallMat);
  const rightW = new THREE.Group();
  rightW.position.set(w / 2 - t / 2, 0, 0);
  rightW.rotation.y = -Math.PI / 2;
  buildWallWithRealWindow(rightW, d - t * 2, h, t, 2.2, 1.4, 2.0, wallMat);
  const segW = (w - doorW) / 2;
  const frontL = new THREE.Group();
  frontL.position.set(-(doorW / 2 + segW / 2), 0, d / 2 - t / 2);
  buildWallWithRealWindow(frontL, segW, h, t, segW - 0.9, 1.85, 1.65, wallMat);
  const frontR = new THREE.Group();
  frontR.position.set(doorW / 2 + segW / 2, 0, d / 2 - t / 2);
  buildWallWithRealWindow(frontR, segW, h, t, segW - 0.9, 1.85, 1.65, wallMat);
  const header = makeBox(group, doorW, h - doorH, t, 0, doorH + (h - doorH) / 2, d / 2 - t / 2, wallMat);
  const roof = makeBox(group, w + 0.6, 0.36, d + 0.6, 0, h + 0.18, 0, redTrimMat, { cast: true });
  const mascotGroup = new THREE.Group();
  mascotGroup.position.set(0, h + 1.15, 0.5);
  const bunMat = makeMat(0xd97706, { roughness: 0.6 });
  const bunL = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 2.6, 6, 10), bunMat);
  bunL.rotation.z = Math.PI / 2;
  bunL.position.set(0, 0, 0.24);
  const bunR = bunL.clone();
  bunR.position.z = -0.24;
  const wiener = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 3.1, 6, 10), makeMat(0xb91c1c, { roughness: 0.35 }));
  wiener.rotation.z = Math.PI / 2;
  wiener.position.y = 0.12;
  const mustard = makeBox(mascotGroup, 2.9, 0.08, 0.12, 0, 0.48, 0, makeMat(0xfacc15));
  mascotGroup.add(bunL, bunR, wiener);
  createNeonSign(group, 'AURA HOTDOGS', 0, 3.55, d / 2 + 0.08, '#991b1b', '#fef08a', 5.2, 1.05);
  const frontCounter = makeBox(group, 4.4, 1.0, 1.0, -2.4, 0.55, -0.5, redTrimMat);
  const frontTop = makeBox(group, 4.5, 0.1, 1.1, -2.4, 1.08, -0.5, makeMat(0xf8fafc, { metalness: 0.7 }));
  const backCounter = makeBox(group, 6.8, 0.96, 1.1, 0, 0.54, -d / 2 + 1.15,
    makeMat(0x334155, { texType: 'brushedsteel', metalness: 0.85 }));
  const refillVat = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.44, 0.65, 14), makeMat(0xe2e8f0, { metalness: 0.92, roughness: 0.18 }));
  refillVat.position.set(2.4, 1.32, -d / 2 + 1.15);
  const vatWater = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 14), makeMat(0xf97316, { emissive: 0xea580c, emissiveIntensity: 0.55 }));
  vatWater.position.set(2.4, 1.63, -d / 2 + 1.15);
  createNeonSign(group, 'SAUSAGE REFILL VAT [E]', 2.4, 2.35, -d / 2 + 0.45, '#7f1d1d', '#fef08a', 3.4, 0.62);
  const indoorPadRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.15, 22), new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide }));
  indoorPadRing.rotation.x = -Math.PI / 2;
  indoorPadRing.position.set(2.4, 0.10, -2.2);
  group.remove(floor, backW, header, roof, frontCounter, frontTop, backCounter);
  group.add(floor, backW, leftW, rightW, frontL, frontR, header, roof, mascotGroup, frontCounter, frontTop, backCounter, refillVat, vatWater, indoorPadRing);
  worldRoot.add(group);
  const minX = x - w / 2, maxX = x + w / 2, minZ = z - d / 2, maxZ = z + d / 2;
  addWorldBox(minX, maxX, 0.18, 0.18 + h, minZ, minZ + t, 'wall', false);
  addWorldBox(minX, minX + t, 0.18, 0.18 + h, minZ, maxZ, 'wall', false);
  addWorldBox(maxX - t, maxX, 0.18, 0.18 + h, minZ, maxZ, 'wall', false);
  addWorldBox(minX, x - doorW / 2, 0.18, 0.18 + h, maxZ - t, maxZ, 'wall', false);
  addWorldBox(x + doorW / 2, maxX, 0.18, 0.18 + h, maxZ - t, maxZ, 'wall', false);
  addWorldBox(minX, maxX, 0.18 + h - 0.1, 0.18 + h + 0.36, minZ, maxZ, 'roof', true);
  addWorldBox(x - 4.6, x - 0.2, 0.18, 1.25, z - 1.05, z + 0.05, 'hd_counter', true);
  addWorldBox(x - 3.4, x + 3.4, 0.18, 1.25, minZ + 0.6, minZ + 1.75, 'hd_back_counter', true);
  sausageRefillZones.push({ x: x + 2.4, y: 0.18, z: z - 2.2, label: 'AURA HOTDOGS SAUSAGE VAT' });
  enterableZones.push({ minX: minX + 0.3, maxX: maxX - 0.3, minZ: minZ + 0.3, maxZ: maxZ - 0.2, name: 'AURA HOTDOGS STORE' });
  mapShapes.push({ x, z, w, d, color: '#ef4444', border: '#facc15', enterable: true });
}

export function buildPlazaHotdogCart(x, z) {
  const cart = new THREE.Group();
  cart.position.set(x, 0.18, z);
  cart.userData.studioName = 'Plaza hotdog cart';
  const body = makeBox(cart, 2.1, 1.05, 1.15, 0, 0.62, 0,
    makeMat(0xdc2626, { texType: 'corrugated', metalness: 0.65, roughness: 0.28 }), { cast: true });
  const topCounter = makeBox(cart, 2.22, 0.10, 1.25, 0, 1.18, 0,
    makeMat(0xf8fafc, { texType: 'brushedsteel', metalness: 0.9, roughness: 0.2, flatShading: false }));
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.65, 8), makeMat(0xe2e8f0, { metalness: 0.9 }));
  pole.position.set(0, 1.95, 0);
  const umbrella = new THREE.Mesh(new THREE.ConeGeometry(1.55, 0.65, 8), makeMat(0xfacc15, { roughness: 0.5 }));
  umbrella.position.set(0, 2.75, 0);
  umbrella.castShadow = true;
  const miniDog = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.65, 6, 8), makeMat(0xb91c1c));
  miniDog.rotation.z = Math.PI / 2;
  miniDog.position.set(0, 1.34, 0.1);
  const refillRing = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.45, 24), new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide }));
  refillRing.rotation.x = -Math.PI / 2;
  refillRing.position.y = 0.05;
  createNeonSign(cart, 'SAUSAGE REFILL [E]', 0, 2.15, 0.65, '#7f1d1d', '#fef08a', 2.2, 0.44);
  cart.remove(body, topCounter);
  cart.add(body, topCounter, pole, umbrella, miniDog, refillRing);
  worldRoot.add(cart);
  addWorldBox(x - 1.1, x + 1.1, 0.18, 1.42, z - 0.62, z + 0.62, 'hotdog_cart', true);
  sausageRefillZones.push({ x, y: 0.18, z: z + 1.2, label: 'PLAZA HOTDOG CART' });
}

export function buildCarDealership(x, z) {
  const w = 15.6, d = 12.6, h = 4.8, t = 0.38, doorW = 4.8, doorH = 3.5;
  const group = new THREE.Group();
  group.position.set(x, 0.18, z);
  group.userData.studioName = 'AURA EXOTIC MOTORS';
  const marbleFloor = makeBox(group, w - 0.2, 0.08, d - 0.2, 0, 0.04, 0,
    makeMat(0xf8fafc, { texType: 'marble', repeatX: 6, repeatY: 5, roughness: 0.16, clearcoat: 0.9, flatShading: false }), { recv: true });
  const wallMat = makeMat(0x1e293b, { texType: 'concrete', repeatX: 5, repeatY: 2, roughness: 0.45 });
  const trimMat = makeMat(0xf59e0b, { metalness: 0.85, roughness: 0.2 });
  const backW = makeBox(group, w, h, t, 0, h / 2, -d / 2 + t / 2, wallMat, { cast: true });
  const leftW = new THREE.Group();
  leftW.position.set(-w / 2 + t / 2, 0, 0);
  leftW.rotation.y = Math.PI / 2;
  buildWallWithRealWindow(leftW, d - t * 2, h, t, d - 3.2, 2.75, 1.95, wallMat, false);
  const rightW = new THREE.Group();
  rightW.position.set(w / 2 - t / 2, 0, 0);
  rightW.rotation.y = -Math.PI / 2;
  buildWallWithRealWindow(rightW, d - t * 2, h, t, d - 3.2, 2.75, 1.95, wallMat, false);
  const segW = (w - doorW) / 2;
  const frontL = new THREE.Group();
  frontL.position.set(-(doorW / 2 + segW / 2), 0, d / 2 - t / 2);
  buildWallWithRealWindow(frontL, segW, h, t, segW - 1.0, 2.75, 1.95, wallMat, false);
  const frontR = new THREE.Group();
  frontR.position.set(doorW / 2 + segW / 2, 0, d / 2 - t / 2);
  buildWallWithRealWindow(frontR, segW, h, t, segW - 1.0, 2.75, 1.95, wallMat, false);
  const header = makeBox(group, doorW, h - doorH, t, 0, doorH + (h - doorH) / 2, d / 2 - t / 2, wallMat);
  const roof = makeBox(group, w + 0.8, 0.38, d + 0.8, 0, h + 0.19, 0, wallMat, { cast: true });
  const fascia = makeBox(group, w + 0.9, 0.28, d + 0.9, 0, h + 0.04, 0, trimMat);
  const turntableRing = new THREE.Mesh(new THREE.RingGeometry(2.5, 2.85, 32), new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide }));
  turntableRing.rotation.x = -Math.PI / 2;
  turntableRing.position.set(0, 0.10, -0.4);
  const desk = makeBox(group, 2.4, 0.95, 0.95, -5.6, 0.52, -4.4, makeMat(0x0f172a));
  const deskTop = makeBox(group, 2.5, 0.08, 1.05, -5.6, 1.02, -4.4, trimMat);
  createNeonSign(group, 'AURA EXOTIC MOTORS', 0, 4.15, d / 2 + 0.12, '#090d14', '#f59e0b', 8.2, 1.15);
  group.remove(marbleFloor, backW, header, roof, fascia, desk, deskTop);
  group.add(marbleFloor, backW, leftW, rightW, frontL, frontR, header, roof, fascia, turntableRing, desk, deskTop);
  worldRoot.add(group);
  const minX = x - w / 2, maxX = x + w / 2, minZ = z - d / 2, maxZ = z + d / 2;
  addWorldBox(minX, maxX, 0.18, 0.18 + h, minZ, minZ + t, 'wall', false);
  addWorldBox(minX, minX + t, 0.18, 0.18 + h, minZ, maxZ, 'wall', false);
  addWorldBox(maxX - t, maxX, 0.18, 0.18 + h, minZ, maxZ, 'wall', false);
  addWorldBox(minX, x - doorW / 2, 0.18, 0.18 + h, maxZ - t, maxZ, 'wall', false);
  addWorldBox(x + doorW / 2, maxX, 0.18, 0.18 + h, maxZ - t, maxZ, 'wall', false);
  addWorldBox(minX, maxX, 0.18 + h - 0.1, 0.18 + h + 0.38, minZ, maxZ, 'roof', true);
  addWorldBox(x - 6.85, x - 4.35, 0.18, 1.18, z - 4.9, z - 3.9, 'dealer_desk', true);
  addWorldBox(minX + t, maxX - t, 0.18, 0.26, minZ + t, maxZ - t, 'dealer_floor', true);
  enterableZones.push({ minX: minX + 0.3, maxX: maxX - 0.3, minZ: minZ + 0.3, maxZ: maxZ - 0.2, name: 'AURA EXOTIC MOTORS' });
  mapShapes.push({ x, z, w, d, color: '#1e293b', border: '#f59e0b', enterable: true });
}

export function buildReserveBank(x, z) {
  const w = 16.4, d = 13.6, h = 6.2, t = 0.45, doorW = 3.2, doorH = 3.4;
  const group = new THREE.Group();
  group.position.set(x, 0.18, z);
  group.userData.studioName = 'SUNNYVALE RESERVE BANK';
  const marbleMat = makeMat(0xf8fafc, { texType: 'marble', repeatX: 5, repeatY: 3, roughness: 0.22, clearcoat: 0.85, flatShading: false });
  const graniteMat = makeMat(0x1e293b, { texType: 'granite', repeatX: 4, repeatY: 2, roughness: 0.25, flatShading: false });
  const goldMat = makeMat(0xfbbf24, { metalness: 0.94, roughness: 0.15, clearcoat: 0.9, flatShading: false });
  const vaultSteelMat = makeMat(0x94a3b8, { texType: 'brushedsteel', metalness: 0.94, roughness: 0.18, flatShading: false });
  const floor = makeBox(group, w - 0.2, 0.10, d - 0.2, 0, 0.05, 0, marbleMat, { recv: true });
  const backW = makeBox(group, w, h, t, 0, h / 2, -d / 2 + t / 2, marbleMat, { cast: true });
  const leftW = new THREE.Group();
  leftW.position.set(-w / 2 + t / 2, 0, 0);
  leftW.rotation.y = Math.PI / 2;
  buildWallWithRealWindow(leftW, d - t * 2, h, t, 3.4, 2.2, 2.6, marbleMat);
  const rightW = new THREE.Group();
  rightW.position.set(w / 2 - t / 2, 0, 0);
  rightW.rotation.y = -Math.PI / 2;
  buildWallWithRealWindow(rightW, d - t * 2, h, t, 3.4, 2.2, 2.6, marbleMat);
  const segW = (w - doorW) / 2;
  const frontL = new THREE.Group();
  frontL.position.set(-(doorW / 2 + segW / 2), 0, d / 2 - t / 2);
  buildWallWithRealWindow(frontL, segW, h, t, 2.8, 2.2, 2.6, marbleMat);
  const frontR = new THREE.Group();
  frontR.position.set(doorW / 2 + segW / 2, 0, d / 2 - t / 2);
  buildWallWithRealWindow(frontR, segW, h, t, 2.8, 2.2, 2.6, marbleMat);
  const header = makeBox(group, doorW, h - doorH, t, 0, doorH + (h - doorH) / 2, d / 2 - t / 2, marbleMat);
  const roof = makeBox(group, w + 1.2, 0.48, d + 1.6, 0, h + 0.24, 0, marbleMat, { cast: true });
  const cornice = makeBox(group, w + 1.5, 0.35, d + 1.9, 0, h + 0.62, 0, goldMat);
  group.remove(floor, backW, header, roof, cornice);
  for (const cx of [-6.6, -2.6, 2.6, 6.6]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, h, 14), marbleMat);
    col.position.set(cx, h / 2, d / 2 + 0.65);
    col.castShadow = true;
    group.add(col);
  }
  createNeonSign(group, 'SUNNYVALE RESERVE BANK', 0, 5.1, d / 2 + 0.92, '#0f172a', '#fbbf24', 8.4, 1.15);
  const tellerBase = makeBox(group, 7.2, 1.05, 1.1, -3.2, 0.58, -1.2, marbleMat);
  const tellerTop = makeBox(group, 7.4, 0.12, 1.25, -3.2, 1.15, -1.2, graniteMat);
  const tellerGlass = makeBox(group, 6.8, 1.1, 0.08, -3.2, 1.75, -1.2, realWindowGlassMat);
  const vaultBack = makeBox(group, 5.6, 3.6, 0.4, 4.8, 1.85, -d / 2 + 0.6, vaultSteelMat);
  const vaultLeft = makeBox(group, 0.4, 3.6, 4.4, 2.2, 1.85, -d / 2 + 2.6, vaultSteelMat);
  const vaultDoor = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 0.35, 20), vaultSteelMat);
  vaultDoor.rotation.x = Math.PI / 2;
  vaultDoor.rotation.z = 0.7;
  vaultDoor.position.set(1.35, 1.75, -d / 2 + 4.8);
  const vaultWheel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 16), goldMat);
  vaultWheel.position.set(1.35, 1.75, -d / 2 + 5.0);
  group.remove(tellerBase, tellerTop, tellerGlass, vaultBack, vaultLeft);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    makeBox(group, 0.42, 0.18, 0.22, 4.2 + col * 0.52, 0.24 + row * 0.19, -d / 2 + 1.5, goldMat);
  }
  group.add(floor, backW, leftW, rightW, frontL, frontR, header, roof, cornice, tellerBase, tellerTop, tellerGlass, vaultBack, vaultLeft, vaultDoor, vaultWheel);
  worldRoot.add(group);
  const minX = x - w / 2, maxX = x + w / 2, minZ = z - d / 2, maxZ = z + d / 2;
  addWorldBox(minX, maxX, 0.18, 0.18 + h, minZ, minZ + t, 'wall', false);
  addWorldBox(minX, minX + t, 0.18, 0.18 + h, minZ, maxZ, 'wall', false);
  addWorldBox(maxX - t, maxX, 0.18, 0.18 + h, minZ, maxZ, 'wall', false);
  addWorldBox(minX, x - doorW / 2, 0.18, 0.18 + h, maxZ - t, maxZ, 'wall', false);
  addWorldBox(x + doorW / 2, maxX, 0.18, 0.18 + h, maxZ - t, maxZ, 'wall', false);
  addWorldBox(minX, maxX, 0.18 + h - 0.2, 0.18 + h + 0.48, minZ, maxZ, 'roof', true);
  addWorldBox(x - 6.8, x + 0.4, 0.18, 1.4, z - 1.8, z - 0.6, 'bank_counter', true);
  addWorldBox(x + 2.0, x + 2.4, 0.18, 3.8, minZ + 0.4, minZ + 4.8, 'vault_wall', false);
  enterableZones.push({ minX: minX + 0.3, maxX: maxX - 0.3, minZ: minZ + 0.3, maxZ: maxZ - 0.2, name: 'SUNNYVALE RESERVE BANK' });
  mapShapes.push({ x, z, w, d, color: '#f8fafc', border: '#f59e0b', enterable: true });
}

// =============================================================================
// SKYSCRAPER SYSTEM — four exterior archetypes, three interior archetypes,
// the shared UNIT_BOX, one material cache, one validated placement table.
// =============================================================================
const TOWER_BASE_Y = 0.18, TOWER_LOBBY_H = 4.6, TOWER_WALL_T = 0.48, TOWER_DOOR_W = 3.2;
const towerGeos = [], towerMats = [];
const towerMatCache = new Map(), towerFacadeCache = new Map();
function tGeo(g) { g.userData.shared = true; towerGeos.push(g); return g; }
function tMat(m) { m.userData.shared = true; towerMats.push(m); return m; }
function towerFrameMat(hex) {
  const k = 'f' + hex;
  if (!towerMatCache.has(k)) {
    towerMatCache.set(k, tMat(makeMat(hex, {
      texType: 'brushedsteel', repeatX: 4, repeatY: 12, metalness: 0.88, roughness: 0.24, flatShading: false
    })));
  }
  return towerMatCache.get(k);
}
function towerGlassMat(hex) {
  const k = 'g' + hex;
  if (!towerMatCache.has(k)) {
    towerMatCache.set(k, tMat(makeMat(hex, {
      metalness: 0.90, roughness: 0.10, clearcoat: 1.0, clearcoatRoughness: 0.05,
      envMapIntensity: 2.1, emissive: hex, emissiveIntensity: 0.14, flatShading: false
    })));
  }
  return towerMatCache.get(k);
}
function towerPlainMat(hex, opts) {
  const k = 'p' + hex + JSON.stringify(opts || {});
  if (!towerMatCache.has(k)) towerMatCache.set(k, tMat(makeMat(hex, opts || {})));
  return towerMatCache.get(k);
}
function towerMarbleMat() {
  return towerPlainMat(0xf8fafc, { texType: 'marble', repeatX: 5, repeatY: 5, roughness: 0.18, clearcoat: 0.85, flatShading: false });
}
function towerFacadeMat(hex, cols, rows) {
  const k = hex + ':' + cols + 'x' + rows;
  if (towerFacadeCache.has(k)) return towerFacadeCache.get(k);
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = '#' + new THREE.Color(hex).getHexString();
  c.fillRect(0, 0, 64, 128);
  for (let r = 0; r < 16; r++) for (let col = 0; col < 8; col++) {
    const lit = Math.sin((r * 9 + col * 3 + hex) * 12.9898) * 43758.5453;
    c.fillStyle = (lit - Math.floor(lit)) < 0.34 ? '#ffe9a8' : '#2f4a63';
    c.fillRect(col * 8 + 1, r * 8 + 1, 6, 6);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(cols, rows);
  const m = tMat(new THREE.MeshStandardMaterial({
    map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.34, metalness: 0.38
  }));
  towerFacadeCache.set(k, m);
  return m;
}
/** Tower box — same shared unit geometry as the rest of the world. */
const tbx = (p, m, x, y, z, sx, sy, sz, cast = true) => makeBox(p, sx, sy, sz, x, y, z, m, { cast, recv: true });
/** Repeated horizontal bands as a single instanced draw call. */
function towerBands(parent, m, w, d, y0, y1, step, thick = 0.26, grow = 0.16) {
  const n = Math.max(0, Math.floor((y1 - y0) / step));
  if (!n) return null;
  const t = [];
  for (let i = 0; i < n; i++) xform(t, 0, y0 + i * step, 0, w + grow, thick, d + grow);
  return flushInstances(parent, UNIT_BOX, m, t, { cast: true });
}
const TOWER_ARCHETYPES = {
  glass: {
    lobby: 'corporate',
    shaft(g, p, fm, gm, lod) {
      const upper = p.h - TOWER_LOBBY_H;
      tbx(g, gm, 0, TOWER_LOBBY_H + upper / 2, 0, p.w, upper, p.d);
      towerBands(lod, fm, p.w, p.d, TOWER_LOBBY_H + 6, p.h, 6);
      for (const cx of [-p.w / 2, p.w / 2]) for (const cz of [-p.d / 2, p.d / 2]) tbx(lod, fm, cx, p.h / 2, cz, 0.32, p.h, 0.32);
    }
  },
  deco: {
    lobby: 'finance',
    shaft(g, p, fm, gm, lod) {
      let y = TOWER_LOBBY_H;
      for (const [scale, frac] of [[1.00, 0.50], [0.78, 0.30], [0.56, 0.20]]) {
        const th = (p.h - TOWER_LOBBY_H) * frac;
        tbx(g, gm, 0, y + th / 2, 0, p.w * scale, th, p.d * scale);
        tbx(g, fm, 0, y + th, 0, p.w * scale + 0.7, 0.4, p.d * scale + 0.7);
        y += th;
      }
      towerBands(lod, fm, p.w, p.d, TOWER_LOBBY_H + 4, TOWER_LOBBY_H + (p.h - TOWER_LOBBY_H) * 0.5, 5, 0.3, 0.3);
      for (const cx of [-p.w * 0.36, p.w * 0.36]) {
        tbx(lod, fm, cx, TOWER_LOBBY_H + (p.h - TOWER_LOBBY_H) * 0.25, p.d / 2 + 0.06, 0.5, (p.h - TOWER_LOBBY_H) * 0.5, 0.24);
      }
      tbx(lod, towerPlainMat(0xfacc15, { emissive: 0xca8a04, emissiveIntensity: 0.5 }), 0, p.h + 1.6, 0, 0.5, 3.2, 0.5);
    }
  },
  slab: {
    lobby: 'residential',
    shaft(g, p, fm, gm, lod) {
      const upper = p.h - TOWER_LOBBY_H;
      const wall = towerFacadeMat(p.frameHex, Math.max(1, Math.round(p.w / 4)), Math.max(2, Math.round(p.h / 7)));
      tbx(g, wall, 0, TOWER_LOBBY_H + upper / 2, 0, p.w, upper, p.d);
      tbx(g, fm, 0, TOWER_LOBBY_H + upper / 2, p.d / 2 + 0.05, p.w * 0.22, upper, 0.18);
      towerBands(lod, fm, p.w, p.d, TOWER_LOBBY_H + 3.2, p.h, 3.2, 0.18, 0.9);
      tbx(lod, fm, 0, p.h + 0.9, 0, p.w * 0.9, 1.8, p.d * 0.9);
    }
  },
  brutalist: {
    lobby: 'corporate',
    shaft(g, p, fm, gm, lod) {
      const upper = p.h - TOWER_LOBBY_H;
      const concrete = towerPlainMat(p.frameHex, { texType: 'concrete', repeatX: 4, repeatY: 10, roughness: 0.9 });
      tbx(g, concrete, 0, TOWER_LOBBY_H + upper / 2, 0, p.w, upper, p.d);
      const rows = Math.max(2, Math.floor(upper / 4));
      const t = [];
      for (let r = 0; r < rows; r++) for (const s of [-1, 1]) {
        xform(t, 0, TOWER_LOBBY_H + 2.4 + r * 4, s * (p.d / 2 + 0.04), p.w * 0.86, 1.5, 0.12);
      }
      flushInstances(lod, UNIT_BOX, towerGlassMat(p.glassHex), t);
      for (const cx of [-p.w / 2, p.w / 2]) tbx(lod, concrete, cx, TOWER_LOBBY_H + upper / 2, 0, 0.6, upper, p.d + 0.3);
      tbx(lod, concrete, 0, p.h + 1.1, 0, p.w + 0.8, 2.2, p.d + 0.8);
    }
  }
};
function towerElevatorKit(g, sk, steel) {
  tbx(g, steel, 0, 1.74, -sk.d / 2 + 1.25, 2.8, 3.4, 1.6);
  const ring = new THREE.Mesh(tGeo(new THREE.RingGeometry(0.85, 1.15, 20)),
    tMat(new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide })));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, 0.10, -sk.d / 2 + 2.4);
  g.add(ring);
  return {
    minX: sk.x - 1.4, maxX: sk.x + 1.4, minY: TOWER_BASE_Y, maxY: 3.6,
    minZ: sk.z - sk.d / 2 + 0.45, maxZ: sk.z - sk.d / 2 + 2.05, tag: 'elev_shaft', climbable: false
  };
}
const TOWER_INTERIORS = {
  corporate(sk, g) {
    const dark = towerPlainMat(0x0f172a);
    const gold = towerPlainMat(0xf59e0b, { metalness: 0.85, roughness: 0.2 });
    const couch = towerPlainMat(0x334155, { texType: 'fabric', roughness: 0.9 });
    const steel = towerPlainMat(0xdbeafe, { texType: 'brushedsteel', metalness: 0.9, roughness: 0.2, flatShading: false });
    tbx(g, dark, -2.2, 0.56, 0.4, 4.2, 1.05, 1.2);
    tbx(g, gold, -2.2, 1.12, 0.4, 4.3, 0.08, 1.3);
    tbx(g, couch, -sk.w / 2 + 1.3, 0.42, -1.2, 1.1, 0.72, 2.8);
    tbx(g, couch, sk.w / 2 - 1.3, 0.42, -1.2, 1.1, 0.72, 2.8);
    const planter = new THREE.Mesh(tGeo(new THREE.CylinderGeometry(0.55, 0.45, 0.75, 10)), towerPlainMat(0x78350f));
    planter.position.set(3.2, 0.42, 1.4);
    const plant = new THREE.Mesh(tGeo(new THREE.DodecahedronGeometry(0.75, 0)), towerPlainMat(0x16a34a));
    plant.position.set(3.2, 1.15, 1.4);
    g.add(planter, plant);
    return [
      { minX: sk.x - 4.3, maxX: sk.x - 0.1, minY: TOWER_BASE_Y, maxY: 1.32, minZ: sk.z - 0.2, maxZ: sk.z + 1.0, tag: 'lobby_desk', climbable: true },
      towerElevatorKit(g, sk, steel)
    ];
  },
  finance(sk, g) {
    const marble = towerMarbleMat();
    const granite = towerPlainMat(0x1e293b, { texType: 'granite', repeatX: 3, repeatY: 1, roughness: 0.25, flatShading: false });
    const gold = towerPlainMat(0xfbbf24, { metalness: 0.94, roughness: 0.15, flatShading: false });
    const steel = towerPlainMat(0x94a3b8, { texType: 'brushedsteel', metalness: 0.94, roughness: 0.18, flatShading: false });
    const rope = towerPlainMat(0x7f1d1d, { roughness: 0.8 });
    tbx(g, marble, -1.8, 0.58, -0.6, 6.4, 1.05, 1.1);
    tbx(g, granite, -1.8, 1.15, -0.6, 6.6, 0.12, 1.25);
    tbx(g, realWindowGlassMat, -1.8, 1.75, -0.6, 6.0, 1.1, 0.08, false);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      tbx(g, gold, sk.w / 2 - 2.4 + c * 0.5, 0.24 + r * 0.19, -sk.d / 2 + 1.6, 0.42, 0.18, 0.22);
    }
    for (const px of [-3.4, -0.2, 3.0]) {
      tbx(g, steel, px, 0.5, 2.4, 0.1, 1.0, 0.1);
      tbx(g, rope, px + 1.6, 0.86, 2.4, 3.2, 0.06, 0.06);
    }
    return [
      { minX: sk.x - 5.0, maxX: sk.x + 1.4, minY: TOWER_BASE_Y, maxY: 1.4, minZ: sk.z - 1.2, maxZ: sk.z, tag: 'lobby_teller', climbable: true },
      towerElevatorKit(g, sk, steel)
    ];
  },
  residential(sk, g) {
    const wall = towerPlainMat(0xe2e8f0, { texType: 'siding', repeatX: 3, repeatY: 2 });
    const brass = towerPlainMat(0xd97706, { metalness: 0.85, roughness: 0.3 });
    const couch = towerPlainMat(0x475569, { texType: 'fabric', roughness: 0.92 });
    const steel = towerPlainMat(0xcbd5e1, { texType: 'brushedsteel', metalness: 0.9, roughness: 0.22, flatShading: false });
    tbx(g, wall, -sk.w / 2 + 0.9, 1.3, 0.6, 0.5, 2.2, 4.4);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
      tbx(g, brass, -sk.w / 2 + 1.2, 0.55 + r * 0.5, -1.3 + c * 0.62, 0.08, 0.4, 0.52);
    }
    tbx(g, couch, sk.w / 2 - 1.5, 0.42, 1.0, 1.2, 0.72, 2.6);
    tbx(g, towerPlainMat(0x78350f, { texType: 'wood' }), sk.w / 2 - 3.0, 0.3, 1.0, 1.0, 0.5, 1.4);
    for (let i = 0; i < 3; i++) tbx(g, steel, -1.0 + i * 0.9, 0.55, -sk.d / 2 + 3.4, 0.08, 1.1, 0.7);
    return [
      { minX: sk.x - sk.w / 2 + 0.4, maxX: sk.x - sk.w / 2 + 1.4, minY: TOWER_BASE_Y, maxY: 2.4, minZ: sk.z - 1.6, maxZ: sk.z + 2.8, tag: 'lobby_mail', climbable: false },
      towerElevatorKit(g, sk, steel)
    ];
  }
};
function buildTower(p) {
  const A = TOWER_ARCHETYPES[p.a] || TOWER_ARCHETYPES.glass;
  const w = p.w, d = p.d, h = p.h, x = p.x, z = p.z;
  const baseY = p.baseY == null ? TOWER_BASE_Y : p.baseY;
  const fm = towerFrameMat(p.frameHex), gm = towerGlassMat(p.glassHex);
  const g = new THREE.Group();
  g.position.set(x, baseY, z);
  g.userData.studioName = p.name;
  tbx(g, towerMarbleMat(), 0, 0.04, 0, w - 0.2, 0.08, d - 0.2, false);
  tbx(g, fm, 0, TOWER_LOBBY_H / 2, -d / 2 + TOWER_WALL_T / 2, w, TOWER_LOBBY_H, TOWER_WALL_T);
  tbx(g, fm, -w / 2 + TOWER_WALL_T / 2, TOWER_LOBBY_H / 2, 0, TOWER_WALL_T, TOWER_LOBBY_H, d);
  tbx(g, fm, w / 2 - TOWER_WALL_T / 2, TOWER_LOBBY_H / 2, 0, TOWER_WALL_T, TOWER_LOBBY_H, d);
  const segW = (w - TOWER_DOOR_W) / 2;
  tbx(g, fm, -(TOWER_DOOR_W / 2 + segW / 2), TOWER_LOBBY_H / 2, d / 2 - TOWER_WALL_T / 2, segW, TOWER_LOBBY_H, TOWER_WALL_T);
  tbx(g, fm, TOWER_DOOR_W / 2 + segW / 2, TOWER_LOBBY_H / 2, d / 2 - TOWER_WALL_T / 2, segW, TOWER_LOBBY_H, TOWER_WALL_T);
  tbx(g, fm, 0, TOWER_LOBBY_H - 0.65, d / 2 - TOWER_WALL_T / 2, TOWER_DOOR_W, 1.3, TOWER_WALL_T);
  const lod = new THREE.Group();
  A.shaft(g, p, fm, gm, lod);
  tbx(g, fm, 0, h + 0.275, 0, w + 0.5, 0.55, d + 0.5);
  const glazing = towerGlassMat(p.glassHex);
  tbx(lod, glazing, -w / 2 - 0.02, 2.0, 0, 0.1, 2.7, d - 3.0, false);
  tbx(lod, glazing, w / 2 + 0.02, 2.0, 0, 0.1, 2.7, d - 3.0, false);
  tbx(lod, glazing, 0, 2.0, -d / 2 - 0.02, w - 3.0, 2.7, 0.1, false);
  for (const s of [-1, 1]) tbx(lod, glazing, s * (TOWER_DOOR_W / 2 + segW / 2), 2.0, d / 2 + 0.02, segW - 0.9, 2.7, 0.1, false);
  createNeonSign(lod, p.name, 0, 3.9, d / 2 + 0.1, '#090d14', '#38bdf8', Math.min(w - 2, 7.6), 0.95);
  const dark = towerPlainMat(0x0f172a, { metalness: 0.8, roughness: 0.3 });
  tbx(lod, dark, 0, h + 0.5, d / 2 - 0.15, w, 1.0, 0.3);
  tbx(lod, dark, 0, h + 0.5, -d / 2 + 0.15, w, 1.0, 0.3);
  tbx(lod, dark, w / 2 - 0.15, h + 0.5, 0, 0.3, 1.0, d);
  tbx(lod, dark, -w / 2 + 0.15, h + 0.5, 0, 0.3, 1.0, d);
  tbx(lod, towerPlainMat(0x64748b), -w / 2 + 2.2, h + 0.7, -d / 2 + 2.0, 2.2, 1.3, 1.6);
  const mast = new THREE.Mesh(tGeo(new THREE.CylinderGeometry(0.08, 0.12, 10, 6)), dark);
  mast.position.set(w / 2 - 1.2, h + 5, -d / 2 + 1.2);
  lod.add(mast);
  const beacon = new THREE.Mesh(tGeo(new THREE.SphereGeometry(0.28, 8, 8)), tMat(new THREE.MeshBasicMaterial({ color: 0xef4444 })));
  beacon.position.set(w / 2 - 1.2, h + 10.2, -d / 2 + 1.2);
  aviationBeacons.push(beacon);
  lod.add(beacon);
  if (p.heli) {
    const pad = new THREE.Mesh(tGeo(new THREE.CylinderGeometry(4.2, 4.2, 0.12, 20)), towerPlainMat(0x334155));
    pad.position.y = h + 0.60;
    g.add(pad);
    const ring = new THREE.Mesh(tGeo(new THREE.RingGeometry(3.5, 3.95, 24)), tMat(new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide })));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = h + 0.67;
    lod.add(ring);
    const white = towerPlainMat(0xf8fafc);
    tbx(lod, white, -0.9, h + 0.68, 0, 0.45, 0.08, 2.6, false);
    tbx(lod, white, 0.9, h + 0.68, 0, 0.45, 0.08, 2.6, false);
    tbx(lod, white, 0, h + 0.68, 0, 1.8, 0.08, 0.45, false);
  } else {
    tbx(lod, dark, 0, h + 1.2, 0, w * 0.7, 2.2, d * 0.7);
    tbx(lod, tMat(new THREE.MeshBasicMaterial({ color: p.glassHex })), 0, h + 3.4, 0, w * 0.4, 2.2, d * 0.4);
  }
  const liftRing = new THREE.Mesh(tGeo(new THREE.RingGeometry(0.85, 1.15, 20)), tMat(new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide })));
  liftRing.rotation.x = -Math.PI / 2;
  liftRing.position.set(0, h + 0.58, d / 2 - 1.8);
  lod.add(liftRing);
  g.add(lod);
  registerBuildingLod(x, z, lod);
  worldRoot.add(g);
  const minX = x - w / 2, maxX = x + w / 2, minZ = z - d / 2, maxZ = z + d / 2;
  addWorldBox(minX, maxX, baseY, baseY + TOWER_LOBBY_H, minZ, minZ + TOWER_WALL_T, 'wall', false);
  addWorldBox(minX, minX + TOWER_WALL_T, baseY, baseY + TOWER_LOBBY_H, minZ, maxZ, 'wall', false);
  addWorldBox(maxX - TOWER_WALL_T, maxX, baseY, baseY + TOWER_LOBBY_H, minZ, maxZ, 'wall', false);
  addWorldBox(minX, x - TOWER_DOOR_W / 2, baseY, baseY + TOWER_LOBBY_H, maxZ - TOWER_WALL_T, maxZ, 'wall', false);
  addWorldBox(x + TOWER_DOOR_W / 2, maxX, baseY, baseY + TOWER_LOBBY_H, maxZ - TOWER_WALL_T, maxZ, 'wall', false);
  addWorldBox(minX, maxX, baseY + TOWER_LOBBY_H, baseY + h + 0.55, minZ, maxZ, 'skyscraper_roof', true);
  const roofY = baseY + h + 0.55;
  const rec = {
    x, z, w, d, h, roofY, name: p.name, minX, maxX, minZ, maxZ,
    archetype: p.a, interiorKind: A.lobby,
    lobbyPad: { x, y: baseY, z: z - d / 2 + 2.0 },
    roofPad: { x, y: roofY, z: z + d / 2 - 1.8 },
    interiorLoaded: false, interiorGroup: null, interiorBoxes: [], interiorCache: null, interiorSpecs: null
  };
  skyscrapers.push(rec);
  enterableZones.push({ minX: minX + 0.3, maxX: maxX - 0.3, minZ: minZ + 0.3, maxZ: maxZ - 0.2, name: `${p.name} LOBBY` });
  mapShapes.push({ x, z, w, d, color: '#0284c7', border: '#38bdf8', enterable: true });
  return rec;
}
/** One line per tower. `pad` builds a sidewalk plinth under an out-of-grid lot.
 *  EXTENSION POINT: append rows here — every lot is validated before it builds. */
const TOWER_PLACEMENTS = [
  // Sunnyvale financial district
  { a: 'glass', x: -48, z: -96, w: 14.5, d: 14.5, h: 48, glassHex: 0x0284c7, frameHex: 0x0f172a, name: 'AURA CORP HQ', heli: true },
  { a: 'glass', x: 48, z: -96, w: 14.5, d: 14.5, h: 54, glassHex: 0x0d9488, frameHex: 0x1e293b, name: 'SUNNYVALE EXCHANGE', heli: false },
  { a: 'glass', x: -96, z: -96, w: 14.0, d: 14.0, h: 42, glassHex: 0x2563eb, frameHex: 0x1e293b, name: 'WESTSIDE TOWER', heli: true },
  { a: 'glass', x: 96, z: -96, w: 14.0, d: 14.0, h: 46, glassHex: 0x0369a1, frameHex: 0x0f172a, name: 'EASTGATE PLAZA', heli: false },
  { a: 'deco', x: 0, z: -144, w: 16.0, d: 16.0, h: 64, glassHex: 0x38bdf8, frameHex: 0x090d14, name: 'APEX PINNACLE', heli: true },
  { a: 'glass', x: -48, z: -144, w: 14.5, d: 14.5, h: 52, glassHex: 0x1d4ed8, frameHex: 0x1e293b, name: 'HORIZON FINANCIAL', heli: false },
  { a: 'glass', x: 48, z: -144, w: 14.5, d: 14.5, h: 56, glassHex: 0x0f766e, frameHex: 0x0f172a, name: 'PACIFIC TOWERS', heli: true },
  { a: 'glass', x: -96, z: -144, w: 14.0, d: 14.0, h: 44, glassHex: 0x4f46e5, frameHex: 0x1e293b, name: 'NORTHERN STAR', heli: false },
  { a: 'glass', x: 96, z: -144, w: 14.0, d: 14.0, h: 50, glassHex: 0x0284c7, frameHex: 0x0f172a, name: 'HARBOR VIEW HQ', heli: true },
  // Sunnyvale west terrace
  { a: 'slab', x: -162, z: -96, w: 14, d: 14, h: 38, glassHex: 0x7dd3fc, frameHex: 0x8c8172, name: 'TERRACE COURT', heli: false, pad: true },
  { a: 'brutalist', x: -162, z: -48, w: 14, d: 14, h: 44, glassHex: 0x93c5fd, frameHex: 0x6b7280, name: 'WESTBANK HOUSE', heli: false, pad: true },
  { a: 'slab', x: -162, z: 0, w: 14, d: 14, h: 34, glassHex: 0xfcd34d, frameHex: 0x9a8478, name: 'MERIDIAN FLATS', heli: false, pad: true },
  { a: 'brutalist', x: -162, z: 48, w: 14, d: 14, h: 46, glassHex: 0x67e8f9, frameHex: 0x57534e, name: 'CIVIC ANNEX', heli: false, pad: true },
  { a: 'slab', x: -162, z: 96, w: 14, d: 14, h: 32, glassHex: 0xa7f3d0, frameHex: 0x8c8172, name: 'NORTHGATE FLATS', heli: false, pad: true },
  // Downtown Los Aura landmarks
  { a: 'glass', x: -36, z: 540, w: 18.0, d: 18.0, h: 86, glassHex: 0x38bdf8, frameHex: 0xe2e8f0, name: 'US AURA TOWER', heli: true },
  { a: 'glass', x: 12, z: 540, w: 16.5, d: 15.0, h: 80, glassHex: 0x0284c7, frameHex: 0x0f172a, name: 'WILSHIRE GRAND', heli: false },
  { a: 'glass', x: -84, z: 540, w: 15.5, d: 15.5, h: 72, glassHex: 0x1e3a8a, frameHex: 0xf8fafc, name: 'AON AURA CENTER', heli: true },
  { a: 'glass', x: 60, z: 540, w: 16.0, d: 16.0, h: 68, glassHex: 0x0f766e, frameHex: 0x1e293b, name: 'SOCAL GAS TOWER', heli: false },
  { a: 'deco', x: -36, z: 636, w: 18.0, d: 18.0, h: 52, glassHex: 0xe2e8f0, frameHex: 0xf8fafc, name: 'LOS AURA CITY HALL', heli: false },
  { a: 'glass', x: 12, z: 636, w: 15.0, d: 15.0, h: 62, glassHex: 0x2563eb, frameHex: 0x0f172a, name: 'FIGUEROA AT WILSHIRE', heli: true },
  { a: 'glass', x: 60, z: 588, w: 14.5, d: 14.5, h: 58, glassHex: 0x0d9488, frameHex: 0x1e293b, name: 'BUNKER HILL PLAZA', heli: false },
  { a: 'glass', x: 60, z: 636, w: 14.5, d: 14.5, h: 54, glassHex: 0x0369a1, frameHex: 0x0f172a, name: 'BROADWAY TRADE CENTER', heli: true },
  { a: 'glass', x: 104, z: 540, w: 13.5, d: 14.5, h: 50, glassHex: 0x4f46e5, frameHex: 0x1e293b, name: 'ARTS DISTRICT TOWER', heli: false },
  { a: 'glass', x: 104, z: 588, w: 13.5, d: 14.5, h: 46, glassHex: 0x0284c7, frameHex: 0x1e293b, name: 'LITTLE TOKYO PLAZA', heli: true },
  // Downtown infill on validated empty blocks (104/492 is the AURA ARMORY)
  { a: 'deco', x: -84, z: 492, w: 16, d: 16, h: 56, glassHex: 0xfbbf24, frameHex: 0x1c1917, name: 'SOUTHERN EXCHANGE', heli: false },
  { a: 'brutalist', x: -36, z: 588, w: 16, d: 16, h: 60, glassHex: 0x93c5fd, frameHex: 0x6b7280, name: 'HARBOR COMMERCE', heli: true },
  { a: 'slab', x: -84, z: 636, w: 16, d: 16, h: 48, glassHex: 0xfcd34d, frameHex: 0x9a8478, name: 'CIVIC GARDENS', heli: false },
  { a: 'glass', x: 104, z: 636, w: 14, d: 14, h: 52, glassHex: 0x22d3ee, frameHex: 0x0f172a, name: 'EASTLAKE TOWER', heli: false },
  // Los Aura west bank
  { a: 'glass', x: -175, z: 480, w: 16, d: 16, h: 64, glassHex: 0x0ea5e9, frameHex: 0x0f172a, name: 'WEST BANK ONE', heli: true, pad: true },
  { a: 'slab', x: -215, z: 480, w: 16, d: 16, h: 44, glassHex: 0xfcd34d, frameHex: 0x8c8172, name: 'SHORELINE FLATS', heli: false, pad: true },
  { a: 'deco', x: -175, z: 540, w: 16, d: 16, h: 70, glassHex: 0x38bdf8, frameHex: 0xe2e8f0, name: 'PACIFIC CROWN', heli: true, pad: true },
  { a: 'brutalist', x: -215, z: 540, w: 16, d: 16, h: 50, glassHex: 0x93c5fd, frameHex: 0x57534e, name: 'WEST BANK CIVIC', heli: false, pad: true },
  { a: 'glass', x: -175, z: 600, w: 16, d: 16, h: 58, glassHex: 0x0d9488, frameHex: 0x1e293b, name: 'CHANNEL HOUSE', heli: false, pad: true },
  { a: 'slab', x: -215, z: 600, w: 16, d: 16, h: 40, glassHex: 0xa7f3d0, frameHex: 0x9a8478, name: 'MARINA COURT', heli: false, pad: true },
  { a: 'brutalist', x: -175, z: 660, w: 16, d: 16, h: 54, glassHex: 0x67e8f9, frameHex: 0x6b7280, name: 'NORTHSHORE ANNEX', heli: false, pad: true },
  { a: 'glass', x: -215, z: 660, w: 16, d: 16, h: 46, glassHex: 0x2563eb, frameHex: 0x0f172a, name: 'NORTHSHORE TOWER', heli: false, pad: true }
];
function buildWestBankRoads() {
  const asphalt = towerPlainMat(0x313946, { texType: 'asphalt', repeatX: 2, repeatY: 30, roughness: 0.86 });
  const kerb = towerPlainMat(0xcbd5e1, { texType: 'sidewalk', repeatX: 8, repeatY: 8, roughness: 0.85 });
  const pave = (w, d, x, z) => {
    tbx(worldRoot, asphalt, x, 0.20, z, w, 0.08, d, false);
    addWorldBox(x - w / 2, x + w / 2, 0.16, 0.24, z - d / 2, z + d / 2, 'westbank_road', true);
    reserveFootprint(x - w / 2 - 1, x + w / 2 + 1, z - d / 2 - 1, z + d / 2 + 1, 'road');
  };
  pave(12, 248, -145, 570);
  mapShapes.push({ x: -145, z: 570, w: 12, d: 248, color: '#334155', border: '#475569', enterable: false });
  for (const z of [480, 540, 600, 660]) {
    pave(26, 12, -126, z);
    tbx(worldRoot, kerb, -195, 0.21, z, 60, 0.10, 44, false);
  }
}
/** Build every tower in the table. Rejected lots are logged, never forced. */
export function buildTowerDistricts() {
  buildWestBankRoads();
  const kerb = towerPlainMat(0xcbd5e1, { texType: 'sidewalk', repeatX: 8, repeatY: 8, roughness: 0.85 });
  let built = 0;
  for (const p of TOWER_PLACEMENTS) {
    if (!footprintClear(p.x, p.z, p.w, p.d)) {
      console.warn('[towers] lot rejected (blocked):', p.name, p.x, p.z);
      continue;
    }
    if (p.pad) tbx(worldRoot, kerb, p.x, (p.baseY == null ? TOWER_BASE_Y : p.baseY) + 0.03, p.z, p.w + 9, 0.12, p.d + 9, false);
    buildTower(p);
    built++;
  }
  console.log(`[towers] ${built}/${TOWER_PLACEMENTS.length} towers placed`);
}
export function updateSkyscraperInteriors() {
  const LOAD2 = 56 * 56, UNLOAD2 = 70 * 70;
  for (let i = 0; i < skyscrapers.length; i++) {
    const sk = skyscrapers[i];
    const d2 = dist2(sk.x, sk.z, player.x, player.z);
    if (!sk.interiorLoaded && d2 < LOAD2) {
      let ig = sk.interiorCache;
      if (!ig) {
        ig = new THREE.Group();
        ig.position.set(sk.x, TOWER_BASE_Y, sk.z);
        const maker = TOWER_INTERIORS[sk.interiorKind] || TOWER_INTERIORS.corporate;
        sk.interiorSpecs = maker(sk, ig);
        sk.interiorCache = ig;
      }
      worldRoot.add(ig);
      sk.interiorGroup = ig;
      sk.interiorBoxes = (sk.interiorSpecs || []).map((b) =>
        addWorldBox(b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ, b.tag, b.climbable));
      sk.interiorLoaded = true;
    } else if (sk.interiorLoaded && d2 > UNLOAD2) {
      if (sk.interiorGroup) { worldRoot.remove(sk.interiorGroup); sk.interiorGroup = null; }
      for (const b of sk.interiorBoxes) {
        const idx = worldBoxes.indexOf(b);
        if (idx !== -1) worldBoxes.splice(idx, 1);
      }
      sk.interiorBoxes = [];
      sk.interiorLoaded = false;
    }
  }
}
function disposeTowerInteriors() {
  for (const sk of skyscrapers) {
    const ig = sk.interiorCache;
    if (ig && ig.parent) ig.parent.remove(ig);
    sk.interiorCache = null;
    sk.interiorGroup = null;
    sk.interiorBoxes = [];
    sk.interiorSpecs = null;
    sk.interiorLoaded = false;
  }
}
function resetTowerSystem() {
  reservedFootprints.length = 0;
  towerMatCache.clear();
  towerFacadeCache.clear();
  // UNIT_BOX is module-permanent and shared with the whole world — never disposed here.
  for (const g of towerGeos) g.dispose();
  for (const m of towerMats) {
    if (m.map && m.map.isCanvasTexture) m.map.dispose();
    m.dispose();
  }
  towerGeos.length = 0;
  towerMats.length = 0;
}
/** Back-compatible entry points for Studio and any external caller. */
export function buildSkyscraperBase(o) {
  const heli = o.hasHelipad !== undefined ? o.hasHelipad : (o.heli !== undefined ? o.heli : true);
  return buildTower(Object.assign({
    a: 'glass', w: 13.5, d: 13.5, h: 44, glassHex: 0x0ea5e9, frameHex: 0x1e293b, name: 'AURA TOWER'
  }, o, { heli }));
}
export function buildSkyscraper(o) { return buildSkyscraperBase(o); }
/** Roof kit is built by every archetype; kept so external calls still work. */
export function embellishTower({ x, z, w = 13.5, d = 13.5, h = 44, glassHex = 0x0ea5e9, hasHelipad = true }) {
  const g = new THREE.Group();
  g.position.set(x, 0.18, z);
  g.userData.studioName = 'Tower roof kit';
  worldRoot.add(g);
  const dark = makeMat(0x0f172a, { metalness: 0.8, roughness: 0.3 });
  const add = (sx, sy, sz, m, px, py, pz) => makeBox(g, sx, sy, sz, px, py, pz, m, { cast: true });
  add(w, 1.0, 0.3, dark, 0, h + 0.5, d / 2 - 0.15);
  add(w, 1.0, 0.3, dark, 0, h + 0.5, -d / 2 + 0.15);
  add(0.3, 1.0, d, dark, w / 2 - 0.15, h + 0.5, 0);
  add(0.3, 1.0, d, dark, -w / 2 + 0.15, h + 0.5, 0);
  if (!hasHelipad) {
    add(w * 0.7, 2.2, d * 0.7, dark, 0, h + 1.2, 0);
    add(w * 0.4, 2.2, d * 0.4, new THREE.MeshBasicMaterial({ color: glassHex }), 0, h + 3.4, 0);
  }
  return g;
}

// -----------------------------------------------------------------------------
// Street props
// -----------------------------------------------------------------------------
export function buildKnockableLamppost(x, z) {
  const poleMat = makeMat(0xcbd5e1, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.20, flatShading: false });
  const bulbMat = makeMat(0xfef08a, { emissive: 0xfacc15, emissiveIntensity: 0.95 });
  const pivot = new THREE.Group();
  pivot.userData.studioName = 'Streetlight';
  pivot.position.set(x, 0.18, z);
  const baseFlange = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.14, 10), poleMat);
  baseFlange.position.y = 0.07;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 4.4, 8), poleMat);
  pole.position.y = 2.2;
  pole.castShadow = true;
  const arm = makeBox(pivot, 0.10, 0.10, 0.75, 0, 4.35, 0.32, poleMat);
  const lamp = makeBox(pivot, 0.38, 0.22, 0.46, 0, 4.24, 0.62, bulbMat);
  pivot.remove(arm, lamp);
  pivot.add(baseFlange, pole, arm, lamp);
  worldRoot.add(pivot);
  const boxRef = addWorldBox(x - 0.18, x + 0.18, 0.18, 4.6, z - 0.18, z + 0.18, 'lamppost', false);
  const lp = { x, z, pivot, lampMat: bulbMat, boxRef, state: 'standing', fallYaw: 0, fallAngle: 0, fallVel: 0, respawnTimer: 0 };
  lampPosts.push(lp);
  return lp;
}
export function knockOverLamppostBase(lp, impactYaw, impactSpeed = 6) {
  if (lp.state !== 'standing') return;
  lp.state = 'falling';
  lp.fallYaw = impactYaw;
  lp.fallAngle = 0.05;
  lp.fallVel = Math.max(2.6, Math.min(7.5, impactSpeed * 0.45));
  lp.respawnTimer = 16.0;
  lp.boxRef.minY = 999;
  lp.boxRef.maxY = 1000;
  sfx.metalClang();
  spawnParticles(lp.x, 1.4, lp.z, 0xfacc15, 10, 6.0);
}
export function updateLampposts(dt, elapsed) {
  const guest = hooks.mpIsGuest();
  for (let i = 0; i < lampPosts.length; i++) {
    const lp = lampPosts[i];
    if (lp.state === 'standing') continue;
    if (lp.state === 'falling') {
      lp.fallVel += 9.5 * dt;
      lp.fallAngle += lp.fallVel * dt;
      if (lp.fallAngle >= Math.PI / 2 - 0.03) {
        lp.fallAngle = Math.PI / 2 - 0.03;
        lp.state = 'down';
        sfx.hit();
        spawnParticles(lp.x + Math.sin(lp.fallYaw) * 4.2, 0.35, lp.z + Math.cos(lp.fallYaw) * 4.2, 0xfef08a, 6, 4.0);
      }
      lp.pivot.rotation.order = 'YXZ';
      lp.pivot.rotation.y = lp.fallYaw;
      lp.pivot.rotation.x = lp.fallAngle;
    } else if (lp.state === 'down') {
      const flickerWave = Math.sin(elapsed * 31 + i * 3.7) * Math.cos(elapsed * 47 + i * 1.9);
      const isOn = flickerWave > 0.12;
      lp.lampMat.emissiveIntensity = isOn ? 1.8 : 0.0;
      lp.lampMat.color.setHex(isOn ? 0xfef08a : 0x334155);
      if (guest) continue;
      lp.respawnTimer -= dt;
      if (lp.respawnTimer <= 0) {
        const clearOfPlayer = dist2(player.x, player.z, lp.x, lp.z) > 4.84;
        const clearOfCars = vehicles.every((v) => dist2(v.x, v.z, lp.x, lp.z) > 10.24);
        if (clearOfPlayer && clearOfCars) {
          lp.state = 'standing';
          lp.fallAngle = 0;
          lp.fallVel = 0;
          lp.pivot.rotation.set(0, 0, 0);
          lp.lampMat.emissiveIntensity = 0.95;
          lp.lampMat.color.setHex(0xfef08a);
          lp.boxRef.minY = 0.18;
          lp.boxRef.maxY = 4.6;
          spawnParticles(lp.x, 1.0, lp.z, 0x38bdf8, 6, 3.0);
          hooks.mpWorldEvent({ t: 'lamp_up', i });
        }
      }
    }
  }
}
export function createTree(x, z, scale = 1, baseY = 0.18) {
  const g = new THREE.Group();
  g.position.set(x, baseY, z);
  g.scale.setScalar(scale);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.35, 1.8, 6), treeBarkMaterial);
  trunk.position.y = 0.9;
  trunk.castShadow = true;
  const c1 = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.3, 6), treeLeafMaterial);
  c1.position.y = 2.4;
  c1.castShadow = true;
  const c2 = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.9, 6), treeLeafMaterial);
  c2.position.y = 3.65;
  c2.castShadow = true;
  const c3 = regHigh(new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.5, 6), treeLeafMaterial));
  c3.position.y = 4.7;
  c3.castShadow = true;
  g.add(trunk, c1, c2, c3);
  worldRoot.add(g);
  addWorldBox(x - 0.38 * scale, x + 0.38 * scale, baseY, baseY + 2.2 * scale, z - 0.38 * scale, z + 0.38 * scale, 'tree', false);
}
export function createHydrant(x, z) {
  const h = new THREE.Group();
  h.position.set(x, 0.18, z);
  const redMat = makeMat(0xdc2626, { metalness: 0.82, roughness: 0.24, clearcoat: 0.6, flatShading: false });
  const chromeCapMat = makeMat(0xe2e8f0, { metalness: 0.94, roughness: 0.15, flatShading: false });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.65, 10), redMat);
  body.position.y = 0.325;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), chromeCapMat);
  cap.position.y = 0.66;
  const side = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.42, 8), chromeCapMat);
  side.rotation.z = Math.PI / 2;
  side.position.y = 0.46;
  h.add(body, cap, side);
  worldRoot.add(h);
  addWorldBox(x - 0.2, x + 0.2, 0.18, 0.88, z - 0.2, z + 0.2, 'hydrant', true);
}
export function createBusShelter(x, z, rotY = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0.18, z);
  g.rotation.y = rotY;
  const chromeMat = makeMat(0xe2e8f0, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.18, flatShading: false });
  const roof = makeBox(g, 3.8, 0.12, 1.5, 0, 2.45, 0, chromeMat, { cast: true });
  const backGlass = makeBox(g, 3.5, 2.2, 0.06, 0, 1.25, -0.62, realWindowGlassMat);
  const bench = makeBox(g, 3.0, 0.10, 0.48, 0, 0.55, -0.32, makeMat(0xb45309, { texType: 'wood' }));
  g.remove(roof, backGlass, bench);
  for (const [px, pz] of [[-1.75, -0.62], [1.75, -0.62], [-1.75, 0.62], [1.75, 0.62]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.45, 8), chromeMat);
    post.position.set(px, 1.225, pz);
    g.add(post);
  }
  g.add(roof, backGlass, bench);
  worldRoot.add(g);
  const cos = Math.abs(Math.cos(rotY)), sin = Math.abs(Math.sin(rotY));
  const hw = (3.8 * cos + 1.5 * sin) / 2, hd = (3.8 * sin + 1.5 * cos) / 2;
  addWorldBox(x - hw, x + hw, 2.38, 2.68, z - hd, z + hd, 'shelter_roof', true);
}

// -----------------------------------------------------------------------------
// City landmarks
// -----------------------------------------------------------------------------
export function buildCityLandmarks() {
  const cobbleMat = makeMat(0xa8a29e, { texType: 'cobblestone', repeatX: 3, repeatY: 18, roughness: 0.78, bumpScale: 0.025 });
  makeBox(worldRoot, 4.6, 0.05, 36, 0, 0.21, 0, cobbleMat, { recv: true });
  makeBox(worldRoot, 36, 0.05, 4.6, 0, 0.21, 0, cobbleMat, { recv: true });
  const courtyard = new THREE.Mesh(new THREE.CylinderGeometry(6.8, 7.0, 0.06, 20), cobbleMat);
  courtyard.position.set(0, 0.215, 0);
  courtyard.receiveShadow = true;
  worldRoot.add(courtyard);
  const marbleMat = makeMat(0xf8fafc, { texType: 'marble', repeatX: 3, repeatY: 2, roughness: 0.20, clearcoat: 0.85, flatShading: false });
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.78, 18), marbleMat);
  rim.position.set(0, 0.57, 0);
  rim.castShadow = true;
  const water = new THREE.Mesh(new THREE.CylinderGeometry(3.05, 3.05, 0.72, 18), makeMat(0x0ea5e9, {
    texType: 'water', repeatX: 3, repeatY: 3, roughness: 0.07, metalness: 0.28, clearcoat: 1.0,
    emissive: 0x0284c7, emissiveIntensity: 0.25, flatShading: false
  }));
  water.position.set(0, 0.58, 0);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.85, 1.7, 14), marbleMat);
  pillar.position.set(0, 1.4, 0);
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 0.9, 0.45, 16), marbleMat);
  basin.position.set(0, 2.2, 0);
  worldRoot.add(rim, water, pillar, basin);
  addWorldBox(-3.2, 3.2, 0.18, 0.96, -3.2, 3.2, 'fountain_rim', true);
  addWorldBox(-1.35, 1.35, 0.96, 2.42, -1.35, 1.35, 'fountain_top', true);
  mapShapes.push({ x: 0, z: 0, w: 30, d: 30, color: '#22c55e', border: '#15803d', enterable: false });
  const benchSteel = makeMat(0xcbd5e1, { metalness: 0.9, roughness: 0.2, flatShading: false });
  for (const [bx, bz, rot] of [[0, 5.8, Math.PI], [0, -5.8, 0], [5.8, 0, -Math.PI / 2], [-5.8, 0, Math.PI / 2]]) {
    const bGroup = new THREE.Group();
    bGroup.position.set(bx, 0.18, bz);
    bGroup.rotation.y = rot;
    const seat = makeBox(bGroup, 2.2, 0.12, 0.72, 0, 0.44, 0, makeMat(0xb45309, { texType: 'wood' }), { cast: true });
    const legL = makeBox(bGroup, 0.12, 0.46, 0.74, -0.95, 0.23, 0, benchSteel);
    const legR = makeBox(bGroup, 0.12, 0.46, 0.74, 0.95, 0.23, 0, benchSteel);
    bGroup.remove(seat, legL, legR);
    bGroup.add(seat, legL, legR);
    worldRoot.add(bGroup);
    const bw = Math.abs(Math.cos(rot)) > 0.5 ? 2.2 : 0.75;
    const bd = Math.abs(Math.cos(rot)) > 0.5 ? 0.75 : 2.2;
    addWorldBox(bx - bw / 2, bx + bw / 2, 0.18, 0.70, bz - bd / 2, bz + bd / 2, 'bench', true);
  }
  placeProps('tree', [[-10.5, -10.5, 1.1], [10.5, -10.5, 1.1], [-10.5, 10.5, 1.1], [10.5, 10.5, 1.1]]);
  buildPlazaHotdogCart(11.8, 12.2);
  buildHotdogStore(-39.5, -39.5);
  buildCarDealership(0, -48);
  makeBox(worldRoot, 30.6, 0.21, 30.6, -48, 0.105, -48,
    makeMat(0x94a3b8, { texType: 'cobblestone', repeatX: 12, repeatY: 12, bumpScale: 0.02 }));
  const cafeGroup = new THREE.Group();
  cafeGroup.userData.studioName = 'SUNNYVALE DINER';
  const cafe = makeBox(cafeGroup, 9.6, 4.4, 9.2, -54.5, 2.38, -53.5,
    makeMat(0xfde68a, { texType: 'brick', repeatX: 4, repeatY: 2, bumpScale: 0.02 }), { cast: true });
  const cafeGlass = makeBox(cafeGroup, 7.0, 1.8, 0.08, -54.5, 1.5, -48.88, realWindowGlassMat);
  cafeGroup.remove(cafe, cafeGlass);
  cafeGroup.add(cafe, cafeGlass);
  createNeonSign(cafeGroup, 'SUNNYVALE DINER', -54.5, 3.65, -48.82, '#7f1d1d', '#fef08a');
  worldRoot.add(cafeGroup);
  addWorldBox(-59.3, -49.7, 0.18, 4.58, -58.1, -48.9, 'diner_roof', true);
  mapShapes.push({ x: -54.5, z: -53.5, w: 9.6, d: 9.2, color: '#fde68a', border: '#b45309', enterable: false });
  buildReserveBank(0, -96);
  makeBox(worldRoot, 30.6, 0.21, 30.6, 48, 0.105, -48,
    makeMat(0x94a3b8, { texType: 'concrete', repeatX: 10, repeatY: 10 }));
  const aptH = 8.4;
  makeBox(worldRoot, 11, aptH, 16, 43, 0.18 + aptH / 2, -48,
    makeMat(0xb45309, { texType: 'brick', repeatX: 5, repeatY: 4, bumpScale: 0.025 }), { cast: true, recv: true });
  addWorldBox(37.5, 48.5, 0.18, 0.18 + aptH, -56, -40, 'apartment_roof', true);
  mapShapes.push({ x: 43, z: -48, w: 11, d: 16, color: '#b45309', border: '#78350f', enterable: false });
  const steelMat = makeMat(0x94a3b8, { texType: 'diamondplate', repeatX: 2, repeatY: 3, metalness: 0.88, roughness: 0.28, bumpScale: 0.02 });
  for (const st of [{ y: 1.85, z: -54.0 }, { y: 3.70, z: -50.2 }, { y: 5.55, z: -46.4 }, { y: 7.40, z: -42.6 }]) {
    makeBox(worldRoot, 2.2, 0.25, 3.4, 49.6, st.y, st.z, steelMat, { cast: true });
    addWorldBox(48.5, 50.7, st.y - 0.15, st.y + 0.13, st.z - 1.7, st.z + 1.7, 'fire_escape', true);
  }
  const contMat = (hex) => makeMat(hex, { texType: 'corrugated', repeatX: 3, repeatY: 2, metalness: 0.82, roughness: 0.34, bumpScale: 0.03 });
  // [w,h,d, x,y,z, colour, collider]
  const containers = [
    [3.2, 2.3, 6.8, 44, 0.18 + 1.15, 45, 0xdc2626, [42.4, 45.6, 0.18, 2.48, 41.6, 48.4, 'container_low', true]],
    [3.2, 2.3, 6.8, 47.4, 0.18 + 1.15, 47, 0x2563eb, [45.8, 49.0, 0.18, 2.48, 43.6, 50.4, 'container_low2', true]],
    [3.2, 2.2, 6.4, 47.4, 2.48 + 1.1, 47, 0xd97706, [45.8, 49.0, 2.48, 4.68, 43.8, 50.2, 'container_high', true]],
    [3.2, 2.3, 6.4, 37.5, 0.18 + 1.15, 45, 0x0d9488, [35.9, 39.1, 0.18, 2.48, 41.8, 48.2, 'container_west', true]]
  ];
  const contMeshes = containers.map(([w, h, d, x, y, z, hex, box]) =>
    makeBox(worldRoot, w, h, d, x, y, z, contMat(hex), { cast: true, box }));
  const catwalk = makeBox(worldRoot, 5.2, 0.22, 1.8, 40.8, 2.48, 45, steelMat, {
    cast: true, box: [38.2, 43.4, 2.36, 2.59, 44.1, 45.9, 'gantry_catwalk', true]
  });
  for (const m of contMeshes) worldRoot.remove(m);
  worldRoot.remove(catwalk);
  worldRoot.add(...contMeshes, catwalk);
  mapShapes.push({ x: 45.8, z: 46, w: 7, d: 8, color: '#dc2626', border: '#991b1b', enterable: false });
  buildWalkInHouse({ x: -7.5, z: 42.0, w: 9.8, d: 8.6, wallColor: 0xfef3c7, roofColor: 0xb91c1c, label: 'OAKWOOD RESIDENCE' });
  buildWalkInHouse({ x: -41.5, z: -5.5, w: 9.8, d: 8.6, wallColor: 0xdbeafe, roofColor: 0x1e40af, label: 'CEDAR COTTAGE' });
  buildWalkInHouse({ x: 42.5, z: -5.5, w: 9.8, d: 8.6, wallColor: 0xdcfce7, roofColor: 0x166534, label: 'SAGE VILLA' });
  // [x, z, wall, roof, rotY]
  for (const [hx, hz, wc, rc, ry] of [
    [7.5, 53.0, 0xfed7aa, 0x9a3412, Math.PI], [-54.0, 8.0, 0xfce7f3, 0x831843, Math.PI / 2],
    [54.0, 8.0, 0xfef08a, 0x854d0e, -Math.PI / 2], [-54.5, 42.5, 0xe0e7ff, 0x3730a3, 0],
    [-41.5, 54.5, 0xffedd5, 0xc2410c, Math.PI], [55.5, 54.5, 0xd1fae5, 0x065f46, Math.PI],
    [-96.0, -48.0, 0xfde68a, 0x92400e, 0], [-96.0, 0.0, 0xdbeafe, 0x1e3a8a, Math.PI / 2],
    [-96.0, 48.0, 0xfce7f3, 0x9d174d, Math.PI], [96.0, -48.0, 0xdcfce7, 0x14532d, 0],
    [96.0, 0.0, 0xffedd5, 0x9a3412, -Math.PI / 2], [96.0, 48.0, 0xe0e7ff, 0x312e81, Math.PI]
  ]) buildSuburbanHouse({ x: hx, z: hz, wallColor: wc, roofColor: rc, rotY: ry });
  makeBox(worldRoot, 8.5, 1.15, 0.25, 7.5, 0.75, 43.5, makeMat(0xf8fafc, { texType: 'siding' }), {
    cast: true, box: [3.25, 11.75, 0.18, 1.33, 43.35, 43.65, 'yard_fence', true]
  });
  placeProps('shelter', [[-16.2, -6.5, Math.PI / 2], [16.2, 6.5, -Math.PI / 2]]);
  const lampCoords = [];
  for (const bx of [-96, -48, 0, 48, 96]) for (const bz of [-144, -96, -48, 0, 48]) {
    lampCoords.push([bx - 16.8, bz - 16.8], [bx + 16.8, bz + 16.8]);
  }
  placeProps('lamppost', lampCoords);
  const poleMat = makeMat(0xcbd5e1, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.20, flatShading: false });
  const mailboxMat = makeMat(0x1d4ed8, { metalness: 0.85, roughness: 0.22, clearcoat: 0.7, flatShading: false });
  for (const [mx, mz] of [[-16.5, 16.2], [16.5, -16.2], [-31.5, 16.5], [-16.5, -64.5]]) {
    makeBox(worldRoot, 0.52, 1.05, 0.52, mx, 0.70, mz, mailboxMat, {
      cast: true, box: [mx - 0.28, mx + 0.28, 0.18, 1.25, mz - 0.28, mz + 0.28, 'mailbox', true]
    });
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.22, 0.82, 10), poleMat);
    bin.position.set(mx + 0.9, 0.59, mz);
    worldRoot.add(bin);
  }
  placeProps('hydrant', [[-16.8, 13.0], [16.8, 32.0], [-32.0, -16.8], [32.0, -32.0], [-16.8, -80.0]]);
  placeProps('tree', [
    [-13.5, 55.5, 0.95], [13.5, 38.5, 0.95], [-58.5, -11.5, 0.95], [-36.5, 11.5, 0.95],
    [58.5, -11.5, 0.95], [36.5, 11.5, 0.95], [-36.5, 38.5, 0.95], [58.5, 38.5, 0.95],
    [-82.0, -82.0, 0.95], [82.0, -82.0, 0.95], [-82.0, -130.0, 0.95], [82.0, -130.0, 0.95]
  ]);
}
export function updateBuildingLods() {
  const ON2 = 54 * 54, OFF2 = 66 * 66;
  for (let i = 0; i < buildingLods.length; i++) {
    const entry = buildingLods[i];
    const d2 = dist2(entry.x, entry.z, player.x, player.z);
    if (!entry.active && d2 < ON2) { entry.group.visible = true; entry.active = true; }
    else if (entry.active && d2 > OFF2) { entry.group.visible = false; entry.active = false; }
  }
}

// -----------------------------------------------------------------------------
// Embellishments
// -----------------------------------------------------------------------------
export function embellishHouse({ x, z, w = 8.4, d = 7.4, h = 3.6, wallColor, roofColor, rotY = 0 }) {
  const g = new THREE.Group();
  g.position.set(x, 0.18, z);
  g.rotation.y = rotY;
  worldRoot.add(g);
  const wood = makeMat(0xf1f5f9, { roughness: 0.7 });
  const green = makeMat(0x14532d, { roughness: 0.8 });
  const add = (sx, sy, sz, m, px, py, pz) => makeBox(g, sx, sy, sz, px, py, pz, m, { cast: true });
  add(w * 0.36, 0.14, 1.4, makeMat(0xa8a29e, { texType: 'concrete' }), 0, 0.07, d / 2 + 0.7);
  for (const s of [-1, 1]) {
    const wx = s * w * 0.28;
    add(0.34, 1.25, 0.06, green, wx - 0.98, 1.9, d / 2 + 0.05);
    add(0.34, 1.25, 0.06, green, wx + 0.98, 1.9, d / 2 + 0.05);
    add(1.4, 0.22, 0.3, makeMat(0x78350f, { texType: 'wood' }), wx, 1.18, d / 2 + 0.18);
    add(1.3, 0.2, 0.24, makeMat(0x22c55e), wx, 1.38, d / 2 + 0.18);
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), makeMat(0x15803d));
    bush.position.set(s * w * 0.44, 0.4, d / 2 + 0.55);
    bush.castShadow = true;
    g.add(bush);
  }
  add(0.08, 1.0, 0.08, wood, w * 0.6, 0.5, d / 2 + 3);
  add(0.4, 0.28, 0.25, makeMat(0x1d4ed8), w * 0.6, 1.1, d / 2 + 3);
  add(w + 2, 0.07, 0.07, wood, 0, 0.7, d / 2 + 4.2);
  add(w + 2, 0.07, 0.07, wood, 0, 0.42, d / 2 + 4.2);
  for (let fx = -w / 2 - 1; fx <= w / 2 + 1.01; fx += 0.9) {
    if (Math.abs(fx) > 1.0) add(0.08, 0.95, 0.08, wood, fx, 0.48, d / 2 + 4.2);
  }
}
export function buildSuburbanHouse(o) { buildSuburbanHouseBase(o); embellishHouse(o); }
// -----------------------------------------------------------------------------
// FROSTPINE ALPINE / EMERALD WOODS / SUNSET COVE
// -----------------------------------------------------------------------------
export function buildNewBiomes() {
  const grp = new THREE.Group();
  grp.userData.studioName = 'Southern biomes';
  worldRoot.add(grp);
  const mesh = (geo, mat, x, y, z, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    grp.add(m);
    return m;
  };
  const plane = (x0, x1, z0, z1, y, mat) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    m.receiveShadow = true;
    grp.add(m);
    return m;
  };
  const ground = (x0, x1, z0, z1, y, mat) => {
    const m = terrainPlane(x1 - x0, z1 - z0, (x0 + x1) / 2, y, (z0 + z1) / 2, mat);
    grp.add(m);
    return m;
  };
  /** Roads are real slabs; `gap` opens the carriageway over a carved stream. */
  const road = (rx, name, gap = null) => {
    const asphalt = makeMat(0x313946, { texType: 'asphalt', repeatX: 2, repeatY: 26, roughness: 0.86 });
    for (const [z0, z1] of (gap ? [[74, gap[0]], [gap[1], 208]] : [[74, 208]])) {
      if (z1 - z0 < 0.5) continue;
      makeBox(grp, 12, 0.12, z1 - z0, rx, 0.12, (z0 + z1) / 2, asphalt, {
        recv: true, name, box: [rx - 6, rx + 6, 0.06, 0.18, z0, z1, 'biome_road', true]
      });
    }
    const dashT = [];
    for (let zz = 80; zz < 206; zz += 6) {
      if (gap && zz > gap[0] - 2 && zz < gap[1] + 2) continue;
      xform(dashT, rx, 0.19, zz);
    }
    flushInstances(grp, new THREE.BoxGeometry(0.26, 0.02, 2.5), makeMat(0xfacc15), dashT);
    mapShapes.push({ x: rx, z: 141, w: 12, d: 134, color: '#334155', border: '#475569', enterable: false });
    reserveFootprint(rx - 7, rx + 7, 74, 208, 'road');
  };
  const keep = [];
  const free = (x, z, roadX, r = 2) => {
    if (roadX !== null && Math.abs(x - roadX) < 8) return false;
    for (const k of keep) if (dist2(x, z, k.x, k.z) < (k.r + r) * (k.r + r)) return false;
    return true;
  };

  // === FROSTPINE ALPINE ===
  const MX = 650, MZ = 210;
  const mg = new THREE.PlaneGeometry(MX, MZ, Math.ceil(MX / 5), Math.ceil(MZ / 5));
  mg.rotateX(-Math.PI / 2);
  const mountainColors = new Float32Array(mg.attributes.position.count * 3);
  const mc = new THREE.Color();
  const cLow = new THREE.Color(0x8a9a6b), cMid = new THREE.Color(0xb3b380), cSnow = new THREE.Color(0xffffff);
  const cCreekBed = new THREE.Color(0x4b5563);
  for (let i = 0; i < mg.attributes.position.count; i++) {
    const x = mg.attributes.position.getX(i) - 375, z = mg.attributes.position.getZ(i) + 214;
    const height = terrainBaseH(x, z);
    const snowLine = 6.5 + fbm(x * 0.05, z * 0.05, 2) * 2;
    mc.set(0x6b7a5c);
    mc.lerp(cLow, sstep(3, 6, height));
    mc.lerp(cMid, sstep(snowLine - 3, snowLine + 2, height));
    mc.lerp(cSnow, sstep(snowLine, snowLine + 3, height));
    if (z > 132 && z < 316) {
      const cd = Math.abs(x - frostCreekX(z));
      if (cd < 7) mc.lerp(cCreekBed, (1 - cd / 7) * 0.8);
    }
    mg.attributes.position.setY(i, height);
    mountainColors[i * 3] = mc.r; mountainColors[i * 3 + 1] = mc.g; mountainColors[i * 3 + 2] = mc.b;
  }
  mg.attributes.position.needsUpdate = true;
  mg.setAttribute('color', new THREE.BufferAttribute(mountainColors, 3));
  mg.computeVertexNormals();
  const mountainMesh = new THREE.Mesh(mg, makeTerrainBlendMaterial({ roughness: 0.9 }));
  mountainMesh.receiveShadow = true;
  mountainMesh.castShadow = true;
  mountainMesh.position.set(-375, 0, 214);
  paintMeshTerrainSplat(mountainMesh, 'alpine');
  mountainMesh.userData.studioName = 'Frostpine mountains';
  worldRoot.add(mountainMesh);
  registerSculptableTerrain(mountainMesh);
  for (let sz = 128; sz <= 308; sz += 60) {
    for (let sx = -660; sx <= -90; sx += 95) iceZones.push({ x: sx, z: sz, r: 26 });
  }
  const pineG = [new THREE.ConeGeometry(1.7, 2.2, 7), new THREE.ConeGeometry(1.3, 1.9, 7), new THREE.ConeGeometry(0.9, 1.6, 7)];
  const trunkG = new THREE.CylinderGeometry(0.2, 0.3, 1.6, 6);
  const snowM = makeMat(0xffffff, { roughness: 0.9 });
  const pineInstances = { trunk: [], snowCap: [], layers: [[], [], []], snowLayers: [[], [], []] };
  const placePineTree = (x, z, size = 1) => {
    const gy = terrainH(x, z);
    xform(pineInstances.trunk, x, gy + 0.8 * size, z, size, size, size);
    xform(pineInstances.snowCap, x, gy + 8 * size * 0.72, z, size, size, size);
    for (const [i, y] of [[0, 2.2], [1, 3.4], [2, 4.5]]) {
      xform(pineInstances.layers[i], x, gy + y * size, z, size, size, size);
      if (rnd() > 0.5) {
        const s = size * 0.86;
        xform(pineInstances.snowLayers[i], x, gy + (y + 0.22) * size, z, s, s, s);
      }
    }
    addWorldBox(x - 0.6 * size, x + 0.6 * size, gy, gy + 8 * size * 0.6, z - 0.6 * size, z + 0.6 * size, 'pine_tree', false);
  };
  const flushInstancedPines = () => {
    const add = (geo, mat, list) => flushInstances(grp, geo, mat, list, { cast: true, recv: true });
    add(trunkG, treeBarkMaterial, pineInstances.trunk);
    add(new THREE.SphereGeometry(0.5, 12, 12), snowM, pineInstances.snowCap);
    pineG.forEach((g, i) => {
      add(g, treeLeafMaterial, pineInstances.layers[i]);
      add(g, snowM, pineInstances.snowLayers[i]);
    });
  };
  const lodgeX = -70, lodgeZ = 139, lodgeW = 11, lodgeD = 9;
  const lodgeY = maxTerrainOver(lodgeX - lodgeW / 2, lodgeX + lodgeW / 2, lodgeZ - lodgeD / 2, lodgeZ + lodgeD / 2) + 0.12;
  makeBox(grp, lodgeW + 1.6, 2.4, lodgeD + 1.6, lodgeX, lodgeY - 1.2, lodgeZ,
    makeMat(0x57534e, { texType: 'redrock', repeatX: 3, repeatY: 1 }), {
      cast: true, recv: true, name: 'Ski lodge foundation',
      box: [lodgeX - lodgeW / 2 - 0.8, lodgeX + lodgeW / 2 + 0.8, lodgeY - 2.4, lodgeY,
        lodgeZ - lodgeD / 2 - 0.8, lodgeZ + lodgeD / 2 + 0.8, 'lodge_foundation', true]
    });
  keep.push({ x: lodgeX, z: lodgeZ, r: 11 });
  const creek = buildRiverSystem({
    id: 'frostpine_creek', parent: grp, centerX: frostCreekX, z0: 136, z1: 312,
    halfWidth: 3.2, lift: 0.24, waveScale: 0.12, currentZ: 0.7, flowSpeed: 0.55,
    shallowColor: 0x7dd3fc, deepColor: 0x0369a1, foamColor: 0xe0f2fe
  });
  for (let z = 140; z <= 310; z += 12) keep.push({ x: frostCreekX(z), z, r: 7 });
  [176, 214, 252, 288].forEach((bz, i) => {
    const bx = frostCreekX(bz) + (i % 2 ? 1.4 : -1.4), by = terrainH(bx, bz);
    mesh(new THREE.DodecahedronGeometry(0.85 + (i % 2) * 0.3, 0), rockMat, bx, by + 0.35, bz);
    addWorldBox(bx - 0.8, bx + 0.8, by, by + 1.0, bz - 0.8, bz + 0.8, 'creek_boulder', true);
  });
  spawnRiverLog(grp, frostCreekX(240) + 0.6, 240);
  {
    const sx = frostCreekX(311), sy = terrainH(sx, 311);
    for (let i = 0; i < 3; i++) mesh(new THREE.DodecahedronGeometry(1.1, 0), rockMat, sx + (i - 1) * 1.6, sy + 0.5, 313.5);
    const foam = new THREE.Mesh(new THREE.RingGeometry(1.4, 2.6, 18),
      new THREE.MeshBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(sx, creek.surfAt(310) + 0.03, 310);
    grp.add(foam);
  }
  const loopRoad = buildFrostpineLoopRoad(grp, keep);
  {
    let crossI = -1, crossD = Infinity;
    for (let i = 0; i < loopRoad.pts.length - 1; i++) {
      const p = loopRoad.pts[i];
      if (p.z < 270 || p.z > 316) continue;
      const d = Math.abs(p.x - frostCreekX(p.z));
      if (d < crossD) { crossD = d; crossI = i; }
    }
    if (crossI >= 0) {
      const p = loopRoad.pts[crossI], bz = p.z, bx = frostCreekX(bz);
      const span = 12.4, deckW = 5.2;
      const deckY = Math.max(creek.surfAt(bz), p.y + loopRoad.ROAD_DY) + 0.3;
      buildRiverBridge(grp, bx, bz, deckY, span, { stone: true, deckW });
      for (const s of [-1, 1]) {
        const rx = bx + s * (span / 2 + 1.6);
        const gy = terrainH(rx, bz) + loopRoad.ROAD_DY;
        const rise = deckY - gy, run = 3.2;
        makeBox(grp, run, 0.24, deckW, bx + s * (span / 2 + run / 2), (deckY + gy) / 2 - 0.12, bz,
          makeMat(0x8a8f94, { texType: 'cobblestone', repeatX: 1, repeatY: 2, roughness: 0.9 }),
          { recv: true, rz: s * Math.atan2(rise, run) });
        addDriveableRamp({
          minX: s < 0 ? bx - span / 2 - run : bx + span / 2,
          maxX: s < 0 ? bx - span / 2 : bx + span / 2 + run,
          minZ: bz - deckW / 2, maxZ: bz + deckW / 2,
          startY: s < 0 ? gy : deckY, endY: s < 0 ? deckY : gy, axis: 'x', dir: 1
        });
      }
      mapShapes.push({ x: bx, z: bz, w: span, d: deckW, color: '#9aa0a6', border: '#fcd34d', enterable: false });
    }
  }
  {
    let nearI = 0, nearD = Infinity;
    for (let i = 0; i < loopRoad.pts.length - 1; i++) {
      const p = loopRoad.pts[i], d = dist2(p.x, p.z, lodgeX, lodgeZ);
      if (d < nearD) { nearD = d; nearI = i; }
    }
    const a = loopRoad.pts[nearI];
    const drivePts = [
      new THREE.Vector3(a.x, a.y, a.z),
      new THREE.Vector3(-80, terrainH(-80, 152), 152),
      new THREE.Vector3(-71, terrainH(-71, 148), 148)
    ];
    const drive = new THREE.Mesh(ribbonGeometry(drivePts, 2.4, (p) => p.y + 0.11, { uvScale: 6 }),
      makeMat(0x3a4048, { texType: 'asphalt', repeatX: 1, repeatY: 1, roughness: 0.88 }));
    drive.receiveShadow = true;
    drive.userData.studioName = 'Ski lodge driveway';
    grp.add(drive);
    const rampGround = terrainH(lodgeX, 150.3) + 0.1;
    const rise = lodgeY - rampGround, run = 6.0;
    makeBox(grp, 4, 0.3, Math.hypot(run, rise), lodgeX, (lodgeY + rampGround) / 2 - 0.15, 147.3,
      makeMat(0x57534e, { texType: 'redrock', repeatX: 1, repeatY: 2 }), { recv: true, rx: -Math.atan2(rise, run) });
    addDriveableRamp({ minX: lodgeX - 2, maxX: lodgeX + 2, minZ: 144.3, maxZ: 150.3, startY: lodgeY, endY: rampGround, axis: 'z', dir: 1 });
    keep.push({ x: -78, z: 150, r: 6 });
  }
  {
    const spurCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-76, 0, 184), new THREE.Vector3(-58, 0, 190),
      new THREE.Vector3(-40, 0, 196), new THREE.Vector3(-26, 0, 198)
    ]);
    const spurPts = spurCurve.getSpacedPoints(24);
    for (const p of spurPts) { p.y = terrainH(p.x, p.z); keep.push({ x: p.x, z: p.z, r: 7 }); }
    const spur = new THREE.Mesh(ribbonGeometry(spurPts, 4.0, (p) => p.y + 0.12, { uvScale: 8 }),
      makeMat(0x2b3138, { texType: 'asphalt', repeatX: 1, repeatY: 1, roughness: 0.86 }));
    spur.receiveShadow = true;
    spur.userData.studioName = 'Frostpine park spur';
    grp.add(spur);
    const archMat = makeMat(0x57534e, { texType: 'wood', repeatX: 1, repeatY: 3 });
    for (const s of [-1, 1]) {
      const px = -24 + s * 6.4;
      makeBox(grp, 0.45, 5.2, 0.45, px, terrainH(px, 203) + 2.6, 203, archMat, {
        cast: true, box: [px - 0.3, px + 0.3, 0.1, 5.4, 202.7, 203.3, 'park_arch_post', false]
      });
    }
    makeBox(grp, 13.6, 0.5, 0.5, -24, terrainH(-24, 203) + 5.1, 203, archMat, { cast: true });
    createNeonSign(grp, 'FROSTPINE NATIONAL PARK', -24, terrainH(-24, 203) + 4.3, 203, '#1c1917', '#fcd34d', 10.5, 1.2);
    createNeonSign(grp, 'LOOP ROAD  •  VISTAS  •  SKI LODGE', -24, terrainH(-24, 203) + 3.2, 203, '#14532d', '#bbf7d0', 8.5, 0.7);
  }
  for (let i = 0; i < loopRoad.pts.length - 1; i += 30) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let j = i; j <= Math.min(i + 30, loopRoad.pts.length - 1); j++) {
      const p = loopRoad.pts[j];
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    mapShapes.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0 + 9, d: z1 - z0 + 9, color: '#334155', border: '#facc15', enterable: false });
  }
  mapShapes.push({ x: -420, z: 224, w: 110, d: 180, color: '#38bdf8', border: '#0ea5e9', enterable: false });
  // Densified Frostpine forest — clustered groves, every keep-out respected.
  for (let i = 0, placed = 0; i < 1400 && placed < 340; i++) {
    const x = -700 + rnd() * 650, z = 108 + rnd() * 212;
    if (!free(x, z, null)) continue;
    if (fbm(x * 0.035, z * 0.035, 2) < 0.34) continue;
    placePineTree(x, z, 0.7 + rnd() * 0.6);
    keep.push({ x, z, r: 1.2 });
    placed++;
  }
  const snowRockMat = new THREE.MeshStandardMaterial({ color: 0x5a554d, roughness: 1, flatShading: true });
  for (let i = 0; i < 45; i++) {
    const rx = -640 + rnd() * 520, rz = 116 + rnd() * 196;
    if (!free(rx, rz, null, 4)) continue;
    const gy = terrainH(rx, rz), rh = 2.5 + rnd() * 4;
    const rock = mesh(new THREE.DodecahedronGeometry(rh, 0), snowRockMat, rx, gy + rh * 0.35, rz);
    rock.scale.set(1 + rnd() * 0.6, 0.5 + rnd() * 0.5, 1 + rnd() * 0.6);
    addWorldBox(rx - rh * 0.8, rx + rh * 0.8, gy, gy + rh * 1.1, rz - rh * 0.8, rz + rh * 0.8, 'rock_outcrop', true);
    keep.push({ x: rx, z: rz, r: rh });
  }
  const frozenLakeMat = new THREE.MeshStandardMaterial({ color: 0x9bdcf5, metalness: 0.5, roughness: 0.08, transparent: true, opacity: 0.7 });
  for (let i = 0; i < 12; i++) {
    const lx = -650 + rnd() * 120, lz = 150 + rnd() * 80, lw = 7 + rnd() * 5;
    const topY = maxTerrainOver(lx - lw / 2, lx + lw / 2, lz - lw * 0.3, lz + lw * 0.3) + 0.06;
    makeBox(grp, lw, 0.5, lw * 0.6, lx, topY - 0.25, lz, frozenLakeMat, { recv: true, name: 'Frozen lake' });
    addWorldBox(lx - lw / 2, lx + lw / 2, topY - 0.5, topY, lz - lw * 0.3, lz + lw * 0.3, 'frozen_lake', true);
    iceZones.push({ x: lx, z: lz, r: lw * 0.5 });
    keep.push({ x: lx, z: lz, r: lw });
  }
  buildWalkInHouse({ x: lodgeX, z: lodgeZ, w: lodgeW, d: lodgeD, wallColor: 0x92400e, roofColor: 0xf8fafc, label: 'FROSTPINE SKI LODGE', baseY: lodgeY });

  // === EMERALD WOODS ===
  const woodsGrass = makeGroundMat('grass', { color: 0x4f8f46, repeatX: 12, repeatY: 16, roughness: 0.95 });
  ground(-52, 28, 108, 146.9, 0.17, woodsGrass);
  ground(-52, 28, 153.1, 208, 0.17, woodsGrass);
  {
    const bedGeo = new THREE.PlaneGeometry(80, 6.2, 40, 6);
    bedGeo.rotateX(-Math.PI / 2);
    const bp = bedGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const lz = bp.getZ(i), t = Math.max(0, 1 - (Math.abs(lz) / 3.1) ** 2);
      bp.setY(i, 0.17 - 0.58 * t);
    }
    bedGeo.computeVertexNormals();
    const bed = new THREE.Mesh(bedGeo, makeGroundMat('dirt', { color: 0x8a7a58, repeatX: 10, repeatY: 1, roughness: 0.95 }));
    bed.position.set(-12, 0, 150);
    bed.receiveShadow = true;
    bed.userData.studioName = 'Emerald stream bed';
    grp.add(bed);
    for (let i = 0; i < 6; i++) {
      const px = -48 + i * 14 + rnd() * 4, pz = 149 + rnd() * 2;
      mesh(new THREE.DodecahedronGeometry(0.22 + rnd() * 0.15, 0), makeMat(0x78716c), px, 0.05, pz, false);
    }
  }
  road(-24, 'Forest Road', [146.9, 153.1]);
  mapShapes.unshift({ x: -12, z: 158, w: 80, d: 100, color: '#166534', border: '#14532d', enterable: false });
  const camp = { x: 8, z: 176 };
  keep.push({ x: camp.x, z: camp.z, r: 8 }, { x: 4, z: 128, r: 10 });
  const streamBed = (x, z) => 0.17 - 0.58 * Math.max(0, 1 - ((z - 150) / 3.1) ** 2);
  createWaterSurface({
    id: 'emerald_stream_w', parent: grp, minX: -52, maxX: -31, minZ: 147.5, maxZ: 152.5,
    surfaceY: 0.19, bedFn: streamBed, waveScale: 0.12, currentX: 0.7,
    shallowColor: 0x67e8f9, deepColor: 0x0e7490, foamColor: 0xe0f2fe, segmentSize: 3
  });
  createWaterSurface({
    id: 'emerald_stream_e', parent: grp, minX: -17, maxX: 28, minZ: 147.5, maxZ: 152.5,
    surfaceY: 0.19, bedFn: streamBed, waveScale: 0.12, currentX: 0.7,
    shallowColor: 0x67e8f9, deepColor: 0x0e7490, foamColor: 0xe0f2fe, segmentSize: 3
  });
  mapShapes.push({ x: -12, z: 150, w: 80, d: 5, color: '#38bdf8', border: '#0ea5e9', enterable: false });
  const oakG = new THREE.IcosahedronGeometry(1.9, 0);
  const birchBark = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, map: treeBarkTexture, roughness: 0.92, flatShading: true });
  const oak = (x, z, s, birch) => {
    mesh(new THREE.CylinderGeometry(birch ? 0.16 : 0.28, birch ? 0.22 : 0.4, 3.2 * s, 7),
      birch ? birchBark : treeBarkMaterial, x, 0.17 + 1.6 * s, z);
    for (const [ox, oy, oz, sc] of [[0, 3.8, 0, 1], [0.9, 3.3, 0.4, 0.75], [-0.8, 3.4, -0.5, 0.8]]) {
      mesh(oakG, treeLeafMaterial, x + ox * s, 0.17 + oy * s, z + oz * s).scale.setScalar(sc * s * (birch ? 0.72 : 1));
    }
    addWorldBox(x - 0.4 * s, x + 0.4 * s, 0.18, 0.18 + 3 * s, z - 0.4 * s, z + 0.4 * s, 'tree', false);
  };
  for (let i = 0, n = 0; i < 130 && n < 34; i++) {
    const x = -50 + rnd() * 76, z = 114 + rnd() * 88;
    if (!free(x, z, -24) || Math.abs(z - 150) < 5) continue;
    const r = rnd();
    if (r < 0.4) oak(x, z, 0.85 + rnd() * 0.5, false);
    else if (r < 0.65) oak(x, z, 0.8 + rnd() * 0.4, true);
    else placePineTree(x, z, 0.9 + rnd() * 0.6);
    keep.push({ x, z, r: 1.5 });
    n++;
  }
  for (let i = 0; i < 10; i++) {
    const x = -50 + rnd() * 76, z = 114 + rnd() * 88;
    if (!free(x, z, -24, 1) || Math.abs(z - 150) < 4) continue;
    mesh(new THREE.IcosahedronGeometry(0.7, 0), makeMat(0x166534), x, 0.55, z).scale.y = 0.75;
    mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.22, 5), makeMat(0xf5f5f4), x + 1.4, 0.3, z + 0.4, false);
    mesh(new THREE.SphereGeometry(0.2, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), makeMat(0xdc2626), x + 1.4, 0.4, z + 0.4, false);
  }
  for (const [lx, lz, ry] of [[-40, 128, 0.3], [-8, 190, 1.2], [14, 138, 0.8]]) {
    const lg = mesh(new THREE.CylinderGeometry(0.42, 0.42, 4, 8), treeBarkMaterial, lx, 0.5, lz);
    lg.rotation.z = Math.PI / 2;
    lg.rotation.y = ry;
    addWorldBox(lx - 2, lx + 2, 0.17, 0.9, lz - 0.6, lz + 0.6, 'log', true);
  }
  for (let a = 0; a < 8; a++) {
    mesh(new THREE.DodecahedronGeometry(0.22, 0), makeMat(0x78716c),
      camp.x + Math.cos(a * 0.785) * 0.7, 0.3, camp.z + Math.sin(a * 0.785) * 0.7, false);
  }
  const fire = mesh(new THREE.ConeGeometry(0.4, 1.1, 6), new THREE.MeshBasicMaterial({ color: 0xfb923c }), camp.x, 0.8, camp.z, false);
  mesh(new THREE.ConeGeometry(0.22, 0.8, 6), new THREE.MeshBasicMaterial({ color: 0xfde047 }), camp.x, 0.75, camp.z, false);
  const fl = new THREE.PointLight(0xfb923c, 1.6, 14);
  fl.position.set(camp.x, 1.4, camp.z);
  grp.add(fl);
  buildNewBiomes.fire = { fire, fl };
  for (const [ox, oz, ry, hx] of [[-3, 3, 0.4, 0x2563eb], [3, 4, -0.5, 0xdc2626]]) {
    const t = mesh(new THREE.ConeGeometry(1.7, 1.9, 4), makeMat(hx), camp.x + ox, 1.1, camp.z + oz);
    t.rotation.y = ry + Math.PI / 4;
    addWorldBox(camp.x + ox - 1.1, camp.x + ox + 1.1, 0.18, 1.68, camp.z + oz - 1.1, camp.z + oz + 1.1, 'tent', false);
  }
  buildWalkInHouse({ x: 4, z: 128, w: 10.4, d: 8.6, wallColor: 0x854d0e, roofColor: 0x166534, label: 'EMERALD RANGER STATION' });
  const bridgeWood = makeMat(0x78350f, { texType: 'wood' });
  makeBox(grp, 14, 0.12, 6, -24, 0.23, 150, bridgeWood, {
    recv: true, box: [-31, -17, 0.17, 0.29, 147, 153, 'footbridge', true]
  });
  for (const s of [-1, 1]) makeBox(grp, 14, 0.9, 0.12, -24, 0.7, 150 + s * 2.95, bridgeWood, { recv: true });

  // === SUNSET COVE ===
  ground(28, 138, 108, 168, 0.17, makeGroundMat('sand', { repeatX: 14, repeatY: 14, roughness: 0.96 }));
  road(72, 'Cove Boulevard');
  mapShapes.unshift({ x: 83, z: 158, w: 110, d: 100, color: '#fcd34d', border: '#f59e0b', enterable: false });
  createWaterSurface({
    id: 'sunset_cove', parent: grp, minX: 28, maxX: 138, minZ: 168, maxZ: 208,
    surfaceY: 0.20, bedFn: getOceanBedY, waveScale: 0.75, currentX: 0.15, isOcean: true,
    shallowColor: 0x22d3ee, deepColor: 0x054f7a, foamColor: 0xf0f9ff, segmentSize: 3
  });
  mapShapes.push({ x: 83, z: 188, w: 110, d: 40, color: '#38bdf8', border: '#0ea5e9', enterable: false });
  plane(28, 138, 166.6, 168, 0.21, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
  keep.push({ x: 50, z: 150, r: 5 }, { x: 118, z: 138, r: 9 }, { x: 100, z: 160, r: 6 });
  makeBox(grp, 4, 0.2, 40, 100, 0.45, 172,
    makeMat(0x92704a, { texType: 'wood', repeatX: 1, repeatY: 10 }), { recv: true });
  for (let pz = 154; pz <= 190; pz += 6) {
    for (const s of [-1.7, 1.7]) mesh(new THREE.CylinderGeometry(0.18, 0.2, 1.4, 6), makeMat(0x57534e), 100 + s, 0.0, pz, false);
  }
  addWorldBox(98, 102, 0.2, 0.55, 152, 192, 'pier', true);
  makeBox(grp, 1.4, 0.12, 0.5, 100, 0.9, 186, makeMat(0x78350f), { recv: true });
  const palm = (x, z, s) => {
    const lean = (rnd() - 0.5) * 0.4;
    const tr = mesh(new THREE.CylinderGeometry(0.16 * s, 0.24 * s, 5 * s, 7), treeBarkMaterial, x, 0.17 + 2.5 * s, z);
    tr.rotation.z = lean;
    const tx = x - Math.sin(lean) * 2.5 * s, ty = 0.17 + 5 * s;
    for (let f = 0; f < 6; f++) {
      const fr = makeBox(grp, 3 * s, 0.05, 0.7 * s, tx, ty, z, treeLeafMaterial, { recv: true });
      fr.rotation.y = f * 1.047;
      fr.rotation.z = -0.35;
      fr.translateX(1.3 * s);
    }
    addWorldBox(x - 0.35, x + 0.35, 0.18, 0.18 + 4 * s, z - 0.35, z + 0.35, 'tree', false);
  };
  for (let i = 0, n = 0; i < 80 && n < 10; i++) {
    const x = 32 + rnd() * 100, z = 114 + rnd() * 50;
    if (!free(x, z, 72)) continue;
    palm(x, z, 0.9 + rnd() * 0.4);
    keep.push({ x, z, r: 2 });
    n++;
  }
  [[52, 160, 0xef4444], [60, 158, 0x3b82f6], [88, 162, 0xfacc15], [96, 150, 0x22c55e], [112, 158, 0xec4899]]
    .forEach(([ux, uz, uc], i) => {
      mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 5), makeMat(0xf8fafc), ux, 1.3, uz, false);
      mesh(new THREE.ConeGeometry(1.5, 0.55, 8), makeMat(uc), ux, 2.6, uz);
      makeBox(grp, 1.1, 0.03, 2.0, ux + 0.9, 0.19, uz + 0.8, makeMat(i % 2 ? 0xfef3c7 : 0xbfdbfe), { recv: true });
    });
  const lifeguardWhite = makeMat(0xf8fafc);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    makeBox(grp, 0.2, 2.6, 0.2, 50 + sx, 1.5, 150 + sz, lifeguardWhite, { cast: true, recv: true });
  }
  makeBox(grp, 2.6, 1.6, 2.6, 50, 3.3, 150, makeMat(0xdc2626, { texType: 'wood' }), { cast: true, recv: true });
  makeBox(grp, 3.2, 0.2, 3.2, 50, 4.25, 150, lifeguardWhite, { cast: true, recv: true });
  makeBox(grp, 0.06, 1.3, 0.06, 51.4, 5.0, 151.4, makeMat(0x57534e), { cast: true, recv: true });
  makeBox(grp, 0.7, 0.4, 0.04, 51.75, 5.4, 151.4, makeMat(0xfacc15), { recv: true });
  addWorldBox(48.8, 51.2, 2.5, 4.35, 148.8, 151.2, 'lifeguard_deck', true);
  for (const [bx, bz, ry] of [[60, 190, 0.3], [126, 180, -0.4]]) {
    const bt = new THREE.Group();
    bt.position.set(bx, 0.3, bz);
    bt.rotation.y = ry;
    bt.userData.studioName = 'Cove sailboat';
    makeBox(bt, 1.6, 0.7, 4.8, 0, 0, 0, makeMat(0xf8fafc));
    const mastM = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5, 5), makeMat(0x57534e));
    mastM.position.y = 2.8;
    const sail = new THREE.Mesh(new THREE.ConeGeometry(1.3, 4.2, 3), makeMat(0xfef3c7));
    sail.position.set(0, 2.9, 0.3);
    sail.scale.z = 0.12;
    bt.add(mastM, sail);
    grp.add(bt);
    registerFloatingProp(bt, bx, bz, 0.15, 0.9);
  }
  buildRowboat(grp, 107, 184, 0xb45309);
  buildChannelBuoy(grp, 36, 198, 0xdc2626);
  buildChannelBuoy(grp, 124, 198, 0x22c55e);
  buildWalkInHouse({ x: 118, z: 138, w: 10.4, d: 8.6, wallColor: 0x67e8f9, roofColor: 0xea580c, label: 'SUNSET COVE SURF SHACK' });
  flushInstancedPines();
}

// -----------------------------------------------------------------------------
// VERDANT JUNGLE
// -----------------------------------------------------------------------------
export function buildJungleBiome() {
  const grp = new THREE.Group();
  grp.userData.studioName = 'Verdant jungle';
  worldRoot.add(grp);
  const JX0 = 368, JX1 = 533, JZ0 = -180, JZ1 = 240, JY = 1.5;
  const mesh = (geo, mat, x, y, z, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    grp.add(m);
    return m;
  };
  const plane = (x0, x1, z0, z1, y, mat) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    m.receiveShadow = true;
    grp.add(m);
    return m;
  };
  {
    const westGeo = new THREE.PlaneGeometry(44, JZ1 - JZ0, 22, Math.ceil((JZ1 - JZ0) / 2));
    westGeo.rotateX(-Math.PI / 2);
    const west = new THREE.Mesh(westGeo, makeTerrainBlendMaterial({ roughness: 0.96 }));
    west.position.set(390, JY, (JZ0 + JZ1) / 2);
    paintMeshTerrainSplat(west, 'jungle');
    west.receiveShadow = true;
    registerSculptableTerrain(west);
    grp.add(west);
    const eastGeo = new THREE.PlaneGeometry(109, JZ1 - JZ0, 54, Math.ceil((JZ1 - JZ0) / 2));
    eastGeo.rotateX(-Math.PI / 2);
    const east = new THREE.Mesh(eastGeo, makeTerrainBlendMaterial({ roughness: 0.96 }));
    east.position.set(478.5, JY, (JZ0 + JZ1) / 2);
    paintMeshTerrainSplat(east, 'jungle');
    east.receiveShadow = true;
    registerSculptableTerrain(east);
    grp.add(east);
    const bedGeo = new THREE.PlaneGeometry(12, JZ1 - JZ0, 8, 140);
    bedGeo.rotateX(-Math.PI / 2);
    const bp = bedGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const d = bp.getX(i) / 6;
      bp.setY(i, JY - 1.48 * Math.max(0, 1 - d * d));
    }
    bedGeo.computeVertexNormals();
    const bed = new THREE.Mesh(bedGeo, makeGroundMat('dirt', { color: 0x6b5b3e, repeatX: 2, repeatY: 40, roughness: 0.95 }));
    bed.position.set(418, 0, (JZ0 + JZ1) / 2);
    bed.receiveShadow = true;
    bed.userData.studioName = 'Jungle river bed';
    grp.add(bed);
  }
  // Earth skirts: real retaining faces so you can never see under the floor.
  {
    const skirtMat = makeMat(0x4a3f2c, { texType: 'redrock', repeatX: 20, repeatY: 1, roughness: 0.95 });
    const skirt = (w, d, x, z) => makeBox(grp, w, JY + 0.6, d, x, (JY - 0.6) / 2, z, skirtMat, { cast: true, recv: true });
    skirt(0.5, 214, JX0, (JZ0 + 34) / 2);
    skirt(0.5, JZ1 - 46, JX0, (46 + JZ1) / 2);
    skirt(0.5, JZ1 - JZ0, JX1, (JZ0 + JZ1) / 2);
    skirt(JX1 - JX0, 0.5, (JX0 + JX1) / 2, JZ0);
    skirt(JX1 - JX0, 0.5, (JX0 + JX1) / 2, JZ1);
  }
  mapShapes.unshift({ x: (JX0 + JX1) / 2, z: 30, w: JX1 - JX0, d: JZ1 - JZ0, color: '#14532d', border: '#166534', enterable: false });
  const rise = JY - 0.05;
  makeBox(grp, 8.2, 0.14, 12, 364, (0.05 + JY) / 2 - 0.07, 40,
    makeMat(0x313946, { texType: 'asphalt', repeatX: 2, repeatY: 2, roughness: 0.86 }),
    { recv: true, rz: Math.atan2(rise, 8) });
  addDriveableRamp({ minX: 360, maxX: 368, minZ: 34, maxZ: 46, startY: 0.05, endY: JY, axis: 'x', dir: 1 });
  const trailMat = makeMat(0x5c4033, { texType: 'sand', repeatX: 10, repeatY: 2, roughness: 0.95 });
  plane(368, 412, 35, 45, JY + 0.02, trailMat);
  plane(424, 474, 35, 45, JY + 0.02, trailMat);
  mapShapes.push({ x: 421, z: 40, w: 106, d: 10, color: '#78350f', border: '#451a03', enterable: false });
  createWaterSurface({
    id: 'verdant_river', parent: grp, minX: 412, maxX: 424, minZ: -180, maxZ: 200,
    surfaceY: JY + 0.03,
    bedFn: (x) => { const d = (x - 418) / 6; return JY - 1.48 * Math.max(0, 1 - d * d); },
    waveScale: 0.2, currentZ: 1.1,
    shallowColor: 0x2dd4bf, deepColor: 0x0f766e, foamColor: 0xccfbf1, segmentSize: 4
  });
  mapShapes.push({ x: 418, z: 10, w: 12, d: 380, color: '#14b8a6', border: '#0f766e', enterable: false });
  createWaterSurface({
    id: 'north_ocean_w', parent: grp, minX: -50, maxX: 164, minZ: 208, maxZ: 320,
    surfaceY: 0.20, bedFn: getOceanBedY, waveScale: 1.0, currentX: 0.2, currentZ: 0.3,
    isOcean: true, segmentSize: 4
  });
  createWaterSurface({
    id: 'north_ocean_e', parent: grp, minX: 164, maxX: 368, minZ: 220, maxZ: 320,
    surfaceY: 0.20, bedFn: getOceanBedY, waveScale: 1.0, currentX: 0.25, currentZ: 0.2,
    isOcean: true, segmentSize: 4
  });
  const woodBridgeMat = makeMat(0x78350f, { texType: 'wood', repeatX: 4, repeatY: 2 });
  makeBox(grp, 14, 0.22, 11.5, 418, JY + 0.1, 40, woodBridgeMat, { cast: true, recv: true });
  for (const rz of [-5.5, 5.5]) makeBox(grp, 14, 0.85, 0.24, 418, JY + 0.54, 40 + rz, woodBridgeMat, { cast: true, recv: true });
  addWorldBox(411, 425, JY, JY + 0.21, 34.2, 45.8, 'jungle_bridge', true);
  const cliffMat = makeMat(0x475569, { texType: 'redrock', repeatX: 4, repeatY: 3, roughness: 0.92 });
  makeBox(grp, 22, 14, 7, 418, JY + 6.5, -137, cliffMat, { cast: true, recv: true });
  addWorldBox(407, 429, JY, JY + 13.5, -140.5, -133.5, 'jungle_cliff', false);
  const fallSheet = makeBox(grp, 8.5, 11.5, 0.35, 418, JY + 5.75, -133.3,
    new THREE.MeshBasicMaterial({ color: 0x5eead4, transparent: true, opacity: 0.72 }), { recv: true });
  const mistPool = mesh(new THREE.CylinderGeometry(7.5, 7.5, 0.08, 20),
    new THREE.MeshBasicMaterial({ color: 0xccfbf1, transparent: true, opacity: 0.55 }), 418, JY + 0.06, -129, false);
  buildJungleBiome.waterfall = { fallSheet, mistPool };
  const riverRockMat = makeMat(0x4b5563, { texType: 'cobblestone', repeatX: 2, repeatY: 2, roughness: 0.95 });
  for (const [rz, ox] of [[-60, 1.6], [10, -1.8], [80, 1.2], [150, -1.5]]) {
    const bx = 418 + ox;
    mesh(new THREE.DodecahedronGeometry(0.9, 0), riverRockMat, bx, JY - 0.15, rz);
    addWorldBox(bx - 0.8, bx + 0.8, JY - 0.9, JY + 0.55, rz - 0.8, rz + 0.8, 'river_boulder', true);
  }
  spawnRiverLog(grp, 419.5, 120);
  const teX = 456, teZ = -70, platW = 60, platD = 60, platH = 3;
  const teStoneMat = makeMat(0x57534e, { texType: 'cobblestone', repeatX: 8, repeatY: 8, roughness: 0.92 });
  const teMossStoneMat = makeMat(0x3f6212, { texType: 'cobblestone', repeatX: 6, repeatY: 6, roughness: 0.95 });
  makeBox(worldRoot, platW, platH, platD, teX, JY + platH / 2, teZ, teStoneMat, {
    cast: true, recv: true, name: 'Sun Temple platform',
    box: [teX - platW / 2, teX + platW / 2, JY, JY + platH, teZ - platD / 2, teZ + platD / 2, 'temple_platform', true]
  });
  const tRun = 12;
  makeBox(worldRoot, 12, 0.3, Math.hypot(tRun, platH), teX, JY + platH / 2 - 0.1, teZ + platD / 2 + tRun / 2,
    makeMat(0x57534e, { texType: 'cobblestone', repeatX: 2, repeatY: 3 }), { recv: true, rx: Math.atan2(platH, tRun) });
  addDriveableRamp({ minX: teX - 6, maxX: teX + 6, minZ: teZ + platD / 2, maxZ: teZ + platD / 2 + tRun, startY: JY + platH, endY: JY, axis: 'z', dir: 1 });
  let tierY = JY + platH;
  [[40, 40], [32, 32], [24, 24], [16, 16], [8, 8]].forEach(([w, d], idx) => {
    const h = 1.2;
    makeBox(worldRoot, w, h, d, teX, tierY + h / 2, teZ, idx % 2 === 0 ? teStoneMat : teMossStoneMat, {
      cast: true, recv: true,
      box: [teX - w / 2, teX + w / 2, tierY, tierY + h, teZ - d / 2, teZ + d / 2, 'temple_tier', true]
    });
    tierY += h;
  });
  makeBox(worldRoot, 3, 1.6, 3, teX, tierY + 0.8, teZ, teStoneMat, {
    cast: true, box: [teX - 1.5, teX + 1.5, tierY, tierY + 1.6, teZ - 1.5, teZ + 1.5, 'temple_summit', true]
  });
  const teRelic = new THREE.Mesh(new THREE.OctahedronGeometry(1.2, 0), makeMat(0xfacc15, { metalness: 0.9, roughness: 0.2 }));
  teRelic.position.set(teX, tierY + 2.8, teZ);
  teRelic.castShadow = true;
  worldRoot.add(teRelic);
  createNeonSign(worldRoot, 'ANCIENT SUN TEMPLE', teX, tierY + 4.4, teZ + 4, '#14532d', '#fde047', 6.5, 1.0);
  mapShapes.push({ x: teX, z: teZ, w: platW, d: platD, color: '#65a30d', border: '#facc15', enterable: false });
  buildWalkInHouse({ x: 454, z: 96, w: 10.6, d: 8.8, wallColor: 0x4d7c0f, roofColor: 0x78350f, label: 'JUNGLE RESEARCH STATION', baseY: JY });
  const vineMat = makeMat(0x4d7c0f, { roughness: 0.9 });
  const kapokParts = { trunk: [], root: [], c1: [], c2: [], c3: [], vine: [] };
  const jungleClear = (x, z, r = 3) => {
    if (x < JX0 + 4 || x > JX1 - 4 || z < JZ0 + 4 || z > JZ1 - 4) return false;
    if (x > 408 - r && x < 428 + r) return false;
    if (Math.abs(z - 40) < 8 + r && x < 478) return false;
    if (x > teX - platW / 2 - r && x < teX + platW / 2 + r && z > teZ - platD / 2 - r && z < teZ + platD / 2 + tRun + r) return false;
    if (dist2(x, z, 454, 96) < (9 + r) * (9 + r)) return false;
    if (dist2(x, z, 418, -137) < (14 + r) * (14 + r)) return false;
    return true;
  };
  const spawnKapok = (x, z, s = 1) => {
    const h = 14 * s;
    xform(kapokParts.trunk, x, JY + h / 2, z, s, s, s);
    for (let r = 0; r < 4; r++) {
      const ang = (r * Math.PI) / 2 + 0.4;
      xform(kapokParts.root, x + Math.cos(ang) * 0.8 * s, JY + 1.5 * s, z + Math.sin(ang) * 0.8 * s, s, s, s, 0, -ang, 0);
    }
    xform(kapokParts.c1, x, JY + h, z, 1.3 * s, 0.5 * s, 1.3 * s);
    xform(kapokParts.c2, x + 1.8 * s, JY + h + 1.5 * s, z - 1.2 * s, 1.3 * s, 0.48 * s, 1.3 * s);
    xform(kapokParts.c3, x - 1.5 * s, JY + h + 0.8 * s, z + 1.4 * s, 1.3 * s, 0.48 * s, 1.3 * s);
    for (let v = 0; v < 4; v++) {
      const va = v * 1.8 + x, vLen = (3.2 + (v % 2) * 1.6) * s;
      xform(kapokParts.vine, x + Math.cos(va) * 2.8 * s, JY + h - vLen / 2 - 0.4, z + Math.sin(va) * 2.8 * s, 1, vLen, 1);
    }
    addWorldBox(x - 1.5 * s, x + 1.5 * s, JY, JY + h * 0.7, z - 1.5 * s, z + 1.5 * s, 'jungle_tree', false);
  };
  for (let i = 0, placed = 0; i < 400 && placed < 80; i++) {
    const x = JX0 + 6 + rnd() * (JX1 - JX0 - 12), z = JZ0 + 6 + rnd() * (JZ1 - JZ0 - 12);
    if (!jungleClear(x, z)) continue;
    spawnKapok(x, z, 0.9 + rnd() * 0.7);
    placed++;
  }
  {
    const addKapok = (geo, mat, list, cast = true) => flushInstances(grp, geo, mat, list, { cast, recv: true });
    addKapok(new THREE.CylinderGeometry(0.5, 0.8, 14, 8), treeBarkMaterial, kapokParts.trunk);
    addKapok(new THREE.BoxGeometry(0.4, 3, 2), treeBarkMaterial, kapokParts.root);
    addKapok(new THREE.DodecahedronGeometry(4.5, 1), treeLeafMaterial, kapokParts.c1);
    addKapok(new THREE.DodecahedronGeometry(3.2, 1), treeLeafMaterial, kapokParts.c2);
    addKapok(new THREE.DodecahedronGeometry(3.0, 1), treeLeafMaterial, kapokParts.c3);
    addKapok(new THREE.CylinderGeometry(0.05, 0.05, 1, 5), vineMat, kapokParts.vine, false);
  }
  const fernMat = makeMat(0x16a34a, { roughness: 0.85 });
  const boulderMat = makeMat(0x4b5563, { texType: 'cobblestone', repeatX: 2, repeatY: 2, roughness: 0.95 });
  const bloomColors = [0xf43f5e, 0xf59e0b, 0xa855f7, 0x38bdf8];
  const fernT = [];
  for (let i = 0; i < 120; i++) {
    const x = JX0 + 6 + rnd() * (JX1 - JX0 - 12), z = JZ0 + 6 + rnd() * (JZ1 - JZ0 - 12);
    if (!jungleClear(x, z, 1)) continue;
    xform(fernT, x, JY + 0.55, z, 1.4, 0.8, 1.4, 0, rnd() * 6.28, 0);
    if (i % 4 === 0) {
      mesh(new THREE.DodecahedronGeometry(1.5, 0), boulderMat, x + 1.5, JY + 0.8, z + 0.8);
      addWorldBox(x + 0.5, x + 2.5, JY, JY + 1.5, z - 0.3, z + 1.3, 'jungle_boulder', true);
    } else if (i % 3 === 0) {
      mesh(new THREE.DodecahedronGeometry(0.35, 0),
        makeMat(pick(bloomColors), { emissive: pick(bloomColors), emissiveIntensity: 0.35 }), x, JY + 1.2, z, false);
    }
  }
  flushInstances(grp, new THREE.ConeGeometry(1.4, 1.1, 8), fernMat, fernT, { recv: true });
}

// =============================================================================
// AURA ARMORY — cash-gated [E] purchases, or smash the glass with [F] using
// the sledgehammer hidden in the dumpster behind the store.
// =============================================================================
const ARMORY = { x: 104, z: 494, w: 20, d: 22, h: 5.2, baseY: 0.24 };
const ARMORY_DUMPSTER = { x: 99, z: 478 };
const ARMORY_AMMO = { x: 97.2, z: 485.6, price: 60 };
const armory = {
  built: false, cases: [], dumpster: null, dumpsterSearched: false, hasHammer: false,
  hammerMesh: null, hammerInDumpster: null, alarm: 0, alarmLight: null, alarmBeacon: null,
  swing: 0, ammoBox: null
};
const ARMORY_STOCK = [
  { id: 'hotdog_shooter', label: 'HOTDOG SHOOTER', price: 450, x: 99.5, z: 489.0 },
  { id: 'crowbar', label: 'STEEL CROWBAR', price: 220, x: 108.5, z: 489.0 },
  { id: 'pipe', label: 'TACTICAL PIPE', price: 180, x: 99.5, z: 498.0 },
  { id: 'bat', label: 'WOODEN BAT', price: 120, x: 108.5, z: 498.0 }
];
function makeSledgehammer() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.86, 8),
    makeMat(0xb45309, { texType: 'wood', repeatX: 1, repeatY: 3 }));
  shaft.position.y = 0.30;
  shaft.castShadow = true;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 8), makeMat(0x1c1917, { roughness: 0.95 }));
  grip.position.y = -0.02;
  const head = makeBox(g, 0.30, 0.13, 0.13, 0, 0.74, 0,
    makeMat(0x94a3b8, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.28, flatShading: false }), { cast: true });
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.07, 10), makeMat(0xcbd5e1, { metalness: 0.95, roughness: 0.2 }));
  face.rotation.z = Math.PI / 2;
  face.position.set(0.18, 0.74, 0);
  const claw = makeBox(g, 0.14, 0.10, 0.05, -0.19, 0.74, 0, makeMat(0x64748b, { metalness: 0.9, roughness: 0.3 }), { rz: 0.35 });
  g.remove(head, claw);
  g.add(shaft, grip, head, face, claw);
  return g;
}
function buildArmoryCase(stock) {
  const g = new THREE.Group();
  g.position.set(stock.x, ARMORY.baseY, stock.z);
  g.userData.studioName = `Display case: ${stock.label}`;
  const cabinet = makeMat(0x1c1917, { texType: 'wood', repeatX: 2, repeatY: 1, roughness: 0.6 });
  const steel = makeMat(0xcbd5e1, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.2, flatShading: false });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xbfe6ff, transparent: true, opacity: 0.24, roughness: 0.04,
    metalness: 0.12, side: THREE.DoubleSide, depthWrite: false,
    emissive: 0x1e3a5f, emissiveIntensity: 0.25
  });
  const base = makeBox(g, 2.6, 0.9, 1.5, 0, 0.45, 0, cabinet, { cast: true, recv: true });
  const top = makeBox(g, 2.7, 0.08, 1.6, 0, 0.94, 0, steel);
  const glass = makeBox(g, 2.4, 1.5, 1.3, 0, 1.73, 0, glassMat, { order: 3 });
  const frameParts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    frameParts.push(makeBox(g, 0.07, 1.5, 0.07, sx * 1.2, 1.73, sz * 0.65, steel));
  }
  const rim = makeBox(g, 2.5, 0.08, 1.4, 0, 2.50, 0, steel);
  frameParts.push(rim);
  const prop = buildPickupMesh('right', stock.id);
  if (prop.children.length > 1) prop.remove(prop.children[prop.children.length - 1]);
  prop.scale.setScalar(1.7);
  prop.position.set(0, 1.62, 0);
  prop.rotation.set(0.2, 0, 0.35);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.16, 10), steel);
  stand.position.y = 1.06;
  createNeonSign(g, `$${stock.price}`, 0, 0.62, 0.78, '#0b1220', '#facc15', 1.5, 0.42);
  createNeonSign(g, stock.label, 0, 2.78, 0, '#0b1220', '#38bdf8', 2.5, 0.36);
  g.remove(base, top, glass, rim, ...frameParts);
  g.add(base, top, glass, rim, stand, prop, ...frameParts);
  worldRoot.add(g);
  const baseBox = addWorldBox(stock.x - 1.3, stock.x + 1.3, ARMORY.baseY, ARMORY.baseY + 0.98, stock.z - 0.75, stock.z + 0.75, 'armory_case', true);
  const glassBox = addWorldBox(stock.x - 1.2, stock.x + 1.2, ARMORY.baseY + 0.98, ARMORY.baseY + 2.5, stock.z - 0.65, stock.z + 0.65, 'armory_glass', false);
  const rec = {
    id: stock.id, label: stock.label, price: stock.price,
    x: stock.x, z: stock.z, group: g, glass, prop, glassBox, baseBox,
    smashed: false, spin: rnd() * 6.28
  };
  armory.cases.push(rec);
  return rec;
}
function buildArmoryDumpster() {
  const g = new THREE.Group();
  g.position.set(ARMORY_DUMPSTER.x, 0.24, ARMORY_DUMPSTER.z);
  g.userData.studioName = 'Armory dumpster';
  const body = makeMat(0x15803d, { texType: 'corrugated', repeatX: 4, repeatY: 2, metalness: 0.6, roughness: 0.55 });
  const dark = makeMat(0x14532d, { roughness: 0.7 });
  const shell = makeBox(g, 3.6, 1.5, 2.2, 0, 0.85, 0, body, { cast: true, recv: true });
  const inner = makeBox(g, 3.3, 1.2, 1.9, 0, 1.05, 0, makeMat(0x0a0f0a, { roughness: 1 }));
  const lid = makeBox(g, 3.7, 0.12, 2.3, 0, 1.68, -0.75, dark, { cast: true, rx: -0.85 });
  const wheelMat = makeMat(0x1c1917);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 8), wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(sx * 1.5, 0.16, sz * 0.85);
    g.add(wheel);
  }
  const bagMat = makeMat(0x1c1917, { roughness: 0.95 });
  for (let i = 0; i < 3; i++) {
    const bag = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34 + i * 0.05, 0), bagMat);
    bag.position.set(-0.9 + i * 0.85, 1.35, 0.15 * (i - 1));
    bag.scale.y = 0.8;
    g.add(bag);
  }
  createNeonSign(g, 'AURA DISPOSAL', 0, 0.95, 1.13, '#14532d', '#bbf7d0', 2.6, 0.5);
  const hammer = makeSledgehammer();
  hammer.position.set(0.75, 1.30, 0.35);
  hammer.rotation.set(0.4, 0.6, 1.15);
  hammer.scale.setScalar(1.05);
  g.add(hammer);
  armory.hammerInDumpster = hammer;
  g.remove(shell, inner, lid);
  g.add(shell, inner, lid);
  worldRoot.add(g);
  addWorldBox(ARMORY_DUMPSTER.x - 1.8, ARMORY_DUMPSTER.x + 1.8, 0.24, 1.75, ARMORY_DUMPSTER.z - 1.1, ARMORY_DUMPSTER.z + 1.1, 'dumpster', true);
  armory.dumpster = g;
  // Alley dressing
  makeBox(worldRoot, 1.6, 0.16, 1.2, 109.5, 0.32, 478.5, makeMat(0x78350f, { texType: 'wood' }), {
    cast: true, box: [108.7, 110.3, 0.24, 0.40, 477.9, 479.1, 'pallet', true]
  });
  makeBox(worldRoot, 1.1, 1.0, 1.1, 109.5, 0.9, 478.5, makeMat(0xc2853e, { texType: 'wood' }), {
    cast: true, box: [108.95, 110.05, 0.40, 1.40, 477.95, 479.05, 'alley_crate', true]
  });
  makeBox(worldRoot, 0.5, 0.22, 0.3, 104, 3.6, 482.6, makeMat(0xfef08a, { emissive: 0xfacc15, emissiveIntensity: 1.1 }));
  const alleyLight = new THREE.PointLight(0xffd9a0, 2.2, 16, 2);
  alleyLight.position.set(104, 3.4, 480.5);
  worldRoot.add(alleyLight);
  createNeonSign(worldRoot, 'STAFF ONLY', 104, 2.6, 482.85, '#1c1917', '#f87171', 2.4, 0.45);
}
export function buildFirearmsArmory() {
  armory.built = true;
  armory.cases.length = 0;
  armory.dumpsterSearched = false;
  armory.hasHammer = false;
  armory.alarm = 0;
  armory.swing = 0;
  const { x, z, w, d, h, baseY } = ARMORY;
  const t = 0.4, doorW = 3.2, doorH = 3.0;
  const g = new THREE.Group();
  g.position.set(x, baseY, z);
  g.userData.studioName = 'AURA ARMORY';
  const wallMat = makeMat(0x27272a, { texType: 'concrete', repeatX: 5, repeatY: 2, roughness: 0.72 });
  const trimMat = makeMat(0xdc2626, { metalness: 0.55, roughness: 0.35 });
  const floor = makeBox(g, w - 0.2, 0.1, d - 0.2, 0, 0.05, 0,
    makeMat(0x3f3f46, { texType: 'concrete', repeatX: 6, repeatY: 6, roughness: 0.55 }), { recv: true });
  const backW = makeBox(g, w, h, t, 0, h / 2, -d / 2 + t / 2, wallMat, { cast: true });
  const leftW = new THREE.Group();
  leftW.position.set(-w / 2 + t / 2, 0, 0);
  leftW.rotation.y = Math.PI / 2;
  buildWallWithRealWindow(leftW, d - t * 2, h, t, 3.0, 1.6, 2.6, wallMat, false);
  const rightW = new THREE.Group();
  rightW.position.set(w / 2 - t / 2, 0, 0);
  rightW.rotation.y = -Math.PI / 2;
  buildWallWithRealWindow(rightW, d - t * 2, h, t, 3.0, 1.6, 2.6, wallMat, false);
  const segW = (w - doorW) / 2;
  const frontL = new THREE.Group();
  frontL.position.set(-(doorW / 2 + segW / 2), 0, d / 2 - t / 2);
  buildWallWithRealWindow(frontL, segW, h, t, segW - 1.0, 2.4, 2.1, wallMat, false);
  const frontR = new THREE.Group();
  frontR.position.set(doorW / 2 + segW / 2, 0, d / 2 - t / 2);
  buildWallWithRealWindow(frontR, segW, h, t, segW - 1.0, 2.4, 2.1, wallMat, false);
  const header = makeBox(g, doorW, h - doorH, t, 0, doorH + (h - doorH) / 2, d / 2 - t / 2, wallMat);
  const roof = makeBox(g, w + 0.8, 0.4, d + 0.8, 0, h + 0.2, 0, wallMat, { cast: true });
  const fascia = makeBox(g, w + 1.0, 0.34, d + 1.0, 0, h + 0.02, 0, trimMat);
  createNeonSign(g, 'AURA ARMORY', 0, 4.35, d / 2 + 0.16, '#0b0b0f', '#ef4444', 9.0, 1.25);
  createNeonSign(g, 'FIREARMS  •  AMMO  •  MELEE', 0, 3.35, d / 2 + 0.16, '#0b0b0f', '#facc15', 8.0, 0.6);
  // Interior fit-out lives in a distance-culled group.
  const inn = new THREE.Group();
  const slat = makeMat(0x52525b, { texType: 'corrugated', repeatX: 8, repeatY: 2, metalness: 0.5, roughness: 0.6 });
  const steel = makeMat(0xe2e8f0, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.18, flatShading: false });
  const counterMat = makeMat(0x1c1917, { texType: 'wood', repeatX: 3, repeatY: 1 });
  makeBox(inn, w - 1.2, 3.0, 0.14, 0, 2.0, -d / 2 + 0.55, slat);
  makeBox(inn, 1.5, 1.05, 6.0, w / 2 - 1.5, 0.55, 0.5, counterMat);
  makeBox(inn, 1.7, 0.1, 6.2, w / 2 - 1.5, 1.12, 0.5, steel);
  makeBox(inn, 0.7, 0.45, 0.55, w / 2 - 1.5, 1.4, 2.0, makeMat(0x0f172a, { metalness: 0.6 }));
  makeBox(inn, 0.5, 0.3, 0.05, w / 2 - 1.5, 1.5, 2.3, makeMat(0x22d3ee, { emissive: 0x0891b2, emissiveIntensity: 0.8 }));
  addWorldBox(x + w / 2 - 2.35, x + w / 2 - 0.65, baseY, baseY + 1.17, z - 2.5, z + 3.5, 'armory_counter', true);
  // Ammo shelf + purchasable sausage crate
  makeBox(inn, 3.0, 2.2, 0.6, -w / 2 + 2.0, 1.1, -d / 2 + 1.0, slat);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
    makeBox(inn, 0.42, 0.3, 0.34, -w / 2 + 0.9 + c * 0.52, 0.55 + r * 0.62, -d / 2 + 1.35,
      makeMat(r % 2 ? 0xd97706 : 0xb91c1c, { roughness: 0.6 }));
  }
  const ammoCrate = makeBox(inn, 1.1, 0.8, 0.9, ARMORY_AMMO.x - x, 0.4, ARMORY_AMMO.z - z,
    makeMat(0xd97706, { texType: 'wood' }), { cast: true });
  armory.ammoBox = ammoCrate;
  addWorldBox(ARMORY_AMMO.x - 0.55, ARMORY_AMMO.x + 0.55, baseY, baseY + 0.8, ARMORY_AMMO.z - 0.45, ARMORY_AMMO.z + 0.45, 'armory_ammo', true);
  for (const lx of [-5.5, 0, 5.5]) {
    makeBox(inn, 3.4, 0.1, 0.5, lx, h - 0.35, 0, makeMat(0xfff7d6, { emissive: 0xfff7d6, emissiveIntensity: 0.9 }));
  }
  const shopLight = new THREE.PointLight(0xfff1d6, 2.4, 26, 2);
  shopLight.position.set(0, h - 1.0, 0);
  inn.add(shopLight);
  createNeonSign(inn, 'LICENSED DEALER  •  NO REFUNDS', 0, 3.9, -d / 2 + 0.7, '#0b0b0f', '#a1a1aa', 7.0, 0.5);
  createNeonSign(inn, 'SAUSAGE AMMO  [E] $60', ARMORY_AMMO.x - x, 1.5, ARMORY_AMMO.z - z + 0.6, '#7f1d1d', '#fef08a', 2.8, 0.45);
  g.remove(floor, backW, header, roof, fascia);
  g.add(floor, backW, leftW, rightW, frontL, frontR, header, roof, fascia, inn);
  worldRoot.add(g);
  (aura.culls || []).push({ g: inn, x, z, r: 80 });
  const minX = x - w / 2, maxX = x + w / 2, minZ = z - d / 2, maxZ = z + d / 2;
  addWorldBox(minX, maxX, baseY, baseY + h, minZ, minZ + t, 'wall', false);
  addWorldBox(minX, minX + t, baseY, baseY + h, minZ, maxZ, 'wall', false);
  addWorldBox(maxX - t, maxX, baseY, baseY + h, minZ, maxZ, 'wall', false);
  addWorldBox(minX, x - doorW / 2, baseY, baseY + h, maxZ - t, maxZ, 'wall', false);
  addWorldBox(x + doorW / 2, maxX, baseY, baseY + h, maxZ - t, maxZ, 'wall', false);
  addWorldBox(minX, maxX, baseY + h - 0.1, baseY + h + 0.4, minZ, maxZ, 'roof', true);
  addWorldBox(minX + t, maxX - t, baseY, baseY + 0.10, minZ + t, maxZ - t, 'armory_floor', true);
  enterableZones.push({ minX: minX + 0.4, maxX: maxX - 0.4, minZ: minZ + 0.4, maxZ: maxZ - 0.3, name: 'AURA ARMORY' });
  mapShapes.push({ x, z, w, d, color: '#dc2626', border: '#facc15', enterable: true });
  for (const stock of ARMORY_STOCK) buildArmoryCase(stock);
  buildArmoryDumpster();
  armory.hammerMesh = makeSledgehammer();
  armory.hammerMesh.visible = false;
  armory.hammerMesh.scale.setScalar(0.95);
  armory.hammerMesh.userData.studioSelectable = false;
  worldRoot.add(armory.hammerMesh);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
  beacon.position.set(x, baseY + h + 0.8, z + d / 2 - 0.5);
  beacon.visible = false;
  worldRoot.add(beacon);
  armory.alarmBeacon = beacon;
  const alarmLight = new THREE.PointLight(0xff2d2d, 0, 30, 2);
  alarmLight.position.set(x, baseY + 3.4, z);
  worldRoot.add(alarmLight);
  armory.alarmLight = alarmLight;
  // Chain the armory into the existing world interaction hooks.
  const prevHint = aura.ahHint, prevF = aura.ahF;
  aura.ahHint = () => armoryHintText() || (prevHint ? prevHint() : '');
  aura.ahF = () => { if (armorySmash()) return; if (prevF) prevF(); };
}
function armoryActive() {
  return armory.built && gameState.screen === 'playing' && !gameState.inCar
    && !gameState.inventoryOpen && !gameState.mapOpen && !gameState.settingsOpen
    && !under() && player.y > -1;
}
function armoryTarget() {
  if (!armoryActive()) return null;
  let best = null;
  const consider = (kind, x, z, range, data) => {
    const d2 = dist2(player.x, player.z, x, z);
    if (d2 < range * range && Math.abs(player.y - 0.24) < 2.4 && (!best || d2 < best.d2)) best = { kind, d2, data };
  };
  if (!armory.dumpsterSearched) consider('dumpster', ARMORY_DUMPSTER.x, ARMORY_DUMPSTER.z, 3.0, null);
  consider('ammo', ARMORY_AMMO.x, ARMORY_AMMO.z, 2.6, null);
  for (const c of armory.cases) if (!c.smashed) consider('case', c.x, c.z, 2.6, c);
  return best;
}
function armoryHintText() {
  const t = armoryTarget();
  if (!t) return '';
  if (t.kind === 'dumpster') return '[E] SEARCH DUMPSTER';
  if (t.kind === 'ammo') return `[E] BUY 60 SAUSAGES — $${ARMORY_AMMO.price}`;
  const c = t.data;
  const buy = gameState.cash >= c.price ? `[E] BUY $${c.price}` : `[E] BUY $${c.price} (SHORT $${c.price - gameState.cash})`;
  return armory.hasHammer ? `${buy} · [F] SMASH CASE` : `${buy} · REINFORCED GLASS`;
}
function armoryEquip(id) {
  if (!gameState.rightWeapons.includes(id)) gameState.rightWeapons.push(id);
  gameState.activeRightWeapon = id;
  if (id === 'hotdog_shooter') gameState.hotdogAmmo = MAX_HOTDOG_AMMO;
  hooks.syncEquippedMeshes();
  hooks.updateHUD(true);
}
/** [E] — cash-gated purchase, dumpster search, ammo refill. */
function armoryBuy() {
  const t = armoryTarget();
  if (!t) return false;
  if (t.kind === 'dumpster') {
    armory.dumpsterSearched = true;
    armory.hasHammer = true;
    if (armory.hammerInDumpster) armory.hammerInDumpster.visible = false;
    sfx.pickup();
    spawnParticles(ARMORY_DUMPSTER.x, 1.6, ARMORY_DUMPSTER.z, 0x94a3b8, 8, 4.0);
    pushFeed('SLEDGEHAMMER FOUND — [F] SMASHES DISPLAY GLASS', 'border-l-amber-400');
    hooks.mpWorldEvent({ t: 'armory_hammer' });
    return true;
  }
  if (t.kind === 'ammo') {
    if (gameState.cash < ARMORY_AMMO.price) {
      sfx.uiClick();
      pushFeed(`NOT ENOUGH CASH — $${ARMORY_AMMO.price} NEEDED`, 'border-l-rose-500');
      return true;
    }
    gameState.cash -= ARMORY_AMMO.price;
    gameState.hotdogAmmo = MAX_HOTDOG_AMMO;
    sfx.pickup();
    hooks.updateHUD(true);
    pushFeed(`BOUGHT 60 SAUSAGES -$${ARMORY_AMMO.price}`, 'border-l-amber-400');
    hooks.mpWorldEvent({ t: 'armory_ammo' });
    return true;
  }
  const c = t.data;
  if (gameState.cash < c.price) {
    sfx.uiClick();
    pushFeed(`NOT ENOUGH CASH — ${c.label} IS $${c.price}`, 'border-l-rose-500');
    return true;
  }
  gameState.cash -= c.price;
  armoryEquip(c.id);
  sfx.pickup();
  spawnParticles(c.x, 2.0, c.z, 0xfacc15, 8, 3.5);
  pushFeed(`PURCHASED ${c.label} -$${c.price}`, 'border-l-emerald-400');
  hooks.mpWorldEvent({ t: 'armory_buy', id: c.id });
  return true;
}
/** [F] — smash the vitrine with the sledgehammer and take the weapon. */
function armorySmash() {
  const t = armoryTarget();
  if (!t || t.kind !== 'case') return false;
  if (!armory.hasHammer) {
    sfx.uiClick();
    pushFeed('THE GLASS HOLDS — YOU NEED SOMETHING HEAVY', 'border-l-slate-400');
    return true;
  }
  const c = t.data;
  c.smashed = true;
  c.glass.visible = false;
  if (c.prop) c.prop.visible = false;
  const gi = worldBoxes.indexOf(c.glassBox);
  if (gi !== -1) worldBoxes.splice(gi, 1);
  armory.swing = 1;
  armory.alarm = 45;
  sfx.smash();
  spawnParticles(c.x, 1.9, c.z, 0xbfe6ff, 16, 7.0);
  spawnParticles(c.x, 1.9, c.z, 0xffffff, 10, 5.5);
  spawnWorldPickup('right', c.id, c.x, 0.24, c.z + 1.5);
  if (!hooks.mpIsGuest()) crime(0.9);
  pushFeed(`CASE SMASHED — ${c.label} GRABBED • ALARM!`, 'border-l-rose-500');
  hooks.mpWorldEvent({ t: 'armory_smash', id: c.id });
  return true;
}
let armoryKeyBound = false;
function bindArmoryKey() {
  if (armoryKeyBound) return;
  armoryKeyBound = true;
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyE' || e.repeat) return;
    const tag = e.target && e.target.tagName;
    if (tag && /INPUT|TEXTAREA|SELECT/.test(tag)) return;
    if (armoryBuy()) e.preventDefault();
  });
}
const _hammerV = new THREE.Vector3();
function updateArmory(dt, elapsed) {
  if (!armory.built) return;
  for (const c of armory.cases) {
    if (c.smashed || !c.prop) continue;
    c.spin += dt * 0.7;
    c.prop.rotation.y = c.spin;
  }
  if (armory.swing > 0) armory.swing = Math.max(0, armory.swing - dt * 3.2);
  if (armory.alarm > 0) {
    armory.alarm -= dt;
    const pulse = (Math.sin(elapsed * 12) + 1) * 0.5;
    if (armory.alarmLight) armory.alarmLight.intensity = 1.2 + pulse * 5.0;
    if (armory.alarmBeacon) armory.alarmBeacon.visible = pulse > 0.4;
  } else {
    if (armory.alarmLight) armory.alarmLight.intensity = 0;
    if (armory.alarmBeacon) armory.alarmBeacon.visible = false;
  }
  const hm = armory.hammerMesh;
  if (!hm) return;
  const show = armory.hasHammer && !gameState.inCar && gameState.screen === 'playing';
  hm.visible = show;
  if (!show) return;
  const swingAngle = Math.sin(armory.swing * Math.PI) * 1.5;
  if (gameState.thirdPerson) {
    const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    hm.position.set(player.x + rx * 0.36, player.y + 1.02, player.z + rz * 0.36);
    hm.rotation.set(-0.5 - swingAngle, player.yaw, 0.28);
  } else {
    hooks.getRightMountWorldPosition(_hammerV);
    hm.position.copy(_hammerV);
    hm.quaternion.copy(camera.quaternion);
    hm.rotateX(-0.55 - swingAngle);
    hm.rotateZ(0.22);
  }
}

// =============================================================================
// GROUND INTEGRITY — no ray should ever reach the void
// =============================================================================
export function buildGroundIntegrity() {
  const grp = new THREE.Group();
  grp.userData.studioName = 'Ground integrity';
  grp.userData.studioSelectable = false;
  worldRoot.add(grp);
  const rockSide = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
  /** Terrain panel built from the exact collision heightfield. */
  const rangePanel = (x0, x1, z0, z1, sx, sz, name) => {
    const geo = new THREE.PlaneGeometry(x1 - x0, z0 - z1, sx, sz);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color(), c2 = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + (x0 + x1) / 2, z = pos.getZ(i) + (z0 + z1) / 2;
      const hh = terrainBaseH(x, z);
      pos.setXYZ(i, x, hh - 0.1, z);
      const n = fbm(x * 0.05, z * 0.05, 3);
      c.set(0x547a3a).lerp(c2.set(0x6e8a45), n);
      c.lerp(c2.set(0x8a8070), sstep(95, 150, hh));
      c.lerp(c2.set(0xf2f6fa), sstep(150, 178, hh));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, rockSide);
    m.receiveShadow = true;
    m.userData.studioName = name;
    grp.add(m);
    return m;
  };
  // The collision heightfield runs the mountain formula for ANY x north of
  // z = -170. These panels give that invisible ground a visible surface.
  rangePanel(-720, -196, -170, -600, 132, 108, 'Northwest range');
  rangePanel(424, 560, -170, -600, 46, 108, 'Northeast range');
  const sand = makeMat(0xe8d3a2, { texType: 'sand', repeatX: 6, repeatY: 6, roughness: 0.96 });
  const patch = (x0, x1, z0, z1, y, mat, name) => makeBox(grp, x1 - x0, 0.4, z1 - z0,
    (x0 + x1) / 2, y - 0.2, (z0 + z1) / 2, mat, {
      recv: true, name, box: [x0, x1, y - 0.4, y, z0, z1, 'ground_patch', true]
    });
  patch(138, 164, 190, 208, 0.17, sand, 'Cove east shore');
  patch(368, 533, 240, 320, 0.17, sand, 'North jungle shore');
  // Jungle north lip: closes the 1.33 step down to the new shore.
  makeBox(grp, 165, 1.5, 0.6, 450.5, 0.85, 240.3,
    makeMat(0x4a3f2c, { texType: 'redrock', repeatX: 16, repeatY: 1, roughness: 0.95 }), { recv: true });
  // Dark backstop under all northern & western land — the last guarantee.
  const backstopMat = new THREE.MeshStandardMaterial({ color: 0x2b3129, roughness: 1 });
  const backstop = (x0, x1, z0, z1, name) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), backstopMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, -0.55, (z0 + z1) / 2);
    m.userData.studioName = name;
    m.renderOrder = -1;
    grp.add(m);
  };
  backstop(-760, 580, -640, -168, 'Northern backstop');
  backstop(-760, -196, -168, 108, 'Western backstop');
}

// =============================================================================
// COUNTY LINE — proximity-fade perimeter barrier
// =============================================================================
const barrierChunks = [];
export function buildEdgeBarrier() {
  barrierChunks.length = 0;
  const root = new THREE.Group();
  root.userData.studioName = 'Aura county line';
  root.userData.studioSelectable = false;
  worldRoot.add(root);
  const minX = WORLD_BOUNDS.minX + 3, maxX = WORLD_BOUNDS.maxX - 3;
  const minZ = WORLD_BOUNDS.minZ + 3, maxZ = WORLD_BOUNDS.maxZ - 3;
  const CHUNK = 46;
  const themeAt = (x, z) => {
    if (z < -170) return { body: 0x6b6257, cap: 0x8a8175, label: 'AVALANCHE ZONE' };
    if (x < -196) return { body: 0x57534e, cap: 0x78716c, label: 'BACKCOUNTRY CLOSED' };
    if (x > 424) return { body: 0x4d7c0f, cap: 0x65a30d, label: 'JUNGLE RESERVE' };
    return { body: 0xd1d5db, cap: 0xef4444, label: 'END OF AURA COUNTY' };
  };
  const makeChunk = (cx, cz, alongX, len, index) => {
    const theme = themeAt(cx, cz);
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.visible = false;
    const bodyMat = new THREE.MeshStandardMaterial({
      color: theme.body, roughness: 0.88, metalness: 0.05, transparent: true, opacity: 0, depthWrite: false
    });
    const capMat = new THREE.MeshStandardMaterial({
      color: theme.cap, roughness: 0.5, metalness: 0.2,
      emissive: theme.cap, emissiveIntensity: 0.35, transparent: true, opacity: 0, depthWrite: false
    });
    makeBox(g, alongX ? len : 1.1, 2.6, alongX ? 1.1 : len, 0, 1.3, 0, bodyMat);
    makeBox(g, alongX ? len : 1.3, 0.24, alongX ? 1.3 : len, 0, 2.72, 0, capMat);
    const postCount = Math.max(2, Math.round(len / 12));
    for (let i = 0; i <= postCount; i++) {
      const t = (i / postCount - 0.5) * len;
      makeBox(g, 0.22, 0.5, 0.22, alongX ? t : 0, 3.05, alongX ? 0 : t, capMat);
    }
    if (index % 4 === 0) {
      const sign = createNeonSign(g, theme.label, 0, 3.9, 0, '#0b0b0f', '#facc15', 9.0, 1.0);
      if (!alongX) sign.rotation.y = Math.PI / 2;
      sign.material.forEach((m) => { m.transparent = true; m.opacity = 0; });
      g.userData.signMats = sign.material;
    }
    root.add(g);
    barrierChunks.push({ group: g, x: cx, z: cz, mats: [bodyMat, capMat], opacity: 0 });
  };
  let idx = 0;
  const spanX = maxX - minX, spanZ = maxZ - minZ;
  const nx = Math.max(1, Math.ceil(spanX / CHUNK)), nz = Math.max(1, Math.ceil(spanZ / CHUNK));
  const lx = spanX / nx, lz = spanZ / nz;
  for (let i = 0; i < nx; i++) {
    const cx = minX + lx * (i + 0.5);
    makeChunk(cx, minZ, true, lx + 0.4, idx++);
    makeChunk(cx, maxZ, true, lx + 0.4, idx++);
  }
  for (let i = 0; i < nz; i++) {
    const cz = minZ + lz * (i + 0.5);
    makeChunk(minX, cz, false, lz + 0.4, idx++);
    makeChunk(maxX, cz, false, lz + 0.4, idx++);
  }
}
export function updateEdgeBarrier() {
  // Squared-distance gate; sqrt only inside the fade band where it is needed.
  const NEAR = 46, FAR = 96, NEAR2 = NEAR * NEAR, FAR2 = FAR * FAR;
  for (let i = 0; i < barrierChunks.length; i++) {
    const c = barrierChunks[i];
    const d2 = dist2(player.x, player.z, c.x, c.z);
    const target = d2 >= FAR2 ? 0 : (d2 <= NEAR2 ? 1 : sstep(FAR, NEAR, Math.sqrt(d2)));
    if (Math.abs(target - c.opacity) < 0.004) continue;
    c.opacity = target;
    c.group.visible = target > 0.01;
    for (const m of c.mats) m.opacity = target;
    const sm = c.group.userData.signMats;
    if (sm) for (const m of sm) m.opacity = target;
  }
}

// -----------------------------------------------------------------------------
// Atmosphere, snow, river flow, world ambience & the per-frame water tick
// -----------------------------------------------------------------------------
export const bio = { base: null, snow: null, last: 'city' };
export const bioC = {};
export function updateBiomeAtmosphere(dt, elapsed) {
  const b = biomeAt(player.x, player.z);
  if (!bio.base) bio.base = scene.fog.color.clone();
  const camSurf = getWaterHeightAt(camera.position.x, camera.position.z, elapsed);
  const camUnderwater = camSurf !== null && camera.position.y < camSurf - 0.04;
  if (!camUnderwater) {
    const tgt = { alpine: [0xdbe9f4, 0.007], woods: [0x9ccaa6, 0.0048], cove: [0xaee2f4, 0.0024], jungle: [0x2d5a27, 0.006] }[b];
    const k = Math.min(1, dt * 1.5);
    scene.fog.color.lerp(tgt ? (bioC[tgt[0]] || (bioC[tgt[0]] = new THREE.Color(tgt[0]))) : bio.base, k);
    scene.fog.density += ((tgt ? tgt[1] : 0.0032) - scene.fog.density) * k;
  }
  if (b !== bio.last) {
    bio.last = b;
    if (b !== 'city') pushFeed({
      alpine: 'FROSTPINE ALPINE — ICY & SLIPPERY • LOOP ROAD OPEN',
      woods: 'EMERALD WOODS — STREAMS SLOW YOU DOWN',
      cove: 'SUNSET COVE — SWIM & DIVE THE SEABED',
      jungle: 'VERDANT JUNGLE — RIVER CURRENT RUNS SOUTH'
    }[b], 'border-l-sky-400');
  }
  if (!bio.snow) {
    const N = 420, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (rnd() - 0.5) * 44;
      pos[i * 3 + 1] = rnd() * 16;
      pos[i * 3 + 2] = (rnd() - 0.5) * 44;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    bio.snow = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.14, transparent: true, opacity: 0.9 }));
    bio.snow.frustumCulled = false;
    bio.snow.userData.persistentFX = true;
    worldRoot.add(bio.snow);
  }
  bio.snow.visible = (b === 'alpine');
  if (b === 'alpine') {
    const a = bio.snow.geometry.attributes.position, arr = a.array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] -= (1.4 + (i % 5) * 0.35) * dt;
      arr[i] += Math.sin(elapsed + i) * 0.3 * dt;
      if (arr[i + 1] < -2) arr[i + 1] = 14;
    }
    a.needsUpdate = true;
    bio.snow.position.set(player.x, player.y, player.z);
  }
  const nb = buildNewBiomes.fire;
  if (nb) {
    const f = 0.85 + Math.sin(elapsed * 17) * 0.15 + Math.random() * 0.1;
    nb.fire.scale.set(f, 0.9 + Math.random() * 0.3, f);
    nb.fl.intensity = 1.3 + Math.random() * 0.6;
  }
  const wf = buildJungleBiome.waterfall;
  if (wf) {
    wf.fallSheet.material.opacity = 0.62 + Math.sin(elapsed * 9) * 0.1;
    wf.mistPool.scale.setScalar(1 + Math.sin(elapsed * 2.2) * 0.06);
  }
  const wheel = buildLosAuraNorthExpansion.wheel;
  if (wheel) {
    wheel.angle += dt * 0.13;
    wheel.group.rotation.z = wheel.angle;
    for (const pod of wheel.pods) pod.rotation.z = -wheel.angle;
  }
  updateArmory(dt, elapsed);
  updateAirport(dt, elapsed);
  updateEdgeBarrier();
  for (const r of riverFlowMats) {
    if (r.mat.map) r.mat.map.offset.y = (r.mat.map.offset.y - dt * r.speed) % 1;
  }
  updateWaterOnce(dt, elapsed);
}
export const concMat = new THREE.MeshStandardMaterial({ color: 0x7d8280, roughness: .95 });
export const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
export const waterMat = new THREE.MeshStandardMaterial({ color: 0x2f5f4a, roughness: .15, metalness: .2, transparent: true, opacity: .82, emissive: 0x0b2a1e });
// -----------------------------------------------------------------------------
// Scorpion Hideout
// -----------------------------------------------------------------------------
export function buildCriminalHideout() {
  const cx = 332, cz = 130, baseY = 0.02, half = 30, peak = 32;
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xc28b47, roughness: 0.96, flatShading: true, side: THREE.DoubleSide });
  const chamberMat = new THREE.MeshStandardMaterial({ color: 0x34383b, roughness: 0.92 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x9a6a32, roughness: 0.85 });
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffc15a });
  const triangle = (a, b, c) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b), new THREE.Vector3(...c)]);
    geometry.setIndex([0, 1, 2]);
    geometry.computeVertexNormals();
    const m = new THREE.Mesh(geometry, shellMat);
    m.castShadow = true;
    m.receiveShadow = true;
    worldRoot.add(m);
  };
  const xw = cx - half, xe = cx + half, zn = cz - half, zs = cz + half;
  const apex = [cx, peak, cz];
  triangle([xw, baseY, zn], [xw, baseY, cz - 11], apex);
  triangle([xw, baseY, cz + 11], [xw, baseY, zs], apex);
  triangle([xw, 8.5, cz - 11], [xw, 8.5, cz + 11], apex);
  triangle([xe, baseY, zn], [xe, baseY, zs], apex);
  triangle([xw, baseY, zn], [xe, baseY, zn], apex);
  triangle([xe, baseY, zs], [xw, baseY, zs], apex);
  const box = (x, y, z, w, h, d, material, solid = false) => makeBox(worldRoot, w, h, d, x, y, z, material, {
    cast: true, recv: true,
    box: solid ? [x - w / 2, x + w / 2, baseY, baseY + h, z - d / 2, z + d / 2, 'solid', false] : null
  });
  box(cx, baseY + 0.06, cz, 54, 0.12, 54, chamberMat);
  box(cx, 8.1, cz, 50, 0.4, 50, chamberMat);
  box(cx, 4, cz - 25, 50, 8, 2, chamberMat, true);
  box(cx, 4, cz + 25, 50, 8, 2, chamberMat, true);
  box(cx + 25, 4, cz, 2, 8, 50, chamberMat, true);
  box(cx - 25, 4, cz - 20, 2, 8, 10, chamberMat, true);
  box(cx - 25, 4, cz + 20, 2, 8, 10, chamberMat, true);
  box(cx - 25, 7.8, cz, 2, 0.3, 30, chamberMat);
  box(cx - 42, baseY + 0.04, cz, 34, 0.08, 24, trimMat);
  box(cx - 24, 4, cz, 0.3, 0.3, 20, lightMat);
  box(cx, 4, cz - 24, 0.3, 0.3, 16, lightMat);
  const sign = new THREE.Group();
  sign.position.set(xw - 0.25, 7.5, cz);
  sign.rotation.y = -Math.PI / 2;
  createNeonSign(sign, 'REDROCK SCORPION HIDEOUT', 0, 0, 0, '#1c1917', '#fbbf24', 13, 1.25);
  worldRoot.add(sign);
  const beacon = new THREE.PointLight(0xffb14a, 55, 30, 2);
  beacon.position.set(cx, 6.5, cz);
  worldRoot.add(beacon);
  enterableZones.push({ minX: cx - 24, maxX: cx + 24, minZ: cz - 24, maxZ: cz + 24, name: 'REDROCK SCORPION HIDEOUT' });
  mapShapes.push({ x: cx, z: cz, w: 60, d: 60, color: '#b77935', border: '#78350f', enterable: true });
  const tank = buildSportsCar({ name: 'REDROCK SCORPION TANK', bodyHex: 0x4b5541, accentHex: 0x252a22, x: cx + 1, z: cz, yaw: -Math.PI / 2, isCoupe: false });
  placeCar(tank, 0.14);
  tank.isTank = true;
  tank.chassis.visible = false;
  tank.wheelPivots.forEach((wheel) => { wheel.visible = false; });
  const hull = new THREE.Group();
  const armor = new THREE.MeshStandardMaterial({ color: 0x59664c, roughness: 0.78, metalness: 0.2 });
  const darkArmor = new THREE.MeshStandardMaterial({ color: 0x30372e, roughness: 0.9 });
  makeBox(hull, 2.8, 1.1, 4.7, 0, 0.95, 0, armor, { cast: true });
  for (const side of [-1, 1]) {
    makeBox(hull, 0.55, 0.95, 4.9, side * 1.55, 0.39, 0, darkArmor, { cast: true });
    for (let i = 0; i < 10; i++) makeBox(hull, 0.58, 0.07, 0.28, side * 1.56, 0.39, -2.05 + i * 0.45, armor);
  }
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 1.08, 0.62, 10), armor);
  turret.position.set(0, 1.75, -0.15);
  turret.castShadow = true;
  hull.add(turret);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.19, 2.8, 10), darkArmor);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 1.78, 1.55);
  hull.add(barrel);
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.13, 8), darkArmor);
  hatch.position.set(0, 2.12, -0.18);
  hull.add(hatch);
  tank.root.add(hull);
  tank.tankModel = hull;
  return tank;
}
function placeCar(car, y) {
  if (!car) return car;
  car.y = y;
  car.root.position.y = y;
  return car;
}

// -----------------------------------------------------------------------------
// Northern mountains — extended to the collision domain and reforested
// -----------------------------------------------------------------------------
export function buildMountains() {
  const X0 = -196, X1 = 424, Z0 = -170, Z1 = -600, SX = 310, SZ = 215;
  const g = new THREE.PlaneGeometry(X1 - X0, Z0 - Z1, SX, SZ);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color(), c2 = new THREE.Color();
  const scree = new THREE.Color(0x8a8175); // hoisted: was allocated per-vertex
  const stv = SX + 1, Hh = new Float32Array(p.count);
  const dx = (X1 - X0) / SX, dz = (Z0 - Z1) / SZ;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + (X0 + X1) / 2, z = p.getZ(i) + (Z0 + Z1) / 2;
    const h = terrainBaseH(x, z);
    Hh[i] = h;
    p.setXYZ(i, x, h - 0.1, z);
  }
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), h = Hh[i];
    const cx = i % stv, cz = (i / stv) | 0;
    const il = cx > 0 ? i - 1 : i, ir = cx < SX ? i + 1 : i;
    const iu = cz > 0 ? i - stv : i, id = cz < SZ ? i + stv : i;
    const sl = Math.abs(Hh[ir] - Hh[il]) / (2 * dx) + Math.abs(Hh[id] - Hh[iu]) / (2 * dz);
    const n = fbm(x * .08, z * .08, 3), n2 = fbm(x * .02 + 7, z * .02, 3);
    const snowLine = 150 + n * 30;
    c.set(0x547a3a).lerp(c2.set(0x6e8a45), n);
    c.lerp(c2.set(0x34502f), sstep(35, 70, h));
    c.lerp(c2.set(0x8a8070), sstep(95, 140, h));
    c.lerp(c2.set(0x6d655b).lerp(scree, n), sstep(.4, .85, sl));
    if (sl > .4) c.multiplyScalar(.92 + .08 * Math.sin(h * .45 + n * 6));
    c.lerp(c2.set(0xf2f6fa), sstep(snowLine - 12, snowLine + 8, h) * (1 - sstep(.7, 1.0, sl)));
    c.multiplyScalar(.9 + .2 * n2);
    const rd = Math.abs(x - riverX(z));
    if (rd < 7.5) c.lerp(c2.set(0x3a4a52), (1 - rd / 7.5) * 0.85);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, makeTerrainBlendMaterial({ roughness: 1 }));
  paintMeshTerrainSplat(mesh, 'mountains');
  mesh.receiveShadow = true;
  mesh.userData.studioName = 'Northern mountains';
  registerSculptableTerrain(mesh);
  worldRoot.add(mesh);
  function ribbon(hw, dy, hex) {
    const pos = [], idx = [];
    let k = 0;
    for (let z = -168; z >= -584; z -= 2.5) {
      const cx = roadC(z), tx = roadC(z - 1) - cx, len = Math.hypot(tx, 1);
      const nx = 1 / len, nz = -tx / len, y = roadH(z) + dy;
      pos.push(cx - nx * hw, y, z - nz * hw, cx + nx * hw, y, z + nz * hw);
      if (k > 0) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      k++;
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    gg.setIndex(idx);
    gg.computeVertexNormals();
    const m = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ color: hex, roughness: .92, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    worldRoot.add(m);
  }
  ribbon(5.2, 0.05, 0x23262b);
  ribbon(0.12, 0.08, 0xe9c33a);
  const pineG = new THREE.ConeGeometry(2.1, 8, 7); pineG.translate(0, 5.0, 0);
  const trunkG = new THREE.CylinderGeometry(0.26, 0.4, 2.4, 6); trunkG.translate(0, 1.2, 0);
  const snowPineG = new THREE.ConeGeometry(1.8, 6.4, 7); snowPineG.translate(0, 4.2, 0);
  const snowCapG = new THREE.ConeGeometry(1.25, 2.6, 7); snowCapG.translate(0, 6.6, 0);
  const snowTreeMat = new THREE.MeshStandardMaterial({ color: 0xe8f1f6, roughness: 0.92, flatShading: true });
  const PINE_CAP = 4000, SNOW_CAP = 700, ROCK_CAP = 420;
  const pines = new THREE.InstancedMesh(pineG, treeLeafMaterial, PINE_CAP);
  const trunks = new THREE.InstancedMesh(trunkG, treeBarkMaterial, PINE_CAP);
  const snowPines = new THREE.InstancedMesh(snowPineG, treeLeafMaterial, SNOW_CAP);
  const snowCaps = new THREE.InstancedMesh(snowCapG, snowTreeMat, SNOW_CAP);
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1.6, 0), rockMat, ROCK_CAP);
  const dm = new THREE.Object3D();
  let np = 0, ns = 0, nr = 0;
  for (let k = 0; k < 46000 && (np < PINE_CAP || ns < SNOW_CAP || nr < ROCK_CAP); k++) {
    const x = X0 + 8 + rnd() * (X1 - X0 - 16), z = -175 - rnd() * 415;
    const h = terrainH(x, z);
    if (Math.abs(x - roadC(z)) < 11) continue;
    if (Math.abs(x - riverX(z)) < 8) continue;
    const sl = Math.abs(terrainH(x + 3, z) - terrainH(x - 3, z)) / 6;
    const grove = fbm(x * .05, z * .05, 2);
    if (np < PINE_CAP && h > 4 && h < 112 && sl < .58 && grove > .36) {
      const s = .8 + rnd() * 1.3;
      dm.position.set(x, h - .2, z);
      dm.scale.set(s, s * (.9 + rnd() * .6), s);
      dm.rotation.set(0, rnd() * 6, 0);
      dm.updateMatrix();
      pines.setMatrixAt(np, dm.matrix);
      trunks.setMatrixAt(np, dm.matrix);
      np++;
    } else if (ns < SNOW_CAP && h >= 108 && h < 168 && sl < .52 && grove > .40) {
      const s = .7 + rnd() * 0.9;
      dm.position.set(x, h - .2, z);
      dm.scale.set(s, s * (.9 + rnd() * .4), s);
      dm.rotation.set(0, rnd() * 6, 0);
      dm.updateMatrix();
      snowPines.setMatrixAt(ns, dm.matrix);
      snowCaps.setMatrixAt(ns, dm.matrix);
      ns++;
    } else if (nr < ROCK_CAP && sl > .3) {
      dm.position.set(x, h, z);
      const s = .6 + rnd() * 2.2;
      dm.scale.set(s, s * .7, s);
      dm.rotation.set(rnd() * 3, rnd() * 3, 0);
      dm.updateMatrix();
      rocks.setMatrixAt(nr++, dm.matrix);
    }
  }
  pines.count = np; trunks.count = np;
  snowPines.count = ns; snowCaps.count = ns;
  rocks.count = nr;
  pines.castShadow = true;
  snowPines.castShadow = true;
  worldRoot.add(pines, trunks, snowPines, snowCaps, rocks);
  console.log(`[mountains] ${np} pines, ${ns} snow pines, ${nr} rocks`);
  const river = buildRiverSystem({
    id: 'aura_river', parent: worldRoot, centerX: riverX, z0: -584, z1: -176,
    halfWidth: 5, lift: 0.24, waveScale: 0.14, currentZ: 0.9, flowSpeed: 0.5,
    shallowColor: 0x67e8f9, deepColor: 0x0c4a6e, foamColor: 0xe0f2fe
  });
  for (const bz of [-260, -430]) {
    buildRiverBridge(worldRoot, riverX(bz), bz, river.surfAt(bz) + 0.3, 16, { stone: false, deckW: 4.2 });
    mapShapes.push({ x: riverX(bz), z: bz, w: 16, d: 4.2, color: '#78350f', border: '#fcd34d', enterable: false });
  }
  [-220, -300, -380, -460, -520].forEach((bz, i) => {
    const bx = riverX(bz) + (i % 2 ? 2 : -2), by = terrainH(bx, bz);
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.0 + (i % 3) * 0.25, 0), rockMat);
    rock.position.set(bx, by + 0.35, bz);
    rock.castShadow = true;
    worldRoot.add(rock);
    addWorldBox(bx - 0.9, bx + 0.9, by, by + 1.1, bz - 0.9, bz + 0.9, 'river_boulder', true);
  });
  spawnRiverLog(worldRoot, riverX(-340) + 1, -340);
  spawnRiverLog(worldRoot, riverX(-480) - 1, -480);
  for (let z = -580; z <= -180; z += 60) {
    mapShapes.push({ x: riverX(z + 30), z: z + 30, w: 14, d: 60, color: '#38bdf8', border: '#0ea5e9', enterable: false });
  }
  camera.far = Math.max(camera.far, 620);
  camera.updateProjectionMatrix();
}

// -----------------------------------------------------------------------------
// Sewer network
// -----------------------------------------------------------------------------
export function buildSewer() {
  const root = new THREE.Group();
  root.userData.studioName = 'Sewer network';
  worldRoot.add(root);
  const SW = 5.4, H2 = SW / 2, WH = 4.6, CY = SFY + WH;
  const wallM = new THREE.MeshStandardMaterial({ color: 0x6b706c, roughness: .95 });
  const flrM = new THREE.MeshStandardMaterial({ color: 0x585c58, roughness: .9 });
  const pipeM = new THREE.MeshStandardMaterial({ color: 0x7b5a3c, metalness: .5, roughness: .6 });
  const blueM = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
  const box = (m, x, y, z, a, b, d) => makeBox(root, a, b, d, x, y, z, m);
  const N = { A: [-130, -30], B: [-40, -30], C: [20, -30], D: [48, -30], E: [150, -30], F: [48, -16], G: [20, -66], H: [20, 24], I: [20, 110], J: [-4, 24] };
  const E = [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E'], ['D', 'F'], ['C', 'G'], ['C', 'H'], ['H', 'I'], ['H', 'J']];
  const exits = ['J', 'F', 'B', 'G'];
  for (const k of ['A', 'E', 'I']) {
    const q = N[k];
    if (!collidesHorizontally(q[0], q[1], .2, 1.8, 1.4) && !collidesHorizontally(q[0], q[1] + 1, .2, 1.8, 1.4)) {
      exits.push(k);
      manholes.push(q.slice());
    }
  }
  const dirOf = (p, q) => p[0] !== q[0] ? (q[0] > p[0] ? '+x' : '-x') : (q[1] > p[1] ? '+z' : '-z');
  const has = {};
  for (const k in N) has[k] = new Set();
  for (const [a, b] of E) { has[a].add(dirOf(N[a], N[b])); has[b].add(dirOf(N[b], N[a])); }
  const holeShape = new THREE.Shape();
  holeShape.moveTo(-H2, -H2); holeShape.lineTo(H2, -H2); holeShape.lineTo(H2, H2); holeShape.lineTo(-H2, H2); holeShape.closePath();
  const hp = new THREE.Path();
  hp.absarc(0, 0, 1.05, 0, Math.PI * 2, true);
  holeShape.holes.push(hp);
  const holeGeo = new THREE.ExtrudeGeometry(holeShape, { depth: .6, bevelEnabled: false });
  holeGeo.rotateX(Math.PI / 2);
  const holeM = new THREE.MeshStandardMaterial({ color: 0x5a5e5a, roughness: .95, side: THREE.DoubleSide });
  const lamps = [];
  for (const k in N) {
    const [x, z] = N[k], ex = exits.indexOf(k);
    sRects.push([x - H2, x + H2, z - H2, z + H2]);
    box(flrM, x, SFY - .25, z, SW, .5, SW);
    if (ex < 0) box(wallM, x, CY + .3, z, SW, .6, SW);
    else {
      const c = new THREE.Mesh(holeGeo, holeM);
      c.position.set(x, CY + .6, z);
      root.add(c);
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, -SFY + .1, 16, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x4d514d, roughness: 1, side: THREE.BackSide }));
      sh.position.set(x, (SFY + .1) / 2, z);
      root.add(sh);
      for (const sx of [-.3, .3]) box(blueM, x + sx, SFY / 2, z + .95, .05, -SFY, .05);
      for (let y = SFY + .6; y < 0; y += .6) box(blueM, x, y, z + .95, .6, .05, .05);
      lamps.push([x, CY - .1, z + 1.6]);
    }
    for (const d of ['+x', '-x', '+z', '-z']) {
      if (has[k].has(d)) continue;
      const sgn = d[0] === '+' ? 1 : -1;
      if (d[1] === 'x') box(wallM, x + sgn * (H2 + .25), SFY + WH / 2, z, .5, WH, SW + 1);
      else box(wallM, x, SFY + WH / 2, z + sgn * (H2 + .25), SW + 1, WH, .5);
    }
  }
  for (const [a, b] of E) {
    const A = N[a], B = N[b], ax = A[1] === B[1];
    const cx = (A[0] + B[0]) / 2, cz = (A[1] + B[1]) / 2;
    const L = (ax ? Math.abs(A[0] - B[0]) : Math.abs(A[1] - B[1])) - SW;
    sRects.push([Math.min(A[0], B[0]) - H2, Math.max(A[0], B[0]) + H2, Math.min(A[1], B[1]) - H2, Math.max(A[1], B[1]) + H2]);
    if (ax) {
      box(flrM, cx, SFY - .25, cz, L, .5, SW);
      box(wallM, cx, CY + .3, cz, L, .6, SW);
      box(waterMat, cx, SFY + .04, cz, L, .06, 1.5);
      for (const sd of [-1, 1]) box(wallM, cx, SFY + WH / 2, cz + sd * (H2 + .25), L, WH, .5);
    } else {
      box(flrM, cx, SFY - .25, cz, SW, .5, L);
      box(wallM, cx, CY + .3, cz, SW, .6, L);
      box(waterMat, cx, SFY + .04, cz, 1.5, .06, L);
      for (const sd of [-1, 1]) box(wallM, cx + sd * (H2 + .25), SFY + WH / 2, cz, .5, WH, L);
    }
    const pg = new THREE.Mesh(new THREE.CylinderGeometry(.28, .28, L, 10), pipeM);
    if (ax) { pg.rotation.z = Math.PI / 2; pg.position.set(cx, CY - .5, cz + H2 - .6); }
    else { pg.rotation.x = Math.PI / 2; pg.position.set(cx + H2 - .6, CY - .5, cz); }
    root.add(pg);
    for (let t = -L / 2 + 4; t < L / 2 - 2; t += 9) lamps.push(ax ? [cx + t, CY - .1, cz] : [cx, CY - .1, cz + t]);
  }
  const lampT = [];
  for (const l of lamps) xform(lampT, l[0], l[1], l[2], .6, .12, .6);
  flushInstances(root, UNIT_BOX, lampMat, lampT);
  const holeDiscG = new THREE.CircleGeometry(.72, 20).rotateX(-Math.PI / 2);
  const holeDiscM = new THREE.MeshBasicMaterial({ color: 0x050505 });
  const cvG = new THREE.CylinderGeometry(.75, .75, .06, 20);
  const cvM = new THREE.MeshStandardMaterial({ color: 0x2b2e31, metalness: .8, roughness: .5 });
  for (const m of manholes) {
    const c = new THREE.Mesh(cvG, cvM);
    c.position.set(m[0], .22, m[1]);
    worldRoot.add(c);
    manholeCovers.push(c);
    manholeOpen.push(false);
    const hd = new THREE.Mesh(holeDiscG, holeDiscM);
    hd.position.set(m[0], .2, m[1]);
    hd.visible = false;
    worldRoot.add(hd);
    manholeHoles.push(hd);
  }
}
export function knockOverLamppost(l, y, s) {
  if (l.state !== 'standing') return;
  knockOverLamppostBase(l, y, s);
  if (s > 6) crime(.08);
  hooks.mpWorldEvent({ t: 'lamp_hit', i: lampPosts.indexOf(l), yaw: y, speed: s });
}

// -----------------------------------------------------------------------------
// Aura Estates / hospital
// -----------------------------------------------------------------------------
export function buildAuraEstates() {
  const M = (c, r, e) => new THREE.MeshStandardMaterial({ color: c, roughness: r == null ? .9 : r, emissive: e || 0, emissiveIntensity: e ? 1.2 : 0 });
  const K = {
    wall: M(0xe9e6df), roof: M(0x2b2f36), floor: M(0xd8dde0, .5), glass: M(0x8fb8d6, .15),
    red: M(0xdc2626), white: M(0xf5f5f5), wood: M(0x6b4a2f), sofa: M(0x394a5e),
    lamp: M(0xfff7d6, .5, 0xfff7d6), gold: M(0xf5c542, .3, 0xb8860b), stone: M(0xb9b2a6),
    drive: M(0x3a3d42), metal: M(0x20242a, .4), blue: M(0x7ec8e3), black: M(0x111111)
  };
  const bx = (g, m, x, y, z, a, b, d) => makeBox(g, a, b, d, x, y, z, m);
  const wb = (x, y, z, a, b, d) => addWorldBox(x - a / 2, x + a / 2, y - b / 2, y + b / 2, z - d / 2, z + d / 2, 'solid', false);
  const culls = [], houses = [], gate = { open: false, boxes: [], l1: null, l2: null };
  aura.culls = culls;
  {
    const X0 = -560, X1 = -196, Z0 = -172, Z1 = 172, N = 114;
    const g = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, N, N);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, col = new Float32Array(p.count * 3), H = new Float32Array(p.count);
    const c = new THREE.Color(), c2 = new THREE.Color(), st = N + 1;
    const dx = (X1 - X0) / N, dz = (Z1 - Z0) / N;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + (X0 + X1) / 2, z = p.getZ(i) + (Z0 + Z1) / 2;
      const h = terrainBaseH(x, z);
      H[i] = h;
      p.setXYZ(i, x, h - .1, z);
    }
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), h = H[i];
      const cx = i % st, cz = (i / st) | 0;
      const il = cx > 0 ? i - 1 : i, ir = cx < N ? i + 1 : i;
      const iu = cz > 0 ? i - st : i, id = cz < N ? i + st : i;
      const sl = Math.abs(H[ir] - H[il]) / (2 * dx) + Math.abs(H[id] - H[iu]) / (2 * dz);
      const n = fbm(x * .06, z * .06, 3);
      c.set(0x5b7d3c).lerp(c2.set(0x8a8f52), n);
      c.lerp(c2.set(0xa59a76), sstep(40, 85, h));
      c.lerp(c2.set(0x4f8a3f), 1 - sstep(66, 100, Math.hypot(x - AHC.px, z - AHC.pz)));
      c.lerp(c2.set(0x76705f), sstep(.35, .75, sl));
      c.multiplyScalar(.9 + .2 * n);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const tm = new THREE.Mesh(g, makeTerrainBlendMaterial({ roughness: 1 }));
    paintMeshTerrainSplat(tm, 'hills');
    tm.receiveShadow = true;
    tm.userData.studioName = 'Aura Hills terrain';
    registerSculptableTerrain(tm);
    worldRoot.add(tm);
    const pts = [];
    for (let s = 0; s <= 274; s += 3) { const x = -196 - s; pts.push([x, ahRz(x)]); }
    const ribbon = (w, dy, color) => {
      const pos = [], idx = [];
      pts.forEach((q, k) => {
        const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
        const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz);
        const nx = -tz / l, nz = tx / l, y = ahRy(q[0]) + dy;
        pos.push(q[0] + nx * w, y, q[1] + nz * w, q[0] - nx * w, y, q[1] - nz * w);
        if (k) { const i = (k - 1) * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
      });
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      rg.setIndex(idx);
      rg.computeVertexNormals();
      const m = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color, roughness: .9, side: THREE.DoubleSide }));
      m.receiveShadow = true;
      worldRoot.add(m);
    };
    ribbon(4.8, .12, 0x2a2d31);
    ribbon(.12, .16, 0xe8c547);
  }
  {
    const WG = new THREE.Group();
    WG.userData.studioName = 'Aura Estates';
    worldRoot.add(WG);
    const seg = (cx, cz, a, d) => { bx(WG, K.stone, cx, 39.7, cz, a, 3.4, d); wb(cx, 39.7, cz, a, 3.4, d); };
    seg(-480, -85, 96, .8); seg(-480, -5, 96, .8); seg(-528, -45, .8, 80);
    seg(-432, -67, .8, 36); seg(-432, -23, .8, 36);
    gate.l1 = bx(WG, K.metal, -431.4, 39.5, -47, .3, 3, 4);
    gate.l2 = bx(WG, K.metal, -431.4, 39.5, -43, .3, 3, 4);
    gate.boxes.push(wb(-431.4, 39.5, -47, .6, 3, 4), wb(-431.4, 39.5, -43, .6, 3, 4));
    bx(WG, K.stone, -432, 41.9, -45, .9, 1.4, 10);
    const sg = new THREE.Group();
    sg.position.set(-431.4, 41.9, -45);
    sg.rotation.y = Math.PI / 2;
    createNeonSign(sg, 'AURA ESTATES', 0, 0, 0, '#111827', '#fcd34d', 7, 1.1);
    worldRoot.add(sg);
    const HW = 15, HD = 11, HT = 4.2, Y = 38.18;
    [[-508, -68, 1], [-508, -22, -1], [-470, -70, 1], [-470, -20, -1], [-448, -70, 1], [-448, -20, -1]].forEach(([cx, cz, dir], k) => {
      const g = new THREE.Group();
      g.position.set(cx, Y, cz);
      worldRoot.add(g);
      const inn = new THREE.Group();
      g.add(inn);
      const fz = dir * HD / 2, bz = -dir * HD / 2, sw = (HW - 2.6) / 2;
      const wm = k % 2 ? K.wall : K.stone;
      bx(g, wm, 0, HT / 2, bz, HW, HT, .4); wb(cx, Y + HT / 2, cz + bz, HW, HT, .4);
      for (const sd of [-1, 1]) {
        bx(g, wm, sd * HW / 2, HT / 2, 0, .4, HT, HD); wb(cx + sd * HW / 2, Y + HT / 2, cz, .4, HT, HD);
        bx(g, wm, sd * (1.3 + sw / 2), HT / 2, fz, sw, HT, .4); wb(cx + sd * (1.3 + sw / 2), Y + HT / 2, cz + fz, sw, HT, .4);
        bx(g, K.glass, sd * (1.3 + sw / 2), 2.3, fz + dir * .22, sw * .6, 1.6, .05);
      }
      bx(g, wm, 0, HT - .5, fz, 2.6, 1, .4);
      bx(g, K.roof, 0, HT + .2, 0, HW + 1.4, .4, HD + 1.4);
      bx(g, K.drive, 0, .05, fz + dir * 5.5, 4, .1, 11);
      bx(inn, K.wood, 0, .02, 0, HW - .6, .05, HD - .6);
      bx(inn, K.sofa, -3, .45, -dir * 2.5, 4, .9, 1.2);
      bx(inn, K.wood, -3, .3, -dir * .6, 2, .6, 1);
      bx(inn, K.black, 4, 1.4, -dir * (HD / 2 - .4), 3, 1.6, .1);
      bx(inn, K.lamp, 0, HT - .2, 0, 2, .1, 2);
      bx(inn, K.wood, -5, .5, dir * 3, 1.2, 1, 2.4);
      const safe = bx(inn, K.gold, 5.5, .5, dir * (HD / 2 - 1.2), .9, .9, .7);
      houses.push({ safe, sx: cx + 5.5, sz: cz + dir * (HD / 2 - 1.2), taken: false });
      culls.push({ g: inn, x: cx, z: cz, r: 65 });
    });
  }
  {
    const W = 36, D = 26, HH = 7, T = .5, HY = 0.18;
    let hx = 0, hz = 0, found = false;
    for (let x = -170; x <= 110 && !found; x += 10) {
      for (let z = -140; z <= 160; z += 10) {
        if (footprintClear(x, z, W, D, 4)) { hx = x; hz = z; found = true; break; }
      }
    }
    if (found) {
      const g = new THREE.Group();
      g.position.set(hx, HY, hz);
      g.userData.studioName = 'AURA GENERAL HOSPITAL';
      worldRoot.add(g);
      const inn = new THREE.Group();
      g.add(inn);
      bx(g, K.white, 0, HH / 2, -D / 2, W, HH, T); wb(hx, HY + HH / 2, hz - D / 2, W, HH, T);
      for (const sd of [-1, 1]) {
        bx(g, K.white, sd * W / 2, HH / 2, 0, T, HH, D); wb(hx + sd * W / 2, HY + HH / 2, hz, T, HH, D);
        const sw = (W - 6) / 2;
        bx(g, K.white, sd * (3 + sw / 2), HH / 2, D / 2, sw, HH, T); wb(hx + sd * (3 + sw / 2), HY + HH / 2, hz + D / 2, sw, HH, T);
      }
      bx(g, K.white, 0, HH - 1, D / 2, 6, 2, T);
      bx(g, K.roof, 0, HH + .25, 0, W + 1, .5, D + 1);
      bx(g, K.white, 0, 4.6, D / 2 + 2.5, 10, .3, 5);
      bx(g, K.red, -11, 4.5, D / 2 + .3, 1, 4, .15);
      bx(g, K.red, -11, 4.5, D / 2 + .3, 4, 1, .15);
      bx(g, K.red, 11, 4.5, D / 2 + .3, 1, 4, .15);
      bx(g, K.red, 11, 4.5, D / 2 + .3, 4, 1, .15);
      createNeonSign(g, 'AURA GENERAL HOSPITAL', 0, 6.3, D / 2 + .3, '#ffffff', '#dc2626', 12, 1.4);
      bx(inn, K.floor, 0, .02, 0, W - 1, .05, D - 1);
      for (let x = -15; x <= 15; x += 6) for (const z of [-6, 6]) bx(inn, K.lamp, x, HH - .3, z, 2.4, .1, .8);
      bx(inn, K.wood, 0, .55, 6, 8, 1.1, 1.2);
      bx(inn, K.white, 0, 1.12, 6, 8.2, .08, 1.4);
      for (let x = -14; x <= -8; x += 2) bx(inn, K.sofa, x, .4, 10, 1.2, .8, 1);
      const bed = (x, z) => {
        bx(inn, K.white, x, .45, z, 1.1, .5, 2.3);
        bx(inn, K.blue, x, .75, z + .3, 1.1, .12, 1.6);
        bx(inn, K.white, x, .8, z - .9, .7, .14, .5);
      };
      for (const x of [-14, -8, -2, 8, 13]) bed(x, -D / 2 + 3);
      for (const x of [-11, -5, 10.5]) bx(inn, K.blue, x, 1.3, -D / 2 + 3.2, .05, 2.2, 2.6);
      for (const x of [-16, -10, -4, 6, 11]) bx(inn, K.metal, x, 1, -D / 2 + 4.2, .06, 2, .06);
      aura.hospitalSpawn = { x: hx - 14, z: hz - D / 2 + 5.6 };
      culls.push({ g: inn, x: hx, z: hz, r: 80 });
      enterableZones.push({ minX: hx - W / 2 + 1, maxX: hx + W / 2 - 1, minZ: hz - D / 2 + 1, maxZ: hz + D / 2 - 1, name: 'AURA GENERAL HOSPITAL' });
    }
  }
  aura.ahCull = function (dt) {
    for (let i = 0; i < manholeCovers.length; i++) {
      const c = manholeCovers[i], tx = manholes[i][0] + (manholeOpen[i] ? 1.5 : 0);
      c.position.x += (tx - c.position.x) * Math.min(1, dt * 6);
      manholeHoles[i].visible = manholeOpen[i];
    }
    for (const c of culls) c.g.visible = dist2(player.x, player.z, c.x, c.z) < c.r * c.r;
    const go = gate.open ? 4 : 0;
    gate.l1.position.z += ((-47 - go) - gate.l1.position.z) * Math.min(1, dt * 3);
    gate.l2.position.z += ((-43 + go) - gate.l2.position.z) * Math.min(1, dt * 3);
    if (!under() && player.x < -196) {
      gameState.zoneName = player.x < -430 ? 'AURA ESTATES'
        : player.x > -350 && player.x < -220 && Math.abs(player.z) < 105 ? 'WESTSIDE DISTRICT' : 'AURA HILLS';
    }
  };
  aura.ahHint = function () {
    if (!gate.open && dist2(player.x, player.z, -432, -45) < 36) return '[F] FORCE OPEN GATE';
    for (const h of houses) if (!h.taken && dist2(player.x, player.z, h.sx, h.sz) < 5.76) return '[F] CRACK SAFE';
    return '';
  };
  const applyGate = (open) => {
    if (!open || gate.open) return;
    gate.open = true;
    for (const b of gate.boxes) { const k = worldBoxes.indexOf(b); if (k >= 0) worldBoxes.splice(k, 1); }
  };
  const applySafe = (i) => {
    const h = houses[i];
    if (!h || h.taken) return;
    h.taken = true;
    h.safe.visible = false;
    spawnParticles(h.sx, 39.5, h.sz, 0xf5c542, 14, 5);
  };
  aura.estates = { gate, houses, applyGate, applySafe };
  aura.ahF = function () {
    if (!gate.open && dist2(player.x, player.z, -432, -45) < 36) {
      applyGate(true);
      sfx.mantle();
      if (!hooks.mpIsGuest()) crime(.35);
      pushFeed('GATE FORCED OPEN — SECURITY ALERTED', 'border-l-rose-500');
      hooks.mpWorldEvent({ t: 'gate' });
      return;
    }
    for (let i = 0; i < houses.length; i++) {
      const h = houses[i];
      if (!h.taken && dist2(player.x, player.z, h.sx, h.sz) < 5.76) {
        if (hooks.mpIsGuest()) hooks.mpWorldEvent({ t: 'safe_req', i });
        else {
          applySafe(i);
          gameState.cash += 600;
          sfx.pickup();
          crime(.5);
          pushFeed('SAFE CRACKED +$600', 'border-l-amber-400');
          hooks.updateHUD(true);
          hooks.mpWorldEvent({ t: 'safe', i });
        }
        return;
      }
    }
  };
}

// -----------------------------------------------------------------------------
// Aura Hills trees & Westside district
// -----------------------------------------------------------------------------
export function buildAuraSkylineAndHighway() {
  const rr = (n) => { const v = Math.sin(n * 127.1) * 43758.5453; return v - Math.floor(v); };
  const sm = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: .85 });
  {
    const n = 500;
    const mesh = new THREE.InstancedMesh(new THREE.ConeGeometry(2, 7, 7), treeLeafMaterial, n);
    const d = new THREE.Object3D();
    let c = 0;
    for (let k = 1; k < 5000 && c < n; k++) {
      const x = -216 - rr(k * 2.1) * 338, z = -165 + rr(k * 3.7) * 330;
      const h = hillsH(x, z);
      const sl = Math.abs(hillsH(x + 3, z) - hillsH(x - 3, z)) / 6;
      const dr = Math.abs(z - ahRz(x)) / Math.hypot(1, ahRzD(x));
      if ((x > -360 && x < -205 && Math.abs(z) < 125) || sl > .7 || h < 3
        || (-196 - x < 300 && dr < 12) || dist2(x, z, AHC.px, AHC.pz) < 5184) continue;
      d.position.set(x, h + 3.2, z);
      d.scale.setScalar(.8 + rr(k) * .9);
      d.updateMatrix();
      mesh.setMatrixAt(c++, d.matrix);
    }
    mesh.count = c;
    mesh.castShadow = true;
    worldRoot.add(mesh);
  }
  {
    const streetM = sm(0x303840), stripeM = new THREE.MeshBasicMaterial({ color: 0xf5c84c });
    const dashGeo = new THREE.BoxGeometry(.16, .025, 2.4);
    for (const x of [-330, -310, -290, -270, -250, -230]) {
      const floor = ahRy(x) + 9, roadZ = ahRz(x);
      for (const [z0, z1] of [[-94, roadZ - 28], [roadZ + 28, 94]]) {
        if (z1 - z0 < 8) continue;
        makeBox(worldRoot, 6, .12, z1 - z0, x, floor + .04, (z0 + z1) / 2, streetM, {
          recv: true, box: [x - 3, x + 3, floor - .02, floor + .1, z0, z1, 'westcity_road', true]
        });
        const dashT = [];
        for (let z = z0 + 3; z < z1 - 1; z += 8) xform(dashT, x, floor + .112, z);
        flushInstances(worldRoot, dashGeo, stripeM, dashT);
      }
    }
    const facade = document.createElement('canvas');
    facade.width = 64; facade.height = 128;
    const fc = facade.getContext('2d');
    fc.fillStyle = '#182a3a';
    fc.fillRect(0, 0, 64, 128);
    for (let row = 0; row < 16; row++) for (let col = 0; col < 8; col++) {
      fc.fillStyle = rr(row * 13 + col * 7) < .38 ? '#ffe9a8' : '#36566e';
      fc.fillRect(col * 8 + 1, row * 8 + 1, 6, 6);
    }
    const windows = new THREE.CanvasTexture(facade);
    windows.colorSpace = THREE.SRGBColorSpace;
    windows.wrapS = windows.wrapT = THREE.RepeatWrapping;
    windows.repeat.set(2, 7);
    const towerM = [0x9ab5c5, 0xb7c4cc, 0x829eaf].map((color) => new THREE.MeshStandardMaterial({
      color, map: windows, emissiveMap: windows, emissive: 0xffffff, emissiveIntensity: .18, roughness: .3, metalness: .35
    }));
    const lowM = [0x5b6670, 0x8c8172, 0x65746f].map((color) => sm(color));
    const roofM = sm(0x29323a);
    const addBuilding = (x, z, w, d, h, mat) => {
      const ground = hillsH(x, z);
      makeBox(worldRoot, w, h, d, x, ground + h / 2, z, mat, {
        cast: true, recv: true,
        box: [x - w / 2, x + w / 2, ground, ground + h, z - d / 2, z + d / 2, 'westcity_building', false]
      });
      makeBox(worldRoot, w + .5, .48, d + .5, x, ground + h + .24, z, roofM);
    };
    for (let i = 0; i < 5; i++) for (const side of [-1, 1]) {
      const x = -320 + i * 20, z = ahRz(x) + side * 43;
      addBuilding(x, z, 13 + (i % 3), 15 + (i % 2) * 2, 28 + (i * 11 + side * 7 + 70) % 31, towerM[(i + (side > 0 ? 1 : 0)) % towerM.length]);
    }
    for (let i = 0; i < 4; i++) for (const side of [-1, 1]) {
      const x = -320 + i * 20, z = ahRz(x) + side * 66;
      addBuilding(x, z, 9 + (i % 2), 10 + (i % 3), 13 + (i * 7 + side * 3 + 30) % 15, lowM[(i + (side > 0 ? 1 : 0)) % lowM.length]);
    }
  }
}

// =============================================================================
// DATA-DRIVEN WORLD ENTITIES + STUDIO REGISTRY
// =============================================================================
export const entityObjects = new Map();
export const studioObjects = new Map();
const studioObjectBaseTransforms = new Map();
const studioDeletedObjects = new Map();
function applyObjectTransform(object, transform) {
  if (!transform || transform.deleted) return;
  object.position.fromArray(transform.position);
  object.rotation.fromArray(transform.rotation);
  object.scale.fromArray(transform.scale);
}
function registerStudioObjectTree(root, rootPath, data = levelData) {
  const visit = (object, path) => {
    object.userData.studioPath = path;
    object.userData.studioNamed = Boolean(object.userData.studioName || object.name);
    if (!object.userData.studioName) object.userData.studioName = object.name || `${object.isMesh ? 'Mesh' : object.type} ${path.split('/').pop()}`;
    studioObjects.set(path, object);
    if (!studioObjectBaseTransforms.has(path)) {
      studioObjectBaseTransforms.set(path, { position: object.position.toArray(), rotation: object.rotation.toArray(), scale: object.scale.toArray() });
    }
    const saved = data.worldTransforms && data.worldTransforms[path];
    if (saved && !saved.deleted) applyObjectTransform(object, saved);
    object.children.forEach((child, index) => visit(child, `${path}/${index}`));
  };
  visit(root, rootPath);
}
export function applyStudioWorldTransforms(data = levelData) {
  for (const [path, entry] of [...studioDeletedObjects.entries()]) {
    const saved = data.worldTransforms && data.worldTransforms[path];
    if (!saved || !saved.deleted) {
      if (entry.parent && entry.object) entry.parent.add(entry.object);
      studioDeletedObjects.delete(path);
      if (entry.object) registerStudioObjectTree(entry.object, path, data);
    }
  }
  for (const [path, object] of [...studioObjects.entries()]) {
    const saved = data.worldTransforms && data.worldTransforms[path];
    if (saved && saved.deleted) { removeEntityObject(path); continue; }
    const base = studioObjectBaseTransforms.get(path);
    if (base) applyObjectTransform(object, base);
    if (saved) applyObjectTransform(object, saved);
  }
}
/** Stable, name-based Studio keys at the landmark root level. */
function registerGeneratedWorldObjects(data = levelData) {
  studioObjects.clear();
  studioDeletedObjects.clear();
  const usedKeys = new Map();
  const slug = (s) => String(s || 'object').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^ | $/g, '').slice(0, 48) || 'object';
  for (const root of worldRoot.children) {
    if (foreignRoots && foreignRoots.has(root)) continue;
    root.userData.worldBuilt = true;
    if (root.userData.studioSelectable === false || root.userData.persistentFX) continue;
    const entityId = root.userData.entityId;
    let key;
    if (entityId) key = `entity:${entityId}`;
    else {
      const base = `static:${slug(root.userData.studioName || root.name || root.type)}`;
      const n = usedKeys.get(base) || 0;
      usedKeys.set(base, n + 1);
      key = n === 0 ? base : `${base}#${n}`;
    }
    registerStudioObjectTree(root, key, data);
  }
  if (data.worldTransforms) {
    for (const [path, saved] of Object.entries(data.worldTransforms)) {
      if (saved && saved.deleted) removeEntityObject(path);
    }
  }
}
const ENTITY_Y_OFFSET = { pickup: 0.55 };
function tagEntity(root, id) {
  root.userData.entityId = id;
  root.traverse((child) => { child.userData.entityId = id; });
}
function applyEntityLook(object, entity) {
  if (entity.color && !['vehicle', 'block', 'prop', 'ramp', 'building', 'road'].includes(entity.type)) applyEntityColor(object, entity.color);
  if (entity.texture) applyEntityTexture(object, entity.texture, (entity.texRepeat || [1, 1])[0], (entity.texRepeat || [1, 1])[1]);
}
function makeRampMesh(color) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0); shape.lineTo(0.5, 0); shape.lineTo(0.5, 1); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  g.rotateY(-Math.PI / 2);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, makeMat(colorToHex(color, 0xf59e0b), { roughness: 0.7 }));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function makePrimitiveMesh(shape, color, fallback) {
  let geo;
  if (shape === 'cylinder') geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
  else if (shape === 'sphere') geo = new THREE.SphereGeometry(0.5, 20, 14);
  else if (shape === 'cone') geo = new THREE.ConeGeometry(0.5, 1, 20);
  else geo = UNIT_BOX;
  const m = new THREE.Mesh(geo, makeMat(colorToHex(color, fallback), { roughness: 0.8 }));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function makeBuildingMesh(entity) {
  const building = entity.building || {};
  const width = THREE.MathUtils.clamp(Number(building.width) || 12, 2, 200);
  const depth = THREE.MathUtils.clamp(Number(building.depth) || 10, 2, 200);
  const height = THREE.MathUtils.clamp(Number(building.height) || 12, 2, 300);
  const wallMat = makeMat(colorToHex(entity.color, 0x64748b), { texType: 'concrete', roughness: 0.82 });
  const trimMat = makeMat(colorToHex(building.roofColor, 0x1e293b), { metalness: 0.35, roughness: 0.55 });
  const windowColor = colorToHex(building.windowColor, 0x7dd3fc);
  const glassMat = new THREE.MeshStandardMaterial({ color: windowColor, emissive: windowColor, emissiveIntensity: 0.12, metalness: 0.2, roughness: 0.25 });
  const root = new THREE.Group();
  const body = makeBox(root, width, height, depth, 0, height / 2, 0, wallMat, { cast: true, recv: true, name: 'Building body' });
  makeBox(root, width + 0.5, 0.35, depth + 0.5, 0, height + 0.17, 0, trimMat, { cast: true, name: 'Roof' });
  const floors = Math.min(20, Math.max(1, Math.floor(height / 3.2)));
  const columns = Math.min(8, Math.max(1, Math.floor(width / 2.8)));
  const windowW = Math.min(1.35, width / (columns * 2.2));
  const windowH = Math.min(1.45, Math.max(0.55, height / (floors * 2.1)));
  const transforms = [];
  for (let floor = 0; floor < floors; floor++) {
    const y = (floor + 0.55) * height / floors;
    for (let column = 0; column < columns; column++) {
      const x = (column + 0.5) * width / columns - width / 2;
      for (const side of [-1, 1]) xform(transforms, x, y, side * (depth / 2 + 0.035), windowW, windowH, 0.06);
    }
  }
  const windows = flushInstances(root, UNIT_BOX, glassMat, transforms);
  if (windows) windows.userData.studioName = 'Windows';
  return root;
}
function makeRoadMesh(entity) {
  const road = entity.road || {};
  const width = THREE.MathUtils.clamp(Number(road.width) || 24, 2, 500);
  const depth = THREE.MathUtils.clamp(Number(road.depth) || 12, 2, 500);
  const root = new THREE.Group();
  makeBox(root, width, 0.12, depth, 0, 0.06, 0,
    makeMat(colorToHex(entity.color, 0x313946), { texType: 'asphalt', roughness: 0.88 }), { recv: true });
  if (road.markings !== false) {
    makeBox(root, 0.22, 0.025, depth * 0.78, 0, 0.13, 0, new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
  }
  return root;
}
function registerRoadRamp(object, entity) {
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  const rot = entity.rot || [0, 0, 0];
  const scale = entity.scale || [1, 1, 1];
  if (Math.hypot(rot[0] || 0, rot[2] || 0) === 0) {
    return addWorldBox(bounds.min.x, bounds.max.x, bounds.min.y, bounds.max.y, bounds.min.z, bounds.max.z, 'entity_road', true);
  }
  const cfg = entity.road || {};
  const halfW = ((Number(cfg.width) || 24) * scale[0]) * 0.5;
  const halfL = ((Number(cfg.depth) || 12) * scale[2]) * 0.5;
  const pNegX = new THREE.Vector3(-halfW, 0, 0).applyMatrix4(object.matrixWorld);
  const pPosX = new THREE.Vector3(halfW, 0, 0).applyMatrix4(object.matrixWorld);
  const pNegZ = new THREE.Vector3(0, 0, -halfL).applyMatrix4(object.matrixWorld);
  const pPosZ = new THREE.Vector3(0, 0, halfL).applyMatrix4(object.matrixWorld);
  const useX = Math.abs(pPosX.y - pNegX.y) >= Math.abs(pPosZ.y - pNegZ.y);
  const pMin = useX ? (pNegX.x < pPosX.x ? pNegX : pPosX) : (pNegZ.z < pPosZ.z ? pNegZ : pPosZ);
  const pMax = useX ? (pNegX.x < pPosX.x ? pPosX : pNegX) : (pNegZ.z < pPosZ.z ? pPosZ : pNegZ);
  return addDriveableRamp({
    minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z,
    startY: pMin.y + 0.08, endY: pMax.y + 0.08, axis: useX ? 'x' : 'z', dir: pMax.y >= pMin.y ? 1 : -1
  });
}
function registerEntityRamp(object, entity) {
  object.updateMatrixWorld(true);
  const rot = entity.rot || [0, 0, 0];
  const scale = entity.scale || [1, 1, 1];
  const y = entity.pos[1];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const sx of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
    const p = new THREE.Vector3(sx, 0, sz).applyMatrix4(object.matrixWorld);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const fx = Math.sin(rot[1]), fz = Math.cos(rot[1]);
  const axis = Math.abs(fx) > Math.abs(fz) ? 'x' : 'z';
  const dir = (axis === 'x' ? fx : fz) >= 0 ? 1 : -1;
  const base = y, top = y + scale[1];
  return addDriveableRamp({ minX, maxX, minZ, maxZ, startY: dir > 0 ? base : top, endY: dir > 0 ? top : base, axis, dir });
}
export function createEntityObject(entity, { register = true } = {}) {
  if (RETIRED_ENTITY_IDS.has(entity.id)) return { object: null, record: null };
  const [x, y, z] = entity.pos;
  const rot = entity.rot || [0, 0, 0];
  const scale = entity.scale || [1, 1, 1];
  let object = null, record = null;
  switch (entity.type) {
    case 'vehicle': {
      const v = entity.vehicle || {};
      const cfg = {
        name: entity.name,
        bodyHex: colorToHex(entity.color || v.bodyHex, 0xdc2626),
        accentHex: colorToHex(v.accentHex, 0xf8fafc),
        x, z, yaw: rot[1], isCoupe: v.isCoupe !== false, isSupercar: !!v.isSupercar
      };
      if (register) { record = buildSportsCar(cfg); object = record.root; }
      else { object = buildSportsCarMesh(cfg).root; worldRoot.add(object); object.rotation.set(rot[0], rot[1], rot[2]); }
      object.position.y = y;
      if (scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1) object.scale.set(scale[0], scale[1], scale[2]);
      if (record) { record.y = y; record.carScale = object.scale.x; }
      if (!entity.color) applyModelPreset(v.isSupercar ? 'apex_gt' : 'coupe', object);
      break;
    }
    case 'pickup': {
      const p = entity.pickup || { kind: 'left', itemId: 'cash' };
      if (register) { record = spawnWorldPickup(p.kind, p.itemId, x, y, z, { rot, scale }); object = record.group; }
      else {
        object = buildPickupMesh(p.kind, p.itemId);
        object.position.set(x, y + 0.55, z);
        object.rotation.set(rot[0], rot[1], rot[2]);
        object.scale.set(scale[0], scale[1], scale[2]);
        worldRoot.add(object);
      }
      if (p.kind === 'right') applyModelPreset(p.itemId, object);
      break;
    }
    case 'crate': {
      if (register) { record = spawnSmashCrate(x, y, z, entity.loot || null, { rot, scale }); object = record.mesh; }
      else {
        object = buildCrateMesh();
        object.position.set(x, y, z);
        object.rotation.set(rot[0], rot[1], rot[2]);
        object.scale.set(scale[0], scale[1], scale[2]);
        worldRoot.add(object);
      }
      break;
    }
    case 'barrel': {
      if (register) { record = spawnHazardBarrel(x, y, z, { rot, scale }); object = record.mesh; }
      else {
        object = buildBarrelMesh();
        object.position.set(x, y, z);
        object.rotation.set(rot[0], rot[1], rot[2]);
        object.scale.set(scale[0], scale[1], scale[2]);
        worldRoot.add(object);
      }
      break;
    }
    case 'building': {
      object = makeBuildingMesh(entity);
      object.position.set(x, y, z);
      object.rotation.set(rot[0], rot[1], rot[2]);
      object.scale.set(scale[0], scale[1], scale[2]);
      worldRoot.add(object);
      if (register) {
        object.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(object);
        record = addWorldBox(b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z, 'entity_building', true);
      }
      break;
    }
    case 'road': {
      object = makeRoadMesh(entity);
      object.position.set(x, y, z);
      object.rotation.set(rot[0], rot[1], rot[2]);
      object.scale.set(scale[0], scale[1], scale[2]);
      worldRoot.add(object);
      if (register) record = registerRoadRamp(object, entity);
      break;
    }
    case 'ramp': {
      object = makeRampMesh(entity.color);
      object.position.set(x, y, z);
      object.rotation.set(rot[0], rot[1], rot[2]);
      object.scale.set(scale[0], scale[1], scale[2]);
      worldRoot.add(object);
      if (register) record = registerEntityRamp(object, entity);
      break;
    }
    case 'block':
    case 'prop': {
      const shape = entity.type === 'block' ? 'box' : ((entity.prop && entity.prop.shape) || 'box');
      object = makePrimitiveMesh(shape, entity.color, entity.type === 'block' ? 0x94a3b8 : 0x38bdf8);
      object.position.set(x, y, z);
      object.rotation.set(rot[0], rot[1], rot[2]);
      object.scale.set(scale[0], scale[1], scale[2]);
      worldRoot.add(object);
      const solid = entity.type === 'block' || !entity.prop || entity.prop.solid !== false;
      if (register && solid) {
        object.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(object);
        record = addWorldBox(bb.min.x, bb.max.x, bb.min.y, bb.max.y, bb.min.z, bb.max.z, 'entity_' + entity.type, true);
      }
      break;
    }
    default:
      console.warn('[world] unknown entity type', entity.type);
      return { object: null, record: null };
  }
  applyEntityLook(object, entity);
  object.userData.studioName = object.userData.studioName || entity.name;
  tagEntity(object, entity.id);
  registerStudioObjectTree(object, `entity:${entity.id}`);
  entityObjects.set(entity.id, { entity, object, record });
  return { object, record };
}
export function spawnLevelEntities(data = levelData, opts = {}) {
  for (const e of data.entities) createEntityObject(e, opts);
}
export function removeEntityObject(id) {
  const rec = entityObjects.get(id);
  const sRec = studioObjects.get(id);
  if (!rec && !sRec) return;
  const targetObj = (rec && rec.object) || (sRec && (sRec.object || sRec));
  if (targetObj) {
    targetObj.updateMatrixWorld(true);
    targetObj.traverse((child) => {
      const sIdx = sculptableTerrainMeshes.indexOf(child);
      if (sIdx !== -1) sculptableTerrainMeshes.splice(sIdx, 1);
    });
  }
  if (rec) {
    if (rec.record) {
      for (const arr of [worldBoxes, driveableRamps, worldPickups, smashableCrates, hazardBarrels]) {
        const i = arr.indexOf(rec.record);
        if (i !== -1) arr.splice(i, 1);
      }
    }
    if (rec.entity && rec.entity.type === 'vehicle') {
      const vi = vehicles.findIndex((v) => v.root === rec.object);
      if (vi !== -1) vehicles.splice(vi, 1);
    }
    if (targetObj) {
      const objBox = new THREE.Box3().setFromObject(targetObj);
      if (!objBox.isEmpty()) {
        const eps = 0.6;
        for (let i = worldBoxes.length - 1; i >= 0; i--) {
          const b = worldBoxes[i];
          if (!b.tag || !b.tag.startsWith('entity_')) continue;
          if (b.minX >= objBox.min.x - eps && b.maxX <= objBox.max.x + eps
            && b.minZ >= objBox.min.z - eps && b.maxZ <= objBox.max.z + eps
            && b.minY >= objBox.min.y - eps && b.maxY <= objBox.max.y + eps) worldBoxes.splice(i, 1);
        }
      }
    }
    if (rec.object && rec.object.parent) rec.object.parent.remove(rec.object);
    for (const path of [...studioObjects.keys()]) {
      if (path === `entity:${id}` || path.startsWith(`entity:${id}/`)) {
        studioObjects.delete(path);
        studioObjectBaseTransforms.delete(path);
      }
    }
    entityObjects.delete(id);
  }
  if (sRec) {
    const sObj = sRec.object || sRec;
    if (sObj && sObj.parent) {
      studioDeletedObjects.set(id, { object: sObj, parent: sObj.parent });
      sObj.parent.remove(sObj);
    }
    for (const path of [...studioObjects.keys()]) {
      if (path === id || path.startsWith(`${id}/`)) studioObjects.delete(path);
    }
  }
}
export function updateEntityTransform(entity) {
  const rec = entityObjects.get(entity.id);
  if (!rec || !rec.object) return;
  const o = rec.object;
  o.position.set(entity.pos[0], entity.pos[1] + (ENTITY_Y_OFFSET[entity.type] || 0), entity.pos[2]);
  o.rotation.set(entity.rot[0], entity.rot[1], entity.rot[2]);
  o.scale.set(entity.scale[0], entity.scale[1], entity.scale[2]);
  o.updateMatrixWorld(true);
  if (entity.type === 'vehicle') {
    rec.entity = entity;
    if ('carScale' in (rec.record || {})) rec.record.carScale = o.scale.x;
    const v = vehicles.find((c) => c.root === o);
    if (v) { v.x = entity.pos[0]; v.y = entity.pos[1]; v.z = entity.pos[2]; v.yaw = entity.rot[1]; v.carScale = o.scale.x; }
    return;
  }
  if (entity.type === 'road' || entity.type === 'ramp') {
    if (rec.record) {
      for (const arr of [driveableRamps, worldBoxes]) {
        const i = arr.indexOf(rec.record);
        if (i !== -1) arr.splice(i, 1);
      }
    }
    rec.record = entity.type === 'road' ? registerRoadRamp(o, entity) : registerEntityRamp(o, entity);
    rec.entity = entity;
    return;
  }
  if (rec.record && 'minX' in rec.record && 'maxY' in rec.record) {
    const bb = new THREE.Box3().setFromObject(o);
    rec.record.minX = bb.min.x; rec.record.maxX = bb.max.x;
    rec.record.minY = bb.min.y; rec.record.maxY = bb.max.y;
    rec.record.minZ = bb.min.z; rec.record.maxZ = bb.max.z;
  }
  rec.entity = entity;
}
export function revealAllLods() {
  buildingLods.forEach((e) => { e.group.visible = true; e.active = true; });
  (aura.culls || []).forEach((c) => { c.g.visible = true; });
  barrierChunks.forEach((c) => { c.group.visible = true; c.opacity = 1; c.mats.forEach((m) => { m.opacity = 1; }); });
}

// =============================================================================
// LOS AURA INTERNATIONAL — rebuilt as a real airport
//
// A 44 × 206 m barrel-vaulted terminal: glazed landside curb with a cantilevered
// drop-off canopy, four check-in islands, a hanging departures board, a public
// mezzanine restaurant reached by a real staircase, a three-lane security
// checkpoint, an airside concourse with duty-free / coffee / food court, two
// gate hold-rooms with podiums and seat rows, and two articulated passenger
// boarding bridges docking onto the parked aircraft. Apron stands are marked,
// lit and serviced by tugs, bag carts, GPUs and cones.
// =============================================================================
const airport = { board: null, boardTex: null, boardRows: null, carousel: null, tick: 0 };
const FLIGHT_DESTS = ['SUNNYVALE', 'AURA HILLS', 'REDROCK', 'FROSTPINE', 'VERDANT', 'SANTA AURA', 'WESTSIDE', 'HARBOR CITY'];
const FLIGHT_STATUS = ['ON TIME', 'BOARDING', 'DELAYED', 'GATE OPEN', 'FINAL CALL'];
function drawDeparturesBoard() {
  if (!airport.board) return;
  const c = airport.board, ctx = c.getContext('2d');
  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 30px Oswald, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('DEPARTURES', 18, 38);
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 17px Oswald, sans-serif';
  ctx.fillText('FLIGHT', 18, 68);
  ctx.fillText('DESTINATION', 120, 68);
  ctx.fillText('TIME', 330, 68);
  ctx.fillText('STATUS', 410, 68);
  ctx.strokeStyle = '#1e3a5f';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(14, 78); ctx.lineTo(c.width - 14, 78); ctx.stroke();
  ctx.font = '18px Oswald, sans-serif';
  airport.boardRows.forEach((r, i) => {
    const y = 106 + i * 30;
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(r.code, 18, y);
    ctx.fillText(r.dest, 120, y);
    ctx.fillText(r.time, 330, y);
    ctx.fillStyle = r.status === 'DELAYED' ? '#f87171' : (r.status === 'BOARDING' || r.status === 'FINAL CALL' ? '#4ade80' : '#facc15');
    ctx.fillText(r.status, 410, y);
  });
  if (airport.boardTex) airport.boardTex.needsUpdate = true;
}
/** Parametric barrel-vault surface (one geometry, reused for shell + skylight). */
function archShellGeometry(cx, cz, halfSpan, length, baseY, rise, segX = 28, t0 = 0, t1 = 1) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= 1; j++) {
    const z = cz - length / 2 + j * length;
    for (let i = 0; i <= segX; i++) {
      const t = t0 + (t1 - t0) * (i / segX);
      pos.push(cx - halfSpan + t * 2 * halfSpan, baseY + rise * Math.sin(Math.PI * t), z);
      uv.push(t * 8, j * length / 12);
    }
  }
  for (let i = 0; i < segX; i++) {
    const a = i, b = i + 1, c = i + segX + 1, d = i + segX + 2;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function buildAirportTerminal(grp, mats) {
  const { whiteMat, steelMat } = mats;
  const TX = 248, TZ = 565, HW = 22, HL = 103;      // 44 × 206 footprint
  const x0 = TX - HW, x1 = TX + HW, z0 = TZ - HL, z1 = TZ + HL;
  const Y = 0.30, WALL_H = 14.0, TOP = Y + WALL_H, RISE = 6.4;
  const MEZZ = 7.60;                                 // public mezzanine deck
  const shellMat = makeMat(0xeef4f8, { texType: 'brushedsteel', repeatX: 10, repeatY: 30, metalness: 0.72, roughness: 0.26, flatShading: false });
  const ribMat = makeMat(0xcbd5e1, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.2, flatShading: false });
  const mullionMat = makeMat(0x475569, { metalness: 0.8, roughness: 0.35 });
  const curtainMat = makeMat(0x9fd8f5, { metalness: 0.85, roughness: 0.06, transparent: true, opacity: 0.26, emissive: 0x0ea5e9, emissiveIntensity: 0.22, flatShading: false });
  curtainMat.side = THREE.DoubleSide;
  curtainMat.depthWrite = false;
  const floorMat = makeMat(0xf1f5f9, { texType: 'marble', repeatX: 12, repeatY: 52, roughness: 0.18, clearcoat: 0.8, flatShading: false });
  const deskMat = makeMat(0x1e293b, { metalness: 0.4, roughness: 0.4 });
  const topMat = makeMat(0xe2e8f0, { texType: 'brushedsteel', metalness: 0.9, roughness: 0.2, flatShading: false });
  const seatMat = makeMat(0x2563eb, { texType: 'fabric', roughness: 0.9 });
  const beltMat = makeMat(0x334155, { metalness: 0.6, roughness: 0.5 });
  const woodMat = makeMat(0x8a5a2b, { texType: 'wood', repeatX: 4, repeatY: 4, roughness: 0.6 });
  const glowMat = makeMat(0xfff7d6, { emissive: 0xfff7d6, emissiveIntensity: 0.9 });
  const brandMat = makeMat(0x0284c7, { emissive: 0x0369a1, emissiveIntensity: 0.45, metalness: 0.6, roughness: 0.3 });
  const B = (w, h, d, x, y, z, m, o) => makeBox(grp, w, h, d, x, y, z, m, o);

  // ---- Podium, floor & terrazzo guide bands --------------------------------
  B(2 * HW + 2.4, 0.30, 2 * HL + 2.4, TX, Y - 0.15, TZ, makeMat(0xcbd5e1, { texType: 'concrete', repeatX: 12, repeatY: 52 }), { recv: true });
  const floor = B(2 * HW - 0.4, 0.10, 2 * HL - 0.4, TX, Y + 0.05, TZ, floorMat, { recv: true, name: 'Terminal floor' });
  addWorldBox(x0, x1, Y - 0.30, Y + 0.10, z0, z1, 'terminal_floor', true);
  for (const bx of [234, 248, 262]) B(0.5, 0.02, 2 * HL - 6, bx, Y + 0.11, TZ, brandMat);

  // ---- Barrel-vault roof: one shell, one instanced rib set, skylight crown --
  const shell = new THREE.Mesh(archShellGeometry(TX, TZ, HW + 1.2, 2 * HL + 2.4, TOP, RISE), shellMat);
  shell.castShadow = true;
  shell.receiveShadow = true;
  shell.material.side = THREE.DoubleSide;
  shell.userData.studioName = 'Terminal vault roof';
  grp.add(shell);
  const ribPts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    ribPts.push(new THREE.Vector3(TX - (HW + 1.2) + t * 2 * (HW + 1.2), TOP + RISE * Math.sin(Math.PI * t) - 0.34, 0));
  }
  const ribGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ribPts), 26, 0.30, 6, false);
  const ribT = [];
  for (let z = z0 - 1; z <= z1 + 1; z += 11.5) xform(ribT, 0, 0, z);
  flushInstances(grp, ribGeo, ribMat, ribT, { cast: true });
  const skylight = new THREE.Mesh(archShellGeometry(TX, TZ, HW + 1.2, 2 * HL - 4, TOP, RISE, 10, 0.40, 0.60),
    makeMat(0xdff3ff, { emissive: 0xbfe6ff, emissiveIntensity: 0.55, transparent: true, opacity: 0.55, roughness: 0.1 }));
  skylight.material.side = THREE.DoubleSide;
  skylight.position.y = 0.12;
  grp.add(skylight);
  for (const s of [-1, 1]) B(0.6, 0.9, 2 * HL + 2.4, TX + s * (HW + 1.2), TOP + 0.1, TZ, brandMat);
  addWorldBox(x0 - 1.2, x1 + 1.2, TOP, TOP + RISE + 0.4, z0 - 1.2, z1 + 1.2, 'terminal_roof', true);

  // ---- Structure: perimeter columns ----------------------------------------
  const colT = [];
  for (let z = z0 + 6; z <= z1 - 6; z += 17) for (const s of [-1, 1]) xform(colT, TX + s * (HW - 1.4), Y + WALL_H / 2, z, 0.9, WALL_H, 0.9);
  flushInstances(grp, UNIT_BOX, ribMat, colT, { cast: true, recv: true });

  // ---- Landside curtain wall (west) with three entrance portals -------------
  const westDoors = [500, 565, 630];
  {
    let cursor = z0;
    const spans = [];
    for (const dz of westDoors) { spans.push([cursor, dz - 4]); cursor = dz + 4; }
    spans.push([cursor, z1]);
    for (const [a, b] of spans) {
      if (b - a < 0.4) continue;
      B(0.5, WALL_H, b - a, x0, Y + WALL_H / 2, (a + b) / 2, whiteMat, {
        box: [x0 - 0.25, x0 + 0.25, Y, TOP, a, b, 'terminal_wall', false]
      });
      const gl = B(0.16, WALL_H - 1.2, b - a - 0.6, x0 - 0.30, Y + WALL_H / 2, (a + b) / 2, curtainMat, { order: 3 });
      gl.userData.studioName = 'Landside curtain wall';
      const mT = [];
      for (let z = a + 1.2; z < b - 0.6; z += 2.4) xform(mT, x0 - 0.36, Y + WALL_H / 2, z, 0.16, WALL_H - 1.2, 0.16);
      for (const hy of [3.4, 7.0, 10.6]) xform(mT, x0 - 0.36, Y + hy, (a + b) / 2, 0.16, 0.16, b - a - 0.6);
      flushInstances(grp, UNIT_BOX, mullionMat, mT);
    }
    for (const dz of westDoors) {
      B(0.5, WALL_H - 4.6, 8, x0, Y + 4.6 + (WALL_H - 4.6) / 2, dz, whiteMat);
      B(0.9, 0.34, 8.6, x0 - 0.2, Y + 4.6, dz, steelMat);
      B(0.2, 4.4, 0.3, x0 - 0.2, Y + 2.2, dz - 4, steelMat);
      B(0.2, 4.4, 0.3, x0 - 0.2, Y + 2.2, dz + 4, steelMat);
      createNeonSign(grp, dz === 565 ? 'DEPARTURES  •  TERMINAL 1' : 'ENTRANCE', x0 - 0.62, Y + 5.5, dz, '#090d14', dz === 565 ? '#facc15' : '#38bdf8', dz === 565 ? 9.0 : 4.4, 0.9);
    }
  }
  // ---- Airside curtain wall (east) with gate-pod portals --------------------
  {
    const spans = [[z0, 494], [510, 614], [630, z1]];
    for (const [a, b] of spans) {
      B(0.5, WALL_H, b - a, x1, Y + WALL_H / 2, (a + b) / 2, whiteMat, {
        box: [x1 - 0.25, x1 + 0.25, Y, TOP, a, b, 'terminal_wall', false]
      });
      B(0.16, WALL_H - 1.2, b - a - 0.6, x1 + 0.30, Y + WALL_H / 2, (a + b) / 2, curtainMat, { order: 3 });
      const mT = [];
      for (let z = a + 1.2; z < b - 0.6; z += 2.4) xform(mT, x1 + 0.36, Y + WALL_H / 2, z, 0.16, WALL_H - 1.2, 0.16);
      for (const hy of [3.4, 7.0, 10.6]) xform(mT, x1 + 0.36, Y + hy, (a + b) / 2, 0.16, 0.16, b - a - 0.6);
      flushInstances(grp, UNIT_BOX, mullionMat, mT);
    }
  }
  // ---- End walls -----------------------------------------------------------
  for (const ez of [-1, 1]) {
    const wz = TZ + ez * HL;
    B(2 * HW, WALL_H, 0.5, TX, Y + WALL_H / 2, wz, whiteMat, {
      box: [x0, x1, Y, TOP, wz - 0.25, wz + 0.25, 'terminal_wall', false]
    });
    B(2 * HW - 5, 5.0, 0.2, TX, Y + 8.0, wz + ez * 0.32, curtainMat, { order: 3 });
  }

  // ---- Curbside drop-off: lane, canopy, columns, signage -------------------
  const curbAsphalt = makeMat(0x2b3138, { texType: 'asphalt', repeatX: 2, repeatY: 30, roughness: 0.86 });
  B(12, 0.08, 178, 216, 0.22, TZ, curbAsphalt, { recv: true });
  addWorldBox(210, 222, 0.14, 0.26, 476, 654, 'lax_curb_lane', true);
  reserveFootprint(209, 223, 475, 655, 'road');
  mapShapes.push({ x: 216, z: TZ, w: 12, d: 178, color: '#334155', border: '#facc15', enterable: false });
  const laneT = [];
  for (let z = 482; z <= 648; z += 8) xform(laneT, 216, 0.27, z, 0.22, 0.03, 3.4);
  flushInstances(grp, UNIT_BOX, new THREE.MeshBasicMaterial({ color: 0xfacc15 }), laneT);
  const zebraT = [];
  for (const dz of westDoors) for (let s = -5; s <= 5; s += 2) xform(zebraT, 216 + s, 0.27, dz, 1.2, 0.03, 5.0);
  flushInstances(grp, UNIT_BOX, new THREE.MeshBasicMaterial({ color: 0xf8fafc }), zebraT);
  B(19, 0.55, 158, 219, 7.35, TZ, shellMat, { cast: true, recv: true, name: 'Departures canopy' });
  B(19.4, 0.35, 158.6, 219, 7.02, TZ, brandMat);
  addWorldBox(209.5, 228.5, 7.0, 7.65, 486, 644, 'curb_canopy', true);
  for (let z = 492; z <= 638; z += 24.3) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 7.0, 10), ribMat);
    c.position.set(212, 3.5, z);
    c.castShadow = true;
    grp.add(c);
    addWorldBox(211.5, 212.5, 0.26, 7.0, z - 0.5, z + 0.5, 'canopy_column', false);
  }
  const stripT = [];
  for (let z = 490; z <= 640; z += 10) xform(stripT, 219, 6.92, z, 12, 0.1, 0.6);
  flushInstances(grp, UNIT_BOX, glowMat, stripT);
  createNeonSign(grp, 'LOS AURA INTERNATIONAL', 209.2, 8.9, TZ, '#090d14', '#facc15', 22.0, 2.0);
  createNeonSign(grp, 'LAX  •  TERMINAL 1  •  DEPARTURES', 209.2, 6.2, TZ, '#0b1220', '#38bdf8', 17.0, 1.0);

  // =========================================================================
  // INTERIOR (distance-culled)
  // =========================================================================
  const inn = new THREE.Group();
  inn.userData.studioName = 'LAX terminal interior';
  grp.add(inn);
  const I = (w, h, d, x, y, z, m, o) => makeBox(inn, w, h, d, x, y, z, m, o);

  // ---- Check-in islands ----------------------------------------------------
  const screenT = [], beltT = [];
  for (const cz of [492, 524, 606, 638]) {
    I(5.0, 1.15, 16.0, 239, Y + 0.575, cz, deskMat, { cast: true });
    I(5.3, 0.12, 16.3, 239, Y + 1.21, cz, topMat);
    I(0.6, 1.9, 16.0, 241.8, Y + 2.1, cz, makeMat(0x0f172a, { metalness: 0.5, roughness: 0.4 }));
    addWorldBox(236.5, 241.5, Y, Y + 1.27, cz - 8.0, cz + 8.0, 'checkin_counter', true);
    for (let i = -3; i <= 3; i++) {
      xform(screenT, 241.4, Y + 2.35, cz + i * 2.2, 0.12, 0.85, 1.5);
      xform(beltT, 235.4, Y + 0.42, cz + i * 2.2, 1.6, 0.5, 1.7);
    }
    I(6.0, 0.12, 1.2, 239, Y + 3.6, cz, brandMat);
    createNeonSign(inn, `CHECK-IN  ${cz < 550 ? 'A' : 'B'}${cz}`, 239, Y + 3.05, cz, '#0b1220', '#38bdf8', 4.6, 0.62);
  }
  flushInstances(inn, UNIT_BOX, makeMat(0x22d3ee, { emissive: 0x0891b2, emissiveIntensity: 0.8 }), screenT);
  flushInstances(inn, UNIT_BOX, beltMat, beltT, { recv: true });
  createNeonSign(inn, 'CHECK-IN  •  DESKS 1–28', 239, Y + 5.6, 565, '#0b1220', '#38bdf8', 13.0, 1.0);

  // ---- Hanging departures board (shared canvas, landside + airside) --------
  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = 512; boardCanvas.height = 320;
  airport.board = boardCanvas;
  airport.boardRows = [];
  for (let i = 0; i < 7; i++) {
    const hh = 9 + Math.floor(rnd() * 12), mm = Math.floor(rnd() * 6) * 10;
    airport.boardRows.push({
      code: `AU ${100 + Math.floor(rnd() * 800)}`,
      dest: FLIGHT_DESTS[i % FLIGHT_DESTS.length],
      time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
      status: FLIGHT_STATUS[Math.floor(rnd() * FLIGHT_STATUS.length)]
    });
  }
  drawDeparturesBoard();
  const boardTex = new THREE.CanvasTexture(boardCanvas);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  airport.boardTex = boardTex;
  const boardMat = new THREE.MeshStandardMaterial({ map: boardTex, emissiveMap: boardTex, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.3 });
  const boardFaces = [boardMat, boardMat, deskMat, deskMat, deskMat, deskMat];
  I(0.5, 10.0, 16.0, 245.5, Y + 9.4, 565, boardFaces, { name: 'Departures board' });
  I(0.5, 7.5, 12.0, 256.0, Y + 8.4, 565, boardFaces);
  for (const bx of [245.5, 256.0]) for (const s of [-1, 1]) I(0.16, 3.2, 0.16, bx, Y + 15.0, 565 + s * 5.5, ribMat);

  // ---- Security checkpoint: divider wall + three lanes ---------------------
  for (const [a, b] of [[z0 + 0.5, 545], [585, z1 - 0.5]]) {
    I(0.6, 6.0, b - a, 250, Y + 3.0, (a + b) / 2, makeMat(0xe2e8f0, { texType: 'siding', repeatX: 2, repeatY: 20 }), {
      box: [249.7, 250.3, Y, Y + 6.0, a, b, 'security_divider', false]
    });
    I(0.2, 3.4, b - a - 1, 250.35, Y + 4.0, (a + b) / 2, curtainMat, { order: 3 });
  }
  for (const lz of [551, 565, 579]) {
    for (const sx of [-1, 1]) {
      I(0.45, 3.0, 4.4, 250 + sx * 2.0, Y + 1.5, lz, steelMat, { cast: true });
      addWorldBox(250 + sx * 2.0 - 0.23, 250 + sx * 2.0 + 0.23, Y, Y + 3.0, lz - 2.2, lz + 2.2, 'security_arch', false);
    }
    I(4.6, 0.35, 4.4, 250, Y + 3.15, lz, steelMat);
    I(1.9, 0.85, 6.0, 247.0, Y + 0.43, lz, beltMat, { cast: true });
    I(2.2, 1.35, 2.4, 247.0, Y + 1.35, lz + 1.9, makeMat(0x0f172a, { metalness: 0.5 }), { cast: true });
    addWorldBox(246.0, 248.0, Y, Y + 0.86, lz - 3.0, lz + 3.0, 'security_belt', true);
    const binT = [];
    for (let i = 0; i < 3; i++) xform(binT, 246.2, Y + 0.95, lz - 2.2 + i * 0.8, 1.3, 0.22, 0.6);
    flushInstances(inn, UNIT_BOX, makeMat(0x64748b, { roughness: 0.7 }), binT);
  }
  createNeonSign(inn, 'SECURITY  →  GATES 1–8', 250, Y + 5.4, 543, '#065f46', '#f8fafc', 11.0, 0.9);
  const stanchT = [];
  for (let z = 546; z <= 584; z += 3.2) for (const sx of [-4.2, 4.2]) xform(stanchT, 250 + sx, Y + 0.5, z, 0.1, 1.0, 0.1);
  flushInstances(inn, UNIT_BOX, ribMat, stanchT);

  // ---- Public mezzanine: deck, stair, railing, restaurant ------------------
  I(13.6, 0.30, 190, 233.0, MEZZ - 0.15, 565, floorMat, { recv: true });
  addWorldBox(226.2, 239.8, MEZZ - 0.30, MEZZ, 470, 660, 'mezzanine_deck', true);
  for (const [a, b] of [[470, 596], [612, 660]]) {
    I(0.16, 1.15, b - a, 239.8, MEZZ + 0.575, (a + b) / 2, ribMat);
    I(0.10, 0.95, b - a - 0.4, 239.8, MEZZ + 0.55, (a + b) / 2, curtainMat, { order: 3 });
    addWorldBox(239.6, 240.0, MEZZ, MEZZ + 1.15, a, b, 'mezz_rail', true);
  }
  for (let i = 0; i < 14; i++) {
    const sy = Y + 0.10 + i * 0.52, sz = 611.0 - i * 1.1;
    I(4.4, 0.52, 1.1, 235.0, sy + 0.26, sz, makeMat(0xd8dee6, { texType: 'concrete', repeatX: 2, repeatY: 1 }), {
      recv: true, box: [232.8, 237.2, sy, sy + 0.52, sz - 0.55, sz + 0.55, 'mezz_stair', true]
    });
  }
  I(4.4, 0.3, 3.0, 235.0, MEZZ - 0.15, 594.5, floorMat, { recv: true, box: [232.8, 237.2, MEZZ - 0.3, MEZZ, 593, 596, 'mezz_stair', true] });
  for (const tz of [490, 508, 526, 620, 638]) {
    I(1.6, 0.08, 1.6, 231.5, MEZZ + 0.78, tz, woodMat);
    I(0.16, 0.74, 0.16, 231.5, MEZZ + 0.37, tz, ribMat);
    for (const s of [-1, 1]) {
      I(0.9, 0.45, 0.9, 231.5 + s * 1.7, MEZZ + 0.23, tz, seatMat);
      I(0.9, 0.55, 0.16, 231.5 + s * 1.7, MEZZ + 0.72, tz + 0.4, seatMat);
    }
  }
  I(3.0, 1.1, 12.0, 228.6, MEZZ + 0.55, 565, woodMat, { cast: true });
  I(3.3, 0.12, 12.3, 228.6, MEZZ + 1.16, 565, topMat);
  addWorldBox(227.1, 230.1, MEZZ, MEZZ + 1.22, 559, 571, 'mezz_bar', true);
  createNeonSign(inn, 'SKY DECK  •  BAR & GRILL', 233.0, MEZZ + 3.2, 565, '#1c1917', '#fcd34d', 10.0, 0.85);

  // ---- Airside retail, food court & gate lounges ---------------------------
  I(9.0, 3.2, 13.0, 259.0, Y + 1.6, 492, makeMat(0x7f1d1d, { texType: 'wood', repeatX: 3, repeatY: 2 }));
  I(9.4, 0.25, 13.4, 259.0, Y + 3.3, 492, topMat);
  addWorldBox(254.5, 263.5, Y, Y + 3.2, 485.5, 498.5, 'duty_free', false);
  createNeonSign(inn, 'DUTY FREE', 259.0, Y + 4.2, 485.2, '#0b1220', '#facc15', 7.0, 0.85);
  const shelfT = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) xform(shelfT, 254.9, Y + 0.7 + r * 0.85, 487 + c * 2.0, 0.5, 0.55, 1.4);
  flushInstances(inn, UNIT_BOX, makeMat(0xf59e0b, { emissive: 0xb45309, emissiveIntensity: 0.3 }), shelfT);
  I(3.2, 1.1, 3.2, 259.0, Y + 0.55, 640, woodMat, { cast: true });
  I(3.6, 0.2, 3.6, 259.0, Y + 1.2, 640, topMat);
  addWorldBox(257.4, 260.6, Y, Y + 1.3, 638.4, 641.6, 'cafe_kiosk', true);
  createNeonSign(inn, 'SKY BEANS COFFEE', 259.0, Y + 2.7, 638.2, '#1c1917', '#fcd34d', 5.0, 0.7);
  for (const tz of [548, 560, 572, 584]) {
    I(1.5, 0.08, 1.5, 258.0, Y + 0.76, tz, woodMat);
    I(0.16, 0.72, 0.16, 258.0, Y + 0.36, tz, ribMat);
    for (const s of [-1, 1]) I(0.85, 0.45, 0.85, 258.0, Y + 0.23, tz + s * 1.6, seatMat);
  }
  const loungeT = [], backT = [];
  for (const gz of [498, 610]) {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
      const sx = 263.5, sz = gz + r * 3.0 + c * 0.0;
      xform(loungeT, sx, Y + 0.45, sz + c * 1.05, 3.4, 0.42, 0.9);
      xform(backT, sx, Y + 0.85, sz + c * 1.05 + 0.45, 3.4, 0.7, 0.18);
    }
    addWorldBox(261.8, 265.2, Y, Y + 0.7, gz - 0.5, gz + 13.0, 'gate_seat', true);
  }
  flushInstances(inn, UNIT_BOX, seatMat, loungeT, { cast: true, recv: true });
  flushInstances(inn, UNIT_BOX, seatMat, backT);
  const planterG = new THREE.CylinderGeometry(0.75, 0.62, 0.9, 10);
  for (const [px, pz] of [[252.5, 520], [252.5, 610], [266.5, 560], [243.0, 660]]) {
    const pl = new THREE.Mesh(planterG, makeMat(0x78350f, { roughness: 0.85 }));
    pl.position.set(px, Y + 0.45, pz);
    inn.add(pl);
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 0), makeMat(0x16a34a, { roughness: 0.9 }));
    bush.position.set(px, Y + 1.5, pz);
    bush.castShadow = true;
    inn.add(bush);
    addWorldBox(px - 0.75, px + 0.75, Y, Y + 0.9, pz - 0.75, pz + 0.75, 'planter', true);
  }
  // Baggage claim carousel (south end, landside)
  const carousel = new THREE.Group();
  carousel.position.set(232.0, Y + 0.55, 650);
  carousel.add(new THREE.Mesh(new THREE.CylinderGeometry(4.0, 4.0, 0.5, 20), beltMat));
  carousel.add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.7, 16), steelMat));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const bag = makeBox(carousel, 0.9, 0.6, 0.5, Math.cos(a) * 3.0, 0.5, Math.sin(a) * 3.0,
      makeMat([0xef4444, 0x2563eb, 0x16a34a, 0xf59e0b][i % 4], { roughness: 0.8 }), { ry: a });
    bag.castShadow = false;
  }
  inn.add(carousel);
  airport.carousel = carousel;
  addWorldBox(228.0, 236.0, Y, Y + 0.8, 646, 654, 'baggage_carousel', true);
  createNeonSign(inn, 'BAGGAGE CLAIM', 232.0, Y + 3.6, 650, '#0b1220', '#a78bfa', 6.5, 0.8);
  // Ceiling light strips + hall lighting
  const ceilT = [];
  for (let z = 474; z <= 656; z += 9) for (const lx of [234, 248, 262]) xform(ceilT, lx, TOP - 1.2, z, 7.0, 0.14, 0.8);
  flushInstances(inn, UNIT_BOX, glowMat, ceilT);
  for (const lz of [500, 565, 630]) {
    const hl = new THREE.PointLight(0xfff1d6, 2.2, 70, 2);
    hl.position.set(TX, Y + 9.5, lz);
    inn.add(hl);
  }
  (aura.culls || []).push({ g: inn, x: TX, z: TZ, r: 135 });

  // =========================================================================
  // GATE HOLD-ROOMS + PASSENGER BOARDING BRIDGES
  // =========================================================================
  const DECK = 2.45;
  for (const g of [{ jz: 502, n: 1 }, { jz: 622, n: 2 }]) {
    const pod = new THREE.Group();
    pod.position.set(275.5, 0, g.jz);
    pod.userData.studioName = `Gate ${g.n} hold-room`;
    grp.add(pod);
    const P = (w, h, d, x, y, z, m, o) => makeBox(pod, w, h, d, x, y, z, m, o);
    P(11, 0.30, 28, 0, Y - 0.15, 0, floorMat, { recv: true });
    addWorldBox(270, 281, Y - 0.30, Y + 0.10, g.jz - 14, g.jz + 14, 'gate_pod_floor', true);
    P(11, 8.0, 0.5, 0, Y + 4.0, -14, whiteMat, { box: [270, 281, Y, Y + 8, g.jz - 14.25, g.jz - 13.75, 'gate_pod_wall', false] });
    P(11, 8.0, 0.5, 0, Y + 4.0, 14, whiteMat, { box: [270, 281, Y, Y + 8, g.jz + 13.75, g.jz + 14.25, 'gate_pod_wall', false] });
    P(0.5, 8.0, 28, 5.5, Y + 4.0, 0, curtainMat, { order: 3 });
    P(11.8, 0.5, 29, 0, Y + 8.25, 0, shellMat, { cast: true, box: [269.6, 281.4, Y + 8.0, Y + 8.5, g.jz - 14.5, g.jz + 14.5, 'gate_pod_roof', true] });
    P(2.2, 1.15, 1.2, 2.6, Y + 0.575, -6.0, deskMat, { cast: true });
    P(2.4, 0.1, 1.4, 2.6, Y + 1.2, -6.0, topMat);
    addWorldBox(277.0, 279.2, Y, Y + 1.25, g.jz - 6.6, g.jz - 5.4, 'gate_desk', true);
    createNeonSign(pod, `GATE ${g.n}`, 2.6, Y + 3.4, -6.0, '#0b1220', '#facc15', 3.6, 0.9);
    const podSeatT = [], podBackT = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      xform(podSeatT, -2.2, Y + 0.45, 2.0 + r * 3.0 + c * 1.0, 3.0, 0.42, 0.85);
      xform(podBackT, -2.2, Y + 0.85, 2.45 + r * 3.0 + c * 1.0, 3.0, 0.7, 0.16);
    }
    flushInstances(pod, UNIT_BOX, seatMat, podSeatT, { cast: true, recv: true });
    flushInstances(pod, UNIT_BOX, seatMat, podBackT);
    // Stair up to bridge deck, then the landing
    for (let i = 0; i < 6; i++) {
      const sy = Y + 0.10 + i * 0.36, sz = -8.0 + i * 1.0;
      P(4.6, 0.36, 1.0, 0.5, sy + 0.18, sz, makeMat(0xd8dee6, { texType: 'concrete' }), {
        recv: true, box: [273.7, 278.3, sy, sy + 0.36, g.jz + sz - 0.5, g.jz + sz + 0.5, 'bridge_stair', true]
      });
    }
    P(9.0, 0.30, 7.0, 1.0, DECK - 0.15, 1.5, floorMat, {
      recv: true, box: [272.0, 281.0, DECK - 0.30, DECK, g.jz - 2.0, g.jz + 5.0, 'bridge_landing', true]
    });
    P(0.16, 1.1, 7.0, -3.4, DECK + 0.55, 1.5, ribMat);
    // Rotunda + telescoping tunnel out to the aircraft door
    const rot = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 3.3, 14), shellMat);
    rot.position.set(281, DECK + 1.65, g.jz + 2);
    rot.castShadow = true;
    grp.add(rot);
    const BL = 10.0, bz = g.jz + 2;
    B(BL, 0.24, 3.6, 286.0, DECK - 0.12, bz, topMat, { recv: true, box: [281, 291, DECK - 0.24, DECK, bz - 1.8, bz + 1.8, 'bridge_deck', true] });
    B(BL + 0.4, 0.22, 4.0, 286.0, DECK + 2.75, bz, shellMat, { cast: true });
    for (const s of [-1, 1]) {
      B(BL, 2.6, 0.14, 286.0, DECK + 1.35, bz + s * 1.85, curtainMat, { order: 3 });
      addWorldBox(281, 291, DECK, DECK + 2.6, bz + s * 1.85 - 0.09, bz + s * 1.85 + 0.09, 'bridge_glass', false);
    }
    B(0.5, 2.9, 3.8, 290.8, DECK + 1.35, bz, makeMat(0x1e293b, { roughness: 0.6 }));
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.36, DECK - 0.25, 8), ribMat);
    leg.position.set(288.5, (DECK - 0.25) / 2 + 0.25, bz);
    grp.add(leg);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10), makeMat(0x1c1917));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(288.5, 0.42, bz + 1.2);
    grp.add(wheel);
    enterableZones.push({ minX: 270.5, maxX: 280.5, minZ: g.jz - 13.5, maxZ: g.jz + 13.5, name: `LAX GATE ${g.n} HOLD-ROOM` });
    mapShapes.push({ x: 275.5, z: g.jz, w: 11, d: 28, color: '#e2e8f0', border: '#facc15', enterable: true });
  }

  // ---- Apron: stand markings, service equipment, flood masts ---------------
  const paintMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  const leadT = [];
  for (const jz of [502, 622]) {
    for (let x = 292; x <= 322; x += 5) xform(leadT, x, 0.27, jz, 3.2, 0.03, 0.32);
    xform(leadT, 302, 0.27, jz - 16, 0.32, 0.03, 12);
    xform(leadT, 302, 0.27, jz + 16, 0.32, 0.03, 12);
  }
  flushInstances(grp, UNIT_BOX, paintMat, leadT);
  const coneG = new THREE.ConeGeometry(0.32, 0.8, 8);
  const coneMat = makeMat(0xf97316, { emissive: 0xea580c, emissiveIntensity: 0.3 });
  for (const jz of [502, 622]) for (const [ox, oz] of [[-16, -15], [16, -15], [-16, 15], [16, 15]]) {
    const cone = new THREE.Mesh(coneG, coneMat);
    cone.position.set(302 + ox, 0.65, jz + oz);
    grp.add(cone);
  }
  for (const [ex, ez, hex] of [[294, 480, 0x2563eb], [294, 486, 0x2563eb], [296, 640, 0x16a34a], [296, 646, 0x16a34a]]) {
    B(2.0, 1.1, 3.0, ex, 0.85, ez, makeMat(hex, { metalness: 0.5, roughness: 0.5 }), { cast: true });
    B(2.2, 0.16, 3.2, ex, 1.45, ez, topMat);
    addWorldBox(ex - 1.1, ex + 1.1, 0.25, 1.5, ez - 1.6, ez + 1.6, 'bag_cart', true);
  }
  B(3.2, 1.3, 5.4, 288, 0.95, 560, makeMat(0xfacc15, { metalness: 0.4, roughness: 0.5 }), { cast: true });
  B(2.4, 1.2, 2.0, 288, 2.1, 558.4, makeMat(0x0f172a, { metalness: 0.5 }));
  addWorldBox(286.4, 289.6, 0.25, 2.7, 557.3, 562.7, 'pushback_tug', true);
  for (const mz of [470, 565, 660]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 22, 8), ribMat);
    mast.position.set(318, 11.25, mz);
    mast.castShadow = true;
    grp.add(mast);
    addWorldBox(317.6, 318.4, 0.25, 22, mz - 0.4, mz + 0.4, 'apron_mast', false);
    B(3.4, 0.5, 1.4, 318, 22.4, mz, makeMat(0xfff7d6, { emissive: 0xfff7d6, emissiveIntensity: 1.0 }));
  }

  // ---- Zones & map ---------------------------------------------------------
  enterableZones.push({ minX: x0 + 0.6, maxX: 249.4, minZ: z0 + 0.6, maxZ: z1 - 0.6, name: 'LAX LANDSIDE DEPARTURES HALL' });
  enterableZones.push({ minX: 246.0, maxX: 254.0, minZ: 545, maxZ: 585, name: 'LAX SECURITY CHECKPOINT' });
  enterableZones.push({ minX: 250.6, maxX: x1 - 0.6, minZ: z0 + 0.6, maxZ: z1 - 0.6, name: 'LAX AIRSIDE CONCOURSE' });
  mapShapes.push({ x: TX, z: TZ, w: 2 * HW, d: 2 * HL, color: '#f8fafc', border: '#0284c7', enterable: true });
}
function updateAirport(dt, elapsed) {
  if (airport.carousel) airport.carousel.rotation.y += dt * 0.35;
  if (!airport.board) return;
  if (dist2(player.x, player.z, 248, 565) > 14400) return;
  airport.tick += dt;
  if (airport.tick < 2.4) return;
  airport.tick = 0;
  const r = airport.boardRows[Math.floor(Math.random() * airport.boardRows.length)];
  r.status = FLIGHT_STATUS[Math.floor(Math.random() * FLIGHT_STATUS.length)];
  drawDeparturesBoard();
}

// =============================================================================
// LOS AURA NORTHERN EXPANSION
// =============================================================================
export function buildLosAuraNorthExpansion(register = true) {
  const grp = new THREE.Group();
  grp.userData.studioName = 'Los Aura Northern Expansion';
  worldRoot.add(grp);
  camera.far = Math.max(camera.far, 1150);
  camera.updateProjectionMatrix();
  const grassMat = makeGroundMat('grass', { color: 0x5a9a4e, repeatX: 72, repeatY: 60, roughness: 0.94 });
  const sandMat = makeGroundMat('sand', { repeatX: 48, repeatY: 12, roughness: 0.96 });
  const asphaltNS = makeMat(0x313946, { texType: 'asphalt', repeatX: 2, repeatY: 48, roughness: 0.86, bumpScale: 0.015 });
  const asphaltEW = makeMat(0x313946, { texType: 'asphalt', repeatX: 48, repeatY: 2, roughness: 0.86, bumpScale: 0.015 });
  const runwayMat = makeMat(0x1e293b, { texType: 'asphalt', repeatX: 6, repeatY: 40, roughness: 0.85 });
  const tarmacMat = makeGroundMat('concrete', { color: 0x64748b, repeatX: 24, repeatY: 24, roughness: 0.88 });
  const concreteMat = makeGroundMat('concrete', { color: 0xd1d5db, repeatX: 18, repeatY: 2, roughness: 0.88 });
  const sidewalkMat = makeGroundMat('concrete', { color: 0xcbd5e1, repeatX: 12, repeatY: 12, roughness: 0.85 });
  const plazaMat = makeGroundMat('concrete', { color: 0x94a3b8, repeatX: 14, repeatY: 14, roughness: 0.82 });
  const woodDeckMat = makeMat(0x926c44, { texType: 'wood', repeatX: 40, repeatY: 4, roughness: 0.82 });
  const steelMat = makeMat(0xe2e8f0, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.18, flatShading: false });
  const bridgeRedMat = makeMat(0xdc2626, { metalness: 0.65, roughness: 0.32 });
  const whiteMat = makeMat(0xf8fafc, { roughness: 0.55 });
  const redCurbMat = makeMat(0xef4444, { roughness: 0.6 });
  const B = (w, h, d, mat, x, y, z, cast = true, receive = true) => makeBox(grp, w, h, d, x, y, z, mat, { cast, recv: receive });
  const paved = (w, d, mat, x, y, z, tag) => {
    makeBox(grp, w, 0.08, d, x, y - 0.04, z, mat, { recv: true });
    addWorldBox(x - w / 2, x + w / 2, y - 0.08, y, z - d / 2, z + d / 2, tag, true);
  };
  createWaterSurface({
    id: 'ocean_strait', parent: grp, minX: -260, maxX: 500, minZ: 320, maxZ: 380,
    surfaceY: 0.20, bedFn: getOceanBedY, waveScale: 0.9, currentX: 0.55, isOcean: true, segmentSize: 4
  });
  mapShapes.push({ x: 120, z: 299, w: 760, d: 162, color: '#0284c7', border: '#38bdf8', enterable: false });
  const surfFoam = new THREE.Mesh(new THREE.PlaneGeometry(740, 2.2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.58 }));
  surfFoam.rotation.x = -Math.PI / 2;
  surfFoam.position.set(120, 0.215, 380.3);
  grp.add(surfFoam);
  buildChannelBuoy(grp, I88.x - 30, 300, 0xdc2626);
  buildChannelBuoy(grp, I88.x + 30, 300, 0x22c55e);
  buildChannelBuoy(grp, I88.x - 30, 352, 0xdc2626);
  buildChannelBuoy(grp, I88.x + 30, 352, 0x22c55e);
  buildRowboat(grp, -58, 348, 0x926c44);
  buildRowboat(grp, -30, 372, 0x0ea5e9);
  const northLandGeo = new THREE.PlaneGeometry(740, 550, 185, 138);
  northLandGeo.rotateX(-Math.PI / 2);
  const northLand = new THREE.Mesh(northLandGeo, grassMat);
  northLand.position.set(120, 0.18, 655);
  northLand.receiveShadow = true;
  registerSculptableTerrain(northLand);
  grp.add(northLand);
  mapShapes.unshift({ x: 120, z: 655, w: 740, d: 550, color: '#4d7c0f', border: '#365314', enterable: false });
  // Santa Aura beach & boardwalk
  paved(366, 28, sandMat, -47, 0.24, 394, 'beach_sand');
  mapShapes.push({ x: -47, z: 394, w: 366, d: 28, color: '#fcd34d', border: '#f59e0b', enterable: false });
  B(354, 0.22, 14, woodDeckMat, -43, 0.29, 413, false);
  addWorldBox(-220, 134, 0.18, 0.40, 406, 420, 'boardwalk_deck', true);
  mapShapes.push({ x: -43, z: 413, w: 354, d: 14, color: '#b45309', border: '#fef08a', enterable: false });
  paved(362, 12, asphaltEW, -39, 0.24, 428, 'boardwalk_ave');
  mapShapes.push({ x: -39, z: 428, w: 362, d: 12, color: '#334155', border: '#facc15', enterable: false });
  reserveFootprint(-220, 142, 421, 435, 'road');
  B(12, 0.26, 82, woodDeckMat, -42, 0.42, 365);
  addWorldBox(-48, -36, 0.18, 0.55, 324, 406, 'santa_aura_pier', true);
  mapShapes.push({ x: -42, z: 365, w: 12, d: 82, color: '#92400e', border: '#f59e0b', enterable: false });
  for (let pz = 328; pz <= 402; pz += 10) for (const ox of [-5.2, 5.2]) {
    const piling = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 1.8, 8), makeMat(0x57534e));
    piling.position.set(-42 + ox, -0.3, pz);
    grp.add(piling);
  }
  B(0.45, 5.2, 0.45, bridgeRedMat, -47.2, 3.0, 405.5);
  B(0.45, 5.2, 0.45, bridgeRedMat, -36.8, 3.0, 405.5);
  createNeonSign(grp, 'SANTA AURA PIER & BOARDWALK', -42, 5.4, 405.5, '#1e1b4b', '#38bdf8', 11.2, 1.35);
  const wheelGroup = new THREE.Group();
  wheelGroup.position.set(-42, 14.5, 352);
  wheelGroup.userData.studioName = 'Santa Aura Ferris wheel';
  const wheelRadius = 11.5;
  const wheelRim1 = new THREE.Mesh(new THREE.TorusGeometry(wheelRadius, 0.22, 10, 32), new THREE.MeshBasicMaterial({ color: 0xf43f5e }));
  wheelRim1.position.z = -1.2;
  const wheelRim2 = wheelRim1.clone();
  wheelRim2.position.z = 1.2;
  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(wheelRadius * 0.62, 0.14, 8, 24), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
  wheelGroup.add(wheelRim1, wheelRim2, innerRing);
  const gondolaMat = makeMat(0xfacc15, { metalness: 0.4, roughness: 0.4 });
  const wheelPods = [];
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, wheelRadius * 2, 6), steelMat);
    spoke.rotation.z = ang + Math.PI / 2;
    wheelGroup.add(spoke);
    const pod = makeBox(wheelGroup, 1.5, 1.3, 2.0, Math.cos(ang) * wheelRadius, Math.sin(ang) * wheelRadius, 0, gondolaMat);
    wheelPods.push(pod);
  }
  grp.add(wheelGroup);
  buildLosAuraNorthExpansion.wheel = { group: wheelGroup, pods: wheelPods, angle: 0 };
  for (const lz of [-2.2, 2.2]) for (const dir of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 15.5, 8), steelMat);
    leg.position.set(-42 + dir * 3.8, 7.3, 352 + lz);
    leg.rotation.z = dir * 0.46;
    grp.add(leg);
  }
  buildHotdogStore(-18, 439);
  buildWalkInHouse({ x: -72, z: 439, w: 11.5, d: 9.0, wallColor: 0x38bdf8, roofColor: 0xf43f5e, label: 'SANTA AURA ARCADE' });
  buildWalkInHouse({ x: 38, z: 439, w: 11.5, d: 9.0, wallColor: 0xfef08a, roofColor: 0x0284c7, label: 'PACIFIC SURF & GEAR' });
  const umbrellaG = new THREE.ConeGeometry(1.6, 0.6, 8);
  for (const [ux, uz, col] of [[-165, 392, 0xef4444], [-125, 390, 0x3b82f6], [-85, 393, 0xfacc15], [15, 391, 0x22c55e], [65, 392, 0xec4899], [105, 390, 0xf97316]]) {
    B(0.08, 2.4, 0.08, whiteMat, ux, 1.35, uz, false);
    const umbrella = new THREE.Mesh(umbrellaG, makeMat(col));
    umbrella.position.set(ux, 2.65, uz);
    grp.add(umbrella);
  }
  for (let px = -205; px <= 125; px += 30) if (Math.abs(px + 42) > 12) createTree(px, 421.5, 1.05);
  // Downtown Los Aura — same generator as Sunnyvale, different config
  roadGrid(grp,
    { at: [-108, -60, -12, 36, 84, 124], w: 12, d: 204, c: 564, top: 0.24, thick: 0.08, mat: asphaltNS, tag: 'dt_road', map: ['#334155', '#475569'] },
    { at: [468, 516, 564, 612, 660], w: 12, d: 244, c: 8, top: 0.24, thick: 0.08, mat: asphaltEW, tag: 'dt_road', map: ['#334155', '#475569'] },
    null);
  for (const cz of [468, 564, 660]) {
    paved(22, 12, asphaltEW, 135, 0.24, cz, 'dt_connector');
    reserveFootprint(124, 146, cz - 7, cz + 7, 'road');
  }
  cityBlocks(grp, [-84, -36, 12, 60, 104], [492, 540, 588, 636], (bx) => {
    const bw = bx === 104 ? 28 : 36;
    return [[bw, 0.12, 36, 0.24, sidewalkMat], [bw - 4, 0.14, 32, 0.25, plazaMat]];
  }, (bx, bz) => {
    const bw = bx === 104 ? 28 : 36;
    buildKnockableLamppost(bx - bw / 2 + 1.2, bz - 16.8);
    buildKnockableLamppost(bx + bw / 2 - 1.2, bz + 16.8);
  });
  // Landmark roof dressing
  const crownRing1 = new THREE.Mesh(new THREE.TorusGeometry(7.7, 1.1, 10, 24), makeMat(0xbae6fd, { metalness: 0.9, roughness: 0.12, emissive: 0x0284c7, emissiveIntensity: 0.25 }));
  crownRing1.rotation.x = Math.PI / 2;
  crownRing1.position.set(-36, 88.6, 540);
  const crownRing2 = new THREE.Mesh(new THREE.TorusGeometry(5.7, 0.9, 10, 24), makeMat(0xf8fafc, { metalness: 0.85, roughness: 0.2 }));
  crownRing2.rotation.x = Math.PI / 2;
  crownRing2.position.set(-36, 92.4, 540);
  const usGlowBand = new THREE.Mesh(new THREE.TorusGeometry(6.3, 0.25, 8, 24), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
  usGlowBand.rotation.x = Math.PI / 2;
  usGlowBand.position.set(-36, 90.5, 540);
  grp.add(crownRing1, crownRing2, usGlowBand);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B(0.6, 3.4, 0.6, steelMat, -36 + sx * 7.4, 88.2, 540 + sz * 7.4);
  const sailMesh = makeBox(grp, 15.5, 11.0, 1.4, 12, 88.0, 540,
    makeMat(0x7dd3fc, { metalness: 0.95, roughness: 0.08, emissive: 0x38bdf8, emissiveIntensity: 0.35 }), { rz: 0.24 });
  const wilshireSpire = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.42, 18.0, 8), steelMat);
  wilshireSpire.position.set(17.5, 93.0, 540);
  grp.add(wilshireSpire);
  B(14.5, 5.5, 12.0, makeMat(0x0284c7, { emissive: 0x0369a1, emissiveIntensity: 0.3 }), 60, 71.0, 540);
  B(12.5, 8.0, 12.5, whiteMat, -36, 56.2, 636);
  B(8.0, 6.0, 8.0, whiteMat, -36, 63.2, 636);
  const cityHallPyramid = new THREE.Mesh(new THREE.ConeGeometry(5.8, 5.5, 4), makeMat(0xfef08a, { emissive: 0xfacc15, emissiveIntensity: 0.35 }));
  cityHallPyramid.rotation.y = Math.PI / 4;
  cityHallPyramid.position.set(-36, 68.9, 636);
  grp.add(cityHallPyramid);
  const hallGroup = new THREE.Group();
  hallGroup.position.set(-84, 0.30, 588);
  hallGroup.userData.studioName = 'WALT AURA CONCERT HALL';
  makeBox(hallGroup, 24, 6.5, 22, 0, 3.25, 0, makeMat(0xf8fafc, { texType: 'marble' }), { cast: true });
  for (const s of [
    { w: 14, h: 15, d: 0.55, x: -3.5, y: 10.5, z: 4.5, rx: 0.32, ry: 0.25, rz: -0.28 },
    { w: 15, h: 17, d: 0.55, x: 3.8, y: 11.5, z: 2.0, rx: -0.25, ry: -0.35, rz: 0.30 },
    { w: 13, h: 14, d: 0.55, x: 0.0, y: 10.0, z: -4.8, rx: -0.35, ry: 0.15, rz: -0.20 },
    { w: 11, h: 12, d: 0.55, x: -6.5, y: 8.8, z: -2.5, rx: 0.20, ry: 0.45, rz: 0.34 }
  ]) makeBox(hallGroup, s.w, s.h, s.d, s.x, s.y, s.z, steelMat, { cast: true, rx: s.rx, ry: s.ry, rz: s.rz });
  createNeonSign(hallGroup, 'WALT AURA CONCERT HALL', 0, 5.2, 11.2, '#0f172a', '#38bdf8', 11.5, 1.15);
  grp.add(hallGroup);
  addWorldBox(-96, -72, 0.30, 7.0, 577, 599, 'concert_hall', false);
  mapShapes.push({ x: -84, z: 588, w: 24, d: 22, color: '#e2e8f0', border: '#38bdf8', enterable: false });
  const arenaGroup = new THREE.Group();
  arenaGroup.position.set(60, 0.30, 492);
  arenaGroup.userData.studioName = 'AURA ARENA';
  const arenaBowl = new THREE.Mesh(new THREE.CylinderGeometry(14.5, 13.0, 14.0, 24), makeMat(0x1e293b, { metalness: 0.75, roughness: 0.25 }));
  arenaBowl.position.y = 7.0;
  arenaBowl.castShadow = true;
  const arenaRoof = new THREE.Mesh(new THREE.CylinderGeometry(11.5, 14.8, 3.2, 24), makeMat(0x38bdf8, { metalness: 0.85, roughness: 0.18, emissive: 0x0284c7, emissiveIntensity: 0.22 }));
  arenaRoof.position.y = 15.6;
  const ledRibbon = new THREE.Mesh(new THREE.CylinderGeometry(14.65, 14.65, 1.8, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xa855f7, side: THREE.DoubleSide }));
  ledRibbon.position.y = 10.5;
  arenaGroup.add(arenaBowl, arenaRoof, ledRibbon);
  createNeonSign(arenaGroup, 'AURA ARENA • LOS AURA LIVE', 0, 4.5, 14.8, '#1e1b4b', '#facc15', 13.5, 1.35);
  grp.add(arenaGroup);
  addWorldBox(46, 74, 0.30, 17.2, 478, 506, 'aura_arena', false);
  mapShapes.push({ x: 60, z: 492, w: 28, d: 28, color: '#4f46e5', border: '#facc15', enterable: false });
  buildReserveBank(12, 492);
  buildCarDealership(-36, 492);
  buildHotdogStore(12, 588);
  // ---- Los Aura International Airport -------------------------------------
  paved(288, 260, tarmacMat, 324, 0.25, 565, 'lax_tarmac');
  mapShapes.push({ x: 324, z: 565, w: 288, d: 260, color: '#475569', border: '#94a3b8', enterable: false });
  paved(64, 14, asphaltEW, 194, 0.26, 564, 'lax_access');
  reserveFootprint(162, 226, 557, 571, 'road');
  createNeonSign(grp, 'LAX • LOS AURA INTL AIRPORT', 186, 6.2, 555.5, '#0f172a', '#38bdf8', 13.0, 1.5);
  // Theme Building — gateway monument at the airport entrance
  const themeGroup = new THREE.Group();
  themeGroup.position.set(196, 0.24, 424);
  themeGroup.userData.studioName = 'LAX Theme Building';
  const coreShaft = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 15.0, 14), whiteMat);
  coreShaft.position.y = 7.5;
  const observationSaucer = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 6.8, 2.6, 20), makeMat(0x38bdf8, { metalness: 0.85, roughness: 0.15, emissive: 0x0284c7, emissiveIntensity: 0.3 }));
  observationSaucer.position.y = 10.2;
  const saucerRoof = new THREE.Mesh(new THREE.ConeGeometry(8.8, 2.2, 20), whiteMat);
  saucerRoof.position.y = 12.6;
  themeGroup.add(coreShaft, observationSaucer, saucerRoof);
  for (const rotY of [0, Math.PI / 2]) {
    const archPts = [];
    for (let t = -1; t <= 1.001; t += 0.1) archPts.push(new THREE.Vector3(t * 16.5, (1 - t * t) * 18.5, 0));
    const archMesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(archPts), 28, 0.55, 8, false), whiteMat);
    archMesh.rotation.y = rotY;
    archMesh.castShadow = true;
    themeGroup.add(archMesh);
  }
  grp.add(themeGroup);
  addWorldBox(192.5, 199.5, 0.24, 15.2, 420.5, 427.5, 'lax_theme_bldg', false);
  mapShapes.push({ x: 196, z: 424, w: 34, d: 34, color: '#f8fafc', border: '#38bdf8', enterable: false });
  buildAirportTerminal(grp, { whiteMat, steelMat, asphaltEW });
  // Control tower — clear of the terminal, with sightlines down both runways
  B(5.2, 34.0, 5.2, whiteMat, 296, 17.24, 440);
  const atcCab = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 3.8, 4.6, 12), makeMat(0x10b981, { metalness: 0.85, roughness: 0.15, emissive: 0x059669, emissiveIntensity: 0.28 }));
  atcCab.position.set(296, 36.2, 440);
  const atcRoof = new THREE.Mesh(new THREE.CylinderGeometry(5.8, 5.8, 0.7, 12), whiteMat);
  atcRoof.position.set(296, 38.8, 440);
  const atcBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
  atcBeacon.position.set(296, 41.2, 440);
  aviationBeacons.push(atcBeacon);
  grp.add(atcCab, atcRoof, atcBeacon);
  addWorldBox(293.4, 298.6, 0.24, 39.2, 437.4, 442.6, 'atc_tower', false);
  createNeonSign(grp, 'CONTROL TOWER', 296, 30.0, 437.2, '#052e2b', '#6ee7b7', 5.0, 0.7);
  mapShapes.push({ x: 296, z: 440, w: 11, d: 11, color: '#10b981', border: '#6ee7b7', enterable: false });
  // Runways
  const runwayXs = [336, 394];
  const rwEdgeT = [], stripeT = [];
  for (const rx of runwayXs) {
    paved(22, 240, runwayMat, rx, 0.29, 565, 'runway');
    mapShapes.push({ x: rx, z: 565, w: 22, d: 240, color: '#0f172a', border: '#f8fafc', enterable: false });
    for (const tz of [452, 678]) for (let sx = -8; sx <= 8; sx += 3.2) xform(stripeT, rx + sx, 0.295, tz, 1.4, 0.09, 7.5);
    for (let z = 466; z <= 664; z += 12) {
      xform(stripeT, rx, 0.295, z, 0.45, 0.09, 5.5);
      xform(rwEdgeT, rx - 10.6, 0.46, z, 0.35, 0.35, 0.35);
      xform(rwEdgeT, rx + 10.6, 0.46, z, 0.35, 0.35, 0.35);
    }
  }
  flushInstances(grp, UNIT_BOX, whiteMat, stripeT);
  flushInstances(grp, UNIT_BOX, new THREE.MeshBasicMaterial({ color: 0x38bdf8 }), rwEdgeT);
  const spawnParkedJet = (jx, jz, yaw, stripeHex) => {
    const jet = new THREE.Group();
    jet.position.set(jx, 0.29, jz);
    jet.rotation.y = yaw;
    jet.userData.studioName = 'Parked jetliner';
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 24, 14), whiteMat);
    body.rotation.x = Math.PI / 2;
    body.position.y = 3.2;
    body.castShadow = true;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(2.1, 4.8, 14), whiteMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 3.2, 14.4);
    const wingL = makeBox(jet, 14.5, 0.35, 4.2, -7.5, 2.8, 1.0, steelMat, { ry: 0.26 });
    makeBox(jet, 14.5, 0.35, 4.2, 7.5, 2.8, 1.0, steelMat, { ry: -0.26 });
    const tailFin = makeBox(jet, 0.45, 5.8, 3.8, 0, 6.2, -10.2, makeMat(stripeHex), { rx: -0.25 });
    makeBox(jet, 8.4, 0.25, 2.2, 0, 3.4, -10.8, steelMat);
    for (const ex of [-5.5, 5.5]) {
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.78, 3.4, 12), makeMat(0x334155, { metalness: 0.85 }));
      eng.rotation.x = Math.PI / 2;
      eng.position.set(ex, 1.9, 2.2);
      jet.add(eng);
    }
    jet.add(body, nose);
    grp.add(jet);
    const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
    const fHX = 2.3 * c + 14.5 * s, fHZ = 2.3 * s + 14.5 * c;
    addWorldBox(jx - fHX, jx + fHX, 0.29, 5.5, jz - fHZ, jz + fHZ, 'parked_jet', false);
    const wHX = 14.5 * c + 2.5 * s, wHZ = 14.5 * s + 2.5 * c;
    addWorldBox(jx - wHX, jx + wHX, 2.5, 3.3, jz - wHZ, jz + wHZ, 'jet_wing', false);
  };
  spawnParkedJet(302, 502, -Math.PI / 2, 0xdc2626);
  spawnParkedJet(302, 622, -Math.PI / 2, 0x0284c7);
  for (const hz of [500, 630]) {
    const hw = 26, hd = 28, hh = 11;
    B(hw, hh, 0.6, steelMat, 442, 0.29 + hh / 2, hz - hd / 2);
    B(hw, hh, 0.6, steelMat, 442, 0.29 + hh / 2, hz + hd / 2);
    B(0.6, hh, hd, steelMat, 442 + hw / 2, 0.29 + hh / 2, hz);
    B(hw + 0.8, 0.6, hd + 0.8, makeMat(0x334155), 442, 0.29 + hh + 0.3, hz);
    addWorldBox(442 - hw / 2, 442 + hw / 2, 0.29, 0.29 + hh, hz - hd / 2, hz - hd / 2 + 0.6, 'hangar_wall', false);
    addWorldBox(442 - hw / 2, 442 + hw / 2, 0.29, 0.29 + hh, hz + hd / 2 - 0.6, hz + hd / 2, 'hangar_wall', false);
    addWorldBox(442 + hw / 2 - 0.6, 442 + hw / 2, 0.29, 0.29 + hh, hz - hd / 2, hz + hd / 2, 'hangar_wall', false);
    addWorldBox(442 - hw / 2, 442 + hw / 2, 0.29 + hh, 0.29 + hh + 0.6, hz - hd / 2, hz + hd / 2, 'hangar_roof', true);
    createNeonSign(grp, hz === 500 ? 'HANGAR 1 • MAINTENANCE' : 'HANGAR 2 • CARGO', 442, 9.4, hz - hd / 2 - 0.4, '#0f172a', '#facc15', 12.0, 1.1);
    enterableZones.push({ minX: 442 - hw / 2 + 1, maxX: 442 + hw / 2 - 1, minZ: hz - hd / 2 + 1, maxZ: hz + hd / 2 - 1, name: 'LAX AIRCRAFT HANGAR' });
    mapShapes.push({ x: 442, z: hz, w: hw, d: hd, color: '#94a3b8', border: '#1e293b', enterable: true });
  }
  // ---- Los Aura Motor Speedway (turn segments batched by material) ---------
  paved(102, 16, asphaltEW, 91, 0.26, 738, 'speedway_access');
  paved(14, 66, asphaltNS, -12, 0.26, 699, 'speedway_access');
  reserveFootprint(40, 142, 730, 746, 'road');
  reserveFootprint(-19, -5, 666, 732, 'road');
  const trackCenterZ = 807, trackRadius = 69, trackW = 18, straightLen = 180, straightMidX = -50;
  paved(straightLen, trackW, runwayMat, straightMidX, 0.27, 738, 'track_surface');
  paved(straightLen, trackW, runwayMat, straightMidX, 0.27, 876, 'track_surface');
  mapShapes.push({ x: straightMidX, z: 738, w: straightLen, d: trackW, color: '#1e293b', border: '#ef4444', enterable: false });
  mapShapes.push({ x: straightMidX, z: 876, w: straightLen, d: trackW, color: '#1e293b', border: '#ef4444', enterable: false });
  B(straightLen, 1.1, 0.7, concreteMat, straightMidX, 0.82, 728.6);
  addWorldBox(-140, 40, 0.26, 1.39, 728.2, 729.0, 'track_wall_s', true);
  B(straightLen, 1.1, 0.7, concreteMat, straightMidX, 0.82, 885.4);
  addWorldBox(-140, 40, 0.26, 1.39, 885.0, 885.8, 'track_wall_n', true);
  const turnSteps = 32;
  const segT = [], curbRedT = [], curbWhiteT = [], wallRedT = [], wallWhiteT = [];
  for (const { cx, startAng, endAng } of [
    { cx: 40, startAng: -Math.PI / 2, endAng: Math.PI / 2 },
    { cx: -140, startAng: Math.PI / 2, endAng: (3 * Math.PI) / 2 }
  ]) {
    for (let i = 0; i < turnSteps; i++) {
      const a0 = startAng + (i / turnSteps) * (endAng - startAng);
      const a1 = startAng + ((i + 1) / turnSteps) * (endAng - startAng);
      const aMid = (a0 + a1) / 2;
      const segLen = Math.abs(a1 - a0) * (trackRadius + trackW / 2) + 1.2;
      const tx = cx + Math.cos(aMid) * trackRadius, tz = trackCenterZ + Math.sin(aMid) * trackRadius;
      xform(segT, tx, 0.23, tz, trackW, 0.08, segLen, 0, -aMid, 0);
      const innerR = trackRadius - trackW / 2 + 0.6;
      const curbX = cx + Math.cos(aMid) * innerR, curbZ = trackCenterZ + Math.sin(aMid) * innerR;
      xform(i % 2 === 0 ? curbRedT : curbWhiteT, curbX, 0.28, curbZ, 1.1, 0.11, segLen * 0.95, 0, -aMid, 0);
      const outerR = trackRadius + trackW / 2 + 0.4;
      const wx = cx + Math.cos(aMid) * outerR, wz = trackCenterZ + Math.sin(aMid) * outerR;
      xform(i % 2 === 0 ? wallRedT : wallWhiteT, wx, 0.82, wz, 0.7, 1.1, segLen, 0, -aMid, 0);
      addWorldBox(wx - 1.2, wx + 1.2, 0.26, 1.39, wz - 1.2, wz + 1.2, 'track_turn_wall', true);
    }
    mapShapes.push({ x: cx, z: trackCenterZ, w: 78, d: 156, color: '#1e293b', border: '#ef4444', enterable: false });
  }
  flushInstances(grp, UNIT_BOX, runwayMat, segT, { recv: true });
  flushInstances(grp, UNIT_BOX, redCurbMat, curbRedT);
  flushInstances(grp, UNIT_BOX, whiteMat, curbWhiteT);
  flushInstances(grp, UNIT_BOX, redCurbMat, wallRedT);
  flushInstances(grp, UNIT_BOX, whiteMat, wallWhiteT);
  const gridWhiteT = [], gridBlackT = [];
  for (let row = 0; row < 2; row++) for (let col = 0; col < 8; col++) {
    xform((row + col) % 2 === 0 ? gridWhiteT : gridBlackT, -51.1 + row * 1.1, 0.28, 730.2 + col * 2.2, 1.1, 0.10, 2.2);
  }
  flushInstances(grp, UNIT_BOX, whiteMat, gridWhiteT);
  flushInstances(grp, UNIT_BOX, makeMat(0x090d14), gridBlackT);
  B(0.5, 7.6, 0.5, steelMat, -50, 4.0, 727.6);
  B(0.5, 7.6, 0.5, steelMat, -50, 4.0, 748.6);
  B(0.5, 0.5, 21.5, steelMat, -50, 7.6, 738);
  createNeonSign(grp, 'LOS AURA MOTOR SPEEDWAY', -50, 6.8, 738, '#090d14', '#ef4444', 14.5, 1.45);
  paved(120, 8, asphaltEW, -50, 0.26, 752, 'pit_lane');
  B(120, 0.75, 0.5, concreteMat, -50, 0.64, 747.6);
  addWorldBox(-110, 10, 0.26, 1.02, 747.3, 747.9, 'pit_wall', true);
  const garageMat = makeMat(0x334155, { texType: 'corrugated', metalness: 0.7 });
  B(96, 0.5, 10, garageMat, -50, 5.0, 761);
  addWorldBox(-98, -2, 4.75, 5.25, 756, 766, 'pit_garage_roof', true);
  B(96, 4.8, 0.5, garageMat, -50, 2.68, 765.75);
  addWorldBox(-98, -2, 0.26, 5.06, 765.5, 766, 'pit_garage_back', false);
  for (let gx = -98; gx <= -2; gx += 16) {
    B(0.5, 4.8, 10, garageMat, gx, 2.68, 761);
    addWorldBox(gx - 0.25, gx + 0.25, 0.26, 5.06, 756, 766, 'pit_garage_wall', false);
  }
  createNeonSign(grp, 'PIT LANE & TEAM GARAGES', -50, 4.4, 755.8, '#1e293b', '#facc15', 14.0, 1.1);
  enterableZones.push({ minX: -98, maxX: -2, minZ: 756, maxZ: 766, name: 'SPEEDWAY PIT GARAGES' });
  for (let tier = 0; tier < 5; tier++) {
    const ty = 0.6 + tier * 1.1, tz = 723 - tier * 1.8;
    B(130, 1.0, 1.8, tier % 2 === 0 ? steelMat : makeMat(0x2563eb), -50, ty, tz);
    addWorldBox(-115, 15, 0.26, ty + 0.5, tz - 0.9, tz + 0.9, 'grandstand_tier', true);
  }
  B(132, 0.4, 11, makeMat(0x0f172a), -50, 7.6, 719);
  mapShapes.push({ x: -50, z: 719, w: 132, d: 11, color: '#2563eb', border: '#f8fafc', enterable: false });
  const stuntAngle = Math.atan2(3.0, 18);
  const stuntMat = makeMat(0xf59e0b);
  makeBox(grp, 18, 0.35, 10, -20, 1.75, 812, stuntMat, { cast: true, rz: stuntAngle });
  addDriveableRamp({ minX: -29, maxX: -11, minZ: 807, maxZ: 817, startY: 0.26, endY: 3.24, axis: 'x', dir: 1 });
  makeBox(grp, 18, 0.35, 10, 8, 1.75, 812, stuntMat, { cast: true, rz: -stuntAngle });
  addDriveableRamp({ minX: -1, maxX: 17, minZ: 807, maxZ: 817, startY: 3.24, endY: 0.26, axis: 'x', dir: 1 });
  buildCarDealership(-85, 812);
  if (register) {
    placeCar(buildSportsCar({ name: 'LOS AURA GT-R #1', bodyHex: 0xdc2626, accentHex: 0xfacc15, x: -58, z: 734.5, yaw: Math.PI / 2, isCoupe: true, isSupercar: true }), 0.27);
    placeCar(buildSportsCar({ name: 'PACIFIC APEX #7', bodyHex: 0x0284c7, accentHex: 0xf8fafc, x: -66, z: 741.5, yaw: Math.PI / 2, isCoupe: true, isSupercar: true }), 0.27);
  }
}

// ============================================================================
// WORLD BOOT (idempotent — safe to rebuild in Studio / Save & Test)
// ============================================================================
function disposeWorldObject(root) {
  const seenGeo = new Set(), seenMat = new Set();
  root.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared && !seenGeo.has(o.geometry)) {
      seenGeo.add(o.geometry);
      o.geometry.dispose();
    }
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      if (!m || m.userData.shared || seenMat.has(m)) continue;
      seenMat.add(m);
      if (m.map && m.map.isCanvasTexture) m.map.dispose();
      if (m.emissiveMap && m.emissiveMap.isCanvasTexture && m.emissiveMap !== m.map) m.emissiveMap.dispose();
      m.dispose();
    }
  });
}
function pruneDetachedHighDetail() {
  for (let i = highDetailObjects.length - 1; i >= 0; i--) {
    let o = highDetailObjects[i], attached = false;
    while (o) { if (o === scene) { attached = true; break; } o = o.parent; }
    if (!attached) highDetailObjects.splice(i, 1);
  }
}
function clearBuiltWorld() {
  disposeTowerInteriors();
  for (const child of [...worldRoot.children]) {
    if (foreignRoots && foreignRoots.has(child)) continue;
    worldRoot.remove(child);
    disposeWorldObject(child);
  }
  resetTowerSystem();
  disposeSignCache();
  barrierChunks.length = 0;
  armory.built = false;
  armory.cases.length = 0;
  armory.dumpster = null;
  armory.hammerMesh = null;
  armory.hammerInDumpster = null;
  armory.alarmLight = null;
  armory.alarmBeacon = null;
  armory.ammoBox = null;
  armory.hasHammer = false;
  armory.dumpsterSearched = false;
  armory.alarm = 0;
  armory.swing = 0;
  airport.board = null;
  airport.boardTex = null;
  airport.boardRows = null;
  airport.carousel = null;
  airport.tick = 0;
  resetWaterSystem();
  riverFlowMats.length = 0;
  lastWaterFrame = -Infinity;
  resetWorldState();
  vehicles.length = 0;
  entityObjects.clear();
  studioObjects.clear();
  studioObjectBaseTransforms.clear();
  studioDeletedObjects.clear();
  sculptableTerrainMeshes.length = 0;
  bio.base = null;
  bio.snow = null;
  bio.last = 'city';
  buildNewBiomes.fire = null;
  buildJungleBiome.waterfall = null;
  buildLosAuraNorthExpansion.wheel = null;
  pruneDetachedHighDetail();
}
export function buildWorld(data = levelData, { register = true, afterStatic = null } = {}) {
  if (!foreignRoots) foreignRoots = new Set(worldRoot.children);
  bindArmoryKey();
  clearBuiltWorld();
  buildRoadsFreewayAndDesert();
  buildRedrockDesertBiome();
  buildNewBiomes();
  buildJungleBiome();
  buildCityLandmarks();
  spawnLevelEntities(data, { register });
  if (afterStatic) afterStatic();
  buildMountains();
  buildSewer();
  buildAuraEstates();
  buildAuraSkylineAndHighway();
  buildCriminalHideout();
  buildLosAuraNorthExpansion(register);
  buildFirearmsArmory();
  buildTowerDistricts();
  buildGroundIntegrity();
  buildOceanSeabed(worldRoot);
  recomputeWorldBounds();
  buildEdgeBarrier();
  registerGeneratedWorldObjects(data);
  recomputeWorldBounds();
}
// Late-bound implementations for lower layers (see state.js / water.js).
Object.assign(hooks, {
  knockOverLamppost,
  updateWater: updateWaterOnce,
  resetWaterSystem,
  getWaterHeightAt,
  getWaterDepthAt,
  isSwimming,
  swimState
});