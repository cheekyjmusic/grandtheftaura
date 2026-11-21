// =============================================================================
// player.js — First/third person rigs, movement, parkour mantling, meteor drop, combat triggers and the per-frame simulation step.
// =============================================================================
import * as THREE from 'three';
import { levelData } from './levelData.js';
import { MAX_HOTDOG_AMMO, SFY, WORLD_BOUNDS, aura, aviationBeacons, biomeAt, climb, collidesHorizontally, computeSupportFloor, enterableZones, flashEdge, gameState, hazardBarrels, hooks, inputState, isInWater, keys, lampPosts, manholeCovers, manholeOpen, manholes, meteorDrop, npcs, particleBursts, player, pushFeed, sausageRefillZones, sewerLights, skyscrapers, smashableCrates, surfaceGrip, terrainH, under, worldBoxes, worldPickups } from './state.js';
import { AT, camera, hemiLight, makeMat, meteorCore, meteorGroup, meteorReticle, scene, skyGroup, sunLight, uLight, worldRoot } from './engine.js';
import { applyModelPreset } from './assets.js';
import { sfx } from './audio.js';
import { LEFT_ITEMS, RIGHT_WEAPONS, addLeftItemToBag, buildLeftItemMesh, buildRightWeaponMesh, fireBallisticWiener, freeGeo, spawnParticles, spawnWorldPickup, updateProjectileWieners } from './items.js';
import { GEAR_CAPS_MPH, exitCurrentCar, getNearestVehicle, stepVehicleDriving, suspFrame } from './vehicles.js';
import { knockOverLamppost, updateBiomeAtmosphere, updateBuildingLods, updateLampposts, updateSkyscraperInteriors } from './world.js';
import { clearWantedLevel, copFrame, damageNpc, makeFace, pp, ratFrame, reviveRats, setFaceMood, updateNPCs, updatePickpocket } from './npcs.js';

function clampMeteorPosition(x, z) {
  return {
    x: Math.max(WORLD_BOUNDS.minX + player.radius, Math.min(WORLD_BOUNDS.maxX - player.radius, x)),
    z: Math.max(WORLD_BOUNDS.minZ + player.radius, Math.min(WORLD_BOUNDS.maxZ - player.radius, z))
  };
}

export const fpRoot = new THREE.Group();

camera.add(fpRoot);

export const skinMat = makeMat(0xe2a87e);

export const sleeveMat = makeMat(0x1e293b);

export function createFirstPersonArm(side) {
  const pivot = new THREE.Group();
  pivot.position.set(side * 0.32, -0.26, -0.34);

  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.30), sleeveMat);
  sleeve.position.set(0, -0.02, 0.12);

  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.095, 0.24), skinMat);
  forearm.position.set(0, 0, -0.06);

  const fist = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.105, 0.11), skinMat);
  fist.position.set(0, 0.005, -0.19);

  const itemMount = new THREE.Group();
  itemMount.position.set(0, 0.02, -0.20);

  pivot.add(sleeve, forearm, fist, itemMount);
  fpRoot.add(pivot);
  return { pivot, fist, itemMount };
}

export const fpRight = createFirstPersonArm(1);

export const fpLeft = createFirstPersonArm(-1);

export const spotLight = new THREE.SpotLight(0xfef9c3, 3.6, 36, Math.PI / 5.5, 0.42, 1.1);

spotLight.position.set(0, 0, -0.1);

spotLight.target.position.set(0, 0, -10);

spotLight.visible = false;

fpLeft.itemMount.add(spotLight);

fpLeft.itemMount.add(spotLight.target);

// 3rd-Person Articulated Character Rig (Olympic Sprinter & Jump Ready)
export function buildPlayerRigMesh(params = {}) {
  const toHex = (c, d) => (c === undefined || c === null || c === '') ? d : (typeof c === 'number' ? c : new THREE.Color(c).getHex());
  const bodyColor = toHex(params.bodyColor, 0x1e293b);
  const accentColor = toHex(params.accentColor, 0x0f172a);
  const sleeveMat = makeMat(bodyColor);
const tpRig = new THREE.Group();
const tpHip = new THREE.Group();
tpHip.position.y = 0.90;
tpRig.add(tpHip);

const tpTorso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.24), makeMat(bodyColor));
tpTorso.position.y = 0.28;
tpTorso.castShadow = true;

const tpHead = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skinMat);
tpHead.position.y = 0.72;
tpHead.castShadow = true;

const tpHair = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.10, 0.28), makeMat(accentColor));
tpHair.position.y = 0.85;
tpHead.add(makeFace(0.26, 0.28, 0.26, -1, { age: 'adult', skin: 0xe2a87e, brow: 0x0f172a, iris: 0x1e40af }));

function createTpArticulatedArm(side) {
  const shoulderPivot = new THREE.Group();
  shoulderPivot.position.set(side * 0.31, 0.50, 0);

  const upperArm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.27, 0.12), sleeveMat);
  upperArm.position.y = -0.135;
  upperArm.castShadow = true;

  const elbowPivot = new THREE.Group();
  elbowPivot.position.set(0, -0.26, 0);

  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.26, 0.105), skinMat);
  forearm.position.y = -0.13;
  forearm.castShadow = true;

  elbowPivot.add(forearm);
  shoulderPivot.add(upperArm, elbowPivot);
  return { shoulderPivot, elbowPivot };
}

const tpArmLeftRig = createTpArticulatedArm(-1);
const tpArmRightRig = createTpArticulatedArm(1);
const tpArmL = tpArmLeftRig.shoulderPivot;
const tpArmR = tpArmRightRig.shoulderPivot;
const tpElbowL = tpArmLeftRig.elbowPivot;
const tpElbowR = tpArmRightRig.elbowPivot;

function createTpArticulatedLeg(side) {
  const hipJoint = new THREE.Group();
  hipJoint.position.set(side * 0.13, 0.0, 0);

  const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.38, 0.15), makeMat(accentColor));
  thigh.position.y = -0.19;
  thigh.castShadow = true;

  const kneeJoint = new THREE.Group();
  kneeJoint.position.set(0, -0.37, 0);

  const shin = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.37, 0.135), makeMat(accentColor));
  shin.position.y = -0.185;
  shin.castShadow = true;

  kneeJoint.add(shin);
  hipJoint.add(thigh, kneeJoint);
  return { hipJoint, kneeJoint };
}

const tpLegLeftRig = createTpArticulatedLeg(-1);
const tpLegRightRig = createTpArticulatedLeg(1);
const tpLegL = tpLegLeftRig.hipJoint;
const tpLegR = tpLegRightRig.hipJoint;
const tpKneeL = tpLegLeftRig.kneeJoint;
const tpKneeR = tpLegRightRig.kneeJoint;

tpHip.add(tpTorso, tpHead, tpHair, tpArmL, tpArmR, tpLegL, tpLegR);
tpRig.visible = false;
  return { tpRig, tpHip, tpTorso, tpHead, tpHair, tpArmL, tpArmR, tpElbowL, tpElbowR, tpLegL, tpLegR, tpKneeL, tpKneeR };
}

export const { tpRig, tpHip, tpTorso, tpHead, tpHair, tpArmL, tpArmR, tpElbowL, tpElbowR, tpLegL, tpLegR, tpKneeL, tpKneeR } = buildPlayerRigMesh(levelData.params.player);

worldRoot.add(tpRig);

export function syncEquippedMeshes() {
  while (fpRight.itemMount.children.length > 0) {
    fpRight.itemMount.remove(fpRight.itemMount.children[0]);
  }
  const rId = gameState.activeRightWeapon;
  if (rId !== 'fists') {
    { const wm = buildRightWeaponMesh(rId); applyModelPreset(rId, wm); fpRight.itemMount.add(wm); }
  }

  const keptLight = spotLight;
  const keptTarget = spotLight.target;
  while (fpLeft.itemMount.children.length > 0) {
    fpLeft.itemMount.remove(fpLeft.itemMount.children[0]);
  }
  fpLeft.itemMount.add(keptLight, keptTarget);

  const lSlot = gameState.leftHotbar[gameState.activeLeftSlot];
  if (lSlot && LEFT_ITEMS[lSlot.id]) {
    fpLeft.itemMount.add(buildLeftItemMesh(lSlot.id));
  }
  spotLight.visible = Boolean(gameState.flashlightOn && lSlot && lSlot.id === 'flashlight');
}

export function findMantleTarget() {
  if (gameState.inCar || player.mantle.active || meteorDrop.active) return null;
  const fwdX = -Math.sin(player.yaw);
  const fwdZ = -Math.cos(player.yaw);
  const probeX = player.x + fwdX * 0.95;
  const probeZ = player.z + fwdZ * 0.95;
  const landX = player.x + fwdX * 1.48;
  const landZ = player.z + fwdZ * 1.48;

  let bestTop = null;
  for (let i = 0; i < worldBoxes.length; i++) {
    const b = worldBoxes[i];
    if (!b.climbable) continue;
    const nearX = probeX >= b.minX - 0.35 && probeX <= b.maxX + 0.35;
    const nearZ = probeZ >= b.minZ - 0.35 && probeZ <= b.maxZ + 0.35;
    if (!nearX || !nearZ) continue;

    const rise = b.maxY - player.y;
    if (rise >= 0.45 && rise <= 2.38) {
      let blockedAbove = false;
      for (let j = 0; j < worldBoxes.length; j++) {
        if (i === j) continue;
        const ob = worldBoxes[j];
        if (landX + 0.3 > ob.minX && landX - 0.3 < ob.maxX && landZ + 0.3 > ob.minZ && landZ - 0.3 < ob.maxZ) {
          if (ob.maxY > b.maxY + 0.1 && ob.minY < b.maxY + 1.55) {
            blockedAbove = true;
            break;
          }
        }
      }
      if (!blockedAbove && (bestTop === null || b.maxY > bestTop)) {
        bestTop = b.maxY;
      }
    }
  }
  if (bestTop === null) return null;
  return { x: landX, y: bestTop, z: landZ };
}

export function getNearestElevatorPad() {
  if (gameState.inCar || meteorDrop.active) return null;
  for (let i = 0; i < skyscrapers.length; i++) {
    const sk = skyscrapers[i];
    if (Math.hypot(player.x - sk.lobbyPad.x, player.z - sk.lobbyPad.z) < 2.2 && Math.abs(player.y - sk.lobbyPad.y) < 1.5) {
      return { sk, toRoof: true, dest: sk.roofPad };
    }
    if (Math.hypot(player.x - sk.roofPad.x, player.z - sk.roofPad.z) < 2.4 && Math.abs(player.y - sk.roofPad.y) < 1.8) {
      return { sk, toRoof: false, dest: sk.lobbyPad };
    }
  }
  return null;
}

export function triggerRightHandAttack() {
  if (gameState.inCar || player.attackTimer > 0 || meteorDrop.active) return;
  const w = RIGHT_WEAPONS[gameState.activeRightWeapon] || RIGHT_WEAPONS.fists;
  player.attackDuration = w.cooldown;
  player.attackTimer = w.cooldown;
  player.hitApplied = false;

  if (w.isRanged && w.id === 'hotdog_shooter') {
    fireBallisticWiener();
    player.hitApplied = true;
  } else {
    if (w.id === 'fists') {
      player.punchCombo = (player.punchCombo + 1) % 2;
    }
    sfx.swing();
  }
}

export function evaluateMeleeHit() {
  const w = RIGHT_WEAPONS[gameState.activeRightWeapon] || RIGHT_WEAPONS.fists;
  if (w.isRanged) return;
  const fwdX = -Math.sin(player.yaw);
  const fwdZ = -Math.cos(player.yaw);
  const reach = w.reach;

  for (let i = smashableCrates.length - 1; i >= 0; i--) {
    const c = smashableCrates[i];
    const dx = c.x - player.x;
    const dz = c.z - player.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= reach && Math.abs(c.y - player.y) < 1.6) {
      const dot = dist > 0.01 ? (dx * fwdX + dz * fwdZ) / dist : 1;
      if (dot > 0.45) {
        c.hp -= w.damage;
        sfx.hit();
        spawnParticles(c.x, c.y + 0.55, c.z, 0xd97706, 8, 4.5);
        if (c.hp <= 0) {
          sfx.smash();
          spawnParticles(c.x, c.y + 0.55, c.z, 0x92400e, 14, 6.5);
          worldRoot.remove(c.mesh);
          freeGeo(c.mesh);
          const idx = worldBoxes.indexOf(c.box);
          if (idx !== -1) worldBoxes.splice(idx, 1);
          if (c.loot) spawnWorldPickup(c.loot.type, c.loot.id, c.x, c.y, c.z);
          smashableCrates.splice(i, 1);
          pushFeed('CRATE SMASHED!', 'border-l-amber-400');
        }
        return;
      }
    }
  }

  for (let i = hazardBarrels.length - 1; i >= 0; i--) {
    const b = hazardBarrels[i];
    const dx = b.x - player.x;
    const dz = b.z - player.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= reach && Math.abs(b.y - player.y) < 1.6) {
      const dot = dist > 0.01 ? (dx * fwdX + dz * fwdZ) / dist : 1;
      if (dot > 0.45) {
        b.hp -= w.damage;
        sfx.hit();
        spawnParticles(b.x, b.y + 0.6, b.z, 0xef4444, 8, 5);
        if (b.hp <= 0) {
          sfx.smash();
          spawnParticles(b.x, b.y + 0.6, b.z, 0xf97316, 18, 8.5);
          worldRoot.remove(b.mesh);
          freeGeo(b.mesh);
          const idx = worldBoxes.indexOf(b.box);
          if (idx !== -1) worldBoxes.splice(idx, 1);
          hazardBarrels.splice(i, 1);
          if (Math.hypot(player.x - b.x, player.z - b.z) < 4.2) {
            applyPlayerDamage(24, 'EXPLOSIVE BARREL');
          }
          pushFeed('HAZARD BARREL DETONATED!', 'border-l-orange-500');
        }
        return;
      }
    }
  }

  for (const lp of lampPosts) {
    if (lp.state !== 'standing') continue;
    const dx = lp.x - player.x;
    const dz = lp.z - player.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= reach + 0.3 && Math.abs(0.18 - player.y) < 1.8) {
      const dot = dist > 0.01 ? (dx * fwdX + dz * fwdZ) / dist : 1;
      if (dot > 0.45) {
        knockOverLamppost(lp, Math.atan2(fwdX, fwdZ), 7.5);
        pushFeed('LAMPPOST KNOCKED OVER!', 'border-l-amber-400');
        return;
      }
    }
  }

  for (let i = 0; i < npcs.length; i++) {
    const npc = npcs[i];
    if (npc.asleep) continue;
    const dx = npc.x - player.x;
    const dz = npc.z - player.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= reach && Math.abs(0.18 - player.y) < 1.6) {
      const dot = dist > 0.01 ? (dx * fwdX + dz * fwdZ) / dist : 1;
      if (dot > 0.45) {
        damageNpc(npc, w.damage, Math.atan2(fwdX, fwdZ));
        sfx.hit();
        spawnParticles(npc.x, 1.2, npc.z, 0xfacc15, 6, 4.0);
        if (!npc.asleep) {
          pushFeed(`STRUCK ${npc.name}`, 'border-l-amber-400');
        }
        return;
      }
    }
  }
}

export function applyPlayerDamage(amount, sourceLabel) {
  if (gameState.damageCooldown > 0) return;
  gameState.damageCooldown = 0.45;
  gameState.hp = Math.max(0, gameState.hp - amount);
  sfx.damage();
  flashEdge('rgba(239, 68, 68, 0.48)');
  pushFeed(`-${Math.round(amount)} HP (${sourceLabel})`, 'border-l-rose-500');

  if (gameState.hp <= 0) {
    if (gameState.inCar) exitCurrentCar(true);
    clearWantedLevel();
    gameState.hp = gameState.maxHp;
    gameState.stamina = 100;
    gameState.cash = Math.max(0, gameState.cash - 50);
    climb.on = false;
    player.x = aura.hospitalSpawn ? aura.hospitalSpawn.x : -11.5;
    player.y = 0.18;
    player.z = aura.hospitalSpawn ? aura.hospitalSpawn.z : 18.5;
    player.vy = 0;
    player.grounded = true;
    player.peakAirY = 0.18;
    const wasted = document.getElementById('wasted-screen');
    if (wasted) {
      const cause = document.getElementById('wasted-cause');
      if (cause) cause.textContent = sourceLabel;
      wasted.style.display = 'flex';
      clearTimeout(wasted._t);
      wasted._t = setTimeout(() => { wasted.style.display = 'none'; }, 2600);
    }
    pushFeed(aura.hospitalSpawn ? 'REVIVED AT AURA GENERAL HOSPITAL (-$50 MEDICAL FEE)' : 'REVIVED AT CENTRAL PLAZA (-$50 MEDICAL FEE)', 'border-l-rose-500');
  }
  hooks.updateHUD();
}

// Menu Button Listeners
export function triggerMeteorLanding() {
  meteorDrop.active = true;
  meteorDrop.timer = 0;
  meteorDrop.x = -12;
  meteorDrop.y = 148;
  meteorDrop.z = -18;
  meteorDrop.vx = 0;
  meteorDrop.vy = -34;
  meteorDrop.vz = 0;
  meteorDrop.cameraShake = 0;

  if (meteorDrop.craterMesh) {
    worldRoot.remove(meteorDrop.craterMesh);
    meteorDrop.craterMesh = null;
  }
  if (meteorDrop.shockwaveMesh) {
    worldRoot.remove(meteorDrop.shockwaveMesh);
    meteorDrop.shockwaveMesh = null;
  }

  player.x = meteorDrop.x;
  player.y = meteorDrop.y;
  player.z = meteorDrop.z;
  player.vy = 0;
  player.yaw = 0.0;
  player.pitch = -0.68;
  gameState.isAiming = false;
  inputState.isPrimaryFireHeld = false;

  meteorGroup.visible = true;
  meteorGroup.position.set(player.x, player.y, player.z);
  meteorReticle.visible = true;
  document.getElementById('meteor-aim-banner').style.display = 'block';
  fpRoot.visible = false;
  tpRig.visible = false;

  sfx.meteorDive();
  pushFeed('AIM YOUR METEOR WITH MOUSE OR WASD!', 'border-l-amber-400');
}

export function updateZoneAndPrompts() {
  let zone = 'SUNNYVALE CITY';
  for (const ez of enterableZones) {
    if (player.x >= ez.minX && player.x <= ez.maxX && player.z >= ez.minZ && player.z <= ez.maxZ && player.y < 5.0) {
      zone = ez.name;
      break;
    }
  }
  if (zone === 'SUNNYVALE CITY') {
    if (player.x >= 164) zone = 'REDROCK DESERT';
    else if ((player.x >= 140 && player.x <= 164) || (player.z >= 87 && player.z <= 109 && player.y > 2.2)) zone = 'I-88 INTERSTATE FREEWAY';
    else if (biomeAt(player.x, player.z) !== 'city') zone = { alpine: 'FROSTPINE ALPINE', woods: 'EMERALD WOODS', cove: 'SUNSET COVE' }[biomeAt(player.x, player.z)];
    else if (Math.abs(player.x) < 17 && Math.abs(player.z) < 17) zone = 'CENTRAL PLAZA';
    else if (player.z < -72) zone = 'DOWNTOWN SKYSCRAPER DISTRICT';
    else if (player.x < -22 && player.z < -22) zone = 'COMMERCIAL DISTRICT';
    else if (player.x > 22 && player.z < -22) zone = 'BRICKWOOD APARTMENTS';
    else if (player.x > 22 && player.z > 22) zone = 'HARBOR CONTAINER YARD';
    else zone = 'SUBURBAN NEIGHBORHOOD';
  }
  gameState.zoneName = zone;

  const promptEl = document.getElementById('interact-prompt');
  const mantleEl = document.getElementById('mantle-prompt');

  if (meteorDrop.active) {
    promptEl.classList.add('hidden');
    mantleEl.classList.add('hidden');
    return;
  }

  if (gameState.inCar) {
    promptEl.classList.remove('hidden');
    document.getElementById('interact-key').textContent = 'F';
    document.getElementById('interact-text').textContent = 'EXIT VEHICLE';
    mantleEl.classList.add('hidden');
    return;
  }

  let nearRefill = null;
  for (const zoneObj of sausageRefillZones) {
    if (Math.hypot(player.x - zoneObj.x, player.z - zoneObj.z) < 3.1 && Math.abs(player.y - zoneObj.y) < 1.8) {
      nearRefill = zoneObj;
      break;
    }
  }

  if (nearRefill) {
    promptEl.classList.remove('hidden');
    document.getElementById('interact-key').textContent = 'E';
    document.getElementById('interact-text').textContent = `REFILL SAUSAGES (${gameState.hotdogAmmo}/${MAX_HOTDOG_AMMO})`;
  } else {
    const elev = getNearestElevatorPad();
    if (elev) {
      promptEl.classList.remove('hidden');
      document.getElementById('interact-key').textContent = 'F';
      document.getElementById('interact-text').textContent = elev.toRoof
        ? `RIDE ELEVATOR TO ROOF (${elev.sk.name})`
        : `RIDE ELEVATOR TO LOBBY`;
    } else {
      const nearCar = getNearestVehicle(4.2);
      let nearNpc = null;
      for (const npc of npcs) {
        if (!npc.spawned || npc.asleep) continue;
        if (Math.hypot(player.x - npc.x, player.z - npc.z) < 2.5 && Math.abs(player.y - 0.18) < 1.8) {
          nearNpc = npc;
          break;
        }
      }

      if (nearCar) {
        promptEl.classList.remove('hidden');
        document.getElementById('interact-key').textContent = 'F';
        document.getElementById('interact-text').textContent = `DRIVE ${nearCar.v.name}`;
      } else if (nearNpc) {
        promptEl.classList.remove('hidden');
        document.getElementById('interact-key').textContent = 'E';
        document.getElementById('interact-text').textContent = `TALK TO ${nearNpc.name}`;
      } else {
        promptEl.classList.add('hidden');
      }
    }
  }

  if (findMantleTarget()) mantleEl.classList.remove('hidden');
  else mantleEl.classList.add('hidden');
}

export function stepSimulation(dt, elapsed) {
  if (gameState.damageCooldown > 0) gameState.damageCooldown -= dt;
  if (gameState.speedBoostTimer > 0) gameState.speedBoostTimer -= dt;

  if (meteorDrop.active) {
    meteorDrop.timer += dt;

    const moveFwd = (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0) - (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0);
    const moveRight = (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);
    const fastDive = keys['ShiftLeft'] || keys['ShiftRight'] || keys['Space'];

    const fwdX = -Math.sin(player.yaw);
    const fwdZ = -Math.cos(player.yaw);
    const rightX = Math.cos(player.yaw);
    const rightZ = -Math.sin(player.yaw);

    const aimHorizMag = Math.max(0, Math.cos(player.pitch)) * 46;
    const targetVx = (fwdX * moveFwd + rightX * moveRight) * 68 + fwdX * aimHorizMag * 0.72;
    const targetVz = (fwdZ * moveFwd + rightZ * moveRight) * 68 + fwdZ * aimHorizMag * 0.72;
    const targetVy = fastDive ? -74 : -31;

    meteorDrop.vx += (targetVx - meteorDrop.vx) * Math.min(1, dt * 6.5);
    meteorDrop.vz += (targetVz - meteorDrop.vz) * Math.min(1, dt * 6.5);
    meteorDrop.vy += (targetVy - meteorDrop.vy) * Math.min(1, dt * 6.5);

    const meteorPosition = clampMeteorPosition(meteorDrop.x + meteorDrop.vx * dt, meteorDrop.z + meteorDrop.vz * dt);
    meteorDrop.x = meteorPosition.x;
    meteorDrop.z = meteorPosition.z;
    meteorDrop.y += meteorDrop.vy * dt;

    player.x = meteorDrop.x;
    player.y = meteorDrop.y;
    player.z = meteorDrop.z;

    const timeToImpact = Math.max(0.05, (meteorDrop.y - 0.18) / Math.max(12, Math.abs(meteorDrop.vy)));
    const predictedPosition = clampMeteorPosition(
      meteorDrop.x + meteorDrop.vx * timeToImpact * 0.55,
      meteorDrop.z + meteorDrop.vz * timeToImpact * 0.55
    );
    const predX = predictedPosition.x;
    const predZ = predictedPosition.z;
    const predSurfaceY = computeSupportFloor(predX, predZ, 90, 0.5);

    meteorReticle.visible = true;
    meteorReticle.position.set(predX, predSurfaceY + 0.08, predZ);
    meteorReticle.rotation.y += dt * 2.5;
    const pulseScale = 1 + Math.sin(elapsed * 10) * 0.12;
    meteorReticle.children[0].scale.setScalar(pulseScale);

    const targetLabelEl = document.getElementById('meteor-target-label');
    if (targetLabelEl) {
      const locTag = predX >= 164 ? 'REDROCK DESERT'
        : predZ < -72 ? 'DOWNTOWN SKYSCRAPERS'
        : (predX >= 140 || (predZ >= 87 && predZ <= 109)) ? 'I-88 FREEWAY'
        : 'SUNNYVALE CITY';
      targetLabelEl.textContent = `TARGET: ${locTag} (${Math.round(predX)}, ${Math.round(predZ)}) • ALT ${Math.max(0, Math.round(meteorDrop.y))}M`;
    }

    meteorGroup.visible = true;
    meteorGroup.position.set(player.x, player.y + 0.9, player.z);
    meteorGroup.lookAt(
      player.x + meteorDrop.vx * 0.25,
      player.y + 0.9 + meteorDrop.vy * 0.25,
      player.z + meteorDrop.vz * 0.25
    );
    meteorCore.rotation.x += dt * 9.5;
    meteorCore.rotation.y += dt * 7.2;

    spawnParticles(player.x, player.y + 1.1, player.z, 0xf97316, 3, 4.5);
    spawnParticles(player.x, player.y + 1.4, player.z, 0xfacc15, 2, 3.2);

    const diveFov = fastDive ? 92 : 78;
    if (Math.abs(camera.fov - diveFov) > 0.2) {
      camera.fov += (diveFov - camera.fov) * Math.min(1, dt * 8);
      camera.updateProjectionMatrix();
    }

    const camBackDist = 9.5;
    const camOffsetX = Math.sin(player.yaw) * Math.cos(player.pitch) * camBackDist;
    const camOffsetY = -Math.sin(player.pitch) * camBackDist + 2.4;
    const camOffsetZ = Math.cos(player.yaw) * Math.cos(player.pitch) * camBackDist;
    camera.position.set(player.x + camOffsetX, player.y + camOffsetY, player.z + camOffsetZ);
    camera.lookAt(
      player.x - Math.sin(player.yaw) * 14,
      Math.max(0.2, player.y + Math.sin(player.pitch) * 14 - 4),
      player.z - Math.cos(player.yaw) * 14
    );

    const surfaceAtMeteor = computeSupportFloor(player.x, player.z, player.y + 1.2, 0.5);
    if (player.y <= surfaceAtMeteor + 0.2) {
      meteorDrop.active = false;
      meteorGroup.visible = false;
      meteorReticle.visible = false;
      document.getElementById('meteor-aim-banner').style.display = 'none';

      player.y = surfaceAtMeteor;
      player.vy = 0;
      player.grounded = true;
      player.peakAirY = surfaceAtMeteor;
      player.pitch = -0.04;
      camera.fov = 72;
      camera.updateProjectionMatrix();

      sfx.meteorImpact();
      meteorDrop.cameraShake = 0.72;
      flashEdge('rgba(249, 115, 22, 0.65)');
      spawnParticles(player.x, player.y + 0.4, player.z, 0xf97316, 26, 14.0);
      spawnParticles(player.x, player.y + 0.4, player.z, 0xfacc15, 20, 12.0);
      spawnParticles(player.x, player.y + 0.4, player.z, 0x44403c, 16, 10.0);

      const crater = new THREE.Mesh(
        new THREE.CircleGeometry(3.4, 24),
        new THREE.MeshBasicMaterial({ color: 0x1c1917 })
      );
      crater.rotation.x = -Math.PI / 2;
      crater.position.set(player.x, player.y + 0.035, player.z);
      worldRoot.add(crater);
      meteorDrop.craterMesh = crater;

      const shock = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1.4, 28),
        new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
      );
      shock.rotation.x = -Math.PI / 2;
      shock.position.set(player.x, player.y + 0.06, player.z);
      worldRoot.add(shock);
      meteorDrop.shockwaveMesh = shock;
      meteorDrop.shockwaveLife = 0.65;

      for (const lp of lampPosts) {
        if (lp.state === 'standing' && Math.hypot(lp.x - player.x, lp.z - player.z) < 11.5) {
          knockOverLamppost(lp, Math.atan2(lp.x - player.x, lp.z - player.z), 4.2);
        }
      }

      pushFeed('METEOR TOUCHDOWN — LANDED AT YOUR TARGET!', 'border-l-amber-400');
    }

    updateZoneAndPrompts();
    hooks.updateHUD();
    return;
  }

  if (meteorDrop.shockwaveMesh) {
    meteorDrop.shockwaveLife -= dt;
    const sc = 1 + (0.65 - meteorDrop.shockwaveLife) * 26;
    meteorDrop.shockwaveMesh.scale.set(sc, sc, 1);
    meteorDrop.shockwaveMesh.material.opacity = Math.max(0, meteorDrop.shockwaveLife / 0.65);
    if (meteorDrop.shockwaveLife <= 0) {
      worldRoot.remove(meteorDrop.shockwaveMesh);
      meteorDrop.shockwaveMesh = null;
    }
  }
  if (meteorDrop.cameraShake > 0) {
    meteorDrop.cameraShake = Math.max(0, meteorDrop.cameraShake - dt);
  }

  if (gameState.wheelTimer > 0) {
    gameState.wheelTimer -= dt;
    if (gameState.wheelTimer <= 0) document.getElementById('radial-menu').style.display = 'none';
  }
  if (gameState.dialogueTimer > 0) {
    gameState.dialogueTimer -= dt;
    if (gameState.dialogueTimer <= 0) document.getElementById('npc-dialogue').style.display = 'none';
  }

  // Rapid-fire trigger while Left-Mouse Button is held down!
  if (
    inputState.isPrimaryFireHeld &&
    !gameState.inCar &&
    player.attackTimer <= 0 &&
    gameState.activeRightWeapon === 'hotdog_shooter' &&
    !gameState.inventoryOpen &&
    !gameState.mapOpen &&
    !gameState.settingsOpen
  ) {
    if (gameState.hotdogAmmo > 0) {
      triggerRightHandAttack();
    } else {
      inputState.isPrimaryFireHeld = false;
      sfx.uiClick();
      pushFeed('OUT OF SAUSAGES! REFILL AT AURA HOTDOGS OR PLAZA CART', 'border-l-rose-500');
    }
  }

  if (player.attackTimer > 0) {
    player.attackTimer = Math.max(0, player.attackTimer - dt);
    const progress = 1 - player.attackTimer / player.attackDuration;
    if (!player.hitApplied && progress >= 0.42) {
      player.hitApplied = true;
      evaluateMeleeHit();
    }
  }
  if (player.leftUseTimer > 0) {
    player.leftUseTimer = Math.max(0, player.leftUseTimer - dt);
  }

  const targetFov = (!gameState.inCar && gameState.isAiming && gameState.activeRightWeapon === 'hotdog_shooter')
    ? 34
    : (gameState.inCar ? 76 : 72);
  if (Math.abs(camera.fov - targetFov) > 0.15) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
  }

  if (gameState.inCar) {
    fpRoot.visible = false;
    tpRig.visible = false;

    stepVehicleDriving(dt, elapsed);

  } else {
    sfx.updateEngine(false, 0, false);

    if (player.mantle.active) {
      player.mantle.timer += dt;
      const t = Math.min(1, player.mantle.timer / player.mantle.duration);
      const ease = 1 - Math.pow(1 - t, 3);
      player.x = player.mantle.startX + (player.mantle.endX - player.mantle.startX) * ease;
      player.z = player.mantle.startZ + (player.mantle.endZ - player.mantle.startZ) * ease;
      player.y = player.mantle.startY + (player.mantle.endY - player.mantle.startY) * ease + Math.sin(t * Math.PI) * 0.34;
      if (t >= 1) {
        player.mantle.active = false;
        player.y = player.mantle.endY;
        player.grounded = true;
        player.peakAirY = player.y;
      }
    } else {
      const moveFwd = (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0) - (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0);
      const moveRight = (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);

      const wantsSprint = (keys['ShiftLeft'] || keys['ShiftRight']) && moveFwd > 0 && !player.crouching && !gameState.isAiming && gameState.stamina > 2;
      if (wantsSprint) {
        gameState.stamina = Math.max(0, gameState.stamina - 8.5 * dt);
        player.sprintCycle += dt * 15.5;
      } else {
        // Crouching replenishes stamina 3x quicker!
        const regenRate = player.crouching ? 48.0 : 16.0;
        gameState.stamina = Math.min(100, gameState.stamina + regenRate * dt);
        player.sprintCycle = 0;
      }

      const boost = gameState.speedBoostTimer > 0 ? 1.25 : 1.0;
      const pp_ = levelData.params.player;
      const msScale = pp_.moveSpeed / 4.7;
      const speed = (player.crouching ? 2.6 * msScale : gameState.isAiming ? 3.2 * msScale : wantsSprint ? pp_.moveSpeed * pp_.sprintMultiplier : pp_.moveSpeed) * boost * (isInWater(player.x, player.z) ? 0.55 : 1);

      const fwdX = -Math.sin(player.yaw);
      const fwdZ = -Math.cos(player.yaw);
      const rightX = Math.cos(player.yaw);
      const rightZ = -Math.sin(player.yaw);

      let vx = fwdX * moveFwd + rightX * moveRight;
      let vz = fwdZ * moveFwd + rightZ * moveRight;
      const len = Math.hypot(vx, vz);
      let tvx = 0, tvz = 0;
      if (len > 0.001) {
        tvx = (vx / len) * speed;
        tvz = (vz / len) * speed;
        player.walkCycle += dt * (wantsSprint ? 15.5 : 8.5);
      }
      const grip = player.grounded ? surfaceGrip(player.x, player.z) * (len > 0.001 ? 1 : 1.25) : (len > 0.001 ? 2.2 : 0.4);
      player.pvx = (player.pvx || 0) + (tvx - (player.pvx || 0)) * Math.min(1, grip * dt);
      player.pvz = (player.pvz || 0) + (tvz - (player.pvz || 0)) * Math.min(1, grip * dt);
      vx = player.pvx; vz = player.pvz;

      const nextX = player.x + vx * dt;
      const nextZ = player.z + vz * dt;
      const bodyH = player.crouching ? 1.22 : player.height;

      if (!collidesHorizontally(nextX, player.z, player.y, bodyH, player.radius)) player.x = nextX; else player.pvx = 0;
      if (!collidesHorizontally(player.x, nextZ, player.y, bodyH, player.radius)) player.z = nextZ; else player.pvz = 0;

      const previousY = player.y;
      player.vy -= 19.5 * dt * (player.vy < 0 ? 1.28 : (keys['Space'] ? 1 : 1.9));
      player.y += player.vy * dt;
      if (!player.grounded && player.y > player.peakAirY) player.peakAirY = player.y;

      const supportY = computeSupportFloor(player.x, player.z, previousY - 0.46, player.radius);
      if (player.y <= supportY && previousY >= supportY && player.vy <= 0) {
        if (!player.grounded) {
          const fallDist = player.peakAirY - supportY;
          if (fallDist > 3.6) {
            const fallDmg = Math.min(65, (fallDist - 3.6) * 8.5);
            applyPlayerDamage(fallDmg, 'FALL IMPACT');
          }
          player.landingDip = Math.min(0.24, Math.max(0.06, fallDist * 0.04));
        }
        player.y = supportY;
        player.vy = 0;
        player.grounded = true;
        player.peakAirY = supportY;
      } else {
        player.grounded = false;
      }
    }

    if (player.landingDip > 0) player.landingDip = Math.max(0, player.landingDip - dt * 1.4);
    player.coyote = player.grounded ? 0.12 : Math.max(0, (player.coyote || 0) - dt);

    const targetEye = player.crouching ? 1.12 : 1.62;
    player.eyeHeight += (targetEye - player.eyeHeight) * Math.min(1, dt * 14);
    const movingSpeed = (keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD']) && player.grounded;
    const isSprintingNow = (keys['ShiftLeft'] || keys['ShiftRight']) && (keys['KeyW'] || keys['ArrowUp']) && !player.crouching && !gameState.isAiming && gameState.stamina > 2 && movingSpeed;
    const bobY = movingSpeed ? Math.abs(Math.sin(player.walkCycle)) * (isSprintingNow ? 0.085 : 0.045) : 0;

    let swingPitch = 0;
    let punchZ = 0;
    let punchSwingX = 0;
    let punchYaw = 0;
    let punchRoll = 0;
    let recoilZ = 0;
    if (player.attackTimer > 0) {
      const t = 1 - player.attackTimer / player.attackDuration;
      const curve = Math.sin(t * Math.PI);
      if (gameState.activeRightWeapon === 'hotdog_shooter') {
        recoilZ = curve * 0.11;
        swingPitch = curve * 0.10;
      } else if (gameState.activeRightWeapon === 'fists') {
        punchZ = curve * 0.34;
        punchSwingX = curve * 0.22;
        punchYaw = curve * 0.68;
        punchRoll = curve * 0.45;
        swingPitch = curve * 0.18;
      } else {
        swingPitch = -curve * 1.15;
      }
    }
    const leftRaise = player.leftUseTimer > 0 ? Math.sin((1 - player.leftUseTimer / 0.32) * Math.PI) * 0.22 : 0;

    if (gameState.isAiming && gameState.activeRightWeapon === 'hotdog_shooter') {
      fpRight.pivot.visible = false;
      fpLeft.pivot.visible = false;
    } else {
      fpRight.pivot.visible = true;
      fpLeft.pivot.visible = true;
      const isRightHook = gameState.activeRightWeapon === 'fists' && player.punchCombo === 0 && player.attackTimer > 0;
      const isLeftHook = gameState.activeRightWeapon === 'fists' && player.punchCombo === 1 && player.attackTimer > 0;

      fpRight.pivot.position.set(
        0.32 - (isRightHook ? punchSwingX : 0),
        -0.26 - bobY * 0.5 + (isRightHook ? 0.05 : 0),
        -0.34 - (isRightHook ? punchZ : 0) + recoilZ
      );
      fpRight.pivot.rotation.set(
        swingPitch,
        isRightHook ? punchYaw : 0,
        isRightHook ? punchRoll : 0
      );

      fpLeft.pivot.position.set(
        -0.32 + (isLeftHook ? punchSwingX : 0),
        -0.26 - bobY * 0.5 + leftRaise + (isLeftHook ? 0.05 : 0),
        -0.34 - (isLeftHook ? punchZ : 0)
      );
      fpLeft.pivot.rotation.set(
        isLeftHook ? swingPitch : 0,
        isLeftHook ? -punchYaw : 0,
        isLeftHook ? -punchRoll : 0
      );
    }

    if (gameState.thirdPerson) {
      fpRoot.visible = false;
      tpRig.visible = true;
      tpRig.position.set(player.x, player.y + bobY - player.landingDip, player.z);
      tpRig.rotation.y = player.yaw;

      tpHip.rotation.x = 0;
      tpTorso.rotation.y = 0;
      tpArmL.rotation.set(0, 0, 0);
      tpArmR.rotation.set(0, 0, 0);
      tpElbowL.rotation.x = 0;
      tpElbowR.rotation.x = 0;
      tpLegL.rotation.set(0, 0, 0);
      tpLegR.rotation.set(0, 0, 0);
      tpKneeL.rotation.x = 0;
      tpKneeR.rotation.x = 0;

      if (!player.grounded) {
        // 3RD-PERSON JUMP ANIMATION (Rising Leap vs Mid-Air Landing Prep)
        const airBlend = Math.max(-1, Math.min(1, player.vy / 6.5));
        if (airBlend > 0.1) {
          tpHip.rotation.x = -0.14 * airBlend;
          tpLegL.rotation.x = -0.82 * airBlend;
          tpKneeL.rotation.x = 0.95 * airBlend;
          tpLegR.rotation.x = 0.42 * airBlend;
          tpKneeR.rotation.x = 0.25 * airBlend;
          tpArmL.rotation.x = -0.95 * airBlend;
          tpArmL.rotation.z = -0.22 * airBlend;
          tpElbowL.rotation.x = -0.45 * airBlend;
          tpArmR.rotation.x = 0.52 * airBlend;
          tpArmR.rotation.z = 0.22 * airBlend;
          tpElbowR.rotation.x = -0.45 * airBlend;
        } else {
          tpHip.rotation.x = -0.08;
          tpLegL.rotation.x = -0.34;
          tpKneeL.rotation.x = 0.42;
          tpLegR.rotation.x = -0.18;
          tpKneeR.rotation.x = 0.30;
          tpArmL.rotation.x = -0.48;
          tpArmL.rotation.z = -0.38;
          tpElbowL.rotation.x = -0.35;
          tpArmR.rotation.x = -0.48;
          tpArmR.rotation.z = 0.38;
          tpElbowR.rotation.x = -0.35;
        }
      } else if (isSprintingNow) {
        // 3RD-PERSON OLYMPIC SPRINTER ANIMATION
        const sPhase = player.walkCycle;
        const stride = Math.sin(sPhase);
        const oppStride = Math.sin(sPhase + Math.PI);

        tpHip.rotation.x = -0.26;
        tpTorso.rotation.y = -stride * 0.18;

        tpLegL.rotation.x = stride * 1.12;
        tpKneeL.rotation.x = Math.max(0.12, -stride * 1.15 + 0.35);

        tpLegR.rotation.x = oppStride * 1.12;
        tpKneeR.rotation.x = Math.max(0.12, -oppStride * 1.15 + 0.35);

        tpArmL.rotation.x = -stride * 1.18 - 0.15;
        tpArmL.rotation.z = -0.08;
        tpElbowL.rotation.x = -1.52;

        tpArmR.rotation.x = -oppStride * 1.18 - 0.15;
        tpArmR.rotation.z = 0.08;
        tpElbowR.rotation.x = -1.52;
      } else {
        const legSwing = movingSpeed ? Math.sin(player.walkCycle) * 0.58 : 0;
        tpLegL.rotation.x = legSwing;
        tpKneeL.rotation.x = movingSpeed ? Math.max(0, -legSwing * 0.55) : 0;
        tpLegR.rotation.x = -legSwing;
        tpKneeR.rotation.x = movingSpeed ? Math.max(0, legSwing * 0.55) : 0;

        tpArmL.rotation.x = -legSwing * 0.65 - leftRaise * 3.5;
        tpElbowL.rotation.x = movingSpeed ? -0.22 : -0.08;
        tpArmR.rotation.x = legSwing * 0.65;
        tpElbowR.rotation.x = movingSpeed ? -0.22 : -0.08;
      }

      if (gameState.activeRightWeapon === 'hotdog_shooter') {
        tpArmR.rotation.set(-1.48 + swingPitch, 0, 0);
        tpElbowR.rotation.x = -0.18;
      } else if (player.attackTimer > 0) {
        const t = 1 - player.attackTimer / player.attackDuration;
        const hookArc = Math.sin(t * Math.PI);
        if (gameState.activeRightWeapon === 'fists') {
          if (player.punchCombo === 0) {
            tpArmR.rotation.set(-1.35 * hookArc, 0, -0.78 * hookArc);
            tpElbowR.rotation.x = -0.85 * hookArc;
            tpTorso.rotation.y = 0.48 * hookArc;
          } else {
            tpArmL.rotation.set(-1.35 * hookArc, 0, 0.78 * hookArc);
            tpElbowL.rotation.x = -0.85 * hookArc;
            tpTorso.rotation.y = -0.48 * hookArc;
          }
        } else {
          tpArmR.rotation.x = swingPitch * 1.4;
          tpElbowR.rotation.x = -0.35;
        }
      }

      tpHip.scale.y = player.crouching ? 0.72 : 1.0;
      tpHip.position.y = player.crouching ? 0.65 : 0.90;

      const pivotY = player.y + (player.crouching ? 1.15 : 1.56);
      const camDist = 3.65;
      const idealX = player.x + Math.sin(player.yaw) * Math.cos(player.pitch) * camDist;
      const idealY = pivotY - Math.sin(player.pitch) * camDist + 0.35;
      const idealZ = player.z + Math.cos(player.yaw) * Math.cos(player.pitch) * camDist;

      let safeDist = camDist;
      for (let s = 0.25; s <= 1.0; s += 0.25) {
        const tx = player.x + (idealX - player.x) * s;
        const tz = player.z + (idealZ - player.z) * s;
        const ty = pivotY + (idealY - pivotY) * s;
        if (collidesHorizontally(tx, tz, ty - 0.3, 0.5, 0.25)) {
          safeDist = Math.max(0.75, camDist * (s - 0.22));
          break;
        }
      }
      const ratio = safeDist / camDist;
      camera.position.set(
        player.x + (idealX - player.x) * ratio,
        Math.max(0.55, terrainH(player.x + (idealX - player.x) * ratio, player.z + (idealZ - player.z) * ratio) + 0.7, pivotY + (idealY - pivotY) * ratio),
        player.z + (idealZ - player.z) * ratio
      );
      camera.lookAt(player.x - Math.sin(player.yaw) * 4, pivotY + Math.sin(player.pitch) * 4, player.z - Math.cos(player.yaw) * 4);
    } else {
      fpRoot.visible = true;
      tpRig.visible = false;
      const shakeX = meteorDrop.cameraShake > 0 ? (Math.random() - 0.5) * meteorDrop.cameraShake * 0.45 : 0;
      const shakeY = meteorDrop.cameraShake > 0 ? (Math.random() - 0.5) * meteorDrop.cameraShake * 0.45 : 0;
      camera.position.set(player.x + shakeX, player.y + player.eyeHeight + bobY - player.landingDip + shakeY, player.z);
      camera.rotation.y = player.yaw;
      camera.rotation.x = player.pitch;
    }
  }

  for (let i = worldPickups.length - 1; i >= 0; i--) {
    const p = worldPickups[i];
    p.phase += dt * 2.8;
    p.group.rotation.y += dt * 1.8;
    p.group.position.y = p.baseY + Math.sin(p.phase) * 0.12;

    if (Math.hypot(player.x - p.x, player.z - p.z) < 1.35 && Math.abs(player.y - p.y) < 1.8) {
      if (p.type === 'right') {
        if (!gameState.rightWeapons.includes(p.id)) {
          gameState.rightWeapons.push(p.id);
        }
        gameState.activeRightWeapon = p.id;
        if (p.id === 'hotdog_shooter') {
          gameState.hotdogAmmo = MAX_HOTDOG_AMMO;
        }
        sfx.pickup();
        syncEquippedMeshes();
        pushFeed(`EQUIPPED ${RIGHT_WEAPONS[p.id].name.toUpperCase()}`, 'border-l-amber-400');
        worldRoot.remove(p.group);
        freeGeo(p.group);
        worldPickups.splice(i, 1);
      } else if (addLeftItemToBag(p.id, 1)) {
        sfx.pickup();
        syncEquippedMeshes();
        pushFeed(`COLLECTED ${LEFT_ITEMS[p.id].name.toUpperCase()}`, 'border-l-sky-400');
        worldRoot.remove(p.group);
        freeGeo(p.group);
        worldPickups.splice(i, 1);
      }
    }
  }

  for (let i = particleBursts.length - 1; i >= 0; i--) {
    const pt = particleBursts[i];
    pt.life -= dt;
    pt.vy -= 14 * dt;
    pt.mesh.position.x += pt.vx * dt;
    pt.mesh.position.y += pt.vy * dt;
    pt.mesh.position.z += pt.vz * dt;
    pt.mesh.scale.setScalar(Math.max(0.01, pt.life));
    if (pt.life <= 0) {
      worldRoot.remove(pt.mesh);
      particleBursts.splice(i, 1);
    }
  }

  for (let i = 0; i < aviationBeacons.length; i++) {
    const pulse = Math.sin(elapsed * 4.5 + i * 1.4) > 0.25;
    aviationBeacons[i].visible = pulse;
  }

  updateProjectileWieners(dt);
  updateLampposts(dt, elapsed);
  updateBuildingLods();
  updateSkyscraperInteriors();
  updateNPCs(dt, elapsed);

  const sunY = Math.max(0, player.y);
  sunLight.position.set(player.x + 78, sunY + 130, player.z + 52);
  sunLight.target.position.set(player.x, sunY, player.z);
  sunLight.target.updateMatrixWorld();

  updateZoneAndPrompts();
  hooks.updateHUD();
}

export function enhancePerFrame(dt, elapsed) {
  for (const n of npcs) {
    if (n.mesh && n.mesh.userData.face) {
      const bl = n.asleep || ((elapsed * 0.8 + n.id * 1.37) % 3.6) < 0.13;
      setFaceMood(n.mesh.userData.face, n.asleep ? 'neutral' : n.hostile ? 'angry' : n.fleeTimer > 0 ? 'scared' : (n.age === 'child' ? 'happy' : 'neutral'), bl);
    }
  }
  updatePickpocket(dt);
  updateBiomeAtmosphere(dt, elapsed);
  auraFrame(dt, elapsed);
  if (!pp.hinted && elapsed > 6) { pp.hinted = true; pushFeed('TIP: SNEAK BEHIND A CITIZEN & HOLD [G] TO PICKPOCKET', 'border-l-emerald-400'); }
}

export function nearestManhole(r){for(let i=0;i<manholes.length;i++)if(Math.hypot(player.x-manholes[i][0],player.z-manholes[i][1])<r)return i;return -1;}

export function startClimb(dir,i){climb.on=true;climb.dir=dir;if(dir<0)reviveRats();climb.t=0;climb.i=i;sfx.mantle();
  pushFeed(dir<0?'CLIMBING DOWN INTO THE SEWERS':'CLIMBING OUT',dir<0?'border-l-emerald-400':'border-l-sky-400');}

export function climbFrame(dt){
  if(!climb.on)return;
  climb.t=Math.min(1,climb.t+dt/2.2);
  const e=climb.t*climb.t*(3-2*climb.t),top=.18,bot=SFY+.02,m=manholes[climb.i];
  player.x=m[0];player.z=m[1];player.vy=0;player.grounded=true;
  player.y=climb.dir<0?top+(bot-top)*e:bot+(top-bot)*e;player.peakAirY=player.y;
  if(climb.t>=1){climb.on=false;manholeCovers[climb.i].visible=true;}
}

export const hazeC=new THREE.Color(0xb8d4ea);

export function auraFrame(dt,t){
  climbFrame(dt);ratFrame(dt,t);if(aura.ahCull)aura.ahCull(dt);
  const u=under();
  if(u!==AT.on){AT.on=u;if(u){scene.background=new THREE.Color(0x070a09);skyGroup.visible=false;}else{scene.background=AT.bg;{const hi=gameState.settings.graphics==='high';skyGroup.visible=hi;sunLight.intensity=hi?1.65:1.45;hemiLight.intensity=hi?.96:.88;}}sewerLights.forEach(l=>l.visible=u);uLight.visible=u;}
  if(u){scene.fog.color.set(0x0a100d);scene.fog.density=.016;sunLight.intensity=0;hemiLight.intensity=.22;uLight.position.set(player.x,player.y+2.2,player.z);
    sewerLights.forEach((l,i)=>{if(i<10&&Math.random()<.01)l.intensity=10+Math.random()*30;else if(i<10)l.intensity+=(30-l.intensity)*.1;});}
  else if(player.z<-175){scene.fog.color.lerp(hazeC,.02);}
  copFrame(dt,t);suspFrame(dt,t);
  const cp=document.getElementById('ao-compass');if(cp){const d=['N','NE','E','SE','S','SW','W','NW'][((Math.round(((-player.yaw%6.283)+6.283)%6.283/.7854))+4)%8];cp.textContent=u?`SEWERS  ·  DEPTH ${Math.round(-player.y)}m`:`${d}  ·  ALT ${Math.max(0,Math.round(player.y))}m`;}
  const tp=document.getElementById('ao-tip');let msg='';
  if(!gameState.inCar){if(u){for(let i=0;i<manholes.length;i++)if(Math.hypot(player.x-manholes[i][0],player.z-manholes[i][1])<3.2)msg='[F] CLIMB LADDER TO SURFACE';}
    else{const i=nearestManhole(2.4);if(i>=0)msg=manholeOpen[i]?'[F] CLIMB DOWN':'[F] OPEN MANHOLE';else if(aura.ahHint){const h2=aura.ahHint();if(h2)msg=h2;}}}
  if(tp){tp.style.display=msg?'block':'none';tp.textContent=msg;}
}
hooks.getRightMountWorldPosition = (out) => fpRight.itemMount.getWorldPosition(out);

/** Push levelData.params into the live game tables (weapon stats, HP, cash, gearbox caps). */
export function applyLevelParams(data = levelData) {
  const p = data.params;
  for (const id of Object.keys(p.weapons || {})) {
    if (RIGHT_WEAPONS[id]) {
const w = p.weapons[id];
if (Number.isFinite(w.damage)) RIGHT_WEAPONS[id].damage = w.damage;
if (Number.isFinite(w.cooldown)) RIGHT_WEAPONS[id].cooldown = w.cooldown;
if (Number.isFinite(w.reach)) RIGHT_WEAPONS[id].reach = w.reach;
    }
  }
  gameState.maxHp = p.player.maxHp;
  gameState.hp = gameState.maxHp;
  gameState.cash = p.player.startCash;
  (p.vehicles.gearCapsMph || []).forEach((mph, i) => { if (i < GEAR_CAPS_MPH.length && Number.isFinite(mph)) GEAR_CAPS_MPH[i] = mph; });
}

// Register late-bound implementations for lower layers (see state.js).
Object.assign(hooks, { syncEquippedMeshes, applyPlayerDamage });
