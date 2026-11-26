import * as THREE from 'three';
import { levelData } from './levelData.js';
import {
  CAR_PTS, collidesHorizontally, computeSupportFloor, gameState, hooks, inputState,
  isInWater, keys, lampPosts, npcs, player, pushFeed, surfaceGrip, terrainH
} from './state.js';
import { camera, makeMat, worldRoot } from './engine.js';
import { sfx } from './audio.js';
import { spawnParticles } from './items.js';

export const vehicles = [];

export const GEAR_LABELS = ['R', 'N', '1', '2', '3', '4', '5', '6'];
export const GEAR_CAPS_MPH = [36, 0, 39, 66, 95, 125, 154, 180];
export const BUS_GEAR_CAPS_MPH = [26, 0, 30, 50, 70, 88, 104, 118];
export const GEAR_RATIO_MULT = [-0.55, 0, 1.0, 0.66, 0.46, 0.34, 0.26, 0.21];

const DEFAULT_SCALE = 1.35;
const BUS_DEFAULT_SCALE = 1.2;
export const BUS_SEAT_COUNT = 8;

const STEP_HEIGHT = 0.55;
const NPC_HIT_RADIUS = 0.5;
const NPC_MIN_SPEED = 1.2;
const NPC_HIT_COOLDOWN = 900;

const WATER_CONTACT_EPS  = 0.10;          
const WATER_AWASH_DEPTH  = 0.75;         
const WATER_FLOOD_DEPTH  = 1.15;          
const WATER_DEEP_DEPTH   = 2.60;     
const WATER_SINK_GRAVITY = 5.4;        
const WATER_MAX_SINK_SPD = 3.2;       
const WATER_DRAG         = 2.4;      
const WATER_DPS          = 6;

const ROLL_TIP_START     = 0.78;     
const ROLL_CONTACT_BLEND = 0.55;          
const ROOF_DOWN_FACTOR   = 0.30;        
const ROOF_SCRAPE_DRAG   = 3.6;
const ROOF_RIGHT_SPEED   = 1.5;           

let vehicleUid = 0;
const carCollisionCooldowns = new Map();

function wrapPi(a) {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
}

export function getGearCaps(v = null) {
  let veh = v;
  if (!veh && gameState.inCar && gameState.activeCarIndex >= 0) {
    veh = vehicles[gameState.activeCarIndex] || null;
  }
  const isBus = Boolean(veh && veh.isBus);
  const out = (isBus ? BUS_GEAR_CAPS_MPH : GEAR_CAPS_MPH).slice();
  const src = isBus
    ? levelData?.params?.vehicles?.busGearCapsMph
    : levelData?.params?.vehicles?.gearCapsMph;
  if (Array.isArray(src)) {
    for (let i = 0; i < out.length; i++) {
      const n = Number(src[i]);
      if (!Number.isFinite(n) || n < 0) continue;
      out[i] = i >= 2 ? Math.max(6, n) : n;
    }
  }
  for (let i = 3; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + 1);
  return out;
}

function tune(key, fallback = 1) {
  const n = Number(levelData?.params?.vehicles?.[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function footprintScale(v) {
  return (v.carScale || DEFAULT_SCALE) * (v.isTank ? 1.28 : 1);
}
function wheelHalfX(v) {
  if (v.isBus) return 1.08 * (v.carScale || BUS_DEFAULT_SCALE);
  return (v.isTank ? 1.55 : 0.98) * (v.carScale || DEFAULT_SCALE);
}
function wheelHalfZ(v) {
  if (v.isBus) return 2.80 * (v.carScale || BUS_DEFAULT_SCALE);
  return (v.isTank ? 2.05 : 1.38) * (v.carScale || DEFAULT_SCALE);
}
function wheelRadius(v) { return v.wheelRadius || 0.38; }
function chaseDistance(v) {
  return 11.4 * (v.carScale || DEFAULT_SCALE) * (v.isBus ? 1.45 : 1);
}
function chaseLookHeight(v) { return v.isBus ? 1.70 : 0.95; }

function footprintLayout(v) {
  const scale = footprintScale(v);
  if (v.isBus) return { d: 2.90 * scale, r: 1.20 * scale, offsets: [1, 0, -1] };
  return { d: 0.95 * scale, r: 0.92 * scale, offsets: [1, -1] };
}

function roofTopLocal(v) {
  if (v.isBus) return 3.05;
  if (v.isTank) return 1.90;
  return v.isSupercar ? 1.29 : 1.65;
}
function roofHeight(v) { return roofTopLocal(v) * (v.carScale || DEFAULT_SCALE); }
function bodyHalfWidth(v) {
  const s = v.carScale || DEFAULT_SCALE;
  return (v.isBus ? 1.20 : v.isTank ? 1.62 : 1.06) * s;
}
function bodyHalfLength(v) {
  const s = v.carScale || DEFAULT_SCALE;
  return (v.isBus ? 4.40 : v.isTank ? 2.90 : 2.30) * s;
}

function roofDownFactor(v) {
  const up = Math.cos(v.roll || 0) * Math.cos(v.pitch || 0);
  return Math.max(0, -up);
}

function bodySupportOffset(v) {
  const roll = wrapPi(v.roll || 0);
  const pitch = wrapPi(v.pitch || 0);
  const hw = bodyHalfWidth(v);
  const hl = bodyHalfLength(v);
  const ht = roofHeight(v);

  let rollOffset = 0;
  const aRoll = Math.abs(roll);
  if (aRoll > ROLL_TIP_START) {
    const cr = Math.cos(roll);
    const full = hw * Math.abs(Math.sin(roll)) + (cr < 0 ? -ht * cr : 0);
    rollOffset = full * Math.min(1, (aRoll - ROLL_TIP_START) / ROLL_CONTACT_BLEND);
  }

  let pitchOffset = 0;
  const aPitch = Math.abs(pitch);
  if (aPitch > 1.10) {
    const cp = Math.cos(pitch);
    const full = hl * Math.abs(Math.sin(pitch)) + (cp < 0 ? -ht * cp : 0);
    pitchOffset = full * Math.min(1, (aPitch - 1.10) / 0.5);
  }

  return Math.max(rollOffset, pitchOffset);
}

function bodyTopOffset(v) {
  const roll = wrapPi(v.roll || 0);
  const ht = roofHeight(v);
  const hw = bodyHalfWidth(v);
  return Math.max(ht * Math.max(0, Math.cos(roll)), hw * Math.abs(Math.sin(roll))) + 0.35;
}

function waterLevelFallback() {
  const w = levelData?.params?.water;
  const cands = [w?.surfaceY, w?.level, w?.y, w?.height, levelData?.params?.seaLevel, levelData?.seaLevel];
  for (const c of cands) {
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export function waterSurfaceY(x, z) {
  if (hooks.waterSurfaceY) {
    const n = Number(hooks.waterSurfaceY(x, z));
    return Number.isFinite(n) ? n : null;
  }
  if (!isInWater(x, z)) return null;
  return waterLevelFallback();
}

function updateVehicleWater(v, dt) {
  const w = v.water || (v.water = {
    active: false, wasActive: false, surfaceY: null,
    depth: 0, awash: false, flooded: false, floodLatch: false, deep: false, t: 0
  });

  const surf = waterSurfaceY(v.x, v.z);
  let active = false;
  let contactY = v.y;

  if (surf !== null) {
    contactY = v.y - bodySupportOffset(v);
    const support = computeSupportFloor(v.x, v.z, v.y + 0.55, v.isBus ? 1.3 : 0.8);
    const standingOnDeck = support > surf + 0.05 && contactY >= support - 0.30;
    active = !standingOnDeck && (contactY < surf - WATER_CONTACT_EPS);
  }

  w.surfaceY = surf;
  w.active   = active;
  w.depth    = active ? Math.max(0, surf - contactY) : 0;
  w.awash    = active && w.depth < WATER_AWASH_DEPTH;
  w.flooded  = active && w.depth >= WATER_FLOOD_DEPTH;
  w.deep     = active && w.depth >= WATER_DEEP_DEPTH;
  w.t        = active ? w.t + dt : 0;
  if (w.flooded) w.floodLatch = true;
  if (!active) w.floodLatch = false;
  v._inWater = active;

  if (active && !w.wasActive) {
    spawnParticles(v.x, surf + 0.15, v.z, 0xbae6fd, 16, 6.5);
    if (sfx.splash) sfx.splash();
    else if (Math.abs(v.speed) > 6) sfx.hit();
    if (gameState.inCar && vehicles[gameState.activeCarIndex] === v) {
      pushFeed('VEHICLE IN WATER — IT IS SINKING • [F] EXIT', 'border-l-sky-400');
    }
  }
  w.wasActive = active;
  return w;
}

function stepVehicleSinking(v, dt, w) {
  const offset = bodySupportOffset(v);
  const seabed = computeSupportFloor(v.x, v.z, v.y + 0.35, v.isBus ? 1.3 : 0.9) + offset;
  const sinkAccel = WATER_SINK_GRAVITY * (w.awash && w.t < 1.2 ? 0.35 : 1);
  v.vy = Math.max(-WATER_MAX_SINK_SPD, (v.vy || 0) - sinkAccel * dt);
  v.y += v.vy * dt;
  if (v.y <= seabed) { v.y = seabed; v.vy = 0; }

  const roll = wrapPi(v.roll || 0);
  const restRoll = Math.abs(roll) > ROLL_TIP_START ? (roll >= 0 ? Math.PI : -Math.PI) : 0;
  v.pitch = (v.pitch || 0) + (-0.42 - (v.pitch || 0)) * Math.min(1, dt * 1.4);
  v.roll = (v.roll || 0) + (restRoll - (v.roll || 0)) * Math.min(1, dt * 1.2);

  const drag = Math.max(0, 1 - WATER_DRAG * dt);
  v.speed *= drag;
  v.velX = (v.velX || 0) * drag;
  v.velZ = (v.velZ || 0) * drag;

  if (Math.random() < dt * 14) spawnParticles(v.x, v.y + 0.9, v.z, 0xe0f2fe, 1, 1.2);
}

const BUS_SEAT_ANCHORS = [
  [-0.62, 1.95, 3.30],    
  [ 0.66, 1.95, 2.30],        
  [-0.66, 1.95, 2.30],   
  [ 0.66, 1.95, 1.20],   
  [-0.66, 1.95, 1.20],   
  [ 0.66, 1.95, 0.10],   
  [-0.66, 1.95, 0.10],   
  [ 0.66, 1.95, -1.00]   
];

export function seatCapacity(v) {
  if (!v) return 0;
  if (v.isBus) return BUS_SEAT_COUNT;
  if (v.isTank) return 2;
  if (v.isSupercar) return 2;
  return v.isCoupe === false ? 4 : 2;
}

function localPlayerId() {
  return (hooks.mpLocalId && hooks.mpLocalId()) || 'local';
}

function seatLocalPos(v, seatIndex) {
  if (v.isBus) {
    const a = BUS_SEAT_ANCHORS[Math.max(0, Math.min(BUS_SEAT_ANCHORS.length - 1, seatIndex))];
    return new THREE.Vector3(a[0], a[1], a[2]);
  }
  const y = v.isSupercar ? 1.02 : 1.30;
  switch (seatIndex) {
    case 0: return new THREE.Vector3(-0.38, y, 0.12);            
    case 1: return new THREE.Vector3(0.38, y, 0.12);             
    case 2: return new THREE.Vector3(-0.38, y - 0.06, -0.78);    
    default: return new THREE.Vector3(0.38, y - 0.06, -0.78);    
  }
}

function seatSideSign(seatIndex, v = null) {
  if (v && v.isBus) return seatIndex === 0 ? -1 : 1;     
  return (seatIndex % 2 === 0) ? -1 : 1;
}

function firstFreeSeat(v) {
  const cap = seatCapacity(v);
  for (let s = 0; s < cap; s++) {
    if (!v.occupants.some((o) => o.seat === s)) return s;
  }
  return -1;
}
function occupantBySeat(v, seat) { return v.occupants.find((o) => o.seat === seat) || null; }
function localOccupant(v) { return v.occupants.find((o) => o.local) || null; }

function broadcastSeat(t, v, id, seat) {
  if (hooks.mpWorldEvent) hooks.mpWorldEvent({ t, car: v.uid, id, seat });
}

export function applyRemoteCarSeatEvent(evt) {
  if (!evt) return;
  const v = vehicles.find((c) => c.uid === evt.car);
  if (!v) return;
  const me = localPlayerId();
  if (evt.t === 'car_seat_enter') {
    if (evt.id === me) return;
    if (!v.occupants.some((o) => o.id === evt.id)) {
      v.occupants.push({ id: evt.id, seat: evt.seat, local: false });
    }
  } else if (evt.t === 'car_seat_exit') {
    v.occupants = v.occupants.filter((o) => o.id !== evt.id);
  } else if (evt.t === 'car_seat_promote') {
    const o = v.occupants.find((c) => c.id === evt.id);
    if (o) {
      o.seat = 0;
      if (o.local) {
        gameState.isPassenger = false;
        v.localSeat = 0;
        pushFeed('YOU ARE NOW DRIVING', 'border-l-amber-400');
      }
    }
  }
}

export function isLocalPassenger() {
  return Boolean(gameState.inCar && gameState.isPassenger);
}

export function getVehicleSeatInfo(idx) {
  const v = vehicles[idx];
  if (!v) return null;
  return {
    capacity: seatCapacity(v),
    occupants: v.occupants.map((o) => ({ id: o.id, seat: o.seat, local: o.local })),
    freeSeat: firstFreeSeat(v)
  };
}

function createRemappedTexture(defaultFill) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = `rgb(${defaultFill}, ${defaultFill}, ${defaultFill})`;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return { canvas, tex };
}

const carBaseRough = createRemappedTexture(56);
const carClearcoatRough = createRemappedTexture(36);
const texLoader = new THREE.TextureLoader();
const carScratchBumpTex = texLoader.load('assets/textures/metal.png', (tex) => {
  const img = tex.image;
  if (!img || !img.width || !img.height) return;

  carBaseRough.canvas.width = img.width;
  carBaseRough.canvas.height = img.height;
  const rCtx = carBaseRough.canvas.getContext('2d');
  rCtx.drawImage(img, 0, 0);
  const rData = rCtx.getImageData(0, 0, img.width, img.height);

  carClearcoatRough.canvas.width = img.width;
  carClearcoatRough.canvas.height = img.height;
  const cCtx = carClearcoatRough.canvas.getContext('2d');
  const cData = cCtx.createImageData(img.width, img.height);

  const rd = rData.data;
  const cd = cData.data;
  for (let i = 0; i < rd.length; i += 4) {
    const lum = (rd[i] + rd[i + 1] + rd[i + 2]) / 3;
    const t = lum / 255;
    const baseVal = Math.round(54 + t * 168);
    rd[i] = baseVal;
    rd[i + 1] = baseVal;
    rd[i + 2] = baseVal;
    const coatVal = Math.round(34 + t * 151);
    cd[i] = coatVal;
    cd[i + 1] = coatVal;
    cd[i + 2] = coatVal;
    cd[i + 3] = 255;
  }
  rCtx.putImageData(rData, 0, 0);
  cCtx.putImageData(cData, 0, 0);
  carBaseRough.tex.needsUpdate = true;
  carClearcoatRough.tex.needsUpdate = true;
});
carScratchBumpTex.wrapS = THREE.RepeatWrapping;
carScratchBumpTex.wrapT = THREE.RepeatWrapping;
carScratchBumpTex.repeat.set(3, 3);

export function buildSportsCarMesh({
  name = 'SPORTS CAR',
  bodyHex = 0xdc2626,
  accentHex = 0xf8fafc,
  x = 0,
  y = 0.12,
  z = 0,
  yaw = 0,
  scale = DEFAULT_SCALE,
  isCoupe = true,
  isSupercar = false
} = {}) {
  const root = new THREE.Group();
  root.userData.studioName = name;
  const carScale = Number.isFinite(scale) && scale > 0.2 ? scale : DEFAULT_SCALE;
  root.scale.setScalar(carScale);
  root.position.set(x, Number.isFinite(y) ? y : 0.12, z);
  root.rotation.order = 'YXZ';
  root.rotation.y = yaw;

  const chassis = new THREE.Group();
  chassis.userData.studioName = 'Chassis';
  root.add(chassis);

  const bodyMat = makeMat(bodyHex, {
    isCarMetal: true,
    texType: 'metallicflake',
    repeatX: 6,
    repeatY: 6,
    metalness: isSupercar ? 0.78 : 0.72,
    roughness: 0.88,
    clearcoat: isSupercar ? 0.95 : 0.85,
    clearcoatRoughness: 0.95,
    envMapIntensity: 1.45,
    flatShading: false
  });
  bodyMat.roughnessMap = carBaseRough.tex;
  bodyMat.clearcoatRoughnessMap = carClearcoatRough.tex;
  bodyMat.bumpMap = carScratchBumpTex;
  bodyMat.bumpScale = 0.01;
  bodyMat.needsUpdate = true;

  const accentMat = makeMat(accentHex, {
    isCarMetal: true,
    metalness: 0.74,
    roughness: 0.88,
    clearcoat: 0.85,
    clearcoatRoughness: 0.95,
    envMapIntensity: 1.45,
    flatShading: false
  });
  accentMat.roughnessMap = carBaseRough.tex;
  accentMat.clearcoatRoughnessMap = carClearcoatRough.tex;
  accentMat.bumpMap = carScratchBumpTex;
  accentMat.bumpScale = 0.009;
  accentMat.needsUpdate = true;

  const chromeMat = makeMat(0xf8fafc, {
    texType: 'brushedsteel',
    metalness: 0.92,
    roughness: 0.55,
    envMapIntensity: 1.65,
    flatShading: false
  });
  chromeMat.roughnessMap = carBaseRough.tex;
  chromeMat.bumpMap = carScratchBumpTex;
  chromeMat.bumpScale = 0.007;
  chromeMat.needsUpdate = true;

  const carbonMat = makeMat(0x0f172a, { roughness: 0.45, metalness: 0.35, clearcoat: 0.25, flatShading: false });
  const glassMat = makeMat(0x38bdf8, {
    metalness: 0.25,
    roughness: 0.16,
    clearcoat: 0.55,
    envMapIntensity: 0.9,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
    flatShading: false
  });

  const lowerH = isSupercar ? 0.42 : 0.54;
  const lowerY = isSupercar ? 0.54 : 0.62;
  const bodyLen = 4.46;
  const bodyHalfZ = bodyLen / 2;
  const doorLen = isSupercar ? 1.34 : (isCoupe ? 1.44 : 1.32);
  const doorFrontZ = isSupercar ? 0.62 : (isCoupe ? 0.54 : 0.72);
  const doorRearZ = doorFrontZ - doorLen;
  const doorCenterZ = (doorFrontZ + doorRearZ) * 0.5;

  const frontLen = bodyHalfZ - doorFrontZ;
  const lowerFront = new THREE.Mesh(new THREE.BoxGeometry(2.04, lowerH, frontLen), bodyMat);
  lowerFront.userData.studioName = 'Body Front';
  lowerFront.position.set(0, lowerY, doorFrontZ + frontLen * 0.5);
  lowerFront.castShadow = true;
  lowerFront.receiveShadow = true;

  const rearLen = doorRearZ - (-bodyHalfZ);
  const lowerRear = new THREE.Mesh(new THREE.BoxGeometry(2.04, lowerH, rearLen), bodyMat);
  lowerRear.userData.studioName = 'Body Rear';
  lowerRear.position.set(0, lowerY, -bodyHalfZ + rearLen * 0.5);
  lowerRear.castShadow = true;
  lowerRear.receiveShadow = true;

  const floorPan = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.14, doorLen), carbonMat);
  floorPan.position.set(0, lowerY - lowerH / 2 + 0.07, doorCenterZ);
  floorPan.receiveShadow = true;

  const centerConsole = new THREE.Mesh(new THREE.BoxGeometry(0.28, lowerH * 0.76, doorLen), carbonMat);
  centerConsole.position.set(0, lowerY - lowerH / 2 + lowerH * 0.38, doorCenterZ);

  const sideSkirtL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 2.7), carbonMat);
  sideSkirtL.position.set(-1.04, 0.34, 0);
  const sideSkirtR = sideSkirtL.clone();
  sideSkirtR.position.x = 1.04;

  const stripeFront = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.02, frontLen - 0.04), accentMat);
  stripeFront.position.set(0, lowerY + lowerH / 2 + 0.01, doorFrontZ + frontLen * 0.5);
  const stripeRear = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.02, rearLen - 0.04), accentMat);
  stripeRear.position.set(0, lowerY + lowerH / 2 + 0.01, -bodyHalfZ + rearLen * 0.5);

  const cabinLen = isSupercar ? 1.85 : (isCoupe ? 2.0 : 2.65);
  const cabinH = isSupercar ? 0.56 : 0.78;
  const cabinZ = isSupercar ? -0.10 : (isCoupe ? -0.22 : -0.05);
  const cabin = new THREE.Group();
  cabin.userData.studioName = 'Cabin';
  cabin.position.set(0, lowerY + lowerH / 2 + cabinH / 2 - 0.02, cabinZ);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.09, cabinLen), bodyMat);
  roof.userData.studioName = 'Cabin roof';
  roof.position.y = cabinH / 2 - 0.045;
  roof.castShadow = true;
  cabin.add(roof);

  const rearQuarterLen = Math.max(0, doorRearZ - (cabinZ - cabinLen / 2 + 0.06));
  const pillarGeo = new THREE.BoxGeometry(0.11, cabinH - 0.08, 0.11);
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      const pillar = new THREE.Mesh(pillarGeo, bodyMat);
      pillar.position.set(side * 0.82, -0.02, end * (cabinLen / 2 - 0.06));
      pillar.castShadow = true;
      cabin.add(pillar);
    }
    if (rearQuarterLen > 0.05) {
      const qCenterZ = (doorRearZ + (cabinZ - cabinLen / 2 + 0.06)) * 0.5 - cabinZ;
      const rearSill = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, rearQuarterLen), bodyMat);
      rearSill.position.set(side * 0.82, -cabinH / 2 + 0.05, qCenterZ);
      const rearQuarterGlass = new THREE.Mesh(new THREE.PlaneGeometry(rearQuarterLen, cabinH * 0.64), glassMat);
      rearQuarterGlass.position.set(side * 0.79, -0.015, qCenterZ);
      rearQuarterGlass.rotation.y = side * (Math.PI / 2);
      cabin.add(rearSill, rearQuarterGlass);
    }
  }

  const glassFront = new THREE.Mesh(new THREE.PlaneGeometry(1.48, cabinH * 0.74), glassMat);
  glassFront.position.set(0, -0.015, cabinLen / 2 - 0.035);
  glassFront.rotation.x = -0.16;
  const glassRear = new THREE.Mesh(new THREE.PlaneGeometry(1.48, cabinH * 0.68), glassMat);
  glassRear.position.set(0, -0.015, -cabinLen / 2 + 0.035);
  glassRear.rotation.y = Math.PI;
  cabin.add(glassFront, glassRear);

  function buildDoorAssembly(side) {
    const doorPivot = new THREE.Group();
    doorPivot.userData.studioName = side < 0 ? 'Left Door' : 'Right Door';
    doorPivot.position.set(side * 0.96, lowerY, doorFrontZ);

    const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(0.12, lowerH, doorLen), bodyMat);
    doorPanel.position.set(0, 0, -doorLen * 0.5);
    doorPanel.castShadow = true;
    doorPanel.receiveShadow = true;

    const beltTrim = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.045, doorLen), carbonMat);
    beltTrim.position.set(0, lowerH * 0.5 - 0.01, -doorLen * 0.5);

    const doorGlass = new THREE.Mesh(new THREE.PlaneGeometry(doorLen - 0.12, cabinH * 0.64), glassMat);
    doorGlass.position.set(side * 0.01, lowerH * 0.5 + cabinH * 0.33, -doorLen * 0.5);
    doorGlass.rotation.y = side * (Math.PI / 2);

    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.045, 0.18), chromeMat);
    handle.position.set(side * 0.065, lowerH * 0.5 - 0.09, -doorLen + 0.24);

    const mirrorArm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.05), carbonMat);
    mirrorArm.position.set(side * 0.09, lowerH * 0.5 + 0.05, -0.14);
    const mirrorCap = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.075, 0.09), bodyMat);
    mirrorCap.position.set(side * 0.15, lowerH * 0.5 + 0.07, -0.14);

    doorPivot.add(doorPanel, beltTrim, doorGlass, handle, mirrorArm, mirrorCap);
    return doorPivot;
  }

  const doorLeftPivot = buildDoorAssembly(-1);
  const doorRightPivot = buildDoorAssembly(1);

  const dashboard = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.15, 0.42), carbonMat);
  dashboard.userData.studioName = 'Dashboard';
  dashboard.position.set(0, lowerY + lowerH / 2 + 0.08, 0.76);

  const seatBackHeight = isSupercar ? 0.25 : 0.38;
  const seats = [];
  for (const side of [-1, 1]) {
    const seat = new THREE.Group();
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.12, 0.52), carbonMat);
    cushion.position.set(0, 0.83, -0.26);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.48, seatBackHeight, 0.12), carbonMat);
    back.position.set(0, 0.88 + seatBackHeight / 2, -0.5);
    seat.add(cushion, back);
    seat.position.x = side * 0.4;
    seats.push(seat);
  }

  if (!isCoupe && !isSupercar) {
    const bench = new THREE.Group();
    bench.userData.studioName = 'Rear bench';
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.12, 0.5), carbonMat);
    cushion.position.set(0, 0.83, -0.86);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.32, seatBackHeight, 0.12), carbonMat);
    back.position.set(0, 0.88 + seatBackHeight / 2, -1.08);
    bench.add(cushion, back);
    seats.push(bench);
  }

  const steeringPivot = new THREE.Group();
  steeringPivot.userData.studioName = 'Steering assembly';
  steeringPivot.position.set(-0.42, cabin.position.y - (isSupercar ? 0.12 : 0.16), 0.54);
  const steeringWheel = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.035, 8, 20), carbonMat);
  steeringWheel.userData.studioName = 'Steering wheel';
  steeringPivot.add(steeringWheel);
  const steeringHub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.09, 8), chromeMat);
  steeringHub.userData.studioName = 'Steering hub';
  steeringHub.rotation.x = Math.PI / 2;
  steeringPivot.add(steeringHub);
  for (let spoke = 0; spoke < 3; spoke++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.22, 0.035), chromeMat);
    bar.userData.studioName = `Steering spoke ${spoke + 1}`;
    bar.rotation.z = spoke * Math.PI * 2 / 3;
    steeringPivot.add(bar);
  }

  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.24, 0.08), carbonMat);
  grille.position.set(0, 0.52, 2.24);
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.07, 0.35), carbonMat);
  splitter.position.set(0, 0.32, 2.26);

  const hlMat = makeMat(0xfef9c3, { emissive: 0xfef08a, emissiveIntensity: 0.9 });
  const hlL = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.08), hlMat);
  hlL.position.set(-0.68, 0.66, 2.24);
  const hlR = hlL.clone();
  hlR.position.x = 0.68;

  const tlMat = makeMat(0xef4444, { emissive: 0xdc2626, emissiveIntensity: 0.65 });
  const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.14, 0.08), tlMat);
  tlL.position.set(-0.64, 0.68, -2.24);
  const tlR = tlL.clone();
  tlR.position.x = 0.64;

  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.22, 0.14), carbonMat);
  diffuser.position.set(0, 0.36, -2.23);

  const pipeGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.22, 10);
  const pipeL = new THREE.Mesh(pipeGeo, chromeMat);
  pipeL.rotation.x = Math.PI / 2;
  pipeL.position.set(-0.52, 0.34, -2.28);
  const pipeR = pipeL.clone();
  pipeR.position.x = 0.52;

  const flameMat = new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.92 });
  const flameCoreMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.95 });
  const flameL = new THREE.Group();
  const fOuterL = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.95, 8), flameMat);
  fOuterL.rotation.x = -Math.PI / 2;
  fOuterL.position.z = -0.45;
  const fInnerL = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.52, 8), flameCoreMat);
  fInnerL.rotation.x = -Math.PI / 2;
  fInnerL.position.z = -0.26;
  flameL.add(fOuterL, fInnerL);
  flameL.position.set(-0.52, 0.34, -2.35);
  flameL.visible = false;
  const flameR = flameL.clone();
  flameR.position.x = 0.52;
  flameR.visible = false;

  chassis.add(
    lowerFront, lowerRear, floorPan, centerConsole,
    sideSkirtL, sideSkirtR, stripeFront, stripeRear,
    cabin, doorLeftPivot, doorRightPivot,
    dashboard, steeringPivot, ...seats,
    grille, splitter, hlL, hlR, tlL, tlR, diffuser, pipeL, pipeR, flameL, flameR
  );

  if (isCoupe || isSupercar) {
    const wingY = isSupercar ? 1.02 : 1.04;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(isSupercar ? 2.06 : 1.88, 0.07, 0.34), carbonMat);
    wing.position.set(0, wingY, -2.06);
    const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.24, 0.22), carbonMat);
    s1.position.set(-0.62, wingY - 0.11, -2.06);
    const s2 = s1.clone();
    s2.position.x = 0.62;
    chassis.add(wing, s1, s2);
  }

  const tireMat = makeMat(0x111827, { roughness: 0.85, flatShading: false });
  const rimMat = chromeMat;
  const brakeCaliperMat = makeMat(isSupercar ? 0xef4444 : accentHex, { metalness: 0.55, roughness: 0.32 });
  const wheelPivots = [];
  const wheelSpinners = [];
  [
    [-0.98, 0.38, 1.38],
    [0.98, 0.38, 1.38],
    [-0.98, 0.38, -1.38],
    [0.98, 0.38, -1.38]
  ].forEach(([wx, wy, wz], idx) => {
    const steerPivot = new THREE.Group();
    steerPivot.userData.studioName = `${idx < 2 ? 'Front' : 'Rear'} ${idx % 2 === 0 ? 'left' : 'right'} wheel`;
    steerPivot.position.set(wx, wy, wz);
    const spinGroup = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.28, 18), tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.295, 14), rimMat);
    rim.rotation.z = Math.PI / 2;
    const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.12), brakeCaliperMat);
    caliper.position.set(idx % 2 === 0 ? -0.06 : 0.06, 0.11, -0.09);
    spinGroup.add(tire, rim, caliper);
    steerPivot.add(spinGroup);
    root.add(steerPivot);
    wheelPivots.push(steerPivot);
    wheelSpinners.push(spinGroup);
  });

  return {
    root, chassis, doorLeftPivot, doorRightPivot, wheelPivots, wheelSpinners, flameL, flameR,
    windowMaterial: glassMat, steeringPivot, name, isSupercar, isCoupe, isBus: false,
    carScale, wheelRadius: 0.38,
    cameraSeat: new THREE.Vector3(-0.38, isSupercar ? 1.02 : 1.30, 0.12),
    cameraYaw: yaw + Math.PI, cameraPitch: 0.25, cameraLookIdle: 2, lastCameraYaw: yaw
  };
}

export function buildBusMesh({
  name = 'CITY BUS',
  bodyHex = 0xf59e0b,
  accentHex = 0x0f172a,
  x = 0,
  y = 0.12,
  z = 0,
  yaw = 0,
  scale = BUS_DEFAULT_SCALE
} = {}) {
  const root = new THREE.Group();
  root.userData.studioName = name;
  const carScale = Number.isFinite(scale) && scale > 0.2 ? scale : BUS_DEFAULT_SCALE;
  root.scale.setScalar(carScale);
  root.position.set(x, Number.isFinite(y) ? y : 0.12, z);
  root.rotation.order = 'YXZ';
  root.rotation.y = yaw;

  const chassis = new THREE.Group();
  chassis.userData.studioName = 'Chassis';
  root.add(chassis);

  const bodyMat = makeMat(bodyHex, {
    isCarMetal: true,
    texType: 'metallicflake',
    repeatX: 8,
    repeatY: 4,
    metalness: 0.58,
    roughness: 0.88,
    clearcoat: 0.62,
    clearcoatRoughness: 0.95,
    envMapIntensity: 1.25,
    flatShading: false
  });
  bodyMat.roughnessMap = carBaseRough.tex;
  bodyMat.clearcoatRoughnessMap = carClearcoatRough.tex;
  bodyMat.bumpMap = carScratchBumpTex;
  bodyMat.bumpScale = 0.012;
  bodyMat.needsUpdate = true;

  const accentMat = makeMat(accentHex, {
    isCarMetal: true, metalness: 0.6, roughness: 0.88, clearcoat: 0.5,
    clearcoatRoughness: 0.95, envMapIntensity: 1.2, flatShading: false
  });
  accentMat.roughnessMap = carBaseRough.tex;
  accentMat.bumpMap = carScratchBumpTex;
  accentMat.bumpScale = 0.01;
  accentMat.needsUpdate = true;

  const chromeMat = makeMat(0xf8fafc, {
    texType: 'brushedsteel', metalness: 0.92, roughness: 0.55,
    envMapIntensity: 1.6, flatShading: false
  });
  const darkMat = makeMat(0x1f2937, { roughness: 0.72, metalness: 0.25, flatShading: false });
  const floorMat = makeMat(0x334155, { roughness: 0.92, flatShading: false });
  const seatMat = makeMat(0x1e3a8a, { roughness: 0.8, flatShading: false });
  const glassMat = makeMat(0x38bdf8, {
    metalness: 0.25, roughness: 0.16, clearcoat: 0.55, envMapIntensity: 0.9,
    transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, flatShading: false
  });

  const halfLen = 4.35;
  const bodyLen = halfLen * 2;

  const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.36, 0.95, bodyLen), bodyMat);
  skirt.userData.studioName = 'Body Lower';
  skirt.position.set(0, 1.05, 0);
  skirt.castShadow = true;
  skirt.receiveShadow = true;

  const belt = new THREE.Mesh(new THREE.BoxGeometry(2.38, 0.14, bodyLen + 0.02), accentMat);
  belt.userData.studioName = 'Belt rail';
  belt.position.set(0, 1.60, 0);

  const floorPan = new THREE.Mesh(new THREE.BoxGeometry(2.16, 0.12, bodyLen - 0.4), floorMat);
  floorPan.position.set(0, 0.74, 0);
  floorPan.receiveShadow = true;

  const roofPanel = new THREE.Mesh(new THREE.BoxGeometry(2.34, 0.12, bodyLen - 0.04), bodyMat);
  roofPanel.userData.studioName = 'Roof';
  roofPanel.position.set(0, 2.86, 0);
  roofPanel.castShadow = true;

  const roofCap = new THREE.Mesh(new THREE.BoxGeometry(2.16, 0.10, bodyLen - 0.4), bodyMat);
  roofCap.position.set(0, 2.97, 0);
  roofCap.castShadow = true;

  const acUnit = new THREE.Mesh(new THREE.BoxGeometry(1.30, 0.22, 2.20), darkMat);
  acUnit.userData.studioName = 'Roof AC unit';
  acUnit.position.set(0, 3.08, -1.20);

  const frontCap = new THREE.Mesh(new THREE.BoxGeometry(2.34, 1.24, 0.16), bodyMat);
  frontCap.position.set(0, 2.24, halfLen - 0.05);
  frontCap.castShadow = true;
  const rearCap = new THREE.Mesh(new THREE.BoxGeometry(2.34, 1.24, 0.16), bodyMat);
  rearCap.position.set(0, 2.24, -halfLen + 0.05);
  rearCap.castShadow = true;

  const windshield = new THREE.Mesh(new THREE.PlaneGeometry(2.02, 1.02), glassMat);
  windshield.position.set(0, 2.26, halfLen + 0.04);
  const rearWindow = new THREE.Mesh(new THREE.PlaneGeometry(1.90, 0.92), glassMat);
  rearWindow.position.set(0, 2.26, -halfLen - 0.04);
  rearWindow.rotation.y = Math.PI;

  const signMat = makeMat(0xfef3c7, { emissive: 0xfbbf24, emissiveIntensity: 0.85 });
  const destSign = new THREE.Mesh(new THREE.BoxGeometry(1.60, 0.28, 0.06), signMat);
  destSign.userData.studioName = 'Destination sign';
  destSign.position.set(0, 2.76, halfLen + 0.05);

  const sideParts = [];
  for (const side of [-1, 1]) {
    const glassStrip = new THREE.Mesh(new THREE.PlaneGeometry(bodyLen - 1.0, 1.02), glassMat);
    glassStrip.position.set(side * 1.19, 2.24, -0.25);
    glassStrip.rotation.y = side * (Math.PI / 2);
    sideParts.push(glassStrip);
    for (let pz = 3.55; pz >= -4.0; pz -= 1.28) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.10, 1.22, 0.12), bodyMat);
      pillar.position.set(side * 1.17, 2.24, pz);
      pillar.castShadow = true;
      sideParts.push(pillar);
    }
    const lowerRail = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.16, bodyLen - 0.2), accentMat);
    lowerRail.position.set(side * 1.19, 1.70, 0);
    sideParts.push(lowerRail);
  }

  function buildBusDoor(side, leafCount) {
    const pivot = new THREE.Group();
    pivot.userData.studioName = side < 0 ? 'Driver Door' : 'Passenger Door';
    pivot.position.set(side * 1.19, 1.55, 3.95);
    const leafLen = leafCount === 2 ? 0.56 : 0.95;
    for (let i = 0; i < leafCount; i++) {
      const zOff = -0.30 - i * (leafLen + 0.04);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.85, leafLen), bodyMat);
      panel.position.set(0, 0.35, zOff);
      panel.castShadow = true;
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(leafLen - 0.10, 1.05), glassMat);
      glass.position.set(side * 0.02, 0.62, zOff);
      glass.rotation.y = side * (Math.PI / 2);
      pivot.add(panel, glass);
    }
    return pivot;
  }
  const doorLeftPivot = buildBusDoor(-1, 1);
  const doorRightPivot = buildBusDoor(1, 2);

  const seats = [];
  BUS_SEAT_ANCHORS.forEach((a, i) => {
    const seat = new THREE.Group();
    seat.userData.studioName = i === 0 ? 'Driver seat' : `Passenger seat ${i}`;
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.52), seatMat);
    cushion.position.set(0, 1.20, 0);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.52, 0.12), seatMat);
    back.position.set(0, 1.50, -0.26);
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.44, 0.16), darkMat);
    pedestal.position.set(0, 0.98, 0);
    seat.add(cushion, back, pedestal);
    seat.position.set(a[0], 0, a[2]);
    seats.push(seat);
  });

  const rearBench = new THREE.Mesh(new THREE.BoxGeometry(2.00, 0.14, 0.60), seatMat);
  rearBench.position.set(0, 1.20, -3.60);
  const rearBenchBack = new THREE.Mesh(new THREE.BoxGeometry(2.00, 0.52, 0.12), seatMat);
  rearBenchBack.position.set(0, 1.50, -3.90);

  const poles = [];
  for (const pz of [2.85, 1.75, 0.65, -0.45]) {
    for (const px of [-0.34, 0.34]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.05, 8), chromeMat);
      pole.position.set(px, 1.80, pz);
      poles.push(pole);
    }
  }
  const grabRail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 6.4, 8), chromeMat);
  grabRail.rotation.x = Math.PI / 2;
  grabRail.position.set(0, 2.72, -0.4);

  const dashboard = new THREE.Mesh(new THREE.BoxGeometry(1.90, 0.28, 0.55), darkMat);
  dashboard.userData.studioName = 'Dashboard';
  dashboard.position.set(0, 1.62, 4.00);

  const steeringPivot = new THREE.Group();
  steeringPivot.userData.studioName = 'Steering assembly';
  steeringPivot.position.set(-0.62, 1.74, 3.82);
  steeringPivot.rotation.x = -0.85;
  const steeringWheel = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.038, 8, 22), darkMat);
  steeringWheel.userData.studioName = 'Steering wheel';
  steeringPivot.add(steeringWheel);
  const steeringHub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.10, 8), chromeMat);
  steeringHub.rotation.x = Math.PI / 2;
  steeringPivot.add(steeringHub);
  for (let spoke = 0; spoke < 3; spoke++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.04), chromeMat);
    bar.rotation.z = spoke * Math.PI * 2 / 3;
    steeringPivot.add(bar);
  }

  const hlMat = makeMat(0xfef9c3, { emissive: 0xfef08a, emissiveIntensity: 0.9 });
  const tlMat = makeMat(0xef4444, { emissive: 0xdc2626, emissiveIntensity: 0.65 });
  const amberMat = makeMat(0xf59e0b, { emissive: 0xf59e0b, emissiveIntensity: 0.6 });
  const lamps = [];
  for (const side of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.24, 0.10), hlMat);
    hl.position.set(side * 0.76, 0.98, halfLen + 0.04);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.10), tlMat);
    tl.position.set(side * 0.92, 1.18, -halfLen - 0.04);
    const indicator = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.14, 0.08), amberMat);
    indicator.position.set(side * 1.06, 0.98, halfLen + 0.04);
    const mirrorArm = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.05, 0.05), darkMat);
    mirrorArm.position.set(side * 1.34, 2.52, halfLen - 0.18);
    const mirrorCap = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.34, 0.16), darkMat);
    mirrorCap.position.set(side * 1.50, 2.42, halfLen - 0.18);
    lamps.push(hl, tl, indicator, mirrorArm, mirrorCap);
  }
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.30, 0.24), darkMat);
  bumperF.position.set(0, 0.66, halfLen + 0.10);
  const bumperR = bumperF.clone();
  bumperR.position.z = -halfLen - 0.10;

  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.26, 10), chromeMat);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(-0.70, 0.46, -halfLen - 0.14);

  const flameMat = new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.9 });
  const flameCoreMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.92 });
  const flameL = new THREE.Group();
  const fOuter = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.62, 8), flameMat);
  fOuter.rotation.x = -Math.PI / 2;
  fOuter.position.z = -0.30;
  const fInner = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.34, 8), flameCoreMat);
  fInner.rotation.x = -Math.PI / 2;
  fInner.position.z = -0.17;
  flameL.add(fOuter, fInner);
  flameL.position.set(-0.70, 0.46, -halfLen - 0.22);
  flameL.visible = false;
  const flameR = flameL.clone();
  flameR.position.x = 0.70;
  flameR.visible = false;

  chassis.add(
    skirt, belt, floorPan, roofPanel, roofCap, acUnit,
    frontCap, rearCap, windshield, rearWindow, destSign,
    ...sideParts, doorLeftPivot, doorRightPivot,
    ...seats, rearBench, rearBenchBack, ...poles, grabRail,
    dashboard, steeringPivot, ...lamps, bumperF, bumperR, exhaust, flameL, flameR
  );

  const tireMat = makeMat(0x111827, { roughness: 0.88, flatShading: false });
  const wheelPivots = [];
  const wheelSpinners = [];
  const R = 0.52;
  [
    [-1.02, R, 3.05, 0.34],
    [1.02, R, 3.05, 0.34],
    [-1.22, R, -2.55, 0.30],
    [1.22, R, -2.55, 0.30],
    [-0.88, R, -2.55, 0.30],
    [0.88, R, -2.55, 0.30]
  ].forEach(([wx, wy, wz, width], idx) => {
    const pivot = new THREE.Group();
    pivot.userData.studioName = `${idx < 2 ? 'Front' : 'Rear'} wheel ${idx}`;
    pivot.position.set(wx, wy, wz);
    const spinGroup = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(R, R, width, 18), tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.58, R * 0.58, width + 0.02, 14), chromeMat);
    rim.rotation.z = Math.PI / 2;
    spinGroup.add(tire, rim);
    pivot.add(spinGroup);
    root.add(pivot);
    wheelPivots.push(pivot);
    wheelSpinners.push(spinGroup);

    const arch = new THREE.Mesh(new THREE.BoxGeometry(width + 0.14, 0.14, R * 2.3), darkMat);
    arch.position.set(wx, R + 0.52, wz);
    chassis.add(arch);
  });

  return {
    root, chassis, doorLeftPivot, doorRightPivot, wheelPivots, wheelSpinners, flameL, flameR,
    windowMaterial: glassMat, steeringPivot, name,
    isSupercar: false, isCoupe: false, isBus: true,
    carScale, wheelRadius: R,
    cameraSeat: new THREE.Vector3(BUS_SEAT_ANCHORS[0][0], BUS_SEAT_ANCHORS[0][1], BUS_SEAT_ANCHORS[0][2]),
    cameraYaw: yaw + Math.PI, cameraPitch: 0.25, cameraLookIdle: 2, lastCameraYaw: yaw
  };
}

function createVehicleRecord(cfg, parts, spawnY) {
  const { name, x, z, yaw } = cfg;
  const carObj = {
    uid: ++vehicleUid,
    name,
    isSupercar: Boolean(parts.isSupercar),
    isCoupe: parts.isCoupe,
    isBus: Boolean(parts.isBus),
    isTank: Boolean(cfg.isTank),
    x,
    y: spawnY,
    z,
    yaw,
    vy: 0,
    pitch: 0,
    roll: 0,
    pitchSway: 0,
    rollSway: 0,
    speed: 0,
    velX: 0,
    velZ: 0,
    gearIndex: 2,      
    rpm: 900,
    steerAngle: 0,
    pitchAngle: 0,
    rollAngle: 0,
    flameTimer: 0,
    flameL: parts.flameL,
    flameR: parts.flameR,
    windowMaterial: parts.windowMaterial,
    root: parts.root,
    chassis: parts.chassis,
    doorLeftPivot: parts.doorLeftPivot,
    doorRightPivot: parts.doorRightPivot,
    doorOpenL: 0,
    doorOpenR: 0,
    doorTargetL: 0,
    doorTargetR: 0,
    doorAutoCloseTimer: 0,
    entryAnim: null,
    carScale: parts.carScale,
    wheelRadius: parts.wheelRadius || 0.38,
    cameraSeat: parts.cameraSeat,
    cameraYaw: parts.cameraYaw,
    cameraPitch: parts.cameraPitch,
    cameraLookIdle: parts.cameraLookIdle,
    lastCameraYaw: parts.lastCameraYaw,
    steeringPivot: parts.steeringPivot,
    wheelPivots: parts.wheelPivots,
    wheelSpinners: parts.wheelSpinners,
    water: null,
    _inWater: false,
    _roofWasDown: false,
    _rightTimer: 0,
    _roofScrapeT: 0,
    occupants: [],
    localSeat: -1
  };
  parts.root.userData.vehicleUid = carObj.uid;
  vehicles.push(carObj);
  return carObj;
}

export function buildSportsCar(cfg) {
  const wantsBus = cfg && (cfg.isBus === true || cfg.type === 'bus' || /\b(bus|coach)\b/i.test(cfg.name || ''));
  if (wantsBus) return buildBus(cfg);

  const { x, z, yaw } = cfg;
  const spawnY = Number.isFinite(cfg.y) ? cfg.y : computeSupportFloor(x, z, 1.2, 0.9) + 0.02;
  const parts = buildSportsCarMesh({ ...cfg, y: spawnY });
  worldRoot.add(parts.root);
  return createVehicleRecord(cfg, parts, spawnY);
}

export function buildBus(cfg = {}) {
  const merged = { name: 'CITY BUS', scale: BUS_DEFAULT_SCALE, ...cfg, isBus: true };
  const { x = 0, z = 0 } = merged;
  const spawnY = Number.isFinite(merged.y) ? merged.y : computeSupportFloor(x, z, 1.6, 1.4) + 0.02;
  const parts = buildBusMesh({ ...merged, y: spawnY });
  worldRoot.add(parts.root);
  return createVehicleRecord(merged, parts, spawnY);
}

export function buildVehicle(cfg = {}) {
  const t = String(cfg.type || '').toLowerCase();
  if (t === 'bus' || cfg.isBus || /\b(bus|coach)\b/i.test(cfg.name || '')) return buildBus(cfg);
  return buildSportsCar(cfg);
}

export function resetVehicles() {
  for (const v of vehicles) {
    if (v.entryAnim) disposeEntryProxy(v.entryAnim);
    if (v.root && v.root.parent) v.root.parent.remove(v.root);
  }
  vehicles.length = 0;
  carCollisionCooldowns.clear();
}

function buildEntryProxyMesh() {
  const pp = levelData?.params?.player || {};
  const toHex = (c, d) => (c === undefined || c === null || c === '')
    ? d
    : (typeof c === 'number' ? c : new THREE.Color(c).getHex());
  const shirtMat = makeMat(toHex(pp.bodyColor, 0x1e293b));
  const pantsMat = makeMat(toHex(pp.accentColor, 0x0f172a));
  const skinMat = makeMat(0xe2a87e);

  const rig = new THREE.Group();
  const hip = new THREE.Group();
  hip.position.y = 0.88;
  rig.add(hip);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.54, 0.22), shirtMat);
  torso.position.y = 0.27;
  torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.27, 0.25), skinMat);
  head.position.y = 0.70;
  head.castShadow = true;
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.09, 0.27), pantsMat);
  hair.position.y = 0.82;

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.46, 0.11), shirtMat);
  armL.position.set(-0.30, 0.28, 0.04);
  armL.rotation.x = -0.35;
  const armR = armL.clone();
  armR.position.x = 0.30;

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.70, 0.14), pantsMat);
  legL.position.set(-0.12, -0.35, 0);
  legL.castShadow = true;
  const legR = legL.clone();
  legR.position.x = 0.12;

  hip.add(torso, head, hair, armL, armR, legL, legR);
  return { rig, hip, legL, legR };
}

function disposeEntryProxy(anim) {
  if (!anim || !anim.proxy) return;
  worldRoot.remove(anim.proxy.rig);
  anim.proxy = null;
}

function computeVehicleExitSpot(v, seatIndex = 0) {
  const sideSign = seatSideSign(seatIndex, v);

  const surf = waterSurfaceY(v.x, v.z);
  if (surf !== null && v.y - bodySupportOffset(v) < surf - 0.25) {
    const sx = Math.cos(v.yaw) * sideSign;
    const sz = -Math.sin(v.yaw) * sideSign;
    const d = (v.isBus ? 3.0 : 2.6) * footprintScale(v) / (v.carScale || DEFAULT_SCALE);
    return { x: v.x + sx * d, y: surf - 0.25, z: v.z + sz * d };
  }

  const exitDistance = (v.isBus ? 2.4 : 2.1) * footprintScale(v);
  const alongDistance = v.isBus ? bodyHalfLength(v) + 1.2 : exitDistance;
  const forwardX = Math.sin(v.yaw);
  const forwardZ = Math.cos(v.yaw);
  const sideX = Math.cos(v.yaw) * sideSign;
  const sideZ = -Math.sin(v.yaw) * sideSign;
  const rearOffset = v.isBus ? (seatIndex === 0 ? 3.2 : 2.6) : (seatIndex >= 2 ? -0.9 : 0.2);

  const candidates = [
    { x: v.x + sideX * exitDistance + forwardX * rearOffset, z: v.z + sideZ * exitDistance + forwardZ * rearOffset },
    { x: v.x - sideX * exitDistance, z: v.z - sideZ * exitDistance },
    { x: v.x - forwardX * alongDistance, z: v.z - forwardZ * alongDistance },
    { x: v.x, y: v.y + 3, z: v.z }
  ];

  for (const candidate of candidates) {
    const candidateY = candidate.y ?? Math.max(0.18, v.y + 0.06);
    const floorY = computeSupportFloor(candidate.x, candidate.z, candidateY + 0.4, player.radius);
    if (!collidesHorizontally(candidate.x, candidate.z, floorY, player.height, player.radius)) {
      return { x: candidate.x, y: candidate.y ?? Math.max(floorY, v.y + 0.06), z: candidate.z };
    }
  }
  return { x: v.x, y: Math.max(0.18, v.y + 0.06), z: v.z };
}

function releaseLocalSeat(idx, v) {
  if (!v) return;
  const mine = localOccupant(v);
  if (!mine) return;
  const wasDriver = mine.seat === 0;
  v.occupants = v.occupants.filter((o) => o !== mine);
  v.localSeat = -1;

  if (wasDriver) {
    if (hooks.mpCarExit) hooks.mpCarExit(idx);
    broadcastSeat('car_seat_exit', v, mine.id, 0);
    const next = v.occupants.slice().sort((a, b) => a.seat - b.seat)[0];
    if (next) {
      next.seat = 0;
      broadcastSeat('car_seat_promote', v, next.id, 0);
      if (next.local) {
        v.localSeat = 0;
        gameState.isPassenger = false;
      }
    }
  } else {
    if (hooks.mpCarExitSeat) hooks.mpCarExitSeat(idx, mine.seat);
    broadcastSeat('car_seat_exit', v, mine.id, mine.seat);
  }
}

function finalizeExitCar(idx, v, exitSpot, silent = false) {
  const wasPassenger = Boolean(gameState.isPassenger);
  gameState.inCar = false;
  gameState.isPassenger = false;
  gameState.activeCarIndex = -1;

  if (v) {
    releaseLocalSeat(idx, v);
    v.flameL.visible = false;
    v.flameR.visible = false;
    v.doorTargetL = 0;
    v.doorTargetR = 0;
    v.doorAutoCloseTimer = 0;
    if (v.entryAnim) {
      disposeEntryProxy(v.entryAnim);
      v.entryAnim = null;
    }
    player.yaw = v.yaw + Math.PI;
  } else if (hooks.mpCarExit) {
    hooks.mpCarExit(idx);
  }

  player.x = exitSpot.x;
  player.y = exitSpot.y;
  player.z = exitSpot.z;
  player.vy = 0;
  const surf = waterSurfaceY(player.x, player.z);
  player.grounded = !(surf !== null && player.y < surf - 0.15);
  player.peakAirY = player.y;
  player.pitch = 0;

  sfx.updateEngine(false, 0, false);
  if (!silent) pushFeed(wasPassenger ? 'LEFT VEHICLE (PASSENGER)' : 'EXITED VEHICLE', 'border-l-slate-400');
  if (hooks.syncMobileControls) hooks.syncMobileControls(true);
  if (hooks.updateHUD) hooks.updateHUD();
}

export function getNearestVehicle(maxDist = 5.2) {
  let best = null;
  let bestDist = maxDist;
  vehicles.forEach((v, idx) => {
    if (v.entryAnim) return;
    if (gameState.inCar && gameState.activeCarIndex === idx) return;
    const freeSeat = firstFreeSeat(v);
    const locked = hooks.mpCarLocked ? hooks.mpCarLocked(idx) : false;
    if (locked && freeSeat <= 0) return;
    if (freeSeat < 0) return;
    const reach = maxDist + (v.isBus ? 1.8 : 0);
    const d = Math.hypot(player.x - v.x, player.z - v.z);
    if (d < reach && d < bestDist + (v.isBus ? 1.8 : 0) && Math.abs(player.y - v.y) < 2.8) {
      bestDist = d;
      best = { v, idx };
    }
  });
  return best;
}

export function enterVehicle(idx) {
  const v = vehicles[idx];
  if (!v || v.entryAnim || gameState.inCar) return;
  const seat = firstFreeSeat(v);
  if (seat < 0) {
    pushFeed(`${v.name} IS FULL`, 'border-l-rose-500');
    sfx.uiClick();
    return;
  }

  const me = localPlayerId();
  const takingDriverSeat = seat === 0;
  if (takingDriverSeat) {
    if (hooks.mpCarEnter && !hooks.mpCarEnter(idx)) return;
  } else {
    if (hooks.mpCarEnterSeat && !hooks.mpCarEnterSeat(idx, seat)) {
      pushFeed('COULD NOT TAKE A SEAT', 'border-l-rose-500');
      return;
    }
  }
  if (hooks.onVehicleEnter) hooks.onVehicleEnter(v);

  v.occupants.push({ id: me, seat, local: true });
  v.localSeat = seat;
  gameState.isPassenger = !takingDriverSeat;
  broadcastSeat('car_seat_enter', v, me, seat);

  const sideSign = seatSideSign(seat, v);
  const side = sideSign > 0 ? 'R' : 'L';
  if (side === 'R') {
    v.doorTargetR = 1;
    v.doorTargetL = 0;
  } else {
    v.doorTargetL = 1;
    v.doorTargetR = 0;
  }
  v.doorAutoCloseTimer = 0;

  const doorZ = v.isBus ? (seat === 0 ? 3.45 : 3.55) : (seat >= 2 ? -0.8 : 0.05);
  const doorwayLocal = new THREE.Vector3(sideSign * (v.isBus ? 1.62 : 1.48), 0.05, doorZ);
  const outsideWorld = v.root.localToWorld(doorwayLocal);
  outsideWorld.y = Math.max(player.y, v.y + 0.04);

  const proxy = buildEntryProxyMesh();
  proxy.rig.position.set(player.x, player.y, player.z);
  proxy.rig.rotation.y = v.yaw + (sideSign > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
  proxy.rig.visible = Boolean(gameState.thirdPerson);
  worldRoot.add(proxy.rig);

  v.entryAnim = {
    type: 'enter',
    timer: 0,
    duration: 0.72,
    side,
    sideSign,
    seat,
    carIdx: idx,
    startPlayerPos: new THREE.Vector3(player.x, player.y, player.z),
    outsidePos: outsideWorld,
    startCamPos: camera.position.clone(),
    startCamQuat: camera.quaternion.clone(),
    proxy,
    weightDropped: false,
    doorClosedSound: false
  };

  gameState.inCar = true;
  gameState.activeCarIndex = idx;
  gameState.isAiming = false;
  inputState.isPrimaryFireHeld = false;
  player.crouching = false;
  player.yaw = v.yaw + Math.PI;
  player.pitch = 0;
  v.lastCameraYaw = v.yaw;
  v.cameraYaw = v.yaw + Math.PI;
  v.cameraPitch = 0.25;
  v.cameraLookIdle = 2;

  if (takingDriverSeat) {
    v.gearIndex = 2;
    v.rpm = 1100;
  }
  sfx.shift();

  if (takingDriverSeat) {
    pushFeed(`ENTERED ${v.name} — [I] UPSHIFT • [K] DOWNSHIFT`, 'border-l-amber-400');
  } else {
    const others = v.occupants.length - 1;
    pushFeed(
      `RIDING IN ${v.name} — PASSENGER SEAT ${seat + 1} (${others} OTHER${others === 1 ? '' : 'S'} ABOARD) • [F] EXIT`,
      'border-l-sky-400'
    );
  }
  if (hooks.syncMobileControls) hooks.syncMobileControls(true);
  if (hooks.updateHUD) hooks.updateHUD();
}

export function exitCurrentCar(silent = false) {
  if (!gameState.inCar) return;
  const idx = gameState.activeCarIndex;
  const v = vehicles[idx];
  if (!v) {
    finalizeExitCar(idx, null, { x: player.x, y: player.y, z: player.z }, silent);
    return;
  }
  const mine = localOccupant(v);
  const seat = mine ? mine.seat : 0;
  const exitSpot = computeVehicleExitSpot(v, seat);

  if (silent) {
    finalizeExitCar(idx, v, exitSpot, true);
    return;
  }
  if (v.entryAnim) return;

  const sideSign = seatSideSign(seat, v);
  const side = sideSign > 0 ? 'R' : 'L';
  if (side === 'R') {
    v.doorTargetR = 1;
    v.doorTargetL = 0;
  } else {
    v.doorTargetL = 1;
    v.doorTargetR = 0;
  }
  v.doorAutoCloseTimer = 0;

  const seatWorld = v.root.localToWorld(seatLocalPos(v, seat).setY(0.25));
  const proxy = buildEntryProxyMesh();
  proxy.rig.position.copy(seatWorld);
  proxy.rig.rotation.y = v.yaw;
  proxy.rig.visible = Boolean(gameState.thirdPerson);
  worldRoot.add(proxy.rig);

  v.entryAnim = {
    type: 'exit',
    timer: 0,
    duration: 0.68,
    side,
    sideSign,
    seat,
    carIdx: idx,
    exitSpot,
    seatWorld,
    startCamPos: camera.position.clone(),
    startCamQuat: camera.quaternion.clone(),
    proxy,
    doorClosedSound: false
  };
}

function stepVehicleEntryExitAnim(v, dt) {
  const anim = v.entryAnim;
  if (!anim) return false;
  anim.timer += dt;
  const rawT = Math.min(1, anim.timer / anim.duration);
  const ease = rawT < 0.5 ? 2 * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 2) / 2;
  const duckDip = Math.sin(rawT * Math.PI) * 0.22;

  const seatAnchor = seatLocalPos(v, anim.seat || 0);
  const seatWorld = v.root.localToWorld(seatAnchor.clone());
  const seatFloorWorld = v.root.localToWorld(seatAnchor.clone().setY(0.24));

  if (anim.type === 'enter') {
    if (rawT >= 0.62) {
      v.doorTargetL = 0;
      v.doorTargetR = 0;
      if (!anim.doorClosedSound) {
        anim.doorClosedSound = true;
        sfx.shift();
      }
    }
    if (rawT >= 0.55 && !anim.weightDropped && v.sus) {
      anim.weightDropped = true;
      v.sus.hv -= 1.6;
    }

    if (anim.proxy) {
      anim.proxy.rig.visible = Boolean(gameState.thirdPerson);
      const stepT = Math.min(1, ease / 0.42);
      const sitT = Math.max(0, (ease - 0.35) / 0.65);
      const curPos = new THREE.Vector3().lerpVectors(anim.startPlayerPos, anim.outsidePos, stepT);
      curPos.lerp(seatFloorWorld, sitT);
      curPos.y -= duckDip * 0.6;
      anim.proxy.rig.position.copy(curPos);
      const startYaw = v.yaw + (anim.sideSign > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
      anim.proxy.rig.rotation.y = startYaw + (v.yaw - startYaw) * sitT;
      anim.proxy.hip.position.y = 0.88 - sitT * 0.34;
      anim.proxy.legL.rotation.x = -sitT * 1.15;
      anim.proxy.legR.rotation.x = -sitT * 1.15;
    }

    if (!gameState.thirdPerson) {
      const targetCamPos = seatWorld.clone();
      targetCamPos.y -= duckDip;
      camera.position.lerpVectors(anim.startCamPos, targetCamPos, ease);
      const lookTarget = v.root.localToWorld(new THREE.Vector3(
        seatAnchor.x * (1 - ease),
        seatAnchor.y + 0.05,
        seatAnchor.z + 4.5
      ));
      const endMat = new THREE.Matrix4().lookAt(camera.position, lookTarget, new THREE.Vector3(0, 1, 0));
      const endQuat = new THREE.Quaternion().setFromRotationMatrix(endMat);
      camera.quaternion.slerpQuaternions(anim.startCamQuat, endQuat, ease);
    } else {
      const aerialDist = chaseDistance(v);
      const horizontalDist = aerialDist * Math.cos(v.cameraPitch);
      const endCamPos = new THREE.Vector3(
        v.x + Math.sin(v.cameraYaw) * horizontalDist,
        Math.max(v.y + 1.15 + Math.sin(v.cameraPitch) * aerialDist, terrainH(v.x, v.z) + 3.0, 2.4),
        v.z + Math.cos(v.cameraYaw) * horizontalDist
      );
      camera.position.lerpVectors(anim.startCamPos, endCamPos, ease);
      const lookAtPos = new THREE.Vector3(v.x, v.y + chaseLookHeight(v), v.z);
      const endMat = new THREE.Matrix4().lookAt(camera.position, lookAtPos, new THREE.Vector3(0, 1, 0));
      const endQuat = new THREE.Quaternion().setFromRotationMatrix(endMat);
      camera.quaternion.slerpQuaternions(anim.startCamQuat, endQuat, ease);
    }

    if (rawT >= 1) {
      disposeEntryProxy(anim);
      v.entryAnim = null;
      player.yaw = v.yaw + Math.PI;
      player.pitch = 0;
      v.lastCameraYaw = v.yaw;
    }
  } else if (anim.type === 'exit') {
    const exitPos = new THREE.Vector3(anim.exitSpot.x, anim.exitSpot.y, anim.exitSpot.z);
    if (rawT >= 0.72) {
      v.doorTargetL = 0;
      v.doorTargetR = 0;
      if (!anim.doorClosedSound) {
        anim.doorClosedSound = true;
        sfx.shift();
      }
    }
    if (anim.proxy) {
      anim.proxy.rig.visible = Boolean(gameState.thirdPerson);
      const standT = Math.min(1, ease / 0.75);
      const curPos = new THREE.Vector3().lerpVectors(seatFloorWorld, exitPos, ease);
      curPos.y -= duckDip * 0.5;
      anim.proxy.rig.position.copy(curPos);
      const outYaw = v.yaw + (anim.sideSign > 0 ? -Math.PI * 0.5 : Math.PI * 0.5);
      anim.proxy.rig.rotation.y = v.yaw + (outYaw - v.yaw) * standT;
      anim.proxy.hip.position.y = 0.54 + standT * 0.34;
      anim.proxy.legL.rotation.x = -(1 - standT) * 1.15;
      anim.proxy.legR.rotation.x = -(1 - standT) * 1.15;
    }

    const eyeH = player.eyeHeight || 1.62;
    if (!gameState.thirdPerson) {
      const endCamPos = new THREE.Vector3(exitPos.x, exitPos.y + eyeH, exitPos.z);
      const midCamPos = new THREE.Vector3().lerpVectors(seatWorld, endCamPos, ease);
      midCamPos.y -= duckDip;
      camera.position.copy(midCamPos);
      const exitYaw = v.yaw + Math.PI;
      const lookTarget = new THREE.Vector3(
        camera.position.x - Math.sin(exitYaw) * 4,
        camera.position.y,
        camera.position.z - Math.cos(exitYaw) * 4
      );
      const endMat = new THREE.Matrix4().lookAt(camera.position, lookTarget, new THREE.Vector3(0, 1, 0));
      const endQuat = new THREE.Quaternion().setFromRotationMatrix(endMat);
      camera.quaternion.slerpQuaternions(anim.startCamQuat, endQuat, ease);
    } else {
      const exitYaw = v.yaw + Math.PI;
      const pivotY = exitPos.y + 1.56;
      const camDist = 3.65;
      const endCamPos = new THREE.Vector3(
        exitPos.x + Math.sin(exitYaw) * camDist,
        Math.max(terrainH(exitPos.x, exitPos.z) + 0.7, pivotY + 0.35),
        exitPos.z + Math.cos(exitYaw) * camDist
      );
      camera.position.lerpVectors(anim.startCamPos, endCamPos, ease);
      const lookAtPos = new THREE.Vector3(exitPos.x, pivotY, exitPos.z);
      const endMat = new THREE.Matrix4().lookAt(camera.position, lookAtPos, new THREE.Vector3(0, 1, 0));
      const endQuat = new THREE.Quaternion().setFromRotationMatrix(endMat);
      camera.quaternion.slerpQuaternions(anim.startCamQuat, endQuat, ease);
    }

    if (rawT >= 1) {
      finalizeExitCar(anim.carIdx, v, anim.exitSpot, false);
      return true;
    }
  }
  return true;
}

export function shiftVehicleGear(delta) {
  if (!gameState.inCar || gameState.isPassenger) return;
  const v = vehicles[gameState.activeCarIndex];
  if (!v) return;
  if (v.water && v.water.floodLatch) {
    pushFeed('ENGINE FLOODED', 'border-l-sky-400');
    sfx.uiClick();
    return;
  }
  const next = Math.max(0, Math.min(GEAR_LABELS.length - 1, v.gearIndex + delta));
  if (next !== v.gearIndex) {
    const prevGear = v.gearIndex;
    v.gearIndex = next;
    sfx.shift();
    if (delta > 0 && next >= 2) {
      v.rpm = Math.max(1400, v.rpm * 0.68);
    } else if (delta < 0 && next >= 2) {
      v.rpm = Math.min(7950, v.rpm * 1.38 + 900);
      if ((v.isSupercar || prevGear >= 4) && !v.isBus) {
        v.flameTimer = v.isSupercar ? 0.52 : 0.28;
        sfx.backfire();
        spawnParticles(
          v.x - Math.sin(v.yaw) * 2.4,
          v.y + 0.36,
          v.z - Math.cos(v.yaw) * 2.4,
          0xf97316,
          v.isSupercar ? 10 : 5,
          4.5
        );
      }
    }
    pushFeed(`SHIFTED TO GEAR ${GEAR_LABELS[v.gearIndex]}`, 'border-l-amber-400');
  }
}

function getCarCircles(v) {
  const { d, r, offsets } = footprintLayout(v);
  const fx = Math.sin(v.yaw);
  const fz = Math.cos(v.yaw);
  return offsets.map((o) => ({
    x: v.x + fx * d * o,
    z: v.z + fz * d * o,
    r,
    isFront: o > 0
  }));
}

function sweptFootprintHit(v, fromX, fromZ, toX, toZ, tx, tz, extraRadius) {
  const { d, r, offsets } = footprintLayout(v);
  const rr = r + extraRadius;
  const fx = Math.sin(v.yaw) * d;
  const fz = Math.cos(v.yaw) * d;
  const travel = Math.hypot(toX - fromX, toZ - fromZ);
  const steps = Math.max(1, Math.ceil(travel / 0.55));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const px = fromX + (toX - fromX) * t;
    const pz = fromZ + (toZ - fromZ) * t;
    for (const o of offsets) {
      if (Math.hypot(px + fx * o - tx, pz + fz * o - tz) < rr) return true;
    }
  }
  return false;
}

function vehicleMass(v) {
  if (v.isTank) return 3.5;
  if (v.isBus) return 3.2;
  return v.carScale || DEFAULT_SCALE;
}

function resolveVehicleCollisions(dt) {
  const now = performance.now();
  const numCars = vehicles.length;
  if (numCars < 2) return;

  if (carCollisionCooldowns.size > 256) {
    for (const [key, stamp] of carCollisionCooldowns) {
      if (now - stamp > 4000) carCollisionCooldowns.delete(key);
    }
  }

  for (let i = 0; i < numCars; i++) {
    const v1 = vehicles[i];
    if (!v1) continue;
    for (let j = i + 1; j < numCars; j++) {
      const v2 = vehicles[j];
      if (!v2) continue;

      const y1 = v1.y - bodySupportOffset(v1) * 0.5;
      const y2 = v2.y - bodySupportOffset(v2) * 0.5;
      if (Math.abs(y1 - y2) > 2.4) continue;

      const dx = v2.x - v1.x;
      const dz = v2.z - v1.z;
      const dist = Math.hypot(dx, dz);
      const l1 = footprintLayout(v1);
      const l2 = footprintLayout(v2);
      const reach = (l1.d + l1.r) + (l2.d + l2.r);
      if (dist > reach || dist < 0.0001) continue;

      const circles1 = getCarCircles(v1);
      const circles2 = getCarCircles(v2);
      let maxOverlap = 0;
      let colNormalX = 0;
      let colNormalZ = 0;
      let contactX = 0;
      let contactZ = 0;

      for (const c1 of circles1) {
        for (const c2 of circles2) {
          const cdx = c2.x - c1.x;
          const cdz = c2.z - c1.z;
          const cDist = Math.hypot(cdx, cdz);
          const minCDist = c1.r + c2.r;
          if (cDist < minCDist) {
            const overlap = minCDist - (cDist || 0.001);
            if (overlap > maxOverlap) {
              maxOverlap = overlap;
              colNormalX = cDist > 0.0001 ? cdx / cDist : 1;
              colNormalZ = cDist > 0.0001 ? cdz / cDist : 0;
              contactX = c1.x + colNormalX * c1.r;
              contactZ = c1.z + colNormalZ * c1.r;
            }
          }
        }
      }
      if (maxOverlap <= 0) continue;

      const m1 = vehicleMass(v1);
      const m2 = vehicleMass(v2);
      const totalMass = m1 + m2;
      const owner1 = hooks.mpCarOwner ? hooks.mpCarOwner(i) : null;
      const owner2 = hooks.mpCarOwner ? hooks.mpCarOwner(j) : null;
      const isDriven1 = gameState.inCar && gameState.activeCarIndex === i;
      const isDriven2 = gameState.inCar && gameState.activeCarIndex === j;
      const w1 = m2 / totalMass;
      const w2 = m1 / totalMass;

      v1.x -= colNormalX * maxOverlap * w1;
      v1.z -= colNormalZ * maxOverlap * w1;
      v2.x += colNormalX * maxOverlap * w2;
      v2.z += colNormalZ * maxOverlap * w2;

      const vx1 = v1.velX || (Math.sin(v1.yaw) * v1.speed);
      const vz1 = v1.velZ || (Math.cos(v1.yaw) * v1.speed);
      const vx2 = v2.velX || (Math.sin(v2.yaw) * v2.speed);
      const vz2 = v2.velZ || (Math.cos(v2.yaw) * v2.speed);
      const rvx = vx1 - vx2;
      const rvz = vz1 - vz2;
      const velAlongNormal = rvx * colNormalX + rvz * colNormalZ;

      if (velAlongNormal > 0) {
        const restitution = 0.35;
        const impulseMag = ((1 + restitution) * velAlongNormal) / (1 / m1 + 1 / m2);
        const impulseX = impulseMag * colNormalX;
        const impulseZ = impulseMag * colNormalZ;

        v1.velX = vx1 - impulseX / m1;
        v1.velZ = vz1 - impulseZ / m1;
        v2.velX = vx2 + impulseX / m2;
        v2.velZ = vz2 + impulseZ / m2;

        const f1x = Math.sin(v1.yaw), f1z = Math.cos(v1.yaw);
        const f2x = Math.sin(v2.yaw), f2z = Math.cos(v2.yaw);
        v1.speed = v1.velX * f1x + v1.velZ * f1z;
        v2.speed = v2.velX * f2x + v2.velZ * f2z;

        const rx1 = contactX - v1.x;
        const rz1 = contactZ - v1.z;
        const rx2 = contactX - v2.x;
        const rz2 = contactZ - v2.z;
        const torque1 = rx1 * (-impulseZ) - rz1 * (-impulseX);
        const torque2 = rx2 * impulseZ - rz2 * impulseX;
        const inertia1 = m1 * (v1.isBus ? 4.2 : 1.8);
        const inertia2 = m2 * (v2.isBus ? 4.2 : 1.8);
        const yawImpulse1 = torque1 / inertia1;
        const yawImpulse2 = torque2 / inertia2;
        v1.yaw += yawImpulse1 * 0.45;
        v2.yaw += yawImpulse2 * 0.45;

        const pairKey = `${v1.uid}_${v2.uid}`;
        const lastHit = carCollisionCooldowns.get(pairKey) || 0;
        const impactSpeed = Math.abs(velAlongNormal);
        if (now - lastHit > 250 && impactSpeed > 1.8) {
          carCollisionCooldowns.set(pairKey, now);
          sfx.hit();
          const pCount = Math.min(14, Math.max(4, Math.floor(impactSpeed * 1.5)));
          spawnParticles(contactX, (v1.y + v2.y) * 0.5 + 0.4, contactZ, 0xfbbf24, pCount, 4.5);
          if ((isDriven1 || isDriven2) && impactSpeed > 7.0 && hooks.applyPlayerDamage) {
            hooks.applyPlayerDamage(Math.min(30, (impactSpeed - 7.0) * 1.6), 'VEHICLE COLLISION');
          }
        }

        if (hooks.mpActive && hooks.mpActive()) {
          if (isDriven1 && owner2 && owner2 !== hooks.mpLocalId()) {
            if (hooks.mpVehicleImpact) hooks.mpVehicleImpact(j, impulseX, impulseZ, yawImpulse2);
          } else if (isDriven2 && owner1 && owner1 !== hooks.mpLocalId()) {
            if (hooks.mpVehicleImpact) hooks.mpVehicleImpact(i, -impulseX, -impulseZ, yawImpulse1);
          }
        }
      }
    }
  }
}

function resolveWorldStrikes(v, fromX, fromZ, speedMag) {
  const now = performance.now();

  for (const lp of lampPosts) {
    if (lp.state !== 'standing') continue;
    const lpY = lp.pivot ? lp.pivot.position.y : 0.18;
    if (Math.abs(v.y - lpY) > 2.6 + (v.isBus ? 1.2 : 0)) continue;
    if (sweptFootprintHit(v, fromX, fromZ, v.x, v.z, lp.x, lp.z, 0.2)) {
      if (hooks.knockOverLamppost) hooks.knockOverLamppost(lp, v.yaw, Math.abs(v.speed));
      v.speed *= v.isBus ? 0.97 : 0.88;
    }
  }

  if (speedMag < NPC_MIN_SPEED) return;

  for (const npc of npcs) {
    if (!npc.spawned) continue;
    if (npc._carHitT && now - npc._carHitT < NPC_HIT_COOLDOWN) continue;
    const npcY = Number.isFinite(npc.y) ? npc.y : (npc.mesh ? npc.mesh.position.y : 0.18);
    if (Math.abs(v.y - npcY) > 3.0) continue;
    if (!sweptFootprintHit(v, fromX, fromZ, v.x, v.z, npc.x, npc.z, NPC_HIT_RADIUS)) continue;
    npc._carHitT = now;
    if (npc.asleep) npc.asleep = false;
    if (hooks.damageNpc) hooks.damageNpc(npc, Math.max(18, speedMag * 4.5), v.yaw);
    sfx.hit();
    spawnParticles(npc.x, npcY + 1.0, npc.z, 0xfacc15, 7, 5.0);
    v.speed *= v.isBus ? 0.96 : 0.85;
  }

  if (hooks.mpActive && hooks.mpActive() && speedMag > 3 && hooks.mpTargets) {
    for (const tp of hooks.mpTargets()) {
      if (tp.inCar) continue;
      if (!sweptFootprintHit(v, fromX, fromZ, v.x, v.z, tp.x, tp.z, 0.45)) continue;
      if (Math.abs(v.y - tp.y) > 2.6) continue;
      if (hooks.mpHitPlayer) hooks.mpHitPlayer(tp.id, speedMag * 3.5, 'VEHICLE IMPACT');
      spawnParticles(tp.x, tp.y + 1, tp.z, 0xfacc15, 7, 5.0);
      v.speed *= 0.8;
    }
  }
}

function stepPassengerRiding(v, dt, elapsed) {
  const mine = localOccupant(v);
  const seat = mine ? mine.seat : 1;
  v.localSeat = seat;
  gameState.isPassenger = true;

  player.x = v.x;
  player.y = v.y + 0.06;
  player.z = v.z;
  player.grounded = true;
  player.vy = 0;

  if (v.entryAnim && stepVehicleEntryExitAnim(v, dt)) return;

  const w = v.water;
  if (w && w.deep && hooks.applyPlayerDamage) {
    hooks.applyPlayerDamage(WATER_DPS * dt, 'DROWNING');
  }

  const dead = Boolean(w && w.floodLatch);
  sfx.updateEngine(!dead, dead ? 0 : (v.rpm || 900), false, false);

  if (!gameState.thirdPerson) {
    let yawStep = v.yaw - (v.lastCameraYaw === undefined ? v.yaw : v.lastCameraYaw);
    while (yawStep > Math.PI) yawStep -= Math.PI * 2;
    while (yawStep < -Math.PI) yawStep += Math.PI * 2;
    player.yaw += yawStep;
    v.lastCameraYaw = v.yaw;
    camera.position.copy(v.root.localToWorld(seatLocalPos(v, seat)));
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
  } else {
    v.cameraLookIdle = (v.cameraLookIdle || 0) + dt;
    if (v.cameraLookIdle > 2) {
      const followYaw = v.yaw + Math.PI;
      const yawDelta = Math.atan2(Math.sin(followYaw - v.cameraYaw), Math.cos(followYaw - v.cameraYaw));
      const followBlend = 1 - Math.exp(-dt * 1.8);
      v.cameraYaw += yawDelta * followBlend;
      v.cameraPitch += (0.25 - v.cameraPitch) * followBlend;
    }
    const aerialDist = chaseDistance(v) + Math.min(5.0, Math.abs(v.speed) * 0.085);
    const horizontalDist = aerialDist * Math.cos(v.cameraPitch);
    const camX = v.x + Math.sin(v.cameraYaw) * horizontalDist;
    const camZ = v.z + Math.cos(v.cameraYaw) * horizontalDist;
    const camY = Math.max(v.y + 1.15 + Math.sin(v.cameraPitch) * aerialDist, terrainH(camX, camZ) + 3.0, 2.4);
    camera.position.set(camX, camY, camZ);
    camera.lookAt(v.x, v.y + chaseLookHeight(v), v.z);
  }
}

export function stepVehicleDriving(dt, elapsed) {
  resolveVehicleCollisions(dt);
  if (!gameState.inCar) return;
  const v = vehicles[gameState.activeCarIndex];
  if (!v) return;

  if (gameState.isPassenger || v.localSeat > 0) {
    stepPassengerRiding(v, dt, elapsed);
    return;
  }

  const water = updateVehicleWater(v, dt);
  const engineDead = water.floodLatch;
  const roofDown = roofDownFactor(v) > 0.35;
  const driveEnabled = (!water.active || water.awash) && !roofDown;

  const animLock = Boolean(v.entryAnim);
  const throttleInput = (animLock || engineDead) ? 0 : (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0);
  const brakeInput = animLock ? 1 : (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0);
  const steerInput = animLock ? 0 : ((keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0) - (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0));
  const handbrake = animLock ? 0 : (keys['Space'] ? 1 : 0);

  const accelMul = tune('accelMultiplier') * (v.isBus ? 0.55 : 1);
  const brakeMul = tune('brakeMultiplier') * (v.isBus ? 0.74 : 1);
  const steerMul = tune('steerMultiplier') * (v.isBus ? 0.66 : 1);
  const gripMulData = tune('gripMultiplier');

  const gIdx = v.gearIndex;
  const gearCapMps = getGearCaps(v)[gIdx] / 2.237 * (v.isTank ? 0.48 : 1);
  const gearRatio = GEAR_RATIO_MULT[gIdx];
  const prevSpeed = v.speed;

  if (v.flameTimer > 0 && !water.active) {
    v.flameTimer -= dt;
    const flOn = v.flameTimer > 0 && Math.sin(elapsed * 65) > -0.35;
    v.flameL.visible = flOn;
    v.flameR.visible = flOn;
    if (flOn) {
      const s = 0.8 + Math.random() * 0.65;
      v.flameL.scale.set(1, 1, s);
      v.flameR.scale.set(1, 1, s);
    }
  } else {
    v.flameTimer = water.active ? 0 : v.flameTimer;
    v.flameL.visible = false;
    v.flameR.visible = false;
  }

  let onLimiter = false;
  if (gIdx === 1) {  
    if (throttleInput) v.rpm = Math.min(7900, v.rpm + 6400 * dt);
    else v.rpm = Math.max(880, v.rpm - 4400 * dt);
    v.speed *= Math.max(0, 1 - 0.45 * dt);
  } else if (gIdx === 0) {  
    const targetRpm = 900 + (Math.abs(v.speed) / Math.max(1, gearCapMps)) * 6600;
    v.rpm += (targetRpm - v.rpm) * Math.min(1, dt * 10);
    if (throttleInput && driveEnabled) {
      v.speed = Math.max(-gearCapMps, v.speed - 14.5 * (v.isBus ? 0.55 : 1) * dt);
    } else {
      v.speed *= Math.max(0, 1 - 1.5 * dt);
    }
  } else {    
    const speedRatio = Math.max(0, v.speed / Math.max(1, gearCapMps));
    const rawRpm = 900 + speedRatio * 6950;
    v.rpm += (Math.min(8000, rawRpm) - v.rpm) * Math.min(1, dt * 11);
    const normRpm = v.rpm / 8000;
    const torqueCurve = Math.max(0.32, 1 - Math.pow((normRpm - 0.62) / 0.65, 2));
    const superMult = v.isTank ? 0.62 : v.isBus ? 0.70 : v.isSupercar ? 1.32 : 1.0;
    const driveAccel = 23.0 * superMult * gearRatio * torqueCurve * accelMul;
    if (throttleInput && driveEnabled) {
      if (v.speed < gearCapMps) {
        v.speed = Math.min(gearCapMps, v.speed + driveAccel * dt);
      } else {
        onLimiter = true;
        v.rpm = 7750 + Math.sin(elapsed * 55) * 240;
        v.speed -= 4.0 * dt;
      }
    } else if (engineDead) {
      v.rpm = Math.max(0, v.rpm - 5200 * dt);
    } else {
      const engineBrake = (2.4 + (1.45 / Math.max(0.2, gearRatio)) * 0.55) * (v.isBus ? 1.25 : 1);
      v.speed = Math.max(0, v.speed - engineBrake * dt);
    }
  }

  if (brakeInput) {
    const brakeForce = 36.0 * brakeMul;
    if (v.speed > 0.2) v.speed = Math.max(0, v.speed - brakeForce * dt);
    else if (v.speed < -0.2) v.speed = Math.min(0, v.speed + brakeForce * dt);
    else v.speed = 0;
  }
  if (handbrake) {
    v.speed *= Math.max(0, 1 - (v.isBus ? 1.6 : v.isSupercar ? 2.1 : 3.2) * dt);
  }

  const targetSteer = steerInput * (v.isBus ? 0.40 : v.isSupercar ? 0.54 : 0.46) * steerMul;
  v.steerAngle += (targetSteer - v.steerAngle) * Math.min(1, dt * (v.isBus ? 7.5 : 11));
  const speedFactor = Math.min(1, Math.abs(v.speed) / (v.isBus ? 6.0 : 4.2));
  const dirSign = v.speed >= 0 ? 1 : -1;
  const driftYawMult = handbrake ? (v.isSupercar ? 1.55 : 1.32) : 1.0;
  const yawRate = v.isBus ? 1.55 : 2.45;
  v.yaw += v.steerAngle * yawRate * speedFactor * dirSign * driftYawMult * dt;

  const headX = Math.sin(v.yaw);
  const headZ = Math.cos(v.yaw);
  const sideX = Math.cos(v.yaw);
  const sideZ = -Math.sin(v.yaw);
  const targetVx = headX * v.speed;
  const targetVz = headZ * v.speed;

  const isTipping = Math.abs(wrapPi(v.roll || 0)) > ROLL_TIP_START;
  const lateralGrip = water.active ? 0.45
    : isTipping ? 0.8
    : (handbrake ? (v.isSupercar ? 1.35 : 1.8) : (v.isBus ? 5.4 : v.isSupercar ? 8.2 : 6.8));

  const rawGrip = water.active ? 3 : surfaceGrip(v.x, v.z, v.y);
  const gripMul = Math.min(1, rawGrip / 14 + 0.12) * gripMulData;

  if (water.active) {
    const drag = WATER_DRAG * (water.awash ? 0.55 : 1);
    const k = Math.max(0, 1 - drag * dt);
    v.speed *= k;
    v.velX *= k;
    v.velZ *= k;
    if (engineDead) v.rpm = Math.max(0, v.rpm - 5200 * dt);
  }

  v.velX += (targetVx - v.velX) * Math.min(1, lateralGrip * gripMul * dt);
  v.velZ += (targetVz - v.velZ) * Math.min(1, lateralGrip * gripMul * dt);

  const slipSpeed = Math.hypot(v.velX - targetVx, v.velZ - targetVz);
  const isSkidding = !water.active && !roofDown && (
    (handbrake && Math.abs(v.speed) > 4.5)
    || (slipSpeed > 3.6 && Math.abs(v.speed) > 6.5)
    || (brakeInput && Math.abs(v.speed) > 12)
  );
  if (isSkidding) {
    sfx.skid(dt);
    const rWheelX = v.x - headX * wheelHalfZ(v) * 0.75;
    const rWheelZ = v.z - headZ * wheelHalfZ(v) * 0.75;
    spawnParticles(rWheelX, v.y + 0.14, rWheelZ, handbrake && v.isSupercar ? 0xf8fafc : 0xcbd5e1, 1, 1.8);
  }

  const nextX = v.x + v.velX * dt;
  const nextZ = v.z + v.velZ * dt;
  const cfx = headX, cfz = headZ;
  const crx = sideX, crz = sideZ;
  const wheelZ = wheelHalfZ(v);
  const wheelX = wheelHalfX(v);

  const probeReachY = v.y + STEP_HEIGHT + 0.35;
  const getWheelY = (forwardSign, sideSign) => computeSupportFloor(
    nextX + cfx * (forwardSign * wheelZ) + crx * (sideSign * wheelX),
    nextZ + cfz * (forwardSign * wheelZ) + crz * (sideSign * wheelX),
    probeReachY,
    0.42
  );

  v.vy = v.vy || 0;
  v.pitch = v.pitch || 0;
  v.roll = v.roll || 0;

  let groundY = v.y;
  let roofContact = false;

  if (water.active) {
    stepVehicleSinking(v, dt, water);
    v.pitchSway = (v.pitchSway || 0) * Math.max(0, 1 - dt * 4);
    v.rollSway = (v.rollSway || 0) * Math.max(0, 1 - dt * 4);
    groundY = v.y;
    if (water.deep && hooks.applyPlayerDamage) {
      hooks.applyPlayerDamage(WATER_DPS * dt, 'DROWNING');
    }
  } else {
    const frontLeftY = getWheelY(1, -1);
    const frontRightY = getWheelY(1, 1);
    const rearLeftY = getWheelY(-1, -1);
    const rearRightY = getWheelY(-1, 1);
    const centerY = computeSupportFloor(nextX, nextZ, probeReachY, v.isBus ? 1.2 : 0.8);
    const wheelAvgY = (frontLeftY + frontRightY + rearLeftY + rearRightY) * 0.25;
    const groundSupportY = Math.max(centerY, Math.min(wheelAvgY, centerY + 1.25));

    const bodyOffset = bodySupportOffset(v);
    groundY = groundSupportY + 0.02 + bodyOffset;

    if (groundY > v.y + 0.02) {
      v.vy = Math.max(0, v.vy);
      v.y = groundY;
    } else if (groundY < v.y) {
      v.vy -= 19.5 * dt;
      v.y += v.vy * dt;
      if (v.y <= groundY) {
        v.y = groundY;
        v.vy = 0;
      }
    } else {
      v.vy = 0;
      v.y = groundY;
    }

    const frontAvgY = (frontLeftY + frontRightY) * 0.5;
    const rearAvgY = (rearLeftY + rearRightY) * 0.5;
    const leftAvgY = (frontLeftY + rearLeftY) * 0.5;
    const rightAvgY = (frontRightY + rearRightY) * 0.5;
    const slopeForward = (frontAvgY - rearAvgY) / (wheelZ * 2);
    const slopeSide = (rightAvgY - leftAvgY) / (wheelX * 2);

    v.speed += -19.5 * slopeForward * dt;
    const lateralGravityMag = -19.5 * slopeSide * dt;
    v.velX += sideX * lateralGravityMag;
    v.velZ += sideZ * lateralGravityMag;

    if (throttleInput > 0 && driveEnabled && slopeForward > 0.05 && !isTipping) {
      const climbAssist = 19.5 * Math.min(slopeForward, 0.85) * (v.isSupercar ? 1.0 : 0.85);
      v.speed += climbAssist * dt;
    }

    const rawPitch = -Math.atan(slopeForward);
    const rawRoll = Math.atan(slopeSide);
    const accelDelta = (v.speed - prevSpeed) / Math.max(0.008, dt);
    const targetPitchSway = Math.max(-0.06, Math.min(0.06, -accelDelta * 0.0022));
    const targetRollSway = Math.max(-0.08, Math.min(0.08, v.steerAngle * (v.speed / 28) * 0.14));
    v.pitchSway = (v.pitchSway || 0) + (targetPitchSway - (v.pitchSway || 0)) * Math.min(1, dt * 5.5);
    v.rollSway = (v.rollSway || 0) + (targetRollSway - (v.rollSway || 0)) * Math.min(1, dt * 5.5);

    const grounded = v.y <= groundY + 0.10;
    roofContact = roofDownFactor(v) > ROOF_DOWN_FACTOR && grounded;

    if (v.vy > 0.2 || roofDownFactor(v) > 0.2) {
      const topY = v.y + bodyTopOffset(v);
      if (collidesHorizontally(v.x, v.z, topY - 0.25, 0.35, 0.45)) {
        v.vy = Math.min(v.vy, 0);
        v.y -= 0.04;
      }
    }

    if (roofContact) {
      const wrapped = wrapPi(v.roll);
      const restRoll = wrapped >= 0 ? Math.PI : -Math.PI;
      v.roll += wrapPi(restRoll - v.roll) * Math.min(1, dt * 3.0);
      v.pitch += (0 - v.pitch) * Math.min(1, dt * 2.0);

      if (handbrake && throttleInput && Math.abs(v.speed) < ROOF_RIGHT_SPEED) {
        v._rightTimer = (v._rightTimer || 0) + dt;
        if (v._rightTimer > 0.35) {
          v.roll += wrapPi(0 - v.roll) * Math.min(1, dt * 1.9);
          if (Math.abs(wrapPi(v.roll)) < 0.30) {
            v.roll = 0;
            v.pitch = 0;
            v._rightTimer = 0;
            v.speed = 0;
            v.velX = 0;
            v.velZ = 0;
            pushFeed('VEHICLE RIGHTED', 'border-l-emerald-400');
            sfx.shift();
          }
        }
      } else {
        v._rightTimer = 0;
      }
    } else {
      v._rightTimer = 0;
      v.pitch += (rawPitch - v.pitch) * Math.min(1, dt * 10);
      const wrapped = wrapPi(v.roll);
      if (Math.abs(wrapped) > ROLL_TIP_START || Math.abs(rawRoll) > ROLL_TIP_START) {
        const rollDir = Math.sign(wrapped || rawRoll || 1);
        v.roll += rollDir * 4.5 * dt;
        if (v.roll > Math.PI * 2) v.roll -= Math.PI * 2;
        if (v.roll < -Math.PI * 2) v.roll += Math.PI * 2;
      } else {
        v.roll += (rawRoll - v.roll) * Math.min(1, dt * 10);
      }
    }

    if (roofContact) {
      const scrapeSpeed = Math.hypot(v.velX, v.velZ);
      if (!v._roofWasDown) {
        v._roofWasDown = true;
        if (scrapeSpeed > 6) {
          sfx.hit();
          spawnParticles(v.x, v.y - bodySupportOffset(v) + 0.15, v.z, 0xfbbf24, 10, 5.0);
          if (hooks.applyPlayerDamage) {
            hooks.applyPlayerDamage(Math.min(28, (scrapeSpeed - 6) * 1.8), 'ROLLOVER');
          }
        }
        pushFeed('VEHICLE ROLLED — HOLD [SPACE] + [W] TO RIGHT IT', 'border-l-rose-500');
      }
      const k = Math.max(0, 1 - ROOF_SCRAPE_DRAG * dt);
      v.speed *= k;
      v.velX *= k;
      v.velZ *= k;
      if (scrapeSpeed > 2.5) {
        v._roofScrapeT = (v._roofScrapeT || 0) + dt;
        sfx.skid(dt);
        if (v._roofScrapeT > 0.06) {
          v._roofScrapeT = 0;
          spawnParticles(
            v.x + (Math.random() - 0.5) * 1.4,
            v.y - bodySupportOffset(v) + 0.08,
            v.z + (Math.random() - 0.5) * 1.4,
            0xfbbf24, 2, 3.2
          );
        }
        if (scrapeSpeed > 9 && hooks.applyPlayerDamage) {
          hooks.applyPlayerDamage(Math.min(12, (scrapeSpeed - 9) * 0.9) * dt * 4, 'ROOF SCRAPE');
        }
      }
    } else {
      v._roofWasDown = false;
    }
  }

  const isTraversableSlope = (px, pz) => {
    const dzX = (terrainH(px + 0.4, pz) - terrainH(px - 0.4, pz)) / 0.8;
    const dzZ = (terrainH(px, pz + 0.4) - terrainH(px, pz - 0.4)) / 0.8;
    return Math.hypot(dzX, dzZ) < 2.2;
  };
  const ptScale = ((v.carScale || DEFAULT_SCALE) / DEFAULT_SCALE)
    * (v.isTank ? 1.3 : 1)
    * (v.isBus ? 2.1 : 1);

  const rolledBody = roofDownFactor(v) > 0.2 || Math.abs(Math.sin(wrapPi(v.roll || 0))) > 0.5;
  const bodyOffsetNow = bodySupportOffset(v);

  const carHit = (px, pz) => {
    const probeBottom = rolledBody
      ? v.y - bodyOffsetNow + 0.12
      : v.y + STEP_HEIGHT;
    const probeHeight = rolledBody ? Math.max(1.0, bodyOffsetNow + 0.9) : 1.2;

    for (let q = 0; q < CAR_PTS.length; q++) {
      const ptX = px + (cfx * CAR_PTS[q][0] + crx * CAR_PTS[q][1]) * ptScale;
      const ptZ = pz + (cfz * CAR_PTS[q][0] + crz * CAR_PTS[q][1]) * ptScale;
      if (collidesHorizontally(ptX, ptZ, probeBottom, probeHeight, 0.28)) {
        const isStructure = collidesHorizontally(ptX, ptZ, terrainH(ptX, ptZ) + 4.0, 1.3, 0.28);
        if (isStructure || !isTraversableSlope(ptX, ptZ)) {
          return true;
        }
      }
    }
    return false;
  };

  const fromX = v.x, fromZ = v.z;
  let okX = true, okZ = true;
  const nSub = Math.max(1, Math.ceil(Math.hypot(nextX - v.x, nextZ - v.z) / 0.45));
  const stX = (nextX - v.x) / nSub, stZ = (nextZ - v.z) / nSub;
  for (let si = 0; si < nSub && (okX || okZ); si++) {
    if (okX) { if (carHit(v.x + stX, v.z)) okX = false; else v.x += stX; }
    if (okZ) { if (carHit(v.x, v.z + stZ)) okZ = false; else v.z += stZ; }
  }
  if (!okX) v.velX *= -0.28;
  if (!okZ) v.velZ *= -0.28;
  if (!okX || !okZ) {
    const impact = Math.abs(v.speed);
    v.speed *= (okX || okZ) ? 0.82 : -0.3;
    if (impact > 5) {
      sfx.hit();
      spawnParticles(v.x, v.y + 0.7, v.z, 0xfbbf24, 6, 4);
      if (impact > 14 && hooks.applyPlayerDamage) {
        hooks.applyPlayerDamage(Math.min(30, (impact - 14) * 1.6), 'CRASH IMPACT');
      }
    }
  }

  resolveWorldStrikes(v, fromX, fromZ, Math.abs(prevSpeed));

  v.root.position.set(v.x, v.y, v.z);
  v.root.rotation.order = 'YXZ';
  v.root.rotation.y = v.yaw;
  v.root.rotation.x = v.pitch;
  v.root.rotation.z = v.roll;
  v.chassis.rotation.x = v.pitchSway;
  v.chassis.rotation.z = v.rollSway;
  v.wheelPivots[0].rotation.y = v.steerAngle;
  v.wheelPivots[1].rotation.y = v.steerAngle;
  const wheelRot = (v.speed * dt) / wheelRadius(v);
  v.wheelSpinners.forEach((ws) => { ws.rotation.x += wheelRot; });

  sfx.updateEngine(!engineDead, engineDead ? 0 : v.rpm, Boolean(throttleInput) && driveEnabled, onLimiter);

  player.x = v.x;
  player.y = v.y + 0.06;
  player.z = v.z;

  if (v.entryAnim && stepVehicleEntryExitAnim(v, dt)) {
    return;
  }

  if (!gameState.thirdPerson) {
    let yawStep = v.yaw - (v.lastCameraYaw === undefined ? v.yaw : v.lastCameraYaw);
    while (yawStep > Math.PI) yawStep -= Math.PI * 2;
    while (yawStep < -Math.PI) yawStep += Math.PI * 2;
    player.yaw += yawStep;
    v.lastCameraYaw = v.yaw;
    camera.position.copy(v.root.localToWorld(seatLocalPos(v, 0)));
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
    v.steeringPivot.rotation.z = -v.steerAngle * 1.7;
  } else {
    v.cameraLookIdle = (v.cameraLookIdle || 0) + dt;
    if (v.cameraLookIdle > 2) {
      const followYaw = v.yaw + Math.PI;
      const yawDelta = Math.atan2(Math.sin(followYaw - v.cameraYaw), Math.cos(followYaw - v.cameraYaw));
      const followBlend = 1 - Math.exp(-dt * 1.8);
      v.cameraYaw += yawDelta * followBlend;
      v.cameraPitch += (0.25 - v.cameraPitch) * followBlend;
    }
    const aerialDist = chaseDistance(v) + Math.min(5.0, Math.abs(v.speed) * 0.085);
    const horizontalDist = aerialDist * Math.cos(v.cameraPitch);
    const camX = v.x + Math.sin(v.cameraYaw) * horizontalDist;
    const camZ = v.z + Math.cos(v.cameraYaw) * horizontalDist;
    const camY = Math.max(
      v.y + 1.15 + Math.sin(v.cameraPitch) * aerialDist,
      terrainH(camX, camZ) + 3.0,
      2.4
    );
    camera.position.set(camX, camY, camZ);
    camera.lookAt(v.x, v.y + chaseLookHeight(v), v.z);
  }
}

function settleParkedCar(v, dt) {
  const rest = computeSupportFloor(v.x, v.z, v.y + 0.65, v.isBus ? 1.3 : 0.85) + 0.02 + bodySupportOffset(v);
  v.vy = v.vy || 0;
  if (rest > v.y + 0.08) {
    v.y = rest;
    v.vy = 0;
  } else if (v.y - rest > 0.35) {
    v.vy -= 19.5 * dt;
    v.y += v.vy * dt;
    if (v.y <= rest) {
      v.y = rest;
      v.vy = 0;
    }
  } else {
    v.vy = 0;
  }
}

export function suspFrame(dt, t) {
  if (!gameState.inCar) {
    resolveVehicleCollisions(dt);
  }

  for (let vi = 0; vi < vehicles.length; vi++) {
    const v = vehicles[vi];
    const ch = v.chassis;
    if (!ch) continue;

    const S = v.sus || (v.sus = { hy: 0, hv: 0, p: 0, pv: 0, r: 0, rv: 0, pa: 0, ps: v.speed || 0, lat: 0 });
    const driven = gameState.inCar && gameState.activeCarIndex === vi && !gameState.isPassenger;
    const owner = hooks.mpCarOwner ? hooks.mpCarOwner(vi) : null;
    const remoteDriven = !!owner && owner !== (hooks.mpLocalId ? hooks.mpLocalId() : 'local');

    if (v.doorLeftPivot && v.doorRightPivot) {
      if (v.doorAutoCloseTimer > 0) {
        v.doorAutoCloseTimer -= dt;
        if (v.doorAutoCloseTimer <= 0) {
          v.doorTargetL = 0;
          v.doorTargetR = 0;
        }
      }
      if (!v.entryAnim && Math.abs(v.speed || 0) > 2.5) {
        v.doorTargetL = 0;
        v.doorTargetR = 0;
      }
      const doorLerp = Math.min(1, dt * 11.5);
      v.doorOpenL += ((v.doorTargetL || 0) - v.doorOpenL) * doorLerp;
      v.doorOpenR += ((v.doorTargetR || 0) - v.doorOpenR) * doorLerp;
      v.doorLeftPivot.rotation.y = v.doorOpenL * 1.08;
      v.doorRightPivot.rotation.y = -v.doorOpenR * 1.08;
    }

    const acc = (v.speed - S.ps) / Math.max(dt, 0.001);
    S.ps = v.speed;
    const lat = -(v.steerAngle || 0) * v.speed * Math.abs(v.speed) * 0.03;
    const bump = (Math.sin(v.x * 1.7 + v.z * 1.3) * 0.5 + Math.sin(v.x * 0.37) * 0.5)
      * Math.min(1, Math.abs(v.speed) / 12) * 0.35;
    const k = 70, c = 9;
    S.hv += (-k * S.hy - c * S.hv + bump * 30) * dt;
    S.hy += S.hv * dt;
    S.pv += (-k * 0.9 * S.p - c * 0.8 * S.pv - Math.max(-14, Math.min(14, acc)) * 0.07 * k * 0.25) * dt;
    S.p += S.pv * dt;
    S.rv += (-k * 0.9 * S.r - c * 0.8 * S.rv + Math.max(-14, Math.min(14, lat)) * 0.02 * k) * dt;
    S.r += S.rv * dt;
    ch.position.y = S.hy * 0.35;

    if (!driven && !remoteDriven) {
      const water = updateVehicleWater(v, dt);
      if (water.active) {
        stepVehicleSinking(v, dt, water);
        v.root.position.set(v.x, v.y, v.z);
        v.root.rotation.order = 'YXZ';
        v.root.rotation.y = v.yaw;
        v.root.rotation.x = v.pitch;
        v.root.rotation.z = v.roll;
        continue;
      }

      settleParkedCar(v, dt);
      v.pitch = v.pitch || 0;
      v.roll = v.roll || 0;

      const cfx = Math.sin(v.yaw), cfz = Math.cos(v.yaw);
      const crx = Math.cos(v.yaw), crz = -Math.sin(v.yaw);
      const wheelZ = wheelHalfZ(v);
      const wheelX = wheelHalfX(v);
      const getWheelY = (f, s) => computeSupportFloor(
        v.x + cfx * (f * wheelZ) + crx * (s * wheelX),
        v.z + cfz * (f * wheelZ) + crz * (s * wheelX),
        v.y + STEP_HEIGHT + 0.35,
        0.42
      );
      const fLY = getWheelY(1, -1), fRY = getWheelY(1, 1), rLY = getWheelY(-1, -1), rRY = getWheelY(-1, 1);
      const fAvg = (fLY + fRY) * 0.5, rAvg = (rLY + rRY) * 0.5;
      const lAvg = (fLY + rLY) * 0.5, riAvg = (fRY + rRY) * 0.5;
      const sFwd = (fAvg - rAvg) / (wheelZ * 2);
      const sSd = (riAvg - lAvg) / (wheelX * 2);

      if (roofDownFactor(v) > ROOF_DOWN_FACTOR) {
        const wrapped = wrapPi(v.roll);
        const restRoll = wrapped >= 0 ? Math.PI : -Math.PI;
        v.roll += wrapPi(restRoll - v.roll) * Math.min(1, dt * 2.5);
        v.pitch += (0 - v.pitch) * Math.min(1, dt * 2.5);
      } else {
        v.pitch += (-Math.atan(sFwd) - v.pitch) * Math.min(1, dt * 8);
        v.roll += (Math.atan(sSd) - v.roll) * Math.min(1, dt * 8);
      }

      v.root.position.set(v.x, v.y, v.z);
      v.root.rotation.order = 'YXZ';
      v.root.rotation.y = v.yaw;
      v.root.rotation.x = v.pitch + S.p * 0.2;
      v.root.rotation.z = v.roll + S.r * 0.2;
    }
  }
}