// =============================================================================
// aircraft.js — Aura Air bunker, Chapin strike jet, LAX Airliner, flight, weapons and map/HUD integration.
// Standalone module: initialize once, then replace the main player simulation call
// with updateAircraft(dt, elapsed). All aircraft state is exported by API; no globals.
// =============================================================================
import * as THREE from 'three';
import { AIRFIELD, AO, addWorldBox, aura, collidesHorizontally, computeSupportFloor, flashEdge, gameState, hillsH, hooks, inputState, keys, meteorDrop, npcs, player, pushFeed, terrainH, worldBoxes } from './state.js';
import { camera, canvas, scene, worldRoot } from './engine.js';
import { sfx } from './audio.js';
import { spawnParticles } from './items.js';
import { createNeonSign } from './world.js';
import { damageNpc, hurtCop } from './npcs.js';
import { enhancePerFrame, fpRoot, stepSimulation } from './player.js';

export { AIRFIELD };
const GEAR = 1.6, STALL = 22, ROTATE = 28, MAX_SPEED = 140, AFTERBURNER_SPEED = 210;
const BOEING_GEAR = 2.6;
const LAX_AIRPORT = { x: 336, z: 465, yaw: 0, minX: 180, maxX: 468, minZ: 435, maxZ: 695 };
const AIRSPACE = { minX: -720, maxX: 680, minZ: -720, maxZ: 1080, centerX: 40, centerZ: 180, ceiling: 850 };
const Z_FORWARD = new THREE.Vector3(0, 0, 1), X_LEFT = new THREE.Vector3(1, 0, 0), Y_UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const AIRCRAFT_SPECS = {
  jet: {
    id: 'jet',
    name: 'STRIKE JET',
    gearHeight: GEAR,
    stallSpeed: STALL,
    rotateSpeed: ROTATE,
    maxSpeed: MAX_SPEED,
    afterburnerSpeed: AFTERBURNER_SPEED,
    absMaxSpeed: 260,
    accelRate: 36,
    abAccelRate: 58,
    stallPitchDrop: 0.45,
    stallSinkRate: 11,
    pitchAuthority: 1.1,
    rollAuthority: 1.85,
    yawAuthority: 0.8,
    camDist: 15,
    camHeight: 5.0,
    cockpitOffset: [0, 1.2, 2.4],
    halfSpan: 2.5,
    halfHeight: 1.3,
    boardRadius: 7,
    hasWeapons: true,
    boostLabel: 'AB'
  },
  boeing: {
    id: 'boeing',
    name: 'BOEING AIRLINER',
    gearHeight: BOEING_GEAR,
    stallSpeed: 11,          // Harder to stall (~40 km/h vs jet's ~79 km/h)
    rotateSpeed: 22,         // Smooth rotation at ~79 km/h
    maxSpeed: 92,            // Slower cruise (~331 km/h vs jet's ~504 km/h)
    afterburnerSpeed: 122,   // TOGA / boost max (~439 km/h)
    absMaxSpeed: 145,
    accelRate: 24,
    abAccelRate: 36,
    stallPitchDrop: 0.14,    // Gentle nose drop near stall
    stallSinkRate: 4.2,      // Low sink rate near stall
    pitchAuthority: 0.85,
    rollAuthority: 1.3,
    yawAuthority: 0.65,
    camDist: 25,
    camHeight: 7.5,
    cockpitOffset: [0, 2.05, 9.6],
    halfSpan: 5.2,
    halfHeight: 2.2,
    boardRadius: 10.5,
    hasWeapons: false,
    boostLabel: 'TOGA'
  }
};

// Reusable scratch math objects to prevent per-frame GC allocations
const _vForward = new THREE.Vector3();
const _vLeft = new THREE.Vector3();
const _vUp = new THREE.Vector3();
const _vCamPos = new THREE.Vector3();
const _vCamFwd = new THREE.Vector3();
const _vCamUp = new THREE.Vector3();
const _vCamOffset = new THREE.Vector3();
const _vHudFwd = new THREE.Vector3();
const _vMapFwd = new THREE.Vector3();
const _vBombMove = new THREE.Vector3();
const _vBombDir = new THREE.Vector3();
const _vBombImpact = new THREE.Vector3();
const _vOrigin = new THREE.Vector3();
const _vDir = new THREE.Vector3();
const _vStart = new THREE.Vector3();
const _vEnd = new THREE.Vector3();
const _vCrashOffset = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _e0 = new THREE.Euler();

let initialized = false;
let bunker = null;
let jet = null;
let boeing = null;
let activeAircraft = null;
const aircraftFleet = [];
let flameTextures = [];
let flameAspect = 2.05;
let lastFlameSwap = -1;
let chute = null;
let chuteActive = false;
let netSyncTimer = 0;

// Cached HUD & UI DOM references
const hudEls = {};
const hudCache = {
  spd: '', alt: '', agl: '', hdg: '',
  thr: '', ab: -1, abText: '', hull: '', nuke: '', nukeVis: true,
  warn: '', warnOp: -1, help: false
};

// Shared explosion & debris resources
let sharedExplosionGeo = null;
let debrisMats = null;

// Pooled cannon tracers
const TRACER_POOL_SIZE = 10;
const tracerPool = [];
let tracerCursor = 0;
let tracerMat = null;

// Load metallic scratch texture overlay
const textureLoader = new THREE.TextureLoader();
const metalScratchTex = textureLoader.load('assets/textures/metal.png');
metalScratchTex.wrapS = THREE.RepeatWrapping;
metalScratchTex.wrapT = THREE.RepeatWrapping;
metalScratchTex.repeat.set(4, 4);

// Jet Shoot Sound handling with Web Audio API & pooled HTML5 Audio fallback
let jetShootBuffer = null;
let jetShootAudioRaw = null;
let isDecodingJetShoot = false;
const fallbackShootPool = [];
let fallbackShootIdx = 0;

function loadJetShootSFX() {
  if (typeof window === 'undefined') return;
  for (let i = 0; i < 4; i++) {
    const a = new Audio('assets/audio/jetshoot.mp3');
    a.preload = 'auto';
    fallbackShootPool.push(a);
  }
  fetch('assets/audio/jetshoot.mp3')
    .then(res => res.arrayBuffer())
    .then(arrayBuf => {
      jetShootAudioRaw = arrayBuf;
      if (sfx.ctx && sfx.ctx.state !== 'closed' && !isDecodingJetShoot) {
        isDecodingJetShoot = true;
        return sfx.ctx.decodeAudioData(arrayBuf.slice(0));
      }
      return null;
    })
    .then(buf => {
      if (buf) jetShootBuffer = buf;
    })
    .catch(() => {})
    .finally(() => { isDecodingJetShoot = false; });
}
loadJetShootSFX();

function playJetShootSound() {
  if (!sfx.enabled) return;
  const pitchShift = 0.93 + Math.random() * 0.14;

  if (sfx.ctx && !jetShootBuffer && jetShootAudioRaw && !isDecodingJetShoot) {
    isDecodingJetShoot = true;
    sfx.ctx.decodeAudioData(jetShootAudioRaw.slice(0))
      .then(buf => { jetShootBuffer = buf; })
      .catch(() => {})
      .finally(() => { isDecodingJetShoot = false; });
  }

  if (sfx.ctx && jetShootBuffer) {
    try {
      const src = sfx.ctx.createBufferSource();
      src.buffer = jetShootBuffer;
      src.playbackRate.value = pitchShift;
      const gain = sfx.ctx.createGain();
      gain.gain.value = 0.35;
      src.connect(gain);
      gain.connect(sfx.ctx.destination);
      src.start(0);
      return;
    } catch (_) {}
  }

  if (fallbackShootPool.length) {
    try {
      const audio = fallbackShootPool[fallbackShootIdx];
      fallbackShootIdx = (fallbackShootIdx + 1) % fallbackShootPool.length;
      audio.currentTime = 0;
      audio.playbackRate = pitchShift;
      audio.volume = 0.35;
      audio.play().catch(() => {});
      return;
    } catch (_) {}
  }

  sfx.tone(170 + Math.random() * 50, 70, 0.07, 'square', 0.045);
}

const jetState = {
  type: 'jet',
  specs: AIRCRAFT_SPECS.jet,
  flying: false, pos: new THREE.Vector3(-384, AIRFIELD.y + GEAR, AIRFIELD.rz),
  q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)),
  speed: 0, throttle: 0, afterburner: false, sink: 0, ground: true, gp: 0,
  hull: 100, nukes: 4, sx: 0, sy: 0, pitchRate: 0, rollRate: 0, yawRate: 0,
  inverted: false, cameraMode: 0, cameraQ: new THREE.Quaternion(), gunTimer: 0,
  nukeCooldown: 0, muzzle: 0, help: 0, dead: 0, warningTimer: 0, tipShown: false,
  warning: '', agl: 0, verticalSpeed: 0, au: null,
  crashCamTimer: 0, crashPos: new THREE.Vector3()
};
const keysJet = {};
const bombs = [];
const effects = [];
const debris = [];
const beaconMeshes = [];

const isUiBlocked = () => !!(gameState.inventoryOpen || gameState.mapOpen || gameState.settingsOpen);

function groundHeight(x, z) {
  if (x < -196 && x > -560 && z > -172 && z < 172) return hillsH(x, z);
  if (z < -170 && z > -590 && x > -138 && x < 370) return Math.max(0.18, terrainH(x, z));
  if (x >= 368 && x <= 533 && z >= -180 && z <= 240) return 1.5;
  if (z > 208 && z < 380 && x >= -260 && x <= 500) return 0.20;
  if (x >= -250 && x <= 490 && z >= 380 && z <= 930) {
    if (x >= 180 && x <= 468 && z >= 435 && z <= 695) return 0.24;
    return 0.18;
  }
  return x >= 164 ? 0.02 : 0.18;
}

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.85 }, options));
}

function basic(color, options = {}) {
  return new THREE.MeshBasicMaterial(Object.assign({ color }, options));
}

function box(parent, mat, x, y, z, w, h, d) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function addInstancedBoxes(parent, mat, items) {
  if (!items.length) return null;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const inst = new THREE.InstancedMesh(geo, mat, items.length);
  inst.frustumCulled = false;
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const q = new THREE.Quaternion();
  for (let i = 0; i < items.length; i++) {
    const [x, y, z, w, h, d] = items[i];
    pos.set(x, y, z);
    scale.set(w, h, d);
    m.compose(pos, q, scale);
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  parent.add(inst);
  return inst;
}

function solid(x0, x1, y0, y1, z0, z1) {
  return addWorldBox(x0, x1, y0, y1, z0, z1, 'solid', false);
}

function createFallbackFlameTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(64, 210, 8, 64, 150, 120);
  grad.addColorStop(0, 'rgba(255, 252, 210, 1)');
  grad.addColorStop(0.35, 'rgba(255, 165, 35, 0.9)');
  grad.addColorStop(0.75, 'rgba(235, 65, 15, 0.45)');
  grad.addColorStop(1, 'rgba(180, 20, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 256);
  const tex = new THREE.CanvasTexture(c);
  if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function initFlameTextures() {
  if (flameTextures.length) return;
  flameTextures = [createFallbackFlameTexture()];

  const img = new Image();
  img.onload = () => {
    const w = img.naturalWidth || img.width || 256;
    const h = img.naturalHeight || img.height || 512;
    flameAspect = h / Math.max(1, w);

    const buildVariant = drawFn => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      drawFn(ctx, w, h);
      const tex = new THREE.CanvasTexture(c);
      if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      return tex;
    };

    const variantDrawers = [
      (ctx, cw, ch) => { ctx.drawImage(img, 0, 0, cw, ch); },
      (ctx, cw, ch) => {
        ctx.save();
        ctx.translate(cw, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0, cw, ch);
        ctx.restore();
      },
      (ctx, cw, ch) => {
        const slices = 32, sh = ch / slices;
        for (let i = 0; i < slices; i++) {
          const sy = i * sh, tipFactor = 1 - i / slices;
          const shift = Math.sin(tipFactor * Math.PI * 2.6) * cw * 0.065 * tipFactor;
          ctx.drawImage(img, 0, sy, cw, sh + 1, shift, sy, cw, sh + 1);
        }
      },
      (ctx, cw, ch) => {
        const slices = 32, sh = ch / slices;
        for (let i = 0; i < slices; i++) {
          const sy = i * sh, tipFactor = 1 - i / slices;
          const shift = Math.cos(tipFactor * Math.PI * 2.4) * cw * 0.07 * tipFactor;
          ctx.save();
          ctx.translate(cw + shift, sy);
          ctx.scale(-1, 1);
          ctx.drawImage(img, 0, sy, cw, sh + 1, 0, 0, cw, sh + 1);
          ctx.restore();
        }
      },
      (ctx, cw, ch) => {
        const inset = cw * 0.07;
        ctx.drawImage(img, inset, 0, cw - inset * 2, ch);
      }
    ];

    const oldTextures = flameTextures;
    flameTextures = variantDrawers.map(buildVariant);
    for (const ac of aircraftFleet) {
      const blades = ac.mesh?.userData?.flameBlades || [];
      for (let i = 0; i < blades.length; i++) {
        const blade = blades[i];
        blade.texIdx = i % flameTextures.length;
        blade.mat.map = flameTextures[blade.texIdx];
        blade.mat.needsUpdate = true;
      }
    }
    oldTextures.forEach(t => t.dispose());
  };
  img.src = 'assets/textures/flame.png';
}

function buildBunker() {
  bunker = new THREE.Group();
  scene.add(bunker);
  const fy = AIRFIELD.y, rz = AIRFIELD.rz;
  const concrete = material(0x9a9da3, { roughness: 0.96 });
  const concreteDark = material(0x6a6d74, { roughness: 0.96 });
  const asphalt = material(0x2a2d32, { roughness: 0.93 });
  const paint = material(0xf3f4f6), yellow = material(0xf5c518);
  const floor = material(0x70757c, { roughness: 0.75 });
  const earth = material(0x587a3a, { roughness: 1 });
  const lamp = basic(0xfff4c8), red = basic(0xff2a2a);
  const rock = material(0x76705f, { roughness: 1, flatShading: true });

  box(bunker, asphalt, -281.5, fy + 0.15, rz, 147, 0.1, 24);
  box(bunker, asphalt, -349.5, fy + 0.15, rz, 14, 0.1, 40);
  box(bunker, floor, -382, fy + 0.15, rz, 48, 0.1, 38);

  const paintBoxes = [];
  const lampBoxes = [];
  for (let x = -342; x < -215; x += 14) paintBoxes.push([x, fy + 0.21, rz, 7, 0.02, 0.5]);
  for (const s of [-1, 1]) {
    paintBoxes.push([-281.5, fy + 0.21, rz + s * 11, 147, 0.02, 0.35]);
    for (let x = -345; x < -208; x += 18) lampBoxes.push([x, fy + 0.3, rz + s * 12.3, 0.4, 0.25, 0.4]);
  }
  for (let k = -4; k <= 4; k++) if (k) paintBoxes.push([-211, fy + 0.21, rz + k * 2.4 - Math.sign(k) * 1.2, 10, 0.02, 1.1]);
  addInstancedBoxes(bunker, paint, paintBoxes);

  addInstancedBoxes(bunker, yellow, [
    [-361, fy + 0.21, rz, 10, 0.02, 0.4],
    [-384, fy + 0.2, rz, 22, 0.02, 0.3],
    [-384, fy + 0.2, rz - 8, 22, 0.02, 0.3],
    [-384, fy + 0.2, rz + 8, 22, 0.02, 0.3]
  ]);

  const hx0 = AIRFIELD.hangerX0, hx1 = AIRFIELD.hangerX1, hz0 = AIRFIELD.hangerZ0, hz1 = AIRFIELD.hangerZ1;
  const wall = (x0, x1, z0, z1, y0, y1, mat = concrete) => {
    box(bunker, mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0);
    solid(x0, x1, y0, y1, z0, z1);
  };
  wall(hx0, hx1, hz0, hz0 + 2, fy, fy + 13);
  wall(hx0, hx1, hz1 - 2, hz1, fy, fy + 13);
  wall(hx1 - 2, hx1, hz0, -119, fy, fy + 13, concreteDark);
  wall(hx1 - 2, hx1, -93, hz1, fy, fy + 13, concreteDark);
  wall(hx0, hx0 + 2, hz0, hz1, fy, fy + 13, concreteDark);
  wall(hx0, hx1, hz0, hz1, fy + 11, fy + 12.6);
  box(bunker, earth, -382, fy + 13.1, rz, 46, 1, 40);

  // Batch bunker rocks into instanced meshes
  const hiRocks = [];
  for (let i = 0; i < 12; i++) {
    const z = hz0 + 2 + i * (hz1 - hz0 - 4) / 11;
    const rad = 2.8 + (i % 3) * 0.55;
    hiRocks.push([-365 + (i % 2) * 7, fy + 11.5 + (i % 3) * 1.1, z, 1.3 * rad, 1.15 * rad, 1.05 * rad]);
  }
  for (const z of [-126, -121.5, -116.5, -95.5, -90.5, -86]) {
    const rad = 2.9;
    hiRocks.push([hx0 - 1.2, fy + (z < -116 || z > -96 ? 11.5 : 9.5), z, 1.2 * rad, 1.15 * rad, 1.15 * rad]);
  }
  for (let i = 0; i < 7; i++) {
    const rad = 2.2 + (i % 2) * 0.7;
    hiRocks.push([hx0 - 5 - (i % 3), fy + 13.4, -123 + i * 6.2, 1.35 * rad, 0.72 * rad, 1.25 * rad]);
  }
  const hiRockInst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), rock, hiRocks.length);
  hiRockInst.frustumCulled = false;
  const rm = new THREE.Matrix4(), rPos = new THREE.Vector3(), rScale = new THREE.Vector3(), rQuat = new THREE.Quaternion();
  for (let i = 0; i < hiRocks.length; i++) {
    const [x, y, z, sx, sy, sz] = hiRocks[i];
    rPos.set(x, y, z); rScale.set(sx, sy, sz);
    rm.compose(rPos, rQuat, rScale);
    hiRockInst.setMatrixAt(i, rm);
  }
  hiRockInst.instanceMatrix.needsUpdate = true;
  bunker.add(hiRockInst);

  const loRockInst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), rock, 9);
  loRockInst.frustumCulled = false;
  for (let i = 0; i < 9; i++) {
    const rad = 1.2 + (i % 3) * 0.7;
    rPos.set(-402 + i * 5.5, fy + 13.6, i % 2 ? -124 : -88);
    rScale.set(rad, 0.6 * rad, rad);
    rm.compose(rPos, rQuat, rScale);
    loRockInst.setMatrixAt(i, rm);
  }
  loRockInst.instanceMatrix.needsUpdate = true;
  bunker.add(loRockInst);

  const sign = new THREE.Group(); sign.position.set(hx1 + 0.15, fy + 12, rz); sign.rotation.y = Math.PI / 2;
  createNeonSign(sign, 'AURA AIR BUNKER', 0, 0, 0, '#111827', '#fcd34d', 16, 1.8); bunker.add(sign);
  beaconMeshes.push(box(bunker, red, hx1 + 0.4, fy + 10.4, -119.6, 0.5, 0.5, 0.5), box(bunker, red, hx1 + 0.4, fy + 10.4, -92.4, 0.5, 0.5, 0.5));
  for (const z of [-116, -106, -96]) lampBoxes.push([-382, fy + 10.8, z, 44, 0.15, 0.7]);
  addInstancedBoxes(bunker, lamp, lampBoxes);

  const hl1 = new THREE.PointLight(0xfff0d0, 320, 70, 2); hl1.position.set(-382, fy + 9, rz); bunker.add(hl1);
  const hl2 = new THREE.PointLight(0xfff0d0, 150, 50, 2); hl2.position.set(-365, fy + 8, rz); bunker.add(hl2);

  for (const [x, z, s] of [[-362, -122, 4], [-362, -117, 3], [-362, -91, 4]]) {
    box(bunker, material(0x6b4a2f), x, fy + s / 2 + 0.1, z, s, s, s);
    solid(x - s / 2, x + s / 2, fy, fy + s, z - s / 2, z + s / 2);
  }
  const drumGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.2, 10);
  const drumMats = [material(0xa23b2a), material(0x2f5d8c)];
  for (let i = 0; i < 5; i++) {
    const drum = new THREE.Mesh(drumGeo, drumMats[i % 2]);
    drum.position.set(-400 + i * 1.3, fy + 0.7, -124.5); bunker.add(drum);
  }
  return bunker;
}

function planform(points, depth) {
  return (side) => {
    const shape = new THREE.Shape(); points.forEach((p, i) => i ? shape.lineTo(side * p[0], p[1]) : shape.moveTo(side * p[0], p[1])); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }); geo.rotateX(Math.PI / 2); geo.translate(0, depth / 2, 0); return geo;
  };
}

function attachFlameBlades(parent, x, y, z, scale = 1, sideOffset = 0, bladesList) {
  const flameGeo = new THREE.PlaneGeometry(1, 1);
  flameGeo.translate(0, 0.5, 0);

  const starConfig = [
    { angle: 0, width: 1.18 * scale, lengthMult: 1.0 * scale, minOp: 0.42, maxOp: 0.78, tint: 0xffffff },
    { angle: Math.PI / 4, width: 1.18 * scale, lengthMult: 0.98 * scale, minOp: 0.42, maxOp: 0.78, tint: 0xffe6cc },
    { angle: Math.PI / 2, width: 1.18 * scale, lengthMult: 1.0 * scale, minOp: 0.42, maxOp: 0.78, tint: 0xffffff },
    { angle: (3 * Math.PI) / 4, width: 1.18 * scale, lengthMult: 0.98 * scale, minOp: 0.42, maxOp: 0.78, tint: 0xffe6cc },
    { angle: Math.PI / 8, width: 0.78 * scale, lengthMult: 0.78 * scale, minOp: 0.62, maxOp: 0.96, tint: 0xfff6d6 },
    { angle: (5 * Math.PI) / 8, width: 0.78 * scale, lengthMult: 0.78 * scale, minOp: 0.62, maxOp: 0.96, tint: 0xfff6d6 }
  ];

  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  pivot.rotation.x = -Math.PI / 2;
  parent.add(pivot);

  for (let k = 0; k < starConfig.length; k++) {
    const cfg = starConfig[k];
    const texIdx = (k + sideOffset) % flameTextures.length;
    const mat = new THREE.MeshBasicMaterial({
      map: flameTextures[texIdx],
      color: cfg.tint,
      transparent: true,
      opacity: cfg.maxOp,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(flameGeo, mat);
    mesh.rotation.y = cfg.angle;
    mesh.renderOrder = 2;
    pivot.add(mesh);
    bladesList.push({
      mesh,
      mat,
      baseWidth: cfg.width,
      lengthMult: cfg.lengthMult,
      minOp: cfg.minOp,
      maxOp: cfg.maxOp,
      baseOpacity: (cfg.minOp + cfg.maxOp) * 0.5,
      flip: k % 2 ? -1 : 1,
      texIdx
    });
  }
}

function buildJet() {
  initFlameTextures();
  jet = new THREE.Group();
  const bladesList = [];

  // Materials enhanced with the metallic scratch texture overlay
  const body = material(0x6f7985, { metalness: 0.8, roughness: 0.3, roughnessMap: metalScratchTex, metalnessMap: metalScratchTex });
  const dark = material(0x2b3038, { metalness: 0.85, roughness: 0.25, roughnessMap: metalScratchTex, metalnessMap: metalScratchTex });
  const red = material(0xd92b2b, { metalness: 0.6, roughness: 0.35, roughnessMap: metalScratchTex, metalnessMap: metalScratchTex });
  const canopy = material(0x0d2236, { metalness: 0.9, roughness: 0.08, emissive: 0x07121d });
  const double = material(0x59616c, { metalness: 0.75, roughness: 0.35, side: THREE.DoubleSide, roughnessMap: metalScratchTex, metalnessMap: metalScratchTex });

  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.3, 11, 14), body); fuselage.rotation.x = Math.PI / 2; fuselage.position.z = -0.8; fuselage.scale.z = 0.82; jet.add(fuselage);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.95, 5.4, 14), body); nose.rotation.x = Math.PI / 2; nose.position.z = 7.4; nose.scale.z = 0.82; jet.add(nose);
  const can = new THREE.Mesh(new THREE.SphereGeometry(0.8, 14, 10), canopy); can.position.set(0, 0.78, 3.2); can.scale.set(0.78, 0.62, 2.3); jet.add(can); jet.userData.can = can;
  for (const s of [-1, 1]) box(jet, dark, s * 1.25, -0.05, 1.2, 0.85, 0.95, 3.4);
  box(jet, body, 0, 0.85, -2.6, 0.7, 0.35, 6);
  const wingShape = planform([[0.9, 3.6], [6, -2.4], [6, -4], [0.9, -5.2]], 0.2);
  const tailShape = planform([[0.9, -4.4], [3.6, -6], [3.6, -7], [0.9, -7]], 0.14);

  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(wingShape(s), double); wing.position.y = -0.15; jet.add(wing);
    jet.add(new THREE.Mesh(tailShape(s), double));
    const finShape = new THREE.Shape(); finShape.moveTo(0, 0); finShape.lineTo(1.5, 2.8); finShape.lineTo(3.1, 2.8); finShape.lineTo(3.1, 0); finShape.closePath();
    const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.14, bevelEnabled: false }); finGeo.rotateY(Math.PI / 2);
    const fin = new THREE.Mesh(finGeo, red); fin.position.set(s * 1.2, 0.55, -3.9); fin.rotation.z = -s * 0.32; jet.add(fin);
    const missile = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 3.2, 8), material(0xe5e7eb)); missile.rotation.x = Math.PI / 2; missile.position.set(s * 6.15, -0.1, -2.6); jet.add(missile);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.5, 1.8, 12), dark); nozzle.rotation.x = Math.PI / 2; nozzle.position.set(s * 0.72, -0.05, -6.5); jet.add(nozzle);

    attachFlameBlades(jet, s * 0.72, -0.05, -7.32, 1.0, s > 0 ? 2 : 0, bladesList);
  }
  const gear = new THREE.Group(); jet.add(gear); jet.userData.gear = gear;
  for (const [x, z, r] of [[0, 4.6, 0.32], [1.6, -1.4, 0.4], [-1.6, -1.4, 0.4]]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 6), dark); strut.position.set(x, -0.7, z); gear.add(strut);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.26, 12), material(0x15171a)); wheel.rotation.z = Math.PI / 2; wheel.position.set(x, -1.6 + r, z); gear.add(wheel);
  }
  const bombMount = new THREE.Group(); bombMount.position.set(0, -1.05, 0.6); jet.add(bombMount); jet.userData.bomb = bombMount;
  const ol = material(0x3a4234, { metalness: 0.4, roughness: 0.5 });
  const bomb = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 2.6, 12), ol); bomb.rotation.x = Math.PI / 2; bombMount.add(bomb);
  const bombCone = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1, 12), ol); bombCone.rotation.x = Math.PI / 2; bombCone.position.z = 1.8; bombMount.add(bombCone);
  const muzzleMat = basic(0xffd24a, { transparent: true, opacity: 0.9 });
  jet.userData.muzzle = [];
  for (const x of [-1.15, 1.15]) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), muzzleMat); m.position.set(x, -0.15, 2.9); m.visible = false; jet.add(m); jet.userData.muzzle.push(m); }
  jet.userData.flameBlades = bladesList;
  scene.add(jet);
}

function buildBoeing() {
  initFlameTextures();
  boeing = new THREE.Group();
  const bladesList = [];

  const white = material(0xf4f6f9, { metalness: 0.35, roughness: 0.32, roughnessMap: metalScratchTex, metalnessMap: metalScratchTex });
  const silver = material(0xcbd5e1, { metalness: 0.7, roughness: 0.28, roughnessMap: metalScratchTex, metalnessMap: metalScratchTex });
  const wingMat = material(0xd8dee6, { metalness: 0.55, roughness: 0.38, side: THREE.DoubleSide, roughnessMap: metalScratchTex, metalnessMap: metalScratchTex });
  const liveryBlue = material(0x1d4ed8, { metalness: 0.45, roughness: 0.35 });
  const liverySky = material(0x38bdf8, { metalness: 0.45, roughness: 0.35 });
  const darkMetal = material(0x272c34, { metalness: 0.85, roughness: 0.25 });
  const glass = material(0x0b192c, { metalness: 0.92, roughness: 0.08, emissive: 0x06101e });
  const tireMat = material(0x15171a, { roughness: 0.9 });

  // Main cylindrical fuselage
  const cabin = new THREE.Mesh(new THREE.CylinderGeometry(1.85, 1.85, 18.5, 20), white);
  cabin.rotation.x = Math.PI / 2;
  cabin.position.set(0, 0.25, 0.2);
  boeing.add(cabin);

  // Belly fairing / lower hull accent
  const belly = new THREE.Mesh(new THREE.CylinderGeometry(1.86, 1.86, 18.2, 20, 1, false, Math.PI * 0.65, Math.PI * 0.7), silver);
  belly.rotation.x = Math.PI / 2;
  belly.position.set(0, 0.24, 0.2);
  boeing.add(belly);

  // Airline cheatline stripes
  const stripeMain = new THREE.Mesh(new THREE.CylinderGeometry(1.87, 1.87, 18.4, 20, 1, true), liveryBlue);
  stripeMain.rotation.x = Math.PI / 2;
  stripeMain.scale.set(1, 1, 0.016);
  stripeMain.position.set(0, 0.12, 0.2);
  boeing.add(stripeMain);

  const stripeAccent = new THREE.Mesh(new THREE.CylinderGeometry(1.872, 1.872, 18.4, 20, 1, true), liverySky);
  stripeAccent.rotation.x = Math.PI / 2;
  stripeAccent.scale.set(1, 1, 0.008);
  stripeAccent.position.set(0, -0.04, 0.2);
  boeing.add(stripeAccent);

  // Forward nose section & radome
  const forwardNose = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.85, 4.0, 20), white);
  forwardNose.rotation.x = Math.PI / 2;
  forwardNose.position.set(0, 0.12, 11.45);
  boeing.add(forwardNose);

  const radome = new THREE.Mesh(new THREE.SphereGeometry(1.12, 18, 14), white);
  radome.scale.set(1.0, 0.92, 1.75);
  radome.position.set(0, 0.05, 13.35);
  boeing.add(radome);

  // Cockpit windshield (hidden in 1st-person cockpit view)
  const cockpitGlass = new THREE.Mesh(new THREE.SphereGeometry(1.26, 16, 12), glass);
  cockpitGlass.scale.set(0.96, 0.56, 1.15);
  cockpitGlass.position.set(0, 0.88, 11.4);
  boeing.add(cockpitGlass);
  boeing.userData.can = cockpitGlass;

  // Aft tapered tail cone
  const tailCone = new THREE.Mesh(new THREE.CylinderGeometry(1.85, 0.48, 7.2, 20), white);
  tailCone.rotation.x = Math.PI / 2;
  tailCone.position.set(0, 0.42, -12.65);
  boeing.add(tailCone);

  // Instanced passenger cabin windows along both sides
  const winItems = [];
  for (let i = 0; i < 18; i++) {
    const wz = -7.6 + i * 0.92;
    winItems.push([-1.81, 0.58, wz, 0.12, 0.26, 0.22]);
    winItems.push([1.81, 0.58, wz, 0.12, 0.26, 0.22]);
  }
  addInstancedBoxes(boeing, glass, winItems);

  // Swept airliner wings + winglets + twin high-bypass turbofan engines
  const mainWingShape = planform([[1.4, 3.8], [13.6, -3.4], [13.6, -5.2], [1.4, -3.5]], 0.28);
  const hStabShape = planform([[0.35, -11.8], [5.2, -14.5], [5.2, -15.6], [0.35, -15.0]], 0.18);

  const nacGeo = new THREE.CylinderGeometry(0.88, 0.8, 3.4, 18);
  const fanGeo = new THREE.CylinderGeometry(0.78, 0.78, 0.12, 16);
  const spinGeo = new THREE.ConeGeometry(0.22, 0.52, 12);
  const exhGeo = new THREE.CylinderGeometry(0.58, 0.72, 0.85, 16);

  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(mainWingShape(s), wingMat);
    wing.position.set(0, -0.42, 0);
    boeing.add(wing);

    // Blended upturned winglet
    const winglet = box(boeing, liveryBlue, s * 13.55, 0.42, -4.35, 0.16, 1.75, 1.35);
    winglet.rotation.z = -s * 0.26;

    // Horizontal stabilizer
    const hStab = new THREE.Mesh(hStabShape(s), wingMat);
    hStab.position.set(0, 0.55, 0);
    boeing.add(hStab);

    // Under-wing engine pylon & high-bypass turbofan pod
    const ex = s * 5.35, ey = -1.42, ez = 1.25;
    box(boeing, silver, ex, -0.82, ez + 0.3, 0.34, 0.95, 2.7);

    const nacelle = new THREE.Mesh(nacGeo, white);
    nacelle.rotation.x = Math.PI / 2;
    nacelle.position.set(ex, ey, ez);
    boeing.add(nacelle);

    const intakeRing = new THREE.Mesh(new THREE.TorusGeometry(0.84, 0.08, 10, 20), silver);
    intakeRing.position.set(ex, ey, ez + 1.7);
    boeing.add(intakeRing);

    const fanDisk = new THREE.Mesh(fanGeo, darkMetal);
    fanDisk.rotation.x = Math.PI / 2;
    fanDisk.position.set(ex, ey, ez + 1.55);
    boeing.add(fanDisk);

    const spinner = new THREE.Mesh(spinGeo, silver);
    spinner.rotation.x = Math.PI / 2;
    spinner.position.set(ex, ey, ez + 1.75);
    boeing.add(spinner);

    const exhaust = new THREE.Mesh(exhGeo, darkMetal);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(ex, ey, ez - 1.95);
    boeing.add(exhaust);

    // Subtle exhaust flame shimmer on turbofan engines
    attachFlameBlades(boeing, ex, ey, ez - 2.38, 0.55, s > 0 ? 2 : 0, bladesList);
  }

  // Tall Boeing swept vertical stabilizer (tail fin)
  const vFinShape = new THREE.Shape();
  vFinShape.moveTo(0, 0);
  vFinShape.lineTo(3.4, 5.4);
  vFinShape.lineTo(5.6, 5.4);
  vFinShape.lineTo(5.1, 0);
  vFinShape.closePath();
  const vFinGeo = new THREE.ExtrudeGeometry(vFinShape, { depth: 0.24, bevelEnabled: false });
  vFinGeo.rotateY(Math.PI / 2);
  const vFin = new THREE.Mesh(vFinGeo, liveryBlue);
  vFin.position.set(-0.12, 1.35, -10.4);
  boeing.add(vFin);

  // Navigation lights (port red, starboard green, tail white)
  box(boeing, basic(0xff2a2a), -13.6, -0.25, -4.1, 0.25, 0.25, 0.35);
  box(boeing, basic(0x22c55e), 13.6, -0.25, -4.1, 0.25, 0.25, 0.35);
  box(boeing, basic(0xffffff), 0, 0.55, -16.25, 0.25, 0.25, 0.3);

  // Retractable tricycle landing gear (height = BOEING_GEAR = 2.6)
  const gear = new THREE.Group();
  boeing.add(gear);
  boeing.userData.gear = gear;

  // Nose landing gear (twin wheels)
  const noseStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.8, 8), silver);
  noseStrut.position.set(0, -1.45, 10.6);
  gear.add(noseStrut);
  for (const wx of [-0.24, 0.24]) {
    const nw = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.22, 14), tireMat);
    nw.rotation.z = Math.PI / 2;
    nw.position.set(wx, -BOEING_GEAR + 0.42, 10.6);
    gear.add(nw);
  }

  // Main landing gear bogies (dual wheels per side)
  for (const s of [-1, 1]) {
    const mx = s * 2.85, mz = -1.1;
    const mainStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.9, 8), silver);
    mainStrut.position.set(mx, -1.35, mz);
    gear.add(mainStrut);
    for (const wx of [-0.3, 0.3]) {
      const mw = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.54, 0.28, 14), tireMat);
      mw.rotation.z = Math.PI / 2;
      mw.position.set(mx + wx, -BOEING_GEAR + 0.54, mz);
      gear.add(mw);
    }
  }

  boeing.userData.bomb = null;
  boeing.userData.muzzle = [];
  boeing.userData.flameBlades = bladesList;
  scene.add(boeing);
}

function updateAircraftFlame(ac, throttle, afterburner, active, elapsed) {
  const blades = ac?.mesh?.userData?.flameBlades;
  if (!blades || !blades.length) return;
  const t = clamp(throttle || 0, 0, 1);

  const shouldSwap = elapsed < lastFlameSwap || elapsed - lastFlameSwap >= 0.04;
  if (shouldSwap) {
    lastFlameSwap = elapsed;
    const count = flameTextures.length;
    for (const fleetAc of aircraftFleet) {
      const acBlades = fleetAc.mesh?.userData?.flameBlades || [];
      for (let i = 0; i < acBlades.length; i++) {
        const blade = acBlades[i];
        if (count > 1) {
          let nextIdx = Math.floor(Math.random() * count);
          if (nextIdx === blade.texIdx) nextIdx = (nextIdx + 1) % count;
          blade.texIdx = nextIdx;
          blade.mat.map = flameTextures[nextIdx];
        }
        blade.flip = Math.random() < 0.5 ? -1 : 1;
        blade.baseOpacity = blade.minOp + Math.random() * (blade.maxOp - blade.minOp);
      }
    }
  }

  const stretch = active
    ? (0.22 + t * 0.78 + (afterburner ? 0.34 : 0))
    : 0.04;

  const throttleAlpha = active ? (0.45 + t * 0.55) : 0.2;

  for (let i = 0; i < blades.length; i++) {
    const blade = blades[i];
    const wJitter = active ? (0.94 + Math.random() * 0.12) : 0.65;
    const hJitter = active ? (0.93 + Math.random() * 0.14) : 1.0;
    const width = blade.baseWidth * wJitter;
    const naturalHeight = blade.baseWidth * flameAspect;
    const height = Math.max(0.05, naturalHeight * stretch * blade.lengthMult * hJitter);

    blade.mesh.scale.set(width * blade.flip, height, 1);
    blade.mat.opacity = clamp(
      blade.baseOpacity * throttleAlpha * (0.86 + Math.random() * 0.26),
      0.08,
      1.0
    );
  }
}

function findClearLaxRunwaySpot() {
  const candidates = [
    [336, 465], [336, 500], [336, 540], [336, 580], [336, 620], [336, 650],
    [394, 465], [394, 500], [394, 540], [394, 580], [394, 620], [394, 650]
  ];
  const halfExtent = 14;
  for (const [cx, cz] of candidates) {
    let blocked = false;
    for (const b of worldBoxes) {
      if ((b.type && b.type !== 'solid') || b.solid === false) continue;
      if (b.maxY - b.minY < 1.5) continue;
      if (cx + halfExtent >= b.minX && cx - halfExtent <= b.maxX && cz + halfExtent >= b.minZ && cz - halfExtent <= b.maxZ) {
        blocked = true;
        break;
      }
    }
    if (!blocked) return { x: cx, z: cz };
  }
  return { x: LAX_AIRPORT.x, z: LAX_AIRPORT.z };
}

function createAircraftRecord(specs, mesh, spawn) {
  const gy = groundHeight(spawn.x, spawn.z);
  return {
    id: specs.id,
    specs,
    mesh,
    spawn: { ...spawn },
    spawnVerified: specs.id === 'jet',
    pos: new THREE.Vector3(spawn.x, gy + specs.gearHeight, spawn.z),
    q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, spawn.yaw, 0)),
    ground: true,
    hull: 100,
    nukes: specs.hasWeapons ? 4 : 0,
    dead: 0
  };
}

function saveActiveToRecord() {
  if (!activeAircraft) return;
  activeAircraft.pos.copy(jetState.pos);
  activeAircraft.q.copy(jetState.q);
  activeAircraft.ground = jetState.ground;
  activeAircraft.hull = jetState.hull;
  activeAircraft.nukes = jetState.nukes;
  activeAircraft.dead = jetState.dead;
}

function loadRecordToJetState(ac) {
  activeAircraft = ac;
  jetState.type = ac.id;
  jetState.specs = ac.specs;
  jetState.pos.copy(ac.pos);
  jetState.q.copy(ac.q);
  jetState.ground = ac.ground;
  jetState.hull = ac.hull;
  jetState.nukes = ac.nukes;
  jetState.dead = ac.dead;
  jetState.speed = 0;
  jetState.throttle = 0;
  jetState.afterburner = false;
  jetState.sink = 0;
  jetState.gp = 0;
  jetState.pitchRate = 0;
  jetState.rollRate = 0;
  jetState.yawRate = 0;
  jetState.sx = 0;
  jetState.sy = 0;
  jetState.agl = Math.max(0, jetState.pos.y - ac.specs.gearHeight - groundHeight(jetState.pos.x, jetState.pos.z));
  jetState.verticalSpeed = 0;
}

function resetAircraft(ac) {
  if (!ac) return;
  if (ac.id === 'boeing') {
    const spot = findClearLaxRunwaySpot();
    ac.spawn.x = spot.x;
    ac.spawn.z = spot.z;
    ac.spawnVerified = true;
  }
  const gy = ac.id === 'jet' ? AIRFIELD.y : groundHeight(ac.spawn.x, ac.spawn.z);
  ac.pos.set(ac.spawn.x, gy + ac.specs.gearHeight, ac.spawn.z);
  ac.q.setFromEuler(new THREE.Euler(0, ac.spawn.yaw, 0));
  ac.ground = true;
  ac.hull = 100;
  ac.nukes = ac.specs.hasWeapons ? 4 : 0;
  ac.dead = 0;
  ac.mesh.visible = true;

  if (activeAircraft === ac) {
    loadRecordToJetState(ac);
    jetState.crashCamTimer = 0;
  }
  if (ac.id === 'jet') clearParachute();
}

function placePlayerAt(x, z, fx, fz) {
  let placed = false;
  for (const [ox, oz] of [[0,0],[2,0],[-2,0],[0,2],[0,-2],[4,4],[-4,-4],[6,0],[0,6],[-6,0],[0,-6]]) {
    const px = x + ox, pz = z + oz, g = groundHeight(px, pz), y = computeSupportFloor(px, pz, g + 0.5, 0.42);
    if (!collidesHorizontally(px, pz, y, 1.75, 0.42)) {
      player.x = px; player.y = y; player.z = pz;
      placed = true;
      break;
    }
  }
  if (!placed) {
    const g = groundHeight(x, z);
    player.x = x;
    player.y = computeSupportFloor(x, z, g + 0.5, 0.42);
    player.z = z;
  }
  player.vy = 0; player.pvx = 0; player.pvz = 0; player.grounded = true; player.peakAirY = player.y; player.pitch = 0;
  player.yaw = Math.atan2(-fx, -fz);
}

function hangarSpawn() { placePlayerAt(-395, -106, 1, 0); }

function clearParachute() {
  chuteActive = false;
  if (chute) chute.visible = false;
}

function findNearestBoardableAircraft() {
  if (jetState.flying || gameState.inCar || meteorDrop.active) return null;
  let best = null;
  let bestDist = Infinity;
  for (const ac of aircraftFleet) {
    if (ac.dead > 0) continue;
    const dist = Math.hypot(player.x - ac.pos.x, player.z - ac.pos.z);
    if (dist < ac.specs.boardRadius && Math.abs(player.y - (ac.pos.y - ac.specs.gearHeight)) < 4.5 && dist < bestDist) {
      best = ac;
      bestDist = dist;
    }
  }
  return best;
}

function nearJet() {
  return !!findNearestBoardableAircraft();
}

export function isJetFlying() { return jetState.flying; }
export function isNearJet() { return nearJet(); }
export function getJetState() { return jetState; }
export function warpToAirBunker() {
  if (gameState.inCar || meteorDrop.active || jetState.flying) return false;
  clearParachute();
  hangarSpawn(); pushFeed('WARPED TO THE AURA AIR BUNKER — FACE THE HANGAR AND GO IN', 'border-l-sky-400'); return true;
}

function startEngineAudio() {
  if (!sfx.ctx || jetState.au) return;
  const c = sfx.ctx;
  const o1 = c.createOscillator(), o2 = c.createOscillator(), filter = c.createBiquadFilter(), gain = c.createGain();
  const noise = c.createBuffer(1, c.sampleRate, c.sampleRate), data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = c.createBufferSource(); source.buffer = noise; source.loop = true;
  const noiseFilter = c.createBiquadFilter(), noiseGain = c.createGain();
  o1.type = 'sawtooth'; o2.type = 'square'; filter.type = 'lowpass'; noiseFilter.type = 'bandpass';
  gain.gain.value = noiseGain.gain.value = 0.0001;
  o1.connect(filter); o2.connect(filter); filter.connect(gain); gain.connect(c.destination);
  source.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(c.destination); o1.start(); o2.start(); source.start();
  jetState.au = { o1, o2, filter, gain, noiseFilter, noiseGain, ctx: c };
}

function engineAudio(on) {
  const a = jetState.au; if (!a) return; const t = a.ctx.currentTime;
  if (!on || !sfx.enabled) { a.gain.gain.setTargetAtTime(0.0001, t, 0.1); a.noiseGain.gain.setTargetAtTime(0.0001, t, 0.1); return; }
  const isBoeing = jetState.type === 'boeing';
  const basePitch = isBoeing ? 30 : 40;
  const fr = basePitch + jetState.throttle * (isBoeing ? 44 : 60) + (jetState.afterburner ? 16 : 0);
  a.o1.frequency.setTargetAtTime(fr, t, 0.08); a.o2.frequency.setTargetAtTime(fr * 0.5, t, 0.08);
  a.filter.frequency.setTargetAtTime(200 + jetState.throttle * (isBoeing ? 520 : 700), t, 0.1);
  a.gain.gain.setTargetAtTime(0.03 + jetState.throttle * 0.05, t, 0.1);
  a.noiseFilter.frequency.setTargetAtTime(520 + jetState.speed * 5, t, 0.1);
  a.noiseGain.gain.setTargetAtTime(0.01 + jetState.throttle * 0.05 + jetState.speed * 0.0002 + (jetState.afterburner ? 0.04 : 0), t, 0.1);
}

export function boardJet() {
  const targetAc = findNearestBoardableAircraft();
  if (!targetAc) return false;
  if (targetAc.id === 'jet' && hooks.mpJetLocked()) {
    pushFeed('STRIKE JET IS IN USE BY ANOTHER PLAYER', 'border-l-rose-500');
    return false;
  }
  clearParachute();
  loadRecordToJetState(targetAc);
  jetState.flying = true; inputState.isPrimaryFireHeld = false; gameState.isAiming = false; player.crouching = false;
  hooks.syncMobileControls(true);
  jetState.sx = jetState.sy = 0; jetState.cameraMode = 0; jetState.cameraQ.copy(jetState.q); jetState.help = 14;
  netSyncTimer = 0;

  const atBunker = jetState.pos.x > -425 && jetState.pos.x < -356 && Math.abs(jetState.pos.z - AIRFIELD.rz) < 22;
  const atLax = jetState.pos.x >= LAX_AIRPORT.minX && jetState.pos.x <= LAX_AIRPORT.maxX && jetState.pos.z >= LAX_AIRPORT.minZ && jetState.pos.z <= LAX_AIRPORT.maxZ;
  if ((atBunker || atLax) && ((targetAc.specs.hasWeapons && jetState.nukes < 4) || jetState.hull < 100)) {
    jetState.nukes = targetAc.specs.hasWeapons ? 4 : 0;
    jetState.hull = 100;
    saveActiveToRecord();
    pushFeed(targetAc.specs.hasWeapons ? 'JET REARMED, REPAIRED & REFUELED' : 'AIRLINER REPAIRED & REFUELED', 'border-l-emerald-400');
  }

  sfx.unlock(); startEngineAudio();
  const hud = hudEls.root || document.getElementById('jet-hud'); if (hud) hud.style.display = 'block';
  const crosshair = hudEls.crosshair || document.getElementById('crosshair'); if (crosshair) crosshair.style.display = 'none';
  pushFeed(`${targetAc.specs.name} READY — W/S THROTTLE, MOUSE DOWN = PITCH UP, A/D ROLL`, 'border-l-sky-400');
  if (targetAc.id === 'jet') hooks.mpWorldEvent({ t: 'jet_board' });
  return true;
}

export function endJetFlight() {
  saveActiveToRecord();
  jetState.flying = false; engineAudio(false);
  for (const code in keysJet) keysJet[code] = false;
  hooks.syncMobileControls(true);
  const hud = hudEls.root || document.getElementById('jet-hud'); if (hud) hud.style.display = 'none';
  const crosshair = hudEls.crosshair || document.getElementById('crosshair'); if (crosshair) crosshair.style.display = '';
  camera.up.set(0, 1, 0); camera.rotation.z = 0; camera.fov = 72; camera.near = 0.14; camera.far = 1150; camera.updateProjectionMatrix();
  for (const ac of aircraftFleet) {
    if (ac.mesh?.userData?.can) ac.mesh.userData.can.visible = true;
  }
}

function buildParachute() {
  const group = new THREE.Group();
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.75, side: THREE.DoubleSide, emissive: 0x0a1d4d, emissiveIntensity: 0.18 });
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.48), canopyMat); canopy.scale.y = 0.48; canopy.position.y = 4.2; group.add(canopy);
  const ropeMat = new THREE.LineBasicMaterial({ color: 0xf1f5f9, transparent: true, opacity: 0.78 });
  for (const sx of [-2.2, 2.2]) for (const sz of [-2.2, 2.2]) {
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(sx, 3.7, sz), new THREE.Vector3(sx * 0.18, 0.15, sz * 0.18)]), ropeMat));
  }
  scene.add(group); return group;
}

export function leaveJet() {
  const ac = activeAircraft || aircraftFleet[0];
  const exitOffset = ac.id === 'boeing' ? 9.5 : 7;
  if (jetState.ground && jetState.speed < 12) {
    endJetFlight(); jetState.speed = 0; jetState.throttle = 0;
    _vLeft.copy(X_LEFT).applyQuaternion(jetState.q);
    placePlayerAt(jetState.pos.x + _vLeft.x * exitOffset, jetState.pos.z + _vLeft.z * exitOffset, -_vLeft.x, -_vLeft.z);
    pushFeed(`EXITED THE ${ac.specs.name}`, 'border-l-sky-400');
    if (ac.id === 'jet') hooks.mpWorldEvent({ t: 'jet_exit', eject: false, x: jetState.pos.x, y: jetState.pos.y, z: jetState.pos.z });
  } else {
    boom(jetState.pos, 0.5);
    endJetFlight();
    ac.mesh.visible = false;
    ac.dead = 5;
    jetState.dead = 5;
    chute = chute || buildParachute(); chute.visible = true; chuteActive = true;
    player.x = jetState.pos.x; player.z = jetState.pos.z; player.y = jetState.pos.y; player.vy = -4; player.pvx = player.pvz = 0; player.grounded = false; player.peakAirY = player.y;
    jetState.speed = 0; jetState.throttle = 0; pushFeed('EJECTED — PARACHUTE DEPLOYED', 'border-l-sky-400');
    if (ac.id === 'jet') hooks.mpWorldEvent({ t: 'jet_exit', eject: true, x: jetState.pos.x, y: jetState.pos.y, z: jetState.pos.z });
  }
}

function getExplosionGeo() {
  if (!sharedExplosionGeo) sharedExplosionGeo = new THREE.SphereGeometry(1, 16, 12);
  return sharedExplosionGeo;
}

function getDebrisMats() {
  if (!debrisMats) {
    debrisMats = [
      material(0x4b5563, { metalness: 0.6, roughness: 0.4 }),
      material(0x1f2937),
      material(0xd92b2b)
    ];
  }
  return debrisMats;
}

function crashExplosion(position) {
  boom(position, 2.6);
  const expGeo = getExplosionGeo();
  for (let i = 0; i < 3; i++) {
    const offset = new THREE.Vector3((Math.random() - 0.5) * 9, Math.random() * 4.5, (Math.random() - 0.5) * 9);
    const p = position.clone().add(offset);
    setTimeout(() => {
      const sub = new THREE.Mesh(expGeo, basic(i % 2 ? 0xff6a00 : 0xffbe3b, { transparent: true, opacity: 0.92, depthWrite: false }));
      sub.position.copy(p);
      scene.add(sub);
      effects.push({ mesh: sub, time: 0, life: 1.45, scale: 1.85 + Math.random() * 0.6 });
      [0xf97316, 0xef4444, 0x1f2937, 0x374151].forEach(c => spawnParticles(p.x, p.y, p.z, c, 14, 20));
      sfx.tone(95 - i * 15, 22, 1.1, 'sawtooth', 0.28);
    }, i * 140);
  }
  [0xf97316, 0xfacc15, 0xef4444, 0x1f2937, 0x111827].forEach(c => spawnParticles(position.x, position.y + 0.6, position.z, c, 22, 24));
  const flashLight = new THREE.PointLight(0xff7b1c, 950, 140, 2);
  flashLight.position.set(position.x, position.y + 3, position.z);
  scene.add(flashLight);
  setTimeout(() => scene.remove(flashLight), 420);
  const chunkMats = getDebrisMats();
  for (let i = 0; i < 12; i++) {
    const chunk = new THREE.Mesh(new THREE.BoxGeometry(0.5 + Math.random() * 1.1, 0.25 + Math.random() * 0.4, 0.6 + Math.random() * 1.3), chunkMats[i % chunkMats.length]);
    chunk.position.set(position.x + (Math.random() - 0.5) * 3, position.y + 1 + Math.random() * 2, position.z + (Math.random() - 0.5) * 3);
    const ang = Math.random() * Math.PI * 2;
    const spd = 10 + Math.random() * 22;
    const vel = new THREE.Vector3(Math.cos(ang) * spd, 10 + Math.random() * 18, Math.sin(ang) * spd);
    const rotVel = new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
    scene.add(chunk);
    debris.push({ mesh: chunk, vel, rotVel, life: 2.6 + Math.random() * 0.8, smokeTimer: 0 });
  }
  sfx.tone(110, 20, 1.5, 'sawtooth', 0.36);
  sfx.tone(55, 16, 1.9, 'sine', 0.42);
  flashEdge('rgba(239,68,68,.65)');
}

function crash(message) {
  const ac = activeAircraft || aircraftFleet[0];
  const crashSite = jetState.pos.clone();
  crashExplosion(crashSite);
  endJetFlight();
  ac.mesh.visible = false;
  ac.dead = 6;
  jetState.dead = 6;
  jetState.crashPos.copy(crashSite);
  jetState.crashCamTimer = 2.2;
  if (ac.id === 'boeing') {
    placePlayerAt(ac.spawn.x - 16, ac.spawn.z, 1, 0);
    pushFeed(`${message} — AIRLINER CRASHED! NEW AIRLINER WILL ARRIVE AT LAX.`, 'border-l-rose-500');
  } else {
    hangarSpawn();
    pushFeed(`${message} — JET EXPLODED! NEW JET WILL BE READY AT THE BUNKER.`, 'border-l-rose-500');
    hooks.mpWorldEvent({ t: 'jet_crash', x: crashSite.x, y: crashSite.y, z: crashSite.z });
  }
}

export function damageJet(amount) {
  jetState.hull = Math.max(0, jetState.hull - amount * 0.8);
  flashEdge('rgba(239,68,68,.48)');
  if (jetState.hull <= 0) crash(`${jetState.specs.name} DESTROYED`);
}

function rayHit(origin, direction, maxDistance, hitEntities = false) {
  let best = maxDistance;
  for (const b of worldBoxes) {
    if ((b.type && b.type !== 'solid') || b.solid === false) continue;
    if (b.maxY - b.minY < 1.5) continue;
    let t0 = 0, t1 = best, ok = true;
    for (let k = 0; k < 3 && ok; k++) {
      const o = k === 0 ? origin.x : k === 1 ? origin.y : origin.z, d = k === 0 ? direction.x : k === 1 ? direction.y : direction.z;
      const lo = k === 0 ? b.minX : k === 1 ? b.minY : b.minZ, hi = k === 0 ? b.maxX : k === 1 ? b.maxY : b.maxZ;
      if (Math.abs(d) < 1e-8) { if (o < lo || o > hi) ok = false; }
      else { let a = (lo-o)/d, c = (hi-o)/d; if (a > c) [a,c]=[c,a]; t0=Math.max(t0,a); t1=Math.min(t1,c); if(t0>t1) ok=false; }
    }
    if (ok && t0 < best) best=t0;
  }

  if (hitEntities) {
    const checkEntitySphere = (ex, ey, ez, radius) => {
      const dx = ex - origin.x, dy = ey - origin.y, dz = ez - origin.z;
      const proj = dx * direction.x + dy * direction.y + dz * direction.z;
      if (proj <= 0 || proj >= best) return;
      const distSq = (dx * dx + dy * dy + dz * dz) - proj * proj;
      if (distSq <= radius * radius) best = proj;
    };
    for (const n of npcs) {
      if (n.spawned === false) continue;
      const ey = (typeof n.y === 'number' ? n.y : groundHeight(n.x, n.z)) + 1.0;
      checkEntitySphere(n.x, ey, n.z, 1.3);
    }
    for (const c of AO.cops) {
      if (c.hp <= 0) continue;
      const ey = (typeof c.y === 'number' ? c.y : groundHeight(c.x, c.z)) + 1.0;
      checkEntitySphere(c.x, ey, c.z, 1.3);
    }
    for (const c of AO.cars) {
      if (c.hp <= 0) continue;
      const ey = (typeof c.y === 'number' ? c.y : groundHeight(c.x, c.z)) + 1.1;
      checkEntitySphere(c.x, ey, c.z, 2.6);
    }
  }

  let previous=0;
  for(let s=6;s<=best+6;s+=6){const end=Math.min(s,best);if(origin.y+direction.y*end<groundHeight(origin.x+direction.x*end,origin.z+direction.z*end)){let lo=previous,hi=end;for(let i=0;i<6;i++){const m=(lo+hi)/2;if(origin.y+direction.y*m<groundHeight(origin.x+direction.x*m,origin.z+direction.z*m))hi=m;else lo=m;}return hi;}previous=end;if(end>=best)break;}return best;
}

function impact(x,y,z) {
  spawnParticles(x,y+0.3,z,0xffb347,4,6); if(Math.random()<0.3) spawnParticles(x,y+0.2,z,0x8a7a66,3,4);
  for(const n of npcs) if(n.spawned!==false&&Math.hypot(n.x-x,n.z-z)<3.4&&Math.abs(groundHeight(n.x,n.z)-y)<6) damageNpc(n,30,Math.atan2(n.x-x,n.z-z));
  for(const c of AO.cops.slice()) if(c.hp>0&&Math.hypot(c.x-x,c.z-z)<3.4) hurtCop(c,34);
  for(const c of AO.cars) if(Math.hypot(c.x-x,c.z-z)<4.5){c.hp-=40;spawnParticles(c.x,1,c.z,0xf97316,5,6);}
}

function getTracer() {
  if (!tracerMat) {
    tracerMat = new THREE.LineBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.9 });
    for (let i = 0; i < TRACER_POOL_SIZE; i++) {
      const positions = new Float32Array(6);
      const geo = new THREE.BufferGeometry();
      const attr = new THREE.BufferAttribute(positions, 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', attr);
      const line = new THREE.Line(geo, tracerMat);
      line.visible = false;
      line.frustumCulled = false;
      worldRoot.add(line);
      tracerPool.push({ line, attr, positions, life: 0 });
    }
  }
  const item = tracerPool[tracerCursor];
  tracerCursor = (tracerCursor + 1) % TRACER_POOL_SIZE;
  return item;
}

let gunTimerInternal=0;
function fireCannon(dt) {
  if (!jetState.specs.hasWeapons) return;
  gunTimerInternal-=dt;if(gunTimerInternal>0)return;gunTimerInternal=1/17;jetState.muzzle=0.05;
  for(const s of [-1,1]){
    _vOrigin.set(s*1.15,-0.15,2.8).applyQuaternion(jetState.q).add(jetState.pos);
    _vDir.copy(Z_FORWARD).applyQuaternion(jetState.q);_vDir.x+=(Math.random()-0.5)*0.008;_vDir.y+=(Math.random()-0.5)*0.008;_vDir.normalize();
    const distance=rayHit(_vOrigin,_vDir,900,true);
    _vStart.copy(_vOrigin).addScaledVector(_vDir,14);
    _vEnd.copy(_vOrigin).addScaledVector(_vDir,Math.min(distance,170));
    const tr = getTracer();
    const p = tr.positions;
    p[0] = _vStart.x; p[1] = _vStart.y; p[2] = _vStart.z;
    p[3] = _vEnd.x;   p[4] = _vEnd.y;   p[5] = _vEnd.z;
    tr.attr.needsUpdate = true;
    tr.line.visible = true;
    tr.life = 0.07;
    if(distance<900)impact(_vEnd.x,_vEnd.y,_vEnd.z);
  }
  playJetShootSound();
}

function makeBombMesh() {
  const group = new THREE.Group(), ol = material(0x3a4234, { metalness: 0.4, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 2.6, 12), ol); body.rotation.x = Math.PI / 2; group.add(body);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.38, 1, 12), ol); cone.rotation.x = Math.PI / 2; cone.position.z = 1.8; group.add(cone);
  return group;
}

export function spawnNetBomb(x, y, z, vx, vy, vz) {
  const group = makeBombMesh();
  const position = new THREE.Vector3(x, y, z), velocity = new THREE.Vector3(vx, vy, vz);
  group.position.copy(position);
  scene.add(group);
  bombs.push({ mesh: group, position, velocity });
}

export function dropNuke() {
  if (!jetState.specs.hasWeapons) {
    pushFeed('COMMERCIAL AIRLINER IS NOT EQUIPPED WITH WEAPONS', 'border-l-amber-400');
    return false;
  }
  if (jetState.nukes <= 0) { pushFeed('OUT OF NUKES — LAND AT THE AURA AIR BUNKER OR LAX TO REARM', 'border-l-amber-400'); return false; }
  if (jetState.nukeCooldown > 0) return false;
  jetState.nukes--; jetState.nukeCooldown = 1.5;
  _vOrigin.set(0, -1.9, 0.6).applyQuaternion(jetState.q).add(jetState.pos);
  _vDir.copy(Z_FORWARD).applyQuaternion(jetState.q).multiplyScalar(jetState.speed);
  spawnNetBomb(_vOrigin.x, _vOrigin.y, _vOrigin.z, _vDir.x, _vDir.y, _vDir.z);
  hooks.mpWorldEvent({ t: 'nuke', x: _vOrigin.x, y: _vOrigin.y, z: _vOrigin.z, vx: _vDir.x, vy: _vDir.y, vz: _vDir.z });
  sfx.tone(1700, 400, 3, 'sine', 0.05); pushFeed('☢ NUKE AWAY — GET CLEAR!', 'border-l-red-500'); return true;
}

function boom(position,scale) {
  const mesh=new THREE.Mesh(getExplosionGeo(),basic(0xff9a2a,{transparent:true,opacity:0.95,depthWrite:false}));mesh.position.copy(position);scene.add(mesh);effects.push({mesh,time:0,life:1.3,scale});
  [0xf97316,0xfacc15,0xef4444,0x4b5563].forEach(c=>spawnParticles(position.x,position.y,position.z,c,12,16));sfx.tone(130,25,1.2,'sawtooth',0.3);sfx.tone(70,20,1.6,'sine',0.35);
}

function detonateBomb(position) {
  const radius=55;boom(position,2.2);
  for(const n of npcs) if(n.spawned!==false&&Math.hypot(n.x-position.x,n.z-position.z)<radius)damageNpc(n,100,Math.atan2(n.x-position.x,n.z-position.z));
  for(const c of AO.cops.slice()) if(Math.hypot(c.x-position.x,c.z-position.z)<radius)hurtCop(c,100);
  for(const c of AO.cars) if(Math.hypot(c.x-position.x,c.z-position.z)<radius)c.hp-=100;
}

function updateBombs(dt) {
  const authority = !hooks.mpIsGuest();
  for (let i = bombs.length - 1; i >= 0; i--) {
    const bomb = bombs[i];
    bomb.velocity.y -= 18 * dt;
    _vBombMove.copy(bomb.velocity).multiplyScalar(dt);
    const length = _vBombMove.length();
    if (length > 0) {
      _vBombDir.copy(_vBombMove).divideScalar(length);
      const hit = rayHit(bomb.position, _vBombDir, length);
      if (hit < length) {
        _vBombImpact.copy(bomb.position).addScaledVector(_vBombDir, hit);
        scene.remove(bomb.mesh);
        if (authority) detonateBomb(_vBombImpact);
        else boom(_vBombImpact, 2.2);
        bombs.splice(i, 1);
        continue;
      }
      bomb.mesh.quaternion.setFromUnitVectors(Z_FORWARD, _vBombDir);
    }
    bomb.position.add(_vBombMove);
    bomb.mesh.position.copy(bomb.position);
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    const fx = effects[i];
    fx.time += dt;
    const k = fx.time / fx.life;
    fx.mesh.scale.setScalar(2 + 22 * fx.scale * Math.min(1, k * 1.6));
    fx.mesh.material.opacity = Math.max(0, 0.95 * (1 - k));
    if (k >= 1) {
      scene.remove(fx.mesh);
      fx.mesh.material.dispose();
      effects.splice(i, 1);
    }
  }
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.life -= dt;
    d.vel.y -= 24 * dt;
    d.mesh.position.addScaledVector(d.vel, dt);
    d.mesh.rotation.x += d.rotVel.x * dt;
    d.mesh.rotation.y += d.rotVel.y * dt;
    d.mesh.rotation.z += d.rotVel.z * dt;
    const gh = groundHeight(d.mesh.position.x, d.mesh.position.z);
    if (d.mesh.position.y < gh + 0.25) {
      d.mesh.position.y = gh + 0.25;
      d.vel.y = Math.abs(d.vel.y) * 0.35;
      d.vel.x *= 0.65;
      d.vel.z *= 0.65;
    }
    d.smokeTimer -= dt;
    if (d.smokeTimer <= 0 && d.life > 0.4) {
      d.smokeTimer = 0.14;
      spawnParticles(d.mesh.position.x, d.mesh.position.y, d.mesh.position.z, Math.random() < 0.4 ? 0xf97316 : 0x374151, 2, 4);
    }
    if (d.life <= 0) {
      scene.remove(d.mesh);
      d.mesh.geometry.dispose();
      debris.splice(i, 1);
    }
  }
  for (let i = 0; i < tracerPool.length; i++) {
    const tr = tracerPool[i];
    if (tr.life > 0) {
      tr.life -= dt;
      if (tr.life <= 0) tr.line.visible = false;
    }
  }
}

function jetUpdate(dt) {
  const sp = jetState.specs;
  _vForward.copy(Z_FORWARD).applyQuaternion(jetState.q);
  _vLeft.copy(X_LEFT).applyQuaternion(jetState.q);
  _vUp.copy(Y_UP).applyQuaternion(jetState.q);
  const key = c => keysJet[c] ? 1 : 0;

  const keyPitch = (key('ArrowUp') - key('ArrowDown'));
  const rawPitch = clamp(keyPitch + jetState.sy, -1, 1);
  const rawRoll = clamp(key('KeyD') - key('KeyA') + jetState.sx, -1, 1);
  const rawYaw = key('KeyE') - key('KeyQ') + (key('ArrowRight') - key('ArrowLeft')) * 0.45;

  const ease = 1 - Math.exp(-dt * 9.5);
  jetState.pitchRate += (rawPitch - jetState.pitchRate) * ease;
  jetState.rollRate += (rawRoll - jetState.rollRate) * ease;
  jetState.yawRate += (clamp(rawYaw, -1, 1) - jetState.yawRate) * ease;

  jetState.sx *= Math.exp(-dt * 5.5);
  jetState.sy *= Math.exp(-dt * 5.5);

  const throttleTarget = key('KeyW') - key('KeyS');
  jetState.throttle = clamp(jetState.throttle + (throttleTarget > 0 ? 0.55 : throttleTarget < 0 ? -0.55 : 0) * dt, 0, 1);
  jetState.afterburner = (keysJet.ShiftLeft || keysJet.ShiftRight) && jetState.throttle > 0.65;

  const target = jetState.throttle * sp.maxSpeed + (jetState.afterburner ? sp.afterburnerSpeed - sp.maxSpeed : 0);
  const deceleration = jetState.ground ? (key('KeyS') && jetState.throttle < 0.02 ? 48 : 4) : 7;
  const climbDrag = _vForward.y * 9 * dt;
  jetState.speed = clamp(jetState.speed + clamp(target - jetState.speed, -deceleration * dt, (jetState.afterburner ? sp.abAccelRate : sp.accelRate) * dt) - climbDrag, 0, sp.absMaxSpeed);

  const authority = Math.min(1, 0.55 + jetState.speed / 50);
  const px = jetState.pos.x, py = jetState.pos.y, pz = jetState.pos.z;
  jetState.warning = '';

  if (!jetState.ground) {
    const roll = Math.atan2(_vLeft.y, _vUp.y);
    let pitch = jetState.pitchRate * sp.pitchAuthority * authority;
    let rollInput = jetState.rollRate * sp.rollAuthority * authority;
    let yaw = (jetState.yawRate * sp.yawAuthority + _vLeft.y * 0.65) * authority;

    if (Math.abs(jetState.rollRate) < 0.06) {
      rollInput -= clamp(roll, -1.4, 1.4) * 1.45 * (1 - 0.55 * Math.abs(jetState.pitchRate));
    }
    if (Math.abs(jetState.pitchRate) < 0.05 && _vForward.y < -0.12 && _vForward.y > -0.75) {
      pitch += clamp(-_vForward.y * 0.45, 0, 0.25);
    }

    if (jetState.speed < sp.stallSpeed) {
      const stallRatio = 1 - jetState.speed / sp.stallSpeed;
      pitch -= sp.stallPitchDrop * stallRatio;
      jetState.sink = Math.min(50, jetState.sink + sp.stallSinkRate * stallRatio * dt);
      jetState.warning = 'STALL — THROTTLE UP [W]';
    } else {
      jetState.sink *= Math.exp(-dt * 5);
    }

    if (jetState.pos.y > AIRSPACE.ceiling) pitch -= ((jetState.pos.y - AIRSPACE.ceiling) * 0.004);

    _e0.set(-pitch * dt, -yaw * dt, rollInput * dt, 'XYZ');
    _q0.setFromEuler(_e0);
    jetState.q.multiply(_q0).normalize();

    if (jetState.pos.x < AIRSPACE.minX || jetState.pos.x > AIRSPACE.maxX || jetState.pos.z < AIRSPACE.minZ || jetState.pos.z > AIRSPACE.maxZ) {
      const tx = AIRSPACE.centerX - jetState.pos.x;
      const tz = AIRSPACE.centerZ - jetState.pos.z;
      const targetYaw = Math.atan2(tx, tz);
      _e0.set(0, targetYaw, 0, 'YXZ');
      _q0.setFromEuler(_e0);
      jetState.q.slerp(_q0, 1 - Math.exp(-dt * 1.8));
      jetState.warning = 'LEAVING LOS AURA AIRSPACE — TURN BACK';
    }
  } else {
    const steer = clamp(jetState.rollRate + jetState.yawRate, -1, 1) * 1.15 * Math.min(1, jetState.speed / 12);
    const heading = Math.atan2(_vForward.x, _vForward.z) - steer * dt;
    const slopes = Math.atan((groundHeight(jetState.pos.x + _vForward.x * 5, jetState.pos.z + _vForward.z * 5) - groundHeight(jetState.pos.x - _vForward.x * 5, jetState.pos.z - _vForward.z * 5)) / 10);
    if (jetState.speed >= sp.rotateSpeed) {
      jetState.gp = clamp(jetState.gp + (jetState.pitchRate * 0.95 + (jetState.speed > sp.rotateSpeed + 25 ? 0.32 : 0)) * dt, 0, 0.5);
    } else {
      jetState.gp = Math.max(0, jetState.gp - dt);
    }
    _e0.set(-(slopes + jetState.gp), heading, 0, 'YXZ');
    _q0.setFromEuler(_e0);
    jetState.q.slerp(_q0, 1 - Math.exp(-dt * 9));
    if (jetState.gp > 0.06 && jetState.speed >= sp.rotateSpeed) {
      jetState.ground = false;
      jetState.sink = 0;
    }
  }

  _vForward.copy(Z_FORWARD).applyQuaternion(jetState.q);
  jetState.pos.addScaledVector(_vForward, jetState.speed * dt);
  if (!jetState.ground) jetState.pos.y -= jetState.sink * dt;

  const gh = groundHeight(jetState.pos.x, jetState.pos.z);
  jetState.agl = jetState.pos.y - sp.gearHeight - gh;
  jetState.verticalSpeed = _vForward.y * jetState.speed - jetState.sink;

  if (jetState.ground) {
    jetState.pos.y = gh + sp.gearHeight;
  } else if (jetState.agl <= 0 && (jetState.verticalSpeed <= 0.2 || jetState.agl < -2.2)) {
    const ahead = (groundHeight(jetState.pos.x + _vForward.x * 6, jetState.pos.z + _vForward.z * 6) - gh) / 6;
    const overOcean = (jetState.pos.z > 208 && jetState.pos.z < 380 && jetState.pos.x >= -260 && jetState.pos.x <= 500) || (jetState.pos.x >= 164 && jetState.pos.z <= 208);
    if (!overOcean && jetState.verticalSpeed > -24 && _vForward.y > -0.35 && _vForward.y < 0.55 && ahead < 0.35 && jetState.speed < 75 && jetState.agl > -2.5) {
      jetState.ground = true;
      jetState.gp = 0;
      jetState.sink = 0;
      jetState.pos.y = gh + sp.gearHeight;
      pushFeed('TOUCHDOWN', 'border-l-emerald-400');
    } else {
      return crash(overOcean ? 'CRASHED INTO THE OCEAN' : 'CRASHED');
    }
  } else if (jetState.agl < 110 && jetState.verticalSpeed < -30) {
    jetState.warning = 'PULL UP (MOVE MOUSE DOWN)';
  }

  for (const b of worldBoxes) {
    if ((b.type && b.type !== 'solid') || b.solid === false) continue;
    if (b.maxY - b.minY < 2.2 || jetState.pos.x + sp.halfSpan < b.minX || jetState.pos.x - sp.halfSpan > b.maxX || jetState.pos.z + sp.halfSpan < b.minZ || jetState.pos.z - sp.halfSpan > b.maxZ || jetState.pos.y + sp.halfHeight < b.minY || jetState.pos.y - (sp.gearHeight - 0.5) > b.maxY) continue;
    if (jetState.ground && jetState.speed < 24) {
      jetState.pos.set(px, py, pz);
      jetState.speed *= 0.2;
      break;
    }
    return crash('COLLISION');
  }

  jetState.nukeCooldown = Math.max(0, jetState.nukeCooldown - dt);
  jetState.muzzle = Math.max(0, jetState.muzzle - dt);
  if ((keysJet.M0 || keysJet.Space) && !isUiBlocked()) fireCannon(dt);
}

function buildHUD() {
  if (document.getElementById('jet-hud')) return;
  const hud = document.createElement('div');
  hud.id = 'jet-hud';
  hud.innerHTML = '<div id="jh-ret"></div><div class="p" style="top:14px;left:50%;transform:translateX(-50%)">HDG <span id="jh-hdg">N</span></div><div id="jh-warn"></div><div class="p" style="left:24px;top:50%;transform:translateY(-50%)"><b id="jh-spd">0</b>KM/H</div><div class="p" style="right:24px;top:50%;transform:translateY(-50%)"><b id="jh-alt">0</b>ALT M · AGL <span id="jh-agl">0</span></div><div class="p" style="bottom:22px;left:50%;transform:translateX(-50%);display:flex;gap:18px;align-items:center"><div>THROTTLE <span id="jh-ab">AB</span><div class="jbar"><i id="jh-thr"></i></div></div><div>HULL<div class="jbar"><i id="jh-hull"></i></div></div><div id="jh-nuke-box">NUKES <span id="jh-nuke"></span></div></div><div class="p" id="jh-help" style="left:24px;bottom:22px;text-align:left;line-height:1.55;font-size:11px">W/S THROTTLE · SHIFT AFTERBURNER · MOUSE DOWN = UP / MOUSE UP = DOWN<br>A/D ROLL · Q/E RUDDER · LMB/SPACE CANNON · B NUKE · V CAMERA · Y INVERT · F EXIT</div>';
  document.body.appendChild(hud);
  const style = document.createElement('style');
  style.textContent = '#jet-hud{position:fixed;inset:0;display:none;pointer-events:none;z-index:24;font:700 13px Rajdhani,Inter,sans-serif;letter-spacing:.1em;color:#a7ffc8;text-shadow:0 0 6px rgba(80,255,150,.6)}#jet-hud .p{position:absolute;padding:6px 12px;background:rgba(6,16,12,.55);border:1px solid rgba(120,255,180,.35);border-radius:8px;text-align:center}#jet-hud b{font-size:26px;display:block;line-height:1}#jh-ret{position:absolute;top:50%;left:50%;width:54px;height:54px;margin:-27px 0 0 -27px;border:2px solid #a7ffc8;border-radius:50%;opacity:.75}#jh-warn{position:absolute;top:70px;left:50%;transform:translateX(-50%);font-size:24px;color:#fca5a5}.jbar{width:150px;height:8px;background:rgba(255,255,255,.15);border-radius:4px;overflow:hidden;margin-top:4px}.jbar i{display:block;height:100%}';
  document.head.appendChild(style);

  hudEls.root = hud;
  hudEls.spd = document.getElementById('jh-spd');
  hudEls.alt = document.getElementById('jh-alt');
  hudEls.agl = document.getElementById('jh-agl');
  hudEls.hdg = document.getElementById('jh-hdg');
  hudEls.thr = document.getElementById('jh-thr');
  hudEls.ab = document.getElementById('jh-ab');
  hudEls.hull = document.getElementById('jh-hull');
  hudEls.nuke = document.getElementById('jh-nuke');
  hudEls.nukeBox = document.getElementById('jh-nuke-box');
  hudEls.warn = document.getElementById('jh-warn');
  hudEls.help = document.getElementById('jh-help');
  hudEls.crosshair = document.getElementById('crosshair');
}

function jetCamera(dt) {
  const sp = jetState.specs;
  jetState.cameraQ.slerp(jetState.q, 1 - Math.exp(-dt * 7.5));
  const q = jetState.cameraMode ? jetState.q : jetState.cameraQ;
  _vCamUp.copy(Y_UP).applyQuaternion(q);
  _vCamFwd.copy(Z_FORWARD).applyQuaternion(jetState.q);

  if (jetState.cameraMode) {
    const [cx, cy, cz] = sp.cockpitOffset;
    _vCamPos.set(cx, cy, cz).applyQuaternion(jetState.q).add(jetState.pos);
  } else {
    _vCamOffset.copy(Z_FORWARD).applyQuaternion(q);
    _vCamPos.copy(jetState.pos)
      .addScaledVector(_vCamOffset, -(sp.camDist + jetState.speed * 0.035))
      .addScaledVector(_vCamUp, sp.camHeight);
  }
  const shake = (jetState.muzzle > 0 ? 0.05 : 0) + (jetState.afterburner ? 0.05 : 0);
  if (shake) {
    _vCamPos.x += (Math.random() - 0.5) * shake * 3;
    _vCamPos.y += (Math.random() - 0.5) * shake * 3;
  }
  _vCamPos.y = Math.max(_vCamPos.y, groundHeight(_vCamPos.x, _vCamPos.z) + 1.5);
  camera.up.copy(_vCamUp);
  camera.position.copy(_vCamPos);
  camera.lookAt(
    jetState.cameraMode ? _vCamPos.x + _vCamFwd.x * 50 : jetState.pos.x + _vCamFwd.x * 35,
    jetState.cameraMode ? _vCamPos.y + _vCamFwd.y * 50 : jetState.pos.y + _vCamFwd.y * 35,
    jetState.cameraMode ? _vCamPos.z + _vCamFwd.z * 50 : jetState.pos.z + _vCamFwd.z * 35
  );
  const targetFov = 70 + (jetState.speed / 210) * 15 + (jetState.afterburner ? 4 : 0);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 6);
  camera.near = 0.4;
  camera.far = 1800;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

const COMPASS_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function jetHUD(elapsed) {
  const spdStr = String(Math.round(jetState.speed * 3.6));
  if (hudEls.spd && hudCache.spd !== spdStr) { hudEls.spd.textContent = spdStr; hudCache.spd = spdStr; }

  const altStr = String(Math.round(jetState.pos.y));
  if (hudEls.alt && hudCache.alt !== altStr) { hudEls.alt.textContent = altStr; hudCache.alt = altStr; }

  const aglStr = String(Math.max(0, Math.round(jetState.agl || 0)));
  if (hudEls.agl && hudCache.agl !== aglStr) { hudEls.agl.textContent = aglStr; hudCache.agl = aglStr; }

  _vHudFwd.copy(Z_FORWARD).applyQuaternion(jetState.q);
  const deg = (Math.round(THREE.MathUtils.radToDeg(Math.atan2(_vHudFwd.x, _vHudFwd.z))) + 360) % 360;
  const hdgStr = `${COMPASS_DIRS[Math.round(deg / 45) % 8]} ${String(deg).padStart(3, '0')}°`;
  if (hudEls.hdg && hudCache.hdg !== hdgStr) { hudEls.hdg.textContent = hdgStr; hudCache.hdg = hdgStr; }

  const thrStr = (jetState.throttle * 100).toFixed(1) + '%';
  if (hudEls.thr && hudCache.thr !== thrStr) { hudEls.thr.style.width = thrStr; hudCache.thr = thrStr; }

  if (hudEls.ab) {
    const abText = jetState.specs.boostLabel;
    if (hudCache.abText !== abText) { hudEls.ab.textContent = abText; hudCache.abText = abText; }
    const abOp = jetState.afterburner ? 1 : 0.25;
    if (hudCache.ab !== abOp) { hudEls.ab.style.opacity = abOp; hudCache.ab = abOp; }
  }

  const hullStr = jetState.hull.toFixed(1) + '%';
  if (hudEls.hull && hudCache.hull !== hullStr) { hudEls.hull.style.width = hullStr; hudCache.hull = hullStr; }

  const hasWeapons = jetState.specs.hasWeapons;
  if (hudEls.nukeBox && hudCache.nukeVis !== hasWeapons) {
    hudEls.nukeBox.style.display = hasWeapons ? '' : 'none';
    hudCache.nukeVis = hasWeapons;
  }
  if (hasWeapons) {
    const nukeStr = '☢'.repeat(jetState.nukes) || '—';
    if (hudEls.nuke && hudCache.nuke !== nukeStr) { hudEls.nuke.textContent = nukeStr; hudCache.nuke = nukeStr; }
  }

  if (hudEls.warn) {
    const wText = jetState.warning || '';
    if (hudCache.warn !== wText) { hudEls.warn.textContent = wText; hudCache.warn = wText; }
    const wOp = wText && Math.sin(elapsed * 14) > -0.3 ? 1 : 0;
    if (hudCache.warnOp !== wOp) { hudEls.warn.style.opacity = wOp; hudCache.warnOp = wOp; }
  }

  const helpVisible = jetState.help > 0;
  if (hudEls.help && hudCache.help !== helpVisible) {
    hudEls.help.style.display = helpVisible ? 'block' : 'none';
    hudCache.help = helpVisible;
  }
}

function syncAircraftVisuals(ac, elapsed) {
  if (!ac || !ac.mesh) return;
  const isFlown = jetState.flying && activeAircraft === ac;
  const pos = isFlown ? jetState.pos : ac.pos;
  const q = isFlown ? jetState.q : ac.q;
  const ground = isFlown ? jetState.ground : ac.ground;
  const agl = isFlown ? (jetState.agl || 99) : 0;
  const speed = isFlown ? jetState.speed : 0;
  const throttle = isFlown ? jetState.throttle : 0;
  const ab = isFlown ? jetState.afterburner : false;
  const nukes = isFlown ? jetState.nukes : ac.nukes;

  ac.mesh.position.copy(pos);
  ac.mesh.quaternion.copy(q);
  if (ac.mesh.userData.gear) ac.mesh.userData.gear.visible = ground || (agl < 16 && speed < 95);
  if (ac.mesh.userData.bomb) ac.mesh.userData.bomb.visible = nukes > 0;
  if (ac.mesh.userData.can) ac.mesh.userData.can.visible = !(isFlown && jetState.cameraMode);

  const flameActive = isFlown || throttle > 0.01;
  updateAircraftFlame(ac, throttle, ab, flameActive, elapsed);
  for (const m of ac.mesh.userData.muzzle) m.visible = isFlown && jetState.muzzle > 0;
}

function jetVisuals(elapsed) {
  for (const ac of aircraftFleet) {
    if (ac.id === 'jet' && !jetState.flying && hooks.mpJetRenderRemote()) continue;
    syncAircraftVisuals(ac, elapsed);
  }
}

export function getAircraftInteractionHint() {
  if (jetState.flying) return '';
  const nearest = findNearestBoardableAircraft();
  if (nearest) return `[F] BOARD ${nearest.specs.name}`;
  return '';
}

export function setJetMobileKey(code, down) { keysJet[code] = !!down; }
export function applyJetLookDelta(dx, dy) {
  if (!jetState.flying || isUiBlocked()) return;
  jetState.sx = clamp(jetState.sx + dx * 0.0018, -1, 1);
  jetState.sy = clamp(jetState.sy + dy * 0.0018 * (jetState.inverted ? -1 : 1), -1, 1);
}

export function initAircraft() {
  if (initialized) return jetState;
  initialized = true;
  buildBunker();
  buildJet();
  buildBoeing();

  const strikeJetRecord = createAircraftRecord(AIRCRAFT_SPECS.jet, jet, { x: -384, z: AIRFIELD.rz, yaw: Math.PI / 2 });
  const boeingRecord = createAircraftRecord(AIRCRAFT_SPECS.boeing, boeing, { x: LAX_AIRPORT.x, z: LAX_AIRPORT.z, yaw: LAX_AIRPORT.yaw });
  aircraftFleet.push(strikeJetRecord, boeingRecord);
  loadRecordToJetState(strikeJetRecord);

  buildHUD();
  resetAircraft(strikeJetRecord);
  resetAircraft(boeingRecord);
  jetVisuals(0);

  const previousHint = aura.ahHint;
  aura.ahHint = () => getAircraftInteractionHint() || (previousHint ? previousHint() : '');
  hooks.drawAircraftMapOverlay = drawAircraftMapOverlay;
  hooks.setAircraftScreen = setAircraftScreen;
  window.addEventListener('keydown', event => {
    if (gameState.screen !== 'playing') return;
    if (isUiBlocked()) return;
    keysJet[event.code] = true;
    if (event.code === 'KeyF') {
      if (jetState.flying) { event.stopImmediatePropagation(); event.preventDefault(); if (!event.repeat) leaveJet(); }
      else if (nearJet()) { event.stopImmediatePropagation(); if (!event.repeat) boardJet(); }
      return;
    }
    if (event.code === 'KeyJ' && !jetState.flying && !gameState.inCar && !meteorDrop.active && !event.repeat) {
      event.stopImmediatePropagation(); event.preventDefault(); warpToAirBunker(); return;
    }
    if (!jetState.flying) return;
    if (event.code === 'KeyH') jetState.help = jetState.help > 0 ? 0 : 999;
    else if (event.code === 'KeyY' && !event.repeat) {
      jetState.inverted = !jetState.inverted;
      pushFeed(jetState.inverted ? 'MOUSE PITCH: MOUSE UP = UP' : 'MOUSE PITCH: MOUSE DOWN = UP', 'border-l-sky-400');
    }
    if (['KeyE', 'KeyQ', 'KeyB', 'KeyN', 'KeyV', 'KeyC', 'KeyU', 'KeyI', 'KeyK', 'KeyM', 'KeyG', 'KeyJ', 'Space', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(event.code)) {
      event.stopImmediatePropagation(); event.preventDefault();
      if (event.repeat) return;
      if (event.code === 'KeyB') dropNuke();
      else if (event.code === 'KeyV') jetState.cameraMode ^= 1;
    }
  }, true);
  window.addEventListener('keyup', event => { keysJet[event.code] = false; }, true);
  window.addEventListener('blur', () => { for (const k in keysJet) keysJet[k] = false; });
  window.addEventListener('mousedown', event => {
    if (!jetState.flying || gameState.screen !== 'playing' || isUiBlocked()) return;
    event.stopImmediatePropagation();
    if (event.button === 0) { keysJet.M0 = true; if (canvas && canvas.requestPointerLock) try { canvas.requestPointerLock(); } catch (_) {} }
    if (event.button === 2) event.preventDefault();
  }, true);
  window.addEventListener('mouseup', event => { if (event.button === 0) keysJet.M0 = false; }, true);
  window.addEventListener('mousemove', event => {
    if (!jetState.flying || gameState.screen !== 'playing' || isUiBlocked()) return;
    event.stopImmediatePropagation();
    if (document.pointerLockElement === canvas) {
      jetState.sx = clamp(jetState.sx + (event.movementX || 0) * 0.0018, -1, 1);
      jetState.sy = clamp(jetState.sy + (event.movementY || 0) * 0.0018 * (jetState.inverted ? -1 : 1), -1, 1);
    }
  }, true);
  window.addEventListener('wheel', event => {
    if (!jetState.flying || gameState.screen !== 'playing' || isUiBlocked()) return;
    event.stopImmediatePropagation();
    jetState.throttle = clamp(jetState.throttle - Math.sign(event.deltaY) * 0.1, 0, 1);
  }, { capture: true, passive: true });
  Object.assign(hooks, {
    mpJetDigest: jetDigest,
    mpJetApplyRemote: applyRemoteJet,
    mpSpawnBomb: spawnNetBomb,
  });
  return jetState;
}

function updateCrashCamera(dt, elapsed, stepPlayer) {
  jetState.crashCamTimer -= dt;
  if (stepPlayer) enhancePerFrame(dt, elapsed);
  fpRoot.visible = false;
  const shake = Math.max(0, jetState.crashCamTimer / 2.2) * 1.4;
  _vCrashOffset.set(
    24 + (Math.random() - 0.5) * shake,
    16 + (Math.random() - 0.5) * shake,
    26 + (Math.random() - 0.5) * shake
  );
  _vCamPos.copy(jetState.crashPos).add(_vCrashOffset);
  _vCamPos.y = Math.max(_vCamPos.y, groundHeight(_vCamPos.x, _vCamPos.z) + 4);
  camera.up.set(0, 1, 0);
  camera.position.copy(_vCamPos);
  camera.lookAt(jetState.crashPos.x, jetState.crashPos.y + 2, jetState.crashPos.z);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

export function updateAircraft(dt, elapsed, { stepPlayer = true } = {}) {
  if (!initialized) initAircraft();

  // Verify Boeing spawn against worldBoxes once world geometry is populated
  const boeingAc = aircraftFleet[1];
  if (boeingAc && !boeingAc.spawnVerified && worldBoxes.length > 0 && !(jetState.flying && activeAircraft === boeingAc)) {
    resetAircraft(boeingAc);
  }

  updateBombs(dt);
  for (const beacon of beaconMeshes) beacon.visible = Math.sin(elapsed * 6) > 0;

  // Active parachute simulation following player ejection
  if (chuteActive) {
    if (chute) {
      chute.visible = true;
      chute.position.set(player.x, player.y, player.z);
    }
    player.vy = Math.max(player.vy, -5.5);
    player.peakAirY = player.y;
    const gh = groundHeight(player.x, player.z);
    if (player.grounded || player.y <= gh + 0.4) {
      clearParachute();
      player.vy = 0;
      player.grounded = true;
      player.y = Math.max(player.y, gh);
    }
  }

  for (const ac of aircraftFleet) {
    if (ac.dead > 0) {
      ac.dead -= dt;
      if (activeAircraft === ac) jetState.dead = ac.dead;
      if (ac.dead <= 0) {
        resetAircraft(ac);
        if (ac.id === 'boeing') {
          pushFeed('A NEW BOEING AIRLINER ARRIVED AT LAX', 'border-l-sky-400');
        } else {
          pushFeed('A NEW STRIKE JET WAS WHEELED OUT AT THE AURA AIR BUNKER', 'border-l-sky-400');
        }
      }
    }
  }
  if (!jetState.tipShown && elapsed > 8) {
    jetState.tipShown = true;
    pushFeed('NEW: PRESS [J] TO WARP TO THE AURA AIR BUNKER (OR FLY THE BOEING AT LAX)', 'border-l-sky-400');
  }

  if (!jetState.flying && jetState.crashCamTimer > 0) {
    updateCrashCamera(dt, elapsed, stepPlayer);
    return true;
  }
  if (!jetState.flying) {
    if (stepPlayer) stepSimulation(dt, elapsed);
    jetVisuals(elapsed);
    if (stepPlayer) enhancePerFrame(dt, elapsed);
    return false;
  }

  if (isUiBlocked()) keysJet.M0 = false;
  if (jetState.help > 0 && jetState.help < 900) jetState.help -= dt;
  jetUpdate(dt);

  if (!jetState.flying) {
    if (jetState.crashCamTimer > 0) {
      updateCrashCamera(dt, elapsed, stepPlayer);
      return true;
    }
    if (stepPlayer) stepSimulation(dt, elapsed);
    jetVisuals(elapsed);
    return false;
  }

  saveActiveToRecord();
  player.x = jetState.pos.x;
  player.y = jetState.pos.y;
  player.z = jetState.pos.z;
  player.vy = 0;
  player.pvx = 0;
  player.pvz = 0;
  player.grounded = true;
  player.peakAirY = player.y;
  player.mantle.active = false;
  inputState.isPrimaryFireHeld = false;
  _vForward.copy(Z_FORWARD).applyQuaternion(jetState.q);
  player.yaw = Math.atan2(-_vForward.x, -_vForward.z);
  player.pitch = 0;
  fpRoot.visible = false;

  jetVisuals(elapsed);
  jetCamera(dt);
  jetHUD(elapsed);
  engineAudio(true);

  if (jetState.type === 'jet') {
    netSyncTimer += dt;
    if (netSyncTimer >= 0.04) {
      netSyncTimer = 0;
      hooks.mpWorldEvent({
        t: 'jet_xform', x: jetState.pos.x, y: jetState.pos.y, z: jetState.pos.z,
        qx: jetState.q.x, qy: jetState.q.y, qz: jetState.q.z, qw: jetState.q.w,
        speed: jetState.speed, throttle: jetState.throttle, ground: jetState.ground, dead: jetState.dead > 0, nukes: jetState.nukes, ab: jetState.afterburner
      });
    }
  }
  if (stepPlayer) enhancePerFrame(dt, elapsed);
  return true;
}

export function applyRemoteJet(d) {
  const strikeAc = aircraftFleet[0];
  if (!initialized || (jetState.flying && jetState.type === 'jet') || !strikeAc) return false;
  if (!d) { if (strikeAc.dead <= 0) { jet.visible = true; } return false; }
  if (d.dead) { jet.visible = false; return true; }
  jet.visible = true;
  jet.position.set(d.x, d.y, d.z);
  jet.quaternion.set(d.qx, d.qy, d.qz, d.qw);
  jet.userData.gear.visible = d.ground || (d.y < 60 && d.speed < 95);
  jet.userData.bomb.visible = (d.nukes ?? 0) > 0;
  if (jet.userData.can) jet.userData.can.visible = true;
  updateAircraftFlame(strikeAc, d.throttle || 0, !!d.ab, true, performance.now() * 0.001);
  for (const m of jet.userData.muzzle) m.visible = false;
  return true;
}

export function jetDigest() {
  const strikeAc = aircraftFleet[0];
  const isJetActive = jetState.flying && jetState.type === 'jet';
  const pos = isJetActive ? jetState.pos : (strikeAc ? strikeAc.pos : jetState.pos);
  const q = isJetActive ? jetState.q : (strikeAc ? strikeAc.q : jetState.q);
  const dead = isJetActive ? jetState.dead > 0 : (strikeAc ? strikeAc.dead > 0 : false);
  return { owner: hooks.mpLocalId(), flying: isJetActive, dead,
    x: pos.x, y: pos.y, z: pos.z,
    qx: q.x, qy: q.y, qz: q.z, qw: q.w,
    speed: isJetActive ? jetState.speed : 0,
    throttle: isJetActive ? jetState.throttle : 0,
    ground: isJetActive ? jetState.ground : (strikeAc ? strikeAc.ground : true),
    nukes: isJetActive ? jetState.nukes : (strikeAc ? strikeAc.nukes : 4),
    ab: isJetActive ? jetState.afterburner : false };
}

export function drawAircraftMapOverlay(canvas, centerOnPlayer) {
  if (!canvas) return;
  if (player.y < -1.2) return;
  const ctx = canvas.getContext('2d'), scale = centerOnPlayer ? 0.65 : 0.38, rx = centerOnPlayer ? player.x : -29, rz = centerOnPlayer ? player.z : -190, X = w => canvas.width / 2 + (w - rx) * scale, Y = w => canvas.height / 2 + (w - rz) * scale;
  ctx.save();

  // Aura Air Bunker runway & hangar
  ctx.fillStyle = 'rgba(55,60,68,.9)';
  ctx.fillRect(X(AIRFIELD.rx0), Y(AIRFIELD.rz - 12), (AIRFIELD.rx1 - AIRFIELD.rx0) * scale, 24 * scale);
  ctx.fillStyle = '#64748b';
  ctx.fillRect(X(AIRFIELD.hangerX0), Y(AIRFIELD.hangerZ0), (AIRFIELD.hangerX1 - AIRFIELD.hangerX0) * scale, (AIRFIELD.hangerZ1 - AIRFIELD.hangerZ0) * scale);
  ctx.fillStyle = '#fcd34d';
  ctx.font = 'bold 10px sans-serif';
  ctx.fillText('AIR BUNKER', X(-535), Y(-131));

  // LAX Airport label
  ctx.fillStyle = '#38bdf8';
  ctx.fillText('LAX', X(365), Y(448));

  // Draw all fleet aircraft markers
  for (const ac of aircraftFleet) {
    if (ac.dead > 0) continue;
    const isFlown = jetState.flying && activeAircraft === ac;
    const pos = isFlown ? jetState.pos : ac.pos;
    const q = isFlown ? jetState.q : ac.q;
    ctx.fillStyle = ac.id === 'boeing' ? '#38bdf8' : '#a7ffc8';
    if (isFlown) {
      _vMapFwd.copy(Z_FORWARD).applyQuaternion(q);
      ctx.save();
      ctx.translate(X(pos.x), Y(pos.z));
      ctx.rotate(Math.atan2(_vMapFwd.z, _vMapFwd.x));
      ctx.beginPath();
      ctx.moveTo(ac.id === 'boeing' ? 10 : 8, 0);
      ctx.lineTo(-5, ac.id === 'boeing' ? 5.5 : 4.5);
      ctx.lineTo(-5, ac.id === 'boeing' ? -5.5 : -4.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(X(pos.x), Y(pos.z), ac.id === 'boeing' ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export function setAircraftScreen(screen) {
  if (screen === 'start') {
    if (jetState.flying) endJetFlight();
    for (const ac of aircraftFleet) resetAircraft(ac);
  }
  const hud = hudEls.root || document.getElementById('jet-hud');
  if (hud) hud.style.display = jetState.flying && screen === 'playing' ? 'block' : 'none';
  if (screen !== 'playing') engineAudio(false);
}

export const aircraftAPI = Object.freeze({ initAircraft, updateAircraft, boardJet, leaveJet, endJetFlight, warpToAirBunker, dropNuke, damageJet, isJetFlying, isNearJet, getJetState, getAircraftInteractionHint, drawAircraftMapOverlay, setAircraftScreen, setJetMobileKey, applyJetLookDelta });