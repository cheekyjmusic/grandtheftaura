import { levelData } from './levelData.js';
import { initEngine, scene, camera, renderer, skyGroup, applyGraphicsTier, resizeRenderer, animatedWaterTex, updateSunLensFlare, updateWorldWobble } from './engine.js';
import { preloadBoundAudio, preloadRegisteredTextures } from './assets.js';
import { sfx } from './audio.js';
import { gameState, hooks } from './state.js';
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

let lastTime = performance.now();
let minimapTimer = 0;
let minimapCanvas = null;
let windowFocused = true;

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
  renderer.render(scene, camera);
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
  await updateLoadingProgress(96, 'Finalizing');

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