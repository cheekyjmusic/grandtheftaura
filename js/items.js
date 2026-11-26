import * as THREE from 'three';
import {
  addWorldBox, climb, flashEdge, gameState, hazardBarrels, hooks, inputState, lampPosts,
  meteorDrop, npcs, particleBursts, player, projectileWieners, pushFeed, smashableCrates,
  uprightFootprint, worldBoxes, worldPickups
} from './state.js';
import { camera, makeMat, scene, worldRoot } from './engine.js';
import { sfx } from './audio.js';

export const RIGHT_WEAPONS = {
  fists: {
    id: 'fists',
    name: 'Fists',
    damage: 18,
    cooldown: 0.28,
    reach: 2.05,
    isRanged: false,
    desc: 'Alternating left/right hook punches.',
    svg: `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><path d="M7 4h3v6H7V4zm4-1h3v7h-3V3zm4 1h3v6h-3V4zM5 11h14v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4v-5z"/></svg>`
  },
  bat: {
    id: 'bat',
    name: 'Wooden Bat',
    damage: 45,
    cooldown: 0.46,
    reach: 2.55,
    isRanged: false,
    desc: 'Seasoned ash slugger. Shatters crates and topples lampposts.',
    svg: `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><path d="M18.7 3.3a2.4 2.4 0 0 1 3.4 3.4L10.5 18.3l-2.8-2.8L18.7 3.3zM6.3 16.9l2.8 2.8-3.2 2.2-1.8-1.8 2.2-3.2z"/></svg>`
  },
  crowbar: {
    id: 'crowbar',
    name: 'Steel Crowbar',
    damage: 60,
    cooldown: 0.52,
    reach: 2.45,
    isRanged: false,
    desc: 'Forged hex-steel prybar with heavy overhead impact.',
    svg: `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 4c-2-1.5-5-1-6.5 1L6 16l-2 4m14-16l2 2"/></svg>`
  },
  pipe: {
    id: 'pipe',
    name: 'Tactical Pipe',
    damage: 52,
    cooldown: 0.48,
    reach: 2.45,
    isRanged: false,
    desc: 'Galvanized iron pipe with threaded joint collar.',
    svg: `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><path d="M16 3h5v4h-2v12h2v2h-7v-2h2V7h-2V3h2z" transform="rotate(35 12 12)"/></svg>`
  },
  machete: {
    id: 'machete',
    name: 'Machete',
    damage: 72,
    cooldown: 0.42,
    reach: 2.75,
    isRanged: false,
    cleave: 4,
    desc: '18" high-carbon cane blade. Sweeping 150° cleave hits up to four targets at once, severs crates, pops barrels and shears lampposts.',
    svg: `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><path d="M20.7 2.3c.6.6.6 1.6 0 2.2L10.2 15.1l-2.3-2.3L18.5 2.3c.6-.6 1.6-.6 2.2 0zM7.2 13.6l3.2 3.2-1.3 1.3-1.1-.4-1.7 1.7-2-2 1.7-1.7-.4-1.1 1.6-1z"/></svg>`
  },
  ak47: {
    id: 'ak47',
    name: 'AK-47',
    damage: 34,
    cooldown: 0.1,
    reach: 150.0,
    isRanged: true,
    desc: '7.62×39 assault rifle. 600 RPM full-auto, 30-round curved magazine. Right-click to shoulder-aim, [R] to reload. Recoil climbs — fire in bursts.',
    svg: `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><path d="M2 8h19v2.3h-2.5l-.6 1.6h-2.2l-.6-1.6h-3.2l-.5 3.5c-.1.9-.9 1.6-1.8 1.6H8.1l.5-3.3H6.3L4.8 15H2.5l1.2-3.1H2V8zm3.4 4.1-.5 1.6h1.6l.3-1.6H5.4zM16 5.6h4.4v1.7H16V5.6z"/></svg>`
  },
  hotdog_shooter: {
    id: 'hotdog_shooter',
    name: 'Hotdog Shooter',
    damage: 55,
    cooldown: 0.095,
    reach: 85.0,
    isRanged: true,
    desc: 'Rapid-fire pneumatic launcher firing high-velocity wieners. Right-click to toggle zoom aim; refill sausages at Aura Hotdogs or Plaza Cart.',
    svg: `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><path d="M4 13c0-3 3-6 8-6h4c3 0 5 2 5 4.5S19 16 16 16H9c-3 0-5-1.5-5-3zm3-1.5c1.5 1 3.5-1 5 0s3.5-1 5 0" stroke="#ef4444" stroke-width="1.6"/></svg>`
  }
};

export const LEFT_ITEMS = {
  medkit: {
    id: 'medkit',
    name: 'Medkit',
    stat: '+40 HEALTH',
    desc: 'Trauma field kit. Press [U] to restore 40 HP.',
    color: '#ef4444',
    svg: `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><path d="M9 3h6v3h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4V3zm2 2v1h2V5h-2zm0 5v3H8v2h3v3h2v-3h3v-2h-3v-3h-2z"/></svg>`
  },
  soda: {
    id: 'soda',
    name: 'Energy Drink',
    stat: '+65 STAM & SPEED',
    desc: 'Electrolyte boost. Press [U] to refill stamina and boost sprint speed.',
    color: '#38bdf8',
    svg: `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><path d="M8 3h8l1 2v14l-1 2H8l-1-2V5l1-2zm1 5v6h6V8H9z"/></svg>`
  },
  burger: {
    id: 'burger',
    name: 'Street Burger',
    stat: '+20 HP & +20 STAM',
    desc: 'Double patty burger. Press [U] to restore health and stamina.',
    color: '#f59e0b',
    svg: `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><path d="M4 10a8 6 0 0 1 16 0H4zm-1 2h18v2H3v-2zm1 4h16v1a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-1z"/></svg>`
  },
  flashlight: {
    id: 'flashlight',
    name: 'Flashlight',
    stat: 'TOGGLE BEAM [U]',
    desc: 'Tactical LED torch. Press [U] to toggle a 3D spotlight beam.',
    color: '#facc15',
    svg: `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><path d="M14 3l7 7-3 3-2-2-8 8H4v-4l8-8-2-2 4-2z"/></svg>`
  },
  cash: {
    id: 'cash',
    name: 'Cash Stack',
    stat: 'DEPOSIT +$100',
    desc: 'Strapped $100 bills. Press [U] to deposit into your cash wallet.',
    color: '#10b981',
    svg: `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><path d="M3 6h18v12H3V6zm9 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>`
  }
};

export const crateMat = makeMat(0xc2853e, { texType: 'wood', repeatX: 1, repeatY: 1, bumpScale: 0.02 });
export const barrelMat = makeMat(0xb91c1c, { texType: 'corrugated', repeatX: 3, repeatY: 1, metalness: 0.80, roughness: 0.32 });
crateMat.userData.shared = true;
barrelMat.userData.shared = true;

export const partGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16), partMats = {};
partGeo.userData.shared = true;

export function freeGeo(o) {
  if (!o) return;
  const seenGeo = new Set(), seenMat = new Set();
  o.traverse((c) => {
    if (c.geometry && !c.geometry.userData.shared && !seenGeo.has(c.geometry)) {
      seenGeo.add(c.geometry);
      c.geometry.dispose();
    }
    const mats = Array.isArray(c.material) ? c.material : (c.material ? [c.material] : []);
    for (const m of mats) {
      if (m && !m.userData.shared && !seenMat.has(m)) { seenMat.add(m); m.dispose(); }
    }
  });
}

export function spawnParticles(x, y, z, colorHex, count = 10, speed = 5.5) {
  const mat = partMats[colorHex] || (partMats[colorHex] = (() => {
    const m = new THREE.MeshBasicMaterial({ color: colorHex });
    m.userData.shared = true;
    return m;
  })());
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(partGeo, mat);
    m.position.set(x, y, z);
    worldRoot.add(m);
    particleBursts.push({
      mesh: m,
      vx: (Math.random() - 0.5) * speed,
      vy: Math.random() * speed * 0.8 + 1.5,
      vz: (Math.random() - 0.5) * speed,
      life: 0.55 + Math.random() * 0.3
    });
  }
}

const _geoCache = new Map();
function sharedGeo(key, make) {
  let g = _geoCache.get(key);
  if (!g) { g = make(); g.userData.shared = true; _geoCache.set(key, g); }
  return g;
}
const _matCache = new Map();
function weaponMat(key, hex, opts) {
  let m = _matCache.get(key);
  if (!m) { m = makeMat(hex, opts); m.userData.shared = true; _matCache.set(key, m); }
  return m;
}
function basicMat(key, hex, opts) {
  let m = _matCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial(Object.assign({ color: hex }, opts || {}));
    m.userData.shared = true;
    _matCache.set(key, m);
  }
  return m;
}
const boxGeo = (w, h, d) => sharedGeo(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
const cylGeo = (rt, rb, h, s) => sharedGeo(`c${rt}|${rb}|${h}|${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
function part(group, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rx || ry || rz) m.rotation.set(rx, ry, rz);
  m.castShadow = cast;
  group.add(m);
  return m;
}

function macheteBladeGeo() {
  return sharedGeo('macheteBlade', () => {
    const s = new THREE.Shape();
    s.moveTo(0.000, 0.000);
    s.lineTo(0.000, 0.795);
    s.lineTo(0.030, 0.868);     
    s.lineTo(0.074, 0.742);
    s.lineTo(0.099, 0.520);       
    s.lineTo(0.089, 0.205);
    s.lineTo(0.070, 0.020);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {
      depth: 0.014, bevelEnabled: true, bevelThickness: 0.0035,
      bevelSize: 0.0035, bevelSegments: 1, curveSegments: 2
    });
    g.translate(0, 0, -0.007);
    g.rotateY(Math.PI / 2);           
    g.computeVertexNormals();
    return g;
  });
}
function macheteEdgeGeo() {
  return sharedGeo('macheteEdge', () => {
    const s = new THREE.Shape();
    s.moveTo(0.030, 0.868);
    s.lineTo(0.074, 0.742);
    s.lineTo(0.099, 0.520);
    s.lineTo(0.089, 0.205);
    s.lineTo(0.070, 0.020);
    s.lineTo(0.060, 0.024);
    s.lineTo(0.079, 0.208);
    s.lineTo(0.089, 0.518);
    s.lineTo(0.065, 0.736);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.016, bevelEnabled: false, curveSegments: 2 });
    g.translate(0, 0, -0.008);
    g.rotateY(Math.PI / 2);
    g.computeVertexNormals();
    return g;
  });
}
export function buildMacheteModel() {
  const g = new THREE.Group();
  const steel = weaponMat('mchSteel', 0x9fb0bd, { texType: 'brushedsteel', metalness: 0.94, roughness: 0.30, flatShading: false });
  const hone = weaponMat('mchHone', 0xeef4f8, { texType: 'brushedsteel', metalness: 0.98, roughness: 0.10, flatShading: false });
  const dark = weaponMat('mchDark', 0x3f4a55, { metalness: 0.80, roughness: 0.44 });
  const grip = weaponMat('mchGrip', 0x1c1917, { texType: 'fabric', repeatX: 2, repeatY: 4, roughness: 0.94 });
  const guard = weaponMat('mchGuard', 0x64748b, { metalness: 0.88, roughness: 0.32 });
  const brass = weaponMat('mchBrass', 0xd4a017, { metalness: 0.92, roughness: 0.26 });

  part(g, macheteBladeGeo(), steel, 0, 0, 0);
  part(g, macheteEdgeGeo(), hone, 0, 0, 0, 0, 0, 0, false);
  part(g, boxGeo(0.017, 0.60, 0.012), dark, 0, 0.40, -0.012, 0, 0, 0, false);
  part(g, boxGeo(0.016, 0.030, 0.020), brass, 0, 0.10, -0.038, 0, 0, 0, false);
  part(g, boxGeo(0.056, 0.026, 0.112), guard, 0, -0.008, -0.036);
  part(g, boxGeo(0.048, 0.020, 0.090), dark, 0, -0.028, -0.034, 0, 0, 0, false);
  part(g, boxGeo(0.044, 0.108, 0.078), grip, 0, -0.090, -0.032);
  part(g, boxGeo(0.049, 0.070, 0.082), grip, 0, -0.150, -0.030);
  part(g, boxGeo(0.044, 0.060, 0.074), grip, 0, -0.203, -0.028);
  for (const ry of [-0.062, -0.122, -0.182]) {
    part(g, cylGeo(0.008, 0.008, 0.052, 8), brass, 0, ry, -0.032, 0, 0, Math.PI / 2, false);
  }
  part(g, boxGeo(0.050, 0.026, 0.086), guard, 0, -0.238, -0.028);
  const eye = new THREE.Mesh(sharedGeo('mchEye', () => new THREE.TorusGeometry(0.014, 0.004, 6, 12)), guard);
  eye.position.set(0, -0.256, -0.028);
  eye.rotation.y = Math.PI / 2;
  g.add(eye);
  return g;
}

export function buildAK47Model() {
  const g = new THREE.Group();
  const steel = weaponMat('akSteel', 0x2b3138, { texType: 'brushedsteel', repeatX: 3, repeatY: 3, metalness: 0.90, roughness: 0.38, flatShading: false });
  const blued = weaponMat('akBlued', 0x14181d, { metalness: 0.86, roughness: 0.34 });
  const wood = weaponMat('akWood', 0x8a4b1e, { texType: 'wood', repeatX: 2, repeatY: 3, roughness: 0.52, clearcoat: 0.35, flatShading: false });
  const woodDark = weaponMat('akWoodDark', 0x5e3212, { texType: 'wood', repeatX: 2, repeatY: 2, roughness: 0.62 });
  const mag = weaponMat('akMag', 0x3a4048, { texType: 'corrugated', repeatX: 2, repeatY: 3, metalness: 0.72, roughness: 0.48 });
  const bright = weaponMat('akBright', 0xcbd5e1, { texType: 'brushedsteel', metalness: 0.95, roughness: 0.18, flatShading: false });

  part(g, boxGeo(0.076, 0.086, 0.300), steel, 0, 0.020, -0.020);
  part(g, boxGeo(0.070, 0.034, 0.262), blued, 0, 0.076, -0.024);
  part(g, boxGeo(0.074, 0.010, 0.262), bright, 0, 0.094, -0.024, 0, 0, 0, false);
  part(g, boxGeo(0.050, 0.024, 0.036), blued, 0, 0.100, 0.052);
  part(g, boxGeo(0.040, 0.010, 0.020), bright, 0, 0.114, 0.052, 0, 0, 0, false);
  part(g, boxGeo(0.030, 0.018, 0.048), bright, 0.050, 0.076, 0.014, 0, 0, 0, false);
  part(g, boxGeo(0.012, 0.052, 0.014), bright, 0.043, 0.034, 0.056, 0, 0, -0.30, false);
  part(g, boxGeo(0.062, 0.040, 0.086), blued, 0, -0.038, -0.056);

  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    part(g, boxGeo(0.054, 0.072, 0.080 - t * 0.006), mag,
      0, -0.092 - i * 0.062, -0.058 - i * 0.030, -0.20 * i, 0, 0);
  }
  part(g, boxGeo(0.056, 0.014, 0.072), blued, 0, -0.316, -0.150, -0.60, 0, 0, false);
  for (let i = 0; i < 3; i++) {
    part(g, boxGeo(0.058, 0.008, 0.010), bright, 0, -0.116 - i * 0.062, -0.096 - i * 0.030, -0.20 * i, 0, 0, false);
  }

  part(g, boxGeo(0.050, 0.130, 0.056), woodDark, 0, -0.078, 0.058, 0.30, 0, 0);
  part(g, boxGeo(0.054, 0.018, 0.060), blued, 0, -0.140, 0.078, 0.30, 0, 0, false);
  part(g, boxGeo(0.040, 0.010, 0.070), blued, 0, -0.048, -0.004, 0, 0, 0, false);
  part(g, boxGeo(0.012, 0.036, 0.012), bright, 0, -0.030, 0.004, 0.25, 0, 0, false);
  part(g, boxGeo(0.040, 0.010, 0.014), blued, 0, -0.062, -0.030, 0, 0, 0, false);

  part(g, boxGeo(0.064, 0.056, 0.200), wood, 0, 0.018, -0.286);
  part(g, boxGeo(0.056, 0.040, 0.180), wood, 0, 0.076, -0.286);
  for (const gz of [-0.246, -0.300]) {
    part(g, boxGeo(0.068, 0.010, 0.014), woodDark, 0, 0.018, gz, 0, 0, 0, false);
  }
  part(g, boxGeo(0.070, 0.020, 0.024), blued, 0, 0.048, -0.196, 0, 0, 0, false);
  part(g, boxGeo(0.070, 0.020, 0.024), blued, 0, 0.048, -0.384, 0, 0, 0, false);

  part(g, cylGeo(0.017, 0.017, 0.430, 12), blued, 0, 0.046, -0.410, Math.PI / 2, 0, 0);
  part(g, cylGeo(0.013, 0.013, 0.210, 10), steel, 0, 0.086, -0.312, Math.PI / 2, 0, 0, false);
  part(g, boxGeo(0.046, 0.052, 0.050), steel, 0, 0.066, -0.398);
  part(g, cylGeo(0.008, 0.008, 0.300, 6), bright, 0, 0.014, -0.400, Math.PI / 2, 0, 0, false);

  part(g, boxGeo(0.038, 0.052, 0.032), blued, 0, 0.084, -0.556);
  part(g, cylGeo(0.006, 0.006, 0.030, 6), bright, 0, 0.110, -0.556, 0, 0, 0, false);
  part(g, cylGeo(0.024, 0.022, 0.062, 12), steel, 0, 0.046, -0.628, Math.PI / 2, 0, 0);
  part(g, cylGeo(0.019, 0.019, 0.010, 12), blued, 0, 0.046, -0.660, Math.PI / 2, 0, 0, false);

  part(g, boxGeo(0.050, 0.056, 0.070), steel, 0, 0.014, 0.152);
  part(g, boxGeo(0.056, 0.092, 0.230), wood, 0, -0.004, 0.290, -0.055, 0, 0);
  part(g, boxGeo(0.060, 0.108, 0.022), blued, 0, -0.018, 0.404, -0.055, 0, 0);
  part(g, boxGeo(0.050, 0.016, 0.060), woodDark, 0, 0.040, 0.250, -0.055, 0, 0, false);
  const sling = sharedGeo('akSling', () => new THREE.TorusGeometry(0.014, 0.0035, 6, 12));
  const s1 = new THREE.Mesh(sling, bright); s1.position.set(-0.032, 0.024, -0.196); s1.rotation.y = Math.PI / 2; g.add(s1);
  const s2 = new THREE.Mesh(sling, bright); s2.position.set(-0.030, -0.020, 0.230); s2.rotation.y = Math.PI / 2; g.add(s2);

  return g;
}

export function buildPickupMesh(type, id) {
  const g = new THREE.Group();
  let color = 0xf59e0b;
  let mesh;
  if (type === 'right') {
    if (id === 'bat') {
      mesh = new THREE.Mesh(cylGeo(0.055, 0.032, 0.9, 8), weaponMat('pkBat', 0xd97706, { texType: 'wood' }));
      mesh.rotation.z = 0.5;
      color = 0xd97706;
    } else if (id === 'crowbar') {
      mesh = new THREE.Mesh(boxGeo(0.08, 0.85, 0.08), weaponMat('pkCrow', 0xef4444, { metalness: 0.85 }));
      mesh.rotation.z = 0.45;
      color = 0xef4444;
    } else if (id === 'pipe') {
      mesh = new THREE.Mesh(cylGeo(0.05, 0.05, 0.85, 8), weaponMat('pkPipe', 0x94a3b8, { texType: 'brushedsteel', metalness: 0.9 }));
      mesh.rotation.z = 0.45;
      color = 0x94a3b8;
    } else if (id === 'machete') {
      const holder = new THREE.Group();
      const blade = buildMacheteModel();
      blade.position.y = -0.30;
      holder.add(blade);
      holder.scale.setScalar(1.28);
      holder.rotation.set(0.18, 0.55, 0.52);
      mesh = holder;
      color = 0xcbd5e1;
    } else if (id === 'ak47') {
      const holder = new THREE.Group();
      const rifle = buildAK47Model();
      rifle.position.set(0, 0.02, 0.10);
      holder.add(rifle);
      holder.scale.setScalar(1.32);
      holder.rotation.set(0.22, 0.70, 0.30);
      mesh = holder;
      color = 0xf59e0b;
    } else if (id === 'hotdog_shooter') {
      const hdGun = new THREE.Group();
      const bunBody = new THREE.Mesh(sharedGeo('pkBun', () => new THREE.CapsuleGeometry(0.11, 0.52, 6, 8)), weaponMat('pkBunM', 0xd97706));
      bunBody.rotation.x = Math.PI / 2;
      const barrel = new THREE.Mesh(cylGeo(0.07, 0.08, 0.65, 10), weaponMat('pkHDBarrel', 0xdc2626, { metalness: 0.7 }));
      barrel.rotation.x = Math.PI / 2;
      barrel.position.y = 0.06;
      const tip = new THREE.Mesh(sharedGeo('pkTip', () => new THREE.SphereGeometry(0.065, 8, 6)), weaponMat('pkTipM', 0xb91c1c));
      tip.position.set(0, 0.06, 0.34);
      hdGun.add(bunBody, barrel, tip);
      mesh = hdGun;
      color = 0xfacc15;
    }
  } else {
    const itemDef = LEFT_ITEMS[id] || LEFT_ITEMS.cash;
    color = new THREE.Color(itemDef.color).getHex();
    mesh = new THREE.Mesh(
      boxGeo(0.42, 0.28, 0.32),
      weaponMat('pkLeft' + color, color, { emissive: color, emissiveIntensity: 0.3 })
    );
  }
  const ring = new THREE.Mesh(
    sharedGeo('pkRing', () => new THREE.RingGeometry(0.45, 0.58, 16)),
    basicMat('pkRingM' + color, color, { side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.50;
  g.add(mesh, ring);
  g.userData.pickupColor = color;
  return g;
}

let netSeq = 0;
export function getNetSeq() { return netSeq; }
export function setNetSeq(v) { netSeq = Math.max(netSeq, v | 0); }

export function spawnWorldPickup(type, id, x, y, z, opts = {}) {
  const g = buildPickupMesh(type, id);
  g.position.set(x, y + 0.55, z);
  if (opts.rot) g.rotation.set(opts.rot[0], opts.rot[1], opts.rot[2]);
  if (opts.scale) g.scale.set(opts.scale[0], opts.scale[1], opts.scale[2]);
  if (opts.decorate) opts.decorate(g);
  worldRoot.add(g);
  const rec = { type, id, x, y, z, group: g, baseY: y + 0.55, phase: Math.random() * 6, netId: opts.netId || ('n' + (netSeq++)) };
  worldPickups.push(rec);
  return rec;
}

export function grantRightWeapon(id, { equip = false, announce = true } = {}) {
  if (!RIGHT_WEAPONS[id]) return false;
  if (!gameState.rightWeapons.includes(id)) gameState.rightWeapons.push(id);
  if (id === 'ak47') ensureAK47State();
  if (id === 'hotdog_shooter') gameState.hotdogAmmo = Math.max(gameState.hotdogAmmo || 0, 60);
  if (equip) gameState.activeRightWeapon = id;
  if (hooks.syncEquippedMeshes) hooks.syncEquippedMeshes();
  if (hooks.updateHUD) hooks.updateHUD();
  if (announce) pushFeed(`ACQUIRED ${RIGHT_WEAPONS[id].name.toUpperCase()}`, 'border-l-amber-400');
  return true;
}

export function spawnSmashCrate(x, y, z, loot = null, opts = {}) {
  const holder = new THREE.Group();
  holder.position.set(x, y, z);
  const mesh = new THREE.Mesh(boxGeo(1.05, 1.05, 1.05), crateMat);
  mesh.position.y = 0.525;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  holder.add(mesh);
  if (opts.rot) holder.rotation.set(opts.rot[0], opts.rot[1], opts.rot[2]);
  if (opts.scale) holder.scale.set(opts.scale[0], opts.scale[1], opts.scale[2]);
  if (opts.decorate) opts.decorate(holder);
  worldRoot.add(holder);
  const b = uprightFootprint(holder, 0.53, 0.53, 1.05);
  const box = addWorldBox(b.minX, b.maxX, y, y + b.height, b.minZ, b.maxZ, 'crate', true);
  const rec = { x, y, z, hp: 35, mesh: holder, box, loot, netId: 'n' + (netSeq++) };
  smashableCrates.push(rec);
  return rec;
}

export function spawnHazardBarrel(x, y, z, opts = {}) {
  const holder = new THREE.Group();
  holder.position.set(x, y, z);
  const mesh = new THREE.Mesh(cylGeo(0.42, 0.42, 1.15, 10), barrelMat);
  mesh.position.y = 0.575;
  mesh.castShadow = true;
  holder.add(mesh);
  if (opts.rot) holder.rotation.set(opts.rot[0], opts.rot[1], opts.rot[2]);
  if (opts.scale) holder.scale.set(opts.scale[0], opts.scale[1], opts.scale[2]);
  if (opts.decorate) opts.decorate(holder);
  worldRoot.add(holder);
  const b = uprightFootprint(holder, 0.44, 0.44, 1.15);
  const box = addWorldBox(b.minX, b.maxX, y, y + b.height, b.minZ, b.maxZ, 'barrel', true);
  const rec = { x, y, z, hp: 30, mesh: holder, box, netId: 'n' + (netSeq++) };
  hazardBarrels.push(rec);
  return rec;
}

export function destroyCrate(rec, spawnLoot) {
  const i = smashableCrates.indexOf(rec);
  if (i < 0) return null;
  worldRoot.remove(rec.mesh);
  freeGeo(rec.mesh);
  const bi = worldBoxes.indexOf(rec.box);
  if (bi !== -1) worldBoxes.splice(bi, 1);
  smashableCrates.splice(i, 1);
  let lootRec = null;
  if (spawnLoot && rec.loot) lootRec = spawnWorldPickup(rec.loot.type, rec.loot.id, rec.x, rec.y, rec.z);
  return lootRec;
}

export function destroyBarrel(rec) {
  const i = hazardBarrels.indexOf(rec);
  if (i < 0) return false;
  worldRoot.remove(rec.mesh);
  freeGeo(rec.mesh);
  const bi = worldBoxes.indexOf(rec.box);
  if (bi !== -1) worldBoxes.splice(bi, 1);
  hazardBarrels.splice(i, 1);
  return true;
}

export function removePickupByNetId(netId) {
  const i = worldPickups.findIndex((p) => p.netId === netId);
  if (i < 0) return null;
  const rec = worldPickups[i];
  worldRoot.remove(rec.group);
  freeGeo(rec.group);
  worldPickups.splice(i, 1);
  return rec;
}

function makeWienerMesh() {
  const wGroup = new THREE.Group();
  const wienerMesh = new THREE.Mesh(
    sharedGeo('wienBody', () => new THREE.CapsuleGeometry(0.068, 0.34, 5, 8)),
    weaponMat('wienM', 0xb91c1c, { roughness: 0.32 })
  );
  wienerMesh.rotation.x = Math.PI / 2;
  const mustardLine = new THREE.Mesh(boxGeo(0.024, 0.02, 0.32), weaponMat('wienMust', 0xfacc15));
  mustardLine.position.y = 0.068;
  wGroup.add(wienerMesh, mustardLine);
  return wGroup;
}
function makeTracerMesh() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(boxGeo(0.028, 0.028, 0.72), basicMat('tracerCore', 0xfff3c4));
  const glow = new THREE.Mesh(boxGeo(0.062, 0.062, 1.05), basicMat('tracerGlow', 0xffa726, { transparent: true, opacity: 0.42, depthWrite: false }));
  glow.position.z = -0.14;
  const tip = new THREE.Mesh(sharedGeo('tracerTip', () => new THREE.SphereGeometry(0.045, 6, 5)), basicMat('tracerTipM', 0xffe08a));
  tip.position.z = 0.38;
  g.add(glow, core, tip);
  return g;
}

export function spawnNetWiener(x, y, z, vx, vy, vz, by, kind = 'wiener') {
  const mesh = kind === 'bullet' ? makeTracerMesh() : makeWienerMesh();
  mesh.position.set(x, y, z);
  worldRoot.add(mesh);
  projectileWieners.push({ mesh, x, y, z, vx, vy, vz, life: kind === 'bullet' ? 1.8 : 3.2, by, kind, net: true });
}

export function buildRightWeaponMesh(id) {
  const g = new THREE.Group();
  if (id === 'bat') {
    part(g, cylGeo(0.024, 0.032, 0.24, 8), weaponMat('hwBatGrip', 0x1e293b), 0, 0.08, 0);
    part(g, cylGeo(0.048, 0.026, 0.56, 8), weaponMat('pkBat', 0xd97706, { texType: 'wood' }), 0, 0.46, 0);
    g.rotation.x = -0.32;
  } else if (id === 'crowbar') {
    part(g, cylGeo(0.024, 0.024, 0.64, 6), weaponMat('hwCrow', 0xb91c1c, { metalness: 0.85 }), 0, 0.28, 0);
    part(g, boxGeo(0.05, 0.05, 0.18), weaponMat('hwCrowHook', 0xdbeafe, { metalness: 0.9 }), 0, 0.60, -0.07);
    g.rotation.x = -0.32;
  } else if (id === 'pipe') {
    part(g, cylGeo(0.034, 0.034, 0.66, 8), weaponMat('pkPipe', 0x94a3b8, { texType: 'brushedsteel', metalness: 0.92 }), 0, 0.30, 0);
    part(g, cylGeo(0.048, 0.048, 0.08, 8), weaponMat('hwFlange', 0x475569, { metalness: 0.9 }), 0, 0.60, 0);
    g.rotation.x = -0.32;
  } else if (id === 'machete') {
    const blade = buildMacheteModel();
    blade.position.set(0, 0.115, 0.028);
    g.add(blade);
    g.rotation.x = -0.30;
    g.rotation.z = 0.06;
  } else if (id === 'ak47') {
    const rifle = buildAK47Model();
    rifle.position.set(0.006, 0.072, -0.052);
    g.add(rifle);
    g.rotation.x = 0.015;
  } else if (id === 'hotdog_shooter') {
    const bunMat = weaponMat('hdBun', 0xd97706, { roughness: 0.58 });
    const redMat = weaponMat('hdRed', 0xdc2626, { metalness: 0.72, roughness: 0.26 });
    const yellowMat = weaponMat('hdYellow', 0xfacc15, { roughness: 0.35 });
    const steelMat = weaponMat('hdSteel', 0xe2e8f0, { metalness: 0.92, roughness: 0.18 });
    const bunGeo = sharedGeo('hdBunG', () => new THREE.CapsuleGeometry(0.068, 0.36, 6, 8));
    const bunL = new THREE.Mesh(bunGeo, bunMat);
    bunL.rotation.x = Math.PI / 2;
    bunL.position.set(-0.042, 0.02, -0.14);
    const bunR = bunL.clone();
    bunR.position.x = 0.042;
    const barrel = new THREE.Mesh(cylGeo(0.052, 0.062, 0.54, 10), redMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.055, -0.20);
    const mustardStripe = new THREE.Mesh(boxGeo(0.025, 0.018, 0.48), yellowMat);
    mustardStripe.position.set(0, 0.112, -0.20);
    const muzzle = new THREE.Mesh(cylGeo(0.064, 0.064, 0.06, 12), steelMat);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.055, -0.47);
    const loadedTip = new THREE.Mesh(sharedGeo('hdTip', () => new THREE.SphereGeometry(0.048, 8, 6)), weaponMat('hdTipM', 0xb91c1c));
    loadedTip.position.set(0, 0.055, -0.49);
    const scope = new THREE.Mesh(cylGeo(0.024, 0.024, 0.22, 8), weaponMat('hdScope', 0x0f172a, { metalness: 0.85 }));
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.145, -0.14);
    g.add(bunL, bunR, barrel, mustardStripe, muzzle, loadedTip, scope);
  }
  return g;
}

export function buildLeftItemMesh(id) {
  const g = new THREE.Group();
  if (id === 'medkit') {
    part(g, boxGeo(0.18, 0.14, 0.09), weaponMat('liWhite', 0xf8fafc), 0, 0, 0);
    part(g, boxGeo(0.08, 0.026, 0.10), weaponMat('liRed', 0xef4444), 0, 0, 0, 0, 0, 0, false);
    part(g, boxGeo(0.026, 0.08, 0.10), weaponMat('liRed', 0xef4444), 0, 0, 0, 0, 0, 0, false);
  } else if (id === 'soda') {
    part(g, cylGeo(0.042, 0.042, 0.14, 10), weaponMat('liCan', 0x0284c7, { metalness: 0.85 }), 0, 0, 0);
    part(g, cylGeo(0.044, 0.044, 0.02, 10), weaponMat('liRim', 0xe2e8f0, { metalness: 0.9 }), 0, 0.065, 0, 0, 0, 0, false);
  } else if (id === 'burger') {
    part(g, cylGeo(0.055, 0.072, 0.045, 10), weaponMat('liBun', 0xd97706), 0, 0.032, 0);
    part(g, cylGeo(0.074, 0.074, 0.028, 10), weaponMat('liPatty', 0x451a03), 0, 0, 0, 0, 0, 0, false);
    part(g, cylGeo(0.07, 0.065, 0.03, 10), weaponMat('liBun', 0xd97706), 0, -0.028, 0, 0, 0, 0, false);
  } else if (id === 'flashlight') {
    part(g, cylGeo(0.028, 0.028, 0.22, 8), weaponMat('liTorch', 0x1e293b, { metalness: 0.8 }), 0, 0, 0, Math.PI / 2);
    part(g, cylGeo(0.038, 0.032, 0.05, 8), weaponMat('liLens', 0xfef08a, { emissive: 0xfacc15, emissiveIntensity: 0.6 }), 0, 0, -0.12, Math.PI / 2, 0, 0, false);
  } else if (id === 'cash') {
    part(g, boxGeo(0.16, 0.05, 0.09), weaponMat('liCash', 0x10b981), 0, 0, 0);
    part(g, boxGeo(0.03, 0.054, 0.094), weaponMat('liBand', 0xfef3c7), 0, 0, 0, 0, 0, 0, false);
  }
  return g;
}

export const AK47_MAG_SIZE = 30;
export const AK47_START_RESERVE = 270;
const AK47_RELOAD_TIME = 2.1;
const AK47_MUZZLE_SPEED = 205;

const ak = {
  cooldown: 0,
  reload: 0,
  kick: 0,
  heat: 0,
  fov: 72,
  fovActive: false,
  burst: 0,
  dryWarned: false,
  emptyWarned: false,
  equipped: false
};

function ensureAK47State() {
  if (!Number.isFinite(gameState.ak47Ammo)) gameState.ak47Ammo = AK47_MAG_SIZE;
  if (!Number.isFinite(gameState.ak47Reserve)) gameState.ak47Reserve = AK47_START_RESERVE;
  gameState.ak47Ammo = Math.max(0, Math.min(AK47_MAG_SIZE, Math.floor(gameState.ak47Ammo)));
  gameState.ak47Reserve = Math.max(0, Math.floor(gameState.ak47Reserve));
}

export function addAK47Ammo(rounds = 60) {
  ensureAK47State();
  gameState.ak47Reserve += Math.max(0, rounds | 0);
  if (hooks.updateHUD) hooks.updateHUD();
}

function startAK47Reload() {
  ensureAK47State();
  if (ak.reload > 0) return false;
  if (gameState.ak47Ammo >= AK47_MAG_SIZE) return false;
  if (gameState.ak47Reserve <= 0) {
    if (!ak.dryWarned) {
      ak.dryWarned = true;
      sfx.uiClick();
      pushFeed('AK-47 RESERVE EMPTY — NO SPARE 7.62', 'border-l-rose-500');
    }
    return false;
  }
  ak.reload = AK47_RELOAD_TIME;
  ak.dryWarned = false;
  ak.emptyWarned = false;
  sfx.shift();
  sfx.tone(420, 240, 0.09, 'square', 0.035);
  pushFeed('RELOADING AK-47…', 'border-l-amber-400');
  hooks.mpWorldEvent({ t: 'ak_reload' });
  return true;
}

function finishAK47Reload() {
  ensureAK47State();
  const need = AK47_MAG_SIZE - gameState.ak47Ammo;
  const take = Math.min(need, gameState.ak47Reserve);
  gameState.ak47Ammo += take;
  gameState.ak47Reserve -= take;
  ak.burst = 0;
  sfx.shift();
  sfx.tone(700, 380, 0.07, 'square', 0.04);
  if (hooks.updateHUD) hooks.updateHUD();
}

let muzzleRig = null, muzzleLight = null;
function ensureMuzzleRig() {
  if (!muzzleRig) {
    muzzleRig = new THREE.Group();
    muzzleRig.userData.persistentFX = true;
    muzzleRig.userData.studioSelectable = false;
    const petal = new THREE.Mesh(
      sharedGeo('mzCone', () => new THREE.ConeGeometry(0.10, 0.34, 7)),
      basicMat('mzOuter', 0xffb020, { transparent: true, opacity: 0.92, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    petal.rotation.x = -Math.PI / 2;
    petal.position.z = -0.17;
    const core = new THREE.Mesh(
      sharedGeo('mzCore', () => new THREE.SphereGeometry(0.085, 8, 6)),
      basicMat('mzCore', 0xfff3c4, { transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    const side1 = new THREE.Mesh(boxGeo(0.30, 0.035, 0.035), basicMat('mzOuter', 0xffb020, { transparent: true, opacity: 0.92, depthWrite: false, blending: THREE.AdditiveBlending }));
    const side2 = new THREE.Mesh(boxGeo(0.035, 0.30, 0.035), basicMat('mzOuter', 0xffb020, { transparent: true, opacity: 0.92, depthWrite: false, blending: THREE.AdditiveBlending }));
    muzzleRig.add(petal, core, side1, side2);
    muzzleRig.visible = false;
    muzzleLight = new THREE.PointLight(0xffc46b, 0, 16, 2);
    muzzleRig.add(muzzleLight);
  }
  if (muzzleRig.parent !== worldRoot) worldRoot.add(muzzleRig);
  return muzzleRig;
}
let muzzleTimer = 0;

const brassPool = [];
function ejectBrass(x, y, z, yaw) {
  let c = brassPool.find((b) => b.life <= 0);
  if (!c) {
    if (brassPool.length >= 20) return;
    const mesh = new THREE.Mesh(
      cylGeo(0.017, 0.019, 0.052, 7),
      weaponMat('brass', 0xd9a441, { metalness: 0.95, roughness: 0.24 })
    );
    mesh.userData.persistentFX = true;
    c = { mesh, vx: 0, vy: 0, vz: 0, life: 0, sx: 0, sy: 0, sz: 0 };
    brassPool.push(c);
  }
  if (c.mesh.parent !== worldRoot) worldRoot.add(c.mesh);
  c.mesh.visible = true;
  c.mesh.position.set(x, y, z);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  c.vx = rx * (2.2 + Math.random() * 1.4) + (Math.random() - 0.5) * 0.6;
  c.vy = 2.0 + Math.random() * 1.3;
  c.vz = rz * (2.2 + Math.random() * 1.4) + (Math.random() - 0.5) * 0.6;
  c.sx = (Math.random() - 0.5) * 26;
  c.sy = (Math.random() - 0.5) * 26;
  c.sz = (Math.random() - 0.5) * 26;
  c.life = 1.5;
}
function stepBrass(dt) {
  for (const c of brassPool) {
    if (c.life <= 0) continue;
    c.life -= dt;
    c.vy -= 17 * dt;
    c.mesh.position.x += c.vx * dt;
    c.mesh.position.y += c.vy * dt;
    c.mesh.position.z += c.vz * dt;
    c.mesh.rotation.x += c.sx * dt;
    c.mesh.rotation.y += c.sy * dt;
    c.mesh.rotation.z += c.sz * dt;
    if (c.life <= 0) { c.mesh.visible = false; c.life = 0; }
  }
}

const akHud = { el: null, mag: null, res: null, fill: null, hint: null, lastMag: -1, lastRes: -1, lastState: '' };
function ensureAkHud() {
  if (akHud.el) return;
  const el = document.createElement('div');
  el.id = 'ak-hud';
  el.style.cssText = 'position:fixed;right:18px;bottom:112px;z-index:24;display:none;pointer-events:none;min-width:172px;padding:9px 13px 10px;border-radius:11px;background:linear-gradient(160deg,rgba(12,16,22,.94),rgba(20,14,8,.94));border:1px solid rgba(245,158,11,.55);box-shadow:0 8px 26px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.06);color:#fff;font:700 11px Rajdhani,Inter,sans-serif;letter-spacing:.09em;text-transform:uppercase';
  el.innerHTML =
    '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px">'
    + '<span style="font:800 11px Oswald,Rajdhani,sans-serif;color:#f59e0b;letter-spacing:.16em">AK-47</span>'
    + '<span style="font-size:9px;color:#94a3b8">7.62×39</span>'
    + '</div>'
    + '<div style="display:flex;align-items:baseline;gap:5px;margin-top:3px;font-family:Oswald,Rajdhani,sans-serif">'
    + '<span id="ak-mag" style="font-size:27px;line-height:1;color:#f8fafc">30</span>'
    + '<span style="font-size:15px;color:#64748b">/</span>'
    + '<span id="ak-res" style="font-size:15px;color:#94a3b8">270</span>'
    + '</div>'
    + '<div style="height:4px;margin-top:6px;background:#1e293b;border-radius:9px;overflow:hidden">'
    + '<div id="ak-fill" style="height:100%;width:100%;background:linear-gradient(90deg,#f59e0b,#fbbf24);transition:width .08s linear"></div>'
    + '</div>'
    + '<div id="ak-hint" style="font-size:9px;color:#94a3b8;margin-top:5px;letter-spacing:.12em">[R] RELOAD · [RMB] AIM</div>';
  document.body.appendChild(el);
  akHud.el = el;
  akHud.mag = el.querySelector('#ak-mag');
  akHud.res = el.querySelector('#ak-res');
  akHud.fill = el.querySelector('#ak-fill');
  akHud.hint = el.querySelector('#ak-hint');
}
function updateAkHud() {
  ensureAkHud();
  const show = ak.equipped && gameState.screen === 'playing' && !gameState.inCar;
  const disp = show ? 'block' : 'none';
  if (akHud.el.style.display !== disp) akHud.el.style.display = disp;
  if (!show) return;
  const mag = gameState.ak47Ammo | 0, res = gameState.ak47Reserve | 0;
  if (mag !== akHud.lastMag) {
    akHud.lastMag = mag;
    akHud.mag.textContent = String(mag);
    akHud.mag.style.color = mag === 0 ? '#f43f5e' : (mag <= 6 ? '#fbbf24' : '#f8fafc');
  }
  if (res !== akHud.lastRes) { akHud.lastRes = res; akHud.res.textContent = String(res); }
  const reloading = ak.reload > 0;
  const pct = reloading ? (1 - ak.reload / AK47_RELOAD_TIME) * 100 : (mag / AK47_MAG_SIZE) * 100;
  akHud.fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  const state = reloading ? 'reload' : (mag === 0 ? 'empty' : (mag <= 6 ? 'low' : 'ok'));
  if (state !== akHud.lastState) {
    akHud.lastState = state;
    akHud.fill.style.background = reloading
      ? 'linear-gradient(90deg,#38bdf8,#22d3ee)'
      : (state === 'empty' ? '#f43f5e' : (state === 'low' ? 'linear-gradient(90deg,#f43f5e,#fbbf24)' : 'linear-gradient(90deg,#f59e0b,#fbbf24)'));
    akHud.hint.textContent = reloading ? 'RELOADING…' : (state === 'empty' ? (res > 0 ? '[R] RELOAD' : 'RESERVE EMPTY') : '[R] RELOAD · [RMB] AIM');
    akHud.hint.style.color = reloading ? '#38bdf8' : (state === 'empty' ? '#f43f5e' : '#94a3b8');
  }
}

let akKeyBound = false;
function bindAK47Keys() {
  if (akKeyBound) return;
  akKeyBound = true;
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyR' || e.repeat) return;
    const tag = e.target && e.target.tagName;
    if (tag && /INPUT|TEXTAREA|SELECT/.test(tag)) return;
    if (gameState.screen !== 'playing' || gameState.inCar) return;
    if (gameState.activeRightWeapon !== 'ak47') return;
    if (gameState.inventoryOpen || gameState.mapOpen || gameState.settingsOpen) return;
    if (startAK47Reload()) e.preventDefault();
  });
}

const _akDir = new THREE.Vector3();
const _akMuzzle = new THREE.Vector3();

function fireAK47Round() {
  ensureAK47State();
  if (gameState.ak47Ammo <= 0) return false;
  gameState.ak47Ammo--;

  _akDir.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  const aiming = Boolean(gameState.isAiming);
  const bloom = (aiming ? 0.0035 : 0.016) + ak.heat * (aiming ? 0.010 : 0.030);
  _akDir.x += (Math.random() - 0.5) * bloom;
  _akDir.y += (Math.random() - 0.5) * bloom;
  _akDir.z += (Math.random() - 0.5) * bloom;
  _akDir.normalize();

  if (gameState.thirdPerson || aiming) {
    _akMuzzle.set(player.x, player.y + 1.44, player.z).addScaledVector(_akDir, 0.95);
  } else if (hooks.getRightMountWorldPosition) {
    hooks.getRightMountWorldPosition(_akMuzzle);
    _akMuzzle.addScaledVector(_akDir, 0.66);
  } else {
    _akMuzzle.set(player.x, player.y + 1.44, player.z).addScaledVector(_akDir, 0.95);
  }

  const mesh = makeTracerMesh();
  mesh.position.copy(_akMuzzle);
  worldRoot.add(mesh);
  projectileWieners.push({
    mesh, kind: 'bullet',
    x: _akMuzzle.x, y: _akMuzzle.y, z: _akMuzzle.z,
    vx: _akDir.x * AK47_MUZZLE_SPEED,
    vy: _akDir.y * AK47_MUZZLE_SPEED,
    vz: _akDir.z * AK47_MUZZLE_SPEED,
    life: 1.8, by: hooks.mpLocalId()
  });

  const rig = ensureMuzzleRig();
  rig.visible = true;
  rig.position.copy(_akMuzzle);
  rig.lookAt(_akMuzzle.x + _akDir.x, _akMuzzle.y + _akDir.y, _akMuzzle.z + _akDir.z);
  const s = 0.75 + Math.random() * 0.55;
  rig.scale.set(s, s, s * (0.85 + Math.random() * 0.6));
  rig.rotation.z = Math.random() * Math.PI;
  muzzleLight.intensity = 9 + Math.random() * 5;
  muzzleTimer = 0.045;

  ejectBrass(_akMuzzle.x - _akDir.x * 0.55, _akMuzzle.y + 0.04, _akMuzzle.z - _akDir.z * 0.55, player.yaw);
  if (ak.burst % 6 === 0) spawnParticles(_akMuzzle.x, _akMuzzle.y, _akMuzzle.z, 0x9ca3af, 2, 1.4);

  ak.kick = Math.min(2.4, ak.kick + 0.62);
  ak.heat = Math.min(1, ak.heat + 0.11);
  ak.burst++;
  player.pitch = Math.min(1.35, player.pitch + (aiming ? 0.0032 : 0.0055));
  player.yaw += (Math.random() - 0.5) * (aiming ? 0.0022 : 0.0042);

  sfx.backfire();
  sfx.tone(1500 + Math.random() * 260, 130, 0.07, 'sawtooth', 0.05);

  hooks.mpWorldEvent({
    t: 'wiener', kind: 'bullet',
    x: _akMuzzle.x, y: _akMuzzle.y, z: _akMuzzle.z,
    vx: _akDir.x * AK47_MUZZLE_SPEED, vy: _akDir.y * AK47_MUZZLE_SPEED, vz: _akDir.z * AK47_MUZZLE_SPEED
  });
  if (hooks.updateHUD) hooks.updateHUD();
  return true;
}

function macheteCleave(w) {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const reach = w.reach, reach2 = reach * reach;
  const guest = hooks.mpIsGuest();
  let hits = 0;

  sfx.tone(2500, 780, 0.10, 'sawtooth', 0.030);

  const maxTargets = w.cleave || 3;
  for (let i = 0; i < npcs.length && hits < maxTargets; i++) {
    const npc = npcs[i];
    if (!npc.spawned || npc.asleep) continue;
    const dx = npc.x - player.x, dz = npc.z - player.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > reach2) continue;
    const npcY = Number.isFinite(npc.y) ? npc.y : (npc.mesh ? npc.mesh.position.y : 0.18);
    if (Math.abs(player.y - npcY) > 2.2) continue;
    const d = Math.sqrt(d2) || 0.001;
    if ((dx * fx + dz * fz) / d < 0.25) continue;
    const wasAwake = !npc.asleep;
    if (hooks.damageNpc) hooks.damageNpc(npc, w.damage, player.yaw);
    spawnParticles(npc.x, npcY + 1.05, npc.z, 0xb91c1c, 9, 6.0);
    spawnParticles(npc.x, npcY + 0.95, npc.z, 0xf8fafc, 3, 4.0);
    if (wasAwake && npc.asleep) pushFeed(`${npc.name} CLEAVED DOWN`, 'border-l-rose-500');
    hits++;
  }
  if (hits > 0) {
    sfx.hit();
    ak.kick = Math.min(2.0, ak.kick + 0.35);
  }

  for (let i = smashableCrates.length - 1; i >= 0; i--) {
    const c = smashableCrates[i];
    const dx = c.x - player.x, dz = c.z - player.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > reach2 || Math.abs(c.y - player.y) > 1.9) continue;
    const d = Math.sqrt(d2) || 0.001;
    if ((dx * fx + dz * fz) / d < 0.20) continue;
    spawnParticles(c.x, c.y + 0.55, c.z, 0xd97706, 12, 6.0);
    if (guest) { hooks.mpWorldEvent({ t: 'crate_hit', netId: c.netId, a: 999 }); continue; }
    sfx.smash();
    const lootRec = destroyCrate(c, true);
    hooks.mpWorldEvent({
      t: 'crate_dead', netId: c.netId, x: c.x, y: c.y, z: c.z,
      loot: lootRec ? { netId: lootRec.netId, type: lootRec.type, id: lootRec.id, x: lootRec.x, y: lootRec.y, z: lootRec.z } : null
    });
    hits++;
  }

  for (let i = hazardBarrels.length - 1; i >= 0; i--) {
    const b = hazardBarrels[i];
    const dx = b.x - player.x, dz = b.z - player.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > reach2 || Math.abs(b.y - player.y) > 1.9) continue;
    const d = Math.sqrt(d2) || 0.001;
    if ((dx * fx + dz * fz) / d < 0.20) continue;
    if (guest) { hooks.mpWorldEvent({ t: 'barrel_hit', netId: b.netId, a: 999 }); continue; }
    detonateBarrel(b);
    hits++;
  }

  for (const lp of lampPosts) {
    if (lp.state !== 'standing') continue;
    const dx = lp.x - player.x, dz = lp.z - player.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > reach2) continue;
    const d = Math.sqrt(d2) || 0.001;
    if ((dx * fx + dz * fz) / d < 0.30) continue;
    if (guest) hooks.mpWorldEvent({ t: 'lamp_hit', i: lampPosts.indexOf(lp), yaw: player.yaw, speed: 9 });
    else if (hooks.knockOverLamppost) hooks.knockOverLamppost(lp, player.yaw, 9);
    spawnParticles(lp.x, 1.3, lp.z, 0xe2e8f0, 8, 5.5);
    hits++;
  }

  if (hits > 1) pushFeed(`MACHETE CLEAVE ×${hits}`, 'border-l-emerald-400');
}

function detonateBarrel(b) {
  sfx.smash();
  spawnParticles(b.x, b.y + 0.6, b.z, 0xf97316, 18, 9.0);
  spawnParticles(b.x, b.y + 0.6, b.z, 0xfacc15, 10, 7.0);
  destroyBarrel(b);
  hooks.mpWorldEvent({ t: 'barrel_dead', netId: b.netId, x: b.x, y: b.y, z: b.z });
  const dx = player.x - b.x, dz = player.z - b.z;
  if (dx * dx + dz * dz < 17.64 && hooks.applyPlayerDamage) hooks.applyPlayerDamage(24, 'EXPLOSIVE BARREL');
  pushFeed('HAZARD BARREL DETONATED!', 'border-l-orange-500');
}

function meleePropStrike(w) {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const reach = w.reach, reach2 = reach * reach;
  const guest = hooks.mpIsGuest();
  for (const lp of lampPosts) {
    if (lp.state !== 'standing') continue;
    const dx = lp.x - player.x, dz = lp.z - player.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > reach2) continue;
    const d = Math.sqrt(d2) || 0.001;
    if ((dx * fx + dz * fz) / d < 0.45) continue;
    if (guest) hooks.mpWorldEvent({ t: 'lamp_hit', i: lampPosts.indexOf(lp), yaw: player.yaw, speed: 8 });
    else if (hooks.knockOverLamppost) hooks.knockOverLamppost(lp, player.yaw, 8);
    return;
  }
  for (let i = hazardBarrels.length - 1; i >= 0; i--) {
    const b = hazardBarrels[i];
    const dx = b.x - player.x, dz = b.z - player.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > reach2 || Math.abs(b.y - player.y) > 1.8) continue;
    const d = Math.sqrt(d2) || 0.001;
    if ((dx * fx + dz * fz) / d < 0.45) continue;
    if (guest) { hooks.mpWorldEvent({ t: 'barrel_hit', netId: b.netId, a: 999 }); return; }
    detonateBarrel(b);
    return;
  }
}

let arsenalAnnounced = false;
function ensureArsenal() {
  if (gameState.screen !== 'playing') return;
  let added = false;
  for (const id of ['machete', 'ak47']) {
    if (!gameState.rightWeapons.includes(id)) { gameState.rightWeapons.push(id); added = true; }
  }
  ensureAK47State();
  if (added && !arsenalAnnounced) {
    arsenalAnnounced = true;
    pushFeed('FIELD CACHE — AK-47 & MACHETE ADDED TO YOUR ARSENAL', 'border-l-amber-400');
    if (hooks.updateHUD) hooks.updateHUD();
  }
}

function stepWeaponSystems(dt) {
  bindAK47Keys();
  ensureArsenal();

  const w = RIGHT_WEAPONS[gameState.activeRightWeapon] || RIGHT_WEAPONS.fists;
  const blocked = gameState.screen !== 'playing' || gameState.inCar
    || gameState.inventoryOpen || gameState.mapOpen || gameState.settingsOpen
    || meteorDrop.active || player.mantle.active || climb.on;

  if (player.attackTimer <= 0) {
    player._cleaveApplied = false;
    player._propStrike = false;
  } else if (!blocked) {
    const progress = 1 - player.attackTimer / Math.max(0.001, player.attackDuration);
    if (w.id === 'machete') {
      if (!player._cleaveApplied && progress >= 0.30) {
        player._cleaveApplied = true;
        player._npcHit = true;
        player.hitApplied = true;
        macheteCleave(w);
      }
    } else if (!w.isRanged && !player._propStrike && progress >= 0.42) {
      player._propStrike = true;
      meleePropStrike(w);
    }
  }

  const wasEquipped = ak.equipped;
  ak.equipped = w.id === 'ak47';
  if (ak.equipped !== wasEquipped) {
    ak.reload = 0;
    ak.cooldown = 0;
    ak.heat = 0;
    ak.burst = 0;
    ak.kick = 0;
    ak.fov = camera.fov;
    ak.dryWarned = false;
    ak.emptyWarned = false;
    if (ak.equipped) ensureAK47State();
  }

  if (ak.cooldown > 0) ak.cooldown = Math.max(0, ak.cooldown - dt);
  ak.heat = Math.max(0, ak.heat - dt * 1.35);
  ak.kick *= Math.exp(-dt * 9);

  if (ak.equipped) {
    ensureAK47State();
    if (ak.reload > 0) {
      ak.reload -= dt;
      if (ak.reload <= 0) { ak.reload = 0; finishAK47Reload(); }
    } else if (!blocked && inputState.isPrimaryFireHeld) {
      if (gameState.ak47Ammo <= 0) {
        if (!startAK47Reload() && !ak.emptyWarned) {
          ak.emptyWarned = true;
          sfx.uiClick();
          pushFeed('AK-47 DRY — [R] RELOAD', 'border-l-rose-500');
        }
      } else if (ak.cooldown <= 0) {
        if (fireAK47Round()) ak.cooldown = w.cooldown;
      }
    }
    if (!inputState.isPrimaryFireHeld) ak.burst = 0;

    if (!gameState.inCar && !meteorDrop.active) {
      const wantFov = gameState.isAiming ? 46 : 72;
      ak.fov += (wantFov - ak.fov) * Math.min(1, dt * 12);
      if (Math.abs(camera.fov - ak.fov) > 0.01) {
        camera.fov = ak.fov;
        camera.updateProjectionMatrix();
      }
      ak.fovActive = true;
    }
    if (ak.kick > 0.002) {
      camera.rotation.x += ak.kick * 0.016;
      camera.rotation.z += (Math.random() - 0.5) * ak.kick * 0.008;
    }
  } else if (ak.fovActive) {
    ak.fovActive = false;
    ak.fov = 72;
  }

  if (muzzleTimer > 0) {
    muzzleTimer -= dt;
    if (muzzleLight) muzzleLight.intensity *= Math.max(0, 1 - dt * 22);
    if (muzzleTimer <= 0) {
      if (muzzleRig) muzzleRig.visible = false;
      if (muzzleLight) muzzleLight.intensity = 0;
    }
  }
  stepBrass(dt);
  updateAkHud();
}

export function fireBallisticWiener() {
  if (gameState.hotdogAmmo <= 0) {
    sfx.uiClick();
    pushFeed('OUT OF SAUSAGES! REFILL AT AURA HOTDOGS OR PLAZA CART', 'border-l-rose-500');
    return;
  }
  gameState.hotdogAmmo--;
  sfx.wienerShot();
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  const muzzlePos = new THREE.Vector3();
  if (gameState.thirdPerson || gameState.isAiming) {
    muzzlePos.set(player.x, player.y + 1.48, player.z).addScaledVector(dir, 0.9);
  } else {
    hooks.getRightMountWorldPosition(muzzlePos);
    muzzlePos.addScaledVector(dir, 0.45);
  }
  const wGroup = makeWienerMesh();
  wGroup.position.copy(muzzlePos);
  worldRoot.add(wGroup);
  const launchSpeed = gameState.isAiming ? 68.0 : 54.0;
  const vx = dir.x * launchSpeed;
  const vy = dir.y * launchSpeed + 2.8;
  const vz = dir.z * launchSpeed;
  projectileWieners.push({
    mesh: wGroup, kind: 'wiener',
    x: muzzlePos.x, y: muzzlePos.y, z: muzzlePos.z,
    vx, vy, vz, life: 3.2, by: hooks.mpLocalId()
  });
  hooks.mpWorldEvent({ t: 'wiener', x: muzzlePos.x, y: muzzlePos.y, z: muzzlePos.z, vx, vy, vz });
  hooks.updateHUD();
}

export function updateProjectileWieners(dt) {
  stepWeaponSystems(dt);

  const authority = !hooks.mpIsGuest();          
  const akDamage = RIGHT_WEAPONS.ak47.damage;

  for (let i = projectileWieners.length - 1; i >= 0; i--) {
    const w = projectileWieners[i];
    const bullet = w.kind === 'bullet';
    const gravity = bullet ? 9.2 : 15.8;
    w.life -= dt;
    w.vy -= gravity * dt;
    w.x += w.vx * dt;
    w.y += w.vy * dt;
    w.z += w.vz * dt;
    w.mesh.position.set(w.x, w.y, w.z);
    w.mesh.lookAt(w.x + w.vx, w.y + w.vy, w.z + w.vz);

    let impacted = false;

    for (let n = 0; n < npcs.length; n++) {
      const npc = npcs[n];
      if (!npc.spawned || npc.asleep) continue;
      const dx = w.x - npc.x, dz = w.z - npc.z;
      if (dx * dx + dz * dz >= 0.5184) continue;
      const npcY = Number.isFinite(npc.y) ? npc.y : (npc.mesh ? npc.mesh.position.y : 0.18);
      if (w.y < npcY || w.y > npcY + 1.95) continue;
      if (authority) {
        const wasAwake = !npc.asleep;
        hooks.damageNpc(npc, bullet ? akDamage : 48, Math.atan2(w.vx, w.vz));
        if (bullet) {
          if (wasAwake && npc.asleep) pushFeed(`${npc.name} DOWN — AK-47`, 'border-l-amber-400');
        } else if (!npc.asleep) {
          pushFeed(`WIENER HIT ${npc.name}!`, 'border-l-amber-400');
        }
      }
      if (bullet) {
        spawnParticles(w.x, w.y, w.z, 0xb91c1c, 6, 5.0);
        spawnParticles(w.x, w.y, w.z, 0xf8fafc, 2, 3.2);
        sfx.tone(320, 140, 0.05, 'square', 0.03);
      } else {
        sfx.wienerSplat();
        spawnParticles(w.x, w.y, w.z, 0xb91c1c, 8, 5.5);
        spawnParticles(w.x, w.y, w.z, 0xfacc15, 5, 4.5);
      }
      impacted = true;
      break;
    }

    if (!impacted) {
      for (let c = smashableCrates.length - 1; c >= 0; c--) {
        const cr = smashableCrates[c];
        if (Math.abs(w.x - cr.x) >= 0.72 || Math.abs(w.z - cr.z) >= 0.72) continue;
        if (w.y < cr.y || w.y > cr.y + 1.15) continue;
        if (authority) {
          if (bullet) {
            cr.hp -= akDamage;
            spawnParticles(w.x, w.y, w.z, 0xd97706, 5, 4.5);
            sfx.tone(520, 200, 0.04, 'square', 0.025);
            if (cr.hp <= 0) {
              sfx.smash();
              spawnParticles(cr.x, cr.y + 0.55, cr.z, 0x92400e, 12, 6.5);
              const lootRec = destroyCrate(cr, true);
              hooks.mpWorldEvent({
                t: 'crate_dead', netId: cr.netId, x: cr.x, y: cr.y, z: cr.z,
                loot: lootRec ? { netId: lootRec.netId, type: lootRec.type, id: lootRec.id, x: lootRec.x, y: lootRec.y, z: lootRec.z } : null
              });
            }
          } else {
            sfx.smash();
            spawnParticles(cr.x, cr.y + 0.55, cr.z, 0xd97706, 12, 6.5);
            const lootRec = destroyCrate(cr, true);
            hooks.mpWorldEvent({
              t: 'crate_dead', netId: cr.netId, x: cr.x, y: cr.y, z: cr.z,
              loot: lootRec ? { netId: lootRec.netId, type: lootRec.type, id: lootRec.id, x: lootRec.x, y: lootRec.y, z: lootRec.z } : null
            });
            pushFeed('CRATE SMASHED BY WIENER!', 'border-l-amber-400');
          }
        } else {
          hooks.mpWorldEvent({ t: 'crate_hit', netId: cr.netId, a: bullet ? akDamage : 999 });
          spawnParticles(w.x, w.y, w.z, 0xd97706, 6, 4.5);
        }
        impacted = true;
        break;
      }
    }

    if (!impacted) {
      for (let b = hazardBarrels.length - 1; b >= 0; b--) {
        const br = hazardBarrels[b];
        const dx = w.x - br.x, dz = w.z - br.z;
        if (dx * dx + dz * dz >= 0.4225) continue;
        if (w.y < br.y || w.y > br.y + 1.25) continue;
        if (authority) {
          if (bullet) {
            br.hp -= akDamage;
            spawnParticles(w.x, w.y, w.z, 0xfbbf24, 5, 5.0);
            if (br.hp <= 0) detonateBarrel(br);
          } else {
            detonateBarrel(br);
          }
        } else {
          hooks.mpWorldEvent({ t: 'barrel_hit', netId: br.netId, a: bullet ? akDamage : 999 });
          spawnParticles(w.x, w.y, w.z, 0xf97316, 8, 5);
        }
        impacted = true;
        break;
      }
    }

    if (!impacted) {
      for (const lp of lampPosts) {
        if (lp.state !== 'standing') continue;
        const dx = w.x - lp.x, dz = w.z - lp.z;
        if (dx * dx + dz * dz >= 0.2025) continue;
        const lpY = lp.pivot ? lp.pivot.position.y : 0.18;
        if (w.y < lpY || w.y > lpY + 4.42) continue;
        if (authority) hooks.knockOverLamppost(lp, Math.atan2(w.vx, w.vz), 8.5);
        else hooks.mpWorldEvent({ t: 'lamp_hit', i: lampPosts.indexOf(lp), yaw: Math.atan2(w.vx, w.vz), speed: 8.5 });
        if (bullet) spawnParticles(w.x, w.y, w.z, 0xfbbf24, 5, 5.5);
        impacted = true;
        break;
      }
    }

    if (!impacted && authority) {
      for (const t of hooks.mpTargets()) {
        if (t.inCar) continue;
        const dx = w.x - t.x, dz = w.z - t.z;
        if (dx * dx + dz * dz >= 0.5625) continue;
        if (w.y < t.y || w.y > t.y + 1.95) continue;
        hooks.mpHitPlayer(t.id, bullet ? akDamage : 48, bullet ? 'AK-47 FIRE' : 'WIENER STRIKE');
        if (bullet) spawnParticles(w.x, w.y, w.z, 0xb91c1c, 6, 5.0);
        else { sfx.wienerSplat(); spawnParticles(w.x, w.y, w.z, 0xb91c1c, 8, 5.5); }
        impacted = true;
        break;
      }
    }

    if (!impacted) {
      if (w.y <= 0.18) {
        impacted = true;
        if (bullet) {
          spawnParticles(w.x, 0.22, w.z, 0xfbbf24, 4, 4.0);
          spawnParticles(w.x, 0.22, w.z, 0x9ca3af, 3, 2.6);
          sfx.tone(700, 220, 0.04, 'square', 0.02);
        } else {
          sfx.wienerSplat();
          spawnParticles(w.x, 0.24, w.z, 0xb91c1c, 6, 4.2);
          spawnParticles(w.x, 0.24, w.z, 0xfacc15, 4, 3.5);
        }
      } else {
        for (let k = 0; k < worldBoxes.length; k++) {
          const wb = worldBoxes[k];
          if (w.x < wb.minX || w.x > wb.maxX || w.z < wb.minZ || w.z > wb.maxZ || w.y < wb.minY || w.y > wb.maxY) continue;
          impacted = true;
          if (bullet) {
            spawnParticles(w.x, w.y, w.z, 0xfbbf24, 5, 5.5);
            spawnParticles(w.x, w.y, w.z, 0x9ca3af, 3, 2.4);
            sfx.tone(900, 260, 0.035, 'square', 0.022);
          } else {
            sfx.wienerSplat();
            spawnParticles(w.x, w.y, w.z, 0xb91c1c, 6, 4.2);
            spawnParticles(w.x, w.y, w.z, 0xfacc15, 4, 3.5);
          }
          break;
        }
      }
    }

    if (impacted || w.life <= 0) {
      worldRoot.remove(w.mesh);
      freeGeo(w.mesh);
      projectileWieners.splice(i, 1);
    }
  }
}

export function useLeftHandItem(slotIndex = gameState.activeLeftSlot) {
  const slot = gameState.leftHotbar[slotIndex];
  if (!slot) return;
  const item = LEFT_ITEMS[slot.id];
  if (!item) return;
  player.leftUseTimer = 0.32;
  if (item.id === 'flashlight') {
    gameState.flashlightOn = !gameState.flashlightOn;
    sfx.uiClick();
    hooks.syncEquippedMeshes();
    pushFeed(`FLASHLIGHT ${gameState.flashlightOn ? 'ON' : 'OFF'}`, 'border-l-yellow-400');
    return;
  }
  if (item.id === 'medkit') {
    if (gameState.hp >= gameState.maxHp) {
      pushFeed('HEALTH ALREADY FULL', 'border-l-slate-400');
      return;
    }
    gameState.hp = Math.min(gameState.maxHp, gameState.hp + 40);
    sfx.heal();
    flashEdge('rgba(16, 185, 129, 0.35)');
    pushFeed('USED MEDKIT (+40 HEALTH)', 'border-l-emerald-400');
  } else if (item.id === 'soda') {
    gameState.stamina = Math.min(100, gameState.stamina + 65);
    gameState.speedBoostTimer = 7.5;
    sfx.heal();
    flashEdge('rgba(56, 189, 248, 0.35)');
    pushFeed('DRANK ENERGY DRINK (+STAMINA & SPEED)', 'border-l-sky-400');
  } else if (item.id === 'burger') {
    gameState.hp = Math.min(gameState.maxHp, gameState.hp + 20);
    gameState.stamina = Math.min(100, gameState.stamina + 20);
    sfx.heal();
    flashEdge('rgba(245, 158, 11, 0.32)');
    pushFeed('ATE STREET BURGER (+20 HP / +20 STAM)', 'border-l-amber-400');
  } else if (item.id === 'cash') {
    gameState.cash += 100;
    sfx.pickup();
    flashEdge('rgba(16, 185, 129, 0.32)');
    pushFeed('DEPOSITED +$100 CASH', 'border-l-emerald-400');
  }
  slot.count -= 1;
  if (slot.count <= 0) {
    gameState.leftHotbar[slotIndex] = null;
  }
  hooks.syncEquippedMeshes();
  hooks.updateHUD();
  if (gameState.inventoryOpen) hooks.renderInventoryModal();
}

export function addLeftItemToBag(id, qty = 1) {
  for (let i = 0; i < 5; i++) {
    if (gameState.leftHotbar[i] && gameState.leftHotbar[i].id === id) {
      gameState.leftHotbar[i].count += qty;
      return true;
    }
  }
  for (let i = 0; i < 5; i++) {
    if (!gameState.leftHotbar[i]) {
      gameState.leftHotbar[i] = { id, count: qty };
      return true;
    }
  }
  return false;
}

export function dropLeftSlot(slotIndex) {
  const slot = gameState.leftHotbar[slotIndex];
  if (!slot) return;
  const fwdX = -Math.sin(player.yaw);
  const fwdZ = -Math.cos(player.yaw);
  const dx = player.x + fwdX * 1.4, dz = player.z + fwdZ * 1.4;
  if (hooks.mpIsGuest()) {
    hooks.mpWorldEvent({ t: 'pickup_drop', type: 'left', id: slot.id, x: dx, y: player.y, z: dz });
  } else {
    const rec = spawnWorldPickup('left', slot.id, dx, player.y, dz);
    hooks.mpWorldEvent({ t: 'pickup_spawn', netId: rec.netId, type: 'left', id: slot.id, x: dx, y: player.y, z: dz });
  }
  slot.count -= 1;
  if (slot.count <= 0) gameState.leftHotbar[slotIndex] = null;
  sfx.uiClick();
  hooks.syncEquippedMeshes();
  hooks.updateHUD();
  if (gameState.inventoryOpen) hooks.renderInventoryModal();
}

export function buildCrateMesh() {
  const holder = new THREE.Group();
  const mesh = new THREE.Mesh(boxGeo(1.05, 1.05, 1.05), crateMat);
  mesh.position.y = 0.525;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  holder.add(mesh);
  return holder;
}

export function buildBarrelMesh() {
  const holder = new THREE.Group();
  const mesh = new THREE.Mesh(cylGeo(0.42, 0.42, 1.15, 10), barrelMat);
  mesh.position.y = 0.575;
  mesh.castShadow = true;
  holder.add(mesh);
  return holder;
}