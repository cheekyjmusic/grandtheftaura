// =============================================================================
// worldSystems/concertHall.js — TROPHY PLAQUES + SLOW DISPLAY SPIN
// Chains onto aura.ahF AFTER estates. Falls through when not at the case.
// =============================================================================
import { aura, player, pushFeed } from '../state.js';
import { sfx } from '../audio.js';
import { dist2, getPlacement } from '../worldKit.js';


const RANGE2 = 2.8 * 2.8;
let trophies = [];

function nearest() {
  let best = null;
  for (const t of trophies) {
    const d2 = dist2(player.x, player.z, t.x, t.z);
    if (d2 < RANGE2 && (!best || d2 < best.d2)) best = { t, d2 };
  }
  return best?.t || null;
}

export function install() {
  trophies = getPlacement('la/concert')?.data?.trophies || [];
  const prevHint = aura.ahHint, prevF = aura.ahF;
  aura.ahHint = () => (nearest() ? '[F] READ PLAQUE' : (prevHint ? prevHint() : ''));
  aura.ahF = () => {
    const t = nearest();
    if (t) {
      sfx.uiClick();
      pushFeed(`${t.label} (${t.year}) — ${t.detail}`, 'border-l-amber-400');
      return;
    }
    if (prevF) prevF();
  };
}

export function update(dt) {
  for (const t of trophies) {
    if (!t.mesh) continue;
    t.spin += dt * 0.35;
    t.mesh.rotation.y = -Math.PI / 2 + t.spin;
  }
}

export function reset() { trophies = []; }
export default { install, update, reset };