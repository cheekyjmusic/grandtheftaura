import * as THREE from 'three';
import { levelData } from './levelData.js';
import {
  initEngine, scene, camera, renderer, skyGroup, applyGraphicsTier, resizeRenderer,
  animatedWaterTex, updateSunLensFlare, updateWorldWobble,
  sunLight, hemiLight, uLight, AT
} from './engine.js';
import { preloadBoundAudio, preloadRegisteredTextures } from './assets.js';
import { sfx } from './audio.js';
import { gameState, hooks, player, sewerLights, biomeAt } from './state.js';
import { buildWorld } from './world.js';
import { initGrass, updateGrass } from './grass.js';
import { buildSewerRats } from './npcs.js';
import { syncEquippedMeshes, applyLevelParams } from './player.js';
import { initInput } from './input.js';
import { initUI, updateHUD, renderMapCanvas } from './ui.js';
import { initMultiplayer, sendMultiplayerState, updateRemotePlayers, updateRemoteWorld } from './multiplayer.js';
import { initMobileControls } from './mobile.js';
import { buildGuatemalanFestival, updateGuatemalanFestival } from './guatemala.js';
import { buildCityTraffic, updateCityTraffic } from './traffic.js';
import { initAircraft, updateAircraft } from './aircraft.js';
import { prewarmLods } from './worldStream.js';
import {
  makeSkyEnvironment, applySurfacePBRDetail, upgradeSceneFog, tuneBaseLighting
} from './worldObjects/shell.js';
// Version-matched addons via the import map pinned to three@0.170.0 in index.html.
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

let lastTime = performance.now();
let minimapTimer = 0;
let minimapCanvas = null;
let windowFocused = true;

// --- Graphics overlay state --------------------------------------------------
let composer = null;
let bloomPass = null;
let skyEnv = null;
let envTimer = 0;
let envReady = false;
const envLast = new THREE.Color();
let pbrTimer = 0;
const _sizeV = new THREE.Vector2();
const _sunDir = new THREE.Vector3();

function configureRendererAndLighting() {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (sunLight) sunLight.castShadow = true;
  // Ambient ~0.12, cool-sky / warm-bounce hemisphere, shadow acne bias fix,
  // FogExp2 (idempotent — keeps the engine's existing FogExp2 if present).
  tuneBaseLighting(scene, sunLight, hemiLight);
  upgradeSceneFog(scene);
}

/** Keep sewer + utility lights permanently visible at intensity 0 above ground
 *  so the light count never changes (no shader recompiles on sewer entry). */
function stabilizeUtilityLights() {
  for (const l of sewerLights) {
    if (l.userData.baseIntensity === undefined) l.userData.baseIntensity = l.intensity;
    l.visible = true;
    l.intensity = 0;
  }
  if (uLight) {
    if (uLight.userData.baseIntensity === undefined) uLight.userData.baseIntensity = uLight.intensity;
    uLight.visible = true;
    uLight.intensity = 0;
  }
}

function initComposer() {
  try {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // UnrealBloomPass(resolution, strength, radius, threshold)
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.55, 0.88);
    composer.addPass(bloomPass);
    // OutputPass applies the renderer's tone mapping + sRGB conversion, so the
    // composer path and the direct-render fallback look identical.
    composer.addPass(new OutputPass());
    syncComposerSize();
  } catch (e) {
    console.warn('[boot] Bloom post-processing unavailable; using direct render.', e);
    composer = null;
    bloomPass = null;
  }
}

/** Cheap per-frame guard: keeps the composer in sync with renderer size / pixel
 *  ratio even when graphics tiers change it outside the window resize event. */
function syncComposerSize() {
  if (!composer) return;
  renderer.getSize(_sizeV);
  const pr = renderer.getPixelRatio();
  if (composer._w !== _sizeV.x || composer._h !== _sizeV.y || composer._pr !== pr) {
    composer._w = _sizeV.x;
    composer._h = _sizeV.y;
    composer._pr = pr;
    composer.setPixelRatio(pr);
    composer.setSize(_sizeV.x, _sizeV.y);
  }
}

/** Throttled (2.5s) environment + fog maintenance. NEVER per-frame PMREM work.
 *  Regenerates the sky env-map only when the horizon colour shifts materially;
 *  gently matches city fog to the sky horizon (biome/sewer fog left untouched). */
function updateEnvironment(dt) {
  envTimer += dt;
  if (envTimer < 2.5) return;
  envTimer = 0;
  if (AT.on) return; // underground: sewer atmosphere owns fog & lighting
  const bg = (scene.background && scene.background.isColor) ? scene.background : AT.bg;
  if (!bg || !bg.isColor) return;
  if (skyEnv) {
    const drift = Math.abs(bg.r - envLast.r) + Math.abs(bg.g - envLast.g) + Math.abs(bg.b - envLast.b);
    if (!envReady || drift > 0.05) {
      envLast.copy(bg);
      envReady = true;
      _sunDir.subVectors(sunLight.position, sunLight.target.position);
      if (_sunDir.lengthSq() < 1e-6) _sunDir.set(78, 130, 52);
      _sunDir.normalize();
      skyEnv.refresh({
        horizon: bg,
        sunDir: _sunDir,
        sunTint: sunLight.color,
        sunStrength: sunLight.intensity || 1.45
      });
    }
  }
  if (scene.fog && biomeAt(player.x, player.z) === 'city') {
    scene.fog.color.lerp(bg, 0.25);
  }
}

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const elapsed = now * 0.001;
  hooks.syncMobileControls();
  if (animatedWaterTex) {
    animatedWaterTex.offset.x = (elapsed * 0.08) % 1;
    animatedWaterTex.offset.y = (elapsed * 0.05) % 1;
  }
  if (gameState.screen === 'start') {
    const ang = elapsed * 0.16;
    camera.position.set(Math.cos(ang) * 76, 36 + Math.sin(elapsed * 0.4) * 3, Math.sin(ang) * 76 - 24);
    camera.lookAt(0, 6, -32);
    updateEnvironment(dt);
  } else if (gameState.screen === 'playing' && windowFocused && !document.hidden) {
    updateAircraft(dt, elapsed);
    updateCityTraffic(dt);
    updateGuatemalanFestival(dt, elapsed);
    updateRemoteWorld(dt, elapsed);
    minimapTimer += dt;
    if (minimapTimer >= 0.05) {
      minimapTimer = 0;
      if (!minimapCanvas || !minimapCanvas.isConnected) {
        minimapCanvas = document.getElementById('minimap-canvas');
      }
      if (minimapCanvas) {
        renderMapCanvas(minimapCanvas, true);
      }
    }
    updateRemotePlayers(dt);
    sendMultiplayerState(performance.now());
    updateEnvironment(dt);
    // Uniform-only PBR pass for materials created by lazy streaming. No map
    // attachment here (allowMaps=false), so it can never recompile a shader.
    pbrTimer += dt;
    if (pbrTimer >= 4.0) {
      pbrTimer = 0;
      applySurfacePBRDetail(scene, { allowMaps: false });
    }
  }
  sfx.updateMusic();
  skyGroup.position.copy(camera.position);
  if (skyGroup.children[2]?.isInstancedMesh) {
    skyGroup.children[2].rotation.y += dt * 0.0025;
  } else {
    for (let i = 2; i < skyGroup.children.length; i++) {
      const cloud = skyGroup.children[i];
      cloud.position.x += dt * 0.3;
      if (cloud.position.x > 260) cloud.position.x = -260;
    }
  }
  updateGrass(elapsed);
  updateSunLensFlare();
  updateWorldWobble(elapsed, 1.0);
  syncComposerSize();
  if (composer && gameState.settings.graphics !== 'low') {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

async function updateLoadingProgress(percent, status) {
  const progress = document.getElementById('loading-progress');
  const percentLabel = document.getElementById('loading-percent');
  const statusLabel = document.getElementById('loading-status');
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  if (progress) progress.style.width = `${value}%`;
  if (percentLabel) percentLabel.textContent = `${value}%`;
  if (statusLabel) statusLabel.textContent = status;
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

async function boot() {
  const loadingStarted = performance.now();
  const loadingScreen = document.getElementById('loading-screen');
  await updateLoadingProgress(5, 'Initializing graphics');
  await initEngine();
  configureRendererAndLighting();
  await updateLoadingProgress(18, 'Loading game data');
  applyLevelParams(levelData);
  preloadRegisteredTextures(levelData);
  preloadBoundAudio(levelData);
  await updateLoadingProgress(30, 'Building Sunnyvale');
  buildWorld(levelData, {
    register: true,
    afterStatic: () => applyGraphicsTier('medium')
  });
  initGrass();
  await updateLoadingProgress(72, 'Sunnyvale built');
  buildGuatemalanFestival();
  buildCityTraffic();
  initAircraft();
  buildSewerRats();
  await updateLoadingProgress(84, 'Preparing game systems');
  syncEquippedMeshes();
  initUI();
  initMultiplayer();
  initMobileControls();
  initInput();
  updateHUD();

  // --- Graphics & lighting overlay (Part 2) --------------------------------
  // Re-assert after buildWorld's applyGraphicsTier('medium') so shadow type,
  // bias and light balance survive any tier-driven renderer reconfiguration.
  configureRendererAndLighting();
  stabilizeUtilityLights();
  await updateLoadingProgress(90, 'Baking sky reflections');
  skyEnv = makeSkyEnvironment(renderer, scene);
  scene.environmentIntensity = 0.5;
  {
    const bg0 = (AT && AT.bg && AT.bg.isColor) ? AT.bg : new THREE.Color(0xb8d4ea);
    _sunDir.subVectors(sunLight.position, sunLight.target.position);
    if (_sunDir.lengthSq() < 1e-6) _sunDir.set(78, 130, 52);
    _sunDir.normalize();
    skyEnv.refresh({
      horizon: bg0,
      sunDir: _sunDir,
      sunTint: sunLight.color,
      sunStrength: sunLight.intensity || 1.45
    });
    envLast.copy(bg0);
    envReady = true;
    if (scene.fog) scene.fog.color.lerp(bg0, 0.5);
  }
  // Boot-only PBR pass: roughness noise maps attach here, BEFORE prewarm, so
  // every resulting shader permutation is compiled under the loading screen.
  applySurfacePBRDetail(scene, { allowMaps: true });
  initComposer();

  // --- Boot pre-warm (Part 1): compile every shader + upload every texture
  // while the loading screen is still up. Visibility is restored exactly.
  await updateLoadingProgress(96, 'Pre-warming shaders');
  try {
    prewarmLods(renderer, scene, camera);
  } catch (e) {
    console.warn('[boot] Shader pre-warm skipped:', e);
  }

  window.addEventListener('blur', () => {
    windowFocused = false;
  });
  window.addEventListener('focus', () => {
    windowFocused = true;
    lastTime = performance.now();
  });
  document.addEventListener('visibilitychange', () => {
    lastTime = performance.now();
    if (document.hidden && sfx.ctx && sfx.ctx.state === 'running') sfx.ctx.suspend().catch(() => {});
    else if (!document.hidden && sfx.ctx && gameState.screen === 'playing') sfx.ctx.resume().catch(() => {});
  });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    resizeRenderer();
    syncComposerSize();
  });
  requestAnimationFrame(animate);
  const minimumLoadingTime = 500;
  const remainingLoadingTime = minimumLoadingTime - (performance.now() - loadingStarted);
  if (remainingLoadingTime > 0) {
    await new Promise((resolve) => setTimeout(resolve, remainingLoadingTime));
  }
  await updateLoadingProgress(100, 'Ready');
  loadingScreen.classList.add('is-hidden');
}

boot().catch((err) => {
  console.error(err);
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) loadingScreen.classList.add('is-hidden');
  const banner = document.getElementById('error-banner');
  if (banner) {
    banner.textContent = `Initialization error: ${err.message}. Please refresh to retry.`;
    banner.style.display = 'block';
  }
});