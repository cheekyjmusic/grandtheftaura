
import * as THREE from 'three';
import { colorToHex, levelData } from './levelData.js';
import {
  AO, SFY, WORLD_BOUNDS, climb, collidesHorizontally, computeSupportFloor, crime, flashEdge,
  gameState, hooks, keys, meteorDrop, npcs, player, projectileWieners, pushFeed, rnd,
  sewerOK, stars, terrainH, under, worldBoxes
} from './state.js';
import { camera, makeMat, makeSharedMat, scene, worldRoot } from './engine.js';
import { applyModelPreset } from './assets.js';
import { sfx } from './audio.js';
import { RIGHT_WEAPONS, addLeftItemToBag, freeGeo, spawnParticles } from './items.js';
import { buildSportsCar, enterVehicle, vehicles } from './vehicles.js';

const _boxGeoCache = new Map();
function sharedBoxGeo(sx, sy, sz) {
  const key = `${sx.toFixed(3)}|${sy.toFixed(3)}|${sz.toFixed(3)}`;
  let g = _boxGeoCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(sx, sy, sz);
    g.userData.shared = true;
    _boxGeoCache.set(key, g);
  }
  return g;
}
const _stdCache = new Map();
function cachedStd(hex, opts) {
  const key = `${hex}|${opts ? JSON.stringify(opts) : ''}`;
  let m = _stdCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial(Object.assign({ color: hex }, opts || {}));
    m.userData.shared = true;
    _stdCache.set(key, m);
  }
  return m;
}
const _basicCache = new Map();
function cachedBasic(hex, opts) {
  const key = `${hex}|${opts ? JSON.stringify(opts) : ''}`;
  let m = _basicCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial(Object.assign({ color: hex }, opts || {}));
    m.userData.shared = true;
    _basicCache.set(key, m);
  }
  return m;
}
const _makeMatCache = new Map();
function cachedMakeMat(hex, opts) {
  const key = `${hex}|${opts ? JSON.stringify(opts) : ''}`;
  let m = _makeMatCache.get(key);
  if (!m) {
    m = makeMat(hex, opts);
    m.userData.shared = true;
    _makeMatCache.set(key, m);
  }
  return m;
}
function hash01(n) {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}
function hashPick(arr, id, salt) {
  return arr[Math.floor(hash01(id * 7.13 + salt * 31.7) * arr.length) % arr.length];
}
function boxMesh(sx, sy, sz, mat) {
  return new THREE.Mesh(sharedBoxGeo(sx, sy, sz), mat);
}

export const CLAN_DEFS = {
  neon_vipers: {
    id: 'neon_vipers',
    name: 'NEON VIPERS',
    hex: '#a855f7',
    shirt: 0x7e22ce,
    pants: 0x0f172a,
    bandana: 0x38bdf8,
    inTurf: (x, z) => x >= -126 && x <= 126 && z <= -74 && z >= -176
  },
  redrock_scorpions: {
    id: 'redrock_scorpions',
    name: 'REDROCK SCORPIONS',
    hex: '#ef4444',
    shirt: 0xb91c1c,
    pants: 0x18181b,
    bandana: 0xfacc15,
    inTurf: (x, z) => (x >= 22 && x <= 126 && z >= 22 && z <= 78) || (x >= 175 && z >= -120 && z <= 210)
  },
  iron_jackals: {
    id: 'iron_jackals',
    name: 'IRON JACKALS',
    hex: '#f59e0b',
    shirt: 0xd97706,
    pants: 0x1e293b,
    bandana: 0xf8fafc,
    inTurf: (x, z) => (x >= -126 && x <= -64 && z >= -72 && z <= 18) || (x >= 24 && x <= 126 && z >= -72 && z <= -22)
  },
  harbor_syndicate: {
    id: 'harbor_syndicate',
    name: 'HARBOR SYNDICATE',
    hex: '#0ea5e9',
    shirt: 0x0f766e,
    pants: 0x0b1220,
    bandana: 0xfacc15,
    inTurf: (x, z) =>
      (x >= -120 && x <= 132 && z >= 460 && z <= 668) ||
      (x >= -228 && x <= -138 && z >= 452 && z <= 676)
  }
};

export const NPC_ROSTER = [
  { name: 'DEALER VANCE', role: 'stationary', aggro: 'fighter', x: -5.6, z: -53.6, yaw: 0, shirt: 0x0284c7, pants: 0x0f172a, line: '"Take the Aura Apex GT Supercar out for a spin! Downshift [K] to spit exhaust flames!"' },
  { name: 'HOTDOG VENDOR', role: 'stationary', aggro: 'fighter', x: -39.9, z: -41.1, yaw: 0, shirt: 0xdc2626, pants: 0xf8fafc, line: '"Grab the Ballistic Hotdog Shooter in the back! Refill sausages at the vat or Plaza Cart!"' },
  { name: 'BANK TELLER MARCUS', role: 'stationary', aggro: 'passive', x: -1.8, z: -98.3, yaw: 0, shirt: 0x1e3a8a, pants: 0x0f172a, line: '"Welcome to Sunnyvale Reserve Bank. Our vault is open for inspection."' },
  { name: 'BANK GUARD REYES', role: 'stationary', aggro: 'fighter', x: 3.1, z: -92.5, yaw: -0.35, shirt: 0x0284c7, pants: 0x1e293b, line: '"Keep it peaceful inside the Reserve Bank, citizen."' },
  { name: 'OUTPOST ATTENDANT', role: 'stationary', aggro: 'fighter', x: 254.0, z: 81.5, yaw: 0, shirt: 0xd97706, pants: 0x1e293b, line: '"Watch out for the Redrock Scorpions around the desert outpost!"' },
  { name: 'PLAZA JOGGER MAYA', role: 'patrol', aggro: 'passive', x: -8.0, z: 10.0, yaw: 1.57, shirt: 0x10b981, pants: 0x1e293b, line: '"Central Plaza is a neutral safe zone—and there is a hotdog cart right across the fountain!"' },
  { name: 'DOCKWORKER HANK', role: 'patrol', aggro: 'fighter', x: 33.0, z: 34.0, yaw: 0, shirt: 0x0d9488, pants: 0x1e3a8a, line: '"Careful in the Harbor Yard—the Redrock Scorpions guard those containers!"' },
  { name: 'NEIGHBOR SAM', role: 'patrol', aggro: 'passive', x: -12.0, z: 35.0, yaw: -1.57, shirt: 0x7c3aed, pants: 0x1e293b, line: '"Crouching [C] keeps you low-profile and catches your breath three times faster."' },
  { name: 'COURIER LEO', role: 'patrol', aggro: 'fighter', x: -64.0, z: 16.5, yaw: 1.57, shirt: 0x2563eb, pants: 0x0f172a, line: '"Downtown is Neon Vipers turf—they hunt anyone trespassing on their blocks!"' },
  { name: 'VIPER LOOKOUT JAX', role: 'clan', clanId: 'neon_vipers', x: -42.0, z: -86.0, yaw: 0, line: '"NEON VIPER: Who let you into Downtown?! Get him!"' },
  { name: 'VIPER ENFORCER KIRA', role: 'clan', clanId: 'neon_vipers', x: 38.0, z: -88.0, yaw: Math.PI, line: '"NEON VIPER: Spotter confirmed—swarm the intruder!"' },
  { name: 'VIPER RUNNER ZED', role: 'clan', clanId: 'neon_vipers', x: -16.0, z: -122.0, yaw: 1.57, line: '"NEON VIPER: Nobody walks through Viper territory uninvited!"' },
  { name: 'VIPER CAPTAIN NYX', role: 'clan', clanId: 'neon_vipers', x: 46.0, z: -128.0, yaw: -1.57, line: '"NEON VIPER: Lock down the block! Corner them!"' },
  { name: 'SCORPION GUARD ROCCO', role: 'clan', clanId: 'redrock_scorpions', x: 40.0, z: 40.0, yaw: -1.57, line: '"SCORPION: This harbor yard belongs to the Redrock Scorpions!"' },
  { name: 'SCORPION BRAWLER TAZ', role: 'clan', clanId: 'redrock_scorpions', x: 52.0, z: 52.0, yaw: 3.14, line: '"SCORPION: Intruder spotted by the containers! Beat him down!"' },
  { name: 'SCORPION RAIDER VEX', role: 'clan', clanId: 'redrock_scorpions', x: 246.0, z: 86.0, yaw: -1.57, line: '"SCORPION: You wandered into Redrock desert turf!"' },
  { name: 'SCORPION SCOUT DRAKE', role: 'clan', clanId: 'redrock_scorpions', x: 274.0, z: 96.0, yaw: 0, line: '"SCORPION: Sound the alarm—outsider on Route 66!"' },
  { name: 'JACKAL PATROL COLE', role: 'clan', clanId: 'iron_jackals', x: -84.0, z: -42.0, yaw: 1.57, line: '"IRON JACKAL: Wrong neighborhood, pal! Get him!"' },
  { name: 'JACKAL BRUISER GRIT', role: 'clan', clanId: 'iron_jackals', x: -88.0, z: -10.0, yaw: 0, line: '"IRON JACKAL: Eyes sharp—someone is sneaking through Westside!"' },
  { name: 'JACKAL SENTRY FANG', role: 'clan', clanId: 'iron_jackals', x: 42.0, z: -38.0, yaw: -1.57, line: '"IRON JACKAL: Brickwood is Jackal territory! Take him out!"' }
];

export function buildNpcMeshLegacy(shirtColor, pantsColor, bandanaColor = null) {
  const root = new THREE.Group();
  const hip = new THREE.Group();
  hip.position.y = 0.90;
  root.add(hip);
  const torso = boxMesh(0.44, 0.54, 0.22, makeSharedMat(shirtColor));
  torso.position.y = 0.27;
  torso.castShadow = true;
  const head = boxMesh(0.24, 0.26, 0.24, makeSharedMat(0xd99b72));
  head.position.y = 0.68;
  head.castShadow = true;
  const hair = boxMesh(0.26, 0.09, 0.26, makeSharedMat(0x1c1917));
  hair.position.y = 0.80;
  if (bandanaColor !== null) {
    const band = boxMesh(0.27, 0.06, 0.27, makeSharedMat(bandanaColor));
    band.position.y = 0.75;
    hip.add(band);
  }
  const armGeo = sharedBoxGeo(0.11, 0.50, 0.11);
  const legGeo = sharedBoxGeo(0.14, 0.72, 0.14);
  const armL = new THREE.Mesh(armGeo, makeSharedMat(shirtColor));
  armL.position.set(-0.29, 0.26, 0);
  const armR = new THREE.Mesh(armGeo, makeSharedMat(shirtColor));
  armR.position.set(0.29, 0.26, 0);
  const legL = new THREE.Mesh(legGeo, makeSharedMat(pantsColor));
  legL.position.set(-0.12, -0.36, 0);
  const legR = new THREE.Mesh(legGeo, makeSharedMat(pantsColor));
  legR.position.set(0.12, -0.36, 0);
  hip.add(torso, head, hair, armL, armR, legL, legR);
  root.userData = { hip, torso, head, armL, armR, legL, legR };
  return root;
}

NPC_ROSTER.push(...makeExtraRoster());
NPC_ROSTER.push(...makeNorthernRoster());
NPC_ROSTER.push(...makeSewerRoster());

NPC_ROSTER.forEach((def, idx) => {
  const clan = def.clanId ? CLAN_DEFS[def.clanId] : null;
  npcs.push({
    id: idx,
    name: def.name,
    role: def.role,
    aggro: clan ? 'clan' : (def.aggro || 'passive'),
    clanId: def.clanId || null,
    homeX: def.x,
    homeZ: def.z,
    x: def.x,
    z: def.z,
    y: def.sewer ? SFY + 0.02 : 0.18,
    yaw: def.yaw,
    shirt: clan ? clan.shirt : def.shirt,
    pants: clan ? clan.pants : def.pants,
    bandana: clan ? clan.bandana : null,
    line: def.line,
    age: def.age || 'adult',
    skin: def.skin,
    hair: def.hair,
    sewer: !!def.sewer,
    crackhead: !!def.crackhead,
    begTimer: 2 + hash01(idx) * 4,
    snatchTimer: 0,
    wallet: 0, picked: false, pickCool: 0, fleeTimer: 0, kvx: 0, kvz: 0,
    mesh: null,
    spawned: false,
    walkCycle: Math.random() * 6,
    turnTimer: 2 + Math.random() * 4,
    stunTimer: 0,
    hostile: false,
    alertState: 'patrol',
    searchX: def.x,
    searchZ: def.z,
    searchTimer: 0,
    attackCooldown: 0,
    punchTimer: 0,
    punchSide: 0,
    hp: npcHpFor(def, clan),
    maxHp: npcHpFor(def, clan),
    asleep: false,
    sleepTimer: 0,
    sleepZGroup: null,
    isKnockedElder: false
  });
});

export function buildSleepZzzGroup() {
  const g = new THREE.Group();
  const zMat = cachedBasic(0x38bdf8);
  const z1 = boxMesh(0.18, 0.05, 0.05, zMat);
  z1.position.set(-0.14, 0, 0);
  const z2 = boxMesh(0.24, 0.06, 0.05, zMat);
  z2.position.set(0.02, 0.22, 0);
  const z3 = boxMesh(0.30, 0.07, 0.05, zMat);
  z3.position.set(0.18, 0.48, 0);
  g.add(z1, z2, z3);
  return g;
}

export function damageNpcBase(npc, amount, knockYaw) {
  if (!npc || npc.asleep) return;
  sfx.hit();
  spawnParticles(npc.x, (npc.y || 0.18) + 1.0, npc.z, 0xef4444, 6, 4);
  if (npc.age === 'elder') {
    npc.hp = 0;
    npc.asleep = true;
    npc.hostile = false;
    npc.alertState = 'patrol';
    npc.sleepTimer = 18.0;
    npc.stunTimer = 0;
    npc.isKnockedElder = true;
    pushFeed(`${npc.name} WAS KNOCKED TO THE GROUND!`, 'border-l-amber-500');
    if (!npc.picked) {
      const lt = lootFor(npc, 0.5);
      npc.picked = true;
      npc.pickCool = 90;
      if (lt > 0) {
        gameState.cash += lt;
        pushFeed(`+$${lt} DROPPED FROM ${npc.name}`, 'border-l-emerald-400');
      }
    }
    return;
  }
  npc.hp = Math.max(0, npc.hp - amount);
  npc.stunTimer = 0.45;
  const kf = Math.min(16, 5 + amount * 0.09);
  npc.kvx = (npc.kvx || 0) + Math.sin(knockYaw) * kf;
  npc.kvz = (npc.kvz || 0) + Math.cos(knockYaw) * kf;
  if (npc.hp <= 0) {
    npc.asleep = true;
    npc.hostile = false;
    npc.alertState = 'patrol';
    npc.sleepTimer = 22.0;
    npc.stunTimer = 0;
    if (npc.mesh && !npc.sleepZGroup) {
      const zzz = buildSleepZzzGroup();
      zzz.position.set(npc.x, (npc.y || 0.18) + 0.67, npc.z);
      worldRoot.add(zzz);
      npc.sleepZGroup = zzz;
    }
    if (!npc.picked) {
      const lt = lootFor(npc, 0.5);
      npc.picked = true;
      npc.pickCool = 90;
      if (lt > 0) {
        gameState.cash += lt;
        pushFeed(`+$${lt} FROM ${npc.name}'S POCKETS`, 'border-l-emerald-400');
      }
    }
    sfx.sleepChime();
    pushFeed(`${npc.name} WENT TO SLEEP! (Zzz)`, 'border-l-sky-400');
    return;
  }
  if (npc.aggro === 'passive') {
    if (rnd() < 0.85) {
      npc.aggro = 'fighter';
      npc.hostile = true;
      npc.alertState = 'chasing';
      pushFeed(`${npc.name} SQUARED UP! "YOU WANT SOME?!"`, 'border-l-rose-500');
    } else {
      npc.fleeTimer = 8;
    }
  } else if (npc.aggro === 'crackhead') {
    npc.fleeTimer = 10;
    npc.hostile = false;
    pushFeed(`${npc.name} SCREAMED AND BOLTED!`, 'border-l-amber-400');
  } else if (npc.aggro === 'fighter' || npc.aggro === 'clan' || npc.aggro === 'thug') {
    if (!npc.hostile) {
      npc.hostile = true;
      npc.alertState = 'chasing';
      pushFeed(`${npc.name} IS FIGHTING BACK!`, 'border-l-rose-500');
    }
    if (npc.clanId) {
      for (const ally of npcs) {
        if (ally.clanId !== npc.clanId || ally.asleep) continue;
        const adx = ally.x - npc.x, adz = ally.z - npc.z;
        if (adx * adx + adz * adz < 1156) {
          ally.hostile = true;
          ally.alertState = 'chasing';
          ally.searchX = player.x;
          ally.searchZ = player.z;
        }
      }
    }
  }
}

export let activeClanAlertText = '';
const npcSpawnQueue = [];

const _targets = [];
const _targetPool = [];
const _nearResult = { tgt: null, dist: Infinity };
function pooledTarget(i) {
  let t = _targetPool[i];
  if (!t) {
    t = { id: 'local', x: 0, y: 0, z: 0, crouching: false, inCar: false, local: false, carY: 0 };
    _targetPool[i] = t;
  }
  return t;
}
function fillTargets(mode) {
  _targets.length = 0;
  const me = pooledTarget(0);
  me.id = hooks.mpLocalId();
  me.x = player.x; me.y = player.y; me.z = player.z;
  me.crouching = !!player.crouching;
  me.inCar = !!gameState.inCar;
  me.local = true;
  const activeCar = gameState.inCar ? vehicles[gameState.activeCarIndex] : null;
  me.carY = activeCar ? activeCar.y : player.y;
  _targets.push(me);
  if (hooks.mpIsHost()) {
    let i = 1;
    for (const t of hooks.mpTargets()) {
      if (mode === 'sewer' && !(t.y < -1.2)) continue;
      const o = pooledTarget(i++);
      o.id = t.id; o.x = t.x; o.y = t.y; o.z = t.z;
      o.crouching = !!t.crouching; o.inCar = !!t.inCar; o.local = false;
      o.carY = t.carY === undefined ? t.y : t.carY;
      _targets.push(o);
    }
  }
  return _targets;
}
function nearestTo(x, z) {
  let best = _targets[0], bd = Infinity;
  for (let i = 0; i < _targets.length; i++) {
    const t = _targets[i];
    const dx = t.x - x, dz = t.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bd) { bd = d2; best = t; }
  }
  _nearResult.tgt = best;
  _nearResult.dist = Math.sqrt(bd);
  return _nearResult;
}

export function updateNPCs(dt, elapsed) {
  if (hooks.mpIsGuest()) { hooks.mpGuestNpcFrame(dt, elapsed); return; }
  const SPAWN_DIST = 82, DESPAWN_DIST = 130;
  const SEWER_SPAWN = 46, SEWER_DESPAWN = 62;
  const targets = fillTargets('all');
  const playerUnderground = under();

  if (player.attackTimer <= 0) {
    player._npcHit = false;
  } else if (!player._npcHit && (1 - player.attackTimer / player.attackDuration) >= 0.35) {
    player._npcHit = true;
    const fx = Math.sin(player.yaw + Math.PI), fz = Math.cos(player.yaw + Math.PI);
    const wDef = RIGHT_WEAPONS[gameState.activeRightWeapon] || { damage: 18 };
    for (let i = 0; i < npcs.length; i++) {
      const npc = npcs[i];
      if (!npc.spawned || npc.asleep) continue;
      const dx = npc.x - player.x, dz = npc.z - player.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 6.25 && Math.abs(player.y - (npc.y || 0.18)) < 2.2
        && (dx * fx + dz * fz) / Math.max(0.1, Math.sqrt(d2)) > 0.2) {
        damageNpc(npc, wDef.damage, player.yaw);
        break;
      }
    }
  }

  let currentClanAlert = '';
  for (const clan of Object.values(CLAN_DEFS)) {
    if (clan.inTurf(player.x, player.z)) {
      currentClanAlert = `${clan.name} TERRITORY — THEY ARE LOOKING FOR INTRUDERS!`;
      break;
    }
  }

  for (let i = 0; i < npcs.length; i++) {
    const npc = npcs[i];
    const { tgt, dist: distToPlayer } = nearestTo(npc.x, npc.z);

    if (npc.sewer) {
      if (!npc.spawned && playerUnderground && distToPlayer < SEWER_SPAWN) {
        if (!npc.queued) { npc.queued = true; npcSpawnQueue.push(npc); }
        continue;
      }
      if (npc.spawned && (!playerUnderground || distToPlayer > SEWER_DESPAWN)) {
        despawnNpc(npc);
        continue;
      }
    } else {
      if (!npc.spawned && distToPlayer < SPAWN_DIST) {
        if (!npc.queued) { npc.queued = true; npcSpawnQueue.push(npc); }
        continue;
      } else if (npc.spawned && distToPlayer > DESPAWN_DIST) {
        despawnNpc(npc);
        continue;
      }
    }
    if (!npc.spawned || !npc.mesh) continue;

    if (Math.abs(npc.kvx) + Math.abs(npc.kvz) > 0.05) {
      const kx = npc.x + npc.kvx * dt, kz = npc.z + npc.kvz * dt;
      if (!npcMoveBlocked(npc, kx, kz, i)) { npc.x = kx; npc.z = kz; }
      else { npc.kvx = 0; npc.kvz = 0; }
      const dec = Math.exp(-7 * dt);
      npc.kvx *= dec; npc.kvz *= dec;
    }

    const u = npc.mesh.userData;
    const groundY = npc.sewer ? SFY + 0.02 : snapNpcGround(npc);
    npc.y = groundY;

    if (npc.asleep) {
      npc.sleepTimer -= dt;
      npc.mesh.position.set(npc.x, groundY + 0.06, npc.z);
      npc.mesh.rotation.order = 'YXZ';
      npc.mesh.rotation.y = npc.yaw;
      npc.mesh.rotation.x = -Math.PI / 2;
      npc.mesh.rotation.z = 0;
      u.legL.rotation.x = 0.08;
      u.legR.rotation.x = -0.06;
      u.armL.rotation.x = 0.15;
      u.armR.rotation.x = -0.15;
      if (npc.isKnockedElder && u.head) {
        u.head.rotation.y = Math.sin(elapsed * 11.0 + npc.id) * 0.52;
        u.head.rotation.z = Math.cos(elapsed * 7.0 + npc.id) * 0.15;
      }
      if (npc.sleepZGroup) {
        npc.sleepZGroup.position.set(npc.x, groundY + 0.60 + Math.sin(elapsed * 2.4 + npc.id) * 0.14, npc.z);
        npc.sleepZGroup.lookAt(camera.position);
      }
      if (npc.sleepTimer <= 0) {
        npc.asleep = false;
        npc.isKnockedElder = false;
        npc.hostile = false;
        npc.alertState = 'patrol';
        npc.hp = npc.maxHp;
        npc.mesh.rotation.x = 0;
        npc.mesh.position.y = groundY;
        if (u.head) { u.head.rotation.y = 0; u.head.rotation.z = 0; }
        if (npc.sleepZGroup) {
          worldRoot.remove(npc.sleepZGroup);
          freeGeo(npc.sleepZGroup);
          npc.sleepZGroup = null;
        }
      }
      continue;
    }

    npc.mesh.rotation.x = 0;
    if (npc.attackCooldown > 0) npc.attackCooldown -= dt;
    if (npc.punchTimer > 0) npc.punchTimer -= dt;
    if (npc.snatchTimer > 0) npc.snatchTimer -= dt;
    if (npc.stunTimer > 0) {
      npc.stunTimer -= dt;
      npc.mesh.rotation.z = Math.sin(elapsed * 24) * 0.22;
      npc.mesh.position.set(npc.x, groundY, npc.z);
      continue;
    }
    npc.mesh.rotation.z = 0;

    if (npc.aggro === 'clan' && !meteorDrop.active) {
      const clan = CLAN_DEFS[npc.clanId];
      const playerInMyTurf = clan && clan.inTurf(tgt.x, tgt.z);
      const detectRadius = tgt.crouching ? 11.5 : 23.0;
      if (playerInMyTurf && distToPlayer < detectRadius && Math.abs(tgt.y - groundY) < 4.5) {
        if (npc.alertState !== 'chasing') {
          npc.alertState = 'chasing';
          npc.hostile = true;
          if (tgt.local) pushFeed(`${npc.line.replace(/"/g, '')}`, 'border-l-rose-500');
        }
        npc.searchX = tgt.x;
        npc.searchZ = tgt.z;
        npc.searchTimer = 7.5;
      } else if (playerInMyTurf && distToPlayer < 44.0 && npc.alertState === 'patrol') {
        npc.alertState = 'searching';
        npc.searchX = tgt.x + (Math.random() - 0.5) * 14;
        npc.searchZ = tgt.z + (Math.random() - 0.5) * 14;
        npc.searchTimer = 6.0;
      } else if (npc.searchTimer > 0) {
        npc.searchTimer -= dt;
        if (npc.searchTimer <= 0) {
          npc.alertState = 'patrol';
          npc.hostile = false;
        }
      }
      if (tgt.local) {
        if (npc.alertState === 'chasing') {
          currentClanAlert = `⚠ ${clan.name} HUNTING YOU! CROUCH [C] OR ESCAPE THEIR TURF`;
        } else if (npc.alertState === 'searching' && !currentClanAlert.startsWith('⚠')) {
          currentClanAlert = `👁 ${clan.name} SEARCHING THE AREA...`;
        }
      }
    }

    if (npc.aggro === 'thug' && !meteorDrop.active && !npc.hostile && !tgt.inCar
      && distToPlayer < (tgt.crouching ? 8 : 16) && Math.abs(tgt.y - groundY) < 3) {
      npc.hostile = true; npc.alertState = 'chasing';
      if (tgt.local) pushFeed(`${npc.name}: ${npc.line.replace(/"/g, '')}`, 'border-l-rose-500');
    }

    let moveSpeed = 0;

    if (npc.aggro === 'crackhead') {
      npc.begTimer -= dt;
      if (npc.fleeTimer > 0) {
        npc.fleeTimer -= dt;
        npc.yaw = Math.atan2(npc.x - tgt.x, npc.z - tgt.z);
        moveSpeed = 5.4;
      } else if (distToPlayer < 13 && Math.abs(tgt.y - groundY) < 3) {
        npc.yaw = Math.atan2(tgt.x - npc.x, tgt.z - npc.z) + Math.sin(elapsed * 9 + npc.id) * 0.35;
        if (distToPlayer > 1.5) {
          moveSpeed = 3.1;
        } else if (npc.snatchTimer <= 0) {
          npc.snatchTimer = 14;
          if (tgt.local && gameState.cash > 0) {
            const stolen = Math.min(gameState.cash, 4 + Math.floor(Math.random() * 14));
            gameState.cash -= stolen;
            npc.wallet = (npc.wallet || 0) + stolen;
            npc.fleeTimer = 6;
            sfx.pickup();
            pushFeed(`${npc.name} SNATCHED $${stolen} AND RAN! (KNOCK HIM OUT TO GET IT BACK)`, 'border-l-rose-500');
            hooks.updateHUD();
          } else if (tgt.local && npc.begTimer <= 0) {
            npc.begTimer = 9;
            pushFeed(`${npc.name}: "Spare anything? Anything at all, man?"`, 'border-l-amber-400');
          }
        }
      } else {
        npc.turnTimer -= dt;
        if (npc.turnTimer <= 0) {
          npc.yaw += (Math.random() - 0.5) * 2.6;
          npc.turnTimer = 0.5 + Math.random() * 1.1;
        }
        moveSpeed = 1.7;
        if (npc.begTimer <= 0) {
          npc.begTimer = 12 + Math.random() * 10;
          if (distToPlayer < 24) pushFeed(`${npc.name} IS MUTTERING TO HIMSELF DOWN HERE...`, 'border-l-slate-400');
        }
      }
    } else if (npc.fleeTimer > 0 && !npc.hostile) {
      npc.fleeTimer -= dt;
      npc.yaw = Math.atan2(npc.x - tgt.x, npc.z - tgt.z);
      moveSpeed = 5.6;
    } else if ((npc.hostile || npc.alertState === 'chasing') && !meteorDrop.active) {
      const dx = tgt.x - npc.x, dz = tgt.z - npc.z;
      const d = Math.hypot(dx, dz);
      npc.yaw = Math.atan2(dx, dz);
      if (d > 48 || Math.abs(tgt.y - groundY) > 6.5) {
        npc.hostile = false;
        npc.alertState = 'patrol';
      } else if (d > 1.45) {
        moveSpeed = npc.aggro === 'clan' ? 5.1 : 4.5;
      } else {
        if (npc.attackCooldown <= 0 && !tgt.inCar) {
          npc.attackCooldown = 1.05;
          npc.punchTimer = 0.34;
          npc.punchSide = (npc.punchSide + 1) % 2;
          sfx.swing();
          const dmg = (npc.aggro === 'clan' ? 11 : npc.aggro === 'thug' ? 9 : 8)
            * (npc.age === 'elder' ? 0.5 : npc.age === 'child' ? 0.3 : npc.age === 'teen' ? 0.8 : 1);
          if (tgt.local) hooks.applyPlayerDamage(dmg, npc.name);
          else hooks.mpHitPlayer(tgt.id, dmg, npc.name);
          if (npc.aggro === 'thug' && Math.random() < 0.4) {
            if (tgt.local && gameState.cash > 0) {
              const stolen = Math.min(gameState.cash, 10 + Math.floor(Math.random() * 30));
              gameState.cash -= stolen;
              npc.wallet = (npc.wallet || 0) + stolen;
              pushFeed(`${npc.name} MUGGED YOU: -$${stolen} (KNOCK THEM OUT TO GET IT BACK)`, 'border-l-rose-500');
            } else if (!tgt.local) {
              const stolen = 10 + Math.floor(Math.random() * 30);
              npc.wallet = (npc.wallet || 0) + stolen;
              hooks.mpWorldEvent({ t: 'mugged', targetId: tgt.id, amount: stolen, npcName: npc.name });
            }
          }
        }
      }
    } else if (npc.alertState === 'searching') {
      const dx = npc.searchX - npc.x, dz = npc.searchZ - npc.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 2.56) {
        npc.yaw = Math.atan2(dx, dz);
        moveSpeed = 3.2;
      } else {
        npc.yaw += Math.sin(elapsed * 3.5 + npc.id) * 1.8 * dt;
      }
    } else if (npc.role === 'patrol' || npc.role === 'clan') {
      npc.turnTimer -= dt;
      if (npc.turnTimer <= 0) {
        const hdx = npc.x - npc.homeX, hdz = npc.z - npc.homeZ;
        if (npc.role === 'clan' && hdx * hdx + hdz * hdz > 484) {
          npc.yaw = Math.atan2(npc.homeX - npc.x, npc.homeZ - npc.z);
        } else {
          npc.yaw += (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 2);
        }
        npc.turnTimer = 3.0 + Math.random() * 4.0;
      }
      moveSpeed = 2.15;
    }

    if (npc.age === 'elder') moveSpeed *= 0.6;
    else if (npc.age === 'child') moveSpeed *= 1.1;
    npc.moving = moveSpeed > 0;

    if (moveSpeed > 0) {
      const nx = npc.x + Math.sin(npc.yaw) * moveSpeed * dt;
      const nz = npc.z + Math.cos(npc.yaw) * moveSpeed * dt;
      if (npcMoveBlocked(npc, nx, nz, i)) {
        npc.yaw += Math.PI * 0.65;
      } else {
        npc.x = nx;
        npc.z = nz;
      }
      npc.walkCycle += dt * (moveSpeed > 3.5 ? 12.5 : 7.5);
      const sw = Math.sin(npc.walkCycle) * (moveSpeed > 3.5 ? 0.78 : 0.52);
      u.legL.rotation.x = sw;
      u.legR.rotation.x = -sw;
      if (npc.punchTimer <= 0) {
        if (npc.hostile) {
          u.armL.rotation.x = -1.25; u.armL.rotation.z = 0.38;
          u.armR.rotation.x = -1.25; u.armR.rotation.z = -0.38;
          u.torso.rotation.y = Math.sin(elapsed * 7.0 + npc.id) * 0.18;
        } else {
          u.armL.rotation.x = -sw * 0.75; u.armR.rotation.x = sw * 0.75;
          u.armL.rotation.z = 0; u.armR.rotation.z = 0; u.torso.rotation.y = 0;
        }
      }
    } else {
      u.legL.rotation.x = 0;
      u.legR.rotation.x = 0;
      if (npc.punchTimer <= 0) {
        if (npc.hostile) {
          u.armL.rotation.x = -1.25; u.armL.rotation.z = 0.38;
          u.armR.rotation.x = -1.25; u.armR.rotation.z = -0.38;
          u.torso.rotation.y = Math.sin(elapsed * 7.0 + npc.id) * 0.18;
        } else {
          u.armL.rotation.x = 0; u.armR.rotation.x = 0;
          u.armL.rotation.z = 0; u.armR.rotation.z = 0; u.torso.rotation.y = 0;
        }
      }
    }

    if (npc.punchTimer > 0) {
      const pProg = 1 - npc.punchTimer / 0.34;
      const swingArc = Math.sin(pProg * Math.PI);
      if (npc.punchSide === 0) {
        u.armR.rotation.x = -1.45 * swingArc;
        u.armR.rotation.z = -0.65 * swingArc;
        u.torso.rotation.y = 0.42 * swingArc;
      } else {
        u.armL.rotation.x = -1.45 * swingArc;
        u.armL.rotation.z = 0.65 * swingArc;
        u.torso.rotation.y = -0.42 * swingArc;
      }
    }

    if (npc.crackhead) {
      const j = Math.sin(elapsed * 23 + npc.id) * Math.cos(elapsed * 17.3 + npc.id * 2);
      if (u.head) {
        u.head.rotation.y = j * 0.42;
        u.head.rotation.z = Math.sin(elapsed * 13.7 + npc.id) * 0.16;
      }
      u.torso.rotation.z = j * 0.09;
      if (npc.punchTimer <= 0) {
        u.armL.rotation.x += Math.sin(elapsed * 19 + npc.id) * 0.30;
        u.armR.rotation.z += Math.cos(elapsed * 21 + npc.id) * 0.24;
      }
      npc.mesh.rotation.z = j * 0.05;
    }

    npc.mesh.position.set(npc.x, npc.y, npc.z);
    npc.mesh.rotation.y = npc.yaw;
  }

  for (let k = 0; k < 2 && npcSpawnQueue.length; k++) {
    const npc = npcSpawnQueue.shift();
    npc.queued = false;
    if (npc.spawned) continue;
    const { dist } = nearestTo(npc.x, npc.z);
    if (npc.sewer) {
      if (!under() || dist > SEWER_DESPAWN) continue;
    } else if (dist > DESPAWN_DIST) continue;
    npc.y = npc.sewer ? SFY + 0.02 : computeSupportFloor(npc.x, npc.z, 3.0, 0.4);
    if (!Number.isFinite(npc.y)) npc.y = 0.18;
    npc.mesh = buildNpcMeshRaw(npc.shirt, npc.pants, npc.bandana, npc);
    npc.mesh.position.set(npc.x, npc.y, npc.z);
    npc.mesh.rotation.y = npc.yaw;
    worldRoot.add(npc.mesh);
    npc.spawned = true;
    if (npc.asleep && !npc.sleepZGroup) {
      const zzz = buildSleepZzzGroup();
      zzz.position.set(npc.x, npc.y + 0.67, npc.z);
      worldRoot.add(zzz);
      npc.sleepZGroup = zzz;
    }
  }
  activeClanAlertText = currentClanAlert;
}

function despawnNpc(npc) {
  if (npc.mesh) {
    worldRoot.remove(npc.mesh);
    freeGeo(npc.mesh);
    npc.mesh = null;
  }
  if (npc.sleepZGroup) {
    worldRoot.remove(npc.sleepZGroup);
    freeGeo(npc.sleepZGroup);
    npc.sleepZGroup = null;
  }
  npc.spawned = false;
}
function snapNpcGround(npc) {
  const y = computeSupportFloor(npc.x, npc.z, (npc.y || 1) + 0.8, 0.4);
  return Number.isFinite(y) ? y : (npc.y || 0.18);
}
function npcMoveBlocked(npc, nx, nz, selfIdx) {
  if (npc.sewer) return !sewerOK(nx, nz, 0.32);
  return npcBlocked(nx, nz, selfIdx);
}

export const SKINS = [0xf1c8a5, 0xe2a87e, 0xd99b72, 0xb97a57, 0x8d5a3c, 0x6b4129];
export const HAIRS = [0x1c1917, 0x3b2a1a, 0x6b3f1d, 0xb8860b, 0xc2410c, 0x0f172a];
const IRIS_COLORS = [0x3b2a1a, 0x1e40af, 0x166534, 0x44403c];
const PACK_COLORS = [0x16a34a, 0xf59e0b, 0x2563eb, 0xdb2777];
const TEEN_STYLES = ['cap', 'mohawk', 'long', 'short'];
const ADULT_STYLES = ['short', 'short', 'long', 'bald'];

export function npcHpFor(def, clan) {
  if (def.aggro === 'crackhead') return 55;
  const base = clan ? 120 : 100;
  return def.age === 'child' ? 40 : def.age === 'elder' ? 70 : def.age === 'teen' ? 85 : base;
}

let _wallSubset = null;
let _wallSubsetLen = -1;
function npcWallBoxes() {
  if (_wallSubset && _wallSubsetLen === worldBoxes.length) return _wallSubset;
  const out = [];
  for (let i = 0; i < worldBoxes.length; i++) {
    const wb = worldBoxes[i];
    if (wb.maxY > 0.45 && wb.minY < 1.8) out.push(wb);
  }
  _wallSubset = out;
  _wallSubsetLen = worldBoxes.length;
  return out;
}

export function npcBlocked(nx, nz, selfIdx = -1) {
  const B = WORLD_BOUNDS;
  if (B && Number.isFinite(B.minX) && B.maxX > B.minX) {
    if (nx < B.minX + 1 || nx > B.maxX - 1 || nz < B.minZ + 1 || nz > B.maxZ - 1) return true;
  } else if (Math.abs(nx) > 136 || nz < -172 || nz > 202) {
    return true;
  }
  const walls = npcWallBoxes();
  for (let b = 0; b < walls.length; b++) {
    const wb = walls[b];
    if (wb.maxY <= 0.45 || wb.minY >= 1.8) continue;      
    if (nx + 0.4 > wb.minX && nx - 0.4 < wb.maxX && nz + 0.4 > wb.minZ && nz - 0.4 < wb.maxZ) return true;
  }
  for (let j = 0; j < npcs.length; j++) {
    if (j === selfIdx) continue;
    const other = npcs[j];
    if (!other.spawned || other.asleep) continue;
    const dx = nx - other.x, dz = nz - other.z;
    if (dx * dx + dz * dz < 0.5184) return true;
  }
  return false;
}

export function attachDriverToVehicle(carGroup, shirtColor = 0x2563eb, pantsColor = 0x0f172a) {
  const driver = buildNpcMeshRaw(shirtColor, pantsColor, null, { age: 'adult' });
  driver.scale.setScalar(0.72);
  driver.position.set(-0.4, 0.42, -0.15);
  if (driver.userData) {
    const u = driver.userData;
    u.legL.rotation.x = -Math.PI / 2.2;
    u.legR.rotation.x = -Math.PI / 2.2;
    u.armL.rotation.x = -Math.PI / 3;
    u.armR.rotation.x = -Math.PI / 3;
  }
  carGroup.add(driver);
  return driver;
}

const faceBasicCache = new Map();
function faceBasic(hex, transparent = false, opacity = 1) {
  const key = hex + '|' + transparent + '|' + opacity;
  let m = faceBasicCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: hex, transparent, opacity });
    m.userData.shared = true;
    faceBasicCache.set(key, m);
  }
  return m;
}
export function makeFace(w, h, d, dir, o = {}) {
  const C = makeFace.c || (makeFace.c = (() => {
    const cache = {
      white: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      mouth: new THREE.MeshBasicMaterial({ color: 0x7f1d1d }),
      lens: new THREE.MeshBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.45 }),
      rim: new THREE.MeshBasicMaterial({ color: 0x111827 })
    };
    Object.values(cache).forEach((m) => { m.userData.shared = true; });
    return cache;
  })());
  const g = new THREE.Group();
  g.position.z = dir * (d / 2 + 0.004);
  const B = (sx, sy, sz, m, x, y, z = 0) => {
    const b = boxMesh(sx, sy, sz, m);
    b.position.set(x, y, z * dir);
    g.add(b);
    return b;
  };
  const ex = w * 0.22, ey = h * 0.06, es = w * 0.2, by = ey + h * 0.17, my = -h * 0.27;
  const irisM = faceBasic(o.iris || 0x3b2a1a);
  const browM = faceBasic(o.brow || 0x1c1917);
  const eyeL = B(es, es * 0.8, 0.008, C.white, -ex, ey);
  const eyeR = B(es, es * 0.8, 0.008, C.white, ex, ey);
  const pupL = B(es * 0.5, es * 0.62, 0.01, irisM, -ex, ey, 0.004);
  const pupR = B(es * 0.5, es * 0.62, 0.01, irisM, ex, ey, 0.004);
  const browL = B(w * 0.27, h * 0.055, 0.01, browM, -ex, by);
  const browR = B(w * 0.27, h * 0.055, 0.01, browM, ex, by);
  const skinHex = new THREE.Color(o.skin || 0xd99b72).multiplyScalar(0.82).getHex();
  B(w * 0.1, h * 0.17, 0.035, makeSharedMat(skinHex), 0, -h * 0.05, 0.012);
  const mouth = B(w * 0.3, h * 0.055, 0.01, C.mouth, 0, my);
  const smileL = B(w * 0.06, h * 0.05, 0.01, C.mouth, -w * 0.17, my + h * 0.04);
  const smileR = B(w * 0.06, h * 0.05, 0.01, C.mouth, w * 0.17, my + h * 0.04);
  smileL.visible = smileR.visible = false;
  if (o.age === 'elder') {
    B(w * 0.5, h * 0.025, 0.006, faceBasic(skinHex), 0, h * 0.34, 0);
    B(w * 0.4, h * 0.025, 0.006, faceBasic(skinHex), 0, h * 0.30, 0);
  }
  if (o.glasses) {
    B(es * 1.5, es * 1.25, 0.006, C.lens, -ex, ey, 0.008);
    B(es * 1.5, es * 1.25, 0.006, C.lens, ex, ey, 0.008);
    B(w * 0.1, h * 0.03, 0.006, C.rim, 0, ey + 0.004, 0.008);
  }
  g.userData = { eyeL, eyeR, pupL, pupR, browL, browR, mouth, smileL, smileR, by, my, h, mood: '', blink: null };
  return g;
}
export function setFaceMood(f, mood, blink) {
  const u = f.userData;
  if (u.mood === mood && u.blink === blink) return;
  u.mood = mood; u.blink = blink;
  const a = mood === 'angry', s = mood === 'scared';
  u.browL.rotation.z = a ? -0.42 : s ? 0.2 : 0;
  u.browR.rotation.z = a ? 0.42 : s ? -0.2 : 0;
  u.browL.position.y = u.browR.position.y = u.by + (s ? u.h * 0.05 : a ? -u.h * 0.03 : 0);
  const ey = blink ? 0.12 : (s ? 1.35 : a ? 0.8 : 1);
  u.eyeL.scale.y = u.eyeR.scale.y = ey;
  u.pupL.scale.y = u.pupR.scale.y = blink ? 0.1 : 1;
  u.mouth.scale.set(a ? 0.9 : s ? 0.5 : 1, a ? 1.8 : s ? 3.4 : 1, 1);
  u.mouth.position.y = u.my - (a ? u.h * 0.015 : 0);
  u.smileL.visible = u.smileR.visible = (mood === 'happy');
}
export function addHair(head, w, h, d, dir, style, hex) {
  const m = makeSharedMat(hex);
  const put = (sx, sy, sz, x, y, z) => {
    const b = boxMesh(sx, sy, sz, m);
    b.position.set(x, y, z);
    head.add(b);
  };
  if (style === 'bald') {
    put(w * 1.04, h * 0.12, d * 0.3, 0, h * 0.18, -dir * d * 0.42);
    return;
  }
  put(w * 1.08, h * 0.3, d * 1.08, 0, h * 0.42, 0);
  if (style === 'long' || style === 'pigtails') {
    put(w * 1.08, h * 0.95, d * 0.28, 0, -h * 0.02, -dir * d * 0.46);
    put(w * 0.14, h * 0.8, d * 0.9, -w * 0.52, 0, 0);
    put(w * 0.14, h * 0.8, d * 0.9, w * 0.52, 0, 0);
  }
  if (style === 'pigtails') {
    put(w * 0.2, h * 0.5, w * 0.2, -w * 0.62, -h * 0.3, 0);
    put(w * 0.2, h * 0.5, w * 0.2, w * 0.62, -h * 0.3, 0);
  }
  if (style === 'mohawk') put(w * 0.18, h * 0.3, d * 1.1, 0, h * 0.68, 0);
  if (style === 'cap') {
    const cap = boxMesh(w * 1.12, h * 0.22, d * 1.12, makeSharedMat(0xdc2626));
    cap.position.y = h * 0.5;
    head.add(cap);
    const brim = boxMesh(w * 1.0, h * 0.06, d * 0.5, makeSharedMat(0xb91c1c));
    brim.position.set(0, h * 0.42, dir * d * 0.62);
    head.add(brim);
  }
}

export function buildNpcMeshRaw(shirtC, pantsC, bandC, o = {}) {
  const age = o.age || 'adult';
  const S = { child: 0.62, teen: 0.88, adult: 1, elder: 0.95 }[age] || 1;
  const bigHead = age === 'child' ? 1.42 : age === 'teen' ? 1.1 : 1;
  const id = o.id || 0;
  const skin = o.skin || SKINS[id % SKINS.length];
  const hairHex = age === 'elder' ? 0xd1d5db : (o.hair || HAIRS[(id * 3 + 1) % HAIRS.length]);
  const root = new THREE.Group();
  const hip = new THREE.Group();
  hip.position.y = 0.90;
  root.add(hip);
  const skinM = makeSharedMat(skin);
  const shirtM = makeSharedMat(shirtC);
  const pantsM = makeSharedMat(pantsC);
  const shoeM = makeSharedMat(0x111827);
  const bx = (sx, sy, sz, m) => boxMesh(sx, sy, sz, m);
  const torso = bx(0.44, 0.54, 0.22, shirtM);
  torso.position.y = 0.27;
  torso.castShadow = true;
  const belt = bx(0.46, 0.06, 0.24, makeSharedMat(0x1c1917));
  belt.position.y = -0.22;
  torso.add(belt);
  const collar = bx(0.2, 0.05, 0.24, skinM);
  collar.position.y = 0.28;
  torso.add(collar);
  const hw = 0.24, hh = 0.26, hd = 0.24;
  const head = bx(hw, hh, hd, skinM);
  head.castShadow = true;
  head.scale.setScalar(bigHead);
  head.position.y = 0.55 + (hh / 2) * bigHead;
  const style = age === 'child' ? (id % 2 ? 'pigtails' : 'short')
    : age === 'elder' ? (id % 3 === 0 ? 'bald' : 'short')
    : age === 'teen' ? hashPick(TEEN_STYLES, id, 1)
    : hashPick(ADULT_STYLES, id, 2);
  addHair(head, hw, hh, hd, 1, style, hairHex);
  const hasBeard = age !== 'child' && (o.beard || (id % 3 === 1 || id % 7 === 0));
  if (hasBeard) {
    const beardM = makeSharedMat(hairHex);
    const chinBeard = bx(hw * 1.04, hh * 0.35, hd * 0.65, beardM);
    chinBeard.position.set(0, -hh * 0.3, hd * 0.22);
    head.add(chinBeard);
    const mustache = bx(hw * 0.65, hh * 0.12, hd * 0.35, beardM);
    mustache.position.set(0, -hh * 0.14, hd * 0.42);
    head.add(mustache);
  }
  const face = makeFace(hw, hh, hd, 1, {
    age, skin, brow: hairHex,
    glasses: age === 'elder' && id % 2 === 0,
    iris: hashPick(IRIS_COLORS, id, 3)
  });
  head.add(face);
  if (bandC !== null && bandC !== undefined) {
    const band = bx(hw * 1.1, hh * 0.2, hd * 1.1, makeSharedMat(bandC));
    band.position.y = hh * 0.22;
    head.add(band);
  }
  const armGeo = sharedBoxGeo(0.11, 0.50, 0.11);
  const legGeo = sharedBoxGeo(0.14, 0.72, 0.14);
  const mkArm = (x) => {
    const a = new THREE.Mesh(armGeo, shirtM);
    a.position.set(x, 0.26, 0);
    a.castShadow = true;
    const hand = bx(0.1, 0.1, 0.1, skinM);
    hand.position.y = -0.28;
    a.add(hand);
    return a;
  };
  const mkLeg = (x) => {
    const l = new THREE.Mesh(legGeo, pantsM);
    l.position.set(x, -0.36, 0);
    l.castShadow = true;
    const shoe = bx(0.16, 0.08, 0.26, shoeM);
    shoe.position.set(0, -0.34, 0.05);
    l.add(shoe);
    return l;
  };
  const armL = mkArm(-0.29), armR = mkArm(0.29), legL = mkLeg(-0.12), legR = mkLeg(0.12);
  if (age === 'elder') {
    hip.rotation.x = 0.16;
    const cane = bx(0.035, 0.85, 0.035, makeSharedMat(0x78350f));
    cane.position.set(0, -0.42, 0.12);
    armR.add(cane);
  }
  if (age === 'child' || age === 'teen') {
    const pack = bx(0.3, 0.34, 0.12, makeSharedMat(hashPick(PACK_COLORS, id, 4)));
    pack.position.set(0, 0.3, -0.17);
    hip.add(pack);
  }
  if (o.crackhead) {
    const bag = bx(0.18, 0.24, 0.14, makeSharedMat(0xa8813f));
    bag.position.set(0, -0.36, 0.05);
    armL.add(bag);
    const pipe = bx(0.03, 0.03, 0.20, makeSharedMat(0xcbd5e1));
    pipe.position.set(0, -0.32, 0.10);
    pipe.rotation.x = 0.5;
    armR.add(pipe);
    const bowl = bx(0.06, 0.06, 0.06, makeSharedMat(0x1c1917));
    bowl.position.set(0, -0.30, 0.19);
    armR.add(bowl);
    const hood = bx(hw * 1.16, hh * 0.5, hd * 1.16, makeSharedMat(0x3f3f46));
    hood.position.y = hh * 0.34;
    head.add(hood);
  }
  hip.add(torso, head, armL, armR, legL, legR);
  root.scale.setScalar(S * (o.scale || 1));
  root.userData = { hip, torso, head, armL, armR, legL, legR, face };
  if (o.gtFestival) hooks.decorateNpc(root, o);
  return root;
}
export function buildNpcMesh(config = {}) {
  const toHex = (c, d) => (c === undefined || c === null || c === '') ? d : (typeof c === 'number' ? c : new THREE.Color(c).getHex());
  const band = config.bandColor ? toHex(config.bandColor, null) : null;
  return buildNpcMeshRaw(toHex(config.shirtColor, 0x1d4ed8), toHex(config.pantsColor, 0x0b1220), band, {
    age: config.age || 'adult',
    id: config.id === undefined ? 1 : config.id,
    skin: config.skin === undefined ? undefined : toHex(config.skin, undefined),
    hair: config.hair === undefined ? undefined : toHex(config.hair, undefined)
  });
}

export function makeExtraRoster() {
  const L = [];
  const add = (name, age, aggro, x, z, shirt, pants, line, role = 'patrol') =>
    L.push({ name, age, aggro, role, x, z, yaw: Math.random() * 6.28, shirt, pants, line });
  add('KID MIA', 'child', 'passive', -9, 7, 0xf472b6, 0x1d4ed8, '"Wanna see my frog? His name is Sir Hops-a-lot!"');
  add('KID OLLIE', 'child', 'passive', 8, -9, 0xfacc15, 0x166534, '"Race you to the fountain!"');
  add('KID ZOE', 'child', 'passive', 11, 6, 0xa78bfa, 0x0f172a, '"My mom says don\'t talk to strangers... hi!"');
  add('KID FELIX', 'child', 'passive', -24, 135, 0x22c55e, 0x78350f, '"I saw a bear! ...maybe it was a big dog."');
  add('KID RUBY', 'child', 'passive', 72, 138, 0xfb7185, 0x0ea5e9, '"I built a sandcastle with a moat!"');
  add('TEEN SKYLER', 'teen', 'passive', -6, -11, 0x14b8a6, 0x1e293b, '"This plaza has the best skate lines, no cap."');
  add('TEEN DEX', 'teen', 'fighter', 12, -3, 0x6366f1, 0x0f172a, '"Touch my board and see what happens."');
  add('TEEN JADE', 'teen', 'passive', -12, -4, 0xf97316, 0x1e3a8a, '"Do you know where the arcade is? Me neither."');
  add('TEEN KAI', 'teen', 'passive', 72, 150, 0xeab308, 0x0369a1, '"Surf is up! Well... waist-high wading is up."');
  add('TEEN NOVA', 'teen', 'passive', -96, 126, 0xe11d48, 0x1e293b, '"Fresh powder! Slippery though."');
  add('GRANDPA WALT', 'elder', 'fighter', -14, 4, 0x92400e, 0x44403c, '"Back in my day, hotdogs cost a nickel!"');
  add('GRANDMA ROSE', 'elder', 'passive', 6, 12, 0xc084fc, 0x57534e, '"Be a dear and watch your pockets, sweetheart."');
  add('OLD MAN BEN', 'elder', 'fighter', -24, -34, 0x475569, 0x1c1917, '"I\'ve outrun better thieves than you."');
  add('GRANNY MAE', 'elder', 'passive', 24, -58, 0xf9a8d4, 0x44403c, '"Is it Tuesday? It feels like Tuesday."');
  add('RANGER OAKS', 'elder', 'fighter', -22, 128, 0x166534, 0x3f3f46, '"Stay on the trail and leave the mushrooms alone."');
  add('SUNBATHER GUS', 'elder', 'passive', 56, 140, 0xef4444, 0x0ea5e9, '"Don\'t block my sun, young one."');
  add('CITIZEN PAT', 'adult', 'passive', -72, -30, 0x0891b2, 0x1e293b, '"Nice day for a stroll, isn\'t it?"');
  add('CITIZEN LUIS', 'adult', 'passive', 24, -60, 0x65a30d, 0x0f172a, '"Lunch break. Finally."');
  add('TOURIST DANA', 'adult', 'passive', -2, 14, 0xf43f5e, 0xfef3c7, '"Is this the famous Aura Tower?"');
  add('SKIER ANDERS', 'adult', 'passive', -96, 150, 0x2563eb, 0x0f172a, '"Perfect snow today. Careful on the ice pond!"');
  add('LIFEGUARD CHAD', 'adult', 'fighter', 72, 128, 0xdc2626, 0xfacc15, '"No running on the sand. Okay, a little."');
  add('MUGGER SNAKE', 'adult', 'thug', -24, -30, 0x3f3f46, 0x111827, '"Nice wallet. It\'s mine now."');
  add('MUGGER RIZZO', 'adult', 'thug', 72, -118, 0x7f1d1d, 0x1c1917, '"Empty your pockets, pal."');
  add('PICKPOCKET VIC', 'teen', 'thug', 24, 20, 0x0f766e, 0x111827, '"Hey, what\'s that behind you?"');
  add('POACHER GRIMM', 'adult', 'thug', -24, 172, 0x713f12, 0x1c1917, '"This is my forest. Leave your cash."');
  add('BEACH BULLY BRAD', 'adult', 'thug', 72, 166, 0xea580c, 0x0369a1, '"Sand tax is due, tourist."');
  add('SKI BANDIT ROCK', 'adult', 'thug', -96, 172, 0x1e3a8a, 0xe2e8f0, '"Your cash, or the slope gets you."');
  return L;
}

export function makeNorthernRoster() {
  const L = [];
  let n = 0;
  const add = (name, role, aggro, x, z, shirt, pants, line, extra) => {
    n++;
    L.push(Object.assign({
      name, role, aggro, x, z,
      yaw: hash01(900 + n * 3.7) * 6.283,
      shirt, pants, line
    }, extra || {}));
  };
  const clan = (name, x, z, line) => L.push({
    name, role: 'clan', clanId: 'harbor_syndicate', x, z,
    yaw: hash01(700 + L.length * 2.3) * 6.283, line
  });

  clan('SYNDICATE LOOKOUT RICO', -60, 516, '"SYNDICATE: This block pays tribute to us. You don\'t."');
  clan('SYNDICATE ENFORCER BISHOP', -12, 564, '"SYNDICATE: Wilshire belongs to the harbor. Get him!"');
  clan('SYNDICATE RUNNER TALON', 36, 612, '"SYNDICATE: Nobody runs through our concourse uninvited!"');
  clan('SYNDICATE CAPTAIN VEGA', 84, 468, '"SYNDICATE: Seal the intersection. He\'s not leaving."');
  clan('SYNDICATE SENTRY KOSS', -108, 660, '"SYNDICATE: North end is ours too, tourist."');
  clan('SYNDICATE WHEELMAN DUTCH', -145, 600, '"SYNDICATE: West bank spine is a toll road. Pay up."');

  add('WEST BANK CLERK IMOGEN', 'patrol', 'passive', -195, 480, 0x0ea5e9, 0x1e293b,
    '"The west bank towers have the best lobby views in Los Aura."');
  add('WEST BANK JOGGER PACE', 'patrol', 'passive', -195, 660, 0x22c55e, 0x0f172a,
    '"Four blocks a lap. The syndicate ignores me if I keep moving."');

  add('NORTH COURIER BREE', 'patrol', 'fighter', 124, 564, 0x2563eb, 0x0f172a,
    '"Arts District drop-off. Please don\'t rob me, I\'m on a clock."');
  add('STREET VENDOR LULA', 'patrol', 'passive', -60, 660, 0xf59e0b, 0x7f1d1d,
    '"Pretzels! Two dollars! ...Three if you look rich."');
  add('ANALYST RHYS', 'patrol', 'passive', 36, 516, 0x94a3b8, 0x1e293b,
    '"I work on the forty-second floor. I have not seen daylight in weeks."');

  add('BOARDWALK BUSKER REEF', 'patrol', 'passive', -120, 413, 0xf43f5e, 0x1e1b4b,
    '"Any request except the one about the ferris wheel. Everyone asks that."');
  add('PIER TOURIST SANDY', 'patrol', 'passive', -90, 428, 0xfef3c7, 0x0ea5e9,
    '"Is the water safe? The lifeguard just laughed at me."');
  add('SURF COACH MARLO', 'patrol', 'fighter', 60, 413, 0x0d9488, 0x0f172a,
    '"Look down and press forward to dive. Look up to surface. It\'s not complicated."');
  add('BEACH LIFEGUARD TORI', 'patrol', 'fighter', 100, 428, 0xdc2626, 0xfacc15,
    '"Watch your oxygen bar out there. I am not swimming after you twice."');
  add('SANDCASTLE KID NEMO', 'patrol', 'passive', 0, 394, 0x38bdf8, 0xf59e0b,
    '"My moat has a working drawbridge. It is made of sand.",', { age: 'child' });
  add('BOARDWALK THUG SLICK', 'patrol', 'thug', -160, 428, 0x3f3f46, 0x111827,
    '"Nice boardwalk. Be a shame if you paid a walking fee."');

  add('GROUND CREW CHIEF HOLLIS', 'stationary', 'fighter', 194, 564, 0xf97316, 0x1e293b,
    '"Curb is for drop-off only. And stay off the apron, it\'s live."');
  add('BAGGAGE HANDLER PIKE', 'patrol', 'passive', 248, 685, 0xfacc15, 0x0f172a,
    '"Twelve hours of carts. The carousel eats one bag a shift, minimum."');
  add('TSA OFFICER LANE', 'stationary', 'fighter', 216, 500, 0x1d4ed8, 0x0b1220,
    '"Bins, belts, nothing sharp. The armory is downtown, not here."');
  add('TRAVELER QUINN', 'patrol', 'passive', 216, 630, 0xa78bfa, 0x334155,
    '"My flight says DELAYED again. It has said DELAYED for six hours."');
  add('RAMP MARSHAL DEE', 'stationary', 'passive', 430, 560, 0x22c55e, 0x1e293b,
    '"Hangar one is maintenance, hangar two is cargo. Mind the tugs."');
  add('AIRPORT PICKPOCKET FINCH', 'patrol', 'thug', 200, 470, 0x0f766e, 0x111827,
    '"Just looking for my gate. Which one is your wallet at?"', { age: 'teen' });

  add('PIT CREW BOSS GUNNER', 'stationary', 'fighter', -50, 752, 0xef4444, 0x0f172a,
    '"Six gears, downshift into the corner, and stay off my pit wall."');
  add('TRACK MARSHAL FLAGG', 'patrol', 'passive', 30, 790, 0xfacc15, 0x1e293b,
    '"Infield is open. The stunt ramps are not a shortcut, they are a lawsuit."');
  add('TRACK THUG SCRATCH', 'patrol', 'thug', -100, 800, 0x7f1d1d, 0x1c1917,
    '"Paddock tax. Cash, or I take it out of your paintwork."');
  add('GRANDSTAND FAN ROWDY', 'patrol', 'passive', -20, 770, 0x2563eb, 0xf8fafc,
    '"The red GT-R is going to take the north turn wide, watch."');
  return L;
}

export function makeSewerRoster() {
  return [{
    name: 'TWITCHY PETE',
    role: 'patrol',
    aggro: 'crackhead',
    crackhead: true,
    sewer: true,
    age: 'adult',
    x: 20, z: -52,
    yaw: 1.2,
    shirt: 0x52525b,
    pants: 0x27272a,
    skin: 0xb9a58c,
    hair: 0x1c1917,
    line: '"You got anything? Anything at all? I live down here, man."'
  }];
}

export const pp = { npc: null, prog: 0, aware: 0, el: null, labelEl: null, progEl: null, awareEl: null, hinted: false };
export function ppEnsureUI() {
  if (pp.el) return;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:50%;bottom:104px;transform:translateX(-50%);z-index:25;display:none;pointer-events:none;min-width:250px;padding:8px 12px;border-radius:10px;background:rgba(10,13,18,.9);border:1px solid rgba(245,158,11,.5);color:#fff;font:700 11px Rajdhani,Inter,sans-serif;letter-spacing:.06em;text-align:center;text-transform:uppercase';
  el.innerHTML = '<div id="pp-label"></div>'
    + '<div style="height:6px;margin-top:6px;background:#1e293b;border-radius:9px;overflow:hidden"><div id="pp-prog" style="height:100%;width:0;background:#34d399"></div></div>'
    + '<div style="height:4px;margin-top:4px;background:#1e293b;border-radius:9px;overflow:hidden"><div id="pp-aware" style="height:100%;width:0;background:#f43f5e"></div></div>'
    + '<div style="font-size:9px;color:#94a3b8;margin-top:3px">GREEN: LIFT · RED: SUSPICION (STAY BEHIND, CROUCH)</div>';
  document.body.appendChild(el);
  pp.el = el;
  pp.labelEl = el.querySelector('#pp-label');
  pp.progEl = el.querySelector('#pp-prog');
  pp.awareEl = el.querySelector('#pp-aware');
}
export function lootFor(n, mult = 1) {
  const r = (a, b) => Math.floor(a + rnd() * (b - a));
  let c = n.age === 'child' ? r(1, 7) : n.age === 'teen' ? r(4, 26) : n.age === 'elder' ? r(18, 70) : r(12, 90);
  if (n.clanId) c = r(30, 120);
  if (n.aggro === 'thug') c = r(25, 110);
  if (n.aggro === 'crackhead') c = r(2, 18);
  if (/TELLER/.test(n.name)) c = r(120, 300);
  return Math.floor(c * mult) + (n.wallet || 0);
}
export function updatePickpocket(dt) {
  ppEnsureUI();
  const isGuest = hooks.mpIsGuest();
  if (!isGuest) {
    for (const n of npcs) {
      if (!n.picked) continue;
      n.pickCool = (n.pickCool || 0) - dt;
      if (n.pickCool <= 0) n.picked = false;
    }
  }
  const blocked = gameState.inCar || gameState.inventoryOpen || gameState.mapOpen
    || gameState.settingsOpen || meteorDrop.active || player.mantle.active;
  let best = null, bd2 = 1.95 * 1.95;
  if (!blocked) {
    for (const n of npcs) {
      if (!n.mesh || n.hostile || n.picked || n.stunTimer > 0 || n.fleeTimer > 0) continue;
      const dx = n.x - player.x, dz = n.z - player.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd2 && Math.abs(player.y - (n.y || 0.18)) < 1.6) { bd2 = d2; best = n; }
    }
  }
  if (best !== pp.npc) { pp.npc = best; pp.prog = 0; pp.aware = 0; }
  if (!best) { pp.el.style.display = 'none'; return; }
  const n = best;
  const tx = player.x - n.x, tz = player.z - n.z;
  const L = Math.hypot(tx, tz) || 1;
  const facing = n.asleep ? -1 : (Math.sin(n.yaw) * tx + Math.cos(n.yaw) * tz) / L;
  const held = !!keys['KeyG'];
  const moving = keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD'];
  const sprinting = (keys['ShiftLeft'] || keys['ShiftRight']) && moving;
  if (held) {
    const dur = n.asleep ? 0.5 : n.age === 'elder' ? 0.9 : n.age === 'child' ? 0.8 : n.clanId ? 1.6 : 1.2;
    pp.prog += (dt / dur) * (player.crouching ? 1.25 : 1);
    if (!n.asleep) {
      let rate = 0.2 + (player.crouching ? -0.15 : 0.25);
      if (facing > 0.25) rate += 1.1;
      if (sprinting) rate += 0.8;
      rate *= n.age === 'elder' ? 0.6
        : n.age === 'child' ? 1.4
        : (n.clanId || n.aggro === 'thug') ? 1.4
        : n.aggro === 'crackhead' ? 1.6 : 1;
      pp.aware += Math.max(0, rate) * dt;
    }
    if (pp.aware >= 1) {
      sfx.hit();
      flashEdge('rgba(244, 63, 94, 0.35)');
      if (isGuest) {
        hooks.mpWorldEvent({ t: 'npc_alert', id: n.id });
      } else {
        n.picked = true; n.pickCool = 60;
        if (n.aggro === 'fighter' || n.aggro === 'clan' || n.aggro === 'thug') {
          n.hostile = true; n.alertState = 'chasing';
        } else {
          n.fleeTimer = 8;
        }
        hooks.mpWorldEvent({ t: 'npc_alert', id: n.id });
      }
      if (n.aggro === 'fighter' || n.aggro === 'clan' || n.aggro === 'thug') {
        pushFeed(`${n.name} CAUGHT YOU! "HEY!"`, 'border-l-rose-500');
      } else {
        pushFeed(`${n.name} NOTICED AND RAN OFF!`, 'border-l-rose-500');
      }
      pp.prog = 0; pp.aware = 0;
    } else if (pp.prog >= 1) {
      const mode = hooks.mpNpcLoot(n);       
      if (mode === 'pending') {
        pp.prog = 0; pp.aware = 0;          
      } else {
        const cash = lootFor(n);
        gameState.cash += cash;
        let extra = '';
        if (rnd() < 0.22) { addLeftItemToBag(rnd() < 0.5 ? 'soda' : 'medkit', 1); extra = ' + ITEM'; }
        n.picked = true; n.pickCool = 120;
        sfx.pickup();
        flashEdge('rgba(52, 211, 153, 0.3)');
        pushFeed(`PICKPOCKETED ${n.name}: +$${cash}${extra}`, 'border-l-emerald-400');
        pp.prog = 0; pp.aware = 0;
        hooks.updateHUD();
      }
    }
  } else {
    pp.prog = Math.max(0, pp.prog - dt * 1.5);
    pp.aware = Math.max(0, pp.aware - dt * 0.6);
  }
  pp.el.style.display = 'block';
  const tag = n.asleep ? 'SLEEPING' : facing > 0.25 ? 'FACING YOU!' : 'BACK TURNED';
  pp.labelEl.textContent = `HOLD [G] · PICKPOCKET ${n.name} (${n.age}) · ${tag}`;
  pp.progEl.style.width = `${Math.min(100, pp.prog * 100)}%`;
  pp.awareEl.style.width = `${Math.min(100, pp.aware * 100)}%`;
}

export function damageNpc(n, a, y) {
  if (!n) return;
  if (hooks.mpIsGuest()) {
    hooks.mpWorldEvent({ t: 'npc_hit', id: n.id, a, y });
    n.stunTimer = 0.45;       
    const kf = Math.min(16, 5 + a * 0.09);
    n.kvx = (n.kvx || 0) + Math.sin(y) * kf * 0.5;
    n.kvz = (n.kvz || 0) + Math.cos(y) * kf * 0.5;
    return;
  }
  damageNpcBase(n, a, y);
  const dx = player.x - n.x, dz = player.z - n.z;
  if (dx * dx + dz * dz < 196) crime(a > 40 ? 0.45 : 0.25);
}

export const tmpV = new THREE.Vector3();
let netCopSeq = 0, netPcarSeq = 0;

export function buildCopMesh() {
  const gp_ = levelData.params.models.npc_guard;
  const m = buildNpcMeshRaw(colorToHex(gp_.shirtColor, 0x1d4ed8), colorToHex(gp_.pantsColor, 0x0b1220), null, { id: 900 + (netCopSeq % 50) });
  applyModelPreset('npc_guard', m);
  const cap = boxMesh(0.34, 0.1, 0.4, cachedStd(0x0b1220));
  cap.position.set(0, 1.78, 0.04);
  m.add(cap);
  const bd = boxMesh(0.08, 0.1, 0.02, cachedBasic(0xfacc15));
  bd.position.set(0.12, 1.3, 0.2);
  m.add(bd);
  if (m.userData && m.userData.armR) {
    const gunGroup = new THREE.Group();
    gunGroup.name = 'copPistol';
    const barrel = boxMesh(0.06, 0.08, 0.24, makeSharedMat(0x1e293b));
    barrel.position.set(0, -0.26, 0.10);
    const grip = boxMesh(0.05, 0.12, 0.06, makeSharedMat(0x0f172a));
    grip.position.set(0, -0.30, 0.03);
    gunGroup.add(barrel, grip);
    m.userData.armR.add(gunGroup);
  }
  return m;
}
export function makeCop(x, z) {
  const m = buildCopMesh();
  worldRoot.add(m);
  const c = { mesh: m, x, z, hp: 60, atk: 0, shoot: Math.random(), netId: 'cop' + (netCopSeq++) };
  m.position.set(x, computeSupportFloor(x, z, 2, 0.4), z);
  AO.cops.push(c);
  return c;
}
export function buildCopCarMesh() {
  const g = new THREE.Group();
  const dark = cachedStd(0x0b1220, { metalness: 0.7, roughness: 0.3 });
  const wh = cachedStd(0xf1f5f9, { roughness: 0.4 });
  const cabM = cachedStd(0x111827, { metalness: 0.9, roughness: 0.1 });
  const tireM = cachedStd(0x111111);
  const b = boxMesh(2, 0.75, 4.5, dark); b.position.y = 0.65; g.add(b);
  const d = boxMesh(2.04, 0.4, 2.2, wh); d.position.set(0, 0.6, 0); g.add(d);
  const cab = boxMesh(1.7, 0.6, 2.1, cabM); cab.position.set(0, 1.2, -0.2); g.add(cab);
  const lr = boxMesh(0.8, 0.18, 0.35, cachedBasic(0xff1f2f));
  const lb = boxMesh(0.8, 0.18, 0.35, cachedBasic(0x2f6bff));
  lr.position.set(0.45, 1.58, -0.2);
  lb.position.set(-0.45, 1.58, -0.2);
  g.add(lr, lb);
  const wheelGeo = sharedCylGeo(0.38, 0.38, 0.28, 14);
  for (const sx of [-1, 1]) for (const sz of [-1.4, 1.4]) {
    const w = new THREE.Mesh(wheelGeo, tireM);
    w.rotation.z = Math.PI / 2;
    w.position.set(sx * 1.02, 0.38, sz);
    g.add(w);
  }
  const driver = buildCopMesh();
  driver.scale.setScalar(0.72);
  driver.position.set(-0.4, 0.42, -0.15);
  if (driver.userData) {
    driver.userData.legL.rotation.x = -Math.PI / 2.2;
    driver.userData.legR.rotation.x = -Math.PI / 2.2;
    driver.userData.armL.rotation.x = -Math.PI / 3;
    driver.userData.armR.rotation.x = -Math.PI / 3;
  }
  g.add(driver);
  g.rotation.order = 'YXZ';
  return { group: g, lr, lb };
}
const _cylCache = new Map();
function sharedCylGeo(rt, rb, h, seg) {
  const key = `${rt}|${rb}|${h}|${seg}`;
  let g = _cylCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, h, seg);
    g.userData.shared = true;
    _cylCache.set(key, g);
  }
  return g;
}
export function makeCar(x, z) {
  const { group: g, lr, lb } = buildCopCarMesh();
  worldRoot.add(g);
  const car = { mesh: g, x, z, yaw: 0, sp: 0, hp: 220, lr, lb, stuck: 0, netId: 'pcar' + (netPcarSeq++) };
  AO.cars.push(car);
  return car;
}
export function removeCop(c) {
  worldRoot.remove(c.mesh);
  freeGeo(c.mesh);
  const i = AO.cops.indexOf(c);
  if (i !== -1) AO.cops.splice(i, 1);
}
function removeCopCar(car) {
  worldRoot.remove(car.mesh);
  freeGeo(car.mesh);
  const i = AO.cars.indexOf(car);
  if (i !== -1) AO.cars.splice(i, 1);
}
export function clearWantedLevel() {
  if (hooks.mpIsGuest()) return;          
  AO.heat = 0;
  AO.calm = 0;
  AO.spawnT = 4;
  for (let i = AO.cops.length - 1; i >= 0; i--) removeCop(AO.cops[i]);
  for (let i = AO.cars.length - 1; i >= 0; i--) removeCopCar(AO.cars[i]);
  const starsElement = document.getElementById('ao-stars');
  if (starsElement) starsElement.style.display = 'none';
  pushFeed('WANTED LEVEL CLEARED', 'border-l-sky-400');
}
export const tracerMat = new THREE.LineBasicMaterial({ color: 0xfff2a8 });
tracerMat.userData.shared = true;
export function tracer(x1, y1, z1, x2, y2, z2) {
  const g = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x1, y1, z1), new THREE.Vector3(x2, y2, z2)
  ]);
  const l = new THREE.Line(g, tracerMat);
  worldRoot.add(l);
  setTimeout(() => { worldRoot.remove(l); g.dispose(); }, 70);
}
export function hurtCop(c, a, creditId) {
  c.hp -= a;
  spawnParticles(c.x, c.mesh.position.y + 1.0, c.z, 0xdc2626, 6, 4);
  crime(0.15);
  if (c.hp <= 0) {
    const me = hooks.mpLocalId();
    if (!creditId || creditId === me) {
      gameState.cash += 40;
      pushFeed('OFFICER DOWN (+$40)', 'border-l-amber-400');
    } else {
      hooks.mpAward(creditId, 40);
    }
    crime(0.5);
    removeCop(c);
  }
}

let _starsEl = null, _starSpans = null, _lastStarCount = -1, _lastStarFlash = null;
export function updateWantedHud(t) {
  if (!_starsEl || !_starsEl.isConnected) {
    _starsEl = document.getElementById('ao-stars');
    _starSpans = null;
    _lastStarCount = -1;
    _lastStarFlash = null;
  }
  const st = _starsEl;
  if (!st) return;
  const n = stars();
  if (!_starSpans) {
    st.textContent = '';
    _starSpans = [];
    for (let i = 0; i < 5; i++) {
      const s = document.createElement('span');
      s.textContent = '★';
      s.style.color = '#475569';
      st.appendChild(s);
      _starSpans.push(s);
    }
  }
  const flash = Math.sin(t * 10) > 0;
  const shown = n > 0;
  if (st.style.display !== (shown ? 'flex' : 'none')) st.style.display = shown ? 'flex' : 'none';
  if (n === _lastStarCount && flash === _lastStarFlash) return;
  _lastStarCount = n;
  _lastStarFlash = flash;
  const lit = flash ? '#ef4444' : '#3b82f6';
  for (let i = 0; i < 5; i++) {
    const col = (i < n) ? lit : '#475569';
    if (_starSpans[i].style.color !== col) _starSpans[i].style.color = col;
  }
}

let _promptEl = null, _keyEl = null, _textEl = null;
let _lastPromptText = '', _lastPromptShown = null;
function jackPrompt(active, text) {
  if (!_promptEl || !_promptEl.isConnected) {
    _promptEl = document.getElementById('interact-prompt');
    _keyEl = document.getElementById('interact-key');
    _textEl = document.getElementById('interact-text');
  }
  if (!_promptEl) return;
  if (active) {
    if (_lastPromptShown !== true) { _promptEl.classList.remove('hidden'); _lastPromptShown = true; }
    if (_keyEl && _keyEl.textContent !== 'F') _keyEl.textContent = 'F';
    if (_textEl && _lastPromptText !== text) { _textEl.textContent = text; _lastPromptText = text; }
  } else {
    _lastPromptShown = null;
    _lastPromptText = '';
  }
}
function nearestJackableCar(maxDist) {
  if (gameState.inCar || meteorDrop.active || under()) return null;
  if (gameState.screen !== 'playing') return null;
  if (gameState.inventoryOpen || gameState.mapOpen || gameState.settingsOpen) return null;
  let best = null, bd2 = maxDist * maxDist;
  for (let i = 0; i < AO.cars.length; i++) {
    const c = AO.cars[i];
    if (Math.abs(c.sp) > 9) continue;
    const dx = player.x - c.x, dz = player.z - c.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bd2 && Math.abs(player.y - c.mesh.position.y) < 2.4) { bd2 = d2; best = c; }
  }
  return best;
}

function buildDrivableCruiser(x, z, yaw, y) {
  const v = buildSportsCar({
    name: 'POLICE CRUISER', bodyHex: 0x0b1220, accentHex: 0xf1f5f9,
    x, y, z, yaw, isCoupe: false, isSupercar: false
  });
  if (v.chassis) { v.root.remove(v.chassis); freeGeo(v.chassis); }
  for (const wp of v.wheelPivots) { v.root.remove(wp); freeGeo(wp); }
  v.wheelPivots.length = 0;
  v.wheelSpinners.length = 0;

  const bodyM = cachedMakeMat(0x0b1220, { isCarMetal: true, metalness: 0.66, roughness: 0.34, clearcoat: 0.7, flatShading: false });
  const panelM = cachedMakeMat(0xf1f5f9, { isCarMetal: true, metalness: 0.55, roughness: 0.36, clearcoat: 0.6, flatShading: false });
  const carbonM = cachedMakeMat(0x0f172a, { roughness: 0.5, metalness: 0.3 });
  const chromeM = cachedMakeMat(0xf8fafc, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.3, flatShading: false });
  const glassM = cachedMakeMat(0x38bdf8, {
    metalness: 0.25, roughness: 0.16, transparent: true, opacity: 0.24,
    depthWrite: false, side: THREE.DoubleSide, flatShading: false
  });
  const tireM = cachedMakeMat(0x111827, { roughness: 0.85, flatShading: false });
  const lampM = cachedMakeMat(0xfef9c3, { emissive: 0xfef08a, emissiveIntensity: 0.9 });
  const tailM = cachedMakeMat(0xef4444, { emissive: 0xdc2626, emissiveIntensity: 0.65 });

  const chassis = new THREE.Group();
  chassis.userData.studioName = 'Cruiser chassis';
  v.root.add(chassis);
  const add = (sx, sy, sz, m, px, py, pz, cast = true) => {
    const b = boxMesh(sx, sy, sz, m);
    b.position.set(px, py, pz);
    b.castShadow = cast;
    b.receiveShadow = true;
    chassis.add(b);
    return b;
  };

  const lowerY = 0.62, lowerH = 0.54;
  const doorFrontZ = 0.72, doorLen = 1.32;
  add(2.04, lowerH, 1.51, bodyM, 0, lowerY, 1.475);
  add(2.04, lowerH, 1.63, bodyM, 0, lowerY, -1.415);
  add(1.86, 0.14, 1.32, carbonM, 0, 0.42, 0.06, false);
  add(0.28, 0.42, 1.32, carbonM, 0, 0.56, 0.06, false);
  add(0.12, 0.14, 2.7, carbonM, -1.04, 0.34, 0, false);
  add(0.12, 0.14, 2.7, carbonM, 1.04, 0.34, 0, false);
  add(0.03, 0.20, 2.9, panelM, -1.03, 0.60, -0.1, false);
  add(0.03, 0.20, 2.9, panelM, 1.03, 0.60, -0.1, false);

  const cabinH = 0.86, cabinLen = 2.5, cabinZ = -0.05;
  const cabin = new THREE.Group();
  cabin.userData.studioName = 'Cruiser cabin';
  cabin.position.set(0, lowerY + lowerH / 2 + cabinH / 2 - 0.02, cabinZ);
  const roof = boxMesh(1.74, 0.09, cabinLen, bodyM);
  roof.position.y = cabinH / 2 - 0.045;
  roof.castShadow = true;
  cabin.add(roof);
  const pillarGeo = sharedBoxGeo(0.11, cabinH - 0.08, 0.11);
  for (const side of [-1, 1]) for (const end of [-1, 1]) {
    const p = new THREE.Mesh(pillarGeo, bodyM);
    p.position.set(side * 0.82, -0.02, end * (cabinLen / 2 - 0.06));
    p.castShadow = true;
    cabin.add(p);
  }
  const glassFront = new THREE.Mesh(new THREE.PlaneGeometry(1.48, cabinH * 0.74), glassM);
  glassFront.position.set(0, -0.015, cabinLen / 2 - 0.035);
  glassFront.rotation.x = -0.16;
  const glassRear = new THREE.Mesh(new THREE.PlaneGeometry(1.48, cabinH * 0.68), glassM);
  glassRear.position.set(0, -0.015, -cabinLen / 2 + 0.035);
  glassRear.rotation.y = Math.PI;
  cabin.add(glassFront, glassRear);
  chassis.add(cabin);

  function buildDoor(side) {
    const pivot = new THREE.Group();
    pivot.userData.studioName = side < 0 ? 'Left Door' : 'Right Door';
    pivot.position.set(side * 0.96, lowerY, doorFrontZ);
    const panel = boxMesh(0.12, lowerH, doorLen, panelM);
    panel.position.set(0, 0, -doorLen * 0.5);
    panel.castShadow = true;
    const trim = boxMesh(0.125, 0.045, doorLen, carbonM);
    trim.position.set(0, lowerH * 0.5 - 0.01, -doorLen * 0.5);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(doorLen - 0.12, cabinH * 0.62), glassM);
    glass.position.set(side * 0.01, lowerH * 0.5 + cabinH * 0.31, -doorLen * 0.5);
    glass.rotation.y = side * (Math.PI / 2);
    const handle = boxMesh(0.04, 0.045, 0.18, chromeM);
    handle.position.set(side * 0.065, lowerH * 0.5 - 0.09, -doorLen + 0.24);
    const badge = boxMesh(0.02, 0.16, 0.16, cachedMakeMat(0xfacc15, { metalness: 0.9, roughness: 0.25 }));
    badge.position.set(side * 0.07, 0.02, -doorLen * 0.5);
    const mirror = boxMesh(0.11, 0.075, 0.09, bodyM);
    mirror.position.set(side * 0.15, lowerH * 0.5 + 0.07, -0.14);
    pivot.add(panel, trim, glass, handle, badge, mirror);
    chassis.add(pivot);
    return pivot;
  }
  const doorL = buildDoor(-1), doorR = buildDoor(1);
  for (const side of [-1, 1]) {
    add(0.12, lowerH, 1.30, panelM, side * 0.96, lowerY, -1.25);
    const rg = new THREE.Mesh(new THREE.PlaneGeometry(1.18, cabinH * 0.6), glassM);
    rg.position.set(side * 0.97, lowerY + lowerH * 0.5 + cabinH * 0.31, -1.25);
    rg.rotation.y = side * (Math.PI / 2);
    chassis.add(rg);
  }

  add(1.34, 0.10, 0.36, carbonM, 0, 1.76, -0.2, false);
  const lr = boxMesh(0.58, 0.17, 0.32, cachedBasic(0xff1f2f));
  lr.position.set(0.33, 1.87, -0.2);
  const lb = boxMesh(0.58, 0.17, 0.32, cachedBasic(0x2f6bff));
  lb.position.set(-0.33, 1.87, -0.2);
  chassis.add(lr, lb);
  add(1.9, 0.12, 0.10, chromeM, 0, 0.58, 2.30);
  add(0.10, 0.50, 0.10, chromeM, -0.6, 0.48, 2.30);
  add(0.10, 0.50, 0.10, chromeM, 0.6, 0.48, 2.30);
  add(1.42, 0.24, 0.08, carbonM, 0, 0.52, 2.24, false);
  add(0.44, 0.14, 0.08, lampM, -0.68, 0.66, 2.24, false);
  add(0.44, 0.14, 0.08, lampM, 0.68, 0.66, 2.24, false);
  add(0.56, 0.14, 0.08, tailM, -0.64, 0.68, -2.24, false);
  add(0.56, 0.14, 0.08, tailM, 0.64, 0.68, -2.24, false);
  add(1.88, 0.22, 0.14, carbonM, 0, 0.36, -2.23, false);
  const spot = new THREE.Mesh(sharedCylGeo(0.07, 0.09, 0.12, 10), chromeM);
  spot.rotation.z = Math.PI / 2;
  spot.position.set(-0.92, 1.32, 0.86);
  chassis.add(spot);

  add(1.62, 0.15, 0.42, carbonM, 0, 0.97, 0.76, false);
  const laptop = boxMesh(0.30, 0.20, 0.04, cachedMakeMat(0x22d3ee, { emissive: 0x0891b2, emissiveIntensity: 0.8 }));
  laptop.position.set(0.24, 1.10, 0.62);
  laptop.rotation.x = -0.35;
  chassis.add(laptop);
  for (const side of [-1, 1]) {
    const cushion = boxMesh(0.48, 0.12, 0.52, carbonM);
    cushion.position.set(side * 0.4, 0.83, -0.26);
    const back = boxMesh(0.48, 0.38, 0.12, carbonM);
    back.position.set(side * 0.4, 1.07, -0.50);
    chassis.add(cushion, back);
  }
  const benchC = boxMesh(1.32, 0.12, 0.5, carbonM);
  benchC.position.set(0, 0.83, -0.86);
  const benchB = boxMesh(1.32, 0.38, 0.12, carbonM);
  benchB.position.set(0, 1.07, -1.08);
  chassis.add(benchC, benchB);

  const steer = new THREE.Group();
  steer.userData.studioName = 'Steering assembly';
  steer.position.set(-0.42, 1.14, 0.54);
  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.035, 8, 20), carbonM);
  steer.add(wheelRim);
  const hub = new THREE.Mesh(sharedCylGeo(0.055, 0.055, 0.09, 8), chromeM);
  hub.rotation.x = Math.PI / 2;
  steer.add(hub);
  for (let s = 0; s < 3; s++) {
    const bar = boxMesh(0.035, 0.22, 0.035, chromeM);
    bar.rotation.z = s * Math.PI * 2 / 3;
    steer.add(bar);
  }
  chassis.add(steer);

  const tireGeo = sharedCylGeo(0.38, 0.38, 0.28, 18);
  const rimGeo = sharedCylGeo(0.24, 0.24, 0.295, 14);
  [[-0.98, 0.38, 1.38], [0.98, 0.38, 1.38], [-0.98, 0.38, -1.38], [0.98, 0.38, -1.38]]
    .forEach(([wx, wy, wz], idx) => {
      const steerPivot = new THREE.Group();
      steerPivot.userData.studioName = `${idx < 2 ? 'Front' : 'Rear'} ${idx % 2 === 0 ? 'left' : 'right'} wheel`;
      steerPivot.position.set(wx, wy, wz);
      const spin = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, tireM);
      tire.rotation.z = Math.PI / 2;
      tire.castShadow = true;
      const rim = new THREE.Mesh(rimGeo, chromeM);
      rim.rotation.z = Math.PI / 2;
      spin.add(tire, rim);
      steerPivot.add(spin);
      v.root.add(steerPivot);
      v.wheelPivots.push(steerPivot);
      v.wheelSpinners.push(spin);
    });

  const flameL = new THREE.Group(); flameL.visible = false; flameL.position.set(-0.52, 0.34, -2.35);
  const flameR = new THREE.Group(); flameR.visible = false; flameR.position.set(0.52, 0.34, -2.35);
  chassis.add(flameL, flameR);

  v.chassis = chassis;
  v.doorLeftPivot = doorL;
  v.doorRightPivot = doorR;
  v.steeringPivot = steer;
  v.flameL = flameL;
  v.flameR = flameR;
  v.windowMaterial = glassM;
  v.lr = lr;
  v.lb = lb;
  v.isPolice = true;
  v.name = 'POLICE CRUISER';
  v.root.userData.studioName = 'POLICE CRUISER';
  return v;
}

function carjackCopCar(car) {
  if (!car) return false;
  const cx = car.x, cz = car.z, cyaw = car.yaw;
  const cy = car.mesh.position.y;
  const sideX = Math.cos(cyaw), sideZ = -Math.sin(cyaw);
  const ejected = makeCop(cx - sideX * 2.2, cz - sideZ * 2.2);
  if (ejected) {
    ejected.atk = 0.6;
    ejected.shoot = 1.1;
    ejected.mesh.rotation.z = 0.35;
  }
  spawnParticles(cx - sideX * 1.4, cy + 1.0, cz - sideZ * 1.4, 0xf8fafc, 8, 4.5);
  sfx.metalClang();
  removeCopCar(car);
  const v = buildDrivableCruiser(cx, cz, cyaw, cy);
  v.gearIndex = 2;
  v.rpm = 1150;
  v.speed = 0;
  v.velX = 0;
  v.velZ = 0;
  const idx = vehicles.indexOf(v);
  if (!hooks.mpIsGuest()) crime(0.5);
  hooks.mpWorldEvent({ t: 'cop_carjack', netId: car.netId, x: cx, z: cz, yaw: cyaw });
  pushFeed('OFFICER YANKED FROM THE CRUISER — VEHICLE COMMANDEERED', 'border-l-rose-500');
  if (idx >= 0) enterVehicle(idx);
  return true;
}

let _jackKeyBound = false;
function bindCarjackKey() {
  if (_jackKeyBound) return;
  _jackKeyBound = true;
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyF' || e.repeat) return;
    const tag = e.target && e.target.tagName;
    if (tag && /INPUT|TEXTAREA|SELECT/.test(tag)) return;
    const car = nearestJackableCar(3.4);
    if (!car) return;
    e.preventDefault();
    e.stopPropagation();
    carjackCopCar(car);
  }, true);
}
bindCarjackKey();

export function copFrame(dt, t) {
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    if (!v.isPolice || !v.lr || !v.lb) continue;
    const fl = Math.sin(t * 14) > 0;
    v.lr.visible = fl;
    v.lb.visible = !fl;
  }

  if (hooks.mpIsGuest()) {
    hooks.mpGuestCopFrame(dt, t);
    updateWantedHud(t);
    jackPrompt(false);
    return;
  }

  const s = stars(), pu = under();
  const targets = fillTargets('all');

  const hitTarget = (tp, amount, label) => {
    if (tp.local) hooks.applyPlayerDamage(amount, label);
    else hooks.mpHitPlayer(tp.id, amount, label);
  };

  if (s > 0 && !pu) {
    AO.spawnT -= dt;
    const wantF = Math.min(4, s + 1);
    const wantC = s >= 2 ? Math.min(2, Math.floor(s / 2)) : 0;
    if (AO.spawnT <= 0) {
      AO.spawnT = 3.2;
      const anchor = targets[Math.floor(Math.random() * targets.length)];
      const a = Math.random() * 6.28, r = 65 + Math.random() * 30;
      const x = anchor.x + Math.cos(a) * r, z = anchor.z + Math.sin(a) * r;
      const B = WORLD_BOUNDS;
      const inBounds = B && Number.isFinite(B.minX)
        ? (x > B.minX + 6 && x < B.maxX - 6 && z > B.minZ + 6 && z < B.maxZ - 6)
        : (x > -130 && x < 360 && z > -165 && z < 200);
      if (inBounds && !collidesHorizontally(x, z, 0.2, 1.8, 1.5)) {
        if (AO.cops.length < wantF) makeCop(x, z);
        else if (AO.cars.length < wantC) makeCar(x, z);
      }
    }
  }

  AO.calm += dt;
  let nearestAny = 99;
  for (let i = 0; i < AO.cops.length; i++) {
    const c = AO.cops[i];
    nearestAny = Math.min(nearestAny, nearestTo(c.x, c.z).dist);
  }
  for (let i = 0; i < AO.cars.length; i++) {
    const c = AO.cars[i];
    nearestAny = Math.min(nearestAny, nearestTo(c.x, c.z).dist);
  }
  const localTgt = targets[0];
  const isHiding = localTgt && localTgt.crouching && nearestAny > 14;
  const calmThreshold = isHiding ? 3.0 : 5.5;
  if (AO.calm > calmThreshold && nearestAny > 22) {
    const hideMult = isHiding ? 2.5 : 1.0;
    AO.heat = Math.max(0, AO.heat - dt * (nearestAny > 45 ? 0.35 : 0.18) * hideMult);
  }
  if (pu) AO.heat = Math.max(0, AO.heat - dt * 0.25);

  if (player.attackTimer > 0 && !player._copHit && (1 - player.attackTimer / player.attackDuration) >= 0.42) {
    player._copHit = true;
    const fx = Math.sin(player.yaw + Math.PI), fz = Math.cos(player.yaw + Math.PI);
    const dmg = (RIGHT_WEAPONS[gameState.activeRightWeapon] || { damage: 18 }).damage;
    for (let i = AO.cops.length - 1; i >= 0; i--) {
      const c = AO.cops[i];
      const dx = c.x - player.x, dz = c.z - player.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 8.41 && Math.abs(player.y - c.mesh.position.y) < 2.5
        && (dx * fx + dz * fz) / Math.max(0.1, Math.sqrt(d2)) > 0.2) {
        hurtCop(c, dmg);
      }
    }
  }
  AO.lastAtk -= dt;
  for (let wi = 0; wi < projectileWieners.length; wi++) {
    const w = projectileWieners[wi];
    if (w.copHit) continue;
    for (let i = AO.cops.length - 1; i >= 0; i--) {
      const c = AO.cops[i];
      const dx = w.x - c.x, dz = w.z - c.z;
      if (dx * dx + dz * dz < 1 && w.y < c.mesh.position.y + 2 && w.y > c.mesh.position.y - 0.2) {
        w.copHit = 1;
        hurtCop(c, RIGHT_WEAPONS.hotdog_shooter.damage, w.by);
        break;
      }
    }
  }

  for (let i = AO.cops.length - 1; i >= 0; i--) {
    const c = AO.cops[i];
    const { tgt, dist: d } = nearestTo(c.x, c.z);
    const dx = tgt.x - c.x, dz = tgt.z - c.z;
    const dd = Math.hypot(dx, dz) || 1;
    const py = tgt.inCar ? (tgt.carY === undefined ? tgt.y : tgt.carY) : tgt.y;
    if (pu || s === 0) {
      c.mesh.visible = true;
      if (s === 0 && d > 60) { removeCop(c); continue; }
    }
    const isSearching = tgt.crouching && d > 12;
    const want = isSearching ? 2.2 : (d > (tgt.inCar ? 6 : 8) ? 4.2 : 0);
    const vx = dx / dd * want * dt, vz = dz / dd * want * dt;
    if (!collidesHorizontally(c.x + vx, c.z, 0.2, 1.7, 0.4)) c.x += vx;
    if (!collidesHorizontally(c.x, c.z + vz, 0.2, 1.7, 0.4)) c.z += vz;
    const copGround = computeSupportFloor(c.x, c.z, c.mesh.position.y + 0.6, 0.4);
    c.mesh.position.set(c.x, copGround + Math.abs(Math.sin(t * 9 + c.x)) * 0.04 * (want > 0), c.z);
    c.mesh.rotation.y = Math.atan2(dx, dz);
    const u = c.mesh.userData;
    if (u && u.armR && u.armL) {
      if (d < 28 && !pu && s > 0 && !isSearching) {
        const dy = (py + 1.1) - (c.mesh.position.y + 1.4);
        const pitchAngle = Math.atan2(dy, Math.max(0.1, dd));
        u.armR.rotation.order = 'YXZ';
        u.armR.rotation.x = -Math.PI / 2 + pitchAngle;
        u.armR.rotation.y = 0;
        u.armR.rotation.z = -0.08;
        u.armL.rotation.order = 'YXZ';
        u.armL.rotation.x = -1.1 + pitchAngle * 0.5;
        u.armL.rotation.y = 0.25;
        u.armL.rotation.z = 0.35;
      } else {
        const sw = want > 0 ? Math.sin(t * 8 + c.x) * 0.5 : 0;
        u.armR.rotation.order = 'XYZ';
        u.armR.rotation.x = -sw; u.armR.rotation.y = 0; u.armR.rotation.z = 0;
        u.armL.rotation.order = 'XYZ';
        u.armL.rotation.x = sw; u.armL.rotation.y = 0; u.armL.rotation.z = 0;
      }
    }
    c.shoot -= dt;
    c.atk -= dt;
    if (d < 2.0 && c.atk <= 0 && Math.abs(py - c.mesh.position.y) < 2.5) {
      c.atk = 1.3;
      hitTarget(tgt, 6, 'OFFICER BATON');
    } else if (d < 18 && d > 2.0 && c.shoot <= 0 && Math.abs(py - c.mesh.position.y) < 4 && !isSearching) {
      c.shoot = 1.6 + Math.random() * 0.8;
      tracer(
        c.x, c.mesh.position.y + 1.3, c.z,
        tgt.x + (Math.random() - 0.5) * 1.2, tgt.y + 1, tgt.z + (Math.random() - 0.5) * 1.2
      );
      if (Math.random() < 0.28) hitTarget(tgt, Math.max(2, 3 + s * 0.6), 'POLICE FIRE');
    }
  }

  for (let i = AO.cars.length - 1; i >= 0; i--) {
    const c = AO.cars[i];
    const { tgt, dist: d } = nearestTo(c.x, c.z);
    const dx = tgt.x - c.x, dz = tgt.z - c.z;
    const dd = Math.hypot(dx, dz) || 1;
    const want = Math.atan2(dx, dz);
    let dy = want - c.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    c.yaw += Math.max(-2.2 * dt, Math.min(2.2 * dt, dy * 3 * dt)) * (c.sp > 3 ? 1 : 2);
    const tgtSp = d > 14 ? (22 + s * 2) : (d > 7 ? 8 : 0);
    c.sp += (tgtSp - c.sp) * Math.min(1, dt * 1.2);
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    const sl = (terrainH(c.x + fx * 2, c.z + fz * 2) - terrainH(c.x, c.z)) / 2;
    if (sl > 0 && sl < 5) c.sp -= 9.8 * sl * dt * 0.8;
    const nx = c.x + fx * c.sp * dt, nz = c.z + fz * c.sp * dt;
    if (collidesHorizontally(nx, nz, 0.3, 1.2, 1.5)) {
      c.sp *= -0.3; c.yaw += 0.6; c.stuck += dt;
    } else {
      c.x = nx; c.z = nz; c.stuck = Math.max(0, c.stuck - dt);
    }
    const gy = computeSupportFloor(c.x, c.z, 1.4, 1.2);
    c.mesh.position.set(c.x, gy + 0.02, c.z);
    c.mesh.rotation.y = c.yaw;
    c.mesh.rotation.x = -Math.atan2(
      terrainH(c.x + fx * 2, c.z + fz * 2) - terrainH(c.x - fx * 2, c.z - fz * 2), 4
    ) * (c.z < -170 ? 1 : 0);
    const fl = Math.sin(t * 14) > 0;
    c.lr.visible = fl;
    c.lb.visible = !fl;
    if (d < 3.3 && !pu && Math.abs(c.sp) > 5) {
      hitTarget(tgt, 8, 'POLICE RAM');
      c.sp *= 0.4;
      if (tgt.local && gameState.inCar) {
        const v = vehicles[gameState.activeCarIndex];
        if (v) v.speed *= 0.7;
      }
    }
    for (let vi = 0; vi < vehicles.length; vi++) {
      const v = vehicles[vi];
      const drivenLocal = gameState.inCar && gameState.activeCarIndex === vi;
      const owner = hooks.mpCarOwner ? hooks.mpCarOwner(vi) : null;
      if (!drivenLocal && !(owner && owner !== hooks.mpLocalId())) continue;
      const vdx = v.x - c.x, vdz = v.z - c.z;
      if (vdx * vdx + vdz * vdz < 9 && Math.abs(v.speed) > 7) {
        c.hp -= Math.abs(v.speed) * 5;
        v.speed *= 0.8;
        spawnParticles(c.x, c.mesh.position.y + 0.8, c.z, 0xf59e0b, 8, 6);
      }
    }
    if (c.hp <= 0 || c.stuck > 6 || (s === 0 && d > 90)) {
      spawnParticles(c.x, c.mesh.position.y + 0.8, c.z, 0xf97316, 16, 8);
      removeCopCar(c);
    }
  }

  const jack = nearestJackableCar(3.4);
  jackPrompt(Boolean(jack), 'PULL OFFICER OUT & TAKE CRUISER');

  updateWantedHud(t);
}

export const rats = [];
export const ratG = sharedBoxGeo(0.22, 0.16, 0.5);
export const ratTG = sharedBoxGeo(0.03, 0.03, 0.35);
export const ratM = cachedStd(0x3b332c, { roughness: 1 });
export let ratHit = 0;

export function buildSewerRats() {
  [[-110, -30], [-70, -30], [-20, -30], [34, -30], [100, -30], [20, -50], [20, -10], [20, 50], [20, 85], [0, 24]]
    .forEach((q, i) => {
      if (!sewerOK(q[0], q[1], 0.3)) return;
      const m = new THREE.Mesh(ratG, ratM);
      const tl = new THREE.Mesh(ratTG, ratM);
      tl.position.z = -0.38;
      m.add(tl);
      m.position.set(q[0], SFY + 0.1, q[1]);
      worldRoot.add(m);
      rats.push({ mesh: m, x: q[0], z: q[1], hx: q[0], hz: q[1], bite: 0, ph: i * 1.7, dead: false });
    });
}
export function reviveRats() {
  for (const r of rats) {
    r.dead = false;
    r.x = r.hx;
    r.z = r.hz;
    r.mesh.visible = true;
  }
}
export function killRat(r, creditId) {
  if (r.dead) return;
  r.dead = true;
  r.mesh.visible = false;
  spawnParticles(r.x, SFY + 0.3, r.z, 0x7c2d12, 6, 3);
  const me = hooks.mpLocalId();
  if (!creditId || creditId === me) gameState.cash += 5;
  else hooks.mpAward(creditId, 5);
  sfx.hit();
}
export function ratFrame(dt, t) {
  if (hooks.mpIsGuest()) { hooks.mpGuestRatFrame(dt, t); return; }
  if (!under() || climb.on) return;
  if (Math.random() < dt * 0.5) sfx.tone(1500 + Math.random() * 500, 800, 0.06, 'sine', 0.025);
  const swing = player.attackTimer > 0 && ratHit <= 0;
  if (swing) ratHit = 0.4;
  ratHit -= dt;
  const fx = Math.sin(player.yaw + Math.PI), fz = Math.cos(player.yaw + Math.PI);
  const targets = fillTargets('sewer');

  for (let ri = 0; ri < rats.length; ri++) {
    const r = rats[ri];
    if (r.dead) continue;
    let tgt = targets[0], bd2 = Infinity;
    for (let i = 0; i < targets.length; i++) {
      const tp = targets[i];
      const tdx = tp.x - r.x, tdz = tp.z - r.z;
      const d2 = tdx * tdx + tdz * tdz;
      if (d2 < bd2) { bd2 = d2; tgt = tp; }
    }
    const dx = tgt.x - r.x, dz = tgt.z - r.z;
    const d = Math.hypot(dx, dz) || 1;
    let tx, tz, sp;
    if (d < 14) { tx = dx / d; tz = dz / d; sp = d > 0.9 ? 4.6 : 0; }
    else { tx = Math.sin(t * 0.7 + r.ph); tz = Math.cos(t * 0.5 + r.ph); sp = 1.2; }
    const nx = r.x + tx * sp * dt, nz = r.z + tz * sp * dt;
    if (sewerOK(nx, nz, 0.2)) { r.x = nx; r.z = nz; }
    r.mesh.position.set(r.x, SFY + 0.1 + Math.abs(Math.sin(t * 14 + r.ph)) * 0.04, r.z);
    r.mesh.rotation.y = Math.atan2(tx, tz);
    r.bite -= dt;
    if (d < 1 && r.bite <= 0 && Math.abs(tgt.y - SFY) < 2) {
      r.bite = 1;
      if (tgt.local) hooks.applyPlayerDamage(3, 'SEWER RAT');
      else hooks.mpHitPlayer(tgt.id, 3, 'SEWER RAT');
      sfx.tone(1800, 1200, 0.05, 'square', 0.03);
    }
    const localHit = tgt.local && swing && d < 2.6 && (dx * fx + dz * fz) / d > 0.2;
    let hitW = null;
    for (let wi = 0; wi < projectileWieners.length; wi++) {
      const w = projectileWieners[wi];
      if (w.ratHit) continue;
      const wdx = w.x - r.x, wdz = w.z - r.z;
      if (wdx * wdx + wdz * wdz < 0.64 && Math.abs(w.y - (SFY + 0.2)) < 1.2) { hitW = w; break; }
    }
    if (localHit || hitW) {
      if (hitW) hitW.ratHit = 1;
      killRat(r, hitW ? hitW.by : undefined);
      hooks.mpWorldEvent({ t: 'rat_dead', i: ri });
    }
  }
}

Object.assign(hooks, { damageNpc });