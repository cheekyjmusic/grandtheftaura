// =============================================================================
// worldObjects/buildings.js — 17 BUILDING PREFABS
//
// Signatures match what worldObjects/index.js adapters expect:
//   house_walkin / house_suburban  -> ({ x, z, w, d, h, wallColor, ... })
//   shop_hotdog / shop_bank / shop_dealer -> (x, z)
//   everything else                -> (row)   [passthrough adapter]
//
// REMOVED vs the original (now separate layout rows, would double-spawn):
//   • hideout's tank            -> rr/tank
//   • armory's dumpster/pallet/crate/walllamp -> la/armory_* rows
//   • armory's display cases + alarm + hooks  -> worldSystems/armory.js
// =============================================================================
import * as THREE from 'three';
import { aura, aviationBeacons, enterableZones, mapShapes, registerBuildingLod } from '../state.js';
import { makeMat, regHigh, worldRoot } from '../engine.js';
import {
  UNIT_BOX, addRamp, addSolidBox, flushInstances, makeBox, resolveMat, xform
} from '../worldKit.js';
import {
  flatRoof, foundY, gableRoof, hexStr, mapRect, neon, shell, wallMat, wallWithWindow, zone
} from './shell.js';

const M = (hex, opts) => makeMat(hex, opts);

// =============================================================================
// HOUSES
// =============================================================================
export function buildWalkInHouse(o) {
  const w = o.w ?? 9.8, d = o.d ?? 8.6, h = o.h ?? 4.0;
  const { x, z } = o;
  const y = foundY(o.baseY, x, z, w, d, 0.18);
  const wm = wallMat(o.wallColor ?? 0xe2e8f0);
  const rm = M(o.roofColor ?? 0xb91c1c, { texType: 'shingles', repeatX: 4, repeatY: 4, bumpScale: 0.02 });

  const S = shell({
    x, z, y, w, d, h, t: 0.36, doorW: 2.6, doorH: 2.85, wallMat: wm,
    name: o.label || 'Walk-in house',
    back: [2.2, 1.35, 2.0], side: [1.8, 1.35, 2.0], front: [1.45, 1.3, 2.0],
    floorMat: M(0xb45309, { texType: 'wood', repeatX: 4, repeatY: 4, roughness: 0.55 })
  });
  const { g, solid, minX, maxX, minZ, maxZ } = S;

  // Foundation plinth (Frostpine lodge sits on 2.4 m of rock).
  if (o.foundation) {
    const f = o.foundation, fw = f.w ?? w + 1.6, fd = f.d ?? d + 1.6, fh = f.h ?? 2.4;
    makeBox(worldRoot, fw, fh, fd, x, y - fh / 2, z,
      M(0x57534e, { texType: 'redrock', repeatX: 3, repeatY: 1 }),
      { cast: true, recv: true, name: `${o.label || 'House'} foundation` });
    solid(x - fw / 2, x + fw / 2, y - fh, y, z - fd / 2, z + fd / 2, 'lodge_foundation', true);
  }

  // Door trim.
  const trim = M(0x78350f, { texType: 'wood' });
  for (const s of [-1, 1]) makeBox(g, 0.14, 2.85, 0.44, s * 1.3, 1.425, d / 2 - 0.18, trim);

  // Furniture — every collider explicit, exactly as the original.
  const sofa = M(0x334155, { texType: 'fabric', repeatX: 2, repeatY: 4, roughness: 0.95 });
  makeBox(g, 1.1, 0.72, 2.5, -w / 2 + 1.0, 0.42, -0.2, sofa);
  solid(x - w / 2 + 0.45, x - w / 2 + 1.55, y, y + 0.72, z - 1.45, z + 1.05, 'sofa', true);
  makeBox(g, 1.1, 0.62, 1.6, -1.5, 0.38, -0.2, trim);
  solid(x - 2.05, x - 0.95, y, y + 0.62, z - 1.0, z + 0.6, 'table', true);

  makeBox(g, 2.8, 0.94, 1.1, w / 2 - 1.9, 0.54, -d / 2 + 1.0, M(0xe2e8f0, { texType: 'siding' }));
  makeBox(g, 2.9, 0.09, 1.18, w / 2 - 1.9, 1.05, -d / 2 + 1.0,
    M(0x334155, { texType: 'granite', repeatX: 3, repeatY: 1, roughness: 0.16, clearcoat: 0.9, flatShading: false }));
  solid(x + w / 2 - 3.3, x + w / 2 - 0.5, y, y + 1.02, z - d / 2 + 0.45, z - d / 2 + 1.55, 'counter', true);
  makeBox(g, 0.95, 2.05, 0.95, w / 2 - 0.9, 1.1, -d / 2 + 2.3,
    M(0xdbeafe, { texType: 'brushedsteel', repeatX: 1, repeatY: 2, metalness: 0.9, roughness: 0.22, flatShading: false }));
  solid(x + w / 2 - 1.4, x + w / 2 - 0.4, y, y + 2.07, z - d / 2 + 1.8, z - d / 2 + 2.8, 'fridge', true);

  makeBox(g, 2.0, 0.55, 1.4, -w / 2 + 1.45, 0.35, -d / 2 + 1.15, M(0x92400e, { texType: 'wood' }));
  makeBox(g, 1.88, 0.22, 1.28, -w / 2 + 1.45, 0.68, -d / 2 + 1.15,
    M(0xf8fafc, { texType: 'fabric', repeatX: 2, repeatY: 2, roughness: 0.95 }));
  solid(x - w / 2 + 0.45, x - w / 2 + 2.45, y, y + 0.77, z - d / 2 + 0.45, z - d / 2 + 1.85, 'bed', true);
  makeBox(g, 3.4, 0.03, 2.5, -1.5, 0.09, -0.2,
    M(0x0284c7, { texType: 'fabric', repeatX: 4, repeatY: 3, roughness: 0.96 }));

  gableRoof(g, w, d, h, 2.3, 0.55, rm);
  solid(minX, maxX, y + h - 0.2, y + h, minZ, maxZ, 'roof', true);

  // Distance-culled interior lamp.
  const lod = new THREE.Group();
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.14, 1.5, 8), M(0xfbbf24, { metalness: 0.85 }));
  stand.position.set(-w / 2 + 0.9, 0.85, d / 2 - 1.2);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.32, 10),
    M(0xfef08a, { emissive: 0xfacc15, emissiveIntensity: 0.6 }));
  shade.position.set(-w / 2 + 0.9, 1.65, d / 2 - 1.2);
  lod.add(stand, shade);
  g.add(lod);
  registerBuildingLod(x, z, lod);

  zone(o.label, minX + 0.3, maxX - 0.3, minZ + 0.3, maxZ - 0.2);
  mapRect(x, z, w, d, hexStr(o.wallColor ?? 0xe2e8f0), '#f59e0b', true);
  return { object: g, boxes: S.boxes, anchors: { door: [x, y, z + d / 2], floor: [x, y, z] } };
}

export function buildSuburbanHouseBase(o) {
  const w = o.w ?? 8.4, d = o.d ?? 7.4, h = o.h ?? 3.6;
  const { x, z } = o, rotY = o.rotY || 0, y = 0.18, t = 0.28;
  const wm = wallMat(o.wallColor ?? 0xfed7aa, 3, 2);
  const rm = M(o.roofColor ?? 0x9a3412, { texType: 'shingles', repeatX: 4, repeatY: 4, bumpScale: 0.02 });

  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  g.userData.studioName = 'Suburban house';
  worldRoot.add(g);

  makeBox(g, w - 0.2, 0.08, d - 0.2, 0, 0.04, 0, M(0x92400e, { texType: 'wood' }));
  makeBox(g, w, h, t, 0, h / 2, -d / 2 + t / 2, wm, { cast: true });

  const front = new THREE.Group();
  front.position.set(0, 0, d / 2 - t / 2);
  for (const s of [-1, 1]) {
    const fw = new THREE.Group();
    fw.position.x = s * w * 0.28;
    wallWithWindow(fw, w * 0.38, h, t, 1.45, 1.25, 1.9, wm);
    front.add(fw);
  }
  makeBox(front, w * 0.24, h, t, 0, h / 2, 0, wm);
  makeBox(front, 1.2, 2.2, 0.14, 0, 1.1, 0.1, M(0x78350f, { texType: 'wood' }));
  g.add(front);

  for (const s of [-1, 1]) {
    const sw = new THREE.Group();
    sw.position.set(s * (w / 2 - t / 2), 0, 0);
    sw.rotation.y = -s * Math.PI / 2;
    wallWithWindow(sw, d - t * 2, h, t, 1.5, 1.25, 1.9, wm);
    g.add(sw);
  }
  makeBox(g, 1.4, 0.65, 1.0, -1.6, 0.4, 1.2, M(0x78350f, { texType: 'wood' }));
  makeBox(g, 2.2, 0.72, 0.9, 1.6, 0.42, 0.8, M(0x334155, { texType: 'fabric' }));

  gableRoof(g, w, d, h, 2.2, 0.55, rm);
  makeBox(g, 3.4, 0.24, 1.8, 0, 2.25, d / 2 + 0.85,
    M(o.roofColor ?? 0x9a3412, { texType: 'shingles', repeatX: 2, repeatY: 1 }), { cast: true });

  const lod = new THREE.Group();
  makeBox(lod, 0.85, 2.2, 0.85, w * 0.28, h + 1.4, -d * 0.15,
    M(0x9a3412, { texType: 'brick', repeatX: 1, repeatY: 2, bumpScale: 0.02 }), { cast: true });
  g.add(lod);
  registerBuildingLod(x, z, lod);

  const c = Math.abs(Math.cos(rotY)), s = Math.abs(Math.sin(rotY));
  const ww = w * c + d * s, wd = w * s + d * c;
  const boxes = [addSolidBox(x - ww / 2, x + ww / 2, y, y + h, z - wd / 2, z + wd / 2, 'house_wall', false)];
  const ax = x + Math.sin(rotY) * (d / 2 + 0.85), az = z + Math.cos(rotY) * (d / 2 + 0.85);
  const aw = 3.4 * c + 1.8 * s, ad = 3.4 * s + 1.8 * c;
  boxes.push(addSolidBox(ax - aw / 2, ax + aw / 2, 2.25, 2.48, az - ad / 2, az + ad / 2, 'porch_awning', true));
  mapRect(x, z, ww, wd, hexStr(o.wallColor ?? 0xfed7aa), '#1e293b', false);
  return { object: g, boxes };
}

export function embellishHouse(o) {
  const w = o.w ?? 8.4, d = o.d ?? 7.4;
  const g = new THREE.Group();
  g.position.set(o.x, 0.18, o.z);
  g.rotation.y = o.rotY || 0;
  worldRoot.add(g);
  const wood = M(0xf1f5f9, { roughness: 0.7 }), green = M(0x14532d, { roughness: 0.8 });
  const add = (sx, sy, sz, m, px, py, pz) => makeBox(g, sx, sy, sz, px, py, pz, m, { cast: true });
  add(w * 0.36, 0.14, 1.4, M(0xa8a29e, { texType: 'concrete' }), 0, 0.07, d / 2 + 0.7);
  for (const s of [-1, 1]) {
    const wx = s * w * 0.28;
    add(0.34, 1.25, 0.06, green, wx - 0.98, 1.9, d / 2 + 0.05);
    add(0.34, 1.25, 0.06, green, wx + 0.98, 1.9, d / 2 + 0.05);
    add(1.4, 0.22, 0.3, M(0x78350f, { texType: 'wood' }), wx, 1.18, d / 2 + 0.18);
    add(1.3, 0.2, 0.24, M(0x22c55e), wx, 1.38, d / 2 + 0.18);
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), M(0x15803d));
    bush.position.set(s * w * 0.44, 0.4, d / 2 + 0.55);
    bush.castShadow = true;
    g.add(bush);
  }
  add(0.08, 1.0, 0.08, wood, w * 0.6, 0.5, d / 2 + 3);
  add(0.4, 0.28, 0.25, M(0x1d4ed8), w * 0.6, 1.1, d / 2 + 3);
  add(w + 2, 0.07, 0.07, wood, 0, 0.7, d / 2 + 4.2);
  add(w + 2, 0.07, 0.07, wood, 0, 0.42, d / 2 + 4.2);
  for (let fx = -w / 2 - 1; fx <= w / 2 + 1.01; fx += 0.9) {
    if (Math.abs(fx) > 1.0) add(0.08, 0.95, 0.08, wood, fx, 0.48, d / 2 + 4.2);
  }
  return g;
}

export function buildSuburbanHouse(o) {
  const rec = buildSuburbanHouseBase(o);
  embellishHouse(o);
  return rec;
}

// =============================================================================
// SHOPS — five fittings on one shell
// =============================================================================
export function buildHotdogStore(x, z) {
  const w = 11.4, d = 9.6, h = 4.2, y = 0.18;
  const S = shell({
    x, z, y, w, d, h, t: 0.36, doorW: 2.8, doorH: 2.9,
    wallMat: wallMat(0xfef08a), name: 'AURA HOTDOGS',
    side: [2.2, 1.4, 2.0], front: 'auto',
    floorMat: M(0xf8fafc, { texType: 'cobblestone', repeatX: 6, repeatY: 6, roughness: 0.5 })
  });
  const { g, solid, minX, maxX, minZ, maxZ } = S;
  const red = M(0xdc2626, { roughness: 0.45 });
  flatRoof(S, red, { over: 0.6, thick: 0.36 });

  // Roof mascot.
  const mascot = new THREE.Group();
  mascot.position.set(0, h + 1.15, 0.5);
  const bun = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 2.6, 6, 10), M(0xd97706, { roughness: 0.6 }));
  bun.rotation.z = Math.PI / 2;
  bun.position.set(0, 0, 0.24);
  const bun2 = bun.clone();
  bun2.position.z = -0.24;
  const wiener = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 3.1, 6, 10), M(0xb91c1c, { roughness: 0.35 }));
  wiener.rotation.z = Math.PI / 2;
  wiener.position.y = 0.12;
  makeBox(mascot, 2.9, 0.08, 0.12, 0, 0.48, 0, M(0xfacc15));
  mascot.add(bun, bun2, wiener);
  g.add(mascot);
  neon(g, 'AURA HOTDOGS', 0, 3.55, d / 2 + 0.08, '#991b1b', '#fef08a', 5.2, 1.05);

  makeBox(g, 4.4, 1.0, 1.0, -2.4, 0.55, -0.5, red);
  makeBox(g, 4.5, 0.1, 1.1, -2.4, 1.08, -0.5, M(0xf8fafc, { metalness: 0.7 }));
  solid(x - 4.6, x - 0.2, y, 1.25, z - 1.05, z + 0.05, 'hd_counter', true);
  makeBox(g, 6.8, 0.96, 1.1, 0, 0.54, -d / 2 + 1.15,
    M(0x334155, { texType: 'brushedsteel', metalness: 0.85 }));
  solid(x - 3.4, x + 3.4, y, 1.25, minZ + 0.6, minZ + 1.75, 'hd_back_counter', true);

  const vat = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.44, 0.65, 14),
    M(0xe2e8f0, { metalness: 0.92, roughness: 0.18 }));
  vat.position.set(2.4, 1.32, -d / 2 + 1.15);
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 14),
    M(0xf97316, { emissive: 0xea580c, emissiveIntensity: 0.55 }));
  liquid.position.set(2.4, 1.63, -d / 2 + 1.15);
  neon(g, 'SAUSAGE REFILL VAT  [E]', 2.4, 2.35, -d / 2 + 0.45, '#7f1d1d', '#fef08a', 3.4, 0.62);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.15, 22),
    new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(2.4, 0.10, -2.2);
  g.add(vat, liquid, ring);

  zone('AURA HOTDOGS STORE', minX + 0.3, maxX - 0.3, minZ + 0.3, maxZ - 0.2);
  mapRect(x, z, w, d, '#ef4444', '#facc15', true);
  return { object: g, boxes: S.boxes, anchors: { refill: [x + 2.4, y, z - 2.2] }, refill: { x: x + 2.4, y, z: z - 2.2, label: 'AURA HOTDOGS SAUSAGE VAT' } };
}

export function buildCarDealership(x, z) {
  const w = 15.6, d = 12.6, h = 4.8, y = 0.18;
  const dark = M(0x1e293b, { texType: 'concrete', repeatX: 5, repeatY: 2, roughness: 0.45 });
  const trim = M(0xf59e0b, { metalness: 0.85, roughness: 0.2 });
  const S = shell({
    x, z, y, w, d, h, t: 0.38, doorW: 4.8, doorH: 3.5, wallMat: dark,
    name: 'AURA EXOTIC MOTORS', mullions: false,
    side: [d - 3.2, 2.75, 1.95], front: 'auto',
    floorMat: M(0xf8fafc, { texType: 'marble', repeatX: 6, repeatY: 5, roughness: 0.16, clearcoat: 0.9, flatShading: false })
  });
  const { g, solid, minX, maxX, minZ, maxZ } = S;
  flatRoof(S, dark, { over: 0.8, thick: 0.38 });
  makeBox(g, w + 0.9, 0.28, d + 0.9, 0, h + 0.04, 0, trim);

  const ring = new THREE.Mesh(new THREE.RingGeometry(2.5, 2.85, 32),
    new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, 0.10, -0.4);
  g.add(ring);
  makeBox(g, 2.4, 0.95, 0.95, -5.6, 0.52, -4.4, M(0x0f172a));
  makeBox(g, 2.5, 0.08, 1.05, -5.6, 1.02, -4.4, trim);
  solid(x - 6.85, x - 4.35, y, 1.18, z - 4.9, z - 3.9, 'dealer_desk', true);
  solid(minX + 0.38, maxX - 0.38, y, 0.26, minZ + 0.38, maxZ - 0.38, 'dealer_floor', true);
  neon(g, 'AURA EXOTIC MOTORS', 0, 4.15, d / 2 + 0.12, '#090d14', '#f59e0b', 8.2, 1.15);

  zone('AURA EXOTIC MOTORS', minX + 0.3, maxX - 0.3, minZ + 0.3, maxZ - 0.2);
  mapRect(x, z, w, d, '#1e293b', '#f59e0b', true);
  return { object: g, boxes: S.boxes, anchors: { turntable: [x, y + 0.1, z - 0.4] } };
}

export function buildReserveBank(x, z) {
  const w = 16.4, d = 13.6, h = 6.2, y = 0.18;
  const marble = M(0xf8fafc, { texType: 'marble', repeatX: 5, repeatY: 3, roughness: 0.22, clearcoat: 0.85, flatShading: false });
  const granite = M(0x1e293b, { texType: 'granite', repeatX: 4, repeatY: 2, roughness: 0.25, flatShading: false });
  const gold = M(0xfbbf24, { metalness: 0.94, roughness: 0.15, clearcoat: 0.9, flatShading: false });
  const steel = M(0x94a3b8, { texType: 'brushedsteel', metalness: 0.94, roughness: 0.18, flatShading: false });
  const S = shell({
    x, z, y, w, d, h, t: 0.45, doorW: 3.2, doorH: 3.4, wallMat: marble,
    name: 'SUNNYVALE RESERVE BANK',
    side: [3.4, 2.2, 2.6], front: [2.8, 2.2, 2.6], floorMat: marble, floorT: 0.10
  });
  const { g, solid, minX, maxX, minZ, maxZ } = S;
  flatRoof(S, marble, { over: 1.2, thick: 0.48 });
  makeBox(g, w + 1.5, 0.35, d + 1.9, 0, h + 0.62, 0, gold);
  for (const cx of [-6.6, -2.6, 2.6, 6.6]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, h, 14), marble);
    col.position.set(cx, h / 2, d / 2 + 0.65);
    col.castShadow = true;
    g.add(col);
  }
  neon(g, 'SUNNYVALE RESERVE BANK', 0, 5.1, d / 2 + 0.92, '#0f172a', '#fbbf24', 8.4, 1.15);

  makeBox(g, 7.2, 1.05, 1.1, -3.2, 0.58, -1.2, marble);
  makeBox(g, 7.4, 0.12, 1.25, -3.2, 1.15, -1.2, granite);
  makeBox(g, 6.8, 1.1, 0.08, -3.2, 1.75, -1.2, resolveMat('glassWarm'));
  solid(x - 6.8, x + 0.4, y, 1.4, z - 1.8, z - 0.6, 'bank_counter', true);

  makeBox(g, 5.6, 3.6, 0.4, 4.8, 1.85, -d / 2 + 0.6, steel);
  makeBox(g, 0.4, 3.6, 4.4, 2.2, 1.85, -d / 2 + 2.6, steel);
  solid(x + 2.0, x + 2.4, y, 3.8, minZ + 0.4, minZ + 4.8, 'vault_wall', false);
  const door = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 0.35, 20), steel);
  door.rotation.set(Math.PI / 2, 0, 0.7);
  door.position.set(1.35, 1.75, -d / 2 + 4.8);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 16), gold);
  wheel.position.set(1.35, 1.75, -d / 2 + 5.0);
  g.add(door, wheel);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    makeBox(g, 0.42, 0.18, 0.22, 4.2 + c * 0.52, 0.24 + r * 0.19, -d / 2 + 1.5, gold);
  }

  zone('SUNNYVALE RESERVE BANK', minX + 0.3, maxX - 0.3, minZ + 0.3, maxZ - 0.2);
  mapRect(x, z, w, d, '#f8fafc', '#f59e0b', true);
  return { object: g, boxes: S.boxes };
}

/**
 * Shell + interior fit-out ONLY. Display cases, dumpster, alarm and the [E]/[F]
 * hooks live in worldSystems/armory.js, which consumes the returned record.
 */
export function buildFirearmsArmory(row) {
  const x = row.at[0], z = row.at[1];
  const w = row.w ?? 20, d = row.d ?? 22, h = row.h ?? 5.2;
  const y = foundY(row.baseY, x, z, w, d, 0.24);
  const dark = M(0x27272a, { texType: 'concrete', repeatX: 5, repeatY: 2, roughness: 0.72 });
  const trim = M(0xdc2626, { metalness: 0.55, roughness: 0.35 });
  const S = shell({
    x, z, y, w, d, h, t: 0.4, doorW: 3.2, doorH: 3.0, wallMat: dark,
    name: 'AURA ARMORY', mullions: false,
    side: [3.0, 1.6, 2.6], front: 'auto',
    floorMat: M(0x3f3f46, { texType: 'concrete', repeatX: 6, repeatY: 6, roughness: 0.55 }), floorT: 0.10
  });
  const { g, solid, minX, maxX, minZ, maxZ } = S;
  flatRoof(S, dark, { over: 0.8, thick: 0.4 });
  makeBox(g, w + 1.0, 0.34, d + 1.0, 0, h + 0.02, 0, trim);
  neon(g, 'AURA ARMORY', 0, 4.35, d / 2 + 0.16, '#0b0b0f', '#ef4444', 9.0, 1.25);
  neon(g, 'FIREARMS  •  AMMO  •  MELEE', 0, 3.35, d / 2 + 0.16, '#0b0b0f', '#facc15', 8.0, 0.6);

  // Interior lives in a distance-culled group (adopted by worldStream).
  const inn = new THREE.Group();
  inn.userData.studioName = 'Armory interior';
  g.add(inn);
  const slat = M(0x52525b, { texType: 'corrugated', repeatX: 8, repeatY: 2, metalness: 0.5, roughness: 0.6 });
  const steel = resolveMat('steel');
  makeBox(inn, w - 1.2, 3.0, 0.14, 0, 2.0, -d / 2 + 0.55, slat);
  makeBox(inn, 1.5, 1.05, 6.0, w / 2 - 1.5, 0.55, 0.5, M(0x1c1917, { texType: 'wood', repeatX: 3, repeatY: 1 }));
  makeBox(inn, 1.7, 0.1, 6.2, w / 2 - 1.5, 1.12, 0.5, steel);
  makeBox(inn, 0.7, 0.45, 0.55, w / 2 - 1.5, 1.4, 2.0, M(0x0f172a, { metalness: 0.6 }));
  makeBox(inn, 0.5, 0.3, 0.05, w / 2 - 1.5, 1.5, 2.3, resolveMat('screen'));
  solid(x + w / 2 - 2.35, x + w / 2 - 0.65, y, y + 1.17, z - 2.5, z + 3.5, 'armory_counter', true);

  makeBox(inn, 3.0, 2.2, 0.6, -w / 2 + 2.0, 1.1, -d / 2 + 1.0, slat);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
    makeBox(inn, 0.42, 0.3, 0.34, -w / 2 + 0.9 + c * 0.52, 0.55 + r * 0.62, -d / 2 + 1.35,
      M(r % 2 ? 0xd97706 : 0xb91c1c, { roughness: 0.6 }));
  }
  const ax = row.ammo?.at?.[0] ?? x - 6.8, az = row.ammo?.at?.[1] ?? z - 8.4;
  const ammoBox = makeBox(inn, 1.1, 0.8, 0.9, ax - x, 0.4, az - z, M(0xd97706, { texType: 'wood' }), { cast: true });
  solid(ax - 0.55, ax + 0.55, y, y + 0.8, az - 0.45, az + 0.45, 'armory_ammo', true);
  neon(inn, `SAUSAGE AMMO  [E] $${row.ammo?.price ?? 60}`, ax - x, 1.5, az - z + 0.6, '#7f1d1d', '#fef08a', 2.8, 0.45);

  for (const lx of [-5.5, 0, 5.5]) {
    makeBox(inn, 3.4, 0.1, 0.5, lx, h - 0.35, 0, resolveMat('stripLight'));
  }
  const shopLight = new THREE.PointLight(0xfff1d6, 2.4, 26, 2);
  shopLight.position.set(0, h - 1.0, 0);
  inn.add(shopLight);
  neon(inn, 'LICENSED DEALER  •  NO REFUNDS', 0, 3.9, -d / 2 + 0.7, '#0b0b0f', '#a1a1aa', 7.0, 0.5);
  (aura.culls || []).push({ g: inn, x, z, r: 80 });

  solid(minX + 0.4, maxX - 0.4, y, y + 0.10, minZ + 0.4, maxZ - 0.4, 'armory_floor', true);
  zone('AURA ARMORY', minX + 0.4, maxX - 0.4, minZ + 0.4, maxZ - 0.3);
  mapRect(x, z, w, d, '#dc2626', '#facc15', true);
  return {
    object: g, boxes: S.boxes, interior: inn, ammoBox,
    anchors: { door: [x, y, z + d / 2], ammo: [ax, y, az], counter: [x + w / 2 - 1.5, y, z + 0.5] },
    armory: { x, z, w, d, h, baseY: y }
  };
}

// =============================================================================
// CIVIC BLOCKS
// =============================================================================
export function buildDiner(row) {
  const [x, z] = row.at, w = row.w ?? 9.6, d = row.d ?? 9.2, h = row.h ?? 4.4, y = 0.18;
  const g = new THREE.Group();
  g.userData.studioName = row.name || 'Diner';
  worldRoot.add(g);
  makeBox(g, w, h, d, x, y + h / 2, z,
    M(row.wall ?? 0xfde68a, { texType: 'brick', repeatX: 4, repeatY: 2, bumpScale: 0.02 }), { cast: true });
  makeBox(g, w * 0.73, 1.8, 0.08, x, 1.5, z + d / 2 + 0.02, resolveMat('glassWarm'));
  neon(g, row.name || 'DINER', x, 3.65, z + d / 2 + 0.08,
    row.sign?.bg || '#7f1d1d', row.sign?.fg || '#fef08a');
  const box = addSolidBox(x - w / 2, x + w / 2, y, y + h, z - d / 2, z + d / 2, 'diner_roof', true);
  mapRect(x, z, w, d, hexStr(row.wall ?? 0xfde68a), '#b45309', false);
  return { object: g, boxes: [box] };
}

export function buildApartmentBlock(row) {
  const [x, z] = row.at, w = row.w ?? 11, d = row.d ?? 16, h = row.h ?? 8.4, y = 0.18;
  const g = new THREE.Group();
  g.userData.studioName = row.name || 'Apartment block';
  worldRoot.add(g);
  makeBox(g, w, h, d, x, y + h / 2, z,
    M(row.wall ?? 0xb45309, { texType: 'brick', repeatX: 5, repeatY: 4, bumpScale: 0.025 }),
    { cast: true, recv: true });
  const boxes = [addSolidBox(x - w / 2, x + w / 2, y, y + h, z - d / 2, z + d / 2, 'apartment_roof', true)];
  mapRect(x, z, w, d, hexStr(row.wall ?? 0xb45309), '#78350f', false);

  const fe = row.fireEscape;
  if (fe) {
    const steel = M(0x94a3b8, { texType: 'diamondplate', repeatX: 2, repeatY: 3, metalness: 0.88, roughness: 0.28, bumpScale: 0.02 });
    for (const st of fe.steps || []) {
      makeBox(g, 2.2, 0.25, 3.4, fe.x, st.y, st.z, steel, { cast: true });
      boxes.push(addSolidBox(fe.x - 1.1, fe.x + 1.1, st.y - 0.15, st.y + 0.13, st.z - 1.7, st.z + 1.7, 'fire_escape', true));
    }
  }
  return { object: g, boxes };
}

export function buildContainerStack(row) {
  const g = new THREE.Group();
  g.userData.studioName = row.name || 'Container stack';
  worldRoot.add(g);
  const boxes = [];
  const mat = (hex) => M(hex, { texType: 'corrugated', repeatX: 3, repeatY: 2, metalness: 0.82, roughness: 0.34, bumpScale: 0.03 });
  let cx = 0, cz = 0, n = 0;
  for (const [w, h, d, x, y, z, hex] of row.rows || []) {
    makeBox(g, w, h, d, x, y, z, mat(hex), { cast: true });
    boxes.push(addSolidBox(x - w / 2, x + w / 2, y - h / 2, y + h / 2, z - d / 2, z + d / 2, 'container', true));
    cx += x; cz += z; n++;
  }
  const cw = row.catwalk;
  if (cw) {
    makeBox(g, cw.w, 0.22, cw.d, cw.at[0], cw.y, cw.at[1],
      M(0x94a3b8, { texType: 'diamondplate', repeatX: 2, repeatY: 3, metalness: 0.88, roughness: 0.28 }), { cast: true });
    boxes.push(addSolidBox(cw.at[0] - cw.w / 2, cw.at[0] + cw.w / 2, cw.y - 0.12, cw.y + 0.11,
      cw.at[1] - cw.d / 2, cw.at[1] + cw.d / 2, 'gantry_catwalk', true));
  }
  if (n) mapRect(cx / n, cz / n, 7, 8, '#dc2626', '#991b1b', false);
  return { object: g, boxes };
}

// =============================================================================
// LANDMARKS
// =============================================================================
export function buildMesa(row) {
  const [x, z] = row.at, w = row.w, d = row.d, h = row.h;
  const g = new THREE.Group();
  g.userData.studioName = `Mesa ${row.id}`;
  worldRoot.add(g);
  const body = M(0xb45309, { texType: 'redrock', repeatX: 6, repeatY: 3, roughness: 0.9, bumpScale: 0.03 });
  const cap = M(0xd97706, { texType: 'sand', repeatX: 4, repeatY: 4, roughness: 0.92 });
  makeBox(g, w, h, d, x, h / 2, z, body, { cast: true, recv: true });
  makeBox(g, w * 0.72, h * 0.55, d * 0.72, x, h + (h * 0.55) / 2, z, cap, { cast: true });
  const boxes = [
    addSolidBox(x - w / 2, x + w / 2, 0.02, h, z - d / 2, z + d / 2, 'mesa_low', true),
    addSolidBox(x - w * 0.36, x + w * 0.36, h, h * 1.55, z - d * 0.36, z + d * 0.36, 'mesa_top', true)
  ];
  mapRect(x, z, w, d, '#9a3412', '#7c2d12', false);
  return { object: g, boxes };
}

export function buildTemple(row) {
  const [x, z] = row.at;
  const pw = row.platW ?? 60, pd = row.platD ?? 60, ph = row.platH ?? 3;
  const y = row.baseY ?? 1.5;
  const g = new THREE.Group();
  g.userData.studioName = 'Ancient Sun Temple';
  worldRoot.add(g);
  const stone = M(0x57534e, { texType: 'cobblestone', repeatX: 8, repeatY: 8, roughness: 0.92 });
  const moss = M(0x3f6212, { texType: 'cobblestone', repeatX: 6, repeatY: 6, roughness: 0.95 });
  const boxes = [];
  makeBox(g, pw, ph, pd, x, y + ph / 2, z, stone, { cast: true, recv: true, name: 'Sun Temple platform' });
  boxes.push(addSolidBox(x - pw / 2, x + pw / 2, y, y + ph, z - pd / 2, z + pd / 2, 'temple_platform', true));

  const run = row.ramp?.run ?? 12, rw = row.ramp?.w ?? 12;
  makeBox(g, rw, 0.3, Math.hypot(run, ph), x, y + ph / 2 - 0.1, z + pd / 2 + run / 2,
    M(0x57534e, { texType: 'cobblestone', repeatX: 2, repeatY: 3 }), { recv: true, rx: Math.atan2(ph, run) });
  addRamp({ minX: x - rw / 2, maxX: x + rw / 2, minZ: z + pd / 2, maxZ: z + pd / 2 + run, startY: y + ph, endY: y, axis: 'z', dir: 1 });

  let ty = y + ph;
  (row.tiers || [[40, 40], [32, 32], [24, 24], [16, 16], [8, 8]]).forEach(([w, d], i) => {
    const th = 1.2;
    makeBox(g, w, th, d, x, ty + th / 2, z, i % 2 === 0 ? stone : moss, { cast: true, recv: true });
    boxes.push(addSolidBox(x - w / 2, x + w / 2, ty, ty + th, z - d / 2, z + d / 2, 'temple_tier', true));
    ty += th;
  });
  makeBox(g, 3, 1.6, 3, x, ty + 0.8, z, stone, { cast: true });
  boxes.push(addSolidBox(x - 1.5, x + 1.5, ty, ty + 1.6, z - 1.5, z + 1.5, 'temple_summit', true));
  if (row.relic) {
    const relic = new THREE.Mesh(new THREE.OctahedronGeometry(1.2, 0), M(0xfacc15, { metalness: 0.9, roughness: 0.2 }));
    relic.position.set(x, ty + 2.8, z);
    relic.castShadow = true;
    g.add(relic);
  }
  neon(g, 'ANCIENT SUN TEMPLE', x, ty + 4.4, z + 4, '#14532d', '#fde047', 6.5, 1.0);
  mapRect(x, z, pw, pd, '#65a30d', '#facc15', false);
  return { object: g, boxes, anchors: { summit: [x, ty + 1.6, z] } };
}

export function buildHideout(row) {
  const [cx, cz] = row.at;
  const half = row.half ?? 30, peak = row.peak ?? 32, baseY = row.baseY ?? 0.02;
  const g = new THREE.Group();
  g.userData.studioName = 'REDROCK SCORPION HIDEOUT';
  worldRoot.add(g);
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xc28b47, roughness: 0.96, flatShading: true, side: THREE.DoubleSide });
  const chamber = new THREE.MeshStandardMaterial({ color: 0x34383b, roughness: 0.92 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x9a6a32, roughness: 0.85 });
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffc15a });
  const tri = (a, b, c) => {
    const geo = new THREE.BufferGeometry();
    geo.setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b), new THREE.Vector3(...c)]);
    geo.setIndex([0, 1, 2]);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, shellMat);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  };
  const xw = cx - half, xe = cx + half, zn = cz - half, zs = cz + half, apex = [cx, peak, cz];
  tri([xw, baseY, zn], [xw, baseY, cz - 11], apex);
  tri([xw, baseY, cz + 11], [xw, baseY, zs], apex);
  tri([xw, 8.5, cz - 11], [xw, 8.5, cz + 11], apex);
  tri([xe, baseY, zn], [xe, baseY, zs], apex);
  tri([xw, baseY, zn], [xe, baseY, zn], apex);
  tri([xe, baseY, zs], [xw, baseY, zs], apex);

  const boxes = [];
  const box = (x, y, z, w, h, d, mat, solid = false) => {
    makeBox(g, w, h, d, x, y, z, mat, { cast: true, recv: true });
    if (solid) boxes.push(addSolidBox(x - w / 2, x + w / 2, baseY, baseY + h, z - d / 2, z + d / 2, 'solid', false));
  };
  box(cx, baseY + 0.06, cz, 54, 0.12, 54, chamber);
  box(cx, 8.1, cz, 50, 0.4, 50, chamber);
  box(cx, 4, cz - 25, 50, 8, 2, chamber, true);
  box(cx, 4, cz + 25, 50, 8, 2, chamber, true);
  box(cx + 25, 4, cz, 2, 8, 50, chamber, true);
  box(cx - 25, 4, cz - 20, 2, 8, 10, chamber, true);
  box(cx - 25, 4, cz + 20, 2, 8, 10, chamber, true);
  box(cx - 25, 7.8, cz, 2, 0.3, 30, chamber);
  box(cx - 42, baseY + 0.04, cz, 34, 0.08, 24, trim);
  box(cx - 24, 4, cz, 0.3, 0.3, 20, lightMat);
  box(cx, 4, cz - 24, 0.3, 0.3, 16, lightMat);

  const sg = new THREE.Group();
  sg.position.set(xw - 0.25, 7.5, cz);
  sg.rotation.y = -Math.PI / 2;
  neon(sg, 'REDROCK SCORPION HIDEOUT', 0, 0, 0, '#1c1917', '#fbbf24', 13, 1.25);
  g.add(sg);
  const beacon = new THREE.PointLight(0xffb14a, 55, 30, 2);
  beacon.position.set(cx, 6.5, cz);
  g.add(beacon);

  zone('REDROCK SCORPION HIDEOUT', cx - 24, cx + 24, cz - 24, cz + 24);
  mapRect(cx, cz, 60, 60, '#b77935', '#78350f', true);
  return { object: g, boxes, anchors: { pad: [cx + 1, 0.14, cz] } };
}

export function buildArena(row) {
  const [x, z] = row.at, r = row.r ?? 14.5, h = row.h ?? 14.0, y = row.baseY ?? 0.30;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.userData.studioName = row.sign || 'Arena';
  worldRoot.add(g);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, h, 24),
    M(0x1e293b, { metalness: 0.75, roughness: 0.25 }));
  bowl.position.y = h / 2; bowl.castShadow = true;
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.79, r * 1.02, 3.2, 24),
    M(0x38bdf8, { metalness: 0.85, roughness: 0.18, emissive: 0x0284c7, emissiveIntensity: 0.22 }));
  roof.position.y = h + 1.6;
  const led = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.15, r + 0.15, 1.8, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: row.led ?? 0xa855f7, side: THREE.DoubleSide }));
  led.position.y = h * 0.75;
  g.add(bowl, roof, led);
  neon(g, row.sign || 'ARENA', 0, 4.5, r + 0.3, '#1e1b4b', '#facc15', 13.5, 1.35);
  const box = addSolidBox(x - r, x + r, y, y + h + 3.2, z - r, z + r, 'aura_arena', false);
  mapRect(x, z, r * 2, r * 2, '#4f46e5', '#facc15', false);
  return { object: g, boxes: [box] };
}

export function buildHangar(row) {
  const [x, z] = row.at, w = row.w ?? 26, d = row.d ?? 28, h = row.h ?? 11, y = row.baseY ?? 0.29;
  const g = new THREE.Group();
  g.userData.studioName = row.name || 'Hangar';
  worldRoot.add(g);
  const steel = resolveMat('steel');
  makeBox(g, w, h, 0.6, x, y + h / 2, z - d / 2, steel, { cast: true });
  makeBox(g, w, h, 0.6, x, y + h / 2, z + d / 2, steel, { cast: true });
  makeBox(g, 0.6, h, d, x + w / 2, y + h / 2, z, steel, { cast: true });
  makeBox(g, w + 0.8, 0.6, d + 0.8, x, y + h + 0.3, z, M(0x334155), { cast: true });
  const boxes = [
    addSolidBox(x - w / 2, x + w / 2, y, y + h, z - d / 2, z - d / 2 + 0.6, 'hangar_wall', false),
    addSolidBox(x - w / 2, x + w / 2, y, y + h, z + d / 2 - 0.6, z + d / 2, 'hangar_wall', false),
    addSolidBox(x + w / 2 - 0.6, x + w / 2, y, y + h, z - d / 2, z + d / 2, 'hangar_wall', false),
    addSolidBox(x - w / 2, x + w / 2, y + h, y + h + 0.6, z - d / 2, z + d / 2, 'hangar_roof', true)
  ];
  neon(g, row.name || 'HANGAR', x, y + h - 1.6, z - d / 2 - 0.4, '#0f172a', '#facc15', 12.0, 1.1);
  zone('AIRCRAFT HANGAR', x - w / 2 + 1, x + w / 2 - 1, z - d / 2 + 1, z + d / 2 - 1);
  mapRect(x, z, w, d, '#94a3b8', '#1e293b', true);
  return { object: g, boxes };
}

export function buildThemeBuilding(row) {
  const [x, z] = row.at, y = row.baseY ?? 0.24;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.userData.studioName = 'LAX Theme Building';
  worldRoot.add(g);
  const white = resolveMat('white');
  const core = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 15.0, 14), white);
  core.position.y = 7.5;
  const saucer = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 6.8, 2.6, 20),
    M(0x38bdf8, { metalness: 0.85, roughness: 0.15, emissive: 0x0284c7, emissiveIntensity: 0.3 }));
  saucer.position.y = 10.2;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(8.8, 2.2, 20), white);
  cap.position.y = 12.6;
  g.add(core, saucer, cap);
  for (const ry of [0, Math.PI / 2]) {
    const pts = [];
    for (let t = -1; t <= 1.001; t += 0.1) pts.push(new THREE.Vector3(t * 16.5, (1 - t * t) * 18.5, 0));
    const arch = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.55, 8, false), white);
    arch.rotation.y = ry;
    arch.castShadow = true;
    g.add(arch);
  }
  const box = addSolidBox(x - 3.5, x + 3.5, y, y + 15.0, z - 3.5, z + 3.5, 'lax_theme_bldg', false);
  mapRect(x, z, 34, 34, '#f8fafc', '#38bdf8', false);
  return { object: g, boxes: [box] };
}

export function buildATCTower(row) {
  const [x, z] = row.at, h = row.h ?? 34.0, y = row.baseY ?? 0.24;
  const g = new THREE.Group();
  g.userData.studioName = 'Control tower';
  worldRoot.add(g);
  const white = resolveMat('white');
  makeBox(g, 5.2, h, 5.2, x, y + h / 2, z, white, { cast: true });
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 3.8, 4.6, 12),
    M(0x10b981, { metalness: 0.85, roughness: 0.15, emissive: 0x059669, emissiveIntensity: 0.28 }));
  cab.position.set(x, y + h + 2.0, z);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(5.8, 5.8, 0.7, 12), white);
  roof.position.set(x, y + h + 4.6, z);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
  beacon.position.set(x, y + h + 7.0, z);
  aviationBeacons.push(beacon);
  g.add(cab, roof, beacon);
  neon(g, 'CONTROL TOWER', x, y + h - 4.0, z - 2.8, '#052e2b', '#6ee7b7', 5.0, 0.7);
  const box = addSolidBox(x - 2.6, x + 2.6, y, y + h + 5.0, z - 2.6, z + 2.6, 'atc_tower', false);
  mapRect(x, z, 11, 11, '#10b981', '#6ee7b7', false);
  return { object: g, boxes: [box] };
}

// =============================================================================
// REGISTRY — worldRuntime spreads this into registerLegacyBuilders({...}).
// =============================================================================
export const BUILDING_BUILDERS = {
  house_walkin: buildWalkInHouse,
  house_suburban: buildSuburbanHouse,
  shop_hotdog: buildHotdogStore,
  shop_bank: buildReserveBank,
  shop_dealer: buildCarDealership,
  shop_armory: buildFirearmsArmory,
  shop_diner: buildDiner,
  apartment_block: buildApartmentBlock,
  container_stack: buildContainerStack,
  mesa: buildMesa,
  temple: buildTemple,
  hideout: buildHideout,
  arena: buildArena,
  hangar: buildHangar,
  theme_building: buildThemeBuilding,
  atc_tower: buildATCTower
};

export default BUILDING_BUILDERS;