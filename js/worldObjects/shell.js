// =============================================================================
// worldObjects/shell.js — SHARED BUILDING SHELL TOOLKIT
//
// Every walk-in structure in the game is the same five moves:
//   floor slab · back wall · two side walls · two front segments + door header
//   · five matching colliders.
// shell() does exactly that, once. Callers add only what makes them unique.
//
// Colliders are ALWAYS explicit and returned, never inferred from geometry.
// =============================================================================
import * as THREE from 'three';
import { enterableZones, mapShapes, terrainH } from '../state.js';
import { makeMat, realWindowGlassMat, worldRoot } from '../engine.js';
import { addSolidBox, makeBox, resolveMat, signBoxMaterials } from '../worldKit.js';
import { maxTerrainOver } from '../worldTerrain.js';

export const hexStr = (c) => '#' + new THREE.Color(c).getHexString();

/** Resolve a founding height: number | 'terrain' | 'maxTerrain+0.12' | fallback. */
export function foundY(spec, x, z, w, d, fallback = 0.18) {
  if (Number.isFinite(spec)) return spec;
  if (typeof spec === 'string') {
    const s = spec.trim();
    const m = /^maxTerrain([+-]\d+(?:\.\d+)?)?$/.exec(s);
    if (m) return maxTerrainOver(x - w / 2, x + w / 2, z - d / 2, z + d / 2) + (m[1] ? Number(m[1]) : 0);
    if (s === 'terrain') return terrainH(x, z);
  }
  return fallback;
}

/** Cached neon sign face. Kit owns the texture; disposal skips it. */
export function neon(parent, text, x, y, z, bg = '#0f172a', fg = '#f8fafc', w = 4.4, h = 1.1, o = {}) {
  return makeBox(parent, w, h, 0.22, x, y, z, signBoxMaterials(text, bg, fg),
    { name: `Sign: ${text}`, ...o });
}

// Window panes are the one non-unit geometry here — cache them by size.
const paneCache = new Map();
function pane(w, h) {
  const k = `${w.toFixed(3)}|${h.toFixed(3)}`;
  let g = paneCache.get(k);
  if (!g) {
    g = new THREE.PlaneGeometry(w, h);
    g.userData.shared = true;
    paneCache.set(k, g);
  }
  return g;
}

/** Wall segment with a real rectangular cutout, glass on both faces. */
export function wallWithWindow(parent, width, height, thick, winW, winH, winY, wallMat, mullions = true) {
  const g = new THREE.Group();
  winW = Math.min(winW, width - 0.2);
  const sideW = Math.max(0.1, (width - winW) / 2);
  const botH = Math.max(0.1, winY - winH / 2);
  const topH = Math.max(0.1, height - (winY + winH / 2));
  const trim = resolveMat('white');
  makeBox(g, sideW, height, thick, -(winW / 2 + sideW / 2), height / 2, 0, wallMat, { cast: true, recv: true });
  makeBox(g, sideW, height, thick, winW / 2 + sideW / 2, height / 2, 0, wallMat, { cast: true, recv: true });
  makeBox(g, winW, botH, thick, 0, botH / 2, 0, wallMat, { cast: true, recv: true });
  makeBox(g, winW, topH, thick, 0, winY + winH / 2 + topH / 2, 0, wallMat, { cast: true });
  makeBox(g, winW + 0.16, 0.08, thick + 0.12, 0, winY - winH / 2, 0, trim);
  const pg = pane(winW, winH);
  const out = new THREE.Mesh(pg, realWindowGlassMat);
  out.position.set(0, winY, 0.012);
  const inn = new THREE.Mesh(pg, realWindowGlassMat);
  inn.position.set(0, winY, -0.012);
  inn.rotation.y = Math.PI;
  g.add(out, inn);
  if (mullions) {
    makeBox(g, winW, 0.05, 0.06, 0, winY, 0, trim);
    makeBox(g, 0.05, winH, 0.06, 0, winY, 0, trim);
  }
  parent.add(g);
  return g;
}

/** Extruded gable roof, overhanging on all four sides. */
export function gableRoof(parent, w, d, y, roofH, overhang, mat) {
  const shape = new THREE.Shape();
  shape.moveTo(-(w / 2 + overhang), 0);
  shape.lineTo(w / 2 + overhang, 0);
  shape.lineTo(0, roofH);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d + overhang * 2, bevelEnabled: false });
  geo.translate(0, 0, -(d / 2 + overhang));
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  m.castShadow = true;
  parent.add(m);
  return m;
}

/**
 * The shared shell. Returns the group, its five wall colliders, and a `solid()`
 * helper so callers add their own colliders to the SAME returned array.
 *
 * back  'solid' | [winW, winH, winY]
 * side  null    | [winW, winH, winY]
 * front null    | [winW, winH, winY] | 'auto'   (auto = segW - 1.0)
 */
export function shell(o) {
  const {
    parent = worldRoot, x, z, y = 0.18, w, d, h, t = 0.36,
    doorW = 2.6, doorH = 2.85, wallMat, name,
    back = 'solid', side = null, front = null, mullions = true,
    floorMat = null, floorT = 0.08, tag = 'wall'
  } = o;

  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.userData.studioName = name || 'Building';
  parent.add(g);

  const boxes = [];
  const minX = x - w / 2, maxX = x + w / 2, minZ = z - d / 2, maxZ = z + d / 2;
  const solid = (x0, x1, y0, y1, z0, z1, tg, climb) => {
    const b = addSolidBox(x0, x1, y0, y1, z0, z1, tg, climb);
    boxes.push(b);
    return b;
  };

  if (floorMat) makeBox(g, w - 0.2, floorT, d - 0.2, 0, floorT / 2, 0, floorMat, { recv: true });

  // --- back ---------------------------------------------------------------
  const bz = -d / 2 + t / 2;
  if (back === 'solid') {
    makeBox(g, w, h, t, 0, h / 2, bz, wallMat, { cast: true });
  } else {
    const bg = new THREE.Group();
    bg.position.set(0, 0, bz);
    wallWithWindow(bg, w, h, t, back[0], back[1], back[2], wallMat, mullions);
    g.add(bg);
  }
  solid(minX, maxX, y, y + h, minZ, minZ + t, tag, false);

  // --- sides --------------------------------------------------------------
  for (const s of [-1, 1]) {
    const sx = s * (w / 2 - t / 2);
    if (side) {
      const sg = new THREE.Group();
      sg.position.set(sx, 0, 0);
      sg.rotation.y = -s * Math.PI / 2;
      wallWithWindow(sg, d - t * 2, h, t, side[0], side[1], side[2], wallMat, mullions);
      g.add(sg);
    } else {
      makeBox(g, t, h, d, sx, h / 2, 0, wallMat, { cast: true });
    }
    solid(s < 0 ? minX : maxX - t, s < 0 ? minX + t : maxX, y, y + h, minZ, maxZ, tag, false);
  }

  // --- front segments + door header ---------------------------------------
  const fz = d / 2 - t / 2, segW = (w - doorW) / 2;
  const frontSpec = front === 'auto'
    ? [Math.max(0.4, segW - 1.0), h * 0.42, h * 0.45]
    : front;
  for (const s of [-1, 1]) {
    const px = s * (doorW / 2 + segW / 2);
    if (frontSpec) {
      const fg = new THREE.Group();
      fg.position.set(px, 0, fz);
      wallWithWindow(fg, segW, h, t, frontSpec[0], frontSpec[1], frontSpec[2], wallMat, mullions);
      g.add(fg);
    } else {
      makeBox(g, segW, h, t, px, h / 2, fz, wallMat, { cast: true });
    }
    solid(s < 0 ? minX : x + doorW / 2, s < 0 ? x - doorW / 2 : maxX, y, y + h, maxZ - t, maxZ, tag, false);
  }
  const hh = h - doorH;
  if (hh > 0.01) makeBox(g, doorW, hh, t, 0, doorH + hh / 2, fz, wallMat);

  return { g, boxes, solid, minX, maxX, minZ, maxZ, segW, fz, x, z, y, w, d, h, t, doorW };
}

/** Flat roof slab + its climbable collider, in one call. */
export function flatRoof(S, mat, { over = 0.6, thick = 0.36, lift = 0, tag = 'roof' } = {}) {
  const { g, w, d, h, y, minX, maxX, minZ, maxZ, solid } = S;
  makeBox(g, w + over, thick, d + over, 0, h + lift + thick / 2, 0, mat, { cast: true });
  solid(minX, maxX, y + h + lift, y + h + lift + thick, minZ, maxZ, tag, true);
}

export function zone(name, minX, maxX, minZ, maxZ) {
  enterableZones.push({ minX, maxX, minZ, maxZ, name });
}
export function mapRect(x, z, w, d, color, border, enterable = false) {
  mapShapes.push({ x, z, w, d, color, border, enterable });
}
export function wallMat(hex, repeatX = 4, repeatY = 2) {
  return makeMat(hex, { texType: 'siding', repeatX, repeatY, bumpScale: 0.015 });
}