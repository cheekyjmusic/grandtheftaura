// =============================================================================
// worldObjects/catalog.js — LIVE MODEL CATALOGUE (vehicles.js + aircraft.js)
//
// Discovers every model the game actually ships, instead of a hand-maintained
// list. Reads whatever shape those modules export (catalogue array, id map, or
// plain build*Mesh functions) and registers each one as a placeable prefab
// `model:<id>` so Studio and the game build the exact same object.
//
// aircraft.js is optional: a missing file degrades to vehicles only.
// =============================================================================
import * as THREE from 'three';
import { worldRoot } from '../engine.js';
import { addSolidBox, registerBuilder } from '../worldKit.js';

const entries = new Map();
const CATALOG_KEYS = [
  'VEHICLE_CATALOG', 'AIRCRAFT_CATALOG', 'CATALOG', 'VEHICLE_TYPES', 'AIRCRAFT_TYPES',
  'VEHICLE_PRESETS', 'AIRCRAFT_PRESETS', 'VEHICLES', 'AIRCRAFT', 'MODELS', 'BUILDERS'
];

const pascal = (s) => String(s).replace(/(^|[_\-\s]+)(\w)/g, (_m, _p, c) => c.toUpperCase());
const snake = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toLowerCase();
const title = (s) => String(s).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Builders return Object3D | {root} | {mesh} | {group} — normalise all four. */
function toObject(res) {
  if (!res) return null;
  if (res.isObject3D) return res;
  return res.root || res.mesh || res.group || res.object || null;
}

/** A live runtime record (has x/yaw/root) is state, not a catalogue definition. */
function isLiveRecord(v) {
  return v && typeof v === 'object' && 'root' in v && ('yaw' in v || 'x' in v);
}

function normalize(source) {
  const out = [];
  if (!source) return out;
  if (source instanceof Map) {
    for (const [id, def] of source) out.push({ id: String(id), def });
  } else if (Array.isArray(source)) {
    for (const def of source) {
      if (!def || isLiveRecord(def)) continue;
      const id = def.id || def.key || def.name;
      if (id) out.push({ id: String(id), def });
    }
  } else if (typeof source === 'object') {
    for (const [id, def] of Object.entries(source)) {
      if (isLiveRecord(def)) continue;
      out.push({ id, def: typeof def === 'function' ? { build: def } : def });
    }
  }
  return out;
}

function pickBuilder(mod, id, def, kind) {
  const P = pascal(id);
  const cands = [
    def?.buildMesh, def?.build, def?.mesh, def?.make,
    mod[`build${P}Mesh`], mod[`build${P}`], mod[`build_${snake(id)}_mesh`],
    kind === 'aircraft'
      ? (mod.buildAircraftMesh || mod.buildAircraft || mod.buildPlaneMesh)
      : (mod.buildSportsCarMesh || mod.buildSportsCar)
  ];
  return cands.find((f) => typeof f === 'function') || null;
}

function harvest(mod, kind) {
  if (!mod) return;
  let found = [];
  for (const key of CATALOG_KEYS) {
    if (mod[key]) { found = normalize(mod[key]); if (found.length) break; }
  }
  if (!found.length && mod.default && typeof mod.default === 'object') found = normalize(mod.default);
  if (!found.length) {
    // No catalogue exported — derive one from the builder functions themselves.
    for (const [name, fn] of Object.entries(mod)) {
      const m = /^build([A-Z]\w*)Mesh$/.exec(name);
      if (m && typeof fn === 'function') found.push({ id: snake(m[1]), def: { buildMesh: fn } });
    }
  }
  for (const { id, def } of found) {
    if (!id || entries.has(id)) continue;
    const fn = pickBuilder(mod, id, def || {}, kind);
    if (!fn) continue;
    const cfg = {
      name: def?.name || title(id),
      bodyHex: def?.bodyHex ?? def?.color ?? (kind === 'aircraft' ? 0xe2e8f0 : 0xdc2626),
      accentHex: def?.accentHex ?? 0x0f172a,
      isCoupe: def?.isCoupe !== false,
      isSupercar: !!def?.isSupercar,
      isBus: !!def?.isBus,
      isAircraft: kind === 'aircraft',
      ...(def?.cfg || {}),
      ...(def && typeof def === 'object' ? def : {})
    };
    delete cfg.build; delete cfg.buildMesh; delete cfg.mesh; delete cfg.make;
    entries.set(id, {
      id, kind, name: cfg.name, glyph: kind === 'aircraft' ? '✈' : '◢', cfg,
      make: (over = {}) => toObject(fn({ ...cfg, ...over }))
    });
  }
}

/** One placeable prefab per discovered model. Uses only `row`, never kit ctx. */
export function buildCatalogProp(row) {
  const e = entries.get(row.model);
  if (!e) { console.warn('[catalog] unknown model', row.model); return null; }
  const obj = e.make({
    name: row.name || e.name,
    bodyHex: row.body ?? e.cfg.bodyHex,
    accentHex: row.accent ?? e.cfg.accentHex
  });
  if (!obj) return null;
  const [x, y, z] = row.at || [0, 0, 0];
  obj.position.set(x, y, z);
  obj.rotation.set(row.rx || 0, row.ry || 0, row.rz || 0);
  const s = row.s ?? 1;
  obj.scale.setScalar(s);
  obj.userData.studioName = row.name || e.name;
  (row.parent || worldRoot).add(obj);
  const boxes = [];
  if (row.solid !== false) {
    obj.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(obj);
    if (!b.isEmpty()) boxes.push(addSolidBox(b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z, 'authored_prop', true));
  }
  return { object: obj, boxes, model: e.id, kind: e.kind };
}

function registerAll() {
  for (const e of entries.values()) {
    registerBuilder(`model:${e.id}`, (row) => buildCatalogProp({ ...row, model: e.id }), {
      params: ['at', 'ry', 's', 'name', 'body', 'accent', 'solid'],
      doc: `${e.kind} from ${e.kind === 'aircraft' ? 'aircraft.js' : 'vehicles.js'}`
    });
  }
  registerBuilder('catalog_model', buildCatalogProp, { params: ['model', 'at', 'ry', 's'] });
}

export const catalogReady = (async () => {
  const [v, a] = await Promise.all([
    import('../vehicles.js').catch(() => null),
    import('../aircraft.js').catch(() => null)
  ]);
  harvest(v, 'vehicle');
  harvest(a, 'aircraft');
  registerAll();
  return list();
})();

export function list() { return [...entries.values()]; }
export function get(id) { return entries.get(id) || null; }

/** Rows for Studio's Models list. */
export function catalogModels() {
  return list().map((e) => ({
    id: `cat:${e.id}`, name: e.name, glyph: e.glyph, catalogId: e.id, kind: e.kind,
    build: () => e.make() || new THREE.Group()
  }));
}

export default { catalogReady, catalogModels, list, get, buildCatalogProp };