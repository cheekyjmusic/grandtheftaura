// =============================================================================
// aircraft.js — Aura Air bunker, Chapin strike jet, flight, weapons and map/HUD integration.
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
const GEAR = 1.6, STALL = 36, ROTATE = 46, MAX_SPEED = 135, AFTERBURNER_SPEED = 200;
const Z_FORWARD = new THREE.Vector3(0, 0, 1), X_LEFT = new THREE.Vector3(1, 0, 0), Y_UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

let initialized = false;
let bunker = null;
let jet = null;
let flame = [];
let chute = null;
let chuteActive = false;
let stepOverride = false;

const jetState = {
  flying: false, pos: new THREE.Vector3(-384, AIRFIELD.y + GEAR, AIRFIELD.rz),
  q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)),
  speed: 0, throttle: 0, afterburner: false, sink: 0, ground: true, gp: 0,
  hull: 100, nukes: 4, sx: 0, sy: 0, pitchRate: 0, rollRate: 0, yawRate: 0,
  inverted: false, cameraMode: 0, cameraQ: new THREE.Quaternion(), gunTimer: 0,
  nukeCooldown: 0, muzzle: 0, help: 0, dead: 0, warningTimer: 0, tipShown: false,
  warning: '', agl: 0, verticalSpeed: 0, au: null
};
const keysJet = {};
const bombs = [];
const effects = [];
const beaconMeshes = [];

function groundHeight(x, z) {
if (x < -196 && x > -560 && z > -172 && z < 172) return hillsH(x, z);
if (z < -170 && z > -590 && x > -138 && x < 370) return Math.max(0.18, terrainH(x, z));
if (x >= 368 && x <= 533 && z >= -180 && z <= 240) return 1.5;
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

function solid(x0, x1, y0, y1, z0, z1) {
  return addWorldBox(x0, x1, y0, y1, z0, z1, 'solid', false);
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
  for (let x = -342; x < -215; x += 14) box(bunker, paint, x, fy + 0.21, rz, 7, 0.02, 0.5);
  for (const s of [-1, 1]) {
	box(bunker, paint, -281.5, fy + 0.21, rz + s * 11, 147, 0.02, 0.35);
	for (let x = -345; x < -208; x += 18) box(bunker, lamp, x, fy + 0.3, rz + s * 12.3, 0.4, 0.25, 0.4);
  }
  for (let k = -4; k <= 4; k++) if (k) box(bunker, paint, -211, fy + 0.21, rz + k * 2.4 - Math.sign(k) * 1.2, 10, 0.02, 1.1);
  box(bunker, yellow, -361, fy + 0.21, rz, 10, 0.02, 0.4);

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

  for (let i = 0; i < 12; i++) {
	const z = hz0 + 2 + i * (hz1 - hz0 - 4) / 11;
	const r = new THREE.Mesh(new THREE.IcosahedronGeometry(2.8 + (i % 3) * 0.55, 1), rock);
	r.position.set(-365 + (i % 2) * 7, fy + 11.5 + (i % 3) * 1.1, z);
	r.scale.set(1.3, 1.15, 1.05); bunker.add(r);
  }
  for (const z of [-126, -121.5, -116.5, -95.5, -90.5, -86]) {
	const r = new THREE.Mesh(new THREE.IcosahedronGeometry(2.9, 1), rock);
	r.position.set(hx0 - 1.2, fy + (z < -116 || z > -96 ? 11.5 : 9.5), z);
	r.scale.set(1.2, 1.15, 1.15); bunker.add(r);
  }
  for (let i = 0; i < 7; i++) {
	const r = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2 + (i % 2) * 0.7, 1), rock);
	r.position.set(hx0 - 5 - (i % 3), fy + 13.4, -123 + i * 6.2);
	r.scale.set(1.35, 0.72, 1.25); bunker.add(r);
  }
  for (let i = 0; i < 9; i++) {
	const r = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2 + (i % 3) * 0.7, 0), rock);
	r.position.set(-402 + i * 5.5, fy + 13.6, i % 2 ? -124 : -88);
	r.scale.y = 0.6; bunker.add(r);
  }
  const sign = new THREE.Group(); sign.position.set(hx1 + 0.15, fy + 12, rz); sign.rotation.y = Math.PI / 2;
  createNeonSign(sign, 'AURA AIR BUNKER', 0, 0, 0, '#111827', '#fcd34d', 16, 1.8); scene.add(sign);
  beaconMeshes.push(box(bunker, red, hx1 + 0.4, fy + 10.4, -119.6, 0.5, 0.5, 0.5), box(bunker, red, hx1 + 0.4, fy + 10.4, -92.4, 0.5, 0.5, 0.5));
  for (const z of [-116, -106, -96]) box(bunker, lamp, -382, fy + 10.8, z, 44, 0.15, 0.7);

  const hl1 = new THREE.PointLight(0xfff0d0, 320, 70, 2); hl1.position.set(-382, fy + 9, rz); scene.add(hl1);
  const hl2 = new THREE.PointLight(0xfff0d0, 150, 50, 2); hl2.position.set(-365, fy + 8, rz); scene.add(hl2);
  box(bunker, yellow, -384, fy + 0.2, rz, 22, 0.02, 0.3);
  box(bunker, yellow, -384, fy + 0.2, rz - 8, 22, 0.02, 0.3);
  box(bunker, yellow, -384, fy + 0.2, rz + 8, 22, 0.02, 0.3);
  for (const [x, z, s] of [[-362, -122, 4], [-362, -117, 3], [-362, -91, 4]]) {
	box(bunker, material(0x6b4a2f), x, fy + s / 2 + 0.1, z, s, s, s);
	solid(x - s / 2, x + s / 2, fy, fy + s, z - s / 2, z + s / 2);
  }
  for (let i = 0; i < 5; i++) {
	const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.2, 10), material(i % 2 ? 0x2f5d8c : 0xa23b2a));
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

function buildJet() {
  jet = new THREE.Group();
  const body = material(0x6f7985, { metalness: 0.55, roughness: 0.38 });
  const dark = material(0x2b3038, { metalness: 0.6, roughness: 0.4 });
  const red = material(0xd92b2b, { roughness: 0.5 });
  const canopy = material(0x0d2236, { metalness: 0.9, roughness: 0.08, emissive: 0x07121d });
  const double = material(0x59616c, { metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide });
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
	for (const [radius, color, opacity] of [[0.46, 0xffa94a, 0.8], [0.26, 0xfff4cc, 0.95]]) {
	  const fire = new THREE.Mesh(new THREE.ConeGeometry(radius, 1, 10), basic(color, { transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
	  fire.geometry.translate(0, 0.5, 0); const pivot = new THREE.Group(); pivot.position.set(s * 0.72, -0.05, -7.4); pivot.rotation.x = -Math.PI / 2; pivot.add(fire); jet.add(pivot); flame.push(pivot);
	}
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
  scene.add(jet);
}

function placePlayerAt(x, z, fx, fz) {
  for (const [ox, oz] of [[0,0],[2,0],[-2,0],[0,2],[0,-2],[4,4],[-4,-4],[6,0],[0,6],[-6,0],[0,-6]]) {
	const px = x + ox, pz = z + oz, g = groundHeight(px, pz), y = computeSupportFloor(px, pz, g + 0.5, 0.42);
	if (!collidesHorizontally(px, pz, y, 1.75, 0.42)) { player.x = px; player.y = y; player.z = pz; break; }
  }
  player.vy = 0; player.pvx = 0; player.pvz = 0; player.grounded = true; player.peakAirY = player.y; player.pitch = 0;
  player.yaw = Math.atan2(-fx, -fz);
}

function hangarSpawn() { placePlayerAt(-395, -106, 1, 0); }

function nearJet() {
  return jetState.dead <= 0 && !jetState.flying && !gameState.inCar && !meteorDrop.active
	&& Math.hypot(player.x - jetState.pos.x, player.z - jetState.pos.z) < 7
	&& Math.abs(player.y - (jetState.pos.y - GEAR)) < 3.5;
}

export function isJetFlying() { return jetState.flying; }
export function isNearJet() { return nearJet(); }
export function getJetState() { return jetState; }
export function warpToAirBunker() {
  if (gameState.inCar || meteorDrop.active || jetState.flying) return false;
  hangarSpawn(); pushFeed('WARPED TO THE AURA AIR BUNKER — FACE THE HANGAR AND GO IN', 'border-l-sky-400'); return true;
}

function resetJet() {
  jetState.pos.set(-384, AIRFIELD.y + GEAR, AIRFIELD.rz);
  jetState.q.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
  Object.assign(jetState, { speed: 0, throttle: 0, sink: 0, ground: true, gp: 0, hull: 100, nukes: 4, dead: 0, pitchRate: 0, rollRate: 0, yawRate: 0, sx: 0, sy: 0 });
  jet.visible = true; if (chute) chute.visible = false; chuteActive = false;
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
  const fr = 40 + jetState.throttle * 60 + (jetState.afterburner ? 22 : 0);
  a.o1.frequency.setTargetAtTime(fr, t, 0.08); a.o2.frequency.setTargetAtTime(fr * 0.5, t, 0.08);
  a.filter.frequency.setTargetAtTime(220 + jetState.throttle * 700, t, 0.1);
  a.gain.gain.setTargetAtTime(0.03 + jetState.throttle * 0.05, t, 0.1);
  a.noiseFilter.frequency.setTargetAtTime(600 + jetState.speed * 5, t, 0.1);
  a.noiseGain.gain.setTargetAtTime(0.01 + jetState.throttle * 0.05 + jetState.speed * 0.0002 + (jetState.afterburner ? 0.04 : 0), t, 0.1);
}

export function boardJet() {
  if (!nearJet()) return false;
  jetState.flying = true; inputState.isPrimaryFireHeld = false; gameState.isAiming = false; player.crouching = false;
  hooks.syncMobileControls(true);
  jetState.sx = jetState.sy = 0; jetState.cameraMode = 0; jetState.cameraQ.copy(jetState.q); jetState.help = 14;
  if (jetState.pos.x > -425 && jetState.pos.x < -356 && Math.abs(jetState.pos.z - AIRFIELD.rz) < 22 && (jetState.nukes < 4 || jetState.hull < 100)) {
	jetState.nukes = 4; jetState.hull = 100; pushFeed('JET REARMED, REPAIRED & REFUELED', 'border-l-emerald-400');
  }
  sfx.unlock(); startEngineAudio();
  const hud = document.getElementById('jet-hud'); if (hud) hud.style.display = 'block';
  pushFeed('STRIKE JET READY — W/S THROTTLE, A/D ROLL, MOUSE/ARROWS TO FLY', 'border-l-sky-400'); return true;
}

export function endJetFlight() {
  jetState.flying = false; engineAudio(false);
  for (const code in keysJet) keysJet[code] = false;
  hooks.syncMobileControls(true);
  const hud = document.getElementById('jet-hud'); if (hud) hud.style.display = 'none';
  const crosshair = document.getElementById('crosshair'); if (crosshair) crosshair.style.display = '';
  camera.up.set(0, 1, 0); camera.rotation.z = 0; camera.fov = 72; camera.near = 0.14; camera.far = 520; camera.updateProjectionMatrix();
  if (jet.userData.can) jet.userData.can.visible = true;
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
  if (jetState.ground && jetState.speed < 12) {
	endJetFlight(); jetState.speed = 0; jetState.throttle = 0;
	const left = X_LEFT.clone().applyQuaternion(jetState.q); placePlayerAt(jetState.pos.x + left.x * 7, jetState.pos.z + left.z * 7, -left.x, -left.z);
	pushFeed('EXITED THE STRIKE JET', 'border-l-sky-400');
  } else {
	boom(jetState.pos, 0.5); endJetFlight(); jet.visible = false; jetState.dead = 5;
	chute = chute || buildParachute(); chute.visible = true; chuteActive = true;
	player.x = jetState.pos.x; player.z = jetState.pos.z; player.y = jetState.pos.y; player.vy = -12; player.pvx = player.pvz = 0; player.grounded = false; player.peakAirY = player.y;
	jetState.speed = 0; jetState.throttle = 0; pushFeed('EJECTED — PARACHUTE DEPLOYED', 'border-l-sky-400');
  }
}

function crash(message) {
  boom(jetState.pos, 1); endJetFlight(); jet.visible = false; jetState.dead = 5; hangarSpawn();
  pushFeed(`${message} — EJECTED SAFELY. NEW JET WILL BE READY AT THE BUNKER.`, 'border-l-rose-500');
}

export function damageJet(amount) { jetState.hull = Math.max(0, jetState.hull - amount * 0.8); flashEdge('rgba(239,68,68,.48)'); if (jetState.hull <= 0) crash('JET DESTROYED'); }

function rayHit(origin, direction, maxDistance) {
  let best = maxDistance;
  for (const b of worldBoxes) {
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
  let previous=0;
  for(let s=6;s<=best+6;s+=6){const end=Math.min(s,best);if(origin.y+direction.y*end<groundHeight(origin.x+direction.x*end,origin.z+direction.z*end)){let lo=previous,hi=end;for(let i=0;i<6;i++){const m=(lo+hi)/2;if(origin.y+direction.y*m<groundHeight(origin.x+direction.x*m,origin.z+direction.z*m))hi=m;else lo=m;}return hi;}previous=end;if(end>=best)break;}return best;
}

function impact(x,y,z) {
  spawnParticles(x,y+0.3,z,0xffb347,4,6); if(Math.random()<0.3) spawnParticles(x,y+0.2,z,0x8a7a66,3,4);
  for(const n of npcs) if(n.spawned!==false&&Math.hypot(n.x-x,n.z-z)<3.4&&Math.abs(groundHeight(n.x,n.z)-y)<6) damageNpc(n,30,Math.atan2(n.x-x,n.z-z));
  for(const c of AO.cops.slice()) if(c.hp>0&&Math.hypot(c.x-x,c.z-z)<3.4) hurtCop(c,34);
  for(const c of AO.cars) if(Math.hypot(c.x-x,c.z-z)<4.5){c.hp-=40;spawnParticles(c.x,1,c.z,0xf97316,5,6);}
}

let gunTimerInternal=0;
function fireCannon(dt) {
  gunTimerInternal-=dt;if(gunTimerInternal>0)return;gunTimerInternal=1/17;jetState.muzzle=0.05;
  for(const s of [-1,1]){
	const origin=new THREE.Vector3(s*1.15,-0.15,2.8).applyQuaternion(jetState.q).add(jetState.pos);
	const direction=Z_FORWARD.clone().applyQuaternion(jetState.q);direction.x+=(Math.random()-0.5)*0.008;direction.y+=(Math.random()-0.5)*0.008;direction.normalize();
	const distance=rayHit(origin,direction,900);const end=origin.clone().addScaledVector(direction,Math.min(distance,170));
	// tracer line; remove after 70 ms
	const geo=new THREE.BufferGeometry().setFromPoints([origin.clone().addScaledVector(direction,14),end]);
	const line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:0xffd24a,transparent:true,opacity:0.9}));worldRoot.add(line);setTimeout(()=>{worldRoot.remove(line);geo.dispose();line.material.dispose();},70);
	if(distance<900)impact(end.x,end.y,end.z);
  }
  sfx.tone(170+Math.random()*50,70,0.07,'square',0.045);
}

export function dropNuke() {
  if(jetState.nukes<=0){pushFeed('OUT OF NUKES — LAND AT THE AURA AIR BUNKER TO REARM','border-l-amber-400');return false;}if(jetState.nukeCooldown>0)return false;
  jetState.nukes--;jetState.nukeCooldown=1.5;
  const group=new THREE.Group(),ol=material(0x3a4234,{metalness:0.4,roughness:0.5});
  const body=new THREE.Mesh(new THREE.CylinderGeometry(0.38,0.38,2.6,12),ol);body.rotation.x=Math.PI/2;group.add(body);
  const cone=new THREE.Mesh(new THREE.ConeGeometry(0.38,1,12),ol);cone.rotation.x=Math.PI/2;cone.position.z=1.8;group.add(cone);
  scene.add(group);const position=new THREE.Vector3(0,-1.9,0.6).applyQuaternion(jetState.q).add(jetState.pos),velocity=Z_FORWARD.clone().applyQuaternion(jetState.q).multiplyScalar(jetState.speed);
  group.position.copy(position);bombs.push({mesh:group,position,velocity});sfx.tone(1700,400,3,'sine',0.05);pushFeed('☢ NUKE AWAY — GET CLEAR!','border-l-red-500');return true;
}

function boom(position,scale) {
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,16,12),basic(0xff9a2a,{transparent:true,opacity:0.95,depthWrite:false}));mesh.position.copy(position);scene.add(mesh);effects.push({mesh,time:0,life:1.3,scale});
  [0xf97316,0xfacc15,0xef4444,0x4b5563].forEach(c=>spawnParticles(position.x,position.y,position.z,c,12,16));sfx.tone(130,25,1.2,'sawtooth',0.3);sfx.tone(70,20,1.6,'sine',0.35);
}

function detonateBomb(position) {
  const radius=55;boom(position,2.2);
  for(const n of npcs) if(n.spawned!==false&&Math.hypot(n.x-position.x,n.z-position.z)<radius)damageNpc(n,100,Math.atan2(n.x-position.x,n.z-position.z));
  for(const c of AO.cops.slice()) if(Math.hypot(c.x-position.x,c.z-position.z)<radius)hurtCop(c,100);
  for(const c of AO.cars) if(Math.hypot(c.x-position.x,c.z-position.z)<radius)c.hp-=100;
}

function updateBombs(dt) {
  for(const bomb of bombs.slice()){bomb.velocity.y-=18*dt;const movement=bomb.velocity.clone().multiplyScalar(dt),length=movement.length(),direction=movement.clone().normalize();const hit=rayHit(bomb.position,direction,length);
	if(hit<length){const impactPos=bomb.position.clone().addScaledVector(direction,hit);scene.remove(bomb.mesh);detonateBomb(impactPos);bombs.splice(bombs.indexOf(bomb),1);}
	else{bomb.position.add(movement);bomb.mesh.position.copy(bomb.position);bomb.mesh.quaternion.setFromUnitVectors(Z_FORWARD,direction);}
  }
  for(const fx of effects.slice()){fx.time+=dt;const k=fx.time/fx.life;fx.mesh.scale.setScalar(2+22*fx.scale*Math.min(1,k*1.6));fx.mesh.material.opacity=Math.max(0,0.95*(1-k));if(k>=1){scene.remove(fx.mesh);fx.mesh.geometry.dispose();fx.mesh.material.dispose();effects.splice(effects.indexOf(fx),1);}}
}

function jetUpdate(dt) {
  const forward=Z_FORWARD.clone().applyQuaternion(jetState.q),left=X_LEFT.clone().applyQuaternion(jetState.q),up=Y_UP.clone().applyQuaternion(jetState.q),key=c=>keysJet[c]?1:0;
  const rawPitch=clamp((key('ArrowUp')-key('ArrowDown'))*(jetState.inverted?-1:1)+jetState.sy,-1,1);
  const rawRoll=clamp(key('KeyD')-key('KeyA')+jetState.sx,-1,1);const rawYaw=key('KeyE')-key('KeyQ')+(key('ArrowRight')-key('ArrowLeft'))*0.35;
  const ease=1-Math.exp(-dt*7);jetState.pitchRate+=(rawPitch-jetState.pitchRate)*ease;jetState.rollRate+=(rawRoll-jetState.rollRate)*ease;jetState.yawRate+=(clamp(rawYaw,-1,1)-jetState.yawRate)*ease;
  jetState.sx*=Math.exp(-dt*3.2);jetState.sy*=Math.exp(-dt*3.2);
  const throttleTarget=key('KeyW')-key('KeyS');jetState.throttle=clamp(jetState.throttle+(throttleTarget>0?0.42:throttleTarget<0?-0.55:0)*dt,0,1);
  jetState.afterburner=(keysJet.ShiftLeft||keysJet.ShiftRight)&&jetState.throttle>0.7;
  const target=jetState.throttle*MAX_SPEED+(jetState.afterburner?AFTERBURNER_SPEED-MAX_SPEED:0),deceleration=jetState.ground?(key('KeyS')&&jetState.throttle<0.02?45:5):10;
  jetState.speed=clamp(jetState.speed+clamp(target-jetState.speed,-deceleration*dt,(jetState.afterburner?45:26)*dt)-forward.y*16*dt,0,260);
  const authority=Math.min(1,0.3+jetState.speed/70),px=jetState.pos.x,py=jetState.pos.y,pz=jetState.pos.z;jetState.warning='';
  if(!jetState.ground){const roll=Math.atan2(left.y,up.y);let pitch=jetState.pitchRate*1.25*authority,rollInput=jetState.rollRate*2.8*authority,yaw=(jetState.yawRate*0.5+left.y*0.4)*authority;if(Math.abs(jetState.rollRate)<0.05)rollInput-=clamp(roll,-1.2,1.2)*(1-0.9*Math.abs(jetState.pitchRate));
	if(jetState.speed<STALL){pitch-=0.7*(1-jetState.speed/STALL);jetState.sink=Math.min(70,jetState.sink+16*(1-jetState.speed/STALL)*dt);jetState.warning='STALL';}else jetState.sink*=Math.exp(-dt*4);if(jetState.pos.y>650)pitch-=((jetState.pos.y-650)*0.004);
	const euler=new THREE.Euler(-pitch*dt,-yaw*dt,rollInput*dt,'XYZ'),dq=new THREE.Quaternion().setFromEuler(euler);jetState.q.multiply(dq).normalize();
	if(jetState.pos.x<-680||jetState.pos.x>480||jetState.pos.z<-700||jetState.pos.z>300){const tx=-100-jetState.pos.x,tz=-200-jetState.pos.z,c=tx*forward.z-tz*forward.x;const turn=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,Math.sign(c||1)*1.3*dt,0));jetState.q.premultiply(turn);jetState.warning='LEAVING AIRSPACE — TURN BACK';}}
  else{const steer=clamp(jetState.rollRate+jetState.yawRate,-1,1)*0.75*Math.min(1,jetState.speed/18);const heading=Math.atan2(forward.x,forward.z)-steer*dt,slopes=Math.atan((groundHeight(jetState.pos.x+forward.x*5,jetState.pos.z+forward.z*5)-groundHeight(jetState.pos.x-forward.x*5,jetState.pos.z-forward.z*5))/10);
	if(jetState.speed>=ROTATE)jetState.gp=clamp(jetState.gp+(jetState.pitchRate*0.8+(jetState.speed>75?0.25:0))*dt,0,0.5);else jetState.gp=Math.max(0,jetState.gp-dt);
	const dq=new THREE.Quaternion().setFromEuler(new THREE.Euler(-(slopes+jetState.gp),heading,0,'YXZ'));jetState.q.slerp(dq,1-Math.exp(-dt*8));if(jetState.gp>0.07&&jetState.speed>=ROTATE){jetState.ground=false;jetState.sink=0;}}
  forward.copy(Z_FORWARD).applyQuaternion(jetState.q);jetState.pos.addScaledVector(forward,jetState.speed*dt);if(!jetState.ground)jetState.pos.y-=jetState.sink*dt;
  const gh=groundHeight(jetState.pos.x,jetState.pos.z);jetState.agl=jetState.pos.y-GEAR-gh;jetState.verticalSpeed=forward.y*jetState.speed-jetState.sink;if(jetState.ground)jetState.pos.y=gh+GEAR;
  else if(jetState.agl<=0&&(jetState.verticalSpeed<=0.2||jetState.agl<-1.5)){const ahead=(groundHeight(jetState.pos.x+forward.x*6,jetState.pos.z+forward.z*6)-gh)/6;if(jetState.verticalSpeed>-15&&forward.y>-0.2&&forward.y<0.45&&ahead<0.3&&jetState.speed<170&&jetState.agl>-1.5){jetState.ground=true;jetState.gp=0;jetState.sink=0;jetState.pos.y=gh+GEAR;pushFeed('TOUCHDOWN','border-l-emerald-400');}else return crash('CRASHED');}
  else if(jetState.agl<140&&jetState.verticalSpeed<-28)jetState.warning='PULL UP';
  for(const b of worldBoxes){if(b.maxY-b.minY<2.2||jetState.pos.x+2.6<b.minX||jetState.pos.x-2.6>b.maxX||jetState.pos.z+2.6<b.minZ||jetState.pos.z-2.6>b.maxZ||jetState.pos.y+1.4<b.minY||jetState.pos.y-1.2>b.maxY)continue;if(jetState.ground&&jetState.speed<20){jetState.pos.set(px,py,pz);jetState.speed*=0.2;break;}return crash('COLLISION');}
  jetState.nukeCooldown=Math.max(0,jetState.nukeCooldown-dt);jetState.muzzle=Math.max(0,jetState.muzzle-dt);if(keysJet.M0||keysJet.Space)fireCannon(dt);
}

function buildHUD() {
  if(document.getElementById('jet-hud'))return;
  const hud=document.createElement('div');hud.id='jet-hud';hud.innerHTML='<div id="jh-ret"></div><div class="p" style="top:14px;left:50%;transform:translateX(-50%)">HDG <span id="jh-hdg">N</span></div><div id="jh-warn"></div><div class="p" style="left:24px;top:50%;transform:translateY(-50%)"><b id="jh-spd">0</b>KM/H</div><div class="p" style="right:24px;top:50%;transform:translateY(-50%)"><b id="jh-alt">0</b>ALT M · AGL <span id="jh-agl">0</span></div><div class="p" style="bottom:22px;left:50%;transform:translateX(-50%);display:flex;gap:18px;align-items:center"><div>THROTTLE <span id="jh-ab">AB</span><div class="jbar"><i id="jh-thr"></i></div></div><div>HULL<div class="jbar"><i id="jh-hull"></i></div></div><div>NUKES <span id="jh-nuke"></span></div></div><div class="p" id="jh-help" style="left:24px;bottom:22px;text-align:left;line-height:1.55;font-size:11px">W/S THROTTLE · SHIFT AFTERBURNER · MOUSE PITCH/ROLL<br>A/D ROLL · Q/E RUDDER · LMB/SPACE CANNON · B NUKE · V CAMERA · F EXIT</div>';document.body.appendChild(hud);
  const style=document.createElement('style');style.textContent='#jet-hud{position:fixed;inset:0;display:none;pointer-events:none;z-index:24;font:700 13px Rajdhani,Inter,sans-serif;letter-spacing:.1em;color:#a7ffc8;text-shadow:0 0 6px rgba(80,255,150,.6)}#jet-hud .p{position:absolute;padding:6px 12px;background:rgba(6,16,12,.55);border:1px solid rgba(120,255,180,.35);border-radius:8px;text-align:center}#jet-hud b{font-size:26px;display:block;line-height:1}#jh-ret{position:absolute;width:54px;height:54px;margin:-27px 0 0 -27px;border:2px solid #a7ffc8;border-radius:50%;opacity:.85}#jh-warn{position:absolute;top:70px;left:50%;transform:translateX(-50%);font-size:24px;color:#fca5a5}.jbar{width:150px;height:8px;background:rgba(255,255,255,.15);border-radius:4px;overflow:hidden;margin-top:4px}.jbar i{display:block;height:100%}';document.head.appendChild(style);
}

function jetCamera(dt) {
  jetState.cameraQ.slerp(jetState.q,1-Math.exp(-dt*5.5));const q=jetState.cameraMode?jetState.q:jetState.cameraQ;const up=Y_UP.clone().applyQuaternion(q),forward=Z_FORWARD.clone().applyQuaternion(jetState.q);let position;
  if(jetState.cameraMode)position=new THREE.Vector3(0,1.2,2.4).applyQuaternion(jetState.q).add(jetState.pos);else position=jetState.pos.clone().addScaledVector(Z_FORWARD.clone().applyQuaternion(q),-(15+jetState.speed*0.04)).addScaledVector(up,5.2);
  const shake=(jetState.muzzle>0?0.06:0)+(jetState.afterburner?0.06:0);if(shake){position.x+=(Math.random()-0.5)*shake*3;position.y+=(Math.random()-0.5)*shake*3;}position.y=Math.max(position.y,groundHeight(position.x,position.z)+1.5);
  camera.up.copy(up);camera.position.copy(position);camera.lookAt(jetState.cameraMode?position.x+forward.x*50:jetState.pos.x+forward.x*35,jetState.cameraMode?position.y+forward.y*50:jetState.pos.y+forward.y*35,jetState.cameraMode?position.z+forward.z*50:jetState.pos.z+forward.z*35);
  const targetFov=70+jetState.speed/200*16+(jetState.afterburner?4:0);camera.fov+=(targetFov-camera.fov)*Math.min(1,dt*6);camera.near=0.4;camera.far=1400;camera.updateProjectionMatrix();camera.updateMatrixWorld();
}

function jetHUD(elapsed) {
  const set=(id,value)=>{const e=document.getElementById(id);if(e)e.textContent=value};set('jh-spd',Math.round(jetState.speed*3.6));set('jh-alt',Math.round(jetState.pos.y));set('jh-agl',Math.max(0,Math.round(jetState.agl||0)));
  const thr=document.getElementById('jh-thr');if(thr)thr.style.width=jetState.throttle*100+'%';const ab=document.getElementById('jh-ab');if(ab)ab.style.opacity=jetState.afterburner?1:0.25;const hull=document.getElementById('jh-hull');if(hull)hull.style.width=jetState.hull+'%';set('jh-nuke','☢'.repeat(jetState.nukes)||'—');
  const warning=document.getElementById('jh-warn');if(warning){warning.textContent=jetState.warning||'';warning.style.opacity=jetState.warning&&Math.sin(elapsed*14)>-0.3?1:0;}const help=document.getElementById('jh-help');if(help)help.style.display=jetState.help>0?'block':'none';
}

function jetVisuals(elapsed) {
  jet.position.copy(jetState.pos);jet.quaternion.copy(jetState.q);jet.userData.gear.visible=jetState.ground||((jetState.agl||99)<14&&jetState.speed<90);jet.userData.bomb.visible=jetState.nukes>0;
  if(jet.userData.can)jet.userData.can.visible=!(jetState.flying&&jetState.cameraMode);
  const len=jetState.flying?0.5+jetState.throttle*2.2+(jetState.afterburner?2.6:0):0.05;flame.forEach((pivot,i)=>pivot.scale.y=Math.max(0.05,len*(i%2?0.7:1)*(0.85+Math.random()*0.3)));for(const m of jet.userData.muzzle)m.visible=jetState.muzzle>0;
}

export function getAircraftInteractionHint() { if(jetState.flying)return ''; if(nearJet())return '[F] BOARD STRIKE JET'; return ''; }

export function setJetMobileKey(code,down) { keysJet[code]=!!down; }
export function applyJetLookDelta(dx,dy) {
  if(!jetState.flying)return;
  jetState.sx=clamp(jetState.sx+dx*0.0026,-1,1);
  jetState.sy=clamp(jetState.sy-dy*0.0026*(jetState.inverted?-1:1),-1,1);
}

export function initAircraft() {
  if(initialized)return jetState;
  initialized=true;buildBunker();buildJet();buildHUD();resetJet();jetVisuals(0);
  const previousHint = aura.ahHint;
  aura.ahHint = () => getAircraftInteractionHint() || (previousHint ? previousHint() : '');
  hooks.drawAircraftMapOverlay = drawAircraftMapOverlay;
  hooks.setAircraftScreen = setAircraftScreen;
  window.addEventListener('keydown',event=>{
	keysJet[event.code]=true;if(gameState.screen!=='playing')return;
	if(event.code==='KeyF'){if(jetState.flying){event.stopImmediatePropagation();event.preventDefault();if(!event.repeat)leaveJet();}else if(nearJet()){event.stopImmediatePropagation();if(!event.repeat)boardJet();}return;}
	if(event.code==='KeyJ'&&!jetState.flying&&!gameState.inCar&&!meteorDrop.active&&!event.repeat&&!gameState.inventoryOpen&&!gameState.mapOpen&&!gameState.settingsOpen){event.stopImmediatePropagation();event.preventDefault();warpToAirBunker();return;}
	if(!jetState.flying)return;if(event.code==='KeyH')jetState.help=jetState.help>0?0:999;else if(event.code==='KeyY'&&!event.repeat){jetState.inverted=!jetState.inverted;pushFeed(jetState.inverted?'PITCH INVERTED':'PITCH NORMAL','border-l-sky-400');}
	if(['KeyE','KeyQ','KeyB','KeyN','KeyV','KeyC','KeyU','KeyI','KeyK','KeyM','KeyG','KeyJ','Space','Digit1','Digit2','Digit3','Digit4','Digit5'].includes(event.code)){event.stopImmediatePropagation();event.preventDefault();if(event.repeat)return;if(event.code==='KeyB')dropNuke();else if(event.code==='KeyV')jetState.cameraMode^=1;}
  },true);
  window.addEventListener('keyup',event=>{keysJet[event.code]=false;},true);
  window.addEventListener('blur',()=>{for(const k in keysJet)keysJet[k]=false;});
  window.addEventListener('mousedown',event=>{if(!jetState.flying||gameState.screen!=='playing')return;event.stopImmediatePropagation();if(event.button===0){keysJet.M0=true;if(canvas&&canvas.requestPointerLock)try{canvas.requestPointerLock();}catch(_){}}if(event.button===2)event.preventDefault();},true);
  window.addEventListener('mouseup',event=>{if(event.button===0)keysJet.M0=false;},true);
  window.addEventListener('mousemove',event=>{if(!jetState.flying||gameState.screen!=='playing')return;event.stopImmediatePropagation();if(document.pointerLockElement===canvas){jetState.sx=clamp(jetState.sx+(event.movementX||0)*0.0026,-1,1);jetState.sy=clamp(jetState.sy-(event.movementY||0)*0.0026*(jetState.inverted?-1:1),-1,1);}},true);
  window.addEventListener('wheel',event=>{if(!jetState.flying||gameState.screen!=='playing')return;event.stopImmediatePropagation();jetState.throttle=clamp(jetState.throttle-Math.sign(event.deltaY)*0.1,0,1);},{capture:true,passive:true});
  return jetState;
}

export function updateAircraft(dt,elapsed,{stepPlayer=true}={}) {
  if(!initialized)initAircraft();updateBombs(dt);
  for(const beacon of beaconMeshes)beacon.visible=Math.sin(elapsed*6)>0;
  if(jetState.dead>0){jetState.dead-=dt;if(jetState.dead<=0){resetJet();pushFeed('A NEW STRIKE JET WAS WHEELED OUT AT THE AURA AIR BUNKER','border-l-sky-400');}}
  if(!jetState.tipShown&&elapsed>8){jetState.tipShown=true;pushFeed('NEW: PRESS [J] TO WARP TO THE AURA AIR BUNKER (STRIKE JET + NUKES)','border-l-sky-400');}
  if(!jetState.flying){if(stepPlayer)stepSimulation(dt,elapsed);jetVisuals(elapsed);if(stepPlayer)enhancePerFrame(dt,elapsed);return false;}
  if(jetState.help>0&&jetState.help<900)jetState.help-=dt;jetUpdate(dt);
  if(!jetState.flying){if(stepPlayer)stepSimulation(dt,elapsed);jetVisuals(elapsed);return false;}
  player.x=jetState.pos.x;player.y=jetState.pos.y+3;player.z=jetState.pos.z;player.mantle.active=false;inputState.isPrimaryFireHeld=false;
  if(stepPlayer){
    const movementKeys=['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight','KeyG','KeyC'];
    const savedKeys=movementKeys.map(code=>keys[code]);
    movementKeys.forEach(code=>{keys[code]=false;});
    stepSimulation(dt,elapsed);
    movementKeys.forEach((code,index)=>{keys[code]=savedKeys[index];});
  }
  player.x=jetState.pos.x;player.y=jetState.pos.y;player.z=jetState.pos.z;player.vy=0;player.pvx=0;player.pvz=0;player.grounded=true;player.peakAirY=player.y;
  const forward=Z_FORWARD.clone().applyQuaternion(jetState.q);player.yaw=Math.atan2(-forward.x,-forward.z);player.pitch=0;fpRoot.visible=false;
  jetVisuals(elapsed);jetCamera(dt);jetHUD(elapsed);engineAudio(true);const crosshair=document.getElementById('crosshair');if(crosshair)crosshair.style.display='none';
  if(stepPlayer)enhancePerFrame(dt,elapsed);return true;
}

export function drawAircraftMapOverlay(canvas,centerOnPlayer) {
  if(!canvas)return;if(player.y<-1.2)return;const ctx=canvas.getContext('2d'),scale=centerOnPlayer?0.65:0.38,rx=centerOnPlayer?player.x:-29,rz=centerOnPlayer?player.z:-190,X=w=>canvas.width/2+(w-rx)*scale,Y=w=>canvas.height/2+(w-rz)*scale;
  ctx.fillStyle='rgba(55,60,68,.9)';ctx.fillRect(X(AIRFIELD.rx0),Y(AIRFIELD.rz-12),(AIRFIELD.rx1-AIRFIELD.rx0)*scale,24*scale);ctx.fillStyle='#64748b';ctx.fillRect(X(AIRFIELD.hangerX0),Y(AIRFIELD.hangerZ0),(AIRFIELD.hangerX1-AIRFIELD.hangerX0)*scale,(AIRFIELD.hangerZ1-AIRFIELD.hangerZ0)*scale);ctx.fillStyle='#fcd34d';ctx.font='bold 10px sans-serif';ctx.fillText('AIR BUNKER',X(-535),Y(-131));
  ctx.fillStyle='#a7ffc8';if(jetState.flying){const f=Z_FORWARD.clone().applyQuaternion(jetState.q);ctx.save();ctx.translate(X(jetState.pos.x),Y(jetState.pos.z));ctx.rotate(Math.atan2(f.z,f.x));ctx.beginPath();ctx.moveTo(8,0);ctx.lineTo(-5,4.5);ctx.lineTo(-5,-4.5);ctx.closePath();ctx.fill();ctx.restore();}else{ctx.beginPath();ctx.arc(X(jetState.pos.x),Y(jetState.pos.z),3,0,6.3);ctx.fill();}
}

export function setAircraftScreen(screen) {
  if(screen==='start'&&jetState.flying){endJetFlight();resetJet();}
  const hud=document.getElementById('jet-hud');if(hud)hud.style.display=jetState.flying&&screen==='playing'?'block':'none';if(screen!=='playing')engineAudio(false);
}

export const aircraftAPI = Object.freeze({ initAircraft, updateAircraft, boardJet, leaveJet, endJetFlight, warpToAirBunker, dropNuke, damageJet, isJetFlying, isNearJet, getJetState, getAircraftInteractionHint, drawAircraftMapOverlay, setAircraftScreen, setJetMobileKey, applyJetLookDelta });
