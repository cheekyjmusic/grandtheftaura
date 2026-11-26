// =============================================================================
// worldSystems/estates.js — GATE, SAFES, ZONE NAMES, [F] HANDLER
//
// Installs BEFORE armory: armory chains onto whatever this leaves on aura.
// Reads handles published by worldObjects/estates.js via getPlacement().data.
// =============================================================================
import { aura, crime, gameState, hooks, player, pushFeed, under } from '../state.js';
import { sfx } from '../audio.js';
import { spawnParticles } from '../items.js';
import { allPlacements, dist2, getPlacement, removeSolidBox } from '../worldKit.js';

let gate = null;
let houses = [];
let cfg = { gateRange: 6, gateCrime: 0.35, safeRange: 2.4, safeReward: 600, safeCrime: 0.5 };

function applyGate(open) {
  if (!open || !gate || gate.open) return;
  gate.open = true;
  for (const b of gate.boxes) removeSolidBox(b);
}
function applySafe(i) {
  const h = houses[i];
  if (!h || h.taken) return;
  h.taken = true;
  if (h.mesh) h.mesh.visible = false;
  spawnParticles(h.x, h.y, h.z, 0xf5c542, 14, 5);
}

function hintText() {
  if (gate && !gate.open && dist2(player.x, player.z, gate.x, gate.z) < cfg.gateRange ** 2) {
    return '[F] FORCE OPEN GATE';
  }
  const r2 = cfg.safeRange ** 2;
  for (const h of houses) {
    if (!h.taken && dist2(player.x, player.z, h.x, h.z) < r2) return '[F] CRACK SAFE';
  }
  return '';
}

function onF() {
  if (gate && !gate.open && dist2(player.x, player.z, gate.x, gate.z) < cfg.gateRange ** 2) {
    applyGate(true);
    sfx.mantle();
    if (!hooks.mpIsGuest()) crime(cfg.gateCrime);
    pushFeed('GATE FORCED OPEN — SECURITY ALERTED', 'border-l-rose-500');
    hooks.mpWorldEvent({ t: 'gate' });
    return;
  }
  const r2 = cfg.safeRange ** 2;
  for (let i = 0; i < houses.length; i++) {
    const h = houses[i];
    if (h.taken || dist2(player.x, player.z, h.x, h.z) >= r2) continue;
    if (hooks.mpIsGuest()) { hooks.mpWorldEvent({ t: 'safe_req', i }); return; }
    applySafe(i);
    gameState.cash += cfg.safeReward;
    sfx.pickup();
    crime(cfg.safeCrime);
    pushFeed(`SAFE CRACKED +$${cfg.safeReward}`, 'border-l-amber-400');
    hooks.updateHUD(true);
    hooks.mpWorldEvent({ t: 'safe', i });
    return;
  }
}

export function install({ spec = {} } = {}) {
  cfg = { ...cfg, ...spec };
  gate = getPlacement('ah/gate')?.data?.gate || null;
  houses = [];
  for (const rec of allPlacements().values()) {
    const s = rec.data?.safe;
    if (s) houses.push({ mesh: s.mesh, x: s.x, y: s.y, z: s.z, taken: false });
  }
  aura.estates = { gate, houses, applyGate, applySafe };
  // Assign (not chain) — this is the base of the [F] handler chain each build.
  aura.ahHint = hintText;
  aura.ahF = onF;
}

export function update(dt) {
  if (gate) {
    const go = gate.open ? (gate.travel ?? 4) : 0;
    const k = Math.min(1, dt * 3);
    const [c1, c2] = gate.closedZ || [-2, 2];
    gate.l1.position.z += ((c1 - go) - gate.l1.position.z) * k;
    gate.l2.position.z += ((c2 + go) - gate.l2.position.z) * k;
  }
  if (!under() && player.x < -196) {
    gameState.zoneName = player.x < -430 ? 'AURA ESTATES'
      : (player.x > -350 && player.x < -220 && Math.abs(player.z) < 105)
        ? 'WESTSIDE DISTRICT' : 'AURA HILLS';
  }
}

export function reset() { gate = null; houses = []; }
export default { install, update, reset };