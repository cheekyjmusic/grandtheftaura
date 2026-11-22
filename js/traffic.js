import * as THREE from 'three';
import { computeSupportFloor, gameState, hooks, player, pushFeed } from './state.js';
import { scene } from './engine.js';
import { freeGeo } from './items.js';
import { buildNpcMeshRaw } from './npcs.js';
import { buildSportsCar, vehicles } from './vehicles.js';

const trafficCars = [];
const ejectedDrivers = [];
const trafficRoute = [[-120, -168], [120, -168], [120, 72], [-120, 72]];
const trafficRouteLengths = trafficRoute.map((point, index) => {
  const next = trafficRoute[(index + 1) % trafficRoute.length];
  return Math.hypot(next[0] - point[0], next[1] - point[1]);
});
const trafficRouteLength = trafficRouteLengths.reduce((sum, length) => sum + length, 0);
let initialized = false;

function trafficRoutePoint(distance) {
  let remaining = ((distance % trafficRouteLength) + trafficRouteLength) % trafficRouteLength;
  for (let index = 0; index < trafficRoute.length; index++) {
	const start = trafficRoute[index], end = trafficRoute[(index + 1) % trafficRoute.length];
	const length = trafficRouteLengths[index];
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
  return { x: trafficRoute[0][0], z: trafficRoute[0][1], yaw: Math.PI / 2 };
}

export function buildCityTraffic() {
  if (initialized) return trafficCars;
  initialized = true;
  const paint = [[0x2563eb, 0xe2e8f0], [0x16a34a, 0xf8fafc], [0x7c3aed, 0xfacc15], [0x334155, 0x38bdf8]];
  [32, 272, 512, 752].forEach((progress, index) => {
	const point = trafficRoutePoint(progress);
	const vehicle = buildSportsCar({
	  name: `SUNNYVALE TRAFFIC ${index + 1}`,
	  bodyHex: paint[index][0], accentHex: paint[index][1],
	  x: point.x, z: point.z, yaw: point.yaw, isCoupe: index % 2 === 0
	});
	vehicle.isTraffic = true;
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
	if (vehicle.windowMaterial) vehicle.windowMaterial.opacity = 0.07;
	vehicle.driver = { name: `DRIVER ${index + 1}`, mesh: driverMesh, ejected: false };
	trafficCars.push(vehicle);
  });
  return trafficCars;
}

function ejectTrafficDriver(vehicle) {
  const driver = vehicle.driver;
  if (!driver || !vehicle.isTraffic) return;

  vehicle.root.updateMatrixWorld(true);
  const exitPosition = vehicle.root.localToWorld(new THREE.Vector3(-1.45, 0.16, 0));
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
  pushFeed('YOU PULLED THE DRIVER OUT — TAKE THE CAR!', 'border-l-rose-400');
}

hooks.onVehicleEnter = ejectTrafficDriver;

export function updateCityTraffic(dt) {
  const guest = hooks.mpIsGuest();
  for (const vehicle of trafficCars) {
    if (guest) {
      // Positions come from the host car stream; just spin the wheels.
      vehicle.wheelSpinners.forEach((wheel) => { wheel.rotation.x += ((vehicle.speed || 0) * dt) / 0.38; });
      continue;
    }
    if (!vehicle.isTraffic || (gameState.inCar && vehicles[gameState.activeCarIndex] === vehicle)) continue;
    const idx = vehicles.indexOf(vehicle);
    const owner = hooks.mpCarOwner(idx);
    if (owner && owner !== hooks.mpLocalId()) continue; // a guest is driving it
    vehicle.trafficProgress = (vehicle.trafficProgress + vehicle.trafficSpeed * dt) % trafficRouteLength;
    const point = trafficRoutePoint(vehicle.trafficProgress);
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
// Host migration: rebuild route progress from the synced positions so traffic
// continues from where the old host left it (no teleporting cars).
export function adoptTrafficProgress() {
  for (const vehicle of trafficCars) {
    if (!vehicle.isTraffic) continue;
    let best = vehicle.trafficProgress || 0, bd = Infinity;
    for (let d = 0; d < trafficRouteLength; d += 2) {
      const p = trafficRoutePoint(d);
      const dist = Math.hypot(p.x - vehicle.x, p.z - vehicle.z);
      if (dist < bd) { bd = dist; best = d; }
    }
    vehicle.trafficProgress = best;
  }
}
Object.assign(hooks, { mpAdoptTraffic: adoptTrafficProgress });