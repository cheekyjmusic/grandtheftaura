// =============================================================================
// worldObjects/airport.js — LAX TERMINAL (parametric barrel-vault airport)
//
// ONE GROUP at (TX, Y, TZ). All geometry is LOCAL; colliders are offset back
// to world. Move the row and the whole airport moves — including gate pods,
// boarding bridges and the mezzanine stair.
//
// REMOVED vs the original (now separate layout rows — would double-build):
//   curb lane + dashes + zebras -> rd/lax_curb      (worldRoads)
//   bag carts / tug / masts / cones -> lax/cart_*, lax/tug, lax/mast_*, lax/cones
//
// PUBLISHED for worldSystems/airport.js via getPlacement(id).data:
//   board    { canvas, tex, rows, draw() }   departures board, refreshable
//   carousel THREE.Group                     baggage claim, spins
// =============================================================================
import * as THREE from 'three';
import { aura, enterableZones, mapShapes } from '../state.js';
import { makeMat, worldRoot } from '../engine.js';
import { UNIT_BOX, addSolidBox, flushInstances, makeBox, rngFor, xform } from '../worldKit.js';
import { neon } from './shell.js';

const ownedMats = [];
const own = (m) => { m.userData.shared = true; ownedMats.push(m); return m; };

/** Barrel-vault surface in local space. Reused for shell + skylight. */
function archShell(halfSpan, length, baseY, rise, segX = 28, t0 = 0, t1 = 1) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= 1; j++) {
    const z = -length / 2 + j * length;
    for (let i = 0; i <= segX; i++) {
      const t = t0 + (t1 - t0) * (i / segX);
      pos.push(-halfSpan + t * 2 * halfSpan, baseY + rise * Math.sin(Math.PI * t), z);
      uv.push(t * 8, j * length / 12);
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

/** Departures board — geometry module creates it, airport system refreshes it. */
export function makeDeparturesBoard(cfg = {}, seed = 'lax/board') {
  const rng = rngFor(seed);
  const dests = cfg.dests || ['SUNNYVALE', 'AURA HILLS', 'REDROCK', 'FROSTPINE'];
  const statuses = cfg.statuses || ['ON TIME', 'BOARDING', 'DELAYED'];
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 320;
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
  const draw = () => {
    const c = canvas.getContext('2d');
    c.fillStyle = '#05070d'; c.fillRect(0, 0, 512, 320);
    c.textAlign = 'left';
    c.fillStyle = '#facc15'; c.font = 'bold 30px Oswald, sans-serif';
    c.fillText('DEPARTURES', 18, 38);
    c.fillStyle = '#38bdf8'; c.font = 'bold 17px Oswald, sans-serif';
    c.fillText('FLIGHT', 18, 68); c.fillText('DESTINATION', 120, 68);
    c.fillText('TIME', 330, 68); c.fillText('STATUS', 410, 68);
    c.strokeStyle = '#1e3a5f'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(14, 78); c.lineTo(498, 78); c.stroke();
    c.font = '18px Oswald, sans-serif';
    rows.forEach((r, i) => {
      const y = 106 + i * 30;
      c.fillStyle = '#e2e8f0';
      c.fillText(r.code, 18, y); c.fillText(r.dest, 120, y); c.fillText(r.time, 330, y);
      c.fillStyle = r.status === 'DELAYED' ? '#f87171'
        : (r.status === 'BOARDING' || r.status === 'FINAL CALL' ? '#4ade80' : '#facc15');
      c.fillText(r.status, 410, y);
    });
    tex.needsUpdate = true;
  };
  draw();
  return { canvas, tex, rows, draw, statuses };
}

// =============================================================================
export function buildAirportTerminal(row) {
  const TX = row.at[0], TZ = row.at[1];
  const HW = row.halfW ?? 22, HL = row.halfL ?? 103;
  const Y = row.baseY ?? 0.30, WALL_H = row.wallH ?? 14.0, RISE = row.rise ?? 6.4;
  const MEZZ = (row.mezz ?? 7.60) - Y;      // local deck height
  const TOP = WALL_H;                       // local wall top
  const DECK = 2.15;                        // local boarding-bridge deck
  const L = (absZ) => absZ - TZ;            // absolute layout z -> local
  const doors = (row.doors || [TZ - 65, TZ, TZ + 65]).map(L);
  const gates = (row.gates || [{ z: TZ - 63, n: 1 }, { z: TZ + 57, n: 2 }])
    .map((g) => ({ z: L(g.z), n: g.n }));
  const checkin = (row.checkin || [TZ - 73, TZ - 41, TZ + 41, TZ + 73]).map(L);
  const security = (row.security || [TZ - 14, TZ, TZ + 14]).map(L);

  const g = new THREE.Group();
  g.position.set(TX, Y, TZ);
  g.userData.studioName = row.name || 'LAX Terminal 1';
  worldRoot.add(g);

  const boxes = [];
  const B = (p, w, h, d, x, y, z, m, o) => makeBox(p, w, h, d, x, y, z, m, o);
  const S = (x0, x1, y0, y1, z0, z1, tag, climb) => boxes.push(addSolidBox(
    TX + x0, TX + x1, Y + y0, Y + y1, TZ + z0, TZ + z1, tag, climb));

  // --- materials -----------------------------------------------------------
  const shellMat = own(makeMat(0xeef4f8, { texType: 'brushedsteel', repeatX: 10, repeatY: 30, metalness: 0.72, roughness: 0.26, flatShading: false }));
  const ribMat = own(makeMat(0xcbd5e1, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.2, flatShading: false }));
  const mullion = own(makeMat(0x475569, { metalness: 0.8, roughness: 0.35 }));
  const curtain = own(makeMat(0x9fd8f5, { metalness: 0.85, roughness: 0.06, transparent: true, opacity: 0.26, emissive: 0x0ea5e9, emissiveIntensity: 0.22, flatShading: false }));
  curtain.side = THREE.DoubleSide; curtain.depthWrite = false;
  const floorMat = own(makeMat(0xf1f5f9, { texType: 'marble', repeatX: 12, repeatY: 52, roughness: 0.18, clearcoat: 0.8, flatShading: false }));
  const white = own(makeMat(0xf8fafc, { roughness: 0.55 }));
  const deskMat = own(makeMat(0x1e293b, { metalness: 0.4, roughness: 0.4 }));
  const topMat = own(makeMat(0xe2e8f0, { texType: 'brushedsteel', metalness: 0.9, roughness: 0.2, flatShading: false }));
  const seatMat = own(makeMat(0x2563eb, { texType: 'fabric', roughness: 0.9 }));
  const beltMat = own(makeMat(0x334155, { metalness: 0.6, roughness: 0.5 }));
  const woodMat = own(makeMat(0x8a5a2b, { texType: 'wood', repeatX: 4, repeatY: 4, roughness: 0.6 }));
  const glowMat = own(makeMat(0xfff7d6, { emissive: 0xfff7d6, emissiveIntensity: 0.9 }));
  const brandMat = own(makeMat(0x0284c7, { emissive: 0x0369a1, emissiveIntensity: 0.45, metalness: 0.6, roughness: 0.3 }));
  const paint = own(new THREE.MeshBasicMaterial({ color: 0xfacc15 }));

  // --- podium, floor, guide bands -----------------------------------------
  B(g, 2 * HW + 2.4, 0.30, 2 * HL + 2.4, 0, -0.15, 0,
    own(makeMat(0xcbd5e1, { texType: 'concrete', repeatX: 12, repeatY: 52 })), { recv: true });
  B(g, 2 * HW - 0.4, 0.10, 2 * HL - 0.4, 0, 0.05, 0, floorMat, { recv: true, name: 'Terminal floor' });
  S(-HW, HW, -0.30, 0.10, -HL, HL, 'terminal_floor', true);
  for (const bx of [-14, 0, 14]) B(g, 0.5, 0.02, 2 * HL - 6, bx, 0.11, 0, brandMat);

  // --- barrel vault + ribs + skylight --------------------------------------
  const shell = new THREE.Mesh(archShell(HW + 1.2, 2 * HL + 2.4, TOP, RISE), shellMat);
  shell.castShadow = shell.receiveShadow = true;
  shell.material.side = THREE.DoubleSide;
  shell.userData.studioName = 'Terminal vault roof';
  g.add(shell);
  const ribPts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    ribPts.push(new THREE.Vector3(-(HW + 1.2) + t * 2 * (HW + 1.2), TOP + RISE * Math.sin(Math.PI * t) - 0.34, 0));
  }
  const ribGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ribPts), 26, 0.30, 6, false);
  const ribT = [];
  for (let z = -HL - 1; z <= HL + 1; z += 11.5) xform(ribT, 0, 0, z);
  flushInstances(g, ribGeo, ribMat, ribT, { cast: true });
  const sky = new THREE.Mesh(archShell(HW + 1.2, 2 * HL - 4, TOP, RISE, 10, 0.40, 0.60),
    own(makeMat(0xdff3ff, { emissive: 0xbfe6ff, emissiveIntensity: 0.55, transparent: true, opacity: 0.55, roughness: 0.1 })));
  sky.material.side = THREE.DoubleSide;
  sky.position.y = 0.12;
  g.add(sky);
  for (const s of [-1, 1]) B(g, 0.6, 0.9, 2 * HL + 2.4, s * (HW + 1.2), TOP + 0.1, 0, brandMat);
  S(-HW - 1.2, HW + 1.2, TOP, TOP + RISE + 0.4, -HL - 1.2, HL + 1.2, 'terminal_roof', true);

  const colT = [];
  for (let z = -HL + 6; z <= HL - 6; z += 17) for (const s of [-1, 1]) {
    xform(colT, s * (HW - 1.4), WALL_H / 2, z, 0.9, WALL_H, 0.9);
  }
  flushInstances(g, UNIT_BOX, ribMat, colT, { cast: true, recv: true });

  // --- curtain walls -------------------------------------------------------
  const wallRun = (lx, a, b, outward) => {
    if (b - a < 0.4) return;
    B(g, 0.5, WALL_H, b - a, lx, WALL_H / 2, (a + b) / 2, white);
    S(lx - 0.25, lx + 0.25, 0, TOP, a, b, 'terminal_wall', false);
    B(g, 0.16, WALL_H - 1.2, b - a - 0.6, lx + outward * 0.30, WALL_H / 2, (a + b) / 2, curtain, { order: 3 })
      .userData.studioName = 'Curtain wall';
    const mT = [];
    for (let z = a + 1.2; z < b - 0.6; z += 2.4) xform(mT, lx + outward * 0.36, WALL_H / 2, z, 0.16, WALL_H - 1.2, 0.16);
    for (const hy of [3.4, 7.0, 10.6]) xform(mT, lx + outward * 0.36, hy, (a + b) / 2, 0.16, 0.16, b - a - 0.6);
    flushInstances(g, UNIT_BOX, mullion, mT);
  };
  // Landside (west): openings at the entrance portals.
  {
    let cursor = -HL;
    for (const dz of doors) { wallRun(-HW, cursor, dz - 4, -1); cursor = dz + 4; }
    wallRun(-HW, cursor, HL, -1);
    for (const dz of doors) {
      B(g, 0.5, WALL_H - 4.6, 8, -HW, 4.6 + (WALL_H - 4.6) / 2, dz, white);
      B(g, 0.9, 0.34, 8.6, -HW - 0.2, 4.6, dz, ribMat);
      for (const s of [-1, 1]) B(g, 0.2, 4.4, 0.3, -HW - 0.2, 2.2, dz + s * 4, ribMat);
      neon(g, dz === doors[1] ? 'DEPARTURES  •  TERMINAL 1' : 'ENTRANCE',
        -HW - 0.62, 5.5, dz, '#090d14', dz === doors[1] ? '#facc15' : '#38bdf8',
        dz === doors[1] ? 9.0 : 4.4, 0.9);
    }
  }
  // Airside (east): openings at the gate pods.
  {
    let cursor = -HL;
    for (const gt of gates) { wallRun(HW, cursor, gt.z - 8, 1); cursor = gt.z + 8; }
    wallRun(HW, cursor, HL, 1);
  }
  for (const ez of [-1, 1]) {
    const wz = ez * HL;
    B(g, 2 * HW, WALL_H, 0.5, 0, WALL_H / 2, wz, white);
    S(-HW, HW, 0, TOP, wz - 0.25, wz + 0.25, 'terminal_wall', false);
    B(g, 2 * HW - 5, 5.0, 0.2, 0, 8.0, wz + ez * 0.32, curtain, { order: 3 });
  }

  // --- curbside canopy (the lane itself is rd/lax_curb) --------------------
  const canZ = HL - 24;
  B(g, 19, 0.55, canZ * 2, -29, 7.05, 0, shellMat, { cast: true, recv: true, name: 'Departures canopy' });
  B(g, 19.4, 0.35, canZ * 2 + 0.6, -29, 6.72, 0, brandMat);
  S(-38.5, -19.5, 6.70, 7.35, -canZ, canZ, 'curb_canopy', true);
  for (let z = -canZ + 6; z <= canZ - 6; z += 24.3) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 7.0, 10), ribMat);
    c.position.set(-36, 3.2, z); c.castShadow = true; g.add(c);
    S(-36.5, -35.5, -0.04, 6.70, z - 0.5, z + 0.5, 'canopy_column', false);
  }
  const stripT = [];
  for (let z = -canZ + 4; z <= canZ - 4; z += 10) xform(stripT, -29, 6.62, z, 12, 0.1, 0.6);
  flushInstances(g, UNIT_BOX, glowMat, stripT);
  neon(g, 'LOS AURA INTERNATIONAL', -38.8, 8.6, 0, '#090d14', '#facc15', 22.0, 2.0);
  neon(g, 'LAX  •  TERMINAL 1  •  DEPARTURES', -38.8, 5.9, 0, '#0b1220', '#38bdf8', 17.0, 1.0);

  // =========================================================================
  // INTERIOR (distance-culled)
  // =========================================================================
  const inn = new THREE.Group();
  inn.userData.studioName = 'LAX terminal interior';
  g.add(inn);
  const I = (w, h, d, x, y, z, m, o) => makeBox(inn, w, h, d, x, y, z, m, o);

  // Check-in islands
  const screenT = [], beltT = [];
  checkin.forEach((cz, i) => {
    I(5.0, 1.15, 16.0, -9, 0.575, cz, deskMat, { cast: true });
    I(5.3, 0.12, 16.3, -9, 1.21, cz, topMat);
    I(0.6, 1.9, 16.0, -6.2, 2.1, cz, deskMat);
    S(-11.5, -6.5, 0, 1.27, cz - 8, cz + 8, 'checkin_counter', true);
    for (let k = -3; k <= 3; k++) {
      xform(screenT, -6.6, 2.35, cz + k * 2.2, 0.12, 0.85, 1.5);
      xform(beltT, -12.6, 0.42, cz + k * 2.2, 1.6, 0.5, 1.7);
    }
    I(6.0, 0.12, 1.2, -9, 3.6, cz, brandMat);
    neon(inn, `CHECK-IN ${cz < 0 ? 'A' : 'B'}${i + 1}`, -9, 3.05, cz, '#0b1220', '#38bdf8', 4.6, 0.62);
  });
  flushInstances(inn, UNIT_BOX, own(makeMat(0x22d3ee, { emissive: 0x0891b2, emissiveIntensity: 0.8 })), screenT);
  flushInstances(inn, UNIT_BOX, beltMat, beltT, { recv: true });
  neon(inn, 'CHECK-IN  •  DESKS 1–28', -9, 5.6, 0, '#0b1220', '#38bdf8', 13.0, 1.0);

  // Hanging departures board (landside + airside faces)
  const board = makeDeparturesBoard(row.flights || {}, row.id);
  const boardMat = own(new THREE.MeshStandardMaterial({
    map: board.tex, emissiveMap: board.tex, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.3
  }));
  const faces = [boardMat, boardMat, deskMat, deskMat, deskMat, deskMat];
  I(0.5, 10.0, 16.0, -2.5, 9.4, 0, faces, { name: 'Departures board' });
  I(0.5, 7.5, 12.0, 8.0, 8.4, 0, faces);
  for (const bx of [-2.5, 8.0]) for (const s of [-1, 1]) I(0.16, 3.2, 0.16, bx, 15.0, s * 5.5, ribMat);

  // Security checkpoint
  const secLo = security[0] - 6, secHi = security[security.length - 1] + 6;
  for (const [a, b] of [[-HL + 0.5, secLo], [secHi, HL - 0.5]]) {
    I(0.6, 6.0, b - a, 2, 3.0, (a + b) / 2, own(makeMat(0xe2e8f0, { texType: 'siding', repeatX: 2, repeatY: 20 })));
    S(1.7, 2.3, 0, 6.0, a, b, 'security_divider', false);
    I(0.2, 3.4, b - a - 1, 2.35, 4.0, (a + b) / 2, curtain, { order: 3 });
  }
  for (const lz of security) {
    for (const sx of [-1, 1]) {
      I(0.45, 3.0, 4.4, 2 + sx * 2.0, 1.5, lz, ribMat, { cast: true });
      S(2 + sx * 2.0 - 0.23, 2 + sx * 2.0 + 0.23, 0, 3.0, lz - 2.2, lz + 2.2, 'security_arch', false);
    }
    I(4.6, 0.35, 4.4, 2, 3.15, lz, ribMat);
    I(1.9, 0.85, 6.0, -1.0, 0.43, lz, beltMat, { cast: true });
    I(2.2, 1.35, 2.4, -1.0, 1.35, lz + 1.9, deskMat, { cast: true });
    S(-2.0, 0.0, 0, 0.86, lz - 3, lz + 3, 'security_belt', true);
    const binT = [];
    for (let i = 0; i < 3; i++) xform(binT, -1.8, 0.95, lz - 2.2 + i * 0.8, 1.3, 0.22, 0.6);
    flushInstances(inn, UNIT_BOX, own(makeMat(0x64748b, { roughness: 0.7 })), binT);
  }
  neon(inn, 'SECURITY  →  GATES 1–8', 2, 5.4, secLo - 2, '#065f46', '#f8fafc', 11.0, 0.9);
  const stanchT = [];
  for (let z = secLo + 1; z <= secHi - 1; z += 3.2) for (const sx of [-4.2, 4.2]) xform(stanchT, 2 + sx, 0.5, z, 0.1, 1.0, 0.1);
  flushInstances(inn, UNIT_BOX, ribMat, stanchT);

  // Public mezzanine
  const mz = HL - 8;
  I(13.6, 0.30, mz * 2, -15.0, MEZZ - 0.15, 0, floorMat, { recv: true });
  S(-21.8, -8.2, MEZZ - 0.30, MEZZ, -mz, mz, 'mezzanine_deck', true);
  const stairTop = 31, stairBot = 47;
  for (const [a, b] of [[-mz, stairTop], [stairBot, mz]]) {
    I(0.16, 1.15, b - a, -8.2, MEZZ + 0.575, (a + b) / 2, ribMat);
    I(0.10, 0.95, b - a - 0.4, -8.2, MEZZ + 0.55, (a + b) / 2, curtain, { order: 3 });
    S(-8.4, -8.0, MEZZ, MEZZ + 1.15, a, b, 'mezz_rail', true);
  }
  const stairMat = own(makeMat(0xd8dee6, { texType: 'concrete', repeatX: 2, repeatY: 1 }));
  for (let i = 0; i < 14; i++) {
    const sy = 0.10 + i * 0.52, sz = stairBot - 1 - i * 1.1;
    I(4.4, 0.52, 1.1, -13.0, sy + 0.26, sz, stairMat, { recv: true });
    S(-15.2, -10.8, sy, sy + 0.52, sz - 0.55, sz + 0.55, 'mezz_stair', true);
  }
  I(4.4, 0.3, 3.0, -13.0, MEZZ - 0.15, stairTop - 1.5, floorMat, { recv: true });
  S(-15.2, -10.8, MEZZ - 0.3, MEZZ, stairTop - 3, stairTop, 'mezz_stair', true);
  for (const tz of [-75, -57, -39, 55, 73]) {
    I(1.6, 0.08, 1.6, -16.5, MEZZ + 0.78, tz, woodMat);
    I(0.16, 0.74, 0.16, -16.5, MEZZ + 0.37, tz, ribMat);
    for (const s of [-1, 1]) {
      I(0.9, 0.45, 0.9, -16.5 + s * 1.7, MEZZ + 0.23, tz, seatMat);
      I(0.9, 0.55, 0.16, -16.5 + s * 1.7, MEZZ + 0.72, tz + 0.4, seatMat);
    }
  }
  I(3.0, 1.1, 12.0, -19.4, MEZZ + 0.55, 0, woodMat, { cast: true });
  I(3.3, 0.12, 12.3, -19.4, MEZZ + 1.16, 0, topMat);
  S(-20.9, -17.9, MEZZ, MEZZ + 1.22, -6, 6, 'mezz_bar', true);
  neon(inn, 'SKY DECK  •  BAR & GRILL', -15.0, MEZZ + 3.2, 0, '#1c1917', '#fcd34d', 10.0, 0.85);

  // Airside retail + food court
  I(9.0, 3.2, 13.0, 11.0, 1.6, -73, own(makeMat(0x7f1d1d, { texType: 'wood', repeatX: 3, repeatY: 2 })));
  I(9.4, 0.25, 13.4, 11.0, 3.3, -73, topMat);
  S(6.5, 15.5, 0, 3.2, -79.5, -66.5, 'duty_free', false);
  neon(inn, 'DUTY FREE', 11.0, 4.2, -79.8, '#0b1220', '#facc15', 7.0, 0.85);
  const shelfT = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) xform(shelfT, 6.9, 0.7 + r * 0.85, -78 + c * 2.0, 0.5, 0.55, 1.4);
  flushInstances(inn, UNIT_BOX, own(makeMat(0xf59e0b, { emissive: 0xb45309, emissiveIntensity: 0.3 })), shelfT);
  I(3.2, 1.1, 3.2, 11.0, 0.55, 75, woodMat, { cast: true });
  I(3.6, 0.2, 3.6, 11.0, 1.2, 75, topMat);
  S(9.4, 12.6, 0, 1.3, 73.4, 76.6, 'cafe_kiosk', true);
  neon(inn, 'SKY BEANS COFFEE', 11.0, 2.7, 73.2, '#1c1917', '#fcd34d', 5.0, 0.7);
  for (const tz of [-17, -5, 7, 19]) {
    I(1.5, 0.08, 1.5, 10.0, 0.76, tz, woodMat);
    I(0.16, 0.72, 0.16, 10.0, 0.36, tz, ribMat);
    for (const s of [-1, 1]) I(0.85, 0.45, 0.85, 10.0, 0.23, tz + s * 1.6, seatMat);
  }
  const loungeT = [], backT = [];
  for (const gz of [-67, 45]) {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
      xform(loungeT, 15.5, 0.45, gz + r * 3.0 + c * 1.05, 3.4, 0.42, 0.9);
      xform(backT, 15.5, 0.85, gz + r * 3.0 + c * 1.05 + 0.45, 3.4, 0.7, 0.18);
    }
    S(13.8, 17.2, 0, 0.7, gz - 0.5, gz + 13.0, 'gate_seat', true);
  }
  flushInstances(inn, UNIT_BOX, seatMat, loungeT, { cast: true, recv: true });
  flushInstances(inn, UNIT_BOX, seatMat, backT);

  const planterG = new THREE.CylinderGeometry(0.75, 0.62, 0.9, 10);
  for (const [px, pz] of [[4.5, -45], [4.5, 45], [18.5, -5], [-5, 95]]) {
    const pl = new THREE.Mesh(planterG, own(makeMat(0x78350f, { roughness: 0.85 })));
    pl.position.set(px, 0.45, pz); inn.add(pl);
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 0), own(makeMat(0x16a34a, { roughness: 0.9 })));
    bush.position.set(px, 1.5, pz); bush.castShadow = true; inn.add(bush);
    S(px - 0.75, px + 0.75, 0, 0.9, pz - 0.75, pz + 0.75, 'planter', true);
  }

  // Baggage carousel
  const carousel = new THREE.Group();
  carousel.position.set(-16.0, 0.55, 85);
  carousel.add(new THREE.Mesh(new THREE.CylinderGeometry(4.0, 4.0, 0.5, 20), beltMat));
  carousel.add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.7, 16), ribMat));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    makeBox(carousel, 0.9, 0.6, 0.5, Math.cos(a) * 3.0, 0.5, Math.sin(a) * 3.0,
      own(makeMat([0xef4444, 0x2563eb, 0x16a34a, 0xf59e0b][i % 4], { roughness: 0.8 })), { ry: a });
  }
  inn.add(carousel);
  S(-20, -12, 0, 0.8, 81, 89, 'baggage_carousel', true);
  neon(inn, 'BAGGAGE CLAIM', -16.0, 3.6, 85, '#0b1220', '#a78bfa', 6.5, 0.8);

  const ceilT = [];
  for (let z = -HL + 9; z <= HL - 9; z += 9) for (const lx of [-14, 0, 14]) xform(ceilT, lx, TOP - 1.2, z, 7.0, 0.14, 0.8);
  flushInstances(inn, UNIT_BOX, glowMat, ceilT);
  for (const lz of doors) {
    const hl = new THREE.PointLight(0xfff1d6, 2.2, 70, 2);
    hl.position.set(0, 9.5, lz); inn.add(hl);
  }
  (aura.culls || []).push({ g: inn, x: TX, z: TZ, r: row.cullR ?? 135 });

  // =========================================================================
  // GATE PODS + PASSENGER BOARDING BRIDGES
  // =========================================================================
  for (const gt of gates) {
    const pod = new THREE.Group();
    pod.position.set(27.5, 0, gt.z);
    pod.userData.studioName = `Gate ${gt.n} hold-room`;
    g.add(pod);
    const P = (w, h, d, x, y, z, m, o) => makeBox(pod, w, h, d, x, y, z, m, o);
    const PS = (x0, x1, y0, y1, z0, z1, tag, climb) =>
      S(27.5 + x0, 27.5 + x1, y0, y1, gt.z + z0, gt.z + z1, tag, climb);

    P(11, 0.30, 28, 0, -0.15, 0, floorMat, { recv: true });
    PS(-5.5, 5.5, -0.30, 0.10, -14, 14, 'gate_pod_floor', true);
    for (const s of [-1, 1]) {
      P(11, 8.0, 0.5, 0, 4.0, s * 14, white);
      PS(-5.5, 5.5, 0, 8.0, s * 14 - 0.25, s * 14 + 0.25, 'gate_pod_wall', false);
    }
    P(0.5, 8.0, 28, 5.5, 4.0, 0, curtain, { order: 3 });
    P(11.8, 0.5, 29, 0, 8.25, 0, shellMat, { cast: true });
    PS(-5.9, 5.9, 8.0, 8.5, -14.5, 14.5, 'gate_pod_roof', true);
    P(2.2, 1.15, 1.2, 2.6, 0.575, -6.0, deskMat, { cast: true });
    P(2.4, 0.1, 1.4, 2.6, 1.2, -6.0, topMat);
    PS(1.5, 3.7, 0, 1.25, -6.6, -5.4, 'gate_desk', true);
    neon(pod, `GATE ${gt.n}`, 2.6, 3.4, -6.0, '#0b1220', '#facc15', 3.6, 0.9);

    const seatT = [], bkT = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      xform(seatT, -2.2, 0.45, 2.0 + r * 3.0 + c * 1.0, 3.0, 0.42, 0.85);
      xform(bkT, -2.2, 0.85, 2.45 + r * 3.0 + c * 1.0, 3.0, 0.7, 0.16);
    }
    flushInstances(pod, UNIT_BOX, seatMat, seatT, { cast: true, recv: true });
    flushInstances(pod, UNIT_BOX, seatMat, bkT);

    for (let i = 0; i < 6; i++) {
      const sy = 0.10 + i * 0.36, sz = -8.0 + i * 1.0;
      P(4.6, 0.36, 1.0, 0.5, sy + 0.18, sz, stairMat, { recv: true });
      PS(-1.8, 2.8, sy, sy + 0.36, sz - 0.5, sz + 0.5, 'bridge_stair', true);
    }
    P(9.0, 0.30, 7.0, 1.0, DECK - 0.15, 1.5, floorMat, { recv: true });
    PS(-3.5, 5.5, DECK - 0.30, DECK, -2.0, 5.0, 'bridge_landing', true);
    P(0.16, 1.1, 7.0, -3.4, DECK + 0.55, 1.5, ribMat);

    const rot = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 3.3, 14), shellMat);
    rot.position.set(33, DECK + 1.65, gt.z + 2); rot.castShadow = true; g.add(rot);
    const BL = 10.0, bz = gt.z + 2;
    B(g, BL, 0.24, 3.6, 38.0, DECK - 0.12, bz, topMat, { recv: true });
    S(33, 43, DECK - 0.24, DECK, bz - 1.8, bz + 1.8, 'bridge_deck', true);
    B(g, BL + 0.4, 0.22, 4.0, 38.0, DECK + 2.75, bz, shellMat, { cast: true });
    for (const s of [-1, 1]) {
      B(g, BL, 2.6, 0.14, 38.0, DECK + 1.35, bz + s * 1.85, curtain, { order: 3 });
      S(33, 43, DECK, DECK + 2.6, bz + s * 1.85 - 0.09, bz + s * 1.85 + 0.09, 'bridge_glass', false);
    }
    B(g, 0.5, 2.9, 3.8, 42.8, DECK + 1.35, bz, own(makeMat(0x1e293b, { roughness: 0.6 })));
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.36, DECK - 0.25, 8), ribMat);
    leg.position.set(40.5, (DECK - 0.25) / 2 + 0.25, bz); g.add(leg);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10), own(makeMat(0x1c1917)));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(40.5, 0.42, bz + 1.2); g.add(wheel);

    enterableZones.push({
      minX: TX + 22.0, maxX: TX + 33.0, minZ: TZ + gt.z - 13.5, maxZ: TZ + gt.z + 13.5,
      name: `LAX GATE ${gt.n} HOLD-ROOM`
    });
    mapShapes.push({ x: TX + 27.5, z: TZ + gt.z, w: 11, d: 28, color: '#e2e8f0', border: '#facc15', enterable: true });
  }

  // Apron stand lead-in markings (equipment is separate rows)
  const leadT = [];
  for (const gt of gates) {
    for (let x = 44; x <= 74; x += 5) xform(leadT, x, -0.03, gt.z, 3.2, 0.03, 0.32);
    xform(leadT, 54, -0.03, gt.z - 16, 0.32, 0.03, 12);
    xform(leadT, 54, -0.03, gt.z + 16, 0.32, 0.03, 12);
  }
  flushInstances(g, UNIT_BOX, paint, leadT);

  enterableZones.push({ minX: TX - HW + 0.6, maxX: TX + 1.4, minZ: TZ - HL + 0.6, maxZ: TZ + HL - 0.6, name: 'LAX LANDSIDE DEPARTURES HALL' });
  enterableZones.push({ minX: TX - 2.0, maxX: TX + 6.0, minZ: TZ + secLo, maxZ: TZ + secHi, name: 'LAX SECURITY CHECKPOINT' });
  enterableZones.push({ minX: TX + 2.6, maxX: TX + HW - 0.6, minZ: TZ - HL + 0.6, maxZ: TZ + HL - 0.6, name: 'LAX AIRSIDE CONCOURSE' });
  mapShapes.push({ x: TX, z: TZ, w: 2 * HW, d: 2 * HL, color: '#f8fafc', border: '#0284c7', enterable: true });

  return {
    object: g, boxes, interior: inn, board, carousel,
    anchors: { landside: [TX - HW - 2, Y, TZ], security: [TX + 2, Y, TZ], carousel: [TX - 16, Y, TZ + 85] }
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