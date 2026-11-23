// =============================================================================
// world.js — Roads, the continuous I-88 interstate, biomes, walk-in interiors,
// skyscrapers, Aura Hills, sewers, Los Aura expansion and the entity spawner.
// =============================================================================
import * as THREE from 'three';
import { colorToHex, levelData, terrainHeightOffset } from './levelData.js';
import {
  AHC, I88, SFY, addDriveableRamp, addWorldBox, ahRy, ahRz, ahRzD, aura, aviationBeacons,
  biomeAt, buildingLods, collidesHorizontally, crime, driveableRamps, enterableZones,
  fbm, gameState, hazardBarrels, hillsH, hooks, iceZones, isInWater, keys, lampPosts,
  manholeCovers, manholeHoles, manholeOpen, manholes, mapShapes, pick, player, pushFeed,
  recomputeWorldBounds, registerBuildingLod, resetWorldState, riverX, rnd, roadC, roadH,
  sRects, sausageRefillZones, skyscrapers, smashableCrates, sstep, terrainBaseH, terrainH,
  under, waterZones, worldBoxes, worldPickups
} from './state.js';
import {
  camera, highDetailObjects, makeMat, realWindowGlassMat, regHigh, scene, worldRoot
} from './engine.js';
import { applyEntityColor, applyEntityTexture, applyModelPreset, loadTexture } from './assets.js';
import { sfx } from './audio.js';
import {
  buildBarrelMesh, buildCrateMesh, buildPickupMesh, spawnHazardBarrel, spawnParticles,
  spawnSmashCrate, spawnWorldPickup
} from './items.js';
import { buildSportsCar, buildSportsCarMesh, vehicles } from './vehicles.js';

export const rockMat = new THREE.MeshStandardMaterial({ color: 0x5a554d, roughness: 1, flatShading: true });
export const pipeMat = new THREE.MeshStandardMaterial({ color: 0x6f7f77, roughness: .8, metalness: .35, side: THREE.BackSide });

const treeBarkTexture = loadTexture('assets/textures/bark.png', { repeatX: 1, repeatY: 4 });
const treeLeafTexture = loadTexture('assets/textures/lushfoliage.png', { repeatX: 2, repeatY: 2 });
const treeBarkMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, map: treeBarkTexture, roughness: 0.92, flatShading: true });
const treeLeafMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, map: treeLeafTexture, roughness: 0.88, flatShading: true, side: THREE.DoubleSide, alphaTest: 0.35 });

/**
 * Studio road entities superseded by the built-in continuous I-88 viaduct.
 * They stacked conflicting driveable ramps and z-fighting decks over the same
 * corridor. Skipped here so existing localStorage saves are cleaned up too;
 * they should also be deleted from levelData.entities.
 */
const RETIRED_ENTITY_IDS = new Set(['road_mwr8epy21', 'road_mwr8fxyy2', 'road_mwsebg0p1']);

// -----------------------------------------------------------------------------
// Terrain sculpting
// -----------------------------------------------------------------------------
export const sculptableTerrainMeshes = [];

function registerSculptableTerrain(mesh) {
  const positions = mesh.geometry.attributes.position;
  mesh.userData.terrainBaseY = Float32Array.from(positions.array.filter((_, index) => index % 3 === 1));
  const bounds = new THREE.Box3().setFromBufferAttribute(positions);
  mesh.userData.terrainBounds = {
    minX: bounds.min.x + mesh.position.x, maxX: bounds.max.x + mesh.position.x,
    minZ: bounds.min.z + mesh.position.z, maxZ: bounds.max.z + mesh.position.z
  };
  mesh.userData.sculptableTerrain = true;
  sculptableTerrainMeshes.push(mesh);
  refreshTerrainSculpt(mesh.position.x, mesh.position.z, Infinity, mesh);
  return mesh;
}

/** Update visible terrain meshes after a sculpt stroke or undo/redo. */
export function refreshTerrainSculpt(centerX = null, centerZ = null, radius = Infinity, onlyMesh = null) {
  const meshes = onlyMesh ? [onlyMesh] : sculptableTerrainMeshes;
  for (const mesh of meshes) {
    const positions = mesh.geometry.attributes.position;
    const baseY = mesh.userData.terrainBaseY;
    const partial = Number.isFinite(radius);
    const bounds = mesh.userData.terrainBounds;
    if (partial && (centerX + radius < bounds.minX - 3 || centerX - radius > bounds.maxX + 3
      || centerZ + radius < bounds.minZ - 3 || centerZ - radius > bounds.maxZ + 3)) continue;
    let changed = false;
    for (let i = 0; i < positions.count; i++) {
      const x = mesh.position.x + positions.getX(i), z = mesh.position.z + positions.getZ(i);
      if (partial && Math.hypot(x - centerX, z - centerZ) > radius + 3) continue;
      positions.setY(i, baseY[i] + terrainHeightOffset(x, z));
      changed = true;
    }
    if (changed) {
      positions.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingSphere();
    }
  }
}

function terrainPlane(width, depth, x, y, z, material) {
  const geometry = new THREE.PlaneGeometry(width, depth, Math.ceil(width / 2), Math.ceil(depth / 2));
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  registerSculptableTerrain(mesh);
  return mesh;
}

/** Highest natural ground over a rectangular footprint (for founding buildings). */
function maxTerrainOver(x0, x1, z0, z1) {
  let m = -Infinity;
  for (const x of [x0, (x0 + x1) / 2, x1]) {
    for (const z of [z0, (z0 + z1) / 2, z1]) m = Math.max(m, terrainH(x, z));
  }
  return m;
}

// -----------------------------------------------------------------------------
// Walls & windows
// -----------------------------------------------------------------------------
/** Wall segment with a real rectangular window cutout, glass on both faces. */
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

  // Two single-sided panes: keeps the cheap FrontSide material but is visible
  // from inside AND outside.
  const paneGeo = new THREE.PlaneGeometry(winW, winH);
  const glassOut = new THREE.Mesh(paneGeo, realWindowGlassMat);
  glassOut.position.set(0, winCenterY, 0.012);
  const glassIn = new THREE.Mesh(paneGeo, realWindowGlassMat);
  glassIn.position.set(0, winCenterY, -0.012);
  glassIn.rotation.y = Math.PI;

  const sill = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.16, 0.08, thick + 0.12), makeMat(0xf8fafc));
  sill.position.set(0, winCenterY - winH / 2, 0);
  group.add(leftWall, rightWall, botWall, topWall, glassOut, glassIn, sill);
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

// -----------------------------------------------------------------------------
// Neon signs — auto-fitting text, plain sides
// -----------------------------------------------------------------------------
export function createNeonSign(parent, text, x, y, z, bgHex, textHex, w = 4.4, h = 1.1) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = textHex;
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.fillStyle = textHex;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let fontSize = 42;
  for (;;) {
    ctx.font = `bold ${fontSize}px Oswald, sans-serif`;
    if (ctx.measureText(text).width <= 476 || fontSize <= 14) break;
    fontSize -= 2;
  }
  ctx.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const faceMat = new THREE.MeshStandardMaterial({
    map: tex, emissive: new THREE.Color(textHex), emissiveMap: tex,
    emissiveIntensity: 0.75, roughness: 0.25, metalness: 0.4
  });
  const sideMat = makeMat(colorToHex(bgHex, 0x0f172a), { roughness: 0.4, metalness: 0.5 });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.22), [sideMat, sideMat, sideMat, sideMat, faceMat, faceMat]);
  sign.position.set(x, y, z);
  sign.userData.studioName = `Sign: ${text}`;
  parent.add(sign);
  return sign;
}

// =============================================================================
// I-88 INTERSTATE — one continuous professional freeway
//
//   ground   southEnd .. rampUpStart
//   climb    rampUpStart .. rampUpEnd            groundY -> deckY
//   viaduct  deckStart .. deckEnd                (grade separated, no crossings)
//   approach bridgeRampStart .. bridgeRampEnd    deckY -> bridgeY
//   bridge   bridgeStart .. bridgeEnd            (ocean suspension span)
//   descent  rampDownStart .. rampDownEnd        bridgeY -> northY
//   ground   rampDownEnd .. northEnd
//
// Every surface, barrier, rail, marking and light is derived from I88 so the
// visuals and the collision can never disagree.
// =============================================================================
function buildInterstate88() {
  const F = I88;
  const X = F.x, HW = F.halfW, W = HW * 2;
  const RAIL_X = HW - 0.35;             // barrier centreline -> ~20.6 m clear width
  const grp = new THREE.Group();
  grp.userData.studioName = 'I-88 Interstate';
  worldRoot.add(grp);

  const fwyMat = makeMat(0x1f2937, { texType: 'asphalt', repeatX: 4, repeatY: 90, roughness: 0.84, bumpScale: 0.015 });
  const deckMat = makeMat(0x27303d, { texType: 'concrete', repeatX: 4, repeatY: 40, roughness: 0.86 });
  const barrierMat = makeMat(0xd1d5db, { texType: 'concrete', repeatX: 24, repeatY: 1, roughness: 0.88 });
  const steelMat = makeMat(0xe2e8f0, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.18, flatShading: false });
  const towerMat = makeMat(0xdc2626, { metalness: 0.65, roughness: 0.32 });
  const yellowMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
  const studMat = new THREE.MeshBasicMaterial({ color: 0xffb020 });

  const box = (w, h, d, mat, x, y, z, cast = false) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    grp.add(m);
    return m;
  };

  // ---- marking collectors (one InstancedMesh per colour) ----
  const yellowT = [], whiteT = [], studT = [];
  const md = new THREE.Object3D();
  const mark = (list, x, y, z, sx, sy, sz, rx = 0) => {
    md.position.set(x, y, z);
    md.rotation.set(rx, 0, 0);
    md.scale.set(sx, sy, sz);
    md.updateMatrix();
    list.push(md.matrix.clone());
  };

  /** Centre double-yellow, lane dividers and solid edge lines along a run. */
  const markings = (z0, z1, yAt, angle = 0) => {
    const mid = (z0 + z1) / 2;
    const len = z1 - z0;
    const ym = yAt(mid);
    const lift = 0.035;
    for (const off of [-0.3, 0.3]) {
      mark(yellowT, X + off, ym + lift, mid, 0.22, 0.05, len - 0.4, angle);
    }
    for (const off of [-(HW - 0.9), HW - 0.9]) {
      mark(whiteT, X + off, ym + lift, mid, 0.22, 0.05, len - 0.4, angle);
    }
    for (let z = z0 + 4; z < z1 - 3; z += 8) {
      for (const off of [-5.5, 5.5]) {
        mark(whiteT, X + off, yAt(z) + lift, z, 0.24, 0.05, 3.4, angle);
      }
      mark(studT, X, yAt(z) + lift + 0.02, z, 0.2, 0.05, 0.2, angle);
    }
  };

  /** Flat carriageway slab + standable collider. */
  const flat = (z0, z1, y, thick = 0.14, mat = fwyMat) => {
    box(W, thick, z1 - z0, mat, X, y - thick / 2, (z0 + z1) / 2);
    addWorldBox(X - HW, X + HW, y - thick, y, z0, z1, 'i88_surface', true);
    markings(z0, z1, () => y, 0);
  };

  /** Sloped carriageway + driveable ramp. */
  const ramp = (z0, z1, y0, y1) => {
    const run = z1 - z0, rise = y1 - y0;
    const hyp = Math.hypot(run, rise), ang = Math.atan2(rise, run);
    const m = new THREE.Mesh(new THREE.BoxGeometry(W, 0.4, hyp), fwyMat);
    m.position.set(X, (y0 + y1) / 2 - 0.2, (z0 + z1) / 2);
    m.rotation.x = -ang;
    m.castShadow = true;
    m.receiveShadow = true;
    grp.add(m);
    addDriveableRamp({ minX: X - HW, maxX: X + HW, minZ: z0, maxZ: z1, startY: y0, endY: y1, axis: 'z', dir: 1 });
    const yAt = (z) => y0 + rise * ((z - z0) / run);
    markings(z0, z1, yAt, -ang);
    return yAt;
  };

  /** Continuous safety rail following a slope (single AABB per side). */
  const slopedRail = (z0, z1, y0, y1) => {
    const run = z1 - z0, rise = y1 - y0;
    const hyp = Math.hypot(run, rise), ang = Math.atan2(rise, run);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.05, hyp), barrierMat);
      m.position.set(X + s * RAIL_X, (y0 + y1) / 2 + 0.52, (z0 + z1) / 2);
      m.rotation.x = -ang;
      m.castShadow = true;
      grp.add(m);
      addWorldBox(X + s * RAIL_X - 0.35, X + s * RAIL_X + 0.35,
        Math.min(y0, y1), Math.max(y0, y1) + 1.05, z0, z1, 'i88_rail', true);
    }
  };

  const flatRail = (z0, z1, y) => {
    for (const s of [-1, 1]) {
      box(0.7, 1.05, z1 - z0, barrierMat, X + s * RAIL_X, y + 0.52, (z0 + z1) / 2, true);
      addWorldBox(X + s * RAIL_X - 0.35, X + s * RAIL_X + 0.35, y, y + 1.05, z0, z1, 'i88_rail', true);
    }
  };

  /** At-grade barrier run with interchange openings. */
  const barrierRun = (z0, z1, y, openings) => {
    const cuts = openings
      .map((c) => [c - F.openingHalf, c + F.openingHalf])
      .filter(([a, b]) => a > z0 && b < z1)
      .sort((p, q) => p[0] - q[0]);
    const seg = (a, b) => {
      if (b - a < 0.5) return;
      for (const s of [-1, 1]) {
        box(0.6, 1.05, b - a, barrierMat, X + s * RAIL_X, y + 0.52, (a + b) / 2, true);
        addWorldBox(X + s * RAIL_X - 0.32, X + s * RAIL_X + 0.32, y - 0.05, y + 1.05, a, b, 'i88_barrier', true);
      }
    };
    let cursor = z0;
    for (const [a, b] of cuts) { seg(cursor, a); cursor = b; }
    seg(cursor, z1);
  };

  // ---- 1. Southern at-grade section -------------------------------------
  flat(F.southEnd, F.rampUpStart, F.groundY);
  barrierRun(F.southEnd, F.rampUpStart, F.groundY, F.westOpenings.concat(F.eastOpenings));

  // ---- 2. Climb onto the viaduct ----------------------------------------
  const upY = ramp(F.rampUpStart, F.rampUpEnd, F.groundY, F.deckY);
  slopedRail(F.rampUpStart, F.rampUpEnd, F.groundY, F.deckY);

  // ---- 3. Elevated viaduct (no at-grade crossings) ----------------------
  flat(F.deckStart, F.deckEnd, F.deckY, 0.5, deckMat);
  flatRail(F.deckStart, F.deckEnd, F.deckY);
  for (let z = F.deckStart + 6; z <= F.deckEnd - 4; z += 18) {
    for (const s of [-1, 1]) {
      const px = X + s * 8.4;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.95, F.deckY - 0.5, 10), barrierMat);
      col.position.set(px, (F.deckY - 0.5) / 2, z);
      col.castShadow = true;
      grp.add(col);
      addWorldBox(px - 0.95, px + 0.95, 0.05, F.deckY - 0.5, z - 0.95, z + 0.95, 'i88_pillar', false);
    }
    box(W - 1.4, 0.55, 1.6, barrierMat, X, F.deckY - 0.72, z, true);
  }

  // ---- 4. Bridge approach ----------------------------------------------
  ramp(F.bridgeRampStart, F.bridgeRampEnd, F.deckY, F.bridgeY);
  slopedRail(F.bridgeRampStart, F.bridgeRampEnd, F.deckY, F.bridgeY);

  // ---- 5. Ocean suspension span ----------------------------------------
  flat(F.bridgeStart, F.bridgeEnd, F.bridgeY, 0.65, deckMat);
  flatRail(F.bridgeStart, F.bridgeEnd, F.bridgeY);

  const towerTopY = 48.0;
  const towerZs = [248, 332];
  for (const tz of towerZs) {
    for (const s of [-1, 1]) {
      const tx = X + s * 11.6;
      // Marine pier — collider clamped OUTSIDE the running lanes.
      box(3.4, F.bridgeY + 1.0, 4.4, barrierMat, tx, (F.bridgeY + 1.0) / 2, tz, true);
      const p0 = s < 0 ? tx - 1.7 : Math.max(tx - 1.7, X + HW);
      const p1 = s < 0 ? Math.min(tx + 1.7, X - HW) : tx + 1.7;
      addWorldBox(p0, p1, 0, F.bridgeY + 1.0, tz - 2.2, tz + 2.2, 'bridge_pier', false);
      box(1.6, towerTopY, 2.0, towerMat, tx, towerTopY / 2, tz, true);
      addWorldBox(p0, p1, F.bridgeY, towerTopY, tz - 1.05, tz + 1.05, 'bridge_tower', false);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
      beacon.position.set(tx, towerTopY + 0.4, tz);
      aviationBeacons.push(beacon);
      grp.add(beacon);
    }
    box(24.8, 1.8, 1.6, towerMat, X, 26.0, tz, true);
    box(24.8, 2.2, 1.8, towerMat, X, 44.5, tz, true);
  }

  const cableY = (z) => {
    if (z <= towerZs[0]) {
      const t = Math.max(0, (z - F.bridgeStart) / (towerZs[0] - F.bridgeStart));
      return F.bridgeY + 1.2 + (towerTopY - F.bridgeY - 2.0) * t * t;
    }
    if (z >= towerZs[1]) {
      const t = Math.max(0, (F.bridgeEnd - z) / (F.bridgeEnd - towerZs[1]));
      return F.bridgeY + 1.2 + (towerTopY - F.bridgeY - 2.0) * t * t;
    }
    const mid = (towerZs[0] + towerZs[1]) / 2;
    const u = (z - mid) / ((towerZs[1] - towerZs[0]) / 2);
    return F.bridgeY + 4.5 + (towerTopY - F.bridgeY - 5.3) * u * u;
  };
  for (const s of [-1, 1]) {
    const cx = X + s * 11.6;
    const pts = [];
    for (let z = F.bridgeStart; z <= F.bridgeEnd; z += 4) pts.push(new THREE.Vector3(cx, cableY(z), z));
    grp.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 44, 0.24, 8, false), towerMat));
    for (let z = F.bridgeStart + 6; z <= F.bridgeEnd - 6; z += 6) {
      const h = cableY(z) - F.bridgeY;
      if (h > 0.6) box(0.08, h, 0.08, steelMat, cx, F.bridgeY + h / 2, z);
    }
  }

  // ---- 6. Descent to the northern landmass ------------------------------
  ramp(F.rampDownStart, F.rampDownEnd, F.bridgeY, F.northY);
  slopedRail(F.rampDownStart, F.rampDownEnd, F.bridgeY, F.northY);

  // ---- 7. Northern at-grade section -------------------------------------
  flat(F.rampDownEnd, F.northEnd, F.northY);
  barrierRun(F.rampDownEnd, F.northEnd, F.northY, F.westOpenings.concat(F.eastOpenings));

  // ---- Flush the marking instances --------------------------------------
  const flush = (list, mat) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.receiveShadow = false;
    grp.add(im);
  };
  flush(yellowT, yellowMat);
  flush(whiteT, whiteMat);
  flush(studT, studMat);

  // ---- Lighting: ground poles + deck-mounted lamps ----------------------
  const poleT = [], headT = [];
  const ld = new THREE.Object3D();
  const lampAt = (x, y, z, s) => {
    ld.position.set(x, y + 4.5, z); ld.rotation.set(0, 0, 0); ld.scale.set(1, 1, 1); ld.updateMatrix();
    poleT.push(ld.matrix.clone());
    ld.position.set(x - s * 1.1, y + 9.0, z); ld.updateMatrix();
    headT.push(ld.matrix.clone());
  };
  for (let z = F.southEnd + 10; z < F.rampUpStart - 4; z += 27) {
    for (const s of [-1, 1]) lampAt(X + s * (HW + 1.6), F.groundY, z, s);
  }
  for (let z = F.rampDownEnd + 12; z < F.northEnd - 6; z += 27) {
    for (const s of [-1, 1]) lampAt(X + s * (HW + 1.6), F.northY, z, s);
  }
  for (let z = F.deckStart + 10; z < F.deckEnd; z += 24) {
    for (const s of [-1, 1]) lampAt(X + s * (HW - 0.1), F.deckY, z, s);
  }
  for (let z = F.bridgeStart + 12; z < F.bridgeEnd; z += 24) {
    for (const s of [-1, 1]) lampAt(X + s * (HW - 0.1), F.bridgeY, z, s);
  }
  if (poleT.length) {
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 9, 8), makeMat(0x6b7280, { metalness: 0.6 }), poleT.length);
    poleT.forEach((m, i) => poles.setMatrixAt(i, m));
    poles.instanceMatrix.needsUpdate = true;
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.2, 0.5), new THREE.MeshBasicMaterial({ color: 0xfff7d6 }), headT.length);
    headT.forEach((m, i) => heads.setMatrixAt(i, m));
    heads.instanceMatrix.needsUpdate = true;
    grp.add(poles, heads);
  }

  // ---- Overhead signage -------------------------------------------------
  const gantry = (z, y, text, bg = '#065f46', fg = '#f8fafc', w = 15) => {
    for (const s of [-1, 1]) box(0.45, 7.4, 0.45, steelMat, X + s * (HW + 0.7), y + 3.7, z, true);
    box(W + 2.4, 0.4, 0.4, steelMat, X, y + 7.2, z, true);
    createNeonSign(grp, text, X, y + 6.4, z - 0.3, bg, fg, w, 1.5);
  };
  gantry(-110, F.groundY, 'AURA HILLS   EXIT 12');
  gantry(44, F.groundY, 'I-88 NORTH  •  REDROCK DESERT EXIT 40');
  gantry(206, F.deckY + (F.bridgeY - F.deckY) * ((206 - 186) / 30), 'OCEAN BRIDGE  •  KEEP RIGHT', '#0f172a', '#facc15');
  gantry(362, F.bridgeY, 'WELCOME TO LOS AURA  •  DOWNTOWN / LAX / SPEEDWAY', '#065f46', '#f8fafc', 17.5);
  gantry(462, F.northY, 'DOWNTOWN LOS AURA   EXIT 14');
  gantry(556, F.northY, 'LOS AURA INTL AIRPORT   EXIT 16');
  gantry(730, F.northY, 'MOTOR SPEEDWAY   EXIT 18');

  mapShapes.push({
    x: X, z: (F.southEnd + F.northEnd) / 2, w: W, d: F.northEnd - F.southEnd,
    color: '#334155', border: '#f59e0b', enterable: false
  });
  mapShapes.push({ x: X, z: 290, w: W, d: 208, color: '#dc2626', border: '#facc15', enterable: false });
}

// -----------------------------------------------------------------------------
// City roads & desert highway
// -----------------------------------------------------------------------------
export function buildRoadsFreewayAndDesert() {
  const cityGround = terrainPlane(360, 440, -16, 0, -30, makeMat(0x61a153, { texType: 'grass', repeatX: 52, repeatY: 64, roughness: 0.94 }));
  cityGround.userData.studioName = 'City ground';
  worldRoot.add(cityGround);

  const desertGround = terrainPlane(260, 460, 294, 0.02, -10, makeMat(0xd99b52, { texType: 'sand', repeatX: 38, repeatY: 64, roughness: 0.95, bumpScale: 0.02 }));
  desertGround.userData.studioName = 'Redrock desert ground';
  worldRoot.add(desertGround);

  const nsRoads = [-120, -72, -24, 24, 72, 120];
  const ewRoads = [-168, -120, -72, -24, 24, 72];
  const asphaltNS = makeMat(0x313946, { texType: 'asphalt', repeatX: 2, repeatY: 36, roughness: 0.86, bumpScale: 0.015 });
  const asphaltEW = makeMat(0x313946, { texType: 'asphalt', repeatX: 36, repeatY: 2, roughness: 0.86, bumpScale: 0.015 });
  const yellowMat = makeMat(0xfacc15, { roughness: 0.55 });
  const whiteMat = makeMat(0xf1f5f9, { roughness: 0.55 });

  const nsDashTransforms = [];
  nsRoads.forEach((rx) => {
    const r = new THREE.Mesh(new THREE.BoxGeometry(12, 0.08, 252), asphaltNS);
    r.position.set(rx, 0.04, -48);
    r.receiveShadow = true;
    worldRoot.add(r);
    for (let z = -170; z <= 74; z += 6) {
      if (!ewRoads.some((iz) => Math.abs(z - iz) < 7.5)) nsDashTransforms.push([rx, 0.05, z]);
    }
  });
  const ewDashTransforms = [];
  ewRoads.forEach((rz) => {
    const r = new THREE.Mesh(new THREE.BoxGeometry(252, 0.08, 12), asphaltEW);
    r.position.set(0, 0.04, rz);
    r.receiveShadow = true;
    worldRoot.add(r);
    for (let x = -122; x <= 122; x += 6) {
      if (!nsRoads.some((ix) => Math.abs(x - ix) < 7.5)) ewDashTransforms.push([x, 0.05, rz]);
    }
  });
  {
    const dm = new THREE.Object3D();
    const nsDashes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.09, 2.5), yellowMat, nsDashTransforms.length);
    nsDashTransforms.forEach(([x, y, z], i) => { dm.position.set(x, y, z); dm.updateMatrix(); nsDashes.setMatrixAt(i, dm.matrix); });
    nsDashes.instanceMatrix.needsUpdate = true;
    const ewDashes = new THREE.InstancedMesh(new THREE.BoxGeometry(2.5, 0.09, 0.26), yellowMat, ewDashTransforms.length);
    ewDashTransforms.forEach(([x, y, z], i) => { dm.position.set(x, y, z); dm.updateMatrix(); ewDashes.setMatrixAt(i, dm.matrix); });
    ewDashes.instanceMatrix.needsUpdate = true;
    worldRoot.add(nsDashes, ewDashes);
  }
  // (Removed: the duplicate EW road + dash loop that caused z-fighting.)

  {
    const dm = new THREE.Object3D();
    const count = nsRoads.length * ewRoads.length * 5;
    const cwNS = new THREE.InstancedMesh(new THREE.BoxGeometry(0.85, 0.095, 2.1), whiteMat, count * 2);
    const cwEW = new THREE.InstancedMesh(new THREE.BoxGeometry(2.1, 0.095, 0.85), whiteMat, count * 2);
    let iNS = 0, iEW = 0;
    nsRoads.forEach((ix) => {
      ewRoads.forEach((iz) => {
        for (let s = -4; s <= 4; s += 2) {
          dm.position.set(ix + s, 0.052, iz - 7.3); dm.updateMatrix(); cwNS.setMatrixAt(iNS++, dm.matrix);
          dm.position.set(ix + s, 0.052, iz + 7.3); dm.updateMatrix(); cwNS.setMatrixAt(iNS++, dm.matrix);
          dm.position.set(ix - 7.3, 0.052, iz + s); dm.updateMatrix(); cwEW.setMatrixAt(iEW++, dm.matrix);
          dm.position.set(ix + 7.3, 0.052, iz + s); dm.updateMatrix(); cwEW.setMatrixAt(iEW++, dm.matrix);
        }
      });
    });
    cwNS.instanceMatrix.needsUpdate = true;
    cwEW.instanceMatrix.needsUpdate = true;
    worldRoot.add(cwNS, cwEW);
  }

  const curbMat = makeMat(0x94a3b8, { texType: 'concrete', repeatX: 16, repeatY: 1, roughness: 0.9 });
  const sidewalkMat = makeMat(0xcbd5e1, { texType: 'sidewalk', repeatX: 12, repeatY: 12, roughness: 0.85 });
  const lawnMat = makeMat(0x69ae59, { texType: 'grass', repeatX: 8, repeatY: 8, roughness: 0.94 });
  const downtownPlazaMat = makeMat(0x94a3b8, { texType: 'cobblestone', repeatX: 14, repeatY: 14, roughness: 0.82 });
  [-96, -48, 0, 48, 96].forEach((bx) => {
    [-144, -96, -48, 0, 48].forEach((bz) => {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(36.3, 0.16, 36.3), curbMat);
      curb.position.set(bx, 0.08, bz);
      curb.receiveShadow = true;
      const sw = new THREE.Mesh(new THREE.BoxGeometry(36, 0.18, 36), sidewalkMat);
      sw.position.set(bx, 0.09, bz);
      sw.receiveShadow = true;
      const inner = new THREE.Mesh(new THREE.BoxGeometry(30.4, 0.20, 30.4), bz <= -72 ? downtownPlazaMat : lawnMat);
      inner.position.set(bx, 0.10, bz);
      inner.receiveShadow = true;
      worldRoot.add(curb, sw, inner);
    });
  });

  // The continuous interstate (ground, viaduct, ocean bridge, northern freeway)
  buildInterstate88();

  // City connectors. z = -24 joins at grade; z = 72 passes UNDER the viaduct
  // climb, so it stays a surface street with no barrier opening.
  [-24, 72].forEach((cz) => {
    const conn = new THREE.Mesh(new THREE.BoxGeometry(46, 0.09, 12), asphaltEW);
    conn.position.set(141, 0.045, cz);
    conn.receiveShadow = true;
    worldRoot.add(conn);
  });

  // Route 66 desert spur (at-grade east opening at z = 40)
  const desertHwy = new THREE.Mesh(new THREE.BoxGeometry(198, 0.09, 12), asphaltEW);
  desertHwy.position.set(261, 0.055, 40);
  desertHwy.receiveShadow = true;
  worldRoot.add(desertHwy);
  {
    const positions = [];
    for (let x = 168; x <= 354; x += 7) positions.push([x, 0.065, 40]);
    const hwyDashes = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 0.10, 0.26), yellowMat, positions.length);
    const dm = new THREE.Object3D();
    positions.forEach(([x, y, z], i) => { dm.position.set(x, y, z); dm.updateMatrix(); hwyDashes.setMatrixAt(i, dm.matrix); });
    hwyDashes.instanceMatrix.needsUpdate = true;
    worldRoot.add(hwyDashes);
  }

  mapShapes.push({ x: 280, z: 10, w: 220, d: 396, color: '#d97706', border: '#92400e', enterable: false });
  mapShapes.push({ x: 261, z: 40, w: 196, d: 12, color: '#334155', border: '#facc15', enterable: false });
}

// -----------------------------------------------------------------------------
// Redrock desert
// -----------------------------------------------------------------------------
export function buildRedrockDesertBiome() {
  const mesaMat = makeMat(0xb45309, { texType: 'redrock', repeatX: 6, repeatY: 3, roughness: 0.9, bumpScale: 0.03 });
  const mesaCapMat = makeMat(0xd97706, { texType: 'sand', repeatX: 4, repeatY: 4, roughness: 0.92 });
  const cactusMat = makeMat(0x15803d, { roughness: 0.85 });
  const boulderMat = makeMat(0x9a3412, { texType: 'redrock', repeatX: 2, repeatY: 2, roughness: 0.92 });

  // Mesa previously at (315,115) relocated — it intersected the Scorpion Hideout.
  [
    { x: 215, z: -45, w: 26, d: 22, h: 7.5 },
    { x: 295, z: -85, w: 34, d: 28, h: 11.0 },
    { x: 225, z: 125, w: 28, d: 24, h: 8.5 },
    { x: 285, z: 178, w: 32, d: 26, h: 10.0 }
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

  [
    [184, -18], [196, 18], [210, 62], [238, 16], [268, -28],
    [282, 64], [308, 12], [332, 68], [192, 92], [255, 148]
  ].forEach(([cx, cz], idx) => {
    const cGroup = new THREE.Group();
    cGroup.userData.studioName = `Saguaro cactus ${idx + 1}`;
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

  [[188, 56], [244, -14], [274, 24], [322, -24], [265, 95]].forEach(([bx, bz]) => {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.45, 0), boulderMat);
    rock.position.set(bx, 0.9, bz);
    rock.castShadow = true;
    worldRoot.add(rock);
    addWorldBox(bx - 1.2, bx + 1.2, 0.02, 2.0, bz - 1.2, bz + 1.2, 'boulder', true);
  });

  buildWalkInHouse({ x: 254, z: 84, w: 10.4, d: 8.6, wallColor: 0xfde68a, roofColor: 0x9a3412, label: 'REDROCK DESERT OUTPOST' });
}

// -----------------------------------------------------------------------------
// Suburban house shell — roof no longer lets you stand inside the gable
// -----------------------------------------------------------------------------
export function buildSuburbanHouseBase({ x, z, w = 8.4, d = 7.4, h = 3.6, wallColor, roofColor, rotY = 0 }) {
  const group = new THREE.Group();
  group.position.set(x, 0.18, z);
  group.rotation.y = rotY;
  const wallThick = 0.28;
  const wallMat = makeMat(wallColor, { texType: 'siding', repeatX: 3, repeatY: 2, bumpScale: 0.015 });

  const floor = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 0.08, d - 0.2), makeMat(0x92400e, { texType: 'wood' }));
  floor.position.y = 0.04;
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(w, h, wallThick), wallMat);
  backWall.position.set(0, h / 2, -d / 2 + wallThick / 2);
  backWall.castShadow = true;

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

  const leftWall = new THREE.Group();
  leftWall.position.set(-w / 2 + wallThick / 2, 0, 0);
  leftWall.rotation.y = Math.PI / 2;
  buildWallWithRealWindow(leftWall, d - wallThick * 2, h, wallThick, 1.5, 1.25, 1.9, wallMat);
  const rightWall = new THREE.Group();
  rightWall.position.set(w / 2 - wallThick / 2, 0, 0);
  rightWall.rotation.y = -Math.PI / 2;
  buildWallWithRealWindow(rightWall, d - wallThick * 2, h, wallThick, 1.5, 1.25, 1.9, wallMat);

  const inTable = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.65, 1.0), makeMat(0x78350f, { texType: 'wood' }));
  inTable.position.set(-1.6, 0.4, 1.2);
  const inSofa = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.72, 0.9), makeMat(0x334155, { texType: 'fabric' }));
  inSofa.position.set(1.6, 0.42, 0.8);
  group.add(floor, backWall, frontWall, leftWall, rightWall, inTable, inSofa);

  const roofH = 2.2, overhang = 0.55;
  const shape = new THREE.Shape();
  shape.moveTo(-(w / 2 + overhang), 0);
  shape.lineTo(w / 2 + overhang, 0);
  shape.lineTo(0, roofH);
  shape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: d + overhang * 2, bevelEnabled: false });
  roofGeo.translate(0, 0, -(d / 2 + overhang));
  const roof = new THREE.Mesh(roofGeo, makeMat(roofColor, { texType: 'shingles', repeatX: 4, repeatY: 4, bumpScale: 0.02 }));
  roof.position.y = h;
  roof.castShadow = true;
  group.add(roof);

  const awning = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.24, 1.8), makeMat(roofColor, { texType: 'shingles', repeatX: 2, repeatY: 1 }));
  awning.position.set(0, 2.25, d / 2 + 0.85);
  awning.castShadow = true;
  group.add(awning);

  // Proximity LOD: chimney only. Shutters/porch details live in embellishHouse.
  const lodGroup = new THREE.Group();
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.85, 2.2, 0.85), makeMat(0x9a3412, { texType: 'brick', repeatX: 1, repeatY: 2, bumpScale: 0.02 }));
  chimney.position.set(w * 0.28, h + 1.4, -d * 0.15);
  chimney.castShadow = true;
  lodGroup.add(chimney);
  group.add(lodGroup);
  registerBuildingLod(x, z, lodGroup);
  worldRoot.add(group);

  const cos = Math.abs(Math.cos(rotY)), sin = Math.abs(Math.sin(rotY));
  const worldW = w * cos + d * sin;
  const worldD = w * sin + d * cos;
  addWorldBox(x - worldW / 2, x + worldW / 2, 0.18, 0.18 + h, z - worldD / 2, z + worldD / 2, 'house_wall', false);
  const awWorldX = x + Math.sin(rotY) * (d / 2 + 0.85);
  const awWorldZ = z + Math.cos(rotY) * (d / 2 + 0.85);
  const awW = 3.4 * cos + 1.8 * sin, awD = 3.4 * sin + 1.8 * cos;
  addWorldBox(awWorldX - awW / 2, awWorldX + awW / 2, 2.25, 2.48, awWorldZ - awD / 2, awWorldZ + awD / 2, 'porch_awning', true);
  mapShapes.push({ x, z, w: worldW, d: worldD, color: '#' + new THREE.Color(wallColor).getHexString(), border: '#1e293b', enterable: false });
}

// -----------------------------------------------------------------------------
// Walk-in house (baseY lets it sit on sloped terrain, e.g. the ski lodge)
// -----------------------------------------------------------------------------
export function buildWalkInHouse({ x, z, w = 9.8, d = 8.6, h = 4.0, wallColor, roofColor, label, baseY = 0.18 }) {
  const group = new THREE.Group();
  group.position.set(x, baseY, z);
  group.userData.studioName = label || 'Walk-in house';
  const wallThick = 0.36, doorW = 2.6, doorH = 2.85;
  const wallMat = makeMat(wallColor, { texType: 'siding', repeatX: 4, repeatY: 2, bumpScale: 0.015 });

  const floor = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 0.08, d - 0.2), makeMat(0xb45309, { texType: 'wood', repeatX: 4, repeatY: 4, roughness: 0.55 }));
  floor.position.y = 0.04;
  floor.receiveShadow = true;
  group.add(floor);

  const backWallGroup = new THREE.Group();
  backWallGroup.position.set(0, 0, -d / 2 + wallThick / 2);
  buildWallWithRealWindow(backWallGroup, w, h, wallThick, 2.2, 1.35, 2.0, wallMat);
  group.add(backWallGroup);

  const leftWallGroup = new THREE.Group();
  leftWallGroup.position.set(-w / 2 + wallThick / 2, 0, 0);
  leftWallGroup.rotation.y = Math.PI / 2;
  buildWallWithRealWindow(leftWallGroup, d - wallThick * 2, h, wallThick, 1.8, 1.35, 2.0, wallMat);
  const rightWallGroup = new THREE.Group();
  rightWallGroup.position.set(w / 2 - wallThick / 2, 0, 0);
  rightWallGroup.rotation.y = -Math.PI / 2;
  buildWallWithRealWindow(rightWallGroup, d - wallThick * 2, h, wallThick, 1.8, 1.35, 2.0, wallMat);
  group.add(leftWallGroup, rightWallGroup);

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

  const roofH = 2.3, overhang = 0.55;
  const shape = new THREE.Shape();
  shape.moveTo(-(w / 2 + overhang), 0);
  shape.lineTo(w / 2 + overhang, 0);
  shape.lineTo(0, roofH);
  shape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: d + overhang * 2, bevelEnabled: false });
  roofGeo.translate(0, 0, -(d / 2 + overhang));
  const roof = new THREE.Mesh(roofGeo, makeMat(roofColor, { texType: 'shingles', repeatX: 4, repeatY: 4, bumpScale: 0.02 }));
  roof.position.y = h;
  roof.castShadow = true;
  group.add(roof);

  const sofa = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.72, 2.5), makeMat(0x334155, { texType: 'fabric', repeatX: 2, repeatY: 4, roughness: 0.95 }));
  sofa.position.set(-w / 2 + 1.0, 0.42, -0.2);
  addWorldBox(x - w / 2 + 0.45, x - w / 2 + 1.55, baseY, baseY + 0.72, z - 1.45, z + 1.05, 'sofa', true);
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.62, 1.6), makeMat(0x78350f, { texType: 'wood' }));
  table.position.set(-1.5, 0.38, -0.2);
  addWorldBox(x - 2.05, x - 0.95, baseY, baseY + 0.62, z - 1.0, z + 0.6, 'table', true);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.94, 1.1), makeMat(0xe2e8f0, { texType: 'siding' }));
  counter.position.set(w / 2 - 1.9, 0.54, -d / 2 + 1.0);
  const graniteTop = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.09, 1.18), makeMat(0x334155, { texType: 'granite', repeatX: 3, repeatY: 1, roughness: 0.16, clearcoat: 0.9, flatShading: false }));
  graniteTop.position.set(w / 2 - 1.9, 1.05, -d / 2 + 1.0);
  const steelFridge = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.05, 0.95), makeMat(0xdbeafe, { texType: 'brushedsteel', repeatX: 1, repeatY: 2, metalness: 0.9, roughness: 0.22, flatShading: false }));
  steelFridge.position.set(w / 2 - 0.9, 1.1, -d / 2 + 2.3);
  addWorldBox(x + w / 2 - 3.3, x + w / 2 - 0.5, baseY, baseY + 1.02, z - d / 2 + 0.45, z - d / 2 + 1.55, 'counter', true);
  addWorldBox(x + w / 2 - 1.4, x + w / 2 - 0.4, baseY, baseY + 2.07, z - d / 2 + 1.8, z - d / 2 + 2.8, 'fridge', true);
  const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.55, 1.4), makeMat(0x92400e, { texType: 'wood' }));
  bedFrame.position.set(-w / 2 + 1.45, 0.35, -d / 2 + 1.15);
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.22, 1.28), makeMat(0xf8fafc, { texType: 'fabric', repeatX: 2, repeatY: 2, roughness: 0.95 }));
  mattress.position.set(-w / 2 + 1.45, 0.68, -d / 2 + 1.15);
  addWorldBox(x - w / 2 + 0.45, x - w / 2 + 2.45, baseY, baseY + 0.77, z - d / 2 + 0.45, z - d / 2 + 1.85, 'bed', true);
  const rug = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.03, 2.5), makeMat(0x0284c7, { texType: 'fabric', repeatX: 4, repeatY: 3, roughness: 0.96 }));
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

  const minX = x - w / 2, maxX = x + w / 2, minZ = z - d / 2, maxZ = z + d / 2;
  addWorldBox(minX, maxX, baseY, baseY + h, minZ, minZ + wallThick, 'wall', false);
  addWorldBox(minX, minX + wallThick, baseY, baseY + h, minZ, maxZ, 'wall', false);
  addWorldBox(maxX - wallThick, maxX, baseY, baseY + h, minZ, maxZ, 'wall', false);
  addWorldBox(minX, x - doorW / 2, baseY, baseY + h, maxZ - wallThick, maxZ, 'wall', false);
  addWorldBox(x + doorW / 2, maxX, baseY, baseY + h, maxZ - wallThick, maxZ, 'wall', false);
  addWorldBox(minX, maxX, baseY + h - 0.2, baseY + h, minZ, maxZ, 'roof', true);
  enterableZones.push({ minX: minX + 0.3, maxX: maxX - 0.3, minZ: minZ + 0.3, maxZ: maxZ - 0.2, name: label });
  mapShapes.push({ x, z, w, d, color: '#' + new THREE.Color(wallColor).getHexString(), border: '#f59e0b', enterable: true });
}

// -----------------------------------------------------------------------------
// Shops, dealership, bank
// -----------------------------------------------------------------------------
export function buildHotdogStore(x, z) {
  const w = 11.4, d = 9.6, h = 4.2, wallThick = 0.36, doorW = 2.8, doorH = 2.9;
  const group = new THREE.Group();
  group.position.set(x, 0.18, z);
  group.userData.studioName = 'AURA HOTDOGS';
  const wallMat = makeMat(0xfef08a, { texType: 'siding', repeatX: 4, repeatY: 2 });
  const redTrimMat = makeMat(0xdc2626, { roughness: 0.45 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 0.08, d - 0.2), makeMat(0xf8fafc, { texType: 'cobblestone', repeatX: 6, repeatY: 6, roughness: 0.5 }));
  floor.position.y = 0.04;
  floor.receiveShadow = true;
  const backW = new THREE.Mesh(new THREE.BoxGeometry(w, h, wallThick), wallMat);
  backW.position.set(0, h / 2, -d / 2 + wallThick / 2);
  backW.castShadow = true;

  const leftW = new THREE.Group();
  leftW.position.set(-w / 2 + wallThick / 2, 0, 0);
  leftW.rotation.y = Math.PI / 2;
  buildWallWithRealWindow(leftW, d - wallThick * 2, h, wallThick, 2.2, 1.4, 2.0, wallMat);
  const rightW = new THREE.Group();
  rightW.position.set(w / 2 - wallThick / 2, 0, 0);
  rightW.rotation.y = -Math.PI / 2;
  buildWallWithRealWindow(rightW, d - wallThick * 2, h, wallThick, 2.2, 1.4, 2.0, wallMat);

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
  const indoorPadRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.15, 22), new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide }));
  indoorPadRing.rotation.x = -Math.PI / 2;
  indoorPadRing.position.set(2.4, 0.10, -2.2);
  group.add(floor, backW, leftW, rightW, frontL, frontR, header, roof, mascotGroup, frontCounter, frontTop, backCounter, refillVat, vatWater, indoorPadRing);
  worldRoot.add(group);

  const minX = x - w / 2, maxX = x + w / 2, minZ = z - d / 2, maxZ = z + d / 2;
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
  cart.userData.studioName = 'Plaza hotdog cart';
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.05, 1.15), makeMat(0xdc2626, { texType: 'corrugated', metalness: 0.65, roughness: 0.28 }));
  body.position.y = 0.62;
  body.castShadow = true;
  const topCounter = new THREE.Mesh(new THREE.BoxGeometry(2.22, 0.10, 1.25), makeMat(0xf8fafc, { texType: 'brushedsteel', metalness: 0.9, roughness: 0.2, flatShading: false }));
  topCounter.position.y = 1.18;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.65, 8), makeMat(0xe2e8f0, { metalness: 0.9 }));
  pole.position.set(0, 1.95, 0);
  const umbrella = new THREE.Mesh(new THREE.ConeGeometry(1.55, 0.65, 8), makeMat(0xfacc15, { roughness: 0.5 }));
  umbrella.position.set(0, 2.75, 0);
  umbrella.castShadow = true;
  const miniDog = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.65, 6, 8), makeMat(0xb91c1c));
  miniDog.rotation.z = Math.PI / 2;
  miniDog.position.set(0, 1.34, 0.1);
  const refillRing = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.45, 24), new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide }));
  refillRing.rotation.x = -Math.PI / 2;
  refillRing.position.y = 0.05;
  createNeonSign(cart, 'SAUSAGE REFILL [E]', 0, 2.15, 0.65, '#7f1d1d', '#fef08a', 2.2, 0.44);
  cart.add(body, topCounter, pole, umbrella, miniDog, refillRing);
  worldRoot.add(cart);
  addWorldBox(x - 1.1, x + 1.1, 0.18, 1.42, z - 0.62, z + 0.62, 'hotdog_cart', true);
  sausageRefillZones.push({ x, y: 0.18, z: z + 1.2, label: 'PLAZA HOTDOG CART' });
}

export function buildCarDealership(x, z) {
  const w = 15.6, d = 12.6, h = 4.8, wallThick = 0.38, doorW = 4.8, doorH = 3.5;
  const group = new THREE.Group();
  group.position.set(x, 0.18, z);
  group.userData.studioName = 'AURA EXOTIC MOTORS';
  const marbleFloor = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 0.08, d - 0.2), makeMat(0xf8fafc, { texType: 'marble', repeatX: 6, repeatY: 5, roughness: 0.16, clearcoat: 0.9, flatShading: false }));
  marbleFloor.position.y = 0.04;
  marbleFloor.receiveShadow = true;
  const wallMat = makeMat(0x1e293b, { texType: 'concrete', repeatX: 5, repeatY: 2, roughness: 0.45 });
  const trimMat = makeMat(0xf59e0b, { metalness: 0.85, roughness: 0.2 });
  const backW = new THREE.Mesh(new THREE.BoxGeometry(w, h, wallThick), wallMat);
  backW.position.set(0, h / 2, -d / 2 + wallThick / 2);
  backW.castShadow = true;

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
  const turntableRing = new THREE.Mesh(new THREE.RingGeometry(2.5, 2.85, 32), new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide }));
  turntableRing.rotation.x = -Math.PI / 2;
  turntableRing.position.set(0, 0.10, -0.4);
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.95, 0.95), makeMat(0x0f172a));
  desk.position.set(-5.6, 0.52, -4.4);
  const deskTop = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.08, 1.05), trimMat);
  deskTop.position.set(-5.6, 1.02, -4.4);
  createNeonSign(group, 'AURA EXOTIC MOTORS', 0, 4.15, d / 2 + 0.12, '#090d14', '#f59e0b', 8.2, 1.15);
  group.add(marbleFloor, backW, leftW, rightW, frontL, frontR, header, roof, fascia, turntableRing, desk, deskTop);
  worldRoot.add(group);

  const minX = x - w / 2, maxX = x + w / 2, minZ = z - d / 2, maxZ = z + d / 2;
  addWorldBox(minX, maxX, 0.18, 0.18 + h, minZ, minZ + wallThick, 'wall', false);
  addWorldBox(minX, minX + wallThick, 0.18, 0.18 + h, minZ, maxZ, 'wall', false);
  addWorldBox(maxX - wallThick, maxX, 0.18, 0.18 + h, minZ, maxZ, 'wall', false);
  addWorldBox(minX, x - doorW / 2, 0.18, 0.18 + h, maxZ - wallThick, maxZ, 'wall', false);
  addWorldBox(x + doorW / 2, maxX, 0.18, 0.18 + h, maxZ - wallThick, maxZ, 'wall', false);
  addWorldBox(minX, maxX, 0.18 + h - 0.1, 0.18 + h + 0.38, minZ, maxZ, 'roof', true);
  addWorldBox(x - 6.85, x - 4.35, 0.18, 1.18, z - 4.9, z - 3.9, 'dealer_desk', true);
  // Showroom floor: cars parked inside stand on the marble, not the ground.
  addWorldBox(minX + wallThick, maxX - wallThick, 0.18, 0.26, minZ + wallThick, maxZ - wallThick, 'dealer_floor', true);
  enterableZones.push({ minX: minX + 0.3, maxX: maxX - 0.3, minZ: minZ + 0.3, maxZ: maxZ - 0.2, name: 'AURA EXOTIC MOTORS' });
  mapShapes.push({ x, z, w, d, color: '#1e293b', border: '#f59e0b', enterable: true });
}

export function buildReserveBank(x, z) {
  const w = 16.4, d = 13.6, h = 6.2, wallThick = 0.45, doorW = 3.2, doorH = 3.4;
  const group = new THREE.Group();
  group.position.set(x, 0.18, z);
  group.userData.studioName = 'SUNNYVALE RESERVE BANK';
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

  const leftW = new THREE.Group();
  leftW.position.set(-w / 2 + wallThick / 2, 0, 0);
  leftW.rotation.y = Math.PI / 2;
  buildWallWithRealWindow(leftW, d - wallThick * 2, h, wallThick, 3.4, 2.2, 2.6, marbleMat);
  const rightW = new THREE.Group();
  rightW.position.set(w / 2 - wallThick / 2, 0, 0);
  rightW.rotation.y = -Math.PI / 2;
  buildWallWithRealWindow(rightW, d - wallThick * 2, h, wallThick, 3.4, 2.2, 2.6, marbleMat);
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

  const minX = x - w / 2, maxX = x + w / 2, minZ = z - d / 2, maxZ = z + d / 2;
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

// -----------------------------------------------------------------------------
// Skyscrapers
// -----------------------------------------------------------------------------
export function buildSkyscraperBase({ x, z, w = 13.5, d = 13.5, h = 44, glassHex = 0x0ea5e9, frameHex = 0x1e293b, name = 'AURA TOWER', hasHelipad = true }) {
  const group = new THREE.Group();
  group.userData.studioName = name;
  group.position.set(x, 0.18, z);
  const lobbyH = 4.6, upperH = h - lobbyH, wallThick = 0.48, doorW = 3.2;
  const frameMat = makeMat(frameHex, { texType: 'brushedsteel', repeatX: 4, repeatY: 12, metalness: 0.88, roughness: 0.24, flatShading: false });
  const glassMat = makeMat(glassHex, {
    metalness: 0.90, roughness: 0.10, clearcoat: 1.0, clearcoatRoughness: 0.05,
    envMapIntensity: 2.1, emissive: glassHex, emissiveIntensity: 0.14, flatShading: false
  });

  const lobbyFloor = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 0.08, d - 0.2), makeMat(0xf8fafc, { texType: 'marble', repeatX: 5, repeatY: 5, roughness: 0.18, clearcoat: 0.85, flatShading: false }));
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
  buildWallWithRealWindow(frontR, segW, lobbyH, wallThick, segW - 0.9, 2.7, 2.0, frameMat, false);
  const header = new THREE.Mesh(new THREE.BoxGeometry(doorW, 1.3, wallThick), frameMat);
  header.position.set(0, 3.95, d / 2 - wallThick / 2);

  const towerBody = new THREE.Mesh(new THREE.BoxGeometry(w, upperH, d), glassMat);
  towerBody.position.y = lobbyH + upperH / 2;
  towerBody.castShadow = true;
  towerBody.receiveShadow = true;
  const roofCap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.55, d + 0.5), frameMat);
  roofCap.position.y = h + 0.275;

  const lodGroup = new THREE.Group();
  for (let y = lobbyH + 6; y < h; y += 6) {
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
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.5, 3.95, 24), new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = h + 0.67;
    const hBarL = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, 2.6), makeMat(0xf8fafc));
    hBarL.position.set(-0.9, h + 0.68, 0);
    const hBarR = hBarL.clone();
    hBarR.position.x = 0.9;
    const hCross = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.45), makeMat(0xf8fafc));
    hCross.position.set(0, h + 0.68, 0);
    group.add(pad, ring, hBarL, hBarR, hCross);
  }
  // Non-helipad towers get mast + beacon + crown from embellishTower.

  const roofLiftPad = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.15, 20), new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide }));
  roofLiftPad.rotation.x = -Math.PI / 2;
  roofLiftPad.position.set(0, h + 0.58, d / 2 - 1.8);
  group.add(roofLiftPad);
  createNeonSign(group, name, 0, 3.9, d / 2 + 0.1, '#090d14', '#38bdf8', Math.min(w - 2, 7.6), 0.95);
  group.add(lobbyFloor, backW, leftW, rightW, frontL, frontR, header, towerBody, roofCap);
  worldRoot.add(group);

  const minX = x - w / 2, maxX = x + w / 2, minZ = z - d / 2, maxZ = z + d / 2;
  addWorldBox(minX, maxX, 0.18, 0.18 + lobbyH, minZ, minZ + wallThick, 'wall', false);
  addWorldBox(minX, minX + wallThick, 0.18, 0.18 + lobbyH, minZ, maxZ, 'wall', false);
  addWorldBox(maxX - wallThick, maxX, 0.18, 0.18 + lobbyH, minZ, maxZ, 'wall', false);
  addWorldBox(minX, x - doorW / 2, 0.18, 0.18 + lobbyH, maxZ - wallThick, maxZ, 'wall', false);
  addWorldBox(x + doorW / 2, maxX, 0.18, 0.18 + lobbyH, maxZ - wallThick, maxZ, 'wall', false);
  addWorldBox(minX, maxX, 0.18 + lobbyH, 0.18 + h + 0.55, minZ, maxZ, 'skyscraper_roof', true);
  const roofY = 0.18 + h + 0.55;
  skyscrapers.push({
    x, z, w, d, h, roofY, name, minX, maxX, minZ, maxZ,
    lobbyPad: { x, y: 0.18, z: z - d / 2 + 2.0 },
    roofPad: { x, y: roofY, z: z + d / 2 - 1.8 },
    interiorLoaded: false, interiorGroup: null, interiorBoxes: []
  });
  enterableZones.push({ minX: minX + 0.3, maxX: maxX - 0.3, minZ: minZ + 0.3, maxZ: maxZ - 0.2, name: `${name} LOBBY` });
  mapShapes.push({ x, z, w, d, color: '#0284c7', border: '#38bdf8', enterable: true });
}

export function updateSkyscraperInteriors() {
  const LOAD_DIST = 56, UNLOAD_DIST = 70;
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
        const elevPadRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.15, 20), new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide }));
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
      if (sk.interiorGroup) { worldRoot.remove(sk.interiorGroup); sk.interiorGroup = null; }
      for (const b of sk.interiorBoxes) {
        const idx = worldBoxes.indexOf(b);
        if (idx !== -1) worldBoxes.splice(idx, 1);
      }
      sk.interiorBoxes = [];
      sk.interiorLoaded = false;
    }
  }
}

// -----------------------------------------------------------------------------
// Street props
// -----------------------------------------------------------------------------
export function buildKnockableLamppost(x, z) {
  const poleMat = makeMat(0xcbd5e1, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.20, flatShading: false });
  const bulbMat = makeMat(0xfef08a, { emissive: 0xfacc15, emissiveIntensity: 0.95 });
  const pivot = new THREE.Group();
  pivot.userData.studioName = 'Streetlight';
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
  const lp = { x, z, pivot, lampMat: bulbMat, boxRef, state: 'standing', fallYaw: 0, fallAngle: 0, fallVel: 0, respawnTimer: 0 };
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
  const guest = hooks.mpIsGuest();
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
      if (guest) continue;
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
          hooks.mpWorldEvent({ t: 'lamp_up', i });
        }
      }
    }
  }
}

export function createTree(x, z, scale = 1, baseY = 0.18) {
  const g = new THREE.Group();
  g.position.set(x, baseY, z);
  g.scale.setScalar(scale);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.35, 1.8, 6), treeBarkMaterial);
  trunk.position.y = 0.9;
  trunk.castShadow = true;
  const c1 = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.3, 6), treeLeafMaterial);
  c1.position.y = 2.4;
  c1.castShadow = true;
  const c2 = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.9, 6), treeLeafMaterial);
  c2.position.y = 3.65;
  c2.castShadow = true;
  const c3 = regHigh(new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.5, 6), treeLeafMaterial));
  c3.position.y = 4.7;
  c3.castShadow = true;
  g.add(trunk, c1, c2, c3);
  worldRoot.add(g);
  addWorldBox(x - 0.38 * scale, x + 0.38 * scale, baseY, baseY + 2.2 * scale, z - 0.38 * scale, z + 0.38 * scale, 'tree', false);
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
  const cos = Math.abs(Math.cos(rotY)), sin = Math.abs(Math.sin(rotY));
  const hw = (3.8 * cos + 1.5 * sin) / 2, hd = (3.8 * sin + 1.5 * cos) / 2;
  addWorldBox(x - hw, x + hw, 2.38, 2.68, z - hd, z + hd, 'shelter_roof', true);
}

// -----------------------------------------------------------------------------
// City landmarks
// -----------------------------------------------------------------------------
export function buildCityLandmarks() {
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
  const water = new THREE.Mesh(new THREE.CylinderGeometry(3.05, 3.05, 0.72, 18), makeMat(0x0ea5e9, { texType: 'water', repeatX: 3, repeatY: 3, roughness: 0.07, metalness: 0.28, clearcoat: 1.0, emissive: 0x0284c7, emissiveIntensity: 0.25, flatShading: false }));
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
  buildPlazaHotdogCart(11.8, 12.2);
  buildHotdogStore(-39.5, -39.5);
  buildCarDealership(0, -48);

  const nwPlaza = new THREE.Mesh(new THREE.BoxGeometry(30.6, 0.21, 30.6), makeMat(0x94a3b8, { texType: 'cobblestone', repeatX: 12, repeatY: 12, bumpScale: 0.02 }));
  nwPlaza.position.set(-48, 0.105, -48);
  worldRoot.add(nwPlaza);
  const cafeGroup = new THREE.Group();
  cafeGroup.userData.studioName = 'SUNNYVALE DINER';
  const cafe = new THREE.Mesh(new THREE.BoxGeometry(9.6, 4.4, 9.2), makeMat(0xfde68a, { texType: 'brick', repeatX: 4, repeatY: 2, bumpScale: 0.02 }));
  cafe.position.set(-54.5, 2.38, -53.5);
  cafe.castShadow = true;
  const cafeGlass = new THREE.Mesh(new THREE.BoxGeometry(7.0, 1.8, 0.08), realWindowGlassMat);
  cafeGlass.position.set(-54.5, 1.5, -48.88);
  cafeGroup.add(cafe, cafeGlass);
  createNeonSign(cafeGroup, 'SUNNYVALE DINER', -54.5, 3.65, -48.82, '#7f1d1d', '#fef08a');
  worldRoot.add(cafeGroup);
  addWorldBox(-59.3, -49.7, 0.18, 4.58, -58.1, -48.9, 'diner_roof', true);
  mapShapes.push({ x: -54.5, z: -53.5, w: 9.6, d: 9.2, color: '#fde68a', border: '#b45309', enterable: false });

  buildReserveBank(0, -96);

  buildSkyscraper({ x: -48, z: -96, w: 14.5, d: 14.5, h: 48, glassHex: 0x0284c7, frameHex: 0x0f172a, name: 'AURA CORP HQ', hasHelipad: true });
  buildSkyscraper({ x: 48, z: -96, w: 14.5, d: 14.5, h: 54, glassHex: 0x0d9488, frameHex: 0x1e293b, name: 'SUNNYVALE EXCHANGE', hasHelipad: false });
  buildSkyscraper({ x: -96, z: -96, w: 14.0, d: 14.0, h: 42, glassHex: 0x2563eb, frameHex: 0x1e293b, name: 'WESTSIDE TOWER', hasHelipad: true });
  buildSkyscraper({ x: 96, z: -96, w: 14.0, d: 14.0, h: 46, glassHex: 0x0369a1, frameHex: 0x0f172a, name: 'EASTGATE PLAZA', hasHelipad: false });
  buildSkyscraper({ x: 0, z: -144, w: 16.0, d: 16.0, h: 64, glassHex: 0x38bdf8, frameHex: 0x090d14, name: 'APEX PINNACLE', hasHelipad: true });
  buildSkyscraper({ x: -48, z: -144, w: 14.5, d: 14.5, h: 52, glassHex: 0x1d4ed8, frameHex: 0x1e293b, name: 'HORIZON FINANCIAL', hasHelipad: false });
  buildSkyscraper({ x: 48, z: -144, w: 14.5, d: 14.5, h: 56, glassHex: 0x0f766e, frameHex: 0x0f172a, name: 'PACIFIC TOWERS', hasHelipad: true });
  buildSkyscraper({ x: -96, z: -144, w: 14.0, d: 14.0, h: 44, glassHex: 0x4f46e5, frameHex: 0x1e293b, name: 'NORTHERN STAR', hasHelipad: false });
  buildSkyscraper({ x: 96, z: -144, w: 14.0, d: 14.0, h: 50, glassHex: 0x0284c7, frameHex: 0x0f172a, name: 'HARBOR VIEW HQ', hasHelipad: true });

  const nePlaza = new THREE.Mesh(new THREE.BoxGeometry(30.6, 0.21, 30.6), makeMat(0x94a3b8, { texType: 'concrete', repeatX: 10, repeatY: 10 }));
  nePlaza.position.set(48, 0.105, -48);
  worldRoot.add(nePlaza);
  const aptH = 8.4;
  const apt = new THREE.Mesh(new THREE.BoxGeometry(11, aptH, 16), makeMat(0xb45309, { texType: 'brick', repeatX: 5, repeatY: 4, bumpScale: 0.025 }));
  apt.position.set(43, 0.18 + aptH / 2, -48);
  apt.castShadow = true;
  apt.receiveShadow = true;
  worldRoot.add(apt);
  addWorldBox(37.5, 48.5, 0.18, 0.18 + aptH, -56, -40, 'apartment_roof', true);
  mapShapes.push({ x: 43, z: -48, w: 11, d: 16, color: '#b45309', border: '#78350f', enterable: false });
  const steelMat = makeMat(0x94a3b8, { texType: 'diamondplate', repeatX: 2, repeatY: 3, metalness: 0.88, roughness: 0.28, bumpScale: 0.02 });
  [{ y: 1.85, z: -54.0 }, { y: 3.70, z: -50.2 }, { y: 5.55, z: -46.4 }, { y: 7.40, z: -42.6 }].forEach((st) => {
    const plat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.25, 3.4), steelMat);
    plat.position.set(49.6, st.y, st.z);
    plat.castShadow = true;
    worldRoot.add(plat);
    addWorldBox(48.5, 50.7, st.y - 0.15, st.y + 0.13, st.z - 1.7, st.z + 1.7, 'fire_escape', true);
  });

  const contRed = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.3, 6.8), makeMat(0xdc2626, { texType: 'corrugated', repeatX: 3, repeatY: 2, metalness: 0.82, roughness: 0.34, bumpScale: 0.03 }));
  contRed.position.set(44, 0.18 + 1.15, 45);
  contRed.castShadow = true;
  addWorldBox(42.4, 45.6, 0.18, 2.48, 41.6, 48.4, 'container_low', true);
  const contBlue = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.3, 6.8), makeMat(0x2563eb, { texType: 'corrugated', repeatX: 3, repeatY: 2, metalness: 0.82, roughness: 0.34, bumpScale: 0.03 }));
  contBlue.position.set(47.4, 0.18 + 1.15, 47);
  contBlue.castShadow = true;
  addWorldBox(45.8, 49.0, 0.18, 2.48, 43.6, 50.4, 'container_low2', true);
  const contTop = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, 6.4), makeMat(0xd97706, { texType: 'corrugated', repeatX: 3, repeatY: 2, metalness: 0.82, roughness: 0.34, bumpScale: 0.03 }));
  contTop.position.set(47.4, 2.48 + 1.1, 47);
  contTop.castShadow = true;
  addWorldBox(45.8, 49.0, 2.48, 4.68, 43.8, 50.2, 'container_high', true);
  const contWest = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.3, 6.4), makeMat(0x0d9488, { texType: 'corrugated', repeatX: 3, repeatY: 2, metalness: 0.82, roughness: 0.34, bumpScale: 0.03 }));
  contWest.position.set(37.5, 0.18 + 1.15, 45);
  contWest.castShadow = true;
  addWorldBox(35.9, 39.1, 0.18, 2.48, 41.8, 48.2, 'container_west', true);
  const catwalk = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.22, 1.8), steelMat);
  catwalk.position.set(40.8, 2.48, 45);
  catwalk.castShadow = true;
  addWorldBox(38.2, 43.4, 2.36, 2.59, 44.1, 45.9, 'gantry_catwalk', true);
  worldRoot.add(contRed, contBlue, contTop, contWest, catwalk);
  mapShapes.push({ x: 45.8, z: 46, w: 7, d: 8, color: '#dc2626', border: '#991b1b', enterable: false });

  buildWalkInHouse({ x: -7.5, z: 42.0, w: 9.8, d: 8.6, wallColor: 0xfef3c7, roofColor: 0xb91c1c, label: 'OAKWOOD RESIDENCE' });
  buildWalkInHouse({ x: -41.5, z: -5.5, w: 9.8, d: 8.6, wallColor: 0xdbeafe, roofColor: 0x1e40af, label: 'CEDAR COTTAGE' });
  buildWalkInHouse({ x: 42.5, z: -5.5, w: 9.8, d: 8.6, wallColor: 0xdcfce7, roofColor: 0x166534, label: 'SAGE VILLA' });

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

  const f1 = new THREE.Mesh(new THREE.BoxGeometry(8.5, 1.15, 0.25), makeMat(0xf8fafc, { texType: 'siding' }));
  f1.position.set(7.5, 0.75, 43.5);
  f1.castShadow = true;
  worldRoot.add(f1);
  addWorldBox(3.25, 11.75, 0.18, 1.33, 43.35, 43.65, 'yard_fence', true);
  createBusShelter(-16.2, -6.5, Math.PI / 2);
  createBusShelter(16.2, 6.5, -Math.PI / 2);

  [-96, -48, 0, 48, 96].forEach((bx) => {
    [-144, -96, -48, 0, 48].forEach((bz) => {
      [[-16.8, -16.8], [16.8, 16.8]].forEach(([ox, oz]) => buildKnockableLamppost(bx + ox, bz + oz));
    });
  });

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
  const LOD_ON_DIST = 54, LOD_OFF_DIST = 66;
  for (let i = 0; i < buildingLods.length; i++) {
    const entry = buildingLods[i];
    const d = Math.hypot(entry.x - player.x, entry.z - player.z);
    if (!entry.active && d < LOD_ON_DIST) { entry.group.visible = true; entry.active = true; }
    else if (entry.active && d > LOD_OFF_DIST) { entry.group.visible = false; entry.active = false; }
  }
}

// -----------------------------------------------------------------------------
// Embellishments — deduplicated against the base/LOD geometry
// -----------------------------------------------------------------------------
export function embellishHouse({ x, z, w = 8.4, d = 7.4, h = 3.6, wallColor, roofColor, rotY = 0 }) {
  const g = new THREE.Group();
  g.position.set(x, 0.18, z);
  g.rotation.y = rotY;
  worldRoot.add(g);
  const wood = makeMat(0xf1f5f9, { roughness: 0.7 });
  const green = makeMat(0x14532d, { roughness: 0.8 });
  const add = (sx, sy, sz, m, px, py, pz) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
    b.position.set(px, py, pz);
    b.castShadow = true;
    g.add(b);
    return b;
  };
  // Porch step only — the awning comes from the base house, the chimney from LOD.
  add(w * 0.36, 0.14, 1.4, makeMat(0xa8a29e, { texType: 'concrete' }), 0, 0.07, d / 2 + 0.7);
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
  // Roof parapets + HVAC + mast. Corner fins & floor bands come from the base LOD.
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
  aviationBeacons.push(beacon);
  g.add(beacon);
  if (!hasHelipad) {
    add(w * 0.7, 2.2, d * 0.7, dark, 0, h + 1.2, 0);
    add(w * 0.4, 2.2, d * 0.4, glow, 0, h + 3.4, 0);
  }
}

export function buildSuburbanHouse(o) { buildSuburbanHouseBase(o); embellishHouse(o); }
export function buildSkyscraper(o) { const r = buildSkyscraperBase(o); embellishTower(o); return r; }

// -----------------------------------------------------------------------------
// FROSTPINE ALPINE / EMERALD WOODS / SUNSET COVE
// Alpine visuals use the exact collision heightfield; all content sits ON it.
// -----------------------------------------------------------------------------
export function buildNewBiomes() {
  const grp = new THREE.Group();
  grp.userData.studioName = 'Southern biomes';
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
  const ground = (x0, x1, z0, z1, y, mat) => {
    const m = terrainPlane(x1 - x0, z1 - z0, (x0 + x1) / 2, y, (z0 + z1) / 2, mat);
    grp.add(m);
    return m;
  };
  const road = (rx, name) => {
    const r = plane(rx - 6, rx + 6, 74, 208, 0.18, makeMat(0x313946, { texType: 'asphalt', repeatX: 2, repeatY: 26, roughness: 0.86 }));
    r.userData.studioName = name;
    const dashT = [];
    for (let zz = 80; zz < 206; zz += 6) dashT.push([rx, 0.185, zz]);
    const dm = new THREE.Object3D();
    const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.02, 2.5), makeMat(0xfacc15), dashT.length);
    dashT.forEach(([x, y, z], i) => { dm.position.set(x, y, z); dm.updateMatrix(); dashes.setMatrixAt(i, dm.matrix); });
    dashes.instanceMatrix.needsUpdate = true;
    grp.add(dashes);
    mapShapes.push({ x: rx, z: 141, w: 12, d: 134, color: '#334155', border: '#475569', enterable: false });
  };
  const keep = [];
  const free = (x, z, roadX, r = 2) => {
    if (roadX !== null && Math.abs(x - roadX) < 8) return false;
    for (const k of keep) if (Math.hypot(x - k.x, z - k.z) < k.r + r) return false;
    return true;
  };

  // === FROSTPINE ALPINE ===
  const MX = 650, MZ = 210;
  const mg = new THREE.PlaneGeometry(MX, MZ, Math.ceil(MX / 5), Math.ceil(MZ / 5));
  mg.rotateX(-Math.PI / 2);
  const mountainColors = new Float32Array(mg.attributes.position.count * 3);
  const mc = new THREE.Color();
  const cLow = new THREE.Color(0x8a9a6b), cMid = new THREE.Color(0xb3b380), cSnow = new THREE.Color(0xffffff);
  for (let i = 0; i < mg.attributes.position.count; i++) {
    const x = mg.attributes.position.getX(i) - 375;
    const z = mg.attributes.position.getZ(i) + 214;
    const height = terrainBaseH(x, z);         // identical to player collision
    const snowLine = 6.5 + fbm(x * 0.05, z * 0.05, 2) * 2;
    mc.set(0x6b7a5c);
    mc.lerp(cLow, sstep(3, 6, height));
    mc.lerp(cMid, sstep(snowLine - 3, snowLine + 2, height));
    mc.lerp(cSnow, sstep(snowLine, snowLine + 3, height));
    mg.attributes.position.setY(i, height);
    mountainColors[i * 3] = mc.r;
    mountainColors[i * 3 + 1] = mc.g;
    mountainColors[i * 3 + 2] = mc.b;
  }
  mg.attributes.position.needsUpdate = true;
  mg.setAttribute('color', new THREE.BufferAttribute(mountainColors, 3));
  mg.computeVertexNormals();
  const mountainMesh = new THREE.Mesh(mg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
  mountainMesh.receiveShadow = true;
  mountainMesh.castShadow = true;
  mountainMesh.position.set(-375, 0, 214);
  mountainMesh.userData.studioName = 'Frostpine mountains';
  worldRoot.add(mountainMesh);
  registerSculptableTerrain(mountainMesh);

  // Slippery patches (visual snow is already in the vertex colours).
  for (let sz = 128; sz <= 308; sz += 60) {
    for (let sx = -660; sx <= -90; sx += 95) iceZones.push({ x: sx, z: sz, r: 26 });
  }

  // Pines — instanced, grounded on the real terrain
  const pineG = [new THREE.ConeGeometry(1.7, 2.2, 7), new THREE.ConeGeometry(1.3, 1.9, 7), new THREE.ConeGeometry(0.9, 1.6, 7)];
  const trunkG = new THREE.CylinderGeometry(0.2, 0.3, 1.6, 6);
  const snowM = makeMat(0xffffff, { roughness: 0.9 });
  const pineInstances = { trunk: [], snowCap: [], layers: [[], [], []], snowLayers: [[], [], []] };
  const pineDummy = new THREE.Object3D();
  const pushPine = (list, x, y, z, s) => {
    pineDummy.position.set(x, y, z);
    pineDummy.scale.setScalar(s);
    pineDummy.rotation.set(0, 0, 0);
    pineDummy.updateMatrix();
    list.push(pineDummy.matrix.clone());
  };
  const placePineTree = (x, z, size = 1) => {
    const gy = terrainH(x, z);
    pushPine(pineInstances.trunk, x, gy + 0.8 * size, z, size);
    pushPine(pineInstances.snowCap, x, gy + 8 * size * 0.72, z, size);
    [[0, 2.2], [1, 3.4], [2, 4.5]].forEach(([i, y]) => {
      pushPine(pineInstances.layers[i], x, gy + y * size, z, size);
      if (rnd() > 0.5) pushPine(pineInstances.snowLayers[i], x, gy + (y + 0.22) * size, z, size * 0.86);
    });
    addWorldBox(x - 0.6 * size, x + 0.6 * size, gy, gy + 8 * size * 0.6, z - 0.6 * size, z + 0.6 * size, 'pine_tree', false);
  };
  const flushInstancedPines = () => {
    const add = (geo, mat, list) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      im.receiveShadow = true;
      grp.add(im);
    };
    add(trunkG, treeBarkMaterial, pineInstances.trunk);
    add(new THREE.SphereGeometry(0.5, 12, 12), snowM, pineInstances.snowCap);
    pineG.forEach((g, i) => { add(g, treeLeafMaterial, pineInstances.layers[i]); add(g, snowM, pineInstances.snowLayers[i]); });
  };

  // Ski lodge on a levelled foundation plinth
  const lodgeX = -70, lodgeZ = 139, lodgeW = 11, lodgeD = 9;
  const lodgeY = maxTerrainOver(lodgeX - lodgeW / 2, lodgeX + lodgeW / 2, lodgeZ - lodgeD / 2, lodgeZ + lodgeD / 2) + 0.12;
  const plinth = mesh(new THREE.BoxGeometry(lodgeW + 1.6, 2.4, lodgeD + 1.6), makeMat(0x57534e, { texType: 'redrock', repeatX: 3, repeatY: 1 }), lodgeX, lodgeY - 1.2, lodgeZ);
  plinth.userData.studioName = 'Ski lodge foundation';
  addWorldBox(lodgeX - lodgeW / 2 - 0.8, lodgeX + lodgeW / 2 + 0.8, lodgeY - 2.4, lodgeY, lodgeZ - lodgeD / 2 - 0.8, lodgeZ + lodgeD / 2 + 0.8, 'lodge_foundation', true);
  keep.push({ x: lodgeX, z: lodgeZ, r: 11 });

  for (let i = 0; i < 120; i++) {
    const x = -700 + rnd() * 650, z = 108 + rnd() * 212;
    if (!free(x, z, null)) continue;
    placePineTree(x, z, 0.7 + rnd() * 0.6);
    keep.push({ x, z, r: 1.2 });
  }

  const snowRockMat = new THREE.MeshStandardMaterial({ color: 0x5a554d, roughness: 1, flatShading: true });
  for (let i = 0; i < 45; i++) {
    const rx = -640 + rnd() * 520, rz = 116 + rnd() * 196;
    if (!free(rx, rz, null, 4)) continue;
    const gy = terrainH(rx, rz);
    const rh = 2.5 + rnd() * 4;
    const rock = mesh(new THREE.DodecahedronGeometry(rh, 0), snowRockMat, rx, gy + rh * 0.35, rz);
    rock.scale.set(1 + rnd() * 0.6, 0.5 + rnd() * 0.5, 1 + rnd() * 0.6);
    addWorldBox(rx - rh * 0.8, rx + rh * 0.8, gy, gy + rh * 1.1, rz - rh * 0.8, rz + rh * 0.8, 'rock_outcrop', true);
    keep.push({ x: rx, z: rz, r: rh });
  }

  const frozenLakeMat = new THREE.MeshStandardMaterial({ color: 0x9bdcf5, metalness: 0.5, roughness: 0.08, transparent: true, opacity: 0.7 });
  for (let i = 0; i < 12; i++) {
    const lx = -650 + rnd() * 120, lz = 150 + rnd() * 80, lw = 7 + rnd() * 5;
    const topY = maxTerrainOver(lx - lw / 2, lx + lw / 2, lz - lw * 0.3, lz + lw * 0.3) + 0.06;
    const lake = mesh(new THREE.BoxGeometry(lw, 0.5, lw * 0.6), frozenLakeMat, lx, topY - 0.25, lz, false);
    lake.userData.studioName = 'Frozen lake';
    addWorldBox(lx - lw / 2, lx + lw / 2, topY - 0.5, topY, lz - lw * 0.3, lz + lw * 0.3, 'frozen_lake', true);
    iceZones.push({ x: lx, z: lz, r: lw * 0.5 });
    keep.push({ x: lx, z: lz, r: lw });
  }

  buildWalkInHouse({ x: lodgeX, z: lodgeZ, w: lodgeW, d: lodgeD, wallColor: 0x92400e, roofColor: 0xf8fafc, label: 'FROSTPINE SKI LODGE', baseY: lodgeY });

  // === EMERALD WOODS ===
  ground(-52, 28, 108, 208, 0.17, makeMat(0x4f8f46, { texType: 'grass', repeatX: 12, repeatY: 16, roughness: 0.95 }));
  road(-24, 'Forest Road');
  mapShapes.unshift({ x: -12, z: 158, w: 80, d: 100, color: '#166534', border: '#14532d', enterable: false });
  const camp = { x: 8, z: 176 };
  keep.push({ x: camp.x, z: camp.z, r: 8 }, { x: 4, z: 128, r: 10 });
  const waterM = makeMat(0x38bdf8, { texType: 'water', repeatX: 6, repeatY: 1, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.85 });
  // Continuous stream visual; wading zones keep the footbridge crossing dry.
  plane(-52, 28, 147.5, 152.5, 0.19, waterM);
  waterZones.push({ minX: -52, maxX: -31, minZ: 147.5, maxZ: 152.5 });
  waterZones.push({ minX: -17, maxX: 28, minZ: 147.5, maxZ: 152.5 });
  mapShapes.push({ x: -12, z: 150, w: 80, d: 5, color: '#38bdf8', border: '#0ea5e9', enterable: false });

  const oakG = new THREE.IcosahedronGeometry(1.9, 0);
  const birchBark = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, map: treeBarkTexture, roughness: 0.92, flatShading: true });
  const oak = (x, z, s, birch) => {
    mesh(new THREE.CylinderGeometry(birch ? 0.16 : 0.28, birch ? 0.22 : 0.4, 3.2 * s, 7), birch ? birchBark : treeBarkMaterial, x, 0.17 + 1.6 * s, z);
    [[0, 3.8, 0, 1], [0.9, 3.3, 0.4, 0.75], [-0.8, 3.4, -0.5, 0.8]].forEach(([ox, oy, oz, sc]) => {
      mesh(oakG, treeLeafMaterial, x + ox * s, 0.17 + oy * s, z + oz * s).scale.setScalar(sc * s * (birch ? 0.72 : 1));
    });
    addWorldBox(x - 0.4 * s, x + 0.4 * s, 0.18, 0.18 + 3 * s, z - 0.4 * s, z + 0.4 * s, 'tree', false);
  };
  for (let i = 0, n = 0; i < 130 && n < 34; i++) {
    const x = -50 + rnd() * 76, z = 114 + rnd() * 88;
    if (!free(x, z, -24) || Math.abs(z - 150) < 5) continue;
    const r = rnd();
    if (r < 0.4) oak(x, z, 0.85 + rnd() * 0.5, false);
    else if (r < 0.65) oak(x, z, 0.8 + rnd() * 0.4, true);
    else placePineTree(x, z, 0.9 + rnd() * 0.6);
    keep.push({ x, z, r: 1.5 });
    n++;
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
    const lg = mesh(new THREE.CylinderGeometry(0.42, 0.42, 4, 8), treeBarkMaterial, lx, 0.5, lz);
    lg.rotation.z = Math.PI / 2;
    lg.rotation.y = ry;
    addWorldBox(lx - 2, lx + 2, 0.17, 0.9, lz - 0.6, lz + 0.6, 'log', true);
  });
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
    addWorldBox(camp.x + ox - 1.1, camp.x + ox + 1.1, 0.18, 1.68, camp.z + oz - 1.1, camp.z + oz + 1.1, 'tent', false);
  });
  buildWalkInHouse({ x: 4, z: 128, w: 10.4, d: 8.6, wallColor: 0x854d0e, roofColor: 0x166534, label: 'EMERALD RANGER STATION' });
  mesh(new THREE.BoxGeometry(14, 0.12, 6), makeMat(0x78350f, { texType: 'wood' }), -24, 0.23, 150, false);
  addWorldBox(-31, -17, 0.17, 0.29, 147, 153, 'footbridge', true);
  [-1, 1].forEach((s) => mesh(new THREE.BoxGeometry(14, 0.9, 0.12), makeMat(0x78350f, { texType: 'wood' }), -24, 0.7, 150 + s * 2.95, false));

  // === SUNSET COVE ===
  ground(28, 138, 108, 208, 0.17, makeMat(0xf2d9a0, { texType: 'sand', repeatX: 14, repeatY: 14, roughness: 0.96 }));
  road(72, 'Cove Boulevard');
  mapShapes.unshift({ x: 83, z: 158, w: 110, d: 100, color: '#fcd34d', border: '#f59e0b', enterable: false });
  plane(28, 138, 168, 208, 0.2, makeMat(0x0ea5e9, { texType: 'water', repeatX: 14, repeatY: 6, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.88 }));
  waterZones.push({ minX: 28, maxX: 138, minZ: 168, maxZ: 208 });
  mapShapes.push({ x: 83, z: 188, w: 110, d: 40, color: '#38bdf8', border: '#0ea5e9', enterable: false });
  plane(28, 138, 166.6, 168, 0.21, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
  keep.push({ x: 50, z: 150, r: 5 }, { x: 118, z: 138, r: 9 }, { x: 100, z: 160, r: 6 });

  mesh(new THREE.BoxGeometry(4, 0.2, 40), makeMat(0x92704a, { texType: 'wood', repeatX: 1, repeatY: 10 }), 100, 0.45, 172, false);
  for (let pz = 154; pz <= 190; pz += 6) [-1.7, 1.7].forEach((s) => mesh(new THREE.CylinderGeometry(0.18, 0.2, 1.4, 6), makeMat(0x57534e), 100 + s, 0.0, pz, false));
  addWorldBox(98, 102, 0.2, 0.55, 152, 192, 'pier', true);
  mesh(new THREE.BoxGeometry(1.4, 0.12, 0.5), makeMat(0x78350f), 100, 0.9, 186, false);

  const palm = (x, z, s) => {
    const lean = (rnd() - 0.5) * 0.4;
    const tr = mesh(new THREE.CylinderGeometry(0.16 * s, 0.24 * s, 5 * s, 7), treeBarkMaterial, x, 0.17 + 2.5 * s, z);
    tr.rotation.z = lean;
    const tx = x - Math.sin(lean) * 2.5 * s, ty = 0.17 + 5 * s;
    for (let f = 0; f < 6; f++) {
      const fr = mesh(new THREE.BoxGeometry(3 * s, 0.05, 0.7 * s), treeLeafMaterial, tx, ty, z, false);
      fr.rotation.y = f * 1.047;
      fr.rotation.z = -0.35;
      fr.translateX(1.3 * s);
    }
    addWorldBox(x - 0.35, x + 0.35, 0.18, 0.18 + 4 * s, z - 0.35, z + 0.35, 'tree', false);
  };
  for (let i = 0, n = 0; i < 80 && n < 10; i++) {
    const x = 32 + rnd() * 100, z = 114 + rnd() * 50;
    if (!free(x, z, 72)) continue;
    palm(x, z, 0.9 + rnd() * 0.4);
    keep.push({ x, z, r: 2 });
    n++;
  }
  [[52, 160, 0xef4444], [60, 158, 0x3b82f6], [88, 162, 0xfacc15], [96, 150, 0x22c55e], [112, 158, 0xec4899]].forEach(([ux, uz, uc], i) => {
    mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 5), makeMat(0xf8fafc), ux, 1.3, uz, false);
    mesh(new THREE.ConeGeometry(1.5, 0.55, 8), makeMat(uc), ux, 2.6, uz);
    mesh(new THREE.BoxGeometry(1.1, 0.03, 2.0), makeMat(i % 2 ? 0xfef3c7 : 0xbfdbfe), ux + 0.9, 0.19, uz + 0.8, false);
  });
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => mesh(new THREE.BoxGeometry(0.2, 2.6, 0.2), makeMat(0xf8fafc), 50 + sx, 1.5, 150 + sz));
  mesh(new THREE.BoxGeometry(2.6, 1.6, 2.6), makeMat(0xdc2626, { texType: 'wood' }), 50, 3.3, 150);
  mesh(new THREE.BoxGeometry(3.2, 0.2, 3.2), makeMat(0xf8fafc), 50, 4.25, 150);
  mesh(new THREE.BoxGeometry(0.06, 1.3, 0.06), makeMat(0x57534e), 51.4, 5.0, 151.4);
  mesh(new THREE.BoxGeometry(0.7, 0.4, 0.04), makeMat(0xfacc15), 51.75, 5.4, 151.4, false);
  addWorldBox(48.8, 51.2, 2.5, 4.35, 148.8, 151.2, 'lifeguard_deck', true);
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
  flushInstancedPines();
}

// -----------------------------------------------------------------------------
// VERDANT JUNGLE — floor matches collision (x 368..533), real entry ramp,
// single grand temple clear of the river and the road.
// -----------------------------------------------------------------------------
export function buildJungleBiome() {
  const grp = new THREE.Group();
  grp.userData.studioName = 'Verdant jungle';
  worldRoot.add(grp);
  const JX0 = 368, JX1 = 533, JZ0 = -180, JZ1 = 240, JY = 1.5;
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

  const groundGeometry = new THREE.PlaneGeometry(JX1 - JX0, JZ1 - JZ0, Math.ceil((JX1 - JX0) / 2), Math.ceil((JZ1 - JZ0) / 2));
  groundGeometry.rotateX(-Math.PI / 2);
  const jungleGround = new THREE.Mesh(groundGeometry, makeMat(0x2d5a27, { texType: 'grass', repeatX: 16, repeatY: 42, roughness: 0.96 }));
  jungleGround.position.set((JX0 + JX1) / 2, JY, (JZ0 + JZ1) / 2);
  jungleGround.receiveShadow = true;
  registerSculptableTerrain(jungleGround);
  grp.add(jungleGround);
  mapShapes.unshift({ x: (JX0 + JX1) / 2, z: 30, w: JX1 - JX0, d: JZ1 - JZ0, color: '#14532d', border: '#166534', enterable: false });

  // Entry ramp: desert 0.05 -> jungle floor 1.5 over 8 m
  const rise = JY - 0.05;
  const entryRamp = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.14, 12), makeMat(0x313946, { texType: 'asphalt', repeatX: 2, repeatY: 2, roughness: 0.86 }));
  entryRamp.position.set(364, (0.05 + JY) / 2 - 0.07, 40);
  entryRamp.rotation.z = Math.atan2(rise, 8);
  entryRamp.receiveShadow = true;
  grp.add(entryRamp);
  addDriveableRamp({ minX: 360, maxX: 368, minZ: 34, maxZ: 46, startY: 0.05, endY: JY, axis: 'x', dir: 1 });

  const trailMat = makeMat(0x5c4033, { texType: 'sand', repeatX: 10, repeatY: 2, roughness: 0.95 });
  plane(368, 412, 35, 45, JY + 0.02, trailMat);
  plane(424, 474, 35, 45, JY + 0.02, trailMat);
  mapShapes.push({ x: 421, z: 40, w: 106, d: 10, color: '#78350f', border: '#451a03', enterable: false });

  const riverMat = makeMat(0x0d9488, { texType: 'water', repeatX: 2, repeatY: 38, roughness: 0.1, metalness: 0.25, transparent: true, opacity: 0.86 });
  plane(412, 424, -180, 200, JY + 0.03, riverMat);
  waterZones.push({ minX: 412, maxX: 424, minZ: -180, maxZ: 200 });
  mapShapes.push({ x: 418, z: 10, w: 12, d: 380, color: '#14b8a6', border: '#0f766e', enterable: false });

  // Far-north ocean, trimmed so it never covers alpine, desert or jungle land.
  const oceanMat = makeMat(0x0ea5e9, { texType: 'water', repeatX: 20, repeatY: 6, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.88 });
  plane(-50, 164, 208, 318, 0.2, oceanMat);
  plane(164, 368, 220, 318, 0.2, oceanMat);
  waterZones.push({ minX: -50, maxX: 164, minZ: 208, maxZ: 318 });
  waterZones.push({ minX: 164, maxX: 368, minZ: 220, maxZ: 318 });

  const woodBridgeMat = makeMat(0x78350f, { texType: 'wood', repeatX: 4, repeatY: 2 });
  mesh(new THREE.BoxGeometry(14, 0.22, 11.5), woodBridgeMat, 418, JY + 0.1, 40);
  [-5.5, 5.5].forEach((rz) => mesh(new THREE.BoxGeometry(14, 0.85, 0.24), woodBridgeMat, 418, JY + 0.54, 40 + rz));
  addWorldBox(411, 425, JY, JY + 0.21, 34.2, 45.8, 'jungle_bridge', true);

  const cliffMat = makeMat(0x475569, { texType: 'redrock', repeatX: 4, repeatY: 3, roughness: 0.92 });
  mesh(new THREE.BoxGeometry(22, 14, 7), cliffMat, 418, JY + 6.5, -137);
  addWorldBox(407, 429, JY, JY + 13.5, -140.5, -133.5, 'jungle_cliff', false);
  const fallSheet = mesh(new THREE.BoxGeometry(8.5, 11.5, 0.35), new THREE.MeshBasicMaterial({ color: 0x5eead4, transparent: true, opacity: 0.72 }), 418, JY + 5.75, -133.3, false);
  const mistPool = mesh(new THREE.CylinderGeometry(7.5, 7.5, 0.08, 20), new THREE.MeshBasicMaterial({ color: 0xccfbf1, transparent: true, opacity: 0.55 }), 418, JY + 0.06, -129, false);
  buildJungleBiome.waterfall = { fallSheet, mistPool };

  // === Grand Sun Temple — clear of the river and the trail ===
  const teX = 456, teZ = -70, platW = 60, platD = 60, platH = 3;
  const tePlatform = new THREE.Mesh(new THREE.BoxGeometry(platW, platH, platD), makeMat(0x57534e, { texType: 'cobblestone', repeatX: 8, repeatY: 8, roughness: 0.92 }));
  tePlatform.position.set(teX, JY + platH / 2, teZ);
  tePlatform.castShadow = true;
  tePlatform.receiveShadow = true;
  tePlatform.userData.studioName = 'Sun Temple platform';
  worldRoot.add(tePlatform);
  addWorldBox(teX - platW / 2, teX + platW / 2, JY, JY + platH, teZ - platD / 2, teZ + platD / 2, 'temple_platform', true);

  const tRun = 12;
  const tRamp = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, Math.hypot(tRun, platH)), makeMat(0x57534e, { texType: 'cobblestone', repeatX: 2, repeatY: 3 }));
  tRamp.position.set(teX, JY + platH / 2 - 0.1, teZ + platD / 2 + tRun / 2);
  tRamp.rotation.x = Math.atan2(platH, tRun);
  tRamp.receiveShadow = true;
  worldRoot.add(tRamp);
  addDriveableRamp({ minX: teX - 6, maxX: teX + 6, minZ: teZ + platD / 2, maxZ: teZ + platD / 2 + tRun, startY: JY + platH, endY: JY, axis: 'z', dir: 1 });

  const teStoneMat = makeMat(0x57534e, { texType: 'cobblestone', repeatX: 8, repeatY: 8, roughness: 0.92 });
  const teMossStoneMat = makeMat(0x3f6212, { texType: 'cobblestone', repeatX: 6, repeatY: 6, roughness: 0.95 });
  let tierY = JY + platH;
  [{ w: 40, d: 40 }, { w: 32, d: 32 }, { w: 24, d: 24 }, { w: 16, d: 16 }, { w: 8, d: 8 }].forEach((t, idx) => {
    const h = 1.2;                                  // jumpable steps
    const tm = new THREE.Mesh(new THREE.BoxGeometry(t.w, h, t.d), idx % 2 === 0 ? teStoneMat : teMossStoneMat);
    tm.position.set(teX, tierY + h / 2, teZ);
    tm.castShadow = true;
    tm.receiveShadow = true;
    worldRoot.add(tm);
    addWorldBox(teX - t.w / 2, teX + t.w / 2, tierY, tierY + h, teZ - t.d / 2, teZ + t.d / 2, 'temple_tier', true);
    tierY += h;
  });
  const teSummit = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 3), teStoneMat);
  teSummit.position.set(teX, tierY + 0.8, teZ);
  teSummit.castShadow = true;
  worldRoot.add(teSummit);
  addWorldBox(teX - 1.5, teX + 1.5, tierY, tierY + 1.6, teZ - 1.5, teZ + 1.5, 'temple_summit', true);
  const teRelic = new THREE.Mesh(new THREE.OctahedronGeometry(1.2, 0), makeMat(0xfacc15, { metalness: 0.9, roughness: 0.2 }));
  teRelic.position.set(teX, tierY + 2.8, teZ);
  teRelic.castShadow = true;
  worldRoot.add(teRelic);
  createNeonSign(worldRoot, 'ANCIENT SUN TEMPLE', teX, tierY + 4.4, teZ + 4, '#14532d', '#fde047', 6.5, 1.0);
  mapShapes.push({ x: teX, z: teZ, w: platW, d: platD, color: '#65a30d', border: '#facc15', enterable: false });

  buildWalkInHouse({ x: 454, z: 96, w: 10.6, d: 8.8, wallColor: 0x4d7c0f, roofColor: 0x78350f, label: 'JUNGLE RESEARCH STATION', baseY: JY });

  // === Kapok trees — instanced, inside the slab, clear of river/road/temple ===
  const vineMat = makeMat(0x4d7c0f, { roughness: 0.9 });
  const kapokParts = { trunk: [], root: [], c1: [], c2: [], c3: [], vine: [] };
  const kd = new THREE.Object3D();
  const pushKapok = (list, x, y, z, sx, sy, sz, ry = 0) => {
    kd.position.set(x, y, z);
    kd.scale.set(sx, sy, sz);
    kd.rotation.set(0, ry, 0);
    kd.updateMatrix();
    list.push(kd.matrix.clone());
  };
  const jungleClear = (x, z, r = 3) => {
    if (x < JX0 + 4 || x > JX1 - 4 || z < JZ0 + 4 || z > JZ1 - 4) return false;
    if (x > 408 - r && x < 428 + r) return false;
    if (Math.abs(z - 40) < 8 + r && x < 478) return false;
    if (x > teX - platW / 2 - r && x < teX + platW / 2 + r && z > teZ - platD / 2 - r && z < teZ + platD / 2 + tRun + r) return false;
    if (Math.hypot(x - 454, z - 96) < 9 + r) return false;
    if (Math.hypot(x - 418, z + 137) < 14 + r) return false;
    return true;
  };
  const spawnKapok = (x, z, s = 1) => {
    const h = 14 * s;
    pushKapok(kapokParts.trunk, x, JY + h / 2, z, s, s, s);
    for (let r = 0; r < 4; r++) {
      const ang = (r * Math.PI) / 2 + 0.4;
      pushKapok(kapokParts.root, x + Math.cos(ang) * 0.8 * s, JY + 1.5 * s, z + Math.sin(ang) * 0.8 * s, s, s, s, -ang);
    }
    pushKapok(kapokParts.c1, x, JY + h, z, 1.3 * s, 0.5 * s, 1.3 * s);
    pushKapok(kapokParts.c2, x + 1.8 * s, JY + h + 1.5 * s, z - 1.2 * s, 1.3 * s, 0.48 * s, 1.3 * s);
    pushKapok(kapokParts.c3, x - 1.5 * s, JY + h + 0.8 * s, z + 1.4 * s, 1.3 * s, 0.48 * s, 1.3 * s);
    for (let v = 0; v < 4; v++) {
      const va = v * 1.8 + x;
      const vLen = (3.2 + (v % 2) * 1.6) * s;
      pushKapok(kapokParts.vine, x + Math.cos(va) * 2.8 * s, JY + h - vLen / 2 - 0.4, z + Math.sin(va) * 2.8 * s, 1, vLen, 1);
    }
    addWorldBox(x - 1.5 * s, x + 1.5 * s, JY, JY + h * 0.7, z - 1.5 * s, z + 1.5 * s, 'jungle_tree', false);
  };
  for (let i = 0, placed = 0; i < 400 && placed < 80; i++) {
    const x = JX0 + 6 + rnd() * (JX1 - JX0 - 12);
    const z = JZ0 + 6 + rnd() * (JZ1 - JZ0 - 12);
    if (!jungleClear(x, z)) continue;
    spawnKapok(x, z, 0.9 + rnd() * 0.7);
    placed++;
  }
  {
    const addKapok = (geo, mat, list, cast = true) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = cast;
      im.receiveShadow = true;
      grp.add(im);
    };
    addKapok(new THREE.CylinderGeometry(0.5, 0.8, 14, 8), treeBarkMaterial, kapokParts.trunk);
    addKapok(new THREE.BoxGeometry(0.4, 3, 2), treeBarkMaterial, kapokParts.root);
    addKapok(new THREE.DodecahedronGeometry(4.5, 1), treeLeafMaterial, kapokParts.c1);
    addKapok(new THREE.DodecahedronGeometry(3.2, 1), treeLeafMaterial, kapokParts.c2);
    addKapok(new THREE.DodecahedronGeometry(3.0, 1), treeLeafMaterial, kapokParts.c3);
    addKapok(new THREE.CylinderGeometry(0.05, 0.05, 1, 5), vineMat, kapokParts.vine, false);
  }

  // Ferns (instanced), boulders & blooms
  const fernMat = makeMat(0x16a34a, { roughness: 0.85 });
  const boulderMat = makeMat(0x4b5563, { texType: 'cobblestone', repeatX: 2, repeatY: 2, roughness: 0.95 });
  const bloomColors = [0xf43f5e, 0xf59e0b, 0xa855f7, 0x38bdf8];
  const fernT = [];
  const fd = new THREE.Object3D();
  for (let i = 0; i < 120; i++) {
    const x = JX0 + 6 + rnd() * (JX1 - JX0 - 12);
    const z = JZ0 + 6 + rnd() * (JZ1 - JZ0 - 12);
    if (!jungleClear(x, z, 1)) continue;
    fd.position.set(x, JY + 0.55, z);
    fd.scale.set(1.4, 0.8, 1.4);
    fd.rotation.set(0, rnd() * 6.28, 0);
    fd.updateMatrix();
    fernT.push(fd.matrix.clone());
    if (i % 4 === 0) {
      mesh(new THREE.DodecahedronGeometry(1.5, 0), boulderMat, x + 1.5, JY + 0.8, z + 0.8);
      addWorldBox(x + 0.5, x + 2.5, JY, JY + 1.5, z - 0.3, z + 1.3, 'jungle_boulder', true);
    } else if (i % 3 === 0) {
      mesh(new THREE.DodecahedronGeometry(0.35, 0), makeMat(pick(bloomColors), { emissive: pick(bloomColors), emissiveIntensity: 0.35 }), x, JY + 1.2, z, false);
    }
  }
  if (fernT.length) {
    const ferns = new THREE.InstancedMesh(new THREE.ConeGeometry(1.4, 1.1, 8), fernMat, fernT.length);
    fernT.forEach((m, i) => ferns.setMatrixAt(i, m));
    ferns.instanceMatrix.needsUpdate = true;
    ferns.receiveShadow = true;
    grp.add(ferns);
  }
}

// -----------------------------------------------------------------------------
// Atmosphere, snow & wading
// -----------------------------------------------------------------------------
export const bio = { base: null, snow: null, last: 'city' };
export const bioC = {};
export function updateBiomeAtmosphere(dt, elapsed) {
  const b = biomeAt(player.x, player.z);
  if (!bio.base) bio.base = scene.fog.color.clone();
  const tgt = { alpine: [0xdbe9f4, 0.007], woods: [0x9ccaa6, 0.0048], cove: [0xaee2f4, 0.0024], jungle: [0x2d5a27, 0.006] }[b];
  const k = Math.min(1, dt * 1.5);
  scene.fog.color.lerp(tgt ? (bioC[tgt[0]] || (bioC[tgt[0]] = new THREE.Color(tgt[0]))) : bio.base, k);
  scene.fog.density += ((tgt ? tgt[1] : 0.0032) - scene.fog.density) * k;
  if (b !== bio.last) {
    bio.last = b;
    if (b !== 'city') pushFeed({ alpine: 'FROSTPINE ALPINE — ICY & SLIPPERY', woods: 'EMERALD WOODS — STREAMS SLOW YOU DOWN', cove: 'SUNSET COVE — WADING SLOWS YOU DOWN', jungle: 'VERDANT JUNGLE — RICH VEGETATION' }[b], 'border-l-sky-400');
  }
  if (!bio.snow) {
    const N = 420, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = (rnd() - 0.5) * 44; pos[i * 3 + 1] = rnd() * 16; pos[i * 3 + 2] = (rnd() - 0.5) * 44; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    bio.snow = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.14, transparent: true, opacity: 0.9 }));
    bio.snow.frustumCulled = false;
    bio.snow.userData.persistentFX = true;
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
  if (nb) {
    const f = 0.85 + Math.sin(elapsed * 17) * 0.15 + Math.random() * 0.1;
    nb.fire.scale.set(f, 0.9 + Math.random() * 0.3, f);
    nb.fl.intensity = 1.3 + Math.random() * 0.6;
  }
  if (!gameState.inCar && player.grounded && isInWater(player.x, player.z) && (keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD']) && Math.random() < dt * 9) {
    spawnParticles(player.x, player.y + 0.15, player.z, 0x7dd3fc, 3, 2.5);
  }
}

export const concMat = new THREE.MeshStandardMaterial({ color: 0x7d8280, roughness: .95 });
export const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
export const waterMat = new THREE.MeshStandardMaterial({ color: 0x2f5f4a, roughness: .15, metalness: .2, transparent: true, opacity: .82, emissive: 0x0b2a1e });

// -----------------------------------------------------------------------------
// Scorpion Hideout
// -----------------------------------------------------------------------------
export function buildCriminalHideout() {
  const cx = 332, cz = 130, baseY = 0.02, half = 30, peak = 32;
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xc28b47, roughness: 0.96, flatShading: true, side: THREE.DoubleSide });
  const chamberMat = new THREE.MeshStandardMaterial({ color: 0x34383b, roughness: 0.92 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x9a6a32, roughness: 0.85 });
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffc15a });
  const triangle = (a, b, c) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b), new THREE.Vector3(...c)]);
    geometry.setIndex([0, 1, 2]);
    geometry.computeVertexNormals();
    const m = new THREE.Mesh(geometry, shellMat);
    m.castShadow = true;
    m.receiveShadow = true;
    worldRoot.add(m);
  };
  const xw = cx - half, xe = cx + half, zn = cz - half, zs = cz + half;
  const apex = [cx, peak, cz];
  triangle([xw, baseY, zn], [xw, baseY, cz - 11], apex);
  triangle([xw, baseY, cz + 11], [xw, baseY, zs], apex);
  triangle([xw, 8.5, cz - 11], [xw, 8.5, cz + 11], apex);
  triangle([xe, baseY, zn], [xe, baseY, zs], apex);
  triangle([xw, baseY, zn], [xe, baseY, zn], apex);
  triangle([xe, baseY, zs], [xw, baseY, zs], apex);
  const box = (x, y, z, w, h, d, material, solid = false) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    worldRoot.add(m);
    if (solid) addWorldBox(x - w / 2, x + w / 2, baseY, baseY + h, z - d / 2, z + d / 2, 'solid', false);
    return m;
  };
  box(cx, baseY + 0.06, cz, 54, 0.12, 54, chamberMat);
  box(cx, 8.1, cz, 50, 0.4, 50, chamberMat);
  box(cx, 4, cz - 25, 50, 8, 2, chamberMat, true);
  box(cx, 4, cz + 25, 50, 8, 2, chamberMat, true);
  box(cx + 25, 4, cz, 2, 8, 50, chamberMat, true);
  box(cx - 25, 4, cz - 20, 2, 8, 10, chamberMat, true);
  box(cx - 25, 4, cz + 20, 2, 8, 10, chamberMat, true);
  box(cx - 25, 7.8, cz, 2, 0.3, 30, chamberMat);
  box(cx - 42, baseY + 0.04, cz, 34, 0.08, 24, trimMat);
  box(cx - 24, 4, cz, 0.3, 0.3, 20, lightMat);
  box(cx, 4, cz - 24, 0.3, 0.3, 16, lightMat);
  const sign = new THREE.Group();
  sign.position.set(xw - 0.25, 7.5, cz);
  sign.rotation.y = -Math.PI / 2;
  createNeonSign(sign, 'REDROCK SCORPION HIDEOUT', 0, 0, 0, '#1c1917', '#fbbf24', 13, 1.25);
  worldRoot.add(sign);
  const beacon = new THREE.PointLight(0xffb14a, 55, 30, 2);
  beacon.position.set(cx, 6.5, cz);
  worldRoot.add(beacon);
  enterableZones.push({ minX: cx - 24, maxX: cx + 24, minZ: cz - 24, maxZ: cz + 24, name: 'REDROCK SCORPION HIDEOUT' });
  mapShapes.push({ x: cx, z: cz, w: 60, d: 60, color: '#b77935', border: '#78350f', enterable: true });

  const tank = buildSportsCar({ name: 'REDROCK SCORPION TANK', bodyHex: 0x4b5541, accentHex: 0x252a22, x: cx + 1, z: cz, yaw: -Math.PI / 2, isCoupe: false });
  placeCar(tank, 0.14);
  tank.isTank = true;
  tank.chassis.visible = false;
  tank.wheelPivots.forEach((wheel) => { wheel.visible = false; });
  const hull = new THREE.Group();
  const armor = new THREE.MeshStandardMaterial({ color: 0x59664c, roughness: 0.78, metalness: 0.2 });
  const darkArmor = new THREE.MeshStandardMaterial({ color: 0x30372e, roughness: 0.9 });
  const hullBody = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.1, 4.7), armor);
  hullBody.position.y = 0.95;
  hullBody.castShadow = true;
  hull.add(hullBody);
  for (const side of [-1, 1]) {
    const track = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.95, 4.9), darkArmor);
    track.position.set(side * 1.55, 0.39, 0);
    track.castShadow = true;
    hull.add(track);
    for (let i = 0; i < 10; i++) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.07, 0.28), armor);
      pad.position.set(side * 1.56, 0.39, -2.05 + i * 0.45);
      hull.add(pad);
    }
  }
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 1.08, 0.62, 10), armor);
  turret.position.set(0, 1.75, -0.15);
  turret.castShadow = true;
  hull.add(turret);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.19, 2.8, 10), darkArmor);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 1.78, 1.55);
  hull.add(barrel);
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.13, 8), darkArmor);
  hatch.position.set(0, 2.12, -0.18);
  hull.add(hatch);
  tank.root.add(hull);
  tank.tankModel = hull;
  return tank;
}

/** Set a car's resting height (works with the current vehicles.js). */
function placeCar(car, y) {
  if (!car) return car;
  car.y = y;
  car.root.position.y = y;
  return car;
}

// -----------------------------------------------------------------------------
// Northern mountains with winding road
// -----------------------------------------------------------------------------
export function buildMountains() {
  const X0 = -138, X1 = 370, Z0 = -170, Z1 = -590, SX = 254, SZ = 210;
  const g = new THREE.PlaneGeometry(X1 - X0, Z0 - Z1, SX, SZ);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color(), c2 = new THREE.Color();
  const stv = SX + 1, Hh = new Float32Array(p.count);
  const dx = (X1 - X0) / SX, dz = (Z0 - Z1) / SZ;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + (X0 + X1) / 2, z = p.getZ(i) + (Z0 + Z1) / 2;
    const h = terrainBaseH(x, z);
    Hh[i] = h;
    p.setXYZ(i, x, h - 0.1, z);
  }
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), h = Hh[i];
    const cx = i % stv, cz = (i / stv) | 0;
    const il = cx > 0 ? i - 1 : i, ir = cx < SX ? i + 1 : i;
    const iu = cz > 0 ? i - stv : i, id = cz < SZ ? i + stv : i;
    const sl = Math.abs(Hh[ir] - Hh[il]) / (2 * dx) + Math.abs(Hh[id] - Hh[iu]) / (2 * dz);
    const n = fbm(x * .08, z * .08, 3), n2 = fbm(x * .02 + 7, z * .02, 3);
    const snowLine = 150 + n * 30;
    c.set(0x547a3a).lerp(c2.set(0x6e8a45), n);
    c.lerp(c2.set(0x34502f), sstep(35, 70, h));
    c.lerp(c2.set(0x8a8070), sstep(95, 140, h));
    c.lerp(c2.set(0x6d655b).lerp(new THREE.Color(0x8a8175), n), sstep(.4, .85, sl));
    if (sl > .4) c.multiplyScalar(.92 + .08 * Math.sin(h * .45 + n * 6));
    c.lerp(c2.set(0xf2f6fa), sstep(snowLine - 12, snowLine + 8, h) * (1 - sstep(.7, 1.0, sl)));
    c.multiplyScalar(.9 + .2 * n2);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  mesh.receiveShadow = true;
  mesh.userData.studioName = 'Northern mountains';
  registerSculptableTerrain(mesh);
  worldRoot.add(mesh);

  function ribbon(hw, dy, hex) {
    const pos = [], idx = [];
    let k = 0;
    for (let z = -168; z >= -584; z -= 2.5) {
      const cx = roadC(z), tx = roadC(z - 1) - cx, len = Math.hypot(tx, 1);
      const nx = 1 / len, nz = -tx / len, y = roadH(z) + dy;
      pos.push(cx - nx * hw, y, z - nz * hw, cx + nx * hw, y, z + nz * hw);
      if (k > 0) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      k++;
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    gg.setIndex(idx);
    gg.computeVertexNormals();
    const m = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ color: hex, roughness: .92, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    worldRoot.add(m);
  }
  ribbon(5.2, 0.05, 0x23262b);
  ribbon(0.12, 0.08, 0xe9c33a);

  const pineG = new THREE.ConeGeometry(2.1, 8, 7);
  pineG.translate(0, 4.5, 0);
  const pines = new THREE.InstancedMesh(pineG, treeLeafMaterial, 1500);
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1.6, 0), rockMat, 420);
  const dm = new THREE.Object3D();
  let np = 0, nr = 0;
  for (let k = 0; k < 16000 && (np < 1500 || nr < 420); k++) {
    const x = X0 + 8 + rnd() * (X1 - X0 - 16), z = -175 - rnd() * 400;
    const h = terrainH(x, z), d = Math.abs(x - roadC(z));
    if (d < 11) continue;
    const sl = Math.abs(terrainH(x + 3, z) - terrainH(x - 3, z)) / 6;
    if (np < 1500 && h > 4 && h < 95 && sl < .55 && fbm(x * .05, z * .05, 2) > .42) {
      dm.position.set(x, h - .2, z);
      const s = .8 + rnd() * 1.3;
      dm.scale.set(s, s * (.9 + rnd() * .6), s);
      dm.rotation.set(0, rnd() * 6, 0);
      dm.updateMatrix();
      pines.setMatrixAt(np++, dm.matrix);
    } else if (nr < 420 && sl > .3) {
      dm.position.set(x, h, z);
      const s = .6 + rnd() * 2.2;
      dm.scale.set(s, s * .7, s);
      dm.rotation.set(rnd() * 3, rnd() * 3, 0);
      dm.updateMatrix();
      rocks.setMatrixAt(nr++, dm.matrix);
    }
  }
  pines.count = np;
  rocks.count = nr;
  pines.castShadow = true;
  worldRoot.add(pines, rocks);

  {
    const rp = [], ri = [], RW = 5;
    let k = 0;
    for (let z = -176; z >= -584; z -= 3) {
      const cx = riverX(z), y = Math.max(terrainH(cx, z), .3) + 0.15;
      rp.push(cx - RW, y, z, cx + RW, y, z);
      if (k > 0) { const a = (k - 1) * 2; ri.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      k++;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    rg.setIndex(ri);
    rg.computeVertexNormals();
    worldRoot.add(new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: 0x3c8aa6, roughness: .12, metalness: .25, transparent: true, opacity: .8, side: THREE.DoubleSide })));
  }
  camera.far = Math.max(camera.far, 620);
  camera.updateProjectionMatrix();
}

// -----------------------------------------------------------------------------
// Sewer network
// -----------------------------------------------------------------------------
export function buildSewer() {
  const root = new THREE.Group();
  root.userData.studioName = 'Sewer network';
  worldRoot.add(root);
  const SW = 5.4, H2 = SW / 2, WH = 4.6, CY = SFY + WH;
  const sg = new THREE.BoxGeometry(1, 1, 1);
  const wallM = new THREE.MeshStandardMaterial({ color: 0x6b706c, roughness: .95 });
  const flrM = new THREE.MeshStandardMaterial({ color: 0x585c58, roughness: .9 });
  const pipeM = new THREE.MeshStandardMaterial({ color: 0x7b5a3c, metalness: .5, roughness: .6 });
  const blueM = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
  const box = (m, x, y, z, a, b, d) => {
    const o = new THREE.Mesh(sg, m);
    o.position.set(x, y, z);
    o.scale.set(a, b, d);
    root.add(o);
    return o;
  };
  const N = { A: [-130, -30], B: [-40, -30], C: [20, -30], D: [48, -30], E: [150, -30], F: [48, -16], G: [20, -66], H: [20, 24], I: [20, 110], J: [-4, 24] };
  const E = [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E'], ['D', 'F'], ['C', 'G'], ['C', 'H'], ['H', 'I'], ['H', 'J']];
  const exits = ['J', 'F', 'B', 'G'];   // these already have surface manholes in state.js
  ['A', 'E', 'I'].forEach((k) => {
    const q = N[k];
    if (!collidesHorizontally(q[0], q[1], .2, 1.8, 1.4) && !collidesHorizontally(q[0], q[1] + 1, .2, 1.8, 1.4)) {
      exits.push(k);
      manholes.push(q.slice());
    }
  });
  const dirOf = (p, q) => p[0] !== q[0] ? (q[0] > p[0] ? '+x' : '-x') : (q[1] > p[1] ? '+z' : '-z');
  const has = {};
  for (const k in N) has[k] = new Set();
  for (const [a, b] of E) { has[a].add(dirOf(N[a], N[b])); has[b].add(dirOf(N[b], N[a])); }
  const holeShape = new THREE.Shape();
  holeShape.moveTo(-H2, -H2); holeShape.lineTo(H2, -H2); holeShape.lineTo(H2, H2); holeShape.lineTo(-H2, H2); holeShape.closePath();
  const hp = new THREE.Path();
  hp.absarc(0, 0, 1.05, 0, Math.PI * 2, true);
  holeShape.holes.push(hp);
  const holeGeo = new THREE.ExtrudeGeometry(holeShape, { depth: .6, bevelEnabled: false });
  holeGeo.rotateX(Math.PI / 2);
  const holeM = new THREE.MeshStandardMaterial({ color: 0x5a5e5a, roughness: .95, side: THREE.DoubleSide });
  const lamps = [];
  for (const k in N) {
    const [x, z] = N[k], ex = exits.indexOf(k);
    sRects.push([x - H2, x + H2, z - H2, z + H2]);
    box(flrM, x, SFY - .25, z, SW, .5, SW);
    if (ex < 0) box(wallM, x, CY + .3, z, SW, .6, SW);
    else {
      const c = new THREE.Mesh(holeGeo, holeM);
      c.position.set(x, CY + .6, z);
      root.add(c);
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, -SFY + .1, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x4d514d, roughness: 1, side: THREE.BackSide }));
      sh.position.set(x, (SFY + .1) / 2, z);
      root.add(sh);
      for (const sx of [-.3, .3]) box(blueM, x + sx, SFY / 2, z + .95, .05, -SFY, .05);
      for (let y = SFY + .6; y < 0; y += .6) box(blueM, x, y, z + .95, .6, .05, .05);
      lamps.push([x, CY - .1, z + 1.6]);
    }
    for (const d of ['+x', '-x', '+z', '-z']) {
      if (!has[k].has(d)) {
        const sgn = d[0] === '+' ? 1 : -1;
        if (d[1] === 'x') box(wallM, x + sgn * (H2 + .25), SFY + WH / 2, z, .5, WH, SW + 1);
        else box(wallM, x, SFY + WH / 2, z + sgn * (H2 + .25), SW + 1, WH, .5);
      }
    }
  }
  for (const [a, b] of E) {
    const A = N[a], B = N[b], ax = A[1] === B[1];
    const cx = (A[0] + B[0]) / 2, cz = (A[1] + B[1]) / 2;
    const L = (ax ? Math.abs(A[0] - B[0]) : Math.abs(A[1] - B[1])) - SW;
    sRects.push([Math.min(A[0], B[0]) - H2, Math.max(A[0], B[0]) + H2, Math.min(A[1], B[1]) - H2, Math.max(A[1], B[1]) + H2]);
    if (ax) {
      box(flrM, cx, SFY - .25, cz, L, .5, SW);
      box(wallM, cx, CY + .3, cz, L, .6, SW);
      box(waterMat, cx, SFY + .04, cz, L, .06, 1.5);
      for (const sd of [-1, 1]) box(wallM, cx, SFY + WH / 2, cz + sd * (H2 + .25), L, WH, .5);
    } else {
      box(flrM, cx, SFY - .25, cz, SW, .5, L);
      box(wallM, cx, CY + .3, cz, SW, .6, L);
      box(waterMat, cx, SFY + .04, cz, 1.5, .06, L);
      for (const sd of [-1, 1]) box(wallM, cx + sd * (H2 + .25), SFY + WH / 2, cz, .5, WH, L);
    }
    const pg = new THREE.Mesh(new THREE.CylinderGeometry(.28, .28, L, 10), pipeM);
    if (ax) { pg.rotation.z = Math.PI / 2; pg.position.set(cx, CY - .5, cz + H2 - .6); }
    else { pg.rotation.x = Math.PI / 2; pg.position.set(cx + H2 - .6, CY - .5, cz); }
    root.add(pg);
    for (let t = -L / 2 + 4; t < L / 2 - 2; t += 9) lamps.push(ax ? [cx + t, CY - .1, cz] : [cx, CY - .1, cz + t]);
  }
  const lm = new THREE.InstancedMesh(sg, lampMat, lamps.length);
  const dm = new THREE.Object3D();
  lamps.forEach((l, i) => { dm.position.set(l[0], l[1], l[2]); dm.scale.set(.6, .12, .6); dm.updateMatrix(); lm.setMatrixAt(i, dm.matrix); });
  root.add(lm);
  const holeDiscG = new THREE.CircleGeometry(.72, 20).rotateX(-Math.PI / 2);
  const holeDiscM = new THREE.MeshBasicMaterial({ color: 0x050505 });
  const cvG = new THREE.CylinderGeometry(.75, .75, .06, 20);
  const cvM = new THREE.MeshStandardMaterial({ color: 0x2b2e31, metalness: .8, roughness: .5 });
  manholes.forEach((m) => {
    const c = new THREE.Mesh(cvG, cvM);
    c.position.set(m[0], .22, m[1]);
    worldRoot.add(c);
    manholeCovers.push(c);
    manholeOpen.push(false);
    const hd = new THREE.Mesh(holeDiscG, holeDiscM);
    hd.position.set(m[0], .2, m[1]);
    hd.visible = false;
    worldRoot.add(hd);
    manholeHoles.push(hd);
  });
}

export function knockOverLamppost(l, y, s) {
  if (l.state !== 'standing') return;
  knockOverLamppostBase(l, y, s);
  if (s > 6) crime(.08);
  hooks.mpWorldEvent({ t: 'lamp_hit', i: lampPosts.indexOf(l), yaw: y, speed: s });
}

// -----------------------------------------------------------------------------
// Aura Estates / hospital
// -----------------------------------------------------------------------------
export function buildAuraEstates() {
  const bxG = new THREE.BoxGeometry(1, 1, 1);
  const M = (c, r, e) => new THREE.MeshStandardMaterial({ color: c, roughness: r == null ? .9 : r, emissive: e || 0, emissiveIntensity: e ? 1.2 : 0 });
  const K = {
    wall: M(0xe9e6df), roof: M(0x2b2f36), floor: M(0xd8dde0, .5), glass: M(0x8fb8d6, .15),
    red: M(0xdc2626), white: M(0xf5f5f5), wood: M(0x6b4a2f), sofa: M(0x394a5e),
    lamp: M(0xfff7d6, .5, 0xfff7d6), gold: M(0xf5c542, .3, 0xb8860b), stone: M(0xb9b2a6),
    drive: M(0x3a3d42), metal: M(0x20242a, .4), blue: M(0x7ec8e3), black: M(0x111111)
  };
  const bx = (g, m, x, y, z, a, b, d) => { const o = new THREE.Mesh(bxG, m); o.position.set(x, y, z); o.scale.set(a, b, d); g.add(o); return o; };
  const wb = (x, y, z, a, b, d) => addWorldBox(x - a / 2, x + a / 2, y - b / 2, y + b / 2, z - d / 2, z + d / 2, 'solid', false);
  const culls = [], houses = [], gate = { open: false, boxes: [], l1: null, l2: null };
  aura.culls = culls;

  {
    const X0 = -560, X1 = -196, Z0 = -172, Z1 = 172, N = 114;
    const g = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, N, N);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, col = new Float32Array(p.count * 3), H = new Float32Array(p.count);
    const c = new THREE.Color(), c2 = new THREE.Color(), st = N + 1;
    const dx = (X1 - X0) / N, dz = (Z1 - Z0) / N;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + (X0 + X1) / 2, z = p.getZ(i) + (Z0 + Z1) / 2;
      const h = terrainBaseH(x, z);
      H[i] = h;
      p.setXYZ(i, x, h - .1, z);
    }
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), h = H[i];
      const cx = i % st, cz = (i / st) | 0;
      const il = cx > 0 ? i - 1 : i, ir = cx < N ? i + 1 : i;
      const iu = cz > 0 ? i - st : i, id = cz < N ? i + st : i;
      const sl = Math.abs(H[ir] - H[il]) / (2 * dx) + Math.abs(H[id] - H[iu]) / (2 * dz);
      const n = fbm(x * .06, z * .06, 3);
      c.set(0x5b7d3c).lerp(c2.set(0x8a8f52), n);
      c.lerp(c2.set(0xa59a76), sstep(40, 85, h));
      c.lerp(c2.set(0x4f8a3f), 1 - sstep(66, 100, Math.hypot(x - AHC.px, z - AHC.pz)));
      c.lerp(c2.set(0x76705f), sstep(.35, .75, sl));
      c.multiplyScalar(.9 + .2 * n);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const tm = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    tm.receiveShadow = true;
    tm.userData.studioName = 'Aura Hills terrain';
    registerSculptableTerrain(tm);
    worldRoot.add(tm);
    const pts = [];
    for (let s = 0; s <= 274; s += 3) { const x = -196 - s; pts.push([x, ahRz(x)]); }
    const ribbon = (w, dy, color) => {
      const pos = [], idx = [];
      pts.forEach((q, k) => {
        const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
        const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz);
        const nx = -tz / l, nz = tx / l, y = ahRy(q[0]) + dy;
        pos.push(q[0] + nx * w, y, q[1] + nz * w, q[0] - nx * w, y, q[1] - nz * w);
        if (k) { const i = (k - 1) * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
      });
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      rg.setIndex(idx);
      rg.computeVertexNormals();
      const m = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color, roughness: .9, side: THREE.DoubleSide }));
      m.receiveShadow = true;
      worldRoot.add(m);
    };
    ribbon(4.8, .12, 0x2a2d31);
    ribbon(.12, .16, 0xe8c547);
  }

  {
    const WG = new THREE.Group();
    WG.userData.studioName = 'Aura Estates';
    worldRoot.add(WG);
    const seg = (cx, cz, a, d) => { bx(WG, K.stone, cx, 39.7, cz, a, 3.4, d); wb(cx, 39.7, cz, a, 3.4, d); };
    seg(-480, -85, 96, .8); seg(-480, -5, 96, .8); seg(-528, -45, .8, 80);
    seg(-432, -67, .8, 36); seg(-432, -23, .8, 36);
    gate.l1 = bx(WG, K.metal, -431.4, 39.5, -47, .3, 3, 4);
    gate.l2 = bx(WG, K.metal, -431.4, 39.5, -43, .3, 3, 4);
    gate.boxes.push(wb(-431.4, 39.5, -47, .6, 3, 4), wb(-431.4, 39.5, -43, .6, 3, 4));
    bx(WG, K.stone, -432, 41.9, -45, .9, 1.4, 10);
    const sg = new THREE.Group();
    sg.position.set(-431.4, 41.9, -45);
    sg.rotation.y = Math.PI / 2;
    createNeonSign(sg, 'AURA ESTATES', 0, 0, 0, '#111827', '#fcd34d', 7, 1.1);
    worldRoot.add(sg);
    const HW = 15, HD = 11, HT = 4.2, Y = 38.18;
    [[-508, -68, 1], [-508, -22, -1], [-470, -70, 1], [-470, -20, -1], [-448, -70, 1], [-448, -20, -1]].forEach(([cx, cz, dir], k) => {
      const g = new THREE.Group();
      g.position.set(cx, Y, cz);
      worldRoot.add(g);
      const inn = new THREE.Group();
      g.add(inn);
      const fz = dir * HD / 2, bz = -dir * HD / 2, sw = (HW - 2.6) / 2;
      const wm = k % 2 ? K.wall : K.stone;
      bx(g, wm, 0, HT / 2, bz, HW, HT, .4); wb(cx, Y + HT / 2, cz + bz, HW, HT, .4);
      for (const sd of [-1, 1]) {
        bx(g, wm, sd * HW / 2, HT / 2, 0, .4, HT, HD); wb(cx + sd * HW / 2, Y + HT / 2, cz, .4, HT, HD);
        bx(g, wm, sd * (1.3 + sw / 2), HT / 2, fz, sw, HT, .4); wb(cx + sd * (1.3 + sw / 2), Y + HT / 2, cz + fz, sw, HT, .4);
        bx(g, K.glass, sd * (1.3 + sw / 2), 2.3, fz + dir * .22, sw * .6, 1.6, .05);
      }
      bx(g, wm, 0, HT - .5, fz, 2.6, 1, .4);
      bx(g, K.roof, 0, HT + .2, 0, HW + 1.4, .4, HD + 1.4);
      bx(g, K.drive, 0, .05, fz + dir * 5.5, 4, .1, 11);
      bx(inn, K.wood, 0, .02, 0, HW - .6, .05, HD - .6);
      bx(inn, K.sofa, -3, .45, -dir * 2.5, 4, .9, 1.2);
      bx(inn, K.wood, -3, .3, -dir * .6, 2, .6, 1);
      bx(inn, K.black, 4, 1.4, -dir * (HD / 2 - .4), 3, 1.6, .1);
      bx(inn, K.lamp, 0, HT - .2, 0, 2, .1, 2);
      bx(inn, K.wood, -5, .5, dir * 3, 1.2, 1, 2.4);
      const safe = bx(inn, K.gold, 5.5, .5, dir * (HD / 2 - 1.2), .9, .9, .7);
      houses.push({ safe, sx: cx + 5.5, sz: cz + dir * (HD / 2 - 1.2), taken: false });
      culls.push({ g: inn, x: cx, z: cz, r: 65 });
    });
  }

  // Hospital — colliders aligned with the 0.18 plinth
  {
    const W = 36, D = 26, HH = 7, T = .5, HY = 0.18;
    let hx = 0, hz = 0, found = false;
    const clear = (cx, cz) => {
      for (let x = -W / 2 - 4; x <= W / 2 + 4; x += 6)
        for (let z = -D / 2 - 4; z <= D / 2 + 4; z += 6)
          if (collidesHorizontally(cx + x, cz + z, .2, 1.8, 1.5)) return false;
      return true;
    };
    for (let x = -170; x <= 110 && !found; x += 10)
      for (let z = -140; z <= 160; z += 10)
        if (clear(x, z)) { hx = x; hz = z; found = true; break; }
    if (found) {
      const g = new THREE.Group();
      g.position.set(hx, HY, hz);
      g.userData.studioName = 'AURA GENERAL HOSPITAL';
      worldRoot.add(g);
      const inn = new THREE.Group();
      g.add(inn);
      bx(g, K.white, 0, HH / 2, -D / 2, W, HH, T); wb(hx, HY + HH / 2, hz - D / 2, W, HH, T);
      for (const sd of [-1, 1]) {
        bx(g, K.white, sd * W / 2, HH / 2, 0, T, HH, D); wb(hx + sd * W / 2, HY + HH / 2, hz, T, HH, D);
        const sw = (W - 6) / 2;
        bx(g, K.white, sd * (3 + sw / 2), HH / 2, D / 2, sw, HH, T); wb(hx + sd * (3 + sw / 2), HY + HH / 2, hz + D / 2, sw, HH, T);
      }
      bx(g, K.white, 0, HH - 1, D / 2, 6, 2, T);
      bx(g, K.roof, 0, HH + .25, 0, W + 1, .5, D + 1);
      bx(g, K.white, 0, 4.6, D / 2 + 2.5, 10, .3, 5);
      bx(g, K.red, -11, 4.5, D / 2 + .3, 1, 4, .15);
      bx(g, K.red, -11, 4.5, D / 2 + .3, 4, 1, .15);
      bx(g, K.red, 11, 4.5, D / 2 + .3, 1, 4, .15);
      bx(g, K.red, 11, 4.5, D / 2 + .3, 4, 1, .15);
      createNeonSign(g, 'AURA GENERAL HOSPITAL', 0, 6.3, D / 2 + .3, '#ffffff', '#dc2626', 12, 1.4);
      bx(inn, K.floor, 0, .02, 0, W - 1, .05, D - 1);
      for (let x = -15; x <= 15; x += 6) for (const z of [-6, 6]) bx(inn, K.lamp, x, HH - .3, z, 2.4, .1, .8);
      bx(inn, K.wood, 0, .55, 6, 8, 1.1, 1.2);
      bx(inn, K.white, 0, 1.12, 6, 8.2, .08, 1.4);
      for (let x = -14; x <= -8; x += 2) bx(inn, K.sofa, x, .4, 10, 1.2, .8, 1);
      const bed = (x, z) => {
        bx(inn, K.white, x, .45, z, 1.1, .5, 2.3);
        bx(inn, K.blue, x, .75, z + .3, 1.1, .12, 1.6);
        bx(inn, K.white, x, .8, z - .9, .7, .14, .5);
      };
      for (const x of [-14, -8, -2, 8, 13]) bed(x, -D / 2 + 3);
      for (const x of [-11, -5, 10.5]) bx(inn, K.blue, x, 1.3, -D / 2 + 3.2, .05, 2.2, 2.6);
      for (const x of [-16, -10, -4, 6, 11]) bx(inn, K.metal, x, 1, -D / 2 + 4.2, .06, 2, .06);
      aura.hospitalSpawn = { x: hx - 14, z: hz - D / 2 + 5.6 };
      culls.push({ g: inn, x: hx, z: hz, r: 80 });
      enterableZones.push({ minX: hx - W / 2 + 1, maxX: hx + W / 2 - 1, minZ: hz - D / 2 + 1, maxZ: hz + D / 2 - 1, name: 'AURA GENERAL HOSPITAL' });
    }
  }

  aura.ahCull = function (dt) {
    for (let i = 0; i < manholeCovers.length; i++) {
      const c = manholeCovers[i], tx = manholes[i][0] + (manholeOpen[i] ? 1.5 : 0);
      c.position.x += (tx - c.position.x) * Math.min(1, dt * 6);
      manholeHoles[i].visible = manholeOpen[i];
    }
    for (const c of culls) c.g.visible = Math.hypot(player.x - c.x, player.z - c.z) < c.r;
    const go = gate.open ? 4 : 0;
    gate.l1.position.z += ((-47 - go) - gate.l1.position.z) * Math.min(1, dt * 3);
    gate.l2.position.z += ((-43 + go) - gate.l2.position.z) * Math.min(1, dt * 3);
    if (!under() && player.x < -196) gameState.zoneName = player.x < -430 ? 'AURA ESTATES' : player.x > -350 && player.x < -220 && Math.abs(player.z) < 105 ? 'WESTSIDE DISTRICT' : 'AURA HILLS';
  };
  aura.ahHint = function () {
    if (!gate.open && Math.hypot(player.x + 432, player.z + 45) < 6) return '[F] FORCE OPEN GATE';
    for (const h of houses) if (!h.taken && Math.hypot(player.x - h.sx, player.z - h.sz) < 2.4) return '[F] CRACK SAFE';
    return '';
  };
  const applyGate = (open) => {
    if (!open || gate.open) return;
    gate.open = true;
    gate.boxes.forEach((b) => { const k = worldBoxes.indexOf(b); if (k >= 0) worldBoxes.splice(k, 1); });
  };
  const applySafe = (i) => {
    const h = houses[i];
    if (!h || h.taken) return;
    h.taken = true;
    h.safe.visible = false;
    spawnParticles(h.sx, 39.5, h.sz, 0xf5c542, 14, 5);
  };
  aura.estates = { gate, houses, applyGate, applySafe };
  aura.ahF = function () {
    if (!gate.open && Math.hypot(player.x + 432, player.z + 45) < 6) {
      applyGate(true);
      sfx.mantle();
      if (!hooks.mpIsGuest()) crime(.35);
      pushFeed('GATE FORCED OPEN — SECURITY ALERTED', 'border-l-rose-500');
      hooks.mpWorldEvent({ t: 'gate' });
      return;
    }
    for (let i = 0; i < houses.length; i++) {
      const h = houses[i];
      if (!h.taken && Math.hypot(player.x - h.sx, player.z - h.sz) < 2.4) {
        if (hooks.mpIsGuest()) {
          hooks.mpWorldEvent({ t: 'safe_req', i });
        } else {
          applySafe(i);
          gameState.cash += 600;
          sfx.pickup();
          crime(.5);
          pushFeed('SAFE CRACKED +$600', 'border-l-amber-400');
          hooks.updateHUD(true);
          hooks.mpWorldEvent({ t: 'safe', i });
        }
        return;
      }
    }
  };
}

// -----------------------------------------------------------------------------
// Skyline infill, Aura Hills trees, Westside district
// -----------------------------------------------------------------------------
export function buildAuraSkylineAndHighway() {
  const rr = (n) => { const v = Math.sin(n * 127.1) * 43758.5453; return v - Math.floor(v); };
  const sm = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: .85 });

  {
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 128;
    const x = cv.getContext('2d');
    x.fillStyle = '#1d2b3a';
    x.fillRect(0, 0, 64, 128);
    for (let r = 0; r < 16; r++) for (let c = 0; c < 8; c++) {
      x.fillStyle = rr(r * 9 + c) < .35 ? '#ffe9a8' : '#2f4a63';
      x.fillRect(c * 8 + 1, r * 8 + 1, 6, 6);
    }
    const base = new THREE.CanvasTexture(cv);
    base.colorSpace = THREE.SRGBColorSpace;
    base.wrapS = base.wrapT = THREE.RepeatWrapping;
    const tg = new THREE.BoxGeometry(1, 1, 1), roofM = sm(0x20242a);
    let placed = 0;
    const clearT = (cx, cz, w) => {
      for (let a = -w / 2 - 3; a <= w / 2 + 3; a += 5)
        for (let b = -w / 2 - 3; b <= w / 2 + 3; b += 5)
          if (collidesHorizontally(cx + a, cz + b, .2, 1.8, 1.5)) return false;
      return true;
    };
    for (let k = 1; k < 600 && placed < 9; k++) {
      const cx = -170 + rr(k * 1.3) * 290, cz = -150 + rr(k * 2.9) * 320;
      const w = 14 + rr(k) * 6, h = 45 + rr(k * 5.1) * 50;
      if (Math.hypot(cx + 11.5, cz - 18.5) < 30 || manholes.some((m) => Math.hypot(cx - m[0], cz - m[1]) < w)) continue;
      if (!clearT(cx, cz, w)) continue;
      const t = base.clone();
      t.needsUpdate = true;
      t.repeat.set(Math.round(w / 3), Math.round(h / 6));
      const m = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: .25, roughness: .25, metalness: .4 }));
      m.position.set(cx, h / 2, cz);
      m.scale.set(w, h, w);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.studioName = `Skyline tower ${placed + 1}`;
      worldRoot.add(m);
      const r = new THREE.Mesh(tg, roofM);
      r.position.set(cx, h + .4, cz);
      r.scale.set(w + .6, .8, w + .6);
      worldRoot.add(r);
      addWorldBox(cx - w / 2, cx + w / 2, 0, h, cz - w / 2, cz + w / 2, 'tower', false);
      placed++;
    }
  }

  {
    const n = 500;
    const mesh = new THREE.InstancedMesh(new THREE.ConeGeometry(2, 7, 7), treeLeafMaterial, n);
    const d = new THREE.Object3D();
    let c = 0;
    for (let k = 1; k < 5000 && c < n; k++) {
      const x = -216 - rr(k * 2.1) * 338, z = -165 + rr(k * 3.7) * 330;
      const h = hillsH(x, z);
      const sl = Math.abs(hillsH(x + 3, z) - hillsH(x - 3, z)) / 6;
      const dr = Math.abs(z - ahRz(x)) / Math.hypot(1, ahRzD(x));
      if ((x > -360 && x < -205 && Math.abs(z) < 125) || sl > .7 || h < 3 || (-196 - x < 300 && dr < 12) || Math.hypot(x - AHC.px, z - AHC.pz) < 72) continue;
      d.position.set(x, h + 3.2, z);
      d.scale.setScalar(.8 + rr(k) * .9);
      d.updateMatrix();
      mesh.setMatrixAt(c++, d.matrix);
    }
    mesh.count = c;
    mesh.castShadow = true;
    worldRoot.add(mesh);
  }

  // Westside district — streets at ahRy+9 match hillsH's town blend
  {
    const streetM = sm(0x303840), stripeM = new THREE.MeshBasicMaterial({ color: 0xf5c84c });
    for (const x of [-330, -310, -290, -270, -250, -230]) {
      const floor = ahRy(x) + 9, roadZ = ahRz(x);
      for (const [z0, z1] of [[-94, roadZ - 28], [roadZ + 28, 94]]) {
        if (z1 - z0 < 8) continue;
        const road = new THREE.Mesh(new THREE.BoxGeometry(6, .12, z1 - z0), streetM);
        road.position.set(x, floor + .04, (z0 + z1) / 2);
        road.receiveShadow = true;
        worldRoot.add(road);
        addWorldBox(x - 3, x + 3, floor - .02, floor + .1, z0, z1, 'westcity_road', true);
        const dashT = [];
        for (let z = z0 + 3; z < z1 - 1; z += 8) dashT.push([x, floor + .112, z]);
        if (dashT.length) {
          const dm = new THREE.Object3D();
          const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(.16, .025, 2.4), stripeM, dashT.length);
          dashT.forEach(([dx2, dy, dz], i) => { dm.position.set(dx2, dy, dz); dm.updateMatrix(); dashes.setMatrixAt(i, dm.matrix); });
          dashes.instanceMatrix.needsUpdate = true;
          worldRoot.add(dashes);
        }
      }
    }
    const facade = document.createElement('canvas');
    facade.width = 64; facade.height = 128;
    const fc = facade.getContext('2d');
    fc.fillStyle = '#182a3a';
    fc.fillRect(0, 0, 64, 128);
    for (let row = 0; row < 16; row++) for (let col = 0; col < 8; col++) {
      fc.fillStyle = rr(row * 13 + col * 7) < .38 ? '#ffe9a8' : '#36566e';
      fc.fillRect(col * 8 + 1, row * 8 + 1, 6, 6);
    }
    const windows = new THREE.CanvasTexture(facade);
    windows.colorSpace = THREE.SRGBColorSpace;
    windows.wrapS = windows.wrapT = THREE.RepeatWrapping;
    windows.repeat.set(2, 7);
    const towerM = [0x9ab5c5, 0xb7c4cc, 0x829eaf].map((color) => new THREE.MeshStandardMaterial({ color, map: windows, emissiveMap: windows, emissive: 0xffffff, emissiveIntensity: .18, roughness: .3, metalness: .35 }));
    const lowM = [0x5b6670, 0x8c8172, 0x65746f].map((color) => sm(color));
    const cityBox = new THREE.BoxGeometry(1, 1, 1), roofM = sm(0x29323a);
    const addBuilding = (x, z, w, d, h, mat) => {
      const ground = hillsH(x, z);
      const body = new THREE.Mesh(cityBox, mat);
      body.position.set(x, ground + h / 2, z);
      body.scale.set(w, h, d);
      body.castShadow = true;
      body.receiveShadow = true;
      worldRoot.add(body);
      const roof = new THREE.Mesh(cityBox, roofM);
      roof.position.set(x, ground + h + .24, z);
      roof.scale.set(w + .5, .48, d + .5);
      worldRoot.add(roof);
      addWorldBox(x - w / 2, x + w / 2, ground, ground + h, z - d / 2, z + d / 2, 'westcity_building', false);
    };
    for (let i = 0; i < 5; i++) for (const side of [-1, 1]) {
      const x = -320 + i * 20, z = ahRz(x) + side * 43;
      addBuilding(x, z, 13 + (i % 3), 15 + (i % 2) * 2, 28 + (i * 11 + side * 7 + 70) % 31, towerM[(i + (side > 0 ? 1 : 0)) % towerM.length]);
    }
    for (let i = 0; i < 4; i++) for (const side of [-1, 1]) {
      const x = -320 + i * 20, z = ahRz(x) + side * 66;
      addBuilding(x, z, 9 + (i % 2), 10 + (i % 3), 13 + (i * 7 + side * 3 + 30) % 15, lowM[(i + (side > 0 ? 1 : 0)) % lowM.length]);
    }
  }
}

// ============================================================================
// DATA-DRIVEN WORLD ENTITIES + STUDIO REGISTRY
// ============================================================================
export const entityObjects = new Map();
export const studioObjects = new Map();
const studioObjectBaseTransforms = new Map();
const studioDeletedObjects = new Map();

function applyObjectTransform(object, transform) {
  if (!transform || transform.deleted) return;
  object.position.fromArray(transform.position);
  object.rotation.fromArray(transform.rotation);
  object.scale.fromArray(transform.scale);
}

function registerStudioObjectTree(root, rootPath, data = levelData) {
  const visit = (object, path) => {
    object.userData.studioPath = path;
    object.userData.studioNamed = Boolean(object.userData.studioName || object.name);
    if (!object.userData.studioName) object.userData.studioName = object.name || `${object.isMesh ? 'Mesh' : object.type} ${path.split('/').pop()}`;
    studioObjects.set(path, object);
    if (!studioObjectBaseTransforms.has(path)) {
      studioObjectBaseTransforms.set(path, { position: object.position.toArray(), rotation: object.rotation.toArray(), scale: object.scale.toArray() });
    }
    const saved = data.worldTransforms && data.worldTransforms[path];
    if (saved && !saved.deleted) applyObjectTransform(object, saved);
    object.children.forEach((child, index) => visit(child, `${path}/${index}`));
  };
  visit(root, rootPath);
}

export function applyStudioWorldTransforms(data = levelData) {
  for (const [path, entry] of [...studioDeletedObjects.entries()]) {
    const saved = data.worldTransforms && data.worldTransforms[path];
    if (!saved || !saved.deleted) {
      if (entry.parent && entry.object) entry.parent.add(entry.object);
      studioDeletedObjects.delete(path);
      if (entry.object) registerStudioObjectTree(entry.object, path, data);
    }
  }
  for (const [path, object] of [...studioObjects.entries()]) {
    const saved = data.worldTransforms && data.worldTransforms[path];
    if (saved && saved.deleted) { removeEntityObject(path); continue; }
    const base = studioObjectBaseTransforms.get(path);
    if (base) applyObjectTransform(object, base);
    if (saved) applyObjectTransform(object, saved);
  }
}

function registerGeneratedWorldObjects(data = levelData) {
  studioObjects.clear();
  studioDeletedObjects.clear();
  let staticIndex = 0;
  for (const root of worldRoot.children) {
    if (root.userData.studioSelectable === false || root.userData.persistentFX) continue;
    root.userData.worldBuilt = true;
    const entityId = root.userData.entityId;
    registerStudioObjectTree(root, entityId ? `entity:${entityId}` : `static:${staticIndex++}`, data);
  }
  if (data.worldTransforms) {
    for (const [path, saved] of Object.entries(data.worldTransforms)) {
      if (saved && saved.deleted) removeEntityObject(path);
    }
  }
}

const ENTITY_Y_OFFSET = { pickup: 0.55 };

function tagEntity(root, id) {
  root.userData.entityId = id;
  root.traverse((child) => { child.userData.entityId = id; });
}

function applyEntityLook(object, entity) {
  if (entity.color && !['vehicle', 'block', 'prop', 'ramp', 'building', 'road'].includes(entity.type)) applyEntityColor(object, entity.color);
  if (entity.texture) applyEntityTexture(object, entity.texture, (entity.texRepeat || [1, 1])[0], (entity.texRepeat || [1, 1])[1]);
}

function makeRampMesh(color) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0); shape.lineTo(0.5, 0); shape.lineTo(0.5, 1); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  g.rotateY(-Math.PI / 2);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, makeMat(colorToHex(color, 0xf59e0b), { roughness: 0.7 }));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function makePrimitiveMesh(shape, color, fallback) {
  let geo;
  if (shape === 'cylinder') geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
  else if (shape === 'sphere') geo = new THREE.SphereGeometry(0.5, 20, 14);
  else if (shape === 'cone') geo = new THREE.ConeGeometry(0.5, 1, 20);
  else geo = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Mesh(geo, makeMat(colorToHex(color, fallback), { roughness: 0.8 }));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function makeBuildingMesh(entity) {
  const building = entity.building || {};
  const width = THREE.MathUtils.clamp(Number(building.width) || 12, 2, 200);
  const depth = THREE.MathUtils.clamp(Number(building.depth) || 10, 2, 200);
  const height = THREE.MathUtils.clamp(Number(building.height) || 12, 2, 300);
  const wallMat = makeMat(colorToHex(entity.color, 0x64748b), { texType: 'concrete', roughness: 0.82 });
  const trimMat = makeMat(colorToHex(building.roofColor, 0x1e293b), { metalness: 0.35, roughness: 0.55 });
  const windowColor = colorToHex(building.windowColor, 0x7dd3fc);
  const glassMat = new THREE.MeshStandardMaterial({ color: windowColor, emissive: windowColor, emissiveIntensity: 0.12, metalness: 0.2, roughness: 0.25 });
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wallMat);
  body.userData.studioName = 'Building body';
  body.position.y = height / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(width + 0.5, 0.35, depth + 0.5), trimMat);
  roof.userData.studioName = 'Roof';
  roof.position.y = height + 0.17;
  roof.castShadow = true;
  root.add(roof);
  const floors = Math.min(20, Math.max(1, Math.floor(height / 3.2)));
  const columns = Math.min(8, Math.max(1, Math.floor(width / 2.8)));
  const windowW = Math.min(1.35, width / (columns * 2.2));
  const windowH = Math.min(1.45, Math.max(0.55, height / (floors * 2.1)));
  for (let floor = 0; floor < floors; floor++) {
    const y = (floor + 0.55) * height / floors;
    for (let column = 0; column < columns; column++) {
      const x = (column + 0.5) * width / columns - width / 2;
      for (const side of [-1, 1]) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(windowW, windowH, 0.06), glassMat);
        window.userData.studioName = `Window ${floor + 1}-${column + 1}-${side < 0 ? 'back' : 'front'}`;
        window.position.set(x, y, side * (depth / 2 + 0.035));
        root.add(window);
      }
    }
  }
  return root;
}

function makeRoadMesh(entity) {
  const road = entity.road || {};
  const width = THREE.MathUtils.clamp(Number(road.width) || 24, 2, 500);
  const depth = THREE.MathUtils.clamp(Number(road.depth) || 12, 2, 500);
  const root = new THREE.Group();
  const surface = new THREE.Mesh(new THREE.BoxGeometry(width, 0.12, depth), makeMat(colorToHex(entity.color, 0x313946), { texType: 'asphalt', roughness: 0.88 }));
  surface.position.y = 0.06;
  surface.receiveShadow = true;
  root.add(surface);
  if (road.markings !== false) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.025, depth * 0.78), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
    stripe.position.set(0, 0.13, 0);
    root.add(stripe);
  }
  return root;
}

/** Register a road entity as a flat box or a driveable ramp; returns its record. */
function registerRoadRamp(object, entity) {
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  const rot = entity.rot || [0, 0, 0];
  const scale = entity.scale || [1, 1, 1];
  if (Math.hypot(rot[0] || 0, rot[2] || 0) === 0) {
    return addWorldBox(bounds.min.x, bounds.max.x, bounds.min.y, bounds.max.y, bounds.min.z, bounds.max.z, 'entity_road', true);
  }
  const cfg = entity.road || {};
  const halfW = ((Number(cfg.width) || 24) * scale[0]) * 0.5;
  const halfL = ((Number(cfg.depth) || 12) * scale[2]) * 0.5;
  const pNegX = new THREE.Vector3(-halfW, 0, 0).applyMatrix4(object.matrixWorld);
  const pPosX = new THREE.Vector3(halfW, 0, 0).applyMatrix4(object.matrixWorld);
  const pNegZ = new THREE.Vector3(0, 0, -halfL).applyMatrix4(object.matrixWorld);
  const pPosZ = new THREE.Vector3(0, 0, halfL).applyMatrix4(object.matrixWorld);
  const useX = Math.abs(pPosX.y - pNegX.y) >= Math.abs(pPosZ.y - pNegZ.y);
  const pMin = useX ? (pNegX.x < pPosX.x ? pNegX : pPosX) : (pNegZ.z < pPosZ.z ? pNegZ : pPosZ);
  const pMax = useX ? (pNegX.x < pPosX.x ? pPosX : pNegX) : (pNegZ.z < pPosZ.z ? pPosZ : pNegZ);
  return addDriveableRamp({
    minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z,
    startY: pMin.y + 0.08, endY: pMax.y + 0.08, axis: useX ? 'x' : 'z', dir: pMax.y >= pMin.y ? 1 : -1
  });
}

/** Register a wedge ramp entity; returns its record. */
function registerEntityRamp(object, entity) {
  object.updateMatrixWorld(true);
  const rot = entity.rot || [0, 0, 0];
  const scale = entity.scale || [1, 1, 1];
  const y = entity.pos[1];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const sx of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
    const p = new THREE.Vector3(sx, 0, sz).applyMatrix4(object.matrixWorld);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const fx = Math.sin(rot[1]), fz = Math.cos(rot[1]);
  const axis = Math.abs(fx) > Math.abs(fz) ? 'x' : 'z';
  const dir = (axis === 'x' ? fx : fz) >= 0 ? 1 : -1;
  const base = y, top = y + scale[1];
  return addDriveableRamp({ minX, maxX, minZ, maxZ, startY: dir > 0 ? base : top, endY: dir > 0 ? top : base, axis, dir });
}

/**
 * Build (and, when register=true, activate for gameplay) one entity.
 * register=false is used by Studio: visuals only.
 */
export function createEntityObject(entity, { register = true } = {}) {
  if (RETIRED_ENTITY_IDS.has(entity.id)) return { object: null, record: null };
  const [x, y, z] = entity.pos;
  const rot = entity.rot || [0, 0, 0];
  const scale = entity.scale || [1, 1, 1];
  let object = null, record = null;
  switch (entity.type) {
    case 'vehicle': {
      const v = entity.vehicle || {};
      const cfg = {
        name: entity.name,
        bodyHex: colorToHex(entity.color || v.bodyHex, 0xdc2626),
        accentHex: colorToHex(v.accentHex, 0xf8fafc),
        x, z, yaw: rot[1], isCoupe: v.isCoupe !== false, isSupercar: !!v.isSupercar
      };
      if (register) { record = buildSportsCar(cfg); object = record.root; }
      else { object = buildSportsCarMesh(cfg).root; worldRoot.add(object); object.rotation.set(rot[0], rot[1], rot[2]); }
      object.position.y = y;
      if (scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1) object.scale.set(scale[0], scale[1], scale[2]);
      if (record) { record.y = y; record.carScale = object.scale.x; }
      if (!entity.color) applyModelPreset(v.isSupercar ? 'apex_gt' : 'coupe', object);
      break;
    }
    case 'pickup': {
      const p = entity.pickup || { kind: 'left', itemId: 'cash' };
      if (register) { record = spawnWorldPickup(p.kind, p.itemId, x, y, z, { rot, scale }); object = record.group; }
      else {
        object = buildPickupMesh(p.kind, p.itemId);
        object.position.set(x, y + 0.55, z);
        object.rotation.set(rot[0], rot[1], rot[2]);
        object.scale.set(scale[0], scale[1], scale[2]);
        worldRoot.add(object);
      }
      if (p.kind === 'right') applyModelPreset(p.itemId, object);
      break;
    }
    case 'crate': {
      if (register) { record = spawnSmashCrate(x, y, z, entity.loot || null, { rot, scale }); object = record.mesh; }
      else {
        object = buildCrateMesh();
        object.position.set(x, y, z);
        object.rotation.set(rot[0], rot[1], rot[2]);
        object.scale.set(scale[0], scale[1], scale[2]);
        worldRoot.add(object);
      }
      break;
    }
    case 'barrel': {
      if (register) { record = spawnHazardBarrel(x, y, z, { rot, scale }); object = record.mesh; }
      else {
        object = buildBarrelMesh();
        object.position.set(x, y, z);
        object.rotation.set(rot[0], rot[1], rot[2]);
        object.scale.set(scale[0], scale[1], scale[2]);
        worldRoot.add(object);
      }
      break;
    }
    case 'building': {
      object = makeBuildingMesh(entity);
      object.position.set(x, y, z);
      object.rotation.set(rot[0], rot[1], rot[2]);
      object.scale.set(scale[0], scale[1], scale[2]);
      worldRoot.add(object);
      if (register) {
        object.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(object);
        record = addWorldBox(b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z, 'entity_building', true);
      }
      break;
    }
    case 'road': {
      object = makeRoadMesh(entity);
      object.position.set(x, y, z);
      object.rotation.set(rot[0], rot[1], rot[2]);
      object.scale.set(scale[0], scale[1], scale[2]);
      worldRoot.add(object);
      if (register) record = registerRoadRamp(object, entity);
      break;
    }
    case 'ramp': {
      object = makeRampMesh(entity.color);
      object.position.set(x, y, z);
      object.rotation.set(rot[0], rot[1], rot[2]);
      object.scale.set(scale[0], scale[1], scale[2]);
      worldRoot.add(object);
      if (register) record = registerEntityRamp(object, entity);
      break;
    }
    case 'block':
    case 'prop': {
      const shape = entity.type === 'block' ? 'box' : ((entity.prop && entity.prop.shape) || 'box');
      object = makePrimitiveMesh(shape, entity.color, entity.type === 'block' ? 0x94a3b8 : 0x38bdf8);
      object.position.set(x, y, z);
      object.rotation.set(rot[0], rot[1], rot[2]);
      object.scale.set(scale[0], scale[1], scale[2]);
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
  object.userData.studioName = object.userData.studioName || entity.name;
  tagEntity(object, entity.id);
  registerStudioObjectTree(object, `entity:${entity.id}`);
  entityObjects.set(entity.id, { entity, object, record });
  return { object, record };
}

export function spawnLevelEntities(data = levelData, opts = {}) {
  for (const e of data.entities) createEntityObject(e, opts);
}

/**
 * Remove an entity (or Studio static) cleanly: only its own collider/ramp/
 * vehicle/item records — never neighbouring world colliders.
 */
export function removeEntityObject(id) {
  const rec = entityObjects.get(id);
  const sRec = studioObjects.get(id);
  if (!rec && !sRec) return;
  const targetObj = (rec && rec.object) || (sRec && (sRec.object || sRec));

  if (targetObj) {
    targetObj.updateMatrixWorld(true);
    targetObj.traverse((child) => {
      const sIdx = sculptableTerrainMeshes.indexOf(child);
      if (sIdx !== -1) sculptableTerrainMeshes.splice(sIdx, 1);
    });
  }

  if (rec) {
    if (rec.record) {
      for (const arr of [worldBoxes, driveableRamps, worldPickups, smashableCrates, hazardBarrels]) {
        const i = arr.indexOf(rec.record);
        if (i !== -1) arr.splice(i, 1);
      }
    }
    if (rec.entity && rec.entity.type === 'vehicle') {
      const vi = vehicles.findIndex((v) => v.root === rec.object);
      if (vi !== -1) vehicles.splice(vi, 1);
    }
    if (targetObj) {
      const objBox = new THREE.Box3().setFromObject(targetObj);
      if (!objBox.isEmpty()) {
        const eps = 0.6;
        for (let i = worldBoxes.length - 1; i >= 0; i--) {
          const b = worldBoxes[i];
          if (!b.tag || !b.tag.startsWith('entity_')) continue;   // entity-owned only
          if (b.minX >= objBox.min.x - eps && b.maxX <= objBox.max.x + eps
            && b.minZ >= objBox.min.z - eps && b.maxZ <= objBox.max.z + eps
            && b.minY >= objBox.min.y - eps && b.maxY <= objBox.max.y + eps) worldBoxes.splice(i, 1);
        }
      }
    }
    if (rec.object && rec.object.parent) rec.object.parent.remove(rec.object);
    for (const path of [...studioObjects.keys()]) {
      if (path === `entity:${id}` || path.startsWith(`entity:${id}/`)) {
        studioObjects.delete(path);
        studioObjectBaseTransforms.delete(path);
      }
    }
    entityObjects.delete(id);
  }

  if (sRec) {
    const sObj = sRec.object || sRec;
    if (sObj && sObj.parent) {
      studioDeletedObjects.set(id, { object: sObj, parent: sObj.parent });
      sObj.parent.remove(sObj);
    }
    for (const path of [...studioObjects.keys()]) {
      if (path === id || path.startsWith(`${id}/`)) studioObjects.delete(path);
    }
  }
}

/** Re-apply an entity's transform to its live object AND its gameplay records. */
export function updateEntityTransform(entity) {
  const rec = entityObjects.get(entity.id);
  if (!rec || !rec.object) return;
  const o = rec.object;
  o.position.set(entity.pos[0], entity.pos[1] + (ENTITY_Y_OFFSET[entity.type] || 0), entity.pos[2]);
  o.rotation.set(entity.rot[0], entity.rot[1], entity.rot[2]);
  o.scale.set(entity.scale[0], entity.scale[1], entity.scale[2]);
  o.updateMatrixWorld(true);

  if (entity.type === 'vehicle') {
    rec.entity = entity;
    if ('carScale' in (rec.record || {})) rec.record.carScale = o.scale.x;
    const v = vehicles.find((c) => c.root === o);
    if (v) { v.x = entity.pos[0]; v.y = entity.pos[1]; v.z = entity.pos[2]; v.yaw = entity.rot[1]; v.carScale = o.scale.x; }
    return;
  }
  if (entity.type === 'road' || entity.type === 'ramp') {
    if (rec.record) {
      for (const arr of [driveableRamps, worldBoxes]) {
        const i = arr.indexOf(rec.record);
        if (i !== -1) arr.splice(i, 1);
      }
    }
    rec.record = entity.type === 'road' ? registerRoadRamp(o, entity) : registerEntityRamp(o, entity);
    rec.entity = entity;
    return;
  }
  if (rec.record && 'minX' in rec.record && 'maxY' in rec.record) {
    const bb = new THREE.Box3().setFromObject(o);
    rec.record.minX = bb.min.x; rec.record.maxX = bb.max.x;
    rec.record.minY = bb.min.y; rec.record.maxY = bb.max.y;
    rec.record.minZ = bb.min.z; rec.record.maxZ = bb.max.z;
  }
  rec.entity = entity;
}

/** Show every proximity-LOD interior (Studio wants to see everything at once). */
export function revealAllLods() {
  buildingLods.forEach((e) => { e.group.visible = true; e.active = true; });
  (aura.culls || []).forEach((c) => { c.g.visible = true; });
}

// ============================================================================
// LOS AURA NORTHERN EXPANSION
// (The ocean bridge and northern freeway are built by buildInterstate88.)
// ============================================================================
export function buildLosAuraNorthExpansion(register = true) {
  const grp = new THREE.Group();
  grp.userData.studioName = 'Los Aura Northern Expansion';
  worldRoot.add(grp);
  camera.far = Math.max(camera.far, 1150);
  camera.updateProjectionMatrix();

  const oceanMat = makeMat(0x0ea5e9, { texType: 'water', repeatX: 28, repeatY: 16, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.88 });
  const grassMat = makeMat(0x5a9a4e, { texType: 'grass', repeatX: 72, repeatY: 60, roughness: 0.94 });
  const sandMat = makeMat(0xf2d9a0, { texType: 'sand', repeatX: 48, repeatY: 12, roughness: 0.96 });
  const asphaltNS = makeMat(0x313946, { texType: 'asphalt', repeatX: 2, repeatY: 48, roughness: 0.86, bumpScale: 0.015 });
  const asphaltEW = makeMat(0x313946, { texType: 'asphalt', repeatX: 48, repeatY: 2, roughness: 0.86, bumpScale: 0.015 });
  const runwayMat = makeMat(0x1e293b, { texType: 'asphalt', repeatX: 6, repeatY: 40, roughness: 0.85 });
  const tarmacMat = makeMat(0x64748b, { texType: 'concrete', repeatX: 24, repeatY: 24, roughness: 0.88 });
  const concreteMat = makeMat(0xd1d5db, { texType: 'concrete', repeatX: 18, repeatY: 2, roughness: 0.88 });
  const sidewalkMat = makeMat(0xcbd5e1, { texType: 'sidewalk', repeatX: 12, repeatY: 12, roughness: 0.85 });
  const plazaMat = makeMat(0x94a3b8, { texType: 'cobblestone', repeatX: 14, repeatY: 14, roughness: 0.82 });
  const woodDeckMat = makeMat(0x926c44, { texType: 'wood', repeatX: 40, repeatY: 4, roughness: 0.82 });
  const steelMat = makeMat(0xe2e8f0, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.18, flatShading: false });
  const bridgeRedMat = makeMat(0xdc2626, { metalness: 0.65, roughness: 0.32 });
  const whiteMat = makeMat(0xf8fafc, { roughness: 0.55 });
  const redCurbMat = makeMat(0xef4444, { roughness: 0.6 });

  const addBoxMesh = (w, h, d, mat, x, y, z, cast = true, receive = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = receive;
    grp.add(m);
    return m;
  };
  /** Flat paved area with a standable surface so vehicles sit on it properly. */
  const paved = (w, d, mat, x, y, z, tag) => {
    addBoxMesh(w, 0.08, d, mat, x, y - 0.04, z, false);
    addWorldBox(x - w / 2, x + w / 2, y - 0.08, y, z - d / 2, z + d / 2, tag, true);
  };

  // 1. Ocean strait & northern landmass
  const straitWater = new THREE.Mesh(new THREE.PlaneGeometry(760, 60), oceanMat);
  straitWater.rotation.x = -Math.PI / 2;
  straitWater.position.set(120, 0.20, 350);
  straitWater.receiveShadow = true;
  grp.add(straitWater);
  waterZones.push({ minX: -260, maxX: 500, minZ: 320, maxZ: 380 });
  mapShapes.push({ x: 120, z: 299, w: 760, d: 162, color: '#0284c7', border: '#38bdf8', enterable: false });

  const surfFoam = new THREE.Mesh(new THREE.PlaneGeometry(740, 2.2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.58 }));
  surfFoam.rotation.x = -Math.PI / 2;
  surfFoam.position.set(120, 0.215, 380.3);
  grp.add(surfFoam);

  const northLandGeo = new THREE.PlaneGeometry(740, 550, 185, 138);
  northLandGeo.rotateX(-Math.PI / 2);
  const northLand = new THREE.Mesh(northLandGeo, grassMat);
  northLand.position.set(120, 0.18, 655);
  northLand.receiveShadow = true;
  registerSculptableTerrain(northLand);
  grp.add(northLand);
  mapShapes.unshift({ x: 120, z: 655, w: 740, d: 550, color: '#4d7c0f', border: '#365314', enterable: false });

  // 2. Santa Aura beach & boardwalk
  paved(366, 28, sandMat, -47, 0.24, 394, 'beach_sand');
  mapShapes.push({ x: -47, z: 394, w: 366, d: 28, color: '#fcd34d', border: '#f59e0b', enterable: false });
  addBoxMesh(354, 0.22, 14, woodDeckMat, -43, 0.29, 413, false);
  addWorldBox(-220, 134, 0.18, 0.40, 406, 420, 'boardwalk_deck', true);
  mapShapes.push({ x: -43, z: 413, w: 354, d: 14, color: '#b45309', border: '#fef08a', enterable: false });
  paved(362, 12, asphaltEW, -39, 0.24, 428, 'boardwalk_ave');
  mapShapes.push({ x: -39, z: 428, w: 362, d: 12, color: '#334155', border: '#facc15', enterable: false });

  addBoxMesh(12, 0.26, 82, woodDeckMat, -42, 0.42, 365);
  addWorldBox(-48, -36, 0.18, 0.55, 324, 406, 'santa_aura_pier', true);
  mapShapes.push({ x: -42, z: 365, w: 12, d: 82, color: '#92400e', border: '#f59e0b', enterable: false });
  for (let pz = 328; pz <= 402; pz += 10) {
    [-5.2, 5.2].forEach((ox) => {
      const piling = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 1.8, 8), makeMat(0x57534e));
      piling.position.set(-42 + ox, -0.3, pz);
      grp.add(piling);
    });
  }
  addBoxMesh(0.45, 5.2, 0.45, bridgeRedMat, -47.2, 3.0, 405.5);
  addBoxMesh(0.45, 5.2, 0.45, bridgeRedMat, -36.8, 3.0, 405.5);
  createNeonSign(grp, 'SANTA AURA PIER & BOARDWALK', -42, 5.4, 405.5, '#1e1b4b', '#38bdf8', 11.2, 1.35);

  const wheelGroup = new THREE.Group();
  wheelGroup.position.set(-42, 14.5, 352);
  wheelGroup.userData.studioName = 'Santa Aura Ferris wheel';
  const wheelRadius = 11.5;
  const wheelRim1 = new THREE.Mesh(new THREE.TorusGeometry(wheelRadius, 0.22, 10, 32), new THREE.MeshBasicMaterial({ color: 0xf43f5e }));
  wheelRim1.position.z = -1.2;
  const wheelRim2 = wheelRim1.clone();
  wheelRim2.position.z = 1.2;
  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(wheelRadius * 0.62, 0.14, 8, 24), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
  wheelGroup.add(wheelRim1, wheelRim2, innerRing);
  const gondolaMat = makeMat(0xfacc15, { metalness: 0.4, roughness: 0.4 });
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, wheelRadius * 2, 6), steelMat);
    spoke.rotation.z = ang + Math.PI / 2;
    wheelGroup.add(spoke);
    const pod = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.3, 2.0), gondolaMat);
    pod.position.set(Math.cos(ang) * wheelRadius, Math.sin(ang) * wheelRadius, 0);
    wheelGroup.add(pod);
  }
  [-2.2, 2.2].forEach((lz) => {
    [-1, 1].forEach((dir) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 15.5, 8), steelMat);
      leg.position.set(dir * 3.8, -7.2, lz);
      leg.rotation.z = dir * 0.46;
      wheelGroup.add(leg);
    });
  });
  grp.add(wheelGroup);

  buildHotdogStore(-18, 439);
  buildWalkInHouse({ x: -72, z: 439, w: 11.5, d: 9.0, wallColor: 0x38bdf8, roofColor: 0xf43f5e, label: 'SANTA AURA ARCADE' });
  buildWalkInHouse({ x: 38, z: 439, w: 11.5, d: 9.0, wallColor: 0xfef08a, roofColor: 0x0284c7, label: 'PACIFIC SURF & GEAR' });
  [[-165, 392, 0xef4444], [-125, 390, 0x3b82f6], [-85, 393, 0xfacc15], [15, 391, 0x22c55e], [65, 392, 0xec4899], [105, 390, 0xf97316]].forEach(([ux, uz, col]) => {
    addBoxMesh(0.08, 2.4, 0.08, whiteMat, ux, 1.35, uz, false);
    const umbrella = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.6, 8), makeMat(col));
    umbrella.position.set(ux, 2.65, uz);
    grp.add(umbrella);
  });
  for (let px = -205; px <= 125; px += 30) if (Math.abs(px + 42) > 12) createTree(px, 421.5, 1.05);

  // 3. Downtown Los Aura
  const dtNsRoads = [-108, -60, -12, 36, 84, 124];
  const dtEwRoads = [468, 516, 564, 612, 660];
  dtNsRoads.forEach((rx) => {
    paved(12, 204, asphaltNS, rx, 0.24, 564, 'dt_road');
    mapShapes.push({ x: rx, z: 564, w: 12, d: 204, color: '#334155', border: '#475569', enterable: false });
  });
  dtEwRoads.forEach((rz) => {
    paved(244, 12, asphaltEW, 8, 0.24, rz, 'dt_road');
    mapShapes.push({ x: 8, z: rz, w: 244, d: 12, color: '#334155', border: '#475569', enterable: false });
  });
  [468, 564, 660].forEach((cz) => paved(22, 12, asphaltEW, 135, 0.24, cz, 'dt_connector'));

  const dtBlockX = [-84, -36, 12, 60, 104];
  const dtBlockZ = [492, 540, 588, 636];
  dtBlockX.forEach((bx) => {
    const bw = bx === 104 ? 28 : 36;
    dtBlockZ.forEach((bz) => {
      addBoxMesh(bw, 0.12, 36, sidewalkMat, bx, 0.24, bz, false);
      addBoxMesh(bw - 4, 0.14, 32, plazaMat, bx, 0.25, bz, false);
      buildKnockableLamppost(bx - bw / 2 + 1.2, bz - 16.8);
      buildKnockableLamppost(bx + bw / 2 - 1.2, bz + 16.8);
    });
  });

  // US Aura Tower — crown rebuilt as open rings so the helipad stays usable
  buildSkyscraper({ x: -36, z: 540, w: 18.0, d: 18.0, h: 86, glassHex: 0x38bdf8, frameHex: 0xe2e8f0, name: 'US AURA TOWER', hasHelipad: true });
  const crownRing1 = new THREE.Mesh(new THREE.TorusGeometry(7.7, 1.1, 10, 24), makeMat(0xbae6fd, { metalness: 0.9, roughness: 0.12, emissive: 0x0284c7, emissiveIntensity: 0.25 }));
  crownRing1.rotation.x = Math.PI / 2;
  crownRing1.position.set(-36, 88.6, 540);
  const crownRing2 = new THREE.Mesh(new THREE.TorusGeometry(5.7, 0.9, 10, 24), makeMat(0xf8fafc, { metalness: 0.85, roughness: 0.2 }));
  crownRing2.rotation.x = Math.PI / 2;
  crownRing2.position.set(-36, 92.4, 540);
  const usGlowBand = new THREE.Mesh(new THREE.TorusGeometry(6.3, 0.25, 8, 24), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
  usGlowBand.rotation.x = Math.PI / 2;
  usGlowBand.position.set(-36, 90.5, 540);
  grp.add(crownRing1, crownRing2, usGlowBand);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => addBoxMesh(0.6, 3.4, 0.6, steelMat, -36 + sx * 7.4, 88.2, 540 + sz * 7.4));

  buildSkyscraper({ x: 12, z: 540, w: 16.5, d: 15.0, h: 80, glassHex: 0x0284c7, frameHex: 0x0f172a, name: 'WILSHIRE GRAND', hasHelipad: false });
  const sailMesh = new THREE.Mesh(new THREE.BoxGeometry(15.5, 11.0, 1.4), makeMat(0x7dd3fc, { metalness: 0.95, roughness: 0.08, emissive: 0x38bdf8, emissiveIntensity: 0.35 }));
  sailMesh.position.set(12, 88.0, 540);   // raised clear of the walkable roof
  sailMesh.rotation.z = 0.24;
  const wilshireSpire = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.42, 18.0, 8), steelMat);
  wilshireSpire.position.set(17.5, 93.0, 540);
  grp.add(sailMesh, wilshireSpire);

  buildSkyscraper({ x: -84, z: 540, w: 15.5, d: 15.5, h: 72, glassHex: 0x1e3a8a, frameHex: 0xf8fafc, name: 'AON AURA CENTER', hasHelipad: true });
  buildSkyscraper({ x: 60, z: 540, w: 16.0, d: 16.0, h: 68, glassHex: 0x0f766e, frameHex: 0x1e293b, name: 'SOCAL GAS TOWER', hasHelipad: false });
  addBoxMesh(14.5, 5.5, 12.0, makeMat(0x0284c7, { emissive: 0x0369a1, emissiveIntensity: 0.3 }), 60, 71.0, 540);

  buildSkyscraper({ x: -36, z: 636, w: 18.0, d: 18.0, h: 52, glassHex: 0xe2e8f0, frameHex: 0xf8fafc, name: 'LOS AURA CITY HALL', hasHelipad: false });
  addBoxMesh(12.5, 8.0, 12.5, whiteMat, -36, 56.2, 636);
  addBoxMesh(8.0, 6.0, 8.0, whiteMat, -36, 63.2, 636);
  const cityHallPyramid = new THREE.Mesh(new THREE.ConeGeometry(5.8, 5.5, 4), makeMat(0xfef08a, { emissive: 0xfacc15, emissiveIntensity: 0.35 }));
  cityHallPyramid.rotation.y = Math.PI / 4;
  cityHallPyramid.position.set(-36, 68.9, 636);
  grp.add(cityHallPyramid);

  const hallGroup = new THREE.Group();
  hallGroup.position.set(-84, 0.30, 588);
  hallGroup.userData.studioName = 'WALT AURA CONCERT HALL';
  const hallBase = new THREE.Mesh(new THREE.BoxGeometry(24, 6.5, 22), makeMat(0xf8fafc, { texType: 'marble' }));
  hallBase.position.y = 3.25;
  hallBase.castShadow = true;
  hallGroup.add(hallBase);
  [
    { w: 14, h: 15, d: 0.55, x: -3.5, y: 10.5, z: 4.5, rx: 0.32, ry: 0.25, rz: -0.28 },
    { w: 15, h: 17, d: 0.55, x: 3.8, y: 11.5, z: 2.0, rx: -0.25, ry: -0.35, rz: 0.30 },
    { w: 13, h: 14, d: 0.55, x: 0.0, y: 10.0, z: -4.8, rx: -0.35, ry: 0.15, rz: -0.20 },
    { w: 11, h: 12, d: 0.55, x: -6.5, y: 8.8, z: -2.5, rx: 0.20, ry: 0.45, rz: 0.34 }
  ].forEach((s) => {
    const sail = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), steelMat);
    sail.position.set(s.x, s.y, s.z);
    sail.rotation.set(s.rx, s.ry, s.rz);
    sail.castShadow = true;
    hallGroup.add(sail);
  });
  createNeonSign(hallGroup, 'WALT AURA CONCERT HALL', 0, 5.2, 11.2, '#0f172a', '#38bdf8', 11.5, 1.15);
  grp.add(hallGroup);
  addWorldBox(-96, -72, 0.30, 7.0, 577, 599, 'concert_hall', false);
  mapShapes.push({ x: -84, z: 588, w: 24, d: 22, color: '#e2e8f0', border: '#38bdf8', enterable: false });

  const arenaGroup = new THREE.Group();
  arenaGroup.position.set(60, 0.30, 492);
  arenaGroup.userData.studioName = 'AURA ARENA';
  const arenaBowl = new THREE.Mesh(new THREE.CylinderGeometry(14.5, 13.0, 14.0, 24), makeMat(0x1e293b, { metalness: 0.75, roughness: 0.25 }));
  arenaBowl.position.y = 7.0;
  arenaBowl.castShadow = true;
  const arenaRoof = new THREE.Mesh(new THREE.CylinderGeometry(11.5, 14.8, 3.2, 24), makeMat(0x38bdf8, { metalness: 0.85, roughness: 0.18, emissive: 0x0284c7, emissiveIntensity: 0.22 }));
  arenaRoof.position.y = 15.6;
  const ledRibbon = new THREE.Mesh(new THREE.CylinderGeometry(14.65, 14.65, 1.8, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xa855f7, side: THREE.DoubleSide }));
  ledRibbon.position.y = 10.5;
  arenaGroup.add(arenaBowl, arenaRoof, ledRibbon);
  createNeonSign(arenaGroup, 'AURA ARENA • LOS AURA LIVE', 0, 4.5, 14.8, '#1e1b4b', '#facc15', 13.5, 1.35);
  grp.add(arenaGroup);
  addWorldBox(46, 74, 0.30, 17.2, 478, 506, 'aura_arena', false);
  mapShapes.push({ x: 60, z: 492, w: 28, d: 28, color: '#4f46e5', border: '#facc15', enterable: false });

  buildReserveBank(12, 492);
  buildCarDealership(-36, 492);
  buildHotdogStore(-12, 588);
  buildSkyscraper({ x: 12, z: 636, w: 15.0, d: 15.0, h: 62, glassHex: 0x2563eb, frameHex: 0x0f172a, name: 'FIGUEROA AT WILSHIRE', hasHelipad: true });
  buildSkyscraper({ x: 60, z: 588, w: 14.5, d: 14.5, h: 58, glassHex: 0x0d9488, frameHex: 0x1e293b, name: 'BUNKER HILL PLAZA', hasHelipad: false });
  buildSkyscraper({ x: 60, z: 636, w: 14.5, d: 14.5, h: 54, glassHex: 0x0369a1, frameHex: 0x0f172a, name: 'BROADWAY TRADE CENTER', hasHelipad: true });
  buildSkyscraper({ x: 104, z: 540, w: 13.5, d: 14.5, h: 50, glassHex: 0x4f46e5, frameHex: 0x1e293b, name: 'ARTS DISTRICT TOWER', hasHelipad: false });
  buildSkyscraper({ x: 104, z: 588, w: 13.5, d: 14.5, h: 46, glassHex: 0x0284c7, frameHex: 0x1e293b, name: 'LITTLE TOKYO PLAZA', hasHelipad: true });

  // 4. Los Aura International Airport
  paved(288, 260, tarmacMat, 324, 0.25, 565, 'lax_tarmac');
  mapShapes.push({ x: 324, z: 565, w: 288, d: 260, color: '#475569', border: '#94a3b8', enterable: false });
  paved(74, 14, asphaltEW, 199, 0.26, 564, 'lax_access');
  createNeonSign(grp, 'LAX • LOS AURA INTL AIRPORT', 186, 6.2, 555.5, '#0f172a', '#38bdf8', 13.0, 1.5);

  const themeGroup = new THREE.Group();
  themeGroup.position.set(216, 0.24, 564);
  themeGroup.userData.studioName = 'LAX Theme Building';
  const coreShaft = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 15.0, 14), whiteMat);
  coreShaft.position.y = 7.5;
  const observationSaucer = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 6.8, 2.6, 20), makeMat(0x38bdf8, { metalness: 0.85, roughness: 0.15, emissive: 0x0284c7, emissiveIntensity: 0.3 }));
  observationSaucer.position.y = 10.2;
  const saucerRoof = new THREE.Mesh(new THREE.ConeGeometry(8.8, 2.2, 20), whiteMat);
  saucerRoof.position.y = 12.6;
  themeGroup.add(coreShaft, observationSaucer, saucerRoof);
  [0, Math.PI / 2].forEach((rotY) => {
    const archPts = [];
    for (let t = -1; t <= 1.001; t += 0.1) archPts.push(new THREE.Vector3(t * 16.5, (1 - t * t) * 18.5, 0));
    const archMesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(archPts), 28, 0.55, 8, false), whiteMat);
    archMesh.rotation.y = rotY;
    archMesh.castShadow = true;
    themeGroup.add(archMesh);
  });
  grp.add(themeGroup);
  addWorldBox(212.5, 219.5, 0.24, 15.2, 560.5, 567.5, 'lax_theme_bldg', false);

    // Walk-in terminal concourse (open ends, real interior)
  const termX = 248, termZ = 565, termW = 18, termD = 186, termH = 8.5, termY = 0.25;
  const termDoorW = 6, termDoorH = 4.2;
  const glassFacadeMat = makeMat(0x0ea5e9, { metalness: 0.9, roughness: 0.12, emissive: 0x0284c7, emissiveIntensity: 0.18 });

  const termFloor = addBoxMesh(
    termW - 0.4, 0.1, termD - 0.4,
    makeMat(0xf8fafc, { texType: 'marble', repeatX: 4, repeatY: 40, roughness: 0.2 }),
    termX, termY + 0.05, termZ, false
  );
  termFloor.userData.studioName = 'Terminal floor';

  // Side walls run the full length; glass curtain band sits proud of them.
  for (const sd of [-1, 1]) {
    const wx = termX + sd * termW / 2;
    addBoxMesh(0.5, termH, termD, whiteMat, wx, termY + termH / 2, termZ);
    addBoxMesh(0.3, 4.2, termD - 6, glassFacadeMat, termX + sd * (termW / 2 + 0.15), termY + termH * 0.55, termZ, false);
    addWorldBox(wx - 0.25, wx + 0.25, termY, termY + termH, termZ - termD / 2, termZ + termD / 2, 'terminal_wall', false);
  }

  // End walls: two flanking segments + a header over a 6 m x 4.2 m doorway.
  const termSegW = (termW - termDoorW) / 2;
  for (const ez of [-1, 1]) {
    const wz = termZ + ez * termD / 2;
    for (const sx of [-1, 1]) {
      const cx = termX + sx * (termDoorW / 2 + termSegW / 2);
      addBoxMesh(termSegW, termH, 0.5, whiteMat, cx, termY + termH / 2, wz);
      addWorldBox(cx - termSegW / 2, cx + termSegW / 2, termY, termY + termH, wz - 0.25, wz + 0.25, 'terminal_wall', false);
    }
    addBoxMesh(termDoorW, termH - termDoorH, 0.5, whiteMat, termX, termY + termDoorH + (termH - termDoorH) / 2, wz);
  }

  addBoxMesh(termW + 1.4, 0.6, termD + 2, makeMat(0x1e293b), termX, termY + termH + 0.3, termZ);
  addWorldBox(termX - termW / 2, termX + termW / 2, termY + termH, termY + termH + 0.6, termZ - termD / 2, termZ + termD / 2, 'terminal_roof', true);

  // Interior check-in counters
  for (let cz = termZ - 70; cz <= termZ + 70; cz += 28) {
    addBoxMesh(6, 1.1, 2, makeMat(0x334155), termX, termY + 0.6, cz, false);
    addWorldBox(termX - 3, termX + 3, termY, termY + 1.2, cz - 1, cz + 1, 'checkin_counter', true);
  }

  createNeonSign(grp, 'LOS AURA INTL • TERMINALS 1 - 4', termX - termW / 2 - 0.4, 6.8, termZ, '#090d14', '#facc15', 16.0, 1.45);
  enterableZones.push({ minX: termX - termW / 2 + 1, maxX: termX + termW / 2 - 1, minZ: termZ - termD / 2 + 1, maxZ: termZ + termD / 2 - 1, name: 'LOS AURA INTL TERMINAL' });
  mapShapes.push({ x: termX, z: termZ, w: termW, d: termD, color: '#f8fafc', border: '#0284c7', enterable: true });
  addBoxMesh(5.2, 34.0, 5.2, whiteMat, 272, 17.24, 565);
  const atcCab = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 3.8, 4.6, 12), makeMat(0x10b981, { metalness: 0.85, roughness: 0.15, emissive: 0x059669, emissiveIntensity: 0.28 }));
  atcCab.position.set(272, 36.2, 565);
  const atcRoof = new THREE.Mesh(new THREE.CylinderGeometry(5.8, 5.8, 0.7, 12), whiteMat);
  atcRoof.position.set(272, 38.8, 565);
  const atcBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
  atcBeacon.position.set(272, 41.2, 565);
  aviationBeacons.push(atcBeacon);
  grp.add(atcCab, atcRoof, atcBeacon);
  addWorldBox(269.4, 274.6, 0.24, 39.2, 562.4, 567.6, 'atc_tower', false);

  // Dual runways with instanced markings
  const runwayXs = [336, 394];
  const rwEdgePositions = [], stripeTransforms = [];
  const sdm = new THREE.Object3D();
  runwayXs.forEach((rx) => {
    paved(22, 240, runwayMat, rx, 0.29, 565, 'runway');
    mapShapes.push({ x: rx, z: 565, w: 22, d: 240, color: '#0f172a', border: '#f8fafc', enterable: false });
    [452, 678].forEach((tz) => {
      for (let sx = -8; sx <= 8; sx += 3.2) {
        sdm.position.set(rx + sx, 0.295, tz);
        sdm.rotation.set(0, 0, 0);
        sdm.scale.set(1.4, 0.09, 7.5);
        sdm.updateMatrix();
        stripeTransforms.push(sdm.matrix.clone());
      }
    });
    for (let z = 466; z <= 664; z += 12) {
      sdm.position.set(rx, 0.295, z);
      sdm.rotation.set(0, 0, 0);
      sdm.scale.set(0.45, 0.09, 5.5);
      sdm.updateMatrix();
      stripeTransforms.push(sdm.matrix.clone());
      rwEdgePositions.push([rx - 10.6, 0.46, z], [rx + 10.6, 0.46, z]);
    }
  });
  {
    const stripes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), whiteMat, stripeTransforms.length);
    stripeTransforms.forEach((m, i) => stripes.setMatrixAt(i, m));
    stripes.instanceMatrix.needsUpdate = true;
    grp.add(stripes);
    const rwLights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }), rwEdgePositions.length);
    const dm = new THREE.Object3D();
    rwEdgePositions.forEach(([x, y, z], i) => { dm.position.set(x, y, z); dm.updateMatrix(); rwLights.setMatrixAt(i, dm.matrix); });
    rwLights.instanceMatrix.needsUpdate = true;
    grp.add(rwLights);
  }

  // Parked jets — yaw-aware colliders (fuselage solid, wings overhead)
  const spawnParkedJet = (jx, jz, yaw, stripeHex) => {
    const jet = new THREE.Group();
    jet.position.set(jx, 0.29, jz);
    jet.rotation.y = yaw;
    jet.userData.studioName = 'Parked jetliner';
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 24, 14), whiteMat);
    body.rotation.x = Math.PI / 2;
    body.position.y = 3.2;
    body.castShadow = true;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(2.1, 4.8, 14), whiteMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 3.2, 14.4);
    const wingL = new THREE.Mesh(new THREE.BoxGeometry(14.5, 0.35, 4.2), steelMat);
    wingL.position.set(-7.5, 2.8, 1.0);
    wingL.rotation.y = 0.26;
    const wingR = wingL.clone();
    wingR.position.x = 7.5;
    wingR.rotation.y = -0.26;
    const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.45, 5.8, 3.8), makeMat(stripeHex));
    tailFin.position.set(0, 6.2, -10.2);
    tailFin.rotation.x = -0.25;
    const hStab = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.25, 2.2), steelMat);
    hStab.position.set(0, 3.4, -10.8);
    [-5.5, 5.5].forEach((ex) => {
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.78, 3.4, 12), makeMat(0x334155, { metalness: 0.85 }));
      eng.rotation.x = Math.PI / 2;
      eng.position.set(ex, 1.9, 2.2);
      jet.add(eng);
    });
    jet.add(body, nose, wingL, wingR, tailFin, hStab);
    grp.add(jet);
    const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
    const fHX = 2.3 * c + 14.5 * s, fHZ = 2.3 * s + 14.5 * c;
    addWorldBox(jx - fHX, jx + fHX, 0.29, 5.5, jz - fHZ, jz + fHZ, 'parked_jet', false);
    const wHX = 14.5 * c + 2.5 * s, wHZ = 14.5 * s + 2.5 * c;
    addWorldBox(jx - wHX, jx + wHX, 2.5, 3.3, jz - wHZ, jz + wHZ, 'jet_wing', false);
  };
  spawnParkedJet(282, 502, -Math.PI / 2, 0xdc2626);
  spawnParkedJet(282, 622, -Math.PI / 2, 0x0284c7);

  // Drive-through hangars
  [500, 630].forEach((hz) => {
    const hw = 26, hd = 28, hh = 11;
    addBoxMesh(hw, hh, 0.6, steelMat, 442, 0.29 + hh / 2, hz - hd / 2);
    addBoxMesh(hw, hh, 0.6, steelMat, 442, 0.29 + hh / 2, hz + hd / 2);
    addBoxMesh(0.6, hh, hd, steelMat, 442 + hw / 2, 0.29 + hh / 2, hz);
    addBoxMesh(hw + 0.8, 0.6, hd + 0.8, makeMat(0x334155), 442, 0.29 + hh + 0.3, hz);
    addWorldBox(442 - hw / 2, 442 + hw / 2, 0.29, 0.29 + hh, hz - hd / 2, hz - hd / 2 + 0.6, 'hangar_wall', false);
    addWorldBox(442 - hw / 2, 442 + hw / 2, 0.29, 0.29 + hh, hz + hd / 2 - 0.6, hz + hd / 2, 'hangar_wall', false);
    addWorldBox(442 + hw / 2 - 0.6, 442 + hw / 2, 0.29, 0.29 + hh, hz - hd / 2, hz + hd / 2, 'hangar_wall', false);
    addWorldBox(442 - hw / 2, 442 + hw / 2, 0.29 + hh, 0.29 + hh + 0.6, hz - hd / 2, hz + hd / 2, 'hangar_roof', true);
    enterableZones.push({ minX: 442 - hw / 2 + 1, maxX: 442 + hw / 2 - 1, minZ: hz - hd / 2 + 1, maxZ: hz + hd / 2 - 1, name: 'LAX AIRCRAFT HANGAR' });
    mapShapes.push({ x: 442, z: hz, w: hw, d: hd, color: '#94a3b8', border: '#1e293b', enterable: true });
  });

  // 5. Los Aura Motor Speedway
  paved(102, 16, asphaltEW, 91, 0.26, 738, 'speedway_access');
  paved(14, 66, asphaltNS, -12, 0.26, 699, 'speedway_access');
  const trackCenterZ = 807, trackRadius = 69, trackW = 18, straightLen = 180, straightMidX = -50;
  paved(straightLen, trackW, runwayMat, straightMidX, 0.27, 738, 'track_surface');
  paved(straightLen, trackW, runwayMat, straightMidX, 0.27, 876, 'track_surface');
  mapShapes.push({ x: straightMidX, z: 738, w: straightLen, d: trackW, color: '#1e293b', border: '#ef4444', enterable: false });
  mapShapes.push({ x: straightMidX, z: 876, w: straightLen, d: trackW, color: '#1e293b', border: '#ef4444', enterable: false });
  addBoxMesh(straightLen, 1.1, 0.7, concreteMat, straightMidX, 0.82, 728.6);
  addWorldBox(-140, 40, 0.26, 1.39, 728.2, 729.0, 'track_wall_s', true);
  addBoxMesh(straightLen, 1.1, 0.7, concreteMat, straightMidX, 0.82, 885.4);
  addWorldBox(-140, 40, 0.26, 1.39, 885.0, 885.8, 'track_wall_n', true);

  const turnSteps = 32;
  [
    { cx: 40, startAng: -Math.PI / 2, endAng: Math.PI / 2 },
    { cx: -140, startAng: Math.PI / 2, endAng: (3 * Math.PI) / 2 }
  ].forEach(({ cx, startAng, endAng }) => {
    for (let i = 0; i < turnSteps; i++) {
      const a0 = startAng + (i / turnSteps) * (endAng - startAng);
      const a1 = startAng + ((i + 1) / turnSteps) * (endAng - startAng);
      const aMid = (a0 + a1) / 2;
      const segLen = Math.abs(a1 - a0) * (trackRadius + trackW / 2) + 1.2;
      const tx = cx + Math.cos(aMid) * trackRadius;
      const tz = trackCenterZ + Math.sin(aMid) * trackRadius;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(trackW, 0.08, segLen), runwayMat);
      seg.position.set(tx, 0.23, tz);
      seg.rotation.y = -aMid;
      seg.receiveShadow = true;
      grp.add(seg);
      const innerR = trackRadius - trackW / 2 + 0.6;
      const curb = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.11, segLen * 0.95), i % 2 === 0 ? redCurbMat : whiteMat);
      curb.position.set(cx + Math.cos(aMid) * innerR, 0.28, trackCenterZ + Math.sin(aMid) * innerR);
      curb.rotation.y = -aMid;
      grp.add(curb);
      const outerR = trackRadius + trackW / 2 + 0.4;
      const wx = cx + Math.cos(aMid) * outerR, wz = trackCenterZ + Math.sin(aMid) * outerR;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, segLen), i % 2 === 0 ? redCurbMat : whiteMat);
      wall.position.set(wx, 0.82, wz);
      wall.rotation.y = -aMid;
      grp.add(wall);
      addWorldBox(wx - 1.2, wx + 1.2, 0.26, 1.39, wz - 1.2, wz + 1.2, 'track_turn_wall', true);
    }
    mapShapes.push({ x: cx, z: trackCenterZ, w: 78, d: 156, color: '#1e293b', border: '#ef4444', enterable: false });
  });

  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.10, 2.2), (row + col) % 2 === 0 ? whiteMat : makeMat(0x090d14));
      sq.position.set(-51.1 + row * 1.1, 0.28, 730.2 + col * 2.2);
      grp.add(sq);
    }
  }
  // Gantry posts clear of the racing surface
  addBoxMesh(0.5, 7.6, 0.5, steelMat, -50, 4.0, 727.6);
  addBoxMesh(0.5, 7.6, 0.5, steelMat, -50, 4.0, 748.6);
  addBoxMesh(0.5, 0.5, 21.5, steelMat, -50, 7.6, 738);
  createNeonSign(grp, 'LOS AURA MOTOR SPEEDWAY', -50, 6.8, 738, '#090d14', '#ef4444', 14.5, 1.45);

  // Pit lane with open garage bays
  paved(120, 8, asphaltEW, -50, 0.26, 752, 'pit_lane');
  addBoxMesh(120, 0.75, 0.5, concreteMat, -50, 0.64, 747.6);
  addWorldBox(-110, 10, 0.26, 1.02, 747.3, 747.9, 'pit_wall', true);
  const garageMat = makeMat(0x334155, { texType: 'corrugated', metalness: 0.7 });
  addBoxMesh(96, 0.5, 10, garageMat, -50, 5.0, 761);
  addWorldBox(-98, -2, 4.75, 5.25, 756, 766, 'pit_garage_roof', true);
  addBoxMesh(96, 4.8, 0.5, garageMat, -50, 2.68, 765.75);
  addWorldBox(-98, -2, 0.26, 5.06, 765.5, 766, 'pit_garage_back', false);
  for (let gx = -98; gx <= -2; gx += 16) {
    addBoxMesh(0.5, 4.8, 10, garageMat, gx, 2.68, 761);
    addWorldBox(gx - 0.25, gx + 0.25, 0.26, 5.06, 756, 766, 'pit_garage_wall', false);
  }
  createNeonSign(grp, 'PIT LANE & TEAM GARAGES', -50, 4.4, 755.8, '#1e293b', '#facc15', 14.0, 1.1);
  enterableZones.push({ minX: -98, maxX: -2, minZ: 756, maxZ: 766, name: 'SPEEDWAY PIT GARAGES' });

  for (let tier = 0; tier < 5; tier++) {
    const ty = 0.6 + tier * 1.1, tz = 723 - tier * 1.8;
    addBoxMesh(130, 1.0, 1.8, tier % 2 === 0 ? steelMat : makeMat(0x2563eb), -50, ty, tz);
    addWorldBox(-115, 15, 0.26, ty + 0.5, tz - 0.9, tz + 0.9, 'grandstand_tier', true);
  }
  addBoxMesh(132, 0.4, 11, makeMat(0x0f172a), -50, 7.6, 719);
  mapShapes.push({ x: -50, z: 719, w: 132, d: 11, color: '#2563eb', border: '#f8fafc', enterable: false });

  // Infield stunt ramps — geometry rises along the same axis as the collider
  const stuntAngle = Math.atan2(3.0, 18);
  const stuntRampW = new THREE.Mesh(new THREE.BoxGeometry(18, 0.35, 10), makeMat(0xf59e0b));
  stuntRampW.position.set(-20, 1.75, 812);
  stuntRampW.rotation.z = stuntAngle;
  stuntRampW.castShadow = true;
  grp.add(stuntRampW);
  addDriveableRamp({ minX: -29, maxX: -11, minZ: 807, maxZ: 817, startY: 0.26, endY: 3.24, axis: 'x', dir: 1 });
  const stuntRampE = new THREE.Mesh(new THREE.BoxGeometry(18, 0.35, 10), makeMat(0xf59e0b));
  stuntRampE.position.set(8, 1.75, 812);
  stuntRampE.rotation.z = -stuntAngle;
  stuntRampE.castShadow = true;
  grp.add(stuntRampE);
  addDriveableRamp({ minX: -1, maxX: 17, minZ: 807, maxZ: 817, startY: 3.24, endY: 0.26, axis: 'x', dir: 1 });
  buildCarDealership(-85, 812);

  if (register) {
    placeCar(buildSportsCar({ name: 'LOS AURA GT-R #1', bodyHex: 0xdc2626, accentHex: 0xfacc15, x: -58, z: 734.5, yaw: Math.PI / 2, isCoupe: true, isSupercar: true }), 0.27);
    placeCar(buildSportsCar({ name: 'PACIFIC APEX #7', bodyHex: 0x0284c7, accentHex: 0xf8fafc, x: -66, z: 741.5, yaw: Math.PI / 2, isCoupe: true, isSupercar: true }), 0.27);
  }
}

// ============================================================================
// WORLD BOOT (idempotent — safe to rebuild in Studio / Save & Test)
// ============================================================================
function disposeWorldObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      if (m.map && m.map.isCanvasTexture) { m.map.dispose(); m.dispose(); }
    }
  });
}

/** Drop engine LOD entries whose objects are no longer attached to the scene. */
function pruneDetachedHighDetail() {
  for (let i = highDetailObjects.length - 1; i >= 0; i--) {
    let o = highDetailObjects[i], attached = false;
    while (o) { if (o === scene) { attached = true; break; } o = o.parent; }
    if (!attached) highDetailObjects.splice(i, 1);
  }
}

function clearBuiltWorld() {
  for (const child of [...worldRoot.children]) {
    if (!child.userData.worldBuilt) continue;
    worldRoot.remove(child);
    disposeWorldObject(child);
  }
  resetWorldState();
  vehicles.length = 0;
  entityObjects.clear();
  studioObjects.clear();
  studioObjectBaseTransforms.clear();
  studioDeletedObjects.clear();
  sculptableTerrainMeshes.length = 0;
  bio.base = null;
  bio.snow = null;
  bio.last = 'city';
  buildNewBiomes.fire = null;
  buildJungleBiome.waterfall = null;
  pruneDetachedHighDetail();
}

export function buildWorld(data = levelData, { register = true, afterStatic = null } = {}) {
  clearBuiltWorld();
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
  buildCriminalHideout();
  buildLosAuraNorthExpansion(register);
  registerGeneratedWorldObjects(data);
  recomputeWorldBounds();
}

// Register late-bound implementations for lower layers (see state.js).
Object.assign(hooks, { knockOverLamppost });