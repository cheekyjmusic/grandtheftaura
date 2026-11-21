// Optional touch controls for phones and tablets. Desktop input remains unchanged.
import { gameState, hooks, inputState, keys, player, pushFeed } from './state.js';
import { canvas } from './engine.js';
import { sfx } from './audio.js';
import { cycleRightWeapon, openInventoryModal, openMapModal, setScreen, updateHUD } from './ui.js';
import { exitCurrentCar, GEAR_LABELS, shiftVehicleGear, vehicles } from './vehicles.js';
import { syncEquippedMeshes, triggerRightHandAttack } from './player.js';
import { useLeftHandItem } from './items.js';
import { applyLookDelta } from './input.js';
import { applyJetLookDelta, boardJet, dropNuke, isJetFlying, isNearJet, leaveJet, setJetMobileKey } from './aircraft.js';

const MOBILE_PREF_KEY = 'gtaAura.mobileControls.v1';
const heldKeys = new Map();
const activeActions = new Map();
let mobileDevice = false;
let root = null;
let lookPointer = null;
let lookX = 0;
let lookY = 0;
let stickPointer = null;
let lastSync = 0;

function setHeldKey(code, down, source) {
  let sources = heldKeys.get(code);
  if (!sources) { sources = new Set(); heldKeys.set(code, sources); }
  if (down) sources.add(source);
  else sources.delete(source);
  keys[code] = sources.size > 0;
  if (!sources.size) heldKeys.delete(code);
}

function createControls() {
  root = document.createElement('div');
  root.id = 'mobile-controls';
  root.innerHTML = `
	<div id="mobile-look" aria-label="Drag to look"><span class="mobile-look-hint">DRAG TO LOOK</span></div>
	<div class="mobile-tools"><button class="mobile-btn mobile-fullscreen" data-action="fullscreen" aria-label="Toggle fullscreen">FULL</button><button class="mobile-btn primary" data-action="pause">PAUSE</button></div>
	<div class="mobile-stick-wrap" id="mobile-stick" aria-label="Movement joystick"><div id="mobile-stick-thumb"></div><div class="mobile-stick-label">MOVE</div></div>
	<div class="mobile-actions" id="mobile-foot-actions">
	  <button class="mobile-btn primary" data-action="fire">FIRE</button><button class="mobile-btn" data-action="jump">JUMP</button><button class="mobile-btn primary wide" id="mobile-interact" data-action="interact">USE</button>
	  <button class="mobile-btn" data-action="more" aria-expanded="false">MORE</button>
	  <div class="mobile-extra-actions hidden" id="mobile-extra-actions">
		<button class="mobile-btn" data-action="map">MAP</button><button class="mobile-btn" data-action="bag">BAG</button><button class="mobile-btn" data-action="pov">POV</button>
		<button class="mobile-btn" data-action="run">RUN</button><button class="mobile-btn" data-action="crouch">CROUCH</button><button class="mobile-btn" data-action="aim">AIM</button>
		<button class="mobile-btn" data-action="slot-prev">ITEM ◀</button><button class="mobile-btn" data-action="item">USE ITEM</button><button class="mobile-btn" data-action="slot-next">ITEM ▶</button>
		<button class="mobile-btn" data-action="weapon">WEAPON</button><button class="mobile-btn" data-action="strike">STRIKE</button><button class="mobile-btn" data-action="auto">AUTO</button>
		<button class="mobile-btn" data-action="pickpocket">SNEAK</button>
	  </div>
	</div>
	<div class="mobile-car-controls" id="mobile-car-controls">
		<div class="mobile-shifter"><div class="mobile-gear-caption">SHIFTER</div><button class="mobile-btn" data-action="gear-up" aria-label="Shift up">▲</button><div id="mobile-gear-label">1</div><button class="mobile-btn" data-action="gear-down" aria-label="Shift down">▼</button></div>
		<div class="mobile-drive-pedals"><button class="mobile-btn primary" data-action="gas">GAS</button><button class="mobile-btn" data-action="brake">BRAKE</button><button class="mobile-btn" data-action="drift">DRIFT</button><button class="mobile-btn" data-action="horn">HORN</button><button class="mobile-btn wide" data-action="exit">EXIT</button></div>
	</div>
	<div class="mobile-jet-controls" id="mobile-jet-controls"><div class="mobile-jet-buttons">
		<button class="mobile-btn" data-action="jet-throttle-up">THR +</button><button class="mobile-btn" data-action="jet-throttle-down">THR −</button><button class="mobile-btn primary" data-action="jet-afterburner">BOOST</button><button class="mobile-btn" data-action="jet-cannon">GUN</button><button class="mobile-btn" data-action="jet-nuke">NUKE</button><button class="mobile-btn" data-action="jet-pitch-up">PULL UP</button><button class="mobile-btn" data-action="jet-pitch-down">DIVE</button><button class="mobile-btn" data-action="jet-rudder-left" aria-label="Yaw left">YAW ◀</button><button class="mobile-btn" data-action="jet-rudder-right" aria-label="Yaw right">YAW ▶</button><button class="mobile-btn" data-action="jet-camera">CAM</button><button class="mobile-btn" data-action="jet-invert">INVERT</button><button class="mobile-btn wide" data-action="jet-exit">EXIT JET</button>
	</div></div>`;
  document.body.appendChild(root);
}

function tapKey(code) {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true }));
}

function updateFullscreenButton() {
  const button = root && root.querySelector('[data-action="fullscreen"]');
  if (button) button.textContent = document.fullscreenElement ? 'EXIT FULL' : 'FULL';
}

async function toggleFullscreen() {
  try {
	if (document.fullscreenElement) await document.exitFullscreen();
	else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
	else { pushFeed('FULLSCREEN IS NOT AVAILABLE IN THIS BROWSER', 'border-l-rose-500'); return; }
  } catch (error) {
	pushFeed(`FULLSCREEN FAILED: ${error.message || 'BROWSER BLOCKED THE REQUEST'}`, 'border-l-rose-500');
  }
}

function interact() {
  if (isJetFlying()) { leaveJet(); return; }
  if (!gameState.inCar && boardJet()) return;
  if (gameState.inCar) { exitCurrentCar(); return; }
  const prompt = document.getElementById('interact-prompt');
  if (prompt && !prompt.classList.contains('hidden')) {
	tapKey(document.getElementById('interact-key').textContent.trim() === 'F' ? 'KeyF' : 'KeyE');
  } else if (!gameState.inventoryOpen && !gameState.mapOpen && !gameState.settingsOpen) {
	openInventoryModal();
  }
}

function onFootAction(action) {
  if (gameState.screen !== 'playing' && action !== 'pause') return;
  if (action === 'fullscreen') toggleFullscreen();
  else if (action === 'more') {
	const drawer = document.getElementById('mobile-extra-actions');
	const open = drawer.classList.toggle('hidden') === false;
	root.querySelector('[data-action="more"]').setAttribute('aria-expanded', String(open));
  } else if (action === 'map') gameState.mapOpen ? hooks.closeMapModal() : openMapModal();
  else if (action === 'bag') gameState.inventoryOpen ? hooks.closeInventoryModal() : openInventoryModal();
  else if (action === 'pov') tapKey('KeyV');
  else if (action === 'pause') setScreen(gameState.screen === 'paused' ? 'playing' : 'paused');
  else if (action === 'jump') tapKey('Space');
  else if (action === 'interact' || action === 'exit') interact();
  else if (action === 'crouch') tapKey('KeyC');
  else if (action === 'aim' && gameState.activeRightWeapon === 'hotdog_shooter' && !gameState.inCar) {
	gameState.isAiming = !gameState.isAiming;
	updateHUD(true);
  } else if (action === 'item') useLeftHandItem();
  else if (action === 'slot-prev' || action === 'slot-next') {
	gameState.activeLeftSlot = (gameState.activeLeftSlot + (action === 'slot-next' ? 1 : 4)) % 5;
	syncEquippedMeshes();
	updateHUD(true);
  } else if (action === 'weapon') cycleRightWeapon(1);
  else if (action === 'strike') tapKey('KeyB');
  else if (action === 'auto') tapKey('KeyN');
  else if (action === 'gear-up') shiftVehicleGear(1);
  else if (action === 'gear-down') shiftVehicleGear(-1);
  else if (action === 'horn') { if (gameState.inCar) sfx.horn(); }
  else if (action === 'jet-nuke') dropNuke();
  else if (action === 'jet-exit') leaveJet();
  else if (action === 'jet-camera') tapKey('KeyV');
  else if (action === 'jet-invert') tapKey('KeyY');
}

function handleAction(action, down, pointerId) {
  const source = `pointer-${pointerId}`;
  const held = {
	gas: 'KeyW', brake: 'KeyS', drift: 'Space', run: 'ShiftLeft', pickpocket: 'KeyG',
	'jet-throttle-up': 'KeyW', 'jet-throttle-down': 'KeyS', 'jet-afterburner': 'ShiftLeft',
	'jet-pitch-up': 'ArrowUp', 'jet-pitch-down': 'ArrowDown',
	'jet-rudder-left': 'KeyQ', 'jet-rudder-right': 'KeyE'
  }[action];
  if (action.startsWith('jet-') && held) { setJetMobileKey(held, down); return; }
  if (held) { setHeldKey(held, down, source); return; }
  if (action === 'jet-cannon') { setJetMobileKey('M0', down); return; }
  if (action === 'fire') {
	if (isJetFlying()) setJetMobileKey('M0', down);
	else if (gameState.inCar) { if (down) sfx.horn(); }
	else if (gameState.activeRightWeapon === 'hotdog_shooter') inputState.isPrimaryFireHeld = down;
	else if (down) triggerRightHandAttack();
	return;
  }
  if (down) onFootAction(action);
}

function updateJoystick(event) {
  const bounds = document.getElementById('mobile-stick').getBoundingClientRect();
  const dx = event.clientX - (bounds.left + bounds.width / 2);
  const dy = event.clientY - (bounds.top + bounds.height / 2);
  const limit = bounds.width * 0.34;
  const length = Math.hypot(dx, dy) || 1;
  const ratio = Math.min(1, limit / length);
  const x = dx * ratio, y = dy * ratio;
  document.getElementById('mobile-stick-thumb').style.transform = `translate(${x}px, ${y}px)`;
  const setDirection = (code, down) => {
    if (isJetFlying()) { setHeldKey(code, false, 'stick'); setJetMobileKey(code, down); }
    else { setJetMobileKey(code, false); setHeldKey(code, down, 'stick'); }
  };
  setDirection('KeyA', x < -limit * 0.22);
  setDirection('KeyD', x > limit * 0.22);
  setDirection('KeyW', y < -limit * 0.22);
  setDirection('KeyS', y > limit * 0.22);
}

function clearJoystick() {
  stickPointer = null;
  for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
    setJetMobileKey(code, false);
    setHeldKey(code, false, 'stick');
  }
  const thumb = document.getElementById('mobile-stick-thumb');
  if (thumb) thumb.style.transform = '';
}

function syncVisibility(force = false) {
  if (!mobileDevice || !root) return;
  const now = performance.now();
  if (!force && now - lastSync < 120) return;
  lastSync = now;
  const visible = gameState.settings.mobileControls === true && gameState.screen === 'playing'
	&& !gameState.inventoryOpen && !gameState.mapOpen && !gameState.settingsOpen;
  const jetFlying = isJetFlying();
  root.classList.toggle('visible', visible);
  document.getElementById('lock-hint').style.display = visible || document.pointerLockElement === canvas ? 'none' : 'block';
  document.getElementById('mobile-foot-actions').style.display = !gameState.inCar && !jetFlying ? 'grid' : 'none';
  document.getElementById('mobile-car-controls').classList.toggle('active', gameState.inCar && !jetFlying);
  document.getElementById('mobile-jet-controls').classList.toggle('active', jetFlying);
  document.querySelector('.mobile-stick-label').textContent = jetFlying ? 'ROLL / THROTTLE' : gameState.inCar ? 'STEER' : 'MOVE';

  const interactButton = document.getElementById('mobile-interact');
  const prompt = document.getElementById('interact-prompt');
  const promptText = document.getElementById('interact-text');
  const canBoardJet = !gameState.inCar && !jetFlying && isNearJet();
  interactButton.textContent = jetFlying ? 'EXIT JET' : gameState.inCar ? 'EXIT' : canBoardJet ? 'BOARD JET'
	: prompt && !prompt.classList.contains('hidden') ? (promptText.textContent.split(' ')[0] || 'USE') : 'USE';
  interactButton.disabled = !jetFlying && !gameState.inCar && !canBoardJet && (!prompt || prompt.classList.contains('hidden'));
  const aimButton = root.querySelector('[data-action="aim"]');
  aimButton.disabled = gameState.activeRightWeapon !== 'hotdog_shooter' || gameState.inCar;
  const vehicle = vehicles[gameState.activeCarIndex];
  document.getElementById('mobile-gear-label').textContent = vehicle ? GEAR_LABELS[vehicle.gearIndex] : '1';
  if (gameState.inCar || jetFlying || gameState.screen !== 'playing') {
	document.getElementById('mobile-extra-actions').classList.add('hidden');
	root.querySelector('[data-action="more"]').setAttribute('aria-expanded', 'false');
  }
  updateFullscreenButton();

  if (!visible) {
	clearJoystick();
	inputState.isPrimaryFireHeld = false;
	lookPointer = null;
	document.getElementById('mobile-look').classList.remove('active');
	for (const [pointerId, active] of activeActions) {
	  handleAction(active.action, false, pointerId);
	  active.button.classList.remove('pressed');
	}
	activeActions.clear();
  }
}

export function initMobileControls() {
  mobileDevice = navigator.maxTouchPoints > 0 || window.matchMedia?.('(pointer: coarse)').matches === true;
  try { gameState.settings.mobileControls = localStorage.getItem(MOBILE_PREF_KEY) === '1'; }
  catch (err) { console.warn('[mobile] unable to load touch preference:', err); }
  if (!mobileDevice) { hooks.syncMobileControls = () => {}; return; }
  document.documentElement.classList.add('mobile-device');
  createControls();
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  const look = document.getElementById('mobile-look');
  const stick = document.getElementById('mobile-stick');
  root.addEventListener('pointerdown', event => {
	const button = event.target.closest('[data-action]');
	if (!button || !gameState.settings.mobileControls) return;
	event.preventDefault();
	event.stopPropagation();
	const action = button.dataset.action;
	activeActions.set(event.pointerId, { action, button });
	button.classList.add('pressed');
	handleAction(action, true, event.pointerId);
	try { button.setPointerCapture(event.pointerId); } catch (_) { }
  });
  const endAction = event => {
	const active = activeActions.get(event.pointerId);
	if (!active) return;
	active.button.classList.remove('pressed');
	handleAction(active.action, false, event.pointerId);
	activeActions.delete(event.pointerId);
  };
  root.addEventListener('pointerup', endAction);
  root.addEventListener('pointercancel', endAction);
  root.addEventListener('lostpointercapture', endAction);
  stick.addEventListener('pointerdown', event => {
	if (!gameState.settings.mobileControls || gameState.screen !== 'playing') return;
	event.preventDefault();
	stickPointer = event.pointerId;
	updateJoystick(event);
	try { stick.setPointerCapture(event.pointerId); } catch (_) { }
  });
  window.addEventListener('pointermove', event => {
	if (stickPointer === event.pointerId) { event.preventDefault(); updateJoystick(event); }
	if (lookPointer === event.pointerId) {
	  event.preventDefault();
	  const dx = event.clientX - lookX, dy = event.clientY - lookY;
	  lookX = event.clientX; lookY = event.clientY;
	  if (isJetFlying()) applyJetLookDelta(dx * gameState.settings.sensitivity, dy * gameState.settings.sensitivity);
	  else applyLookDelta(dx, dy);
	}
  }, { passive: false });
  stick.addEventListener('pointerup', event => { if (stickPointer === event.pointerId) clearJoystick(); });
  look.addEventListener('pointerdown', event => {
	if (!mobileDevice || !gameState.settings.mobileControls || gameState.screen !== 'playing'
	  || gameState.inventoryOpen || gameState.mapOpen || gameState.settingsOpen) return;
	event.preventDefault();
	lookPointer = event.pointerId; lookX = event.clientX; lookY = event.clientY;
	look.classList.add('active');
	try { look.setPointerCapture(event.pointerId); } catch (_) { }
  });
  const endLook = event => {
	if (lookPointer === event.pointerId) { lookPointer = null; look.classList.remove('active'); }
  };
  look.addEventListener('pointerup', endLook);
  look.addEventListener('pointercancel', endLook);
  window.addEventListener('blur', () => {
	clearJoystick(); inputState.isPrimaryFireHeld = false; lookPointer = null;
	for (const [pointerId, active] of activeActions) {
	  handleAction(active.action, false, pointerId);
	  active.button.classList.remove('pressed');
	}
	activeActions.clear();
  });
  hooks.syncMobileControls = syncVisibility;
  hooks.persistMobilePreference = () => {
	try { localStorage.setItem(MOBILE_PREF_KEY, gameState.settings.mobileControls ? '1' : '0'); }
	catch (err) { console.warn('[mobile] unable to save touch preference:', err); }
	syncVisibility(true);
  };
  syncVisibility(true);
}
