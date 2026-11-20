// =============================================================================
// main.js — GAME entry point (index.html).
// Boots the engine, loads levelData, builds the static world + data-driven entities,
// spawns NPCs, wires input/UI and runs the gameplay animation loop.
// Top of the import hierarchy: nothing imports this file.
// =============================================================================
import { levelData } from './levelData.js';
import { initEngine, scene, camera, renderer, skyGroup, applyGraphicsTier, resizeRenderer, animatedWaterTex } from './engine.js';
import { preloadBoundAudio, preloadRegisteredTextures } from './assets.js';
import { sfx } from './audio.js';
import { gameState } from './state.js';
import { buildWorld } from './world.js';
import { buildSewerRats } from './npcs.js';
import { syncEquippedMeshes, stepSimulation, enhancePerFrame, applyLevelParams } from './player.js';
import { initInput } from './input.js';
import { initUI, updateHUD, renderMapCanvas } from './ui.js';

let lastTime = performance.now();
let minimapTimer = 0;

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const elapsed = now * 0.001;

  if (animatedWaterTex) {
    animatedWaterTex.offset.x = (elapsed * 0.08) % 1;
    animatedWaterTex.offset.y = (elapsed * 0.05) % 1;
  }

  if (gameState.screen === 'start') {
    const ang = elapsed * 0.16;
    camera.position.set(Math.cos(ang) * 76, 36 + Math.sin(elapsed * 0.4) * 3, Math.sin(ang) * 76 - 24);
    camera.lookAt(0, 6, -32);
  } else if (gameState.screen === 'playing') {
    stepSimulation(dt, elapsed);
    try { enhancePerFrame(dt, elapsed); } catch (e) { console.error(e); }
    minimapTimer += dt;
    if (minimapTimer >= 0.05) {
      minimapTimer = 0;
      renderMapCanvas(document.getElementById('minimap-canvas'), true);
    }
  }

  sfx.updateMusic();
  skyGroup.position.copy(camera.position);
  renderer.render(scene, camera);
}

async function boot() {
  await initEngine(); // full-screen canvas (#game-canvas)
  applyLevelParams(levelData);
  preloadRegisteredTextures(levelData);
  preloadBoundAudio(levelData);

  // World: static city/freeway/desert/biomes -> levelData.entities -> Aura Hills overhaul
  buildWorld(levelData, {
    register: true,
    afterStatic: () => applyGraphicsTier('medium')
  });
  buildSewerRats();

  syncEquippedMeshes();
  initUI();
  initInput();
  updateHUD();

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
}

boot().catch((err) => {
  console.error(err);
  const banner = document.getElementById('error-banner');
  if (banner) {
    banner.textContent = `Initialization error: ${err.message}. Please refresh to retry.`;
    banner.style.display = 'block';
  }
});
