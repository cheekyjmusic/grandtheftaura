// Optional touch controls for phones and tablets. Desktop input remains unchanged.
import { gameState, hooks, inputState, keys, player } from './state.js';
import { canvas } from './engine.js';
import { openInventoryModal, openMapModal, setScreen, updateHUD } from './ui.js';
import { enterVehicle, exitCurrentCar, getNearestVehicle, shiftVehicleGear } from './vehicles.js';
import { triggerRightHandAttack } from './player.js';
import { applyJetLookDelta, boardJet, dropNuke, isJetFlying, leaveJet, setJetMobileKey, warpToAirBunker } from './aircraft.js';

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

function addStyles() {
  const style = document.createElement('style');
  style.textContent = `
	#mobile-controls { position:fixed; inset:0; z-index:26; display:none; pointer-events:none; touch-action:none; }
	#mobile-controls.visible { display:block; }
	#mobile-look { position:absolute; inset:0 0 0 42%; pointer-events:auto; touch-action:none; }
	.mobile-look-hint { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); color:rgba(255,255,255,.22); font:700 10px Rajdhani,sans-serif; letter-spacing:.18em; pointer-events:none; }
	#mobile-look.active .mobile-look-hint { opacity:0; }
	.mobile-tools,.mobile-stick-wrap,.mobile-actions,.mobile-car-controls { position:absolute; z-index:2; pointer-events:auto; }
	.mobile-tools { top:max(8px,env(safe-area-inset-top)); left:50%; transform:translateX(-50%); display:flex; gap:6px; }
	.mobile-btn { min-width:44px; height:40px; padding:0 10px; border:1px solid rgba(255,255,255,.25); border-radius:14px; color:#f8fafc; background:rgba(8,13,22,.82); font:700 11px Rajdhani,sans-serif; letter-spacing:.06em; touch-action:none; }
	.mobile-btn.primary { border-color:rgba(245,158,11,.65); color:#fcd34d; }
	.mobile-btn:disabled { opacity:.4; }
	.mobile-stick-wrap { left:max(14px,env(safe-area-inset-left)); bottom:max(20px,env(safe-area-inset-bottom)); width:132px; height:132px; border:1px solid rgba(255,255,255,.25); border-radius:50%; background:rgba(8,13,22,.45); touch-action:none; }
	#mobile-stick-thumb { position:absolute; left:50%; top:50%; width:52px; height:52px; margin:-26px; border-radius:50%; background:rgba(56,189,248,.65); border:1px solid rgba(255,255,255,.5); pointer-events:none; }
	.mobile-stick-label { position:absolute; left:50%; bottom:8px; transform:translateX(-50%); color:#cbd5e1; font:700 9px Rajdhani,sans-serif; letter-spacing:.1em; pointer-events:none; }
	.mobile-actions { right:max(14px,env(safe-area-inset-right)); bottom:max(18px,env(safe-area-inset-bottom)); display:grid; grid-template-columns:repeat(3,56px); gap:7px; }
	.mobile-actions .mobile-btn { width:56px; height:52px; border-radius:16px; padding:2px; }
	.mobile-actions .wide { grid-column:span 2; width:auto; }
	.mobile-extra-actions { position:absolute; right:0; bottom:100%; display:grid; grid-template-columns:repeat(3,56px); gap:7px; padding-bottom:7px; }
	.mobile-extra-actions.hidden { display:none !important; }
	.mobile-car-controls { right:max(14px,env(safe-area-inset-right)); bottom:max(18px,env(safe-area-inset-bottom)); display:none; gap:8px; }
	.mobile-car-controls.active { display:flex; }
	.mobile-jet-controls { position:absolute; right:max(14px,env(safe-area-inset-right)); bottom:max(18px,env(safe-area-inset-bottom)); display:none; grid-template-columns:repeat(3,56px); gap:7px; pointer-events:auto; }
	.mobile-jet-controls.active { display:grid; }
	.mobile-drive-pedals { display:grid; grid-template-columns:repeat(2,56px); gap:7px; }
	.mobile-drive-pedals .mobile-btn { width:56px; height:52px; border-radius:16px; padding:2px; }
	#mobile-controls .pressed { background:rgba(245,158,11,.45); }
	@media (orientation:portrait) and (max-width:900px) { #mobile-controls { display:none !important; } }
  `;
  document.head.appendChild(style);
}

function createControls() {
  root = document.createElement('div');
  root.id = 'mobile-controls';
  root.innerHTML = `
	<div id="mobile-look" aria-label="Drag to look"><span class="mobile-look-hint">DRAG TO LOOK</span></div>
	<div class="mobile-tools"><button class="mobile-btn" data-action="fullscreen">FULL</button><button class="mobile-btn primary" data-action="pause">PAUSE</button></div>
	<div class="mobile-stick-wrap" id="mobile-stick" aria-label="Movement joystick"><div id="mobile-stick-thumb"></div><div class="mobile-stick-label">MOVE</div></div>
	<div class="mobile-actions" id="mobile-foot-actions">
	  <button class="mobile-btn primary" data-action="fire">FIRE</button><button class="mobile-btn" data-action="jump">JUMP</button><button class="mobile-btn primary" data-action="interact">USE</button>
	  <button class="mobile-btn" data-action="aim">AIM</button><button class="mobile-btn" data-action="crouch">CROUCH</button><button class="mobile-btn" data-action="more" aria-expanded="false">MORE</button>
	  <div class="mobile-extra-actions hidden" id="mobile-extra-actions"><button class="mobile-btn" data-action="map">MAP</button><button class="mobile-btn" data-action="bag">BAG</button><button class="mobile-btn" data-action="pov">POV</button><button class="mobile-btn" data-action="weapon">WEAPON</button><button class="mobile-btn" data-action="sneak">SNEAK</button><button class="mobile-btn" data-action="strike">STRIKE</button></div>
	</div>
	<div class="mobile-car-controls" id="mobile-car-controls"><button class="mobile-btn" data-action="gear-down">GEAR −</button><div class="mobile-drive-pedals"><button class="mobile-btn primary" data-action="gas">GAS</button><button class="mobile-btn" data-action="brake">BRAKE</button><button class="mobile-btn" data-action="drift">DRIFT</button><button class="mobile-btn" data-action="exit">EXIT</button></div><button class="mobile-btn" data-action="gear-up">GEAR +</button></div>
	<div class="mobile-jet-controls" id="mobile-jet-controls"><button class="mobile-btn primary" data-action="jet-throttle-up">THR +</button><button class="mobile-btn" data-action="jet-pitch-up">PULL UP</button><button class="mobile-btn" data-action="jet-afterburner">BOOST</button><button class="mobile-btn" data-action="jet-rudder-left">YAW ◀</button><button class="mobile-btn primary" data-action="jet-cannon">GUN</button><button class="mobile-btn" data-action="jet-rudder-right">YAW ▶</button><button class="mobile-btn" data-action="jet-throttle-down">THR −</button><button class="mobile-btn" data-action="jet-pitch-down">DIVE</button><button class="mobile-btn" data-action="jet-nuke">NUKE</button><button class="mobile-btn" data-action="jet-camera">CAM</button><button class="mobile-btn" data-action="jet-invert">INVERT</button><button class="mobile-btn" data-action="jet-exit">EJECT</button></div>`;
  document.body.appendChild(root);
}

function onFootAction(action) {
  if (gameState.screen !== 'playing') return;
  if (action === 'fire') {
	if (gameState.activeRightWeapon === 'hotdog_shooter') inputState.isPrimaryFireHeld = true;
	else triggerRightHandAttack();
  }  else if (action === 'crouch') { player.crouching = !player.crouching; updateHUD(true); }
  else if (action === 'interact') {
	if (isJetFlying()) leaveJet();
	else if (boardJet()) return;
	else if (gameState.inCar) exitCurrentCar();
	else {
	  const near = getNearestVehicle(4.2);
	  if (near) enterVehicle(near.idx);
	  else if (!gameState.inventoryOpen && !gameState.mapOpen && !gameState.settingsOpen) openInventoryModal();
	}
  } else if (action === 'aim' && gameState.activeRightWeapon === 'hotdog_shooter' && !gameState.inCar) {
	gameState.isAiming = !gameState.isAiming;
	updateHUD(true);
  } else if (action === 'map') gameState.mapOpen ? hooks.closeMapModal() : openMapModal();
  else if (action === 'bag') gameState.inventoryOpen ? hooks.closeInventoryModal() : openInventoryModal();
  else if (action === 'pov') { gameState.thirdPerson = !gameState.thirdPerson; updateHUD(true); }
  else if (action === 'weapon') hooks.cycleRightWeapon(1);
  else if (action === 'strike') warpToAirBunker();
  else if (action === 'jet-nuke') dropNuke();
  else if (action === 'jet-camera' && down) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyV' }));
  } else if (action === 'jet-invert' && down) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyY' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyY' }));
  } else if (action === 'jet-exit') leaveJet();
  else if (action === 'sneak') setHeldKey('KeyG', true, 'tap');
  else if (action === 'more') {
	const drawer = document.getElementById('mobile-extra-actions');
	const open = drawer.classList.toggle('hidden') === false;
	root.querySelector('[data-action="more"]').setAttribute('aria-expanded', String(open));
  } else if (action === 'pause') setScreen(gameState.screen === 'paused' ? 'playing' : 'paused');
  else if (action === 'fullscreen') {
	const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
	if (request?.catch) request.catch(err => console.warn('[mobile] fullscreen request failed:', err));
  }
}

function handleAction(action, down, pointerId) {
  const source = `pointer-${pointerId}`;
  const held = { gas: 'KeyW', brake: 'KeyS', drift: 'Space', sneak: 'KeyG', jump: 'Space', 'jet-throttle-up': 'KeyW', 'jet-throttle-down': 'KeyS', 'jet-afterburner': 'ShiftLeft', 'jet-pitch-up': 'ArrowUp', 'jet-pitch-down': 'ArrowDown', 'jet-rudder-left': 'KeyQ', 'jet-rudder-right': 'KeyE' }[action];
  if (action.startsWith('jet-') && held) { setJetMobileKey(held, down); return; }
  if (held) { setHeldKey(held, down, source); return; }
  if (action === 'jet-cannon') { setJetMobileKey('M0', down); return; }
  if (action === 'fire') {
	if (isJetFlying()) setJetMobileKey('M0', down);
	else if (down && gameState.activeRightWeapon === 'hotdog_shooter') inputState.isPrimaryFireHeld = true;
	else if (!down) inputState.isPrimaryFireHeld = false;
	else onFootAction(action);
	return;
  }
  if (down) {
	if (action === 'gear-up') shiftVehicleGear(1);
	else if (action === 'gear-down') shiftVehicleGear(-1);
	else if (action === 'exit') exitCurrentCar();
	else onFootAction(action);
  }
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
  const visible = gameState.settings.mobileControls && gameState.screen === 'playing'
	&& !gameState.inventoryOpen && !gameState.mapOpen && !gameState.settingsOpen;
  root.classList.toggle('visible', visible);
  document.getElementById('lock-hint').style.display = visible || document.pointerLockElement === canvas ? 'none' : 'block';
  const jetFlying = isJetFlying();
  document.getElementById('mobile-foot-actions').style.display = gameState.inCar || jetFlying ? 'none' : 'grid';
  document.getElementById('mobile-car-controls').classList.toggle('active', gameState.inCar && !jetFlying);
  document.getElementById('mobile-jet-controls').classList.toggle('active', jetFlying);
  const useButton = root.querySelector('[data-action="interact"]');
  if (useButton) useButton.textContent = gameState.inCar ? 'EXIT' : 'USE';
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
  addStyles();
  createControls();
  const look = document.getElementById('mobile-look');
  const stick = document.getElementById('mobile-stick');
  root.addEventListener('pointerdown', event => {
	const button = event.target.closest('[data-action]');
	if (!button || !gameState.settings.mobileControls) return;
	event.preventDefault();
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
	  else {
		player.yaw -= dx * 0.0023 * gameState.settings.sensitivity;
		player.pitch = Math.max(-1.42, Math.min(1.42, player.pitch - dy * 0.0023 * gameState.settings.sensitivity));
	  }
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
