import * as THREE from 'three';
import { camera, scene, worldRoot } from './engine.js';
import {
  collidesHorizontally, computeSupportFloor, gameState, hooks, keys, player, pushFeed, waterZones
} from './state.js';
import { sfx } from './audio.js';
import { spawnParticles } from './items.js';
import { vehicles } from './vehicles.js';

export const waterBodies = [];
export const floatingProps = [];

export const swimState = {
  active: false,
  submerged: false,
  wading: false,
  depth: 0,
  submersion: 0,
  oxygen: 100,
  maxOxygen: 100,
  y: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  yaw: 0,
  pitch: 0,
  strokePhase: 0,
  lastBodyId: null,
  drownTick: 0
};

let waterElapsed = 0;
let savedSurfaceFog = null;
let savedSurfaceBg = null;
let underwaterActive = false;
let forcedQuality = null;

const UNDERWATER_FOG_COLOR = new THREE.Color(0x074b6e);
const UNDERWATER_FOG_DENSITY = 0.046;

const DEFAULT_SKY_COLOR = new THREE.Color(0x60a5fa);
const DEFAULT_HORIZON_COLOR = new THREE.Color(0xbbe6fb);

function resolveGraphicsTier() {
  const raw =
    forcedQuality ??
    gameState?.graphicsQuality ??
    gameState?.graphics ??
    gameState?.quality ??
    gameState?.gfx ??
    gameState?.settings?.graphics ??
    gameState?.settings?.quality;

  if (typeof raw === 'number') {
    if (raw <= 0) return 0;
    if (raw === 1) return 1;
    return 2;
  }
  if (typeof raw === 'string') {
    const s = raw.toLowerCase();
    if (s === 'low' || s === 'fast' || s === 'performance') return 0;
    if (s === 'med' || s === 'medium' || s === 'balanced') return 1;
    return 2;
  }
  return 2;
}

export function setWaterQuality(tier) {
  forcedQuality = tier ?? null;
  const q = resolveGraphicsTier();
  for (let i = 0; i < waterShaderUniforms.length; i++) {
    waterShaderUniforms[i].uQuality.value = q;
  }
  for (let i = 0; i < seabedShaderUniforms.length; i++) {
    seabedShaderUniforms[i].uQuality.value = q;
  }
}

export function sampleOceanWave(x, z, time = waterElapsed, scale = 1.0) {
  if (scale <= 0.001) return 0;
  const w1 = Math.sin(x * 0.14 + z * 0.09 + time * 1.85) * 0.14;
  const w2 = Math.cos(x * 0.07 - z * 0.17 + time * 1.45) * 0.11;
  const w3 = Math.sin((x + z) * 0.28 - time * 2.45) * 0.055;
  const w4 = Math.cos(x * 0.42 - z * 0.36 + time * 3.10) * 0.025;
  return (w1 + w2 + w3 + w4) * scale;
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const vx = bx - ax;
  const vz = bz - az;
  const wx = px - ax;
  const wz = pz - az;
  const lenSq = vx * vx + vz * vz;
  const t = lenSq > 1e-6 ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / lenSq)) : 0;
  const dx = px - (ax + t * vx);
  const dz = pz - (az + t * vz);
  return Math.hypot(dx, dz);
}

const OCEAN_SHORE_SEGMENTS = [
  [28, 168, 138, 168, 0.155],
  [28, 168, 28, 208, 0.155],
  [138, 168, 138, 208, 0.155],
  [-50, 208, 28, 208, 0.155],
  [138, 208, 164, 208, 0.155],
  [-50, 208, -50, 320, 0.155],
  [164, 208, 164, 220, -0.01],
  [164, 220, 368, 220, -0.01],
  [368, 220, 368, 320, 0.155],
  [368, 320, 500, 320, 0.155],
  [-260, 320, -50, 320, 0.155],
  [-260, 320, -260, 380, 0.155],
  [500, 320, 500, 380, 0.155],
  [-260, 380, 500, 380, 0.155]
];

export function getOceanBedY(x, z) {
  let minDist = 999;
  let weightedTopY = 0;
  let totalWeight = 0;

  for (let i = 0; i < OCEAN_SHORE_SEGMENTS.length; i++) {
    const seg = OCEAN_SHORE_SEGMENTS[i];
    const d = distToSegment(x, z, seg[0], seg[1], seg[2], seg[3]);
    if (d < minDist) {
      minDist = d;
    }
    if (d < 36.0) {
      const w = 1.0 / (d * d + 0.25);
      weightedTopY += seg[4] * w;
      totalWeight += w;
    }
  }

  const shoreStartY = totalWeight > 0 ? weightedTopY / totalWeight : 0.155;
  const clampedDist = Math.max(0, minDist);
  const t = Math.min(1, clampedDist / 18.0);
  const smooth = t * t * (3 - 2 * t);
  const microUndulation =
    (Math.sin(x * 0.08) * Math.cos(z * 0.08) * 0.18 +
      Math.sin(x * 0.19 + z * 0.15) * 0.05) *
    smooth;

  return THREE.MathUtils.lerp(shoreStartY, -6.80, smooth) + microUndulation;
}

export function getWaterBodyAt(x, z) {
  for (let i = waterBodies.length - 1; i >= 0; i--) {
    const wb = waterBodies[i];
    if (x >= wb.minX && x <= wb.maxX && z >= wb.minZ && z <= wb.maxZ) {
      return wb;
    }
  }
  return null;
}

export function getWaterHeightAt(x, z, time = waterElapsed) {
  const wb = getWaterBodyAt(x, z);
  if (!wb) return null;
  return wb.surfaceY + sampleOceanWave(x, z, time, wb.waveScale);
}

export function getWaterBedAt(x, z) {
  const wb = getWaterBodyAt(x, z);
  if (!wb) return null;
  return wb.bedFn ? wb.bedFn(x, z) : wb.bedY;
}

export function getWaterDepthAt(x, z, time = waterElapsed) {
  const wb = getWaterBodyAt(x, z);
  if (!wb) return 0;
  const surf = wb.surfaceY + sampleOceanWave(x, z, time, wb.waveScale);
  const bed = wb.bedFn ? wb.bedFn(x, z) : wb.bedY;
  return Math.max(0, surf - bed);
}

export function isSwimming() {
  return swimState.active;
}

const waterShaderUniforms = [];
const seabedShaderUniforms = [];

function createOceanWaterMaterial({
  shallowColor = 0x22d3ee,
  deepColor = 0x054f7a,
  foamColor = 0xf0f9ff,
  waveScale = 1.0
} = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.12,
    metalness: 0.18,
    transparent: true,
    opacity: 0.90,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  const uniforms = {
    uTime: { value: 0 },
    uWaveScale: { value: waveScale },
    uQuality: { value: resolveGraphicsTier() },
    uShallowColor: { value: new THREE.Color(shallowColor) },
    uDeepColor: { value: new THREE.Color(deepColor) },
    uFoamColor: { value: new THREE.Color(foamColor) },
    uSkyColor: { value: DEFAULT_SKY_COLOR.clone() },
    uHorizonColor: { value: DEFAULT_HORIZON_COLOR.clone() }
  };
  waterShaderUniforms.push(uniforms);

  mat.customProgramCacheKey = () => 'aura-ocean-water-v2';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uWaveScale;
        attribute float aDepth;
        varying float vDepth;
        varying float vWaveCrest;
        varying vec3 vWorldPosW;
        varying vec3 vToCam;

        float evalOceanMacroWave(vec2 p, float t, float s) {
          if (s <= 0.001) return 0.0;
          float w1 = sin(p.x * 0.14 + p.y * 0.09 + t * 1.85) * 0.14;
          float w2 = cos(p.x * 0.07 - p.y * 0.17 + t * 1.45) * 0.11;
          float w3 = sin((p.x + p.y) * 0.28 - t * 2.45) * 0.055;
          float w4 = cos(p.x * 0.42 - p.y * 0.36 + t * 3.10) * 0.025;
          return (w1 + w2 + w3 + w4) * s;
        }`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        vec4 wpN = modelMatrix * vec4(position, 1.0);
        float shoreAttenN = smoothstep(0.0, 0.80, aDepth);
        float epsW = 0.35;
        float hC = evalOceanMacroWave(wpN.xz, uTime, uWaveScale) * shoreAttenN;
        float hX = evalOceanMacroWave(wpN.xz + vec2(epsW, 0.0), uTime, uWaveScale) * shoreAttenN;
        float hZ = evalOceanMacroWave(wpN.xz + vec2(0.0, epsW), uTime, uWaveScale) * shoreAttenN;
        objectNormal = normalize(vec3(-(hX - hC) / epsW, 1.0, -(hZ - hC) / epsW));`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 wpV = modelMatrix * vec4(transformed, 1.0);
        float shoreAttenV = smoothstep(0.0, 0.80, aDepth);
        float wDisp = evalOceanMacroWave(wpV.xz, uTime, uWaveScale) * shoreAttenV;
        transformed.y += wDisp;
        vec4 finalWorldW = modelMatrix * vec4(transformed, 1.0);
        vDepth = aDepth;
        vWaveCrest = wDisp;
        vWorldPosW = finalWorldW.xyz;
        vToCam = cameraPosition - finalWorldW.xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uWaveScale;
        uniform float uQuality;
        uniform vec3 uShallowColor;
        uniform vec3 uDeepColor;
        uniform vec3 uFoamColor;
        uniform vec3 uSkyColor;
        uniform vec3 uHorizonColor;
        varying float vDepth;
        varying float vWaveCrest;
        varying vec3 vWorldPosW;
        varying vec3 vToCam;

        vec2 evalCapillaryGrad(vec2 p, float t, float strength, float q) {
          if (strength <= 0.001) return vec2(0.0);
          vec2 g = vec2(0.0);

          float ph1 = p.x * 1.15 + p.y * 0.82 + t * 2.25;
          float c1 = cos(ph1) * 0.045;
          g += vec2(1.15, 0.82) * c1;

          if (q > 0.5) {
            float ph2 = -p.x * 0.92 + p.y * 1.48 - t * 1.95;
            float c2 = cos(ph2) * 0.038;
            g += vec2(-0.92, 1.48) * c2;
          }

          if (q > 1.5) {
            float ph3 = p.x * 2.75 - p.y * 2.15 + t * 3.40;
            float c3 = cos(ph3) * 0.022;
            g += vec2(2.75, -2.15) * c3;

            float ph4 = p.x * 4.30 + p.y * 3.85 - t * 4.15;
            float c4 = cos(ph4) * 0.013;
            g += vec2(4.30, 3.85) * c4;
          }

          return g * strength;
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float viewDistC = length(vToCam);
        float detailFadeC = smoothstep(220.0, 20.0, viewDistC);

        vec2 uvA = vWorldPosW.xz * 0.24 + vec2(uTime * 0.09, uTime * 0.06);
        vec2 uvB = vWorldPosW.xz * 0.41 - vec2(uTime * 0.07, -uTime * 0.10);
        float rippleA = sin(uvA.x * 6.2831 + sin(uvA.y * 4.6)) * 0.5 + 0.5;
        float rippleB = cos(uvB.y * 6.2831 + cos(uvB.x * 4.6)) * 0.5 + 0.5;
        float shimmer = pow(rippleA * rippleB, 1.55) * detailFadeC;

        vec3 warmSandTint = mix(vec3(0.76, 0.85, 0.78), uShallowColor, 0.55);
        float shoreBlend = smoothstep(0.02, 0.55, vDepth);
        float deepBlend = smoothstep(0.45, 4.60, vDepth);
        vec3 baseWater = mix(warmSandTint, uShallowColor, shoreBlend);
        baseWater = mix(baseWater, uDeepColor, deepBlend);

        float causticWeight = (1.0 - smoothstep(0.6, 4.8, vDepth)) * (0.45 + 0.55 * step(0.5, uQuality));
        baseWater += vec3(0.11, 0.21, 0.25) * shimmer * causticWeight;

        baseWater *= 1.0 + clamp(vWaveCrest * 0.45, -0.10, 0.14);

        float foamNoise = sin(vWorldPosW.x * 0.55 + uTime * 1.4) * cos(vWorldPosW.z * 0.55 - uTime * 1.1) * 0.5 + 0.5;
        float surfWave1 = sin(vDepth * 11.5 - uTime * 3.0 + foamNoise * 2.2) * 0.5 + 0.5;
        float surfWave2 = sin(vDepth * 19.0 - uTime * 4.2 - foamNoise * 1.8) * 0.5 + 0.5;
        float shoreMask = 1.0 - smoothstep(0.02, 1.15, vDepth);
        float edgeLap = 1.0 - smoothstep(0.0, 0.22, vDepth);
        float surfPattern = mix(surfWave1, surfWave1 * 0.65 + surfWave2 * 0.45, step(0.5, uQuality));
        float shoreFoam = clamp(
          shoreMask * smoothstep(0.46, 0.90, surfPattern + shoreMask * 0.34) + edgeLap * 0.55,
          0.0,
          1.0
        );

        float crestFoam = smoothstep(0.13, 0.28, vWaveCrest) * smoothstep(0.5, 2.0, vDepth) * (0.35 + 0.20 * foamNoise);
        float totalFoam = clamp(shoreFoam * 0.88 + crestFoam, 0.0, 1.0);

        diffuseColor.rgb = mix(baseWater, uFoamColor, totalFoam);

        float edgeAlpha = smoothstep(0.005, 0.28, vDepth);
        float depthAlpha = mix(0.52, 0.93, smoothstep(0.05, 2.8, vDepth));
        diffuseColor.a = max(depthAlpha, totalFoam * 0.94) * edgeAlpha;`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        float viewDistN = length(vToCam);
        float detailFadeN = smoothstep(240.0, 16.0, viewDistN);
        float shoreFadeN = smoothstep(0.02, 0.55, vDepth);
        float capStrength = clamp(uWaveScale, 0.25, 1.25) * detailFadeN * shoreFadeN;
        vec2 capGrad = evalCapillaryGrad(vWorldPosW.xz, uTime, capStrength, uQuality);
        vec3 viewPerturb = (viewMatrix * vec4(-capGrad.x, 0.0, -capGrad.y, 0.0)).xyz;
        normal = normalize(normal + viewPerturb);`
      )
      .replace(
        '#include <opaque_fragment>',
        `
        vec3 V_w = normalize(vToCam);
        float viewDistO = length(vToCam);
        float detailFadeO = smoothstep(240.0, 16.0, viewDistO);
        float shoreFadeO = smoothstep(0.02, 0.55, vDepth);
        vec2 capGradO = evalCapillaryGrad(vWorldPosW.xz, uTime, clamp(uWaveScale, 0.25, 1.25) * detailFadeO * shoreFadeO, uQuality);
        vec3 worldMacroN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
        vec3 wNorm = normalize(vec3(worldMacroN.x - capGradO.x * 0.55, max(0.35, worldMacroN.y), worldMacroN.z - capGradO.y * 0.55));

        float NdotV = max(dot(wNorm, V_w), 0.0);
        float fresnel = 0.025 + 0.975 * pow(1.0 - NdotV, 4.5);
        vec3 R_w = reflect(-V_w, wNorm);
        float reflUp = clamp(R_w.y, 0.0, 1.0);
        vec3 skyRefl = mix(uHorizonColor, uSkyColor, pow(reflUp, 0.58));

        vec3 sunDir = normalize(vec3(0.44, 0.66, -0.61));
        float RdotL = max(dot(R_w, sunDir), 0.0);
        float specTight = pow(RdotL, mix(140.0, 320.0, step(1.5, uQuality))) * mix(1.1, 1.85, step(1.5, uQuality));
        float specBroad = pow(RdotL, 34.0) * 0.22;
        vec3 sunGlint = vec3(1.0, 0.97, 0.90) * (specTight + specBroad);

        float sssTerm = pow(clamp(dot(V_w, -sunDir + wNorm * 0.55), 0.0, 1.0), 4.0);
        float crestMask = smoothstep(-0.02, 0.22, vWaveCrest) * smoothstep(0.25, 2.2, vDepth);
        vec3 sssGlow = vec3(0.08, 0.78, 0.74) * sssTerm * crestMask * 0.52 * step(0.5, uQuality);

        float reflStrength = fresnel * mix(0.48, 0.72, step(1.5, uQuality)) * smoothstep(0.02, 0.45, vDepth);
        outgoingLight = mix(outgoingLight, skyRefl, reflStrength);
        outgoingLight += sssGlow + sunGlint;
        #include <opaque_fragment>`
      );
  };

  return mat;
}

export function createWaterSurface({
  id = 'water',
  parent = worldRoot,
  minX,
  maxX,
  minZ,
  maxZ,
  surfaceY = 0.20,
  bedY = -4.0,
  bedFn = null,
  waveScale = 1.0,
  currentX = 0,
  currentZ = 0,
  shallowColor = 0x22d3ee,
  deepColor = 0x054f7a,
  foamColor = 0xf0f9ff,
  isOcean = false,
  registerZone = true,
  segmentSize = 3.0
}) {
  const tier = resolveGraphicsTier();
  const effectiveSegSize = tier >= 2 ? segmentSize * 0.8 : tier === 1 ? segmentSize : segmentSize * 1.35;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const segX = Math.max(4, Math.min(300, Math.ceil(width / effectiveSegSize)));
  const segZ = Math.max(4, Math.min(160, Math.ceil(depth / effectiveSegSize)));

  const geo = new THREE.PlaneGeometry(width, depth, segX, segZ);
  geo.rotateX(-Math.PI / 2);

  const cx = (minX + maxX) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const pos = geo.attributes.position;
  const depths = new Float32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    const wx = cx + pos.getX(i);
    const wz = cz + pos.getZ(i);
    const localBed = bedFn ? bedFn(wx, wz) : bedY;
    depths[i] = Math.max(0.0, surfaceY - localBed);
  }
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1));

  const mat = createOceanWaterMaterial({ shallowColor, deepColor, foamColor, waveScale });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, surfaceY, cz);
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  mesh.userData.studioName = `Water: ${id}`;
  parent.add(mesh);

  const body = {
    id,
    minX,
    maxX,
    minZ,
    maxZ,
    surfaceY,
    bedY,
    bedFn,
    waveScale,
    currentX,
    currentZ,
    isOcean,
    mesh
  };
  waterBodies.push(body);

  if (registerZone) {
    waterZones.push({ minX, maxX, minZ, maxZ });
  }

  return body;
}

function createSeabedMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.03,
    flatShading: false
  });

  const uniforms = {
    uTime: { value: 0 },
    uQuality: { value: resolveGraphicsTier() }
  };
  seabedShaderUniforms.push(uniforms);

  mat.customProgramCacheKey = () => 'aura-ocean-seabed-v1';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vBedWorldPos;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vBedWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uQuality;
        varying vec3 vBedWorldPos;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float sandRipple = sin(vBedWorldPos.x * 1.6 + sin(vBedWorldPos.z * 0.7) * 1.5) * 0.035;
        diffuseColor.rgb *= 1.0 + sandRipple;

        if (uQuality > 0.5 && vBedWorldPos.y < 0.14) {
          float depthSub = max(0.0, 0.20 - vBedWorldPos.y);
          float causticFade = smoothstep(0.02, 0.45, depthSub) * (1.0 - smoothstep(2.2, 6.2, depthSub));
          vec2 cUv1 = vBedWorldPos.xz * 0.34 + vec2(uTime * 0.11, uTime * 0.07);
          vec2 cUv2 = vBedWorldPos.xz * 0.52 - vec2(uTime * 0.08, -uTime * 0.12);
          float cA = abs(sin(cUv1.x * 4.5 + cos(cUv1.y * 4.0)));
          float cB = abs(cos(cUv2.y * 4.5 + sin(cUv2.x * 4.0)));
          float causticNet = pow(1.0 - min(cA, cB), 4.0);
          diffuseColor.rgb += vec3(0.20, 0.34, 0.36) * causticNet * causticFade;
        }`
      );
  };

  return mat;
}

export function buildOceanSeabed(parent = worldRoot) {
  const grp = new THREE.Group();
  grp.userData.studioName = 'Ocean Seabed';
  parent.add(grp);

  const cDryBeachSand = new THREE.Color(0xead196);
  const cWetSand = new THREE.Color(0xa6926c);
  const cSeagrass = new THREE.Color(0x2b5b49);
  const cDeepSilt = new THREE.Color(0x163242);
  const tmpColor = new THREE.Color();
  const seabedMat = createSeabedMaterial();

  const buildBedPatch = (x0, x1, z0, z1, step = 3.2) => {
    const w = x1 - x0;
    const d = z1 - z0;
    const sx = Math.max(4, Math.ceil(w / step));
    const sz = Math.max(4, Math.ceil(d / step));
    const geo = new THREE.PlaneGeometry(w, d, sx, sz);
    geo.rotateX(-Math.PI / 2);

    const cx = (x0 + x1) * 0.5;
    const cz = (z0 + z1) * 0.5;
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      const wx = cx + pos.getX(i);
      const wz = cz + pos.getZ(i);
      const by = getOceanBedY(wx, wz);
      pos.setY(i, by);

      const waterDepth = Math.max(0, 0.20 - by);
      const patchNoise = Math.sin(wx * 0.06) * Math.cos(wz * 0.06) * 0.5 + 0.5;
      tmpColor.copy(cDryBeachSand);
      tmpColor.lerp(cWetSand, THREE.MathUtils.smoothstep(waterDepth, 0.0, 1.35));
      if (waterDepth > 1.4 && patchNoise > 0.56) {
        tmpColor.lerp(cSeagrass, (patchNoise - 0.56) * 1.65);
      }
      tmpColor.lerp(cDeepSilt, THREE.MathUtils.smoothstep(waterDepth, 2.4, 6.3));

      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
    }

    pos.needsUpdate = true;
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, seabedMat);
    mesh.position.set(cx, 0, cz);
    mesh.receiveShadow = true;
    grp.add(mesh);
    return mesh;
  };

  buildBedPatch(26, 140, 166.0, 208, 2.5);
  buildBedPatch(-50, 164, 206.0, 320, 3.5);
  buildBedPatch(164, 368, 218.0, 320, 3.5);
  buildBedPatch(-260, 500, 320, 382.0, 3.5);

  return grp;
}

export function registerFloatingProp(object, x, z, baseOffset = 0, pitchScale = 0.85) {
  floatingProps.push({ object, x, z, baseOffset, pitchScale });
}

function updateUnderwaterAtmosphere(dt, elapsed) {
  const camWaterY = getWaterHeightAt(camera.position.x, camera.position.z, elapsed);
  const cameraUnderwater = camWaterY !== null && camera.position.y < camWaterY - 0.04;

  if (cameraUnderwater && !underwaterActive) {
    underwaterActive = true;
    if (scene.fog) {
      savedSurfaceFog = {
        color: scene.fog.color.clone(),
        density: scene.fog.density
      };
      scene.fog.color.copy(UNDERWATER_FOG_COLOR);
      scene.fog.density = UNDERWATER_FOG_DENSITY;
    }
    if (scene.background && scene.background.isColor) {
      savedSurfaceBg = scene.background.clone();
      scene.background.copy(UNDERWATER_FOG_COLOR);
    }
  } else if (!cameraUnderwater && underwaterActive) {
    underwaterActive = false;
    if (scene.fog && savedSurfaceFog) {
      scene.fog.color.copy(savedSurfaceFog.color);
      scene.fog.density = savedSurfaceFog.density;
    }
    if (scene.background && scene.background.isColor && savedSurfaceBg) {
      scene.background.copy(savedSurfaceBg);
    }
  } else if (cameraUnderwater && scene.fog) {
    scene.fog.color.copy(UNDERWATER_FOG_COLOR);
    scene.fog.density = UNDERWATER_FOG_DENSITY;
  }

  if (swimState.submerged && Math.random() < dt * 7) {
    spawnParticles(
      player.x + (Math.random() - 0.5) * 0.5,
      player.y + 1.15,
      player.z + (Math.random() - 0.5) * 0.5,
      0xbae6fd,
      2,
      1.6
    );
  }
}

function exitSwimmingState() {
  if (!swimState.active && !swimState.wading) return;
  swimState.active = false;
  swimState.submerged = false;
  swimState.wading = false;
  swimState.vx = 0;
  swimState.vy = 0;
  swimState.vz = 0;
  swimState.lastBodyId = null;
}

function updatePlayerSwimming(dt, elapsed) {
  if (gameState.inCar || player.mantle?.active) {
    exitSwimmingState();
    swimState.oxygen = Math.min(swimState.maxOxygen, swimState.oxygen + dt * 28);
    return;
  }

  const wb = getWaterBodyAt(player.x, player.z);
  if (!wb) {
    exitSwimmingState();
    swimState.oxygen = Math.min(swimState.maxOxygen, swimState.oxygen + dt * 28);
    return;
  }

  const surfaceY = wb.surfaceY + sampleOceanWave(player.x, player.z, elapsed, wb.waveScale);
  const bedY = wb.bedFn ? wb.bedFn(player.x, player.z) : wb.bedY;

  // Use true seabed depth (ignoring the dry-land terrainH plane that sits above the seabed)
  const totalWaterDepth = Math.max(0, surfaceY - bedY);
  const submersion = surfaceY - player.y;

  swimState.depth = totalWaterDepth;
  swimState.submersion = submersion;

  // Hysteresis prevents flickering between wading and swimming along shorelines
  const enterDepth = 0.85;
  const exitDepth = 0.55;
  const enterSubmersion = 0.72;
  const exitSubmersion = 0.42;

  const shouldSwim = swimState.active
    ? (totalWaterDepth >= exitDepth && submersion >= exitSubmersion)
    : (totalWaterDepth >= enterDepth && submersion >= enterSubmersion);

  if (!shouldSwim) {
    if (swimState.active) {
      exitSwimmingState();
    }
    swimState.wading = submersion > 0.12 && totalWaterDepth > 0.12;
    swimState.oxygen = Math.min(swimState.maxOxygen, swimState.oxygen + dt * 28);

    const moving = keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD'] ||
      keys['ArrowUp'] || keys['ArrowDown'] || keys['ArrowLeft'] || keys['ArrowRight'];
    if (swimState.wading && moving && Math.random() < dt * 10) {
      spawnParticles(player.x, surfaceY + 0.04, player.z, 0x7dd3fc, 2, 2.2);
    }
    return;
  }

  // Enter Minecraft-style 3D swimming
  if (!swimState.active) {
    swimState.active = true;
    swimState.y = Math.max(bedY, Math.min(surfaceY - 0.86, player.y));
    swimState.vx = player.pvx || 0;
    swimState.vz = player.pvz || 0;
    swimState.vy = Math.max(-2.0, (player.vy || 0) * 0.25);
    swimState.yaw = player.yaw || 0;
    spawnParticles(player.x, surfaceY + 0.08, player.z, 0xe0f2fe, 10, 3.8);
    if (sfx && typeof sfx.hit === 'function') sfx.hit();
    if (wb.isOcean && swimState.lastBodyId !== wb.id) {
      swimState.lastBodyId = wb.id;
      pushFeed('SWIMMING — LOOK TO STEER • [WASD] MOVE • [SPACE] UP • [C] DOWN', 'border-l-cyan-400');
    }
  }

  let moveForward = 0;
  let moveRight = 0;
  if (keys['KeyW'] || keys['ArrowUp']) moveForward += 1;
  if (keys['KeyS'] || keys['ArrowDown']) moveForward -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) moveRight += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) moveRight -= 1;

  const inputLen = Math.hypot(moveForward, moveRight);
  if (inputLen > 1) {
    moveForward /= inputLen;
    moveRight /= inputLen;
  }

  const sprinting = Boolean(keys['ShiftLeft'] || keys['ShiftRight']) && inputLen > 0.05 && (gameState.stamina ?? 100) > 0;
  const swimUpHeld = Boolean(keys['Space']);
  const swimDownHeld = Boolean(keys['KeyC'] || keys['ControlLeft'] || keys['ControlRight']);
  const yaw = player.yaw || 0;
  const pitch = player.pitch || 0;

  // 3D look direction matching camera forward (-sin(yaw), sin(pitch), -cos(yaw))
  const cosPitch = Math.cos(pitch);
  const flatFwdX = -Math.sin(yaw);
  const flatFwdZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);

  const surfaceFloatY = surfaceY - 0.86;
  const isUnderSurface = (swimState.y + 1.18) < surfaceY - 0.04;
  const divingByLook = moveForward > 0.05 && pitch < -0.08;
  const steering3D = isUnderSurface || divingByLook || (moveForward < -0.05 && pitch > 0.08);

  const baseSpeed = sprinting ? 10.2 : 6.4;

  // At the surface looking level/up, keep full horizontal skim speed; in 3D dive/underwater, follow 3D look pitch
  const horizPitchScale = steering3D ? Math.max(0.28, cosPitch) : 1.0;
  const targetVx = (flatFwdX * moveForward * horizPitchScale + rightX * moveRight) * baseSpeed + wb.currentX * 0.2;
  const targetVz = (flatFwdZ * moveForward * horizPitchScale + rightZ * moveRight) * baseSpeed + wb.currentZ * 0.2;

  const horizAccel = Math.min(1, dt * 12.0);
  swimState.vx += (targetVx - swimState.vx) * horizAccel;
  swimState.vz += (targetVz - swimState.vz) * horizAccel;

  let targetVy = 0;

  if (swimUpHeld && !swimDownHeld) {
    // Allow effortless hop-out onto docks, piers, boats, and low ledges when pressing Space near the surface
    if (swimState.y >= surfaceY - 1.15) {
      const probeX = player.x + flatFwdX * 0.95;
      const probeZ = player.z + flatFwdZ * 0.95;
      const aheadFloor = computeSupportFloor(probeX, probeZ, surfaceY + 1.1, 0.35);
      const blockedLow = collidesHorizontally(probeX, probeZ, surfaceY - 0.15, 0.75, 0.40);
      const blockedHigh = collidesHorizontally(probeX, probeZ, surfaceY + 0.95, 1.4, 0.40);

      if ((aheadFloor > surfaceY + 0.02 && aheadFloor <= surfaceY + 1.05) || (blockedLow && !blockedHigh)) {
        exitSwimmingState();
        player.x += flatFwdX * 0.38;
        player.z += flatFwdZ * 0.38;
        player.y = Math.max(player.y, surfaceY + 0.14);
        player.vy = 6.8;
        player.pvx = flatFwdX * 4.2;
        player.pvz = flatFwdZ * 4.2;
        player.grounded = false;
        player.peakAirY = player.y;
        spawnParticles(player.x, surfaceY + 0.1, player.z, 0xe0f2fe, 8, 3.2);
        return;
      }
    }

    if (swimState.y < surfaceFloatY + 0.06) {
      targetVy = 5.6;
    } else {
      targetVy = (surfaceFloatY + 0.06 - swimState.y) * 9.0;
    }
  } else if (swimDownHeld && !swimUpHeld) {
    targetVy = sprinting ? -7.2 : -5.4;
  } else if (Math.abs(moveForward) > 0.05 && steering3D) {
    // Swim directly along the vertical angle you're looking
    targetVy = Math.sin(pitch) * moveForward * baseSpeed * 1.15;
    if (!isUnderSurface && targetVy > 0 && swimState.y >= surfaceFloatY) {
      targetVy = (surfaceFloatY - swimState.y) * 9.0;
    }
  } else if (!isUnderSurface || swimState.y > surfaceY - 1.20) {
    // Buoyant surface float with eyes cleanly above water
    targetVy = (surfaceFloatY - swimState.y) * 9.0;
  } else {
    // Neutral underwater buoyancy: hold exact depth when releasing controls
    targetVy = 0;
  }

  const vertAccel = Math.min(1, dt * 12.0);
  swimState.vy += (targetVy - swimState.vy) * vertAccel;

  const nextX = player.x + swimState.vx * dt;
  const nextZ = player.z + swimState.vz * dt;
  const swimBodyH = 1.15;
  const r = player.radius || 0.35;

  if (!collidesHorizontally(nextX, player.z, swimState.y + 0.35, swimBodyH, r)) {
    player.x = nextX;
  } else {
    swimState.vx = 0;
  }
  if (!collidesHorizontally(player.x, nextZ, swimState.y + 0.35, swimBodyH, r)) {
    player.z = nextZ;
  } else {
    swimState.vz = 0;
  }

  swimState.y += swimState.vy * dt;

  const newSurfaceY = wb.surfaceY + sampleOceanWave(player.x, player.z, elapsed, wb.waveScale);
  const newBedY = wb.bedFn ? wb.bedFn(player.x, player.z) : wb.bedY;

  if (swimState.y < newBedY) {
    swimState.y = newBedY;
    swimState.vy = Math.max(0, swimState.vy);
  }
  const maxSurfaceY = newSurfaceY - 0.78;
  if (swimState.y > maxSurfaceY) {
    swimState.y = maxSurfaceY;
    if (swimState.vy > 0) swimState.vy = 0;
  }

  player.y = swimState.y;
  player.vy = swimState.vy;
  player.grounded = false;

  const strokeRate = inputLen > 0.05 ? (sprinting ? 9.5 : 6.2) : 2.2;
  swimState.strokePhase += dt * strokeRate;
  swimState.pitch = pitch;

  // Align third-person character yaw smoothly with movement/look direction (-Z forward)
  const horizSpeed = Math.hypot(swimState.vx, swimState.vz);
  if (horizSpeed > 0.25) {
    const targetRigYaw = Math.atan2(-swimState.vx, -swimState.vz);
    let diff = targetRigYaw - swimState.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    swimState.yaw += diff * Math.min(1, dt * 14);
  } else {
    swimState.yaw = yaw;
  }

  swimState.submerged = (swimState.y + 1.18) < newSurfaceY - 0.04;
  if (swimState.submerged) {
    swimState.oxygen = Math.max(0, swimState.oxygen - dt * 6.5);
  } else {
    swimState.oxygen = Math.min(swimState.maxOxygen, swimState.oxygen + dt * 26);
    swimState.drownTick = 0;
  }

  if (!swimState.submerged && inputLen > 0.05) {
    const rate = sprinting ? 16 : 9;
    if (Math.random() < dt * rate) {
      spawnParticles(
        player.x + (Math.random() - 0.5) * 0.65,
        newSurfaceY + 0.05,
        player.z + (Math.random() - 0.5) * 0.65,
        sprinting ? 0xf0f9ff : 0x7dd3fc,
        sprinting ? 3 : 2,
        sprinting ? 3.2 : 2.0
      );
    }
  }
}

function updateVehicleWaterPhysics(dt, elapsed) {
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    const wb = getWaterBodyAt(v.x, v.z);
    if (!wb) {
      v._inWater = false;
      continue;
    }

    const surfaceY = wb.surfaceY + sampleOceanWave(v.x, v.z, elapsed, wb.waveScale);
    const bedY = wb.bedFn ? wb.bedFn(v.x, v.z) : wb.bedY;
    const submersion = surfaceY - v.y;

    if (submersion <= 0.15) {
      v._inWater = false;
      continue;
    }

    if (!v._inWater) {
      v._inWater = true;
      v._flood = 0;
      spawnParticles(v.x, surfaceY + 0.15, v.z, 0xe0f2fe, 16, 5.5);
      if (sfx && typeof sfx.hit === 'function') sfx.hit();
    }

    if (typeof v.speed === 'number') {
      v.speed *= Math.pow(0.18, dt);
    }

    v._flood = Math.min(1, (v._flood || 0) + dt * (v.isTank ? 0.55 : 0.28));
    const floatTargetY = THREE.MathUtils.lerp(surfaceY - 0.45, bedY, v._flood * v._flood);

    if (v.y > floatTargetY) {
      const sinkRate = v._flood < 0.35 ? 0.45 : 1.85;
      v.y = Math.max(floatTargetY, v.y - sinkRate * dt);
    } else {
      v.y += (floatTargetY - v.y) * Math.min(1, dt * 4.0);
    }

    if (v._flood < 0.85) {
      v.x += wb.currentX * dt * 0.6;
      v.z += wb.currentZ * dt * 0.6;
    }

    if (v.root) {
      v.root.position.set(v.x, v.y, v.z);
      v.root.rotation.order = 'YXZ';
      const waveRoll = Math.sin(elapsed * 2.1 + i) * 0.06 * (1 - v._flood);
      const floodPitch = v._flood * 0.18;
      v.root.rotation.z = waveRoll;
      v.root.rotation.x = floodPitch;
    }

    if (v._flood < 0.95 && Math.random() < dt * 6) {
      spawnParticles(
        v.x + (Math.random() - 0.5) * 1.4,
        surfaceY + 0.05,
        v.z + (Math.random() - 0.5) * 2.2,
        0xbae6fd,
        2,
        2.0
      );
    }
  }
}

function updateFloatingProps(elapsed) {
  for (let i = 0; i < floatingProps.length; i++) {
    const fp = floatingProps[i];
    if (!fp.object) continue;
    const wb = getWaterBodyAt(fp.x, fp.z);
    const baseY = wb ? wb.surfaceY : 0.20;
    const scale = wb ? wb.waveScale : 1.0;

    const hC = sampleOceanWave(fp.x, fp.z, elapsed, scale);
    const hX = sampleOceanWave(fp.x + 1.2, fp.z, elapsed, scale);
    const hZ = sampleOceanWave(fp.x, fp.z + 1.2, elapsed, scale);

    fp.object.position.y = baseY + fp.baseOffset + hC;
    fp.object.rotation.z = Math.atan2(hC - hX, 1.2) * fp.pitchScale;
    fp.object.rotation.x = Math.atan2(hZ - hC, 1.2) * fp.pitchScale;
  }
}

export function updateWater(dt, elapsed) {
  waterElapsed = elapsed;
  const quality = resolveGraphicsTier();
  const skyCol = !underwaterActive && scene.background && scene.background.isColor
    ? scene.background
    : DEFAULT_SKY_COLOR;
  const horizonCol = !underwaterActive && scene.fog
    ? scene.fog.color
    : DEFAULT_HORIZON_COLOR;

  for (let i = 0; i < waterShaderUniforms.length; i++) {
    const u = waterShaderUniforms[i];
    u.uTime.value = elapsed;
    u.uQuality.value = quality;
    u.uSkyColor.value.copy(skyCol);
    u.uHorizonColor.value.copy(horizonCol);
  }

  for (let i = 0; i < seabedShaderUniforms.length; i++) {
    const u = seabedShaderUniforms[i];
    u.uTime.value = elapsed;
    u.uQuality.value = quality;
  }

  updateFloatingProps(elapsed);
  updateVehicleWaterPhysics(dt, elapsed);
  updatePlayerSwimming(dt, elapsed);
  updateUnderwaterAtmosphere(dt, elapsed);
}

export function resetWaterSystem() {
  waterBodies.length = 0;
  floatingProps.length = 0;
  waterShaderUniforms.length = 0;
  seabedShaderUniforms.length = 0;
  exitSwimmingState();
  swimState.oxygen = swimState.maxOxygen;
  swimState.drownTick = 0;

  if (underwaterActive) {
    underwaterActive = false;
    if (scene.fog && savedSurfaceFog) {
      scene.fog.color.copy(savedSurfaceFog.color);
      scene.fog.density = savedSurfaceFog.density;
    }
    if (scene.background && scene.background.isColor && savedSurfaceBg) {
      scene.background.copy(savedSurfaceBg);
    }
  }
  savedSurfaceFog = null;
  savedSurfaceBg = null;
}

Object.assign(hooks, {
  updateWater,
  resetWaterSystem,
  getWaterHeightAt,
  getWaterDepthAt,
  isSwimming,
  swimState,
  setWaterQuality
});