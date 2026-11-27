// =============================================================================
// worldKit.js — Grand Theft Aura · WORLD COMPILER
//
// The only module that turns world DATA into world GEOMETRY.
//
//   worldData.js      layout rows (what goes where)
//   worldObjects/     prefab definitions (what a thing is)
//   worldKit.js       <-- THIS FILE
//   worldRuntime.js   boot order + public API
//
// DESIGN RULES
//   • Colliders are ALWAYS explicit data. Never inferred from geometry.
//   • One shared unit geometry per primitive; everything else is scale.
//   • Static geometry batches into ONE InstancedMesh per
//     (geometry, material, shadow-policy, tier, chunk).
//   • Per-placement RNG is seeded from hash(id), never the global rnd() stream.
//   • Solids snap to 90° yaw. Decor may rotate freely.
//   • Bad rows are logged and skipped. A malformed row never kills the build.
//
// PREFAB KINDS
//   fixed shape        -> data prefab, batched into InstancedMeshes
//   needs the row      -> data prefab with build(ctx) returning a spec
//   owns runtime state -> registerBuilder (lampPosts, iceZones, vehicles…)
// =============================================================================
import * as THREE from 'three';
import { colorToHex } from './levelData.js';
import {
  addDriveableRamp, addWorldBox, collidesHorizontally, driveableRamps, hooks,
  manholes, terrainH, worldBoxes
} from './state.js';
import { makeMat, worldRoot } from './engine.js';
import { loadTexture } from './assets.js';

// =============================================================================
// SECTION 1 — BUILD SESSION STATE
// =============================================================================
const KIT = {
  building: false,
  chunkSize: 128,
  spawn: [-11.5, 18.5],
  spawnKeepout: 26,
  maxDepth: 8,
  warnLimit: 40
};

let warnings = [];
const seenIds = new Set();
const placements = new Map();
const anchorsById = new Map();
const streamCells = [];
const reservations = [];
const rngCache = new Map();

function warn(msg, ...rest) {
  if (warnings.length < KIT.warnLimit) warnings.push(msg);
  console.warn('[worldKit]', msg, ...rest);
}

/** Reset every per-build accumulator. Call AFTER resetWorldState(). */
export function beginBuild(opts = {}) {
  if (opts.chunkSize) KIT.chunkSize = opts.chunkSize;
  if (opts.spawn) KIT.spawn = opts.spawn;
  if (Number.isFinite(opts.spawnKeepout)) KIT.spawnKeepout = opts.spawnKeepout;
  KIT.building = true;
  warnings = [];
  seenIds.clear();
  placements.clear();
  anchorsById.clear();
  streamCells.length = 0;
  reservations.length = 0;
  rngCache.clear();
  batches.clear();
  chunkGroups.clear();
  index.clear();
  indexedBoxes.clear();
  yawWarned.clear();
  return KIT;
}

export function kitStats() {
  let instances = 0;
  for (const b of batches.values()) instances += b.matrices.length;
  return {
    prefabs: PREFABS.size,
    builders: BUILDERS.size,
    placements: placements.size,
    batches: batches.size,
    instances,
    indexedSolids: indexedBoxes.size,
    indexCells: index.size,
    streamCells: streamCells.length,
    reservations: reservations.length,
    warnings: warnings.slice()
  };
}

// =============================================================================
// SECTION 2 — SHARED GEOMETRY
// =============================================================================
export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
UNIT_BOX.userData.shared = true;

const geoCache = new Map();
const ownedGeos = [];

export function defineGeo(key, factory) {
  if (geoCache.has(key)) return geoCache.get(key);
  const g = factory();
  g.userData.shared = true;
  geoCache.set(key, g);
  ownedGeos.push(g);
  return g;
}

export function geo(key) {
  const g = geoCache.get(key);
  if (!g) { warn(`unknown geometry "${key}" — falling back to box`); return UNIT_BOX; }
  return g;
}

defineGeo('box',     () => UNIT_BOX);
defineGeo('plane',   () => new THREE.PlaneGeometry(1, 1));
defineGeo('cyl',     () => new THREE.CylinderGeometry(0.5, 0.5, 1, 12));
defineGeo('cone',    () => new THREE.ConeGeometry(0.5, 1, 12));
defineGeo('sphere',  () => new THREE.SphereGeometry(0.5, 12, 8));
defineGeo('dodeca',  () => new THREE.DodecahedronGeometry(0.5, 0));
defineGeo('ico',     () => new THREE.IcosahedronGeometry(0.5, 0));
defineGeo('octa',    () => new THREE.OctahedronGeometry(0.5, 0));
defineGeo('torus',   () => new THREE.TorusGeometry(0.5, 0.07, 8, 20));
defineGeo('ring',    () => new THREE.RingGeometry(0.36, 0.5, 24));
defineGeo('capsule', () => new THREE.CapsuleGeometry(0.25, 0.5, 6, 10));

// =============================================================================
// SECTION 3 — MATERIALS
// =============================================================================
const matCache = new Map();
const ownedMats = [];
const PALETTE = new Map();

export function definePalette(entries) {
  for (const [name, spec] of Object.entries(entries)) PALETTE.set(name, spec);
}

/** Named material instances — resolveMat returns these before palette lookup. */
const NAMED_MATERIALS = new Map();
export function defineMaterial(name, material) {
  material.userData.shared = true;
  NAMED_MATERIALS.set(name, material);
  return material;
}

function ownMat(m) {
  m.userData.shared = true;
  ownedMats.push(m);
  return m;
}

/**
 * Resolve a prefab `m` field:
 *   'asphalt'                 -> palette entry
 *   0x313946                  -> plain cached colour
 *   { hex, texType, ...opts } -> cached makeMat
 *   THREE.Material            -> passthrough
 */
export function resolveMat(spec, fallback = 0x94a3b8) {
  if (spec && spec.isMaterial) return spec;
  if (typeof spec === 'string') {
    const named = NAMED_MATERIALS.get(spec);
    if (named) return named;
    const ck = 'p:' + spec;
    if (matCache.has(ck)) return matCache.get(ck);
    const entry = PALETTE.get(spec);
    if (!entry) { warn(`unknown palette material "${spec}"`); return resolveMat(fallback); }
    const m = ownMat(makeMat(colorToHex(entry.hex ?? entry.color, fallback), entry.opts || entry));
    matCache.set(ck, m);
    return m;
  }
  const hex = colorToHex(spec?.hex ?? spec, fallback);
  const opts = (spec && typeof spec === 'object' && !Array.isArray(spec)) ? spec : {};
  const key = 'm:' + hex + ':' + JSON.stringify(opts);
  if (matCache.has(key)) return matCache.get(key);
  const m = ownMat(makeMat(hex, opts));
  matCache.set(key, m);
  return m;
}


// Minimal built-in palette so the kit works before worldObjects loads.
definePalette({
  asphalt:   { hex: 0x313946, texType: 'asphalt', repeatX: 2, repeatY: 24, roughness: 0.86, bumpScale: 0.015 },
  concrete:  { hex: 0xcbd5e1, texType: 'concrete', repeatX: 12, repeatY: 12, roughness: 0.85 },
  sidewalk:  { hex: 0xcbd5e1, texType: 'sidewalk', repeatX: 8, repeatY: 8, roughness: 0.85 },
  plaza:     { hex: 0x94a3b8, texType: 'concrete', repeatX: 14, repeatY: 14, roughness: 0.82 },
  cobble:    { hex: 0xa8a29e, texType: 'cobblestone', repeatX: 6, repeatY: 6, roughness: 0.78 },
  marble:    { hex: 0xf8fafc, texType: 'marble', repeatX: 5, repeatY: 5, roughness: 0.18, clearcoat: 0.85, flatShading: false },
  granite:   { hex: 0x1e293b, texType: 'granite', repeatX: 3, repeatY: 1, roughness: 0.25, flatShading: false },
  steel:     { hex: 0xe2e8f0, texType: 'brushedsteel', metalness: 0.92, roughness: 0.18, flatShading: false },
  chrome:    { hex: 0xf8fafc, texType: 'brushedsteel', metalness: 0.94, roughness: 0.15, flatShading: false },
  dark:      { hex: 0x0f172a, roughness: 0.45, metalness: 0.35 },
  carbon:    { hex: 0x1c1917, roughness: 0.6 },
  wood:      { hex: 0x78350f, texType: 'wood', repeatX: 2, repeatY: 2 },
  woodLight: { hex: 0xb45309, texType: 'wood', repeatX: 2, repeatY: 2 },
  brick:     { hex: 0xb45309, texType: 'brick', repeatX: 4, repeatY: 2, bumpScale: 0.02 },
  siding:    { hex: 0xe2e8f0, texType: 'siding', repeatX: 3, repeatY: 2 },
  fabric:    { hex: 0x334155, texType: 'fabric', roughness: 0.92 },
  gold:      { hex: 0xfbbf24, metalness: 0.94, roughness: 0.15, flatShading: false },
  red:       { hex: 0xdc2626, roughness: 0.5 },
  white:     { hex: 0xf8fafc, roughness: 0.55 },
  glass:     { hex: 0x38bdf8, metalness: 0.85, roughness: 0.08, transparent: true, opacity: 0.26, flatShading: false },
  foliage:   { hex: 0x16a34a, roughness: 0.88 },
  bark:      { hex: 0x78350f, roughness: 0.92 },
  rock:      { hex: 0x5a554d, roughness: 1, flatShading: true },
  redrock:   { hex: 0x9a3412, texType: 'redrock', repeatX: 3, repeatY: 2, roughness: 0.92 },
  sand:      { hex: 0xe8d3a2, texType: 'sand', repeatX: 6, repeatY: 6, roughness: 0.96 }
});

// --- Tiled ground materials --------------------------------------------------
const GROUND_TEXTURES = {
  grass:    loadTexture('assets/textures/grass.png',    { repeatX: 1, repeatY: 1 }),
  dirt:     loadTexture('assets/textures/dirt.png',     { repeatX: 1, repeatY: 1 }),
  rock:     loadTexture('assets/textures/rock.png',     { repeatX: 1, repeatY: 1 }),
  sand:     loadTexture('assets/textures/sand.png',     { repeatX: 1, repeatY: 1 }),
  concrete: loadTexture('assets/textures/concrete.png', { repeatX: 1, repeatY: 1 })
};
for (const tex of Object.values(GROUND_TEXTURES)) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
}
export function groundTexture(kind) { return GROUND_TEXTURES[kind] || GROUND_TEXTURES.grass; }

const groundMatCache = new Map();
export function groundMat(kind, { color = 0xffffff, repeatX = 1, repeatY = 1, roughness = 0.95, metalness = 0 } = {}) {
  const key = `${kind}|${color}|${repeatX}|${repeatY}|${roughness}|${metalness}`;
  if (groundMatCache.has(key)) return groundMatCache.get(key);
  const tex = groundTexture(kind).clone();
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  const m = new THREE.MeshStandardMaterial({ color, map: tex, roughness, metalness });
  m.userData.shared = true;
  groundMatCache.set(key, m);
  return m;
}

// --- Neon signs (cached by text + colours, kit-owned) ------------------------
const signCache = new Map();
export function signMaterials(text, bgHex, textHex) {
  const key = `${text}|${bgHex}|${textHex}`;
  if (signCache.has(key)) return signCache.get(key);
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
  const entry = { faceMat, sideMat, tex };
  signCache.set(key, entry);
  return entry;
}

/** Six-material array for a sign box: sides, then +Z / -Z faces. */
export function signBoxMaterials(text, bgHex, textHex) {
  const { faceMat, sideMat } = signMaterials(text, bgHex, textHex);
  return [sideMat, sideMat, sideMat, sideMat, faceMat, faceMat];
}

// =============================================================================
// SECTION 4 — MESH PRIMITIVES
// =============================================================================
/**
 * makeBox(parent, w, h, d, x, y, z, material, opts)
 * opts: { cast, recv, rx, ry, rz, order, name,
 *         box: ['tag', climbable] | [x0,x1,y0,y1,z0,z1,'tag',climbable] }
 * Colliders are ALWAYS explicit; nothing is derived from the geometry.
 */
export function makeBox(parent, w, h, d, x, y, z, material, o = {}) {
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
    if (b.length === 2) {
      addSolidBox(x - w / 2, x + w / 2, y - h / 2, y + h / 2, z - d / 2, z + d / 2, b[0], b[1]);
    } else {
      addSolidBox(b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]);
    }
  }
  return m;
}

/** Generic shared-geometry mesh with the same explicit-collider contract. */
export function makeMesh(parent, geoKey, material, o = {}) {
  const m = new THREE.Mesh(geo(geoKey), material);
  const p = o.p || [0, 0, 0], s = o.s || [1, 1, 1], r = o.r || [0, 0, 0];
  m.position.set(p[0], p[1], p[2]);
  m.scale.set(s[0], s[1], s[2]);
  m.rotation.set(r[0], r[1], r[2]);
  m.castShadow = !!o.cast;
  m.receiveShadow = !!o.recv;
  if (o.order !== undefined) m.renderOrder = o.order;
  if (o.name) m.userData.studioName = o.name;
  parent.add(m);
  if (o.box) {
    const b = o.box;
    if (b.length === 2) {
      addSolidBox(p[0] - s[0] / 2, p[0] + s[0] / 2,
                  p[1] - s[1] / 2, p[1] + s[1] / 2,
                  p[2] - s[2] / 2, p[2] + s[2] / 2, b[0], b[1]);
    } else {
      addSolidBox(b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]);
    }
  }
  return m;
}

/** Compound builder. parts: [w,h,d, dx,dy,dz, material, opts?]. */
export function buildCompound(parent, bx, bz, parts, by = 0) {
  const out = [];
  for (const p of parts) {
    out.push(makeBox(parent, p[0], p[1], p[2], bx + p[3], by + p[4], bz + p[5], p[6], p[7] || {}));
  }
  return out;
}

/** Instance-matrix accumulator (shared dummy — sequential use only). */
const _dm = new THREE.Object3D();
export function xform(list, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  _dm.position.set(x, y, z);
  _dm.rotation.set(rx, ry, rz);
  _dm.scale.set(sx, sy, sz);
  _dm.updateMatrix();
  list.push(_dm.matrix.clone());
}

export function flushInstances(parent, geometry, material, transforms, { cast = false, recv = false, name = null } = {}) {
  if (!transforms.length) return null;
  const im = new THREE.InstancedMesh(geometry, material, transforms.length);
  transforms.forEach((m, i) => im.setMatrixAt(i, m));
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = cast;
  im.receiveShadow = recv;
  if (name) im.userData.studioName = name;
  if (im.computeBoundingSphere) im.computeBoundingSphere();
  parent.add(im);
  return im;
}

/** Squared planar distance — hot-loop threshold checks (no sqrt). */
export function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

// =============================================================================
// SECTION 5 — CHUNKED INSTANCE BATCHING
// =============================================================================
const batches = new Map();
const chunkGroups = new Map();
let objIds = new WeakMap();
let nextObjId = 1;

function idOf(o) {
  let id = objIds.get(o);
  if (id === undefined) { id = nextObjId++; objIds.set(o, id); }
  return id;
}
function chunkCoord(v) { return Math.floor(v / KIT.chunkSize); }

function chunkGroup(cx, cz, tier) {
  const key = `${cx}|${cz}|${tier}`;
  let g = chunkGroups.get(key);
  if (g) return g;
  g = new THREE.Group();
  g.userData.studioName = `chunk ${cx},${cz}${tier === 'base' ? '' : ' [' + tier + ']'}`;
  g.userData.studioSelectable = false;
  g.userData.worldBuilt = true;
  chunkGroups.set(key, g);
  return g;
}

/** Queue one static instance into the world batch. */
export function inst(geometry, material, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, o = {}) {
  const cast = !!o.cast, recv = !!o.recv, tier = o.tier || 'base';
  const cx = chunkCoord(x), cz = chunkCoord(z);
  const key = `${idOf(geometry)}|${idOf(material)}|${cast ? 1 : 0}${recv ? 1 : 0}|${tier}|${cx}|${cz}`;
  let b = batches.get(key);
  if (!b) {
    b = {
      geometry, material, cast, recv, tier, cx, cz, matrices: [],
      minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity
    };
    batches.set(key, b);
  }
  _dm.position.set(x, y, z);
  _dm.rotation.set(rx, ry, rz);
  _dm.scale.set(sx, sy, sz);
  _dm.updateMatrix();
  b.matrices.push(_dm.matrix.clone());
  if (x < b.minX) b.minX = x;
  if (x > b.maxX) b.maxX = x;
  if (z < b.minZ) b.minZ = z;
  if (z > b.maxZ) b.maxZ = z;
}

/** Same, but from an already-composed world matrix. */
export function instMatrix(geometry, material, matrix, o = {}) {
  _dm.matrix.copy(matrix);
  _dm.matrix.decompose(_dm.position, _dm.quaternion, _dm.scale);
  const e = new THREE.Euler().setFromQuaternion(_dm.quaternion, 'YXZ');
  inst(geometry, material, _dm.position.x, _dm.position.y, _dm.position.z,
       _dm.scale.x, _dm.scale.y, _dm.scale.z, e.x, e.y, e.z, o);
}

/** Materialise every queued batch. Call once at the end of the static pass. */
export function flushWorld(parent = worldRoot) {
  let meshes = 0, instances = 0;
  const tiered = new Map();

  for (const b of batches.values()) {
    if (!b.matrices.length) continue;
    const g = chunkGroup(b.cx, b.cz, b.tier);
    if (!g.parent) parent.add(g);
    const im = flushInstances(g, b.geometry, b.material, b.matrices, { cast: b.cast, recv: b.recv });
    if (im) { meshes++; instances += b.matrices.length; }

    if (b.tier !== 'base') {
      const key = `${b.cx}|${b.cz}|${b.tier}`;
      let t = tiered.get(key);
      if (!t) {
        t = { cx: b.cx, cz: b.cz, tier: b.tier, group: g,
              minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
        tiered.set(key, t);
      }
      t.minX = Math.min(t.minX, b.minX); t.maxX = Math.max(t.maxX, b.maxX);
      t.minZ = Math.min(t.minZ, b.minZ); t.maxZ = Math.max(t.maxZ, b.maxZ);
    }
  }

  // ONE cell per (chunk, tier) — never one per material, or they fight over
  // the same group's visibility.
  for (const t of tiered.values()) {
    registerStreamCell({
      id: `chunk:${t.cx},${t.cz}:${t.tier}`,
      x: (t.minX + t.maxX) / 2, z: (t.minZ + t.maxZ) / 2, y: 0,
      r: Math.max(48, Math.hypot(t.maxX - t.minX, t.maxZ - t.minZ) / 2 + 32),
      mode: 'lod', group: t.group, boxes: [], tier: t.tier
    });
  }

  batches.clear();
  return { meshes, instances };
}

// =============================================================================
// SECTION 6 — COLLIDER SPATIAL HASH
// =============================================================================
const CELL = 24;
const index = new Map();
const indexedBoxes = new Set();
const boxCells = new WeakMap();

function cellKey(cx, cz) { return (cx + 32768) * 65536 + (cz + 32768); }

/** Register a solid. Same argument order and return as state.addWorldBox. */
export function addSolidBox(x0, x1, y0, y1, z0, z1, tag, climbable) {
  const box = addWorldBox(x0, x1, y0, y1, z0, z1, tag, climbable);
  indexBox(box);
  return box;
}

export function indexBox(box) {
  if (!box || indexedBoxes.has(box)) return box;
  const cx0 = Math.floor(box.minX / CELL), cx1 = Math.floor(box.maxX / CELL);
  const cz0 = Math.floor(box.minZ / CELL), cz1 = Math.floor(box.maxZ / CELL);
  const keys = [];
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cz = cz0; cz <= cz1; cz++) {
      const k = cellKey(cx, cz);
      let arr = index.get(k);
      if (!arr) { arr = []; index.set(k, arr); }
      arr.push(box);
      keys.push(k);
    }
  }
  boxCells.set(box, keys);
  indexedBoxes.add(box);
  return box;
}

/** Index anything already in worldBoxes (legacy builders, entities). */
export function reindexAll() {
  index.clear();
  indexedBoxes.clear();
  for (const b of worldBoxes) indexBox(b);
  return indexedBoxes.size;
}

export function unindexBox(box) {
  const keys = boxCells.get(box);
  if (keys) {
    for (const k of keys) {
      const arr = index.get(k);
      if (!arr) continue;
      const i = arr.indexOf(box);
      if (i !== -1) arr.splice(i, 1);
      if (!arr.length) index.delete(k);
    }
    boxCells.delete(box);
  }
  indexedBoxes.delete(box);
}

/** Remove a solid from worldBoxes AND the index. Always use this, never splice. */
export function removeSolidBox(box) {
  if (!box) return;
  const i = worldBoxes.indexOf(box);
  if (i !== -1) worldBoxes.splice(i, 1);
  unindexBox(box);
}

export function removeSolidBoxes(boxes) {
  if (!boxes) return;
  for (const b of boxes) removeSolidBox(b);
  boxes.length = 0;
}

const _qout = [];
/**
 * Candidate solids overlapping the XZ box around (x,z) with radius r.
 * May contain duplicates for multi-cell boxes — harmless for overlap tests
 * and max-height queries, and cheaper than de-duplicating.
 *
 * RETURNS A REUSED SCRATCH ARRAY. Never hold it across another query.
 * THE CALLER STILL APPLIES ITS OWN EXACT TEST.
 */
export function queryBoxes(x, z, r) {
  _qout.length = 0;
  const cx0 = Math.floor((x - r) / CELL), cx1 = Math.floor((x + r) / CELL);
  const cz0 = Math.floor((z - r) / CELL), cz1 = Math.floor((z + r) / CELL);
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cz = cz0; cz <= cz1; cz++) {
      const arr = index.get(cellKey(cx, cz));
      if (arr) for (let i = 0; i < arr.length; i++) _qout.push(arr[i]);
    }
  }
  return _qout;
}

/** Reference overlap test — mirrors state.js semantics. */
export function collidesAt(x, z, y, h, r) {
  const y1 = y + h;
  for (const b of queryBoxes(x, z, r)) {
    if (b.minX < x + r && b.maxX > x - r &&
        b.minZ < z + r && b.maxZ > z - r &&
        b.minY < y1 && b.maxY > y) return true;
  }
  return false;
}

/** Reference support query — highest top at or below maxY under (x,z). */
export function supportFloorAt(x, z, maxY, r) {
  let best = 0;
  for (const b of queryBoxes(x, z, r)) {
    if (b.maxY > maxY) continue;
    if (b.minX < x + r && b.maxX > x - r && b.minZ < z + r && b.maxZ > z - r) {
      if (b.maxY > best) best = b.maxY;
    }
  }
  return best;
}

/** Publish the candidate query so state.js opts in without a static import. */
export function installColliderIndex() {
  hooks.queryWorldBoxes = queryBoxes;
  reindexAll();
  return indexedBoxes.size;
}

// =============================================================================
// SECTION 7 — RESERVED FOOTPRINTS & PLACEMENT VALIDATION
// =============================================================================
export function reserveFootprint(minX, maxX, minZ, maxZ, tag = 'reserved') {
  reservations.push({ minX, maxX, minZ, maxZ, tag });
}
export function clearReservations() { reservations.length = 0; }

/** True when a w×d footprint at (cx,cz) is clear of roads, props and the spawn. */
export function footprintClear(cx, cz, w, d, pad = 2.5) {
  const x0 = cx - w / 2 - pad, x1 = cx + w / 2 + pad;
  const z0 = cz - d / 2 - pad, z1 = cz + d / 2 + pad;
  for (let i = 0; i < reservations.length; i++) {
    const r = reservations[i];
    if (x0 < r.maxX && x1 > r.minX && z0 < r.maxZ && z1 > r.minZ) return false;
  }
  const stepX = Math.max(2, w / Math.max(1, Math.ceil(w / 4)));
  const stepZ = Math.max(2, d / Math.max(1, Math.ceil(d / 4)));
  for (let a = -w / 2; a <= w / 2 + 0.01; a += stepX) {
    for (let b = -d / 2; b <= d / 2 + 0.01; b += stepZ) {
      if (collidesHorizontally(cx + a, cz + b, 0.2, 1.8, 1.2)) return false;
    }
  }
  const mr = Math.max(w, d);
  for (const m of manholes) if (dist2(cx, cz, m[0], m[1]) < mr * mr) return false;
  if (dist2(cx, cz, KIT.spawn[0], KIT.spawn[1]) < KIT.spawnKeepout * KIT.spawnKeepout) return false;
  return true;
}

function isCompactSquareSolid(b, sp) {
  if (sp?.snapYaw !== undefined) return !!sp.snapYaw;
  const sx = Math.abs(b[1] - b[0]);
  const sz = Math.abs(b[5] - b[4]);
  return Math.abs(sx - sz) <= 0.25 && Math.max(sx, sz) <= 3.0;
}

const yawWarned = new Set();
function checkYaw(id, ry, solids, prefabId = id, solidDisabled = false) {
  if (solidDisabled || !ry || !solids || !solids.length) return true;
  const q = Math.abs(ry / (Math.PI / 2));
  const snapped = Math.abs(q - Math.round(q)) < 1e-4;
  if (snapped) return true;

  const hasInflatableSolid = solids.some((sp) => !isCompactSquareSolid(solidLocalAABB(sp), sp));
  if (!hasInflatableSolid) return true;

  if (!yawWarned.has(prefabId)) {
    yawWarned.add(prefabId);
    warn(`"${prefabId}" (e.g. "${id}") has elongated solids at a non-90° yaw — collider AABB will be inflated. Snap solids, rotate decor only.`);
  }
  return false;
}

// =============================================================================
// SECTION 8 — DETERMINISTIC PER-PLACEMENT RNG
// =============================================================================
function hashStr(s) {
  let h = 2166136261 >>> 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Stable RNG for a placement id. Adding content elsewhere never perturbs it. */
export function rngFor(id) {
  if (rngCache.has(id)) return rngCache.get(id);
  const r = mulberry32(hashStr(id));
  rngCache.set(id, r);
  return r;
}
export function pickFrom(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }
export function rangeFrom(rng, a, b) { return a + rng() * (b - a); }

// =============================================================================
// SECTION 9 — TRANSFORMS
// =============================================================================
/** Placement transform: uniform scale + yaw only. Solids stay axis-aligned. */
export function xfFromRow(row) {
  const at = row.at || [0, 0, 0];
  const x = Number(at[0]) || 0;
  const z = Number(at[1]) || 0;
  const y = Number.isFinite(at[2]) ? at[2]
    : Number.isFinite(row.y) ? row.y
    : Number.isFinite(row.baseY) ? row.baseY : 0;
  return { x, y, z, ry: Number(row.ry) || 0, s: Number(row.s ?? row.scale) || 1 };
}

export function composeXf(parent, local) {
  const c = Math.cos(parent.ry), s = Math.sin(parent.ry);
  const lx = (local.x || 0) * parent.s, lz = (local.z || 0) * parent.s;
  return {
    x: parent.x + lx * c + lz * s,
    y: parent.y + (local.y || 0) * parent.s,
    z: parent.z - lx * s + lz * c,
    ry: parent.ry + (local.ry || 0),
    s: parent.s * (local.s ?? 1)
  };
}

/** Local point -> world point under a placement transform. */
export function xfPoint(xf, p) {
  const c = Math.cos(xf.ry), s = Math.sin(xf.ry);
  const lx = (p[0] || 0) * xf.s, ly = (p[1] || 0) * xf.s, lz = (p[2] || 0) * xf.s;
  return [xf.x + lx * c + lz * s, xf.y + ly, xf.z - lx * s + lz * c];
}

/** World point -> local point (inverse of xfPoint). */
export function xfInversePoint(xf, p) {
  const dx = p[0] - xf.x, dy = p[1] - xf.y, dz = p[2] - xf.z;
  const c = Math.cos(xf.ry), s = Math.sin(xf.ry);
  return [(dx * c - dz * s) / xf.s, dy / xf.s, (dx * s + dz * c) / xf.s];
}

/** Local AABB -> world AABB (exact at 90° yaw; compact square solids auto-snap). */
function xfBox(xf, b, snap = false) {
  const ry = snap ? Math.round(xf.ry / (Math.PI / 2)) * (Math.PI / 2) : xf.ry;
  const c = Math.cos(ry), s = Math.sin(ry);
  const ex = (Math.abs(b[1] - b[0]) / 2) * xf.s;
  const ez = (Math.abs(b[5] - b[4]) / 2) * xf.s;
  const mx = (b[0] + b[1]) / 2, mz = (b[4] + b[5]) / 2;
  const w = xfPoint(xf, [mx, 0, mz]);
  const hx = ex * Math.abs(c) + ez * Math.abs(s);
  const hz = ex * Math.abs(s) + ez * Math.abs(c);
  const y0 = xf.y + Math.min(b[2], b[3]) * xf.s;
  const y1 = xf.y + Math.max(b[2], b[3]) * xf.s;
  return [w[0] - hx, w[0] + hx, y0, y1, w[2] - hz, w[2] + hz];
}

/** Normalise a solid spec ({p,s} or {b}) into a local AABB. */
function solidLocalAABB(sp) {
  if (sp.b) return sp.b;
  const p = sp.p || [0, 0, 0], s = sp.s || [1, 1, 1];
  return [p[0] - s[0] / 2, p[0] + s[0] / 2,
          p[1] - s[1] / 2, p[1] + s[1] / 2,
          p[2] - s[2] / 2, p[2] + s[2] / 2];
}

// =============================================================================
// SECTION 10 — PREFAB REGISTRY
// =============================================================================
const PREFABS = new Map();
const BUILDERS = new Map();

/**
 * def = {
 *   kind: 'prop'|'building'|'interior'|'surface',
 *   footprint: [w,d] | (row) => [w,d],
 *   validate: bool, selectable: bool,
 *   parts:    [{ g, m, p:[x,y,z], s:[w,h,d], r:[rx,ry,rz], cast, recv, tier, name }],
 *   solids:   [{ b:[x0,x1,y0,y1,z0,z1] | p,s, tag, climb }],
 *   repeat:   [{ ref, from, step, count, ry, ryStep, s, jitter }],
 *   instances:[{ ref, at, ry, s }],
 *   anchors:  { name:[x,y,z] },
 *   stream:   { r, band },
 *   build:    (ctx) => spec     // PARAMETRIC: ctx carries the whole row + w/d/rng/xf
 * }
 */
export function definePrefab(id, def) {
  if (PREFABS.has(id)) warn(`prefab "${id}" redefined`);
  PREFABS.set(id, { id, ...def });
  return PREFABS.get(id);
}
export function definePrefabs(map) {
  for (const [id, def] of Object.entries(map)) definePrefab(id, def);
}
export function getPrefab(id) { return PREFABS.get(id) || null; }
export function hasPrefab(id) { return PREFABS.has(id) || BUILDERS.has(id); }

/**
 * Register a builder as a prefab. fn(row, ctx) where ctx carries the kit.
 * Return a THREE.Object3D, or { object, boxes, anchors, ...extra }.
 * Extra fields are preserved on record.data for worldSystems to consume.
 */
export function registerBuilder(id, fn, meta = {}) {
  BUILDERS.set(id, { id, fn, ...meta });
}
export function getBuilder(id) { return BUILDERS.get(id) || null; }

// =============================================================================
// SECTION 11 — THE COMPILER
// =============================================================================
function expandRepeat(rep, rng) {
  const out = [];
  const n = Math.max(0, Math.floor(rep.count || 0));
  const from = rep.from || [0, 0, 0];
  const step = rep.step || [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const j = rep.jitter || 0;
    out.push({
      ref: rep.ref,
      at: [
        from[0] + step[0] * i + (j ? (rng() - 0.5) * j : 0),
        from[1] + step[1] * i,
        from[2] + step[2] * i + (j ? (rng() - 0.5) * j : 0)
      ],
      ry: (rep.ry || 0) + (rep.ryStep || 0) * i,
      s: rep.s ?? 1
    });
  }
  return out;
}

/**
 * Flatten a prefab into world-space parts / solids / anchors.
 * `row` is the layout row (or a {w,d} shim from the streamer). Parametric
 * prefabs receive it through build(ctx); fixed prefabs ignore it.
 */
export function compilePrefab(id, xf, out, rng, depth = 0, selectable = false, row = null) {
  if (depth > KIT.maxDepth) { warn(`prefab recursion cap hit at "${id}"`); return out; }
  const def = PREFABS.get(id);
  if (!def) { warn(`unknown prefab "${id}"`); return out; }

  // Parametric prefabs describe themselves per row; fixed ones ARE the spec.
  let spec = def;
  if (typeof def.build === 'function') {
    spec = def.build({
      ...(row || {}), id, xf, rng, s: xf.s,
      w: row?.w ?? def.w ?? 16,
      d: row?.d ?? def.d ?? 16,
      geo, resolveMat, pickFrom, rangeFrom
    }) || def;
  }

  // --- parts ---------------------------------------------------------------
  for (const part of spec.parts || []) {
    const w = xfPoint(xf, part.p || [0, 0, 0]);
    const s = part.s || [1, 1, 1];
    const r = part.r || [0, 0, 0];
    out.parts.push({
      geometry: geo(part.g || 'box'),
      material: resolveMat(part.m),
      x: w[0], y: w[1], z: w[2],
      sx: s[0] * xf.s, sy: s[1] * xf.s, sz: s[2] * xf.s,
      rx: r[0], ry: xf.ry + r[1], rz: r[2],
      cast: !!part.cast, recv: !!part.recv,
      tier: row?.tier || part.tier || 'base',
      name: part.name || null
    });
  }

  // --- solids (row.solid === false opts the whole placement out) -----------
  if (row?.solid !== false) {
    const solids = spec.solids || [];
    if (typeof def.build === 'function' && solids.length) {
      checkYaw(row?.id || id, xf.ry, solids, id, false);
    }
    for (const sp of solids) {
      const b = solidLocalAABB(sp);
      out.solids.push({
        b: xfBox(xf, b, isCompactSquareSolid(b, sp)),
        tag: sp.tag || 'prefab_solid',
        climb: sp.climb !== false
      });
    }
  }

  // --- anchors -------------------------------------------------------------
  for (const [name, p] of Object.entries(spec.anchors || {})) {
    out.anchors[name] = xfPoint(xf, p);
  }

  // --- nested instances (children are fixed kits — never forward the row) --
  const children = [...(spec.instances || [])];
  for (const rep of spec.repeat || []) children.push(...expandRepeat(rep, rng));
  for (const child of children) {
    if (!child.ref) continue;
    const a = child.at || [0, 0, 0];
    const childXf = composeXf(xf, { x: a[0], y: a[1], z: a[2], ry: child.ry || 0, s: child.s ?? 1 });
    if (BUILDERS.get(child.ref)) { out.nested.push({ id: child.ref, xf: childXf }); continue; }
    compilePrefab(child.ref, childXf, out, rng, depth + 1, selectable, null);
  }
  return out;
}

function newOut() { return { parts: [], solids: [], anchors: {}, nested: [] }; }

// =============================================================================
// SECTION 12 — PLACEMENT PIPELINE
// =============================================================================
export function registerStreamCell(cell) {
  streamCells.push(cell);
  if (hooks.worldStreamRegister) hooks.worldStreamRegister(cell);
  return cell;
}
export function getStreamCells() { return streamCells; }

function shouldValidate(row, def) {
  if (row.validate === false) return false;
  if (row.validate === true) return true;
  if (def?.validate !== undefined) return def.validate;
  return def?.kind === 'building';
}

function resolveFootprint(row, def, builder) {
  if (row.footprint) return row.footprint;
  const fp = def?.footprint ?? builder?.footprint;
  return typeof fp === 'function' ? fp(row) : fp;
}

/** Full builder context. `parent` is the group/world root the row places into. */
function builderCtx(row, id, xf, rng, parent) {
  return {
    rng, xf, row, id, parent, THREE,
    place, compile: compilePrefab,
    makeBox, makeMesh, buildCompound, inst, instMatrix, xform, flushInstances,
    addSolidBox, removeSolidBox, removeSolidBoxes, addRamp, removeRamp,
    reserveFootprint, footprintClear,
    resolveMat, groundMat, geo, signBoxMaterials, signMaterials,
    dist2, pickFrom, rangeFrom
  };
}

/**
 * Place one layout row. Returns a record, or null if the row was rejected.
 * Never throws — a malformed row is logged and skipped.
 */
export function place(row, parent = worldRoot) {
  try {
    if (!row || !row.prefab) { warn('row without prefab', row); return null; }
    const id = row.id || `${row.prefab}@${(row.at || []).join(',')}`;
    if (seenIds.has(id)) { warn(`duplicate placement id "${id}" — skipped`); return null; }

    const def = PREFABS.get(row.prefab);
    const builder = BUILDERS.get(row.prefab);
    if (!def && !builder) { warn(`unknown prefab "${row.prefab}" (id "${id}")`); return null; }

    const xf = xfFromRow(row);
    if (!Number.isFinite(xf.x) || !Number.isFinite(xf.z)) { warn(`bad coords on "${id}"`); return null; }

    // --- validation --------------------------------------------------------
    const fp = resolveFootprint(row, def, builder);
    if (fp && shouldValidate(row, def || builder)) {
      const c = Math.abs(Math.cos(xf.ry)), s = Math.abs(Math.sin(xf.ry));
      const w = (fp[0] * c + fp[1] * s) * xf.s;
      const d = (fp[0] * s + fp[1] * c) * xf.s;
      if (!footprintClear(xf.x, xf.z, w, d, row.pad ?? 2.5)) {
        warn(`lot rejected (blocked): ${id} @ ${xf.x},${xf.z}`);
        return null;
      }
    }
    checkYaw(id, xf.ry, def?.solids, row.prefab, row.solid === false);

    seenIds.add(id);
    const rng = rngFor(id);
    const rec = { id, prefab: row.prefab, xf, row, object: null, boxes: [], anchors: {}, instances: 0, data: null };

    // --- builder path ------------------------------------------------------
    if (builder) {
      const result = builder.fn(row, builderCtx(row, id, xf, rng, parent));
      if (result && result.isObject3D) {
        rec.object = result;
      } else if (result) {
        rec.object = result.object || null;
        rec.boxes = result.boxes || [];
        rec.anchors = result.anchors || {};
        rec.data = result;   // runtime handles for worldSystems/*
      }
      if (rec.object) {
        rec.object.userData.studioKey = `static:${id}`;
        rec.object.userData.studioName = rec.object.userData.studioName || row.name || id;
      }
      placements.set(id, rec);
      if (Object.keys(rec.anchors).length) anchorsById.set(id, rec.anchors);
      return rec;
    }

    // --- data prefab path --------------------------------------------------
    const selectable = row.selectable === true || def.selectable === true || def.kind === 'interior';
    const out = compilePrefab(row.prefab, xf, newOut(), rng, 0, selectable, row);

    if (selectable) {
      // Real meshes so Studio can grab this placement individually.
      const g = new THREE.Group();
      g.position.set(xf.x, xf.y, xf.z);
      g.rotation.y = xf.ry;
      g.userData.studioName = row.name || id;
      g.userData.studioKey = `static:${id}`;
      for (const p of out.parts) {
        const lp = xfInversePoint(xf, [p.x, p.y, p.z]);
        const m = new THREE.Mesh(p.geometry, p.material);
        m.position.set(lp[0], lp[1], lp[2]);
        m.scale.set(p.sx / xf.s, p.sy / xf.s, p.sz / xf.s);
        m.rotation.set(p.rx, p.ry - xf.ry, p.rz);
        m.castShadow = p.cast;
        m.receiveShadow = p.recv;
        if (p.name) m.userData.studioName = p.name;
        g.add(m);
      }
      parent.add(g);
      rec.object = g;
    } else {
      for (const p of out.parts) {
        inst(p.geometry, p.material, p.x, p.y, p.z, p.sx, p.sy, p.sz, p.rx, p.ry, p.rz,
             { cast: p.cast, recv: p.recv, tier: p.tier });
        rec.instances++;
      }
    }

    for (const sp of out.solids) {
      rec.boxes.push(addSolidBox(sp.b[0], sp.b[1], sp.b[2], sp.b[3], sp.b[4], sp.b[5], sp.tag, sp.climb));
    }
    rec.anchors = out.anchors;
    if (Object.keys(out.anchors).length) anchorsById.set(id, out.anchors);

    // Nested builders discovered inside the data prefab.
    for (const n of out.nested) {
      const nb = BUILDERS.get(n.id);
      if (!nb) { warn(`unknown nested builder "${n.id}"`); continue; }
      const nrow = { ...row, id: `${id}/${n.id}`, at: [n.xf.x, n.xf.z], y: n.xf.y, ry: n.xf.ry, s: n.xf.s };
      nb.fn(nrow, builderCtx(nrow, nrow.id, n.xf, rng, parent));
    }

    // --- interiors become stream cells, not always-resident geometry -------
    if (def.stream || def.kind === 'interior') {
      // Hand collider ownership to the streamer: detach here so neither the
      // old nor the new worldStream can double-register them on first load.
      const handover = rec.boxes.slice();
      removeSolidBoxes(rec.boxes);
      if (rec.object && rec.object.parent) rec.object.parent.remove(rec.object);
      registerStreamCell({
        id, x: xf.x, y: xf.y, z: xf.z,
        r: def.stream?.r ?? 56,
        band: def.stream?.band ?? 0,
        mode: 'stream', tier: 'interior',
        group: rec.object, boxes: handover
      });
    }

    placements.set(id, rec);
    return rec;
  } catch (err) {
    console.error('[worldKit] placement failed:', row && row.id, err);
    return null;
  }
}

export function placeAll(rows, parent = worldRoot) {
  let built = 0;
  for (const row of rows || []) if (place(row, parent)) built++;
  return { built, total: (rows || []).length, rejected: (rows || []).length - built };
}

export function getPlacement(id) { return placements.get(id) || null; }
export function allPlacements() { return placements; }

/** World position of a named anchor on a placed prefab. */
export function anchor(id, name) {
  const a = anchorsById.get(id);
  return a ? (a[name] || null) : null;
}

// =============================================================================
// SECTION 13 — DRIVEABLE RAMPS
// =============================================================================
export function addRamp(spec) { return addDriveableRamp(spec); }
export function removeRamp(ref) {
  const i = driveableRamps.indexOf(ref);
  if (i !== -1) driveableRamps.splice(i, 1);
}

// =============================================================================
// SECTION 14 — DISPOSAL
// =============================================================================
/** Dispose a subtree, skipping kit-owned shared geometry/materials. */
export function disposeTree(root) {
  if (!root) return;
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

/** Release everything the kit owns. Full teardown only, not per rebuild. */
export function disposeKit() {
  for (const g of ownedGeos) if (g !== UNIT_BOX) g.dispose();
  ownedGeos.length = 0;
  geoCache.clear();
  defineGeo('box', () => UNIT_BOX);

  for (const m of ownedMats) {
    if (m.map && m.map.isCanvasTexture) m.map.dispose();
    m.dispose();
  }
  ownedMats.length = 0;
  matCache.clear();
  PALETTE.clear();
  NAMED_MATERIALS.clear();


  for (const m of groundMatCache.values()) { if (m.map) m.map.dispose(); m.dispose(); }
  groundMatCache.clear();

  for (const { faceMat, sideMat, tex } of signCache.values()) {
    tex.dispose(); faceMat.dispose(); sideMat.dispose();
  }
  signCache.clear();

  batches.clear();
  chunkGroups.clear();
  index.clear();
  indexedBoxes.clear();
  objIds = new WeakMap();
  nextObjId = 1;
}

/** Per-rebuild reset that keeps cached materials (reused every build). */
export function resetKitSession() {
  batches.clear();
  chunkGroups.clear();
  index.clear();
  indexedBoxes.clear();
  placements.clear();
  anchorsById.clear();
  seenIds.clear();
  streamCells.length = 0;
  reservations.length = 0;
  rngCache.clear();
  yawWarned.clear();
  warnings = [];
}

// =============================================================================
// SECTION 15 — CATALOG GENERATION
// =============================================================================
/**
 * Regenerate the <catalog> block at the top of worldData.js so the vocabulary
 * an AI reads can never drift from what the compiler actually accepts.
 */
export function generateCatalog() {
  const lines = [];
  lines.push('// <catalog generated="true">  DO NOT EDIT — regenerate with `npm run catalog`');
  lines.push('// -----------------------------------------------------------------------------');

  const groups = new Map();
  for (const def of PREFABS.values()) {
    const kind = (def.kind || 'misc').toUpperCase();
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push(def);
  }
  for (const [kind, defs] of [...groups.entries()].sort()) {
    lines.push(`// ${kind}`);
    for (const def of defs.sort((a, b) => a.id.localeCompare(b.id))) {
      const params = (def.params || []).join(', ');
      const fp = Array.isArray(def.footprint) ? ` ${def.footprint[0]}×${def.footprint[1]}` : '';
      const flags = [];
      if (def.solids?.length) flags.push('solid');
      if (def.build) flags.push('parametric');
      if (def.selectable) flags.push('selectable');
      if (def.kind === 'interior') flags.push('streamed');
      if (def.anchors && Object.keys(def.anchors).length) flags.push('anchors: ' + Object.keys(def.anchors).join('|'));
      lines.push(`//   ${def.id.padEnd(20)} { ${params} }${fp}${flags.length ? ' · ' + flags.join(' · ') : ''}`);
      if (def.doc) lines.push(`//     ${def.doc}`);
    }
    lines.push('//');
  }

  if (BUILDERS.size) {
    lines.push('// BUILDER-BACKED');
    for (const b of [...BUILDERS.values()].sort((a, b2) => a.id.localeCompare(b2.id))) {
      const params = (b.params || []).join(', ');
      const fp = Array.isArray(b.footprint) ? ` ${b.footprint[0]}×${b.footprint[1]}` : '';
      lines.push(`//   ${b.id.padEnd(20)} { ${params} }${fp}`);
      if (b.doc) lines.push(`//     ${b.doc}`);
    }
    lines.push('//');
  }

  lines.push('// RULES: every placement is validated against reserved footprints + colliders.');
  lines.push('//        ids must be unique and stable. ry snaps to 90° for solids.');
  lines.push('//        scatter/avoid bounds are [x0,z0,x1,z1]; water/patch/panel are [x0,x1,z0,z1].');
  lines.push('// </catalog>');
  return lines.join('\n');
}

// =============================================================================
// SECTION 16 — CONVENIENCE RE-EXPORTS
// =============================================================================
export { THREE, worldRoot, makeMat, terrainH };

export const kit = {
  beginBuild, flushWorld, resetKitSession, disposeKit, kitStats,
  place, placeAll, anchor, getPlacement, allPlacements,
  definePrefab, definePrefabs, getPrefab, hasPrefab, registerBuilder, getBuilder,
  definePalette, defineGeo, geo,
  makeBox, makeMesh, buildCompound, xform, flushInstances, inst, instMatrix,
  addSolidBox, removeSolidBox, removeSolidBoxes, queryBoxes, reindexAll, installColliderIndex,
  reserveFootprint, footprintClear, rngFor, pickFrom, rangeFrom, generateCatalog,
  groundMat, groundTexture, resolveMat, signMaterials, signBoxMaterials, disposeTree,
  addRamp, removeRamp, registerStreamCell, getStreamCells
};

export default kit;