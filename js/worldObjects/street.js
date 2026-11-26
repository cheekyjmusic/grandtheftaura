// =============================================================================
// worldObjects/street.js — STREET PROPS, KNOCKABLE LAMPPOSTS & PARKED VEHICLES
//
// Builder-backed prefabs: they own runtime state (lampPosts, iceZones), lights,
// or publish animation handles to streetFX for worldSystems/atmosphere.js.
//
// PUBLISHED HANDLES
//   streetFX.fire      { fire, fl }            campfire flicker   (prop_campfire)
//   streetFX.waterfall { fallSheet, mistPool } jungle falls       (prop_cliff)
//   streetFX.wheel     { group, pods, angle }  ferris wheel       (prop_ferris_wheel)
//   rec.data.hammer    sledgehammer in dumpster                   (prop_dumpster)
//   rec.data.refill    sausage refill zone                        (prop_cart)
//
// MATERIALS: module-owned cache, marked shared so disposeTree() skips them on
// rebuild. disposeStreet() (full teardown only) releases them; every getter is
// lazy so a later buildWorld() re-creates them cleanly.
// =============================================================================
import * as THREE from 'three';
import {
  crime, hooks, iceZones, lampPosts, mapShapes, player, terrainH
} from '../state.js';
import { makeMat, realWindowGlassMat, regHigh, worldRoot } from '../engine.js';
import { loadTexture } from '../assets.js';
import { sfx } from '../audio.js';
import { spawnParticles } from '../items.js';
import { vehicles } from '../vehicles.js';
import { addSolidBox, dist2, makeBox, signBoxMaterials } from '../worldKit.js';
import { buildGantry } from '../worldRoads.js';
import { barkMaterial, leafMaterial } from './foliage.js';

// -----------------------------------------------------------------------------
// Module-owned materials (shared; disposed only by disposeStreet)
// -----------------------------------------------------------------------------
const matCache = new Map();
const ownedMats = [];
function sm(hex, opts = {}) {
  const key = hex + '|' + JSON.stringify(opts);
  let m = matCache.get(key);
  if (!m) {
    m = makeMat(hex, opts);
    m.userData.shared = true;
    matCache.set(key, m);
    ownedMats.push(m);
  }
  return m;
}
const basic = (hex, opts = {}) => sm(hex, { ...opts, __basic: true }); // see smBasic below
// Basic (unlit) materials can't go through makeMat — separate cache.
const basicCache = new Map();
function smBasic(hex, opts = {}) {
  const key = hex + '|' + JSON.stringify(opts);
  let m = basicCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: hex, ...opts });
    m.userData.shared = true;
    basicCache.set(key, m);
    ownedMats.push(m);
  }
  return m;
}

let barkTex = null, leafTex = null, barkM = null, leafM = null;
function treeMats() { return { barkM: barkMaterial(), leafM: leafMaterial() }; }

const P = (row, k) => row.parent || k?.parent || worldRoot;
const neon = (parent, text, x, y, z, bg, fg, w = 4.4, h = 1.1) =>
  makeBox(parent, w, h, 0.22, x, y, z, signBoxMaterials(text, bg, fg), { name: `Sign: ${text}` });

// =============================================================================
// KNOCKABLE LAMPPOSTS — runtime state lives in state.lampPosts
// =============================================================================
export function buildKnockableLamppost(x, z) {
  const poleMat = sm(0xcbd5e1, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.20, flatShading: false });
  // Bulb material is UNIQUE per post — updateLampposts flickers it individually.
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a, emissive: 0xfacc15, emissiveIntensity: 0.95
  });
  const pivot = new THREE.Group();
  pivot.userData.studioName = 'Streetlight';
  pivot.position.set(x, 0.18, z);
  const baseFlange = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.14, 10), poleMat);
  baseFlange.position.y = 0.07;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 4.4, 8), poleMat);
  pole.position.y = 2.2;
  pole.castShadow = true;
  const arm = makeBox(pivot, 0.10, 0.10, 0.75, 0, 4.35, 0.32, poleMat);
  const lamp = makeBox(pivot, 0.38, 0.22, 0.46, 0, 4.24, 0.62, bulbMat);
  pivot.remove(arm, lamp);
  pivot.add(baseFlange, pole, arm, lamp);
  worldRoot.add(pivot);
  const boxRef = addSolidBox(x - 0.18, x + 0.18, 0.18, 4.6, z - 0.18, z + 0.18, 'lamppost', false);
  const lp = {
    x, z, pivot, lampMat: bulbMat, boxRef,
    state: 'standing', fallYaw: 0, fallAngle: 0, fallVel: 0, respawnTimer: 0
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

/** Gameplay wrapper: crime + multiplayer event on top of the physical knock. */
export function knockOverLamppost(lp, yaw, speed) {
  if (!lp || lp.state !== 'standing') return;
  knockOverLamppostBase(lp, yaw, speed);
  if (speed > 6) crime(0.08);
  hooks.mpWorldEvent({ t: 'lamp_hit', i: lampPosts.indexOf(lp), yaw, speed });
}

export function updateLampposts(dt, elapsed) {
  const guest = hooks.mpIsGuest ? hooks.mpIsGuest() : false;
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
        spawnParticles(lp.x + Math.sin(lp.fallYaw) * 4.2, 0.35,
          lp.z + Math.cos(lp.fallYaw) * 4.2, 0xfef08a, 6, 4.0);
      }
      lp.pivot.rotation.order = 'YXZ';
      lp.pivot.rotation.y = lp.fallYaw;
      lp.pivot.rotation.x = lp.fallAngle;
    } else if (lp.state === 'down') {
      const flicker = Math.sin(elapsed * 31 + i * 3.7) * Math.cos(elapsed * 47 + i * 1.9);
      const on = flicker > 0.12;
      lp.lampMat.emissiveIntensity = on ? 1.8 : 0.0;
      lp.lampMat.color.setHex(on ? 0xfef08a : 0x334155);
      if (guest) continue;
      lp.respawnTimer -= dt;
      if (lp.respawnTimer <= 0) {
        const clearOfPlayer = dist2(player.x, player.z, lp.x, lp.z) > 4.84;
        const clearOfCars = vehicles.every((v) => dist2(v.x, v.z, lp.x, lp.z) > 10.24);
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

// =============================================================================
// LEGACY (x,z) BUILDERS — trees, hydrants, shelters, cart, fountain
// =============================================================================
export function createTree(x, z, scale = 1, baseY = 0.18) {
  const { barkM, leafM } = treeMats();
  const g = new THREE.Group();
  g.position.set(x, baseY, z);
  g.scale.setScalar(scale);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.35, 1.8, 6), barkM);
  trunk.position.y = 0.9;
  trunk.castShadow = true;
  const c1 = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.3, 6), leafM);
  c1.position.y = 2.4;
  c1.castShadow = true;
  const c2 = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.9, 6), leafM);
  c2.position.y = 3.65;
  c2.castShadow = true;
  const c3 = regHigh(new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.5, 6), leafM));
  c3.position.y = 4.7;
  c3.castShadow = true;
  g.add(trunk, c1, c2, c3);
  worldRoot.add(g);
  addSolidBox(x - 0.38 * scale, x + 0.38 * scale, baseY, baseY + 2.2 * scale,
    z - 0.38 * scale, z + 0.38 * scale, 'tree', false);
  return g;
}

export function createHydrant(x, z) {
  const h = new THREE.Group();
  h.position.set(x, 0.18, z);
  h.userData.studioName = 'Hydrant';
  const red = sm(0xdc2626, { metalness: 0.82, roughness: 0.24, clearcoat: 0.6, flatShading: false });
  const chrome = sm(0xe2e8f0, { metalness: 0.94, roughness: 0.15, flatShading: false });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.65, 10), red);
  body.position.y = 0.325;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), chrome);
  cap.position.y = 0.66;
  const side = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.42, 8), chrome);
  side.rotation.z = Math.PI / 2;
  side.position.y = 0.46;
  h.add(body, cap, side);
  worldRoot.add(h);
  const box = addSolidBox(x - 0.2, x + 0.2, 0.18, 0.88, z - 0.2, z + 0.2, 'hydrant', true);
  return { object: h, boxes: [box] };
}

export function createBusShelter(x, z, rotY = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0.18, z);
  g.rotation.y = rotY;
  g.userData.studioName = 'Bus shelter';
  const chrome = sm(0xe2e8f0, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.18, flatShading: false });
  const roof = makeBox(g, 3.8, 0.12, 1.5, 0, 2.45, 0, chrome, { cast: true });
  const backGlass = makeBox(g, 3.5, 2.2, 0.06, 0, 1.25, -0.62, realWindowGlassMat);
  const bench = makeBox(g, 3.0, 0.10, 0.48, 0, 0.55, -0.32, sm(0xb45309, { texType: 'wood' }));
  g.remove(roof, backGlass, bench);
  for (const [px, pz] of [[-1.75, -0.62], [1.75, -0.62], [-1.75, 0.62], [1.75, 0.62]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.45, 8), chrome);
    post.position.set(px, 1.225, pz);
    g.add(post);
  }
  g.add(roof, backGlass, bench);
  worldRoot.add(g);
  const c = Math.abs(Math.cos(rotY)), s = Math.abs(Math.sin(rotY));
  const hw = (3.8 * c + 1.5 * s) / 2, hd = (3.8 * s + 1.5 * c) / 2;
  const box = addSolidBox(x - hw, x + hw, 2.38, 2.68, z - hd, z + hd, 'shelter_roof', true);
  return { object: g, boxes: [box] };
}

export function buildPlazaHotdogCart(x, z) {
  const cart = new THREE.Group();
  cart.position.set(x, 0.18, z);
  cart.userData.studioName = 'Plaza hotdog cart';
  const body = makeBox(cart, 2.1, 1.05, 1.15, 0, 0.62, 0,
    sm(0xdc2626, { texType: 'corrugated', metalness: 0.65, roughness: 0.28 }), { cast: true });
  const top = makeBox(cart, 2.22, 0.10, 1.25, 0, 1.18, 0,
    sm(0xf8fafc, { texType: 'brushedsteel', metalness: 0.9, roughness: 0.2, flatShading: false }));
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.65, 8),
    sm(0xe2e8f0, { metalness: 0.9 }));
  pole.position.set(0, 1.95, 0);
  const umbrella = new THREE.Mesh(new THREE.ConeGeometry(1.55, 0.65, 8), sm(0xfacc15, { roughness: 0.5 }));
  umbrella.position.set(0, 2.75, 0);
  umbrella.castShadow = true;
  const miniDog = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.65, 6, 8), sm(0xb91c1c));
  miniDog.rotation.z = Math.PI / 2;
  miniDog.position.set(0, 1.34, 0.1);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.45, 24),
    smBasic(0xfacc15, { side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  neon(cart, 'SAUSAGE REFILL [E]', 0, 2.15, 0.65, '#7f1d1d', '#fef08a', 2.2, 0.44);
  cart.remove(body, top);
  cart.add(body, top, pole, umbrella, miniDog, ring);
  worldRoot.add(cart);
  const box = addSolidBox(x - 1.1, x + 1.1, 0.18, 1.42, z - 0.62, z + 0.62, 'hotdog_cart', true);
  // worldRuntime pushes rec.data.refill into sausageRefillZones after the build.
  return { object: cart, boxes: [box], refill: { x, y: 0.18, z: z + 1.2, label: 'PLAZA HOTDOG CART' } };
}

/** Plaza fountain + cobble courtyard (the original buildCityLandmarks centrepiece). */
export function buildFountain(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.userData.studioName = 'Plaza fountain';
  const cobble = sm(0xa8a29e, { texType: 'cobblestone', repeatX: 3, repeatY: 18, roughness: 0.78, bumpScale: 0.025 });
  const marble = sm(0xf8fafc, { texType: 'marble', repeatX: 3, repeatY: 2, roughness: 0.20, clearcoat: 0.85, flatShading: false });
  const court = new THREE.Mesh(new THREE.CylinderGeometry(6.8, 7.0, 0.06, 20), cobble);
  court.position.y = 0.215;
  court.receiveShadow = true;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.78, 18), marble);
  rim.position.y = 0.57;
  rim.castShadow = true;
  const water = new THREE.Mesh(new THREE.CylinderGeometry(3.05, 3.05, 0.72, 18),
    sm(0x0ea5e9, {
      texType: 'water', repeatX: 3, repeatY: 3, roughness: 0.07, metalness: 0.28,
      clearcoat: 1.0, emissive: 0x0284c7, emissiveIntensity: 0.25, flatShading: false
    }));
  water.position.y = 0.58;
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.85, 1.7, 14), marble);
  pillar.position.y = 1.4;
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 0.9, 0.45, 16), marble);
  basin.position.y = 2.2;
  g.add(court, rim, water, pillar, basin);
  worldRoot.add(g);
  const boxes = [
    addSolidBox(x - 3.2, x + 3.2, 0.18, 0.96, z - 3.2, z + 3.2, 'fountain_rim', true),
    addSolidBox(x - 1.35, x + 1.35, 0.96, 2.42, z - 1.35, z + 1.35, 'fountain_top', true)
  ];
  return { object: g, boxes };
}

// =============================================================================
// ROW BUILDERS — (row, ctx) via the registerLegacyBuilders passthrough
// =============================================================================

/** Wooden pier. `piles.from/to` are absolute world z, as authored in worldData. */
export function buildPier(row, k) {
  const [x, z] = row.at;
  const w = row.w ?? 4, d = row.d ?? 40, y = row.y ?? 0.55;
  const big = w > 8;
  const thick = big ? 0.26 : 0.20;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.userData.studioName = row.name || (big ? 'Santa Aura Pier' : 'Cove pier');
  P(row, k).add(g);
  makeBox(g, w, thick, d, 0, y - thick / 2, 0,
    sm(big ? 0x926c44 : 0x92704a, { texType: 'wood', repeatX: big ? 40 : 1, repeatY: big ? 4 : 10 }),
    { recv: true });
  const boxes = [addSolidBox(x - w / 2, x + w / 2, y - (big ? 0.37 : 0.35), y,
    z - d / 2, z + d / 2, big ? 'santa_aura_pier' : 'pier', true)];
  const pl = row.piles;
  if (pl) {
    const pileMat = sm(0x57534e);
    const pr = big ? 0.24 : 0.18, ph = big ? 1.8 : 1.4, py = big ? -0.3 : 0.0;
    for (let pz = pl.from; pz <= pl.to + 0.001; pz += pl.step) {
      for (const s of [-1, 1]) {
        const pile = new THREE.Mesh(new THREE.CylinderGeometry(pr, pr + 0.04, ph, big ? 8 : 6), pileMat);
        pile.position.set(s * pl.dx, py, pz - z);
        g.add(pile);
      }
    }
  }
  if (row.sign) {
    const s = row.sign, sz = (s.z ?? z + d / 2) - z;
    const red = sm(0xdc2626, { metalness: 0.65, roughness: 0.32 });
    for (const sx of [-1, 1]) makeBox(g, 0.45, 5.2, 0.45, sx * (w / 2 - 0.8), 3.0, sz, red);
    neon(g, s.text, 0, 5.4, sz, s.bg || '#1e1b4b', s.fg || '#38bdf8', s.w ?? 11.2, s.h ?? 1.35);
    mapShapes.push({ x, z, w, d, color: '#92400e', border: '#f59e0b', enterable: false });
  }
  return { object: g, boxes };
}

export function buildLifeguard(row, k) {
  const [x, z] = row.at;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.userData.studioName = 'Lifeguard tower';
  P(row, k).add(g);
  const white = sm(0xf8fafc);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    makeBox(g, 0.2, 2.6, 0.2, sx, 1.5, sz, white, { cast: true, recv: true });
  }
  makeBox(g, 2.6, 1.6, 2.6, 0, 3.3, 0, sm(0xdc2626, { texType: 'wood' }), { cast: true, recv: true });
  makeBox(g, 3.2, 0.2, 3.2, 0, 4.25, 0, white, { cast: true, recv: true });
  makeBox(g, 0.06, 1.3, 0.06, 1.4, 5.0, 1.4, sm(0x57534e), { cast: true });
  makeBox(g, 0.7, 0.4, 0.04, 1.75, 5.4, 1.4, sm(0xfacc15), { recv: true });
  const box = addSolidBox(x - 1.2, x + 1.2, 2.5, 4.35, z - 1.2, z + 1.2, 'lifeguard_deck', true);
  return { object: g, boxes: [box] };
}

/** Campfire — publishes streetFX.fire for the atmosphere flicker tick. */
export function buildCampfire(row, k) {
  const [x, z] = row.at;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.userData.studioName = 'Campfire';
  P(row, k).add(g);
  const stone = sm(0x78716c);
  for (let a = 0; a < 8; a++) {
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), stone);
    s.position.set(Math.cos(a * 0.785) * 0.7, 0.3, Math.sin(a * 0.785) * 0.7);
    g.add(s);
  }
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.1, 6), smBasic(0xfb923c));
  fire.position.y = 0.8;
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.8, 6), smBasic(0xfde047));
  inner.position.y = 0.75;
  const fl = new THREE.PointLight(0xfb923c, 1.6, 14);
  fl.position.y = 1.4;
  g.add(fire, inner, fl);
  streetFX.fire = { fire, fl };
  return { object: g, fire: streetFX.fire };
}

export function buildTent(row, k) {
  const [x, z] = row.at;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = row.ry || 0;
  g.userData.studioName = 'Tent';
  P(row, k).add(g);
  const t = new THREE.Mesh(new THREE.ConeGeometry(1.7, 1.9, 4), sm(row.color ?? 0x2563eb));
  t.position.y = 1.1;
  t.castShadow = true;
  g.add(t);
  const box = addSolidBox(x - 1.1, x + 1.1, 0.18, 1.68, z - 1.1, z + 1.1, 'tent', false);
  return { object: g, boxes: [box] };
}

/** Frostpine park entrance arch. Base height sampled from terrain. */
export function buildSignArch(row, k) {
  const [x, z] = row.at;
  const w = row.w ?? 13.6;
  const base = Number.isFinite(row.y) ? row.y : terrainH(x, z);
  const g = new THREE.Group();
  g.position.set(x, base, z);
  g.userData.studioName = 'Park entrance arch';
  P(row, k).add(g);
  const wood = sm(0x57534e, { texType: 'wood', repeatX: 1, repeatY: 3 });
  const boxes = [];
  for (const s of [-1, 1]) {
    const px = s * (w / 2 - 0.4);
    makeBox(g, 0.45, 5.2, 0.45, px, 2.6, 0, wood, { cast: true });
    boxes.push(addSolidBox(x + px - 0.3, x + px + 0.3, 0.1, 5.4, z - 0.3, z + 0.3, 'park_arch_post', false));
  }
  makeBox(g, w, 0.5, 0.5, 0, 5.1, 0, wood, { cast: true });
  for (const t of row.texts || []) {
    neon(g, t.text, 0, t.y ?? 4.3, 0, t.bg || '#1c1917', t.fg || '#fcd34d', t.w ?? 10.5, t.h ?? 1.2);
  }
  return { object: g, boxes };
}

/** Standalone overhead gantry — delegates to worldRoads.buildGantry. */
export function buildGantryRow(row, k) {
  const [x, z] = row.at;
  const m = buildGantry(P(row, k), x, z, row.y ?? 0.18, row.halfW ?? 8,
    row.text || '', row.bg || '#065f46', row.fg || '#f8fafc', row.w ?? 15);
  return { object: m };
}

/** Parked jetliner with yaw-correct fuselage + wing colliders. */
export function buildParkedJet(row, k) {
  const [x, z] = row.at;
  const yaw = row.ry || 0;
  const g = new THREE.Group();
  g.position.set(x, 0.29, z);
  g.rotation.y = yaw;
  g.userData.studioName = 'Parked jetliner';
  P(row, k).add(g);
  const white = sm(0xf8fafc, { roughness: 0.55 });
  const steel = sm(0xe2e8f0, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.18, flatShading: false });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 24, 14), white);
  body.rotation.x = Math.PI / 2;
  body.position.y = 3.2;
  body.castShadow = true;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(2.1, 4.8, 14), white);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 3.2, 14.4);
  makeBox(g, 14.5, 0.35, 4.2, -7.5, 2.8, 1.0, steel, { ry: 0.26 });
  makeBox(g, 14.5, 0.35, 4.2, 7.5, 2.8, 1.0, steel, { ry: -0.26 });
  makeBox(g, 0.45, 5.8, 3.8, 0, 6.2, -10.2, sm(row.stripe ?? 0xdc2626), { rx: -0.25 });
  makeBox(g, 8.4, 0.25, 2.2, 0, 3.4, -10.8, steel);
  for (const ex of [-5.5, 5.5]) {
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.78, 3.4, 12),
      sm(0x334155, { metalness: 0.85 }));
    eng.rotation.x = Math.PI / 2;
    eng.position.set(ex, 1.9, 2.2);
    g.add(eng);
  }
  g.add(body, nose);
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  const fHX = 2.3 * c + 14.5 * s, fHZ = 2.3 * s + 14.5 * c;
  const wHX = 14.5 * c + 2.5 * s, wHZ = 14.5 * s + 2.5 * c;
  const boxes = [
    addSolidBox(x - fHX, x + fHX, 0.29, 5.5, z - fHZ, z + fHZ, 'parked_jet', false),
    addSolidBox(x - wHX, x + wHX, 2.5, 3.3, z - wHZ, z + wHZ, 'jet_wing', false)
  ];
  return { object: g, boxes };
}

/** Apron service equipment: kind = cart | tug | mast | cones. */
export function buildService(row, k) {
  const [x, z] = row.at;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  P(row, k).add(g);
  const boxes = [];
  const top = sm(0xe2e8f0, { texType: 'brushedsteel', metalness: 0.9, roughness: 0.2, flatShading: false });
  if (row.kind === 'cart') {
    g.userData.studioName = 'Baggage cart';
    makeBox(g, 2.0, 1.1, 3.0, 0, 0.85, 0, sm(row.color ?? 0x2563eb, { metalness: 0.5, roughness: 0.5 }), { cast: true });
    makeBox(g, 2.2, 0.16, 3.2, 0, 1.45, 0, top);
    boxes.push(addSolidBox(x - 1.1, x + 1.1, 0.25, 1.5, z - 1.6, z + 1.6, 'bag_cart', true));
  } else if (row.kind === 'tug') {
    g.userData.studioName = 'Pushback tug';
    makeBox(g, 3.2, 1.3, 5.4, 0, 0.95, 0, sm(0xfacc15, { metalness: 0.4, roughness: 0.5 }), { cast: true });
    makeBox(g, 2.4, 1.2, 2.0, 0, 2.1, -1.6, sm(0x0f172a, { metalness: 0.5 }));
    boxes.push(addSolidBox(x - 1.6, x + 1.6, 0.25, 2.7, z - 2.7, z + 2.7, 'pushback_tug', true));
  } else if (row.kind === 'mast') {
    g.userData.studioName = 'Apron flood mast';
    const h = row.h ?? 22;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, h, 8),
      sm(0xcbd5e1, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.2, flatShading: false }));
    mast.position.y = h / 2 + 0.25;
    mast.castShadow = true;
    g.add(mast);
    makeBox(g, 3.4, 0.5, 1.4, 0, h + 0.4, 0, sm(0xfff7d6, { emissive: 0xfff7d6, emissiveIntensity: 1.0 }));
    boxes.push(addSolidBox(x - 0.4, x + 0.4, 0.25, h, z - 0.4, z + 0.4, 'apron_mast', false));
  } else if (row.kind === 'cones') {
    g.userData.studioName = 'Safety cones';
    const coneMat = sm(0xf97316, { emissive: 0xea580c, emissiveIntensity: 0.3 });
    const coneGeo = new THREE.ConeGeometry(0.32, 0.8, 8);
    for (const [ox, oz] of [[-16, -15], [16, -15], [-16, 15], [16, 15]]) {
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.set(ox, 0.65, oz);
      g.add(cone);
    }
  }
  return { object: g, boxes };
}

/** Jungle cliff + waterfall — publishes streetFX.waterfall. */
export function buildCliff(row, k) {
  const [x, z] = row.at;
  const base = row.baseY ?? 0;
  const w = row.w ?? 22, h = row.h ?? 14, d = row.d ?? 7;
  const g = new THREE.Group();
  g.position.set(x, base, z);
  g.userData.studioName = 'Jungle cliff';
  P(row, k).add(g);
  makeBox(g, w, h, d, 0, h / 2 - 0.5, 0,
    sm(0x475569, { texType: 'redrock', repeatX: 4, repeatY: 3, roughness: 0.92 }),
    { cast: true, recv: true });
  const box = addSolidBox(x - w / 2, x + w / 2, base, base + h - 0.5, z - d / 2, z + d / 2, 'jungle_cliff', false);
  let fallSheet = null, mistPool = null;
  if (row.waterfall) {
    fallSheet = makeBox(g, 8.5, 11.5, 0.35, 0, 5.75, d / 2 + 0.2,
      smBasic(0x5eead4, { transparent: true, opacity: 0.72 }), { recv: true });
    mistPool = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 7.5, 0.08, 20),
      smBasic(0xccfbf1, { transparent: true, opacity: 0.55 }));
    mistPool.position.set(0, 0.06, d / 2 + 4.5);
    g.add(mistPool);
    streetFX.waterfall = { fallSheet, mistPool };
  }
  return { object: g, boxes: [box], waterfall: streetFX.waterfall };
}

// -----------------------------------------------------------------------------
// Sledgehammer + dumpster (armory system consumes rec.data.hammer)
// -----------------------------------------------------------------------------
export function makeSledgehammer() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.86, 8),
    sm(0xb45309, { texType: 'wood', repeatX: 1, repeatY: 3 }));
  shaft.position.y = 0.30;
  shaft.castShadow = true;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 8), sm(0x1c1917, { roughness: 0.95 }));
  grip.position.y = -0.02;
  const head = makeBox(g, 0.30, 0.13, 0.13, 0, 0.74, 0,
    sm(0x94a3b8, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.28, flatShading: false }), { cast: true });
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.07, 10),
    sm(0xcbd5e1, { metalness: 0.95, roughness: 0.2 }));
  face.rotation.z = Math.PI / 2;
  face.position.set(0.18, 0.74, 0);
  const claw = makeBox(g, 0.14, 0.10, 0.05, -0.19, 0.74, 0,
    sm(0x64748b, { metalness: 0.9, roughness: 0.3 }), { rz: 0.35 });
  g.remove(head, claw);
  g.add(shaft, grip, head, face, claw);
  return g;
}

export function buildDumpster(row, k) {
  const [x, z] = row.at;
  const y = row.y ?? 0.24;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.userData.studioName = 'Armory dumpster';
  P(row, k).add(g);
  const body = sm(0x15803d, { texType: 'corrugated', repeatX: 4, repeatY: 2, metalness: 0.6, roughness: 0.55 });
  const dark = sm(0x14532d, { roughness: 0.7 });
  const shell = makeBox(g, 3.6, 1.5, 2.2, 0, 0.85, 0, body, { cast: true, recv: true });
  const inner = makeBox(g, 3.3, 1.2, 1.9, 0, 1.05, 0, sm(0x0a0f0a, { roughness: 1 }));
  const lid = makeBox(g, 3.7, 0.12, 2.3, 0, 1.68, -0.75, dark, { cast: true, rx: -0.85 });
  const wheelMat = sm(0x1c1917);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 8), wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(sx * 1.5, 0.16, sz * 0.85);
    g.add(wheel);
  }
  const bagMat = sm(0x1c1917, { roughness: 0.95 });
  for (let i = 0; i < 3; i++) {
    const bag = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34 + i * 0.05, 0), bagMat);
    bag.position.set(-0.9 + i * 0.85, 1.35, 0.15 * (i - 1));
    bag.scale.y = 0.8;
    g.add(bag);
  }
  neon(g, 'AURA DISPOSAL', 0, 0.95, 1.13, '#14532d', '#bbf7d0', 2.6, 0.5);
  let hammer = null;
  if (row.hammer) {
    hammer = makeSledgehammer();
    hammer.position.set(0.75, 1.30, 0.35);
    hammer.rotation.set(0.4, 0.6, 1.15);
    hammer.scale.setScalar(1.05);
    g.add(hammer);
  }
  g.remove(shell, inner, lid);
  g.add(shell, inner, lid);
  const box = addSolidBox(x - 1.8, x + 1.8, y, y + 1.51, z - 1.1, z + 1.1, 'dumpster', true);
  return { object: g, boxes: [box], hammer, at: [x, y, z] };
}

/** Santa Aura Ferris wheel — publishes streetFX.wheel (atmosphere spins it). */
export function buildFerrisWheel(row, k) {
  const [x, z] = row.at;
  const hubY = row.y ?? 14.5, r = row.r ?? 11.5, n = row.pods ?? 12;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.userData.studioName = 'Santa Aura Ferris wheel';
  P(row, k).add(g);
  const wheelGroup = new THREE.Group();
  wheelGroup.position.y = hubY;
  g.add(wheelGroup);
  const rimMat = smBasic(0xf43f5e);
  const rim1 = new THREE.Mesh(new THREE.TorusGeometry(r, 0.22, 10, 32), rimMat);
  rim1.position.z = -1.2;
  const rim2 = rim1.clone();
  rim2.position.z = 1.2;
  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(r * 0.62, 0.14, 8, 24), smBasic(0x38bdf8));
  wheelGroup.add(rim1, rim2, innerRing);
  const steel = sm(0xe2e8f0, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.18, flatShading: false });
  const gondola = sm(0xfacc15, { metalness: 0.4, roughness: 0.4 });
  const pods = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, r * 2, 6), steel);
    spoke.rotation.z = ang + Math.PI / 2;
    wheelGroup.add(spoke);
    const pod = makeBox(wheelGroup, 1.5, 1.3, 2.0,
      Math.cos(ang) * r, Math.sin(ang) * r, 0, gondola);
    pods.push(pod);
  }
  for (const lz of [-2.2, 2.2]) for (const dir of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 15.5, 8), steel);
    leg.position.set(dir * 3.8, 7.3, lz);
    leg.rotation.z = dir * 0.46;
    g.add(leg);
  }
  streetFX.wheel = { group: wheelGroup, pods, angle: 0 };
  return { object: g, wheel: streetFX.wheel };
}

/** Standalone fire-escape steps (apartment_block has its own inline copy). */
export function buildFireEscape(row, k) {
  const [x] = row.at || [0, 0];
  const fx = row.x ?? x;
  const g = new THREE.Group();
  g.userData.studioName = 'Fire escape';
  P(row, k).add(g);
  const steel = sm(0x94a3b8, { texType: 'diamondplate', repeatX: 2, repeatY: 3, metalness: 0.88, roughness: 0.28, bumpScale: 0.02 });
  const boxes = [];
  for (const st of row.steps || []) {
    makeBox(g, 2.2, 0.25, 3.4, fx, st.y, st.z, steel, { cast: true });
    boxes.push(addSolidBox(fx - 1.1, fx + 1.1, st.y - 0.15, st.y + 0.13, st.z - 1.7, st.z + 1.7, 'fire_escape', true));
  }
  return { object: g, boxes };
}

/** Alpine ice grid — pure gameplay zones, no geometry. */
export function buildIceZones(row) {
  const gr = row.grid;
  if (!gr) return null;
  const r = gr.r ?? 26;
  for (let z = gr.zs[0]; z <= gr.zs[1] + 0.001; z += gr.stepZ) {
    for (let x = gr.xs[0]; x <= gr.xs[1] + 0.001; x += gr.stepX) {
      iceZones.push({ x, z, r });
    }
  }
  return null;
}

// =============================================================================
// FX HANDLES / RESET / DISPOSAL
// =============================================================================
/** Stable exported object — worldRuntime nulls these keys on every rebuild. */
export const streetFX = { fire: null, waterfall: null, wheel: null };

/** Per-rebuild. lampPosts/iceZones are state-owned (resetWorldState clears them).
 *  Shared materials survive rebuilds; nothing else accumulates here. */
export function resetStreet() {
  streetFX.fire = null;
  streetFX.waterfall = null;
  streetFX.wheel = null;
}

/** Full teardown only (disposeWorld). Lazy getters re-create on next build. */
export function disposeStreet() {
  resetStreet();
  for (const m of ownedMats) {
    if (m.map && m.map.isCanvasTexture) m.map.dispose();
    m.dispose();
  }
  ownedMats.length = 0;
  matCache.clear();
  basicCache.clear();
  if (barkTex) { barkTex.dispose(); barkTex = null; }
  if (leafTex) { leafTex.dispose(); leafTex = null; }
  barkM = null;
  leafM = null;
}

// =============================================================================
// REGISTRY — worldRuntime spreads this into registerLegacyBuilders({...}).
// The five ADAPTED ids take legacy (x,z[,ry]) signatures; the rest take (row,ctx).
// =============================================================================
export const STREET_BUILDERS = {
  prop_lamppost: buildKnockableLamppost,
  prop_hydrant: createHydrant,
  prop_shelter: createBusShelter,
  prop_cart: buildPlazaHotdogCart,
  prop_fountain: buildFountain,
  prop_pier: buildPier,
  prop_lifeguard: buildLifeguard,
  prop_campfire: buildCampfire,
  prop_tent: buildTent,
  prop_sign_arch: buildSignArch,
  prop_gantry: buildGantryRow,
  prop_jet: buildParkedJet,
  prop_service: buildService,
  prop_cliff: buildCliff,
  prop_dumpster: buildDumpster,
  prop_ferris_wheel: buildFerrisWheel,
  prop_fire_escape: buildFireEscape,
  ice_zones: buildIceZones
};
export default STREET_BUILDERS;