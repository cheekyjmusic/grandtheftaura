// =============================================================================
// worldSystems/airport.js — DEPARTURES BOARD REFRESH + BAGGAGE CAROUSEL
// Reads handles published by worldObjects/airport.js.
// =============================================================================
import { player } from '../state.js';
import { dist2, getPlacement } from '../worldKit.js';

let board = null, carousel = null, tick = 0;
let cfg = { boardRefresh: 2.4, boardRange: 120, carouselSpeed: 0.35 };
let centre = [248, 565];

export function install({ spec = {} } = {}) {
  cfg = { ...cfg, ...spec };
  const rec = getPlacement('lax/terminal');
  board = rec?.data?.board || null;
  carousel = rec?.data?.carousel || null;
  if (rec?.row?.at) centre = [rec.row.at[0], rec.row.at[1]];
  tick = 0;
}

export function update(dt) {
  if (carousel) carousel.rotation.y += dt * cfg.carouselSpeed;
  if (!board) return;
  if (dist2(player.x, player.z, centre[0], centre[1]) > cfg.boardRange ** 2) return;
  tick += dt;
  if (tick < cfg.boardRefresh) return;
  tick = 0;
  const rows = board.rows;
  if (!rows?.length) return;
  const r = rows[Math.floor(Math.random() * rows.length)];
  const st = board.statuses || ['ON TIME', 'BOARDING', 'DELAYED'];
  r.status = st[Math.floor(Math.random() * st.length)];
  board.draw();
}

export function reset() { board = null; carousel = null; tick = 0; }
export default { install, update, reset };