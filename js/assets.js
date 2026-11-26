import * as THREE from 'three';
import { levelData, colorToHex } from './levelData.js';

export const ASSET_OVERRIDES_KEY = 'gta_aura_studio_assets';
const assetOverrides = new Map();
try {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(ASSET_OVERRIDES_KEY) : null;
  if (raw) Object.entries(JSON.parse(raw)).forEach(([k, v]) => { if (typeof v === 'string') assetOverrides.set(k, v); });
} catch (_) {      }

function persistOverrides() {
  try { localStorage.setItem(ASSET_OVERRIDES_KEY, JSON.stringify(Object.fromEntries(assetOverrides))); return true; }
  catch (err) { console.warn('[assets] could not persist imported assets (storage full?)', err); return false; }
}
export function registerAssetOverride(path, dataUrl) {
  assetOverrides.set(path, dataUrl);
  invalidateTexture(path);
  audioCache.delete(audioKey(path));
  return persistOverrides();
}
export function removeAssetOverride(path) { assetOverrides.delete(path); persistOverrides(); }
export function getAssetSource(path) { return assetOverrides.get(path) || path; }
export function hasAssetOverride(path) { return assetOverrides.has(path); }

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();    

export function loadTexture(pathOrDataUrl, { repeatX = 1, repeatY = 1 } = {}) {
  if (!pathOrDataUrl) return null;
  const key = `${pathOrDataUrl.length > 256 ? pathOrDataUrl.slice(0, 64) + pathOrDataUrl.length : pathOrDataUrl}|${repeatX}|${repeatY}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const tex = textureLoader.load(
    getAssetSource(pathOrDataUrl),
    () => { tex.needsUpdate = true; },
    undefined,
    () => { console.warn('[assets] texture failed to load:', pathOrDataUrl.slice(0, 80)); tex.userData.failed = true; }
  );
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  textureCache.set(key, tex);
  return tex;
}

export function invalidateTexture(pathOrDataUrl) {
  for (const [key, tex] of textureCache) {
    if (key.startsWith(pathOrDataUrl + '|')) { tex.dispose(); textureCache.delete(key); }
  }
}

function isPaintable(mat) {
  return mat && (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) && !mat.transparent;
}

function eachMesh(object3D, fn) {
  object3D.traverse((child) => { if (child.isMesh && child.material) fn(child); });
}

function ensurePrivateMaterials(object3D) {
  const cloneCache = new Map();
  eachMesh(object3D, (mesh) => {
    if (mesh.userData._origMaterial) return;
    mesh.userData._origMaterial = mesh.material;
    const swap = (m) => {
      if (!isPaintable(m)) return m;
      if (!cloneCache.has(m)) { const c = m.clone(); c.userData = { ...m.userData, _privateClone: true }; cloneCache.set(m, c); }
      return cloneCache.get(m);
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
}

function restoreMaterials(object3D) {
  eachMesh(object3D, (mesh) => {
    if (mesh.userData._origMaterial) { mesh.material = mesh.userData._origMaterial; delete mesh.userData._origMaterial; }
  });
}

export function applyEntityTexture(object3D, texturePath, repeatX = 1, repeatY = 1) {
  if (!object3D) return;
  if (!texturePath) {
    eachMesh(object3D, (mesh) => {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => { if (m && m.userData && m.userData._privateClone && m.map && m.userData._texApplied) { m.map = null; m.userData._texApplied = false; m.needsUpdate = true; } });
    });
    let tinted = false;
    eachMesh(object3D, (mesh) => { const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; mats.forEach((m) => { if (m && m.userData && m.userData._tinted) tinted = true; }); });
    if (!tinted) restoreMaterials(object3D);
    return;
  }
  ensurePrivateMaterials(object3D);
  const tex = loadTexture(texturePath, { repeatX: Number(repeatX) || 1, repeatY: Number(repeatY) || 1 });
  eachMesh(object3D, (mesh) => {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => {
      if (!isPaintable(m)) return;
      m.map = tex;
      m.userData._texApplied = true;
      m.needsUpdate = true;
    });
  });
}

export function applyEntityColor(object3D, color) {
  if (!object3D) return;
  if (!color) {
    eachMesh(object3D, (mesh) => {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => { if (m && m.userData && m.userData._tinted) { m.color.set(m.userData._origColor); m.userData._tinted = false; } });
    });
    let textured = false;
    eachMesh(object3D, (mesh) => { const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; mats.forEach((m) => { if (m && m.userData && m.userData._texApplied) textured = true; }); });
    if (!textured) restoreMaterials(object3D);
    return;
  }
  ensurePrivateMaterials(object3D);
  const hex = colorToHex(color, 0xffffff);
  eachMesh(object3D, (mesh) => {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => {
      if (!isPaintable(m) || !m.userData._privateClone) return;
      if (!m.userData._tinted) m.userData._origColor = m.color.getHex();
      m.color.setHex(hex);
      m.userData._tinted = true;
      m.needsUpdate = true;
    });
  });
}

export function applyModelPreset(modelId, object3D) {
  const p = levelData.params && levelData.params.models && levelData.params.models[modelId];
  if (!p || !object3D) return object3D;
  if (p.color) applyEntityColor(object3D, p.color);
  if (p.texture) applyEntityTexture(object3D, p.texture, (p.texRepeat || [1, 1])[0], (p.texRepeat || [1, 1])[1]);
  return object3D;
}

const audioCache = new Map();         

function audioKey(p) { return p.length > 256 ? p.slice(0, 64) + p.length : p; }

export function loadCustomAudio(pathOrDataUrl) {
  if (!pathOrDataUrl) return Promise.resolve(false);
  const key = audioKey(pathOrDataUrl);
  const hit = audioCache.get(key);
  if (hit) return hit.promise;
  const el = new Audio();
  el.preload = 'auto';
  const entry = { status: 'loading', el, src: pathOrDataUrl, promise: null };
  entry.promise = new Promise((resolve) => {
    const done = (ok) => { entry.status = ok ? 'ready' : 'failed'; if (!ok) console.warn('[assets] audio failed to load:', pathOrDataUrl.slice(0, 80)); resolve(ok); };
    el.addEventListener('canplaythrough', () => done(true), { once: true });
    el.addEventListener('error', () => done(false), { once: true });
    setTimeout(() => { if (entry.status === 'loading') done(el.readyState >= 2); }, 4000);
  });
  audioCache.set(key, entry);
  el.src = getAssetSource(pathOrDataUrl);
  el.load();
  return entry.promise;
}

export function playCustomAudio(pathOrDataUrl, volume = 1.0, { loop = false } = {}) {
  if (!pathOrDataUrl) return null;
  const key = audioKey(pathOrDataUrl);
  const entry = audioCache.get(key);
  if (!entry) { loadCustomAudio(pathOrDataUrl); return null; }
  if (entry.status !== 'ready') return null;
  const node = loop ? entry.el.cloneNode(true) : entry.el.cloneNode(true);
  node.volume = Math.max(0, Math.min(1, volume));
  node.loop = loop;
  const p = node.play();
  if (p && p.catch) p.catch(() => {});
  return node;
}

export function stopCustomAudio(node) {
  if (!node) return;
  try { node.pause(); node.currentTime = 0; } catch (_) {    }
}

export function preloadBoundAudio(data = levelData) {
  const paths = new Set(Object.values(data.audioBindings || {}).filter(Boolean));
  (data.assets && data.assets.audio ? data.assets.audio : []).forEach((p) => paths.add(p));
  return Promise.all([...paths].map((p) => loadCustomAudio(p)));
}

export function preloadRegisteredTextures(data = levelData) {
  (data.assets && data.assets.textures ? data.assets.textures : []).forEach((p) => loadTexture(p));
}
