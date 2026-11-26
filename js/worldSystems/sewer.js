// =============================================================================
// worldSystems/sewer.js — SEWER NETWORK GEOMETRY + MANHOLE ANIMATION
//
// The sewer is a SEPARATE collision domain: state.sRects defines walkable
// underground rects, so geometry here carries NO worldBoxes (as the original).
// Row: { id:'sys/sewer', prefab:'sewer_network', width, wallH, nodes, edges,
//        exits, autoExits }
// =============================================================================
import * as THREE from 'three';
import {
  SFY, collidesHorizontally, manholeCovers, manholeHoles, manholeOpen, manholes, sRects
} from '../state.js';
import { worldRoot } from '../engine.js';
import { UNIT_BOX, flushInstances, makeBox, xform } from '../worldKit.js';

const cache = new Map();
function mat(key, make) {
  let m = cache.get(key);
  if (!m) { m = make(); m.userData.shared = true; cache.set(key, m); }
  return m;
}
const wallM  = () => mat('wall', () => new THREE.MeshStandardMaterial({ color: 0x6b706c, roughness: 0.95 }));
const flrM   = () => mat('flr',  () => new THREE.MeshStandardMaterial({ color: 0x585c58, roughness: 0.9 }));
const pipeM  = () => mat('pipe', () => new THREE.MeshStandardMaterial({ color: 0x7b5a3c, metalness: 0.5, roughness: 0.6 }));
const shaftM = () => mat('shaft',() => new THREE.MeshStandardMaterial({ color: 0x4d514d, roughness: 1, side: THREE.BackSide }));
const holeM  = () => mat('hole', () => new THREE.MeshStandardMaterial({ color: 0x5a5e5a, roughness: 0.95, side: THREE.DoubleSide }));
const coverM = () => mat('cover',() => new THREE.MeshStandardMaterial({ color: 0x2b2e31, metalness: 0.8, roughness: 0.5 }));
const blueM  = () => mat('blue', () => new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
const lampM  = () => mat('lamp', () => new THREE.MeshBasicMaterial({ color: 0xffd27a }));
const waterM = () => mat('water',() => new THREE.MeshStandardMaterial({
  color: 0x2f5f4a, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.82, emissive: 0x0b2a1e
}));
const discM  = () => mat('disc', () => new THREE.MeshBasicMaterial({ color: 0x050505 }));

export function buildSewer(row = {}) {
  const root = new THREE.Group();
  root.userData.studioName = 'Sewer network';
  (row.parent || worldRoot).add(root);

  const SW = row.width ?? 5.4, H2 = SW / 2, WH = row.wallH ?? 4.6, CY = SFY + WH;
  const box = (m, x, y, z, a, b, d) => makeBox(root, a, b, d, x, y, z, m);

  const N = row.nodes || {};
  const E = row.edges || [];
  const exits = [...(row.exits || [])];
  for (const k of row.autoExits || []) {
    const q = N[k];
    if (!q) continue;
    if (!collidesHorizontally(q[0], q[1], 0.2, 1.8, 1.4) &&
        !collidesHorizontally(q[0], q[1] + 1, 0.2, 1.8, 1.4)) {
      exits.push(k);
      manholes.push(q.slice());
    }
  }

  const dirOf = (p, q) => p[0] !== q[0] ? (q[0] > p[0] ? '+x' : '-x') : (q[1] > p[1] ? '+z' : '-z');
  const has = {};
  for (const k in N) has[k] = new Set();
  for (const [a, b] of E) { has[a].add(dirOf(N[a], N[b])); has[b].add(dirOf(N[b], N[a])); }

  // Square ceiling slab with a circular manhole cut out of it.
  const shape = new THREE.Shape();
  shape.moveTo(-H2, -H2); shape.lineTo(H2, -H2); shape.lineTo(H2, H2); shape.lineTo(-H2, H2); shape.closePath();
  const hp = new THREE.Path();
  hp.absarc(0, 0, 1.05, 0, Math.PI * 2, true);
  shape.holes.push(hp);
  const holeGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false });
  holeGeo.rotateX(Math.PI / 2);

  const lamps = [];
  for (const k in N) {
    const [x, z] = N[k];
    sRects.push([x - H2, x + H2, z - H2, z + H2]);
    box(flrM(), x, SFY - 0.25, z, SW, 0.5, SW);
    if (exits.indexOf(k) < 0) {
      box(wallM(), x, CY + 0.3, z, SW, 0.6, SW);
    } else {
      const c = new THREE.Mesh(holeGeo, holeM());
      c.position.set(x, CY + 0.6, z);
      root.add(c);
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, -SFY + 0.1, 16, 1, true), shaftM());
      sh.position.set(x, (SFY + 0.1) / 2, z);
      root.add(sh);
      for (const sx of [-0.3, 0.3]) box(blueM(), x + sx, SFY / 2, z + 0.95, 0.05, -SFY, 0.05);
      for (let y = SFY + 0.6; y < 0; y += 0.6) box(blueM(), x, y, z + 0.95, 0.6, 0.05, 0.05);
      lamps.push([x, CY - 0.1, z + 1.6]);
    }
    for (const d of ['+x', '-x', '+z', '-z']) {
      if (has[k].has(d)) continue;
      const sgn = d[0] === '+' ? 1 : -1;
      if (d[1] === 'x') box(wallM(), x + sgn * (H2 + 0.25), SFY + WH / 2, z, 0.5, WH, SW + 1);
      else box(wallM(), x, SFY + WH / 2, z + sgn * (H2 + 0.25), SW + 1, WH, 0.5);
    }
  }

  for (const [a, b] of E) {
    const A = N[a], B = N[b];
    if (!A || !B) continue;
    const ax = A[1] === B[1];
    const cx = (A[0] + B[0]) / 2, cz = (A[1] + B[1]) / 2;
    const L = (ax ? Math.abs(A[0] - B[0]) : Math.abs(A[1] - B[1])) - SW;
    sRects.push([Math.min(A[0], B[0]) - H2, Math.max(A[0], B[0]) + H2,
                 Math.min(A[1], B[1]) - H2, Math.max(A[1], B[1]) + H2]);
    if (ax) {
      box(flrM(), cx, SFY - 0.25, cz, L, 0.5, SW);
      box(wallM(), cx, CY + 0.3, cz, L, 0.6, SW);
      box(waterM(), cx, SFY + 0.04, cz, L, 0.06, 1.5);
      for (const sd of [-1, 1]) box(wallM(), cx, SFY + WH / 2, cz + sd * (H2 + 0.25), L, WH, 0.5);
    } else {
      box(flrM(), cx, SFY - 0.25, cz, SW, 0.5, L);
      box(wallM(), cx, CY + 0.3, cz, SW, 0.6, L);
      box(waterM(), cx, SFY + 0.04, cz, 1.5, 0.06, L);
      for (const sd of [-1, 1]) box(wallM(), cx + sd * (H2 + 0.25), SFY + WH / 2, cz, 0.5, WH, L);
    }
    const pg = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, L, 10), pipeM());
    if (ax) { pg.rotation.z = Math.PI / 2; pg.position.set(cx, CY - 0.5, cz + H2 - 0.6); }
    else { pg.rotation.x = Math.PI / 2; pg.position.set(cx + H2 - 0.6, CY - 0.5, cz); }
    root.add(pg);
    for (let t = -L / 2 + 4; t < L / 2 - 2; t += 9) lamps.push(ax ? [cx + t, CY - 0.1, cz] : [cx, CY - 0.1, cz + t]);
  }

  const lampT = [];
  for (const l of lamps) xform(lampT, l[0], l[1], l[2], 0.6, 0.12, 0.6);
  flushInstances(root, UNIT_BOX, lampM(), lampT);

  const cvG = new THREE.CylinderGeometry(0.75, 0.75, 0.06, 20);
  const hdG = new THREE.CircleGeometry(0.72, 20).rotateX(-Math.PI / 2);
  for (const m of manholes) {
    const c = new THREE.Mesh(cvG, coverM());
    c.position.set(m[0], 0.22, m[1]);
    c.userData.studioName = 'Manhole cover';
    root.add(c);
    manholeCovers.push(c);
    manholeOpen.push(false);
    const hd = new THREE.Mesh(hdG, discM());
    hd.position.set(m[0], 0.2, m[1]);
    hd.visible = false;
    root.add(hd);
    manholeHoles.push(hd);
  }
  return { object: root, boxes: [], anchors: { nodes: N } };
}

export function install() { /* geometry owns everything; nothing to wire */ }

/** Cover slide + hole reveal. Lived in aura.ahCull in the original. */
export function update(dt) {
  const k = Math.min(1, dt * 6);
  for (let i = 0; i < manholeCovers.length; i++) {
    const c = manholeCovers[i], m = manholes[i];
    if (!c || !m) continue;
    const tx = m[0] + (manholeOpen[i] ? 1.5 : 0);
    c.position.x += (tx - c.position.x) * k;
    if (manholeHoles[i]) manholeHoles[i].visible = !!manholeOpen[i];
  }
}

export function reset() { /* state arrays are cleared by resetWorldState() */ }
export default { buildSewer, install, update, reset };