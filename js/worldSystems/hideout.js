// =============================================================================
// worldSystems/hideout.js — SCORPION TANK HULL
//
// The vehicle adapter only sets isTank; the original built the armour hull in
// world.js. This ports it: hide chassis + wheels, attach tracks/turret/barrel.
// =============================================================================
import * as THREE from 'three';
import { makeMat } from '../engine.js';
import { getPlacement, makeBox } from '../worldKit.js';
import { vehicles } from '../vehicles.js';

export function install({ spec = {} } = {}) {
  if (spec.tankHull === false) return;
  const rec = getPlacement('rr/tank');
  if (!rec?.object) return;
  const tank = vehicles.find((v) => v.root === rec.object);
  if (!tank || tank.tankModel) return;

  tank.isTank = true;
  if (tank.chassis) tank.chassis.visible = false;
  if (tank.wheelPivots) tank.wheelPivots.forEach((w) => { w.visible = false; });

  const hull = new THREE.Group();
  hull.userData.studioName = 'Scorpion hull';
  const armor = makeMat(0x59664c, { roughness: 0.78, metalness: 0.2 });
  const dark = makeMat(0x30372e, { roughness: 0.9 });
  makeBox(hull, 2.8, 1.1, 4.7, 0, 0.95, 0, armor, { cast: true });
  for (const side of [-1, 1]) {
    makeBox(hull, 0.55, 0.95, 4.9, side * 1.55, 0.39, 0, dark, { cast: true });
    for (let i = 0; i < 10; i++) {
      makeBox(hull, 0.58, 0.07, 0.28, side * 1.56, 0.39, -2.05 + i * 0.45, armor);
    }
  }
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 1.08, 0.62, 10), armor);
  turret.position.set(0, 1.75, -0.15);
  turret.castShadow = true;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.19, 2.8, 10), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 1.78, 1.55);
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.13, 8), dark);
  hatch.position.set(0, 2.12, -0.18);
  hull.add(turret, barrel, hatch);
  tank.root.add(hull);
  tank.tankModel = hull;
}

export function reset() { /* hull dies with the vehicle on rebuild */ }
export default { install, reset };