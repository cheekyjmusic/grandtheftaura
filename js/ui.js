// =============================================================================
// ui.js — HUD updates, watch rings, minimap, modals, save/load JSON and DOM button bindings (call initUI() once from main.js).
// =============================================================================
import { AO, MAX_HOTDOG_AMMO, ahRz, aura, gameState, hooks, inputState, manholes, mapShapes, meteorDrop, npcs, player, pushFeed, riverX, roadC, sausageRefillZones, under } from './state.js';
import { applyGraphicsTier, canvas, meteorGroup, meteorReticle } from './engine.js';
import { sfx } from './audio.js';
import { LEFT_ITEMS, RIGHT_WEAPONS, dropLeftSlot, useLeftHandItem } from './items.js';
import { GEAR_CAPS_MPH, GEAR_LABELS, exitCurrentCar, vehicles } from './vehicles.js';
import { CLAN_DEFS, activeClanAlertText } from './npcs.js';
import { syncEquippedMeshes, triggerMeteorLanding } from './player.js';

export let hudClock = 0;
const _txt = new WeakMap(), _html = new WeakMap(), _cls = new WeakMap(), _disp = new WeakMap(), _attr = new WeakMap();
function setText(el, v) { if (el && _txt.get(el) !== v) { _txt.set(el, v); el.textContent = v; } }
function setHTML(el, v) { if (el && _html.get(el) !== v) { _html.set(el, v); el.innerHTML = v; } }
function setClass(el, v) { if (el && _cls.get(el) !== v) { _cls.set(el, v); el.className = v; } }
function setDisp(el, v) { if (el && _disp.get(el) !== v) { _disp.set(el, v); el.style.display = v; } }
function setAttr(el, k, v) { const m = _attr.get(el) || {}; if (m[k] !== v) { m[k] = v; _attr.set(el, m); el.setAttribute(k, v); } }
function setWidth(el, v) { if (el && el.__w !== v) { el.__w = v; el.style.width = v; } }
let hotbarEls = null;
function buildHotbar() {
const hb = document.getElementById('hotbar-container');
hb.innerHTML = '';
hotbarEls = [];
for (let i = 0; i < 5; i++) {
const div = document.createElement('div');
div.className = 'hotbar-slot w-14 h-14 p-1.5 flex flex-col justify-between cursor-pointer';
div.innerHTML = `
<div class="flex justify-between items-center text-[9px] font-tactical font-bold leading-none">
<span data-num class="text-slate-400">${i + 1}</span>
<span data-count class="text-slate-300"></span>
</div>
<div data-icon class="flex items-center justify-center my-auto"></div>
<div data-name class="text-[8px] font-tactical uppercase text-center truncate text-slate-200 leading-none"></div>
`;
div.onclick = () => { gameState.activeLeftSlot = i; syncEquippedMeshes(); updateHUD(true); };
hb.appendChild(div);
hotbarEls.push({ root: div, num: div.querySelector('[data-num]'), count: div.querySelector('[data-count]'), icon: div.querySelector('[data-icon]'), name: div.querySelector('[data-name]') });
}
}
function updateHotbar() {
if (!hotbarEls) buildHotbar();
for (let i = 0; i < 5; i++) {
const slot = gameState.leftHotbar[i];
const item = slot ? LEFT_ITEMS[slot.id] : null;
const active = i === gameState.activeLeftSlot;
const el = hotbarEls[i];
el.root.classList.toggle('active', active);
setClass(el.num, active ? 'text-sky-300' : 'text-slate-400');
setText(el.count, slot && slot.count > 1 ? 'x' + slot.count : '');
setHTML(el.icon, item ? item.svg : '<span class="text-[10px]">-</span>');
const color = item ? item.color : '#475569';
if (el.icon.__c !== color) { el.icon.__c = color; el.icon.style.color = color; }
setText(el.name, item ? item.name.split(' ')[0] : 'EMPTY');
}
}
export function updateHUD(force) {
const hn = performance.now();
if (!force && hn - hudClock < 50) return;
hudClock = hn;
setText(document.getElementById('hud-cash'), Math.floor(gameState.cash).toLocaleString());
setText(document.getElementById('hud-zone'), gameState.zoneName);
setText(document.getElementById('hud-pov'), gameState.inCar
? (gameState.thirdPerson ? 'AERIAL 3RD' : 'DRIVER CAB')
: (gameState.thirdPerson ? '3RD PERSON' : '1ST PERSON'));
const clanBadge = document.getElementById('clan-alert-badge');
if (activeClanAlertText && !meteorDrop.active) {
setText(clanBadge, activeClanAlertText);
setClass(clanBadge, activeClanAlertText.startsWith('⚠')
? 'glass-panel px-3 py-1.5 text-[11px] font-tactical font-bold uppercase border-l-2 border-l-rose-500 text-rose-300 animate-pulse'
: 'glass-panel px-3 py-1.5 text-[11px] font-tactical font-bold uppercase border-l-2 border-l-amber-400 text-amber-300');
} else {
setClass(clanBadge, 'hidden');
}
const hpPct = Math.max(0, Math.min(100, (gameState.hp / gameState.maxHp) * 100));
const stPct = Math.max(0, Math.min(100, gameState.stamina));
const hpRing = document.getElementById('hud-hp-ring');
const stamRing = document.getElementById('hud-stam-ring');
if (hpRing) {
const off = (333.01 * (1 - hpPct / 100)).toFixed(2);
if (hpRing.__off !== off) { hpRing.__off = off; hpRing.style.strokeDashoffset = off; }
const col = hpPct > 50 ? '#10b981' : hpPct > 25 ? '#f59e0b' : '#ef4444';
if (hpRing.__col !== col) { hpRing.__col = col; hpRing.style.stroke = col; }
}
if (stamRing) {
const off = (257.61 * (1 - stPct / 100)).toFixed(2);
if (stamRing.__off !== off) { stamRing.__off = off; stamRing.style.strokeDashoffset = off; }
}
setText(document.getElementById('hud-hp-val'), String(Math.ceil(gameState.hp)));
setText(document.getElementById('hud-stam-val'), `${Math.round(stPct)}%`);
const rw = RIGHT_WEAPONS[gameState.activeRightWeapon] || RIGHT_WEAPONS.fists;
setHTML(document.getElementById('hud-rhand-icon'), rw.svg);
setText(document.getElementById('hud-rhand-name'), rw.name);
const lSlot = gameState.leftHotbar[gameState.activeLeftSlot];
const lItem = lSlot ? LEFT_ITEMS[lSlot.id] : null;
setHTML(document.getElementById('hud-lhand-icon'), lItem ? lItem.svg : '<span class="text-[10px] text-slate-500">&mdash;</span>');
setText(document.getElementById('hud-lhand-name'), lItem ? `${lItem.name}${lSlot.count > 1 ? ' x' + lSlot.count : ''}` : 'EMPTY');
const ammoCard = document.getElementById('ammo-hud-card');
if (gameState.activeRightWeapon === 'hotdog_shooter' && !gameState.inCar) {
setDisp(ammoCard, 'flex');
const countEl = document.getElementById('hud-ammo-count');
const hintEl = document.getElementById('hud-ammo-hint');
const barEl = document.getElementById('hud-sausage-bar');
setText(countEl, `${gameState.hotdogAmmo} / ${MAX_HOTDOG_AMMO}`);
setClass(countEl, gameState.hotdogAmmo === 0
? 'font-display text-sm text-rose-400 animate-pulse'
: gameState.hotdogAmmo <= 12 ? 'font-display text-sm text-amber-400' : 'font-display text-sm text-white');
setWidth(barEl, `${Math.round((gameState.hotdogAmmo / MAX_HOTDOG_AMMO) * 100)}%`);
setHTML(hintEl, gameState.hotdogAmmo === 0
? '<span class="text-rose-400 font-bold">EMPTY! REFILL AT HOTDOG CART/STORE</span>'
: '<span>[RMB] AIM</span><span class="text-amber-400">[LMB] FIRE</span>');
} else {
setDisp(ammoCard, 'none');
}
setDisp(document.getElementById('vehicle-hud'), gameState.inCar ? 'flex' : 'none');
setDisp(document.getElementById('onfoot-hotbar'), gameState.inCar ? 'none' : 'block');
const isScoped = gameState.isAiming && gameState.activeRightWeapon === 'hotdog_shooter' && !gameState.inCar;
setDisp(document.getElementById('sniper-scope'), isScoped ? 'flex' : 'none');
setDisp(document.getElementById('crosshair'), isScoped ? 'none' : 'flex');
if (gameState.inCar) {
const v = vehicles[gameState.activeCarIndex];
if (v) {
setText(document.getElementById('veh-name'), v.name);
const gLabel = GEAR_LABELS[v.gearIndex];
const gearCap = GEAR_CAPS_MPH[v.gearIndex];
setText(document.getElementById('veh-gear'), gLabel);
setText(document.getElementById('veh-gear-cap'), v.gearIndex === 1 ? 'NEUTRAL' : `MAX ${gearCap}`);
const mph = Math.round(Math.abs(v.speed) * 2.237);
setText(document.getElementById('veh-mph-text'), String(mph));
setText(document.getElementById('veh-rpm-text'), String(Math.round(v.rpm)));
const rpmDeg = -125 + Math.min(1, v.rpm / 8000) * 250;
const mphDeg = -125 + Math.min(1, mph / 200) * 250;
setAttr(document.getElementById('veh-rpm-needle'), 'transform', `rotate(${rpmDeg.toFixed(1)} 60 60)`);
setAttr(document.getElementById('veh-mph-needle'), 'transform', `rotate(${mphDeg.toFixed(1)} 60 60)`);
const normRpm = v.rpm / 8000;
const torqueEff = v.gearIndex === 1 ? 0 : Math.max(0.28, 1 - Math.pow((normRpm - 0.62) / 0.65, 2));
setWidth(document.getElementById('veh-torque-bar'), `${Math.round(torqueEff * 100)}%`);
const shiftLight = document.getElementById('veh-shift-light');
if (v.rpm >= 7150 && v.gearIndex >= 2 && v.gearIndex < 7) {
setText(shiftLight, 'SHIFT UP [I]');
setClass(shiftLight, 'px-2 py-0.5 rounded text-[9px] font-tactical font-bold uppercase bg-rose-500 text-white animate-pulse');
} else if (v.gearIndex > 2 && mph < GEAR_CAPS_MPH[v.gearIndex - 1] * 0.58) {
setText(shiftLight, 'DOWNSHIFT [K]');
setClass(shiftLight, 'px-2 py-0.5 rounded text-[9px] font-tactical font-bold uppercase bg-amber-500/30 text-amber-300');
} else {
setText(shiftLight, v.isSupercar ? 'SUPERCHARGED' : 'MANUAL');
setClass(shiftLight, v.isSupercar
? 'px-2 py-0.5 rounded text-[9px] font-tactical font-bold uppercase bg-amber-500/20 text-amber-300'
: 'px-2 py-0.5 rounded text-[9px] font-tactical font-bold uppercase bg-slate-800 text-slate-300');
}
}
}
updateHotbar();
}

export function showWeaponWheel() {
  const wheel = document.getElementById('radial-menu');
  const nodes = document.getElementById('wheel-nodes');
  const activeW = RIGHT_WEAPONS[gameState.activeRightWeapon] || RIGHT_WEAPONS.fists;
  document.getElementById('wheel-center-name').textContent = activeW.name;
  document.getElementById('wheel-center-dmg').textContent = activeW.id === 'hotdog_shooter'
    ? `AMMO ${gameState.hotdogAmmo}/${MAX_HOTDOG_AMMO}`
    : `DMG ${activeW.damage}`;

  nodes.innerHTML = '';
  const list = gameState.rightWeapons;
  list.forEach((wId, idx) => {
    const w = RIGHT_WEAPONS[wId];
    if (!w) return;
    const ang = -Math.PI / 2 + (idx / list.length) * Math.PI * 2;
    const r = 86;
    const cx = 144 + Math.cos(ang) * r;
    const cy = 144 + Math.sin(ang) * r;
    const isAct = wId === gameState.activeRightWeapon;
    const node = document.createElement('div');
    node.className = `absolute -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full flex flex-col items-center justify-center border ${isAct ? 'bg-amber-500 text-slate-950 border-amber-200 scale-110' : 'bg-slate-900/95 text-slate-200 border-white/20'}`;
    node.style.left = `${cx}px`;
    node.style.top = `${cy}px`;
    node.innerHTML = `${w.svg}<span class="text-[7px] font-tactical font-bold uppercase mt-0.5">${w.name.split(' ')[0]}</span>`;
    nodes.appendChild(node);
  });

  wheel.style.display = 'flex';
  gameState.wheelTimer = 1.35;
}

export function cycleRightWeapon(dir = 1) {
  if (gameState.inCar || meteorDrop.active) return;
  const list = gameState.rightWeapons;
  const idx = list.indexOf(gameState.activeRightWeapon);
  const nextIdx = (idx + dir + list.length) % list.length;
  gameState.activeRightWeapon = list[nextIdx];
  if (gameState.activeRightWeapon !== 'hotdog_shooter') {
    gameState.isAiming = false;
  }
  sfx.uiClick();
  syncEquippedMeshes();
  updateHUD();
  showWeaponWheel();
}

const mapStaticCache = new Map();
const MAP_WORLD = { minX: -720, maxX: 560, minZ: -600, maxZ: 340 };
function buildStaticMap(scale) {
const w = Math.ceil((MAP_WORLD.maxX - MAP_WORLD.minX) * scale);
const h = Math.ceil((MAP_WORLD.maxZ - MAP_WORLD.minZ) * scale);
const cv = document.createElement('canvas');
cv.width = w; cv.height = h;
const ctx = cv.getContext('2d');
const X = wx => (wx - MAP_WORLD.minX) * scale;
const Y = wz => (wz - MAP_WORLD.minZ) * scale;
ctx.fillStyle = '#365e33'; ctx.fillRect(0, 0, w, h);
mapShapes.forEach(s => { if (s.w > 200 && s.color === '#d97706') { ctx.fillStyle = s.color; ctx.fillRect(X(s.x - s.w / 2), Y(s.z - s.d / 2), s.w * scale, s.d * scale); } });
ctx.fillStyle = '#1f2937';
[-120, -72, -24, 24, 72, 120].forEach(rx => ctx.fillRect(X(rx - 6), Y(-174), 12 * scale, 252 * scale));
[-168, -120, -72, -24, 24, 72].forEach(rz => ctx.fillRect(X(-126), Y(rz - 6), 252 * scale, 12 * scale));
mapShapes.forEach(s => {
if (s.w > 200 && s.color === '#d97706') return;
ctx.fillStyle = s.color;
ctx.fillRect(X(s.x - s.w / 2), Y(s.z - s.d / 2), s.w * scale, s.d * scale);
if (s.border) { ctx.strokeStyle = s.border; ctx.lineWidth = s.enterable ? 1.5 : 1; ctx.strokeRect(X(s.x - s.w / 2), Y(s.z - s.d / 2), s.w * scale, s.d * scale); }
});
sausageRefillZones.forEach(rz => { ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.arc(X(rz.x), Y(rz.z), 3.2, 0, Math.PI * 2); ctx.fill(); });
ctx.fillStyle = 'rgba(120,130,120,.55)'; ctx.fillRect(X(-138), Y(-590), 508 * scale, 420 * scale);
ctx.fillStyle = 'rgba(139,125,86,.6)'; ctx.fillRect(X(-560), Y(-172), 364 * scale, 344 * scale);
ctx.fillStyle = 'rgba(79,138,63,.85)'; ctx.beginPath(); ctx.arc(X(-480), Y(-45), 70 * scale, 0, 6.3); ctx.fill();
ctx.strokeStyle = '#e9c33a'; ctx.lineWidth = 2; ctx.beginPath();
for (let q = 0; q <= 274; q += 6) { const x = -196 - q; q ? ctx.lineTo(X(x), Y(ahRz(x))) : ctx.moveTo(X(x), Y(ahRz(x))); }
ctx.stroke();
ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2; ctx.beginPath();
for (let z = -176; z > -584; z -= 8) { z === -176 ? ctx.moveTo(X(riverX(z)), Y(z)) : ctx.lineTo(X(riverX(z)), Y(z)); }
ctx.stroke();
ctx.strokeStyle = '#e9c33a'; ctx.lineWidth = 2; ctx.beginPath();
for (let z = -170; z > -584; z -= 8) { const px = X(roadC(z)), py = Y(z); z === -170 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
ctx.stroke();
if (aura.hospitalSpawn) {
const hx = aura.hospitalSpawn.x + 14, hz = aura.hospitalSpawn.z + 7.4;
ctx.fillStyle = '#fff'; ctx.fillRect(X(hx) - 5, Y(hz) - 5, 10, 10);
ctx.fillStyle = '#dc2626'; ctx.fillRect(X(hx) - 4, Y(hz) - 1, 8, 2); ctx.fillRect(X(hx) - 1, Y(hz) - 4, 2, 8);
}
ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif';
ctx.fillText('AURA HILLS', X(-470), Y(-150)); ctx.fillText('MOUNTAINS', X(60), Y(-400));
return cv;
}
export function renderMapCanvasBase(canvasEl, centerOnPlayer) {
  const ctx = canvasEl.getContext('2d');
  const W = canvasEl.width;
  const H = canvasEl.height;
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = '#365e33';
  ctx.fillRect(0, 0, W, H);

  const scale = centerOnPlayer ? 0.65 : 0.38;
  const cx = W / 2;
  const cy = H / 2;
  const refX = centerOnPlayer ? player.x : -29;
  const refZ = centerOnPlayer ? player.z : -190;

  const toCanvasX = (wx) => cx + (wx - refX) * scale;
  const toCanvasY = (wz) => cy + (wz - refZ) * scale;

  mapShapes.forEach((s) => {
    if (s.w > 200 && s.color === '#d97706') {
      ctx.fillStyle = s.color;
      ctx.fillRect(toCanvasX(s.x - s.w / 2), toCanvasY(s.z - s.d / 2), s.w * scale, s.d * scale);
    }
  });

  ctx.fillStyle = '#1f2937';
  [-120, -72, -24, 24, 72, 120].forEach((rx) => {
    ctx.fillRect(toCanvasX(rx - 6), toCanvasY(-174), 12 * scale, 252 * scale);
  });
  [-168, -120, -72, -24, 24, 72].forEach((rz) => {
    ctx.fillRect(toCanvasX(-126), toCanvasY(rz - 6), 252 * scale, 12 * scale);
  });

  mapShapes.forEach((s) => {
    if (s.w > 200 && s.color === '#d97706') return;
    ctx.fillStyle = s.color;
    ctx.fillRect(toCanvasX(s.x - s.w / 2), toCanvasY(s.z - s.d / 2), s.w * scale, s.d * scale);
    if (s.border) {
      ctx.strokeStyle = s.border;
      ctx.lineWidth = s.enterable ? 1.5 : 1;
      ctx.strokeRect(toCanvasX(s.x - s.w / 2), toCanvasY(s.z - s.d / 2), s.w * scale, s.d * scale);
    }
  });

  vehicles.forEach((v) => {
    ctx.fillStyle = v.isSupercar ? '#f59e0b' : '#f43f5e';
    ctx.fillRect(toCanvasX(v.x) - 3.5, toCanvasY(v.z) - 3.5, 7, 7);
  });

  sausageRefillZones.forEach((rz) => {
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(toCanvasX(rz.x), toCanvasY(rz.z), 3.2, 0, Math.PI * 2);
    ctx.fill();
  });

  npcs.forEach((npc) => {
    if (npc.aggro === 'clan' && !npc.asleep) {
      const clan = CLAN_DEFS[npc.clanId];
      ctx.fillStyle = clan ? clan.hex : '#ef4444';
      ctx.beginPath();
      ctx.arc(toCanvasX(npc.x), toCanvasY(npc.z), 2.8, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  if (centerOnPlayer) {
    const px = cx;
    const py = cy;
    const fwdX = -Math.sin(player.yaw);
    const fwdY = -Math.cos(player.yaw);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, 24, Math.atan2(fwdY, fwdX) - 0.5, Math.atan2(fwdY, fwdX) + 0.5);
    ctx.closePath();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, py, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    const northEl = document.getElementById('minimap-north');
    if (northEl) {
      northEl.style.left = '89px';
      northEl.style.top = '9px';
    }
  } else {
    const px = toCanvasX(player.x);
    const py = toCanvasY(player.z);
    ctx.beginPath();
    ctx.arc(px, py, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

export function setScreen(nextScreen) {
  gameState.screen = nextScreen;
  document.body.classList.toggle('menu-active', nextScreen === 'start');
  hooks.setAircraftScreen(nextScreen);
  hooks.syncMobileControls(true);
  document.getElementById('start-menu').style.display = nextScreen === 'start' ? 'flex' : 'none';
  document.getElementById('hud').style.display = nextScreen === 'playing' ? 'block' : 'none';
  document.getElementById('pause-menu').style.display = nextScreen === 'paused' ? 'flex' : 'none';

  if (nextScreen !== 'playing') {
    inputState.isPrimaryFireHeld = false;
    gameState.isAiming = false;
    closeSubModals();
    sfx.updateEngine(false, 0, false);
    if (document.pointerLockElement === canvas) {
      document.exitPointerLock();
    }
  } else {
    updateHUD();
  }
}

export function closeSubModals() {
  gameState.inventoryOpen = false;
  gameState.mapOpen = false;
  gameState.settingsOpen = false;
  document.getElementById('inventory-menu').style.display = 'none';
  document.getElementById('map-modal').style.display = 'none';
  document.getElementById('settings-menu').style.display = 'none';
}

export function openInventoryModal() {
  if (gameState.screen !== 'playing' || gameState.inCar || meteorDrop.active) return;
  closeSubModals();
  gameState.inventoryOpen = true;
  gameState.inspectedLeftSlot = gameState.activeLeftSlot;
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  renderInventoryModal();
  document.getElementById('inventory-menu').style.display = 'flex';
  hooks.syncMobileControls(true);
}

export function closeInventoryModal() {
  gameState.inventoryOpen = false;
  document.getElementById('inventory-menu').style.display = 'none';
  hooks.syncMobileControls(true);
}

export function renderInventoryModal() {
  const grid = document.getElementById('inv-left-grid');
  grid.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const slot = gameState.leftHotbar[i];
    const item = slot ? LEFT_ITEMS[slot.id] : null;
    const selected = i === gameState.inspectedLeftSlot;
    const equipped = i === gameState.activeLeftSlot;
    const btn = document.createElement('button');
    btn.className = `p-2 rounded-lg border text-center flex flex-col items-center justify-between h-20 cursor-pointer ${selected ? 'border-sky-400 bg-sky-950/60' : 'border-white/15 bg-slate-900/80'}`;
    btn.innerHTML = `
      <div class="w-full flex justify-between text-[9px] font-tactical">
        <span class="text-slate-400">${i + 1}</span>
        <span class="text-sky-300 font-bold">${equipped ? 'EQ' : ''}</span>
      </div>
      <div style="color:${item ? item.color : '#475569'}">${item ? item.svg : '-'}</div>
      <div class="text-[9px] font-tactical uppercase text-slate-200 truncate w-full">${item ? item.name.split(' ')[0] : 'EMPTY'}</div>
    `;
    btn.onclick = () => {
      gameState.inspectedLeftSlot = i;
      gameState.activeLeftSlot = i;
      syncEquippedMeshes();
      updateHUD();
      renderInventoryModal();
    };
    grid.appendChild(btn);
  }

  const inspSlot = gameState.leftHotbar[gameState.inspectedLeftSlot];
  const inspItem = inspSlot ? LEFT_ITEMS[inspSlot.id] : null;
  const inspBox = document.getElementById('inv-left-inspector');
  if (inspItem) {
    inspBox.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="font-display text-lg uppercase text-white">${inspItem.name} <span class="text-xs text-slate-400">(x${inspSlot.count})</span></span>
        <span class="text-xs font-tactical font-bold text-sky-400">${inspItem.stat}</span>
      </div>
      <p class="text-xs text-slate-300 mt-1">${inspItem.desc}</p>
    `;
  } else {
    inspBox.innerHTML = `
      <div class="font-display text-base uppercase text-slate-500">EMPTY UTILITY SLOT</div>
      <p class="text-xs text-slate-400 mt-1">Smash crates or explore walk-in buildings to collect Medkits, Energy Drinks, Burgers, and Cash.</p>
    `;
  }

  const rList = document.getElementById('inv-right-list');
  rList.innerHTML = '';
  gameState.rightWeapons.forEach((wId) => {
    const w = RIGHT_WEAPONS[wId];
    if (!w) return;
    const isEq = wId === gameState.activeRightWeapon;
    const row = document.createElement('div');
    row.className = `p-3 rounded-lg border flex items-center justify-between cursor-pointer ${isEq ? 'border-amber-400 bg-amber-500/15' : 'border-white/10 bg-slate-900/75 hover:border-white/30'}`;
    const statBadge = w.id === 'hotdog_shooter'
      ? `AMMO ${gameState.hotdogAmmo}/${MAX_HOTDOG_AMMO}`
      : `DMG ${w.damage}`;
    row.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded bg-amber-500/20 text-amber-400 flex items-center justify-center">${w.svg}</div>
        <div>
          <div class="font-display text-sm uppercase text-white">${w.name}</div>
          <div class="text-[11px] text-slate-400">${w.desc}</div>
        </div>
      </div>
      <div class="text-right shrink-0 ml-2">
        <div class="text-xs font-tactical font-bold text-amber-400">${statBadge}</div>
        <div class="text-[10px] font-tactical uppercase ${isEq ? 'text-emerald-400' : 'text-slate-400'}">${isEq ? 'EQUIPPED' : 'CLICK TO EQUIP'}</div>
      </div>
    `;
    row.onclick = () => {
      gameState.activeRightWeapon = wId;
      if (wId !== 'hotdog_shooter') gameState.isAiming = false;
      sfx.uiClick();
      syncEquippedMeshes();
      updateHUD();
      renderInventoryModal();
    };
    rList.appendChild(row);
  });
}

export function openSettingsModal() {
  gameState.settingsOpen = true;
  hooks.syncMobileControls(true);
  const sensSlider = document.getElementById('setting-sens');
  sensSlider.value = gameState.settings.sensitivity;
  document.getElementById('setting-sens-val').textContent = `${gameState.settings.sensitivity.toFixed(2)}x`;
  syncSettingsButtons();
  document.getElementById('settings-menu').style.display = 'flex';
}

export function closeSettingsModal() {
  gameState.settingsOpen = false;
  document.getElementById('settings-menu').style.display = 'none';
  hooks.syncMobileControls(true);
}

export function syncSettingsButtons() {
  const tier = gameState.settings.graphics;
  document.querySelectorAll('.gfx-choice').forEach((btn) => {
    const isMatch = btn.dataset.gfx === tier;
    btn.className = isMatch
      ? 'gfx-choice menu-btn-primary py-2.5 px-3 text-center font-display text-sm uppercase cursor-pointer'
      : 'gfx-choice menu-btn py-2.5 px-3 text-center font-display text-sm uppercase text-slate-200 cursor-pointer';
  });
  const descMap = {
    low: ['LOW • HIGH FPS', 'Flat low-poly shading without procedural textures or dynamic shadows for maximum frame rate.'],
    medium: ['MEDIUM • PBR TEXTURES', 'Procedural PBR textures with metallic clearcoat vehicles, real glass windows, proximity LODs, and 1024x1024 shadows.'],
    high: ['HIGH • ULTRA PBR & SKY', 'Full procedural bump maps, 2048x2048 soft shadows, architectural trim, and atmospheric sky dome.']
  };
  document.getElementById('setting-gfx-desc').textContent = descMap[tier][0];
  document.getElementById('setting-gfx-detail').textContent = descMap[tier][1];

  const sfxBtn = document.getElementById('btn-setting-sfx');
  sfxBtn.textContent = gameState.settings.sfx ? 'ENABLED' : 'MUTED';
  sfxBtn.className = gameState.settings.sfx
    ? 'menu-btn px-4 py-2 font-display text-xs uppercase text-emerald-400 border-emerald-500/40 cursor-pointer'
    : 'menu-btn px-4 py-2 font-display text-xs uppercase text-rose-400 border-rose-500/40 cursor-pointer';

  const mobileBtn = document.getElementById('btn-setting-mobile');
  if (mobileBtn) {
    mobileBtn.textContent = gameState.settings.mobileControls ? 'ENABLED' : 'DISABLED';
    mobileBtn.className = gameState.settings.mobileControls
      ? 'menu-btn px-4 py-2 font-display text-xs uppercase text-emerald-400 border-emerald-500/40 cursor-pointer'
      : 'menu-btn px-4 py-2 font-display text-xs uppercase text-rose-400 border-rose-500/40 cursor-pointer';
  }
}

export function openMapModal() {
  if (gameState.screen !== 'playing' || meteorDrop.active) return;
  closeSubModals();
  hooks.syncMobileControls(true);
  gameState.mapOpen = true;
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  renderMapCanvas(document.getElementById('fullmap-canvas'), false);
  document.getElementById('map-modal').style.display = 'flex';
}

export function closeMapModal() {
  gameState.mapOpen = false;
  document.getElementById('map-modal').style.display = 'none';
  hooks.syncMobileControls(true);
}

export function exportSaveFile() {
  const payload = {
    title: 'Grand Theft Aura',
    version: 7,
    timestamp: new Date().toISOString(),
    player: { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch },
    state: {
      hp: gameState.hp,
      stamina: gameState.stamina,
      cash: gameState.cash,
      hotdogAmmo: gameState.hotdogAmmo,
      rightWeapons: gameState.rightWeapons,
      activeRightWeapon: gameState.activeRightWeapon,
      leftHotbar: gameState.leftHotbar,
      activeLeftSlot: gameState.activeLeftSlot,
      thirdPerson: gameState.thirdPerson,
      settings: gameState.settings
    }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `grand-theft-aura-save-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  sfx.pickup();
  pushFeed('GAME SAVED (.JSON EXPORTED)', 'border-l-emerald-400');
}

export function importSaveFromFile(file) {
if (!file) return;
if (hooks.mpActive()) {
pushFeed('SAVE IMPORT IS DISABLED WHILE ONLINE — EXIT THE ROOM FIRST', 'border-l-rose-500');
return;
}
const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data || !data.player || !data.state) throw new Error('Invalid Grand Theft Aura save file.');
      if (gameState.inCar) exitCurrentCar(true);
      meteorDrop.active = false;
      meteorGroup.visible = false;
      meteorReticle.visible = false;
      document.getElementById('meteor-aim-banner').style.display = 'none';

      player.x = Number(data.player.x) || -11.5;
      player.y = Math.max(0.18, Number(data.player.y) || 0.18);
      player.z = Number(data.player.z) || 18.5;
      player.yaw = Number(data.player.yaw) || 0;
      player.pitch = Number(data.player.pitch) || 0;
      player.vy = 0;
      player.grounded = true;
      player.peakAirY = player.y;

      const st = data.state;
      gameState.hp = Math.min(gameState.maxHp, Math.max(10, Number(st.hp) || gameState.maxHp));
      gameState.stamina = Math.min(100, Math.max(0, Number(st.stamina) || 100));
      gameState.cash = Math.max(0, Number(st.cash) || 0);
      gameState.hotdogAmmo = st.hotdogAmmo !== undefined ? Math.max(0, Math.min(MAX_HOTDOG_AMMO, Number(st.hotdogAmmo))) : MAX_HOTDOG_AMMO;
      gameState.rightWeapons = Array.isArray(st.rightWeapons) && st.rightWeapons.length ? st.rightWeapons : ['fists', 'bat'];
      gameState.activeRightWeapon = RIGHT_WEAPONS[st.activeRightWeapon] ? st.activeRightWeapon : 'fists';
      gameState.leftHotbar = Array.isArray(st.leftHotbar) && st.leftHotbar.length === 5 ? st.leftHotbar : gameState.leftHotbar;
      gameState.activeLeftSlot = Math.min(4, Math.max(0, Number(st.activeLeftSlot) || 0));
      gameState.thirdPerson = Boolean(st.thirdPerson);

      if (st.settings) {
        gameState.settings.sensitivity = Number(st.settings.sensitivity) || 1.0;
        gameState.settings.graphics = ['low', 'medium', 'high'].includes(st.settings.graphics) ? st.settings.graphics : 'medium';
        gameState.settings.sfx = st.settings.sfx !== false;
        sfx.enabled = gameState.settings.sfx;
        applyGraphicsTier(gameState.settings.graphics);
      }

      syncEquippedMeshes();
      setScreen('playing');
      pushFeed('SAVE FILE LOADED SUCCESSFULLY', 'border-l-sky-400');
    } catch (err) {
      const banner = document.getElementById('error-banner');
      banner.textContent = `Save Import Error: ${err.message}`;
      banner.style.display = 'block';
      setTimeout(() => { banner.style.display = 'none'; }, 3500);
    }
  };
  reader.readAsText(file);
}

export function buildAuraUI(){
  const st=document.createElement('style');st.textContent=`
  .glass-panel{background:linear-gradient(160deg,rgba(18,24,34,.88),rgba(8,11,17,.9))!important;border:1px solid rgba(255,255,255,.1)!important;border-top:1px solid rgba(245,158,11,.5)!important;box-shadow:0 12px 32px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.06)!important}
  #ao-stars{position:fixed;top:14px;left:50%;transform:translateX(-50%);display:none;gap:4px;font-size:30px;padding:4px 16px;border-radius:999px;background:rgba(8,11,17,.7);border:1px solid rgba(255,255,255,.15);text-shadow:0 0 12px currentColor;z-index:25}
  #ao-compass{position:fixed;top:14px;right:208px;padding:6px 14px;font:700 12px Rajdhani,sans-serif;letter-spacing:.15em;color:#e2e8f0;border-radius:8px;background:rgba(8,11,17,.72);border:1px solid rgba(255,255,255,.12);z-index:25}
  #ao-vig{position:fixed;inset:0;pointer-events:none;z-index:5;background:radial-gradient(ellipse at center,transparent 58%,rgba(0,0,0,.42) 100%)}`;
  document.head.appendChild(st);
  const hud=document.getElementById('hud');
  const s=document.createElement('div');s.id='ao-stars';hud.appendChild(s);
  const c=document.createElement('div');c.id='ao-compass';hud.appendChild(c);
  const v=document.createElement('div');v.id='ao-vig';document.body.appendChild(v);
  const tip=document.createElement('div');tip.id='ao-tip';tip.style.cssText='position:fixed;bottom:150px;left:50%;transform:translateX(-50%);padding:6px 14px;border-radius:8px;background:rgba(8,11,17,.85);border:1px solid #f59e0b;font:700 13px Rajdhani,sans-serif;letter-spacing:.1em;display:none;z-index:25';hud.appendChild(tip);
}

export function renderMapCanvas(cv,center){renderMapCanvasBase(cv,center);
  const ctx=cv.getContext('2d'),sc=center?.65:.38,rx=center?player.x:-29,rz=center?player.z:-190,X=w=>cv.width/2+(w-rx)*sc,Y=w=>cv.height/2+(w-rz)*sc;
  ctx.fillStyle='rgba(120,130,120,.55)';ctx.fillRect(X(-138),Y(-170)-420*sc,508*sc,420*sc);
  ctx.fillStyle='rgba(139,125,86,.6)';ctx.fillRect(X(-560),Y(-172),364*sc,344*sc);
  ctx.fillStyle='rgba(79,138,63,.85)';ctx.beginPath();ctx.arc(X(-480),Y(-45),70*sc,0,6.3);ctx.fill();
  ctx.strokeStyle='#e9c33a';ctx.lineWidth=2;ctx.beginPath();for(let q=0;q<=274;q+=6){const x=-196-q;q?ctx.lineTo(X(x),Y(ahRz(x))):ctx.moveTo(X(x),Y(ahRz(x)));}ctx.stroke();
  ctx.strokeStyle='#38bdf8';ctx.lineWidth=2;ctx.beginPath();for(let z=-176;z>-584;z-=8){z===-176?ctx.moveTo(X(riverX(z)),Y(z)):ctx.lineTo(X(riverX(z)),Y(z));}ctx.stroke();
  if(aura.hospitalSpawn){const hx=aura.hospitalSpawn.x+14,hz=aura.hospitalSpawn.z+7.4;ctx.fillStyle='#fff';ctx.fillRect(X(hx)-5,Y(hz)-5,10,10);ctx.fillStyle='#dc2626';ctx.fillRect(X(hx)-4,Y(hz)-1,8,2);ctx.fillRect(X(hx)-1,Y(hz)-4,2,8);}
  ctx.fillStyle='#fff';ctx.font='bold 10px sans-serif';ctx.fillText('AURA HILLS',X(-470),Y(-150));ctx.fillText('MOUNTAINS',X(60),Y(-400));
  ctx.strokeStyle='#e9c33a';ctx.lineWidth=2;ctx.beginPath();for(let z=-170;z>-584;z-=8){const px=X(roadC(z)),py=Y(z);z===-170?ctx.moveTo(px,py):ctx.lineTo(px,py);}ctx.stroke();
  const f=(x,z,col,r)=>{ctx.fillStyle=col;ctx.beginPath();ctx.arc(X(x),Y(z),r,0,6.3);ctx.fill();};
  if(!under()){AO.cops.forEach(c=>f(c.x,c.z,'#3b82f6',3));AO.cars.forEach(c=>f(c.x,c.z,Math.sin(performance.now()/120)>0?'#ef4444':'#3b82f6',4.5));manholes.forEach(m=>f(m[0],m[1],'#34d399',2));}
  hooks.drawMapOverlay(ctx,cv,center);
hooks.drawAircraftMapOverlay(cv,center);
hooks.mpDrawMap(ctx,X,Y);
}
/** Attach all DOM / window listeners. Call once from main.js (never from Studio). */
export function initUI() {
buildAuraUI();

document.getElementById('btn-start-play').onclick = () => {
  sfx.unlock();
  sfx.uiClick();
  setScreen('playing');
  triggerMeteorLanding();
  if (canvas.requestPointerLock) {
    try {
      if (!gameState.settings.mobileControls || navigator.maxTouchPoints === 0) {
        const p = canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      }
    } catch (_) {}
  }
};

document.getElementById('btn-start-settings').onclick = () => {
  sfx.unlock();
  sfx.uiClick();
  openSettingsModal();
};

document.getElementById('btn-start-import').onclick = () => {
  sfx.unlock();
  sfx.uiClick();
  document.getElementById('save-file-input').click();
};

document.getElementById('btn-pause-resume').onclick = () => { sfx.uiClick(); setScreen('playing'); };

document.getElementById('btn-pause-settings').onclick = () => { sfx.uiClick(); openSettingsModal(); };

document.getElementById('btn-pause-save').onclick = () => { sfx.uiClick(); exportSaveFile(); };

document.getElementById('btn-pause-import').onclick = () => {
  sfx.uiClick();
  document.getElementById('save-file-input').click();
};

document.getElementById('btn-pause-exit').onclick = () => {
sfx.uiClick();
if (gameState.inCar) exitCurrentCar(true);
hooks.mpShutdown(); // host: host_bye + migration; guest: bye + clean disconnect
meteorDrop.active = false;
meteorGroup.visible = false;
meteorReticle.visible = false;
document.getElementById('meteor-aim-banner').style.display = 'none';
setScreen('start');
};

document.getElementById('btn-settings-close').onclick = () => { sfx.uiClick(); closeSettingsModal(); };

document.getElementById('setting-sens').oninput = (e) => {
  gameState.settings.sensitivity = parseFloat(e.target.value);
  document.getElementById('setting-sens-val').textContent = `${gameState.settings.sensitivity.toFixed(2)}x`;
};

document.querySelectorAll('.gfx-choice').forEach((btn) => {
  btn.onclick = () => {
    sfx.uiClick();
    applyGraphicsTier(btn.dataset.gfx);
    syncSettingsButtons();
  };
});

  document.getElementById('btn-setting-sfx').onclick = () => {
  gameState.settings.sfx = !gameState.settings.sfx;
  sfx.enabled = gameState.settings.sfx;
  sfx.uiClick();
  syncSettingsButtons();
};

document.getElementById('btn-setting-mobile').onclick = () => {
  gameState.settings.mobileControls = !gameState.settings.mobileControls;
  sfx.uiClick();
  syncSettingsButtons();
  hooks.persistMobilePreference();
};

document.getElementById('btn-inv-close').onclick = () => { sfx.uiClick(); closeInventoryModal(); };

document.getElementById('btn-inv-use').onclick = () => useLeftHandItem(gameState.inspectedLeftSlot);

document.getElementById('btn-inv-drop').onclick = () => dropLeftSlot(gameState.inspectedLeftSlot);

document.getElementById('btn-map-close').onclick = () => { sfx.uiClick(); closeMapModal(); };

document.getElementById('minimap-box').onclick = () => openMapModal();

document.getElementById('save-file-input').onchange = (e) => {
  if (e.target.files && e.target.files[0]) {
    importSaveFromFile(e.target.files[0]);
    e.target.value = '';
  }
};
}

// Register late-bound implementations for lower layers (see state.js).
Object.assign(hooks, { updateHUD, cycleRightWeapon, setScreen, openInventoryModal, closeInventoryModal, renderInventoryModal, closeSettingsModal, openMapModal, closeMapModal });
