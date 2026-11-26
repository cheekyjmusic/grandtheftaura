// =============================================================================
// worldObjects/foliage.js — THE ORIGINAL TREE MATERIALS
//
// bark.png + lushfoliage.png, exactly as the original world.js built them.
// Registered as NAMED kit materials so data prefabs resolve them by name:
//   'bark'      trunk material        (prop_tree/pine/palm/kapok, logs)
//   'barkBirch' white-tinted bark     (birch trunks)
//   'leaf'      lush foliage canopy   (all tree crowns, pine layers, fronds)
//
// 'foliage' / 'foliageDark' stay FLAT palette greens — ferns, cacti, vines and
// mushroom bushes were flat colours in the original and must not get textures.
//
// Lifecycle: created once, marked shared (disposeTree skips them on rebuild),
// released only by disposeFoliage() on full teardown. registerFoliage() is
// idempotent and re-runs from registerEverything() after disposeWorld().
// =============================================================================
import * as THREE from 'three';
import { loadTexture } from '../assets.js';
import { defineMaterial } from '../worldKit.js';

let barkTex = null, leafTex = null;
let barkM = null, leafM = null, birchM = null;

export function registerFoliage() {
  if (barkM) return;
  barkTex = loadTexture('assets/textures/bark.png', { repeatX: 1, repeatY: 4 });
  leafTex = loadTexture('assets/textures/lushfoliage.png', { repeatX: 2, repeatY: 2 });

  barkM = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: barkTex, roughness: 0.92, flatShading: true
  });
  leafM = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: leafTex, roughness: 0.88, flatShading: true,
    side: THREE.DoubleSide, alphaTest: 0.35
  });
  birchM = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9, map: barkTex, roughness: 0.92, flatShading: true
  });

  defineMaterial('bark', barkM);
  defineMaterial('barkBirch', birchM);
  defineMaterial('leaf', leafM);
}

/** Direct getters for the legacy mesh builders (street trees, river logs). */
export function barkMaterial() { registerFoliage(); return barkM; }
export function leafMaterial() { registerFoliage(); return leafM; }

/** Full teardown only. Lazy getters re-create everything on the next build. */
export function disposeFoliage() {
  for (const m of [barkM, leafM, birchM]) if (m) m.dispose();
  if (barkTex) barkTex.dispose();
  if (leafTex) leafTex.dispose();
  barkM = leafM = birchM = null;
  barkTex = leafTex = null;
}

export default { registerFoliage, barkMaterial, leafMaterial, disposeFoliage };