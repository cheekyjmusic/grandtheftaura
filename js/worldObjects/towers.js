// =============================================================================
// worldObjects/towers.js — DATA-DRIVEN SKYSCRAPERS
//
//   • four exterior archetypes (glass / deco / slab / brutalist)
//   • six crown variants (helipad / block / crown / sail / pyramid / spire)
//   • three lobby interiors, streamed by worldStream via skyscrapers[]
//   • furnished upper floors, streamed per vertical band by expandTowerFloors
//
// COLLIDER MODEL (changed from the original — this is what makes floors work)
//   lobby      5 walls with a door gap                      permanent
//   shaft      4 perimeter walls, lobbyH -> h               permanent
//   lobby ceil slab at lobbyH (= floor 1's floor)           permanent
//   roof       slab at h -> h+0.55, climbable               permanent
//   floor i    slab + furniture                             streamed
// The interior volume is EMPTY. The old monolithic 'skyscraper_roof' box would
// have made every furnished floor unreachable.
//
// SHAFT GLASS IS OPAQUE AND FRONT-SIDE. From outside you see a reflective
// tower; from inside every shaft face is a backface, so you see out through
// the streamed floor's own transparent glazing. No double-glazing artefacts.
// =============================================================================
import * as THREE from 'three';
import {
  aviationBeacons, enterableZones, mapShapes, registerBuildingLod, skyscrapers
} from '../state.js';
import { makeMat, realWindowGlassMat, worldRoot } from '../engine.js';
import {
  UNIT_BOX, addSolidBox, flushInstances, footprintClear, makeBox, xform
} from '../worldKit.js';
import { neon } from './shell.js';

export const TOWER_WALL_T = 0.48;
export const TOWER_DOOR_W = 3.2;
export const TOWER_DEFAULT_FLOOR_H = 3.55;
export const TOWER_MIN_LOBBY_H = 4.6;

// -----------------------------------------------------------------------------
// METRICS — the single source of truth for height and floor elevation.
// worldObjects/index.js imports these for the adapter AND expandTowerFloors.
// -----------------------------------------------------------------------------
export function towerMetrics(row = {}) {
  const floors = Math.max(1, Math.round(row.floors || 12));
  const floorH = row.floorH || TOWER_DEFAULT_FLOOR_H;
  const lobbyH = row.lobbyH || Math.max(TOWER_MIN_LOBBY_H, floorH);
  return { floors, floorH, lobbyH, h: lobbyH + (floors - 1) * floorH };
}
export function towerFloorY(baseY, i, m) {
  return i <= 0 ? baseY : baseY + m.lobbyH + (i - 1) * m.floorH;
}

// -----------------------------------------------------------------------------
// MATERIAL / GEOMETRY CACHES  (module-owned; kit disposal skips them)
// -----------------------------------------------------------------------------
const towerGeos = [], towerMats = [];
const matCache = new Map(), facadeCache = new Map();
const tGeo = (g) => { g.userData.shared = true; towerGeos.push(g); return g; };
const tMat = (m) => { m.userData.shared = true; towerMats.push(m); return m; };

function frameMat(hex) {
  const k = 'f' + hex;
  if (!matCache.has(k)) matCache.set(k, tMat(makeMat(hex, {
    texType: 'brushedsteel', repeatX: 4, repeatY: 12, metalness: 0.88, roughness: 0.24, flatShading: false
  })));
  return matCache.get(k);
}
function glassMat(hex) {
  const k = 'g' + hex;
  if (!matCache.has(k)) matCache.set(k, tMat(makeMat(hex, {
    metalness: 0.90, roughness: 0.10, clearcoat: 1.0, clearcoatRoughness: 0.05,
    envMapIntensity: 2.1, emissive: hex, emissiveIntensity: 0.14, flatShading: false
  })));
  return matCache.get(k);
}
function plainMat(hex, opts) {
  const k = 'p' + hex + JSON.stringify(opts || {});
  if (!matCache.has(k)) matCache.set(k, tMat(makeMat(hex, opts || {})));
  return matCache.get(k);
}
const marbleMat = () => plainMat(0xf8fafc, {
  texType: 'marble', repeatX: 5, repeatY: 5, roughness: 0.18, clearcoat: 0.85, flatShading: false
});

/** Lit-window facade for the slab archetype. Deterministic, cached by grid. */
function facadeMat(hex, cols, rows) {
  const k = `${hex}:${cols}x${rows}`;
  if (facadeCache.has(k)) return facadeCache.get(k);
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = '#' + new THREE.Color(hex).getHexString();
  c.fillRect(0, 0, 64, 128);
  for (let r = 0; r < 16; r++) for (let col = 0; col < 8; col++) {
    const lit = Math.sin((r * 9 + col * 3 + hex) * 12.9898) * 43758.5453;
    c.fillStyle = (lit - Math.floor(lit)) < 0.34 ? '#ffe9a8' : '#2f4a63';
    c.fillRect(col * 8 + 1, r * 8 + 1, 6, 6);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(cols, rows);
  const m = tMat(new THREE.MeshStandardMaterial({
    map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.34, metalness: 0.38
  }));
  facadeCache.set(k, m);
  return m;
}

const tbx = (p, m, x, y, z, sx, sy, sz, cast = true) =>
  makeBox(p, sx, sy, sz, x, y, z, m, { cast, recv: true });

/** Repeated horizontal bands as ONE instanced draw call. */
function towerBands(parent, m, w, d, y0, y1, step, thick = 0.26, grow = 0.16) {
  const n = Math.max(0, Math.floor((y1 - y0) / step));
  if (!n) return null;
  const t = [];
  for (let i = 0; i < n; i++) xform(t, 0, y0 + i * step, 0, w + grow, thick, d + grow);
  return flushInstances(parent, UNIT_BOX, m, t, { cast: true });
}

// -----------------------------------------------------------------------------
// EXTERIOR ARCHETYPES — shaft only. p.lobbyH is the ground storey height.
// -----------------------------------------------------------------------------
const ARCHETYPES = {
  glass: {
    lobby: 'corporate',
    shaft(g, p, fm, gm, lod) {
      const upper = p.h - p.lobbyH;
      tbx(g, gm, 0, p.lobbyH + upper / 2, 0, p.w, upper, p.d);
      towerBands(lod, fm, p.w, p.d, p.lobbyH + 6, p.h, 6);
      for (const cx of [-p.w / 2, p.w / 2]) for (const cz of [-p.d / 2, p.d / 2]) {
        tbx(lod, fm, cx, p.h / 2, cz, 0.32, p.h, 0.32);
      }
    }
  },
  deco: {
    lobby: 'finance',
    shaft(g, p, fm, gm, lod) {
      let y = p.lobbyH;
      for (const [scale, frac] of [[1.00, 0.50], [0.78, 0.30], [0.56, 0.20]]) {
        const th = (p.h - p.lobbyH) * frac;
        tbx(g, gm, 0, y + th / 2, 0, p.w * scale, th, p.d * scale);
        tbx(g, fm, 0, y + th, 0, p.w * scale + 0.7, 0.4, p.d * scale + 0.7);
        y += th;
      }
      towerBands(lod, fm, p.w, p.d, p.lobbyH + 4, p.lobbyH + (p.h - p.lobbyH) * 0.5, 5, 0.3, 0.3);
      for (const cx of [-p.w * 0.36, p.w * 0.36]) {
        tbx(lod, fm, cx, p.lobbyH + (p.h - p.lobbyH) * 0.25, p.d / 2 + 0.06,
          0.5, (p.h - p.lobbyH) * 0.5, 0.24);
      }
      tbx(lod, plainMat(0xfacc15, { emissive: 0xca8a04, emissiveIntensity: 0.5 }),
        0, p.h + 1.6, 0, 0.5, 3.2, 0.5);
    }
  },
  slab: {
    lobby: 'residential',
    shaft(g, p, fm, gm, lod) {
      const upper = p.h - p.lobbyH;
      const wall = facadeMat(p.frameHex, Math.max(1, Math.round(p.w / 4)), Math.max(2, Math.round(p.h / 7)));
      tbx(g, wall, 0, p.lobbyH + upper / 2, 0, p.w, upper, p.d);
      tbx(g, fm, 0, p.lobbyH + upper / 2, p.d / 2 + 0.05, p.w * 0.22, upper, 0.18);
      towerBands(lod, fm, p.w, p.d, p.lobbyH + 3.2, p.h, 3.2, 0.18, 0.9);
      tbx(lod, fm, 0, p.h + 0.9, 0, p.w * 0.9, 1.8, p.d * 0.9);
    }
  },
  brutalist: {
    lobby: 'corporate',
    shaft(g, p, fm, gm, lod) {
      const upper = p.h - p.lobbyH;
      const concrete = plainMat(p.frameHex, { texType: 'concrete', repeatX: 4, repeatY: 10, roughness: 0.9 });
      tbx(g, concrete, 0, p.lobbyH + upper / 2, 0, p.w, upper, p.d);
      const rows = Math.max(2, Math.floor(upper / 4));
      const t = [];
      for (let r = 0; r < rows; r++) for (const s of [-1, 1]) {
        xform(t, 0, p.lobbyH + 2.4 + r * 4, s * (p.d / 2 + 0.04), p.w * 0.86, 1.5, 0.12);
      }
      flushInstances(lod, UNIT_BOX, glassMat(p.glassHex), t);
      for (const cx of [-p.w / 2, p.w / 2]) tbx(lod, concrete, cx, p.lobbyH + upper / 2, 0, 0.6, upper, p.d + 0.3);
      tbx(lod, concrete, 0, p.h + 1.1, 0, p.w + 0.8, 2.2, p.d + 0.8);
    }
  }
};

// -----------------------------------------------------------------------------
// CROWNS — lifted out of buildLosAuraNorthExpansion, parameterised by w/d/h.
// -----------------------------------------------------------------------------
const CROWNS = {
  helipad(g, p, lod, fm) {
    const pad = new THREE.Mesh(tGeo(new THREE.CylinderGeometry(4.2, 4.2, 0.12, 20)), plainMat(0x334155));
    pad.position.y = p.h + 0.60;
    g.add(pad);
    const ring = new THREE.Mesh(tGeo(new THREE.RingGeometry(3.5, 3.95, 24)),
      tMat(new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide })));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = p.h + 0.67;
    lod.add(ring);
    const white = plainMat(0xf8fafc);
    tbx(lod, white, -0.9, p.h + 0.68, 0, 0.45, 0.08, 2.6, false);
    tbx(lod, white, 0.9, p.h + 0.68, 0, 0.45, 0.08, 2.6, false);
    tbx(lod, white, 0, p.h + 0.68, 0, 1.8, 0.08, 0.45, false);
  },
  block(g, p, lod, fm) {
    const dark = plainMat(0x0f172a, { metalness: 0.8, roughness: 0.3 });
    tbx(lod, dark, 0, p.h + 1.2, 0, p.w * 0.7, 2.2, p.d * 0.7);
    tbx(lod, tMat(new THREE.MeshBasicMaterial({ color: p.glassHex })),
      0, p.h + 3.4, 0, p.w * 0.4, 2.2, p.d * 0.4);
  },
  /** US Aura Tower — twin halo rings on four corner posts. */
  crown(g, p, lod, fm) {
    const steel = plainMat(0xe2e8f0, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.18, flatShading: false });
    const r1 = new THREE.Mesh(tGeo(new THREE.TorusGeometry(p.w * 0.43, 1.1, 10, 24)),
      plainMat(0xbae6fd, { metalness: 0.9, roughness: 0.12, emissive: 0x0284c7, emissiveIntensity: 0.25 }));
    r1.rotation.x = Math.PI / 2; r1.position.y = p.h + 2.3;
    const r2 = new THREE.Mesh(tGeo(new THREE.TorusGeometry(p.w * 0.317, 0.9, 10, 24)),
      plainMat(0xf8fafc, { metalness: 0.85, roughness: 0.2 }));
    r2.rotation.x = Math.PI / 2; r2.position.y = p.h + 6.1;
    const glow = new THREE.Mesh(tGeo(new THREE.TorusGeometry(p.w * 0.35, 0.25, 8, 24)),
      tMat(new THREE.MeshBasicMaterial({ color: 0x38bdf8 })));
    glow.rotation.x = Math.PI / 2; glow.position.y = p.h + 4.2;
    lod.add(r1, r2, glow);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      tbx(lod, steel, sx * p.w * 0.41, p.h + 1.9, sz * p.d * 0.41, 0.6, 3.4, 0.6);
    }
  },
  /** Wilshire Grand — tilted sail panel + offset spire. */
  sail(g, p, lod, fm) {
    tbx(lod, plainMat(0x7dd3fc, { metalness: 0.95, roughness: 0.08, emissive: 0x38bdf8, emissiveIntensity: 0.35 }),
      0, p.h + 7.7, 0, p.w * 0.94, 11.0, 1.4);
    const fin = lod.children[lod.children.length - 1];
    if (fin) fin.rotation.z = 0.24;
    const spire = new THREE.Mesh(tGeo(new THREE.CylinderGeometry(0.10, 0.42, 18.0, 8)),
      plainMat(0xe2e8f0, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.18, flatShading: false }));
    spire.position.set(p.w / 3, p.h + 12.7, 0);
    lod.add(spire);
  },
  /** City Hall — stepped white lantern + pyramid cap. */
  pyramid(g, p, lod, fm) {
    const white = plainMat(0xf8fafc, { roughness: 0.55 });
    tbx(lod, white, 0, p.h + 3.9, 0, p.w * 0.69, 8.0, p.d * 0.69);
    tbx(lod, white, 0, p.h + 10.9, 0, p.w * 0.44, 6.0, p.d * 0.44);
    const cap = new THREE.Mesh(tGeo(new THREE.ConeGeometry(p.w * 0.32, 5.5, 4)),
      plainMat(0xfef08a, { emissive: 0xfacc15, emissiveIntensity: 0.35 }));
    cap.rotation.y = Math.PI / 4;
    cap.position.y = p.h + 16.6;
    lod.add(cap);
  },
  spire(g, p, lod, fm) {
    const dark = plainMat(0x0f172a, { metalness: 0.8, roughness: 0.3 });
    tbx(lod, dark, 0, p.h + 1.0, 0, p.w * 0.5, 2.0, p.d * 0.5);
    const mast = new THREE.Mesh(tGeo(new THREE.CylinderGeometry(0.12, 0.55, 22.0, 8)),
      plainMat(0xe2e8f0, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.18, flatShading: false }));
    mast.position.y = p.h + 13.0;
    lod.add(mast);
  }
};

// -----------------------------------------------------------------------------
// LOBBY INTERIORS — returned specs are absolute-world colliders.
// -----------------------------------------------------------------------------
function elevatorKit(g, sk, steel) {
  tbx(g, steel, 0, 1.74, -sk.d / 2 + 1.25, 2.8, 3.4, 1.6);
  const ring = new THREE.Mesh(tGeo(new THREE.RingGeometry(0.85, 1.15, 20)),
    tMat(new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide })));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, 0.10, -sk.d / 2 + 2.4);
  g.add(ring);
  return {
    minX: sk.x - 1.4, maxX: sk.x + 1.4, minY: sk.baseY, maxY: sk.baseY + 3.42,
    minZ: sk.z - sk.d / 2 + 0.45, maxZ: sk.z - sk.d / 2 + 2.05,
    tag: 'elev_shaft', climbable: false
  };
}

const INTERIORS = {
  corporate(sk, g) {
    const dark = plainMat(0x0f172a);
    const gold = plainMat(0xf59e0b, { metalness: 0.85, roughness: 0.2 });
    const couch = plainMat(0x334155, { texType: 'fabric', roughness: 0.9 });
    const steel = plainMat(0xdbeafe, { texType: 'brushedsteel', metalness: 0.9, roughness: 0.2, flatShading: false });
    tbx(g, dark, -2.2, 0.56, 0.4, 4.2, 1.05, 1.2);
    tbx(g, gold, -2.2, 1.12, 0.4, 4.3, 0.08, 1.3);
    tbx(g, couch, -sk.w / 2 + 1.3, 0.42, -1.2, 1.1, 0.72, 2.8);
    tbx(g, couch, sk.w / 2 - 1.3, 0.42, -1.2, 1.1, 0.72, 2.8);
    const planter = new THREE.Mesh(tGeo(new THREE.CylinderGeometry(0.55, 0.45, 0.75, 10)), plainMat(0x78350f));
    planter.position.set(3.2, 0.42, 1.4);
    const plant = new THREE.Mesh(tGeo(new THREE.DodecahedronGeometry(0.75, 0)), plainMat(0x16a34a));
    plant.position.set(3.2, 1.15, 1.4);
    g.add(planter, plant);
    return [
      { minX: sk.x - 4.3, maxX: sk.x - 0.1, minY: sk.baseY, maxY: sk.baseY + 1.14,
        minZ: sk.z - 0.2, maxZ: sk.z + 1.0, tag: 'lobby_desk', climbable: true },
      elevatorKit(g, sk, steel)
    ];
  },
  finance(sk, g) {
    const marble = marbleMat();
    const granite = plainMat(0x1e293b, { texType: 'granite', repeatX: 3, repeatY: 1, roughness: 0.25, flatShading: false });
    const gold = plainMat(0xfbbf24, { metalness: 0.94, roughness: 0.15, flatShading: false });
    const steel = plainMat(0x94a3b8, { texType: 'brushedsteel', metalness: 0.94, roughness: 0.18, flatShading: false });
    const rope = plainMat(0x7f1d1d, { roughness: 0.8 });
    tbx(g, marble, -1.8, 0.58, -0.6, 6.4, 1.05, 1.1);
    tbx(g, granite, -1.8, 1.15, -0.6, 6.6, 0.12, 1.25);
    tbx(g, realWindowGlassMat, -1.8, 1.75, -0.6, 6.0, 1.1, 0.08, false);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      tbx(g, gold, sk.w / 2 - 2.4 + c * 0.5, 0.24 + r * 0.19, -sk.d / 2 + 1.6, 0.42, 0.18, 0.22);
    }
    for (const px of [-3.4, -0.2, 3.0]) {
      tbx(g, steel, px, 0.5, 2.4, 0.1, 1.0, 0.1);
      tbx(g, rope, px + 1.6, 0.86, 2.4, 3.2, 0.06, 0.06);
    }
    return [
      { minX: sk.x - 5.0, maxX: sk.x + 1.4, minY: sk.baseY, maxY: sk.baseY + 1.22,
        minZ: sk.z - 1.2, maxZ: sk.z, tag: 'lobby_teller', climbable: true },
      elevatorKit(g, sk, steel)
    ];
  },
  residential(sk, g) {
    const wall = plainMat(0xe2e8f0, { texType: 'siding', repeatX: 3, repeatY: 2 });
    const brass = plainMat(0xd97706, { metalness: 0.85, roughness: 0.3 });
    const couch = plainMat(0x475569, { texType: 'fabric', roughness: 0.92 });
    const steel = plainMat(0xcbd5e1, { texType: 'brushedsteel', metalness: 0.9, roughness: 0.22, flatShading: false });
    tbx(g, wall, -sk.w / 2 + 0.9, 1.3, 0.6, 0.5, 2.2, 4.4);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
      tbx(g, brass, -sk.w / 2 + 1.2, 0.55 + r * 0.5, -1.3 + c * 0.62, 0.08, 0.4, 0.52);
    }
    tbx(g, couch, sk.w / 2 - 1.5, 0.42, 1.0, 1.2, 0.72, 2.6);
    tbx(g, plainMat(0x78350f, { texType: 'wood' }), sk.w / 2 - 3.0, 0.3, 1.0, 1.0, 0.5, 1.4);
    for (let i = 0; i < 3; i++) tbx(g, steel, -1.0 + i * 0.9, 0.55, -sk.d / 2 + 3.4, 0.08, 1.1, 0.7);
    return [
      { minX: sk.x - sk.w / 2 + 0.4, maxX: sk.x - sk.w / 2 + 1.4, minY: sk.baseY, maxY: sk.baseY + 2.22,
        minZ: sk.z - 1.6, maxZ: sk.z + 2.8, tag: 'lobby_mail', climbable: false },
      elevatorKit(g, sk, steel)
    ];
  }
};

// -----------------------------------------------------------------------------
// buildTower
// -----------------------------------------------------------------------------
export function buildTower(p) {
  const A = ARCHETYPES[p.a] || ARCHETYPES.glass;
  const { x, z, w, d } = p;
  const m = towerMetrics(p);
  const lobbyH = p.lobbyH || m.lobbyH;
  const h = Number.isFinite(p.h) ? p.h : m.h;
  const baseY = Number.isFinite(p.baseY) ? p.baseY : 0.18;
  const T = TOWER_WALL_T, DW = TOWER_DOOR_W;

  // Same gate the original buildTowerDistricts used — per-row, exact footprint.
  if (!footprintClear(x, z, w, d)) {
    console.warn('[towers] lot rejected (blocked):', p.name, x, z);
    return null;
  }

  const fm = frameMat(p.frameHex), gm = glassMat(p.glassHex);
  const g = new THREE.Group();
  g.position.set(x, baseY, z);
  g.userData.studioName = p.name;
  worldRoot.add(g);

  const minX = x - w / 2, maxX = x + w / 2, minZ = z - d / 2, maxZ = z + d / 2;
  const boxes = [];
  const S = (x0, x1, y0, y1, z0, z1, tag, climb) => {
    const b = addSolidBox(x0, x1, y0, y1, z0, z1, tag, climb);
    boxes.push(b);
    return b;
  };

  // Out-of-grid lots get a sidewalk plinth (was in buildTowerDistricts).
  if (p.pad) {
    tbx(worldRoot, plainMat(0xcbd5e1, { texType: 'sidewalk', repeatX: 8, repeatY: 8, roughness: 0.85 }),
      x, baseY + 0.03, z, w + 9, 0.12, d + 9, false);
  }

  // ---- lobby shell -------------------------------------------------------
  tbx(g, marbleMat(), 0, 0.04, 0, w - 0.2, 0.08, d - 0.2, false);
  tbx(g, fm, 0, lobbyH / 2, -d / 2 + T / 2, w, lobbyH, T);
  tbx(g, fm, -w / 2 + T / 2, lobbyH / 2, 0, T, lobbyH, d);
  tbx(g, fm, w / 2 - T / 2, lobbyH / 2, 0, T, lobbyH, d);
  const segW = (w - DW) / 2;
  const doorH = Math.min(2.9, lobbyH - 1.0);
  for (const s of [-1, 1]) tbx(g, fm, s * (DW / 2 + segW / 2), lobbyH / 2, d / 2 - T / 2, segW, lobbyH, T);
  tbx(g, fm, 0, lobbyH - 0.65, d / 2 - T / 2, DW, 1.3, T);

  S(minX, maxX, baseY, baseY + lobbyH, minZ, minZ + T, 'wall', false);
  S(minX, minX + T, baseY, baseY + lobbyH, minZ, maxZ, 'wall', false);
  S(maxX - T, maxX, baseY, baseY + lobbyH, minZ, maxZ, 'wall', false);
  S(minX, x - DW / 2, baseY, baseY + lobbyH, maxZ - T, maxZ, 'wall', false);
  S(x + DW / 2, maxX, baseY, baseY + lobbyH, maxZ - T, maxZ, 'wall', false);

  // ---- shaft: perimeter only. The interior volume stays EMPTY. -----------
  const shaftMat = ARCHETYPES[p.a] ? fm : fm;
  S(minX, maxX, baseY + lobbyH, baseY + h, minZ, minZ + T, 'tower_wall', false);
  S(minX, minX + T, baseY + lobbyH, baseY + h, minZ, maxZ, 'tower_wall', false);
  S(maxX - T, maxX, baseY + lobbyH, baseY + h, minZ, maxZ, 'tower_wall', false);
  S(minX, maxX, baseY + lobbyH, baseY + h, maxZ - T, maxZ, 'tower_wall', false);

  // Lobby ceiling == floor 1's slab. Permanent, so a loading gap can never
  // drop the player into the lobby from the first storey.
  S(minX + 0.3, maxX - 0.3, baseY + lobbyH - 0.10, baseY + lobbyH + 0.10,
    minZ + 0.3, maxZ - 0.3, 'floor_slab', true);

  // ---- exterior shaft + roof --------------------------------------------
  const lod = new THREE.Group();
  A.shaft(g, { ...p, h, lobbyH }, fm, gm, lod);
  tbx(g, fm, 0, h + 0.275, 0, w + 0.5, 0.55, d + 0.5);
  S(minX, maxX, baseY + h, baseY + h + 0.55, minZ, maxZ, 'skyscraper_roof', true);

  // ---- lobby glazing + signage (LOD) ------------------------------------
  const glz = glassMat(p.glassHex);
  const glH = Math.min(2.7, lobbyH - 1.4), glY = glH / 2 + 0.65;
  tbx(lod, glz, -w / 2 - 0.02, glY, 0, 0.1, glH, d - 3.0, false);
  tbx(lod, glz, w / 2 + 0.02, glY, 0, 0.1, glH, d - 3.0, false);
  tbx(lod, glz, 0, glY, -d / 2 - 0.02, w - 3.0, glH, 0.1, false);
  for (const s of [-1, 1]) tbx(lod, glz, s * (DW / 2 + segW / 2), glY, d / 2 + 0.02, segW - 0.9, glH, 0.1, false);
  neon(lod, p.name, 0, Math.min(3.9, lobbyH - 0.7), d / 2 + 0.1, '#090d14', '#38bdf8', Math.min(w - 2, 7.6), 0.95);

  // ---- roof dressing + crown + mast -------------------------------------
  const dark = plainMat(0x0f172a, { metalness: 0.8, roughness: 0.3 });
  tbx(lod, dark, 0, h + 0.5, d / 2 - 0.15, w, 1.0, 0.3);
  tbx(lod, dark, 0, h + 0.5, -d / 2 + 0.15, w, 1.0, 0.3);
  tbx(lod, dark, w / 2 - 0.15, h + 0.5, 0, 0.3, 1.0, d);
  tbx(lod, dark, -w / 2 + 0.15, h + 0.5, 0, 0.3, 1.0, d);
  tbx(lod, plainMat(0x64748b), -w / 2 + 2.2, h + 0.7, -d / 2 + 2.0, 2.2, 1.3, 1.6);

  const crownKey = p.crown || (p.heli ? 'helipad' : 'block');
  (CROWNS[crownKey] || CROWNS.block)(g, { ...p, h, lobbyH }, lod, fm);

  const mast = new THREE.Mesh(tGeo(new THREE.CylinderGeometry(0.08, 0.12, 10, 6)), dark);
  mast.position.set(w / 2 - 1.2, h + 5, -d / 2 + 1.2);
  lod.add(mast);
  const beacon = new THREE.Mesh(tGeo(new THREE.SphereGeometry(0.28, 8, 8)),
    tMat(new THREE.MeshBasicMaterial({ color: 0xef4444 })));
  beacon.position.set(w / 2 - 1.2, h + 10.2, -d / 2 + 1.2);
  aviationBeacons.push(beacon);
  lod.add(beacon);

  const liftRing = new THREE.Mesh(tGeo(new THREE.RingGeometry(0.85, 1.15, 20)),
    tMat(new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide })));
  liftRing.rotation.x = -Math.PI / 2;
  liftRing.position.set(0, h + 0.58, d / 2 - 1.8);
  lod.add(liftRing);

  g.add(lod);
  // Tall buildings keep their crown far longer than a house keeps its chimney.
  const lodR = 54 + h * 1.6;
  registerBuildingLod(x, z, lod, lodR, lodR * 1.22);

  const roofY = baseY + h + 0.55;
  const rec = {
    group: g, boxes,
    x, z, w, d, h, baseY, roofY, name: p.name, minX, maxX, minZ, maxZ,
    archetype: p.a, interiorKind: A.lobby, crown: crownKey,
    metrics: { ...m, h, lobbyH },
    lobbyPad: { x, y: baseY, z: z - d / 2 + 2.0 },
    roofPad: { x, y: roofY, z: z + d / 2 - 1.8 },
    /** Consumed by the lift handler: one entry per storey, world coords. */
    floorPads: Array.from({ length: m.floors }, (_, i) => ({
      i, y: towerFloorY(baseY, i, { ...m, lobbyH }),
      x, z: z - d / 2 + 3.8, cell: i === 0 ? null : `${p.id || p.name}/f${String(i).padStart(2, '0')}`
    })),
    interiorLoaded: false, interiorGroup: null, interiorBoxes: [],
    interiorCache: null, interiorSpecs: null
  };
  skyscrapers.push(rec);
  enterableZones.push({
    minX: minX + 0.3, maxX: maxX - 0.3, minZ: minZ + 0.3, maxZ: maxZ - 0.2,
    name: `${p.name} LOBBY`
  });
  mapShapes.push({ x, z, w, d, color: '#0284c7', border: '#38bdf8', enterable: true });
  return rec;
}

/** Lobby interior maker — worldStream calls this through adoptSkyscraperInteriors. */
export function makeTowerLobby(sk, group) {
  const maker = INTERIORS[sk.interiorKind] || INTERIORS.corporate;
  return maker(sk, group);
}

// -----------------------------------------------------------------------------
// BACK-COMPAT ENTRY POINTS (Studio and any external caller)
// -----------------------------------------------------------------------------
export function buildSkyscraperBase(o) {
  const heli = o.hasHelipad !== undefined ? o.hasHelipad : (o.heli !== undefined ? o.heli : true);
  return buildTower({
    a: 'glass', w: 13.5, d: 13.5, floors: 12, glassHex: 0x0ea5e9, frameHex: 0x1e293b,
    name: 'AURA TOWER', ...o, heli, crown: o.crown || (heli ? 'helipad' : 'block')
  });
}
export function buildSkyscraper(o) { return buildSkyscraperBase(o); }

/** Roof kit only. Every archetype builds its own; kept for external calls. */
export function embellishTower({ x, z, w = 13.5, d = 13.5, h = 44, glassHex = 0x0ea5e9, hasHelipad = true }) {
  const g = new THREE.Group();
  g.position.set(x, 0.18, z);
  g.userData.studioName = 'Tower roof kit';
  worldRoot.add(g);
  const lod = new THREE.Group();
  g.add(lod);
  const dark = plainMat(0x0f172a, { metalness: 0.8, roughness: 0.3 });
  tbx(lod, dark, 0, h + 0.5, d / 2 - 0.15, w, 1.0, 0.3);
  tbx(lod, dark, 0, h + 0.5, -d / 2 + 0.15, w, 1.0, 0.3);
  tbx(lod, dark, w / 2 - 0.15, h + 0.5, 0, 0.3, 1.0, d);
  tbx(lod, dark, -w / 2 + 0.15, h + 0.5, 0, 0.3, 1.0, d);
  (hasHelipad ? CROWNS.helipad : CROWNS.block)(g, { w, d, h, glassHex }, lod, frameMat(0x1e293b));
  return g;
}

// -----------------------------------------------------------------------------
// TEARDOWN
// -----------------------------------------------------------------------------
export function disposeTowerInteriors() {
  for (const sk of skyscrapers) {
    if (sk.interiorCache && sk.interiorCache.parent) sk.interiorCache.parent.remove(sk.interiorCache);
    sk.interiorCache = null; sk.interiorGroup = null;
    sk.interiorBoxes = []; sk.interiorSpecs = null; sk.interiorLoaded = false;
  }
}
/** Per-rebuild. UNIT_BOX belongs to the kit — never disposed here. */
export function resetTowerSystem() {
  matCache.clear(); facadeCache.clear();
  for (const g of towerGeos) g.dispose();
  for (const m of towerMats) {
    if (m.map && m.map.isCanvasTexture) m.map.dispose();
    m.dispose();
  }
  towerGeos.length = 0; towerMats.length = 0;
}

export const TOWER_BUILDERS = { tower: buildTower };
export default TOWER_BUILDERS;