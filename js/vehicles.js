// =============================================================================
// vehicles.js — Vehicle mesh builders, 6-speed manual gearbox, driving physics, suspension and exhaust flame effects.
// =============================================================================
import * as THREE from 'three';
import { levelData } from './levelData.js';
import { CAR_PTS, collidesHorizontally, computeSupportFloor, gameState, hooks, inputState, isInWater, keys, lampPosts, npcs, player, pushFeed, surfaceGrip, terrainH } from './state.js';
import { camera, makeMat, worldRoot } from './engine.js';
import { sfx } from './audio.js';
import { spawnParticles } from './items.js';

export const vehicles = [];

export const GEAR_LABELS = ['R', 'N', '1', '2', '3', '4', '5', '6'];

export const GEAR_CAPS_MPH = [36, 0, 39, 66, 95, 125, 154, 180];

export const GEAR_RATIO_MULT = [-0.55, 0, 1.0, 0.66, 0.46, 0.34, 0.26, 0.21];

export function buildSportsCarMesh({ name = 'SPORTS CAR', bodyHex = 0xdc2626, accentHex = 0xf8fafc, x = 0, z = 0, yaw = 0, isCoupe = true, isSupercar = false } = {}) {
  const root = new THREE.Group();
  root.userData.studioName = name;
  const carScale = 1.35;
  root.scale.setScalar(carScale);
  root.position.set(x, 0.12, z);
  root.rotation.y = yaw;

  const chassis = new THREE.Group();
  chassis.userData.studioName = 'Chassis';
  root.add(chassis);

  const bodyMat = makeMat(bodyHex, {
    isCarMetal: true,
    texType: 'metallicflake',
    repeatX: 6,
    repeatY: 6,
    metalness: isSupercar ? 0.90 : 0.86,
    roughness: isSupercar ? 0.12 : 0.16,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    envMapIntensity: 2.2,
    flatShading: false
  });
  const accentMat = makeMat(accentHex, {
    isCarMetal: true,
    metalness: 0.88,
    roughness: 0.18,
    clearcoat: 0.95,
    clearcoatRoughness: 0.06,
    flatShading: false
  });
  const chromeMat = makeMat(0xf8fafc, {
    texType: 'brushedsteel',
    metalness: 0.96,
    roughness: 0.10,
    envMapIntensity: 2.4,
    flatShading: false
  });
  const carbonMat = makeMat(0x0f172a, { roughness: 0.32, metalness: 0.55, clearcoat: 0.7, flatShading: false });
  const glassMat = makeMat(0x38bdf8, {
    metalness: 0.35,
    roughness: 0.12,
    clearcoat: 0.8,
    envMapIntensity: 1.2,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
    flatShading: false
  });

  const lowerH = isSupercar ? 0.42 : 0.54;
  const lower = new THREE.Mesh(new THREE.BoxGeometry(2.04, lowerH, 4.46), bodyMat);
  lower.userData.studioName = 'Body';
  lower.position.y = isSupercar ? 0.54 : 0.62;
  lower.castShadow = true;
  lower.receiveShadow = true;

  const sideSkirtL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 2.7), carbonMat);
  sideSkirtL.position.set(-1.04, 0.34, 0);
  const sideSkirtR = sideSkirtL.clone();
  sideSkirtR.position.x = 1.04;

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.02, 4.42), accentMat);
  stripe.position.y = lower.position.y + lowerH / 2 + 0.01;

  const cabinLen = isSupercar ? 1.85 : (isCoupe ? 2.0 : 2.65);
  const cabinH = isSupercar ? 0.56 : 0.78;
  const cabinZ = isSupercar ? -0.10 : (isCoupe ? -0.22 : -0.05);
  const cabin = new THREE.Group();
  cabin.userData.studioName = 'Cabin';
  cabin.position.set(0, lower.position.y + lowerH / 2 + cabinH / 2 - 0.02, cabinZ);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.09, cabinLen), bodyMat);
  roof.userData.studioName = 'Cabin roof';
  roof.position.y = cabinH / 2 - 0.045;
  roof.castShadow = true;
  cabin.add(roof);

  const pillarGeo = new THREE.BoxGeometry(0.11, cabinH - 0.08, 0.11);
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      const pillar = new THREE.Mesh(pillarGeo, bodyMat);
      pillar.position.set(side * 0.82, -0.02, end * (cabinLen / 2 - 0.06));
      pillar.castShadow = true;
      cabin.add(pillar);
    }
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, cabinLen - 0.12), bodyMat);
    sill.position.set(side * 0.82, -cabinH / 2 + 0.05, 0);
    cabin.add(sill);
  }

  const glassFront = new THREE.Mesh(new THREE.PlaneGeometry(1.48, cabinH * 0.74), glassMat);
  glassFront.position.set(0, -0.015, cabinLen / 2 - 0.035);
  glassFront.rotation.x = -0.16;
  const glassRear = new THREE.Mesh(new THREE.PlaneGeometry(1.48, cabinH * 0.68), glassMat);
  glassRear.position.set(0, -0.015, -cabinLen / 2 + 0.035);
  glassRear.rotation.y = Math.PI;
  const glassLeft = new THREE.Mesh(new THREE.PlaneGeometry(cabinLen * 0.76, cabinH * 0.64), glassMat);
  glassLeft.position.set(-0.79, -0.015, 0);
  glassLeft.rotation.y = -Math.PI / 2;
  const glassRight = glassLeft.clone();
  glassRight.position.x = 0.79;
  glassRight.rotation.y = Math.PI / 2;
  cabin.add(glassFront, glassRear, glassLeft, glassRight);

  const dashboard = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.15, 0.42), carbonMat);
  dashboard.userData.studioName = 'Dashboard';
  dashboard.position.set(0, lower.position.y + lowerH / 2 + 0.08, 0.76);
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

  // Twin Exhaust Flame Cones for Downshift Backfires
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

  chassis.add(lower, sideSkirtL, sideSkirtR, stripe, cabin, dashboard, steeringPivot, ...seats, grille, splitter, hlL, hlR, tlL, tlR, diffuser, pipeL, pipeR, flameL, flameR);

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
  const brakeCaliperMat = makeMat(isSupercar ? 0xef4444 : accentHex, { metalness: 0.7, roughness: 0.25 });
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
    root, chassis, wheelPivots, wheelSpinners, flameL, flameR, windowMaterial: glassMat,
    steeringPivot, name, isSupercar, carScale,
    cameraSeat: new THREE.Vector3(-0.38, isSupercar ? 1.02 : 1.30, 0.12),
    cameraYaw: yaw + Math.PI, cameraPitch: 0.25, cameraLookIdle: 2, lastCameraYaw: yaw
  };
}

export function buildSportsCar(cfg) {
  const { name, x, z, yaw, isSupercar = false } = cfg;
  const {
    root, chassis, wheelPivots, wheelSpinners, flameL, flameR, windowMaterial,
    steeringPivot, carScale, cameraSeat, cameraYaw, cameraPitch, cameraLookIdle, lastCameraYaw
  } = buildSportsCarMesh(cfg);
  worldRoot.add(root);

  const carObj = {
    name,
    isSupercar,
    x,
    y: 0.12,
    z,
    yaw,
    speed: 0,
    velX: 0,
    velZ: 0,
    gearIndex: 2, // 0='R', 1='N', 2='1', ..., 7='6'
    rpm: 900,
    steerAngle: 0,
    pitchAngle: 0,
    rollAngle: 0,
    flameTimer: 0,
    flameL,
    flameR,
    windowMaterial,
    root,
    chassis,
    carScale,
    cameraSeat,
    cameraYaw,
    cameraPitch,
    cameraLookIdle,
    lastCameraYaw,
    steeringPivot,
    wheelPivots,
    wheelSpinners
  };
  vehicles.push(carObj);
  return carObj;
}

export function getNearestVehicle(maxDist = 5.2) {
  let best = null;
  let bestDist = maxDist;
  vehicles.forEach((v, idx) => {
    const d = Math.hypot(player.x - v.x, player.z - v.z);
    if (d < bestDist && Math.abs(player.y - v.y) < 2.2) {
      bestDist = d;
      best = { v, idx };
    }
  });
  return best;
}

export function enterVehicle(idx) {
  const v = vehicles[idx];
  if (!v) return;
  hooks.onVehicleEnter(v);
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
  v.gearIndex = 2; // Start in 1st Gear
  v.rpm = 1100;
  sfx.shift();
  pushFeed(`ENTERED ${v.name} — [I] UPSHIFT • [K] DOWNSHIFT`, 'border-l-amber-400');
  hooks.syncMobileControls(true);
  hooks.updateHUD();
}

export function exitCurrentCar(silent = false) {
  if (!gameState.inCar) return;
  const v = vehicles[gameState.activeCarIndex];
  gameState.inCar = false;
  gameState.activeCarIndex = -1;
  if (v) {
    v.flameL.visible = false;
    v.flameR.visible = false;
    const exitDistance = 2.1 * (v.carScale || 1.35);
    const forwardX = Math.sin(v.yaw);
    const forwardZ = Math.cos(v.yaw);
    const candidates = [
      { x: v.x - Math.cos(v.yaw) * exitDistance, z: v.z + Math.sin(v.yaw) * exitDistance },
      { x: v.x + Math.cos(v.yaw) * exitDistance, z: v.z - Math.sin(v.yaw) * exitDistance },
      { x: v.x - forwardX * exitDistance, z: v.z - forwardZ * exitDistance },
      { x: v.x, y: v.y + 3, z: v.z }
    ];
    let exitSpot = null;
    for (const candidate of candidates) {
      const candidateY = candidate.y ?? Math.max(0.18, v.y + 0.06);
      const floorY = computeSupportFloor(candidate.x, candidate.z, candidateY + 0.4, player.radius);
      if (!collidesHorizontally(candidate.x, candidate.z, floorY, player.height, player.radius)) {
        exitSpot = { x: candidate.x, y: candidate.y ?? Math.max(floorY, v.y + 0.06), z: candidate.z };
        break;
      }
    }
    exitSpot ||= { x: v.x, y: Math.max(0.18, v.y + 0.06), z: v.z };
    player.x = exitSpot.x;
    player.y = exitSpot.y;
    player.z = exitSpot.z;
    player.vy = 0;
    player.grounded = true;
    player.peakAirY = player.y;
    player.yaw = v.yaw + Math.PI;
    player.pitch = 0;
  }
  sfx.updateEngine(false, 0, false);
  if (!silent) pushFeed('EXITED VEHICLE', 'border-l-slate-400');
  hooks.syncMobileControls(true);
  hooks.updateHUD();
}

export function shiftVehicleGear(delta) {
  if (!gameState.inCar) return;
  const v = vehicles[gameState.activeCarIndex];
  if (!v) return;
  const next = Math.max(0, Math.min(GEAR_LABELS.length - 1, v.gearIndex + delta));
  if (next !== v.gearIndex) {
    const prevGear = v.gearIndex;
    v.gearIndex = next;
    sfx.shift();
    if (delta > 0 && next >= 2) {
      v.rpm = Math.max(1400, v.rpm * 0.68);
    } else if (delta < 0 && next >= 2) {
      v.rpm = Math.min(7950, v.rpm * 1.38 + 900);
      // Supercar & high-RPM downshift exhaust backfire flames!
      if (v.isSupercar || prevGear >= 4) {
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

// Per-frame driving model (6-speed gearbox, grip, collisions, camera). Extracted from the original stepSimulation().
export function stepVehicleDriving(dt, elapsed) {
    const v = vehicles[gameState.activeCarIndex];
    const throttleInput = keys['KeyW'] || keys['ArrowUp'] ? 1 : 0;
    const brakeInput = keys['KeyS'] || keys['ArrowDown'] ? 1 : 0;
    const steerInput = (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0) - (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0);
    const handbrake = keys['Space'] ? 1 : 0;

    const gIdx = v.gearIndex;
    const gearCapMps = GEAR_CAPS_MPH[gIdx] / 2.237 * (v.isTank ? 0.48 : 1);
    const gearRatio = GEAR_RATIO_MULT[gIdx];
    const prevSpeed = v.speed;

    // Update Supercar / Backfire Exhaust Flame Effect
    if (v.flameTimer > 0) {
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
      if (throttleInput) {
        v.speed = Math.max(-gearCapMps, v.speed - 14.5 * dt);
      } else {
        v.speed *= Math.max(0, 1 - 1.5 * dt);
      }
    } else {
      const speedRatio = Math.max(0, v.speed / Math.max(1, gearCapMps));
      const rawRpm = 900 + speedRatio * 6950;
      v.rpm += (Math.min(8000, rawRpm) - v.rpm) * Math.min(1, dt * 11);

      const normRpm = v.rpm / 8000;
      const torqueCurve = Math.max(0.32, 1 - Math.pow((normRpm - 0.62) / 0.65, 2));
      const superMult = v.isTank ? 0.62 : v.isSupercar ? 1.32 : 1.0;
      const driveAccel = 23.0 * superMult * gearRatio * torqueCurve * levelData.params.vehicles.accelMultiplier;

      if (throttleInput) {
        if (v.speed < gearCapMps) {
          v.speed = Math.min(gearCapMps, v.speed + driveAccel * dt);
        } else {
          onLimiter = true;
          v.rpm = 7750 + Math.sin(elapsed * 55) * 240;
          v.speed -= 4.0 * dt;
        }
      } else {
        const engineBrake = 2.4 + (1.45 / Math.max(0.2, gearRatio)) * 0.55;
        v.speed = Math.max(0, v.speed - engineBrake * dt);
      }
    }

    if (brakeInput) {
      if (v.speed > 0.2) v.speed = Math.max(0, v.speed - 36.0 * levelData.params.vehicles.brakeMultiplier * dt);
      else if (v.speed < -0.2) v.speed = Math.min(0, v.speed + 36.0 * levelData.params.vehicles.brakeMultiplier * dt);
      else v.speed = 0;
    }
    if (handbrake) {
      v.speed *= Math.max(0, 1 - (v.isSupercar ? 2.1 : 3.2) * dt);
    }

    const targetSteer = steerInput * (v.isSupercar ? 0.54 : 0.46) * levelData.params.vehicles.steerMultiplier;
    v.steerAngle += (targetSteer - v.steerAngle) * Math.min(1, dt * 11);

    const speedFactor = Math.min(1, Math.abs(v.speed) / 4.2);
    const dirSign = v.speed >= 0 ? 1 : -1;
    const driftYawMult = handbrake ? (v.isSupercar ? 1.55 : 1.32) : 1.0;
    v.yaw += v.steerAngle * 2.45 * speedFactor * dirSign * driftYawMult * dt;

    const headX = Math.sin(v.yaw);
    const headZ = Math.cos(v.yaw);
    const targetVx = headX * v.speed;
    const targetVz = headZ * v.speed;
    const lateralGrip = handbrake ? (v.isSupercar ? 1.35 : 1.8) : (v.isSupercar ? 8.2 : 6.8);
    const gripMul = Math.min(1, surfaceGrip(v.x, v.z) / 14 + 0.12) * levelData.params.vehicles.gripMultiplier;
    if (isInWater(v.x, v.z)) v.speed *= Math.max(0, 1 - 1.4 * dt);
    v.velX += (targetVx - v.velX) * Math.min(1, lateralGrip * gripMul * dt);
    v.velZ += (targetVz - v.velZ) * Math.min(1, lateralGrip * gripMul * dt);

    const slipSpeed = Math.hypot(v.velX - targetVx, v.velZ - targetVz);
    const isSkidding = (handbrake && Math.abs(v.speed) > 4.5) || (slipSpeed > 3.6 && Math.abs(v.speed) > 6.5) || (brakeInput && Math.abs(v.speed) > 12);
    if (isSkidding) {
      sfx.skid(dt);
      const rWheelX = v.x - headX * 1.4;
      const rWheelZ = v.z - headZ * 1.4;
      spawnParticles(rWheelX, v.y + 0.14, rWheelZ, handbrake && v.isSupercar ? 0xf8fafc : 0xcbd5e1, 1, 1.8);
    }

    const nextX = v.x + v.velX * dt;
    const nextZ = v.z + v.velZ * dt;

    const cfx = Math.sin(v.yaw), cfz = Math.cos(v.yaw);
    const crx = Math.cos(v.yaw), crz = -Math.sin(v.yaw);
    const carFloor = computeSupportFloor(nextX, nextZ, v.y + 0.65, 0.8);
    const wheelSupport = (forward, side) => computeSupportFloor(
      nextX + cfx * forward * v.carScale + crx * side * v.carScale,
      nextZ + cfz * forward * v.carScale + crz * side * v.carScale,
      v.y + 0.65,
      0.42
    );
    const frontFloor = (wheelSupport(1.38, -0.98) + wheelSupport(1.38, 0.98)) * 0.5;
    const rearFloor = (wheelSupport(-1.38, -0.98) + wheelSupport(-1.38, 0.98)) * 0.5;
    const gy = Math.max(carFloor, frontFloor, rearFloor);
    const groundY = gy + 0.02;
    v.vy = v.vy || 0;
    if (groundY > v.y + 0.08) {
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
    const tpT = Math.max(-0.5, Math.min(0.5, Math.atan2(frontFloor - rearFloor, 3.72 * v.carScale)));
    v.terrPitch = (v.terrPitch || 0) + (tpT - (v.terrPitch || 0)) * Math.min(1, dt * 10);

    for (const lp of lampPosts) {
      if (lp.state === 'standing' && Math.hypot(nextX - lp.x, nextZ - lp.z) < 1.85 && Math.abs(v.y - 0.18) < 2.0) {
        hooks.knockOverLamppost(lp, v.yaw, Math.abs(v.speed));
        v.speed *= 0.88;
      }
    }

    for (const npc of npcs) {
if (npc.spawned && !npc.asleep && Math.hypot(nextX - npc.x, nextZ - npc.z) < 1.85 && Math.abs(v.speed) > 2.2 && Math.abs(v.y - 0.18) < 2.0) {
        hooks.damageNpc(npc, Math.abs(v.speed) * 4.5, v.yaw);
        sfx.hit();
        spawnParticles(npc.x, 1.1, npc.z, 0xfacc15, 7, 5.0);
        v.speed *= 0.85;
      }
    }

    const carHit = (px, pz) => {
      for (let q = 0; q < CAR_PTS.length; q++) {
        if (collidesHorizontally(px + cfx * CAR_PTS[q][0] + crx * CAR_PTS[q][1], pz + cfz * CAR_PTS[q][0] + crz * CAR_PTS[q][1], v.y + 0.25, 1.3, 0.28)) return true;
      }
      return false;
    };
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
        if (impact > 14) hooks.applyPlayerDamage(Math.min(30, (impact - 14) * 1.6), 'CRASH IMPACT');
      }
    }

    const accelDelta = (v.speed - prevSpeed) / Math.max(0.008, dt);
    const targetPitch = Math.max(-0.06, Math.min(0.06, -accelDelta * 0.0022));
    const targetRoll = Math.max(-0.08, Math.min(0.08, v.steerAngle * (v.speed / 28) * 0.14));
    v.pitchAngle += (targetPitch - v.pitchAngle) * Math.min(1, dt * 10);
    v.rollAngle += (targetRoll - v.rollAngle) * Math.min(1, dt * 10);

    v.root.position.set(v.x, v.y, v.z);
    v.root.rotation.y = v.yaw;
    v.chassis.rotation.x = v.pitchAngle - (v.terrPitch || 0);
    v.chassis.rotation.z = v.rollAngle;

    v.wheelPivots[0].rotation.y = v.steerAngle;
    v.wheelPivots[1].rotation.y = v.steerAngle;
    const wheelRot = (v.speed * dt) / 0.38;
    v.wheelSpinners.forEach((ws) => { ws.rotation.x += wheelRot; });

    sfx.updateEngine(true, v.rpm, Boolean(throttleInput), onLimiter);

    player.x = v.x;
    player.y = v.y + 0.06;
    player.z = v.z;

    if (!gameState.thirdPerson) {
      let yawStep = v.yaw - (v.lastCameraYaw === undefined ? v.yaw : v.lastCameraYaw);
      while (yawStep > Math.PI) yawStep -= Math.PI * 2;
      while (yawStep < -Math.PI) yawStep += Math.PI * 2;
      player.yaw += yawStep;
      v.lastCameraYaw = v.yaw;
      camera.position.copy(v.root.localToWorld(v.cameraSeat.clone()));
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
      const aerialDist = (11.4 * (v.carScale || 1.35)) + Math.min(5.0, Math.abs(v.speed) * 0.085);
      const horizontalDist = aerialDist * Math.cos(v.cameraPitch);
      const camX = v.x + Math.sin(v.cameraYaw) * horizontalDist;
      const camZ = v.z + Math.cos(v.cameraYaw) * horizontalDist;
      const camY = Math.max(
        v.y + 1.15 + Math.sin(v.cameraPitch) * aerialDist,
        terrainH(camX, camZ) + 3.0,
        2.4
      );
      camera.position.set(camX, camY, camZ);
      camera.lookAt(v.x, v.y + 0.95, v.z);
    }
}

// ---- Car suspension & terrain physics ----
export function suspFrame(dt, t) {
for (const v of vehicles) {
const ch = v.chassis; if (!ch) continue;
const S = v.sus || (v.sus = { hy: 0, hv: 0, p: 0, pv: 0, r: 0, rv: 0, pa: 0, ps: v.speed || 0, lat: 0 });
const driven = gameState.inCar && vehicles[gameState.activeCarIndex] === v;
const acc = (v.speed - S.ps) / Math.max(dt, .001); S.ps = v.speed;
const lat = -(v.steerAngle || 0) * v.speed * Math.abs(v.speed) * .03;
const bump = (Math.sin(v.x * 1.7 + v.z * 1.3) * .5 + Math.sin(v.x * .37) * .5) * Math.min(1, Math.abs(v.speed) / 12) * (v.z < -170 ? .9 : .35);
const k = 70, c = 9;
S.hv += (-k * S.hy - c * S.hv + bump * 30) * dt; S.hy += S.hv * dt;
S.pv += (-k * .9 * S.p - c * .8 * S.pv - Math.max(-14, Math.min(14, acc)) * .07 * k * .25) * dt; S.p += S.pv * dt;
S.rv += (-k * .9 * S.r - c * .8 * S.rv + Math.max(-14, Math.min(14, lat)) * .02 * k) * dt; S.r += S.rv * dt;
const sx = Math.sin(v.yaw), cz = Math.cos(v.yaw);
const slope = Math.atan2(terrainH(v.x + sx * 2, v.z + cz * 2) - terrainH(v.x - sx * 2, v.z - cz * 2), 4);
S.pa += ((v.z < -170 ? slope : 0) - S.pa) * Math.min(1, dt * 8);
ch.position.y = S.hy * .35;
if (driven) {
ch.rotation.x = (v.pitchAngle || 0) - (v.terrPitch || 0) + S.p * .5 - S.pa;
ch.rotation.z = (v.rollAngle || 0) + S.r * .5;
} else {
ch.rotation.x = S.p * .5 - S.pa;
ch.rotation.z = S.r * .5;
}
v.root.rotation.order = 'YXZ';
v.root.rotation.x = -S.pa;
if (v.z < -170 && v.speed > 0) v.speed = Math.max(0, v.speed - 9.8 * Math.sin(Math.max(0, S.pa)) * dt * .9);
}
}