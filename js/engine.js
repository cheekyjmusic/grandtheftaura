// =============================================================================
// engine.js — Three.js scene, camera, renderer (initEngine), lighting, sky, procedural PBR textures, makeMat() and the graphics tier controller.
// =============================================================================
import * as THREE from 'three';
import { gameState } from './state.js';

const PIXEL_RENDER_SCALE = 0.75;

export let canvas = null;

export let renderer = null;

export const scene = new THREE.Scene();

scene.background = new THREE.Color(0x88c9ea);

scene.fog = new THREE.FogExp2(0x9bd2ee, 0.0032);

const sunScreenPosition = new THREE.Vector3();

export function buildStudioEnvMap() {
  const faces = ['px', 'nx', 'py', 'ny', 'pz', 'nz'].map((face) => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    if (face === 'py') {
      const g = ctx.createRadialGradient(84, 44, 6, 64, 64, 96);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.22, '#fef08a');
      g.addColorStop(0.6, '#60a5fa');
      g.addColorStop(1, '#2563eb');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    } else if (face === 'ny') {
      ctx.fillStyle = '#334155';
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = '#475569';
      for (let i = 0; i < 128; i += 16) ctx.fillRect(i, 0, 4, 128);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0.0, '#1d4ed8');
      g.addColorStop(0.45, '#7dd3fc');
      g.addColorStop(0.54, '#fef3c7');
      g.addColorStop(0.56, '#475569');
      g.addColorStop(1.0, '#1e293b');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);

      ctx.fillStyle = '#334155';
      for (let x = 0; x < 128; x += 14) {
        const bh = 10 + ((x * 19 + face.charCodeAt(0) * 7) % 22);
        ctx.fillRect(x, 70 - bh, 11, bh);
      }
    }
    return c;
  });
  const cubeTex = new THREE.CubeTexture(faces);
  cubeTex.colorSpace = THREE.SRGBColorSpace;
  cubeTex.needsUpdate = true;
  return cubeTex;
}

scene.environment = buildStudioEnvMap();

export const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.14, 520);

camera.rotation.order = 'YXZ';

scene.add(camera);

// Lighting Rig
export const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x4d7c42, 0.94);

hemiLight.position.set(0, 110, 0);

scene.add(hemiLight);

export const sunLight = new THREE.DirectionalLight(0xfff5e0, 1.5);

sunLight.position.set(78, 130, 52);

sunLight.castShadow = true;

sunLight.shadow.mapSize.width = 1024;

sunLight.shadow.mapSize.height = 1024;

sunLight.shadow.camera.near = 15;

sunLight.shadow.camera.far = 310;

export const sb = 115;

sunLight.shadow.camera.left = -sb;

sunLight.shadow.camera.right = sb;

sunLight.shadow.camera.top = sb;

sunLight.shadow.camera.bottom = -sb;

sunLight.shadow.bias = -0.0005;

scene.add(sunLight);

export const rimLight = new THREE.DirectionalLight(0x93c5fd, 0);

rimLight.position.set(-72, 56, -85);

scene.add(rimLight);

// Procedural Sky Dome with Sun Disc & Low-Poly Clouds
export const skyGroup = new THREE.Group();

export const skyCanvas = document.createElement('canvas');

skyCanvas.width = 32;

skyCanvas.height = 256;

export const sCtx = skyCanvas.getContext('2d');

export const skyGrad = sCtx.createLinearGradient(0, 0, 0, 256);

skyGrad.addColorStop(0.0, '#1d4ed8');

skyGrad.addColorStop(0.42, '#4ea3e6');

skyGrad.addColorStop(0.76, '#bae6fd');

skyGrad.addColorStop(1.0, '#fef3c7');

sCtx.fillStyle = skyGrad;

sCtx.fillRect(0, 0, 32, 256);

export const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(380, 24, 16),
  new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(skyCanvas), side: THREE.BackSide, fog: false })
);

skyGroup.add(skyDome);

export const sunDisc = new THREE.Mesh(
  new THREE.CircleGeometry(22, 20),
  new THREE.MeshBasicMaterial({ color: 0xfef08a, fog: false })
);

sunDisc.position.set(160, 225, 120);

sunDisc.lookAt(0, 0, 0);

skyGroup.add(sunDisc);

export const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, fog: false });

for (let i = 0; i < 18; i++) {
  const ang = (i / 18) * Math.PI * 2;
  const rad = 140 + (i % 3) * 55;
  const cGroup = new THREE.Group();
  const p1 = new THREE.Mesh(new THREE.BoxGeometry(24, 4.5, 13), cloudMat);
  const p2 = new THREE.Mesh(new THREE.BoxGeometry(15, 5.5, 9), cloudMat);
  p2.position.set(4, 2.5, 1);
  cGroup.add(p1, p2);
  cGroup.position.set(Math.cos(ang) * rad, 110 + (i % 4) * 11, Math.sin(ang) * rad);
  cGroup.rotation.y = -ang;
  skyGroup.add(cGroup);
}

skyGroup.visible = true;

scene.add(skyGroup);

export function updateSunLensFlare() {
  const flare = document.getElementById('sun-lens-flare');
  if (!flare) return;
  if (!skyGroup.visible) {
    flare.style.opacity = '0';
    return;
  }

  camera.updateMatrixWorld();
  sunDisc.getWorldPosition(sunScreenPosition).project(camera);
  const edge = Math.max(Math.abs(sunScreenPosition.x), Math.abs(sunScreenPosition.y));
  if (sunScreenPosition.z < -1 || sunScreenPosition.z > 1 || edge > 1.18) {
    flare.style.opacity = '0';
    return;
  }

  const sunX = (sunScreenPosition.x + 1) * 50;
  const sunY = (1 - sunScreenPosition.y) * 50;
  const edgeFade = Math.min(1, (1.18 - edge) / 0.2);
  const centerFade = 0.65 + 0.35 * (1 - Math.min(1, Math.hypot(sunScreenPosition.x, sunScreenPosition.y) / 1.5));
  flare.style.opacity = String(edgeFade * centerFade * 0.8);

  const ghosts = flare.querySelectorAll('.flare-ghost');
  const positions = [0.42, 0.78, 1.18];
  ghosts.forEach((ghost, index) => {
    const t = positions[index];
    ghost.style.left = `${sunX + (50 - sunX) * t}%`;
    ghost.style.top = `${sunY + (50 - sunY) * t}%`;
  });
  const source = flare.querySelector('.flare-source');
  source.style.left = `${sunX}%`;
  source.style.top = `${sunY}%`;
}

// Fiery Meteor Mesh for Start Menu Entrance
export const meteorGroup = new THREE.Group();

meteorGroup.visible = false;

export const meteorCore = new THREE.Mesh(
  new THREE.DodecahedronGeometry(1.15, 1),
  new THREE.MeshStandardMaterial({
    color: 0x451a03,
    emissive: 0xf97316,
    emissiveIntensity: 1.4,
    roughness: 0.4
  })
);

export const meteorPlasma = new THREE.Mesh(
  new THREE.ConeGeometry(2.3, 8.5, 12, 1, true),
  new THREE.MeshBasicMaterial({
    color: 0xfacc15,
    transparent: true,
    opacity: 0.52,
    side: THREE.DoubleSide
  })
);

meteorPlasma.rotation.x = Math.PI / 2;

meteorPlasma.position.z = -3.8;

export const meteorInnerFlame = new THREE.Mesh(
  new THREE.SphereGeometry(1.72, 12, 10),
  new THREE.MeshBasicMaterial({
    color: 0xf97316,
    transparent: true,
    opacity: 0.45
  })
);

meteorGroup.add(meteorCore, meteorPlasma, meteorInnerFlame);

scene.add(meteorGroup);

// Ground Impact Aim Reticle for Meteor Landing
export const meteorReticle = new THREE.Group();

meteorReticle.visible = false;

export const retOuter = new THREE.Mesh(
  new THREE.RingGeometry(3.2, 3.8, 32),
  new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
);

retOuter.rotation.x = -Math.PI / 2;

export const retInner = new THREE.Mesh(
  new THREE.RingGeometry(0.9, 1.35, 24),
  new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide, transparent: true, opacity: 0.95 })
);

retInner.rotation.x = -Math.PI / 2;

export const retBeam = new THREE.Mesh(
  new THREE.CylinderGeometry(0.22, 0.55, 42, 12, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.24, side: THREE.DoubleSide })
);

retBeam.position.y = 21;

meteorReticle.add(retOuter, retInner, retBeam);

scene.add(meteorReticle);

export function buildTexture(type) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');

  if (type === 'asphalt') {
    ctx.fillStyle = '#2d3543';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1100; i++) {
      const v = 34 + Math.floor(Math.random() * 32);
      ctx.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
      ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
  } else if (type === 'sidewalk') {
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, 61, 61);
    ctx.strokeRect(65.5, 1.5, 61, 61);
    ctx.strokeRect(1.5, 65.5, 61, 61);
    ctx.strokeRect(65.5, 65.5, 61, 61);
  } else if (type === 'cobblestone') {
    ctx.fillStyle = '#78716c';
    ctx.fillRect(0, 0, 128, 128);
    const tones = ['#a8a29e', '#d6d3d1', '#94a3b8', '#b8b2a8'];
    for (let row = 0; row < 8; row++) {
      const off = (row % 2) * 8;
      for (let col = -1; col < 8; col++) {
        ctx.fillStyle = tones[(row * 3 + col + 4) % tones.length];
        ctx.fillRect(col * 16 + off + 1, row * 16 + 1, 14, 14);
      }
    }
  } else if (type === 'marble') {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.42)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * 16);
      ctx.bezierCurveTo(42, i * 16 + 12, 86, i * 16 - 10, 128, i * 16 + 6);
      ctx.stroke();
    }
  } else if (type === 'granite') {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 128, 128);
    const specks = ['#f8fafc', '#94a3b8', '#38bdf8', '#0f172a'];
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = specks[i % specks.length];
      ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
  } else if (type === 'concrete') {
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 750; i++) {
      const v = 135 + Math.floor(Math.random() * 38);
      ctx.fillStyle = `rgb(${v},${v},${v + 3})`;
      ctx.fillRect(Math.random() * 128, Math.random() * 128, 3, 2);
    }
    ctx.fillStyle = 'rgba(15, 23, 42, 0.16)';
    ctx.fillRect(0, 62, 128, 2);
    ctx.fillRect(62, 0, 2, 128);
  } else if (type === 'diamondplate') {
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#64748b';
    for (let y = 8; y < 128; y += 16) {
      for (let x = 8; x < 128; x += 16) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(((x + y) / 16) % 2 === 0 ? Math.PI / 4 : -Math.PI / 4);
        ctx.fillRect(-4, -1.5, 8, 3);
        ctx.restore();
      }
    }
  } else if (type === 'brushedsteel') {
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 2) {
      ctx.fillStyle = y % 4 === 0 ? 'rgba(255,255,255,0.35)' : 'rgba(100,116,139,0.22)';
      ctx.fillRect(0, y, 128, 1);
    }
  } else if (type === 'corrugated') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 128, 128);
    for (let x = 0; x < 128; x += 8) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.28)';
      ctx.fillRect(x, 0, 3, 128);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.fillRect(x + 3, 0, 2, 128);
    }
  } else if (type === 'fabric') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.14)';
    for (let y = 0; y < 128; y += 4) ctx.fillRect(0, y, 128, 1);
    for (let x = 0; x < 128; x += 4) ctx.fillRect(x, 0, 1, 128);
  } else if (type === 'water') {
    ctx.fillStyle = '#0ea5e9';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(224, 242, 254, 0.55)';
    ctx.lineWidth = 2;
    for (let y = 8; y < 128; y += 16) {
      ctx.beginPath();
      for (let x = 0; x <= 128; x += 16) {
        ctx.lineTo(x, y + Math.sin((x / 128) * Math.PI * 4) * 3);
      }
      ctx.stroke();
    }
  } else if (type === 'sand') {
    ctx.fillStyle = '#d99b52';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 950; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(180, 105, 42, 0.25)' : 'rgba(253, 230, 138, 0.22)';
      ctx.fillRect(Math.random() * 128, Math.random() * 128, 3, 2);
    }
    ctx.strokeStyle = 'rgba(146, 64, 14, 0.18)';
    ctx.lineWidth = 2;
    for (let y = 12; y < 128; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(42, y + 6, 84, y - 6, 128, y + 2);
      ctx.stroke();
    }
  } else if (type === 'redrock') {
    ctx.fillStyle = '#b45309';
    ctx.fillRect(0, 0, 128, 128);
    const strata = ['#9a3412', '#c2410c', '#d97706', '#7c2d12'];
    for (let y = 0; y < 128; y += 16) {
      ctx.fillStyle = strata[(y / 16) % strata.length];
      ctx.fillRect(0, y, 128, 14);
    }
  } else if (type === 'metallicflake') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.08)';
      ctx.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
    }
  } else if (type === 'grass') {
    ctx.fillStyle = '#60a152';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 650; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#539146' : '#71b362';
      ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 4);
    }
  } else if (type === 'siding') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.14)';
    for (let y = 0; y < 128; y += 16) ctx.fillRect(0, y, 128, 3);
  } else if (type === 'shingles') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(0,0,0,0.26)';
    ctx.lineWidth = 2;
    for (let y = 0; y < 128; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(128, y);
      ctx.stroke();
      const off = (y / 16) % 2 === 0 ? 0 : 16;
      for (let x = off; x < 128; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 16);
        ctx.stroke();
      }
    }
  } else if (type === 'brick') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.22)';
    for (let y = 0; y < 128; y += 16) {
      ctx.fillRect(0, y, 128, 2);
      const off = (y / 16) % 2 === 0 ? 0 : 16;
      for (let x = off; x < 128; x += 32) ctx.fillRect(x, y, 2, 16);
    }
  } else if (type === 'wood') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = 'rgba(69, 26, 3, 0.22)';
    for (let y = 0; y < 128; y += 21) ctx.fillRect(0, y, 128, 2);
    ctx.strokeStyle = 'rgba(69, 26, 3, 0.35)';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 122, 122);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export const procTextures = {
  asphalt: buildTexture('asphalt'),
  sidewalk: buildTexture('sidewalk'),
  cobblestone: buildTexture('cobblestone'),
  marble: buildTexture('marble'),
  granite: buildTexture('granite'),
  concrete: buildTexture('concrete'),
  diamondplate: buildTexture('diamondplate'),
  brushedsteel: buildTexture('brushedsteel'),
  corrugated: buildTexture('corrugated'),
  fabric: buildTexture('fabric'),
  water: buildTexture('water'),
  sand: buildTexture('sand'),
  redrock: buildTexture('redrock'),
  metallicflake: buildTexture('metallicflake'),
  grass: buildTexture('grass'),
  siding: buildTexture('siding'),
  shingles: buildTexture('shingles'),
  brick: buildTexture('brick'),
  wood: buildTexture('wood')
};

export const registeredMaterials = [];

export const highDetailObjects = [];

export let animatedWaterTex = null;

export function makeMat(hex, opts = {}) {
  const usePhysical = opts.clearcoat !== undefined || opts.isCarMetal;
  const params = {
    color: hex,
    flatShading: opts.flatShading ?? true,
    roughness: opts.roughness ?? 0.82,
    metalness: opts.metalness ?? 0.06,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    envMapIntensity: opts.envMapIntensity ?? (opts.metalness > 0.5 ? 1.5 : 0.8)
  };
  if (usePhysical) {
    params.clearcoat = opts.clearcoat ?? 0.85;
    params.clearcoatRoughness = opts.clearcoatRoughness ?? 0.08;
  }
  const mat = usePhysical
    ? new THREE.MeshPhysicalMaterial(params)
    : new THREE.MeshStandardMaterial(params);

  if (opts.texType) {
    registeredMaterials.push({
      mat,
      texType: opts.texType,
      repeatX: opts.repeatX ?? 2,
      repeatY: opts.repeatY ?? 2,
      bumpScale: opts.bumpScale ?? 0,
      keepSmooth: opts.flatShading === false
    });
  }
  return mat;
}

// Shared Real Transparent Glass Material for All Windows
export const realWindowGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0xbae6fd,
  roughness: 0.07,
  metalness: 0.15,
  transparent: true,
  opacity: 0.34,
  clearcoat: 1.0,
  clearcoatRoughness: 0.05,
  depthWrite: false,
  side: THREE.DoubleSide
});

export function regHigh(obj) {
  obj.visible = gameState.settings.graphics === 'high';
  highDetailObjects.push(obj);
  return obj;
}

export function applyGraphicsTier(tier) {
  gameState.settings.graphics = tier;
  const useTextures = tier === 'medium' || tier === 'high';
  const isHigh = tier === 'high';

  for (const entry of registeredMaterials) {
    if (useTextures && procTextures[entry.texType]) {
      if (entry.mat.map && entry.mat.map !== procTextures[entry.texType]) entry.mat.map.dispose();
      const cloned = procTextures[entry.texType].clone();
      cloned.needsUpdate = true;
      cloned.repeat.set(entry.repeatX, entry.repeatY);
      entry.mat.map = cloned;
      if (entry.texType === 'water') animatedWaterTex = cloned;
      if (isHigh && entry.bumpScale > 0) {
        entry.mat.bumpMap = cloned;
        entry.mat.bumpScale = entry.bumpScale;
      } else {
        entry.mat.bumpMap = null;
      }
      entry.mat.flatShading = entry.keepSmooth ? false : !isHigh;
    } else {
      entry.mat.map = null;
      entry.mat.bumpMap = null;
      entry.mat.flatShading = entry.keepSmooth ? false : true;
    }
    entry.mat.needsUpdate = true;
  }

  for (const obj of highDetailObjects) {
    obj.visible = isHigh;
  }

  skyGroup.visible = true;
  rimLight.intensity = isHigh ? 0.55 : 0;
  sunLight.intensity = isHigh ? 1.65 : 1.45;
  hemiLight.intensity = isHigh ? 0.96 : 0.88;

  if (tier === 'low') {
    renderer.shadowMap.enabled = false;
  } else {
    renderer.shadowMap.enabled = true;
    const targetSize = isHigh ? 2048 : 1024;
    if (sunLight.shadow.mapSize.width !== targetSize) {
      sunLight.shadow.mapSize.width = targetSize;
      sunLight.shadow.mapSize.height = targetSize;
      if (sunLight.shadow.map) {
        sunLight.shadow.map.dispose();
        sunLight.shadow.map = null;
      }
    }
  }
  scene.traverse((child) => {
    if (child.isMesh && child.material) child.material.needsUpdate = true;
  });

  const maxDpr = tier === 'low' ? 1.0 : tier === 'medium' ? 1.35 : 1.85;
  if (renderer) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr) * PIXEL_RENDER_SCALE);
    resizeRenderer();
  }
}

// ---- Underground atmosphere, UI, minimap ----
export const AT={sun:sunLight.intensity,hemi:hemiLight.intensity,bg:scene.background.clone(),on:false};

export const uLight=new THREE.PointLight(0xffe2b0,22,18,2);
uLight.visible=false;
scene.add(uLight);
// ----------------------------------------------------------------------------
// Everything that is NOT the game world lives in the scene root; everything that IS the world
// (roads, buildings, entities, pickups, NPCs, vehicles...) is parented to worldRoot so Studio can
// hide the whole world when it isolates a single model in its own tab.
// ----------------------------------------------------------------------------
export const worldRoot = new THREE.Group();
worldRoot.name = 'WorldRoot';
scene.add(worldRoot);

const viewport = { container: null, observer: null, callbacks: [] };

/** Size of the render area: the canvas' parent in Studio, the whole window in the game. */
export function getViewportSize() {
  if (viewport.container) return { width: Math.max(1, viewport.container.clientWidth), height: Math.max(1, viewport.container.clientHeight) };
  return { width: window.innerWidth, height: window.innerHeight };
}

export function resizeRenderer() {
  if (!renderer) return;
  const { width, height } = getViewportSize();
  renderer.setSize(width, height, !viewport.container);
}

/** Register a callback fired with (width, height) whenever the viewport container is resized (Studio). */
export function onViewportResize(cb) { viewport.callbacks.push(cb); }

/**
 * Create the WebGL renderer.
 *  - initEngine()            -> full-screen canvas on document.body (game).
 *  - initEngine({ canvas })  -> render into the given canvas and follow its parent's size (Studio).
 */
export async function initEngine({ canvas: providedCanvas } = {}) {
  let el = providedCanvas || null;
  if (!el) {
    el = document.getElementById('game-canvas');
    if (!el) {
el = document.createElement('canvas');
el.id = 'game-canvas';
el.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block;z-index:0';
document.body.appendChild(el);
    }
  }
  canvas = el;
  renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35) * PIXEL_RENDER_SCALE);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  viewport.container = providedCanvas ? (providedCanvas.parentElement || null) : null;
  resizeRenderer();
  if (viewport.container && typeof ResizeObserver !== 'undefined') {
    viewport.observer = new ResizeObserver(() => {
resizeRenderer();
const { width, height } = getViewportSize();
viewport.callbacks.forEach((cb) => cb(width, height));
    });
    viewport.observer.observe(viewport.container);
  }
  return { scene, camera, renderer, worldRoot };
}
