// =============================================================================
// worldSystems/towerLift.js — RIDE THE LIFT BETWEEN STREAMED FLOORS
//
// New capability the refactor unlocks: every tower publishes floorPads, and
// primeCell() force-loads a floor BEFORE the player is teleported onto it, so
// there is never a frame standing on nothing.
//
// [F] near a lift pad rides to the next floor up (wraps to the lobby at the top).
// Chains onto aura.ahF AFTER armory, and falls through when not at a lift.
// =============================================================================
import { aura, gameState, player, skyscrapers } from '../state.js';
import { dist2 } from '../worldKit.js';
import { primeCell } from '../worldStream.js';

const RANGE2 = 2.6 * 2.6;
let towers = [];

function nearestPad() {
  if (gameState.screen !== 'playing' || gameState.inCar) return null;
  let best = null;
  for (const sk of towers) {
    for (const pad of sk.floorPads || []) {
      if (Math.abs((player.y || 0) - pad.y) > 2.0) continue;
      const d2 = dist2(player.x, player.z, pad.x, pad.z);
      if (d2 < RANGE2 && (!best || d2 < best.d2)) best = { sk, pad, d2 };
    }
  }
  return best;
}

function ride() {
  const n = nearestPad();
  if (!n) return false;
  const pads = n.sk.floorPads;
  const next = pads[(n.pad.i + 1) % pads.length];
  if (next.cell) primeCell(next.cell);      // floor exists before we arrive
  player.x = next.x;
  player.z = next.z;
  player.y = next.y + 0.2;
  if ('vy' in player) player.vy = 0;
  return true;
}

export function install() {
  towers = skyscrapers.filter((sk) => Array.isArray(sk.floorPads) && sk.floorPads.length > 1);
  const prevHint = aura.ahHint, prevF = aura.ahF;
  aura.ahHint = () => {
    const n = nearestPad();
    if (n) {
      const pads = n.sk.floorPads;
      const next = pads[(n.pad.i + 1) % pads.length];
      return `[F] LIFT ▲ ${next.i === 0 ? 'LOBBY' : 'FLOOR ' + next.i}`;
    }
    return prevHint ? prevHint() : '';
  };
  aura.ahF = () => { if (ride()) return; if (prevF) prevF(); };
}

export function reset() { towers = []; }
export default { install, reset };