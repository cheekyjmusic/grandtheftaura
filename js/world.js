// =============================================================================
// world.js — Roads, I-88 freeway, desert & alpine/woods/cove biomes, walk-in interiors, skyscrapers, Aura Hills, sewers and the data-driven entity spawner.
// =============================================================================
import * as THREE from 'three';
import { colorToHex, levelData } from './levelData.js';
import { AHC, SFY, addDriveableRamp, addWorldBox, ahRy, ahRz, ahRzD, aura, aviationBeacons, biomeAt, buildingLods, collidesHorizontally, crime, enterableZones, fbm, gameState, hillsH, hooks, iceZones, isInWater, keys, lampPosts, manholeCovers, manholeHoles, manholeOpen, manholes, mapShapes, pick, player, pushFeed, registerBuildingLod, riverX, rnd, roadC, roadH, sRects, sausageRefillZones, skyscrapers, sstep, terrainH, under, waterZones, worldBoxes } from './state.js';
import { camera, makeMat, realWindowGlassMat, regHigh, scene, worldRoot } from './engine.js';
import { applyEntityColor, applyEntityTexture, applyModelPreset } from './assets.js';
import { sfx } from './audio.js';
import { buildBarrelMesh, buildCrateMesh, buildPickupMesh, spawnHazardBarrel, spawnParticles, spawnSmashCrate, spawnWorldPickup } from './items.js';
import { buildSportsCar, buildSportsCarMesh, vehicles } from './vehicles.js';

// Helper: Builds a wall segment with a real rectangular window cutout & real glass pane!
export function buildWallWithRealWindow(parent, width, height, thick, winW, winH, winCenterY, wallMat, addMullions = true) {
  const group = new THREE.Group();
  const sideW = Math.max(0.1, (width - winW) / 2);
  const botH = Math.max(0.1, winCenterY - winH / 2);
  const topH = Math.max(0.1, height - (winCenterY + winH / 2));

  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(sideW, height, thick), wallMat);
  leftWall.position.set(-(winW / 2 + sideW / 2), height / 2, 0);
  leftWall.castShadow = true;
  leftWall.receiveShadow = true;

  const rightWall = leftWall.clone();
  rightWall.position.x = winW / 2 + sideW / 2;

  const botWall = new THREE.Mesh(new THREE.BoxGeometry(winW, botH, thick), wallMat);
  botWall.position.set(0, botH / 2, 0);
  botWall.castShadow = true;
  botWall.receiveShadow = true;

  const topWall = new THREE.Mesh(new THREE.BoxGeometry(winW, topH, thick), wallMat);
  topWall.position.set(0, winCenterY + winH / 2 + topH / 2, 0);
  topWall.castShadow = true;

  // Real Transparent Glass Pane
  const glassPane = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), realWindowGlassMat);
  glassPane.position.set(0, winCenterY, 0);

  // Window Sill & Frame Trim
  const sill = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.16, 0.08, thick + 0.12), makeMat(0xf8fafc));
  sill.position.set(0, winCenterY - winH / 2, 0);

  group.add(leftWall, rightWall, botWall, topWall, glassPane, sill);

  if (addMullions) {
    const mH = new THREE.Mesh(new THREE.BoxGeometry(winW, 0.05, 0.06), makeMat(0xf8fafc));
    mH.position.set(0, winCenterY, 0);
    const mV = new THREE.Mesh(new THREE.BoxGeometry(0.05, winH, 0.06), makeMat(0xf8fafc));
    mV.position.set(0, winCenterY, 0);
    group.add(mH, mV);
  }

  parent.add(group);
  return group;
}

export function buildRoadsFreewayAndDesert() {
  // City Grass Terrain (West & Central Sunnyvale)
  const cityGround = new THREE.Mesh(
    new THREE.PlaneGeometry(360, 440),
    makeMat(0x61a153, { texType: 'grass', repeatX: 52, repeatY: 64, roughness: 0.94 })
  );
  cityGround.rotation.x = -Math.PI / 2;
  cityGround.position.set(-16, 0, -30);
  cityGround.receiveShadow = true;
  worldRoot.add(cityGround);

  // Redrock Desert Terrain (East of I-88 Freeway, x >= 164)
  const desertGround = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 460),
    makeMat(0xd99b52, { texType: 'sand', repeatX: 38, repeatY: 64, roughness: 0.95, bumpScale: 0.02 })
  );
  desertGround.rotation.x = -Math.PI / 2;
  desertGround.position.set(294, 0.02, -10);
  desertGround.receiveShadow = true;
  worldRoot.add(desertGround);

  // City Grid Roads: NS [-120, -72, -24, 24, 72, 120] & EW [-168, -120, -72, -24, 24, 72]
  const nsRoads = [-120, -72, -24, 24, 72, 120];
  const ewRoads = [-168, -120, -72, -24, 24, 72];

  const asphaltNS = makeMat(0x313946, { texType: 'asphalt', repeatX: 2, repeatY: 36, roughness: 0.86, bumpScale: 0.015 });
  const asphaltEW = makeMat(0x313946, { texType: 'asphalt', repeatX: 36, repeatY: 2, roughness: 0.86, bumpScale: 0.015 });
  const yellowMat = makeMat(0xfacc15, { roughness: 0.55 });
  const whiteMat = makeMat(0xf1f5f9, { roughness: 0.55 });

  nsRoads.forEach((rx) => {
    const r = new THREE.Mesh(new THREE.BoxGeometry(12, 0.08, 252), asphaltNS);
    r.position.set(rx, 0.04, -48);
    r.receiveShadow = true;
    worldRoot.add(r);
    for (let z = -170; z <= 74; z += 6) {
      if (!ewRoads.some((iz) => Math.abs(z - iz) < 7.5)) {
        const dash = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 2.5), yellowMat);
        dash.position.set(rx, 0.05, z);
        worldRoot.add(dash);
      }
    }
  });

  ewRoads.forEach((rz) => {
    const r = new THREE.Mesh(new THREE.BoxGeometry(252, 0.08, 12), asphaltEW);
    r.position.set(0, 0.04, rz);
    r.receiveShadow = true;
    worldRoot.add(r);
    for (let x = -122; x <= 122; x += 6) {
      if (!nsRoads.some((ix) => Math.abs(x - ix) < 7.5)) {
        const dash = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.09, 0.26), yellowMat);
        dash.position.set(x, 0.05, rz);
        worldRoot.add(dash);
      }
    }
  });

  // Crosswalks at Intersections
  nsRoads.forEach((ix) => {
    ewRoads.forEach((iz) => {
      for (let s = -4; s <= 4; s += 2) {
        const cwN = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.095, 2.1), whiteMat);
        cwN.position.set(ix + s, 0.052, iz - 7.3);
        const cwS = cwN.clone();
        cwS.position.z = iz + 7.3;
        const cwW = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.095, 0.85), whiteMat);
        cwW.position.set(ix - 7.3, 0.052, iz + s);
        const cwE = cwW.clone();
        cwE.position.x = ix + 7.3;
        worldRoot.add(cwN, cwS, cwW, cwE);
      }
    });
  });

  // 25 City Blocks (5x5 Grid)
  const curbMat = makeMat(0x94a3b8, { texType: 'concrete', repeatX: 16, repeatY: 1, roughness: 0.9 });
  const sidewalkMat = makeMat(0xcbd5e1, { texType: 'sidewalk', repeatX: 12, repeatY: 12, roughness: 0.85 });
  const lawnMat = makeMat(0x69ae59, { texType: 'grass', repeatX: 8, repeatY: 8, roughness: 0.94 });
  const downtownPlazaMat = makeMat(0x94a3b8, { texType: 'cobblestone', repeatX: 14, repeatY: 14, roughness: 0.82 });

  const blockCentersX = [-96, -48, 0, 48, 96];
  const blockCentersZ = [-144, -96, -48, 0, 48];

  blockCentersX.forEach((bx) => {
    blockCentersZ.forEach((bz) => {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(36.3, 0.16, 36.3), curbMat);
      curb.position.set(bx, 0.08, bz);
      curb.receiveShadow = true;
      worldRoot.add(curb);

      const sw = new THREE.Mesh(new THREE.BoxGeometry(36, 0.18, 36), sidewalkMat);
      sw.position.set(bx, 0.09, bz);
      sw.receiveShadow = true;
      worldRoot.add(sw);

      const isDowntown = bz <= -72;
      const inner = new THREE.Mesh(
        new THREE.BoxGeometry(30.4, 0.20, 30.4),
        isDowntown ? downtownPlazaMat : lawnMat
      );
      inner.position.set(bx, 0.10, bz);
      inner.receiveShadow = true;
      worldRoot.add(inner);
    });
  });

  const fwyMat = makeMat(0x1f2937, { texType: 'asphalt', repeatX: 4, repeatY: 60, roughness: 0.84, bumpScale: 0.015 });
  const barrierMat = makeMat(0xd1d5db, { texType: 'concrete', repeatX: 20, repeatY: 1, roughness: 0.88 });

  // Main North-South 4-Lane Interstate (x = 152, width 22m, z = -190 to +210)
  const fwyMain = new THREE.Mesh(new THREE.BoxGeometry(22, 0.12, 400), fwyMat);
  fwyMain.position.set(152, 0.06, 10);
  fwyMain.receiveShadow = true;
  worldRoot.add(fwyMain);

  // Freeway Center Double-Yellow + Lane Dashes + Concrete Jersey Barriers
  const fwyCenterL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 396), yellowMat);
  fwyCenterL.position.set(151.7, 0.07, 10);
  const fwyCenterR = fwyCenterL.clone();
  fwyCenterR.position.x = 152.3;
  worldRoot.add(fwyCenterL, fwyCenterR);

  for (let z = -184; z <= 204; z += 8) {
    const dL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 3.4), whiteMat);
    dL.position.set(146.5, 0.07, z);
    const dR = dL.clone();
    dR.position.x = 157.5;
    worldRoot.add(dL, dR);
  }

  // West & East Freeway Barriers (with connector openings at z = -24, z = 72, and Desert Exit z = 40)
  [
    { x: 141.2, z1: -188, z2: -32 },
    { x: 141.2, z1: -16, z2: 64 },
    { x: 141.2, z1: 80, z2: 208 },
    { x: 162.8, z1: -188, z2: 30 },
    { x: 162.8, z1: 50, z2: 208 }
  ].forEach((seg) => {
    const len = seg.z2 - seg.z1;
    const midZ = (seg.z1 + seg.z2) / 2;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.05, len), barrierMat);
    wall.position.set(seg.x, 0.58, midZ);
    wall.castShadow = true;
    worldRoot.add(wall);
    addWorldBox(seg.x - 0.32, seg.x + 0.32, 0.08, 1.15, seg.z1, seg.z2, 'fwy_barrier', true);
  });

  // City-to-Freeway Connector Roads at z = -24 and z = 72
  [-24, 72].forEach((cz) => {
    const conn = new THREE.Mesh(new THREE.BoxGeometry(24, 0.09, 12), asphaltEW);
    conn.position.set(132, 0.045, cz);
    conn.receiveShadow = true;
    worldRoot.add(conn);
  });

  // Elevated I-88 Overpass Bridge Deck (x = 152, z = 80..116, height y = 5.0m) with Driveable Ramps!
  const deckY = 5.0;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(20, 0.45, 36), fwyMat);
  deck.position.set(152, deckY - 0.225, 98);
  deck.castShadow = true;
  deck.receiveShadow = true;
  worldRoot.add(deck);
  addWorldBox(142, 162, deckY - 0.45, deckY, 80, 116, 'fwy_overpass', true);

  // Overpass Side Guardrails
  [142.3, 161.7].forEach((gx) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.95, 36), barrierMat);
    rail.position.set(gx, deckY + 0.47, 98);
    worldRoot.add(rail);
    addWorldBox(gx - 0.26, gx + 0.26, deckY, deckY + 0.95, 80, 116, 'fwy_rail', true);
  });

  // Support Pillars under Overpass
  [84, 112].forEach((pz) => {
    [143.5, 160.5].forEach((px) => {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, deckY - 0.4, 10), barrierMat);
      col.position.set(px, (deckY - 0.4) / 2, pz);
      worldRoot.add(col);
      addWorldBox(px - 0.85, px + 0.85, 0.08, deckY - 0.4, pz - 0.85, pz + 0.85, 'fwy_pillar', false);
    });
  });

  // North & South Sloped Overpass Ramps (Driveable!)
  const rampLen = 28;
  const rampAngle = Math.atan2(deckY - 0.08, rampLen);
  const rampHyp = Math.hypot(rampLen, deckY - 0.08);

  const northRamp = new THREE.Mesh(new THREE.BoxGeometry(20, 0.35, rampHyp), fwyMat);
  northRamp.position.set(152, (deckY + 0.08) / 2 - 0.15, 66);
  northRamp.rotation.x = -rampAngle;
  northRamp.receiveShadow = true;
  worldRoot.add(northRamp);
  addDriveableRamp({ minX: 142, maxX: 162, minZ: 52, maxZ: 80, startY: 0.08, endY: deckY, axis: 'z', dir: 1 });

  const southRamp = new THREE.Mesh(new THREE.BoxGeometry(20, 0.35, rampHyp), fwyMat);
  southRamp.position.set(152, (deckY + 0.08) / 2 - 0.15, 130);
  southRamp.rotation.x = rampAngle;
  southRamp.receiveShadow = true;
  worldRoot.add(southRamp);
  addDriveableRamp({ minX: 142, maxX: 162, minZ: 116, maxZ: 144, startY: deckY, endY: 0.08, axis: 'z', dir: 1 });

  // Freeway Overhead Green Highway Sign Gantry
  const gantryGroup = new THREE.Group();
  const postL = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 7.2, 8), makeMat(0xcbd5e1, { metalness: 0.85 }));
  postL.position.set(141.5, 3.6, 48);
  const postR = postL.clone();
  postR.position.x = 162.5;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(22, 0.35, 0.35), makeMat(0xcbd5e1, { metalness: 0.85 }));
  beam.position.set(152, 7.0, 48);
  createNeonSign(gantryGroup, 'I-88 NORTH • REDROCK DESERT EXIT ->', 152, 6.7, 47.7, '#065f46', '#f8fafc', 14.5, 1.65);
  gantryGroup.add(postL, postR, beam);
  worldRoot.add(gantryGroup);

  // Desert Highway Route 66 Spur into Redrock Desert (z = 40, x = 162 to 360)
  const desertHwy = new THREE.Mesh(new THREE.BoxGeometry(198, 0.09, 12), asphaltEW);
  desertHwy.position.set(261, 0.055, 40);
  desertHwy.receiveShadow = true;
  worldRoot.add(desertHwy);
  for (let x = 168; x <= 354; x += 7) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.10, 0.26), yellowMat);
    dash.position.set(x, 0.065, 40);
    worldRoot.add(dash);
  }

  // Map Visuals for I-88 Freeway & Redrock Desert
  mapShapes.push({ x: 152, z: 10, w: 22, d: 396, color: '#334155', border: '#f59e0b', enterable: false });
  mapShapes.push({ x: 280, z: 10, w: 220, d: 396, color: '#d97706', border: '#92400e', enterable: false });
  mapShapes.push({ x: 261, z: 40, w: 196, d: 12, color: '#334155', border: '#facc15', enterable: false });
}

export function buildRedrockDesertBiome() {
  const mesaMat = makeMat(0xb45309, { texType: 'redrock', repeatX: 6, repeatY: 3, roughness: 0.9, bumpScale: 0.03 });
  const mesaCapMat = makeMat(0xd97706, { texType: 'sand', repeatX: 4, repeatY: 4, roughness: 0.92 });
  const cactusMat = makeMat(0x15803d, { roughness: 0.85 });
  const boulderMat = makeMat(0x9a3412, { texType: 'redrock', repeatX: 2, repeatY: 2, roughness: 0.92 });

  // Flat-Topped Climbable Desert Mesas
  [
    { x: 215, z: -45, w: 26, d: 22, h: 7.5 },
    { x: 295, z: -85, w: 34, d: 28, h: 11.0 },
    { x: 225, z: 125, w: 28, d: 24, h: 8.5 },
    { x: 315, z: 115, w: 32, d: 26, h: 10.0 }
  ].forEach((m) => {
    const base = new THREE.Mesh(new THREE.BoxGeometry(m.w, m.h, m.d), mesaMat);
    base.position.set(m.x, m.h / 2, m.z);
    base.castShadow = true;
    base.receiveShadow = true;

    const tier2 = new THREE.Mesh(new THREE.BoxGeometry(m.w * 0.72, m.h * 0.55, m.d * 0.72), mesaCapMat);
    tier2.position.set(m.x, m.h + (m.h * 0.55) / 2, m.z);
    tier2.castShadow = true;

    worldRoot.add(base, tier2);
    addWorldBox(m.x - m.w / 2, m.x + m.w / 2, 0.02, m.h, m.z - m.d / 2, m.z + m.d / 2, 'mesa_low', true);
    addWorldBox(m.x - (m.w * 0.72) / 2, m.x + (m.w * 0.72) / 2, m.h, m.h * 1.55, m.z - (m.d * 0.72) / 2, m.z + (m.d * 0.72) / 2, 'mesa_top', true);
    mapShapes.push({ x: m.x, z: m.z, w: m.w, d: m.d, color: '#9a3412', border: '#7c2d12', enterable: false });
  });

  // Saguaro Cacti
  [
    [184, -18], [196, 18], [210, 62], [238, 16], [268, -28],
    [282, 64], [308, 12], [332, 68], [192, 92], [255, 148]
  ].forEach(([cx, cz], idx) => {
    const cGroup = new THREE.Group();
    const h = 2.6 + (idx % 3) * 0.55;
    cGroup.position.set(cx, 0.02, cz);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, h, 8), cactusMat);
    trunk.position.y = h / 2;
    trunk.castShadow = true;

    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.22, 0.22), cactusMat);
    armL.position.set(-0.35, h * 0.55, 0);
    const tipL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.75, 0.22), cactusMat);
    tipL.position.set(-0.56, h * 0.55 + 0.35, 0);

    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.22, 0.22), cactusMat);
    armR.position.set(0.35, h * 0.68, 0);
    const tipR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.65, 0.22), cactusMat);
    tipR.position.set(0.56, h * 0.68 + 0.30, 0);

    cGroup.add(trunk, armL, tipL, armR, tipR);
    worldRoot.add(cGroup);
    addWorldBox(cx - 0.35, cx + 0.35, 0.02, h, cz - 0.35, cz + 0.35, 'cactus', false);
  });

  // Desert Boulders
  [
    [188, 56], [244, -14], [274, 24], [322, -24], [265, 95]
  ].forEach(([bx, bz]) => {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.45, 0), boulderMat);
    rock.position.set(bx, 0.9, bz);
    rock.castShadow = true;
    worldRoot.add(rock);
    addWorldBox(bx - 1.2, bx + 1.2, 0.02, 2.0, bz - 1.2, bz + 1.2, 'boulder', true);
  });

  // Walk-In Redrock Desert Outpost & Fuel Station (x = 254, z = 84)
  buildWalkInHouse({
    x: 254, z: 84, w: 10.4, d: 8.6,
    wallColor: 0xfde68a, roofColor: 0x9a3412,
    label: 'REDROCK DESERT OUTPOST'
  });
}

export function buildSuburbanHouseBase({ x, z, w = 8.4, d = 7.4, h = 3.6, wallColor, roofColor, rotY = 0 }) {
  const group = new THREE.Group();
  group.position.set(x, 0.18, z);
  group.rotation.y = rotY;

  const wallThick = 0.28;
  const wallMat = makeMat(wallColor, { texType: 'siding', repeatX: 3, repeatY: 2, bumpScale: 0.015 });

  // Visible Interior Floor & Warm Interior Light Glow seen through real glass windows!
  const floor = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 0.08, d - 0.2), makeMat(0x92400e, { texType: 'wood' }));
  floor.position.y = 0.04;
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(w, h, wallThick), wallMat);
  backWall.position.set(0, h / 2, -d / 2 + wallThick / 2);
  backWall.castShadow = true;

  // Front Wall with Two Real Transparent Glass Windows & Door
  const frontWall = new THREE.Group();
  frontWall.position.set(0, 0, d / 2 - wallThick / 2);
  const fLeft = new THREE.Group();
  fLeft.position.x = -w * 0.28;
  buildWallWithRealWindow(fLeft, w * 0.38, h, wallThick, 1.45, 1.25, 1.9, wallMat);

  const fRight = new THREE.Group();
  fRight.position.x = w * 0.28;
  buildWallWithRealWindow(fRight, w * 0.38, h, wallThick, 1.45, 1.25, 1.9, wallMat);

  const centerCol = new THREE.Mesh(new THREE.BoxGeometry(w * 0.24, h, wallThick), wallMat);
  centerCol.position.y = h / 2;
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.14), makeMat(0x78350f, { texType: 'wood' }));
  door.position.set(0, 1.1, 0.1);
  frontWall.add(fLeft, fRight, centerCol, door);

  // Side Walls with Real Glass Windows
  const leftWall = new THREE.Group();
  leftWall.position.set(-w / 2 + wallThick / 2, 0, 0);
  leftWall.rotation.y = Math.PI / 2;
  buildWallWithRealWindow(leftWall, d - wallThick * 2, h, wallThick, 1.5, 1.25, 1.9, wallMat);

  const rightWall = new THREE.Group();
  rightWall.position.set(w / 2 - wallThick / 2, 0, 0);
  rightWall.rotation.y = -Math.PI / 2;
  buildWallWithRealWindow(rightWall, d - wallThick * 2, h, wallThick, 1.5, 1.25, 1.9, wallMat);

  // Interior Couch & Table visible through the real glass windows
  const inTable = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.65, 1.0), makeMat(0x78350f, { texType: 'wood' }));
  inTable.position.set(-1.6, 0.4, 1.2);
  const inSofa = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.72, 0.9), makeMat(0x334155, { texType: 'fabric' }));
  inSofa.position.set(1.6, 0.42, 0.8);

  group.add(floor, backWall, frontWall, leftWall, rightWall, inTable, inSofa);

  // Gable Roof
  const roofH = 2.2;
  const overhang = 0.55;
  const shape = new THREE.Shape();
  shape.moveTo(-(w / 2 + overhang), 0);
  shape.lineTo(w / 2 + overhang, 0);
  shape.lineTo(0, roofH);
  shape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: d + overhang * 2, bevelEnabled: false });
  roofGeo.translate(0, 0, -(d / 2 + overhang));
  const roof = new THREE.Mesh(
    roofGeo,
    makeMat(roofColor, { texType: 'shingles', repeatX: 4, repeatY: 4, bumpScale: 0.02 })
  );
  roof.position.y = h;
  roof.castShadow = true;
  group.add(roof);

  const awning = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 0.24, 1.8),
    makeMat(roofColor, { texType: 'shingles', repeatX: 2, repeatY: 1 })
  );
  awning.position.set(0, 2.25, d / 2 + 0.85);
  awning.castShadow = true;
  group.add(awning);

  // Proximity High-Detail LOD (Chimney & Window Shutters)
  const lodGroup = new THREE.Group();
  const chimney = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 2.2, 0.85),
    makeMat(0x9a3412, { texType: 'brick', repeatX: 1, repeatY: 2, bumpScale: 0.02 })
  );
  chimney.position.set(w * 0.28, h + 1.4, -d * 0.15);
  chimney.castShadow = true;
  lodGroup.add(chimney);

  const shutterMat = makeMat(roofColor);
  [-w * 0.28 - 0.9, -w * 0.28 + 0.9, w * 0.28 - 0.9, w * 0.28 + 0.9].forEach((sx) => {
    const sh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1.35, 0.1), shutterMat);
    sh.position.set(sx, 1.9, d / 2 + 0.06);
    lodGroup.add(sh);
  });
  group.add(lodGroup);
  registerBuildingLod(x, z, lodGroup);

  worldRoot.add(group);

  const cos = Math.abs(Math.cos(rotY));
  const sin = Math.abs(Math.sin(rotY));
  const worldW = w * cos + d * sin;
  const worldD = w * sin + d * cos;
  addWorldBox(x - worldW / 2, x + worldW / 2, 0.18, 0.18 + h, z - worldD / 2, z + worldD / 2, 'house_roof', true);

  const awWorldX = x + Math.sin(rotY) * (d / 2 + 0.85);
  const awWorldZ = z + Math.cos(rotY) * (d / 2 + 0.85);
  const awW = 3.4 * cos + 1.8 * sin;
  const awD = 3.4 * sin + 1.8 * cos;
  addWorldBox(awWorldX - awW / 2, awWorldX + awW / 2, 2.25, 2.48, awWorldZ - awD / 2, awWorldZ + awD / 2, 'porch_awning', true);

  mapShapes.push({
    x, z, w: worldW, d: worldD,
    color: '#' + new THREE.Color(wallColor).getHexString(),
    border: '#1e293b',
    enterable: false
  });
}

export function buildWalkInHouse({ x, z, w = 9.8, d = 8.6, h = 4.0, wallColor, roofColor, label }) {
  const group = new THREE.Group();
  group.position.set(x, 0.18, z);

  const wallThick = 0.36;
  const doorW = 2.6;
  const doorH = 2.85;
  const wallMat = makeMat(wallColor, { texType: 'siding', repeatX: 4, repeatY: 2, bumpScale: 0.015 });

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(w - 0.2, 0.08, d - 0.2),
    makeMat(0xb45309, { texType: 'wood', repeatX: 4, repeatY: 4, roughness: 0.55 })
  );
  floor.position.y = 0.04;
  floor.receiveShadow = true;
  group.add(floor);

  // Back Wall with Real Transparent Glass Window
  const backWallGroup = new THREE.Group();
  backWallGroup.position.set(0, 0, -d / 2 + wallThick / 2);
  buildWallWithRealWindow(backWallGroup, w, h, wallThick, 2.2, 1.35, 2.0, wallMat);
  group.add(backWallGroup);

  // Side Walls with Real Transparent Glass Windows
  const leftWallGroup = new THREE.Group();
  leftWallGroup.position.set(-w / 2 + wallThick / 2, 0, 0);
  leftWallGroup.rotation.y = Math.PI / 2;
  buildWallWithRealWindow(leftWallGroup, d - wallThick * 2, h, wallThick, 1.8, 1.35, 2.0, wallMat);

  const rightWallGroup = new THREE.Group();
  rightWallGroup.position.set(w / 2 - wallThick / 2, 0, 0);
  rightWallGroup.rotation.y = -Math.PI / 2;
  buildWallWithRealWindow(rightWallGroup, d - wallThick * 2, h, wallThick, 1.8, 1.35, 2.0, wallMat);
  group.add(leftWallGroup, rightWallGroup);

  // Front Wall with Open Doorway (+Z) & Real Front Windows
  const segW = (w - doorW) / 2;
  const frontL = new THREE.Group();
  frontL.position.set(-(doorW / 2 + segW / 2), 0, d / 2 - wallThick / 2);
  buildWallWithRealWindow(frontL, segW, h, wallThick, 1.45, 1.3, 2.0, wallMat);

  const frontR = new THREE.Group();
  frontR.position.set(doorW / 2 + segW / 2, 0, d / 2 - wallThick / 2);
  buildWallWithRealWindow(frontR, segW, h, wallThick, 1.45, 1.3, 2.0, wallMat);

  const headerH = h - doorH;
  const header = new THREE.Mesh(new THREE.BoxGeometry(doorW, headerH, wallThick), wallMat);
  header.position.set(0, doorH + headerH / 2, d / 2 - wallThick / 2);

  const trimMat = makeMat(0x78350f, { texType: 'wood' });
  const trimL = new THREE.Mesh(new THREE.BoxGeometry(0.14, doorH, wallThick + 0.08), trimMat);
  trimL.position.set(-doorW / 2, doorH / 2, d / 2 - wallThick / 2);
  const trimR = trimL.clone();
  trimR.position.x = doorW / 2;
  group.add(frontL, frontR, header, trimL, trimR);

  // Roof
  const roofH = 2.3;
  const overhang = 0.55;
  const shape = new THREE.Shape();
  shape.moveTo(-(w / 2 + overhang), 0);
  shape.lineTo(w / 2 + overhang, 0);
  shape.lineTo(0, roofH);
  shape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: d + overhang * 2, bevelEnabled: false });
  roofGeo.translate(0, 0, -(d / 2 + overhang));
  const roof = new THREE.Mesh(
    roofGeo,
    makeMat(roofColor, { texType: 'shingles', repeatX: 4, repeatY: 4, bumpScale: 0.02 })
  );
  roof.position.y = h;
  roof.castShadow = true;
  group.add(roof);

  // Interior Furniture
  const sofa = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.72, 2.5),
    makeMat(0x334155, { texType: 'fabric', repeatX: 2, repeatY: 4, roughness: 0.95 })
  );
  sofa.position.set(-w / 2 + 1.0, 0.42, -0.2);
  addWorldBox(x - w / 2 + 0.45, x - w / 2 + 1.55, 0.18, 0.90, z - 1.45, z + 1.05, 'sofa', true);

  const table = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.62, 1.6), makeMat(0x78350f, { texType: 'wood' }));
  table.position.set(-1.5, 0.38, -0.2);
  addWorldBox(x - 2.05, x - 0.95, 0.18, 0.80, z - 1.0, z + 0.6, 'table', true);

  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.94, 1.1), makeMat(0xe2e8f0, { texType: 'siding' }));
  counter.position.set(w / 2 - 1.9, 0.54, -d / 2 + 1.0);
  const graniteTop = new THREE.Mesh(
    new THREE.BoxGeometry(2.9, 0.09, 1.18),
    makeMat(0x334155, { texType: 'granite', repeatX: 3, repeatY: 1, roughness: 0.16, clearcoat: 0.9, flatShading: false })
  );
  graniteTop.position.set(w / 2 - 1.9, 1.05, -d / 2 + 1.0);
  const steelFridge = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 2.05, 0.95),
    makeMat(0xdbeafe, { texType: 'brushedsteel', repeatX: 1, repeatY: 2, metalness: 0.9, roughness: 0.22, flatShading: false })
  );
  steelFridge.position.set(w / 2 - 0.9, 1.1, -d / 2 + 2.3);
  addWorldBox(x + w / 2 - 3.3, x + w / 2 - 0.5, 0.18, 1.20, z - d / 2 + 0.45, z - d / 2 + 1.55, 'counter', true);
  addWorldBox(x + w / 2 - 1.4, x + w / 2 - 0.4, 0.18, 2.25, z - d / 2 + 1.8, z - d / 2 + 2.8, 'fridge', true);

  const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.55, 1.4), makeMat(0x92400e, { texType: 'wood' }));
  bedFrame.position.set(-w / 2 + 1.45, 0.35, -d / 2 + 1.15);
  const mattress = new THREE.Mesh(
    new THREE.BoxGeometry(1.88, 0.22, 1.28),
    makeMat(0xf8fafc, { texType: 'fabric', repeatX: 2, repeatY: 2, roughness: 0.95 })
  );
  mattress.position.set(-w / 2 + 1.45, 0.68, -d / 2 + 1.15);
  addWorldBox(x - w / 2 + 0.45, x - w / 2 + 2.45, 0.18, 0.95, z - d / 2 + 0.45, z - d / 2 + 1.85, 'bed', true);

  const rug = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 0.03, 2.5),
    makeMat(0x0284c7, { texType: 'fabric', repeatX: 4, repeatY: 3, roughness: 0.96 })
  );
  rug.position.set(-1.5, 0.09, -0.2);

  const indoorLod = new THREE.Group();
  const lampStand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.14, 1.5, 8), makeMat(0xfbbf24, { metalness: 0.85 }));
  lampStand.position.set(-w / 2 + 0.9, 0.85, d / 2 - 1.2);
  const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.32, 10), makeMat(0xfef08a, { emissive: 0xfacc15, emissiveIntensity: 0.6 }));
  lampShade.position.set(-w / 2 + 0.9, 1.65, d / 2 - 1.2);
  indoorLod.add(lampStand, lampShade);
  group.add(indoorLod);
  registerBuildingLod(x, z, indoorLod);

  group.add(sofa, table, counter, graniteTop, steelFridge, bedFrame, mattress, rug);
  worldRoot.add(group);

  const minX = x - w / 2;
  const maxX = x + w / 2;
  const minZ = z - d / 2;
  const maxZ = z + d / 2;
  addWorldBox(minX, maxX, 0.18, 0.18 + h, minZ, minZ + wallThick, 'wall', false);
  addWorldBox(minX, minX + wallThick, 0.18, 0.18 + h, minZ, maxZ, 'wall', false);
  addWorldBox(maxX - wallThick, maxX, 0.18, 0.18 + h, minZ, maxZ, 'wall', false);
  addWorldBox(minX, x - doorW / 2, 0.18, 0.18 + h, maxZ - wallThick, maxZ, 'wall', false);
  addWorldBox(x + doorW / 2, maxX, 0.18, 0.18 + h, maxZ - wallThick, maxZ, 'wall', false);
  addWorldBox(minX, maxX, 0.18 + h - 0.2, 0.18 + h, minZ, maxZ, 'roof', true);

  enterableZones.push({ minX: minX + 0.3, maxX: maxX - 0.3, minZ: minZ + 0.3, maxZ: maxZ - 0.2, name: label });
  mapShapes.push({
    x, z, w, d,
    color: '#' + new THREE.Color(wallColor).getHexString(),
    border: '#f59e0b',
    enterable: true
  });
}

export function buildHotdogStore(x, z) {
  const w = 11.4;
  const d = 9.6;
  const h = 4.2;
  const wallThick = 0.36;
  const doorW = 2.8;
  const doorH = 2.9;

  const group = new THREE.Group();
  group.position.set(x, 0.18, z);

  const wallMat = makeMat(0xfef08a, { texType: 'siding', repeatX: 4, repeatY: 2 });
  const redTrimMat = makeMat(0xdc2626, { roughness: 0.45 });
  const floorMat = makeMat(0xf8fafc, { texType: 'cobblestone', repeatX: 6, repeatY: 6, roughness: 0.5 });

  const floor = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 0.08, d - 0.2), floorMat);
  floor.position.y = 0.04;
  floor.receiveShadow = true;

  const backW = new THREE.Mesh(new THREE.BoxGeometry(w, h, wallThick), wallMat);
  backW.position.set(0, h / 2, -d / 2 + wallThick / 2);
  backW.castShadow = true;

  // Left & Right Walls with Real Glass Windows
  const leftW = new THREE.Group();
  leftW.position.set(-w / 2 + wallThick / 2, 0, 0);
  leftW.rotation.y = Math.PI / 2;
  buildWallWithRealWindow(leftW, d - wallThick * 2, h, wallThick, 2.2, 1.4, 2.0, wallMat);

  const rightW = new THREE.Group();
  rightW.position.set(w / 2 - wallThick / 2, 0, 0);
  rightW.rotation.y = -Math.PI / 2;
  buildWallWithRealWindow(rightW, d - wallThick * 2, h, wallThick, 2.2, 1.4, 2.0, wallMat);

  // Front Storefront with Real Transparent Glass Display Windows
  const segW = (w - doorW) / 2;
  const frontL = new THREE.Group();
  frontL.position.set(-(doorW / 2 + segW / 2), 0, d / 2 - wallThick / 2);
  buildWallWithRealWindow(frontL, segW, h, wallThick, segW - 0.9, 1.85, 1.65, wallMat);

  const frontR = new THREE.Group();
  frontR.position.set(doorW / 2 + segW / 2, 0, d / 2 - wallThick / 2);
  buildWallWithRealWindow(frontR, segW, h, wallThick, segW - 0.9, 1.85, 1.65, wallMat);

  const header = new THREE.Mesh(new THREE.BoxGeometry(doorW, h - doorH, wallThick), wallMat);
  header.position.set(0, doorH + (h - doorH) / 2, d / 2 - wallThick / 2);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.36, d + 0.6), redTrimMat);
  roof.position.y = h + 0.18;
  roof.castShadow = true;

  // Giant 3D Rooftop Hotdog Mascot
  const mascotGroup = new THREE.Group();
  mascotGroup.position.set(0, h + 1.15, 0.5);
  const bunMat = makeMat(0xd97706, { roughness: 0.6 });
  const bunL = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 2.6, 6, 10), bunMat);
  bunL.rotation.z = Math.PI / 2;
  bunL.position.set(0, 0, 0.24);
  const bunR = bunL.clone();
  bunR.position.z = -0.24;
  const wiener = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 3.1, 6, 10), makeMat(0xb91c1c, { roughness: 0.35 }));
  wiener.rotation.z = Math.PI / 2;
  wiener.position.y = 0.12;
  const mustard = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.08, 0.12), makeMat(0xfacc15));
  mustard.position.set(0, 0.48, 0);
  mascotGroup.add(bunL, bunR, wiener, mustard);

  createNeonSign(group, 'AURA HOTDOGS', 0, 3.55, d / 2 + 0.08, '#991b1b', '#fef08a', 5.2, 1.05);

  // Front Service Counter + Back Prep Counter & Sausage Refill Vat
  const frontCounter = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.0, 1.0), redTrimMat);
  frontCounter.position.set(-2.4, 0.55, -0.5);
  const frontTop = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.1, 1.1), makeMat(0xf8fafc, { metalness: 0.7 }));
  frontTop.position.set(-2.4, 1.08, -0.5);

  const backCounter = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.96, 1.1), makeMat(0x334155, { texType: 'brushedsteel', metalness: 0.85 }));
  backCounter.position.set(0, 0.54, -d / 2 + 1.15);

  const refillVat = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.44, 0.65, 14), makeMat(0xe2e8f0, { metalness: 0.92, roughness: 0.18 }));
  refillVat.position.set(2.4, 1.32, -d / 2 + 1.15);
  const vatWater = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 14), makeMat(0xf97316, { emissive: 0xea580c, emissiveIntensity: 0.55 }));
  vatWater.position.set(2.4, 1.63, -d / 2 + 1.15);
  createNeonSign(group, 'SAUSAGE REFILL VAT [E]', 2.4, 2.35, -d / 2 + 0.45, '#7f1d1d', '#fef08a', 3.4, 0.62);

  const indoorPadRing = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.15, 22),
    new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide })
  );
  indoorPadRing.rotation.x = -Math.PI / 2;
  indoorPadRing.position.set(2.4, 0.10, -2.2);

  group.add(floor, backW, leftW, rightW, frontL, frontR, header, roof, mascotGroup, frontCounter, frontTop, backCounter, refillVat, vatWater, indoorPadRing);
  worldRoot.add(group);

  const minX = x - w / 2;
  const maxX = x + w / 2;
  const minZ = z - d / 2;
  const maxZ = z + d / 2;
  addWorldBox(minX, maxX, 0.18, 0.18 + h, minZ, minZ + wallThick, 'wall', false);
  addWorldBox(minX, minX + wallThick, 0.18, 0.18 + h, minZ, maxZ, 'wall', false);
  addWorldBox(maxX - wallThick, maxX, 0.18, 0.18 + h, minZ, maxZ, 'wall', false);
  addWorldBox(minX, x - doorW / 2, 0.18, 0.18 + h, maxZ - wallThick, maxZ, 'wall', false);
  addWorldBox(x + doorW / 2, maxX, 0.18, 0.18 + h, maxZ - wallThick, maxZ, 'wall', false);
  addWorldBox(minX, maxX, 0.18 + h - 0.1, 0.18 + h + 0.36, minZ, maxZ, 'roof', true);
  addWorldBox(x - 4.6, x - 0.2, 0.18, 1.25, z - 1.05, z + 0.05, 'hd_counter', true);
  addWorldBox(x - 3.4, x + 3.4, 0.18, 1.25, minZ + 0.6, minZ + 1.75, 'hd_back_counter', true);

  sausageRefillZones.push({ x: x + 2.4, y: 0.18, z: z - 2.2, label: 'AURA HOTDOGS SAUSAGE VAT' });
  enterableZones.push({ minX: minX + 0.3, maxX: maxX - 0.3, minZ: minZ + 0.3, maxZ: maxZ - 0.2, name: 'AURA HOTDOGS STORE' });
  mapShapes.push({ x, z, w, d, color: '#ef4444', border: '#facc15', enterable: true });
}

export function buildPlazaHotdogCart(x, z) {
  const cart = new THREE.Group();
  cart.position.set(x, 0.18, z);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 1.05, 1.15),
    makeMat(0xdc2626, { texType: 'corrugated', metalness: 0.65, roughness: 0.28 })
  );
  body.position.y = 0.62;
  body.castShadow = true;

  const topCounter = new THREE.Mesh(
    new THREE.BoxGeometry(2.22, 0.10, 1.25),
    makeMat(0xf8fafc, { texType: 'brushedsteel', metalness: 0.9, roughness: 0.2, flatShading: false })
  );
  topCounter.position.y = 1.18;

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.65, 8), makeMat(0xe2e8f0, { metalness: 0.9 }));
  pole.position.set(0, 1.95, 0);

  const umbrella = new THREE.Mesh(
    new THREE.ConeGeometry(1.55, 0.65, 8),
    makeMat(0xfacc15, { roughness: 0.5 })
  );
  umbrella.position.set(0, 2.75, 0);
  umbrella.castShadow = true;

  const miniDog = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.65, 6, 8), makeMat(0xb91c1c));
  miniDog.rotation.z = Math.PI / 2;
  miniDog.position.set(0, 1.34, 0.1);

  const refillRing = new THREE.Mesh(
    new THREE.RingGeometry(1.15, 1.45, 24),
    new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide })
  );
  refillRing.rotation.x = -Math.PI / 2;
  refillRing.position.y = 0.05;

  createNeonSign(cart, 'SAUSAGE REFILL [E]', 0, 2.15, 0.65, '#7f1d1d', '#fef08a', 2.2, 0.44);
  cart.add(body, topCounter, pole, umbrella, miniDog, refillRing);
  worldRoot.add(cart);

  addWorldBox(x - 1.1, x + 1.1, 0.18, 1.42, z - 0.62, z + 0.62, 'hotdog_cart', true);
  sausageRefillZones.push({ x, y: 0.18, z: z + 1.2, label: 'PLAZA HOTDOG CART' });
}

export function buildCarDealership(x, z) {
  const w = 15.6;
  const d = 12.6;
  const h = 4.8;
  const wallThick = 0.38;
  const doorW = 4.8;
  const doorH = 3.5;

  const group = new THREE.Group();
  group.position.set(x, 0.18, z);

  const marbleFloor = new THREE.Mesh(
    new THREE.BoxGeometry(w - 0.2, 0.08, d - 0.2),
    makeMat(0xf8fafc, { texType: 'marble', repeatX: 6, repeatY: 5, roughness: 0.16, clearcoat: 0.9, flatShading: false })
  );
  marbleFloor.position.y = 0.04;
  marbleFloor.receiveShadow = true;

  const wallMat = makeMat(0x1e293b, { texType: 'concrete', repeatX: 5, repeatY: 2, roughness: 0.45 });
  const trimMat = makeMat(0xf59e0b, { metalness: 0.85, roughness: 0.2 });

  const backW = new THREE.Mesh(new THREE.BoxGeometry(w, h, wallThick), wallMat);
  backW.position.set(0, h / 2, -d / 2 + wallThick / 2);
  backW.castShadow = true;

  // Large Real Transparent Showroom Windows on Left, Right, and Front
  const leftW = new THREE.Group();
  leftW.position.set(-w / 2 + wallThick / 2, 0, 0);
  leftW.rotation.y = Math.PI / 2;
  buildWallWithRealWindow(leftW, d - wallThick * 2, h, wallThick, d - 3.2, 2.75, 1.95, wallMat, false);

  const rightW = new THREE.Group();
  rightW.position.set(w / 2 - wallThick / 2, 0, 0);
  rightW.rotation.y = -Math.PI / 2;
  buildWallWithRealWindow(rightW, d - wallThick * 2, h, wallThick, d - 3.2, 2.75, 1.95, wallMat, false);

  const segW = (w - doorW) / 2;
  const frontL = new THREE.Group();
  frontL.position.set(-(doorW / 2 + segW / 2), 0, d / 2 - wallThick / 2);
  buildWallWithRealWindow(frontL, segW, h, wallThick, segW - 1.0, 2.75, 1.95, wallMat, false);

  const frontR = new THREE.Group();
  frontR.position.set(doorW / 2 + segW / 2, 0, d / 2 - wallThick / 2);
  buildWallWithRealWindow(frontR, segW, h, wallThick, segW - 1.0, 2.75, 1.95, wallMat, false);

  const header = new THREE.Mesh(new THREE.BoxGeometry(doorW, h - doorH, wallThick), wallMat);
  header.position.set(0, doorH + (h - doorH) / 2, d / 2 - wallThick / 2);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.38, d + 0.8), wallMat);
  roof.position.y = h + 0.19;
  roof.castShadow = true;

  const fascia = new THREE.Mesh(new THREE.BoxGeometry(w + 0.9, 0.28, d + 0.9), trimMat);
  fascia.position.y = h + 0.04;

  // Showroom Turntable Display Ring
  const turntableRing = new THREE.Mesh(
    new THREE.RingGeometry(2.5, 2.85, 32),
    new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide })
  );
  turntableRing.rotation.x = -Math.PI / 2;
  turntableRing.position.set(0, 0.10, -0.4);

  // Sales Desk inside Dealership
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.95, 0.95), makeMat(0x0f172a));
  desk.position.set(-5.6, 0.52, -4.4);
  const deskTop = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.08, 1.05), trimMat);
  deskTop.position.set(-5.6, 1.02, -4.4);

  createNeonSign(group, 'AURA EXOTIC MOTORS', 0, 4.15, d / 2 + 0.12, '#090d14', '#f59e0b', 8.2, 1.15);

  group.add(marbleFloor, backW, leftW, rightW, frontL, frontR, header, roof, fascia, turntableRing, desk, deskTop);
  worldRoot.add(group);

  const minX = x - w / 2;
  const maxX = x + w / 2;
  const minZ = z - d / 2;
  const maxZ = z + d / 2;
  addWorldBox(minX, maxX, 0.18, 0.18 + h, minZ, minZ + wallThick, 'wall', false);
  addWorldBox(minX, minX + wallThick, 0.18, 0.18 + h, minZ, maxZ, 'wall', false);
  addWorldBox(maxX - wallThick, maxX, 0.18, 0.18 + h, minZ, maxZ, 'wall', false);
  addWorldBox(minX, x - doorW / 2, 0.18, 0.18 + h, maxZ - wallThick, maxZ, 'wall', false);
  addWorldBox(x + doorW / 2, maxX, 0.18, 0.18 + h, maxZ - wallThick, maxZ, 'wall', false);
  addWorldBox(minX, maxX, 0.18 + h - 0.1, 0.18 + h + 0.38, minZ, maxZ, 'roof', true);
  addWorldBox(x - 6.85, x - 4.35, 0.18, 1.18, z - 4.9, z - 3.9, 'dealer_desk', true);

  enterableZones.push({ minX: minX + 0.3, maxX: maxX - 0.3, minZ: minZ + 0.3, maxZ: maxZ - 0.2, name: 'AURA EXOTIC MOTORS' });
  mapShapes.push({ x, z, w, d, color: '#1e293b', border: '#f59e0b', enterable: true });
}

export function buildReserveBank(x, z) {
  const w = 16.4;
  const d = 13.6;
  const h = 6.2;
  const wallThick = 0.45;
  const doorW = 3.2;
  const doorH = 3.4;

  const group = new THREE.Group();
  group.position.set(x, 0.18, z);

  const marbleMat = makeMat(0xf8fafc, { texType: 'marble', repeatX: 5, repeatY: 3, roughness: 0.22, clearcoat: 0.85, flatShading: false });
  const graniteMat = makeMat(0x1e293b, { texType: 'granite', repeatX: 4, repeatY: 2, roughness: 0.25, flatShading: false });
  const goldMat = makeMat(0xfbbf24, { metalness: 0.94, roughness: 0.15, clearcoat: 0.9, flatShading: false });
  const vaultSteelMat = makeMat(0x94a3b8, { texType: 'brushedsteel', metalness: 0.94, roughness: 0.18, flatShading: false });

  const floor = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 0.10, d - 0.2), marbleMat);
  floor.position.y = 0.05;
  floor.receiveShadow = true;

  const backW = new THREE.Mesh(new THREE.BoxGeometry(w, h, wallThick), marbleMat);
  backW.position.set(0, h / 2, -d / 2 + wallThick / 2);
  backW.castShadow = true;

  // Side Walls with Real Transparent Bank Windows
  const leftW = new THREE.Group();
  leftW.position.set(-w / 2 + wallThick / 2, 0, 0);
  leftW.rotation.y = Math.PI / 2;
  buildWallWithRealWindow(leftW, d - wallThick * 2, h, wallThick, 3.4, 2.2, 2.6, marbleMat);

  const rightW = new THREE.Group();
  rightW.position.set(w / 2 - wallThick / 2, 0, 0);
  rightW.rotation.y = -Math.PI / 2;
  buildWallWithRealWindow(rightW, d - wallThick * 2, h, wallThick, 3.4, 2.2, 2.6, marbleMat);

  // Front Wall with Open Entrance & Real Glass Windows
  const segW = (w - doorW) / 2;
  const frontL = new THREE.Group();
  frontL.position.set(-(doorW / 2 + segW / 2), 0, d / 2 - wallThick / 2);
  buildWallWithRealWindow(frontL, segW, h, wallThick, 2.8, 2.2, 2.6, marbleMat);

  const frontR = new THREE.Group();
  frontR.position.set(doorW / 2 + segW / 2, 0, d / 2 - wallThick / 2);
  buildWallWithRealWindow(frontR, segW, h, wallThick, 2.8, 2.2, 2.6, marbleMat);

  const header = new THREE.Mesh(new THREE.BoxGeometry(doorW, h - doorH, wallThick), marbleMat);
  header.position.set(0, doorH + (h - doorH) / 2, d / 2 - wallThick / 2);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 1.2, 0.48, d + 1.6), marbleMat);
  roof.position.y = h + 0.24;
  roof.castShadow = true;

  const cornice = new THREE.Mesh(new THREE.BoxGeometry(w + 1.5, 0.35, d + 1.9), goldMat);
  cornice.position.y = h + 0.62;

  [-6.6, -2.6, 2.6, 6.6].forEach((cx) => {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, h, 14), marbleMat);
    col.position.set(cx, h / 2, d / 2 + 0.65);
    col.castShadow = true;
    group.add(col);
  });

  createNeonSign(group, 'SUNNYVALE RESERVE BANK', 0, 5.1, d / 2 + 0.92, '#0f172a', '#fbbf24', 8.4, 1.15);

  const tellerBase = new THREE.Mesh(new THREE.BoxGeometry(7.2, 1.05, 1.1), marbleMat);
  tellerBase.position.set(-3.2, 0.58, -1.2);
  const tellerTop = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.12, 1.25), graniteMat);
  tellerTop.position.set(-3.2, 1.15, -1.2);
  const tellerGlass = new THREE.Mesh(new THREE.BoxGeometry(6.8, 1.1, 0.08), realWindowGlassMat);
  tellerGlass.position.set(-3.2, 1.75, -1.2);

  const vaultBack = new THREE.Mesh(new THREE.BoxGeometry(5.6, 3.6, 0.4), vaultSteelMat);
  vaultBack.position.set(4.8, 1.85, -d / 2 + 0.6);
  const vaultLeft = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.6, 4.4), vaultSteelMat);
  vaultLeft.position.set(2.2, 1.85, -d / 2 + 2.6);
  const vaultDoor = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 0.35, 20), vaultSteelMat);
  vaultDoor.rotation.x = Math.PI / 2;
  vaultDoor.rotation.z = 0.7;
  vaultDoor.position.set(1.35, 1.75, -d / 2 + 4.8);
  const vaultWheel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 16), goldMat);
  vaultWheel.position.set(1.35, 1.75, -d / 2 + 5.0);

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.22), goldMat);
      bar.position.set(4.2 + col * 0.52, 0.24 + row * 0.19, -d / 2 + 1.5);
      group.add(bar);
    }
  }

  group.add(floor, backW, leftW, rightW, frontL, frontR, header, roof, cornice, tellerBase, tellerTop, tellerGlass, vaultBack, vaultLeft, vaultDoor, vaultWheel);
  worldRoot.add(group);

  const minX = x - w / 2;
  const maxX = x + w / 2;
  const minZ = z - d / 2;
  const maxZ = z + d / 2;
  addWorldBox(minX, maxX, 0.18, 0.18 + h, minZ, minZ + wallThick, 'wall', false);
  addWorldBox(minX, minX + wallThick, 0.18, 0.18 + h, minZ, maxZ, 'wall', false);
  addWorldBox(maxX - wallThick, maxX, 0.18, 0.18 + h, minZ, maxZ, 'wall', false);
  addWorldBox(minX, x - doorW / 2, 0.18, 0.18 + h, maxZ - wallThick, maxZ, 'wall', false);
  addWorldBox(x + doorW / 2, maxX, 0.18, 0.18 + h, maxZ - wallThick, maxZ, 'wall', false);
  addWorldBox(minX, maxX, 0.18 + h - 0.2, 0.18 + h + 0.48, minZ, maxZ, 'roof', true);
  addWorldBox(x - 6.8, x + 0.4, 0.18, 1.4, z - 1.8, z - 0.6, 'bank_counter', true);
  addWorldBox(x + 2.0, x + 2.4, 0.18, 3.8, minZ + 0.4, minZ + 4.8, 'vault_wall', false);

  enterableZones.push({ minX: minX + 0.3, maxX: maxX - 0.3, minZ: minZ + 0.3, maxZ: maxZ - 0.2, name: 'SUNNYVALE RESERVE BANK' });
  mapShapes.push({ x, z, w, d, color: '#f8fafc', border: '#f59e0b', enterable: true });
}

export function buildSkyscraperBase({ x, z, w = 13.5, d = 13.5, h = 44, glassHex = 0x0ea5e9, frameHex = 0x1e293b, name = 'AURA TOWER', hasHelipad = true }) {
  const group = new THREE.Group();
  group.position.set(x, 0.18, z);

  const lobbyH = 4.6;
  const upperH = h - lobbyH;
  const wallThick = 0.48;
  const doorW = 3.2;

  const frameMat = makeMat(frameHex, { texType: 'brushedsteel', repeatX: 4, repeatY: 12, metalness: 0.88, roughness: 0.24, flatShading: false });
  const glassMat = makeMat(glassHex, {
    metalness: 0.90,
    roughness: 0.10,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    envMapIntensity: 2.1,
    emissive: glassHex,
    emissiveIntensity: 0.14,
    flatShading: false
  });

  // Ground-Floor Walk-In Lobby Shell with Real Transparent Windows
  const lobbyFloor = new THREE.Mesh(
    new THREE.BoxGeometry(w - 0.2, 0.08, d - 0.2),
    makeMat(0xf8fafc, { texType: 'marble', repeatX: 5, repeatY: 5, roughness: 0.18, clearcoat: 0.85, flatShading: false })
  );
  lobbyFloor.position.y = 0.04;

  const backW = new THREE.Mesh(new THREE.BoxGeometry(w, lobbyH, wallThick), frameMat);
  backW.position.set(0, lobbyH / 2, -d / 2 + wallThick / 2);

  const leftW = new THREE.Group();
  leftW.position.set(-w / 2 + wallThick / 2, 0, 0);
  leftW.rotation.y = Math.PI / 2;
  buildWallWithRealWindow(leftW, d - wallThick * 2, lobbyH, wallThick, d - 3.0, 2.7, 2.0, frameMat, false);

  const rightW = new THREE.Group();
  rightW.position.set(w / 2 - wallThick / 2, 0, 0);
  rightW.rotation.y = -Math.PI / 2;
  buildWallWithRealWindow(rightW, d - wallThick * 2, lobbyH, wallThick, d - 3.0, 2.7, 2.0, frameMat, false);

  const segW = (w - doorW) / 2;
  const frontL = new THREE.Group();
  frontL.position.set(-(doorW / 2 + segW / 2), 0, d / 2 - wallThick / 2);
  buildWallWithRealWindow(frontL, segW, lobbyH, wallThick, segW - 0.9, 2.7, 2.0, frameMat, false);

  const frontR = new THREE.Group();
  frontR.position.set(doorW / 2 + segW / 2, 0, d / 2 - wallThick / 2);
  buildWallWithRealWindow(frontR, segW, h > 30 ? lobbyH : lobbyH, wallThick, segW - 0.9, 2.7, 2.0, frameMat, false);

  const header = new THREE.Mesh(new THREE.BoxGeometry(doorW, 1.3, wallThick), frameMat);
  header.position.set(0, 3.3 + 0.65, d / 2 - wallThick / 2);

  // Upper Tower Curtain Wall
  const towerBody = new THREE.Mesh(new THREE.BoxGeometry(w, upperH, d), glassMat);
  towerBody.position.y = lobbyH + upperH / 2;
  towerBody.castShadow = true;
  towerBody.receiveShadow = true;

  const roofCap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.55, d + 0.5), frameMat);
  roofCap.position.y = h + 0.275;

  const lodGroup = new THREE.Group();
  const bandStep = 6.0;
  for (let y = lobbyH + bandStep; y < h; y += bandStep) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, 0.26, d + 0.16), frameMat);
    band.position.y = y;
    lodGroup.add(band);
  }
  [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].forEach(([cx, cz]) => {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.32, h, 0.32), frameMat);
    fin.position.set(cx, h / 2, cz);
    lodGroup.add(fin);
  });
  group.add(lodGroup);
  registerBuildingLod(x, z, lodGroup);

  if (hasHelipad) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.12, 20), makeMat(0x334155));
    pad.position.y = h + 0.60;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.5, 3.95, 24),
      new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = h + 0.67;
    const hBarL = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, 2.6), makeMat(0xf8fafc));
    hBarL.position.set(-0.9, h + 0.68, 0);
    const hBarR = hBarL.clone();
    hBarR.position.x = 0.9;
    const hCross = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.45), makeMat(0xf8fafc));
    hCross.position.set(0, h + 0.68, 0);
    group.add(pad, ring, hBarL, hBarR, hCross);
  } else {
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.35, 9.5, 8), frameMat);
    spire.position.y = h + 5.2;
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xef4444 })
    );
    beacon.position.y = h + 10.0;
    aviationBeacons.push(beacon);
    group.add(spire, beacon);
  }

  const roofLiftPad = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.15, 20),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide })
  );
  roofLiftPad.rotation.x = -Math.PI / 2;
  roofLiftPad.position.set(0, h + 0.58, d / 2 - 1.8);
  group.add(roofLiftPad);

  createNeonSign(group, name, 0, 3.9, d / 2 + 0.1, '#090d14', '#38bdf8', Math.min(w - 2, 7.6), 0.95);

  group.add(lobbyFloor, backW, leftW, rightW, frontL, frontR, header, towerBody, roofCap);
  worldRoot.add(group);

  const minX = x - w / 2;
  const maxX = x + w / 2;
  const minZ = z - d / 2;
  const maxZ = z + d / 2;
  addWorldBox(minX, maxX, 0.18, 0.18 + lobbyH, minZ, minZ + wallThick, 'wall', false);
  addWorldBox(minX, minX + wallThick, 0.18, 0.18 + lobbyH, minZ, maxZ, 'wall', false);
  addWorldBox(maxX - wallThick, maxX, 0.18, 0.18 + lobbyH, minZ, maxZ, 'wall', false);
  addWorldBox(minX, x - doorW / 2, 0.18, 0.18 + lobbyH, maxZ - wallThick, maxZ, 'wall', false);
  addWorldBox(x + doorW / 2, maxX, 0.18, 0.18 + lobbyH, maxZ - wallThick, maxZ, 'wall', false);
  addWorldBox(minX, maxX, 0.18 + lobbyH, 0.18 + h + 0.55, minZ, maxZ, 'skyscraper_roof', true);

  const roofY = 0.18 + h + 0.55;
  skyscrapers.push({
    x, z, w, d, h, roofY, name,
    minX, maxX, minZ, maxZ,
    lobbyPad: { x, y: 0.18, z: z - d / 2 + 2.0 },
    roofPad: { x, y: roofY, z: z + d / 2 - 1.8 },
    interiorLoaded: false,
    interiorGroup: null,
    interiorBoxes: []
  });

  enterableZones.push({ minX: minX + 0.3, maxX: maxX - 0.3, minZ: minZ + 0.3, maxZ: maxZ - 0.2, name: `${name} LOBBY` });
  mapShapes.push({ x, z, w, d, color: '#0284c7', border: '#38bdf8', enterable: true });
}

// Lazy-load / unload Skyscraper Lobby Interiors based on distance
export function updateSkyscraperInteriors() {
  const LOAD_DIST = 56;
  const UNLOAD_DIST = 70;

  for (let i = 0; i < skyscrapers.length; i++) {
    const sk = skyscrapers[i];
    const dist = Math.hypot(sk.x - player.x, sk.z - player.z);

    if (!sk.interiorLoaded && dist < LOAD_DIST) {
      let ig = sk.interiorCache;
      if (!ig) {
      ig = new THREE.Group();
      ig.position.set(sk.x, 0.18, sk.z);

      const deskMat = makeMat(0x0f172a);
      const goldTrim = makeMat(0xf59e0b, { metalness: 0.85, roughness: 0.2 });
      const couchMat = makeMat(0x334155, { texType: 'fabric', roughness: 0.9 });
      const steelMat = makeMat(0xdbeafe, { texType: 'brushedsteel', metalness: 0.9, roughness: 0.2, flatShading: false });

      const desk = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.05, 1.2), deskMat);
      desk.position.set(-2.2, 0.56, 0.4);
      const deskTop = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.08, 1.3), goldTrim);
      deskTop.position.set(-2.2, 1.12, 0.4);

      const elevShaft = new THREE.Mesh(new THREE.BoxGeometry(2.8, 3.4, 1.6), steelMat);
      elevShaft.position.set(0, 1.74, -sk.d / 2 + 1.25);

      const elevPadRing = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1.15, 20),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide })
      );
      elevPadRing.rotation.x = -Math.PI / 2;
      elevPadRing.position.set(0, 0.10, -sk.d / 2 + 2.4);

      const couchL = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.72, 2.8), couchMat);
      couchL.position.set(-sk.w / 2 + 1.3, 0.42, -1.2);
      const couchR = couchL.clone();
      couchR.position.x = sk.w / 2 - 1.3;

      const planter = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 0.75, 10), makeMat(0x78350f));
      planter.position.set(3.2, 0.42, 1.4);
      const plantTop = new THREE.Mesh(new THREE.DodecahedronGeometry(0.75, 0), makeMat(0x16a34a));
      plantTop.position.set(3.2, 1.15, 1.4);

      ig.add(desk, deskTop, elevShaft, elevPadRing, couchL, couchR, planter, plantTop);
      sk.interiorCache = ig;
      }
      worldRoot.add(ig);

      sk.interiorGroup = ig;
      sk.interiorBoxes = [
        addWorldBox(sk.x - 4.3, sk.x - 0.1, 0.18, 1.32, sk.z - 0.2, sk.z + 1.0, 'lobby_desk', true),
        addWorldBox(sk.x - 1.4, sk.x + 1.4, 0.18, 3.6, sk.z - sk.d / 2 + 0.45, sk.z - sk.d / 2 + 2.05, 'elev_shaft', false)
      ];
      sk.interiorLoaded = true;
    } else if (sk.interiorLoaded && dist > UNLOAD_DIST) {
      if (sk.interiorGroup) {
        worldRoot.remove(sk.interiorGroup);
        sk.interiorGroup = null;
      }
      for (const b of sk.interiorBoxes) {
        const idx = worldBoxes.indexOf(b);
        if (idx !== -1) worldBoxes.splice(idx, 1);
      }
      sk.interiorBoxes = [];
      sk.interiorLoaded = false;
    }
  }
}

export function buildKnockableLamppost(x, z) {
  const poleMat = makeMat(0xcbd5e1, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.20, flatShading: false });
  const bulbMat = makeMat(0xfef08a, { emissive: 0xfacc15, emissiveIntensity: 0.95 });

  const pivot = new THREE.Group();
  pivot.position.set(x, 0.18, z);

  const baseFlange = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.14, 10), poleMat);
  baseFlange.position.y = 0.07;

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 4.4, 8), poleMat);
  pole.position.y = 2.2;
  pole.castShadow = true;

  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.75), poleMat);
  arm.position.set(0, 4.35, 0.32);

  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.22, 0.46), bulbMat);
  lamp.position.set(0, 4.24, 0.62);

  pivot.add(baseFlange, pole, arm, lamp);
  worldRoot.add(pivot);

  const boxRef = addWorldBox(x - 0.18, x + 0.18, 0.18, 4.6, z - 0.18, z + 0.18, 'lamppost', false);
  const lp = {
    x, z,
    pivot,
    lampMat: bulbMat,
    boxRef,
    state: 'standing',
    fallYaw: 0,
    fallAngle: 0,
    fallVel: 0,
    respawnTimer: 0
  };
  lampPosts.push(lp);
  return lp;
}

export function knockOverLamppostBase(lp, impactYaw, impactSpeed = 6) {
  if (lp.state !== 'standing') return;
  lp.state = 'falling';
  lp.fallYaw = impactYaw;
  lp.fallAngle = 0.05;
  lp.fallVel = Math.max(2.6, Math.min(7.5, impactSpeed * 0.45));
  lp.respawnTimer = 16.0;
  lp.boxRef.minY = 999;
  lp.boxRef.maxY = 1000;
  sfx.metalClang();
  spawnParticles(lp.x, 1.4, lp.z, 0xfacc15, 10, 6.0);
}

export function updateLampposts(dt, elapsed) {
  for (let i = 0; i < lampPosts.length; i++) {
    const lp = lampPosts[i];
    if (lp.state === 'standing') continue;

    if (lp.state === 'falling') {
      lp.fallVel += 9.5 * dt;
      lp.fallAngle += lp.fallVel * dt;
      if (lp.fallAngle >= Math.PI / 2 - 0.03) {
        lp.fallAngle = Math.PI / 2 - 0.03;
        lp.state = 'down';
        sfx.hit();
        spawnParticles(lp.x + Math.sin(lp.fallYaw) * 4.2, 0.35, lp.z + Math.cos(lp.fallYaw) * 4.2, 0xfef08a, 6, 4.0);
      }
      lp.pivot.rotation.order = 'YXZ';
      lp.pivot.rotation.y = lp.fallYaw;
      lp.pivot.rotation.x = lp.fallAngle;
    } else if (lp.state === 'down') {
      const flickerWave = Math.sin(elapsed * 31 + i * 3.7) * Math.cos(elapsed * 47 + i * 1.9);
      const isOn = flickerWave > 0.12;
      lp.lampMat.emissiveIntensity = isOn ? 1.8 : 0.0;
      lp.lampMat.color.setHex(isOn ? 0xfef08a : 0x334155);

      lp.respawnTimer -= dt;
      if (lp.respawnTimer <= 0) {
        const clearOfPlayer = Math.hypot(player.x - lp.x, player.z - lp.z) > 2.2;
        const clearOfCars = vehicles.every((v) => Math.hypot(v.x - lp.x, v.z - lp.z) > 3.2);
        if (clearOfPlayer && clearOfCars) {
          lp.state = 'standing';
          lp.fallAngle = 0;
          lp.fallVel = 0;
          lp.pivot.rotation.set(0, 0, 0);
          lp.lampMat.emissiveIntensity = 0.95;
          lp.lampMat.color.setHex(0xfef08a);
          lp.boxRef.minY = 0.18;
          lp.boxRef.maxY = 4.6;
          spawnParticles(lp.x, 1.0, lp.z, 0x38bdf8, 6, 3.0);
        }
      }
    }
  }
}

export function createTree(x, z, scale = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0.18, z);
  g.scale.setScalar(scale);

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.35, 1.8, 6),
    makeMat(0x78350f, { texType: 'wood', repeatX: 1, repeatY: 2 })
  );
  trunk.position.y = 0.9;
  trunk.castShadow = true;

  const c1 = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.3, 6), makeMat(0x2d6a4f));
  c1.position.y = 2.4;
  c1.castShadow = true;

  const c2 = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.9, 6), makeMat(0x40916c));
  c2.position.y = 3.65;
  c2.castShadow = true;

  const c3 = regHigh(new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.5, 6), makeMat(0x52b788)));
  c3.position.y = 4.7;
  c3.castShadow = true;

  g.add(trunk, c1, c2, c3);
  worldRoot.add(g);
  addWorldBox(x - 0.38 * scale, x + 0.38 * scale, 0.18, 0.18 + 2.2 * scale, z - 0.38 * scale, z + 0.38 * scale, 'tree', false);
}

export function createHydrant(x, z) {
  const h = new THREE.Group();
  h.position.set(x, 0.18, z);
  const redMat = makeMat(0xdc2626, { metalness: 0.82, roughness: 0.24, clearcoat: 0.6, flatShading: false });
  const chromeCapMat = makeMat(0xe2e8f0, { metalness: 0.94, roughness: 0.15, flatShading: false });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.65, 10), redMat);
  body.position.y = 0.325;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), chromeCapMat);
  cap.position.y = 0.66;
  const side = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.42, 8), chromeCapMat);
  side.rotation.z = Math.PI / 2;
  side.position.y = 0.46;
  h.add(body, cap, side);
  worldRoot.add(h);
  addWorldBox(x - 0.2, x + 0.2, 0.18, 0.88, z - 0.2, z + 0.2, 'hydrant', true);
}

export function createBusShelter(x, z, rotY = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0.18, z);
  g.rotation.y = rotY;
  const chromeMat = makeMat(0xe2e8f0, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.18, flatShading: false });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.12, 1.5), chromeMat);
  roof.position.y = 2.45;
  roof.castShadow = true;
  const backGlass = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.2, 0.06), realWindowGlassMat);
  backGlass.position.set(0, 1.25, -0.62);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.10, 0.48), makeMat(0xb45309, { texType: 'wood' }));
  bench.position.set(0, 0.55, -0.32);
  [[-1.75, -0.62], [1.75, -0.62], [-1.75, 0.62], [1.75, 0.62]].forEach(([px, pz]) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.45, 8), chromeMat);
    post.position.set(px, 1.225, pz);
    g.add(post);
  });
  g.add(roof, backGlass, bench);
  worldRoot.add(g);
  const cos = Math.abs(Math.cos(rotY));
  const sin = Math.abs(Math.sin(rotY));
  const hw = (3.8 * cos + 1.5 * sin) / 2;
  const hd = (3.8 * sin + 1.5 * cos) / 2;
  addWorldBox(x - hw, x + hw, 2.38, 2.68, z - hd, z + hd, 'shelter_roof', true);
}

export function createNeonSign(parent, text, x, y, z, bgHex, textHex, w = 4.4, h = 1.1) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = textHex;
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.fillStyle = textHex;
  ctx.font = 'bold 42px Oswald, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(c);
  const signMat = new THREE.MeshStandardMaterial({
    map: tex,
    emissive: new THREE.Color(textHex),
    emissiveMap: tex,
    emissiveIntensity: 0.75,
    roughness: 0.25,
    metalness: 0.4
  });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.22), signMat);
  sign.position.set(x, y, z);
  parent.add(sign);
}

export function buildCityLandmarks() {
  // 1. CENTRAL PLAZA (0, 0)
  const cobbleMat = makeMat(0xa8a29e, { texType: 'cobblestone', repeatX: 3, repeatY: 18, roughness: 0.78, bumpScale: 0.025 });
  const pNS = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.05, 36), cobbleMat);
  pNS.position.set(0, 0.21, 0);
  pNS.receiveShadow = true;
  const pEW = new THREE.Mesh(new THREE.BoxGeometry(36, 0.05, 4.6), cobbleMat);
  pEW.position.set(0, 0.21, 0);
  pEW.receiveShadow = true;
  const courtyard = new THREE.Mesh(new THREE.CylinderGeometry(6.8, 7.0, 0.06, 20), cobbleMat);
  courtyard.position.set(0, 0.215, 0);
  courtyard.receiveShadow = true;
  worldRoot.add(pNS, pEW, courtyard);

  const marbleMat = makeMat(0xf8fafc, { texType: 'marble', repeatX: 3, repeatY: 2, roughness: 0.20, clearcoat: 0.85, flatShading: false });
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.78, 18), marbleMat);
  rim.position.set(0, 0.57, 0);
  rim.castShadow = true;
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(3.05, 3.05, 0.72, 18),
    makeMat(0x0ea5e9, { texType: 'water', repeatX: 3, repeatY: 3, roughness: 0.07, metalness: 0.28, clearcoat: 1.0, emissive: 0x0284c7, emissiveIntensity: 0.25, flatShading: false })
  );
  water.position.set(0, 0.58, 0);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.85, 1.7, 14), marbleMat);
  pillar.position.set(0, 1.4, 0);
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 0.9, 0.45, 16), marbleMat);
  basin.position.set(0, 2.2, 0);
  worldRoot.add(rim, water, pillar, basin);
  addWorldBox(-3.2, 3.2, 0.18, 0.96, -3.2, 3.2, 'fountain_rim', true);
  addWorldBox(-1.35, 1.35, 0.96, 2.42, -1.35, 1.35, 'fountain_top', true);
  mapShapes.push({ x: 0, z: 0, w: 30, d: 30, color: '#22c55e', border: '#15803d', enterable: false });

  const benchSteel = makeMat(0xcbd5e1, { metalness: 0.9, roughness: 0.2, flatShading: false });
  [[0, 5.8, Math.PI], [0, -5.8, 0], [5.8, 0, -Math.PI / 2], [-5.8, 0, Math.PI / 2]].forEach(([bx, bz, rot]) => {
    const bGroup = new THREE.Group();
    bGroup.position.set(bx, 0.18, bz);
    bGroup.rotation.y = rot;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.72), makeMat(0xb45309, { texType: 'wood' }));
    seat.position.y = 0.44;
    seat.castShadow = true;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.46, 0.74), benchSteel);
    legL.position.set(-0.95, 0.23, 0);
    const legR = legL.clone();
    legR.position.x = 0.95;
    bGroup.add(seat, legL, legR);
    worldRoot.add(bGroup);
    const bw = Math.abs(Math.cos(rot)) > 0.5 ? 2.2 : 0.75;
    const bd = Math.abs(Math.cos(rot)) > 0.5 ? 0.75 : 2.2;
    addWorldBox(bx - bw / 2, bx + bw / 2, 0.18, 0.70, bz - bd / 2, bz + bd / 2, 'bench', true);
  });

  [[-10.5, -10.5], [10.5, -10.5], [-10.5, 10.5], [10.5, 10.5]].forEach(([tx, tz]) => createTree(tx, tz, 1.1));

  // Central Plaza Hotdog Cart Sausage Replenisher
  buildPlazaHotdogCart(11.8, 12.2);

  // 2. WALK-IN AURA HOTDOGS STORE (NW Block Corner, right across from Central Plaza!)
  buildHotdogStore(-39.5, -39.5);

  // 2B. WALK-IN AURA EXOTIC MOTORS DEALERSHIP (Central North Block)
  buildCarDealership(0, -48);

  // Diner next to Aura Hotdogs
  const nwPlaza = new THREE.Mesh(
    new THREE.BoxGeometry(30.6, 0.21, 30.6),
    makeMat(0x94a3b8, { texType: 'cobblestone', repeatX: 12, repeatY: 12, bumpScale: 0.02 })
  );
  nwPlaza.position.set(-48, 0.105, -48);
  worldRoot.add(nwPlaza);

  const cafeGroup = new THREE.Group();
  const cafe = new THREE.Mesh(
    new THREE.BoxGeometry(9.6, 4.4, 9.2),
    makeMat(0xfde68a, { texType: 'brick', repeatX: 4, repeatY: 2, bumpScale: 0.02 })
  );
  cafe.position.set(-54.5, 2.38, -53.5);
  cafe.castShadow = true;
  const cafeGlass = new THREE.Mesh(new THREE.BoxGeometry(7.0, 1.8, 0.08), realWindowGlassMat);
  cafeGlass.position.set(-54.5, 1.5, -48.88);
  cafeGroup.add(cafe, cafeGlass);
  createNeonSign(cafeGroup, 'SUNNYVALE DINER', -54.5, 3.65, -48.82, '#7f1d1d', '#fef08a');
  worldRoot.add(cafeGroup);
  addWorldBox(-59.3, -49.7, 0.18, 4.58, -58.1, -48.9, 'diner_roof', true);
  mapShapes.push({ x: -54.5, z: -53.5, w: 9.6, d: 9.2, color: '#fde68a', border: '#b45309', enterable: false });

  // 3. WALK-IN SUNNYVALE RESERVE BANK (Downtown South-Center Block)
  buildReserveBank(0, -96);

  // 4. EXPANDED DOWNTOWN SKYSCRAPER DISTRICT (Walk-in Lobbies + Roof Elevators)
  buildSkyscraper({ x: -48, z: -96, w: 14.5, d: 14.5, h: 48, glassHex: 0x0284c7, frameHex: 0x0f172a, name: 'AURA CORP HQ', hasHelipad: true });
  buildSkyscraper({ x: 48, z: -96, w: 14.5, d: 14.5, h: 54, glassHex: 0x0d9488, frameHex: 0x1e293b, name: 'SUNNYVALE EXCHANGE', hasHelipad: false });
  buildSkyscraper({ x: -96, z: -96, w: 14.0, d: 14.0, h: 42, glassHex: 0x2563eb, frameHex: 0x1e293b, name: 'WESTSIDE TOWER', hasHelipad: true });
  buildSkyscraper({ x: 96, z: -96, w: 14.0, d: 14.0, h: 46, glassHex: 0x0369a1, frameHex: 0x0f172a, name: 'EASTGATE PLAZA', hasHelipad: false });

  buildSkyscraper({ x: 0, z: -144, w: 16.0, d: 16.0, h: 64, glassHex: 0x38bdf8, frameHex: 0x090d14, name: 'APEX PINNACLE', hasHelipad: true });
  buildSkyscraper({ x: -48, z: -144, w: 14.5, d: 14.5, h: 52, glassHex: 0x1d4ed8, frameHex: 0x1e293b, name: 'HORIZON FINANCIAL', hasHelipad: false });
  buildSkyscraper({ x: 48, z: -144, w: 14.5, d: 14.5, h: 56, glassHex: 0x0f766e, frameHex: 0x0f172a, name: 'PACIFIC TOWERS', hasHelipad: true });
  buildSkyscraper({ x: -96, z: -144, w: 14.0, d: 14.0, h: 44, glassHex: 0x4f46e5, frameHex: 0x1e293b, name: 'NORTHERN STAR', hasHelipad: false });
  buildSkyscraper({ x: 96, z: -144, w: 14.0, d: 14.0, h: 50, glassHex: 0x0284c7, frameHex: 0x0f172a, name: 'HARBOR VIEW HQ', hasHelipad: true });

  // 5. NE BLOCK (+48, -48): Brickwood Apartments + Diamond-Plate Fire Escape
  const nePlaza = new THREE.Mesh(
    new THREE.BoxGeometry(30.6, 0.21, 30.6),
    makeMat(0x94a3b8, { texType: 'concrete', repeatX: 10, repeatY: 10 })
  );
  nePlaza.position.set(48, 0.105, -48);
  worldRoot.add(nePlaza);

  const aptH = 8.4;
  const apt = new THREE.Mesh(
    new THREE.BoxGeometry(11, aptH, 16),
    makeMat(0xb45309, { texType: 'brick', repeatX: 5, repeatY: 4, bumpScale: 0.025 })
  );
  apt.position.set(43, 0.18 + aptH / 2, -48);
  apt.castShadow = true;
  apt.receiveShadow = true;
  worldRoot.add(apt);
  addWorldBox(37.5, 48.5, 0.18, 0.18 + aptH, -56, -40, 'apartment_roof', true);
  mapShapes.push({ x: 43, z: -48, w: 11, d: 16, color: '#b45309', border: '#78350f', enterable: false });

  const steelMat = makeMat(0x94a3b8, { texType: 'diamondplate', repeatX: 2, repeatY: 3, metalness: 0.88, roughness: 0.28, bumpScale: 0.02 });
  [
    { y: 1.85, z: -54.0 },
    { y: 3.70, z: -50.2 },
    { y: 5.55, z: -46.4 },
    { y: 7.40, z: -42.6 }
  ].forEach((st) => {
    const plat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.25, 3.4), steelMat);
    plat.position.set(49.6, st.y, st.z);
    plat.castShadow = true;
    worldRoot.add(plat);
    addWorldBox(48.5, 50.7, st.y - 0.15, st.y + 0.13, st.z - 1.7, st.z + 1.7, 'fire_escape', true);
  });

  // 6. SE BLOCK (+48, +48): Harbor Shipping Containers + Catwalk
  const contRed = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 2.3, 6.8),
    makeMat(0xdc2626, { texType: 'corrugated', repeatX: 3, repeatY: 2, metalness: 0.82, roughness: 0.34, bumpScale: 0.03 })
  );
  contRed.position.set(44, 0.18 + 1.15, 45);
  contRed.castShadow = true;
  addWorldBox(42.4, 45.6, 0.18, 2.48, 41.6, 48.4, 'container_low', true);

  const contBlue = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 2.3, 6.8),
    makeMat(0x2563eb, { texType: 'corrugated', repeatX: 3, repeatY: 2, metalness: 0.82, roughness: 0.34, bumpScale: 0.03 })
  );
  contBlue.position.set(47.4, 0.18 + 1.15, 47);
  contBlue.castShadow = true;
  addWorldBox(45.8, 49.0, 0.18, 2.48, 43.6, 50.4, 'container_low2', true);

  const contTop = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 2.2, 6.4),
    makeMat(0xd97706, { texType: 'corrugated', repeatX: 3, repeatY: 2, metalness: 0.82, roughness: 0.34, bumpScale: 0.03 })
  );
  contTop.position.set(47.4, 2.48 + 1.1, 47);
  contTop.castShadow = true;
  addWorldBox(45.8, 49.0, 2.48, 4.68, 43.8, 50.2, 'container_high', true);

  const contWest = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 2.3, 6.4),
    makeMat(0x0d9488, { texType: 'corrugated', repeatX: 3, repeatY: 2, metalness: 0.82, roughness: 0.34, bumpScale: 0.03 })
  );
  contWest.position.set(37.5, 0.18 + 1.15, 45);
  contWest.castShadow = true;
  addWorldBox(35.9, 39.1, 0.18, 2.48, 41.8, 48.2, 'container_west', true);

  const catwalk = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.22, 1.8), steelMat);
  catwalk.position.set(40.8, 2.48, 45);
  catwalk.castShadow = true;
  addWorldBox(38.2, 43.4, 2.36, 2.59, 44.1, 45.9, 'gantry_catwalk', true);

  worldRoot.add(contRed, contBlue, contTop, contWest, catwalk);
  mapShapes.push({ x: 45.8, z: 46, w: 7, d: 8, color: '#dc2626', border: '#991b1b', enterable: false });

  // 7. THREE FURNISHED WALK-IN HOUSES
  buildWalkInHouse({
    x: -7.5, z: 42.0, w: 9.8, d: 8.6,
    wallColor: 0xfef3c7, roofColor: 0xb91c1c,
    label: 'OAKWOOD RESIDENCE'
  });
  buildWalkInHouse({
    x: -41.5, z: -5.5, w: 9.8, d: 8.6,
    wallColor: 0xdbeafe, roofColor: 0x1e40af,
    label: 'CEDAR COTTAGE'
  });
  buildWalkInHouse({
    x: 42.5, z: -5.5, w: 9.8, d: 8.6,
    wallColor: 0xdcfce7, roofColor: 0x166534,
    label: 'SAGE VILLA'
  });

  // 8. SUBURBAN HOUSES (Including Outer West & East Expanded Neighborhoods)
  buildSuburbanHouse({ x: 7.5, z: 53.0, wallColor: 0xfed7aa, roofColor: 0x9a3412, rotY: Math.PI });
  buildSuburbanHouse({ x: -54.0, z: 8.0, wallColor: 0xfce7f3, roofColor: 0x831843, rotY: Math.PI / 2 });
  buildSuburbanHouse({ x: 54.0, z: 8.0, wallColor: 0xfef08a, roofColor: 0x854d0e, rotY: -Math.PI / 2 });
  buildSuburbanHouse({ x: -54.5, z: 42.5, wallColor: 0xe0e7ff, roofColor: 0x3730a3, rotY: 0 });
  buildSuburbanHouse({ x: -41.5, z: 54.5, wallColor: 0xffedd5, roofColor: 0xc2410c, rotY: Math.PI });
  buildSuburbanHouse({ x: 55.5, z: 54.5, wallColor: 0xd1fae5, roofColor: 0x065f46, rotY: Math.PI });
  buildSuburbanHouse({ x: -96.0, z: -48.0, wallColor: 0xfde68a, roofColor: 0x92400e, rotY: 0 });
  buildSuburbanHouse({ x: -96.0, z: 0.0, wallColor: 0xdbeafe, roofColor: 0x1e3a8a, rotY: Math.PI / 2 });
  buildSuburbanHouse({ x: -96.0, z: 48.0, wallColor: 0xfce7f3, roofColor: 0x9d174d, rotY: Math.PI });
  buildSuburbanHouse({ x: 96.0, z: -48.0, wallColor: 0xdcfce7, roofColor: 0x14532d, rotY: 0 });
  buildSuburbanHouse({ x: 96.0, z: 0.0, wallColor: 0xffedd5, roofColor: 0x9a3412, rotY: -Math.PI / 2 });
  buildSuburbanHouse({ x: 96.0, z: 48.0, wallColor: 0xe0e7ff, roofColor: 0x312e81, rotY: Math.PI });

  // Waist-High Yard Fence (Parkour Mantle Test)
  const yardFenceMat = makeMat(0xf8fafc, { texType: 'siding' });
  const f1 = new THREE.Mesh(new THREE.BoxGeometry(8.5, 1.15, 0.25), yardFenceMat);
  f1.position.set(7.5, 0.75, 43.5);
  f1.castShadow = true;
  worldRoot.add(f1);
  addWorldBox(3.25, 11.75, 0.18, 1.33, 43.35, 43.65, 'yard_fence', true);

  createBusShelter(-16.2, -6.5, Math.PI / 2);
  createBusShelter(16.2, 6.5, -Math.PI / 2);

  // Knockable Street Lampposts across City & Downtown Blocks
  [-96, -48, 0, 48, 96].forEach((bx) => {
    [-144, -96, -48, 0, 48].forEach((bz) => {
      [[-16.8, -16.8], [16.8, 16.8]].forEach(([ox, oz]) => {
        buildKnockableLamppost(bx + ox, bz + oz);
      });
    });
  });

  // Metallic Mailboxes & Street Receptacles
  const poleMat = makeMat(0xcbd5e1, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.20, flatShading: false });
  const mailboxMat = makeMat(0x1d4ed8, { metalness: 0.85, roughness: 0.22, clearcoat: 0.7, flatShading: false });
  [[-16.5, 16.2], [16.5, -16.2], [-31.5, 16.5], [-16.5, -64.5]].forEach(([mx, mz]) => {
    const mb = new THREE.Mesh(new THREE.BoxGeometry(0.52, 1.05, 0.52), mailboxMat);
    mb.position.set(mx, 0.70, mz);
    mb.castShadow = true;
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.22, 0.82, 10), poleMat);
    bin.position.set(mx + 0.9, 0.59, mz);
    worldRoot.add(mb, bin);
    addWorldBox(mx - 0.28, mx + 0.28, 0.18, 1.25, mz - 0.28, mz + 0.28, 'mailbox', true);
  });

  [[-16.8, 13.0], [16.8, 32.0], [-32.0, -16.8], [32.0, -32.0], [-16.8, -80.0]].forEach(([hx, hz]) => createHydrant(hx, hz));

  [
    [-13.5, 55.5], [13.5, 38.5], [-58.5, -11.5], [-36.5, 11.5],
    [58.5, -11.5], [36.5, 11.5], [-36.5, 38.5], [58.5, 38.5],
    [-82.0, -82.0], [82.0, -82.0], [-82.0, -130.0], [82.0, -130.0]
  ].forEach(([tx, tz]) => createTree(tx, tz, 0.95));
}

export function updateBuildingLods() {
  const LOD_ON_DIST = 54;
  const LOD_OFF_DIST = 66;
  for (let i = 0; i < buildingLods.length; i++) {
    const entry = buildingLods[i];
    const d = Math.hypot(entry.x - player.x, entry.z - player.z);
    if (!entry.active && d < LOD_ON_DIST) {
      entry.group.visible = true;
      entry.active = true;
    } else if (entry.active && d > LOD_OFF_DIST) {
      entry.group.visible = false;
      entry.active = false;
    }
  }
}

// ---------- BUILDING EMBELLISHMENTS ----------
export function embellishHouse({ x, z, w = 8.4, d = 7.4, h = 3.6, wallColor, roofColor, rotY = 0 }) {
  const g = new THREE.Group();
  g.position.set(x, 0.18, z);
  g.rotation.y = rotY;
  worldRoot.add(g);
  const wood = makeMat(0xf1f5f9, { roughness: 0.7 });
  const brick = makeMat(0x9a3412, { texType: 'brick', repeatX: 1, repeatY: 2 });
  const green = makeMat(0x14532d, { roughness: 0.8 });
  const add = (sx, sy, sz, m, px, py, pz) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
    b.position.set(px, py, pz);
    b.castShadow = true;
    g.add(b);
    return b;
  };
  add(w * 0.36, 0.14, 1.4, makeMat(0xa8a29e, { texType: 'concrete' }), 0, 0.07, d / 2 + 0.7);
  add(0.12, 2.5, 0.12, wood, -w * 0.15, 1.25, d / 2 + 1.3);
  add(0.12, 2.5, 0.12, wood, w * 0.15, 1.25, d / 2 + 1.3);
  add(w * 0.4, 0.12, 1.6, makeMat(roofColor), 0, 2.55, d / 2 + 0.75);
  add(0.8, h * 0.9 + 1.6, 0.8, brick, w * 0.3, h * 0.45 + 0.8, -d * 0.2);
  add(1.0, 0.12, 1.0, makeMat(0x57534e), w * 0.3, h + 1.65, -d * 0.2);
  [-1, 1].forEach((s) => {
    const wx = s * w * 0.28;
    add(0.34, 1.25, 0.06, green, wx - 0.98, 1.9, d / 2 + 0.05);
    add(0.34, 1.25, 0.06, green, wx + 0.98, 1.9, d / 2 + 0.05);
    add(1.4, 0.22, 0.3, makeMat(0x78350f, { texType: 'wood' }), wx, 1.18, d / 2 + 0.18);
    add(1.3, 0.2, 0.24, makeMat(0x22c55e), wx, 1.38, d / 2 + 0.18);
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), makeMat(0x15803d));
    bush.position.set(s * w * 0.44, 0.4, d / 2 + 0.55);
    bush.castShadow = true;
    g.add(bush);
  });
  add(0.08, 1.0, 0.08, wood, w * 0.6, 0.5, d / 2 + 3);
  add(0.4, 0.28, 0.25, makeMat(0x1d4ed8), w * 0.6, 1.1, d / 2 + 3);
  add(w + 2, 0.07, 0.07, wood, 0, 0.7, d / 2 + 4.2);
  add(w + 2, 0.07, 0.07, wood, 0, 0.42, d / 2 + 4.2);
  for (let fx = -w / 2 - 1; fx <= w / 2 + 1.01; fx += 0.9) {
    if (Math.abs(fx) > 1.0) add(0.08, 0.95, 0.08, wood, fx, 0.48, d / 2 + 4.2);
  }
}

export function embellishTower({ x, z, w = 13.5, d = 13.5, h = 44, glassHex = 0x0ea5e9, hasHelipad = true }) {
  const g = new THREE.Group();
  g.position.set(x, 0.18, z);
  worldRoot.add(g);
  const dark = makeMat(0x0f172a, { metalness: 0.8, roughness: 0.3 });
  const glow = new THREE.MeshBasicMaterial({ color: glassHex });
  const add = (sx, sy, sz, m, px, py, pz) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
    b.position.set(px, py, pz);
    b.castShadow = true;
    g.add(b);
    return b;
  };
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => add(0.7, h, 0.7, dark, sx * w / 2, h / 2, sz * d / 2));
  for (let y = 9; y < h - 2; y += 7) add(w + 0.35, 0.3, d + 0.35, dark, 0, y, 0);
  add(w + 0.5, 0.25, d + 0.5, glow, 0, h + 0.1, 0);
  add(w, 1.0, 0.3, dark, 0, h + 0.5, d / 2 - 0.15);
  add(w, 1.0, 0.3, dark, 0, h + 0.5, -d / 2 + 0.15);
  add(0.3, 1.0, d, dark, w / 2 - 0.15, h + 0.5, 0);
  add(0.3, 1.0, d, dark, -w / 2 + 0.15, h + 0.5, 0);
  add(2.2, 1.3, 1.6, makeMat(0x64748b), -w / 2 + 2.2, h + 0.7, -d / 2 + 2.0);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 10, 6), dark);
  mast.position.set(w / 2 - 1.2, h + 5, -d / 2 + 1.2);
  g.add(mast);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
  beacon.position.set(w / 2 - 1.2, h + 10.2, -d / 2 + 1.2);
  g.add(beacon);
  if (!hasHelipad) {
    add(w * 0.7, 2.2, d * 0.7, dark, 0, h + 1.2, 0);
    add(w * 0.4, 2.2, d * 0.4, glow, 0, h + 3.4, 0);
  }
}

export function buildSuburbanHouse(o) { buildSuburbanHouseBase(o); embellishHouse(o); }

export function buildSkyscraper(o) { const r = buildSkyscraperBase(o); embellishTower(o); return r; }

// ---------- NEW BIOMES: FROSTPINE ALPINE / EMERALD WOODS / SUNSET COVE ----------
export function buildNewBiomes() {
  const grp = new THREE.Group();
  worldRoot.add(grp);
  const mesh = (geo, mat, x, y, z, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    grp.add(m);
    return m;
  };
  const plane = (x0, x1, z0, z1, y, mat) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    m.receiveShadow = true;
    grp.add(m);
    return m;
  };
  const road = (rx, name) => {
    plane(rx - 6, rx + 6, 74, 208, 0.18, makeMat(0x313946, { texType: 'asphalt', repeatX: 2, repeatY: 26, roughness: 0.86 }));
    for (let zz = 80; zz < 206; zz += 6) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 2.5), makeMat(0xfacc15));
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(rx, 0.185, zz);
      grp.add(dash);
    }
    mapShapes.push({ x: rx, z: 141, w: 12, d: 134, color: '#334155', border: '#475569', enterable: false });
  };
  const collide = (x, z, r, hgt, tag = 'tree') => addWorldBox(x - r, x + r, 0.18, 0.18 + hgt, z - r, z + r, tag, false);
  const keep = [];
  const free = (x, z, roadX, r = 2) => {
    if (Math.abs(x - roadX) < 8) return false;
    for (const k of keep) if (Math.hypot(x - k.x, z - k.z) < k.r + r) return false;
    return true;
  };

  // === FROSTPINE ALPINE (x -134..-52) ===
  plane(-136, -52, 108, 208, 0.17, makeMat(0xf1f5f9, { roughness: 0.92 }));
  road(-96, 'Alpine Pass');
  mapShapes.unshift({ x: -94, z: 158, w: 84, d: 100, color: '#e2e8f0', border: '#94a3b8', enterable: false });
  const pineG = [new THREE.ConeGeometry(1.7, 2.2, 7), new THREE.ConeGeometry(1.3, 1.9, 7), new THREE.ConeGeometry(0.9, 1.6, 7)];
  const trunkG = new THREE.CylinderGeometry(0.2, 0.3, 1.6, 6);
  const trunkM = makeMat(0x5b3a1a, { texType: 'wood' });
  const snowM = makeMat(0xffffff, { roughness: 0.9 });
  const pine = (x, z, s, hex, snowy) => {
    const gm = makeMat(hex);
    mesh(trunkG, trunkM, x, 0.17 + 0.8 * s, z).scale.setScalar(s);
    [[0, 2.2], [1, 3.4], [2, 4.5]].forEach(([i, y]) => {
      mesh(pineG[i], gm, x, 0.17 + y * s, z).scale.setScalar(s);
      if (snowy) mesh(pineG[i], snowM, x, 0.17 + (y + 0.22) * s, z).scale.setScalar(s * 0.86);
    });
    collide(x, z, 0.4 * s, 2.4 * s);
  };
  const pond = { x: -108, z: 150, r: 12 };
  keep.push({ x: pond.x, z: pond.z, r: 14 }, { x: -70, z: 139, r: 10 }, { x: -84, z: 171, r: 4 });
  const ice = mesh(new THREE.CylinderGeometry(pond.r, pond.r, 0.06, 28), makeMat(0x9bdcf5, { metalness: 0.5, roughness: 0.08 }), pond.x, 0.2, pond.z, false);
  iceZones.push(pond);
  mapShapes.push({ x: pond.x, z: pond.z, w: 24, d: 24, color: '#7dd3fc', border: '#38bdf8', enterable: false });
  for (let i = 0, n = 0; i < 90 && n < 28; i++) {
    const x = -132 + rnd() * 78, z = 116 + rnd() * 84;
    if (!free(x, z, -96)) continue;
    pine(x, z, 0.8 + rnd() * 0.7, pick([0x1b4332, 0x2d6a4f, 0x14532d]), true);
    keep.push({ x, z, r: 1.4 }); n++;
  }
  for (let i = 0; i < 10; i++) {
    const x = -130 + rnd() * 76, z = 114 + rnd() * 86;
    if (!free(x, z, -96, 3)) continue;
    const dr = mesh(new THREE.SphereGeometry(1.6, 10, 6), snowM, x, 0.17, z, false);
    dr.scale.set(1.7 + rnd(), 0.4, 1.3 + rnd());
  }
  [[-124, 200, 15], [-96, 203, 19], [-66, 200, 14]].forEach(([mx, mz, mh]) => {
    mesh(new THREE.ConeGeometry(mh * 0.85, mh * 1.4, 7), makeMat(0x64748b, { roughness: 0.95 }), mx, mh * 0.7, mz);
    mesh(new THREE.ConeGeometry(mh * 0.42, mh * 0.55, 7), snowM, mx, mh * 1.12, mz);
    addWorldBox(mx - mh * 0.55, mx + mh * 0.55, 0.17, mh * 0.8, mz - 4, mz + 4, 'mountain', false);
  });
  // snowman
  mesh(new THREE.SphereGeometry(0.75, 10, 8), snowM, -84, 0.9, 171);
  mesh(new THREE.SphereGeometry(0.55, 10, 8), snowM, -84, 1.9, 171);
  mesh(new THREE.SphereGeometry(0.38, 10, 8), snowM, -84, 2.65, 171);
  mesh(new THREE.ConeGeometry(0.07, 0.4, 6), makeMat(0xea580c), -84, 2.62, 171.45).rotation.x = Math.PI / 2;
  mesh(new THREE.BoxGeometry(0.4, 0.05, 0.4), makeMat(0x111827), -84, 2.98, 171);
  collide(-84, 171, 0.8, 3);
  buildWalkInHouse({ x: -70, z: 139, w: 11, d: 9, wallColor: 0x92400e, roofColor: 0xf8fafc, label: 'FROSTPINE SKI LODGE' });

  // === EMERALD WOODS (x -52..28) ===
  plane(-52, 28, 108, 208, 0.17, makeMat(0x4f8f46, { texType: 'grass', repeatX: 12, repeatY: 16, roughness: 0.95 }));
  road(-24, 'Forest Road');
  mapShapes.unshift({ x: -12, z: 158, w: 80, d: 100, color: '#166534', border: '#14532d', enterable: false });
  const camp = { x: 8, z: 176 };
  keep.push({ x: camp.x, z: camp.z, r: 8 }, { x: 4, z: 128, r: 10 });
  const waterM = makeMat(0x38bdf8, { texType: 'water', repeatX: 6, repeatY: 1, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.85 });
  [[-52, -31], [-17, 28]].forEach(([a, b]) => {
    plane(a, b, 147.5, 152.5, 0.19, waterM);
    waterZones.push({ minX: a, maxX: b, minZ: 147.5, maxZ: 152.5 });
  });
  mapShapes.push({ x: -41, z: 150, w: 21, d: 5, color: '#38bdf8', border: '#0ea5e9', enterable: false }, { x: 5, z: 150, w: 45, d: 5, color: '#38bdf8', border: '#0ea5e9', enterable: false });
  const oakG = new THREE.IcosahedronGeometry(1.9, 0);
  const bark = makeMat(0x6b4423, { texType: 'wood' });
  const birchBark = makeMat(0xf1f5f9);
  const oak = (x, z, s, birch) => {
    const tg = new THREE.CylinderGeometry(birch ? 0.16 : 0.28, birch ? 0.22 : 0.4, 3.2 * s, 7);
    mesh(tg, birch ? birchBark : bark, x, 0.17 + 1.6 * s, z);
    const lm = makeMat(birch ? 0x84cc16 : pick([0x2f7d32, 0x3f9142, 0x276a2c]));
    [[0, 3.8, 0, 1], [0.9, 3.3, 0.4, 0.75], [-0.8, 3.4, -0.5, 0.8]].forEach(([ox, oy, oz, sc]) => {
      mesh(oakG, lm, x + ox * s, 0.17 + oy * s, z + oz * s).scale.setScalar(sc * s * (birch ? 0.72 : 1));
    });
    collide(x, z, 0.4 * s, 3 * s);
  };
  for (let i = 0, n = 0; i < 130 && n < 34; i++) {
    const x = -50 + rnd() * 76, z = 114 + rnd() * 88;
    if (!free(x, z, -24) || (Math.abs(z - 150) < 5)) continue;
    const r = rnd();
    if (r < 0.4) oak(x, z, 0.85 + rnd() * 0.5, false);
    else if (r < 0.65) oak(x, z, 0.8 + rnd() * 0.4, true);
    else pine(x, z, 0.9 + rnd() * 0.6, 0x14532d, false);
    keep.push({ x, z, r: 1.5 }); n++;
  }
  for (let i = 0; i < 10; i++) {
    const x = -50 + rnd() * 76, z = 114 + rnd() * 88;
    if (!free(x, z, -24, 1) || Math.abs(z - 150) < 4) continue;
    const bsh = mesh(new THREE.IcosahedronGeometry(0.7, 0), makeMat(0x166534), x, 0.55, z);
    bsh.scale.y = 0.75;
    mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.22, 5), makeMat(0xf5f5f4), x + 1.4, 0.3, z + 0.4, false);
    mesh(new THREE.SphereGeometry(0.2, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), makeMat(0xdc2626), x + 1.4, 0.4, z + 0.4, false);
  }
  [[-40, 128, 0.3], [-8, 190, 1.2], [14, 138, 0.8]].forEach(([lx, lz, ry]) => {
    const lg = mesh(new THREE.CylinderGeometry(0.42, 0.42, 4, 8), bark, lx, 0.5, lz);
    lg.rotation.z = Math.PI / 2; lg.rotation.y = ry;
    addWorldBox(lx - 2, lx + 2, 0.17, 0.9, lz - 0.6, lz + 0.6, 'log', true);
  });
  // campsite
  for (let a = 0; a < 8; a++) {
    mesh(new THREE.DodecahedronGeometry(0.22, 0), makeMat(0x78716c), camp.x + Math.cos(a * 0.785) * 0.7, 0.3, camp.z + Math.sin(a * 0.785) * 0.7, false);
  }
  const fire = mesh(new THREE.ConeGeometry(0.4, 1.1, 6), new THREE.MeshBasicMaterial({ color: 0xfb923c }), camp.x, 0.8, camp.z, false);
  mesh(new THREE.ConeGeometry(0.22, 0.8, 6), new THREE.MeshBasicMaterial({ color: 0xfde047 }), camp.x, 0.75, camp.z, false);
  const fl = new THREE.PointLight(0xfb923c, 1.6, 14);
  fl.position.set(camp.x, 1.4, camp.z);
  grp.add(fl);
  buildNewBiomes.fire = { fire, fl };
  [[-3, 3, 0.4, 0x2563eb], [3, 4, -0.5, 0xdc2626]].forEach(([ox, oz, ry, hx]) => {
    const t = mesh(new THREE.ConeGeometry(1.7, 1.9, 4), makeMat(hx), camp.x + ox, 1.1, camp.z + oz);
    t.rotation.y = ry + Math.PI / 4;
    collide(camp.x + ox, camp.z + oz, 1.1, 1.5, 'tent');
  });
  buildWalkInHouse({ x: 4, z: 128, w: 10.4, d: 8.6, wallColor: 0x854d0e, roofColor: 0x166534, label: 'EMERALD RANGER STATION' });
  // footbridge over stream near the road
  mesh(new THREE.BoxGeometry(14, 0.12, 6), makeMat(0x78350f, { texType: 'wood' }), -24, 0.23, 150, false);
  [-1, 1].forEach((s) => mesh(new THREE.BoxGeometry(14, 0.9, 0.12), makeMat(0x78350f, { texType: 'wood' }), -24, 0.7, 150 + s * 2.95, false));

  // === SUNSET COVE (x 28..132) ===
  plane(28, 138, 108, 208, 0.17, makeMat(0xf2d9a0, { texType: 'sand', repeatX: 14, repeatY: 14, roughness: 0.96 }));
  road(72, 'Cove Boulevard');
  mapShapes.unshift({ x: 83, z: 158, w: 110, d: 100, color: '#fcd34d', border: '#f59e0b', enterable: false });
  const sea = plane(28, 138, 168, 208, 0.2, makeMat(0x0ea5e9, { texType: 'water', repeatX: 14, repeatY: 6, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.88 }));
  waterZones.push({ minX: 28, maxX: 138, minZ: 168, maxZ: 208 });
  mapShapes.push({ x: 83, z: 188, w: 110, d: 40, color: '#38bdf8', border: '#0ea5e9', enterable: false });
  plane(28, 138, 166.6, 168, 0.21, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
  keep.push({ x: 50, z: 150, r: 5 }, { x: 118, z: 138, r: 9 }, { x: 100, z: 160, r: 6 });
  // pier
  mesh(new THREE.BoxGeometry(4, 0.2, 40), makeMat(0x92704a, { texType: 'wood', repeatX: 1, repeatY: 10 }), 100, 0.45, 172, false);
  for (let pz = 154; pz <= 190; pz += 6) [-1.7, 1.7].forEach((s) => mesh(new THREE.CylinderGeometry(0.18, 0.2, 1.4, 6), makeMat(0x57534e), 100 + s, 0.0, pz, false));
  addWorldBox(98, 102, 0.2, 0.55, 152, 192, 'pier', true);
  mesh(new THREE.BoxGeometry(1.4, 0.12, 0.5), makeMat(0x78350f), 100, 0.9, 186, false);
  // palms
  const frondM = makeMat(0x16a34a, { roughness: 0.8 });
  const palm = (x, z, s) => {
    const lean = (rnd() - 0.5) * 0.4;
    const tr = mesh(new THREE.CylinderGeometry(0.16 * s, 0.24 * s, 5 * s, 7), makeMat(0x9a6b3a, { texType: 'wood' }), x, 0.17 + 2.5 * s, z);
    tr.rotation.z = lean;
    const tx = x - Math.sin(lean) * 2.5 * s, ty = 0.17 + 5 * s;
    for (let f = 0; f < 6; f++) {
      const fr = mesh(new THREE.BoxGeometry(3 * s, 0.05, 0.7 * s), frondM, tx, ty, z, false);
      fr.rotation.y = f * 1.047;
      fr.rotation.z = -0.35;
      fr.translateX(1.3 * s);
    }
    collide(x, z, 0.35, 4 * s);
  };
  for (let i = 0, n = 0; i < 80 && n < 10; i++) {
    const x = 32 + rnd() * 100, z = 114 + rnd() * 50;
    if (!free(x, z, 72)) continue;
    palm(x, z, 0.9 + rnd() * 0.4);
    keep.push({ x, z, r: 2 }); n++;
  }
  // umbrellas & towels
  [[52, 160, 0xef4444], [60, 158, 0x3b82f6], [88, 162, 0xfacc15], [96, 150, 0x22c55e], [112, 158, 0xec4899]].forEach(([ux, uz, uc], i) => {
    mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 5), makeMat(0xf8fafc), ux, 1.3, uz, false);
    mesh(new THREE.ConeGeometry(1.5, 0.55, 8), makeMat(uc), ux, 2.6, uz);
    mesh(new THREE.BoxGeometry(1.1, 0.03, 2.0), makeMat(i % 2 ? 0xfef3c7 : 0xbfdbfe), ux + 0.9, 0.19, uz + 0.8, false);
  });
  // lifeguard tower
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => mesh(new THREE.BoxGeometry(0.2, 2.6, 0.2), makeMat(0xf8fafc), 50 + sx * 1.0, 1.5, 150 + sz * 1.0));
  mesh(new THREE.BoxGeometry(2.6, 1.6, 2.6), makeMat(0xdc2626, { texType: 'wood' }), 50, 3.3, 150);
  mesh(new THREE.BoxGeometry(3.2, 0.2, 3.2), makeMat(0xf8fafc), 50, 4.25, 150);
  mesh(new THREE.BoxGeometry(0.06, 1.3, 0.06), makeMat(0x57534e), 51.4, 5.0, 151.4);
  mesh(new THREE.BoxGeometry(0.7, 0.4, 0.04), makeMat(0xfacc15), 51.75, 5.4, 151.4, false);
  addWorldBox(48.8, 51.2, 0.17, 2.0, 148.8, 151.2, 'tower_legs', true);
  // sailboats
  [[60, 190, 0.3], [126, 180, -0.4]].forEach(([bx, bz, ry]) => {
    const bt = new THREE.Group();
    bt.position.set(bx, 0.3, bz);
    bt.rotation.y = ry;
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 4.8), makeMat(0xf8fafc));
    const mastM = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5, 5), makeMat(0x57534e));
    mastM.position.y = 2.8;
    const sail = new THREE.Mesh(new THREE.ConeGeometry(1.3, 4.2, 3), makeMat(0xfef3c7));
    sail.position.set(0, 2.9, 0.3);
    sail.scale.z = 0.12;
    bt.add(hull, mastM, sail);
    grp.add(bt);
  });
  buildWalkInHouse({ x: 118, z: 138, w: 10.4, d: 8.6, wallColor: 0x67e8f9, roofColor: 0xea580c, label: 'SUNSET COVE SURF SHACK' });
}

// ---------- VERDANT JUNGLE BIOME (East of Redrock Desert, x = 368..498) ----------
export function buildJungleBiome() {
  const grp = new THREE.Group();
  worldRoot.add(grp);

  const mesh = (geo, mat, x, y, z, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    grp.add(m);
    return m;
  };

  const plane = (x0, x1, z0, z1, y, mat) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    m.receiveShadow = true;
    grp.add(m);
    return m;
  };

  // 1. Lush Mossy Jungle Floor (y = 0.17, matching Alpine/Woods/Cove)
  plane(368, 498, -140, 200, 0.17, makeMat(0x2d5a27, { texType: 'grass', repeatX: 18, repeatY: 42, roughness: 0.96 }));
  mapShapes.unshift({ x: 433, z: 30, w: 130, d: 340, color: '#14532d', border: '#166534', enterable: false });

  // 2. Smooth Entry Ramp + Jungle Road extending from Route 66 (z = 40, x = 360 -> 472)
  const entryRamp = new THREE.Mesh(
    new THREE.BoxGeometry(8.2, 0.14, 12),
    makeMat(0x313946, { texType: 'asphalt', repeatX: 2, repeatY: 2, roughness: 0.86 })
  );
  entryRamp.position.set(364, 0.11, 40);
  entryRamp.rotation.z = Math.atan2(0.12, 8);
  entryRamp.receiveShadow = true;
  grp.add(entryRamp);

  // Dirt/asphalt jungle trail (split around the river bridge at x = 412..424)
  const trailMat = makeMat(0x5c4033, { texType: 'sand', repeatX: 10, repeatY: 2, roughness: 0.95 });
  plane(368, 412, 35, 45, 0.18, trailMat);
  plane(424, 474, 35, 45, 0.18, trailMat);
  mapShapes.push({ x: 421, z: 40, w: 106, d: 10, color: '#78350f', border: '#451a03', enterable: false });

  // 3. Winding Jungle River (x = 412..424, z = -140..200) + Wooden Plank Bridge at z = 40
  const riverMat = makeMat(0x0d9488, {
    texType: 'water',
    repeatX: 2,
    repeatY: 34,
    roughness: 0.1,
    metalness: 0.25,
    transparent: true,
    opacity: 0.86
  });
  plane(412, 424, -140, 200, 0.19, riverMat);
  waterZones.push({ minX: 412, maxX: 424, minZ: -140, maxZ: 200 });
  mapShapes.push({ x: 418, z: 30, w: 12, d: 340, color: '#14b8a6', border: '#0f766e', enterable: false });

  // Driveable Wooden Bridge over the Jungle River (x = 411..425, z = 34..46)
  const woodBridgeMat = makeMat(0x78350f, { texType: 'wood', repeatX: 4, repeatY: 2 });
  mesh(new THREE.BoxGeometry(14, 0.22, 11.5), woodBridgeMat, 418, 0.28, 40);
  [-5.5, 5.5].forEach((rz) => {
    mesh(new THREE.BoxGeometry(14, 0.85, 0.24), woodBridgeMat, 418, 0.72, 40 + rz);
  });
  addWorldBox(411, 425, 0.17, 0.39, 34.2, 45.8, 'jungle_bridge', true);

  // North Waterfall Cliff at head of the river (x = 418, z = -136)
  const cliffMat = makeMat(0x475569, { texType: 'redrock', repeatX: 4, repeatY: 3, roughness: 0.92 });
  mesh(new THREE.BoxGeometry(22, 14, 7), cliffMat, 418, 7, -137);
  addWorldBox(407, 429, 0.17, 14, -140.5, -133.5, 'jungle_cliff', false);
  const fallSheet = mesh(
    new THREE.BoxGeometry(8.5, 13.5, 0.35),
    new THREE.MeshBasicMaterial({ color: 0x5eead4, transparent: true, opacity: 0.72 }),
    418, 6.9, -133.3, false
  );
  const mistPool = mesh(
    new THREE.CylinderGeometry(7.5, 7.5, 0.08, 20),
    new THREE.MeshBasicMaterial({ color: 0xccfbf1, transparent: true, opacity: 0.55 }),
    418, 0.22, -130, false
  );
  buildJungleBiome.waterfall = { fallSheet, mistPool };

  // 4. Climbable Ancient Jungle Temple Pyramid (x = 458, z = -55)
  const templeX = 458, templeZ = -55;
  const stoneMat = makeMat(0x57534e, { texType: 'cobblestone', repeatX: 6, repeatY: 6, roughness: 0.92 });
  const mossStoneMat = makeMat(0x3f6212, { texType: 'cobblestone', repeatX: 4, repeatY: 4, roughness: 0.95 });
  const tiers = [
    { w: 24, d: 24, h: 2.2, y: 0.17 },
    { w: 18, d: 18, h: 2.2, y: 2.37 },
    { w: 12, d: 12, h: 2.2, y: 4.57 },
    { w: 6.5, d: 6.5, h: 2.0, y: 6.77 }
  ];
  tiers.forEach((t, idx) => {
    mesh(new THREE.BoxGeometry(t.w, t.h, t.d), idx % 2 === 0 ? stoneMat : mossStoneMat, templeX, t.y + t.h / 2, templeZ);
    addWorldBox(
      templeX - t.w / 2, templeX + t.w / 2,
      t.y, t.y + t.h,
      templeZ - t.d / 2, templeZ + t.d / 2,
      'temple_tier', true
    );
  });
  // Summit Shrine & Golden Relic
  const goldMat = makeMat(0xfacc15, { metalness: 0.9, roughness: 0.2 });
  mesh(new THREE.BoxGeometry(1.4, 1.2, 1.4), stoneMat, templeX, 9.37, templeZ);
  mesh(new THREE.OctahedronGeometry(0.65, 0), goldMat, templeX, 10.65, templeZ);
  createNeonSign(grp, 'ANCIENT SUN TEMPLE', templeX, 11.9, templeZ + 3.4, '#14532d', '#fde047', 5.8, 0.95);
  mapShapes.push({ x: templeX, z: templeZ, w: 24, d: 24, color: '#65a30d', border: '#facc15', enterable: false });

  // 5. Walk-In Jungle Research Station (x = 454, z = 96)
  buildWalkInHouse({
    x: 454, z: 96, w: 10.6, d: 8.8,
    wallColor: 0x4d7c0f, roofColor: 0x78350f,
    label: 'JUNGLE RESEARCH STATION'
  });

  // 6. Keep-out zones so trees don't block the road, river, temple, or station
  const keep = [
    { x: templeX, z: templeZ, r: 16 },
    { x: 454, z: 96, r: 10 },
    { x: 418, z: -132, r: 12 }
  ];
  const isClear = (x, z, r = 2.2) => {
    if (Math.abs(z - 40) < 8.5) return false;        // Jungle trail
    if (x > 409 && x < 427) return false;            // Jungle river
    for (const k of keep) {
      if (Math.hypot(x - k.x, z - k.z) < k.r + r) return false;
    }
    return true;
  };

  // 7. Giant Kapok Canopy Trees with Buttress Roots & Hanging Vines
  const barkMat = makeMat(0x4a3525, { texType: 'wood', repeatX: 2, repeatY: 4 });
  const canopyMats = [
    makeMat(0x14532d, { roughness: 0.85 }),
    makeMat(0x166534, { roughness: 0.85 }),
    makeMat(0x15803d, { roughness: 0.82 }),
    makeMat(0x22c55e, { roughness: 0.8 })
  ];
  const vineMat = makeMat(0x4d7c0f, { roughness: 0.9 });

  const spawnKapokTree = (x, z, s = 1) => {
    const h = 9.5 * s;
    // Main trunk
    mesh(new THREE.CylinderGeometry(0.45 * s, 0.72 * s, h, 8), barkMat, x, 0.17 + h / 2, z);
    // Flared buttress roots
    for (let r = 0; r < 4; r++) {
      const ang = (r * Math.PI) / 2 + 0.4;
      const root = mesh(new THREE.BoxGeometry(0.35 * s, 2.2 * s, 1.5 * s), barkMat, x + Math.cos(ang) * 0.65 * s, 0.17 + 1.0 * s, z + Math.sin(ang) * 0.65 * s);
      root.rotation.y = -ang;
    }
    // Wide layered umbrella canopy
    const mainLeaf = canopyMats[(Math.abs(Math.floor(x + z)) % canopyMats.length)];
    const c1 = mesh(new THREE.DodecahedronGeometry(3.6 * s, 1), mainLeaf, x, 0.17 + h, z);
    c1.scale.set(1.25, 0.48, 1.25);
    const c2 = mesh(new THREE.DodecahedronGeometry(2.6 * s, 1), canopyMats[2], x + 1.4 * s, 0.17 + h + 1.1 * s, z - 0.9 * s);
    c2.scale.set(1.2, 0.45, 1.2);
    const c3 = mesh(new THREE.DodecahedronGeometry(2.4 * s, 1), canopyMats[3], x - 1.3 * s, 0.17 + h + 0.9 * s, z + 1.1 * s);
    c3.scale.set(1.2, 0.45, 1.2);

    // Hanging vines
    for (let v = 0; v < 3; v++) {
      const va = v * 2.1 + x;
      const vLen = (2.8 + (v % 2) * 1.4) * s;
      mesh(
        new THREE.CylinderGeometry(0.04, 0.04, vLen, 5),
        vineMat,
        x + Math.cos(va) * 2.3 * s,
        0.17 + h - vLen / 2 - 0.3,
        z + Math.sin(va) * 2.3 * s,
        false
      );
    }

    addWorldBox(x - 0.75 * s, x + 0.75 * s, 0.17, 0.17 + h * 0.6, z - 0.75 * s, z + 0.75 * s, 'jungle_tree', false);
  };

  // Place 52 giant canopy trees across both sides of the river
  for (let i = 0, placed = 0; i < 240 && placed < 52; i++) {
    const x = 373 + rnd() * 120;
    const z = -134 + rnd() * 328;
    if (!isClear(x, z, 2.8)) continue;
    spawnKapokTree(x, z, 0.85 + rnd() * 0.55);
    keep.push({ x, z, r: 3.4 });
    placed++;
  }

  // 8. Dense Tropical Ferns, Mossy Boulders & Exotic Glowing Blooms
  const fernMat = makeMat(0x16a34a, { roughness: 0.85 });
  const boulderMat = makeMat(0x4b5563, { texType: 'cobblestone', repeatX: 2, repeatY: 2, roughness: 0.95 });
  const bloomColors = [0xf43f5e, 0xf59e0b, 0xa855f7, 0x38bdf8];

  for (let i = 0; i < 75; i++) {
    const x = 371 + rnd() * 123;
    const z = -136 + rnd() * 332;
    if (!isClear(x, z, 1.0)) continue;

    // Tropical fern cluster
    const fern = mesh(new THREE.ConeGeometry(1.15, 0.95, 6), fernMat, x, 0.55, z, false);
    fern.scale.set(1.3, 0.7, 1.3);

    // Occasional mossy boulder or bright jungle flower
    if (i % 5 === 0) {
      const rock = mesh(new THREE.DodecahedronGeometry(1.1, 0), boulderMat, x + 1.2, 0.65, z + 0.8);
      addWorldBox(x + 0.3, x + 2.1, 0.17, 1.5, z - 0.1, z + 1.7, 'jungle_boulder', true);
    } else if (i % 3 === 0) {
      const flowerMat = makeMat(pick(bloomColors), { emissive: pick(bloomColors), emissiveIntensity: 0.35 });
      mesh(new THREE.DodecahedronGeometry(0.28, 0), flowerMat, x, 1.05, z, false);
    }
  }
}

// ---------- ATMOSPHERE, SNOW & WADING ----------
export const bio = { base: null, snow: null, last: 'city' };

export const bioC = {};

export function updateBiomeAtmosphere(dt, elapsed) {
  const b = biomeAt(player.x, player.z);
  if (!bio.base) bio.base = scene.fog.color.clone();
  const tgt = { alpine: [0xdbe9f4, 0.0062], woods: [0x9ccaa6, 0.0040], cove: [0xaee2f4, 0.0018] }[b];
  const k = Math.min(1, dt * 1.5);
  scene.fog.color.lerp(tgt ? (bioC[tgt[0]] || (bioC[tgt[0]] = new THREE.Color(tgt[0]))) : bio.base, k);
  scene.fog.density += ((tgt ? tgt[1] : 0.0024) - scene.fog.density) * k;
  if (b !== bio.last) {
    bio.last = b;
    if (b !== 'city') pushFeed({ alpine: 'FROSTPINE ALPINE — ICY & SLIPPERY', woods: 'EMERALD WOODS — STREAMS SLOW YOU DOWN', cove: 'SUNSET COVE — WADING SLOWS YOU DOWN' }[b], 'border-l-sky-400');
  }
  if (!bio.snow) {
    const N = 420, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = (rnd() - 0.5) * 44; pos[i * 3 + 1] = rnd() * 16; pos[i * 3 + 2] = (rnd() - 0.5) * 44; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    bio.snow = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.14, transparent: true, opacity: 0.9 }));
    bio.snow.frustumCulled = false;
    worldRoot.add(bio.snow);
  }
  bio.snow.visible = (b === 'alpine');
  if (b === 'alpine') {
    const a = bio.snow.geometry.attributes.position, arr = a.array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] -= (1.4 + (i % 5) * 0.35) * dt;
      arr[i] += Math.sin(elapsed + i) * 0.3 * dt;
      if (arr[i + 1] < -2) arr[i + 1] = 14;
    }
    a.needsUpdate = true;
    bio.snow.position.set(player.x, player.y, player.z);
  }
  const nb = buildNewBiomes.fire;
  if (nb) { const f = 0.85 + Math.sin(elapsed * 17) * 0.15 + Math.random() * 0.1; nb.fire.scale.set(f, 0.9 + Math.random() * 0.3, f); nb.fl.intensity = 1.3 + Math.random() * 0.6; }
  if (!gameState.inCar && player.grounded && isInWater(player.x, player.z) && (keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD']) && Math.random() < dt * 9) {
    spawnParticles(player.x, 0.3, player.z, 0x7dd3fc, 3, 2.5);
  }
}

export const rockMat=new THREE.MeshStandardMaterial({color:0x5a554d,roughness:1,flatShading:true});

export const pipeMat=new THREE.MeshStandardMaterial({color:0x6f7f77,roughness:.8,metalness:.35,side:THREE.BackSide});

export const concMat=new THREE.MeshStandardMaterial({color:0x7d8280,roughness:.95});

export const lampMat=new THREE.MeshBasicMaterial({color:0xffd27a});

export const waterMat=new THREE.MeshStandardMaterial({color:0x2f5f4a,roughness:.15,metalness:.2,transparent:true,opacity:.82,emissive:0x0b2a1e});

// ---- Mountains with winding road ----
export function buildMountains(){
  const X0=-138,X1=370,Z0=-170,Z1=-590,SX=254,SZ=210;
  const g=new THREE.PlaneGeometry(X1-X0,Z0-Z1,SX,SZ); g.rotateX(-Math.PI/2);
  const p=g.attributes.position, col=new Float32Array(p.count*3), c=new THREE.Color(), c2=new THREE.Color(), stv=SX+1, Hh=new Float32Array(p.count), dx=(X1-X0)/SX, dz=(Z0-Z1)/SZ;
  for(let i=0;i<p.count;i++){const x=p.getX(i)+(X0+X1)/2, z=p.getZ(i)+(Z0+Z1)/2, h=terrainH(x,z);Hh[i]=h;p.setXYZ(i,x,h-0.1,z);}
  for(let i=0;i<p.count;i++){
    const x=p.getX(i), z=p.getZ(i), h=Hh[i], cx=i%stv, cz=(i/stv)|0;
    const il=cx>0?i-1:i, ir=cx<SX?i+1:i, iu=cz>0?i-stv:i, id=cz<SZ?i+stv:i;
    const sl=Math.abs(Hh[ir]-Hh[il])/(2*dx)+Math.abs(Hh[id]-Hh[iu])/(2*dz), n=fbm(x*.08,z*.08,3), n2=fbm(x*.02+7,z*.02,3), snowLine=150+n*30;
    c.set(0x547a3a).lerp(c2.set(0x6e8a45),n);
    c.lerp(c2.set(0x34502f),sstep(35,70,h));
    c.lerp(c2.set(0x8a8070),sstep(95,140,h));
    c.lerp(c2.set(0x6d655b).lerp(new THREE.Color(0x8a8175),n),sstep(.4,.85,sl));
    if(sl>.4) c.multiplyScalar(.92+.08*Math.sin(h*.45+n*6));
    c.lerp(c2.set(0xf2f6fa),sstep(snowLine-12,snowLine+8,h)*(1-sstep(.7,1.0,sl)));
    c.multiplyScalar(.9+.2*n2);
    col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;
  }
  g.setAttribute('color',new THREE.BufferAttribute(col,3)); g.computeVertexNormals();
  const mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1})); mesh.receiveShadow=true; worldRoot.add(mesh);
  // road ribbon + lines
  function ribbon(hw,dy,hex,zs){const pos=[],idx=[];let k=0;
    for(let z=-168;z>=-584;z-=2.5){const cx=roadC(z),tx=roadC(z-1)-cx,len=Math.hypot(tx,1),nx=1/len,nz=-tx/len,y=roadH(z)+dy;
      pos.push(cx-nx*hw,y,z-nz*hw,cx+nx*hw,y,z+nz*hw); if(k>0){const a=(k-1)*2;idx.push(a,a+1,a+2,a+1,a+3,a+2);} k++;}
    const gg=new THREE.BufferGeometry();gg.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));gg.setIndex(idx);gg.computeVertexNormals();
    const m=new THREE.Mesh(gg,new THREE.MeshStandardMaterial({color:hex,roughness:.92,side:THREE.DoubleSide}));m.receiveShadow=true;worldRoot.add(m);}
  ribbon(5.2,0.05,0x23262b); ribbon(0.12,0.08,0xe9c33a);
  // pines + rocks
  const pineG=new THREE.ConeGeometry(2.1,8,7);pineG.translate(0,4.5,0);
  const pines=new THREE.InstancedMesh(pineG,new THREE.MeshStandardMaterial({color:0x1f3d24,roughness:1,flatShading:true}),1500);
  const rocks=new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1.6,0),rockMat,420);
  const dm=new THREE.Object3D();let np=0,nr=0;
  for(let k=0;k<16000&&(np<1500||nr<420);k++){
    const x=X0+8+Math.random()*(X1-X0-16),z=-175-Math.random()*400,h=terrainH(x,z),d=Math.abs(x-roadC(z));
    if(d<11) continue;
    const sl=Math.abs(terrainH(x+3,z)-terrainH(x-3,z))/6;
    if(np<1500&&h>4&&h<95&&sl<.55&&fbm(x*.05,z*.05,2)>.42){dm.position.set(x,h-.2,z);const s=.8+Math.random()*1.3;dm.scale.set(s,s*(.9+Math.random()*.6),s);dm.rotation.set(0,Math.random()*6,0);dm.updateMatrix();pines.setMatrixAt(np++,dm.matrix);}
    else if(nr<420&&sl>.3){dm.position.set(x,h,z);const s=.6+Math.random()*2.2;dm.scale.set(s,s*.7,s);dm.rotation.set(Math.random()*3,Math.random()*3,0);dm.updateMatrix();rocks.setMatrixAt(nr++,dm.matrix);}
  }
  pines.count=np;rocks.count=nr;pines.castShadow=true;worldRoot.add(pines,rocks);
  {const rp=[],ri=[],RW=5;let k=0;
    for(let z=-176;z>=-584;z-=3){const cx=riverX(z),y=Math.max(terrainH(cx,z),.3)+1.1;rp.push(cx-RW,y,z,cx+RW,y,z);if(k>0){const a=(k-1)*2;ri.push(a,a+2,a+1,a+1,a+2,a+3);}k++;}
    const rg=new THREE.BufferGeometry();rg.setAttribute('position',new THREE.Float32BufferAttribute(rp,3));rg.setIndex(ri);rg.computeVertexNormals();
    worldRoot.add(new THREE.Mesh(rg,new THREE.MeshStandardMaterial({color:0x3c8aa6,roughness:.12,metalness:.25,transparent:true,opacity:.8,side:THREE.DoubleSide})));}
  camera.far=1200;camera.updateProjectionMatrix();
}

export function buildSewer(){
  const root=new THREE.Group();worldRoot.add(root);
  const SW=5.4,H2=SW/2,WH=4.6,CY=SFY+WH,sg=new THREE.BoxGeometry(1,1,1);
  const wallM=new THREE.MeshStandardMaterial({color:0x6b706c,roughness:.95}),flrM=new THREE.MeshStandardMaterial({color:0x585c58,roughness:.9}),
        pipeM=new THREE.MeshStandardMaterial({color:0x7b5a3c,metalness:.5,roughness:.6}),blueM=new THREE.MeshBasicMaterial({color:0x38bdf8});
  const box=(m,x,y,z,a,b,d)=>{const o=new THREE.Mesh(sg,m);o.position.set(x,y,z);o.scale.set(a,b,d);root.add(o);return o;};
  const N={A:[-130,-30],B:[-40,-30],C:[20,-30],D:[48,-30],E:[150,-30],F:[48,-16],G:[20,-66],H:[20,24],I:[20,110],J:[-4,24]};
  const E=[['A','B'],['B','C'],['C','D'],['D','E'],['D','F'],['C','G'],['C','H'],['H','I'],['H','J']],exits=['J','F','B','G'];
  ['A','E','I'].forEach(k=>{const q=N[k];if(!collidesHorizontally(q[0],q[1],.2,1.8,1.4)&&!collidesHorizontally(q[0],q[1]+1,.2,1.8,1.4)){exits.push(k);manholes.push(q.slice());}});
  const dirOf=(p,q)=>p[0]!==q[0]?(q[0]>p[0]?'+x':'-x'):(q[1]>p[1]?'+z':'-z'),has={};
  for(const k in N)has[k]=new Set();
  for(const [a,b] of E){has[a].add(dirOf(N[a],N[b]));has[b].add(dirOf(N[b],N[a]));}
  const holeShape=new THREE.Shape();holeShape.moveTo(-H2,-H2);holeShape.lineTo(H2,-H2);holeShape.lineTo(H2,H2);holeShape.lineTo(-H2,H2);holeShape.closePath();
  const hp=new THREE.Path();hp.absarc(0,0,1.05,0,Math.PI*2,true);holeShape.holes.push(hp);
  const holeGeo=new THREE.ExtrudeGeometry(holeShape,{depth:.6,bevelEnabled:false});holeGeo.rotateX(Math.PI/2);
  const holeM=new THREE.MeshStandardMaterial({color:0x5a5e5a,roughness:.95,side:THREE.DoubleSide}),lamps=[];
  for(const k in N){const [x,z]=N[k],ex=exits.indexOf(k);
    sRects.push([x-H2,x+H2,z-H2,z+H2]);
    box(flrM,x,SFY-.25,z,SW,.5,SW);
    if(ex<0)box(wallM,x,CY+.3,z,SW,.6,SW);
    else{const c=new THREE.Mesh(holeGeo,holeM);c.position.set(x,CY+.6,z);root.add(c);
      const sh=new THREE.Mesh(new THREE.CylinderGeometry(1.05,1.05,-SFY+.1,16,1,true),new THREE.MeshStandardMaterial({color:0x4d514d,roughness:1,side:THREE.BackSide}));sh.position.set(x,(SFY+.1)/2,z);root.add(sh);
      for(const sx of[-.3,.3])box(blueM,x+sx,SFY/2,z+.95,.05,-SFY,.05);
      for(let y=SFY+.6;y<0;y+=.6)box(blueM,x,y,z+.95,.6,.05,.05);
      lamps.push([x,CY-.1,z+1.6]);}
    for(const d of['+x','-x','+z','-z'])if(!has[k].has(d)){const sgn=d[0]==='+'?1:-1;
      if(d[1]==='x')box(wallM,x+sgn*(H2+.25),SFY+WH/2,z,.5,WH,SW+1);else box(wallM,x,SFY+WH/2,z+sgn*(H2+.25),SW+1,WH,.5);}}
  for(const [a,b] of E){const A=N[a],B=N[b],ax=A[1]===B[1],cx=(A[0]+B[0])/2,cz=(A[1]+B[1])/2,L=(ax?Math.abs(A[0]-B[0]):Math.abs(A[1]-B[1]))-SW;
    sRects.push([Math.min(A[0],B[0])-H2,Math.max(A[0],B[0])+H2,Math.min(A[1],B[1])-H2,Math.max(A[1],B[1])+H2]);
    if(ax){box(flrM,cx,SFY-.25,cz,L,.5,SW);box(wallM,cx,CY+.3,cz,L,.6,SW);box(waterMat,cx,SFY+.04,cz,L,.06,1.5);
      for(const sd of[-1,1])box(wallM,cx,SFY+WH/2,cz+sd*(H2+.25),L,WH,.5);}
    else{box(flrM,cx,SFY-.25,cz,SW,.5,L);box(wallM,cx,CY+.3,cz,SW,.6,L);box(waterMat,cx,SFY+.04,cz,1.5,.06,L);
      for(const sd of[-1,1])box(wallM,cx+sd*(H2+.25),SFY+WH/2,cz,.5,WH,L);}
    const pg=new THREE.Mesh(new THREE.CylinderGeometry(.28,.28,L,10),pipeM);
    if(ax){pg.rotation.z=Math.PI/2;pg.position.set(cx,CY-.5,cz+H2-.6);}else{pg.rotation.x=Math.PI/2;pg.position.set(cx+H2-.6,CY-.5,cz);}root.add(pg);
    for(let t=-L/2+4;t<L/2-2;t+=9)lamps.push(ax?[cx+t,CY-.1,cz]:[cx,CY-.1,cz+t]);}
  const lm=new THREE.InstancedMesh(sg,lampMat,lamps.length),dm=new THREE.Object3D();
  lamps.forEach((l,i)=>{dm.position.set(l[0],l[1],l[2]);dm.scale.set(.6,.12,.6);dm.updateMatrix();lm.setMatrixAt(i,dm.matrix);});root.add(lm);
  const holeDiscG=new THREE.CircleGeometry(.72,20).rotateX(-Math.PI/2),holeDiscM=new THREE.MeshBasicMaterial({color:0x050505}),cvG=new THREE.CylinderGeometry(.75,.75,.06,20),cvM=new THREE.MeshStandardMaterial({color:0x2b2e31,metalness:.8,roughness:.5});
  manholes.forEach(m=>{const c=new THREE.Mesh(cvG,cvM);c.position.set(m[0],.22,m[1]);worldRoot.add(c);manholeCovers.push(c);manholeOpen.push(false);const hd=new THREE.Mesh(holeDiscG,holeDiscM);hd.position.set(m[0],.2,m[1]);hd.visible=false;worldRoot.add(hd);manholeHoles.push(hd);});
}

export function knockOverLamppost(l, y, s) { knockOverLamppostBase(l, y, s); if (s > 6) crime(.08); }

export function buildAuraEstates(){
  const bxG=new THREE.BoxGeometry(1,1,1),M=(c,r,e)=>new THREE.MeshStandardMaterial({color:c,roughness:r==null?.9:r,emissive:e||0,emissiveIntensity:e?1.2:0});
  const K={wall:M(0xe9e6df),roof:M(0x2b2f36),floor:M(0xd8dde0,.5),glass:M(0x8fb8d6,.15),red:M(0xdc2626),white:M(0xf5f5f5),wood:M(0x6b4a2f),sofa:M(0x394a5e),lamp:M(0xfff7d6,.5,0xfff7d6),gold:M(0xf5c542,.3,0xb8860b),stone:M(0xb9b2a6),drive:M(0x3a3d42),metal:M(0x20242a,.4),blue:M(0x7ec8e3),black:M(0x111111)};
  const bx=(g,m,x,y,z,a,b,d)=>{const o=new THREE.Mesh(bxG,m);o.position.set(x,y,z);o.scale.set(a,b,d);g.add(o);return o;};
  const wb=(x,y,z,a,b,d)=>addWorldBox(x-a/2,x+a/2,y-b/2,y+b/2,z-d/2,z+d/2,'solid',false);
  const culls=[],houses=[],gate={open:false,boxes:[],l1:null,l2:null};aura.culls=culls;
  // ---- Aura Hills terrain + winding road ----
  {const X0=-560,X1=-196,Z0=-172,Z1=172,N=114,g=new THREE.PlaneGeometry(X1-X0,Z1-Z0,N,N);g.rotateX(-Math.PI/2);
    const p=g.attributes.position,col=new Float32Array(p.count*3),H=new Float32Array(p.count),c=new THREE.Color(),c2=new THREE.Color(),st=N+1,dx=(X1-X0)/N,dz=(Z1-Z0)/N;
    for(let i=0;i<p.count;i++){const x=p.getX(i)+(X0+X1)/2,z=p.getZ(i)+(Z0+Z1)/2,h=hillsH(x,z);H[i]=h;p.setXYZ(i,x,h-.1,z);}
    for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i),h=H[i],cx=i%st,cz=(i/st)|0,il=cx>0?i-1:i,ir=cx<N?i+1:i,iu=cz>0?i-st:i,id=cz<N?i+st:i;
      const sl=Math.abs(H[ir]-H[il])/(2*dx)+Math.abs(H[id]-H[iu])/(2*dz),n=fbm(x*.06,z*.06,3);
      c.set(0x5b7d3c).lerp(c2.set(0x8a8f52),n);c.lerp(c2.set(0xa59a76),sstep(40,85,h));
      c.lerp(c2.set(0x4f8a3f),1-sstep(66,100,Math.hypot(x-AHC.px,z-AHC.pz)));
      c.lerp(c2.set(0x76705f),sstep(.35,.75,sl));c.multiplyScalar(.9+.2*n);col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
    g.setAttribute('color',new THREE.BufferAttribute(col,3));g.computeVertexNormals();
    const tm=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));tm.receiveShadow=true;worldRoot.add(tm);
    const pts=[];for(let s=0;s<=274;s+=3){const x=-196-s;pts.push([x,ahRz(x)]);}
    const ribbon=(w,dy,color)=>{const pos=[],idx=[];pts.forEach((q,k)=>{const a=pts[Math.max(0,k-1)],b=pts[Math.min(pts.length-1,k+1)],tx=b[0]-a[0],tz=b[1]-a[1],l=Math.hypot(tx,tz),nx=-tz/l,nz=tx/l,y=ahRy(q[0])+dy;
        pos.push(q[0]+nx*w,y,q[1]+nz*w,q[0]-nx*w,y,q[1]-nz*w);if(k){const i=(k-1)*2;idx.push(i,i+1,i+2,i+1,i+3,i+2);}});
      const rg=new THREE.BufferGeometry();rg.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));rg.setIndex(idx);rg.computeVertexNormals();
      const m=new THREE.Mesh(rg,new THREE.MeshStandardMaterial({color,roughness:.9,side:THREE.DoubleSide}));m.receiveShadow=true;worldRoot.add(m);};
    ribbon(4.8,.12,0x2a2d31);ribbon(.12,.16,0xe8c547);}
  // ---- Gated community ----
  {const WG=new THREE.Group();worldRoot.add(WG);
    const seg=(cx,cz,a,d)=>{bx(WG,K.stone,cx,39.7,cz,a,3.4,d);wb(cx,39.7,cz,a,3.4,d);};
    seg(-480,-85,96,.8);seg(-480,-5,96,.8);seg(-528,-45,.8,80);seg(-432,-67,.8,36);seg(-432,-23,.8,36);
    gate.l1=bx(WG,K.metal,-431.4,39.5,-47,.3,3,4);gate.l2=bx(WG,K.metal,-431.4,39.5,-43,.3,3,4);
    gate.boxes.push(wb(-432,39.5,-47,.6,3,4),wb(-432,39.5,-43,.6,3,4));
    bx(WG,K.stone,-432,41.9,-45,.9,1.4,10);
    const sg=new THREE.Group();sg.position.set(-431.4,41.9,-45);sg.rotation.y=Math.PI/2;createNeonSign(sg,'AURA ESTATES',0,0,0,'#111827','#fcd34d',7,1.1);worldRoot.add(sg);
    const HW=15,HD=11,HT=4.2,Y=38.18;
    [[-508,-68,1],[-508,-22,-1],[-470,-70,1],[-470,-20,-1],[-448,-70,1],[-448,-20,-1]].forEach(([cx,cz,dir],k)=>{
      const g=new THREE.Group();g.position.set(cx,Y,cz);worldRoot.add(g);const inn=new THREE.Group();g.add(inn);
      const fz=dir*HD/2,bz=-dir*HD/2,sw=(HW-2.6)/2,wm=k%2?K.wall:K.stone;
      bx(g,wm,0,HT/2,bz,HW,HT,.4);wb(cx,Y+HT/2,cz+bz,HW,HT,.4);
      for(const sd of[-1,1]){bx(g,wm,sd*HW/2,HT/2,0,.4,HT,HD);wb(cx+sd*HW/2,Y+HT/2,cz,.4,HT,HD);
        bx(g,wm,sd*(1.3+sw/2),HT/2,fz,sw,HT,.4);wb(cx+sd*(1.3+sw/2),Y+HT/2,cz+fz,sw,HT,.4);
        bx(g,K.glass,sd*(1.3+sw/2),2.3,fz+dir*.22,sw*.6,1.6,.05);}
      bx(g,wm,0,HT-.5,fz,2.6,1,.4);bx(g,K.roof,0,HT+.2,0,HW+1.4,.4,HD+1.4);bx(g,K.drive,0,.05,fz+dir*5.5,4,.1,11);
      bx(inn,K.wood,0,.02,0,HW-.6,.05,HD-.6);bx(inn,K.sofa,-3,.45,-dir*2.5,4,.9,1.2);bx(inn,K.wood,-3,.3,-dir*.6,2,.6,1);
      bx(inn,K.black,4,1.4,-dir*(HD/2-.4),3,1.6,.1);bx(inn,K.lamp,0,HT-.2,0,2,.1,2);bx(inn,K.wood,-5,.5,dir*3,1.2,1,2.4);
      const safe=bx(inn,K.gold,5.5,.5,dir*(HD/2-1.2),.9,.9,.7);
      houses.push({safe,sx:cx+5.5,sz:cz+dir*(HD/2-1.2),taken:false});culls.push({g:inn,x:cx,z:cz,r:65});});}
  // ---- Aura General Hospital (placed on the first clear lot) ----
  {const W=36,D=26,HH=7,T=.5;let hx=0,hz=0,found=false;
    const clear=(cx,cz)=>{for(let x=-W/2-4;x<=W/2+4;x+=6)for(let z=-D/2-4;z<=D/2+4;z+=6)if(collidesHorizontally(cx+x,cz+z,.2,1.8,1.5))return false;return true;};
    for(let x=-170;x<=110&&!found;x+=10)for(let z=-140;z<=160;z+=10)if(clear(x,z)){hx=x;hz=z;found=true;break;}
    if(found){const g=new THREE.Group();g.position.set(hx,.18,hz);worldRoot.add(g);const inn=new THREE.Group();g.add(inn);
      bx(g,K.white,0,HH/2,-D/2,W,HH,T);wb(hx,HH/2,hz-D/2,W,HH,T);
      for(const sd of[-1,1]){bx(g,K.white,sd*W/2,HH/2,0,T,HH,D);wb(hx+sd*W/2,HH/2,hz,T,HH,D);
        const sw=(W-6)/2;bx(g,K.white,sd*(3+sw/2),HH/2,D/2,sw,HH,T);wb(hx+sd*(3+sw/2),HH/2,hz+D/2,sw,HH,T);}
      bx(g,K.white,0,HH-1,D/2,6,2,T);bx(g,K.roof,0,HH+.25,0,W+1,.5,D+1);bx(g,K.white,0,4.6,D/2+2.5,10,.3,5);
      bx(g,K.red,-11,4.5,D/2+.3,1,4,.15);bx(g,K.red,-11,4.5,D/2+.3,4,1,.15);bx(g,K.red,11,4.5,D/2+.3,1,4,.15);bx(g,K.red,11,4.5,D/2+.3,4,1,.15);
      createNeonSign(g,'AURA GENERAL HOSPITAL',0,6.3,D/2+.3,'#ffffff','#dc2626',12,1.4);
      bx(inn,K.floor,0,.02,0,W-1,.05,D-1);
      for(let x=-15;x<=15;x+=6)for(const z of[-6,6])bx(inn,K.lamp,x,HH-.3,z,2.4,.1,.8);
      bx(inn,K.wood,0,.55,6,8,1.1,1.2);bx(inn,K.white,0,1.12,6,8.2,.08,1.4);
      for(let x=-14;x<=-8;x+=2)bx(inn,K.sofa,x,.4,10,1.2,.8,1);
      const bed=(x,z)=>{bx(inn,K.white,x,.45,z,1.1,.5,2.3);bx(inn,K.blue,x,.75,z+.3,1.1,.12,1.6);bx(inn,K.white,x,.8,z-.9,.7,.14,.5);};
      for(const x of[-14,-8,-2,8,13])bed(x,-D/2+3);
      for(const x of[-11,-5,10.5])bx(inn,K.blue,x,1.3,-D/2+3.2,.05,2.2,2.6);
      for(const x of[-16,-10,-4,6,11])bx(inn,K.metal,x,1,-D/2+4.2,.06,2,.06);
      aura.hospitalSpawn={x:hx-14,z:hz-D/2+5.6};culls.push({g:inn,x:hx,z:hz,r:80});}}
  // ---- I-88 highway upgrade: lighting poles + edge lines ----
  {const n=30,pg=new THREE.CylinderGeometry(.12,.16,9,8),hg=new THREE.BoxGeometry(2.2,.2,.5),poles=new THREE.InstancedMesh(pg,M(0x6b7280,.6),n),heads=new THREE.InstancedMesh(hg,K.lamp,n),d=new THREE.Object3D();let k=0;
    for(let i=0;i<15;i++)for(const sd of[-1,1]){const z=-180+i*27,x=sd<0?139.6:164.4;d.position.set(x,4.5,z);d.updateMatrix();poles.setMatrixAt(k,d.matrix);d.position.set(x-sd*1.1,9,z);d.updateMatrix();heads.setMatrixAt(k,d.matrix);k++;}
    worldRoot.add(poles,heads);const eg=new THREE.Group();worldRoot.add(eg);for(const x of[141.7,162.3])bx(eg,K.white,x,.13,10,.25,.02,400);}
  aura.ahCull=function(dt){
    for(let i=0;i<manholeCovers.length;i++){const c=manholeCovers[i],tx=manholes[i][0]+(manholeOpen[i]?1.5:0);c.position.x+=(tx-c.position.x)*Math.min(1,dt*6);manholeHoles[i].visible=manholeOpen[i];}
    for(const c of culls)c.g.visible=Math.hypot(player.x-c.x,player.z-c.z)<c.r;
    const go=gate.open?4:0;gate.l1.position.z+=((-47-go)-gate.l1.position.z)*Math.min(1,dt*3);gate.l2.position.z+=((-43+go)-gate.l2.position.z)*Math.min(1,dt*3);
    if(!under()&&player.x<-196)gameState.zoneName=player.x<-430?'AURA ESTATES':'AURA HILLS';};
  aura.ahHint=function(){if(!gate.open&&Math.hypot(player.x+432,player.z+45)<6)return '[F] FORCE OPEN GATE';for(const h of houses)if(!h.taken&&Math.hypot(player.x-h.sx,player.z-h.sz)<2.4)return '[F] CRACK SAFE';return '';};
  aura.ahF=function(){
    if(!gate.open&&Math.hypot(player.x+432,player.z+45)<6){gate.open=true;gate.boxes.forEach(b=>{const k=worldBoxes.indexOf(b);if(k>=0)worldBoxes.splice(k,1);});sfx.mantle();crime(.35);pushFeed('GATE FORCED OPEN — SECURITY ALERTED','border-l-rose-500');return;}
    for(const h of houses)if(!h.taken&&Math.hypot(player.x-h.sx,player.z-h.sz)<2.4){h.taken=true;h.safe.visible=false;gameState.cash+=600;spawnParticles(h.sx,39.5,h.sz,0xf5c542,14,5);sfx.pickup();crime(.5);pushFeed('SAFE CRACKED +$600','border-l-amber-400');hooks.updateHUD(true);return;}};
}

export function buildAuraSkylineAndHighway(){
  const rr=n=>{const v=Math.sin(n*127.1)*43758.5453;return v-Math.floor(v);},sm=c=>new THREE.MeshStandardMaterial({color:c,roughness:.85});
  // ---- Taller skyline: glass towers on clear lots ----
  {const cv=document.createElement('canvas');cv.width=64;cv.height=128;const x=cv.getContext('2d');x.fillStyle='#1d2b3a';x.fillRect(0,0,64,128);
    for(let r=0;r<16;r++)for(let c=0;c<8;c++){x.fillStyle=rr(r*9+c)<.35?'#ffe9a8':'#2f4a63';x.fillRect(c*8+1,r*8+1,6,6);}
    const base=new THREE.CanvasTexture(cv);base.colorSpace=THREE.SRGBColorSpace;base.wrapS=base.wrapT=THREE.RepeatWrapping;
    const tg=new THREE.BoxGeometry(1,1,1),roofM=sm(0x20242a);let placed=0;
    const clearT=(cx,cz,w)=>{for(let a=-w/2-3;a<=w/2+3;a+=5)for(let b=-w/2-3;b<=w/2+3;b+=5)if(collidesHorizontally(cx+a,cz+b,.2,1.8,1.5))return false;return true;};
    for(let k=1;k<600&&placed<9;k++){const cx=-170+rr(k*1.3)*290,cz=-150+rr(k*2.9)*320,w=14+rr(k)*6,h=45+rr(k*5.1)*50;
      if(Math.hypot(cx+11.5,cz-18.5)<30||manholes.some(m=>Math.hypot(cx-m[0],cz-m[1])<w))continue;
      if(!clearT(cx,cz,w))continue;
      const t=base.clone();t.needsUpdate=true;t.repeat.set(Math.round(w/3),Math.round(h/6));
      const m=new THREE.Mesh(tg,new THREE.MeshStandardMaterial({map:t,emissiveMap:t,emissive:0xffffff,emissiveIntensity:.25,roughness:.25,metalness:.4}));
      m.position.set(cx,h/2,cz);m.scale.set(w,h,w);m.castShadow=true;m.receiveShadow=true;worldRoot.add(m);
      const r=new THREE.Mesh(tg,roofM);r.position.set(cx,h+.4,cz);r.scale.set(w+.6,.8,w+.6);worldRoot.add(r);
      addWorldBox(cx-w/2,cx+w/2,0,h,cz-w/2,cz+w/2,'tower',false);placed++;}}
  // ---- Highway: lane studs + overhead gantries ----
  {const sg=new THREE.InstancedMesh(new THREE.BoxGeometry(.2,.05,.2),new THREE.MeshBasicMaterial({color:0xffb020}),50),d=new THREE.Object3D();
    for(let i=0;i<50;i++){d.position.set(152,.14,-185+i*8);d.updateMatrix();sg.setMatrixAt(i,d.matrix);}worldRoot.add(sg);
    const gm=sm(0x6b7280);
    [[-110,'AURA HILLS  EXIT 12'],[140,'DOWNTOWN  EXIT 14']].forEach(([gz,txt])=>{const g=new THREE.Group();worldRoot.add(g);
      for(const px of[139.5,164.5]){const o=new THREE.Mesh(new THREE.BoxGeometry(.6,7,.6),gm);o.position.set(px,3.5,gz);g.add(o);}
      const b=new THREE.Mesh(new THREE.BoxGeometry(26,.5,.6),gm);b.position.set(152,7.2,gz);g.add(b);
      createNeonSign(g,txt,152,5.9,gz+.35,'#0b5d2a','#ffffff',10,1.6);});}
  // ---- Aura Hills trees ----
  {const n=500,mesh=new THREE.InstancedMesh(new THREE.ConeGeometry(2,7,7),sm(0x2f5d34),n),d=new THREE.Object3D();let c=0;
    for(let k=1;k<5000&&c<n;k++){const x=-216-rr(k*2.1)*338,z=-165+rr(k*3.7)*330,h=hillsH(x,z);
      const sl=Math.abs(hillsH(x+3,z)-hillsH(x-3,z))/6,dr=Math.abs(z-ahRz(x))/Math.hypot(1,ahRzD(x));
      if(sl>.7||h<3||(-196-x<300&&dr<12)||Math.hypot(x-AHC.px,z-AHC.pz)<72)continue;
      d.position.set(x,h+3.2,z);d.scale.setScalar(.8+rr(k)*.9);d.updateMatrix();mesh.setMatrixAt(c++,d.matrix);}
    mesh.count=c;mesh.castShadow=true;worldRoot.add(mesh);}
}
// ============================================================================
// DATA-DRIVEN WORLD ENTITIES (levelData.entities) + WORLD BOOT SEQUENCE
// ============================================================================
/** entity.id -> { entity, object, record }. Studio uses this to move/edit entities live. */
export const entityObjects = new Map();

const ENTITY_Y_OFFSET = { pickup: 0.55 };

function tagEntity(root, id) {
  root.userData.entityId = id;
  root.traverse((child) => { child.userData.entityId = id; });
}

function applyEntityLook(object, entity) {
  if (entity.color && entity.type !== 'vehicle' && entity.type !== 'block' && entity.type !== 'prop' && entity.type !== 'ramp') applyEntityColor(object, entity.color);
  if (entity.texture) applyEntityTexture(object, entity.texture, (entity.texRepeat || [1, 1])[0], (entity.texRepeat || [1, 1])[1]);
}

function makeRampMesh(color) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0); shape.lineTo(0.5, 0); shape.lineTo(0.5, 1); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  g.rotateY(-Math.PI / 2); // length axis -> local +Z (low end at -Z, high end at +Z), width on X
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, makeMat(colorToHex(color, 0xf59e0b), { roughness: 0.7 }));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function makePrimitiveMesh(shape, color, fallback) {
  let geo;
  if (shape === 'cylinder') geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
  else if (shape === 'sphere') geo = new THREE.SphereGeometry(0.5, 20, 14);
  else if (shape === 'cone') geo = new THREE.ConeGeometry(0.5, 1, 20);
  else geo = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Mesh(geo, makeMat(colorToHex(color, fallback), { roughness: 0.8 }));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/**
 * Build (and, when register=true, activate for gameplay) one entity.
 * register=false is used by Studio: visuals only, no vehicles/pickups/colliders are registered.
 * Returns { object, record }.
 */
export function createEntityObject(entity, { register = true } = {}) {
  const [x, y, z] = entity.pos;
  const rot = entity.rot || [0, 0, 0];
  const scale = entity.scale || [1, 1, 1];
  let object = null;
  let record = null;

  switch (entity.type) {
    case 'vehicle': {
const v = entity.vehicle || {};
const cfg = {
  name: entity.name,
  bodyHex: colorToHex(entity.color || v.bodyHex, 0xdc2626),
  accentHex: colorToHex(v.accentHex, 0xf8fafc),
  x, z, yaw: rot[1],
  isCoupe: v.isCoupe !== false,
  isSupercar: !!v.isSupercar
};
if (register) { record = buildSportsCar(cfg); object = record.root; record.y = y; }
else { object = buildSportsCarMesh(cfg).root; worldRoot.add(object); object.rotation.set(rot[0], rot[1], rot[2]); }
object.position.y = y;
if (scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1) object.scale.set(scale[0], scale[1], scale[2]);
if (!entity.color) applyModelPreset(v.isSupercar ? 'apex_gt' : 'coupe', object);
break;
    }
    case 'pickup': {
const p = entity.pickup || { kind: 'left', itemId: 'cash' };
if (register) { record = spawnWorldPickup(p.kind, p.itemId, x, y, z, { rot, scale }); object = record.group; }
else {
  object = buildPickupMesh(p.kind, p.itemId);
  object.position.set(x, y + 0.55, z); object.rotation.set(rot[0], rot[1], rot[2]); object.scale.set(scale[0], scale[1], scale[2]);
  worldRoot.add(object);
}
if (p.kind === 'right') applyModelPreset(p.itemId, object);
break;
    }
    case 'crate': {
if (register) { record = spawnSmashCrate(x, y, z, entity.loot || null, { rot, scale }); object = record.mesh; }
else {
  object = buildCrateMesh();
  object.position.set(x, y, z); object.rotation.set(rot[0], rot[1], rot[2]); object.scale.set(scale[0], scale[1], scale[2]);
  worldRoot.add(object);
}
break;
    }
    case 'barrel': {
if (register) { record = spawnHazardBarrel(x, y, z, { rot, scale }); object = record.mesh; }
else {
  object = buildBarrelMesh();
  object.position.set(x, y, z); object.rotation.set(rot[0], rot[1], rot[2]); object.scale.set(scale[0], scale[1], scale[2]);
  worldRoot.add(object);
}
break;
    }
    case 'ramp': {
object = makeRampMesh(entity.color);
object.position.set(x, y, z); object.rotation.set(rot[0], rot[1], rot[2]); object.scale.set(scale[0], scale[1], scale[2]);
worldRoot.add(object);
if (register) {
  object.updateMatrixWorld(true);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const sx of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
    const p = new THREE.Vector3(sx, 0, sz).applyMatrix4(object.matrixWorld);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const fx = Math.sin(rot[1]), fz = Math.cos(rot[1]);
  const axis = Math.abs(fx) > Math.abs(fz) ? 'x' : 'z';
  const dir = (axis === 'x' ? fx : fz) >= 0 ? 1 : -1;
  const base = y, top = y + scale[1];
  addDriveableRamp({ minX, maxX, minZ, maxZ, startY: dir > 0 ? base : top, endY: dir > 0 ? top : base, axis, dir });
  record = { minX, maxX, minZ, maxZ };
}
break;
    }
    case 'block':
    case 'prop': {
const shape = entity.type === 'block' ? 'box' : ((entity.prop && entity.prop.shape) || 'box');
object = makePrimitiveMesh(shape, entity.color, entity.type === 'block' ? 0x94a3b8 : 0x38bdf8);
object.position.set(x, y, z); object.rotation.set(rot[0], rot[1], rot[2]); object.scale.set(scale[0], scale[1], scale[2]);
worldRoot.add(object);
const solid = entity.type === 'block' || !entity.prop || entity.prop.solid !== false;
if (register && solid) {
  object.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(object);
  record = addWorldBox(bb.min.x, bb.max.x, bb.min.y, bb.max.y, bb.min.z, bb.max.z, 'entity_' + entity.type, true);
}
break;
    }
    default:
console.warn('[world] unknown entity type', entity.type);
return { object: null, record: null };
  }

  applyEntityLook(object, entity);
  tagEntity(object, entity.id);
  entityObjects.set(entity.id, { entity, object, record });
  return { object, record };
}

export function spawnLevelEntities(data = levelData, opts = {}) {
  for (const e of data.entities) createEntityObject(e, opts);
}

/** Remove an entity's visuals (Studio). Collision records are only created in-game, so nothing else to undo. */
export function removeEntityObject(id) {
  const rec = entityObjects.get(id);
  if (!rec) return;
  if (rec.object && rec.object.parent) rec.object.parent.remove(rec.object);
  entityObjects.delete(id);
}

/** Re-apply an entity's transform to its live 3D object (Studio gizmo / inspector edits). */
export function updateEntityTransform(entity) {
  const rec = entityObjects.get(entity.id);
  if (!rec || !rec.object) return;
  const o = rec.object;
  o.position.set(entity.pos[0], entity.pos[1] + (ENTITY_Y_OFFSET[entity.type] || 0), entity.pos[2]);
  o.rotation.set(entity.rot[0], entity.rot[1], entity.rot[2]);
  o.scale.set(entity.scale[0], entity.scale[1], entity.scale[2]);
}

/** Show every proximity-LOD interior (Studio wants to see everything at once). */
export function revealAllLods() {
  buildingLods.forEach((e) => { e.group.visible = true; e.active = true; });
  (aura.culls || []).forEach((c) => { c.g.visible = true; });
}

/**
 * Build the complete world in the exact order of the original game:
 * static city/freeway/desert/biomes/landmarks -> data-driven entities -> Aura Hills overhaul.
 * Used identically by index.html (register=true) and studio.html (register=false).
 */
export function buildWorld(data = levelData, { register = true, afterStatic = null } = {}) {
  buildRoadsFreewayAndDesert();
  buildRedrockDesertBiome();
  buildNewBiomes();
  buildJungleBiome();
  buildCityLandmarks();
  spawnLevelEntities(data, { register });
  if (afterStatic) afterStatic();
  buildMountains();
  buildSewer();
  buildAuraEstates();
  buildAuraSkylineAndHighway();
}

// Register late-bound implementations for lower layers (see state.js).
Object.assign(hooks, { knockOverLamppost });
