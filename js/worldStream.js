// =============================================================================
// worldStream.js — ONE distance/height streamer for the whole world.
//
// Replaces three separate systems:
//   • registerBuildingLod / updateBuildingLods   (visibility LOD)
//   • aura.culls                                (visibility culls)
//   • updateSkyscraperInteriors                 (lobby load/unload + colliders)
//
// Adds:
//   • LAZY prefab compilation — a cell's geometry does not exist until you
//     walk near it, and is cached after the first visit.
//   • VERTICAL bands — a 24-floor tower only pays for the floor you are on
//     plus its neighbours, no matter how many floors exist.
//   • Bucketed cell index for loads, an ACTIVE SET for unloads. Both are
//     required: a cell you walked away from is no longer in your bucket, so
//     scanning only the bucket would never unload it.
//   • Load/unload budget with urgent bypass, so streaming never hitches and
//     never drops the floor out from under the player.
//
// CELL MODES
//   'stream'  group parented on load, detached on unload; colliders follow.
//   'lod'     group stays parented; only .visible toggles (cheap).
//   'inverse' visible when FAR (distant shell tier). Swept separately, because
//             a far cell is by definition never in the player's bucket.
//
// COLLIDER OWNERSHIP
//   A 'stream' cell handed `boxes` TAKES OWNERSHIP of them. They are removed
//   from worldBoxes at registration and re-added on every activate(). This is
//   what prevents the double-registration bug when worldKit hands over an
//   interior it already built.
// =============================================================================
import * as THREE from 'three';
import { aura, buildingLods, hooks, player, skyscrapers } from './state.js';
import { worldRoot } from './engine.js';
import {
  addSolidBox, compilePrefab, dist2, getStreamCells, removeSolidBoxes, rngFor
} from './worldKit.js';

const CELL = 96;                        // spatial bucket size (metres)
const buckets = new Map();              // bucketKey -> cell[]
const cells = new Map();                // id -> cell
const active = new Set();               // every loaded cell (unload sweep)
const inverse = new Set();              // far-tier cells (distance toggle)

let opts = {
  loadPerFrame: 3,
  unloadPerFrame: 6,
  urgentRadius: 14,
  defaultOn: 54,
  defaultOff: 66,
  parent: worldRoot
};

let revealAll = false;
let stats = { loads: 0, unloads: 0, compiled: 0, active: 0 };

const bucketKey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);

function indexCell(c) {
  const reach = Math.max(c.r, c.off || 0);
  const cover = Math.max(0, Math.ceil(reach / CELL));
  const cx = Math.floor(c.x / CELL), cz = Math.floor(c.z / CELL);
  c._keys = [];
  for (let ix = cx - cover; ix <= cx + cover; ix++) {
    for (let iz = cz - cover; iz <= cz + cover; iz++) {
      const k = bucketKey(ix, iz);
      let arr = buckets.get(k);
      if (!arr) { arr = []; buckets.set(k, arr); }
      arr.push(c);
      c._keys.push(k);
    }
  }
}

function unindexCell(c) {
  for (const k of c._keys || []) {
    const arr = buckets.get(k);
    if (!arr) continue;
    const i = arr.indexOf(c);
    if (i !== -1) arr.splice(i, 1);
    if (!arr.length) buckets.delete(k);
  }
  c._keys = null;
}

// -----------------------------------------------------------------------------
// Registration
// -----------------------------------------------------------------------------
export function initWorldStream(o = {}) {
  opts = { ...opts, ...o };
  hooks.worldStreamRegister = registerCell;
  return opts;
}

/**
 * cell = {
 *   id, x, y, z, r, off?, band?, mode?, tier?, priority?,
 *   group?, boxes?,                 // already-built content
 *   prefab?, w?, d?, ry?, s?,       // lazy-compiled content
 *   legacy?: 'skyscraper', sk?, makeInterior?
 * }
 */
export function registerCell(cell) {
  if (!cell || !cell.id) return null;
  if (cells.has(cell.id)) unregisterCell(cell.id);

  const c = {
    y: 0, band: 0, off: 0, active: false, cached: false,
    boxes: [], group: null, priority: 0, ...cell
  };
  if (!c.mode) c.mode = (c.prefab || c.legacy) ? 'stream' : 'lod';
  if (c.tier === 'far') c.mode = 'inverse';
  c.r = Number.isFinite(c.r) ? c.r : opts.defaultOn;
  c.off = Number.isFinite(c.off) && c.off > c.r ? c.off : Math.max(c.r * 1.22, c.r + 12);

  // Take ownership of handed-over colliders so activate() never double-adds.
  if (c.mode === 'stream' && c.boxes.length) {
    c._pendingSolids = c.boxes.map((b) => ({
      b: [b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ], tag: b.tag, climb: b.climbable
    }));
    removeSolidBoxes(c.boxes);
    if (c.group && c.group.parent) c.group.parent.remove(c.group);
  }

  cells.set(c.id, c);
  if (c.mode === 'inverse') {
    inverse.add(c);
    c.active = true;
    if (c.group) c.group.visible = true;
  } else {
    indexCell(c);
  }
  return c;
}

export function unregisterCell(id) {
  const c = cells.get(id);
  if (!c) return;
  if (c.active) deactivate(c, true);
  unindexCell(c);
  inverse.delete(c);
  active.delete(c);
  cells.delete(id);
}

/** Pull in everything worldKit queued during the static build. */
export function adoptKitCells() {
  let n = 0;
  for (const c of getStreamCells()) if (registerCell(c)) n++;
  return n;
}

/** Legacy: registerBuildingLod() entries -> 'lod' cells (height-aware radius). */
export function adoptBuildingLods() {
  let n = 0;
  for (let i = 0; i < buildingLods.length; i++) {
    const e = buildingLods[i];
    const r = Number.isFinite(e.r) ? e.r : 54;
    const off = Number.isFinite(e.off) ? e.off : Math.max(66, r * 1.22);
    if (registerCell({
      id: `lod:${i}`, x: e.x, z: e.z, group: e.group,
      mode: 'lod', r, off, legacyRef: e
    })) n++;
  }
  return n;
}

/** Legacy: aura.culls entries -> 'lod' cells. */
export function adoptAuraCulls() {
  let n = 0;
  const list = aura.culls || [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (registerCell({
      id: `cull:${i}`, x: c.x, z: c.z, group: c.g,
      mode: 'lod', r: c.r, off: c.r * 1.18, legacyRef: c
    })) n++;
  }
  return n;
}

/** Legacy: skyscraper lobbies keep their maker fn, but stream through here. */
export function adoptSkyscraperInteriors(makeInterior) {
  let n = 0;
  for (let i = 0; i < skyscrapers.length; i++) {
    const sk = skyscrapers[i];
    if (registerCell({
      id: `sk:${i}:lobby`, x: sk.x, z: sk.z, y: sk.baseY ?? 0.18,
      r: 56, off: 70, mode: 'stream', legacy: 'skyscraper',
      sk, makeInterior, tier: 'interior'
    })) n++;
  }
  return n;
}

/** Register the furnished floors produced by expandTowerFloors(). */
export function registerTowerFloors(rec, row, meta, expand) {
  const list = expand(rec, row, meta);
  for (const c of list) registerCell(c);
  rec.floorCells = list.map((c) => c.id);
  return list.length;
}

// -----------------------------------------------------------------------------
// Activation
// -----------------------------------------------------------------------------
function buildFromPrefab(c) {
  const out = { parts: [], solids: [], anchors: {}, nested: [] };
  const xf = { x: c.x, y: c.y, z: c.z, ry: c.ry || 0, s: c.s || 1 };
  // Parametric prefabs (tower floors) receive their dimensions through the row.
  compilePrefab(c.prefab, xf, out, rngFor(c.id), 0, true,
    { w: c.w, d: c.d, ry: c.ry, s: c.s });

  const g = new THREE.Group();
  g.userData.studioName = `stream:${c.id}`;
  g.userData.studioSelectable = false;
  g.userData.worldBuilt = true;
  for (const p of out.parts) {
    const m = new THREE.Mesh(p.geometry, p.material);
    m.position.set(p.x, p.y, p.z);
    m.scale.set(p.sx, p.sy, p.sz);
    m.rotation.set(p.rx, p.ry, p.rz);
    m.castShadow = !!p.cast;
    m.receiveShadow = !!p.recv;
    if (p.name) m.userData.studioName = p.name;
    g.add(m);
  }
  c.group = g;
  c._pendingSolids = out.solids;
  c.anchors = out.anchors;
  stats.compiled++;
  return g;
}

function activate(c) {
  if (c.active) return;

  if (c.mode === 'lod' || c.mode === 'inverse') {
    if (c.group) c.group.visible = true;
    if (c.legacyRef) c.legacyRef.active = true;
    c.active = true;
    active.add(c);
    stats.loads++;
    return;
  }

  // --- legacy skyscraper lobby --------------------------------------------
  if (c.legacy === 'skyscraper') {
    const sk = c.sk;
    const baseY = sk.baseY ?? 0.18;
    let ig = sk.interiorCache;
    if (!ig) {
      ig = new THREE.Group();
      ig.position.set(sk.x, baseY, sk.z);
      ig.userData.studioSelectable = false;
      sk.interiorSpecs = c.makeInterior ? c.makeInterior(sk, ig) : [];
      sk.interiorCache = ig;
    }
    opts.parent.add(ig);
    sk.interiorGroup = ig;
    sk.interiorBoxes = (sk.interiorSpecs || []).map((b) =>
      addSolidBox(b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ, b.tag, b.climbable));
    sk.interiorLoaded = true;
    c.group = ig;
    c.boxes = sk.interiorBoxes;
    c.cached = true;
    c.active = true;
    active.add(c);
    stats.loads++;
    return;
  }

  // --- lazily compiled / cached prefab content -----------------------------
  if (!c.group) buildFromPrefab(c);
  if (c.group && !c.group.parent) opts.parent.add(c.group);
  if (c.group) c.group.visible = true;

  if (c._pendingSolids) {
    c.boxes = c._pendingSolids.map((s) =>
      addSolidBox(s.b[0], s.b[1], s.b[2], s.b[3], s.b[4], s.b[5], s.tag, s.climb));
    c._pendingSolids = null;
  } else if (c.boxes.length) {
    // Re-register cached colliders (they were spliced on unload).
    c.boxes = c.boxes.map((b) =>
      addSolidBox(b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ, b.tag, b.climbable));
  }

  c.cached = true;
  c.active = true;
  active.add(c);
  stats.loads++;
}

function deactivate(c, destroy = false) {
  if (!c.active && !destroy) return;

  if (c.mode === 'lod' || c.mode === 'inverse') {
    if (c.group) c.group.visible = false;
    if (c.legacyRef) c.legacyRef.active = false;
    c.active = false;
    active.delete(c);
    stats.unloads++;
    return;
  }

  if (c.legacy === 'skyscraper') {
    const sk = c.sk;
    if (sk.interiorGroup) { opts.parent.remove(sk.interiorGroup); sk.interiorGroup = null; }
    removeSolidBoxes(sk.interiorBoxes);
    sk.interiorBoxes = [];
    sk.interiorLoaded = false;
    c.boxes = [];
    if (destroy) { sk.interiorCache = null; sk.interiorSpecs = null; c.group = null; c.cached = false; }
  } else {
    if (c.group && c.group.parent) c.group.parent.remove(c.group);
    removeSolidBoxes(c.boxes);
    if (destroy && c.group) { c.group = null; c.cached = false; c._pendingSolids = null; }
  }

  c.active = false;
  active.delete(c);
  stats.unloads++;
}

// -----------------------------------------------------------------------------
// Per-frame update
// -----------------------------------------------------------------------------
function wantsActive(c, d2) {
  if (revealAll) return true;
  let inRange = c.active ? d2 < c.off * c.off : d2 < c.r * c.r;
  if (c.mode === 'inverse') inRange = !inRange;
  if (!inRange) return false;
  if (c.band > 0) {
    const dy = Math.abs((player.y || 0) - c.y);
    return dy <= (c.active ? c.band * 1.4 : c.band);
  }
  return true;
}

export function updateWorldStream() {
  const px = player.x, pz = player.z;

  // 1. UNLOAD SWEEP — O(active), independent of bucket membership. Without
  //    this, anything you walk away from stays resident forever.
  let unloaded = 0;
  for (const c of active) {
    const d2 = dist2(px, pz, c.x, c.z);
    if (wantsActive(c, d2)) continue;
    // Budget, with a hard override for cells that are already far outside.
    if (unloaded >= opts.unloadPerFrame && d2 < c.off * c.off * 4) continue;
    deactivate(c);
    unloaded++;
  }

  // 2. FAR-TIER SHELLS — visible when distant, hidden when you approach.
  for (const c of inverse) {
    const want = revealAll || dist2(px, pz, c.x, c.z) >= c.r * c.r;
    if (want === c.active) continue;
    c.active = want;
    if (c.group) c.group.visible = want;
    if (c.legacyRef) c.legacyRef.active = want;
  }

  // 3. LOAD CANDIDATES — only the player's bucket.
  const arr = buckets.get(bucketKey(Math.floor(px / CELL), Math.floor(pz / CELL)));
  if (arr && arr.length) {
    const toLoad = [];
    const urgent2 = opts.urgentRadius * opts.urgentRadius;
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i];
      if (c.active) continue;
      const d2 = dist2(px, pz, c.x, c.z);
      if (!wantsActive(c, d2)) continue;
      // Urgent bypass: never make the player wait for the floor they're on.
      if (d2 < urgent2 && (c.band === 0 || Math.abs((player.y || 0) - c.y) <= c.band)) {
        activate(c);
      } else {
        c._d2 = d2;
        toLoad.push(c);
      }
    }
    if (toLoad.length > 1) {
      toLoad.sort((a, b) => (b.priority - a.priority) || (a._d2 - b._d2));
    }
    const n = Math.min(opts.loadPerFrame, toLoad.length);
    for (let i = 0; i < n; i++) activate(toLoad[i]);
  }

  stats.active = active.size;
  return stats;
}

/** Force-load a cell NOW. Call before teleporting the player onto it. */
export function primeCell(id) {
  const c = cells.get(id);
  if (c && !c.active) activate(c);
  return c || null;
}

// -----------------------------------------------------------------------------
// Studio / debug / teardown
// -----------------------------------------------------------------------------
export function revealAllCells() {
  revealAll = true;
  for (const c of cells.values()) if (!c.active) activate(c);
}

export function restoreCulling() {
  revealAll = false;
  for (const c of cells.values()) {
    if (c.mode === 'inverse') continue;
    if (!wantsActive(c, dist2(player.x, player.z, c.x, c.z))) deactivate(c);
  }
}

export function streamStats() {
  return {
    ...stats,
    cells: cells.size,
    buckets: buckets.size,
    inverse: inverse.size,
    revealAll
  };
}

export function getCell(id) { return cells.get(id) || null; }
export function activeCells() { return [...active]; }

export function resetWorldStream() {
  for (const c of cells.values()) {
    if (c.active) deactivate(c, true);
    if (c.group && c.group.parent) c.group.parent.remove(c.group);
  }
  cells.clear();
  buckets.clear();
  active.clear();
  inverse.clear();
  stats = { loads: 0, unloads: 0, compiled: 0, active: 0 };
  revealAll = false;
}

// -----------------------------------------------------------------------------
// Back-compatible entry points — old callers keep working, one system runs.
// -----------------------------------------------------------------------------
export function updateBuildingLods() { /* handled by updateWorldStream() */ }
export function updateSkyscraperInteriors() { /* handled by updateWorldStream() */ }
export function updateAuraCulls() { /* handled by updateWorldStream() */ }

export default {
  initWorldStream, registerCell, unregisterCell, updateWorldStream, primeCell,
  adoptKitCells, adoptBuildingLods, adoptAuraCulls, adoptSkyscraperInteriors,
  registerTowerFloors, revealAllCells, restoreCulling, resetWorldStream,
  streamStats, getCell, activeCells
};