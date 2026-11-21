// =============================================================================
// npcs.js — Clans, NPC roster, NPC mesh builders, AI, pickpocketing, police/wanted level and sewer rats.
// =============================================================================
import * as THREE from 'three';
import { colorToHex, levelData } from './levelData.js';
import { AO, SFY, climb, collidesHorizontally, computeSupportFloor, crime, flashEdge, gameState, hooks, keys, meteorDrop, npcs, pick, player, projectileWieners, pushFeed, rnd, sewerOK, stars, terrainH, under, worldBoxes } from './state.js';
import { camera, makeMat, makeSharedMat, scene, worldRoot } from './engine.js';
import { applyModelPreset } from './assets.js';
import { sfx } from './audio.js';
import { RIGHT_WEAPONS, addLeftItemToBag, freeGeo, spawnParticles } from './items.js';
import { vehicles } from './vehicles.js';

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
  }
};

export const NPC_ROSTER = [
  // Civilian Shopkeepers & Guards (Fight back if attacked!)
  { name: 'DEALER VANCE', role: 'stationary', aggro: 'fighter', x: -5.6, z: -53.6, yaw: 0, shirt: 0x0284c7, pants: 0x0f172a, line: '"Take the Aura Apex GT Supercar out for a spin! Downshift [K] to spit exhaust flames!"' },
  { name: 'HOTDOG VENDOR', role: 'stationary', aggro: 'fighter', x: -39.9, z: -41.1, yaw: 0, shirt: 0xdc2626, pants: 0xf8fafc, line: '"Grab the Ballistic Hotdog Shooter in the back! Refill sausages at the vat or Plaza Cart!"' },
  { name: 'BANK TELLER MARCUS', role: 'stationary', aggro: 'passive', x: -1.8, z: -98.3, yaw: 0, shirt: 0x1e3a8a, pants: 0x0f172a, line: '"Welcome to Sunnyvale Reserve Bank. Our vault is open for inspection."' },
  { name: 'BANK GUARD REYES', role: 'stationary', aggro: 'fighter', x: 3.1, z: -92.5, yaw: -0.35, shirt: 0x0284c7, pants: 0x1e293b, line: '"Keep it peaceful inside the Reserve Bank, citizen."' },
  { name: 'OUTPOST ATTENDANT', role: 'stationary', aggro: 'fighter', x: 254.0, z: 81.5, yaw: 0, shirt: 0xd97706, pants: 0x1e293b, line: '"Watch out for the Redrock Scorpions around the desert outpost!"' },
  { name: 'PLAZA JOGGER MAYA', role: 'patrol', aggro: 'passive', x: -8.0, z: 10.0, yaw: 1.57, shirt: 0x10b981, pants: 0x1e293b, line: '"Central Plaza is a neutral safe zone—and there is a hotdog cart right across the fountain!"' },
  { name: 'DOCKWORKER HANK', role: 'patrol', aggro: 'fighter', x: 33.0, z: 34.0, yaw: 0, shirt: 0x0d9488, pants: 0x1e3a8a, line: '"Careful in the Harbor Yard—the Redrock Scorpions guard those containers!"' },
  { name: 'NEIGHBOR SAM', role: 'patrol', aggro: 'passive', x: -12.0, z: 35.0, yaw: -1.57, shirt: 0x7c3aed, pants: 0x1e293b, line: '"Crouching [C] keeps you low-profile and catches your breath three times faster."' },
  { name: 'COURIER LEO', role: 'patrol', aggro: 'fighter', x: -64.0, z: 16.5, yaw: 1.57, shirt: 0x2563eb, pants: 0x0f172a, line: '"Downtown is Neon Vipers turf—they hunt anyone trespassing on their blocks!"' },

  // NEON VIPERS CLAN (Downtown Skyscraper District)
  { name: 'VIPER LOOKOUT JAX', role: 'clan', clanId: 'neon_vipers', x: -42.0, z: -86.0, yaw: 0, line: '"NEON VIPER: Who let you into Downtown?! Get him!"' },
  { name: 'VIPER ENFORCER KIRA', role: 'clan', clanId: 'neon_vipers', x: 38.0, z: -88.0, yaw: Math.PI, line: '"NEON VIPER: Spotter confirmed—swarm the intruder!"' },
  { name: 'VIPER RUNNER ZED', role: 'clan', clanId: 'neon_vipers', x: -16.0, z: -122.0, yaw: 1.57, line: '"NEON VIPER: Nobody walks through Viper territory uninvited!"' },
  { name: 'VIPER CAPTAIN NYX', role: 'clan', clanId: 'neon_vipers', x: 46.0, z: -128.0, yaw: -1.57, line: '"NEON VIPER: Lock down the block! Corner them!"' },

  // REDROCK SCORPIONS CLAN (Harbor Yard & Redrock Desert)
  { name: 'SCORPION GUARD ROCCO', role: 'clan', clanId: 'redrock_scorpions', x: 40.0, z: 40.0, yaw: -1.57, line: '"SCORPION: This harbor yard belongs to the Redrock Scorpions!"' },
  { name: 'SCORPION BRAWLER TAZ', role: 'clan', clanId: 'redrock_scorpions', x: 52.0, z: 52.0, yaw: 3.14, line: '"SCORPION: Intruder spotted by the containers! Beat him down!"' },
  { name: 'SCORPION RAIDER VEX', role: 'clan', clanId: 'redrock_scorpions', x: 246.0, z: 86.0, yaw: -1.57, line: '"SCORPION: You wandered into Redrock desert turf!"' },
  { name: 'SCORPION SCOUT DRAKE', role: 'clan', clanId: 'redrock_scorpions', x: 274.0, z: 96.0, yaw: 0, line: '"SCORPION: Sound the alarm—outsider on Route 66!"' },

  // IRON JACKALS CLAN (Westside & Brickwood Blocks)
  { name: 'JACKAL PATROL COLE', role: 'clan', clanId: 'iron_jackals', x: -84.0, z: -42.0, yaw: 1.57, line: '"IRON JACKAL: Wrong neighborhood, pal! Get him!"' },
  { name: 'JACKAL BRUISER GRIT', role: 'clan', clanId: 'iron_jackals', x: -88.0, z: -10.0, yaw: 0, line: '"IRON JACKAL: Eyes sharp—someone is sneaking through Westside!"' },
  { name: 'JACKAL SENTRY FANG', role: 'clan', clanId: 'iron_jackals', x: 42.0, z: -38.0, yaw: -1.57, line: '"IRON JACKAL: Brickwood is Jackal territory! Take him out!"' }
];

export function buildNpcMeshLegacy(shirtColor, pantsColor, bandanaColor = null) {
  const root = new THREE.Group();
  const hip = new THREE.Group();
  hip.position.y = 0.90;
  root.add(hip);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.54, 0.22), makeMat(shirtColor));
  torso.position.y = 0.27;
  torso.castShadow = true;

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.24), makeMat(0xd99b72));
  head.position.y = 0.68;
  head.castShadow = true;

  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.26), makeMat(0x1c1917));
  hair.position.y = 0.80;

  if (bandanaColor !== null) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.06, 0.27), makeMat(bandanaColor));
    band.position.y = 0.75;
    hip.add(band);
  }

  const armGeo = new THREE.BoxGeometry(0.11, 0.50, 0.11);
  const legGeo = new THREE.BoxGeometry(0.14, 0.72, 0.14);

  const armL = new THREE.Mesh(armGeo, makeMat(shirtColor));
  armL.position.set(-0.29, 0.26, 0);
  const armR = armL.clone();
  armR.position.x = 0.29;

  const legL = new THREE.Mesh(legGeo, makeMat(pantsColor));
  legL.position.set(-0.12, -0.36, 0);
  const legR = legL.clone();
  legR.position.x = 0.12;

  hip.add(torso, head, hair, armL, armR, legL, legR);
  root.userData = { hip, torso, armL, armR, legL, legR };
  return root;
}

NPC_ROSTER.push(...makeExtraRoster());

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
    yaw: def.yaw,
    shirt: clan ? clan.shirt : def.shirt,
    pants: clan ? clan.pants : def.pants,
    bandana: clan ? clan.bandana : null,
    line: def.line,
    age: def.age || 'adult', skin: def.skin, hair: def.hair, wallet: 0, picked: false, pickCool: 0, fleeTimer: 0, kvx: 0, kvz: 0,
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
    sleepZGroup: null
  });
});

export function buildSleepZzzGroup() {
  const g = new THREE.Group();
  const zMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
  const z1 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.05), zMat);
  z1.position.set(-0.14, 0, 0);
  const z2 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.05), zMat);
  z2.position.set(0.02, 0.22, 0);
  const z3 = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.07, 0.05), zMat);
  z3.position.set(0.18, 0.48, 0);
  g.add(z1, z2, z3);
  return g;
}

export function damageNpcBase(npc, amount, knockYaw) {
  if (!npc || npc.asleep) return;
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
      zzz.position.set(npc.x, 0.85, npc.z);
      worldRoot.add(zzz);
      npc.sleepZGroup = zzz;
    }
    if (!npc.picked) { const lt = lootFor(npc, 0.5); npc.picked = true; npc.pickCool = 90; if (lt > 0) { gameState.cash += lt; pushFeed(`+$${lt} FROM ${npc.name}'S POCKETS`, 'border-l-emerald-400'); } }
    sfx.sleepChime();
    pushFeed(`${npc.name} WENT TO SLEEP! (Zzz)`, 'border-l-sky-400');
    return;
  }

  if (npc.aggro === 'passive') npc.fleeTimer = 8;
  if (npc.aggro === 'fighter' || npc.aggro === 'clan' || npc.aggro === 'thug') {
    if (!npc.hostile) {
      npc.hostile = true;
      npc.alertState = 'chasing';
      pushFeed(`${npc.name} IS FIGHTING BACK!`, 'border-l-rose-500');
    }
    if (npc.clanId) {
      for (const ally of npcs) {
        if (ally.clanId === npc.clanId && !ally.asleep && Math.hypot(ally.x - npc.x, ally.z - npc.z) < 34) {
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
export function updateNPCs(dt, elapsed) {
const SPAWN_DIST = 82;
const DESPAWN_DIST = 130;
  let currentClanAlert = '';

  for (const clan of Object.values(CLAN_DEFS)) {
    if (clan.inTurf(player.x, player.z)) {
      currentClanAlert = `${clan.name} TERRITORY — THEY ARE LOOKING FOR INTRUDERS!`;
      break;
    }
  }

  for (let i = 0; i < npcs.length; i++) {
    const npc = npcs[i];
    const distToPlayer = Math.hypot(npc.x - player.x, npc.z - player.z);

    if (!npc.spawned && distToPlayer < SPAWN_DIST) {
if (!npc.queued) { npc.queued = true; npcSpawnQueue.push(npc); }
continue;
} else if (npc.spawned && distToPlayer > DESPAWN_DIST) {
worldRoot.remove(npc.mesh);
freeGeo(npc.mesh);
npc.mesh = null;
if (npc.sleepZGroup) {
worldRoot.remove(npc.sleepZGroup);
freeGeo(npc.sleepZGroup);
npc.sleepZGroup = null;
}
npc.spawned = false;
continue;
}
    if (!npc.spawned || !npc.mesh) continue;

    if (Math.abs(npc.kvx) + Math.abs(npc.kvz) > 0.05) {
      const kx = npc.x + npc.kvx * dt, kz = npc.z + npc.kvz * dt;
      if (!npcBlocked(kx, kz)) { npc.x = kx; npc.z = kz; } else { npc.kvx = 0; npc.kvz = 0; }
      const dec = Math.exp(-7 * dt);
      npc.kvx *= dec; npc.kvz *= dec;
    }
    if (npc.asleep) {
      npc.sleepTimer -= dt;
      npc.mesh.position.set(npc.x, 0.34, npc.z);
      npc.mesh.rotation.order = 'YXZ';
      npc.mesh.rotation.y = npc.yaw;
      npc.mesh.rotation.x = -Math.PI / 2;
      npc.mesh.rotation.z = 0;
      npc.mesh.userData.legL.rotation.x = 0.08;
      npc.mesh.userData.legR.rotation.x = -0.06;
      npc.mesh.userData.armL.rotation.x = 0.15;
      npc.mesh.userData.armR.rotation.x = -0.15;

      if (npc.sleepZGroup) {
        npc.sleepZGroup.position.set(
          npc.x,
          0.78 + Math.sin(elapsed * 2.4 + npc.id) * 0.14,
          npc.z
        );
        npc.sleepZGroup.lookAt(camera.position);
      }

      if (npc.sleepTimer <= 0) {
        npc.asleep = false;
        npc.hostile = false;
        npc.alertState = 'patrol';
        npc.hp = npc.maxHp;
        npc.mesh.rotation.x = 0;
        npc.mesh.position.y = 0.18;
        if (npc.sleepZGroup) {
          worldRoot.remove(npc.sleepZGroup);
          npc.sleepZGroup = null;
        }
      }
      continue;
    }

    npc.mesh.rotation.x = 0;
    if (npc.attackCooldown > 0) npc.attackCooldown -= dt;
    if (npc.punchTimer > 0) npc.punchTimer -= dt;

    if (npc.stunTimer > 0) {
      npc.stunTimer -= dt;
      npc.mesh.rotation.z = Math.sin(elapsed * 24) * 0.22;
      continue;
    }
    npc.mesh.rotation.z = 0;

    if (npc.aggro === 'clan' && !meteorDrop.active) {
      const clan = CLAN_DEFS[npc.clanId];
      const playerInMyTurf = clan && clan.inTurf(player.x, player.z);
      const detectRadius = player.crouching ? 11.5 : 23.0;

      if (playerInMyTurf && distToPlayer < detectRadius && Math.abs(player.y - 0.18) < 4.5) {
        if (npc.alertState !== 'chasing') {
          npc.alertState = 'chasing';
          npc.hostile = true;
          pushFeed(`${npc.line.replace(/"/g, '')}`, 'border-l-rose-500');
        }
        npc.searchX = player.x;
        npc.searchZ = player.z;
        npc.searchTimer = 7.5;
      } else if (playerInMyTurf && distToPlayer < 44.0 && npc.alertState === 'patrol') {
        npc.alertState = 'searching';
        npc.searchX = player.x + (Math.random() - 0.5) * 14;
        npc.searchZ = player.z + (Math.random() - 0.5) * 14;
        npc.searchTimer = 6.0;
      } else if (npc.searchTimer > 0) {
        npc.searchTimer -= dt;
        if (npc.searchTimer <= 0) {
          npc.alertState = 'patrol';
          npc.hostile = false;
        }
      }

      if (npc.alertState === 'chasing') {
        currentClanAlert = `⚠ ${clan.name} HUNTING YOU! CROUCH [C] OR ESCAPE THEIR TURF`;
      } else if (npc.alertState === 'searching' && !currentClanAlert.startsWith('⚠')) {
        currentClanAlert = `👁 ${clan.name} SEARCHING THE AREA...`;
      }
    }

    if (npc.aggro === 'thug' && !meteorDrop.active && !npc.hostile && !gameState.inCar && distToPlayer < (player.crouching ? 8 : 16) && Math.abs(player.y - 0.18) < 3) {
      npc.hostile = true; npc.alertState = 'chasing';
      pushFeed(`${npc.name}: ${npc.line.replace(/"/g, '')}`, 'border-l-rose-500');
    }
    let moveSpeed = 0;
    if (npc.fleeTimer > 0 && !npc.hostile) {
      npc.fleeTimer -= dt;
      npc.yaw = Math.atan2(npc.x - player.x, npc.z - player.z);
      moveSpeed = 5.6;
    } else if ((npc.hostile || npc.alertState === 'chasing') && !meteorDrop.active) {
      const dx = player.x - npc.x;
      const dz = player.z - npc.z;
      const d = Math.hypot(dx, dz);
      npc.yaw = Math.atan2(dx, dz);

      if (d > 48 || Math.abs(player.y - 0.18) > 6.5) {
        npc.hostile = false;
        npc.alertState = 'patrol';
      } else if (d > 1.45) {
        moveSpeed = npc.aggro === 'clan' ? 5.1 : 4.5;
      } else {
        if (npc.attackCooldown <= 0 && !gameState.inCar) {
          npc.attackCooldown = 1.05;
          npc.punchTimer = 0.34;
          npc.punchSide = (npc.punchSide + 1) % 2;
          sfx.swing();
          hooks.applyPlayerDamage((npc.aggro === 'clan' ? 11 : npc.aggro === 'thug' ? 9 : 8) * (npc.age === 'elder' ? 0.5 : npc.age === 'child' ? 0.3 : npc.age === 'teen' ? 0.8 : 1), npc.name);
          if (npc.aggro === 'thug' && gameState.cash > 0 && Math.random() < 0.4) {
            const stolen = Math.min(gameState.cash, 10 + Math.floor(Math.random() * 30));
            gameState.cash -= stolen; npc.wallet = (npc.wallet || 0) + stolen;
            pushFeed(`${npc.name} MUGGED YOU: -$${stolen} (KNOCK THEM OUT TO GET IT BACK)`, 'border-l-rose-500');
          }
        }
      }
    } else if (npc.alertState === 'searching') {
      const dx = npc.searchX - npc.x;
      const dz = npc.searchZ - npc.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.6) {
        npc.yaw = Math.atan2(dx, dz);
        moveSpeed = 3.2;
      } else {
        npc.yaw += Math.sin(elapsed * 3.5 + npc.id) * 1.8 * dt;
      }
    } else if (npc.role === 'patrol' || npc.role === 'clan') {
      npc.turnTimer -= dt;
      if (npc.turnTimer <= 0) {
        if (npc.role === 'clan' && Math.hypot(npc.x - npc.homeX, npc.z - npc.homeZ) > 22) {
          npc.yaw = Math.atan2(npc.homeX - npc.x, npc.homeZ - npc.z);
        } else {
          npc.yaw += (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 2);
        }
        npc.turnTimer = 3.0 + Math.random() * 4.0;
      }
      moveSpeed = 2.15;
    }

    if (npc.age === 'elder') moveSpeed *= 0.6; else if (npc.age === 'child') moveSpeed *= 1.1;
    if (moveSpeed > 0) {
      const nx = npc.x + Math.sin(npc.yaw) * moveSpeed * dt;
      const nz = npc.z + Math.cos(npc.yaw) * moveSpeed * dt;

      let blocked = (Math.abs(nx) > 136 && nx < 175) || (nz < -172) || nz > 202;
      if (!blocked) {
        for (let b = 0; b < worldBoxes.length; b++) {
          const wb = worldBoxes[b];
          if (wb.maxY <= 0.45 || wb.minY >= 1.8) continue;
          if (nx + 0.4 > wb.minX && nx - 0.4 < wb.maxX && nz + 0.4 > wb.minZ && nz - 0.4 < wb.maxZ) {
            blocked = true;
            break;
          }
        }
      }
      if (blocked) {
        npc.yaw += Math.PI * 0.65;
      } else {
        npc.x = nx;
        npc.z = nz;
      }
      npc.walkCycle += dt * (moveSpeed > 3.5 ? 12.5 : 7.5);
      const sw = Math.sin(npc.walkCycle) * (moveSpeed > 3.5 ? 0.78 : 0.52);
      npc.mesh.userData.legL.rotation.x = sw;
      npc.mesh.userData.legR.rotation.x = -sw;
      if (npc.punchTimer <= 0) {
        npc.mesh.userData.armL.rotation.x = -sw * 0.75;
        npc.mesh.userData.armR.rotation.x = sw * 0.75;
        npc.mesh.userData.armL.rotation.z = 0;
        npc.mesh.userData.armR.rotation.z = 0;
        npc.mesh.userData.torso.rotation.y = 0;
      }
    } else {
      npc.mesh.userData.legL.rotation.x = 0;
      npc.mesh.userData.legR.rotation.x = 0;
      if (npc.punchTimer <= 0) {
        npc.mesh.userData.armL.rotation.x = 0;
        npc.mesh.userData.armR.rotation.x = 0;
        npc.mesh.userData.armL.rotation.z = 0;
        npc.mesh.userData.armR.rotation.z = 0;
        npc.mesh.userData.torso.rotation.y = 0;
      }
    }

    if (npc.punchTimer > 0) {
      const pProg = 1 - npc.punchTimer / 0.34;
      const swingArc = Math.sin(pProg * Math.PI);
      if (npc.punchSide === 0) {
        npc.mesh.userData.armR.rotation.x = -1.45 * swingArc;
        npc.mesh.userData.armR.rotation.z = -0.65 * swingArc;
        npc.mesh.userData.torso.rotation.y = 0.42 * swingArc;
      } else {
        npc.mesh.userData.armL.rotation.x = -1.45 * swingArc;
        npc.mesh.userData.armL.rotation.z = 0.65 * swingArc;
        npc.mesh.userData.torso.rotation.y = -0.42 * swingArc;
      }
    }

    npc.mesh.position.set(npc.x, 0.18, npc.z);
    npc.mesh.rotation.y = npc.yaw;
  }

  for (let k = 0; k < 2 && npcSpawnQueue.length; k++) {
const npc = npcSpawnQueue.shift();
npc.queued = false;
if (npc.spawned) continue;
if (Math.hypot(npc.x - player.x, npc.z - player.z) > DESPAWN_DIST) continue;
npc.mesh = buildNpcMeshRaw(npc.shirt, npc.pants, npc.bandana, npc);
npc.mesh.position.set(npc.x, 0.18, npc.z);
npc.mesh.rotation.y = npc.yaw;
worldRoot.add(npc.mesh);
npc.spawned = true;
if (npc.asleep && !npc.sleepZGroup) {
const zzz = buildSleepZzzGroup();
zzz.position.set(npc.x, 0.85, npc.z);
worldRoot.add(zzz);
npc.sleepZGroup = zzz;
}
}
activeClanAlertText = currentClanAlert;
}

export const SKINS = [0xf1c8a5, 0xe2a87e, 0xd99b72, 0xb97a57, 0x8d5a3c, 0x6b4129];

export const HAIRS = [0x1c1917, 0x3b2a1a, 0x6b3f1d, 0xb8860b, 0xc2410c, 0x0f172a];

export function npcHpFor(def, clan) {
  const base = clan ? 120 : 100;
  return def.age === 'child' ? 40 : def.age === 'elder' ? 70 : def.age === 'teen' ? 85 : base;
}

export function npcBlocked(nx, nz) {
  if (Math.abs(nx) > 136 || nz < -172 || nz > 202) return true;
  for (let b = 0; b < worldBoxes.length; b++) {
    const wb = worldBoxes[b];
    if (wb.maxY <= 0.45 || wb.minY >= 1.8) continue;
    if (nx + 0.4 > wb.minX && nx - 0.4 < wb.maxX && nz + 0.4 > wb.minZ && nz - 0.4 < wb.maxZ) return true;
  }
  return false;
}

// ---------- FACES ----------
const faceBasicCache = new Map();
function faceBasic(hex, transparent = false, opacity = 1) {
const key = hex + '|' + transparent + '|' + opacity;
let m = faceBasicCache.get(key);
if (!m) { m = new THREE.MeshBasicMaterial({ color: hex, transparent, opacity }); m.userData.shared = true; faceBasicCache.set(key, m); }
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
Object.values(cache).forEach(m => { m.userData.shared = true; });
return cache;
})());
const g = new THREE.Group();
g.position.z = dir * (d / 2 + 0.004);
const B = (sx, sy, sz, m, x, y, z = 0) => {
const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
b.position.set(x, y, z * dir);
g.add(b);
return b;
};
const ex = w * 0.22, ey = h * 0.06, es = w * 0.2, by = ey + h * 0.17, my = -h * 0.27;
const irisM = faceBasic(o.iris || 0x3b2a1a);
const browM = faceBasic(o.brow || 0x1c1917);
const eyeL = B(es, es * 0.8, 0.008, C.white, -ex, ey), eyeR = B(es, es * 0.8, 0.008, C.white, ex, ey);
const pupL = B(es * 0.5, es * 0.62, 0.01, irisM, -ex, ey, 0.004), pupR = B(es * 0.5, es * 0.62, 0.01, irisM, ex, ey, 0.004);
const browL = B(w * 0.27, h * 0.055, 0.01, browM, -ex, by), browR = B(w * 0.27, h * 0.055, 0.01, browM, ex, by);
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
const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
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
const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 1.12, h * 0.22, d * 1.12), makeSharedMat(0xdc2626));
cap.position.y = h * 0.5;
head.add(cap);
const brim = new THREE.Mesh(new THREE.BoxGeometry(w * 1.0, h * 0.06, d * 0.5), makeSharedMat(0xb91c1c));
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
const bx = (sx, sy, sz, m) => new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
const torso = bx(0.44, 0.54, 0.22, shirtM);
torso.position.y = 0.27;
torso.castShadow = true;
const belt = bx(0.46, 0.06, 0.24, makeSharedMat(0x1c1917));
torso.add(belt);
belt.position.y = -0.22;
const collar = bx(0.2, 0.05, 0.24, skinM);
collar.position.y = 0.28;
torso.add(collar);
const hw = 0.24, hh = 0.26, hd = 0.24;
const head = bx(hw, hh, hd, skinM);
head.castShadow = true;
head.scale.setScalar(bigHead);
head.position.y = 0.55 + (hh / 2) * bigHead;
const style = age === 'child' ? (id % 2 ? 'pigtails' : 'short') : age === 'elder' ? (id % 3 === 0 ? 'bald' : 'short')
: age === 'teen' ? pick(['cap', 'mohawk', 'long', 'short']) : pick(['short', 'short', 'long', 'bald']);
addHair(head, hw, hh, hd, 1, style, hairHex);
const face = makeFace(hw, hh, hd, 1, { age, skin, brow: hairHex, glasses: age === 'elder' && id % 2 === 0, iris: pick([0x3b2a1a, 0x1e40af, 0x166534, 0x44403c]) });
head.add(face);
if (bandC !== null && bandC !== undefined) {
const band = bx(hw * 1.1, hh * 0.2, hd * 1.1, makeSharedMat(bandC));
band.position.y = hh * 0.22;
head.add(band);
}
const armGeo = new THREE.BoxGeometry(0.11, 0.50, 0.11);
const legGeo = new THREE.BoxGeometry(0.14, 0.72, 0.14);
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
const pack = bx(0.3, 0.34, 0.12, makeSharedMat(pick([0x16a34a, 0xf59e0b, 0x2563eb, 0xdb2777])));
pack.position.set(0, 0.3, -0.17);
hip.add(pack);
}
hip.add(torso, head, armL, armR, legL, legR);
root.scale.setScalar(S * (o.scale || 1));
root.userData = { hip, torso, armL, armR, legL, legR, face };
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

// ---------- EXTRA ROSTER: children, teens, elders, adults, muggers, biome locals ----------
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

// ---------- PICKPOCKETING ----------
export const pp = { npc: null, prog: 0, aware: 0, el: null, hinted: false };

export function ppEnsureUI() {
  if (pp.el) return;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:50%;bottom:104px;transform:translateX(-50%);z-index:25;display:none;pointer-events:none;min-width:250px;padding:8px 12px;border-radius:10px;background:rgba(10,13,18,.9);border:1px solid rgba(245,158,11,.5);color:#fff;font:700 11px Rajdhani,Inter,sans-serif;letter-spacing:.06em;text-align:center;text-transform:uppercase';
  el.innerHTML = '<div id="pp-label"></div><div style="height:6px;margin-top:6px;background:#1e293b;border-radius:9px;overflow:hidden"><div id="pp-prog" style="height:100%;width:0;background:#34d399"></div></div><div style="height:4px;margin-top:4px;background:#1e293b;border-radius:9px;overflow:hidden"><div id="pp-aware" style="height:100%;width:0;background:#f43f5e"></div></div><div style="font-size:9px;color:#94a3b8;margin-top:3px">GREEN: LIFT &nbsp;·&nbsp; RED: SUSPICION (STAY BEHIND, CROUCH)</div>';
  document.body.appendChild(el);
  pp.el = el;
}

export function lootFor(n, mult = 1) {
  const r = (a, b) => Math.floor(a + rnd() * (b - a));
  let c = n.age === 'child' ? r(1, 7) : n.age === 'teen' ? r(4, 26) : n.age === 'elder' ? r(18, 70) : r(12, 90);
  if (n.clanId) c = r(30, 120);
  if (n.aggro === 'thug') c = r(25, 110);
  if (/TELLER/.test(n.name)) c = r(120, 300);
  return Math.floor(c * mult) + (n.wallet || 0);
}

export function updatePickpocket(dt) {
  ppEnsureUI();
  for (const n of npcs) if (n.picked) { n.pickCool = (n.pickCool || 0) - dt; if (n.pickCool <= 0) n.picked = false; }
  const blocked = gameState.inCar || gameState.inventoryOpen || gameState.mapOpen || gameState.settingsOpen || meteorDrop.active || player.mantle.active;
  let best = null, bd = 1.95;
  if (!blocked) {
    for (const n of npcs) {
      if (!n.mesh || n.hostile || n.picked || n.stunTimer > 0 || n.fleeTimer > 0) continue;
      const d = Math.hypot(n.x - player.x, n.z - player.z);
      if (d < bd && Math.abs(player.y - 0.18) < 1.6) { bd = d; best = n; }
    }
  }
  if (best !== pp.npc) { pp.npc = best; pp.prog = 0; pp.aware = 0; }
  if (!best) { pp.el.style.display = 'none'; return; }
  const n = best;
  const tx = player.x - n.x, tz = player.z - n.z, L = Math.hypot(tx, tz) || 1;
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
      rate *= n.age === 'elder' ? 0.6 : n.age === 'child' ? 1.4 : (n.clanId || n.aggro === 'thug') ? 1.4 : 1;
      pp.aware += Math.max(0, rate) * dt;
    }
    if (pp.aware >= 1) {
      sfx.hit();
      flashEdge('rgba(244, 63, 94, 0.35)');
      n.picked = true; n.pickCool = 60;
      if (n.aggro === 'fighter' || n.aggro === 'clan' || n.aggro === 'thug') {
        n.hostile = true; n.alertState = 'chasing';
        pushFeed(`${n.name} CAUGHT YOU! "HEY!"`, 'border-l-rose-500');
      } else {
        n.fleeTimer = 8;
        pushFeed(`${n.name} NOTICED AND RAN OFF!`, 'border-l-rose-500');
      }
      pp.prog = 0; pp.aware = 0;
    } else if (pp.prog >= 1) {
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
  } else {
    pp.prog = Math.max(0, pp.prog - dt * 1.5);
    pp.aware = Math.max(0, pp.aware - dt * 0.6);
  }
  pp.el.style.display = 'block';
  const tag = n.asleep ? 'SLEEPING' : facing > 0.25 ? 'FACING YOU!' : 'BACK TURNED';
  document.getElementById('pp-label').textContent = `HOLD [G] · PICKPOCKET ${n.name} (${n.age}) · ${tag}`;
  document.getElementById('pp-prog').style.width = `${Math.min(100, pp.prog * 100)}%`;
  document.getElementById('pp-aware').style.width = `${Math.min(100, pp.aware * 100)}%`;
}

export function damageNpc(n, a, y) { damageNpcBase(n, a, y); if (Math.hypot(player.x - n.x, player.z - n.z) < 14) crime(a > 40 ? .45 : .25); }

export const tmpV=new THREE.Vector3();

export function makeCop(x,z){
  const gp_=levelData.params.models.npc_guard;const m=buildNpcMeshRaw(colorToHex(gp_.shirtColor,0x1d4ed8),colorToHex(gp_.pantsColor,0x0b1220),null,{id:900+AO.cops.length});applyModelPreset('npc_guard',m);
  const cap=new THREE.Mesh(new THREE.BoxGeometry(.34,.1,.4),new THREE.MeshStandardMaterial({color:0x0b1220}));cap.position.set(0,1.78,.04);m.add(cap);
  const bd=new THREE.Mesh(new THREE.BoxGeometry(.08,.1,.02),new THREE.MeshBasicMaterial({color:0xfacc15}));bd.position.set(.12,1.3,.2);m.add(bd);
  worldRoot.add(m);const c={mesh:m,x,z,hp:70,atk:0,shoot:Math.random()};m.position.set(x,computeSupportFloor(x,z,2,.4),z);AO.cops.push(c);}

export function makeCar(x,z){
  const g=new THREE.Group(),dark=new THREE.MeshStandardMaterial({color:0x0b1220,metalness:.7,roughness:.3}),wh=new THREE.MeshStandardMaterial({color:0xf1f5f9,roughness:.4});
  const b=new THREE.Mesh(new THREE.BoxGeometry(2,.75,4.5),dark);b.position.y=.65;g.add(b);
  const d=new THREE.Mesh(new THREE.BoxGeometry(2.04,.4,2.2),wh);d.position.set(0,.6,0);g.add(d);
  const cab=new THREE.Mesh(new THREE.BoxGeometry(1.7,.6,2.1),new THREE.MeshStandardMaterial({color:0x111827,metalness:.9,roughness:.1}));cab.position.set(0,1.2,-.2);g.add(cab);
  const lr=new THREE.Mesh(new THREE.BoxGeometry(.8,.18,.35),new THREE.MeshBasicMaterial({color:0xff1f2f})),lb=new THREE.Mesh(new THREE.BoxGeometry(.8,.18,.35),new THREE.MeshBasicMaterial({color:0x2f6bff}));
  lr.position.set(.45,1.58,-.2);lb.position.set(-.45,1.58,-.2);g.add(lr,lb);
  for(const sx of[-1,1])for(const sz of[-1.4,1.4]){const w=new THREE.Mesh(new THREE.CylinderGeometry(.38,.38,.28,14),new THREE.MeshStandardMaterial({color:0x111}));w.rotation.z=Math.PI/2;w.position.set(sx*1.02,.38,sz);g.add(w);}
  g.rotation.order='YXZ';worldRoot.add(g);AO.cars.push({mesh:g,x,z,yaw:0,sp:0,hp:240,lr,lb,stuck:0});}

export function removeCop(c){worldRoot.remove(c.mesh);freeGeo(c.mesh);AO.cops.splice(AO.cops.indexOf(c),1);}

export function clearWantedLevel() {
  AO.heat = 0;
  AO.calm = 0;
  AO.spawnT = 4;
  for (const cop of AO.cops.slice()) removeCop(cop);
  for (const car of AO.cars.slice()) {
    worldRoot.remove(car.mesh);
    car.mesh.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material && object.material.dispose) object.material.dispose();
    });
    AO.cars.splice(AO.cars.indexOf(car), 1);
  }
  const starsElement = document.getElementById('ao-stars');
  if (starsElement) starsElement.style.display = 'none';
  pushFeed('WANTED LEVEL CLEARED', 'border-l-sky-400');
}

export const tracerMat=new THREE.LineBasicMaterial({color:0xfff2a8});

export function tracer(x1,y1,z1,x2,y2,z2){const g=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x1,y1,z1),new THREE.Vector3(x2,y2,z2)]);const l=new THREE.Line(g,tracerMat);worldRoot.add(l);setTimeout(()=>{worldRoot.remove(l);g.dispose();},70);}

export function hurtCop(c,a){c.hp-=a;spawnParticles(c.x,1.2,c.z,0xdc2626,6,4);crime(.15);if(c.hp<=0){gameState.cash+=40;pushFeed('OFFICER DOWN (+$40)','border-l-amber-400');crime(.5);removeCop(c);}}

export function copFrame(dt,t){
  const s=stars(),pu=under();
  if(s>0&&!pu){AO.spawnT-=dt;const wantF=Math.min(8,s*2),wantC=s>=2?Math.min(4,s-1):0;
    if(AO.spawnT<=0){AO.spawnT=1.6;const a=Math.random()*6.28,r=55+Math.random()*25,x=player.x+Math.cos(a)*r,z=player.z+Math.sin(a)*r;
      if(x>-130&&x<360&&z>-165&&z<200&&!collidesHorizontally(x,z,.2,1.8,1.5)){if(AO.cops.length<wantF)makeCop(x,z);else if(AO.cars.length<wantC)makeCar(x,z);}}}
  // calm-down
  AO.calm+=dt;const nearest=Math.min(99,...AO.cops.map(c=>Math.hypot(c.x-player.x,c.z-player.z)),...AO.cars.map(c=>Math.hypot(c.x-player.x,c.z-player.z)));
  if(AO.calm>10&&nearest>38)AO.heat=Math.max(0,AO.heat-dt*(nearest>70?.18:.07));
  if(pu)AO.heat=Math.max(0,AO.heat-dt*.12);
  // melee & projectile damage
  if(player.attackTimer>0&&!player._copHit&&(1-player.attackTimer/player.attackDuration)>=0.42){player._copHit=true;const fx=Math.sin(player.yaw+Math.PI),fz=Math.cos(player.yaw+Math.PI);
    for(const c of AO.cops.slice()){const dx=c.x-player.x,dz=c.z-player.z,d=Math.hypot(dx,dz);if(d<2.9&&Math.abs(player.y-c.mesh.position.y)<2.5&&(dx*fx+dz*fz)/Math.max(.1,d)>.2)hurtCop(c,(RIGHT_WEAPONS[gameState.activeRightWeapon]||{damage:18}).damage);}}
  AO.lastAtk-=dt;
  for(const w of projectileWieners)for(const c of AO.cops.slice())if(!w.copHit&&Math.hypot(w.x-c.x,w.z-c.z)<1&&w.y<c.mesh.position.y+2&&w.y>c.mesh.position.y-.2){w.copHit=1;hurtCop(c,RIGHT_WEAPONS.hotdog_shooter.damage);}
  // foot cops
  for(const c of AO.cops.slice()){
    const dx=player.x-c.x,dz=player.z-c.z,d=Math.hypot(dx,dz)||1,py=gameState.inCar?vehicles[gameState.activeCarIndex].y:player.y;
    if(pu||s===0){c.mesh.visible=true;if(s===0&&d>70)removeCop(c);if(pu&&d>5){}}
    const want=d>(gameState.inCar?6:9)?5.6:0,vx=dx/d*want*dt,vz=dz/d*want*dt;
    if(!collidesHorizontally(c.x+vx,c.z,.2,1.7,.4))c.x+=vx;if(!collidesHorizontally(c.x,c.z+vz,.2,1.7,.4))c.z+=vz;
    c.mesh.position.set(c.x,computeSupportFloor(c.x,c.z,c.mesh.position.y+.6,.4)+Math.abs(Math.sin(t*9+c.x))*.04*(want>0),c.z);c.mesh.rotation.y=Math.atan2(dx,dz);
    c.shoot-=dt;c.atk-=dt;
    if(d<2.2&&c.atk<=0&&Math.abs(py-c.mesh.position.y)<2.5){c.atk=.9;hooks.applyPlayerDamage(9,'OFFICER BATON');}
    else if(d<26&&d>2.5&&c.shoot<=0&&Math.abs(py-c.mesh.position.y)<4){c.shoot=1.05+Math.random()*.5;tracer(c.x,1.3,c.z,player.x+(Math.random()-.5)*.8,player.y+1,player.z+(Math.random()-.5)*.8);if(Math.random()<.45)hooks.applyPlayerDamage(5+s,'POLICE FIRE');}
  }
  // police cars
  for(const c of AO.cars.slice()){
    const dx=player.x-c.x,dz=player.z-c.z,d=Math.hypot(dx,dz)||1,want=Math.atan2(dx,dz);let dy=want-c.yaw;dy=Math.atan2(Math.sin(dy),Math.cos(dy));
    c.yaw+=Math.max(-2.2*dt,Math.min(2.2*dt,dy*3*dt))*(c.sp>3?1:2);
    const tgt=d>14?(26+s*2):(d>7?10:0);c.sp+=(tgt-c.sp)*Math.min(1,dt*1.4);
    const sl=(terrainH(c.x+Math.sin(c.yaw)*2,c.z+Math.cos(c.yaw)*2)-terrainH(c.x,c.z))/2;if(sl>0&&sl<5)c.sp-=9.8*sl*dt*.8;
    const nx=c.x+Math.sin(c.yaw)*c.sp*dt,nz=c.z+Math.cos(c.yaw)*c.sp*dt;
    if(collidesHorizontally(nx,nz,.3,1.2,1.5)){c.sp*=-.3;c.yaw+=.6;c.stuck+=dt;}else{c.x=nx;c.z=nz;c.stuck=Math.max(0,c.stuck-dt);}
    const gy=computeSupportFloor(c.x,c.z,1.4,1.2);
    c.mesh.position.set(c.x,gy+.02,c.z);c.mesh.rotation.y=c.yaw;
    c.mesh.rotation.x=-Math.atan2(terrainH(c.x+Math.sin(c.yaw)*2,c.z+Math.cos(c.yaw)*2)-terrainH(c.x-Math.sin(c.yaw)*2,c.z-Math.cos(c.yaw)*2),4)*(c.z<-170?1:0);
    const fl=Math.sin(t*14)>0;c.lr.visible=fl;c.lb.visible=!fl;
    if(d<3.3&&!pu&&Math.abs(c.sp)>5){hooks.applyPlayerDamage(10,'POLICE RAM');c.sp*=.4;if(gameState.inCar){const v=vehicles[gameState.activeCarIndex];v.speed*=.7;}}
    if(gameState.inCar){const v=vehicles[gameState.activeCarIndex];if(Math.hypot(v.x-c.x,v.z-c.z)<3&&Math.abs(v.speed)>7){c.hp-=Math.abs(v.speed)*5;v.speed*=.8;spawnParticles(c.x,1,c.z,0xf59e0b,8,6);}}
    if(c.hp<=0||c.stuck>6||(s===0&&d>90)){spawnParticles(c.x,1,c.z,0xf97316,16,8);worldRoot.remove(c.mesh);c.mesh.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();});AO.cars.splice(AO.cars.indexOf(c),1);}
  }
  // wanted HUD
  const st=document.getElementById('ao-stars');if(st){const n=stars();st.style.display=n>0?'flex':'none';st.innerHTML=[1,2,3,4,5].map(i=>`<span style="color:${i<=n?(Math.sin(t*10)>0?'#ef4444':'#3b82f6'):'#475569'}">★</span>`).join('');}
}

export const rats=[],ratG=new THREE.BoxGeometry(.22,.16,.5),ratTG=new THREE.BoxGeometry(.03,.03,.35),ratM=new THREE.MeshStandardMaterial({color:0x3b332c,roughness:1});
export let ratHit=0;

export function buildSewerRats(){
[[-110,-30],[-70,-30],[-20,-30],[34,-30],[100,-30],[20,-50],[20,-10],[20,50],[20,85],[0,24]].forEach((q,i)=>{if(!sewerOK(q[0],q[1],.3))return;
  const m=new THREE.Mesh(ratG,ratM),tl=new THREE.Mesh(ratTG,ratM);tl.position.z=-.38;m.add(tl);m.position.set(q[0],SFY+.1,q[1]);worldRoot.add(m);
  rats.push({mesh:m,x:q[0],z:q[1],hx:q[0],hz:q[1],bite:0,ph:i*1.7,dead:false});});
}

export function reviveRats(){for(const r of rats){r.dead=false;r.x=r.hx;r.z=r.hz;r.mesh.visible=true;}}

export function killRat(r){r.dead=true;r.mesh.visible=false;spawnParticles(r.x,SFY+.3,r.z,0x7c2d12,6,3);gameState.cash+=5;sfx.hit();}

export function ratFrame(dt,t){
  if(!under()||climb.on)return;
  if(Math.random()<dt*.5)sfx.tone(1500+Math.random()*500,800,.06,'sine',.025);
  const swing=player.attackTimer>0&&ratHit<=0;if(swing)ratHit=.4;ratHit-=dt;
  const fx=Math.sin(player.yaw+Math.PI),fz=Math.cos(player.yaw+Math.PI);
  for(const r of rats){if(r.dead)continue;
    const dx=player.x-r.x,dz=player.z-r.z,d=Math.hypot(dx,dz)||1;let tx,tz,sp;
    if(d<14){tx=dx/d;tz=dz/d;sp=d>.9?4.6:0;}else{tx=Math.sin(t*.7+r.ph);tz=Math.cos(t*.5+r.ph);sp=1.2;}
    const nx=r.x+tx*sp*dt,nz=r.z+tz*sp*dt;if(sewerOK(nx,nz,.2)){r.x=nx;r.z=nz;}
    r.mesh.position.set(r.x,SFY+.1+Math.abs(Math.sin(t*14+r.ph))*.04,r.z);r.mesh.rotation.y=Math.atan2(tx,tz);
    r.bite-=dt;if(d<1&&r.bite<=0&&Math.abs(player.y-SFY)<2){r.bite=1;hooks.applyPlayerDamage(3,'SEWER RAT');sfx.tone(1800,1200,.05,'square',.03);}
    const hit=(swing&&d<2.6&&(dx*fx+dz*fz)/d>.2)||projectileWieners.some(w=>Math.hypot(w.x-r.x,w.z-r.z)<.8&&Math.abs(w.y-(SFY+.2))<1.2);
    if(hit)killRat(r);}
}
// Register late-bound implementations for lower layers (see state.js).
Object.assign(hooks, { damageNpc });
