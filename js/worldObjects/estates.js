// =============================================================================
// worldObjects/estates.js — AURA ESTATES, HOSPITAL, WESTSIDE DISTRICT
//
// Builders own GEOMETRY + COLLIDERS and publish handles. Behaviour (gate
// animation, safe cracking, zone names, [F] hooks) lives in
// worldSystems/estates.js, which reads them via getPlacement(id).data.
//
// COORDINATE NOTE: `y` on estate_wall / estate_gate is the CENTRE height, not
// the base — matching the original wb() helper. Estate houses use baseY.
// =============================================================================
import * as THREE from 'three';
import { aura, enterableZones, hillsH } from '../state.js';
import { makeMat, worldRoot } from '../engine.js';
import { addSolidBox, footprintClear, makeBox, rngFor } from '../worldKit.js';
import { resolveRowXZ } from '../worldTerrain.js';
import { neon } from './shell.js';

// --- palette (module-owned; kit disposal skips shared materials) -------------
const matCache = new Map(), ownedMats = [];
function em(hex, roughness = 0.9, emissive = 0) {
  const key = `${hex}|${roughness}|${emissive}`;
  let m = matCache.get(key);
  if (!m) {
    m = makeMat(hex, { roughness, emissive, emissiveIntensity: emissive ? 1.2 : 0 });
    m.userData.shared = true;
    matCache.set(key, m); ownedMats.push(m);
  }
  return m;
}
const K = {
  wall: em(0xe9e6df), roof: em(0x2b2f36), floor: em(0xd8dde0, 0.5),
  glass: em(0x8fb8d6, 0.15), red: em(0xdc2626), white: em(0xf5f5f5),
  wood: em(0x6b4a2f), sofa: em(0x394a5e), lamp: em(0xfff7d6, 0.5, 0xfff7d6),
  gold: em(0xf5c542, 0.3, 0xb8860b), stone: em(0xb9b2a6), drive: em(0x3a3d42),
  metal: em(0x20242a, 0.4), blue: em(0x7ec8e3), black: em(0x111111)
};

// =============================================================================
// ESTATE WALL / GATE
// =============================================================================
export function buildEstateWall(row) {
  const { x, z } = resolveRowXZ(row);
  const w = row.w ?? 96, d = row.d ?? 0.8, y = row.y ?? 39.7, h = row.h ?? 3.4;
  const m = makeBox(worldRoot, w, h, d, x, y, z, K.stone, { name: row.name || 'Estate wall' });
  const box = addSolidBox(x - w / 2, x + w / 2, y - h / 2, y + h / 2, z - d / 2, z + d / 2, 'solid', false);
  return { object: m, boxes: [box] };
}

/**
 * Two sliding leaves + header + sign. `gate.closedZ` are LOCAL leaf offsets;
 * the system animates toward closedZ ∓ travel and removes `boxes` on force.
 */
export function buildEstateGate(row) {
  const { x, z } = resolveRowXZ(row);
  const y = row.y ?? 39.5, travel = row.travel ?? 4;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.userData.studioName = 'Aura Estates gate';
  worldRoot.add(g);

  const l1 = makeBox(g, 0.3, 3, 4, 0, 0, -2, K.metal);
  const l2 = makeBox(g, 0.3, 3, 4, 0, 0, 2, K.metal);
  const leafBox = (lz) => addSolidBox(x - 0.3, x + 0.3, y - 1.5, y + 1.5, z + lz - 2, z + lz + 2, 'solid', false);
  const b1 = leafBox(-2), b2 = leafBox(2);

  makeBox(g, 0.9, 1.4, 10, -0.6, 2.4, 0, K.stone);
  const sg = new THREE.Group();
  sg.position.set(0, 2.4, 0);
  sg.rotation.y = Math.PI / 2;
  g.add(sg);
  neon(sg, 'AURA ESTATES', 0, 0, 0, '#111827', '#fcd34d', 7, 1.1);

  return {
    object: g, boxes: [b1, b2],
    anchors: { approach: [x + 1, y, z] },
    gate: { open: false, boxes: [b1, b2], l1, l2, x, y, z, closedZ: [-2, 2], travel }
  };
}

// =============================================================================
// ESTATE HOUSE
// =============================================================================
export function buildEstateHouse(row) {
  const { x: cx, z: cz } = resolveRowXZ(row);
  const dir = row.dir ?? 1;
  const HW = row.w ?? 15, HD = row.d ?? 11, HT = row.h ?? 4.2;
  const Y = row.baseY ?? 38.18;
  const wm = row.stone ? K.stone : K.wall;

  const g = new THREE.Group();
  g.position.set(cx, Y, cz);
  g.userData.studioName = row.name || `Estate house ${row.id}`;
  worldRoot.add(g);
  const inn = new THREE.Group();
  inn.userData.studioName = 'Estate interior';
  g.add(inn);

  const boxes = [];
  const B = (p, m, lx, ly, lz, a, b, d) => makeBox(p, a, b, d, lx, ly, lz, m);
  // wb(): centre-based, matching the original.
  const S = (lx, ly, lz, a, b, d) => boxes.push(addSolidBox(
    cx + lx - a / 2, cx + lx + a / 2, Y + ly - b / 2, Y + ly + b / 2,
    cz + lz - d / 2, cz + lz + d / 2, 'solid', false));

  const fz = dir * HD / 2, bz = -dir * HD / 2, sw = (HW - 2.6) / 2;

  B(g, wm, 0, HT / 2, bz, HW, HT, 0.4); S(0, HT / 2, bz, HW, HT, 0.4);
  for (const sd of [-1, 1]) {
    B(g, wm, sd * HW / 2, HT / 2, 0, 0.4, HT, HD); S(sd * HW / 2, HT / 2, 0, 0.4, HT, HD);
    B(g, wm, sd * (1.3 + sw / 2), HT / 2, fz, sw, HT, 0.4); S(sd * (1.3 + sw / 2), HT / 2, fz, sw, HT, 0.4);
    B(g, K.glass, sd * (1.3 + sw / 2), 2.3, fz + dir * 0.22, sw * 0.6, 1.6, 0.05);
  }
  B(g, wm, 0, HT - 0.5, fz, 2.6, 1, 0.4);
  B(g, K.roof, 0, HT + 0.2, 0, HW + 1.4, 0.4, HD + 1.4);
  B(g, K.drive, 0, 0.05, fz + dir * 5.5, 4, 0.1, 11);

  B(inn, K.wood, 0, 0.02, 0, HW - 0.6, 0.05, HD - 0.6);
  B(inn, K.sofa, -3, 0.45, -dir * 2.5, 4, 0.9, 1.2);
  B(inn, K.wood, -3, 0.30, -dir * 0.6, 2, 0.6, 1);
  B(inn, K.black, 4, 1.4, -dir * (HD / 2 - 0.4), 3, 1.6, 0.1);
  B(inn, K.lamp, 0, HT - 0.2, 0, 2, 0.1, 2);
  B(inn, K.wood, -5, 0.5, dir * 3, 1.2, 1, 2.4);
  const safe = B(inn, K.gold, 5.5, 0.5, dir * (HD / 2 - 1.2), 0.9, 0.9, 0.7);

  (aura.culls || []).push({ g: inn, x: cx, z: cz, r: row.cullR ?? 65 });

  const sx = cx + 5.5, sz = cz + dir * (HD / 2 - 1.2);
  return {
    object: g, boxes, interior: inn,
    anchors: { door: [cx, Y, cz + fz], safe: [sx, Y + 0.5, sz] },
    safe: { mesh: safe, x: sx, y: Y + 0.5, z: sz, taken: false }
  };
}

// =============================================================================
// HOSPITAL — auto-sited on the first clear lot in the scan window
// =============================================================================
export function buildHospital(row) {
  const W = row.w ?? 36, D = row.d ?? 26, HH = row.h ?? 7, T = 0.5;
  const HY = row.baseY ?? 0.18;
  let hx = 0, hz = 0, found = false;
  if (Array.isArray(row.at)) { hx = row.at[0]; hz = row.at[1]; found = true; }
  else {
    const sc = row.scan || { xs: [-170, 110], zs: [-140, 160], step: 10, pad: 4 };
    const step = sc.step ?? 10, pad = sc.pad ?? 4;
    for (let x = sc.xs[0]; x <= sc.xs[1] && !found; x += step) {
      for (let z = sc.zs[0]; z <= sc.zs[1]; z += step) {
        if (footprintClear(x, z, W, D, pad)) { hx = x; hz = z; found = true; break; }
      }
    }
  }
  if (!found) { console.warn('[estates] no hospital lot found'); return null; }

  const g = new THREE.Group();
  g.position.set(hx, HY, hz);
  g.userData.studioName = 'AURA GENERAL HOSPITAL';
  worldRoot.add(g);
  const inn = new THREE.Group();
  inn.userData.studioName = 'Hospital interior';
  g.add(inn);

  const boxes = [];
  const B = (p, m, lx, ly, lz, a, b, d) => makeBox(p, a, b, d, lx, ly, lz, m);
  const S = (lx, ly, lz, a, b, d) => boxes.push(addSolidBox(
    hx + lx - a / 2, hx + lx + a / 2, HY + ly - b / 2, HY + ly + b / 2,
    hz + lz - d / 2, hz + lz + d / 2, 'solid', false));

  B(g, K.white, 0, HH / 2, -D / 2, W, HH, T); S(0, HH / 2, -D / 2, W, HH, T);
  const sw = (W - 6) / 2;
  for (const sd of [-1, 1]) {
    B(g, K.white, sd * W / 2, HH / 2, 0, T, HH, D); S(sd * W / 2, HH / 2, 0, T, HH, D);
    B(g, K.white, sd * (3 + sw / 2), HH / 2, D / 2, sw, HH, T); S(sd * (3 + sw / 2), HH / 2, D / 2, sw, HH, T);
  }
  B(g, K.white, 0, HH - 1, D / 2, 6, 2, T);
  B(g, K.roof, 0, HH + 0.25, 0, W + 1, 0.5, D + 1);
  B(g, K.white, 0, 4.6, D / 2 + 2.5, 10, 0.3, 5);
  for (const sx of [-11, 11]) {
    B(g, K.red, sx, 4.5, D / 2 + 0.3, 1, 4, 0.15);
    B(g, K.red, sx, 4.5, D / 2 + 0.3, 4, 1, 0.15);
  }
  neon(g, 'AURA GENERAL HOSPITAL', 0, 6.3, D / 2 + 0.3, '#ffffff', '#dc2626', 12, 1.4);

  B(inn, K.floor, 0, 0.02, 0, W - 1, 0.05, D - 1);
  for (let x = -15; x <= 15; x += 6) for (const z of [-6, 6]) B(inn, K.lamp, x, HH - 0.3, z, 2.4, 0.1, 0.8);
  B(inn, K.wood, 0, 0.55, 6, 8, 1.1, 1.2);
  B(inn, K.white, 0, 1.12, 6, 8.2, 0.08, 1.4);
  for (let x = -14; x <= -8; x += 2) B(inn, K.sofa, x, 0.4, 10, 1.2, 0.8, 1);
  for (const x of [-14, -8, -2, 8, 13]) {
    const z = -D / 2 + 3;
    B(inn, K.white, x, 0.45, z, 1.1, 0.5, 2.3);
    B(inn, K.blue, x, 0.75, z + 0.3, 1.1, 0.12, 1.6);
    B(inn, K.white, x, 0.8, z - 0.9, 0.7, 0.14, 0.5);
  }
  for (const x of [-11, -5, 10.5]) B(inn, K.blue, x, 1.3, -D / 2 + 3.2, 0.05, 2.2, 2.6);
  for (const x of [-16, -10, -4, 6, 11]) B(inn, K.metal, x, 1, -D / 2 + 4.2, 0.06, 2, 0.06);

  aura.hospitalSpawn = { x: hx - 14, z: hz - D / 2 + 5.6 };
  (aura.culls || []).push({ g: inn, x: hx, z: hz, r: row.cullR ?? 80 });
  enterableZones.push({
    minX: hx - W / 2 + 1, maxX: hx + W / 2 - 1,
    minZ: hz - D / 2 + 1, maxZ: hz + D / 2 - 1, name: 'AURA GENERAL HOSPITAL'
  });
  return { object: g, boxes, interior: inn, at: [hx, hz], anchors: { spawn: [hx - 14, HY, hz - D / 2 + 5.6] } };
}

// =============================================================================
// WESTSIDE DISTRICT — lit-facade towers + plain low blocks on the hill shelf
// =============================================================================
const rr = (n) => { const v = Math.sin(n * 127.1) * 43758.5453; return v - Math.floor(v); };
const facadeCache = new Map();
const TINTS = [0x9ab5c5, 0xb7c4cc, 0x829eaf];
const LOWS = [0x5b6670, 0x8c8172, 0x65746f];
let westRoof = null;

function facadeMat(tint) {
  if (facadeCache.has(tint)) return facadeCache.get(tint);
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = '#182a3a'; c.fillRect(0, 0, 64, 128);
  for (let r = 0; r < 16; r++) for (let col = 0; col < 8; col++) {
    c.fillStyle = rr(r * 13 + col * 7) < 0.38 ? '#ffe9a8' : '#36566e';
    c.fillRect(col * 8 + 1, r * 8 + 1, 6, 6);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 7);
  const m = makeMat(TINTS[tint % 3], { roughness: 0.3, metalness: 0.35, flatShading: false });
  m.map = tex; m.emissiveMap = tex;
  m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = 0.18;
  m.userData.shared = true;
  facadeCache.set(tint, m); ownedMats.push(m);
  return m;
}
const lowMat = (tint) => em(LOWS[tint % 3], 0.85);
const roofMat = () => (westRoof || (westRoof = em(0x29323a, 0.85)));

function westsideBlock(row, tower) {
  const { x, z } = resolveRowXZ(row);
  const w = row.w ?? 13, d = row.d ?? 15, h = row.h ?? 28;
  const ground = hillsH(x, z);
  const tint = row.tint ?? Math.floor(rngFor(row.id)() * 3);
  const g = new THREE.Group();
  g.position.set(x, ground, z);
  g.userData.studioName = row.name || (tower ? 'Westside tower' : 'Westside block');
  worldRoot.add(g);
  makeBox(g, w, h, d, 0, h / 2, 0, tower ? facadeMat(tint) : lowMat(tint), { cast: true, recv: true });
  makeBox(g, w + 0.5, 0.48, d + 0.5, 0, h + 0.24, 0, roofMat());
  const box = addSolidBox(x - w / 2, x + w / 2, ground, ground + h, z - d / 2, z + d / 2, 'westcity_building', false);
  return { object: g, boxes: [box], anchors: { roof: [x, ground + h + 0.48, z] } };
}
export const buildWestsideTower = (row) => westsideBlock(row, true);
export const buildWestsideLow = (row) => westsideBlock(row, false);

export function resetEstates() {
  matCache.clear(); facadeCache.clear(); westRoof = null;
  for (const m of ownedMats) { if (m.map && m.map.isCanvasTexture) m.map.dispose(); m.dispose(); }
  ownedMats.length = 0;
}

export const ESTATE_BUILDERS = {
  estate_wall: buildEstateWall, estate_gate: buildEstateGate, estate_house: buildEstateHouse,
  hospital: buildHospital, westside_tower: buildWestsideTower, westside_low: buildWestsideLow
};
export default ESTATE_BUILDERS;