// =============================================================================
// worldData.js — Grand Theft Aura · THE MAP (pure layout data)
//
// Reconstructed 1:1 from the original world.js. No geometry, no imports of
// THREE — rows only. worldRuntime resolves symbolic coords/heights before
// worldKit sees them.
//
// REQUIRED RUNTIME PATCHES (audited separately — data assumes these are in):
//   1. worldRuntime: import { buildHideout as buildCriminalHideout }
//   2. worldStream.registerCell: clone handed boxes; deactivate(): snapshot
//      _pendingSolids before removeSolidBoxes (colliders survive reload).
//   3. worldObjects/index.js: re-export keepouts from ./keepouts.js (one list).
//   4. Re-register 'lodgeY' height refs every build (not once).
//   5. STEP_FIRST frostpine: insert 'wat/frostpine_creek' BEFORE 'br/frost'.
//   6. ROAD_STEP  += 'rd/mtn_': 'terrain:mountains'
//      PLACEMENT_STEP += 'mtn/': 'terrain:mountains'
//      terrain:mountains case: add placeRows(rowsForStep(PLACEMENT_STEP,...)).
//   7. worldRoads.buildRoadRibbon: path:'mountain' mode (roadC/roadH).
//
// PENDING PREFABS (rows warn+skip gracefully until street.js / worldSystems
// land): prop_sign_arch, prop_campfire, prop_tent, prop_lifeguard, prop_pier,
// prop_fountain, prop_cart, prop_cliff, prop_dumpster, prop_ferris_wheel,
// prop_jet, prop_service, prop_lamppost, prop_hydrant, prop_shelter,
// ice_zones, sewer_network.
//
// <catalog> regenerate with `npm run catalog` (kit.generateCatalog()).
// =============================================================================

export const WORLD = {
  name: 'Aura County',
  chunkSize: 128,
  spawn: [-11.5, 18.5],
  spawnKeepout: 26,
  cameraFar: 1150,
  stream: { lodOn: 54, lodOff: 66, loadPerFrame: 3, unloadPerFrame: 6, urgentRadius: 14 }
};

// Original buildWorld() order — load-bearing for hospital lot selection,
// keep-out completeness before scatters, and footprint validation.
export const BOOT = [
  'terrain',
  'roads:city+desert',
  'biome:redrock',
  'biome:frostpine+woods+cove',
  'biome:jungle',
  'district:sunnyvale',
  'entities',
  'afterStatic',
  'terrain:mountains',
  'system:sewer',
  'district:aura_hills+estates',
  'district:westside',
  'placement:hideout',
  'district:boardwalk+lax+speedway',
  'placement:armory',
  'towers',
  'groundIntegrity',
  'water:seabed',
  'recomputeBounds',
  'edgeBarrier',
  'registerStudio',
  'recomputeBounds'
];

// =============================================================================
// TERRAIN — at:[x,y,z] for plane/heightfield (centre), at:[x,z] for bed/skirt.
// =============================================================================
export const TERRAIN = [
  { id: 'gnd/city', prefab: 'terrain_plane', at: [-16, 0, -30], w: 360, d: 440,
    surface: 'grass', repeat: [52, 64], roughness: 0.94, name: 'City ground' },
  { id: 'gnd/desert', prefab: 'terrain_plane', at: [294, 0.02, -10], w: 260, d: 460,
    surface: 'sand', repeat: [38, 64], roughness: 0.95, name: 'Redrock desert ground' },

  // Frostpine alpine — 650×210, 5 m grid.
  { id: 'gnd/frostpine', prefab: 'terrain_heightfield', at: [-375, 0, 214],
    w: 650, d: 210, seg: [130, 42], mode: 'alpine', cast: true, roughness: 0.9,
    name: 'Frostpine mountains' },

  // Emerald woods — two flats split by the carved stream.
  { id: 'gnd/woods_w', prefab: 'terrain_plane', at: [-12, 0.17, 127.45], w: 80, d: 38.9,
    surface: 'grass', color: 0x4f8f46, repeat: [12, 16], roughness: 0.95 },
  { id: 'gnd/woods_e', prefab: 'terrain_plane', at: [-12, 0.17, 180.55], w: 80, d: 54.9,
    surface: 'grass', color: 0x4f8f46, repeat: [12, 16], roughness: 0.95 },
  { id: 'gnd/woods_bed', prefab: 'terrain_bed', at: [-12, 150], w: 80, d: 6.2,
    seg: [40, 6], top: 0.17, depth: 0.58, surface: 'dirt', color: 0x8a7a58,
    repeat: [10, 1], name: 'Emerald stream bed' },

  // Sunset cove.
  { id: 'gnd/cove', prefab: 'terrain_plane', at: [83, 0.17, 138], w: 110, d: 60,
    surface: 'sand', repeat: [14, 14], roughness: 0.96 },

  // Verdant jungle — raised 1.5 m shelf, river carve, retaining skirts.
  { id: 'gnd/jungle_w', prefab: 'terrain_heightfield', at: [390, 1.5, 30],
    w: 44, d: 420, seg: [22, 210], mode: 'jungle', roughness: 0.96 },
  { id: 'gnd/jungle_e', prefab: 'terrain_heightfield', at: [478.5, 1.5, 30],
    w: 109, d: 420, seg: [54, 210], mode: 'jungle', roughness: 0.96 },
  { id: 'gnd/jungle_bed', prefab: 'terrain_bed', at: [418, 30], w: 12, d: 420,
    seg: [8, 140], top: 1.5, depth: 1.48, surface: 'dirt', color: 0x6b5b3e,
    repeat: [2, 40], name: 'Jungle river bed' },
  { id: 'gnd/jungle_skirt_w1', prefab: 'terrain_skirt', at: [368, -73], w: 0.5, d: 214,
    top: 1.5, bottom: -0.6, mat: { hex: 0x4a3f2c, texType: 'redrock', repeatX: 20, repeatY: 1, roughness: 0.95 } },
  { id: 'gnd/jungle_skirt_w2', prefab: 'terrain_skirt', at: [368, 143], w: 0.5, d: 194,
    top: 1.5, bottom: -0.6, mat: { hex: 0x4a3f2c, texType: 'redrock', repeatX: 20, repeatY: 1, roughness: 0.95 } },
  { id: 'gnd/jungle_skirt_e', prefab: 'terrain_skirt', at: [533, 30], w: 0.5, d: 420,
    top: 1.5, bottom: -0.6, mat: { hex: 0x4a3f2c, texType: 'redrock', repeatX: 20, repeatY: 1, roughness: 0.95 } },
  { id: 'gnd/jungle_skirt_n', prefab: 'terrain_skirt', at: [450.5, -180], w: 165, d: 0.5,
    top: 1.5, bottom: -0.6, mat: { hex: 0x4a3f2c, texType: 'redrock', repeatX: 20, repeatY: 1, roughness: 0.95 } },
  { id: 'gnd/jungle_skirt_s', prefab: 'terrain_skirt', at: [450.5, 240], w: 165, d: 0.5,
    top: 1.5, bottom: -0.6, mat: { hex: 0x4a3f2c, texType: 'redrock', repeatX: 20, repeatY: 1, roughness: 0.95 } },
  { id: 'gnd/jungle_trail_w', prefab: 'terrain_plane', at: [390, 1.52, 40], w: 44, d: 10,
    surface: 'sand', color: 0x5c4033, repeat: [10, 2], roughness: 0.95 },
  { id: 'gnd/jungle_trail_e', prefab: 'terrain_plane', at: [449, 1.52, 40], w: 50, d: 10,
    surface: 'sand', color: 0x5c4033, repeat: [10, 2], roughness: 0.95 },

  // Northern range — collision-domain heightfield.
  { id: 'gnd/north_range', prefab: 'terrain_heightfield', at: [114, 0, -385],
    w: 620, d: 430, seg: [310, 215], mode: 'mountains', name: 'Northern mountains' },

  // Aura Hills.
  { id: 'gnd/aura_hills', prefab: 'terrain_heightfield', at: [-378, 0, 0],
    w: 364, d: 344, seg: [114, 114], mode: 'hills', name: 'Aura Hills terrain' },

  // Los Aura northland.
  { id: 'gnd/northland', prefab: 'terrain_plane', at: [120, 0.18, 655], w: 740, d: 550,
    seg: [185, 138], surface: 'grass', color: 0x5a9a4e, repeat: [72, 60], roughness: 0.94 }
];

// =============================================================================
// WATER — bounds [x0,x1,z0,z1]; river z:[z0,z1].
// =============================================================================
export const WATER = [
  { id: 'wat/frostpine_creek', prefab: 'river_system', center: 'frostCreekX',
    z: [136, 312], halfW: 3.2, lift: 0.24, wave: 0.12, current: [0, 0.7], flow: 0.55,
    shallow: 0x7dd3fc, deep: 0x0369a1, foam: 0xe0f2fe, keepoutStep: 12 },
  { id: 'wat/emerald_w', prefab: 'water_surface', bounds: [-52, -31, 147.5, 152.5],
    y: 0.19, bed: 'woods', wave: 0.12, current: [0.7, 0], seg: 3,
    shallow: 0x67e8f9, deep: 0x0e7490, foam: 0xe0f2fe },
  { id: 'wat/emerald_e', prefab: 'water_surface', bounds: [-17, 28, 147.5, 152.5],
    y: 0.19, bed: 'woods', wave: 0.12, current: [0.7, 0], seg: 3,
    shallow: 0x67e8f9, deep: 0x0e7490, foam: 0xe0f2fe },
  { id: 'wat/sunset_cove', prefab: 'water_surface', bounds: [28, 138, 168, 208],
    y: 0.20, bed: 'ocean', wave: 0.75, current: [0.15, 0], ocean: true, seg: 3,
    shallow: 0x22d3ee, deep: 0x054f7a, foam: 0xf0f9ff },
  { id: 'wat/verdant_river', prefab: 'water_surface', bounds: [412, 424, -180, 200],
    y: 1.53, bed: 'jungle', wave: 0.2, current: [0, 1.1], seg: 4,
    shallow: 0x2dd4bf, deep: 0x0f766e, foam: 0xccfbf1 },
  // Original built these inside the jungle pass; 'wat/' fallback routes them to
  // the boardwalk step — nothing in the jungle pass depends on them.
  { id: 'wat/north_ocean_w', prefab: 'water_surface', bounds: [-50, 164, 208, 320],
    y: 0.20, bed: 'ocean', wave: 1.0, current: [0.2, 0.3], ocean: true, seg: 4 },
  { id: 'wat/north_ocean_e', prefab: 'water_surface', bounds: [164, 368, 220, 320],
    y: 0.20, bed: 'ocean', wave: 1.0, current: [0.25, 0.2], ocean: true, seg: 4 },
  { id: 'wat/ocean_strait', prefab: 'water_surface', bounds: [-260, 500, 320, 380],
    y: 0.20, bed: 'ocean', wave: 0.9, current: [0.55, 0], ocean: true, seg: 4 },
  { id: 'wat/aura_river', prefab: 'river_system', center: 'riverX',
    z: [-584, -176], halfW: 5, lift: 0.24, wave: 0.14, current: [0, 0.9], flow: 0.5,
    shallow: 0x67e8f9, deep: 0x0c4a6e, foam: 0xe0f2fe, mapStep: 60, keepoutStep: 12 },
  { id: 'wat/seabed', prefab: 'ocean_seabed', at: [0, 0] }
];

// =============================================================================
// ROADS
// =============================================================================
const PI = Math.PI;
export const ROADS = [
  // --- Sunnyvale grid (non-solid: reserved footprints only, as original) ----
  { id: 'rd/sv_grid', prefab: 'road_grid', at: [0, 0], top: 0.08, thick: 0.08, solid: false,
    ns: { at: [-120, -72, -24, 24, 72, 120], w: 12, d: 252, c: -48 },
    ew: { at: [-168, -120, -72, -24, 24, 72], w: 12, d: 252, c: 0 },
    dash: { span: 122, step: 6, y: 0.05 },
    cross: { y: 0.052, off: 7.3 } },

  { id: 'rd/i88', prefab: 'freeway_i88', at: [0, 0], towerTop: 48, towerZ: [248, 332],
    gantries: [
      { z: -110, y: 'ground', text: 'AURA HILLS   EXIT 12' },
      { z: 44, y: 'ground', text: 'I-88 NORTH  •  REDROCK DESERT EXIT 40' },
      { z: 206, y: 'deck+', text: 'OCEAN BRIDGE  •  KEEP RIGHT', bg: '#0f172a', fg: '#facc15' },
      { z: 362, y: 'bridge', text: 'WELCOME TO LOS AURA  •  DOWNTOWN / LAX / SPEEDWAY', w: 17.5 },
      { z: 462, y: 'north', text: 'DOWNTOWN LOS AURA   EXIT 14' },
      { z: 556, y: 'north', text: 'LOS AURA INTL AIRPORT   EXIT 16' },
      { z: 730, y: 'north', text: 'MOTOR SPEEDWAY   EXIT 18' }
    ] },

  { id: 'rd/desert_link_s', prefab: 'road_run', at: [141, -24], w: 46, d: 12,
    top: 0.09, thick: 0.09, solid: false, map: false },
  { id: 'rd/desert_link_n', prefab: 'road_run', at: [141, 72], w: 46, d: 12,
    top: 0.09, thick: 0.09, solid: false, map: false },
  { id: 'rd/desert_hwy', prefab: 'road_run', at: [261, 40], w: 198, d: 12,
    top: 0.10, thick: 0.09, solid: false, map: ['#334155', '#facc15'],
    dash: { axis: 'x', from: 168, to: 354, step: 7, y: 0.065, len: 3.2, wide: 0.26, thick: 0.10 } },

  // --- Frostpine loop + spur + lodge drive ---------------------------------
  { id: 'rd/frost_loop', prefab: 'road_loop', at: [0, 0], samples: 420, halfW: 4.5, dy: 0.12,
    name: 'Frostpine Loop Road',
    pts: [[-92, 130], [-170, 120], [-268, 116], [-372, 122], [-470, 130],
          [-566, 132], [-664, 138], [-678, 190], [-672, 248], [-612, 286],
          [-508, 302], [-388, 308], [-262, 300], [-158, 278], [-96, 236], [-76, 184]],
    pullouts: [
      { f: 0.16, name: 'GLACIER POINT VISTA' },
      { f: 0.46, name: 'FROSTPINE VALLEY VIEW' },
      { f: 0.78, name: 'CASCADE OVERLOOK' }
    ],
    signs: [{ f: 0.3, text: '25' }, { f: 0.62, text: '25' }] },
  { id: 'rd/frost_spur', prefab: 'road_ribbon', at: [0, 0], halfW: 4.0, dy: 0.12,
    samples: 24, uvScale: 8, color: 0x2b3138, name: 'Frostpine park spur',
    pts: [[-76, 184], [-58, 190], [-40, 196], [-26, 198]] },
  { id: 'rd/lodge_drive', prefab: 'road_ribbon', at: [0, 0], halfW: 2.4, dy: 0.11,
    uvScale: 6, color: 0x3a4048, name: 'Ski lodge driveway',
    pts: ['loopNearest:-70,139', [-80, 152], [-71, 148]] },
  { id: 'rd/lodge_ramp', prefab: 'ramp_driveable', bounds: [-72, -68, 144.3, 150.3],
    axis: 'z', dir: 1, startY: 'lodgeY', endY: 'terrain' },
  // NEEDS PATCH 5: creek must build before this bridge (STEP_FIRST order).
  { id: 'br/frost', prefab: 'bridge_river', at: ['frostCreekX', 'loopCross'],
    river: 'wat/frostpine_creek', deckY: 'max(creek,loop)+0.3',
    span: 12.4, deckW: 5.2, stone: true, approachRamps: true },

  // --- Emerald woods / cove boulevards --------------------------------------
  { id: 'rd/forest', prefab: 'road_run', at: [-24, 141], w: 12, d: 134,
    top: 0.18, thick: 0.12, tag: 'biome_road', gap: [146.9, 153.1],
    map: ['#334155', '#475569'], name: 'Forest Road',
    dash: { from: 80, to: 206, step: 6, y: 0.19, len: 2.5, wide: 0.26, thick: 0.02 } },
  { id: 'br/woods', prefab: 'bridge_deck', at: [-24, 150], w: 14, d: 6, y: 0.29,
    rails: 0.9, tag: 'footbridge' },
  { id: 'rd/cove', prefab: 'road_run', at: [72, 141], w: 12, d: 134,
    top: 0.18, thick: 0.12, tag: 'biome_road', map: ['#334155', '#475569'],
    name: 'Cove Boulevard',
    dash: { from: 80, to: 206, step: 6, y: 0.19, len: 2.5, wide: 0.26, thick: 0.02 } },

  // --- Jungle entry ----------------------------------------------------------
  { id: 'rd/jungle_ramp', prefab: 'ramp_driveable', bounds: [360, 368, 34, 46],
    axis: 'x', dir: 1, startY: 0.05, endY: 1.5, visual: { w: 8.2, d: 12, at: [364, 40] } },
  { id: 'br/jungle', prefab: 'bridge_deck', at: [418, 40], w: 14, d: 11.5, y: 1.71,
    rails: 0.85, tag: 'jungle_bridge' },

  // --- Mountain highway (NEEDS PATCHES 6+7: prefix + path:'mountain') -------
  { id: 'rd/mtn_hwy', prefab: 'road_ribbon', at: [0, 0], path: 'mountain',
    from: -168, to: -584, step: 2.5, halfW: 5.2, dy: 0.05,
    color: 0x23262b, center: 0xe9c33a },
  { id: 'br/aura_1', prefab: 'bridge_river', at: ['riverX', -260], river: 'wat/aura_river',
    deckY: 'river+0.3', span: 16, deckW: 4.2 },
  { id: 'br/aura_2', prefab: 'bridge_river', at: ['riverX', -430], river: 'wat/aura_river',
    deckY: 'river+0.3', span: 16, deckW: 4.2 },

  // --- Aura Hills drive + westside shelves -----------------------------------
  { id: 'rd/hills', prefab: 'road_ribbon', at: [0, 0], path: 'hills',
    from: -196, to: -470, step: 3, halfW: 4.8, dy: 0.12, color: 0x2a2d31, center: 0xe8c547 },
  { id: 'rd/westside', prefab: 'road_ribbon', path: 'westside',
    at: [-330, -310, -290, -270, -250, -230], z: [-94, 94], gap: 28, floorOffset: 9,
    halfW: 3, color: 0x303840, center: 0xf5c84c, dash: { step: 8, y: 0.112 } },

  // --- Downtown Los Aura grid ------------------------------------------------
  { id: 'rd/la_grid', prefab: 'road_grid', at: [0, 0], top: 0.24, thick: 0.08,
    tag: 'dt_road', map: ['#334155', '#475569'],
    ns: { at: [-108, -60, -12, 36, 84, 124], w: 12, d: 204, c: 564 },
    ew: { at: [468, 516, 564, 612, 660], w: 12, d: 244, c: 8 } },
  { id: 'rd/la_link468', prefab: 'road_run', at: [135, 468], w: 22, d: 12, top: 0.24, thick: 0.08, tag: 'dt_connector', map: false },
  { id: 'rd/la_link564', prefab: 'road_run', at: [135, 564], w: 22, d: 12, top: 0.24, thick: 0.08, tag: 'dt_connector', map: false },
  { id: 'rd/la_link660', prefab: 'road_run', at: [135, 660], w: 22, d: 12, top: 0.24, thick: 0.08, tag: 'dt_connector', map: false },

  // --- West bank streets -------------------------------------------------------
  { id: 'rd/wb_main', prefab: 'road_run', at: [-145, 570], w: 12, d: 248, top: 0.24, thick: 0.08,
    tag: 'westbank_road', map: ['#334155', '#475569'] },
  { id: 'rd/wb_x480', prefab: 'road_run', at: [-126, 480], w: 26, d: 12, top: 0.24, thick: 0.08, tag: 'westbank_road', map: false },
  { id: 'rd/wb_x540', prefab: 'road_run', at: [-126, 540], w: 26, d: 12, top: 0.24, thick: 0.08, tag: 'westbank_road', map: false },
  { id: 'rd/wb_x600', prefab: 'road_run', at: [-126, 600], w: 26, d: 12, top: 0.24, thick: 0.08, tag: 'westbank_road', map: false },
  { id: 'rd/wb_x660', prefab: 'road_run', at: [-126, 660], w: 26, d: 12, top: 0.24, thick: 0.08, tag: 'westbank_road', map: false },

  // --- Boardwalk / LAX / speedway ----------------------------------------------
  { id: 'rd/boardwalk', prefab: 'road_run', at: [-39, 428], w: 362, d: 12, top: 0.24, thick: 0.08,
    tag: 'boardwalk_ave', map: ['#334155', '#facc15'] },
  { id: 'rd/lax_curb', prefab: 'road_run', at: [216, 565], w: 12, d: 178, top: 0.26, thick: 0.08,
    tag: 'lax_curb_lane', map: ['#334155', '#facc15'], zebra: [500, 565, 630],
    dash: { from: 482, to: 648, step: 8, y: 0.27 } },
  { id: 'rd/lax_access', prefab: 'road_run', at: [194, 564], w: 64, d: 14, top: 0.26, thick: 0.08,
    tag: 'lax_access', map: false },
  { id: 'rd/speed_access_e', prefab: 'road_run', at: [91, 738], w: 102, d: 16, top: 0.26, thick: 0.08, tag: 'speedway_access', map: false },
  { id: 'rd/speed_access_n', prefab: 'road_run', at: [-12, 699], w: 14, d: 66, top: 0.26, thick: 0.08, tag: 'speedway_access', map: false },

  { id: 'sp/track', prefab: 'speedway_track', at: [0, 0], centerZ: 807, radius: 69, trackW: 18,
    straightLen: 180, straightMidX: -50, turnSteps: 32,
    turns: [{ cx: 40, start: -PI / 2, end: PI / 2 }, { cx: -140, start: PI / 2, end: 3 * PI / 2 }],
    startLine: { at: [-50, 738], gantry: true } },
  { id: 'sp/pit', prefab: 'speedway_pit', at: [-50, 752], w: 120, d: 8,
    garages: { at: [-50, 761], w: 96, d: 10, bays: 7 },
    grandstand: { at: [-50, 719], w: 130, tiers: 5 } },
  { id: 'sp/ramp_up', prefab: 'ramp_driveable', bounds: [-29, -11, 807, 817],
    axis: 'x', dir: 1, startY: 0.26, endY: 3.24, visual: { w: 18, d: 10, at: [-20, 812] } },
  { id: 'sp/ramp_down', prefab: 'ramp_driveable', bounds: [-1, 17, 807, 817],
    axis: 'x', dir: 1, startY: 3.24, endY: 0.26, visual: { w: 18, d: 10, at: [8, 812] } },

  { id: 'lax/rwy_1', prefab: 'runway', at: [336, 565], w: 22, d: 240, y: 0.29 },
  { id: 'lax/rwy_2', prefab: 'runway', at: [394, 565], w: 22, d: 240, y: 0.29 }
];

// =============================================================================
// DISTRICTS — block grids + detail rules (expandDistricts).
// =============================================================================
export const DISTRICTS = [
  { id: 'sunnyvale',
    blocks: {
      xs: [-96, -48, 0, 48, 96], zs: [-144, -96, -48, 0, 48],
      layers: [
        { w: 36.3, h: 0.16, d: 36.3, y: 0.16, surface: 'concrete', color: 0x94a3b8, repeat: [16, 1] },
        { w: 36, h: 0.18, d: 36, y: 0.18, surface: 'concrete', color: 0xcbd5e1, repeat: [12, 12] },
        { w: 30.4, h: 0.20, d: 30.4, y: 0.20, rule: 'bz<=-72 ? plaza : lawn', repeat: [14, 14] }
      ]
    },
    detail: { lamps: { dx: 1.2, dz: 16.8 } } },   // 50 lampposts, bx±16.8 / bz±16.8

  { id: 'losaura_downtown',
    blocks: {
      xs: [-84, -36, 12, 60, 104], zs: [492, 540, 588, 636],
      widthRule: 'bx===104 ? 28 : 36',
      layers: [
        { w: 'bw', h: 0.12, d: 36, y: 0.30, surface: 'concrete', color: 0xcbd5e1, repeat: [12, 12] },
        { w: 'bw-4', h: 0.14, d: 32, y: 0.32, surface: 'concrete', color: 0x94a3b8, repeat: [14, 14] }
      ]
    },
    detail: { lamps: { dx: 1.2, dz: 16.8 } } },

  { id: 'boardwalk',
    detail: { trees: { rule: 'along', from: -205, to: 125, step: 30, z: 421.5, s: 1.05, skip: [-54, -30] } } }
];

// =============================================================================
// SCATTERS — deterministic per-id RNG; keep-outs published by roads/rivers.
// =============================================================================
export const SCATTERS = [
  { id: 'sc/frost_pines', prefab: 'prop_pine', bounds: [-700, 108, -50, 320],
    count: 340, tries: 1400, s: [0.7, 1.3], snow: 'random', keepout: 1.2,
    filter: { groveMin: 0.34, groveFreq: 0.035, avoid: 'keepouts' } },
  { id: 'sc/frost_rocks', prefab: 'prop_boulder', bounds: [-640, 116, -120, 312],
    count: 45, tries: 45, s: [2.5, 6.5], yScale: [0.5, 1.0], mat: 'snowrock', keepout: 'r',
    filter: { avoid: 'keepouts' } },
  { id: 'sc/frost_lakes', prefab: 'prop_ice_lake', bounds: [-650, 150, -530, 230],
    count: 12, tries: 12, s: [7, 12], aspect: 0.6, keepout: 'r',
    filter: { avoid: 'keepouts' } },

  { id: 'sc/woods_trees', prefab: 'prop_tree', bounds: [-50, 114, 26, 202],
    count: 34, tries: 130, s: [0.8, 1.35], y: 0.17, keepout: 1.5,
    variant: ['oak', 'oak', 'birch', 'pine', 'pine'],
    filter: { avoid: [{ x: -24, r: 8 }, { z: 150, r: 5 }] } },
  { id: 'sc/woods_mushrooms', prefab: 'prop_mushroom', bounds: [-50, 114, 26, 202],
    count: 10, tries: 10, y: 0.17,
    filter: { avoid: [{ x: -24, r: 8 }, { z: 150, r: 4 }] } },

  { id: 'sc/cove_palms', prefab: 'prop_palm', bounds: [32, 114, 132, 164],
    count: 10, tries: 80, s: [0.9, 1.3], y: 0.17, keepout: 2,
    filter: { avoid: [{ x: 72, r: 8 }] } },

  { id: 'sc/jungle_kapok', prefab: 'prop_kapok', bounds: [374, -174, 527, 234],
    count: 80, tries: 400, s: [0.9, 1.6], y: 1.5, pad: 3,
    filter: { avoid: 'jungleClear' } },
  { id: 'sc/jungle_ferns', prefab: 'prop_fern', bounds: [374, -174, 527, 234],
    count: 120, tries: 120, y: 1.5, pad: 1,
    every: { 3: 'prop_bloom', 4: 'prop_boulder' },
    filter: { avoid: 'jungleClear' } },

  { id: 'sc/mtn_pines', prefab: 'prop_pine', tall: true, bounds: [-188, -590, 416, -175],
    count: 4000, tries: 46000, s: [0.8, 2.1], yScale: [0.9, 1.5],
    filter: { hMin: 4, hMax: 112, slopeMax: 0.58, groveMin: 0.36,
      avoid: [{ path: 'roadC', r: 11 }, { path: 'riverX', r: 8 }] } },
  { id: 'sc/mtn_snow', prefab: 'prop_pine', tall: true, snow: true, bounds: [-188, -590, 416, -175],
    count: 700, tries: 46000, s: [0.7, 1.6], yScale: [0.9, 1.3],
    filter: { hMin: 108, hMax: 168, slopeMax: 0.52, groveMin: 0.40,
      avoid: [{ path: 'roadC', r: 11 }, { path: 'riverX', r: 8 }] } },
  { id: 'sc/mtn_rocks', prefab: 'prop_boulder', bounds: [-188, -590, 416, -175],
    count: 420, tries: 46000, s: [0.6, 2.8], yScale: [0.7, 0.7],
    filter: { slopeMin: 0.3, avoid: [{ path: 'roadC', r: 11 }, { path: 'riverX', r: 8 }] } },

  { id: 'sc/hills_trees', prefab: 'prop_tree', bounds: [-554, -165, -216, 165],
    count: 500, tries: 5000, s: [0.8, 1.7], y: 'hillsH',
    filter: { hMin: 3, slopeMax: 0.7,
      avoid: [{ path: 'ahRz', r: 12, maxDist: 300 }, { at: 'AHC', r: 72 },
              { bounds: [-360, -125, -205, 125] }] } }
];

// =============================================================================
// PLACEMENTS — array order inside each BOOT step is load-bearing.
// =============================================================================
const walk = (id, at, w, d, wall, roof, name, extra = {}) =>
  ({ id, prefab: 'house_walkin', at, w, d, wall, roof, name, ...extra });
const sub = (id, at, wall, roof, ry = 0) =>
  ({ id, prefab: 'house_suburban', at, wall, roof, ry });
const umb = (id, at, color, towel) => ({ id, prefab: 'prop_umbrella', at, color, towel });

// Tower helper: exact original heights. h = lobbyH + (floors-1)·floorH.
const tw = (id, at, w, d, h, style, glass, frame, name, o = {}) => {
  const lobbyH = 4.6;
  const floors = Math.max(2, Math.round((h - lobbyH) / 3.55) + 1);
  const crown = o.crown || (o.heli ? 'helipad' : 'block');
  const program = o.program || (
    style === 'slab' ? [['residential', floors - 1]]
    : style === 'brutalist' ? [['office', floors - 2], ['mech', 1]]
    : style === 'deco' ? [['office', floors - 2], ['penthouse', 1]]
    : [['office', floors - 1]]);
  return { id, prefab: 'tower', at, w, d, floors, floorH: (h - lobbyH) / (floors - 1),
    lobbyH, style, glass, frame, name, crown, pad: !!o.pad, program };
};

export const PLACEMENTS = [
  // ---- biome:redrock -------------------------------------------------------
  { id: 'rr/mesa_1', prefab: 'mesa', at: [215, -45], w: 26, d: 22, h: 7.5 },
  { id: 'rr/mesa_2', prefab: 'mesa', at: [295, -85], w: 34, d: 28, h: 11.0 },
  { id: 'rr/mesa_3', prefab: 'mesa', at: [225, 125], w: 28, d: 24, h: 8.5 },
  { id: 'rr/mesa_4', prefab: 'mesa', at: [285, 178], w: 32, d: 26, h: 10.0 },
  ...[[184, -18], [196, 18], [210, 62], [238, 16], [268, -28],
      [282, 64], [308, 12], [332, 68], [192, 92], [255, 148]]
    .map(([x, z], i) => ({ id: `rr/cactus_${i + 1}`, prefab: 'prop_cactus',
      at: [x, z], y: 0.02, h: 2.6 + (i % 3) * 0.55 })),
  ...[[188, 56], [244, -14], [274, 24], [322, -24], [265, 95]]
    .map(([x, z], i) => ({ id: `rr/boulder_${i + 1}`, prefab: 'prop_boulder',
      at: [x, z], y: 0.4, r: 1.45, mat: 'redrock' })),
  walk('rr/outpost', [254, 84], 10.4, 8.6, 0xfde68a, 0x9a3412, 'REDROCK DESERT OUTPOST'),

  // ---- biome:frostpine+woods+cove -------------------------------------------
  // fp/lodge, rd/lodge_*, br/frost are STEP_FIRST — order handled by runtime.
  walk('fp/lodge', [-70, 139], 11, 9, 0x92400e, 0xf8fafc, 'FROSTPINE SKI LODGE',
    { baseY: 'maxTerrain+0.12', foundation: { w: 12.6, d: 10.6, h: 2.4 } }),
  { id: 'fp/arch', prefab: 'prop_sign_arch', at: [-24, 203], w: 13.6,
    texts: [
      { text: 'FROSTPINE NATIONAL PARK', y: 4.3, bg: '#1c1917', fg: '#fcd34d', w: 10.5, h: 1.2 },
      { text: 'LOOP ROAD  •  VISTAS  •  SKI LODGE', y: 3.2, bg: '#14532d', fg: '#bbf7d0', w: 8.5, h: 0.7 }
    ] },
  { id: 'fp/ice_grid', prefab: 'ice_zones', at: [0, 0],
    grid: { xs: [-660, -90], zs: [128, 308], stepX: 95, stepZ: 60, r: 26 } },
  { id: 'fp/creek_rock_1', prefab: 'prop_boulder', at: ['frostCreekX-1.4', 176], y: 'terrain', r: 0.85 },
  { id: 'fp/creek_rock_2', prefab: 'prop_boulder', at: ['frostCreekX+1.4', 214], y: 'terrain', r: 1.15 },
  { id: 'fp/creek_rock_3', prefab: 'prop_boulder', at: ['frostCreekX-1.4', 252], y: 'terrain', r: 0.85 },
  { id: 'fp/creek_rock_4', prefab: 'prop_boulder', at: ['frostCreekX+1.4', 288], y: 'terrain', r: 1.15 },
  { id: 'fp/creek_log', prefab: 'prop_log', at: ['frostCreekX+0.6', 240] },
  { id: 'fp/creek_falls', prefab: 'prop_boulder', at: ['frostCreekX', 313.5], y: 'terrain',
    cluster: 3, spacing: 1.6, r: 1.1, foam: true, foamY: 0.3 },

  walk('ew/ranger', [4, 128], 10.4, 8.6, 0x854d0e, 0x166534, 'EMERALD RANGER STATION'),
  { id: 'ew/log_1', prefab: 'prop_boulder', at: [-40, 128], y: 0.17, kind: 'log', ry: 0.3 },
  { id: 'ew/log_2', prefab: 'prop_boulder', at: [-8, 190], y: 0.17, kind: 'log', ry: 1.2 },
  { id: 'ew/log_3', prefab: 'prop_boulder', at: [14, 138], y: 0.17, kind: 'log', ry: 0.8 },
  { id: 'ew/stream_pebbles', prefab: 'prop_boulder', at: [0, 0],
    scatterAlong: { from: [-48, 149], to: [32, 151], count: 6, r: [0.22, 0.37] } },
  { id: 'ew/campfire', prefab: 'prop_campfire', at: [8, 176] },
  { id: 'ew/tent_1', prefab: 'prop_tent', at: [5, 179], color: 0x2563eb, ry: 0.4 + PI / 4 },
  { id: 'ew/tent_2', prefab: 'prop_tent', at: [11, 180], color: 0xdc2626, ry: -0.5 + PI / 4 },

  walk('sc/surf_shack', [118, 138], 10.4, 8.6, 0x67e8f9, 0xea580c, 'SUNSET COVE SURF SHACK'),
  { id: 'sc/pier', prefab: 'prop_pier', at: [100, 172], w: 4, d: 40, y: 0.55,
    piles: { from: 154, to: 190, step: 6, dx: 1.7 } },
  { id: 'sc/pier_bench', prefab: 'prop_bench', at: [100, 186], w: 1.4, d: 0.5, y: 0.9 },
  { id: 'sc/lifeguard', prefab: 'prop_lifeguard', at: [50, 150] },
  umb('sc/umbrella_1', [52, 160], 0xef4444, 0xbfdbfe),
  umb('sc/umbrella_2', [60, 158], 0x3b82f6, 0xfef3c7),
  umb('sc/umbrella_3', [88, 162], 0xfacc15, 0xbfdbfe),
  umb('sc/umbrella_4', [96, 150], 0x22c55e, 0xfef3c7),
  umb('sc/umbrella_5', [112, 158], 0xec4899, 0xbfdbfe),
  { id: 'sc/sailboat_1', prefab: 'prop_sailboat', at: [60, 190], ry: 0.3 },
  { id: 'sc/sailboat_2', prefab: 'prop_sailboat', at: [126, 180], ry: -0.4 },
  { id: 'sc/rowboat', prefab: 'prop_rowboat', at: [107, 184], hull: 0xb45309 },
  { id: 'sc/buoy_1', prefab: 'prop_buoy', at: [36, 198], color: 0xdc2626 },
  { id: 'sc/buoy_2', prefab: 'prop_buoy', at: [124, 198], color: 0x22c55e },
  { id: 'sc/foam_cove', prefab: 'slab', at: [83, 167.3], w: 110, d: 1.4, y: 0.21, h: 0.02,
    mat: { hex: 0xffffff, transparent: true, opacity: 0.55, emissive: 0xffffff, emissiveIntensity: 0.4 },
    solid: false, reserve: false },

  // ---- biome:jungle -----------------------------------------------------------
  { id: 'jg/temple', prefab: 'temple', at: [456, -70], platW: 60, platD: 60, platH: 3,
    baseY: 1.5, ramp: { run: 12, w: 12 }, relic: true },
  walk('jg/research', [454, 96], 10.6, 8.8, 0x4d7c0f, 0x78350f, 'JUNGLE RESEARCH STATION', { baseY: 1.5 }),
  { id: 'jg/cliff', prefab: 'prop_cliff', at: [418, -137], baseY: 1.5,
    w: 22, h: 14, d: 7, waterfall: true },
  { id: 'jg/river_rock_1', prefab: 'prop_boulder', at: [419.6, -60], y: 1.0, r: 0.9, mat: 'riverrock' },
  { id: 'jg/river_rock_2', prefab: 'prop_boulder', at: [416.2, 10], y: 1.0, r: 0.9, mat: 'riverrock' },
  { id: 'jg/river_rock_3', prefab: 'prop_boulder', at: [419.2, 80], y: 1.0, r: 0.9, mat: 'riverrock' },
  { id: 'jg/river_rock_4', prefab: 'prop_boulder', at: [416.5, 150], y: 1.0, r: 0.9, mat: 'riverrock' },
  { id: 'jg/log', prefab: 'prop_log', at: [419.5, 120] },

  // ---- district:sunnyvale (order matches original buildCityLandmarks) ---------
  { id: 'sv/plaza_ns', prefab: 'slab', at: [0, 0], w: 4.6, d: 36, y: 0.235, h: 0.05,
    mat: { hex: 0xa8a29e, texType: 'cobblestone', repeatX: 3, repeatY: 18, roughness: 0.78, bumpScale: 0.025 },
    solid: false, reserve: false },
  { id: 'sv/plaza_ew', prefab: 'slab', at: [0, 0], w: 36, d: 4.6, y: 0.235, h: 0.05,
    mat: { hex: 0xa8a29e, texType: 'cobblestone', repeatX: 3, repeatY: 18, roughness: 0.78, bumpScale: 0.025 },
    solid: false, reserve: false },
  { id: 'sv/fountain', prefab: 'prop_fountain', at: [0, 0], court: true },
  { id: 'sv/bench_1', prefab: 'prop_bench', at: [0, 5.8], ry: PI },
  { id: 'sv/bench_2', prefab: 'prop_bench', at: [0, -5.8], ry: 0 },
  { id: 'sv/bench_3', prefab: 'prop_bench', at: [5.8, 0], ry: -PI / 2 },
  { id: 'sv/bench_4', prefab: 'prop_bench', at: [-5.8, 0], ry: PI / 2 },
  { id: 'sv/tree_1', prefab: 'prop_tree', at: [-10.5, -10.5], s: 1.1 },
  { id: 'sv/tree_2', prefab: 'prop_tree', at: [10.5, -10.5], s: 1.1 },
  { id: 'sv/tree_3', prefab: 'prop_tree', at: [-10.5, 10.5], s: 1.1 },
  { id: 'sv/tree_4', prefab: 'prop_tree', at: [10.5, 10.5], s: 1.1 },
  { id: 'sv/cart', prefab: 'prop_cart', at: [11.8, 12.2] },
  { id: 'sv/hotdog', prefab: 'shop_hotdog', at: [-39.5, -39.5] },
  { id: 'sv/dealer', prefab: 'shop_dealer', at: [0, -48] },
  { id: 'sv/dealer_plaza', prefab: 'slab', at: [-48, -48], w: 30.6, d: 30.6, y: 0.21, h: 0.21,
    mat: { hex: 0x94a3b8, texType: 'cobblestone', repeatX: 12, repeatY: 12, bumpScale: 0.02 },
    solid: false, reserve: false },
  { id: 'sv/diner', prefab: 'shop_diner', at: [-54.5, -53.5], w: 9.6, d: 9.2, h: 4.4,
    wall: 0xfde68a, name: 'SUNNYVALE DINER', sign: { bg: '#7f1d1d', fg: '#fef08a' } },
  { id: 'sv/bank', prefab: 'shop_bank', at: [0, -96] },
  { id: 'sv/apt_plaza', prefab: 'slab', at: [48, -48], w: 30.6, d: 30.6, y: 0.21, h: 0.21,
    mat: { hex: 0x94a3b8, texType: 'concrete', repeatX: 10, repeatY: 10 }, solid: false, reserve: false },
  { id: 'sv/apartment', prefab: 'apartment_block', at: [43, -48], w: 11, d: 16, h: 8.4, wall: 0xb45309,
    fireEscape: { x: 49.6, steps: [
      { y: 1.85, z: -54.0 }, { y: 3.70, z: -50.2 }, { y: 5.55, z: -46.4 }, { y: 7.40, z: -42.6 }] } },
  { id: 'sv/containers', prefab: 'container_stack', at: [0, 0],
    rows: [
      [3.2, 2.3, 6.8, 44, 1.33, 45, 0xdc2626],
      [3.2, 2.3, 6.8, 47.4, 1.33, 47, 0x2563eb],
      [3.2, 2.2, 6.4, 47.4, 3.58, 47, 0xd97706],
      [3.2, 2.3, 6.4, 37.5, 1.33, 45, 0x0d9488]],
    catwalk: { w: 5.2, d: 1.8, at: [40.8, 45], y: 2.48 } },
  walk('sv/house_oakwood', [-7.5, 42.0], 9.8, 8.6, 0xfef3c7, 0xb91c1c, 'OAKWOOD RESIDENCE'),
  walk('sv/house_cedar', [-41.5, -5.5], 9.8, 8.6, 0xdbeafe, 0x1e40af, 'CEDAR COTTAGE'),
  walk('sv/house_sage', [42.5, -5.5], 9.8, 8.6, 0xdcfce7, 0x166534, 'SAGE VILLA'),
  sub('sv/house_01', [7.5, 53.0], 0xfed7aa, 0x9a3412, PI),
  sub('sv/house_02', [-54.0, 8.0], 0xfce7f3, 0x831843, PI / 2),
  sub('sv/house_03', [54.0, 8.0], 0xfef08a, 0x854d0e, -PI / 2),
  sub('sv/house_04', [-54.5, 42.5], 0xe0e7ff, 0x3730a3, 0),
  sub('sv/house_05', [-41.5, 54.5], 0xffedd5, 0xc2410c, PI),
  sub('sv/house_06', [55.5, 54.5], 0xd1fae5, 0x065f46, PI),
  sub('sv/house_07', [-96.0, -48.0], 0xfde68a, 0x92400e, 0),
  sub('sv/house_08', [-96.0, 0.0], 0xdbeafe, 0x1e3a8a, PI / 2),
  sub('sv/house_09', [-96.0, 48.0], 0xfce7f3, 0x9d174d, PI),
  sub('sv/house_10', [96.0, -48.0], 0xdcfce7, 0x14532d, 0),
  sub('sv/house_11', [96.0, 0.0], 0xffedd5, 0x9a3412, -PI / 2),
  sub('sv/house_12', [96.0, 48.0], 0xe0e7ff, 0x312e81, PI),
  { id: 'sv/fence', prefab: 'prop_fence', at: [7.5, 43.5], y: 0.18, w: 8.5, h: 1.15 },
  { id: 'sv/shelter_1', prefab: 'prop_shelter', at: [-16.2, -6.5], ry: PI / 2 },
  { id: 'sv/shelter_2', prefab: 'prop_shelter', at: [16.2, 6.5], ry: -PI / 2 },
  { id: 'sv/mailbox_1', prefab: 'prop_mailbox', at: [-16.5, 16.2], bin: true },
  { id: 'sv/mailbox_2', prefab: 'prop_mailbox', at: [16.5, -16.2], bin: true },
  { id: 'sv/mailbox_3', prefab: 'prop_mailbox', at: [-31.5, 16.5], bin: true },
  { id: 'sv/mailbox_4', prefab: 'prop_mailbox', at: [-16.5, -64.5], bin: true },
  ...[[-16.8, 13.0], [16.8, 32.0], [-32.0, -16.8], [32.0, -32.0], [-16.8, -80.0]]
    .map(([x, z], i) => ({ id: `sv/hydrant_${i + 1}`, prefab: 'prop_hydrant', at: [x, z] })),
  ...[[-13.5, 55.5], [13.5, 38.5], [-58.5, -11.5], [-36.5, 11.5],
      [58.5, -11.5], [36.5, 11.5], [-36.5, 38.5], [58.5, 38.5],
      [-82.0, -82.0], [82.0, -82.0], [-82.0, -130.0], [82.0, -130.0]]
    .map(([x, z], i) => ({ id: `sv/sttree_${i + 1}`, prefab: 'prop_tree', at: [x, z], s: 0.95 })),

  // ---- terrain:mountains (NEEDS PATCH 6: 'mtn/' prefix + placements pass) -----
  { id: 'mtn/rock_1', prefab: 'prop_boulder', at: ['riverX-2', -220], y: 'terrain', r: 1.0 },
  { id: 'mtn/rock_2', prefab: 'prop_boulder', at: ['riverX+2', -300], y: 'terrain', r: 1.25 },
  { id: 'mtn/rock_3', prefab: 'prop_boulder', at: ['riverX-2', -380], y: 'terrain', r: 1.5 },
  { id: 'mtn/rock_4', prefab: 'prop_boulder', at: ['riverX+2', -460], y: 'terrain', r: 1.0 },
  { id: 'mtn/rock_5', prefab: 'prop_boulder', at: ['riverX-2', -520], y: 'terrain', r: 1.25 },
  { id: 'mtn/log_1', prefab: 'prop_log', at: ['riverX+1', -340] },
  { id: 'mtn/log_2', prefab: 'prop_log', at: ['riverX-1', -480] },

  // ---- district:aura_hills+estates --------------------------------------------
  { id: 'ah/wall_1', prefab: 'estate_wall', at: [-480, -85], w: 96, d: 0.8, y: 39.7, h: 3.4 },
  { id: 'ah/wall_2', prefab: 'estate_wall', at: [-480, -5], w: 96, d: 0.8, y: 39.7, h: 3.4 },
  { id: 'ah/wall_3', prefab: 'estate_wall', at: [-528, -45], w: 0.8, d: 80, y: 39.7, h: 3.4 },
  { id: 'ah/wall_4', prefab: 'estate_wall', at: [-432, -67], w: 0.8, d: 36, y: 39.7, h: 3.4 },
  { id: 'ah/wall_5', prefab: 'estate_wall', at: [-432, -23], w: 0.8, d: 36, y: 39.7, h: 3.4 },
  { id: 'ah/gate', prefab: 'estate_gate', at: [-431.4, -45], y: 39.5, travel: 4 },
  { id: 'ah/house_1', prefab: 'estate_house', at: [-508, -68], dir: 1, stone: false, baseY: 38.18 },
  { id: 'ah/house_2', prefab: 'estate_house', at: [-508, -22], dir: -1, stone: true, baseY: 38.18 },
  { id: 'ah/house_3', prefab: 'estate_house', at: [-470, -70], dir: 1, stone: false, baseY: 38.18 },
  { id: 'ah/house_4', prefab: 'estate_house', at: [-470, -20], dir: -1, stone: true, baseY: 38.18 },
  { id: 'ah/house_5', prefab: 'estate_house', at: [-448, -70], dir: 1, stone: false, baseY: 38.18 },
  { id: 'ah/house_6', prefab: 'estate_house', at: [-448, -20], dir: -1, stone: true, baseY: 38.18 },
  // Auto-sited: first clear lot in the scan window (order-sensitive — keep here).
  { id: 'ah/hospital', prefab: 'hospital', w: 36, d: 26, h: 7,
    scan: { xs: [-170, 110], zs: [-140, 160], step: 10, pad: 4 } },

  // ---- district:westside ---------------------------------------------------------
  ...[0, 1, 2, 3, 4].flatMap((i) => [-1, 1].map((side) => ({
    id: `ws/tower_${i}_${side > 0 ? 'n' : 's'}`, prefab: 'westside_tower',
    at: [-320 + i * 20, side > 0 ? 'ahRz+43' : 'ahRz-43'],
    w: 13 + (i % 3), d: 15 + (i % 2) * 2, h: 28 + (i * 11 + side * 7 + 70) % 31,
    tint: (i + (side > 0 ? 1 : 0)) % 3 }))),
  ...[0, 1, 2, 3].flatMap((i) => [-1, 1].map((side) => ({
    id: `ws/low_${i}_${side > 0 ? 'n' : 's'}`, prefab: 'westside_low',
    at: [-320 + i * 20, side > 0 ? 'ahRz+66' : 'ahRz-66'],
    w: 9 + (i % 2), d: 10 + (i % 3), h: 13 + (i * 7 + side * 3 + 30) % 15,
    tint: (i + (side > 0 ? 1 : 0)) % 3 }))),

  // ---- placement:hideout -----------------------------------------------------------
  { id: 'rr/hideout', prefab: 'hideout', at: [332, 130], half: 30, peak: 32, baseY: 0.02 },
  // NOTE: tank hull is unported — systems/hideout must build it (original hid
  // chassis/wheels and attached armor+turret). Adapter only sets isTank.
  { id: 'rr/tank', prefab: 'vehicle', at: [333, 130], y: 0.14, ry: -PI / 2,
    name: 'REDROCK SCORPION TANK', body: 0x4b5541, accent: 0x252a22, coupe: false, tank: true },

  // ---- district:boardwalk+lax+speedway ------------------------------------------------
  { id: 'bw/foam_strait', prefab: 'slab', at: [120, 380.3], w: 740, d: 2.2, y: 0.215, h: 0.02,
    mat: { hex: 0xffffff, transparent: true, opacity: 0.58, emissive: 0xffffff, emissiveIntensity: 0.4 },
    solid: false, reserve: false },
  { id: 'bw/buoy_1', prefab: 'prop_buoy', at: ['I88.x-30', 300], color: 0xdc2626 },
  { id: 'bw/buoy_2', prefab: 'prop_buoy', at: ['I88.x+30', 300], color: 0x22c55e },
  { id: 'bw/buoy_3', prefab: 'prop_buoy', at: ['I88.x-30', 352], color: 0xdc2626 },
  { id: 'bw/buoy_4', prefab: 'prop_buoy', at: ['I88.x+30', 352], color: 0x22c55e },
  { id: 'bw/rowboat_1', prefab: 'prop_rowboat', at: [-58, 348], hull: 0x926c44 },
  { id: 'bw/rowboat_2', prefab: 'prop_rowboat', at: [-30, 372], hull: 0x0ea5e9 },
  { id: 'bw/beach', prefab: 'slab', at: [-47, 394], w: 366, d: 28, y: 0.24, h: 0.08,
    surface: 'sand', repeat: [48, 12], roughness: 0.96, solid: true, tag: 'beach_sand', reserve: false },
  { id: 'bw/deck', prefab: 'slab', at: [-43, 413], w: 354, d: 14, y: 0.40, h: 0.22,
    mat: { hex: 0x926c44, texType: 'wood', repeatX: 40, repeatY: 4, roughness: 0.82 },
    solid: true, tag: 'boardwalk_deck', reserve: false },
  { id: 'bw/pier', prefab: 'prop_pier', at: [-42, 365], w: 12, d: 82, y: 0.55,
    piles: { from: 328, to: 402, step: 10, dx: 5.2 },
    sign: { z: 405.5, text: 'SANTA AURA PIER & BOARDWALK', bg: '#1e1b4b', fg: '#38bdf8', w: 11.2, h: 1.35 } },
  { id: 'bw/ferris', prefab: 'prop_ferris_wheel', at: [-42, 352], y: 14.5, r: 11.5, pods: 12 },
  { id: 'bw/hotdog', prefab: 'shop_hotdog', at: [-18, 439] },
  walk('bw/arcade', [-72, 439], 11.5, 9.0, 0x38bdf8, 0xf43f5e, 'SANTA AURA ARCADE'),
  walk('bw/surfshop', [38, 439], 11.5, 9.0, 0xfef08a, 0x0284c7, 'PACIFIC SURF & GEAR'),
  umb('bw/umbrella_1', [-165, 392], 0xef4444),
  umb('bw/umbrella_2', [-125, 390], 0x3b82f6),
  umb('bw/umbrella_3', [-85, 393], 0xfacc15),
  umb('bw/umbrella_4', [15, 391], 0x22c55e),
  umb('bw/umbrella_5', [65, 392], 0xec4899),
  umb('bw/umbrella_6', [105, 390], 0xf97316),

  { id: 'la/concert', prefab: 'concert_hall', at: [-84, 588], baseY: 0.30, sign: 'WALT AURA CONCERT HALL',
    shells: [
      { w: 14, h: 15, d: 0.55, at: [-3.5, 10.5, 4.5], rot: [0.32, 0.25, -0.28] },
      { w: 15, h: 17, d: 0.55, at: [3.8, 11.5, 2.0], rot: [-0.25, -0.35, 0.30] },
      { w: 13, h: 14, d: 0.55, at: [0.0, 10.0, -4.8], rot: [-0.35, 0.15, -0.20] },
      { w: 11, h: 12, d: 0.55, at: [-6.5, 8.8, -2.5], rot: [0.20, 0.45, 0.34] }] },
  { id: 'la/arena', prefab: 'arena', at: [60, 492], r: 14.5, h: 14.0, baseY: 0.30,
    sign: 'AURA ARENA • LOS AURA LIVE', led: 0xa855f7 },
  { id: 'la/bank', prefab: 'shop_bank', at: [12, 492] },
  { id: 'la/dealer', prefab: 'shop_dealer', at: [-36, 492] },
  { id: 'la/hotdog', prefab: 'shop_hotdog', at: [12, 588] },

  { id: 'lax/tarmac', prefab: 'slab', at: [324, 565], w: 288, d: 260, y: 0.25, h: 0.08,
    surface: 'concrete', color: 0x64748b, repeat: [24, 24], roughness: 0.88,
    solid: true, tag: 'lax_tarmac', reserve: false },
  { id: 'lax/gateway_sign', prefab: 'prop_sign', at: [186, 555.5], y: 6.2,
    text: 'LAX • LOS AURA INTL AIRPORT', bg: '#0f172a', fg: '#38bdf8', w: 13.0, h: 1.5 },
  { id: 'lax/theme', prefab: 'theme_building', at: [196, 424], baseY: 0.24 },
  { id: 'lax/terminal', prefab: 'terminal_lax', at: [248, 565],
    halfW: 22, halfL: 103, baseY: 0.30, wallH: 14.0, rise: 6.4, mezz: 7.60, cullR: 135,
    doors: [500, 565, 630], gates: [{ z: 502, n: 1 }, { z: 622, n: 2 }],
    checkin: [492, 524, 606, 638], security: [551, 565, 579],
    flights: {
      dests: ['SUNNYVALE', 'AURA HILLS', 'REDROCK', 'FROSTPINE', 'VERDANT', 'SANTA AURA', 'WESTSIDE', 'HARBOR CITY'],
      statuses: ['ON TIME', 'BOARDING', 'DELAYED', 'GATE OPEN', 'FINAL CALL'], boardRows: 7 } },
  { id: 'lax/atc', prefab: 'atc_tower', at: [296, 440], h: 34.0, baseY: 0.24 },
  { id: 'lax/jet_1', prefab: 'prop_jet', at: [302, 502], ry: -PI / 2, stripe: 0xdc2626 },
  { id: 'lax/jet_2', prefab: 'prop_jet', at: [302, 622], ry: -PI / 2, stripe: 0x0284c7 },
  { id: 'lax/hangar_1', prefab: 'hangar', at: [442, 500], w: 26, d: 28, h: 11, baseY: 0.29, name: 'HANGAR 1 • MAINTENANCE' },
  { id: 'lax/hangar_2', prefab: 'hangar', at: [442, 630], w: 26, d: 28, h: 11, baseY: 0.29, name: 'HANGAR 2 • CARGO' },
  { id: 'lax/cart_1', prefab: 'prop_service', kind: 'cart', at: [294, 480], color: 0x2563eb },
  { id: 'lax/cart_2', prefab: 'prop_service', kind: 'cart', at: [294, 486], color: 0x2563eb },
  { id: 'lax/cart_3', prefab: 'prop_service', kind: 'cart', at: [296, 640], color: 0x16a34a },
  { id: 'lax/cart_4', prefab: 'prop_service', kind: 'cart', at: [296, 646], color: 0x16a34a },
  { id: 'lax/tug', prefab: 'prop_service', kind: 'tug', at: [288, 560] },
  { id: 'lax/mast_1', prefab: 'prop_service', kind: 'mast', at: [318, 470], h: 22 },
  { id: 'lax/mast_2', prefab: 'prop_service', kind: 'mast', at: [318, 565], h: 22 },
  { id: 'lax/mast_3', prefab: 'prop_service', kind: 'mast', at: [318, 660], h: 22 },
  { id: 'lax/cones_1', prefab: 'prop_service', kind: 'cones', at: [302, 502] },
  { id: 'lax/cones_2', prefab: 'prop_service', kind: 'cones', at: [302, 622] },

  { id: 'sp/dealer', prefab: 'shop_dealer', at: [-85, 812] },
  { id: 'sp/car_1', prefab: 'vehicle', at: [-58, 734.5], y: 0.27, ry: PI / 2, super: true,
    name: 'LOS AURA GT-R #1', body: 0xdc2626, accent: 0xfacc15 },
  { id: 'sp/car_2', prefab: 'vehicle', at: [-66, 741.5], y: 0.27, ry: PI / 2, super: true,
    name: 'PACIFIC APEX #7', body: 0x0284c7, accent: 0xf8fafc },

  // West bank kerb strips (tower plinths are built by the tower rows themselves).
  { id: 'wb/pad_480', prefab: 'slab', at: [-195, 480], w: 60, d: 44, y: 0.26, h: 0.10, surface: 'sidewalk', repeat: [8, 8] },
  { id: 'wb/pad_540', prefab: 'slab', at: [-195, 540], w: 60, d: 44, y: 0.26, h: 0.10, surface: 'sidewalk', repeat: [8, 8] },
  { id: 'wb/pad_600', prefab: 'slab', at: [-195, 600], w: 60, d: 44, y: 0.26, h: 0.10, surface: 'sidewalk', repeat: [8, 8] },
  { id: 'wb/pad_660', prefab: 'slab', at: [-195, 660], w: 60, d: 44, y: 0.26, h: 0.10, surface: 'sidewalk', repeat: [8, 8] },

  // ---- placement:armory -----------------------------------------------------------
  { id: 'la/armory', prefab: 'shop_armory', at: [104, 494], w: 20, d: 22, h: 5.2, baseY: 0.24 },
  { id: 'la/armory_dumpster', prefab: 'prop_dumpster', at: [99, 478], hammer: true },
  { id: 'la/armory_pallet', prefab: 'prop_pallet', at: [109.5, 478.5], y: 0.24, crate: true },
  { id: 'la/armory_lamp', prefab: 'prop_walllamp', at: [104, 482.6], y: 3.6,
    light: { color: 0xffd9a0, intensity: 2.2, range: 16 } },
  { id: 'la/armory_sign', prefab: 'prop_sign', at: [104, 482.85], y: 2.6,
    text: 'STAFF ONLY', bg: '#1c1917', fg: '#f87171', w: 2.4, h: 0.45 },

  // ---- towers (36 — exact original TOWER_PLACEMENTS heights) ------------------------
  tw('sv/tw_01', [-48, -96], 14.5, 14.5, 48, 'glass', 0x0284c7, 0x0f172a, 'AURA CORP HQ', { heli: true }),
  tw('sv/tw_02', [48, -96], 14.5, 14.5, 54, 'glass', 0x0d9488, 0x1e293b, 'SUNNYVALE EXCHANGE'),
  tw('sv/tw_03', [-96, -96], 14, 14, 42, 'glass', 0x2563eb, 0x1e293b, 'WESTSIDE TOWER', { heli: true }),
  tw('sv/tw_04', [96, -96], 14, 14, 46, 'glass', 0x0369a1, 0x0f172a, 'EASTGATE PLAZA'),
  tw('sv/tw_05', [0, -144], 16, 16, 64, 'deco', 0x38bdf8, 0x090d14, 'APEX PINNACLE', { heli: true }),
  tw('sv/tw_06', [-48, -144], 14.5, 14.5, 52, 'glass', 0x1d4ed8, 0x1e293b, 'HORIZON FINANCIAL'),
  tw('sv/tw_07', [48, -144], 14.5, 14.5, 56, 'glass', 0x0f766e, 0x0f172a, 'PACIFIC TOWERS', { heli: true }),
  tw('sv/tw_08', [-96, -144], 14, 14, 44, 'glass', 0x4f46e5, 0x1e293b, 'NORTHERN STAR'),
  tw('sv/tw_09', [96, -144], 14, 14, 50, 'glass', 0x0284c7, 0x0f172a, 'HARBOR VIEW HQ', { heli: true }),
  tw('sv/tw_10', [-162, -96], 14, 14, 38, 'slab', 0x7dd3fc, 0x8c8172, 'TERRACE COURT', { pad: true }),
  tw('sv/tw_11', [-162, -48], 14, 14, 44, 'brutalist', 0x93c5fd, 0x6b7280, 'WESTBANK HOUSE', { pad: true }),
  tw('sv/tw_12', [-162, 0], 14, 14, 34, 'slab', 0xfcd34d, 0x9a8478, 'MERIDIAN FLATS', { pad: true }),
  tw('sv/tw_13', [-162, 48], 14, 14, 46, 'brutalist', 0x67e8f9, 0x57534e, 'CIVIC ANNEX', { pad: true }),
  tw('sv/tw_14', [-162, 96], 14, 14, 32, 'slab', 0xa7f3d0, 0x8c8172, 'NORTHGATE FLATS', { pad: true }),

  // US Aura: original had helipad AND crown rings; one crown slot → rings win.
  tw('la/tw_01', [-36, 540], 18, 18, 86, 'glass', 0x38bdf8, 0xe2e8f0, 'US AURA TOWER', { crown: 'crown' }),
  tw('la/tw_02', [12, 540], 16.5, 15, 80, 'glass', 0x0284c7, 0x0f172a, 'WILSHIRE GRAND', { crown: 'sail' }),
  tw('la/tw_03', [-84, 540], 15.5, 15.5, 72, 'glass', 0x1e3a8a, 0xf8fafc, 'AON AURA CENTER', { heli: true }),
  tw('la/tw_04', [60, 540], 16, 16, 68, 'glass', 0x0f766e, 0x1e293b, 'SOCAL GAS TOWER'),
  tw('la/tw_05', [-36, 636], 18, 18, 52, 'deco', 0xe2e8f0, 0xf8fafc, 'LOS AURA CITY HALL', { crown: 'pyramid' }),
  tw('la/tw_06', [12, 636], 15, 15, 62, 'glass', 0x2563eb, 0x0f172a, 'FIGUEROA AT WILSHIRE', { heli: true }),
  tw('la/tw_07', [60, 588], 14.5, 14.5, 58, 'glass', 0x0d9488, 0x1e293b, 'BUNKER HILL PLAZA'),
  tw('la/tw_08', [60, 636], 14.5, 14.5, 54, 'glass', 0x0369a1, 0x0f172a, 'BROADWAY TRADE CENTER', { heli: true }),
  tw('la/tw_09', [104, 540], 13.5, 14.5, 50, 'glass', 0x4f46e5, 0x1e293b, 'ARTS DISTRICT TOWER'),
  tw('la/tw_10', [104, 588], 13.5, 14.5, 46, 'glass', 0x0284c7, 0x1e293b, 'LITTLE TOKYO PLAZA', { heli: true }),
  tw('la/tw_11', [-84, 492], 16, 16, 56, 'deco', 0xfbbf24, 0x1c1917, 'SOUTHERN EXCHANGE'),
  tw('la/tw_12', [-36, 588], 16, 16, 60, 'brutalist', 0x93c5fd, 0x6b7280, 'HARBOR COMMERCE', { heli: true }),
  tw('la/tw_13', [-84, 636], 16, 16, 48, 'slab', 0xfcd34d, 0x9a8478, 'CIVIC GARDENS'),
  tw('la/tw_14', [104, 636], 14, 14, 52, 'glass', 0x22d3ee, 0x0f172a, 'EASTLAKE TOWER'),

  tw('wb/tw_01', [-175, 480], 16, 16, 64, 'glass', 0x0ea5e9, 0x0f172a, 'WEST BANK ONE', { heli: true, pad: true }),
  tw('wb/tw_02', [-215, 480], 16, 16, 44, 'slab', 0xfcd34d, 0x8c8172, 'SHORELINE FLATS', { pad: true }),
  tw('wb/tw_03', [-175, 540], 16, 16, 70, 'deco', 0x38bdf8, 0xe2e8f0, 'PACIFIC CROWN', { heli: true, pad: true }),
  tw('wb/tw_04', [-215, 540], 16, 16, 50, 'brutalist', 0x93c5fd, 0x57534e, 'WEST BANK CIVIC', { pad: true }),
  tw('wb/tw_05', [-175, 600], 16, 16, 58, 'glass', 0x0d9488, 0x1e293b, 'CHANNEL HOUSE', { pad: true }),
  tw('wb/tw_06', [-215, 600], 16, 16, 40, 'slab', 0xa7f3d0, 0x9a8478, 'MARINA COURT', { pad: true }),
  tw('wb/tw_07', [-175, 660], 16, 16, 54, 'brutalist', 0x67e8f9, 0x6b7280, 'NORTHSHORE ANNEX', { pad: true }),
  tw('wb/tw_08', [-215, 660], 16, 16, 46, 'glass', 0x2563eb, 0x0f172a, 'NORTHSHORE TOWER', { pad: true })
];

// =============================================================================
// SYSTEMS — behaviour specs consumed by worldSystems/* (install/update).
// =============================================================================
export const SYSTEMS = {
  retiredEntityIds: ['road_mwr8epy21', 'road_mwr8fxyy2', 'road_mwsebg0p1'],

  sewer: {
    width: 5.4, wallH: 4.6,
    nodes: { A: [-130, -30], B: [-40, -30], C: [20, -30], D: [48, -30], E: [150, -30],
             F: [48, -16], G: [20, -66], H: [20, 24], I: [20, 110], J: [-4, 24] },
    edges: [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E'], ['D', 'F'],
            ['C', 'G'], ['C', 'H'], ['H', 'I'], ['H', 'J']],
    exits: ['J', 'F', 'B', 'G'],
    autoExits: ['A', 'E', 'I']        // added only if the surface lot is clear
  },

  armory: {
    at: [104, 494], w: 20, d: 22, h: 5.2, baseY: 0.24,
    dumpster: { at: [99, 478] },
    ammo: { at: [97.2, 485.6], price: 60 },
    stock: [
      { id: 'hotdog_shooter', label: 'HOTDOG SHOOTER', price: 450, at: [99.5, 489.0] },
      { id: 'crowbar', label: 'STEEL CROWBAR', price: 220, at: [108.5, 489.0] },
      { id: 'pipe', label: 'TACTICAL PIPE', price: 180, at: [99.5, 498.0] },
      { id: 'bat', label: 'WOODEN BAT', price: 120, at: [108.5, 498.0] }
    ],
    alarmSeconds: 45
  },

  estates: { gateApproach: [-432, -45], gateRange: 6, gateCrime: 0.35,
             safeRange: 2.4, safeReward: 600, safeCrime: 0.5 },

  airport: { boardRefresh: 2.4, boardRange: 120, carouselSpeed: 0.35 },

  atmosphere: {
    fog: { alpine: [0xdbe9f4, 0.007], woods: [0x9ccaa6, 0.0048],
           cove: [0xaee2f4, 0.0024], jungle: [0x2d5a27, 0.006], defaultDensity: 0.0032 },
    snowCount: 420,
    feeds: {
      alpine: 'FROSTPINE ALPINE — ICY & SLIPPERY • LOOP ROAD OPEN',
      woods: 'EMERALD WOODS — STREAMS SLOW YOU DOWN',
      cove: 'SUNSET COVE — SWIM & DIVE THE SEABED',
      jungle: 'VERDANT JUNGLE — RIVER CURRENT RUNS SOUTH'
    }
  },

  edgeBarrier: { chunk: 46, near: 46, far: 96 },

  groundIntegrity: {
    panels: [
      { bounds: [-720, -196, -170, -600], seg: [132, 108], name: 'Northwest range' },
      { bounds: [424, 560, -170, -600], seg: [46, 108], name: 'Northeast range' }
    ],
    patches: [
      { bounds: [138, 164, 190, 208], y: 0.17, surface: 'sand', name: 'Cove east shore' },
      { bounds: [368, 533, 240, 320], y: 0.17, surface: 'sand', name: 'North jungle shore' }
    ],
    lips: [
      { w: 165, h: 1.5, d: 0.6, at: [450.5, 240.3],
        mat: { hex: 0x4a3f2c, texType: 'redrock', repeatX: 16, repeatY: 1, roughness: 0.95 } }
    ],
    backstops: [
      { bounds: [-760, 580, -640, -168], name: 'Northern backstop' },
      { bounds: [-760, -196, -168, 108], name: 'Western backstop' }
    ]
  },

  hideout: { tankHull: true },   // systems/hideout must port the armor/turret hull
  speedway: {}
};

export default { WORLD, BOOT, TERRAIN, WATER, ROADS, DISTRICTS, SCATTERS, PLACEMENTS, SYSTEMS };