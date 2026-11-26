import * as THREE from 'three';
import { levelData } from './levelData.js';
import { MAX_HOTDOG_AMMO, SFY, WORLD_BOUNDS, aura, aviationBeacons, biomeAt, climb, collidesHorizontally, computeSupportFloor, enterableZones, flashEdge, gameState, hazardBarrels, hooks, inputState, isInWater, keys, lampPosts, manholeCovers, manholeOpen, manholes, meteorDrop, npcs, particleBursts, player, pushFeed, sausageRefillZones, sewerLights, skyscrapers, smashableCrates, surfaceGrip, terrainH, under, worldBoxes, worldPickups } from './state.js';
import { AT, camera, hemiLight, makeMat, meteorCore, meteorGroup, meteorReticle, renderer, scene, skyGroup, sunLight, uLight, worldRoot } from './engine.js';
import { applyModelPreset, loadTexture } from './assets.js';
import { sfx } from './audio.js';
import { LEFT_ITEMS, RIGHT_WEAPONS, addLeftItemToBag, buildLeftItemMesh, buildRightWeaponMesh, destroyCrate, destroyBarrel, fireBallisticWiener, freeGeo, spawnParticles, spawnWorldPickup, updateProjectileWieners } from './items.js';
import { GEAR_CAPS_MPH, exitCurrentCar, getNearestVehicle, stepVehicleDriving, suspFrame } from './vehicles.js';
import { knockOverLamppost, updateBiomeAtmosphere, updateBuildingLods, updateLampposts, updateSkyscraperInteriors } from './world.js';
import { clearWantedLevel, copFrame, damageNpc, makeFace, pp, ratFrame, reviveRats, setFaceMood, updateNPCs, updatePickpocket } from './npcs.js';
import { getWaterBedAt, getWaterBodyAt, getWaterHeightAt, isSwimming, sampleOceanWave, swimState } from './water.js';

function clampMeteorPosition(x, z) {
  return {
    x: Math.max(WORLD_BOUNDS.minX + player.radius, Math.min(WORLD_BOUNDS.maxX - player.radius, x)),
    z: Math.max(WORLD_BOUNDS.minZ + player.radius, Math.min(WORLD_BOUNDS.maxZ - player.radius, z))
  };
}

function makeSfxPool(src, size = 3, volume = 0.8) {
  const pool = [];
  for (let i = 0; i < size; i++) {
    const a = new Audio(src);
    a.preload = 'auto';
    a.volume = volume;
    pool.push(a);
  }
  let cursor = 0;
  return () => {
    if (gameState.settings && gameState.settings.muted) return;
    const a = pool[cursor++ % pool.length];
    try {
      a.currentTime = 0;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {            }
  };
}
const punchSfx = [
  makeSfxPool('assets/audio/punch1.mp3', 2, 0.85),
  makeSfxPool('assets/audio/punch2.mp3', 2, 0.85),
  makeSfxPool('assets/audio/punch3.mp3', 2, 0.85)
];
let punchSfxCursor = 0;
function playPunchSfx() { punchSfx[punchSfxCursor++ % punchSfx.length](); }
const playHurtSfx = makeSfxPool('assets/audio/hurt.mp3', 2, 0.9);

const flameTexture = loadTexture('assets/textures/flame.png');
flameTexture.colorSpace = THREE.SRGBColorSpace;
flameTexture.wrapS = THREE.ClampToEdgeWrapping;
flameTexture.wrapT = THREE.ClampToEdgeWrapping;
const flameMat = new THREE.MeshBasicMaterial({
  map: flameTexture, transparent: true, opacity: 0.95,
  depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
});
const meteorFlame = new THREE.Group();
const meteorFlamePlanes = [];
{
  const FW = 2.3, FL = 4.6;      
  const flameGeo = new THREE.PlaneGeometry(FW, FL);
  flameGeo.translate(0, FL / 2, 0);         
  for (const spin of [0, Math.PI / 2]) {
    const wrap = new THREE.Group();
    wrap.rotation.x = -Math.PI / 2;        
    const plane = new THREE.Mesh(flameGeo, flameMat);
    plane.rotation.y = spin;
    plane.renderOrder = 5;
    wrap.add(plane);
    meteorFlame.add(wrap);
    meteorFlamePlanes.push(plane);
  }
  meteorFlame.position.set(0, 0, -0.55);
  meteorGroup.add(meteorFlame);
}

const clothTextures = (() => {
  const size = 128;
  const weaveCanvas = document.createElement('canvas');
  weaveCanvas.width = size;
  weaveCanvas.height = size;
  const wCtx = weaveCanvas.getContext('2d');
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d');
  const wImg = wCtx.createImageData(size, size);
  const bImg = bCtx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const warp = Math.sin((x / 4) * Math.PI * 2);
      const weft = Math.sin((y / 4) * Math.PI * 2);
      const twill = Math.sin(((x + y) / 8) * Math.PI * 2) * 0.35;
      const grain = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      const thread = (warp * 0.4 + weft * 0.4 + twill) * 0.5 + (grain - 0.5) * 0.18;
      const albedoVal = Math.max(215, Math.min(255, Math.round(238 + thread * 17)));
      wImg.data[idx] = albedoVal;
      wImg.data[idx + 1] = albedoVal;
      wImg.data[idx + 2] = albedoVal;
      wImg.data[idx + 3] = 255;
      const bumpVal = Math.max(0, Math.min(255, Math.round(128 + thread * 95)));
      bImg.data[idx] = bumpVal;
      bImg.data[idx + 1] = bumpVal;
      bImg.data[idx + 2] = bumpVal;
      bImg.data[idx + 3] = 255;
    }
  }
  wCtx.putImageData(wImg, 0, 0);
  bCtx.putImageData(bImg, 0, 0);
  const map = new THREE.CanvasTexture(weaveCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(3, 3);
  if ('colorSpace' in map && THREE.SRGBColorSpace) map.colorSpace = THREE.SRGBColorSpace;
  map.needsUpdate = true;
  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(3, 3);
  bumpMap.needsUpdate = true;
  return { map, bumpMap };
})();
function makeClothMat(color) {
  const mat = makeMat(color);
  mat.map = clothTextures.map;
  mat.bumpMap = clothTextures.bumpMap;
  mat.bumpScale = 0.018;
  mat.roughnessMap = clothTextures.bumpMap;
  mat.roughness = Math.max(mat.roughness ?? 0.85, 0.88);
  mat.needsUpdate = true;
  return mat;
}
export const fpRoot = new THREE.Group();
camera.add(fpRoot);
export const skinMat = makeMat(0xe2a87e);
export const sleeveMat = makeClothMat(0x1e293b);
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

export function buildPlayerRigMesh(params = {}) {
  const toHex = (c, d) => (c === undefined || c === null || c === '') ? d : (typeof c === 'number' ? c : new THREE.Color(c).getHex());
  const bodyColor = toHex(params.bodyColor, 0x1e293b);
  const accentColor = toHex(params.accentColor, 0x0f172a);
  const shirtClothMat = makeClothMat(bodyColor);
  const pantsClothMat = makeClothMat(accentColor);
  const tpRig = new THREE.Group();
  const tpHip = new THREE.Group();
  tpHip.position.y = 0.90;
  tpRig.add(tpHip);
  const tpTorso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.24), shirtClothMat);
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
    const upperArm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.27, 0.12), shirtClothMat);
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
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.38, 0.15), pantsClothMat);
    thigh.position.y = -0.19;
    thigh.castShadow = true;
    const kneeJoint = new THREE.Group();
    kneeJoint.position.set(0, -0.37, 0);
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.37, 0.135), pantsClothMat);
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

const LEG_BREAK_FALL = 7.6;
const legBreak = { active: false, t: 0, dur: 3.6, severity: 0.5 };
function triggerLegBreak(fallDist) {
  legBreak.active = true;
  legBreak.t = 0;
  legBreak.dur = THREE.MathUtils.clamp(2.6 + (fallDist - LEG_BREAK_FALL) * 0.12, 2.6, 5.2);
  legBreak.severity = THREE.MathUtils.clamp(0.4 + (fallDist - LEG_BREAK_FALL) / 12, 0.4, 1);
  player.pvx = 0;
  player.pvz = 0;
  player.slideTimer = 0;
  player.airSlideReady = false;
  player.crouching = false;
  player.coyote = 0;
  sfx.hit();
  flashEdge('rgba(239, 68, 68, 0.55)');
  spawnParticles(player.x, player.y + 0.12, player.z, 0xd1d5db, 12, 5.0);
  pushFeed('LEGS GAVE OUT ON IMPACT — GIVE THEM A SECOND', 'border-l-rose-500');
}
function clearLegBreak() {
  legBreak.active = false;
  legBreak.t = 0;
}
function legBreakPose() {
  const t = legBreak.t, d = legBreak.dur;
  const downT = 0.4, riseLen = 1.5, riseStart = d - riseLen;
  if (t < downT) return { k: t / downT, phase: 'down', riseK: 0 };
  if (t < riseStart) return { k: 1, phase: 'hold', riseK: 0 };
  const r = THREE.MathUtils.clamp((t - riseStart) / riseLen, 0, 1);
  const ease = r * r * (3 - 2 * r);
  return { k: 1 - ease, phase: 'rise', riseK: ease };
}

let wasSwimming = false;
let swimO2Warned = false;
let swimDrownT = 0;
function swimInputActive() {
  return Boolean(keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD']
    || keys['ArrowUp'] || keys['ArrowDown'] || keys['ArrowLeft'] || keys['ArrowRight']);
}
function swimDiveHeld() {
  return Boolean(keys['KeyC'] || keys['ControlLeft'] || keys['ControlRight']);
}
function swimSprintHeld() {
  return Boolean(keys['ShiftLeft'] || keys['ShiftRight']);
}
function clearSwimPosture() {
  swimState.active = false;
  swimState.submerged = false;
  swimState.wading = false;
  swimState.vy = 0;
  swimState.oxygen = swimState.maxOxygen;
  swimState.drownTick = 0;
  swimState.lastBodyId = null;
  swimO2Warned = false;
  swimDrownT = 0;
  wasSwimming = false;
  tpHip.rotation.set(0, 0, 0);
  tpHead.rotation.set(0, 0, 0);
  tpTorso.rotation.set(0, 0, 0);
  camera.rotation.z = 0;
}

function steerSwimVertical(dt, elapsed, yBeforeWater) {
  if (player.mantle.active || climb.on) return;
  const wb = getWaterBodyAt(player.x, player.z);
  if (!wb) return;
  const surf = getWaterHeightAt(player.x, player.z, elapsed);
  if (surf === null) return;
  const bedRaw = getWaterBedAt(player.x, player.z);
  const bed = bedRaw !== null ? bedRaw : surf - 6;
  const fwd = Boolean(keys['KeyW'] || keys['ArrowUp']);
  const back = Boolean(keys['KeyS'] || keys['ArrowDown']);
  const pitch = player.pitch;        
  const wantDive = swimDiveHeld() || (fwd && pitch < -0.18) || (back && pitch > 0.35);
  const wantSurface = Boolean(keys['Space']) || (fwd && pitch > 0.18) || (back && pitch < -0.35);
  const waterDy = player.y - yBeforeWater;
  let dy = waterDy;
  if (wantDive && !wantSurface) {
    const speed = swimSprintHeld() ? 4.8 : 3.3;
    swimState.vy += (-speed - swimState.vy) * Math.min(1, dt * 8);
    dy = swimState.vy * dt;         
  } else if (wantSurface && !wantDive) {
    const nearSurface = player.y >= surf - 0.62;
    const target = nearSurface ? 0.6 : 3.1;
    swimState.vy += (target - swimState.vy) * Math.min(1, dt * 8);
    dy = Math.max(waterDy, swimState.vy * dt);
    if (nearSurface && player.y + dy > surf - 0.35) {
      dy = (surf - 0.35) - player.y;
      swimState.vy = Math.min(swimState.vy, 0.4);
    }
  } else if (swimState.submerged) {
    swimState.vy *= Math.pow(0.2, dt);
    dy = THREE.MathUtils.clamp(waterDy, -0.5 * dt, 0.45 * dt);
  }
  player.y = THREE.MathUtils.clamp(yBeforeWater + dy, bed + 0.32, surf + 0.45);
  const headY = player.y + 1.05;
  swimState.submerged = headY < surf - 0.06;
  if (!swimState.submerged && swimState.vy > 0 && player.y >= surf - 0.62) swimState.vy = 0;
  swimState.pitch = pitch;
}

function animateSwimRig(dt, elapsed) {
  const wb = getWaterBodyAt(player.x, player.z);
  const wave = wb ? sampleOceanWave(player.x, player.z, elapsed, wb.waveScale) : 0;
  const ph = swimState.strokePhase;
  const moving = swimInputActive();
  const sprinting = moving && swimSprintHeld();
  const lookPitch = THREE.MathUtils.clamp(swimState.pitch || 0, -1, 1);
  const descending = swimState.vy < -1.1 || swimDiveHeld();
  const diving = swimState.submerged && descending;
  const ascending = swimState.vy > 1.2 || Boolean(keys['Space']);
  const amp = moving ? (sprinting ? 1.3 : 1.0) : 0.5;
  const blend = Math.min(1, dt * 9);
  tpRig.position.set(
    player.x,
    player.y - 0.12 + wave * 0.5 + Math.sin(ph * 2) * 0.03 * amp,
    player.z
  );
  tpRig.rotation.y = swimState.yaw + Math.PI;
  let targetPitch;
  if (diving) targetPitch = -1.66;
  else if (swimState.submerged && moving) targetPitch = THREE.MathUtils.clamp(-1.30 + lookPitch * 0.85, -1.9, -0.55);
  else if (ascending) targetPitch = -1.02;
  else if (moving) targetPitch = -1.34;
  else targetPitch = -0.40;
  tpHip.rotation.x += (targetPitch - tpHip.rotation.x) * blend;
  tpHip.rotation.z = Math.sin(ph) * 0.17 * amp;              
  tpHip.position.y = 0.90;
  tpHip.scale.y = 1;
  tpTorso.rotation.y = Math.sin(ph) * 0.14 * amp;
  tpHead.rotation.y = (!swimState.submerged && moving) ? Math.sin(ph) * 0.38 : 0;
  tpHead.rotation.x = diving ? 0.25 : 0;
  if (diving) {
    const kick = Math.sin(ph * 1.4);
    tpArmL.rotation.set(1.95 + kick * 0.12, 0, -0.12);
    tpArmR.rotation.set(1.95 - kick * 0.12, 0, 0.12);
    tpElbowL.rotation.x = 0.12;
    tpElbowR.rotation.x = 0.12;
    tpLegL.rotation.x = kick * 0.22;
    tpLegR.rotation.x = kick * 0.22;
    tpKneeL.rotation.x = 0.18 + Math.max(0, -kick) * 0.2;
    tpKneeR.rotation.x = 0.18 + Math.max(0, -kick) * 0.2;
  } else if (moving) {
    const l = Math.sin(ph), r = Math.sin(ph + Math.PI);
    tpArmL.rotation.set(1.15 + l * 1.55 * amp, 0, -0.18 - Math.max(0, l) * 0.42);
    tpArmR.rotation.set(1.15 + r * 1.55 * amp, 0, 0.18 + Math.max(0, r) * 0.42);
    tpElbowL.rotation.x = 0.35 + Math.max(0, Math.sin(ph + 0.7)) * 1.0;
    tpElbowR.rotation.x = 0.35 + Math.max(0, Math.sin(ph + Math.PI + 0.7)) * 1.0;
    tpLegL.rotation.x = l * 0.42 * amp;
    tpLegR.rotation.x = r * 0.42 * amp;
    tpKneeL.rotation.x = 0.12 + Math.max(0, -l) * 0.38;
    tpKneeR.rotation.x = 0.12 + Math.max(0, -r) * 0.38;
  } else {
    const s = Math.sin(ph * 0.8), c = Math.cos(ph * 0.8);
    tpArmL.rotation.set(0.55 + s * 0.22, 0, -0.95 - c * 0.18);
    tpArmR.rotation.set(0.55 - s * 0.22, 0, 0.95 + c * 0.18);
    tpElbowL.rotation.x = 0.65 + s * 0.2;
    tpElbowR.rotation.x = 0.65 - s * 0.2;
    tpLegL.rotation.x = s * 0.3;
    tpLegR.rotation.x = -s * 0.3;
    tpKneeL.rotation.x = 0.55 + Math.max(0, s) * 0.3;
    tpKneeR.rotation.x = 0.55 + Math.max(0, -s) * 0.3;
  }
}
function animateSwimFirstPerson() {
  const ph = swimState.strokePhase;
  const descending = swimState.vy < -1.1 || swimDiveHeld();
  const diving = swimState.submerged && descending;
  fpRight.pivot.visible = true;
  fpLeft.pivot.visible = true;
  if (diving) {
    fpRight.pivot.position.set(0.17, -0.20, -0.52);
    fpLeft.pivot.position.set(-0.17, -0.20, -0.52);
    fpRight.pivot.rotation.set(1.15, 0, 0.10);
    fpLeft.pivot.rotation.set(1.15, 0, -0.10);
    return;
  }
  const l = Math.sin(ph), r = Math.sin(ph + Math.PI);
  fpRight.pivot.position.set(0.30 + r * 0.06, -0.24 + Math.max(0, r) * 0.10, -0.34 - Math.max(0, r) * 0.30);
  fpRight.pivot.rotation.set(0.45 + r * 0.85, r * 0.12, r * 0.18);
  fpLeft.pivot.position.set(-0.30 + l * 0.06, -0.24 + Math.max(0, l) * 0.10, -0.34 - Math.max(0, l) * 0.30);
  fpLeft.pivot.rotation.set(0.45 + l * 0.85, l * 0.12, -l * 0.18);
}
function updateSwimFeedback(dt) {
  if (swimState.submerged) {
    if (swimState.oxygen <= 0) {
      swimDrownT += dt;
      if (swimDrownT >= 0.6) {
        swimDrownT = 0;
        applyPlayerDamage(5, 'DROWNING');
      }
    } else if (swimState.oxygen < 25 && !swimO2Warned) {
      swimO2Warned = true;
      flashEdge('rgba(56, 189, 248, 0.35)');
      pushFeed('OXYGEN LOW — LOOK UP + [W] TO SURFACE', 'border-l-cyan-400');
    }
  } else {
    swimDrownT = 0;
    if (swimState.oxygen > 60) swimO2Warned = false;
  }
  const sprinting = swimInputActive() && swimSprintHeld();
  gameState.stamina = Math.max(0, Math.min(100, gameState.stamina + (sprinting ? -7 : 10) * dt));
}

export function findMantleTarget() {
  if (gameState.inCar || player.mantle.active || meteorDrop.active || legBreak.active) return null;
  if (swimState.active && swimState.submerged) return null;
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
  if (gameState.inCar || meteorDrop.active || legBreak.active) return null;
  for (let i = 0; i < skyscrapers.length; i++) {
    const sk = skyscrapers[i];
    const lobbyDx = player.x - sk.lobbyPad.x, lobbyDz = player.z - sk.lobbyPad.z;
    if (lobbyDx * lobbyDx + lobbyDz * lobbyDz < 4.84 && Math.abs(player.y - sk.lobbyPad.y) < 1.5) {
      return { sk, toRoof: true, dest: sk.roofPad };
    }
    const roofDx = player.x - sk.roofPad.x, roofDz = player.z - sk.roofPad.z;
    if (roofDx * roofDx + roofDz * roofDz < 5.76 && Math.abs(player.y - sk.roofPad.y) < 1.8) {
      return { sk, toRoof: false, dest: sk.lobbyPad };
    }
  }
  return null;
}
export function triggerRightHandAttack() {
  if (gameState.inCar || player.attackTimer > 0 || meteorDrop.active || legBreak.active) return;
  const w = RIGHT_WEAPONS[gameState.activeRightWeapon] || RIGHT_WEAPONS.fists;
  player.attackDuration = w.cooldown;
  player.attackTimer = w.cooldown;
  player.hitApplied = false;
  player._copHit = false;
  if (w.isRanged && w.id === 'hotdog_shooter') {
    fireBallisticWiener();
    player.hitApplied = true;
  } else {
    if (w.id === 'fists') {
      player.punchCombo = (player.punchCombo + 1) % 2;
      playPunchSfx();        
    } else {
      sfx.swing();
    }
  }
}
export function evaluateMeleeHit() {
  const w = RIGHT_WEAPONS[gameState.activeRightWeapon] || RIGHT_WEAPONS.fists;
  if (w.isRanged) return;
  const fwdX = -Math.sin(player.yaw);
  const fwdZ = -Math.cos(player.yaw);
  const reach = w.reach;
  const guest = hooks.mpIsGuest();
  for (let i = smashableCrates.length - 1; i >= 0; i--) {
    const c = smashableCrates[i];
    const dx = c.x - player.x;
    const dz = c.z - player.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= reach && Math.abs(c.y - player.y) < 1.6) {
      const dot = dist > 0.01 ? (dx * fwdX + dz * fwdZ) / dist : 1;
      if (dot > 0.45) {
        sfx.hit();
        spawnParticles(c.x, c.y + 0.55, c.z, 0xd97706, 8, 4.5);
        if (guest) {
          hooks.mpWorldEvent({ t: 'crate_hit', netId: c.netId, a: w.damage });
        } else {
          c.hp -= w.damage;
          if (c.hp <= 0) {
            sfx.smash();
            spawnParticles(c.x, c.y + 0.55, c.z, 0x92400e, 14, 6.5);
            const lootRec = destroyCrate(c, true);
            hooks.mpWorldEvent({
              t: 'crate_dead', netId: c.netId, x: c.x, y: c.y, z: c.z,
              loot: lootRec ? { netId: lootRec.netId, type: lootRec.type, id: lootRec.id, x: lootRec.x, y: lootRec.y, z: lootRec.z } : null
            });
            pushFeed('CRATE SMASHED!', 'border-l-amber-400');
          }
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
  playHurtSfx();        
  flashEdge('rgba(239, 68, 68, 0.48)');
  pushFeed(`-${Math.round(amount)} HP (${sourceLabel})`, 'border-l-rose-500');
  if (gameState.hp <= 0) {
    if (gameState.inCar) exitCurrentCar(true);
    if (hooks.mpIsGuest()) {
      hooks.mpWorldEvent({ t: 'died' });       
    } else {
      clearWantedLevel();
      hooks.mpWorldEvent({ t: 'player_died' });
    }
    gameState.hp = gameState.maxHp;
    gameState.stamina = 100;
    gameState.cash = Math.max(0, gameState.cash - 50);
    climb.on = false;
    clearSwimPosture();
    clearLegBreak();
    player.x = aura.hospitalSpawn ? aura.hospitalSpawn.x : -11.5;
    player.y = 0.18;
    player.z = aura.hospitalSpawn ? aura.hospitalSpawn.z : 18.5;
    player.vy = 0;
    player.pvx = 0;
    player.pvz = 0;
    player.grounded = true;
    player.peakAirY = 0.18;
    player.slideTimer = 0;
    player.airSlideReady = false;
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
  clearLegBreak();
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
let _promptT = 0;
const _pTxt = new WeakMap(), _pCls = new WeakMap();
function pText(el, v) { if (el && _pTxt.get(el) !== v) { _pTxt.set(el, v); el.textContent = v; } }
function pShow(el, on) { if (el && _pCls.get(el) !== on) { _pCls.set(el, on); el.classList.toggle('hidden', !on); } }
export function updateZoneAndPrompts(force = false) {
  const now = performance.now();
  if (!force && now - _promptT < 100) return;
  _promptT = now;
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
    else if (biomeAt(player.x, player.z) !== 'city') zone = { alpine: 'FROSTPINE ALPINE', woods: 'EMERALD WOODS', cove: 'SUNSET COVE', jungle: 'VERDANT JUNGLE' }[biomeAt(player.x, player.z)] || 'SUNNYVALE CITY';
    else if (Math.abs(player.x) < 17 && Math.abs(player.z) < 17) zone = 'CENTRAL PLAZA';
    else if (player.z < -72) zone = 'DOWNTOWN SKYSCRAPER DISTRICT';
    else if (player.x < -22 && player.z < -22) zone = 'COMMERCIAL DISTRICT';
    else if (player.x > 22 && player.z < -22) zone = 'BRICKWOOD APARTMENTS';
    else if (player.x > 22 && player.z > 22) zone = 'HARBOR CONTAINER YARD';
    else zone = 'SUBURBAN NEIGHBORHOOD';
  }
  if (swimState.active) {
    const wb = getWaterBodyAt(player.x, player.z);
    zone = wb && wb.isOcean ? 'OPEN WATER' : 'RIVER SWIM';
  }
  gameState.zoneName = zone;
  const promptEl = document.getElementById('interact-prompt');
  const mantleEl = document.getElementById('mantle-prompt');
  const keyEl = document.getElementById('interact-key');
  const textEl = document.getElementById('interact-text');
  if (meteorDrop.active) { pShow(promptEl, false); pShow(mantleEl, false); return; }
  if (gameState.inCar) { pShow(promptEl, true); pText(keyEl, 'F'); pText(textEl, 'EXIT VEHICLE'); pShow(mantleEl, false); return; }
  let nearRefill = null;
  for (const zoneObj of sausageRefillZones) {
    const rdx = player.x - zoneObj.x, rdz = player.z - zoneObj.z;
    if (rdx * rdx + rdz * rdz < 9.61 && Math.abs(player.y - zoneObj.y) < 1.8) { nearRefill = zoneObj; break; }
  }
  if (nearRefill) {
    pShow(promptEl, true); pText(keyEl, 'E'); pText(textEl, `REFILL SAUSAGES (${gameState.hotdogAmmo}/${MAX_HOTDOG_AMMO})`);
  } else {
    const elev = getNearestElevatorPad();
    if (elev) {
      pShow(promptEl, true); pText(keyEl, 'F');
      pText(textEl, elev.toRoof ? `RIDE ELEVATOR TO ROOF (${elev.sk.name})` : 'RIDE ELEVATOR TO LOBBY');
    } else {
      const nearCar = swimState.active ? null : getNearestVehicle(4.2);
      let nearNpc = null;
      if (!swimState.active) {
        for (const npc of npcs) {
          if (!npc.spawned || npc.asleep) continue;
          const ndx = player.x - npc.x, ndz = player.z - npc.z;
          if (ndx * ndx + ndz * ndz < 6.25 && Math.abs(player.y - 0.18) < 1.8) { nearNpc = npc; break; }
        }
      }
      if (nearCar) { pShow(promptEl, true); pText(keyEl, 'F'); pText(textEl, `DRIVE ${nearCar.v.name}`); }
      else if (nearNpc) { pShow(promptEl, true); pText(keyEl, 'E'); pText(textEl, `TALK TO ${nearNpc.name}`); }
      else { pShow(promptEl, false); }
    }
  }
  pShow(mantleEl, !!findMantleTarget());
}
function stepParticles(dt) {
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
}

export function stepSimulation(dt, elapsed) {
  if (gameState.damageCooldown > 0) gameState.damageCooldown -= dt;
  if (gameState.speedBoostTimer > 0) gameState.speedBoostTimer -= dt;
  if (gameState.hp > 0 && gameState.hp < gameState.maxHp) {
    const regenRate = gameState.damageCooldown > 0 ? 0 : 3.5;
    if (regenRate > 0) {
      gameState.hp = Math.min(gameState.maxHp, gameState.hp + regenRate * dt);
    }
  }
  if (meteorDrop.active) {
    wasSwimming = false;
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
    const flamePulse = 1 + Math.sin(elapsed * 31) * 0.12 + Math.random() * 0.08;
    const flameStretch = (fastDive ? 1.8 : 1.15) * flamePulse;
    for (let i = 0; i < meteorFlame.children.length; i++) {
      meteorFlame.children[i].scale.set(1, flameStretch, 1);
      meteorFlamePlanes[i].rotation.y += dt * (2.2 + i * 1.7);
    }
    flameMat.opacity = 0.82 + Math.sin(elapsed * 23) * 0.14;
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
      const impactWb = getWaterBodyAt(player.x, player.z);
      const impactSurf = impactWb ? getWaterHeightAt(player.x, player.z, elapsed) : null;
      const waterImpact = impactWb && impactSurf !== null && surfaceAtMeteor < impactSurf - 0.25;
      spawnParticles(player.x, player.y + 0.4, player.z, 0xf97316, 26, 14.0);
      spawnParticles(player.x, player.y + 0.4, player.z, 0xfacc15, 20, 12.0);
      spawnParticles(player.x, player.y + 0.4, player.z, 0x44403c, 16, 10.0);
      if (waterImpact) {
        player.y = impactSurf - 0.8;
        player.vy = -1.5;
        player.grounded = false;
        player.peakAirY = player.y;
        spawnParticles(player.x, impactSurf + 0.25, player.z, 0xe0f2fe, 30, 13.0);
        spawnParticles(player.x, impactSurf + 0.1, player.z, 0x38bdf8, 22, 9.0);
        pushFeed('METEOR SPLASHDOWN — THE OCEAN SWALLOWS THE IMPACT', 'border-l-cyan-400');
      } else {
        const crater = new THREE.Mesh(
          new THREE.CircleGeometry(3.4, 24),
          new THREE.MeshBasicMaterial({ color: 0x1c1917 })
        );
        crater.rotation.x = -Math.PI / 2;
        crater.position.set(player.x, player.y + 0.035, player.z);
        worldRoot.add(crater);
        meteorDrop.craterMesh = crater;
        pushFeed('METEOR TOUCHDOWN — LANDED AT YOUR TARGET!', 'border-l-amber-400');
      }
      const shock = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1.4, 28),
        new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
      );
      shock.rotation.x = -Math.PI / 2;
      shock.position.set(player.x, (waterImpact ? impactSurf : player.y) + 0.06, player.z);
      worldRoot.add(shock);
      meteorDrop.shockwaveMesh = shock;
      meteorDrop.shockwaveLife = 0.65;
      for (const lp of lampPosts) {
        const ldx = lp.x - player.x, ldz = lp.z - player.z;
        if (lp.state === 'standing' && ldx * ldx + ldz * ldz < 132.25) {
          knockOverLamppost(lp, Math.atan2(ldx, ldz), 4.2);
        }
      }
    }
    stepParticles(dt);
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
  if (legBreak.active) {
    legBreak.t += dt;
    if (legBreak.t >= legBreak.dur) {
      clearLegBreak();
      pushFeed('BACK ON YOUR FEET — WALK IT OFF', 'border-l-emerald-400');
    }
  }
  if (
    inputState.isPrimaryFireHeld &&
    !gameState.inCar &&
    player.attackTimer <= 0 &&
    gameState.activeRightWeapon === 'hotdog_shooter' &&
    !gameState.inventoryOpen &&
    !gameState.mapOpen &&
    !gameState.settingsOpen &&
    !legBreak.active
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
    wasSwimming = false;
    fpRoot.visible = false;
    tpRig.visible = false;
    stepVehicleDriving(dt, elapsed);
  } else {
    sfx.updateEngine(false, 0, false);
    if (swimState.active && !wasSwimming) {
      player.landingDip = 0.2;
      player.crouching = false;
      player.slideTimer = 0;
      player.airSlideReady = false;
    }
    wasSwimming = swimState.active;
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
    } else if (swimState.active) {
      player.crouching = false;
      player.slideTimer = 0;
      player.airSlideReady = false;
      player.grounded = false;
      player.coyote = 0;
      player.pvx = 0;
      player.pvz = 0;
      player.peakAirY = player.y;
      player.walkCycle = swimState.strokePhase;
    } else {
      const locked = legBreak.active;
      const crouchInput = !locked && Boolean(keys['KeyC'] || keys['ControlLeft']);
      if (!crouchInput) {
        player.crouchJumped = false;
      }
      if (!locked && keys['Space'] && (player.grounded || player.coyote > 0) && !player.mantle?.active) {
        player.vy = 7.5;
        player.grounded = false;
        player.coyote = 0;
        if (player.crouching || player.slideTimer > 0) {
          player.crouching = false;
          player.crouchJumped = true;
          player.slideTimer = 0;
        }
      } else if (crouchInput && !player.crouchJumped) {
        player.crouching = true;
      } else if (!crouchInput) {
        player.crouching = false;
      }
      const moveFwd = locked ? 0 : (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0) - (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0);
      const moveRight = locked ? 0 : (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);
      const shiftHeld = Boolean(keys['ShiftLeft'] || keys['ShiftRight']);
      if (!shiftHeld) {
        player.sprintExhausted = false;
      }
      const wantsSprint = !locked && shiftHeld && !player.sprintExhausted && moveFwd > 0 && !player.crouching && !gameState.isAiming && gameState.stamina > 0;
      if (wantsSprint) {
        gameState.stamina = Math.max(0, gameState.stamina - 8.5 * dt);
        if (gameState.stamina <= 0) {
          player.sprintExhausted = true;
        }
        player.sprintCycle += dt * 15.5;
      } else {
        const regenRate = player.crouching ? 48.0 : 16.0;
        gameState.stamina = Math.min(100, gameState.stamina + regenRate * dt);
        player.sprintCycle = 0;
      }
      const wbHere = getWaterBodyAt(player.x, player.z);
      const waterSurf = wbHere ? getWaterHeightAt(player.x, player.z, elapsed) : null;
      const wadeDepth = (wbHere && waterSurf !== null) ? Math.max(0, waterSurf - player.y) : 0;
      const wadeFactor = wbHere ? (1 - Math.min(1, wadeDepth / 1.12) * 0.45) : 1;
      const boost = gameState.speedBoostTimer > 0 ? 1.25 : 1.0;
      const pp_ = levelData.params.player;
      const msScale = pp_.moveSpeed / 4.7;
      const speed = locked ? 0 : (player.crouching ? 2.6 * msScale : gameState.isAiming ? 3.2 * msScale : wantsSprint ? pp_.moveSpeed * pp_.sprintMultiplier : pp_.moveSpeed) * boost * wadeFactor;
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
      if (locked) { player.pvx = 0; player.pvz = 0; }
      const horizSpeed = Math.hypot(player.pvx || 0, player.pvz || 0);
      if (!player.grounded) {
        if (!locked && player.crouching && horizSpeed > 1.8) {
          player.airSlideReady = true;
          player.airSlideSpeed = Math.max(horizSpeed * 1.3, 7.5);
          player.airSlideDirX = (player.pvx || 0) / horizSpeed;
          player.airSlideDirZ = (player.pvz || 0) / horizSpeed;
        }
      } else {
        if (!locked && player.crouching && player.airSlideReady) {
          player.slideTimer = 0.65;
          player.slideVx = player.airSlideDirX * player.airSlideSpeed;
          player.slideVz = player.airSlideDirZ * player.airSlideSpeed;
          player.airSlideReady = false;
          sfx.mantle();
          spawnParticles(player.x, player.y + 0.1, player.z, 0xd1d5db, 10, 4.0);
        } else if (!player.crouching) {
          player.airSlideReady = false;
        }
      }
      if (player.slideTimer > 0) {
        player.slideTimer -= dt;
        player.pvx = player.slideVx;
        player.pvz = player.slideVz;
        player.slideVx *= Math.max(0, 1 - dt * 2.2);
        player.slideVz *= Math.max(0, 1 - dt * 2.2);
        if (player.grounded && Math.random() < 0.35) {
          spawnParticles(player.x, player.y + 0.05, player.z, 0x9ca3af, 2, 1.5);
        }
      }
      vx = player.pvx; vz = player.pvz;
      const nextX = player.x + vx * dt;
      const nextZ = player.z + vz * dt;
      const bodyH = player.crouching ? 1.22 : player.height;
      if (!collidesHorizontally(nextX, player.z, player.y, bodyH, player.radius)) player.x = nextX; else player.pvx = 0;
      if (!collidesHorizontally(player.x, nextZ, player.y, bodyH, player.radius)) player.z = nextZ; else player.pvz = 0;
      if (wbHere && swimState.wading) {
        const driftX = wbHere.currentX * dt * 0.3;
        const driftZ = wbHere.currentZ * dt * 0.3;
        if (!collidesHorizontally(player.x + driftX, player.z, player.y, bodyH, player.radius)) player.x += driftX;
        if (!collidesHorizontally(player.x, player.z + driftZ, player.y, bodyH, player.radius)) player.z += driftZ;
      }
      const previousY = player.y;
      const inWaterColumn = wbHere !== null && waterSurf !== null && player.y < waterSurf - 0.12;
      player.vy -= 19.5 * dt * (player.vy < 0 ? 1.28 : (keys['Space'] ? 1 : 1.9));
      if (inWaterColumn) {
        player.vy = Math.max(player.vy, -3.2);
        player.vy *= Math.pow(0.35, dt);
        if (!swimState.active && (waterSurf - player.y) > 1.15) {
          swimState.active = true;
          swimState.lastBodyId = wbHere.id;
          swimState.vy = Math.max(player.vy, -2.5);
          swimState.oxygen = swimState.oxygen ?? swimState.maxOxygen;
        }
      }
      player.y += player.vy * dt;
      if (!player.grounded && player.y > player.peakAirY) player.peakAirY = player.y;
      let supportY = computeSupportFloor(player.x, player.z, previousY - 0.46, player.radius);
      if (inWaterColumn) {
        const bed = getWaterBedAt(player.x, player.z);
        if (bed !== null && bed < supportY) supportY = bed;
      }
      if (player.y <= supportY && player.vy <= 0) {
        if (!player.grounded) {
          const fallDist = player.peakAirY - supportY;
          if (fallDist > 3.6 && !inWaterColumn) {
            const fallDmg = Math.min(65, (fallDist - 3.6) * 8.5);
            applyPlayerDamage(fallDmg, 'FALL IMPACT');
            if (fallDist > LEG_BREAK_FALL && gameState.hp > 0) {
              triggerLegBreak(fallDist);
            }
          }
          player.landingDip = Math.min(0.24, Math.max(0.06, fallDist * 0.04));
          if (inWaterColumn) {
            spawnParticles(player.x, waterSurf + 0.08, player.z, 0xe0f2fe, 10, 4.5);
          }
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
    const lbPose = legBreak.active ? legBreakPose() : null;
    const targetEye = legBreak.active
      ? (0.42 + (1 - lbPose.k) * 1.2)
      : swimState.active
        ? (swimState.submerged ? 0.85 : 1.5)
        : (player.crouching ? 1.12 : 1.62);
    player.eyeHeight += (targetEye - player.eyeHeight) * Math.min(1, dt * (legBreak.active ? 6 : 14));
    const movingSpeed = !legBreak.active && (keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD']) && player.grounded && !swimState.active;
    const isSprintingNow = (keys['ShiftLeft'] || keys['ShiftRight']) && (keys['KeyW'] || keys['ArrowUp']) && !player.crouching && !gameState.isAiming && gameState.stamina > 0 && movingSpeed && !player.sprintExhausted;
    const bobY = movingSpeed ? Math.abs(Math.sin(player.walkCycle)) * (isSprintingNow ? 0.085 : 0.045) : 0;
    const swimBob = swimState.active ? Math.sin(swimState.strokePhase * 2) * 0.035 : 0;
    const isStepping = movingSpeed && player.slideTimer <= 0 && !player.mantle.active;
    const biome = biomeAt(player.x, player.z);
    const stepSurface = under() ? 'metal'
      : (player.x >= 164 || biome === 'cove' || swimState.wading) ? 'sand'
      : (biome === 'woods' || biome === 'alpine') ? 'grass'
      : 'concrete';
    sfx.updateFootsteps(dt, isStepping, isSprintingNow, player.grounded, stepSurface);
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
    if (legBreak.active) {
      fpRight.pivot.visible = true;
      fpLeft.pivot.visible = true;
      const hurt = lbPose.k;
      const rise = lbPose.riseK;
      fpRight.pivot.position.set(0.34, -0.34 + hurt * 0.06, -0.30);
      fpRight.pivot.rotation.set(0.55 * hurt, 0, -0.25 * hurt);
      fpLeft.pivot.position.set(-0.20 + rise * 0.04, -0.10 + rise * 0.06, -0.24);
      fpLeft.pivot.rotation.set(1.85 * rise + 0.4 * hurt, 0.35 * rise, 0.55 * rise);
    } else if (swimState.active) {
      animateSwimFirstPerson();
    } else if (gameState.isAiming && gameState.activeRightWeapon === 'hotdog_shooter') {
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
      tpHip.rotation.z = 0;
      tpTorso.rotation.y = 0;
      tpHead.rotation.x = 0;
      tpHead.rotation.y = 0;
      tpHead.rotation.z = 0;
      tpArmL.rotation.set(0, 0, 0);
      tpArmR.rotation.set(0, 0, 0);
      tpElbowL.rotation.x = 0;
      tpElbowR.rotation.x = 0;
      tpLegL.rotation.set(0, 0, 0);
      tpLegR.rotation.set(0, 0, 0);
      tpKneeL.rotation.x = 0;
      tpKneeR.rotation.x = 0;
      if (legBreak.active) {
        const { k, riseK } = lbPose;
        const sev = legBreak.severity;
        tpRig.position.y = player.y + 0.06;
        tpHip.position.y = 0.26 + (1 - k) * 0.64;
        tpHip.rotation.x = -1.44 * k;
        tpHip.rotation.z = Math.sin(elapsed * 1.9) * 0.06 * k;
        tpTorso.rotation.y = Math.sin(elapsed * 2.6) * 0.10 * k;
        tpLegL.rotation.x = (0.55 + Math.sin(elapsed * 3.1) * 0.12 * sev) * k;
        tpKneeL.rotation.x = (0.85 + Math.max(0, Math.sin(elapsed * 4.2)) * 0.3 * sev) * k;
        tpLegR.rotation.x = (0.25 - Math.sin(elapsed * 2.7) * 0.10 * sev) * k;
        tpKneeR.rotation.x = (0.45 + Math.max(0, -Math.sin(elapsed * 3.6)) * 0.25 * sev) * k;
        tpArmL.rotation.set(0.95 * k, 0, -0.35 * k);
        tpElbowL.rotation.x = 0.45 * k;
        tpArmR.rotation.set(0.35 * k + 2.45 * riseK, 0, -0.55 * riseK);
        tpElbowR.rotation.x = 0.30 * k + 1.95 * riseK;
        tpHead.rotation.x = 0.4 * k + 0.3 * riseK;
        tpHead.rotation.z = Math.sin(elapsed * 16) * 0.30 * riseK;
        tpHip.scale.y = 1;
      } else if (swimState.active) {
        animateSwimRig(dt, elapsed);
      } else if (player.slideTimer > 0) {
        tpHip.rotation.x = -0.48;
        tpLegL.rotation.x = 0.85;
        tpKneeL.rotation.x = 0.12;
        tpLegR.rotation.x = -0.65;
        tpKneeR.rotation.x = 0.95;
        tpArmL.rotation.x = -0.45;
        tpElbowL.rotation.x = 0.22;
        tpArmR.rotation.x = -0.45;
        tpElbowR.rotation.x = 0.22;
      } else if (!player.grounded) {
        const airBlend = Math.max(-1, Math.min(1, player.vy / 6.5));
        if (airBlend > 0.1) {
          tpHip.rotation.x = -0.14 * airBlend;
          tpLegL.rotation.x = -0.82 * airBlend;
          tpKneeL.rotation.x = 0.95 * airBlend;
          tpLegR.rotation.x = 0.42 * airBlend;
          tpKneeR.rotation.x = 0.25 * airBlend;
          tpArmL.rotation.x = 0.95 * airBlend;
          tpArmL.rotation.z = -0.22 * airBlend;
          tpElbowL.rotation.x = 0.45 * airBlend;
          tpArmR.rotation.x = -0.52 * airBlend;
          tpArmR.rotation.z = 0.22 * airBlend;
          tpElbowR.rotation.x = 0.45 * airBlend;
        } else {
          tpHip.rotation.x = -0.08;
          tpLegL.rotation.x = -0.34;
          tpKneeL.rotation.x = 0.42;
          tpLegR.rotation.x = -0.18;
          tpKneeR.rotation.x = 0.30;
          tpArmL.rotation.x = 0.48;
          tpArmL.rotation.z = -0.38;
          tpElbowL.rotation.x = 0.35;
          tpArmR.rotation.x = 0.48;
          tpArmR.rotation.z = 0.38;
          tpElbowR.rotation.x = 0.35;
        }
      } else if (isSprintingNow) {
        const sPhase = player.walkCycle;
        const stride = Math.sin(sPhase);
        const oppStride = Math.sin(sPhase + Math.PI);
        tpHip.rotation.x = -0.26;
        tpTorso.rotation.y = -stride * 0.18;
        tpLegL.rotation.x = stride * 1.12;
        tpKneeL.rotation.x = Math.max(0.12, -stride * 1.15 + 0.35);
        tpLegR.rotation.x = oppStride * 1.12;
        tpKneeR.rotation.x = Math.max(0.12, -oppStride * 1.15 + 0.35);
        tpArmL.rotation.x = -stride * 1.18 + 0.15;
        tpArmL.rotation.z = -0.08;
        tpElbowL.rotation.x = 1.52;
        tpArmR.rotation.x = -oppStride * 1.18 + 0.15;
        tpArmR.rotation.z = 0.08;
        tpElbowR.rotation.x = 1.52;
      } else {
        const legSwing = movingSpeed ? Math.sin(player.walkCycle) * 0.58 : 0;
        const wade = swimState.wading && movingSpeed;
        if (wade) tpHip.rotation.x = -0.12;
        tpLegL.rotation.x = legSwing * (wade ? 1.25 : 1);
        tpKneeL.rotation.x = movingSpeed ? Math.max(0, -legSwing * 0.55) + (wade ? 0.3 : 0) : 0;
        tpLegR.rotation.x = -legSwing * (wade ? 1.25 : 1);
        tpKneeR.rotation.x = movingSpeed ? Math.max(0, legSwing * 0.55) + (wade ? 0.3 : 0) : 0;
        tpArmL.rotation.x = -legSwing * 0.65 + leftRaise * 3.5;
        tpArmL.rotation.z = wade ? -0.22 : 0;
        tpElbowL.rotation.x = movingSpeed ? 0.22 : 0.08;
        tpArmR.rotation.x = legSwing * 0.65;
        tpArmR.rotation.z = wade ? 0.22 : 0;
        tpElbowR.rotation.x = movingSpeed ? 0.22 : 0.08;
      }
      if (!swimState.active && !legBreak.active) {
        if (gameState.activeRightWeapon === 'hotdog_shooter') {
          tpArmR.rotation.set(1.48 + swingPitch, 0, 0);
          tpElbowR.rotation.x = 0.18;
        } else if (player.attackTimer > 0) {
          const t = 1 - player.attackTimer / player.attackDuration;
          const hookArc = Math.sin(t * Math.PI);
          if (gameState.activeRightWeapon === 'fists') {
            if (player.punchCombo === 0) {
              tpArmR.rotation.set(1.35 * hookArc, 0, -0.78 * hookArc);
              tpElbowR.rotation.x = 0.85 * hookArc;
              tpTorso.rotation.y = 0.48 * hookArc;
            } else {
              tpArmL.rotation.set(1.35 * hookArc, 0, 0.78 * hookArc);
              tpElbowL.rotation.x = 0.85 * hookArc;
              tpTorso.rotation.y = -0.48 * hookArc;
            }
          } else {
            tpArmR.rotation.x = -swingPitch * 1.4;
            tpElbowR.rotation.x = 0.35;
          }
        }
      }
      if (!legBreak.active) {
        tpHip.scale.y = player.crouching ? 0.72 : 1.0;
        tpHip.position.y = player.crouching ? 0.65 : 0.90;
      }
      const pivotY = legBreak.active
        ? player.y + 0.55 + (1 - lbPose.k) * 0.9
        : swimState.active ? player.y + 1.1 : player.y + (player.crouching ? 1.15 : 1.56);
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
      const camX = player.x + (idealX - player.x) * ratio;
      const camZ = player.z + (idealZ - player.z) * ratio;
      let camY = pivotY + (idealY - pivotY) * ratio;
      if (swimState.active) {
        const bed = getWaterBedAt(camX, camZ);
        camY = Math.max(bed !== null ? bed + 0.3 : 0.3, camY);
      } else {
        camY = Math.max(0.55, terrainH(camX, camZ) + 0.7, camY);
      }
      camera.position.set(camX, camY, camZ);
      camera.rotation.z = legBreak.active ? Math.sin(elapsed * 2.3) * 0.035 * lbPose.k : 0;
      camera.lookAt(player.x - Math.sin(player.yaw) * 4, pivotY + Math.sin(player.pitch) * 4, player.z - Math.cos(player.yaw) * 4);
    } else {
      fpRoot.visible = true;
      tpRig.visible = false;
      const shakeX = meteorDrop.cameraShake > 0 ? (Math.random() - 0.5) * meteorDrop.cameraShake * 0.45 : 0;
      const shakeY = meteorDrop.cameraShake > 0 ? (Math.random() - 0.5) * meteorDrop.cameraShake * 0.45 : 0;
      camera.position.set(player.x + shakeX, player.y + player.eyeHeight + bobY + swimBob - player.landingDip + shakeY, player.z);
      camera.rotation.y = player.yaw;
      camera.rotation.x = player.pitch;
      camera.rotation.z = swimState.active
        ? Math.sin(swimState.strokePhase) * 0.055 + (swimState.submerged ? Math.sin(elapsed * 1.3) * 0.02 : 0)
        : legBreak.active
          ? Math.sin(elapsed * 2.2) * 0.03 + lbPose.k * 0.14
          : 0;
    }
  }
  for (let i = worldPickups.length - 1; i >= 0; i--) {
    const p = worldPickups[i];
    p.phase += dt * 2.8;
    p.group.rotation.y += dt * 1.8;
    p.group.position.y = p.baseY + Math.sin(p.phase) * 0.12;
    const pdx = player.x - p.x, pdz = player.z - p.z;
    if (pdx * pdx + pdz * pdz < 1.8225 && Math.abs(player.y - p.y) < 1.8) {
      if (hooks.mpIsGuest()) {
        if (!p.asked) { p.asked = true; hooks.mpWorldEvent({ t: 'pickup_take', netId: p.netId }); }
        continue;
      }
      if (p.type === 'right') {
        if (!gameState.rightWeapons.includes(p.id)) gameState.rightWeapons.push(p.id);
        gameState.activeRightWeapon = p.id;
        if (p.id === 'hotdog_shooter') gameState.hotdogAmmo = MAX_HOTDOG_AMMO;
        sfx.pickup();
        syncEquippedMeshes();
        pushFeed(`EQUIPPED ${RIGHT_WEAPONS[p.id].name.toUpperCase()}`, 'border-l-amber-400');
        hooks.mpWorldEvent({ t: 'pickup_taken', netId: p.netId });
        worldRoot.remove(p.group);
        freeGeo(p.group);
        worldPickups.splice(i, 1);
      } else if (addLeftItemToBag(p.id, 1)) {
        sfx.pickup();
        syncEquippedMeshes();
        pushFeed(`COLLECTED ${LEFT_ITEMS[p.id].name.toUpperCase()}`, 'border-l-sky-400');
        hooks.mpWorldEvent({ t: 'pickup_taken', netId: p.netId });
        worldRoot.remove(p.group);
        freeGeo(p.group);
        worldPickups.splice(i, 1);
      }
    }
  }
  stepParticles(dt);
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
  const shadowMoved = !aura._shadowAt
    || Math.hypot(player.x - aura._shadowAt.x, player.z - aura._shadowAt.z) > 8
    || Math.abs(sunY - aura._shadowAt.y) > 6;
  const shadowStale = performance.now() - (aura._shadowT || 0) > 200;
  if (shadowMoved || shadowStale) {
    sunLight.position.set(player.x + 78, sunY + 130, player.z + 52);
    sunLight.target.position.set(player.x, sunY, player.z);
    sunLight.target.updateMatrixWorld();
    renderer.shadowMap.needsUpdate = true;
    aura._shadowAt = { x: player.x, y: sunY, z: player.z };
    aura._shadowT = performance.now();
  }
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
  const yawBeforeWater = player.yaw;
  const pitchBeforeWater = player.pitch;
  const yBeforeWater = player.y;
  swimState.pitch = player.pitch;
  updateBiomeAtmosphere(dt, elapsed);
  if (typeof hooks.updateWater === 'function') hooks.updateWater(dt, elapsed);
  if (swimState.active) {
    player.yaw = yawBeforeWater;
    player.pitch = pitchBeforeWater;
    steerSwimVertical(dt, elapsed, yBeforeWater);
    updateSwimFeedback(dt);
  } else {
    swimO2Warned = false;
    swimDrownT = 0;
  }
  auraFrame(dt, elapsed);
  if (!pp.hinted && elapsed > 6) { pp.hinted = true; pushFeed('TIP: SNEAK BEHIND A CITIZEN & HOLD [G] TO PICKPOCKET', 'border-l-emerald-400'); }
}
export function nearestManhole(r) {
  const r2 = r * r;
  for (let i = 0; i < manholes.length; i++) {
    const dx = player.x - manholes[i][0], dz = player.z - manholes[i][1];
    if (dx * dx + dz * dz < r2) return i;
  }
  return -1;
}
export function startClimb(dir, i) {
  climb.on = true; climb.dir = dir; if (dir < 0) reviveRats(); climb.t = 0; climb.i = i; sfx.mantle();
  clearLegBreak();
  pushFeed(dir < 0 ? 'CLIMBING DOWN INTO THE SEWERS' : 'CLIMBING OUT', dir < 0 ? 'border-l-emerald-400' : 'border-l-sky-400');
}
export function climbFrame(dt) {
  if (!climb.on) return;
  climb.t = Math.min(1, climb.t + dt / 2.2);
  const e = climb.t * climb.t * (3 - 2 * climb.t), top = .18, bot = SFY + .02, m = manholes[climb.i];
  player.x = m[0]; player.z = m[1]; player.vy = 0; player.grounded = true;
  player.y = climb.dir < 0 ? top + (bot - top) * e : bot + (top - bot) * e; player.peakAirY = player.y;
  if (climb.t >= 1) { climb.on = false; manholeCovers[climb.i].visible = true; }
}
export const hazeC = new THREE.Color(0xb8d4ea);
export function auraFrame(dt, t) {
  climbFrame(dt); ratFrame(dt, t); if (aura.ahCull) aura.ahCull(dt);
  const u = under();
  if (u !== AT.on) { AT.on = u; if (u) { scene.background = new THREE.Color(0x070a09); skyGroup.visible = false; } else { scene.background = AT.bg; skyGroup.visible = true; { const hi = gameState.settings.graphics === 'high'; sunLight.intensity = hi ? 1.65 : 1.45; hemiLight.intensity = hi ? 0.96 : 0.88; } } sewerLights.forEach(l => l.visible = u); uLight.visible = u; }
  if (u) {
    scene.fog.color.set(0x0a100d); scene.fog.density = .016; sunLight.intensity = 0; hemiLight.intensity = .22; uLight.position.set(player.x, player.y + 2.2, player.z);
    sewerLights.forEach((l, i) => { if (i < 10 && Math.random() < .01) l.intensity = 10 + Math.random() * 30; else if (i < 10) l.intensity += (30 - l.intensity) * .1; });
  }
  else if (player.z < -175) { scene.fog.color.lerp(hazeC, .02); }
  copFrame(dt, t); suspFrame(dt, t);
  const cp = document.getElementById('ao-compass');
  if (cp) {
    if (swimState.active) {
      const surf = getWaterHeightAt(player.x, player.z, t);
      const depth = Math.max(0, (surf !== null ? surf : 0.2) - player.y);
      cp.textContent = swimState.submerged
        ? `O₂ ${Math.round(swimState.oxygen)}% · DEPTH ${depth.toFixed(1)}M`
        : `SWIMMING · O₂ ${Math.round(swimState.oxygen)}%`;
    } else {
      const d = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][((Math.round(((-player.yaw % 6.283) + 6.283) % 6.283 / .7854)) + 4) % 8];
      cp.textContent = u ? `SEWERS · DEPTH ${Math.round(-player.y)}m` : `${d} · ALT ${Math.max(0, Math.round(player.y))}m`;
    }
  }
  const tp = document.getElementById('ao-tip'); let msg = '';
  if (legBreak.active) {
    msg = legBreakPose().phase === 'rise' ? 'GETTING BACK UP…' : 'LEGS BUCKLED — CATCH YOUR BREATH';
  } else if (swimState.active) {
    msg = swimState.submerged
      ? '[WASD] STROKE · LOOK ↑↓ TO STEER · [SPACE] QUICK SURFACE'
      : '[WASD] SWIM · LOOK DOWN TO DIVE · LOOK UP TO SURFACE · [SHIFT] SPRINT';
  } else if (!gameState.inCar) {
    if (u) { for (let i = 0; i < manholes.length; i++) { const dx = player.x - manholes[i][0], dz = player.z - manholes[i][1]; if (dx * dx + dz * dz < 10.24) msg = '[F] CLIMB LADDER TO SURFACE'; } }
    else { const i = nearestManhole(2.4); if (i >= 0) msg = manholeOpen[i] ? '[F] CLIMB DOWN' : '[F] OPEN MANHOLE'; else if (aura.ahHint) { const h2 = aura.ahHint(); if (h2) msg = h2; } }
  }
  if (tp) { tp.style.display = msg ? 'block' : 'none'; tp.textContent = msg; }
}
hooks.getRightMountWorldPosition = (out) => fpRight.itemMount.getWorldPosition(out);
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
Object.assign(hooks, { syncEquippedMeshes, applyPlayerDamage });