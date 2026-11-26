import * as THREE from 'three';
import { AO, MAX_HOTDOG_AMMO, aura, gameState, hooks, keys, lampPosts, manholeOpen, npcs, player, pushFeed, smashableCrates, hazardBarrels, worldPickups } from './state.js';
import { scene, worldRoot } from './engine.js';
import { levelData } from './levelData.js';
import { sfx } from './audio.js';
import { vehicles, enterVehicle } from './vehicles.js';
import { buildPlayerRigMesh, syncEquippedMeshes } from './player.js';
import { buildNpcMeshRaw, buildSleepZzzGroup, buildCopMesh, buildCopCarMesh, lootFor, damageNpcBase, hurtCop, killRat, clearWantedLevel, rats } from './npcs.js';
import { addLeftItemToBag, buildRightWeaponMesh, destroyCrate, destroyBarrel, freeGeo, getNetSeq, removePickupByNetId, setNetSeq, spawnNetWiener, spawnParticles, spawnWorldPickup } from './items.js';
import { knockOverLamppostBase } from './world.js';

const INTERP_DELAY = 120;           
const STREAM_MS = 125;            
const PLAYER_MS = 50;             
const CAR_MS = 80;                  

export const multiplayer = {
  mode: 'single', peer: null, hostConnection: null, connections: new Map(),
  remotePlayers: new Map(), roomCode: '', localId: '1', hostId: '1', playerCount: 1,
  playerOrder: ['1'], carOwners: new Map(),
  lastPlayerSend: 0, lastWorldSend: 0, lastVehicleSend: 0, lastJetSend: 0,
  migrating: false, grantBypass: -1, worldVersion: 0, lastDigestReq: 0,
  remoteJet: null, remoteJetBuf: null,
};
const npcBuf = new Map();         
const carBuf = new Map();         
const remoteCops = new Map();     
const remotePcars = new Map();    
const ratBuf = new Map();         
const pendingPickups = new Map();       
const hitCooldown = new Map();      
let lastStreamVersion = -1;

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const isHost = () => multiplayer.mode === 'host';
const isGuest = () => multiplayer.mode === 'guest';
const isActive = () => multiplayer.mode !== 'single';
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

function roomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
function updateHud() {
  const pill = document.getElementById('multiplayer-hud');
  const startBtn = document.getElementById('btn-start-play');
  const label = startBtn && startBtn.querySelector('span');
  if (label) label.textContent = isActive() ? 'ENTER CITY (ONLINE)' : 'SINGLEPLAYER';
  if (!pill) return;
  if (!isActive()) { pill.classList.add('hidden'); return; }
  pill.classList.remove('hidden');
  document.getElementById('mp-room-label').textContent = multiplayer.roomCode;
  const role = isHost() ? 'HOST' : 'GUEST';
  document.getElementById('mp-player-count').textContent =
    `${multiplayer.playerCount} PLAYER${multiplayer.playerCount === 1 ? '' : 'S'} · ${role}`;
}
function clearRemoteRender() {
  for (const rc of remoteCops.values()) { worldRoot.remove(rc.mesh); freeGeo(rc.mesh); }
  remoteCops.clear();
  for (const rc of remotePcars.values()) { worldRoot.remove(rc.mesh); rc.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
  remotePcars.clear();
  npcBuf.clear(); carBuf.clear(); ratBuf.clear(); pendingPickups.clear();
  multiplayer.remoteJet = null; multiplayer.remoteJetBuf = null;
}
export function mpResetConnectionState() {
  try { multiplayer.peer?.destroy(); } catch (_) {}
  multiplayer.peer = null;
  multiplayer.mode = 'single';
  multiplayer.hostConnection = null;
  multiplayer.connections.clear();
  multiplayer.carOwners.clear();
  multiplayer.playerCount = 1;
  multiplayer.roomCode = '';
  multiplayer.localId = '1';
  multiplayer.hostId = '1';
  multiplayer.playerOrder = ['1'];
  multiplayer.migrating = false;
  multiplayer.grantBypass = -1;
  multiplayer.worldVersion = 0;
  lastStreamVersion = -1;
  for (const remote of multiplayer.remotePlayers.values()) {
    if (remote.rig) { scene.remove(remote.rig); freeGeo(remote.rig); }
    if (remote.tag) scene.remove(remote.tag);
  }
  multiplayer.remotePlayers.clear();
  clearRemoteRender();
  hooks.mpJetApplyRemote(null);
  updateHud();
}
function broadcast(data, exceptId = null) {
  for (const [id, conn] of multiplayer.connections) {
    if (id !== exceptId && conn.open) conn.send(data);
  }
}
function sendHost(data) {
  if (multiplayer.hostConnection?.open) multiplayer.hostConnection.send(data);
}
function currentState() {
  const moving = Math.hypot(player.pvx || 0, player.pvz || 0) > 0.4 || !!(keys.KeyW || keys.KeyS || keys.KeyA || keys.KeyD);
  return {
    x: r2(player.x), y: r2(player.y), z: r2(player.z), yaw: r3(player.yaw), pitch: r3(player.pitch),
    crouching: player.crouching, grounded: player.grounded, moving,
    sprinting: !!(keys.ShiftLeft || keys.ShiftRight) && moving,
    weapon: gameState.activeRightWeapon, attacking: player.attackTimer > 0,
    inCar: gameState.inCar, carIdx: gameState.activeCarIndex, hp: Math.round(gameState.hp),
    bodyColor: levelData.params.player.bodyColor, accentColor: levelData.params.player.accentColor,
    name: isHost() ? 'HOST' : multiplayer.localId,
  };
}
function makeNameTag(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(8,11,17,.72)'; ctx.fillRect(28, 10, 200, 44);
  ctx.strokeStyle = 'rgba(245,158,11,.8)'; ctx.lineWidth = 3; ctx.strokeRect(28, 10, 200, 44);
  ctx.fillStyle = '#fcd34d'; ctx.font = 'bold 28px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(1.6, 0.4, 1);
  return spr;
}
function ensureRemoteRig(id) {
  let remote = multiplayer.remotePlayers.get(id);
  if (!remote) { remote = { x: 0, y: 0.18, z: 0, yaw: 0, buf: null }; multiplayer.remotePlayers.set(id, remote); }
  if (!remote.rig) {
    const built = buildPlayerRigMesh({ bodyColor: remote.bodyColor || '#64748b', accentColor: remote.accentColor || '#1e293b' });
    built.tpRig.visible = true;
    scene.add(built.tpRig);
    remote.rig = built.tpRig;
    remote.limbs = built;
    remote.tag = makeNameTag(id === multiplayer.hostId ? 'HOST' : id);
    scene.add(remote.tag);
    remote.weaponId = null;
  }
  return remote;
}
function feedRemoteState(id, s) {
  if (!s || id === multiplayer.localId) return;
  const remote = ensureRemoteRig(id);
  const now = performance.now();
  const prev = remote.buf ? remote.buf.p1 : { x: s.x, y: s.y, z: s.z, yaw: s.yaw };
  remote.buf = { p0: prev, p1: { x: s.x, y: s.y, z: s.z, yaw: s.yaw }, t0: remote.buf ? remote.buf.t1 : now - 1, t1: now };
  Object.assign(remote, s);
}
export function updateRemotePlayers(dt) {
  const renderT = performance.now() - INTERP_DELAY;
  for (const [id, remote] of multiplayer.remotePlayers) {
    if (!remote.rig) continue;
    const rig = remote.rig;
    let x = remote.x ?? 0, y = remote.y ?? 0.18, z = remote.z ?? 0, yaw = remote.yaw || 0;
    if (remote.buf) {
      const { p0, p1, t0, t1 } = remote.buf;
      const t = t1 > t0 ? Math.max(0, Math.min(1.35, (renderT - t0) / (t1 - t0))) : 1;
      x = p0.x + (p1.x - p0.x) * t; y = p0.y + (p1.y - p0.y) * t; z = p0.z + (p1.z - p0.z) * t;
      yaw = lerpAngle(p0.yaw, p1.yaw, Math.min(1, t));
    }
    rig.position.set(x, y, z);
    rig.rotation.y = yaw;
    rig.visible = isActive() && !remote.inCar;
    if (remote.tag) { remote.tag.visible = rig.visible; remote.tag.position.set(x, y + 2.15, z); }
    const limbs = remote.limbs;
    if (!limbs) continue;
    if (remote.moving && !remote.inCar) {
      remote.walkPhase = (remote.walkPhase || 0) + dt * (remote.sprinting ? 15 : 9);
      const s = Math.sin(remote.walkPhase);
      limbs.tpLegL.rotation.x = s * 0.55; limbs.tpLegR.rotation.x = -s * 0.55;
      limbs.tpKneeL.rotation.x = Math.max(0, -s * 0.3); limbs.tpKneeR.rotation.x = Math.max(0, s * 0.3);
      limbs.tpArmL.rotation.x = -s * 0.45; limbs.tpArmR.rotation.x = s * 0.45;
    } else {
      limbs.tpLegL.rotation.x = 0; limbs.tpLegR.rotation.x = 0;
      limbs.tpKneeL.rotation.x = 0; limbs.tpKneeR.rotation.x = 0;
      limbs.tpArmL.rotation.x = 0; limbs.tpArmR.rotation.x = 0;
    }
    limbs.tpHip.scale.y = remote.crouching ? 0.72 : 1;
    limbs.tpHip.position.y = remote.crouching ? 0.65 : 0.90;
    if (remote.weaponId !== remote.weapon) {
      remote.weaponId = remote.weapon;
      if (remote.weaponMount) { remote.limbs.tpElbowR.remove(remote.weaponMount); freeGeo(remote.weaponMount); remote.weaponMount = null; }
      if (remote.weapon && remote.weapon !== 'fists') {
        const wm = buildRightWeaponMesh(remote.weapon);
        wm.position.set(0, -0.26, 0.05);
        wm.rotation.x = Math.PI / 2;
        remote.limbs.tpElbowR.add(wm);
        remote.weaponMount = wm;
      }
    }
    if (remote.attacking) limbs.tpArmR.rotation.x = -1.3;
    else if (remote.weapon === 'hotdog_shooter') limbs.tpArmR.rotation.x = -1.48;
  }
}
const F_SLEEP = 1, F_HOSTILE = 2, F_MOVING = 4, F_FLEE = 8, F_STUN = 16, F_PICKED = 32, F_SEARCH = 64;
function npcFlags(n) {
  return (n.asleep ? F_SLEEP : 0) | (n.hostile ? F_HOSTILE : 0) | (n.moving ? F_MOVING : 0) |
    ((n.fleeTimer || 0) > 0 ? F_FLEE : 0) | ((n.stunTimer || 0) > 0 ? F_STUN : 0) |
    (n.picked ? F_PICKED : 0) | (n.alertState === 'searching' ? F_SEARCH : 0);
}
function npcFullRow(n) {
  return {
    id: n.id, name: n.name, line: n.line, role: n.role, aggro: n.aggro, clanId: n.clanId,
    homeX: n.homeX, homeZ: n.homeZ, shirt: n.shirt, pants: n.pants, bandana: n.bandana,
    age: n.age, skin: n.skin, hair: n.hair, scale: n.scale,
    gtFestival: n.gtFestival, gtLook: n.gtLook, gtHat: n.gtHat, gtSkirt: n.gtSkirt, gtSash: n.gtSash, gtRole: n.gtRole,
    x: r2(n.x), z: r2(n.z), yaw: r3(n.yaw), hp: Math.round(n.hp), maxHp: n.maxHp,
    asleep: !!n.asleep, sleepTimer: r2(n.sleepTimer || 0), hostile: !!n.hostile, alertState: n.alertState,
    picked: !!n.picked, pickCool: r2(n.pickCool || 0), wallet: n.wallet || 0, fleeTimer: r2(n.fleeTimer || 0),
  };
}
function applyNpcFull(row) {
  const n = npcs[row.id];
  if (!n) return;
  Object.assign(n, row);
  if (n.mesh) { worldRoot.remove(n.mesh); freeGeo(n.mesh); n.mesh = null; n.spawned = false; n.queued = false; }
  if (n.sleepZGroup) { worldRoot.remove(n.sleepZGroup); freeGeo(n.sleepZGroup); n.sleepZGroup = null; }
}
function buildDigest() {
  const destroyedCrates = [], destroyedBarrels = [], takenPickups = [];
  digestBaseline.crates.forEach(id => { if (!smashableCrates.some(c => c.netId === id)) destroyedCrates.push(id); });
  digestBaseline.barrels.forEach(id => { if (!hazardBarrels.some(b => b.netId === id)) destroyedBarrels.push(id); });
  digestBaseline.pickups.forEach(id => { if (!worldPickups.some(p => p.netId === id)) takenPickups.push(id); });
  const dynamicPickups = worldPickups.filter(p => !digestBaseline.pickups.includes(p.netId))
    .map(p => ({ netId: p.netId, type: p.type, id: p.id, x: r2(p.x), y: r2(p.y), z: r2(p.z) }));
  return {
    v: multiplayer.worldVersion, seq: getNetSeq(),
    heat: r2(AO.heat), lead: r2(hooks.mpFestivalLead()),
    npcsFull: npcs.map(npcFullRow),
    crates: destroyedCrates, barrels: destroyedBarrels, pickupsTaken: takenPickups, pickups: dynamicPickups,
    lamps: lampPosts.map((lp, i) => [i, lp.state, r3(lp.fallYaw || 0), r3(lp.fallAngle || 0), r2(lp.respawnTimer || 0)]),
    manholes: manholeOpen.map(Boolean),
    gate: !!aura.estates?.gate.open,
    safes: (aura.estates?.houses || []).map(h => !!h.taken),
    traffic: vehicles.map(v => !!v.isTraffic),
    owners: Array.from(multiplayer.carOwners.entries()),
    order: multiplayer.playerOrder.slice(), hostId: multiplayer.hostId,
    cops: AO.cops.map(c => [c.netId, r2(c.x), r2(c.z), r2(c.mesh.position.y), Math.round(c.hp)]),
    pcars: AO.cars.map(c => [c.netId, r2(c.x), r2(c.z), r2(c.mesh.position.y), r3(c.yaw), r2(c.sp)]),
    rats: rats.map((r, i) => [i, r2(r.x), r2(r.z), r.dead ? 1 : 0]),
    jet: multiplayer.remoteJet || hooks.mpJetDigest(),
    players: Array.from(multiplayer.remotePlayers.entries()).map(([id, r]) => [id, {
      x: r.x, y: r.y, z: r.z, yaw: r.yaw, pitch: r.pitch, crouching: r.crouching, inCar: r.inCar,
      carIdx: r.carIdx, weapon: r.weapon, hp: r.hp, moving: r.moving, bodyColor: r.bodyColor, accentColor: r.accentColor,
    }]),
  };
}
const digestBaseline = { crates: [], barrels: [], pickups: [], captured: false };
function captureBaseline() {
  if (digestBaseline.captured) return;
  digestBaseline.crates = smashableCrates.map(c => c.netId);
  digestBaseline.barrels = hazardBarrels.map(b => b.netId);
  digestBaseline.pickups = worldPickups.map(p => p.netId);
  digestBaseline.captured = true;
}
function applyLampRow([i, state, yaw, angle, timer]) {
  const lp = lampPosts[i];
  if (!lp) return;
  if (state === 'standing') {
    lp.state = 'standing'; lp.fallAngle = 0; lp.fallVel = 0;
    lp.pivot.rotation.set(0, 0, 0);
    lp.lampMat.emissiveIntensity = 0.95; lp.lampMat.color.setHex(0xfef08a);
    lp.boxRef.minY = 0.18; lp.boxRef.maxY = 4.6;
  } else {
    if (lp.state === 'standing') knockOverLamppostBase(lp, yaw, 6);
    lp.state = state; lp.fallYaw = yaw; lp.fallAngle = angle; lp.respawnTimer = timer;
    lp.pivot.rotation.order = 'YXZ'; lp.pivot.rotation.y = yaw; lp.pivot.rotation.x = angle;
  }
}
function applyDigest(d) {
  if (!d) return;
  captureBaseline();
  multiplayer.worldVersion = d.v || 0;
  lastStreamVersion = multiplayer.worldVersion;
  setNetSeq(d.seq || 0);
  AO.heat = d.heat || 0;
  hooks.mpSetFestivalLead(d.lead);
  (d.npcsFull || []).forEach(applyNpcFull);
  npcBuf.clear();
  (d.crates || []).forEach(id => { const rec = smashableCrates.find(c => c.netId === id); if (rec) destroyCrate(rec, false); });
  (d.barrels || []).forEach(id => { const rec = hazardBarrels.find(b => b.netId === id); if (rec) destroyBarrel(rec); });
  (d.pickupsTaken || []).forEach(id => removePickupByNetId(id));
  (d.pickups || []).forEach(p => { if (!worldPickups.some(q => q.netId === p.netId)) spawnWorldPickup(p.type, p.id, p.x, p.y, p.z, { netId: p.netId }); });
  (d.lamps || []).forEach(applyLampRow);
  (d.manholes || []).forEach((open, i) => { manholeOpen[i] = !!open; });
  if (aura.estates) {
    if (d.gate) aura.estates.applyGate(true);
    (d.safes || []).forEach((taken, i) => { if (taken) aura.estates.applySafe(i); });
  }
  (d.traffic || []).forEach((flag, i) => { if (vehicles[i]) vehicles[i].isTraffic = !!flag; });
  multiplayer.carOwners = new Map(d.owners || []);
  if (Array.isArray(d.order)) multiplayer.playerOrder = d.order;
  if (d.hostId) multiplayer.hostId = d.hostId;
  seedCopBuffers(d.cops || [], d.pcars || []);
  (d.rats || []).forEach(([i, x, z, dead]) => { const r = rats[i]; if (r) { r.x = x; r.z = z; r.dead = !!dead; r.mesh.visible = !dead; } });
  if (d.jet && d.jet.owner && d.jet.owner !== multiplayer.localId && (d.jet.flying || d.jet.dead)) multiplayer.remoteJet = d.jet;
  else multiplayer.remoteJet = null;
  (d.players || []).forEach(([id, s]) => { if (id !== multiplayer.localId) feedRemoteState(id, s); });
}
function buildWorldStream() {
  const anchors = [{ x: player.x, z: player.z }];
  for (const r of multiplayer.remotePlayers.values()) anchors.push({ x: r.x || 0, z: r.z || 0 });
  const near = (x, z, rad) => anchors.some(a => Math.hypot(a.x - x, a.z - z) < rad);
  const rows = [];
  for (const n of npcs) {
    if (!n.spawned && !near(n.x, n.z, 140)) continue;
    rows.push([n.id, r2(n.x), r2(n.z), r3(n.yaw), Math.round(n.hp), r2(n.walkCycle || 0), npcFlags(n), r2(n.punchTimer || 0), n.punchSide || 0]);
  }
  return {
    type: 'wstream', v: multiplayer.worldVersion,
    npcs: rows,
    cars: vehicles.map((v, i) => [i, r2(v.x), r2(v.y), r2(v.z), r3(v.yaw), r2(v.speed), r3(v.steerAngle || 0), v.gearIndex, Math.round(v.rpm || 0), v.isTraffic ? 1 : 0]),
    cops: AO.cops.map(c => [c.netId, r2(c.x), r2(c.z), r2(c.mesh.position.y), Math.round(c.hp)]),
    pcars: AO.cars.map(c => [c.netId, r2(c.x), r2(c.z), r2(c.mesh.position.y), r3(c.yaw), r2(c.sp)]),
    rats: rats.map((r, i) => [i, r2(r.x), r2(r.z), r.dead ? 1 : 0]),
    jet: multiplayer.remoteJet || hooks.mpJetDigest(),
    heat: r2(AO.heat), lead: r2(hooks.mpFestivalLead()),
  };
}
function pushBuf(map, key, point) {
  const now = performance.now();
  let b = map.get(key);
  if (!b) { b = { p0: point, p1: point, t0: now - 1, t1: now }; map.set(key, b); }
  else { b.p0 = b.p1; b.p1 = point; b.t0 = b.t1; b.t1 = now; }
  return b;
}
function sampleBuf(b, renderT) {
  if (!b) return null;
  const t = b.t1 > b.t0 ? Math.max(0, Math.min(1.5, (renderT - b.t0) / (b.t1 - b.t0))) : 1;
  return {
    x: b.p0.x + (b.p1.x - b.p0.x) * t,
    y: (b.p0.y ?? 0) + ((b.p1.y ?? 0) - (b.p0.y ?? 0)) * t,
    z: b.p0.z + (b.p1.z - b.p0.z) * t,
    yaw: lerpAngle(b.p0.yaw ?? 0, b.p1.yaw ?? 0, Math.min(1, t)),
    t,
  };
}
function applyWorldStream(s) {
  AO.heat = s.heat || 0;
  hooks.mpSetFestivalLead(s.lead);
  if (s.v !== lastStreamVersion && performance.now() - multiplayer.lastDigestReq > 1500) {
    multiplayer.lastDigestReq = performance.now();
    sendHost({ type: 'digest_req' });
  }
  lastStreamVersion = s.v;
  for (const row of s.npcs || []) {
    const [id, x, z, yaw, hp, walk, flags, punch, side] = row;
    const n = npcs[id];
    if (!n) continue;
    pushBuf(npcBuf, id, { x, z, yaw });
    n.hp = hp;
    n.asleep = !!(flags & F_SLEEP); n.hostile = !!(flags & F_HOSTILE); n.moving = !!(flags & F_MOVING);
    n.fleeTimer = (flags & F_FLEE) ? Math.max(n.fleeTimer || 0, 0.3) : 0;
    n.stunTimer = (flags & F_STUN) ? Math.max(n.stunTimer || 0, 0.2) : 0;
    n.picked = !!(flags & F_PICKED);
    n.alertState = (flags & F_HOSTILE) ? 'chasing' : (flags & F_SEARCH) ? 'searching' : 'patrol';
    n.walkCycle = walk; n.punchTimer = punch; n.punchSide = side;
  }
  for (const row of s.cars || []) {
    const [i, x, y, z, yaw, speed, steer, gear, rpm, traffic] = row;
    const v = vehicles[i];
    if (!v) continue;
    v.isTraffic = !!traffic;

    const owner = multiplayer.carOwners.get(i);
    if ((gameState.inCar && gameState.activeCarIndex === i) || owner === multiplayer.localId) continue;

    pushBuf(carBuf, i, { x, y, z, yaw });
    v.speed = speed; v.steerAngle = steer; v.gearIndex = gear; v.rpm = rpm;
  }
  syncCopBuffers(s.cops || [], s.pcars || []);
  for (const [i, x, z, dead] of s.rats || []) {
    pushBuf(ratBuf, i, { x, z, yaw: 0 });
    const r = rats[i];
    if (r) { r.dead = !!dead; r.mesh.visible = !dead; }
  }
  const jet = s.jet;
  if (jet && jet.owner && jet.owner !== multiplayer.localId && (jet.flying || jet.dead)) {
    multiplayer.remoteJet = jet;
    const now = performance.now();
    const prev = multiplayer.remoteJetBuf ? multiplayer.remoteJetBuf.p1 : jet;
    multiplayer.remoteJetBuf = { p0: prev, p1: jet, t0: multiplayer.remoteJetBuf ? multiplayer.remoteJetBuf.t1 : now - 1, t1: now };
  } else {
    multiplayer.remoteJet = null;
    multiplayer.remoteJetBuf = null;
  }
}
function guestNpcFrame(dt, elapsed) {
  const renderT = performance.now() - INTERP_DELAY;
  const SPAWN = 82, DESPAWN = 130;
  for (const n of npcs) {
    const b = npcBuf.get(n.id);
    const pose = sampleBuf(b, renderT);
    if (pose) { n.x = pose.x; n.z = pose.z; n.yaw = pose.yaw; }
    const d = Math.hypot(n.x - player.x, n.z - player.z);
    if (!n.spawned && d < SPAWN && b) {
      n.mesh = buildNpcMeshRaw(n.shirt, n.pants, n.bandana, n);
      n.mesh.position.set(n.x, 0.18, n.z);
      n.mesh.rotation.y = n.yaw;
      worldRoot.add(n.mesh);
      n.spawned = true;
    } else if (n.spawned && d > DESPAWN) {
      worldRoot.remove(n.mesh); freeGeo(n.mesh); n.mesh = null; n.spawned = false;
      if (n.sleepZGroup) { worldRoot.remove(n.sleepZGroup); freeGeo(n.sleepZGroup); n.sleepZGroup = null; }
      continue;
    }
    if (!n.spawned || !n.mesh) continue;
    if (Math.abs(n.kvx || 0) + Math.abs(n.kvz || 0) > 0.05) {
      n.x += (n.kvx || 0) * dt; n.z += (n.kvz || 0) * dt;
      const dec = Math.exp(-7 * dt); n.kvx *= dec; n.kvz *= dec;
    }
    const u = n.mesh.userData;
    if (n.asleep) {
      n.mesh.position.set(n.x, 0.34, n.z);
      n.mesh.rotation.order = 'YXZ';
      n.mesh.rotation.y = n.yaw; n.mesh.rotation.x = -Math.PI / 2; n.mesh.rotation.z = 0;
      u.legL.rotation.x = 0.08; u.legR.rotation.x = -0.06;
      u.armL.rotation.x = 0.15; u.armR.rotation.x = -0.15;
      if (!n.sleepZGroup) {
        n.sleepZGroup = buildSleepZzzGroup();
        worldRoot.add(n.sleepZGroup);
      }
      n.sleepZGroup.position.set(n.x, 0.78 + Math.sin(elapsed * 2.4 + n.id) * 0.14, n.z);
      n.sleepZGroup.lookAt(scene.getObjectByProperty('type', 'PerspectiveCamera')?.position || n.mesh.position);
      continue;
    }
    if (n.sleepZGroup) { worldRoot.remove(n.sleepZGroup); freeGeo(n.sleepZGroup); n.sleepZGroup = null; }
    n.mesh.rotation.x = 0;
    if ((n.stunTimer || 0) > 0) {
      n.stunTimer -= dt;
      n.mesh.position.set(n.x, 0.18, n.z);
      n.mesh.rotation.y = n.yaw;
      n.mesh.rotation.z = Math.sin(elapsed * 24) * 0.22;
      continue;
    }
    n.mesh.rotation.z = 0;
    if ((n.punchTimer || 0) > 0) n.punchTimer -= dt;
    const fast = n.hostile || (n.fleeTimer || 0) > 0;
    if (n.moving) n.walkCycle += dt * (fast ? 12.5 : 7.5);
    const sw = n.moving ? Math.sin(n.walkCycle) * (fast ? 0.78 : 0.52) : 0;
    u.legL.rotation.x = sw; u.legR.rotation.x = -sw;
    u.armL.rotation.x = -sw * 0.75; u.armR.rotation.x = sw * 0.75;
    u.armL.rotation.z = 0; u.armR.rotation.z = 0; u.torso.rotation.y = 0;
    if ((n.punchTimer || 0) > 0) {
      const pProg = 1 - n.punchTimer / 0.34;
      const arc = Math.sin(pProg * Math.PI);
      if (n.punchSide === 0) { u.armR.rotation.x = -1.45 * arc; u.armR.rotation.z = -0.65 * arc; u.torso.rotation.y = 0.42 * arc; }
      else { u.armL.rotation.x = -1.45 * arc; u.armL.rotation.z = 0.65 * arc; u.torso.rotation.y = -0.42 * arc; }
    }
    n.mesh.position.set(n.x, 0.18, n.z);
    n.mesh.rotation.y = n.yaw;
  }
}
function seedCopBuffers(cops, pcars) {
  for (const rc of remoteCops.values()) { worldRoot.remove(rc.mesh); freeGeo(rc.mesh); }
  remoteCops.clear();
  for (const rc of remotePcars.values()) { worldRoot.remove(rc.mesh); rc.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
  remotePcars.clear();
  syncCopBuffers(cops, pcars);
}
function syncCopBuffers(cops, pcars) {
  const seenC = new Set(), seenP = new Set();
  for (const [netId, x, z, y, hp] of cops) {
    seenC.add(netId);
    let rc = remoteCops.get(netId);
    if (!rc) {
      const mesh = buildCopMesh();
      worldRoot.add(mesh);
      rc = { mesh, buf: null };
      remoteCops.set(netId, rc);
    }
    rc.hp = hp;
    rc.buf = pushBuf(remoteCops, netId, { x, z, y, yaw: 0 }) === rc.buf ? rc.buf : rc.buf;
    rc.buf = remoteCops.get(netId).buf || rc.buf;
  }
  for (const [netId, rc] of remoteCops) if (!seenC.has(netId)) { worldRoot.remove(rc.mesh); freeGeo(rc.mesh); remoteCops.delete(netId); }
  for (const [netId, x, z, y, yaw, sp] of pcars) {
    seenP.add(netId);
    let rc = remotePcars.get(netId);
    if (!rc) {
      const { group, lr, lb } = buildCopCarMesh();
      worldRoot.add(group);
      rc = { mesh: group, lr, lb, buf: null };
      remotePcars.set(netId, rc);
    }
    rc.sp = sp;
    pushBuf(remotePcars, netId, { x, z, y, yaw });
    rc.buf = remotePcars.get(netId).buf || rc.buf;
  }
  for (const [netId, rc] of remotePcars) if (!seenP.has(netId)) { worldRoot.remove(rc.mesh); rc.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); remotePcars.delete(netId); }
}
function pushRecordBuf(rc, point) {
  const now = performance.now();
  if (!rc.buf) rc.buf = { p0: point, p1: point, t0: now - 1, t1: now };
  else { rc.buf.p0 = rc.buf.p1; rc.buf.p1 = point; rc.buf.t0 = rc.buf.t1; rc.buf.t1 = now; }
}
function guestCopFrame(dt, t) {
  const renderT = performance.now() - INTERP_DELAY;
  for (const rc of remoteCops.values()) {
    const p = sampleBuf(rc.buf, renderT);
    if (!p) continue;
    rc.mesh.position.set(p.x, p.y, p.z);
    const dx = player.x - p.x, dz = player.z - p.z;
    rc.mesh.rotation.y = Math.atan2(dx, dz);
  }
  for (const rc of remotePcars.values()) {
    const p = sampleBuf(rc.buf, renderT);
    if (!p) continue;
    rc.mesh.position.set(p.x, p.y + 0.02, p.z);
    rc.mesh.rotation.y = p.yaw;
    const fl = Math.sin(t * 14) > 0;
    rc.lr.visible = fl; rc.lb.visible = !fl;
  }
}
function guestRatFrame(dt, t) {
  const renderT = performance.now() - INTERP_DELAY;
  for (const [i, b] of ratBuf) {
    const r = rats[i];
    if (!r) continue;
    const p = sampleBuf(b, renderT);
    if (p) { r.x = p.x; r.z = p.z; }
    r.mesh.visible = !r.dead;
    if (!r.dead) r.mesh.position.set(r.x, -9 + .1 + Math.abs(Math.sin(t * 14 + r.ph)) * .04, r.z);
  }
}
export function updateRemoteWorld(dt, elapsed) {
  if (!isGuest()) return;
  const renderT = performance.now() - INTERP_DELAY;
  for (const [i, b] of carBuf) {
    if (gameState.inCar && gameState.activeCarIndex === i) continue;
    if (multiplayer.carOwners.get(i) === multiplayer.localId) continue;    
    const v = vehicles[i];
    if (!v) continue;
    const p = sampleBuf(b, renderT);
    if (!p) continue;
    v.x = p.x; v.y = p.y; v.z = p.z; v.yaw = p.yaw;
    v.root.position.set(v.x, v.y, v.z);
    v.root.rotation.y = v.yaw;
    if (v.wheelPivots) { v.wheelPivots[0].rotation.y = v.steerAngle || 0; v.wheelPivots[1].rotation.y = v.steerAngle || 0; }
    if (!v.isTraffic && v.wheelSpinners) v.wheelSpinners.forEach(ws => { ws.rotation.x += ((v.speed || 0) * dt) / 0.38; });
  }
  const jb = multiplayer.remoteJetBuf;
  if (jb) {
    const t = jb.t1 > jb.t0 ? Math.max(0, Math.min(1.5, (renderT - jb.t0) / (jb.t1 - jb.t0))) : 1;
    const a = jb.p0, c = jb.p1;
    const qa = new THREE.Quaternion(a.qx, a.qy, a.qz, a.qw);
    const qc = new THREE.Quaternion(c.qx, c.qy, c.qz, c.qw);
    qa.slerp(qc, Math.min(1, t));
    hooks.mpJetApplyRemote({
      x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t, z: a.z + (c.z - a.z) * t,
      qx: qa.x, qy: qa.y, qz: qa.z, qw: qa.w,
      speed: c.speed, throttle: c.throttle, ground: c.ground, dead: c.dead, nukes: c.nukes, ab: c.ab,
    });
  } else {
    hooks.mpJetApplyRemote(null);
  }
}
function grantPickupRec(rec) {
  if (!rec) return;
  if (rec.type === 'right') {
    if (!gameState.rightWeapons.includes(rec.id)) gameState.rightWeapons.push(rec.id);
    gameState.activeRightWeapon = rec.id;
    if (rec.id === 'hotdog_shooter') gameState.hotdogAmmo = MAX_HOTDOG_AMMO;
    sfx.pickup();
    syncEquippedMeshes();
    pushFeed('EQUIPPED ' + rec.id.toUpperCase(), 'border-l-amber-400');
  } else if (addLeftItemToBag(rec.id, 1)) {
    sfx.pickup();
    syncEquippedMeshes();
    pushFeed('COLLECTED ' + rec.id.toUpperCase(), 'border-l-sky-400');
  }
  hooks.updateHUD();
}
function applyWorldEvent(ev) {
  const me = multiplayer.localId;
  switch (ev.t) {
    case 'wiener':
      if (ev.by !== me) spawnNetWiener(ev.x, ev.y, ev.z, ev.vx, ev.vy, ev.vz, ev.by);
      break;
    case 'car_impact': {
      const v = vehicles[ev.idx];
      if (v) {
        const owner = multiplayer.carOwners.get(ev.idx);
        if (!owner || owner === me || (gameState.inCar && gameState.activeCarIndex === ev.idx)) {
          v.velX = (v.velX || 0) + ev.ix;
          v.velZ = (v.velZ || 0) + ev.iz;
          v.yaw = (v.yaw || 0) + ev.iyaw;
          const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
          v.speed = v.velX * fx + v.velZ * fz;
        }
      }
      break;
    }
    case 'crate_hit': {
      if (!isHost()) break;
      const rec = smashableCrates.find(c => c.netId === ev.netId);
      if (!rec) break;
      rec.hp -= ev.a;
      if (rec.hp <= 0) {
        const lootRec = destroyCrate(rec, true);
        const dead = { t: 'crate_dead', netId: rec.netId, x: rec.x, y: rec.y, z: rec.z, by: ev.by,
          loot: lootRec ? { netId: lootRec.netId, type: lootRec.type, id: lootRec.id, x: lootRec.x, y: lootRec.y, z: lootRec.z } : null };
        applyWorldEvent(dead);
        broadcast({ type: 'wevt', ev: dead });
        multiplayer.worldVersion++;
      }
      break;
    }
    case 'crate_dead': {
      const rec = smashableCrates.find(c => c.netId === ev.netId);
      if (rec) {
        destroyCrate(rec, false);
        sfx.smash();
        spawnParticles(ev.x, ev.y + 0.55, ev.z, 0x92400e, 14, 6.5);
      }
      if (ev.loot && !worldPickups.some(p => p.netId === ev.loot.netId)) {
        spawnWorldPickup(ev.loot.type, ev.loot.id, ev.loot.x, ev.loot.y, ev.loot.z, { netId: ev.loot.netId });
      }
      break;
    }
    case 'barrel_hit': {
      if (!isHost()) break;
      const rec = hazardBarrels.find(b => b.netId === ev.netId);
      if (!rec) break;
      rec.hp -= ev.a;
      if (rec.hp <= 0) {
        destroyBarrel(rec);
        const dead = { t: 'barrel_dead', netId: rec.netId, x: rec.x, y: rec.y, z: rec.z, by: ev.by };
        applyWorldEvent(dead);
        broadcast({ type: 'wevt', ev: dead });
        multiplayer.worldVersion++;
      }
      break;
    }
    case 'barrel_dead': {
      const rec = hazardBarrels.find(b => b.netId === ev.netId);
      if (rec) {
        destroyBarrel(rec);
        sfx.smash();
        spawnParticles(ev.x, ev.y + 0.6, ev.z, 0xf97316, 18, 8.5);
        if (Math.hypot(player.x - ev.x, player.z - ev.z) < 4.2) hooks.applyPlayerDamage(24, 'EXPLOSIVE BARREL');
      }
      break;
    }
    case 'lamp_hit': {
      const lp = lampPosts[ev.i];
      if (lp && lp.state === 'standing') {
        knockOverLamppostBase(lp, ev.yaw, ev.speed);
      }
      if (isHost() && ev.by !== me && ev.speed > 6) AO.heat = Math.min(5, AO.heat + 0.08);
      break;
    }
    case 'lamp_up': applyLampRow([ev.i, 'standing', 0, 0, 0]); break;
    case 'manhole': manholeOpen[ev.i] = true; break;
    case 'gate':
      if (aura.estates) aura.estates.applyGate(true);
      if (isHost() && ev.by !== me) AO.heat = Math.min(5, AO.heat + 0.35);
      break;
    case 'safe':
      if (aura.estates) aura.estates.applySafe(ev.i);
      if (isHost() && ev.by !== me) AO.heat = Math.min(5, AO.heat + 0.5);
      break;
    case 'pickup_spawn':
      if (!worldPickups.some(p => p.netId === ev.netId)) spawnWorldPickup(ev.type, ev.id, ev.x, ev.y, ev.z, { netId: ev.netId });
      break;
    case 'pickup_taken': {
      const rec = removePickupByNetId(ev.netId);
      if (rec && ev.by === me && isGuest()) { grantPickupRec(rec); pendingPickups.delete(ev.netId); }
      break;
    }
    case 'npc_looted': {
      const n = npcs[ev.id];
      if (!n) break;
      n.picked = true; n.pickCool = ev.cool;
      if (ev.by === me && isGuest() && ev.cash) {
        gameState.cash += ev.cash;
        let extra = '';
        if (ev.item) { addLeftItemToBag(ev.item, 1); extra = ' + ITEM'; }
        sfx.pickup();
        pushFeed(`PICKPOCKETED ${n.name}: +$${ev.cash}${extra}`, 'border-l-emerald-400');
        hooks.updateHUD();
      }
      break;
    }
    case 'npc_alert': {
      if (!isHost()) break;
      const n = npcs[ev.id];
      if (!n) break;
      n.picked = true; n.pickCool = 60;
      if (n.aggro === 'fighter' || n.aggro === 'clan' || n.aggro === 'thug') { n.hostile = true; n.alertState = 'chasing'; }
      else n.fleeTimer = 8;
      break;
    }
    case 'driver_eject': {
      const v = vehicles[ev.idx];
      if (v && v.isTraffic) hooks.onVehicleEnter(v);
      break;
    }
    case 'rat_dead': {
      const r = rats[ev.i];
      if (r && !r.dead) { r.dead = true; r.mesh.visible = false; spawnParticles(r.x, -9 + .3, r.z, 0x7c2d12, 6, 3); }
      break;
    }
    case 'nuke':
      if (ev.by !== me) hooks.mpSpawnBomb(ev.x, ev.y, ev.z, ev.vx, ev.vy, ev.vz);
      break;
    case 'jet_board':
      if (ev.by !== me) multiplayer.remoteJet = { owner: ev.by, flying: true, dead: false, x: -384, y: 39.6, z: -106, qx: 0, qy: 0.7071, qz: 0, qw: 0.7071, speed: 0, throttle: 0, ground: true, nukes: 4 };
      break;
    case 'jet_exit':
      if (ev.by !== me) {
        multiplayer.remoteJet = null; multiplayer.remoteJetBuf = null;
        if (ev.eject) spawnParticles(ev.x, ev.y, ev.z, 0xf97316, 12, 8);
        hooks.mpJetApplyRemote(null);
      }
      break;
    case 'jet_crash':
      if (ev.by !== me) {
        spawnParticles(ev.x, ev.y, ev.z, 0xf97316, 16, 10);
        if (multiplayer.remoteJet) multiplayer.remoteJet.dead = true;
      }
      break;
    case 'player_died':
      if (ev.by !== me) pushFeed('A PLAYER WAS WASTED — WANTED LEVEL CLEARED', 'border-l-sky-400');
      break;
  }
}
function mpWorldEvent(ev) {
  if (!isActive()) return;
  ev.by = multiplayer.localId;
  if (ev.t === 'jet_xform') {
    const now = performance.now();
    if (isHost()) { multiplayer.remoteJet = null; return; }
    if (now - multiplayer.lastJetSend < CAR_MS) return;
    multiplayer.lastJetSend = now;
    sendHost({ type: 'wevt', ev });
    return;
  }
  applyWorldEvent(ev);
  if (isHost()) {
    if (['crate_dead', 'barrel_dead', 'lamp_hit', 'lamp_up', 'manhole', 'gate', 'safe', 'pickup_spawn', 'pickup_taken', 'npc_looted', 'driver_eject', 'rat_dead', 'player_died'].includes(ev.t)) multiplayer.worldVersion++;
    broadcast({ type: 'wevt', ev });
  } else {
    sendHost({ type: 'wevt', ev });
  }
}
function hostReceiveEvent(id, ev) {
  ev.by = id;
  switch (ev.t) {
    case 'npc_hit': {
      const n = npcs[ev.id];
      if (!n || n.asleep) return;
      if (n.hp - ev.a <= 0 && !n.picked) {
        const cash = lootFor(n, 0.5);
        n.picked = true; n.pickCool = 90;
        if (cash > 0) multiplayer.connections.get(id)?.send({ type: 'award', cash });
      }
      damageNpcBase(n, ev.a, ev.y);
      AO.heat = Math.min(5, AO.heat + (ev.a > 40 ? .45 : .25));
      AO.calm = 0;
      return;
    }
    case 'cop_hit': {
      const c = AO.cops.find(c => c.netId === ev.netId);
      if (c) hurtCop(c, ev.a, id);
      return;
    }
    case 'rat_hit': {
      const r = rats[ev.i];
      if (r && !r.dead) {
        killRat(r, id);
        const dead = { t: 'rat_dead', i: ev.i, by: id };
        broadcast({ type: 'wevt', ev: dead });
        multiplayer.worldVersion++;
      }
      return;
    }
    case 'loot_req': {
      const n = npcs[ev.id];
      if (!n || n.picked) return;
      n.picked = true; n.pickCool = 120;
      const cash = lootFor(n);
      const item = Math.random() < 0.22 ? (Math.random() < 0.5 ? 'soda' : 'medkit') : null;
      const lootEv = { t: 'npc_looted', id: n.id, cool: 120, by: id, cash, item };
      broadcast({ type: 'wevt', ev: lootEv });
      multiplayer.worldVersion++;
      return;
    }
    case 'pickup_take': {
      const rec = removePickupByNetId(ev.netId);
      if (!rec) return;
      const taken = { t: 'pickup_taken', netId: ev.netId, by: id };
      broadcast({ type: 'wevt', ev: taken });
      multiplayer.worldVersion++;
      return;
    }
    case 'pickup_drop': {
      const rec = spawnWorldPickup(ev.type, ev.id, ev.x, ev.y, ev.z);
      const spawnEv = { t: 'pickup_spawn', netId: rec.netId, type: ev.type, id: ev.id, x: ev.x, y: ev.y, z: ev.z, by: id };
      broadcast({ type: 'wevt', ev: spawnEv });
      multiplayer.worldVersion++;
      return;
    }
    case 'safe_req': {
      const h = aura.estates?.houses[ev.i];
      if (!h || h.taken) return;
      aura.estates.applySafe(ev.i);
      AO.heat = Math.min(5, AO.heat + 0.5);
      multiplayer.connections.get(id)?.send({ type: 'award', cash: 600 });
      const safeEv = { t: 'safe', i: ev.i, by: id };
      broadcast({ type: 'wevt', ev: safeEv });
      multiplayer.worldVersion++;
      return;
    }
    case 'crime': AO.heat = Math.min(5, AO.heat + (Number(ev.a) || 0)); AO.calm = 0; return;
    case 'died': {
      clearWantedLevel();
      const diedEv = { t: 'player_died', by: id };
      broadcast({ type: 'wevt', ev: diedEv });
      multiplayer.worldVersion++;
      return;
    }
    case 'mugged': {
      multiplayer.connections.get(ev.targetId)?.send({ type: 'mugged', amount: ev.amount, npcName: ev.npcName });
      return;
    }
    case 'jet_xform':
      multiplayer.remoteJet = { owner: id, flying: true, ...ev };
      return;
    case 'npc_alert':
      applyWorldEvent(ev);
      broadcast({ type: 'wevt', ev });
      return;
    default:
      applyWorldEvent(ev);
      if (['wiener', 'nuke', 'jet_board', 'jet_exit', 'jet_crash', 'car_impact'].includes(ev.t)) {
        broadcast({ type: 'wevt', ev });
      } else {
        multiplayer.worldVersion++;
        broadcast({ type: 'wevt', ev });
      }
  }
}
function mpHitPlayer(id, amount, source) {
  if (!isActive() || !id) return;
  const now = performance.now();
  if (now - (hitCooldown.get(id) || 0) < 600) return;
  hitCooldown.set(id, now);
  if (id === multiplayer.localId) { hooks.applyPlayerDamage(amount, source); return; }
  if (isHost()) multiplayer.connections.get(id)?.send({ type: 'hit', amount, source });
  else sendHost({ type: 'hit_req', targetId: id, a: amount, source });
}
function mpVehicleImpact(targetCarIdx, impulseX, impulseZ, yawImpulse) {
  if (!isActive() || targetCarIdx < 0) return;
  const ev = {
    t: 'car_impact',
    idx: targetCarIdx,
    ix: r2(impulseX),
    iz: r2(impulseZ),
    iyaw: r3(yawImpulse),
    by: multiplayer.localId
  };
  mpWorldEvent(ev);
}
function mpAward(id, cash, item) {
  if (!isActive()) return;
  if (id === multiplayer.localId) {
    gameState.cash += cash;
    if (item) addLeftItemToBag(item, 1);
    hooks.updateHUD();
    return;
  }
  if (isHost()) multiplayer.connections.get(id)?.send({ type: 'award', cash, item });
}
function mpTargets() {
  const out = [];
  for (const [id, r] of multiplayer.remotePlayers) {
    out.push({ id, x: r.x || 0, y: r.y ?? 0.18, z: r.z || 0, yaw: r.yaw || 0, crouching: !!r.crouching, inCar: !!r.inCar, carY: r.y, hp: r.hp ?? 100, attacking: !!r.attacking });
  }
  return out;
}
function mpMeleeCop() {
  const fx = Math.sin(player.yaw + Math.PI), fz = Math.cos(player.yaw + Math.PI);
  for (const [netId, rc] of remoteCops) {
    const dx = rc.mesh.position.x - player.x, dz = rc.mesh.position.z - player.z;
    const d = Math.hypot(dx, dz);
    if (d < 2.9 && Math.abs(player.y - rc.mesh.position.y) < 2.5 && (dx * fx + dz * fz) / Math.max(.1, d) > .2) {
      sendHost({ type: 'wevt', ev: { t: 'cop_hit', netId, a: 45, by: multiplayer.localId } });
      return;
    }
  }
}
function mpMeleeRat() {
  const fx = Math.sin(player.yaw + Math.PI), fz = Math.cos(player.yaw + Math.PI);
  for (let i = 0; i < rats.length; i++) {
    const r = rats[i];
    if (r.dead) continue;
    const dx = r.x - player.x, dz = r.z - player.z;
    const d = Math.hypot(dx, dz);
    if (d < 2.6 && (dx * fx + dz * fz) / Math.max(.1, d) > .2) {
      sendHost({ type: 'wevt', ev: { t: 'rat_hit', i, by: multiplayer.localId } });
      return;
    }
  }
}
function broadcastLocks() { broadcast({ type: 'locks', owners: Array.from(multiplayer.carOwners.entries()) }); }
function mpCarEnter(idx) {
  if (!isActive()) return true;
  const me = multiplayer.localId;
  if (isGuest()) {
    if (multiplayer.grantBypass === idx) { multiplayer.grantBypass = -1; return true; }
    sendHost({ type: 'car_req', idx });
    return false;
  }
  const owner = multiplayer.carOwners.get(idx);
  if (owner && owner !== me) { pushFeed('VEHICLE LOCKED BY ANOTHER PLAYER', 'border-l-rose-500'); return false; }
  multiplayer.carOwners.set(idx, me);
  broadcastLocks();
  const v = vehicles[idx];
  if (v && v.isTraffic) {
    v.isTraffic = false;
    broadcast({ type: 'wevt', ev: { t: 'driver_eject', idx, by: me } });
    multiplayer.worldVersion++;
  }
  return true;
}
function mpCarExit(idx) {
  if (!isActive() || idx < 0) return;
  if (isHost()) {
    if (multiplayer.carOwners.get(idx) === multiplayer.localId) { multiplayer.carOwners.delete(idx); broadcastLocks(); }
  } else sendHost({ type: 'car_exit', idx });
}
function mpCarLocked(idx) {
  const owner = multiplayer.carOwners.get(idx);
  return !!owner && owner !== multiplayer.localId;
}
function mpCarOwner(idx) { return multiplayer.carOwners.get(idx) || null; }
function mpNpcLoot(n) {
  if (!isActive()) return 'local';
  if (isGuest()) { sendHost({ type: 'wevt', ev: { t: 'loot_req', id: n.id, by: multiplayer.localId } }); return 'pending'; }
  mpWorldEvent({ t: 'npc_looted', id: n.id, cool: 120, cash: 0 });
  return 'local';
}
function mpJetLocked() {
  const j = multiplayer.remoteJet;
  return !!(j && j.owner && j.owner !== multiplayer.localId && (j.flying || j.dead));
}
function mpJetRenderRemote() {
  const j = multiplayer.remoteJet;
  if (!j || j.owner === multiplayer.localId) return false;
  return hooks.mpJetApplyRemote(j);
}
function attachHostConnection(conn) {
  const id = String(conn.peer || '').split('-').pop();
  if (!id || id === 'HOST') { conn.close(); return; }
  multiplayer.connections.set(id, conn);
  conn.on('data', data => hostData(id, data));
  conn.on('close', () => guestDisconnected(id));
  conn.on('open', () => {
    if (!multiplayer.playerOrder.includes(id)) multiplayer.playerOrder.push(id);
    multiplayer.playerCount = 1 + multiplayer.connections.size;
    conn.send({ type: 'welcome', playerId: id, hostId: multiplayer.localId, roomCode: multiplayer.roomCode,
      playerCount: multiplayer.playerCount, order: multiplayer.playerOrder.slice(),
      hostState: currentState(), digest: buildDigest() });
    broadcast({ type: 'roster', order: multiplayer.playerOrder.slice(), hostId: multiplayer.localId, playerCount: multiplayer.playerCount }, id);
    pushFeed(`PLAYER ${id} JOINED THE CITY`, 'border-l-emerald-400');
    updateHud();
  });
}
function setupHostPeer(peer, onOpen) {
  peer.on('open', onOpen);
  peer.on('connection', conn => {
    if (multiplayer.peer !== peer) { conn.close(); return; }
    attachHostConnection(conn);
  });
}
export function mpStartHost(requestedCode = '') {
  if (!window.Peer) { pushFeed('PEERJS COULD NOT LOAD', 'border-l-rose-500'); return; }
  if (isActive()) mpResetConnectionState();
  captureBaseline();
  multiplayer.roomCode = (requestedCode || roomCode()).toUpperCase();
  multiplayer.mode = 'host';
  multiplayer.localId = '1';
  multiplayer.hostId = '1';
  multiplayer.playerCount = 1;
  multiplayer.playerOrder = ['1'];
  const peer = new Peer(`gta-aura-main-${multiplayer.roomCode}-HOST`);
  multiplayer.peer = peer;
  setupHostPeer(peer, () => {
    if (multiplayer.peer !== peer) return;
    const codeEl = document.getElementById('host-room-code');
    const rowEl = document.getElementById('host-room-row');
    if (codeEl) codeEl.textContent = multiplayer.roomCode;
    if (rowEl) rowEl.className = 'flex items-center gap-2';
    updateHud();
    pushFeed(`ROOM OPEN — CODE ${multiplayer.roomCode}. PRESS ENTER CITY TO START THE SIM.`, 'border-l-amber-400');
  });
  peer.on('error', err => {
    if (err.type === 'unavailable-id') { mpResetConnectionState(); setTimeout(() => mpStartHost(), 400); }
    else pushFeed(`MULTIPLAYER ERROR: ${err.type || 'CONNECTION'}`, 'border-l-rose-500');
  });
}
function guestDisconnected(id) {
  multiplayer.connections.delete(id);
  multiplayer.playerOrder = multiplayer.playerOrder.filter(p => p !== id);
  for (const [idx, owner] of multiplayer.carOwners) if (owner === id) multiplayer.carOwners.delete(idx);
  if (multiplayer.remoteJet?.owner === id) { multiplayer.remoteJet = null; multiplayer.remoteJetBuf = null; }
  const remote = multiplayer.remotePlayers.get(id);
  if (remote?.rig) { scene.remove(remote.rig); freeGeo(remote.rig); }
  if (remote?.tag) scene.remove(remote.tag);
  multiplayer.remotePlayers.delete(id);
  multiplayer.playerCount = 1 + multiplayer.connections.size;
  broadcast({ type: 'roster', order: multiplayer.playerOrder.slice(), hostId: multiplayer.localId, playerCount: multiplayer.playerCount });
  broadcastLocks();
  pushFeed(`PLAYER ${id} LEFT THE CITY`, 'border-l-slate-400');
  updateHud();
}
function hostData(id, data) {
  if (!data || typeof data !== 'object') return;
  switch (data.type) {
    case 'hello':
      multiplayer.connections.get(id)?.send({ type: 'welcome', playerId: id, hostId: multiplayer.localId, roomCode: multiplayer.roomCode,
        playerCount: multiplayer.playerCount, order: multiplayer.playerOrder.slice(), hostState: currentState(), digest: buildDigest() });
      break;
    case 'rejoin': {
      if (Array.isArray(data.order)) {
        for (const pid of data.order) if (!multiplayer.playerOrder.includes(pid)) multiplayer.playerOrder.push(pid);
      }
      if (!multiplayer.playerOrder.includes(multiplayer.localId)) multiplayer.playerOrder.unshift(multiplayer.localId);
      if (data.carIdx >= 0 && !multiplayer.carOwners.has(data.carIdx)) multiplayer.carOwners.set(data.carIdx, id);
      if (data.s) feedRemoteState(id, data.s);
      multiplayer.playerCount = 1 + multiplayer.connections.size;
      multiplayer.connections.get(id)?.send({ type: 'welcome', playerId: id, hostId: multiplayer.localId, roomCode: multiplayer.roomCode,
        playerCount: multiplayer.playerCount, order: multiplayer.playerOrder.slice(), hostState: currentState(), digest: buildDigest() });
      broadcast({ type: 'roster', order: multiplayer.playerOrder.slice(), hostId: multiplayer.localId, playerCount: multiplayer.playerCount }, id);
      broadcastLocks();
      updateHud();
      break;
    }
    case 'pstate':
      feedRemoteState(id, data.s);
      broadcast({ type: 'pstate', id, s: data.s }, id);
      break;
    case 'car_req': {
      const idx = Number(data.idx);
      const owner = multiplayer.carOwners.get(idx);
      if (!owner) {
        multiplayer.carOwners.set(idx, id);
        const v = vehicles[idx];
        if (v && v.isTraffic) {
          v.isTraffic = false;
          hooks.onVehicleEnter(v);
          broadcast({ type: 'wevt', ev: { t: 'driver_eject', idx, by: id } });
          multiplayer.worldVersion++;
        }
        multiplayer.connections.get(id)?.send({ type: 'car_grant', idx });
        broadcastLocks();
      } else multiplayer.connections.get(id)?.send({ type: 'car_deny', idx });
      break;
    }
    case 'car_exit':
      if (multiplayer.carOwners.get(Number(data.idx)) === id) { multiplayer.carOwners.delete(Number(data.idx)); broadcastLocks(); }
      break;
    case 'car_xform': {
      const v = vehicles[Number(data.idx)];
      if (v && multiplayer.carOwners.get(Number(data.idx)) === id) {
        Object.assign(v, data.transform);
        v.root.position.set(v.x, v.y, v.z);
        v.root.rotation.y = v.yaw;
      }
      break;
    }
    case 'hit_req': {
      const targetId = String(data.targetId);
      if (targetId === multiplayer.localId || multiplayer.connections.has(targetId)) {
        hitCooldown.delete(targetId);
        mpHitPlayer(targetId, Number(data.a) || 0, String(data.source || 'REMOTE PLAYER'));
      }
      break;
    }
    case 'digest_req':
      multiplayer.connections.get(id)?.send({ type: 'digest', digest: buildDigest() });
      break;
    case 'wevt':
      if (data.ev) hostReceiveEvent(id, data.ev);
      break;
    case 'bye':
      try { multiplayer.connections.get(id)?.close(); } catch (_) {}
      guestDisconnected(id);
      break;
  }
}
export function mpStartGuest(code) {
  if (!window.Peer) { pushFeed('PEERJS COULD NOT LOAD', 'border-l-rose-500'); return; }
  const roomCodeValue = String(code).trim().toUpperCase();
  if (!/^[A-Z2-9]{4}$/.test(roomCodeValue)) { pushFeed('ENTER A 4-CHARACTER ROOM CODE', 'border-l-rose-500'); return; }
  if (isActive()) mpResetConnectionState();
  captureBaseline();
  multiplayer.roomCode = roomCodeValue;
  multiplayer.mode = 'guest';
  const id = `G${Math.floor(Math.random() * 8999 + 1000)}${Math.floor(Math.random() * 10)}`;
  multiplayer.localId = id;
  multiplayer.hostId = '1';
  multiplayer.playerCount = 2;
  const peer = new Peer(`gta-aura-main-${roomCodeValue}-${id}`);
  multiplayer.peer = peer;
  peer.on('open', () => connectToHost(peer, 0));
  peer.on('error', err => {
    if (multiplayer.migrating) return;
    mpResetConnectionState();
    pushFeed(`COULD NOT JOIN ROOM: ${err.type || 'CONNECTION'}`, 'border-l-rose-500');
  });
}
function connectToHost(peer, attempt) {
  if (multiplayer.peer !== peer) return;
  const conn = peer.connect(`gta-aura-main-${multiplayer.roomCode}-HOST`, { reliable: true });
  multiplayer.hostConnection = conn;
  let opened = false;
  const timer = setTimeout(() => {
    if (!opened) {
      try { conn.close(); } catch (_) {}
      if (attempt < 12 && multiplayer.peer === peer) setTimeout(() => connectToHost(peer, attempt + 1), 1200);
      else if (multiplayer.migrating) { pushFeed('MIGRATION FAILED — ROOM CLOSED', 'border-l-rose-500'); mpResetConnectionState(); }
    }
  }, 2600);
  conn.on('open', () => {
    opened = true;
    clearTimeout(timer);
    multiplayer.migrating = false;
    if (attempt === 0 && multiplayer.playerOrder.length <= 1) conn.send({ type: 'hello', id: multiplayer.localId });
    else conn.send({ type: 'rejoin', id: multiplayer.localId, order: multiplayer.playerOrder.slice(), s: currentState(), carIdx: gameState.inCar ? gameState.activeCarIndex : -1 });
    updateHud();
  });
  conn.on('data', guestData);
  conn.on('close', () => {
    clearTimeout(timer);
    if (multiplayer.mode === 'guest' && !multiplayer.migrating && multiplayer.hostConnection === conn) handleHostLost();
  });
}
function guestData(data) {
  if (!data || typeof data !== 'object') return;
  switch (data.type) {
    case 'welcome':
      multiplayer.localId = data.playerId || multiplayer.localId;
      multiplayer.hostId = data.hostId || '1';
      multiplayer.playerCount = Number(data.playerCount) || 2;
      if (Array.isArray(data.order)) multiplayer.playerOrder = data.order;
      if (data.hostState) feedRemoteState(multiplayer.hostId, data.hostState);
      applyDigest(data.digest);
      pushFeed('SYNCED WITH HOST — SAME CITY, SAME TIME', 'border-l-emerald-400');
      updateHud();
      break;
    case 'roster':
      if (Array.isArray(data.order)) multiplayer.playerOrder = data.order;
      multiplayer.hostId = data.hostId || multiplayer.hostId;
      multiplayer.playerCount = Number(data.playerCount) || multiplayer.playerCount;
      for (const [id, r] of multiplayer.remotePlayers) {
        if (!multiplayer.playerOrder.includes(id)) {
          if (r.rig) { scene.remove(r.rig); freeGeo(r.rig); }
          if (r.tag) scene.remove(r.tag);
          multiplayer.remotePlayers.delete(id);
        }
      }
      updateHud();
      break;
    case 'pstate':
      feedRemoteState(data.id, data.s);
      break;
    case 'wstream':
      applyWorldStream(data);
      break;
    case 'wevt':
      if (data.ev) applyWorldEvent(data.ev);
      break;
    case 'digest':
      applyDigest(data.digest);
      break;
    case 'hit':
      hooks.applyPlayerDamage(Number(data.amount) || 0, String(data.source || 'REMOTE'));
      break;
    case 'award':
      gameState.cash += Number(data.cash) || 0;
      if (data.item) addLeftItemToBag(data.item, 1);
      if (data.cash) pushFeed(`+$${data.cash} (KILL CREDIT)`, 'border-l-emerald-400');
      hooks.updateHUD();
      break;
    case 'mugged':
      gameState.cash = Math.max(0, gameState.cash - (Number(data.amount) || 0));
      pushFeed(`${data.npcName || 'THUG'} MUGGED YOU: -$${data.amount}`, 'border-l-rose-500');
      hooks.updateHUD();
      break;
    case 'locks':
      multiplayer.carOwners = new Map(data.owners || []);
      break;
    case 'car_grant':
      multiplayer.grantBypass = Number(data.idx);
      enterVehicle(Number(data.idx));
      break;
    case 'car_deny':
      pushFeed('VEHICLE LOCKED BY ANOTHER PLAYER', 'border-l-rose-500');
      break;
    case 'host_bye':
      handleHostLost();
      break;
  }
}
function handleHostLost() {
  if (multiplayer.mode !== 'guest' || multiplayer.migrating) return;
  multiplayer.migrating = true;
  const oldHost = multiplayer.hostId;
  const order = multiplayer.playerOrder.filter(id => id !== oldHost);
  const next = order[0];
  try { multiplayer.peer?.destroy(); } catch (_) {}
  multiplayer.peer = null;
  multiplayer.hostConnection = null;
  const hr = multiplayer.remotePlayers.get(oldHost);
  if (hr?.rig) { scene.remove(hr.rig); freeGeo(hr.rig); }
  if (hr?.tag) scene.remove(hr.tag);
  multiplayer.remotePlayers.delete(oldHost);
  if (multiplayer.remoteJet?.owner === oldHost) { multiplayer.remoteJet = null; multiplayer.remoteJetBuf = null; hooks.mpJetApplyRemote(null); }
  if (!next) { pushFeed('HOST LEFT — LOBBY CLOSED', 'border-l-rose-500'); mpResetConnectionState(); return; }
  pushFeed(next === multiplayer.localId ? 'HOST LEFT — YOU ARE THE NEW HOST' : `HOST LEFT — MIGRATING TO ${next}`, 'border-l-amber-400');
  if (next === multiplayer.localId) becomeHost(order);
  else {
    multiplayer.hostId = next;
    multiplayer.playerOrder = order;
    const peer = new Peer(`gta-aura-main-${multiplayer.roomCode}-${multiplayer.localId}`);
    multiplayer.peer = peer;
    peer.on('open', () => setTimeout(() => connectToHost(peer, 0), 900));
    peer.on('error', () => { if (multiplayer.migrating) setTimeout(() => { if (multiplayer.peer === peer) connectToHost(peer, 0); }, 1500); });
  }
}
function becomeHost(order) {
  multiplayer.mode = 'host';
  multiplayer.hostId = multiplayer.localId;
  multiplayer.playerOrder = order.slice();
  multiplayer.connections.clear();
  if (gameState.inCar) multiplayer.carOwners.set(gameState.activeCarIndex, multiplayer.localId);
  for (const rc of remoteCops.values()) { worldRoot.remove(rc.mesh); freeGeo(rc.mesh); }
  remoteCops.clear();
  for (const rc of remotePcars.values()) { worldRoot.remove(rc.mesh); rc.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
  remotePcars.clear();
  hooks.mpAdoptTraffic();
  multiplayer.worldVersion++;
  const tryHost = (attempt) => {
    if (multiplayer.mode !== 'host') return;
    const peer = new Peer(`gta-aura-main-${multiplayer.roomCode}-HOST`);
    multiplayer.peer = peer;
    setupHostPeer(peer, () => {
      if (multiplayer.peer !== peer) return;
      multiplayer.migrating = false;
      multiplayer.playerCount = 1 + multiplayer.connections.size;
      broadcast({ type: 'roster', order: multiplayer.playerOrder.slice(), hostId: multiplayer.localId, playerCount: multiplayer.playerCount });
      broadcastLocks();
      pushFeed(`YOU ARE NOW THE HOST — ROOM ${multiplayer.roomCode} LIVES ON`, 'border-l-emerald-400');
      updateHud();
    });
    peer.on('error', err => {
      if (err.type === 'unavailable-id' && attempt < 12) {
        try { peer.destroy(); } catch (_) {}
        setTimeout(() => tryHost(attempt + 1), 900);
      } else if (attempt >= 12) {
        pushFeed('MIGRATION FAILED — GOING OFFLINE', 'border-l-rose-500');
        mpResetConnectionState();
      }
    });
  };
  tryHost(0);
}
function mpShutdown() {
  if (!isActive()) return;
  if (isHost()) {
    broadcast({ type: 'host_bye' });
    setTimeout(() => mpResetConnectionState(), 150);
  } else {
    sendHost({ type: 'bye' });
    setTimeout(() => mpResetConnectionState(), 100);
  }
}
export function sendMultiplayerState(now) {
  if (!isActive()) return;
  if (isHost()) {
    if (now - multiplayer.lastPlayerSend > PLAYER_MS) {
      multiplayer.lastPlayerSend = now;
      broadcast({ type: 'pstate', id: multiplayer.localId, s: currentState() });
    }
    if (now - multiplayer.lastWorldSend > STREAM_MS && gameState.screen === 'playing') {
      multiplayer.lastWorldSend = now;
      broadcast(buildWorldStream());
    }
  } else if (multiplayer.hostConnection?.open) {
    if (now - multiplayer.lastPlayerSend > PLAYER_MS) {
      multiplayer.lastPlayerSend = now;
      sendHost({ type: 'pstate', s: currentState() });
    }
    if (gameState.inCar && now - multiplayer.lastVehicleSend > CAR_MS) {
      multiplayer.lastVehicleSend = now;
      const v = vehicles[gameState.activeCarIndex];
      if (v) sendHost({ type: 'car_xform', idx: gameState.activeCarIndex,
        transform: { x: r2(v.x), y: r2(v.y), z: r2(v.z), yaw: r3(v.yaw), speed: r2(v.speed), steerAngle: r3(v.steerAngle), gearIndex: v.gearIndex, rpm: Math.round(v.rpm) } });
    }
  }
}
function mpDrawMap(ctx, X, Y) {
  if (!isActive()) return;
  for (const [id, r] of multiplayer.remotePlayers) {
    if (r.x === undefined) continue;
    ctx.fillStyle = id === multiplayer.hostId ? '#f59e0b' : '#a855f7';
    ctx.beginPath();
    ctx.arc(X(r.x), Y(r.z), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}
export function initMultiplayer() {
  const hostBtn = document.getElementById('btn-host-multiplayer');
  const joinBtn = document.getElementById('btn-join-multiplayer');
  const copyBtn = document.getElementById('btn-copy-room');
  hostBtn?.addEventListener('click', () => mpStartHost());
  joinBtn?.addEventListener('click', () => mpStartGuest(document.getElementById('join-room-code')?.value || ''));
  copyBtn?.addEventListener('click', () => {
    const code = document.getElementById('host-room-code')?.textContent || '';
    if (code) navigator.clipboard?.writeText(code).catch(() => {});
  });
  updateHud();
}
Object.assign(hooks, {
  mpActive: isActive,
  mpIsHost: isHost,
  mpIsGuest: isGuest,
  mpLocalId: () => multiplayer.localId,
  mpTargets,
  mpHitPlayer,
  mpVehicleImpact,
  mpAward,
  mpWorldEvent,
  mpCarEnter,
  mpCarExit,
  mpCarLocked,
  mpCarOwner,
  mpNpcLoot,
  mpGuestNpcFrame: guestNpcFrame,
  mpGuestCopFrame: guestCopFrame,
  mpGuestRatFrame: guestRatFrame,
  mpMeleeCop,
  mpMeleeRat,
  mpJetLocked,
  mpJetRenderRemote,
  mpDrawMap,
  mpShutdown,
});
window.__mp = multiplayer;