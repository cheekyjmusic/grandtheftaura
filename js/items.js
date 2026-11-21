// =============================================================================
// items.js — Right-hand weapons, left-hand items, 3D weapon/item mesh builders, projectiles, crates, barrels and pickups.
// =============================================================================
import * as THREE from 'three';
import { addWorldBox, flashEdge, gameState, hazardBarrels, hooks, lampPosts, npcs, particleBursts, player, projectileWieners, pushFeed, smashableCrates, uprightFootprint, worldBoxes, worldPickups } from './state.js';
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
  const mat = partMats[colorHex] || (partMats[colorHex] = new THREE.MeshBasicMaterial({ color: colorHex }));
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

export function buildPickupMesh(type, id) {
  const g = new THREE.Group();

  let color = 0xf59e0b;
  let mesh;
  if (type === 'right') {
    if (id === 'bat') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.032, 0.9, 8), makeMat(0xd97706, { texType: 'wood' }));
      mesh.rotation.z = 0.5;
      color = 0xd97706;
    } else if (id === 'crowbar') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 0.08), makeMat(0xef4444, { metalness: 0.85 }));
      mesh.rotation.z = 0.45;
      color = 0xef4444;
    } else if (id === 'pipe') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.85, 8), makeMat(0x94a3b8, { texType: 'brushedsteel', metalness: 0.9 }));
      mesh.rotation.z = 0.45;
      color = 0x94a3b8;
    } else if (id === 'hotdog_shooter') {
      const hdGun = new THREE.Group();
      const bunBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.52, 6, 8), makeMat(0xd97706));
      bunBody.rotation.x = Math.PI / 2;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.65, 10), makeMat(0xdc2626, { metalness: 0.7 }));
      barrel.rotation.x = Math.PI / 2;
      barrel.position.y = 0.06;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), makeMat(0xb91c1c));
      tip.position.set(0, 0.06, 0.34);
      hdGun.add(bunBody, barrel, tip);
      mesh = hdGun;
      color = 0xfacc15;
    }
  } else {
    const itemDef = LEFT_ITEMS[id] || LEFT_ITEMS.cash;
    color = new THREE.Color(itemDef.color).getHex();
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.28, 0.32),
      makeMat(color, { emissive: color, emissiveIntensity: 0.3 })
    );
  }

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.58, 16),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.50;

  g.add(mesh, ring);
  g.userData.pickupColor = color;
  return g;
}

export function spawnWorldPickup(type, id, x, y, z, opts = {}) {
  const g = buildPickupMesh(type, id);
  g.position.set(x, y + 0.55, z);
  if (opts.rot) g.rotation.set(opts.rot[0], opts.rot[1], opts.rot[2]);
  if (opts.scale) g.scale.set(opts.scale[0], opts.scale[1], opts.scale[2]);
  if (opts.decorate) opts.decorate(g);
  worldRoot.add(g);
  const rec = { type, id, x, y, z, group: g, baseY: y + 0.55, phase: Math.random() * 6 };
  worldPickups.push(rec);
  return rec;
}

// Smashable wooden crate. pos = floor point under the crate; rot/scale optional (Studio entities).
export function spawnSmashCrate(x, y, z, loot = null, opts = {}) {
  const holder = new THREE.Group();
  holder.position.set(x, y, z);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.05, 1.05), crateMat);
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
  const rec = { x, y, z, hp: 35, mesh: holder, box, loot };
  smashableCrates.push(rec);
  return rec;
}

// Explosive hazard barrel. Same pos/rot/scale convention as crates.
export function spawnHazardBarrel(x, y, z, opts = {}) {
  const holder = new THREE.Group();
  holder.position.set(x, y, z);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.15, 10), barrelMat);
  mesh.position.y = 0.575;
  mesh.castShadow = true;
  holder.add(mesh);
  if (opts.rot) holder.rotation.set(opts.rot[0], opts.rot[1], opts.rot[2]);
  if (opts.scale) holder.scale.set(opts.scale[0], opts.scale[1], opts.scale[2]);
  if (opts.decorate) opts.decorate(holder);
  worldRoot.add(holder);
  const b = uprightFootprint(holder, 0.44, 0.44, 1.15);
  const box = addWorldBox(b.minX, b.maxX, y, y + b.height, b.minZ, b.maxZ, 'barrel', true);
  const rec = { x, y, z, hp: 30, mesh: holder, box };
  hazardBarrels.push(rec);
  return rec;
}

export function buildRightWeaponMesh(id) {
  const g = new THREE.Group();
  if (id === 'bat') {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.032, 0.24, 8), makeMat(0x1e293b));
    handle.position.y = 0.08;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.026, 0.56, 8), makeMat(0xd97706, { texType: 'wood' }));
    barrel.position.y = 0.46;
    g.add(handle, barrel);
    g.rotation.x = -0.32;
  } else if (id === 'crowbar') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.64, 6), makeMat(0xb91c1c, { metalness: 0.85 }));
    shaft.position.y = 0.28;
    const hook = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.18), makeMat(0xdbeafe, { metalness: 0.9 }));
    hook.position.set(0, 0.60, -0.07);
    g.add(shaft, hook);
    g.rotation.x = -0.32;
  } else if (id === 'pipe') {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.66, 8), makeMat(0x94a3b8, { texType: 'brushedsteel', metalness: 0.92 }));
    pipe.position.y = 0.30;
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.08, 8), makeMat(0x475569, { metalness: 0.9 }));
    flange.position.y = 0.60;
    g.add(pipe, flange);
    g.rotation.x = -0.32;
  } else if (id === 'hotdog_shooter') {
    const bunMat = makeMat(0xd97706, { roughness: 0.58 });
    const redMat = makeMat(0xdc2626, { metalness: 0.72, roughness: 0.26 });
    const yellowMat = makeMat(0xfacc15, { roughness: 0.35 });
    const steelMat = makeMat(0xe2e8f0, { metalness: 0.92, roughness: 0.18 });

    const bunL = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.36, 6, 8), bunMat);
    bunL.rotation.x = Math.PI / 2;
    bunL.position.set(-0.042, 0.02, -0.14);

    const bunR = bunL.clone();
    bunR.position.x = 0.042;

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.54, 10), redMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.055, -0.20);

    const mustardStripe = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.018, 0.48), yellowMat);
    mustardStripe.position.set(0, 0.112, -0.20);

    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.064, 0.06, 12), steelMat);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.055, -0.47);

    const loadedTip = new THREE.Mesh(new THREE.SphereGeometry(0.048, 8, 6), makeMat(0xb91c1c));
    loadedTip.position.set(0, 0.055, -0.49);

    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.22, 8), makeMat(0x0f172a, { metalness: 0.85 }));
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.145, -0.14);

    g.add(bunL, bunR, barrel, mustardStripe, muzzle, loadedTip, scope);
  }
  return g;
}

export function buildLeftItemMesh(id) {
  const g = new THREE.Group();
  if (id === 'medkit') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.09), makeMat(0xf8fafc));
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.026, 0.10), makeMat(0xef4444));
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.08, 0.10), makeMat(0xef4444));
    g.add(box, c1, c2);
  } else if (id === 'soda') {
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.14, 10), makeMat(0x0284c7, { metalness: 0.85 }));
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.02, 10), makeMat(0xe2e8f0, { metalness: 0.9 }));
    rim.position.y = 0.065;
    g.add(can, rim);
  } else if (id === 'burger') {
    const bunTop = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.072, 0.045, 10), makeMat(0xd97706));
    bunTop.position.y = 0.032;
    const patty = new THREE.Mesh(new THREE.CylinderGeometry(0.074, 0.074, 0.028, 10), makeMat(0x451a03));
    const bunBot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.065, 0.03, 10), makeMat(0xd97706));
    bunBot.position.y = -0.028;
    g.add(bunTop, patty, bunBot);
  } else if (id === 'flashlight') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.22, 8), makeMat(0x1e293b, { metalness: 0.8 }));
    body.rotation.x = Math.PI / 2;
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.032, 0.05, 8), makeMat(0xfef08a, { emissive: 0xfacc15, emissiveIntensity: 0.6 }));
    lens.rotation.x = Math.PI / 2;
    lens.position.z = -0.12;
    g.add(body, lens);
  } else if (id === 'cash') {
    const stack = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.09), makeMat(0x10b981));
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.054, 0.094), makeMat(0xfef3c7));
    g.add(stack, band);
  }
  return g;
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

  const wGroup = new THREE.Group();
  wGroup.position.copy(muzzlePos);
  const wienerMesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.068, 0.34, 5, 8),
    makeMat(0xb91c1c, { roughness: 0.32 })
  );
  wienerMesh.rotation.x = Math.PI / 2;
  const mustardLine = new THREE.Mesh(
    new THREE.BoxGeometry(0.024, 0.02, 0.32),
    makeMat(0xfacc15)
  );
  mustardLine.position.y = 0.068;
  wGroup.add(wienerMesh, mustardLine);
  worldRoot.add(wGroup);

  const launchSpeed = gameState.isAiming ? 68.0 : 54.0;
  const vx = dir.x * launchSpeed;
  const vy = dir.y * launchSpeed + 2.8;
  const vz = dir.z * launchSpeed;

  projectileWieners.push({
    mesh: wGroup,
    x: muzzlePos.x,
    y: muzzlePos.y,
    z: muzzlePos.z,
    vx,
    vy,
    vz,
    life: 3.2
  });

  hooks.updateHUD();
}

export function updateProjectileWieners(dt) {
  const GRAVITY = 15.8;

  for (let i = projectileWieners.length - 1; i >= 0; i--) {
    const w = projectileWieners[i];
    w.life -= dt;
    w.vy -= GRAVITY * dt;
    w.x += w.vx * dt;
    w.y += w.vy * dt;
    w.z += w.vz * dt;

    w.mesh.position.set(w.x, w.y, w.z);
    w.mesh.lookAt(w.x + w.vx, w.y + w.vy, w.z + w.vz);

    let impacted = false;

    for (let n = 0; n < npcs.length; n++) {
const npc = npcs[n];
if (!npc.spawned || npc.asleep) continue;
      if (Math.hypot(w.x - npc.x, w.z - npc.z) < 0.72 && w.y >= 0.18 && w.y <= 1.95) {
        hooks.damageNpc(npc, 48, Math.atan2(w.vx, w.vz));
        sfx.wienerSplat();
        spawnParticles(w.x, w.y, w.z, 0xb91c1c, 8, 5.5);
        spawnParticles(w.x, w.y, w.z, 0xfacc15, 5, 4.5);
        if (!npc.asleep) {
          pushFeed(`WIENER HIT ${npc.name}!`, 'border-l-amber-400');
        }
        impacted = true;
        break;
      }
    }

    if (!impacted) {
      for (let c = smashableCrates.length - 1; c >= 0; c--) {
        const cr = smashableCrates[c];
        if (Math.abs(w.x - cr.x) < 0.72 && Math.abs(w.z - cr.z) < 0.72 && w.y >= cr.y && w.y <= cr.y + 1.15) {
          sfx.smash();
          spawnParticles(cr.x, cr.y + 0.55, cr.z, 0xd97706, 12, 6.5);
          worldRoot.remove(cr.mesh);
          freeGeo(cr.mesh);
          const wbIdx = worldBoxes.indexOf(cr.box);
          if (wbIdx !== -1) worldBoxes.splice(wbIdx, 1);
          if (cr.loot) spawnWorldPickup(cr.loot.type, cr.loot.id, cr.x, cr.y, cr.z);
          smashableCrates.splice(c, 1);
          pushFeed('CRATE SMASHED BY WIENER!', 'border-l-amber-400');
          impacted = true;
          break;
        }
      }
    }

    if (!impacted) {
      for (let b = hazardBarrels.length - 1; b >= 0; b--) {
        const br = hazardBarrels[b];
        if (Math.hypot(w.x - br.x, w.z - br.z) < 0.65 && w.y >= br.y && w.y <= br.y + 1.25) {
          sfx.smash();
          spawnParticles(br.x, br.y + 0.6, br.z, 0xf97316, 18, 9.0);
          worldRoot.remove(br.mesh);
          freeGeo(br.mesh);
          const wbIdx = worldBoxes.indexOf(br.box);
          if (wbIdx !== -1) worldBoxes.splice(wbIdx, 1);
          hazardBarrels.splice(b, 1);
          pushFeed('HAZARD BARREL DETONATED!', 'border-l-orange-500');
          impacted = true;
          break;
        }
      }
    }

    if (!impacted) {
      for (const lp of lampPosts) {
        if (lp.state === 'standing' && Math.hypot(w.x - lp.x, w.z - lp.z) < 0.45 && w.y >= 0.18 && w.y <= 4.6) {
          hooks.knockOverLamppost(lp, Math.atan2(w.vx, w.vz), 8.5);
          impacted = true;
          break;
        }
      }
    }

    if (!impacted) {
      if (w.y <= 0.18) {
        impacted = true;
        sfx.wienerSplat();
        spawnParticles(w.x, 0.24, w.z, 0xb91c1c, 6, 4.2);
        spawnParticles(w.x, 0.24, w.z, 0xfacc15, 4, 3.5);
      } else {
        for (let k = 0; k < worldBoxes.length; k++) {
          const wb = worldBoxes[k];
          if (w.x >= wb.minX && w.x <= wb.maxX && w.z >= wb.minZ && w.z <= wb.maxZ && w.y >= wb.minY && w.y <= wb.maxY) {
            impacted = true;
            sfx.wienerSplat();
            spawnParticles(w.x, w.y, w.z, 0xb91c1c, 6, 4.2);
            spawnParticles(w.x, w.y, w.z, 0xfacc15, 4, 3.5);
            break;
          }
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
  spawnWorldPickup('left', slot.id, player.x + fwdX * 1.4, player.y, player.z + fwdZ * 1.4);
  slot.count -= 1;
  if (slot.count <= 0) gameState.leftHotbar[slotIndex] = null;
  sfx.uiClick();
  hooks.syncEquippedMeshes();
  hooks.updateHUD();
  if (gameState.inventoryOpen) hooks.renderInventoryModal();
}
// Pure visual builders (no registration) used by Studio previews and entity tabs.
export function buildCrateMesh() {
  const holder = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.05, 1.05), crateMat);
  mesh.position.y = 0.525;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  holder.add(mesh);
  return holder;
}

export function buildBarrelMesh() {
  const holder = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.15, 10), barrelMat);
  mesh.position.y = 0.575;
  mesh.castShadow = true;
  holder.add(mesh);
  return holder;
}
