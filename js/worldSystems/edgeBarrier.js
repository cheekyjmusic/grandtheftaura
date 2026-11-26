// =============================================================================
// worldSystems/edgeBarrier.js — COUNTY LINE (proximity-fade perimeter)
// Built AFTER recomputeWorldBounds so it wraps the finished map.
// =============================================================================
import * as THREE from 'three';
import { WORLD_BOUNDS, player, sstep } from '../state.js';
import { worldRoot } from '../engine.js';
import { dist2, makeBox, signBoxMaterials } from '../worldKit.js';

const chunks = [];
let cfg = { chunk: 46, near: 46, far: 96 };

const themeAt = (x, z) => {
  if (z < -170) return { body: 0x6b6257, cap: 0x8a8175, label: 'AVALANCHE ZONE' };
  if (x < -196) return { body: 0x57534e, cap: 0x78716c, label: 'BACKCOUNTRY CLOSED' };
  if (x > 424) return { body: 0x4d7c0f, cap: 0x65a30d, label: 'JUNGLE RESERVE' };
  return { body: 0xd1d5db, cap: 0xef4444, label: 'END OF AURA COUNTY' };
};

export function buildEdgeBarrier(spec = {}) {
  cfg = { ...cfg, ...spec };
  chunks.length = 0;
  const root = new THREE.Group();
  root.userData.studioName = 'Aura county line';
  root.userData.studioSelectable = false;
  worldRoot.add(root);

  const minX = WORLD_BOUNDS.minX + 3, maxX = WORLD_BOUNDS.maxX - 3;
  const minZ = WORLD_BOUNDS.minZ + 3, maxZ = WORLD_BOUNDS.maxZ - 3;
  const CHUNK = cfg.chunk;

  const makeChunk = (cx, cz, alongX, len, index) => {
    const theme = themeAt(cx, cz);
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.visible = false;
    const bodyMat = new THREE.MeshStandardMaterial({
      color: theme.body, roughness: 0.88, metalness: 0.05, transparent: true, opacity: 0, depthWrite: false
    });
    const capMat = new THREE.MeshStandardMaterial({
      color: theme.cap, roughness: 0.5, metalness: 0.2, emissive: theme.cap,
      emissiveIntensity: 0.35, transparent: true, opacity: 0, depthWrite: false
    });
    makeBox(g, alongX ? len : 1.1, 2.6, alongX ? 1.1 : len, 0, 1.3, 0, bodyMat);
    makeBox(g, alongX ? len : 1.3, 0.24, alongX ? 1.3 : len, 0, 2.72, 0, capMat);
    const posts = Math.max(2, Math.round(len / 12));
    for (let i = 0; i <= posts; i++) {
      const t = (i / posts - 0.5) * len;
      makeBox(g, 0.22, 0.5, 0.22, alongX ? t : 0, 3.05, alongX ? 0 : t, capMat);
    }
    if (index % 4 === 0) {
      const sign = makeBox(g, 9.0, 1.0, 0.22, 0, 3.9, 0,
        signBoxMaterials(theme.label, '#0b0b0f', '#facc15'), { name: `Sign: ${theme.label}` });
      if (!alongX) sign.rotation.y = Math.PI / 2;
      // These label texts are unique to the barrier, so mutating the cached
      // sign materials cannot affect any other sign in the world.
      sign.material.forEach((m) => { m.transparent = true; m.opacity = 0; });
      g.userData.signMats = sign.material;
    }
    root.add(g);
    chunks.push({ group: g, x: cx, z: cz, mats: [bodyMat, capMat], opacity: 0 });
  };

  let idx = 0;
  const spanX = maxX - minX, spanZ = maxZ - minZ;
  const nx = Math.max(1, Math.ceil(spanX / CHUNK)), nz = Math.max(1, Math.ceil(spanZ / CHUNK));
  const lx = spanX / nx, lz = spanZ / nz;
  for (let i = 0; i < nx; i++) {
    const cx = minX + lx * (i + 0.5);
    makeChunk(cx, minZ, true, lx + 0.4, idx++);
    makeChunk(cx, maxZ, true, lx + 0.4, idx++);
  }
  for (let i = 0; i < nz; i++) {
    const cz = minZ + lz * (i + 0.5);
    makeChunk(minX, cz, false, lz + 0.4, idx++);
    makeChunk(maxX, cz, false, lz + 0.4, idx++);
  }
  return root;
}

export function updateEdgeBarrier() {
  const NEAR = cfg.near, FAR = cfg.far, N2 = NEAR * NEAR, F2 = FAR * FAR;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const d2 = dist2(player.x, player.z, c.x, c.z);
    const target = d2 >= F2 ? 0 : (d2 <= N2 ? 1 : sstep(FAR, NEAR, Math.sqrt(d2)));
    if (Math.abs(target - c.opacity) < 0.004) continue;
    c.opacity = target;
    c.group.visible = target > 0.01;
    for (const m of c.mats) m.opacity = target;
    const sm = c.group.userData.signMats;
    if (sm) for (const m of sm) m.opacity = target;
  }
}

export function revealEdgeBarrier() {
  for (const c of chunks) {
    c.group.visible = true;
    c.opacity = 1;
    for (const m of c.mats) m.opacity = 1;
    const sm = c.group.userData.signMats;
    if (sm) for (const m of sm) m.opacity = 1;
  }
}

export function reset() { chunks.length = 0; }
export function install() { /* built by the edgeBarrier BOOT step */ }
export function update() { updateEdgeBarrier(); }
export default { buildEdgeBarrier, updateEdgeBarrier, revealEdgeBarrier, install, update, reset };