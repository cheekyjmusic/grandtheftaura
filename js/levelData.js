// =============================================================================
// levelData.js — single source of truth for tunable parameters, asset bindings,
// model presets and editable world entities.
//
//  * The game (index.html) and the editor (studio.html) both import `levelData`.
//  * Studio edits the live object, can "Save & Test in Game" (localStorage) and
//    "Export levelData.js" (rewrites the DEFAULT_LEVEL_DATA block below).
//  * Layer 0 of the import hierarchy: this file imports nothing.
// =============================================================================

export const LEVEL_STORAGE_KEY = 'gta_aura_studio_level';

// ---- DEFAULT_LEVEL_DATA:BEGIN (Studio "Export levelData.js" rewrites this block) ----
export const DEFAULT_LEVEL_DATA = {
  "version": 1,
  "terrain": { "cellSize": 2, "heights": {} },
  "worldTransforms": {},
  "assets": {
    "textures": ["assets/textures/sample_grid.png"],
    "audio": []
  },
  "audioBindings": {
    "punch": "",
    "batSwing": "",
    "hotdogFire": "",
    "pickup": "",
    "carHorn": "",
    "engineLoop": "",
    "bgMusic": ""
  },
  "params": {
    "player": {
      "maxHp": 100,
      "startCash": 150,
      "moveSpeed": 4.7,
      "sprintMultiplier": 1.83,
      "jumpForce": 7.1,
      "bodyColor": "#1e293b",
      "accentColor": "#0f172a"
    },
    "weapons": {
      "fists": { "damage": 18, "cooldown": 0.28, "reach": 2.05 },
      "bat": { "damage": 45, "cooldown": 0.46, "reach": 2.55 },
      "crowbar": { "damage": 60, "cooldown": 0.52, "reach": 2.45 },
      "pipe": { "damage": 52, "cooldown": 0.48, "reach": 2.45 },
      "hotdog_shooter": { "damage": 55, "cooldown": 0.095, "reach": 85 }
    },
    "vehicles": {
      "gearCapsMph": [36, 0, 39, 66, 95, 125, 154, 180],
      "accelMultiplier": 1,
      "brakeMultiplier": 1,
      "steerMultiplier": 1,
      "gripMultiplier": 1
    },
    "models": {
      "player": { "color": "", "texture": "", "texRepeat": [1, 1] },
      "apex_gt": { "color": "", "texture": "", "texRepeat": [1, 1] },
      "coupe": { "color": "", "texture": "", "texRepeat": [1, 1] },
      "hotdog_shooter": { "color": "", "texture": "", "texRepeat": [1, 1] },
      "bat": { "color": "", "texture": "", "texRepeat": [1, 1] },
      "crowbar": { "color": "", "texture": "", "texRepeat": [1, 1] },
      "pipe": { "color": "", "texture": "", "texRepeat": [1, 1] },
      "npc_guard": { "color": "", "texture": "", "texRepeat": [1, 1], "shirtColor": "#1d4ed8", "pantsColor": "#0b1220" }
    }
  },
  "entities": [
    { "id": "veh_apex_gt", "type": "vehicle", "name": "AURA APEX GT SUPERCAR", "pos": [0, 0.12, -48.2], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "",
      "vehicle": { "bodyHex": "#f97316", "accentHex": "#0f172a", "isCoupe": true, "isSupercar": true } },
    { "id": "veh_crimson_coupe", "type": "vehicle", "name": "CRIMSON SPORTS COUPE", "pos": [-19.5, 0.12, 6], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "",
      "vehicle": { "bodyHex": "#dc2626", "accentHex": "#f8fafc", "isCoupe": true, "isSupercar": false } },
    { "id": "veh_midnight_sedan", "type": "vehicle", "name": "MIDNIGHT MUSCLE SEDAN", "pos": [19.5, 0.12, -34], "rot": [0, 3.141592653589793, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "",
      "vehicle": { "bodyHex": "#1d4ed8", "accentHex": "#38bdf8", "isCoupe": false, "isSupercar": false } },
    { "id": "veh_slate_suv", "type": "vehicle", "name": "SLATE URBAN SUV", "pos": [-24, 0.12, -67.5], "rot": [0, 1.5707963267948966, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "",
      "vehicle": { "bodyHex": "#e2e8f0", "accentHex": "#f59e0b", "isCoupe": false, "isSupercar": false } },
    { "id": "veh_desert_interceptor", "type": "vehicle", "name": "REDROCK DESERT INTERCEPTOR", "pos": [244, 0.12, 40], "rot": [0, -1.5707963267948966, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "",
      "vehicle": { "bodyHex": "#f59e0b", "accentHex": "#1e293b", "isCoupe": true, "isSupercar": false } },

    { "id": "crate_1", "type": "crate", "name": "Smash Crate (cash)", "pos": [13.5, 0.18, -12.5], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "", "loot": { "type": "left", "id": "cash" } },
    { "id": "crate_2", "type": "crate", "name": "Smash Crate (soda)", "pos": [14.8, 0.18, -12.5], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "", "loot": { "type": "left", "id": "soda" } },
    { "id": "crate_3", "type": "crate", "name": "Smash Crate (crowbar)", "pos": [-52.5, 0.18, -42], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "", "loot": { "type": "right", "id": "crowbar" } },
    { "id": "crate_4", "type": "crate", "name": "Smash Crate (medkit)", "pos": [49.5, 0.18, -55], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "", "loot": { "type": "left", "id": "medkit" } },
    { "id": "crate_5", "type": "crate", "name": "Smash Crate (cash, rooftop)", "pos": [49.6, 7.53, -42.6], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "", "loot": { "type": "left", "id": "cash" } },
    { "id": "crate_6", "type": "crate", "name": "Smash Crate (pipe)", "pos": [47.4, 4.68, 46.5], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "", "loot": { "type": "right", "id": "pipe" } },
    { "id": "crate_7", "type": "crate", "name": "Smash Crate (burger)", "pos": [41.2, 0.18, 41.2], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "", "loot": { "type": "left", "id": "burger" } },
    { "id": "crate_8", "type": "crate", "name": "Smash Crate (cash)", "pos": [-4, 0.18, 39.2], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "", "loot": { "type": "left", "id": "cash" } },

    { "id": "barrel_1", "type": "barrel", "name": "Hazard Barrel", "pos": [35, 0.18, 42], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "" },
    { "id": "barrel_2", "type": "barrel", "name": "Hazard Barrel", "pos": [35, 0.18, 48], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "" },
    { "id": "barrel_3", "type": "barrel", "name": "Hazard Barrel", "pos": [-45.5, 0.18, -56], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "" },
    { "id": "barrel_4", "type": "barrel", "name": "Hazard Barrel", "pos": [51.5, 0.18, -41.5], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "" },

    { "id": "pickup_hotdog_shooter", "type": "pickup", "name": "Hotdog Shooter Pickup", "pos": [-41.8, 0.18, -41.2], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "", "pickup": { "kind": "right", "itemId": "hotdog_shooter" } },
    { "id": "pickup_crowbar", "type": "pickup", "name": "Crowbar Pickup", "pos": [49.5, 0.18, -42], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "", "pickup": { "kind": "right", "itemId": "crowbar" } },
    { "id": "pickup_pipe", "type": "pickup", "name": "Pipe Pickup", "pos": [40.8, 2.59, 45], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "", "pickup": { "kind": "right", "itemId": "pipe" } },
    { "id": "pickup_cash_1", "type": "pickup", "name": "Cash Pickup", "pos": [0, 2.42, 0], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "", "pickup": { "kind": "left", "itemId": "cash" } },
    { "id": "pickup_cash_2", "type": "pickup", "name": "Cash Pickup", "pos": [4.8, 0.32, -101], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "", "pickup": { "kind": "left", "itemId": "cash" } },
    { "id": "pickup_cash_3", "type": "pickup", "name": "Cash Pickup (desert)", "pos": [255, 0.32, 82], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "", "pickup": { "kind": "left", "itemId": "cash" } },
    { "id": "pickup_burger", "type": "pickup", "name": "Burger Pickup", "pos": [-38.5, 0.18, -36.5], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "", "pickup": { "kind": "left", "itemId": "burger" } },
    { "id": "pickup_medkit", "type": "pickup", "name": "Medkit Pickup", "pos": [-8.8, 0.32, 40.5], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "", "pickup": { "kind": "left", "itemId": "medkit" } },
    { "id": "pickup_soda", "type": "pickup", "name": "Energy Drink Pickup", "pos": [41, 0.32, -7.2], "rot": [0, 0, 0], "scale": [1, 1, 1], "texture": "", "texRepeat": [1, 1], "color": "", "pickup": { "kind": "left", "itemId": "soda" } }
  ]
};
// ---- DEFAULT_LEVEL_DATA:END ----

// -----------------------------------------------------------------------------
// Entity type catalogue (used by the world spawner and by Studio's Toolbox).
// -----------------------------------------------------------------------------
export const ENTITY_TYPES = ['vehicle', 'pickup', 'crate', 'barrel', 'ramp', 'block', 'prop', 'building', 'road'];

/** Create a fresh entity of the given prefab with a unique id. */
export function makeEntity(prefab, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const base = { id: '', type: prefab.type, name: prefab.name, pos: [...pos], rot: [...rot], scale: [...(prefab.scale || [1, 1, 1])], texture: '', texRepeat: [1, 1], color: prefab.color || '' };
  const extra = structuredClone(prefab.extra || {});
  return Object.assign(base, extra);
}

export const PREFABS = {
  vehicles: [
    { key: 'veh_supercar', type: 'vehicle', name: 'Apex GT Supercar', extra: { vehicle: { bodyHex: '#f97316', accentHex: '#0f172a', isCoupe: true, isSupercar: true } } },
    { key: 'veh_coupe', type: 'vehicle', name: 'Sports Coupe', extra: { vehicle: { bodyHex: '#dc2626', accentHex: '#f8fafc', isCoupe: true, isSupercar: false } } },
    { key: 'veh_sedan', type: 'vehicle', name: 'Muscle Sedan', extra: { vehicle: { bodyHex: '#1d4ed8', accentHex: '#38bdf8', isCoupe: false, isSupercar: false } } }
  ],
  pickups: [
    { key: 'pk_hotdog', type: 'pickup', name: 'Hotdog Shooter Pickup', extra: { pickup: { kind: 'right', itemId: 'hotdog_shooter' } } },
    { key: 'pk_bat', type: 'pickup', name: 'Wooden Bat Pickup', extra: { pickup: { kind: 'right', itemId: 'bat' } } },
    { key: 'pk_crowbar', type: 'pickup', name: 'Crowbar Pickup', extra: { pickup: { kind: 'right', itemId: 'crowbar' } } },
    { key: 'pk_pipe', type: 'pickup', name: 'Pipe Pickup', extra: { pickup: { kind: 'right', itemId: 'pipe' } } },
    { key: 'pk_medkit', type: 'pickup', name: 'Medkit Pickup', extra: { pickup: { kind: 'left', itemId: 'medkit' } } },
    { key: 'pk_cash', type: 'pickup', name: 'Cash Pickup', extra: { pickup: { kind: 'left', itemId: 'cash' } } },
    { key: 'crate', type: 'crate', name: 'Smash Crate', extra: { loot: { type: 'left', id: 'cash' } } },
    { key: 'barrel', type: 'barrel', name: 'Hazard Barrel' }
  ],
  buildings: [
    { key: 'building_office', type: 'building', name: 'Office Building', scale: [1, 1, 1], color: '#64748b', extra: { building: { width: 14, depth: 12, height: 28, roofColor: '#1e293b', windowColor: '#7dd3fc' } } },
    { key: 'building_house', type: 'building', name: 'House', scale: [1, 1, 1], color: '#d6b38a', extra: { building: { width: 10, depth: 9, height: 6, roofColor: '#9a3412', windowColor: '#93c5fd' } } },
    { key: 'building_warehouse', type: 'building', name: 'Warehouse', scale: [1, 1, 1], color: '#a3a3a3', extra: { building: { width: 22, depth: 16, height: 9, roofColor: '#475569', windowColor: '#bae6fd' } } }
  ],
  mapPieces: [
    { key: 'road_straight', type: 'road', name: 'Road Segment', scale: [1, 1, 1], color: '#313946', extra: { road: { width: 24, depth: 12, markings: true } } }
  ],
  parts: [
    { key: 'ramp', type: 'ramp', name: 'Stunt Ramp', scale: [8, 3, 12], color: '#f59e0b' },
    { key: 'block', type: 'block', name: 'Solid Block', scale: [4, 2, 4], color: '#94a3b8' },
    { key: 'barrier', type: 'block', name: 'Jersey Barrier', scale: [4, 1.05, 0.7], color: '#d1d5db' },
    { key: 'prop_cyl', type: 'prop', name: 'Cylinder Prop', scale: [1.2, 2, 1.2], color: '#38bdf8', extra: { prop: { shape: 'cylinder', solid: true } } },
    { key: 'prop_sphere', type: 'prop', name: 'Sphere Prop', scale: [2, 2, 2], color: '#f472b6', extra: { prop: { shape: 'sphere', solid: true } } },
    { key: 'prop_cone', type: 'prop', name: 'Cone Prop', scale: [1.4, 2.4, 1.4], color: '#fb923c', extra: { prop: { shape: 'cone', solid: false } } }
  ]
};

// -----------------------------------------------------------------------------
// Load / save helpers
// -----------------------------------------------------------------------------
function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

/** Deep-merge saved data over defaults so older saves keep working. */
function mergeDefaults(def, saved) {
  if (Array.isArray(def)) return Array.isArray(saved) ? structuredClone(saved) : structuredClone(def);
  if (!isPlainObject(def)) return saved === undefined ? def : saved;
  const out = {};
  for (const k of Object.keys(def)) out[k] = mergeDefaults(def[k], isPlainObject(saved) ? saved[k] : undefined);
  if (isPlainObject(saved)) for (const k of Object.keys(saved)) if (!(k in out)) out[k] = structuredClone(saved[k]);
  return out;
}

/** Reads localStorage override if valid JSON exists, else a clone of the defaults. */
export function loadLevelData() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LEVEL_STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isPlainObject(parsed) && isPlainObject(parsed.params) && Array.isArray(parsed.entities)) {
        const merged = mergeDefaults(DEFAULT_LEVEL_DATA, parsed);
        merged.entities = structuredClone(parsed.entities);
        return merged;
      }
    }
  } catch (err) {
    console.warn('[levelData] ignoring invalid saved level:', err);
  }
  return structuredClone(DEFAULT_LEVEL_DATA);
}

/** Live singleton shared by every module (mutated in place by Studio). */
export const levelData = loadLevelData();

const TERRAIN_CELL_SIZE = 2;

function terrainCell(heights, x, z) {
  return Number(heights[`${x},${z}`]) || 0;
}

/** Bilinearly sample the saved terrain height offset at world coordinates. */
export function terrainHeightOffset(x, z, data = levelData) {
  const heights = data.terrain && data.terrain.heights;
  if (!heights) return 0;
  const gx = x / TERRAIN_CELL_SIZE, gz = z / TERRAIN_CELL_SIZE;
  const x0 = Math.floor(gx), z0 = Math.floor(gz);
  const tx = gx - x0, tz = gz - z0;
  const a = terrainCell(heights, x0, z0), b = terrainCell(heights, x0 + 1, z0);
  const c = terrainCell(heights, x0, z0 + 1), d = terrainCell(heights, x0 + 1, z0 + 1);
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

/** Raise, lower, or smooth the saved terrain heightfield with a soft circular brush. */
export function sculptTerrain(data, centerX, centerZ, radius, strength, mode = 'raise', baseHeightAt = () => 0) {
  if (!data.terrain || typeof data.terrain !== 'object') data.terrain = { cellSize: TERRAIN_CELL_SIZE, heights: {} };
  if (!data.terrain.heights || typeof data.terrain.heights !== 'object') data.terrain.heights = {};
  const heights = data.terrain.heights;
  const minX = Math.floor((centerX - radius) / TERRAIN_CELL_SIZE);
  const maxX = Math.ceil((centerX + radius) / TERRAIN_CELL_SIZE);
  const minZ = Math.floor((centerZ - radius) / TERRAIN_CELL_SIZE);
  const maxZ = Math.ceil((centerZ + radius) / TERRAIN_CELL_SIZE);
  const before = mode === 'smooth' ? { ...heights } : heights;
  const read = (x, z) => terrainCell(before, x, z);
  for (let iz = minZ; iz <= maxZ; iz++) {
    for (let ix = minX; ix <= maxX; ix++) {
      const distance = Math.hypot(ix * TERRAIN_CELL_SIZE - centerX, iz * TERRAIN_CELL_SIZE - centerZ);
      if (distance >= radius) continue;
      const t = 1 - distance / radius;
      const falloff = t * t * (3 - 2 * t);
      const key = `${ix},${iz}`;
      const current = read(ix, iz);
      let next;
      if (mode === 'smooth') {
        let total = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const sx = (ix + dx) * TERRAIN_CELL_SIZE, sz = (iz + dz) * TERRAIN_CELL_SIZE;
            total += baseHeightAt(sx, sz) + read(ix + dx, iz + dz);
          }
        }
        const currentHeight = baseHeightAt(ix * TERRAIN_CELL_SIZE, iz * TERRAIN_CELL_SIZE) + current;
        next = current + (total / 9 - currentHeight) * Math.min(1, strength * falloff);
      } else {
        next = current + (mode === 'lower' ? -1 : 1) * strength * falloff;
      }
      next = Math.round(next * 1000) / 1000;
      if (Math.abs(next) < 0.001) delete heights[key];
      else heights[key] = next;
    }
  }
}

/** Replace the contents of the live singleton while keeping its identity. */
export function replaceLevelData(next) {
  for (const k of Object.keys(levelData)) delete levelData[k];
  Object.assign(levelData, structuredClone(next));
  return levelData;
}

export function saveLevelData(data = levelData) {
  localStorage.setItem(LEVEL_STORAGE_KEY, JSON.stringify(data));
}

export function clearSavedLevelData() {
  localStorage.removeItem(LEVEL_STORAGE_KEY);
}

/** "#rrggbb" | number -> number (0xrrggbb). Empty/invalid -> fallback. */
export function colorToHex(c, fallback = 0xffffff) {
  if (typeof c === 'number') return c;
  if (typeof c === 'string' && /^#?[0-9a-f]{6}$/i.test(c.trim())) return parseInt(c.trim().replace('#', ''), 16);
  return fallback;
}

/** number -> "#rrggbb" */
export function hexToCss(n) {
  return '#' + (Math.max(0, Math.min(0xffffff, n | 0))).toString(16).padStart(6, '0');
}

let _idCounter = 0;
/** Unique entity id inside the given data set. */
export function nextEntityId(prefix, data = levelData) {
  const used = new Set(data.entities.map((e) => e.id));
  let id;
  do { _idCounter++; id = `${prefix}_${Date.now().toString(36)}${_idCounter}`; } while (used.has(id));
  return id;
}
