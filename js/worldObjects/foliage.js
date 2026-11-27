// =============================================================================
// worldObjects/foliage.js — TREE MATERIALS WITH PER-TREE VARIATION & WIND
//
// bark.png + lushfoliage.png, extended via onBeforeCompile so the shared 'leaf'
// material varies UV rotation/scale/offset and subtle color tint per tree,
// while adding multi-frequency leaf rustling without extra draw calls.
//
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

const windUniforms = {
  uTime: { value: 0 }
};

let windRafId = null;
let lastWindTick = 0;

function startWindLoop() {
  if (windRafId !== null || typeof requestAnimationFrame === 'undefined') return;
  lastWindTick = performance.now();

  const tick = (now) => {
    if (!leafM) {
      windRafId = null;
      return;
    }
    const dt = Math.min((now - lastWindTick) * 0.001, 0.1);
    lastWindTick = now;
    windUniforms.uTime.value += dt;
    windRafId = requestAnimationFrame(tick);
  };

  windRafId = requestAnimationFrame(tick);
}

function stopWindLoop() {
  if (windRafId !== null && typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(windRafId);
  }
  windRafId = null;
}

/** Optional hook if you want to advance wind using your main game loop's dt. */
export function updateFoliage(dt) {
  stopWindLoop();
  windUniforms.uTime.value += dt;
}

function applyFoliageShader(material) {
  material.customProgramCacheKey = () => 'gta-leaf-variation-wind-v1';

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        varying vec2 vLeafUv;
        varying vec3 vLeafTint;

        float leafHash13(vec3 p3) {
          p3 = fract(p3 * 0.1031);
          p3 += dot(p3, p3.zyx + 31.32);
          return fract((p3.x + p3.y) * p3.z);
        }

        vec2 leafHash23(vec3 p3) {
          p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
          p3 += dot(p3, p3.yxz + 33.33);
          return fract((p3.xx + p3.yz) * p3.zy);
        }`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        // Subtle normal shimmer so sunlight catches individual leaf clusters as they flutter
        float nFlutterPhase = dot(position, vec3(7.3, 9.1, 6.7)) + (uv.x + uv.y) * 12.0;
        float nFlutterA = sin(uTime * 8.5 + nFlutterPhase);
        float nFlutterB = cos(uTime * 12.3 + nFlutterPhase * 1.37);
        objectNormal = normalize(objectNormal + vec3(nFlutterA * 0.08, nFlutterB * 0.05, -nFlutterA * 0.08));`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>

        // Resolve world-space origin of this tree (supports Mesh, InstancedMesh, or merged chunks)
        vec4 treeOrigin4 = vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          treeOrigin4 = instanceMatrix * treeOrigin4;
        #endif
        treeOrigin4 = modelMatrix * treeOrigin4;

        vec4 leafWorld4 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          leafWorld4 = instanceMatrix * leafWorld4;
        #endif
        leafWorld4 = modelMatrix * leafWorld4;
        vec3 leafWorldPos = leafWorld4.xyz;

        vec3 treeSeed = treeOrigin4.xyz;
        if (length(treeSeed) < 0.001) {
          treeSeed = floor(leafWorldPos * 0.15) * 6.66;
        }

        // 1. Per-tree UV rotation, tiling scale, and offset
        float randAngle = leafHash13(treeSeed) * 6.2831853;
        vec2 randOffset = leafHash23(treeSeed + 17.3) * 4.0;
        float randScale = mix(0.78, 1.32, leafHash13(treeSeed + 41.7));

        vec2 centeredUv = uv - 0.5;
        float s = sin(randAngle);
        float c = cos(randAngle);
        vec2 rotatedUv = vec2(
          centeredUv.x * c - centeredUv.y * s,
          centeredUv.x * s + centeredUv.y * c
        ) + 0.5;
        vLeafUv = rotatedUv * (2.0 * randScale) + randOffset;

        // 2. Subtle per-tree hue/brightness shift + intra-canopy depth variation
        float tintRand = leafHash13(treeSeed + 73.1);
        float shadeRand = leafHash13(treeSeed + 19.8);
        vec3 warmTint = vec3(1.06, 1.03, 0.88);
        vec3 coolTint = vec3(0.88, 1.02, 0.96);
        float canopyVar = sin(leafWorldPos.x * 1.6 + leafWorldPos.y * 2.1 + leafWorldPos.z * 1.4) * 0.05;
        vLeafTint = mix(coolTint, warmTint, tintRand) * mix(0.86, 1.12, shadeRand) + canopyVar;

        // 3. Two-layer wind: slow macro branch sway + rapid leaf-cluster flutter
        float windGust = sin(uTime * 1.2 + leafWorldPos.x * 0.18 + leafWorldPos.z * 0.15) * 0.5 + 0.5;
        float gustStrength = 0.45 + 0.55 * windGust;

        float swayX = sin(uTime * 1.9 + leafWorldPos.x * 0.35 + randAngle) * 0.032 * gustStrength;
        float swayZ = cos(uTime * 1.6 + leafWorldPos.z * 0.35 + randAngle * 1.3) * 0.028 * gustStrength;

        float flutterPhase = dot(position, vec3(7.3, 9.1, 6.7)) + (uv.x + uv.y) * 12.0;
        float flutterX = sin(uTime * 8.5 + flutterPhase) * 0.013 * gustStrength;
        float flutterY = sin(uTime * 10.2 + flutterPhase * 1.21) * 0.009 * gustStrength;
        float flutterZ = cos(uTime * 9.3 + flutterPhase * 0.87) * 0.013 * gustStrength;

        transformed += vec3(swayX + flutterX, flutterY, swayZ + flutterZ);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vLeafUv;
        varying vec3 vLeafTint;`
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vLeafUv );
          diffuseColor *= sampledDiffuseColor;
        #endif
        diffuseColor.rgb *= vLeafTint;`
      );
  };
}

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

  applyFoliageShader(leafM);
  startWindLoop();

  defineMaterial('bark', barkM);
  defineMaterial('barkBirch', birchM);
  defineMaterial('leaf', leafM);
}

/** Direct getters for the legacy mesh builders (street trees, river logs). */
export function barkMaterial() { registerFoliage(); return barkM; }
export function leafMaterial() { registerFoliage(); return leafM; }

/** Full teardown only. Lazy getters re-create everything on the next build. */
export function disposeFoliage() {
  stopWindLoop();
  for (const m of [barkM, leafM, birchM]) if (m) m.dispose();
  if (barkTex) barkTex.dispose();
  if (leafTex) leafTex.dispose();
  barkM = leafM = birchM = null;
  barkTex = leafTex = null;
}

export default { registerFoliage, barkMaterial, leafMaterial, updateFoliage, disposeFoliage };