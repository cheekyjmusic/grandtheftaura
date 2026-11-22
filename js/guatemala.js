import * as THREE from 'three';
import { addWorldBox, enterableZones, hooks, mapShapes, npcs, player } from './state.js';
import { worldRoot } from './engine.js';
import { buildNpcMeshRaw } from './npcs.js';
import { createNeonSign } from './world.js';
import { spawnParticles } from './items.js';
import { sfx } from './audio.js';
import { multiplayer } from './multiplayer.js';

const BLUE = 0x4997d0;
const WHITE = 0xf8fafc;
const SKIN = [0x8d5a3c, 0x96603f, 0x7a4a2e, 0x9c6a45, 0x84553a, 0xa0714a];
const HAIR = [0x0b0b0d, 0x141012, 0x1c1410];
const PALETTE = [0xdc2626, 0xfacc15, 0x16a34a, 0xf97316, 0x9333ea, 0x0ea5e9, 0xec4899];
const M_NAMES = ['CARLOS', 'MARIO', 'JOSÉ', 'LUIS', 'MIGUEL', 'JUAN', 'DIEGO', 'PEDRO', 'ANDRÉS', 'MATEO', 'ALEJANDRO', 'FERNANDO', 'OSCAR', 'RAÚL', 'HÉCTOR', 'SANTIAGO', 'ERICK', 'ELMER', 'BYRON', 'DENIS'];
const W_NAMES = ['MARTA', 'ROSA', 'LUCÍA', 'ANA', 'CARMEN', 'GABRIELA', 'SOFÍA', 'ELENA', 'MARÍA', 'ISABEL', 'PATRICIA', 'CLAUDIA', 'MIRIAM', 'DEBORA', 'ALMA'];
const PARADE_LINES = [
  '¡Viva Guatemala! Join the festival!',
  'After the parade we are all going to Pollo Campero!',
  '¡Feliz fiesta, amigo!',
  'Do you hear the marimba? Beautiful, no?',
  'The quetzal is our national bird — it is on the float!',
  'Tikal, Antigua, Lake Atitlán... you must visit!',
  '¡Que viva la fiesta!',
  'My abuela stitched these colors by hand.',
  'Walk with us — it is a celebration!',
  'Blue and white forever! ¡Guatemala!'
];
const CAMPERO_LINES = [
  'The line is long, but the chicken is worth it.',
  'Two-piece combo with a side of frijoles, por favor.',
  'Pollo Campero tastes like home.',
  'I have been craving this all week!',
  'Extra crispy! Always extra crispy.'
];
const festival = { built: false, parade: [], homers: [], floats: [], musicians: [], lead: 70, confettiTimer: 0, musicTimer: 0, musicStep: 0 };
const materialCache = new Map();
const random = (min, max) => min + Math.random() * (max - min);
const choose = (items) => items[Math.floor(Math.random() * items.length)];
const material = (color, options = {}) => {
const key = `${color}:${options.emissive || 0}`;
if (!materialCache.has(key)) {
const m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...options });
m.userData.shared = true;
materialCache.set(key, m);
}
return materialCache.get(key);
};
const flagTexture = new THREE.TextureLoader().load('assets/textures/chapinflag.png');
flagTexture.colorSpace = THREE.SRGBColorSpace;
const flagMaterial = new THREE.MeshStandardMaterial({
  map: flagTexture,
  roughness: 0.75,
  side: THREE.DoubleSide
});


function box(parent, width, height, depth, mat, x, y, z, shadow = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow;
  mesh.receiveShadow = shadow;
  parent.add(mesh);
  return mesh;
}

function cylinder(parent, top, bottom, height, mat, x, y, z, segments = 10) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, segments), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function sphere(parent, radius, mat, x, y, z, sx = 1, sy = 1, sz = 1) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 14, 10), mat);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  parent.add(mesh);
  return mesh;
}

function makeFlag(width = 0.75, height = width * (267 / 400)) {
  const flag = new THREE.Group();
  const cloth = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, 0.02),
    flagMaterial
  );
  flag.add(cloth);
  return flag;
}


function decorateFestivalNpc(mesh, npc) {
  const data = mesh.userData;
  const head = data.face.parent;
  if (npc.gtLook === 'woman') {
	for (let i = 0; i < 3; i++) box(data.torso, 0.455, 0.045, 0.235, material(PALETTE[(npc.id + i * 2) % PALETTE.length]), 0, 0.14 - i * 0.12, 0);
	const skirt = box(data.hip, 0.5, 0.5, 0.32, material(npc.gtSkirt), 0, -0.2, 0);
	box(skirt, 0.51, 0.06, 0.33, material(PALETTE[(npc.id + 3) % PALETTE.length]), 0, -0.1, 0);
	box(skirt, 0.51, 0.04, 0.33, material(PALETTE[(npc.id + 5) % PALETTE.length]), 0, 0.12, 0);
	box(head, 0.07, 0.36, 0.07, material(0x0b0b0d), 0, -0.16, -0.14);
  } else if (npc.gtHat === 'straw') {
	cylinder(head, 0.27, 0.27, 0.025, material(0xd9b66b), 0, 0.14, 0, 14);
	cylinder(head, 0.14, 0.15, 0.12, material(0xc9a24f), 0, 0.2, 0, 12);
	cylinder(head, 0.151, 0.151, 0.03, material(BLUE), 0, 0.165, 0, 12);
  } else if (npc.gtHat === 'cap') {
	box(head, 0.27, 0.07, 0.27, material(BLUE), 0, 0.14, 0);
	box(head, 0.2, 0.03, 0.14, material(BLUE), 0, 0.12, 0.2);
  }
  if (npc.gtSash) {
	const sash = box(data.torso, 0.58, 0.07, 0.24, material(npc.gtSash), 0, 0.02, 0);
	sash.rotation.z = 0.85;
  }
  if (npc.gtRole === 'flag') {
	box(data.hip, 0.035, 1.5, 0.035, material(0x7c5a35), 0.31, 0.42, 0.16);
	const flag = makeFlag();
	flag.position.set(0.685, 1.0, 0.16);
	data.hip.add(flag);
	data.flag = flag;
  }
}

function addFestivalNpc(def, category) {
  const id = npcs.length;
  const npc = {
	id, name: def.name, role: 'stationary', aggro: 'passive', clanId: null,
	homeX: def.x, homeZ: def.z, x: def.x, z: def.z, yaw: def.yaw || 0,
	shirt: def.shirt, pants: def.pants, bandana: null, line: `"${def.line}"`,
	age: 'adult', skin: def.skin, hair: def.hair, wallet: 0, picked: false, pickCool: 0,
	fleeTimer: 0, kvx: 0, kvz: 0, mesh: null, spawned: false, walkCycle: Math.random() * 6,
	turnTimer: 3, stunTimer: 0, hostile: false, alertState: 'patrol', searchX: def.x,
	searchZ: def.z, searchTimer: 0, attackCooldown: 0, punchTimer: 0, punchSide: 0,
	hp: 100, maxHp: 100, asleep: false, sleepTimer: 0, sleepZGroup: null,
	scale: def.scale || 1, gtFestival: true, gtCategory: category, gtLook: def.look || 'man', gtHat: def.hat,
	gtSkirt: def.skirt, gtSash: def.sash, gtRole: def.gtRole, gtHome: { x: def.x, z: def.z }, gtYaw: def.yaw || 0
  };
  npcs.push(npc);
  if (category === 'parade') festival.parade.push(npc);
  else festival.homers.push(npc);
  return npc;
}

const PR = 8;
const STRAIGHT = 32;
const ARC = Math.PI / 2 * PR;
const LOOP = 4 * STRAIGHT + 4 * ARC;
const SEGMENTS = [
  { line: true, x: -16, z: -24, dx: 1, dz: 0 }, { cx: 16, cz: -16, a0: -Math.PI / 2 },
  { line: true, x: 24, z: -16, dx: 0, dz: 1 }, { cx: 16, cz: 16, a0: 0 },
  { line: true, x: 16, z: 24, dx: -1, dz: 0 }, { cx: -16, cz: 16, a0: Math.PI / 2 },
  { line: true, x: -24, z: 16, dx: 0, dz: -1 }, { cx: -16, cz: -16, a0: Math.PI }
];

function pathAt(distance) {
  let remaining = ((distance % LOOP) + LOOP) % LOOP;
  for (const segment of SEGMENTS) {
	const length = segment.line ? STRAIGHT : ARC;
	if (remaining <= length) {
	  if (segment.line) return { x: segment.x + segment.dx * remaining, z: segment.z + segment.dz * remaining, hx: segment.dx, hz: segment.dz };
	  const angle = segment.a0 + remaining / ARC * Math.PI / 2;
	  return { x: segment.cx + PR * Math.cos(angle), z: segment.cz + PR * Math.sin(angle), hx: -Math.sin(angle), hz: Math.cos(angle) };
	}
	remaining -= length;
  }
  return { x: -16, z: -24, hx: 1, hz: 0 };
}

function paradeSlot(npc) {
  const point = pathAt(festival.lead - 9 - npc.gtRow * 2.7 + npc.gtJitter);
  const lateral = (npc.gtColumn - 2) * 1.55;
  return { x: point.x - point.hz * lateral, z: point.z + point.hx * lateral, yaw: Math.atan2(point.hx, point.hz) };
}

function addFloatBase(group, bodyColor) {
  box(group, 3, 0.5, 6, material(bodyColor), 0, 0.95, 0, true);
  box(group, 3.1, 0.12, 6.1, material(WHITE), 0, 1.22, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
	const wheel = cylinder(group, 0.45, 0.45, 0.3, material(0x111827), sx * 1.5, 0.45, sz * 2, 14);
	wheel.rotation.z = Math.PI / 2;
  }
  for (let i = 0; i < 9; i++) {
	const z = -2.8 + i * 0.7;
	const color = PALETTE[i % PALETTE.length];
	sphere(group, 0.17, material(color), -1.55, 1.3, z);
	sphere(group, 0.17, material(color), 1.55, 1.3, z);
  }
  for (const side of [-1, 1]) {
	const sign = new THREE.Group();
	sign.rotation.y = side * Math.PI / 2;
	sign.position.set(side * 1.53, 0.92, 0);
	createNeonSign(sign, 'FIESTA GUATEMALTECA', 0, 0, 0, '#1d6fb8', '#ffffff', 3.4, 0.7);
	group.add(sign);
  }
}

function buildQuetzalFloat() {
  const group = new THREE.Group();
  addFloatBase(group, BLUE);
  box(group, 2.2, 0.5, 0.9, material(0x8b5a2b), 0, 1.55, 2.1, true);
  for (let i = 0; i < 12; i++) box(group, 0.15, 0.05, 0.7, material(i % 2 ? 0xc47f3a : 0xe0a35a), -0.98 + i * 0.178, 1.83, 2.1);
  cylinder(group, 0.12, 0.12, 2.2, material(0x6b4a2f), 0, 2.6, -0.4, 8).rotation.x = Math.PI / 2;
  cylinder(group, 0.1, 0.14, 1.3, material(0x6b4a2f), 0, 1.9, -0.4, 8);
  for (const [x, color] of [[-0.55, BLUE], [0.55, WHITE]]) {
	const musician = buildNpcMeshRaw(color, 0x1e293b, null, { id: 700 + festival.musicians.length, age: 'adult', scale: 0.85, skin: SKIN[0], hair: HAIR[0] });
	musician.position.set(x, 1.28, 1.35);
	group.add(musician);
	festival.musicians.push(musician);
  }
  sphere(group, 0.75, material(0x16a34a), 0, 3.15, -0.35, 1, 1, 1.35);
  sphere(group, 0.58, material(0xdc2626), 0, 2.95, 0.3, 1, 0.9, 0.9);
  sphere(group, 0.4, material(0x16a34a), 0, 3.8, 0.55);
  sphere(group, 0.22, material(0x16a34a), 0, 4.2, 0.4, 0.8, 1, 1.4);
  box(group, 0.1, 0.1, 0.28, material(0xfacc15), 0, 3.78, 0.95);
  sphere(group, 0.06, material(0x0b0b0d), 0.2, 3.9, 0.82);
  sphere(group, 0.06, material(0x0b0b0d), -0.2, 3.9, 0.82);
  for (let row = 0; row < 3; row++) for (let i = 0; i < 7; i++) {
	const z = -1.2 - i * 0.55;
	const y = Math.max(1.35, 2.9 - Math.sin(i * 0.45) * 0.55 - i * 0.18);
	box(group, 0.2 - i * 0.012, 0.07, 0.62, material(row === 1 ? 0x0d9488 : 0x16a34a), (row - 1) * 0.28 + Math.sin(i * 0.7 + row) * 0.18, y, z);
  }
  box(group, 1.9, 0.6, 0.12, material(0x16a34a), 0, 1.15, -3.05);
  group.position.y = 0.18;
  worldRoot.add(group);
  return group;
}

function buildTikalFloat() {
  const group = new THREE.Group();
  addFloatBase(group, 0x16a34a);
  const stone = material(0x9ca3a0), stone2 = material(0x7f8a86);
  [[2.6, 0.55], [2.1, 0.55], [1.6, 0.55], [1.1, 0.5]].forEach(([size, height], i) => box(group, size, height, size, i % 2 ? stone2 : stone, 0, 1.5 + i * 0.55 + height / 2 - 0.1, 0, true));
  box(group, 0.8, 0.8, 0.8, stone, 0, 3.95, 0, true);
  box(group, 0.3, 0.45, 0.04, material(0x111827), 0, 3.85, 0.42);
  box(group, 1, 0.18, 1, stone2, 0, 4.45, 0);
  for (const [x, z] of [[-1.3, -2.6], [1.3, -2.6], [-1.3, 2.6], [1.3, 2.6]]) {
	box(group, 0.04, 1.4, 0.04, material(0x7c5a35), x, 1.9, z);
	const flag = makeFlag(0.6, 0.38);
	flag.position.set(x + 0.3, 2.35, z);
	group.add(flag);
  }
  box(group, 0.06, 3.6, 0.06, material(0x7c5a35), 0, 3, -2.6);
  const bigFlag = makeFlag(2, 1.25);
  bigFlag.position.set(1, 4.2, -2.6);
  group.add(bigFlag);
  group.position.y = 0.18;
  worldRoot.add(group);
  return group;
}

function buildBunting() {
  const points = [[-30, -30], [30, -30], [30, 30], [-30, 30], [-18, -18], [18, -18], [18, 18], [-18, 18]];
  points.forEach(([x, z]) => cylinder(worldRoot, 0.07, 0.09, 5.4, material(0x475569), x, 2.9, z, 6));
  const lines = [];
  for (let i = 0; i < 4; i++) {
	lines.push([points[i], points[(i + 1) % 4]], [points[4 + i], points[4 + (i + 1) % 4]]);
  }
  const colors = [BLUE, WHITE, 0xfacc15, 0xdc2626, 0x16a34a, 0xf97316];
  for (const [[ax, az], [bx, bz]] of lines) {
	const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz), angle = Math.atan2(dz, dx);
	const ropePoints = [];
	for (let i = 0; i <= 24; i++) {
	  const t = i / 24;
	  ropePoints.push(new THREE.Vector3(ax + dx * t, 5.1 - 0.55 * Math.sin(Math.PI * t), az + dz * t));
	}
	worldRoot.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ropePoints), new THREE.LineBasicMaterial({ color: 0x111827 })));
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.26, 0, 0, 0.26, 0, 0, 0, -0.52, 0], 3));
	geometry.computeVertexNormals();
	const count = Math.floor(length / 1.5);
	for (let i = 0; i < count; i++) {
	  const t = (i + 0.5) / count;
	  const pennant = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide }));
	  pennant.position.set(ax + dx * t, 5.1 - 0.55 * Math.sin(Math.PI * t), az + dz * t);
	  pennant.rotation.y = -angle;
	  worldRoot.add(pennant);
	}
  }
}

function buildCampero() {
  const x0 = 49, x1 = 60, z0 = -10, z1 = -2, height = 4, thickness = 0.3, baseY = 0.2;
  const cx = (x0 + x1) / 2, cz = -6;
  const group = new THREE.Group();
  worldRoot.add(group);
  const cream = material(0xfff3dc), red = material(0xc8102e), yellow = material(0xffc72c);
  const floor = box(group, x1 - x0 - 0.2, 0.06, z1 - z0 - 0.2, material(0xf3efe6), cx, baseY + 0.03, cz, true);
  void floor;
  const addCollision = (minX, maxX, minY, maxY, minZ, maxZ, tag = 'campero') => addWorldBox(minX, maxX, minY, maxY, minZ, maxZ, tag, true);
  const wallX = (z, fromX, toX) => {
	const width = toX - fromX, mid = (fromX + toX) / 2;
	box(group, width, 0.9, thickness, cream, mid, baseY + 0.45, z, true);
	box(group, width, height - 2.9, thickness, red, mid, baseY + 2.9 + (height - 2.9) / 2, z, true);
	addCollision(fromX, toX, baseY, baseY + height, z - thickness / 2, z + thickness / 2);
  };
  const wallZ = (x, fromZ, toZ) => {
	const depth = toZ - fromZ, mid = (fromZ + toZ) / 2;
	box(group, thickness, 0.9, depth, cream, x, baseY + 0.45, mid, true);
	box(group, thickness, height - 0.9, depth, red, x, baseY + 0.9 + (height - 0.9) / 2, mid, true);
	addCollision(x - thickness / 2, x + thickness / 2, baseY, baseY + height, fromZ, toZ);
  };
  wallX(z0 + thickness / 2, x0, x1);
  wallX(z1 - thickness / 2, x0, x1);
  wallZ(x0 + thickness / 2, z0, z1);
  wallZ(x1 - thickness / 2, z0, cz - 1.3);
  wallZ(x1 - thickness / 2, cz + 1.3, z1);
  box(group, thickness, height - 0.9, 2.6, red, x1 - thickness / 2, baseY + 0.9 + (height - 0.9) / 2, cz, true);
  addCollision(x1 - thickness, x1, baseY + 2.9, baseY + height, cz - 1.3, cz + 1.3);
  box(group, 0.2, 2.9, 0.2, yellow, x1 - thickness / 2, baseY + 1.45, cz - 1.3);
  box(group, 0.2, 2.9, 0.2, yellow, x1 - thickness / 2, baseY + 1.45, cz + 1.3);
  box(group, x1 - x0 + 0.6, 0.3, z1 - z0 + 0.6, material(0x7f1d1d), cx, baseY + height + 0.15, cz, true);
  addCollision(x0 - 0.3, x1 + 0.3, baseY + height, baseY + height + 0.3, z0 - 0.3, z1 + 0.3, 'campero_roof');
  [-2.4, 2.4].forEach((dz) => box(group, 2.4, 0.05, 1, material(0xffffff, { emissive: 0xfff2cc, emissiveIntensity: 1.2 }), cx + 0.5, baseY + height - 0.05, cz + dz));
  const sign = new THREE.Group();
  sign.position.set(x1 + 0.12, baseY + height + 1.3, cz);
  sign.rotation.y = Math.PI / 2;
  createNeonSign(sign, 'POLLO CAMPERO', 0, 0, 0, '#ffc72c', '#b91c1c', 7.2, 1.5);
  group.add(sign);
  for (const z of [cz - 2.8, cz + 2.8]) box(group, 0.2, 0.9, 0.2, material(0xcbd5e1, { metalness: 0.8, roughness: 0.3 }), x1 + 0.12, baseY + height + 0.75, z);
  const chicken = new THREE.Group();
  chicken.position.set(cx + 1.5, baseY + height + 0.3, cz);
  chicken.rotation.y = Math.PI / 2;
  box(chicken, 0.6, 0.9, 0.6, material(0x7f1d1d), 0, 0.45, 0);
  sphere(chicken, 1, material(0xfafafa), 0, 1.9, 0, 1, 1, 1.25);
  sphere(chicken, 0.55, material(0xfafafa), 0, 2.95, 0.75);
  [-0.18, 0, 0.18].forEach((dx, i) => box(chicken, 0.15, 0.3 + (i === 1 ? 0.12 : 0), 0.15, material(0xdc2626), dx, 3.55 + (i === 1 ? 0.05 : 0), 0.75));
  box(chicken, 0.2, 0.14, 0.4, material(0xf59e0b), 0, 2.9, 1.25);
  box(chicken, 0.14, 0.3, 0.1, material(0xdc2626), 0, 2.62, 1.2);
  sphere(chicken, 0.08, material(0x0b0b0d), 0.28, 3.05, 1.15);
  sphere(chicken, 0.08, material(0x0b0b0d), -0.28, 3.05, 1.15);
  group.add(chicken);
  for (let i = 0; i < 7; i++) box(group, 1.2, 0.1, 0.6, material(i % 2 ? 0xffc72c : 0xc8102e), x1 + 0.6, baseY + 3.15, cz - 1.8 + i * 0.6);
  box(group, 0.9, 1, 5.2, red, 51.3, baseY + 0.5, cz, true);
  box(group, 1.15, 0.08, 5.4, material(0xf5e6c8), 51.3, baseY + 1.04, cz);
  addCollision(50.8, 51.8, baseY, 1.5, cz - 2.6, cz + 2.6, 'campero_counter');
  createNeonSign(group, 'POLLO FRITO • COMBOS', x0 + thickness + 0.12, baseY + 2.7, cz, '#7f1d1d', '#ffd24a', 4.8, 0.9);
  const steel = material(0xcbd5e1, { metalness: 0.8, roughness: 0.3 });
  for (const [x, z] of [[55.2, -8.3], [57.8, -8.3], [55.2, -3.7], [57.8, -3.7]]) {
	cylinder(group, 0.55, 0.55, 0.06, red, x, baseY + 0.9, z, 14);
	cylinder(group, 0.07, 0.1, 0.88, steel, x, baseY + 0.44, z, 8);
	addCollision(x - 0.5, x + 0.5, baseY, baseY + 1.1, z - 0.5, z + 0.5, 'campero_table');
  }
  mapShapes.push({ x: cx, z: cz, w: x1 - x0, d: z1 - z0, color: '#facc15', border: '#b91c1c', enterable: false });
  enterableZones.push({ minX: x0 + 0.3, maxX: x1 - 0.3, minZ: z0 + 0.3, maxZ: z1 - 0.2, name: 'POLLO CAMPERO' });

  const home = (def) => addFestivalNpc({ ...def, gtHome: { x: def.x, z: def.z } }, 'campero');
  const man = (extra) => ({
	skin: choose(SKIN), hair: choose(HAIR), look: 'man', hat: choose(['cap', 'none', 'none']),
	shirt: choose([BLUE, WHITE, 0x16a34a, 0xf97316]), pants: choose([0x1e293b, 0x334155]), line: choose(CAMPERO_LINES), ...extra
  });
  const woman = (extra) => ({
	skin: choose(SKIN), hair: choose(HAIR), look: 'woman', skirt: choose([0x1d4ed8, 0x7f1d1d, 0x14532d, 0x6d28d9]),
	shirt: choose(PALETTE), pants: 0x1e293b, line: choose(CAMPERO_LINES), ...extra
  });
  home(woman({ name: 'CASHIER ROSA', x: 50.2, z: -7.4, yaw: Math.PI / 2, shirt: 0xc8102e, line: 'Welcome to Pollo Campero! What can I get you?' }));
  home(man({ name: 'FRY COOK LUIS', x: 50.2, z: -4.6, yaw: Math.PI / 2, shirt: 0xc8102e, hat: 'cap', line: 'Fresh out of the fryer! Be careful, it is hot.' }));
  home(man({ name: 'MARIO', x: 52.6, z: -7, yaw: -Math.PI / 2 }));
  home(woman({ name: 'LUCÍA', x: 52.6, z: -5.2, yaw: -Math.PI / 2 }));
  home(man({ name: 'ERICK', x: 54.25, z: -8.3, yaw: Math.PI / 2 }));
  home(woman({ name: 'CARMEN', x: 58.75, z: -8.3, yaw: -Math.PI / 2 }));
  home(man({ name: 'JOSÉ', x: 55.2, z: -4.65, yaw: 0 }));
  home(woman({ name: 'MIRIAM', x: 57.8, z: -4.65, yaw: 0 }));
  const queue = [[61.3, cz, -Math.PI / 2], [62.5, cz, -Math.PI / 2], [63.7, cz, -Math.PI / 2], [64.6, cz, -Math.PI / 2], [64.6, -7.2, 0], [64.6, -8.4, 0], [64.6, -9.6, 0], [64.6, -10.8, 0], [64.6, -12, 0]];
  queue.forEach(([x, z, yaw], i) => home((i % 2 ? woman : man)({ name: choose(i % 2 ? W_NAMES : M_NAMES), x, z, yaw })));
}

export function buildGuatemalanFestival() {
  if (festival.built) return;
  festival.built = true;
  for (let row = 0; row < 10; row++) for (let column = 0; column < 5; column++) {
	const woman = Math.random() < 0.45;
	const npc = addFestivalNpc({
	  name: choose(woman ? W_NAMES : M_NAMES), x: 0, z: 0, yaw: 0, scale: random(0.8, 0.89),
	  shirt: woman ? choose(PALETTE) : choose([BLUE, BLUE, WHITE, WHITE, 0xfacc15]),
	  pants: woman ? 0x1e293b : choose([0x1e293b, 0x334155, WHITE]), skin: choose(SKIN), hair: choose(HAIR),
	  look: woman ? 'woman' : 'man', skirt: choose([0x1d4ed8, 0x7f1d1d, 0x14532d, 0x6d28d9, 0x9a3412]),
	  hat: woman ? null : choose(['straw', 'cap', 'none', 'none']), sash: Math.random() < 0.3 ? BLUE : null,
	  gtRole: row % 3 === 0 && column % 2 === 0 ? 'flag' : null, line: choose(PARADE_LINES)
	}, 'parade');
	npc.gtRow = row;
	npc.gtColumn = column;
	npc.gtJitter = random(-0.35, 0.35);
	const slot = paradeSlot(npc);
	npc.x = npc.homeX = slot.x;
	npc.z = npc.homeZ = slot.z;
	npc.yaw = slot.yaw;
  }
  festival.floats.push(buildQuetzalFloat(), buildTikalFloat());
  buildBunting();
  buildCampero();
}

function placeFloat(group, distance) {
  const point = pathAt(distance);
  group.position.x = point.x;
  group.position.z = point.z;
  group.rotation.y = Math.atan2(point.hx, point.hz);
}

function busy(npc) {
  return npc.asleep || npc.hostile || npc.fleeTimer > 0 || npc.stunTimer > 0 || Math.abs(npc.kvx) + Math.abs(npc.kvz) > 0.3;
}

function animateWalk(npc, dt, fast) {
  const data = npc.mesh.userData;
  npc.walkCycle += dt * (fast ? 12 : 7.5);
  const swing = Math.sin(npc.walkCycle) * (fast ? 0.75 : 0.5);
  data.legL.rotation.x = swing;
  data.legR.rotation.x = -swing;
  data.armL.rotation.x = -swing * 0.75;
  data.armR.rotation.x = swing * 0.75;
  data.armL.rotation.z = 0;
  data.armR.rotation.z = 0;
}

export function updateGuatemalanFestival(dt, elapsed) {
  if (!festival.built) return;
  const guest = hooks.mpIsGuest();
  if (guest) {
    // Float positions derive from the host-synced parade lead (same pathAt math).
    festival.lead = hooks.mpFestivalLead();
  } else {
    festival.lead += 2 * dt;
  }
  placeFloat(festival.floats[0], festival.lead);
  placeFloat(festival.floats[1], festival.lead - 44);
  festival.musicians.forEach((musician, i) => {
    const data = musician.userData, swing = Math.sin(elapsed * 9 + i * 1.6);
    data.armL.rotation.x = -1.15 + swing * 0.45;
    data.armR.rotation.x = -1.15 - swing * 0.45;
  });
  // Parade + crowd NPC movement is host-only; guests receive it via the NPC stream.
  if (!guest) {
    for (const npc of festival.parade) {
      if (busy(npc)) continue;
      const slot = paradeSlot(npc);
      const dx = slot.x - npc.x, dz = slot.z - npc.z, distance = Math.hypot(dx, dz);
      const walking = distance > 0.35;
      if (walking) {
        const step = Math.min(distance, 6.2 * dt);
        npc.x += dx / distance * step;
        npc.z += dz / distance * step;
        npc.yaw = Math.atan2(dx, dz);
      } else {
        npc.x = slot.x;
        npc.z = slot.z;
        npc.yaw = slot.yaw;
      }
      npc.moving = walking;
      if (npc.mesh && npc.spawned) {
        npc.mesh.position.set(npc.x, 0.18, npc.z);
        npc.mesh.rotation.y = npc.yaw;
        animateWalk(npc, dt, walking);
        const data = npc.mesh.userData;
        if (data.flag) {
          data.armR.rotation.x = -0.55;
          data.flag.rotation.y = Math.sin(elapsed * 4 + npc.id) * 0.35;
        } else if (Math.sin(elapsed * 0.45 + npc.id * 1.9) > 0.82) {
          data.armL.rotation.x = -2.6 + Math.sin(elapsed * 9 + npc.id) * 0.35;
          data.armR.rotation.x = -2.6 + Math.cos(elapsed * 9 + npc.id) * 0.35;
        }
      }
    }
    for (const npc of festival.homers) {
      if (busy(npc) || !npc.mesh || !npc.spawned) continue;
      npc.x = npc.gtHome.x;
      npc.z = npc.gtHome.z;
      npc.yaw = npc.gtYaw;
      npc.mesh.position.set(npc.x, 0.18, npc.z);
      npc.mesh.rotation.y = npc.yaw;
    }
  } else {
    // Guests still wave the flags on their locally-rendered parade meshes.
    for (const npc of festival.parade) {
      if (!npc.mesh || !npc.spawned) continue;
      const data = npc.mesh.userData;
      if (data.flag) data.flag.rotation.y = Math.sin(elapsed * 4 + npc.id) * 0.35;
    }
  }
  festival.confettiTimer -= dt;
  if (festival.confettiTimer <= 0 && Math.hypot(player.x - festival.floats[0].position.x, player.z - festival.floats[0].position.z) < 90) {
    festival.confettiTimer = 0.3;
    const npc = choose(festival.parade);
    if (npc.mesh) spawnParticles(npc.x, 2.6, npc.z, choose([BLUE, WHITE, 0xfacc15, 0xdc2626, 0x16a34a, 0xf97316]), 4, 3.2);
    spawnParticles(festival.floats[0].position.x, 4.6, festival.floats[0].position.z, choose([0xfacc15, 0xdc2626, BLUE]), 3, 4);
  }
  festival.musicTimer -= dt;
  if (festival.musicTimer <= 0) {
    festival.musicTimer = 0.22;
    const distance = Math.hypot(player.x - festival.floats[0].position.x, player.z - festival.floats[0].position.z);
    if (distance < 75 && sfx.enabled && player.y > -1.2) {
      const scale = [293.66, 329.63, 369.99, 440, 493.88, 587.33];
      const pattern = [0, 2, 4, 2, 3, 2, 1, 2, 0, 2, 4, 5, 4, 3, 2, 1];
      const frequency = scale[pattern[festival.musicStep % pattern.length]];
      const volume = 0.07 * Math.pow(1 - distance / 75, 1.5);
      sfx.tone(frequency, frequency * 0.985, 0.3, 'sine', volume);
      sfx.tone(frequency * 3, frequency * 3, 0.1, 'sine', volume * 0.25);
      if (festival.musicStep % 4 === 0) sfx.tone(frequency / 2, frequency / 2.02, 0.4, 'triangle', volume * 0.7);
      festival.musicStep++;
    }
  }
}
// Net hooks: the host streams festival.lead; guests adopt it.
Object.assign(hooks, {
  mpFestivalLead: () => festival.lead,
  mpSetFestivalLead: (v) => { if (Number.isFinite(v)) festival.lead = v; },
});

export function decorateGuatemalanNpc(npc, mesh) {
  if (npc.gtFestival) decorateFestivalNpc(mesh, npc);
}

export function renderGuatemalanMap(ctx, canvas, centered) {
  if (!festival.built) return;
  const scale = centered ? 0.65 : 0.38;
  const refX = centered ? player.x : -29;
  const refZ = centered ? player.z : -190;
  const x = (wx) => canvas.width / 2 + (wx - refX) * scale;
  const y = (wz) => canvas.height / 2 + (wz - refZ) * scale;
  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 9px sans-serif';
  ctx.fillText('POLLO CAMPERO', x(54.5), y(-6));
  if (player.y < -1.2) return;
  for (let i = 0; i < festival.parade.length; i += 3) {
	const npc = festival.parade[i];
	ctx.fillStyle = i % 2 ? '#f8fafc' : '#4997d0';
	ctx.fillRect(x(npc.x) - 1, y(npc.z) - 1, 2.4, 2.4);
  }
  for (const group of festival.floats) {
	ctx.fillStyle = '#facc15';
	ctx.fillRect(x(group.position.x) - 2.5, y(group.position.z) - 2.5, 5, 5);
  }
}

Object.assign(hooks, {
  decorateNpc: (mesh, npc) => decorateGuatemalanNpc(npc, mesh),
  drawMapOverlay: (ctx, canvas, centered) => renderGuatemalanMap(ctx, canvas, centered)
});
