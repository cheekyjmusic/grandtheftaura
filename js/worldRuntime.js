// =============================================================================
// worldRuntime.js — Grand Theft Aura · BOOT, DISPOSAL & PUBLIC API
//
// This is the ONLY module the rest of the game imports. It contains no map
// data and no geometry: it consumes world.js, drives worldKit, and wires the
// systems together.
//
//   world.js            layout rows            (what goes where)
//   worldObjects/*      prefab vocabulary      (what a thing is)
//   worldTerrain.js     heightfields + water
//   worldRoads.js       carriageways
//   worldKit.js         rows -> geometry       (the compiler)
//   worldStream.js       distance/height LOD
//   worldSystems/*      behaviour
//   worldRuntime.js     <-- THIS FILE
//
// -----------------------------------------------------------------------------
// PENDING MODULE CONTRACTS
// -----------------------------------------------------------------------------
// worldObjects/street.js must export:
//   STREET_BUILDERS            { prop_lamppost, prop_hydrant, prop_shelter,
//                                prop_cart, prop_fountain, prop_pier,
//                                prop_lifeguard, prop_campfire, prop_tent,
//                                prop_sign_arch, prop_gantry, prop_jet,
//                                prop_service, prop_cliff, prop_dumpster,
//                                prop_ferris_wheel, prop_fire_escape, ice_zones }
//   buildKnockableLamppost(x,z), knockOverLamppostBase(lp,yaw,speed),
//   knockOverLamppost(lp,yaw,speed), updateLampposts(dt,elapsed),
//   createTree(x,z,s,y), createHydrant(x,z), createBusShelter(x,z,ry),
//   buildPlazaHotdogCart(x,z), streetFX, resetStreet(), disposeStreet()
//
// worldSystems/index.js must export:
//   systems                    { sewer, armory, estates, airport, atmosphere,
//                                edgeBarrier, towerLift }
//                              each: { install?(ctx), update?(dt,elapsed),
//                                      reset?(), build?(spec) }
//   updateWorldSystems(dt, elapsed), resetWorldSystems(),
//   buildSewer(row), bio, bioC,
//   buildEdgeBarrier(spec), updateEdgeBarrier(), revealEdgeBarrier()
//
// SYSTEM INSTALL ORDER IS LOAD-BEARING: estates installs before armory,
// because armory CHAINS aura.ahF / aura.ahHint onto whatever estates left.
// =============================================================================
import * as THREE from 'three';
import { colorToHex, levelData } from './levelData.js';
import {
  WORLD_BOUNDS, addDriveableRamp, aura, buildingLods, driveableRamps, gameState,
  hazardBarrels, hooks, lampPosts, manholes, mapShapes, player, recomputeWorldBounds,
  resetWorldState, smashableCrates, terrainH, waterZones, worldBoxes, worldPickups
} from './state.js';
import {
  camera, highDetailObjects, makeMat, scene, worldRoot
} from './engine.js';
import {
  applyEntityColor, applyEntityTexture, applyModelPreset
} from './assets.js';
import {
  buildBarrelMesh, buildCrateMesh, buildPickupMesh, spawnHazardBarrel,
  spawnSmashCrate, spawnWorldPickup
} from './items.js';
import { buildSportsCar, buildSportsCarMesh, vehicles } from './vehicles.js';
import {
  getWaterDepthAt, getWaterHeightAt, isSwimming, resetWaterSystem, swimState, updateWater
} from './water.js';

import {
  WORLD, TERRAIN, WATER, ROADS, DISTRICTS, SCATTERS, PLACEMENTS, SYSTEMS, BOOT
} from './worldData.js';
import { CONCERT_BUILDERS } from './worldObjects/concertHall.js';

import {
  UNIT_BOX, addRamp, addSolidBox, allPlacements, anchor, beginBuild, buildCompound,
  defineGeo, definePalette, definePrefab, disposeKit, disposeTree, dist2,
  flushInstances, flushWorld, footprintClear, generateCatalog, getPlacement,
  groundMat, inst, instMatrix, installColliderIndex, kitStats, makeBox, makeMesh,
  place, placeAll, queryBoxes, reindexAll, removeRamp, removeSolidBox,
  removeSolidBoxes, reserveFootprint, resetKitSession, resolveMat, rngFor,
  signBoxMaterials, signMaterials, xform
} from './worldKit.js';

import {
  adoptAuraCulls, adoptBuildingLods, adoptKitCells, adoptSkyscraperInteriors,
  getCell, initWorldStream, primeCell, registerTowerFloors as streamRegisterTowerFloors,
  resetWorldStream, restoreCulling, revealAllCells, streamStats, unregisterCell,
  updateWorldStream
} from './worldStream.js';

import {
  buildGroundIntegrity, coord, disposeTerrain, frostCreekX, maxTerrainOver,
  refreshTerrainSculpt, registerTerrainPrefabs, resetTerrain, resolveRowXZ,
  riverSurfaceAt, sculptableTerrainMeshes, updateRiverFlow
} from './worldTerrain.js';

import {
  LEGACY_SLOTS, clearKeepouts, expandDistricts, expandScatters, expandTowerFloors,
  registerLegacyBuilders
} from './worldObjects/index.js';

import { BUILDING_BUILDERS, buildWalkInHouse, buildSuburbanHouse, buildSuburbanHouseBase,
embellishHouse, buildHotdogStore, buildCarDealership, buildReserveBank,
buildFirearmsArmory, buildHideout as buildCriminalHideout } from './worldObjects/buildings.js';
import { TOWER_BUILDERS, buildSkyscraper, buildSkyscraperBase, embellishTower,
  makeTowerLobby, disposeTowerInteriors, resetTowerSystem, towerMetrics } from './worldObjects/towers.js';
import { ESTATE_BUILDERS, resetEstates } from './worldObjects/estates.js';
import { AIRPORT_BUILDERS, resetAirport } from './worldObjects/airport.js';
import { ROAD_BUILDERS, defineHeightRef, resetRoads, disposeRoads, loopNearest } from './worldRoads.js';
import { neon, wallWithWindow } from './worldObjects/shell.js';

import {
  STREET_BUILDERS, buildKnockableLamppost, buildPlazaHotdogCart, createBusShelter,
  createHydrant, createTree, knockOverLamppost, knockOverLamppostBase,
  updateLampposts, resetStreet, disposeStreet, streetFX
} from './worldObjects/street.js';

import {
  systems, updateWorldSystems, resetWorldSystems, buildSewer, bio, bioC,
  buildEdgeBarrier, updateEdgeBarrier, revealEdgeBarrier
} from './worldSystems/index.js';

import { registerFoliage, disposeFoliage } from './worldObjects/foliage.js';

// =============================================================================
// SECTION 1 — LEGACY MATERIAL EXPORTS
// Kept because a handful of gameplay modules still import them by name.
// =============================================================================
const legacyMat = (hex, opts) => { const m = makeMat(hex, opts); m.userData.shared = true; return m; };
export const rockMat  = legacyMat(0x5a554d, { roughness: 1, flatShading: true });
export const pipeMat  = legacyMat(0x6f7f77, { roughness: 0.8, metalness: 0.35 });
export const concMat  = legacyMat(0x7d8280, { roughness: 0.95 });
export const lampMat  = new THREE.MeshBasicMaterial({ color: 0xffd27a });
export const waterMat = legacyMat(0x2f5f4a, {
  roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.82, emissive: 0x0b2a1e
});
pipeMat.side = THREE.BackSide;
lampMat.userData.shared = true;

// =============================================================================
// SECTION 2 — RUNTIME STATE
// =============================================================================
export const entityObjects = new Map();
export const studioObjects = new Map();
const studioBaseTransforms = new Map();
const studioDeletedObjects = new Map();
const RETIRED_ENTITY_IDS = new Set(SYSTEMS.retiredEntityIds || []);
const ENTITY_Y_OFFSET = { pickup: 0.55 };

/** Roots that existed before the first build survive every rebuild. */
let foreignRoots = null;
let builtOnce = false;
let lastWaterFrame = -Infinity;
let lastBootReport = null;

// =============================================================================
// SECTION 3 — SYMBOLIC COORDINATES & HEIGHTS
// world.js may write 'riverX', 'ahRz+43', 'maxTerrain+0.12', 'lodgeY'.
// Everything is resolved to a NUMBER here, before worldKit sees the row.
// =============================================================================
const heightRefs = new Map();
export function defineWorldHeightRef(name, fn) { heightRefs.set(name, fn); }

/** The Frostpine loop station nearest the creek — the stone bridge crossing. */
function frostLoopCreekStation() {
  const loop = getPlacement('rd/frost_loop')?.data;
  if (!loop?.pts) return null;
  let best = null, bd = Infinity;
  for (const p of loop.pts) {
    if (p.z < 270 || p.z > 316) continue;
    const d = Math.abs(p.x - frostCreekX(p.z));
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { ...best, dy: loop.dy, halfW: loop.halfW } : null;
}

function lodgeFounding() {
  const a = anchor('fp/lodge', 'floor');
  if (a) return a[1];
  const r = PLACEMENTS.find((p) => p.id === 'fp/lodge');
  if (!r) return terrainH(-70, 139) + 0.12;
  const w = r.w ?? 11, d = r.d ?? 9;
  return maxTerrainOver(r.at[0] - w / 2, r.at[0] + w / 2, r.at[1] - d / 2, r.at[1] + d / 2) + 0.12;
}

function resolveHeight(spec, row, x, z) {
  if (Number.isFinite(spec)) return spec;
  if (typeof spec !== 'string') return undefined;
  const s = spec.trim();
  if (s === 'terrain') return terrainH(x, z);
  if (s === 'lodgeY') return lodgeFounding();

  let m = /^maxTerrain([+-][\d.]+)?$/.exec(s);
  if (m) {
    const w = row.w ?? 10, d = row.d ?? 10;
    return maxTerrainOver(x - w / 2, x + w / 2, z - d / 2, z + d / 2) + (m[1] ? Number(m[1]) : 0);
  }
  m = /^river([+-][\d.]+)?$/.exec(s);
  if (m) return riverSurfaceAt(row.river, z) + (m[1] ? Number(m[1]) : 0.3);

  m = /^max\(creek,loop\)([+-][\d.]+)?$/.exec(s);
  if (m) {
    const st = row._loopStation || frostLoopCreekStation();
    const creek = riverSurfaceAt('wat/frostpine_creek', z);
    const road = st ? st.y + st.dy : terrainH(x, z);
    return Math.max(creek, road) + (m[1] ? Number(m[1]) : 0.3);
  }
  const fn = heightRefs.get(s);
  if (fn) { const v = fn(); if (Number.isFinite(v)) return v; }
  console.warn('[worldRuntime] unresolved height:', s, 'on', row.id);
  return undefined;
}

/**
 * Resolve one layout row into pure numbers. Never mutates the source data —
 * world.js stays a pristine description that can be re-read every rebuild.
 */
function prepRow(row) {
  if (!row) return row;
  let r = row;

  // 'loopCross' is not a path function — substitute it before coord resolution.
  if (Array.isArray(r.at) && r.at[1] === 'loopCross') {
    const st = frostLoopCreekStation();
    r = { ...r, at: [r.at[0], st ? st.z : 292], _loopStation: st };
  }

  if (Array.isArray(r.at) && r.at.some((v) => typeof v === 'string')) {
    const { x, z } = resolveRowXZ(r);
    r = { ...r, at: [x, z, r.at[2]] };
  }

  const x = Number(r.at?.[0]) || 0, z = Number(r.at?.[1]) || 0;
  for (const key of ['y', 'baseY', 'deckY', 'startY', 'endY']) {
    if (typeof r[key] === 'string') {
      const v = resolveHeight(r[key], r, x, z);
      if (Number.isFinite(v)) r = { ...r, [key]: v };
    }
  }
  return r;
}

function placeRow(row, parent) { return place(prepRow(row), parent); }
function placeRows(rows, parent) {
  let built = 0;
  for (const row of rows || []) if (placeRow(row, parent)) built++;
  return built;
}

// =============================================================================
// SECTION 4 — BOOT PARTITION
// Each row is routed to a BOOT step by longest-matching id prefix. Adding a
// row to world.js needs no runtime change; adding a STEP needs one line here.
// =============================================================================
const PLACEMENT_STEP = {
  'rr/hideout': 'placement:hideout',
  'rr/tank': 'placement:hideout',
  'rr/': 'biome:redrock',
  'fp/': 'biome:frostpine+woods+cove',
  'ew/': 'biome:frostpine+woods+cove',
  'sc/': 'biome:frostpine+woods+cove',
  'jg/': 'biome:jungle',
  'sv/tw_': 'towers',
  'sv/': 'district:sunnyvale',
  'ah/hospital': 'district:aura_hills+estates',
  'ah/': 'district:aura_hills+estates',
  'ws/': 'district:westside',
  'la/armory': 'placement:armory',
  'la/tw_': 'towers',
  'la/': 'district:boardwalk+lax+speedway',
  'wb/tw_': 'towers',
  'wb/': 'district:boardwalk+lax+speedway',
  'bw/': 'district:boardwalk+lax+speedway',
  'lax/': 'district:boardwalk+lax+speedway',
  'sp/': 'district:boardwalk+lax+speedway',
  'bus/': 'district:boardwalk+lax+speedway'
};
const ROAD_STEP = {
  'rd/sv_grid': 'roads:city+desert',
  'rd/desert_': 'roads:city+desert',
  'rd/i88': 'roads:city+desert',
  'rd/forest': 'biome:frostpine+woods+cove',
  'rd/cove': 'biome:frostpine+woods+cove',
  'rd/frost_': 'biome:frostpine+woods+cove',
  'rd/lodge_': 'biome:frostpine+woods+cove',
  'br/frost': 'biome:frostpine+woods+cove',
  'br/woods': 'biome:frostpine+woods+cove',
  'br/jungle': 'biome:jungle',
  'br/aura_': 'terrain:mountains',
  'rd/hills': 'district:aura_hills+estates',
  'rd/westside': 'district:westside',
  'rd/la_': 'district:boardwalk+lax+speedway',
  'rd/wb_': 'district:boardwalk+lax+speedway',
  'rd/boardwalk': 'district:boardwalk+lax+speedway',
  'rd/lax_': 'district:boardwalk+lax+speedway',
  'rd/speed_': 'district:boardwalk+lax+speedway'
};
const TERRAIN_STEP = {
  'gnd/north_range': 'terrain:mountains',
  'gnd/aura_hills': 'district:aura_hills+estates',
  'gnd/northland': 'district:boardwalk+lax+speedway',
  'gnd/jungle': 'biome:jungle',
  'gnd/frostpine': 'biome:frostpine+woods+cove',
  'gnd/woods': 'biome:frostpine+woods+cove',
  'gnd/cove': 'biome:frostpine+woods+cove',
  'gnd/': 'terrain'
};
const WATER_STEP = {
  'wat/aura_river': 'terrain:mountains',
  'wat/seabed': 'water:seabed',
  'wat/frostpine_creek': 'biome:frostpine+woods+cove',
  'wat/emerald': 'biome:frostpine+woods+cove',
  'wat/sunset_cove': 'biome:frostpine+woods+cove',
  'wat/verdant_river': 'biome:jungle',
  'wat/': 'district:boardwalk+lax+speedway'
};
const DISTRICT_STEP = {
  sunnyvale: 'district:sunnyvale',
  losaura_downtown: 'district:boardwalk+lax+speedway',
  westbank: 'district:boardwalk+lax+speedway',
  boardwalk: 'district:boardwalk+lax+speedway',
  lax: 'district:boardwalk+lax+speedway',
  speedway: 'district:boardwalk+lax+speedway'
};
const SCATTER_STEP = {
  'sc/frost_': 'biome:frostpine+woods+cove',
  'sc/woods_': 'biome:frostpine+woods+cove',
  'sc/cove_': 'biome:frostpine+woods+cove',
  'sc/jungle_': 'biome:jungle',
  'sc/mtn_': 'terrain:mountains',
  'sc/hills_': 'district:westside'
};
/** Rows whose order inside a step is load-bearing (keep-outs, height refs). */
const STEP_FIRST = {
  'biome:frostpine+woods+cove': [
    'rd/frost_loop', 'rd/frost_spur', 'fp/lodge', 'rd/lodge_drive', 'rd/lodge_ramp', 'br/frost'
  ],
  'terrain:mountains': ['gnd/north_range', 'wat/aura_river', 'br/aura_1', 'br/aura_2'],
  'district:boardwalk+lax+speedway': ['gnd/northland', 'rd/lax_curb', 'lax/terminal']
};

const longestPrefix = (table, id) => {
  let best = null, len = -1;
  for (const k of Object.keys(table)) {
    if (id.startsWith(k) && k.length > len) { best = table[k]; len = k.length; }
  }
  return best;
};
const rowsForStep = (table, list, step) =>
  (list || []).filter((r) => longestPrefix(table, r.id) === step);
const scatterSpecsForStep = (step) =>
  SCATTERS.filter((s) => longestPrefix(SCATTER_STEP, s.id) === step);

// =============================================================================
// SECTION 5 — REGISTRATION
// =============================================================================
let registered = false;
function registerEverything() {
  if (registered) return;
  registered = true;
    registerFoliage();

  registerTerrainPrefabs();

  registerLegacyBuilders({
    ...BUILDING_BUILDERS,
    ...ESTATE_BUILDERS,
    ...AIRPORT_BUILDERS,
    ...TOWER_BUILDERS,
    ...ROAD_BUILDERS,
    ...STREET_BUILDERS,
      ...CONCERT_BUILDERS,
    sewer_network: buildSewer,
    vehicle: buildSportsCar,
    bus: systems.bus?.build || null,
    // The tower adapter calls this to register per-floor stream cells.
    registerTowerFloors: (rec, row, meta) =>
      streamRegisterTowerFloors(rec, row, meta || towerMetrics(row), expandTowerFloors)
  });

  // Symbolic heights the road module may encounter.
  defineHeightRef('lodgeY', lodgeFounding);
  defineWorldHeightRef('lodgeY', lodgeFounding);

  initWorldStream({
    defaultOn: WORLD.stream?.lodOn ?? 54,
    defaultOff: WORLD.stream?.lodOff ?? 66,
    loadPerFrame: WORLD.stream?.loadPerFrame ?? 3,
    unloadPerFrame: WORLD.stream?.unloadPerFrame ?? 6,
    urgentRadius: WORLD.stream?.urgentRadius ?? 14,
    parent: worldRoot
  });
}

// =============================================================================
// SECTION 6 — BOOT STEPS
// =============================================================================
function runStep(step, ctx) {
  const { data, register, afterStatic } = ctx;

  // ---- ordered lead rows -------------------------------------------------
  const first = STEP_FIRST[step];
  const placedIds = new Set();
  if (first) {
    for (const id of first) {
      const row = [...TERRAIN, ...WATER, ...ROADS, ...PLACEMENTS].find((r) => r.id === id);
      if (row && placeRow(row)) placedIds.add(id);
    }
  }
  const notYet = (r) => !placedIds.has(r.id);

  switch (step) {
    case 'terrain':
      placeRows(rowsForStep(TERRAIN_STEP, TERRAIN, step).filter(notYet));
      break;

    case 'roads:city+desert':
      placeRows(rowsForStep(ROAD_STEP, ROADS, step).filter(notYet));
      mapShapes.push({ x: 280, z: 10, w: 220, d: 396, color: '#d97706', border: '#92400e', enterable: false });
      break;

    case 'biome:redrock':
      placeRows(rowsForStep(PLACEMENT_STEP, PLACEMENTS, step).filter(notYet));
      break;

    case 'biome:frostpine+woods+cove': {
      placeRows(rowsForStep(TERRAIN_STEP, TERRAIN, step).filter(notYet));
      placeRows(rowsForStep(WATER_STEP, WATER, step).filter(notYet));
      placeRows(rowsForStep(ROAD_STEP, ROADS, step).filter(notYet));
      placeRows(rowsForStep(PLACEMENT_STEP, PLACEMENTS, step).filter(notYet));
      // Keep-outs are complete — the forest may now grow.
      placeRows(expandScatters(scatterSpecsForStep(step)));
      mapShapes.unshift({ x: -12, z: 158, w: 80, d: 100, color: '#166534', border: '#14532d', enterable: false });
      mapShapes.unshift({ x: 83, z: 158, w: 110, d: 100, color: '#fcd34d', border: '#f59e0b', enterable: false });
      mapShapes.push({ x: -420, z: 224, w: 110, d: 180, color: '#38bdf8', border: '#0ea5e9', enterable: false });
      break;
    }

    case 'biome:jungle':
      placeRows(rowsForStep(TERRAIN_STEP, TERRAIN, step).filter(notYet));
      placeRows(rowsForStep(WATER_STEP, WATER, step).filter(notYet));
      placeRows(rowsForStep(ROAD_STEP, ROADS, step).filter(notYet));
      placeRows(rowsForStep(PLACEMENT_STEP, PLACEMENTS, step).filter(notYet));
      placeRows(expandScatters(scatterSpecsForStep(step)));
      mapShapes.unshift({ x: 450.5, z: 30, w: 165, d: 420, color: '#14532d', border: '#166534', enterable: false });
      break;

    case 'district:sunnyvale':
      placeRows(expandDistricts(DISTRICTS.filter((d) => DISTRICT_STEP[d.id] === step)));
      placeRows(rowsForStep(PLACEMENT_STEP, PLACEMENTS, step).filter(notYet));
      mapShapes.push({ x: 0, z: 0, w: 30, d: 30, color: '#22c55e', border: '#15803d', enterable: false });
      break;

    case 'entities':
      spawnLevelEntities(data, { register });
      break;

    case 'afterStatic':
      if (afterStatic) afterStatic();
      break;

    case 'terrain:mountains':
      placeRows(rowsForStep(TERRAIN_STEP, TERRAIN, step).filter(notYet));
      placeRows(rowsForStep(WATER_STEP, WATER, step).filter(notYet));
      placeRows(rowsForStep(ROAD_STEP, ROADS, step).filter(notYet));
      placeRows(expandScatters(scatterSpecsForStep(step)));
      camera.far = Math.max(camera.far, 620);
      camera.updateProjectionMatrix();
      break;

    case 'system:sewer':
      placeRow({ id: 'sys/sewer', prefab: 'sewer_network', ...SYSTEMS.sewer });
      systems.sewer?.install?.({ spec: SYSTEMS.sewer });
      break;

    case 'district:aura_hills+estates':
      placeRows(rowsForStep(TERRAIN_STEP, TERRAIN, step).filter(notYet));
      placeRows(rowsForStep(ROAD_STEP, ROADS, step).filter(notYet));
      placeRows(rowsForStep(PLACEMENT_STEP, PLACEMENTS, step).filter(notYet));
      systems.estates?.install?.({ spec: SYSTEMS.estates });
      break;

    case 'district:westside':
      placeRows(rowsForStep(ROAD_STEP, ROADS, step).filter(notYet));
      placeRows(rowsForStep(PLACEMENT_STEP, PLACEMENTS, step).filter(notYet));
      placeRows(expandScatters(scatterSpecsForStep(step)));
      break;

    case 'placement:hideout':
      placeRows(rowsForStep(PLACEMENT_STEP, PLACEMENTS, step).filter(notYet));
      systems.hideout?.install?.({ spec: SYSTEMS.hideout });
      break;

    case 'district:boardwalk+lax+speedway':
      placeRows(rowsForStep(TERRAIN_STEP, TERRAIN, step).filter(notYet));
      placeRows(rowsForStep(WATER_STEP, WATER, step).filter(notYet));
      placeRows(rowsForStep(ROAD_STEP, ROADS, step).filter(notYet));
      placeRows(expandDistricts(DISTRICTS.filter((d) => DISTRICT_STEP[d.id] === step)));
      placeRows(rowsForStep(PLACEMENT_STEP, PLACEMENTS, step).filter(notYet));
      systems.airport?.install?.({ spec: SYSTEMS.airport });
              systems.concertHall?.install?.();
      systems.speedway?.install?.({ spec: SYSTEMS.speedway });
      mapShapes.unshift({ x: 120, z: 655, w: 740, d: 550, color: '#4d7c0f', border: '#365314', enterable: false });
      mapShapes.push({ x: 120, z: 299, w: 760, d: 162, color: '#0284c7', border: '#38bdf8', enterable: false });
      camera.far = Math.max(camera.far, WORLD.cameraFar ?? 1150);
      camera.updateProjectionMatrix();
      break;

    case 'placement:armory': {
      const rows = rowsForStep(PLACEMENT_STEP, PLACEMENTS, step).filter(notYet);
      // The shell needs the ammo config so the crate lands at the configured spot.
      for (const r of rows) {
        placeRow(r.prefab === 'shop_armory' ? { ...r, ammo: SYSTEMS.armory.ammo } : r);
      }
      systems.armory?.install?.({ spec: SYSTEMS.armory });
      break;
    }

    case 'towers': {
      const rows = rowsForStep(PLACEMENT_STEP, PLACEMENTS, step).filter(notYet);
      const built = placeRows(rows);
      console.log(`[towers] ${built}/${rows.length} towers placed`);
      systems.towerLift?.install?.();
      break;
    }

    case 'groundIntegrity':
      buildGroundIntegrity(SYSTEMS.groundIntegrity, worldRoot);
      break;

    case 'water:seabed':
      placeRows(rowsForStep(WATER_STEP, WATER, step).filter(notYet));
      break;

    case 'recomputeBounds':
      recomputeWorldBounds();
      break;

    case 'edgeBarrier':
      buildEdgeBarrier(SYSTEMS.edgeBarrier);
      break;

    case 'registerStudio':
      registerGeneratedWorldObjects(data);
      break;

    default:
      console.warn('[worldRuntime] unknown BOOT step:', step);
  }
}

// =============================================================================
// SECTION 7 — BUILD WORLD
// =============================================================================
/**
 * Idempotent. Safe to call again from Studio / Save & Test.
 * @param {object} data      levelData (entities + worldTransforms)
 * @param {boolean} register false = preview meshes, no gameplay registration
 * @param {Function} afterStatic  called after the entity pass, before mountains
 */
export function buildWorld(data = levelData, { register = true, afterStatic = null } = {}) {
  if (!foreignRoots) foreignRoots = new Set(worldRoot.children);

  clearBuiltWorld();
  registerEverything();

  beginBuild({
    chunkSize: WORLD.chunkSize ?? 128,
    spawn: WORLD.spawn ?? [-11.5, 18.5],
    spawnKeepout: WORLD.spawnKeepout ?? 26
  });

  camera.far = Math.max(camera.far, WORLD.cameraFar ?? 1150);
  camera.updateProjectionMatrix();

  const ctx = { data, register, afterStatic };
  for (const step of BOOT) runStep(step, ctx);

  // ---- finalise ----------------------------------------------------------
  const flushed = flushWorld(worldRoot);
  installColliderIndex();

  adoptKitCells();
  adoptBuildingLods();
  adoptAuraCulls();
  adoptSkyscraperInteriors(makeTowerLobby);

  // Refill zones are published by the shop/cart builders, not written by them.
  for (const rec of allPlacements().values()) {
    if (rec.data?.refill) sausageRefillPush(rec.data.refill);
  }

  systems.atmosphere?.install?.({ spec: SYSTEMS.atmosphere });
  recomputeWorldBounds();
  updateWorldStream();

  builtOnce = true;
  lastBootReport = {
    ...kitStats(), ...flushed, stream: streamStats(),
    bounds: { ...WORLD_BOUNDS }, entities: entityObjects.size, studio: studioObjects.size
  };
  if (lastBootReport.warnings?.length) {
    console.warn(`[worldRuntime] ${lastBootReport.warnings.length} row warning(s)`, lastBootReport.warnings);
  }
  return lastBootReport;
}

function sausageRefillPush(zone) {
  // Imported lazily to avoid a cycle: state.js owns the array.
  const { sausageRefillZones } = requireState();
  if (zone && !sausageRefillZones.includes(zone)) sausageRefillZones.push(zone);
}
let _stateMod = null;
function requireState() {
  if (!_stateMod) _stateMod = { sausageRefillZones: sausageRefillZonesRef };
  return _stateMod;
}
import { sausageRefillZones as sausageRefillZonesRef } from './state.js';

export function bootReport() { return lastBootReport; }
export function worldCatalog() { return generateCatalog(); }

// =============================================================================
// SECTION 8 — DISPOSAL
// =============================================================================
function pruneDetachedHighDetail() {
  for (let i = highDetailObjects.length - 1; i >= 0; i--) {
    let o = highDetailObjects[i], attached = false;
    while (o) { if (o === scene) { attached = true; break; } o = o.parent; }
    if (!attached) highDetailObjects.splice(i, 1);
  }
}

function clearBuiltWorld() {
  disposeTowerInteriors();
  resetWorldStream();

  for (const child of [...worldRoot.children]) {
    if (foreignRoots && foreignRoots.has(child)) continue;
    worldRoot.remove(child);
    disposeTree(child);
  }

  resetTowerSystem();
  resetTerrain();
  resetRoads();
  resetEstates();
  resetAirport();
  resetStreet();
  resetWorldSystems();
  resetWaterSystem();
  lastWaterFrame = -Infinity;

  resetWorldState();          // clears worldBoxes, zones, lampPosts, aura…
  resetKitSession();          // clears the collider index + placements
  clearKeepouts();
  heightRefs.clear();

  vehicles.length = 0;
  entityObjects.clear();
  studioObjects.clear();
  studioBaseTransforms.clear();
  studioDeletedObjects.clear();

  bio.base = null; bio.snow = null; bio.last = 'city';
  if (streetFX) { streetFX.fire = null; streetFX.waterfall = null; streetFX.wheel = null; }
  pruneDetachedHighDetail();
}

/** Full teardown — releases GPU caches. Call on app shutdown, not per rebuild. */
export function disposeWorld() {
  clearBuiltWorld();
  disposeStreet();
  disposeRoads();
  disposeTerrain();
    disposeFoliage();
  disposeKit();
  registered = false;
  builtOnce = false;
}

// =============================================================================
// SECTION 9 — STUDIO REGISTRY
// Stable keys: `entity:<id>` for level entities, `static:<placement id>` for
// generated geometry. Batched chunk groups are deliberately not selectable.
// =============================================================================
function applyObjectTransform(object, t) {
  if (!t || t.deleted) return;
  object.position.fromArray(t.position);
  object.rotation.fromArray(t.rotation);
  object.scale.fromArray(t.scale);
}

function registerStudioObjectTree(root, rootPath, data = levelData) {
  const visit = (object, path) => {
    object.userData.studioPath = path;
    object.userData.studioNamed = Boolean(object.userData.studioName || object.name);
    if (!object.userData.studioName) {
      object.userData.studioName = object.name || `${object.isMesh ? 'Mesh' : object.type} ${path.split('/').pop()}`;
    }
    studioObjects.set(path, object);
    if (!studioBaseTransforms.has(path)) {
      studioBaseTransforms.set(path, {
        position: object.position.toArray(),
        rotation: object.rotation.toArray(),
        scale: object.scale.toArray()
      });
    }
    const saved = data.worldTransforms && data.worldTransforms[path];
    if (saved && !saved.deleted) applyObjectTransform(object, saved);
    object.children.forEach((child, i) => visit(child, `${path}/${i}`));
  };
  visit(root, rootPath);
}

function registerGeneratedWorldObjects(data = levelData) {
  studioObjects.clear();
  studioDeletedObjects.clear();
  const usedKeys = new Map();
  const slug = (s) => String(s || 'object').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').replace(/^ | $/g, '').slice(0, 48) || 'object';

  for (const root of worldRoot.children) {
    if (foreignRoots && foreignRoots.has(root)) continue;
    root.userData.worldBuilt = true;
    if (root.userData.studioSelectable === false || root.userData.persistentFX) continue;

    const entityId = root.userData.entityId;
    let key;
    if (entityId) key = `entity:${entityId}`;
    else if (root.userData.studioKey) key = root.userData.studioKey;   // set by worldKit
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
    const base = studioBaseTransforms.get(path);
    if (base) applyObjectTransform(object, base);
    if (saved) applyObjectTransform(object, saved);
  }
}

// =============================================================================
// SECTION 10 — ENTITY BRIDGE
// =============================================================================
function tagEntity(root, id) {
  root.userData.entityId = id;
  root.traverse((c) => { c.userData.entityId = id; });
}
function applyEntityLook(object, entity) {
  if (entity.color && !['vehicle', 'block', 'prop', 'ramp', 'building', 'road'].includes(entity.type)) {
    applyEntityColor(object, entity.color);
  }
  if (entity.texture) {
    applyEntityTexture(object, entity.texture, (entity.texRepeat || [1, 1])[0], (entity.texRepeat || [1, 1])[1]);
  }
}

function makeRampMesh(color) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0); shape.lineTo(0.5, 0); shape.lineTo(0.5, 1); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  g.rotateY(-Math.PI / 2);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, makeMat(colorToHex(color, 0xf59e0b), { roughness: 0.7 }));
  m.castShadow = m.receiveShadow = true;
  return m;
}
function makePrimitiveMesh(shape, color, fallback) {
  const key = shape === 'cylinder' ? 'cyl' : shape === 'sphere' ? 'sphere' : shape === 'cone' ? 'cone' : 'box';
  const m = makeMesh(new THREE.Group(), key, makeMat(colorToHex(color, fallback), { roughness: 0.8 }),
    { cast: true, recv: true });
  m.parent.remove(m);
  return m;
}
function makeBuildingMesh(entity) {
  const b = entity.building || {};
  const width = THREE.MathUtils.clamp(Number(b.width) || 12, 2, 200);
  const depth = THREE.MathUtils.clamp(Number(b.depth) || 10, 2, 200);
  const height = THREE.MathUtils.clamp(Number(b.height) || 12, 2, 300);
  const wallMat = makeMat(colorToHex(entity.color, 0x64748b), { texType: 'concrete', roughness: 0.82 });
  const trimMat = makeMat(colorToHex(b.roofColor, 0x1e293b), { metalness: 0.35, roughness: 0.55 });
  const winHex = colorToHex(b.windowColor, 0x7dd3fc);
  const glassMat = new THREE.MeshStandardMaterial({
    color: winHex, emissive: winHex, emissiveIntensity: 0.12, metalness: 0.2, roughness: 0.25
  });
  const root = new THREE.Group();
  makeBox(root, width, height, depth, 0, height / 2, 0, wallMat, { cast: true, recv: true, name: 'Building body' });
  makeBox(root, width + 0.5, 0.35, depth + 0.5, 0, height + 0.17, 0, trimMat, { cast: true, name: 'Roof' });
  const floors = Math.min(20, Math.max(1, Math.floor(height / 3.2)));
  const columns = Math.min(8, Math.max(1, Math.floor(width / 2.8)));
  const winW = Math.min(1.35, width / (columns * 2.2));
  const winH = Math.min(1.45, Math.max(0.55, height / (floors * 2.1)));
  const t = [];
  for (let f = 0; f < floors; f++) {
    const y = (f + 0.55) * height / floors;
    for (let c = 0; c < columns; c++) {
      const x = (c + 0.5) * width / columns - width / 2;
      for (const s of [-1, 1]) xform(t, x, y, s * (depth / 2 + 0.035), winW, winH, 0.06);
    }
  }
  const win = flushInstances(root, UNIT_BOX, glassMat, t);
  if (win) win.userData.studioName = 'Windows';
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
  const rot = entity.rot || [0, 0, 0], scale = entity.scale || [1, 1, 1];
  if (Math.hypot(rot[0] || 0, rot[2] || 0) === 0) {
    return addSolidBox(bounds.min.x, bounds.max.x, bounds.min.y, bounds.max.y,
      bounds.min.z, bounds.max.z, 'entity_road', true);
  }
  const cfg = entity.road || {};
  const halfW = ((Number(cfg.width) || 24) * scale[0]) * 0.5;
  const halfL = ((Number(cfg.depth) || 12) * scale[2]) * 0.5;
  const pNX = new THREE.Vector3(-halfW, 0, 0).applyMatrix4(object.matrixWorld);
  const pPX = new THREE.Vector3(halfW, 0, 0).applyMatrix4(object.matrixWorld);
  const pNZ = new THREE.Vector3(0, 0, -halfL).applyMatrix4(object.matrixWorld);
  const pPZ = new THREE.Vector3(0, 0, halfL).applyMatrix4(object.matrixWorld);
  const useX = Math.abs(pPX.y - pNX.y) >= Math.abs(pPZ.y - pNZ.y);
  const pMin = useX ? (pNX.x < pPX.x ? pNX : pPX) : (pNZ.z < pPZ.z ? pNZ : pPZ);
  const pMax = useX ? (pNX.x < pPX.x ? pPX : pNX) : (pNZ.z < pPZ.z ? pPZ : pNZ);
  return addRamp({
    minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z,
    startY: pMin.y + 0.08, endY: pMax.y + 0.08, axis: useX ? 'x' : 'z', dir: pMax.y >= pMin.y ? 1 : -1
  });
}
function registerEntityRamp(object, entity) {
  object.updateMatrixWorld(true);
  const rot = entity.rot || [0, 0, 0], scale = entity.scale || [1, 1, 1];
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
  return addRamp({
    minX, maxX, minZ, maxZ,
    startY: dir > 0 ? y : y + scale[1], endY: dir > 0 ? y + scale[1] : y, axis, dir
  });
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
      else {
        object = buildSportsCarMesh(cfg).root;
        worldRoot.add(object);
        object.rotation.set(rot[0], rot[1], rot[2]);
      }
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
        object.position.set(x, y + ENTITY_Y_OFFSET.pickup, z);
        object.rotation.set(rot[0], rot[1], rot[2]);
        object.scale.set(scale[0], scale[1], scale[2]);
        worldRoot.add(object);
      }
      if (p.kind === 'right') applyModelPreset(p.itemId, object);
      break;
    }
    case 'crate':
      if (register) { record = spawnSmashCrate(x, y, z, entity.loot || null, { rot, scale }); object = record.mesh; }
      else {
        object = buildCrateMesh();
        object.position.set(x, y, z); object.rotation.set(rot[0], rot[1], rot[2]);
        object.scale.set(scale[0], scale[1], scale[2]); worldRoot.add(object);
      }
      break;
    case 'barrel':
      if (register) { record = spawnHazardBarrel(x, y, z, { rot, scale }); object = record.mesh; }
      else {
        object = buildBarrelMesh();
        object.position.set(x, y, z); object.rotation.set(rot[0], rot[1], rot[2]);
        object.scale.set(scale[0], scale[1], scale[2]); worldRoot.add(object);
      }
      break;
    case 'building':
      object = makeBuildingMesh(entity);
      object.position.set(x, y, z); object.rotation.set(rot[0], rot[1], rot[2]);
      object.scale.set(scale[0], scale[1], scale[2]); worldRoot.add(object);
      if (register) {
        object.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(object);
        record = addSolidBox(b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z, 'entity_building', true);
      }
      break;
    case 'road':
      object = makeRoadMesh(entity);
      object.position.set(x, y, z); object.rotation.set(rot[0], rot[1], rot[2]);
      object.scale.set(scale[0], scale[1], scale[2]); worldRoot.add(object);
      if (register) record = registerRoadRamp(object, entity);
      break;
    case 'ramp':
      object = makeRampMesh(entity.color);
      object.position.set(x, y, z); object.rotation.set(rot[0], rot[1], rot[2]);
      object.scale.set(scale[0], scale[1], scale[2]); worldRoot.add(object);
      if (register) record = registerEntityRamp(object, entity);
      break;
    case 'block':
    case 'prop': {
      const shape = entity.type === 'block' ? 'box' : ((entity.prop && entity.prop.shape) || 'box');
      object = makePrimitiveMesh(shape, entity.color, entity.type === 'block' ? 0x94a3b8 : 0x38bdf8);
      object.position.set(x, y, z); object.rotation.set(rot[0], rot[1], rot[2]);
      object.scale.set(scale[0], scale[1], scale[2]); worldRoot.add(object);
      const solid = entity.type === 'block' || !entity.prop || entity.prop.solid !== false;
      if (register && solid) {
        object.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(object);
        record = addSolidBox(b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z, 'entity_' + entity.type, true);
      }
      break;
    }
    default:
      console.warn('[worldRuntime] unknown entity type', entity.type);
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
      const i = sculptableTerrainMeshes.indexOf(child);
      if (i !== -1) sculptableTerrainMeshes.splice(i, 1);
    });
  }

  if (rec) {
    if (rec.record) {
      if ('minX' in rec.record && 'maxY' in rec.record) removeSolidBox(rec.record);
      else removeRamp(rec.record);
      for (const arr of [worldPickups, smashableCrates, hazardBarrels]) {
        const i = arr.indexOf(rec.record);
        if (i !== -1) arr.splice(i, 1);
      }
    }
    if (rec.entity && rec.entity.type === 'vehicle') {
      const vi = vehicles.findIndex((v) => v.root === rec.object);
      if (vi !== -1) vehicles.splice(vi, 1);
    }
    if (targetObj) {
      const bb = new THREE.Box3().setFromObject(targetObj);
      if (!bb.isEmpty()) {
        const eps = 0.6;
        for (let i = worldBoxes.length - 1; i >= 0; i--) {
          const b = worldBoxes[i];
          if (!b.tag || !b.tag.startsWith('entity_')) continue;
          if (b.minX >= bb.min.x - eps && b.maxX <= bb.max.x + eps &&
              b.minZ >= bb.min.z - eps && b.maxZ <= bb.max.z + eps &&
              b.minY >= bb.min.y - eps && b.maxY <= bb.max.y + eps) removeSolidBox(b);
        }
      }
    }
    if (rec.object && rec.object.parent) rec.object.parent.remove(rec.object);
    for (const path of [...studioObjects.keys()]) {
      if (path === `entity:${id}` || path.startsWith(`entity:${id}/`)) {
        studioObjects.delete(path); studioBaseTransforms.delete(path);
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
      if ('minX' in rec.record && 'maxY' in rec.record) removeSolidBox(rec.record);
      else removeRamp(rec.record);
    }
    rec.record = entity.type === 'road' ? registerRoadRamp(o, entity) : registerEntityRamp(o, entity);
    rec.entity = entity;
    return;
  }
  if (rec.record && 'minX' in rec.record && 'maxY' in rec.record) {
    const bb = new THREE.Box3().setFromObject(o);
    // Mutate in place, then re-index: the box may have moved cells.
    removeSolidBox(rec.record);
    rec.record = addSolidBox(bb.min.x, bb.max.x, bb.min.y, bb.max.y, bb.min.z, bb.max.z,
      rec.record.tag, rec.record.climbable);
  }
  rec.entity = entity;
}

// =============================================================================
// SECTION 11 — FRAME TICK & WATER HOOK
// =============================================================================
function updateWaterOnce(dt, elapsed) {
  if (elapsed === lastWaterFrame) return;
  lastWaterFrame = elapsed;
  updateWater(dt, elapsed);
}

/** ONE call per frame. Replaces the four separate update entry points. */
export function updateWorldFrame(dt, elapsed) {
  updateWorldStream();
  updateLampposts(dt, elapsed);
  updateWorldSystems(dt, elapsed);
  updateEdgeBarrier();
  updateRiverFlow(dt);
  updateWaterOnce(dt, elapsed);
}

export function revealAllLods() {
  revealAllCells();
  revealEdgeBarrier();
}
export function restoreAllLods() { restoreCulling(); }

// =============================================================================
// SECTION 12 — LEGACY BUILD ENTRY POINTS (Studio back-compat)
// =============================================================================
const stepOf = (id) => longestPrefix(PLACEMENT_STEP, id);
const runLegacyStep = (step) => runStep(step, { data: levelData, register: true, afterStatic: null });

export const buildRoadsFreewayAndDesert = () => { runLegacyStep('terrain'); runLegacyStep('roads:city+desert'); };
export const buildRedrockDesertBiome   = () => runLegacyStep('biome:redrock');
export const buildNewBiomes            = () => runLegacyStep('biome:frostpine+woods+cove');
export const buildJungleBiome          = () => runLegacyStep('biome:jungle');
export const buildCityLandmarks        = () => runLegacyStep('district:sunnyvale');
export const buildMountains            = () => runLegacyStep('terrain:mountains');
export const buildAuraEstates          = () => runLegacyStep('district:aura_hills+estates');
export const buildAuraSkylineAndHighway= () => runLegacyStep('district:westside');
export const buildLosAuraNorthExpansion= () => runLegacyStep('district:boardwalk+lax+speedway');
export const buildTowerDistricts       = () => runLegacyStep('towers');
export const buildGroundIntegrityLegacy= () => buildGroundIntegrity(SYSTEMS.groundIntegrity, worldRoot);

export {
  buildWalkInHouse, buildSuburbanHouse, buildSuburbanHouseBase, embellishHouse,
  buildHotdogStore, buildCarDealership, buildReserveBank, buildFirearmsArmory,
  buildCriminalHideout, buildSkyscraper, buildSkyscraperBase, embellishTower,
  buildPlazaHotdogCart, createTree, createHydrant, createBusShelter,
  buildKnockableLamppost, knockOverLamppost, knockOverLamppostBase, updateLampposts,
  buildSewer, buildEdgeBarrier, updateEdgeBarrier,
  sculptableTerrainMeshes, refreshTerrainSculpt, bio, bioC,
  reserveFootprint, footprintClear,
  // kit passthroughs used by gameplay / Studio
  makeBox, makeMesh, buildCompound, xform, flushInstances, inst, instMatrix,
  addSolidBox, removeSolidBox, removeSolidBoxes, queryBoxes, reindexAll,
  addRamp, removeRamp, resolveMat, groundMat, signBoxMaterials, signMaterials,
  definePrefab, definePalette, defineGeo, rngFor, dist2, UNIT_BOX,
  place, placeAll, getPlacement, anchor, kitStats, streamStats,
  primeCell, getCell, unregisterCell,
  coord, resolveRowXZ, maxTerrainOver, frostCreekX, riverSurfaceAt,
  getWaterHeightAt, getWaterDepthAt, isSwimming, swimState
};

/** Aliases for the two names the old world.js exported. */
export const buildWallWithRealWindow = wallWithWindow;
export const createNeonSign = neon;
export { buildGroundIntegrityLegacy as buildGroundIntegrity };

// Back-compatible no-ops: one streamer runs everything now.
export function updateBuildingLods() { /* updateWorldFrame() */ }
export function updateSkyscraperInteriors() { /* updateWorldFrame() */ }
export function updateAuraCulls() { /* updateWorldFrame() */ }
export function updateBiomeAtmosphere(dt, elapsed) { updateWorldFrame(dt, elapsed); }

// =============================================================================
// SECTION 13 — LATE-BOUND HOOKS
// =============================================================================
Object.assign(hooks, {
  knockOverLamppost,
  updateWater: updateWaterOnce,
  resetWaterSystem,
  getWaterHeightAt,
  getWaterDepthAt,
  isSwimming,
  swimState,
  recomputeWorldBounds,
  buildWorld,
  worldRuntimeStats: () => ({ ...kitStats(), stream: streamStats(), boot: lastBootReport })
});

export default {
  buildWorld, disposeWorld, updateWorldFrame, bootReport, worldCatalog,
  createEntityObject, spawnLevelEntities, removeEntityObject, updateEntityTransform,
  applyStudioWorldTransforms, revealAllLods, restoreAllLods,
  entityObjects, studioObjects, sculptableTerrainMeshes, refreshTerrainSculpt
};