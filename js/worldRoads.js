// =============================================================================
// worldRoads.js — CARRIAGEWAYS, FREEWAYS, LOOPS, RUNWAYS, TRACKS
//
// Every drivable surface in the county. Owns:
//   road_grid · road_run · road_ribbon · road_loop · freeway_i88
//   bridge_deck · ramp_driveable · pullout · runway
//   speedway_track · speedway_pit
//
// TWO CONTRACTS THAT MATTER
//
// 1. KEEP-OUTS. Every carriageway publishes exclusion volumes via addKeepout()
//    BEFORE the scatter pass runs. Without this, forests grow through the
//    Frostpine loop. BOOT must place roads before expandScatters().
//
// 2. RESERVED FOOTPRINTS. Every carriageway reserves slab bounds + 1 m so
//    footprintClear() rejects buildings dropped on the road.
//
// Markings (dashes, studs, crosswalks, curbs, grid boxes) go through kit inst()
// and batch into chunked InstancedMeshes — a 420-station loop costs one draw
// call per material per chunk, not 840 meshes.
// =============================================================================
import * as THREE from 'three';
import {
  I88, ahRy, ahRz, aviationBeacons, mapShapes, terrainH
} from './state.js';
import { makeMat, worldRoot } from './engine.js';
import {
  UNIT_BOX, addRamp, addSolidBox, dist2, geo, groundMat, inst, makeBox,
  reserveFootprint, rngFor, signBoxMaterials
} from './worldKit.js';
import { addKeepout, addKeepoutPath } from './worldObjects/keepouts.js';
import { loopNormals, ribbonGeometry } from './worldTerrain.js';

// =============================================================================
// MATERIALS (module-owned; kit disposal skips shared materials)
// =============================================================================
const matCache = new Map();
const ownedMats = [];
function cached(key, make) {
  let m = matCache.get(key);
  if (!m) { m = make(); m.userData.shared = true; matCache.set(key, m); ownedMats.push(m); }
  return m;
}
const asphalt = (rx, ry, hex = 0x313946) => cached(`as|${hex}|${rx}|${ry}`,
  () => makeMat(hex, { texType: 'asphalt', repeatX: rx, repeatY: ry, roughness: 0.86, bumpScale: 0.015 }));
const concrete = (rx, ry, hex = 0xd1d5db) => cached(`co|${hex}|${rx}|${ry}`,
  () => makeMat(hex, { texType: 'concrete', repeatX: rx, repeatY: ry, roughness: 0.88 }));
const paint = (hex) => cached(`pt|${hex}`, () => new THREE.MeshBasicMaterial({ color: hex }));
const steelMat = () => cached('steel',
  () => makeMat(0xe2e8f0, { texType: 'brushedsteel', metalness: 0.92, roughness: 0.18, flatShading: false }));
const railMat = () => cached('rail',
  () => makeMat(0xcbd5e1, { texType: 'brushedsteel', metalness: 0.85, roughness: 0.3, flatShading: false }));
const woodMat = (rx = 4, ry = 2, hex = 0x78350f) => cached(`wd|${hex}|${rx}|${ry}`,
  () => makeMat(hex, { texType: 'wood', repeatX: rx, repeatY: ry }));
const stoneMat = (rx = 5, ry = 2) => cached(`st|${rx}|${ry}`,
  () => makeMat(0x9aa0a6, { texType: 'cobblestone', repeatX: rx, repeatY: ry, roughness: 0.9 }));

/** Resolve a row's surface into a material, tiling along the long axis. */
function surfaceMat(row, w, d) {
  const s = row.surface || 'asphalt';
  const hex = row.color;
  if (s === 'asphalt') {
    const long = Math.max(2, Math.round(Math.max(w, d) / 6));
    return d >= w ? asphalt(2, long, hex ?? 0x313946) : asphalt(long, 2, hex ?? 0x313946);
  }
  const rep = row.repeat || [Math.max(1, Math.round(w / 3)), Math.max(1, Math.round(d / 3))];
  return groundMat(s, {
    color: hex ?? 0xffffff, repeatX: rep[0], repeatY: rep[1], roughness: row.roughness ?? 0.9
  });
}

const P = (row) => row.parent || worldRoot;
const num = (v, f) => (Number.isFinite(v) ? v : f);

// =============================================================================
// SYMBOLIC HEIGHTS  ('lodgeY', 'terrain', …) — worldRuntime registers refs.
// =============================================================================
const heightRefs = new Map();
export function defineHeightRef(name, fn) { heightRefs.set(name, fn); }
export function clearHeightRefs() { heightRefs.clear(); }
function resolveY(spec, x, z, fallback = 0.18) {
  if (Number.isFinite(spec)) return spec;
  if (spec === 'terrain') return terrainH(x, z) + 0.1;
  const fn = heightRefs.get(spec);
  if (fn) { const v = fn(); if (Number.isFinite(v)) return v; }
  return fallback;
}

// =============================================================================
// SHARED MARKING HELPERS
// =============================================================================
function dashLine({ axis = 'z', from, to, step = 6, y = 0.05, at = 0, color = 0xfacc15,
                    len = 2.5, wide = 0.26, thick = 0.09, skip = null }) {
  const m = paint(color);
  for (let t = from; t <= to + 1e-6; t += step) {
    if (skip && t > skip[0] - 2 && t < skip[1] + 2) continue;
    if (axis === 'z') inst(UNIT_BOX, m, at, y, t, wide, thick, len);
    else inst(UNIT_BOX, m, t, y, at, len, thick, wide);
  }
}
function zebraCross(z, cx, halfW, y, color = 0xf8fafc) {
  const m = paint(color);
  for (let s = -halfW + 1; s <= halfW - 1; s += 2) inst(UNIT_BOX, m, cx + s, y, z, 1.2, 0.03, 5.0);
}
function mapRect(x, z, w, d, color = '#334155', border = '#475569') {
  mapShapes.push({ x, z, w, d, color, border, enterable: false });
}
function reserve(x, z, w, d, pad = 1) {
  reserveFootprint(x - w / 2 - pad, x + w / 2 + pad, z - d / 2 - pad, z + d / 2 + pad, 'road');
}

/** Overhead sign gantry. Exported so street.js can expose `prop_gantry`. */
export function buildGantry(parent, x, z, y, halfW, text, bg = '#065f46', fg = '#f8fafc', w = 15) {
  const sm = steelMat();
  for (const s of [-1, 1]) makeBox(parent, 0.45, 7.4, 0.45, x + s * (halfW + 0.7), y + 3.7, z, sm, { cast: true });
  makeBox(parent, halfW * 2 + 2.4, 0.4, 0.4, x, y + 7.2, z, sm, { cast: true });
  return makeBox(parent, w, 1.5, 0.22, x, y + 6.4, z - 0.3,
    signBoxMaterials(text, bg, fg), { name: `Gantry: ${text}` });
}

// =============================================================================
// 1 — ROAD GRID
// =============================================================================
export function buildRoadGrid(row) {
  const parent = P(row);
  const g = new THREE.Group();
  g.userData.studioName = row.name || row.id || 'Road grid';
  parent.add(g);

  const boxes = [];
  const top = num(row.top, 0.08), thick = num(row.thick, 0.08);
  const dash = row.dash, cross = row.cross;
  const solid = row.solid !== false;

  const run = (a, other, isNS) => {
    if (!a) return;
    const w = isNS ? a.w : a.d, d = isNS ? a.d : a.w;
    const mat = surfaceMat({ ...row, surface: row.surface || 'asphalt' }, w, d);
    for (const c of a.at) {
      const x = isNS ? c : a.c, z = isNS ? a.c : c;
      makeBox(g, w, thick, d, x, top - thick / 2, z, mat, { recv: true });
      if (solid) boxes.push(addSolidBox(x - w / 2, x + w / 2, top - thick, top, z - d / 2, z + d / 2, row.tag || 'road_surface', true));
      reserve(x, z, w, d);
      addKeepout(x, z, Math.max(w, d) * 0.5 + 1, 'road');
      if (row.map) mapRect(x, z, w, d, row.map[0], row.map[1]);
      if (dash) {
        const pm = paint(dash.color ?? 0xfacc15);
        for (let t = -dash.span; t <= dash.span; t += dash.step) {
          const p = a.c + t;
          if (other && other.at.some((o) => Math.abs(p - o) < 7.5)) continue;
          if (isNS) inst(UNIT_BOX, pm, c, dash.y, p, 0.26, 0.09, 2.5);
          else inst(UNIT_BOX, pm, p, dash.y, c, 2.5, 0.09, 0.26);
        }
      }
    }
  };
  run(row.ns, row.ew, true);
  run(row.ew, row.ns, false);

  if (cross && row.ns && row.ew) {
    const cm = paint(cross.color ?? 0xf1f5f9);
    for (const ix of row.ns.at) for (const iz of row.ew.at) {
      for (let s = -4; s <= 4; s += 2) {
        inst(UNIT_BOX, cm, ix + s, cross.y, iz - cross.off, 0.85, 0.095, 2.1);
        inst(UNIT_BOX, cm, ix + s, cross.y, iz + cross.off, 0.85, 0.095, 2.1);
        inst(UNIT_BOX, cm, ix - cross.off, cross.y, iz + s, 2.1, 0.095, 0.85);
        inst(UNIT_BOX, cm, ix + cross.off, cross.y, iz + s, 2.1, 0.095, 0.85);
      }
    }
  }
  return { object: g, boxes };
}

// =============================================================================
// 2 — ROAD RUN  (single slab, optional stream gap, dashes, zebras)
// =============================================================================
export function buildRoadRun(row) {
  const parent = P(row);
  const [x, z] = row.at;
  const w = row.w, d = row.d;
  const top = num(row.top, 0.18);
  const thick = num(row.thick, Math.min(0.12, top));
  const mat = surfaceMat(row, w, d);
  const g = new THREE.Group();
  g.userData.studioName = row.name || row.id || 'Road';
  parent.add(g);

  const boxes = [];
  const z0 = z - d / 2, z1 = z + d / 2;
  const spans = row.gap ? [[z0, row.gap[0]], [row.gap[1], z1]] : [[z0, z1]];
  for (const [a, b] of spans) {
    if (b - a < 0.5) continue;
    makeBox(g, w, thick, b - a, x, top - thick / 2, (a + b) / 2, mat, { recv: true });
    if (row.solid !== false) {
      boxes.push(addSolidBox(x - w / 2, x + w / 2, top - thick, top, a, b, row.tag || 'road_surface', true));
    }
  }
  if (row.reserve !== false) reserve(x, z, w, d);
  addKeepout(x, z, Math.max(w, d) * 0.5 + 1, 'road');
  if (row.map !== false) mapRect(x, z, w, d, row.map?.[0] || '#334155', row.map?.[1] || '#475569');

  if (row.dash) {
    dashLine({
      axis: row.dash.axis || (d >= w ? 'z' : 'x'),
      from: row.dash.from ?? (d >= w ? z0 + 6 : x - w / 2 + 6),
      to: row.dash.to ?? (d >= w ? z1 - 6 : x + w / 2 - 6),
      step: row.dash.step ?? 6, y: row.dash.y ?? top + 0.01,
      at: row.dash.axis === 'x' ? z : x,
      color: row.dash.color ?? 0xfacc15, skip: row.gap
    });
  }
  for (const zz of row.zebra || []) zebraCross(zz, x, w / 2, top + 0.01);
  return { object: g, boxes };
}

// =============================================================================
// 3 — ROAD RIBBON  (hills drive · westside streets · custom paths)
// =============================================================================
let lastLoop = null;
export function loopNearest(x, z) {
  if (!lastLoop) return { x, y: terrainH(x, z), z };
  let best = null, bd = Infinity;
  for (const p of lastLoop.pts) {
    const dd = dist2(p.x, p.z, x, z);
    if (dd < bd) { bd = dd; best = p; }
  }
  return best || { x, y: terrainH(x, z), z };
}
function resolvePt(spec) {
  if (Array.isArray(spec)) return new THREE.Vector3(spec[0], terrainH(spec[0], spec[1]), spec[1]);
  const m = /^loopNearest:([-\d.]+),([-\d.]+)$/.exec(String(spec || ''));
  if (m) { const p = loopNearest(Number(m[1]), Number(m[2])); return new THREE.Vector3(p.x, p.y, p.z); }
  return new THREE.Vector3(0, 0, 0);
}
function ribbonMesh(parent, pts, halfW, dy, mat, name, opts = {}) {
  const mesh = new THREE.Mesh(ribbonGeometry(pts, halfW, (p) => p.y + dy, opts), mat);
  mesh.receiveShadow = true;
  mesh.userData.studioName = name;
  parent.add(mesh);
  return mesh;
}

export function buildRoadRibbon(row) {
  const parent = P(row);
  const g = new THREE.Group();
  g.userData.studioName = row.name || row.id || 'Road ribbon';
  parent.add(g);
  const boxes = [];
  const dy = num(row.dy, 0.12), halfW = num(row.halfW, 4.8);

  // --- Westside grid: straight shelves either side of the hills drive ------
  if (row.path === 'westside') {
    const [za, zb] = row.z || [-94, 94];
    const gap = num(row.gap, 28), off = num(row.floorOffset, 9);
    const mat = surfaceMat({ ...row, surface: row.surface || 'asphalt' }, halfW * 2, 100);
    for (const x of row.at || []) {
      const floor = ahRy(x) + off, roadZ = ahRz(x);
      for (const [a, b] of [[za, roadZ - gap], [roadZ + gap, zb]]) {
        if (b - a < 8) continue;
        makeBox(g, halfW * 2, 0.12, b - a, x, floor + 0.04, (a + b) / 2, mat, { recv: true });
        boxes.push(addSolidBox(x - halfW, x + halfW, floor - 0.02, floor + 0.1, a, b, 'westcity_road', true));
        reserve(x, (a + b) / 2, halfW * 2, b - a);
        addKeepout(x, (a + b) / 2, Math.max(halfW, (b - a) / 2) + 2, 'road');
        dashLine({ axis: 'z', from: a + 3, to: b - 1, step: row.dash?.step ?? 8,
          y: floor + (row.dash?.y ?? 0.112), at: x, color: row.center ?? 0xf5c84c, len: 2.4, wide: 0.16, thick: 0.025 });
      }
    }
    return { object: g, boxes };
  }

  // --- Sampled path --------------------------------------------------------
  let pts;
  if (row.path === 'hills') {
    pts = [];
    const from = num(row.from, -196), to = num(row.to, -470), step = num(row.step, 3);
    for (let x = from; x >= to; x -= step) pts.push(new THREE.Vector3(x, ahRy(x), ahRz(x)));
  } else {
    const raw = (row.pts || []).map(resolvePt);
    if (row.samples && raw.length > 2) {
      const curve = new THREE.CatmullRomCurve3(raw, false, 'catmullrom', 0.5);
      pts = curve.getSpacedPoints(row.samples);
      for (const p of pts) p.y = terrainH(p.x, p.z);
    } else pts = raw;
  }
  if (pts.length < 2) return { object: g, boxes };

  const mat = surfaceMat({ ...row, surface: row.surface || 'asphalt' }, halfW * 2, 40);
  ribbonMesh(g, pts, halfW, dy, mat, row.name || 'Scenic road', { uvScale: row.uvScale ?? 8 });
  if (row.center !== undefined) {
    ribbonMesh(g, pts, 0.12, dy + 0.04, paint(row.center), 'Centre line');
  }
  addKeepoutPath(pts, halfW + 2.5, 'road', 2);
  for (let i = 0; i < pts.length; i += 24) {
    const a = pts[i], b = pts[Math.min(pts.length - 1, i + 24)];
    mapRect((a.x + b.x) / 2, (a.z + b.z) / 2,
      Math.abs(b.x - a.x) + halfW * 2, Math.abs(b.z - a.z) + halfW * 2, '#334155', '#facc15');
  }
  return { object: g, boxes, pts };
}

// =============================================================================
// 4 — ROAD LOOP  (Frostpine scenic loop: rails, pullouts, signs)
// =============================================================================
export function buildPullout(parent, p, normal, halfW, dy, name, boxes) {
  const { nx, nz, yaw } = normal;
  const dropL = p.y - terrainH(p.x + nx * 9, p.z + nz * 9);
  const dropR = p.y - terrainH(p.x - nx * 9, p.z - nz * 9);
  const side = dropL >= dropR ? 1 : -1;
  const cx = p.x + nx * side * (halfW + 3.2), cz = p.z + nz * side * (halfW + 3.2);

  makeBox(parent, 6.4, 0.12, 9, cx, p.y + dy - 0.02, cz,
    asphalt(2, 3, 0x3a4048), { recv: true, ry: yaw, name: `Pullout: ${name}` });
  boxes.push(addSolidBox(cx - 4.6, cx + 4.6, p.y + dy - 0.14, p.y + dy + 0.04, cz - 4.6, cz + 4.6, 'vista_pullout', true));

  const ox = p.x + nx * side * (halfW + 5.4), oz = p.z + nz * side * (halfW + 5.4);
  makeBox(parent, 2.2, 0.12, 0.7, ox, p.y + 0.62, oz, woodMat(2, 1, 0xb45309), { cast: true, ry: yaw });
  for (const s of [-1, 1]) {
    makeBox(parent, 0.12, 0.45, 0.6, ox + Math.cos(yaw) * s * 0.9, p.y + 0.38, oz - Math.sin(yaw) * s * 0.9,
      railMat(), { ry: yaw });
  }
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 1.15, 8), railMat());
  scope.position.set(ox + Math.cos(yaw) * 2.2, p.y + 0.7, oz - Math.sin(yaw) * 2.2);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.55, 8),
    cached('scope', () => makeMat(0x1e293b, { metalness: 0.8, roughness: 0.3 })));
  head.rotation.set(Math.PI / 2 - 0.35, yaw, 0);
  head.position.set(scope.position.x, p.y + 1.35, scope.position.z);
  parent.add(scope, head);

  const sg = new THREE.Group();
  sg.position.set(p.x + nx * side * (halfW + 1.4), p.y, p.z + nz * side * (halfW + 1.4));
  sg.rotation.y = Math.atan2(-nx * side, -nz * side);
  for (const s of [-1, 1]) makeBox(sg, 0.18, 2.3, 0.18, s * 1.9, 1.15, 0, woodMat(1, 3, 0x57534e), { cast: true });
  makeBox(sg, 4.4, 0.85, 0.22, 0, 2.15, 0, signBoxMaterials(name, '#1c1917', '#fcd34d'), { name: `Sign: ${name}` });
  parent.add(sg);

  addKeepout(cx, cz, 8, 'pullout');
  mapRect(cx, cz, 8, 8, '#475569', '#fcd34d');
  return { x: cx, z: cz, side };
}

export function buildRoadLoop(row) {
  const parent = P(row);
  const g = new THREE.Group();
  g.userData.studioName = row.name || row.id || 'Loop road';
  parent.add(g);
  const boxes = [];

  const N = num(row.samples, 420);
  const halfW = num(row.halfW, 4.5), dy = num(row.dy, 0.12);
  const curve = new THREE.CatmullRomCurve3(
    (row.pts || []).map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'catmullrom', 0.5);
  const pts = curve.getSpacedPoints(N);
  for (const p of pts) p.y = terrainH(p.x, p.z);
  const sm = pts.map((p, i) => {
    const a = pts[(i - 2 + pts.length) % pts.length].y, b = pts[(i - 1 + pts.length) % pts.length].y;
    const c = pts[(i + 1) % pts.length].y, d = pts[(i + 2) % pts.length].y;
    return (a + b * 2 + p.y * 4 + c * 2 + d) / 10;
  });
  pts.forEach((p, i) => { p.y = sm[i]; });
  const normalAt = loopNormals(pts);

  ribbonMesh(g, pts, halfW, dy, asphalt(2, 1, 0x2b3138), row.name || 'Loop carriageway', { uvScale: 9 });
  const edge = paint(0xf1f5f9);
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(ribbonGeometry(pts, 0.11, (p) => p.y + dy + 0.02, { offset: s * (halfW - 0.35) }), edge);
    m.material.side = THREE.DoubleSide;
    g.add(m);
  }
  const dm = paint(0xfacc15);
  for (let i = 0; i < pts.length - 1; i += 2) {
    const p = pts[i], { nx, nz, yaw } = normalAt(i);
    for (const off of [-0.28, 0.28]) {
      inst(UNIT_BOX, dm, p.x + nx * off, p.y + dy + 0.03, p.z + nz * off, 0.2, 0.04, 3.4, 0, yaw, 0);
    }
  }

  // Guardrails only where the shoulder actually drops away.
  if (row.rails !== false) {
    const rm = railMat();
    const postGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.95, 6);
    let beams = 0;
    for (const side of [-1, 1]) {
      let prev = null;
      for (let i = 0; i < pts.length - 1; i += 2) {
        const p = pts[i], { nx, nz } = normalAt(i);
        const ex = p.x + nx * side * (halfW + 0.35), ez = p.z + nz * side * (halfW + 0.35);
        const drop = p.y - terrainH(p.x + nx * side * (halfW + 3.2), p.z + nz * side * (halfW + 3.2));
        if (drop > 2.3 && beams < 190) {
          const post = new THREE.Mesh(postGeo, rm);
          post.position.set(ex, p.y + dy + 0.45, ez);
          post.castShadow = true;
          g.add(post);
          if (prev && i - prev.i <= 4) {
            const len = Math.hypot(ex - prev.x, ez - prev.z) + 0.3;
            makeBox(g, 0.26, 0.55, len, (ex + prev.x) / 2, (p.y + prev.y) / 2 + dy + 0.72, (ez + prev.z) / 2, rm, {
              cast: true, ry: Math.atan2(ex - prev.x, ez - prev.z),
              box: [Math.min(ex, prev.x) - 0.3, Math.max(ex, prev.x) + 0.3,
                    Math.min(p.y, prev.y) + dy + 0.1, Math.max(p.y, prev.y) + dy + 1.0,
                    Math.min(ez, prev.z) - 0.3, Math.max(ez, prev.z) + 0.3, 'guardrail', true]
            });
            beams++;
          }
          prev = { i, x: ex, z: ez, y: p.y };
        } else prev = null;
      }
    }
  }

  for (const po of row.pullouts || []) {
    const i = Math.floor(po.f * N) % pts.length;
    buildPullout(g, pts[i], normalAt(i), halfW, dy, po.name, boxes);
  }
  for (const sg of row.signs || []) {
    const i = Math.floor(sg.f * N) % pts.length;
    const p = pts[i], { nx, nz } = normalAt(i);
    const sx = p.x - nx * (halfW + 1.1), sz = p.z - nz * (halfW + 1.1);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.1, 6), railMat());
    post.position.set(sx, p.y + 1.05, sz);
    g.add(post);
    makeBox(g, 0.95, 0.95, 0.08, sx, p.y + 2.2, sz,
      cached('sign25', () => makeMat(0xfacc15, { emissive: 0xca8a04, emissiveIntensity: 0.25 })), { rz: Math.PI / 4 });
    makeBox(g, 0.62, 0.5, 0.22, sx, p.y + 2.2, sz + 0.06,
      signBoxMaterials(sg.text || '25', '#facc15', '#1c1917'), { name: `Sign: ${sg.text}` });
  }

  addKeepoutPath(pts, halfW + 2.5, 'loop', 3);
  for (let i = 0; i < pts.length - 1; i += 30) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let j = i; j <= Math.min(i + 30, pts.length - 1); j++) {
      const p = pts[j];
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    mapRect((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0 + 9, z1 - z0 + 9, '#334155', '#facc15');
  }

  lastLoop = { pts, normalAt, dy, halfW, group: g };
  return { object: g, boxes, pts, normalAt, dy, halfW };
}

// =============================================================================
// 5 — I-88 INTERSTATE  (continuous viaduct + cable-stayed ocean bridge)
// =============================================================================
export function buildFreeway(row) {
  const F = I88;
  const X = F.x, HW = F.halfW, W = HW * 2, RAIL_X = HW - 0.35;
  const parent = P(row);
  const g = new THREE.Group();
  g.userData.studioName = row.name || 'I-88 Interstate';
  parent.add(g);

  const fwy = asphalt(4, 90, 0x1f2937);
  const deck = concrete(4, 40, 0x27303d);
  const barrier = concrete(24, 1, 0xd1d5db);
  const tower = cached('i88tower', () => makeMat(0xdc2626, { metalness: 0.65, roughness: 0.32 }));
  const boxes = [];
  const box = (w, h, d, m, x, y, z, cast = false) => makeBox(g, w, h, d, x, y, z, m, { cast, recv: true });
  const S = (x0, x1, y0, y1, z0, z1, tag, climb) => boxes.push(addSolidBox(x0, x1, y0, y1, z0, z1, tag, climb));

  const yellow = paint(0xfacc15), white = paint(0xf8fafc), stud = paint(0xffb020);
  const markings = (z0, z1, yAt, angle = 0) => {
    const mid = (z0 + z1) / 2, len = z1 - z0, ym = yAt(mid), lift = 0.035;
    for (const off of [-0.3, 0.3]) inst(UNIT_BOX, yellow, X + off, ym + lift, mid, 0.22, 0.05, len - 0.4, angle);
    for (const off of [-(HW - 0.9), HW - 0.9]) inst(UNIT_BOX, white, X + off, ym + lift, mid, 0.22, 0.05, len - 0.4, angle);
    for (let z = z0 + 4; z < z1 - 3; z += 8) {
      for (const off of [-5.5, 5.5]) inst(UNIT_BOX, white, X + off, yAt(z) + lift, z, 0.24, 0.05, 3.4, angle);
      inst(UNIT_BOX, stud, X, yAt(z) + lift + 0.02, z, 0.2, 0.05, 0.2, angle);
    }
  };
  const flat = (z0, z1, y, thick = 0.14, m = fwy) => {
    box(W, thick, z1 - z0, m, X, y - thick / 2, (z0 + z1) / 2);
    S(X - HW, X + HW, y - thick, y, z0, z1, 'i88_surface', true);
    markings(z0, z1, () => y, 0);
  };
  const ramp = (z0, z1, y0, y1) => {
    const run = z1 - z0, rise = y1 - y0, hyp = Math.hypot(run, rise), ang = Math.atan2(rise, run);
    makeBox(g, W, 0.4, hyp, X, (y0 + y1) / 2 - 0.2, (z0 + z1) / 2, fwy, { cast: true, recv: true, rx: -ang });
    addRamp({ minX: X - HW, maxX: X + HW, minZ: z0, maxZ: z1, startY: y0, endY: y1, axis: 'z', dir: 1 });
    markings(z0, z1, (z) => y0 + rise * ((z - z0) / run), -ang);
  };
  const slopedRail = (z0, z1, y0, y1) => {
    const hyp = Math.hypot(z1 - z0, y1 - y0), ang = Math.atan2(y1 - y0, z1 - z0);
    for (const s of [-1, 1]) {
      makeBox(g, 0.7, 1.05, hyp, X + s * RAIL_X, (y0 + y1) / 2 + 0.52, (z0 + z1) / 2, barrier, { cast: true, recv: true, rx: -ang });
      S(X + s * RAIL_X - 0.35, X + s * RAIL_X + 0.35, Math.min(y0, y1), Math.max(y0, y1) + 1.05, z0, z1, 'i88_rail', true);
    }
  };
  const flatRail = (z0, z1, y) => {
    for (const s of [-1, 1]) {
      box(0.7, 1.05, z1 - z0, barrier, X + s * RAIL_X, y + 0.52, (z0 + z1) / 2, true);
      S(X + s * RAIL_X - 0.35, X + s * RAIL_X + 0.35, y, y + 1.05, z0, z1, 'i88_rail', true);
    }
  };
  const barrierRun = (z0, z1, y, openings) => {
    const cuts = openings.map((c) => [c - F.openingHalf, c + F.openingHalf])
      .filter(([a, b]) => a > z0 && b < z1).sort((p, q) => p[0] - q[0]);
    const seg = (a, b) => {
      if (b - a < 0.5) return;
      for (const s of [-1, 1]) {
        box(0.6, 1.05, b - a, barrier, X + s * RAIL_X, y + 0.52, (a + b) / 2, true);
        S(X + s * RAIL_X - 0.32, X + s * RAIL_X + 0.32, y - 0.05, y + 1.05, a, b, 'i88_barrier', true);
      }
    };
    let cursor = z0;
    for (const [a, b] of cuts) { seg(cursor, a); cursor = b; }
    seg(cursor, z1);
  };

  const openings = F.westOpenings.concat(F.eastOpenings);
  flat(F.southEnd, F.rampUpStart, F.groundY);
  barrierRun(F.southEnd, F.rampUpStart, F.groundY, openings);
  ramp(F.rampUpStart, F.rampUpEnd, F.groundY, F.deckY);
  slopedRail(F.rampUpStart, F.rampUpEnd, F.groundY, F.deckY);
  flat(F.deckStart, F.deckEnd, F.deckY, 0.5, deck);
  flatRail(F.deckStart, F.deckEnd, F.deckY);

  for (let z = F.deckStart + 6; z <= F.deckEnd - 4; z += 18) {
    for (const s of [-1, 1]) {
      const px = X + s * 8.4;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.95, F.deckY - 0.5, 10), barrier);
      col.position.set(px, (F.deckY - 0.5) / 2, z);
      col.castShadow = true;
      g.add(col);
      S(px - 0.95, px + 0.95, 0.05, F.deckY - 0.5, z - 0.95, z + 0.95, 'i88_pillar', false);
    }
    box(W - 1.4, 0.55, 1.6, barrier, X, F.deckY - 0.72, z, true);
  }

  ramp(F.bridgeRampStart, F.bridgeRampEnd, F.deckY, F.bridgeY);
  slopedRail(F.bridgeRampStart, F.bridgeRampEnd, F.deckY, F.bridgeY);
  flat(F.bridgeStart, F.bridgeEnd, F.bridgeY, 0.65, deck);
  flatRail(F.bridgeStart, F.bridgeEnd, F.bridgeY);

  const towerTop = num(row.towerTop, 48.0);
  const towerZs = row.towerZ || [248, 332];
  for (const tz of towerZs) {
    for (const s of [-1, 1]) {
      const tx = X + s * 11.6;
      box(3.4, F.bridgeY + 1.0, 4.4, barrier, tx, (F.bridgeY + 1.0) / 2, tz, true);
      const p0 = s < 0 ? tx - 1.7 : Math.max(tx - 1.7, X + HW);
      const p1 = s < 0 ? Math.min(tx + 1.7, X - HW) : tx + 1.7;
      S(p0, p1, 0, F.bridgeY + 1.0, tz - 2.2, tz + 2.2, 'bridge_pier', false);
      box(1.6, towerTop, 2.0, tower, tx, towerTop / 2, tz, true);
      S(p0, p1, F.bridgeY, towerTop, tz - 1.05, tz + 1.05, 'bridge_tower', false);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), paint(0xef4444));
      beacon.position.set(tx, towerTop + 0.4, tz);
      aviationBeacons.push(beacon);
      g.add(beacon);
    }
    box(24.8, 1.8, 1.6, tower, X, 26.0, tz, true);
    box(24.8, 2.2, 1.8, tower, X, 44.5, tz, true);
  }

  const cableY = (z) => {
    if (z <= towerZs[0]) {
      const t = Math.max(0, (z - F.bridgeStart) / (towerZs[0] - F.bridgeStart));
      return F.bridgeY + 1.2 + (towerTop - F.bridgeY - 2.0) * t * t;
    }
    if (z >= towerZs[1]) {
      const u = Math.max(0, (F.bridgeEnd - z) / (F.bridgeEnd - towerZs[1]));
      return F.bridgeY + 1.2 + (towerTop - F.bridgeY - 2.0) * u * u;
    }
    const mid = (towerZs[0] + towerZs[1]) / 2;
    const u = (z - mid) / ((towerZs[1] - towerZs[0]) / 2);
    return F.bridgeY + 4.5 + (towerTop - F.bridgeY - 5.3) * u * u;
  };
  for (const s of [-1, 1]) {
    const cx = X + s * 11.6, cp = [];
    for (let z = F.bridgeStart; z <= F.bridgeEnd; z += 4) cp.push(new THREE.Vector3(cx, cableY(z), z));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cp), 44, 0.24, 8, false), tower));
    for (let z = F.bridgeStart + 6; z <= F.bridgeEnd - 6; z += 6) {
      const h = cableY(z) - F.bridgeY;
      if (h > 0.6) box(0.08, h, 0.08, steelMat(), cx, F.bridgeY + h / 2, z);
    }
  }

  ramp(F.rampDownStart, F.rampDownEnd, F.bridgeY, F.northY);
  slopedRail(F.rampDownStart, F.rampDownEnd, F.bridgeY, F.northY);
  flat(F.rampDownEnd, F.northEnd, F.northY);
  barrierRun(F.rampDownEnd, F.northEnd, F.northY, openings);

  // Freeway lighting — instanced poles + heads.
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 9, 8);
  const headGeo = new THREE.BoxGeometry(2.2, 0.2, 0.5);
  const poleT = [], headT = [];
  const lampAt = (x, y, z, s) => {
    const dm = new THREE.Object3D();
    dm.position.set(x, y + 4.5, z); dm.updateMatrix(); poleT.push(dm.matrix.clone());
    dm.position.set(x - s * 1.1, y + 9.0, z); dm.updateMatrix(); headT.push(dm.matrix.clone());
  };
  for (let z = F.southEnd + 10; z < F.rampUpStart - 4; z += 27) for (const s of [-1, 1]) lampAt(X + s * (HW + 1.6), F.groundY, z, s);
  for (let z = F.rampDownEnd + 12; z < F.northEnd - 6; z += 27) for (const s of [-1, 1]) lampAt(X + s * (HW + 1.6), F.northY, z, s);
  for (let z = F.deckStart + 10; z < F.deckEnd; z += 24) for (const s of [-1, 1]) lampAt(X + s * (HW - 0.1), F.deckY, z, s);
  for (let z = F.bridgeStart + 12; z < F.bridgeEnd; z += 24) for (const s of [-1, 1]) lampAt(X + s * (HW - 0.1), F.bridgeY, z, s);
  const flush = (geometry, material, list) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    g.add(im);
  };
  flush(poleGeo, cached('i88pole', () => makeMat(0x6b7280, { metalness: 0.6 })), poleT);
  flush(headGeo, paint(0xfff7d6), headT);

  const gantryY = (spec, z) => {
    if (Number.isFinite(spec)) return spec;
    if (spec === 'ground') return F.groundY;
    if (spec === 'bridge') return F.bridgeY;
    if (spec === 'north') return F.northY;
    if (spec === 'deck+') {
      const t = (z - F.bridgeRampStart) / (F.bridgeRampEnd - F.bridgeRampStart);
      return F.deckY + (F.bridgeY - F.deckY) * Math.max(0, Math.min(1, t));
    }
    return F.groundY;
  };
  for (const gt of row.gantries || []) {
    buildGantry(g, X, gt.z, gantryY(gt.y, gt.z), HW, gt.text, gt.bg, gt.fg, gt.w ?? 15);
  }

  addKeepout(X, (F.southEnd + F.northEnd) / 2, (F.northEnd - F.southEnd) / 2, 'i88');
  mapRect(X, (F.southEnd + F.northEnd) / 2, W, F.northEnd - F.southEnd, '#334155', '#f59e0b');
  mapRect(X, 290, W, 208, '#dc2626', '#facc15');
  return { object: g, boxes };
}

// =============================================================================
// 6 — BRIDGE DECK · RAMP · PULLOUT (standalone rows)
// =============================================================================
export function buildBridgeDeck(row) {
  const [x, z] = row.at;
  const w = row.w, d = row.d, y = num(row.y, 0.29);
  const mat = row.mat === 'stone' ? stoneMat(4, 2) : woodMat(4, 2, row.color ?? 0x78350f);
  const parent = P(row);
  const g = new THREE.Group();
  g.userData.studioName = row.name || 'Bridge deck';
  parent.add(g);
  makeBox(g, w, 0.22, d, x, y - 0.11, z, mat, { cast: true, recv: true });
  const boxes = [addSolidBox(x - w / 2, x + w / 2, y - 0.22, y, z - d / 2, z + d / 2, row.tag || 'footbridge', true)];
  const rail = num(row.rails, 0);
  if (rail > 0) {
    for (const s of [-1, 1]) {
      makeBox(g, w, rail, 0.24, x, y + rail / 2, z + s * (d / 2 - 0.12), mat, { cast: true, recv: true });
      boxes.push(addSolidBox(x - w / 2, x + w / 2, y, y + rail, z + s * (d / 2 - 0.12) - 0.12, z + s * (d / 2 - 0.12) + 0.12, 'bridge_rail', true));
    }
  }
  addKeepout(x, z, Math.max(w, d) / 2 + 2, 'bridge');
  mapRect(x, z, w, d, row.mat === 'stone' ? '#9aa0a6' : '#78350f', '#fcd34d');
  return { object: g, boxes };
}

export function buildDriveableRamp(row) {
  const [x0, x1, z0, z1] = row.bounds;
  const axis = row.axis || 'z', dir = row.dir ?? 1;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const hi = axis === 'z' ? (dir > 0 ? z0 : z1) : (dir > 0 ? x0 : x1);
  const lo = axis === 'z' ? (dir > 0 ? z1 : z0) : (dir > 0 ? x1 : x0);
  const startY = resolveY(row.startY, axis === 'z' ? cx : hi, axis === 'z' ? hi : cz, terrainH(cx, cz) + 0.12);
  const endY = resolveY(row.endY, axis === 'z' ? cx : lo, axis === 'z' ? lo : cz, terrainH(cx, cz) + 0.1);
  const ref = addRamp({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, startY, endY, axis, dir });

  let object = null;
  if (row.visual !== false) {
    const v = row.visual || {};
    const w = v.w ?? (x1 - x0), d = v.d ?? (z1 - z0);
    const vx = v.at ? v.at[0] : cx, vz = v.at ? v.at[1] : cz;
    const run = axis === 'z' ? d : w, rise = endY - startY;
    const ang = Math.atan2(Math.abs(rise), run) * Math.sign(rise) * (axis === 'z' ? -dir : dir);
    const mat = row.mat === 'stone' ? stoneMat(1, 2)
      : cached('ramp', () => makeMat(0x57534e, { texType: 'redrock', repeatX: 1, repeatY: 2 }));
    object = makeBox(P(row), w, 0.3, Math.hypot(run, rise), vx, (startY + endY) / 2 - 0.15, vz, mat,
      axis === 'z' ? { recv: true, rx: ang } : { recv: true, rz: ang, ry: Math.PI / 2 });
    // axis 'x': swap so the hypotenuse runs along X.
    if (axis === 'x') {
      object.scale.set(Math.hypot(run, rise), 0.3, d);
      object.rotation.set(0, 0, Math.atan2(rise, run) * dir);
    }
  }
  addKeepout(cx, cz, Math.max(x1 - x0, z1 - z0) / 2 + 1.5, 'ramp');
  return { object, ramp: ref, anchors: { top: [cx, Math.max(startY, endY), cz] } };
}

export function buildPulloutRow(row) {
  const [x, z] = row.at;
  const y = num(row.y, terrainH(x, z) + 0.12);
  const yaw = num(row.yaw, 0);
  const boxes = [];
  const m = makeBox(P(row), row.w ?? 6.4, 0.12, row.d ?? 9, x, y - 0.02, z,
    asphalt(2, 3, 0x3a4048), { recv: true, ry: yaw, name: `Pullout: ${row.name || ''}` });
  const hw = (row.w ?? 6.4) / 2 + 1.4, hd = (row.d ?? 9) / 2 + 0.2;
  boxes.push(addSolidBox(x - hw, x + hw, y - 0.14, y + 0.04, z - hd, z + hd, 'vista_pullout', true));
  addKeepout(x, z, Math.max(hw, hd) + 2, 'pullout');
  mapRect(x, z, 8, 8, '#475569', '#fcd34d');
  return { object: m, boxes };
}

// =============================================================================
// 7 — RUNWAY
// =============================================================================
export function buildRunway(row) {
  const [x, z] = row.at;
  const w = row.w ?? 22, d = row.d ?? 240, y = num(row.y, 0.29);
  const g = new THREE.Group();
  g.userData.studioName = row.name || 'Runway';
  P(row).add(g);
  makeBox(g, w, 0.08, d, x, y - 0.04, z, asphalt(6, 40, 0x1e293b), { recv: true });
  const box = addSolidBox(x - w / 2, x + w / 2, y - 0.08, y, z - d / 2, z + d / 2, 'runway', true);
  reserve(x, z, w, d);
  addKeepout(x, z, d / 2 + 2, 'runway');

  const wm = paint(0xf8fafc), em = paint(0x38bdf8);
  for (const tz of [z - d / 2 + 13, z + d / 2 - 13]) {
    for (let s = -8; s <= 8; s += 3.2) inst(UNIT_BOX, wm, x + s, y + 0.005, tz, 1.4, 0.09, 7.5);
  }
  for (let t = z - d / 2 + 27; t <= z + d / 2 - 27; t += 12) {
    inst(UNIT_BOX, wm, x, y + 0.005, t, 0.45, 0.09, 5.5);
    inst(UNIT_BOX, em, x - (w / 2 - 0.4), y + 0.17, t, 0.35, 0.35, 0.35);
    inst(UNIT_BOX, em, x + (w / 2 - 0.4), y + 0.17, t, 0.35, 0.35, 0.35);
  }
  mapRect(x, z, w, d, '#0f172a', '#f8fafc');
  return { object: g, boxes: [box] };
}

// =============================================================================
// 8 — MOTOR SPEEDWAY
// =============================================================================
export function buildSpeedwayTrack(row) {
  const parent = P(row);
  const g = new THREE.Group();
  g.userData.studioName = row.name || 'Los Aura Motor Speedway';
  parent.add(g);
  const boxes = [];

  const CZ = num(row.centerZ, 807), R = num(row.radius, 69), TW = num(row.trackW, 18);
  const SL = num(row.straightLen, 180), MX = num(row.straightMidX, -50);
  const zS = CZ - R, zN = CZ + R;
  const track = asphalt(6, 40, 0x1e293b);
  const kerb = concrete(18, 2, 0xd1d5db);
  const red = cached('spRed', () => makeMat(0xef4444, { roughness: 0.6 }));
  const white = paint(0xf8fafc);

  const paved = (w, d, x, z, tag) => {
    makeBox(g, w, 0.08, d, x, 0.23, z, track, { recv: true });
    boxes.push(addSolidBox(x - w / 2, x + w / 2, 0.19, 0.27, z - d / 2, z + d / 2, tag, true));
    reserve(x, z, w, d);
    mapRect(x, z, w, d, '#1e293b', '#ef4444');
  };
  paved(SL, TW, MX, zS, 'track_surface');
  paved(SL, TW, MX, zN, 'track_surface');

  for (const [wz, tag] of [[zS - TW / 2 - 0.4, 'track_wall_s'], [zN + TW / 2 + 0.4, 'track_wall_n']]) {
    makeBox(g, SL, 1.1, 0.7, MX, 0.82, wz, kerb);
    boxes.push(addSolidBox(MX - SL / 2, MX + SL / 2, 0.26, 1.39, wz - 0.4, wz + 0.4, tag, true));
  }

  const steps = num(row.turnSteps, 32);
  for (const t of row.turns || []) {
    const a0 = t.start, a1 = t.end;
    for (let i = 0; i < steps; i++) {
      const s0 = a0 + (i / steps) * (a1 - a0), s1 = a0 + ((i + 1) / steps) * (a1 - a0);
      const am = (s0 + s1) / 2;
      const segLen = Math.abs(s1 - s0) * (R + TW / 2) + 1.2;
      const tx = t.cx + Math.cos(am) * R, tz = CZ + Math.sin(am) * R;
      inst(UNIT_BOX, track, tx, 0.23, tz, TW, 0.08, segLen, 0, -am, 0, { recv: true });
      const ir = R - TW / 2 + 0.6;
      inst(UNIT_BOX, i % 2 ? white : red, t.cx + Math.cos(am) * ir, 0.28, CZ + Math.sin(am) * ir,
        1.1, 0.11, segLen * 0.95, 0, -am, 0);
      const or = R + TW / 2 + 0.4;
      const wx = t.cx + Math.cos(am) * or, wz = CZ + Math.sin(am) * or;
      inst(UNIT_BOX, i % 2 ? white : red, wx, 0.82, wz, 0.7, 1.1, segLen, 0, -am, 0);
      boxes.push(addSolidBox(wx - 1.2, wx + 1.2, 0.26, 1.39, wz - 1.2, wz + 1.2, 'track_turn_wall', true));
      addKeepout(wx, wz, 3, 'track');
    }
    mapRect(t.cx, CZ, 78, 156, '#1e293b', '#ef4444');
  }

  const sl = row.startLine;
  if (sl) {
    const [sx, sz] = sl.at;
    const black = paint(0x090d14);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 8; c++) {
      inst(UNIT_BOX, (r + c) % 2 ? black : white, sx - 1.1 + r * 1.1, 0.28, sz - 7.8 + c * 2.2, 1.1, 0.10, 2.2);
    }
    if (sl.gantry) buildGantry(g, sx, sz, 0.26, 10.5, 'LOS AURA MOTOR SPEEDWAY', '#090d14', '#ef4444', 14.5);
  }
  addKeepoutPath([{ x: MX, z: zS }, { x: MX, z: zN }], SL / 2, 'track', 1);
  return { object: g, boxes };
}

export function buildSpeedwayPit(row) {
  const parent = P(row);
  const [x, z] = row.at;
  const w = row.w ?? 120, d = row.d ?? 8;
  const g = new THREE.Group();
  g.userData.studioName = row.name || 'Pit lane & garages';
  parent.add(g);
  const boxes = [];
  const kerb = concrete(18, 2, 0xd1d5db);
  const garage = cached('garage', () => makeMat(0x334155, { texType: 'corrugated', metalness: 0.7 }));

  makeBox(g, w, 0.08, d, x, 0.22, z, asphalt(30, 2), { recv: true });
  boxes.push(addSolidBox(x - w / 2, x + w / 2, 0.18, 0.26, z - d / 2, z + d / 2, 'pit_lane', true));
  reserve(x, z, w, d);
  makeBox(g, w, 0.75, 0.5, x, 0.64, z - d / 2 - 0.4, kerb);
  boxes.push(addSolidBox(x - w / 2, x + w / 2, 0.26, 1.02, z - d / 2 - 0.7, z - d / 2 - 0.1, 'pit_wall', true));

  const G = row.garages;
  if (G) {
    const [gx, gz] = G.at, gw = G.w ?? 96, gd = G.d ?? 10;
    makeBox(g, gw, 0.5, gd, gx, 5.0, gz, garage);
    boxes.push(addSolidBox(gx - gw / 2, gx + gw / 2, 4.75, 5.25, gz - gd / 2, gz + gd / 2, 'pit_garage_roof', true));
    makeBox(g, gw, 4.8, 0.5, gx, 2.68, gz + gd / 2 - 0.25, garage);
    boxes.push(addSolidBox(gx - gw / 2, gx + gw / 2, 0.26, 5.06, gz + gd / 2 - 0.5, gz + gd / 2, 'pit_garage_back', false));
    const bays = G.bays ?? 7, stepX = gw / (bays - 1);
    for (let i = 0; i < bays; i++) {
      const px = gx - gw / 2 + i * stepX;
      makeBox(g, 0.5, 4.8, gd, px, 2.68, gz, garage);
      boxes.push(addSolidBox(px - 0.25, px + 0.25, 0.26, 5.06, gz - gd / 2, gz + gd / 2, 'pit_garage_wall', false));
    }
    makeBox(g, 14.0, 1.1, 0.22, gx, 4.4, gz - gd / 2 - 0.2,
      signBoxMaterials('PIT LANE & TEAM GARAGES', '#1e293b', '#facc15'), { name: 'Sign: Pit lane' });
    addKeepout(gx, gz, gw / 2 + 2, 'garages');
  }

  const S = row.grandstand;
  if (S) {
    const [sx, sz] = S.at, sw = S.w ?? 130, tiers = S.tiers ?? 5;
    for (let t = 0; t < tiers; t++) {
      const ty = 0.6 + t * 1.1, tz = sz + 4 - t * 1.8;
      makeBox(g, sw, 1.0, 1.8, sx, ty, tz, t % 2 ? cached('spSeat', () => makeMat(0x2563eb)) : steelMat());
      boxes.push(addSolidBox(sx - sw / 2 + 15, sx + sw / 2 - 15, 0.26, ty + 0.5, tz - 0.9, tz + 0.9, 'grandstand_tier', true));
    }
    makeBox(g, sw + 2, 0.4, 11, sx, 7.6, sz, cached('spRoof', () => makeMat(0x0f172a)));
    mapRect(sx, sz, sw + 2, 11, '#2563eb', '#f8fafc');
    addKeepout(sx, sz, sw / 2, 'grandstand');
  }
  return { object: g, boxes };
}

// =============================================================================
// REGISTRY / TEARDOWN
// =============================================================================
export const ROAD_BUILDERS = {
  road_grid: buildRoadGrid,
  road_run: buildRoadRun,
  road_ribbon: buildRoadRibbon,
  road_loop: buildRoadLoop,
  freeway_i88: buildFreeway,
  bridge_deck: buildBridgeDeck,
  ramp_driveable: buildDriveableRamp,
  pullout: buildPulloutRow,
  runway: buildRunway,
  speedway_track: buildSpeedwayTrack,
  speedway_pit: buildSpeedwayPit
};

export function resetRoads() {
  lastLoop = null;
  heightRefs.clear();
}
export function disposeRoads() {
  resetRoads();
  for (const m of ownedMats) m.dispose();
  ownedMats.length = 0;
  matCache.clear();
}

export default ROAD_BUILDERS;