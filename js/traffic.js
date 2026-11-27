import * as THREE from 'three';
import { computeSupportFloor, gameState, hooks, player, pushFeed } from './state.js';
import { scene } from './engine.js';
import { freeGeo } from './items.js';
import { getPlacement } from './worldKit.js';
import { buildNpcMeshRaw } from './npcs.js';
import { buildSportsCar, vehicles } from './vehicles.js';

const trafficCars = [];
const ejectedDrivers = [];

function createRoute(points) {
  const lengths = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return Math.hypot(next[0] - point[0], next[1] - point[1]);
  });
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  return { points, lengths, totalLength };
}

const cityRoute = createRoute([[-120, -168], [120, -168], [120, 72], [-120, 72]]);

function routePoint(route, distance) {
  const { points, lengths, totalLength } = route;
  let remaining = ((distance % totalLength) + totalLength) % totalLength;
  for (let index = 0; index < points.length; index++) {
    const start = points[index], end = points[(index + 1) % points.length];
    const length = lengths[index];
    if (remaining <= length) {
      const t = remaining / length;
      return {
        x: start[0] + (end[0] - start[0]) * t,
        z: start[1] + (end[1] - start[1]) * t,
        yaw: Math.atan2(end[0] - start[0], end[1] - start[1])
      };
    }
    remaining -= length;
  }
  return { x: points[0][0], z: points[0][1], yaw: Math.PI / 2 };
}

function makeAutoGlassMaterial() {
  const glass = new THREE.MeshStandardMaterial({
    color: 0xa5d8ff,
    emissive: 0x0ea5e9,
    emissiveIntensity: 0.12,
    metalness: 0.85,
    roughness: 0.08,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  return glass;
}

function applyRealVehicleGlass(vehicle) {
  if (vehicle.windowMaterial) {
    vehicle.windowMaterial.color.setHex(0xa5d8ff);
    vehicle.windowMaterial.metalness = 0.85;
    vehicle.windowMaterial.roughness = 0.08;
    vehicle.windowMaterial.transparent = true;
    vehicle.windowMaterial.opacity = 0.26;
    vehicle.windowMaterial.depthWrite = false;
    vehicle.windowMaterial.side = THREE.DoubleSide;
    vehicle.windowMaterial.needsUpdate = true;
  }
}

function decorateTaxi(vehicle) {
  applyRealVehicleGlass(vehicle);

  const trimMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.35 });
  const mirrorGlass = new THREE.MeshStandardMaterial({ color: 0xbae6fd, metalness: 0.95, roughness: 0.05 });

  // Illuminated TAXI roof sign
  const signBase = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.22, 0.32), trimMat);
  signBase.position.set(0, 1.46, -0.05);
  const signGlow = new THREE.Mesh(
    new THREE.BoxGeometry(0.68, 0.15, 0.34),
    new THREE.MeshBasicMaterial({ color: 0xfef08a })
  );
  signBase.add(signGlow);
  vehicle.root.add(signBase);

  // Side-view mirrors framing the front door windows
  for (const sx of [-1, 1]) {
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.16), trimMat);
    housing.position.set(sx * 1.04, 0.96, 0.56);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.10, 0.02), mirrorGlass);
    lens.position.set(0, 0, -0.08);
    housing.add(lens);
    vehicle.root.add(housing);
  }
}

function decorateShuttleBus(vehicle) {
  applyRealVehicleGlass(vehicle);

  const shellMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.32, metalness: 0.2 });
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.5 });
  const stripeMat = new THREE.MeshStandardMaterial({
    color: 0x0284c7,
    emissive: 0x0369a1,
    emissiveIntensity: 0.35,
    roughness: 0.35
  });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.85 });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.9, roughness: 0.2 });
  const ceilingGlowMat = new THREE.MeshBasicMaterial({ color: 0xfff7d6 });
  const glassMat = makeAutoGlassMaterial();

  const busGroup = new THREE.Group();
  busGroup.name = 'lax_shuttle_coach';
  vehicle.root.add(busGroup);

  const addPart = (w, h, d, x, y, z, mat, opts = {}) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    if (opts.rx) mesh.rotation.x = opts.rx;
    if (opts.cast) mesh.castShadow = true;
    if (opts.order) mesh.renderOrder = opts.order;
    busGroup.add(mesh);
    return mesh;
  };

  // Coach bounds: width 2.24m (x = -1.12..+1.12), length 5.30m (z = -2.90..+2.40)
  // Window beltline at y = 1.36, roof header at y = 2.18 (open hollow interior between!)
  const W = 2.24;
  const Z_FRONT = 2.40;
  const Z_REAR = -2.90;
  const L = Z_FRONT - Z_REAR; // 5.30m
  const Z_MID = (Z_FRONT + Z_REAR) / 2; // -0.25m
  const SILL_Y = 1.36;
  const HEAD_Y = 2.18;
  const WIN_H = HEAD_Y - SILL_Y; // 0.82m tall windows
  const WIN_CY = (SILL_Y + HEAD_Y) / 2; // 1.77m

  // 1. Lower Coach Side & End Skirts (below window sill y = 1.36)
  for (const sx of [-1, 1]) {
    addPart(0.12, 0.48, L, sx * (W / 2 - 0.06), 1.12, Z_MID, shellMat, { cast: true });
    addPart(0.14, 0.20, L + 0.04, sx * (W / 2 - 0.05), 1.24, Z_MID, stripeMat);
  }
  addPart(W, 0.48, 0.14, 0, 1.12, Z_FRONT - 0.07, shellMat, { cast: true });
  addPart(W + 0.04, 0.20, 0.16, 0, 1.24, Z_FRONT - 0.06, stripeMat);
  addPart(W, 0.48, 0.14, 0, 1.12, Z_REAR + 0.07, shellMat, { cast: true });
  addPart(W + 0.04, 0.20, 0.16, 0, 1.24, Z_REAR + 0.06, stripeMat);

  // 2. Vertical Structural Window Pillars (framing real open glass bays)
  const pillarZs = [Z_FRONT - 0.07, 1.25, 0.15, -0.95, -2.05, Z_REAR + 0.07];
  for (const sx of [-1, 1]) {
    for (const pz of pillarZs) {
      addPart(0.11, WIN_H, 0.13, sx * (W / 2 - 0.06), WIN_CY, pz, pillarMat, { cast: true });
    }
  }
  // Center windshield mullion & rear window corner pillars
  addPart(0.08, WIN_H, 0.10, 0, WIN_CY, Z_FRONT - 0.06, pillarMat);

  // 3. Real Transparent Glass Windows (Front Windshield, Rear Window & Left/Right Side Bays)
  // Front panoramic windshield
  addPart(W - 0.22, WIN_H - 0.04, 0.04, 0, WIN_CY, Z_FRONT - 0.06, glassMat, { order: 3 });
  // Rear window
  addPart(W - 0.22, WIN_H - 0.04, 0.04, 0, WIN_CY, Z_REAR + 0.06, glassMat, { order: 3 });
  // Left & Right side window panes spanning between pillars
  for (const sx of [-1, 1]) {
    addPart(0.04, WIN_H - 0.04, L - 0.24, sx * (W / 2 - 0.06), WIN_CY, Z_MID, glassMat, { order: 3 });
  }

  // 4. Coach Roof Cap, Illuminated Destination Sign & Roof AC Units (y = 2.18..2.36)
  addPart(W + 0.06, 0.16, L + 0.08, 0, HEAD_Y + 0.08, Z_MID, shellMat, { cast: true });
  addPart(W + 0.10, 0.06, L + 0.12, 0, HEAD_Y + 0.03, Z_MID, stripeMat);
  // Front LED Destination Board ("LAX SHUTTLE")
  addPart(1.56, 0.22, 0.10, 0, HEAD_Y + 0.11, Z_FRONT + 0.02, pillarMat);
  addPart(1.44, 0.14, 0.12, 0, HEAD_Y + 0.11, Z_FRONT + 0.03, new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
  // Roof HVAC pods
  addPart(1.15, 0.14, 1.10, 0, HEAD_Y + 0.22, 0.45, shellMat, { cast: true });
  addPart(1.15, 0.14, 1.10, 0, HEAD_Y + 0.22, -1.35, shellMat, { cast: true });

  // 5. Bus Interior Details (clearly visible through the real glass windows)
  // Warm interior ceiling light strip
  addPart(0.32, 0.04, L - 0.6, 0, HEAD_Y - 0.02, Z_MID, ceilingGlowMat);
  // Passenger transit seats along left and right sides
  for (const sz of [0.55, -0.35, -1.25, -2.15]) {
    for (const sx of [-1, 1]) {
      addPart(0.56, 0.12, 0.46, sx * 0.68, 1.24, sz, seatMat);
      addPart(0.54, 0.48, 0.10, sx * 0.68, 1.48, sz - 0.20, seatMat);
    }
  }
  // Front passenger luggage rack & stainless grab poles
  addPart(0.62, 0.56, 0.72, 0.66, 1.38, 1.45, pillarMat);
  for (const gz of [0.95, -0.65, -2.15]) {
    addPart(0.05, 0.96, 0.05, -0.34, 1.70, gz, poleMat);
    addPart(0.05, 0.96, 0.05,  0.34, 1.70, gz, poleMat);
  }
}

let initialized = false;

export function buildCityTraffic() {
  if (initialized) return trafficCars;
  initialized = true;

  // 1. Sunnyvale City Loop Cars
  const paint = [[0x2563eb, 0xe2e8f0], [0x16a34a, 0xf8fafc], [0x7c3aed, 0xfacc15], [0x334155, 0x38bdf8]];
  [32, 272, 512, 752].forEach((progress, index) => {
    const point = routePoint(cityRoute, progress);
    const vehicle = buildSportsCar({
      name: `SUNNYVALE TRAFFIC ${index + 1}`,
      bodyHex: paint[index][0], accentHex: paint[index][1],
      x: point.x, z: point.z, yaw: point.yaw, isCoupe: index % 2 === 0
    });
    applyRealVehicleGlass(vehicle);
    vehicle.isTraffic = true;
    vehicle.trafficRoute = cityRoute;
    vehicle.trafficProgress = progress;
    vehicle.trafficSpeed = 6.4 + (index % 2) * 0.7;
    vehicle.speed = vehicle.trafficSpeed;
    const driverMesh = buildNpcMeshRaw(paint[index][0], 0x1e293b, null, {
      age: 'adult', id: 700 + index, skin: [0xd99b72, 0xb77955, 0xf1c27d, 0x8d5524][index]
    });
    driverMesh.scale.setScalar(0.52);
    driverMesh.position.set(-0.42, 0.08, 0.12);
    driverMesh.userData.armL.rotation.x = -0.95;
    driverMesh.userData.armR.rotation.x = -0.95;
    vehicle.root.add(driverMesh);
    vehicle.driver = { name: `DRIVER ${index + 1}`, mesh: driverMesh, ejected: false };
    trafficCars.push(vehicle);
  });

  // 2. LAX Airport Horseshoe Loop — Taxis & Shuttle Buses (all hijackable & drivable)
  const laxRec = getPlacement('lax/terminal');
  const tx = laxRec?.row?.at?.[0] ?? 248;
  const tz = laxRec?.row?.at?.[1] ?? 565;

  const laxDeparturesRoute = createRoute([
    [tx - 16, tz - 148],
    [tx - 16, tz + 148],
    [tx + 51, tz + 148],
    [tx + 51, tz - 148]
  ]);

  const laxArrivalsRoute = createRoute([
    [tx - 20, tz - 144],
    [tx - 20, tz + 144],
    [tx + 37, tz + 144],
    [tx + 37, tz - 144]
  ]);

  const airportFleet = [
    { type: 'bus',  name: 'LAX SHUTTLE BUS 1', route: laxDeparturesRoute, progress: 40,  speed: 6.2, driverId: 710 },
    { type: 'bus',  name: 'LAX SHUTTLE BUS 2', route: laxDeparturesRoute, progress: 410, speed: 6.0, driverId: 711 },
    { type: 'taxi', name: 'LAX CAB 101',       route: laxDeparturesRoute, progress: 220, speed: 7.4, driverId: 712 },
    { type: 'taxi', name: 'LAX CAB 204',       route: laxArrivalsRoute,   progress: 90,  speed: 7.2, driverId: 713 },
    { type: 'bus',  name: 'LAX TERMINAL LINK', route: laxArrivalsRoute,   progress: 390, speed: 5.9, driverId: 714 }
  ];

  airportFleet.forEach((spec, i) => {
    const isBus = spec.type === 'bus';
    const point = routePoint(spec.route, spec.progress);
    const vehicle = buildSportsCar({
      name: spec.name,
      bodyHex: isBus ? 0xf8fafc : 0xfacc15,
      accentHex: isBus ? 0x0284c7 : 0x111827,
      x: point.x,
      z: point.z,
      yaw: point.yaw,
      isCoupe: false
    });

    if (isBus) {
      decorateShuttleBus(vehicle);
    } else {
      decorateTaxi(vehicle);
    }

    vehicle.isTraffic = true;
    vehicle.trafficRoute = spec.route;
    vehicle.trafficProgress = spec.progress;
    vehicle.trafficSpeed = spec.speed;
    vehicle.speed = spec.speed;

    const driverMesh = buildNpcMeshRaw(isBus ? 0x0369a1 : 0x334155, 0x0f172a, null, {
      age: 'adult',
      id: spec.driverId,
      skin: [0xf1c27d, 0xb77955, 0xd99b72, 0x8d5524, 0xe0ac69][i % 5]
    });
    driverMesh.scale.setScalar(0.52);
    // Position bus driver right behind the panoramic front windshield & side cab window
    driverMesh.position.set(-0.48, isBus ? 0.42 : 0.08, isBus ? 1.55 : 0.12);
    driverMesh.userData.armL.rotation.x = -0.95;
    driverMesh.userData.armR.rotation.x = -0.95;
    vehicle.root.add(driverMesh);

    vehicle.driver = { name: `${spec.name} DRIVER`, mesh: driverMesh, ejected: false };
    trafficCars.push(vehicle);
  });

  return trafficCars;
}

function ejectTrafficDriver(vehicle) {
  const driver = vehicle.driver;
  if (!driver || !vehicle.isTraffic) return;

  vehicle.root.updateMatrixWorld(true);
  const exitPosition = vehicle.root.localToWorld(new THREE.Vector3(-1.55, 0.16, 0.4));
  scene.attach(driver.mesh);
  driver.mesh.scale.setScalar(1);
  driver.mesh.position.copy(exitPosition);
  driver.mesh.rotation.set(0, vehicle.yaw - Math.PI / 2, 0);
  driver.x = exitPosition.x;
  driver.y = exitPosition.y;
  driver.z = exitPosition.z;
  driver.yaw = vehicle.yaw - Math.PI / 2;
  driver.ejectTimer = 0.72;
  driver.vx = Math.sin(driver.yaw) * 4.2 + Math.sin(vehicle.yaw) * 1.5;
  driver.vy = 3.4;
  driver.vz = Math.cos(driver.yaw) * 4.2 + Math.cos(vehicle.yaw) * 1.5;
  driver.timer = 8;
  driver.ejected = true;
  ejectedDrivers.push(driver);
  vehicle.driver = null;
  vehicle.isTraffic = false;
  vehicle.speed = 0;
  vehicle.velX = 0;
  vehicle.velZ = 0;
  pushFeed('YOU PULLED THE DRIVER OUT — TAKE THE VEHICLE!', 'border-l-rose-400');
}

hooks.onVehicleEnter = ejectTrafficDriver;

export function updateCityTraffic(dt) {
  const guest = hooks.mpIsGuest();
  for (const vehicle of trafficCars) {
    if (guest) {
      vehicle.wheelSpinners.forEach((wheel) => { wheel.rotation.x += ((vehicle.speed || 0) * dt) / 0.38; });
      continue;
    }
    if (!vehicle.isTraffic || (gameState.inCar && vehicles[gameState.activeCarIndex] === vehicle)) continue;
    const idx = vehicles.indexOf(vehicle);
    const owner = hooks.mpCarOwner(idx);
    if (owner && owner !== hooks.mpLocalId()) continue;

    const route = vehicle.trafficRoute || cityRoute;
    vehicle.trafficProgress = (vehicle.trafficProgress + vehicle.trafficSpeed * dt) % route.totalLength;
    const point = routePoint(route, vehicle.trafficProgress);
    vehicle.x = point.x;
    vehicle.z = point.z;
    let yawDiff = point.yaw - vehicle.yaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    vehicle.yaw += yawDiff * Math.min(1, dt * 5);
    vehicle.root.position.set(vehicle.x, vehicle.y, vehicle.z);
    vehicle.root.rotation.y = vehicle.yaw;
    vehicle.wheelSpinners.forEach((wheel) => { wheel.rotation.x += (vehicle.trafficSpeed * dt) / 0.38; });
  }
  for (let index = ejectedDrivers.length - 1; index >= 0; index--) {
    const driver = ejectedDrivers[index];
    driver.timer -= dt;
    if (driver.timer <= 0) {
      scene.remove(driver.mesh);
      freeGeo(driver.mesh);
      ejectedDrivers.splice(index, 1);
      continue;
    }
    if (driver.ejectTimer > 0) {
      driver.ejectTimer = Math.max(0, driver.ejectTimer - dt);
      driver.vy -= 16 * dt;
      driver.x += driver.vx * dt;
      driver.y += driver.vy * dt;
      driver.z += driver.vz * dt;
      const progress = 1 - driver.ejectTimer / 0.72;
      driver.mesh.rotation.z = Math.sin(progress * Math.PI) * 0.85;
      driver.mesh.rotation.x = -0.25 - Math.sin(progress * Math.PI) * 0.45;
      driver.mesh.userData.armL.rotation.x = -1.8 + Math.sin(progress * 13) * 0.45;
      driver.mesh.userData.armR.rotation.x = -1.8 - Math.sin(progress * 13) * 0.45;
      driver.mesh.position.set(driver.x, driver.y, driver.z);
      if (driver.ejectTimer <= 0) {
        driver.y = computeSupportFloor(driver.x, driver.z, driver.y, player.radius) + 0.02;
        driver.vy = 0;
        driver.mesh.rotation.set(0, driver.yaw, 0);
        driver.mesh.userData.armL.rotation.set(0, 0, 0);
        driver.mesh.userData.armR.rotation.set(0, 0, 0);
      }
      continue;
    }
    driver.x += Math.sin(driver.yaw) * 2.2 * dt;
    driver.z += Math.cos(driver.yaw) * 2.2 * dt;
    driver.mesh.position.set(driver.x, driver.y, driver.z);
    const step = Math.sin((8 - driver.timer) * 9) * 0.45;
    driver.mesh.userData.legL.rotation.x = step;
    driver.mesh.userData.legR.rotation.x = -step;
  }
}

export function adoptTrafficProgress() {
  for (const vehicle of trafficCars) {
    if (!vehicle.isTraffic) continue;
    const route = vehicle.trafficRoute || cityRoute;
    let best = vehicle.trafficProgress || 0, bd = Infinity;
    for (let d = 0; d < route.totalLength; d += 2) {
      const p = routePoint(route, d);
      const dist = Math.hypot(p.x - vehicle.x, p.z - vehicle.z);
      if (dist < bd) { bd = dist; best = d; }
    }
    vehicle.trafficProgress = best;
  }
}

Object.assign(hooks, { mpAdoptTraffic: adoptTrafficProgress });