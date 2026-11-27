// =============================================================================
// worldSystems/airport.js — ESCALATORS, BAGGAGE CAROUSEL, BEACONS & BOARD
// Reads handles published by worldObjects/airport.js.
// (Vehicles & NPCs are handled by traffic.js, vehicles.js, and npcs.js.)
// =============================================================================
import * as THREE from 'three';
import { player } from '../state.js';
import { worldRoot } from '../engine.js';
import { dist2, getPlacement } from '../worldKit.js';

let board = null;
let carousel = null;
let fxGroup = null;
let tick = 0;
let simTime = 0;

let cfg = {
  boardRefresh: 2.4,
  boardRange: 140,
  activeRange: 240,
  carouselSpeed: 0.45,
  escalatorSpeed: 2.6
};

let centre = [248, 565];
let baseY = 0.30;

const escalators = [];
const chuteBags = [];
const apronStrobes = [];
let atcBeacon = null;

const sysGeos = [];
const sysMats = [];
const trackGeo = (g) => { sysGeos.push(g); return g; };
const trackMat = (m) => { sysMats.push(m); return m; };

const ESCALATOR_DEFS = [
  { x: 12.0, z0: -30.5, z1: -20.2, y0: 0.10, y1: 6.20 },
  { x: 12.0, z0:  30.5, z1:  20.2, y0: 0.10, y1: 6.20 },
  { x: 12.0, z0: -63.5, z1: -73.8, y0: 0.10, y1: 6.20 },
  { x: 12.0, z0:  63.5, z1:  73.8, y0: 0.10, y1: 6.20 }
];

const DESTINATIONS = ['SUNNYVALE', 'AURA HILLS', 'REDROCK', 'FROSTPINE', 'PALM BAY', 'WESTPORT', 'SOLANA'];

function buildAirportSystems(parent) {
  fxGroup = new THREE.Group();
  fxGroup.name = 'lax_systems_fx';
  parent.add(fxGroup);

  const boxGeo = trackGeo(new THREE.BoxGeometry(1, 1, 1));
  const sphGeo = trackGeo(new THREE.SphereGeometry(0.5, 10, 8));

  const treadMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
  const railDotMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
  const beaconMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x22d3ee }));
  const strobeMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xfacc15 }));

  // 1. Motorized Escalator Treads & Handrail Markers
  for (const def of ESCALATOR_DEFS) {
    const treads = [];
    const railDots = [];
    const count = 16;
    for (let i = 0; i < count; i++) {
      const bar = new THREE.Mesh(boxGeo, treadMat);
      bar.scale.set(2.05, 0.045, 0.09);
      fxGroup.add(bar);
      treads.push(bar);

      if (i % 2 === 0) {
        for (const sx of [-1.22, 1.22]) {
          const dot = new THREE.Mesh(boxGeo, railDotMat);
          dot.scale.set(0.18, 0.05, 0.16);
          fxGroup.add(dot);
          railDots.push({ mesh: dot, sx, offset: i / count });
        }
      }
    }
    escalators.push({
      ...def,
      phase: Math.random(),
      treads,
      railDots
    });
  }

  // 2. Suitcases sliding down the Baggage Claim Conveyor Chute
  const bagColors = [0xef4444, 0x3b82f6, 0x10b981, 0xf59e0b, 0xa855f7];
  for (let i = 0; i < 4; i++) {
    const bag = new THREE.Mesh(
      boxGeo,
      trackMat(new THREE.MeshStandardMaterial({ color: bagColors[i % bagColors.length], roughness: 0.7 }))
    );
    bag.scale.set(0.85, 0.52, 0.62);
    bag.position.set(68.0, 1.12, 130.5);
    fxGroup.add(bag);
    chuteBags.push({ mesh: bag, progress: i / 4 });
  }

  // 3. ATC Tower Twin-Beam Rotating Aviation Beacon & Apron Taxiway Strobes
  atcBeacon = new THREE.Group();
  atcBeacon.position.set(168.0, 38.6, -124.0);
  const beamA = new THREE.Mesh(boxGeo, beaconMat);
  beamA.scale.set(0.4, 0.35, 14.0);
  beamA.position.z = 7.0;
  const beamB = new THREE.Mesh(boxGeo, strobeMat);
  beamB.scale.set(0.4, 0.35, 14.0);
  beamB.position.z = -7.0;
  atcBeacon.add(beamA, beamB);
  fxGroup.add(atcBeacon);

  for (let z = -140; z <= 140; z += 20) {
    const strobe = new THREE.Mesh(sphGeo, trackMat(new THREE.MeshBasicMaterial({ color: 0xfacc15 })));
    strobe.scale.set(0.45, 0.25, 0.45);
    strobe.position.set(188.0, 0.14, z);
    fxGroup.add(strobe);
    apronStrobes.push(strobe);
  }
}

function updateEscalators(dt) {
  const tx = centre[0];
  const tz = centre[1];

  for (const esc of escalators) {
    esc.phase = (esc.phase + dt * 0.42) % 1;
    const count = esc.treads.length;
    for (let i = 0; i < count; i++) {
      const f = (i + esc.phase) / count;
      const y = esc.y0 + f * (esc.y1 - esc.y0) + 0.025;
      const z = esc.z0 + f * (esc.z1 - esc.z0);
      esc.treads[i].position.set(esc.x, y, z);
    }
    for (const rd of esc.railDots) {
      const f = (rd.offset + esc.phase) % 1;
      const y = esc.y0 + 1.08 + f * (esc.y1 - esc.y0);
      const z = esc.z0 + f * (esc.z1 - esc.z0);
      rd.mesh.position.set(esc.x + rd.sx, y, z);
    }

    const worldX = tx + esc.x;
    if (Math.abs(player.x - worldX) > 1.18) continue;

    const wz0 = tz + esc.z0;
    const wz1 = tz + esc.z1;
    const spanZ = wz1 - wz0;
    const t = (player.z - wz0) / spanZ;
    if (t < -0.04 || t > 1.03) continue;

    const clampedT = Math.max(0, Math.min(1, t));
    const expectedY = baseY + esc.y0 + clampedT * (esc.y1 - esc.y0);
    if (typeof player.y === 'number' && Math.abs(player.y - expectedY) <= 1.15) {
      const dirZ = Math.sign(spanZ);
      player.z += dirZ * cfg.escalatorSpeed * dt;

      const nextT = Math.max(0, Math.min(1, (player.z - wz0) / spanZ));
      const nextY = baseY + esc.y0 + nextT * (esc.y1 - esc.y0);
      if (player.y < nextY + 0.12) {
        player.y = nextY;
        if (typeof player.vy === 'number' && player.vy < 0) player.vy = 0;
      }
      if (nextT >= 0.995) {
        player.z = wz1 + dirZ * 0.35;
        player.y = baseY + esc.y1;
      }
    }
  }
}

export function install({ spec = {} } = {}) {
  reset();
  cfg = { ...cfg, ...spec };
  const rec = getPlacement('lax/terminal');
  board = rec?.data?.board || null;
  carousel = rec?.data?.carousel || null;
  if (rec?.row?.at) centre = [rec.row.at[0], rec.row.at[1]];
  if (Number.isFinite(rec?.row?.baseY)) baseY = rec.row.baseY;
  tick = 0;
  simTime = 0;

  const parent = rec?.object || worldRoot;
  buildAirportSystems(parent);
  if (!rec?.object && fxGroup) {
    fxGroup.position.set(centre[0], baseY, centre[1]);
  }
}

export function update(dt) {
  simTime += dt;

  const d2 = dist2(player.x, player.z, centre[0], centre[1]);
  if (d2 <= cfg.activeRange ** 2) {
    updateEscalators(dt);

    if (carousel) carousel.rotation.y += dt * cfg.carouselSpeed;

    for (const bag of chuteBags) {
      bag.progress = (bag.progress + dt * 0.22) % 1;
      bag.mesh.position.z = 130.5 - bag.progress * 12.2;
      bag.mesh.rotation.y = bag.progress * 0.8;
    }

    if (atcBeacon) atcBeacon.rotation.y += dt * 1.8;
    for (let i = 0; i < apronStrobes.length; i++) {
      const pulse = ((simTime * 2.5 - i * 0.18) % 1 + 1) % 1;
      apronStrobes[i].material.color.setHex(pulse < 0.22 ? 0xffffff : 0x78350f);
    }
  }

  if (!board || d2 > cfg.boardRange ** 2) return;
  tick += dt;
  if (tick < cfg.boardRefresh) return;
  tick = 0;

  const rows = board.rows;
  if (!rows?.length) return;
  const r = rows[Math.floor(Math.random() * rows.length)];
  if (r.status === 'ON TIME') {
    r.status = 'BOARDING';
  } else if (r.status === 'BOARDING') {
    r.status = 'FINAL CALL';
  } else if (r.status === 'FINAL CALL') {
    r.status = 'DEPARTED';
  } else if (r.status === 'DEPARTED') {
    r.code = `AU ${100 + Math.floor(Math.random() * 800)}`;
    r.dest = DESTINATIONS[Math.floor(Math.random() * DESTINATIONS.length)];
    r.status = 'ON TIME';
  } else {
    const st = board.statuses || ['ON TIME', 'BOARDING', 'DELAYED'];
    r.status = st[Math.floor(Math.random() * st.length)];
  }
  board.draw();
}

export function reset() {
  if (fxGroup && fxGroup.parent) {
    fxGroup.parent.remove(fxGroup);
  }
  for (const g of sysGeos) g.dispose();
  for (const m of sysMats) m.dispose();
  sysGeos.length = 0;
  sysMats.length = 0;

  escalators.length = 0;
  chuteBags.length = 0;
  apronStrobes.length = 0;

  fxGroup = null;
  atcBeacon = null;
  board = null;
  carousel = null;
  tick = 0;
  simTime = 0;
}

export default { install, update, reset };