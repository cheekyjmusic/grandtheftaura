// =============================================================================
// worldSystems/index.js — SYSTEM REGISTRY & FRAME DISPATCH
//
// worldRuntime drives install() from BOOT, in this order:
//   sewer → estates → hideout → airport → armory → towerLift → atmosphere
// ESTATES MUST INSTALL BEFORE ARMORY, and towerLift last: each chains onto
// aura.ahF / aura.ahHint, so the last installer is the first handler called.
//
// updateEdgeBarrier() is NOT in the update list — worldRuntime calls it
// separately so it keeps ticking even if a system throws.
// =============================================================================
import * as sewer from './sewer.js';
import * as estates from './estates.js';
import * as armory from './armory.js';
import * as airport from './airport.js';
import * as atmosphere from './atmosphere.js';
import * as edgeBarrier from './edgeBarrier.js';
import * as towerLift from './towerLift.js';
import * as hideout from './hideout.js';

export const systems = { sewer, estates, armory, airport, atmosphere, edgeBarrier, towerLift, hideout };

const TICK = [sewer, estates, armory, airport, atmosphere];
const ALL = [sewer, estates, armory, airport, atmosphere, edgeBarrier, towerLift, hideout];

export function updateWorldSystems(dt, elapsed) {
  for (const s of TICK) {
    if (!s.update) continue;
    try { s.update(dt, elapsed); }
    catch (err) { console.error('[worldSystems] update failed:', err); }
  }
}

export function resetWorldSystems() {
  for (const s of ALL) {
    if (!s.reset) continue;
    try { s.reset(); }
    catch (err) { console.error('[worldSystems] reset failed:', err); }
  }
}

export { buildSewer } from './sewer.js';
export { bio, bioC } from './atmosphere.js';
export { buildEdgeBarrier, updateEdgeBarrier, revealEdgeBarrier } from './edgeBarrier.js';
export default systems;