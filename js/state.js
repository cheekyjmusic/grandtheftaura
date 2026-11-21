// =============================================================================
// state.js — Shared game state, player state, input state, collision registries, terrain/collision math and the `hooks` registry.
// =============================================================================

export const noop = () => {};

/**
 * Late-bound callbacks that let LOWER layers call into HIGHER layers without importing them
 * (keeps the import graph strictly top-down / acyclic). Each higher module registers its
 * implementation at the bottom of its own file with Object.assign(hooks, {...}).
 */
export const hooks = {
  syncEquippedMeshes: noop,
  applyPlayerDamage: noop,
  updateHUD: noop,
  cycleRightWeapon: noop,
  setScreen: noop,
  openInventoryModal: noop,
  closeInventoryModal: noop,
  renderInventoryModal: noop,
  closeSettingsModal: noop,
  openMapModal: noop,
  closeMapModal: noop,
  syncMobileControls: noop,
  persistMobilePreference: noop,
  decorateNpc: noop,
  drawMapOverlay: noop,
  drawAircraftMapOverlay: noop,
  setAircraftScreen: noop,
  onVehicleEnter: noop,
  damageNpc: noop,
  knockOverLamppost: noop,
  getRightMountWorldPosition: noop,
};

/** Axis-aligned footprint of an upright box/cylinder (half extents) after the object's yaw + scale. */
export function uprightFootprint(obj, halfX, halfZ, height) {
  const sx = Math.abs(obj.scale.x), sy = Math.abs(obj.scale.y), sz = Math.abs(obj.scale.z);
  const c = Math.abs(Math.cos(obj.rotation.y)), s = Math.abs(Math.sin(obj.rotation.y));
  const hx = halfX * sx, hz = halfZ * sz;
  const wx = c * hx + s * hz, wz = s * hx + c * hz;
  return { minX: obj.position.x - wx, maxX: obj.position.x + wx, minZ: obj.position.z - wz, maxZ: obj.position.z + wz, height: height * sy };
}

export const MAX_HOTDOG_AMMO = 60;

export const gameState = {
  screen: 'start', // 'start' | 'playing' | 'paused'
  inventoryOpen: false,
  mapOpen: false,
  settingsOpen: false,
  thirdPerson: false,
  isAiming: false,
  hp: 100,
  maxHp: 100,
  stamina: 100,
  speedBoostTimer: 0,
  cash: 150,
  hotdogAmmo: MAX_HOTDOG_AMMO,
  rightWeapons: ['fists', 'bat'],
  activeRightWeapon: 'fists',
  leftHotbar: [
    { id: 'medkit', count: 1 },
    { id: 'flashlight', count: 1 },
    { id: 'soda', count: 1 },
    null,
    null
  ],
  activeLeftSlot: 0,
  inspectedLeftSlot: 0,
  flashlightOn: false,
  inCar: false,
  activeCarIndex: -1,
  zoneName: 'CENTRAL PLAZA',
  damageCooldown: 0,
  wheelTimer: 0,
  dialogueTimer: 0,
  settings: {
    sensitivity: 1.0,
    graphics: 'medium',
    sfx: true,
    mobileControls: false
  }
};

export const player = {
  x: -11.5,
  y: 0.18,
  z: 18.5,
  vy: 0,
  radius: 0.42,
  height: 1.75,
  eyeHeight: 1.62,
  crouching: false,
  yaw: 0.22,
  pitch: -0.02,
  grounded: true,
  peakAirY: 0.18,
  landingDip: 0,
  sprintCycle: 0,
  walkCycle: 0,
  punchCombo: 0,
  attackTimer: 0,
  attackDuration: 0.28,
  hitApplied: false,
  leftUseTimer: 0,
  mantle: {
    active: false,
    timer: 0,
    duration: 0.26,
    startX: 0, startY: 0, startZ: 0,
    endX: 0, endY: 0, endZ: 0
  }
};

export const meteorDrop = {
  active: false,
  timer: 0,
  maxDuration: 6.5,
  x: -12,
  y: 148,
  z: -18,
  vx: 0,
  vy: -34,
  vz: 0,
  cameraShake: 0,
  craterMesh: null,
  shockwaveMesh: null,
  shockwaveLife: 0
};

export const worldBoxes = [];

export const driveableRamps = [];

export const mapShapes = [];

export const enterableZones = [];

export const smashableCrates = [];

export const hazardBarrels = [];

export const worldPickups = [];

export const particleBursts = [];

export const projectileWieners = [];

export const lampPosts = [];

export const aviationBeacons = [];

export const npcs = [];

export const buildingLods = [];

export const skyscrapers = [];

export const sausageRefillZones = [];

export function addWorldBox(minX, maxX, minY, maxY, minZ, maxZ, tag = 'solid', climbable = true) {
  const box = { minX, maxX, minY, maxY, minZ, maxZ, tag, climbable };
  worldBoxes.push(box);
  return box;
}

export function addDriveableRamp({ minX, maxX, minZ, maxZ, startY, endY, axis = 'z', dir = 1 }) {
  driveableRamps.push({ minX, maxX, minZ, maxZ, startY, endY, axis, dir });
}

export function registerBuildingLod(x, z, lodGroup) {
  lodGroup.visible = false;
  buildingLods.push({ x, z, group: lodGroup, active: false });
}

export function flashEdge(cssColor) {
  const el = document.getElementById('screen-flash');
  if (!el) return;
  el.style.background = `radial-gradient(circle, transparent 52%, ${cssColor} 100%)`;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 190);
}

export function pushFeed(text, borderClass = 'border-l-amber-400') {
  const container = document.getElementById('feed-container');
  if (!container) return;
  const div = document.createElement('div');
  div.className = `toast-item glass-panel px-3 py-1 text-[11px] font-tactical font-bold uppercase text-white border-l-2 ${borderClass}`;
  div.textContent = text;
  container.appendChild(div);
  while (container.children.length > 4) container.removeChild(container.firstChild);
  setTimeout(() => { if (div.parentNode) div.remove(); }, 2000);
}

export const keys = {};

export const inputState = { isDraggingLook: false, isPrimaryFireHeld: false, lastMouseX: 0, lastMouseY: 0 };

export const WORLD_BOUNDS = Object.freeze({ minX: -556, maxX: 498, minZ: -585, maxZ: 208 });

export function computeSupportFloor(x, z, footY, radius) {
  if (footY < -1.0) return sewerFloor(x, z);
  let highest = x >= 368 ? 0.18 : (x >= 164 ? 0.02 : 0.18);
  if (z < -170 || x < -196) highest = Math.max(highest, terrainH(x, z));

  for (let r = 0; r < driveableRamps.length; r++) {
    const rm = driveableRamps[r];
    if (x + radius > rm.minX && x - radius < rm.maxX && z + radius > rm.minZ && z - radius < rm.maxZ) {
      const t = rm.axis === 'z'
        ? Math.max(0, Math.min(1, (z - rm.minZ) / (rm.maxZ - rm.minZ)))
        : Math.max(0, Math.min(1, (x - rm.minX) / (rm.maxX - rm.minX)));
      const ry = rm.startY + (rm.endY - rm.startY) * t;
      if (ry <= footY + 0.85 && ry > highest) {
        highest = ry;
      }
    }
  }

  for (let i = 0; i < worldBoxes.length; i++) {
    const b = worldBoxes[i];
    if (x + radius > b.minX && x - radius < b.maxX && z + radius > b.minZ && z - radius < b.maxZ) {
      if (b.maxY <= footY + 0.46 && b.maxY > highest) {
        highest = b.maxY;
      }
    }
  }
  return highest;
}

export function collidesHorizontally(nx, nz, footY, bodyH, radius) {
  if (nx < WORLD_BOUNDS.minX + radius || (nx < -196 && (nz < -170 + radius || nz > 170 - radius)) || nx > WORLD_BOUNDS.maxX - radius || nz < WORLD_BOUNDS.minZ + radius || nz > WORLD_BOUNDS.maxZ - radius) return true;
  if (footY < -1.0 && !sewerOK(nx, nz, radius)) return true;
  if (footY > -0.5) { const th = terrainH(nx, nz); if (th > -90 && th - footY > 1.0) return true; }
  for (let i = 0; i < worldBoxes.length; i++) {
    const b = worldBoxes[i];
    if (b.maxY <= footY + 0.42 || b.minY >= footY + bodyH - 0.08) continue;
    if (nx + radius > b.minX && nx - radius < b.maxX && nz + radius > b.minZ && nz - radius < b.maxZ) {
      return true;
    }
  }
  return false;
}

export let _seed = 1337;

export const rnd = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; };

export const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

export const waterZones = [];

export const iceZones = [];

export function biomeAt(x, z) {
  if (z >= 110 && x > -136 && x < 138) return x < -52 ? 'alpine' : (x < 28 ? 'woods' : 'cove');
  return 'city';
}

export function isInWater(x, z) {
  for (const w of waterZones) if (x > w.minX && x < w.maxX && z > w.minZ && z < w.maxZ) return true;
  return false;
}

export function surfaceGrip(x, z) {
  for (const ic of iceZones) if (Math.hypot(x - ic.x, z - ic.z) < ic.r) return 1.5;
  if (isInWater(x, z)) return 7;
  const b = biomeAt(x, z);
  if (b === 'alpine') return Math.abs(x + 96) < 6 ? 11 : 3.6;
  if (b === 'cove') return Math.abs(x - 72) < 6 ? 14 : 10;
  return 14;
}

// ======================= AURA OVERHAUL MODULE =======================
// Mountains + winding road, sewer cave, police + wanted system, suspension, UI
export function sstep(a,b,x){const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);}

export function hsh(i,j){const s=Math.sin(i*127.1+j*311.7)*43758.5453;return s-Math.floor(s);}

export function vnoise(x,z){const i=Math.floor(x),j=Math.floor(z),fx=x-i,fz=z-j,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);return hsh(i,j)*(1-u)*(1-v)+hsh(i+1,j)*u*(1-v)+hsh(i,j+1)*(1-u)*v+hsh(i+1,j+1)*u*v;}

export function fbm(x,z,o){let a=.5,f=1,s=0;for(let k=0;k<(o||5);k++){s+=a*vnoise(x*f,z*f);f*=2.03;a*=.5;}return s;}

export function ridge(x,z,o){let a=.5,f=1,s=0;for(let k=0;k<(o||5);k++){s+=a*(1-Math.abs(vnoise(x*f,z*f)*2-1));f*=2.1;a*=.5;}return s;}

export function roadC(z){const t=-170-z;return 116+64*Math.sin(t*0.019)+24*Math.sin(t*0.052+1);}

export function roadH(z){return 0.2+Math.min(82,(-170-z)*0.16);}

export const AHC={px:-480,pz:-45};

export const CAR_PTS=[[2.2,0],[2.1,.9],[2.1,-.9],[0,.95],[0,-.95],[-2.1,.9],[-2.1,-.9],[-2.2,0]];

export const ahRz=x=>45*Math.sin(Math.min(-196-x,236)*.02), ahRzD=x=>(-196-x)<236?.9*Math.cos((-196-x)*.02):0, ahRy=x=>38*sstep(0,230,-196-x);

export const AIRFIELD = Object.freeze({ y: 38, rx0: -355, rx1: -208, rz: -106, rh: 13, hx0: -407, hx1: -356, hz0: -129, hz1: -83, hangerX0: -406.5, hangerX1: -356.5, hangerZ0: -129, hangerZ1: -83 });

function distanceToRect(x, z, x0, x1, z0, z1) {
  return Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
}

function airfieldMask(x, z) {
  const runway = 1 - sstep(0, 11, distanceToRect(x, z, AIRFIELD.rx0, AIRFIELD.rx1, AIRFIELD.rz - AIRFIELD.rh, AIRFIELD.rz + AIRFIELD.rh));
  const hangar = 1 - sstep(0, 6, distanceToRect(x, z, AIRFIELD.hx0, AIRFIELD.hx1, AIRFIELD.hz0, AIRFIELD.hz1));
  return Math.max(runway, hangar);
}

export function hillsH(x,z){
  const env=sstep(0,110,-196-x), hm=env*(6+fbm(x*.007+20,z*.007,4)*85+fbm(x*.03,z*.03,3)*7);
  const pl=1-sstep(70,118,Math.hypot(x-AHC.px,z-AHC.pz));let h=hm*(1-pl)+38*pl;
  const s=-196-x;if(s>=0&&s<300){const w=sstep(7,28,Math.abs(z-ahRz(x))/Math.hypot(1,ahRzD(x)));h=ahRy(x)*(1-w)+h*w;}
  const townEdge=Math.hypot(Math.max(Math.abs(x+285)-62,0),Math.max(Math.abs(z)-94,0));
  const town=1-sstep(0,34,townEdge),townRoad=sstep(13,25,Math.abs(z-ahRz(x))/Math.hypot(1,ahRzD(x))),townBlend=town*townRoad;
  if(townBlend>0)h=h*(1-townBlend)+(ahRy(x)+9)*townBlend;
  const field=airfieldMask(x,z);
  if(field>0)h=h*(1-field)+AIRFIELD.y*field;
  return h;
}

export function riverX(z){return roadC(z)-72+14*Math.sin(z*.04);}

export function terrainH(x,z){
  if(x<-196&&x>-560&&z>-172&&z<172) return hillsH(x,z);
  if(z>-170) return -99;
  const t=-170-z, env=sstep(0,120,t);
  const wx=x+(fbm(x*.006+9,z*.006)-.5)*90, wz=z+(fbm(x*.006,z*.006+4)-.5)*90;
  const rise=.3+.7*sstep(30,320,t);
  const mass=fbm(wx*.0042,wz*.0042,4), pk=Math.pow(fbm(wx*.0036+3,wz*.0036,5),3);
  let m=env*(8+(mass*mass*60+pk*300)*rise+fbm(x*.025,z*.025,4)*9+ridge(x*.018,z*.018,3)*8*sstep(40,120,t));
  m=Math.max(m,roadH(z)*.85);
  const w=sstep(8,64,Math.abs(x-roadC(z)));
  const hh=roadH(z)*(1-w)+(0.2+m)*w, cv=5*(1-sstep(3,18,Math.abs(x-riverX(z))))*sstep(20,120,t);
  return cv>0.01?Math.max(.3,hh-cv):hh;
}

export const SCX=20,SCZ=-30,SFY=-9;

export function sewerFloor(){return SFY;}

// ---- Sewer network: real tunnels beneath the city streets (no teleport) ----
export const manholes=[[-4,24],[48,-16],[-40,-30],[20,-66]];

export const sewerLights=[], manholeCovers=[], manholeOpen=[], manholeHoles=[], sRects=[];

export const aura = { ahCull: null, ahF: null, ahHint: null, hospitalSpawn: null, culls: [] };

export function sewerOK(x,z,r){for(let i=0;i<sRects.length;i++){const q=sRects[i];if(x>=q[0]+r&&x<=q[1]-r&&z>=q[2]+r&&z<=q[3]-r)return true;}return false;}

export const under=()=>player.y<-1.2;

export const climb={on:false,dir:0,t:0,i:0};

// ---- Police & wanted level ----
export const AO={heat:0,calm:0,cops:[],cars:[],spawnT:0,shotT:0,lastAtk:0};

export const stars=()=>Math.min(5,Math.ceil(AO.heat-.001));

export function crime(a){if(under())return;const s0=stars();AO.heat=Math.min(5,AO.heat+a);AO.calm=0;if(stars()>s0)pushFeed('WANTED LEVEL '+stars()+' — POLICE DISPATCHED','border-l-blue-500');}