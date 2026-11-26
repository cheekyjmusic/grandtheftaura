// =============================================================================
// worldSystems/armory.js — DISPLAY CASES, DUMPSTER SEARCH, [E] BUY / [F] SMASH
//
// Shell + fit-out are built by worldObjects/buildings.js (shop_armory).
// Dumpster geometry + the hidden sledgehammer come from worldObjects/street.js.
// This module owns only behaviour and the case/alarm/held-hammer objects.
// =============================================================================
import * as THREE from 'three';
import {
  MAX_HOTDOG_AMMO, aura, crime, gameState, hooks, player, pushFeed, under, worldBoxes
} from '../state.js';
import { camera, worldRoot } from '../engine.js';
import { sfx } from '../audio.js';
import { buildPickupMesh, spawnParticles, spawnWorldPickup } from '../items.js';
import { addSolidBox, dist2, getPlacement, makeBox, removeSolidBox, resolveMat } from '../worldKit.js';
import { makeSledgehammer } from '../worldObjects/street.js';

const A = {
  built: false, cases: [], searched: false, hasHammer: false,
  hammerMesh: null, hammerInDumpster: null, alarm: 0, alarmLight: null, alarmBeacon: null,
  swing: 0, spec: null, baseY: 0.24
};
let keyBound = false;
const _v = new THREE.Vector3();

function buildCase(stock, baseY) {
  const [x, z] = stock.at;
  const g = new THREE.Group();
  g.position.set(x, baseY, z);
  g.userData.studioName = `Display case: ${stock.label}`;
  worldRoot.add(g);
  const cabinet = resolveMat('deskDark');
  const steel = resolveMat('steel');
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xbfe6ff, transparent: true, opacity: 0.24, roughness: 0.04, metalness: 0.12,
    side: THREE.DoubleSide, depthWrite: false, emissive: 0x1e3a5f, emissiveIntensity: 0.25
  });
  makeBox(g, 2.6, 0.9, 1.5, 0, 0.45, 0, cabinet, { cast: true, recv: true });
  makeBox(g, 2.7, 0.08, 1.6, 0, 0.94, 0, steel);
  const glass = makeBox(g, 2.4, 1.5, 1.3, 0, 1.73, 0, glassMat, { order: 3 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    makeBox(g, 0.07, 1.5, 0.07, sx * 1.2, 1.73, sz * 0.65, steel);
  }
  makeBox(g, 2.5, 0.08, 1.4, 0, 2.50, 0, steel);
  const prop = buildPickupMesh('right', stock.id);
  if (prop.children.length > 1) prop.remove(prop.children[prop.children.length - 1]);
  prop.scale.setScalar(1.7);
  prop.position.set(0, 1.62, 0);
  prop.rotation.set(0.2, 0, 0.35);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.16, 10), steel);
  stand.position.y = 1.06;
  g.add(stand, prop);
  const sign = (text, y, w, h, fg) => makeBox(g, w, h, 0.22, 0, y, y < 1 ? 0.78 : 0,
    require_sign(text, fg), { name: `Sign: ${text}` });
  // Local import-free sign helper (kit cache).
  function require_sign(text, fg) {
    return signMats(text, '#0b1220', fg);
  }
  sign(`$${stock.price}`, 0.62, 1.5, 0.42, '#facc15');
  sign(stock.label, 2.78, 2.5, 0.36, '#38bdf8');
  const baseBox = addSolidBox(x - 1.3, x + 1.3, baseY, baseY + 0.98, z - 0.75, z + 0.75, 'armory_case', true);
  const glassBox = addSolidBox(x - 1.2, x + 1.2, baseY + 0.98, baseY + 2.5, z - 0.65, z + 0.65, 'armory_glass', false);
  A.cases.push({ id: stock.id, label: stock.label, price: stock.price, x, z, group: g, glass, prop, glassBox, baseBox, smashed: false, spin: Math.random() * 6.28 });
}

// Kit sign materials, imported lazily at module scope to keep the header tidy.
import { signBoxMaterials as signMats } from '../worldKit.js';

function active() {
  return A.built && gameState.screen === 'playing' && !gameState.inCar &&
    !gameState.inventoryOpen && !gameState.mapOpen && !gameState.settingsOpen &&
    !under() && player.y > -1;
}

function target() {
  if (!active()) return null;
  let best = null;
  const consider = (kind, x, z, range, data) => {
    const d2 = dist2(player.x, player.z, x, z);
    if (d2 < range * range && Math.abs(player.y - A.baseY) < 2.4 && (!best || d2 < best.d2)) best = { kind, d2, data };
  };
  const s = A.spec;
  if (!A.searched && s.dumpster) consider('dumpster', s.dumpster.at[0], s.dumpster.at[1], 3.0, null);
  if (s.ammo) consider('ammo', s.ammo.at[0], s.ammo.at[1], 2.6, null);
  for (const c of A.cases) if (!c.smashed) consider('case', c.x, c.z, 2.6, c);
  return best;
}

function hintText() {
  const t = target();
  if (!t) return '';
  if (t.kind === 'dumpster') return '[E] SEARCH DUMPSTER';
  if (t.kind === 'ammo') return `[E] BUY 60 SAUSAGES — $${A.spec.ammo.price}`;
  const c = t.data;
  const buy = gameState.cash >= c.price ? `[E] BUY $${c.price}`
    : `[E] BUY $${c.price} (SHORT $${c.price - gameState.cash})`;
  return A.hasHammer ? `${buy} · [F] SMASH CASE` : `${buy} · REINFORCED GLASS`;
}

function equip(id) {
  if (!gameState.rightWeapons.includes(id)) gameState.rightWeapons.push(id);
  gameState.activeRightWeapon = id;
  if (id === 'hotdog_shooter') gameState.hotdogAmmo = MAX_HOTDOG_AMMO;
  hooks.syncEquippedMeshes();
  hooks.updateHUD(true);
}

function buy() {
  const t = target();
  if (!t) return false;
  const s = A.spec;
  if (t.kind === 'dumpster') {
    A.searched = true;
    A.hasHammer = true;
    if (A.hammerInDumpster) A.hammerInDumpster.visible = false;
    sfx.pickup();
    spawnParticles(s.dumpster.at[0], 1.6, s.dumpster.at[1], 0x94a3b8, 8, 4.0);
    pushFeed('SLEDGEHAMMER FOUND — [F] SMASHES DISPLAY GLASS', 'border-l-amber-400');
    hooks.mpWorldEvent({ t: 'armory_hammer' });
    return true;
  }
  if (t.kind === 'ammo') {
    if (gameState.cash < s.ammo.price) {
      sfx.uiClick();
      pushFeed(`NOT ENOUGH CASH — $${s.ammo.price} NEEDED`, 'border-l-rose-500');
      return true;
    }
    gameState.cash -= s.ammo.price;
    gameState.hotdogAmmo = MAX_HOTDOG_AMMO;
    sfx.pickup();
    hooks.updateHUD(true);
    pushFeed(`BOUGHT 60 SAUSAGES -$${s.ammo.price}`, 'border-l-amber-400');
    hooks.mpWorldEvent({ t: 'armory_ammo' });
    return true;
  }
  const c = t.data;
  if (gameState.cash < c.price) {
    sfx.uiClick();
    pushFeed(`NOT ENOUGH CASH — ${c.label} IS $${c.price}`, 'border-l-rose-500');
    return true;
  }
  gameState.cash -= c.price;
  equip(c.id);
  sfx.pickup();
  spawnParticles(c.x, 2.0, c.z, 0xfacc15, 8, 3.5);
  pushFeed(`PURCHASED ${c.label} -$${c.price}`, 'border-l-emerald-400');
  hooks.mpWorldEvent({ t: 'armory_buy', id: c.id });
  return true;
}

function smash() {
  const t = target();
  if (!t || t.kind !== 'case') return false;
  if (!A.hasHammer) {
    sfx.uiClick();
    pushFeed('THE GLASS HOLDS — YOU NEED SOMETHING HEAVY', 'border-l-slate-400');
    return true;
  }
  const c = t.data;
  c.smashed = true;
  c.glass.visible = false;
  if (c.prop) c.prop.visible = false;
  removeSolidBox(c.glassBox);
  A.swing = 1;
  A.alarm = A.spec.alarmSeconds ?? 45;
  sfx.smash();
  spawnParticles(c.x, 1.9, c.z, 0xbfe6ff, 16, 7.0);
  spawnParticles(c.x, 1.9, c.z, 0xffffff, 10, 5.5);
  spawnWorldPickup('right', c.id, c.x, A.baseY, c.z + 1.5);
  if (!hooks.mpIsGuest()) crime(0.9);
  pushFeed(`CASE SMASHED — ${c.label} GRABBED • ALARM!`, 'border-l-rose-500');
  hooks.mpWorldEvent({ t: 'armory_smash', id: c.id });
  return true;
}

function bindKey() {
  if (keyBound) return;
  keyBound = true;
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyE' || e.repeat) return;
    const tag = e.target && e.target.tagName;
    if (tag && /INPUT|TEXTAREA|SELECT/.test(tag)) return;
    if (buy()) e.preventDefault();
  });
}

export function install({ spec }) {
  if (!spec) return;
  const shell = getPlacement('la/armory')?.data?.armory;
  A.spec = spec;
  A.baseY = shell?.baseY ?? spec.baseY ?? 0.24;
  A.built = true;
  A.cases.length = 0;
  A.searched = false;
  A.hasHammer = false;
  A.alarm = 0;
  A.swing = 0;
  for (const stock of spec.stock || []) buildCase(stock, A.baseY);
  A.hammerInDumpster = getPlacement('la/armory_dumpster')?.data?.hammer || null;

  A.hammerMesh = makeSledgehammer();
  A.hammerMesh.visible = false;
  A.hammerMesh.scale.setScalar(0.95);
  A.hammerMesh.userData.studioSelectable = false;
  worldRoot.add(A.hammerMesh);

  const [x, z] = spec.at;
  const h = spec.h ?? 5.2, d = spec.d ?? 22;
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xef4444 }));
  beacon.position.set(x, A.baseY + h + 0.8, z + d / 2 - 0.5);
  beacon.visible = false;
  beacon.userData.studioSelectable = false;
  worldRoot.add(beacon);
  A.alarmBeacon = beacon;
  const light = new THREE.PointLight(0xff2d2d, 0, 30, 2);
  light.position.set(x, A.baseY + 3.4, z);
  worldRoot.add(light);
  A.alarmLight = light;

  bindKey();
  // CHAIN onto whatever estates installed.
  const prevHint = aura.ahHint, prevF = aura.ahF;
  aura.ahHint = () => hintText() || (prevHint ? prevHint() : '');
  aura.ahF = () => { if (smash()) return; if (prevF) prevF(); };
}

export function update(dt, elapsed) {
  if (!A.built) return;
  for (const c of A.cases) {
    if (c.smashed || !c.prop) continue;
    c.spin += dt * 0.7;
    c.prop.rotation.y = c.spin;
  }
  if (A.swing > 0) A.swing = Math.max(0, A.swing - dt * 3.2);
  if (A.alarm > 0) {
    A.alarm -= dt;
    const pulse = (Math.sin(elapsed * 12) + 1) * 0.5;
    if (A.alarmLight) A.alarmLight.intensity = 1.2 + pulse * 5.0;
    if (A.alarmBeacon) A.alarmBeacon.visible = pulse > 0.4;
  } else {
    if (A.alarmLight) A.alarmLight.intensity = 0;
    if (A.alarmBeacon) A.alarmBeacon.visible = false;
  }
  const hm = A.hammerMesh;
  if (!hm) return;
  const show = A.hasHammer && !gameState.inCar && gameState.screen === 'playing';
  hm.visible = show;
  if (!show) return;
  const swing = Math.sin(A.swing * Math.PI) * 1.5;
  if (gameState.thirdPerson) {
    const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    hm.position.set(player.x + rx * 0.36, player.y + 1.02, player.z + rz * 0.36);
    hm.rotation.set(-0.5 - swing, player.yaw, 0.28);
  } else {
    hooks.getRightMountWorldPosition(_v);
    hm.position.copy(_v);
    hm.quaternion.copy(camera.quaternion);
    hm.rotateX(-0.55 - swing);
    hm.rotateZ(0.22);
  }
}

export function reset() {
  A.built = false;
  A.cases.length = 0;
  A.hammerMesh = A.hammerInDumpster = A.alarmLight = A.alarmBeacon = null;
  A.hasHammer = A.searched = false;
  A.alarm = A.swing = 0;
}
export default { install, update, reset };