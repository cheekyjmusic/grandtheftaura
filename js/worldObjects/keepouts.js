// =============================================================================
// worldObjects/keepouts.js — SCATTER EXCLUSION VOLUMES
//
// Leaf module: ZERO imports. This is deliberate — worldTerrain, worldRoads and
// worldObjects/index all need to publish keep-outs, and index.js transitively
// imports worldTerrain. Putting the list here breaks that cycle.
//
// Publishers: road_loop / road_ribbon / road_run / river_system / pullout.
// Consumer:   expandScatters({ filter:{ avoid:'keepouts' } }).
// =============================================================================
const keepouts = [];

export function addKeepout(x, z, r, tag = '') {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !(r > 0)) return keepouts.length;
  keepouts.push({ x, z, r, tag });
  return keepouts.length;
}

/** Publish a keep-out every `step` metres along a polyline. */
export function addKeepoutPath(pts, r, tag = '', step = 1) {
  const n = Math.max(1, Math.round(step));
  for (let i = 0; i < pts.length; i += n) addKeepout(pts[i].x, pts[i].z, r, tag);
  return keepouts.length;
}

export function clearKeepouts() { keepouts.length = 0; }

export function keepoutClear(x, z, r = 0) {
  for (let i = 0; i < keepouts.length; i++) {
    const k = keepouts[i], dx = x - k.x, dz = z - k.z, rr = k.r + r;
    if (dx * dx + dz * dz < rr * rr) return false;
  }
  return true;
}

export function allKeepouts() { return keepouts; }
export function keepoutCount() { return keepouts.length; }

export default { addKeepout, addKeepoutPath, clearKeepouts, keepoutClear, allKeepouts, keepoutCount };