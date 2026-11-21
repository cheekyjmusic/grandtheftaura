// PeerJS multiplayer lobby and synchronized player/NPC/vehicle state.
import { gameState, hooks, keys, npcs, player, pushFeed } from './state.js';
import { scene } from './engine.js';
import { vehicles } from './vehicles.js';
import { buildPlayerRigMesh } from './player.js';

export const multiplayer = {
  mode: 'single', peer: null, hostConnection: null, connections: new Map(),
  remotePlayers: new Map(), roomCode: '', localId: '1', playerCount: 1,
  playerOrder: ['1'], carOwners: new Map(), npcSnapshot: [],
  lastPlayerSend: 0, lastNpcSend: 0, lastVehicleSend: 0
};

function roomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function updateHud() {
  const pill = document.getElementById('multiplayer-hud');
  if (!pill) return;
  if (multiplayer.mode === 'single') { pill.classList.add('hidden'); return; }
  pill.classList.remove('hidden');
  document.getElementById('mp-room-label').textContent = multiplayer.roomCode;
  document.getElementById('mp-player-count').textContent =
	`${multiplayer.playerCount} PLAYER${multiplayer.playerCount === 1 ? '' : 'S'}`;
}

export function mpResetConnectionState() {
  try { multiplayer.peer?.destroy(); } catch (_) {}
  multiplayer.peer = null;
  multiplayer.mode = 'single';
  multiplayer.hostConnection = null;
  multiplayer.connections.clear();
  multiplayer.carOwners.clear();
  multiplayer.npcSnapshot = [];
  multiplayer.playerCount = 1;
  multiplayer.roomCode = '';
  multiplayer.localId = '1';
  for (const remote of multiplayer.remotePlayers.values()) {
	if (remote.rig) scene.remove(remote.rig);
  }
  multiplayer.remotePlayers.clear();
  updateHud();
}

function ensureRemoteRig(id) {
  let remote = multiplayer.remotePlayers.get(id);
  if (!remote) { remote = { x: 0, y: 0.18, z: 0, yaw: 0, targetTime: 0 }; multiplayer.remotePlayers.set(id, remote); }
  if (!remote.rig) {
	const rig = buildPlayerRigMesh({ bodyColor: '#64748b', accentColor: '#1e293b' }).tpRig;
	rig.visible = true;
	scene.add(rig);
	remote.rig = rig;
  }
  return remote;
}

function npcSnapshot(full = false) {
  return npcs.map(n => ({
	id: n.id, x: n.x, z: n.z, yaw: n.yaw, hp: n.hp, maxHp: n.maxHp,
	asleep: !!n.asleep, hostile: !!n.hostile, alertState: n.alertState,
	...(full ? { name: n.name, line: n.line, role: n.role, aggro: n.aggro, clanId: n.clanId,
	  homeX: n.homeX, homeZ: n.homeZ, shirt: n.shirt, pants: n.pants, bandana: n.bandana,
	  age: n.age, skin: n.skin, hair: n.hair } : {})
  }));
}

function applyNpcSnapshots(list) {
  if (!Array.isArray(list)) return;
  for (const snap of list) {
	const npc = npcs[Number(snap.id)];
	if (!npc) continue;
	npc.x = snap.x ?? npc.x;
	npc.z = snap.z ?? npc.z;
	npc.yaw = snap.yaw ?? npc.yaw;
	if (snap.hp !== undefined) npc.hp = snap.hp;
	if (snap.asleep !== undefined) npc.asleep = snap.asleep;
	if (snap.hostile !== undefined) npc.hostile = snap.hostile;
  }
}

function currentState() {
  const moving = !!(keys.KeyW || keys.KeyS || keys.KeyA || keys.KeyD);
  return { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch,
	crouching: player.crouching, grounded: player.grounded, moving,
	sprinting: !!(keys.ShiftLeft || keys.ShiftRight) && moving,
	weapon: gameState.activeRightWeapon, attacking: player.attackTimer > 0,
	inCar: gameState.inCar, carIdx: gameState.activeCarIndex, hp: gameState.hp };
}

function broadcast(data, exceptId = null) {
  for (const [id, conn] of multiplayer.connections) {
	if (id !== exceptId && conn.open) conn.send(data);
  }
}

function worldSnapshot() {
  const playerStates = [];
  for (const [id, remote] of multiplayer.remotePlayers) {
	if (remote) playerStates.push([id, { x: remote.x, y: remote.y, z: remote.z, yaw: remote.yaw,
	  pitch: remote.pitch, inCar: remote.inCar, carIdx: remote.carIdx, weapon: remote.weapon }]);
  }
  return { roomCode: multiplayer.roomCode, playerCount: multiplayer.playerCount,
	playerOrder: multiplayer.playerOrder.slice(), hostState: currentState(), playerStates,
	npcs: npcSnapshot(true), carOwners: Array.from(multiplayer.carOwners.entries()),
	carSnapshots: vehicles.map((v, carIdx) => ({ carIdx, x: v.x, y: v.y, z: v.z, yaw: v.yaw, speed: v.speed })) };
}

export function mpStartHost(requestedCode = '') {
  if (!window.Peer) { pushFeed('PEERJS COULD NOT LOAD', 'border-l-rose-500'); return; }
  if (multiplayer.mode !== 'single') mpResetConnectionState();
  multiplayer.roomCode = (requestedCode || roomCode()).toUpperCase();
  multiplayer.mode = 'host';
  multiplayer.localId = '1';
  multiplayer.playerCount = 1;
  multiplayer.playerOrder = ['1'];
  multiplayer.peer = new Peer(`gta-aura-main-${multiplayer.roomCode}-HOST`);
  const hostPeer = multiplayer.peer;
  hostPeer.on('open', () => {
	if (multiplayer.peer !== hostPeer) return;
	const codeEl = document.getElementById('host-room-code');
	const rowEl = document.getElementById('host-room-row');
	if (codeEl) codeEl.textContent = multiplayer.roomCode;
	if (rowEl) rowEl.className = 'flex items-center gap-2';
	updateHud();
	pushFeed(`ROOM OPEN - CODE ${multiplayer.roomCode}`, 'border-l-amber-400');
  });
  hostPeer.on('connection', conn => {
	if (multiplayer.peer !== hostPeer) { conn.close(); return; }
	const id = String(conn.peer || '').split('-').pop();
	if (!id) { conn.close(); return; }
	multiplayer.connections.set(id, conn);
	conn.on('open', () => {
	  if (!multiplayer.playerOrder.includes(id)) multiplayer.playerOrder.push(id);
	  multiplayer.playerCount = 1 + multiplayer.connections.size;
	  conn.send({ type: 'world_welcome', ...worldSnapshot(), playerId: id, playerCount: multiplayer.playerCount, hostId: '1' });
	  broadcast({ type: 'player_join', playerId: id, playerCount: multiplayer.playerCount, playerOrder: multiplayer.playerOrder.slice() }, id);
	  updateHud();
	});
	conn.on('data', data => hostData(id, data));
	conn.on('close', () => guestDisconnected(id));
  });
  hostPeer.on('error', err => {
	if (err.type === 'unavailable-id') { mpResetConnectionState(); setTimeout(() => mpStartHost(), 400); }
	else pushFeed(`MULTIPLAYER ERROR: ${err.type || 'CONNECTION'}`, 'border-l-rose-500');
  });
}

function guestDisconnected(id) {
  multiplayer.connections.delete(id);
  multiplayer.playerOrder = multiplayer.playerOrder.filter(p => p !== id);
  for (const [idx, owner] of multiplayer.carOwners) if (owner === id) multiplayer.carOwners.delete(idx);
  const remote = multiplayer.remotePlayers.get(id);
  if (remote?.rig) scene.remove(remote.rig);
  multiplayer.remotePlayers.delete(id);
  multiplayer.playerCount = 1 + multiplayer.connections.size;
  broadcast({ type: 'player_leave', playerId: id, playerCount: multiplayer.playerCount, playerOrder: multiplayer.playerOrder.slice() });
  updateHud();
}

function hostData(id, data) {
  if (!data || typeof data !== 'object') return;
  if (data.type === 'guest_ready') {
	multiplayer.connections.get(id)?.send({ type: 'world_welcome', ...worldSnapshot(), playerId: id, playerCount: multiplayer.playerCount });
  } else if (data.type === 'player_state') {
	const remote = ensureRemoteRig(id);
	Object.assign(remote, data.state || {}, { targetTime: performance.now() });
	broadcast({ type: 'player_state_relay', playerId: id, state: data.state }, id);
  } else if (data.type === 'npc_damage') {
	hooks.damageNpc(npcs[Number(data.npcId)], Number(data.amount) || 0, Number(data.knockYaw) || 0);
  } else if (data.type === 'car_enter') {
	const idx = Number(data.carIdx);
	if (!multiplayer.carOwners.has(idx)) {
	  multiplayer.carOwners.set(idx, id);
	  multiplayer.connections.get(id)?.send({ type: 'car_enter_granted', carIdx: idx });
	  broadcast({ type: 'car_locks', carOwners: Array.from(multiplayer.carOwners.entries()) });
	} else multiplayer.connections.get(id)?.send({ type: 'car_enter_denied', carIdx: idx });
  } else if (data.type === 'car_exit') {
	if (multiplayer.carOwners.get(Number(data.carIdx)) === id) multiplayer.carOwners.delete(Number(data.carIdx));
  } else if (data.type === 'car_transform') {
	broadcast({ type: 'car_transform', carIdx: data.carIdx, transform: data.transform }, id);
  } else if (data.type === 'hit_player') {
	if (data.targetId === '1') hooks.applyPlayerDamage(Number(data.amount) || 0, String(data.source || 'REMOTE PLAYER'));
  }
}

export function mpStartGuest(code) {
  if (!window.Peer) { pushFeed('PEERJS COULD NOT LOAD', 'border-l-rose-500'); return; }
  const roomCodeValue = String(code).trim().toUpperCase();
  if (!/^[A-Z2-9]{4}$/.test(roomCodeValue)) { pushFeed('ENTER A 4-CHARACTER ROOM CODE', 'border-l-rose-500'); return; }
  if (multiplayer.mode !== 'single') mpResetConnectionState();
  multiplayer.roomCode = roomCodeValue;
  multiplayer.mode = 'guest';
  const id = `G${Math.floor(Math.random() * 8999 + 1000)}${Math.floor(Math.random() * 10)}`;
  multiplayer.localId = id;
  multiplayer.playerCount = 2;
  multiplayer.peer = new Peer(`gta-aura-main-${roomCodeValue}-${id}`);
  const guestPeer = multiplayer.peer;
  guestPeer.on('open', () => {
	const conn = guestPeer.connect(`gta-aura-main-${roomCodeValue}-HOST`, { reliable: true });
	multiplayer.hostConnection = conn;
	conn.on('open', () => { conn.send({ type: 'guest_ready' }); updateHud(); });
	conn.on('data', guestData);
	conn.on('close', () => { if (multiplayer.mode === 'guest') mpResetConnectionState(); });
  });
  guestPeer.on('error', err => { mpResetConnectionState(); pushFeed(`COULD NOT JOIN ROOM: ${err.type || 'CONNECTION'}`, 'border-l-rose-500'); });
}

function guestData(data) {
  if (!data || typeof data !== 'object') return;
  if (data.type === 'world_welcome') {
	multiplayer.localId = data.playerId;
	multiplayer.playerCount = Number(data.playerCount) || 2;
	multiplayer.playerOrder = Array.isArray(data.playerOrder) ? data.playerOrder : multiplayer.playerOrder;
	applyNpcSnapshots(data.npcs);
	multiplayer.npcSnapshot = data.npcs || [];
	multiplayer.carOwners = new Map(data.carOwners || []);
	for (const car of data.carSnapshots || []) {
	  const v = vehicles[Number(car.carIdx)];
	  if (v) { v.x = car.x; v.y = car.y; v.z = car.z; v.yaw = car.yaw; v.speed = car.speed || 0; v.root.position.set(v.x, v.y, v.z); v.root.rotation.y = v.yaw; }
	}
	if (data.hostState) { const remote = ensureRemoteRig('1'); Object.assign(remote, data.hostState); }
	for (const entry of data.playerStates || []) {
	  if (!Array.isArray(entry) || entry[0] === multiplayer.localId) continue;
	  Object.assign(ensureRemoteRig(entry[0]), entry[1] || {});
	}
	updateHud();
  } else if (data.type === 'player_join') {
	multiplayer.playerCount = Number(data.playerCount) || multiplayer.playerCount;
	if (Array.isArray(data.playerOrder)) multiplayer.playerOrder = data.playerOrder;
	updateHud();
  } else if (data.type === 'player_leave') {
	const remote = multiplayer.remotePlayers.get(data.playerId);
	if (remote?.rig) scene.remove(remote.rig);
	multiplayer.remotePlayers.delete(data.playerId);
	multiplayer.playerCount = Number(data.playerCount) || Math.max(1, multiplayer.playerCount - 1);
	updateHud();
  } else if (data.type === 'player_state_relay') {
	Object.assign(ensureRemoteRig(data.playerId), data.state || {}, { targetTime: performance.now() });
  } else if (data.type === 'npc_snapshot') {
	multiplayer.npcSnapshot = data.npcs || [];
	applyNpcSnapshots(multiplayer.npcSnapshot);
  } else if (data.type === 'car_locks') multiplayer.carOwners = new Map(data.carOwners || []);
  else if (data.type === 'car_enter_granted') {
	import('./vehicles.js').then(({ enterVehicle }) => enterVehicle(Number(data.carIdx)));
  } else if (data.type === 'car_enter_denied') pushFeed('VEHICLE LOCKED BY ANOTHER PLAYER', 'border-l-rose-500');
  else if (data.type === 'car_transform') {
	const v = vehicles[Number(data.carIdx)];
	if (v && data.transform) Object.assign(v, data.transform);
  } else if (data.type === 'hit_player') hooks.applyPlayerDamage(Number(data.amount) || 0, String(data.source || 'REMOTE PLAYER'));
}

export function sendMultiplayerState(now) {
  if (multiplayer.mode === 'host') {
	if (now - multiplayer.lastNpcSend > 250) { multiplayer.lastNpcSend = now; broadcast({ type: 'npc_snapshot', npcs: npcSnapshot(false) }); }
  } else if (multiplayer.mode === 'guest' && multiplayer.hostConnection?.open) {
	if (now - multiplayer.lastPlayerSend > 50) {
	  multiplayer.lastPlayerSend = now;
	  multiplayer.hostConnection.send({ type: 'player_state', state: currentState() });
	}
  }
}

export function updateRemotePlayers(dt) {
  for (const [id, remote] of multiplayer.remotePlayers) {
	if (!remote.rig) continue;
	const rig = remote.rig;
	rig.position.set(remote.x || rig.position.x, remote.y || 0.18, remote.z || rig.position.z);
	rig.rotation.y = remote.yaw || 0;
	rig.visible = multiplayer.mode !== 'single';
	if (remote.moving) {
	  const a = performance.now() * 0.012;
	  for (const key of ['tpLegL', 'tpLegR']) {
		if (rig[key]) rig[key].rotation.x = Math.sin(a) * 0.55;
	  }
	}
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
