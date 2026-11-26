// =============================================================================
// worldSystems/atmosphere.js — BIOME FOG, SNOW, AMBIENT FX
//
// River flow, water tick, lampposts, edge barrier and the streamer are driven
// by worldRuntime.updateWorldFrame — NOT here. This module only owns fog/snow
// and the three streetFX animation handles.
// =============================================================================
import * as THREE from 'three';
import { biomeAt, player, pushFeed, rnd } from '../state.js';
import { camera, scene, worldRoot } from '../engine.js';
import { getWaterHeightAt } from '../water.js';
import { streetFX } from '../worldObjects/street.js';

export const bio = { base: null, snow: null, last: 'city' };
export const bioC = {};

let cfg = {
  fog: {
    alpine: [0xdbe9f4, 0.007], woods: [0x9ccaa6, 0.0048],
    cove: [0xaee2f4, 0.0024], jungle: [0x2d5a27, 0.006], defaultDensity: 0.0032
  },
  snowCount: 420,
  feeds: {}
};

export function install({ spec = {} } = {}) {
  cfg = { ...cfg, ...spec, fog: { ...cfg.fog, ...(spec.fog || {}) } };
  bio.base = null;
  bio.last = 'city';
}

function makeSnow() {
  const N = cfg.snowCount, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (rnd() - 0.5) * 44;
    pos[i * 3 + 1] = rnd() * 16;
    pos[i * 3 + 2] = (rnd() - 0.5) * 44;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  bio.snow = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xffffff, size: 0.14, transparent: true, opacity: 0.9
  }));
  bio.snow.frustumCulled = false;
  bio.snow.userData.persistentFX = true;
  worldRoot.add(bio.snow);
}

export function update(dt, elapsed) {
  const b = biomeAt(player.x, player.z);
  if (!bio.base) bio.base = scene.fog.color.clone();

  const camSurf = getWaterHeightAt(camera.position.x, camera.position.z, elapsed);
  const underwater = camSurf !== null && camera.position.y < camSurf - 0.04;
  if (!underwater) {
    const tgt = cfg.fog[b];
    const k = Math.min(1, dt * 1.5);
    const col = Array.isArray(tgt) ? (bioC[tgt[0]] || (bioC[tgt[0]] = new THREE.Color(tgt[0]))) : bio.base;
    scene.fog.color.lerp(col, k);
    const density = Array.isArray(tgt) ? tgt[1] : (cfg.fog.defaultDensity ?? 0.0032);
    scene.fog.density += (density - scene.fog.density) * k;
  }

  if (b !== bio.last) {
    bio.last = b;
    if (b !== 'city' && cfg.feeds[b]) pushFeed(cfg.feeds[b], 'border-l-sky-400');
  }

  if (!bio.snow) makeSnow();
  bio.snow.visible = (b === 'alpine');
  if (b === 'alpine') {
    const a = bio.snow.geometry.attributes.position, arr = a.array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] -= (1.4 + (i % 5) * 0.35) * dt;
      arr[i] += Math.sin(elapsed + i) * 0.3 * dt;
      if (arr[i + 1] < -2) arr[i + 1] = 14;
    }
    a.needsUpdate = true;
    bio.snow.position.set(player.x, player.y, player.z);
  }

  const f = streetFX.fire;
  if (f) {
    const s = 0.85 + Math.sin(elapsed * 17) * 0.15 + Math.random() * 0.1;
    f.fire.scale.set(s, 0.9 + Math.random() * 0.3, s);
    f.fl.intensity = 1.3 + Math.random() * 0.6;
  }
  const wf = streetFX.waterfall;
  if (wf) {
    wf.fallSheet.material.opacity = 0.62 + Math.sin(elapsed * 9) * 0.1;
    wf.mistPool.scale.setScalar(1 + Math.sin(elapsed * 2.2) * 0.06);
  }
  const wheel = streetFX.wheel;
  if (wheel) {
    wheel.angle += dt * 0.13;
    wheel.group.rotation.z = wheel.angle;
    for (const pod of wheel.pods) pod.rotation.z = -wheel.angle;
  }
}

export function reset() { bio.base = null; bio.snow = null; bio.last = 'city'; }
export default { install, update, reset, bio, bioC };