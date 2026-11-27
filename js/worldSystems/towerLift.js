// =============================================================================
// worldSystems/towerLift.js — PHYSICAL ELEVATOR CABINS & ARROW-KEY CONTROLS
//
// Builds a 3D elevator cabin per tower that travels smoothly between streamed
// floorPads, calling primeCell() before arrival so destination floors are
// always loaded.
//
// Controls (when inside a cabin or standing on a floor's lift pad):
//   [ArrowUp]   Ride up one floor (or call elevator to current floor)
//   [ArrowDown] Ride down one floor (or call elevator to current floor)
// =============================================================================
import * as THREE from 'three';
import * as state from '../state.js';
import { aura, gameState, player, skyscrapers } from '../state.js';
import { dist2 } from '../worldKit.js';
import { primeCell } from '../worldStream.js';

const PAD_RANGE2 = 2.6 * 2.6;
const CABIN_W = 2.8;
const CABIN_D = 2.8;
const CABIN_H = 2.7;
const CABIN_INNER_HALF = 1.08;
const PLAYER_FLOOR_OFFSET = 0.08;

const LIFT_MAX_SPEED = 8.5;
const LIFT_ACCEL = 18.0;
const DOOR_SPEED = 3.2;

let lifts = [];
let rafId = null;
let lastTick = 0;
let keyListenerInstalled = false;

// Passenger vertical lock state so game gravity/ground-snapping cannot drop
// the player through the moving cabin floor mid-ride.
let lockedLift = null;
let savedYDescriptor = null;

function floorLabel(pad, fallbackIdx = 0) {
  const idx = typeof pad.i === 'number' ? pad.i : fallbackIdx;
  return idx === 0 ? 'LOBBY' : `FLOOR ${idx}`;
}

function lockPlayerToLift(lift) {
  if (!player || lockedLift === lift) return;
  unlockPlayerFromLift();

  savedYDescriptor = Object.getOwnPropertyDescriptor(player, 'y') || null;
  lockedLift = lift;

  Object.defineProperty(player, 'y', {
    configurable: true,
    enumerable: true,
    get() {
      return lockedLift ? lockedLift.currentY + PLAYER_FLOOR_OFFSET : 0;
    },
    set() {
      // Ignore gravity / ground-height overwrites while riding inside the cabin
      if ('vy' in player) player.vy = 0;
    }
  });

  if ('vy' in player) player.vy = 0;
  if ('onGround' in player) player.onGround = true;
  if ('grounded' in player) player.grounded = true;
}

function unlockPlayerFromLift() {
  if (!lockedLift) return;
  const finalY = lockedLift.currentY + PLAYER_FLOOR_OFFSET;
  lockedLift = null;

  if (player) {
    if (savedYDescriptor && (savedYDescriptor.get || savedYDescriptor.set)) {
      Object.defineProperty(player, 'y', savedYDescriptor);
    } else {
      delete player.y;
    }
    player.y = finalY;
    if ('vy' in player) player.vy = 0;
  }
  savedYDescriptor = null;
}

function findScene(towers) {
  if (state.scene && state.scene.isScene) return state.scene;
  if (gameState?.scene && gameState.scene.isScene) return gameState.scene;
  if (aura?.scene && aura.scene.isScene) return aura.scene;

  const walkToScene = (obj) => {
    let cur = obj;
    while (cur) {
      if (cur.isScene) return cur;
      cur = cur.parent;
    }
    return null;
  };

  for (const candidate of [player, ...towers]) {
    if (!candidate) continue;
    if (candidate.isObject3D) {
      const s = walkToScene(candidate);
      if (s) return s;
    }
    for (const val of Object.values(candidate)) {
      if (val && typeof val === 'object' && val.isObject3D) {
        const s = walkToScene(val);
        if (s) return s;
      }
    }
  }
  return null;
}

function createCabinMesh() {
  const group = new THREE.Group();
  group.name = 'TowerElevatorCabin';

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.35,
    metalness: 0.75
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.25,
    metalness: 0.85
  });
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.7,
    metalness: 0.4
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xbae6fd,
    roughness: 0.12,
    metalness: 0.2,
    transparent: true,
    opacity: 0.3,
    depthWrite: false
  });
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.3,
    metalness: 0.7,
    transparent: true,
    opacity: 0.88
  });
  const lightMat = new THREE.MeshStandardMaterial({
    color: 0xfffbeb,
    emissive: 0xfef3c7,
    emissiveIntensity: 0.95,
    roughness: 0.2
  });

  // Floor platform
  const floor = new THREE.Mesh(new THREE.BoxGeometry(CABIN_W, 0.12, CABIN_D), floorMat);
  floor.position.y = -0.04;
  group.add(floor);

  // Roof canopy + interior ceiling light
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(CABIN_W + 0.08, 0.14, CABIN_D + 0.08),
    frameMat
  );
  roof.position.y = CABIN_H + 0.05;
  group.add(roof);

  const ceilingLight = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 1.5), lightMat);
  ceilingLight.position.y = CABIN_H - 0.03;
  group.add(ceilingLight);

  // 4 corner structural pillars
  const pillarGeo = new THREE.BoxGeometry(0.16, CABIN_H, 0.16);
  const halfW = CABIN_W * 0.5 - 0.08;
  const halfD = CABIN_D * 0.5 - 0.08;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pillar = new THREE.Mesh(pillarGeo, frameMat);
      pillar.position.set(sx * halfW, CABIN_H * 0.5, sz * halfD);
      group.add(pillar);
    }
  }

  // Side walls (-X and +X): steel wainscot, handrail, and panoramic glass
  const wainscotGeo = new THREE.BoxGeometry(0.08, 0.9, CABIN_D - 0.32);
  const sideGlassGeo = new THREE.BoxGeometry(0.04, CABIN_H - 0.96, CABIN_D - 0.32);
  const railGeo = new THREE.BoxGeometry(0.06, 0.05, CABIN_D - 0.38);

  for (const sx of [-1, 1]) {
    const wainscot = new THREE.Mesh(wainscotGeo, frameMat);
    wainscot.position.set(sx * halfW, 0.45, 0);
    group.add(wainscot);

    const glass = new THREE.Mesh(sideGlassGeo, glassMat);
    glass.position.set(sx * halfW, 0.9 + (CABIN_H - 0.96) * 0.5, 0);
    group.add(glass);

    const rail = new THREE.Mesh(railGeo, trimMat);
    rail.position.set(sx * (halfW - 0.08), 0.96, 0);
    group.add(rail);
  }

  // Pass-through front (+Z) & back (-Z) double sliding doors
  const doorW = (CABIN_W - 0.32) * 0.5;
  const doorH = CABIN_H - 0.08;
  const doorGeo = new THREE.BoxGeometry(doorW, doorH, 0.06);
  const doors = [];

  for (const sz of [-1, 1]) {
    for (const side of [-1, 1]) {
      const leaf = new THREE.Mesh(doorGeo, doorMat);
      leaf.position.set(side * (doorW * 0.5), doorH * 0.5, sz * (halfD - 0.02));
      group.add(leaf);
      doors.push({ mesh: leaf, side, halfSpan: doorW * 0.5 });
    }
  }

  group.userData.doors = doors;
  return group;
}

function updateDoorVisuals(cabin, openAmount) {
  const doors = cabin.userData.doors;
  if (!doors) return;
  for (const d of doors) {
    d.mesh.position.x = d.side * (d.halfSpan + openAmount * (d.halfSpan * 0.92));
  }
}

function isPlayerInsideCabin(lift) {
  if (lift.riding) return true;
  const refPad = lift.pads[lift.currentIdx];
  const dx = Math.abs((player.x || 0) - refPad.x);
  const dz = Math.abs((player.z || 0) - refPad.z);
  const dy = (player.y || 0) - lift.currentY;
  return dx <= CABIN_INNER_HALF + 0.15 && dz <= CABIN_INNER_HALF + 0.15 && dy >= -0.6 && dy <= CABIN_H;
}

function findPlayerContext() {
  if (gameState.screen !== 'playing' || gameState.inCar) return null;

  let best = null;
  for (const lift of lifts) {
    if (isPlayerInsideCabin(lift)) {
      return { lift, inside: true, padIdx: lift.currentIdx, d2: 0 };
    }
    for (let i = 0; i < lift.pads.length; i++) {
      const pad = lift.pads[i];
      if (Math.abs((player.y || 0) - pad.y) > 2.0) continue;
      const d2 = dist2(player.x, player.z, pad.x, pad.z);
      if (d2 < PAD_RANGE2 && (!best || d2 < best.d2)) {
        best = { lift, inside: false, padIdx: i, d2 };
      }
    }
  }
  return best;
}

function sendLiftTo(lift, nextIdx, boardPlayer) {
  const clamped = Math.max(0, Math.min(lift.pads.length - 1, nextIdx));
  if (clamped === lift.targetIdx && (lift.state === 'moving' || lift.state === 'closing')) {
    return false;
  }
  if (clamped === lift.currentIdx && lift.state === 'idle') {
    return false;
  }

  const destPad = lift.pads[clamped];
  if (destPad.cell) primeCell(destPad.cell);

  lift.targetIdx = clamped;
  if (boardPlayer) {
    lift.riding = true;
    lockPlayerToLift(lift);
  }

  if (lift.state === 'moving') {
    return true;
  }
  lift.state = lift.doorOpen > 0.02 ? 'closing' : 'moving';
  return true;
}

function handleDirectionInput(dir) {
  const ctx = findPlayerContext();
  if (!ctx) return false;

  const { lift, inside, padIdx } = ctx;
  if (!inside) {
    return sendLiftTo(lift, padIdx, false);
  }

  const baseIdx = lift.state === 'moving' || lift.state === 'closing' ? lift.targetIdx : lift.currentIdx;
  return sendLiftTo(lift, baseIdx + dir, true);
}

function stepLift(lift, dt, scene) {
  if (!lift.cabin.parent && scene) {
    scene.add(lift.cabin);
  }

  const targetPad = lift.pads[lift.targetIdx];

  if (lift.state === 'closing') {
    lift.doorOpen = Math.max(0, lift.doorOpen - DOOR_SPEED * dt);
    if (lift.doorOpen === 0) {
      lift.state = 'moving';
    }
  } else if (lift.state === 'moving') {
    if (targetPad.cell) primeCell(targetPad.cell);

    const diff = targetPad.y - lift.currentY;
    const dist = Math.abs(diff);
    const dir = Math.sign(diff);

    const brakingSpeed = Math.sqrt(2 * LIFT_ACCEL * dist);
    const desiredVel = dir * Math.min(LIFT_MAX_SPEED, brakingSpeed);
    const maxDv = LIFT_ACCEL * dt;
    const dv = Math.max(-maxDv, Math.min(maxDv, desiredVel - lift.velY));
    lift.velY += dv;

    const step = lift.velY * dt;
    if (dist <= Math.abs(step) + 0.01) {
      lift.currentY = targetPad.y;
      lift.velY = 0;
      lift.currentIdx = lift.targetIdx;
      lift.state = 'opening';
    } else {
      lift.currentY += step;
    }
  } else if (lift.state === 'opening') {
    if (targetPad.cell) primeCell(targetPad.cell);
    lift.doorOpen = Math.min(1, lift.doorOpen + DOOR_SPEED * dt);
    if (lift.doorOpen === 1) {
      lift.state = 'idle';
      if (lift.riding) {
        lift.riding = false;
        if (lockedLift === lift) unlockPlayerFromLift();
      }
    }
  }

  const anchorPad = lift.pads[lift.currentIdx];
  lift.cabin.position.set(anchorPad.x, lift.currentY, anchorPad.z);
  updateDoorVisuals(lift.cabin, lift.doorOpen);

  if (gameState.screen === 'playing' && !gameState.inCar) {
    if (lift.riding) {
      // Keep the player inside the cabin footprint while doors are closed/moving
      player.x = Math.max(anchorPad.x - CABIN_INNER_HALF, Math.min(anchorPad.x + CABIN_INNER_HALF, player.x));
      player.z = Math.max(anchorPad.z - CABIN_INNER_HALF, Math.min(anchorPad.z + CABIN_INNER_HALF, player.z));
      if ('vy' in player) player.vy = 0;
    } else if (lift.state === 'idle') {
      // Prevent sinking through the cabin floor if the shaft has a cutout at upper floors
      const dx = Math.abs((player.x || 0) - anchorPad.x);
      const dz = Math.abs((player.z || 0) - anchorPad.z);
      if (dx <= CABIN_INNER_HALF && dz <= CABIN_INNER_HALF) {
        const floorY = lift.currentY + PLAYER_FLOOR_OFFSET;
        if ((player.y || 0) < floorY && (player.y || 0) >= lift.currentY - 0.6) {
          player.y = floorY;
          if ('vy' in player) player.vy = 0;
        }
      }
    }
  }
}

export function update(dt) {
  const scene = lifts.some((l) => !l.cabin.parent) ? findScene(skyscrapers) : null;
  for (const lift of lifts) {
    stepLift(lift, dt, scene);
  }
}

function startLoop() {
  if (rafId !== null || typeof requestAnimationFrame === 'undefined') return;
  lastTick = performance.now();

  const tick = (now) => {
    if (lifts.length === 0) {
      rafId = null;
      return;
    }
    const dt = Math.min((now - lastTick) * 0.001, 0.05);
    lastTick = now;
    update(dt);
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
}

function onKeyDown(e) {
  if (e.repeat) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (e.code === 'ArrowUp' || e.key === 'ArrowUp') {
    if (handleDirectionInput(1)) e.preventDefault();
  } else if (e.code === 'ArrowDown' || e.key === 'ArrowDown') {
    if (handleDirectionInput(-1)) e.preventDefault();
  }
}

export function install() {
  reset();

  const towers = skyscrapers.filter(
    (sk) => Array.isArray(sk.floorPads) && sk.floorPads.length > 1
  );
  const scene = findScene(towers);

  lifts = towers.map((sk) => {
    const pads = [...sk.floorPads].sort((a, b) => a.y - b.y);
    const cabin = createCabinMesh();
    cabin.position.set(pads[0].x, pads[0].y, pads[0].z);
    updateDoorVisuals(cabin, 1);
    if (scene) scene.add(cabin);

    return {
      sk,
      pads,
      currentIdx: 0,
      targetIdx: 0,
      currentY: pads[0].y,
      velY: 0,
      doorOpen: 1,
      state: 'idle',
      riding: false,
      cabin
    };
  });

  if (!keyListenerInstalled && typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown, { passive: false });
    keyListenerInstalled = true;
  }

  const prevHint = aura.ahHint;
  aura.ahHint = () => {
    const ctx = findPlayerContext();
    if (ctx) {
      const { lift, inside, padIdx } = ctx;
      if (!inside) {
        if (lift.targetIdx === padIdx && lift.state !== 'idle') {
          return 'ELEVATOR ARRIVING...';
        }
        return `[▲/▼] CALL ELEVATOR (${floorLabel(lift.pads[lift.currentIdx], lift.currentIdx)})`;
      }

      if (lift.state === 'moving' || lift.state === 'closing') {
        const arrow = lift.targetIdx > lift.currentIdx ? '▲' : '▼';
        return `ELEVATOR ${arrow} ${floorLabel(lift.pads[lift.targetIdx], lift.targetIdx)}`;
      }

      const opts = [];
      if (lift.currentIdx < lift.pads.length - 1) {
        const upPad = lift.pads[lift.currentIdx + 1];
        opts.push(`[▲] ${floorLabel(upPad, lift.currentIdx + 1)}`);
      }
      if (lift.currentIdx > 0) {
        const downPad = lift.pads[lift.currentIdx - 1];
        opts.push(`[▼] ${floorLabel(downPad, lift.currentIdx - 1)}`);
      }
      return opts.join('   ');
    }
    return prevHint ? prevHint() : '';
  };

  startLoop();
}

export function reset() {
  unlockPlayerFromLift();

  if (rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(rafId);
  }
  rafId = null;

  if (keyListenerInstalled && typeof window !== 'undefined') {
    window.removeEventListener('keydown', onKeyDown);
    keyListenerInstalled = false;
  }

  for (const lift of lifts) {
    if (lift.cabin) {
      if (lift.cabin.parent) lift.cabin.parent.remove(lift.cabin);
      lift.cabin.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      });
    }
  }
  lifts = [];
}

export default { install, update, reset };