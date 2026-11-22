// =============================================================================
// grass.js — Forest-only PS3-era instanced grass with static frustum-culled
//            world chunks, GPU distance clumping, and wind/trample shaders.
// =============================================================================
import * as THREE from 'three';
import { worldRoot, makeMat, camera } from './engine.js';
import { WORLD_BOUNDS, biomeAt, gameState, isInWater, player, terrainH, worldBoxes } from './state.js';

const CHUNKS_PER_AXIS = 8; // 8x8 static frustum-culled chunks across the map
const TUFT_SPACING = 1.25; // Lush forest floor spacing

const grassChunks = [];
let sharedGrassMat = null;
let boxBuckets = null;

const windUniform = { value: 0 };
const playerPosUniform = { value: new THREE.Vector3() };
const camPosUniform = { value: new THREE.Vector3() };
const densityUniform = { value: 1.0 };

const _sampleOut = { y: 0 };

// Deterministic 32-bit integer hash -> [0, 1)
function hash2D(ix, iz, salt) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(salt, 1442695041);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Procedural PS3-style alpha-cutout grass tuft card (serrated blades + root AO gradient)
function buildPs3GrassCardTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);

  const blades = [
    { x: 7,  w: 6, topY: 24, lean: -5, shade: 0.84 },
    { x: 15, w: 7, topY: 11, lean: -3, shade: 0.95 },
    { x: 23, w: 8, topY: 4,  lean: -1, shade: 1.04 },
    { x: 32, w: 8, topY: 2,  lean: 1,  shade: 1.10 },
    { x: 41, w: 8, topY: 7,  lean: 3,  shade: 1.02 },
    { x: 49, w: 7, topY: 15, lean: 5,  shade: 0.92 },
    { x: 57, w: 6, topY: 25, lean: 6,  shade: 0.83 }
  ];

  for (let i = 0; i < blades.length; i++) {
    const b = blades[i];
    const grad = ctx.createLinearGradient(0, 64, 0, b.topY);
    const r0 = Math.round(92 * b.shade);
    const g0 = Math.round(112 * b.shade);
    const b0 = Math.round(82 * b.shade);
    const r1 = Math.min(255, Math.round(218 * b.shade));
    const g1 = Math.min(255, Math.round(238 * b.shade));
    const b1 = Math.min(255, Math.round(186 * b.shade));

    grad.addColorStop(0.0, `rgb(${r0},${g0},${b0})`);
    grad.addColorStop(0.45, `rgb(${Math.round((r0 + r1) * 0.5)},${Math.round((g0 + g1) * 0.5)},${Math.round((b0 + b1) * 0.5)})`);
    grad.addColorStop(1.0, `rgb(${r1},${g1},${b1})`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(b.x - b.w * 0.5, 64);
    ctx.quadraticCurveTo(b.x - b.w * 0.25 + b.lean * 0.4, (64 + b.topY) * 0.5, b.x + b.lean, b.topY);
    ctx.quadraticCurveTo(b.x + b.w * 0.25 + b.lean * 0.4, (64 + b.topY) * 0.5, b.x + b.w * 0.5, 64);
    ctx.closePath();
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// 3 crossed & slightly tilted quads forming a volumetric PS3 grass tuft
function createCrossedTuftGeometry() {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const planes = [
    { yaw: 0,                 tilt: 0.15, scaleW: 1.00, scaleH: 1.00 },
    { yaw: Math.PI / 3,       tilt: 0.19, scaleW: 0.95, scaleH: 0.93 },
    { yaw: (Math.PI * 2) / 3, tilt: 0.17, scaleW: 0.97, scaleH: 0.96 }
  ];

  const halfW = 0.27;
  const fullH = 0.70;

  for (let p = 0; p < planes.length; p++) {
    const { yaw, tilt, scaleW, scaleH } = planes[p];
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const w = halfW * scaleW;
    const h = fullH * scaleH;
    const leanZ = Math.sin(tilt) * h;

    const localPts = [
      [-w, 0, 0,             0, 0],
      [ w, 0, 0,             1, 0],
      [-w * 1.15, h, leanZ,  0, 1],
      [ w * 1.15, h, leanZ,  1, 1]
    ];

    const baseVert = p * 4;
    for (let v = 0; v < 4; v++) {
      const [lx, ly, lz, u, uvY] = localPts[v];
      const rx = lx * cosY + lz * sinY;
      const rz = -lx * sinY + lz * cosY;
      positions.push(rx, ly, rz);
      normals.push(sinY * 0.25, 0.92, cosY * 0.25);
      uvs.push(u, uvY);
    }

    indices.push(
      baseVert, baseVert + 1, baseVert + 2,
      baseVert + 2, baseVert + 1, baseVert + 3
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

// Spatial hash of tree trunks, rocks, and cabins so grass never pokes through forest obstacles
function buildObstacleBuckets() {
  boxBuckets = new Map();
  const bucketSize = 16;
  for (let i = 0; i < worldBoxes.length; i++) {
    const b = worldBoxes[i];
    if ((b.maxX - b.minX) > 45 || (b.maxZ - b.minZ) > 45) continue;
    const x0 = Math.floor(b.minX / bucketSize);
    const x1 = Math.floor(b.maxX / bucketSize);
    const z0 = Math.floor(b.minZ / bucketSize);
    const z1 = Math.floor(b.maxZ / bucketSize);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const key = `${cx},${cz}`;
        let list = boxBuckets.get(key);
        if (!list) {
          list = [];
          boxBuckets.set(key, list);
        }
        list.push(b);
      }
    }
  }
}

function isBlockedByObstacle(x, y, z) {
  if (!boxBuckets) return false;
  const key = `${Math.floor(x / 16)},${Math.floor(z / 16)}`;
  const list = boxBuckets.get(key);
  if (!list) return false;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (
      x >= b.minX - 0.18 && x <= b.maxX + 0.18 &&
      z >= b.minZ - 0.18 && z <= b.maxZ + 0.18 &&
      y >= b.minY - 0.30 && y <= b.maxY + 0.30
    ) {
      return true;
    }
  }
  return false;
}

function sampleForestGrassPoint(wx, wz, out) {
  if (wx <= WORLD_BOUNDS.minX + 1.5 || wx >= WORLD_BOUNDS.maxX - 1.5) return false;
  if (wz <= WORLD_BOUNDS.minZ + 1.5 || wz >= WORLD_BOUNDS.maxZ - 1.5) return false;
  if (wx >= 164) return false;
  if (biomeAt(wx, wz) !== 'woods') return false;
  if (isInWater(wx, wz)) return false;

  const y = terrainH(wx, wz);

  // Skip near-vertical cliff faces
  const slopeX = Math.abs(terrainH(wx + 0.75, wz) - terrainH(wx - 0.75, wz));
  const slopeZ = Math.abs(terrainH(wx, wz + 0.75) - terrainH(wx, wz - 0.75));
  if (slopeX > 1.15 || slopeZ > 1.15) return false;

  if (isBlockedByObstacle(wx, y, wz)) return false;

  out.y = y;
  return true;
}

function createGrassMaterial() {
  const tuftTex = buildPs3GrassCardTexture();
  const mat = makeMat(0xffffff, {
    roughness: 0.85,
    metalness: 0.0,
    flatShading: false
  });
  mat.map = tuftTex;
  mat.alphaTest = 0.42;
  mat.side = THREE.DoubleSide;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windUniform;
    shader.uniforms.uPlayerPos = playerPosUniform;
    shader.uniforms.uCamPos = camPosUniform;
    shader.uniforms.uDensity = densityUniform;

    shader.vertexShader =
      'attribute float aSeed;\n' +
      'uniform float uWindTime;\n' +
      'uniform vec3 uPlayerPos;\n' +
      'uniform vec3 uCamPos;\n' +
      'uniform float uDensity;\n' +
      'varying float vFarT;\n' +
      'varying float vCulled;\n' +
      shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vFarT = 0.0;
      vCulled = 0.0;
      #ifdef USE_INSTANCING
        vec3 instPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float distToCam = length(instPos.xz - uCamPos.xz);

        // Transition from dense individual tufts (0-24m) to wide clumped meadow clusters (24m-520m)
        float farT = smoothstep(22.0, 95.0, distToCam);
        float horizonT = smoothstep(130.0, 440.0, distToCam);
        vFarT = farT;

        // Deterministic GPU density thinning so distant tufts merge into broader clumps
        float keepProb = uDensity * mix(1.0, mix(0.45, 0.22, horizonT), farT);
        if (aSeed > keepProb) {
          vCulled = 1.0;
          transformed = vec3(0.0);
        } else {
          float clumpWidth = 1.0 + farT * 1.45 + horizonT * 1.40;
          float clumpHeight = 1.0 + farT * 0.22 - horizonT * 0.12;
          transformed.xz *= clumpWidth;
          transformed.y *= clumpHeight;

          float bend = uv.y * uv.y;

          // PS3-style layered wind wave + gust ripple
          float windFade = 1.0 - horizonT * 0.75;
          float gust = sin(instPos.x * 0.22 + instPos.z * 0.18 + uWindTime * 1.45);
          float flutter = sin(instPos.x * 0.65 - instPos.z * 0.52 + uWindTime * 3.1) * 0.35;
          float windAmt = (gust + flutter) * 0.14 * bend * windFade;
          transformed.x += windAmt;
          transformed.z += windAmt * 0.65;

          // Interactive proximity parting when player or vehicle passes through
          vec2 toTuft = instPos.xz - uPlayerPos.xz;
          float dSq = dot(toTuft, toTuft);
          if (dSq < 2.56 && abs(instPos.y - uPlayerPos.y) < 2.2) {
            float d = max(0.25, sqrt(dSq));
            float push = (1.0 - d / 1.6) * 0.36 * bend;
            transformed.xz += (toTuft / d) * push;
            transformed.y -= push * 0.25;
          }
        }
      #endif
      `
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
      #include <project_vertex>
      if (vCulled > 0.5) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }
      `
    );

    shader.fragmentShader =
      'varying float vFarT;\n' +
      shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <alphatest_fragment>',
      `
      diffuseColor.a *= (1.0 + vFarT * 0.45);
      #include <alphatest_fragment>
      if (vFarT > 0.01) {
        vec3 forestTurfCol = vec3(0.32, 0.56, 0.26);
        diffuseColor.rgb = mix(diffuseColor.rgb, forestTurfCol, vFarT * 0.32);
      }
      `
    );
  };

  return mat;
}

export function initGrass() {
  for (let i = 0; i < grassChunks.length; i++) {
    worldRoot.remove(grassChunks[i]);
    grassChunks[i].geometry.dispose();
  }
  grassChunks.length = 0;

  buildObstacleBuckets();

  const baseGeo = createCrossedTuftGeometry();
  if (!sharedGrassMat) {
    sharedGrassMat = createGrassMaterial();
  }

  const minX = Number.isFinite(WORLD_BOUNDS?.minX) ? WORLD_BOUNDS.minX : -260;
  const maxX = Number.isFinite(WORLD_BOUNDS?.maxX) ? WORLD_BOUNDS.maxX : 260;
  const minZ = Number.isFinite(WORLD_BOUNDS?.minZ) ? WORLD_BOUNDS.minZ : -260;
  const maxZ = Number.isFinite(WORLD_BOUNDS?.maxZ) ? WORLD_BOUNDS.maxZ : 260;

  const chunkW = (maxX - minX) / CHUNKS_PER_AXIS;
  const chunkD = (maxZ - minZ) / CHUNKS_PER_AXIS;

  for (let cz = 0; cz < CHUNKS_PER_AXIS; cz++) {
    const cMinZ = minZ + cz * chunkD;
    const cMaxZ = cMinZ + chunkD;

    for (let cx = 0; cx < CHUNKS_PER_AXIS; cx++) {
      const cMinX = minX + cx * chunkW;
      const cMaxX = cMinX + chunkW;

      const xStart = Math.floor(cMinX / TUFT_SPACING);
      const xEnd = Math.floor(cMaxX / TUFT_SPACING);
      const zStart = Math.floor(cMinZ / TUFT_SPACING);
      const zEnd = Math.floor(cMaxZ / TUFT_SPACING);

      const maxCells = Math.max(1, (xEnd - xStart + 1) * (zEnd - zStart + 1));
      const matrices = new Float32Array(maxCells * 16);
      const colors = new Float32Array(maxCells * 3);
      const seeds = new Float32Array(maxCells);

      let count = 0;
      let bMinX = Infinity, bMinY = Infinity, bMinZ = Infinity;
      let bMaxX = -Infinity, bMaxY = -Infinity, bMaxZ = -Infinity;

      for (let gz = zStart; gz < zEnd; gz++) {
        for (let gx = xStart; gx < xEnd; gx++) {
          const wx = (gx + hash2D(gx, gz, 1)) * TUFT_SPACING;
          const wz = (gz + hash2D(gx, gz, 2)) * TUFT_SPACING;
          if (wx < cMinX || wx >= cMaxX || wz < cMinZ || wz >= cMaxZ) continue;

          if (!sampleForestGrassPoint(wx, wz, _sampleOut)) continue;

          const rSize = hash2D(gx, gz, 3);
          const seed = hash2D(gx, gz, 4);
          const heightScale = 0.64 + rSize * 0.68;
          const widthScale = 0.92 + rSize * 0.52;
          const yaw = rSize * Math.PI * 2;
          const wy = _sampleOut.y - 0.02;

          const cos = Math.cos(yaw) * widthScale;
          const sin = Math.sin(yaw) * widthScale;
          const off = count * 16;

          matrices[off]      = cos;
          matrices[off + 1]  = 0;
          matrices[off + 2]  = -sin;
          matrices[off + 3]  = 0;
          matrices[off + 4]  = 0;
          matrices[off + 5]  = heightScale;
          matrices[off + 6]  = 0;
          matrices[off + 7]  = 0;
          matrices[off + 8]  = sin;
          matrices[off + 9]  = 0;
          matrices[off + 10] = cos;
          matrices[off + 11] = 0;
          matrices[off + 12] = wx;
          matrices[off + 13] = wy;
          matrices[off + 14] = wz;
          matrices[off + 15] = 1;

          // Rich woodland emerald & sun-dappled moss variations
          const cOff = count * 3;
          colors[cOff]     = 0.42 + rSize * 0.18;
          colors[cOff + 1] = 0.74 + rSize * 0.18;
          colors[cOff + 2] = 0.34 + rSize * 0.13;

          seeds[count] = seed;
          count++;

          if (wx < bMinX) bMinX = wx;
          if (wx > bMaxX) bMaxX = wx;
          if (wy < bMinY) bMinY = wy;
          if (wy + heightScale > bMaxY) bMaxY = wy + heightScale;
          if (wz < bMinZ) bMinZ = wz;
          if (wz > bMaxZ) bMaxZ = wz;
        }
      }

      if (count === 0) continue;

      const chunkGeo = baseGeo.clone();
      chunkGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds.subarray(0, count), 1));

      const pad = 1.6;
      chunkGeo.boundingBox = new THREE.Box3(
        new THREE.Vector3(bMinX - pad, bMinY - 0.2, bMinZ - pad),
        new THREE.Vector3(bMaxX + pad, bMaxY + 0.5, bMaxZ + pad)
      );
      chunkGeo.boundingSphere = new THREE.Sphere();
      chunkGeo.boundingBox.getBoundingSphere(chunkGeo.boundingSphere);

      const mesh = new THREE.InstancedMesh(chunkGeo, sharedGrassMat, count);
      mesh.instanceMatrix = new THREE.InstancedBufferAttribute(matrices.subarray(0, count * 16), 16);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(colors.subarray(0, count * 3), 3);
      mesh.frustumCulled = true;
      mesh.castShadow = false;
      mesh.receiveShadow = true;

      worldRoot.add(mesh);
      grassChunks.push(mesh);
    }
  }

  baseGeo.dispose();
  updateGrass(0);
  return grassChunks;
}

export function updateGrass(elapsed) {
  if (grassChunks.length === 0) return;

  windUniform.value = elapsed;
  playerPosUniform.value.set(player.x, player.y, player.z);
  if (camera) {
    camPosUniform.value.copy(camera.position);
  } else {
    camPosUniform.value.set(player.x, player.y, player.z);
  }

  const tier = gameState.settings.graphics || 'medium';
  densityUniform.value = tier === 'low' ? 0.50 : tier === 'high' ? 1.0 : 0.78;
}