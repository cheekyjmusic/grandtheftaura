// =============================================================================
// worldObjects/concertHall.js — WALT AURA CONCERT HALL (full-block landmark)
//
// Occupies the entire downtown block at (-84, 588): 32×32 on the plaza,
// 16 m volume, cascading stainless-steel Gehry sails to ~34 m.
//
// PLAN (local space, +Z = front/south, inner wall bounds ±15.75)
//   z +5.25..+15.75  GRAND FOYER   red cloth runner · under-stair box office (west)
//                                  lounge bar & trophy gallery (east) · chandelier
//   z -15.75..+4.75  HALL A        vineyard terraces, 112 seats, clear aisles & steps,
//                                  proscenium stage, grand piano & pipe organ
//   x +6.75..+15.75  HALL B        intimate recital hall, 36 seats, clear side-aisle steps
//   x +6.75..+15.75  CORRIDOR      foyer ↔ recital gallery walk with cloth runner
//   y 8.0            BALCONY       28 seats, clear stair landing & front promenade
//
// PERF (Part 1):
//   • Repetitive boxes (walls, terraces, stairs, trim, cases) batch through
//     makeBoxBatcher() -> ONE InstancedMesh per (parent, material, shadow policy).
//     Every S(...) collider is preserved verbatim.
//   • Seats / steps / trim / props never cast shadows.
//   • All four interior PointLights replaced by emissive fixtures (warmGlow)
//     + the shared sky environment map — zero dynamic-light toggles, zero
//     shader recompiles on approach.
// =============================================================================
import * as THREE from 'three';
import { aura } from '../state.js';
import { makeMat, worldRoot } from '../engine.js';
import { loadTexture } from '../assets.js';
import {
  UNIT_BOX, addSolidBox, flushInstances, geo, makeBox, reserveFootprint,
  resolveMat, rngFor, xform
} from '../worldKit.js';
import { mapRect, neon, zone } from './shell.js';

const M = (hex, opts) => makeMat(hex, opts);

/**
 * Static box batcher — identical contract to the airport one. Accumulates
 * unit-box transforms keyed by (parent, material, cast, recv, renderOrder)
 * and flushes each bucket into a single InstancedMesh. Colliders are NEVER
 * created here; callers keep their explicit S(...) calls.
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

const TROPHIES = [
  {
    id: 'gramophone', label: 'AURA GRAMOPHONE', year: '2019',
    detail: 'BEST ORCHESTRAL PERFORMANCE — AURA PHILHARMONIC, MAHLER CYCLE'
  },
  {
    id: 'baton', label: 'GOLDEN BATON', year: '2022',
    detail: 'CONDUCTOR OF THE YEAR — M. VELASQUEZ, RESIDENT CONDUCTOR'
  },
  {
    id: 'disc', label: 'PLATINUM RECORD', year: '2024',
    detail: '10M STREAMS — "AURA COUNTY SUITE", RECORDED LIVE IN HALL A'
  }
];

export function buildConcertHall(row) {
  const X = row.at[0], Z = row.at[1];
  const W = row.w ?? 32, D = row.d ?? 32;
  const HW = W / 2, HD = D / 2;
  const Y = row.baseY ?? 0.32;
  const WALL_H = row.h ?? 16.0;
  const T = 0.5;
  const IN_X = HW - T / 2; // 15.75 — exact inner face of perimeter X walls
  const IN_Z = HD - T / 2; // 15.75 — exact inner face of perimeter Z walls
  const rng = rngFor(row.id || 'la/concert');

  const g = new THREE.Group();
  g.position.set(X, Y, Z);
  g.userData.studioName = row.name || 'WALT AURA CONCERT HALL';
  worldRoot.add(g);
  const inn = new THREE.Group();
  inn.userData.studioName = 'Concert hall interior';
  g.add(inn);

  const boxes = [];
  const batcher = makeBoxBatcher();
  const B = (p, w, h, d, lx, ly, lz, m, o = {}) =>
    Array.isArray(m) ? makeBox(p, w, h, d, lx, ly, lz, m, o) : batcher.add(p, w, h, d, lx, ly, lz, m, o);
  const S = (x0, x1, y0, y1, z0, z1, tag, climb) => boxes.push(addSolidBox(
    X + x0, X + x1, Y + y0, Y + y1, Z + z0, Z + z1, tag, climb));

  // --- Cloth Carpet Texture (assets/textures/cloth.png via assets.js) ------
  const clothClones = [];
  const baseClothTex = loadTexture('assets/textures/cloth.png', { repeatX: 1, repeatY: 1 });
  baseClothTex.wrapS = THREE.RepeatWrapping;
  baseClothTex.wrapT = THREE.RepeatWrapping;
  baseClothTex.colorSpace = THREE.SRGBColorSpace;
  baseClothTex.anisotropy = 8;
  const syncClothImage = () => {
    if (!baseClothTex.image) return;
    for (const tex of clothClones) {
      if (tex.image !== baseClothTex.image) {
        tex.image = baseClothTex.image;
        tex.needsUpdate = true;
      }
    }
  };
  if (!baseClothTex.image) {
    new THREE.ImageLoader().load('assets/textures/cloth.png', (img) => {
      baseClothTex.image = img;
      baseClothTex.needsUpdate = true;
      syncClothImage();
    });
  }
  const makeCarpetMat = (hex, rx, ry) => {
    const tex = baseClothTex.clone();
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.repeat.set(rx, ry);
    if (baseClothTex.image) tex.image = baseClothTex.image;
    tex.needsUpdate = true;
    clothClones.push(tex);
    const mat = M(hex, { map: tex, roughness: 0.92, metalness: 0.02 });
    mat.map = tex;
    mat.needsUpdate = true;
    return mat;
  };

  // --- Materials -----------------------------------------------------------
  const limestone    = M(0xf8fafc, { texType: 'concrete', repeatX: 8, repeatY: 6, roughness: 0.72 });
  const steel        = resolveMat('steel');
  const sail         = M(0xe2e8f0, { texType: 'brushedsteel', repeatX: 8, repeatY: 12, metalness: 0.92, roughness: 0.14, flatShading: false });
  const curtain      = M(0x9fd8f5, { metalness: 0.85, roughness: 0.06, transparent: true, opacity: 0.24, emissive: 0x0284c7, emissiveIntensity: 0.18, flatShading: false });
  curtain.side = THREE.DoubleSide; curtain.depthWrite = false;
  const marble       = M(0xf8fafc, { texType: 'marble', repeatX: 16, repeatY: 16, roughness: 0.14, clearcoat: 0.92, flatShading: false });
  const darkMarble   = M(0x1e293b, { texType: 'marble', repeatX: 10, repeatY: 10, roughness: 0.18, clearcoat: 0.85 });
  // Dedicated cloth-textured carpet materials with proportioned UV repeats
  const carpetRunner  = makeCarpetMat(0x7f1d1d, 4, 10);  // Grand Foyer crimson runner
  const carpetLounge  = makeCarpetMat(0x581c24, 5, 5);   // Foyer lounge & gallery carpets
  const carpetCorridor= makeCarpetMat(0x6b1d28, 4, 8);   // East recital corridor runner
  const carpetHallA   = makeCarpetMat(0x581c24, 18, 2);  // Hall A stepped terraces
  const carpetHallB   = makeCarpetMat(0x581c24, 8, 2);   // Hall B stepped terraces
  const carpetBalcony = makeCarpetMat(0x581c24, 14, 3);  // Upper balcony deck
  const seatMat      = makeCarpetMat(0x991b1b, 2, 2);   // Plush cloth upholstery
  const firWood      = M(0xb47b44, { texType: 'wood', repeatX: 8, repeatY: 6, roughness: 0.45 });
  const stageWood    = M(0x784822, { texType: 'wood', repeatX: 8, repeatY: 6, roughness: 0.55 });
  const pianoBlack   = M(0x09090b, { roughness: 0.08, metalness: 0.15, clearcoat: 1.0 });
  const organ        = M(0xdbeafe, { texType: 'brushedsteel', metalness: 0.94, roughness: 0.18, flatShading: false });
  // Emissive fixtures replace ALL interior PointLights (Part 1.3): the warm
  // glow reads as stage/foyer lighting with zero dynamic-light shader cost.
  const warmGlow     = M(0xfef3c7, { emissive: 0xfbbf24, emissiveIntensity: 1.7, roughness: 0.2 });
  const gold         = resolveMat('gold');
  const brass        = resolveMat('brass');
  const glass        = M(0xbfe6ff, { transparent: true, opacity: 0.20, roughness: 0.04, metalness: 0.10, side: THREE.DoubleSide, depthWrite: false, emissive: 0x1e3a5f, emissiveIntensity: 0.20 });

  // =========================================================================
  // SHELL — perimeter walls, flush wall-to-wall floor, roof & facade
  // =========================================================================
  const wallX = (z, x0, x1, y0 = 0, y1 = WALL_H, mat = limestone) => {
    B(g, x1 - x0, y1 - y0, T, (x0 + x1) / 2, (y0 + y1) / 2, z, mat, { cast: true, recv: true });
    S(x0, x1, y0, y1, z - T / 2, z + T / 2, 'wall', false);
  };
  const wallZ = (x, z0, z1, y0 = 0, y1 = WALL_H, mat = limestone) => {
    B(g, T, y1 - y0, z1 - z0, x, (y0 + y1) / 2, (z0 + z1) / 2, mat, { cast: true, recv: true });
    S(x - T / 2, x + T / 2, y0, y1, z0, z1, 'wall', false);
  };
  wallX(-HD, -HW - T / 2, HW + T / 2);       // north (back of house, sealed corners)
  wallZ(-HW, -HD - T / 2, HD + T / 2);       // west
  wallZ(HW, -HD - T / 2, HD + T / 2);        // east
  wallX(HD, -HW - T / 2, -3.0);              // south, west of grand doors
  wallX(HD, 3.0, HW + T / 2);                // south, east of grand doors
  B(g, 6.0, WALL_H - 4.8, T, 0, 4.8 + (WALL_H - 4.8) / 2, HD, limestone);
  S(-3.0, 3.0, 4.8, WALL_H, HD - T / 2, HD + T / 2, 'wall', false);

  // Exterior architectural pilasters
  for (let px = -HW + 2; px <= HW - 2; px += 4.0) {
    if (Math.abs(px) > 3.2) B(g, 0.36, WALL_H, 0.32, px, WALL_H / 2, HD + 0.16, limestone, { cast: true });
    B(g, 0.36, WALL_H, 0.32, px, WALL_H / 2, -HD - 0.16, limestone, { cast: true });
  }
  for (let pz = -HD + 2; pz <= HD - 2; pz += 4.0) {
    B(g, 0.32, WALL_H, 0.36, -HW - 0.16, WALL_H / 2, pz, limestone, { cast: true });
    B(g, 0.32, WALL_H, 0.36, HW + 0.16, WALL_H / 2, pz, limestone, { cast: true });
  }

  // Front curtain glazing + mullions
  for (const [a, b] of [[-HW + 0.4, -3.2], [3.2, HW - 0.4]]) {
    B(g, b - a, WALL_H - 2.4, 0.14, (a + b) / 2, 1.2 + (WALL_H - 2.4) / 2, HD + 0.28, curtain, { order: 3 });
    for (let x = a + 1.6; x < b - 0.8; x += 3.2) {
      B(g, 0.12, WALL_H - 2.4, 0.14, x, 1.2 + (WALL_H - 2.4) / 2, HD + 0.34, steel);
    }
    for (const hy of [4.8, 8.8, 12.6]) {
      B(g, b - a, 0.12, 0.14, (a + b) / 2, hy, HD + 0.34, steel);
    }
  }

  // Grand Portal Framing & Cantilevered Steel Canopy
  for (const s of [-1, 1]) {
    B(g, 0.45, 4.8, 0.65, s * 3.0, 2.4, HD + 0.25, steel, { cast: true });
    B(g, 0.22, 4.4, 0.22, s * 1.5, 2.2, HD + 0.10, brass);
  }
  B(g, 6.8, 0.42, 1.1, 0, 4.8, HD + 0.3, steel, { cast: true });
  B(g, 13.0, 0.32, 2.4, 0, 5.6, HD + 1.1, sail, { cast: true, name: 'Entrance canopy' });
  B(g, 11.6, 0.06, 0.14, 0, 5.42, HD + 2.0, warmGlow);

  // Full Wall-to-Wall Interior Floor Slab
  B(g, W, 0.10, D, 0, 0.05, 0, marble, { recv: true, name: 'Concert floor' });
  S(-IN_X, IN_X, 0, 0.10, -IN_Z, IN_Z, 'concert_floor', true);

  // Roof deck + clerestory light band
  B(g, W + 0.8, 0.5, D + 0.8, 0, WALL_H + 0.25, 0, sail, { cast: true, recv: true });
  S(-HW, HW, WALL_H, WALL_H + 0.5, -HD, HD, 'concert_roof', true);
  for (const s of [-1, 1]) {
    B(g, W - 1.6, 1.2, 0.12, 0, WALL_H - 0.9, s * (HD + 0.24), curtain, { order: 3 });
    B(g, 0.12, 1.2, D - 1.6, s * (HW + 0.24), WALL_H - 0.9, 0, curtain, { order: 3 });
  }

  // --- Sculptural Gehry Sails (Decor only — solids stay axis-aligned) --------
  const sails = row.sails || [
    { w: 14.5, h: 18.0, d: 0.45, at: [-9.5, 18.2, 9.5],  rot: [0.24, 0.36, -0.28] },
    { w: 16.0, h: 20.5, d: 0.45, at: [7.5, 19.4, 8.0],   rot: [-0.22, -0.38, 0.30] },
    { w: 19.0, h: 15.0, d: 0.45, at: [-1.0, 23.8, 1.0],  rot: [0.32, 0.14, -0.18] },
    { w: 13.5, h: 16.5, d: 0.45, at: [-12.5, 16.8, -1.5],rot: [0.18, 0.46, -0.22] },
    { w: 13.5, h: 16.0, d: 0.45, at: [12.0, 16.4, -3.5], rot: [-0.20, -0.44, 0.24] },
    { w: 15.0, h: 18.5, d: 0.45, at: [-6.5, 18.0, -10.5],rot: [-0.26, 0.28, 0.22] },
    { w: 14.0, h: 17.5, d: 0.45, at: [8.0, 17.6, -11.0], rot: [0.25, -0.26, -0.26] }
  ];
  for (const s of sails) {
    B(g, s.w, s.h, s.d, s.at[0], s.at[1], s.at[2], sail,
      { cast: true, rx: s.rot[0], ry: s.rot[1], rz: s.rot[2], name: 'Steel sail' });
  }
  neon(g, row.name || 'WALT AURA CONCERT HALL', 0, 13.8, HD + 0.42, '#0f172a', '#e0f2fe', 20.0, 1.8);
  neon(g, row.marquee || 'AURA PHILHARMONIC · LIVE IN CONCERT', 0, 6.4, HD + 0.42, '#0f172a', '#fde047', 14.0, 0.85);

  // =========================================================================
  // INTERNAL PARTITIONS (Sealed flush to perimeter walls & floor)
  // =========================================================================
  const HALL_A_EAST  = 6.25;  // Inner west face of wallZ(6.5)
  const HALL_B_WEST  = 6.75;  // Inner east face of wallZ(6.5)
  const FOYER_NORTH  = 5.25;  // Inner north face of wallX(5.0)
  const HALL_A_SOUTH = 4.75;  // Inner south face of wallX(5.0)
  const CORR_NORTH   = -1.75; // Inner north face of wallX(-2.0)
  const HALL_B_SOUTH = -2.25; // Inner south face of wallX(-2.0)
  wallZ(6.5, -IN_Z, FOYER_NORTH);           // Hall A ↔ east wing
  wallX(5.0, -11.4, -8.5);                  // Foyer ↔ Hall A (west flank)
  wallX(5.0, -1.5, HALL_B_WEST);            // Foyer ↔ Hall A (east flank)
  wallX(5.0, HALL_B_WEST, 9.2);             // Foyer ↔ corridor west jamb
  wallX(5.0, 13.8, IN_X);                   // Foyer ↔ corridor east jamb
  wallX(-2.0, HALL_B_WEST, 9.2);            // Corridor ↔ Hall B west jamb
  wallX(-2.0, 13.8, IN_X);                  // Corridor ↔ Hall B east jamb

  // Portal trim & wayfinding headers
  for (const px of [-8.4, -1.6]) B(inn, 0.24, 4.6, 0.64, px, 2.3, 5.0, firWood);
  B(inn, 7.2, 0.28, 0.64, -5.0, 4.6, 5.0, firWood);
  neon(inn, 'HALL A · MAIN AUDITORIUM', -5.0, 5.2, 5.34, '#0f172a', '#38bdf8', 6.4, 0.55);
  neon(inn, 'HALL B · RECITAL', 11.5, 4.4, 5.34, '#0f172a', '#fde047', 4.2, 0.50);

  // =========================================================================
  // HALL A — wall-to-wall vineyard terraces, clear aisles, stage, piano & organ
  // =========================================================================
  const HA_W = HALL_A_EAST - (-IN_X); // 22.0 m exact wall-to-wall width
  const HA_CX = (-IN_X + HALL_A_EAST) / 2; // -4.75

  // Acoustic Douglas fir wall cladding
  for (let wz = -14.2; wz <= 3.8; wz += 2.5) {
    B(inn, 0.12, 11.5, 2.2, -IN_X + 0.06, 6.5, wz, firWood, { recv: true });
    B(inn, 0.12, 11.5, 2.2, HALL_A_EAST - 0.06, 6.5, wz, firWood, { recv: true });
  }

  // Cloth carpeting across Hall A level floor zones
  B(inn, HA_W, 0.02, HALL_A_SOUTH - 1.60, HA_CX, 0.11, (1.60 + HALL_A_SOUTH) / 2, carpetHallA, { recv: true });
  B(inn, HA_W, 0.02, 1.70, HA_CX, 0.11, -8.35, carpetHallA, { recv: true });

  const seatT = [], backT = [], armT = [];
  const seatBank = (y, zc, banks, list = seatT, backs = backT) => {
    for (const [bx0, bx1] of banks) {
      const count = 8;
      const step = (bx1 - bx0) / count;
      for (let s = 0; s < count; s++) {
        const sx = bx0 + step * (s + 0.5);
        xform(list, sx, y + 0.42, zc, 0.84, 0.14, 0.80);
        xform(backs, sx, y + 0.76, zc + 0.34, 0.84, 0.64, 0.14);
        xform(armT, sx - step * 0.48, y + 0.56, zc + 0.04, 0.08, 0.26, 0.62);
      }
      xform(armT, bx1 - 0.06, y + 0.56, zc + 0.04, 0.08, 0.26, 0.62);
      S(bx0, bx1, y, y + 0.95, zc - 0.42, zc + 0.42, 'auditorium_seat', true);
    }
  };
  const BANKS_A = [[-13.9, -6.3], [-3.2, 4.4]];

  // 7 Stepped Vineyard Terraces spanning full wall-to-wall width
  for (let i = 0; i < 7; i++) {
    const zc = -6.85 + i * 1.30;
    const ty = 0.35 + i * 0.25;
    B(inn, HA_W, ty, 1.30, HA_CX, 0.10 + ty / 2, zc, carpetHallA, { recv: true });
    B(inn, 2.8, 0.04, 0.06, HA_CX, 0.10 + ty + 0.02, zc - 0.62, warmGlow);
    S(-IN_X, HALL_A_EAST, 0.10, 0.10 + ty, zc - 0.65, zc + 0.65, 'auditorium_terrace', true);
    seatBank(0.10 + ty, zc, BANKS_A);
  }

  // Walkable Aisle Stairs
  const AISLES_A = [[-IN_X, -14.1], [-6.1, -3.4], [4.6, HALL_A_EAST]];
  for (let s = 0; s < 7; s++) {
    const stepH = (s + 1) * 0.25;
    const sz = 4.20 - s * 0.40;
    for (const [ax0, ax1] of AISLES_A) {
      B(inn, ax1 - ax0, stepH, 0.40, (ax0 + ax1) / 2, 0.10 + stepH / 2, sz, carpetHallA, { recv: true });
      S(ax0, ax1, 0.10, 0.10 + stepH, sz - 0.20, sz + 0.20, 'auditorium_stair', true);
    }
  }

  // Stage (Wall-to-Wall) + Access Steps
  B(inn, HA_W, 1.0, 6.55, HA_CX, 0.60, -12.475, stageWood, { cast: true, recv: true, name: 'Hall A stage' });
  B(inn, HA_W, 0.10, 0.22, HA_CX, 1.12, -9.25, brass);
  S(-IN_X, HALL_A_EAST, 0.10, 1.10, -IN_Z, -9.20, 'stage', true);
  for (let i = 0; i < 2; i++) {
    const stepH = (i + 1) * 0.34;
    const sz = -8.35 - i * 0.42;
    B(inn, 3.4, stepH, 0.42, HA_CX, 0.10 + stepH / 2, sz, firWood, { recv: true });
    S(HA_CX - 1.7, HA_CX + 1.7, 0.10, 0.10 + stepH, sz - 0.21, sz + 0.21, 'stage_stair', true);
  }

  // Conductor's Podium & Music Stand
  B(inn, 1.4, 0.20, 1.2, HA_CX, 1.20, -10.1, firWood);
  B(inn, 0.06, 0.95, 0.06, HA_CX, 1.75, -10.4, brass);
  B(inn, 0.65, 0.04, 0.42, HA_CX, 2.22, -10.4, firWood, { rx: 0.45 });

  // Concert Grand Piano (Stage Left) — bespoke geometry stays a real group
  const pianoA = new THREE.Group();
  pianoA.position.set(-8.8, 1.10, -11.6);
  pianoA.rotation.y = 0.48;
  const pBodyA = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.34, 2.25), pianoBlack);
  pBodyA.position.set(0, 0.82, 0);
  const pCurveA = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.76, 0.34, 18), pianoBlack);
  pCurveA.position.set(0.02, 0.82, -1.05);
  const pLidA = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.05, 2.20), pianoBlack);
  pLidA.position.set(-0.22, 1.24, 0);
  pLidA.rotation.z = 0.34;
  const pPropA = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.62, 8), brass);
  pPropA.position.set(0.45, 1.15, -0.3);
  pianoA.add(pBodyA, pCurveA, pLidA, pPropA);
  for (const [lx, lz] of [[-0.62, 0.88], [0.62, 0.88], [0, -1.45]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.04, 0.68, 8), pianoBlack);
    leg.position.set(lx, 0.34, lz);
    pianoA.add(leg);
  }
  inn.add(pianoA);

  // Pipe Organ (Flush against North Wall behind Stage)
  B(inn, 17.6, 1.2, 1.2, HA_CX, 1.70, -15.1, firWood);
  B(inn, 17.8, 0.22, 1.3, HA_CX, 2.38, -15.1, brass);
  const pipeT = [];
  for (let i = 0; i < 25; i++) {
    const distFromCenter = Math.abs(i - 12);
    const wave = Math.cos(distFromCenter * 0.42) * 3.0 + (distFromCenter % 4 === 0 ? 1.3 : 0);
    const ph = Math.max(3.6, 7.8 + wave);
    const radius = distFromCenter % 4 === 0 ? 0.34 : 0.24;
    xform(pipeT, HA_CX - 8.4 + i * 0.70, 2.45 + ph / 2, -15.1, radius * 2, ph, radius * 2);
  }
  flushInstances(inn, geo('cyl'), organ, pipeT, { name: 'Organ pipes' });

  // Sculpted Acoustic Cloud Reflectors
  for (const s of [
    { w: 9.5, h: 0.24, d: 4.8, at: [-9.0, 12.6, -4.5], rot: [0.18, 0.08, -0.12] },
    { w: 9.5, h: 0.24, d: 4.8, at: [-0.5, 12.6, -4.5], rot: [0.18, -0.08, 0.12] },
    { w: 10.5, h: 0.24, d: 4.6, at: [HA_CX, 13.6, -0.5], rot: [0.14, 0.0, 0.0] },
    { w: 8.5, h: 0.24, d: 4.2, at: [-9.2, 13.2, 2.2],  rot: [-0.14, 0.10, -0.10] },
    { w: 8.5, h: 0.24, d: 4.2, at: [-0.3, 13.2, 2.2],  rot: [-0.14, -0.10, 0.10] }
  ]) {
    B(inn, s.w, s.h, s.d, s.at[0], s.at[1], s.at[2], firWood, { cast: true, rx: s.rot[0], ry: s.rot[1], rz: s.rot[2] });
  }
  // Emissive light strips (replace the former Hall A PointLight)
  for (const lx of [-10.2, HA_CX, 0.7]) B(inn, 0.6, 0.10, 14, lx, WALL_H - 1.2, -3.5, warmGlow);

  // =========================================================================
  // BALCONY + GRAND WEST FOYER STAIR
  // =========================================================================
  const STAIR_X0 = -IN_X;
  const STAIR_X1 = -11.40;
  const STAIR_W  = STAIR_X1 - STAIR_X0;
  const STAIR_CX = (STAIR_X0 + STAIR_X1) / 2;
  for (let i = 0; i < 16; i++) {
    const sy = 0.10 + i * 0.49375;
    const sz = 14.20 - i * 0.72;
    B(inn, STAIR_W, 0.49375, 0.72, STAIR_CX, sy + 0.2468, sz, marble, { recv: true });
    B(inn, STAIR_W - 0.2, 0.04, 0.06, STAIR_CX, sy + 0.50, sz + 0.34, brass);
    S(STAIR_X0, STAIR_X1, sy, sy + 0.49375, sz - 0.36, sz + 0.36, 'foyer_stair', true);
  }
  B(inn, 0.12, 1.0, 11.6, STAIR_X1, 4.5, 8.8, glass, { order: 3 });
  B(inn, 0.14, 0.10, 11.6, STAIR_X1, 5.05, 8.8, brass);
  S(STAIR_X1 - 0.08, STAIR_X1 + 0.08, 0.10, 8.0, 3.0, 14.6, 'stair_rail', true);

  const BALC_X0 = STAIR_X1;
  const BALC_X1 = HALL_A_EAST;
  const BALC_W  = BALC_X1 - BALC_X0;
  const BALC_CX = (BALC_X0 + BALC_X1) / 2;
  const BALC_Z0 = 1.80;
  const BALC_Z1 = HALL_A_SOUTH;
  const BALC_D  = BALC_Z1 - BALC_Z0;
  const BALC_CZ = (BALC_Z0 + BALC_Z1) / 2;
  B(inn, BALC_W, 0.32, BALC_D, BALC_CX, 7.84, BALC_CZ, firWood, { recv: true, name: 'Balcony deck' });
  B(inn, BALC_W, 0.02, BALC_D, BALC_CX, 8.01, BALC_CZ, carpetBalcony, { recv: true });
  S(BALC_X0, BALC_X1, 7.70, 8.00, BALC_Z0, BALC_Z1, 'balcony_deck', true);
  B(inn, 14.45, 0.40, 1.15, -0.975, 8.20, 4.175, carpetBalcony, { recv: true });
  S(-8.20, BALC_X1, 8.00, 8.40, 3.60, BALC_Z1, 'balcony_terrace', true);
  const BANKS_BALC = [[-8.0, -1.6], [-0.4, 5.8]];
  const balcSeatBank = (y, zc) => {
    for (const [bx0, bx1] of BANKS_BALC) {
      const count = 7;
      const step = (bx1 - bx0) / count;
      for (let s = 0; s < count; s++) {
        const sx = bx0 + step * (s + 0.5);
        xform(seatT, sx, y + 0.42, zc, 0.80, 0.14, 0.76);
        xform(backT, sx, y + 0.74, zc + 0.32, 0.80, 0.60, 0.14);
      }
      S(bx0, bx1, y, y + 0.92, zc - 0.40, zc + 0.40, 'auditorium_seat', true);
    }
  };
  balcSeatBank(8.00, 3.05);
  balcSeatBank(8.40, 4.15);
  B(inn, BALC_W, 1.05, 0.10, BALC_CX, 8.52, BALC_Z0 + 0.05, glass, { order: 3 });
  B(inn, BALC_W, 0.12, 0.18, BALC_CX, 9.08, BALC_Z0 + 0.05, brass);
  S(BALC_X0, BALC_X1, 8.0, 9.1, BALC_Z0, BALC_Z0 + 0.16, 'balcony_rail', true);
  B(inn, 0.12, 1.05, 1.60, BALC_X0, 8.52, 3.95, brass);
  S(BALC_X0 - 0.08, BALC_X0 + 0.08, 8.0, 9.1, 3.15, BALC_Z1, 'balcony_rail', true);
  flushInstances(inn, UNIT_BOX, seatMat, seatT, { recv: true, name: 'Auditorium seats' });
  flushInstances(inn, UNIT_BOX, seatMat, backT, { name: 'Seat backs' });
  flushInstances(inn, UNIT_BOX, firWood, armT, { name: 'Seat armrests' });

  // =========================================================================
  // HALL B — intimate recital hall
  // =========================================================================
  const HB_W  = IN_X - HALL_B_WEST;
  const HB_CX = (HALL_B_WEST + IN_X) / 2;
  B(inn, HB_W, 0.02, HALL_B_SOUTH - (-4.00), HB_CX, 0.11, (-4.00 + HALL_B_SOUTH) / 2, carpetHallB, { recv: true });
  B(inn, HB_W, 0.02, 1.20, HB_CX, 0.11, -11.80, carpetHallB, { recv: true });
  B(inn, HB_W, 0.50, 3.35, HB_CX, 0.35, -14.075, stageWood, { cast: true, recv: true, name: 'Hall B stage' });
  B(inn, HB_W, 6.2, 0.14, HB_CX, 3.7, -IN_Z + 0.07, firWood, { recv: true });
  S(HALL_B_WEST, IN_X, 0.10, 0.60, -IN_Z, -12.40, 'recital_stage', true);
  const pianoB = pianoA.clone();
  pianoB.scale.set(0.82, 0.82, 0.82);
  pianoB.position.set(10.8, 0.60, -13.7);
  pianoB.rotation.y = 0.35;
  inn.add(pianoB);
  const rSeatT = [], rBackT = [];
  for (let i = 0; i < 6; i++) {
    const zc = -10.60 + i * 1.20;
    const ty = 0.35 + i * 0.25;
    B(inn, HB_W, ty, 1.20, HB_CX, 0.10 + ty / 2, zc, carpetHallB, { recv: true });
    S(HALL_B_WEST, IN_X, 0.10, 0.10 + ty, zc - 0.60, zc + 0.60, 'recital_terrace', true);
    for (let s = 0; s < 6; s++) {
      const sx = 8.90 + s * 0.94;
      xform(rSeatT, sx, 0.10 + ty + 0.42, zc, 0.84, 0.14, 0.80);
      xform(rBackT, sx, 0.10 + ty + 0.76, zc + 0.34, 0.84, 0.64, 0.14);
    }
    S(8.45, 14.05, 0.10 + ty, 0.10 + ty + 0.92, zc - 0.42, zc + 0.42, 'recital_seat', true);
  }
  for (let s = 0; s < 6; s++) {
    const stepH = (s + 1) * 0.25;
    const sz = -2.35 - s * 0.30;
    for (const [ax0, ax1] of [[HALL_B_WEST, 8.30], [14.20, IN_X]]) {
      B(inn, ax1 - ax0, stepH, 0.30, (ax0 + ax1) / 2, 0.10 + stepH / 2, sz, carpetHallB, { recv: true });
      S(ax0, ax1, 0.10, 0.10 + stepH, sz - 0.15, sz + 0.15, 'recital_stair', true);
    }
  }
  flushInstances(inn, UNIT_BOX, seatMat, rSeatT, { recv: true, name: 'Recital seats' });
  flushInstances(inn, UNIT_BOX, seatMat, rBackT, { name: 'Recital seat backs' });
  // Emissive strip (replaces the former Hall B PointLight)
  B(inn, 0.6, 0.10, 10, HB_CX, 7.4, -8, warmGlow);

  // Gallery Corridor Cloth Carpet Runner + Framed Posters
  B(inn, 4.4, 0.02, FOYER_NORTH - CORR_NORTH, 11.5, 0.11, (CORR_NORTH + FOYER_NORTH) / 2, carpetCorridor, { recv: true });
  B(inn, 0.10, 0.024, FOYER_NORTH - CORR_NORTH, 9.28, 0.112, (CORR_NORTH + FOYER_NORTH) / 2, brass);
  B(inn, 0.10, 0.024, FOYER_NORTH - CORR_NORTH, 13.72, 0.112, (CORR_NORTH + FOYER_NORTH) / 2, brass);
  for (const [pz, txt] of [[0.2, 'SEASON 2026 · MAHLER CYCLE'], [2.8, 'CHAMBER SERIES · SUNDAYS']]) {
    B(inn, 0.08, 1.8, 1.4, HALL_B_WEST + 0.04, 2.4, pz, brass);
    neon(inn, txt, HALL_B_WEST + 0.10, 2.4, pz, '#0f172a', '#fde047', 1.25, 1.65, { ry: Math.PI / 2 });
  }

  // =========================================================================
  // GRAND FOYER — plush cloth carpets, open concourse, concierge & lounge bar
  // =========================================================================
  const RUNNER_Z0 = FOYER_NORTH;
  const RUNNER_Z1 = IN_Z;
  const RUNNER_D  = RUNNER_Z1 - RUNNER_Z0;
  const RUNNER_CZ = (RUNNER_Z0 + RUNNER_Z1) / 2;
  B(inn, 4.6, 0.02, RUNNER_D, 0, 0.11, RUNNER_CZ, carpetRunner, { recv: true, name: 'Foyer red carpet' });
  B(inn, 0.12, 0.024, RUNNER_D, -2.35, 0.112, RUNNER_CZ, brass);
  B(inn, 0.12, 0.024, RUNNER_D, 2.35, 0.112, RUNNER_CZ, brass);
  B(inn, 3.6, 0.02, 4.4, 11.5, 0.11, 7.45, carpetLounge, { recv: true });
  for (const sx of [-8.8, -1.2]) {
    for (const sz of [5.6, 7.2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.92, 10), brass);
      post.position.set(sx, 0.56, sz);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.06, 12), brass);
      base.position.set(sx, 0.13, sz);
      inn.add(post, base);
    }
    B(inn, 0.04, 0.04, 1.6, sx, 0.88, 6.4, carpetRunner);
  }

  // Concierge & Box Office (West niche beside stairs)
  B(inn, 5.2, 0.02, 4.2, -8.4, 0.11, 13.65, carpetLounge, { recv: true });
  B(inn, 3.8, 1.12, 1.1, -8.4, 0.66, 14.3, firWood);
  B(inn, 4.0, 0.10, 1.25, -8.4, 1.27, 14.3, darkMarble);
  S(-10.4, -6.4, 0.10, 1.32, 13.7, 14.9, 'box_office', true);
  neon(inn, 'CONCIERGE & TICKETS', -8.4, 2.6, 15.4, '#0f172a', '#fde047', 3.8, 0.55);

  // Foyer Champagne & Espresso Bar (East-south alcove)
  B(inn, 5.8, 0.02, 4.2, 9.6, 0.11, 13.65, carpetLounge, { recv: true });
  B(inn, 4.4, 1.10, 1.2, 9.6, 0.65, 14.1, firWood);
  B(inn, 4.6, 0.12, 1.35, 9.6, 1.26, 14.1, darkMarble);
  B(inn, 4.2, 2.4, 0.35, 9.6, 1.30, 15.4, firWood);
  S(7.4, 11.8, 0.10, 1.32, 13.4, 14.8, 'foyer_bar', true);
  neon(inn, 'INTERMISSION LOUNGE', 9.6, 2.9, 15.2, '#0f172a', '#fde047', 3.8, 0.55);
  for (let i = 0; i < 4; i++) {
    const glassStem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.28, 10), brass);
    glassStem.position.set(8.2 + i * 0.9, 1.46, 13.9);
    inn.add(glassStem);
  }

  // Architectural Concentric Ring & Crystal Chandelier
  // (emissive crystals replace the former foyer PointLight)
  const chGroup = new THREE.Group();
  chGroup.position.set(0, 11.8, 10.2);
  const chT = [];
  for (const [ringR, ringY, dropCount] of [[2.2, 0.6, 24], [1.5, -0.3, 18], [0.8, -1.2, 12]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.045, 10, 36), brass);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = ringY;
    chGroup.add(ring);
    for (let i = 0; i < dropCount; i++) {
      const a = (i / dropCount) * Math.PI * 2;
      xform(chT, Math.cos(a) * ringR, 11.8 + ringY - 0.25, 10.2 + Math.sin(a) * ringR, 0.12, 0.36, 0.12);
    }
  }
  inn.add(chGroup);
  flushInstances(inn, geo('cyl'), warmGlow, chT, { name: 'Foyer chandelier crystals' });
  B(inn, 0.08, 3.6, 0.08, 0, 14.2, 10.2, brass);

  // =========================================================================
  // TROPHY GALLERY — flush against east foyer wall, carpeted viewing gallery
  // =========================================================================
  B(inn, 2.8, 0.02, 7.6, IN_X - 1.4, 0.11, 9.8, carpetLounge, { recv: true });
  const trophies = [];
  const CASE_X = IN_X - 0.425;
  TROPHIES.forEach((t, i) => {
    const zc = 7.4 + i * 2.45;
    B(inn, 0.85, 0.92, 2.1, CASE_X, 0.56, zc, darkMarble, { recv: true });
    B(inn, 0.90, 0.06, 2.2, CASE_X, 1.05, zc, brass);
    B(inn, 0.78, 1.55, 2.0, CASE_X, 1.85, zc, glass, { order: 3 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      B(inn, 0.05, 1.55, 0.05, CASE_X + sx * 0.37, 1.85, zc + sz * 0.98, brass);
    }
    B(inn, 0.85, 0.08, 2.15, CASE_X, 2.65, zc, darkMarble);
    B(inn, 0.45, 0.04, 1.6, CASE_X, 2.59, zc, warmGlow);
    S(IN_X - 0.85, IN_X, 0.10, 2.65, zc - 1.05, zc + 1.05, 'trophy_case', true);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.14, 14), brass);
    stand.position.set(CASE_X, 1.15, zc);
    inn.add(stand);
    let piece;
    if (t.id === 'gramophone') {
      piece = new THREE.Group();
      const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.10, 16), gold);
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.30, 0.62, 16, 1, true), gold);
      horn.rotation.set(0, 0, -0.85);
      horn.position.set(0.06, 0.44, 0);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 8), brass);
      arm.position.set(-0.12, 0.20, 0);
      piece.add(deck, horn, arm);
    } else if (t.id === 'baton') {
      piece = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.032, 0.86, 10), gold);
      shaft.rotation.z = 0.42;
      shaft.position.y = 0.44;
      const grip = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), resolveMat('carbon'));
      grip.position.set(-0.17, 0.06, 0);
      const cradle = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 16), brass);
      cradle.rotation.x = Math.PI / 2;
      cradle.position.y = 0.10;
      piece.add(shaft, grip, cradle);
    } else {
      piece = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.035, 24), resolveMat('chrome'));
      disc.rotation.z = Math.PI / 2;
      disc.position.y = 0.44;
      const label = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.045, 18), gold);
      label.rotation.z = Math.PI / 2;
      label.position.y = 0.44;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.30, 8), brass);
      post.position.y = 0.15;
      piece.add(disc, label, post);
    }
    piece.position.set(CASE_X, 1.24, zc);
    piece.rotation.y = -Math.PI / 2;
    piece.userData.studioName = `Trophy: ${t.label}`;
    inn.add(piece);
    neon(inn, `${t.label} · ${t.year}`, IN_X - 0.90, 0.62, zc, '#0f172a', '#fde047', 1.9, 0.32, { ry: -Math.PI / 2 });
    trophies.push({ ...t, mesh: piece, x: X + CASE_X, y: Y + 1.5, z: Z + zc, spin: rng() * 6.28 });
  });
  neon(inn, 'PHILHARMONIC ARCHIVE', IN_X - 0.90, 3.2, 9.85, '#0f172a', '#fbbf24', 5.6, 0.55, { ry: -Math.PI / 2 });

  // Materialise every batched static box BEFORE registering the interior cull.
  batcher.flush();

  // =========================================================================
  // ZONES · MAP · CULL · RESERVATION
  // =========================================================================
  (aura.culls || (aura.culls = [])).push({ g: inn, x: X, z: Z, r: row.cullR ?? 115 });
  zone('WALT AURA CONCERT HALL — GRAND FOYER', X - IN_X, X + IN_X, Z + FOYER_NORTH, Z + IN_Z);
  zone('WALT AURA CONCERT HALL — HALL A', X - IN_X, X + HALL_A_EAST, Z - IN_Z, Z + HALL_A_SOUTH);
  zone('WALT AURA CONCERT HALL — HALL B', X + HALL_B_WEST, X + IN_X, Z - IN_Z, Z + HALL_B_SOUTH);
  zone('WALT AURA CONCERT HALL — BALCONY', X + BALC_X0, X + BALC_X1, Z + BALC_Z0, Z + BALC_Z1);
  mapRect(X, Z, W, D, '#e2e8f0', '#38bdf8', true);
  reserveFootprint(X - HW - 1, X + HW + 1, Z - HD - 1, Z + HD + 1, 'landmark');

  return {
    object: g, boxes, interior: inn, trophies,
    halls: [
      { id: 'A', name: 'MAIN AUDITORIUM', seats: 140, x: X + HA_CX, z: Z - 4 },
      { id: 'B', name: 'RECITAL HALL', seats: 36, x: X + HB_CX, z: Z - 8 }
    ],
    anchors: {
      door: [X, Y, Z + HD],
      stage: [X + HA_CX, Y + 1.10, Z - 12.0],
      boxOffice: [X - 8.4, Y + 0.10, Z + 13.0],
      trophies: [X + 13.6, Y + 0.10, Z + 9.85],
      balcony: [X - 9.8, Y + 8.00, Z + 2.50]
    }
  };
}

export const CONCERT_BUILDERS = { concert_hall: buildConcertHall };
export default CONCERT_BUILDERS;