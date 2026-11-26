// =============================================================================
// world.js — PUBLIC ENTRY POINT (shim)
//
// The map lives in worldData.js. The engine lives in worldRuntime.js.
// This file exists so every existing `import ... from './world.js'` in the
// game keeps working unchanged.
// =============================================================================
export * from './worldRuntime.js';
export * from './worldData.js';
export { default } from './worldRuntime.js';