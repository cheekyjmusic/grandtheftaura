// =============================================================================
// water.js — PS3-style water surfaces, seabed bathymetry, buoyancy physics,
// underwater atmosphere, and player swimming/diving mechanics.
// =============================================================================
import * as THREE from 'three';
import { camera, scene, worldRoot } from './engine.js';
import {
  collidesHorizontally, gameState, hooks, keys, player, pushFeed, waterZones
} from './state.js';
import { sfx } from './audio.js';
import { spawnParticles } from './items.js';
import { vehicles } from './vehicles.js';

// -----------------------------------------------------------------------------
// Water Registry & Swim State
// -----------------------------------------------------------------------------
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
  vy: 0,
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

const UNDERWATER_FOG_COLOR = new THREE.Color(0x074b6e);
const UNDERWATER_FOG_DENSITY = 0.046;

// -----------------------------------------------------------------------------
// Analytical PS3 Multi-Wave Function (shared 1:1 between GPU shader & CPU)
// -----------------------------------------------------------------------------
export function sampleOceanWave(x, z, time = waterElapsed, scale = 1.0) {
  if (scale <= 0.001) return 0;
  const w1 = Math.sin(x * 0.14 + z * 0.09 + time * 1.85) * 0.14;
  const w2 = Math.cos(x * 0.07 - z * 0.17 + time * 1.45) * 0.11;
  const w3 = Math.sin((x + z) * 0.28 - time * 2.45) * 0.055;
  const w4 = Math.cos(x * 0.42 - z * 0.36 + time * 3.10) * 0.025;
  return (w1 + w2 + w3 + w4) * scale;
}

// -----------------------------------------------------------------------------
// Ocean Bathymetry (Seabed Depth Profile)
// -----------------------------------------------------------------------------
/**
 * Returns the physical seabed height Y across the ocean, coves, and strait.
 * Smoothly slopes from ~0.16m along beaches/shores down to -6.8m in deep water.
 */
export function getOceanBedY(x, z) {
  // Distance inland from each coastline; positive = further out to sea
  let shoreDist = 999;

  // 1. Sunset Cove northern beach (z = 168) & side shores
  if (x >= 24 && x <= 142 && z >= 166 && z <= 212) {
    shoreDist = Math.min(shoreDist, z - 168.0);
    shoreDist = Math.min(shoreDist, x - 27.5);
    shoreDist = Math.min(shoreDist, 138.5 - x);
  }

  // 2. Central ocean west cliff / Frostpine shoreline (x = -50),
  //    Emerald Woods north bank (z = 208, x = -50..28), & east desert shore
  if (z >= 208 && z <= 320) {
    if (x < 164) {
      shoreDist = Math.min(shoreDist, x - (-50.5));
      if (x < 28 || x > 138) {
        shoreDist = Math.min(shoreDist, z - 208.0);
      }
    } else {
      // East ocean basin (z = 220..320, x = 164..368)
      shoreDist = Math.min(shoreDist, z - 220.0);
      shoreDist = Math.min(shoreDist, 368.5 - x);
    }
  }

  // 3. Ocean strait (z = 320..380, x = -260..500) & Santa Aura Beach (z = 380)
  if (z >= 318 && z <= 382) {
    shoreDist = Math.min(shoreDist, 380.0 - z);
    shoreDist = Math.min(shoreDist, x - (-260.5));
    shoreDist = Math.min(shoreDist, 500.5 - x);
  }

  const clampedDist = Math.max(0, shoreDist);
  const t = Math.min(1, clampedDist / 16.0);
  const smooth = t * t * (3 - 2 * t);
  const microUndulation = Math.sin(x * 0.08) * Math.cos(z * 0.08) * 0.22 * smooth;
  return 0.16 - smooth * 6.96 + microUndulation;
}

// -----------------------------------------------------------------------------
// Water Body Queries
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// PS3-Era Stylized Water Shader Material
// -----------------------------------------------------------------------------
const waterShaderUniforms = [];

function createPS3WaterMaterial({
  shallowColor = 0x22d3ee,
  deepColor = 0x054f7a,
  foamColor = 0xf0f9ff,
  waveScale = 1.0
} = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.14,
    metalness: 0.32,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  const uniforms = {
    uTime: { value: 0 },
    uWaveScale: { value: waveScale },
    uShallowColor: { value: new THREE.Color(shallowColor) },
    uDeepColor: { value: new THREE.Color(deepColor) },
    uFoamColor: { value: new THREE.Color(foamColor) }
  };
  waterShaderUniforms.push(uniforms);

  mat.customProgramCacheKey = () => 'ps3-ocean-water-v1';
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

        float evalPS3Wave(vec2 p, float t, float s) {
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
        float epsW = 0.35;
        float hC = evalPS3Wave(wpN.xz, uTime, uWaveScale);
        float hX = evalPS3Wave(wpN.xz + vec2(epsW, 0.0), uTime, uWaveScale);
        float hZ = evalPS3Wave(wpN.xz + vec2(0.0, epsW), uTime, uWaveScale);
        objectNormal = normalize(vec3(-(hX - hC) / epsW, 1.0, -(hZ - hC) / epsW));`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 wpV = modelMatrix * vec4(transformed, 1.0);
        float wDisp = evalPS3Wave(wpV.xz, uTime, uWaveScale);
        // Taper wave amplitude smoothly right at the beach edge so shorelines stay tidy
        float shoreAtten = clamp(aDepth / 0.65, 0.15, 1.0);
        transformed.y += wDisp * shoreAtten;
        vDepth = aDepth;
        vWaveCrest = wDisp;
        vWorldPosW = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec3 uShallowColor;
        uniform vec3 uDeepColor;
        uniform vec3 uFoamColor;
        varying float vDepth;
        varying float vWaveCrest;
        varying vec3 vWorldPosW;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Dual scrolling PS3-style water caustic / ripple pattern
        vec2 uvA = vWorldPosW.xz * 0.22 + vec2(uTime * 0.08, uTime * 0.05);
        vec2 uvB = vWorldPosW.xz * 0.37 - vec2(uTime * 0.06, -uTime * 0.09);
        float rippleA = sin(uvA.x * 6.283 + sin(uvA.y * 4.5)) * 0.5 + 0.5;
        float rippleB = cos(uvB.y * 6.283 + cos(uvB.x * 4.5)) * 0.5 + 0.5;
        float shimmer = pow(rippleA * rippleB, 1.6);

        float depthFactor = smoothstep(0.15, 3.8, vDepth);
        vec3 baseWater = mix(uShallowColor, uDeepColor, depthFactor);
        baseWater += vec3(0.08, 0.16, 0.22) * shimmer;

        // Animated shoreline surf foam in shallow water (< 0.95m)
        float surfWave = sin(vDepth * 13.0 - uTime * 3.1) * 0.5 + 0.5;
        float shoreMask = (1.0 - smoothstep(0.05, 0.95, vDepth));
        float shoreFoam = shoreMask * smoothstep(0.45, 0.92, surfWave + shoreMask * 0.35);

        // Subtle whitecap foam on wave crests
        float crestFoam = smoothstep(0.15, 0.30, vWaveCrest) * smoothstep(0.5, 2.0, vDepth) * 0.45;
        float totalFoam = clamp(shoreFoam * 0.85 + crestFoam, 0.0, 1.0);

        diffuseColor.rgb = mix(baseWater, uFoamColor, totalFoam);
        diffuseColor.a = mix(0.64, 0.91, smoothstep(0.05, 2.6, vDepth));
        diffuseColor.a = max(diffuseColor.a, totalFoam * 0.92);`
      );
  };

  return mat;
}

// -----------------------------------------------------------------------------
// Water Surface & Ocean Floor Builders
// -----------------------------------------------------------------------------
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
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const segX = Math.max(4, Math.min(260, Math.ceil(width / segmentSize)));
  const segZ = Math.max(4, Math.min(120, Math.ceil(depth / segmentSize)));

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
    depths[i] = Math.max(0.05, surfaceY - localBed);
  }
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1));

  const mat = createPS3WaterMaterial({ shallowColor, deepColor, foamColor, waveScale });
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

/**
 * Builds the continuous 3D sandy/rocky ocean floor beneath Sunset Cove,
 * the Far-North Ocean, and the Ocean Strait so players can wade down the
 * beach slope and swim/dive over a textured PS3 ocean seabed.
 */
export function buildOceanSeabed(parent = worldRoot) {
  const grp = new THREE.Group();
  grp.userData.studioName = 'Ocean Seabed';
  parent.add(grp);

  const cBeachSand = new THREE.Color(0xe9cf92);
  const cWetSand = new THREE.Color(0x9e8c68);
  const cKelp = new THREE.Color(0x2a5748);
  const cDeepSilt = new THREE.Color(0x183444);
  const tmpColor = new THREE.Color();

  const buildBedPatch = (x0, x1, z0, z1, step = 4.0) => {
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
      tmpColor.copy(cBeachSand);
      tmpColor.lerp(cWetSand, THREE.MathUtils.smoothstep(waterDepth, 0.0, 1.4));
      if (waterDepth > 1.6 && patchNoise > 0.58) {
        tmpColor.lerp(cKelp, (patchNoise - 0.58) * 1.6);
      }
      tmpColor.lerp(cDeepSilt, THREE.MathUtils.smoothstep(waterDepth, 2.5, 6.2));

      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
    }

    pos.needsUpdate = true;
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.04,
      flatShading: true
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, 0, cz);
    mesh.receiveShadow = true;
    grp.add(mesh);
    return mesh;
  };

  // Seamless seabed patches matching the 4 ocean surface zones
  buildBedPatch(28, 138, 168, 208, 3.0);
  buildBedPatch(-50, 164, 208, 320, 4.5);
  buildBedPatch(164, 368, 220, 320, 4.5);
  buildBedPatch(-260, 500, 320, 380, 4.5);

  return grp;
}

/** Register a boat, buoy, or floating prop to heave and pitch on the waves. */
export function registerFloatingProp(object, x, z, baseOffset = 0, pitchScale = 0.85) {
  floatingProps.push({ object, x, z, baseOffset, pitchScale });
}

// -----------------------------------------------------------------------------
// Underwater Camera & Fog Atmosphere
// -----------------------------------------------------------------------------
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

  // Rising air bubbles when player is submerged
  if (swimState.submerged && Math.random() < dt * 7) {
    spawnParticles(
      player.x + (Math.random() - 0.5) * 0.5,
      player.y + 1.35,
      player.z + (Math.random() - 0.5) * 0.5,
      0xbae6fd,
      2,
      1.6
    );
  }
}

// -----------------------------------------------------------------------------
// Player Swimming, Buoyancy & Diving Physics
// -----------------------------------------------------------------------------
const _camForward = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _upVec = new THREE.Vector3(0, 1, 0);

function getCameraSwimVectors() {
  camera.getWorldDirection(_camForward);
  const pitch = _camForward.y;
  _camForward.y = 0;
  if (_camForward.lengthSq() < 1e-5) {
    // Matches the +Z forward convention used across world.js
    _camForward.set(Math.sin(player.yaw || 0), 0, Math.cos(player.yaw || 0));
  } else {
    _camForward.normalize();
  }
  _camRight.crossVectors(_camForward, _upVec).normalize();
  return { forward: _camForward, right: _camRight, pitch };
}

function exitSwimmingState() {
  if (!swimState.active && !swimState.wading) return;
  swimState.active = false;
  swimState.submerged = false;
  swimState.wading = false;
  swimState.vy = 0;
  swimState.lastBodyId = null;
  const mesh = player.mesh || player.group || player.root;
  if (mesh) {
    mesh.rotation.x = 0;
    mesh.rotation.z = 0;
  }
}

function updatePlayerSwimming(dt, elapsed) {
  if (gameState.inCar) {
    exitSwimmingState();
    swimState.oxygen = Math.min(swimState.maxOxygen, swimState.oxygen + dt * 25);
    return;
  }

  const wb = getWaterBodyAt(player.x, player.z);
  if (!wb) {
    exitSwimmingState();
    swimState.oxygen = Math.min(swimState.maxOxygen, swimState.oxygen + dt * 25);
    return;
  }

  const surfaceY = wb.surfaceY + sampleOceanWave(player.x, player.z, elapsed, wb.waveScale);
  const bedY = wb.bedFn ? wb.bedFn(player.x, player.z) : wb.bedY;
  const totalWaterDepth = Math.max(0, surfaceY - bedY);

  // Restore simulated Y if external ground collision clamped player.y between frames
  if (swimState.active && Math.abs(player.y - swimState.y) > 0.25 && swimState.vy <= 1.5) {
    player.y = swimState.y;
  }

  const submersion = surfaceY - player.y;
  swimState.depth = totalWaterDepth;
  swimState.submersion = submersion;

  // 1. Shallow wading (< 1.12m submersion or shallow stream)
  if (submersion < 1.12 || totalWaterDepth < 1.22) {
    if (swimState.active) {
      exitSwimmingState();
    }
    swimState.wading = submersion > 0.15;
    swimState.oxygen = Math.min(swimState.maxOxygen, swimState.oxygen + dt * 24);

    // Follow sloped seabed cleanly while wading in the ocean
    if (wb.isOcean && player.y < bedY + 0.08 && (player.vy || 0) <= 0) {
      player.y = bedY;
      player.grounded = true;
    }

    const moving = keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD'];
    if (swimState.wading && moving && Math.random() < dt * 11) {
      spawnParticles(player.x, surfaceY + 0.04, player.z, 0x7dd3fc, 3, 2.4);
    }
    return;
  }

  // 2. Deep Water Swimming & Treading Water
  if (!swimState.active) {
    swimState.active = true;
    swimState.y = player.y;
    swimState.vy = Math.max(-2.5, (player.vy || 0) * 0.35);
    spawnParticles(player.x, surfaceY + 0.08, player.z, 0xe0f2fe, 12, 4.2);
    if (sfx && typeof sfx.hit === 'function') sfx.hit();
    if (wb.isOcean && swimState.lastBodyId !== wb.id) {
      swimState.lastBodyId = wb.id;
      pushFeed('OCEAN — [WASD] SWIM • [SHIFT] SPRINT • [C] DIVE • [SPACE] SURFACE', 'border-l-cyan-400');
    }
  }

  const { forward, right, pitch } = getCameraSwimVectors();
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

  const sprinting = Boolean(keys['ShiftLeft'] || keys['ShiftRight']) && inputLen > 0.05;
  const diving = Boolean(keys['KeyC'] || keys['ControlLeft'] || keys['ControlRight']);
  const surfacing = Boolean(keys['Space']);

  // Rhythmic PS3 breaststroke / freestyle cadence
  const strokeRate = inputLen > 0.05 ? (sprinting ? 8.5 : 5.4) : 2.2;
  swimState.strokePhase += dt * strokeRate;
  const strokePulse = inputLen > 0.05 ? (0.86 + 0.24 * Math.sin(swimState.strokePhase)) : 1.0;

  const baseSpeed = sprinting ? 8.1 : 5.3;
  const swimSpeed = baseSpeed * strokePulse;

  let vx = (forward.x * moveForward + right.x * moveRight) * swimSpeed + wb.currentX;
  let vz = (forward.z * moveForward + right.z * moveRight) * swimSpeed + wb.currentZ;

  // Vertical buoyancy & diving control
  const neutralFloatY = surfaceY - 1.18; // keeps head & shoulders above water
  if (diving) {
    // Dive downward smoothly
    swimState.vy += (-4.6 - swimState.vy) * Math.min(1, dt * 6.0);
  } else if (surfacing) {
    if (swimState.y < neutralFloatY - 0.18) {
      // Swim up toward the surface
      swimState.vy += (4.8 - swimState.vy) * Math.min(1, dt * 6.0);
    } else {
      // At surface: hop / climb out onto pier or seawall ledge
      const probeX = player.x + forward.x * 0.85;
      const probeZ = player.z + forward.z * 0.85;
      const blockedAhead = collidesHorizontally(probeX, probeZ, surfaceY - 0.2, surfaceY + 1.2, 0.45);
      if (blockedAhead) {
        swimState.vy = 6.4;
        vx += forward.x * 3.5;
        vz += forward.z * 3.5;
        exitSwimmingState();
        player.y = surfaceY + 0.35;
        player.vy = 6.2;
        player.grounded = false;
        spawnParticles(player.x, surfaceY + 0.1, player.z, 0xe0f2fe, 8, 3.2);
        return;
      }
      swimState.vy = Math.max(swimState.vy, 2.2);
    }
  } else if (swimState.y < neutralFloatY - 0.35 && inputLen > 0.1 && Math.abs(pitch) > 0.15) {
    // Underwater 3D pitch steering when swimming forward
    const targetVy = pitch * moveForward * swimSpeed * 0.85;
    swimState.vy += (targetVy - swimState.vy) * Math.min(1, dt * 4.5);
  } else {
    // Natural upward buoyancy toward the wave surface
    const buoyancyError = neutralFloatY - swimState.y;
    const springForce = buoyancyError * 11.5 - swimState.vy * 5.2;
    swimState.vy += springForce * dt;
  }

  // Integrate horizontal position with world collision sliding
  const nextX = player.x + vx * dt;
  const nextZ = player.z + vz * dt;
  const bodyLow = swimState.y + 0.25;
  const bodyHigh = swimState.y + 1.55;

  if (!collidesHorizontally(nextX, player.z, bodyLow, bodyHigh, 0.42)) {
    player.x = nextX;
  }
  if (!collidesHorizontally(player.x, nextZ, bodyLow, bodyHigh, 0.42)) {
    player.z = nextZ;
  }

  // Integrate vertical position & clamp against seabed and sky
  swimState.y += swimState.vy * dt;
  const newSurfaceY = wb.surfaceY + sampleOceanWave(player.x, player.z, elapsed, wb.waveScale);
  const newBedY = wb.bedFn ? wb.bedFn(player.x, player.z) : wb.bedY;

  if (swimState.y < newBedY) {
    swimState.y = newBedY;
    swimState.vy = Math.max(0, swimState.vy);
  }
  if (swimState.y > newSurfaceY - 0.75 && swimState.vy > 0 && !surfacing) {
    swimState.y = newSurfaceY - 0.75;
    swimState.vy = 0;
  }

  player.y = swimState.y;
  player.vy = swimState.vy;
  player.grounded = false;

  // Smoothly face movement direction (+Z forward convention)
  if (inputLen > 0.05) {
    const targetYaw = Math.atan2(vx, vz);
    swimState.yaw = targetYaw;
    if (typeof player.yaw === 'number') {
      player.yaw = targetYaw;
    }
  }

  // Procedural PS3 swim posture on player mesh if exposed
  const pMesh = player.mesh || player.group || player.root;
  if (pMesh) {
    const targetPitch = inputLen > 0.05 ? (diving ? 1.15 : 0.85) : 0.15;
    pMesh.rotation.x += (targetPitch - pMesh.rotation.x) * Math.min(1, dt * 8);
    pMesh.rotation.z = Math.sin(swimState.strokePhase) * (inputLen > 0.05 ? 0.16 : 0.04);
  }

  // Oxygen & underwater breath tracking
  swimState.submerged = (player.y + 1.52) < newSurfaceY;
  if (swimState.submerged) {
    swimState.oxygen = Math.max(0, swimState.oxygen - dt * 6.5);
    if (swimState.oxygen <= 0 && typeof player.health === 'number') {
      swimState.drownTick += dt;
      if (swimState.drownTick >= 0.5) {
        swimState.drownTick = 0;
        player.health = Math.max(0, player.health - 4);
        if (hooks.updateHUD) hooks.updateHUD(true);
      }
    }
  } else {
    swimState.oxygen = Math.min(swimState.maxOxygen, swimState.oxygen + dt * 22);
    swimState.drownTick = 0;
  }

  // Surface wake & splash foam particles
  if (!swimState.submerged && inputLen > 0.05) {
    const rate = sprinting ? 18 : 10;
    if (Math.random() < dt * rate) {
      spawnParticles(
        player.x + (Math.random() - 0.5) * 0.65,
        newSurfaceY + 0.05,
        player.z + (Math.random() - 0.5) * 0.65,
        sprinting ? 0xf0f9ff : 0x7dd3fc,
        sprinting ? 4 : 2,
        sprinting ? 3.4 : 2.1
      );
    }
  }
}

// -----------------------------------------------------------------------------
// Vehicle Buoyancy & Sinking Physics
// -----------------------------------------------------------------------------
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

    // Hydrodynamic water resistance slows wheels down rapidly
    if (typeof v.speed === 'number') {
      v.speed *= Math.pow(0.18, dt);
    }

    // Cars float briefly while taking on water, then sink to the seabed
    v._flood = Math.min(1, (v._flood || 0) + dt * (v.isTank ? 0.55 : 0.28));
    const floatTargetY = THREE.MathUtils.lerp(surfaceY - 0.45, bedY, v._flood * v._flood);

    if (v.y > floatTargetY) {
      const sinkRate = v._flood < 0.35 ? 0.45 : 1.85;
      v.y = Math.max(floatTargetY, v.y - sinkRate * dt);
    } else {
      // Bob gently on waves while still floating
      v.y += (floatTargetY - v.y) * Math.min(1, dt * 4.0);
    }

    // Apply current drift while floating
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

// -----------------------------------------------------------------------------
// Floating Boats & Buoys Animation
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Main Per-Frame Update & World Reset
// -----------------------------------------------------------------------------
export function updateWater(dt, elapsed) {
  waterElapsed = elapsed;

  for (let i = 0; i < waterShaderUniforms.length; i++) {
    waterShaderUniforms[i].uTime.value = elapsed;
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

// Expose water API on hooks for player/HUD/main loop interoperability
Object.assign(hooks, {
  updateWater,
  resetWaterSystem,
  getWaterHeightAt,
  getWaterDepthAt,
  isSwimming,
  swimState
});