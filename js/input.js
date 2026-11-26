import { levelData } from './levelData.js';
import { MAX_HOTDOG_AMMO, aura, climb, flashEdge, gameState, hooks, inputState, keys, manholeOpen, meteorDrop, npcs, player, pushFeed, sausageRefillZones, under } from './state.js';
import { canvas } from './engine.js';
import { sfx } from './audio.js';
import { useLeftHandItem } from './items.js';
import { enterVehicle, exitCurrentCar, getNearestVehicle, shiftVehicleGear, vehicles } from './vehicles.js';
import { findMantleTarget, getNearestElevatorPad, nearestManhole, startClimb, syncEquippedMeshes, triggerRightHandAttack } from './player.js';

export function applyLookDelta(dx, dy) {
  const mult = 0.0023 * gameState.settings.sensitivity * (gameState.isAiming ? 0.55 : 1.0);
  if (gameState.inCar && gameState.thirdPerson) {
    const vehicle = vehicles[gameState.activeCarIndex];
    if (vehicle) {
      vehicle.cameraYaw -= dx * mult;
      vehicle.cameraPitch = Math.max(-0.2, Math.min(1.05, vehicle.cameraPitch - dy * mult));
      vehicle.cameraLookIdle = 0;
    }
    return;
  }
  player.yaw -= dx * mult;
  player.pitch = Math.max(-1.42, Math.min(1.42, player.pitch - dy * mult));
}
export function initInput() {

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  document.getElementById('lock-hint').style.display = locked ? 'none' : 'block';
});

window.addEventListener('contextmenu', (e) => {
  if (gameState.screen === 'playing') {
    e.preventDefault();
  }
});

canvas.addEventListener('mousedown', (e) => {
  if (gameState.screen !== 'playing') return;
  if (gameState.inventoryOpen || gameState.mapOpen || gameState.settingsOpen) return;
  sfx.unlock();

  if (e.button === 2) {
    e.preventDefault();
    if (!gameState.inCar && !meteorDrop.active && gameState.activeRightWeapon === 'hotdog_shooter') {
      gameState.isAiming = !gameState.isAiming;
      sfx.uiClick();
      hooks.updateHUD();
    }
    return;
  }

  if ((!gameState.settings.mobileControls || navigator.maxTouchPoints === 0) && document.pointerLockElement !== canvas && canvas.requestPointerLock) {
    try {
      const res = canvas.requestPointerLock();
      if (res && res.catch) res.catch(() => {});
    } catch (_) {}
  }

  inputState.isDraggingLook = true;
  inputState.lastMouseX = e.clientX;
  inputState.lastMouseY = e.clientY;

  if (e.button === 0 && !meteorDrop.active) {
    inputState.isPrimaryFireHeld = true;
    if (gameState.inCar) sfx.horn();
    else triggerRightHandAttack();
  }
});

window.addEventListener('mousemove', (e) => {
  if (gameState.screen !== 'playing') return;
  if (gameState.inventoryOpen || gameState.mapOpen || gameState.settingsOpen) return;

  if (document.pointerLockElement === canvas) {
    applyLookDelta(e.movementX || 0, e.movementY || 0);
  } else if (inputState.isDraggingLook) {
    applyLookDelta(e.clientX - inputState.lastMouseX, e.clientY - inputState.lastMouseY);
    inputState.lastMouseX = e.clientX;
    inputState.lastMouseY = e.clientY;
  }
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 0) {
    inputState.isPrimaryFireHeld = false;
  }
  inputState.isDraggingLook = false;
});

window.addEventListener('wheel', (e) => {
  if (gameState.screen !== 'playing') return;
  if (gameState.inventoryOpen || gameState.mapOpen || gameState.settingsOpen || gameState.inCar || meteorDrop.active) return;
  hooks.cycleRightWeapon(e.deltaY > 0 ? 1 : -1);
}, { passive: true });

window.addEventListener('keydown', (e) => {
  const code = e.code;
  keys[code] = true;

  if (code === 'Tab' || code === 'Escape') {
    if (gameState.screen === 'playing') {
      e.preventDefault();
      if (gameState.settingsOpen) hooks.closeSettingsModal();
      else if (gameState.inventoryOpen) hooks.closeInventoryModal();
      else if (gameState.mapOpen) hooks.closeMapModal();
      else hooks.setScreen('paused');
      return;
    } else if (gameState.screen === 'paused') {
      e.preventDefault();
      if (gameState.settingsOpen) hooks.closeSettingsModal();
      else hooks.setScreen('playing');
      return;
    }
  }

  if (gameState.screen !== 'playing') return;
  sfx.unlock();

  if (code === 'KeyE') {
    if (gameState.mapOpen || gameState.settingsOpen) return;

    if (!gameState.inventoryOpen && !gameState.inCar && !meteorDrop.active) {
      for (const zone of sausageRefillZones) {
        if (Math.hypot(player.x - zone.x, player.z - zone.z) < 3.1 && Math.abs(player.y - zone.y) < 1.8) {
          if (!gameState.rightWeapons.includes('hotdog_shooter')) {
            gameState.rightWeapons.push('hotdog_shooter');
            gameState.activeRightWeapon = 'hotdog_shooter';
          }
          gameState.hotdogAmmo = MAX_HOTDOG_AMMO;
          sfx.pickup();
          flashEdge('rgba(245, 158, 11, 0.35)');
          pushFeed(`SAUSAGE HOPPER REFILLED (${MAX_HOTDOG_AMMO}/${MAX_HOTDOG_AMMO})!`, 'border-l-amber-400');
          syncEquippedMeshes();
          hooks.updateHUD();
          return;
        }
      }
    }

    if (!gameState.inventoryOpen && !gameState.inCar && !meteorDrop.active) {
      for (const npc of npcs) {
        if (!npc.spawned || npc.asleep) continue;
        if (Math.hypot(player.x - npc.x, player.z - npc.z) < 2.5 && Math.abs(player.y - 0.18) < 1.8) {
          const dlg = document.getElementById('npc-dialogue');
          document.getElementById('npc-dialogue-name').textContent = npc.name;
          document.getElementById('npc-dialogue-text').textContent = npc.line;
          dlg.style.display = 'block';
          gameState.dialogueTimer = 4.2;
          sfx.uiClick();
          return;
        }
      }
    }

    if (gameState.inventoryOpen) hooks.closeInventoryModal();
    else hooks.openInventoryModal();
    return;
  }

  if (code === 'KeyM') {
    if (gameState.mapOpen) hooks.closeMapModal();
    else hooks.openMapModal();
    return;
  }

  if (gameState.inventoryOpen || gameState.mapOpen || gameState.settingsOpen) return;

  if (code === 'KeyV') {
    gameState.thirdPerson = !gameState.thirdPerson;
    if (gameState.thirdPerson && !gameState.inCar) {
      gameState.isAiming = false;
    }
    sfx.uiClick();
    hooks.updateHUD();
  } else if (code === 'KeyQ') {
    hooks.cycleRightWeapon(1);
  } else if (code === 'KeyU') {
    if (!gameState.inCar && !meteorDrop.active) useLeftHandItem(gameState.activeLeftSlot);
  } else if (code === 'KeyC') {
    if (!gameState.inCar && !meteorDrop.active) {
      player.crouching = !player.crouching;
      sfx.uiClick();
    }
  } else if (code === 'Space') {
    if (gameState.inCar || player.mantle.active || meteorDrop.active) return;
    const mTarget = findMantleTarget();
    if (mTarget) {
      player.mantle.active = true;
      player.mantle.timer = 0;
      player.mantle.startX = player.x;
      player.mantle.startY = player.y;
      player.mantle.startZ = player.z;
      player.mantle.endX = mTarget.x;
      player.mantle.endY = mTarget.y;
      player.mantle.endZ = mTarget.z;
      player.vy = 0;
      player.grounded = false;
      player.crouching = false;
      sfx.mantle();
      pushFeed('MANTLED LEDGE', 'border-l-sky-400');
    } else if ((player.grounded || player.coyote > 0) && gameState.stamina >= 5) {
      player.vy = levelData.params.player.jumpForce;
      player.coyote = 0;
      player.grounded = false;
      player.peakAirY = player.y;
      gameState.stamina = Math.max(0, gameState.stamina - 5);
    }
  } else if (code === 'KeyI' && gameState.inCar) {
    shiftVehicleGear(1);
  } else if (code === 'KeyK' && gameState.inCar) {
    shiftVehicleGear(-1);
  } else if (code === 'KeyF') {
if (gameState.inCar) {
exitCurrentCar();
} else if (!climb.on) {
const u = under();
const mi = nearestManhole(u ? 3.2 : 2.4);
if (mi >= 0) {
if (u) { startClimb(1, mi); }
else if (!manholeOpen[mi]) {
manholeOpen[mi] = true; sfx.mantle();
pushFeed('MANHOLE COVER OPENED — [F] TO CLIMB DOWN', 'border-l-amber-400');
hooks.mpWorldEvent({ t: 'manhole', i: mi });
}
else startClimb(-1, mi);
} else if (aura.ahF && aura.ahHint && aura.ahHint()) {
aura.ahF();
} else {
const elev = getNearestElevatorPad();
if (elev) {
player.x = elev.dest.x;
player.y = elev.dest.y;
player.z = elev.dest.z;
player.vy = 0;
player.grounded = true;
player.peakAirY = elev.dest.y;
sfx.elevatorDing();
flashEdge('rgba(56, 189, 248, 0.35)');
pushFeed(
elev.toRoof ? `ROOFTOP HELIPAD — ${elev.sk.name}` : `GROUND LOBBY — ${elev.sk.name}`,
'border-l-sky-400'
);
hooks.updateHUD();
} else {
const near = getNearestVehicle(4.2);
if (near) enterVehicle(near.idx);
}
}
}
} else if (['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(code)) {
    gameState.activeLeftSlot = Number(code.replace('Digit', '')) - 1;
    syncEquippedMeshes();
    hooks.updateHUD();
  }
});

window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

window.addEventListener('blur', () => {
  for (const code of Object.keys(keys)) keys[code] = false;
  inputState.isDraggingLook = false;
  inputState.isPrimaryFireHeld = false;
});
}