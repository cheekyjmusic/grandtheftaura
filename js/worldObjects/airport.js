// =============================================================================
// worldObjects/airport.js — LAX TERMINAL, HORSESHOE LOOP & SHOPPING PAVILION
//
// ONE GROUP at (TX, Y, TZ). All geometry is LOCAL; colliders are offset back
// to world. Nothing extends west of x = -24 so the city road network and
// `rd/lax_curb` remain completely unobstructed, while the entire LAX
// horseshoe loop, 2-story central shopping pavilion, expanded Terminal 1,
// jet bridges, apron tarmac, and ATC tower sit cleanly on the airport side.
//
// PERF:
//   • Repetitive boxes batch through makeBoxBatcher() -> ONE InstancedMesh per
//     (parent, material, shadow-policy, renderOrder). Colliders are UNCHANGED.
//   • Small interior trim / steps / signs / props never cast shadows.
//   • Interior PointLights are NEVER toggled visible. Two persistent lights
//     live on the always-visible root group at intensity 0; worldSystems/
//     airport.js fades intensity by distance (no shader recompiles on approach).
//   • Departures board canvas is 256x160 and only re-uploads on text change.
//
// PUBLISHED for worldSystems/airport.js via getPlacement(id).data:
//   board    { canvas, tex, rows, draw() }   departures board, refreshable
//   carousel THREE.Group                     baggage claim, spins
//   lights   [{ light, x, z, r, base }]      persistent interior lights
// =============================================================================
import * as THREE from 'three';
import { aura, enterableZones, mapShapes } from '../state.js';
import { makeMat, worldRoot } from '../engine.js';
import { loadTexture } from '../assets.js';
import { UNIT_BOX, addSolidBox, flushInstances, makeBox, rngFor, xform } from '../worldKit.js';
import { neon } from './shell.js';

const ownedMats = [];
const own = (m) => { m.userData.shared = true; ownedMats.push(m); return m; };

/**
 * Static box batcher. Accumulates unit-box transforms keyed by
 * (parent, material, cast, recv, renderOrder) and flushes each bucket into a
 * single InstancedMesh. Geometry is identical to makeBox output; colliders
 * are NEVER created here — callers keep their explicit S(...) calls.
 */
function makeBoxBatcher() {
  const buckets = new Map();
  return {
    add(parent, w, h, d, x, y, z, mat, o = {}) {
      const cast = !!o.cast, recv = !!o.recv, order = o.order ?? 0;
      const key = parent.uuid + '|' + mat.uuid + '|' + (cast ? 1 : 0) + (recv ? 1 : 0) + '|' + order;
      let b = buckets.get(key);
      if (!b) {
        b = { parent, mat, cast, recv, order, name: o.name || null, t: [] };
        buckets.set(key, b);
      }
      if (!b.name && o.name) b.name = o.name;
      xform(b.t, x, y, z, w, h, d, o.rx || 0, o.ry || 0, o.rz || 0);
    },
    flush() {
      let meshes = 0, instances = 0;
      for (const b of buckets.values()) {
        const im = flushInstances(b.parent, UNIT_BOX, b.mat, b.t,
          { cast: b.cast, recv: b.recv, name: b.name });
        if (im) { im.renderOrder = b.order; meshes++; instances += b.t.length; }
      }
      buckets.clear();
      return { meshes, instances };
    }
  };
}

/** Barrel-vault surface in local space. Reused for shell + skylight. */
function archShell(halfSpan, length, baseY, rise, segX = 28, t0 = 0, t1 = 1) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= 1; j++) {
    const z = -length / 2 + j * length;
    for (let i = 0; i <= segX; i++) {
      const t = t0 + (t1 - t0) * (i / segX);
      pos.push(-halfSpan + t * 2 * halfSpan, baseY + rise * Math.sin(Math.PI * t), z);
      uv.push(t * 10, j * length / 12);
    }
  }
  for (let i = 0; i < segX; i++) {
    const a = i, b = i + 1, c = i + segX + 1, d = i + segX + 2;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Sealed half-moon gable wall closing the ends of a barrel-vault roof. */
function archGable(halfSpan, baseY, rise, segX = 28) {
  const pos = [], uv = [], idx = [];
  pos.push(0, baseY, 0);
  uv.push(0.5, 0);
  for (let i = 0; i <= segX; i++) {
    const t = i / segX;
    const x = -halfSpan + t * 2 * halfSpan;
    const y = baseY + rise * Math.sin(Math.PI * t);
    pos.push(x, y, 0);
    uv.push(t, Math.sin(Math.PI * t));
  }
  for (let i = 1; i <= segX; i++) {
    idx.push(0, i, i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Departures board — geometry module creates it, airport system refreshes it.
 *  256x160 canvas; tex.needsUpdate fires ONLY when displayed text changes. */
export function makeDeparturesBoard(cfg = {}, seed = 'lax/board') {
  const rng = rngFor(seed);
  const dests = cfg.dests || ['SUNNYVALE', 'AURA HILLS', 'REDROCK', 'FROSTPINE', 'PALM BAY', 'WESTPORT'];
  const statuses = cfg.statuses || ['ON TIME', 'BOARDING', 'DELAYED'];
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 160;
  const rows = [];
  for (let i = 0; i < (cfg.boardRows ?? 7); i++) {
    const hh = 9 + Math.floor(rng() * 12), mm = Math.floor(rng() * 6) * 10;
    rows.push({
      code: `AU ${100 + Math.floor(rng() * 800)}`,
      dest: dests[i % dests.length],
      time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
      status: statuses[Math.floor(rng() * statuses.length)]
    });
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  let lastSig = '';
  const draw = (force = false) => {
    const sig = rows.map((r) => `${r.code}|${r.dest}|${r.time}|${r.status}`).join(';');
    if (!force && sig === lastSig) return false;
    lastSig = sig;
    const c = canvas.getContext('2d');
    c.fillStyle = '#05070d'; c.fillRect(0, 0, 256, 160);
    c.textAlign = 'left';
    c.fillStyle = '#facc15'; c.font = 'bold 15px Oswald, sans-serif';
    c.fillText('DEPARTURES  •  TERMINAL 1', 9, 19);
    c.fillStyle = '#38bdf8'; c.font = 'bold 8.5px Oswald, sans-serif';
    c.fillText('FLIGHT', 9, 34); c.fillText('DESTINATION', 60, 34);
    c.fillText('TIME', 165, 34); c.fillText('STATUS', 205, 34);
    c.strokeStyle = '#1e3a5f'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(7, 39); c.lineTo(249, 39); c.stroke();
    c.font = '9px Oswald, sans-serif';
    rows.forEach((r, i) => {
      const y = 53 + i * 15;
      c.fillStyle = '#e2e8f0';
      c.fillText(r.code, 9, y); c.fillText(r.dest, 60, y); c.fillText(r.time, 165, y);
      c.fillStyle = r.status === 'DELAYED' ? '#f87171'
        : (r.status === 'BOARDING' || r.status === 'FINAL CALL' ? '#4ade80' : '#facc15');
      c.fillText(r.status, 205, y);
    });
    tex.needsUpdate = true;
    return true;
  };
  draw(true);
  return { canvas, tex, rows, draw, statuses };
}

// =============================================================================
export function buildAirportTerminal(row) {
  const TX = row.at[0], TZ = row.at[1];
  const Y = row.baseY ?? 0.30;

  // Spatial layout (West -> East, starting at x = -24 so city roads stay untouched):
  //   x = -24.0 .. -8.0   : LAX Horseshoe West Entry/Exit Boulevard (connects to rd/lax_curb)
  //   x = -5.0  .. +29.0  : 2-Story LAX Central Shopping & Dining Pavilion (34m × 192m)
  //   x = +33.0 .. +60.0  : Terminal 1 Arrivals & Departures Curbside Loop + Light Pylons
  //   x = +60.0 .. +120.0 : Expanded Main Terminal 1 (60m × 264m)
  //   x = +120.0 .. +192.0: Gate Pods, Jet Bridges, Apron & ATC Tower
  const T1_W_X = 60.0;
  const T1_E_X = 120.0;
  const T1_W   = T1_E_X - T1_W_X;       // 60.0 m
  const T1_CX  = (T1_W_X + T1_E_X) / 2; // +90.0 m
  const HL     = row.halfL ?? 132.0;    // 264.0 m total length
  const WALL_H = row.wallH ?? 16.0;
  const RISE   = row.rise ?? 7.6;
  const MEZZ   = 6.20;                  // Matches 2nd-floor shopping pavilion & skybridges
  const TOP    = WALL_H;
  const DECK   = 2.25;                  // Boarding-bridge deck height

  const L = (absZ) => absZ - TZ;
  const doors    = (row.doors || [TZ - 82, TZ, TZ + 82]).map(L);
  const gates    = (row.gates || [
    { z: TZ - 90, n: 1 },
    { z: TZ - 30, n: 2 },
    { z: TZ + 30, n: 3 },
    { z: TZ + 90, n: 4 }
  ]).map((gt) => ({ z: L(gt.z), n: gt.n }));
  const checkin  = (row.checkin || [TZ - 96, TZ - 64, TZ - 32, TZ + 32, TZ + 64, TZ + 96]).map(L);
  const security = (row.security || [TZ - 24, TZ - 12, TZ, TZ + 12, TZ + 24]).map(L);

  const g = new THREE.Group();
  g.position.set(TX, Y, TZ);
  g.userData.studioName = row.name || 'LAX Terminal 1 & Central Pavilion';
  worldRoot.add(g);

  const boxes = [];
  const batcher = makeBoxBatcher();
  // IB = instanced box. Multi-material arrays (sign/board faces) fall back to
  // a real mesh, since InstancedMesh cannot take a material array.
  const IB = (p, w, h, d, x, y, z, m, o = {}) =>
    Array.isArray(m) ? makeBox(p, w, h, d, x, y, z, m, o) : batcher.add(p, w, h, d, x, y, z, m, o);
  const S = (x0, x1, y0, y1, z0, z1, tag, climb) => boxes.push(addSolidBox(
    TX + x0, TX + x1, Y + y0, Y + y1, TZ + z0, TZ + z1, tag, climb));

  // --- Materials -----------------------------------------------------------
  const shellMat    = own(makeMat(0xeef4f8, { texType: 'brushedsteel', repeatX: 12, repeatY: 36, metalness: 0.72, roughness: 0.26, flatShading: false }));
  const ribMat      = own(makeMat(0xcbd5e1, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.2, flatShading: false }));
  const mullion     = own(makeMat(0x475569, { metalness: 0.8, roughness: 0.35 }));
  const curtain     = own(makeMat(0x9fd8f5, { metalness: 0.85, roughness: 0.06, transparent: true, opacity: 0.24, emissive: 0x0ea5e9, emissiveIntensity: 0.20, flatShading: false }));
  curtain.side = THREE.DoubleSide; curtain.depthWrite = false;
  const floorMat    = own(makeMat(0xf1f5f9, { texType: 'marble', repeatX: 16, repeatY: 64, roughness: 0.16, clearcoat: 0.85, flatShading: false }));
  const darkMarble  = own(makeMat(0x1e293b, { texType: 'marble', repeatX: 12, repeatY: 48, roughness: 0.18, clearcoat: 0.85 }));
  const white       = own(makeMat(0xf8fafc, { roughness: 0.55 }));
  const deskMat     = own(makeMat(0x1e293b, { metalness: 0.4, roughness: 0.4 }));
  const topMat      = own(makeMat(0xe2e8f0, { texType: 'brushedsteel', metalness: 0.9, roughness: 0.2, flatShading: false }));
  const seatMat     = own(makeMat(0x2563eb, { texType: 'fabric', roughness: 0.9 }));
  const beltMat     = own(makeMat(0x334155, { metalness: 0.6, roughness: 0.5 }));
  const woodMat     = own(makeMat(0x8a5a2b, { texType: 'wood', repeatX: 4, repeatY: 4, roughness: 0.55 }));
  const glowMat     = own(makeMat(0xfff7d6, { emissive: 0xfff7d6, emissiveIntensity: 1.2 }));
  const cyanGlow    = own(makeMat(0x38bdf8, { emissive: 0x0ea5e9, emissiveIntensity: 1.2, roughness: 0.2 }));
  const brandMat    = own(makeMat(0x0284c7, { emissive: 0x0369a1, emissiveIntensity: 0.45, metalness: 0.6, roughness: 0.3 }));
  const asphaltMat  = own(makeMat(0x2d3542, { texType: 'asphalt', repeatX: 4, repeatY: 32, roughness: 0.88 }));
  const apronMat    = own(makeMat(0x475569, { texType: 'concrete', repeatX: 18, repeatY: 64, roughness: 0.85 }));
  const sidewalkMat = own(makeMat(0xcbd5e1, { texType: 'sidewalk', repeatX: 8, repeatY: 40, roughness: 0.85 }));
  const rubberMat   = own(makeMat(0x111827, { roughness: 0.85 }));
  const paintYellow = own(new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
  const paintWhite  = own(new THREE.MeshBasicMaterial({ color: 0xf8fafc }));
  const foliageTex  = loadTexture('assets/textures/lushfoliage.png', { repeatX: 2, repeatY: 2 });
  foliageTex.wrapS  = foliageTex.wrapT = THREE.RepeatWrapping;
  foliageTex.colorSpace = THREE.SRGBColorSpace;
  const foliageMat  = own(new THREE.MeshStandardMaterial({
    map: foliageTex,
    roughness: 0.88,
    alphaTest: 0.35,
    side: THREE.DoubleSide
  }));
  const barkMat     = own(makeMat(0x78350f, { roughness: 0.92 }));

  // =========================================================================
  // 1. LAX HORSESHOE LOOP ROAD ("WORLD WAY") & ILLUMINATED PYLONS
  // =========================================================================
  const roadMarkT = [], zebraT = [];

  // West Entry/Exit Boulevard (x = -24..-8)
  IB(g, 16.0, 0.04, 312.0, -16.0, -0.02, 0, asphaltMat, { recv: true, name: 'LAX World Way West' });
  S(-24.0, -8.0, -0.20, 0.0, -156.0, 156.0, 'lax_loop_road', true);
  xform(roadMarkT, -16.18, 0.005, 0, 0.16, 0.01, 308.0);
  xform(roadMarkT, -15.82, 0.005, 0, 0.16, 0.01, 308.0);
  for (let z = -150; z <= 150; z += 6) {
    xform(roadMarkT, -20.0, 0.005, z, 0.18, 0.01, 2.8);
    xform(roadMarkT, -12.0, 0.005, z, 0.18, 0.01, 2.8);
  }
  // West Entry Aprons linking rd/lax_curb directly into the LAX Horseshoe Loop
  for (const az of [-148.0, 0.0, 148.0]) {
    IB(g, 3.0, 0.04, 18.0, -25.5, -0.02, az, asphaltMat, { recv: true });
    S(-27.0, -24.0, -0.20, 0.0, az - 9.0, az + 9.0, 'lax_loop_road', true);
  }

  // North & South Horseshoe Cross-Loops (x = -24..+60)
  for (const lz of [-148.0, 148.0]) {
    IB(g, 84.0, 0.04, 16.0, 18.0, -0.02, lz, asphaltMat, { recv: true, name: 'LAX Horseshoe Turn' });
    S(-24.0, 60.0, -0.20, 0.0, lz - 8.0, lz + 8.0, 'lax_loop_road', true);
    xform(roadMarkT, 18.0, 0.005, lz - 0.18, 82.0, 0.01, 0.16);
    xform(roadMarkT, 18.0, 0.005, lz + 0.18, 82.0, 0.01, 0.16);
    for (let x = -20; x <= 56; x += 6) {
      xform(roadMarkT, x, 0.005, lz - 4.0, 2.8, 0.01, 0.18);
      xform(roadMarkT, x, 0.005, lz + 4.0, 2.8, 0.01, 0.18);
    }
    const outerSideZ = lz < 0 ? lz - 9.5 : lz + 9.5;
    IB(g, 88.0, 0.20, 3.0, 18.0, 0.10, outerSideZ, sidewalkMat, { recv: true });
    S(-26.0, 62.0, 0, 0.20, outerSideZ - 1.5, outerSideZ + 1.5, 'lax_sidewalk', true);
  }

  // Inner Arrivals / Shuttle Lane (x = +33..+41)
  IB(g, 8.0, 0.04, 280.0, 37.0, -0.02, 0, asphaltMat, { recv: true, name: 'LAX Inner Arrivals Lane' });
  S(33.0, 41.0, -0.20, 0.0, -140.0, 140.0, 'lax_loop_road', true);
  for (let z = -136; z <= 136; z += 6) xform(roadMarkT, 37.0, 0.005, z, 0.18, 0.01, 2.8);

  // Raised Landscaped Median (x = +41..+44) separating Arrivals & Departures Curb Lanes
  IB(g, 3.0, 0.22, 272.0, 42.5, 0.11, 0, sidewalkMat, { recv: true });
  S(41.0, 44.0, 0, 0.22, -136.0, 136.0, 'lax_median', true);

  // Outer Departures Pickup/Dropoff Curb Roadway (x = +44..+60)
  IB(g, 16.0, 0.04, 280.0, 52.0, -0.02, 0, asphaltMat, { recv: true, name: 'LAX Departures Curb' });
  S(44.0, 60.0, -0.20, 0.0, -140.0, 140.0, 'lax_loop_road', true);
  for (let z = -136; z <= 136; z += 6) {
    xform(roadMarkT, 48.0, 0.005, z, 0.18, 0.01, 2.8);
    xform(roadMarkT, 52.0, 0.005, z, 0.18, 0.01, 2.8);
  }
  xform(roadMarkT, 59.5, 0.01, 0, 0.7, 0.02, 260.0);

  // Sidewalks framing the Central Pavilion Island & North/South Plaza Gardens
  IB(g, 3.0, 0.20, 280.0, -6.5, 0.10, 0, sidewalkMat, { recv: true });
  S(-8.0, -5.0, 0, 0.20, -140.0, 140.0, 'lax_sidewalk', true);
  IB(g, 4.0, 0.20, 280.0, 31.0, 0.10, 0, sidewalkMat, { recv: true });
  S(29.0, 33.0, 0, 0.20, -140.0, 140.0, 'lax_sidewalk', true);
  for (const pz of [-118.0, 118.0]) {
    IB(g, 34.0, 0.22, 44.0, 12.0, 0.11, pz, sidewalkMat, { recv: true });
    S(-5.0, 29.0, 0, 0.22, pz - 22.0, pz + 22.0, 'lax_plaza', true);
  }

  // Pedestrian Zebra Crosswalks connecting Pavilion to Terminal 1
  for (const cz of [-82.0, -48.0, 0.0, 48.0, 82.0]) {
    for (let x = 33.5; x <= 59.5; x += 1.4) {
      xform(zebraT, x, 0.01, cz, 0.75, 0.01, 3.2);
    }
  }
  flushInstances(g, UNIT_BOX, paintYellow, roadMarkT);
  flushInstances(g, UNIT_BOX, paintWhite, zebraT);

  // Overhead Highway Sign Gantries spanning the Horseshoe Loop
  for (const [gz, label] of [
    [-148.0, 'TERMINAL 1  •  DEPARTURES / ARRIVALS  →'],
    [148.0,  '←  CENTRAL SHOPS  •  EXIT TO CITY']
  ]) {
    for (const sz of [-8.8, 8.8]) {
      IB(g, 0.45, 7.2, 0.45, 16.0, 3.6, gz + sz, ribMat, { cast: true });
    }
    IB(g, 0.55, 0.55, 18.2, 16.0, 7.1, gz, ribMat, { cast: true });
    neon(g, label, 16.0, 7.8, gz, '#065f46', '#f8fafc', 15.0, 1.3, { ry: Math.PI / 2 });
  }

  // Iconic LAX Color-Glowing Glass Light Pylons along the Median & Entrance
  const pylonColors = [0x38bdf8, 0xa855f7, 0xfacc15, 0x22c55e, 0xf43f5e, 0x06b6d4];
  const pylonMats = pylonColors.map((hex) => own(makeMat(hex, {
    emissive: hex, emissiveIntensity: 1.15, transparent: true, opacity: 0.82, roughness: 0.12
  })));
  let pylonIdx = 0;
  for (let z = -128; z <= 128; z += 24) {
    const pMat = pylonMats[pylonIdx++ % pylonMats.length];
    IB(g, 1.2, 0.8, 1.2, 42.5, 0.62, z, ribMat);
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.58, 10.5, 12), pMat);
    pylon.position.set(42.5, 6.25, z);
    g.add(pylon);
    S(41.9, 43.1, 0.22, 11.5, z - 0.6, z + 0.6, 'lax_pylon', false);
  }

  // Palm Trees along the Horseshoe Boulevards
  const palmTrunkT = [], palmCrownT = [];
  for (let z = -120; z <= 120; z += 24) {
    for (const px of [-6.5, 31.0]) {
      xform(palmTrunkT, px, 4.5, z, 0.42, 9.0, 0.42);
      xform(palmCrownT, px, 9.2, z, 3.2, 1.6, 3.2);
    }
  }
  flushInstances(g, new THREE.CylinderGeometry(0.35, 0.5, 1, 8), barkMat, palmTrunkT, { cast: true });
  flushInstances(g, new THREE.DodecahedronGeometry(0.5, 0), foliageMat, palmCrownT, { cast: true });

  // =========================================================================
  // 2. MAIN TERMINAL 1 — EXPANDED BARREL-VAULT BUILDING (60m × 264m)
  // =========================================================================
  IB(g, T1_W + 2.4, 0.30, 2 * HL + 2.4, T1_CX, -0.15, 0,
    own(makeMat(0xcbd5e1, { texType: 'concrete', repeatX: 14, repeatY: 64 })), { recv: true });
  IB(g, T1_W, 0.10, 2 * HL, T1_CX, 0.05, 0, floorMat, { recv: true, name: 'Terminal 1 floor' });
  S(T1_W_X, T1_E_X, -0.30, 0.10, -HL, HL, 'terminal_floor', true);
  for (const bx of [70, 90, 110]) IB(g, 0.55, 0.02, 2 * HL - 6, bx, 0.11, 0, brandMat);

  // Barrel Vault Roof + Ribs + Skylight + Sealed End Gables
  const halfSpan = T1_W / 2 + 1.2; // 31.2 m
  const shell = new THREE.Mesh(archShell(halfSpan, 2 * HL + 2.4, TOP, RISE), shellMat);
  shell.position.x = T1_CX;
  shell.castShadow = shell.receiveShadow = true;
  shell.material.side = THREE.DoubleSide;
  shell.userData.studioName = 'Terminal vault roof';
  g.add(shell);

  for (const ez of [-1, 1]) {
    const gable = new THREE.Mesh(archGable(T1_W / 2, TOP, RISE), white);
    gable.position.set(T1_CX, 0, ez * HL);
    gable.material.side = THREE.DoubleSide;
    gable.castShadow = gable.receiveShadow = true;
    g.add(gable);
    const gableGlass = new THREE.Mesh(archGable(T1_W / 2 - 2.0, TOP + 0.4, RISE - 0.6), curtain);
    gableGlass.position.set(T1_CX, 0, ez * (HL + 0.28));
    gableGlass.renderOrder = 3;
    g.add(gableGlass);
  }

  const ribPts = [];
  for (let i = 0; i <= 26; i++) {
    const t = i / 26;
    ribPts.push(new THREE.Vector3(-halfSpan + t * 2 * halfSpan, TOP + RISE * Math.sin(Math.PI * t) - 0.36, 0));
  }
  const ribGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ribPts), 28, 0.32, 6, false);
  const ribT = [];
  for (let z = -HL - 1; z <= HL + 1; z += 12.0) xform(ribT, T1_CX, 0, z);
  flushInstances(g, ribGeo, ribMat, ribT, { cast: true });

  const sky = new THREE.Mesh(archShell(halfSpan, 2 * HL - 4, TOP, RISE, 12, 0.38, 0.62),
    own(makeMat(0xdff3ff, { emissive: 0xbfe6ff, emissiveIntensity: 0.55, transparent: true, opacity: 0.55, roughness: 0.1 })));
  sky.material.side = THREE.DoubleSide;
  sky.position.set(T1_CX, 0.14, 0);
  g.add(sky);

  for (const sx of [T1_W_X - 1.2, T1_E_X + 1.2]) {
    IB(g, 0.6, 0.95, 2 * HL + 2.4, sx, TOP + 0.1, 0, brandMat);
  }
  S(T1_W_X - 1.2, T1_E_X + 1.2, TOP, TOP + RISE + 0.4, -HL - 1.2, HL + 1.2, 'terminal_roof', true);

  // Structural Interior Columns
  const colT = [];
  for (let z = -HL + 8; z <= HL - 8; z += 18) {
    for (const sx of [T1_W_X + 1.4, 86.0, T1_E_X - 1.4]) {
      xform(colT, sx, WALL_H / 2, z, 0.9, WALL_H, 0.9);
    }
  }
  flushInstances(g, UNIT_BOX, ribMat, colT, { cast: true, recv: true });

  // Curtain Walls (with openings for Portals, Skybridges & Gate Hold-Rooms)
  const wallRun = (lx, a, b, outward) => {
    if (b - a < 0.4) return;
    IB(g, 0.5, WALL_H, b - a, lx, WALL_H / 2, (a + b) / 2, white);
    S(lx - 0.25, lx + 0.25, 0, TOP, a, b, 'terminal_wall', false);
    IB(g, 0.16, WALL_H - 1.2, b - a - 0.6, lx + outward * 0.30, WALL_H / 2, (a + b) / 2, curtain,
      { order: 3, name: 'Curtain wall' });
    const mT = [];
    for (let z = a + 1.2; z < b - 0.6; z += 2.4) xform(mT, lx + outward * 0.36, WALL_H / 2, z, 0.16, WALL_H - 1.2, 0.16);
    for (const hy of [3.8, 7.6, 11.4]) xform(mT, lx + outward * 0.36, hy, (a + b) / 2, 0.16, 0.16, b - a - 0.6);
    flushInstances(g, UNIT_BOX, mullion, mT);
  };

  // Landside (West wall at T1_W_X = +60.0): 3 Entrance Portals + 2 Upper Skybridge Portals
  {
    const openings = [
      { z0: doors[0] - 4.5, z1: doors[0] + 4.5, type: 'door', z: doors[0] },
      { z0: -50.4,          z1: -45.6,          type: 'bridge', z: -48.0 },
      { z0: doors[1] - 4.5, z1: doors[1] + 4.5, type: 'door', z: doors[1] },
      { z0: 45.6,           z1: 50.4,           type: 'bridge', z: 48.0 },
      { z0: doors[2] - 4.5, z1: doors[2] + 4.5, type: 'door', z: doors[2] }
    ];
    let cursor = -HL;
    for (const op of openings) {
      wallRun(T1_W_X, cursor, op.z0, -1);
      if (op.type === 'door') {
        const dz = op.z;
        IB(g, 0.5, WALL_H - 4.8, 9.0, T1_W_X, 4.8 + (WALL_H - 4.8) / 2, dz, white);
        S(T1_W_X - 0.25, T1_W_X + 0.25, 4.8, WALL_H, dz - 4.5, dz + 4.5, 'terminal_wall', false);
        IB(g, 0.9, 0.36, 9.6, T1_W_X - 0.2, 4.8, dz, ribMat);
        for (const s of [-1, 1]) IB(g, 0.22, 4.6, 0.32, T1_W_X - 0.2, 2.3, dz + s * 4.5, ribMat);
        neon(g, dz === doors[1] ? 'DEPARTURES  •  TERMINAL 1' : 'ENTRANCE',
          T1_W_X - 0.62, 5.7, dz, '#090d14', dz === doors[1] ? '#facc15' : '#38bdf8',
          dz === doors[1] ? 9.6 : 4.8, 0.9);
      } else {
        const bz = op.z;
        IB(g, 0.5, MEZZ, 4.8, T1_W_X, MEZZ / 2, bz, white);
        S(T1_W_X - 0.25, T1_W_X + 0.25, 0, MEZZ, bz - 2.4, bz + 2.4, 'terminal_wall', false);
        IB(g, 0.5, WALL_H - (MEZZ + 3.6), 4.8, T1_W_X, MEZZ + 3.6 + (WALL_H - (MEZZ + 3.6)) / 2, bz, white);
        S(T1_W_X - 0.25, T1_W_X + 0.25, MEZZ + 3.6, WALL_H, bz - 2.4, bz + 2.4, 'terminal_wall', false);
      }
      cursor = op.z1;
    }
    wallRun(T1_W_X, cursor, HL, -1);
  }

  // Airside (East wall at T1_E_X = +120.0): Openings at the 4 Gate Pods
  {
    let cursor = -HL;
    for (const gt of gates) {
      wallRun(T1_E_X, cursor, gt.z - 8.5, 1);
      IB(g, 0.5, WALL_H - 8.2, 17.0, T1_E_X, 8.2 + (WALL_H - 8.2) / 2, gt.z, white);
      S(T1_E_X - 0.25, T1_E_X + 0.25, 8.2, WALL_H, gt.z - 8.5, gt.z + 8.5, 'terminal_wall', false);
      cursor = gt.z + 8.5;
    }
    wallRun(T1_E_X, cursor, HL, 1);
  }

  // North & South End Walls
  for (const ez of [-1, 1]) {
    const wz = ez * HL;
    IB(g, T1_W, WALL_H, 0.5, T1_CX, WALL_H / 2, wz, white);
    S(T1_W_X, T1_E_X, 0, TOP, wz - 0.25, wz + 0.25, 'terminal_wall', false);
    IB(g, T1_W - 6, 6.0, 0.2, T1_CX, 8.5, wz + ez * 0.32, curtain, { order: 3 });
  }

  // Curbside Departures Canopy over Departures Curb (clears skybridges at z = ±48)
  for (const [z0, z1] of [[-126, -51.5], [-44.5, 44.5], [51.5, 126]]) {
    const len = z1 - z0, cz = (z0 + z1) / 2;
    IB(g, 16.5, 0.52, len, T1_W_X - 8.25, 7.25, cz, shellMat, { cast: true, recv: true, name: 'Departures canopy' });
    IB(g, 16.9, 0.34, len + 0.4, T1_W_X - 8.25, 6.92, cz, brandMat);
    S(T1_W_X - 16.5, T1_W_X, 6.90, 7.52, z0, z1, 'curb_canopy', true);
  }
  for (let z = -120; z <= 120; z += 24) {
    if (Math.abs(Math.abs(z) - 48) < 4) continue;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 7.0, 10), ribMat);
    c.position.set(T1_W_X - 16.2, 3.4, z); c.castShadow = true; g.add(c);
    S(T1_W_X - 16.7, T1_W_X - 15.7, 0.20, 6.90, z - 0.5, z + 0.5, 'canopy_column', false);
  }
  neon(g, 'LOS AURA INTERNATIONAL  •  LAX', T1_W_X - 16.8, 9.2, 0, '#090d14', '#facc15', 26.0, 2.2);
  neon(g, 'TERMINAL 1  •  DEPARTURES & GATES 1–4', T1_W_X - 16.8, 6.4, 0, '#0b1220', '#38bdf8', 20.0, 1.1);

  // =========================================================================
  // TERMINAL 1 INTERIOR (distance-culled)
  // =========================================================================
  const inn = new THREE.Group();
  inn.userData.studioName = 'LAX terminal interior';
  g.add(inn);
  const I = (w, h, d, x, y, z, m, o) => IB(inn, w, h, d, x, y, z, m, o);

  // Check-in Islands (6 islands along x = +75.0) — props, no shadow casting
  const screenT = [], beltT = [];
  checkin.forEach((cz, i) => {
    I(5.0, 1.15, 16.0, 75.0, 0.575, cz, deskMat);
    I(5.3, 0.12, 16.3, 75.0, 1.21, cz, topMat);
    I(0.6, 1.9, 16.0, 77.8, 2.1, cz, deskMat);
    S(72.5, 77.5, 0, 1.27, cz - 8, cz + 8, 'checkin_counter', true);
    for (let k = -3; k <= 3; k++) {
      xform(screenT, 77.4, 2.35, cz + k * 2.2, 0.12, 0.85, 1.5);
      xform(beltT, 71.4, 0.42, cz + k * 2.2, 1.6, 0.5, 1.7);
    }
    I(6.0, 0.12, 1.2, 75.0, 3.6, cz, brandMat);
    neon(inn, `CHECK-IN ${cz < 0 ? 'A' : 'B'}${i + 1}`, 75.0, 3.05, cz, '#0b1220', '#38bdf8', 4.6, 0.62);
  });
  flushInstances(inn, UNIT_BOX, own(makeMat(0x22d3ee, { emissive: 0x0891b2, emissiveIntensity: 0.8 })), screenT);
  flushInstances(inn, UNIT_BOX, beltMat, beltT, { recv: true });
  neon(inn, 'CHECK-IN  •  DESKS 1–42', 75.0, 5.6, 0, '#0b1220', '#38bdf8', 13.0, 1.0);

  // Hanging Departures Boards (multi-material faces stay real meshes)
  const board = makeDeparturesBoard(row.flights || {}, row.id);
  const boardMat = own(new THREE.MeshStandardMaterial({
    map: board.tex, emissiveMap: board.tex, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.3
  }));
  const faces = [boardMat, boardMat, deskMat, deskMat, deskMat, deskMat];
  I(0.5, 10.0, 16.0, 82.0, 9.8, 0, faces, { name: 'Departures board' });
  I(0.5, 7.5, 12.0, 96.0, 8.8, 0, faces);
  for (const bx of [82.0, 96.0]) {
    for (const s of [-1, 1]) I(0.16, 9.0, 0.16, bx, 18.0, s * 5.5, ribMat);
  }

  // Security Checkpoint (5 lanes along x = +88.0 with zig-zag stanchions)
  const secLo = security[0] - 6, secHi = security[security.length - 1] + 6;
  for (const [a, b] of [[-HL + 0.5, secLo], [secHi, HL - 0.5]]) {
    I(0.6, 6.2, b - a, 88.0, 3.1, (a + b) / 2, own(makeMat(0xe2e8f0, { texType: 'siding', repeatX: 2, repeatY: 24 })));
    S(87.7, 88.3, 0, 6.2, a, b, 'security_divider', false);
    I(0.2, 3.6, b - a - 1, 88.35, 4.1, (a + b) / 2, curtain, { order: 3 });
  }
  const stanchT = [];
  for (const lz of security) {
    for (const sx of [-1, 1]) {
      I(0.45, 3.0, 4.4, 88.0 + sx * 2.0, 1.5, lz, ribMat);
      S(88.0 + sx * 2.0 - 0.23, 88.0 + sx * 2.0 + 0.23, 0, 3.0, lz - 2.2, lz + 2.2, 'security_arch', false);
    }
    I(4.6, 0.35, 4.4, 88.0, 3.15, lz, ribMat);
    I(1.9, 0.85, 6.0, 85.0, 0.43, lz, beltMat);
    I(2.2, 1.35, 2.4, 85.0, 1.35, lz + 1.9, deskMat);
    S(84.0, 86.0, 0, 0.86, lz - 3, lz + 3, 'security_belt', true);
    const binT = [];
    for (let i = 0; i < 3; i++) xform(binT, 84.2, 0.95, lz - 2.2 + i * 0.8, 1.3, 0.22, 0.6);
    flushInstances(inn, UNIT_BOX, own(makeMat(0x64748b, { roughness: 0.7 })), binT);

    for (let qx = 79.8; qx <= 83.0; qx += 1.6) {
      xform(stanchT, qx, 0.5, lz + 6.0, 0.1, 1.0, 0.1);
    }
  }
  flushInstances(inn, UNIT_BOX, ribMat, stanchT);
  neon(inn, 'SECURITY CHECKPOINT  →  GATES 1–4', 88.0, 5.6, secLo - 2, '#065f46', '#f8fafc', 12.0, 0.9);

  // Public Sky Deck Mezzanine (y = MEZZ = 6.20, flush with West wall for Skybridges)
  const mz = HL - 10;
  I(14.0, 0.30, mz * 2, T1_W_X + 7.25, MEZZ - 0.15, 0, floorMat, { recv: true });
  S(T1_W_X + 0.25, T1_W_X + 14.25, MEZZ - 0.30, MEZZ, -mz, mz, 'mezzanine_deck', true);

  for (const [a, b] of [[-mz, -46], [-34, 34], [46, mz]]) {
    I(0.16, 1.15, b - a, T1_W_X + 14.15, MEZZ + 0.575, (a + b) / 2, ribMat);
    I(0.10, 0.95, b - a - 0.4, T1_W_X + 14.15, MEZZ + 0.55, (a + b) / 2, curtain, { order: 3 });
    S(T1_W_X + 14.0, T1_W_X + 14.25, MEZZ, MEZZ + 1.15, a, b, 'mezz_rail', true);
  }
  const stairMat = own(makeMat(0xd8dee6, { texType: 'concrete', repeatX: 2, repeatY: 1 }));
  for (const dir of [-1, 1]) {
    for (let i = 0; i < 16; i++) {
      const sy = 0.10 + i * 0.38125;
      const sz = dir * (45.5 - i * 0.65);
      I(4.4, 0.38125, 0.65, T1_W_X + 11.0, sy + 0.1906, sz, stairMat, { recv: true });
      S(T1_W_X + 8.8, T1_W_X + 13.2, sy, sy + 0.38125, sz - 0.325, sz + 0.325, 'mezz_stair', true);
    }
  }
  for (const tz of [-92, -72, -22, 22, 72, 92]) {
    I(1.6, 0.08, 1.6, T1_W_X + 6.5, MEZZ + 0.78, tz, woodMat);
    I(0.16, 0.74, 0.16, T1_W_X + 6.5, MEZZ + 0.37, tz, ribMat);
    for (const s of [-1, 1]) {
      I(0.9, 0.45, 0.9, T1_W_X + 6.5 + s * 1.7, MEZZ + 0.23, tz, seatMat);
      I(0.9, 0.55, 0.16, T1_W_X + 6.5 + s * 1.7, MEZZ + 0.72, tz + 0.4, seatMat);
    }
  }
  I(3.0, 1.1, 14.0, T1_W_X + 3.0, MEZZ + 0.55, 0, woodMat);
  I(3.3, 0.12, 14.3, T1_W_X + 3.0, MEZZ + 1.16, 0, topMat);
  S(T1_W_X + 1.5, T1_W_X + 4.5, MEZZ, MEZZ + 1.22, -7, 7, 'mezz_bar', true);
  neon(inn, 'SKY DECK  •  BAR & GRILL  •  SKYBRIDGES', T1_W_X + 7.5, MEZZ + 3.2, 0, '#1c1917', '#fcd34d', 12.0, 0.85);

  // Airside Retail + Food Court + Gate Hold Lounges
  I(10.0, 3.4, 15.0, 99.0, 1.7, -108, own(makeMat(0x7f1d1d, { texType: 'wood', repeatX: 3, repeatY: 2 })));
  I(10.4, 0.25, 15.4, 99.0, 3.5, -108, topMat);
  S(94.0, 104.0, 0, 3.4, -115.5, -100.5, 'duty_free', false);
  neon(inn, 'DUTY FREE', 99.0, 4.4, -115.8, '#0b1220', '#facc15', 7.5, 0.85);

  I(3.6, 1.1, 3.6, 99.0, 0.55, 108, woodMat);
  I(4.0, 0.2, 4.0, 99.0, 1.2, 108, topMat);
  S(97.2, 100.8, 0, 1.3, 106.2, 109.8, 'cafe_kiosk', true);
  neon(inn, 'SKY BEANS COFFEE', 99.0, 2.7, 106.0, '#1c1917', '#fcd34d', 5.2, 0.7);

  for (const tz of [-60, 0, 60]) {
    for (const dz of [-6, 6]) {
      I(1.5, 0.08, 1.5, 98.0, 0.76, tz + dz, woodMat);
      I(0.16, 0.72, 0.16, 98.0, 0.36, tz + dz, ribMat);
      for (const s of [-1, 1]) I(0.85, 0.45, 0.85, 98.0, 0.23, tz + dz + s * 1.6, seatMat);
    }
  }
  const loungeT = [], backT = [];
  for (const gz of [-96, -36, 24, 84]) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
      xform(loungeT, 109.0, 0.45, gz + r * 3.0 + c * 1.05, 3.4, 0.42, 0.9);
      xform(backT, 109.0, 0.85, gz + r * 3.0 + c * 1.05 + 0.45, 3.4, 0.7, 0.18);
    }
    S(107.3, 110.7, 0, 0.7, gz - 0.5, gz + 10.0, 'gate_seat', true);
  }
  flushInstances(inn, UNIT_BOX, seatMat, loungeT, { recv: true });
  flushInstances(inn, UNIT_BOX, seatMat, backT);

  // Enclosed Baggage Claim Alcove & Conveyor Chutes (South Landside z = +114)
  I(0.4, 5.2, 24.0, T1_W_X + 17.0, 2.6, 116.0, curtain, { order: 3 });
  I(16.5, 5.2, 0.4, T1_W_X + 8.75, 2.6, 104.0, curtain, { order: 3 });
  const carousel = new THREE.Group();
  carousel.position.set(T1_W_X + 8.0, 0.55, 114.0);
  carousel.add(new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.5, 22), beltMat));
  carousel.add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.7, 16), ribMat));
  I(2.4, 0.65, 12.0, T1_W_X + 8.0, 0.55, 124.5, beltMat);
  I(3.2, 3.2, 0.5, T1_W_X + 8.0, 1.6, 131.6, deskMat);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    makeBox(carousel, 0.9, 0.6, 0.5, Math.cos(a) * 3.1, 0.5, Math.sin(a) * 3.1,
      own(makeMat([0xef4444, 0x2563eb, 0x16a34a, 0xf59e0b][i % 4], { roughness: 0.8 })), { ry: a });
  }
  inn.add(carousel);
  S(T1_W_X + 3.8, T1_W_X + 12.2, 0, 0.8, 109.8, 118.2, 'baggage_carousel', true);
  neon(inn, 'BAGGAGE CLAIM  •  CAROUSELS 1–2', T1_W_X + 8.0, 4.2, 104.2, '#0b1220', '#a78bfa', 8.5, 0.85);

  // Terminal 1 Ceiling Lights (emissive strips — dynamic lighting handled by persistent hallLight)
  const ceilT = [];
  for (let z = -HL + 10; z <= HL - 10; z += 10) {
    for (const lx of [70, 90, 110]) xform(ceilT, lx, TOP - 1.2, z, 7.5, 0.14, 0.8);
  }
  flushInstances(inn, UNIT_BOX, glowMat, ceilT);

  // =========================================================================
  // 3. GATE PODS + PASSENGER BOARDING BRIDGES + APRON & ATC TOWER
  // =========================================================================
  IB(g, 72.0, 0.04, 300.0, 156.0, -0.02, 0, apronMat, { recv: true, name: 'LAX Airfield Apron' });
  S(120.0, 192.0, -0.20, 0.0, -150.0, 150.0, 'lax_apron', true);

  for (const gt of gates) {
    const POD_X = T1_E_X + 6.0; // +126.0 (connects flush to T1_E_X = +120.0)
    const pod = new THREE.Group();
    pod.position.set(POD_X, 0, gt.z);
    pod.userData.studioName = `Gate ${gt.n} hold-room`;
    g.add(pod);
    const P = (w, h, d, x, y, z, m, o) => IB(pod, w, h, d, x, y, z, m, o);
    const PS = (x0, x1, y0, y1, z0, z1, tag, climb) =>
      S(POD_X + x0, POD_X + x1, y0, y1, gt.z + z0, gt.z + z1, tag, climb);

    P(12.0, 0.30, 28.0, 0, -0.15, 0, floorMat, { recv: true });
    PS(-6.0, 6.0, -0.30, 0.10, -14.0, 14.0, 'gate_pod_floor', true);
    for (const s of [-1, 1]) {
      P(12.0, 8.2, 0.5, 0, 4.1, s * 14.0, white);
      PS(-6.0, 6.0, 0, 8.2, s * 14.0 - 0.25, s * 14.0 + 0.25, 'gate_pod_wall', false);
    }
    P(0.4, 8.2, 13.5, 6.0, 4.1, -7.25, curtain, { order: 3 });
    P(0.4, 8.2, 9.5,  6.0, 4.1,  9.25, curtain, { order: 3 });
    P(0.4, 3.2, 5.0,  6.0, 6.6,  2.0,  curtain, { order: 3 });
    PS(5.8, 6.2, 0, 8.2, -14.0, -0.5, 'gate_pod_glass', false);
    PS(5.8, 6.2, 0, 8.2,  4.5, 14.0, 'gate_pod_glass', false);

    P(12.8, 0.5, 29.0, 0, 8.45, 0, shellMat, { cast: true });
    P(3.0, 0.12, 22.0, 0, 8.12, 0, glowMat);
    PS(-6.4, 6.4, 8.2, 8.7, -14.5, 14.5, 'gate_pod_roof', true);

    P(2.2, 1.15, 1.2, 2.8, 0.575, -6.0, deskMat);
    P(2.4, 0.1, 1.4, 2.8, 1.2, -6.0, topMat);
    PS(1.7, 3.9, 0, 1.25, -6.6, -5.4, 'gate_desk', true);
    neon(pod, `GATE ${gt.n}`, 2.8, 3.5, -6.0, '#0b1220', '#facc15', 3.8, 0.95);

    const gSeatT = [], gBkT = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      xform(gSeatT, -2.4, 0.45, 2.0 + r * 3.0 + c * 1.0, 3.0, 0.42, 0.85);
      xform(gBkT, -2.4, 0.85, 2.45 + r * 3.0 + c * 1.0, 3.0, 0.7, 0.16);
    }
    flushInstances(pod, UNIT_BOX, seatMat, gSeatT, { recv: true });
    flushInstances(pod, UNIT_BOX, seatMat, gBkT);

    for (let i = 0; i < 6; i++) {
      const sy = 0.10 + i * 0.36, sz = -8.0 + i * 1.0;
      P(4.6, 0.36, 1.0, 0.8, sy + 0.18, sz, stairMat, { recv: true });
      PS(-1.5, 3.1, sy, sy + 0.36, sz - 0.5, sz + 0.5, 'bridge_stair', true);
    }
    P(9.2, 0.30, 7.0, 1.4, DECK - 0.15, 1.5, floorMat, { recv: true });
    PS(-3.2, 6.0, DECK - 0.30, DECK, -2.0, 5.0, 'bridge_landing', true);
    P(0.16, 1.1, 7.0, -3.1, DECK + 0.55, 1.5, ribMat);

    // Telescoping Passenger Boarding Bridge
    const rotX = POD_X + 6.0, bz = gt.z + 2.0;
    const rot = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 3.3, 14), shellMat);
    rot.position.set(rotX, DECK + 1.65, bz); rot.castShadow = true; g.add(rot);
    const BL = 10.5, bridgeMidX = rotX + BL / 2;
    IB(g, BL, 0.24, 3.6, bridgeMidX, DECK - 0.12, bz, topMat, { recv: true });
    S(rotX, rotX + BL, DECK - 0.24, DECK, bz - 1.8, bz + 1.8, 'bridge_deck', true);
    IB(g, BL + 0.4, 0.22, 4.0, bridgeMidX, DECK + 2.75, bz, shellMat, { cast: true });
    for (const s of [-1, 1]) {
      IB(g, BL, 2.6, 0.14, bridgeMidX, DECK + 1.35, bz + s * 1.85, curtain, { order: 3 });
      S(rotX, rotX + BL, DECK, DECK + 2.6, bz + s * 1.85 - 0.09, bz + s * 1.85 + 0.09, 'bridge_glass', false);
    }
    IB(g, 0.5, 2.9, 3.8, rotX + BL - 0.2, DECK + 1.35, bz, deskMat);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.36, DECK - 0.25, 8), ribMat);
    leg.position.set(rotX + BL - 2.5, (DECK - 0.25) / 2 + 0.25, bz); g.add(leg);

    enterableZones.push({
      minX: TX + POD_X - 5.5, maxX: TX + POD_X + 5.5, minZ: TZ + gt.z - 13.5, maxZ: TZ + gt.z + 13.5,
      name: `LAX GATE ${gt.n} HOLD-ROOM`
    });
    mapShapes.push({ x: TX + POD_X, z: TZ + gt.z, w: 12, d: 28, color: '#e2e8f0', border: '#facc15', enterable: true });
  }

  // Apron Stand Lead-in Markings & Taxiway Edge Line
  const leadT = [];
  for (const gt of gates) {
    for (let x = 144; x <= 182; x += 5) xform(leadT, x, 0.005, gt.z, 3.2, 0.02, 0.32);
    xform(leadT, 154, 0.005, gt.z - 16, 0.32, 0.02, 12);
    xform(leadT, 154, 0.005, gt.z + 16, 0.32, 0.02, 12);
  }
  xform(leadT, 188.0, 0.005, 0, 0.35, 0.02, 290.0);
  flushInstances(g, UNIT_BOX, paintYellow, leadT);

  // LAX Air Traffic Control Tower on the North-East Apron (x = +168, z = -124)
  {
    const ATC_X = 168.0, ATC_Z = -124.0;
    IB(g, 14.0, 4.2, 14.0, ATC_X, 2.1, ATC_Z, white, { cast: true, recv: true });
    S(ATC_X - 7.0, ATC_X + 7.0, 0, 4.2, ATC_Z - 7.0, ATC_Z + 7.0, 'atc_base', false);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.4, 26.0, 12), ribMat);
    shaft.position.set(ATC_X, 17.2, ATC_Z);
    shaft.castShadow = true;
    g.add(shaft);
    S(ATC_X - 4.0, ATC_X + 4.0, 4.2, 30.2, ATC_Z - 4.0, ATC_Z + 4.0, 'atc_shaft', false);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 4.2, 4.2, 12), curtain);
    cab.position.set(ATC_X, 32.3, ATC_Z);
    cab.renderOrder = 3;
    g.add(cab);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 0.6, 12), shellMat);
    cap.position.set(ATC_X, 34.7, ATC_Z);
    g.add(cap);
    const radar = new THREE.Mesh(new THREE.SphereGeometry(1.6, 14, 10), white);
    radar.position.set(ATC_X, 36.6, ATC_Z);
    g.add(radar);
    neon(g, 'LAX ATC TOWER', ATC_X - 7.2, 3.2, ATC_Z, '#090d14', '#38bdf8', 7.5, 0.85, { ry: -Math.PI / 2 });
  }

  // =========================================================================
  // 4. 2-STORY LAX CENTRAL SHOPPING & DINING PAVILION + SKYBRIDGES
  // =========================================================================
  const PX_W  = -5.0;
  const PX_E  = 29.0;
  const PW    = PX_E - PX_W;          // 34.0 m
  const PX_CX = (PX_W + PX_E) / 2;    // +12.0 m
  const PZ_N  = -96.0;
  const PZ_S  = 96.0;
  const PL    = PZ_S - PZ_N;          // 192.0 m
  const PAV_H = 12.60;
  const FL2   = MEZZ;                 // 6.20 m

  // Ground Floor Slab
  IB(g, PW, 0.10, PL, PX_CX, 0.05, 0, floorMat, { recv: true, name: 'LAX Pavilion Floor 1' });
  S(PX_W, PX_E, 0, 0.10, PZ_N, PZ_S, 'pavilion_floor1', true);
  IB(g, 6.0, 0.02, PL - 8, PX_CX, 0.11, 0, darkMarble, { recv: true });

  // Second Floor Slab (West & East galleries + North, Center & South crossover decks)
  IB(g, 11.5, 0.30, PL, PX_W + 5.75, FL2 - 0.15, 0, floorMat, { recv: true, cast: true });
  S(PX_W, PX_W + 11.5, FL2 - 0.30, FL2, PZ_N, PZ_S, 'pavilion_floor2', true);
  IB(g, 11.5, 0.30, PL, PX_E - 5.75, FL2 - 0.15, 0, floorMat, { recv: true, cast: true });
  S(PX_E - 11.5, PX_E, FL2 - 0.30, FL2, PZ_N, PZ_S, 'pavilion_floor2', true);

  for (const [z0, z1] of [[-96.0, -74.0], [-20.0, 20.0], [74.0, 96.0]]) {
    IB(g, 11.0, 0.30, z1 - z0, PX_CX, FL2 - 0.15, (z0 + z1) / 2, floorMat, { recv: true, cast: true });
    S(PX_W + 11.5, PX_E - 11.5, FL2 - 0.30, FL2, z0, z1, 'pavilion_floor2', true);
  }
  for (const [z0, z1] of [[-74.0, -20.0], [20.0, 74.0]]) {
    for (const rx of [PX_W + 11.55, PX_E - 11.55]) {
      IB(g, 0.12, 1.1, z1 - z0, rx, FL2 + 0.55, (z0 + z1) / 2, curtain, { order: 3 });
      IB(g, 0.16, 0.10, z1 - z0, rx, FL2 + 1.12, (z0 + z1) / 2, ribMat);
      S(rx - 0.08, rx + 0.08, FL2, FL2 + 1.15, z0, z1, 'pavilion_rail', true);
    }
  }
  for (const rz of [-74.0, -20.0, 20.0, 74.0]) {
    for (const [rx0, rx1] of [[PX_W + 11.5, PX_CX - 1.8], [PX_CX + 1.8, PX_E - 11.5]]) {
      IB(g, rx1 - rx0, 1.1, 0.12, (rx0 + rx1) / 2, FL2 + 0.55, rz, curtain, { order: 3 });
      IB(g, rx1 - rx0, 0.10, 0.16, (rx0 + rx1) / 2, FL2 + 1.12, rz, ribMat);
      S(rx0, rx1, FL2, FL2 + 1.15, rz - 0.08, rz + 0.08, 'pavilion_rail', true);
    }
  }

  // Pavilion Roof + Skylight Atrium + Parabolic LAX Theme Arches
  IB(g, PW + 1.6, 0.45, PL + 1.6, PX_CX, PAV_H + 0.225, 0, shellMat, { cast: true, recv: true });
  S(PX_W - 0.8, PX_E + 0.8, PAV_H, PAV_H + 0.45, PZ_N - 0.8, PZ_S + 0.8, 'pavilion_roof', true);
  IB(g, 14.0, 1.4, 44.0, PX_CX, PAV_H + 0.9, 0, curtain, { order: 3 });
  IB(g, 14.4, 0.25, 44.4, PX_CX, PAV_H + 1.65, 0, shellMat, { cast: true });

  for (const az of [-56.0, 0.0, 56.0]) {
    const archCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(PX_W - 2.0, 0, az),
      new THREE.Vector3(PX_W + 4.0, 14.5, az),
      new THREE.Vector3(PX_CX,      19.2, az),
      new THREE.Vector3(PX_E - 4.0, 14.5, az),
      new THREE.Vector3(PX_E + 2.0, 0, az)
    ]);
    const archMesh = new THREE.Mesh(new THREE.TubeGeometry(archCurve, 32, 0.55, 8, false), white);
    archMesh.castShadow = true;
    g.add(archMesh);
  }

  // Pavilion Perimeter Glass Curtain Walls
  const pavWallZ = (lx, outward) => {
    const gaps = [
      { z0: -51.5, z1: -44.5, type: 'portal', z: -48.0 },
      { z0: -4.5,  z1:  4.5,  type: 'door',   z:   0.0 },
      { z0:  44.5, z1:  51.5, type: 'portal', z:  48.0 }
    ];
    let cur = PZ_N;
    for (const gp of gaps) {
      if (gp.z0 > cur) {
        IB(g, 0.4, PAV_H, gp.z0 - cur, lx, PAV_H / 2, (cur + gp.z0) / 2, curtain, { order: 3 });
        S(lx - 0.2, lx + 0.2, 0, PAV_H, cur, gp.z0, 'pavilion_wall', false);
      }
      if (gp.type === 'door') {
        IB(g, 0.4, PAV_H - 4.4, gp.z1 - gp.z0, lx, 4.4 + (PAV_H - 4.4) / 2, gp.z, curtain, { order: 3 });
        S(lx - 0.2, lx + 0.2, 4.4, PAV_H, gp.z0, gp.z1, 'pavilion_wall', false);
        IB(g, 1.2, 0.3, gp.z1 - gp.z0 + 0.6, lx + outward * 0.4, 4.4, gp.z, ribMat);
      } else {
        IB(g, 0.4, FL2 - 4.4, gp.z1 - gp.z0, lx, 4.4 + (FL2 - 4.4) / 2, gp.z, curtain, { order: 3 });
        S(lx - 0.2, lx + 0.2, 4.4, FL2, gp.z0, gp.z1, 'pavilion_wall', false);
        if (outward < 0) {
          IB(g, 0.4, PAV_H - FL2, gp.z1 - gp.z0, lx, FL2 + (PAV_H - FL2) / 2, gp.z, curtain, { order: 3 });
          S(lx - 0.2, lx + 0.2, FL2, PAV_H, gp.z0, gp.z1, 'pavilion_wall', false);
        } else {
          IB(g, 0.4, PAV_H - (FL2 + 3.6), gp.z1 - gp.z0, lx, FL2 + 3.6 + (PAV_H - (FL2 + 3.6)) / 2, gp.z, curtain, { order: 3 });
          S(lx - 0.2, lx + 0.2, FL2 + 3.6, PAV_H, gp.z0, gp.z1, 'pavilion_wall', false);
        }
      }
      cur = gp.z1;
    }
    IB(g, 0.4, PAV_H, PZ_S - cur, lx, PAV_H / 2, (cur + PZ_S) / 2, curtain, { order: 3 });
    S(lx - 0.2, lx + 0.2, 0, PAV_H, cur, PZ_S, 'pavilion_wall', false);
  };
  pavWallZ(PX_W, -1);
  pavWallZ(PX_E, 1);

  for (const ez of [PZ_N, PZ_S]) {
    IB(g, PW, PAV_H, 0.45, PX_CX, PAV_H / 2, ez, white);
    S(PX_W, PX_E, 0, PAV_H, ez - 0.225, ez + 0.225, 'pavilion_wall', false);
  }

  neon(g, 'LAX CENTRAL PAVILION  •  SHOPS & DINING', PX_W - 0.4, 10.6, 0, '#0f172a', '#facc15', 22.0, 1.8, { ry: -Math.PI / 2 });
  neon(g, 'LAX CENTRAL PAVILION  •  SHOPS & DINING', PX_E + 0.4, 10.6, 0, '#0f172a', '#38bdf8', 22.0, 1.8, { ry: Math.PI / 2 });

  // --- 4 Walkable Escalators (Floor 1 y=0.10 <-> Floor 2 y=6.20) ------------
  const buildEscalator = (ex, zStart, zEnd, label) => {
    const steps = 16;
    const totalRise = FL2 - 0.10;
    const stepH = totalRise / steps;
    const stepD = (zEnd - zStart) / steps;
    const absStepD = Math.abs(stepD);
    const runLen = Math.abs(zEnd - zStart);
    const midZ = (zStart + zEnd) / 2;

    for (let i = 0; i < steps; i++) {
      const sy = 0.10 + i * stepH;
      const sz = zStart + (i + 0.5) * stepD;
      IB(g, 2.2, stepH, absStepD, ex, sy + stepH / 2, sz, ribMat, { recv: true });
      IB(g, 2.1, 0.03, 0.06, ex, sy + stepH + 0.01, sz + (stepD > 0 ? -absStepD * 0.45 : absStepD * 0.45), cyanGlow);
      S(ex - 1.1, ex + 1.1, sy, sy + stepH, sz - absStepD / 2, sz + absStepD / 2, 'escalator_step', true);
    }
    const slopeAngle = Math.atan2(totalRise, runLen) * (stepD > 0 ? -1 : 1);
    const hyp = Math.hypot(runLen, totalRise);
    for (const sx of [-1.22, 1.22]) {
      IB(g, 0.18, 0.55, hyp + 0.8, ex + sx, 0.10 + totalRise / 2 - 0.2, midZ, deskMat, { rx: slopeAngle });
      IB(g, 0.08, 0.95, hyp + 0.6, ex + sx, 0.10 + totalRise / 2 + 0.55, midZ, curtain, { rx: slopeAngle, order: 3 });
      IB(g, 0.16, 0.10, hyp + 0.8, ex + sx, 0.10 + totalRise / 2 + 1.05, midZ, rubberMat, { rx: slopeAngle });
      S(ex + sx - 0.10, ex + sx + 0.10, 0.10, FL2 + 1.0, Math.min(zStart, zEnd), Math.max(zStart, zEnd), 'escalator_rail', true);
    }
    neon(g, label, ex, FL2 + 2.2, zEnd, '#0b1220', '#38bdf8', 2.6, 0.45);
  };

  buildEscalator(PX_CX, -30.5, -20.2, 'ESCALATOR  ↑');
  buildEscalator(PX_CX,  30.5,  20.2, 'ESCALATOR  ↑');
  buildEscalator(PX_CX, -63.5, -73.8, 'ESCALATOR  ↑');
  buildEscalator(PX_CX,  63.5,  73.8, 'ESCALATOR  ↑');

  // --- Central Atrium Fountain & Lounge (z = 0) ---------------------------
  const ftn = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.5, 0.75, 20), darkMarble);
  ftn.position.set(PX_CX, 0.475, 0);
  g.add(ftn);
  const ftnWater = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 0.12, 20), cyanGlow);
  ftnWater.position.set(PX_CX, 0.82, 0);
  g.add(ftnWater);
  S(PX_CX - 3.4, PX_CX + 3.4, 0.10, 0.88, -3.4, 3.4, 'atrium_fountain', true);

  // --- Shops & Restaurants on Floor 1 (y = 0.10) & Floor 2 (y = 6.20) ------
  const buildShop = (floorY, side, zCenter, name, accentHex, style) => {
    const isWest = side === 'W';
    const xBack = isWest ? PX_W + 0.4 : PX_E - 0.4;
    const xFront = isWest ? PX_W + 9.2 : PX_E - 9.2;
    const xMid = (xBack + xFront) / 2;
    const wShop = Math.abs(xFront - xBack);
    const dShop = 26.0;
    const hShop = 4.6;
    const dir = isWest ? 1 : -1;

    IB(g, wShop, hShop, 0.35, xMid, floorY + hShop / 2, zCenter - dShop / 2, white);
    IB(g, wShop, hShop, 0.35, xMid, floorY + hShop / 2, zCenter + dShop / 2, white);
    S(Math.min(xBack, xFront), Math.max(xBack, xFront), floorY, floorY + hShop, zCenter - dShop / 2 - 0.18, zCenter - dShop / 2 + 0.18, 'shop_wall', false);
    S(Math.min(xBack, xFront), Math.max(xBack, xFront), floorY, floorY + hShop, zCenter + dShop / 2 - 0.18, zCenter + dShop / 2 + 0.18, 'shop_wall', false);

    IB(g, 0.4, 1.1, dShop, xFront, floorY + hShop - 0.55, zCenter, deskMat);
    neon(g, name, xFront + dir * 0.25, floorY + hShop - 0.55, zCenter, '#0f172a', accentHex, 14.0, 0.85, { ry: dir * Math.PI / 2 });

    if (style === 'dining') {
      IB(g, 1.4, 1.1, 14.0, xBack + dir * 2.4, floorY + 0.55, zCenter, woodMat);
      IB(g, 1.6, 0.12, 14.2, xBack + dir * 2.4, floorY + 1.15, zCenter, topMat);
      S(xBack + dir * 1.6, xBack + dir * 3.2, floorY, floorY + 1.2, zCenter - 7.0, zCenter + 7.0, 'shop_counter', true);
      for (const tz of [-7.5, 0, 7.5]) {
        IB(g, 1.5, 0.08, 1.5, xMid + dir * 1.4, floorY + 0.78, zCenter + tz, woodMat);
        IB(g, 0.16, 0.74, 0.16, xMid + dir * 1.4, floorY + 0.37, zCenter + tz, ribMat);
      }
    } else {
      IB(g, 1.2, 2.8, 18.0, xBack + dir * 0.8, floorY + 1.4, zCenter, woodMat);
      for (const dz of [-6.0, 0, 6.0]) {
        IB(g, 2.2, 0.95, 3.2, xMid + dir * 0.6, floorY + 0.475, zCenter + dz, darkMarble);
        IB(g, 2.0, 0.06, 3.0, xMid + dir * 0.6, floorY + 0.98, zCenter + dz, glowMat);
        S(xMid + dir * 0.6 - 1.1, xMid + dir * 0.6 + 1.1, floorY, floorY + 1.0, zCenter + dz - 1.6, zCenter + dz + 1.6, 'shop_display', true);
      }
    }
  };

  buildShop(0.10, 'W', -48.0, 'AURA LUXE BOUTIQUE',       '#f472b6', 'retail');
  buildShop(0.10, 'E', -48.0, 'LAX NEWS & SOUVENIRS',     '#38bdf8', 'retail');
  buildShop(0.10, 'W',  48.0, 'PACIFIC TECH & AUDIO',     '#22d3ee', 'retail');
  buildShop(0.10, 'E',  48.0, 'CALIFORNIA JUICE & BAKERY','#facc15', 'dining');

  buildShop(FL2,  'W', -48.0, 'RODEO DRIVE WATCHES',      '#fbbf24', 'retail');
  buildShop(FL2,  'E', -48.0, 'TERMINAL DUTY-FREE',       '#a78bfa', 'retail');
  buildShop(FL2,  'W',  48.0, 'SUNSET SUSHI & RAMEN',     '#fb7185', 'dining');
  buildShop(FL2,  'E',  48.0, 'SKYLINE BREWHOUSE & GRILL','#4ade80', 'dining');

  // Pavilion Interior Lighting (emissive strips — dynamic lighting handled by persistent pavLight)
  const pavGlowT = [];
  for (let z = -88; z <= 88; z += 11) {
    for (const lx of [PX_W + 6, PX_E - 6]) xform(pavGlowT, lx, PAV_H - 0.6, z, 4.5, 0.12, 0.8);
  }
  flushInstances(g, UNIT_BOX, glowMat, pavGlowT);

  // --- Two Elevated Glass Skybridges (z = -48 & z = +48, y = FL2 = 6.20) -----
  for (const sbZ of [-48.0, 48.0]) {
    const SB_X0 = PX_E;   // +29.0
    const SB_X1 = T1_W_X; // +60.0
    const SB_W  = SB_X1 - SB_X0; // 31.0 m
    const SB_CX = (SB_X0 + SB_X1) / 2; // +44.5 m
    const SB_D  = 4.8;

    IB(g, SB_W, 0.34, SB_D, SB_CX, FL2 - 0.17, sbZ, floorMat, { recv: true, cast: true, name: 'LAX Skybridge' });
    S(SB_X0, SB_X1, FL2 - 0.34, FL2, sbZ - SB_D / 2, sbZ + SB_D / 2, 'skybridge_floor', true);
    IB(g, SB_W, 0.26, SB_D + 0.4, SB_CX, FL2 + 3.55, sbZ, shellMat, { cast: true });
    IB(g, SB_W - 1.0, 0.08, 0.6, SB_CX, FL2 + 3.38, sbZ, glowMat);
    for (const s of [-1, 1]) {
      IB(g, SB_W, 3.4, 0.14, SB_CX, FL2 + 1.7, sbZ + s * (SB_D / 2 - 0.07), curtain, { order: 3 });
      S(SB_X0, SB_X1, FL2, FL2 + 3.4, sbZ + s * (SB_D / 2 - 0.14), sbZ + s * (SB_D / 2), 'skybridge_wall', false);
    }
    neon(g, 'TERMINAL 1  ↔  CENTRAL SHOPS', SB_CX, FL2 + 4.1, sbZ + 2.5, '#0f172a', '#38bdf8', 11.0, 0.75);
    neon(g, 'TERMINAL 1  ↔  CENTRAL SHOPS', SB_CX, FL2 + 4.1, sbZ - 2.5, '#0f172a', '#38bdf8', 11.0, 0.75, { ry: Math.PI });
  }

  // =========================================================================
  // PERSISTENT INTERIOR LIGHTS — always visible, intensity 0 at distance.
  // Parented to the ALWAYS-VISIBLE root group (never the culled interior), so
  // the scene light count is constant from boot and lit shaders never recompile
  // on approach. worldSystems/airport.js fades intensity smoothly by distance.
  // =========================================================================
  const hallLight = new THREE.PointLight(0xfff1d6, 0, 95, 2);
  hallLight.position.set(T1_CX, 10.5, 0);
  g.add(hallLight);
  const pavLight = new THREE.PointLight(0xfff5e0, 0, 75, 2);
  pavLight.position.set(PX_CX, 9.6, 0);
  g.add(pavLight);
  const lights = [
    { light: hallLight, x: TX + T1_CX, z: TZ, r: 130, base: 2.4 },
    { light: pavLight,  x: TX + PX_CX, z: TZ, r: 100, base: 2.2 }
  ];

  // Materialise every batched static box BEFORE registering the interior cull.
  batcher.flush();

  (aura.culls || []).push({ g: inn, x: TX + T1_CX, z: TZ, r: row.cullR ?? 185 });

  // =========================================================================
  // 5. ENTERABLE ZONES, MINIMAP SHAPES & RETURN PAYLOAD
  // =========================================================================
  enterableZones.push({ minX: TX + T1_W_X + 0.6, maxX: TX + 87.4, minZ: TZ - HL + 0.6, maxZ: TZ + HL - 0.6, name: 'LAX TERMINAL 1 — DEPARTURES HALL' });
  enterableZones.push({ minX: TX + 84.0, maxX: TX + 92.0, minZ: TZ + secLo, maxZ: TZ + secHi, name: 'LAX SECURITY CHECKPOINT' });
  enterableZones.push({ minX: TX + 88.6, maxX: TX + T1_E_X - 0.6, minZ: TZ - HL + 0.6, maxZ: TZ + HL - 0.6, name: 'LAX AIRSIDE CONCOURSE' });
  enterableZones.push({ minX: TX + PX_W + 0.6, maxX: TX + PX_E - 0.6, minZ: TZ + PZ_N + 0.6, maxZ: TZ + PZ_S - 0.6, name: 'LAX CENTRAL PAVILION — SHOPS & DINING' });

  mapShapes.push({ x: TX + T1_CX, z: TZ, w: T1_W, d: 2 * HL, color: '#f8fafc', border: '#0284c7', enterable: true });
  mapShapes.push({ x: TX + PX_CX, z: TZ, w: PW, d: PL, color: '#f1f5f9', border: '#facc15', enterable: true });
  mapShapes.push({ x: TX + 18.0, z: TZ, w: 84.0, d: 312.0, color: '#334155', border: '#38bdf8', enterable: false });
  mapShapes.push({ x: TX + 156.0, z: TZ, w: 72.0, d: 300.0, color: '#475569', border: '#94a3b8', enterable: false });

  return {
    object: g, boxes, interior: inn, board, carousel, lights,
    anchors: {
      landside:  [TX + T1_W_X - 3, Y, TZ],
      security:  [TX + 88.0, Y, TZ],
      carousel:  [TX + T1_W_X + 8.0, Y, TZ + 114.0],
      shops:     [TX + PX_CX, Y, TZ],
      skybridge: [TX + 44.5, Y + FL2, TZ - 48.0]
    }
  };
}

export function resetAirport() {
  for (const m of ownedMats) {
    if (m.map && m.map.isCanvasTexture) m.map.dispose();
    if (m.emissiveMap && m.emissiveMap.isCanvasTexture && m.emissiveMap !== m.map) m.emissiveMap.dispose();
    m.dispose();
  }
  ownedMats.length = 0;
}

export const AIRPORT_BUILDERS = { terminal_lax: buildAirportTerminal };
export default AIRPORT_BUILDERS;