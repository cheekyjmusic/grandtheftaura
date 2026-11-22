// =============================================================================
// studio.js — Aura Studio: World, Model, Asset & Parameter editor (studio.html).
//
// Shares the EXACT same engine, world builders, mesh factories, assets and levelData as the
// game. It never starts the gameplay loop, never requests pointer lock and never touches the
// game HUD: it only imports the lower layers (engine/world/items/vehicles/npcs/player builders)
// and drives its own render loop.
// =============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

import {
  levelData, DEFAULT_LEVEL_DATA, replaceLevelData, saveLevelData, clearSavedLevelData,
  makeEntity, nextEntityId, PREFABS, colorToHex, hexToCss, sculptTerrain
} from '../levelData.js';
import { initEngine, scene, renderer, camera as gameCamera, worldRoot, skyGroup, applyGraphicsTier, onViewportResize, getViewportSize } from '../engine.js';
import {
  applyModelPreset, registerAssetOverride, getAssetSource, hasAssetOverride,
  loadCustomAudio, playCustomAudio, preloadBoundAudio, preloadRegisteredTextures
} from '../assets.js';
import { sfx } from '../audio.js';
import { RIGHT_WEAPONS, buildRightWeaponMesh } from '../items.js';
import { buildSportsCarMesh } from '../vehicles.js';
import { buildWorld, createEntityObject, entityObjects, studioObjects, applyStudioWorldTransforms, removeEntityObject, updateEntityTransform, revealAllLods, sculptableTerrainMeshes, refreshTerrainSculpt } from '../world.js';
import { terrainBaseH } from '../state.js';
import { buildNpcMesh } from '../npcs.js';
import { buildPlayerRigMesh } from '../player.js';

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Tiny DOM builder: h('div', {class:'x', onclick: fn}, child, ...) */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const fmt = (n) => (Math.round(n * 1000) / 1000).toString();
const deg = (r) => THREE.MathUtils.radToDeg(r);
const rad = (d) => THREE.MathUtils.degToRad(d);
const basename = (p) => p.split('/').pop();

function toast(message, kind = '') {
  const el = h('div', { class: `toast ${kind}` }, message);
  $('#toast-root').append(el);
  setTimeout(() => el.remove(), 3800);
}

// -----------------------------------------------------------------------------
// Model catalogue (each opens in its own closable viewport tab)
// -----------------------------------------------------------------------------
const MODELS = [
  { id: 'player', name: 'Player Character Rig', glyph: '☺', build: () => buildPlayerRigMesh(levelData.params.player).tpRig },
  { id: 'apex_gt', name: 'Apex GT Supercar', glyph: '◢', build: () => buildSportsCarMesh({ name: 'APEX GT', bodyHex: 0xf97316, accentHex: 0x0f172a, isCoupe: true, isSupercar: true }).root },
  { id: 'coupe', name: 'Sports Coupe', glyph: '◢', build: () => buildSportsCarMesh({ name: 'SPORTS COUPE', bodyHex: 0xdc2626, accentHex: 0xf8fafc, isCoupe: true, isSupercar: false }).root },
  { id: 'hotdog_shooter', name: 'Hotdog Shooter', glyph: '╾', build: () => buildRightWeaponMesh('hotdog_shooter') },
  { id: 'bat', name: 'Wooden Bat', glyph: '╾', build: () => buildRightWeaponMesh('bat') },
  { id: 'crowbar', name: 'Steel Crowbar', glyph: '╾', build: () => buildRightWeaponMesh('crowbar') },
  { id: 'pipe', name: 'Tactical Pipe', glyph: '╾', build: () => buildRightWeaponMesh('pipe') },
  { id: 'npc_guard', name: 'NPC Guard', glyph: '☻', build: () => {
    const p = levelData.params.models.npc_guard || {};
    return buildNpcMesh({ shirtColor: p.shirtColor || '#1d4ed8', pantsColor: p.pantsColor || '#0b1220', id: 900 });
  } }
];
const MODEL_BY_ID = Object.fromEntries(MODELS.map((m) => [m.id, m]));
const WEAPON_IDS = ['fists', 'bat', 'crowbar', 'pipe', 'hotdog_shooter'];
const LEFT_ITEM_IDS = ['cash', 'burger', 'soda', 'medkit', 'flashlight'];
const AUDIO_EVENTS = [
  ['hotdogFire', 'Hotdog fire'], ['batSwing', 'Bat / weapon swing'], ['punch', 'Punch'],
  ['pickup', 'Pickup'], ['carHorn', 'Car horn'], ['engineLoop', 'Engine loop'], ['bgMusic', 'Background music']
];
const ENTITY_GLYPH = { vehicle: '◢', pickup: '◇', crate: '▣', barrel: '◍', ramp: '◿', block: '■', prop: '●', building: '▥', road: '═' };

// -----------------------------------------------------------------------------
// Studio state
// -----------------------------------------------------------------------------
const state = {
  tool: 'select',
  snap: 0,
  selection: null,            // {kind:'entity'|'model'|'audio'|'param', id|key}
  selections: [],
  tabs: [],                   // viewport tabs
  activeTab: 'world',
  collapsed: new Set(),
  expanded: new Set(),
  query: '',
  rmbDown: false,
  lookDragging: false,
  sculpting: false,
  keys: new Set(),
  savedJson: '',
  worldReady: false
};

let cam, controls, transform, boxHelper, stage, raycaster, brushPreview;
let multiGroup = null;
let worldBackground = null, worldFog = null, skyWasVisible = false;

// -----------------------------------------------------------------------------
// History (whole-document snapshots: simple, bulletproof undo/redo)
// -----------------------------------------------------------------------------
const history = { present: '', undo: [], redo: [] };

function resetHistory() { history.present = JSON.stringify(levelData); history.undo = []; history.redo = []; updateHistoryButtons(); }

function commit() {
  const now = JSON.stringify(levelData);
  if (now === history.present) return;
  history.undo.push(history.present);
  if (history.undo.length > 150) history.undo.shift();
  history.present = now;
  history.redo.length = 0;
  updateHistoryButtons();
  updateSaveState();
}

function applySnapshot(json) {
  const keepSel = state.selection ? { ...state.selection } : null;
  replaceLevelData(JSON.parse(json));
  history.present = json;
  rebuildEntities();
  applyStudioWorldTransforms(levelData);
  refreshTerrainSculpt();
  rebuildOpenTabs();
  refreshAssetPanel();
  if (keepSel && keepSel.kind === 'entity' && !levelData.entities.find((e) => e.id === keepSel.id)) select(null);
  else if (keepSel) select(keepSel, { silent: true });
  refreshExplorer();
  renderInspector();
  updateHistoryButtons();
  updateSaveState();
}

function undo() { if (!history.undo.length) return; history.redo.push(history.present); applySnapshot(history.undo.pop()); }
function redo() { if (!history.redo.length) return; history.undo.push(history.present); applySnapshot(history.redo.pop()); }

function updateHistoryButtons() {
  $('#btn-undo').disabled = !history.undo.length;
  $('#btn-redo').disabled = !history.redo.length;
}

function updateSaveState() {
  const dirty = JSON.stringify(levelData) !== state.savedJson;
  const el = $('#save-state');
  el.textContent = dirty ? 'Unsaved changes' : 'Saved to browser';
  el.classList.toggle('dirty', dirty);
}

// -----------------------------------------------------------------------------
// Entities in the World Map tab
// -----------------------------------------------------------------------------
function entityOf(id) { return levelData.entities.find((e) => e.id === id); }

function rebuildEntities() {
    detachMultiGroup();
  for (const id of [...entityObjects.keys()]) removeEntityObject(id);
  for (const e of levelData.entities) createEntityObject(e, { register: false });
  attachGizmo();
}

function rebuildEntityObject(entity) {
  removeEntityObject(entity.id);
  createEntityObject(entity, { register: false });
  attachGizmo();
}

/** Position / rotation / scale from the live 3D object back into the entity record. */
function writeTransformFromObject(entity) {
  const rec = entityObjects.get(entity.id);
  if (!rec) return;
  const o = rec.object;
  const yOff = entity.type === 'pickup' ? 0.55 : 0;
  entity.pos = [o.position.x, o.position.y - yOff, o.position.z].map((v) => Math.round(v * 1000) / 1000);
  entity.rot = [o.rotation.x, o.rotation.y, o.rotation.z].map((v) => Math.round(v * 10000) / 10000);
  entity.scale = [o.scale.x, o.scale.y, o.scale.z].map((v) => Math.round(v * 1000) / 1000);
}

// -----------------------------------------------------------------------------
// Viewport tabs: pinned "World Map" + closable isolated model / entity tabs
// -----------------------------------------------------------------------------
function activeTab() { return state.tabs.find((t) => t.id === state.activeTab); }

function centerOnStage(object) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return box;
  const c = box.getCenter(new THREE.Vector3());
  object.position.x -= c.x;
  object.position.z -= c.z;
  object.position.y -= box.min.y; // stand on the pedestal
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}

function buildTabObject(tab) {
  let obj;
  if (tab.kind === 'model') {
    const def = MODEL_BY_ID[tab.modelId];
    obj = def.build();
    applyModelPreset(tab.modelId, obj);
  } else {
    const entity = entityOf(tab.entityId);
    const clone = structuredClone(entity);
    clone.id = 'preview:' + entity.id;
    clone.rot = [0, 0, 0];
    const { object } = createEntityObject(clone, { register: false });
    entityObjects.delete(clone.id);
    obj = object;
  }
  if (obj.parent) obj.parent.remove(obj);
  obj.userData.studioTabRoot = true;
  return obj;
}

function mountTabObject(tab) {
  if (tab.object && tab.object.parent) tab.object.parent.remove(tab.object);
  tab.object = buildTabObject(tab);
  tab.pivot.add(tab.object);
  tab.bounds = centerOnStage(tab.object);
}

function ensureTab(spec) {
  let tab = state.tabs.find((t) => t.id === spec.id);
  if (!tab) {
    tab = { ...spec, pivot: new THREE.Group(), cam: null };
    tab.pivot.name = 'tab:' + spec.id;
    stage.add(tab.pivot);
    mountTabObject(tab);
    fitCameraToBounds(tab);
    state.tabs.push(tab);
  }
  return tab;
}

function openModelTab(modelId) {
  const def = MODEL_BY_ID[modelId];
  if (!def) return;
  const tab = ensureTab({ id: 'model:' + modelId, kind: 'model', modelId, title: def.name });
  setActiveTab(tab.id);
  select({ kind: 'model', id: modelId });
}

function openEntityTab(entityId) {
  const e = entityOf(entityId);
  if (!e) return;
  const tab = ensureTab({ id: 'entity:' + entityId, kind: 'entity', entityId, title: e.name });
  setActiveTab(tab.id);
  select({ kind: 'entity', id: entityId });
}

function closeTab(id) {
  const i = state.tabs.findIndex((t) => t.id === id);
  if (i < 0 || state.tabs[i].pinned) return;
  const [tab] = state.tabs.splice(i, 1);
  stage.remove(tab.pivot);
  if (state.activeTab === id) setActiveTab(state.tabs[Math.max(0, i - 1)].id);
  renderTabs();
}

function rebuildOpenTabs() {
  for (const tab of [...state.tabs]) {
    if (tab.pinned) continue;
    if (tab.kind === 'entity' && !entityOf(tab.entityId)) { closeTab(tab.id); continue; }
    if (tab.kind === 'entity') tab.title = entityOf(tab.entityId).name;
    mountTabObject(tab);
  }
  renderTabs();
  attachGizmo();
}

function fitCameraToBounds(tab) {
  const b = tab.bounds && !tab.bounds.isEmpty() ? tab.bounds : new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1.5, 1));
  const sphere = b.getBoundingSphere(new THREE.Sphere());
  const dist = Math.max(sphere.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.15, 0.8);
  const dir = new THREE.Vector3(0.75, 0.45, 1).normalize();
  tab.cam = { target: sphere.center.clone(), position: sphere.center.clone().addScaledVector(dir, dist) };
}

function saveCameraToTab(tab) {
  if (!tab) return;
  tab.cam = { target: controls.target.clone(), position: cam.position.clone() };
}

function setActiveTab(id) {
  const prev = activeTab();
  if (prev && prev.id !== id) saveCameraToTab(prev);
  state.activeTab = id;
  const tab = activeTab();
  const isWorld = tab.id === 'world';
  worldRoot.visible = isWorld;
  stage.visible = !isWorld;
  skyGroup.visible = isWorld && skyWasVisible;
  scene.background = isWorld ? worldBackground : new THREE.Color(0x181c25);
  scene.fog = isWorld ? worldFog : null;
  for (const t of state.tabs) if (!t.pinned) t.pivot.visible = t.id === id;
  controls.minDistance = isWorld ? 1 : 0.1;
  controls.maxDistance = isWorld ? 1800 : 80;
  if (tab.cam) {
    cam.position.copy(tab.cam.position);
    controls.target.copy(tab.cam.target);
    controls.update();
  }
  cam.near = isWorld ? 0.3 : 0.02;
  cam.updateProjectionMatrix();
  // selection that does not belong to this tab is dropped
  if (state.selection) {
    const s = state.selection;
    const belongs = isWorld ? (s.kind === 'entity' || s.kind === 'audio' || s.kind === 'param' || s.kind === 'model')
      : (tab.kind === 'model' ? (s.kind === 'model' && s.id === tab.modelId) || s.kind === 'audio' || s.kind === 'param'
        : (s.kind === 'entity' && s.id === tab.entityId) || s.kind === 'audio' || s.kind === 'param');
    if (!belongs) state.selection = null;
  }
  if (!state.selection && !isWorld) state.selection = tab.kind === 'model' ? { kind: 'model', id: tab.modelId } : { kind: 'entity', id: tab.entityId };
  renderTabs();
  updateToolboxMode();
  attachGizmo();
  refreshExplorer();
  renderInspector();
}

function renderTabs() {
  const bar = $('#tabbar');
  bar.replaceChildren(...state.tabs.map((t) => h('div', {
    class: `vtab${t.id === state.activeTab ? ' active' : ''}${t.pinned ? ' pinned' : ''}`,
    role: 'tab',
    title: t.pinned ? 'Full city, freeway, desert and all placed entities' : t.title,
    onclick: () => setActiveTab(t.id),
    onauxclick: (ev) => { if (ev.button === 1) closeTab(t.id); }
  }, t.title, t.pinned ? null : h('button', { class: 'close', title: 'Close tab', onclick: (ev) => { ev.stopPropagation(); closeTab(t.id); } }, '×'))));
}

function updateToolboxMode() {
  const isWorld = state.activeTab === 'world';
  $$('#sec-insert .chip').forEach((b) => { b.disabled = !isWorld; });
  $('#insert-hint').textContent = isWorld ? 'Parts appear in front of the camera.' : 'Switch to the World Map tab to insert parts.';
}

// -----------------------------------------------------------------------------
// Selection + gizmo
// -----------------------------------------------------------------------------
function objectForSelection(s) {
  if (!s) return null;
  if (s.kind === 'entity') { const rec = entityObjects.get(s.id); return rec ? rec.object : null; }
  if (s.kind === 'worldObject' || s.kind === 'worldPart') return s.object;
  return null;
}

function getSelectedObjects() {
  return state.selections.map(objectForSelection).filter(Boolean);
}

function detachMultiGroup() {
  if (!multiGroup || !multiGroup.children.length) return;
  for (const child of [...multiGroup.children]) {
    worldRoot.attach(child);
  }
}


function selectedObject() {
  const s = state.selection;
  if (!s) return null;
  const tab = activeTab();
  if (tab && tab.id !== 'world') {
    if (s.kind === 'model' && tab.kind === 'model' && s.id === tab.modelId) return tab.pivot;
    if (s.kind === 'entity' && tab.kind === 'entity' && s.id === tab.entityId) return tab.pivot;
    return null;
  }
  if (s.kind === 'entity') { const rec = entityObjects.get(s.id); return rec ? rec.object : null; }
  if (s.kind === 'worldObject' || s.kind === 'worldPart') return s.object;
  return null;
}

function saveWorldObjectTransform(key, object) {
  if (!key || !object) return;
  if (!levelData.worldTransforms || typeof levelData.worldTransforms !== 'object') levelData.worldTransforms = {};
  levelData.worldTransforms[key] = {
    position: object.position.toArray(),
    rotation: object.rotation.toArray(),
    scale: object.scale.toArray()
  };
}

function select(sel, { silent = false, additive = false } = {}) {
  detachMultiGroup();
  if (!sel) {
    state.selection = null;
    state.selections = [];
  } else if (additive && state.activeTab === 'world' && ['entity', 'worldObject', 'worldPart'].includes(sel.kind)) {
    const key = selKey(sel);
    const idx = state.selections.findIndex((item) => selKey(item) === key);
    if (idx >= 0) {
      state.selections.splice(idx, 1);
      state.selection = state.selections[state.selections.length - 1] || null;
    } else {
      state.selections.push(sel);
      state.selection = sel;
    }
  } else {
    state.selection = sel;
    state.selections = [sel];
  }
  if (sel && (sel.kind === 'worldObject' || sel.kind === 'worldPart')) {
    const path = sel.key || sel.object?.userData.studioPath || '';
    if (path.startsWith('entity:')) state.expanded.add('f:ws');
    if (path.startsWith('static:')) state.expanded.add('f:generated');
    const parts = path.split('/');
    let parentPath = parts[0];
    for (const part of parts.slice(1)) {
      state.expanded.add(`world-node:${parentPath}`);
      state.collapsed.delete(`world-node:${parentPath}`);
      parentPath += '/' + part;
    }
  }
  attachGizmo();
  if (!silent) { refreshExplorer(); renderInspector(); }
}

function attachGizmo() {
  detachMultiGroup();
  const objs = state.activeTab === 'world' ? getSelectedObjects() : [];
  let target = null;

  if (objs.length > 1) {
    const center = new THREE.Vector3();
    for (const o of objs) {
      o.updateMatrixWorld(true);
      center.add(new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()));
    }
    multiGroup.position.copy(center.divideScalar(objs.length));
    multiGroup.rotation.set(0, 0, 0);
    multiGroup.scale.set(1, 1, 1);
    multiGroup.updateMatrixWorld(true);
    for (const o of objs) multiGroup.attach(o);
    target = multiGroup;
  } else {
    target = selectedObject();
  }

  if (target && ['translate', 'rotate', 'scale'].includes(state.tool)) {
    transform.attach(target);
    transform.setMode(state.tool);
    transform.getHelper().visible = true;
  } else {
    transform.detach();
  }
  if (target) { boxHelper.setFromObject(target); boxHelper.visible = true; } else boxHelper.visible = false;
}


function setTool(tool) {
  state.tool = tool;
  $$('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  attachGizmo();
}

function setSnap(value) {
  state.snap = Number(value) || 0;
  transform.setTranslationSnap(state.snap || null);
  transform.setScaleSnap(state.snap || null);
  transform.setRotationSnap(state.snap ? THREE.MathUtils.degToRad(15) : null);
}

// -----------------------------------------------------------------------------
// Insert / duplicate / delete
// -----------------------------------------------------------------------------
function pointInFrontOfCamera() {
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  let t = 14;
  if (dir.y < -0.05) t = THREE.MathUtils.clamp(-cam.position.y / dir.y, 5, 70);
  const p = cam.position.clone().addScaledVector(dir, t);
  p.y = 0;
  return p;
}

const GROUND_Y = { vehicle: 0.12, pickup: 0.18, crate: 0.18, barrel: 0.18, ramp: 0, building: 0, road: 0 };

function addEntity(entity, { select: doSelect = true } = {}) {
  levelData.entities.push(entity);
  createEntityObject(entity, { register: false });
  if (doSelect) select({ kind: 'entity', id: entity.id });
  commit();
  refreshExplorer();
}

function insertPrefab(prefab) {
  if (state.activeTab !== 'world') { toast('Switch to the World Map tab to insert parts.'); return; }
  const p = pointInFrontOfCamera();
  const e = makeEntity(prefab, [p.x, 0, p.z]);
  e.pos[1] = GROUND_Y[e.type] !== undefined ? GROUND_Y[e.type] : e.scale[1] / 2;
  e.id = nextEntityId(prefab.type);
  addEntity(e);
  toast(`Inserted ${e.name}`, 'ok');
}

function duplicateSelection() {
  const ents = state.selections.filter((s) => s.kind === 'entity');
  if (!ents.length || state.activeTab !== 'world') { toast('Select a world entity to duplicate.'); return; }
  detachMultiGroup();
  const newSels = [];
  for (const s of ents) {
    const src = entityOf(s.id);
    if (!src) continue;
    const copy = structuredClone(src);
    copy.id = nextEntityId(src.type);
    copy.name = src.name.replace(/ copy( \d+)?$/, '') + ' copy';
    copy.pos = [src.pos[0] + 2, src.pos[1], src.pos[2] + 2];
    addEntity(copy, { select: false });
    newSels.push({ kind: 'entity', id: copy.id });
  }
  state.selections = newSels;
  state.selection = newSels[newSels.length - 1] || null;
  attachGizmo();
  refreshExplorer();
  renderInspector();
}

function deleteSelection() {
  if (state.activeTab !== 'world') return;
  const targets = state.selections.filter((s) => s.kind === 'entity' || s.kind === 'worldObject' || s.kind === 'worldPart');
  if (!targets.length) return;
  detachMultiGroup();
  for (const s of targets) {
    if (s.kind === 'entity') {
      const i = levelData.entities.findIndex((e) => e.id === s.id);
      if (i < 0) continue;
      levelData.entities.splice(i, 1);
      removeEntityObject(s.id);
      for (const t of [...state.tabs]) if (t.kind === 'entity' && t.entityId === s.id) closeTab(t.id);
    } else if (s.kind === 'worldObject' || s.kind === 'worldPart') {
      const path = s.key || s.object?.userData.studioPath;
      if (!path) continue;
      levelData.worldTransforms = levelData.worldTransforms || {};
      levelData.worldTransforms[path] = { deleted: true };
      removeEntityObject(path);
    }
  }
  select(null);
  commit();
  refreshExplorer();
}


// -----------------------------------------------------------------------------
// Camera: orbit + fly + focus
// -----------------------------------------------------------------------------
function focusSelection() {
  const obj = selectedObject() || (activeTab().id !== 'world' ? activeTab().pivot : null);
  if (!obj) return;
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const dist = Math.max(sphere.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.25, 1.5);
  const dir = cam.position.clone().sub(controls.target).normalize();
  if (dir.lengthSq() < 0.001) dir.set(0.75, 0.45, 1).normalize();
  controls.target.copy(sphere.center);
  cam.position.copy(sphere.center).addScaledVector(dir, dist);
  controls.update();
}

function navigateTo(x, y, z, distance) {
  if (state.activeTab !== 'world') setActiveTab('world');
  const target = new THREE.Vector3(x, y, z);
  const direction = new THREE.Vector3(0.75, 0.62, 1).normalize();
  controls.target.copy(target);
  cam.position.copy(target).addScaledVector(direction, distance);
  controls.update();
  saveCameraToTab(activeTab());
}

function flyUpdate(dt) {
  const k = state.keys;
  const worldTab = state.activeTab === 'world';
  const workspaceFocused = document.activeElement === $('#studio-canvas');
  let f = 0, r = 0;
  if (workspaceFocused && (k.has('ArrowUp') || k.has('KeyW'))) f += 1;
  if (workspaceFocused && (k.has('ArrowDown') || k.has('KeyS'))) f -= 1;
  if (workspaceFocused && (k.has('ArrowRight') || k.has('KeyD'))) r += 1;
  if (workspaceFocused && (k.has('ArrowLeft') || k.has('KeyA'))) r -= 1;
  if (!f && !r) return;
  const speed = (worldTab ? 28 : 3.5) * (k.has('ShiftLeft') || k.has('ShiftRight') ? 3.2 : 1) * dt;
  const fwd = new THREE.Vector3();
  cam.getWorldDirection(fwd);
  const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
  const move = new THREE.Vector3().addScaledVector(fwd, f * speed).addScaledVector(right, r * speed);
  cam.position.add(move);
  controls.target.add(move);
}

// -----------------------------------------------------------------------------
// Picking
// -----------------------------------------------------------------------------
function terrainHitAtEvent(event) {
  const rect = $('#studio-canvas').getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), cam);
  return raycaster.intersectObjects(sculptableTerrainMeshes, false)[0] || null;
}

function updateBrushPreview(event) {
  if (!brushPreview) return;
  if (state.activeTab !== 'world' || state.tool !== 'sculpt') { brushPreview.visible = false; return; }
  const hit = terrainHitAtEvent(event);
  if (!hit) { brushPreview.visible = false; return; }
  const radius = Number($('#sculpt-size').value);
  if (brushPreview.userData.radius !== radius) {
    brushPreview.geometry.dispose();
    brushPreview.geometry = new THREE.RingGeometry(Math.max(0.1, radius - 0.16), radius, 48);
    brushPreview.geometry.rotateX(-Math.PI / 2);
    brushPreview.userData.radius = radius;
  }
  brushPreview.position.set(hit.point.x, hit.point.y + 0.12, hit.point.z);
  brushPreview.visible = true;
}

function pick(ev, { part = false } = {}) {
  const rect = $('#studio-canvas').getBoundingClientRect();
  const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, cam);
  const tab = activeTab();
  if (tab.id === 'world') {
    const hits = raycaster.intersectObjects(worldRoot.children, true);
    for (const hit of hits) {
      let root = hit.object;
      let blocked = false;
      while (root && root !== worldRoot) {
        if (root.userData.studioSelectable === false) blocked = true;
        if (root.parent === worldRoot) break;
        root = root.parent;
      }
      if (blocked || !root || root === worldRoot) continue;
      const entityId = root.userData.entityId;
            if (part && hit.object !== root) {
        const object = hit.object;
        select({ kind: 'worldPart', object, key: object.userData.studioPath, name: object.userData.studioName || object.name || 'Model part' }, { additive: ev.shiftKey });
      } else if (entityId) select({ kind: 'entity', id: entityId }, { additive: ev.shiftKey });
      else select({ kind: 'worldObject', object: root, key: root.userData.studioPath, name: root.userData.studioName || root.name || 'Map object' }, { additive: ev.shiftKey });
      return;
    }
    select(null, { additive: ev.shiftKey });

  } else {
    const hits = raycaster.intersectObject(tab.pivot, true);
    if (hits.length) select(tab.kind === 'model' ? { kind: 'model', id: tab.modelId } : { kind: 'entity', id: tab.entityId });
    else select(null);
  }
}

// ============================================================================
// (continued in part 2: explorer, inspector, assets, toolbox, export, boot)
// ============================================================================

// -----------------------------------------------------------------------------
// Inspector building blocks
// -----------------------------------------------------------------------------
let rebuildTimer = 0;
function scheduleRebuild(fn, ms = 60) { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(fn, ms); }

const row = (label, ...ctrl) => h('div', { class: 'row' }, h('label', { title: label }, label), ...ctrl);
const group = (title, ...kids) => h('div', { class: 'group' }, h('h4', {}, title), ...kids);

/** number input bound to obj[key]; `after()` runs on every edit, commit() on change. */
function numField(obj, key, { step = 'any', min, max } = {}, after = () => {}) {
  const el = h('input', { type: 'number', step, min, max, value: fmt(obj[key]) });
  el.addEventListener('input', () => { const v = parseFloat(el.value); if (Number.isFinite(v)) { obj[key] = v; after(); } });
  el.addEventListener('change', () => commit());
  return el;
}

function textField(obj, key, after = () => {}) {
  const el = h('input', { type: 'text', value: obj[key] || '' });
  el.addEventListener('input', () => { obj[key] = el.value; after(); });
  el.addEventListener('change', () => commit());
  return el;
}

function colorField(obj, key, { fallback = '#ffffff', clearable = false } = {}, after = () => {}) {
  const el = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(obj[key] || '') ? obj[key] : fallback });
  el.addEventListener('input', () => { obj[key] = el.value; after(); });
  el.addEventListener('change', () => commit());
  if (!clearable) return el;
  const clear = h('button', { class: 'small', title: 'Use the built-in colour', onclick: () => { obj[key] = ''; el.value = fallback; after(); commit(); } }, 'Clear');
  return h('div', { class: 'inline' }, el, clear);
}

function selectField(options, value, onPick) {
  const el = h('select', {}, options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
  el.value = value;
  el.addEventListener('change', () => onPick(el.value));
  return el;
}

function checkField(obj, key, after = () => {}) {
  const el = h('input', { type: 'checkbox', checked: Boolean(obj[key]) });
  el.addEventListener('change', () => { obj[key] = el.checked; after(); commit(); });
  return h('div', { class: 'inline' }, el);
}

function triple(arr, { step = 0.1, convert = null } = {}, after = () => {}) {
  const inputs = [0, 1, 2].map((i) => {
    const el = h('input', { type: 'number', step, value: fmt(convert ? convert.to(arr[i]) : arr[i]) });
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      if (!Number.isFinite(v)) return;
      arr[i] = convert ? convert.from(v) : v;
      after();
    });
    el.addEventListener('change', () => commit());
    return el;
  });
  const wrap = h('div', { class: 'inline' }, ...['X', 'Y', 'Z'].map((ax, i) => h('div', { class: 'xyz' }, h('span', {}, ax), inputs[i])));
  wrap._inputs = inputs;
  wrap._values = arr;
  return wrap;
}

/** PNG texture dropdown + UV repeat sliders for anything with {texture, texRepeat}. */
function textureControls(target, after) {
  if (!Array.isArray(target.texRepeat)) target.texRepeat = [1, 1];
  const textures = levelData.assets.textures;
  const opts = [['', '(none)'], ...textures.map((p) => [p, basename(p)])];
  if (target.texture && !textures.includes(target.texture)) opts.push([target.texture, basename(target.texture) + ' (unregistered)']);
  const sel = selectField(opts, target.texture || '', (v) => { target.texture = v; after(); commit(); refreshAssetPanel(); });
  const thumb = target.texture ? h('img', { src: getAssetSource(target.texture), alt: '', style: 'width:100%;max-height:64px;object-fit:cover;border:1px solid var(--line);border-radius:4px;margin-bottom:6px' }) : null;
  const rep = (i, label) => {
    const num = h('input', { type: 'number', step: 0.25, min: 0.05, value: fmt(target.texRepeat[i]) });
    const rng = h('input', { type: 'range', min: 0.25, max: 32, step: 0.25, value: Math.min(32, target.texRepeat[i]) });
    const apply = (v) => { if (Number.isFinite(v) && v > 0) { target.texRepeat[i] = v; after(); } };
    num.addEventListener('input', () => { apply(parseFloat(num.value)); rng.value = Math.min(32, target.texRepeat[i]); });
    rng.addEventListener('input', () => { num.value = fmt(parseFloat(rng.value)); apply(parseFloat(rng.value)); });
    num.addEventListener('change', () => commit());
    rng.addEventListener('change', () => commit());
    return row(label, h('div', { class: 'inline' }, rng, h('div', { style: 'width:64px;flex:none' }, num)));
  };
  return [row('PNG Texture', sel), thumb && h('div', { class: 'row', style: 'grid-template-columns:1fr' }, thumb), rep(0, 'UV Repeat X'), rep(1, 'UV Repeat Y')];
}

// -----------------------------------------------------------------------------
// Inspector
// -----------------------------------------------------------------------------
const inspectorRefs = { transform: null };

function setInspector(title, ...nodes) {
  $('#inspector-title').textContent = title;
  $('#inspector-body').replaceChildren(...nodes.flat().filter(Boolean));
}

function renderInspector() {
  inspectorRefs.transform = null;
  const s = state.selection;
  if (!s) { setInspector('Properties', h('p', { class: 'empty' }, 'Select something in the viewport or the Explorer to edit it.')); return; }
  if (s.kind === 'entity') return renderEntityInspector(entityOf(s.id));
  if (s.kind === 'worldObject' || s.kind === 'worldPart') return renderWorldObjectInspector(s);
  if (s.kind === 'model') return renderModelInspector(s.id);
  if (s.kind === 'audio') return renderAudioInspector();
  if (s.kind === 'param') return renderParamInspector(s.key);
}

function afterEntityEdit(entity, { structural = true } = {}) {
  const redo = () => {
    if (state.activeTab === 'world') rebuildEntityObject(entity);
    else if (entityObjects.has(entity.id)) rebuildEntityObject(entity);
    for (const t of state.tabs) if (t.kind === 'entity' && t.entityId === entity.id) { t.title = entity.name; mountTabObject(t); }
    attachGizmo();
  };
  if (structural) scheduleRebuild(redo);
}

function renderWorldObjectInspector(selection) {
  const object = selection.object;
  if (!object) { setInspector('Properties'); return; }
  const key = selection.key || object.userData.studioPath;
  const pos = triple(object.position.toArray(), { step: 0.1 }, () => {
    object.position.fromArray(posValues);
    saveWorldObjectTransform(key, object);
    if (boxHelper.visible) boxHelper.update();
  });
  const posValues = pos._values;
  const rot = triple(object.rotation.toArray(), { step: 5, convert: { to: deg, from: rad } }, () => {
    object.rotation.fromArray(rotValues);
    saveWorldObjectTransform(key, object);
    if (boxHelper.visible) boxHelper.update();
  });
  const rotValues = rot._values;
  const scale = triple(object.scale.toArray(), { step: 0.1 }, () => {
    object.scale.fromArray(scaleValues);
    saveWorldObjectTransform(key, object);
    if (boxHelper.visible) boxHelper.update();
  });
  const scaleValues = scale._values;
inspectorRefs.transform = { pos, rot, scl: scale, object };
  setInspector(`World object — ${selection.name}`,
    group('Transform', row('Position', pos), row('Rotation °', rot), row('Scale', scale)),
    h('p', { class: 'note' }, selection.kind === 'worldPart' ? 'This part belongs to its parent model. Its local transform is saved with the level.' : 'This generated map model and its parts are editable and saved with the level.'),
    h('div', { class: 'btnrow' },
      h('button', { class: 'small', onclick: focusSelection }, 'Focus (F)'),
      h('button', { class: 'small', onclick: deleteSelection }, 'Delete')));
}

function renderEntityInspector(entity) {
  if (!entity) { setInspector('Properties'); return; }
  const inWorld = state.activeTab === 'world';
  const nodes = [];
  nodes.push(group('Object',
    row('Name', textField(entity, 'name', () => { renderTabs(); refreshExplorer({ keepScroll: true }); })),
    row('Type', h('div', {}, entity.type, h('span', { class: 'tag' }, entity.id)))));

  // appearance
  const vehicleFallback = entity.type === 'vehicle' ? (entity.vehicle && entity.vehicle.bodyHex) || '#dc2626' : '#ffffff';
  const appearance = [row(entity.type === 'vehicle' ? 'Body color' : 'Color', colorField(entity, 'color', { fallback: vehicleFallback, clearable: true }, () => afterEntityEdit(entity))),
    ...textureControls(entity, () => afterEntityEdit(entity))];
  if (entity.type === 'vehicle') {
    entity.vehicle = entity.vehicle || {};
    appearance.push(row('Accent color', colorField(entity.vehicle, 'accentHex', { fallback: '#f8fafc' }, () => afterEntityEdit(entity))));
    appearance.push(row('Coupe body', checkField(entity.vehicle, 'isCoupe', () => afterEntityEdit(entity))));
    appearance.push(row('Supercar', checkField(entity.vehicle, 'isSupercar', () => afterEntityEdit(entity))));
  }
  nodes.push(group('Appearance', ...appearance));

  // type-specific
  if (entity.type === 'pickup') {
    entity.pickup = entity.pickup || { kind: 'left', itemId: 'cash' };
    const ids = () => (entity.pickup.kind === 'right' ? WEAPON_IDS.filter((i) => i !== 'fists') : LEFT_ITEM_IDS);
    nodes.push(group('Pickup',
      row('Slot', selectField([['right', 'Right hand (weapon)'], ['left', 'Left hand (item)']], entity.pickup.kind, (v) => { entity.pickup.kind = v; entity.pickup.itemId = ids()[0]; afterEntityEdit(entity); commit(); renderInspector(); })),
      row('Item', selectField(ids().map((i) => [i, i]), entity.pickup.itemId, (v) => { entity.pickup.itemId = v; afterEntityEdit(entity); commit(); }))));
  }
  if (entity.type === 'crate') {
    const loot = entity.loot;
    const lootOptions = [['', 'Nothing'], ...WEAPON_IDS.filter((i) => i !== 'fists').map((i) => ['right:' + i, 'Weapon: ' + i]), ...LEFT_ITEM_IDS.map((i) => ['left:' + i, 'Item: ' + i])];
    nodes.push(group('Crate loot', row('Drops', selectField(lootOptions, loot ? `${loot.type}:${loot.id}` : '', (v) => {
      entity.loot = v ? { type: v.split(':')[0], id: v.split(':')[1] } : null; commit();
    }))));
  }
  if (entity.type === 'prop') {
    entity.prop = entity.prop || { shape: 'box', solid: true };
    nodes.push(group('Prop',
      row('Shape', selectField([['box', 'Box'], ['cylinder', 'Cylinder'], ['sphere', 'Sphere'], ['cone', 'Cone']], entity.prop.shape, (v) => { entity.prop.shape = v; afterEntityEdit(entity); commit(); })),
      row('Solid (collides)', checkField(entity.prop, 'solid'))));
  } else if (entity.type === 'building') {
    entity.building = entity.building || { width: 12, depth: 10, height: 12, roofColor: '#1e293b', windowColor: '#7dd3fc' };
    nodes.push(group('Building dimensions',
      row('Width (m)', numField(entity.building, 'width', { step: 1, min: 2, max: 200 }, () => afterEntityEdit(entity))),
      row('Depth (m)', numField(entity.building, 'depth', { step: 1, min: 2, max: 200 }, () => afterEntityEdit(entity))),
      row('Height (m)', numField(entity.building, 'height', { step: 1, min: 2, max: 300 }, () => afterEntityEdit(entity))),
      row('Roof color', colorField(entity.building, 'roofColor', { fallback: '#1e293b' }, () => afterEntityEdit(entity))),
      row('Window color', colorField(entity.building, 'windowColor', { fallback: '#7dd3fc' }, () => afterEntityEdit(entity)))));
  } else if (entity.type === 'road') {
    entity.road = entity.road || { width: 24, depth: 12, markings: true };
    nodes.push(group('Road dimensions',
      row('Width (m)', numField(entity.road, 'width', { step: 1, min: 2, max: 500 }, () => afterEntityEdit(entity))),
      row('Length (m)', numField(entity.road, 'depth', { step: 1, min: 2, max: 500 }, () => afterEntityEdit(entity))),
      row('Center marking', checkField(entity.road, 'markings', () => afterEntityEdit(entity)))));
  }
  if (entity.type === 'ramp') nodes.push(h('p', { class: 'note' }, 'Ramps rise toward their local +Z. Scale X / Y / Z = width / height / length. In-game ramps follow the nearest 90° heading.'));

  // transform
  if (inWorld) {
    const syncObj = () => { updateEntityTransform(entity); if (boxHelper.visible) boxHelper.update(); };
    const pos = triple(entity.pos, { step: 0.1 }, syncObj);
    const rot = triple(entity.rot, { step: 5, convert: { to: deg, from: rad } }, syncObj);
    const scl = triple(entity.scale, { step: 0.1 }, syncObj);
    inspectorRefs.transform = { pos, rot, scl, entity };
    nodes.push(group('Transform', row('Position', pos), row('Rotation °', rot), row('Scale', scl)));
  } else {
    nodes.push(h('p', { class: 'note' }, 'Isolated view. Position / rotation / scale are edited in the World Map tab. Appearance edits here are saved on the entity.'));
  }

  nodes.push(h('div', { class: 'btnrow' },
    inWorld ? h('button', { class: 'small', onclick: () => openEntityTab(entity.id) }, 'Open in tab') : null,
    h('button', { class: 'small', onclick: focusSelection }, 'Focus (F)'),
    inWorld ? h('button', { class: 'small', onclick: duplicateSelection }, 'Duplicate') : null,
    inWorld ? h('button', { class: 'small', onclick: deleteSelection }, 'Delete') : null));
  setInspector(`Entity — ${entity.name}`, ...nodes);
}

/** Refresh transform inputs while a gizmo drags (without rebuilding the whole inspector). */
function syncInspectorTransform() {
  const r = inspectorRefs.transform;
  if (!r) return;
  const set = (wrap, arr, conv) => wrap._inputs.forEach((el, i) => { if (document.activeElement !== el) el.value = fmt(conv ? conv(arr[i]) : arr[i]); });
  if (r.object) {
    set(r.pos, r.object.position.toArray()); set(r.rot, r.object.rotation.toArray(), deg); set(r.scl, r.object.scale.toArray());
  } else {
    set(r.pos, r.entity.pos); set(r.rot, r.entity.rot, deg); set(r.scl, r.entity.scale);
  }
}

// ---- models ----
function rebuildModelTabsFor(modelId) {
  for (const t of state.tabs) if (t.kind === 'model' && t.modelId === modelId) mountTabObject(t);
  attachGizmo();
}

function appearancePreset(modelId) {
  const m = levelData.params.models;
  if (!m[modelId]) m[modelId] = { color: '', texture: '', texRepeat: [1, 1] };
  return m[modelId];
}

function renderModelInspector(modelId) {
  const def = MODEL_BY_ID[modelId];
  const preset = appearancePreset(modelId);
  const P = levelData.params;
  const redo = () => scheduleRebuild(() => rebuildModelTabsFor(modelId));
  const nodes = [];
  const params = [];
  if (modelId === 'player') {
    params.push(row('Body color', colorField(P.player, 'bodyColor', { fallback: '#1e293b' }, redo)));
    params.push(row('Accent color', colorField(P.player, 'accentColor', { fallback: '#0f172a' }, redo)));
    params.push(h('p', { class: 'note' }, 'Torso and sleeves use the body color; legs and hair use the accent color. Applies to the first- and third-person rigs in the game.'));
  } else if (WEAPON_IDS.includes(modelId)) {
    const w = P.weapons[modelId];
    params.push(row('Damage', numField(w, 'damage', { step: 1, min: 0 })));
    params.push(row('Cooldown (s)', numField(w, 'cooldown', { step: 0.01, min: 0.01 })));
    params.push(row('Reach', numField(w, 'reach', { step: 0.05, min: 0.1 })));
  } else if (modelId === 'npc_guard') {
    const g = appearancePreset('npc_guard');
    params.push(row('Shirt color', colorField(g, 'shirtColor', { fallback: '#1d4ed8' }, redo)));
    params.push(row('Pants color', colorField(g, 'pantsColor', { fallback: '#0b1220' }, redo)));
    params.push(h('p', { class: 'note' }, 'Used by the police officers that respond to your wanted level.'));
  } else {
    params.push(row('Acceleration ×', numField(P.vehicles, 'accelMultiplier', { step: 0.05, min: 0.1 })));
    params.push(row('Braking ×', numField(P.vehicles, 'brakeMultiplier', { step: 0.05, min: 0.1 })));
    params.push(row('Steering ×', numField(P.vehicles, 'steerMultiplier', { step: 0.05, min: 0.1 })));
    params.push(row('Grip ×', numField(P.vehicles, 'gripMultiplier', { step: 0.05, min: 0.1 })));
    params.push(h('p', { class: 'note' }, 'Body and accent colors are set per vehicle on each vehicle entity. The tint below recolors every car that uses this body style.'));
  }
  nodes.push(group('Parameters', ...params));
  nodes.push(group('Appearance',
    row('Tint', colorField(preset, 'color', { fallback: '#ffffff', clearable: true }, redo)),
    ...textureControls(preset, redo)));
  nodes.push(h('div', { class: 'btnrow' },
    h('button', { class: 'small', onclick: () => openModelTab(modelId) }, state.activeTab === 'model:' + modelId ? 'Viewing' : 'Open in tab'),
    h('button', { class: 'small', onclick: focusSelection }, 'Focus (F)'),
    h('button', { class: 'small', onclick: () => { preset.color = ''; preset.texture = ''; preset.texRepeat = [1, 1]; rebuildModelTabsFor(modelId); commit(); renderInspector(); refreshAssetPanel(); } }, 'Reset appearance')));
  if (state.activeTab !== 'world') nodes.push(h('p', { class: 'note' }, 'Gizmos in a model tab only move the preview; they are not saved.'));
  setInspector(`Model — ${def.name}`, ...nodes);
}

// ---- audio bindings ----
function renderAudioInspector() {
  const audioOpts = [['', 'Built-in synth'], ...levelData.assets.audio.map((p) => [p, basename(p)])];
  const nodes = [h('p', { class: 'note' }, 'Pick a file from assets/audio for each sound event, or keep the built-in synth. If a file fails to load, the game falls back to the synth.')];
  for (const [ev, label] of AUDIO_EVENTS) {
    const cur = levelData.audioBindings[ev] || '';
    const opts = audioOpts.slice();
    if (cur && !levelData.assets.audio.includes(cur)) opts.push([cur, basename(cur) + ' (unregistered)']);
    const sel = selectField(opts, cur, async (v) => {
      levelData.audioBindings[ev] = v;
      if (v) await loadCustomAudio(v);
      commit();
    });
    nodes.push(group(label,
      row('Sound', sel),
      h('div', { class: 'btnrow' },
        h('button', { class: 'small', onclick: async () => { const p = levelData.audioBindings[ev]; if (p) await loadCustomAudio(p); sfx.previewEvent(ev); } }, 'Test Sound'),
        h('button', { class: 'small', onclick: () => pickAudioFile((path) => { levelData.audioBindings[ev] = path; commit(); renderInspector(); }) }, '+ Import file…'))));
  }
  setInspector('Audio Bindings', ...nodes);
}

// ---- parameters ----
function renderParamInspector(key) {
  const P = levelData.params;
  if (key === 'terrain') {
    const count = Object.keys(levelData.terrain.heights || {}).length;
    setInspector('World Editing — Terrain',
      group('Sculpt brush', h('p', { class: 'note' }, 'Choose Sculpt in the top toolbar, select Raise, Lower, or Smooth, then drag over any ground surface. Brush edits are saved with the level and affect gameplay terrain collision.'),
        h('p', { class: 'note' }, `Terrain height cells: ${count.toLocaleString()}`),
        h('div', { class: 'btnrow' }, h('button', { class: 'small', onclick: () => { if (!count) return; levelData.terrain.heights = {}; refreshTerrainSculpt(); commit(); renderInspector(); toast('Terrain sculpt cleared.', 'ok'); } }, 'Clear terrain sculpt'))));
  } else if (key === 'player') {
    setInspector('Game Parameters — Player Stats',
      group('Player',
        row('Max HP', numField(P.player, 'maxHp', { step: 1, min: 1 })),
        row('Start cash', numField(P.player, 'startCash', { step: 10, min: 0 })),
        row('Move speed', numField(P.player, 'moveSpeed', { step: 0.1, min: 0.5 })),
        row('Sprint ×', numField(P.player, 'sprintMultiplier', { step: 0.05, min: 1 })),
        row('Jump force', numField(P.player, 'jumpForce', { step: 0.1, min: 1 })),
        row('Body color', colorField(P.player, 'bodyColor', { fallback: '#1e293b' }, () => scheduleRebuild(() => rebuildModelTabsFor('player')))),
        row('Accent color', colorField(P.player, 'accentColor', { fallback: '#0f172a' }, () => scheduleRebuild(() => rebuildModelTabsFor('player'))))),
      h('p', { class: 'note' }, 'Move speed is in metres per second (default 4.7). Sprint speed = move speed × sprint multiplier.'));
  } else if (key === 'vehicles') {
    const labels = ['R', 'N', '1', '2', '3', '4', '5', '6'];
    const gears = P.vehicles.gearCapsMph;
    setInspector('Game Parameters — Vehicle Gear Speeds',
      group('Gear speed caps (MPH)', ...labels.map((l, i) => row(`Gear ${l}`, numField(gears, i, { step: 1, min: 0 })))),
      group('Handling multipliers',
        row('Acceleration ×', numField(P.vehicles, 'accelMultiplier', { step: 0.05, min: 0.1 })),
        row('Braking ×', numField(P.vehicles, 'brakeMultiplier', { step: 0.05, min: 0.1 })),
        row('Steering ×', numField(P.vehicles, 'steerMultiplier', { step: 0.05, min: 0.1 })),
        row('Grip ×', numField(P.vehicles, 'gripMultiplier', { step: 0.05, min: 0.1 }))));
  } else if (key.startsWith('weapon:')) {
    const id = key.slice(7);
    const w = P.weapons[id];
    setInspector(`Game Parameters — ${(RIGHT_WEAPONS[id] && RIGHT_WEAPONS[id].name) || id}`,
      group('Weapon', row('Damage', numField(w, 'damage', { step: 1, min: 0 })), row('Cooldown (s)', numField(w, 'cooldown', { step: 0.01, min: 0.01 })), row('Reach', numField(w, 'reach', { step: 0.05, min: 0.1 }))),
      h('p', { class: 'note' }, id === 'hotdog_shooter' ? 'Reach is the projectile range in metres.' : 'Reach is the melee range in metres.'));
  } else if (key === 'weapons') {
    setInspector('Game Parameters — Weapons', h('p', { class: 'note' }, 'Pick a weapon in the Explorer to edit its damage, cooldown and reach.'));
  }
}

// -----------------------------------------------------------------------------
// Explorer
// -----------------------------------------------------------------------------
function objectTreeNode(object) {
  const key = object.userData.studioPath;
  if (!key) return null;
  const entityId = object.parent === worldRoot ? object.userData.entityId : null;
  const entityRoot = entityId && entityObjects.get(entityId)?.object === object;
  const kind = entityRoot ? 'entity' : object.parent === worldRoot ? 'worldObject' : 'worldPart';
  const name = object.userData.studioName || object.name || 'Object';
  const children = object.children.filter((child) => child.userData.studioSelectable !== false).map(objectTreeNode).filter(Boolean);
  return {
    id: `world-node:${key}`, label: name, glyph: entityRoot ? (ENTITY_GLYPH[entityOf(entityId)?.type] || '•') : '▣',
    folder: children.length > 0, defaultCollapsed: children.length > 0,
    sel: entityRoot ? { kind: 'entity', id: entityId } : { kind, object, key, name },
    children
  };
}

function treeData() {
  const P = levelData.params;
  const entities = levelData.entities.map((entity) => {
    const record = entityObjects.get(entity.id);
    return record ? objectTreeNode(record.object) : null;
  }).filter(Boolean);
  let selectedStaticRoot = state.selection?.kind === 'worldObject' || state.selection?.kind === 'worldPart' ? state.selection.object : null;
  while (selectedStaticRoot && selectedStaticRoot.parent !== worldRoot) selectedStaticRoot = selectedStaticRoot.parent;
  if (selectedStaticRoot?.userData.entityId) selectedStaticRoot = null;
  const generated = worldRoot.children.filter((object) => object.parent === worldRoot && object.userData.studioPath?.startsWith('static:') && (object.userData.studioNamed || (object.isGroup && object.children.length > 1) || object === selectedStaticRoot)).map(objectTreeNode).filter(Boolean);
  return [
    { id: 'f:models', label: 'Models', folder: true, children: MODELS.map((m) => ({ id: 'model:' + m.id, label: m.name, glyph: m.glyph, sel: { kind: 'model', id: m.id }, open: () => openModelTab(m.id) })) },
    { id: 'f:audio', label: 'Audio Bindings', folder: true, children: [{ id: 'audio', label: 'Sound events', glyph: '♪', sel: { kind: 'audio' } }] },
    { id: 'f:params', label: 'Game Parameters', folder: true, children: [
      { id: 'param:player', label: 'Player Stats', glyph: '☺', sel: { kind: 'param', key: 'player' } },
      { id: 'param:vehicles', label: 'Vehicle Gear Speeds', glyph: '⚙', sel: { kind: 'param', key: 'vehicles' } },
      { id: 'f:weapons', label: 'Weapons', folder: true, sel: { kind: 'param', key: 'weapons' }, children: Object.keys(P.weapons).map((w) => ({ id: 'weapon:' + w, label: (RIGHT_WEAPONS[w] && RIGHT_WEAPONS[w].name) || w, glyph: '╾', sel: { kind: 'param', key: 'weapon:' + w } })) }
    ] },
    { id: 'f:world', label: 'World Editing', folder: true, children: [
      { id: 'param:terrain', label: 'Terrain Sculpt', glyph: '◒', sel: { kind: 'param', key: 'terrain' } },
      { id: 'f:ws', label: `Map Objects (${levelData.entities.length})`, folder: true, children: entities },
      { id: 'f:generated', label: `Generated Map (${generated.length})`, folder: true, defaultCollapsed: true, children: generated }
    ] }
  ];
}

const selKey = (s) => (!s ? '' : s.kind === 'entity' ? `world-node:entity:${s.id}` : s.kind === 'worldObject' || s.kind === 'worldPart' ? `world-node:${s.key || s.object?.userData.studioPath}` : s.kind === 'model' ? 'model:' + s.id : s.kind === 'audio' ? 'audio' : s.kind === 'param' ? (s.key.startsWith('weapon:') ? s.key : 'param:' + s.key) : '');

function refreshExplorer({ keepScroll = true } = {}) {
  const tree = $('#explorer-tree');
  const top = tree.scrollTop;
  const q = state.query.trim().toLowerCase();
  const out = [];
  const isOpen = (node) => q || state.expanded.has(node.id) || (!node.defaultCollapsed && !state.collapsed.has(node.id));
  const visit = (nodes, depth) => {
    let any = false;
    for (const node of nodes) {
      if (node.folder) {
        const open = isOpen(node);
        const before = out.length;
        out.push({ n: node, depth, open });
        let hit = false;
        if (q || open) hit = visit(node.children, depth + 1);
        const match = !q || node.label.toLowerCase().includes(q) || hit;
        if (!match) out.length = before;
        any = any || match;
      } else if (!q || node.label.toLowerCase().includes(q)) { out.push({ n: node, depth }); any = true; }
    }
    return any;
  };
  visit(treeData(), 0);
    const selectedKeys = new Set(state.selections.map(selKey));
  tree.replaceChildren(...out.map(({ n, depth, open }) => {
    const selected = n.sel && selectedKeys.has(selKey(n.sel));
    const toggle = () => {
      const expanded = isOpen(n);
      if (expanded) { state.expanded.delete(n.id); state.collapsed.add(n.id); }
      else { state.collapsed.delete(n.id); state.expanded.add(n.id); }
      refreshExplorer();
    };
    return h('div', {
      class: `tnode${n.folder ? ' folder' : ''}${selected ? ' selected' : ''}`,
      style: `padding-left:${6 + depth * 14}px`,
      role: 'treeitem',
      onclick: (ev) => { if (n.sel) select(n.sel, { additive: ev.shiftKey }); else if (n.folder) toggle(); },
      ondblclick: () => { if (n.open) n.open(); }
    }, h('span', { class: 'twist', onclick: (event) => { event.stopPropagation(); if (n.folder) toggle(); } }, n.folder ? (open ? '▾' : '▸') : ''), h('span', { class: 'glyph' }, n.glyph || ''), h('span', { class: 'label', title: n.label }, n.label));
  }));

  if (keepScroll) tree.scrollTop = top;
}

// -----------------------------------------------------------------------------
// Assets panel (textures + audio) and import dialogs
// -----------------------------------------------------------------------------
function currentTextureTarget() {
  const s = state.selection;
  if (!s) return null;
  if (s.kind === 'entity') return entityOf(s.id);
  if (s.kind === 'model') return appearancePreset(s.id);
  return null;
}

function applyTextureToSelection(path) {
  const s = state.selection;
  const target = currentTextureTarget();
  if (!target) { toast('Select an object or a model first, then click a texture.'); return; }
  target.texture = path;
  if (!Array.isArray(target.texRepeat)) target.texRepeat = [1, 1];
  if (s.kind === 'entity') afterEntityEdit(target); else rebuildModelTabsFor(s.id);
  commit();
  renderInspector();
  refreshAssetPanel();
  toast(`Applied ${basename(path)}`, 'ok');
}

function refreshAssetPanel() {
  const grid = $('#texture-grid');
  const target = currentTextureTarget();
  grid.replaceChildren(...levelData.assets.textures.map((p) => h('button', {
    class: `thumb${target && target.texture === p ? ' active' : ''}`,
    title: `${p}${hasAssetOverride(p) ? ' (imported in this browser)' : ''}\nClick to apply to the selected object`,
    style: `background-image:url("${getAssetSource(p)}")`,
    onclick: () => applyTextureToSelection(p)
  }, h('span', {}, basename(p)))));
  if (!levelData.assets.textures.length) grid.replaceChildren(h('p', { class: 'empty-note' }, 'No textures registered yet.'));

  const list = $('#audio-list');
  list.replaceChildren(...levelData.assets.audio.map((p) => h('div', { class: 'audio-row' },
    h('span', { class: 'name', title: p }, basename(p)),
    h('button', { class: 'small', onclick: async () => { await loadCustomAudio(p); if (!playCustomAudio(p, 0.9)) toast(`Could not play ${basename(p)}. Is the file in assets/audio?`, 'err'); } }, 'Play'))));
  if (!levelData.assets.audio.length) list.replaceChildren(h('p', { class: 'empty-note' }, 'No audio files registered. Import one to bind it to a sound event.'));
}

function showModal(title, bodyNodes, actions) {
  const root = $('#modal-root');
  const close = () => root.replaceChildren();
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-label': title }, h('h2', {}, title), ...bodyNodes,
    h('div', { class: 'actions' }, ...actions.map((a) => h('button', { class: a.primary ? 'primary' : '', onclick: () => { if (a.run && a.run() === false) return; close(); } }, a.label))));
  root.replaceChildren(h('div', { class: 'modal-back', onclick: (ev) => { if (ev.target.classList.contains('modal-back')) close(); } }, box));
  const first = box.querySelector('input[type="text"]');
  if (first) { first.focus(); first.select(); }
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
}

function cleanName(name) { return name.replace(/[^a-zA-Z0-9._-]+/g, '_'); }

function downloadBlob(blob, filename) {
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function importAsset(file, kind, done) {
  const dir = kind === 'texture' ? 'assets/textures/' : 'assets/audio/';
  let name = cleanName(file.name);
  if (kind === 'texture' && !/\.(png|jpe?g|webp)$/i.test(name)) name += '.png';
  const dataUrl = await readAsDataUrl(file);
  const input = h('input', { type: 'text', value: dir + name, spellcheck: 'false' });
  const copy = h('input', { type: 'checkbox', checked: true });
  const preview = kind === 'texture' ? h('img', { class: 'preview', src: dataUrl, alt: 'Texture preview' }) : h('audio', { class: 'preview', controls: true, src: dataUrl, style: 'width:100%;height:40px;border:0;background:none' });
  showModal(kind === 'texture' ? 'Import PNG texture' : 'Import audio file', [
    preview,
    row('Project path', input),
    h('p', { class: 'note' }, `For the game to find it permanently, copy the file into the ${dir} folder under exactly this name. Studio previews it right away from this browser.`),
    h('label', { class: 'inline', style: 'gap:8px;margin-top:6px' }, copy, 'Also download a copy with this file name')
  ], [
    { label: 'Cancel' },
    { label: 'Add to project', primary: true, run: () => {
      let path = input.value.trim().replace(/\\/g, '/');
      if (!path.startsWith(dir)) { toast(`The path must start with ${dir}`, 'err'); return false; }
      if (!registerAssetOverride(path, dataUrl)) toast('Imported, but the browser storage is full: the file will not survive a reload. Copy it into the folder.', 'err');
      const list = kind === 'texture' ? levelData.assets.textures : levelData.assets.audio;
      if (!list.includes(path)) list.push(path);
      if (copy.checked) downloadBlob(file, basename(path));
      commit(); refreshAssetPanel();
      toast(`Added ${path}`, 'ok');
      if (done) done(path);
      return true;
    } }
  ]);
}

function pickFile(accept, handler) {
  const el = h('input', { type: 'file', accept, hidden: true });
  el.addEventListener('change', () => { if (el.files[0]) handler(el.files[0]); el.remove(); });
  document.body.append(el); el.click();
}
function pickAudioFile(done) { pickFile('.mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg', (f) => importAsset(f, 'audio', done)); }

// -----------------------------------------------------------------------------
// Save / export
// -----------------------------------------------------------------------------
function saveAndTest() {
  saveLevelData(levelData);
  state.savedJson = JSON.stringify(levelData);
  updateSaveState();
  const w = window.open('./index.html', '_blank');
  if (!w) toast('Saved. Your browser blocked the new tab: open index.html manually.', 'ok'); else toast('Saved. Opening the game in a new tab…', 'ok');
}

function serializeDefaults(data) {
  const ents = data.entities.map((e) => '    ' + JSON.stringify(e)).join(',\n');
  const rest = JSON.stringify({ ...data, entities: '__ENTITIES__' }, null, 2).replace('"__ENTITIES__"', '[\n' + ents + '\n  ]');
  return `export const DEFAULT_LEVEL_DATA = ${rest};\n`;
}

async function exportLevelData() {
  try {
    const res = await fetch('./js/levelData.js', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const src = await res.text();
    const re = /(\/\/ ---- DEFAULT_LEVEL_DATA:BEGIN[^\n]*\n)[\s\S]*?(\/\/ ---- DEFAULT_LEVEL_DATA:END ----)/;
    if (!re.test(src)) throw new Error('markers not found in js/levelData.js');
    const out = src.replace(re, (_, a, b) => a + serializeDefaults(levelData) + b);
    downloadBlob(new Blob([out], { type: 'text/javascript' }), 'levelData.js');
    toast('Exported levelData.js. Replace js/levelData.js with it to make your changes permanent.', 'ok');
  } catch (err) {
    console.error(err);
    toast(`Could not build levelData.js (${err.message}). Open Studio through the start script (http), not file://.`, 'err');
  }
}

function resetDefaults() {
  if (!confirm('Reset everything to the built-in defaults and clear the saved level in this browser?')) return;
  clearSavedLevelData();
  replaceLevelData(DEFAULT_LEVEL_DATA);
  rebuildEntities(); applyStudioWorldTransforms(levelData); refreshTerrainSculpt(); rebuildOpenTabs(); select(null, { silent: true });
  refreshAssetPanel(); refreshExplorer(); renderInspector();
  history.undo.push(history.present); history.present = JSON.stringify(levelData); history.redo.length = 0;
  updateHistoryButtons(); updateSaveState();
  toast('Defaults restored.', 'ok');
}

// -----------------------------------------------------------------------------
// Toolbox + ribbon wiring
// -----------------------------------------------------------------------------
function buildToolbox() {
  const chips = (host, list) => $(host).replaceChildren(...list.map((p) => h('button', { class: 'chip', title: `Insert ${p.name}`, onclick: () => insertPrefab(p) }, p.name)));
  chips('#prefabs-vehicles', PREFABS.vehicles);
  chips('#prefabs-pickups', PREFABS.pickups);
  chips('#prefabs-buildings', PREFABS.buildings);
  chips('#prefabs-map-pieces', PREFABS.mapPieces);
  chips('#prefabs-parts', PREFABS.parts);
  $('#model-list').replaceChildren(...MODELS.map((m) => h('button', { class: 'list-item', title: 'Open in its own tab', onclick: () => openModelTab(m.id) }, h('span', { class: 'dot' }), m.name)));
  $('#btn-import-texture').addEventListener('click', () => pickFile('image/png,image/jpeg,image/webp', (f) => importAsset(f, 'texture')));
  $('#btn-import-audio').addEventListener('click', () => pickAudioFile());
}

function wireRibbon() {
  $$('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $('#snap-select').addEventListener('change', (e) => setSnap(e.target.value));
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  $('#btn-duplicate').addEventListener('click', duplicateSelection);
  $('#btn-delete').addEventListener('click', deleteSelection);
  $('#btn-reset').addEventListener('click', resetDefaults);
  $('#btn-save-test').addEventListener('click', saveAndTest);
  $('#btn-export').addEventListener('click', exportLevelData);
  $('#explorer-search').addEventListener('input', (e) => { state.query = e.target.value; refreshExplorer(); });
  $('#sculpt-mode').addEventListener('change', () => { $('#sculpt-mode').blur(); });
  $('#sculpt-size').addEventListener('input', (e) => { $('#sculpt-size-value').textContent = `${e.target.value}m`; });
  $('#btn-focus-selection').addEventListener('click', focusSelection);
  const views = {
    city: [0, 0, -36, 240], desert: [280, 4, 35, 245], north: [-360, 24, -350, 470],
    biomes: [0, 4, 155, 260], jungle: [430, 4, 30, 230], world: [-30, 20, -190, 1180]
  };
  $$('#viewport-nav [data-view]').forEach((button) => button.addEventListener('click', () => navigateTo(...views[button.dataset.view])));
}

function wireKeyboard(canvas) {
  const typing = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  window.addEventListener('keydown', (e) => {
    if (typing(e.target)) return;
    state.keys.add(e.code);
    if (document.activeElement === canvas && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (ctrl && e.code === 'KeyY') { e.preventDefault(); redo(); return; }
    if (ctrl && e.code === 'KeyD') { e.preventDefault(); duplicateSelection(); return; }
    if (ctrl) return;
    if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
    if (e.code === 'KeyF' && !state.rmbDown) { focusSelection(); return; }
    if (state.rmbDown) return; // WASD/QE belong to fly mode while the right mouse button is held
    if (e.code === 'KeyQ') setTool('select');
    else if (e.code === 'KeyE') setTool('rotate');
    else if (e.code === 'KeyR') setTool('scale');
    else if (e.code === 'KeyT') setTool('sculpt');
  });
  window.addEventListener('keyup', (e) => state.keys.delete(e.code));
  window.addEventListener('blur', () => { state.keys.clear(); state.rmbDown = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ============================================================================
// Boot
// ============================================================================
async function main() {
  const canvas = $('#studio-canvas');
  const info = $('#viewport-info');
  info.textContent = 'Starting engine…';
  await initEngine({ canvas }); // renders into the canvas and follows its parent's size
  gameCamera.visible = false;   // hides the first-person arms parented to the game camera

  const { width, height } = getViewportSize();
  cam = new THREE.PerspectiveCamera(60, width / height, 0.3, 4000);
  onViewportResize((w, hgt) => { cam.aspect = w / hgt; cam.updateProjectionMatrix(); });

  controls = new OrbitControls(cam, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.enableRotate = false;
  controls.screenSpacePanning = true;
  controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };

  transform = new TransformControls(cam, canvas);
  transform.setSize(0.9);
  scene.add(transform.getHelper());
  transform.addEventListener('dragging-changed', (e) => {
    controls.enabled = !e.value;
    if (!e.value) { commit(); syncInspectorTransform(); }
  });

      transform.addEventListener('objectChange', () => {
    if (state.selections.length > 1 && state.activeTab === 'world') {
      const worldPos = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();
      const worldScale = new THREE.Vector3();
      for (const s of state.selections) {
        const obj = objectForSelection(s);
        if (!obj) continue;
        obj.updateMatrixWorld(true);
        obj.matrixWorld.decompose(worldPos, worldQuat, worldScale);
        if (s.kind === 'entity') {
          const ent = entityOf(s.id);
          if (!ent) continue;
          const yOff = ent.type === 'pickup' ? 0.55 : 0;
          const euler = new THREE.Euler().setFromQuaternion(worldQuat, 'YXZ');
          ent.pos = [worldPos.x, worldPos.y - yOff, worldPos.z].map((v) => Math.round(v * 1000) / 1000);
          ent.rot = [euler.x, euler.y, euler.z].map((v) => Math.round(v * 10000) / 10000);
          ent.scale = [worldScale.x, worldScale.y, worldScale.z].map((v) => Math.round(v * 1000) / 1000);
        } else if (s.kind === 'worldObject' || s.kind === 'worldPart') {
          levelData.worldTransforms = levelData.worldTransforms || {};
          levelData.worldTransforms[s.key || obj.userData.studioPath] = {
            position: worldPos.toArray(),
            rotation: new THREE.Euler().setFromQuaternion(worldQuat).toArray(),
            scale: worldScale.toArray()
          };
        }
      }
      return;
    }
    const s = state.selection;
    if (s && s.kind === 'entity' && state.activeTab === 'world') {
      const ent = entityOf(s.id);
      if (ent) { writeTransformFromObject(ent); syncInspectorTransform(); }
    } else if (s && (s.kind === 'worldObject' || s.kind === 'worldPart')) {
      saveWorldObjectTransform(s.key || s.object.userData.studioPath, s.object);
      syncInspectorTransform();
    }
  });


  boxHelper = new THREE.BoxHelper(new THREE.Object3D(), 0xfacc15);
  boxHelper.visible = false;
  boxHelper.material.depthTest = false;
  boxHelper.renderOrder = 999;
  scene.add(boxHelper);
  multiGroup = new THREE.Group();
  scene.add(multiGroup);

  raycaster = new THREE.Raycaster();
  brushPreview = new THREE.Mesh(new THREE.RingGeometry(5.84, 6, 48), new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false }));
  brushPreview.geometry.rotateX(-Math.PI / 2);
  brushPreview.userData.radius = 6;
  brushPreview.userData.studioSelectable = false;
  brushPreview.visible = false;

  // Isolation stage for model tabs: grid, pedestal and a soft fill light
  stage = new THREE.Group();
  stage.name = 'StudioStage';
  const grid = new THREE.GridHelper(40, 40, 0x4a5568, 0x2b323f);
  grid.position.y = 0.001;
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.5, 0.1, 64), new THREE.MeshStandardMaterial({ color: 0x2a303c, roughness: 0.85 }));
  pedestal.position.y = -0.05;
  pedestal.receiveShadow = true;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(3.45, 0.02, 8, 96), new THREE.MeshBasicMaterial({ color: 0x1d9bf0 }));
  rim.rotation.x = Math.PI / 2;
  const fill = new THREE.HemisphereLight(0xdbe7ff, 0x1a1f2a, 0.8);
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(6, 10, 7);
  stage.add(grid, pedestal, rim, fill, key);
  stage.visible = false;
  scene.add(stage);

  buildToolbox();
  wireRibbon();
  wireKeyboard(canvas);
  refreshAssetPanel();
  preloadRegisteredTextures(levelData);
  preloadBoundAudio(levelData);

  // World Map tab: the exact same builders as the game, entities from levelData, no gameplay registration
  info.textContent = 'Building world…';
  await new Promise((r) => setTimeout(r, 40));
  const urlTier = new URLSearchParams(location.search).get('tier');
  const tier = ['low', 'medium', 'high'].includes(urlTier) ? urlTier : 'medium'; // studio.html?tier=low for slower GPUs
  buildWorld(levelData, { register: false, afterStatic: () => applyGraphicsTier(tier) });
  worldRoot.add(brushPreview);
  revealAllLods();
  worldBackground = scene.background;
  worldFog = scene.fog;
  skyWasVisible = skyGroup.visible;

  state.tabs.push({ id: 'world', kind: 'world', title: 'World Map', pinned: true, cam: { position: new THREE.Vector3(150, 120, 170), target: new THREE.Vector3(0, 0, -36) } });
  state.worldReady = true;
  setSnap(0);
  state.savedJson = JSON.stringify(levelData);
  resetHistory();
  updateSaveState();
  setActiveTab('world');

  // pointer interaction
  let down = null;
  let downOnGizmo = false;
  let lookLast = null;
  let lookYaw = 0;
  let lookPitch = 0;
  let strokeLastPoint = null;
  const applyBrushAtEvent = (event) => {
    if (state.activeTab !== 'world' || state.tool !== 'sculpt') return;
    const hit = terrainHitAtEvent(event);
    if (!hit) { strokeLastPoint = null; return; }
    const radius = Number($('#sculpt-size').value);
    const spacing = Math.max(1, radius * 0.22);
    const start = strokeLastPoint || hit.point;
    const distance = start.distanceTo(hit.point);
    const steps = Math.max(1, Math.ceil(distance / spacing));
    for (let i = 1; i <= steps; i++) {
      const point = start.clone().lerp(hit.point, i / steps);
      sculptTerrain(levelData, point.x, point.z, radius, 0.55, $('#sculpt-mode').value, terrainBaseH);
      refreshTerrainSculpt(point.x, point.z, radius + 3);
    }
    strokeLastPoint = hit.point.clone();
  };
  canvas.addEventListener('dblclick', (e) => {
    if (state.activeTab === 'world' && state.tool !== 'sculpt') { e.preventDefault(); pick(e, { part: true }); }
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 2) state.rmbDown = true;
    if (e.button === 0 && state.tool === 'sculpt' && state.activeTab === 'world') {
      state.sculpting = true;
      strokeLastPoint = null;
      applyBrushAtEvent(e);
      e.preventDefault();
      canvas.focus();
      return;
    }
    if (e.button === 0) {
      down = { x: e.clientX, y: e.clientY };
      downOnGizmo = transform.axis !== null;
      if (!downOnGizmo && state.tool !== 'sculpt') {
        const direction = cam.getWorldDirection(new THREE.Vector3());
        lookYaw = Math.atan2(-direction.x, -direction.z);
        lookPitch = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
        lookLast = { x: e.clientX, y: e.clientY };
        state.lookDragging = true;
      }
    }
    canvas.focus();
  });
  window.addEventListener('pointermove', (e) => {
    if (state.lookDragging && (e.buttons & 1) && lookLast) {
      const dx = e.clientX - lookLast.x, dy = e.clientY - lookLast.y;
      lookLast = { x: e.clientX, y: e.clientY };
      lookYaw -= dx * 0.003;
      lookPitch = THREE.MathUtils.clamp(lookPitch - dy * 0.003, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
      cam.rotation.order = 'YXZ';
      cam.rotation.set(lookPitch, lookYaw, 0);
      const direction = cam.getWorldDirection(new THREE.Vector3());
      controls.target.copy(cam.position).addScaledVector(direction, 10);
      controls.update();
    }
    if (state.sculpting && (e.buttons & 1)) applyBrushAtEvent(e);
    else updateBrushPreview(e);
  });
  window.addEventListener('pointerup', (e) => {
    if (e.button === 2) state.rmbDown = false;
    if (e.button === 0) { state.lookDragging = false; lookLast = null; }
    if (e.button === 0 && state.sculpting) {
      state.sculpting = false;
      strokeLastPoint = null;
      commit();
      renderInspector();
      return;
    }
    if (e.button === 0 && down) {
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved < 5 && !downOnGizmo && !transform.dragging && e.target === canvas) pick(e);
      down = null;
    }
  });
  canvas.tabIndex = 0;
  window.addEventListener('beforeunload', (e) => {
    if (JSON.stringify(levelData) !== state.savedJson) { e.preventDefault(); e.returnValue = ''; }
  });

  // render loop (Studio never runs the gameplay loop)
  let last = performance.now();
  let infoTimer = 0;
  const frame = (now) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    flyUpdate(dt);
    controls.update();
    if (boxHelper.visible) boxHelper.update();
    infoTimer += dt;
    if (infoTimer > 0.25) {
      infoTimer = 0;
      const tab = activeTab();
      const s = state.selection;
      let selTxt = 'nothing selected';
      if (s && s.kind === 'entity') { const e = entityOf(s.id); if (e) selTxt = `${e.name} @ ${e.pos.map((v) => v.toFixed(1)).join(', ')}`; }
          else if (s && (s.kind === 'worldObject' || s.kind === 'worldPart')) selTxt = s.name;
      else if (s && s.kind === 'model') selTxt = MODEL_BY_ID[s.id].name;
      const toolLabel = state.tool === 'sculpt' ? `Sculpt ${$('#sculpt-mode').value} · ${$('#sculpt-size').value}m` : state.tool === 'select' ? 'Select' : state.tool === 'translate' ? 'Move' : state.tool === 'rotate' ? 'Rotate' : 'Scale';
      info.textContent = `${tab.title} · ${toolLabel}${state.snap ? ` · snap ${state.snap}m` : ''} · ${selTxt}`;
    }
    renderer.render(scene, cam);
  };
  requestAnimationFrame(frame);

  window.__studio = { cam, controls, transform, scene, state, levelData, select, setActiveTab, openModelTab, openEntityTab, insertPrefab, undo, redo, commit, closeTab, MODELS };
}

main().catch((err) => {
  console.error(err);
  const info = document.getElementById('viewport-info');
  if (info) info.textContent = `Studio failed to start: ${err.message}`;
});
